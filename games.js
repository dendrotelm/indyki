// src/routes/games.js
const express = require("express");
const slugify = require("slugify");
const { body, query, validationResult } = require("express-validator");
const prisma = require("../lib/prisma");
const { requireAuth, optionalAuth, requireCreator } = require("../middleware/auth");

const router = express.Router();

// ── GET /api/games ────────────────────────────────────────────────
// Publiczne. Obsługuje wszystkie filtry z browse page.
router.get("/", optionalAuth, async (req, res) => {
  try {
    const {
      search, tags, platforms, price, minRating,
      year, sort = "newest", page = 1, limit = 24,
    } = req.query;

    const where = { status: "PUBLISHED" };

    // Wyszukiwanie po tytule / autorze
    if (search) {
      where.OR = [
        { title: { contains: search, mode: "insensitive" } },
        { author: { username: { contains: search, mode: "insensitive" } } },
      ];
    }

    // Filtr tagów (AND - gra musi mieć wszystkie)
    if (tags) {
      const tagList = tags.split(",").filter(Boolean);
      if (tagList.length) {
        where.tags = {
          some: { tag: { slug: { in: tagList } } },
        };
      }
    }

    // Filtr platform (własne pliki)
    if (platforms) {
      const platList = platforms.split(",").map(p => p.toUpperCase()).filter(Boolean);
      // Filtruje gry które mają plik na daną platformę LUB ext link
      if (platList.length) {
        where.OR = [
          ...(where.OR || []),
          { platforms: { some: { platform: { in: platList } } } },
        ];
      }
    }

    // Cena
    if (price === "free") where.price = 0;
    if (price === "paid") where.price = { gt: 0 };

    // Minimalna ocena - wrócimy gdy dodamy system ocen, na razie pomiń
    // if (minRating) where.rating = { gte: parseFloat(minRating) }

    // Rok
    if (year) {
      const years = year.split(",").map(Number).filter(Boolean);
      if (years.length) {
        where.createdAt = {
          gte: new Date(`${Math.min(...years)}-01-01`),
          lte: new Date(`${Math.max(...years)}-12-31`),
        };
      }
    }

    // Sortowanie
    const orderBy = {
      newest:  { createdAt: "desc" },
      oldest:  { createdAt: "asc" },
      popular: { downloads: { _count: "desc" } },
      title:   { title: "asc" },
    }[sort] || { createdAt: "desc" };

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const take = Math.min(parseInt(limit), 48);

    const [games, total] = await Promise.all([
      prisma.game.findMany({
        where,
        orderBy,
        skip,
        take,
        include: {
          author:      { select: { id: true, username: true, avatar: true } },
          tags:        { include: { tag: { select: { slug: true, name: true } } } },
          platforms:   { select: { platform: true } },
          extLinks:    { select: { platform: true, url: true, price: true, currency: true } },
          screenshots: { select: { url: true, order: true }, orderBy: { order: "asc" }, take: 1 },
          _count:      { select: { downloads: true, wishlist: true } },
        },
      }),
      prisma.game.count({ where }),
    ]);

    res.json({
      games: games.map(formatGame),
      pagination: {
        total,
        page: parseInt(page),
        limit: take,
        pages: Math.ceil(total / take),
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Błąd pobierania gier." });
  }
});

// ── GET /api/games/featured ───────────────────────────────────────
router.get("/featured", async (req, res) => {
  try {
    const game = await prisma.game.findFirst({
      where: { status: "PUBLISHED", featured: true },
      include: {
        author:    { select: { id: true, username: true, avatar: true } },
        tags:      { include: { tag: true } },
        platforms: true,
        extLinks:  true,
        _count:    { select: { downloads: true } },
      },
      orderBy: { updatedAt: "desc" },
    });
    res.json({ game: game ? formatGame(game) : null });
  } catch (err) {
    res.status(500).json({ error: "Błąd." });
  }
});

// ── GET /api/games/:slug ──────────────────────────────────────────
router.get("/:slug", optionalAuth, async (req, res) => {
  try {
    const game = await prisma.game.findUnique({
      where: { slug: req.params.slug },
      include: {
        author:      { select: { id: true, username: true, avatar: true, bio: true } },
        tags:        { include: { tag: true } },
        platforms:   true,
        extLinks:    true,
        files:       true,
        screenshots: { orderBy: { order: "asc" } },
        _count:      { select: { downloads: true, wishlist: true, purchases: true } },
      },
    });

    if (!game || game.status === "REMOVED") {
      return res.status(404).json({ error: "Gra nie istnieje." });
    }
    if (game.status === "DRAFT" && game.authorId !== req.user?.id) {
      return res.status(404).json({ error: "Gra nie istnieje." });
    }

    res.json({ game: formatGame(game) });
  } catch (err) {
    res.status(500).json({ error: "Błąd." });
  }
});

// ── POST /api/games ───────────────────────────────────────────────
router.post("/", requireAuth, requireCreator, [
  body("title").trim().isLength({ min: 1, max: 100 }),
  body("description").trim().isLength({ min: 10 }),
  body("price").optional().isFloat({ min: 0 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { title, tagline, description, price = 0, version, tags = [], extLinks = [] } = req.body;

  try {
    // Generuj unikalny slug
    let slug = slugify(title, { lower: true, strict: true });
    const existing = await prisma.game.findUnique({ where: { slug } });
    if (existing) slug = slug + "-" + Date.now().toString(36);

    const game = await prisma.game.create({
      data: {
        title,
        slug,
        tagline,
        description,
        price: parseFloat(price),
        version: version || "1.0.0",
        authorId: req.user.id,
        status: "DRAFT",
        // Tagi - utwórz jeśli nie istnieją
        tags: {
          create: tags.map(tagSlug => ({
            tag: {
              connectOrCreate: {
                where:  { slug: tagSlug },
                create: { slug: tagSlug, name: tagSlug },
              },
            },
          })),
        },
        // Zewnętrzne linki
        extLinks: {
          create: extLinks.map(l => ({
            platform: l.platform,
            url:      l.url,
            price:    l.price ? parseFloat(l.price) : null,
            currency: l.currency || "PLN",
          })),
        },
      },
      include: {
        tags:     { include: { tag: true } },
        extLinks: true,
      },
    });

    res.status(201).json({ game: formatGame(game) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Błąd tworzenia gry." });
  }
});

// ── PATCH /api/games/:slug ────────────────────────────────────────
router.patch("/:slug", requireAuth, async (req, res) => {
  try {
    const game = await prisma.game.findUnique({ where: { slug: req.params.slug } });
    if (!game) return res.status(404).json({ error: "Nie znaleziono." });
    if (game.authorId !== req.user.id && req.user.role !== "ADMIN") {
      return res.status(403).json({ error: "Brak uprawnień." });
    }

    const allowed = ["title", "tagline", "description", "price", "version",
                     "status", "coverImage", "trailerUrl", "presskit"];
    const data = {};
    allowed.forEach(k => { if (req.body[k] !== undefined) data[k] = req.body[k]; });

    const updated = await prisma.game.update({
      where: { slug: req.params.slug },
      data,
    });
    res.json({ game: formatGame(updated) });
  } catch (err) {
    res.status(500).json({ error: "Błąd aktualizacji." });
  }
});

// ── POST /api/games/:slug/publish ─────────────────────────────────
router.post("/:slug/publish", requireAuth, async (req, res) => {
  try {
    const game = await prisma.game.findUnique({ where: { slug: req.params.slug } });
    if (!game) return res.status(404).json({ error: "Nie znaleziono." });
    if (game.authorId !== req.user.id) return res.status(403).json({ error: "Brak uprawnień." });

    const updated = await prisma.game.update({
      where: { slug: req.params.slug },
      data: { status: "PUBLISHED" },
    });
    res.json({ game: formatGame(updated), message: "Gra opublikowana!" });
  } catch (err) {
    res.status(500).json({ error: "Błąd." });
  }
});

// ── POST /api/games/:slug/wishlist ────────────────────────────────
router.post("/:slug/wishlist", requireAuth, async (req, res) => {
  try {
    const game = await prisma.game.findUnique({ where: { slug: req.params.slug } });
    if (!game) return res.status(404).json({ error: "Nie znaleziono." });

    const exists = await prisma.wishlist.findUnique({
      where: { userId_gameId: { userId: req.user.id, gameId: game.id } },
    });

    if (exists) {
      await prisma.wishlist.delete({
        where: { userId_gameId: { userId: req.user.id, gameId: game.id } },
      });
      res.json({ wishlisted: false });
    } else {
      await prisma.wishlist.create({ data: { userId: req.user.id, gameId: game.id } });
      res.json({ wishlisted: true });
    }
  } catch (err) {
    res.status(500).json({ error: "Błąd." });
  }
});

// ── Helper ────────────────────────────────────────────────────────
function formatGame(g) {
  return {
    id:           g.id,
    slug:         g.slug,
    title:        g.title,
    tagline:      g.tagline,
    description:  g.description,
    price:        g.price,
    currency:     g.currency,
    version:      g.version,
    status:       g.status,
    featured:     g.featured,
    coverImage:   g.coverImage,
    trailerUrl:   g.trailerUrl,
    presskit:     g.presskit,
    createdAt:    g.createdAt,
    author:       g.author,
    tags:         g.tags?.map(t => t.tag) || [],
    platforms:    g.platforms?.map(p => p.platform) || [],
    extLinks:     g.extLinks || [],
    files:        g.files || [],
    screenshots:  g.screenshots || [],
    downloads:    g._count?.downloads || 0,
    wishlists:    g._count?.wishlist || 0,
  };
}

module.exports = router;
