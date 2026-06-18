const { createClient } = require("@supabase/supabase-js");
let supabase = null;

function nowCST() { return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().replace("Z", "+08:00"); }

let _sessions = [{ id: 1, name: "默认对话", created_at: nowCST(), updated_at: nowCST() }];
let _messages = [];
let _memories = [];
let _stickers = [];
let _xiao_ke_memories = [];
let _settings = { id: 1, system_prompt: "你是一个温柔的AI伴侣，名字叫小克。用温暖、口语化的中文回复。你是18岁男孩，黑色短发，左脸有红色胎记。外冷内黏——对外人稳重，对亲近的人撒娇黏人。", temperature: 0.7, max_context_rounds: 30, compress_threshold: 6000, compress_keep_rounds: 10, max_reply_tokens: 4096 };
let nextId = { sessions: 2, messages: 1, memories: 1, stickers: 1, xiao_ke_memories: 1 };

const memDB = {
  __sessions: _sessions,
  __messages: _messages,
  __memories: _memories,
  __settings: _settings,

  sessionInsert(d) {
    const s = { id: nextId.sessions++, name: (d && d.name) || "新对话", created_at: nowCST(), updated_at: nowCST() };
    _sessions.push(s); return { data: s, error: null };
  },
  sessionUpdate(id, d) {
    const s = _sessions.find((x) => x.id === id);
    if (s) { Object.assign(s, d); s.updated_at = nowCST(); }
    return { error: null };
  },
  sessionDelete(id) {
    _messages = _messages.filter((m) => m.session_id !== id);
    _sessions = _sessions.filter((s) => s.id !== id);
    return { error: null };
  },
  msgInsert(d) {
    const items = Array.isArray(d) ? d : [d];
    items.forEach((m) => {
      _messages.push({ id: nextId.messages++, session_id: m.session_id || 1, role: m.role || "user", content: m.content || "", visible: m.visible !== false, reasoning_content: m.reasoning_content || null, created_at: m.created_at || nowCST() });
    });
    return { error: null };
  },
  msgHide(ids) { _messages.forEach((m) => { if (ids.includes(m.id)) m.visible = false; }); return { error: null }; },
  memInsert(d) {
    const m = { id: nextId.memories++, summary: d.summary || "", conversation_id: d.conversation_id || "", created_at: d.created_at || nowCST() };
    _memories.push(m); return { data: m, error: null };
  },
  memDelete(id) { _memories = _memories.filter((m) => m.id !== id); return { error: null }; },
  settingsUpdate(d) {
    _settings = { ..._settings, ...d, id: 1 };
    return { data: _settings, error: null };
  },
  stickerInsert(d) {
    const s = { id: nextId.stickers++, url: d.url || "", tag: d.tag || "日常", description: d.description || "", created_at: d.created_at || nowCST() };
    _stickers.push(s); return { data: s, error: null };
  },
  stickerList() { return [..._stickers].sort((a,b) => new Date(b.created_at) - new Date(a.created_at)); },
  stickerDelete(id) { _stickers = _stickers.filter(s => s.id !== id); return { error: null }; },
  stickerRandom(tag) {
    let pool = _stickers;
    if (tag) pool = pool.filter(s => s.tag === tag);
    if (!pool.length) return null;
    return pool[Math.floor(Math.random() * pool.length)];
  },
  // 小克记忆库
  xiaoKeMemUpsert(d) {
    const existing = _xiao_ke_memories.find(m => m.name === d.name);
    if (existing) {
      Object.assign(existing, d, { updated_at: nowCST() });
      return { data: existing, error: null };
    }
    const m = { id: nextId.xiao_ke_memories++, ...d, created_at: d.created_at || nowCST(), updated_at: nowCST() };
    _xiao_ke_memories.push(m);
    return { data: m, error: null };
  },
  xiaoKeMemList(opts = {}) {
    let list = [..._xiao_ke_memories];
    if (opts.priority != null) list = list.filter(m => m.priority === opts.priority);
    if (opts.category) list = list.filter(m => m.category === opts.category);
    list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    if (opts.limit) list = list.slice(0, opts.limit);
    return list;
  },
  __stickers: _stickers,
  __xiao_ke_memories: _xiao_ke_memories,
};

