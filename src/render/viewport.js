// Viewport watcher. iOS reports stale sizes for a frame or two after a rotation, after the toolbars
// slide, after returning from the background and around full screen, so every such signal schedules a
// re-fit right away, after two animation frames and again a little later. Subscribers re-measure live
// (no cached rects) and resize their canvases only when the backing store no longer matches.
const subs = new Set();
let timers = [], raf = 0;

export function onViewport(fn) { subs.add(fn); return () => subs.delete(fn); }

function run() {
  // a rotation can leave the page scrolled, which offsets every touch from what is drawn
  if (window.scrollX || window.scrollY) window.scrollTo(0, 0);
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
refit();
