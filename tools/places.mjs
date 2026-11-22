// Fight-location check (src/world/places.js): on every classic map and both Lane Rush maps, plays headless
// games, samples the live fights (3+ heroes) every second and asserts that
//   * the fight is named by the area its centroid is really in (checked against the raw map geometry:
//     pit discs, base discs, lane centre lines, river line, which side of the river), never by an objective
//     the fight is merely near (the old "Kami" for a bot-lane fight),
//   * the fight cam (followFight, the code the HUD runs) stays within the fight's radius for 7s after the cut
//     while the fight moves,
//   * the same map point always gets the same name for both teams' coaches, mirrored (fair words).
//   node tools/places.mjs [mins=6] [--map=id] [--v]    (classic maps run with the Living World on; 13+ mins reaches the Tengu)
import { Game } from '../src/sim/game.js';
import { HEROES, ROLES } from '../src/data/heroes.js';
import { defaultPrep } from '../src/sim/draft.js';
import { Rng } from '../src/sim/rng.js';
import { TICK_RATE } from '../src/sim/constants.js';
import { MAPS, RUSH_MAPS } from '../src/maps/defs.js';
import { S } from '../src/sim/world.js';
import { placeAt, placeText, placeFromKey, fightClusters, followFight, PLACE_R } from '../src/world/places.js';

const args = process.argv.slice(2), MINS = +(args.find((a) => !a.startsWith('--')) || 6), V = args.includes('--v');
const only = (args.find((a) => a.startsWith('--map=')) || '').slice(6);
const maps = [...MAPS, ...RUSH_MAPS].filter((m) => !only || m.id === only);
const hyp = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
let bad = 0, total = 0;
const fail = (m) => { bad++; if (bad < 40) console.log('  ✘ ' + m); };

// Independent truth for a point, straight from the map geometry (not from placeAt's own code path).
function truth(W, p) {
  const d = W.def, out = new Set();
  for (const k of ['kami', 'kraken']) if (hyp(W.pits[k], p) <= PLACE_R.pit) out.add('pit:' + k);
  for (let t = 0; t < 2; t++) if (hyp(W.baseCenter[t], p) <= (d.baseR || 360) || hyp(W.fountain[t], p) <= 150) out.add('base:' + t);
  for (const ln of W.laneNames) if (W.distToLane(ln, p) <= (d.laneW || 64) + PLACE_R.laneExtra) out.add('lane:' + ln);
  return out;
}

