// Koban Worker test: the champion ledger (seed, claims and their bounds), purchases and free picks validated
// on the server, the Ranked entry and report checks, and the guarded, idempotent launch wipe. Runs
// worker/index.js against an in-memory SQLite stand-in for D1 (node:sqlite), like tools/social2_test.mjs.
// (tools/koban_wrangler.mjs runs the purchase checks against a real `wrangler dev`.)
//   node tools/koban_test.mjs
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
import { ECON, STARTERS, priceOf, tierOf, ALL_IDS, rotation, weekOf, RANKED_OWNED, DATA_VERSION } from '../src/data/unlocks.js';
import { WIPE_TABLES, WIPE_STEP, autoWipeStep } from '../worker/koban.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  const stmt = (sql) => {
    let args = [];
    const s = { bind: (...a) => { args = a.map((v) => (v === undefined ? null : typeof v === 'boolean' ? Number(v) : v)); return s; },
      first: async () => db.prepare(sql).get(...args) || null,
      all: async () => ({ results: db.prepare(sql).all(...args) }),
      run: async () => { const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes) } }; } };
    return s;
  };
  const exec = async (s) => { try { return { results: await s.all().then((r) => r.results), meta: { changes: 0 } }; } catch { return s.run(); } };
  let lock = Promise.resolve();
  const batch = (list) => (lock = lock.catch(() => 0).then(async () => { db.exec('BEGIN'); try { const out = []; for (const s of list) out.push(await exec(s)); db.exec('COMMIT'); return out; } catch (e) { db.exec('ROLLBACK'); throw e; } }));
  return { raw: db, prepare: stmt, batch };
}
let clock = Date.UTC(2026, 10, 23, 9, 0, 0); // a Monday
Date.now = () => clock;
const worker = (await import('../worker/index.js')).default;
const TOKEN = 'admin-token-0123456789';
const env = { DB: d1(), ASSETS: { fetch: () => new Response('') }, MOBAVS_ADMIN: TOKEN };
let n = 0;
const api = async (path, { method = 'GET', body, who, token } = {}) => {
  const headers = { 'content-type': 'application/json', 'cf-connecting-ip': who ? who.id : 'ip' + (n++ % 50) };
  if (who) headers.authorization = `Bearer ${who.id}.${who.secret}`;
  if (token) headers.authorization = `Bearer ${token}`;
  const r = await worker.fetch(new Request('https://t.dev' + path, { method, headers, body: body ? JSON.stringify(body) : undefined }), env, { waitUntil() {} });
  return { status: r.status, data: await r.json() };
};
const ok = (label) => console.log('  ✔ ' + label);
const acct = async (name) => (await api('/api/account', { method: 'POST', body: { name } })).data;

let r = await api('/api/health'); assert.equal(r.data.tables, true, 'tables: ' + r.data.missing); assert.equal(r.data.dv, 1); ok('health: koban + kv tables, data version 1');
const A = await acct('Ann'), B = await acct('Ben'), C = await acct('Cat');
r = await api('/api/health'); assert.equal(r.data.dv, DATA_VERSION); ok('auto wipe: a fresh database (empty tables) is current on its first request, no 503s');

