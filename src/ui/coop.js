// Co-op UI: the room lobby (seats, who runs which roles, invite) and the results credit panel.
// The room logic lives in src/coop-room.js; this file only draws it.
import { h, mount, toast } from './dom.js';
import { ROLES, ROLE_LABEL } from '../data/heroes.js';
import { getAccount, friendAction } from '../net/online.js';
import { lobbyInvite, showPlayer } from './social.js';
import { audio } from '../audio.js';
import { COOP_COL, lobbyAct, canStart, startRoom, maxPlayers } from '../coop-room.js';

const screen = () => document.getElementById('screen');
const DIFF = ['Easy', 'Normal', 'Hard'];
const SEAT = ['A', 'B'];

export function showCoopLobby(app) {
  const s = app.session; if (!s || s.mode !== 'coop' || !s.lobby) return;
  const room = s.room, host = s.host, me = room.players.find((p) => p.slot === s.slot);
  const act = (a) => lobbyAct(app, a);
  const seatCard = (team, seat) => {
    const p = room.players.find((x) => x.team === team && x.seat === seat), mine = p && p.slot === s.slot;
    const lead = seat === 0 && room.players.filter((x) => x.team === team).length === 2;
    return h('button', { class: 'cseat' + (p ? ' taken' : ' open') + (mine ? ' me' : ''), style: { '--sc': COOP_COL[seat] }, disabled: !!p,
      title: p ? p.name : 'Tap to sit here', onclick: () => act({ t: 'seat', team, seat }) },
      h('i', { class: 'sl' }, SEAT[seat]),
      h('span', { class: 'sn' }, p ? p.name : 'Open seat'),
      mine ? h('small', { class: 'you' }, 'you') : null, lead ? h('small', { class: 'lead', title: 'The lead makes team-wide calls; the partner suggests them' }, 'lead') : null);
  };
  const teamBox = (team) => {
    const ai = team === 1 && room.kind !== '2v2';
    return h('div', { class: 'cteam t' + team },
      h('b', { class: 'ctn' }, team ? 'Red' : 'Blue', ai ? h('small', {}, ' · AI') : null),
      ai ? h('div', { class: 'cseat ai' }, h('span', { class: 'sn' }, `${DIFF[room.aiLevel]} AI coach`))
        : h('div', { class: 'cseats' }, seatCard(team, 0), seatCard(team, 1)));
  };
  // who runs which roles: one tap moves a role to the other coach (both coaches of a team may change it)
  const myTeamFull = me && room.players.filter((p) => p.team === me.team).length === 2;
  const split = me ? h('div', { class: 'csplit' + (myTeamFull ? '' : ' solo') },
    h('small', { class: 'muted' }, myTeamFull ? 'Who runs which heroes (tap to swap)' : 'Roles split once your partner joins'),
    h('div', { class: 'cchips' }, ...ROLES.map((r) => {
      const seat = room.own[me.team][r] === 1 ? 1 : 0;
      return h('button', { class: 'crole', style: { '--sc': COOP_COL[seat] }, disabled: !myTeamFull, onclick: () => act({ t: 'own', team: me.team, role: r }) }, h('i', {}, SEAT[seat]), ROLE_LABEL[r]);
    }))) : null;
  if (host && !s.inviteEl && room.status && !room.status.startsWith('Opening') && !room.status.startsWith('Could')) s.inviteEl = lobbyInvite(app, room.code, { invite: room.invite, mode: 'coop' });
  const full = room.players.length >= maxPlayers(room.kind), ready = canStart(room);
  const hint = room.kind === '2v2' ? (ready ? 'Ready: a side with one coach runs all five heroes.' : 'Waiting for a coach on each side…')
    : ready ? 'Both coaches are in!' : 'Waiting for your partner…';
  mount(screen(), h('div', { class: 'coop panel', 'data-view': 'coop' },
    h('div', { class: 'cleft' },
      h('h2', {}, 'Co-op room'),
      h('div', { class: 'code' }, room.code),
      host ? h('div', { class: 'seg3 ckind', role: 'radiogroup', 'aria-label': 'Co-op mode' }, ...[['ai', '2 vs AI'], ['2v2', '2v2 online']].map(([k, l]) =>
        h('button', { class: 'chip' + (room.kind === k ? ' on' : ''), role: 'radio', 'aria-checked': String(room.kind === k), onclick: () => act({ t: 'kind', kind: k }) }, l)))
        : h('div', { class: 'muted' }, room.kind === '2v2' ? '2v2: two coaches a side' : `Two coaches vs ${DIFF[room.aiLevel]} AI`),
      host && room.kind === 'ai' ? h('div', { class: 'seg3', role: 'radiogroup', 'aria-label': 'AI difficulty' }, ...DIFF.map((l, i) =>
        h('button', { class: 'chip' + (room.aiLevel === i ? ' on' : ''), role: 'radio', 'aria-checked': String(room.aiLevel === i), onclick: () => act({ t: 'ai', level: i }) }, l))) : null,
      h('div', { class: 'status muted' }, host ? room.status : 'Connected to the room.'),
      host ? s.inviteEl || null : null),
    h('div', { class: 'cright' },
      h('div', { class: 'cteams' }, teamBox(0), teamBox(1)),
      split,
      h('small', { class: 'muted chint' }, full && !ready ? 'Room full.' : hint),
      h('div', { class: 'cbtns' },
        h('button', { class: 'btn', onclick: () => app.menu() }, 'Leave'),
        host ? h('button', { class: 'btn big' + (ready ? ' hot' : ''), disabled: !ready, onclick: () => { audio.sfx('accept', 0.6); startRoom(app); } }, 'Start')
          : h('span', { class: 'muted' }, 'The host starts the match')))));
}

