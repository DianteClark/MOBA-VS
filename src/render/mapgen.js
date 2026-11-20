// Paints the static map (ground, lanes, river, bases, forest) once into an offscreen canvas.
import { MAP_SIZE, LANES, NODES, EDGES, CAMPS_BLUE, PITS, STRUCTURES_BLUE, P, FOUNTAIN } from '../sim/map.js';
import { segDist2 } from '../sim/geom.js';
import { IMG } from './assets.js';
import { Rng } from '../sim/rng.js';

const S = MAP_SIZE;
const HALF = 2; // ground painted at half resolution for chunky pixels

function hex(c) { return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)]; }
const C = {
  grass: ['#5f9a34', '#6aa836', '#74a334', '#7fb23c', '#56864c'].map(hex),
  grassLight: ['#8fbf45', '#adbc3a', '#9fc04a'].map(hex),
  dirt: ['#a3754e', '#9c6546', '#ad8058', '#b88b5f'].map(hex),
  dirtEdge: hex('#7d5a3c'),
  water: ['#5fa9c4', '#79b8ce', '#6db3cc'].map(hex), waterHi: hex('#a6e3ef'), waterEdge: hex('#e7d9a8'), deep: hex('#4a8fb0'),
  stone: ['#8e7c73', '#90775e', '#9b8778', '#a39182'].map(hex), stoneDark: hex('#6b5b52'),
  blueStone: ['#6f86a8', '#7a91b3', '#6880a0'].map(hex), redStone: ['#a87070', '#b37a77', '#9f6767'].map(hex),
  pit: ['#6d6157', '#776a5f'].map(hex), sand: ['#d9b37a', '#e3be86'].map(hex),
};

// value noise
function makeNoise(seed) {
  const r = new Rng(seed); const N = 64; const g = new Float32Array(N * N); for (let i = 0; i < g.length; i++) g[i] = r.next();
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const a = g[((yi & 63) * N) + (xi & 63)], b = g[((yi & 63) * N) + ((xi + 1) & 63)], c = g[(((yi + 1) & 63) * N) + (xi & 63)], d = g[(((yi + 1) & 63) * N) + ((xi + 1) & 63)];
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}

function laneDist(p) {
  let best = Infinity;
  for (const k in LANES) { const pts = LANES[k]; for (let i = 1; i < pts.length; i++) best = Math.min(best, segDist2(p, pts[i - 1], pts[i])); }
  return Math.sqrt(best);
}
function edgeDist(p) {
  let best = Infinity;
  for (const [a, b] of EDGES) best = Math.min(best, segDist2(p, NODES[a], NODES[b]));
  return Math.sqrt(best);
}
const bases = [{ x: 300, y: 2100 }, P({ x: 300, y: 2100 })];
const camps = [];
for (const c of CAMPS_BLUE) { camps.push(NODES[c.node]); camps.push(NODES[c.node.replace('b_', 'r_')]); }
const pits = [PITS.dragon, PITS.baron];
function riverDist(p) { // distance to the diagonal river line (between corners)
  const t = Math.max(330, Math.min(S - 330, (p.x + p.y) / 2));
  const dx = p.x - t, dy = p.y - t; return Math.sqrt(dx * dx + dy * dy);
}
const d2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

