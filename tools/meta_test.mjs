// Meta progression test: coach skill tree sidegrades and mastery perks in the sim, plus the profile-side logic.
//   node tools/meta_test.mjs
// 1. A match with skill-tree cards, Moment variants and perks is deterministic (two runs, same checksums).
// 2. Each sidegrade card and variant fires and does what it says (buffs, reveal, empowered waves).
// 3. A match without any of them runs exactly as before the feature (cfg gating).
// 4. Daily goals / story / division / coach XP bookkeeping on a stand-in profile, and the bounds of normalizeMeta.
import assert from 'node:assert/strict';
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const { Game } = await import('../src/sim/game.js');
const { HEROES } = await import('../src/data/heroes.js');
const { sec } = await import('../src/sim/constants.js');
const { recordMeta, goalContext, normalizeMeta, ownsTactic, perksFor, coachOf, buyNode, reroll, goalsToday, divNow } = await import('../src/meta.js');
const { GOALS } = await import('../src/data/goals.js');
const { weekStart } = await import('../src/data/divisions.js');

const pick = (ids) => ids.map((id) => { const h = HEROES.find((x) => x.id === id); return { id, role: h.role, build: h.rec }; });
const A = ['bastion', 'kaze', 'ember', 'fletch', 'oak'], B = ['kenshi', 'leonin', 'raiden', 'marlowe', 'wu'];
const cfgOf = (extra = {}) => ({ seed: 7, map: 'sakura', coach: [true, true], teams: [
  { heroes: pick(A), plan: 'objective', ...(extra.t0 || {}) }, { heroes: pick(B), plan: 'scale', ...(extra.t1 || {}) }], ...(extra.cfg || {}) });
function run(cfg, ticks, cmds = {}) {
  const g = new Game(JSON.parse(JSON.stringify(cfg))), sums = [];
  while (!g.over && g.tick < ticks) { g.step(cmds[g.tick] || []); g.fx.length = 0; if (g.tick % 200 === 0) sums.push(g.checksum()); }
  return { g, sums };
}
const T = sec(150);
const meta = { t0: { deck: ['drums', 'stone', 'foxfire'], mv: { rally: 'bulwark', timeout: 'huddle', push: 'march' } }, cfg: { perks: [{ bastion: 'grit', kaze: 'edge' }, null] } };
// 1. determinism
const r1 = run(cfgOf(meta), T), r2 = run(cfgOf(meta), T);
assert.deepEqual(r1.sums, r2.sums, 'sidegrades and perks are deterministic');
// 2. effects
const ev = (g, ty) => g.events.filter((e) => e.type === ty);
{
  const g = new Game({ ...cfgOf(meta), coach: [false, true] }); // team 0 is ours: no AI coach spends the cards first
  while (g.time < 90) { g.step([]); g.fx.length = 0; }
  const kaze = g.teams[0].heroes.find((h) => h.heroId === 'kaze'), kenshi = g.teams[1].heroes[0];
  assert.equal(kaze.perk, 'edge'); assert.ok(!kenshi.perk);
  const before = kaze.stats.dmgPct;
  g.step([{ team: 0, type: 'tactic', card: 'drums' }]);
  assert.ok(ev(g, 'tactic').some((e) => e.card === 'drums'), 'War Drums played');
  g.step([]); assert.ok(kaze.stats.dmgPct > before, 'War Drums adds damage');
  g.step([{ team: 0, type: 'tactic', card: 'foxfire' }]); g.step([]);
  assert.ok(g.teams[1].heroes.every((e) => !e.alive || e.revealUntil > g.tick + sec(8)), 'Foxfire reveals every enemy for 9s');
  g.step([{ team: 0, type: 'tactic', card: 'stone' }]); g.step([]);
  assert.ok(kaze.stats.drPct >= 0.15, 'Stone Skin: damage reduction');
  while (g.time < 80 * g.rules.k + 2) { g.step([]); g.fx.length = 0; }
  g.step([{ team: 0, type: 'moment', id: 'rally' }]);
  const mo = ev(g, 'moment').find((e) => e.team === 0);
  assert.ok(mo && mo.v === 'bulwark', 'the Rally slot fires Hold the Line');
  g.step([]); assert.ok(kaze.stats.asPct > 0 && kaze.stats.drPct > 0, 'Hold the Line: attack speed + damage reduction');
  while (g.teams[0].momentCd > g.tick) { g.step([]); g.fx.length = 0; }
  g.step([{ team: 0, type: 'moment', id: 'push' }]);
  assert.deepEqual(Object.values(g.teams[0].siegeWaves), [2, 2, 2], 'Long March: two empowered waves per lane');
  assert.equal(g.teams[0].allOut, 0, 'Long March: no super minion');
}
// unknown variants are ignored; perks cannot be smuggled onto unknown ids
{ const g = new Game(cfgOf({ t0: { mv: { rally: 'march', timeout: 'nope' } }, cfg: { perks: [{ kaze: 'godmode' }, null] } }));
  assert.equal(g.teams[0].mv, null); assert.ok(g.teams[0].heroes.every((h) => !h.perk)); }
