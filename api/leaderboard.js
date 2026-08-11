/**
 * Grade Tycoon leaderboard API
 *
 * Persistence (optional, recommended for prod):
 *   KV_REST_API_URL + KV_REST_API_TOKEN   (Vercel KV / Upstash)
 *   or UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN
 *
 * Without Redis env vars, scores live in process memory (fine for local / single instance).
 */

const KEY = 'grade-tycoon:leaderboard';
const MAX = 50;
const TOP = 10;

/** @type {{ name: string, company: string, netProfit: number, score: number, at: string }[]} */
let memory = [];

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

async function loadAll() {
  try {
    const raw = await redisCmd(['GET', KEY]);
    if (raw == null) return memory.slice();
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return memory.slice();
  }
}

async function saveAll(list) {
  memory = list.slice(0, MAX);
  try {
    await redisCmd(['SET', KEY, JSON.stringify(memory)]);
  } catch {
    /* memory-only fallback */
  }
}

function sanitizeName(name) {
  return String(name || 'CEO')
    .replace(/[<>&"']/g, '')
    .trim()
    .slice(0, 16) || 'CEO';
}

function rank(list) {
  return list
    .slice()
    .sort((a, b) => b.score - a.score || b.netProfit - a.netProfit)
    .slice(0, TOP);
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  try {
    if (req.method === 'GET') {
      const all = await loadAll();
      res.status(200).json({ entries: rank(all), persistent: !!redisCreds() });
      return;
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
      const netProfit = Number(body.netProfit);
      const totalRevenue = Number(body.totalRevenue) || 0;
      if (!Number.isFinite(netProfit)) {
        res.status(400).json({ error: 'netProfit required' });
        return;
      }
      // Score: net profit weighted with surviving scale (revenue) — encourages growth, not just skimping
      const score = Math.round(netProfit + totalRevenue * 0.15);
      const entry = {
        name: sanitizeName(body.name),
        company: String(body.company || 'Studio').slice(0, 32),
        netProfit: Math.round(netProfit),
        totalRevenue: Math.round(totalRevenue),
        score,
        at: new Date().toISOString(),
      };
      const all = await loadAll();
      all.push(entry);
      all.sort((a, b) => b.score - a.score);
      await saveAll(all.slice(0, MAX));
      const entries = rank(all);
      const place = entries.findIndex(
        (e) => e.at === entry.at && e.name === entry.name && e.score === entry.score
      );
      res.status(201).json({ entry, place: place >= 0 ? place + 1 : null, entries });
      return;
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Server error' });
  }
};
