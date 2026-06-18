require("dotenv").config();
const express = require("express");
const path = require("path");
const cors = require("cors");
const { initDB, getDB, memDB } = require("./db");

// 保活状态（模块作用域，/api/status 可读取）
let keepaliveState = { lastPing: null, lastResult: null, pingCount: 0 };

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

// ★ SSE 代理缓冲防护：对所有响应禁用 Nginx/Render 缓冲
app.use((req, res, next) => {
  res.setHeader("X-Accel-Buffering", "no");
  next();
});

// Serve frontend static files
app.use(express.static(path.join(__dirname, "public")));

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

// Debug status — 保活日志 + DB 连通性（无需登录 Render）
app.get("/api/status", async (req, res) => {
  const db = getDB();
  const memMode = !!db.sessionInsert;
  let supabaseTest = null;
  if (!memMode && db.from) {
    try {
      const { data, error } = await db.from("sessions").select("id").limit(1);
      supabaseTest = error ? { ok: false, error: error.message } : { ok: true, rows: (data || []).length };
    } catch(e) {
      supabaseTest = { ok: false, error: e.message };
    }
  }
  const startTime = new Date(Date.now() - (process.uptime() * 1000)).toISOString();
  res.json({
    uptime: Math.round(process.uptime()) + "s",
    startedAt: startTime,
    storageMode: memMode ? "memory" : "supabase+wrapped",
    supabase: supabaseTest,
    keepalive: keepaliveState,
    nodeVersion: process.version,
    memory: {
      sessions: (memDB.__sessions || []).length,
      messages: (memDB.__messages || []).length
    }
  });
});

// Routes
app.use("/api/sessions", require("./routes/sessions"));
app.use("/api/messages", require("./routes/messages"));
app.use("/api/chat", require("./routes/chat"));
app.use("/api/settings", require("./routes/settings"));
app.use("/api/memories", require("./routes/memories"));
app.use("/api/posts", require("./routes/posts"));
app.use("/api/stickers", require("./routes/stickers"));
app.use("/api/moments", require("./routes/moments"));

// SPA fallback: all non-API routes serve index.html
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 10000;

async function start() {
  try {
    await initDB();
    console.log("[bunny] Database ready");
  } catch (e) {
    console.warn("[bunny] DB init skipped:", e.message);
    console.warn("[bunny] Running without database — set SUPABASE_URL and SUPABASE_KEY");
  }

  // Supabase 保活 — 每4分钟 ping 一次（免费层~5分钟休眠，留1分钟余量）
  setInterval(async () => {
    try {
      const db = getDB();
      if (db.from) {
        const { error } = await db.from("sessions").select("id").limit(1);
        keepaliveState.lastPing = new Date().toISOString();
        keepaliveState.pingCount++;
        if (error) {
          keepaliveState.lastResult = "warn: " + error.message;
          console.log("[keepalive] Supabase ping warn:", error.message);
        } else {
          keepaliveState.lastResult = "ok";
          console.log("[keepalive] Supabase ping ok");
        }
      }
    } catch(e) {
      keepaliveState.lastPing = new Date().toISOString();
      keepaliveState.lastResult = "failed: " + e.message;
      console.log("[keepalive] Supabase ping failed:", e.message);
    }
  }, 4 * 60 * 1000);
  // 启动后立即执行一次
  (async () => {
    try {
      const db = getDB();
      if (db.from) {
        const { error } = await db.from("sessions").select("id").limit(1);
        keepaliveState.lastPing = new Date().toISOString();
        keepaliveState.pingCount++;
        keepaliveState.lastResult = error ? "warn: " + error.message : "ok";
        console.log("[keepalive] Initial ping:", keepaliveState.lastResult);
      }
    } catch(e) {
      keepaliveState.lastPing = new Date().toISOString();
      keepaliveState.lastResult = "failed: " + e.message;
    }
  })();

  app.listen(PORT, () => {
    console.log(`[bunny] Backend running on port ${PORT}`);
  });
}

start();
