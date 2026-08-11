# Grade Tycoon — Handoff (updated)

Live game: `public/index.html` · API: `api/leaderboard.js` · Deploy: Vercel.

Original single-file prototype kept under `files/grade-tycoon.html` for reference.

---

## What changed vs the first prototype

| Area | Before | Now |
|------|--------|-----|
| Quarters | 3 × 90s | **4 × 75s** |
| Office | Flat diamond-pattern floor | **True isometric grid** (screen = `(x−y)·tw/2`, `(x+y)·th/2`) |
| Art | CSS chibi on flat plane | **16-bit pixel** desks/tiles + stepped walk animations |
| P&L | Only completed quarters as columns | **Always Q1–Q4**; unfilled = `-`; fills after each quarter |
| End | CTA only | **Full P&L + Total + server leaderboard + grade.app CTA** |
| Deploy | Open HTML | **Vercel** (`public/` + `api/`) |

Economy loop, roles, morale, desk building, and Grade brand tokens are the same spirit as before.

---

## Architecture

- **Economy** — `setInterval(tick, 100)` (not frame-tied)
- **Visuals** — `requestAnimationFrame` for walk/idle on isometric coords
- **deskIndex** still bridges logic ↔ layout; `deskPos(i)` / `deskGridPos(i)` map to iso screen space
- **P&L** — `buildPLTable(history)` always builds 4 quarter columns via `quarterColumns()`
- **Leaderboard** — `GET/POST /api/leaderboard` (Redis when env set, else process memory)

---

## Brand

```
--navy #111D29 · --blue #0351FF · --lblue #6FC1FF · --green #4ADE80
Fonts: Press Start 2P (pixel chrome) + Space Grotesk (P&L / product UI)
```

Light P&L modal still intentionally breaks from dark pixel chrome — marketing payoff.

---

## Next upgrades (optional)

1. Real sprite sheets (32×32, left/right walk) instead of CSS blocks  
2. Multi-floor rooms (floor circles are still cosmetic stubs)  
3. Wire Vercel KV so the leaderboard persists across deploys  
4. Mobile layout polish + shareable P&L snapshot
