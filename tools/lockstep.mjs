// Two lockstep peers over a laggy in-memory link must stay in sync while both send calls.
import { Game } from '../src/sim/game.js';
import { HEROES } from '../src/data/heroes.js';
import { LockstepRunner } from '../src/net/runner.js';
import { loopbackPair, Hub } from '../src/net/peer.js';
import { DEFAULT_OWN } from '../src/sim/coop.js';
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

// Co-op rooms: up to four peers in a star (the host's Hub relays), every command stamped with the coach's seat.
// The sim must enforce hero ownership the same way on every peer, and a coach leaving mid-match ('drop' +
// a 'leave' command at a host-chosen tick) must hand their heroes to the partner (or the AI) in sync.
async function runRoom(name, seats, cfgx, plan) {
  const n = seats.length, lat = +(process.argv[2] || 60);
  const hub = new Hub(), links = [hub];
  for (let p = 1; p < n; p++) { const [a, b] = loopbackPair(lat); hub.add(p, a); links.push(b); }
  const games = seats.map(() => new Game({ ...cfg('classic'), ...cfgx }));
  const runners = seats.map((s, p) => new LockstepRunner(games[p], s.team, links[p], { slot: p, slots: n, seat: s.seat, coop: true }));
  hub.onMessage((m) => runners[0].receive(m));
  for (let p = 1; p < n; p++) links[p].onMessage((m) => runners[p].receive(m));
  hub.onLeave((p) => runners[0].hostDrop(p, [{ type: 'leave', sys: 1, team: seats[p].team, seat: seats[p].seat, seq: 0 }]));
  const snaps = games.map((g) => { const m = new Map(), step = g.step.bind(g); g.step = (c) => { step(c); m.set(g.tick, `${g.checksum()}|${g.teams.map((t) => t.kills)}|${g.callLog.length}|${g.teams.map((t) => t.coop ? t.coop.lead + ':' + t.heroes.map((x) => x.seat).join('') : '-')}`); }; return m; });
  // what peer 0's sim accepted / rejected, by (team, seat, type)
  const verdicts = [];
  { const g = games[0], ap = g.applyCommand.bind(g); g.applyCommand = (c) => { const ok = ap(c); if (c.seat !== undefined || c.sys) verdicts.push({ t: g.tick, team: c.team, seat: c.seat, type: c.type, sys: !!c.sys, hero: c.hero, ok }); return ok; }; }
  let desync = 0; for (const r of runners) r.onDesync = (k) => { desync++; console.log(`[${name}] DESYNC at`, k); };
  const gone = new Set(), TARGET = 20 * 60 * 4;
  let i = 0;
  await new Promise((res) => {
    const iv = setInterval(() => {
      for (let k = 0; k < 6; k++) runners.forEach((r, p) => { if (!gone.has(p)) r.update(0.05 + Math.random() * 0.02); });
      i++;
      plan(i, { games, runners, links, gone, seats });
      if (runners.every((r, p) => gone.has(p) || r.game.tick >= TARGET || r.game.over)) { clearInterval(iv); res(); }
    }, 2);
  });
  await new Promise((r) => setTimeout(r, 400));
  let compared = 0, bad = -1;
  for (let p = 1; p < n; p++) for (const [k, v] of snaps[p]) { const w = snaps[0].get(k); if (w === undefined) continue; compared++; if (v !== w && bad < 0) { bad = k; console.log(`[${name}] STATE MISMATCH peer ${p} at tick ${k}: ${w} vs ${v}`); } }
  const g = games[0];
  console.log(`[${name}] ${n} peers, ticks ${games.map((x) => x.tick).join('/')}, calls ${g.callLog.length}, ${compared} peer-ticks compared, seats ${snaps[0].get(g.tick)?.split('|')[3]}`);
  return { ok: !desync && bad < 0 && compared > 1000, verdicts, games };
}
const H = (g, t, role) => g.teams[t].heroes.find((x) => x.role === role).id;
// 2 coaches vs the AI: seat 0 (host) runs top side and leads, seat 1 runs bot side.
const coopAi = await runRoom('coop-ai', [{ team: 0, seat: 0 }, { team: 0, seat: 1 }], { coach: [false, true], coop: [{ seats: 2, own: DEFAULT_OWN, lead: 0 }, null] }, (i, { games, runners }) => {
  const g = games[0], r = runners;
  if (i % 41 === 0) r[0].send([{ type: 'gank', lane: 'top' }, { type: 'objective', obj: 'dragon' }, { type: 'build', hero: H(g, 0, 'mid'), build: HEROES.find((x) => x.id === 'ember').builds[1] }, { type: 'group', lane: 'mid' }][(i / 41 | 0) % 4]);
  if (i % 47 === 0) r[1].send([{ type: 'objective', obj: 'dragon' }, { type: 'build', hero: H(g, 0, 'bot'), build: HEROES.find((x) => x.id === 'fletch').builds[1] }, { type: 'build', hero: H(g, 0, 'mid'), build: 'tank' }, { type: 'gank', lane: 'bot', hero: H(g, 0, 'support') }, { type: 'cancel' }][(i / 47 | 0) % 5]);
  if (g.tick >= 3000 && !r.passed) { r.passed = true; r[0].send({ type: 'lead' }); }
  if (g.tick >= 3100 && i % 53 === 0) r[1].send({ type: 'group', lane: 'bot' });
});
const v = coopAi.verdicts, early = (f) => v.filter((x) => x.t < 3000 && f(x));
const rules = [
  ['partner team call rejected before the lead pass', early((x) => x.seat === 1 && x.type === 'objective').every((x) => !x.ok) && early((x) => x.seat === 1 && x.type === 'objective').length > 0],
  ['partner build on own hero accepted', v.some((x) => x.seat === 1 && x.type === 'build' && x.hero === H(coopAi.games[0], 0, 'bot') && x.ok)],
  ['partner build on the host\'s hero rejected', v.filter((x) => x.seat === 1 && x.type === 'build' && x.hero === H(coopAi.games[0], 0, 'mid')).every((x) => !x.ok)],
  ['lead passed to the partner', v.some((x) => x.seat === 0 && x.type === 'lead' && x.ok) && coopAi.games[0].teams[0].coop.lead === 1],
  ['partner team call accepted after the pass', v.some((x) => x.seat === 1 && x.type === 'group' && x.ok)],
];
for (const [k, ok] of rules) console.log(`[coop-ai] ${ok ? 'ok ' : 'BAD'} ${k}`);
// 2v2: four coaches; the red partner leaves, then the red lead: their heroes go to the partner, then to the AI coach.
const room = await runRoom('coop-2v2', [{ team: 0, seat: 0 }, { team: 0, seat: 1 }, { team: 1, seat: 0 }, { team: 1, seat: 1 }],
  { coach: [false, false], coop: [{ seats: 2, own: DEFAULT_OWN, lead: 0 }, { seats: 2, own: { top: 1, jungle: 0, mid: 1, bot: 0, support: 0 }, lead: 0 }] }, (i, { games, runners, links, gone }) => {
    const r = runners;
    if (i % 43 === 0) r[0].send([{ type: 'objective', obj: 'dragon' }, { type: 'gank', lane: 'mid' }, { type: 'moment', id: 'rally' }][(i / 43 | 0) % 3]);
    if (i % 51 === 0) r[1].send({ type: 'permit', kind: 'split', hero: H(games[1], 0, 'bot'), lane: 'bot' });
    if (!gone.has(2) && i % 47 === 0) r[2].send([{ type: 'group', lane: 'top' }, { type: 'gank', lane: 'bot' }, { type: 'safe' }][(i / 47 | 0) % 3]);
    if (!gone.has(3) && i % 37 === 0) r[3].send({ type: 'build', hero: H(games[3], 1, 'mid'), build: 'tank' });
    if (games[3].tick >= 1500 && !gone.has(3)) { gone.add(3); links[3].close(); }
    if (games[2].tick >= 3000 && !gone.has(2)) { gone.add(2); links[2].close(); }
  });
const rg = room.games[0], red = rg.teams[1];
const rules2 = [
  ['red partner left: heroes and lead went to the red lead', room.verdicts.some((x) => x.sys && x.team === 1 && x.seat === 1 && x.ok)],
  ['both red coaches left: the AI coach runs red', red.coop.ai && !!rg.coaches[1]],
];
for (const [k, ok] of rules2) console.log(`[coop-2v2] ${ok ? 'ok ' : 'BAD'} ${k}`);
const okCoop = coopAi.ok && room.ok && rules.every((x) => x[1]) && rules2.every((x) => x[1]);

const okC = process.env.COOP_ONLY ? true : await run('classic'), okR = process.env.COOP_ONLY ? true : await run('rush');
console.log(okC && okR && okCoop ? 'LOCKSTEP IN SYNC ✔' : 'LOCKSTEP DESYNC ✘');
process.exit(okC && okR && okCoop ? 0 : 1);
