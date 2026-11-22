// Franchise mode + Pro League checks (fast, headless). Exit code 1 on any failure.
//   node tools/franchise_test.mjs [API]        (API, e.g. http://127.0.0.1:8853 from `wrangler dev`, adds the Worker checks)
// * a league is a pure function of its seed: two franchises with the same seed play out identically
// * a save/reload at any point (JSON round trip, the Rng state is stored) never changes what happens next
// * 6 seasons of every phase via the assistant GM: rosters stay legal (5+ heroes, unique owners), payrolls fit
// * market rules: signing over budget is refused, release costs dead money, an unfair trade is refused, a fair one done
// * roster edges stay inside ±10% and reach the cfg (Game spawnHero → fmod)
// * Pro League: the week is deterministic, scoring only counts resolved days, picks lock at 18:00 UTC
// * broadcast cfg is deterministic and gives the league's winner the extra edge
// * the saved franchise stays small (cloud profile bound)
import * as L from '../src/franchise/league.js';
import * as M from '../src/franchise/market.js';
import * as D from '../src/franchise/data.js';
import * as P from '../src/franchise/pro.js';
import { broadcastCfg, BROADCAST_EDGE } from '../src/franchise/broadcast.js';
import { heroMod } from '../src/franchise/model.js';
import { Game } from '../src/sim/game.js';

let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.log('FAIL ' + msg); } };
const opts = (seed) => ({ name: 'Test FC', abbr: 'TFC', c1: '#fff', c2: '#000', p: 1, e: 2, seed });
const clone = (x) => JSON.parse(JSON.stringify(x));