// 3. gating: the classic cfg is untouched by the feature (same as the same cfg with empty meta fields)
const base = run(cfgOf(), T), gated = run(cfgOf({ t0: { mv: {} } }), T);
assert.deepEqual(base.sums, gated.sums, 'no variants, no perks: identical to a classic match');

// 4. profile-side bookkeeping on a stand-in profile
const P = { d: { meta: null, seasons: {}, mastery: { kaze: { pts: 2300 } } }, saved: 0, xp: 0, got: [],
  season: { id: 2 }, save() { this.saved++; }, unlock(r, out) { if (r) { this.got.push(r.id); out.push(r); if (r.also) this.unlock(r.also, out); } },
  addPassXp(x) { this.xp += x; }, mastery: (id) => ({ lv: id === 'kaze' ? 9 : 1 }) };
normalizeMeta(P.d);
assert.ok(ownsTactic(P.d.meta, 'rally') && !ownsTactic(P.d.meta, 'drums'), 'skill cards start locked');
P.d.meta.cxp = 99999;
assert.ok(buyNode(P, 't1') && ownsTactic(P.d.meta, 'drums'), 'buying t1 unlocks War Drums');
assert.equal(buyNode(P, 't3'), null, 'nodes need the one before');
assert.deepEqual(perksFor(P, ['kaze'], { online: true }), null, 'no perks online');
P.d.meta.perks.kaze = 'focus';
assert.deepEqual(perksFor(P, ['kaze', 'grok'], {}), { kaze: 'focus' }); assert.equal(perksFor(P, ['kaze'], { cup: true }), null);
const now = weekStart(20) + 3 * 86400000;
const G = goalsToday(P, now);
const ctx = goalContext(r1.g, 0);
for (const k of Object.keys(ctx)) assert.ok(ctx[k] !== undefined, k);
const big = { ...ctx, won: true, calls: 9, tactics: 9, moments: 9, kami: 9, oni: 9, kraken: 9, towers: 20, kills: 40, comp: 'dive', clans: 5, rush: true, clanHeroes: { spirit: 5 }, map: 'marsh' };
// make every goal completable in one match
for (const k of Object.keys(GOALS)) if (GOALS[k].tier === 2) big.comp = GOALS[k].text.includes('Poke') ? 'poke' : big.comp;
const out = recordMeta(P, big, { now, peakElo: 2260 });
assert.ok(out.cxp > 0 && out.lvAfter >= out.lvBefore);
assert.ok(P.got.includes('prestige') && P.got.includes('prestigeSky'), 'Prestige 1 and 3 looks at 2260 peak');
const doneAll = G.list.every((k, i) => G.prog[i] >= GOALS[k].n);
if (doneAll) assert.equal(P.d.meta.streak.n, 1);
{ const G2 = goalsToday(P); const ok = reroll(P, 0); assert.ok(ok ? G2.rr === 1 && G2.prog[0] === 0 : G2.prog[0] >= GOALS[G2.list[0]].n); assert.equal(reroll(P, 0), false, 'one reroll a day'); }
const v = divNow(P, now); assert.ok(v.pts > 0 && v.g === 1);
// next week: settles last week (solo: vs AI seats only)
divNow(P, now + 7 * 86400000); assert.ok(P.d.meta.div.last && P.d.meta.div.last.week === 20 && P.d.meta.div.pts === 0);
// bounds
P.d.meta = { cxp: 1e99, tree: ['t1', 'zz', 't1'], mv: { rally: 'march' }, perks: { nobody: 'grit', kaze: 'nope' }, story: { x: 1 }, goals: { list: ['a'] } };
normalizeMeta(P.d);
assert.deepEqual(P.d.meta.tree, ['t1']); assert.deepEqual(P.d.meta.mv, {}); assert.deepEqual(P.d.meta.perks, {}); assert.deepEqual(P.d.meta.story, {}); assert.equal(P.d.meta.goals, null);
assert.ok(JSON.stringify(P.d.meta).length < 600, 'meta save is small');
console.log(`meta OK · coach lv ${coachOf(P.d.meta).lv} · ${r1.sums.length} checkpoints`);
