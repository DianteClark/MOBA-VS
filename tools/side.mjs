// Side fairness + match pacing meter (classic or rush), in parallel worker processes.
//   node tools/side.mjs [games=40] [--workers=N] [--from=K] [--mode=classic|rush] [--mirror] [--swap] [--mins=M] [--map=id]
// Default draft: the same seeded random per-role draft as tools/waste.mjs (game i plays map i%4).
//   --mirror  both teams field the SAME five heroes and builds: any edge left is pure side (map / sim order).
//   --swap    every seed is played twice with the teams swapped (cancels draft luck; pairs share a seed).
//   --mins=M  stop each game at M minutes (fast early-game read: gold / kills / towers per side).
//   --pace='{"rampPer":240}' / --final='{...}' / --T='{...}'  try pacing rules without editing them.
// Prints, overall and per map: blue win %, how and when games end (Crystal / clock, 12-15 min share),
// and per side at 5 / 10 min: team gold, kills, towers taken; first tower / first Kami / Kraken by side;
// towers lost per lane per side (spots a lopsided lane).
import { fork } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const flag = (k, d) => { const a = args.find((x) => x === '--' + k || x.startsWith('--' + k + '=')); if (!a) return d; const v = a.split('=')[1]; return v === undefined ? true : v; };
const N = +(args.find((a) => !a.startsWith('--')) || 40);
const MODE = flag('mode', 'classic'), MIRROR = !!flag('mirror', false), SWAP = !!flag('swap', false), MINS = +flag('mins', 0), ONLY = flag('map', null);
const MAPS = MODE === 'rush' ? ['rush_sakura', 'rush_ember'] : ['sakura', 'frost', 'ember', 'marsh'];

async function play(ids) {
  const { Game } = await import('../src/sim/game.js');
  const { HEROES, ROLES } = await import('../src/data/heroes.js');
  const { Rng } = await import('../src/sim/rng.js');
  const { aiPrep } = await import('../src/sim/draft.js');
  // pacing experiments: --pace='{"rampPer":240}' merges into this mode's pace rules (also --final, --T)
  const { rulesFor } = await import('../src/sim/modes.js'), R = rulesFor(MODE);
  for (const [k, o] of [['pace', R.pace], ['final', R.final], ['T', R.T]]) { const v = flag(k, null); if (v) Object.assign(o, JSON.parse(v)); }
  const rows = [];
  for (const id of ids) {
    const i = SWAP ? id >> 1 : id, flip = SWAP && (id & 1);
    const rng = new Rng(9001 + i * 31), used = new Set();
    const draft = () => ROLES.map((r) => { const pool = HEROES.filter((h) => h.role === r && !used.has(h.id)); const h = pool[rng.int(pool.length)]; used.add(h.id); return h.id; });
    let a = draft(), b = MIRROR ? a : draft();
    if (flip) [a, b] = [b, a];
    const map = ONLY || MAPS[i % MAPS.length];
    const pa = aiPrep(a, b), pb = MIRROR ? JSON.parse(JSON.stringify(pa)) : aiPrep(b, a);
    const g = new Game({ seed: 4200 + i, map, ...(MODE === 'rush' ? { mode: 'rush' } : {}), coach: [true, true], teams: [pa, pb] });
    const r = { map, at: {}, first: {}, lost: [{}, {}] };
    const snap = () => g.teams.map((t) => ({ gold: t.heroes.reduce((s, h) => s + h.goldEarned, 0), kills: t.kills, towers: t.towers || 0 }));
    const end = MINS ? MINS * 60 : Infinity;
    let ev = 0;
    while (!g.over && g.time < end) {
      g.step([]); g.fx.length = 0;
      if (g.tick === 20 * 300) r.at[5] = snap();
      if (g.tick === 20 * 600) r.at[10] = snap();
      for (; ev < g.events.length; ev++) {
        const e = g.events[ev];
        if (e.type === 'tower') { if (r.first.tower === undefined) r.first.tower = e.team; r.lost[1 - e.team][e.lane] = (r.lost[1 - e.team][e.lane] || 0) + 1; }
        if (e.type === 'objective' && r.first[e.obj] === undefined) r.first[e.obj] = e.team;
      }
      if (g.events.length > 4000) { g.events.length = 0; ev = 0; }
    }
    r.over = g.over; r.winner = g.over ? g.winner : -1; r.min = g.time / 60;
    r.crystal = g.over && !g.events.some((e) => e.type === 'victory' && e.timeout);
    r.end = snap();
    // at the clock: structures the trailing team (fewer towers) still has, and its Crystal HP
    if (!r.crystal && g.over) { const lo = 1 - g.winner; r.lo = { towers: g.towersStanding(lo), inhibs: g.units.filter((u) => u.type === 'inhib' && u.team === lo && u.alive).length, nexus: (g.units.find((u) => u.type === 'nexus' && u.team === lo) || { hp: 0, maxHp: 1 }).hp / (g.units.find((u) => u.type === 'nexus' && u.team === lo) || { maxHp: 1 }).maxHp }; }
    rows.push(r);
  }
  return rows;
}

