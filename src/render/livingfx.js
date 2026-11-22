// Living World visuals (render-only; Math.random is fine here). Read-only on the game.
//  - Night: one low-res dark layer with soft holes punched by light sources (heroes, towers, wards, lanterns,
//    Moon Spirits), blitted once per frame. Blood Moon nights run red. Battery / Low: a coarser layer.
//    Reduced effects: no flicker. Dusk and dawn add a brief warm wash.
//  - Breakable walls: boulders / brambles drawn over the painted ground, cracking hit by hit (one cached
//    sprite per wall and damage stage), with chips, dust and debris when they go.
//  - Bodies for the Yokai Parade (leader, followers, tamed band; each map's band, src/data/beasts.js) and the Moon
//    Spirits' glow. The Elder Kami's body is in beastsfx.js.
//  - Event moments: the Elder Kami's landing, a tamed parade, Moonsight, a wall coming down.
import { IMG } from './assets.js';
import { SPR } from './mapgen.js';
import { TEAM_COL, rgba } from './palette.js';
import { P_DEBRIS, P_SPARK, P_GLOW, P_BEAM, glowSprite } from './particles.js';
import { C as CELL, N as GN } from '../sim/world.js';
import { DRAGON_INFO } from '../sim/constants.js';
import { elderName } from '../sim/beasts.js';

const NIGHT = [16, 24, 58], BLOOD = [58, 8, 22];
let holeSpr = null; // soft round hole (alpha falloff), drawn with destination-out
function hole() {
  if (holeSpr) return holeSpr;
  const c = holeSpr = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 2, 32, 32, 32);
  g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(0.55, 'rgba(0,0,0,0.75)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64); return c;
}

export class LivingFx {
  constructor(r) { this.r = r; this.on = false; this.nc = document.createElement('canvas'); this.nx = this.nc.getContext('2d'); this.wallSpr = new Map(); this.hitT = new Map(); }
  attach(game) {
    this.g = game; this.on = !!game.living; this.wallSpr.clear(); this.hitT.clear(); this.warn = null;
  }

