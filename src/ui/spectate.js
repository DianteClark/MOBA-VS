// Spectate friends live: the app side of src/net/spectate.js.
//  * Relay: while you coach a match of your own (online or vs AI), friends may watch it. Your device forwards
//    the command stream 10 s behind (anti-ghosting); "Let friends watch" (Profile → Friends) turns it off.
//    The relay's id reaches friends only through the presence heartbeat (worker: friends only, in a match only).
//  * Spectator: Friends → Watch connects, receives the config and the log so far, fast-forwards headlessly
//    behind a progress bar, then plays as a read-only watch session (Broadcast mode available).
import { h, mount, toast } from './dom.js';
import { Game } from '../sim/game.js';
import { Rng } from '../sim/rng.js';
import { Relay, SpecRunner, DELAY } from '../net/spectate.js';
import { listenSpectators, relayPeer, connectSpectator } from '../net/peer.js';
import { getAccount, online } from '../net/online.js';
import { socialData, matchPresence } from './social.js';
import { audio } from '../audio.js';

const KEY = 'mobavs_spec';
export const watchAllowed = () => { try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; } };
export function setWatchAllowed(on) { try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* ignore */ } if (!on) stopRelay(); }

// ───────────── relay (the coach's side) ─────────────
let R = null; // { relay, listen, timer, peer (own, vs AI), game }
export async function startRelay(app, m, s) {
  stopRelay();
  const d = socialData();
  if (!watchAllowed() || !getAccount() || !online.ok || !d || !d.friends || !d.friends.length) return;
  const me = R = { relay: null, listen: null, timer: 0, peer: null, game: m.game, count: 0 };
  let peer = app.net && app.net.peer;
  if (!peer || !peer.id) { try { peer = me.peer = await relayPeer(); } catch { if (R === me) R = null; return; } }
  if (R !== me) { try { me.peer && me.peer.destroy(); } catch { /* ignore */ } return; }
  const friends = () => new Set(((socialData() || {}).friends || []).map((f) => f.id));
  me.relay = new Relay({ v: app.version, cfg: m.cfg, names: s.names.slice(), skins: app.renderer.skins, mapId: s.mapId, game: () => m.game, log: () => m.runner.log, ai: () => s.aiTakeover || [] },
    { allow: (pid) => (friends().has(pid) ? null : 'friends'), now: () => performance.now(), onCount: (n) => { me.count = n; if (n > (me.peak || 0)) { me.peak = n; toast(n === 1 ? 'A friend is watching your match' : `${n} friends are watching`, 1800); } } });
  me.listen = listenSpectators(peer, (t) => me.relay && me.relay.accept(t));
  me.timer = setInterval(() => { if (!me.relay || me.relay.closed) { if (R === me) stopRelay(); return; } me.relay.pump(); }, 250);
  // friends now see Watch next to your name (retried: the presence call is rate limited and may be refused)
  const tell = (n) => { if (R !== me || !me.listen.id || m.game.over) return; matchPresence(me.listen.id).then((ok) => { if (!ok && n < 4) setTimeout(() => tell(n + 1), 15000); }); };
  tell(0);
}
export const watchers = () => (R ? R.count : 0);
// Leaving: a finished match runs its feed out (the last 10 s) unless the connection goes; a match left early ends now.
export function stopRelay(soft = false) {
  const me = R; if (!me) return;
  if (soft && me.relay && me.game.over && !me.relay.closed) return; // the relay closes itself after the tail
  R = null;
  clearInterval(me.timer);
  if (me.relay) me.relay.close(true);
  if (me.listen) me.listen.close();
  if (me.peer) setTimeout(() => { try { me.peer.destroy(); } catch { /* ignore */ } }, 1600);
}

