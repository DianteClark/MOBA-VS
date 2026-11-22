// Paints a World into an offscreen canvas: themed ground (half-res chunky pixels) with
// organic edges, then forest, rocks, tall grass and decor from TilesetNature.
import { S, C, N, T_FOREST, T_GRASS, T_LANE, T_RIVER, T_BASE, T_PIT, T_SHRINE, T_PATH, T_DEEP, T_SAND } from '../sim/world.js';
import { IMG } from './assets.js';
import { Rng } from '../sim/rng.js';

const HALF = 2;
const hex = (c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
const pal = (a) => a.map(hex);

export const SPR = { // (exported: Living World walls reuse the rock / bush art; Dojo lore panels draw props)
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
  fernO: [0, 224, 16, 16], fernB: [16, 224, 16, 16], fernP: [32, 224, 16, 16], fernG: [48, 224, 16, 16], berry1: [64, 224, 16, 16], berry2: [80, 224, 16, 16],
  mossRock: [96, 224, 16, 16], berryBush: [112, 224, 32, 32], oreRock: [144, 224, 32, 32], stumpS: [64, 128, 16, 16], twig: [64, 144, 16, 16], pumpkin: [144, 128, 16, 16],
  spikes: [96, 192, 16, 16], blueStone: [112, 192, 16, 16], snowMound: [128, 192, 16, 16], snowball: [144, 192, 16, 16], sprout: [192, 160, 16, 16], leafO: [192, 176, 16, 16],
  // other sheets: [x, y, w, h, image key]
  palm1: [160, 160, 32, 32, 'TilesetDesert'], palm2: [192, 160, 32, 32, 'TilesetDesert'], palmG: [160, 64, 64, 48, 'TilesetDesert'], palmG2: [160, 112, 64, 48, 'TilesetDesert'],
  dome: [0, 0, 48, 48, 'TilesetDesert'], sandHouse: [96, 0, 64, 48, 'TilesetDesert'], lion: [0, 96, 32, 48, 'TilesetDesert'], well: [0, 48, 32, 32, 'TilesetDesert'],
  shrubD: [224, 160, 16, 16, 'TilesetDesert'], shrubD2: [224, 176, 16, 16, 'TilesetDesert'], skull: [256, 176, 16, 16, 'TilesetDesert'], bone: [272, 176, 16, 16, 'TilesetDesert'],
  mossTree: [0, 96, 64, 48, 'TilesetVillageAbandoned'], mossTree2: [0, 144, 64, 48, 'TilesetVillageAbandoned'], mossBush: [64, 96, 32, 32, 'TilesetVillageAbandoned'], mossBush2: [64, 144, 32, 32, 'TilesetVillageAbandoned'],
  statue: [0, 48, 32, 48, 'TilesetVillageAbandoned'], pillar: [32, 48, 16, 48, 'TilesetVillageAbandoned'], stoneBits: [48, 64, 16, 32, 'TilesetVillageAbandoned'], urn: [64, 48, 32, 32, 'TilesetVillageAbandoned'],
  vBush: [64, 80, 16, 16, 'TilesetVillageAbandoned'], vBush2: [80, 80, 16, 16, 'TilesetVillageAbandoned'], vStump: [96, 128, 16, 16, 'TilesetVillageAbandoned'],
  ruinHut: [0, 0, 64, 48, 'TilesetVillageAbandoned'], ruinGrave: [128, 0, 48, 48, 'TilesetVillageAbandoned'], frogIdol: [144, 80, 32, 32, 'TilesetVillageAbandoned'],
};

export const THEMES = {
  spring: {
    ground: pal(['#5f9a34', '#6aa836', '#74a334', '#7fb23c']), accent: pal(['#8fbf45', '#9fc04a', '#adbc3a']), forestFloor: pal(['#2e5a2c', '#335f2e']),
    lane: pal(['#a3754e', '#9c6546', '#ad8058', '#b88b5f']), laneEdge: hex('#7d5a3c'), path: pal(['#8fb04a', '#97b752', '#86a843']), pathEdge: hex('#5f8a36'),
    water: pal(['#5fa9c4', '#79b8ce', '#6db3cc']), waterHi: hex('#a6e3ef'), deep: hex('#4a8fb0'), shore: hex('#e7d9a8'),
    base: [pal(['#7d8ea6', '#8394ab', '#7889a1']), pal(['#a88480', '#ad8985', '#a37f7b'])], pit: pal(['#6d6157', '#776a5f', '#827468']), shrine: pal(['#d9c27a', '#e6cf86', '#cbb46c']),
    trees: ['g0', 'pine', 'roots', 'g1', 'g0', 'pine', 'g1', 'pine', 'g0', 'pink'], big: ['tGreen', 'tPine', 'tG2', 'bigGreen', 'tGreen', 'tPine', 'tG2', 'bigPink'],
    rocks: ['rockGBig', 'rockTriG', 'rockGTall'], tall: ['grass1', 'grass2', 'grass3'], decor: ['flowerY', 'flowerO', 'clover', 'flowerR', 'flowerW', 'bush1', 'bush2', 'bush3', 'pebble', 'fernG', 'berry1', 'sprout', 'stumpS'],
    edge: ['berryBush', 'bush1', 'fernG', 'bush2', 'berry2'],
    sky: '#1b2a1a', fog: [10, 18, 30], wood: ['#9a6a3e', '#b07a48', '#875c35'],
  },
  winter: {
    ground: pal(['#e3eaf2', '#dbe4ee', '#eef3f8', '#d2dde9']), accent: pal(['#f7fafc', '#c9d6e4']), forestFloor: pal(['#9aaec2', '#a3b6c9']),
    lane: pal(['#b4bfcc', '#a9b5c3', '#bec8d4', '#a3afbd']), laneEdge: hex('#8794a5'), path: pal(['#c8d3df', '#cfd9e4']), pathEdge: hex('#aab8c8'),
    water: pal(['#a9dcef', '#b8e4f2', '#9fd4ea']), waterHi: hex('#e8f8fd'), deep: hex('#86c4dd'), shore: hex('#f2f6fa'),
    base: [pal(['#8a9bb4', '#93a3ba', '#8696ae']), pal(['#b0959a', '#b79ca1', '#aa8f94'])], pit: pal(['#7c8a99', '#8593a2', '#8e9cab']), shrine: pal(['#d6e6f2', '#e4eff7', '#c9dbe9']),
    trees: ['snowpine', 'snowpine2', 'white', 'snowpine', 'pine'], big: ['snowTri', 'snowTri2', 'tWhite', 'bigWhite', 'snowTri'],
    rocks: ['snowRock', 'blueRock', 'rockTriG'], tall: ['grass2', 'reed', 'grass3'], decor: ['pebbleS', 'pebble2', 'snowRock', 'bush3', 'snowMound', 'snowball', 'blueStone', 'spikes'],
    edge: ['snowMound', 'blueStone', 'snowball', 'bush3'],
    sky: '#1d2733', ice: true, fog: [20, 28, 48], wood: ['#7d6a5c', '#8e7a6a', '#6c5a4d'],
  },
  marsh: {
    ground: pal(['#3f6b4a', '#46744f', '#3a6345', '#4d7a53']), accent: pal(['#5f8f5e', '#6a9a62', '#557f55']), forestFloor: pal(['#1c3326', '#20392b']),
    lane: pal(['#6e6a7e', '#666276', '#777388', '#6a6679']), laneEdge: hex('#4b4858'), path: pal(['#4f7a55', '#57845b', '#4a724f']), pathEdge: hex('#355a3d'),
    water: pal(['#3d6f78', '#467a83', '#386770']), waterHi: hex('#8fd0c8'), deep: hex('#2c5560'), shore: hex('#7c8a6a'),
    base: [pal(['#6d7f9c', '#7486a2', '#687a96']), pal(['#9a7c86', '#a1838d', '#94767f'])], pit: pal(['#4e4a58', '#575262', '#605b6b']), shrine: pal(['#a9e0d2', '#b8eadc', '#98d2c4']),
    trees: ['roots', 'g1', 'dead', 'pine', 'g0', 'roots'], big: ['tG2', 'deadTri', 'tPine', 'tG2', 'bigGreen'],
    rocks: ['blueRock', 'rockGBig', 'rockGTall'], tall: ['reed', 'grass2', 'reed', 'grass3'], decor: ['clover', 'bush2', 'pebble2', 'flowerW', 'bush3', 'fernB', 'fernP', 'mossRock', 'sprout'],
    edge: ['fernB', 'fernP', 'mossRock', 'bush2', 'spikes'],
    sky: '#0e1620', fog: [6, 10, 22], night: true, lily: true, wood: ['#5e5448', '#6b6052', '#51483e'],
  },
  autumn: {
    ground: pal(['#b59a3c', '#c4a442', '#a88a34', '#bd9f44']), accent: pal(['#d7b456', '#cfae4f', '#e0bd5c']), forestFloor: pal(['#5e4128', '#664630']),
    lane: pal(['#a35a3a', '#9a5236', '#b0653f', '#a85e3c']), laneEdge: hex('#6e3a24'), path: pal(['#c79f58', '#cfa860', '#bf9752']), pathEdge: hex('#93723d'),
    water: pal(['#5e9a8f', '#6aa79a', '#589286']), waterHi: hex('#9fd1c3'), deep: hex('#4a7f74'), shore: hex('#d9b77a'),
    base: [pal(['#8a8f9e', '#9196a5', '#858a99']), pal(['#a9877a', '#b08e80', '#a48275'])], pit: pal(['#6e5546', '#785e4e', '#826756']), shrine: pal(['#e3b866', '#eec574', '#d6aa5a']),
    trees: ['yel', 'dead', 'yel', 'yel', 'dead'], big: ['tYel', 'bigOrange', 'deadTri', 'tYel', 'bigOrange', 'bigOrange'],
    rocks: ['rockBig', 'rockTri', 'rockTall'], tall: ['grass1', 'grass3', 'reed'], decor: ['pebble', 'pebble2', 'flowerO', 'bush2', 'stump', 'fernO', 'leafO', 'pumpkin', 'twig'],
    edge: ['oreRock', 'fernO', 'twig', 'pumpkin', 'leafO'],
    sky: '#2a1d14', fog: [26, 16, 10], wood: ['#8a5a36', '#9b6840', '#76492b'],
  },
  // Sunscar Oasis: sand dunes, clay roads, palms and sandstone houses (TilesetDesert)
  desert: {
    ground: pal(['#e0bf7a', '#d8b46c', '#e6c886', '#d0aa62']), accent: pal(['#efd596', '#c99f58', '#e9cf8c']), forestFloor: pal(['#9c6c40', '#a77548']),
    lane: pal(['#b6805a', '#ad7752', '#c08a62', '#a8714c']), laneEdge: hex('#7f5233'), path: pal(['#d4ae6c', '#dab676', '#ceaa66']), pathEdge: hex('#b08a52'),
    water: pal(['#45b4c6', '#57c0d0', '#4cb8c9']), waterHi: hex('#b4eef4'), deep: hex('#3394aa'), shore: hex('#f2e2ac'),
    base: [pal(['#8f9cb0', '#97a4b8', '#8a97ab']), pal(['#b8968a', '#bf9d90', '#b29084'])], pit: pal(['#a07a55', '#aa845e', '#b48e68']), shrine: pal(['#f2d98e', '#fbe39c', '#e6cc80']),
    trees: ['rockTall', 'dead', 'palm1', 'rockTall', 'palm2', 'dead', 'rockTall'], big: ['rockBig', 'palmG', 'rockTri', 'rockBig', 'palmG2'],
    rocks: ['dome', 'sandHouse', 'lion', 'rockBig'], rockScale: 1.5, tall: ['grass3', 'grass1', 'reed'], decor: ['shrubD', 'shrubD2', 'skull', 'bone', 'pebble', 'pebble2', 'twig'],
    edge: ['shrubD', 'shrubD2', 'pebble2', 'rockTall', 'bone'],
    sky: '#2b2114', fog: [34, 22, 10], dunes: true, wood: ['#9a6a3e', '#b07a48', '#875c35'],
  },
  // Mossgate Ruins: overgrown temple city, cobbled streets, moss trees, broken huts and statues (TilesetVillageAbandoned)
  ruins: {
    ground: pal(['#6f9a48', '#78a24e', '#678f43', '#7fa853']), accent: pal(['#9cbf5c', '#a8c766', '#8db34f']), forestFloor: pal(['#34452a', '#3a4b2e']),
    lane: pal(['#a39a86', '#998f7b', '#ada490', '#928875']), laneEdge: hex('#6c6556'), path: pal(['#8e9a68', '#96a270', '#869262']), pathEdge: hex('#69774a'),
    water: pal(['#4f9aa8', '#5ca6b3', '#4892a0']), waterHi: hex('#a8e0e6'), deep: hex('#3b7f8e'), shore: hex('#b9b19b'),
    base: [pal(['#7d8ea6', '#8394ab', '#7889a1']), pal(['#a88480', '#ad8985', '#a37f7b'])], pit: pal(['#7a7262', '#847c6b', '#8e8674']), shrine: pal(['#e6d49a', '#f0dea6', '#d8c68c']),
    trees: ['mossBush', 'g1', 'mossBush2', 'roots', 'pine', 'g0'], big: ['mossTree', 'tG2', 'mossTree2', 'tGreen', 'statue'],
    rocks: ['ruinHut', 'ruinGrave', 'pillar', 'frogIdol', 'statue'], rockScale: 1.5, tall: ['grass1', 'grass2', 'grass3'], decor: ['vBush', 'vBush2', 'vStump', 'stoneBits', 'clover', 'flowerW', 'mossRock', 'fernG'],
    edge: ['vBush', 'vBush2', 'urn', 'fernG', 'stoneBits'],
    sky: '#18200f', fog: [10, 16, 8], cobble: true, wood: ['#7d6a4c', '#8e7a58', '#6c5a40'],
  },
  // Tidebreak Harbor: a pine coast around a deep sea channel, sand flats that flood, boardwalk lanes (src/sim/terrain.js)
  coast: {
    ground: pal(['#79a54a', '#84ae52', '#6f9a45', '#8bb65a']), accent: pal(['#a1c262', '#aec86c', '#95b65a']), forestFloor: pal(['#2c4a38', '#31503d']),
    lane: pal(['#a59d8b', '#9b9381', '#afa795', '#958d7b']), laneEdge: hex('#6f6858'), path: pal(['#b3bf78', '#bac682', '#a8b670']), pathEdge: hex('#7c8c4c'),
    water: pal(['#4fb4c9', '#5fc0d3', '#56bacd']), waterHi: hex('#c4f3f7'), deep: hex('#3797b4'), shore: hex('#f1e3b8'), beach: 1,
    sea: pal(['#1f6493', '#226a99', '#1c5d8b']), seaHi: hex('#5fa8cf'), sand: pal(['#e9d7a6', '#e2cf9b', '#efddb0']), wetSand: hex('#c9b685'),
    base: [pal(['#7d8ea6', '#8394ab', '#7889a1']), pal(['#a88480', '#ad8985', '#a37f7b'])], pit: pal(['#6f6a62', '#79736a', '#837d73']), shrine: pal(['#e8d79c', '#f2e1a8', '#dccb90']),
    trees: ['pine', 'roots', 'pine', 'g1', 'pine', 'palm1', 'pine', 'palm2'], big: ['tPine', 'palmG', 'tPine', 'palmG2', 'tPine', 'tG2'],
    rocks: ['rockBig', 'rockTall', 'rockTri', 'blueRock'], tall: ['grass1', 'grass2', 'reed'], decor: ['pebble', 'pebble2', 'bush2', 'fernB', 'clover', 'flowerW', 'sprout', 'shrubD', 'pebbleS'],
    edge: ['bush2', 'fernB', 'pebble2', 'mossRock', 'shrubD2'],
    sky: '#13263a', fog: [8, 18, 30], cobble: true, wood: ['#8c6a46', '#a07a50', '#76583a'],
  },
  // Skyreach Isles: grass islands over an open sky (non-walkable ground is the void, not forest), cloud river, blossom groves
  sky: {
    ground: pal(['#8cc767', '#96cf71', '#83bf60', '#a0d57a']), accent: pal(['#b6e18a', '#c3e797', '#abd983']), forestFloor: pal(['#6f9fd8', '#77a6dc']),
    lane: pal(['#c7c2d4', '#bdb8cb', '#d0cbdd', '#b5b0c4']), laneEdge: hex('#8b86a0'), path: pal(['#a7d688', '#b0dc90', '#9ed080']), pathEdge: hex('#7db565'),
    water: pal(['#e4f0ff', '#f0f7ff', '#d9e8fd']), waterHi: hex('#ffffff'), deep: hex('#c4d8f2'), shore: hex('#f6faff'),
    base: [pal(['#8a9cc0', '#91a3c6', '#8697ba']), pal(['#c09aa4', '#c6a1aa', '#b9939d'])], pit: pal(['#9ea6c4', '#a7afcc', '#b0b8d4']), shrine: pal(['#f3e5a8', '#fbedb6', '#e7d89b']),
    trees: ['pink', 'g0', 'white', 'pink'], big: ['tPink', 'tWhite', 'bigPink', 'bigWhite'],
    rocks: ['tPink', 'bigPink', 'tWhite', 'bigWhite'], rockScale: 1.5, tall: ['grass1', 'grass2', 'grass3'], decor: ['flowerW', 'flowerY', 'clover', 'flowerR', 'bush1', 'sprout', 'pebbleS'],
    edge: ['flowerW', 'clover', 'bush1', 'berryBush', 'flowerY', 'bush3'],
    sky: '#6f9fd8', fog: [30, 50, 90], void: true, cliff: pal(['#9b8a78', '#8a7969', '#7a6a5c', '#6a5b4f']), wood: ['#9a7a5a', '#b08a64', '#866a4c'],
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
    const i = cy * N + cx; // breakable walls and tide crossings: ground under them (drawn live); deep water is painted as sea
    return world.walk[i] || (world.wallAt && world.wallAt[i] >= 0) || (world.gateAt && world.gateAt[i] >= 0) || world.type[i] === T_DEEP ? world.type[i] : T_FOREST;
  };
  const b0 = world.baseCenter[0], b1 = world.baseCenter[1];
  // Bridges: lane cells that cross a (liquid) river get wooden planks laid along the river's flow.
  // Frozen maps keep the packed-snow lane across the ice.
  const bridge = new Float32Array(N * N).fill(NaN), rv = th.ice ? [] : world.river || [], rw = world.def.riverW || 60;
  for (let cy = 0; cy < N; cy++) for (let cx = 0; cx < N; cx++) {
    const i = cy * N + cx; if (world.type[i] !== T_LANE) continue;
    const px = cx * C + C / 2, py = cy * C + C / 2;
    for (let k = 1; k < rv.length; k++) {
      const a = rv[k - 1], b = rv[k], dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / l2)), ex = a.x + dx * t - px, ey = a.y + dy * t - py;
      if (ex * ex + ey * ey <= (rw + 30) ** 2) { bridge[i] = Math.atan2(dy, dx); break; }
    }
  }
  // exact (per pixel) depth into the river: > 0 on the planks, < 0 off them
  const waterDepth = (px, py) => {
    let best = 1e9;
    for (let k = 1; k < rv.length; k++) {
      const a = rv[k - 1], b = rv[k], dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / l2)), ex = a.x + dx * t - px, ey = a.y + dy * t - py;
      best = Math.min(best, ex * ex + ey * ey);
    }
    return rw - Math.sqrt(best);
  };
  const bridgeAt = (x, y) => {
    const cx = Math.floor(x / C), cy = Math.floor(y / C); if (cx < 0 || cy < 0 || cx >= N || cy >= N) return NaN;
    const a = bridge[cy * N + cx]; return a === a && waterDepth(x, y) > -2 ? a : NaN;
  };
  const wood = (th.wood || ['#9a6a3e', '#b07a48', '#875c35']).map(hex);
  // tide maps: the deep water's exact capsules (the grid's T_DEEP cells, but with smooth round shores) and the beach band
  const caps = [];
  for (const q of world.def.deep || []) for (const m of [0, 1]) { const f = (v) => (m ? S - v : v); caps.push([f(q[0]), f(q[1]), f(q[2]), f(q[3]), q[4]]); }
  const seaCol = (px, py, dn, nz, j) => {
    let c = th.sea ? th.sea[Math.floor(nz * 3) % 3] : th.deep;
    const crest = Math.sin((px + py * 0.6) / 13 + n2(px / 50, py / 50) * 6);
    if (crest > 0.93 && j < 0.7) c = th.seaHi || th.waterHi; else if (crest < -0.9) c = mul(c, 0.9);
    if (dn < 7 && j < 0.45) c = th.waterHi; // foam on the drop-off
    return c;
  };
  const deepness = (px, py) => {
    let best = -1e9;
    for (const [ax, ay, bx, by, r] of caps) { const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)), ex = ax + dx * t - px, ey = ay + dy * t - py; best = Math.max(best, r - Math.sqrt(ex * ex + ey * ey)); }
    return best;
  };
  const mul = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
  for (let y = 0; y < Wd; y++) for (let x = 0; x < Wd; x++) {
    const px = x * HALF + 1, py = y * HALF + 1;
    const jx = (n2(px / 22, py / 22) - 0.5) * 26, jy = (n1(px / 22 + 9, py / 22) - 0.5) * 26;
    const t = typeAt(px + jx, py + jy);
    const tc = typeAt(px, py);
    const nz = n1(px / 90, py / 90) * 0.6 + n2(px / 25, py / 25) * 0.4;
    const j = rng.next();
    let col, onBridge = false;
    switch (t) {
      case T_LANE: {
        const edge = typeAt(px + 14, py) !== T_LANE || typeAt(px - 14, py) !== T_LANE || typeAt(px, py + 14) !== T_LANE || typeAt(px, py - 14) !== T_LANE;
        const ang = bridgeAt(px, py);
        if (ang === ang) {
          onBridge = true; // bridge planks: boards across the lane, dark seams, rails on the edges
          const along = px * Math.cos(ang) + py * Math.sin(ang), across = -px * Math.sin(ang) + py * Math.cos(ang);
          const board = Math.floor(across / 10), seam = ((across % 10) + 10) % 10 < 2;
          const endBeam = waterDepth(px, py) < 4;
          col = edge ? mul(wood[2], 0.7) : endBeam ? mul(wood[2], 0.62) : seam ? mul(wood[2], 0.75) : wood[(board * 7 + Math.floor(along / 40 + board * 0.5)) & 1 ? 0 : 1];
          if (!edge && !seam && j < 0.05) col = mul(col, 0.88);
          break;
        }
        // worn centre: lighter where the lane is wide open around this point; pebbles here and there
        const centre = !edge && typeAt(px + 30, py) === T_LANE && typeAt(px - 30, py) === T_LANE && typeAt(px, py + 30) === T_LANE && typeAt(px, py - 30) === T_LANE;
        col = edge && j < 0.7 ? th.laneEdge : th.lane[Math.floor(nz * 3 + j * 0.9) % th.lane.length];
        if (centre) col = mul(col, 1.06);
        if (th.cobble && !edge) { const tx = Math.floor(px / 18), oy = (tx & 1) * 9; if (px % 18 < 2 || (py + oy) % 18 < 2) col = mul(col, 0.8); else col = mul(col, 0.96 + ((tx * 5 + Math.floor((py + oy) / 18) * 3) % 4) * 0.025); }
        if (!edge && j > 0.992) col = mul(col, 1.22); else if (!edge && j < 0.006) col = mul(col, 0.78);
        break;
      }
      case T_PATH: col = th.path[Math.floor(nz * 3 + j * 0.6) % th.path.length]; if (j < 0.03) col = th.pathEdge; break;
      case T_RIVER: {
        if (caps.length && deepness(px, py) > 0) { col = seaCol(px, py, deepness(px, py), nz, j); break; } // smooth deep shores
        const dry = (q) => q !== T_RIVER && q !== T_DEEP; // (the sea channel's deep middle is water too)
        const shoreNear = dry(typeAt(px + 16, py)) || dry(typeAt(px - 16, py)) || dry(typeAt(px, py + 16)) || dry(typeAt(px, py - 16));
        col = shoreNear ? (j < 0.8 ? th.shore : th.water[0]) : (n3(px / 14 + py / 50, py / 14) > 0.8 && j < 0.6 ? th.waterHi : th.water[Math.floor(nz * 3) % 3]);
        if (!shoreNear && j < 0.08) col = th.deep;
        if (th.ice && !shoreNear && ((px * 7 + py * 3) % 97 < 2)) col = th.deep;
        if (!shoreNear) {
          // foam just off the shore, deeper colour toward the middle
          const near2 = dry(typeAt(px + 26, py)) || dry(typeAt(px - 26, py)) || dry(typeAt(px, py + 26)) || dry(typeAt(px, py - 26));
          if (near2) { if (j < 0.35) col = th.waterHi; }
          else if (typeAt(px + 44, py) === T_RIVER && typeAt(px - 44, py) === T_RIVER && typeAt(px, py + 44) === T_RIVER && typeAt(px, py - 44) === T_RIVER) col = mul(col, 0.92);
        }
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
      case T_FOREST: col = th.void ? voidCol(px, py) : th.forestFloor[j < 0.5 ? 0 : 1]; break;
      case T_DEEP: {
        // the open sea: deep blue, long wave crests, foam where it meets the shallows (exact round shores)
        const dn = deepness(px, py);
        if (dn < 0) { col = th.water[Math.floor(nz * 3) % 3]; if (dn > -6 && j < 0.5) col = th.waterHi; break; }
        col = seaCol(px, py, dn, nz, j);
        break;
      }
      case T_SAND: {
        // tidal flats: pale sand with ripples, darker (wet) toward the water
        const wet = typeAt(px + 30, py) === T_RIVER || typeAt(px - 30, py) === T_RIVER || typeAt(px, py + 30) === T_RIVER || typeAt(px, py - 30) === T_RIVER || typeAt(px, py + 30) === T_DEEP || typeAt(px, py - 30) === T_DEEP;
        col = (th.sand || th.ground)[Math.floor(nz * 3 + j * 0.5) % 3];
        if (Math.sin((px * 0.8 + py) / 7 + n1(px / 40, py / 40) * 5) > 0.82) col = mul(col, 0.93);
        if (wet) col = mul(th.wetSand || col, 1 + (j - 0.5) * 0.05);
        if (j > 0.993) col = th.waterHi; // a shell
        break;
      }
      default: {
        const gi = Math.min(th.ground.length - 1, Math.floor(nz * th.ground.length));
        col = th.ground[gi];
        if (th.beach && t === T_GRASS && waterDepth(px, py) > -34 + n2(px / 30, py / 30) * 14) { col = th.sand[Math.floor(nz * 3 + j * 0.5) % 3]; if (j > 0.994) col = th.waterHi; break; }
        if (n3(px / 40, py / 40) > 0.72 && j < 0.5) col = th.accent[Math.floor(j * 6) % th.accent.length];
        if (th.dunes) { const r = Math.sin((px * 0.55 + py) / 15 + n2(px / 60, py / 60) * 7); if (r > 0.9) col = mul(col, 0.9); else if (r < -0.96) col = mul(col, 1.05); }
      }
    }
    if (world.brush[world.idx(px, py)] && tc !== T_FOREST) col = col.map((v) => v * 0.8);
    // floating islands: a rock cliff hangs under every south edge, fading into the sky below
    if (th.void && t === T_FOREST) {
      const depth = 26 + n2(px / 34, 3.7) * 46;
      for (let k = 4; k <= depth; k += 6) if (typeAt(px, py - k) !== T_FOREST) {
        const band = th.cliff[Math.min(th.cliff.length - 1, Math.floor((py - k + n1(px / 9, py / 9) * 10) / 9) % 2 + Math.floor(k / depth * 2.5))];
        const f = k / depth; col = band.map((v, q) => v * (1 - f * 0.55) + col[q] * f * 0.55);
        if (k <= 6) col = mul(col, 1.18); // the rim catches the light
        break;
      }
    }
    // soft shade on open ground just south of the forest (canopy shadow), for depth
    if (!th.void && t !== T_FOREST && t !== T_RIVER && t !== T_DEEP && !(t === T_LANE && onBridge)) {
      if (typeAt(px, py - 16) === T_FOREST) col = mul(col, 0.8); else if (typeAt(px, py - 30) === T_FOREST) col = mul(col, 0.9);
    }
    if (t === T_GRASS && j > 0.985) col = mul(col, 1.14); // grass glints
    const i = (y * Wd + x) * 4; a[i] = col[0]; a[i + 1] = col[1]; a[i + 2] = col[2]; a[i + 3] = 255;
  }
  sctx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(small, 0, 0, S, S);

  const nat = IMG.TilesetNature; if (!nat) return canvas;
  const items = [];
  const open = (x, y) => world.isWalk(x, y) || !!(world.wallAt && world.wallAt[world.idx(x, y)] >= 0);
  for (let cy = 0; cy < N; cy++) for (let cx = 0; cx < N; cx++) {
    const i = cy * N + cx; if (th.void || world.walk[i] || (world.wallAt && world.wallAt[i] >= 0) || (world.gateAt && world.gateAt[i] >= 0) || world.type[i] === T_DEEP) continue;
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
    for (let k = 0; k < n; k++) items.push({ x: r.x + (k ? rng.range(-r.r * 0.5, r.r * 0.5) : 0), y: r.y + (k ? rng.range(-r.r * 0.5, r.r * 0.5) : 0), key: th.rocks[rng.int(th.rocks.length)], s: th.rockScale || 2 });
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
  // forest-edge undergrowth: ferns, berry bushes, stones where open grass meets the trees
  if (th.edge) for (let cy = 1; cy < N - 1; cy++) for (let cx = 1; cx < N - 1; cx++) {
    const i = cy * N + cx; if (!world.walk[i] || world.type[i] !== T_GRASS || world.brush[i]) continue;
    if (world.walk[i - 1] && world.walk[i + 1] && world.walk[i - N] && world.walk[i + N]) continue;
    if (rng.next() > 0.22) continue;
    const key = th.edge[rng.int(th.edge.length)], big = SPR[key][2] > 16;
    items.push({ x: cx * C + rng.range(4, 20), y: cy * C + rng.range(6, 22), key, s: big ? 1.4 : 1.8, decor: !big });
  }
  // marsh lily pads (code-drawn, under everything else)
  if (th.lily) for (let cy = 1; cy < N - 1; cy++) for (let cx = 1; cx < N - 1; cx++) {
    const i = cy * N + cx; if (world.type[i] !== T_RIVER || world.type[i - 1] !== T_RIVER || world.type[i + 1] !== T_RIVER || world.type[i - N] !== T_RIVER || world.type[i + N] !== T_RIVER || rng.next() > 0.12) continue;
    const x = cx * C + rng.range(4, 20), y = cy * C + rng.range(4, 20), r = rng.range(5, 9), a = rng.range(0, 6.28);
    ctx.fillStyle = 'rgba(10,30,30,0.35)'; ctx.beginPath(); ctx.ellipse(x + 1, y + 2, r, r * 0.7, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#4f8f4a'; ctx.beginPath(); ctx.moveTo(x, y); ctx.ellipse(x, y, r, r * 0.7, 0, a + 0.5, a + 6.0); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#6fb35f'; ctx.fillRect(Math.round(x - r * 0.5), Math.round(y - r * 0.3), 3, 2);
    if (rng.next() < 0.25) { ctx.fillStyle = '#f2a9d0'; ctx.fillRect(Math.round(x - 1), Math.round(y - 2), 3, 3); ctx.fillStyle = '#fff'; ctx.fillRect(Math.round(x), Math.round(y - 1), 1, 1); }
  }
  // bridge posts along both rails
  for (let cy = 1; cy < N - 1; cy++) for (let cx = 1; cx < N - 1; cx++) {
    const i = cy * N + cx; if (bridge[i] !== bridge[i]) continue;
    const nb = [i - 1, i + 1, i - N, i + N].find((q) => world.type[q] !== T_LANE); if (nb === undefined || (cx + cy) % 2) continue;
    const x = cx * C + C / 2 + (nb === i - 1 ? -10 : nb === i + 1 ? 10 : 0), y = cy * C + C / 2 + (nb === i - N ? -10 : nb === i + N ? 10 : 0);
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(Math.round(x) - 3, Math.round(y) + 2, 7, 3);
    ctx.fillStyle = (th.wood || ['#9a6a3e', '#b07a48', '#875c35'])[2]; ctx.fillRect(Math.round(x) - 3, Math.round(y) - 10, 6, 13);
    ctx.fillStyle = (th.wood || ['#9a6a3e', '#b07a48', '#875c35'])[1]; ctx.fillRect(Math.round(x) - 2, Math.round(y) - 10, 2, 11);
  }
  items.sort((u, v) => u.y - v.y);
  for (const it of items) {
    const [sx, sy, sw, sh, sheet] = SPR[it.key], img = sheet ? IMG[sheet] : nat;
    if (!img) continue;
    const w = sw * it.s, h = sh * it.s;
    if (!it.decor) { ctx.fillStyle = 'rgba(10,20,10,0.22)'; ctx.beginPath(); ctx.ellipse(it.x, it.y + h * 0.3, w * 0.4, h * 0.13, 0, 0, Math.PI * 2); ctx.fill(); }
    ctx.drawImage(img, sx, sy, sw, sh, Math.round(it.x - w / 2), Math.round(it.y - h * 0.62), w, h);
  }
  const tw = IMG.TilesetTowers;
  if (tw) for (let t = 0; t < 2; t++) {
    const f = world.fountain[t];
    const g = ctx.createRadialGradient(f.x, f.y, 10, f.x, f.y, 150);
    g.addColorStop(0, t === 0 ? 'rgba(90,170,255,0.55)' : 'rgba(255,100,100,0.55)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(f.x, f.y, 150, 0, Math.PI * 2); ctx.fill();
    ctx.drawImage(tw, 192, 64, 32, 32, f.x - 40, f.y - 52, 80, 80);
  }
  if (th.night) paintNight(ctx, world, canvas.width);
  if (th.void) paintIslets(ctx, world, th);
  return canvas;
}
// The open sky under the islands: a soft vertical gradient with drifting cloud banks (pixel noise, painted once).
const SKY_TOP = hex('#9ccdf5'), SKY_BOT = hex('#5d92d8'), CLOUD = hex('#f4f9ff');
const skyN1 = makeNoise(31), skyN2 = makeNoise(77);
function voidCol(px, py) {
  const k = py / S, c = SKY_TOP.map((v, i) => v + (SKY_BOT[i] - v) * k);
  const n = skyN1(px / 160, py / 90) * 0.65 + skyN2(px / 45, py / 30) * 0.35;
  const m = Math.max(0, Math.min(1, (n - 0.55) / 0.2));
  return m > 0 ? c.map((v, i) => v + (CLOUD[i] - v) * m * 0.85) : c;
}
// Little islets floating in the void (decor only, away from the real ground): a grass cap, a rock cone, the odd tree.
function paintIslets(ctx, world, th) {
  const r = new Rng(0x5c1e5), nat = IMG.TilesetNature;
  const clearOf = (x, y, d) => { for (let a = 0; a < 8; a++) if (world.isWalk(x + Math.cos(a * 0.785) * d, y + Math.sin(a * 0.785) * d)) return false; return !world.isWalk(x, y); };
  for (let n = 0, tries = 0; n < 34 && tries < 900; tries++) {
    const x = r.range(60, S - 60), y = r.range(60, S - 60), w = r.range(16, 40);
    if (!clearOf(x, y, w + 50)) continue;
    n++;
    const h = w * r.range(0.9, 1.5);
    ctx.fillStyle = 'rgba(40,70,120,0.18)'; ctx.beginPath(); ctx.ellipse(x + 6, y + h + 18, w * 0.8, w * 0.22, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#7a6a5c'; ctx.beginPath(); ctx.moveTo(x - w, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w * 0.2, y + h); ctx.lineTo(x - w * 0.15, y + h * 0.8); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#9b8a78'; ctx.beginPath(); ctx.moveTo(x - w, y); ctx.lineTo(x + w * 0.1, y); ctx.lineTo(x - w * 0.15, y + h * 0.8); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#86bf62'; ctx.beginPath(); ctx.ellipse(x, y, w, w * 0.36, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#a3d47c'; ctx.beginPath(); ctx.ellipse(x - w * 0.2, y - w * 0.08, w * 0.6, w * 0.2, 0, 0, Math.PI * 2); ctx.fill();
    if (nat && w > 26 && r.next() < 0.6) { const sp = SPR[th.trees[r.int(th.trees.length)]]; ctx.drawImage(nat, sp[0], sp[1], sp[2], sp[3], Math.round(x - 24 + r.range(-6, 6)), Math.round(y - 52), 48, 48); }
  }
}
// Night maps: cool moonlight tint, soft glow pools at shrines/pits/bases, and scattered glowing moss.
function paintNight(ctx, world, S) {
  ctx.save();
  ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = 'rgb(120,140,200)'; ctx.fillRect(0, 0, S, S);
  ctx.globalCompositeOperation = 'lighter';
  const glow = (x, y, r, col) => { const g = ctx.createRadialGradient(x, y, 4, x, y, r); g.addColorStop(0, col); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); };
  for (const sh of world.shrines) glow(sh.x, sh.y, 170, 'rgba(90,200,180,0.35)');
  glow(world.pits.kami.x, world.pits.kami.y, 200, 'rgba(120,110,220,0.28)'); glow(world.pits.kraken.x, world.pits.kraken.y, 200, 'rgba(120,110,220,0.28)');
  for (const f of world.fountain) glow(f.x, f.y, 260, 'rgba(120,150,220,0.25)');
  const r = new Rng(0x700d);
  for (let i = 0; i < 420; i++) { const x = r.next() * S, y = r.next() * S; if (!world.isWalk(x, y)) continue; glow(x, y, 6 + r.next() * 10, r.next() < 0.5 ? 'rgba(150,255,190,0.45)' : 'rgba(255,240,150,0.35)'); }
  ctx.restore();
}
