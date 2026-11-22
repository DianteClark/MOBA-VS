// Terrain visuals for the v25 maps (render-only; Math.random is fine here). Read-only on the game (src/sim/terrain.js).
//  - The tide: floodwater rises over the flats and the channel deepens (alpha follows the sim's 20s warning, so the
//    water visibly creeps in before it counts); sandbars go under; log rafts drift in from the banks and lie across
//    the channel at high tide. Marker poles at every crossing.
//  - The wind: cloud bridges that thicken in and fray out with the wind's 6s fade, rope rails, pennants at the
//    anchors pointing the way the wind blows. Slow mist drifts over the void.
//  - Jump pads: a glowing ring with chevrons toward the far pad; a flight lifts the hero on an arc with a trail,
//    dust and a ring at launch and landing.
//  - The minimap: open crossings and the pads.
// Reduced effects: no bobbing, flicker or drifting mist (states still read the same).
import { glowSprite } from './particles.js';
import { C as CELL, N as GN, T_SAND, T_RIVER } from '../sim/world.js';
import { TERRAIN } from '../sim/terrain.js';
import { TICK_RATE } from '../sim/constants.js';

const B = 240, NB = Math.ceil(2400 / B);
const smooth = (x) => { const k = Math.max(0, Math.min(1, x)); return k * k * (3 - 2 * k); };

export class TerrainFx {
  constructor(r) { this.r = r; this.on = false; }
  attach(game) {
    this.g = game; this.on = !!game.terrain; if (!this.on) return;
    const W = game.world;
    // flood cells, bucketed: sand flats (rise to full water) and the channel (deepens)
    this.sand = Array.from({ length: NB * NB }, () => []); this.chan = Array.from({ length: NB * NB }, () => []);
    for (let i = 0; i < GN * GN; i++) {
      const t = W.type[i]; if (t !== T_SAND && t !== T_RIVER) continue;
      if (W.gateAt && W.gateAt[i] >= 0) continue; // the crossings draw themselves
      const x = (i % GN) * CELL + CELL / 2, y = ((i / GN) | 0) * CELL + CELL / 2;
      (t === T_SAND ? this.sand : this.chan)[((y / B) | 0) * NB + ((x / B) | 0)].push(x, y);
    }
    // crossings: geometry for the live drawing
    this.gates = W.gates.map((w) => {
      const dx = w.b.x - w.a.x, dy = w.b.y - w.a.y, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len;
      const cells = []; for (const i of w.cells) cells.push((i % GN) * CELL + CELL / 2, ((i / GN) | 0) * CELL + CELL / 2);
      return { id: w.id, kind: w.kind, a: w.a, b: w.b, len, ux, uy, nx: -uy, ny: ux, cells, x: w.x, y: w.y };
    });
    this.mist = null;
  }

  // ── state, as the sim will have it (0 = closed / low, 1 = open / high), eased through the warning window ──
  tideLevel(t) {
    const T = TERRAIN.tide; let k = 0;
    for (const [a, b] of T.high) k = Math.max(k, Math.min(smooth((t - (a - T.warn)) / T.warn), 1 - smooth((t - (b - T.warn)) / T.warn)));
    return k;
  }
  gateLevel(G, t) {
    if (G.kind === 'bar') return 1 - this.tideLevel(t);
    if (G.kind === 'raft') return this.tideLevel(t);
    const P = TERRAIN.wind.period, w = TERRAIN.wind.warn, ph = Math.floor(t / P) % 2, into = t - Math.floor(t / P) * P, mine = G.kind === 'windA' ? 0 : 1;
    if (ph === mine) return into > P - w ? 1 - smooth((into - (P - w)) / w) * 0.85 : 1; // fraying (it holds until the switch)
    return into > P - w ? smooth((into - (P - w)) / w) * 0.6 : 0; // gathering
  }
  isOpen(G) { return !!((this.g.world.gateMask >> G.id) & 1); }

