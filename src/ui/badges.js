// Rank tier badges (pixel art drawn on a 32x32 canvas, cached as data URLs) and hero mastery badges.
import { h } from './dom.js';
import { TIERS, rankOf } from '../data/ranks.js';
import { masteryColor } from '../mastery.js';

const cache = {};
const hex = (c) => { const n = parseInt(c.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
const mix = (a, b, t) => { const A = hex(a), B = hex(b); return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(',')})`; };

// Draws one badge. idx = tier index, d = division 0..2 (III..I).
function draw(idx, d) {
  const t = TIERS[idx], c = document.createElement('canvas'); c.width = c.height = 32;
  const x = c.getContext('2d');
  const px = (X, Y, col, w = 1, hh = 1) => { x.fillStyle = col; x.fillRect(X, Y, w, hh); };
  const row = (Y, x0, x1, col) => px(x0, Y, col, x1 - x0 + 1, 1);
  const dark = t.dark, base = t.color, light = mix(t.color, '#ffffff', 0.45), deep = mix(t.dark, '#000000', 0.35);
  // halo + rays (Master, Kami)
  if (idx >= 5) {
    const halo = idx === 6 ? '#ffe08a' : mix(t.color, '#ffffff', 0.3);
    for (let a = 0; a < 12; a++) { const ang = a / 12 * Math.PI * 2; for (let r = 12; r < (idx === 6 ? 16 : 14); r++) px(Math.round(16 + Math.cos(ang) * r), Math.round(14 + Math.sin(ang) * r), halo); }
  }
  // wings (Platinum+)
  if (idx >= 3) {
    const wc = idx >= 5 ? light : base;
    for (let k = 0; k < 6; k++) { row(9 + k, 1 + k, 5 + Math.floor(k / 2), wc); row(9 + k, 26 - Math.floor(k / 2), 30 - k, wc); }
    for (let k = 0; k < 4; k++) { px(2 + k, 9 + k, deep); px(29 - k, 9 + k, deep); }
  }
  // body: shield (Bronze-Platinum, Master, Kami) or rhombus (Diamond)
  const half = (Y) => {
    if (idx === 4) { const m = 15; return Y < 3 || Y > 29 ? -1 : Math.round(11 - Math.abs(Y - m) * 0.82); }
    if (Y < 4 || Y > 29) return -1;
    if (Y < 6) return 9 + (Y - 4);
    if (Y < 19) return 11;
    return Math.max(0, Math.round(11 - (Y - 19) * 1.05));
  };
  for (let Y = 0; Y < 32; Y++) {
    const w = half(Y); if (w < 0) continue;
    row(Y, 16 - w - 1, 15 + w + 1, deep);           // outline
    if (w > 0) row(Y, 16 - w, 15 + w, dark);          // fill
    if (w > 1) { px(16 - w, Y, base); px(15 + w, Y, mix(t.color, t.dark, 0.4)); } // rim light/shade
  }
  // top rim highlight
  const topY = idx === 4 ? 4 : 4; for (let X = 16 - (half(topY) || 1); X <= 15 + (half(topY) || 1); X++) if (half(topY) > 0) px(X, topY, light);
  // spikes (Gold+) / crown (Master, Kami)
  if (idx >= 2 && idx !== 4) { px(5, 4, base); px(26, 4, base); px(4, 3, light); px(27, 3, light); }
  if (idx >= 5) { const cr = idx === 6 ? '#ffe08a' : light; row(2, 12, 19, cr); px(12, 1, cr); px(15, 0, cr, 2, 2); px(19, 1, cr); px(12, 3, deep, 8, 1); }
  // gem: a diamond in the middle, bigger with each tier
  const gr = 3 + Math.min(3, Math.floor(idx / 2)), gy = 14;
  for (let k = -gr; k <= gr; k++) { const w = gr - Math.abs(k); row(gy + k, 16 - w - 1, 15 + w + 1, deep); if (w > 0) row(gy + k, 16 - w, 15 + w, k < 0 ? t.gem : base); }
  px(15, gy - gr + 2, '#ffffff', 1, 2); px(14, gy - gr + 3, '#ffffff');
  // division pips (III = 1, II = 2, I = 3)
  const n = d + 1, py = 24;
  for (let k = 0; k < n; k++) { const X = 16 - n * 2 + k * 4 + 1; px(X - 1, py - 1, deep, 4, 4); px(X, py, light, 2, 2); }
  return c.toDataURL('image/png');
}
export function badgeUrl(idx, d) { const k = idx * 3 + d; return cache[k] || (cache[k] = draw(idx, d)); }

// <img> badge for a rank (from rankOf) or a raw Elo number.
export function tierBadge(rk, size = 40, cls = '') {
  const r = typeof rk === 'number' ? rankOf(rk) : rk;
  return h('img', { class: 'tbadge ' + cls, src: badgeUrl(r.idx, r.d), alt: r.label, title: r.label, style: { width: size + 'px', height: size + 'px', '--tc': r.tier.color } });
}

// Small CSS mastery badge (a diamond with the level). lv 1 = none unless `always`.
export function masteryBadge(lv, opts = {}) {
  if (lv < 2 && !opts.always) return null;
  return h('span', { class: 'mbadge' + (lv >= 10 ? ' max' : '') + (opts.cls ? ' ' + opts.cls : ''), title: `Mastery ${lv}`, style: { '--mc': masteryColor(lv) } }, h('b', {}, String(lv)));
}
