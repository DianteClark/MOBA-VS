// Hearthfire visuals (v24, render-only): ember pips under Hearth heroes' HP bars and a pop when the team's
// Hearthfire grows or gutters. Reads g.hearth (src/sim/hearth.js); never writes sim state.
import { CLANS } from '../sim/constants.js';
import { HEARTH } from '../data/hearth.js';

const GOLD = CLANS.hearth.color, DIM = '#6a4a1a';
// Pips: one 3x3 flame dot per possible ember (lit / dark), centered under the bar. Bonfire (5+) flickers.
export function drawEmbers(r, u, x, y) {
  const H = r.game.hearth && r.game.hearth[u.team]; if (!H) return;
  const ctx = r.ctx, n = H.embers, max = H.max, step = 5, x0 = Math.round(x - (max * step - 2) / 2), yy = Math.round(y);
  const hot = n >= HEARTH.bonfire && r.motion ? 0.75 + 0.25 * Math.sin(r.time * 9 + u.id) : 1;
  for (let i = 0; i < max; i++) {
    const bx = x0 + i * step;
    ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(bx - 1, yy - 1, 5, 5);
    ctx.fillStyle = i < n ? GOLD : DIM; ctx.globalAlpha = i < n ? hot : 0.8; ctx.fillRect(bx, yy, 3, 3);
    if (i < n) { ctx.fillStyle = '#fff4c8'; ctx.fillRect(bx + 1, yy, 1, 1); }
  }
  ctx.globalAlpha = 1;
}
// fx { kind: 'hearth', team, embers, max, up, x, y }
export function hearthPop(r, f) {
  if (!r.visiblePoint(f.x, f.y)) return;
  r.text(f.x, f.y - 70, `HEARTHFIRE ${f.embers}/${f.max}`, f.up ? GOLD : '#b08a5a', 9, 1.2, f.up ? 'pop' : undefined);
  if (f.up && r.motion) r.fxSprite('flame', f.x, f.y - 30, 0.9);
}
