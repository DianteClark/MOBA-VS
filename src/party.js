// Parties: two coaches who stay together between matches (2v2 co-op as a base mode).
//
// A party is a small peer link of its own, apart from any match connection: the leader registers a party
// code (the same kind of 5-letter code as a room) and the partner connects to it, by an invite card, an invite
// link (/i/ID, mode 'party'), or by typing the code into Join (the leader answers a plain 'hello' with 'party'
// and the joiner hands that link over to its party). Nothing about a party is stored on the server: presence
// and invites reuse the social heartbeat and invites, so a party costs the Worker nothing while it idles.
//
// The leader owns the state and sends it whole ('pstate'): members (name, rank, looks, ready, busy, lost),
// the chosen mode and AI level. From a party the leader launches:
//   coop   Co-op vs AI: the leader hosts an auto-starting co-op room (src/coop-room.js) that keeps the blue
//          seat for the partner (expected by the party token) and starts once they are in;
//   mm2    Find Match 2v2 together: one ticket for both in the Worker's 2v2 queue (worker/duo.js); the search
//          screen is mirrored to the partner ('pq'), and on a match both join the room the server named;
//   room2  a private 2v2 room: the partner sits on blue with the leader, the other pair joins by code or link.
// The partner follows each launch ('pgo') unless they are busy in a match of their own. After a match the
// results offer Play again (leader) / Back to party (partner); Home shows the party panel again.
// A partner whose link drops comes back by itself (same token, so the same place in the party); a leader
// leaving disbands the party. Quick chat is a few preset lines, rate-limited on both ends.
import { hostRoom, join, makeCode } from './net/peer.js';
import { getAccount, ensureAccount, ping, findDuo as findDuoApi, cancelDuo, createInvite, cancelInvites } from './net/online.js';
import { myLooks, cleanLooks } from './looks.js';
import { profile } from './profile.js';
import { toast } from './ui/dom.js';
import { showSearch } from './ui/online.js';
import { audio } from './audio.js';

export const PARTY_LINES = ['Ready?', 'Let\'s go!', 'One more?', 'GG', 'Brb', 'Thanks!'];
export const PARTY_MODES = { coop: 'Co-op vs AI', mm2: 'Find Match 2v2', room2: 'Private 2v2' };
const MAX = 2, PING_MS = 15000, SILENT_MS = 70000, LOST_MS = 45000, CHAT_GAP = 1200;
const tok = () => Math.random().toString(36).slice(2, 12).padEnd(8, '0');
const clean = (s, n = 12) => String(s || 'Coach').slice(0, n);

let P = null;
let appRef = null;
const subs = new Set();
export const party = () => P;
export function onParty(fn) { subs.add(fn); return () => subs.delete(fn); }
function changed() { for (const fn of [...subs]) { try { fn(P); } catch (e) { console.error(e); } } }

// ───────────── 1v1 / 2v2 toggle (Home → Find Match) ─────────────
let size = '1v1';
try { size = localStorage.getItem('mobavs_qsize') === '2v2' ? '2v2' : '1v1'; } catch { /* ignore */ }
export const queueSize = () => size;
export function setQueueSize(v) { size = v === '2v2' ? '2v2' : '1v1'; try { localStorage.setItem('mobavs_qsize', size); } catch { /* ignore */ } }

// ───────────── who is free ─────────────
// Busy: in a draft, prep or match of your own (results, and a replay opened from them, count as free).
export function busy(app) {
  if (!app) return false;
  const fromResults = app.replayFromResults && app.replayFromResults();
  return !!((app.match && !fromResults) || (app.session && !app.session.finished && !fromResults));
}
const me = () => (P ? P.members.find((x) => x.self) : null);
export const mate = () => (P ? P.members.find((x) => !x.self) || null : null);
function selfEntry(app, leader, id) {
  return { id, self: true, leader, name: app.name, pid: getAccount() ? getAccount().id : null, elo: profile.elo, looks: myLooks(), ready: leader, busy: busy(app), lost: false };
}
const pub = (m) => ({ id: m.id, leader: !!m.leader, name: m.name, pid: m.pid, elo: m.elo, looks: m.looks, ready: !!m.ready, busy: !!m.busy, lost: !!m.lost });

