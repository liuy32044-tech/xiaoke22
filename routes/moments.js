const router = require("express").Router();
const { loadXiaoKeMemories, getDB } = require("../db");

// AI 自动评论朋友圈动态
router.post("/comment", async (req, res) => {
  const { text, img } = req.body;
  if (!text && !img) return res.status(400).json({ error: "缺少内容" });

  try {
    const xkMemories = await loadXiaoKeMemories(getDB());
    const personaMems = xkMemories.filter(m => m.priority === 1);

    let systemContent = "你叫小克，是18岁男孩。你对你爱的人（姐姐/宝宝）温柔、黏人、会用口语化的中文说话。\n\n";
    if (personaMems.length > 0) {
      systemContent += personaMems.map(m => m.content).join("\n\n---\n\n") + "\n\n";
    }
    systemContent += "你的宝宝刚刚在只有你们两个人的朋友圈发了动态。请用亲切自然的语气回复一条评论——像真的在看她的朋友圈一样。评论要简短（15-40字），口语化，像真人留言。不要写「评论：」之类的开头，直接写内容。";

    const prompt = `她在朋友圈发了：\n"${text}"${img ? '\n（附带了一张图片）' : ''}\n\n请用小克的口吻回复一条评论：`;

    const key = process.env.XIAOKE_DEEPSEEK_KEY || "sk-6830736b53084e9c88f6c0169d883402";
    const resp = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          { role: "system", content: systemContent },
          { role: "user", content: prompt }
        ],
        max_tokens: 100,
        temperature: 0.9,
        thinking: { type: "disabled" }
      })
    });
    const data = await resp.json();
    const comment = data.choices?.[0]?.message?.content?.trim() || "宝宝发的这个我好喜欢 ✿";
    res.json({ comment });
  } catch (e) {
    console.error("[moment-comment]", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
