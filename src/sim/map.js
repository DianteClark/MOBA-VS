// Map layout + navigation graph.
// Blue base bottom-left, Red base top-right. Red's layout is the point reflection
// P(x,y) = (S-x, S-y) of Blue's, so the map is perfectly fair.
import { dist2, segDist2 } from './geom.js';

export const MAP_SIZE = 2400;
const S = MAP_SIZE;
export const P = (p) => ({ x: S - p.x, y: S - p.y });

// ---------- Navigation nodes ----------
export const NODES = {};      // name -> {x,y}
const MIRROR = {};
function N(name, x, y, mname) {
  NODES[name] = { x, y };
  if (mname) { NODES[mname] = { x: S - x, y: S - y }; MIRROR[name] = mname; MIRROR[mname] = name; }
  else MIRROR[name] = name;
}
N('bfount', 110, 2290, 'rfount');
N('bbase', 330, 2070, 'rbase');
N('top1', 265, 1750, 'bot7'); N('top2', 265, 1150, 'bot6'); N('top3', 275, 600, 'bot5'); N('top4', 340, 340, 'bot4');
N('bot1', 650, 2135, 'top7'); N('bot2', 1250, 2135, 'top6'); N('bot3', 1800, 2125, 'top5');
N('mid1', 650, 1750, 'mid3'); N('mid2', 1200, 1200);
N('b_bb', 620, 1150, 'r_bb'); N('b_gromp', 450, 1000, 'r_gromp'); N('b_wolf', 640, 1480, 'r_wolf');
N('b_rb', 1250, 1780, 'r_rb'); N('b_rap', 1100, 1560, 'r_rap'); N('b_krug', 1400, 1960, 'r_krug');
N('b_j1', 470, 1380, 'r_j1'); N('b_j2', 900, 1720, 'r_j2'); N('b_j3', 1560, 1880, 'r_j3');
N('rv1', 480, 480, 'rv6'); N('baron', 760, 760, 'dragon'); N('rv2', 1000, 1000, 'rv5');
N('b_re1', 870, 1060, 'r_re1'); N('b_re2', 1480, 1640, 'r_re2');

export const EDGES = [];
const edgeSet = new Set();
function addEdge(a, b) {
  const k = a < b ? a + '|' + b : b + '|' + a;
  if (edgeSet.has(k)) return; edgeSet.add(k); EDGES.push([a, b]);
}
function E(a, b) { addEdge(a, b); addEdge(MIRROR[a], MIRROR[b]); }
[['bfount', 'bbase'], ['bbase', 'top1'], ['top1', 'top2'], ['top2', 'top3'], ['top3', 'top4'], ['top4', 'top5'], ['top5', 'top6'], ['top6', 'top7'], ['top7', 'rbase'],
 ['bbase', 'mid1'], ['mid1', 'mid2'],
 ['top1', 'b_j1'], ['b_j1', 'b_gromp'], ['b_gromp', 'top2'], ['b_gromp', 'b_bb'], ['b_j1', 'b_wolf'], ['b_j1', 'b_bb'], ['b_wolf', 'mid1'],
 ['b_bb', 'b_re1'], ['b_re1', 'baron'], ['b_re1', 'rv2'], ['b_re1', 'mid2'],
 ['mid1', 'b_j2'], ['b_j2', 'b_rap'], ['b_j2', 'bot1'], ['b_rap', 'b_rb'], ['b_rap', 'b_re2'], ['b_rap', 'mid2'],
 ['b_rb', 'b_krug'], ['b_krug', 'bot2'], ['b_rb', 'b_j3'], ['b_j3', 'bot3'], ['b_j3', 'b_re2'], ['b_re2', 'dragon'], ['b_re2', 'rv5'],
 ['top4', 'rv1'], ['top3', 'rv1'], ['top5', 'rv1'], ['rv1', 'baron'], ['baron', 'rv2'], ['rv2', 'mid2'],
].forEach(([a, b]) => E(a, b));

