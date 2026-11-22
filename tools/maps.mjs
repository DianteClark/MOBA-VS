// Validate every map: connectivity of all key points, no objective pit / jungle camp inside tower
// range (with a safety margin), and dump a PPM preview per map.
//   node tools/maps.mjs [outDir]
import { writeFileSync } from 'node:fs';
import { MAPS, RUSH_MAPS } from '../src/maps/defs.js';
import { World, N, C, S, T_LANE, T_BASE, T_RIVER, T_PIT, T_SHRINE } from '../src/sim/world.js';
import { segDist2 } from '../src/sim/geom.js';
import { RANGE } from '../src/sim/constants.js';
// A tower acquires heroes whose centre is within RANGE.tower + 14 (see Game.updateTower).
const REACH = RANGE.tower + 14;
// Pits: the whole pit (r 150) stays out of reach, plus a 60px margin for heroes fighting at its rim.
// Camps: mobs spread ~34px from the camp centre, plus a 42px margin.
const PIT_CLEAR = REACH + 150 + 60, CAMP_CLEAR = REACH + 34 + 42;
const out = process.argv[2];
let bad = 0;
for (const def of [...MAPS, ...RUSH_MAPS]) {
  const w = new World(def);
  const seen = new Uint8Array(N * N); const q = [];
  const s = w.nearestOpen(w.fountain[0]); const s0 = w.idx(s.x, s.y); seen[s0] = 1; q.push(s0);
  while (q.length) { const c = q.pop(); const x = c % N, y = (c / N) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; const i = ny * N + nx; if (nx >= 0 && ny >= 0 && nx < N && ny < N && w.walk[i] && !seen[i]) { seen[i] = 1; q.push(i); } } }
  const pts = [['red fountain', w.fountain[1]], ['kraken', w.pits.kraken], ['kami', w.pits.kami], ...w.shrines.map((p, i) => ['shrine' + i, p]), ...w.camps.map((c) => ['camp ' + c.id + c.side, c])];
  for (const ln of w.laneNames) for (let k = 0; k <= 20; k++) pts.push([`${ln}@${k / 20}`, w.lanePoint(ln, k / 20)]);
  for (const st of w.structures) { const near = [[0, 40], [40, 0], [0, -40], [-40, 0], [50, 50], [-50, -50], [50, -50], [-50, 50]].some(([dx, dy]) => w.isWalk(st.x + dx, st.y + dy) && seen[w.idx(st.x + dx, st.y + dy)]); if (!near) { console.log(`  ✘ ${def.id}: structure ${st.kind} ${st.lane} t${st.team} unreachable`); bad++; } }
  let miss = 0;
  const towers = w.structures.filter((st) => st.kind === 'tower');
  const clearOf = (p) => Math.min(...towers.map((t) => Math.hypot(t.x - p.x, t.y - p.y)));
  let minPit = 1e9, minCamp = 1e9;
  for (const [n, p, need] of [['kraken pit', w.pits.kraken, PIT_CLEAR], ['kami pit', w.pits.kami, PIT_CLEAR], ...w.camps.map((c) => ['camp ' + c.id + c.side, c, CAMP_CLEAR])]) {
    const d = clearOf(p); if (need === PIT_CLEAR) minPit = Math.min(minPit, d); else minCamp = Math.min(minCamp, d);
    if (d < need) { console.log(`  ✘ ${def.id}: ${n} only ${Math.round(d)}px from a tower (needs ${need})`); miss++; }
  }
  for (const [n, p] of pts) { const o = w.nearestOpen(p); if (!seen[w.idx(o.x, o.y)] || Math.hypot(o.x - p.x, o.y - p.y) > 60) { console.log(`  ✘ ${def.id}: ${n} unreachable`); miss++; } }
  bad += miss;
  const open = w.walk.reduce((a, b) => a + b, 0), brush = w.brush.reduce((a, b) => a + b, 0);
  const goals = w.camps.length ? w.camps : [w.pits.kami, w.pits.kraken, w.fountain[1]];
  const t0 = Date.now(); let plen = 0; for (let k = 0; k < 50; k++) { const p = w.findPath(w.fountain[0].x, w.fountain[0].y, goals[k % goals.length].x, goals[k % goals.length].y); plen += p.length; } const ms = (Date.now() - t0) / 50;
  console.log(`${def.name}: open ${(open / N / N * 100).toFixed(0)}%, brush cells ${brush}, structures ${w.structures.length}, A* ${ms.toFixed(2)}ms avg, tower clearance pit ${Math.round(minPit)}/${PIT_CLEAR} camp ${minCamp < 1e9 ? Math.round(minCamp) : '-'}/${CAMP_CLEAR}, ${miss ? 'ISSUES' : 'all reachable ✔'}`);
  if (def.walls && !def.single) miss += livingCheck(def, towers);
  bad += towerCheck(def);
  if (out) {
    const px = 4, Wd = N * px; const buf = Buffer.alloc(Wd * Wd * 3);
    const col = { 0: [30, 60, 30], 1: [110, 170, 70], 2: [170, 120, 80], 3: [80, 150, 200], 4: [140, 140, 170], 5: [110, 100, 90], 6: [230, 200, 90], 7: [130, 180, 90] };
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const i = y * N + x; let c = w.walk[i] ? col[w.type[i]] : [25, 45, 25];
      if (w.brush[i]) c = [60, 140, 60];
      for (let yy = 0; yy < px; yy++) for (let xx = 0; xx < px; xx++) { const o = ((y * px + yy) * Wd + x * px + xx) * 3; buf[o] = c[0]; buf[o + 1] = c[1]; buf[o + 2] = c[2]; }
    }
    for (const st of w.structures) { const c = st.team ? [255, 60, 60] : [60, 140, 255]; const cx = Math.floor(st.x / C) * px, cy = Math.floor(st.y / C) * px; for (let yy = -4; yy < 8; yy++) for (let xx = -4; xx < 8; xx++) { const o = ((cy + yy) * Wd + cx + xx) * 3; if (o >= 0 && o < buf.length) { buf[o] = c[0]; buf[o + 1] = c[1]; buf[o + 2] = c[2]; } } }
    writeFileSync(`${out}/${def.id}.ppm`, Buffer.concat([Buffer.from(`P6 ${Wd} ${Wd} 255\n`), buf]));
  }
}
// Living World (src/sim/living.js): every breakable wall is a real shortcut (shorter path once open) that never
// cuts anything off while closed; Moon Spirits, the Yokai Parade's loop and the Tengu's spot are open ground
// out of tower reach; the A* clearance kept up incrementally as walls open equals a full rebuild.
function livingCheck(def, towers) {
  let miss = 0; const say = (m) => { console.log(`  ✘ ${def.id}: ${m}`); miss++; };
  const w = new World(def, { walls: true }), plain = new World(def);
  for (let i = 0; i < N * N; i++) if (w.walk[i] !== plain.walk[i]) { say('closed walls change the walkable map'); break; }
  const plen = (a, b) => { const p = w.findPath(a.x, a.y, b.x, b.y); let d = 0, q = a; for (const r of p) { d += Math.hypot(r.x - q.x, r.y - q.y); q = r; } return d; };
  const ends = w.walls.map((x) => [w.nearestOpen(x.a), w.nearestOpen(x.b)]), before = ends.map(([a, b]) => plen(a, b));
  w.setWalls((1 << w.walls.length) - 1);
  const after = ends.map(([a, b]) => plen(a, b)), full = new World(def, { walls: true }); full.walk.set(w.walk); full.brush.set(w.brush);
  // rebuild clearance from scratch on the opened grid and compare with the incremental one
  const ref = new World(def, { walls: true }); ref.walk.set(w.walk); ref.updateClearance(0, 0, N - 1, N - 1);
  for (let i = 0; i < N * N; i++) if (ref.clearance[i] !== w.clearance[i] && i % N > 0 && i % N < N - 1 && i >= N && i < N * N - N) { say(`incremental clearance differs at cell ${i}`); break; }
  w.walls.forEach((x, i) => { if (!(after[i] < before[i] - 120)) say(`wall ${i} (${x.kind}) is no shortcut: ${Math.round(before[i])} -> ${Math.round(after[i])}px`); });
  const reach = RANGE.tower + 14 + 60, tw = (p) => Math.min(...towers.map((t) => Math.hypot(t.x - p.x, t.y - p.y)));
  const spots = [['moon', def.moon], ['yokai', def.yokai], ['centre', [1200, 1200]]];
  for (const [n, q] of spots) {
    if (!q) { say(`no ${n} spot`); continue; }
    const p = { x: q[0], y: q[1] }, o = w.nearestOpen(p);
    if (Math.hypot(o.x - p.x, o.y - p.y) > 40) say(`${n} spot is not open ground`);
    if (n !== 'centre' && tw(p) < reach) say(`${n} spot only ${Math.round(tw(p))}px from a tower (needs ${reach})`);
  }
  console.log(`  ${def.id} Living World: walls ${w.walls.map((x, i) => `${x.kind} ${Math.round(before[i])}->${Math.round(after[i])}px`).join(', ')}${miss ? '' : ' ✔'}`);
  return miss;
}
process.exit(bad ? 1 : 0);

