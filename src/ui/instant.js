// Instant Replay: after a big fight (3+ takedowns close together, an ace) or a big objective (Kraken, Tengu, a
// tamed parade), a "Replay" chip offers the last 15s again, in slow motion, in a small picture-in-picture panel
// while the live match runs on.
// How: every 10s of game time the live game is copied (src/ui/snapshot.js: a read-only deep copy). On a tap, a
// copy at least 15s old is restored and fast-forwarded headless in small slices to 15s before the moment, then
// played with the match's own command log at half speed and drawn by a second Renderer on the panel's canvas,
// from the coach's own side (same fog), so it never shows more than the coach saw. The live sim is never
// touched and lockstep keeps ticking. (Living World walls sit on the shared World: every copy puts its own back
// before it steps, see Living.sync.)
import { h } from './dom.js';
import { LocalRunner } from '../net/runner.js';
import { Renderer } from '../render/renderer.js';
import { snapshot, restore } from './snapshot.js';
import { audio } from '../audio.js';
import { settings } from './settings.js';

const EVERY = 200, KEEP = 3, BACK = 300, AFTER = 40, OFFER_MS = 12000; // ticks; 20 = 1s
const slow = () => (settings.reducedMotion ? 1 : 0.5); // Reduced effects: no slow motion

export class InstantReplay {
  constructor(app, m, myTeam) {
    this.app = app; this.m = m; this.my = myTeam; this.snaps = []; this.kills = []; this.evIdx = m.game.events.length;
    this.offer = null; this.play = null; this.chip = null; this.panel = null;
  }
  // After every live tick (main.js): keep a few copies, watch the events for a moment worth replaying.
  step() {
    const g = this.m.game;
    if (g.tick % EVERY === 0 && !this.play) { this.snaps.push(snapshot(g)); if (this.snaps.length > KEEP) this.snaps.shift(); }
    const ev = g.events;
    for (; this.evIdx < ev.length; this.evIdx++) {
      const e = ev[this.evIdx];
      if (e.type === 'kill') this.kills.push(e);
      else if ((e.type === 'objective' && (e.obj === 'baron' || e.obj === 'boss' || (e.obj === 'dragon' && e.element === 'elder'))) || e.type === 'tamed') this.mark(e, 3);
    }
    const now = g.tick;
    this.kills = this.kills.filter((k) => now - k.t < 20 * 12);
    // a fight counts once it is over: 3+ takedowns within 12s, then 3s without another
    if (this.kills.length >= 3 && now - this.kills[this.kills.length - 1].t === 60) {
      const k = this.kills; let x = 0, y = 0; for (const e of k) { x += e.x; y += e.y; }
      const aced = [0, 1].some((t) => g.teams[t].heroes.every((u) => !u.alive));
      this.mark({ t: k[k.length - 1].t, x: x / k.length, y: y / k.length, from: k[0].t }, aced ? 3 : 2);
      this.kills = [];
    }
    if (this.offer && performance.now() > this.offer.until && !this.play) this.hideChip();
  }
  mark(e, prio) {
    const g = this.m.game, p = e.x !== undefined ? e : e.obj ? g.objPit(e.obj) : null; if (!p) return;
    if (this.play || (this.offer && this.offer.prio > prio && performance.now() < this.offer.until)) return;
    const end = (e.t || g.tick) + AFTER, start = Math.max(0, (e.from ?? end - BACK) - 60);
    if (!this.snaps.some((s) => s.tick <= start)) return; // too early in the match: nothing old enough to replay from
    this.offer = { x: p.x, y: p.y, start: Math.max(start, end - BACK - 60), end, prio, until: performance.now() + OFFER_MS };
    this.showChip();
  }