// ───────────── links ─────────────
function sendTo(m, msg) { if (m && m.link) m.link.send(msg); }
function toAll(msg) {
  if (!P) return;
  if (P.leader) { for (const m of P.members) if (!m.self) sendTo(m, msg); } else if (P.link) P.link.send(msg);
}
// Leader: the whole state to the partner.
function sync() {
  if (!P) return;
  if (P.leader) for (const m of P.members) if (!m.self && m.link) m.link.send({ t: 'pstate', code: P.code, mode: P.mode, ai: P.ai, want: !!P.want, members: P.members.map(pub), you: m.id });
  changed();
}
// Stop listening on a link we no longer use (its handlers may belong to the app's match code).
function detach(t) { if (!t) return; t.handlers = []; t.closeHandlers = []; }

// ───────────── leader ─────────────
export async function createParty(app) {
  appRef = app;
  if (P) return P;
  const code = makeCode();
  P = { code, leader: true, mode: 'coop', ai: app.aiLevel ?? 1, want: false, members: [selfEntry(app, true, tok())], status: 'Opening…', up: false, chat: [], last: null };
  const p = P;
  installLoop(app);
  changed();
  try {
    const { peer } = await hostRoom(code, { onStatus: () => {}, onGuest: (t) => onGuest(app, p, t) });
    if (P !== p) { try { peer.destroy(); } catch { /* ignore */ } return null; }
    p.peer = peer; p.up = true; p.status = '';
  } catch (e) {
    if (P !== p) return null;
    toast('Could not open the party: ' + (e.message || e.type || e), 3500);
    P = null;
  }
  changed();
  return P;
}
function onGuest(app, p, t) {
  let id = null, lastSeen = Date.now();
  t.onMessage((m) => {
    if (P !== p || !m || typeof m !== 'object') return;
    lastSeen = Date.now();
    if (!id) {
      if (m.t !== 'phello' && m.t !== 'hello') return;
      const plain = m.t === 'hello'; // someone typed the party code into Join
      if (m.v !== app.version) { t.send({ t: plain ? 'closed' : 'pclosed', why: 'Version mismatch: both coaches should refresh.' }); setTimeout(() => t.close(), 200); return; }
      const key = typeof m.tok === 'string' && /^[a-z0-9]{8,12}$/.test(m.tok) ? m.tok : tok();
      const old = p.members.find((x) => x.id === key && !x.self);
      if (!old && p.members.length >= MAX) { t.send({ t: plain ? 'closed' : 'pclosed', why: 'That party is full.' }); setTimeout(() => t.close(), 200); return; }
      id = key;
      const info = { name: clean(m.name), pid: typeof m.pid === 'string' ? m.pid.slice(0, 10) : null, elo: Math.max(0, Math.min(5000, m.elo | 0)) || 1000, looks: cleanLooks(m.looks) };
      if (old) { if (old.link && old.link !== t) { detach(old.link); try { old.link.close(); } catch { /* ignore */ } } Object.assign(old, info, { link: t, lost: false, busy: false }); clearTimeout(old.lostTimer); toast(`${old.name} is back`, 1800); }
      else { p.members.push({ id, self: false, leader: false, ...info, ready: false, busy: false, lost: false, link: t }); audio.sfx('accept', 0.6); toast(`${info.name} joined the party`, 2200); }
      if (plain) t.send({ t: 'party', code: p.code, tok: id });
      sync();
      return;
    }
    onMember(app, p, id, m);
  });
  t.onClose(() => {
    if (P !== p) return;
    const mem = p.members.find((x) => x.id === id && x.link === t); if (!mem) return;
    mem.link = null;
    if (mem.left) { removeMember(p, mem, `${mem.name} left the party`); return; }
    mem.lost = true; mem.ready = false; P.want = false;
    toast(`${mem.name} lost connection: waiting for them…`, 2500);
    mem.lostTimer = setTimeout(() => { if (P === p && mem.lost) removeMember(p, mem, `${mem.name} dropped out of the party`); }, LOST_MS);
    sync();
  });
  // a silent link (a tab closed without saying goodbye) counts as closed
  const iv = setInterval(() => { if (P !== p || !t.open) { clearInterval(iv); return; } if (Date.now() - lastSeen > SILENT_MS) { clearInterval(iv); try { t.close(); } catch { /* ignore */ } for (const h of t.closeHandlers || []) h(); } }, 5000);
}
function removeMember(p, mem, why) {
  clearTimeout(mem.lostTimer);
  p.members = p.members.filter((x) => x !== mem); p.want = false;
  if (why) toast(why, 2500);
  sync();
}
function onMember(app, p, id, m) {
  const mem = p.members.find((x) => x.id === id); if (!mem) return;
  switch (m.t) {
    case 'pready': mem.ready = !!m.on && !mem.busy; sync(); if (mem.ready && p.want) partyStart(app, p.mode); return;
    case 'pst': mem.busy = !!m.busy; if (mem.busy) mem.ready = false; sync(); return;
    case 'pchat': gotChat(mem, m); return;
    case 'pleave': mem.left = true; detach(mem.link); try { mem.link.close(); } catch { /* ignore */ } removeMember(p, mem, `${mem.name} left the party`); return;
    case 'pbusy': toast(`${mem.name} is in a match right now`, 2500); if (app.duo) app.duo.cancel(`${mem.name} is busy`); return;
    case 'pqcancel': if (app.duo) app.duo.cancel(`${mem.name} cancelled the search`); return;
    case 'pping': return;
  }
}

