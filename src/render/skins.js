// Hero skin art, built once per (hero, skin) and cached: sprite sheets for the match renderer and the menus,
// and portraits (faces) for the HUD, results, Dojo and Collection. Render only: frame size and layout are
// the hero sheet's own (4 facings x 7 rows of 16px), so hitboxes, animation timing and effects never change.
import { IMG, recolor } from './assets.js';
import { SKINS } from '../data/seasons.js';
import { THEMES, SKIN_BODIES } from '../data/skins.js';

const FW = 16;
const cache = {}, faceCache = {}, urlCache = {};
const hex = (c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];

// A skin key is valid for a hero when it exists and is either account-wide or that hero's own.
export function skinFor(heroId, key) {
  const s = key && SKINS[key];
  return s && (!s.hero || s.hero === heroId) ? s : null;
}

// Legendary skins need their pack body loaded first.
export const skinReady = (key) => { const s = SKINS[key]; return !s || !s.body || !!IMG['skin_' + s.body]; };
// Loads the alternate pack bodies (Legendary skins). Safe to call often.
let bodiesP = null;
export function loadSkinBodies() {
  if (bodiesP) return bodiesP;
  const one = (k, src) => new Promise((res) => { if (IMG[k]) { res(); return; } const im = new Image(); im.onload = () => { IMG[k] = im; res(); }; im.onerror = () => res(); im.src = src; });
  bodiesP = Promise.all(SKIN_BODIES.flatMap((b) => [one('skin_' + b, `assets/img/skins/${b}.png`), one('skinface_' + b, `assets/img/skins/${b}_face.png`)]));
  return bodiesP;
}

// ── pixel work ──
function toCanvas(img, w = img.width, h = img.height) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d'); x.imageSmoothingEnabled = false; x.drawImage(img, 0, 0, w, h);
  return c;
}
function hsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2; let hh = 0, s = 0;
  if (mx !== mn) { const d = mx - mn; s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn); hh = (mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4) / 6; }
  return [hh, s, l];
}
// Human skin tones keep their colour so faces stay faces under a theme.
const isSkin = (r, g, b) => { const [hh, s, l] = hsl(r, g, b); return hh > 0.025 && hh < 0.115 && s > 0.22 && s < 0.78 && l > 0.56 && l < 0.9; };
// Gradient map: luminance (stretched over the sprite's own range) → the theme ramp. Outlines go to the ramp's darkest stop.
function gradientMap(c, theme) {
  const x = c.getContext('2d'), d = x.getImageData(0, 0, c.width, c.height), a = d.data, ramp = theme.ramp.map(hex);
  let lo = 1, hi = 0;
  const lum = (i) => (0.299 * a[i] + 0.587 * a[i + 1] + 0.114 * a[i + 2]) / 255;
  for (let i = 0; i < a.length; i += 4) if (a[i + 3] > 100) { const L = lum(i); if (L > 0.13) { lo = Math.min(lo, L); hi = Math.max(hi, L); } }
  const span = Math.max(0.2, hi - lo);
  for (let i = 0; i < a.length; i += 4) {
    if (!a[i + 3]) continue;
    const L = lum(i);
    if (L <= 0.13) { a[i] = ramp[0][0] * 0.6; a[i + 1] = ramp[0][1] * 0.6; a[i + 2] = ramp[0][2] * 0.6; continue; }
    if (isSkin(a[i], a[i + 1], a[i + 2])) continue;
    const t = Math.max(0, Math.min(1, (L - lo) / span)) * (ramp.length - 1), k = Math.min(ramp.length - 2, Math.floor(t)), f = t - k;
    for (let j = 0; j < 3; j++) a[i + j] = ramp[k][j] + (ramp[k + 1][j] - ramp[k][j]) * f;
  }
  x.putImageData(d, 0, 0);
}

