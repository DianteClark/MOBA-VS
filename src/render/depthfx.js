// Match-depth visuals (v23): talent pick, empowered ultimate (the tell on the hero and the cast),
// revenge and duo ultimates. Render-only (Math.random is fine here). Reduced effects: no shake,
// no particles, the empowered tell becomes a still ring.
import { TEAM_COL } from './palette.js';
import { P_SPARK, P_GLOW } from './particles.js';

const GOLD = '#ffcf4a';
// One sim fx of a depth kind (Renderer.consume; the fog check already ran for fx with a hero id).
export function depthFx(r, f, u, byId) {
  const on = (x, y) => r.onScreen(x, y, 60);
  switch (f.kind) {
    case 'talent':
      if (!u) break;
      r.text(u.x, u.y - 68, 'TALENT', '#c9a7ff', 9, 1.1, 'pop');
      if (on(u.x, u.y)) r.ring(u.x, u.y, 6, 30, '#c9a7ff', 0.5, 2);
      break;
    case 'ultUp':
      if (!u) break;
      r.text(u.x, u.y - 64, 'ULT EMPOWERED', GOLD, 10, 1.4, 'pop');
      if (on(u.x, u.y)) { r.ring(u.x, u.y, 6, 52, GOLD, 0.6, 3); if (r.motion) sparks(r, u.x, u.y, 8, GOLD); }
      break;
    case 'ultEmp':
      // the empowered cast: a second, gold shockwave on top of the normal ult flash
      if (!u || !on(u.x, u.y)) break;
      r.ring(u.x, u.y, 12, 120, GOLD, 0.55, 5); r.ring(u.x, u.y, 12, 80, '#ffffff', 0.4, 2, 0.08);
      r.screenTint(GOLD, 0.12, 0.35); r.shakeBy(0.15);
      break;
    case 'revenge':
      if (!u) break;
      r.text(u.x, u.y - 66, 'REVENGE!', '#ff7a5a', 11, 1.3, 'pop');
      if (on(u.x, u.y)) r.ring(u.x, u.y, 6, 44, '#ff7a5a', 0.5, 3);
      break;
    case 'duoUlt': {
      if (!r.visiblePoint(f.x, f.y)) break;
      const c = TEAM_COL[f.team] || '#ffffff';
      r.text(f.x, f.y - 76, 'DUO ULT: ' + String(f.name).toUpperCase(), c, 12, 1.6, 'pop');
      if (!on(f.x, f.y)) break;
      const R = f.combo === 'burst' ? 340 : 450;
      r.ring(f.x, f.y, 20, R, f.combo === 'burst' ? '#ff9a3c' : f.combo === 'shield' ? '#9fe8ff' : '#7dff9a', 0.7, 6);
      r.ring(f.x, f.y, 20, R * 0.7, c, 0.6, 3, 0.1);
      for (const id of [f.a, f.b]) { const q = byId.get(id); if (q && r.motion) r.fxSprite('boost', q.x, q.y - 10, 1.6, q.id); }
      r.shakeBy(0.3); r.screenTint(c, 0.18, 0.4);
      break;
    }
  }
}
function sparks(r, x, y, n, c) {
  for (let k = 0; k < n; k++) { const q = r.fxp.spawn(P_SPARK, x + (Math.random() - 0.5) * 30, y - Math.random() * 30, 0.5); q.vy = -60 - Math.random() * 60; q.c = c; q.s = 0.6; }
}
// The tell on a hero whose next ultimate is empowered: two gold motes circling the feet (a still ring
// with Reduced effects). Drawn in world space under the HP bar.
export function drawUltUp(r, u, x, y) {
  const ctx = r.ctx;
  ctx.save();
  ctx.strokeStyle = GOLD; ctx.globalAlpha = 0.55; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.ellipse(x, y + 3, 15, 6, 0, 0, Math.PI * 2); ctx.stroke();
  if (r.motion) {
    const t = r.time * 3.2;
    ctx.globalAlpha = 0.95; ctx.fillStyle = GOLD;
    for (let i = 0; i < 2; i++) { const a = t + i * Math.PI; ctx.fillRect(x + Math.cos(a) * 15 - 2, y + 3 + Math.sin(a) * 6 - 2, 4, 4); }
    if (Math.random() < 0.05) { const q = r.fxp.spawn(P_GLOW, x + (Math.random() - 0.5) * 20, y, 0.6); q.vy = -40; q.c = GOLD; q.s = 3; }
  }
  ctx.restore();
}
