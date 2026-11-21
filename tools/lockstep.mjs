// Two lockstep peers over a laggy in-memory link must stay in sync while both send calls.
import { Game } from '../src/sim/game.js';
import { HEROES } from '../src/data/heroes.js';
import { LockstepRunner } from '../src/net/runner.js';
import { loopbackPair } from '../src/net/peer.js';
const pick = (ids) => ids.map((id) => { const h = HEROES.find((x) => x.id === id); return { id, role: h.role, build: h.rec }; });
const cfg = (mode) => ({ seed: 4242, coach: [false, false], ...(mode === 'rush' ? { mode: 'rush', map: 'rush_sakura' } : {}), teams: [
  { heroes: pick(['bastion', 'kaze', 'ember', 'fletch', 'oak']), plan: 'balanced' },
  { heroes: pick(['kenshi', 'leonin', 'raiden', 'marlowe', 'wu']), plan: 'aggressive' } ] });
async function run(mode) {
  const [ta, tb] = loopbackPair(+(process.argv[2] || 60));
  const ga = new Game(cfg(mode)), gb = new Game(cfg(mode));
  const ra = new LockstepRunner(ga, 0, ta), rb = new LockstepRunner(gb, 1, tb);
  ta.onMessage((m) => ra.receive(m)); tb.onMessage((m) => rb.receive(m));
  // Record a snapshot after every tick on each peer; peers run 1-3 ticks apart, so state is only
  // compared at ticks both peers reached (never A's state at tick T against B's at T-2).
  const snaps = [new Map(), new Map()];
  for (const [g, m] of [[ga, snaps[0]], [gb, snaps[1]]]) {
    const step = g.step.bind(g);
    g.step = (cmds) => { step(cmds); m.set(g.tick, `${g.checksum()}|${g.teams.map((t) => t.kills)}|${g.callLog.length}`); };
  }
  let desync = 0; ra.onDesync = rb.onDesync = (k) => { desync++; console.log('DESYNC at', k); };
  const TARGET = 20 * 60 * (mode === 'rush' ? 4 : 6); // minutes of game time
  const calls = [{ type: 'gank', lane: mode === 'rush' ? 'mid' : 'top' }, { type: 'objective', obj: 'dragon' }, { type: 'group', lane: 'mid' }, { type: 'moment', id: 'rally' }, { type: 'safe' }, { type: 'moment', id: 'push' }, { type: 'reset' }, { type: 'moment', id: 'timeout' }];
  let i = 0;
  const t0 = Date.now();
  await new Promise((res) => {
    const iv = setInterval(() => {
      // jittery frame times on each side
      for (let k = 0; k < 6; k++) { ra.update(0.05 + Math.random() * 0.02); rb.update(0.05 + Math.random() * 0.02); }
      if (++i % 37 === 0) ra.send(calls[i % calls.length]);
      if (i % 53 === 0) rb.send(calls[(i + 2) % calls.length]);
      if ((ga.tick >= TARGET || ga.over) && (gb.tick >= TARGET || gb.over)) { clearInterval(iv); res(); }
    }, 2);
  });
  await new Promise((r) => setTimeout(r, 300));
  let compared = 0, firstBad = -1;
  for (const [k, v] of snaps[0]) { const w = snaps[1].get(k); if (w === undefined) continue; compared++; if (v !== w && firstBad < 0) firstBad = k; }
  if (firstBad >= 0) console.log(`[${mode}] STATE MISMATCH at tick ${firstBad}: A ${snaps[0].get(firstBad)} B ${snaps[1].get(firstBad)}`);
  const last = Math.min(ga.tick, gb.tick);
  console.log(`[${mode}] A tick ${ga.tick} B tick ${gb.tick}; stalls A ${ra.stalls} B ${rb.stalls}; real ${(Date.now() - t0) / 1000}s`);
  console.log(`[${mode}] calls applied A: ${ga.callLog.length} B: ${gb.callLog.length}; moments ${ga.events.filter((e) => e.type === 'moment').length}; at tick ${last}: kills ${snaps[0].get(last)?.split('|')[1]} vs ${snaps[1].get(last)?.split('|')[1]}; ${compared} ticks compared`);
  return !desync && firstBad < 0 && compared >= Math.min(TARGET, last) - 1;
}
const okC = await run('classic'), okR = await run('rush');
console.log(okC && okR ? 'LOCKSTEP IN SYNC ✔' : 'LOCKSTEP DESYNC ✘');
process.exit(okC && okR ? 0 : 1);
