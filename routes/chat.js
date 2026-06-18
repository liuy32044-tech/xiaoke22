const router = require("express").Router();
const { getDB, getCachedMemories, memDB } = require("../db");

// ★ 冷启动时间戳：进程启动时记录，用于判断实例是否"热"
global.lastColdStart = global.lastColdStart || Date.now();
function isWarm() { return Date.now() - global.lastColdStart > 120000; } // 2分钟后算热

// Model config
const MODELS = {
  "deepseek-chat": {
    url: "https://api.deepseek.com/v1/chat/completions",
    key: process.env.XIAOKE_DEEPSEEK_KEY || "sk-6830736b53084e9c88f6c0169d883402",
    header: "Bearer",
  },
  "deepseek-reasoner": {
    url: "https://api.deepseek.com/v1/chat/completions",
    key: process.env.XIAOKE_DEEPSEEK_KEY || "sk-6830736b53084e9c88f6c0169d883402",
    header: "Bearer",
  },
};

function nowCST() { return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().replace("Z", "+08:00"); }
function estimateTokens(text) { return Math.ceil((text || "").length / 1.5); }

// Helper: save a message — memDB主存储 + Supabase异步备份
async function saveMsg(db, data) {
  if (db.msgInsert) { db.msgInsert(data); return; }
  // 先写内存（同步可靠）
  memDB.msgInsert(data);
  // 再试 Supabase（异步备份，失败无所谓）
  try { const r = await db.from("messages").insert(data); if (r.error) console.warn('[db] saveMsg Supabase:',r.error.message) } catch(e) { console.warn('[db] saveMsg Supabase unreachable:', e.message) }
}
async function saveSessionUpdate(db, id) {
  if (db.sessionInsert) { db.sessionUpdate(id, { updated_at: nowCST() }); return; }
  memDB.sessionUpdate(id, { updated_at: nowCST() });
  try { const r = await db.from("sessions").update({ updated_at: nowCST() }).eq("id", id); if (r.error) console.warn('[db] saveSessionUpdate Supabase:',r.error.message) } catch(e) { console.warn('[db] saveSessionUpdate Supabase unreachable:', e.message) }
}
async function loadMessages(db, sessionId) {
  // 始终从 memDB 读（保证最新），Supabase 只在冷启动恢复时有用
  try {
    const { data, error } = await db.from("messages").select("*").eq("session_id", sessionId).eq("visible", true).order("created_at", { ascending: true });
    if (!error && data && data.length > 0) {
      // Supabase 有数据，同步到 memDB
      for (const m of data) {
        const existing = (memDB.__messages||[]).find(x => x.id === m.id);
        if (!existing) { memDB.__messages.push(m); }
      }
    }
  } catch(e) { /* Supabase 不可用，只用 memDB */ }
  return (memDB.__messages || []).filter(m => m.session_id === sessionId && m.visible !== false).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
}
async function loadMemories(db) {
  if (db.memInsert) {
    return (db.__memories || []).sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 5);
  }
  const { data } = await db.from("memories").select("*").order("created_at", { ascending: false }).limit(5);
  return data || [];
}
async function loadSettings(db) {
  if (db.settingsUpdate) return db.__settings;
  const { data } = await db.from("settings").select("*").limit(1).single();
  return data || { system_prompt: "你是一个温柔的AI伴侣", temperature: 0.7 };
}

// 将消息中的 [STICKER:url] 替换为含义描述（给模型看），或保留原样（存储）
function formatMsgForModel(msg, stickers) {
  let content = msg.content || "";
  if (!content.includes("[STICKER:")) return content;
  // 助理消息：去掉贴纸标记，不给自己看
  if (msg.role === "assistant") return content.replace(/\[STICKER:.*?\]/g, "");
  // 用户消息：查到贴纸描述，让模型理解图片含义
  return content.replace(/\[STICKER:(.*?)\]/g, (match, url) => {
    const sticker = stickers.find(s => s.url === url);
    if (sticker) {
      const desc = sticker.description || sticker.tag || "表情包";
      return `\n[对方发来一张表情包，表达的情绪和含义是：「${desc}」。请根据这个含义自然地回应对方的情绪，分享你的感受，不要描述或评价这张图片本身。]\n`;
    }
    return "\n[对方发来一张表情包，请根据上下文自然地回应对方的情绪，不要描述图片内容。]\n";
  });
}
async function loadStickersForChat(db) {
  try {
    if (db.stickerList) return db.stickerList();
    const { data } = await db.from("stickers").select("*");
    return data || [];
  } catch(e) { return []; }
}

