// Weekend Cup screen: sign up for an 8-coach online knockout (Friday to Sunday, UTC), check in for each match,
// play it over the normal online flow, and follow the live bracket. Polls the server only while this screen is
// open (every 4-12 s; the poll also keeps your place on the sign-up list). Trophies and cup history live here and
// on the public profile. Server side: worker/cups.js.
import { h, mount, toast, emptyState } from './dom.js';
import { MAPS } from '../maps/defs.js';
import { ping, getAccount, ensureAccount, cupState, cupJoin, cupLeave, cupReady, cupHistory } from '../net/online.js';
import { keepAwake } from './awake.js';
import { buzz } from './haptics.js';
import { audio } from '../audio.js';
import { showPlayer } from './social.js';

const ROUND = ['Quarterfinal', 'Semifinal', 'Final'];
const PLACE = { 1: 'Champion', 2: 'Finalist', 3: 'Semifinalist', 5: 'Quarterfinalist', '-1': 'Disqualified' };
// Poll pace: quick while a check-in or a connection is pending, slower on the sign-up list, slow while waiting.
const pace = (st) => { const c = st && st.cup, m = st && st.me && st.me.match; return m ? 4000 : c && c.status === 'signup' && st.me ? 8000 : 12000; };
const item = (n) => `assets/img/${n}.png`;
const screen = () => document.getElementById('screen');
const clock = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return s >= 3600 ? `${Math.floor(s / 86400) ? Math.floor(s / 86400) + 'd ' : ''}${Math.floor(s / 3600) % 24}h ${Math.floor(s / 60) % 60}m` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
// Every cup match is played on a map picked from its match id, so host and guest agree without a message.
const cupMap = (id) => { let x = 0; for (const c of String(id)) x = (x * 31 + c.charCodeAt(0)) >>> 0; return MAPS[x % MAPS.length].id; };

let view = 0; // the open screen instance; older pollers stop on their own
let connecting = null; // { match, at }: a room being opened / joined for this cup match

export async function showWeekendCup(app) {
  if (app.net && !app.match) app.cleanupNet(); // back from a cup match's results: that connection is done
  const id = ++view, live = () => view === id && root.isConnected;
  const body = h('div', { class: 'wcbody col' }, h('p', { class: 'muted center' }, 'Loading the cup…'));
  const hist = h('details', { class: 'panel wchist' }, h('summary', {}, h('b', {}, 'Trophies & cup history')), h('p', { class: 'muted small' }, 'Loading…'));
  const root = h('div', { class: 'subscreen wcup', 'data-view': 'wcup' },
    h('div', { class: 'shead' }, h('button', { class: 'btn backbtn', onclick: () => { audio.sfx('move', 0.5); app.menu(); } }, '‹ Back'),
      h('div', {}, h('small', {}, 'ONLINE · 8 COACHES · KNOCKOUT'), h('h2', {}, 'Weekend Cup')), h('div')),
    cupTabs(app, 'weekend'), body, hist);
  mount(screen(), root);
  if (!(await ping())) { if (live()) mount(body, emptyState('assets/img/icons/Vision.png', 'Cups offline', 'The cup server can\'t be reached right now. Try again in a moment.')); return; }
  try { await ensureAccount(app.name); } catch { if (live()) mount(body, emptyState('assets/img/icons/Vision.png', 'Cups offline', 'Could not create your online account.')); return; }
  loadHistory(app, hist);
  let st = null, timer = 0, wasSigned = false;
  const act = async (fn, busyEl) => {
    if (busyEl) busyEl.disabled = true;
    try { st = await fn(); if (live()) render(); } catch (e) { toast(e.message || 'Cup server error'); if (busyEl) busyEl.disabled = false; }
  };
  const poll = async () => {
    clearTimeout(timer);
    if (!live()) return;
    try { st = await cupState(app.version); } catch (e) { if (!st) { mount(body, emptyState('assets/img/icons/Vision.png', 'Could not load the cup', String(e.message || e))); } }
    if (!live()) return;
    if (st) render();
    timer = setTimeout(poll, pace(st));
  };
  const render = () => {
    const c = st.cup, me = st.me;
    const signed = !!(c && me && c.status === 'signup');
    if (wasSigned && !signed && !(c && (c.status === 'live' || c.status === 'void'))) toast('You left the sign-up list.');
    if (!wasSigned && signed) keepAwake(true);
    wasSigned = signed;
    if (!c || (c.status !== 'live' && c.status !== 'signup' && !me)) { mount(body, lobby(app, st, act)); return; }
    if (c.status === 'signup') { mount(body, signup(app, st, act)); return; }
    if (c.status === 'void') { mount(body, h('div', { class: 'panel col center wcmsg' }, h('img', { class: 'bigcup dim', src: item('items/SilverCup'), alt: '' }), h('b', {}, 'This cup did not start'), h('p', { class: 'muted' }, c.reason || 'Not enough coaches signed up.'), joinBtn(app, st, act))); return; }
    if (me && me.match && me.match.status === 'ready' && !me.match.ready && root.dataset.ping !== String(me.match.round)) { root.dataset.ping = String(me.match.round); audio.sfx('accept', 0.8); buzz('callWin'); }
    if (me && me.match && me.match.status === 'playing') { keepAwake(true); autoConnect(app, st); }
    mount(body, myPanel(app, st, act), bracket(app, st));
  };
  poll();
}

