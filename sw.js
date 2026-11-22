// Service worker: instant repeat launches and play on a weak signal, without ever mixing two builds.
//
// * Cache name is keyed off the game VERSION (main.js registers `sw.js?v=<VERSION>`): a version bump
//   installs a new worker that precaches the shell into a fresh cache; it waits until the page says it
//   is safe (on the menu, never mid-match), then takes over and the page reloads once.
// * Every same-origin GET is stale-while-revalidate: served from the cache at once, re-checked in the
//   background. If any file changed (a deploy that did not bump VERSION), the whole cached set is
//   re-downloaded into a staging cache and swapped in together, then the page is told an update is
//   ready (it reloads on the menu). So the cache always holds one consistent build.
// * Audio (range requests), the online API and the owner dashboard (admin.html, src/ui/admin.js) are left to
//   the network: the dashboard is never cached.
// * Push notifications (worker/push.js): show the message; a tap focuses the game (or opens it) at its url.
const V = new URL(self.location.href).searchParams.get('v') || '0';
// REV: bump when the cache layout itself changes. r2: never store or serve redirected responses
// (Cloudflare answers /index.html with a redirect to /, and Safari refuses a redirected page from a worker).
const REV = 'r2';
const CACHE = `mobavs-v${V}-${REV}`, STAGE = CACHE + '-next';
const SHELL = ['./', './css/style.css', './src/main.js', './manifest.webmanifest', './favicon.ico', './apple-touch-icon.png',
  './assets/img/app/icon-192.png', './assets/font/NormalFont.ttf'];
const PEERJS = 'https://unpkg.com/peerjs@';

// A response that went through a redirect cannot be handed to a navigation (Safari: "Response served by
// service worker has redirections"). Copy it into a plain response before it is cached or served.
async function clean(res) {
  if (!res || !res.redirected) return res;
  const body = await res.blob();
  return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
}

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    for (const u of SHELL) { const r = await clean(await fetch(new Request(u, { cache: 'reload' }))); if (r && r.ok) await c.put(u, r); }
    // A cache from before r2 may hold a redirected page that breaks launching: take over at once.
    // Otherwise the page decides when switching builds is safe (on the menu, never mid-match).
    const old = (await caches.keys()).filter((k) => k.startsWith('mobavs-') && !k.endsWith('-' + REV) && !k.includes('-' + REV + '-'));
    if (old.length) await self.skipWaiting();
  })());
});
self.addEventListener('message', (e) => { if (e.data && e.data.t === 'skipWaiting') self.skipWaiting(); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('mobavs-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

const PRIVATE = /\/(admin\.html|src\/ui\/admin\.js|css\/admin\.css)$/;
const cacheable = (req, url) => req.method === 'GET' && !req.headers.has('range') &&
  ((url.origin === self.location.origin && !url.pathname.includes('/assets/audio/') && !PRIVATE.test(url.pathname)) || url.href.startsWith(PEERJS));

self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (!cacheable(req, url)) return;
  const nav = req.mode === 'navigate';
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    // launches with ?join=CODE or ?s=... still open the cached page
    let hit = await cache.match(req, { ignoreSearch: nav }) || (nav ? await cache.match('./') : null);
    if (hit && hit.redirected) { hit = null; } // never serve a redirected response
    const net = fetch(nav ? req.url : req, { cache: 'no-cache' }).then(clean).then(async (res) => {
      if (!res || (!res.ok && res.type !== 'opaque')) return res;
      if (!hit) await cache.put(nav ? './' : req, res.clone());
      else if (await changed(hit, res.clone())) await scheduleRefresh();
      return res;
    }).catch(() => null);
    if (hit) { e.waitUntil(net); return hit.clone(); } // keep `hit` unread for the comparison
    return (await net) || (nav ? new Response('Offline', { status: 503 }) : Response.error());
  })());
});

async function changed(a, b) {
  if (a.type === 'opaque' || b.type === 'opaque') return false; // pinned CDN versions never change
  const ea = a.headers.get('etag'), eb = b.headers.get('etag');
  if (ea && eb) return ea !== eb;
  const [x, y] = await Promise.all([a.clone().arrayBuffer(), b.arrayBuffer()]);
  if (x.byteLength !== y.byteLength) return true;
  const p = new Uint8Array(x), q = new Uint8Array(y);
  for (let i = 0; i < p.length; i++) if (p[i] !== q[i]) return true;
  return false;
}

// A deploy landed: re-download every cached file into a staging cache, then swap it in as one set.
let refreshing = null;
function scheduleRefresh() {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try {
      const live = await caches.open(CACHE), keys = await live.keys();
      await caches.delete(STAGE);
      const stage = await caches.open(STAGE);
      for (const k of keys) {
        if (!k.url.startsWith(self.location.origin)) continue; // pinned CDN files never change
        const res = await clean(await fetch(k.url, { cache: 'no-cache' }));
        if (!res || (!res.ok && res.type !== 'opaque')) throw new Error('refresh failed ' + k.url);
        await stage.put(k, res);
      }
      for (const k of await stage.keys()) await live.put(k, await stage.match(k));
      await caches.delete(STAGE);
      for (const c of await self.clients.matchAll({ type: 'window' })) c.postMessage({ t: 'sw-updated' });
    } catch { await caches.delete(STAGE); /* weak signal: try again next launch */ }
    refreshing = null;
  })();
  return refreshing;
}

// ── push notifications ──
self.addEventListener('push', (e) => {
  let m = {}; try { m = e.data ? e.data.json() : {}; } catch { m = { title: 'MOBA-VS', body: e.data ? e.data.text() : '' }; }
  const url = typeof m.url === 'string' && /^\.?\/(?!\/)/.test(m.url) ? m.url : './';
  e.waitUntil(self.registration.showNotification(String(m.title || 'MOBA-VS').slice(0, 80), {
    body: String(m.body || '').slice(0, 200), tag: m.tag || 'mobavs', renotify: true, icon: 'assets/img/app/icon-192.png', badge: 'assets/img/app/icon-192.png', data: { url },
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const game = wins.find((w) => new URL(w.url).origin === self.location.origin && !PRIVATE.test(new URL(w.url).pathname));
    // an open game handles the link itself (an invite or the cup screen) without a reload mid-match
    if (game) { game.postMessage({ t: 'push-open', url: target }); return game.focus(); }
    return self.clients.openWindow(target);
  })());
});