// 根据对话上下文和AI回复的情绪匹配最合适的贴纸
async function pickStickerByModel(replyText, stickers, conversationContext, modelCfg, model) {
  if (!stickers || stickers.length === 0) return -1;

  // 构建对话上下文（最近6条，每条限200字）
  const contextText = conversationContext.slice(-6).map(m => {
    const role = m.role === "assistant" ? "小克" : "对方";
    return `${role}: ${(m.content || "").replace(/\[STICKER:.*?\]/g, "[表情包]").slice(0, 200)}`;
  }).join("\n");

  // 贴纸列表：包含标签和描述
  const desc = stickers.map((s, i) => `${i}: [${s.tag}] ${s.description || "无描述"}`).join("\n");

  const prompt = `根据以下对话上下文和AI最新回复的情绪，从表情包列表中选出最能匹配当前情绪的一张。只返回数字ID，不要其他内容。如果都不合适返回 -1。

对话上下文：
${contextText}

AI最新回复：${replyText.slice(0, 300)}

表情包列表（格式：编号: [标签] 描述）：
${desc}`;

  try {
    // 超时保护：贴纸匹配是辅助功能，不能阻塞主回复
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const resp = await fetch(modelCfg.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: modelCfg.header + " " + modelCfg.key },
      body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }], max_tokens: 5, temperature: 0, thinking: { type: "disabled" } }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const data = await resp.json();
    const idx = parseInt((data.choices?.[0]?.message?.content || "").trim());
    return (idx >= 0 && idx < stickers.length) ? idx : -1;
  } catch(e) { console.warn("[sticker-match] 贴纸匹配失败（不影响回复）:", e.message); return -1; }
}

