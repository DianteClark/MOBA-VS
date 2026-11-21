// Fixed-size particle pool (no per-frame allocation). Render-only: uses Math.random freely.
// Kinds: square, spark (cross), sprite (fx sheet), coin, wisp (homes to a unit), debris (bounces),
//        ring (expanding ellipse), puff (growing soft circle), beam (vertical light column).
import { IMG, FX } from './assets.js';

export const P_SQUARE = 0, P_SPARK = 1, P_SPRITE = 2, P_COIN = 3, P_WISP = 4, P_DEBRIS = 5, P_RING = 6, P_PUFF = 7, P_BEAM = 8;

export class Particles {
  constructor(max = 900) {
    this.max = max; this.n = 0;
    this.keep = 1; // share of spawns that are real (Reduced effects lowers it); the rest go to a scratch particle
    this.scratch = { kind: 0, x: 0, y: 0, vx: 0, vy: 0, g: 0, life: 1, t: 0, c: '#fff', s: 1, s2: 0, ground: 0, target: 0, sprite: null, w: 2 };
    this.a = Array.from({ length: max }, () => ({ kind: 0, x: 0, y: 0, vx: 0, vy: 0, g: 0, life: 1, t: 0, c: '#fff', s: 1, s2: 0, ground: 0, target: 0, sprite: null, w: 2 }));
  }
  clear() { this.n = 0; }
  // Returns a recycled particle with sane defaults; caller sets the rest.
  spawn(kind, x, y, life) {
    let p;
    if (this.keep < 1 && Math.random() > this.keep) return this.scratch;
    if (this.n < this.max) p = this.a[this.n++];
    else p = this.a[(Math.random() * this.max) | 0]; // full: overwrite a random one
    p.kind = kind; p.x = x; p.y = y; p.vx = 0; p.vy = 0; p.g = 0; p.life = life; p.t = 0; p.c = '#fff'; p.s = 1; p.s2 = 0; p.ground = 0; p.target = 0; p.sprite = null; p.w = 2;
    return p;
  }
  update(dt, unitPos) {
    const A = this.a;
    for (let i = 0; i < this.n;) {
      const p = A[i];
      p.t += dt;
      if (p.t >= p.life) { A[i] = A[this.n - 1]; A[this.n - 1] = p; this.n--; continue; }
      if (p.t < 0) { i++; continue; } // delayed start
      if (p.kind === P_WISP) {
        const tgt = p.target && unitPos(p.target);
        if (tgt) {
          const dx = tgt.x - p.x, dy = tgt.y - 20 - p.y, d = Math.hypot(dx, dy) || 1;
          const sp = 80 + p.t * 520;
          p.vx += (dx / d * sp - p.vx) * Math.min(1, dt * 6); p.vy += (dy / d * sp - p.vy) * Math.min(1, dt * 6);
          if (d < 14 && p.t > 0.25) { p.life = p.t; } // arrived
        } else p.vy -= 60 * dt;
      } else p.vy += p.g * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.kind === P_DEBRIS && p.y > p.ground && p.vy > 0) { p.y = p.ground; p.vy *= -0.38; p.vx *= 0.6; if (Math.abs(p.vy) < 30) { p.vy = 0; p.g = 0; p.vx *= 0.5; } }
      i++;
    }
  }
  // Drawn in world space (ctx already transformed).
  draw(ctx, time, onWispTrail) {
    const A = this.a;
    for (let i = 0; i < this.n; i++) {
      const p = A[i]; if (p.t < 0) continue;
      const k = p.t / p.life;
      let alpha = k > 0.7 ? (1 - k) / 0.3 : 1;
      switch (p.kind) {
        case P_SQUARE: ctx.globalAlpha = alpha; ctx.fillStyle = p.c; ctx.fillRect(Math.round(p.x), Math.round(p.y), p.s, p.s); break;
        case P_SPARK: { ctx.globalAlpha = alpha; ctx.strokeStyle = p.c; ctx.lineWidth = 2; const r = 4 + k * 10 * p.s; ctx.beginPath(); ctx.moveTo(p.x - r, p.y); ctx.lineTo(p.x + r, p.y); ctx.moveTo(p.x, p.y - r); ctx.lineTo(p.x, p.y + r); ctx.stroke(); break; }
        case P_SPRITE: {
          const img = IMG['fx_' + p.sprite]; if (!img) break;
          const fr = FX[p.sprite].frames, fw = img.width / fr, f = Math.floor(time * 10) % fr;
          ctx.globalAlpha = alpha; ctx.drawImage(img, f * fw, 0, fw, img.height, p.x - fw * p.s / 2, p.y - img.height * p.s / 2, fw * p.s, img.height * p.s); break;
        }
        case P_COIN: {
          // spinning pixel coin
          const w = Math.max(1, Math.abs(Math.cos(time * 9 + p.s2)) * 6), x = Math.round(p.x), y = Math.round(p.y);
          ctx.globalAlpha = alpha; ctx.fillStyle = '#8a5a00'; ctx.fillRect(x - w / 2 - 1, y - 4, w + 2, 8);
          ctx.fillStyle = '#ffd84a'; ctx.fillRect(x - w / 2, y - 3, w, 6);
          if (w > 3) { ctx.fillStyle = '#fff6b0'; ctx.fillRect(x - w / 2 + 1, y - 2, 1.5, 2); }
          break;
        }
        case P_WISP: {
          ctx.globalAlpha = 0.9; ctx.fillStyle = p.c;
          ctx.beginPath(); ctx.arc(p.x, p.y, 5 + Math.sin(time * 20) * 1, 0, Math.PI * 2); ctx.fill();
          ctx.globalAlpha = 0.35; ctx.beginPath(); ctx.arc(p.x, p.y, 10, 0, Math.PI * 2); ctx.fill();
          ctx.globalAlpha = 1; ctx.fillStyle = '#fff'; ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
          if (onWispTrail && Math.random() < 0.6) onWispTrail(p);
          break;
        }
        case P_DEBRIS: ctx.globalAlpha = alpha; ctx.fillStyle = p.c; ctx.fillRect(Math.round(p.x - p.s / 2), Math.round(p.y - p.s / 2), p.s, p.s); ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(Math.round(p.x - p.s / 2), Math.round(p.y + p.s / 2 - 1), p.s, 1); break;
        case P_RING: {
          const e = 1 - (1 - k) * (1 - k); // ease-out
          const r = p.s + (p.s2 - p.s) * e;
          ctx.globalAlpha = (1 - k) * 0.9; ctx.strokeStyle = p.c; ctx.lineWidth = p.w * (1 - k * 0.6);
          ctx.beginPath(); ctx.ellipse(p.x, p.y, r, r * 0.6, 0, 0, Math.PI * 2); ctx.stroke(); break;
        }
        case P_PUFF: { const r = p.s + (p.s2 - p.s) * k; ctx.globalAlpha = (1 - k) * 0.55; ctx.fillStyle = p.c; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill(); break; }
        case P_BEAM: {
          const a = k < 0.2 ? k / 0.2 : (1 - k) / 0.8, w = p.s * (1 - k * 0.5), hgt = p.s2;
          const gr = ctx.createLinearGradient(0, p.y - hgt, 0, p.y);
          gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(1, p.c);
          ctx.globalAlpha = a * 0.7; ctx.fillStyle = gr; ctx.fillRect(p.x - w / 2, p.y - hgt, w, hgt); break;
        }
      }
    }
    ctx.globalAlpha = 1;
  }
}
