// Replay Theater: watching a replay gets a scrubbable timeline with event markers, 0.5x-4x speed, jumps to the
// next fight / objective, hero follow and fog per team.
// Seeking: a headless "scout" copy of the replay runs ahead in small time slices (a few ms per frame), records
// the analytics (markers) and keeps a snapshot every 20s of game time. A seek restores the nearest snapshot at
// or before the target and fast-forwards at most 20s headless. Seeking past the scout first runs the scout at
// full speed behind a progress bar. Nothing here changes the sim: the scout is its own Game.
import { h, face } from './dom.js';
import { Game } from '../sim/game.js';
import { LocalRunner } from '../net/runner.js';
import { Hud } from './hud.js';
import { audio } from '../audio.js';
import { snapshot, restore } from './snapshot.js';
import { MatchRecorder, analyze, markerList, drawMarker, fmt, showAnalysis } from './analytics.js';
import { addAnalytics } from './replays.js';

const SNAP = 400;               // ticks between snapshots (20s: ~0.5 MB each, so a 15-minute match stays near 25 MB)
const SPEEDS = [0.5, 1, 2, 4];
const FOG = ['Off', 'Blue', 'Red'];

export class Theater {
  // rep: the replay ({ cfg, log, len, myTeam, id, A? }); opts.back: where Exit goes
  constructor(app, m, rep, opts = {}) {
    this.app = app; this.m = m; this.rep = rep; this.log = rep.log || []; this.back = opts.back || null;
    this.A = rep.A || null; this.d = this.A ? analyze(this.A) : null;
    this.len = (this.A && this.A.len) || rep.len || m.game.rules.seconds;
    this.fog = 0; this.speedI = 1; this.seeking = null; this.lastBar = 0; this.slowFrames = 0;
    const sg = new Game(JSON.parse(JSON.stringify(rep.cfg)));
    this.scout = { g: sg, r: new LocalRunner(sg, -1, { noHalftime: true, script: this.log }), rec: this.A ? null : new MatchRecorder(sg), snaps: [snapshot(sg)], ms: [] };
    m.runner.speed = 1;
    this.markers = this.d ? markerList(this.A, this.d) : [];
    this.mount();
  }
  get g() { return this.m.game; }
  get t() { return this.g.time; }

