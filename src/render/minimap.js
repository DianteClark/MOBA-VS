// Minimap: terrain thumbnail + structures, heroes (portraits), minions, objectives, wards, camera box.
import { S as MAP_SIZE } from '../sim/world.js';
import { IMG } from './assets.js';
import { TEAM_COL } from './renderer.js';
import { DRAGON_INFO } from '../sim/constants.js';

export class Minimap {
  constructor(canvas, renderer) {
    this.c = canvas; this.ctx = canvas.getContext('2d'); this.r = renderer;
    this.size = 0; this.bg = null; this.pings = [];
  }
  resize() {
    const r = this.c.getBoundingClientRect();
    if (r.width < 2 || !this.r.map) return;
    const dpr = Math.min(1.5, window.devicePixelRatio || 1), w = Math.round(r.width * dpr), hh = Math.round(r.height * dpr);
    if (this.bg && w === this.c.width && hh === this.c.height && this.bgMap === this.r.map) return;
    this.c.width = w; this.c.height = hh; this.bgMap = this.r.map;
    this.size = this.c.width;
    const b = document.createElement('canvas'); b.width = b.height = this.size;
    const x = b.getContext('2d'); x.imageSmoothingEnabled = true; x.drawImage(this.r.map, 0, 0, this.size, this.size);
    x.fillStyle = 'rgba(0,0,0,0.15)'; x.fillRect(0, 0, this.size, this.size);
    this.bg = b;
  }
  ping(x, y, color) { this.pings.push({ x, y, color, t: performance.now() }); }
  toWorld(px, py) { const r = this.c.getBoundingClientRect(); return { x: (px - r.left) / r.width * MAP_SIZE, y: (py - r.top) / r.height * MAP_SIZE }; }
  draw() {
    if (!this.bg || this.c.clientWidth !== this._cw) { this._cw = this.c.clientWidth; this.resize(); }
    if (!this.bg) return;
    const ctx = this.ctx, S = this.size, k = S / MAP_SIZE, g = this.r.game; if (!g) return;
    // the dots move slowly: ~15 redraws a second are plenty, except while the camera box moves or a ping animates
    const cam = this.r.cam, now0 = performance.now(), camKey = cam.x + cam.y * 7919 + cam.zoom * 104729;
    if (camKey === this._camKey && !this.pings.length && now0 - (this._drawn || 0) < 66) return;
    this._camKey = camKey; this._drawn = now0;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.bg, 0, 0);
    const vis = (u) => this.r.visible(u);
    // objectives
    for (const key of ['dragon', 'baron', 'herald']) {
      const o = g.objectives[key];
      const pit = key === 'dragon' ? g.world.pits.kami : g.world.pits.kraken;
      ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 1;
      if (o && o.alive) {
        // live boss: its portrait (each Kami element has its own) in a ring of its colour
        const r = S * 0.04, img = IMG[key === 'dragon' ? 'kami_' + o.element : key + '_faceset'];
        ctx.fillStyle = key === 'dragon' ? DRAGON_INFO[o.element].color : key === 'baron' ? '#b56cff' : '#9fd0ff';
        ctx.beginPath(); ctx.arc(pit.x * k, pit.y * k, r + 1.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        if (img) { ctx.save(); ctx.beginPath(); ctx.arc(pit.x * k, pit.y * k, r, 0, Math.PI * 2); ctx.clip(); ctx.drawImage(img, 3, 3, 32, 32, pit.x * k - r, pit.y * k - r, r * 2, r * 2); ctx.restore(); }
      }
    }
    // shrines
    for (const sh of g.shrines) {
      ctx.fillStyle = sh.owner >= 0 ? TEAM_COL[sh.owner] : '#ffe9a8'; ctx.strokeStyle = '#000'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(sh.x * k, sh.y * k - S * 0.022); ctx.lineTo(sh.x * k + S * 0.016, sh.y * k); ctx.lineTo(sh.x * k, sh.y * k + S * 0.022); ctx.lineTo(sh.x * k - S * 0.016, sh.y * k); ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    // structures
    for (const u of g.units) if (u.structure) {
      const s = u.type === 'nexus' ? S * 0.03 : S * 0.018;
      ctx.fillStyle = u.alive ? TEAM_COL[u.team] : 'rgba(80,80,80,0.6)';
      ctx.fillRect(u.x * k - s / 2, u.y * k - s / 2, s, s);
      if (u.alive) { ctx.strokeStyle = '#000'; ctx.strokeRect(u.x * k - s / 2, u.y * k - s / 2, s, s); }
    }
    // wards
    for (const w of g.wards) if (w.until > g.tick && (w.team === this.r.viewTeam || this.r.viewTeam < 0 || !this.r.fogOn)) { ctx.fillStyle = '#fff6a0'; ctx.fillRect(w.x * k - 1.5, w.y * k - 1.5, 3, 3); }
    // minions & mobs
    for (const u of g.units) {
      if (!u.alive || u.structure || u.type === 'hero') continue;
      if (!vis(u)) continue;
      if (u.type === 'mob') { ctx.fillStyle = '#e8c45a'; ctx.fillRect(u.x * k - 1.5, u.y * k - 1.5, 3, 3); continue; }
      if (u.type === 'objective') continue;
      ctx.fillStyle = TEAM_COL[u.team];
      const s = u.type === 'summon' ? 6 : 2.5;
      ctx.fillRect(u.x * k - s / 2, u.y * k - s / 2, s, s);
    }
    // heroes
    const r = S * 0.045;
    for (const t of g.teams) for (const h of t.heroes) {
      if (!h.alive) continue;
      let x = h.x, y = h.y, ghost = false;
      if (!vis(h)) {
        const ls = this.r.viewTeam >= 0 ? g.lastSeen[this.r.viewTeam][h.id] : null;
        if (!ls || g.tick - ls.t > 20 * 8) continue;
        x = ls.x; y = ls.y; ghost = true;
      }
      ctx.globalAlpha = ghost ? 0.4 : 1;
      ctx.save(); ctx.beginPath(); ctx.arc(x * k, y * k, r, 0, Math.PI * 2); ctx.closePath();
      ctx.fillStyle = '#000'; ctx.fill(); ctx.clip();
      const f = IMG['face_' + h.heroId]; if (f) ctx.drawImage(f, 4, 4, 30, 30, x * k - r, y * k - r, r * 2, r * 2);
      ctx.restore();
      ctx.strokeStyle = TEAM_COL[h.team]; ctx.lineWidth = Math.max(1.5, S / 120);
      ctx.beginPath(); ctx.arc(x * k, y * k, r, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // pings
    const now = performance.now();
    this.pings = this.pings.filter((p) => now - p.t < 2500);
    for (const p of this.pings) {
      const a = (now - p.t) / 2500;
      ctx.strokeStyle = p.color; ctx.globalAlpha = 1 - a; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(p.x * k, p.y * k, 4 + a * S * 0.08, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // camera rect
    const rr = this.r, s = rr.scale, vw = rr.W / s, vh = rr.H / s;
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
    ctx.strokeRect((rr.cam.x - vw / 2) * k, (rr.cam.y - vh / 2) * k, vw * k, vh * k);
  }
}