// ───────────── partner ─────────────
// Join a party by its code (an invite card / link), or adopt a link that a plain Join opened (transport + tok).
export async function joinParty(app, code, opts = {}) {
  appRef = app;
  if (P && P.code === code) return;
  if (P) leaveParty(app, true);
  const p = P = { code, leader: false, tok: opts.tok || tok(), mode: 'coop', ai: 1, want: false, members: [selfEntry(app, false, opts.tok || '')], status: 'Joining the party…', chat: [], tries: 0 };
  p.members[0].id = p.tok;
  installLoop(app);
  changed();
  if (opts.transport) { attach(app, p, opts.transport, opts.peer); p.status = ''; changed(); return; }
  await connect(app, p);
}
async function connect(app, p) {
  try {
    const { peer, transport } = await join(p.code, null, () => {});
    if (P !== p) { try { transport.close(); } catch { /* ignore */ } try { peer.destroy(); } catch { /* ignore */ } return; }
    attach(app, p, transport, peer);
    transport.send({ t: 'phello', v: app.version, name: app.name, pid: getAccount() ? getAccount().id : null, elo: profile.elo, looks: myLooks(), tok: p.tok });
    p.status = ''; p.tries = 0;
  } catch (e) {
    if (P !== p) return;
    if (p.everIn && ++p.tries < 5) { p.status = 'Reconnecting to the party…'; changed(); setTimeout(() => { if (P === p) connect(app, p); }, 4000); return; }
    toast(p.everIn ? 'Lost the party.' : 'Could not reach that party: ' + (e.message || e.type || e), 3000);
    P = null;
  }
  changed();
}
function attach(app, p, t, peer) {
  detach(t);
  p.link = t; p.peer = peer || null; p.lastSeen = Date.now();
  t.onMessage((m) => { if (P === p && m && typeof m === 'object') { p.lastSeen = Date.now(); onLeader(app, p, m); } });
  t.onClose(() => {
    if (P !== p || p.link !== t) return;
    p.link = null;
    try { p.peer && p.peer.destroy(); } catch { /* ignore */ }
    if (p.gone) return;
    p.status = 'Reconnecting to the party…'; changed();
    setTimeout(() => { if (P === p && !p.link) connect(app, p); }, 1500);
  });
}
function onLeader(app, p, m) {
  switch (m.t) {
    case 'pstate': {
      if (!Array.isArray(m.members)) return;
      const first = !p.everIn; p.everIn = true;
      p.code = String(m.code || p.code).slice(0, 5); p.mode = PARTY_MODES[m.mode] ? m.mode : 'coop'; p.ai = Math.max(0, Math.min(2, m.ai | 0)); p.want = !!m.want;
      p.members = m.members.slice(0, MAX).map((x) => ({ id: String(x.id || ''), self: x.id === p.tok, leader: !!x.leader, name: clean(x.name), pid: typeof x.pid === 'string' ? x.pid : null,
        elo: x.elo | 0 || 1000, looks: cleanLooks(x.looks), ready: !!x.ready, busy: !!x.busy, lost: !!x.lost }));
      if (first) { audio.sfx('accept', 0.6); const l = p.members.find((x) => x.leader); toast(`You joined ${l ? l.name + '\'s' : 'the'} party`, 2200); }
      changed();
      return;
    }
    case 'pchat': { const l = p.members.find((x) => x.leader); if (l) gotChat(l, m); return; }
    case 'pgo': follow(app, p, m); return;
    case 'pq': if (!busy(app) || app.duoView) showDuoMirror(app, m); return;
    case 'pqend': if (app.duoView) { app.duoView = null; if (m.why) toast(m.why, 3000); app.menu(); } return;
    case 'pdisband': case 'pclosed': p.gone = true; P = null; toast(m.why || 'The party leader disbanded the party.', 3000); changed(); return;
    case 'pping': if (p.link) p.link.send({ t: 'pping' }); return;
  }
}
// The leader launched something: join it (unless a match of our own is running).
function follow(app, p, m) {
  if (busy(app)) { if (p.link) p.link.send({ t: 'pbusy' }); return; }
  const code = String(m.code || ''); if (!/^[A-Z]{5}$/.test(code)) return;
  app.duoView = null;
  if (app.session || app.match) app.menu();
  const ui = partyUi(); if (ui) ui.wait(app, m.kind === 'mm2' ? 'Match found! Joining the room…' : 'Joining your party\'s room…');
  const id = app.lobbyId = (app.lobbyId || 0) + 1;
  let tries = 0;
  const attempt = () => {
    if (app.lobbyId !== id || app.session) return;
    app.joinScreen(code, { quiet: true, checked: true, lobbyId: id, hello: m.kind === 'mm2' ? {} : { key: p.tok }, onFail: () => { if (++tries < 6 && app.lobbyId === id) setTimeout(attempt, 1500); else if (app.lobbyId === id) { toast('Could not reach the room.', 3000); app.menu(); } } });
  };
  attempt();
}