  // ───────── ground layer: walls (and the Elder Kami's landing mark) ─────────
  drawGround(ctx, inView) {
    if (!this.on) return;
    const g = this.g, W = g.world, L = g.living, r = this.r;
    for (const w of L.walls) {
      if (w.open) continue;
      const def = W.walls[w.id]; if (!inView(w.x, w.y, 140)) continue;
      const spr = this.wallSprite(w, def);
      let ox = 0;
      const ht = this.hitT.get(w.id); if (ht !== undefined && r.time - ht < 0.18 && r.motion) ox = Math.sin((r.time - ht) * 90) * 2.5;
      ctx.drawImage(spr.c, spr.x + ox, spr.y);
    }
    // warning sigil where the Elder Kami will land (the last 30s before it does), in its colour
    if (this.warn && !g.objectives.boss) {
      const p = L.bossSpot, k = (r.time * 0.8) % 1;
      ctx.save(); ctx.globalAlpha = 0.35 + 0.25 * Math.sin(r.time * 4); ctx.strokeStyle = this.warn; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.ellipse(p.x, p.y, 120, 100, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 0.5 * (1 - k); ctx.beginPath(); ctx.ellipse(p.x, p.y, 120 * k, 100 * k, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
  }
  wallSprite(w, def) {
    const key = w.id + ':' + w.hp; let s = this.wallSpr.get(key); if (s) return s;
    for (const k of this.wallSpr.keys()) if (k.startsWith(w.id + ':')) this.wallSpr.delete(k);
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const i of def.cells) { const x = (i % GN) * CELL, y = ((i / GN) | 0) * CELL; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + CELL); y1 = Math.max(y1, y + CELL); }
    x0 -= 40; y0 -= 60; x1 += 40; y1 += 20;
    const c = document.createElement('canvas'); c.width = x1 - x0; c.height = y1 - y0; const x = c.getContext('2d'); x.imageSmoothingEnabled = false;
    let seed = w.id * 977 + 13; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const dmg = 1 - w.hp / w.max, thicket = w.kind === 'thicket', nat = IMG.TilesetNature;
    // boulders / bushes along the wall's line, two staggered rows across its width, drawn back to front
    const a = def.a, b = def.b, len = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)), ux = (b.x - a.x) / len, uy = (b.y - a.y) / len, nx = -uy, ny = ux;
    const step = thicket ? 20 : 30, items = [];
    for (let d = -10; d <= len + 10; d += step) for (const o of [-15, 15]) {
      const px = a.x + ux * (d + (o > 0 ? step / 2 : 0)) + nx * o + (rnd() - 0.5) * 6, py = a.y + uy * (d + (o > 0 ? step / 2 : 0)) + ny * o + (rnd() - 0.5) * 6;
      const keys = thicket ? ['berryBush', 'bush1', 'bush3', 'berryBush', 'bush2'] : ['rockGBig', 'mossRock', 'rockGTall', 'oreRock', 'rockGBig'];
      items.push({ x: px - x0, y: py - y0, k: keys[Math.floor(rnd() * keys.length)], s: thicket ? 1.5 + rnd() * 0.3 : 1.0 + rnd() * 0.25 });
    }
    items.sort((p, q) => p.y - q.y);
    for (const it of items) {
      const sp = SPR[it.k]; if (!sp || !nat) continue;
      const sw = sp[2] * it.s * (sp[2] <= 16 ? 2 : 1), sh = sp[3] * it.s * (sp[2] <= 16 ? 2 : 1);
      x.fillStyle = 'rgba(10,20,10,0.25)'; x.beginPath(); x.ellipse(it.x, it.y + 4, sw * 0.4, sh * 0.14, 0, 0, Math.PI * 2); x.fill();
      x.drawImage(nat, sp[0], sp[1], sp[2], sp[3], Math.round(it.x - sw / 2), Math.round(it.y - sh * 0.7), Math.round(sw), Math.round(sh));
    }
    // thickets: thorny vines woven through the bushes, so they read as a barrier, not decor
    if (thicket) for (const o of [-14, 0, 14]) {
      x.strokeStyle = '#3a1e2a'; x.lineWidth = 3; x.beginPath();
      for (let d = -10, k = 0; d <= len + 10; d += 12, k++) { const px = a.x + ux * d + nx * (o + (k % 2 ? 5 : -5)) - x0, py = a.y + uy * d + ny * (o + (k % 2 ? 5 : -5)) - y0 - 12; if (k) x.lineTo(px, py); else x.moveTo(px, py); }
      x.stroke();
      x.fillStyle = '#e6d2b0';
      for (let d = -4; d <= len + 4; d += 16) { const px = a.x + ux * d + nx * o - x0, py = a.y + uy * d + ny * o - y0 - 12; x.fillRect(Math.round(px), Math.round(py - 4), 2, 3); x.fillRect(Math.round(px + 3), Math.round(py + 2), 2, 2); }
    }
    // damage: crack lines (walls) or broken, browned branches (thickets) growing with every hit
    const n = Math.round(dmg * items.length * 0.6);
    for (let t = 0; t < n; t++) {
      const it = items[Math.floor(rnd() * items.length)];
      if (thicket) { x.fillStyle = 'rgba(90,70,30,0.55)'; x.beginPath(); x.arc(it.x + (rnd() - 0.5) * 12, it.y - 10 + (rnd() - 0.5) * 8, 5 + rnd() * 4, 0, Math.PI * 2); x.fill(); continue; }
      x.strokeStyle = '#1c1a22'; x.lineWidth = 2; x.beginPath();
      let cx = it.x + (rnd() - 0.5) * 14, cy = it.y - 24 + rnd() * 8; x.moveTo(cx, cy);
      for (let k = 0; k < 3; k++) { cx += (rnd() - 0.5) * 10; cy += 4 + rnd() * 5; x.lineTo(Math.round(cx), Math.round(cy)); }
      x.stroke();
    }
    if (dmg > 0 && !thicket) for (let t = 0; t < n; t++) { x.fillStyle = ['#5d5866', '#7d7888'][t % 2]; x.fillRect(Math.round(items[t % items.length].x + (rnd() - 0.5) * 30), Math.round(items[t % items.length].y + 6 + rnd() * 6), 3, 2); } // rubble
    s = { c, x: x0, y: y0 }; this.wallSpr.set(key, s); return s;
  }

  // ───────── bodies ─────────
  // The parade leader (objective 'yokai'). Returns true when drawn.
  drawBoss(u, x, y, flashing, attacking) {
    const r = this.r, ctx = r.ctx;
    if (u.kind === 'yokai') {
      const img = IMG[r.bf.paradeKey('yokai_lantern')]; if (!img) return true;
      const bob = Math.sin(r.time * 3 + u.id) * 3, walkF = Math.floor(r.time * 6 + u.id) % 4;
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.55 + 0.15 * Math.sin(r.time * 7);
      ctx.drawImage(glowSprite('#ffb347'), x - 40, y - 70, 80, 80); ctx.restore();
      r.drawSheetFrame(img, 16, 16, u.facing, walkF, x, y + 2 + bob, 3.0);
      return true;
    }
    return false;
  }
  // Tamed yokai (summon 'yokai'): the parade's sprites with a team-coloured aura.
  drawTamed(u, x, y, moving) {
    const r = this.r, ctx = r.ctx, img = IMG[r.bf.paradeKey(u.look)]; if (!img) return;
    const big = u.look === 'yokai_lantern', bob = Math.sin(r.time * 4 + u.id) * 2;
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.45;
    ctx.drawImage(glowSprite(TEAM_COL[u.team]), x - 28, y - 44, 56, 56); ctx.restore();
    r.drawSheetFrame(img, 16, 16, u.facing, moving ? Math.floor(r.time * 8 + u.id) % 4 : 0, x, y + 3 + bob, big ? 2.6 : 1.9);
  }
  // Moon Spirits and parade followers glow (under the sprite).
  glow(u, x, y) {
    const ctx = this.r.ctx, c = u.kind === 'camp_moon' || u.kind === 'camp_wisp' ? '#9fe4ff' : u.parade ? '#ffb347' : null; if (!c) return;
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.4 + 0.15 * Math.sin(this.r.time * 4 + u.id);
    const s = u.big ? 70 : 44; ctx.drawImage(glowSprite(c), x - s / 2, y - s * 0.75, s, s); ctx.restore();
  }

  // ───────── night (screen space, after fog and weather) ─────────
  drawNight(dt) {
    if (!this.on) return;
    const g = this.g, L = g.living, k = L.nightK, r = this.r;
    const t = g.time, dusk = t > 330 && t < 380 ? 1 - Math.abs(t - 355) / 25 : t > 520 && t < 570 ? 1 - Math.abs(t - 545) / 25 : 0;
    if (k <= 0.01 && dusk <= 0) return;
    const ctx = r.ctx, W = r.W, H = r.H;
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (dusk > 0) { ctx.globalAlpha = 0.16 * dusk; ctx.fillStyle = '#ff8a4a'; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
    if (k > 0.01) {
      const q = r.detail === 0 ? 8 : 4, nw = Math.ceil(W / q), nh = Math.ceil(H / q);
      if (this.nc.width !== nw || this.nc.height !== nh) { this.nc.width = nw; this.nc.height = nh; }
      const x = this.nx, col = g.event === 'bloodmoon' ? BLOOD : NIGHT, own = g.teams[r.viewTeam >= 0 ? r.viewTeam : 0];
      x.globalCompositeOperation = 'source-over'; x.clearRect(0, 0, nw, nh);
      x.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},${(0.6 * k).toFixed(3)})`; x.fillRect(0, 0, nw, nh);
      // Moonsight: the team's own view stays clearer
      if (own && own.moonUntil > g.tick && r.viewTeam >= 0) { x.fillStyle = 'rgba(0,0,0,0)'; x.globalCompositeOperation = 'destination-out'; x.globalAlpha = 0.45; x.fillRect(0, 0, nw, nh); x.globalAlpha = 1; }
      x.globalCompositeOperation = 'destination-out';
      const s = r.scale / q, cx = r.cam.x, cy = r.cam.y, hs = hole(), flick = r.motion ? 1 : 0;
      const light = (px, py, rad, a = 1) => {
        const sx = (px - cx) * s + nw / 2, sy = (py - cy) * s + nh / 2, rr = rad * s;
        if (sx < -rr || sy < -rr || sx > nw + rr || sy > nh + rr) return;
        x.globalAlpha = a; x.drawImage(hs, sx - rr, sy - rr, rr * 2, rr * 2);
      };
      for (const u of g.units) {
        if (!u.alive && !u.structure) continue;
        if (u.structure) { if (u.alive) light(u.x, u.y - 30, u.type === 'nexus' ? 260 : 170, 0.9); continue; }
        if (!r.visible(u)) continue;
        if (u.type === 'hero') light(u.x, u.y - 12, u.team === r.viewTeam || r.viewTeam < 0 ? 175 : 110, 0.95);
        else if (u.type === 'objective') light(u.x, u.y - 30, u.kind === 'yokai' ? 150 + flick * 8 * Math.sin(r.time * 9) : 220, 1);
        else if (u.type === 'mob' && (u.moon || u.parade || u.kind === 'camp_wisp')) light(u.x, u.y - 10, u.big ? 130 : 80, 0.9);
        else if (u.type === 'summon') light(u.x, u.y - 10, 110, 0.85);
        else if (u.type === 'minion' && (u.team === r.viewTeam || r.viewTeam < 0)) light(u.x, u.y, 60, 0.5);
      }
      for (const w of g.wards) if (w.until > g.tick && (w.team === r.viewTeam || r.viewTeam < 0)) light(w.x, w.y, 120, 0.7);
      for (const sh of g.shrines) light(sh.x, sh.y, sh.owner >= 0 ? 160 : 100, 0.8);
      for (let tm = 0; tm < 2; tm++) light(g.world.fountain[tm].x, g.world.fountain[tm].y, 320, 1);
      x.globalAlpha = 1; x.globalCompositeOperation = 'source-over';
      ctx.imageSmoothingEnabled = true; ctx.drawImage(this.nc, 0, 0, nw, nh, 0, 0, W, H); ctx.imageSmoothingEnabled = false;
    }
    ctx.restore();
  }

  // ───────── moments ─────────
  fxHit(f) { // sim fx 'wallHit'
    const r = this.r; this.hitT.set(f.wall, r.time);
    if (!r.onScreen(f.x, f.y, 80)) return;
    const w = this.g.living.walls[f.wall], c = w && w.kind === 'thicket' ? ['#2f5a2a', '#467a38', '#6b6234'] : ['#5d5866', '#7d7888', '#9b97a6'];
    for (let k = 0; k < 6; k++) { const q = r.fxp.spawn(P_DEBRIS, f.x + (Math.random() - 0.5) * 30, f.y - 10, 0.8); q.vx = (Math.random() - 0.5) * 160; q.vy = -120 - Math.random() * 120; q.g = 600; q.c = c[k % 3]; q.s = 2 + (k % 2); q.ground = f.y + 8; }
    r.puff(f.x, f.y - 6, 6, 22, 'rgba(200,190,170,0.6)', 0.5);
    r.shakeBy(0.06, 0.2);
  }
  event(e) {
    const r = this.r, g = this.g;
    switch (e.type) {
      case 'wall': {
        const def = g.world.walls[e.wall]; if (!def || !r.onScreen(e.x, e.y, 200)) break;
        const thicket = e.kind === 'thicket', cols = thicket ? ['#2f5a2a', '#467a38', '#c8406a'] : ['#5d5866', '#7d7888', '#9b97a6'];
        let n = 0;
        for (const i of def.cells) {
          if (n++ % 2) continue;
          const px = (i % GN) * CELL + CELL / 2, py = ((i / GN) | 0) * CELL + CELL / 2;
          for (let k = 0; k < 3; k++) { const q = r.fxp.spawn(P_DEBRIS, px, py - 10, 1.2); q.vx = (Math.random() - 0.5) * 220; q.vy = -150 - Math.random() * 200; q.g = 650; q.c = cols[k]; q.s = 3 + (k % 2); q.ground = py + 10; }
          r.puff(px, py - 6, 8, 34, thicket ? 'rgba(150,170,110,0.55)' : 'rgba(210,200,180,0.7)', 1.0, (Math.random() - 0.5) * 30, -10);
        }
        r.text(e.x, e.y - 50, thicket ? 'THICKET CLEARED' : 'WALL BROKEN', '#e8dcc0', 11, 1.4, 'pop');
        r.shakeBy(thicket ? 0.15 : 0.35);
        break;
      }
      case 'bossSoon': this.warn = (DRAGON_INFO[e.kami] || { color: '#ff4a5a' }).color; break;
      case 'spawn': {
        if (e.obj === 'boss') {
          this.warn = null;
          // the Elder's landing: a dark wash, a beam in its colour, debris and a shockwave (seen from anywhere: it's the map centre)
          const c = (DRAGON_INFO[e.element] || { color: '#ff4a5a' }).color;
          r.screenTint('#100818', 0.35, 1.2); r.shakeBy(0.8, 1); r.impact(0.2, 0.06);
          if (r.onScreen(e.x, e.y, 400)) {
            const b = r.fxp.spawn(P_BEAM, e.x, e.y + 10, 1.8); b.s = 140; b.s2 = 600; b.c = rgba(c, 0.9);
            for (let k = 0; k < 4; k++) r.ring(e.x, e.y, 20, 260 + k * 90, k ? c : '#ffffff', 1.1, 7 - k, k * 0.12);
            for (let k = 0; k < 26; k++) { const a = Math.random() * 6.283, sp = 120 + Math.random() * 260, q = r.fxp.spawn(P_DEBRIS, e.x, e.y - 60, 1.6); q.vx = Math.cos(a) * sp; q.vy = -160 - Math.random() * 220; q.g = 420; q.c = k % 3 ? '#2a2630' : '#5a4a3a'; q.s = 3 + (k % 3); q.ground = e.y + Math.sin(a) * 50; }
            r.text(e.x, e.y - 190, `THE ${elderName(e.element).toUpperCase()} DESCENDS`, c, 16, 2.2, 'crit');
          }
        }
        break;
      }
      case 'tamed': {
        if (!r.onScreen(e.x, e.y, 200)) break;
        r.ring(e.x, e.y, 10, 140, TEAM_COL[e.team], 0.9, 5); r.ring(e.x, e.y, 10, 90, '#ffb347', 0.7, 3, 0.15);
        for (let k = 0; k < 14; k++) { const q = r.fxp.spawn(P_GLOW, e.x + (Math.random() - 0.5) * 80, e.y - 20 - Math.random() * 50, 1.1); q.vy = -60 - Math.random() * 60; q.c = '#ffb347'; q.s = 8 + Math.random() * 6; q.t = -Math.random() * 0.3; }
        r.text(e.x, e.y - 90, 'TAMED!', TEAM_COL[e.team], 14, 1.6, 'crit');
        break;
      }
      case 'moonsight': {
        if (!r.onScreen(e.x, e.y, 200)) break;
        r.ring(e.x, e.y, 10, 120, '#9fe4ff', 0.9, 4);
        for (let k = 0; k < 12; k++) { const q = r.fxp.spawn(P_SPARK, e.x + (Math.random() - 0.5) * 70, e.y - Math.random() * 40, 0.9); q.vy = -90 - Math.random() * 70; q.c = '#c6f2ff'; q.s = 0.8; q.t = -Math.random() * 0.3; }
        r.text(e.x, e.y - 70, 'MOONSIGHT', '#9fe4ff', 12, 1.5, 'pop');
        break;
      }
      case 'dusk': for (const c of g.camps) if (c.night && r.onScreen(c.x, c.y, 200)) { r.ring(c.x, c.y, 10, 110, '#9fe4ff', 1, 4); const b = r.fxp.spawn(P_BEAM, c.x, c.y + 6, 1.2); b.s = 50; b.s2 = 260; b.c = 'rgba(159,228,255,0.8)'; } break;
    }
  }
}
