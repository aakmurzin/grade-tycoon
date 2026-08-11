# Grade Tycoon

Isometric 16-bit office sim — a marketing prototype for [Grade](https://grade.app).

Hire Sales / Dev / HR, close leads, ship projects, survive **4 quarters**, then see a Grade-style **P&L** (4 columns that fill one by one), submit to the **server leaderboard**, and jump to grade.app.

## Run locally

```bash
# static only (no leaderboard API)
npx serve public

# full stack (game + /api/leaderboard)
npx vercel dev
```

Open the URL Vercel prints (usually `http://localhost:3000`).

## Deploy to Vercel

```bash
npx vercel --prod
```

Or connect the GitHub repo in the [Vercel dashboard](https://vercel.com/new) — root directory is this folder (`api/` + `public/`).

### Persistent leaderboard (recommended)

Without Redis, scores live in serverless memory (reset on cold starts). For a real board, add **Vercel KV** or Upstash Redis and set:

| Env var | Alt name |
|---------|----------|
| `KV_REST_API_URL` | `UPSTASH_REDIS_REST_URL` |
| `KV_REST_API_TOKEN` | `UPSTASH_REDIS_REST_TOKEN` |

In Vercel: Project → Settings → Environment Variables → add both → redeploy.

## Project layout

```
api/leaderboard.js   GET/POST scores
public/index.html    entire game (ISO office + economy + P&L)
files/               original prototype handoff (reference)
```

## Game loop

1. Pick company type → tutorial  
2. Recruit → assign Sales → assign Dev → build desks / upgrade office  
3. End of each quarter → P&L with Q1–Q4 columns (empty = `-`)  
4. After Q4 (or bankruptcy) → full P&L + Total + leaderboard + CTA to grade.app  

Score = **Net Profit + 15% of total revenue**.
