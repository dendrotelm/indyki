# indyki.qzz.io — Instrukcja deploymentu krok po kroku

Docelowe adresy:
- Frontend:  https://indyki.qzz.io
- Backend:   https://api.indyki.qzz.io  (lub Railway URL bezpośrednio)
- Pliki R2:  https://files.indyki.qzz.io (opcjonalnie)

---

## KROK 1 — Baza danych (Supabase)

1. Wejdź na https://supabase.com → **New project**
2. Wypełnij:
   - Name: `indyki`
   - Database Password: (zapisz!)
   - Region: **eu-central-1** (Frankfurt)
3. Poczekaj ~2 minuty
4. **Settings → Database → Connection string → URI** → skopiuj:
   ```
   postgresql://postgres:[HASLO]@db.xxxx.supabase.co:5432/postgres
   ```
   To Twój `DATABASE_URL`.

> **OVH alternatywa** (własny VPS):
> ```bash
> sudo apt install postgresql postgresql-contrib
> sudo -u postgres createuser indyki_user -P
> sudo -u postgres createdb indyki_db -O indyki_user
> # DATABASE_URL="postgresql://indyki_user:HASLO@localhost:5432/indyki_db"
> ```

---

## KROK 2 — Storage plików (Cloudflare R2)

1. https://cloudflare.com → **R2 → Create bucket**
   - Bucket name: `indyki-games`
2. Bucket → **Settings → Public access → Allow Public Access**
   - Skopiuj **R2.dev subdomain** → to Twój `R2_PUBLIC_URL`
     (np. `https://pub-abc123.r2.dev`)
3. R2 główna → **Manage R2 API tokens → Create API token**
   - Permissions: Object Read & Write
   - Specify bucket: `indyki-games`
   - Skopiuj: Account ID, Access Key ID, Secret Access Key

---

## KROK 3 — Email (Resend)

1. https://resend.com → Create account
2. Uwaga: Resend wymaga weryfikacji domeny do wysyłki.
   Na qzz.io możesz nie mieć dostępu do DNS — użyj wtedy
   testowego adresu `onboarding@resend.dev` w `.env` na start.
3. **API Keys → Create** → skopiuj `RESEND_API_KEY`

---

## KROK 4 — Uruchomienie lokalnie

```bash
# 1. Wejdź do folderu
cd indyki-backend

# 2. Zainstaluj zależności
npm install

# 3. Skopiuj i uzupełnij .env
cp .env.example .env

# Otwórz .env i wpisz wszystkie wartości z kroków 1-3
# Wygeneruj JWT_SECRET:
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"

# 4. Zsynchronizuj schemat z bazą
npm run db:push

# 5. Wypełnij bazę (tagi, forum, admin)
npm run db:seed

# 6. Uruchom
npm run dev
# → 🦃 indyki.qzz.io backend na porcie 3001

# 7. Test
curl http://localhost:3001/api/health
# → {"status":"ok","env":"development"}
```

---

## KROK 5 — Integracja frontendu

Utwórz `src/lib/api.js` w projekcie React:

```js
const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:3001/api";

async function request(path, options = {}) {
  const token = localStorage.getItem("indyki_token");
  const res = await fetch(BASE_URL + path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Błąd serwera");
  }
  return res.json();
}

export const api = {
  register:      (data)        => request("/auth/register", { method: "POST", body: JSON.stringify(data) }),
  login:         (data)        => request("/auth/login",    { method: "POST", body: JSON.stringify(data) }),
  me:            ()            => request("/auth/me"),
  getGames:      (params = {}) => request("/games?" + new URLSearchParams(params)),
  getGame:       (slug)        => request(`/games/${slug}`),
  getFeatured:   ()            => request("/games/featured"),
  createGame:    (data)        => request("/games", { method: "POST", body: JSON.stringify(data) }),
  updateGame:    (slug, data)  => request(`/games/${slug}`, { method: "PATCH", body: JSON.stringify(data) }),
  publishGame:   (slug)        => request(`/games/${slug}/publish`, { method: "POST" }),
  toggleWishlist:(slug)        => request(`/games/${slug}/wishlist`, { method: "POST" }),
  getCategories: ()            => request("/forum/categories"),
  getThreads:    (cat, p = 1) => request(`/forum/categories/${cat}/threads?page=${p}`),
  getThread:     (slug, p = 1)=> request(`/forum/threads/${slug}?page=${p}`),
  createThread:  (cat, data)   => request(`/forum/categories/${cat}/threads`, { method: "POST", body: JSON.stringify(data) }),
  createPost:    (slug, data)  => request(`/forum/threads/${slug}/posts`,     { method: "POST", body: JSON.stringify(data) }),
  getUser:       (username)    => request(`/users/${username}`),
  updateProfile: (data)        => request("/users/me", { method: "PATCH", body: JSON.stringify(data) }),
  getWishlist:   ()            => request("/users/me/wishlist"),
};

export async function uploadFile(gameSlug, file, platform) {
  const token = localStorage.getItem("indyki_token");
  const form = new FormData();
  form.append("file", file);
  form.append("platform", platform);
  const res = await fetch(`${BASE_URL}/upload/game/${gameSlug}/file`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  if (!res.ok) throw new Error("Błąd uploadu");
  return res.json();
}

export const saveToken  = (t) => localStorage.setItem("indyki_token", t);
export const clearToken = ()  => localStorage.removeItem("indyki_token");
export const getToken   = ()  => localStorage.getItem("indyki_token");
```