function joinBtn(app, st, act) {
  if (!st.open) return h('small', { class: 'muted' }, `Sign-ups open again in ${clock(st.opensIn)} (Friday, UTC).`);
  return h('button', { class: 'btn big', onclick: (e) => { audio.sfx('accept', 0.6); act(() => cupJoin(app.version), e.target); } }, 'Join the next cup');
}

// Not in a cup: explain, show the open sign-up list (if any) and the Join button.
function lobby(app, st, act) {
  const c = st.cup;
  return h('div', { class: 'panel col center wcmsg' },
    h('img', { class: 'bigcup', src: item('items/GoldCup'), alt: '' }),
    st.open ? h('b', {}, c && c.status === 'signup' ? `A cup is filling up: ${c.count} / ${c.size} coaches` : 'Weekend Cups are open!') : h('b', {}, 'Weekend Cups run Friday to Sunday (UTC)'),
    h('p', { class: 'muted' }, 'Eight real coaches, three knockout rounds, no bots. The cup starts the moment eight coaches are signed up; if it does not fill within 20 minutes it is called off.'),
    joinBtn(app, st, act),
    st.open && st.closesIn ? h('small', { class: 'muted' }, `Sign-ups close in ${clock(st.closesIn)}.`) : null);
}

// On the sign-up list: who is in, how long the list stays open, Leave.
function signup(app, st, act) {
  const c = st.cup, me = st.me;
  if (!me) return lobby(app, st, act);
  return h('div', { class: 'panel col center wcmsg' },
    h('div', { class: 'wccount' }, h('b', {}, `${c.count}`), h('span', {}, ` / ${c.size} coaches`)),
    h('div', { class: 'wcpips' }, ...Array.from({ length: c.size }, (_, i) => h('i', { class: i < c.count ? 'on' : '' }))),
    h('div', { class: 'wcnames' }, ...c.players.map((p) => h('span', { class: 'chip' + (p.id === me.id ? ' on' : '') }, p.name))),
    h('small', { class: 'muted' }, `Keep this screen open to keep your place. Sign-ups close in ${clock(c.closesIn)} if the cup is not full.`),
    h('button', { class: 'chip', onclick: async () => { await cupLeave(); act(() => cupState(app.version)); } }, 'Leave the list'));
}

