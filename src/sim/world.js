// World: builds a walkable grid from a map definition and provides pathfinding,
// line of sight, vision and lane geometry. Deterministic (integer A*, fixed tie-breaks).
import { segDist2 } from './geom.js';

export const S = 2400;          // world size
export const C = 24;            // grid cell size
export const N = S / C;         // 100 x 100 cells

export const T_FOREST = 0, T_GRASS = 1, T_LANE = 2, T_RIVER = 3, T_BASE = 4, T_PIT = 5, T_SHRINE = 6, T_PATH = 7;
export const T_DEEP = 8, T_SAND = 9; // tide maps: deep water (blocked, painted as sea) and tidal flats (walkable sand that floods)

const P = (p) => ({ x: S - p.x, y: S - p.y });
const pt = (a) => ({ x: a[0], y: a[1] });

export class World {
  // opts.walls: carve the map's breakable walls (Living World, src/sim/living.js); without it the map is unchanged.
  constructor(def, opts = {}) {
    this.def = def; this.opts = opts;
    this.walk = new Uint8Array(N * N);   // 1 = walkable
    this.type = new Uint8Array(N * N);   // terrain type for painting
    this.brush = new Uint8Array(N * N);  // 1 = tall grass
    this.build();
  }

  // ───────────── geometry ─────────────
  build() {
    const d = this.def;
    const top = (d.top || []).map(pt);
    const bot = top.map(P).reverse();
    const midH = d.midHalf.map(pt);
    const mid = [...midH, ...midH.slice(0, -1).map(P).reverse()];
    // single-lane maps (Lane Rush): only mid exists; top/bot alias it so lane lookups never fail
    this.lanes = d.single ? { mid } : { top, mid, bot };
    this.laneNames = d.single ? ['mid'] : ['top', 'mid', 'bot'];
    this.laneLen = {};
    for (const ln of this.laneNames) {
      const p = this.lanes[ln], cum = [0];
      for (let i = 1; i < p.length; i++) cum.push(cum[i - 1] + Math.sqrt((p[i].x - p[i - 1].x) ** 2 + (p[i].y - p[i - 1].y) ** 2));
      this.laneLen[ln] = cum;
    }
    if (d.single) for (const k of ['top', 'bot']) { this.lanes[k] = mid; this.laneLen[k] = this.laneLen.mid; }
    const rivH = d.river.map(pt);
    this.river = [...rivH, ...rivH.slice(0, -1).map(P).reverse()];
    const paths = [];
    for (const pl of d.paths) { const a = pl.map(pt); paths.push(a, a.map(P)); }
    this.paths = paths;

    const NX = d.nexus ? pt(d.nexus) : { x: 280, y: 2120 }, FT = d.fountain ? pt(d.fountain) : { x: 90, y: 2310 }, BC = d.baseCenter ? pt(d.baseCenter) : { x: 310, y: 2090 };
    this.nexus = [NX, P(NX)];
    this.fountain = [FT, P(FT)];
    this.baseCenter = [BC, P(BC)];
    this.pits = { kraken: pt(d.kraken), kami: P(pt(d.kraken)) };
    this.shrines = d.shrine ? [pt(d.shrine), P(pt(d.shrine))] : [];      // [blue home shrine, red home shrine]
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
    for (const ln of this.laneNames) poly(this.lanes[ln], d.laneW || 64, T_LANE);
    for (let t = 0; t < 2; t++) { circ(this.baseCenter[t], d.baseR || 360, T_BASE); circ(this.fountain[t], 150, T_BASE); }
    // tide maps (src/sim/terrain.js): tidal flats (sand that floods at high tide) and deep water (the sea channel's
    // middle, impassable but for the lanes' bridges, the pits and the tide's own crossings)
    const tidal = (t) => t === T_GRASS || t === T_PATH;
    for (const f of d.flats || []) for (const q of [pt(f), P(pt(f))]) cells(q.x, q.y, f[2], (i) => { if (W[i] && tidal(Ty[i])) Ty[i] = T_SAND; });
    for (const s of d.deep || []) for (const [a, b] of [[pt(s), pt(s.slice(2))], [P(pt(s)), P(pt(s.slice(2)))]]) {
      const r = s[4];
      cells((a.x + b.x) / 2, (a.y + b.y) / 2, Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2) / 2 + r, (i, px, py) => {
        if (segDist2({ x: px, y: py }, a, b) <= r * r && Ty[i] !== T_LANE && Ty[i] !== T_BASE && Ty[i] !== T_PIT && Ty[i] !== T_SHRINE) { W[i] = 0; Ty[i] = T_DEEP; }
      });
    }
    // ── structures: towers sit BESIDE the lane (positions depend only on the lane lines) ──
    this.structures = [];
    const place = (team) => {
      const list = [];
      for (const ln of this.laneNames) {
        const tw = d.towerLayout || {}; // 5v5 maps: outer / midFlip / side / mid (see maps/defs.js)
        // 5v5: distances along the lane from the owner's end (T1, T2, T3, gate), the same spacing on every map
        // unless a map overrides it; Lane Rush: d.towers [[fraction of the half-lane, tier]] (tier 4 = the gate)
        const len = this.laneLen[ln][this.laneLen[ln].length - 1];
        const ds = d.towers ? d.towers.map((x) => x[0] * len / 2) : (ln === 'mid' ? tw.midD : tw.sideD) || (ln === 'mid' ? TOWER_D.mid : TOWER_D.side);
        ds.forEach((dist, k0) => {
          const k = d.towers ? d.towers[k0][1] - 1 : k0;
          const prog = team === 0 ? dist / len : 1 - dist / len;
          const at = this.lanePoint(ln, prog), dir = this.laneDir(ln, prog);
          let nx = -dir.y, ny = dir.x;  // a normal
          // side lanes: the side facing the map interior (or the outer edge with towerLayout.outer);
          // mid: a fixed side per team, point-symmetric (mid never runs along (1,1), so nx + ny never vanishes)
          const toC = { x: S / 2 - at.x, y: S / 2 - at.y };
          if (ln === 'mid') { if (((nx + ny) * (team === 0 ? 1 : -1) < 0) !== !!tw.midFlip) { nx = -nx; ny = -ny; } }
          else if ((nx * toC.x + ny * toC.y < 0) !== !!tw.outer) { nx = -nx; ny = -ny; }
          const off = k === 3 ? 0 : TOWER_OFF;
          const p = { x: Math.round(at.x + nx * off), y: Math.round(at.y + ny * off) };
          // its plaza: a capsule of clean lane ground along the lane, shifted toward the tower (room to fight on all sides)
          const cx = at.x + nx * off * 0.5, cy = at.y + ny * off * 0.5, L = PLAZA_L;
          const plaza = { x: Math.round(cx), y: Math.round(cy), r: PLAZA_R, a: { x: Math.round(cx - dir.x * L), y: Math.round(cy - dir.y * L) }, b: { x: Math.round(cx + dir.x * L), y: Math.round(cy + dir.y * L) } };
          list.push(k === 3 ? { kind: 'inhib', lane: ln, ...p, plaza } : { kind: 'tower', tier: k + 1, lane: ln, ...p, plaza });
        });
      }
      const nx = this.nexus[team];
      const dd = team === 0 ? 1 : -1, bt = d.baseTowers || [[70, -150], [150, -70]];
      for (const [ox, oy] of bt) list.push({ kind: 'tower', tier: 4, lane: 'base', x: nx.x + ox * dd, y: nx.y + oy * dd });
      list.push({ kind: 'nexus', lane: 'base', x: nx.x, y: nx.y });
      return list;
    };
    for (let t = 0; t < 2; t++) for (const s of place(t)) this.structures.push({ ...s, team: t });
    // tower plazas: every lane tower and gate stands on a widened patch of lane ground (no forest, brush or
    // rocks); water, pits, shrines and bases keep their own ground (tools/maps.mjs keeps plazas clear of them)
    for (const s of this.structures) if (s.plaza) seg(s.plaza.a, s.plaza.b, s.plaza.r, T_LANE, (t) => t !== T_BASE && t !== T_RIVER && t !== T_PIT && t !== T_SHRINE && t !== T_SAND);
    // ── brush (only on open, non-lane ground) ──
    const addBrush = (b) => cells(b[0], b[1], b[2], (i) => { if (W[i] && Ty[i] !== T_LANE && Ty[i] !== T_BASE && Ty[i] !== T_PIT && Ty[i] !== T_SHRINE) this.brush[i] = 1; });
    for (const b of d.brush) { addBrush(b); const m = P(pt(b)); addBrush([m.x, m.y, b[2]]); }
    // ── rocks re-block (never on lanes/bases) ──
    const addRock = (r) => cells(r[0], r[1], r[2], (i) => { if (Ty[i] !== T_LANE && Ty[i] !== T_BASE && Ty[i] !== T_DEEP) { W[i] = 0; Ty[i] = T_FOREST; this.brush[i] = 0; } });
    this.rocks = [];
    for (const r of d.rocks) { addRock(r); const m = P(pt(r)); addRock([m.x, m.y, r[2]]); for (const q of [{ x: r[0], y: r[1], r: r[2] }, { x: m.x, y: m.y, r: r[2] }]) if (!W[this.idx(q.x, q.y)]) this.rocks.push(q); }
    // border
    for (let i = 0; i < N; i++) for (const k of [0, 1, N - 2, N - 1]) { W[k * N + i] = 0; W[i * N + k] = 0; }
    // carve around structures so they're reachable, then block their footprint
    for (const s of this.structures) circ(s, s.kind === 'nexus' ? 120 : 70, Ty[this.idx(s.x, s.y)] === T_LANE ? T_LANE : T_BASE, (t) => t === T_FOREST || t === T_GRASS || t === T_PATH);
    for (const s of this.structures) cells(s.x, s.y, s.kind === 'nexus' ? 40 : 22, (i) => { W[i] = 0; });
    // ── breakable walls (Living World): a corridor through the forest, carved as ground but blocked until it opens ──
    this.walls = []; this.wallAt = null; this.wallMask = 0;
    if (this.opts.walls && d.walls) {
      this.wallAt = new Int8Array(N * N).fill(-1);
      for (const w of d.walls) for (const [a, b] of [[pt(w), pt(w.slice(2))], [P(pt(w)), P(pt(w.slice(2)))]]) {
        const id = this.walls.length, list = [];
        const minx = Math.min(a.x, b.x) - WALL_R, maxx = Math.max(a.x, b.x) + WALL_R, miny = Math.min(a.y, b.y) - WALL_R, maxy = Math.max(a.y, b.y) + WALL_R;
        for (let cy = Math.max(2, Math.floor(miny / C)); cy <= Math.min(N - 3, Math.floor(maxy / C)); cy++)
          for (let cx = Math.max(2, Math.floor(minx / C)); cx <= Math.min(N - 3, Math.floor(maxx / C)); cx++) {
            const i = cy * N + cx;
            if (W[i] || segDist2({ x: cx * C + C / 2, y: cy * C + C / 2 }, a, b) > WALL_R * WALL_R) continue;
            Ty[i] = T_PATH; this.wallAt[i] = id; list.push(i);
          }
        this.walls.push({ id, kind: w[4] || 'wall', x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, a, b, cells: Int32Array.from(list) });
      }
    }
    // ── tide / wind crossings (src/sim/terrain.js): corridors over water or the void, closed until the tide or the
    // wind opens them (point-mirrored pairs: gate 2k is Blue's half, 2k + 1 its mirror) ──
    this.gates = []; this.gateAt = null; this.gateMask = 0; this.avoid = null;
    if (d.gates) {
      this.gateAt = new Int8Array(N * N).fill(-1);
      for (const w of d.gates) for (const [a, b] of [[pt(w), pt(w.slice(2))], [P(pt(w)), P(pt(w.slice(2)))]]) {
        const id = this.gates.length, list = [], r = w[5] || GATE_R;
        const minx = Math.min(a.x, b.x) - r, maxx = Math.max(a.x, b.x) + r, miny = Math.min(a.y, b.y) - r, maxy = Math.max(a.y, b.y) + r;
        for (let cy = Math.max(2, Math.floor(miny / C)); cy <= Math.min(N - 3, Math.floor(maxy / C)); cy++)
          for (let cx = Math.max(2, Math.floor(minx / C)); cx <= Math.min(N - 3, Math.floor(maxx / C)); cx++) {
            const i = cy * N + cx;
            if (W[i] || this.gateAt[i] >= 0 || segDist2({ x: cx * C + C / 2, y: cy * C + C / 2 }, a, b) > r * r) continue;
            if (w[4] === 'bar') Ty[i] = T_SAND; else if (w[4] === 'raft') Ty[i] = T_DEEP;
            this.gateAt[i] = id; list.push(i);
          }
        this.gates.push({ id, kind: w[4], x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, a, b, cells: Int32Array.from(list) });
      }
    }
    // jump pads: two-way launch links over the void (heroes only; A* treats a flight like walking its straight line)
    this.pads = []; this.links = null;
    if (d.pads) {
      this.links = new Map();
      for (const pd of d.pads) for (const [a, b] of [[pt(pd), pt(pd.slice(2))], [P(pt(pd)), P(pt(pd.slice(2)))]]) {
        const id = this.pads.length, A = this.nearestOpen(a), B = this.nearestOpen(b), ia = this.idx(A.x, A.y), ib = this.idx(B.x, B.y);
        const dx = Math.abs(ia % N - ib % N), dy = Math.abs(((ia / N) | 0) - ((ib / N) | 0)), cost = 10 * (dx + dy) - 6 * Math.min(dx, dy) + PAD_COST;
        this.pads.push({ id, a: A, b: B, len: Math.sqrt((A.x - B.x) ** 2 + (A.y - B.y) ** 2) }); // (sqrt, never Math.hypot: identical on every engine)
        for (const [from, to, dir] of [[ia, ib, 0], [ib, ia, 1]]) (this.links.get(from) || this.links.set(from, []).get(from)).push({ to, cost, pad: id, dir });
      }
    }
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
    // Distance from every cell centre to each lane's centre line (minion leashes; cheap lookups).
    this.laneD = {};
    for (const ln of this.laneNames) {
      const a = this.laneD[ln] = new Float32Array(N * N);
      for (let i = 0; i < N * N; i++) a[i] = this.distToLane(ln, { x: (i % N) * C + C / 2, y: ((i / N) | 0) * C + C / 2 });
    }
    if (d.single) for (const k of ['top', 'bot']) this.laneD[k] = this.laneD.mid;
    const ws = [this.pits.kami, this.pits.kraken, this.shrines[0], this.shrines[1], ...d.brush.slice(0, 5).map(pt)].filter(Boolean);
    this.wardSpots = [ws.map((p) => this.nearestOpen(p)), ws.map((p) => this.nearestOpen(P(p)))];
  }

  // ───────────── breakable walls (Living World) ─────────────
  // Open / close walls to match `mask` (bit i = wall i open). Incremental: only the changed walls' cells flip,
  // clearance (A* wall cost) is recomputed in their neighbourhood, and only the vision-cache entries whose
  // rays could reach them are dropped. Returns true when anything changed (callers drop unit path caches).
  setWalls(mask) {
    if (mask === this.wallMask) return false;
    const diff = mask ^ this.wallMask; this.wallMask = mask;
    for (const w of this.walls) {
      if (!(diff & (1 << w.id))) continue;
      const open = (mask >> w.id) & 1, thicket = w.kind === 'thicket';
      for (const i of w.cells) { this.walk[i] = open; if (thicket) this.brush[i] = open; }
      let x0 = N, y0 = N, x1 = 0, y1 = 0;
      for (const i of w.cells) { const x = i % N, y = (i / N) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      this.updateClearance(x0, y0, x1, y1);
      this.dropVision(x0, y0, x1, y1);
    }
    return true;
  }
  // Open / close the tide and wind crossings to match `mask` (bit i = gate i open), like setWalls.
  setGates(mask) {
    if (mask === this.gateMask) return false;
    const diff = mask ^ this.gateMask; this.gateMask = mask;
    for (const w of this.gates) {
      if (!(diff & (1 << w.id))) continue;
      const open = (mask >> w.id) & 1;
      for (const i of w.cells) this.walk[i] = open;
      let x0 = N, y0 = N, x1 = 0, y1 = 0;
      for (const i of w.cells) { const x = i % N, y = (i / N) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      this.updateClearance(x0, y0, x1, y1);
      this.dropVision(x0, y0, x1, y1);
    }
    return true;
  }
  // Crossings about to close: new routes stay off them (bit i = gate i), units already on one may walk off it.
  setAvoid(mask) {
    if (mask === (this.avoidMask || 0)) return;
    this.avoidMask = mask;
    if (!this.avoid) this.avoid = new Uint8Array(N * N);
    for (const w of this.gates) { const v = (mask >> w.id) & 1; for (const i of w.cells) this.avoid[i] = v; }
  }
  // Clearance (Chebyshev steps to the nearest blocked cell, capped: 1-4, else 5) for the cells within 5 of a box.
  updateClearance(x0, y0, x1, y1) {
    const W = this.walk, clr = this.clearance;
    for (let y = Math.max(0, y0 - 5); y <= Math.min(N - 1, y1 + 5); y++) for (let x = Math.max(0, x0 - 5); x <= Math.min(N - 1, x1 + 5); x++) {
      const i = y * N + x;
      let d = 5;
      if (!W[i]) d = 0;
      else for (let r = 1; r <= 4 && d === 5; r++) for (let yy = y - r; yy <= y + r && d === 5; yy++) for (let xx = x - r; xx <= x + r; xx++) {
        if (Math.max(Math.abs(xx - x), Math.abs(yy - y)) !== r) continue;
        if (xx < 0 || yy < 0 || xx >= N || yy >= N || !W[yy * N + xx]) { d = r; break; }
      }
      clr[i] = d; this.wallNear[i] = W[i] && d === 1 ? 1 : 0;
    }
  }
  dropVision(x0, y0, x1, y1) {
    const cache = this._vis; if (!cache) return;
    for (const key of [...cache.keys()]) {
      const rc = key % 32, c = (key - rc) / 32, cx = c % N, cy = (c / N) | 0;
      if (cx + rc >= x0 && cx - rc <= x1 && cy + rc >= y0 && cy - rc <= y1) cache.delete(key);
    }
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
  laneDistAt(lane, p) { return this.laneD[lane][this.idx(p.x, p.y)]; }
  // The closest point on a lane's centre line.
  laneSnap(lane, p) { return this.lanePoint(lane, this.laneProgress(lane, p)); }
  closestLane(p) { const i = this.idx(p.x, p.y); let b = 'mid', bd = Infinity; for (const ln of this.laneNames) { const d = this.laneD[ln][i]; if (d < bd) { bd = d; b = ln; } } return b; }

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
  // links: heroes may take jump pads (this.links); the route then holds the landing as a waypoint { x, y, land: pad, dir }.
  findPath(sx, sy, tx, ty, links = false) {
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
    const W = this.walk, Av = this.avoidMask ? this.avoid : null, Lk = links ? this.links : null;
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
        const ni = ny * N + nx; if (!W[ni] || Cl[ni] === run || (Av && Av[ni] && !Av[cur])) continue;
        if (dx && dy && (!W[cy * N + nx] || !W[ny * N + cx])) continue;
        // prefer cells away from walls (keeps bodies off tree trunks)
        const ng = G[cur] + (dx && dy ? 14 : 10) + CLR_COST[this.clearance[ni]];
        if (St[ni] !== run || ng < G[ni]) { St[ni] = run; G[ni] = ng; F[ni] = cur; push(ng + h(ni), ni); }
      }
      const ls = Lk && Lk.get(cur);
      if (ls) for (const l of ls) {
        const ni = l.to; if (!W[ni] || Cl[ni] === run) continue;
        const ng = G[cur] + l.cost;
        if (St[ni] !== run || ng < G[ni]) { St[ni] = run; G[ni] = ng; F[ni] = cur; push(ng + h(ni), ni); }
      }
    }
    const end = found ? goal : best;
    const cellsPath = []; for (let c = end; c !== -1; c = F[c]) cellsPath.push(c);
    cellsPath.reverse();
    const raw = cellsPath.map((c) => ({ x: (c % N) * C + C / 2, y: ((c / N) | 0) * C + C / 2 }));
    if (found && this.isWalk(tx, ty)) raw[raw.length - 1] = { x: tx, y: ty };
    if (!raw.length) return [{ x: tx, y: ty }];
    if (Lk) for (let k = 1; k < cellsPath.length; k++) {
      const a = cellsPath[k - 1], b = cellsPath[k];
      if (Math.abs(a % N - b % N) > 1 || Math.abs(((a / N) | 0) - ((b / N) | 0)) > 1) return this.padRoute(sx, sy, raw, cellsPath);
    }
    return this.stringPull(sx, sy, raw);
  }
  // A route with jump pads: smooth each walked stretch on its own, the pad and its landing kept as exact waypoints.
  padRoute(sx, sy, raw, cellsPath) {
    const out = []; let ax = sx, ay = sy, from = 0;
    for (let k = 1; k <= cellsPath.length; k++) {
      const a = cellsPath[k - 1], b = cellsPath[k];
      if (k < cellsPath.length && Math.abs(a % N - b % N) <= 1 && Math.abs(((a / N) | 0) - ((b / N) | 0)) <= 1) continue;
      const part = raw.slice(from, k);
      if (from === 0) out.push(...this.stringPull(ax, ay, part)); else if (part.length > 1) out.push(...this.stringPull(ax, ay, part));
      if (k < cellsPath.length) {
        const l = this.links.get(a).find((q) => q.to === b), pd = this.pads[l.pad], to = l.dir ? pd.a : pd.b, at = l.dir ? pd.b : pd.a;
        if (!out.length || out[out.length - 1].x !== at.x || out[out.length - 1].y !== at.y) out.push({ x: at.x, y: at.y });
        out.push({ x: to.x, y: to.y, land: l.pad, dir: l.dir });
        ax = to.x; ay = to.y; from = k;
      }
    }
    return out;
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
  // Each source's visible cells depend only on its cell and radius (walls and brush never change),
  // so they are cast once and cached as a cell list; a frame is then just OR-ing cached lists.
  // Identical output to casting every ray every time, at a fraction of the cost.
  computeVision(sources, out) {
    out.fill(0);
    const cache = this._vis || (this._vis = new Map());
    const seen = this._visSeen || (this._visSeen = new Set());
    seen.clear();
    for (const s of sources) {
      const cx = Math.floor(s.x / C), cy = Math.floor(s.y / C), rc = Math.ceil(s.r / C);
      if (cx < 0 || cy < 0 || cx >= N || cy >= N || rc > 30) { this.castVision(cx, cy, rc, (i) => { out[i] = 1; }); continue; }
      const key = (cy * N + cx) * 32 + rc;
      if (seen.has(key)) continue;
      seen.add(key);
      let list = cache.get(key);
      if (!list) {
        if (cache.size > 6000) cache.clear();
        const st = this._visStamp || (this._visStamp = new Int32Array(N * N)); const run = (this._visRun = (this._visRun || 0) + 1);
        const tmp = [];
        this.castVision(cx, cy, rc, (i) => { if (st[i] !== run) { st[i] = run; tmp.push(i); } });
        list = Uint16Array.from(tmp); cache.set(key, list);
      }
      for (let k = 0; k < list.length; k++) out[list[k]] = 1;
    }
    return out;
  }
  castVision(cx, cy, rc, mark) {
    const W = this.walk, B = this.brush;
    const brushR2 = 6 * 6;
    const inB = B[cy * N + cx];
    if (cx >= 0 && cy >= 0 && cx < N && cy < N) mark(cy * N + cx);
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
        mark(i);
        if (!W[i]) break;
      }
    }
  }

}
const DX = [1, -1, 0, 0, 1, 1, -1, -1], DY = [0, 0, 1, -1, 1, -1, 1, -1];
const WALL_R = 34; // half-width of a breakable wall's corridor (px)
const GATE_R = 40; // half-width of a tide / wind crossing (px; a map may set its own per crossing)
const PAD_COST = 30; // A*: the extra cost of a jump (a flight otherwise costs what walking its straight line would)
// 5v5 tower spots: distance along the lane from the owner's end, [T1, T2, T3, gate] (towerLayout.sideD / midD override)
export const TOWER_D = { side: [1220, 805, 475, 265], mid: [925, 620, 360, 185] };
const TOWER_OFF = 92, PLAZA_R = 132, PLAZA_L = 84; // tower offset from the lane centre line; plaza: a capsule along the lane (half-width, half-length)
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
