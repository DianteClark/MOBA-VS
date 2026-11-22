// Co-op rooms: two human coaches share a team, vs the AI or vs another pair (2v2, four peers).
//
// Topology: the host's PeerJS peer is the hub (net/peer.js Hub); guests connect with the normal Join code
// or an invite link and learn it is a co-op room from the host's first 'room' message.
//   lobby   host-authoritative 'room' state: kind (ai | 2v2), AI level, players (slot, team, seat), role splits
//   draft   'draft' { team, seat, hero, turn }: bans alternate between a team's coaches (lead first), picks
//           alternate until each coach has filled their own roles (sim/coop.js draftActor / coopLegal)
//   prep    'prep'  { team, seat, prep }: each coach sends builds for their heroes, the lead also the plan
//           and deck; every peer merges a team's preps the same way once all of its coaches are ready
//   match   lockstep with one slot per peer; commands carry the coach's seat; a peer that drops mid-match
//           is cut at a host-chosen tick with a 'leave' command (sim/coop.js hands its heroes over)
// Leaving before the match starts closes the room for everyone (back to the menu with a note).
import { Rng } from './sim/rng.js';
import { ROLES, ROLE_LABEL } from './data/heroes.js';
import { currentTurn, apply as draftApply, autoChoice, aiPrep, legal } from './sim/draft.js';
import { DEFAULT_OWN, cleanOwn, draftActor, coopApply, coopLegal, coopAutoChoice, coopRoles, seatRoles } from './sim/coop.js';
import { prepFromPreset } from './presets.js';
import { hostRoom, Hub, makeCode } from './net/peer.js';
import { getAccount } from './net/online.js';
import { toast } from './ui/dom.js';
import { myLooks, cleanLooks } from './looks.js';
import { audio } from './audio.js';
import { showCoopLobby } from './ui/coop.js';
import { EVENT_BY_ID } from './data/events.js';

export const COOP_COL = ['#ffd84a', '#6fe3c8']; // seat colours: seat A gold, seat B mint (the same on every screen)
const DIFF = ['Easy', 'Normal', 'Hard'];
export const maxPlayers = (kind) => (kind === '2v2' ? 4 : 2);