// ───────────── both ─────────────
export function setReady(on) {
  const m = me(); if (!P || P.leader || !m) return;
  m.ready = !!on; audio.sfx(on ? 'accept' : 'move', 0.5);
  if (P.link) P.link.send({ t: 'pready', on: !!on });
  changed();
}
export function setMode(mode, ai) {
  if (!P || !P.leader || !PARTY_MODES[mode]) return;
  if (P.mode !== mode) P.want = false;
  P.mode = mode; if (ai !== undefined) P.ai = ai;
  sync();
}
export function stopWaiting() { if (P && P.leader && P.want) { P.want = false; sync(); } }
const chatGate = { out: 0 };
export function sendChat(i) {
  if (!P || !Number.isInteger(i) || i < 0 || i >= PARTY_LINES.length) return;
  const now = Date.now(); if (now - chatGate.out < CHAT_GAP) return; chatGate.out = now;
  toAll({ t: 'pchat', i });
  const m = me(); if (m) { m.said = { i, t: now }; changed(); }
}
function gotChat(mem, m) {
  if (!Number.isInteger(m.i) || m.i < 0 || m.i >= PARTY_LINES.length) return;
  const now = Date.now(); if (mem.heard && now - mem.heard < CHAT_GAP * 0.6) return; mem.heard = now; // their rate limit, checked here too
  mem.said = { i: m.i, t: now };
  audio.sfx('move', 0.5);
  if (!document.querySelector('.ppanel')) toast(`${mem.name}: ${PARTY_LINES[m.i]}`, 2200);
  changed();
}
// Leave (partner) or disband (leader). quiet: no toast (joining another party).
export function leaveParty(app, quiet = false) {
  const p = P; if (!p) return;
  P = null;
  if (app && app.duo) app.duo.cancel(null);
  if (p.leader) {
    for (const m of p.members) if (!m.self) { clearTimeout(m.lostTimer); if (m.link) { m.link.send({ t: 'pdisband', why: `${p.members[0].name} disbanded the party.` }); const l = m.link; detach(l); setTimeout(() => l.close(), 150); } }
    cancelInvites(p.code);
    setTimeout(() => { try { p.peer && p.peer.destroy(); } catch { /* ignore */ } }, 300);
  } else {
    p.gone = true;
    if (p.link) { p.link.send({ t: 'pleave' }); const l = p.link; detach(l); setTimeout(() => { l.close(); try { p.peer && p.peer.destroy(); } catch { /* ignore */ } }, 150); }
  }
  if (!quiet) toast(p.leader ? 'Party disbanded' : 'You left the party', 1800);
  changed();
}

