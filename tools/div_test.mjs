// Weekly Divisions Worker test: runs worker/index.js against an in-memory SQLite stand-in for D1 (node:sqlite).
//   node tools/div_test.mjs
// Checks: lazy join, group filling (30 per group), the per-match gap and points cap, end-of-week promotion /
// demotion from stored points + the seeded AI seats, and that the client mirror (src/meta.js) agrees.
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
import { GROUP, weekStart, finalPlace, moveOf, aiSeat, fillGroup, MAX_MATCH_PTS } from '../src/data/divisions.js';
import { MIN_GAP } from '../worker/divisions.js';

// ── a minimal D1: prepare/bind/first/all/run/batch ──
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
  return { prepare: stmt, batch: async (list) => { db.exec('BEGIN'); try { const out = []; for (const s of list) out.push(await s.run()); db.exec('COMMIT'); return out; } catch (e) { db.exec('ROLLBACK'); throw e; } } };
}

let clock = weekStart(10) + 3600000;
const realNow = Date.now;
Date.now = () => clock;
const worker = (await import('../worker/index.js')).default;
const env = { DB: d1(), ASSETS: { fetch: () => new Response('') } };
const api = async (path, { method = 'GET', body, who } = {}) => {
  const headers = { 'content-type': 'application/json', 'cf-connecting-ip': who ? who.id : 'x' };
  if (who) headers.authorization = `Bearer ${who.id}.${who.secret}`;
  const r = await worker.fetch(new Request('https://t.dev' + path, { method, headers, body: body ? JSON.stringify(body) : undefined }), env);
  return { status: r.status, data: await r.json() };
};
const coaches = [];
for (let i = 0; i < 35; i++) { const r = await api('/api/account', { method: 'POST', body: { name: 'Coach' + i } }); coaches.push(r.data); }

// not joined yet: Bronze, no group
let r = await api('/api/div', { who: coaches[0] });
assert.equal(r.status, 200); assert.equal(r.data.joined, false); assert.equal(r.data.league, 0);
// first report joins; everyone fills group 0, then group 1
for (let i = 0; i < 35; i++) { r = await api('/api/div/report', { method: 'POST', who: coaches[i], body: { won: i % 2 === 0, calls: 99 } }); assert.equal(r.data.ok, true); }
assert.equal(r.data.grp, 1, 'the 31st coach opens group 1');
r = await api('/api/div', { who: coaches[0] });
assert.equal(r.data.grp, 0); assert.equal(r.data.members.length, GROUP);
assert.ok(r.data.members.every((m) => m.pts <= MAX_MATCH_PTS), 'points capped per match');
// too soon: refused, then accepted after the gap
r = await api('/api/div/report', { method: 'POST', who: coaches[0], body: { won: true, calls: 3 } });
assert.equal(r.data.ok, false);
clock += MIN_GAP + 1000;
// coach 0 plays 8 more wins (top of group 0); coach 1 never plays again (bottom-ish)
for (let k = 0; k < 8; k++) { r = await api('/api/div/report', { method: 'POST', who: coaches[0], body: { won: true, calls: 3 } }); assert.equal(r.data.ok, true); clock += MIN_GAP + 1000; }
const me0 = r.data.members.find((m) => m.me); assert.equal(me0.pts, 16 + 8 * MAX_MATCH_PTS);
const others0 = r.data.members.filter((m) => !m.me).map((m) => m.pts);
// next week: coach 0's finish matches the shared rule, and the client mirror computes the same place
clock = weekStart(11) + 1000;
r = await api('/api/div', { who: coaches[0] });
const place = finalPlace(10, 0, 0, me0.pts, others0);
assert.equal(r.data.joined, false); assert.deepEqual(r.data.last, { week: 10, place, move: moveOf(place, 0), league: 0 });
assert.equal(r.data.league, moveOf(place, 0) > 0 ? 1 : 0);
r = await api('/api/div/report', { method: 'POST', who: coaches[0], body: { won: true, calls: 0 } });
assert.equal(r.data.joined, true); assert.equal(r.data.last.place, place);
// a full group never has AI seats on the server, the client fills the rest (labelled ai)
const g = fillGroup(11, r.data.league, r.data.grp, r.data.members, 0.5);
assert.equal(g.length, GROUP); assert.ok(g.filter((x) => x.ai).every((x) => /^AI /.test(x.name)));
assert.equal(aiSeat(11, 1, 0, 3, 0.4).pts, aiSeat(11, 1, 0, 3, 0.4).pts, 'AI seats are seeded');
// unauthorized
r = await api('/api/div'); assert.equal(r.status, 401);
Date.now = realNow;
console.log(`divisions worker OK (week-10 finish: place ${place}, league now ${place <= 5 ? 'Silver' : 'Bronze'})`);
