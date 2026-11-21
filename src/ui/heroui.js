// Small hero widgets shared by the Dojo and the draft: rating bars and the animated sprite.
import { h } from './dom.js';
import { IMG, recolor } from '../render/assets.js';
import { SKINS } from '../data/seasons.js';
import { RATING_KEYS, RATING_LABEL, RATING_COLOR, heroRatings } from '../data/herostats.js';

// Rating bars (0-10). `mini` = compact two-column version for the draft side panel.
export function statBars(id, mini = false) {
  const r = heroRatings(id);
  return h('div', { class: 'sbars' + (mini ? ' mini' : '') }, ...RATING_KEYS.map((k) => h('div', { class: 'sbar', title: `${RATING_LABEL[k]} ${r[k]}/10` },
    h('span', { class: 'sl' }, RATING_LABEL[k]),
    h('span', { class: 'st' }, h('i', { style: { width: r[k] * 10 + '%', background: RATING_COLOR[k] } })),
    mini ? null : h('b', {}, r[k]))));
}

// Hero sheets are 4 columns (facing) x 7 rows of 16px frames: rows 0-3 walk, row 4 attack.
const sheets = {};
export function heroSheet(id, skin) {
  const base = IMG['hero_' + id]; if (!base) return null;
  const sk = SKINS[skin]; if (!sk || !sk.recolor) return base;
  const key = id + ':' + skin;
  return sheets[key] || (sheets[key] = recolor(base, sk.recolor));
}
const FACING_TOUR = [0, 3, 1, 2]; // sheet columns: down, up, left, right
// Animated sprite on a canvas. Returns the canvas; set `.anim = 'idle' | 'walk' | 'attack'` and `.skin` on it.
export function heroSprite(id, skin, size = 96, anim = 'walk') {
  const c = h('canvas', { width: 16, height: 16, class: 'hsprite', style: { width: size + 'px', height: size + 'px' } });
  c.anim = anim; c.skin = skin; c.t0 = performance.now();
  const ctx = c.getContext('2d');
  const loop = (now) => {
    if (!c.isConnected && c.started) return;
    c.started = true;
    const img = heroSheet(id, c.skin);
    ctx.clearRect(0, 0, 16, 16); ctx.imageSmoothingEnabled = false;
    if (img) {
      const el = now - c.t0, t = Math.floor(el / (c.anim === 'attack' ? 160 : 150));
      // walk turns through the facings (front, right, back, left) so the whole sprite shows; idle breathes; attack swings
      const col = c.anim === 'walk' ? FACING_TOUR[Math.floor(el / 2400) % 4] : 0;
      const row = c.anim === 'walk' ? t % 4 : c.anim === 'attack' ? (t % 3 ? 4 : 0) : t % 8 < 6 ? 0 : 1;
      ctx.drawImage(img, col * 16, row * 16, 16, 16, 0, 0, 16, 16);
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  return c;
}
// Static first frame (cheap: used in lists and skin pickers).
export function heroStill(id, skin, size = 48) {
  const c = h('canvas', { width: 16, height: 16, class: 'hsprite', style: { width: size + 'px', height: size + 'px' } });
  const img = heroSheet(id, skin);
  if (img) { const x = c.getContext('2d'); x.imageSmoothingEnabled = false; x.drawImage(img, 0, 0, 16, 16, 0, 0, 16, 16); }
  return c;
}
