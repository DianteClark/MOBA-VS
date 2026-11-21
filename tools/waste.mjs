// Wasted-time meter: how much of every hero's match has a purpose?
//   node tools/waste.mjs [games=8] [--workers=2] [--mode=classic|rush] [--save=file.json] [--compare=file.json] [--perf]
// Runs seeded full bot matches on all 4 maps (game i plays map i%4) and measures, per role and per team side:
//   idle        seconds standing still, not attacking, not in combat, with nothing useful in reach
//               (no enemy minion / monster / hero / hittable structure within 600px). Healing at base,
//               recall channels and ambush waits are not idle.
//   reversals   direction reversals per minute while walking out of combat (wobble / back-and-forth)
//   flipflops   goal flip-flops per minute: the walk target jumps away and comes back within 3s
//   detour      walked ÷ straight distance on completed out-of-combat trips longer than 300px
//   stuck       seconds wanting to move but making < 30px progress in 2s (out of combat)
//   turnbacks   trips abandoned halfway: walked 300px+ toward a goal, then a new goal behind them
//               (e.g. walked to a camp or lane and turned back) with nothing achieved on the way
//   open        seconds a lane wave was hitting a friendly tower with no friendly hero within 700px
//   lostAlone   towers lost while no friendly hero was within 1200px and no enemy hero within 1000px
//   fights      fights (2s+ of hero-vs-hero trading) and the share abandoned: retreated with no kill
//               or death on either side
//   leash       samples (every 0.5s) of a minion > LEASH.minion+40 off its lane, or a monster /
//               objective farther than its leash (+40) from home. Must be 0 after the leash work.
// --lite plays games without instrumentation and prints only side win rate and how/when games end
// (use --from=K to offset the seeds). --perf runs 1 game per map in one process without instrumentation and reports CPU ms per tick
// (process user time: robust on a busy machine) plus wall-clock mean / p99 per tick.
import { fork } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const MAPS = ['sakura', 'frost', 'ember', 'marsh'];
const args = process.argv.slice(2);
const flag = (k, d) => { const a = args.find((x) => x.startsWith('--' + k)); if (!a) return d; const v = a.split('=')[1]; return v === undefined ? true : v; };
const N = +(args.find((a) => !a.startsWith('--')) || 8);
const WORKERS = +flag('workers', 2);
const MODE = process.env.WASTE_MODE || flag('mode', 'classic');

async function setup() {
  const { Game } = await import('../src/sim/game.js');
  const { HEROES, ROLES } = await import('../src/data/heroes.js');
  const { Rng } = await import('../src/sim/rng.js');
  const { aiPrep } = await import('../src/sim/draft.js');
  const C = await import('../src/sim/constants.js');
  const cfgFor = (i) => {
    const rng = new Rng(9001 + i * 31), used = new Set();
    const draft = () => ROLES.map((r) => { const pool = HEROES.filter((h) => h.role === r && !used.has(h.id)); const h = pool[rng.int(pool.length)]; used.add(h.id); return h.id; });
    const a = draft(), b = draft();
    if (MODE === 'rush') return { seed: 4200 + i, mode: 'rush', map: ['rush_sakura', 'rush_ember'][i % 2], coach: [true, true], teams: [aiPrep(a, b), aiPrep(b, a)] };
    return { seed: 4200 + i, map: MAPS[i % 4], coach: [true, true], teams: [aiPrep(a, b), aiPrep(b, a)] };
  };
  return { Game, cfgFor, C };
}

