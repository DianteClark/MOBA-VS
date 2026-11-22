// Offline play. vs AI, Lane Rush, the Dojo, Franchise and replays run with no connection; online features say
// so instead of failing.
//   * <html class="is-offline"> while the device has no connection (navigator.onLine); menus show it (the Find
//     Match card turns into an offline note, online buttons dim) and a tap on an online-only button (.net)
//     explains instead of hanging.
//   * Back online: ping, upload the profile played offline (flushCloudSave), connect the account if this launch
//     started offline.
//   * After the first full load, the service worker is asked to cache everything vs AI needs (sw.js precacheAll):
//     precache.json + every file this page loaded + the language pack. Once done, the game opens offline.
import { ping, flushCloudSave } from './online.js';
import { toast } from '../ui/dom.js';
import { lang } from '../i18n/i18n.js';

export const net = { offline: typeof navigator !== 'undefined' && navigator.onLine === false };
const READY_KEY = 'mobavs_offline_ready';
function setOffline(off) { net.offline = off; document.documentElement.classList.toggle('is-offline', off); }

export function installOffline(app, version) {
  setOffline(navigator.onLine === false);
  window.addEventListener('offline', () => { setOffline(true); toast('Offline. vs AI, Lane Rush, the Dojo and Franchise still work; progress syncs when you are back.', 3600); });
  window.addEventListener('online', async () => {
    setOffline(false);
    const ok = await ping();
    if (!ok) return;
    const sent = await flushCloudSave();
    app.connectOnline();
    toast(sent ? 'Back online. Your progress is synced.' : 'Back online.', 2400);
  });
  // online-only buttons explain themselves while offline (capture: before their own handlers)
  document.addEventListener('click', (e) => {
    if (!net.offline) return;
    const b = e.target.closest && e.target.closest('.net'); if (!b) return;
    e.preventDefault(); e.stopPropagation();
    toast('You are offline. This needs a connection; vs AI and Lane Rush work offline.', 3000);
  }, true);
  // offline pack: after the first full load, once per build and language
  if (!('serviceWorker' in navigator)) return;
  const want = `${version}|${lang}`;
  const ask = () => {
    const c = navigator.serviceWorker.controller; if (!c || net.offline) return;
    let done = null; try { done = localStorage.getItem(READY_KEY); } catch { /* ignore */ }
    if (done === want) return;
    const loaded = performance.getEntriesByType('resource').map((r) => r.name).filter((u) => u.startsWith(location.origin));
    c.postMessage({ t: 'precache', extra: [...loaded, ...(lang !== 'en' ? [`src/i18n/packs/${lang}.json`] : [])] });
  };
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (!e.data || e.data.t !== 'precached') return;
    if (e.data.failed === 0) {
      let first = true; try { first = !localStorage.getItem(READY_KEY); localStorage.setItem(READY_KEY, want); } catch { /* ignore */ }
      if (first) toast('Ready to play offline: vs AI works with no connection.', 2600);
    }
  });
  // idle a few seconds after boot (never competes with the first screen), and again if the worker changes
  setTimeout(ask, 6000);
  navigator.serviceWorker.addEventListener('controllerchange', () => setTimeout(ask, 6000));
}