// Your current match: check-in, connecting, or where you finished.
function myPanel(app, st, act) {
  const c = st.cup, me = st.me, m = me && me.match;
  if (c.status === 'done') {
    const champ = c.champion;
    return h('div', { class: 'panel col center wcmsg' }, h('img', { class: 'bigcup', src: item(champ && me && champ.id === me.id ? 'items/GoldCup' : 'items/SilverCup'), alt: '' }),
      h('b', { class: 'gold' }, champ ? (me && champ.id === me.id ? 'You won the Weekend Cup!' : `${champ.name} won the cup`) : 'No champion this time'),
      c.reason ? h('small', { class: 'muted' }, c.reason) : null,
      me ? h('small', {}, `Your finish: ${PLACE[me.place] || '-'}`) : null, joinBtn(app, st, act));
  }
  if (!me) return h('div', { class: 'panel center muted' }, 'Spectating this cup.');
  if (m && m.status === 'ready') {
    return h('div', { class: 'panel col center wcmatch' + (m.ready ? '' : ' hot') },
      h('small', { class: 'muted' }, `${ROUND[m.round]}${m.note ? ' · ' + m.note : ''}`),
      h('b', {}, 'You vs ', h('button', { class: 'linkish', onclick: () => showPlayer(app, m.opp.id, { name: m.opp.name }) }, m.opp.name)),
      m.ready ? h('span', { class: 'muted' }, m.oppReady ? 'Both ready. Starting…' : `Ready! Waiting for ${m.opp.name} to check in · ${clock(m.left)}`)
        : h('button', { class: 'btn big', onclick: (e) => { audio.sfx('lockin', 0.7); act(() => cupReady(c.id), e.target); } }, `Ready · ${clock(m.left)}`),
      h('small', { class: 'muted' }, 'A coach who does not check in in time forfeits the match.'));
  }
  if (m && m.status === 'playing') {
    const stuck = connecting && connecting.match === m.match && performance.now() - connecting.at > 40000;
    return h('div', { class: 'panel col center wcmatch' },
      h('small', { class: 'muted' }, ROUND[m.round]), h('b', {}, `You vs ${m.opp.name}`),
      h('span', { class: 'muted' }, m.role === 'host' ? 'Opening the room…' : `Joining ${m.opp.name}’s room…`),
      stuck ? h('button', { class: 'chip', onclick: () => { connecting = null; autoConnect(app, st); } }, 'Retry connection') : null);
  }
  if (me.place === 0) return h('div', { class: 'panel col center wcmatch' }, h('b', { class: 'gold' }, 'You advance!'), h('span', { class: 'muted' }, 'Waiting for your next opponent. Stay on this screen: you will have a few minutes to check in.'));
  return h('div', { class: 'panel col center wcmatch' }, h('b', {}, me.place === -1 ? 'Disqualified after replay review' : `Knocked out: ${PLACE[me.place] || ''}`), h('span', { class: 'muted' }, 'You can follow the rest of the bracket here.'), joinBtn(app, st, act));
}

function bracket(app, st) {
  const c = st.cup, me = st.me, byId = Object.fromEntries(c.players.map((p) => [p.id, p]));
  const team = (pid, m) => {
    if (!pid) return h('div', { class: 'bteam tbd' }, m && m.status === 'void' ? 'no-show' : m ? 'bye' : 'TBD');
    const p = byId[pid] || { name: '?', seed: 0 }, won = m && m.winner === pid, lost = m && m.status !== 'ready' && m.status !== 'playing' && m.winner !== pid;
    const check = m && m.status === 'ready' && m.ready[m.a === pid ? 0 : 1];
    return h('button', { class: 'bteam' + (me && pid === me.id ? ' you' : '') + (won ? ' win' : lost ? ' lose' : ''), title: `View ${p.name}'s profile`, onclick: () => showPlayer(app, pid, { name: p.name }) },
      h('small', {}, `#${p.seed}`), h('span', {}, p.name), check ? h('b', { class: 'wcready', title: 'Checked in' }, '✓') : m && m.status === 'playing' ? h('i', { class: 'wclive', title: 'Playing now' }) : null);
  };
  const cols = [0, 1, 2].map((r) => {
    const ms = Array.from({ length: 4 >> r }, (_, s) => c.matches.find((x) => x.round === r && x.slot === s) || null);
    return h('div', { class: 'bcol' }, h('div', { class: 'bround' }, ROUND[r]), ...ms.map((m) => h('div', { class: 'bmatch' + (m && m.status === 'playing' ? ' live' : '') }, team(m && m.a, m), team(m && m.b, m))));
  });
  const ch = c.champion;
  return h('div', { class: 'bracket wcbracket' }, cols,
    h('div', { class: 'bcol champ' }, h('div', { class: 'bround' }, 'Champion'), h('div', { class: 'bmatch' }, ch ? h('div', { class: 'bteam win' + (me && ch.id === me.id ? ' you' : '') }, h('img', { src: item('items/GoldCup'), alt: '' }), h('span', {}, ch.name)) : h('div', { class: 'bteam tbd' }, h('img', { src: item('items/GoldCup'), alt: '' }), '?'))));
}