// ── ledger: fresh, claims and their bounds ──
r = await api('/api/koban', { who: A }); assert.equal(r.data.state, null); assert.equal(r.data.dv, DATA_VERSION);
r = await api('/api/koban/sync', { method: 'POST', who: A, body: { claims: [{ k: 'm', won: true, t: clock }] } });
assert.equal(r.data.fresh, true); assert.equal(r.data.state.bal, 0, 'a first sync without a seed starts at zero (claims are not double counted)');
const t0 = clock;
r = await api('/api/koban/sync', { method: 'POST', who: A, body: { claims: [{ k: 'm', won: true, t: t0 }] } });
assert.equal(r.data.state.bal, ECON.win * 2 + ECON.firstWin, 'rookie x2 + first win'); assert.equal(r.data.state.g, 1);
r = await api('/api/koban/sync', { method: 'POST', who: A, body: { claims: [{ k: 'm', won: true, t: t0 + 1000 }] } }); assert.equal(r.data.credited, 0, 'min gap between paid matches');
clock += ECON.minGap;
r = await api('/api/koban/sync', { method: 'POST', who: A, body: { claims: [{ k: 'm', won: true, t: t0 + ECON.minGap }] } }); assert.equal(r.data.credited, ECON.win * 2, 'second win of the day: no first-win bonus');
r = await api('/api/koban/sync', { method: 'POST', who: A, body: { claims: [{ k: 'm', won: false, t: clock + 3600000 }] } }); assert.equal(r.data.credited, 0, 'claims from the future are refused');
r = await api('/api/koban/sync', { method: 'POST', who: A, body: { claims: [{ k: 'g', tier: 2, t: t0 }, { k: 'g', tier: 2, t: t0 }, { k: 'g', tier: 0, t: t0 }] } });
assert.equal(r.data.credited, ECON.goal[2] + ECON.goal[0], 'each goal tier once a day');
r = await api('/api/koban/sync', { method: 'POST', who: A, body: { claims: [{ k: 'lv', lv: 40 }] } });
assert.ok(r.data.state.lv < 10 && r.data.credited === (r.data.state.lv - 1) * ECON.level, 'coach level bounded by paid matches: ' + r.data.state.lv);
r = await api('/api/koban/sync', { method: 'POST', who: A, body: { claims: [{ k: 'a', id: 'first_win' }, { k: 'a', id: 'first_win' }, { k: 'a', id: 'Bad Id!' }] } });
assert.equal(r.data.credited, ECON.ach, 'achievements pay once, known-shaped ids only');
r = await api('/api/koban/sync', { method: 'POST', who: A, body: { claims: Array.from({ length: 12 }, (_, i) => ({ k: 'c', n: i ? 9999 : 200, id: i ? 'campaign:c1m' + i : 'tutorial' })) } });
assert.equal(r.data.credited, ECON.campaign, 'campaign + academy: at most 600 a grant, lifetime cap'); assert.equal(r.data.state.cp, ECON.campaign);
r = await api('/api/koban/sync', { method: 'POST', who: A, body: { claims: [{ k: 'p', s: 3, lv: 30 }] } });
assert.equal(r.data.credited, 0, 'pass: a new season starts at level 1 with no paid matches in it');
ok('claims: rookie boost, first win once a day, 90 s gap, no future claims, goal tiers once a day, bounded levels and pass, achievements once');
// daily cap: at most ECON.dayMatches paid matches a UTC day
clock = Date.UTC(2026, 10, 24, 23, 0, 0);
const many = Array.from({ length: ECON.dayMatches + 5 }, (_, i) => ({ k: 'm', won: false, t: Date.UTC(2026, 10, 24, 0, 10) + i * ECON.minGap }));
r = await api('/api/koban/sync', { method: 'POST', who: A, body: { claims: many } });
assert.equal(r.data.state.dg, ECON.dayMatches); assert.equal(r.data.credited, ECON.dayMatches * ECON.loss * 2 - (r.data.state.g > ECON.rookieGames ? (r.data.state.g - ECON.rookieGames) * ECON.loss : 0));
ok(`daily cap: ${ECON.dayMatches} paid of ${many.length} sent; the rookie boost ends after ${ECON.rookieGames} matches`);

// ── seeding from an offline ledger, bounded ──
const greedy = { bal: 999999, own: ALL_IDS.filter((id) => !STARTERS.includes(id)), g: 99999, lv: 40, picks: 10 };
r = await api('/api/koban/sync', { method: 'POST', who: B, body: { seed: greedy, claims: [{ k: 'm', won: true, t: clock }] } });
const val = r.data.state.own.reduce((a, id) => a + priceOf(id), 0) + r.data.state.bal;
assert.equal(r.data.fresh, true); assert.ok(val <= 30000, 'seed value capped: ' + val); assert.ok(r.data.state.g <= 3000);
r = await api('/api/koban/sync', { method: 'POST', who: B, body: { seed: greedy, claims: [] } }); assert.equal(r.data.fresh, false);
assert.ok(r.data.state.own.reduce((a, id) => a + priceOf(id), 0) + r.data.state.bal <= 30000, 'a second seed is ignored');
ok(`seed: owned value + balance capped (${val}), only on the first sync`);

