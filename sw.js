// Service worker: instant repeat launches and play on a weak signal, without ever mixing two builds.
//
// * Cache name is keyed off the game VERSION (main.js registers `sw.js?v=<VERSION>`): a version bump
//   installs a new worker that precaches the shell into a fresh cache; it waits until the page says it
//   is safe (on the menu, never mid-match), then takes over and the page reloads once.
// * Code (html/js/css/json) is network-first with a 4s timeout, cache as the offline fallback, so a launch
//   always runs one consistent build. Art and sound are cache-first, refreshed per file in the background.
//   When src/main.js or the patch notes change the page is told an update is ready (it reloads on the menu).
// * Music (range requests), the online API and the owner dashboard (admin.html, src/ui/admin.js) are left to
//   the network: the dashboard is never cached. Sound effects (plain fetches) are cached like any file.
// * Offline: after the first full load the page asks for everything a vs-AI match needs (precache.json, written
//   by tools/precache.mjs, plus the files the page itself loaded and its language pack). Missing files are
//   fetched into the same cache, so the game opens and plays vs AI with no connection.
// * Push notifications (worker/push.js): show the message; a tap focuses the game (or opens it) at its url.
const V = new URL(self.location.href).searchParams.get('v') || '0';
// REV: bump when the cache layout itself changes. r2: never store or serve redirected responses
// (Cloudflare answers /index.html with a redirect to /, and Safari refuses a redirected page from a worker).
// r3: code (html/js/css/json) is NETWORK-FIRST so a launch never mixes two builds' modules (a stale module
// from the cache plus a new one from the network broke the module graph and hung the loading screen).
// Art/sound stay cache-first with a background refresh per file. A missing file never aborts a refresh.
const REV = 'r3';
const CACHE = `mobavs-v${V}-${REV}`;
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
    // A cache from an older layout (r2 and before) can hold a mix of builds that hangs launching: take over at
    // once and reload the open pages (activate). Otherwise the page decides when switching builds is safe.
    const old = (await caches.keys()).filter((k) => k.startsWith('mobavs-') && !k.endsWith('-' + REV) && !k.includes('-' + REV + '-'));
    if (old.length) { rescue = true; await self.skipWaiting(); }
  })());
});
self.addEventListener('message', (e) => {
  if (e.data && e.data.t === 'skipWaiting') self.skipWaiting();
  if (e.data && e.data.t === 'precache') e.waitUntil(precacheAll(e.data.extra || [], e.source));
});

// Offline pack: every file of the vs-AI game into the live cache (only those not there yet). Same rules as
// the fetch handler: same origin, nothing private, never a redirected response (clean()).
let precaching = null;
function precacheAll(extra, client) {
  if (precaching) return precaching;
  precaching = (async () => {
    let list = [];
    try { const r = await fetch('precache.json', { cache: 'no-cache' }); if (r.ok) list = (await r.json()).files || []; } catch { /* offline: extra only */ }
    const urls = [...new Set([...list, ...extra].map((u) => new URL(u, self.registration.scope).href))]
      .filter((u) => { const url = new URL(u); return url.origin === self.location.origin && cacheable(new Request(u), url); });
    const cache = await caches.open(CACHE);
    let got = 0, failed = 0;
    for (let i = 0; i < urls.length; i += 6) {
      await Promise.all(urls.slice(i, i + 6).map(async (u) => {
        try {
          if (await cache.match(u, { ignoreSearch: false })) { got++; return; }
          const res = await clean(await fetch(u, { cache: 'no-cache' }));
          if (res && res.ok && !res.redirected) { await cache.put(u, res); got++; } else failed++;
        } catch { failed++; }
      }));
    }
    if (client) client.postMessage({ t: 'precached', got, failed, total: urls.length });
    precaching = null;
  })();
  return precaching;
}
let rescue = false;
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const ks = await caches.keys();
    const stale = ks.filter((k) => k.startsWith('mobavs-') && k !== CACHE);
    const layoutChange = stale.some((k) => !k.includes('-' + REV));
    await Promise.all(stale.map((k) => caches.delete(k)));
    await self.clients.claim();
    // Pages opened under an old layout may be stuck on the loading screen: reload them once, fresh.
    if (rescue || layoutChange) for (const c of await self.clients.matchAll({ type: 'window' })) { try { await c.navigate(c.url); } catch { /* not ours */ } }
  })());
});

const PRIVATE = /\/(admin(\.html)?|src\/ui\/admin\.js|css\/admin\.css)$/; // '/admin': Cloudflare's pretty URL for admin.html
const cacheable = (req, url) => req.method === 'GET' && !req.headers.has('range') &&
  ((url.origin === self.location.origin && !url.pathname.includes('/assets/audio/music/') && !PRIVATE.test(url.pathname)) || url.href.startsWith(PEERJS));

const CODE = /\.(m?js|css|json|html|webmanifest)$/;
const RELEASE = /\/src\/(main\.js|data\/patchnotes\.js)$/;
const sig = (r) => (r && (r.headers.get('etag') || r.headers.get('last-modified'))) || '';
const isCode = (req, url) => req.mode === 'navigate' || url.pathname.endsWith('/') || CODE.test(url.pathname);

self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (!cacheable(req, url)) return;
  const nav = req.mode === 'navigate';
  const key = nav ? './' : req;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = async () => { const h = await cache.match(req, { ignoreSearch: nav }) || (nav ? await cache.match('./') : null); return h && !h.redirected ? h : null; };
    if (url.origin === self.location.origin && isCode(req, url)) {
      // network first (short timeout), cache as the offline fallback: every launch runs one consistent build
      try {
        const res = await clean(await Promise.race([fetch(nav ? req.url : req, { cache: 'no-cache' }), new Promise((_, rej) => setTimeout(() => rej(new Error('slow')), 4000))]));
        if (res && res.ok) {
          // main.js or the patch notes changed (every release edits one of them): tell open pages a new build is
          // live, so a resumed Home Screen app reloads on the menu. ETag, or Last-Modified where a host sends no ETag.
          const prev = RELEASE.test(url.pathname) ? await cache.match(req) : null;
          e.waitUntil((async () => {
            await cache.put(key, res.clone());
            const a = sig(prev), b = sig(res);
            const self_ = req.destination === 'script' ? e.clientId : null; // the page importing it runs the new build already (no extra reload)
            if (a && b && a !== b) for (const c of await self.clients.matchAll({ type: 'window' })) if (c.id !== self_) c.postMessage({ t: 'sw-updated' });
          })());
          return res;
        }
        return (await cached()) || res;
      } catch { return (await cached()) || (nav ? new Response('Offline', { status: 503 }) : Response.error()); }
    }
    // art, sound, fonts, the PeerJS library: cache first, refreshed per file in the background
    const hit = await cached();
    const net = fetch(req, { cache: 'no-cache' }).then(clean).then(async (res) => {
      if (res && (res.ok || res.type === 'opaque')) await cache.put(key, res.clone());
      else if (res && res.status === 404) await cache.delete(key); // removed in a newer build
      return res;
    }).catch(() => null);
    if (hit) { e.waitUntil(net); return hit; }
    return (await net) || Response.error();
  })());
});

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
