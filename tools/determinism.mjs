// Same seed + same commands must produce bit-identical games.
import { Game } from '../src/sim/game.js';
import { HEROES } from '../src/data/heroes.js';
const pick = (ids) => ids.map((id) => { const h = HEROES.find((x) => x.id === id); return { id, role: h.role, build: h.rec }; });
const cfg = () => ({ seed: 777, coach: [false, true], teams: [
  { heroes: pick(['grok', 'umbra', 'totem', 'bolt', 'bonehook']), plan: 'aggressive', deck: ['smoke', 'ambush', 'rally'] },
  { heroes: pick(['varro', 'gama', 'hex', 'sling', 'aurelia']), plan: 'scaling' } ] });
// A scripted "human" for blue.
const script = { 1800: { type: 'gank', lane: 'bot' }, 3200: { type: 'objective', obj: 'dragon' }, 6000: { type: 'focus', targetIdx: 3 },
  7000: { type: 'group', lane: 'mid' }, 7600: { type: 'tactic', card: 'smoke' }, 8200: { type: 'tactic', card: 'ambush', lane: 'bot' }, 9000: { type: 'reset' }, 11000: { type: 'objective', obj: 'baron' }, 12000: { type: 'build', heroIdx: 2, build: 'burn' } };
function run() {
  const g = new Game(cfg()); const sums = [];
  while (!g.over && g.tick < 20 * 60 * 25) {
    const s = script[g.tick]; const cmds = [];
    if (s) {
      const c = { ...s, team: 0, seq: 1 };
      if (s.targetIdx !== undefined) c.target = g.teams[1].heroes[s.targetIdx].id;
      if (s.heroIdx !== undefined) c.hero = g.teams[0].heroes[s.heroIdx].id;
      cmds.push(c);
    }
    g.step(cmds); g.fx.length = 0;
    if (g.tick % 200 === 0) sums.push(g.checksum());
  }
  return { sums, winner: g.winner, tick: g.tick };
}
const a = run(), b = run();
let ok = a.sums.length === b.sums.length && a.sums.every((v, i) => v === b.sums[i]);
console.log(`run A: ${a.sums.length} checkpoints, winner ${a.winner} @${(a.tick / 1200).toFixed(1)}m`);
console.log(`run B: ${b.sums.length} checkpoints, winner ${b.winner} @${(b.tick / 1200).toFixed(1)}m`);
console.log(ok ? 'DETERMINISTIC ✔' : 'DESYNC ✘');
process.exit(ok ? 0 : 1);
