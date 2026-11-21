// MOBA-VS online API (Cloudflare Worker + D1).
// Static files are served from assets first; only unmatched routes (/api/*, /s/*) reach this code.
//
// Accounts: no email/password. A player is { id, secret }; the client keeps both and can show them
// as a recovery code (MOBA-XXXX-…) to sign in on another device. The server stores SHA-256(secret).
// Ladder: online matches count only when BOTH players report the same winner and final checksum
// (the simulation is deterministic, so honest clients always agree).

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS players (id TEXT PRIMARY KEY, name TEXT NOT NULL, secret_hash TEXT NOT NULL, created INTEGER, updated INTEGER, profile TEXT, profile_at INTEGER DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS ladder (season INTEGER, player TEXT, rating INTEGER DEFAULT 1000, wins INTEGER DEFAULT 0, losses INTEGER DEFAULT 0, peak INTEGER DEFAULT 1000, updated INTEGER, PRIMARY KEY (season, player))`,
  `CREATE INDEX IF NOT EXISTS ladder_rank ON ladder (season, rating DESC)`,
  `CREATE TABLE IF NOT EXISTS reports (match TEXT, player TEXT, season INTEGER, side INTEGER, opponent TEXT, winner INTEGER, checksum TEXT, summary TEXT, created INTEGER, PRIMARY KEY (match, player))`,
  `CREATE TABLE IF NOT EXISTS matches (id TEXT PRIMARY KEY, season INTEGER, blue TEXT, red TEXT, winner INTEGER, status TEXT, summary TEXT, created INTEGER)`,
  `CREATE TABLE IF NOT EXISTS hero_results (season INTEGER, hero TEXT, games INTEGER DEFAULT 0, wins INTEGER DEFAULT 0, PRIMARY KEY (season, hero))`,
  `CREATE TABLE IF NOT EXISTS queue (id TEXT PRIMARY KEY, player TEXT, name TEXT, version INTEGER, rating INTEGER, code TEXT, status TEXT, claimed_by TEXT, created INTEGER, seen INTEGER)`,
  `CREATE INDEX IF NOT EXISTS queue_wait ON queue (status, version, created)`,
  `CREATE TABLE IF NOT EXISTS shares (code TEXT PRIMARY KEY, kind TEXT, data TEXT, created INTEGER, views INTEGER DEFAULT 0)`,
];
let ready = null;
const ensure = (db) => (ready = ready || db.batch(SCHEMA.map((q) => db.prepare(q))).catch((e) => { ready = null; throw e; }));

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,PUT,OPTIONS', 'access-control-allow-headers': 'content-type,authorization', 'access-control-max-age': '86400' };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...CORS } });
const bad = (msg, status = 400) => json({ error: msg }, status);
const MAX_BODY = 160 * 1024;

const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const rand = (n) => { const b = crypto.getRandomValues(new Uint8Array(n)); let s = ''; for (const x of b) s += ALPHA[x % ALPHA.length]; return s; };
async function sha(s) { const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join(''); }
const cleanName = (n) => String(n || '').replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 16) || 'Coach';
const codeOf = (id, secret) => `MOBA-${(id + secret).match(/.{1,5}/g).join('-')}`;

async function body(req) {
  const t = await req.text(); if (t.length > MAX_BODY) throw new Error('too large');
  try { return t ? JSON.parse(t) : {}; } catch { throw new Error('bad json'); }
}
async function auth(req, db) {
  const h = req.headers.get('authorization') || '';
  const m = h.match(/^Bearer ([A-Z0-9]{10})\.([A-Z0-9]{20})$/); if (!m) return null;
  const p = await db.prepare('SELECT * FROM players WHERE id = ?').bind(m[1]).first();
  if (!p || p.secret_hash !== await sha(m[2])) return null;
  return p;
}
// Elo with a floor; K shrinks a little for established players.
function elo(ra, rb, aWon, games) {
  const k = games < 10 ? 40 : 28, ea = 1 / (1 + 10 ** ((rb - ra) / 400));
  return Math.round(k * ((aWon ? 1 : 0) - ea));
}

async function route(req, env, url) {
  const db = env.DB; if (!db) return bad('database not connected', 503);
  await ensure(db);
  const p = url.pathname, now = Date.now(), M = req.method;

  // ── accounts ──
  if (p === '/api/account' && M === 'POST') {
    const b = await body(req);
    const id = rand(10), secret = rand(20);
    await db.prepare('INSERT INTO players (id, name, secret_hash, created, updated) VALUES (?, ?, ?, ?, ?)').bind(id, cleanName(b.name), await sha(secret), now, now).run();
    return json({ id, secret, code: codeOf(id, secret) });
  }
  if (p === '/api/recover' && M === 'POST') {
    const b = await body(req);
    const raw = String(b.code || '').toUpperCase().replace(/^MOBA/, '').replace(/[^A-Z0-9]/g, '');
    if (raw.length !== 30) return bad('That code does not look right');
    const id = raw.slice(0, 10), secret = raw.slice(10);
    const pl = await db.prepare('SELECT * FROM players WHERE id = ?').bind(id).first();
    if (!pl || pl.secret_hash !== await sha(secret)) return bad('Code not found', 404);
    return json({ id, secret, code: codeOf(id, secret), name: pl.name, profile: pl.profile ? JSON.parse(pl.profile) : null, profileAt: pl.profile_at });
  }
  if (p === '/api/me' && M === 'GET') {
    const me = await auth(req, db); if (!me) return bad('unauthorized', 401);
    return json({ id: me.id, name: me.name, profile: me.profile ? JSON.parse(me.profile) : null, profileAt: me.profile_at });
  }
  if (p === '/api/profile' && M === 'PUT') {
    const me = await auth(req, db); if (!me) return bad('unauthorized', 401);
    const b = await body(req);
    const at = Number(b.at) || now;
    if (at < (me.profile_at || 0)) return json({ ok: false, stale: true, profileAt: me.profile_at });
    await db.prepare('UPDATE players SET name = ?, profile = ?, profile_at = ?, updated = ? WHERE id = ?').bind(cleanName(b.name || me.name), JSON.stringify(b.profile || null), at, now, me.id).run();
    return json({ ok: true, profileAt: at });
  }

  // ── online ladder ──
  if (p === '/api/match/report' && M === 'POST') {
    const me = await auth(req, db); if (!me) return bad('unauthorized', 401);
    const b = await body(req);
    const match = String(b.match || '').slice(0, 40), season = Number(b.season) | 0, side = b.side === 1 ? 1 : 0, winner = b.winner === 1 ? 1 : 0;
    if (!/^[A-Za-z0-9-]{8,40}$/.test(match) || !b.opponent) return bad('bad report');
    await db.prepare('INSERT OR IGNORE INTO reports (match, player, season, side, opponent, winner, checksum, summary, created) VALUES (?,?,?,?,?,?,?,?,?)')
      .bind(match, me.id, season, side, String(b.opponent).slice(0, 10), winner, String(b.checksum || ''), JSON.stringify(b.summary || {}).slice(0, 8000), now).run();
    const done = await db.prepare('SELECT status FROM matches WHERE id = ?').bind(match).first();
    if (done) return json({ status: done.status });
    const reps = (await db.prepare('SELECT * FROM reports WHERE match = ?').bind(match).all()).results || [];
    if (reps.length < 2) return json({ status: 'pending' });
    const [a, c] = reps;
    const agree = a.winner === c.winner && a.checksum === c.checksum && a.side !== c.side && a.opponent === c.player && c.opponent === a.player;
    const blue = a.side === 0 ? a : c, red = a.side === 0 ? c : a;
    if (!agree) {
      await db.prepare('INSERT OR IGNORE INTO matches (id, season, blue, red, winner, status, summary, created) VALUES (?,?,?,?,?,?,?,?)').bind(match, season, blue.player, red.player, -1, 'disputed', a.summary, now).run();
      return json({ status: 'disputed' });
    }
    const row = async (pid) => (await db.prepare('SELECT * FROM ladder WHERE season = ? AND player = ?').bind(season, pid).first()) || { rating: 1000, wins: 0, losses: 0, peak: 1000 };
    const B = await row(blue.player), R = await row(red.player);
    const blueWon = a.winner === 0;
    const d = elo(B.rating, R.rating, blueWon, B.wins + B.losses);
    const nb = Math.max(0, B.rating + d), nr = Math.max(0, R.rating - d);
    const up = (pid, r, old, won) => db.prepare(`INSERT INTO ladder (season, player, rating, wins, losses, peak, updated) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(season, player) DO UPDATE SET rating = excluded.rating, wins = excluded.wins, losses = excluded.losses, peak = excluded.peak, updated = excluded.updated`)
      .bind(season, pid, r, old.wins + (won ? 1 : 0), old.losses + (won ? 0 : 1), Math.max(old.peak, r), now);
    const stmts = [
      db.prepare('INSERT INTO matches (id, season, blue, red, winner, status, summary, created) VALUES (?,?,?,?,?,?,?,?)').bind(match, season, blue.player, red.player, a.winner, 'verified', a.summary, now),
      up(blue.player, nb, B, blueWon), up(red.player, nr, R, !blueWon),
    ];
    // real-player hero results for the season balancer
    try {
      const s = JSON.parse(a.summary || '{}');
      (s.picks || []).forEach((ids, t) => (ids || []).slice(0, 5).forEach((h) => stmts.push(db.prepare(`INSERT INTO hero_results (season, hero, games, wins) VALUES (?,?,1,?)
        ON CONFLICT(season, hero) DO UPDATE SET games = games + 1, wins = wins + excluded.wins`).bind(season, String(h).slice(0, 16), t === a.winner ? 1 : 0))));
    } catch { /* summary optional */ }
    await db.batch(stmts);
    return json({ status: 'verified', delta: { blue: nb - B.rating, red: nr - R.rating }, rating: { blue: nb, red: nr } });
  }
  if (p === '/api/match/status' && M === 'GET') {
    const m = await db.prepare('SELECT status, winner FROM matches WHERE id = ?').bind(url.searchParams.get('id') || '').first();
    return json(m || { status: 'pending' });
  }
  if (p === '/api/leaderboard' && M === 'GET') {
    const season = Number(url.searchParams.get('season')) | 0;
    const rows = (await db.prepare(`SELECT l.player, p.name, l.rating, l.wins, l.losses, l.peak FROM ladder l JOIN players p ON p.id = l.player
      WHERE l.season = ? ORDER BY l.rating DESC, l.wins DESC LIMIT 100`).bind(season).all()).results || [];
    let me = null;
    const who = await auth(req, db);
    if (who) {
      const mine = await db.prepare('SELECT rating, wins, losses, peak FROM ladder WHERE season = ? AND player = ?').bind(season, who.id).first();
      if (mine) { const above = await db.prepare('SELECT COUNT(*) AS n FROM ladder WHERE season = ? AND rating > ?').bind(season, mine.rating).first(); me = { ...mine, rank: (above ? above.n : 0) + 1 }; }
    }
    return json({ season, top: rows.map((r, i) => ({ rank: i + 1, id: r.player, name: r.name, rating: r.rating, wins: r.wins, losses: r.losses, peak: r.peak })), me });
  }
  if (p === '/api/balance' && M === 'GET') {
    const season = Number(url.searchParams.get('season')) | 0;
    const rows = (await db.prepare('SELECT hero, games, wins FROM hero_results WHERE season = ?').bind(season).all()).results || [];
    return json({ season, heroes: rows });
  }

  // ── matchmaking (ranked "Find Match") ──
  // A searching player first tries to claim the oldest compatible waiting ticket (atomic UPDATE …
  // RETURNING); if none, it posts its own ticket with a fresh room code and hosts. Hosts keep
  // polling: if an older waiting ticket appears (two players posted at once), the newer one joins it.
  if (p === '/api/queue/find' && M === 'POST') {
    const me = await auth(req, db); if (!me) return bad('unauthorized', 401);
    const b = await body(req);
    const version = Number(b.version) | 0, ticket = b.ticket ? String(b.ticket).slice(0, 16) : null;
    const stale = now - 15000; // tickets whose owner stopped polling are dead
    await db.prepare(`DELETE FROM queue WHERE created < ? OR (status = 'waiting' AND seen < ?)`).bind(now - 120000, stale).run();
    if (ticket) {
      const mine = await db.prepare('SELECT * FROM queue WHERE id = ? AND player = ?').bind(ticket, me.id).first();
      if (!mine) return json({ status: 'expired' });
      if (mine.status === 'claimed') return json({ status: 'matched', role: 'host', code: mine.code });
      await db.prepare('UPDATE queue SET seen = ? WHERE id = ?').bind(now, ticket).run();
      const older = await db.prepare(`UPDATE queue SET status = 'claimed', claimed_by = ? WHERE id = (SELECT id FROM queue WHERE status = 'waiting' AND version = ? AND player != ? AND created < ? AND seen >= ? ORDER BY created LIMIT 1) RETURNING code`)
        .bind(me.id, version, me.id, mine.created, stale).first();
      if (older) { await db.prepare('DELETE FROM queue WHERE id = ?').bind(ticket).run(); return json({ status: 'matched', role: 'join', code: older.code }); }
      return json({ status: 'waiting', ticket, code: mine.code });
    }
    const got = await db.prepare(`UPDATE queue SET status = 'claimed', claimed_by = ? WHERE id = (SELECT id FROM queue WHERE status = 'waiting' AND version = ? AND player != ? AND seen >= ? ORDER BY created LIMIT 1) RETURNING code`)
      .bind(me.id, version, me.id, stale).first();
    if (got) return json({ status: 'matched', role: 'join', code: got.code });
    const id = rand(12), code = rand(5).replace(/[^A-Z]/g, 'Q');
    await db.prepare(`INSERT INTO queue (id, player, name, version, rating, code, status, created, seen) VALUES (?,?,?,?,?,?, 'waiting', ?, ?)`).bind(id, me.id, me.name, version, Number(b.rating) | 0, code, now, now).run();
    return json({ status: 'waiting', ticket: id, code, role: 'host' });
  }
  if (p === '/api/queue/cancel' && M === 'POST') {
    const me = await auth(req, db); if (!me) return bad('unauthorized', 401);
    const b = await body(req);
    await db.prepare('DELETE FROM queue WHERE id = ? AND player = ?').bind(String(b.ticket || ''), me.id).run();
    return json({ ok: true });
  }
  if (p === '/api/queue/count' && M === 'GET') {
    const n = await db.prepare(`SELECT COUNT(*) AS n FROM queue WHERE status = 'waiting' AND seen >= ?`).bind(now - 15000).first();
    return json({ searching: n ? n.n : 0 });
  }

  // ── share links ──
  if (p === '/api/share' && M === 'POST') {
    const b = await body(req);
    const kind = b.kind === 'replay' ? 'replay' : 'card';
    const data = JSON.stringify(b.data || {}); if (data.length > MAX_BODY) return bad('too large', 413);
    let code = rand(7);
    for (let i = 0; i < 3 && await db.prepare('SELECT 1 FROM shares WHERE code = ?').bind(code).first(); i++) code = rand(7);
    await db.prepare('INSERT INTO shares (code, kind, data, created) VALUES (?,?,?,?)').bind(code, kind, data, now).run();
    return json({ code, url: `${url.origin}/s/${code}` });
  }
  const sm = p.match(/^\/api\/share\/([A-Z0-9]{7})$/);
  if (sm && M === 'GET') {
    const s = await db.prepare('SELECT kind, data, created FROM shares WHERE code = ?').bind(sm[1]).first();
    if (!s) return bad('not found', 404);
    await db.prepare('UPDATE shares SET views = views + 1 WHERE code = ?').bind(sm[1]).run();
    return json({ kind: s.kind, data: JSON.parse(s.data), created: s.created });
  }
  return bad('not found', 404);
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (url.pathname === '/api/health') {
      let tables = false;
      if (env.DB) { try { await ensure(env.DB); tables = true; } catch { tables = false; } }
      return json({ ok: true, db: !!env.DB, tables, time: Date.now() });
    }
    // short share links open the game with the shared item
    const s = url.pathname.match(/^\/s\/([A-Z0-9]{7})$/);
    if (s) return Response.redirect(`${url.origin}/?s=${s[1]}`, 302);
    if (url.pathname.startsWith('/api/')) {
      try { return await route(req, env, url); } catch (e) { return bad(String(e && e.message || e).slice(0, 120), 500); }
    }
    return env.ASSETS.fetch(req);
  },
};
