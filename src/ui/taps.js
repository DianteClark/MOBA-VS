// Tap registration safety net, installed once for the whole app (imported by main.js). Pointer events only.
//  * iOS Safari only shows :active (the instant pressed look) when the page listens to touchstart.
//  * Re-rendered mid-tap: a button that is replaced by an identical one between the finger going down and
//    lifting (a live list that re-draws) loses its click in every browser; the new copy under the finger is
//    clicked instead (same class, label and title, within the tap slop).
//  * Ghost clicks: what the finger pressed is gone when the click arrives (a backdrop that closed on pointerdown,
//    a re-render): iOS would deliver that click to whatever is under the finger now. It is dropped.
//  * Too new to be meant: content stamped with el._born = performance.now() (decision tray cards, the call ring,
//    the target sheet, the hero popover) ignores a click whose finger went down before it appeared, so a card that
//    pops in under a falling finger (or a ring opened by the very tap that is lifting) is never chosen by accident.
// Keyboard and script clicks (detail 0 or untrusted) are never touched.
const SEL = 'button, [role=button], a[href], summary, label, input, select';
const SLOP = 10, TAP_MS = 900;
let down = null; // the last primary press: { t, x, y, id, target, el, key, synth, synthAt }

const keyOf = (el) => (typeof el.className === 'string' ? el.className.replace(/\b(on|hot|dim|pressed)\b/g, '').trim() : '') + '|' + (el.title || '') + '|' + el.textContent.trim().slice(0, 60);

if (typeof document !== 'undefined') {
  document.addEventListener('touchstart', () => {}, { passive: true });
  document.addEventListener('pointerdown', (e) => {
    if (!e.isPrimary || !e.isTrusted) return;
    const el = e.target.closest ? e.target.closest(SEL) : null;
    down = { t: performance.now(), x: e.clientX, y: e.clientY, id: e.pointerId, target: e.target, el, key: el ? keyOf(el) : null, synth: null, synthAt: 0 };
  }, true);
  // the nearest _born stamp on the way up from n (0: none)
  const bornOf = (n) => { for (; n && n !== document; n = n.parentNode) if (n._born) return n._born; return 0; };
  const cls = (el) => (el && typeof el.className === 'string' ? el.className.split(' ')[0] : '');
  document.addEventListener('pointerup', (e) => {
    const d = down; if (!d || e.pointerId !== d.id || !d.el || d.el.isConnected) return;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > SLOP || performance.now() - d.t > TAP_MS) return;
    const at = document.elementFromPoint(e.clientX, e.clientY), n = at && at.closest ? at.closest(SEL) : null;
    if (!n || n === d.el || n.disabled || keyOf(n) !== d.key || bornOf(n) > d.t + 1) return;
    d.synth = n; d.synthAt = performance.now();
    n.click();
  }, true);
  document.addEventListener('click', (e) => {
    const d = down; if (!d || !e.isTrusted || !e.detail) return;
    if (performance.now() - d.t > 1500) return;
    const drop = () => { e.stopImmediatePropagation(); e.preventDefault(); };
    if (d.synth) { if (performance.now() - d.synthAt < 700) drop(); return; } // the re-rendered copy was already clicked
    if (bornOf(e.target) > d.t + 1) { drop(); return; }
    if (d.target && !d.target.isConnected) {
      // what was pressed is gone: only its own re-drawn copy (same kind of control under the finger) may take the click
      const n = e.target.closest ? e.target.closest(SEL) : null;
      if (!(d.el && n && cls(n) === cls(d.el))) drop();
    }
  }, true);
}
