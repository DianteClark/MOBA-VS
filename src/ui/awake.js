// Keep the screen awake while the player is in a draft, a match or watching a replay.
// Coaching means long stretches without touching the screen, so phones would otherwise dim and lock.
// Uses the Screen Wake Lock API (iOS 16.4+, Android Chrome). Where it is missing (older iOS,
// some home-screen apps), it falls back to a tiny silent looping video, which also keeps iOS awake.
let want = false, lock = null, video = null, pending = false;

async function grab() {
  if (!want || document.hidden || pending) return;
  if ('wakeLock' in navigator) {
    if (lock && !lock.released) return;
    pending = true;
    try {
      lock = await navigator.wakeLock.request('screen');
      lock.addEventListener('release', () => { lock = null; if (want && !document.hidden) setTimeout(grab, 500); });
      pending = false;
      return;
    } catch { lock = null; } // not allowed yet (needs a visible page / user gesture): fall back
    pending = false;
  }
  if (!video) {
    video = document.createElement('video');
    video.setAttribute('playsinline', ''); video.setAttribute('muted', ''); video.muted = true; video.loop = true;
    video.setAttribute('aria-hidden', 'true');
    Object.assign(video.style, { position: 'fixed', width: '1px', height: '1px', opacity: '0.01', pointerEvents: 'none', left: '0', top: '0' });
    video.src = 'assets/video/awake.mp4';
    document.body.appendChild(video);
  }
  try { await video.play(); } catch { /* needs a tap: retried on the next one */ }
}

function drop() {
  if (lock) { const l = lock; lock = null; l.release().catch(() => {}); }
  if (video) video.pause();
}

export function keepAwake(on) {
  want = !!on;
  if (want) grab(); else drop();
}

document.addEventListener('visibilitychange', () => { if (!document.hidden) grab(); });
// iOS only lets video (and sometimes the wake lock) start from a tap: retry on any touch while wanted.
document.addEventListener('pointerdown', () => { if (want && !(lock && !lock.released) && !(video && !video.paused)) grab(); }, { passive: true });
