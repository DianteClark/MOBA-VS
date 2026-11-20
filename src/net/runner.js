// Match runners. Both drive the deterministic sim at a fixed tick rate.
//  LocalRunner – vs AI / watch mode: free speed control, commands applied next tick.
//  LockstepRunner – peer-to-peer: each peer sends its command list for tick T+DELAY;
//                   the sim only advances when both peers' inputs for the tick are known.
import { DT } from '../sim/constants.js';

export class LocalRunner {
  constructor(game, myTeam) { this.game = game; this.myTeam = myTeam; this.queue = []; this.speed = 1; this.paused = false; this.acc = 0; this.seq = 0; this.online = false; }
  send(cmd) { this.queue.push({ ...cmd, team: this.myTeam, seq: ++this.seq }); }
  update(dt, onBefore, onAfter) {
    if (this.paused || this.game.over) { this.acc = 0; return 0; }
    this.acc += Math.min(0.25, dt) * this.speed;
    let n = 0;
    while (this.acc >= DT && n < 40) {
      onBefore && onBefore();
      const cmds = this.queue; this.queue = [];
      this.game.step(cmds);
      onAfter && onAfter();
      this.acc -= DT; n++;
    }
    return n;
  }
  get alpha() { return Math.min(1, this.acc / DT); }
}

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
    this.waiting = false;
  }
  send(cmd) { this.queue.push({ ...cmd, team: this.myTeam, seq: ++this.seq }); }
  receive(msg) {
    this.lastRemote = performance.now();
    if (msg.t === 'in') { for (const [k, c] of msg.b) this.inputs[1 - this.myTeam].set(k, c); }
    else if (msg.t === 'h') { this.remoteHashes.set(msg.k, msg.v); this.checkHash(msg.k); }
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
    while (this.acc >= DT && n < 40) {
      this.flush();
      const k = this.game.tick;
      const a = this.inputs[0].get(k), b = this.inputs[1].get(k);
      if (!a || !b) { this.waiting = true; this.stalls++; this.acc = Math.min(this.acc, DT * 2); break; }
      onBefore && onBefore();
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
