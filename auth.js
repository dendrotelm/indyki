// src/middleware/auth.js
const jwt = require("jsonwebtoken");
const prisma = require("../lib/prisma");

// Wymaga zalogowania
async function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Brak tokenu autoryzacji." });
  }

  const token = header.split(" ")[1];
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { id: true, username: true, email: true, role: true },
    });
    if (!user) return res.status(401).json({ error: "Użytkownik nie istnieje." });
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Token nieprawidłowy lub wygasł." });
  }
}

// Opcjonalne logowanie (np. dla publicznych tras które zmieniają widok dla zalogowanych)
async function optionalAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) return next();
  const token = header.split(" ")[1];
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { id: true, username: true, role: true },
    });
    req.user = user || null;
  } catch {}
  next();
}

// Wymaga roli CREATOR lub ADMIN
function requireCreator(req, res, next) {
  if (!req.user || (req.user.role !== "CREATOR" && req.user.role !== "ADMIN")) {
    return res.status(403).json({ error: "Wymagane konto twórcy." });
  }
  next();
}

// Wymaga ADMIN
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== "ADMIN") {
    return res.status(403).json({ error: "Brak uprawnień administratora." });
  }
  next();
}

module.exports = { requireAuth, optionalAuth, requireCreator, requireAdmin };
