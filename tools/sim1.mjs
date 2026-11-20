import { Game } from '../src/sim/game.js';
import { HEROES } from '../src/data/heroes.js';
const seed = +(process.argv[2] || 1);
const pick = (ids) => ids.map((id) => { const h = HEROES.find((x) => x.id === id); return { id, role: h.role, build: h.rec }; });
const g = new Game({ seed, coach: [true, true], teams: [
  { heroes: pick(['bastion', 'kaze', 'ember', 'fletch', 'oak']), plan: 'balanced' },
  { heroes: pick(['kenshi', 'leonin', 'raiden', 'marlowe', 'wu']), plan: 'balanced' } ] });
const t0 = Date.now();
let lastMin = -1;
while (!g.over && g.tick < 20 * 60 * 30) {
  g.step([]);
  g.fx.length = 0;
  const m = Math.floor(g.time / 60);
  if (m !== lastMin && m % 2 === 0) {
    lastMin = m;
    const s = g.teams.map((t) => `${t.kills}k ${t.towers}t gold ${Math.round(t.heroes.reduce((a, h) => a + h.goldEarned, 0))} lv ${t.heroes.map((h) => h.level).join('/')} items ${t.heroes.map(h=>h.items.length).join('')}`);
    console.log(`${m}m | B ${s[0]} | R ${s[1]} | units ${g.units.length}`);
  }
}
const ev = {};
for (const e of g.events) ev[e.type] = (ev[e.type] || 0) + 1;
console.log('winner', g.winner, 'time', (g.time / 60).toFixed(1), 'min; real ms', Date.now() - t0);
console.log(ev);
for (const t of g.teams) console.log(t.heroes.map((h) => `${h.heroId} ${h.kills}/${h.deaths}/${h.assists} cs${h.cs} lv${h.level}`).join(' | '), 'drag', t.dragons.join(','));
console.log(g.callLog.map((c) => `${(c.t/1200).toFixed(1)} T${c.team} ${c.type} ${c.lane||c.obj||''} ${c.result}`).join('\n'));
