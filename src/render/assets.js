// Image loading + small pixel utilities (hue shifting for team/element variants).
import { HEROES } from '../data/heroes.js';

const BASE = 'assets/img/';
export const IMG = {};

// Sprite sheet metadata: horizontal strips of `frames` frames.
export const FX = {
  explosion: { frames: 9 }, flame: { frames: 8 }, thunder: { frames: 8 }, ice: { frames: 10 }, rockspike: { frames: 10 },
  water: { frames: 11 }, plant: { frames: 8 }, spark: { frames: 9 }, circle: { frames: 4 }, circle_orange: { frames: 4 },
  shield: { frames: 6 }, shield_yellow: { frames: 6 }, aura: { frames: 5 }, boost: { frames: 8 }, spirit: { frames: 5 },
  smoke: { frames: 6 }, smoke_ring: { frames: 8 }, cut: { frames: 4 }, claw: { frames: 4 }, circular: { frames: 4 },
  slash: { frames: 4 }, cutx: { frames: 4 }, impact: { frames: 4, img: 'circular' }, rock: { frames: 10, img: 'rockspike' },
  // v21 variants (render-only remaps per hero, see vfx.js)
  pillar: { frames: 6 }, crystal: { frames: 9 }, leafspike: { frames: 7 }, holy: { frames: 6 }, ringw: { frames: 4 },
  spirit_blue: { frames: 5 }, spirit_double: { frames: 5 }, wave: { frames: 6 }, slash_curved: { frames: 4 }, claw_double: { frames: 4 },
  slash_double: { frames: 4 }, cut_double: { frames: 5 }, arc: { frames: 6 }, multi: { frames: 9 }, crescent: { frames: 4 },
};
export const PROJ = {
  p_fireball: { frames: 4, round: true }, p_energy: { frames: 4, round: true }, p_shuriken: { frames: 2, round: true },
  p_cannon: { frames: 5, round: true }, p_bigenergy: { frames: 4, round: true }, p_plant: { frames: 4 }, p_icespike: { frames: 6 },
  p_arrow: { frames: 1 }, p_kunai: { frames: 1 }, p_bigkunai: { frames: 1 },
  p_bigshuriken: { frames: 2, round: true }, p_magicstar: { frames: 2, round: true }, p_rock: { frames: 4, round: true },
};
// Ambient atlas rows (fx/ambient.png): [y, frame w, frame h, frames]
export const AMB = { parrot_b: [0, 16, 16, 2], parrot_r: [16, 16, 16, 2], frog: [32, 16, 16, 2], fish: [48, 16, 16, 2], leaf: [64, 12, 7, 6], leafpink: [71, 12, 7, 6],
  snow: [78, 8, 8, 7], flag_b: [86, 16, 16, 4], flag_r: [102, 16, 16, 4], flower: [118, 16, 16, 4] };
const UNITS = ['minion_blue_melee', 'minion_blue_caster', 'minion_blue_siege', 'minion_red_melee', 'minion_red_caster', 'minion_red_siege',
  'camp_bluebuff', 'camp_redbuff', 'camp_wolf', 'camp_raptor', 'camp_gromp', 'camp_krug'];
const BOSS = ['dragon_green_body1', 'dragon_green_body2', 'dragon_green_bodyend', 'dragon_green_head', 'dragon_green_wing',
  'dragon_blue_body1', 'dragon_blue_body2', 'dragon_blue_bodyend', 'dragon_blue_head', 'dragon_blue_wing',
  'herald_idle', 'herald_walk', 'herald_hit', 'herald_faceset', 'baron_idle', 'baron_attack', 'baron_hit', 'baron_faceset',
  'kami_infernal', 'kami_ocean', 'kami_mountain', 'kami_cloud', 'kami_elder'];
const TILES = ['TilesetTowers', 'TilesetNature', 'TilesetFloor', 'TilesetWater', 'TilesetFloorDetail'];

function load(key, src) {
  return new Promise((res) => {
    const im = new Image();
    im.onload = () => { IMG[key] = im; res(); };
    im.onerror = () => { console.warn('missing', src); res(); };
    im.src = src;
  });
}