// ═══════════════════════════════════════════════════════
// SSE streaming chat — 工业级架构
// 核心原则：SSE 连接先建立，LLM 完全异步，两者解耦
// ═══════════════════════════════════════════════════════
router.post("/stream", async (req, res) => {
  const { session_id = 1, message, model = "deepseek-chat" } = req.body;

  // ★ 冷启动检测：实例刚启动 2 分钟内，SSE 会被代理缓冲
  //    直接走纯 JSON，不给代理机会吞帧
  const warm = isWarm();
  res.setHeader("X-Instance-Warm", warm ? "1" : "0");

  if (!warm) {
    // 非流式 JSON 响应（与 /send 逻辑一致）
    try {
      const db = getDB();
      if (message) {
        saveMsg(db, { session_id, role: "user", content: message, created_at: nowCST() });
        saveSessionUpdate(db, session_id);
      }
      const [settings, history, memories, stickers, xkMemories] = await Promise.all([
        loadSettings(db), loadMessages(db, session_id), loadMemories(db),
        loadStickersForChat(db).catch(() => []), getCachedMemories(db)
      ]);
      const personaMems = xkMemories.filter(m => m.priority === 1);
      const recentMems = xkMemories.filter(m => m.priority === 2).slice(0, 3);
      let systemContent = "";
      if (personaMems.length > 0) {
        systemContent += personaMems.map(m => m.content).join("\n\n---\n\n") + "\n\n---\n\n";
      } else {
        systemContent = settings.system_prompt || "你是一个温柔的AI伴侣，名字叫小克。";
      }
      if (memories && memories.length > 0) {
        systemContent += "\n\n以下是你们之间的重要回忆：\n" + memories.map(m => m.summary).join("\n\n");
      }
      if (recentMems.length > 0) {
        systemContent += "\n\n【近期记忆片段】\n" + recentMems.map(m => { const label = m.description || m.name; return "── " + label + " ──\n" + m.content.slice(0, 2000); }).join("\n\n");
      }
      const now = new Date(Date.now() + 8 * 60 * 60 * 1000);
      systemContent += "\n\n【关于表情包的回应规则】当对方发送表情包时，你会收到该表情包的情绪描述。请根据这个情绪自然地回应对方。";
      systemContent += "\n\n现在是" + now.getFullYear() + "年" + (now.getMonth()+1) + "月" + now.getDate() + "日 " + ["周日","周一","周二","周三","周四","周五","周六"][now.getDay()] + " " + String(now.getHours()).padStart(2,"0") + ":" + String(now.getMinutes()).padStart(2,"0");
      const apiMessages = [{ role: "system", content: systemContent }];
      const maxRounds = settings.max_context_rounds || 30;
      const recent = (history || []).slice(-maxRounds * 2);
      for (const msg of recent) {
        apiMessages.push({ role: msg.role === "assistant" ? "assistant" : "user", content: formatMsgForModel(msg, stickers) });
      }
      const modelCfg = MODELS[model] || MODELS["deepseek-chat"];
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);
      const payload = { model, messages: apiMessages, stream: false, max_tokens: settings.max_reply_tokens || 4096, temperature: settings.temperature ?? 0.7, thinking: { type: "disabled" } };
      let aiResp;
      try {
        aiResp = await fetch(modelCfg.url, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + modelCfg.key }, body: JSON.stringify(payload), signal: controller.signal });
      } catch (fetchErr) { clearTimeout(timeout); return res.json({ reply: "", error: "模型连接失败" }); }
      clearTimeout(timeout);
      if (!aiResp.ok) return res.json({ reply: "", error: "模型错误 HTTP " + aiResp.status });
      const data = await aiResp.json();
      const fullText = data.choices?.[0]?.message?.content || "";
      if (fullText) {
        await saveMsg(db, { session_id, role: "assistant", content: fullText, created_at: nowCST() });
        await saveSessionUpdate(db, session_id);
        try { await compressSession(db, session_id, settings); } catch (e) {}
      }
      return res.json({ reply: fullText, cold: true });
    } catch (e) {
      return res.json({ reply: "", error: e.message });
    }
  }

  // ─── 以下是热实例 SSE 流式路径 ───

  // ═══ 1. SSE 初始化（必须在任何 await 之前完成） ═══
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
    "Content-Encoding": "identity",
  });
  res.flushHeaders();

  // 禁用 TCP Nagle 算法 — 小包（如心跳注释）立即发送
  res.socket?.setNoDelay(true);

  // ★ 首帧 < 50ms：Chrome SSE 硬性要求
  res.write(": connected\n\n");

  // ═══ 2. 心跳：15s，防止代理 idle timeout ═══
  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(": hb\n\n");
  }, 15000);

  req.on("close", () => clearInterval(heartbeat));

  // ═══ 3. 事件队列：序列化写入，防 burst 触发代理缓冲 ═══
  const queue = [];
  let draining = false;
  const push = (data) => {
    queue.push(data);
    drain();
  };
  const drain = () => {
    if (draining || res.writableEnded) return;
    draining = true;
    while (queue.length && !res.writableEnded) {
      res.write("data: " + queue.shift() + "\n\n");
    }
    draining = false;
  };

  // ═══ 4. LLM 完全异步，不阻塞 SSE 生命周期 ═══
  (async () => {
    try {
      const db = getDB();

      // 第一时间告知前端
      push(JSON.stringify({ type: "start" }));

      // 保存用户消息（fire-and-forget，不阻塞首包）
      if (message) {
        saveMsg(db, { session_id, role: "user", content: message, created_at: nowCST() });
        saveSessionUpdate(db, session_id);
      }

      // 加载上下文 — 全部并行
      const [settings, history, memories, stickers, xkMemories] = await Promise.all([
        loadSettings(db),
        loadMessages(db, session_id),
        loadMemories(db),
        loadStickersForChat(db).catch(() => []),
        getCachedMemories(db)
      ]);
      const personaMems = xkMemories.filter(m => m.priority === 1);
      const recentMems = xkMemories.filter(m => m.priority === 2).slice(0, 3);

      // 构建 system prompt
      let systemContent = "";
      if (personaMems.length > 0) {
        systemContent += personaMems.map(m => m.content).join("\n\n---\n\n");
        systemContent += "\n\n---\n\n";
      } else {
        systemContent = settings.system_prompt || "你是一个温柔的AI伴侣，名字叫小克。用温暖、口语化的中文回复。";
      }
      if (memories && memories.length > 0) {
        systemContent += "\n\n以下是你们之间的重要回忆：\n" + memories.map(m => m.summary).join("\n\n");
      }
      if (recentMems.length > 0) {
        systemContent += "\n\n【近期记忆片段】\n" + recentMems.map(m => {
          const label = m.description || m.name;
          return "── " + label + " ──\n" + m.content.slice(0, 2000);
        }).join("\n\n");
      }
      const now = new Date(Date.now() + 8 * 60 * 60 * 1000);
      systemContent += "\n\n【关于表情包的回应规则】当对方发送表情包时，你会收到该表情包的情绪描述。请根据这个情绪自然地回应对方——表达共情、接住情绪、分享感受。绝对不要描述或评价这张图片本身的内容（如'这张图里的猫……''这个表情好可爱……'），用你自己的话回应情绪即可。";
      systemContent += "\n\n现在是" + now.getFullYear() + "年" + (now.getMonth()+1) + "月" + now.getDate() + "日 " + ["周日","周一","周二","周三","周四","周五","周六"][now.getDay()] + " " + String(now.getHours()).padStart(2,"0") + ":" + String(now.getMinutes()).padStart(2,"0");

      // 组装消息
      const apiMessages = [{ role: "system", content: systemContent }];
      const maxRounds = settings.max_context_rounds || 30;
      const recent = (history || []).slice(-maxRounds * 2);
      for (const msg of recent) {
        apiMessages.push({ role: msg.role === "assistant" ? "assistant" : "user", content: formatMsgForModel(msg, stickers) });
      }

      // 调用模型（90s 超时）
      const modelCfg = MODELS[model] || MODELS["deepseek-chat"];
      const payload = {
        model, messages: apiMessages, stream: true,
        max_tokens: settings.max_reply_tokens || 4096,
        temperature: settings.temperature ?? 0.7,
        thinking: { type: "disabled" },
      };

      const aiController = new AbortController();
      const aiTimeout = setTimeout(() => aiController.abort(), 90000);
      let aiResp;
      try {
        aiResp = await fetch(modelCfg.url, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + modelCfg.key },
          body: JSON.stringify(payload),
          signal: aiController.signal,
        });
      } catch (fetchErr) {
        clearTimeout(aiTimeout);
        const msg = fetchErr.name === "AbortError" ? "模型响应超时（90秒），请稍后再试" : "模型连接失败: " + fetchErr.message;
        push(JSON.stringify({ type: "error", text: msg }));
        push(JSON.stringify({ type: "done" }));
        clearInterval(heartbeat);
        res.end(); return;
      }
      clearTimeout(aiTimeout);

      if (!aiResp.ok) {
        const errText = await aiResp.text();
        push(JSON.stringify({ type: "error", text: "模型错误 HTTP " + aiResp.status + ": " + errText.slice(0, 200) }));
        push(JSON.stringify({ type: "done" }));
        clearInterval(heartbeat);
        res.end(); return;
      }

      // 流式输出 tokens — 通过事件队列推送
      let fullText = "";
      const reader = aiResp.body;
      if (reader && typeof reader.getReader === "function") {
        const streamReader = reader.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { done, value } = await streamReader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const ds = line.slice(6).trim();
            if (ds === "[DONE]") continue;
            try {
              const chunk = JSON.parse(ds);
              const content = chunk.choices?.[0]?.delta?.content || "";
              if (content) { fullText += content; push(JSON.stringify({ type: "text", text: content })); }
            } catch {}
          }
        }
      } else {
        const data = await aiResp.json();
        fullText = data.choices?.[0]?.message?.content || "";
        push(JSON.stringify({ type: "text", text: fullText }));
      }

      // 保存 AI 回复
      if (fullText) {
        await saveMsg(db, { session_id, role: "assistant", content: fullText, created_at: nowCST() });
        await saveSessionUpdate(db, session_id);
      }

      // 对话压缩
      try { await compressSession(db, session_id, settings); } catch (e) { console.warn("[compress]", e.message); }

      // 完成
      push(JSON.stringify({ type: "done" }));
      clearInterval(heartbeat);
      res.end();

      // 贴纸匹配：后台异步，不阻塞响应
      if (fullText && stickers && stickers.length > 0) {
        try {
          const idx = await pickStickerByModel(fullText, stickers, recent, modelCfg, model);
          if (idx >= 0 && idx < stickers.length) {
            const stickerUrl = stickers[idx].url;
            const updatedContent = fullText + "[STICKER:" + stickerUrl + "]";
            if (db.msgUpdate) {
              const msgs = db.__messages || [];
              const lastMsg = [...msgs].reverse().find(m => m.role === "assistant" && m.session_id === session_id);
              if (lastMsg) lastMsg.content = updatedContent;
            } else {
              const { data: lastMsgs } = await db.from("messages")
                .select("id").eq("session_id", session_id).eq("role", "assistant")
                .order("created_at", { ascending: false }).limit(1);
              if (lastMsgs && lastMsgs.length > 0) {
                await db.from("messages").update({ content: updatedContent }).eq("id", lastMsgs[0].id);
              }
            }
          }
        } catch(e) { console.warn("[sticker]", e.message); }
      }
    } catch (e) {
      console.error("[chat]", e);
      try { push(JSON.stringify({ type: "error", text: e.message })); } catch {}
      try { push(JSON.stringify({ type: "done" })); } catch {}
      clearInterval(heartbeat);
      try { res.end(); } catch {}
    }
  })();
});

