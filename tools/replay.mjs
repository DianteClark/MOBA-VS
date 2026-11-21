// Replay check: record a vs-AI style match with random player commands, then play it back
// from the log and compare checksums. Covers the classic 5v5 and Lane Rush.  node tools/replay.mjs
import { Game } from '../src/sim/game.js';
import { LocalRunner } from '../src/net/runner.js';
import { aiPrep } from '../src/sim/draft.js';
const teams = [aiPrep(['bastion', 'kaze', 'ember', 'fletch', 'aurelia'], ['varro', 'gama', 'hex', 'bolt', 'frost']), aiPrep(['varro', 'gama', 'hex', 'bolt', 'frost'], ['bastion', 'kaze', 'ember', 'fletch', 'aurelia'])];
function run(name, cfg, seconds, calls) {
  const g1 = new Game(JSON.parse(JSON.stringify(cfg))), r1 = new LocalRunner(g1, 0, { noHalftime: true });
  let k = 0;
  // also the coach-side extras: Kami Surge when momentum is full, and green-lighting a hero's solo play (permit)
  let extra = 0;
  while (g1.time < seconds && !g1.over) {
    if (g1.tick % 400 === 7) r1.send(calls[k++ % calls.length]);
    if (g1.tick % 100 === 3) {
      const me = g1.teams[0];
      if (me.momentum >= 100) { r1.send({ type: 'surge' }); extra++; }
      const foe = g1.teams[1].heroes.find((e) => e.alive && g1.vision[0].has(e.id)), h = foe && me.heroes.find((x) => x.alive && (x.x - foe.x) ** 2 + (x.y - foe.y) ** 2 < 1200 ** 2);
      if (h && me.permitCd <= g1.tick) { r1.send({ type: 'permit', kind: 'fight', hero: h.id, target: foe.id }); extra++; }
    }
    r1.update(0.05);
  }
  const log = JSON.parse(JSON.stringify(r1.log));
  const g2 = new Game(JSON.parse(JSON.stringify(cfg))), r2 = new LocalRunner(g2, -1, { noHalftime: true, script: log });
  while (g2.tick < g1.tick && !g2.over) r2.update(0.05);
  console.log(`[${name}] commands ${log.reduce((a, b) => a + b[1].length, 0)} (${extra} surge/permit), applied permits ${g1.callLog.filter((c) => c.type === 'permit').length}, surges ${g1.events.filter((e) => e.type === 'surge' && e.team === 0).length}, moments ${g1.events.filter((e) => e.type === 'moment').length}, ticks ${g1.tick}`);
  const ok = g1.tick === g2.tick && g1.checksum() === g2.checksum();
  console.log(`[${name}] ` + (ok ? 'replay matches' : 'replay DIVERGED'));
  return ok;
}
const okC = run('classic', { seed: 4242, map: 'frost', coach: [false, true], teams }, 600,
  [{ type: 'gank', lane: 'mid' }, { type: 'group', lane: 'bot' }, { type: 'objective', obj: 'dragon' }, { type: 'moment', id: 'rally' }, { type: 'ult', mode: 'go' }, { type: 'safe' }, { type: 'plan', plan: 'aggressive' }, { type: 'moment', id: 'timeout' }]);
const okR = run('rush', { seed: 4243, map: 'rush_sakura', mode: 'rush', coach: [false, true], teams }, 480,
  [{ type: 'moment', id: 'rally' }, { type: 'group', lane: 'mid' }, { type: 'objective', obj: 'dragon' }, { type: 'moment', id: 'push' }, { type: 'ult', mode: 'go' }, { type: 'objective', obj: 'baron' }, { type: 'moment', id: 'timeout' }]);
// Co-op vs AI: two coaches' seat-stamped commands in one log (some rejected by the ownership rules),
// a lead pass and the partner leaving (a system command), then the whole match replayed from the log.
function runCoop() {
  const cfg = { seed: 4244, map: 'sakura', coach: [false, true], teams, coop: [{ seats: 2, own: { top: 0, jungle: 0, mid: 0, bot: 1, support: 1 }, lead: 0 }, null] };
  const g1 = new Game(JSON.parse(JSON.stringify(cfg))), r1 = new LocalRunner(g1, 0, { noHalftime: true, seat: 0 });
  const as = (seat, c) => { const keep = r1.seat; r1.seat = seat; r1.send(c); r1.seat = keep; };
  const hero = (role) => g1.teams[0].heroes.find((x) => x.role === role);
  let k = 0;
  while (g1.time < 540 && !g1.over) {
    if (g1.tick % 300 === 11) as(0, [{ type: 'gank', lane: 'mid' }, { type: 'objective', obj: 'dragon' }, { type: 'group', lane: 'top' }, { type: 'moment', id: 'rally' }][k++ % 4]);
    if (g1.tick % 340 === 17) as(1, [{ type: 'objective', obj: 'dragon' }, { type: 'build', hero: hero('bot').id, build: hero('bot').def.builds[1] }, { type: 'gank', lane: 'bot', hero: hero('support').id }, { type: 'cancel' }][k % 4]);
    if (g1.tick === 3000) as(0, { type: 'lead' });
    if (g1.tick === 6000) r1.send({ type: 'leave', sys: 1, team: 0, seat: 1 });
    r1.update(0.05);
  }
  const log = JSON.parse(JSON.stringify(r1.log));
  const g2 = new Game(JSON.parse(JSON.stringify(cfg))), r2 = new LocalRunner(g2, -1, { noHalftime: true, script: log });
  while (g2.tick < g1.tick && !g2.over) r2.update(0.05);
  const seats = new Set(log.flatMap((e) => e[1].map((c) => c.seat))), co = g1.teams[0].coop;
  console.log(`[coop] commands ${log.reduce((a, b) => a + b[1].length, 0)} from seats ${[...seats].join('/')}, calls ${g1.callLog.length}, lead ${co.lead}, partner left ${co.left[1]}, ticks ${g1.tick}`);
  const ok = g1.tick === g2.tick && g1.checksum() === g2.checksum() && seats.has(0) && seats.has(1) && co.left[1] && g1.teams[0].heroes.every((x) => x.seat === 0);
  console.log('[coop] ' + (ok ? 'replay matches' : 'replay DIVERGED'));
  return ok;
}
const okCo = runCoop();
// a weekly event on a v22 map: Blood Moon on Mossgate Ruins
const okE = run('event', { seed: 4244, map: 'ruins', event: 'bloodmoon', coach: [false, true], teams }, 600,
  [{ type: 'gank', lane: 'top' }, { type: 'objective', obj: 'dragon' }, { type: 'moment', id: 'rally' }, { type: 'group', lane: 'mid' }, { type: 'shrine' }, { type: 'safe' }]);
console.log(okC && okR && okCo && okE ? 'REPLAY MATCHES ✔' : 'REPLAY DIVERGED ✘');
process.exit(okC && okR && okCo && okE ? 0 : 1);
