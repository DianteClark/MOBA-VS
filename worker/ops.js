// Live-ops for the owner: activity, match / queue / hero counters, crash reports, feedback, A/B flags,
// and the token-protected dashboard API behind /admin.html.
//
// Cost model (Cloudflare free plan: ~10 ms CPU per request, D1 rows read / written per day):
//   * Counters live in ops_day (day, key) → n. Every bump is ONE multi-row UPSERT statement appended to a
//     batch the request already runs (a verified match adds ~25 rows, a queue search 1-2, a client event 2-6).
//   * Activity: active (day, player), INSERT OR IGNORE once per player per day (an isolate-local memo skips
//     repeats), from /api/ops/hello which the client sends once per launch.
//   * Rollups: a daily cron (wrangler.jsonc "triggers") turns active / players into DAU, WAU, new players and
//     D1 / D7 retention per cohort (ops_day keys dau, wau, new, coh, r1, r7) and prunes old rows. The
//     dashboard reads those few keys plus window sums (GROUP BY in SQL), never raw rows per day.
//   * Crashes are grouped by a server-side hash of the normalised message + top stack frames, rate limited
//     per player / IP and sampled once a group is busy (the client then sends 1 in 10 with weight 10).
//     Stored: message, stack, version, device class (e.g. phone-ios-safari-app) and the account id. Nothing else.
//   * Flags: assignment is a hash bucket of (flag, player): stable, no rows written. Exposure is logged once
//     per flag and player (flag_expo) when the client actually shows the variant. Flags are for UI / UX only:
//     the deterministic sim never reads them (tools/ops_test.mjs checks src/sim never imports src/net/ops.js).
export const OPS_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS ops_day (day INTEGER, k TEXT, n INTEGER DEFAULT 0, PRIMARY KEY (day, k))`,
  `CREATE TABLE IF NOT EXISTS active (day INTEGER, player TEXT, PRIMARY KEY (day, player))`,
  `CREATE TABLE IF NOT EXISTS crashes (hash TEXT PRIMARY KEY, kind TEXT, msg TEXT, stack TEXT, first INTEGER, last INTEGER, n INTEGER DEFAULT 0, players INTEGER DEFAULT 0)`,
  `CREATE INDEX IF NOT EXISTS crashes_last ON crashes (last)`,
  `CREATE TABLE IF NOT EXISTS crash_tags (hash TEXT, tag TEXT, n INTEGER DEFAULT 0, PRIMARY KEY (hash, tag))`,
  `CREATE TABLE IF NOT EXISTS feedback (id INTEGER PRIMARY KEY AUTOINCREMENT, player TEXT, created INTEGER, text TEXT, meta TEXT, shot TEXT, status TEXT DEFAULT 'new')`,
  `CREATE INDEX IF NOT EXISTS feedback_new ON feedback (status, created)`,
  // variants: JSON [{ id, w }]. status: on (assigned by bucket) | off (everyone gets the client default) | ship (everyone gets `ship`)
  `CREATE TABLE IF NOT EXISTS flags (key TEXT PRIMARY KEY, variants TEXT, status TEXT, ship TEXT, note TEXT, created INTEGER, updated INTEGER)`,
  `CREATE TABLE IF NOT EXISTS flag_expo (flag TEXT, player TEXT, variant TEXT, day INTEGER, PRIMARY KEY (flag, player))`,
  `CREATE INDEX IF NOT EXISTS flag_expo_player ON flag_expo (player)`,
];
export const OPS_TABLES = ['ops_day', 'active', 'crashes', 'crash_tags', 'feedback', 'flags', 'flag_expo'];
export const OPS_MIGRATIONS = [`CREATE INDEX IF NOT EXISTS players_created ON players (created)`];

export const DAY = 86400000;
export const dayOf = (ms) => Math.floor(ms / DAY);
const KEY = /^[a-z0-9_:.-]{1,48}$/;
const ID = /^[a-z0-9_]{1,24}$/;
const DEV = /^[a-z0-9-]{1,40}$/;
const MODES = ['ai', 'rush_ai', 'cup_ai', 'coop', 'ranked', 'casual', 'rush', 'private', 'cup', 'watch'];
const EVENTS = ['match_start', 'match_done', 'push_optin', 'push_prompt', 'feedback'];

// One multi-row UPSERT per ≤ 30 keys (D1 allows 100 bound parameters per statement).
export function bumpStmts(db, day, counts) {
  const rows = Object.entries(counts).filter(([k, n]) => KEY.test(k) && n);
  const out = [];
  for (let i = 0; i < rows.length; i += 30) {
    const part = rows.slice(i, i + 30);
    out.push(db.prepare(`INSERT INTO ops_day (day, k, n) VALUES ${part.map(() => '(?,?,?)').join(',')} ON CONFLICT(day, k) DO UPDATE SET n = n + excluded.n`)
      .bind(...part.flatMap(([k, n]) => [day, k, n | 0])));
  }
  return out;
}
const add = (o, k, n = 1) => { o[k] = (o[k] || 0) + n; };

// Counters for one verified online match (called by the report handler, appended to its batch).
// sm: the stored report summary { picks, bans, plans, map, event, mode }, winner 0/1.
export function matchCounters(sm, winner, mode) {
  const c = {};
  add(c, 'vm'); add(c, 'vm:' + mode);
  if (sm && typeof sm === 'object') {
    (Array.isArray(sm.picks) ? sm.picks : []).slice(0, 2).forEach((ids, t) => (Array.isArray(ids) ? ids : []).slice(0, 5).forEach((h) => { if (ID.test(String(h))) { add(c, 'hg:' + h); if (t === winner) add(c, 'hw:' + h); } }));
    (Array.isArray(sm.bans) ? sm.bans : []).slice(0, 2).forEach((ids) => (Array.isArray(ids) ? ids : []).slice(0, 5).forEach((h) => { if (ID.test(String(h))) add(c, 'hb:' + h); }));
    (Array.isArray(sm.plans) ? sm.plans : []).slice(0, 2).forEach((pl, t) => { if (ID.test(String(pl))) { add(c, 'pg:' + pl); if (t === winner) add(c, 'pw:' + pl); } });
    if (ID.test(String(sm.map))) add(c, 'vmap:' + sm.map);
  }
  return c;
}

// ── activity ──
const seenToday = new Map(); // isolate memo: "day:player"
export function activeStmt(db, player, now) {
  const d = dayOf(now), k = d + ':' + player;
  if (seenToday.get(k)) return null;
  if (seenToday.size > 20000) seenToday.clear();
  seenToday.set(k, 1);
  return db.prepare('INSERT OR IGNORE INTO active (day, player) VALUES (?, ?)').bind(d, player);
}

// ── flags ──
export function fnv(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h >>> 0; }
export function assign(flag, player) {
  if (flag.status === 'ship') return flag.ship || null;
  if (flag.status !== 'on') return null;
  let vs; try { vs = JSON.parse(flag.variants || '[]'); } catch { vs = []; }
  const total = vs.reduce((a, v) => a + Math.max(0, Number(v.w) || 0), 0); if (!total) return null;
  let b = (fnv(flag.key + ':' + player) % 10000) / 10000 * total;
  for (const v of vs) { b -= Math.max(0, Number(v.w) || 0); if (b < 0) return v.id; }
  return vs[vs.length - 1].id;
}
let flagCache = null;
async function liveFlags(db, now) {
  if (flagCache && now - flagCache.at < 60000) return flagCache.rows;
  const rows = (await db.prepare(`SELECT key, variants, status, ship FROM flags WHERE status IN ('on', 'ship')`).all()).results || [];
  flagCache = { at: now, rows };
  return rows;
}

// ── crashes ──
// Same bug, same group: numbers in messages, URLs / query strings and columns are dropped; the first 4 frames
// keep their file and line.
export function normCrash(msg, stack) {
  const m = String(msg || '').replace(/https?:\/\/[^\s)]+\//g, '').replace(/\?[^\s:)]*/g, '').replace(/\b\d+(\.\d+)?\b/g, 'N').slice(0, 300);
  const frames = String(stack || '').split('\n').map((l) => l.trim()).filter((l) => /\.m?js|desync|@|at /.test(l))
    .map((l) => l.replace(/https?:\/\/[^/\s]+/g, '').replace(/\?[^:\s)]*/g, '').replace(/:(\d+):\d+/g, ':$1')).slice(0, 4);
  return { m, frames };
}
export const SAMPLE_AT = 50; // reports of one group per day before clients are told to sample

export function opsApi(H) {
  const { json, bad, body, auth, limited, slow, tokenOk, sha, ip } = H;

  async function hello(req, env, db, now) {
    const me = await auth(req, db); if (!me) return bad('unauthorized', 401);
    if (limited('oh:' + me.id, 10)) return slow();
    const b = await body(req), v = Number(b.v) | 0, dev = DEV.test(String(b.dev || '')) ? b.dev : 'other';
    const flags = {};
    for (const f of await liveFlags(db, now)) { const x = assign(f, me.id); if (x) flags[f.key] = { v: x, log: f.status === 'on' }; }
    const st = activeStmt(db, me.id, now), stmts = st ? [st, ...bumpStmts(db, dayOf(now), { ['dev:' + dev.split('-').slice(0, 2).join('-')]: 1, ['ver:' + v]: 1 })] : [];
    if (stmts.length) await db.batch(stmts);
    return json({ flags, sample: SAMPLE_AT });
  }

  async function expose(req, env, db, now) {
    const me = await auth(req, db); if (!me) return bad('unauthorized', 401);
    if (limited('ox:' + me.id, 10)) return slow();
    const b = await body(req), want = b.flags && typeof b.flags === 'object' ? Object.entries(b.flags).slice(0, 20) : [];
    const live = new Map((await liveFlags(db, now)).map((f) => [f.key, f]));
    const stmts = [], d = dayOf(now);
    for (const [k, v] of want) { const f = live.get(k); if (f && f.status === 'on' && assign(f, me.id) === v) stmts.push(db.prepare('INSERT OR IGNORE INTO flag_expo (flag, player, variant, day) VALUES (?,?,?,?)').bind(k, me.id, v, d)); }
    if (stmts.length) await db.batch(stmts);
    return json({ ok: true, logged: stmts.length });
  }

  // Client events: match started / finished (any mode, including vs AI), push opt-in, feedback sent.
  async function track(req, env, db, now) {
    const me = await auth(req, db); if (!me) return bad('unauthorized', 401);
    if (limited('ot:' + me.id, 20)) return slow();
    const b = await body(req), ev = EVENTS.includes(b.ev) ? b.ev : null; if (!ev) return bad('bad event');
    const mode = MODES.includes(b.mode) ? b.mode : null, c = {};
    add(c, 'ev:' + ev);
    if (mode) add(c, `ev:${ev}:${mode}`);
    if (ev === 'match_done') {
      if (ID.test(String(b.map))) add(c, 'map:' + b.map);
      add(c, 'event:' + (ID.test(String(b.event)) ? b.event : 'classic'));
      if (Number(b.len) > 0) add(c, 'len:' + (mode || 'other'), Math.min(3600, Math.round(Number(b.len))));
    }
    const ex = (await db.prepare('SELECT flag, variant FROM flag_expo WHERE player = ? LIMIT 20').bind(me.id).all()).results || [];
    for (const x of ex) add(c, `fx:${x.flag}:${x.variant}:${ev}`);
    const st = activeStmt(db, me.id, now);
    await db.batch([...(st ? [st] : []), ...bumpStmts(db, dayOf(now), c)]);
    return json({ ok: true });
  }

  async function crash(req, env, db, now) {
    const me = await auth(req, db), who = me ? me.id : 'ip:' + ip(req);
    if (limited('oc:' + who, 6) || limited('oc:all', 600)) return slow();
    const b = await body(req);
    const kind = b.kind === 'desync' ? 'desync' : b.kind === 'rejection' ? 'rejection' : 'error';
    const { m, frames } = normCrash(b.msg, b.stack);
    if (!m && !frames.length) return bad('empty');
    const hash = (await sha(kind + '|' + m + '|' + frames.join('|'))).slice(0, 16);
    const v = Number(b.v) | 0, dev = DEV.test(String(b.dev || '')) ? b.dev : 'other', w = Math.max(1, Math.min(20, Number(b.w) | 0 || 1));
    const today = (await db.prepare('SELECT n FROM ops_day WHERE day = ? AND k = ?').bind(dayOf(now), 'c:' + hash).first());
    const n = today ? today.n : 0;
    await db.batch([
      db.prepare(`INSERT INTO crashes (hash, kind, msg, stack, first, last, n, players) VALUES (?,?,?,?,?,?,?,1)
        ON CONFLICT(hash) DO UPDATE SET last = excluded.last, n = n + excluded.n, players = players + 1`).bind(hash, kind, String(b.msg || '').slice(0, 300), String(b.stack || '').slice(0, 2000), now, now, w),
      db.prepare(`INSERT INTO crash_tags (hash, tag, n) VALUES (?,?,?),(?,?,?) ON CONFLICT(hash, tag) DO UPDATE SET n = n + excluded.n`).bind(hash, 'v' + v, w, hash, dev, w),
      ...bumpStmts(db, dayOf(now), { crash: w, ['c:' + hash]: w }),
    ]);
    return json({ ok: true, hash, sample: n + w >= SAMPLE_AT ? 0.1 : 1 });
  }

  async function feedback(req, env, db, now) {
    const me = await auth(req, db), who = me ? me.id : 'ip:' + ip(req);
    if (limited('of:' + who, 3, 10 * 60000) || limited('of:all', 120)) return slow();
    const b = await body(req), text = String(b.text || '').trim().slice(0, 1000);
    if (text.length < 3) return bad('Write a few words first');
    let shot = typeof b.shot === 'string' ? b.shot : null;
    if (shot && (!/^data:image\/(jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(shot) || shot.length > 120 * 1024)) shot = null;
    const mt = b.meta && typeof b.meta === 'object' ? b.meta : {};
    const meta = JSON.stringify({ v: Number(mt.v) | 0, dev: DEV.test(String(mt.dev || '')) ? mt.dev : 'other', screen: String(mt.screen || '').slice(0, 24), size: String(mt.size || '').slice(0, 16),
      mode: String(mt.mode || '').slice(0, 16), err: mt.err ? String(mt.err).slice(0, 300) : null, errHash: /^[a-f0-9]{16}$/.test(String(mt.errHash || '')) ? mt.errHash : null });
    await db.batch([db.prepare('INSERT INTO feedback (player, created, text, meta, shot) VALUES (?,?,?,?,?)').bind(me ? me.id : null, now, text, meta, shot), ...bumpStmts(db, dayOf(now), { fb: 1 })]);
    return json({ ok: true });
  }

  // ── rollups (cron, or the dashboard's Refresh) ──
  async function rollup(db, now, back = 14) {
    const today = dayOf(now), st = [];
    const up = (sql, ...binds) => st.push(db.prepare(`INSERT INTO ops_day (day, k, n) ${sql} ON CONFLICT(day, k) DO UPDATE SET n = excluded.n`).bind(...binds));
    for (let d = today - back; d < today; d++) {
      up(`SELECT ?, 'dau', COUNT(*) FROM active WHERE day = ?`, d, d);
      up(`SELECT ?, 'wau', COUNT(DISTINCT player) FROM active WHERE day BETWEEN ? AND ?`, d, d - 6, d);
      up(`SELECT ?, 'new', COUNT(*) FROM players WHERE created >= ? AND created < ?`, d, d * DAY, (d + 1) * DAY);
      up(`SELECT ?, 'coh', COUNT(*) FROM players WHERE created >= ? AND created < ?`, d, d * DAY, (d + 1) * DAY);
      if (d + 1 < today) up(`SELECT ?, 'r1', COUNT(*) FROM players p WHERE p.created >= ? AND p.created < ? AND EXISTS (SELECT 1 FROM active a WHERE a.day = ? AND a.player = p.id)`, d, d * DAY, (d + 1) * DAY, d + 1);
      if (d + 7 < today) up(`SELECT ?, 'r7', COUNT(*) FROM players p WHERE p.created >= ? AND p.created < ? AND EXISTS (SELECT 1 FROM active a WHERE a.day = ? AND a.player = p.id)`, d, d * DAY, (d + 1) * DAY, d + 7);
    }
    st.push(db.prepare('DELETE FROM active WHERE day < ?').bind(today - 40));
    st.push(db.prepare('DELETE FROM ops_day WHERE day < ? AND k NOT IN (?, ?, ?, ?, ?, ?)').bind(today - 120, 'dau', 'wau', 'new', 'coh', 'r1', 'r7'));
    st.push(db.prepare('DELETE FROM ops_day WHERE day < ?').bind(today - 800));
    st.push(db.prepare('DELETE FROM crash_tags WHERE hash IN (SELECT hash FROM crashes WHERE last < ?)').bind(now - 60 * DAY));
    st.push(db.prepare('DELETE FROM crashes WHERE last < ?').bind(now - 60 * DAY));
    st.push(db.prepare('DELETE FROM feedback WHERE created < ?').bind(now - 120 * DAY));
    st.push(db.prepare('DELETE FROM flag_expo WHERE flag NOT IN (SELECT key FROM flags)'));
    await db.batch(st);
    return { days: back, statements: st.length };
  }

  // ── dashboard ──
  async function summary(db, url, now) {
    const days = Math.max(7, Math.min(90, Number(url.searchParams.get('days')) || 30)), today = dayOf(now), from = today - days + 1, season = Number(url.searchParams.get('season')) | 0;
    const SERIES = ['dau', 'wau', 'new', 'coh', 'r1', 'r7', 'ev:match_start', 'ev:match_done', 'crash', 'fb', 'vm'];
    const [series, sums, live, heroes, cups, cupPl, flagged, flaggedN, crashes, fb, fbN, flags, expo, d1, subs, players] = await db.batch([
      db.prepare(`SELECT day, k, n FROM ops_day WHERE day >= ? AND k IN (${SERIES.map(() => '?').join(',')}) ORDER BY day`).bind(from, ...SERIES),
      db.prepare(`SELECT k, SUM(n) AS n FROM ops_day WHERE day >= ? AND k NOT IN (${SERIES.map(() => '?').join(',')}) AND k NOT LIKE 'c:%' GROUP BY k`).bind(from, ...SERIES),
      db.prepare(`SELECT (SELECT COUNT(*) FROM active WHERE day = ?) AS dau, (SELECT COUNT(DISTINCT player) FROM active WHERE day > ?) AS wau, (SELECT COUNT(*) FROM players WHERE created >= ?) AS new`).bind(today, today - 7, today * DAY),
      db.prepare('SELECT hero, games, wins FROM hero_results WHERE season = ?').bind(season),
      db.prepare(`SELECT status, COUNT(*) AS n FROM cups WHERE created >= ? GROUP BY status`).bind(from * DAY),
      db.prepare(`SELECT COUNT(*) AS n, COUNT(DISTINCT cp.player) AS coaches FROM cup_players cp JOIN cups c ON c.id = cp.cup WHERE c.created >= ? AND c.status IN ('live', 'done')`).bind(from * DAY),
      db.prepare(`SELECT m.id, m.mode, m.season, m.blue, m.red, m.winner, m.created, pb.name AS bname, pr.name AS rname,
        (SELECT GROUP_CONCAT(r.player || ': ' || COALESCE(r.reason, r.status), ' | ') FROM replays r WHERE r.match = m.id) AS reasons,
        (SELECT MAX(r.v) FROM replays r WHERE r.match = m.id) AS v, (SELECT COUNT(*) FROM replays r WHERE r.match = m.id AND r.data IS NOT NULL) AS blobs
        FROM matches m LEFT JOIN players pb ON pb.id = m.blue LEFT JOIN players pr ON pr.id = m.red WHERE m.verify = 'flagged' ORDER BY m.created DESC LIMIT 50`),
      db.prepare(`SELECT verify, COUNT(*) AS n FROM matches WHERE created >= ? AND verify IS NOT NULL GROUP BY verify`).bind(from * DAY),
      db.prepare(`SELECT c.hash, c.kind, c.msg, c.first, c.last, c.n, c.players, (SELECT GROUP_CONCAT(t.tag || '=' || t.n, ' ') FROM crash_tags t WHERE t.hash = c.hash) AS tags
        FROM crashes c WHERE c.last >= ? ORDER BY c.n DESC LIMIT 50`).bind(from * DAY),
      db.prepare(`SELECT f.id, f.player, p.name, f.created, f.text, f.meta, f.status, f.shot IS NOT NULL AS shot FROM feedback f LEFT JOIN players p ON p.id = f.player ORDER BY f.created DESC LIMIT 60`),
      db.prepare(`SELECT status, COUNT(*) AS n FROM feedback GROUP BY status`),
      db.prepare('SELECT key, variants, status, ship, note, created, updated FROM flags ORDER BY created DESC'),
      db.prepare('SELECT flag, variant, COUNT(*) AS n FROM flag_expo GROUP BY flag, variant'),
      // D1 return per variant: exposed on day d (d < today - 1, so day d + 1 is complete) and active on d + 1
      db.prepare(`SELECT f.flag, f.variant, COUNT(*) AS n, SUM(EXISTS (SELECT 1 FROM active a WHERE a.player = f.player AND a.day = f.day + 1)) AS back FROM flag_expo f WHERE f.day < ? AND f.day >= ? GROUP BY f.flag, f.variant`).bind(today - 1, today - 39),
      db.prepare(`SELECT COUNT(*) AS n, COUNT(DISTINCT player) AS coaches, SUM(types & 1 != 0) AS invite, SUM(types & 2 != 0) AS rematch, SUM(types & 4 != 0) AS cup, SUM(types & 8 != 0) AS event, SUM(types & 16 != 0) AS division,
        (SELECT COUNT(*) FROM push_outbox) AS outbox FROM push_subs`),
      db.prepare('SELECT COUNT(*) AS n, SUM(review > 0) AS review FROM players'),
    ]);
    const R = (x) => x.results || [];
    const sum = Object.fromEntries(R(sums).map((r) => [r.k, r.n]));
    return {
      now, today, days, from, season, series: R(series), sums: sum, live: R(live)[0] || {}, heroes: R(heroes), players: R(players)[0] || {},
      cups: { byStatus: R(cups), ...(R(cupPl)[0] || {}) }, verify: R(flaggedN), flagged: R(flagged), crashes: R(crashes),
      feedback: R(fb).map((f) => ({ ...f, meta: (() => { try { return JSON.parse(f.meta || '{}'); } catch { return {}; } })() })), feedbackBy: R(fbN),
      flags: R(flags).map((f) => ({ ...f, variants: (() => { try { return JSON.parse(f.variants || '[]'); } catch { return []; } })() })), exposures: R(expo), d1: R(d1),
      push: R(subs)[0] || {},
    };
  }

  return {
    rollup,
    route: async function ops(req, env, db, url, p, M, now) {
      if (p === '/api/ops/hello' && M === 'POST') return hello(req, env, db, now);
      if (p === '/api/ops/expose' && M === 'POST') return expose(req, env, db, now);
      if (p === '/api/ops/track' && M === 'POST') return track(req, env, db, now);
      if (p === '/api/ops/crash' && M === 'POST') return crash(req, env, db, now);
      if (p === '/api/ops/feedback' && M === 'POST') return feedback(req, env, db, now);
      if (!p.startsWith('/api/admin/ops/')) return null;
      if (!(await tokenOk(req, env, sha))) return bad('not found', 404);
      if (p === '/api/admin/ops/summary' && M === 'GET') return json(await summary(db, url, now));
      if (p === '/api/admin/ops/rollup' && M === 'POST') return json(await rollup(db, now, Math.max(1, Math.min(60, Number(url.searchParams.get('back')) || 14))));
      if (p === '/api/admin/ops/crash' && M === 'GET') {
        const hash = String(url.searchParams.get('hash') || '');
        const [c, t, d] = await db.batch([db.prepare('SELECT * FROM crashes WHERE hash = ?').bind(hash), db.prepare('SELECT tag, n FROM crash_tags WHERE hash = ? ORDER BY n DESC').bind(hash),
          db.prepare('SELECT day, n FROM ops_day WHERE k = ? AND day >= ? ORDER BY day').bind('c:' + hash, dayOf(now) - 30)]);
        const row = (c.results || [])[0]; if (!row) return bad('not found', 404);
        return json({ ...row, tags: t.results || [], daily: d.results || [] });
      }
      if (p === '/api/admin/ops/crash' && M === 'POST') { // resolve: forget the group (it comes back if it happens again)
        const b = await body(req), hash = String(b.hash || '');
        await db.batch([db.prepare('DELETE FROM crashes WHERE hash = ?').bind(hash), db.prepare('DELETE FROM crash_tags WHERE hash = ?').bind(hash)]);
        return json({ ok: true });
      }
      if (p === '/api/admin/ops/feedback' && M === 'GET') {
        const f = await db.prepare('SELECT f.*, p.name FROM feedback f LEFT JOIN players p ON p.id = f.player WHERE f.id = ?').bind(Number(url.searchParams.get('id')) | 0).first();
        return f ? json({ ...f, meta: JSON.parse(f.meta || '{}') }) : bad('not found', 404);
      }
      if (p === '/api/admin/ops/feedback' && M === 'POST') {
        const b = await body(req), st = ['new', 'done', 'deleted'].includes(b.status) ? b.status : null; if (!st) return bad('bad status');
        if (st === 'deleted') await db.prepare('DELETE FROM feedback WHERE id = ?').bind(Number(b.id) | 0).run();
        else await db.prepare('UPDATE feedback SET status = ? WHERE id = ?').bind(st, Number(b.id) | 0).run();
        return json({ ok: true });
      }
      if (p === '/api/admin/ops/flag' && M === 'POST') {
        const b = await body(req), key = String(b.key || '');
        if (!/^[a-z0-9_]{2,32}$/.test(key)) return bad('Flag keys are 2-32 characters: a-z, 0-9 and _');
        flagCache = null;
        if (b.delete) { await db.batch([db.prepare('DELETE FROM flags WHERE key = ?').bind(key), db.prepare('DELETE FROM flag_expo WHERE flag = ?').bind(key)]); return json({ ok: true, deleted: key }); }
        const vs = (Array.isArray(b.variants) ? b.variants : []).slice(0, 6).map((v) => ({ id: String(v.id || ''), w: Math.max(0, Math.min(100, Number(v.w) || 0)) })).filter((v) => /^[a-z0-9_]{1,16}$/.test(v.id));
        if (vs.length < 2 || !vs.some((v) => v.w > 0)) return bad('A flag needs at least two variants with a weight');
        const status = ['on', 'off', 'ship'].includes(b.status) ? b.status : 'off', ship = status === 'ship' ? String(b.ship || '') : null;
        if (status === 'ship' && !vs.some((v) => v.id === ship)) return bad('Pick the variant to ship');
        await db.prepare(`INSERT INTO flags (key, variants, status, ship, note, created, updated) VALUES (?,?,?,?,?,?,?)
          ON CONFLICT(key) DO UPDATE SET variants = excluded.variants, status = excluded.status, ship = excluded.ship, note = excluded.note, updated = excluded.updated`)
          .bind(key, JSON.stringify(vs), status, ship, String(b.note || '').slice(0, 200), now, now).run();
        return json({ ok: true, key });
      }
      // A flagged (or any) match's replay for the Theater: the uploaded blobs plus the coaches' names.
      if (p === '/api/admin/ops/replay' && M === 'GET') {
        const id = String(url.searchParams.get('match') || '');
        const [m, r] = await db.batch([
          db.prepare('SELECT m.id, m.mode, m.blue, m.red, m.winner, m.verify, pb.name AS bname, pr.name AS rname FROM matches m LEFT JOIN players pb ON pb.id = m.blue LEFT JOIN players pr ON pr.id = m.red WHERE m.id = ?').bind(id),
          db.prepare('SELECT player, v, enc, data, status, reason FROM replays WHERE match = ? AND data IS NOT NULL').bind(id),
        ]);
        const match = (m.results || [])[0]; if (!match) return bad('not found', 404);
        return json({ match, replays: r.results || [] });
      }
      return bad('not found', 404);
    },
  };
}