// Results: credit every coach of your team (roles, calls made, calls that paid off) and offer
// profile / add friend for the other coaches in the room.
export function coopResults(app, s, g) {
  const c = s.coop && s.coop[s.myTeam]; if (!c) return null;
  const calls = (seat) => g.events.filter((e) => e.type === 'call' && e.call.team === s.myTeam && (e.call.seat || 0) === seat).length;
  const good = (seat) => g.callLog.filter((x) => x.team === s.myTeam && (x.seat || 0) === seat && x.result === 'success').length;
  const roles = (seat) => c.seats === 2 ? ROLES.filter((r) => c.own[r] === seat).map((r) => ROLE_LABEL[r]).join(', ') : 'All roles';
  const others = s.players.filter((p) => p.slot !== s.slot && p.pid);
  const acct = getAccount();
  return h('div', { class: 'panel coopres' },
    h('b', {}, c.seats === 2 ? 'Coached together' : 'Co-op room'),
    h('div', { class: 'crows' }, ...c.coaches.map((p) => h('div', { class: 'crow', style: { '--sc': COOP_COL[p.seat] } },
      h('i', { class: 'sl' }, SEAT[p.seat]), h('span', { class: 'sn' }, p.slot === s.slot ? `${p.name} (you)` : p.name),
      h('small', { class: 'muted' }, roles(p.seat)), h('span', { class: 'cc' }, `${calls(p.seat)} calls · ${good(p.seat)} paid off`)))),
    others.length && acct ? h('div', { class: 'cfr' }, ...others.map((p) => h('span', { class: 'cfp' }, h('button', { class: 'chip', onclick: () => showPlayer(app, p.pid, { name: p.name }) }, p.name),
      h('button', { class: 'chip', onclick: async (e) => { e.target.disabled = true; try { const r = await friendAction('add', p.pid); toast(r.state === 'friend' ? `You and ${p.name} are now friends` : 'Friend request sent'); e.target.textContent = r.state === 'friend' ? 'Friends' : 'Sent'; } catch (err) { toast(err.message); e.target.disabled = false; } } }, '+ Friend')))) : null,
    h('small', { class: 'muted' }, 'Co-op is casual: no rank change. Mastery, career and history count your own heroes.'));
}