  // ───────── chip + panel, by the minimap (below it on phones; above or beside it on desktop), clear of the HUD ─────────
  // Tries each spot at the wanted size, then smaller (down to `min` wide), and takes the first that overlaps no panel.
  anchor(w, hh, min) {
    const R = (id) => { const e = document.getElementById(id); const r = e && e.offsetParent !== null ? e.getBoundingClientRect() : null; return r && r.width > 1 && r.height > 1 ? r : null; };
    const mm = R('mm'), brc = R('brcol'), tc = R('topcenter'), cb = R('cmdbar'), W = window.innerWidth, H = window.innerHeight;
    if (!mm || !brc) return { left: W - w - 8, top: 60, w, h: hh };
    const busy = ['enemyteam', 'killfeed', 'cmdbar', 'topcenter', 'myteam', 'foestrip', 'brcol', 'banner', 'mm', 'ticker', 'objtimers'].map(R).filter(Boolean);
    for (const kid of document.getElementById('cmdbar').children) { const r = kid.getBoundingClientRect(); if (r.width > 1 && r.height > 1) busy.push(r); }
    const free = (x, y, ww, hhh) => x >= 2 && y >= 2 && x + ww <= W - 2 && y + hhh <= H - 2 && !busy.some((r) => x < r.right + 4 && x + ww > r.left - 4 && y < r.bottom + 4 && y + hhh > r.top - 4);
    const k = hh / w;
    const lo = min || w, sizes = []; for (let ww = w; ww > lo; ww -= 16) sizes.push(ww); sizes.push(lo);
    for (const ww of sizes) {
      const h2 = Math.round(ww * k);
      const spots = [[mm.right - ww, mm.bottom + 6], [brc.right - ww, brc.top - 6 - h2], [brc.left - 8 - ww, mm.bottom - h2], [mm.left - 8 - ww, mm.top]];
      // short screens (Safari toolbars): the top corners beside the score block, clear of the tray and dock
      if (tc) spots.push([tc.right + 8, tc.top], [tc.left - 8 - ww, tc.top]);
      // mid-size desktops (1024x768): over the open map, above the command column and beside the minimap column
      if (cb) spots.push([Math.min(brc.left, cb.right) - 8 - ww, cb.top - 8 - h2]);
      for (const [x, y] of spots) if (free(x, y, ww, h2)) return { left: Math.round(x), top: Math.round(y), w: ww, h: h2 };
    }
    return { left: Math.round(mm.right - w), top: Math.round(mm.top < H / 2 ? mm.bottom + 6 : brc.top - 6 - hh), w, h: hh };
  }
  place(el, w, hh, min) {
    const a = this.anchor(w, hh, min);
    Object.assign(el.style, { left: a.left + 'px', top: a.top + 'px', right: 'auto' });
    if (w) Object.assign(el.style, { width: a.w + 'px', height: a.h + 'px' });
    return a;
  }
  showChip() {
    if (!this.chip) {
      this.chip = h('button', { class: 'irchip hud', title: 'Instant replay: the last 15s in slow motion', 'aria-label': 'Instant replay', onclick: (ev) => { ev.stopPropagation(); this.start(); } },
        h('span', { class: 'irplay' }), 'Replay');
      document.getElementById('hud').append(this.chip);
    }
    this.place(this.chip, this.chip.offsetWidth || 96, 30);
    this.chip.classList.remove('out'); this.chip.classList.add('in');
  }
  hideChip() { this.offer = null; if (this.chip) { this.chip.remove(); this.chip = null; } }

  start() {
    const o = this.offer; if (!o || this.play) return;
    const snap = this.snaps.filter((s) => s.tick <= o.start).pop(); if (!snap) { this.hideChip(); return; }
    audio.sfx('move', 0.4);
    this.hideChip();
    const g = restore(snap), log = this.m.runner.log, r = new LocalRunner(g, -1, { noHalftime: true, script: log });
    while (r.si < log.length && log[r.si][0] < g.tick) r.si++;
    const mm = document.getElementById('mm').getBoundingClientRect();
    const w = Math.round(Math.min(340, Math.max(176, mm.width * 1.55, window.innerWidth * 0.22))), hh = Math.round(w * 0.58);
    const cv = h('canvas', { class: 'ircv' });
    const label = h('span', { class: 'irlab' }, 'Rewinding…');
    this.panel = h('div', { class: 'irpip hud', role: 'dialog', 'aria-label': 'Instant replay', style: { width: w + 'px', height: hh + 'px' }, onclick: () => this.stop() },
      cv, h('div', { class: 'irbar' }, h('span', { class: 'irdot' }), label, h('button', { class: 'irx', 'aria-label': 'Close the replay', onclick: (ev) => { ev.stopPropagation(); this.stop(); } }, '✕')));
    document.getElementById('hud').append(this.panel);
    this.place(this.panel, w, hh, 128);
    const rr = new Renderer(cv);
    rr.resize(true); rr.attach(g, this.my, this.app.renderer.map); rr.skins = this.app.renderer.skins;
    rr.fogOn = this.my >= 0; rr.showNames = false;
    rr.cam.x = o.x; rr.cam.y = o.y; rr.cam.zoom = Math.max(0.2, w / 620);
    this.play = { g, r, rr, o, label, ff: true, t0: performance.now() };
  }
  stop() {
    if (!this.play) return;
    this.play = null;
    if (this.panel) { const p = this.panel; p.classList.add('out'); setTimeout(() => p.remove(), 250); this.panel = null; }
  }
  // Every frame (main.js): fast-forward in slices of a few ms, then play in slow motion.
  frame(dt) {
    const P = this.play; if (!P) return;
    const g = P.g, o = P.o;
    if (P.ff) {
      const t0 = performance.now();
      while (g.tick < o.start && performance.now() - t0 < 6) P.r.skipTo(g.tick + 4);
      if (g.tick < o.start) { P.rr.draw(1, dt); return; } // (the picture rewinds while it catches up)
      P.ff = false; P.label.textContent = `Replay · ${slow()}x`; P.rr.prev.clear(); P.rr.evIdx = g.events.length; g.fx.length = 0;
    }
    P.r.update(dt * slow(), () => P.rr.snapshot(), () => P.rr.consume());
    // keep the fight in frame: the middle of the heroes near the spot (the coach's view only)
    let x = 0, y = 0, n = 0;
    for (const t of g.teams) for (const u of t.heroes) if (u.alive && P.rr.visible(u) && (u.x - o.x) ** 2 + (u.y - o.y) ** 2 < 700 * 700) { x += u.x; y += u.y; n++; }
    if (n) { const k = Math.min(1, dt * 2); P.rr.cam.x += (x / n - P.rr.cam.x) * k; P.rr.cam.y += (y / n - P.rr.cam.y) * k; }
    P.rr.draw(P.r.alpha, dt * slow());
    if (g.tick >= o.end || g.over) this.stop();
  }
  destroy() { this.stop(); this.hideChip(); this.snaps = []; }
}
