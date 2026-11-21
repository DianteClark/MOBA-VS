// Audio engine (WebAudio). Everything is client-side presentation: Math.random here is fine, it never touches the sim.
//
//   ctx ─ master ─ highpass 70 Hz ─ compressor ─ limiter ─ speakers      (phone speakers: no lows, no clipping)
//          ├─ music bus ─ duck ─ lowpass ─┤  two A/B decks (<audio> elements, streamed) crossfade between tracks
//          ├─ sfx bus ────────────────────┤  decoded one-shots: voice limit per group, priority, pan, pitch/volume jitter
//          └─ ui bus ─────────────────────┘  menu press blips (synthesized) and menu one-shots
//
// Loading: nothing is fetched before the first tap. Music streams through two reusable <audio> decks (no decoded
// copies in memory); one-shots are small mp3s decoded on first use and kept (a fixed set, so memory is bounded).
// iOS: the AudioContext and both decks are unlocked inside the first tap (touchend/pointerdown/keydown); the app
// suspends everything while backgrounded and resumes on return or on the next tap if iOS refuses the resume.
const MUSIC_DIR = 'assets/audio/music/', SFX_DIR = 'assets/audio/sfx/';
// g: gain that brings each track to about -20 LUFS (laststand a little hotter), so crossfades keep a steady level.
// resume: a track picks up where it left off (calm laning) instead of restarting (fight / stingers).
const TRACKS = {
  menu: { f: 'menu', g: 0.88, resume: true }, draft: { f: 'draft', g: 1 }, calm: { f: 'calm', g: 0.88, resume: true }, calm2: { f: 'match1', g: 1.35, resume: true },
  tension: { f: 'match2', g: 0.98 }, laststand: { f: 'laststand', g: 0.8 }, victory: { f: 'victory', g: 0.42 }, defeat: { f: 'defeat', g: 1.6 },
};
// One-shots. bus: sfx | ui | music (stingers). lim: max voices of the group at once. pv/vv: random pitch / volume spread.
const D = (g, o = {}) => ({ g, bus: 'sfx', grp: null, lim: 4, pv: 0.05, vv: 0.12, ...o });
const SFX = {
  // menus (ui bus)
  move: D(0.8, { bus: 'ui', lim: 2, pv: 0.03 }), accept: D(0.8, { bus: 'ui', lim: 2, pv: 0.02 }), cancel: D(0.8, { bus: 'ui', lim: 2, pv: 0.02 }),
  lockin: D(0.9, { bus: 'ui', lim: 2, pv: 0.02 }), call: D(0.8, { bus: 'ui', lim: 2, pv: 0.02 }),
  // match: alerts and rewards
  alert: D(0.8, { lim: 2, pv: 0 }), alert2: D(0.8, { lim: 2, pv: 0 }), powerup: D(0.8, { lim: 2, pv: 0.02 }), objective: D(0.9, { lim: 2, pv: 0 }),
  coin: D(0.7, { lim: 2 }), coin2: D(0.45, { grp: 'gold', lim: 2, pv: 0.08 }), gold: D(0.7, { lim: 2 }), levelup: D(0.55, { lim: 1, pv: 0 }),
  magic: D(0.8, { grp: 'ult', lim: 3 }), explosion: D(0.9, { grp: 'boom', lim: 3 }), boom: D(0.8, { grp: 'boom', lim: 3, pv: 0.06 }),
  wings: D(0.8, { lim: 2, pv: 0.03 }), tower: D(0.8, { grp: 'boom', lim: 3, pv: 0.03 }), roar: D(0.9, { lim: 2, pv: 0.06 }), death: D(0.8, { grp: 'ko', lim: 3, pv: 0.02 }), impact: D(0.8, { grp: 'ko', lim: 3 }), kill: D(0.8, { grp: 'ko', lim: 3 }),
  // combat
  hit_l1: D(0.55, { grp: 'hit', lim: 4, pv: 0.08 }), hit_l2: D(0.55, { grp: 'hit', lim: 4, pv: 0.08 }),
  hit_m1: D(0.7, { grp: 'hit', lim: 4, pv: 0.07 }), hit_m2: D(0.7, { grp: 'hit', lim: 4, pv: 0.07 }),
  hit_h1: D(0.85, { grp: 'hit', lim: 4, pv: 0.05 }), hit_h2: D(0.85, { grp: 'hit', lim: 4, pv: 0.05 }), crit: D(0.6, { grp: 'crit', lim: 2, pv: 0.06 }),
  minion: D(0.5, { grp: 'minion', lim: 2, pv: 0.12, vv: 0.25 }), tshot: D(0.5, { grp: 'tower', lim: 2, pv: 0.06 }),
  iron1: D(0.7, { grp: 'cast', lim: 5 }), iron2: D(0.7, { grp: 'cast', lim: 5 }), beast1: D(0.75, { grp: 'cast', lim: 5 }), beast2: D(0.6, { grp: 'cast', lim: 5 }),
  shin1: D(0.7, { grp: 'cast', lim: 5 }), shin2: D(0.7, { grp: 'cast', lim: 5 }), spir1: D(0.65, { grp: 'cast', lim: 5 }), spir2: D(0.65, { grp: 'cast', lim: 5 }),
  wild1: D(0.7, { grp: 'cast', lim: 5 }), wild2: D(0.6, { grp: 'cast', lim: 5 }),
  fire: D(0.55, { grp: 'elem', lim: 3 }), fireball: D(0.6, { grp: 'elem', lim: 3 }), water1: D(0.6, { grp: 'elem', lim: 3 }), water2: D(0.6, { grp: 'elem', lim: 3 }),
  ice: D(0.55, { grp: 'elem', lim: 3 }), zap: D(0.55, { grp: 'elem', lim: 3 }), rock: D(0.6, { grp: 'elem', lim: 3 }), plant: D(0.6, { grp: 'elem', lim: 3 }),
  heal: D(0.55, { grp: 'elem', lim: 3 }), shield: D(0.5, { grp: 'elem', lim: 3 }),
  // stingers (music bus)
  st_win: D(0.9, { bus: 'music', lim: 1, pv: 0, vv: 0 }), st_lose: D(0.9, { bus: 'music', lim: 1, pv: 0, vv: 0 }), st_ace: D(0.9, { bus: 'music', grp: 'sting', lim: 1, pv: 0, vv: 0 }),
  st_obj: D(0.75, { bus: 'music', grp: 'sting', lim: 1, pv: 0, vv: 0 }), st_last: D(0.8, { bus: 'music', grp: 'sting', lim: 1, pv: 0, vv: 0 }),
};
const MAX_VOICES = 24;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const AC = typeof window !== 'undefined' ? (window.AudioContext || window.webkitAudioContext) : null;

