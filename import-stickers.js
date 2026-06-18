/**
 * 批量导入表情包脚本
 * 用法: node import-stickers.js <文件夹路径> [--tag=标签] [--dry]
 *
 * 示例:
 *   node import-stickers.js C:\Users\Admin\Desktop\表情包
 *   node import-stickers.js C:\Users\Admin\Pictures\cats --tag=撒娇
 *   node import-stickers.js ./stickers --dry    （只预览不上传）
 */

require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const path = require("path");
const readline = require("readline");

// ─── 参数解析 ───
const args = process.argv.slice(2);
let folderPath = null;
let tag = "日常";
let dryRun = false;
let skipConfirm = false;

for (const arg of args) {
  if (arg.startsWith("--tag=")) tag = arg.slice(6);
  else if (arg === "--dry") dryRun = true;
  else if (arg === "--yes" || arg === "-y") skipConfirm = true;
  else folderPath = arg;
}

if (!folderPath) {
  console.log("用法: node import-stickers.js <文件夹路径> [--tag=标签] [--dry]");
  console.log('示例: node import-stickers.js C:\\Users\\Admin\\Desktop\\表情包 --tag=日常');
  process.exit(1);
}

const absPath = path.resolve(folderPath);
if (!fs.existsSync(absPath) || !fs.statSync(absPath).isDirectory()) {
  console.error("❌ 文件夹不存在或不是目录:", absPath);
  process.exit(1);
}

// ─── Supabase 连接 ───
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("❌ 请在 .env 中设置 SUPABASE_URL 和 SUPABASE_KEY");
  console.error("   SUPABASE_URL=https://xxx.supabase.co");
  console.error("   SUPABASE_KEY=sb_secret_xxx  (service_role key)");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
});

// ─── 扫描图片 ───
const IMAGE_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".ico", ".tiff",
]);

function scanImages(dir, baseDir) {
  const files = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...scanImages(fullPath, baseDir || dir));
    } else if (IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      // 从子文件夹名提取标签：去掉路径前缀，取第一级子目录名
      const relPath = path.relative(baseDir || dir, fullPath);
      const parts = relPath.split(path.sep);
      // 如果在子文件夹里（parts.length > 1），用第一级子目录名做标签
      const autoTag = parts.length > 1 ? parts[0] : null;
      files.push({ filePath: fullPath, tag: autoTag });
    }
  }
  return files;
}

const imageFiles = scanImages(absPath);
console.log("📁 文件夹:", absPath);
console.log("🖼️  找到", imageFiles.length, "张图片");
console.log("🏷️  默认标签:", tag);
if (dryRun) console.log("🔍 DRY RUN — 只预览不上传");
console.log("");

if (imageFiles.length === 0) {
  console.log("没有找到图片文件。");
  process.exit(0);
}

// ─── 确认 ───
if (dryRun) {
  // 预览模式：直接展示，不询问
  console.log("");
  console.log("─── 预览（DRY RUN）───");
  const results = { ok: 0, fail: 0, skipped: 0 };
  for (let i = 0; i < imageFiles.length; i++) {
    const { filePath, tag: autoTag } = imageFiles[i];
    const effectiveTag = autoTag || tag;
    const ext = path.extname(filePath).toLowerCase();
    const basename = path.basename(filePath, ext);
    let safeName = basename.replace(/[^\x00-\x7F]/g, "").replace(/[^a-zA-Z0-9_-]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
    if (!safeName || safeName.length < 1) safeName = "img_" + (i + 1);
    const filename = "sticker_" + safeName + ext;
    const prefix = `[${i + 1}/${imageFiles.length}]`;
    console.log(`${prefix} 🔍 ${path.basename(filePath)} → 标签: ${effectiveTag}  描述: ${basename.slice(0, 40)}`);
    results.ok++;
  }
  console.log(`\n✅ 预览完成: ${results.ok} 张图片，标签已按子文件夹自动分类`);
  process.exit(0);
}

if (imageFiles.length > 50) {
  console.log("⚠️  图片超过 50 张，批量上传可能需要一些时间。");
}

async function doUpload() {
  console.log("");
  console.log("─── 开始上传 ───");
  const results = { ok: 0, fail: 0, skipped: 0 };
  const startTime = Date.now();

  for (let i = 0; i < imageFiles.length; i++) {
    const { filePath, tag: autoTag } = imageFiles[i];
    const effectiveTag = autoTag || tag;  // 子文件夹标签优先，否则用默认标签
    const ext = path.extname(filePath).toLowerCase();
    const basename = path.basename(filePath, ext);
    let safeName = basename.replace(/[^\x00-\x7F]/g, "").replace(/[^a-zA-Z0-9_-]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
    if (!safeName || safeName.length < 1) safeName = "img_" + (i + 1);
    const filename = "sticker_" + safeName + ext;

    // 从文件名提取描述（去掉扩展名，保留中文/英文）
    const autoDesc = basename.slice(0, 100) || "无描述";

    const prefix = `[${i + 1}/${imageFiles.length}]`;

    if (dryRun) {
      console.log(`${prefix} 🔍 ${path.basename(filePath)} → ${filename}  标签: ${effectiveTag}  描述: ${autoDesc}`);
      results.ok++;
      continue;
    }

    try {
      const fileBuffer = fs.readFileSync(filePath);
      const mimeMap = {
        ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
        ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml",
        ".bmp": "image/bmp", ".ico": "image/x-icon", ".tiff": "image/tiff",
      };
      const contentType = mimeMap[ext] || "image/png";

      // 1. 上传到 Storage
      const { error: uploadErr } = await supabase.storage
        .from("stickers")
        .upload(filename, fileBuffer, { contentType, upsert: true });

      if (uploadErr) {
        console.error(`${prefix} ❌ 上传失败: ${path.basename(filePath)} — ${uploadErr.message}`);
        results.fail++;
        continue;
      }

      // 2. 获取 public URL
      const { data: urlData } = supabase.storage.from("stickers").getPublicUrl(filename);
      const publicUrl = urlData?.publicUrl;

      // 3. 写入 stickers 表
      const { error: insertErr } = await supabase
        .from("stickers")
        .insert({ url: publicUrl, tag: effectiveTag, description: autoDesc });

      if (insertErr) {
        console.error(`${prefix} ❌ 写入表失败: ${path.basename(filePath)} — ${insertErr.message}`);
        results.fail++;
        continue;
      }

      console.log(`${prefix} ✅ ${path.basename(filePath)} → ${effectiveTag} "${autoDesc}"`);
      results.ok++;
    } catch (e) {
      console.error(`${prefix} ❌ ${path.basename(filePath)} — ${e.message}`);
      results.fail++;
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log("");
  console.log("─── 完成 ───");
  console.log(`✅ 成功: ${results.ok}  ❌ 失败: ${results.fail}  ⏭️ 跳过: ${results.skipped}`);
  console.log(`⏱️ 耗时: ${elapsed}s`);
  process.exit(0);
}

if (skipConfirm) {
  doUpload();
} else {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question("开始上传? (y/n) ", (answer) => {
    rl.close();
    if (answer.toLowerCase() !== "y") {
      console.log("已取消。");
      process.exit(0);
    }
    doUpload();
  });
}
