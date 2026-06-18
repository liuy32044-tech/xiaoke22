const router = require("express").Router();
const { getDB, memDB } = require("../db");

router.get("/:sessionId", async (req, res) => {
  try {
    const db = getDB();
    const sid = parseInt(req.params.sessionId);
    if (db.msgInsert) {
      const data = (db.__messages || []).filter(m => m.session_id === sid && m.visible !== false).sort((a,b) => new Date(a.created_at) - new Date(b.created_at));
      return res.json({ messages: data });
    }
    // 从 Supabase 拉数据同步到 memDB
    try {
      const { data, error } = await db.from("messages").select("*").eq("session_id", sid).eq("visible", true).order("created_at", { ascending: true });
      if (!error && data) {
        for (const m of data) {
          const ex = (memDB.__messages||[]).find(x => x.id === m.id);
          if (!ex) memDB.__messages.push(m);
        }
      }
    } catch(e) { /* Supabase 不可用，忽略 */ }
    // 始终从 memDB 返回（保证包含最新写入）
    const memData = (memDB.__messages || []).filter(m => m.session_id === sid && m.visible !== false).sort((a,b) => new Date(a.created_at) - new Date(b.created_at));
    return res.json({ messages: memData });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
