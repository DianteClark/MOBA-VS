// Dojo Lore tab (v24): a hero's story as a short paragraph, three comic panels composed from pack sprites
// (clan scene + props from the map tilesets, the hero, a rival and an ally), and a small relationship graph
// (duo partners, rivals, clan-mates). Everything is drawn from data (src/data/lore.js, feuds.js, synergy.js):
// no new art.
import { h, face } from './dom.js';
import { HEROES, HERO_BY_ID } from '../data/heroes.js';
import { CLANS } from '../sim/constants.js';
import { STORY, SCENES } from '../data/lore.js';
import { feudsOf } from '../data/feuds.js';
import { duosOf } from '../data/synergy.js';
import { matchups } from '../data/herostats.js';
import { IMG } from '../render/assets.js';
import { SPR } from '../render/mapgen.js';
import { skinSheet } from '../render/skins.js';

const W = 160, H = 96; // panel canvas (logical pixels, scaled up crisp by CSS)
const hash = (s) => { let x = 2166136261; for (let i = 0; i < s.length; i++) x = Math.imul(x ^ s.charCodeAt(i), 16777619); return x >>> 0; };
const BARKS = ['Not today!', 'Is that all?', 'Stand aside!', 'Hyah!', 'You again?', 'This ends now.'];

// Who shares the page: the first rival (or the hero's hardest matchup), the first duo partner (or a clan-mate).
export function loreCast(id) {
  const x = HERO_BY_ID[id], feud = feudsOf(id)[0], duo = duosOf(id)[0];
  const foil = feud ? feud.id : (matchups(id).weak[0] || matchups(id).strong[0] || {}).id || HEROES.find((o) => o.clan !== x.clan).id;
  const mates = HEROES.filter((o) => o.clan === x.clan && o.id !== id);
  const ally = duo ? duo.partner : mates[hash(id) % mates.length].id;
  return { foil, line: feud ? feud.line : BARKS[hash(id + foil) % BARKS.length], ally, duo: duo ? duo.name : null, mates };
}

// ── panel painting ──
function prop(ctx, name, x, y, s = 1) {
  const r = SPR[name]; if (!r) return;
  const img = IMG[r[4] || 'TilesetNature']; if (!img || !img.complete && !(img instanceof HTMLCanvasElement)) return;
  ctx.drawImage(img, r[0], r[1], r[2], r[3], Math.round(x - r[2] * s / 2), Math.round(y - r[3] * s), Math.round(r[2] * s), Math.round(r[3] * s));
}
function scene(ctx, clan) {
  const S = SCENES[clan] || SCENES.wild;
  const g = ctx.createLinearGradient(0, 0, 0, H * 0.62); g.addColorStop(0, S.sky[0]); g.addColorStop(1, S.sky[1]);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = S.ground; ctx.fillRect(0, Math.round(H * 0.62), W, H);
  ctx.fillStyle = 'rgba(0,0,0,0.18)'; for (let y = Math.round(H * 0.62); y < H; y += 6) ctx.fillRect(0, y, W, 1);
  ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(0, Math.round(H * 0.62), W, 1);
  prop(ctx, S.props[0], 22, H * 0.66, 0.8); prop(ctx, S.props[1], W - 24, H * 0.66, 0.8);
}
// One hero frame (16px sheet cell), bottom-centred at (x, y), scaled by s.
function body(ctx, id, col, row, x, y, s) {
  const img = skinSheet(id, 'base'); if (!img) return;
  ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(x, y, 7 * s, 2.2 * s, 0, 0, Math.PI * 2); ctx.fill();
  ctx.drawImage(img, col * 16, row * 16, 16, 16, Math.round(x - 8 * s), Math.round(y - 16 * s), 16 * s, 16 * s);
}
function burst(ctx, x, y, col) { // comic "clash" star between the fighters
  ctx.fillStyle = col; ctx.beginPath();
  for (let i = 0; i <= 16; i++) { const a = i / 16 * Math.PI * 2, r = i % 2 ? 5 : 12; i ? ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r) : ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r); }
  ctx.fill(); ctx.fillStyle = '#fff'; ctx.fillRect(x - 2, y - 2, 4, 4);
}
const PAINT = [
  (ctx, c) => { scene(ctx, c.x.clan); prop(ctx, (SCENES[c.x.clan] || SCENES.wild).props[2], W * 0.72, H * 0.9, 0.9); body(ctx, c.id, 0, 0, W / 2, H * 0.92, 3); },
  (ctx, c) => { scene(ctx, HERO_BY_ID[c.foil].clan); body(ctx, c.id, 3, 4, W * 0.3, H * 0.92, 3); body(ctx, c.foil, 2, 0, W * 0.72, H * 0.92, 3); burst(ctx, W * 0.51, H * 0.6, CLANS[c.x.clan].color); },
  (ctx, c) => { scene(ctx, c.x.clan); body(ctx, c.id, 0, 0, W * 0.38, H * 0.92, 2.6); body(ctx, c.ally, 0, 0, W * 0.64, H * 0.92, 2.6);
    ctx.fillStyle = CLANS[c.x.clan].color; for (let i = 0; i < 5; i++) ctx.fillRect(Math.round(W * 0.51 + Math.cos(i * 1.3) * 14), Math.round(H * 0.3 + Math.sin(i * 2.1) * 8), 2, 2); },
];
function panel(i, cast, caption, bubble) {
  const cv = h('canvas', { class: 'lpcv', width: W, height: H, 'aria-hidden': 'true' });
  const draw = () => { const ctx = cv.getContext('2d'); ctx.imageSmoothingEnabled = false; ctx.clearRect(0, 0, W, H); PAINT[i](ctx, cast); };
  draw();
  setTimeout(() => { if (cv.isConnected) draw(); }, 700); // a late tileset (ruins props) may arrive a moment later
  // the caption sits under the art (any language length fits); the speech bubble floats over the art's sky
  return h('figure', { class: 'lpanel p' + i },
    h('div', { class: 'lpart' }, cv, bubble ? h('div', { class: 'lbub' + (i === 1 ? ' l' : '') }, bubble) : null),
    h('figcaption', { class: 'lcap' }, caption));
}