export const audio = {
  vol: { master: 1, music: 0.35, sfx: 0.55, ui: 0.55 }, muted: readMuted(), unlocked: false, hidden: false,
  ctx: null, bus: null, decks: [], deck: 0, curName: null, pos: {}, buffers: new Map(), loading: new Map(), voices: [], last: {}, lastUi: 0, failed: new Set(),
  duckUntil: 0, duckTimer: 0, muffle: 1, trace: null,

  init() {
    const unlock = () => this.unlock();
    for (const ev of ['pointerdown', 'touchend', 'keydown']) window.addEventListener(ev, unlock, { capture: true, passive: true });
    document.addEventListener('visibilitychange', () => this.setHidden(document.hidden));
    window.addEventListener('pagehide', () => this.setHidden(true));
    window.addEventListener('pageshow', () => this.setHidden(document.hidden));
  },
  // Inside a user gesture: create/resume the context, play one silent sample (old iOS needs it) and bless both
  // music decks with play() so later crossfades can start them without a tap.
  unlock() {
    if (!AC) return;
    if (this.unlocked) { if (!this.muted && !this.hidden && this.ctx.state !== 'running') this.resume(); return; }
    try { this.build(); } catch (e) { this.log('error', String(e)); return; }
    this.unlocked = true;
    const b = this.ctx.createBuffer(1, 1, 22050), s = this.ctx.createBufferSource(); s.buffer = b; s.connect(this.ctx.destination); s.start(0);
    this.resume();
    // (a blessed element keeps its permission when its src changes later; silent here: master is still at 0)
    for (const d of this.decks) {
      d.el.src = MUSIC_DIR + (TRACKS[this.curName] || TRACKS.menu).f + '.mp3';
      const p = d.el.play(); d.el.pause(); if (p) p.catch(() => {});
    }
    this.applyVolumes(0);
    this.log('unlock', this.ctx.state);
    if (this.curName) { const n = this.curName; this.curName = null; this.music(n); }
  },
  build() {
    const c = this.ctx = new AC({ latencyHint: 'interactive' });
    const gain = (v = 1) => { const g = c.createGain(); g.gain.value = v; return g; };
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 70; hp.Q.value = 0.7;
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -18; comp.knee.value = 8; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.2;
    const lim = c.createDynamicsCompressor(); lim.threshold.value = -2; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.001; lim.release.value = 0.08;
    const master = gain(0), music = gain(0), duck = gain(1), lp = c.createBiquadFilter(), sfx = gain(0), ui = gain(0);
    lp.type = 'lowpass'; lp.frequency.value = 20000; lp.Q.value = 0.5;
    music.connect(duck).connect(lp).connect(master); sfx.connect(master); ui.connect(master);
    master.connect(hp).connect(comp).connect(lim).connect(c.destination);
    this.bus = { master, music, duck, lp, sfx, ui, comp };
    this.decks = [0, 1].map(() => {
      const el = new Audio(); el.loop = true; el.preload = 'auto'; el.setAttribute('playsinline', '');
      const g = gain(0), node = c.createMediaElementSource(el); node.connect(g).connect(music);
      el.addEventListener('error', () => { if (el.getAttribute('src')) this.log('error', 'music ' + el.getAttribute('src')); });
      return { el, g, track: null, stopT: 0 };
    });
    c.onstatechange = () => this.log('ctx', c.state);
  },
  resume() {
    const c = this.ctx; if (!c || this.muted || this.hidden) return;
    if (c.state !== 'running') c.resume().then(() => this.log('ctx', c.state)).catch((e) => this.log('warn', 'resume ' + e));
    const d = this.decks[this.deck];
    if (d && d.track && d.el.paused) d.el.play().catch((e) => this.log('warn', 'play ' + e.name));
  },
  // Backgrounded (tab hidden, app switched, phone locked): silence and stop the decks; back again: resume.
  setHidden(h) {
    if (h === this.hidden) return;
    this.hidden = h; this.log('hidden', h);
    if (!this.ctx) return;
    if (h) { for (const d of this.decks) d.el.pause(); if (this.ctx.suspend) this.ctx.suspend().catch(() => {}); } else this.resume();
  },

  // ── music ──
  // music(name): crossfade to a track (null = fade to silence). Safe to call every frame with the same name.
  music(name, fadeMs = 1400) {
    if (name === this.curName) return;
    this.curName = name; this.log('music', name);
    if (!this.ctx || !this.unlocked) return;
    const t = this.ctx.currentTime, cur = this.decks[this.deck];
    const ramp = (d, to, ms) => { const p = d.g.gain; p.cancelScheduledValues(t); p.setValueAtTime(p.value, t); p.linearRampToValueAtTime(to, t + ms / 1000); };
    const stop = (d, ms) => {
      ramp(d, 0, ms); clearTimeout(d.stopT);
      d.stopT = setTimeout(() => { if (d !== this.decks[this.deck] || !this.curName) { if (d.track && TRACKS[d.track].resume) this.pos[d.track] = d.el.currentTime; d.el.pause(); } }, ms + 60);
    };
    if (!name || !TRACKS[name]) { for (const d of this.decks) if (d.track) stop(d, fadeMs); return; }
    const tr = TRACKS[name];
    if (cur.track === name) { clearTimeout(cur.stopT); ramp(cur, tr.g, fadeMs); this.decks.forEach((d) => d !== cur && d.track && stop(d, fadeMs)); this.resume(); return; }
    const nxt = this.decks[1 - this.deck];
    clearTimeout(nxt.stopT);
    if (nxt.track !== name) {
      if (nxt.track && TRACKS[nxt.track].resume && !nxt.el.paused) this.pos[nxt.track] = nxt.el.currentTime;
      nxt.track = name; nxt.g.gain.cancelScheduledValues(t); nxt.g.gain.setValueAtTime(0, t);
      nxt.el.src = MUSIC_DIR + tr.f + '.mp3';
      const at = tr.resume ? this.pos[name] || 0 : 0;
      if (at) nxt.el.addEventListener('loadedmetadata', () => { try { nxt.el.currentTime = at % (nxt.el.duration || 1e9); } catch { /* not seekable yet */ } }, { once: true });
    } else if (!tr.resume) { try { nxt.el.currentTime = 0; } catch { /* ignore */ } }
    this.deck = 1 - this.deck;
    if (cur.track) stop(cur, fadeMs);
    if (!this.muted && !this.hidden) nxt.el.play().catch((e) => this.log('warn', 'play ' + e.name));
    ramp(nxt, tr.g, fadeMs);
  },
  // Music under a big moment: dip to `depth` for holdMs, then come back (optionally overshooting into a swell).
  duck(depth = 0.5, holdMs = 900, swell = 1) {
    if (!this.ctx) return;
    const p = this.bus.duck.gain, t = this.ctx.currentTime, now = performance.now();
    if (now < this.duckUntil && p.value <= depth) { this.duckUntil = Math.max(this.duckUntil, now + holdMs); } else {
      p.cancelScheduledValues(t); p.setValueAtTime(p.value, t); p.linearRampToValueAtTime(depth, t + 0.06); this.duckUntil = now + holdMs;
    }
    clearTimeout(this.duckTimer);
    this.duckTimer = setTimeout(() => {
      const t2 = this.ctx.currentTime; p.cancelScheduledValues(t2); p.setValueAtTime(p.value, t2);
      if (swell > 1) { p.linearRampToValueAtTime(swell, t2 + 0.9); p.linearRampToValueAtTime(1, t2 + 4); } else p.linearRampToValueAtTime(1, t2 + 1.2);
    }, Math.max(0, this.duckUntil - now));
    this.log('duck', depth);
  },
  // Muffle the music (halftime overlay, slow-motion): 1 = open, lower = darker. Smooth, cheap to call every frame.
  setMuffle(k) {
    if (!this.ctx || Math.abs(k - this.muffle) < 0.01) return;
    this.muffle = k;
    this.bus.lp.frequency.setTargetAtTime(k >= 1 ? 20000 : 300 + 19700 * k * k, this.ctx.currentTime, 0.15);
  },

  // ── one-shots ──
  // Legacy entry point used across the UI: sfx(name, vol, throttleMs).
  sfx(name, vol = 1, throttleMs = 60) { return this.play(name, { vol, throttle: throttleMs }); },
  // play(name, { vol, rate, pan, prio, throttle, delay }) → true when a voice started (or is queued behind a load).
  play(name, o = {}) {
    const d = SFX[name]; if (!d) { this.log('error', 'unknown sfx ' + name); return false; }
    if (this.muted || this.hidden || !this.unlocked || !this.ctx) return false;
    if (name === 'move' && performance.now() - this.lastUi < 160) return false; // a press blip already sounded
    const now = performance.now(), thr = o.throttle ?? 60;
    if (this.last[name] && now - this.last[name] < thr) return false;
    const vol = (o.vol ?? 1) * d.g * (1 - Math.random() * d.vv);
    if (vol < 0.01 || this.busVol(d.bus) <= 0.001) return false;
    this.last[name] = now;
    const buf = this.buffers.get(name);
    if (!buf) { this.load(name).then((b) => { if (b && performance.now() - now < 250) this.start(name, d, b, vol, o); }); return true; }
    return this.start(name, d, buf, vol, o);
  },
  start(name, d, buf, vol, o) {
    const c = this.ctx, grp = d.grp || name, prio = o.prio ?? 1;
    const same = this.voices.filter((v) => v.grp === grp);
    if (same.length >= d.lim || this.voices.length >= MAX_VOICES) {
      const pool = same.length >= d.lim ? same : this.voices;
      let worst = null; for (const v of pool) if (!worst || v.prio < worst.prio || (v.prio === worst.prio && v.t0 < worst.t0)) worst = v;
      if (!worst || worst.prio > prio) { this.log('drop', name); return false; }
      this.kill(worst);
    }
    const t = c.currentTime + (o.delay || 0);
    const s = c.createBufferSource(), g = c.createGain();
    s.buffer = buf; s.playbackRate.value = clamp((o.rate || 1) * (1 + (Math.random() * 2 - 1) * d.pv), 0.25, 4);
    g.gain.value = vol;
    let out = g;
    if (o.pan && c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = clamp(o.pan, -1, 1); g.connect(p); out = p; }
    s.connect(g); out.connect(this.bus[d.bus]);
    const v = { name, grp, prio, t0: t, s, g, out };
    s.onended = () => { this.drop(v); };
    s.start(t);
    this.voices.push(v);
    this.log('sfx', name, +vol.toFixed(2), o.pan ? +o.pan.toFixed(2) : 0, prio);
    return true;
  },
  kill(v) { try { const t = this.ctx.currentTime; v.g.gain.setTargetAtTime(0, t, 0.01); v.s.stop(t + 0.05); } catch { /* already stopped */ } this.drop(v); },
  drop(v) { const i = this.voices.indexOf(v); if (i >= 0) this.voices.splice(i, 1); v.s.onended = null; try { v.s.disconnect(); v.out.disconnect(); v.g.disconnect(); } catch { /* ignore */ } },
  load(name) {
    if (this.buffers.has(name)) return Promise.resolve(this.buffers.get(name));
    if (this.loading.has(name)) return this.loading.get(name);
    if (this.failed.has(name) || !this.ctx) return Promise.resolve(null);
    const p = fetch(SFX_DIR + name + '.mp3').then((r) => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
      .then((ab) => new Promise((res, rej) => this.ctx.decodeAudioData(ab, res, rej)))
      .then((b) => { this.buffers.set(name, b); this.loading.delete(name); return b; })
      .catch((e) => { this.failed.add(name); this.loading.delete(name); this.log('error', 'load ' + name + ' ' + (e && e.message)); return null; });
    this.loading.set(name, p);
    return p;
  },
  // Warm the cache (a match start) so the first hits are not late. Only after the unlock: nothing loads before a tap.
  preload(names) { if (this.ctx && this.unlocked) for (const n of names) if (SFX[n]) this.load(n); },
  // Menu press blip: synthesized (no download), on the UI bus. kind: tap | big | back
  ui(kind = 'tap') {
    if (this.muted || this.hidden || !this.unlocked || !this.ctx || this.vol.ui <= 0.001) return;
    const c = this.ctx, t = c.currentTime, o = c.createOscillator(), g = c.createGain(), big = kind === 'big';
    const f = big ? [520, 780] : kind === 'back' ? [420, 260] : [660, 520], j = 1 + (Math.random() * 2 - 1) * 0.03;
    o.type = big ? 'triangle' : 'square';
    o.frequency.setValueAtTime(f[0] * j, t); o.frequency.exponentialRampToValueAtTime(f[1] * j, t + (big ? 0.09 : 0.05));
    const v = big ? 0.18 : 0.1;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + (big ? 0.16 : 0.07));
    o.connect(g).connect(this.bus.ui); o.start(t); o.stop(t + 0.2);
    o.onended = () => { o.disconnect(); g.disconnect(); };
    this.lastUi = performance.now();
    this.log('ui', kind);
  },

  // ── volumes / mute ──
  busVol(b) { return b === 'music' ? this.vol.music : b === 'ui' ? this.vol.ui : this.vol.sfx; },
  // setVolumes({ master, music, sfx, ui }) — each 0..1 (missing keys keep their value).
  setVolumes(v) {
    for (const k of ['master', 'music', 'sfx', 'ui']) if (typeof v[k] === 'number') this.vol[k] = clamp(v[k], 0, 1);
    this.applyVolumes(0.05);
  },
  applyVolumes(tc) {
    if (!this.bus) return;
    const t = this.ctx.currentTime, set = (p, v) => (tc ? p.setTargetAtTime(v, t, tc) : p.setValueAtTime(v, t));
    set(this.bus.master.gain, this.muted ? 0 : this.vol.master);
    set(this.bus.music.gain, this.vol.music); set(this.bus.sfx.gain, this.vol.sfx); set(this.bus.ui.gain, this.vol.ui);
  },
  setMuted(m) { if (!!m !== this.muted) this.toggle(); return this.muted; },
  toggle() {
    this.muted = !this.muted;
    try { localStorage.setItem('mobavs_muted', this.muted ? '1' : '0'); } catch { /* ignore */ }
    this.applyVolumes(0.03);
    if (this.ctx) { if (this.muted) { for (const d of this.decks) d.el.pause(); for (const v of [...this.voices]) this.kill(v); } else this.resume(); }
    this.log('muted', this.muted);
    return this.muted;
  },

  // ── diagnostics (tests and the dev console) ──
  // audio.trace = [] starts an event log (capped); stats() is a snapshot of what is alive.
  log(type, ...a) { const T = this.trace; if (!T) return; T.push([Math.round(performance.now()), type, ...a]); if (T.length > (this.traceMax || 600)) T.splice(0, 100); },
  stats() {
    return { state: this.ctx ? this.ctx.state : 'none', unlocked: this.unlocked, muted: this.muted, hidden: this.hidden, music: this.curName,
      decks: this.decks.map((d) => ({ track: d.track, paused: d.el.paused, gain: +d.g.gain.value.toFixed(2) })), voices: this.voices.length, buffers: this.buffers.size,
      loading: this.loading.size, duck: this.bus ? +this.bus.duck.gain.value.toFixed(2) : 1, lp: this.bus ? Math.round(this.bus.lp.frequency.value) : 0 };
  },
};
function readMuted() { try { return localStorage.getItem('mobavs_muted') === '1'; } catch { return false; } }