// ───────────── worker: play games, return raw sums ─────────────
async function runGames(ids, perf) {
  const { Game, cfgFor, C } = await setup();
  const LEASH = C.LEASH || { minion: 160, mob: 240, boss: 300 };
  const out = { games: 0, mins: 0, blue: 0, crystal: 0, endMin: [], tickMs: [], role: {}, side: [{}, {}] };
  if (!perf) {
    // instrumentation: remember each hero's last walk goal this tick and when it last did something useful
    const mt = Game.prototype.moveToward;
    Game.prototype.moveToward = function (u, p, nav, stopAt) { if (u.type === 'hero') { u._wg = p; u._wgT = this.tick; } return mt.call(this, u, p, nav, stopAt); };
    const dd = Game.prototype.dealDamage;
    Game.prototype.dealDamage = function (src, tgt, raw, type, flags) { const a = dd.call(this, src, tgt, raw, type, flags); if (a > 0 && src && src.type === 'hero' && tgt.team !== src.team) src._wp = this.tick; return a; };
    const hl = Game.prototype.heal;
    Game.prototype.heal = function (u, amt, src, silent) { if (src && src.type === 'hero' && src !== u) src._wp = this.tick; return hl.call(this, u, amt, src, silent); };
  }
  const add = (o, k, v) => { o[k] = (o[k] || 0) + v; };
  for (const i of ids) {
    const g = new Game(cfgFor(i));
    const S = new Map();
    const R = (h) => out.role[h.role] || (out.role[h.role] = {});
    let ev = 0;
    const towerSeen = new Map(), s0 = new Map(), leashT = new Map();
    while (!g.over && g.time < (g.rules ? g.rules.seconds : C.MATCH_SECONDS) + 1) {
      const t0 = perf ? performance.now() : 0, c0 = perf ? process.cpuUsage().user : 0;
      g.step([]); g.fx.length = 0;
      if (perf) { if (perf === true) { out.tickMs.push(performance.now() - t0); out.cpuUs = (out.cpuUs || 0) + process.cpuUsage().user - c0; } continue; }
      const now = g.tick;
      for (const tm of g.teams) for (const h of tm.heroes) {
        let s = S.get(h.id);
        if (!s) { s = { out, x: h.x, y: h.y, vx: 0, vy: 0, kind: h.task.kind, kindT: now, prevKind: null, trip: null, goals: [], prog: { x: h.x, y: h.y, t: now }, ep: null }; S.set(h.id, s); }
        const r = R(h), sd = g.teams[h.team] === tm ? out.side[h.team] : null;
        const both = (k, v) => { add(r, k, v); add(sd, k, v); };
        const mx = h.x - s.x, my = h.y - s.y, d = Math.sqrt(mx * mx + my * my); s.x = h.x; s.y = h.y;
        // task flip-flops (A → B → A inside 3s)
        if (h.task.kind !== s.kind) {
          if (h.task.kind === s.prevKind && now - s.kindT < 60) { both('taskFlip', 1); add(out.why || (out.why = {}), 'task:' + s.prevKind + '>' + s.kind, 1); }
          s.prevKind = s.kind; s.kind = h.task.kind; s.kindT = now;
        }
        if (!h.alive) { s.trip = null; s.ep = closeEp(h, s, both); continue; }
        both('aliveT', C.DT);
        const combat = now - h.lastCombat < 30;
        const busy = h.recallAt || h.gateAt || h.dash || h.stunUntil > now || h.rootUntil > now;
        // ── idle ──
        if (!busy && d < 0.3 && now - h.animAttack > 25 && !combat && h.task.kind !== 'ambush' && !(dist2(h, g.world.fountain[h.team]) < 400 * 400 && h.hp < h.maxHp)) {
          both('idleAll', C.DT);
          let useful = false;
          for (const e of g.grid.query(h.x, h.y, 600)) {
            if (!e.alive || e.team === h.team) continue;
            if (e.type === 'minion' || e.type === 'mob' || e.type === 'summon' || (e.type === 'objective') || (e.type === 'hero' && g.vision[h.team].has(e.id)) || (e.structure && g.isTargetable(e) && e.type !== 'nexus' || e.type === 'nexus' && g.isTargetable(e))) { useful = true; break; }
          }
          if (!useful) { both('idle', C.DT); add(out.idleBy || (out.idleBy = {}), process.env.V ? (h.why || h.task.kind).replace(/ [A-Z][a-z]+( [A-Z][a-z]+)?$/, '') : h.task.kind, C.DT); }
        }
        // ── reversals (out of combat walking) ──
        const walking = h._wgT === now - 1; // set during the step that just ran
        if (walking && !combat && !busy && d > 0.5) {
          if ((s.vx || s.vy) && (mx * s.vx + my * s.vy) < -0.2 * d * Math.sqrt(s.vx * s.vx + s.vy * s.vy)) { both('rev', 1); add(out.why || (out.why = {}), 'rev:' + h.task.kind, 1); }
          s.vx = mx; s.vy = my;
        }
        // ── stuck ──
        const intent = h.moveIntent >= now - 1 && !busy && !combat;
        if (!intent || dist2(h, s.prog) > 30 * 30) s.prog = { x: h.x, y: h.y, t: now };
        else if (now - s.prog.t > 40) both('stuck', C.DT);
        // ── trips: out-of-combat walks toward one goal ──
        const goal = walking && !combat && !busy ? h._wg : null;
        if (goal) {
          // goal flip-flops: new goal far from the last, but back near the one before within 3s
          const gl = s.goals;
          if (!gl.length || dist2(gl[gl.length - 1], goal) > 250 * 250) {
            if (gl.length >= 2 && dist2(gl[gl.length - 2], goal) < 120 * 120 && now - gl[gl.length - 1].t < 60) { both('goalFlip', 1); add(out.why || (out.why = {}), 'flip:' + h.task.kind, 1); }
            gl.push({ x: goal.x, y: goal.y, t: now }); if (gl.length > 3) gl.shift();
          }
          const tr = s.trip;
          if (tr && dist2(tr.goal, goal) > 300 * 300) {
            // redirected: count as a turn-back if the new goal lies behind us and nothing was achieved
            const ax = tr.goal.x - tr.sx, ay = tr.goal.y - tr.sy, bx = goal.x - h.x, by = goal.y - h.y;
            const away = dist2(h, tr.goal) > 250 * 250;
            if (away && tr.walked > 300 && !(h._wp > tr.t0) && ax * bx + ay * by < 0) { both('turnback', 1); add(out.why || (out.why = {}), 'turn:' + tr.kind + '>' + h.task.kind, 1); }
            s.trip = null;
          }
          if (!s.trip) s.trip = { sx: h.x, sy: h.y, t0: now, walked: 0, goal: { x: goal.x, y: goal.y }, kind: h.task.kind };
          else { s.trip.walked += d; if (dist2(s.trip.goal, goal) < 300 * 300) s.trip.goal = { x: goal.x, y: goal.y }; }
          if (dist2(h, goal) < 90 * 90) endTrip(s, h, both);
        } else if (s.trip && (combat || busy || now - (h._wgT || 0) > 20)) endTrip(s, h, both);
        // ── fights ──
        if (h.lastHitHero === now - 1) {
          if (!s.ep) s.ep = { t0: now, last: now, k: h.kills + h.assists, dth: h.deaths, fled: false };
          s.ep.last = now;
        }
        if (s.ep) { if (h.fleeUntil > now && !s.ep.fled) { s.ep.fled = true; s.ep.fw = (h.why || '').replace(/ [A-Z][a-z]+( [A-Z][a-z]+)?$/, ''); } if (now - s.ep.last > 100) s.ep = closeEp(h, s, both); }
      }
      // ── towers: minion sieges with nobody home ──
      if (now % 5 === 0) for (const u of g.units) {
        if (u.type !== 'tower' || !u.alive || u.tier > 3) continue;
        let hit = false;
        for (const m of g.grid.query(u.x, u.y, 320)) if (m.alive && m.type === 'minion' && m.team !== u.team && m.target === u && now - m.animAttack < 40) { hit = true; break; }
        if (hit) {
          const def = g.teams[u.team].heroes.some((x) => x.alive && dist2(x, u) < 700 * 700);
          if (!def) { add(out.side[u.team], 'open', 5 * C.DT); add(out.openLane || (out.openLane = {}), u.lane, 5 * C.DT); }
        }
        towerSeen.set(u.id, { def: g.teams[u.team].heroes.some((x) => x.alive && dist2(x, u) < 1200 * 1200), foe: g.teams[1 - u.team].heroes.some((x) => x.alive && dist2(x, u) < 1000 * 1000) });
      }
      for (const tm of g.teams) for (const h of tm.heroes) if (h.recallAt && (s0.get(h.id) || {}).at !== h.recallAt) s0.set(h.id, { at: h.recallAt, hp: h.hp / h.maxHp });
      for (; ev < g.events.length; ev++) {
        const e = g.events[ev];
        if (e.type === 'recalled') { const h = g.byId(e.hero); add(out.side[h.team], 'recalls', 1); if ((s0.get(h.id) || {}).hp > 0.7 && h.gold < g.nextItemCost(h)) add(out.side[h.team], 'recallWaste', 1); }
        if (e.type === 'tower') { const u = g.units.find((x) => x.type === 'tower' && !x.alive && x.lane === e.lane && x.tier === e.tier && x.team !== e.team); const ts = u && towerSeen.get(u.id); add(out.side[1 - e.team], 'towersLost', 1); if (ts && !ts.def && !ts.foe) { add(out.side[1 - e.team], 'lostAlone', 1); } }
      }
      // ── leashes: a unit beyond its leash (+40px body slack) for 3s+ is a violation (one per episode).
      // (Being shoved past it for a moment by a hook or knock-back is fine as long as it walks straight back.)
      if (now % 10 === 0) for (const u of g.units) {
        if (!u.alive) continue;
        let off = -1, L = 0, kind = '';
        if (u.type === 'minion') { off = g.world.distToLane(u.lane, u); L = LEASH.minion; kind = 'Minion'; }
        else if ((u.type === 'mob' || u.type === 'objective') && u.home) { off = Math.sqrt(dist2(u, u.home)); L = u.type === 'objective' ? LEASH.boss : LEASH.mob; kind = u.type === 'objective' ? 'Boss' : 'Mob'; }
        else continue;
        const mk = 'max' + kind + 'Off'; if (off > (out[mk] || 0)) out[mk] = off;
        if (off > L + 40) { const t0 = leashT.get(u.id); if (t0 === undefined) leashT.set(u.id, now); else if (t0 >= 0 && now - t0 >= 60) { add(out, 'leash' + kind, 1); leashT.set(u.id, -1); } }
        else leashT.delete(u.id);
      }
    }
    out.games++; out.mins += g.time / 60; out.endMin.push(g.time / 60);
    if (g.winner === 0) out.blue++;
    if (g.over && !g.events.some((e) => e.type === 'victory' && e.timeout)) { out.crystal++; if (g.time >= 720) out.crystal12 = (out.crystal12 || 0) + 1; }
  }
  return out;
}
function dist2(a, b) { const dx = a.x - b.x, dy = a.y - b.y; return dx * dx + dy * dy; }
function endTrip(s, h, both) {
  const tr = s.trip; s.trip = null;
  const st = Math.sqrt((h.x - tr.sx) ** 2 + (h.y - tr.sy) ** 2);
  if (st > 300) { both('trips', 1); both('tripWalk', tr.walked); both('tripStraight', st); }
}
function closeEp(h, s, both) {
  const ep = s.ep; if (!ep) return null;
  const died = h.deaths > ep.dth, scored = h.kills + h.assists > ep.k;
  if (ep.last - ep.t0 >= 40 || died) {
    both('fights', 1);
    if (!died && !scored && ep.fled) { both('abandoned', 1); const w = s.out.why || (s.out.why = {}), k = 'abandon:' + ep.fw; w[k] = (w[k] || 0) + 1; }
  }
  return null;
}