// ── purchases and free picks ──
const gen = ALL_IDS.find((id) => tierOf(id) === 'G' && !STARTERS.includes(id)), leg = ALL_IDS.find((id) => tierOf(id) === 'L');
r = await api('/api/koban/buy', { method: 'POST', who: C, body: { hero: gen } }); assert.equal(r.status, 409, 'buy before any sync');
await api('/api/koban/sync', { method: 'POST', who: C, body: {} });
r = await api('/api/koban/buy', { method: 'POST', who: C, body: { hero: gen } }); assert.equal(r.status, 400); assert.match(r.data.error, /more Koban/);
r = await api('/api/koban', { who: A }); const balA = r.data.state.bal;
r = await api('/api/koban/buy', { method: 'POST', who: A, body: { hero: 'notahero' } }); assert.equal(r.status, 400);
r = await api('/api/koban/buy', { method: 'POST', who: A, body: { hero: STARTERS[0] } }); assert.equal(r.status, 400); assert.match(r.data.error, /Already/);
r = await api('/api/koban/buy', { method: 'POST', who: A, body: { hero: gen } });
assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(r.data.state.bal, balA - priceOf(gen)); assert.ok(r.data.state.own.includes(gen));
r = await api('/api/koban/buy', { method: 'POST', who: A, body: { hero: gen } }); assert.equal(r.status, 400, 'no double buy');
r = await api('/api/koban/buy', { method: 'POST', who: C, body: { hero: leg } }); assert.equal(r.status, 400, 'Legend costs 6,000');
// two purchases racing: only what the balance covers goes through
{ const row = env.DB.raw.prepare('SELECT st FROM koban WHERE player = ?').get(A.id), st = JSON.parse(row.st); st.bal = 3200; env.DB.raw.prepare('UPDATE koban SET st = ? WHERE player = ?').run(JSON.stringify(st), A.id); }
const cheap = ALL_IDS.filter((id) => tierOf(id) === 'G' && !STARTERS.includes(id) && id !== gen).slice(0, 4);
r = await api('/api/koban', { who: A }); const before = r.data.state;
const res = await Promise.all(cheap.map((hero) => api('/api/koban/buy', { method: 'POST', who: A, body: { hero } })));
r = await api('/api/koban', { who: A });
assert.equal(r.data.state.bal, before.bal - (r.data.state.own.length - before.own.length) * 1500, 'balance matches what was bought');
assert.ok(r.data.state.bal >= 0); assert.equal(r.data.state.own.length - before.own.length, 2, 'exactly two fit 3,200'); ok(`buy: server checks price, balance, ownership; ${res.filter((x) => x.status === 200).length} of ${cheap.length} racing buys fit the balance`);
r = await api('/api/koban/pick', { method: 'POST', who: A, body: { hero: gen } }); assert.equal(r.status, 400); assert.match(r.data.error, /No free pick/);
r = await api('/api/koban/pick', { method: 'POST', who: B, body: { hero: leg } }); assert.equal(r.status, 400);
r = await api('/api/koban', { who: B }); const pB = r.data.state;
const nextGen = ALL_IDS.find((id) => tierOf(id) === 'G' && !STARTERS.includes(id) && !pB.own.includes(id));
if (Math.floor(pB.lv / ECON.pickEvery) > pB.picks && nextGen) {
  r = await api('/api/koban/pick', { method: 'POST', who: B, body: { hero: nextGen } }); assert.equal(r.status, 200); assert.ok(r.data.state.own.includes(nextGen));
}
ok('free picks: Generals only, only when earned');

// ── Ranked entry and Ranked reports ──
r = await api('/api/queue/find', { method: 'POST', who: C, body: { version: 1, mode: 'ranked' } }); assert.equal(r.status, 403); assert.match(r.data.error, /25 champions/);
r = await api('/api/queue/find', { method: 'POST', who: C, body: { version: 1, mode: 'casual' } }); assert.equal(r.status, 200, 'casual is open');
env.DB.raw.prepare('UPDATE koban SET owned = ? WHERE player = ?').run(RANKED_OWNED, C.id);
r = await api('/api/queue/find', { method: 'POST', who: C, body: { version: 1, mode: 'ranked' } }); assert.equal(r.status, 200);
const locked = ALL_IDS.find((id) => !STARTERS.includes(id) && !rotation(weekOf(clock)).includes(id) && !rotation(weekOf(clock) - 1).includes(id));
const rep = (picks) => api('/api/match/report', { method: 'POST', who: C, body: { match: 'MTESTMATCH01', season: 1, side: 0, opponent: A.id, winner: 0, checksum: '1', mode: 'ranked', summary: { picks: [picks, []] } } });
r = await rep([STARTERS[0], STARTERS[3], STARTERS[6], STARTERS[9], locked]); assert.equal(r.status, 403, 'unowned pick in Ranked');
r = await rep([STARTERS[0], STARTERS[3], STARTERS[6], STARTERS[9], rotation(weekOf(clock))[0]]); assert.equal(r.status, 200, 'rotation heroes are fine: ' + JSON.stringify(r.data));
ok('Ranked: queue needs 25 owned (server-side), reports must use owned or free-rotation picks');