// ── relationship graph: hero in the middle, duo partners (green), rivals (red) and clan-mates around ──
function graph(id, c, onHero) {
  const x = HERO_BY_ID[id];
  const nodes = [...duosOf(id).map((d) => ({ id: d.partner, k: 'duo', t: d.name })), ...feudsOf(id).map((f) => ({ id: f.id, k: 'rival', t: 'Rival' }))];
  for (const m of c.mates) { if (nodes.length >= 7) break; if (!nodes.some((n) => n.id === m.id) && hash(id + m.id) % 3 === 0) nodes.push({ id: m.id, k: 'clan', t: CLANS[x.clan].name }); }
  for (const m of c.mates) { if (nodes.length >= 4) break; if (!nodes.some((n) => n.id === m.id)) nodes.push({ id: m.id, k: 'clan', t: CLANS[x.clan].name }); }
  const GW = 260, GH = 150, cx = GW / 2, cy = GH / 2, R = [104, 56];
  const pos = nodes.map((n, i) => { const a = -Math.PI / 2 + (i + 0.5) / nodes.length * Math.PI * 2; return { x: cx + Math.cos(a) * R[0], y: cy + Math.sin(a) * R[1] }; });
  const COL = { duo: '#6fdc8c', rival: '#ff6b5a', clan: CLANS[x.clan].color };
  const svg = `<svg viewBox="0 0 ${GW} ${GH}" preserveAspectRatio="none" aria-hidden="true">${nodes.map((n, i) => `<line x1="${cx}" y1="${cy}" x2="${pos[i].x.toFixed(1)}" y2="${pos[i].y.toFixed(1)}" stroke="${COL[n.k]}" stroke-width="2" ${n.k === 'clan' ? 'stroke-dasharray="3 3" opacity="0.6"' : ''}/>`).join('')}</svg>`;
  const g = h('div', { class: 'lgraph', role: 'group', 'aria-label': 'Relationships' });
  g.innerHTML = svg;
  g.append(h('div', { class: 'lnode me', style: { left: cx / GW * 100 + '%', top: cy / GH * 100 + '%', '--nc': CLANS[x.clan].color } }, h('img', { src: face(id), alt: '' })));
  nodes.forEach((n, i) => g.append(h('button', { class: 'lnode ' + n.k, style: { left: pos[i].x / GW * 100 + '%', top: pos[i].y / GH * 100 + '%', '--nc': COL[n.k] }, title: `${HERO_BY_ID[n.id].name} · ${n.t}`, 'aria-label': `${HERO_BY_ID[n.id].name}, ${n.t}`, onclick: () => onHero(n.id) },
    h('img', { src: face(n.id), alt: '' }), h('small', {}, HERO_BY_ID[n.id].name))));
  return h('div', { class: 'dsec' }, h('div', { class: 'dsh' }, 'Relationships ', h('small', { class: 'muted' }, 'green duo · red rival · dashed clan')), g);
}

export function lorePanel(id, onHero) {
  const x = HERO_BY_ID[id], beats = STORY[id], c = { ...loreCast(id), id, x };
  return h('div', { class: 'lore' },
    h('div', { class: 'dsec' }, h('div', { class: 'dsh' }, 'Story'), h('p', { class: 'lstory' }, ...beats.map((b) => h('span', {}, b)))), // one span per beat: each is its own catalog string
    h('div', { class: 'lcomic', role: 'img', 'aria-label': `${x.name}'s story in three panels` },
      panel(0, c, beats[0], null), panel(1, c, beats[1], c.line), panel(2, c, beats[2], c.duo ? c.duo + '!' : null)),
    graph(id, c, onHero));
}