// ───────────── lobby (host) ─────────────
export async function hostCoop(app, opts = {}) {
  app.immersive();
  const code = opts.code || makeCode();
  const id = app.lobbyId = (app.lobbyId || 0) + 1;
  const live = () => app.lobbyId === id;
  const hub = new Hub();
  const room = { code, kind: opts.kind === '2v2' ? '2v2' : 'ai', aiLevel: app.aiLevel ?? 1, own: [{ ...DEFAULT_OWN }, { ...DEFAULT_OWN }],
    players: [{ slot: 0, name: app.name, pid: getAccount() && getAccount().id, team: 0, seat: 0, looks: myLooks() }], status: 'Opening room…', invite: opts.invite || null };
  app.session = { mode: 'coop', lobby: true, host: true, slot: 0, room };
  app.net = { peer: { destroy() {} }, t: hub, hub };
  hub.onMessage((m) => app.onNet(m));
  hub.onLeave((slot) => onLeave(app, slot));
  showCoopLobby(app);
  try {
    const { peer } = await hostRoom(code, { onStatus: () => {}, onPeer: (p) => { app.pendingPeer = p; }, onGuest: (t) => {
      if (!live() || !app.session || !app.session.lobby) { t.send({ t: 'closed', why: 'The room has already started.' }); setTimeout(() => t.close(), 200); return; }
      const slot = [1, 2, 3].find((k) => !hub.has(k));
      if (!slot) { t.send({ t: 'closed', why: 'That co-op room is full.' }); setTimeout(() => t.close(), 200); return; }
      hub.add(slot, t); // seated once its 'hello' arrives
    } });
    if (!live()) { try { peer.destroy(); } catch { /* ignore */ } hub.close(); return; }
    app.pendingPeer = null; app.net.peer = peer;
    room.status = 'Room open: share the code or invite a friend.';
  } catch (e) {
    if (!live()) return;
    room.status = 'Could not open the room: ' + (e.message || e.type || e);
  }
  showCoopLobby(app);
}
// Free seats in order: blue A, blue B, then red A, red B (2v2 only).
function freeSeat(room, prefer) {
  const seats = [[0, 0], [0, 1], ...(room.kind === '2v2' ? [[1, 0], [1, 1]] : [])];
  const free = seats.filter(([t, s]) => !room.players.some((p) => p.team === t && p.seat === s));
  return (prefer && free.find(([t, s]) => t === prefer[0] && s === prefer[1])) || free[0] || null;
}
function broadcast(app) {
  const s = app.session, room = s.room;
  if (s.host) for (const p of room.players) if (p.slot) app.net.hub.sendTo(p.slot, { t: 'room', room: publicRoom(room), you: p.slot, v: app.version });
  showCoopLobby(app);
}
// Everything a guest receives about the room is re-validated (names, seats, looks).
function cleanRoom(r) {
  const players = (Array.isArray(r && r.players) ? r.players : []).slice(0, 4).map((p) => ({ slot: p.slot | 0, name: String(p.name || 'Coach').slice(0, 12), pid: typeof p.pid === 'string' ? p.pid : null,
    team: p.team === 1 ? 1 : 0, seat: p.seat === 1 ? 1 : 0, looks: cleanLooks(p.looks) }));
  return { code: String(r.code || ''), kind: r.kind === '2v2' ? '2v2' : 'ai', aiLevel: Math.max(0, Math.min(2, r.aiLevel | 0)), own: [0, 1].map((t) => cleanOwn(r.own && r.own[t])), players, status: String(r.status || '') };
}
const publicRoom = (r) => ({ code: r.code, kind: r.kind, aiLevel: r.aiLevel, own: r.own, players: r.players, status: r.status });
// Host-side lobby actions (a guest's taps arrive as messages and land here too).
function roomAction(app, slot, a) {
  const s = app.session, room = s && s.room; if (!s || !s.host || !s.lobby) return;
  const me = room.players.find((p) => p.slot === slot); if (!me) return;
  if (a.t === 'seat') {
    const t = a.team === 1 ? 1 : 0, seat = a.seat === 1 ? 1 : 0;
    if (t === 1 && room.kind !== '2v2') return;
    if (room.players.some((p) => p.team === t && p.seat === seat)) return;
    me.team = t; me.seat = seat;
  } else if (a.t === 'own') {
    const t = a.team === 1 ? 1 : 0;
    if (!ROLES.includes(a.role) || me.team !== t) return;
    const own = { ...room.own[t] }; own[a.role] = own[a.role] ? 0 : 1;
    room.own[t] = cleanOwn(own);
  } else if (a.t === 'kind' && slot === 0) {
    const kind = a.kind === '2v2' ? '2v2' : 'ai';
    if (kind === 'ai' && room.players.length > 2) { toast('Two coaches at most against the AI'); return; }
    room.kind = kind;
    for (const p of room.players) if (p.team === 1 && kind === 'ai') { const f = freeSeat(room); if (f) { p.team = f[0]; p.seat = f[1]; } }
  } else if (a.t === 'ai' && slot === 0) room.aiLevel = Math.max(0, Math.min(2, a.level | 0));
  broadcast(app);
}
// Who may start: vs AI needs both coaches on blue; 2v2 needs a coach on each side.
export function canStart(room) {
  const n = (t) => room.players.filter((p) => p.team === t).length;
  return room.kind === '2v2' ? n(0) >= 1 && n(1) >= 1 : n(0) === 2;
}
function onLeave(app, slot) {
  const s = app.session; if (!s || s.mode !== 'coop') return;
  const p = (s.lobby ? s.room.players : s.players || []).find((x) => x.slot === slot);
  if (s.lobby) { if (p) { s.room.players = s.room.players.filter((x) => x !== p); toast(`${p.name} left the room`); } broadcast(app); return; }
  if (s.finished || !p) return; // (a link that never got a seat does not matter once the match is set)
  if (app.match && !app.match.game.over) {
    // mid-match: cut that peer's input stream and hand its heroes over (to the partner or the AI coach)
    if (app.match.runner.hostDrop) app.match.runner.hostDrop(slot, [{ type: 'leave', sys: 1, team: p.team, seat: p.seat, seq: 0 }]);
    return;
  }
  if (!app.match) closeRoom(app, `${p.name} left before the match: the co-op room closed.`);
}
function closeRoom(app, why) {
  if (app.net && app.session && app.session.host) app.net.hub.send({ t: 'closed', why });
  toast(why, 3500);
  app.menu();
}
export function startRoom(app) {
  const s = app.session, room = s.room;
  if (!s.host || !canStart(room)) return;
  const seed = (Math.random() * 2 ** 31) >>> 0;
  // Mirror Match has no draft (one shared lineup per side), so co-op seats have nothing to split: co-op plays Classic that week.
  const coopEvent = (e) => (e && EVENT_BY_ID[e] && EVENT_BY_ID[e].mirror ? null : e);
  const start = { t: 'start', coop: 1, seed, map: app.pickMap(seed, 'classic'), ev: coopEvent(app.eventFor('classic', 'private')), room: publicRoom(room) }; // weekly event: the host's choice, like a private room
  const hub = app.net.hub;
  for (const p of room.players) if (p.slot) hub.sendTo(p.slot, start);
  // a link still connecting (no hello yet) is turned away rather than pulled into a match it never joined
  for (const k of [1, 2, 3]) if (hub.has(k) && !room.players.some((p) => p.slot === k)) { hub.sendTo(k, { t: 'closed', why: 'The room has already started.' }); setTimeout(() => hub.kick(k), 200); }
  beginMatchFlow(app, start, 0);
}

