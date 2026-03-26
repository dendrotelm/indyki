// src/routes/forum.js
const express = require("express");
const slugify = require("slugify");
const prisma  = require("../lib/prisma");
const { requireAuth, requireAdmin } = require("../middleware/auth");

const router = express.Router();

// ── GET /api/forum/categories ─────────────────────────────────────
router.get("/categories", async (req, res) => {
  try {
    const categories = await prisma.forumCategory.findMany({
      orderBy: { order: "asc" },
      include: {
        _count: { select: { threads: true } },
        threads: {
          take: 1,
          orderBy: { updatedAt: "desc" },
          include: { author: { select: { username: true } } },
        },
      },
    });
    res.json({ categories });
  } catch (err) {
    res.status(500).json({ error: "Błąd." });
  }
});

// ── GET /api/forum/categories/:slug/threads ───────────────────────
router.get("/categories/:slug/threads", async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const cat = await prisma.forumCategory.findUnique({ where: { slug: req.params.slug } });
    if (!cat) return res.status(404).json({ error: "Nie znaleziono." });

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [threads, total] = await Promise.all([
      prisma.forumThread.findMany({
        where: { categoryId: cat.id },
        orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
        skip,
        take: parseInt(limit),
        include: {
          author:  { select: { id: true, username: true, avatar: true } },
          _count:  { select: { posts: true } },
        },
      }),
      prisma.forumThread.count({ where: { categoryId: cat.id } }),
    ]);

    res.json({ category: cat, threads, total });
  } catch (err) {
    res.status(500).json({ error: "Błąd." });
  }
});

// ── GET /api/forum/threads/:slug ──────────────────────────────────
router.get("/threads/:slug", async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const thread = await prisma.forumThread.findUnique({
      where:   { slug: req.params.slug },
      include: { author: { select: { id: true, username: true, avatar: true } }, category: true },
    });
    if (!thread) return res.status(404).json({ error: "Nie znaleziono." });

    // Zwiększ licznik wyświetleń
    await prisma.forumThread.update({ where: { id: thread.id }, data: { views: { increment: 1 } } });

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [posts, total] = await Promise.all([
      prisma.forumPost.findMany({
        where:   { threadId: thread.id },
        orderBy: { createdAt: "asc" },
        skip,
        take: parseInt(limit),
        include: { author: { select: { id: true, username: true, avatar: true, role: true } } },
      }),
      prisma.forumPost.count({ where: { threadId: thread.id } }),
    ]);

    res.json({ thread, posts, total });
  } catch (err) {
    res.status(500).json({ error: "Błąd." });
  }
});

// ── POST /api/forum/categories/:slug/threads ──────────────────────
router.post("/categories/:slug/threads", requireAuth, async (req, res) => {
  try {
    const { title, content } = req.body;
    if (!title?.trim() || !content?.trim()) {
      return res.status(400).json({ error: "Tytuł i treść są wymagane." });
    }

    const cat = await prisma.forumCategory.findUnique({ where: { slug: req.params.slug } });
    if (!cat) return res.status(404).json({ error: "Nie znaleziono kategorii." });

    let slug = slugify(title, { lower: true, strict: true });
    const exists = await prisma.forumThread.findUnique({ where: { slug } });
    if (exists) slug = slug + "-" + Date.now().toString(36);

    const thread = await prisma.forumThread.create({
      data: {
        title,
        slug,
        categoryId: cat.id,
        authorId:   req.user.id,
        posts: {
          create: { content: content.trim(), authorId: req.user.id },
        },
      },
      include: {
        author: { select: { id: true, username: true, avatar: true } },
        _count:  { select: { posts: true } },
      },
    });

    res.status(201).json({ thread });
  } catch (err) {
    res.status(500).json({ error: "Błąd tworzenia wątku." });
  }
});

// ── POST /api/forum/threads/:slug/posts ───────────────────────────
router.post("/threads/:slug/posts", requireAuth, async (req, res) => {
  try {
    const { content } = req.body;
    if (!content?.trim()) return res.status(400).json({ error: "Treść jest wymagana." });

    const thread = await prisma.forumThread.findUnique({ where: { slug: req.params.slug } });
    if (!thread) return res.status(404).json({ error: "Nie znaleziono wątku." });
    if (thread.locked) return res.status(403).json({ error: "Wątek jest zablokowany." });

    const post = await prisma.forumPost.create({
      data: { content: content.trim(), threadId: thread.id, authorId: req.user.id },
      include: { author: { select: { id: true, username: true, avatar: true, role: true } } },
    });

    // Aktualizuj updatedAt wątku (dla sortowania)
    await prisma.forumThread.update({ where: { id: thread.id }, data: { updatedAt: new Date() } });

    res.status(201).json({ post });
  } catch (err) {
    res.status(500).json({ error: "Błąd dodawania posta." });
  }
});

module.exports = router;