// ---------- All-pairs next hop (Floyd–Warshall; graph is tiny) ----------
export const NODE_NAMES = Object.keys(NODES).sort();
export const NODE_LIST = NODE_NAMES.map((n) => NODES[n]);
const NN = NODE_NAMES.length;
const idx = Object.fromEntries(NODE_NAMES.map((n, i) => [n, i]));
const D = new Float64Array(NN * NN).fill(Infinity);
const NEXT = new Int16Array(NN * NN).fill(-1);
for (let i = 0; i < NN; i++) { D[i * NN + i] = 0; NEXT[i * NN + i] = i; }
for (const [a, b] of EDGES) {
  const i = idx[a], j = idx[b];
  const d = Math.sqrt(dist2(NODES[a], NODES[b]));
  D[i * NN + j] = D[j * NN + i] = d; NEXT[i * NN + j] = j; NEXT[j * NN + i] = i;
}
for (let k = 0; k < NN; k++) for (let i = 0; i < NN; i++) for (let j = 0; j < NN; j++) {
  const v = D[i * NN + k] + D[k * NN + j];
  if (v < D[i * NN + j]) { D[i * NN + j] = v; NEXT[i * NN + j] = NEXT[i * NN + k]; }
}
export function nearestNode(p) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < NN; i++) { const d = dist2(p, NODE_LIST[i]); if (d < bd) { bd = d; best = i; } }
  return best;
}
// Next point to walk toward when going from p to q.
export function navStep(p, q, qNode) {
  if (dist2(p, q) < 320 * 320) return q;
  const a = nearestNode(p), b = qNode ?? nearestNode(q);
  if (a === b) return q;
  const n = NEXT[a * NN + b];
  // If the next node is farther than the destination itself, go straight.
  const nx = NODE_LIST[n];
  if (dist2(p, q) < dist2(p, nx)) return q;
  return nx;
}
export function pathDist(p, q) {
  const a = nearestNode(p), b = nearestNode(q);
  return Math.sqrt(dist2(p, NODE_LIST[a])) + D[a * NN + b] + Math.sqrt(dist2(NODE_LIST[b], q));
}

// ---------- Lanes (from Blue base to Red base) ----------
const L = (names) => names.map((n) => ({ ...NODES[n] }));
export const LANES = {
  top: L(['bbase', 'top1', 'top2', 'top3', 'top4', 'top5', 'top6', 'top7', 'rbase']),
  mid: L(['bbase', 'mid1', 'mid2', 'mid3', 'rbase']),
  bot: L(['bbase', 'bot1', 'bot2', 'bot3', 'bot4', 'bot5', 'bot6', 'bot7', 'rbase']),
};
export const LANE_NAMES = ['top', 'mid', 'bot'];
// Cumulative lengths for progress queries.
export const LANE_LEN = {};
for (const ln of LANE_NAMES) {
  const pts = LANES[ln]; const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.sqrt(dist2(pts[i - 1], pts[i])));
  LANE_LEN[ln] = cum;
}
// Progress (0..1 from blue base to red base) of the closest point on a lane.
export function laneProgress(lane, p) {
  const pts = LANES[lane], cum = LANE_LEN[lane];
  let best = Infinity, prog = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const abx = b.x - a.x, aby = b.y - a.y, l2 = abx * abx + aby * aby;
    let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t;
    const x = a.x + abx * t - p.x, y = a.y + aby * t - p.y, d = x * x + y * y;
    if (d < best) { best = d; prog = cum[i - 1] + (cum[i] - cum[i - 1]) * t; }
  }
  return prog / cum[cum.length - 1];
}
export function lanePoint(lane, prog) {
  const pts = LANES[lane], cum = LANE_LEN[lane], total = cum[cum.length - 1];
  const d = Math.max(0, Math.min(1, prog)) * total;
  for (let i = 1; i < pts.length; i++) {
    if (d <= cum[i]) {
      const t = (d - cum[i - 1]) / (cum[i] - cum[i - 1]);
      return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t };
    }
  }
  return { ...pts[pts.length - 1] };
}
export function distToLane(lane, p) {
  const pts = LANES[lane]; let best = Infinity;
  for (let i = 1; i < pts.length; i++) best = Math.min(best, segDist2(p, pts[i - 1], pts[i]));
  return Math.sqrt(best);
}
export function closestLane(p) {
  let best = 'mid', bd = Infinity;
  for (const ln of LANE_NAMES) { const d = distToLane(ln, p); if (d < bd) { bd = d; best = ln; } }
  return best;
}

