// Weekly map event look (render-only; Math.random is fine here). Cheap by design:
//  - Blood Moon's night palette is baked into the painted map once (paintEventMap), so it costs nothing per frame.
//  - Per frame: at most one full-screen veil fill and a small pool of screen-space motes (<= 26), plus the odd
//    Kami Storm lightning flash. Low quality: veil only. Auto-medium / Reduced effects: half the motes, and
//    Reduced effects drops the lightning flash.
import { EVENT_BY_ID } from '../data/events.js';
import { glowSprite } from './particles.js';
import { settings } from '../ui/settings.js';

// Multiply a moonlit tint over a freshly painted map canvas (Blood Moon), with a faint red rim light.
export function paintEventMap(canvas, eventId) {
  const ev = EVENT_BY_ID[eventId], n = ev && ev.look && ev.look.night; if (!n) return canvas;
  const ctx = canvas.getContext('2d'), S = canvas.width;
  ctx.save();
  ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = `rgb(${n[0]},${n[1]},${n[2]})`; ctx.fillRect(0, 0, S, S);
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(S * 0.85, S * 0.12, 40, S * 0.85, S * 0.12, S * 0.9);
  g.addColorStop(0, 'rgba(120,20,30,0.30)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
  ctx.restore();
  return canvas;
}
// Whether an event changes the painted map (cache key for painted canvases).
export const eventPaintKey = (eventId) => (EVENT_BY_ID[eventId] && EVENT_BY_ID[eventId].look && EVENT_BY_ID[eventId].look.night ? eventId : '');

const MOTE = {
  ember: { n: 18, cols: ['#ff5a4a', '#ff8a5a', '#ffb070'], vx: [-8, 8], vy: [-28, -12], glow: true, size: 2 },
  gold: { n: 14, cols: ['#ffd24a', '#fff0a0', '#ffc030'], vx: [-6, 6], vy: [-16, -6], glow: true, size: 2 },
  spirit: { n: 14, cols: ['#7fe9d6', '#c6fff4', '#5fd0ff'], vx: [-6, 6], vy: [-22, -10], glow: true, size: 2 },
  wind: { n: 22, cols: ['rgba(235,255,245,0.55)', 'rgba(200,240,225,0.45)'], vx: [260, 380], vy: [-12, 12], streak: true },
  mist: { n: 6, cols: [''], vx: [10, 22], vy: [-3, 3], blob: true },
};
let blob = null; // one cached soft mist blob, scaled per mote (no per-frame gradients)
function mistBlob() {
  if (blob) return blob;
  const c = blob = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 1, 32, 32, 32);
  g.addColorStop(0, 'rgba(228,234,244,0.22)'); g.addColorStop(1, 'rgba(228,234,244,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  return c;
}

export class EventFx {
  constructor(r) { this.r = r; this.ev = null; this.parts = []; this.flash = 0; this.nextFlash = 8; }
  attach(game) { this.ev = game.event ? EVENT_BY_ID[game.event] : null; this.parts = []; this.flash = 0; this.nextFlash = 6 + Math.random() * 8; }
  // Screen space, after the weather layer.
  draw(ctx, W, H, dt) {
    const ev = this.ev; if (!ev || !ev.look) return;
    const look = ev.look, r = this.r, d = r.dpr || 1;
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (look.veil) { ctx.fillStyle = look.veil; ctx.fillRect(0, 0, W, H); }
    const L = r.detail === 0 ? 0 : (r.detail === 1 || settings.reducedMotion) ? 0.5 : 1;
    const m = look.motes && MOTE[look.motes];
    if (m && L) {
      const want = Math.round(m.n * L), P = this.parts;
      while (P.length < want) P.push(this.spawn(m, W, H, true));
      if (P.length > want) P.length = want;
      for (let i = 0; i < P.length; i++) {
        const p = P[i]; p.t += dt; p.x += p.vx * dt * d; p.y += p.vy * dt * d + Math.sin(p.t * 1.3 + p.ph) * 0.3 * d;
        if (p.t > p.life || p.x < -60 * d || p.x > W + 60 * d || p.y < -60 * d || p.y > H + 60 * d) { P[i] = this.spawn(m, W, H, false); continue; }
        const a = Math.min(1, p.t / 0.8, (p.life - p.t) / 0.8);
        if (m.streak) { ctx.globalAlpha = a; ctx.fillStyle = p.c; ctx.fillRect(p.x, p.y, 18 * d * p.s, d); }
        else if (m.blob) { ctx.globalAlpha = a; ctx.imageSmoothingEnabled = true; const bw = W * 0.4 * p.s, bh = H * 0.24 * p.s; ctx.drawImage(mistBlob(), p.x - bw / 2, p.y - bh / 2, bw, bh); }
        else {
          const tw = 0.55 + 0.45 * Math.sin(p.t * 3 + p.ph), sz = (m.size || 2) * d;
          ctx.globalAlpha = a * tw;
          if (m.glow) { ctx.globalCompositeOperation = 'lighter'; ctx.drawImage(glowSprite(p.c), p.x - 6 * d, p.y - 6 * d, 12 * d, 12 * d); ctx.globalCompositeOperation = 'source-over'; }
          ctx.fillStyle = p.c; ctx.fillRect(Math.round(p.x), Math.round(p.y), sz, sz);
        }
      }
      ctx.globalAlpha = 1;
    }
    // Kami Storm: a faint violet sheet-lightning flash every 8-18 s (never with Reduced effects)
    if (look.flash && L && r.motion) {
      this.nextFlash -= dt;
      if (this.nextFlash <= 0) { this.flash = 1; this.nextFlash = 8 + Math.random() * 10; }
      if (this.flash > 0) { ctx.globalAlpha = 0.10 * this.flash * (this.flash > 0.7 ? 1 : 0.6); ctx.fillStyle = '#d8ccff'; ctx.fillRect(0, 0, W, H); this.flash = Math.max(0, this.flash - dt * 3.5); ctx.globalAlpha = 1; }
    }
    ctx.restore();
  }
  spawn(m, W, H, anywhere) {
    const rr = (a) => a[0] + Math.random() * (a[1] - a[0]);
    const vx = rr(m.vx), free = anywhere || m.blob; // mist banks fade in where they are; streaks enter from the left; motes rise from below
    const x = free ? Math.random() * W : vx > 100 ? -40 : Math.random() * W;
    const y = free || vx > 100 ? Math.random() * H : H + 20 + Math.random() * 30;
    return { x, y, vx, vy: rr(m.vy), t: 0, life: m.streak ? 3 : 4 + Math.random() * 5, ph: Math.random() * 6, s: 0.6 + Math.random() * 0.8, c: m.cols[(Math.random() * m.cols.length) | 0] };
  }
}
