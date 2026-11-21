// Lightweight audio: one music track at a time + pooled sound effects.
const MUSIC = { menu: 'menu', draft: 'draft', match: 'match1', match2: 'match2', victory: 'victory', defeat: 'defeat' };
export const audio = {
  musicVol: 0.35, sfxVol: 0.55, muted: readMuted(), cur: null, curName: null, unlocked: false, last: {}, pool: {},
  init() {
    const unlock = () => { this.unlocked = true; if (this.curName && this.cur && this.cur.paused && !this.muted) this.cur.play().catch(() => {}); };
    window.addEventListener('pointerdown', unlock, { once: false });
    window.addEventListener('keydown', unlock, { once: true });
  },
  music(name) {
    if (this.curName === name) return;
    if (this.cur) { const old = this.cur; fade(old, 0, 600, () => old.pause()); }
    this.curName = name;
    if (!MUSIC[name]) { this.cur = null; return; }
    const a = new Audio(`assets/audio/music/${MUSIC[name]}.mp3`); a.loop = true; a.volume = 0;
    this.cur = a;
    if (!this.muted) a.play().then(() => fade(a, this.musicVol, 800)).catch(() => {});
  },
  sfx(name, vol = 1, throttleMs = 60) {
    if (this.muted || !this.unlocked) return;
    const now = performance.now();
    if (this.last[name] && now - this.last[name] < throttleMs) return;
    this.last[name] = now;
    const v = Math.min(1, this.sfxVol * vol); if (v <= 0.001) return;
    // small per-sound pool of reusable elements (avoids allocating an Audio per hit)
    const P = this.pool[name] || (this.pool[name] = []);
    let a = P.find((x) => x.paused || x.ended);
    if (!a) { if (P.length >= 4) a = P[0]; else { a = new Audio(`assets/audio/sfx/${name}.mp3`); P.push(a); } }
    try { a.currentTime = 0; } catch { /* not loaded yet */ }
    a.volume = v; a.play().catch(() => {});
  },
  setVolumes(music, sfx) {
    this.musicVol = Math.max(0, Math.min(1, music)); this.sfxVol = Math.max(0, Math.min(1, sfx));
    if (this.cur && !this.muted && !this.cur.paused) this.cur.volume = this.musicVol;
  },
  setMuted(m) { if (!!m !== this.muted) this.toggle(); return this.muted; },
  toggle() {
    this.muted = !this.muted;
    try { localStorage.setItem('mobavs_muted', this.muted ? '1' : '0'); } catch { /* ignore */ }
    if (this.cur) { if (this.muted) this.cur.pause(); else { this.cur.volume = this.musicVol; this.cur.play().catch(() => {}); } }
    return this.muted;
  },
};
function readMuted() { try { return localStorage.getItem('mobavs_muted') === '1'; } catch { return false; } }
function fade(a, to, ms, done) {
  const from = a.volume, t0 = performance.now();
  const step = () => { const k = Math.min(1, (performance.now() - t0) / ms); a.volume = from + (to - from) * k; if (k < 1) requestAnimationFrame(step); else done && done(); };
  step();
}
