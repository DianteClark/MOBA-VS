// MOBA-VS online API (Cloudflare Worker + D1).
// Static files are served from assets first; only unmatched routes (/api/*, /s/*, /i/*) reach this code.
//
// Accounts: no email/password. A player is { id, secret }; the client keeps both and can show them
// as a recovery code (MOBA-XXXX-…) to sign in on another device. The server stores SHA-256(secret).
// Ladder: online matches count only when BOTH players report the same winner and final checksum
// (the simulation is deterministic, so honest clients always agree).
// Queues: 'ranked' (ladder), 'casual' (5v5) and 'rush' (Lane Rush). Players are only paired inside the
// same queue; casual and rush reports are verified the same way and feed hero_results, never the ladder.
// Social: friends (requests, mutual friendship, block), a presence heartbeat (players.seen/status, polled
// only while the menu is open), friend/link invites to a private PeerJS room (/i/CODE) and read-only
// public profiles built from a small `pub` summary that is cut from the cloud save when it is uploaded.
// Weekend Cups (worker/cups.js): 8-coach brackets between real players. Anti-cheat (worker/anticheat.js):
// ranked and cup reports carry the command log; a scheduled GitHub Action re-simulates it (tools/verify.mjs)
// through the token-protected /api/admin/* endpoints and flags (and rolls back) results that do not hold up.
// Weekly Divisions (worker/divisions.js): 30-coach league groups formed lazily from the first match of each week.
// Live-ops (worker/ops.js): activity, match / queue / hero counters, crash reports, feedback, A/B flags and
// the owner dashboard API (/admin.html). Web Push (worker/push.js): opt-in notifications, queued in D1 and
// sent within the request budget. A cron (wrangler.jsonc triggers) drains the push queue and rolls up stats.
import { CUP_SCHEMA, CUP_TABLES, cupApi, cupMatchFor, trophiesStmt, trophyRow } from './cups.js';
import { REPLAY_SCHEMA, REPLAY_TABLES, REPLAY_MIGRATIONS, replayStmt, pruneStmts, adminApi, tokenOk } from './anticheat.js';
import { OPS_SCHEMA, OPS_TABLES, OPS_MIGRATIONS, opsApi, bumpStmts, matchCounters, dayOf } from './ops.js';
import { PUSH_SCHEMA, PUSH_TABLES, pushApi, enqueueStmt, drainOutbox } from './push.js';
import { PRO_SCHEMA, PRO_TABLES, proApi } from './pro.js';
import { DIV_SCHEMA, DIV_TABLES, divApi } from './divisions.js';
import { DUO_SCHEMA, DUO_TABLES, duoApi } from './duo.js';
import { CLUB_SCHEMA, CLUB_TABLES, clubApi, clubPointStmts, clubCron, clubOfStmt } from './clubs.js';
import { HUB_SCHEMA, HUB_TABLES, hubApi, reelStmt, reelRow } from './hub.js';

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS players (id TEXT PRIMARY KEY, name TEXT NOT NULL, secret_hash TEXT NOT NULL, created INTEGER, updated INTEGER, profile TEXT, profile_at INTEGER DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS ladder (season INTEGER, player TEXT, rating INTEGER DEFAULT 1000, wins INTEGER DEFAULT 0, losses INTEGER DEFAULT 0, peak INTEGER DEFAULT 1000, updated INTEGER, PRIMARY KEY (season, player))`,
  `CREATE INDEX IF NOT EXISTS ladder_rank ON ladder (season, rating DESC)`,
  `CREATE TABLE IF NOT EXISTS reports (match TEXT, player TEXT, season INTEGER, side INTEGER, opponent TEXT, winner INTEGER, checksum TEXT, summary TEXT, created INTEGER, mode TEXT DEFAULT 'ranked', PRIMARY KEY (match, player))`,
  `CREATE TABLE IF NOT EXISTS matches (id TEXT PRIMARY KEY, season INTEGER, blue TEXT, red TEXT, winner INTEGER, status TEXT, summary TEXT, created INTEGER)`,
  `CREATE TABLE IF NOT EXISTS hero_results (season INTEGER, hero TEXT, games INTEGER DEFAULT 0, wins INTEGER DEFAULT 0, PRIMARY KEY (season, hero))`,
  `CREATE TABLE IF NOT EXISTS queue (id TEXT PRIMARY KEY, player TEXT, name TEXT, version INTEGER, rating INTEGER, code TEXT, status TEXT, claimed_by TEXT, created INTEGER, seen INTEGER, mode TEXT DEFAULT 'ranked')`,
  `CREATE INDEX IF NOT EXISTS queue_wait ON queue (status, version, created)`,
  `CREATE TABLE IF NOT EXISTS shares (code TEXT PRIMARY KEY, kind TEXT, data TEXT, created INTEGER, views INTEGER DEFAULT 0)`,
  // friends: one row per direction. state 'req' (a asked b), 'ok' (written both ways on accept), 'block' (a blocked b)
  `CREATE TABLE IF NOT EXISTS friends (a TEXT, b TEXT, state TEXT, created INTEGER, PRIMARY KEY (a, b))`,
  `CREATE INDEX IF NOT EXISTS friends_in ON friends (b, state)`,
  // invites to a private room: target = a friend's id, or NULL for a shareable link (/i/ID)
  `CREATE TABLE IF NOT EXISTS invites (id TEXT PRIMARY KEY, sender TEXT, target TEXT, room TEXT, mode TEXT, status TEXT, created INTEGER)`,
  `CREATE INDEX IF NOT EXISTS invites_to ON invites (target, status, created)`,
  `CREATE INDEX IF NOT EXISTS invites_from ON invites (sender, created)`,
  ...CUP_SCHEMA, ...REPLAY_SCHEMA, ...OPS_SCHEMA, ...PUSH_SCHEMA, ...PRO_SCHEMA, ...DIV_SCHEMA, ...CLUB_SCHEMA, ...HUB_SCHEMA, ...DUO_SCHEMA,
];
const TABLES = ['players', 'ladder', 'reports', 'matches', 'hero_results', 'queue', 'shares', 'friends', 'invites', ...CUP_TABLES, ...REPLAY_TABLES, ...OPS_TABLES, ...PUSH_TABLES, ...PRO_TABLES, ...DIV_TABLES, ...CLUB_TABLES, ...HUB_TABLES, ...DUO_TABLES];
// Columns added after launch: tables created by older deploys get them here. ALTER fails harmlessly
// ("duplicate column") once the column exists, so each one is tried on its own.
const MIGRATIONS = [
  `ALTER TABLE queue ADD COLUMN mode TEXT DEFAULT 'ranked'`,
  `ALTER TABLE reports ADD COLUMN mode TEXT DEFAULT 'ranked'`,
  `CREATE INDEX IF NOT EXISTS queue_mode ON queue (status, mode, version, created)`,
  `ALTER TABLE players ADD COLUMN seen INTEGER DEFAULT 0`,
  `ALTER TABLE players ADD COLUMN status TEXT`,
  `ALTER TABLE players ADD COLUMN pub TEXT`,
  `ALTER TABLE players ADD COLUMN elo INTEGER`,
  // leaderboard pages walk (rating DESC, player) with a keyset cursor
  `CREATE INDEX IF NOT EXISTS ladder_page ON ladder (season, rating DESC, player)`,
  // spectate friends live: the PeerJS id a coach in a match relays their command stream from (src/net/spectate.js)
  `ALTER TABLE players ADD COLUMN watch TEXT`,
  ...REPLAY_MIGRATIONS, ...OPS_MIGRATIONS,
];
async function migrate(db) { for (const q of MIGRATIONS) { try { await db.prepare(q).run(); } catch { /* already migrated */ } } }
let ready = null;
const ensure = (db) => (ready = ready || db.batch(SCHEMA.map((q) => db.prepare(q))).then(() => migrate(db)).catch((e) => { ready = null; throw e; }));
const QUEUES = ['ranked', 'casual', 'rush'];
const queueOf = (m) => (QUEUES.includes(m) ? m : 'ranked');

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
  // lean row: the cloud save (profile) can be large and is only read where it is needed
  const p = await db.prepare('SELECT id, name, secret_hash, profile_at FROM players WHERE id = ?').bind(m[1]).first();
  if (!p || p.secret_hash !== await sha(m[2])) return null;
  return p;
}
// Elo with a floor; K shrinks a little for established players.
function elo(ra, rb, aWon, games) {
  const k = games < 10 ? 40 : 28, ea = 1 / (1 + 10 ** ((rb - ra) / 400));
  return Math.round(k * ((aWon ? 1 : 0) - ea));
}

// ── rate limits ──
// Per isolate, per player (or IP), fixed one-minute windows: cheap (no D1 writes) and enough to stop a
// runaway client or a script. Invites are also capped in D1 (8 per minute per sender).
const RL = new Map();
function limited(key, max, win = 60000) {
  const t = Date.now(); let e = RL.get(key);
  if (!e || t >= e.reset) {
    if (RL.size > 5000) for (const [k, v] of RL) if (t >= v.reset) RL.delete(k);
    e = { n: 0, reset: t + win }; RL.set(key, e);
  }
  return ++e.n > max;
}
const ip = (req) => req.headers.get('cf-connecting-ip') || 'local';
const slow = () => bad('Too many requests: try again in a minute', 429);
// Weekend Cup check-ins: a push to both coaches of every match that opens (always sent: a no-show loses).
const checkin = (db, pairs, now) => (pairs.length ? db.batch(pairs.flatMap(({ a, b, round }) => [a, b].map((pl) => enqueueStmt(db, pl, 'cup', { round }, now, false)))) : null);
const CUPS = cupApi({ json, bad, body, auth, rand, limited, slow, checkin });
const admin = adminApi({ json, bad, body, sha });
const OPS = opsApi({ json, bad, body, auth, limited, slow, tokenOk, sha, ip });
const PUSH = pushApi({ json, bad, body, auth, limited, slow, tokenOk, sha });
const PRO = proApi({ json, bad, body, auth, limited, slow });
const DIVS = divApi({ json, bad, body, auth, limited, slow, onPoints: clubPointStmts }); // Weekly Divisions (worker/divisions.js); accepted matches also feed club points
const CLUBS = clubApi({ json, bad, body, auth, limited, slow, ip }); // Clubs, club ladder, weekend Club Wars (worker/clubs.js)
const HUB = hubApi({ json, bad, body, auth, limited, slow, rand, ip }); // Public Replay Hub (worker/hub.js)
const DUO = duoApi({ json, bad, body, auth, rand, limited, slow, bumpStmts, dayOf }); // 2v2 matchmaking (worker/duo.js)

// ── public profile ──
// The read-only summary other coaches can see, cut from the uploaded cloud save: rank, title, banner, newest
// border, trophies, top 5 heroes by mastery and the last 8 results (own picks and score only; no names,
// no lineups/presets, no account data). Every field is re-validated here.
const HID = /^[a-z0-9_]{1,20}$/, KEYID = /^[A-Za-z0-9_:.-]{1,40}$/;
function pubOf(d) {
  if (!d || typeof d !== 'object') return null;
  const num = (v) => Math.max(0, Math.min(1e13, Math.round(Number(v) || 0)));
  const key = (v) => (typeof v === 'string' && KEYID.test(v) ? v : null);
  const sid = num(d.lastSeason), ss = (d.seasons && typeof d.seasons === 'object' && d.seasons[sid]) || {};
  const top = Object.entries(d.mastery && typeof d.mastery === 'object' ? d.mastery : {})
    .filter(([id, m]) => HID.test(id) && m && Number(m.pts) > 0).map(([id, m]) => [id, num(m.pts)]).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const recent = (Array.isArray(d.history) ? d.history : []).slice(0, 8).filter((m) => m && typeof m === 'object').map((m) => {
    const side = m.side === 1 ? 1 : 0, mine = (Array.isArray(m.picks) && Array.isArray(m.picks[side]) && m.picks[side]) || [], k = Array.isArray(m.kills) ? m.kills : [];
    return { t: num(m.t), mode: key(m.mode), won: !!m.won, map: key(m.map), len: num(m.len), picks: mine.filter((x) => typeof x === 'string' && HID.test(x)).slice(0, 5),
      k: [num(k[side]), num(k[1 - side])], mvp: m.mvp && m.mvp.team === side && HID.test(String(m.mvp.id)) ? m.mvp.id : null };
  });
  const b = Array.isArray(d.borders) && d.borders.length ? d.borders[d.borders.length - 1] : null, eq = d.equip || {};
  return { season: sid, elo: num(ss.elo ?? 1000), peak: num(ss.peakElo ?? ss.elo ?? 1000), w: num(ss.w), l: num(ss.l), title: key(eq.title), banner: key(eq.banner),
    border: b && key(b.tier) ? { tier: b.tier, season: num(b.season) } : null,
    trophies: { gold: num(d.trophies && d.trophies.gold), silver: num(d.trophies && d.trophies.silver) }, top, recent,
    // coach profile upgrade: signature heroes (most played, with wins) and the trophy cabinet's extra shelves
    sig: Object.entries(d.heroStats && typeof d.heroStats === 'object' ? d.heroStats : {}).filter(([id, s]) => HID.test(id) && s && Number(s.g) > 0)
      .map(([id, s]) => [id, num(s.g), Math.min(num(s.w), num(s.g))]).sort((a, b) => b[1] - a[1]).slice(0, 3),
    ach: Object.keys((d.ach && typeof d.ach.got === 'object' && d.ach.got) || {}).length,
    league: d.meta && d.meta.div ? Math.min(5, num(d.meta.div.best)) : 0, prestige: d.meta ? Math.min(10, num(d.meta.prestige)) : 0 };
}

// ── social: friends, presence, invites, public profiles ──
const PAGE = 50, MAX_FRIENDS = 100;
const MODES = ['casual', 'ranked', 'rush', 'coop', 'club', 'custom', 'party']; // invite modes (coop: a co-op room, src/coop-room.js; club: room = a club code, worker/clubs.js; custom: a custom-rules room; party: room = a party code, src/party.js)
const INVITE_TTL = 3 * 60000, LINK_TTL = 30 * 60000, ONLINE_MS = 120000, MATCH_MS = 25 * 60000;
const presenceOf = (r, now) => (r.status === 'match' && now - (r.seen || 0) < MATCH_MS ? 'match' : now - (r.seen || 0) < ONLINE_MS ? 'online' : 'offline');
// Friend codes are player ids (shown as XXXXX-XXXXX); they are public (already on the leaderboard), unlike the secret.
const idOf = (v) => { const s = String(v || '').toUpperCase().replace(/^MOBA/, '').replace(/[^A-Z0-9]/g, ''); return /^[A-Z0-9]{10}$/.test(s) ? s : null; };
const rankSql = `SELECT m.rating, m.wins, m.losses, m.peak, (SELECT COUNT(*) FROM ladder o WHERE o.season = m.season AND o.rating > m.rating)
  + (SELECT COUNT(*) FROM ladder o WHERE o.season = m.season AND o.rating = m.rating AND o.player < m.player) AS above
  FROM ladder m WHERE m.season = ? AND m.player = ?`;
const ladderRow = (l) => (l ? { rating: l.rating, wins: l.wins, losses: l.losses, peak: l.peak, rank: l.above + 1 } : null);

async function social(req, db, url, p, M, now) {
  if (!p.startsWith('/api/social/') && !p.startsWith('/api/player/') && !p.startsWith('/api/invite')) return null;
  // Heartbeat + inbox, one batched round trip: marks you online (or in a match) and returns your friends with
  // their presence, requests sent / received, blocks and live invites. Clients call it every 30 s, menu only.
  if (p === '/api/social/presence' && M === 'POST') {
    const me = await auth(req, db); if (!me) return bad('unauthorized', 401);
    if (limited('pr:' + me.id, 8)) return slow();
    const b = await body(req), status = b.status === 'match' ? 'match' : 'menu';
    const watch = status === 'match' && /^[A-Za-z0-9-]{6,64}$/.test(String(b.watch || '')) ? String(b.watch) : null; // spectate: the relay's peer id (friends only)
    const [, fr, inc, inv] = await db.batch([
      db.prepare('UPDATE players SET seen = ?, status = ?, watch = ? WHERE id = ?').bind(now, status, watch, me.id),
      db.prepare(`SELECT f.b AS id, f.state, p.name, p.seen, p.status, p.elo, p.watch FROM friends f JOIN players p ON p.id = f.b WHERE f.a = ? LIMIT ${MAX_FRIENDS * 2}`).bind(me.id),
      db.prepare(`SELECT f.a AS id, p.name, p.elo FROM friends f JOIN players p ON p.id = f.a WHERE f.b = ? AND f.state = 'req'
        AND NOT EXISTS (SELECT 1 FROM friends x WHERE x.a = f.b AND x.b = f.a) ORDER BY f.created DESC LIMIT 50`).bind(me.id),
      db.prepare(`SELECT i.id, i.sender, p.name, i.mode, i.room, i.created FROM invites i JOIN players p ON p.id = i.sender
        WHERE i.target = ? AND i.status = 'pending' AND i.created > ? ORDER BY i.created DESC LIMIT 3`).bind(me.id, now - INVITE_TTL),
    ]);
    const rows = fr.results || [], pick = (st) => rows.filter((r) => r.state === st);
    const order = { match: 0, online: 0, offline: 1 };
    const friends = pick('ok').map((r) => { const pr = presenceOf(r, now); return { id: r.id, name: r.name, elo: r.elo, presence: pr, seen: r.seen || 0, ...(pr === 'match' && r.watch ? { watch: r.watch } : {}) }; })
      .sort((a, b) => order[a.presence] - order[b.presence] || b.seen - a.seen);
    return json({ friends, sent: pick('req').map((r) => ({ id: r.id, name: r.name })), blocked: pick('block').map((r) => ({ id: r.id, name: r.name })),
      requests: (inc.results || []).map((r) => ({ id: r.id, name: r.name, elo: r.elo })),
      invites: (inv.results || []).map((r) => ({ id: r.id, from: { id: r.sender, name: r.name }, mode: r.mode, room: r.room, left: r.created + INVITE_TTL - now })) }); // ms left: immune to client clock skew
  }
  if (p === '/api/social/friend' && M === 'POST') {
    const me = await auth(req, db); if (!me) return bad('unauthorized', 401);
    if (limited('fr:' + me.id, 30)) return slow();
    const b = await body(req), other = idOf(b.id);
    if (!other) return bad('That friend code does not look right');
    if (other === me.id) return bad('That is your own friend code');
    const rows = (await db.prepare('SELECT a, state FROM friends WHERE (a = ? AND b = ?) OR (a = ? AND b = ?)').bind(me.id, other, other, me.id).all()).results || [];
    const mine = rows.find((r) => r.a === me.id), theirs = rows.find((r) => r.a === other);
    const put = (a, c, st) => db.prepare('INSERT INTO friends (a, b, state, created) VALUES (?,?,?,?) ON CONFLICT(a, b) DO UPDATE SET state = excluded.state, created = excluded.created').bind(a, c, st, now);
    const both = () => db.batch([put(me.id, other, 'ok'), put(other, me.id, 'ok')]);
    switch (b.action) {
      case 'add': {
        const pl = await db.prepare('SELECT name FROM players WHERE id = ?').bind(other).first();
        if (!pl) return bad('No coach has that friend code', 404);
        if (mine && mine.state === 'block') return bad('You blocked this coach: unblock them first');
        if (mine && mine.state === 'ok') return json({ state: 'friend', name: pl.name });
        if (theirs && theirs.state === 'req') { await both(); return json({ state: 'friend', name: pl.name }); }
        if (!mine) {
          const n = await db.prepare('SELECT COUNT(*) AS n FROM friends WHERE a = ?').bind(me.id).first();
          if (n && n.n >= MAX_FRIENDS * 2) return bad(`Friend list is full (${MAX_FRIENDS})`);
          await put(me.id, other, 'req').run();
        }
        return json({ state: 'sent', name: pl.name }); // also when they blocked you: that is never revealed
      }
      case 'accept':
        if (!theirs || theirs.state !== 'req' || (mine && mine.state === 'block')) return bad('No friend request from this coach', 404);
        await both(); return json({ state: 'friend' });
      case 'decline':
        await db.prepare("DELETE FROM friends WHERE a = ? AND b = ? AND state = 'req'").bind(other, me.id).run(); return json({ state: 'none' });
      case 'remove':
        await db.prepare("DELETE FROM friends WHERE ((a = ? AND b = ?) OR (a = ? AND b = ?)) AND state != 'block'").bind(me.id, other, other, me.id).run(); return json({ state: 'none' });
      case 'block':
        await db.batch([put(me.id, other, 'block'), db.prepare("DELETE FROM friends WHERE a = ? AND b = ? AND state != 'block'").bind(other, me.id),
          db.prepare("UPDATE invites SET status = 'cancelled' WHERE status = 'pending' AND ((sender = ? AND target = ?) OR (sender = ? AND target = ?))").bind(me.id, other, other, me.id)]);
        return json({ state: 'blocked' });
      case 'unblock':
        await db.prepare("DELETE FROM friends WHERE a = ? AND b = ? AND state = 'block'").bind(me.id, other).run(); return json({ state: 'none' });
      default: return bad('bad action');
    }
  }
  // Public profile: name, public summary, ladder line; presence only for friends.
  const pm = p.match(/^\/api\/player\/([A-Z0-9]{10})$/);
  if (pm && M === 'GET') {
    const who = await auth(req, db), id = pm[1], season = Number(url.searchParams.get('season')) | 0;
    if (limited('pl:' + (who ? who.id : ip(req)), 40)) return slow();
    const stmts = [db.prepare('SELECT id, name, pub, seen, status FROM players WHERE id = ?').bind(id), db.prepare(rankSql).bind(season, id), trophiesStmt(db, id), clubOfStmt(db, id), reelStmt(db, id)];
    if (who && who.id !== id) stmts.push(db.prepare('SELECT a, state FROM friends WHERE (a = ? AND b = ?) OR (a = ? AND b = ?)').bind(who.id, id, id, who.id));
    const [pr, lr, tr, clr, rlr, fr] = await db.batch(stmts);
    const pl = (pr.results || [])[0]; if (!pl) return bad('Coach not found', 404);
    let pub = null; try { pub = pl.pub ? JSON.parse(pl.pub) : null; } catch { pub = null; }
    if (!pub) { // saved before public profiles existed: cut the summary from the cloud save once
      const full = await db.prepare('SELECT profile FROM players WHERE id = ?').bind(id).first();
      try { pub = pubOf(full && full.profile ? JSON.parse(full.profile) : null); } catch { pub = null; }
      if (pub) await db.prepare('UPDATE players SET pub = ?, elo = ? WHERE id = ?').bind(JSON.stringify(pub), pub.elo, id).run();
    }
    const rows = (fr && fr.results) || [], mine = who && rows.find((r) => r.a === who.id), theirs = rows.find((r) => r.a === id);
    const relation = who && who.id === id ? 'me' : mine ? { ok: 'friend', req: 'sent', block: 'blocked' }[mine.state] || null : theirs && theirs.state === 'req' ? 'incoming' : null;
    const club = (clr.results || [])[0] || null;
    return json({ id, name: pl.name, pub, ladder: ladderRow((lr.results || [])[0]), cups: trophyRow((tr.results || [])[0]), relation, presence: relation === 'friend' ? presenceOf(pl, now) : null,
      club: club ? { name: club.name, tag: club.tag, crest: club.crest, wars: club.wars || 0, role: club.role } : null, reel: (rlr.results || []).map(reelRow) });
  }
  // Invites to a private room. A friend invite shows up in their next heartbeat (3 min); a link invite (/i/ID)
  // can be opened by anyone for 30 min. The room itself is the existing PeerJS Host/Join code.
  if (p === '/api/invite' && M === 'POST') {
    const me = await auth(req, db); if (!me) return bad('unauthorized', 401);
    if (limited('iv:' + me.id, 10)) return slow();
    const b = await body(req), room = String(b.room || ''), mode = MODES.includes(b.mode) ? b.mode : 'casual', to = b.to ? idOf(b.to) : null;
    if (!/^[A-Z]{5}$/.test(room) || (b.to && !to)) return bad('bad invite');
    const [cnt, fr] = await db.batch([db.prepare('SELECT COUNT(*) AS n FROM invites WHERE sender = ? AND created > ?').bind(me.id, now - 60000),
      db.prepare("SELECT 1 AS ok FROM friends WHERE a = ? AND b = ? AND state = 'ok'").bind(me.id, to || '')]);
    if (((cnt.results || [])[0] || {}).n >= 8) return slow();
    if (to && !(fr.results || []).length) return bad('You can only invite friends', 403);
    const id = rand(8);
    const stmts = [db.prepare('INSERT INTO invites (id, sender, target, room, mode, status, created) VALUES (?,?,?,?,?,?,?)').bind(id, me.id, to, room, mode, to ? 'pending' : 'open', now)];
    if (to) stmts.unshift(db.prepare("UPDATE invites SET status = 'cancelled' WHERE sender = ? AND target = ? AND status = 'pending'").bind(me.id, to)); // one live invite per friend
    if (id.charCodeAt(0) % 16 === 0) stmts.push(db.prepare('DELETE FROM invites WHERE created < ?').bind(now - 86400000)); // occasional sweep
    if (to) stmts.push(enqueueStmt(db, to, 'invite', { from: me.name, mode, id }, now)); // a push when they are not in the app
    await db.batch(stmts);
    return json({ id, url: `${url.origin}/i/${id}`, ttl: to ? INVITE_TTL : LINK_TTL });
  }
  if (p === '/api/invite/cancel' && M === 'POST') {
    const me = await auth(req, db); if (!me) return bad('unauthorized', 401);
    if (limited('ic:' + me.id, 20)) return slow();
    const b = await body(req), room = String(b.room || '');
    if (!/^[A-Z]{5}$/.test(room)) return bad('bad room');
    await db.prepare("UPDATE invites SET status = 'cancelled' WHERE sender = ? AND room = ? AND status IN ('pending', 'open')").bind(me.id, room).run();
    return json({ ok: true });
  }
  const live = (r) => { const ttl = r.target ? INVITE_TTL : LINK_TTL; return (r.status === 'pending' || r.status === 'open') && now - r.created > ttl ? 'expired' : r.status; };
  const im = p.match(/^\/api\/invite\/([A-Z0-9]{8})$/);
  if (im && M === 'GET') {
    if (limited('ig:' + ip(req), 60)) return slow();
    const r = await db.prepare('SELECT i.*, p.name FROM invites i JOIN players p ON p.id = i.sender WHERE i.id = ?').bind(im[1]).first();
    if (!r) return bad('This invite was not found', 404);
    return json({ id: r.id, from: { id: r.sender, name: r.name }, mode: r.mode, room: r.room, status: live(r), direct: !!r.target, left: Math.max(0, r.created + (r.target ? INVITE_TTL : LINK_TTL) - now) });
  }
  if (p === '/api/invite/respond' && M === 'POST') {
    const me = await auth(req, db); if (!me) return bad('unauthorized', 401);
    if (limited('ir:' + me.id, 20)) return slow();
    const b = await body(req), id = String(b.id || ''), accept = !!b.accept;
    if (!/^[A-Z0-9]{8}$/.test(id)) return bad('bad invite');
    const [ir, br] = await db.batch([db.prepare('SELECT i.*, p.name FROM invites i JOIN players p ON p.id = i.sender WHERE i.id = ?').bind(id),
      db.prepare("SELECT 1 AS x FROM friends f JOIN invites i ON i.id = ? WHERE f.a = i.sender AND f.b = ? AND f.state = 'block'").bind(id, me.id)]);
    const r = (ir.results || [])[0]; if (!r) return bad('This invite was not found', 404);
    if (r.target && r.target !== me.id) return bad('This invite is for another coach', 403);
    if (r.sender === me.id) return bad('That is your own invite');
    const st = (br.results || []).length ? 'cancelled' : live(r);
    if (st !== 'pending' && st !== 'open') return json({ status: st });
    if (r.target) await db.prepare("UPDATE invites SET status = ? WHERE id = ? AND status = 'pending'").bind(accept ? 'accepted' : 'declined', id).run();
    return json({ status: accept ? 'accepted' : 'declined', room: accept ? r.room : null, mode: r.mode, from: { id: r.sender, name: r.name } });
  }
  return null;
}

// Queue health for the dashboard: searches (qs), matched pairs (qm), the host's wait in seconds (qw), and
// cancels (qc). A searcher who is matched at once also counts as a search.
const queueStats = (db, mode, now, created, search = false) => bumpStmts(db, dayOf(now), { ['qm:' + mode]: 1, ['qw:' + mode]: Math.max(0, Math.round((now - (created || now)) / 1000)), ...(search ? { ['qs:' + mode]: 1 } : {}) });

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
    const row = await db.prepare('SELECT profile FROM players WHERE id = ?').bind(me.id).first();
    return json({ id: me.id, name: me.name, profile: row && row.profile ? JSON.parse(row.profile) : null, profileAt: me.profile_at });
  }
  if (p === '/api/profile' && M === 'PUT') {
    const me = await auth(req, db); if (!me) return bad('unauthorized', 401);
    const b = await body(req);
    const at = Number(b.at) || now;
    if (at < (me.profile_at || 0)) return json({ ok: false, stale: true, profileAt: me.profile_at });
    const pub = pubOf(b.profile);
    await db.prepare('UPDATE players SET name = ?, profile = ?, profile_at = ?, updated = ?, pub = ?, elo = ? WHERE id = ?')
      .bind(cleanName(b.name || me.name), JSON.stringify(b.profile || null), at, now, pub ? JSON.stringify(pub) : null, pub ? pub.elo : null, me.id).run();
    return json({ ok: true, profileAt: at });
  }

  // ── online ladder ──
  if (p === '/api/match/report' && M === 'POST') {
    const me = await auth(req, db); if (!me) return bad('unauthorized', 401);
    const b = await body(req);
    const match = String(b.match || '').slice(0, 40), season = Number(b.season) | 0, side = b.side === 1 ? 1 : 0, winner = b.winner === 1 ? 1 : 0, mode = b.mode === 'cup' ? 'cup' : queueOf(b.mode);
    if (!/^[A-Za-z0-9-]{8,40}$/.test(match) || !b.opponent) return bad('bad report');
    if (mode === 'cup') { // only the two coaches of that cup match, each on the side the bracket gave them
      const cm = await cupMatchFor(db, match, me.id);
      if (!cm || String(b.opponent) !== (cm.a === me.id ? cm.b : cm.a) || side !== (cm.a === me.id ? 0 : 1)) return bad('not your cup match', 403);
    }
    const rs = mode === 'ranked' || mode === 'cup' ? await replayStmt(db, sha, match, me.id, mode, b.replay, now) : null;
    await db.batch([db.prepare('INSERT OR IGNORE INTO reports (match, player, season, side, opponent, winner, checksum, summary, created, mode) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .bind(match, me.id, season, side, String(b.opponent).slice(0, 10), winner, String(b.checksum || ''), JSON.stringify(b.summary || {}).slice(0, 8000), now, mode),
      ...(rs ? [rs] : []), ...(match.charCodeAt(5) % 16 === 0 ? pruneStmts(db, env, now) : [])]); // occasional replay sweep
    if (mode === 'cup') return json(await CUPS.onReport(db, env, match, me.id, now));
    const done = await db.prepare('SELECT status FROM matches WHERE id = ?').bind(match).first();
    if (done) return json({ status: done.status });
    const reps = (await db.prepare('SELECT * FROM reports WHERE match = ?').bind(match).all()).results || [];
    if (reps.length < 2) return json({ status: 'pending' });
    const [a, c] = reps;
    const agree = a.winner === c.winner && a.checksum === c.checksum && a.side !== c.side && a.opponent === c.player && c.opponent === a.player && queueOf(a.mode) === queueOf(c.mode);
    const blue = a.side === 0 ? a : c, red = a.side === 0 ? c : a;
    if (!agree) {
      await db.prepare('INSERT OR IGNORE INTO matches (id, season, blue, red, winner, status, summary, created) VALUES (?,?,?,?,?,?,?,?)').bind(match, season, blue.player, red.player, -1, 'disputed', a.summary, now).run();
      return json({ status: 'disputed' });
    }
    // hero results for the season balancer: every verified match (ranked, casual and rush alike)
    const heroStmts = [];
    try {
      const sm = JSON.parse(a.summary || '{}');
      heroStmts.push(...bumpStmts(db, dayOf(now), matchCounters(sm, a.winner, queueOf(a.mode)))); // live-ops counters (worker/ops.js)
      (sm.picks || []).forEach((ids, t) => (ids || []).slice(0, 5).forEach((h) => heroStmts.push(db.prepare(`INSERT INTO hero_results (season, hero, games, wins) VALUES (?,?,1,?)
        ON CONFLICT(season, hero) DO UPDATE SET games = games + 1, wins = wins + excluded.wins`).bind(season, String(h).slice(0, 16), t === a.winner ? 1 : 0))));
    } catch { /* summary optional */ }
    // Both reports can land at the same moment: the second writer's batch then fails on matches.id (the whole
    // batch rolls back, so nothing counts twice) and that report answers with the stored result instead of a 500.
    const settle = async (stmts, out) => {
      try { await db.batch(stmts); return json(out); } catch (e) {
        const won = await db.prepare('SELECT status FROM matches WHERE id = ?').bind(match).first();
        if (won) return json({ status: won.status, mode: queueOf(a.mode), casual: queueOf(a.mode) !== 'ranked' });
        throw e;
      }
    };
    if (queueOf(a.mode) !== 'ranked') {
      return settle([db.prepare(`INSERT INTO matches (id, season, blue, red, winner, status, summary, created, mode, verify) VALUES (?,?,?,?,?,?,?,?,?, 'none')`).bind(match, season, blue.player, red.player, a.winner, 'verified', a.summary, now, queueOf(a.mode)), ...heroStmts],
        { status: 'verified', mode: queueOf(a.mode), casual: true });
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
      // the applied deltas are kept so a flagged replay can roll this exact change back (worker/anticheat.js)
      db.prepare(`INSERT INTO matches (id, season, blue, red, winner, status, summary, created, mode, dblue, dred, verify) VALUES (?,?,?,?,?,?,?,?, 'ranked', ?, ?,
        CASE WHEN EXISTS (SELECT 1 FROM replays WHERE match = ?) THEN 'pending' ELSE 'none' END)`).bind(match, season, blue.player, red.player, a.winner, 'verified', a.summary, now, nb - B.rating, nr - R.rating, match),
      up(blue.player, nb, B, blueWon), up(red.player, nr, R, !blueWon), ...heroStmts,
    ];
    return settle(stmts, { status: 'verified', mode: 'ranked', delta: { blue: nb - B.rating, red: nr - R.rating }, rating: { blue: nb, red: nr } });
  }
  if (p === '/api/match/status' && M === 'GET') {
    const m = await db.prepare('SELECT status, winner FROM matches WHERE id = ?').bind(url.searchParams.get('id') || '').first();
    return json(m || { status: 'pending' });
  }
  // Leaderboard pages: 50 rows walked by a keyset cursor (rating DESC, player) on the ladder_page index, so a
  // page costs the same wherever it is. `friends=1` ranks you among your friends (one query, no paging).
  // Your own row and global rank come with the first page only.
  if (p === '/api/leaderboard' && M === 'GET') {
    const season = Number(url.searchParams.get('season')) | 0, friendsOnly = url.searchParams.get('friends') === '1';
    const who = await auth(req, db);
    if (limited('lb:' + (who ? who.id : ip(req)), 40)) return slow();
    const cur = /^(\d{1,6})\.([A-Z0-9]{10})$/.exec(url.searchParams.get('after') || '');
    const from = Math.max(0, Number(url.searchParams.get('from')) | 0);
    const cols = 'SELECT l.player, p.name, l.rating, l.wins, l.losses, l.peak FROM ladder l JOIN players p ON p.id = l.player';
    let q;
    if (friendsOnly) {
      if (!who) return bad('unauthorized', 401);
      q = db.prepare(`${cols} WHERE l.season = ? AND (l.player = ? OR l.player IN (SELECT b FROM friends WHERE a = ? AND state = 'ok')) ORDER BY l.rating DESC, l.player LIMIT ${MAX_FRIENDS + 1}`).bind(season, who.id, who.id);
    } else if (cur) q = db.prepare(`${cols} WHERE l.season = ? AND (l.rating < ? OR (l.rating = ? AND l.player > ?)) ORDER BY l.rating DESC, l.player LIMIT ${PAGE + 1}`).bind(season, +cur[1], +cur[1], cur[2]);
    else q = db.prepare(`${cols} WHERE l.season = ? ORDER BY l.rating DESC, l.player LIMIT ${PAGE + 1}`).bind(season);
    const stmts = [q];
    if (who && !cur) stmts.push(db.prepare(rankSql).bind(season, who.id));
    const res = await db.batch(stmts);
    let rows = res[0].results || [];
    const more = !friendsOnly && rows.length > PAGE; if (more) rows = rows.slice(0, PAGE);
    const me = ladderRow(res[1] && res[1].results && res[1].results[0]);
    const last = rows[rows.length - 1];
    return json({ season, friends: friendsOnly, top: rows.map((r, i) => ({ rank: (friendsOnly ? 0 : from) + i + 1, id: r.player, name: r.name, rating: r.rating, wins: r.wins, losses: r.losses, peak: r.peak })),
      me, next: more && last ? `${last.rating}.${last.player}` : null });
  }
  if (p === '/api/balance' && M === 'GET') {
    const season = Number(url.searchParams.get('season')) | 0;
    const rows = (await db.prepare('SELECT hero, games, wins FROM hero_results WHERE season = ?').bind(season).all()).results || [];
    return json({ season, heroes: rows });
  }

  // ── matchmaking ("Find Match": ranked / casual / rush queues) ──
  // A searching player first tries to claim the oldest compatible waiting ticket (same queue and
  // version; atomic UPDATE … RETURNING); if none, it posts its own ticket with a fresh room code and
  // hosts. Hosts keep polling: if an older waiting ticket appears (two players posted at once), the
  // newer one joins it.
  if (p === '/api/queue/find' && M === 'POST') {
    const me = await auth(req, db); if (!me) return bad('unauthorized', 401);
    const b = await body(req);
    const version = Number(b.version) | 0, ticket = b.ticket ? String(b.ticket).slice(0, 16) : null, mode = queueOf(b.mode);
    const stale = now - 15000; // tickets whose owner stopped polling are dead
    await db.prepare(`DELETE FROM queue WHERE created < ? OR (status = 'waiting' AND seen < ?)`).bind(now - 120000, stale).run();
    if (ticket) {
      const mine = await db.prepare('SELECT * FROM queue WHERE id = ? AND player = ?').bind(ticket, me.id).first();
      if (!mine) return json({ status: 'expired' });
      if (mine.status === 'claimed') return json({ status: 'matched', role: 'host', code: mine.code });
      await db.prepare('UPDATE queue SET seen = ? WHERE id = ?').bind(now, ticket).run();
      const older = await db.prepare(`UPDATE queue SET status = 'claimed', claimed_by = ? WHERE id = (SELECT id FROM queue WHERE status = 'waiting' AND version = ? AND COALESCE(mode, 'ranked') = ? AND player != ? AND created < ? AND seen >= ? ORDER BY created LIMIT 1) RETURNING code, created`)
        .bind(me.id, version, queueOf(mine.mode), me.id, mine.created, stale).first();
      if (older) { await db.batch([db.prepare('DELETE FROM queue WHERE id = ?').bind(ticket), ...queueStats(db, queueOf(mine.mode), now, older.created)]); return json({ status: 'matched', role: 'join', code: older.code }); }
      return json({ status: 'waiting', ticket, code: mine.code });
    }
    const got = await db.prepare(`UPDATE queue SET status = 'claimed', claimed_by = ? WHERE id = (SELECT id FROM queue WHERE status = 'waiting' AND version = ? AND COALESCE(mode, 'ranked') = ? AND player != ? AND seen >= ? ORDER BY created LIMIT 1) RETURNING code, created`)
      .bind(me.id, version, mode, me.id, stale).first();
    if (got) { await db.batch(queueStats(db, mode, now, got.created, true)); return json({ status: 'matched', role: 'join', code: got.code }); }
    const id = rand(12), code = rand(5).replace(/[^A-Z]/g, 'Q');
    await db.batch([db.prepare(`INSERT INTO queue (id, player, name, version, rating, code, status, created, seen, mode) VALUES (?,?,?,?,?,?, 'waiting', ?, ?, ?)`).bind(id, me.id, me.name, version, Number(b.rating) | 0, code, now, now, mode),
      ...bumpStmts(db, dayOf(now), { ['qs:' + mode]: 1 })]);
    return json({ status: 'waiting', ticket: id, code, role: 'host', mode });
  }
  if (p === '/api/queue/cancel' && M === 'POST') {
    const me = await auth(req, db); if (!me) return bad('unauthorized', 401);
    const b = await body(req);
    const gone = await db.prepare(`DELETE FROM queue WHERE id = ? AND player = ? RETURNING COALESCE(mode, 'ranked') AS mode, status`).bind(String(b.ticket || ''), me.id).first();
    if (gone && gone.status === 'waiting') await db.batch(bumpStmts(db, dayOf(now), { ['qc:' + queueOf(gone.mode)]: 1 })); // gave up (cancel or the 60 s limit)
    return json({ ok: true });
  }
  if (p === '/api/queue/count' && M === 'GET') {
    const rows = (await db.prepare(`SELECT COALESCE(mode, 'ranked') AS mode, COUNT(*) AS n FROM queue WHERE status = 'waiting' AND seen >= ? GROUP BY COALESCE(mode, 'ranked')`).bind(now - 15000).all()).results || [];
    const by = Object.fromEntries(QUEUES.map((q) => [q, 0])); for (const r of rows) by[queueOf(r.mode)] += r.n;
    return json({ searching: rows.reduce((a, r) => a + r.n, 0), byMode: by });
  }

  const soc = await social(req, db, url, p, M, now); if (soc) return soc;
  const cup = await CUPS.route(req, env, db, url, p, M, now); if (cup) return cup;
  const ops = await OPS.route(req, env, db, url, p, M, now); if (ops) return ops;
  const psh = await PUSH(req, env, db, url, p, M, now); if (psh) return psh;
  const pro = await PRO.route(req, env, db, url, p, M, now); if (pro) return pro;
  const adm = await admin(req, env, db, url, p, M, now); if (adm) return adm;
  const div = await DIVS(req, env, db, url, p, M, now); if (div) return div;
  const club = await CLUBS(req, env, db, url, p, M, now); if (club) return club;
  const hub = await HUB(req, env, db, url, p, M, now); if (hub) return hub;
  const duo = await DUO(req, env, db, url, p, M, now); if (duo) return duo;

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

// Pushes queued by this request go out after the response (ctx.waitUntil), within the request's CPU budget.
const QUEUES_PUSH = /^\/api\/(invite$|cup\b|push\/rematch$)/;
export default {
  async scheduled(event, env, ctx) {
    if (!env.DB) return;
    await ensure(env.DB);
    const now = Date.now();
    // every 5 minutes: drain queued pushes; once a day (03:07 UTC): stats rollup + pruning
    if (event.cron === '7 3 * * *') ctx.waitUntil(Promise.all([OPS.rollup(env.DB, now), clubCron(env.DB, now)])); // + weekend Club War pairing / settling (worker/clubs.js)
    else ctx.waitUntil(drainOutbox(env.DB, env, now));
  },
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (url.pathname === '/api/health') {
      let tables = false, missing = TABLES;
      if (env.DB) {
        try {
          await ensure(env.DB);
          const have = new Set(((await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()).results || []).map((r) => r.name));
          missing = TABLES.filter((t) => !have.has(t)); tables = !missing.length;
        } catch { tables = false; }
      }
      return json({ ok: true, db: !!env.DB, tables, missing, time: Date.now() });
    }
    // short share links open the game with the shared item
    const s = url.pathname.match(/^\/s\/([A-Z0-9]{7})$/);
    if (s) return Response.redirect(`${url.origin}/?s=${s[1]}`, 302);
    // invite links open the game straight into the invite (and from there the lobby)
    const i = url.pathname.match(/^\/i\/([A-Z0-9]{8})$/);
    if (i) return Response.redirect(`${url.origin}/?i=${i[1]}`, 302);
    if (url.pathname.startsWith('/api/')) {
      try {
        const res = await route(req, env, url);
        if (ctx && env.DB && (req.method === 'POST' || url.pathname === '/api/cup') && QUEUES_PUSH.test(url.pathname)) ctx.waitUntil(drainOutbox(env.DB, env).catch(() => 0));
        return res;
      } catch (e) {
        const m = String(e && e.message || e).slice(0, 120);
        return bad(m, m === 'too large' ? 413 : m === 'bad json' ? 400 : 500);
      }
    }
    return env.ASSETS.fetch(req);
  },
};
