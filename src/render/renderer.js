// Canvas renderer: interpolated sprites, FX, fog of war, floating combat text.
import { tr } from '../i18n/i18n.js';
import { IMG, VAR, FX, flashOf } from './assets.js';
import { skinSheet } from './skins.js';
import { paintMap, THEMES } from './mapgen.js';
import { S as MAP_SIZE, N as GN } from '../sim/world.js';
import { TICK_RATE, DRAGON_INFO, OBJ_NAME, T as TIMERS } from '../sim/constants.js';
import { TEAM_COL, TEAM_DARK, rgba } from './palette.js';
import { Particles, P_SQUARE, P_SPARK, P_SPRITE, P_COIN, P_WISP, P_DEBRIS, P_RING, P_PUFF, P_BEAM, P_GLOW, glowSprite } from './particles.js';
import { Chatter } from './chatter.js';
import { Vfx } from './vfx.js';
import { Ambient } from './ambient.js';
import { EventFx } from './eventfx.js';
import { depthFx, drawUltUp } from './depthfx.js';
import { feudLine } from '../data/feuds.js';
import { settings, textScale, renderDpr } from '../ui/settings.js';

export { TEAM_COL, TEAM_DARK };
const OBJ_COL = { dragon: '#ff9a3c', herald: '#9fd0ff', baron: '#b56cff' };
// The pixel font's space is very narrow; an en-space falls back to a wider glyph.
const sp_ = (s) => String(s).replace(/ /g, '\u2002');

// Status-effect colours (pips, cc pop text).
const STATUS_COL = { silence: '#b48cff', fear: '#d070ff', root: '#6fdc8c', shred: '#ff9a3c', grievous: '#ff4a4a', slow: '#7fb4ff', mark: '#ff5a5a', parry: '#ffe066', stun: '#ffe066', knock: '#ffe066' };