// ───────────── guests ─────────────
// First 'room' message on a plain Join: this is a co-op room.
export function enterAsGuest(app, m) {
  if (m.v !== app.version) { toast('Version mismatch: both players should refresh.'); app.menu(); return; }
  app.session = { mode: 'coop', lobby: true, host: false, slot: m.you, room: cleanRoom(m.room) };
  audio.sfx('accept', 0.5);
  showCoopLobby(app);
}
// Lobby taps: the host applies its own, guests ask the host.
export function lobbyAct(app, a) {
  const s = app.session; if (!s || !s.lobby) return;
  audio.sfx('move', 0.4);
  if (s.host) roomAction(app, 0, a); else app.net.t.send({ ...a, p: s.slot });
}

// ───────────── network (every co-op message) ─────────────
export function onCoopNet(app, m) {
  const s = app.session;
  switch (m.t) {
    case 'hello': {
      if (!s.host || !s.lobby) return;
      if (m.v !== app.version) { app.net.hub.sendTo(m.p, { t: 'closed', why: 'Version mismatch: refresh the game.' }); setTimeout(() => app.net.hub.kick(m.p), 200); return; }
      const f = freeSeat(s.room); if (!f || s.room.players.some((p) => p.slot === m.p)) return;
      s.room.players.push({ slot: m.p, name: String(m.name || 'Coach').slice(0, 12), pid: m.pid || null, team: f[0], seat: f[1], looks: cleanLooks(m.looks) });
      audio.sfx('accept', 0.5);
      broadcast(app);
      return;
    }
    case 'seat': case 'own': case 'kind': case 'ai': if (s.host) roomAction(app, m.p, m); return;
    case 'room': if (!s.host && s.lobby) { s.room = cleanRoom(m.room); s.slot = m.you; showCoopLobby(app); } return;
    case 'start': if (!s.host && s.lobby) beginMatchFlow(app, m, s.slot); return;
    case 'closed': if (!s.host) { app.cleanupNet(); toast(m.why || 'The co-op room closed.', 3500); app.menu(); } return;
    case 'draft': {
      if (!s.draft || s.draft.turn !== m.turn) return;
      if (applyDraft(s, m.team, m.seat === 1 ? 1 : 0, m.hero)) app.afterDraftAct();
      return;
    }
    case 'prep': if (s.coop) gotPrep(app, m.team === 1 ? 1 : 0, m.seat === 1 ? 1 : 0, m.prep); return;
    case 'in': case 'h': case 'ht': case 'drop': if (app.match && app.match.runner.receive) app.match.runner.receive(m); return;
    case 'qc': if (app.match && app.match.hud.chat) app.match.hud.chat.receive(m); return;
    case 'sug': if (app.match && app.match.hud.coopSuggest && m.team === s.myTeam) app.match.hud.coopSuggest(m); return;
    case 'quit': {
      const p = s.players && s.players.find((x) => x.slot === m.p);
      if (p && app.match && !s.finished) toast(`${p.name} left the match.`, 2500);
      return;
    }
  }
}

