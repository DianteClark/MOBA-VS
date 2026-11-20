// Paints a World into an offscreen canvas: themed ground (half-res chunky pixels) with
// organic edges, then forest, rocks, tall grass and decor from TilesetNature.
import { S, C, N, T_FOREST, T_GRASS, T_LANE, T_RIVER, T_BASE, T_PIT, T_SHRINE, T_PATH } from '../sim/world.js';
import { IMG } from './assets.js';
import { Rng } from '../sim/rng.js';

const HALF = 2;
const hex = (c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
const pal = (a) => a.map(hex);

export const SPR = {
  g0: [0, 0, 32, 32], pine: [32, 0, 32, 32], dead: [64, 0, 32, 32], roots: [96, 0, 32, 32], snowpine: [128, 0, 32, 32], snowpine2: [160, 0, 32, 32],
  white: [192, 0, 32, 32], pink: [224, 0, 32, 32], g1: [256, 0, 32, 32], yel: [288, 0, 32, 32],
  tPine: [0, 32, 64, 48], tGreen: [64, 32, 64, 48], tWhite: [128, 32, 64, 48], tPink: [192, 32, 64, 48], tG2: [256, 32, 64, 48], tYel: [320, 32, 64, 48],
  deadTri: [0, 80, 64, 48], snowTri: [64, 80, 64, 48], snowTri2: [128, 80, 64, 48], rockTri: [192, 80, 64, 48], rockTriG: [256, 80, 64, 48],
  stump: [0, 128, 32, 32], bigPink: [0, 288, 48, 48], bigGreen: [48, 288, 48, 48], bigWhite: [96, 288, 48, 48], bigOrange: [144, 288, 48, 48],
  rockBig: [272, 160, 64, 48], rockTall: [336, 160, 32, 48], rockGBig: [272, 224, 64, 48], rockGTall: [336, 224, 32, 48],
  blueRock: [0, 192, 32, 32], snowRock: [32, 192, 32, 32],
  grass1: [48, 160, 16, 16], grass2: [112, 160, 16, 16], grass3: [144, 160, 16, 16], reed: [112, 176, 16, 16],
  flowerY: [0, 176, 16, 16], flowerO: [16, 176, 16, 16], clover: [32, 176, 16, 16], flowerR: [48, 176, 16, 16], flowerW: [96, 176, 16, 16],
  bush1: [0, 160, 16, 16], bush2: [16, 160, 16, 16], bush3: [32, 160, 16, 16], pebble: [272, 272, 16, 16], pebble2: [288, 272, 16, 16], pebbleS: [240, 320, 16, 16],
};

export const THEMES = {
  spring: {
    ground: pal(['#5f9a34', '#6aa836', '#74a334', '#7fb23c']), accent: pal(['#8fbf45', '#9fc04a', '#adbc3a']), forestFloor: pal(['#2e5a2c', '#335f2e']),
    lane: pal(['#a3754e', '#9c6546', '#ad8058', '#b88b5f']), laneEdge: hex('#7d5a3c'), path: pal(['#8fb04a', '#97b752', '#86a843']), pathEdge: hex('#5f8a36'),
    water: pal(['#5fa9c4', '#79b8ce', '#6db3cc']), waterHi: hex('#a6e3ef'), deep: hex('#4a8fb0'), shore: hex('#e7d9a8'),
    base: [pal(['#7d8ea6', '#8394ab', '#7889a1']), pal(['#a88480', '#ad8985', '#a37f7b'])], pit: pal(['#6d6157', '#776a5f', '#827468']), shrine: pal(['#d9c27a', '#e6cf86', '#cbb46c']),
    trees: ['g0', 'pine', 'roots', 'g1', 'g0', 'pine', 'g1', 'pine', 'g0', 'pink'], big: ['tGreen', 'tPine', 'tG2', 'bigGreen', 'tGreen', 'tPine', 'tG2', 'bigPink'],
    rocks: ['rockGBig', 'rockTriG', 'rockGTall'], tall: ['grass1', 'grass2', 'grass3'], decor: ['flowerY', 'flowerO', 'clover', 'flowerR', 'flowerW', 'bush1', 'bush2', 'bush3', 'pebble'],
    sky: '#1b2a1a', fog: [10, 18, 30],
  },
  winter: {
    ground: pal(['#e3eaf2', '#dbe4ee', '#eef3f8', '#d2dde9']), accent: pal(['#f7fafc', '#c9d6e4']), forestFloor: pal(['#9aaec2', '#a3b6c9']),
    lane: pal(['#b4bfcc', '#a9b5c3', '#bec8d4', '#a3afbd']), laneEdge: hex('#8794a5'), path: pal(['#c8d3df', '#cfd9e4']), pathEdge: hex('#aab8c8'),
    water: pal(['#a9dcef', '#b8e4f2', '#9fd4ea']), waterHi: hex('#e8f8fd'), deep: hex('#86c4dd'), shore: hex('#f2f6fa'),
    base: [pal(['#8a9bb4', '#93a3ba', '#8696ae']), pal(['#b0959a', '#b79ca1', '#aa8f94'])], pit: pal(['#7c8a99', '#8593a2', '#8e9cab']), shrine: pal(['#d6e6f2', '#e4eff7', '#c9dbe9']),
    trees: ['snowpine', 'snowpine2', 'white', 'snowpine', 'pine'], big: ['snowTri', 'snowTri2', 'tWhite', 'bigWhite', 'snowTri'],
    rocks: ['snowRock', 'blueRock', 'rockTriG'], tall: ['grass2', 'reed', 'grass3'], decor: ['pebbleS', 'pebble2', 'snowRock', 'bush3'],
    sky: '#1d2733', ice: true, fog: [20, 28, 48],
  },
  autumn: {
    ground: pal(['#b59a3c', '#c4a442', '#a88a34', '#bd9f44']), accent: pal(['#d7b456', '#cfae4f', '#e0bd5c']), forestFloor: pal(['#5e4128', '#664630']),
    lane: pal(['#a35a3a', '#9a5236', '#b0653f', '#a85e3c']), laneEdge: hex('#6e3a24'), path: pal(['#c79f58', '#cfa860', '#bf9752']), pathEdge: hex('#93723d'),
    water: pal(['#5e9a8f', '#6aa79a', '#589286']), waterHi: hex('#9fd1c3'), deep: hex('#4a7f74'), shore: hex('#d9b77a'),
    base: [pal(['#8a8f9e', '#9196a5', '#858a99']), pal(['#a9877a', '#b08e80', '#a48275'])], pit: pal(['#6e5546', '#785e4e', '#826756']), shrine: pal(['#e3b866', '#eec574', '#d6aa5a']),
    trees: ['yel', 'dead', 'yel', 'yel', 'dead'], big: ['tYel', 'bigOrange', 'deadTri', 'tYel', 'bigOrange', 'bigOrange'],
    rocks: ['rockBig', 'rockTri', 'rockTall'], tall: ['grass1', 'grass3', 'reed'], decor: ['pebble', 'pebble2', 'flowerO', 'bush2', 'stump'],
    sky: '#2a1d14', fog: [26, 16, 10],
  },
};

function makeNoise(seed) {
  const r = new Rng(seed); const M = 64; const g = new Float32Array(M * M); for (let i = 0; i < g.length; i++) g[i] = r.next();
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const a = g[((yi & 63) * M) + (xi & 63)], b = g[((yi & 63) * M) + ((xi + 1) & 63)], c = g[(((yi + 1) & 63) * M) + (xi & 63)], d = g[(((yi + 1) & 63) * M) + ((xi + 1) & 63)];
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}

export function paintMap(world) {
  const th = THEMES[world.def.theme] || THEMES.spring;
  const canvas = document.createElement('canvas'); canvas.width = S; canvas.height = S;
  const ctx = canvas.getContext('2d');
  const Wd = S / HALF;
  const small = document.createElement('canvas'); small.width = Wd; small.height = Wd;
  const sctx = small.getContext('2d');
  const img = sctx.createImageData(Wd, Wd), a = img.data;
  const n1 = makeNoise(7), n2 = makeNoise(99), n3 = makeNoise(1234);
  const rng = new Rng(4242 + world.def.id.length);
  const typeAt = (x, y) => {
    const cx = Math.max(0, Math.min(N - 1, Math.floor(x / C))), cy = Math.max(0, Math.min(N - 1, Math.floor(y / C)));
    return world.walk[cy * N + cx] ? world.type[cy * N + cx] : T_FOREST;
  };
  const b0 = world.baseCenter[0], b1 = world.baseCenter[1];
  for (let y = 0; y < Wd; y++) for (let x = 0; x < Wd; x++) {
    const px = x * HALF + 1, py = y * HALF + 1;
    const jx = (n2(px / 22, py / 22) - 0.5) * 26, jy = (n1(px / 22 + 9, py / 22) - 0.5) * 26;
    const t = typeAt(px + jx, py + jy);
    const tc = typeAt(px, py);
    const nz = n1(px / 90, py / 90) * 0.6 + n2(px / 25, py / 25) * 0.4;
    const j = rng.next();
    let col;
    switch (t) {
      case T_LANE: {
        const edge = typeAt(px + 14, py) !== T_LANE || typeAt(px - 14, py) !== T_LANE || typeAt(px, py + 14) !== T_LANE || typeAt(px, py - 14) !== T_LANE;
        col = edge && j < 0.7 ? th.laneEdge : th.lane[Math.floor(nz * 3 + j * 0.9) % th.lane.length];
        break;
      }
      case T_PATH: col = th.path[Math.floor(nz * 3 + j * 0.6) % th.path.length]; if (j < 0.03) col = th.pathEdge; break;
      case T_RIVER: {
        const shoreNear = typeAt(px + 16, py) !== T_RIVER || typeAt(px - 16, py) !== T_RIVER || typeAt(px, py + 16) !== T_RIVER || typeAt(px, py - 16) !== T_RIVER;
        col = shoreNear ? (j < 0.8 ? th.shore : th.water[0]) : (n3(px / 14 + py / 50, py / 14) > 0.8 && j < 0.6 ? th.waterHi : th.water[Math.floor(nz * 3) % 3]);
        if (!shoreNear && j < 0.08) col = th.deep;
        if (th.ice && !shoreNear && ((px * 7 + py * 3) % 97 < 2)) col = th.deep;
        break;
      }
      case T_BASE: {
        const team = (px - b0.x) ** 2 + (py - b0.y) ** 2 < (px - b1.x) ** 2 + (py - b1.y) ** 2 ? 0 : 1;
        const P_ = th.base[team], tx = Math.floor(px / 24), ty = Math.floor(py / 24), tile = (tx * 7 + ty * 13) % 3;
        const edge = (px % 24 < 2 && (ty & 1)) || (py % 24 < 2);
        col = edge ? P_[(tile + 1) % 3].map((v) => v * 0.86) : P_[tile];
        break;
      }
      case T_PIT: {
        let dp = 1e9; for (const k of ['kami', 'kraken']) { const q = world.pits[k]; dp = Math.min(dp, Math.sqrt((px - q.x) ** 2 + (py - q.y) ** 2)); }
        const ring = Math.floor((dp + n2(px / 8, py / 8) * 14) / 26);
        col = th.pit[ring % 3].map((v) => v * (0.78 + Math.min(1, dp / 150) * 0.22));
        if (j < 0.04) col = col.map((v) => v * 0.85);
        break;
      }
      case T_SHRINE: { const tx = Math.floor(px / 16), ty = Math.floor(py / 16); col = th.shrine[(tx + ty * 2) % 3]; if (px % 16 < 2 || py % 16 < 2) col = col.map((v) => v * 0.82); break; }
      case T_FOREST: col = th.forestFloor[j < 0.5 ? 0 : 1]; break;
      default: {
        const gi = Math.min(th.ground.length - 1, Math.floor(nz * th.ground.length));
        col = th.ground[gi];
        if (n3(px / 40, py / 40) > 0.72 && j < 0.5) col = th.accent[Math.floor(j * 6) % th.accent.length];
      }
    }
    if (world.brush[world.idx(px, py)] && tc !== T_FOREST) col = col.map((v) => v * 0.8);
    const i = (y * Wd + x) * 4; a[i] = col[0]; a[i + 1] = col[1]; a[i + 2] = col[2]; a[i + 3] = 255;
  }
  sctx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(small, 0, 0, S, S);

  const nat = IMG.TilesetNature; if (!nat) return canvas;
  const items = [];
  const open = (x, y) => world.isWalk(x, y);
  for (let cy = 0; cy < N; cy++) for (let cx = 0; cx < N; cx++) {
    const i = cy * N + cx; if (world.walk[i]) continue;
    const x = cx * C + C / 2, y = cy * C + C / 2;
    let skip = false;
    for (const s of world.structures) if ((s.x - x) ** 2 + (s.y - y) ** 2 < 48 * 48) skip = true;
    for (const r of world.rocks) if ((r.x - x) ** 2 + (r.y - y) ** 2 < (r.r + 4) ** 2) skip = true;
    if (skip) continue;
    const oE = open(x + C, y), oW = open(x - C, y), oS = open(x, y + C), oN = open(x, y - C);
    const edge = oE || oW || oS || oN;
    if (!edge && (cx + cy * 3) % 2 === 1 && rng.next() < 0.55) continue;
    const big = !edge && rng.next() < 0.35;
    const key = big ? th.big[rng.int(th.big.length)] : th.trees[rng.int(th.trees.length)];
    // edge trees lean back from the open ground so paths and water stay readable
    const nx = (oE ? -6 : 0) + (oW ? 6 : 0), ny = (oS ? -4 : 0) + (oN ? 10 : 0);
    items.push({ x: x + nx + rng.range(-5, 5), y: y + ny + rng.range(-5, 5), key, s: edge ? 1.75 : 2 });
  }
  for (const r of world.rocks) {
    const n = Math.max(1, Math.round(r.r / 22));
    for (let k = 0; k < n; k++) items.push({ x: r.x + (k ? rng.range(-r.r * 0.5, r.r * 0.5) : 0), y: r.y + (k ? rng.range(-r.r * 0.5, r.r * 0.5) : 0), key: th.rocks[rng.int(th.rocks.length)], s: 2 });
  }
  // pit rims: a ring of stones around Kami / Kraken pits
  for (const k of ['kami', 'kraken']) {
    const p = world.pits[k];
    for (let a = 0; a < 28; a++) {
      const t = a / 28 * 6.2832, rr = 150 + rng.range(-6, 6);
      const x = p.x + Math.cos(t) * rr, y = p.y + Math.sin(t) * rr * 0.92;
      if (world.isWalk(x, y) && world.type[world.idx(x, y)] === T_LANE) continue;
      items.push({ x, y, key: th.rocks[0] === 'snowRock' ? 'pebbleS' : rng.next() < 0.5 ? 'pebble' : 'pebble2', s: 2.4, decor: true });
    }
  }
  for (let i = 0; i < N * N; i++) if (world.brush[i]) {
    const cx = i % N, cy = (i / N) | 0;
    for (let k = 0; k < 3; k++) items.push({ x: cx * C + rng.range(2, 22), y: cy * C + rng.range(4, 24), key: th.tall[rng.int(th.tall.length)], s: 2, decor: true });
  }
  for (let k = 0; k < 800; k++) {
    const x = rng.range(40, S - 40), y = rng.range(40, S - 40);
    const i = world.idx(x, y); if (!world.walk[i] || world.type[i] !== T_GRASS || world.brush[i]) continue;
    items.push({ x, y, key: th.decor[rng.int(th.decor.length)], s: 2, decor: true });
  }
  items.sort((u, v) => u.y - v.y);
  for (const it of items) {
    const [sx, sy, sw, sh] = SPR[it.key];
    const w = sw * it.s, h = sh * it.s;
    if (!it.decor) { ctx.fillStyle = 'rgba(10,20,10,0.22)'; ctx.beginPath(); ctx.ellipse(it.x, it.y + h * 0.3, w * 0.4, h * 0.13, 0, 0, Math.PI * 2); ctx.fill(); }
    ctx.drawImage(nat, sx, sy, sw, sh, Math.round(it.x - w / 2), Math.round(it.y - h * 0.62), w, h);
  }
  const tw = IMG.TilesetTowers;
  if (tw) for (let t = 0; t < 2; t++) {
    const f = world.fountain[t];
    const g = ctx.createRadialGradient(f.x, f.y, 10, f.x, f.y, 150);
    g.addColorStop(0, t === 0 ? 'rgba(90,170,255,0.55)' : 'rgba(255,100,100,0.55)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(f.x, f.y, 150, 0, Math.PI * 2); ctx.fill();
    ctx.drawImage(tw, 192, 64, 32, 32, f.x - 40, f.y - 52, 80, 80);
  }
  return canvas;
}