// Both coaches checked in: the higher seed hosts the server's room code, the other joins it (retrying while
// the host is still opening it). The session carries the cup match id so both reports name the same match.
function autoConnect(app, st) {
  const m = st.me.match;
  if (app.net || (connecting && connecting.match === m.match)) return;
  connecting = { match: m.match, at: performance.now() };
  if (app.pendingPeer) { try { app.pendingPeer.destroy(); } catch { /* ignore */ } app.pendingPeer = null; }
  const wcup = { id: st.cup.id, match: m.match, round: m.round };
  if (m.role === 'host') { app.hostGame({ code: m.room, quiet: true, queue: 'cup', wcup, mapId: cupMap(m.match), gameMode: 'classic' }); return; }
  let tries = 0;
  const go = () => app.joinScreen(m.room, { quiet: true, queue: 'cup', wcup, onFail: () => { if (connecting && connecting.match === m.match && ++tries < 30 && document.querySelector('.wcup')) setTimeout(go, 3000); } });
  go();
}

async function loadHistory(app, el) {
  try {
    const r = await cupHistory();
    const t = r.trophies, me = getAccount();
    mount(el, h('summary', {}, h('b', {}, 'Trophies & cup history'), h('span', { class: 'muted' }, ` · ${t.wins} won · ${t.finals} finals · ${t.played} played`)),
      h('div', { class: 'wctro' }, h('span', {}, h('img', { src: item('items/GoldCup'), alt: '' }), ` ${t.wins}`), h('span', {}, h('img', { src: item('items/SilverCup'), alt: '' }), ` ${t.finals}`)),
      r.mine.length ? h('div', { class: 'wclist' }, h('small', { class: 'muted' }, 'Your cups'), ...r.mine.map((c) => h('div', { class: 'wcrow' }, h('span', {}, c.ended ? new Date(c.ended).toLocaleDateString() : '-'),
        h('b', {}, c.status === 'void' ? 'Did not start' : PLACE[c.place] || '-'), h('small', { class: 'muted' }, c.status === 'void' ? 'not enough coaches' : c.champion ? `Champion: ${c.champion}` : 'no champion'))))
        : h('p', { class: 'muted small' }, 'No cups played yet.'),
      r.champions.length ? h('div', { class: 'wclist' }, h('small', { class: 'muted' }, 'Latest champions'), ...r.champions.map((c) => h('button', { class: 'wcrow', onclick: () => showPlayer(app, c.player, { name: c.name }) },
        h('span', {}, new Date(c.ended).toLocaleDateString()), h('b', { class: me && c.player === me.id ? 'gold' : '' }, c.name)))) : null);
  } catch { mount(el, h('summary', {}, h('b', {}, 'Trophies & cup history')), h('p', { class: 'muted small' }, 'History unavailable right now.')); }
}

// Season Cup (vs AI, src/cup.js) and Weekend Cup (online) share the Cup tile: a two-way switch on both screens.
export function cupTabs(app, on) {
  const tab = (k, label, go) => h('button', { class: 'chip' + (on === k ? ' on' : ''), 'aria-pressed': String(on === k), onclick: () => { if (on !== k) { audio.sfx('move', 0.5); go(); } } }, label);
  return h('div', { class: 'cuptabs' }, tab('season', 'Season Cup · vs AI', () => import('./home.js').then((m) => m.showCup(app))), tab('weekend', 'Weekend Cup · online', () => showWeekendCup(app)));
}
