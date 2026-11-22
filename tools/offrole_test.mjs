// Off-role picks (v25.1): any champion in any lane.
//   node tools/offrole_test.mjs
// Checks the draft rules (any hero may be picked, AI drafts stay on-role), lineups that put a hero off-role
// (sanitize keeps it, the auto-pick honours it, prep keeps the lane), co-op seats, and the sim: heroes play the
// lane of the role they were given (a marksman in Jungle clears camps, a tank in Mid holds mid), deterministically.
import assert from 'node:assert/strict';
import { HEROES, HERO_BY_ID, ROLES } from '../src/data/heroes.js';
import { newDraft, currentTurn, legal, apply, autoChoice, assignRoles } from '../src/sim/draft.js';
import { Rng } from '../src/sim/rng.js';
import { sanitize, newPreset, presetChoice, prepFromPreset, teamRoles } from '../src/presets.js';
import { coopLegal, coopApply, coopRoles, coopAutoChoice, DEFAULT_OWN } from '../src/sim/coop.js';
import { Game } from '../src/sim/game.js';

const ok = (m) => console.log('  ✔ ' + m);
const offFor = (role) => HEROES.find((x) => !x.roles.includes(role) && x.role !== 'jungle' && x.ranged);

// ── draft rules ──
{
  const d = newDraft();
  while (currentTurn(d).act === 'ban') { const t = currentTurn(d); apply(d, t.team, autoChoice(d, t.team, new Rng(1), 1)); }
  const t = currentTurn(d), sup = HEROES.filter((x) => x.role === 'support' && legal(d, t.team, x.id)).slice(0, 1)[0];
  assert.ok(apply(d, t.team, sup.id));
  // a second support for the same team (off-role): legal now
  const t2 = currentTurn(d); while (currentTurn(d).team !== t.team) { const q = currentTurn(d); apply(d, q.team, autoChoice(d, q.team, new Rng(2), 1)); }
  const sup2 = HEROES.find((x) => x.roles.length === 1 && x.role === 'support' && legal(d, t.team, x.id));
  assert.ok(sup2 && legal(d, t.team, sup2.id), 'a second support is a legal (off-role) pick');
  void t2;
  ok('any untaken hero is a legal pick (off-role allowed)');
}
{
  let n = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const d = newDraft(), rng = new Rng(seed);
    while (!d.done) { const t = currentTurn(d); assert.ok(apply(d, t.team, autoChoice(d, t.team, rng, seed % 3))); }
    for (const p of d.picks) { assert.ok(assignRoles(p), 'AI drafts stay on-role'); n++; }
  }
  ok(`AI drafts stay on-role (${n} teams)`);
}
{
  // a human team that went off-role (two supports): the timeout pick still finds a hero for the gaps
  const d = newDraft(), rng = new Rng(7);
  const sups = HEROES.filter((x) => x.roles.length === 1 && x.role === 'support').map((x) => x.id);
  while (!d.done) {
    const t = currentTurn(d);
    const want = t.team === 0 && t.act === 'pick' && d.picks[0].length < 2 ? sups.find((id) => legal(d, 0, id)) : null;
    assert.ok(apply(d, t.team, want || autoChoice(d, t.team, rng, 1)), 'a pick always lands');
  }
  const roles = teamRoles(d.picks[0], null);
  assert.equal(new Set(roles).size, 5, 'five distinct lanes for an off-role team');
  ok('an off-role team gets five lanes; timeout picks still land');
}

// ── lineups ──
{
  const fletch = HEROES.find((x) => x.roles.length === 1 && x.role === 'bot'), tank = HEROES.find((x) => x.roles.length === 1 && x.role === 'support' && x.id !== fletch.id);
  const p = newPreset('Off');
  p.main = { top: 'monolith', jungle: fletch.id, mid: 'hitotsume', bot: 'sling', support: 'aurelia' };
  p.backup = { top: null, jungle: null, mid: tank.id, bot: null, support: null };
  const q = sanitize(p);
  assert.equal(q.main.jungle, fletch.id, 'sanitize keeps an off-role main');
  assert.equal(q.backup.mid, tank.id, 'sanitize keeps an off-role backup');
  // auto-pick: every main lands in its own (possibly off-role) slot
  const d = newDraft(), rng = new Rng(3), mine = 0;
  while (!d.done) {
    const t = currentTurn(d);
    if (t.team === mine && t.act === 'pick') { const c = presetChoice(d, mine, q); assert.ok(c && c.id, 'the lineup auto-picks'); apply(d, mine, c.id); continue; }
    const avoid = new Set(Object.values(q.main));
    let id = autoChoice(d, t.team, rng, 1); if (avoid.has(id)) id = HEROES.find((x) => legal(d, t.team, x.id) && !avoid.has(x.id) && (t.act === 'ban' || assignRoles([...d.picks[t.team], x.id]))).id;
    apply(d, t.team, id);
  }
  const roles = teamRoles(d.picks[mine], q);
  d.picks[mine].forEach((id, i) => assert.equal(roles[i], Object.keys(q.main).find((r) => q.main[r] === id), `${id} plays its lineup role`));
  const { prep } = prepFromPreset(d.picks[mine], d.picks[1 - mine], q, 'classic');
  assert.equal(prep.heroes.find((x) => x.id === fletch.id).role, 'jungle', 'prep keeps the off-role lane');
  ok(`lineup with ${fletch.name} in Jungle: sanitize keeps it, auto-pick honours it, prep keeps the lane`);
  // a draft role-step choice (pickRoles) wins too
  const r2 = teamRoles(['monolith', 'hitotsume'], null, { hitotsume: 'support' });
  assert.equal(r2[1], 'support', 'a role-step pref puts the hero off-role');
  ok('a draft role step can put a hero off-role');
}