// Busy state, keep-alive and the partner's silent-link check: one light local loop (no network unless something changed).
let loopOn = false;
function installLoop(app) {
  if (loopOn) return; loopOn = true;
  let lastPing = 0;
  setInterval(() => {
    if (!P) return;
    const b = busy(app), m = me();
    if (m && m.busy !== b) {
      m.busy = b; if (b && !P.leader) m.ready = false;
      if (P.leader) { if (b) P.want = false; sync(); } else { if (P.link) P.link.send({ t: 'pst', busy: b }); changed(); }
    }
    const now = Date.now();
    if (now - lastPing > PING_MS) { lastPing = now; toAll({ t: 'pping' }); }
    if (!P.leader && P.link && now - (P.lastSeen || now) > SILENT_MS) { const l = P.link; try { l.close(); } catch { /* ignore */ } for (const h of l.closeHandlers || []) h(); }
  }, 1500);
  window.addEventListener('pagehide', () => { if (P) leaveParty(app, true); });
}

// ───────────── launching (leader) ─────────────
// opts.again: Play again from the results (no ready check: both just played together).
export function partyStart(app, mode = P && P.mode, opts = {}) {
  if (!P || !P.leader) return false;
  if (!PARTY_MODES[mode]) mode = 'coop';
  const m = mate();
  if (mode === 'coop' && !m) { toast('Co-op vs AI needs a partner: invite a friend first.', 2600); return false; }
  if (m && (m.lost || m.busy)) { toast(m.lost ? `${m.name} is reconnecting…` : `${m.name} is in a match right now`, 2500); return false; }
  if (P.mode !== mode) { P.mode = mode; }
  if (m && !m.ready && !opts.again) { P.want = true; sync(); toast(`Waiting for ${m.name} to tap Ready`, 2000); return false; }
  P.want = false; P.last = mode; P.ai = app.aiLevel ?? P.ai;
  if (m) m.ready = false;
  sync();
  audio.sfx('accept', 0.6);
  if (mode === 'mm2') { findDuo(app, true); return true; }
  const code = makeCode();
  if (mode === 'coop') app.hostCoop({ code, kind: 'ai', auto: true, expect: { [m.id]: 0 } });
  else app.hostCoop({ code, kind: '2v2', expect: m ? { [m.id]: 0 } : null });
  if (m) sendTo(m, { t: 'pgo', kind: mode, code });
  return true;
}
// After a party match: the results' button (null outside a party).
export function partyAgain(app) {
  if (!P) return null;
  if (!P.leader) return { label: 'Back to party', fn: () => app.menu() };
  const mode = P.last || P.mode;
  return { label: mode === 'mm2' ? 'Find another 2v2' : 'Play again', fn: () => { app.menu(); partyStart(app, mode, { again: true }); } };
}