// Accessories: tiny pixel drawings anchored to the head (top row of each frame and its extents).
// P(dx, dy, col) paints relative to the frame; col: 'a' accent, 'w' highlight, 'd' dark.
const ACC = {
  crown: (P, { cx, top }) => { P(cx - 2, top, 'a'); P(cx, top, 'a'); P(cx + 2, top, 'a'); for (let i = -2; i <= 2; i++) P(cx + i, top + 1, 'a'); P(cx, top + 1, 'w'); },
  circlet: (P, { cx, top, row }) => { const [l, r] = row(top + 2); for (let i = l; i <= r; i++) P(i, top + 2, 'a'); P(cx, top + 2, 'w'); },
  horns: (P, { top, xl, xr }) => { P(xl - 1, top, 'w'); P(xl - 1, top + 1, 'a'); P(xl, top + 2, 'a'); P(xr + 1, top, 'w'); P(xr + 1, top + 1, 'a'); P(xr, top + 2, 'a'); },
  ears: (P, { top, xl, xr }) => { P(xl, top, 'a'); P(xl, top + 1, 'a'); P(xl + 1, top + 1, 'w'); P(xr, top, 'a'); P(xr, top + 1, 'a'); P(xr - 1, top + 1, 'w'); },
  halo: (P, { top, xl, xr }) => { for (let i = xl + 1; i <= xr - 1; i++) P(i, top, (i & 1) ? 'w' : 'a'); },
  flame: (P, { cx, top, f }) => { const o = f & 1; P(cx + o, top, 'w'); P(cx - 1, top + 1, 'a'); P(cx + o, top + 1, 'w'); P(cx + 1, top + 1, 'a'); P(cx, top + 2, 'a'); },
  icecrown: (P, { cx, top }) => { P(cx - 2, top, 'w'); P(cx, top, 'w'); P(cx + 2, top, 'w'); for (let i = -2; i <= 2; i++) P(cx + i, top + 1, 'a'); },
  blossom: (P, { top, xr }) => { const x = xr - 1, y = top + 1; P(x, y - 1, 'a'); P(x - 1, y, 'a'); P(x + 1, y, 'a'); P(x, y + 1, 'a'); P(x, y, 'w'); },
  feather: (P, { cx, top }) => { P(cx + 2, top, 'w'); P(cx + 3, top, 'a'); P(cx + 2, top + 1, 'a'); P(cx + 3, top + 1, 'a'); P(cx + 1, top + 2, 'a'); },
  star: (P, { top, xr }) => { const x = xr, y = top + 1; P(x, y - 1, 'a'); P(x - 1, y, 'a'); P(x + 1, y, 'a'); P(x, y + 1, 'a'); P(x, y, 'w'); },
  antenna: (P, { cx, top }) => { P(cx - 2, top, 'w'); P(cx + 2, top, 'w'); P(cx - 2, top + 1, 'a'); P(cx + 2, top + 1, 'a'); },
  leaf: (P, { cx, top }) => { P(cx, top, 'a'); P(cx + 1, top, 'w'); P(cx - 1, top + 1, 'a'); P(cx, top + 1, 'a'); },
  wisp: (P, { top, xr, f }) => { const y = top + 1 + (f & 1); P(xr + 1, y, 'w'); P(xr + 1, y + 1, 'a'); P(xr + 2, y + 1, 'a'); P(xr + 1, y + 2, 'a'); },
  hat: (P, { cx, top }) => { for (let i = -2; i <= 2; i++) { P(cx + i, top, 'd'); P(cx + i, top + 1, 'a'); } for (let i = -3; i <= 3; i++) P(cx + i, top + 2, 'd'); },
  bolt: (P, { top, xr }) => { P(xr + 1, top, 'w'); P(xr, top + 1, 'a'); P(xr + 1, top + 1, 'w'); P(xr, top + 2, 'a'); },
  gem: (P, { cx, top }) => { P(cx - 1, top + 2, 'a'); P(cx, top + 2, 'w'); P(cx + 1, top + 2, 'a'); P(cx, top + 3, 'a'); },
};
// Runs fn(frameX, frameY, info) for every non-empty frame of a sheet with its head anchor.
function eachFrame(a, W, H, fw, fh, fn) {
  const op = (x, y) => a[(y * W + x) * 4 + 3] > 40;
  for (let fy = 0; fy + fh <= H; fy += fh) for (let fx = 0; fx + fw <= W; fx += fw) {
    let top = -1;
    for (let y = 0; y < fh && top < 0; y++) for (let x = 0; x < fw; x++) if (op(fx + x, fy + y)) { top = y; break; }
    if (top < 0) continue;
    const row = (y) => { let l = fw, r = -1; if (y < fh) for (let x = 0; x < fw; x++) if (op(fx + x, fy + y)) { l = Math.min(l, x); r = Math.max(r, x); } return r < 0 ? [0, -1] : [l, r]; };
    // head extents: the widest of the top three rows; centre from the top two
    let xl = fw, xr = -1; for (let y = top; y < top + 3; y++) { const [l, r] = row(y); if (r >= 0) { xl = Math.min(xl, l); xr = Math.max(xr, r); } }
    const [l0, r0] = row(top), [l1, r1] = row(top + 1);
    const cx = Math.round((l0 + r0 + (r1 >= 0 ? l1 + r1 : l0 + r0)) / 4);
    fn(fx, fy, { top, xl, xr, cx, row, f: (fx / fw) + (fy / fh) });
  }
}
function paintAccessory(c, acc, accent, dark, fw, fh, scale = 1) {
  const fn = ACC[acc]; if (!fn) return;
  const x = c.getContext('2d'), W = c.width, H = c.height, d = x.getImageData(0, 0, W, H), a = d.data;
  const src = new Uint8ClampedArray(a); // anchors read the untouched sprite
  const cols = { a: hex(accent), w: [255, 255, 240], d: hex(dark) };
  // at scale 2 (portraits) the anchor grid is the 2x-downsampled image
  const gw = Math.floor(W / scale), gh = Math.floor(H / scale), grid = new Uint8ClampedArray(gw * gh * 4);
  for (let y = 0; y < gh; y++) for (let xx = 0; xx < gw; xx++) grid[(y * gw + xx) * 4 + 3] = src[((y * scale) * W + xx * scale) * 4 + 3] | src[((y * scale + scale - 1) * W + xx * scale + scale - 1) * 4 + 3];
  eachFrame(grid, gw, gh, fw / scale, fh / scale, (fx, fy, info) => {
    const P = (dx, dy, col) => {
      if (dx < 0 || dy < 0 || dx >= fw / scale || dy >= fh / scale) return;
      const c3 = cols[col];
      for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) {
        const i = (((fy + dy) * scale + sy) * W + (fx + dx) * scale + sx) * 4; a[i] = c3[0]; a[i + 1] = c3[1]; a[i + 2] = c3[2]; a[i + 3] = 255;
      }
    };
    fn(P, info);
  });
  x.putImageData(d, 0, 0);
}
// Soft 1px glow outline in the accent colour, kept inside each frame.
function glowOutline(c, accent, fw, fh) {
  const x = c.getContext('2d'), W = c.width, H = c.height, d = x.getImageData(0, 0, W, H), a = d.data, src = new Uint8ClampedArray(a), col = hex(accent);
  const op = (px, py) => src[(py * W + px) * 4 + 3] > 40;
  for (let y = 0; y < H; y++) for (let xx = 0; xx < W; xx++) {
    const i = (y * W + xx) * 4; if (src[i + 3]) continue;
    const lx = xx % fw, ly = y % fh;
    if ((lx > 0 && op(xx - 1, y)) || (lx < fw - 1 && op(xx + 1, y)) || (ly > 0 && op(xx, y - 1)) || (ly < fh - 1 && op(xx, y + 1))) { a[i] = col[0]; a[i + 1] = col[1]; a[i + 2] = col[2]; a[i + 3] = 120; }
  }
  x.putImageData(d, 0, 0);
}

