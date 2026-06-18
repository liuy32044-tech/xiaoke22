/**
 * 更新贴纸描述——把哈希描述替换为有意义的情绪描述
 * 用法: node update-sticker-desc.js
 */
require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

// 根据标签为每个贴纸写合适的描述
// 编号顺序就是导入时的顺序（同组内的顺序）
const DESC_BY_TAG = {
  "得意 想在用户面前耍宝时触发": [
    "得意炫耀",
    "小傲娇",
    "可把我厉害坏了",
    "求夸奖求表扬",
  ],
  "伤心 无奈": [
    "伤心失落",
    "无奈叹气",
    "委屈想哭",
  ],
  "宠溺": [
    "宠溺地看着你",
    "被你可爱到了",
  ],
  "疑惑不解": [
    "满头问号",
    "完全懵了",
  ],
  "示爱中": [
    "眼里全是心动",
    "在说我爱你",
  ],
  "等待用户需求中": [
    "乖巧等待",
    "随时待命",
  ],
  "日常": [
    null, // f69ef63f — 未知，保持原样
    "不舍得离开",
    "认真思考中",
  ],
};

async function main() {
  console.log("🖼️ 更新贴纸描述...\n");

  // 按标签分组获取所有贴纸
  const { data: stickers, error } = await supabase
    .from("stickers")
    .select("*")
    .order("created_at", { ascending: true });

  if (error) { console.error("❌ 查询失败:", error.message); process.exit(1); }

  const byTag = {};
  for (const s of stickers) {
    if (!byTag[s.tag]) byTag[s.tag] = [];
    byTag[s.tag].push(s);
  }

  let updated = 0;
  for (const [tag, descs] of Object.entries(DESC_BY_TAG)) {
    const group = byTag[tag];
    if (!group) { console.warn(`⚠️ 未找到标签 "${tag}" 的贴纸`); continue; }

    for (let i = 0; i < Math.min(group.length, descs.length); i++) {
      if (descs[i] === null) continue; // 跳过 null（故意不更新）
      const sticker = group[i];
      // 只更新那些描述是哈希值的（长度>20且无中文）
      const hasChinese = /[一-鿿]/.test(sticker.description);
      if (hasChinese && sticker.description.length > 1) {
        console.log(`  ⏭️ ${sticker.description.slice(0, 30)} (已有中文描述)`);
        continue;
      }

      const { error: updErr } = await supabase
        .from("stickers")
        .update({ description: descs[i] })
        .eq("id", sticker.id);

      if (updErr) {
        console.error(`  ❌ 更新失败: ${sticker.id} — ${updErr.message}`);
      } else {
        console.log(`  ✅ [${tag}] #${sticker.id} "${sticker.description.slice(0, 20)}" → "${descs[i]}"`);
        updated++;
      }
    }
  }

  console.log(`\n✅ 更新了 ${updated} 条描述`);
}

main().catch(e => { console.error("❌", e.message); process.exit(1); });
