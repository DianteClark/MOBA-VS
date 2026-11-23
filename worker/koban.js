// Koban (champion unlocks): the server-side ledger, purchases, free picks, the Ranked entry check, and the
// launch wipe. Rules live in src/data/unlocks.js and are shared with the client, so both compute the same.
//
// Cheap by design: one row per coach (the ledger as a small JSON blob, plus the owned count for the Ranked
// check), one indexed read and one conditional write per call. Earnings come from the coach's own client
// (vs-AI matches cannot be verified), so every claim is re-computed and bounded here (applyClaim): pay is
// computed from (won) and the server's own match count, paid matches need 90 s between them and stop at 30
// a UTC day, goals pay once per tier per day, levels are bounded by the paid matches, achievements pay once.
// Purchases and picks check price, balance and tier here; a client cannot grant itself champions.
// Writes are optimistic (WHERE rev = old rev): two devices racing never double-spend.
import { STARTERS, RANKED_OWNED, cleanLedger, freshLedger, seedLedger, applyClaim, buyIn, pickIn, ownsIn, ownedCountIn, rotation, weekOf, isHero, DATA_VERSION } from '../src/data/unlocks.js';

export const KOBAN_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS koban (player TEXT PRIMARY KEY, st TEXT, owned INTEGER DEFAULT 15, rev INTEGER DEFAULT 0, created INTEGER, updated INTEGER)`,
  // small key/value config: the data version of the last launch wipe and its per-table progress
  `CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT, updated INTEGER)`,
];
export const KOBAN_TABLES = ['koban', 'kv'];
const CLAIMS_MAX = 80;

const view = (st) => ({ bal: st.bal, own: st.own, g: st.g, fw: st.fw, day: st.day, dg: st.dg, dk: st.dk, at: st.at, lv: st.lv, ach: st.ach, ps: st.ps, pl: st.pl, pg: st.pg, picks: st.picks, cp: st.cp, earned: st.earned, spent: st.spent, t0: st.t0 });
const parse = (row) => { try { return cleanLedger(JSON.parse(row.st)); } catch { return freshLedger(); } };

// Ranked entry (queue/find and private Ranked rooms): owned champions on the server, starters included.
export async function rankedOwned(db, player) {
  const r = await db.prepare('SELECT owned FROM koban WHERE player = ?').bind(player).first();
  return r ? r.owned : STARTERS.length;
}
export const rankedBlock = (owned) => (owned >= RANKED_OWNED ? null : `Own ${RANKED_OWNED} champions to play Ranked (you have ${owned})`);
// Ranked report: every pick of the reporter's side must be owned or in the free rotation (this week or last:
// a match can straddle Monday 00:00 UTC). Ranked needs 25 owned, so no loaners or trials there.
export async function picksOwned(db, player, picks, now) {
  const r = await db.prepare('SELECT st FROM koban WHERE player = ?').bind(player).first();
  const st = r ? parse(r) : freshLedger(), w = weekOf(now), free = new Set([...rotation(w), ...rotation(w - 1)]);
  return (Array.isArray(picks) ? picks : []).every((id) => !isHero(id) || ownsIn(st, id) || free.has(id));
}

export function kobanApi(H) {
  const { json, bad, body, auth, limited, slow } = H;
  const save = (db, me, st, row, now) => (row
    ? db.prepare('UPDATE koban SET st = ?, owned = ?, rev = rev + 1, updated = ? WHERE player = ? AND rev = ?').bind(JSON.stringify(view(st)), ownedCountIn(st), now, me, row.rev)
    : db.prepare('INSERT OR IGNORE INTO koban (player, st, owned, rev, created, updated) VALUES (?,?,?,0,?,?)').bind(me, JSON.stringify(view(st)), ownedCountIn(st), now, now));
  // Read-modify-write with one retry when another device wrote in between.
  async function txn(db, me, now, fn) {
    for (let i = 0; i < 2; i++) {
      const row = await db.prepare('SELECT st, rev FROM koban WHERE player = ?').bind(me).first();
      const out = fn(row ? parse(row) : null, !!row);
      if (out.error) return out;
      const r = await save(db, me, out.st, row, now).run();
      if (r.meta && r.meta.changes) return out;
    }
    return { error: 'busy: try again', status: 409 };
  }
  return async function route(req, env, db, url, p, M, now) {
    if (!p.startsWith('/api/koban')) return null;
    const me = await auth(req, db); if (!me) return bad('unauthorized', 401);
    if (limited('kb:' + me.id, 30)) return slow();
    if (p === '/api/koban' && M === 'GET') {
      const row = await db.prepare('SELECT st FROM koban WHERE player = ?').bind(me.id).first();
      return json({ state: row ? view(parse(row)) : null, dv: DATA_VERSION });
    }
    if (p === '/api/koban/sync' && M === 'POST') {
      const b = await body(req), claims = (Array.isArray(b.claims) ? b.claims : []).slice(0, CLAIMS_MAX);
      let credited = 0, fresh = false;
      const out = await txn(db, me.id, now, (st, had) => {
        if (!had) { fresh = true; return { st: b.seed ? seedLedger(b.seed, now) : freshLedger(now) }; } // a seed already holds its claims
        for (const c of claims) credited += applyClaim(st, c, now).reduce((a, x) => a + x[1], 0);
        return { st };
      });
      if (out.error) return bad(out.error, out.status || 400);
      return json({ state: view(out.st), credited, fresh });
    }
    if ((p === '/api/koban/buy' || p === '/api/koban/pick') && M === 'POST') {
      const b = await body(req), hero = String(b.hero || '');
      const out = await txn(db, me.id, now, (st) => {
        if (!st) return { error: 'Sync first', status: 409 };
        const err = p === '/api/koban/buy' ? buyIn(st, hero) : pickIn(st, hero);
        return err ? { error: err, status: 400 } : { st };
      });
      if (out.error) return bad(out.error, out.status || 400);
      return json({ state: view(out.st) });
    }
    return bad('not found', 404);
  };
}

// ── launch wipe (prepared; the coordinator runs it once at the final launch) ──
// POST /api/admin/wipe { dv: N, confirm: 'ARCHIVE-AND-WIPE' } with the MOBAVS_ADMIN bearer token.
// Every table in WIPE_TABLES is copied to <table>_beta (dv 2; later wipes: <table>_dv<N-1>), then emptied, one
// table per transaction (D1 batch), and marked done in kv. A call handles WIPE_STEP tables and answers
// { done: false, left } until the last one, which sets the new data version ({ done: true }). Re-running is
// safe: finished tables are skipped and a finished wipe answers { done: true } without touching anything. Kept as they are: cups/pro/flags
// configuration (env + code), live-ops counters, crash reports and feedback, A/B flags, share links.
// GET /api/admin/wipe shows the status (current dv, per-table progress, row counts).
export const WIPE_TABLES = ['players', 'ladder', 'reports', 'matches', 'hero_results', 'queue', 'friends', 'invites',
  'replays', 'cups', 'cup_players', 'cup_matches', 'div_members', 'clubs', 'club_members', 'club_week', 'club_chat', 'club_wars',
  'hub', 'hub_votes', 'duo_queue', 'push_subs', 'push_outbox', 'pro_picks', 'pro_scores', 'koban'];
export const WIPE_STEP = 6; // tables per call (5 queries each)
export const archiveName = (t, dv) => (dv === 2 ? `${t}_beta` : `${t}_dv${dv - 1}`);
export async function dataVersion(db) {
  const r = await db.prepare("SELECT v FROM kv WHERE k = 'dv'").first();
  return r ? Number(r.v) | 0 : 1;
}
// Automatic launch wipe: when the shipped DATA_VERSION (src/data/unlocks.js, shared with the client) is ahead of the
// database's, each API request archives-and-empties up to `step` more tables (same rules as POST /api/admin/wipe:
// copy to <table>_beta, then empty; idempotent; finished tables skipped) until the database reaches it.
// Returns true once the database is at DATA_VERSION. No token needed: shipping the new DATA_VERSION is the decision.
export async function autoWipeStep(db, now, step = 2) {
  const cur = await dataVersion(db);
  if (cur >= DATA_VERSION) return true;
  const dv = cur + 1;
  const have = new Set(((await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()).results || []).map((r) => r.name));
  const marks = new Set(((await db.prepare('SELECT k FROM kv WHERE k LIKE ?').bind(`wipe:${dv}:%`).all()).results || []).map((r) => r.k));
  const todo = WIPE_TABLES.filter((t) => have.has(t) && !marks.has(`wipe:${dv}:${t}`));
  // empty tables have nothing to archive: mark them all at once (2 queries), so a fresh database (a new deploy,
  // the test Workers) is current on its first request instead of refusing writes for a dozen requests
  const full = todo.length ? new Set(((await db.prepare(todo.map((t) => `SELECT '${t}' AS t WHERE EXISTS (SELECT 1 FROM ${t})`).join(' UNION ALL ')).all()).results || []).map((r) => r.t)) : new Set();
  const empty = todo.filter((t) => !full.has(t));
  if (empty.length) await db.prepare(`INSERT OR REPLACE INTO kv (k, v, updated) VALUES ${empty.map(() => '(?, ?, ?)').join(', ')}`).bind(...empty.flatMap((t) => [`wipe:${dv}:${t}`, '', now])).run();
  const busy = todo.filter((t) => full.has(t));
  for (const t of busy.slice(0, step)) {
    const a = archiveName(t, dv);
    await db.batch([db.prepare(`DROP TABLE IF EXISTS ${a}`), db.prepare(`CREATE TABLE ${a} AS SELECT * FROM ${t}`), db.prepare(`DELETE FROM ${t}`),
      db.prepare('INSERT OR REPLACE INTO kv (k, v, updated) VALUES (?, ?, ?)').bind(`wipe:${dv}:${t}`, a, now)]);
  }
  if (busy.length > step) return false;
  await db.prepare("INSERT OR REPLACE INTO kv (k, v, updated) VALUES ('dv', ?, ?)").bind(String(dv), now).run();
  return dv >= DATA_VERSION;
}
export function wipeApi(H) {
  const { json, bad, body } = H;
  return async function wipe(req, env, db, url, p, M, now) {
    if (p !== '/api/admin/wipe') return null; // reached only through the admin router (token already checked)
    const cur = await dataVersion(db);
    const have = new Set(((await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()).results || []).map((r) => r.name));
    if (M === 'GET') {
      const marks = ((await db.prepare("SELECT k, v FROM kv WHERE k LIKE 'wipe:%'").all()).results || []).map((r) => r.k);
      const counts = {};
      for (const t of WIPE_TABLES.filter((x) => have.has(x))) counts[t] = ((await db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first()) || {}).n || 0;
      return json({ dv: cur, clientDv: DATA_VERSION, tables: WIPE_TABLES, done: marks, counts });
    }
    if (M !== 'POST') return bad('not found', 404);
    const b = await body(req), dv = Number(b.dv) | 0;
    if (b.confirm !== 'ARCHIVE-AND-WIPE') return bad('confirm must be ARCHIVE-AND-WIPE');
    if (dv < 2) return bad('dv must be 2 or more (the new data version)');
    if (dv <= cur) return json({ done: true, dv: cur, note: 'already at this data version: nothing changed' });
    if (dv !== cur + 1) return bad(`dv must be ${cur + 1} (one step from ${cur})`);
    if (dv > DATA_VERSION) return bad(`dv ${dv} is past the shipped DATA_VERSION ${DATA_VERSION} (clients would not reset)`);
    // D1 allows ~50 queries per request on the free plan: a few tables per call, repeat until done: true
    const marks = new Set(((await db.prepare('SELECT k FROM kv WHERE k LIKE ?').bind(`wipe:${dv}:%`).all()).results || []).map((r) => r.k));
    const todo = WIPE_TABLES.filter((t) => have.has(t) && !marks.has(`wipe:${dv}:${t}`)), now6 = todo.slice(0, WIPE_STEP), done = [];
    for (const t of now6) {
      const a = archiveName(t, dv);
      await db.batch([db.prepare(`DROP TABLE IF EXISTS ${a}`), db.prepare(`CREATE TABLE ${a} AS SELECT * FROM ${t}`), db.prepare(`DELETE FROM ${t}`),
        db.prepare('INSERT OR REPLACE INTO kv (k, v, updated) VALUES (?, ?, ?)').bind(`wipe:${dv}:${t}`, a, now)]);
      done.push(t);
    }
    const left = todo.slice(now6.length);
    if (left.length) return json({ done: false, dv, archived: done, left });
    await db.prepare("INSERT OR REPLACE INTO kv (k, v, updated) VALUES ('dv', ?, ?)").bind(String(dv), now).run();
    return json({ done: true, dv, archived: done, left: [] });
  };
}
