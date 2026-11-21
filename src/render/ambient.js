// Ambient life per map theme (render-only, Math.random is fine here). Everything is culled to the view and
// sized to stay cheap on phones: static spots are bucketed once per map, moving critters live in small pools.
//  ground layer: water shimmer + ripples, swaying flowers, team flags at the bases, frogs (marsh), jumping fish
//  air layer:    falling petals / leaves / snow motes, fireflies (marsh, autumn dusk), butterflies (spring), bird flocks
// Detail: Low quality draws only the flags; Auto-medium and Reduced effects halve the counts.
import { IMG, AMB, recolor } from './assets.js';
import { glowSprite } from './particles.js';
import { S, C, N, T_RIVER, T_GRASS } from '../sim/world.js';
import { settings } from '../ui/settings.js';

const B = 240, NB = Math.ceil(S / B); // bucket size for static spots
const LEAVES = { spring: ['leafpink', 'leafpink', 'leaf'], autumn: ['leafgold', 'leafgold', 'leaf'], winter: ['snow'], marsh: [], desert: [], ruins: ['leaf', 'leaf', 'leafgold'] };

export class Ambient {
  constructor(r) { this.r = r; this.world = null; }
  attach(world, theme) {
    this.world = world; this.theme = theme; this.key = world.def.theme || 'spring';
    this.water = Array.from({ length: NB * NB }, () => []); this.flowers = Array.from({ length: NB * NB }, () => []); this.frogs = [];
    this.waterAll = [];
    let seed = 1234 + world.def.id.length * 97; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const isRiver = (cx, cy) => cx >= 0 && cy >= 0 && cx < N && cy < N && world.type[cy * N + cx] === T_RIVER;
    for (let cy = 0; cy < N; cy++) for (let cx = 0; cx < N; cx++) {
      const i = cy * N + cx, t = world.type[i], x = cx * C, y = cy * C;
      if (t === T_RIVER) {
        const inner = isRiver(cx + 1, cy) && isRiver(cx - 1, cy) && isRiver(cx, cy + 1) && isRiver(cx, cy - 1);
        if (inner) for (let k = 0; k < 2; k++) { const p = { x: x + rnd() * C, y: y + rnd() * C, ph: rnd() * 6.28, sp: 0.8 + rnd() }; this.water[((p.y / B) | 0) * NB + ((p.x / B) | 0)].push(p); this.waterAll.push(p); }
        else if (this.key === 'marsh' && rnd() < 0.05 && world.walk[i]) this.frogs.push({ x: x + C / 2, y: y + C / 2, ph: rnd() * 10 });
      } else if (t === T_GRASS && world.walk[i] && !world.brush[i] && (this.key === 'spring' || this.key === 'marsh' || this.key === 'autumn' || this.key === 'ruins') && rnd() < 0.02) {
        const p = { x: x + rnd() * C, y: y + rnd() * C, ph: rnd() * 4 }; this.flowers[((p.y / B) | 0) * NB + ((p.x / B) | 0)].push(p);
      }
    }
    this.frogs = this.frogs.slice(0, 24);
    // team flags: a ring of four in front of each fountain
    this.flags = [];
    for (let t = 0; t < 2; t++) {
      const f = world.fountain[t], c = { x: S / 2, y: S / 2 }, a0 = Math.atan2(c.y - f.y, c.x - f.x);
      for (let k = -1.5; k <= 1.5; k++) { const a = a0 + k * 0.42, R = 175; this.flags.push({ x: f.x + Math.cos(a) * R, y: f.y + Math.sin(a) * R * 0.9, team: t, ph: Math.random() * 4 }); }
    }
    this.leaves = []; this.flies = []; this.birds = []; this.fish = null; this.nextBird = 4 + Math.random() * 6; this.nextFish = 2;
    this.sheets = null;
  }
  // Lazily cut atlas rows we recolour (autumn leaves, colour-blind team flag).
  sheet(key) {
    const im = IMG.ambient; if (!im) return null;
    this.sheets = this.sheets || {};
    if (this.sheets[key]) return this.sheets[key];
    const crop = (row) => { const [y, w, h, n] = AMB[row], c = document.createElement('canvas'); c.width = w * n; c.height = h; c.getContext('2d').drawImage(im, 0, y, w * n, h, 0, 0, w * n, h); return c; };
    if (key === 'leafgold') return (this.sheets[key] = recolor(crop('leaf'), { hue: -55, sat: 1.2, light: 0.05 }));
    if (key === 'flag_o') return (this.sheets[key] = recolor(crop('flag_r'), { hue: 30, sat: 1.1 }));
    return (this.sheets[key] = crop(key));
  }
  frame(key, f, x, y, sc, flip) {
    const row = AMB[key === 'leafgold' ? 'leaf' : key === 'flag_o' ? 'flag_r' : key], img = this.sheet(key); if (!row || !img) return;
    const [, w, h, n] = row, ctx = this.r.ctx, dw = w * sc, dh = h * sc;
    if (flip) { ctx.save(); ctx.translate(Math.round(x), 0); ctx.scale(-1, 1); ctx.drawImage(img, (f % n) * w, 0, w, h, -dw / 2, Math.round(y - dh), dw, dh); ctx.restore(); }
    else ctx.drawImage(img, (f % n) * w, 0, w, h, Math.round(x - dw / 2), Math.round(y - dh), dw, dh);
  }
  level() { const d = this.r.detail; return d === 0 ? 0 : (d === 1 || settings.reducedMotion) ? 0.5 : 1; }
  each(grid, x0, y0, vw, vh, fn) {
    const bx0 = Math.max(0, Math.floor((x0 - 20) / B)), by0 = Math.max(0, Math.floor((y0 - 20) / B)), bx1 = Math.min(NB - 1, Math.floor((x0 + vw + 20) / B)), by1 = Math.min(NB - 1, Math.floor((y0 + vh + 20) / B));
    for (let by = by0; by <= by1; by++) for (let bx = bx0; bx <= bx1; bx++) for (const p of grid[by * NB + bx]) if (p.x > x0 - 20 && p.x < x0 + vw + 20 && p.y > y0 - 20 && p.y < y0 + vh + 20) fn(p);
  }

