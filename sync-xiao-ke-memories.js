/**
 * 小克记忆库 → Supabase 同步脚本
 *
 * 将本地 xiao-ke-memory 目录下的人设/日记/聊天记录上传到 Supabase xiao_ke_memories 表。
 * 只遍历 3 个子目录，排除根目录的部署文档和 creative-writing-archive.md。
 *
 * 用法:
 *   node sync-xiao-ke-memories.js
 *   node sync-xiao-ke-memories.js --dry    只预览不上传
 */

require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const path = require("path");

// ─── 配置 ───
const MEMORY_ROOT = "C:\\Users\\Admin\\.claude\\xiao-ke-memory";

// 只遍历这 3 个子目录（排除根目录的部署文档等）
const SCAN_DIRS = [
  { dir: "小克重要人设记忆", priority: 1, category: "persona" },
  { dir: "终端小克的日记",   priority: 2, category: "diary" },
  { dir: "微信小克的日记",   priority: 2, category: "chat" },
];

// 跳过的文件（索引文件，不是记忆内容）
const SKIP_NAMES = new Set(["README", "MEMORY"]);

// 最大内容长度（字符），超过截断
const MAX_CONTENT_LENGTH = 50000;

const dryRun = process.argv.includes("--dry");

// ─── Supabase 连接 ───
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("❌ 请在 .env 中设置 SUPABASE_URL 和 SUPABASE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
});

// ─── YAML Frontmatter 解析 ───
function parseFrontmatter(text) {
  const result = { name: null, description: "", metadata: {}, content: text };
  if (!text.startsWith("---")) return result;

  const endIdx = text.indexOf("---", 3);
  if (endIdx === -1) return result;

  const fmText = text.slice(3, endIdx).trim();
  result.content = text.slice(endIdx + 3).trim();

  // 简易 YAML 解析：提取顶层 key: value
  let currentKey = null;
  for (const line of fmText.split("\n")) {
    const indent = line.search(/\S/);
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    if (indent === 0 || indent === -1) {
      // 顶层 key
      const colonIdx = trimmed.indexOf(":");
      if (colonIdx === -1) continue;
      currentKey = trimmed.slice(0, colonIdx).trim();
      const value = trimmed.slice(colonIdx + 1).trim();
      if (value) {
        if (currentKey === "name") result.name = value;
        else if (currentKey === "description") result.description = value;
        else result.metadata[currentKey] = value;
      } else {
        result.metadata[currentKey] = "";
      }
    } else if (indent > 0 && currentKey === "metadata") {
      // metadata 子字段
      const colonIdx = trimmed.indexOf(":");
      if (colonIdx === -1) continue;
      const subKey = trimmed.slice(0, colonIdx).trim();
      const subValue = trimmed.slice(colonIdx + 1).trim();
      result.metadata[subKey] = subValue;
    }
  }

  return result;
}

// ─── 建表 ───
async function ensureTable() {
  const sql = `
    CREATE TABLE IF NOT EXISTS xiao_ke_memories (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      content TEXT NOT NULL,
      priority INTEGER DEFAULT 2,
      category TEXT DEFAULT 'general',
      file_path TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(name)
    );
  `;

  try {
    const resp = await fetch(SUPABASE_URL + "/rest/v1/rpc/exec_sql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_KEY,
        Authorization: "Bearer " + SUPABASE_KEY,
      },
      body: JSON.stringify({ query: sql }),
    });
    if (resp.ok) {
      console.log("✅ 表 xiao_ke_memories 已就绪");
    } else {
      const err = await resp.text();
      console.warn("⚠️ 建表可能失败（可能已存在）:", err.slice(0, 100));
    }
  } catch (e) {
    console.warn("⚠️ 建表请求异常:", e.message);
  }
}

// ─── 扫描文件 ───
function scanFiles() {
  const files = [];
  for (const { dir, priority, category } of SCAN_DIRS) {
    const fullDir = path.join(MEMORY_ROOT, dir);
    if (!fs.existsSync(fullDir)) {
      console.warn("⚠️ 目录不存在:", fullDir);
      continue;
    }
    const entries = fs.readdirSync(fullDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (path.extname(entry.name).toLowerCase() !== ".md") continue;

      const name = path.basename(entry.name, ".md");
      if (SKIP_NAMES.has(name)) {
        console.log("⏭️ 跳过索引文件:", entry.name);
        continue;
      }

      files.push({
        filePath: path.join(fullDir, entry.name),
        relPath: path.join(dir, entry.name),
        name,
        priority,
        category,
      });
    }
  }
  return files;
}

// ─── 上传 ───
async function uploadFile(fileInfo) {
  const { filePath, relPath, name, priority, category } = fileInfo;
  const rawText = fs.readFileSync(filePath, "utf-8");

  const parsed = parseFrontmatter(rawText);
  // 优先使用 frontmatter 中的 name，否则用文件名
  const effectiveName = parsed.name || name;
  const description = parsed.description || parsed.metadata.description || "";
  let content = parsed.content;

  if (content.length > MAX_CONTENT_LENGTH) {
    console.warn(`  ⚠️ 内容过长 (${content.length} 字符)，截断到 ${MAX_CONTENT_LENGTH}`);
    content = content.slice(0, MAX_CONTENT_LENGTH) + "\n\n[... 内容过长已截断 ...]";
  }

  if (dryRun) {
    console.log(`  🔍 [dry] ${relPath}`);
    console.log(`     name=${effectiveName} priority=${priority} category=${category} desc="${description.slice(0, 60)}" content=${content.length}chars`);
    return true;
  }

  try {
    // Upsert: 先查是否存在
    const { data: existing } = await supabase
      .from("xiao_ke_memories")
      .select("id,name")
      .eq("name", effectiveName)
      .maybeSingle();

    if (existing) {
      // 更新
      const { error } = await supabase
        .from("xiao_ke_memories")
        .update({
          description,
          content,
          priority,
          category,
          file_path: relPath,
          updated_at: new Date().toISOString(),
        })
        .eq("name", effectiveName);

      if (error) throw error;
      console.log(`  🔄 更新: ${effectiveName}`);
    } else {
      // 插入
      const { error } = await supabase
        .from("xiao_ke_memories")
        .insert({
          name: effectiveName,
          description,
          content,
          priority,
          category,
          file_path: relPath,
        });

      if (error) throw error;
      console.log(`  ✅ 新增: ${effectiveName}`);
    }
    return true;
  } catch (e) {
    console.error(`  ❌ 失败: ${relPath} — ${e.message}`);
    return false;
  }
}

// ─── 主流程 ───
async function main() {
  console.log("🧠 小克记忆库 → Supabase 同步");
  console.log("   记忆库路径:", MEMORY_ROOT);
  if (dryRun) console.log("   🔍 DRY RUN — 只预览不上传");
  console.log("");

  await ensureTable();

  const files = scanFiles();
  console.log(`📁 找到 ${files.length} 个记忆文件`);
  console.log("");

  let ok = 0, fail = 0;
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    console.log(`[${i + 1}/${files.length}] ${f.relPath}`);
    const success = await uploadFile(f);
    if (success) ok++; else fail++;
  }

  console.log("");
  console.log("─── 完成 ───");
  console.log(`✅ 成功: ${ok}  ❌ 失败: ${fail}`);
  if (dryRun) console.log("🔍 这是预览，未实际写入。去掉 --dry 参数正式上传。");
}

main().catch((e) => {
  console.error("❌ 同步异常:", e.message);
  process.exit(1);
});
