// Canvas renderer: interpolated sprites, FX, fog of war, floating combat text.
import { IMG, VAR, FX, PROJ, flashOf } from './assets.js';
import { paintMap } from './mapgen.js';
import { MAP_SIZE, FOUNTAIN } from '../sim/map.js';
import { TICK_RATE, VISION, DRAGON_INFO } from '../sim/constants.js';

export const TEAM_COL = ['#4aa3ff', '#ff5a5a', '#c8c8c8'];
const TEAM_DARK = ['#1d4f8a', '#8a1d27', '#555'];
// The pixel font's space is very narrow; an en-space falls back to a wider glyph.
const sp = (s) => String(s).replace(/ /g, '\u2002');

export class Renderer {
  constructor(canvas, map) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.fog = document.createElement('canvas');
    this.fctx = this.fog.getContext('2d');
    this.map = map || paintMap();
    this.cam = { x: 600, y: 1800, zoom: 1.4 };
    this.prev = new Map();
    this.effects = [];
    this.texts = [];
    this.lines = [];
    this.flashes = new Map();
    this.viewTeam = 0;
    this.fogOn = true;
    this.follow = null;
    this.time = 0;
    this.dpr = 1;
    this.showNames = true;
    this.labelAll = false;
    this.grad = this.makeGrad();
    this.resize();
  }
  makeGrad() {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const x = c.getContext('2d'); const g = x.createRadialGradient(64, 64, 20, 64, 64, 64);
    g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(0.75, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.fillRect(0, 0, 128, 128); return c;
  }
  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.max(1, Math.round(r.width * this.dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * this.dpr));
    this.fog.width = this.canvas.width; this.fog.height = this.canvas.height;
    this.W = this.canvas.width; this.H = this.canvas.height;
  }
  attach(game, viewTeam) { this.game = game; this.viewTeam = viewTeam; this.prev.clear(); this.effects = []; this.texts = []; this.lines = []; }

  // World <-> screen
  get scale() { return this.cam.zoom * this.dpr; }
  w2s(x, y) { const s = this.scale; return { x: (x - this.cam.x) * s + this.W / 2, y: (y - this.cam.y) * s + this.H / 2 }; }
  s2w(px, py) { const s = this.scale; return { x: (px * this.dpr - this.W / 2) / s + this.cam.x, y: (py * this.dpr - this.H / 2) / s + this.cam.y }; }
  clampCam() {
    const s = this.scale, hw = this.W / 2 / s, hh = this.H / 2 / s;
    this.cam.x = Math.max(Math.min(hw, MAP_SIZE / 2), Math.min(MAP_SIZE - Math.min(hw, MAP_SIZE / 2), this.cam.x));
    this.cam.y = Math.max(Math.min(hh, MAP_SIZE / 2), Math.min(MAP_SIZE - Math.min(hh, MAP_SIZE / 2), this.cam.y));
  }

  snapshot() { for (const u of this.game.units) if (u.alive && !u.structure) this.prev.set(u.id, { x: u.x, y: u.y }); }
  visible(u) {
    if (!this.fogOn || this.viewTeam < 0) return true;
    return u.team === this.viewTeam || u.structure || this.game.vision[this.viewTeam].has(u.id);
  }
  visiblePoint(x, y) {
    if (!this.fogOn || this.viewTeam < 0) return true;
    const g = this.game, t = this.viewTeam;
    for (const u of g.units) {
      if (!u.alive || u.team !== t) continue;
      const r = u.type === 'hero' ? VISION.hero : u.type === 'minion' ? VISION.minion : u.structure ? VISION.tower : u.type === 'summon' ? VISION.summon : 0;
      if (r && (u.x - x) ** 2 + (u.y - y) ** 2 < r * r) return true;
    }
    for (const w of g.wards) if (w.team === t && (w.x - x) ** 2 + (w.y - y) ** 2 < VISION.ward ** 2) return true;
    return false;
  }

  // Convert sim fx into visual effects.
  consume() {
    const g = this.game; const now = this.time;
    for (const f of g.fx) {
      const u = f.id ? g.units.find((x) => x.id === f.id) : null;
      if (u && !this.visible(u) && f.kind !== 'death') continue;
      switch (f.kind) {
        case 'dmg':
          if (u && (f.hero || f.crit || (u.type === 'hero' && f.v > 40))) this.text(u.x + (Math.random() - 0.5) * 16, u.y - 34, String(f.v), f.crit ? '#ffd84a' : f.t === 'magic' ? '#c9a7ff' : f.t === 'true' ? '#ffffff' : '#ff8f7a', f.crit ? 15 : 11, 0.8);
          if (u) this.flashes.set(u.id, now);
          break;
        case 'heal': if (u && f.v > 15) this.text(u.x, u.y - 40, '+' + f.v, '#6fdc8c', 11, 0.9); break;
        case 'gold': if (u && (u.team === this.viewTeam || this.viewTeam < 0)) this.text(f.x, f.y - 20, '+' + f.v + 'g', '#ffd84a', 9, 0.8); break;
        case 'levelup': if (u) { this.fxSprite('boost', u.x, u.y - 10, 1.4, u.id); this.text(u.x, u.y - 52, 'LEVEL ' + u.level, '#9fe8ff', 10, 1.2); } break;
        case 'cast': if (u && f.ult) { this.text(u.x, u.y - 62, f.name.toUpperCase() + '!', TEAM_COL[u.team], 14, 1.6, true); this.fxSprite('circle_orange', u.x, u.y, 2.2); } break;
        case 'fx': if (this.visiblePoint(f.x, f.y)) this.fxSprite(f.name, f.x, f.y, f.s || 1, f.follow); break;
        case 'line': if (this.visiblePoint(f.x1, f.y1) || this.visiblePoint(f.x2, f.y2)) { this.lines.push({ ...f, born: now }); this.fxSprite(f.name, (f.x1 + f.x2) / 2, (f.y1 + f.y2) / 2, 1.3); } break;
        case 'telegraph': if (this.visiblePoint(f.x, f.y)) this.effects.push({ kind: 'tele', x: f.x, y: f.y, r: f.r, team: f.team, born: now, dur: Math.max(0.15, (f.until - g.tick) / TICK_RATE) }); break;
        case 'zone': if (this.visiblePoint(f.x, f.y)) this.effects.push({ kind: 'zone', x: f.x, y: f.y, r: f.r, team: f.team, born: now, dur: (f.until - g.tick) / TICK_RATE, name: f.name }); break;
        case 'death':
          if (this.visiblePoint(f.x, f.y)) {
            this.fxSprite(f.type === 'hero' || f.type === 'objective' ? 'smoke_ring' : 'smoke', f.x, f.y, f.type === 'hero' ? 2.4 : f.type === 'tower' || f.type === 'inhib' ? 4 : 1.2);
            if (f.type === 'tower' || f.type === 'inhib' || f.type === 'nexus') { this.fxSprite('explosion', f.x, f.y - 20, 4); this.shake = 0.5; }
          }
          break;
        case 'cc': if (u) this.text(u.x, u.y - 46, f.cc === 'knock' ? 'AIRBORNE' : f.cc.toUpperCase(), '#ffe066', 9, 0.9); break;
        case 'swing': { const t = g.units.find((x) => x.id === f.tid); if (t && this.visible(t)) this.fxSprite('slash', (u.x + t.x) / 2, (u.y + t.y) / 2 - 10, 0.8); } break;
        case 'shield': if (u) this.fxSprite('shield', u.x, u.y - 14, 1.3, u.id); break;
        case 'flash': if (this.visiblePoint(f.x, f.y)) { this.fxSprite('spark', f.x, f.y - 10, 1.4); this.text(f.x, f.y - 40, 'FLASH', '#fff', 9, 0.8); } break;
        case 'ward': if (f.team === this.viewTeam || this.viewTeam < 0) this.fxSprite('spirit', f.x, f.y, 1); break;
        case 'recall': break;
      }
    }
    g.fx.length = 0;
  }
  text(x, y, s, color, size, dur, big) { this.texts.push({ x, y, s, color, size, dur, born: this.time, big }); if (this.texts.length > 120) this.texts.shift(); }
  fxSprite(name, x, y, s, follow) {
    const def = FX[name]; if (!def) return;
    this.effects.push({ kind: 'sprite', name, x, y, s, follow, born: this.time, dur: def.frames / 14 });
  }

  // ── main draw ──
  draw(alpha, dt) {
    this.time += dt;
    const g = this.game, ctx = this.ctx;
    if (this.follow) {
      const u = g.units.find((x) => x.id === this.follow);
      if (u && u.alive) { this.cam.x += (u.x - this.cam.x) * Math.min(1, dt * 6); this.cam.y += (u.y - this.cam.y) * Math.min(1, dt * 6); }
    }
    this.clampCam();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#1b2a1a'; ctx.fillRect(0, 0, this.W, this.H);
    const s = this.scale;
    let shx = 0, shy = 0;
    if (this.shake > 0) { this.shake -= dt; shx = (Math.random() - 0.5) * 6 * this.dpr; shy = (Math.random() - 0.5) * 6 * this.dpr; }
    ctx.setTransform(s, 0, 0, s, this.W / 2 - this.cam.x * s + shx, this.H / 2 - this.cam.y * s + shy);
    // map
    const vw = this.W / s, vh = this.H / s, x0 = this.cam.x - vw / 2, y0 = this.cam.y - vh / 2;
    const sx = Math.max(0, Math.floor(x0)), sy = Math.max(0, Math.floor(y0));
    const sw = Math.min(MAP_SIZE - sx, Math.ceil(vw) + 2), sh = Math.min(MAP_SIZE - sy, Math.ceil(vh) + 2);
    if (sw > 0 && sh > 0) ctx.drawImage(this.map, sx, sy, sw, sh, sx, sy, sw, sh);
    const inView = (x, y, m = 120) => x > x0 - m && x < x0 + vw + m && y > y0 - m && y < y0 + vh + m;

    // ground effects
    for (const e of this.effects) if (e.kind === 'tele' || e.kind === 'zone') this.drawGroundFx(e);
    // wards
    for (const w of g.wards) if (w.until > g.tick && (w.team === this.viewTeam || this.viewTeam < 0 || !this.fogOn) && inView(w.x, w.y)) {
      ctx.fillStyle = TEAM_COL[w.team]; ctx.globalAlpha = 0.25 + 0.15 * Math.sin(this.time * 4);
      ctx.beginPath(); ctx.arc(w.x, w.y, 10, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
      ctx.fillStyle = '#fff8c8'; ctx.fillRect(w.x - 2, w.y - 12, 4, 10); ctx.fillStyle = TEAM_COL[w.team]; ctx.fillRect(w.x - 3, w.y - 15, 6, 4);
    }
    // collect drawables
    const list = [];
    for (const u of g.units) {
      if (!u.alive && !u.structure) continue;
      if (!inView(u.x, u.y, 160)) continue;
      if (!this.visible(u)) continue;
      const p = this.prev.get(u.id);
      let x = u.x, y = u.y;
      if (p && !u.structure) { const dx = u.x - p.x, dy = u.y - p.y; if (dx * dx + dy * dy < 200 * 200) { x = p.x + dx * alpha; y = p.y + dy * alpha; } }
      list.push({ u, x, y, moving: p ? (Math.abs(u.x - p.x) + Math.abs(u.y - p.y)) > 0.2 : false });
    }
    list.sort((a, b) => a.y - b.y);
    for (const d of list) this.drawUnit(d);
    // projectiles
    for (const p of g.projectiles) {
      if (!inView(p.x, p.y)) continue;
      if (!this.visiblePoint(p.x, p.y)) continue;
      this.drawProjectile(p);
    }
    // top effects
    this.drawLines(dt);
    for (const e of this.effects) if (e.kind === 'sprite') this.drawSpriteFx(e);
    this.effects = this.effects.filter((e) => this.time - e.born < e.dur);
    // bars on top
    for (const d of list) this.drawBars(d);
    // fog
    if (this.fogOn && this.viewTeam >= 0) this.drawFog(s, shx, shy);
    // texts (screen space, above fog)
    ctx.setTransform(s, 0, 0, s, this.W / 2 - this.cam.x * s + shx, this.H / 2 - this.cam.y * s + shy);
    this.drawTexts();
  }

  drawGroundFx(e) {
    const ctx = this.ctx, t = (this.time - e.born) / e.dur;
    ctx.save();
    const col = TEAM_COL[e.team] || '#fff';
    if (e.kind === 'tele') {
      ctx.globalAlpha = 0.18 + 0.25 * t; ctx.fillStyle = col;
      ctx.beginPath(); ctx.ellipse(e.x, e.y, e.r * t, e.r * t * 0.85, 0, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 0.7; ctx.strokeStyle = col; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(e.x, e.y, e.r, e.r * 0.85, 0, 0, Math.PI * 2); ctx.stroke();
    } else {
      ctx.globalAlpha = 0.22 + 0.08 * Math.sin(this.time * 8); ctx.fillStyle = col;
      ctx.beginPath(); ctx.ellipse(e.x, e.y, e.r, e.r * 0.85, 0, 0, Math.PI * 2); ctx.fill();
      if (Math.random() < 0.3) this.fxSprite(e.name || 'spirit', e.x + (Math.random() - 0.5) * e.r * 1.4, e.y + (Math.random() - 0.5) * e.r * 1.2, 0.9);
    }
    ctx.restore();
  }

  drawSheetFrame(img, fw, fh, col, row, x, y, scale, flip) {
    const ctx = this.ctx, w = fw * scale, h = fh * scale;
    if (flip) { ctx.save(); ctx.translate(Math.round(x), 0); ctx.scale(-1, 1); ctx.drawImage(img, col * fw, row * fh, fw, fh, -w / 2, Math.round(y - h), w, h); ctx.restore(); }
    else ctx.drawImage(img, col * fw, row * fh, fw, fh, Math.round(x - w / 2), Math.round(y - h), w, h);
  }

  drawUnit(d) {
    const { u } = d; let { x, y } = d;
    const ctx = this.ctx, g = this.game;
    const flashT = this.flashes.get(u.id);
    const flashing = flashT !== undefined && this.time - flashT < 0.08;
    if (u.structure) return this.drawStructure(u, flashing);
    // shadow + team ring
    const big = u.type === 'objective' ? 2.4 : u.type === 'mob' && u.big ? 1.6 : u.type === 'hero' ? 1.15 : 0.8;
    if (u.type === 'hero' || u.type === 'summon') {
      ctx.fillStyle = TEAM_COL[u.team]; ctx.globalAlpha = 0.85;
      ctx.beginPath(); ctx.ellipse(x, y + 2, 15, 7, 0, 0, Math.PI * 2); ctx.lineWidth = 2; ctx.strokeStyle = TEAM_COL[u.team]; ctx.stroke();
      ctx.globalAlpha = 0.25; ctx.fill(); ctx.globalAlpha = 1;
    } else {
      ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.beginPath(); ctx.ellipse(x, y + 2, 9 * big, 4 * big, 0, 0, Math.PI * 2); ctx.fill();
    }
    let lift = 0;
    if (u.knockUntil > g.tick) { const k = (u.knockUntil - g.tick) / 15; lift = Math.sin(Math.min(1, k) * Math.PI) * 18; }
    const walkF = Math.floor(this.time * 8 + u.id) % 4;
    const attacking = g.tick - u.animAttack < 6;
    if (u.type === 'hero') {
      const img = IMG['hero_' + u.heroId]; if (!img) return;
      const row = attacking ? 4 : d.moving ? walkF : 0;
      const dirCol = u.facing;
      const src = flashing ? flashOf('hero_' + u.heroId, img) : img;
      if (u.recallAt) { ctx.strokeStyle = '#7fe0ff'; ctx.lineWidth = 2; const p = 1 - (u.recallAt - g.tick) / (4 * TICK_RATE); ctx.beginPath(); ctx.arc(x, y - 12, 22, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2); ctx.stroke(); }
      this.drawSheetFrame(src, 16, 16, dirCol, row, x, y + 4 - lift, 2.2);
      if (u.stunUntil > g.tick) this.drawStars(x, y - 40 - lift);
      if (u.shields.length) { ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y - 14, 20, 0, Math.PI * 2); ctx.stroke(); }
      if (u.burns.length && Math.random() < 0.15) this.fxSprite('flame', x + (Math.random() - 0.5) * 16, y - 10, 0.5);
      if (u.baronUntil > g.tick) { ctx.globalAlpha = 0.35; ctx.fillStyle = '#b56cff'; ctx.beginPath(); ctx.arc(x, y - 14, 18, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1; }
      return;
    }
    if (u.type === 'minion') {
      const key = `minion_${u.team ? 'red' : 'blue'}_${u.kind === 'super' ? 'siege' : u.kind}`;
      const img = IMG[key]; if (!img) return;
      const sc = u.kind === 'super' ? 2.4 : u.kind === 'siege' ? 1.9 : 1.5;
      this.drawSheetFrame(flashing ? flashOf(key, img) : img, 16, 16, u.facing, d.moving ? walkF : 0, x, y + 3 - lift, sc);
      if (u.empowered) { ctx.globalAlpha = 0.3; ctx.fillStyle = '#b56cff'; ctx.beginPath(); ctx.arc(x, y - 10, 10, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1; }
      return;
    }
    if (u.type === 'mob') {
      const img = IMG[u.kind]; if (!img) return;
      this.drawSheetFrame(flashing ? flashOf(u.kind, img) : img, 16, 16, u.facing, d.moving ? walkF : (Math.floor(this.time * 3 + u.id) % 2), x, y + 3, u.big ? 2.6 : 1.7);
      return;
    }
    if (u.type === 'summon') {
      const img = IMG.herald_walk; if (!img) return;
      const f = Math.floor(this.time * 10) % 6;
      this.drawSheetFrame(img, 50, 50, f, 0, x, y + 8, 1.3, u.facing === 2);
      return;
    }
    if (u.type === 'objective') return this.drawBoss(u, x, y, flashing, attacking);
  }

  drawStars(x, y) {
    const ctx = this.ctx;
    for (let i = 0; i < 3; i++) {
      const a = this.time * 6 + i * 2.1;
      ctx.fillStyle = '#ffe066'; ctx.fillRect(Math.round(x + Math.cos(a) * 10) - 2, Math.round(y + Math.sin(a) * 4) - 2, 4, 4);
    }
  }

  drawBoss(u, x, y, flashing, attacking) {
    const ctx = this.ctx;
    if (u.kind === 'dragon') {
      const skin = VAR['dragon_' + u.element] || VAR.dragon_infernal; if (!skin || !skin.head) return;
      const t = this.time, bob = Math.sin(t * 3) * 4, flap = 0.75 + 0.25 * Math.sin(t * (attacking ? 14 : 6)), sc = 1.5;
      // aura of element colour
      ctx.globalAlpha = 0.25; ctx.fillStyle = DRAGON_INFO[u.element].color; ctx.beginPath(); ctx.ellipse(x, y + 4, 60, 22, 0, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
      const W = skin.wing;
      const wy = y - 58 + bob;
      ctx.save(); ctx.translate(x + 22, wy); ctx.scale(sc * flap, sc); ctx.drawImage(W, -6, -W.height + 10); ctx.restore();
      ctx.save(); ctx.translate(x - 22, wy); ctx.scale(-sc * flap, sc); ctx.drawImage(W, -6, -W.height + 10); ctx.restore();
      const segs = [skin.bodyend, skin.body2, skin.body1, skin.body2];
      for (let i = 0; i < segs.length; i++) {
        const k = segs.length - i;
        const sxo = Math.sin(t * 3 + k * 0.9) * 10 - k * 9, syo = k * 12;
        const im = segs[i];
        ctx.drawImage(im, Math.round(x + sxo - im.width * sc / 2), Math.round(y - 40 + syo + bob - im.height * sc / 2), im.width * sc, im.height * sc);
      }
      const H = flashing ? flashOf('dragonhead_' + u.element, skin.head) : skin.head;
      ctx.drawImage(H, Math.round(x - H.width * sc / 2), Math.round(y - 70 + bob - H.height * sc / 2), H.width * sc, H.height * sc);
      return;
    }
    if (u.kind === 'herald') {
      const img = flashing ? IMG.herald_hit : IMG.herald_idle; if (!img) return;
      const frames = flashing ? 4 : 5, f = Math.floor(this.time * 8) % frames;
      this.drawSheetFrame(img, 50, 50, f, 0, x, y + 10, 2.0);
      return;
    }
    if (u.kind === 'baron') {
      const img = attacking ? IMG.baron_attack : IMG.baron_idle; if (!img) return;
      const frames = attacking ? 6 : 4, f = Math.floor(this.time * 8) % frames;
      this.drawSheetFrame(flashing ? flashOf(attacking ? 'baron_a' : 'baron_i', img) : img, 76, 79, f, 0, x, y + 16, 1.8);
    }
  }

  drawStructure(u, flashing) {
    const ctx = this.ctx, tw = IMG.TilesetTowers; if (!tw) return;
    const pct = u.hp / u.maxHp;
    const stage = !u.alive ? 2 : pct > 0.66 ? 0 : pct > 0.33 ? 1 : 2;
    let sx, sy, sc;
    if (u.type === 'tower') {
      const baseCol = u.tier === 4 ? 3 : 0;
      sy = u.team === 0 ? 32 : 0; sx = (baseCol + stage) * 32; sc = u.tier === 4 ? 2.4 : 2.7;
    } else if (u.type === 'inhib') {
      sy = u.team === 0 ? 0 : 32; sx = (9 + stage) * 32; sc = 2.2;
    } else {
      const c = VAR.crystal && VAR.crystal[stage][u.team];
      if (c) {
        const s = 3.4, bob = u.alive ? Math.sin(this.time * 2) * 3 : 0;
        ctx.fillStyle = TEAM_COL[u.team]; ctx.globalAlpha = 0.25 + 0.1 * Math.sin(this.time * 3); ctx.beginPath(); ctx.ellipse(u.x, u.y, 70, 34, 0, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
        ctx.drawImage(flashing ? flashOf('crystal' + u.team + stage, c) : c, u.x - 16 * s, u.y - 30 * s + 18 + bob, 32 * s, 32 * s);
      }
      return;
    }
    const w = 32 * sc;
    if (!u.alive) ctx.globalAlpha = 0.75;
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(u.x, u.y + 6, w * 0.32, w * 0.12, 0, 0, Math.PI * 2); ctx.fill();
    ctx.drawImage(tw, sx, sy, 32, 32, Math.round(u.x - w / 2), Math.round(u.y - w + 14), w, w);
    if (flashing) { ctx.globalAlpha = 0.35; ctx.fillStyle = '#fff'; ctx.fillRect(u.x - w * 0.3, u.y - w + 20, w * 0.6, w * 0.8); }
    ctx.globalAlpha = 1;
    // range ring when an enemy hero is close (helps spectators read dives)
    if (u.alive && u.type === 'tower' && u.target && u.target.type === 'hero' && this.visible(u.target)) {
      ctx.strokeStyle = TEAM_COL[u.team]; ctx.globalAlpha = 0.35; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(u.x, u.y, u.stats.range, u.stats.range * 0.9, 0, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;
    }
  }

  drawProjectile(p) {
    const ctx = this.ctx;
    if (p.sprite === 'tower') {
      const gr = ctx.createRadialGradient(p.x, p.y, 1, p.x, p.y, 10);
      gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.4, TEAM_COL[p.team]); gr.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(p.x, p.y, 10, 0, Math.PI * 2); ctx.fill();
      return;
    }
    if (p.sprite === 'p_energy_small') { ctx.fillStyle = TEAM_COL[p.team]; ctx.fillRect(Math.round(p.x) - 2, Math.round(p.y) - 2, 4, 4); return; }
    const def = PROJ[p.sprite]; const img = IMG['fx_' + p.sprite];
    if (!def || !img) { ctx.fillStyle = '#fff'; ctx.fillRect(p.x - 2, p.y - 2, 4, 4); return; }
    const fw = img.width / def.frames, fh = img.height, f = Math.floor(this.time * 14) % def.frames;
    const sc = p.ab && p.ab.ult ? 2.6 : p.ab ? 2 : 1.6;
    ctx.save(); ctx.translate(p.x, p.y);
    if (!def.round) ctx.rotate(Math.atan2(p.dy || 0, p.dx || 1));
    ctx.drawImage(img, f * fw, 0, fw, fh, -fw * sc / 2, -fh * sc / 2, fw * sc, fh * sc);
    ctx.restore();
    if (p.hook) {
      const s = p.src; ctx.strokeStyle = '#ddd'; ctx.lineWidth = 2; ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(s.x, s.y - 12); ctx.lineTo(p.x, p.y); ctx.stroke(); ctx.setLineDash([]);
    }
  }

  drawLines() {
    const ctx = this.ctx;
    this.lines = this.lines.filter((l) => this.time - l.born < 0.3);
    for (const l of this.lines) {
      const t = (this.time - l.born) / 0.3;
      ctx.globalAlpha = 1 - t; ctx.strokeStyle = '#fff'; ctx.lineWidth = 8 * (1 - t) + 2;
      ctx.beginPath(); ctx.moveTo(l.x1, l.y1 - 12); ctx.lineTo(l.x2, l.y2 - 12); ctx.stroke();
      ctx.strokeStyle = TEAM_COL[l.team]; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(l.x1, l.y1 - 12); ctx.lineTo(l.x2, l.y2 - 12); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  drawSpriteFx(e) {
    const def = FX[e.name]; const img = IMG['fx_' + (def.img || e.name)]; if (!img) return;
    const fw = img.width / def.frames, fh = img.height;
    const f = Math.min(def.frames - 1, Math.floor((this.time - e.born) / e.dur * def.frames));
    let x = e.x, y = e.y;
    if (e.follow) { const u = this.game.units.find((q) => q.id === e.follow); if (u && u.alive) { x = u.x; y = u.y - 12; } }
    const sc = 1.6 * e.s;
    this.ctx.drawImage(img, f * fw, 0, fw, fh, Math.round(x - fw * sc / 2), Math.round(y - fh * sc / 2), fw * sc, fh * sc);
  }

  drawBars(d) {
    const { u } = d, ctx = this.ctx, g = this.game;
    if (!u.alive) return;
    let x = d.x, y = d.y;
    if (u.type === 'hero') {
      const w = 40, h = 5, top = y - 46;
      ctx.fillStyle = 'rgba(0,0,0,0.75)'; ctx.fillRect(x - w / 2 - 1, top - 1, w + 2, h + 2);
      ctx.fillStyle = TEAM_DARK[u.team]; ctx.fillRect(x - w / 2, top, w, h);
      ctx.fillStyle = TEAM_COL[u.team]; ctx.fillRect(x - w / 2, top, w * Math.max(0, u.hp / u.maxHp), h);
      const sh = g.shieldTotal(u); if (sh > 0) { ctx.fillStyle = '#eee'; ctx.fillRect(x - w / 2 + w * Math.min(1, u.hp / u.maxHp), top, Math.min(w, w * sh / u.maxHp), h); }
      // ticks every 250hp
      ctx.fillStyle = 'rgba(0,0,0,0.5)'; for (let k = 250; k < u.maxHp; k += 250) ctx.fillRect(x - w / 2 + w * k / u.maxHp, top, 1, h);
      // level badge
      ctx.fillStyle = '#111'; ctx.fillRect(x - w / 2 - 12, top - 2, 11, 9);
      ctx.fillStyle = '#fff'; ctx.font = '7px PixelFont, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(u.level), x - w / 2 - 6.5, top + 2.6);
      if (this.showNames) { ctx.font = '7px PixelFont, monospace'; ctx.fillStyle = '#000'; const nm = sp(u.def.name); ctx.fillText(nm, x + 0.6, top - 5.4); ctx.fillStyle = u.team === this.viewTeam ? '#fff' : '#ffd0d0'; ctx.fillText(nm, x, top - 6); }
      return;
    }
    if (u.structure) {
      if (u.hp >= u.maxHp && !(u.type === 'nexus')) return;
      const w = u.type === 'nexus' ? 80 : 56, top = u.y - (u.type === 'nexus' ? 120 : u.tier === 4 ? 82 : 90);
      ctx.fillStyle = 'rgba(0,0,0,0.75)'; ctx.fillRect(u.x - w / 2 - 1, top - 1, w + 2, 6);
      ctx.fillStyle = TEAM_COL[u.team]; ctx.fillRect(u.x - w / 2, top, w * u.hp / u.maxHp, 4);
      return;
    }
    if (u.type === 'objective') {
      const w = 70, top = y - (u.kind === 'baron' ? 160 : u.kind === 'dragon' ? 130 : 110);
      ctx.fillStyle = 'rgba(0,0,0,0.75)'; ctx.fillRect(x - w / 2 - 1, top - 1, w + 2, 7);
      ctx.fillStyle = u.kind === 'dragon' ? DRAGON_INFO[u.element].color : u.kind === 'baron' ? '#b56cff' : '#9fd0ff'; ctx.fillRect(x - w / 2, top, w * u.hp / u.maxHp, 5);
      ctx.font = '8px PixelFont, monospace'; ctx.textAlign = 'center'; ctx.fillStyle = '#fff';
      ctx.fillText(sp(u.kind === 'dragon' ? `${DRAGON_INFO[u.element].name} Drake` : u.kind === 'baron' ? 'Baron' : 'Rift Herald'), x, top - 7);
      return;
    }
    if (u.hp < u.maxHp || u.type === 'summon') {
      const w = u.type === 'summon' ? 44 : u.type === 'mob' && u.big ? 34 : 18, top = y - (u.type === 'summon' ? 66 : u.type === 'mob' && u.big ? 44 : 28);
      ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(x - w / 2 - 1, top - 1, w + 2, 4);
      ctx.fillStyle = u.team === 2 ? '#e8c45a' : TEAM_COL[u.team]; ctx.fillRect(x - w / 2, top, w * u.hp / u.maxHp, 2);
    }
  }

  drawFog(s, shx, shy) {
    const f = this.fctx, g = this.game, t = this.viewTeam;
    f.setTransform(1, 0, 0, 1, 0, 0);
    f.globalCompositeOperation = 'source-over';
    f.clearRect(0, 0, this.W, this.H);
    f.fillStyle = 'rgba(8,10,28,0.55)'; f.fillRect(0, 0, this.W, this.H);
    f.globalCompositeOperation = 'destination-out';
    f.setTransform(s, 0, 0, s, this.W / 2 - this.cam.x * s + shx, this.H / 2 - this.cam.y * s + shy);
    const hole = (x, y, r) => f.drawImage(this.grad, x - r * 1.1, y - r * 1.1, r * 2.2, r * 2.2);
    for (const u of g.units) {
      if (!u.alive || u.team !== t) continue;
      const r = u.type === 'hero' ? VISION.hero : u.type === 'minion' ? VISION.minion : u.structure ? VISION.tower : u.type === 'summon' ? VISION.summon : 0;
      if (r) hole(u.x, u.y, r);
    }
    for (const w of g.wards) if (w.team === t && w.until > g.tick) hole(w.x, w.y, VISION.ward);
    hole(FOUNTAIN[t].x, FOUNTAIN[t].y, VISION.fountain);
    f.globalCompositeOperation = 'source-over';
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.drawImage(this.fog, 0, 0);
  }

  drawTexts() {
    const ctx = this.ctx;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    this.texts = this.texts.filter((t) => this.time - t.born < t.dur);
    for (const t of this.texts) {
      const k = (this.time - t.born) / t.dur;
      const y = t.y - k * (t.big ? 14 : 22);
      ctx.globalAlpha = k > 0.7 ? (1 - k) / 0.3 : 1;
      ctx.font = `${t.size}px PixelFont, monospace`;
      const str = sp(t.s); ctx.fillStyle = '#000'; ctx.fillText(str, t.x + 1, y + 1);
      ctx.fillStyle = t.color; ctx.fillText(str, t.x, y);
    }
    ctx.globalAlpha = 1;
  }
}