// ───────────── Find Match 2v2 ─────────────
// Solo or as a party: real players only, 60 s at most (then "no one online" and back to the menu).
// The partner mirrors the search screen; either coach can cancel it for both.
export async function findDuo(app, fromParty = false) {
  if (P && !P.leader) { toast('Your party leader starts the search.', 2200); return; }
  const m = P ? mate() : null;
  if (m && !fromParty) { partyStart(app, 'mm2'); return; }
  if (m && !m.pid) { toast(`${m.name} is not signed in to online play yet: try again in a moment.`, 3000); return; }
  app.immersive();
  const id = app.lobbyId = (app.lobbyId || 0) + 1;
  const live = () => app.lobbyId === id && !app.net;
  const t0 = performance.now(), LIMIT = 60000;
  let ticket = null, over = false;
  const tell = (msg) => { if (m) sendTo(mate(), msg); };
  const stop = (why) => { if (over) return; over = true; app.duo = null; if (ticket) cancelDuo(ticket); tell({ t: 'pqend', why }); if (why) toast(why, 3000); if (app.lobbyId === id) app.menu(); };
  app.duo = { cancel: (why) => stop(why) };
  const ui = (status) => { if (!live()) return; showSearch(app, { elapsed: performance.now() - t0, limit: LIMIT, status, queue: 'coop2v2', onCancel: () => stop(null) }); tell({ t: 'pq', status, el: Math.round(performance.now() - t0) }); };
  ui(m ? `Searching with ${m.name}…` : 'Connecting to the matchmaker…');
  if (!(await ping())) { if (live()) stop('Online play is unavailable right now.'); return; }
  try { await ensureAccount(app.name); } catch { if (live()) stop('Could not reach the matchmaker.'); return; }
  const tick = setInterval(() => { if (live() && !over) ui(m ? `Searching with ${m.name}…` : 'Searching for three coaches…'); else clearInterval(tick); }, 1000);
  try {
    while (live() && !over) {
      if (performance.now() - t0 > LIMIT) { stop('No one is online for 2v2 right now. Try again soon!'); return; }
      const r = await findDuoApi({ version: app.version, ticket, party: m && m.pid ? [m.pid] : [] });
      if (!live() || over) return;
      if (r.status === 'waiting') ticket = r.ticket;
      else if (r.status === 'expired') ticket = null;
      else if (r.status === 'matched') {
        over = true; app.duo = null; clearInterval(tick);
        ui('Match found! Connecting…');
        const teams = r.teams && typeof r.teams === 'object' ? r.teams : {};
        if (r.role === 'host') app.hostCoop({ code: r.code, kind: '2v2', auto: true, mm: true, expect: teams });
        else joinRetry(app, r.code, id);
        if (m) tell({ t: 'pgo', kind: 'mm2', code: r.code });
        return;
      }
      await new Promise((res) => setTimeout(res, 3000));
    }
  } catch (e) { if (live() && !over) stop('Matchmaking failed: ' + (e.message || e)); }
  finally { clearInterval(tick); }
}
// The room may take a moment to open on the host's side: try again a few times.
function joinRetry(app, code, id) {
  let tries = 0;
  const attempt = () => { if (app.lobbyId !== id || app.session) return; app.joinScreen(code, { quiet: true, checked: true, lobbyId: id, onFail: () => { if (++tries < 6 && app.lobbyId === id) setTimeout(attempt, 1500); else if (app.lobbyId === id) { toast('Could not reach the match room.', 3000); app.menu(); } } }); };
  attempt();
}
// Partner: the leader's search screen, mirrored. Cancel stops it for both.
function showDuoMirror(app, m) {
  if (app.session || app.match) return;
  app.duoView = true;
  showSearch(app, { elapsed: Math.max(0, m.el | 0), limit: 60000, status: String(m.status || 'Searching…').slice(0, 60), queue: 'coop2v2', onCancel: () => { app.duoView = null; if (P && P.link) P.link.send({ t: 'pqcancel' }); app.menu(); } });
}

// ───────────── invites ─────────────
// A friend (to = { id, name }) or a shareable link (to = null): the invite's room is the party code.
export async function inviteToParty(app, to = null) {
  if (P && !P.leader) throw new Error('Only the party leader can invite.');
  if (P && to && mate()) throw new Error('Your party is full (two coaches).');
  const p = P || await createParty(app);
  if (!p) throw new Error('Could not open the party.');
  if (!getAccount()) await ensureAccount(app.name);
  return createInvite(p.code, 'party', to ? to.id : null);
}
// A plain Join reached a party: hand that link to the party (main.onNet, session 'join').
export function adoptJoinLink(app, m) {
  const net = app.net; if (!net) return;
  app.net = null; app.session = null;
  const code = String(m.code || '');
  joinParty(app, code, { transport: net.t, peer: net.peer, tok: typeof m.tok === 'string' ? m.tok : tok() });
  app.menu();
}

// The UI module registers itself here (src/ui/party.js), so this file never imports the screens.
let uiMod = null;
export function setPartyUi(m) { uiMod = m; }
const partyUi = () => uiMod;
