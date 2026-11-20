// Deterministic PRNG (mulberry32). Never use Math.random inside the sim.
export class Rng {
  constructor(seed) { this.s = seed >>> 0; }
  next() {
    let t = (this.s = (this.s + 0x6D2B79F5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(n) { return Math.floor(this.next() * n); }
  range(a, b) { return a + (b - a) * this.next(); }
  chance(p) { return this.next() < p; }
  pick(arr) { return arr[this.int(arr.length)]; }
  state() { return this.s; }
}

// FNV-1a style hash over integers, used for desync checksums.
export function hashInts(h, ...vals) {
  for (const v of vals) {
    h ^= (v | 0);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}