// ───────────── session ─────────────
// From the start message: teams, seats, names; then the shared draft.
function beginMatchFlow(app, start, mySlot) {
  const room = mySlot ? cleanRoom(start.room) : start.room, me = room.players.find((p) => p.slot === mySlot);
  const s = app.session = {
    mode: 'coop', host: mySlot === 0, slot: mySlot, kind: room.kind, gameMode: 'classic', seed: start.seed, mapId: start.map, event: EVENT_BY_ID[start.ev] && !EVENT_BY_ID[start.ev].mirror ? start.ev : null,
    myTeam: me.team, mySeat: me.seat, aiLevel: room.aiLevel, rng: new Rng(start.seed), players: room.players.slice(),
    slots: Math.max(...room.players.map((p) => p.slot)) + 1,
  };
  s.coop = [0, 1].map((t) => {
    const coaches = room.players.filter((p) => p.team === t).sort((a, b) => a.seat - b.seat);
    if (!coaches.length) return null;
    // a lone coach on a side owns all five heroes (seat 0)
    return coaches.length === 2 ? { seats: 2, own: cleanOwn(room.own[t]), lead: 0, coaches } : { seats: 1, own: Object.fromEntries(ROLES.map((r) => [r, 0])), lead: 0, coaches: [{ ...coaches[0], seat: 0 }] };
  });
  for (const t of [0, 1]) if (s.coop[t] && s.coop[t].seats === 1) for (const p of s.players) if (p.team === t) p.seat = 0;
  if (s.coop[s.myTeam].seats === 1) s.mySeat = 0;
  s.names = [0, 1].map((t) => s.coop[t] ? s.coop[t].coaches.map((c) => c.name).join(' & ') : `${DIFF[s.aiLevel] || 'Normal'} AI`);
  s.ai = [0, 1].map((t) => !s.coop[t]);
  // the other side's lead (2v2): their looks stand for that side (results emote), as in a 1v1
  const foe = s.coop[1 - s.myTeam]; s.oppLooks = foe ? foe.coaches[0].looks || null : null;
  if (s.host && app.net.hub) app.net.hub.teamOf = (slot) => { const p = s.players.find((x) => x.slot === slot); return p ? p.team : -1; };
  app.startDraft();
}
export const coachOf = (s, team, seat) => { const c = s.coop && s.coop[team]; return c ? c.coaches.find((x) => x.seat === seat) || null : null; };
export const mateOf = (s) => (s.coop && s.coop[s.myTeam] && s.coop[s.myTeam].seats === 2 ? coachOf(s, s.myTeam, 1 - s.mySeat) : null);
const ownOf = (s, t) => s.coop[t] && s.coop[t].seats === 2 ? s.coop[t].own : null;

