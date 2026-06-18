const router = require("express").Router();
const { getDB } = require("../db");

router.get("/", async (req, res) => {
  try {
    const db = getDB();
    if (db.memInsert) {
      const data = (db.__memories || []).sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
      return res.json({ memories: data });
    }
    const { data, error } = await db.from("memories").select("*").order("created_at", { ascending: false });
    if (error) throw error;
    res.json({ memories: data || [] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const db = getDB();
    if (db.memDelete) {
      db.memDelete(parseInt(req.params.id));
      return res.json({ ok: true });
    }
    await db.from("memories").delete().eq("id", req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
