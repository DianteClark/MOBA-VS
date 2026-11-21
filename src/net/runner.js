// Match runners. Both drive the deterministic sim at a fixed tick rate.
//  LocalRunner – vs AI / watch mode: free speed control, commands applied next tick.
//                 `slow` is a presentation-only time scale (Coach's Call / fight cam slow-motion).
//  LockstepRunner – peer-to-peer: each peer sends its command list for tick T+DELAY;
//                   the sim only advances when every peer's inputs for the tick are known.
//                   1v1 has two peer slots (slot = team); a co-op room has up to four (slot 0 = host,
//                   messages carry the sender's slot `p` and the host relays them, see net/peer.js Hub).
import { DT, HALFTIME } from '../sim/constants.js';

// Halftime: both runners hold the sim at 7:30 until everyone is ready (or the timer ends).
// It is a pause *between* ticks, so the simulation itself is untouched.
const Halftime = {
  holding() {
    const g = this.game;
    if (this.noHalftime || this.htDone || g.over || g.tick !== g.halftimeTick) return false;
    if (!this.ht) { this.ht = { end: performance.now() + HALFTIME.seconds * 1000, me: false, them: !this.online || this.othersReady() }; this.onHalftime && this.onHalftime(this.ht); }
    if (this.othersReady()) this.ht.them = true;
    if (performance.now() >= this.ht.end || (this.ht.me && this.ht.them)) { this.htDone = true; this.onHalftimeEnd && this.onHalftimeEnd(); return false; }
    return true;
  },
  readyHalftime() { if (!this.ht || this.ht.me) return; this.ht.me = true; if (this.online) this.t.send(this.coop ? { t: 'ht', p: this.slot } : { t: 'ht' }); },
  othersReady() { return !this.online || !!this.remoteHt; },
};
// Replays: every command the sim consumed, by tick (AI coaches are deterministic and need no log).
// A command as it enters the log: the coach's team (and co-op seat). `sys` commands (a coach leaving,
// issued by the session for that coach's seat) keep their own team and seat.
const stamp = (r, cmd) => {
  const c = { ...cmd, team: cmd.sys ? cmd.team : r.myTeam, seq: ++r.seq };
  if (r.seat !== undefined && !cmd.sys) c.seat = r.seat;
  return c;
};
const record = (r, tick, cmds) => { if (cmds.length) r.log.push([tick, cmds.map((c) => ({ ...c }))]); };