// ── launch wipe ──
// (the first request above moved the fresh database to DATA_VERSION; roll it back to 1 so the admin wipe runs on real data)
env.DB.raw.prepare("DELETE FROM kv WHERE k = 'dv' OR k LIKE 'wipe:%'").run();
r = await api('/api/admin/wipe', { method: 'POST', body: { dv: 2, confirm: 'ARCHIVE-AND-WIPE' } }); assert.equal(r.status, 404, 'hidden without the token');
r = await api('/api/admin/wipe', { method: 'POST', token: 'wrong-token-0123456789', body: { dv: 2, confirm: 'ARCHIVE-AND-WIPE' } }); assert.equal(r.status, 404);
r = await api('/api/admin/wipe', { method: 'POST', token: TOKEN, body: { dv: 2 } }); assert.equal(r.status, 400, 'needs the confirm phrase');
r = await api('/api/admin/wipe', { method: 'POST', token: TOKEN, body: { dv: 3, confirm: 'ARCHIVE-AND-WIPE' } }); assert.equal(r.status, 400, 'one data version at a time');
r = await api('/api/admin/wipe', { token: TOKEN }); assert.equal(r.data.dv, 1); const countsBefore = r.data.counts;
assert.ok(countsBefore.players >= 3 && countsBefore.koban >= 3);
env.DB.raw.prepare("INSERT INTO flags (key, variants, status, created, updated) VALUES ('keepme', '[]', 'on', 1, 1)").run();
let calls = 0;
do { r = await api('/api/admin/wipe', { method: 'POST', token: TOKEN, body: { dv: 2, confirm: 'ARCHIVE-AND-WIPE' } }); assert.equal(r.status, 200, JSON.stringify(r.data)); calls++; } while (!r.data.done && calls < 20);
assert.equal(calls, Math.ceil(WIPE_TABLES.length / WIPE_STEP), 'incremental: a few tables per call');
const cnt = (t) => env.DB.raw.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
assert.equal(cnt('players'), 0); assert.equal(cnt('koban'), 0); assert.equal(cnt('players_beta'), countsBefore.players); assert.equal(cnt('koban_beta'), countsBefore.koban);
assert.ok(cnt('ladder_beta') >= 0 && cnt('reports_beta') >= 1);
r = await api('/api/health'); assert.equal(r.data.dv, 2); assert.equal(r.data.tables, true);
r = await api('/api/admin/wipe', { method: 'POST', token: TOKEN, body: { dv: 2, confirm: 'ARCHIVE-AND-WIPE' } }); assert.equal(r.data.done, true); assert.match(r.data.note, /already/);
assert.equal(cnt('players_beta'), countsBefore.players, 'a re-run keeps the archive');
const D = await acct('Dee'); r = await api('/api/koban/sync', { method: 'POST', who: D, body: {} }); assert.equal(r.status, 200); assert.equal(cnt('players'), 1);
r = await api('/api/koban', { who: A }); assert.equal(r.status, 401, 'old accounts are gone');
assert.equal(cnt('flags'), 1, 'A/B flags (config) are kept');
r = await api('/api/admin/wipe', { method: 'POST', token: TOKEN, body: { dv: DATA_VERSION + 1, confirm: 'ARCHIVE-AND-WIPE' } }); assert.equal(r.status, 400, 'never past the shipped DATA_VERSION');
ok(`wipe: token + confirm, ${calls} calls, tables archived to *_beta and emptied, idempotent, fresh accounts work after`);
// the automatic wipe (worker/index.js runs it on API requests until the database is current): only tables with rows
// are archived, a few per request; empty ones are marked in one go
env.DB.raw.prepare("DELETE FROM kv WHERE k = 'dv' OR k LIKE 'wipe:%'").run();
const nonEmpty = WIPE_TABLES.filter((t) => cnt(t) > 0), players = cnt('players');
let steps = 0; while (!(await autoWipeStep(env.DB, clock)) && steps < 30) steps++;
assert.equal(steps + 1, Math.max(1, Math.ceil(nonEmpty.length / 2)), 'two non-empty tables per request');
assert.ok(players >= 1 && cnt('players') === 0 && cnt('players_beta') === players, 'archived and emptied');
r = await api('/api/health'); assert.equal(r.data.dv, DATA_VERSION);
ok(`auto wipe: ${nonEmpty.length} non-empty tables archived in ${steps + 1} requests`);
console.log('koban worker tests passed');