  // ───────── the control bar (lives in #cmdbar, re-mounted after every seek) ─────────
  mount() {
    const hud = this.m.hud;
    // the Theater has its own speed and fog controls
    const spd = hud.el.ctrl.querySelector('.spd'); if (spd) spd.parentElement.style.display = 'none';
    if (hud.fogBtn) hud.fogBtn.style.display = 'none';
    if (this.el) { hud.el.cmd.replaceChildren(this.el); this.refresh(); return; }
    const b = (cls, label, title, fn) => h('button', { class: 'btn small ' + cls, title, 'aria-label': title, onclick: (e) => { audio.sfx('move', 0.35); fn(e); } }, label);
    this.timeEl = h('span', { class: 'thtime' }, '0:00');
    this.track = h('canvas', { class: 'thtrack', 'aria-label': 'Replay timeline: tap or drag to seek' });
    this.tipEl = h('div', { class: 'thtip hidden' });
    this.playBtn = b('thplay', 'II', 'Play / pause', () => this.togglePlay());
    this.spdBtn = b('thspd', '1x', 'Replay speed', () => this.cycleSpeed());
    this.prevBtn = b('thjump', '◀ Fight', 'Previous fight', () => this.jump('fight', -1));
    this.nextBtn = b('thjump', 'Fight ▶', 'Next fight', () => this.jump('fight', 1));
    this.objBtn = b('thjump', 'Obj ▶', 'Next objective', () => this.jump('ob', 1));
    this.folBtn = b('thfol', 'Follow', 'Follow a hero', (e) => this.followMenu(e.currentTarget));
    this.fogBtn = b('thfog', 'Fog: Off', 'Fog of war: off, or as one team saw the game', () => this.cycleFog());
    this.anBtn = b('than', 'Analysis', 'Match analysis', () => this.openAnalysis());
    this.el = h('div', { class: 'theaterbar' },
      h('div', { class: 'throw1' }, this.timeEl, h('div', { class: 'thtrackw' }, this.track, this.tipEl)),
      h('div', { class: 'throw2' }, this.playBtn, this.spdBtn, this.prevBtn, this.nextBtn, this.objBtn, this.folBtn, this.fogBtn, this.anBtn));
    this.bindTrack();
    hud.el.cmd.replaceChildren(this.el);
    this.refresh();
  }
  refresh() {
    const r = this.m.runner;
    this.playBtn.textContent = r.paused || this.g.over ? '▶' : 'II';
    this.spdBtn.textContent = SPEEDS[this.speedI] + 'x';
    this.fogBtn.textContent = 'Fog: ' + FOG[this.fog];
    this.fogBtn.classList.toggle('on', this.fog > 0);
    this.folBtn.classList.toggle('on', !!this.app.renderer.follow);
    const t = this.t, any = (k, dir) => this.target(k, dir) !== null;
    this.prevBtn.disabled = !any('fight', -1); this.nextBtn.disabled = !any('fight', 1); this.objBtn.disabled = !any('ob', 1);
    this.anBtn.disabled = !this.A;
    this.anBtn.title = this.A ? 'Match analysis' : 'Analysing the replay…';
    this.timeEl.textContent = `${fmt(t)} / ${fmt(this.len)}`;
    this.drawTrack();
  }
  togglePlay() {
    const r = this.m.runner;
    if (this.g.over) { this.seek(0, true); return; }
    r.paused = !r.paused; this.refresh();
  }
  cycleSpeed() { this.speedI = (this.speedI + 1) % SPEEDS.length; this.m.runner.speed = SPEEDS[this.speedI]; this.refresh(); }
  cycleFog() {
    this.fog = (this.fog + 1) % 3;
    this.applyFog(); this.refresh();
  }
  applyFog() { const r = this.app.renderer; r.viewTeam = this.fog - 1; r.fogOn = this.fog > 0; }
  followMenu(anchor) {
    const old = document.getElementById('thfollow'); if (old) { old.remove(); return; }
    const hud = this.m.hud, rr = this.app.renderer;
    const pick = (x) => { box.remove(); if (x) { if (rr.follow !== x.id) hud.selectHero(x); } else { rr.follow = null; if (!hud.director) hud.toggleDirector(); } this.refresh(); };
    const row = (t) => h('div', { class: 'thfrow t' + t }, ...this.g.teams[t].heroes.map((x) => h('button', { class: 'thface' + (rr.follow === x.id ? ' on' : ''), title: x.def.name, 'aria-label': 'Follow ' + x.def.name, onclick: () => pick(x) }, h('img', { src: face(x.heroId), alt: '' }))));
    const box = h('div', { id: 'thfollow', class: 'thfollow' }, row(0), row(1), h('button', { class: 'chip' + (!rr.follow && hud.director ? ' on' : ''), onclick: () => pick(null) }, 'Auto camera'));
    document.body.append(box);
    const a = anchor.getBoundingClientRect(), bw = box.offsetWidth, bh = box.offsetHeight;
    box.style.left = Math.max(4, Math.min(innerWidth - bw - 4, a.left + a.width / 2 - bw / 2)) + 'px';
    box.style.top = Math.max(4, a.top - bh - 6) + 'px';
    const off = (e) => { if (!box.contains(e.target) && e.target !== anchor) { box.remove(); window.removeEventListener('pointerdown', off, true); } };
    setTimeout(() => window.addEventListener('pointerdown', off, true), 0);
  }
  openAnalysis() {
    if (!this.A) return;
    const r = this.m.runner, was = r.paused; r.paused = true; this.refresh();
    const el = showAnalysis(this.A, { title: 'Analysis' });
    new MutationObserver((_, ob) => { if (!el.isConnected) { ob.disconnect(); r.paused = was; this.refresh(); } }).observe(document.body, { childList: true });
  }

  // ───────── markers / jumps ─────────
  // The next (dir 1) or previous (dir -1) fight or objective start, as a seek time; null when there is none (yet).
  target(kind, dir) {
    const t = this.t, ms = this.markers.filter((m) => (kind === 'fight' ? m.kind === 'fight' || m.kind === 'ace' : m.kind === 'ob'));
    const lead = kind === 'fight' ? 4 : 12; // land a little before the action
    if (dir > 0) { const m = ms.find((x) => x.t - lead > t + 1); return m ? Math.max(0, m.t - lead) : null; }
    const prev = ms.filter((x) => x.t - lead < t - 3).pop(); return prev ? Math.max(0, prev.t - lead) : null;
  }
  jump(kind, dir) { const s = this.target(kind, dir); if (s !== null) this.seek(s); }