  // ── ground layer (after the map, under units) ──
  drawGround(ctx, inView, x0, y0, vw, vh) {
    if (!this.on) return;
    const g = this.g, r = this.r, t = g.time + (r._alphaNow || 0) / TICK_RATE;
    if (g.terrain.tide) this.drawTide(ctx, t, x0, y0, vw, vh, inView);
    for (const G of this.gates) if (G.kind === 'windA' || G.kind === 'windB') { if (inView(G.x, G.y, G.len / 2 + 80)) this.drawBridge(ctx, G, t); }
    if (g.world.pads.length) this.drawPads(ctx, inView);
    if (g.terrain.wind) this.drawMist(ctx, x0, y0, vw, vh);
  }
  each(grid, x0, y0, vw, vh, fn) {
    const bx0 = Math.max(0, Math.floor((x0 - 30) / B)), by0 = Math.max(0, Math.floor((y0 - 30) / B)), bx1 = Math.min(NB - 1, Math.floor((x0 + vw + 30) / B)), by1 = Math.min(NB - 1, Math.floor((y0 + vh + 30) / B));
    for (let by = by0; by <= by1; by++) for (let bx = bx0; bx <= bx1; bx++) { const L = grid[by * NB + bx]; for (let k = 0; k < L.length; k += 2) fn(L[k], L[k + 1]); }
  }
  drawTide(ctx, t, x0, y0, vw, vh, inView) {
    const r = this.r, k = this.tideLevel(t), mo = r.motion;
    if (k > 0.01) {
      // flats: water blobs (overlapping circles read as one sheet), a lighter rim, slow ripples
      ctx.save(); ctx.globalAlpha = 0.62 * k; ctx.fillStyle = '#3fa7c4';
      ctx.beginPath(); this.each(this.sand, x0, y0, vw, vh, (x, y) => { ctx.moveTo(x + 15, y); ctx.arc(x, y, 15, 0, Math.PI * 2); }); ctx.fill();
      ctx.globalAlpha = 0.22 * k; ctx.fillStyle = '#1d5f8c';
      ctx.beginPath(); this.each(this.chan, x0, y0, vw, vh, (x, y) => { ctx.moveTo(x + 14, y); ctx.arc(x, y, 14, 0, Math.PI * 2); }); ctx.fill();
      if (mo) { ctx.globalAlpha = 0.35 * k; ctx.fillStyle = '#d6f6fb'; this.each(this.sand, x0, y0, vw, vh, (x, y) => { const v = Math.sin(t * 1.7 + x * 0.05 + y * 0.03); if (v > 0.8) ctx.fillRect(Math.round(x - 5), Math.round(y + (v - 0.9) * 20), 10, 2); }); }
      ctx.restore();
    }
    for (const G of this.gates) {
      if (G.kind !== 'bar' && G.kind !== 'raft') continue;
      if (!inView(G.x, G.y, G.len / 2 + 80)) continue;
      const lv = this.gateLevel(G, t);
      if (G.kind === 'bar') {
        // the sandbar goes under: deep water over it as the tide comes in
        const wk = 1 - lv;
        if (wk > 0.01) {
          ctx.save(); ctx.globalAlpha = Math.min(0.92, wk * 1.05);
          ctx.fillStyle = '#c4f3f7'; ctx.beginPath(); for (let i = 0; i < G.cells.length; i += 2) { ctx.moveTo(G.cells[i] + 17, G.cells[i + 1]); ctx.arc(G.cells[i], G.cells[i + 1], 17, 0, Math.PI * 2); } ctx.fill(); // foam rim
          ctx.fillStyle = '#226a99'; ctx.beginPath(); for (let i = 0; i < G.cells.length; i += 2) { ctx.moveTo(G.cells[i] + 14, G.cells[i + 1]); ctx.arc(G.cells[i], G.cells[i + 1], 14, 0, Math.PI * 2); } ctx.fill();
          ctx.restore();
        }
      } else this.drawRaft(ctx, G, lv, t);
      this.poles(ctx, G, G.kind === 'bar' ? lv : lv, t);
    }
  }
  // log raft: logs across the channel at high tide, beached on both banks at low tide (they drift between)
  drawRaft(ctx, G, lv, t) {
    const n = Math.max(4, Math.floor(G.len / 11)), half = 30, mo = this.r.motion;
    for (let i = 0; i < n; i++) {
      const f = (i + 0.5) / n, side = f < 0.5 ? 0 : 1;
      // laid: spread along the crossing; beached: stacked tight against its own bank
      const lx = G.a.x + G.ux * G.len * f, ly = G.a.y + G.uy * G.len * f;
      const bf = side ? 1 - (1 - f) * 0.35 : f * 0.35, bx = G.a.x + G.ux * G.len * bf + G.nx * 46, by = G.a.y + G.uy * G.len * bf + G.ny * 46;
      const x = bx + (lx - bx) * lv, y = by + (ly - by) * lv + (mo && lv > 0.2 ? Math.sin(t * 2.2 + i) * 1.3 : 0);
      ctx.save(); ctx.translate(Math.round(x), Math.round(y)); ctx.rotate(Math.atan2(G.ny, G.nx));
      ctx.fillStyle = 'rgba(10,30,50,0.25)'; ctx.fillRect(-half, 3, half * 2, 6);
      ctx.fillStyle = i % 2 ? '#8c6a46' : '#a07a50'; ctx.fillRect(-half, -4, half * 2, 9);
      ctx.fillStyle = '#c9a272'; ctx.fillRect(-half, -4, half * 2, 2);
      ctx.fillStyle = '#5e4630'; ctx.fillRect(-half, -4, 3, 9); ctx.fillRect(half - 3, -4, 3, 9);
      ctx.restore();
    }
    if (lv > 0.5) { // rope ties along both edges
      ctx.save(); ctx.globalAlpha = (lv - 0.5) * 2; ctx.strokeStyle = '#d8c08a'; ctx.lineWidth = 1.5;
      for (const s of [-24, 24]) { ctx.beginPath(); ctx.moveTo(G.a.x + G.nx * s, G.a.y + G.ny * s); ctx.lineTo(G.b.x + G.nx * s, G.b.y + G.ny * s); ctx.stroke(); }
      ctx.restore();
    }
  }
  // red-and-white marker poles at both ends of a tide crossing; a lamp on top glows while it is open
  poles(ctx, G, lv, t) {
    for (const e of [G.a, G.b]) for (const s of [-30, 30]) {
      const x = Math.round(e.x + G.nx * s), y = Math.round(e.y + G.ny * s);
      ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(x - 3, y + 1, 7, 3);
      ctx.fillStyle = '#f2efe6'; ctx.fillRect(x - 2, y - 22, 4, 23);
      ctx.fillStyle = '#d2453a'; ctx.fillRect(x - 2, y - 22, 4, 5); ctx.fillRect(x - 2, y - 12, 4, 5);
      const on = lv > 0.5, blink = !on && lv > 0.05 && this.r.motion && Math.sin(t * 8) > 0;
      ctx.fillStyle = on ? '#9dffb0' : blink ? '#ffd36a' : '#6c3a34'; ctx.fillRect(x - 3, y - 27, 6, 5);
    }
  }
  // wind bridge: cloud puffs along the span with rope rails; pennants on the anchors
  drawBridge(ctx, G, t) {
    const lv = this.gateLevel(G, t), mo = this.r.motion, open = this.isOpen(G);
    if (lv > 0.02) {
      const n = Math.max(5, Math.floor(G.len / 14));
      ctx.save();
      const fray = open && lv < 1 && mo ? 0.6 + 0.4 * Math.sin(t * 18) : 1;
      for (let i = 0; i <= n; i++) {
        const f = i / n, wob = mo ? Math.sin(t * 2 + i * 1.3) * 3 : 0;
        const x = G.a.x + G.ux * G.len * f + G.nx * wob, y = G.a.y + G.uy * G.len * f + G.ny * wob, rr = 20 + (i % 3) * 4;
        ctx.globalAlpha = Math.min(1, lv * 1.1) * fray * (0.75 + 0.25 * ((i * 7) % 3) / 2);
        ctx.fillStyle = 'rgba(120,150,200,0.35)'; ctx.beginPath(); ctx.ellipse(x, y + 8, rr, rr * 0.45, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#f6fbff'; ctx.beginPath(); ctx.ellipse(x, y, rr, rr * 0.6, 0, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = Math.min(1, lv) * fray; ctx.strokeStyle = '#c9a26a'; ctx.lineWidth = 2;
      for (const s of [-26, 26]) { ctx.beginPath(); ctx.moveTo(G.a.x + G.nx * s, G.a.y + G.ny * s - 10); ctx.quadraticCurveTo(G.x + G.nx * s, G.y + G.ny * s, G.b.x + G.nx * s, G.b.y + G.ny * s - 10); ctx.stroke(); }
      ctx.restore();
    }
    // anchors: two posts per end with a pennant (streaming while the bridge is up, limp while it is down)
    for (const e of [G.a, G.b]) for (const s of [-26, 26]) {
      const x = Math.round(e.x + G.nx * s), y = Math.round(e.y + G.ny * s);
      ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(x - 3, y + 1, 7, 3);
      ctx.fillStyle = '#7a5a3a'; ctx.fillRect(x - 2, y - 24, 4, 25);
      const wave = mo ? Math.sin(t * 9 + x) * 2 : 0, flag = open ? '#7fd8ff' : '#9aa3b5', len = open ? 14 : 6;
      ctx.fillStyle = flag; ctx.beginPath(); ctx.moveTo(x + 2, y - 24); ctx.lineTo(x + 2 + len, y - 21 + wave); ctx.lineTo(x + 2, y - 17); ctx.closePath(); ctx.fill();
    }
  }
  // jump pads: a glowing ring and chevrons that point at the far pad
  drawPads(ctx, inView) {
    const r = this.r, t = r.time, mo = r.motion;
    for (const pd of this.g.world.pads) for (const [p, q] of [[pd.a, pd.b], [pd.b, pd.a]]) {
      if (!inView(p.x, p.y, 80)) continue;
      const a = Math.atan2(q.y - p.y, q.x - p.x), pulse = mo ? 0.5 + 0.5 * Math.sin(t * 4) : 0.7;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.35 + 0.25 * pulse; ctx.drawImage(glowSprite('#7fe9ff'), p.x - 40, p.y - 30, 80, 60);
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
      ctx.fillStyle = '#5a6a8a'; ctx.beginPath(); ctx.ellipse(p.x, p.y, 26, 15, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#c8d4ee'; ctx.beginPath(); ctx.ellipse(p.x, p.y - 2, 24, 13, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#3fd0ff'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.ellipse(p.x, p.y - 2, 17, 9, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#ffffff';
      for (let k = 0; k < 3; k++) {
        const d = -8 + k * 8 + (mo ? ((t * 14) % 8) : 0), cx = p.x + Math.cos(a) * d, cy = p.y - 2 + Math.sin(a) * d * 0.55, c = Math.cos(a), s = Math.sin(a) * 0.55;
        ctx.globalAlpha = 0.4 + k * 0.25; ctx.beginPath(); ctx.moveTo(cx + c * 5, cy + s * 5); ctx.lineTo(cx - c * 2 - s * 5, cy - s * 2 + c * 5 * 0.55); ctx.lineTo(cx - c * 2 + s * 5, cy - s * 2 - c * 5 * 0.55); ctx.closePath(); ctx.fill();
      }
      ctx.restore();
    }
  }
  // slow mist banks drifting over the void (a few big soft sprites; static with Reduced effects)
  drawMist(ctx, x0, y0, vw, vh) {
    const r = this.r; if (r.detail === 0) return;
    if (!this.mist) { this.mist = []; for (let k = 0; k < 14; k++) this.mist.push({ x: Math.random() * 2400, y: Math.random() * 2400, s: 220 + Math.random() * 260, v: 6 + Math.random() * 8 }); }
    const dt = r.motion ? r._dt || 0 : 0;
    ctx.save(); ctx.globalAlpha = 0.16;
    for (const m of this.mist) {
      m.x += m.v * dt; if (m.x > 2600) m.x = -200;
      if (m.x + m.s < x0 || m.x - m.s > x0 + vw || m.y + m.s < y0 || m.y - m.s > y0 + vh) continue;
      ctx.drawImage(glowSprite('#ffffff'), m.x - m.s / 2, m.y - m.s * 0.3, m.s, m.s * 0.6);
    }
    ctx.restore();
  }

  // ── a hero's flight (renderer.drawUnit): height above the ground, a smooth arc ──
  lift(u, tk) {
    const d = u.dash; if (!d || !d.pad) return 0;
    const p = Math.max(0, Math.min(1, (tk - d.t0) / Math.max(1, d.t1 - d.t0)));
    return 4 * p * (1 - p) * Math.min(110, 40 + Math.hypot(d.x - d.from.x, d.y - d.from.y) * 0.18);
  }
  // sim fx 'pad' / 'padLand'
  fx(f) {
    const r = this.r; if (!r.onScreen(f.x, f.y, 120)) return;
    if (f.kind === 'pad') {
      r.ring(f.x, f.y, 8, 60, '#7fe9ff', 0.5, 3); r.puff(f.x, f.y, 6, 26, 'rgba(230,240,255,0.7)', 0.5, 0, -20);
      if (r.motion) for (let k = 0; k < 6; k++) r.puff(f.x + (Math.random() - 0.5) * 30, f.y + 4, 3, 14, 'rgba(255,255,255,0.6)', 0.6, (Math.random() - 0.5) * 80, -30 - Math.random() * 30);
    } else {
      r.ring(f.x, f.y, 10, 70, '#ffffff', 0.45, 3); r.puff(f.x, f.y, 8, 34, 'rgba(230,240,255,0.65)', 0.5);
      r.shakeBy(0.05, 0.15);
    }
  }
}

// The minimap: open crossings as bright strokes (sand, wood, cloud), pads as rings joined by a dotted line.
export function drawTerrainMini(ctx, g, k, S) {
  const W = g.world;
  ctx.save(); ctx.lineCap = 'round';
  for (const w of W.gates) {
    const open = (W.gateMask >> w.id) & 1; if (!open) continue;
    ctx.strokeStyle = w.kind === 'bar' ? '#f2dfa6' : w.kind === 'raft' ? '#b08350' : '#ffffff'; ctx.lineWidth = Math.max(2.5, S / 60);
    ctx.beginPath(); ctx.moveTo(w.a.x * k, w.a.y * k); ctx.lineTo(w.b.x * k, w.b.y * k); ctx.stroke();
  }
  ctx.setLineDash([2, 3]); ctx.strokeStyle = 'rgba(127,233,255,0.8)'; ctx.lineWidth = 1;
  for (const p of W.pads) { ctx.beginPath(); ctx.moveTo(p.a.x * k, p.a.y * k); ctx.lineTo(p.b.x * k, p.b.y * k); ctx.stroke(); }
  ctx.setLineDash([]); ctx.strokeStyle = '#7fe9ff'; ctx.lineWidth = 1.5;
  for (const p of W.pads) for (const q of [p.a, p.b]) { ctx.beginPath(); ctx.arc(q.x * k, q.y * k, Math.max(2, S * 0.012), 0, Math.PI * 2); ctx.stroke(); }
  ctx.restore();
}