for (const def of maps) {
  const rush = def.mode === 'rush';
  const rng = new Rng(777 + def.id.length), used = new Set();
  const team = () => ROLES.map((r) => { const c = HEROES.filter((x) => x.role === r && !used.has(x.id)); const x = c[rng.int(c.length)]; used.add(x.id); return x.id; });
  const g = new Game({ seed: 31337 + def.id.charCodeAt(0), map: def.id, ...(rush ? { mode: 'rush' } : { living: 1 }), coach: [true, true], teams: [defaultPrep(team()), defaultPrep(team())] });
  const W = g.world;
  // 1) mirror fairness of the words: a point and its mirror read the same from the two sides
  for (let k = 0; k < 400; k++) {
    const p = { x: 60 + (k * 977) % 2280, y: 60 + (k * 613) % 2280 }, q = { x: S - p.x, y: S - p.y };
    if (!W.isWalk(p.x, p.y)) continue;
    const a = placeText(placeAt(W, p), { my: 0, g }), b = placeText(placeAt(W, q), { my: 1, g });
    const pit = (s) => s.replace(/Kami|Kraken|Oni/g, 'PIT'), sw = (s) => s.replace(/\btop\b/g, '§').replace(/\bbot\b/g, 'top').replace(/§/g, 'bot'); // pits are different bosses: only pit-ness mirrors
    if (pit(a.where) !== sw(pit(b.where))) fail(`${def.id}: (${p.x},${p.y}) "${a.where}" for Blue but its mirror is "${b.where}" for Red`);
    const key = placeAt(W, p).key; if (!placeFromKey(key)) fail(`${def.id}: key "${key}" does not parse`);
  }
  // 2) live fights
  let fights = 0, cams = 0, maxOff = 0, follow = [];
  const names = {};
  while (!g.over && g.time < MINS * 60) {
    g.step([]); g.fx.length = 0;
    // the fight cam: 7s of following after each cut, checked every tick against the fight as it is now
    for (const f of follow) {
      if (g.tick > f.until || !f.on) continue;
      const now = followFight(f.cam, g, f.ids, null, 1 / TICK_RATE);
      if (!now) { f.on = false; continue; }
      f.ids = now.ids;
      if (g.tick - f.t0 < TICK_RATE * 0.5) continue; // the cam eases in over the first half second
      const off = hyp(f.cam, now);
      maxOff = Math.max(maxOff, off / now.r);
      // on the fight at the cut; when fights merge or jump the cam may trail for a moment, never longer than 0.5s
      f.out = off > now.r ? (f.out || 0) + 1 : 0;
      if (f.out > TICK_RATE * 0.5) fail(`${def.id} ${(g.time / 60).toFixed(1)}m: fight cam ${Math.round(off)} from the fight (radius ${Math.round(now.r)})`);
    }
    follow = follow.filter((f) => f.on && g.tick <= f.until);
    if (g.tick % TICK_RATE) continue;
    for (const f of fightClusters(g)) {
      if (f.n < 3) continue;
      fights++; total++;
      const pl = placeAt(W, f, g), tr = truth(W, f), txt = placeText(pl, { my: 0, g });
      names[txt.short] = (names[txt.short] || 0) + 1;
      // the named area must be the true one at the centroid, with the same precedence (pit > base > lane)
      const want = [...tr].find((x) => x.startsWith('pit:')) || [...tr].find((x) => x.startsWith('base:')) || [...tr].find((x) => x.startsWith('lane:'));
      const got = pl.area === 'pit' ? 'pit:' + pl.pit : pl.area === 'base' ? 'base:' + pl.team : pl.area === 'lane' ? 'lane:' + pl.lane : null;
      if (pl.area === 'arena' && !(g.objectives.boss && g.objectives.boss.alive || g.objTimers.boss)) fail(`${def.id}: named the Tengu arena with no Tengu`);
      if (pl.area !== 'shrine' && pl.area !== 'arena' && (want || null) !== got && !(got && got.startsWith('lane:') && tr.has(got))) fail(`${def.id} ${(g.time / 60).toFixed(1)}m: fight at (${Math.round(f.x)},${Math.round(f.y)}) named "${txt.short} ${txt.detail}" but it is ${want || 'off-lane'}`);
      if (pl.area === 'pit' && hyp(W.pits[pl.pit], f) > PLACE_R.pit) fail(`${def.id}: named ${pl.pit} outside the pit`);
      if (pl.area === 'jungle' || pl.area === 'river') {
        if (tr.size) fail(`${def.id}: fight named ${txt.short} but sits on ${[...tr].join(', ')}`);
        // jungle side: the half of the map nearer that team's fountain along the river line (mirror check)
        if (pl.area === 'jungle') { const m = placeAt(W, { x: S - f.x, y: S - f.y }); if (m.area === 'jungle' && m.team === pl.team) fail(`${def.id}: jungle side not mirrored at (${Math.round(f.x)},${Math.round(f.y)})`); }
      }
      if (pl.area === 'lane' && pl.tier) { const tw = W.structures.find((s) => s.x === pl.at.x && s.y === pl.at.y && s.team === pl.team && s.lane === pl.lane); if (!tw || hyp(tw, f) > PLACE_R.tower + (def.laneW || 64) + PLACE_R.laneExtra + 100) fail(`${def.id}: "${txt.where}" but that tower is ${tw ? Math.round(hyp(tw, f)) : '?'} away`); }
      // the cut: the camera starts on the centroid and follows the fight for 7s
      if (!follow.some((q) => q.ids.some((id) => f.ids.includes(id)))) { cams++; follow.push({ ids: f.ids.slice(), cam: { x: f.x, y: f.y }, t0: g.tick, until: g.tick + 7 * TICK_RATE, on: true }); }
      if (V) console.log(`   ${(g.time / 60).toFixed(1)}m ${f.n} heroes (${f.teams.join('v')}) r${Math.round(f.r)} → FIGHT AT ${txt.short}${txt.detail ? ' · ' + txt.detail : ''}`);
    }
  }
  if (!fights) fail(`${def.id}: no 3+ hero fights in ${MINS} minutes`);
  console.log(`${def.name.padEnd(16)} ${String(fights).padStart(4)} fight samples, ${cams} cam cuts (worst ${Math.round(maxOff * 100)}% of the fight radius) · ${Object.entries(names).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, n]) => `${k} ${n}`).join(', ')}`);
}
console.log(bad ? `\n${bad} problem(s) in ${total} fight samples ✘` : `\nall ${total} fight samples named and framed correctly ✔`);
process.exit(bad ? 1 : 0);
