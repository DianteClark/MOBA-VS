// Match runners. Both drive the deterministic sim at a fixed tick rate.
//  LocalRunner – vs AI / watch mode: free speed control, commands applied next tick.
//                 `slow` is a presentation-only time scale (Coach's Call / fight cam slow-motion).
//  LockstepRunner – peer-to-peer: each peer sends its command list for tick T+DELAY;
//                   the sim only advances when both peers' inputs for the tick are known.
import { DT, HALFTIME } from '../sim/constants.js';

// Halftime: both runners hold the sim at 7:30 until everyone is ready (or the timer ends).
// It is a pause *between* ticks, so the simulation itself is untouched.
const Halftime = {
  holding() {
    const g = this.game;
    if (this.noHalftime || this.htDone || g.over || g.tick !== g.halftimeTick) return false;
    if (!this.ht) { this.ht = { end: performance.now() + HALFTIME.seconds * 1000, me: false, them: !this.online || !!this.remoteHt }; this.onHalftime && this.onHalftime(this.ht); }
    if (this.remoteHt) this.ht.them = true;
    if (performance.now() >= this.ht.end || (this.ht.me && this.ht.them)) { this.htDone = true; this.onHalftimeEnd && this.onHalftimeEnd(); return false; }
    return true;
  },
  readyHalftime() { if (!this.ht || this.ht.me) return; this.ht.me = true; if (this.online) this.t.send({ t: 'ht' }); },
};
// Replays: every command the sim consumed, by tick (AI coaches are deterministic and need no log).
const record = (r, tick, cmds) => { if (cmds.length) r.log.push([tick, cmds.map((c) => ({ ...c }))]); };

export class LocalRunner {
  constructor(game, myTeam, opts = {}) { this.game = game; this.myTeam = myTeam; this.queue = []; this.speed = 1; this.slow = 1; this.paused = false; this.acc = 0; this.seq = 0; this.online = false; this.log = []; this.noHalftime = !!opts.noHalftime; this.script = opts.script || null; this.si = 0; }
  send(cmd) { this.queue.push({ ...cmd, team: this.myTeam, seq: ++this.seq }); }
  update(dt, onBefore, onAfter) {
    if (this.paused || this.game.over) { this.acc = 0; return 0; }
    if (this.holding()) { this.acc = 0; return 0; }
    this.acc += Math.min(0.25, dt) * this.speed * this.slow;
    let n = 0;
    while (this.acc >= DT && n < 40) {
      if (this.holding()) { this.acc = 0; break; }
      onBefore && onBefore();
      let cmds = this.queue; this.queue = [];
      if (this.script) { cmds = []; const s = this.script; while (this.si < s.length && s[this.si][0] === this.game.tick) cmds.push(...s[this.si++][1]); }
      record(this, this.game.tick, cmds);
      this.game.step(cmds);
      onAfter && onAfter();
      this.acc -= DT; n++;
    }
    return n;
  }
  get alpha() { return Math.min(1, this.acc / DT); }
  // Headless fast-forward (replays): run scripted ticks until `tick` or `max` steps. Returns true when there.
  skipTo(tick, max = Infinity) {
    let n = 0;
    while (this.game.tick < tick && !this.game.over && n++ < max) {
      const cmds = []; const s = this.script;
      if (s) while (this.si < s.length && s[this.si][0] <= this.game.tick) { if (s[this.si][0] === this.game.tick) cmds.push(...s[this.si][1]); this.si++; }
      this.game.step(cmds); this.game.fx.length = 0;
    }
    return this.game.tick >= tick || this.game.over;
  }
}
Object.assign(LocalRunner.prototype, Halftime);

export const DELAY = 5; // ticks of input delay (250ms)
export class LockstepRunner {
  constructor(game, myTeam, transport, opts = {}) {
    this.game = game; this.myTeam = myTeam; this.t = transport; this.online = true;
    this.speed = opts.speed || 1; this.paused = false;
    this.queue = []; this.seq = 0; this.acc = 0;
    this.inputs = [new Map(), new Map()];
    this.sentUpTo = DELAY - 1;
    for (let k = 0; k < DELAY; k++) { this.inputs[0].set(k, []); this.inputs[1].set(k, []); }
    this.hashes = new Map(); this.remoteHashes = new Map();
    this.stalls = 0; this.onDesync = null; this.lastRemote = performance.now();
    this.waiting = false; this.log = [];
  }
  send(cmd) { this.queue.push({ ...cmd, team: this.myTeam, seq: ++this.seq }); }
  receive(msg) {
    this.lastRemote = performance.now();
    if (msg.t === 'in') { for (const [k, c] of msg.b) this.inputs[1 - this.myTeam].set(k, c); }
    else if (msg.t === 'h') { this.remoteHashes.set(msg.k, msg.v); this.checkHash(msg.k); }
    else if (msg.t === 'ht') this.remoteHt = true;
  }
  checkHash(k) {
    if (this.hashes.has(k) && this.remoteHashes.has(k) && this.hashes.get(k) !== this.remoteHashes.get(k)) { this.onDesync && this.onDesync(k); }
  }
  flush() {
    // Schedule our input for every tick up to now+DELAY (usually exactly one tick).
    const target = this.game.tick + DELAY;
    const batch = [];
    while (this.sentUpTo < target) {
      this.sentUpTo++;
      const cmds = this.sentUpTo === target ? this.queue.splice(0) : [];
      this.inputs[this.myTeam].set(this.sentUpTo, cmds);
      batch.push([this.sentUpTo, cmds]);
    }
    if (batch.length) this.t.send({ t: 'in', b: batch });
  }
  update(dt, onBefore, onAfter) {
    if (this.game.over) return 0;
    this.acc += Math.min(1.5, dt) * this.speed;
    // If the remote is ahead of us (we have their future inputs), catch up a bit faster.
    const theirMax = Math.max(-1, ...this.inputs[1 - this.myTeam].keys());
    if (theirMax - this.game.tick > DELAY * 3) this.acc += DT;
    let n = 0;
    this.waiting = false;
    if (this.holding()) { this.acc = 0; return 0; }
    while (this.acc >= DT && n < 40) {
      if (this.holding()) { this.acc = 0; break; }
      this.flush();
      const k = this.game.tick;
      const a = this.inputs[0].get(k), b = this.inputs[1].get(k);
      if (!a || !b) { this.waiting = true; this.stalls++; this.acc = Math.min(this.acc, DT * 2); break; }
      onBefore && onBefore();
      record(this, k, [...a, ...b]);
      this.game.step([...a, ...b]);
      onAfter && onAfter();
      this.inputs[0].delete(k); this.inputs[1].delete(k);
      if (this.game.tick % 40 === 0) {
        const v = this.game.checksum();
        this.hashes.set(this.game.tick, v);
        this.t.send({ t: 'h', k: this.game.tick, v });
        this.checkHash(this.game.tick);
        if (this.hashes.size > 30) { const old = this.game.tick - 1200; for (const kk of this.hashes.keys()) if (kk < old) { this.hashes.delete(kk); this.remoteHashes.delete(kk); } }
      }
      this.acc -= DT; n++;
    }
    return n;
  }
  get alpha() { return Math.min(1, this.acc / DT); }
}
Object.assign(LockstepRunner.prototype, Halftime);
