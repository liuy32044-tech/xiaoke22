require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

// Routes
app.use("/api/sessions", require("../routes/sessions"));
app.use("/api/messages", require("../routes/messages"));
app.use("/api/chat", require("../routes/chat"));
app.use("/api/settings", require("../routes/settings"));
app.use("/api/memories", require("../routes/memories"));
app.use("/api/posts", require("../routes/posts"));
app.use("/api/stickers", require("../routes/stickers"));

module.exports = app;
