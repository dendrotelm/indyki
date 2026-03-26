// prisma/seed.js
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Seeding bazy danych...");

  // Tagi
  const tags = [
    { slug: "platformowka",  name: "platformówka" },
    { slug: "rpg",           name: "RPG" },
    { slug: "horror",        name: "horror" },
    { slug: "puzzle",        name: "puzzle" },
    { slug: "przygodowa",    name: "przygodowa" },
    { slug: "pixel-art",     name: "pixel-art" },
    { slug: "roguelike",     name: "roguelike" },
    { slug: "visual-novel",  name: "visual novel" },
    { slug: "strategia",     name: "strategia" },
    { slug: "arcade",        name: "arcade" },
    { slug: "symulator",     name: "symulator" },
    { slug: "sportowa",      name: "sportowa" },
  ];

  for (const tag of tags) {
    await prisma.tag.upsert({
      where: { slug: tag.slug },
      create: tag,
      update: { name: tag.name },
    });
  }
  console.log(`✅ ${tags.length} tagów`);

  // Kategorie forum
  const cats = [
    { slug: "ogloszenia",  name: "Ogłoszenia",  description: "Nowości z platformy", icon: "📢", order: 0 },
    { slug: "devlogi",     name: "Devlogi",     description: "Twórcy dzielą się postępami", icon: "🛠️", order: 1 },
    { slug: "showcase",    name: "Showcase",    description: "Pokaż swoją grę, zbierz feedback", icon: "🎮", order: 2 },
    { slug: "pomoc",       name: "Pomoc",       description: "Techniczne pytania, narzędzia", icon: "🆘", order: 3 },
    { slug: "off-topic",   name: "Off-topic",   description: "Luźne rozmowy o grach", icon: "💬", order: 4 },
    { slug: "game-jamy",   name: "Game Jamy",   description: "Organizacja i dyskusja", icon: "⏱️", order: 5 },
  ];

  for (const cat of cats) {
    await prisma.forumCategory.upsert({
      where:  { slug: cat.slug },
      create: cat,
      update: { name: cat.name, description: cat.description },
    });
  }
  console.log(`✅ ${cats.length} kategorii forum`);

  // Admin user (zmień hasło!)
  const adminPwd = await bcrypt.hash("zmien_to_haslo_123!", 12);
  const admin = await prisma.user.upsert({
    where: { email: "admin@indyki.qzz.io" },
    create: {
      username: "indyki_admin",
      email: "admin@indyki.qzz.io",
      passwordHash: adminPwd,
      role: "ADMIN",
      bio: "Administracja platformy indyki.qzz.io",
    },
    update: {},
  });
  console.log(`✅ Admin: ${admin.email}`);

  console.log("🦃 Seed zakończony!");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
