const router = require("express").Router();
const { getDB } = require("../db");
const { createClient } = require("@supabase/supabase-js");

function nowCST() { return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().replace("Z", "+08:00"); }

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

// GET /api/stickers — list all
router.get("/", async (req, res) => {
  try {
    const db = getDB();
    if (db.stickerList) return res.json({ stickers: db.stickerList() });
    const supabase = getSupabase();
    if (!supabase) return res.json({ stickers: [] });
    const { data, error } = await supabase.from("stickers").select("*").order("created_at", { ascending: false });
    if (error) throw error;
    res.json({ stickers: data || [] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/stickers/upload — upload sticker (base64 in JSON body)
router.post("/upload", async (req, res) => {
  try {
    const { file, tag, description } = req.body;
    if (!file) return res.status(400).json({ error: "缺少图片数据" });
    const supabase = getSupabase();
    if (!supabase) return res.status(500).json({ error: "Supabase 未配置" });

    // Parse base64 data URL
    const matches = file.match(/^data:(image\/[^;]+);base64,(.+)$/);
    if (!matches) return res.status(400).json({ error: "图片格式无效" });
    const [, mimeType, b64] = matches;
    const buffer = Buffer.from(b64, "base64");
    const ext = mimeType.split("/")[1] || "png";
    const filename = "sticker_" + Date.now() + "." + ext;

    // Upload to Supabase Storage
    const { error: uploadErr } = await supabase.storage.from("stickers").upload(filename, buffer, {
      contentType: mimeType,
      upsert: true,
    });
    if (uploadErr) throw uploadErr;

    // Get public URL
    const { data: urlData } = supabase.storage.from("stickers").getPublicUrl(filename);
    const publicUrl = urlData?.publicUrl;

    // Save to DB
    const db = getDB();
    if (db.stickerInsert) {
      const s = db.stickerInsert({ url: publicUrl, tag: tag || "日常", description: description || "" });
      return res.json(s.data);
    }
    const { data, error } = await supabase.from("stickers").insert({
      url: publicUrl, tag: tag || "日常", description: description || "",
    }).select().single();
    if (error) throw error;
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/stickers/random?tag=xxx — random sticker, optional tag filter
router.get("/random", async (req, res) => {
  try {
    const { tag } = req.query;
    const db = getDB();
    if (db.stickerRandom) {
      const s = db.stickerRandom(tag || null);
      return res.json({ sticker: s || null });
    }
    const supabase = getSupabase();
    if (!supabase) return res.json({ sticker: null });
    let query = supabase.from("stickers").select("*");
    if (tag) query = query.eq("tag", tag);
    const { data, error } = await query;
    if (error) throw error;
    if (!data || !data.length) return res.json({ sticker: null });
    const sticker = data[Math.floor(Math.random() * data.length)];
    res.json({ sticker });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/stickers/:id
router.delete("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const db = getDB();
    // Get sticker URL first (for storage cleanup)
    let stickerUrl = null;
    if (db.stickerList) {
      const s = db.stickerList().find(x => x.id === id);
      if (s) stickerUrl = s.url;
      db.stickerDelete(id);
    } else {
      const supabase = getSupabase();
      if (!supabase) return res.json({ ok: true });
      const { data: sticker } = await supabase.from("stickers").select("url").eq("id", id).single();
      if (sticker) {
        stickerUrl = sticker.url;
        // Remove from storage
        const urlParts = sticker.url.split("/");
        const filename = urlParts[urlParts.length - 1];
        await supabase.storage.from("stickers").remove([filename]).catch(() => {});
      }
      await supabase.from("stickers").delete().eq("id", id);
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
