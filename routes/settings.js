const router = require("express").Router();
const { getDB } = require("../db");

// Get current settings
router.get("/", async (req, res) => {
  try {
    const db = getDB();
    if (db.settingsUpdate) {
      return res.json({ settings: db.__settings || { system_prompt: "默认", temperature: 0.7 } });
    }
    const { data, error } = await db.from("settings").select("*").limit(1).single();
    if (error && error.code !== "PGRST116") throw error;
    res.json({ settings: data || { system_prompt: "默认", temperature: 0.7 } });
  } catch (e) {
    res.json({ settings: { system_prompt: "你是一个温柔的AI伴侣。", temperature: 0.7 } });
  }
});

// Update settings
router.put("/", async (req, res) => {
  try {
    const db = getDB();
    if (db.settingsUpdate) {
      const s = db.settingsUpdate(req.body);
      return res.json({ settings: s.data, ok: true });
    }
    const updates = { ...req.body, updated_at: new Date().toISOString() };
    const { data: existing } = await db.from("settings").select("id").limit(1);
    let result;
    if (existing && existing.length > 0) {
      result = await db.from("settings").update(updates).eq("id", existing[0].id).select().single();
    } else {
      result = await db.from("settings").insert(updates).select().single();
    }
    if (result.error) throw result.error;
    res.json({ settings: result.data, ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
