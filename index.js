// src/index.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const authRoutes   = require("./routes/auth");
const gamesRoutes  = require("./routes/games");
const uploadRoutes = require("./routes/upload");
const forumRoutes  = require("./routes/forum");
const usersRoutes  = require("./routes/users");

const app = express();

// ── Security ──────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || "http://localhost:5173",
  credentials: true,
}));

// ── Rate limiting ─────────────────────────────────────────────────
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 200,
  message: { error: "Za dużo zapytań, spróbuj za chwilę." },
});
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: "Za dużo prób logowania." },
});

app.use(limiter);
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// ── Routes ────────────────────────────────────────────────────────
app.use("/api/auth",   authLimiter, authRoutes);
app.use("/api/games",  gamesRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/forum",  forumRoutes);
app.use("/api/users",  usersRoutes);

// ── Health check ─────────────────────────────────────────────────
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", env: process.env.NODE_ENV });
});

// ── 404 ───────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: "Nie znaleziono endpointu." });
});

// ── Error handler ─────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === "production"
      ? "Błąd serwera."
      : err.message,
  });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🦃 indyki.qzz.io backend na porcie ${PORT}`);
});
