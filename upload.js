// src/routes/upload.js
const express = require("express");
const multer  = require("multer");
const multerS3 = require("multer-s3");
const { S3Client, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const { v4: uuid } = require("uuid");
const path   = require("path");
const prisma = require("../lib/prisma");
const { requireAuth, requireCreator } = require("../middleware/auth");

const router = express.Router();

// ── Klient R2 (kompatybilny z S3) ────────────────────────────────
const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId:     process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

// ── Upload pliku gry ──────────────────────────────────────────────
const gameUpload = multer({
  storage: multerS3({
    s3:      r2,
    bucket:  process.env.R2_BUCKET_NAME,
    key: (req, file, cb) => {
      const ext  = path.extname(file.originalname);
      const name = `games/${req.params.gameSlug}/${uuid()}${ext}`;
      cb(null, name);
    },
  }),
  limits: { fileSize: 1024 * 1024 * 1024 }, // 1 GB
  fileFilter: (req, file, cb) => {
    const allowed = [".zip", ".rar", ".7z", ".exe", ".dmg", ".apk", ".tar.gz", ".x86_64"];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) return cb(null, true);
    cb(new Error("Niedozwolony format pliku."));
  },
});

// ── Upload okładki / screenshotów ─────────────────────────────────
const imageUpload = multer({
  storage: multerS3({
    s3:      r2,
    bucket:  process.env.R2_BUCKET_NAME,
    key: (req, file, cb) => {
      const ext  = path.extname(file.originalname);
      const name = `images/${req.params.gameSlug}/${uuid()}${ext}`;
      cb(null, name);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) return cb(null, true);
    cb(new Error("Tylko pliki obrazów."));
  },
});

// ── POST /api/upload/game/:gameSlug/file ──────────────────────────
router.post("/game/:gameSlug/file", requireAuth, requireCreator,
  gameUpload.single("file"),
  async (req, res) => {
    try {
      const game = await prisma.game.findUnique({ where: { slug: req.params.gameSlug } });
      if (!game) return res.status(404).json({ error: "Gra nie istnieje." });
      if (game.authorId !== req.user.id) return res.status(403).json({ error: "Brak uprawnień." });
      if (!req.file) return res.status(400).json({ error: "Brak pliku." });

      const { platform, version } = req.body;

      // Usuń stary plik tej samej platformy jeśli istnieje
      const existing = await prisma.gameFile.findFirst({
        where: { gameId: game.id, platform: platform?.toUpperCase() },
      });
      if (existing) {
        const key = existing.fileUrl.replace(process.env.R2_PUBLIC_URL + "/", "");
        await r2.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key }));
        await prisma.gameFile.delete({ where: { id: existing.id } });
      }

      const fileUrl = `${process.env.R2_PUBLIC_URL}/${req.file.key}`;

      const gameFile = await prisma.gameFile.create({
        data: {
          gameId:   game.id,
          platform: platform?.toUpperCase() || "WIN",
          filename: req.file.originalname,
          fileUrl,
          fileSize: BigInt(req.file.size),
          version:  version || game.version,
        },
      });

      // Dodaj platformę do game jeśli nie ma
      await prisma.gamePlatform.upsert({
        where: { gameId_platform: { gameId: game.id, platform: platform?.toUpperCase() || "WIN" } },
        create: { gameId: game.id, platform: platform?.toUpperCase() || "WIN" },
        update: {},
      });

      res.json({
        file: {
          ...gameFile,
          fileSize: gameFile.fileSize.toString(), // BigInt → string dla JSON
        },
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Błąd uploadu: " + err.message });
    }
  }
);

// ── POST /api/upload/game/:gameSlug/cover ─────────────────────────
router.post("/game/:gameSlug/cover", requireAuth, requireCreator,
  imageUpload.single("cover"),
  async (req, res) => {
    try {
      const game = await prisma.game.findUnique({ where: { slug: req.params.gameSlug } });
      if (!game) return res.status(404).json({ error: "Gra nie istnieje." });
      if (game.authorId !== req.user.id) return res.status(403).json({ error: "Brak uprawnień." });
      if (!req.file) return res.status(400).json({ error: "Brak pliku." });

      const coverImage = `${process.env.R2_PUBLIC_URL}/${req.file.key}`;
      await prisma.game.update({ where: { id: game.id }, data: { coverImage } });
      res.json({ coverImage });
    } catch (err) {
      res.status(500).json({ error: "Błąd uploadu okładki." });
    }
  }
);

// ── POST /api/upload/game/:gameSlug/screenshots ───────────────────
router.post("/game/:gameSlug/screenshots", requireAuth, requireCreator,
  imageUpload.array("screenshots", 8),
  async (req, res) => {
    try {
      const game = await prisma.game.findUnique({ where: { slug: req.params.gameSlug } });
      if (!game) return res.status(404).json({ error: "Gra nie istnieje." });
      if (game.authorId !== req.user.id) return res.status(403).json({ error: "Brak uprawnień." });
      if (!req.files?.length) return res.status(400).json({ error: "Brak plików." });

      const existing = await prisma.screenshot.count({ where: { gameId: game.id } });

      const screenshots = await prisma.screenshot.createMany({
        data: req.files.map((f, i) => ({
          gameId: game.id,
          url:    `${process.env.R2_PUBLIC_URL}/${f.key}`,
          order:  existing + i,
        })),
      });
      res.json({ uploaded: screenshots.count });
    } catch (err) {
      res.status(500).json({ error: "Błąd uploadu screenshotów." });
    }
  }
);

// ── POST /api/upload/avatar ───────────────────────────────────────
const avatarUpload = multer({
  storage: multerS3({
    s3:     r2,
    bucket: process.env.R2_BUCKET_NAME,
    key:    (req, file, cb) => cb(null, `avatars/${req.user.id}/${uuid()}${path.extname(file.originalname)}`),
  }),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => file.mimetype.startsWith("image/") ? cb(null, true) : cb(new Error("Tylko obrazy.")),
});

router.post("/avatar", requireAuth, avatarUpload.single("avatar"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Brak pliku." });
    const avatar = `${process.env.R2_PUBLIC_URL}/${req.file.key}`;
    await prisma.user.update({ where: { id: req.user.id }, data: { avatar } });
    res.json({ avatar });
  } catch (err) {
    res.status(500).json({ error: "Błąd uploadu avatara." });
  }
});

// ── Error handler dla multer ──────────────────────────────────────
router.use((err, req, res, next) => {
  if (err.code === "LIMIT_FILE_SIZE") {
    return res.status(400).json({ error: "Plik za duży." });
  }
  res.status(400).json({ error: err.message });
});

module.exports = router;