// Whose draft turn it is: { team, seat } (AI turns: seat -1).
export function draftWho(s) {
  const t = currentTurn(s.draft); if (!t) return null;
  if (!s.coop[t.team]) return { team: t.team, seat: -1, act: t.act };
  const own = ownOf(s, t.team);
  return { team: t.team, seat: own ? draftActor(s.draft, t.team, own, s.coop[t.team].lead) : 0, act: t.act };
}
export const myDraftTurn = (s) => { const w = draftWho(s); return !!w && w.team === s.myTeam && w.seat === s.mySeat; };
export function draftLegal(s, heroId) {
  const t = currentTurn(s.draft); if (!t || t.team !== s.myTeam) return false;
  const own = ownOf(s, s.myTeam);
  return own ? coopLegal(s.draft, s.myTeam, s.mySeat, heroId, own) : legal(s.draft, s.myTeam, heroId);
}
// Apply one draft action (local or remote): it must be that coach's turn and legal for their roles.
export function applyDraft(s, team, seat, hero) {
  const w = draftWho(s); if (!w || w.team !== team) return false;
  const d = s.draft; if (!d.seats) d.seats = [[], []];
  const own = ownOf(s, team);
  if (own) return w.seat === seat && coopApply(d, team, seat, hero, own);
  const t = currentTurn(d);
  if (!draftApply(d, team, hero)) return false;
  if (t.act === 'pick') d.seats[team].push(0);
  return true;
}
export function draftAuto(s) {
  const own = ownOf(s, s.myTeam);
  return own ? coopAutoChoice(s.draft, s.myTeam, s.mySeat, own, s.rng) : autoChoice(s.draft, s.myTeam, s.rng, 1);
}
// The host drafts for the AI side (vs-AI co-op) and tells everyone.
export function aiDraftTurn(app) {
  const s = app.session, w = draftWho(s);
  if (!s.host || !w || w.seat !== -1) return;
  const turn = s.draft.turn;
  setTimeout(() => {
    if (app.session !== s || s.draft.turn !== turn) return;
    const hero = autoChoice(s.draft, w.team, s.rng, s.aiLevel);
    if (!applyDraft(s, w.team, 0, hero)) return;
    app.net.t.send({ t: 'draft', team: w.team, seat: 0, hero, turn, p: 0 });
    audio.sfx('lockin', 0.6);
    app.afterDraftAct();
  }, 900 + Math.random() * 900);
}
// "You pick Top, Jungle, Mid · Mia picks Bot, Support"
export function rolesLine(s) {
  const c = s.coop[s.myTeam]; if (!c || c.seats < 2) return '';
  const mate = mateOf(s), L = (seat) => seatRoles(c.own, seat).map((r) => ROLE_LABEL[r]).join(', ');
  return `You: ${L(s.mySeat)} · ${mate ? mate.name : 'Partner'}: ${L(1 - s.mySeat)}`;
}