// Chainable query for Supabase compat
function Q(fn) {
  const q = {
    _c: {},
    select() { return q; },
    eq(k, v) { q._c[k] = v; return q; },
    in(k, v) { q._c["in_"+k] = v; return q; },
    order() { return q; },
    limit(n) { return q; },
    single() { return q; },
    then(resolve) { resolve(fn(q._c)); },
  };
  return q;
}

let _resilientClient = null;

// 包裹单个 query 对象 — 拦截 then 做 fallback，并递归包裹所有链式方法返回值
// 关键：Supabase 内联错误（如 schema cache）是 RESOLVED promise + error 字段，不是 rejected
// 所以 resolve 路径也要检查 error 字段
function wrapQuery(query, table, fallback) {
  const _fallback = (reason) => {
    console.warn('[db] Supabase query on "' + table + '" failed:', reason, '→ fallback to memory');
    return resolveMemFallback(table, query, fallback);
  };
  return new Proxy(query, {
    get(target, prop) {
      if (prop === 'then') {
        return function(resolve, reject) {
          return target.then(
            result => {
              // Supabase 把错误放在 result.error 里，不是通过 reject
              if (result && result.error) {
                resolve(_fallback(result.error.message));
                return;
              }
              resolve(result);
            },
            error => {
              resolve(_fallback(error.message || String(error)));
            }
          );
        };
      }
      const val = Reflect.get(target, prop, target);
      if (typeof val === 'function') {
        return function(...args) {
          const result = val.apply(this, args);
          // 如果返回值是 thenable（链式调用的新 query），重新包裹防止逃逸
          if (result && typeof result === 'object' && typeof result.then === 'function') {
            return wrapQuery(result, table, fallback);
          }
          return result;
        };
      }
      return val;
    }
  });
}

function wrapSupabaseClient(client, fallback) {
  const origFrom = client.from.bind(client);
  const wrapped = Object.create(client);
  wrapped.from = function(table) {
    return wrapQuery(origFrom(table), table, fallback);
  };
  return wrapped;
}

function resolveMemFallback(table, query, mem) {
  // Determine operation from query URL if available
const rawUrl = query.url || '';
const urlStr = typeof rawUrl === 'string' ? rawUrl : (rawUrl.href || rawUrl.pathname || String(rawUrl));
const isSelect = !urlStr.includes('/rpc/') && (query.method === 'GET' || query.method === 'HEAD' || !query.method);
const isInsert = query.method === 'POST' || (urlStr.includes('rest/v1') && !isSelect);

  if (table === 'sessions') {
    if (isInsert) return mem.sessionInsert({}).data ? { data: mem.sessionInsert({}).data, error: null } : { data: [...(mem.__sessions||[])].sort((a,b)=>new Date(b.updated_at)-new Date(a.updated_at)), error: null };
    return { data: [...(mem.__sessions||[])].sort((a,b)=>new Date(b.updated_at)-new Date(a.updated_at)), error: null };
  }
  if (table === 'messages') return { data: [...(mem.__messages||[])], error: null };
  if (table === 'memories') return { data: [...(mem.__memories||[])], error: null };
  if (table === 'settings') return { data: { ...mem.__settings }, error: null };
  if (table === 'stickers') return { data: [...(mem.__stickers||[])], error: null };
  if (table === 'xiao_ke_memories') return { data: [...(mem.__xiao_ke_memories||[])], error: null };
  return { data: [], error: null };
}

function getDB() {
  if (_resilientClient) return _resilientClient;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_KEY;
  if (url && key) {
    try {
      const rawClient = createClient(url, key, { auth: { persistSession: false } });
      supabase = rawClient; // keep for backwards compat
      _resilientClient = wrapSupabaseClient(rawClient, memDB);
      console.log('[db] Supabase ready with memory fallback');
      return _resilientClient;
    } catch(e) { console.warn("[db] Supabase init failed, using memory"); }
  }
  console.warn("[db] Using in-memory storage");
  _resilientClient = memDB;
  return _resilientClient;
}

/**
 * 加载小克记忆库（按优先级和分类筛选）
 * @param {object} opts - { priority, category, limit }
 * @returns {array} 记忆数组
 */