// Two phases for a fast first paint: the menu needs only the map tiles (painted background) and the hero
// sheets (Dojo, parade, draft). Everything the match renderer needs loads in the background; startMatch
// waits on `assetsAll` if a player is quicker than the network.
export let assetsDone = false;
export let assetsAll = null;
export async function loadAssets(onProgress, early = false) {
  const crit = [], rest = [];
  for (const t of TILES) crit.push([t, `${BASE}tiles/${t}.png`]);
  for (const h of HEROES) { crit.push(['hero_' + h.id, `${BASE}heroes/${h.id}.png`]); rest.push(['face_' + h.id, `${BASE}faces/${h.id}.png`]); }
  for (const u of UNITS) rest.push([u, `${BASE}units/${u}.png`]);
  for (const b of BOSS) rest.push([b, `${BASE}boss/${b}.png`]);
  for (const f of new Set(Object.keys(FX).map((k) => FX[k].img || k))) rest.push(['fx_' + f, `${BASE}fx/${f}.png`]);
  for (const p of Object.keys(PROJ)) rest.push(['fx_' + p, `${BASE}fx/${p}.png`]);
  for (const t of ['TilesetDesert', 'TilesetVillageAbandoned']) rest.push([t, `${BASE}tiles/${t}.png`]); // Sunscar Oasis / Mossgate Ruins decor
  rest.push(['shadow', `${BASE}fx/shadow.png`]);
  rest.push(['ambient', `${BASE}fx/ambient.png`]);
  for (const e of ['ok', 'think', 'doubt', 'up', 'down', 'tilt']) rest.push(['emote_' + e, `${BASE}emote/${e}.png`]);
  let done = 0;
  await Promise.all(crit.map(([k, s]) => load(k, s).then(() => { done++; onProgress && onProgress(done / crit.length); })));
  assetsAll = assetsAll || Promise.all(rest.map(([k, s]) => load(k, s))).then(() => { buildVariants(); assetsDone = true; });
  if (!early) await assetsAll;
}

// ── pixel helpers ──
function rgb2hsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b); let h = 0, s = 0; const l = (mx + mn) / 2;
  if (mx !== mn) { const d = mx - mn; s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h /= 6; }
  return [h, s, l];
}
function hsl2rgb(h, s, l) {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const f = (p, q, t) => { if (t < 0) t += 1; if (t > 1) t -= 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p; };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  return [f(p, q, h + 1 / 3) * 255, f(p, q, h) * 255, f(p, q, h - 1 / 3) * 255];
}
export function recolor(img, { hue = 0, sat = 1, light = 0 } = {}) {
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const x = c.getContext('2d'); x.drawImage(img, 0, 0);
  const d = x.getImageData(0, 0, c.width, c.height), a = d.data;
  for (let i = 0; i < a.length; i += 4) {
    if (!a[i + 3]) continue;
    let [h, s, l] = rgb2hsl(a[i], a[i + 1], a[i + 2]);
    h = (h + hue / 360 + 1) % 1; s = Math.min(1, s * sat); l = Math.max(0, Math.min(1, l + light));
    const [r, g, b] = hsl2rgb(h, s, l); a[i] = r; a[i + 1] = g; a[i + 2] = b;
  }
  x.putImageData(d, 0, 0);
  return c;
}
export function silhouette(img, color) {
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const x = c.getContext('2d'); x.drawImage(img, 0, 0); x.globalCompositeOperation = 'source-in'; x.fillStyle = color; x.fillRect(0, 0, c.width, c.height);
  return c;
}

export const VAR = {};
function buildVariants() {
  // Dragon element skins (green base).
  const parts = ['body1', 'body2', 'bodyend', 'head', 'wing'];
  const skins = { infernal: { base: 'green', hue: -72, sat: 1.25 }, ocean: { base: 'blue' }, mountain: { base: 'green', hue: -60, sat: 0.55, light: -0.05 },
    cloud: { base: 'blue', hue: 0, sat: 0.25, light: 0.18 }, elder: { base: 'blue', hue: 60, sat: 0.9, light: 0.05 } };
  for (const [el, s] of Object.entries(skins)) {
    VAR['dragon_' + el] = {};
    for (const p of parts) {
      const src = IMG[`dragon_${s.base}_${p}`]; if (!src) continue;
      VAR['dragon_' + el][p] = s.hue || s.sat || s.light ? recolor(src, s) : src;
    }
  }
  // Nexus crystal per team (from the green crystal tile)
  const tw = IMG.TilesetTowers;
  if (tw) {
    const crop = (sx, sy) => { const c = document.createElement('canvas'); c.width = 32; c.height = 32; c.getContext('2d').drawImage(tw, sx, sy, 32, 32, 0, 0, 32, 32); return c; };
    VAR.crystal = [0, 1, 2].map((i) => [recolor(crop(288 + i * 32, 64), { hue: 120, sat: 1.1 }), recolor(crop(288 + i * 32, 64), { hue: -75, sat: 1.2 })]);
    VAR.crystalNeutral = recolor(crop(288, 64), { hue: -30, sat: 0.35, light: 0.12 });
  }
  // White flash silhouettes for hit feedback are generated lazily.
}
export function flashOf(key, img) {
  const k = 'flash_' + key;
  if (!VAR[k]) VAR[k] = silhouette(img, '#ffffff');
  return VAR[k];
}
