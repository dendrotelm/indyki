// src/routes/users.js
const express = require("express");
const prisma  = require("../lib/prisma");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

// ── GET /api/users/:username ──────────────────────────────────────
router.get("/:username", async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { username: req.params.username },
      select: {
        id: true, username: true, avatar: true,
        bio: true, website: true, role: true, createdAt: true,
        _count: { select: { games: true, downloads: true } },
        games: {
          where: { status: "PUBLISHED" },
          include: {
            tags:        { include: { tag: true } },
            platforms:   true,
            extLinks:    true,
            screenshots: { take: 1, orderBy: { order: "asc" } },
            _count:      { select: { downloads: true } },
          },
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!user) return res.status(404).json({ error: "Użytkownik nie istnieje." });
    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: "Błąd." });
  }
});

// ── PATCH /api/users/me ───────────────────────────────────────────
router.patch("/me", requireAuth, async (req, res) => {
  try {
    const allowed = ["bio", "website"];
    const data = {};
    allowed.forEach(k => { if (req.body[k] !== undefined) data[k] = req.body[k]; });

    const user = await prisma.user.update({
      where: { id: req.user.id },
      data,
      select: { id: true, username: true, email: true, avatar: true, bio: true, website: true, role: true },
    });
    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: "Błąd aktualizacji profilu." });
  }
});

// ── GET /api/users/me/wishlist ────────────────────────────────────
router.get("/me/wishlist", requireAuth, async (req, res) => {
  try {
    const wishlist = await prisma.wishlist.findMany({
      where: { userId: req.user.id },
      include: {
        game: {
          include: {
            author:    { select: { username: true } },
            tags:      { include: { tag: true } },
            platforms: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });
    res.json({ games: wishlist.map(w => w.game) });
  } catch (err) {
    res.status(500).json({ error: "Błąd." });
  }
});

module.exports = router;