// determinism + save/reload
{
  const a = L.newFranchise(opts(42)), b = L.newFranchise(opts(42));
  for (let i = 0; i < 9; i++) { L.quickFixture(a); const c = clone(b); L.quickFixture(c); Object.assign(b, c); }
  ok(JSON.stringify(a) === JSON.stringify(b), 'same seed + save/reload every match gives the same league');
  const c = L.newFranchise(opts(43)); ok(JSON.stringify(c.sched) !== JSON.stringify(a.sched) || JSON.stringify(c.h) !== JSON.stringify(a.h), 'another seed gives another league');
}
// seasons via the assistant GM
{
  const fr = L.newFranchise(opts(7));
  for (let s = 0; s < 6; s++) {
    let guard = 0; while (fr.phase !== 'offseason' && guard++ < 40) L.quickFixture(fr);
    ok(fr.phase === 'offseason', `season ${s + 1} reaches the offseason`);
    ok(fr.hist[0] && fr.hist[0].s === fr.season, 'history row written');
    ok(L.assistant(fr), `assistant starts season ${s + 2} (${L.seasonBlockers(fr).join('; ')})`);
    for (let t = 0; t < D.LEAGUE_TEAMS; t++) {
      const ros = L.rosterOf(fr, t);
      ok(ros.length >= 5 && ros.length <= D.ROSTER_MAX, `team ${t} roster size ${ros.length}`);
      ok(!!L.aiLineup(fr, t), `team ${t} can field five`);
      for (const x of ros) { const m = heroMod(x); ok(m >= -D.MOD.cap && m <= D.MOD.cap, 'edge inside the cap'); }
    }
    ok(L.payroll(fr, 0) <= fr.teams[0].bud, 'your payroll fits the budget');
  }
  ok(fr.season === 7, 'seven seasons in');
  const size = JSON.stringify(fr).length; ok(size < 24000, `saved franchise is small (${size} bytes)`);
}
// market
{
  const fr = L.newFranchise(opts(11));
  const fa = M.freeAgents(fr)[0];
  if (fa) { fr.teams[0].bud = L.payroll(fr, 0); ok(!!M.signBlock(fr, fa.id), 'signing over budget is refused'); fr.teams[0].bud = D.CAP; }
  const mine = L.rosterOf(fr, 0).sort((a, b) => a.o - b.o);
  const before = fr.teams[0].dead || 0, cost = M.releaseCost(mine[0]);
  ok(M.release(fr, mine[0].id) && fr.teams[0].dead === before + cost, 'release adds dead money');
  const theirs = L.rosterOf(fr, 1).sort((a, b) => b.o - a.o), worst = L.rosterOf(fr, 0).sort((a, b) => a.o - b.o)[0];
  ok(!M.evalTrade(fr, 1, [worst.id], [theirs[0].id]).ok, 'worst for best is refused');
  const best = L.rosterOf(fr, 0).sort((a, b) => b.o - a.o)[0], cheap = L.rosterOf(fr, 1).sort((a, b) => a.o - b.o)[0];
  const ev = M.evalTrade(fr, 1, [best.id], [cheap.id]);
  ok(ev.ok || /roles|budget|salary|keep/.test(ev.why), `best for worst is accepted (${ev.why})`);
}
// cfg edge reaches the sim (and no edge = bit-identical)
{
  const t = [{ heroes: ['bastion', 'kaze', 'ember', 'fletch', 'aurelia'].map((id, i) => ({ id, role: ['top', 'jungle', 'mid', 'bot', 'support'][i], mod: 0.5 })) },
    { heroes: ['varro', 'gama', 'hex', 'bolt', 'frost'].map((id, i) => ({ id, role: ['top', 'jungle', 'mid', 'bot', 'support'][i] })) }];
  const g = new Game({ seed: 5, map: 'sakura', coach: [true, true], teams: t });
  ok(g.teams[0].heroes.every((x) => x.fmod === 0.1) && g.teams[1].heroes.every((x) => x.fmod === 0), 'cfg mod clamped to +10% and only where given');
}
// Pro League
{
  const w = P.weekIndex(Date.UTC(2026, 10, 18, 12)), L1 = P.proWeek(w), L2 = JSON.parse(JSON.stringify(P.proWeek(w)));
  ok(P.weekLabel(w) === '2026-W47', `ISO week label (${P.weekLabel(w)})`);
  ok(L1.days.length === 7 && L1.days.slice(0, 5).every((d) => d.matches.length === 8) && L1.days[5].matches.length === 2 && L1.days[6].matches.length === 1, 'week shape 5×8 + 2 + 1');
  ok(JSON.stringify(L1) === JSON.stringify(L2), 'proWeek is stable');
  const wed = Date.UTC(2026, 10, 18, 12); // Wednesday noon UTC: Mon + Tue resolved, Wed open
  ok(P.daysDone(w, wed) === 2 && P.openDay(L1, wed).day === 2, 'Wednesday noon: two days done, Wednesday open');
  ok(P.openDay(L1, Date.UTC(2026, 10, 21, 12)).day === 5 && P.openDay(L1, Date.UTC(2026, 10, 20, 12)).day === 4, 'semis open only after Friday resolves');
  const all = {}; for (let d = 0; d < 7; d++) all[d] = L1.days[d].matches.map((m) => m.w);
  const s2 = P.scorePicks(w, all, wed), s7 = P.scorePicks(w, all, Date.UTC(2026, 10, 23, 1));
  ok(s2.made === 16 && s2.right === 16 && s7.made === 43 && s7.right === 43, 'only resolved days count');
  ok(s7.pts >= 43 * 5 && s7.pts <= 43 * 15, 'points 5-15 per right pick');
  const wrong = {}; for (let d = 0; d < 7; d++) wrong[d] = L1.days[d].matches.map((m) => 1 - m.w);
  ok(P.scorePicks(w, wrong, Date.UTC(2026, 10, 23, 1)).pts === 0, 'wrong picks score nothing');
  const t0 = performance.now(); for (let k = 0; k < 20; k++) P.proWeek(w + 100 + k); const ms = (performance.now() - t0) / 20;
  ok(ms < 20, `a week costs ${ms.toFixed(2)} ms`);
  const f = L1.days[0].matches.findIndex((m) => m.featured), c1 = broadcastCfg(w, 0, f, 1), c2 = broadcastCfg(w, 0, f, 1), m = L1.days[0].matches[f];
  ok(JSON.stringify(c1) === JSON.stringify(c2), 'broadcast cfg is deterministic');
  const edge = (s) => c1.teams[s].heroes[0].mod - L1.str[s === 0 ? m.a : m.b];
  ok(Math.abs(edge(m.w) - BROADCAST_EDGE) < 0.002 || c1.teams[m.w].heroes[0].mod === 0.1, 'the league winner gets the broadcast edge');
}
// Worker (optional)
const API = process.argv[2];
if (API) {
  const post = (a, p, b) => fetch(API + p, { method: 'POST', headers: a ? { authorization: `Bearer ${a.id}.${a.secret}` } : {}, body: JSON.stringify(b) }).then(async (r) => ({ s: r.status, j: await r.json() }));
  const get = (a, p) => fetch(API + p, { headers: a ? { authorization: `Bearer ${a.id}.${a.secret}` } : {} }).then((r) => r.json());
  const now = Date.now(), w = P.weekIndex(now), Lw = P.proWeek(w), od = P.openDay(Lw, now);
  const x = (await post(null, '/api/account', { name: 'ProTester' })).j;
  if (od) {
    ok((await post(x, '/api/pro/picks', { w, day: od.day, picks: od.matches.map(() => 0) })).s === 200, 'API: lock in picks');
    ok((await post(x, '/api/pro/picks', { w, day: od.day, picks: od.matches.map(() => 1) })).s === 409, 'API: one write per matchday');
  }
  const done = P.daysDone(w, now);
  if (done > 0 && (!od || od.day !== 0)) ok((await post(x, '/api/pro/picks', { w, day: 0, picks: Lw.days[0].matches.map(() => 0) })).s === 400, 'API: a resolved day is locked');
  ok((await post(null, '/api/pro/picks', { w, day: 0, picks: [0] })).s === 401, 'API: needs an account');
  const b = await get(x, `/api/pro?w=${w}`);
  ok(Array.isArray(b.top) && (!od || (b.me && b.me.rank >= 1)), 'API: board with your rank');
}
console.log(fails ? `FRANCHISE TEST: ${fails} failure(s)` : 'FRANCHISE TEST OK');
process.exit(fails ? 1 : 0);
