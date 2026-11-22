// Replay Theater check: snapshots taken while a scripted replay plays must step on bit-for-bit like the
// original (same checksum at the end), and the post-match analytics recorder must work headless.
//   node tools/theater.mjs
import { Game } from '../src/sim/game.js';
import { LocalRunner } from '../src/net/runner.js';
import { aiPrep } from '../src/sim/draft.js';
import { snapshot, restore } from '../src/ui/snapshot.js';
import { MatchRecorder, analyze } from '../src/ui/analytics.js';

const A = ['bastion', 'kaze', 'ember', 'fletch', 'aurelia'], B = ['varro', 'gama', 'hex', 'bolt', 'frost'];
const teams = [aiPrep(A, B), aiPrep(B, A)];
let ok = true;
function run(name, cfg, seconds, extra = []) {
  // 1. record a match with player commands
  const g = new Game(JSON.parse(JSON.stringify(cfg))), r = new LocalRunner(g, 0, { noHalftime: true });
  const calls = [{ type: 'gank', lane: 'mid' }, { type: 'objective', obj: 'dragon' }, { type: 'group', lane: 'bot' }, { type: 'moment', id: 'rally' }, { type: 'shrine', shrine: 0 }, ...extra];
  const rec = new MatchRecorder(g);
  let k = 0;
  while (g.time < seconds && !g.over) { if (g.tick % 300 === 11) r.send(calls[k++ % calls.length]); r.update(0.05, null, () => rec.step()); }
  const log = JSON.parse(JSON.stringify(r.log)), end = g.tick, sum = g.checksum();
  const data = rec.finish({ my: 0 }), d = analyze(data);
  // 2. replay it with snapshots every 10s
  const g2 = new Game(JSON.parse(JSON.stringify(cfg))), r2 = new LocalRunner(g2, -1, { noHalftime: true, script: log });
  const snaps = []; let ms = 0;
  while (g2.tick < end && !g2.over) {
    if (g2.tick % 200 === 0) { const t0 = performance.now(); snaps.push(snapshot(g2)); ms += performance.now() - t0; }
    r2.skipTo(g2.tick + 1);
  }
  // 3. restore a few snapshots and run each to the end
  let good = g2.checksum() === sum;
  const picks = [0, Math.floor(snaps.length / 3), Math.floor(snaps.length * 2 / 3), snaps.length - 1];
  for (const i of picks) {
    const s = snaps[i], g3 = restore(s), r3 = new LocalRunner(g3, -1, { noHalftime: true, script: log });
    while (r3.si < log.length && log[r3.si][0] < g3.tick) r3.si++;
    r3.skipTo(end);
    if (g3.checksum() !== sum || g3.tick !== end) { good = false; console.log(`[${name}] snapshot at tick ${s.tick} DIVERGED`); }
    // the snapshot stays pristine: restoring it again gives the same state
    if (restore(s).checksum() !== s.checksum()) { good = false; console.log(`[${name}] snapshot at tick ${s.tick} was modified`); }
  }
  console.log(`[${name}] ticks ${end}, ${snaps.length} snapshots, ${(ms / snaps.length).toFixed(1)} ms each; events ${data.ev.length}, calls ${data.calls.length}, fights ${d.fights.length}, turning point ${d.turn ? d.turn.at : '-'}`);
  console.log(`[${name}] ` + (good ? 'snapshots match' : 'snapshots DIVERGED'));
  ok = ok && good && data.gold.length > 2;
}
run('classic', { seed: 777, map: 'sakura', coach: [false, true], teams }, 420);
run('rush', { seed: 778, map: 'rush_sakura', mode: 'rush', coach: [false, true], teams }, 240);
run('event', { seed: 779, map: 'oasis', event: 'shrine', coach: [false, true], teams }, 300); // weekly event rules are a per-game copy
// Living World: walls live on the World that snapshots share; every copy puts its own walls back before it steps
// (thickets open at 6:00, every wall at 12:00), and a restored copy must still match the original.
run('living', { seed: 780, map: 'marsh', living: 1, coach: [false, true], teams }, 750, [{ type: 'objective', obj: 'yokai' }, { type: 'invade', camp: '1:moon' }, { type: 'objective', obj: 'boss' }]);
console.log(ok ? 'THEATER SNAPSHOTS OK ✔' : 'THEATER SNAPSHOTS FAILED ✘');
process.exit(ok ? 0 : 1);