function build(src, sk, fw, fh, scale) {
  if (sk.recolor) return recolor(src, sk.recolor);
  const c = toCanvas(src, fw === FW ? src.width : fw, fw === FW ? src.height : fh);
  const T = sk.theme ? THEMES[sk.theme] : null;
  if (T) gradientMap(c, T);
  if (sk.acc && !(scale > 1 && sk.acc === 'circlet')) paintAccessory(c, sk.acc, sk.accent, T ? T.ramp[0] : '#2a1d14', fw, fh, scale); // a headband reads as a stray line on a portrait
  if (sk.glow && scale === 1) glowOutline(c, sk.accent, fw, fh);
  return c;
}

// The sprite sheet for a hero in a skin (the base sheet for none/unknown). Not cached until its art is loaded.
export function skinSheet(heroId, key) {
  const base = IMG['hero_' + heroId], sk = skinFor(heroId, key);
  if (!base || !sk || key === 'base') return base || null;
  const ck = heroId + ':' + key;
  if (cache[ck]) return cache[ck];
  let src = base;
  if (sk.body) { src = IMG['skin_' + sk.body]; if (!src) { loadSkinBodies(); return base; } }
  const c = build(src, sk, FW, FW, 1);
  c._fk = 'hero_' + ck; // its own white hit-flash silhouette (Legendary bodies have their own outline)
  return (cache[ck] = c);
}
// Portrait canvas (38x38) for a hero in a skin, or null for the plain face.
export function skinFace(heroId, key) {
  const sk = skinFor(heroId, key); if (!sk || key === 'base') return null;
  const ck = heroId + ':' + key;
  if (faceCache[ck]) return faceCache[ck];
  const src = sk.body ? IMG['skinface_' + sk.body] : IMG['face_' + heroId];
  if (!src) { if (sk.body) loadSkinBodies(); return null; }
  const c = sk.recolor ? recolor(src, sk.recolor) : build(toCanvas(src, 38, 38), sk, 38, 38, 2);
  return (faceCache[ck] = c);
}
export function skinFaceUrl(heroId, key) {
  const ck = heroId + ':' + key;
  if (urlCache[ck]) return urlCache[ck];
  const c = skinFace(heroId, key); if (!c) return null;
  try { return (urlCache[ck] = c.toDataURL()); } catch { return null; }
}
// Face images for heroes still loading: loads the plain face into IMG (the match loader does this for every hero).
export function loadFace(heroId) {
  if (IMG['face_' + heroId]) return Promise.resolve();
  return new Promise((res) => { const im = new Image(); im.onload = () => { IMG['face_' + heroId] = im; res(); }; im.onerror = () => res(); im.src = `assets/img/faces/${heroId}.png`; });
}