  // ───────── timeline track ─────────
  bindTrack() {
    const c = this.track;
    const at = (e) => { const r = c.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * this.len; };
    const hint = (e, s) => {
      const r = c.getBoundingClientRect(), x = (s / this.len) * r.width;
      const m = this.markers.filter((q) => Math.abs((q.t / this.len) * r.width - x) < 8)[0];
      this.tipEl.textContent = m ? m.label : fmt(s);
      this.tipEl.classList.remove('hidden');
      const tw = this.tipEl.offsetWidth; this.tipEl.style.left = Math.max(0, Math.min(r.width - tw, x - tw / 2)) + 'px';
    };
    let drag = false;
    c.addEventListener('pointerdown', (e) => { drag = true; c.setPointerCapture(e.pointerId); this.scrub = at(e); hint(e, this.scrub); this.drawTrack(); });
    c.addEventListener('pointermove', (e) => { const s = at(e); if (drag) { this.scrub = s; this.drawTrack(); } if (drag || e.pointerType === 'mouse') hint(e, drag ? this.scrub : s); });
    const end = (e) => { if (!drag) return; drag = false; const s = this.scrub; this.scrub = null; this.tipEl.classList.add('hidden'); if (e.type === 'pointerup') this.seek(s); else this.drawTrack(); };
    c.addEventListener('pointerup', end); c.addEventListener('pointercancel', end);
    c.addEventListener('pointerleave', (e) => { if (!drag && e.pointerType === 'mouse') this.tipEl.classList.add('hidden'); });
  }
  drawTrack() {
    const c = this.track, r = c.getBoundingClientRect(); if (r.width < 10) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (c.width !== Math.round(r.width * dpr) || c.height !== Math.round(r.height * dpr)) { c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr); }
    const x = c.getContext('2d'), W = r.width, H = r.height, X = (s) => Math.max(0, Math.min(W, s / this.len * W));
    x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, W, H);
    const y = H - 6;
    x.fillStyle = '#2a2333'; x.fillRect(0, y - 2, W, 4);
    x.fillStyle = '#4a3f57'; x.fillRect(0, y - 2, X(this.scout.g.time), 4); // analysed so far
    x.fillStyle = '#ffd84a'; x.fillRect(0, y - 2, X(this.t), 4);         // played
    if (this.d && this.d.turn) { x.fillStyle = 'rgba(255,216,74,0.35)'; x.fillRect(X(this.d.turn.t0), 0, Math.max(2, X(this.d.turn.t1) - X(this.d.turn.t0)), y - 4); }
    const redraw = () => this.drawTrack();
    for (const m of this.markers) drawMarker(x, m, X(m.t), (y - 3) / 2, Math.min(12, H - 12), redraw);
    const s = this.scrub ?? this.t;
    x.fillStyle = '#fff1dc'; x.fillRect(Math.round(X(s)) - 1, 0, 3, H);
  }

  // ───────── per frame (from App.frame) ─────────
  frame(dt) {
    const now = performance.now();
    if (this.seeking) { this.runScout(36); this.seekProgress(); return; }
    // the scout gets a small slice each frame, and backs off on a slow device (frame time over ~22 ms)
    this.slowFrames = dt > 0.022 ? Math.min(30, this.slowFrames + 1) : Math.max(0, this.slowFrames - 1);
    if (!this.scout.done) this.runScout(this.slowFrames > 10 ? 1.5 : this.m.runner.paused ? 8 : 4);
    if (this.g.over && !this.ended) { this.ended = true; this.m.runner.paused = true; this.m.hud.banner('END OF REPLAY', '#ffd84a', 2500); }
    if (now - this.lastBar > 150) { this.lastBar = now; this.refresh(); }
  }
  runScout(budget) {
    const S = this.scout, g = S.g, t0 = performance.now();
    while (!S.done && performance.now() - t0 < budget) {
      S.r.skipTo(g.tick + 1);
      if (S.rec) S.rec.step();
      if (g.tick % SNAP === 0) { const a = performance.now(); S.snaps[g.tick / SNAP] = snapshot(g); S.ms.push(performance.now() - a); }
      if (g.over || g.tick >= this.len * 20 + 20) {
        S.done = true;
        if (S.rec) { this.A = S.rec.finish({ my: this.rep.myTeam ?? -1 }); this.len = this.A.len || this.len; if (this.rep.id) addAnalytics(this.rep.id, this.A); }
      }
    }
    if (S.rec && (S.done || performance.now() - (this.lastMk || 0) > 1500)) {
      this.lastMk = performance.now();
      const A = S.done ? this.A : S.rec.finish({ my: this.rep.myTeam ?? -1 });
      this.d = analyze(A); this.markers = markerList(A, this.d);
      if (S.done) S.rec = null;
    }
  }

  // ───────── seeking ─────────
  seek(sec, play) {
    const tick = Math.max(0, Math.min(Math.round(sec * 20), Math.round(this.len * 20)));
    if (tick > this.scout.g.tick && !this.scout.done) {
      // past what the scout has seen: run it at full speed first
      const was = this.m.runner.paused; this.m.runner.paused = true;
      this.seeking = { tick, play: play ?? !was, from: this.scout.g.tick, el: null };
      return;
    }
    this.doSeek(tick, play ?? !this.m.runner.paused);
  }
  seekProgress() {
    const s = this.seeking, S = this.scout;
    if (S.g.tick >= s.tick || S.done) { s.el && s.el.remove(); this.seeking = null; this.doSeek(Math.min(s.tick, S.g.tick), s.play); return; }
    if (!s.el) {
      s.el = h('div', { class: 'potgload thseek' }, h('b', {}, 'Fast-forwarding…'), h('div', { class: 'barw' }, h('i')),
        h('button', { class: 'btn small', onclick: () => { s.el.remove(); this.seeking = null; this.m.runner.paused = !s.play; this.refresh(); } }, 'Cancel'));
      document.body.append(s.el);
    }
    s.el.querySelector('i').style.width = Math.round((S.g.tick - s.from) / Math.max(1, s.tick - s.from) * 100) + '%';
  }
  doSeek(tick, play) {
    const t0 = performance.now(), S = this.scout;
    let i = Math.min(Math.floor(tick / SNAP), S.snaps.length - 1);
    while (i > 0 && !S.snaps[i]) i--;
    const g = restore(S.snaps[i]), r = new LocalRunner(g, -1, { noHalftime: true, script: this.log });
    while (r.si < this.log.length && this.log[r.si][0] < g.tick) r.si++;
    r.skipTo(tick);
    g.fx.length = 0;
    r.speed = SPEEDS[this.speedI]; r.paused = !play;
    this.swap(g, r);
    this.ended = false;
    this.lastSeekMs = performance.now() - t0;
    this.refresh();
  }
  // Put a game on screen in place of the current one (fresh HUD, same camera / follow / fog).
  swap(g, r) {
    const app = this.app, m = this.m, rr = app.renderer, hud = m.hud;
    const dir = hud.director, follow = rr.follow;
    rr.attach(g, -1, app.mapCanvas(g.world)); this.applyFog();
    m.game = g; m.runner = r;
    m.hud = new Hud(app, g, r, rr, app.minimap, -1, 'watch');
    if (dir) m.hud.toggleDirector();
    rr.follow = follow; if (follow) { m.hud.sel = g.byId(follow); m.hud.director = false; m.hud.refreshCtrl(); }
    this.mount();
    m.ended = false;
  }
  // Leave the Theater (Quit): back where it was opened from.
  exit() {
    document.getElementById('thfollow')?.remove();
    this.seeking && this.seeking.el && this.seeking.el.remove();
    const back = this.back, app = this.app, m = this.m;
    app.match = null; app.teardownMatch(m);
    app.fade(() => { app.showScreen(true); if (back) back(); else app.menu(); });
  }
  // For tests: how fast seeking and snapshots are on this device.
  stats() { const ms = this.scout.ms; return { snaps: this.scout.snaps.filter(Boolean).length, snapMs: ms.length ? ms.reduce((a, b) => a + b, 0) / ms.length : 0, scoutTick: this.scout.g.tick, lastSeekMs: this.lastSeekMs || 0 }; }
}