// ───────────── spectator ─────────────
let W = null; // { t, peer, runner, game, friend, ended }
export function stopWatching() {
  const w = W; if (!w) return; W = null;
  try { w.t && w.t.close(); } catch { /* ignore */ }
  try { w.peer && w.peer.destroy(); } catch { /* ignore */ }
}
export const watchingName = () => (W ? W.friend.name : null);
export function watchFriend(app, friend) {
  if (!friend.watch) { toast(`${friend.name} is not in a watchable match`); return; }
  stopWatching();
  const w = W = { t: null, peer: null, runner: null, game: null, friend, ended: false, started: false };
  const status = h('p', { class: 'muted' }, `Connecting to ${friend.name}'s match…`), bar = h('i');
  const cancel = () => { stopWatching(); app.menu(); };
  mount(document.getElementById('screen'), h('div', { class: 'lobby panel col specload', style: { alignItems: 'center' } },
    h('h2', {}, `Watch ${friend.name}`), status, h('div', { class: 'barw' }, bar),
    h('small', { class: 'muted' }, `Live with a ${DELAY / 20} s delay · read-only`), h('button', { class: 'btn', onclick: cancel }, 'Back')));
  const fail = (msg) => { if (W !== w) return; stopWatching(); toast(msg, 3000); app.menu(); };
  connectSpectator(friend.watch).then(({ peer, transport }) => {
    if (W !== w) { try { transport.close(); peer.destroy(); } catch { /* ignore */ } return; }
    w.peer = peer; w.t = transport;
    transport.onClose(() => { if (W !== w) return; w.ended = true; if (!w.started) fail('The match feed closed.'); else if (w.game && !w.game.over) toast(`${friend.name}'s feed ended`, 2600); });
    transport.onMessage((m) => {
      if (W !== w || !m) return;
      if (m.t === 'specno') fail(m.why === 'version' ? 'Your friend is on another version of the game: refresh both.' : m.why === 'full' ? 'That match already has the most spectators.' : 'That match is not open to you.');
      else if (m.t === 'sw') {
        if (m.v !== app.version) { fail('Your friend is on another version of the game: refresh both.'); return; }
        try { w.game = new Game(JSON.parse(JSON.stringify(m.cfg))); } catch { fail('Could not read that match.'); return; }
        w.runner = new SpecRunner(w.game); w.sw = m;
      } else if (m.t === 'sl' && w.runner) {
        w.runner.feed(m);
        if (!w.started && Number.isInteger(m.k) && !w.catching) catchUp(app, w, status, bar);
      } else if (m.t === 'specend') { w.ended = true; if (w.game && !w.game.over) toast(`${friend.name} left the match`, 2600); }
    });
    transport.send({ t: 'spec', v: app.version, pid: getAccount() && getAccount().id, name: app.name });
  }, (e) => fail(e && e.message ? e.message : 'Could not reach that match.'));
}
// Fast-forward headlessly (a few ms per frame), then hand the game to the app as a watch session.
function catchUp(app, w, status, bar) {
  w.catching = true;
  status.textContent = 'Catching up…';
  const step = () => {
    if (W !== w) return;
    const r = w.runner, t0 = performance.now();
    while (performance.now() - t0 < 12 && !r.skipTo(r.known, 60));
    bar.style.width = Math.round(w.game.tick / Math.max(1, r.known) * 100) + '%';
    if (w.game.tick < r.known - 2 && !w.game.over) { requestAnimationFrame(step); return; }
    w.started = true;
    audio.sfx('accept', 0.5);
    const m = w.sw;
    app.session = { mode: 'watch', spectate: { name: w.friend.name }, myTeam: -1, seed: m.cfg.seed, mapId: m.mapId || m.cfg.map, names: m.names, rng: new Rng(1),
      replay: { cfg: m.cfg, skins: m.skins || [{}, {}] }, prebuilt: { game: w.game, runner: w.runner } };
    app.fade(() => app.startMatch());
  };
  requestAnimationFrame(step);
}
// A small "LIVE" tag on the spectator's screen (who, the delay, and when the feed has ended).
export function liveTag() {
  if (!W) return null;
  const el = h('div', { class: 'speclive', role: 'status' }, h('b', {}, 'LIVE'), h('span', {}, `${W.friend.name} · ${DELAY / 20}s delay`));
  const w = W, iv = setInterval(() => { if (!el.isConnected || W !== w) { clearInterval(iv); return; } if (w.ended && !el.classList.contains('off')) { el.classList.add('off'); el.querySelector('b').textContent = 'ENDED'; } }, 1000);
  return el;
}
