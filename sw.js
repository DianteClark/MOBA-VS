// Service worker: instant repeat launches and play on a weak signal, without ever mixing two builds.
//
// * Cache name is keyed off the game VERSION (main.js registers `sw.js?v=<VERSION>`): a version bump
//   installs a new worker that precaches the shell into a fresh cache; it waits until the page says it
//   is safe (on the menu, never mid-match), then takes over and the page reloads once.
// * Every same-origin GET is stale-while-revalidate: served from the cache at once, re-checked in the
//   background. If any file changed (a deploy that did not bump VERSION), the whole cached set is
//   re-downloaded into a staging cache and swapped in together, then the page is told an update is
//   ready (it reloads on the menu). So the cache always holds one consistent build.
// * Audio (range requests) and the online API are left to the network / HTTP cache.
const V = new URL(self.location.href).searchParams.get('v') || '0';
const CACHE = `mobavs-v${V}`, STAGE = CACHE + '-next';
const SHELL = ['./', './index.html', './css/style.css', './src/main.js', './manifest.webmanifest', './favicon.ico', './apple-touch-icon.png',
  './assets/img/app/icon-192.png', './assets/font/NormalFont.ttf'];
const PEERJS = 'https://unpkg.com/peerjs@';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))));
  // no skipWaiting here: the page decides when switching builds is safe
});
self.addEventListener('message', (e) => { if (e.data && e.data.t === 'skipWaiting') self.skipWaiting(); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('mobavs-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

const cacheable = (req, url) => req.method === 'GET' && !req.headers.has('range') &&
  ((url.origin === self.location.origin && !url.pathname.includes('/assets/audio/')) || url.href.startsWith(PEERJS));

self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (!cacheable(req, url)) return;
  const nav = req.mode === 'navigate';
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    // launches with ?join=CODE or ?s=... still open the cached page
    const hit = await cache.match(req, { ignoreSearch: nav }) || (nav ? await cache.match('./index.html') : null);
    const net = fetch(nav ? req.url : req, { cache: 'no-cache' }).then(async (res) => {
      if (!res || (!res.ok && res.type !== 'opaque')) return res;
      if (!hit) await cache.put(nav ? './index.html' : req, res.clone());
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
        const res = await fetch(k.url, { cache: 'no-cache' });
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