// ───────────── prep ─────────────
export function coopPrep(s) {
  const d = s.draft, me = s.myTeam, own = ownOf(s, me);
  const pp = prepFromPreset(d.picks[me], d.picks[1 - me], null, s.gameMode);
  if (own) { const roles = coopRoles(d, me, own); pp.prep.heroes.forEach((hp, i) => { hp.role = roles[i]; }); }
  s.seatPreps = [[null, null], [null, null]];
  for (const t of [0, 1]) if (!s.coop[t]) { s.preps[t] = aiPrep(d.picks[t], d.picks[1 - t], s.gameMode); s.ready[t] = true; }
  return pp.prep;
}
// Heroes this coach sets up in prep (all five for a lone coach).
export function myHeroIds(s) {
  const d = s.draft, me = s.myTeam;
  if (!ownOf(s, me)) return d.picks[me].slice();
  return d.picks[me].filter((_, i) => d.seats[me][i] === s.mySeat);
}
export const isLead = (s) => !s.coop || !s.coop[s.myTeam] || s.coop[s.myTeam].lead === s.mySeat;
export function sendPrep(app, prep) {
  const s = app.session;
  app.net.t.send({ t: 'prep', team: s.myTeam, seat: s.mySeat, prep, p: s.slot });
  gotPrep(app, s.myTeam, s.mySeat, prep);
}
function gotPrep(app, team, seat, prep) {
  const s = app.session;
  if (!s || !s.coop || !s.coop[team] || !prep || !Array.isArray(prep.heroes)) return;
  if (!s.seatPreps) { (s.pendingPreps || (s.pendingPreps = [])).push({ team, seat, prep }); return; } // before our own prep screen opened
  s.seatPreps[team][seat] = prep;
  const c = s.coop[team], need = c.seats === 2 ? [0, 1] : [0];
  if (need.some((k) => !s.seatPreps[team][k])) { if (app.renderPrep) app.renderPrep(); return; }
  // merge: each hero's lane and build from its coach; plan and deck from the lead
  const d = s.draft, lead = s.seatPreps[team][c.lead] || s.seatPreps[team][0];
  const heroes = d.picks[team].map((id, i) => {
    const seat = c.seats === 2 ? d.seats[team][i] : 0, src = s.seatPreps[team][seat];
    const hp = src.heroes.find((x) => x.id === id) || lead.heroes.find((x) => x.id === id);
    return { id, role: hp.role, build: hp.build, ...(hp.tal ? { tal: hp.tal } : {}) }; // v23: each coach's talent defaults
  });
  const skins = {}; for (const k of need) Object.assign(skins, s.seatPreps[team][k].skins || {});
  s.preps[team] = { heroes, plan: lead.plan, deck: lead.deck, skins, ...(lead.mv ? { mv: lead.mv } : {}) };
  s.ready[team] = true;
  if (app.renderPrep) app.renderPrep();
  app.checkPrepDone();
}
export function flushPendingPreps(app) {
  const s = app.session, q = s.pendingPreps || []; s.pendingPreps = null;
  for (const m of q) gotPrep(app, m.team, m.seat, m.prep);
}
// Prep is done for this coach (sent) — and for the partner?
export const seatReady = (s, team, seat) => !!(s.seatPreps && s.seatPreps[team][seat]);

// ───────────── match ─────────────
export const coopCfg = (s) => s.coop.map((c) => (c ? { seats: c.seats, own: c.own, lead: c.lead } : null));
export function runnerOpts(s) {
  // seatsOf: what each peer's commands act for (the sender's own team and seat, whatever the message says)
  const seatsOf = Array.from({ length: s.slots }, (_, k) => { const p = s.players.find((x) => x.slot === k); return p ? { team: p.team, seat: p.seat } : null; });
  return { slot: s.slot, slots: s.slots, seat: s.mySeat, coop: true, seatsOf };
}
export function startedRunner(app, runner) {
  // slots that never joined (a guest left the lobby and nobody took the seat) are empty from tick 0
  const s = app.session;
  for (let k = 0; k < s.slots; k++) if (k !== s.slot && !s.players.some((p) => p.slot === k)) runner.drop(k, 0, []);
}
// A guest lost the host mid-match: play on alone. Every other coach leaves (sim/coop.js hands their
// heroes to this coach or to the AI coach) through logged commands, so the replay stays exact.
export function soloFallback(app, LocalRunner) {
  const s = app.session, m = app.match, g = m.game, old = m.runner;
  const r = new LocalRunner(g, s.myTeam, { seat: s.mySeat }); r.acc = old.acc; r.seq = old.seq;
  r.log = old.log; r.htDone = old.htDone; r.ht = old.ht; if (r.ht) r.ht.them = true; r.onHalftime = old.onHalftime; r.onHalftimeEnd = old.onHalftimeEnd;
  for (const p of s.players) if (p.slot !== s.slot && !(old.dropped && old.dropped.has(p.slot))) r.send({ type: 'leave', sys: 1, team: p.team, seat: p.seat });
  m.runner = r; m.hud.runner = r; m.hud.disableChat();
  s.wasOnline = true;
  toast('Lost the host: you coach on alone (the AI takes the other seats).', 3500);
}
export const historyCoop = (s) => ({ kind: s.kind, seat: s.mySeat, mates: (s.coop[s.myTeam] ? s.coop[s.myTeam].coaches : []).filter((c) => c.slot !== s.slot).map((c) => ({ name: c.name, pid: c.pid })) });
