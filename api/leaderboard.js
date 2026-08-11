/**
 * Grade Tycoon leaderboard API
 *
 * Persistence (optional, recommended for prod):
 *   KV_REST_API_URL + KV_REST_API_TOKEN   (Vercel KV / Upstash)
 *   or UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN
 *
 * Export contacts (emails) for mailing list:
 *   GET /api/leaderboard?export=contacts
 *   Header: Authorization: Bearer <LEADERBOARD_EXPORT_SECRET>
 *   or ?secret=<LEADERBOARD_EXPORT_SECRET>
 *
 * Without Redis env vars, scores live in process memory (fine for local / single instance).
 */

const KEY = 'grade-tycoon:leaderboard';
const CONTACTS_KEY = 'grade-tycoon:contacts';
const MAX = 50;
const TOP = 10;
const MAX_CONTACTS = 5000;

/** @type {{ name: string, company: string, email?: string, netProfit: number, score: number, at: string }[]} */
let memory = [];
/** @type {{ email: string, name: string, company: string, score: number, at: string }[]} */
let contactsMemory = [];

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

async function loadContacts() {
  try {
    const raw = await redisCmd(['GET', CONTACTS_KEY]);
    if (raw == null) return contactsMemory.slice();
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return contactsMemory.slice();
  }
}

async function saveContacts(list) {
  contactsMemory = list.slice(0, MAX_CONTACTS);
  try {
    await redisCmd(['SET', CONTACTS_KEY, JSON.stringify(contactsMemory)]);
  } catch {
    /* memory-only fallback */
  }
}

/** Keep emails for mailing list even if the score falls out of the top board. */
async function upsertContact(entry) {
  const email = sanitizeEmail(entry.email);
  if (!email) return;
  const list = await loadContacts();
  const next = {
    email,
    name: entry.name,
    company: entry.company,
    score: entry.score,
    at: entry.at,
  };
  const i = list.findIndex((c) => c.email === email);
  if (i >= 0) list[i] = next;
  else list.push(next);
  list.sort((a, b) => (b.at || '').localeCompare(a.at || ''));
  await saveContacts(list);
}

function sanitizeName(name) {
  return String(name || 'CEO')
    .replace(/[<>&"']/g, '')
    .trim()
    .slice(0, 16) || 'CEO';
}

function sanitizeEmail(email) {
  const s = String(email || '')
    .trim()
    .toLowerCase()
    .slice(0, 64);
  if (!s) return '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return '';
  return s;
}

function publicEntry(e) {
  return {
    name: e.name,
    company: e.company,
    netProfit: e.netProfit,
    totalRevenue: e.totalRevenue,
    score: e.score,
    at: e.at,
  };
}

function rank(list) {
  return list
    .slice()
    .sort((a, b) => b.score - a.score || b.netProfit - a.netProfit)
    .slice(0, TOP)
    .map(publicEntry);
}

function exportAuthorized(req) {
  const expected = process.env.LEADERBOARD_EXPORT_SECRET;
  if (!expected) return false;
  const auth = String(req.headers.authorization || '');
  const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  const q = typeof req.query?.secret === 'string' ? req.query.secret : '';
  return bearer === expected || q === expected;
}

function contactsToCsv(contacts) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = ['email,name,company,score,at'];
  for (const c of contacts) {
    lines.push([c.email, c.name, c.company, c.score, c.at].map(esc).join(','));
  }
  return lines.join('\n') + '\n';
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  try {
    if (req.method === 'GET') {
      const exportMode = req.query?.export;
      if (exportMode === 'contacts' || exportMode === 'emails') {
        if (!exportAuthorized(req)) {
          res.status(401).json({
            error: 'Unauthorized',
            hint: 'Set LEADERBOARD_EXPORT_SECRET and pass Authorization: Bearer <secret>',
          });
          return;
        }
        const contacts = await loadContacts();
        const format = String(req.query?.format || 'json').toLowerCase();
        if (format === 'csv') {
          res.setHeader('Content-Type', 'text/csv; charset=utf-8');
          res.setHeader('Content-Disposition', 'attachment; filename="grade-tycoon-contacts.csv"');
          res.status(200).send(contactsToCsv(contacts));
          return;
        }
        res.status(200).json({
          count: contacts.length,
          contacts,
          emails: [...new Set(contacts.map((c) => c.email).filter(Boolean))],
        });
        return;
      }

      const all = await loadAll();
      res.status(200).json({ entries: rank(all), persistent: !!redisCreds() });
      return;
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};

      // Soft lead capture from the start screen (email only — no score yet)
      if (body.leadOnly) {
        const email = sanitizeEmail(body.email);
        if (!email) {
          res.status(400).json({ error: 'valid email required' });
          return;
        }
        await upsertContact({
          email,
          name: sanitizeName(body.name || 'CEO'),
          company: String(body.company || 'Studio').slice(0, 32),
          score: 0,
          at: new Date().toISOString(),
        });
        res.status(201).json({ ok: true });
        return;
      }

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
        email: sanitizeEmail(body.email),
        netProfit: Math.round(netProfit),
        totalRevenue: Math.round(totalRevenue),
        score,
        at: new Date().toISOString(),
      };
      const all = await loadAll();
      all.push(entry);
      all.sort((a, b) => b.score - a.score);
      await saveAll(all.slice(0, MAX));
      await upsertContact(entry);
      const entries = rank(all);
      const place = entries.findIndex(
        (e) => e.at === entry.at && e.name === entry.name && e.score === entry.score
      );
      res.status(201).json({ entry: publicEntry(entry), place: place >= 0 ? place + 1 : null, entries });
      return;
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Server error' });
  }
};