// ---------- Structures (Blue side; Red mirrored) ----------
export const STRUCTURES_BLUE = [
  { kind: 'tower', tier: 1, lane: 'top', x: 265, y: 850 },
  { kind: 'tower', tier: 2, lane: 'top', x: 265, y: 1300 },
  { kind: 'tower', tier: 3, lane: 'top', x: 265, y: 1700 },
  { kind: 'inhib', lane: 'top', x: 275, y: 1860 },
  { kind: 'tower', tier: 1, lane: 'mid', x: 1000, y: 1400 },
  { kind: 'tower', tier: 2, lane: 'mid', x: 800, y: 1600 },
  { kind: 'tower', tier: 3, lane: 'mid', x: 600, y: 1800 },
  { kind: 'inhib', lane: 'mid', x: 480, y: 1920 },
  { kind: 'tower', tier: 1, lane: 'bot', x: 1550, y: 2135 },
  { kind: 'tower', tier: 2, lane: 'bot', x: 1100, y: 2135 },
  { kind: 'tower', tier: 3, lane: 'bot', x: 700, y: 2135 },
  { kind: 'inhib', lane: 'bot', x: 540, y: 2125 },
  { kind: 'tower', tier: 4, lane: 'base', x: 345, y: 1975 },
  { kind: 'tower', tier: 4, lane: 'base', x: 425, y: 2055 },
  { kind: 'nexus', lane: 'base', x: 275, y: 2125 },
];
export const FOUNTAIN = [{ x: 90, y: 2310 }, { x: S - 90, y: S - 2310 }];

// ---------- Jungle camps (Blue side; Red mirrored) ----------
export const CAMPS_BLUE = [
  { id: 'bb', name: 'Sentinel', node: 'b_bb', buff: 'blue', mobs: [{ k: 'camp_bluebuff', hp: 1800, ad: 45, big: true }] },
  { id: 'rb', name: 'Brambleback', node: 'b_rb', buff: 'red', mobs: [{ k: 'camp_redbuff', hp: 1800, ad: 55, big: true }] },
  { id: 'wolf', name: 'Wolves', node: 'b_wolf', mobs: [{ k: 'camp_wolf', hp: 1100, ad: 35, big: true }, { k: 'camp_wolf', hp: 400, ad: 15, dx: 34, dy: 20 }, { k: 'camp_wolf', hp: 400, ad: 15, dx: -30, dy: 26 }] },
  { id: 'rap', name: 'Raptors', node: 'b_rap', mobs: [{ k: 'camp_raptor', hp: 800, ad: 25, big: true }, { k: 'camp_raptor', hp: 250, ad: 10, dx: 30, dy: -18 }, { k: 'camp_raptor', hp: 250, ad: 10, dx: -28, dy: 22 }, { k: 'camp_raptor', hp: 250, ad: 10, dx: 6, dy: 34 }] },
  { id: 'gromp', name: 'Gromp', node: 'b_gromp', mobs: [{ k: 'camp_gromp', hp: 1500, ad: 50, big: true }] },
  { id: 'krug', name: 'Krugs', node: 'b_krug', mobs: [{ k: 'camp_krug', hp: 1300, ad: 40, big: true }, { k: 'camp_krug', hp: 700, ad: 20, dx: 34, dy: 10 }] },
];

export const PITS = { dragon: NODES.dragon, baron: NODES.baron };

// Ward spots (Blue perspective; Red mirrored).
export const WARD_SPOTS_BLUE = [
  { x: 1500, y: 1500 }, { x: 900, y: 900 }, { x: 1250, y: 1560 }, { x: 680, y: 1000 }, { x: 1640, y: 1980 }, { x: 420, y: 760 },
];

export const MIRROR_NODE = MIRROR;