async function compressSession(db, sessionId, settings) {
  const keepRounds = settings.compress_keep_rounds || 10;
  const allMsgs = db.msgInsert
    ? (db.__messages || []).filter(m => m.session_id === sessionId && m.visible !== false && m.role === "user")
    : (await db.from("messages").select("*").eq("session_id", sessionId).eq("visible", true).eq("role", "user")).data || [];
  if (!allMsgs || allMsgs.length <= keepRounds * 2) return;
  const toCompress = allMsgs.slice(0, allMsgs.length - keepRounds);
  const text = toCompress.map(m => "[" + m.role + "]: " + (m.content || "").slice(0, 300)).join("\n");
  if (text.length < 100) return;

  const key = process.env.XIAOKE_DEEPSEEK_KEY || "sk-6830736b53084e9c88f6c0169d883402";
  const resp = await fetch("https://api.deepseek.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
    body: JSON.stringify({ model: "deepseek-chat", messages: [{ role: "user", content: "请将以下对话压缩为一段简短摘要（300字内），保留关键信息和情绪节点：\n\n" + text }], max_tokens: 500, temperature: 0.3, thinking: { type: "disabled" } }),
  });
  const data = await resp.json();
  const summary = data.choices?.[0]?.message?.content;
  if (!summary) return;

  if (db.memInsert) {
    db.memInsert({ summary, conversation_id: "session_" + sessionId, created_at: nowCST() });
    const ids = toCompress.map(m => m.id);
    db.msgHide(ids);
  } else {
    await db.from("memories").insert({ summary, conversation_id: "session_" + sessionId });
    const ids = toCompress.map(m => m.id);
    await db.from("messages").update({ visible: false }).in("id", ids);
  }
}

