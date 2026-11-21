// World: builds a walkable grid from a map definition and provides pathfinding,
// line of sight, vision and lane geometry. Deterministic (integer A*, fixed tie-breaks).
import { segDist2 } from './geom.js';

export const S = 2400;          // world size
export const C = 24;            // grid cell size
export const N = S / C;         // 100 x 100 cells

export const T_FOREST = 0, T_GRASS = 1, T_LANE = 2, T_RIVER = 3, T_BASE = 4, T_PIT = 5, T_SHRINE = 6, T_PATH = 7;

const P = (p) => ({ x: S - p.x, y: S - p.y });
const pt = (a) => ({ x: a[0], y: a[1] });

export class World {
  constructor(def) {
    this.def = def;
    this.walk = new Uint8Array(N * N);   // 1 = walkable
    this.type = new Uint8Array(N * N);   // terrain type for painting
    this.brush = new Uint8Array(N * N);  // 1 = tall grass
    this.build();
  }

  // ───────────── geometry ─────────────
  build() {
    const d = this.def;
    const top = d.top.map(pt);
    const bot = top.map(P).reverse();
    const midH = d.midHalf.map(pt);
    const mid = [...midH, ...midH.slice(0, -1).map(P).reverse()];
    this.lanes = { top, mid, bot };
    this.laneNames = ['top', 'mid', 'bot'];
    this.laneLen = {};
    for (const ln of this.laneNames) {
      const p = this.lanes[ln], cum = [0];
      for (let i = 1; i < p.length; i++) cum.push(cum[i - 1] + Math.sqrt((p[i].x - p[i - 1].x) ** 2 + (p[i].y - p[i - 1].y) ** 2));
      this.laneLen[ln] = cum;
    }
    const rivH = d.river.map(pt);
    this.river = [...rivH, ...rivH.slice(0, -1).map(P).reverse()];
    const paths = [];
    for (const pl of d.paths) { const a = pl.map(pt); paths.push(a, a.map(P)); }
    this.paths = paths;

    this.nexus = [{ x: 280, y: 2120 }, P({ x: 280, y: 2120 })];
    this.fountain = [{ x: 90, y: 2310 }, P({ x: 90, y: 2310 })];
    this.baseCenter = [{ x: 310, y: 2090 }, P({ x: 310, y: 2090 })];
    this.pits = { kraken: pt(d.kraken), kami: P(pt(d.kraken)) };
    this.shrines = [pt(d.shrine), P(pt(d.shrine))];      // [blue home shrine, red home shrine]
    this.camps = [];
    for (const c of d.camps) { this.camps.push({ ...c, side: 0, x: c.at[0], y: c.at[1] }); const m = P(pt(c.at)); this.camps.push({ ...c, side: 1, x: m.x, y: m.y }); }

    // ── carve ──
    const W = this.walk, Ty = this.type;
    const cells = (x, y, r, fn) => {
      const c0 = Math.max(0, Math.floor((x - r) / C)), c1 = Math.min(N - 1, Math.floor((x + r) / C));
      const r0 = Math.max(0, Math.floor((y - r) / C)), r1 = Math.min(N - 1, Math.floor((y + r) / C));
      for (let cy = r0; cy <= r1; cy++) for (let cx = c0; cx <= c1; cx++) {
        const px = cx * C + C / 2, py = cy * C + C / 2;
        if ((px - x) ** 2 + (py - y) ** 2 <= r * r) fn(cy * N + cx, px, py);
      }
    };
    const seg = (a, b, r, t, keep) => {
      const minx = Math.min(a.x, b.x) - r, maxx = Math.max(a.x, b.x) + r, miny = Math.min(a.y, b.y) - r, maxy = Math.max(a.y, b.y) + r;
      for (let cy = Math.max(0, Math.floor(miny / C)); cy <= Math.min(N - 1, Math.floor(maxy / C)); cy++)
        for (let cx = Math.max(0, Math.floor(minx / C)); cx <= Math.min(N - 1, Math.floor(maxx / C)); cx++) {
          const p = { x: cx * C + C / 2, y: cy * C + C / 2 };
          if (segDist2(p, a, b) <= r * r) { const i = cy * N + cx; W[i] = 1; if (!keep || keep(Ty[i])) Ty[i] = t; }
        }
    };
    const poly = (pts, r, t, keep) => { for (let i = 1; i < pts.length; i++) seg(pts[i - 1], pts[i], r, t, keep); };
    const circ = (p, r, t, keep) => cells(p.x, p.y, r, (i) => { W[i] = 1; if (!keep || keep(Ty[i])) Ty[i] = t; });
    const notLane = (t) => t !== T_LANE && t !== T_BASE;

    for (const pl of this.paths) poly(pl, 40, T_PATH);
    for (const c of this.camps) circ(c, 104, T_GRASS, (t) => t !== T_LANE);
    for (const cl of d.clear || []) { circ(pt(cl), cl[2], T_GRASS); circ(P(pt(cl)), cl[2], T_GRASS); }
    poly(this.river, d.riverW + 30, T_GRASS, (t) => t === T_FOREST);
    poly(this.river, d.riverW, T_RIVER, notLane);
    if (d.lake) circ({ x: S / 2, y: S / 2 }, d.lake, T_RIVER, notLane);
    for (const k of ['kraken', 'kami']) circ(this.pits[k], 150, T_PIT, notLane);
    for (const s of this.shrines) circ(s, 96, T_SHRINE, notLane);
    for (const ln of this.laneNames) poly(this.lanes[ln], 64, T_LANE);
    for (let t = 0; t < 2; t++) { circ(this.baseCenter[t], 360, T_BASE); circ(this.fountain[t], 150, T_BASE); }
    // ── brush (only on open, non-lane ground) ──
    const addBrush = (b) => cells(b[0], b[1], b[2], (i) => { if (W[i] && Ty[i] !== T_LANE && Ty[i] !== T_BASE && Ty[i] !== T_PIT && Ty[i] !== T_SHRINE) this.brush[i] = 1; });
    for (const b of d.brush) { addBrush(b); const m = P(pt(b)); addBrush([m.x, m.y, b[2]]); }
    // ── rocks re-block (never on lanes/bases) ──
    const addRock = (r) => cells(r[0], r[1], r[2], (i) => { if (Ty[i] !== T_LANE && Ty[i] !== T_BASE) { W[i] = 0; Ty[i] = T_FOREST; this.brush[i] = 0; } });
    this.rocks = [];
    for (const r of d.rocks) { addRock(r); const m = P(pt(r)); addRock([m.x, m.y, r[2]]); this.rocks.push({ x: r[0], y: r[1], r: r[2] }, { x: m.x, y: m.y, r: r[2] }); }
    // border
    for (let i = 0; i < N; i++) for (const k of [0, 1, N - 2, N - 1]) { W[k * N + i] = 0; W[i * N + k] = 0; }

    // ── structures: towers sit BESIDE the lane, on the inner side ──
    this.structures = [];
    const place = (team) => {
      const list = [];
      for (const ln of this.laneNames) {
        const fr = ln === 'mid' ? [0.75, 0.5, 0.29, 0.15] : [0.7, 0.46, 0.27, 0.15];
        const half = this.laneLen[ln][this.laneLen[ln].length - 1] / 2;
        fr.forEach((f, k) => {
          const dist = half * f;
          const prog = team === 0 ? dist / (half * 2) : 1 - dist / (half * 2);
          const at = this.lanePoint(ln, prog), dir = this.laneDir(ln, prog);
          let nx = -dir.y, ny = dir.x;  // a normal
          // choose the side facing the map interior for side lanes; a fixed side for mid
          const toC = { x: S / 2 - at.x, y: S / 2 - at.y };
          if (ln === 'mid') { if ((nx - ny) * (team === 0 ? 1 : -1) > 0) { nx = -nx; ny = -ny; } }
          else if (nx * toC.x + ny * toC.y < 0) { nx = -nx; ny = -ny; }
          const off = k === 3 ? 0 : 92;
          const p = { x: Math.round(at.x + nx * off), y: Math.round(at.y + ny * off) };
          list.push(k === 3 ? { kind: 'inhib', lane: ln, ...p } : { kind: 'tower', tier: k + 1, lane: ln, ...p });
        });
      }
      const nx = this.nexus[team];
      const dd = team === 0 ? 1 : -1;
      list.push({ kind: 'tower', tier: 4, lane: 'base', x: nx.x + 70 * dd, y: nx.y - 150 * dd });
      list.push({ kind: 'tower', tier: 4, lane: 'base', x: nx.x + 150 * dd, y: nx.y - 70 * dd });
      list.push({ kind: 'nexus', lane: 'base', x: nx.x, y: nx.y });
      return list;
    };
    for (let t = 0; t < 2; t++) for (const s of place(t)) this.structures.push({ ...s, team: t });
    // carve around structures so they're reachable, then block their footprint
    for (const s of this.structures) circ(s, s.kind === 'nexus' ? 120 : 70, Ty[this.idx(s.x, s.y)] === T_LANE ? T_LANE : T_BASE, (t) => t === T_FOREST || t === T_GRASS || t === T_PATH);
    for (const s of this.structures) cells(s.x, s.y, s.kind === 'nexus' ? 40 : 22, (i) => { W[i] = 0; });
    // ward spots (Blue view; mirrored for Red)
    // Clearance: steps (8-neighbour) from each open cell to the nearest wall, capped at 4.
    // A* pays extra for low clearance so routes run down the middle of corridors.
    const clr = this.clearance = new Uint8Array(N * N);
    const q = [];
    for (let i = 0; i < N * N; i++) { if (!W[i]) { clr[i] = 0; q.push(i); } else clr[i] = 255; }
    for (let h = 0; h < q.length; h++) {
      const i = q[h], x = i % N, y = (i / N) | 0, nd = clr[i] + 1;
      if (nd > 4) continue;
      for (let k = 0; k < 8; k++) {
        const nx = x + DX[k], ny = y + DY[k]; if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
        const j = ny * N + nx; if (clr[j] > nd) { clr[j] = nd; q.push(j); }
      }
    }
    for (let i = 0; i < N * N; i++) if (clr[i] === 255) clr[i] = 5;
    this.wallNear = new Uint8Array(N * N); for (let i = 0; i < N * N; i++) this.wallNear[i] = W[i] && clr[i] === 1 ? 1 : 0;
    const ws = [this.pits.kami, this.pits.kraken, this.shrines[0], this.shrines[1], ...d.brush.slice(0, 5).map(pt)];
    this.wardSpots = [ws.map((p) => this.nearestOpen(p)), ws.map((p) => this.nearestOpen(P(p)))];
  }