W `.env` frontendu (plik `.env.local` w Vite):
```
VITE_API_URL=http://localhost:3001/api
```

---

## KROK 6 — Deploy backendu (Railway)

1. https://railway.app → **New Project → Deploy from GitHub repo**
2. Wybierz repo `indyki-backend` (push kod na GitHub najpierw!)
3. Railway wykryje Dockerfile automatycznie
4. **Variables** → dodaj wszystkie zmienne:

```
DATABASE_URL        = (z Supabase/OVH)
JWT_SECRET          = (wygenerowany w kroku 4)
JWT_EXPIRES_IN      = 7d
R2_ACCOUNT_ID       = (z Cloudflare)
R2_ACCESS_KEY_ID    = (z Cloudflare)
R2_SECRET_ACCESS_KEY= (z Cloudflare)
R2_BUCKET_NAME      = indyki-games
R2_PUBLIC_URL       = https://pub-xxx.r2.dev
RESEND_API_KEY      = (z Resend)
EMAIL_FROM          = noreply@indyki.qzz.io
NODE_ENV            = production
PORT                = 3001
FRONTEND_URL        = https://indyki.qzz.io
```

5. **Settings → Networking → Generate Domain**
   → dostaniesz np. `indyki-backend-production.up.railway.app`
6. Test: `curl https://indyki-backend-production.up.railway.app/api/health`

---

## KROK 7 — Deploy frontendu (Vercel)

1. https://vercel.com → **New Project → Import Git Repository**
2. Wybierz repo z frontendem React
3. **Environment Variables**:
   ```
   VITE_API_URL = https://indyki-backend-production.up.railway.app/api
   ```
4. Deploy → dostaniesz np. `indyki-frontend.vercel.app`
5. Wróć do Railway → zaktualizuj `FRONTEND_URL` na Vercel URL

---

## KROK 8 — Domena qzz.io

1. Zaloguj się do panelu qzz.io
2. Zarządzanie subdomenami → dodaj:

```
indyki.qzz.io     → CNAME → cname.vercel-dns.com
```

3. W Vercel → Project → Settings → Domains → dodaj `indyki.qzz.io`
4. Vercel zweryfikuje i wystawi SSL automatycznie

**Jeśli qzz.io nie pozwala na subdomeny 3. poziomu** (api.indyki.qzz.io):
- Nie potrzebujesz ich! Backend jedzie pod Railway URL
- Zmień tylko `VITE_API_URL` na pełny Railway URL
- Frontend pod `indyki.qzz.io`, backend pod `xxx.railway.app` — działa idealnie

---

## KROK 9 — Workflow codzienny

```bash
# Lokalna praca
npm run dev          # backend na :3001
npm run db:studio    # wizualny podgląd bazy na :5555

# Deploy (automatyczny po push)
git add .
git commit -m "feat: opis zmiany"
git push origin main
# Railway i Vercel deployują w ~2 minuty
```

---

## Podsumowanie kosztów

| Serwis           | Plan          | Koszt/mies |
|------------------|---------------|------------|
| Supabase         | Free          | $0         |
| Cloudflare R2    | Free (10 GB)  | $0         |
| Railway          | Starter       | ~$5        |
| Vercel           | Hobby         | $0         |
| Resend           | Free (3k/mies)| $0         |
| indyki.qzz.io    | Darmowa       | $0         |
| **RAZEM**        |               | **~$5/mies**|
