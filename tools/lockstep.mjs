// Two lockstep peers over a laggy in-memory link must stay in sync while both send calls.
import { Game } from '../src/sim/game.js';
import { HEROES } from '../src/data/heroes.js';
import { LockstepRunner } from '../src/net/runner.js';
import { loopbackPair } from '../src/net/peer.js';
const pick = (ids) => ids.map((id) => { const h = HEROES.find((x) => x.id === id); return { id, role: h.role, build: h.rec }; });
const cfg = () => ({ seed: 4242, coach: [false, false], teams: [
  { heroes: pick(['bastion', 'kaze', 'ember', 'fletch', 'oak']), plan: 'balanced' },
  { heroes: pick(['kenshi', 'leonin', 'raiden', 'marlowe', 'wu']), plan: 'aggressive' } ] });
const [ta, tb] = loopbackPair(+(process.argv[2] || 60));
const ga = new Game(cfg()), gb = new Game(cfg());
const ra = new LockstepRunner(ga, 0, ta), rb = new LockstepRunner(gb, 1, tb);
ta.onMessage((m) => ra.receive(m)); tb.onMessage((m) => rb.receive(m));
let desync = 0; ra.onDesync = rb.onDesync = (k) => { desync++; console.log('DESYNC at', k); };
const TARGET = 20 * 60 * 6; // 6 minutes of game time
const calls = [{ type: 'gank', lane: 'top' }, { type: 'objective', obj: 'dragon' }, { type: 'group', lane: 'mid' }, { type: 'safe' }, { type: 'reset' }];
let i = 0;
const t0 = Date.now();
await new Promise((res) => {
  const iv = setInterval(() => {
    // jittery frame times on each side
    for (let k = 0; k < 6; k++) { ra.update(0.05 + Math.random() * 0.02); rb.update(0.05 + Math.random() * 0.02); }
    if (++i % 37 === 0) ra.send(calls[i % calls.length]);
    if (i % 53 === 0) rb.send(calls[(i + 2) % calls.length]);
    if (ga.tick >= TARGET && gb.tick >= TARGET) { clearInterval(iv); res(); }
  }, 2);
});
await new Promise((r) => setTimeout(r, 300));
const same = ga.checksum() === gb.checksum() || ga.tick !== gb.tick;
console.log(`A tick ${ga.tick} B tick ${gb.tick}; stalls A ${ra.stalls} B ${rb.stalls}; real ${(Date.now() - t0) / 1000}s`);
console.log(`calls applied A: ${ga.callLog.length} B: ${gb.callLog.length}; kills ${ga.teams.map((t) => t.kills)} vs ${gb.teams.map((t) => t.kills)}`);
const ok = !desync && ga.teams[0].kills === gb.teams[0].kills && ga.callLog.length === gb.callLog.length;
console.log(ok && same ? 'LOCKSTEP IN SYNC ✔' : 'LOCKSTEP DESYNC ✘');
process.exit(ok ? 0 : 1);
