// Social v2 Worker test (clubs, club points / ladder / wars, the Replay Hub, spectate presence, profile upgrade):
// runs worker/index.js against an in-memory SQLite stand-in for D1 (node:sqlite), like tools/div_test.mjs.
//   node tools/social2_test.mjs
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
import { weekStart, MAX_MEMBERS, clubPts, CHAT, WAR_FROM } from '../src/data/clubs.js';
import { MIN_GAP } from '../worker/divisions.js';
import { CHAT_KEEP } from '../worker/clubs.js';
import { HUB_DAY, HUB_MAX } from '../worker/hub.js';

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
  let lock = Promise.resolve(); // D1 runs batches one at a time; concurrent callers (the cron's Promise.all) queue here
  const batch = (list) => (lock = lock.catch(() => 0).then(async () => { db.exec('BEGIN'); try { const out = []; for (const s of list) out.push(await exec(s)); db.exec('COMMIT'); return out; } catch (e) { db.exec('ROLLBACK'); throw e; } }));
  return { raw: db, prepare: stmt, batch };
}
// a Monday + 1h of week 10
let clock = weekStart(10) + 3600000;
Date.now = () => clock;
const worker = (await import('../worker/index.js')).default;
const env = { DB: d1(), ASSETS: { fetch: () => new Response('') } };
let n = 0;
const api = async (path, { method = 'GET', body, who } = {}) => {
  const headers = { 'content-type': 'application/json', 'cf-connecting-ip': who ? who.id : 'ip' + (n++ % 50) };
  if (who) headers.authorization = `Bearer ${who.id}.${who.secret}`;
  const r = await worker.fetch(new Request('https://t.dev' + path, { method, headers, body: body ? JSON.stringify(body) : undefined }), env, { waitUntil() {} });
  return { status: r.status, data: await r.json() };
};
const cron = (at) => { const c = clock; clock = at; return worker.scheduled({ cron: '7 3 * * *' }, env, { waitUntil: (p) => p }).finally(() => { clock = c; }); };
const ok = (label) => console.log('  ✔ ' + label);

const C = [];
for (let i = 0; i < 36; i++) { const r = await api('/api/account', { method: 'POST', body: { name: 'Coach' + i } }); C.push(r.data); }
let r = await api('/api/health'); assert.equal(r.data.tables, true, 'all tables: ' + r.data.missing); ok('health: every table exists');

