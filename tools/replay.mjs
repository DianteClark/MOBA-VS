// Replay check: record a vs-AI style match with random player commands, then play it back
// from the log and compare checksums. Covers the classic 5v5 and Lane Rush.  node tools/replay.mjs
import { Game } from '../src/sim/game.js';
import { LocalRunner } from '../src/net/runner.js';
import { aiPrep } from '../src/sim/draft.js';
const teams = [aiPrep(['bastion', 'kaze', 'ember', 'fletch', 'aurelia'], ['varro', 'gama', 'hex', 'bolt', 'frost']), aiPrep(['varro', 'gama', 'hex', 'bolt', 'frost'], ['bastion', 'kaze', 'ember', 'fletch', 'aurelia'])];
function run(name, cfg, seconds, calls, more) {
  const g1 = new Game(JSON.parse(JSON.stringify(cfg))), r1 = new LocalRunner(g1, 0, { noHalftime: true });
  let k = 0;
  // also the coach-side extras: Kami Surge when momentum is full, and green-lighting a hero's solo play (permit)
  let extra = 0;
  while (g1.time < seconds && !g1.over) {
    if (g1.tick % 400 === 7) r1.send(calls[k++ % calls.length]);
    if (g1.tick === g1.halftimeTick + 2) r1.send({ type: 'plan', plan: g1.teams[0].plan === 'split' ? 'protect' : 'split' }); // the one halftime plan change
    if (g1.tick % 100 === 3) {
      const me = g1.teams[0];
      if (me.momentum >= 100) { r1.send({ type: 'surge' }); extra++; }
      const foe = g1.teams[1].heroes.find((e) => e.alive && g1.vision[0].has(e.id)), h = foe && me.heroes.find((x) => x.alive && (x.x - foe.x) ** 2 + (x.y - foe.y) ** 2 < 1200 ** 2);
      if (h && me.permitCd <= g1.tick) { r1.send({ type: 'permit', kind: 'fight', hero: h.id, target: foe.id }); extra++; }
    }
    if (more) more(g1, r1);
    r1.update(0.05);
  }
  const log = JSON.parse(JSON.stringify(r1.log));
  const g2 = new Game(JSON.parse(JSON.stringify(cfg))), r2 = new LocalRunner(g2, -1, { noHalftime: true, script: log });
  while (g2.tick < g1.tick && !g2.over) r2.update(0.05);
  if (g1.depth) console.log(`[${name}] talents ${g1.teams[0].heroes.map((x) => x.tal.join('')).join(' ')} = ${g2.teams[0].heroes.map((x) => x.tal.join('')).join(' ')}; items ${g1.teams[0].heroes.map((x) => x.items.length).join('')}; ult upgrades ${g1.events.filter((e) => e.type === 'ultUp').length}`);
  console.log(`[${name}] commands ${log.reduce((a, b) => a + b[1].length, 0)} (${extra} surge/permit), applied permits ${g1.callLog.filter((c) => c.type === 'permit').length}, surges ${g1.events.filter((e) => e.type === 'surge' && e.team === 0).length}, moments ${g1.events.filter((e) => e.type === 'moment').length}, ticks ${g1.tick}`);
  const plans = g1.events.filter((e) => e.type === 'plan');
  if (g1.halftimeTick > 0 && g1.tick > g1.halftimeTick + 10) console.log(`[${name}] plans ${g1.cfg.teams.map((t) => t.plan).join(' vs ')}; halftime change: ${plans.map((e) => `T${e.team} ${e.from}→${e.plan}`).join(', ') || 'NONE'}`);
  const ok = g1.tick === g2.tick && g1.checksum() === g2.checksum() && (g1.halftimeTick < 0 || g1.tick < g1.halftimeTick + 10 || plans.some((e) => e.team === 0)) && g2.teams.every((t, i) => t.plan === g1.teams[i].plan);
  console.log(`[${name}] ` + (ok ? 'replay matches' : 'replay DIVERGED'));
  return ok;
}
// (Red is a rival-style coach: Coach Moments early, a backup plan for halftime.)
const okC = run('classic', { seed: 4242, map: 'frost', coach: [false, true], coachStyle: [null, { moment: 'early', backup: 'protect' }], teams }, 600,
  [{ type: 'gank', lane: 'mid' }, { type: 'group', lane: 'bot' }, { type: 'objective', obj: 'dragon' }, { type: 'moment', id: 'rally' }, { type: 'ult', mode: 'go' }, { type: 'safe' }, { type: 'plan', plan: 'aggro' }, { type: 'moment', id: 'timeout' }]);
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
// v23 match depth: coach talent defaults in the cfg, live talent swaps and item overrides in the log
const { itemOptions } = await import('../src/sim/talents.js');
const dteams = JSON.parse(JSON.stringify(teams)); dteams[0].heroes.forEach((x, i) => { x.tal = [[1, -1, 0], [0, 1, 1], [-1, -1, -1], [1, 0, -1], [0, 0, 1]][i]; });
const okD = run('depth', { seed: 4245, map: 'marsh', depth: true, coach: [false, true], teams: dteams }, 600,
  [{ type: 'gank', lane: 'bot' }, { type: 'objective', obj: 'dragon' }, { type: 'group', lane: 'mid' }, { type: 'ult', mode: 'go' }], (g, r) => {
    if (g.tick % 60 !== 13) return;
    for (const x of g.teams[0].heroes) { const k = x.tal.findIndex((p, i) => p >= 0 && g.tick - x.talAt[i] < 80); if (k >= 0) { r.send({ type: 'talent', hero: x.id, tier: k, pick: 1 - x.tal[k] }); return; } }
    if (g.tick % 600 === 13) { const x = g.teams[0].heroes[g.tick / 600 % 5 | 0], o = itemOptions(x); if (o.length > 1) r.send({ type: 'item', hero: x.id, item: o[o.length - 1].name }); }
  });
console.log(okC && okR && okCo && okE && okD ? 'REPLAY MATCHES ✔' : 'REPLAY DIVERGED ✘');
process.exit(okC && okR && okCo && okE && okD ? 0 : 1);