// ───────────── main ─────────────
const isWorker = process.env.WASTE_WORKER;
if (isWorker) {
  process.on('message', async (m) => { const r = await runGames(m.ids, m.perf); process.send(r, () => process.exit(0)); });
} else {
  const lite = !!flag('lite', false), perf = !!flag('perf', false);
  const ids = perf ? [0, 1, 2, 3] : Array.from({ length: N }, (_, i) => i + +flag('from', 0));
  const W = perf ? 1 : Math.min(WORKERS, ids.length);
  const t0 = Date.now();
  const parts = await Promise.all(Array.from({ length: W }, (_, w) => new Promise((res, rej) => {
    const c = fork(fileURLToPath(import.meta.url), [], { env: { ...process.env, WASTE_WORKER: '1', WASTE_MODE: MODE } });
    c.on('message', res); c.on('error', rej);
    c.send({ ids: ids.filter((_, i) => i % W === w), perf: perf || (lite ? 'lite' : false) });
  })));
  const M = merge(parts);
  if (perf) {
    const t = M.tickMs.sort((a, b) => a - b);
    const mean = t.reduce((a, b) => a + b, 0) / t.length;
    console.log(`perf: ${M.games} games, ${t.length} ticks | CPU ms/tick ${(M.cpuUs / 1000 / t.length).toFixed(3)} | wall ms/tick mean ${mean.toFixed(3)} | p50 ${t[t.length >> 1].toFixed(3)} | p99 ${t[Math.floor(t.length * 0.99)].toFixed(3)} | max ${t[t.length - 1].toFixed(1)}`);
    process.exit(0);
  }
  if (lite) {
    const em = M.endMin.slice().sort((a, b) => a - b);
    console.log(`lite: ${M.games} games | blue wins ${(100 * M.blue / M.games).toFixed(1)}% | ended at a Crystal ${(100 * M.crystal / M.games).toFixed(1)}% | Crystal between 12-15 min ${(100 * M.crystal12 / M.games).toFixed(1)}% | median end ${em[em.length >> 1].toFixed(2)} min | ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    process.exit(0);
  }
  const rows = summarize(M);
  console.log(`${M.games} games, ${(M.mins).toFixed(0)} game-min, ${((Date.now() - t0) / 1000).toFixed(0)}s wall`);
  const save = flag('save', null); if (save) writeFileSync(save, JSON.stringify(rows, null, 1));
  const cmp = flag('compare', null); const base = cmp ? JSON.parse(readFileSync(cmp, 'utf8')) : null;
  printTable(rows, base);
}

function merge(parts) {
  const M = { games: 0, mins: 0, blue: 0, crystal: 0, endMin: [], tickMs: [], role: {}, side: [{}, {}], idleBy: {}, openLane: {} };
  const addAll = (dst, src) => { for (const k in src || {}) if (typeof src[k] === 'number') dst[k] = (dst[k] || 0) + src[k]; };
  for (const p of parts) {
    M.games += p.games; M.crystal12 = (M.crystal12 || 0) + (p.crystal12 || 0); M.cpuUs = (M.cpuUs || 0) + (p.cpuUs || 0); M.mins += p.mins; M.blue += p.blue; M.crystal += p.crystal; M.endMin.push(...p.endMin); for (const x of p.tickMs) M.tickMs.push(x);
    for (const r in p.role) addAll(M.role[r] || (M.role[r] = {}), p.role[r]);
    addAll(M.side[0], p.side[0]); addAll(M.side[1], p.side[1]); addAll(M.idleBy, p.idleBy); addAll(M.openLane, p.openLane); addAll(M.why || (M.why = {}), p.why);
    for (const k of ['leashMinion', 'leashMob', 'leashBoss', 'minionSamples', 'mobSamples']) M[k] = (M[k] || 0) + (p[k] || 0);
    for (const k of ['maxMinionOff', 'maxMobOff', 'maxBossOff']) M[k] = Math.max(M[k] || 0, p[k] || 0);
  }
  return M;
}
function metrics(o, mins) {
  const pm = (v) => (v || 0) / Math.max(1e-9, o.aliveT / 60 || mins);
  return {
    idlePct: 100 * (o.idle || 0) / Math.max(1, o.aliveT || 1),
    idleAllPct: 100 * (o.idleAll || 0) / Math.max(1, o.aliveT || 1),
    revPm: pm(o.rev), flipPm: pm((o.goalFlip || 0) + (o.taskFlip || 0)),
    detour: (o.tripWalk || 0) / Math.max(1, o.tripStraight || 1),
    stuckPm: pm(o.stuck), turnPm: pm(o.turnback),
    fights: o.fights || 0, abandonPct: 100 * (o.abandoned || 0) / Math.max(1, o.fights || 0),
  };
}
function summarize(M) {
  const rows = { games: M.games, roles: {}, sides: {} };
  const tot = {};
  for (const r of ['top', 'jungle', 'mid', 'bot', 'support']) if (M.role[r]) { rows.roles[r] = metrics(M.role[r], M.mins); for (const k in M.role[r]) tot[k] = (tot[k] || 0) + M.role[r][k]; }
  rows.roles.ALL = metrics(tot, M.mins);
  for (const s of [0, 1]) rows.sides[s ? 'red' : 'blue'] = { ...metrics(M.side[s], M.mins), openSecPerGame: (M.side[s].open || 0) / M.games, lostAlone: (M.side[s].lostAlone || 0) / M.games, towersLost: (M.side[s].towersLost || 0) / M.games };
  rows.recallsPerGame = ((M.side[0].recalls || 0) + (M.side[1].recalls || 0)) / M.games;
  rows.recallWastePerGame = ((M.side[0].recallWaste || 0) + (M.side[1].recallWaste || 0)) / M.games;
  rows.why = Object.fromEntries(Object.entries(M.why || {}).sort((a, b) => b[1] - a[1]).slice(0, 60).map(([k, v]) => [k, +(v / M.games).toFixed(1)]));
  rows.openSecPerGame = ((M.side[0].open || 0) + (M.side[1].open || 0)) / M.games;
  rows.openLane = Object.fromEntries(Object.entries(M.openLane).map(([k, v]) => [k, v / M.games]));
  rows.lostAlonePerGame = ((M.side[0].lostAlone || 0) + (M.side[1].lostAlone || 0)) / M.games;
  rows.leash = { minion: M.leashMinion || 0, mob: M.leashMob || 0, boss: M.leashBoss || 0, maxMinionOff: Math.round(M.maxMinionOff || 0), maxMobOff: Math.round(M.maxMobOff || 0), maxBossOff: Math.round(M.maxBossOff || 0) };
  rows.idleBy = Object.fromEntries(Object.entries(M.idleBy).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, +(v / M.games).toFixed(1)]));
  const em = M.endMin.slice().sort((a, b) => a - b);
  rows.blueWinPct = 100 * M.blue / M.games; rows.crystalPct = 100 * M.crystal / M.games;
  rows.endMedian = em[em.length >> 1]; rows.end12to15 = 100 * em.filter((x) => x >= 12 && x <= 15.01).length / M.games;
  return rows;
}
function printTable(R, B) {
  const cols = [['idlePct', 'idle%', 1], ['idleAllPct', 'still%', 1], ['revPm', 'rev/min', 2], ['flipPm', 'flip/min', 2], ['detour', 'detour', 3], ['stuckPm', 'stuck s/min', 3], ['turnPm', 'turnbk/min', 3], ['fights', 'fights', 0], ['abandonPct', 'abandon%', 1]];
  const f = (v, d) => (v === undefined ? '-' : (+v).toFixed(d));
  const cell = (cur, base, d) => (base == null ? f(cur, d) : `${f(base, d)}→${f(cur, d)}`);
  const w = B ? 17 : 11;
  console.log('\n' + 'role'.padEnd(9) + cols.map((c) => c[1].padStart(w)).join(''));
  for (const r of Object.keys(R.roles)) console.log(r.padEnd(9) + cols.map(([k, , d]) => cell(R.roles[r][k], B && B.roles[r] && B.roles[r][k], d).padStart(w)).join(''));
  for (const s of ['blue', 'red']) console.log(s.padEnd(9) + cols.map(([k, , d]) => cell(R.sides[s][k], B && B.sides[s][k], d).padStart(w)).join(''));
  const line = (label, k, d, src = R, bsrc = B) => console.log(label.padEnd(44) + cell(src[k], bsrc && bsrc[k], d));
  console.log('');
  line('open lane: wave on tower, no hero (s/game)', 'openSecPerGame', 1);
  console.log('  by lane'.padEnd(44) + Object.entries(R.openLane).map(([k, v]) => `${k} ${B && B.openLane ? f(B.openLane[k], 1) + '→' : ''}${f(v, 1)}`).join('  '));
  line('towers lost to minions alone /game', 'lostAlonePerGame', 2);
  for (const s of ['blue', 'red']) console.log(`  ${s} towers lost /game`.padEnd(44) + cell(R.sides[s].towersLost, B && B.sides[s].towersLost, 2));
  console.log('leash violations (min/mob/boss)'.padEnd(44) + `${B ? `${B.leash.minion}/${B.leash.mob}/${B.leash.boss} → ` : ''}${R.leash.minion}/${R.leash.mob}/${R.leash.boss}   max off: minion ${B ? B.leash.maxMinionOff + '→' : ''}${R.leash.maxMinionOff} mob ${B ? B.leash.maxMobOff + '→' : ''}${R.leash.maxMobOff} boss ${B ? B.leash.maxBossOff + '→' : ''}${R.leash.maxBossOff}`);
  line('recalls /game', 'recallsPerGame', 1); line('  wasted recalls (hp>70%, nothing to buy)', 'recallWastePerGame', 2);
  line('blue win %', 'blueWinPct', 1); line('ended at a Crystal %', 'crystalPct', 1); line('median end (min)', 'endMedian', 2); line('ended 12-15 min %', 'end12to15', 1);
  if (process.env.V) console.log('top causes /game'.padEnd(44) + JSON.stringify(R.why));
  console.log('idle s/game by task'.padEnd(44) + JSON.stringify(R.idleBy) + (B ? '  (was ' + JSON.stringify(B.idleBy) + ')' : ''));
}