// ── clubs ──
r = await api('/api/club', { who: C[0] }); assert.equal(r.data.club, null);
r = await api('/api/club/create', { method: 'POST', who: C[0], body: { name: 'x', tag: 'AB' } }); assert.equal(r.status, 400);
r = await api('/api/club/create', { method: 'POST', who: C[0], body: { name: '  Sakura   Foxes <b>', tag: 'sak!u', crest: '3.2.1.99' } });
assert.equal(r.status, 200); assert.equal(r.data.club.name, 'Sakura Foxes b'); assert.equal(r.data.club.tag, 'SAKU'); assert.equal(r.data.role, 'owner');
assert.match(r.data.club.crest, /^3\.2\.1\.\d+$/); assert.match(r.data.club.code, /^[A-Z]{5}$/);
const code = r.data.club.code, clubA = r.data.club.id;
ok('create: name/tag/crest cleaned, owner, 5-letter code');
r = await api('/api/club/create', { method: 'POST', who: C[0], body: { name: 'Again', tag: 'AG' } }); assert.equal(r.status, 400);
r = await api('/api/club/code/' + code); assert.equal(r.data.members, 1); assert.equal(r.data.name, 'Sakura Foxes b'); ok('preview by code');
for (let i = 1; i < MAX_MEMBERS; i++) { r = await api('/api/club/join', { method: 'POST', who: C[i], body: { code } }); assert.equal(r.status, 200, JSON.stringify(r.data)); }
assert.equal(r.data.members.length, MAX_MEMBERS); assert.equal(r.data.club.members, MAX_MEMBERS);
r = await api('/api/club/join', { method: 'POST', who: C[30], body: { code } }); assert.equal(r.status, 400); assert.match(r.data.error, /full/);
ok(`join up to ${MAX_MEMBERS}, then full`);
// roles: officer can kick members but not officers; only the owner promotes
r = await api('/api/club/member', { method: 'POST', who: C[1], body: { id: C[2].id, action: 'promote' } }); assert.equal(r.status, 403);
r = await api('/api/club/member', { method: 'POST', who: C[0], body: { id: C[1].id, action: 'promote' } }); assert.equal(r.data.members.find((m) => m.id === C[1].id).role, 'officer');
r = await api('/api/club/member', { method: 'POST', who: C[0], body: { id: C[2].id, action: 'promote' } });
r = await api('/api/club/member', { method: 'POST', who: C[1], body: { id: C[2].id, action: 'kick' } }); assert.equal(r.status, 403);
r = await api('/api/club/member', { method: 'POST', who: C[1], body: { id: C[29].id, action: 'kick' } }); assert.equal(r.status, 200); assert.equal(r.data.club.members, MAX_MEMBERS - 1);
r = await api('/api/club', { who: C[29] }); assert.equal(r.data.club, null);
ok('roles: owner promotes, officer kicks members only');
// chat: presets only, rate limited, newest kept
r = await api('/api/club/chat', { method: 'POST', who: C[3], body: { line: 'hello' } }); assert.equal(r.status, 400);
r = await api('/api/club/chat', { method: 'POST', who: C[3], body: { line: CHAT.length } }); assert.equal(r.status, 400);
for (let i = 0; i < 8; i++) { clock += 1; r = await api('/api/club/chat', { method: 'POST', who: C[4 + i], body: { line: i % CHAT.length } }); assert.equal(r.status, 200); }
assert.equal(r.data.chat.length, 8); assert.equal(r.data.chat[7].line, 7); assert.equal(r.data.chat[7].name, 'Coach11');
let lim = 0; for (let i = 0; i < 8; i++) { const x = await api('/api/club/chat', { method: 'POST', who: C[5], body: { line: 1 } }); if (x.status === 429) lim++; }
assert.ok(lim >= 1, 'chat rate limit');
for (let i = 0; i < 80; i++) { clock += 8 - (clock % 8); await api('/api/club/chat', { method: 'POST', who: C[12 + (i % 15)], body: { line: 0 } }); }
const kept = env.DB.raw.prepare('SELECT COUNT(*) AS n FROM club_chat WHERE club = ?').get(clubA).n;
assert.ok(kept <= CHAT_KEEP + 8, 'chat pruned: ' + kept);
ok(`chat: presets only, rate limited, pruned to ~${CHAT_KEEP} (${kept})`);
// a second club for the ladder and the war
r = await api('/api/club/create', { method: 'POST', who: C[30], body: { name: 'Frost Wolves', tag: 'FRW' } }); const clubB = r.data.club.id, codeB = r.data.club.code;
for (const i of [31, 32]) await api('/api/club/join', { method: 'POST', who: C[i], body: { code: codeB } });
r = await api('/api/club/create', { method: 'POST', who: C[33], body: { name: 'Lone Crows', tag: 'LC' } }); const clubC = r.data.club.id;
// points: division reports feed club points (one request), the 150 s gap applies to both
const report = (who, won, calls) => api('/api/div/report', { method: 'POST', who, body: { won, calls } });
await report(C[3], true, 3); await report(C[4], false, 0); await report(C[30], true, 1); await report(C[33], false, 0);
r = await report(C[3], true, 3); assert.equal(r.data.ok, false);
r = await api('/api/club', { who: C[3] });
assert.equal(r.data.stats.pts, clubPts(true, 3) + clubPts(false, 0)); assert.equal(r.data.stats.g, 2); assert.equal(r.data.stats.wins, 1); assert.equal(r.data.stats.war, 0);
assert.equal(r.data.members.find((m) => m.id === C[3].id).pts, clubPts(true, 3));
assert.equal(r.data.stats.rank, 1);
r = await report(C[35], true, 3); r = await api('/api/club', { who: C[35] }); assert.equal(r.data.club, null);
ok('division reports feed club points (gap respected, clubless coaches untouched)');
r = await api('/api/club/ladder', { who: C[30] });
assert.deepEqual(r.data.top.map((x) => x.id), [clubA, clubB, clubC]); assert.equal(r.data.me.id, clubB); assert.equal(r.data.me.rank, 2);
ok('club ladder: ordered by weekly points, your rank');
// weekend: Saturday cron pairs the active clubs (top two meet, the odd one out has a bye); war points only count on the weekend
clock = weekStart(10) + WAR_FROM + 3600000;
await cron(weekStart(10) + WAR_FROM + 3 * 3600000 + 7 * 60000);
r = await api('/api/club', { who: C[0] }); assert.ok(r.data.warOpen); assert.equal(r.data.war.opp.id, clubB);
r = await api('/api/club', { who: C[33] }); assert.equal(r.data.war, null);
for (const i of [5, 6, 7]) await report(C[i], true, 2);
await report(C[31], true, 3);
r = await api('/api/club', { who: C[30] }); assert.equal(r.data.war.ours, clubPts(true, 3)); assert.equal(r.data.war.theirs, 3 * clubPts(true, 2));
ok('weekend war: paired by the cron, war score from weekend matches only');
// Monday: settled, the winner's war count goes up and last week's war is shown
clock = weekStart(11) + 3600000;
await cron(weekStart(11) + 3 * 3600000);
r = await api('/api/club', { who: C[0] }); assert.equal(r.data.lastWar.result, 'won'); assert.equal(r.data.club.wars, 1); assert.equal(r.data.stats.pts, 0);
r = await api('/api/club', { who: C[30] }); assert.equal(r.data.lastWar.result, 'lost');
ok('Monday cron settles the war (won / lost), new week starts at 0');
// leaving: the owner hands over to the oldest officer; the last member closes the club
r = await api('/api/club/leave', { method: 'POST', who: C[0] }); assert.equal(r.data.club, null);
r = await api('/api/club', { who: C[1] }); assert.equal(r.data.role, 'owner'); assert.equal(r.data.club.owner, C[1].id);
await api('/api/club/leave', { method: 'POST', who: C[33] });
r = await api('/api/club/code/' + (await api('/api/club/code/' + codeB)).data.code); assert.equal(r.status, 200);
assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM clubs WHERE id = ?').get(clubC).n, 0);
ok('owner leaves → oldest officer leads; last member leaving closes the club');
// club invites ride the friends invite system (mode 'club', room = club code)
await api('/api/social/friend', { method: 'POST', who: C[1], body: { action: 'add', id: C[34].id } });
await api('/api/social/friend', { method: 'POST', who: C[34], body: { action: 'accept', id: C[1].id } });
r = await api('/api/invite', { method: 'POST', who: C[1], body: { room: code, mode: 'club', to: C[34].id } }); assert.equal(r.status, 200);
r = await api('/api/social/presence', { method: 'POST', who: C[34], body: { status: 'menu' } }); assert.equal(r.data.invites[0].mode, 'club'); assert.equal(r.data.invites[0].room, code);
ok('club invite through the friends invite system');