export class LocalRunner {
  constructor(game, myTeam, opts = {}) { this.game = game; this.myTeam = myTeam; this.seat = opts.seat; this.queue = []; this.speed = 1; this.slow = 1; this.paused = false; this.acc = 0; this.seq = 0; this.online = false; this.log = []; this.noHalftime = !!opts.noHalftime; this.script = opts.script || null; this.si = 0; }
  send(cmd) { this.queue.push(stamp(this, cmd)); }
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

const DELAY = 5; // ticks of input delay (250ms)
export class LockstepRunner {
  // opts.slot / opts.slots: this peer's slot and the number of peers (1v1: slot = team, 2 slots).
  // opts.seat: co-op seat stamped on our commands. opts.coop: messages carry `p` (the sender's slot).
  constructor(game, myTeam, transport, opts = {}) {
    this.game = game; this.myTeam = myTeam; this.t = transport; this.online = true;
    this.slot = opts.slot ?? myTeam; this.slots = opts.slots || 2; this.seat = opts.seat; this.coop = !!opts.coop;
    this.speed = opts.speed || 1; this.paused = false;
    this.queue = []; this.seq = 0; this.acc = 0;
    this.inputs = Array.from({ length: this.slots }, () => new Map());
    this.sentUpTo = DELAY - 1;
    for (let k = 0; k < DELAY; k++) for (const m of this.inputs) m.set(k, []);
    this.hashes = new Map(); this.remoteHashes = new Map();
    this.dropped = new Map(); // slot -> { at, cmds }: a peer that left (inputs after `at` are empty)
    this.htReady = new Set();
    this.stalls = 0; this.onDesync = null; this.lastRemote = performance.now();
    this.waiting = false; this.log = [];
  }
  send(cmd) { this.queue.push(stamp(this, cmd)); }
  // Slot a message came from: co-op messages carry it; 1v1 messages come from the one other peer.
  from(msg) { return this.coop ? msg.p : 1 - this.slot; }
  receive(msg) {
    this.lastRemote = performance.now();
    const p = this.from(msg);
    if (!(p >= 0 && p < this.slots) || p === this.slot) return;
    if (msg.t === 'in') { const d = this.dropped.get(p); for (const [k, c] of msg.b) if (!d || k < d.at) this.inputs[p].set(k, c); }
    else if (msg.t === 'h') { const l = this.remoteHashes.get(msg.k) || []; l.push(msg.v); this.remoteHashes.set(msg.k, l); this.checkHash(msg.k); }
    else if (msg.t === 'ht') { this.htReady.add(p); this.remoteHt = this.othersReady(); }
    else if (msg.t === 'drop' && p === 0) this.drop(msg.slot, msg.at, msg.cmds); // only the host decides
  }
  othersReady() { for (let p = 0; p < this.slots; p++) if (p !== this.slot && !this.dropped.has(p) && !this.htReady.has(p)) return false; return true; }
  checkHash(k) {
    if (!this.hashes.has(k) || !this.remoteHashes.has(k)) return;
    const v = this.hashes.get(k);
    if (this.remoteHashes.get(k).some((x) => x !== v)) { this.onDesync && this.onDesync(k); }
  }
  // A peer left: from tick `at` on its inputs are empty, and `cmds` (its 'leave' command) play at `at`.
  // Only the host decides `at` (every input passes through it, so no peer can be past it); see hostDrop.
  drop(p, at, cmds = []) {
    if (p === this.slot || this.dropped.has(p)) return;
    this.dropped.set(p, { at, cmds });
    for (const k of [...this.inputs[p].keys()]) if (k >= at) this.inputs[p].delete(k);
    if (this.ht) this.remoteHt = this.othersReady();
  }
  hostDrop(p, cmds) {
    let at = this.game.tick; for (const k of this.inputs[p].keys()) at = Math.max(at, k + 1);
    this.drop(p, at, cmds);
    this.t.send({ t: 'drop', p: this.slot, slot: p, at, cmds });
    return at;
  }
  inputFor(p, k) {
    const d = this.dropped.get(p);
    if (d && k >= d.at) return k === d.at ? d.cmds : [];
    return this.inputs[p].get(k);
  }
  flush() {
    // Schedule our input for every tick up to now+DELAY (usually exactly one tick).
    const target = this.game.tick + DELAY;
    const batch = [];
    while (this.sentUpTo < target) {
      this.sentUpTo++;
      const cmds = this.sentUpTo === target ? this.queue.splice(0) : [];
      this.inputs[this.slot].set(this.sentUpTo, cmds);
      batch.push([this.sentUpTo, cmds]);
    }
    if (batch.length) this.t.send(this.coop ? { t: 'in', p: this.slot, b: batch } : { t: 'in', b: batch });
  }
  update(dt, onBefore, onAfter) {
    if (this.game.over) return 0;
    this.acc += Math.min(1.5, dt) * this.speed;
    // If a remote is ahead of us (we have their future inputs), catch up a bit faster.
    let theirMax = -1;
    for (let p = 0; p < this.slots; p++) if (p !== this.slot && !this.dropped.has(p)) for (const k of this.inputs[p].keys()) if (k > theirMax) theirMax = k;
    if (theirMax - this.game.tick > DELAY * 3) this.acc += DT;
    let n = 0;
    this.waiting = false;
    if (this.holding()) { this.acc = 0; return 0; }
    while (this.acc >= DT && n < 40) {
      if (this.holding()) { this.acc = 0; break; }
      this.flush();
      const k = this.game.tick, all = [];
      let missing = false;
      for (let p = 0; p < this.slots; p++) { const c = this.inputFor(p, k); if (!c) { missing = true; break; } all.push(...c); }
      if (missing) { this.waiting = true; this.stalls++; this.acc = Math.min(this.acc, DT * 2); break; }
      onBefore && onBefore();
      record(this, k, all);
      this.game.step(all);
      onAfter && onAfter();
      for (const m of this.inputs) m.delete(k);
      if (this.game.tick % 40 === 0) {
        const v = this.game.checksum();
        this.hashes.set(this.game.tick, v);
        this.t.send(this.coop ? { t: 'h', p: this.slot, k: this.game.tick, v } : { t: 'h', k: this.game.tick, v });
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
