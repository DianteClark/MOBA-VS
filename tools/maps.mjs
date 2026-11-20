// Validate every map: connectivity of all key points, and dump a PPM preview per map.
//   node tools/maps.mjs [outDir]
import { writeFileSync } from 'node:fs';
import { MAPS } from '../src/maps/defs.js';
import { World, N, C } from '../src/sim/world.js';
const out = process.argv[2];
let bad = 0;
for (const def of MAPS) {
  const w = new World(def);
  const seen = new Uint8Array(N * N); const q = [];
  const s = w.nearestOpen(w.fountain[0]); const s0 = w.idx(s.x, s.y); seen[s0] = 1; q.push(s0);
  while (q.length) { const c = q.pop(); const x = c % N, y = (c / N) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; const i = ny * N + nx; if (nx >= 0 && ny >= 0 && nx < N && ny < N && w.walk[i] && !seen[i]) { seen[i] = 1; q.push(i); } } }
  const pts = [['red fountain', w.fountain[1]], ['kraken', w.pits.kraken], ['kami', w.pits.kami], ...w.shrines.map((p, i) => ['shrine' + i, p]), ...w.camps.map((c) => ['camp ' + c.id + c.side, c])];
  for (const ln of w.laneNames) for (let k = 0; k <= 20; k++) pts.push([`${ln}@${k / 20}`, w.lanePoint(ln, k / 20)]);
  for (const st of w.structures) { const near = [[0, 40], [40, 0], [0, -40], [-40, 0], [50, 50], [-50, -50], [50, -50], [-50, 50]].some(([dx, dy]) => w.isWalk(st.x + dx, st.y + dy) && seen[w.idx(st.x + dx, st.y + dy)]); if (!near) { console.log(`  ✘ ${def.id}: structure ${st.kind} ${st.lane} t${st.team} unreachable`); bad++; } }
  let miss = 0;
  for (const [n, p] of pts) { const o = w.nearestOpen(p); if (!seen[w.idx(o.x, o.y)] || Math.hypot(o.x - p.x, o.y - p.y) > 60) { console.log(`  ✘ ${def.id}: ${n} unreachable`); miss++; } }
  bad += miss;
  const open = w.walk.reduce((a, b) => a + b, 0), brush = w.brush.reduce((a, b) => a + b, 0);
  const t0 = Date.now(); let plen = 0; for (let k = 0; k < 50; k++) { const p = w.findPath(w.fountain[0].x, w.fountain[0].y, w.camps[k % w.camps.length].x, w.camps[k % w.camps.length].y); plen += p.length; } const ms = (Date.now() - t0) / 50;
  console.log(`${def.name}: open ${(open / N / N * 100).toFixed(0)}%, brush cells ${brush}, structures ${w.structures.length}, A* ${ms.toFixed(2)}ms avg, ${miss ? 'ISSUES' : 'all reachable ✔'}`);
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
process.exit(bad ? 1 : 0);