// ── spectate presence: the relay id is only shown to friends, only while in a match ──
r = await api('/api/social/presence', { method: 'POST', who: C[1], body: { status: 'match', watch: 'mobavs-v1-ABCDE' } });
r = await api('/api/social/presence', { method: 'POST', who: C[34], body: { status: 'menu' } });
let f = r.data.friends.find((x) => x.id === C[1].id); assert.equal(f.presence, 'match'); assert.equal(f.watch, 'mobavs-v1-ABCDE');
await api('/api/social/presence', { method: 'POST', who: C[1], body: { status: 'menu', watch: 'mobavs-v1-ABCDE' } });
r = await api('/api/social/presence', { method: 'POST', who: C[34], body: { status: 'menu' } }); f = r.data.friends.find((x) => x.id === C[1].id); assert.equal(f.watch, undefined);
await api('/api/social/presence', { method: 'POST', who: C[1], body: { status: 'match', watch: 'bad id!' } });
r = await api('/api/social/presence', { method: 'POST', who: C[34], body: { status: 'menu' } }); f = r.data.friends.find((x) => x.id === C[1].id); assert.equal(f.watch, undefined);
ok('spectate: Watch id for friends in a match only, validated');

// ── Replay Hub ──
const pick = (ids) => ids.map((id) => ({ id, role: 'mid', build: 'x' }));
const rep = (seed, extra = {}) => ({ v: 28, cfg: { seed, map: 'sakura', teams: [{ heroes: pick(['a1', 'a2', 'a3', 'a4', 'a5']) }, { heroes: pick(['b1', 'b2', 'b3', 'b4', 'b5']) }] }, log: [[10, [{ type: 'safe', team: 0 }]]], names: ['Blue <x>', 'Red'], winner: 0, len: 700, ...extra });
r = await api('/api/hub/publish', { method: 'POST', who: C[3], body: { replay: { cfg: {} } } }); assert.equal(r.status, 400);
r = await api('/api/hub/publish', { method: 'POST', who: C[3], body: { replay: rep(1, { log: Array.from({ length: 9000 }, (_, i) => [i, [{ type: 'safe', team: 0, seq: i }]]) }) } }); assert.equal(r.status, 413, 'size cap ' + HUB_MAX);
const codes = [];
for (let i = 0; i < HUB_DAY; i++) { clock += 1000; r = await api('/api/hub/publish', { method: 'POST', who: C[3], body: { replay: rep(10 + i), meta: { kills: [12, 7], title: 'Comeback at the Kraken' } } }); assert.equal(r.status, 200); codes.push(r.data.code); }
r = await api('/api/hub/publish', { method: 'POST', who: C[3], body: { replay: rep(99) } }); assert.equal(r.status, 429);
clock += 1000; r = await api('/api/hub/publish', { method: 'POST', who: C[4], body: { replay: rep(50) } }); codes.push(r.data.code);
ok(`publish: validated, size-capped, ${HUB_DAY} a day`);
r = await api('/api/share/' + codes[0]); assert.equal(r.data.kind, 'replay'); assert.equal(r.data.data.replay.cfg.seed, 10); assert.equal(r.data.data.replay.names[0], 'Blue x');
ok('a published replay is a normal share link (/s/CODE)');
r = await api('/api/hub/vote', { method: 'POST', who: C[3], body: { code: codes[1] } }); assert.equal(r.status, 400);
for (const i of [5, 6, 7]) await api('/api/hub/vote', { method: 'POST', who: C[i], body: { code: codes[1] } });
r = await api('/api/hub/vote', { method: 'POST', who: C[5], body: { code: codes[1] } }); assert.equal(r.data.votes, 3);
await api('/api/hub/vote', { method: 'POST', who: C[5], body: { code: codes[3] } });
r = await api('/api/hub', { who: C[5] });
assert.equal(r.data.featured.code, codes[1]); assert.equal(r.data.list[0].code, codes[1]); assert.equal(r.data.list[0].votes, 3); assert.ok(r.data.list[0].voted);
assert.equal(r.data.list[0].meta.title, 'Comeback at the Kraken'); assert.deepEqual(r.data.list[0].meta.kills, [12, 7]);
r = await api('/api/hub?list=new'); assert.equal(r.data.list[0].code, codes[3]); assert.ok(!r.data.list[0].voted);
ok('upvotes: one per account, not your own; weekly top + Featured');
// profile upgrade: reel, club, signature heroes, trophy cabinet fields
await api('/api/profile', { method: 'PUT', who: C[3], body: { name: 'Coach3', at: clock, profile: { lastSeason: 1, seasons: { 1: { elo: 1200 } }, heroStats: { kaze: { g: 9, w: 6 }, ember: { g: 3, w: 1 }, oak: { g: 12, w: 4 }, x: { g: 1, w: 1 } },
  ach: { got: { a: 1, b: 1 } }, meta: { div: { best: 3 }, prestige: 2 }, history: [] } } });