// Tower ground: every lane tower and gate stands on lane ground, inside a clean plaza (no forest, rocks, brush,
// water, pit, shrine or breakable wall in it), with open ground all around it to fight in; tiers are evenly
// spaced along the lane, and the layout is point-mirrored (fair).
function towerCheck(def) {
  const w = new World(def, { walls: !def.single }); let miss = 0;
  const say = (m) => { console.log(`  ✘ ${def.id}: ${m}`); miss++; };
  const lane = w.structures.filter((s) => s.plaza);
  const footOf = (q) => w.structures.some((o) => Math.hypot(o.x - q.x, o.y - q.y) <= (o.kind === 'nexus' ? 40 : 22) + C); // a structure's own footprint
  for (const s of lane) {
    const nm = `${s.kind}${s.tier || ''} ${s.lane} t${s.team}`, ti = w.type[w.idx(s.x, s.y)];
    if (ti !== T_LANE && ti !== T_BASE) say(`${nm} is not on lane ground`);
    const pz = s.plaza, foot = s.kind === 'nexus' ? 40 : 22; let n = 0, blocked = 0, dirty = [];
    for (let cy = 0; cy < N; cy++) for (let cx = 0; cx < N; cx++) {
      const p = { x: cx * C + C / 2, y: cy * C + C / 2 }, i = cy * N + cx;
      if (segDist2(p, pz.a, pz.b) > (pz.r - C / 2) ** 2 || Math.hypot(p.x - s.x, p.y - s.y) <= foot + C) continue;
      n++;
      if (!w.walk[i] && !footOf(p)) blocked++;
      if (w.brush[i]) dirty.push('brush');
      if ([T_RIVER, T_PIT, T_SHRINE].includes(w.type[i])) dirty.push(['', '', '', 'water', '', 'pit', 'shrine'][w.type[i]]);
      if (w.wallAt && w.wallAt[i] >= 0) dirty.push('breakable wall');
    }
    if (dirty.length) say(`${nm} plaza has ${[...new Set(dirty)].join(', ')} in it`);
    // the map border may cut a plaza on an outer-edge lane; anything else blocked is a bug
    const border = (q) => q.x < 2 * C || q.y < 2 * C || q.x > S - 2 * C || q.y > S - 2 * C;
    if (blocked > n * 0.08 && !border({ x: s.x + (s.x - pz.x) * 2.4, y: s.y + (s.y - pz.y) * 2.4 })) say(`${nm} plaza only ${Math.round((1 - blocked / n) * 100)}% open`);
    let ring = 0, open = 0;
    for (let a = 0; a < 32; a++) { const q = { x: s.x + Math.cos(a / 32 * 2 * Math.PI) * 70, y: s.y + Math.sin(a / 32 * 2 * Math.PI) * 70 }; if (border(q) || footOf(q)) continue; ring++; if (w.isWalk(q.x, q.y)) open++; }
    if (open < ring) say(`${nm} has blocked ground ${70}px from it (${ring - open}/${ring})`);
    const m = w.structures.find((o) => o.team === 1 - s.team && o.kind === s.kind && o.x === S - s.x && o.y === S - s.y);
    if (!m) say(`${nm} has no mirrored twin`);
  }
  for (const ln of w.laneNames) for (let t = 0; t < 2; t++) {
    const len = w.laneLen[ln][w.laneLen[ln].length - 1];
    const at = lane.filter((s) => s.lane === ln && s.team === t).map((s) => w.laneProgress(ln, s) * len).sort((a, b) => a - b);
    for (let i = 1; i < at.length; i++) if (at[i] - at[i - 1] < 150) say(`${ln} t${t}: two structures only ${Math.round(at[i] - at[i - 1])}px apart along the lane`);
  }
  return miss;
}
