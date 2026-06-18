const router = require("express").Router();
const { getDB, memDB } = require("../db");

function nowCST() { return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().replace("Z", "+08:00"); }

// List all sessions
router.get("/", async (req, res) => {
  const db = getDB();
  if (db.sessionInsert) {
    const data = [...db.__sessions || []].sort((a,b) => new Date(b.updated_at) - new Date(a.updated_at));
    return res.json({ sessions: data });
  }
  try {
    const { data, error } = await db.from("sessions").select("*").order("updated_at", { ascending: false });
    if (error) throw error;
    res.json({ sessions: data || [] });
  } catch (e) {
    console.warn('[sessions] Supabase failed, fallback to memory:', e.message||e);
    const memData = [...(memDB.__sessions || [])].sort((a,b) => new Date(b.updated_at) - new Date(a.updated_at));
    res.json({ sessions: memData });
  }
});

// Create session
router.post("/", async (req, res) => {
  const db = getDB();
  if (db.sessionInsert) {
    const s = db.sessionInsert({ name: req.body.name || "新对话" });
    return res.json(s.data);
  }
  try {
    const { data, error } = await db.from("sessions").insert({ name: req.body.name || "新对话" }).select().single();
    if (error) throw error;
    res.json(data);
  } catch (e) {
    console.warn('[sessions] Supabase insert failed, fallback to memory:', e.message||e);
    const s = memDB.sessionInsert({ name: req.body.name || "新对话" });
    res.json(s.data);
  }
});

// Rename session
router.put("/:id", async (req, res) => {
  const db = getDB();
  if (db.sessionUpdate) {
    db.sessionUpdate(parseInt(req.params.id), { name: req.body.name });
    return res.json({ ok: true });
  }
  try {
    const { error } = await db.from("sessions").update({ name: req.body.name, updated_at: nowCST() }).eq("id", req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (e) {
    console.warn('[sessions] Supabase update failed, fallback to memory:', e.message||e);
    memDB.sessionUpdate(parseInt(req.params.id), { name: req.body.name });
    res.json({ ok: true });
  }
});

// Delete session
router.delete("/:id", async (req, res) => {
  const db = getDB();
  if (db.sessionDelete) {
    db.sessionDelete(parseInt(req.params.id));
    return res.json({ ok: true });
  }
  try {
    await db.from("messages").delete().eq("session_id", req.params.id);
    await db.from("sessions").delete().eq("id", req.params.id);
    res.json({ ok: true });
  } catch (e) {
    console.warn('[sessions] Supabase delete failed, fallback to memory:', e.message||e);
    memDB.sessionDelete(parseInt(req.params.id));
    res.json({ ok: true });
  }
});

module.exports = router;
