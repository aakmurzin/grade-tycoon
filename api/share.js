/**
 * Share card API — stores a PNG + meta so social crawlers get og:image.
 *
 * POST { imageBase64, meta } → { id, pageUrl, imageUrl }
 * GET  ?id=&view=page|image|json
 *
 * Optional Redis (same env as leaderboard) for multi-instance persistence.
 * Memory fallback for local / single instance.
 */

const PREFIX = 'grade-tycoon:share:';
const TTL_SEC = 60 * 60 * 24 * 14; // 14 days
const MAX_IMAGE_BYTES = 900_000;

/** @type {Map<string, { png: Buffer, meta: object, at: number }>} */
const memory = new Map();

function redisCreds() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return { url, token };
}

async function redisCmd(command) {
  const creds = redisCreds();
  if (!creds) return null;
  const res = await fetch(`${creds.url}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${creds.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(command),
  });
  if (!res.ok) throw new Error(`Redis error ${res.status}`);
  const data = await res.json();
  return data.result;
}

function uid() {
  return Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function originFromReq(req) {
  const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  const host = (req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000')
    .split(',')[0]
    .trim();
  return `${proto}://${host}`;
}

function pruneMemory() {
  const cutoff = Date.now() - TTL_SEC * 1000;
  for (const [id, row] of memory) {
    if (row.at < cutoff) memory.delete(id);
  }
  while (memory.size > 80) {
    const first = memory.keys().next().value;
    memory.delete(first);
  }
}

async function saveShare(id, png, meta) {
  pruneMemory();
  memory.set(id, { png, meta, at: Date.now() });
  try {
    const payload = JSON.stringify({
      meta,
      png: png.toString('base64'),
      at: Date.now(),
    });
    await redisCmd(['SET', PREFIX + id, payload, 'EX', String(TTL_SEC)]);
  } catch {
    /* memory-only */
  }
}

async function loadShare(id) {
  const mem = memory.get(id);
  if (mem) return mem;
  try {
    const raw = await redisCmd(['GET', PREFIX + id]);
    if (!raw) return null;
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const png = Buffer.from(parsed.png, 'base64');
    const row = { png, meta: parsed.meta || {}, at: parsed.at || Date.now() };
    memory.set(id, row);
    return row;
  } catch {
    return null;
  }
}

function sharePageHtml(origin, id, meta) {
  const company = escapeHtml(meta.company || 'Grade Tycoon');
  const net = escapeHtml(meta.netLabel || '');
  const title = escapeHtml(meta.title || `${company} — Grade Tycoon P&L`);
  const desc = escapeHtml(
    meta.description ||
      `Net profit ${meta.netLabel || ''}. Play Grade Tycoon, then run the real P&L on grade.app.`
  );
  const imageUrl = `${origin}/api/share?id=${encodeURIComponent(id)}&view=image`;
  const pageUrl = `${origin}/s/${encodeURIComponent(id)}`;
  const playUrl = escapeHtml(meta.playUrl || origin);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${desc}">
<meta property="og:type" content="website">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${desc}">
<meta property="og:url" content="${pageUrl}">
<meta property="og:image" content="${imageUrl}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${desc}">
<meta name="twitter:image" content="${imageUrl}">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&display=swap">
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
    background:#0A141E;color:#E8EEF5;font-family:'Space Grotesk',system-ui,sans-serif;padding:24px;}
  .card{max-width:720px;width:100%;text-align:center;}
  img{width:100%;height:auto;border:2px solid #2A3D52;display:block;}
  h1{font-size:22px;margin:20px 0 8px;}
  p{color:#9FB3C8;line-height:1.5;margin:0 0 16px;}
  a.btn{display:inline-block;background:#0351FF;color:#fff;text-decoration:none;
    padding:12px 18px;font-weight:700;margin:4px;}
  a.sub{color:#6FC1FF;}
</style>
</head>
<body>
  <div class="card">
    <img src="${imageUrl}" alt="${company} P&amp;L card" width="1200" height="630">
    <h1>${company}</h1>
    <p>${net ? `Net profit: <strong style="color:#fff">${net}</strong><br>` : ''}${desc}</p>
    <a class="btn" href="${playUrl}">Play Grade Tycoon</a>
    <a class="btn" href="https://grade.app" style="background:#182636;border:1px solid #2A3D52;">Open grade.app</a>
    <p style="margin-top:18px;font-size:13px"><a class="sub" href="${pageUrl}">Share this result</a></p>
  </div>
</body>
</html>`;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  const origin = originFromReq(req);

  if (req.method === 'POST') {
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
      const raw = String(body.imageBase64 || '').replace(/^data:image\/\w+;base64,/, '');
      if (!raw) {
        res.statusCode = 400;
        return res.json({ error: 'imageBase64 required' });
      }
      const png = Buffer.from(raw, 'base64');
      if (!png.length || png.length > MAX_IMAGE_BYTES) {
        res.statusCode = 400;
        return res.json({ error: 'image too large or empty' });
      }
      const meta = {
        company: String(body.meta?.company || 'Company').slice(0, 48),
        netLabel: String(body.meta?.netLabel || '').slice(0, 24),
        title: String(body.meta?.title || '').slice(0, 80),
        description: String(body.meta?.description || '').slice(0, 180),
        playUrl: String(body.meta?.playUrl || origin).slice(0, 200),
      };
      const id = uid();
      await saveShare(id, png, meta);
      const pageUrl = `${origin}/s/${id}`;
      const imageUrl = `${origin}/api/share?id=${id}&view=image`;
      return res.json({ id, pageUrl, imageUrl, expiresInDays: 14 });
    } catch (e) {
      res.statusCode = 500;
      return res.json({ error: e.message || 'share failed' });
    }
  }

  if (req.method === 'GET') {
    const id = String(req.query.id || '').replace(/[^a-z0-9]/gi, '').slice(0, 24);
    const view = String(req.query.view || 'page');
    if (!id) {
      res.statusCode = 400;
      return res.json({ error: 'id required' });
    }
    const row = await loadShare(id);
    if (!row) {
      res.statusCode = 404;
      return res.json({ error: 'share not found or expired' });
    }
    if (view === 'image') {
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.end(row.png);
    }
    if (view === 'json') {
      return res.json({ id, meta: row.meta, imageUrl: `${origin}/api/share?id=${id}&view=image` });
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.end(sharePageHtml(origin, id, row.meta));
  }

  res.statusCode = 405;
  return res.json({ error: 'method not allowed' });
};
