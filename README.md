# Rentopia Alert Tracker

Reads Gmail emails labeled **apt-alerts**, extracts listing URLs, dedupes them, and shows anything seen in the chosen time window. No scraping — only Gmail API reads.

## Stack
- Vite + React + TypeScript (SPA)
- Vercel Serverless Functions (Node 18+, TypeScript)
- Prisma + Postgres (Neon recommended)
- Gmail API via OAuth 2.0 (scope: `https://www.googleapis.com/auth/gmail.readonly`)

## Project layout
```
/ (root)
  /api           # Vercel serverless functions
    auth-start.ts
    auth-callback.ts
    ingest.ts
    recent.ts
  /src           # React SPA
  /lib           # Shared helpers (Prisma, Gmail, url utils, rate limit)
  /prisma        # Prisma schema
  vercel.json
  package.json
```

## Prerequisites
- Node 18+
- Postgres connection string (Neon works great)
- Google Cloud project with OAuth Client ID (web app)

## Environment variables
Create `.env` (not committed):
```
DATABASE_URL=postgresql://user:pass@host:5432/db
GOOGLE_CLIENT_ID=your_client_id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_client_secret
GOOGLE_REDIRECT_URI=https://your-domain.vercel.app/api/auth/callback
APP_ORIGIN=https://your-domain.vercel.app
# Optional rate limiting with Upstash
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
```

## Local development
```bash
npm install
npm run prisma:generate
# Option A: run API locally (requires Vercel login/token)
npm run dev:api   # vercel dev --listen 3000
# Option B: skip local API; point SPA to deployed API
#   set VITE_API_BASE=https://<your-app>.vercel.app in .env
# Frontend in either case
npm run dev       # Vite on :5173 (proxies /api to :3000 when local)
```
Without `dev:api`, keep `VITE_API_BASE` set so the SPA calls the deployed API instead of localhost to avoid JSON parse errors.

## Database setup
1) Update `DATABASE_URL` in `.env`.
2) Run migrations (creates tables):
```bash
npm run prisma:migrate -- --name init
```
3) View the generated client: `npm run prisma:generate` (runs automatically with migrate).

### Prisma models
- **OAuthToken**: stores Gmail refresh/access tokens per email (unique email).
- **Listing**: deduped listing by `urlHash`, tracks latest seen time.
- **ListingEvent**: each email+url occurrence, unique on `(emailMessageId, urlHash)`.

## Google OAuth setup
1) In Google Cloud Console → Credentials → Create OAuth client (Web).
2) Authorized redirect URI: `https://<your-domain>/api/auth/callback` (match `GOOGLE_REDIRECT_URI`).
3) Note the Client ID/Secret and place in `.env`.
4) In Gmail, create a filter to apply label `apt-alerts` to alert emails (Craigslist, Facebook, StreetEasy, etc.).

## How auth works
- `GET /api/auth/start` redirects to Google consent with scope `gmail.readonly`, `access_type=offline`, `prompt=consent` to obtain a refresh token.
- `GET /api/auth/callback?code=...` exchanges the code, stores tokens in `OAuthToken`, and redirects back to `APP_ORIGIN` with `auth=success`.

## Ingestion flow
- `POST /api/ingest?minutes=60`
  - Rate limit: 1 request per 30s per IP (Upstash if configured, otherwise in-memory).
  - Uses the stored refresh token to fetch messages labeled `apt-alerts` newer than the window.
  - Fetches each message, extracts all URLs from text/plain and text/html bodies.
  - Canonicalizes URLs (drops utm/fbclid/gclid/etc.), classifies source, dedupes by SHA-256 hash.
  - Upserts `Listing`, inserts `ListingEvent` (unique on emailMessageId+urlHash).
  - Returns counts and recent listings.

- `GET /api/recent?minutes=60&source=craigslist&q=loft`
  - Returns listings with `latestSeenAt` within the window, optional source filter and text search.

## Frontend
- Connect Gmail button hits `/api/auth/start`.
- "Ingest last hour" button calls `/api/ingest`.
- Grid shows recent listings with source badge and timestamp, with filters for minutes, source, and keyword.

## Deployment (Vercel)
1) Set env vars in Vercel dashboard (same as `.env`).
2) `vercel deploy` or connect GitHub repo.
3) Ensure `GOOGLE_REDIRECT_URI` matches deployed domain.
4) `vercel.json` routes `/api/*` to serverless functions and rewrites other paths to SPA.

## Notes
- No scraping; all data originates from Gmail via the official API.
- Scope is minimal: `gmail.readonly`.
- If Upstash is not configured, rate limiting uses in-memory map (resets on cold start).
