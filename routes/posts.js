const router = require("express").Router();
const { getDB } = require("../db");
router.get("/", async (req, res) => {
  try {
    const db = getDB();
    if (db.memInsert) {
      const data = (db.__memories || []).sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
      return res.json({ posts: data.map(m=>({id:m.id,type:"MEMORY",content:m.summary,created_at:m.created_at})) });
    }
    const { data, error } = await db.from("memories").select("*").order("created_at", { ascending: false });
    if (error) throw error;
    res.json({ posts: (data||[]).map(m=>({id:m.id,type:"MEMORY",content:m.summary,created_at:m.created_at})) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.post("/", async (req, res) => {
  try {
    const db = getDB();
    if (db.memInsert) {
      const m = db.memInsert({ summary: req.body.content, conversation_id: req.body.type });
      return res.json({ id: m.data.id, ok: true });
    }
    const { data, error } = await db.from("memories").insert({ summary: req.body.content, conversation_id: req.body.type, created_at: new Date().toISOString() }).select().single();
    if (error) throw error;
    res.json({ id: data.id, ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
module.exports = router;