if (process.env.SIDE_WORKER) {
  process.on('message', async (m) => { const r = await play(m.ids); process.send(r, () => process.exit(0)); });
} else {
  const W = +flag('workers', availableParallelism());
  const from = +flag('from', 0);
  const ids = Array.from({ length: SWAP ? N * 2 : N }, (_, k) => k + (SWAP ? from * 2 : from));
  const t0 = Date.now();
  const parts = await Promise.all(Array.from({ length: Math.min(W, ids.length) }, (_, w) => new Promise((res, rej) => {
    const c = fork(fileURLToPath(import.meta.url), args, { env: { ...process.env, SIDE_WORKER: '1' } });
    c.on('message', res); c.on('error', rej);
    c.send({ ids: ids.filter((_, k) => k % W === w) });
  })));
  const rows = parts.flat();
  const pct = (a, b) => b ? (100 * a / b).toFixed(1) + '%' : '-';
  const report = (name, R) => {
    if (!R.length) return;
    const done = R.filter((r) => r.over);
    const blue = done.filter((r) => r.winner === 0).length, cr = done.filter((r) => r.crystal), cr12 = cr.filter((r) => r.min >= 12);
    const em = R.map((r) => r.min).sort((x, y) => x - y);
    const avg = (f) => (R.reduce((s, r) => s + f(r), 0) / R.length);
    const at = (m, k) => { const S = R.filter((r) => r.at[m]); if (!S.length) return '-'; const d = S.reduce((s, r) => s + r.at[m][0][k] - r.at[m][1][k], 0) / S.length; return (d >= 0 ? '+' : '') + d.toFixed(k === 'gold' ? 0 : 2); };
    const first = (k) => { const S = R.filter((r) => r.first[k] !== undefined); return S.length ? `${pct(S.filter((r) => r.first[k] === 0).length, S.length)} (${S.length})` : '-'; };
    const lost = (t) => ['top', 'mid', 'bot', 'base'].map((l) => l + ' ' + avg((r) => r.lost[t][l] || 0).toFixed(2)).join(' ');
    console.log(`${name}: ${R.length} games | blue wins ${pct(blue, done.length)}${MINS ? '' : ` | Crystal ${pct(cr.length, R.length)} | Crystal 12-15 ${pct(cr12.length, R.length)} | median end ${em[em.length >> 1].toFixed(2)} min | ends <10 min ${pct(R.filter((r) => r.crystal && r.min < 10).length, R.length)}`}`);
    const TO = R.filter((r) => r.lo);
    if (TO.length && !MINS) console.log(`   clock games: trailing side still had ${(TO.reduce((s, r) => s + r.lo.towers, 0) / TO.length).toFixed(1)} towers, ${(TO.reduce((s, r) => s + r.lo.inhibs, 0) / TO.length).toFixed(1)} inhibs, Crystal ${(100 * TO.reduce((s, r) => s + r.lo.nexus, 0) / TO.length).toFixed(0)}% HP | Crystal end minutes: ${[8, 10, 11, 12, 13, 14, 15].map((m, i, A) => `<${m} ${R.filter((r) => r.crystal && r.min < m && (i === 0 || r.min >= A[i - 1])).length}`).join(' ')}`);
    console.log(`   blue-red @5: gold ${at(5, 'gold')} kills ${at(5, 'kills')} towers ${at(5, 'towers')} | @10: gold ${at(10, 'gold')} kills ${at(10, 'kills')} towers ${at(10, 'towers')} | end: gold ${(avg((r) => r.end[0].gold - r.end[1].gold)).toFixed(0)}`);
    console.log(`   blue first: tower ${first('tower')} dragon ${first('dragon')} herald ${first('herald')} baron ${first('baron')} | towers lost blue: ${lost(0)} | red: ${lost(1)}`);
  };
  console.log(`side.mjs ${MODE}${MIRROR ? ' mirror' : ''}${SWAP ? ' swap' : ''}${MINS ? ` ${MINS}min` : ''}, ${((Date.now() - t0) / 1000).toFixed(0)}s wall, ${W} workers`);
  report('ALL', rows);
  for (const m of MAPS) report('  ' + m, rows.filter((r) => r.map === m));
}