  drawGround(ctx, x0, y0, vw, vh, dt) {
    if (!this.world) return;
    const t = this.r.time, L = this.level();
    // flags (always: they mark the bases)
    const fr = Math.floor(t * 7);
    for (const f of this.flags) if (f.x > x0 - 40 && f.x < x0 + vw + 40 && f.y > y0 - 60 && f.y < y0 + vh + 40) {
      ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(Math.round(f.x - 5), Math.round(f.y - 2), 12, 4);
      this.frame(f.team === 0 ? 'flag_b' : settings.colorblind ? 'flag_o' : 'flag_r', fr + ((f.ph * 3) | 0), f.x, f.y + 2, 2.6);
    }
    if (!L) return;
    // water shimmer: twinkling highlight dashes (batched into three alpha levels), plus the odd ripple ring
    const glints = this.glints || (this.glints = [[], [], []]), rip = this.rip || (this.rip = []);
    glints[0].length = glints[1].length = glints[2].length = 0; rip.length = 0;
    this.each(this.water, x0, y0, vw, vh, (p) => {
      const v = Math.sin(t * p.sp * 1.6 + p.ph);
      if (v > 0.78) glints[Math.min(2, Math.floor((v - 0.78) / 0.22 * 3))].push(p);
      else if (L === 1 && v < -0.985) rip.push(p, (-v - 0.985) / 0.015);
    });
    ctx.fillStyle = '#ffffff';
    for (let q = 0; q < 3; q++) {
      if (!glints[q].length) continue;
      ctx.globalAlpha = (q + 1) / 3 * 0.75; ctx.beginPath();
      for (const p of glints[q]) { const x = Math.round(p.x), y = Math.round(p.y); ctx.rect(x, y, 4, 1); ctx.rect(x + 2, y - 2, 2, 1); }
      ctx.fill();
    }
    ctx.strokeStyle = '#e8fbff'; ctx.lineWidth = 1;
    for (let i = 0; i < rip.length; i += 2) { const p = rip[i], k = rip[i + 1]; ctx.globalAlpha = 0.5 * (1 - k); ctx.beginPath(); ctx.ellipse(p.x, p.y, 3 + k * 9, 1.5 + k * 4, 0, 0, Math.PI * 2); ctx.stroke(); }
    ctx.globalAlpha = 1;
    // flowers sway
    this.each(this.flowers, x0, y0, vw, vh, (p) => this.frame('flower', Math.floor(t * 3 + p.ph), p.x, p.y + 4, 1.1));
    // marsh frogs: sit, croak now and then
    if (this.key === 'marsh') for (const f of this.frogs) if (f.x > x0 - 20 && f.x < x0 + vw + 20 && f.y > y0 - 20 && f.y < y0 + vh + 20) this.frame('frog', Math.sin(t * 0.9 + f.ph) > 0.93 ? 1 : 0, f.x, f.y + 6, 1.6, f.ph > 5);
    // a fish jumps in a river in view every few seconds
    if (this.key !== 'winter' && this.waterAll.length) {
      this.nextFish -= dt;
      if (!this.fish && this.nextFish <= 0) {
        this.nextFish = (3 + Math.random() * 4) / L;
        const inView = this.waterAll.filter((p) => p.x > x0 + 30 && p.x < x0 + vw - 30 && p.y > y0 + 30 && p.y < y0 + vh - 30);
        if (inView.length) { const p = inView[(Math.random() * inView.length) | 0]; this.fish = { x: p.x, y: p.y, born: t, dir: Math.random() < 0.5 ? -1 : 1 }; }
      }
      const f = this.fish;
      if (f) {
        const k = (t - f.born) / 0.8;
        if (k >= 1.3) this.fish = null;
        else {
          if (k < 1) { const h = Math.sin(k * Math.PI) * 22; ctx.save(); ctx.translate(f.x + f.dir * (k - 0.5) * 30, f.y - h); ctx.rotate(f.dir * (k - 0.5) * 2.2); this.frame('fish', 0, 0, 8, 1.4, f.dir < 0); ctx.restore(); }
          const sk = Math.min(1, Math.abs(k - (k < 0.5 ? 0 : 1)) * 3);
          if (k < 0.3 || k > 0.95) { ctx.globalAlpha = 0.7 * (1 - sk); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5; const cx = f.x + f.dir * ((k < 0.5 ? -0.5 : 0.5) * 30); ctx.beginPath(); ctx.ellipse(cx, f.y, 4 + sk * 12, 2 + sk * 5, 0, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1; }
        }
      }
    }
  }

  drawAir(ctx, x0, y0, vw, vh, dt) {
    if (!this.world) return;
    const L = this.level(); if (!L) return;
    const t = this.r.time, key = this.key;
    // falling petals / leaves / snow motes
    const kinds = LEAVES[key] || [];
    if (kinds.length) {
      const want = Math.round((key === 'winter' ? 8 : 12) * L);
      while (this.leaves.length < want) this.leaves.push(this.newLeaf(kinds, x0, y0, vw, vh, this.leaves.length < want / 2));
      for (let i = 0; i < this.leaves.length; i++) {
        const p = this.leaves[i]; p.t += dt; p.y += p.vy * dt; p.x += (p.vx + Math.sin(p.t * 1.7 + p.ph) * 18) * dt;
        if (p.t > p.life || p.x < x0 - 80 || p.x > x0 + vw + 80 || p.y > y0 + vh + 40 || p.y < y0 - 200) { this.leaves[i] = this.newLeaf(kinds, x0, y0, vw, vh, false); continue; }
        const a = Math.min(1, p.t / 0.6, (p.life - p.t) / 0.8); ctx.globalAlpha = a * 0.9;
        this.frame(p.k, Math.floor(p.t * 7 + p.ph), p.x, p.y, p.k === 'snow' ? 1 : 1.5);
      }
      ctx.globalAlpha = 1;
    }
    // fireflies (marsh all game, autumn a few): soft blinking glows wandering on sine paths
    if (key === 'marsh' || key === 'autumn') {
      const want = Math.round((key === 'marsh' ? 22 : key === 'autumn' ? 6 : 0) * L);
      while (this.flies.length < want) this.flies.push({ x: x0 + Math.random() * vw, y: y0 + Math.random() * vh, ph: Math.random() * 20, sp: 0.4 + Math.random() * 0.6 });
      if (this.flies.length > want) this.flies.length = want;
      const g = glowSprite(key === 'marsh' ? '#c8ff8a' : '#ffd27a');
      ctx.globalCompositeOperation = 'lighter';
      for (const f of this.flies) {
        f.x += Math.cos(t * f.sp + f.ph) * 22 * dt; f.y += Math.sin(t * f.sp * 1.3 + f.ph * 2) * 16 * dt;
        if (f.x < x0 - 40) f.x += vw + 60; else if (f.x > x0 + vw + 40) f.x -= vw + 60;
        if (f.y < y0 - 40) f.y += vh + 60; else if (f.y > y0 + vh + 40) f.y -= vh + 60;
        const b = Math.max(0, Math.sin(t * 2.2 + f.ph)); if (b < 0.05) continue;
        ctx.globalAlpha = b; ctx.drawImage(g, f.x - 7, f.y - 7, 14, 14); ctx.fillStyle = '#ffffe0'; ctx.fillRect(Math.round(f.x), Math.round(f.y), 2, 2);
      }
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    }
    // spring butterflies: two-pixel wings flapping
    if (key === 'spring') {
      const want = Math.round(4 * L);
      this.bflies = this.bflies || [];
      while (this.bflies.length < want) this.bflies.push({ x: x0 + Math.random() * vw, y: y0 + Math.random() * vh, ph: Math.random() * 20, c: ['#ffffff', '#ffd84a', '#ff9ad5', '#9fd0ff'][(Math.random() * 4) | 0] });
      for (const f of this.bflies) {
        f.x += Math.cos(t * 0.7 + f.ph) * 30 * dt; f.y += Math.sin(t * 1.1 + f.ph) * 20 * dt;
        if (f.x < x0 - 40 || f.x > x0 + vw + 40 || f.y < y0 - 40 || f.y > y0 + vh + 40) { f.x = x0 + Math.random() * vw; f.y = y0 + Math.random() * vh; }
        const w = Math.abs(Math.sin(t * 14 + f.ph)) * 3 + 1;
        ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(Math.round(f.x - w), Math.round(f.y + 14), w * 2, 1);
        ctx.fillStyle = f.c; ctx.fillRect(Math.round(f.x - w), Math.round(f.y - 1), w, 3); ctx.fillRect(Math.round(f.x + 1), Math.round(f.y - 1), w, 3);
        ctx.fillStyle = '#3a2a20'; ctx.fillRect(Math.round(f.x), Math.round(f.y - 1), 1, 3);
      }
    }
    // a small flock crosses the view now and then (with ground shadows)
    if (key !== 'marsh') {
      this.nextBird -= dt;
      if (this.nextBird <= 0 && !this.birds.length) {
        this.nextBird = (10 + Math.random() * 12) / L;
        const dir = Math.random() < 0.5 ? -1 : 1, n = 3 + ((Math.random() * 3) | 0), by = y0 + vh * (0.2 + Math.random() * 0.6), sk = Math.random() < 0.5 ? 'parrot_b' : 'parrot_r';
        for (let k = 0; k < n; k++) this.birds.push({ x: (dir > 0 ? x0 - 40 : x0 + vw + 40) - dir * k * 26, y: by + (k % 2 ? 16 : -10) * Math.ceil(k / 2), vx: dir * (110 + Math.random() * 10), vy: (Math.random() - 0.5) * 20, ph: Math.random() * 3, k: sk });
      }
      for (const b of this.birds) {
        b.x += b.vx * dt; b.y += b.vy * dt;
        ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.beginPath(); ctx.ellipse(b.x + 30, b.y + 90, 7, 3, 0, 0, Math.PI * 2); ctx.fill();
        this.frame(b.k, Math.floor(t * 9 + b.ph), b.x, b.y, 1.5, b.vx < 0);
      }
      this.birds = this.birds.filter((b) => b.x > x0 - 300 && b.x < x0 + vw + 300);
    }
  }
  newLeaf(kinds, x0, y0, vw, vh, anywhere) {
    const k = kinds[(Math.random() * kinds.length) | 0];
    return { k, x: x0 + Math.random() * vw, y: anywhere ? y0 + Math.random() * vh : y0 - 10 - Math.random() * 60, vx: k === 'snow' ? -12 : 14 + Math.random() * 10, vy: k === 'snow' ? 14 + Math.random() * 10 : 22 + Math.random() * 18, t: 0, life: 5 + Math.random() * 5, ph: Math.random() * 6 };
  }
}