// ── co-op seats ──
{
  const own = { ...DEFAULT_OWN }, d = newDraft(), rng = new Rng(5);
  while (currentTurn(d).act === 'ban') { const t = currentTurn(d); apply(d, t.team, autoChoice(d, t.team, rng, 1)); }
  const seat = own.top, seatRolesN = ROLES.filter((r) => own[r] === seat).length;
  const off = HEROES.find((x) => !x.roles.some((r) => own[r] === seat) && coopLegal(d, 0, seat, x.id, own));
  if (currentTurn(d).team === 0) {
    assert.ok(off, 'an off-role hero is legal for a co-op seat');
    assert.ok(!coopLegal(d, 0, seat, off.id, own, true), 'but not for the strict (auto) check');
    assert.ok(coopApply(d, 0, seat, off.id, own));
    const r = coopRoles(d, 0, own);
    assert.ok(r[0] && own[r[0]] === seat, 'the off-role hero takes one of its coach’s roles');
    while (currentTurn(d).team !== 0) { const t = currentTurn(d); apply(d, t.team, autoChoice(d, t.team, rng, 1)); }
    const a = coopAutoChoice(d, 0, seat, own, rng); assert.ok(a && HERO_BY_ID[a].roles.some((r) => own[r] === seat), 'the co-op auto pick still works, on-role');
  }
  void seatRolesN;
  ok('co-op: a coach may pick off-role for their own roles; roles stay within the seat');
}

// ── sim: heroes play the role they were given ──
function offTeamGame(seed) {
  const jg = offFor('jungle'), mid = HEROES.find((x) => x.cls === 'tank' && !x.roles.includes('mid')), top = HEROES.find((x) => x.cls === 'marksman' && !x.roles.includes('top') && x.id !== jg.id);
  const sup = HEROES.find((x) => x.cls === 'mage' && !x.roles.includes('support') && ![jg.id, mid.id, top.id].includes(x.id));
  const bot = HEROES.find((x) => x.role === 'jungle' && ![jg.id, mid.id, top.id, sup.id].includes(x.id));
  const blue = [[top, 'top'], [jg, 'jungle'], [mid, 'mid'], [bot, 'bot'], [sup, 'support']].map(([x, role]) => ({ id: x.id, role, build: x.rec }));
  const used = new Set(blue.map((x) => x.id));
  const red = ROLES.map((r) => HEROES.find((x) => x.role === r && !used.has(x.id) && (used.add(x.id), true))).map((x) => ({ id: x.id, role: x.role, build: x.rec }));
  return { g: new Game({ seed, coach: [true, true], teams: [{ heroes: blue, plan: 'balanced' }, { heroes: red, plan: 'balanced' }] }), blue };
}
{
  const { g, blue } = offTeamGame(11);
  const H = g.teams[0].heroes, inLane = H.map(() => 0), jungle = H.map(() => 0); let samples = 0;
  while (g.tick < 20 * 60 * 8) {
    g.step([]); g.fx.length = 0;
    if (g.time > 100 && g.time < 420 && g.tick % 10 === 0) {
      samples++;
      H.forEach((h, i) => { if (!h.alive) return; if (h.task.kind === 'jungle' || h.task.kind === 'gank') jungle[i]++; if (h.homeLane && g.world.closestLane(h) === h.homeLane && g.world.distToLane(h.homeLane, h) < 500) inLane[i]++; });
    }
  }
  H.forEach((h, i) => assert.equal(h.role, blue[i].role, 'the sim keeps the given role'));
  const jgI = H.findIndex((h) => h.role === 'jungle');
  assert.ok(jungle[jgI] / samples > 0.5, `${H[jgI].def.name} (off-role jungler) jungles: ${Math.round(jungle[jgI] / samples * 100)}%`);
  assert.ok(H[jgI].cs > 10, `the off-role jungler clears camps (cs ${H[jgI].cs})`);
  for (const [i, h] of H.entries()) if (h.role !== 'jungle' && h.role !== 'support') assert.ok(inLane[i] / samples > 0.45, `${h.def.name} holds ${h.role}: ${Math.round(inLane[i] / samples * 100)}%`);
  ok(`sim: off-role ${H.map((h) => `${h.def.name}=${h.role}`).join(', ')} play their given lanes (jungler ${Math.round(jungle[jgI] / samples * 100)}% jungling, cs ${H[jgI].cs})`);
  // deterministic
  const a = offTeamGame(11).g, b = offTeamGame(11).g;
  for (let i = 0; i < 20 * 60 * 3; i++) { a.step([]); b.step([]); a.fx.length = 0; b.fx.length = 0; }
  assert.deepEqual(a.units.map((u) => [u.id, Math.round(u.x * 100), Math.round(u.y * 100), Math.round(u.hp)]), b.units.map((u) => [u.id, Math.round(u.x * 100), Math.round(u.y * 100), Math.round(u.hp)]));
  ok('sim with off-role heroes is deterministic');
}
console.log('offrole tests passed');