export class Renderer {
  constructor(canvas, map) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.fog = document.createElement('canvas');
    this.fctx = this.fog.getContext('2d');
    this.map = map || null;
    this.fogTex = document.createElement('canvas'); this.fogTex.width = GN; this.fogTex.height = GN;
    this.fogTexCtx = this.fogTex.getContext('2d'); this.fogImg = this.fogTexCtx.createImageData(GN, GN); this.fogSmooth = new Float32Array(GN * GN);
    this.cam = { x: 600, y: 1800, zoom: 1.4 };
    this.prev = new Map();
    this.effects = [];
    this.texts = [];
    this.lines = [];
    this.parts = [];
    this.fxp = new Particles(900);
    this.chatter = new Chatter(this);
    this.hpT = new Map();
    this.heroPos = new Map();
    this.callouts = [];
    this.trauma = 0; this.hitStop = 0; this.lastHitStop = -9; this.punch = 0; this.tint = null;
    this.panTo = null; this.evIdx = 0; this.frame = 0;
    this.flashes = new Map();
    this.viewTeam = 0;
    this.fogOn = true;
    this.follow = null;
    this.time = 0;
    this.dpr = 1; this.W = canvas.width; this.H = canvas.height;
    this.showNames = true;
    this.labelAll = false;
    this.vfx = new Vfx(this);
    this.amb = new Ambient(this);
    this.evfx = new EventFx(this); // weekly map event veil / motes
    this.detail = 2; // 2 high, 1 medium (Auto, after a slow spell), 0 low
    this.castT = new Map(); this.corpses = []; this.wasAlive = new Map(); this.spawnT = new Map(); this.knock = new Map(); this.bossSeen = new Map();
    this.grad = this.makeGrad();
    this.resize();
  }
  makeGrad() {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const x = c.getContext('2d'); const g = x.createRadialGradient(64, 64, 20, 64, 64, 64);
    g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(0.75, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.fillRect(0, 0, 128, 128); return c;
  }
  // Backing store = CSS size x DPR, measured live. Called on every viewport signal and checked each
  // frame (cheap), so a stale size can never stretch the picture or skew taps.
  resize(force) {
    const r = this.canvas.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false; // hidden (menus): keep the old size until shown
    const dpr = this.wantDpr(), w = Math.max(1, Math.round(r.width * dpr)), hgt = Math.max(1, Math.round(r.height * dpr));
    this.cssW = r.width; this.cssH = r.height;
    if (!force && w === this.canvas.width && hgt === this.canvas.height && dpr === this.dpr) return false;
    this.dpr = dpr;
    this.canvas.width = w; this.canvas.height = hgt;
    this.fog.width = w; this.fog.height = hgt;
    this.W = w; this.H = hgt;
    return true;
  }
  fit() {
    const c = this.canvas, cw = c.clientWidth, ch = c.clientHeight;
    if (cw && ch && (cw !== Math.round(this.cssW || 0) || ch !== Math.round(this.cssH || 0) || this.wantDpr() !== this.dpr)) this.resize();
  }
  wantDpr() { return Math.min(renderDpr(), this.dprCap || 9); }
  // Auto quality: a device that can't hold ~40 fps for a few seconds first drops effect detail (ambient life,
  // particle counts), then, if still slow, to 1 canvas px per CSS px (2.25x fewer pixels at the usual 1.5 cap).
  // Steps only go down within a match, never back up (no visible pumping). High / Low are fixed.
  govern(dt) {
    if (settings.quality !== 'auto') { this.detail = settings.quality === 'battery' ? 0 : 2; return; }
    if (this.dprCap || !(dt > 0 && dt < 0.25)) return;
    this.slowT = Math.max(0, (this.slowT || 0) + (dt > 1 / 40 ? dt : -dt / 2));
    if (this.slowT > 3) {
      this.slowT = 0;
      if (this.detail > 1) this.detail = 1;
      else if (renderDpr() > 1) { this.dprCap = 1; this.resize(); } else this.dprCap = 9;
    }
  }
  attach(game, viewTeam, map) {
    this.game = game; this.viewTeam = viewTeam; this.map = map || paintMap(game.world); this.theme = THEMES[game.world.def.theme] || THEMES.spring;
    this.fogSmooth.fill(0); this.prev.clear(); this.effects = []; this.texts = []; this.lines = []; this.fxp.clear(); this.focus = null;
    this.dprCap = 0; this.slowT = 0; this.detail = settings.quality === 'battery' ? 0 : 2;
    this.vfx.reset(); this.amb.attach(game.world, this.theme); this.evfx.attach(game);
    this.castT.clear(); this.corpses = []; this.wasAlive.clear(); this.spawnT.clear(); this.knock.clear(); this.bossSeen.clear();
    for (const u of game.units) if (u.type === 'hero') this.wasAlive.set(u.id, u.alive);
    this.chatter.reset(); this.hpT.clear(); this.heroPos.clear(); this.callouts = []; this.trauma = 0; this.hitStop = 0; this.tint = null; this.panTo = null; this.visSlow = null;
    this.evIdx = game.events.length;
  }
  get motion() { return !settings.reducedMotion; }
  onScreen(x, y, m = 0) { const s = this.scale, hw = this.W / 2 / s, hh = this.H / 2 / s; return x > this.cam.x - hw - m && x < this.cam.x + hw + m && y > this.cam.y - hh - m && y < this.cam.y + hh + m; }
  // ── juice primitives (render-only) ──
  shakeBy(a, cap = 1) { if (this.motion && this.trauma < cap) this.trauma = Math.min(cap, this.trauma + a); }
  freeze(sec) { if (!this.motion || this.time - this.lastHitStop < 0.3) return; this.hitStop = Math.max(this.hitStop, sec); this.lastHitStop = this.time; this.punch = 0.025; }
  // Big moments (multi-kills, shutdowns, aces, Coach Moments): a longer freeze that ignores the hit-stop
  // cooldown, plus a quick camera punch-in. Reduced effects: nothing.
  impact(sec, punch = 0.04) { if (!this.motion) return; this.hitStop = Math.max(this.hitStop, sec); this.lastHitStop = this.time; this.punch = Math.max(this.punch, punch); }
  punchBy(a) { if (this.motion) this.punch = Math.min(0.08, Math.max(this.punch, a)); }
  screenTint(color, a, dur) { if (this.motion) this.tint = { color, a, dur, born: this.time }; }
  burst(x, y, n, cols, sp0, sp1, up, g, size, life) {
    for (let k = 0; k < n; k++) { const a = Math.random() * 6.283, sp = sp0 + Math.random() * (sp1 - sp0), p = this.fxp.spawn(P_SQUARE, x, y, life * (0.7 + Math.random() * 0.6)); p.vx = Math.cos(a) * sp; p.vy = Math.sin(a) * sp * 0.7 - up; p.g = g; p.c = cols[k % cols.length]; p.s = size; }
  }
  ring(x, y, r0, r1, c, life, w = 3, delay = 0) { const p = this.fxp.spawn(P_RING, x, y, life); p.s = r0; p.s2 = r1; p.c = c; p.w = w; p.t = -delay; }
  puff(x, y, r0, r1, c, life, vx = 0, vy = 0, delay = 0) { const p = this.fxp.spawn(P_PUFF, x, y, life); p.s = r0; p.s2 = r1; p.c = c; p.vx = vx; p.vy = vy; p.t = -delay; }
  coins(x, y, n, spread = 1) {
    for (let k = 0; k < n; k++) { const p = this.fxp.spawn(P_COIN, x + (Math.random() - 0.5) * 10, y, 0.75 + Math.random() * 0.3); p.vx = (Math.random() - 0.5) * 140 * spread; p.vy = -170 - Math.random() * 110; p.g = 620; p.s2 = Math.random() * 6; }
  }
  unitPos(id) { const p = this.heroPos.get(id); if (p) return p; const u = this.byIdMap && this.byIdMap.get(id); return u && u.alive ? u : null; }

  // World <-> screen
  get scale() { return this.cam.zoom * this.dpr * (1 + this.punch); }
  w2s(x, y) { const s = this.scale; return { x: (x - this.cam.x) * s + this.W / 2, y: (y - this.cam.y) * s + this.H / 2 }; }
  s2w(px, py) { const s = this.scale; return { x: (px * this.dpr - this.W / 2) / s + this.cam.x, y: (py * this.dpr - this.H / 2) / s + this.cam.y }; }
  clampCam() {
    const s = this.scale, hw = this.W / 2 / s, hh = this.H / 2 / s;
    this.cam.x = Math.max(Math.min(hw, MAP_SIZE / 2), Math.min(MAP_SIZE - Math.min(hw, MAP_SIZE / 2), this.cam.x));
    this.cam.y = Math.max(Math.min(hh, MAP_SIZE / 2), Math.min(MAP_SIZE - Math.min(hh, MAP_SIZE / 2), this.cam.y));
  }

  // Cosmetic skin per team (session metadata, never the sim): src/render/skins.js validates the key for the hero.
  heroImg(u) { return skinSheet(u.heroId, this.skins && this.skins[u.team] && this.skins[u.team][u.heroId]); }
  snapshot() { this.prev.clear(); for (const u of this.game.units) if (u.alive && !u.structure) this.prev.set(u.id, { x: u.x, y: u.y }); this.vfx.snapshot(this.game); }
  visible(u) {
    if (!this.fogOn || this.viewTeam < 0) return true;
    return u.team === this.viewTeam || u.structure || this.game.vision[this.viewTeam].has(u.id);
  }
  visiblePoint(x, y) {
    if (!this.fogOn || this.viewTeam < 0) return true;
    return this.game.visGrid[this.viewTeam][this.game.world.idx(x, y)] === 1;
  }

  // Convert sim fx (and new sim events) into visual effects. Read-only on the game.
  consume() {
    const g = this.game; const now = this.time;
    const byId = this.byIdMap || (this.byIdMap = new Map());
    byId.clear(); for (const u of g.units) byId.set(u.id, u);
    const emotes = [], killed = new Set();
    for (const f of g.fx) {
      const u = f.id ? byId.get(f.id) : null;
      if (u && !this.visible(u) && f.kind !== 'death') { if (f.kind === 'cast') this.vfx.cur = null; continue; }
      switch (f.kind) {
        case 'dmg': {
          if (!u) break;
          const show = f.hero || f.crit || (u.type === 'hero' && f.v > 40);
          const lethal = u.type === 'hero' && !u.alive && f.hero && !killed.has(u.id);
          if (lethal) { killed.add(u.id); this.text(u.x, u.y - 40, String(f.v), '#ffffff', 19, 1.1, 'exec'); }
          else if (show) {
            const col = f.crit ? '#ffd84a' : f.t === 'magic' ? '#c9a7ff' : f.t === 'true' ? '#ffffff' : '#ff8f7a';
            const big = f.hero && f.v > 220;
            this.text(u.x + (Math.random() - 0.5) * 16, u.y - 34, f.crit ? f.v + '!' : String(f.v), col, f.crit ? 16 : big ? 13 : 11, f.crit || big ? 0.95 : 0.8, f.crit ? 'crit' : big ? 'pop' : null);
          }
          this.flashes.set(u.id, now);
          if (f.hero) {
            const p = this.fxp.spawn(P_SPARK, u.x + (Math.random() - 0.5) * 10, u.y - 16, 0.18); p.c = f.crit ? '#ffd84a' : '#fff6c8';
            if ((f.crit || f.v > 250) && this.onScreen(u.x, u.y)) { this.shakeBy(f.crit ? 0.14 : 0.1, 0.32); if (f.v > 300) this.freeze(0.045); }
          }
          break;
        }
        case 'heal': if (u && f.v > 15) this.text(u.x, u.y - 40, '+' + f.v, '#6fdc8c', 11, 0.9); break;
        case 'gold':
          if (u && (u.team === this.viewTeam || this.viewTeam < 0) && this.onScreen(f.x, f.y, 40)) {
            this.text(f.x, f.y - 26, '+' + f.v + 'g', '#ffd84a', 9, 0.8);
            const c = this.fxp.spawn(P_COIN, f.x, f.y - 14, 0.55); c.vx = (Math.random() - 0.5) * 50; c.vy = -150; c.g = 520; c.s2 = Math.random() * 6;
          }
          break;
        case 'levelup':
          if (u) {
            this.fxSprite('boost', u.x, u.y - 10, 1.4, u.id);
            this.text(u.x, u.y - 56, 'LEVEL ' + u.level, '#9fe8ff', 10, 1.2, 'pop');
            if (this.onScreen(u.x, u.y, 60)) {
              this.ring(u.x, u.y, 8, 46, '#9fe8ff', 0.6, 3); this.ring(u.x, u.y, 8, 34, '#ffffff', 0.45, 2, 0.12);
              const b = this.fxp.spawn(P_BEAM, u.x, u.y + 2, 0.7); b.s = 26; b.s2 = 90; b.c = 'rgba(159,232,255,0.9)';
              for (let k = 0; k < 6; k++) { const q = this.fxp.spawn(P_SPARK, u.x + (Math.random() - 0.5) * 30, u.y - Math.random() * 30, 0.5); q.vy = -60 - Math.random() * 60; q.c = '#bff3ff'; q.s = 0.6; }
            }
          }
          break;
        case 'cast':
          if (!u) break;
          this.castT.set(u.id, now);
          this.vfx.cast(f, u, g);
          if (f.ult) {
            const on = this.onScreen(u.x, u.y, 40);
            if (on) {
              this.shakeBy(0.2); this.screenTint(TEAM_COL[u.team], 0.16, 0.45); this.punchBy(0.03);
              this.ring(u.x, u.y, 10, 90, TEAM_COL[u.team], 0.5, 4); this.ring(u.x, u.y, 10, 60, '#ffffff', 0.35, 2, 0.08);
              this.callouts = this.callouts.filter((c) => c.id !== u.id).slice(-1);
              this.callouts.push({ id: u.id, heroId: u.heroId, team: u.team, name: u.def.name, ult: f.name, born: now, dur: 1.5 });
            } else this.text(u.x, u.y - 62, f.name.toUpperCase() + '!', TEAM_COL[u.team], 14, 1.6, 'pop');
          }
          break;
        case 'fx': { const o = this.vfx.owner(f, g); if (this.visiblePoint(f.x, f.y)) { const [nm, sc] = this.vfx.impact(f, o); this.fxSprite(nm, f.x, f.y, sc, f.follow); } break; }
        case 'line': { const o = this.vfx.owner({ name: f.name, x: f.x1, y: f.y1 }, g); if (this.visiblePoint(f.x1, f.y1) || this.visiblePoint(f.x2, f.y2)) this.vfx.line(f, o); break; }
        case 'telegraph': { const o = this.vfx.owner(f, g, true); if (this.visiblePoint(f.x, f.y)) { const e = { kind: 'tele', x: f.x, y: f.y, r: f.r, team: f.team, born: now, dur: Math.max(0.15, (f.until - g.tick) / TICK_RATE) }; this.vfx.ground(e, o); this.effects.push(e); } break; }
        case 'zone': { const o = this.vfx.owner(f, g); if (this.visiblePoint(f.x, f.y)) { const e = { kind: 'zone', x: f.x, y: f.y, r: f.r, team: f.team, born: now, dur: (f.until - g.tick) / TICK_RATE, name: f.name }; this.vfx.ground(e, o); this.effects.push(e); } break; }
        case 'death': this.deathFx(f); break;
        case 'cc': if (u) this.text(u.x, u.y - 46, f.cc === 'knock' ? 'AIRBORNE' : f.cc.toUpperCase(), STATUS_COL[f.cc] || '#ffe066', 9, 0.9); break;
        case 'duo': if (this.visiblePoint(f.x, f.y)) { const a = byId.get(f.a); this.text(f.x, f.y - 58, 'DUO: ' + f.name.toUpperCase(), a ? TEAM_COL[a.team] : '#fff', 10, 1.3, 'pop'); if (this.motion) this.fxSprite('boost', f.x, f.y, 1.4); } break;
        case 'swing': { const t = byId.get(f.tid); if (u && t && this.visible(t)) this.fxSprite('slash', (u.x + t.x) / 2, (u.y + t.y) / 2 - 10, 0.8); } break;
        case 'shield': if (u) this.fxSprite('shield', u.x, u.y - 14, 1.3, u.id); break;
        case 'flash': if (this.visiblePoint(f.x, f.y)) { this.fxSprite('spark', f.x, f.y - 10, 1.4); this.text(f.x, f.y - 40, 'FLASH', '#fff', 9, 0.8); } break;
        case 'ward': if (f.team === this.viewTeam || this.viewTeam < 0) this.fxSprite('spirit', f.x, f.y, 1); break;
        case 'talent': case 'ultUp': case 'ultEmp': case 'revenge': case 'duoUlt': depthFx(this, f, u, byId); break; // v23 match depth
        case 'recall': break;
        case 'emote': if (u && (u.team === this.viewTeam || this.viewTeam < 0)) emotes.push({ u, e: f.e }); break;
      }
    }
    g.fx.length = 0;
    // Call responses: one random hero voices it; the rest show their emote.
    const resp = emotes.filter((m) => m.e === 'ok' || m.e === 'think' || m.e === 'doubt');
    let voiced = null;
    if (resp.length) { const m = resp[(Math.random() * resp.length) | 0]; if (this.chatter.say(m.u, m.e === 'ok' ? 'callOk' : m.e === 'think' ? 'callSlow' : 'callDoubt', m.e === 'doubt' ? 1 : 0)) voiced = m.u.id; }
    for (const m of emotes) {
      if (m.u.id === voiced) continue;
      this.effects = this.effects.filter((e) => !(e.kind === 'emote' && e.id === m.u.id));
      this.effects.push({ kind: 'emote', id: m.u.id, e: m.e, born: now, dur: 1.4 });
    }
    // respawns: a hero that is alive again (the sim has no event for it)
    for (const t of g.teams) for (const h of t.heroes) {
      const was = this.wasAlive.get(h.id);
      if (h.alive && was === false) this.respawnFx(h);
      this.wasAlive.set(h.id, h.alive);
    }
    this.consumeEvents(byId);
  }
  respawnFx(h) {
    this.spawnT.set(h.id, this.time);
    if (!this.visible(h) || !this.onScreen(h.x, h.y, 80)) return;
    const c = TEAM_COL[h.team];
    const b = this.fxp.spawn(P_BEAM, h.x, h.y + 2, 0.9); b.s = 34; b.s2 = 160; b.c = rgba(c, 0.9);
    this.ring(h.x, h.y, 6, 54, c, 0.6, 4); this.ring(h.x, h.y, 6, 36, '#ffffff', 0.45, 2, 0.1);
    for (let k = 0; k < 10; k++) { const q = this.fxp.spawn(P_GLOW, h.x + (Math.random() - 0.5) * 34, h.y - Math.random() * 30, 0.8); q.vy = -50 - Math.random() * 60; q.c = k % 2 ? c : '#ffffff'; q.s = 5; q.t = -Math.random() * 0.25; }
  }
  deathFx(f) {
    if (!this.visiblePoint(f.x, f.y)) return;
    const on = this.onScreen(f.x, f.y, 80);
    const du = this.byIdMap && this.byIdMap.get(f.id);
    if (du && on && (f.type === 'hero' || f.type === 'minion' || f.type === 'mob' || f.type === 'objective' || f.type === 'summon')) {
      const d = this.heroPos.get(f.id);
      this.corpses.push({ u: du, x: d ? d.x : f.x, y: d ? d.y : f.y, born: this.time, dur: f.type === 'hero' ? 0.9 : f.type === 'objective' ? 1.2 : 0.45 });
      if (this.corpses.length > 40) this.corpses.shift();
    }
    if (f.type === 'objective' && on) this.objectiveDeath(f, du);
    if (f.type === 'hero') {
      this.fxSprite('smoke_ring', f.x, f.y, 2.4);
      if (!on) return;
      this.burst(f.x, f.y - 14, 18, ['#ffd84a', '#fff3a0', TEAM_COL[f.team], '#ffffff'], 60, 200, 120, 420, 3, 1.0);
      this.ring(f.x, f.y, 6, 70, TEAM_COL[f.team], 0.55, 4); this.ring(f.x, f.y, 6, 44, '#ffffff', 0.4, 2, 0.06);
      for (let k = 0; k < 5; k++) { const p = this.fxp.spawn(P_SPARK, f.x + (Math.random() - 0.5) * 26, f.y - 10 - Math.random() * 24, 0.35); p.c = '#ffffff'; p.s = 1.2; p.t = -k * 0.04; }
      this.shakeBy(0.32); this.freeze(0.085);
    } else if (f.type === 'tower' || f.type === 'inhib' || f.type === 'nexus') {
      const big = f.type === 'nexus';
      this.fxSprite('smoke_ring', f.x, f.y, big ? 6 : 4);
      this.fxSprite('explosion', f.x, f.y - 20, big ? 7 : 4);
      if (!on) return;
      const stone = ['#8a7a6a', '#6b5b52', '#b3957f', '#5a4c44'];
      for (let k = 0; k < (big ? 46 : 30); k++) {
        const a = Math.random() * 6.283, sp = 70 + Math.random() * (big ? 300 : 220), p = this.fxp.spawn(P_DEBRIS, f.x + (Math.random() - 0.5) * 30, f.y - 40 - Math.random() * 30, 1.4 + Math.random() * 0.9);
        p.vx = Math.cos(a) * sp; p.vy = -Math.abs(Math.sin(a)) * sp - 120; p.g = 700; p.c = stone[k % 4]; p.s = 3 + (k % 4) * 1.5; p.ground = f.y + 6 + (Math.random() - 0.3) * 40;
      }
      for (let k = 0; k < 12; k++) { const a = k / 12 * 6.283; this.puff(f.x + Math.cos(a) * 20, f.y + Math.sin(a) * 10, 10, 34 + Math.random() * 16, 'rgba(170,150,130,0.9)', 1.4 + Math.random() * 0.5, Math.cos(a) * 70, Math.sin(a) * 30 - 10, Math.random() * 0.15); }
      this.ring(f.x, f.y, 20, big ? 260 : 170, '#e8d6b0', 0.7, 5); this.ring(f.x, f.y, 20, big ? 200 : 120, TEAM_COL[f.team], 0.6, 3, 0.1);
      this.shakeBy(big ? 1 : 0.7); this.freeze(big ? 0.18 : 0.12); this.screenTint('#ffd9a0', big ? 0.25 : 0.12, 0.35);
    } else {
      this.fxSprite(f.type === 'objective' ? 'smoke_ring' : 'smoke', f.x, f.y, f.type === 'objective' ? 3 : 1.2);
    }
  }
  // Boss slain: white flash at the pit, element-coloured explosion, light pillar and shockwaves.
  objectiveDeath(f, u) {
    const c = u && u.kind === 'dragon' && DRAGON_INFO[u.element] ? DRAGON_INFO[u.element].color : OBJ_COL[u && u.kind] || '#ffffff';
    const b = this.fxp.spawn(P_BEAM, f.x, f.y + 10, 1.4); b.s = 110; b.s2 = 420; b.c = rgba(c, 0.95);
    for (let k = 0; k < 3; k++) this.ring(f.x, f.y, 16, 160 + k * 70, k ? c : '#ffffff', 0.9, 6 - k, k * 0.12);
    this.burst(f.x, f.y - 50, 46, [c, '#ffffff', '#ffd84a'], 90, 360, 200, 420, 4, 1.4);
    for (let k = 0; k < 12; k++) { const q = this.fxp.spawn(P_GLOW, f.x + (Math.random() - 0.5) * 120, f.y - 40 - Math.random() * 80, 1.1); q.vy = -40 - Math.random() * 80; q.c = c; q.s = 10 + Math.random() * 8; q.t = -Math.random() * 0.4; }
    this.screenTint(c, 0.22, 0.6); this.impact(0.14, 0.05);
  }
  pitOf(obj) { const W = this.game.world; return obj === 'dragon' ? W.pits.kami : W.pits.kraken; }
  consumeEvents(byId) {
    const g = this.game, ev = g.events;
    if (ev.length - this.evIdx > 60) this.evIdx = ev.length - 60; // came back from a hidden tab: skip the backlog
    for (; this.evIdx < ev.length; this.evIdx++) {
      const e = ev[this.evIdx];
      if (g.tick - e.t > 40) continue;
      switch (e.type) {
        case 'kill': {
          const v = byId.get(e.victim), k = e.killer ? byId.get(e.killer) : null;
          if (!v || !this.visiblePoint(e.x, e.y)) break;
          if (k && k.alive && this.onScreen(e.x, e.y, 200)) {
            const w = this.fxp.spawn(P_WISP, e.x, e.y - 22, 2.2); w.target = k.id; w.c = TEAM_COL[k.team]; w.vx = (Math.random() - 0.5) * 120; w.vy = -160;
          } else { const s = this.fxp.spawn(P_SPRITE, e.x, e.y - 20, 1.6); s.sprite = 'spirit'; s.vy = -45; s.s = 1.4; }
          if (k && (k.team === this.viewTeam || this.viewTeam < 0) && this.onScreen(e.x, e.y, 60)) this.coins(e.x, e.y - 18, 9);
          if (k) this.chatter.say(k, 'kill', 2, k.type === 'hero' ? feudLine(k.heroId, v.heroId) : null); // rivals have a line of their own
          if (v.def.pers === 'hothead' && Math.random() < 0.6) this.chatter.say(v, 'tilted', 2); else this.chatter.say(v, 'death', 2);
          break;
        }
        case 'spawn': {
          const o = g.objectives[e.obj]; const p = o || this.pitOf(e.obj);
          if (!this.onScreen(p.x, p.y, 120)) break;
          const c = e.obj === 'dragon' && e.element && DRAGON_INFO[e.element] ? DRAGON_INFO[e.element].color : OBJ_COL[e.obj] || '#fff';
          if (o) this.bossSeen.set(o.id, this.time);
          { const b = this.fxp.spawn(P_BEAM, p.x, p.y + 10, 1.3); b.s = 90; b.s2 = 340; b.c = rgba(c, 0.9); }
          for (let k = 0; k < 16; k++) { const a = Math.random() * 6.283, sp = 60 + Math.random() * 200, q = this.fxp.spawn(P_DEBRIS, p.x + Math.cos(a) * 30, p.y + Math.sin(a) * 18, 1.4); q.vx = Math.cos(a) * sp; q.vy = -200 - Math.random() * 160; q.g = 700; q.c = ['#8a7a6a', '#6b5b52', '#b3957f'][k % 3]; q.s = 3 + (k % 3); q.ground = p.y + Math.sin(a) * 40; }
          for (let k = 0; k < 3; k++) this.ring(p.x, p.y, 20, 220 + k * 40, c, 0.9, 5 - k, k * 0.18);
          for (let k = 0; k < 10; k++) { const a = k / 10 * 6.283; this.puff(p.x + Math.cos(a) * 40, p.y + Math.sin(a) * 24, 8, 30, 'rgba(230,220,200,0.8)', 1.1, Math.cos(a) * 90, Math.sin(a) * 40); }
          this.text(p.x, p.y - 150, 'ROOAAR!', c, 18, 1.4, 'crit');
          this.shakeBy(0.45);
          break;
        }
        case 'objective': {
          const p = this.pitOf(e.obj); if (!this.onScreen(p.x, p.y, 120) || !this.visiblePoint(p.x, p.y)) break;
          this.burst(p.x, p.y - 40, 30, [TEAM_COL[e.team], '#ffffff', '#ffd84a'], 80, 280, 160, 380, 4, 1.2);
          this.ring(p.x, p.y, 20, 200, TEAM_COL[e.team], 0.8, 5); this.shakeBy(0.5); this.freeze(0.1);
          if (e.killer) this.chatter.say(byId.get(e.killer), 'objective', 2);
          break;
        }
        case 'shrine': {
          const sh = g.shrines[e.id] || g.shrines.find((x) => x.id === e.id); if (!sh || !this.onScreen(sh.x, sh.y, 150)) break;
          const c = TEAM_COL[e.team];
          this.ring(sh.x, sh.y, 30, 140, c, 0.8, 5); this.ring(sh.x, sh.y, 20, 100, '#ffffff', 0.6, 2, 0.15); this.ring(sh.x, sh.y, 20, 140, c, 0.8, 3, 0.35);
          const b = this.fxp.spawn(P_BEAM, sh.x, sh.y + 10, 0.9); b.s = 46; b.s2 = 220; b.c = rgba(c, 0.85);
          for (let k = 0; k < 14; k++) { const q = this.fxp.spawn(P_SPARK, sh.x + (Math.random() - 0.5) * 120, sh.y + (Math.random() - 0.5) * 60, 0.8); q.vy = -80 - Math.random() * 80; q.c = c; q.s = 0.7; q.t = -Math.random() * 0.3; }
          this.text(sh.x, sh.y - 120, 'SHRINE CAPTURED', c, 12, 1.4, 'pop');
          break;
        }
        case 'trust': { const x = byId.get(e.hero); if (x && (x.team === this.viewTeam)) this.chatter.say(x, e.tier === 2 ? 'inspired' : e.tier === 0 ? 'doubtful' : 'inspired', 1); break; }
        case 'ultCast': if (Math.random() < 0.5) this.chatter.say(byId.get(e.hero), 'ult', 2); break;
      }
    }
  }
  // Floating world text. Word labels (DUO, LEVEL 6, STUNNED, an ult name...) never print on top of one
  // another: a new one steps up above any recent label at the same spot. Damage numbers just drift.
  text(x, y, s, color, size, dur, style) {
    if (/[A-Za-z]/.test(s)) {
      for (let k = 0, moved = true; k < 4 && moved; k++) {
        moved = false;
        for (let i = this.texts.length - 1, n = 0; i >= 0 && n < 24; i--, n++) {
          const t = this.texts[i];
          if (this.time - t.born > 0.6 || !/[A-Za-z]/.test(t.s)) continue;
          if (Math.abs(t.x - x) < 70 && Math.abs(t.y - y) < (t.size + size) / 2 + 3) { y = t.y - (t.size + size) / 2 - 4; moved = true; }
        }
      }
    }
    this.texts.push({ x, y, s, color, size, dur, born: this.time, style }); if (this.texts.length > 120) this.texts.shift();
  }
  fxSprite(name, x, y, s, follow, delay = 0) {
    const def = FX[name]; if (!def) return;
    this.effects.push({ kind: 'sprite', name, x, y, s, follow, born: this.time + delay, dur: def.frames / 14 });
  }

  // ── main draw ──
  draw(alpha, dt) {
    // hit-stop: visuals crawl for a few frames (the sim keeps its own pace)
    let vdt = dt;
    if (this.hitStop > 0) { this.hitStop -= dt; vdt = dt * 0.1; alpha = this._alpha ?? alpha; } else this._alpha = alpha;
    // fight-cam slow motion online: effects and particles slow down; the sim keeps its pace
    if (this.visSlow) { if (performance.now() < this.visSlow.until && this.motion) vdt *= this.visSlow.k; else this.visSlow = null; }
    this.time += vdt; this.frame++; this._dt = vdt;
    this.govern(dt);
    this.fit();
    // Reduced effects: about a third of the particles; Low graphics the same, Auto-medium about two thirds
    this.fxp.keep = (this.motion ? 1 : 0.35) * [0.35, 0.7, 1][this.detail];
    const g = this.game, ctx = this.ctx;
    if (this.focus) { const k = Math.min(1, dt * 2); this.cam.x += (this.focus.x - this.cam.x) * k; this.cam.y += (this.focus.y - this.cam.y) * k; if (this.focus.zoom) this.cam.zoom += (this.focus.zoom - this.cam.zoom) * k; }
    else if (this.panTo) {
      const k = Math.min(1, dt * 6); this.cam.x += (this.panTo.x - this.cam.x) * k; this.cam.y += (this.panTo.y - this.cam.y) * k;
      if (Math.abs(this.panTo.x - this.cam.x) + Math.abs(this.panTo.y - this.cam.y) < 6) this.panTo = null;
    } else if (this.follow) {
      const u = g.units.find((x) => x.id === this.follow);
      if (u && u.alive) {
        // follow the interpolated position, not the 20 Hz sim one (a stepping target makes the whole world judder)
        const p = this.prev.get(u.id); let fx = u.x, fy = u.y;
        if (p && (u.x - p.x) ** 2 + (u.y - p.y) ** 2 < 200 * 200) { fx = p.x + (u.x - p.x) * alpha; fy = p.y + (u.y - p.y) * alpha; }
        this.cam.x += (fx - this.cam.x) * Math.min(1, dt * 6); this.cam.y += (fy - this.cam.y) * Math.min(1, dt * 6);
      }
    }
    this.punch = Math.max(0, this.punch - dt * 0.25);
    this.clampCam();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = this.theme ? this.theme.sky : '#1b2a1a'; ctx.fillRect(0, 0, this.W, this.H);
    const s = this.scale;
    let shx = 0, shy = 0;
    if (this.trauma > 0) {
      if (!this.motion) this.trauma = 0;
      const m = this.trauma * this.trauma * 12 * this.dpr, t = this.time * 60;
      shx = (Math.sin(t * 1.3) * 0.6 + (Math.random() - 0.5) * 0.8) * m; shy = (Math.cos(t * 1.1) * 0.6 + (Math.random() - 0.5) * 0.8) * m;
      this.trauma = Math.max(0, this.trauma - dt * 1.6);
    }
    ctx.setTransform(s, 0, 0, s, this.W / 2 - this.cam.x * s + shx, this.H / 2 - this.cam.y * s + shy);
    // map
    const vw = this.W / s, vh = this.H / s, x0 = this.cam.x - vw / 2, y0 = this.cam.y - vh / 2;
    const sx = Math.max(0, Math.floor(x0)), sy = Math.max(0, Math.floor(y0));
    const sw = Math.min(MAP_SIZE - sx, Math.ceil(vw) + 2), sh = Math.min(MAP_SIZE - sy, Math.ceil(vh) + 2);
    if (sw > 0 && sh > 0) ctx.drawImage(this.map, sx, sy, sw, sh, sx, sy, sw, sh);
    const inView = (x, y, m = 120) => x > x0 - m && x < x0 + vw + m && y > y0 - m && y < y0 + vh + m;

    this._alphaNow = alpha;
    // ambient ground layer (water shimmer, flowers, flags) under everything that moves
    this.amb.drawGround(ctx, x0, y0, vw, vh, vdt);
    // ground effects: skillshot lanes, telegraphs, zones, ult sigils
    for (const e of this.effects) if (e.kind === 'tele' || e.kind === 'zone' || e.kind === 'lane' || e.kind === 'sigil') this.vfx.drawGround(e);
    // wards
    for (const w of g.wards) if (w.until > g.tick && (w.team === this.viewTeam || this.viewTeam < 0 || !this.fogOn) && inView(w.x, w.y)) {
      ctx.fillStyle = TEAM_COL[w.team]; ctx.globalAlpha = 0.25 + 0.15 * Math.sin(this.time * 4);
      ctx.beginPath(); ctx.arc(w.x, w.y, 10, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
      ctx.fillStyle = '#fff8c8'; ctx.fillRect(w.x - 2, w.y - 12, 4, 10); ctx.fillStyle = TEAM_COL[w.team]; ctx.fillRect(w.x - 3, w.y - 15, 6, 4);
    }
    for (const sh of g.shrines) if (inView(sh.x, sh.y, 200)) this.drawShrine(sh);
    // collect drawables
    const list = [];
    this.heroPos.clear();
    for (const u of g.units) {
      if (!u.alive && !u.structure) continue;
      if (!inView(u.x, u.y, 160)) continue;
      if (!this.visible(u)) continue;
      const p = this.prev.get(u.id);
      let x = u.x, y = u.y;
      if (p && !u.structure) { const dx = u.x - p.x, dy = u.y - p.y; if (dx * dx + dy * dy < 200 * 200) { x = p.x + dx * alpha; y = p.y + dy * alpha; } }
      const d = { u, x, y, moving: p ? (Math.abs(u.x - p.x) + Math.abs(u.y - p.y)) > 0.2 : false };
      if (u.type === 'hero') this.heroPos.set(u.id, d);
      list.push(d);
    }
    list.sort((a, b) => a.y - b.y);
    for (const d of list) if (d.u.type === 'hero' || d.u.type === 'summon') this.drawRing(d);
    this.vfx.drawGhosts();
    this.drawCorpses();
    for (const d of list) this.drawUnit(d);
    for (const d of list) if (d.u.type === 'tower' && d.u.alive) this.drawAggro(d.u);
    // projectiles (interpolated)
    this.vfx.drawProjectiles(g, alpha, inView, (x, y) => this.visiblePoint(x, y));
    // top effects
    this.vfx.drawLines();
    for (const e of this.effects) if (e.kind === 'sprite') this.drawSpriteFx(e); else if (e.kind === 'emote') this.drawEmote(e);
    this.effects = this.effects.filter((e) => this.time - e.born < e.dur);
    this.drawParticles(vdt);
    this.amb.drawAir(ctx, x0, y0, vw, vh, vdt);
    // bars on top
    for (const d of list) this.drawBars(d);
    if (this.frame % 300 === 0) this.pruneHp();
    // fog
    if (this.fogOn && this.viewTeam >= 0) this.drawFog(s, shx, shy);
    this.drawWeather(dt);
    this.evfx.draw(this.ctx, this.W, this.H, dt);
    // texts (above fog)
    ctx.setTransform(s, 0, 0, s, this.W / 2 - this.cam.x * s + shx, this.H / 2 - this.cam.y * s + shy);
    this.drawTexts();
    // screen space: tint, ult callouts, chatter
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.drawTint();
    this.placed = []; // labels placed this frame (callouts, then chatter): later ones keep clear of earlier ones
    this.drawCallouts();
    this.chatter.draw(ctx, (id) => { const d = this.heroPos.get(id); return d && d.u.alive ? d : null; });
  }
  drawTint() {
    const t = this.tint; if (!t) return;
    const k = (this.time - t.born) / t.dur; if (k >= 1 || !this.motion) { this.tint = null; return; }
    const ctx = this.ctx, W = this.W, H = this.H;
    const gr = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.25, W / 2, H / 2, Math.max(W, H) * 0.75);
    gr.addColorStop(0, rgba(t.color, 0)); gr.addColorStop(1, rgba(t.color, t.a * (1 - k) * 2.2));
    ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
    if (k < 0.18) { ctx.globalAlpha = t.a * (1 - k / 0.18) * 0.5; ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
  }
  // Ultimate callout: portrait + hero + ability name, popping above the caster (screen space).
  drawCallouts() {
    if (!this.callouts.length) return;
    const ctx = this.ctx, d = this.dpr, now = this.time, ts = textScale();
    this.callouts = this.callouts.filter((c) => now - c.born < c.dur);
    this.callouts.forEach((c, i) => {
      const p = this.heroPos.get(c.id); if (!p) return;
      const tt = now - c.born, k = tt / c.dur;
      const pop = !this.motion ? 1 : tt < 0.16 ? 0.5 + 0.7 * (tt / 0.16) : tt < 0.28 ? 1.2 - 0.2 * ((tt - 0.16) / 0.12) : 1;
      const a = k > 0.8 ? (1 - k) / 0.2 : 1;
      const sp = this.w2s(p.x, p.y - 86);
      const f1 = Math.round(14 * ts * d), f2 = Math.round(8 * ts * d), face = 30 * d;
      ctx.font = `${f1}px PixelFont, monospace`;
      const ult = sp_(tr(c.ult).toUpperCase() + '!'), nm = sp_(c.name.toUpperCase());
      const w1 = ctx.measureText(ult).width; ctx.font = `${f2}px PixelFont, monospace`; const w2 = ctx.measureText(nm).width;
      const w = face + Math.max(w1, w2) + 22 * d, hh = face + 8 * d;
      const x = Math.max(w / 2 + 6 * d, Math.min(this.W - w / 2 - 6 * d, sp.x)), y = this.dodge(x, Math.min(this.H * 0.7, Math.max(hh + 8 * d, sp.y - i * (hh + 6 * d))), w, hh);
      ctx.save(); ctx.globalAlpha = a; ctx.translate(x, y); ctx.scale(pop, pop);
      const bx = -w / 2, by = -hh, col = TEAM_COL[c.team];
      ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(bx + 3 * d, by + 3 * d, w, hh);
      ctx.fillStyle = col; ctx.fillRect(bx - 2 * d, by - 2 * d, w + 4 * d, hh + 4 * d);
      ctx.fillStyle = '#16111f'; ctx.fillRect(bx, by, w, hh);
      const shine = (tt * 1.6) % 1.6; if (shine < 1) { ctx.globalAlpha = a * 0.18; ctx.fillStyle = '#fff'; ctx.fillRect(bx + w * shine - 10 * d, by, 8 * d, hh); ctx.globalAlpha = a; }
      const img = IMG['face_' + c.heroId]; if (img) ctx.drawImage(img, 4, 4, 30, 30, bx + 4 * d, by + 4 * d, face, face);
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.font = `${f2}px PixelFont, monospace`; ctx.fillStyle = col; ctx.fillText(nm, bx + face + 12 * d, by + hh * 0.3);
      ctx.font = `${f1}px PixelFont, monospace`; ctx.fillStyle = '#000'; ctx.fillText(ult, bx + face + 12 * d + d, by + hh * 0.66 + d); ctx.fillStyle = '#ffe3a3'; ctx.fillText(ult, bx + face + 12 * d, by + hh * 0.66);
      ctx.restore();
    });
  }
  // Screen-space labels (ult callouts, chatter) keep clear of the HUD panels (`avoid` holds their CSS-px rects,
  // refreshed by the HUD a few times a second) and of the labels already placed this frame (they stack upward,
  // or below when there is no room above). Box = [x - w/2, x + w/2] x [y - h, y] in device px; returns a y.
  dodge(x, y, w, h) {
    const d = this.dpr, panels = (this.avoid || []).map((q) => ({ l: q.l * d, r: q.r * d, t: q.t * d, b: q.b * d })), placed = this.placed || [];
    const hit = (q) => !(x + w / 2 <= q.l || x - w / 2 >= q.r || y <= q.t || y - h >= q.b);
    for (let pass = 0; pass < 6; pass++) {
      let moved = false;
      for (const q of panels) if (hit(q)) { y = (q.t + q.b) / 2 < this.H / 2 ? q.b + h + 2 * d : q.t - 2 * d; moved = true; } // below a top panel, above a bottom one
      for (const q of placed) if (hit(q)) { y = q.t - 2 * d - h > 0 ? q.t - 2 * d : q.b + h + 2 * d; moved = true; }
      if (!moved) break;
    }
    placed.push({ l: x - w / 2, r: x + w / 2, t: y - h, b: y });
    return y;
  }
  pruneHp() { const live = this.byIdMap; if (!live) return; for (const id of this.hpT.keys()) { const u = live.get(id); if (!u || (!u.alive && !u.structure)) this.hpT.delete(id); } }
  // Smoothed HP front + delayed "damage taken" trail.
  hpOf(u) {
    const f = Math.max(0, Math.min(1, u.hp / u.maxHp)), dt = this._dt || 0.016;
    let s = this.hpT.get(u.id);
    if (!s) { s = { f, trail: f, hold: 0 }; this.hpT.set(u.id, s); return s; }
    if (f < s.f - 0.002) s.hold = 0.4;
    s.f += (f - s.f) * Math.min(1, dt * 20);
    if (f >= s.trail) s.trail = f; else if (s.hold > 0) s.hold -= dt; else s.trail += (f - s.trail) * Math.min(1, dt * 4.5);
    return s;
  }
  bar(x, y, w, h, u, col, dark) {
    const ctx = this.ctx, s = this.hpOf(u);
    ctx.fillStyle = 'rgba(0,0,0,0.78)'; ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    ctx.fillStyle = dark || '#2b2233'; ctx.fillRect(x, y, w, h);
    if (s.trail > s.f) { ctx.fillStyle = '#fff1b8'; ctx.fillRect(x + w * s.f, y, w * (s.trail - s.f), h); }
    ctx.fillStyle = col; ctx.fillRect(x, y, w * s.f, h);
    ctx.fillStyle = 'rgba(255,255,255,0.28)'; ctx.fillRect(x, y, w * s.f, Math.max(1, h * 0.35));
    return s;
  }

  drawShrine(sh) {
    const ctx = this.ctx, g = this.game, t = this.time;
    const col = sh.owner >= 0 ? TEAM_COL[sh.owner] : '#ffe9a8';
    const locked = g.time < TIMERS.shrineUnlock;
    // glow pool
    const gr = ctx.createRadialGradient(sh.x, sh.y, 6, sh.x, sh.y, 120);
    gr.addColorStop(0, sh.owner >= 0 ? rgba(TEAM_COL[sh.owner], 0.45) : 'rgba(255,233,168,0.35)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gr; ctx.beginPath(); ctx.ellipse(sh.x, sh.y, 120, 100, 0, 0, Math.PI * 2); ctx.fill();
    // capture ring
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.beginPath(); ctx.ellipse(sh.x, sh.y, 112, 94, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = col; ctx.globalAlpha = locked ? 0.3 : 0.8; ctx.setLineDash([8, 6]); ctx.lineDashOffset = -t * 20;
    ctx.beginPath(); ctx.ellipse(sh.x, sh.y, 112, 94, 0, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
    if (sh.capTeam >= 0 && sh.progress > 0) {
      ctx.strokeStyle = TEAM_COL[sh.capTeam]; ctx.lineWidth = 6;
      ctx.beginPath(); ctx.ellipse(sh.x, sh.y, 112, 94, 0, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, sh.progress / TIMERS.shrineCapture)); ctx.stroke();
    }
    // crystal
    const stage = 0, c = VAR.crystal && (sh.owner >= 0 ? VAR.crystal[stage][sh.owner] : VAR.crystalNeutral);
    const bob = Math.sin(t * 2 + sh.id) * 4, sc = 2.2;
    if (c) ctx.drawImage(c, sh.x - 16 * sc, sh.y - 30 * sc + 10 + bob, 32 * sc, 32 * sc);
    if (sh.owner >= 0 && Math.random() < 0.08) this.fxSprite('spark', sh.x + (Math.random() - 0.5) * 60, sh.y - 30 - Math.random() * 40, 0.6);
  }

  // Screen-space weather particles + tint.
  drawWeather(dt) {
    const g = this.game, w = g.weatherList[Math.max(0, g.weatherIdx)] || 'clear', ctx = this.ctx, W = this.W, H = this.H;
    if (this.wxName !== w) { this.wxName = w; this.parts = []; this.wxFade = 0; }
    this.wxFade = Math.min(1, (this.wxFade || 0) + dt * 0.5);
    if (w === 'clear') return;
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
    const k = this.wxFade, d = this.dpr;
    const tint = { rain: 'rgba(40,60,110,0.16)', fog: 'rgba(200,210,225,0.22)', snow: 'rgba(220,235,255,0.08)', blizzard: 'rgba(225,238,255,0.26)', heat: 'rgba(255,140,40,0.10)', dust: 'rgba(200,150,80,0.20)', wind: 'rgba(255,255,255,0.0)' }[w];
    if (tint) { ctx.globalAlpha = k; ctx.fillStyle = tint; ctx.fillRect(0, 0, W, H); }
    const want = { rain: 140, snow: 110, blizzard: 260, wind: 40, dust: 90, heat: 0, fog: 0 }[w] || 0;
    const P = this.parts;
    while (P.length < want) P.push({ x: Math.random() * W, y: Math.random() * H, v: 0.6 + Math.random() * 0.8, s: Math.random() });
    ctx.globalAlpha = k;
    for (const p of P) {
      if (w === 'rain') { p.x -= 160 * dt * d * p.v; p.y += 900 * dt * d * p.v; ctx.strokeStyle = 'rgba(180,210,255,0.55)'; ctx.lineWidth = d; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + 4 * d, p.y - 14 * d); ctx.stroke(); }
      else if (w === 'snow' || w === 'blizzard') { const sp = w === 'blizzard' ? 3.2 : 1; p.x += (Math.sin(this.time * 2 + p.s * 9) * 20 - 60 * sp) * dt * d; p.y += 70 * sp * dt * d * p.v; ctx.fillStyle = 'rgba(255,255,255,0.85)'; const r = (1 + p.s * 2) * d; ctx.fillRect(p.x, p.y, r, r); }
      else if (w === 'wind') { p.x += 380 * dt * d * p.v; p.y += Math.sin(this.time * 3 + p.s * 7) * 40 * dt * d; ctx.fillStyle = p.s > 0.5 ? '#9cc95a' : '#e7b04a'; ctx.fillRect(p.x, p.y, 3 * d, 2 * d); }
      else if (w === 'dust') { p.x += 520 * dt * d * p.v; p.y += 30 * dt * d; ctx.fillStyle = 'rgba(230,190,120,0.5)'; ctx.fillRect(p.x, p.y, 8 * d * p.v, d); }
      if (p.y > H + 20) { p.y = -20; p.x = Math.random() * W * 1.2; } if (p.x < -40) p.x = W + 20; if (p.x > W + 40) p.x = -20;
    }
    if (w === 'fog') {
      // drifting mist banks: one cached soft blob, scaled (a full-screen radial gradient per bank cost ~4 ms each on phones)
      if (!this.mistBlob) {
        const c = this.mistBlob = document.createElement('canvas'); c.width = c.height = 64;
        const x = c.getContext('2d'), gr = x.createRadialGradient(32, 32, 1, 32, 32, 32);
        gr.addColorStop(0, 'rgba(225,230,240,0.18)'); gr.addColorStop(1, 'rgba(225,230,240,0)'); x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
      }
      ctx.imageSmoothingEnabled = true;
      const R = W * 0.4;
      for (let i = 0; i < 4; i++) {
        const x = (Math.sin(this.time * 0.07 + i * 1.7) * 0.5 + 0.5) * W, y = (Math.cos(this.time * 0.05 + i * 2.3) * 0.5 + 0.5) * H;
        ctx.drawImage(this.mistBlob, x - R, y - R, R * 2, R * 2);
      }
    }
    if (w === 'heat') { ctx.globalAlpha = 0.05 + 0.03 * Math.sin(this.time * 3); ctx.fillStyle = '#ffcf6a'; ctx.fillRect(0, 0, W, H); }
    ctx.restore();
  }

  // Bottom-anchored sheet frame; sx / sy squash and stretch around the feet.
  drawSheetFrame(img, fw, fh, col, row, x, y, scale, flip, sx = 1, sy = 1) {
    const ctx = this.ctx, w = fw * scale * sx, h = fh * scale * sy;
    if (flip) { ctx.save(); ctx.translate(Math.round(x), 0); ctx.scale(-1, 1); ctx.drawImage(img, col * fw, row * fh, fw, fh, -w / 2, Math.round(y - h), w, h); ctx.restore(); }
    else ctx.drawImage(img, col * fw, row * fh, fw, fh, Math.round(x - w / 2), Math.round(y - h), w, h);
  }
  // Team ring under heroes (and the Herald summon): ally = solid ring, enemy = ring with side notches;
  // the followed hero gets a turning dashed halo; under 30% HP the ring pulses red, faster as HP drops.
  drawRing(d) {
    const { u, x, y } = d, ctx = this.ctx, col = TEAM_COL[u.team], rx = u.type === 'summon' ? 22 : 16, ry = rx * 0.45, yy = y + 2;
    const el = () => { ctx.beginPath(); ctx.ellipse(x, yy, rx, ry, 0, 0, Math.PI * 2); };
    ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.beginPath(); ctx.ellipse(x, yy + 1, rx + 1, ry + 1, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 0.24; ctx.fillStyle = col; el(); ctx.fill();
    ctx.globalAlpha = 0.55; ctx.strokeStyle = '#000'; ctx.lineWidth = 4; el(); ctx.stroke();
    ctx.globalAlpha = 1; ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.stroke();
    if (this.viewTeam >= 0 && u.team !== this.viewTeam) { ctx.fillStyle = col; ctx.fillRect(Math.round(x - rx - 4), Math.round(yy - 1.5), 5, 3); ctx.fillRect(Math.round(x + rx - 1), Math.round(yy - 1.5), 5, 3); }
    if (this.follow === u.id) {
      ctx.globalAlpha = 0.85; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 5]); ctx.lineDashOffset = this.motion ? -this.time * 14 : 0;
      ctx.beginPath(); ctx.ellipse(x, yy, rx + 5, ry + 3, 0, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
    }
    const f = u.hp / u.maxHp;
    if (u.type === 'hero' && f < 0.3) {
      const pulse = this.motion ? 0.5 + 0.5 * Math.sin(this.time * (7 + (0.3 - f) * 30)) : 0.6;
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.25 + 0.35 * pulse; ctx.drawImage(glowSprite('#ff3b3b'), x - rx * 1.8, yy - ry * 2.2, rx * 3.6, ry * 4.4); ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 0.5 + 0.5 * pulse; ctx.strokeStyle = '#ff3b3b'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.ellipse(x, yy, rx + 2 + pulse * 2, ry + 1 + pulse, 0, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;
    }
  }
  // Tower aggro: a line from the tower's eye to its current target. Hero targets get a bold pulsing beam and a
  // reticle (that dive is about to hurt); minion targets only a faint thread.
  drawAggro(u) {
    const t = u.target; if (!t || !t.alive || !this.visible(t)) return;
    const d = this.heroPos.get(t.id), tx = d ? d.x : t.x, ty = (d ? d.y : t.y) - 12, sx = u.x, sy = u.y - (u.tier === 4 ? 62 : 70);
    const ctx = this.ctx, col = TEAM_COL[u.team], hero = t.type === 'hero';
    if (!hero) { ctx.globalAlpha = 0.28; ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(tx, ty); ctx.stroke(); ctx.globalAlpha = 1; return; }
    const pulse = this.motion ? 0.5 + 0.5 * Math.sin(this.time * 10) : 0.7;
    ctx.globalAlpha = 0.5; ctx.strokeStyle = '#000'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(tx, ty); ctx.stroke();
    ctx.globalAlpha = 0.6 + 0.4 * pulse; ctx.strokeStyle = col; ctx.lineWidth = 2.5; ctx.setLineDash([8, 5]); ctx.lineDashOffset = this.motion ? -this.time * 60 : 0; ctx.stroke(); ctx.setLineDash([]);
    ctx.lineWidth = 2; const r = 13 + pulse * 2; ctx.beginPath();
    for (let q = 0; q < 4; q++) { const a = q * Math.PI / 2; ctx.moveTo(tx + Math.cos(a) * r, ty + Math.sin(a) * r); ctx.lineTo(tx + Math.cos(a) * (r - 6), ty + Math.sin(a) * (r - 6)); }
    ctx.stroke(); ctx.beginPath(); ctx.arc(tx, ty, r - 3, 0, Math.PI * 2); ctx.globalAlpha = 0.5; ctx.stroke(); ctx.globalAlpha = 1;
  }
  // Death fade: the last frame flashes white, squashes into the ground and fades.
  drawCorpses() {
    if (!this.corpses.length) return;
    const ctx = this.ctx; this.corpses = this.corpses.filter((c) => this.time - c.born < c.dur);
    for (const c of this.corpses) {
      const u = c.u, k = (this.time - c.born) / c.dur, sy = 1 - 0.55 * k * k, sx = 1 + 0.25 * k;
      ctx.globalAlpha = 1 - k;
      if (u.type === 'hero') { const img = this.heroImg(u); if (img) this.drawSheetFrame(k < 0.2 ? flashOf(img._fk || 'hero_' + u.heroId, img) : img, 16, 16, u.facing, 5, c.x, c.y + 4, 2.2, false, sx, sy); }
      else if (u.type === 'minion') { const key = `minion_${u.team ? 'red' : 'blue'}_${u.kind === 'super' ? 'siege' : u.kind}`, img = IMG[key]; if (img) this.drawSheetFrame(k < 0.3 ? flashOf(key, img) : img, 16, 16, u.facing, 0, c.x, c.y + 3, u.kind === 'super' ? 2.4 : u.kind === 'siege' ? 1.9 : 1.5, false, sx, sy); }
      else if (u.type === 'mob') { const img = IMG[u.kind]; if (img) this.drawSheetFrame(k < 0.3 ? flashOf(u.kind, img) : img, 16, 16, u.facing, 0, c.x, c.y + 3, u.big ? 2.6 : 1.7, false, sx, sy); }
      else if (u.type === 'objective' && u.kind !== 'dragon') { ctx.save(); ctx.translate(c.x, c.y); ctx.scale(sx, sy); ctx.translate(-c.x, -c.y); this.drawBoss(u, c.x, c.y, k < 0.3, false); ctx.restore(); }
    }
    ctx.globalAlpha = 1;
  }
  // Render-only knock-up arc: a parabola over the airborne time (the sim only stores the end tick).
  liftOf(u, tk) {
    const g = this.game;
    if (!(u.knockUntil > g.tick)) { this.knock.delete(u.id); return 0; }
    let k = this.knock.get(u.id); if (!k || k.end !== u.knockUntil) { k = { start: tk, end: u.knockUntil }; this.knock.set(u.id, k); }
    const p = Math.max(0, Math.min(1, (tk - k.start) / Math.max(1, k.end - k.start)));
    return 4 * p * (1 - p) * 26;
  }

  drawUnit(d) {
    const { u } = d; let { x, y } = d;
    const ctx = this.ctx, g = this.game;
    const flashT = this.flashes.get(u.id);
    const flashing = flashT !== undefined && this.time - flashT < 0.08;
    if (u.structure) return this.drawStructure(u, flashing);
    if (u.type !== 'hero' && u.type !== 'summon') {
      const big = u.type === 'objective' ? 2.4 : u.type === 'mob' && u.big ? 1.6 : 0.8;
      ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.beginPath(); ctx.ellipse(x, y + 2, 9 * big, 4 * big, 0, 0, Math.PI * 2); ctx.fill();
    }
    const tk = g.tick + (this._alphaNow || 0), lift = this.motion ? this.liftOf(u, tk) : 0;
    const walkF = Math.floor(this.time * 8 + u.id) % 4;
    const attacking = g.tick - u.animAttack < 6;
    // squash on hit, stretch on spawn, bob on the walk, breathe at rest, lunge on attacks
    let sx = 1, sy = 1;
    if (this.motion) {
      const hk = flashT !== undefined ? this.time - flashT : 9;
      if (hk < 0.16) { const e = 1 - hk / 0.16; sx += 0.16 * e; sy -= 0.14 * e; }
      if (d.moving) y -= Math.abs(Math.sin(this.time * 12.6 + u.id)) * 1.6; else sy *= 1 + 0.025 * Math.sin(this.time * 3 + u.id);
      if (attacking && !u.dash) { const at = Math.min(1, Math.max(0, (tk - u.animAttack) / 6)), l = Math.sin(at * Math.PI) * 4, dir = [[0, 1], [0, -1], [-1, 0], [1, 0]][u.facing] || [0, 0]; x += dir[0] * l; y += dir[1] * l * 0.6; }
      if (lift > 0) { sx *= 0.92; sy *= 1.08; }
    }
    if (u.type === 'hero') {
      const img = this.heroImg(u); if (!img) return;
      const ct = this.castT.get(u.id), casting = ct !== undefined && this.time - ct < 0.3;
      const dashing = u.dash && !u.dash.pulled;
      let row = attacking ? 4 : d.moving ? walkF : 0, col = u.facing;
      if (dashing) row = 5; else if (casting && !d.moving) { row = 6; col = 1; }
      const src = flashing ? flashOf(img._fk || 'hero_' + u.heroId, img) : img;
      if (u.recallAt) { ctx.strokeStyle = '#7fe0ff'; ctx.lineWidth = 2; const p = 1 - (u.recallAt - g.tick) / (4 * TICK_RATE); ctx.beginPath(); ctx.arc(x, y - 12, 22, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2); ctx.stroke(); }
      const hidden = u.stealthUntil > g.tick || g.world.inBrush(u.x, u.y);
      let a = hidden ? 0.55 : 1;
      const st = this.spawnT.get(u.id);
      if (st !== undefined) { const k = (this.time - st) / 0.45; if (k >= 1) this.spawnT.delete(u.id); else { a *= k; if (this.motion) { sy *= 1 + 0.4 * (1 - k); sx *= 1 - 0.25 * (1 - k); } } }
      if (u.ultUp) drawUltUp(this, u, x, y); // v23: empowered ultimate tell, under the sprite
      if (dashing && this.motion) this.vfx.afterimage(u, x, y + 4 - lift, col, row, 2.2);
      ctx.globalAlpha = a;
      this.drawSheetFrame(src, 16, 16, col, row, x, y + 4 - lift, 2.2, false, sx, sy);
      ctx.globalAlpha = 1;
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
      this.drawSheetFrame(flashing ? flashOf(key, img) : img, 16, 16, u.facing, d.moving ? walkF : 0, x, y + 3 - lift, sc, false, sx, sy);
      if (u.empowered) { ctx.globalAlpha = 0.3; ctx.fillStyle = '#b56cff'; ctx.beginPath(); ctx.arc(x, y - 10, 10, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1; }
      return;
    }
    if (u.type === 'mob') {
      const img = IMG[u.kind]; if (!img) return;
      this.drawSheetFrame(flashing ? flashOf(u.kind, img) : img, 16, 16, u.facing, d.moving ? walkF : (Math.floor(this.time * 3 + u.id) % 2), x, y + 3 - lift, u.big ? 2.6 : 1.7, false, sx, sy);
      return;
    }
    if (u.type === 'summon') {
      const img = IMG.herald_walk; if (!img) return;
      const f = Math.floor(this.time * 10) % 6;
      this.drawSheetFrame(img, 50, 50, f, 0, x, y + 8, 1.3, u.facing === 2);
      return;
    }
    if (u.type === 'objective') {
      // spawn rise: the boss grows out of the pit over 0.9 s
      const rt = this.bossSeen.get(u.id), k = rt === undefined ? 1 : Math.min(1, (this.time - rt) / 0.9);
      if (k < 1 && this.motion) { const e = 1 - (1 - k) ** 3; ctx.save(); ctx.globalAlpha = Math.min(1, k * 2); ctx.translate(x, y); ctx.scale(0.3 + 0.7 * e, 0.2 + 0.8 * e); ctx.translate(-x, -y); this.drawBoss(u, x, y, flashing || k < 0.15, attacking); ctx.restore(); ctx.globalAlpha = 1; return; }
      return this.drawBoss(u, x, y, flashing, attacking);
    }
  }

  // Status pips (v20): tiny glyphs right of the HP bar, plus a ground ring when rooted and a
  // reticle over marked heroes. Only for effects that change decisions; stun keeps its stars.
  drawStatus(u, x, y, px, py) {
    const ctx = this.ctx, t = this.game.tick, pips = [];
    if (u.silenceUntil > t) pips.push('silence');
    if (u.fearUntil > t) pips.push('fear');
    if (u.rootUntil > t) pips.push('root');
    if (u.shredUntil > t && u.shred > 0) pips.push('shred');
    if (u.grievousUntil > t) pips.push('grievous');
    if (u.slows.some((s) => s.until > t)) pips.push('slow');
    if (u.rootUntil > t) { ctx.strokeStyle = STATUS_COL.root; ctx.globalAlpha = 0.8; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(x, y + 2, 15, 6, 0, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1; }
    if (u.mark && u.mark.until > t) {
      const my = py - 12 + (this.motion ? Math.sin(this.time * 6) * 1.5 : 0); ctx.strokeStyle = STATUS_COL.mark; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x, my - 5); ctx.lineTo(x + 5, my); ctx.lineTo(x, my + 5); ctx.lineTo(x - 5, my); ctx.closePath(); ctx.stroke();
      ctx.fillStyle = STATUS_COL.mark; ctx.fillRect(x - 1, my - 1, 2, 2);
    }
    if (u.fearUntil > t) { ctx.globalAlpha = 0.22; ctx.fillStyle = STATUS_COL.fear; ctx.beginPath(); ctx.arc(x, y - 14, 17, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1; }
    for (let i = 0; i < Math.min(3, pips.length); i++) {
      const k = pips[i], bx = Math.round(px + i * 8), by = Math.round(py);
      ctx.fillStyle = 'rgba(0,0,0,0.75)'; ctx.fillRect(bx - 1, by - 1, 8, 8);
      ctx.fillStyle = STATUS_COL[k];
      switch (k) {
        case 'silence': ctx.fillRect(bx, by, 6, 6); ctx.fillStyle = '#fff'; ctx.fillRect(bx + 1, by + 2, 4, 2); break; // muted
        case 'fear': ctx.fillRect(bx + 2, by, 2, 4); ctx.fillRect(bx + 2, by + 5, 2, 1); break; // "!"
        case 'root': ctx.fillRect(bx, by + 4, 6, 2); ctx.fillRect(bx + 1, by + 1, 1, 3); ctx.fillRect(bx + 4, by + 2, 1, 2); break; // vines
        case 'shred': ctx.fillRect(bx, by, 6, 3); ctx.fillRect(bx + 1, by + 3, 4, 2); ctx.fillStyle = '#000'; ctx.fillRect(bx + 3, by, 1, 4); break; // cracked shield
        case 'grievous': for (let q = 0; q < 6; q++) { ctx.fillRect(bx + q, by + q, 1, 1); ctx.fillRect(bx + 5 - q, by + q, 1, 1); } break; // X
        case 'slow': ctx.fillRect(bx, by + 1, 6, 1); ctx.fillRect(bx + 1, by + 2, 4, 1); ctx.fillRect(bx + 2, by + 3, 2, 2); break; // down arrow
      }
    }
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

  drawParticles(dt) {
    this.fxp.update(dt, (id) => this.unitPos(id));
    this.fxp.draw(this.ctx, this.time, (w) => { const p = this.fxp.spawn(P_SQUARE, w.x + (Math.random() - 0.5) * 6, w.y + (Math.random() - 0.5) * 6, 0.35); p.c = w.c; p.s = 2; p.vy = -10; });
  }
  drawEmote(e) {
    const u = this.game.units.find((q) => q.id === e.id); const img = IMG['emote_' + e.e];
    if (!u || !u.alive || !img) return;
    const k = (this.time - e.born) / e.dur, pop = k < 0.15 ? k / 0.15 : 1;
    this.ctx.globalAlpha = k > 0.8 ? (1 - k) / 0.2 : 1;
    const sc = 2 * pop;
    this.ctx.drawImage(img, Math.round(u.x - 7 * sc), Math.round(u.y - 74 - 13 * sc + Math.sin(this.time * 6) * 2), 14 * sc, 13 * sc);
    this.ctx.globalAlpha = 1;
  }
  drawSpriteFx(e) {
    if (this.time < e.born) return;
    const def = FX[e.name]; const img = IMG['fx_' + (def.img || e.name)]; if (!img) return;
    const fw = img.width / def.frames, fh = img.height;
    const f = Math.min(def.frames - 1, Math.floor((this.time - e.born) / e.dur * def.frames));
    let x = e.x, y = e.y;
    if (e.follow) { const d = this.heroPos.get(e.follow), u = d ? d.u : this.byIdMap && this.byIdMap.get(e.follow); if (u && u.alive) { x = d ? d.x : u.x; y = (d ? d.y : u.y) - 12; } }
    const sc = 1.6 * e.s;
    this.ctx.drawImage(img, f * fw, 0, fw, fh, Math.round(x - fw * sc / 2), Math.round(y - fh * sc / 2), fw * sc, fh * sc);
  }

  drawBars(d) {
    const { u } = d, ctx = this.ctx, g = this.game;
    if (!u.alive) return;
    const x = d.x, y = d.y;
    if (u.type === 'hero') {
      const w = 40, h = 5, top = y - 46, pct = u.hp / u.maxHp;
      this.bar(x - w / 2, top, w, h, u, TEAM_COL[u.team], TEAM_DARK[u.team]);
      const sh = g.shieldTotal(u); if (sh > 0) { ctx.fillStyle = '#eee'; ctx.fillRect(x - w / 2 + w * Math.min(1, pct), top, Math.min(w, w * sh / u.maxHp), h); }
      // ticks every 250hp
      ctx.fillStyle = 'rgba(0,0,0,0.5)'; for (let k = 250; k < u.maxHp; k += 250) ctx.fillRect(x - w / 2 + w * k / u.maxHp, top, 1, h);
      if (pct < 0.25) { ctx.globalAlpha = 0.5 + 0.5 * Math.sin(this.time * 12); ctx.strokeStyle = '#ff3b3b'; ctx.lineWidth = 1.5; ctx.strokeRect(x - w / 2 - 2, top - 2, w + 4, h + 4); ctx.globalAlpha = 1; }
      // level badge
      ctx.fillStyle = '#111'; ctx.fillRect(x - w / 2 - 12, top - 2, 11, 9);
      ctx.fillStyle = '#fff'; ctx.font = '7px PixelFont, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(u.level), x - w / 2 - 6.5, top + 2.6);
      if (this.showNames) { ctx.font = '7px PixelFont, monospace'; ctx.fillStyle = '#000'; const nm = sp_(u.def.name); ctx.fillText(nm, x + 0.6, top - 5.4); ctx.fillStyle = u.team === this.viewTeam ? '#fff' : '#ffd0d0'; ctx.fillText(nm, x, top - 6); }
      this.drawStatus(u, x, y, x + w / 2 + 2, top - 1);
      return;
    }
    if (u.structure) {
      if (u.hp >= u.maxHp && !(u.type === 'nexus')) return;
      const w = u.type === 'nexus' ? 80 : 56, top = u.y - (u.type === 'nexus' ? 100 : u.tier === 4 ? 82 : 90);
      this.bar(u.x - w / 2, top, w, 4, u, TEAM_COL[u.team]);
      return;
    }
    if (u.type === 'objective') {
      const w = 70, top = y - (u.kind === 'baron' ? 160 : u.kind === 'dragon' ? 130 : 110);
      this.bar(x - w / 2, top, w, 5, u, u.kind === 'dragon' ? DRAGON_INFO[u.element].color : u.kind === 'baron' ? '#b56cff' : '#9fd0ff');
      ctx.font = '8px PixelFont, monospace'; ctx.textAlign = 'center'; ctx.fillStyle = '#000';
      const nm = sp_(u.kind === 'dragon' ? DRAGON_INFO[u.element].name : OBJ_NAME[u.kind]);
      ctx.fillText(nm, x + 0.6, top - 6.4); ctx.fillStyle = '#fff'; ctx.fillText(nm, x, top - 7);
      return;
    }
    if (u.hp < u.maxHp || u.type === 'summon') {
      const w = u.type === 'summon' ? 44 : u.type === 'mob' && u.big ? 34 : 18, top = y - (u.type === 'summon' ? 66 : u.type === 'mob' && u.big ? 44 : 28);
      if (u.type === 'minion') { ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(x - w / 2 - 1, top - 1, w + 2, 4); ctx.fillStyle = TEAM_COL[u.team]; ctx.fillRect(x - w / 2, top, w * u.hp / u.maxHp, 2); }
      else this.bar(x - w / 2, top, w, u.type === 'summon' ? 3 : 2, u, u.team === 2 ? '#e8c45a' : TEAM_COL[u.team]);
    }
  }

  // Fog from the team's line-of-sight grid: smoothed over time, upscaled with bilinear filtering.
  drawFog(s, shx, shy) {
    const g = this.game, grid = g.visGrid[this.viewTeam], sm = this.fogSmooth, d = this.fogImg.data;
    const [fr, fg, fb] = this.theme.fog;
    for (let i = 0; i < grid.length; i++) {
      sm[i] += ((grid[i] ? 0 : 1) - sm[i]) * 0.18;
      const o = i * 4; d[o] = fr; d[o + 1] = fg; d[o + 2] = fb; d[o + 3] = sm[i] * 150;
    }
    this.fogTexCtx.putImageData(this.fogImg, 0, 0);
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(s, 0, 0, s, this.W / 2 - this.cam.x * s + shx, this.H / 2 - this.cam.y * s + shy);
    ctx.imageSmoothingEnabled = true;
    // only the cells in view (plus one for the filter): blitting the whole 100x100 grid as a 2400px quad costs ~2x
    const C = MAP_SIZE / GN, vw = this.W / s, vh = this.H / s;
    const cx0 = Math.max(0, Math.floor((this.cam.x - vw / 2) / C) - 1), cy0 = Math.max(0, Math.floor((this.cam.y - vh / 2) / C) - 1);
    const cx1 = Math.min(GN, Math.ceil((this.cam.x + vw / 2) / C) + 1), cy1 = Math.min(GN, Math.ceil((this.cam.y + vh / 2) / C) + 1);
    if (cx1 > cx0 && cy1 > cy0) ctx.drawImage(this.fogTex, cx0, cy0, cx1 - cx0, cy1 - cy0, cx0 * C, cy0 * C, (cx1 - cx0) * C, (cy1 - cy0) * C);
    ctx.restore();
    ctx.imageSmoothingEnabled = false;
  }

  drawTexts() {
    const ctx = this.ctx, motion = this.motion;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    this.texts = this.texts.filter((t) => this.time - t.born < t.dur);
    for (const t of this.texts) {
      const tt = this.time - t.born, k = tt / t.dur;
      let y = t.y - k * (t.style ? 14 : 22), sc;
      if (!motion) sc = 1;
      else if (t.style === 'crit' || t.style === 'exec') sc = 1 + 1.1 * Math.exp(-tt * 9) * Math.cos(tt * 26); // springy overshoot
      else if (t.style === 'pop') sc = 1 + 0.6 * Math.exp(-tt * 12) * Math.cos(tt * 22);
      else sc = k < 0.12 ? 1 + (1 - k / 0.12) * 0.6 : 1;
      if (t.style === 'exec') y -= Math.min(1, tt * 6) * 10;
      ctx.globalAlpha = k > 0.7 ? (1 - k) / 0.3 : 1;
      ctx.font = `${Math.max(4, Math.round(t.size * sc))}px PixelFont, monospace`;
      const str = sp_(tr(t.s));
      if (t.style === 'exec' || t.style === 'crit') { ctx.fillStyle = '#000'; for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1.5]]) ctx.fillText(str, t.x + ox, y + oy); }
      else { ctx.fillStyle = '#000'; ctx.fillText(str, t.x + 1, y + 1); }
      ctx.fillStyle = t.style === 'exec' ? (Math.floor(tt * 14) % 2 ? '#ff4040' : '#ffffff') : t.color; ctx.fillText(str, t.x, y);
    }
    ctx.globalAlpha = 1;
  }
}