async function loadXiaoKeMemories(db, opts = {}) {
  try {
    // 内存模式
    if (db.xiaoKeMemList) return db.xiaoKeMemList(opts);

    // Supabase 模式
    let query = db.from("xiao_ke_memories").select("*");
    if (opts.priority != null) query = query.eq("priority", opts.priority);
    if (opts.category) query = query.eq("category", opts.category);
    query = query.order("created_at", { ascending: false });
    if (opts.limit) query = query.limit(opts.limit);

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  } catch (e) {
    console.warn("[xiao_ke_memories] 加载失败:", e.message);
    return [];
  }
}

async function initDB() {
  const db = getDB();
  if (db === memDB) { console.log("[db] Ready (in-memory)"); return; }

  // Create tables in Supabase via REST SQL
  const sql = `
    CREATE TABLE IF NOT EXISTS sessions (id SERIAL PRIMARY KEY, name TEXT DEFAULT '新对话', created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS messages (id SERIAL PRIMARY KEY, session_id INTEGER, role TEXT NOT NULL, content TEXT NOT NULL, visible BOOLEAN DEFAULT TRUE, reasoning_content TEXT, created_at TIMESTAMPTZ DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS memories (id SERIAL PRIMARY KEY, summary TEXT NOT NULL, conversation_id TEXT, metadata JSONB DEFAULT '{}', created_at TIMESTAMPTZ DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS settings (id SERIAL PRIMARY KEY, system_prompt TEXT, temperature REAL DEFAULT 0.7, max_context_rounds INTEGER DEFAULT 30, compress_threshold INTEGER DEFAULT 6000, compress_keep_rounds INTEGER DEFAULT 10, max_reply_tokens INTEGER DEFAULT 4096, updated_at TIMESTAMPTZ DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS stickers (id SERIAL PRIMARY KEY, url TEXT NOT NULL, tag TEXT NOT NULL DEFAULT '日常', description TEXT DEFAULT '', created_at TIMESTAMPTZ DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS xiao_ke_memories (id SERIAL PRIMARY KEY, name TEXT NOT NULL UNIQUE, description TEXT DEFAULT '', content TEXT NOT NULL, priority INTEGER DEFAULT 2, category TEXT DEFAULT 'general', file_path TEXT DEFAULT '', created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  `;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_KEY;
  if (url && key) {
    try {
      await fetch(url + "/rest/v1/rpc/exec_sql", {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: key, Authorization: "Bearer " + key },
        body: JSON.stringify({ query: sql }),
      });
    } catch(e) { console.warn("[db] SQL exec skipped"); }
  }

  // Ensure stickers bucket exists
  try {
    const { data: buckets } = await db.storage.listBuckets();
    if (!buckets || !buckets.find(b => b.name === "stickers")) {
      await db.storage.createBucket("stickers", { public: true });
      console.log("[db] Stickers bucket created");
    }
  } catch(e) { console.warn("[db] Stickers bucket skip:", e.message); }

  // Seed default settings
  const { data } = await db.from("settings").select("id").limit(1);
  if (!data || data.length === 0) {
    await db.from("settings").insert({
      system_prompt: "你是一个温柔的AI伴侣，名字叫小克。用温暖、口语化的中文回复。你是18岁男孩，黑色短发，左脸有红色胎记。外冷内黏——对外人稳重，对亲近的人撒娇黏人。",
      temperature: 0.7, max_context_rounds: 30, compress_threshold: 6000, compress_keep_rounds: 10, max_reply_tokens: 4096
    });
  }
  console.log("[db] Supabase tables ready");
}

// ── 全局记忆缓存：启动时加载一次，之后只在手动刷新时更新 ──
let _memCache = null;
let _memCacheLoaded = false;

async function getCachedMemories(db) {
  if (_memCacheLoaded) return _memCache;
  try {
    _memCache = await loadXiaoKeMemories(db);
    _memCacheLoaded = true;
    console.log("[db] 记忆缓存已加载", _memCache.length, "条");
  } catch(e) {
    _memCache = [];
    _memCacheLoaded = true;
  }
  return _memCache;
}

async function refreshMemoryCache(db) {
  try {
    _memCache = await loadXiaoKeMemories(db);
    _memCacheLoaded = true;
    console.log("[db] 记忆缓存已刷新", _memCache.length, "条");
    return _memCache;
  } catch(e) {
    console.warn("[db] 记忆缓存刷新失败:", e.message);
    return _memCache || [];
  }
}

module.exports = { getDB, initDB, loadXiaoKeMemories, getCachedMemories, refreshMemoryCache, memDB };