r = await api('/api/player/' + C[3].id + '?season=1');
assert.equal(r.data.reel.length, 3); assert.equal(r.data.reel[0].title, 'Comeback at the Kraken'); assert.equal(r.data.club.tag, 'SAKU');
assert.deepEqual(r.data.pub.sig, [['oak', 12, 4], ['kaze', 9, 6], ['ember', 3, 1]]); assert.equal(r.data.pub.ach, 2); assert.equal(r.data.pub.league, 3); assert.equal(r.data.pub.prestige, 2);
ok('public profile: highlight reel, club, signature heroes, trophy cabinet');
// pruning: old hub entries go with their share rows
clock += 29 * 86400000;
for (let i = 0; i < 40; i++) { const who = C[8 + (i % 20)]; const x = await api('/api/hub/publish', { method: 'POST', who, body: { replay: rep(200 + i) } }); if (x.status !== 200) continue; }
const left = env.DB.raw.prepare('SELECT COUNT(*) AS n FROM hub WHERE code IN (?,?,?,?)').get(...codes).n, sl = env.DB.raw.prepare('SELECT COUNT(*) AS n FROM shares WHERE code IN (?,?,?,?)').get(...codes).n;
assert.equal(left, 0); assert.equal(sl, 0);
ok('old hub replays are pruned with their share rows');
console.log('SOCIAL2 WORKER OK');