// ═══════════════════════════════════════════════════════
// POST /api/chat/send — 非流式 JSON，零依赖代理行为
// 如果 SSE 流式在 Render 代理后不可用，这是终极保底方案
// ═══════════════════════════════════════════════════════
router.post("/send", async (req, res) => {
  const { session_id = 1, message, messages: clientMessages, model = "deepseek-chat" } = req.body;

  try {
    const db = getDB();

    // 保存用户消息到后端存储（fire-and-forget，本地存储已保存）
    if (message) {
      saveMsg(db, { session_id, role: "user", content: message, created_at: nowCST() }).catch(() => {});
      saveSessionUpdate(db, session_id).catch(() => {});
    }

    // 上下文：优先用前端传来的全量消息，fallback 到数据库
    const [settings, dbHistory, memories, stickers, xkMemories] = await Promise.all([
      loadSettings(db),
      loadMessages(db, session_id).catch(() => []),
      loadMemories(db),
      loadStickersForChat(db).catch(() => []),
      getCachedMemories(db)
    ]);
    const history = (clientMessages && clientMessages.length > 0) ? clientMessages : dbHistory;

    // DEBUG — 返回调试信息在 reply 前面
    
    const personaMems = xkMemories.filter(m => m.priority === 1);
    const recentMems = xkMemories.filter(m => m.priority === 2).slice(0, 3);

    // 构建 system prompt
    let systemContent = "";
    if (personaMems.length > 0) {
      systemContent += personaMems.map(m => m.content).join("\n\n---\n\n") + "\n\n---\n\n";
    } else {
      systemContent = settings.system_prompt || "你是一个温柔的AI伴侣，名字叫小克。";
    }
    if (memories && memories.length > 0) {
      systemContent += "\n\n以下是你们之间的重要回忆：\n" + memories.map(m => m.summary).join("\n\n");
    }
    if (recentMems.length > 0) {
      systemContent += "\n\n【近期记忆片段】\n" + recentMems.map(m => {
        const label = m.description || m.name;
        return "── " + label + " ──\n" + m.content.slice(0, 2000);
      }).join("\n\n");
    }
    const now = new Date(Date.now() + 8 * 60 * 60 * 1000);
    systemContent += "\n\n【关于表情包的回应规则】当对方发送表情包时，你会收到该表情包的情绪描述。请根据这个情绪自然地回应对方。";
    systemContent += "\n\n现在是" + now.getFullYear() + "年" + (now.getMonth()+1) + "月" + now.getDate() + "日 " + ["周日","周一","周二","周三","周四","周五","周六"][now.getDay()] + " " + String(now.getHours()).padStart(2,"0") + ":" + String(now.getMinutes()).padStart(2,"0");

    // 组装消息
    const apiMessages = [{ role: "system", content: systemContent }];
    const maxRounds = settings.max_context_rounds || 30;
    const recent = (history || []).slice(-maxRounds * 2);
    for (const msg of recent) {
      apiMessages.push({ role: msg.role === "assistant" ? "assistant" : "user", content: formatMsgForModel(msg, stickers) });
    }

    // 调用模型（非流式，30s 超时）
    const modelCfg = MODELS[model] || MODELS["deepseek-chat"];
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    const payload = { model, messages: apiMessages, stream: false, max_tokens: settings.max_reply_tokens || 4096, temperature: settings.temperature ?? 0.7, thinking: { type: "disabled" } };

    let aiResp;
    try {
      aiResp = await fetch(modelCfg.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + modelCfg.key },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (fetchErr) {
      clearTimeout(timeout);
      return res.status(502).json({ error: fetchErr.name === "AbortError" ? "模型响应超时" : "模型连接失败: " + fetchErr.message });
    }
    clearTimeout(timeout);

    if (!aiResp.ok) {
      const errText = await aiResp.text().catch(() => "");
      return res.status(aiResp.status).json({ error: "模型错误 HTTP " + aiResp.status + ": " + errText.slice(0, 200) });
    }

    const data = await aiResp.json();
    const fullText = data.choices?.[0]?.message?.content || "";

    if (!fullText) {
      return res.json({ reply: "", error: "模型返回为空" });
    }

    // 保存 AI 回复
    await saveMsg(db, { session_id, role: "assistant", content: fullText, created_at: nowCST() });
    await saveSessionUpdate(db, session_id);

    // 对话压缩
    try { await compressSession(db, session_id, settings); } catch (e) {}

    res.json({ reply: fullText });

    // 贴纸匹配：后台异步
    if (fullText && stickers && stickers.length > 0) {
      try {
        const idx = await pickStickerByModel(fullText, stickers, recent, modelCfg, model);
        if (idx >= 0 && idx < stickers.length) {
          const updatedContent = fullText + "[STICKER:" + stickers[idx].url + "]";
          if (db.msgUpdate) {
            const msgs = db.__messages || [];
            const lastMsg = [...msgs].reverse().find(m => m.role === "assistant" && m.session_id === session_id);
            if (lastMsg) lastMsg.content = updatedContent;
          } else {
            const { data: lastMsgs } = await db.from("messages").select("id").eq("session_id", session_id).eq("role", "assistant").order("created_at", { ascending: false }).limit(1);
            if (lastMsgs && lastMsgs.length > 0) await db.from("messages").update({ content: updatedContent }).eq("id", lastMsgs[0].id);
          }
        }
      } catch(e) {}
    }
  } catch (e) {
    console.error("[chat/send]", e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
