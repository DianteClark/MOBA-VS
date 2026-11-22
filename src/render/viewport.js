// Viewport watcher. iOS reports stale sizes for a frame or two after a rotation, after the toolbars
// slide, after returning from the background and around full screen, so every such signal schedules a
// re-fit right away, after two animation frames and again a little later. Subscribers re-measure live
// (no cached rects) and resize their canvases only when the backing store no longer matches.
const subs = new Set();
let timers = [], raf = 0;

export function onViewport(fn) { subs.add(fn); return () => subs.delete(fn); }

// App height, measured live. iOS (26 especially) can keep the fixed-position containing block (and 100%/vh
// heights) at a stale, shorter size after a rotation, a toolbar slide or a relaunch, which left a dark band
// under the match. The page height comes from --appH instead: the tallest of the live window / visual viewport
// heights, and in the Home Screen app (no browser bars at all) at least the screen's short side on phones.
let lastH = 0;
export function appHeight() {
  const vv = window.visualViewport, de = document.documentElement;
  let hgt = Math.max(window.innerHeight || 0, de.clientHeight || 0, vv && Math.abs(vv.scale - 1) < 0.01 ? vv.height : 0);
  let standalone = false;
  try { standalone = matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches || !!navigator.standalone; } catch { /* old browsers */ }
  const sw = screen.width || 0, sh = screen.height || 0, lo = Math.min(sw, sh), hi = Math.max(sw, sh);
  // a phone app window that spans the whole screen width: its height is the whole screen height
  if (standalone && lo && lo <= 540 && Math.abs(window.innerWidth - (window.innerWidth > window.innerHeight ? hi : lo)) <= 2) hgt = Math.max(hgt, window.innerWidth > window.innerHeight ? lo : hi);
  return Math.round(hgt);
}
function fitHeight() {
  const hgt = appHeight();
  if (hgt > 0 && hgt !== lastH) { lastH = hgt; document.documentElement.style.setProperty('--appH', hgt + 'px'); }
}

function run() {
  // a rotation can leave the page scrolled, which offsets every touch from what is drawn
  if (window.scrollX || window.scrollY) window.scrollTo(0, 0);
  fitHeight();
  for (const f of subs) { try { f(); } catch (e) { console.error(e); } }
}

export function refit() {
  run();
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(() => { raf = requestAnimationFrame(run); });
  for (const t of timers) clearTimeout(t);
  timers = [setTimeout(run, 250), setTimeout(run, 700)];
}

const on = (t, ev) => t && t.addEventListener(ev, refit, { passive: true });
on(window, 'resize'); on(window, 'orientationchange'); on(window, 'pageshow'); on(window, 'focus');
on(window.visualViewport, 'resize');
on(screen.orientation, 'change');
on(document, 'fullscreenchange'); on(document, 'webkitfullscreenchange');
document.addEventListener('visibilitychange', () => { if (!document.hidden) refit(); });
// devicePixelRatio changes (zoom, moving a window between screens) fire no resize on some browsers
(function watchDpr() {
  try { matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener('change', () => { refit(); watchDpr(); }, { once: true }); } catch { /* old browsers */ }
})();
// iOS can change the visible height with no event at all (toolbar collapse, standalone relaunch): a cheap
// periodic check (a few property reads) re-fits as soon as the measured height changes.
setInterval(() => { if (!document.hidden && appHeight() !== lastH) refit(); }, 500);
refit();
