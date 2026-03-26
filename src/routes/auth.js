// src/routes/auth.js
const express = require("express");
const bcrypt  = require("bcryptjs");
const jwt     = require("jsonwebtoken");
const { body, validationResult } = require("express-validator");
const prisma  = require("../lib/prisma");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

function makeToken(userId) {
  return jwt.sign(
    { userId },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || "7d" }
  );
}

// ── POST /api/auth/register ───────────────────────────────────────
router.post("/register", [
  body("username")
    .trim()
    .isLength({ min: 3, max: 30 })
    .matches(/^[a-zA-Z0-9_-]+$/)
    .withMessage("Nazwa użytkownika: 3-30 znaków, tylko litery/cyfry/_/-"),
  body("email").isEmail().normalizeEmail(),
  body("password").isLength({ min: 8 }).withMessage("Hasło min. 8 znaków"),
  body("role").optional().isIn(["PLAYER", "CREATOR"]),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { username, email, password, role = "PLAYER" } = req.body;

  try {
    // Sprawdź duplikaty
    const exists = await prisma.user.findFirst({
      where: { OR: [{ email }, { username }] },
    });
    if (exists) {
      const field = exists.email === email ? "email" : "nazwa użytkownika";
      return res.status(409).json({ error: `Ten ${field} jest już zajęty.` });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const user = await prisma.user.create({
      data: { username, email, passwordHash, role },
      select: { id: true, username: true, email: true, role: true },
    });

    const token = makeToken(user.id);
    res.status(201).json({ token, user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Błąd rejestracji." });
  }
});

// ── POST /api/auth/login ──────────────────────────────────────────
router.post("/login", [
  body("email").isEmail().normalizeEmail(),
  body("password").notEmpty(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { email, password } = req.body;

  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(401).json({ error: "Nieprawidłowy email lub hasło." });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: "Nieprawidłowy email lub hasło." });
    }

    const token = makeToken(user.id);
    res.json({
      token,
      user: { id: user.id, username: user.username, email: user.email, role: user.role },
    });
  } catch (err) {
    res.status(500).json({ error: "Błąd logowania." });
  }
});

// ── GET /api/auth/me ──────────────────────────────────────────────
router.get("/me", requireAuth, async (req, res) => {
  res.json({ user: req.user });
});

// ── POST /api/auth/change-password ───────────────────────────────
router.post("/change-password", requireAuth, [
  body("currentPassword").notEmpty(),
  body("newPassword").isLength({ min: 8 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { currentPassword, newPassword } = req.body;

  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) return res.status(401).json({ error: "Nieprawidłowe obecne hasło." });

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({ where: { id: req.user.id }, data: { passwordHash } });
    res.json({ message: "Hasło zmienione." });
  } catch (err) {
    res.status(500).json({ error: "Błąd zmiany hasła." });
  }
});

module.exports = router;