// Coarse distance fields (8px cells) sampled bilinearly — keeps map painting fast on phones.
const FS = 8, FN = S / FS + 1;
let LDF = null, EDF = null;
function buildFields() {
  if (LDF) return;
  LDF = new Float32Array(FN * FN); EDF = new Float32Array(FN * FN);
  for (let j = 0; j < FN; j++) for (let i = 0; i < FN; i++) { const p = { x: i * FS, y: j * FS }; LDF[j * FN + i] = laneDist(p); EDF[j * FN + i] = edgeDist(p); }
}
function sample(F, p) {
  const fx = Math.max(0, Math.min(FN - 1.001, p.x / FS)), fy = Math.max(0, Math.min(FN - 1.001, p.y / FS));
  const i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j;
  const a = F[j * FN + i], b = F[j * FN + i + 1], c = F[(j + 1) * FN + i], d = F[(j + 1) * FN + i + 1];
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const LD = (p) => sample(LDF, p), ED = (p) => sample(EDF, p);

export function paintMap() {
  buildFields();
  const canvas = document.createElement('canvas'); canvas.width = S; canvas.height = S;
  const ctx = canvas.getContext('2d');
  const W = S / HALF;
  const small = document.createElement('canvas'); small.width = W; small.height = W;
  const sctx = small.getContext('2d');
  const img = sctx.createImageData(W, W), a = img.data;
  const n1 = makeNoise(7), n2 = makeNoise(99), n3 = makeNoise(1234);
  const rng = new Rng(4242);
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const p = { x: x * HALF + 1, y: y * HALF + 1 };
    const i = (y * W + x) * 4;
    const nz = n1(p.x / 90, p.y / 90) * 0.6 + n2(p.x / 25, p.y / 25) * 0.4;
    const jitter = rng.next();
    let col;
    // grass base
    const gi = Math.min(4, Math.floor(nz * 4.2 + (jitter < 0.04 ? 1 : 0)));
    col = C.grass[gi];
    if (n3(p.x / 40, p.y / 40) > 0.72 && jitter < 0.5) col = C.grassLight[Math.floor(jitter * 6) % 3];
    // river
    const rd = riverDist(p) + (n2(p.x / 30, p.y / 30) - 0.5) * 24;
    const inRiverSpan = p.x + p.y > 700 && p.x + p.y < 2 * S - 700;
    const rw = 120;
    // base plazas
    let bi = -1; for (let k = 0; k < 2; k++) if (d2(p, bases[k]) < 380 * 380) bi = k;
    const ld = LD(p) + (n1(p.x / 18, p.y / 18) - 0.5) * 22;
    const ed = ED(p) + (n2(p.x / 15, p.y / 15) - 0.5) * 18;
    if (inRiverSpan && rd < rw) {
      col = rd > rw - 10 ? C.waterEdge : (n3(p.x / 14 + p.y / 50, p.y / 14) > 0.8 && jitter < 0.6 ? C.waterHi : C.water[Math.floor(nz * 3) % 3]);
      if (rd < 40 && jitter < 0.3) col = C.deep;
    } else if (bi >= 0 && d2(p, bases[bi]) < (340 + (n1(p.x / 20, p.y / 20) - 0.5) * 40) ** 2) {
      const pal = bi === 0 ? C.blueStone : C.redStone;
      const tx = Math.floor(p.x / 24), ty = Math.floor(p.y / 24);
      const tile = ((tx * 7 + ty * 13) % 3);
      const edge = (p.x % 24 < 2 && (ty & 1)) || (p.y % 24 < 2);
      col = edge ? pal[(tile + 1) % pal.length].map((v) => v * 0.88) : pal[tile];
    } else if (ld < 50) {
      col = ld > 44 ? C.dirtEdge : C.dirt[Math.floor((nz * 3 + jitter * 0.8)) % 4];
    } else if (ed < 24) {
      col = ed > 19 ? C.grass[4] : C.grassLight[Math.floor(nz * 3) % 3];
    }
    for (const pt of pits) {
      const dd = Math.sqrt(d2(p, pt)) + (n2(p.x / 12, p.y / 12) - 0.5) * 10;
      if (dd < 140) {
        const ring = Math.floor(dd / 28);
        col = dd > 130 ? C.stoneDark : (ring % 2 ? C.pit[0] : C.pit[1]);
        if (n3(p.x / 9, p.y / 9) > 0.78) col = C.stone[Math.floor(jitter * 4)];
      }
    }
    a[i] = col[0]; a[i + 1] = col[1]; a[i + 2] = col[2]; a[i + 3] = 255;
  }
  sctx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(small, 0, 0, S, S);

  // ── decoration + forest ──
  const nat = IMG.TilesetNature;
  if (!nat) return canvas;
  const trees = [[0, 0, 32, 32], [32, 0, 32, 32], [96, 0, 32, 32], [256, 0, 32, 32], [288, 0, 32, 32]];
  const bigTrees = [[48, 288, 48, 48], [0, 32, 64, 48], [64, 32, 64, 48], [256, 32, 64, 48]];
  const autumn = [[144, 288, 48, 48], [0, 288, 48, 48]];
  const bushes = [[0, 160, 16, 16], [16, 160, 16, 16], [32, 160, 16, 16], [64, 160, 16, 16], [80, 160, 16, 16], [96, 160, 16, 16], [128, 160, 16, 16], [144, 160, 16, 16]];
  const flowers = [[0, 176, 16, 16], [16, 176, 16, 16], [32, 176, 16, 16], [48, 176, 16, 16], [96, 176, 16, 16], [112, 176, 16, 16]];
  const rocks = [[272, 272, 16, 16], [288, 272, 16, 16], [304, 272, 16, 16], [240, 320, 16, 16], [256, 320, 16, 16]];
  const items = [];
  const clear = (p, pad = 0) => {
    if (LD(p) < 105 + pad) return false;
    if (ED(p) < 70 + pad) return false;
    if (p.x + p.y > 600 && p.x + p.y < 2 * S - 600 && riverDist(p) < 150 + pad) return false;
    for (const b of bases) if (d2(p, b) < (420 + pad) ** 2) return false;
    for (const c of camps) if (d2(p, c) < (115 + pad) ** 2) return false;
    for (const pt of pits) if (d2(p, pt) < (200 + pad) ** 2) return false;
    return true;
  };
  for (let y = -20; y < S + 40; y += 38) for (let x = -20; x < S + 40; x += 38) {
    const p = { x: x + rng.range(-12, 12), y: y + rng.range(-12, 12) };
    if (!clear(p)) continue;
    const r = rng.next();
    const nearEdge = Math.min(LD(p) - 105, ED(p) - 70);
    if (r < 0.18 && nearEdge > 40) items.push({ x: p.x, y: p.y, src: bigTrees[rng.int(bigTrees.length)], s: 2 });
    else if (r < 0.04 + 0.18 && nearEdge > 30 && n3(p.x / 200, p.y / 200) > 0.7) items.push({ x: p.x, y: p.y, src: autumn[rng.int(2)], s: 2 });
    else items.push({ x: p.x, y: p.y, src: trees[rng.int(trees.length)], s: 2 });
  }
  // sprinkle decor on open ground
  for (let k = 0; k < 900; k++) {
    const p = { x: rng.range(40, S - 40), y: rng.range(40, S - 40) };
    if (LD(p) < 70 || (p.x + p.y > 600 && p.x + p.y < 2 * S - 600 && riverDist(p) < 130)) continue;
    let inBase = false; for (const b of bases) if (d2(p, b) < 360 * 360) inBase = true; if (inBase) continue;
    for (const pt of pits) if (d2(p, pt) < 160 * 160) inBase = true; if (inBase) continue;
    const r = rng.next();
    const src = r < 0.5 ? bushes[rng.int(bushes.length)] : r < 0.8 ? flowers[rng.int(flowers.length)] : rocks[rng.int(rocks.length)];
    items.push({ x: p.x, y: p.y, src, s: 2, decor: true });
  }
  items.sort((u, v) => u.y - v.y);
  for (const it of items) {
    const [sx, sy, sw, sh] = it.src;
    const w = sw * it.s, h = sh * it.s;
    if (!it.decor) { ctx.fillStyle = 'rgba(20,40,20,0.25)'; ctx.beginPath(); ctx.ellipse(it.x, it.y + h * 0.42, w * 0.38, h * 0.12, 0, 0, Math.PI * 2); ctx.fill(); }
    ctx.drawImage(nat, sx, sy, sw, sh, Math.round(it.x - w / 2), Math.round(it.y - h / 2), w, h);
  }
  // camp clearings markers (small stones ring)
  for (const c of camps) {
    for (let k = 0; k < 7; k++) {
      const ang = (k / 7) * Math.PI * 2 + 0.3;
      const p = { x: c.x + Math.cos(ang) * 100, y: c.y + Math.sin(ang) * 80 };
      const src = rocks[k % rocks.length];
      ctx.drawImage(nat, src[0], src[1], 16, 16, p.x - 12, p.y - 12, 24, 24);
    }
  }
  // fountains (shrine tile)
  const tw = IMG.TilesetTowers;
  if (tw) for (let t = 0; t < 2; t++) {
    const f = FOUNTAIN[t];
    ctx.fillStyle = t === 0 ? 'rgba(80,160,255,0.35)' : 'rgba(255,90,90,0.35)';
    ctx.beginPath(); ctx.arc(f.x, f.y, 150, 0, Math.PI * 2); ctx.fill();
    ctx.drawImage(tw, 192, 64, 32, 32, f.x - 40, f.y - 52, 80, 80);
  }
  void STRUCTURES_BLUE;
  return canvas;
}

export function minimapImage(mapCanvas, size) {
  const c = document.createElement('canvas'); c.width = size; c.height = size;
  const x = c.getContext('2d'); x.imageSmoothingEnabled = true; x.drawImage(mapCanvas, 0, 0, size, size);
  return c;
}
