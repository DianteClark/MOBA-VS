// Spectate friends live (src/net/spectate.js): two lockstep peers play; peer A relays its command stream to
// spectators over laggy loopback links. Checks: a spectator's sim matches the players' sim tick for tick, it is
// never closer than DELAY ticks to the live game (no ghosting), a late joiner catches up exactly, refusals
// (not allowed / version / full) and the feed's end.
//   node tools/spectate_test.mjs
import { Game } from '../src/sim/game.js';
import { HEROES } from '../src/data/heroes.js';
import { LockstepRunner } from '../src/net/runner.js';
import { loopbackPair } from '../src/net/peer.js';
import { Relay, SpecRunner, DELAY, MAX_SPEC } from '../src/net/spectate.js';

const pick = (ids) => ids.map((id) => { const h = HEROES.find((x) => x.id === id); return { id, role: h.role, build: h.rec }; });
const cfg = () => ({ seed: 9191, map: 'sakura', depth: true, coach: [false, false], teams: [
  { heroes: pick(['bastion', 'kaze', 'ember', 'fletch', 'oak']), plan: 'protect' }, { heroes: pick(['kenshi', 'leonin', 'raiden', 'marlowe', 'wu']), plan: 'split' }] });
let fails = 0; const check = (c, msg) => { console.log(`  ${c ? '✔' : '✘'} ${msg}`); if (!c) fails++; };

const [ta, tb] = loopbackPair(30);
const ga = new Game(cfg()), gb = new Game(cfg());
const ra = new LockstepRunner(ga, 0, ta), rb = new LockstepRunner(gb, 1, tb);
ta.onMessage((m) => ra.receive(m)); tb.onMessage((m) => rb.receive(m));
const sums = new Map();
{ const step = ga.step.bind(ga); ga.step = (c) => { step(c); sums.set(ga.tick, ga.checksum()); }; }
let clock = 0;
const relay = new Relay({ v: 28, cfg: cfg(), names: ['A', 'B'], skins: [{}, {}], mapId: 'sakura', game: () => ga, log: () => ra.log, ai: () => [] },
  { allow: (pid) => (pid === 'FRIEND0001' || pid === 'FRIEND0002' ? null : 'friends'), now: () => clock });

// a spectator: its own Game from the 'sw' config, fed by 'sl' messages
function spectator(pid, v = 28) {
  const [rs, sp] = loopbackPair(40);
  const out = { pid, game: null, runner: null, refused: null, ended: false, maxAhead: -Infinity, ok: 0, bad: 0 };
  sp.onMessage((m) => {
    if (m.t === 'specno') out.refused = m.why;
    if (m.t === 'sw') { out.game = new Game(m.cfg); out.runner = new SpecRunner(out.game); }
    if (m.t === 'sl' && out.runner) out.runner.feed(m);
    if (m.t === 'specend') out.ended = true;
  });
  relay.accept(rs);
  sp.send({ t: 'spec', v, pid, name: pid });
  out.link = sp;
  return out;
}
const s1 = spectator('FRIEND0001');
const nope = spectator('STRANGER01'), old = spectator('FRIEND0002', 27);
let late = null;
const calls = [{ type: 'gank', lane: 'top' }, { type: 'objective', obj: 'dragon' }, { type: 'group', lane: 'mid' }, { type: 'moment', id: 'rally' }, { type: 'safe' }];
const TARGET = 20 * 60 * 3;
let i = 0;
await new Promise((res) => {
  const iv = setInterval(() => {
    for (let k = 0; k < 6; k++) { ra.update(0.05 + Math.random() * 0.02); rb.update(0.05 + Math.random() * 0.02); clock += 50; relay.pump(); }
    if (++i % 31 === 0) ra.send(calls[i % calls.length]);
    if (i % 47 === 0) rb.send(calls[(i + 2) % calls.length]);
    for (const s of [s1, late]) if (s && s.runner) {
      s.runner.update(0.3); // a spectator that renders slowly still never passes the horizon
      s.maxAhead = Math.max(s.maxAhead, s.game.tick - Math.max(0, ga.tick - DELAY));
      const v = sums.get(s.game.tick); if (s.game.tick > 0 && v !== undefined) { if (v === s.game.checksum()) s.ok++; else s.bad++; }
    }
    if (!late && ga.tick > 20 * 100) late = spectator('FRIEND0002'); // joins 100 s in
    if (ga.tick >= TARGET && gb.tick >= TARGET) { clearInterval(iv); res(); }
  }, 2);
});
check(nope.refused === 'friends', `a non-friend is refused (${nope.refused})`);
check(old.refused === 'version', `another game version is refused (${old.refused})`);
check(s1.bad === 0 && s1.ok > 100, `spectator sim matches the players' sim (${s1.ok} ticks compared, ${s1.bad} different)`);
check(s1.maxAhead <= 0, `never closer than ${DELAY} ticks to the live game (closest: ${DELAY - s1.maxAhead} ticks behind once the game is past ${DELAY})`);
check(late && late.bad === 0 && late.ok > 50 && late.game.tick > 20 * 120, `late joiner caught up exactly (at tick ${late && late.game.tick}, ${late && late.ok} compared)`);
// full: MAX_SPEC spectators at most
const extra = []; for (let k = 0; k < MAX_SPEC; k++) extra.push(spectator('FRIEND0001'));
await new Promise((r) => setTimeout(r, 300));
check(extra.filter((x) => x.refused === 'full').length === extra.length - (MAX_SPEC - 2), `at most ${MAX_SPEC} spectators (${relay.count} watching)`);
// the end: the feed runs out its delay at real-time pace, then ends; the spectator reaches the final tick
ga.over = true; const fin = ga.tick;
for (let k = 0; k < 40; k++) { clock += 500; relay.pump(); await new Promise((r) => setTimeout(r, 5)); }
await new Promise((r) => setTimeout(r, 300));
for (let k = 0; k < 400 && s1.game.tick < fin; k++) s1.runner.update(0.25);
check(s1.runner.ended && s1.game.tick === fin && s1.game.checksum() === sums.get(fin), `feed ends at the final tick (${s1.game.tick}/${fin})`);
console.log(fails ? `SPECTATE FAILED (${fails})` : 'SPECTATE OK');
process.exit(fails ? 1 : 0);