  idx(x, y) { const cx = Math.max(0, Math.min(N - 1, Math.floor(x / C))), cy = Math.max(0, Math.min(N - 1, Math.floor(y / C))); return cy * N + cx; }
  isWalk(x, y) { if (x < 0 || y < 0 || x >= S || y >= S) return false; return this.walk[this.idx(x, y)] === 1; }
  inBrush(x, y) { return this.brush[this.idx(x, y)] === 1; }
  nearestOpen(p) {
    if (this.isWalk(p.x, p.y)) return { x: p.x, y: p.y };
    const c0 = this.idx(p.x, p.y), cx0 = c0 % N, cy0 = (c0 / N) | 0;
    for (let r = 1; r < 20; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const x = cx0 + dx, y = cy0 + dy; if (x < 0 || y < 0 || x >= N || y >= N) continue;
      if (this.walk[y * N + x]) return { x: x * C + C / 2, y: y * C + C / 2 };
    }
    return { x: p.x, y: p.y };
  }

  // ───────────── lanes ─────────────
  lanePoint(lane, prog) {
    const pts = this.lanes[lane], cum = this.laneLen[lane], total = cum[cum.length - 1];
    const d = Math.max(0, Math.min(1, prog)) * total;
    for (let i = 1; i < pts.length; i++) if (d <= cum[i]) {
      const t = (d - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
      return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t };
    }
    return { ...pts[pts.length - 1] };
  }
  laneDir(lane, prog) {
    const a = this.lanePoint(lane, prog - 0.01), b = this.lanePoint(lane, prog + 0.01);
    const l = Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2) || 1; return { x: (b.x - a.x) / l, y: (b.y - a.y) / l };
  }
  laneProgress(lane, p) {
    const pts = this.lanes[lane], cum = this.laneLen[lane];
    let best = Infinity, prog = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], abx = b.x - a.x, aby = b.y - a.y, l2 = abx * abx + aby * aby;
      let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t;
      const x = a.x + abx * t - p.x, y = a.y + aby * t - p.y, d = x * x + y * y;
      if (d < best) { best = d; prog = cum[i - 1] + (cum[i] - cum[i - 1]) * t; }
    }
    return prog / cum[cum.length - 1];
  }
  distToLane(lane, p) {
    const pts = this.lanes[lane]; let best = Infinity;
    for (let i = 1; i < pts.length; i++) best = Math.min(best, segDist2(p, pts[i - 1], pts[i]));
    return Math.sqrt(best);
  }
  closestLane(p) { let b = 'mid', bd = Infinity; for (const ln of this.laneNames) { const d = this.distToLane(ln, p); if (d < bd) { bd = d; b = ln; } } return b; }

  // ───────────── line of sight (grid DDA) ─────────────
  los(ax, ay, bx, by) {
    let x = Math.floor(ax / C), y = Math.floor(ay / C);
    const x1 = Math.floor(bx / C), y1 = Math.floor(by / C);
    const dx = Math.abs(x1 - x), dy = Math.abs(y1 - y), sx = x < x1 ? 1 : -1, sy = y < y1 ? 1 : -1;
    let err = dx - dy, n = dx + dy + 1;
    while (n-- > 0) {
      if (x < 0 || y < 0 || x >= N || y >= N || !this.walk[y * N + x]) return false;
      if (x === x1 && y === y1) return true;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x += sx; } else { err += dx; y += sy; }
    }
    return true;
  }

  // ───────────── A* (8-dir, no corner cutting) ─────────────
  findPath(sx, sy, tx, ty) {
    const s0 = this.nearestOpen({ x: sx, y: sy }), t0 = this.nearestOpen({ x: tx, y: ty });
    const start = this.idx(s0.x, s0.y), goal = this.idx(t0.x, t0.y);
    if (start === goal) return [{ x: tx, y: ty }];
    if (!this._g) { this._g = new Int32Array(N * N); this._from = new Int32Array(N * N); this._stamp = new Int32Array(N * N); this._closed = new Int32Array(N * N); this._run = 0; }
    const G = this._g, F = this._from, St = this._stamp, Cl = this._closed; const run = ++this._run;
    const gx = goal % N, gy = (goal / N) | 0;
    const h = (i) => { const dx = Math.abs(i % N - gx), dy = Math.abs(((i / N) | 0) - gy); return 10 * (dx + dy) - 6 * Math.min(dx, dy); };
    // binary heap of [f, seq, idx]
    const heap = []; let seq = 0;
    const push = (f, i) => { heap.push([f, seq++, i]); let k = heap.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (less(heap[k], heap[p])) { [heap[k], heap[p]] = [heap[p], heap[k]]; k = p; } else break; } };
    const less = (a, b) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < heap.length && less(heap[l], heap[m])) m = l; if (r < heap.length && less(heap[r], heap[m])) m = r; if (m === k) break; [heap[k], heap[m]] = [heap[m], heap[k]]; k = m; } } return top; };
    St[start] = run; G[start] = 0; F[start] = -1; push(h(start), start);
    const W = this.walk;
    let found = false, iter = 0, best = start, bestH = h(start);
    while (heap.length && iter++ < 40000) {
      const [, , cur] = pop();
      if (Cl[cur] === run) continue; Cl[cur] = run;
      if (cur === goal) { found = true; break; }
      const hc = h(cur); if (hc < bestH) { bestH = hc; best = cur; }
      const cx = cur % N, cy = (cur / N) | 0;
      for (let k = 0; k < 8; k++) {
        const dx = DX[k], dy = DY[k], nx = cx + dx, ny = cy + dy;
        if (nx < 1 || ny < 1 || nx >= N - 1 || ny >= N - 1) continue;
        const ni = ny * N + nx; if (!W[ni] || Cl[ni] === run) continue;
        if (dx && dy && (!W[cy * N + nx] || !W[ny * N + cx])) continue;
        // prefer cells away from walls (keeps bodies off tree trunks)
        const ng = G[cur] + (dx && dy ? 14 : 10) + CLR_COST[this.clearance[ni]];
        if (St[ni] !== run || ng < G[ni]) { St[ni] = run; G[ni] = ng; F[ni] = cur; push(ng + h(ni), ni); }
      }
    }
    const end = found ? goal : best;
    const cellsPath = []; for (let c = end; c !== -1; c = F[c]) cellsPath.push(c);
    cellsPath.reverse();
    const raw = cellsPath.map((c) => ({ x: (c % N) * C + C / 2, y: ((c / N) | 0) * C + C / 2 }));
    if (found && this.isWalk(tx, ty)) raw[raw.length - 1] = { x: tx, y: ty };
    if (!raw.length) return [{ x: tx, y: ty }];
    return this.stringPull(sx, sy, raw);
  }
  // Any-angle smoothing: from each anchor keep the furthest waypoint reachable in a straight,
  // body-wide line. Turns the 8-direction staircase into a few clean segments.
  stringPull(sx, sy, raw) {
    const out = []; let ax = sx, ay = sy, i = raw.length > 1 ? 1 : 0; // raw[0] is our own cell: never step back to it
    while (i < raw.length) {
      let far = i;
      const lim = Math.min(raw.length - 1, i + 24);
      for (let j = lim; j > i; j--) if (this.losWide(ax, ay, raw[j].x, raw[j].y)) { far = j; break; }
      if (far === i && out.length === 0) for (let j = Math.min(lim, i + 3); j > i; j--) if (this.los(ax, ay, raw[j].x, raw[j].y)) { far = j; break; }
      out.push(raw[far]); ax = raw[far].x; ay = raw[far].y; i = far + 1;
    }
    return out;
  }
  // LoS that also keeps a body-width margin (checks two offset rays).
  losWide(ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay, l = Math.sqrt(dx * dx + dy * dy) || 1, nx = -dy / l * 9, ny = dx / l * 9;
    return this.los(ax, ay, bx, by) && this.los(ax + nx, ay + ny, bx + nx, by + ny) && this.los(ax - nx, ay - ny, bx - nx, by - ny);
  }

  // Path length estimate (straight-line × detour factor when blocked).
  pathDist(a, b) {
    const d = Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
    if (d < 600 && this.los(a.x, a.y, b.x, b.y)) return d;
    return d * 1.3;
  }

  // ───────────── vision: shadow-casting by rays over the grid ─────────────
  computeVision(sources, out) {
    out.fill(0);
    const W = this.walk, B = this.brush;
    for (const s of sources) {
      const cx = Math.floor(s.x / C), cy = Math.floor(s.y / C), rc = Math.ceil(s.r / C);
      const brushR2 = 6 * 6;
      const inB = B[cy * N + cx];
      if (cx >= 0 && cy >= 0 && cx < N && cy < N) out[cy * N + cx] = 1;
      const rays = rc * 8;
      for (let k = 0; k < rays; k++) {
        // ray endpoint on circle via integer-friendly octant walk (precomputed table)
        const e = RAY[rc] ? RAY[rc][k] : null; if (!e) continue;
        const ex = cx + e[0], ey = cy + e[1];
        let x = cx, y = cy; const dx = Math.abs(ex - x), dy = Math.abs(ey - y), sx = x < ex ? 1 : -1, sy = y < ey ? 1 : -1;
        let err = dx - dy;
        for (;;) {
          if (x === ex && y === ey) break;
          const e2 = 2 * err; if (e2 > -dy) { err -= dy; x += sx; } if (e2 < dx) { err += dx; y += sy; }
          if (x < 0 || y < 0 || x >= N || y >= N) break;
          const i = y * N + x;
          const ddx = x - cx, ddy = y - cy;
          if (B[i] && !(inB && ddx * ddx + ddy * ddy <= 9) && ddx * ddx + ddy * ddy > brushR2) { continue; }
          out[i] = 1;
          if (!W[i]) break;
        }
      }
    }
    return out;
  }
}
const DX = [1, -1, 0, 0, 1, 1, -1, -1], DY = [0, 0, 1, -1, 1, -1, 1, -1];
const CLR_COST = [0, 9, 4, 1, 0, 0];
// Ray endpoints for each radius (cells), evenly around the circle, computed with sqrt only.
const RAY = [];
for (let rc = 1; rc <= 30; rc++) {
  const n = rc * 8, list = [];
  // walk the square perimeter and project onto the circle (no trig needed)
  const per = [];
  for (let i = -rc; i <= rc; i++) per.push([i, -rc]);
  for (let i = -rc + 1; i <= rc; i++) per.push([rc, i]);
  for (let i = rc - 1; i >= -rc; i--) per.push([i, rc]);
  for (let i = rc - 1; i > -rc; i--) per.push([-rc, i]);
  for (let k = 0; k < n; k++) {
    const [x, y] = per[Math.floor(k * per.length / n)];
    const l = Math.sqrt(x * x + y * y);
    list.push([Math.round(x / l * rc), Math.round(y / l * rc)]);
  }
  RAY[rc] = list;
}
