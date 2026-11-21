// Menu-side juice, all of it switched off or toned down by Settings → Reduced effects:
//   tweenNumber  counts a number up/down in place (gold, score, rating, XP)
//   growBars     progress bars fill from empty on a fresh screen
//   confetti     a short burst, only for real wins and promotions
//   installPressSounds  one soft synthesized "tok" for every menu button press (audio.ui: no extra downloads)
import { h } from './dom.js';
import { settings } from './settings.js';
import { audio } from '../audio.js';

const reduced = () => !!settings.reducedMotion;
const ease = (k) => 1 - (1 - k) ** 3;

// Counts el's number from `from` to `to`. fmt(v) formats the shown value. Reduced effects: jumps straight there.
export function tweenNumber(el, from, to, ms = 700, fmt = (v) => String(Math.round(v))) {
  if (!el) return;
  if (el._tw) cancelAnimationFrame(el._tw);
  if (reduced() || from === to || !(ms > 0)) { el.textContent = fmt(to); return; }
  const t0 = performance.now();
  const step = (now) => {
    const k = Math.min(1, (now - t0) / ms);
    el.textContent = fmt(from + (to - from) * ease(k));
    el._tw = k < 1 ? requestAnimationFrame(step) : 0;
  };
  el.textContent = fmt(from);
  el._tw = requestAnimationFrame(step);
}
// A short scale "pop" on an element whose value just changed (CSS class .jpop).
export function pop(el) {
  if (!el || reduced()) return;
  el.classList.remove('jpop'); void el.offsetWidth; el.classList.add('jpop');
}
// Progress bars (.pbar i) inside root start empty and fill to their value.
export function growBars(root, delay = 120) {
  if (!root || reduced()) return;
  const bars = [...root.querySelectorAll('.pbar i')];
  const want = bars.map((b) => b.style.width);
  for (const b of bars) { b.style.transition = 'none'; b.style.width = '0%'; }
  void root.offsetWidth;
  setTimeout(() => bars.forEach((b, i) => { b.style.transition = ''; b.style.width = want[i]; }), delay);
}
// Confetti from the top of the screen. Only call it for a real win or a promotion.
export function confetti(colors = ['#ffd84a', '#ffffff', '#6fdc8c', '#4aa3ff', '#ff8a3a'], n = 34) {
  if (reduced()) return;
  const box = h('div', { class: 'jconf', 'aria-hidden': 'true' });
  for (let i = 0; i < n; i++) {
    box.append(h('i', { style: { '--x': `${(i * 61 + 7) % 100}%`, '--d': `${(i % 9) * 0.06}s`, '--c': colors[i % colors.length], '--r': `${(i * 47) % 360}deg`, '--dx': `${((i * 29) % 80) - 40}px` } }));
  }
  document.body.append(box);
  setTimeout(() => box.remove(), 3200);
}

// ── press sounds: a tiny synthesized blip on the audio engine's UI bus, pitched by the kind of button ──
export function installPressSounds() {
  window.addEventListener('pointerdown', (e) => {
    if (e.button) return;
    const b = e.target.closest && e.target.closest('#screen button, .modal button, #halftime button, .rankmoment, .h2tile');
    if (!b || b.disabled) return;
    audio.ui(b.classList.contains('big') || b.classList.contains('h2go') || b.classList.contains('lockbtn') ? 'big' : b.classList.contains('backbtn') ? 'back' : 'tap');
  }, true);
}
