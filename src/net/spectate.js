// Spectate friends live: the protocol (no DOM; tools/spectate_test.mjs runs it in node over loopback links).
//
// The coach's own device is the relay: it already holds the whole command stream (lockstep inputs, or the local
// runner's log vs AI), so it forwards that stream to up to MAX_SPEC read-only spectators. Spectators run the same
// deterministic sim locally from the match config, so the picture is exact and the feed is tiny (a few hundred
// bytes a second). Anti-ghosting: the relay only ever sends commands DELAY ticks (10 s) behind its own sim, and
// the "known" horizon it announces is the same 10 s behind, so a spectator can never see the live state.
//
// Messages (relay → spectator):  sw { v, cfg, names, skins, mapId, delay }   once, after an accepted 'spec'
//                                sl { k, b: [[tick, cmds]...], ai?, end? }     command log up to (not incl.) tick k
//                                specno { why } · specend                     refused / the feed closed
// Spectator → relay:             spec { v, pid, name }
import { LocalRunner } from './runner.js';
import { DT } from '../sim/constants.js';
import { Coach } from '../sim/coach.js';

export const DELAY = 200;      // ticks (10 s at 20 Hz)
export const MAX_SPEC = 4;
const CHUNK = 300;             // log entries per message (keeps data-channel messages small)
const EVERY = 500;             // ms between feed messages

export class Relay {
  // src: { v, cfg, names, skins, mapId, game: () => Game, log: () => log array, ai: () => [[tick, team]] }
  // allow(pid) → null when allowed, else a reason. now: a clock (performance.now in the app).
  constructor(src, { allow = () => null, now = () => Date.now(), onCount = null } = {}) {
    this.src = src; this.allow = allow; this.now = now; this.onCount = onCount;
    this.specs = []; this.sent = 0; this.safe = 0; this.aiSent = 0; this.endAt = 0; this.closed = false; this.last = 0;
  }
  get count() { return this.specs.length; }
  // A new spectator link (any transport with send / onMessage / onClose / close).
  accept(t) {
    if (this.closed) { t.close(); return; }
    let joined = false;
    t.onMessage((m) => {
      if (!m || m.t !== 'spec' || joined) return;
      const why = m.v !== this.src.v ? 'version' : this.specs.length >= MAX_SPEC ? 'full' : this.allow(m.pid);
      if (why) { t.send({ t: 'specno', why }); setTimeout(() => t.close(), 400); return; }
      joined = true;
      const s = this.src;
      t.send({ t: 'sw', v: s.v, cfg: s.cfg, names: s.names, skins: s.skins, mapId: s.mapId, delay: DELAY });
      // everything up to the current safe horizon, in chunks; the last chunk carries the horizon
      const log = s.log(), upto = this.cut(log, this.safe);
      for (let i = 0; i < upto || i === 0; i += CHUNK) {
        const last = i + CHUNK >= upto;
        t.send({ t: 'sl', k: last ? this.safe : null, b: log.slice(i, Math.min(upto, i + CHUNK)), ...(last ? { ai: s.ai() } : {}) });
      }
      this.specs.push(t);
      if (this.onCount) this.onCount(this.specs.length);
    });
    t.onClose(() => { const i = this.specs.indexOf(t); if (i >= 0) { this.specs.splice(i, 1); if (this.onCount) this.onCount(this.specs.length); } });
  }
  // number of log entries strictly before tick k
  cut(log, k) { let n = 0; while (n < log.length && log[n][0] < k) n++; return n; }
  // Call often (each frame or on a timer): moves the safe horizon and sends what is new.
  pump() {
    if (this.closed) return;
    const t = this.now(); if (t - this.last < EVERY) return; this.last = t;
    const g = this.src.game(); if (!g) return;
    let safe = Math.max(0, g.tick - DELAY), end = false;
    if (g.over) { // after the final tick the feed runs out its 10 s at real-time pace, then ends
      if (!this.endAt) this.endAt = t;
      safe = Math.min(g.tick, Math.max(this.safe, g.tick - DELAY + Math.floor((t - this.endAt) / 1000 / DT)));
      end = safe >= g.tick;
    }
    if (safe <= this.safe && !end) return;
    const log = this.src.log(), upto = this.cut(log, safe);
    const b = log.slice(this.sent, upto), ai = this.src.ai();
    this.sent = upto; this.safe = safe;
    const msg = { t: 'sl', k: safe, b, ...(ai.length !== this.aiSent ? { ai } : {}), ...(end ? { end: true } : {}) };
    this.aiSent = ai.length;
    for (const s of this.specs) s.send(msg);
    if (end) this.close(false);
  }
  close(tell = true) {
    if (this.closed) return; this.closed = true;
    for (const s of this.specs) { if (tell) s.send({ t: 'specend' }); setTimeout(() => s.close(), 1500); }
    this.specs = [];
  }
}

// The spectator's runner: a script runner that never steps past the announced horizon. It eases faster when far
// behind (just joined), and an AI coach takes over a side at the same tick as on the relay.
export class SpecRunner extends LocalRunner {
  constructor(game) { super(game, -1, { noHalftime: true, script: [] }); this.known = 0; this.ai = []; this.ended = false; this.waiting = false; }
  feed(m) {
    for (const e of m.b || []) this.script.push(e);
    if (Array.isArray(m.ai)) this.ai = m.ai.filter((a) => Array.isArray(a) && Number.isInteger(a[0]) && (a[1] === 0 || a[1] === 1));
    if (Number.isInteger(m.k)) this.known = Math.max(this.known, m.k);
    if (m.end) this.ended = true;
  }
  takeover() { const g = this.game; for (const [k, t] of this.ai) if (k === g.tick && !(g.coaches[t] && g.coaches[t].fromSpec)) { g.coaches[t] = new Coach(g, t, 1); g.coaches[t].fromSpec = true; } }
  stepOne() {
    const g = this.game, s = this.script, cmds = [];
    while (this.si < s.length && s[this.si][0] < g.tick) this.si++;
    while (this.si < s.length && s[this.si][0] === g.tick) cmds.push(...s[this.si++][1]);
    this.takeover();
    g.step(cmds);
  }
  update(dt, onBefore, onAfter) {
    const g = this.game;
    if (this.paused || g.over) { this.acc = 0; return 0; }
    const lag = this.known - g.tick;
    if (lag <= 0) { this.acc = 0; this.waiting = true; return 0; }
    this.waiting = false;
    this.acc += Math.min(0.25, dt) * this.speed * (lag > 400 ? 2 : lag > 240 ? 1.25 : 1);
    let n = 0;
    while (this.acc >= DT && n < 40 && g.tick < this.known && !g.over) { onBefore && onBefore(); this.stepOne(); onAfter && onAfter(); this.acc -= DT; n++; }
    if (g.tick >= this.known) this.acc = Math.min(this.acc, DT);
    return n;
  }
  // Headless catch-up to `tick` (capped by the horizon) in slices; true when there.
  skipTo(tick, max = Infinity) {
    const g = this.game, to = Math.min(tick, this.known); let n = 0;
    while (g.tick < to && !g.over && n++ < max) { this.stepOne(); g.fx.length = 0; }
    return g.tick >= to || g.over;
  }
}
