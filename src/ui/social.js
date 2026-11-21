// Social: friends (Profile → Friends tab), presence, invites to a private room, invite links (/i/CODE),
// read-only public profiles and Rematch on online results.
//  * Presence is a heartbeat that runs ONLY while the menu is open (no session, no match, tab visible):
//    one POST every 30 s that also returns friends, requests and invites. One more ping marks "In a match".
//  * Invites host a normal PeerJS room (Host/Join underneath); the friend sees a card and joins it.
//    Ranked needs both: the host picks Ranked, the friend accepts a Ranked invite, and the two
//    clients AND their ranked flags in the hello/start handshake (main.js) so they always report alike.
//  * Rematch runs over the still-open match connection: both accept, the old host starts, sides swap.
import { h, mount, toast, emptyState, face, MODE_LABEL } from './dom.js';
import { HERO_BY_ID } from '../data/heroes.js';
import { BANNERS } from '../data/seasons.js';
import { rankOf, tierById } from '../data/ranks.js';
import { masteryLevel } from '../mastery.js';
import { profile, titleName } from '../profile.js';
import { tierBadge, masteryBadge } from './badges.js';
import { audio } from '../audio.js';
import { makeCode } from '../net/peer.js';
import { online, ping, getAccount, ensureAccount, presence, friendAction, playerProfile, createInvite, getInvite, respondInvite,
  cancelInvites, friendCode, inviteUrl } from '../net/online.js';

const POLL = 30000;
const MODE_NAME = { casual: 'Casual 5v5', ranked: 'Ranked 5v5', rush: 'Lane Rush' };
const PRES = { online: 'Online', match: 'In a match', offline: 'Offline' };
const ago = (t) => { const m = Math.max(0, Math.round((Date.now() - t) / 60000)); return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`; };

// ───────────── presence loop + inbox ─────────────
const st = { app: null, data: null, last: 0, busy: false, subs: new Set(), seenInvites: new Set() };
const menuOpen = () => { const a = st.app; return !!(a && !a.session && !a.match && !document.hidden && getAccount() && online.ok); };
export const socialData = () => st.data;
export function onSocial(fn) { st.subs.add(fn); return () => st.subs.delete(fn); }

async function beat(force = false) {
  if (st.busy || !menuOpen()) return;
  const now = Date.now();
  if (now - st.last < (force ? 5000 : POLL)) return;
  st.busy = true; st.last = now;
  try {
    const d = await presence('menu');
    if (d) { for (const i of d.invites) i.expires = Date.now() + i.left; st.data = d; } // server sends ms left (no clock skew)
  } catch { /* offline: try again next beat */ }
  st.busy = false;
  if (!st.data) return;
  for (const fn of st.subs) { try { fn(st.data); } catch (e) { console.error(e); } }
  badge();
  showInvitePop();
}
// Called once online is up (main.connectOnline). The 5 s check is local only: no network unless the menu is open and a beat is due.
export function startSocial(app) {
  if (st.app) return;
  st.app = app;
  setInterval(() => beat(), 5000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) beat(); });
  beat();
}
export const refreshSocial = () => beat(true);
// "In a match" for friends: one ping when a match of your own starts (the heartbeat stays off in matches).
export function matchPresence() { if (getAccount() && online.ok) presence('match').catch(() => {}); st.last = 0; }
// Profile nav tile dot: pending friend requests.
export const socialBadge = () => !!(st.data && st.data.requests && st.data.requests.length);
function badge() { const d = document.querySelector('.h2nav .navprofile'); if (!d) return; const on = socialBadge(); let dot = d.querySelector('.dot'); if (on && !dot) d.append(h('i', { class: 'dot' })); else if (!on && dot) dot.remove(); }

// Incoming invite: one small card at the top of the menu (never during a draft or match).
function showInvitePop() {
  const inv = (st.data.invites || []).find((i) => !st.seenInvites.has(i.id) && i.expires > Date.now());
  if (!inv || document.querySelector('.invpop') || !menuOpen()) return;
  if (document.querySelector('.modal')) return; // another dialog is open: show the invite on the next beat
  st.seenInvites.add(inv.id);
  audio.sfx('accept', 0.5);
  const left = h('span', { class: 'muted' });
  const close = () => { clearInterval(tm); el.remove(); };
  const card = h('div', { class: 'panel invpop', role: 'dialog', 'aria-label': 'Match invite' },
    h('div', { class: 'invtxt' }, h('small', { class: 'muted' }, 'MATCH INVITE'), h('b', {}, `${inv.from.name} invites you`), h('span', {}, MODE_NAME[inv.mode] || 'Casual 5v5', ' · expires in ', left)),
    inv.mode === 'ranked' ? h('small', { class: 'muted' }, 'Joining agrees to a rated match.') : null,
    h('div', { class: 'row', style: { justifyContent: 'center' } },
      h('button', { class: 'chip', onclick: async () => { close(); try { await respondInvite(inv.id, false); } catch { /* expired anyway */ } } }, 'Decline'),
      h('button', { class: 'btn big', onclick: () => { close(); acceptInvite(st.app, inv.id); } }, 'Join')));
  // a small dialog over the menu (it blocks the menu only until answered; it closes itself when it expires)
  const el = h('div', { class: 'modal invmodal' }, card);
  const tick = () => { const s = Math.max(0, Math.round((inv.expires - Date.now()) / 1000)); left.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; if (!s || !menuOpen()) close(); };
  const tm = setInterval(tick, 1000); tick();
  document.body.append(el);
}
async function acceptInvite(app, id) {
  try {
    const r = await respondInvite(id, true);
    if (r.status !== 'accepted' && r.status !== 'open' || !r.room) { toast(r.status === 'expired' ? 'That invite has expired.' : 'That invite is no longer open.'); return; }
    joinRoom(app, r.room, r.mode);
  } catch (e) { toast(e.message || 'Could not join'); }
}
// Join an invite's room (agreeing to Ranked when the invite is Ranked).
function joinRoom(app, room, mode) {
  const ranked = mode === 'ranked';
  app.joinScreen(room, { ranked, queue: ranked ? 'ranked' : 'private' });
}

// ───────────── hosting an invite ─────────────
// Mode picker, then a normal hosted room with the invite attached.
export function inviteFriend(app, friend) {
  const close = modal(`Invite ${friend.name}`,
    h('small', { class: 'muted' }, 'You host a private room; they get an invite card on their menu. Ranked counts only if they accept it as Ranked.'),
    h('div', { class: 'invmodes' }, ...['casual', 'rush', 'ranked'].map((m) => h('button', { class: 'btn' + (m === 'ranked' ? ' ranked' : ''), onclick: () => { close(); hostInvite(app, { to: friend, mode: m }); } },
      h('b', {}, MODE_NAME[m]), h('small', {}, m === 'ranked' ? 'Climbs the ladder' : m === 'rush' ? 'One lane, ~7 min' : 'No rating change')))));
}
export function hostInvite(app, { to = null, mode = 'casual' } = {}) {
  const ranked = mode === 'ranked';
  app.hostGame({ code: makeCode(), ranked, queue: ranked ? 'ranked' : 'private', gameMode: mode === 'rush' ? 'rush' : 'classic', invite: { to, mode } });
}
// The lobby's invite box (main.hostGame mounts it under the room code): sends the friend invite, follows
// its answer (one GET every 15 s while the lobby is up, 3 min at most) and offers a shareable invite link.
export function lobbyInvite(app, code, opts = {}) {
  const inv = opts.invite || null, mode = inv ? inv.mode : (opts.gameMode || (app.queueMode === 'rush' ? 'rush' : 'classic')) === 'rush' ? 'rush' : 'casual';
  const line = h('small', { class: 'muted invline' });
  let link = null;
  const copy = async () => {
    if (!link) {
      try { if (!getAccount()) await ensureAccount(app.name); link = (await createInvite(code, mode, null)).url; app.inviteRoom = code; }
      catch { link = `${location.origin}${location.pathname}?join=${code}`; }
    }
    const text = `Join my MOBA-VS ${MODE_NAME[mode] || 'match'}: ${link}`;
    try {
      if (navigator.share && matchMedia('(pointer: coarse)').matches) await navigator.share({ title: 'MOBA-VS invite', text, url: link });
      else { await navigator.clipboard.writeText(link); toast('Invite link copied'); }
    } catch { toast(link, 6000); }
  };
  const el = h('div', { class: 'lobbyinv' }, line, h('button', { class: 'chip', onclick: copy }, 'Copy invite link'));
  if (inv && inv.to) {
    line.textContent = `Inviting ${inv.to.name} to ${MODE_NAME[inv.mode]}…`;
    app.inviteRoom = code;
    createInvite(code, inv.mode, inv.to.id).then((r) => {
      line.textContent = `Invite sent to ${inv.to.name} · ${MODE_NAME[inv.mode]}`;
      const until = Date.now() + r.ttl, tm = setInterval(async () => {
        if (!el.isConnected || Date.now() > until + 5000) { clearInterval(tm); if (el.isConnected && Date.now() > until) line.textContent = `${inv.to.name} did not answer in time. Copy the link and send it another way.`; return; }
        try {
          const s = await getInvite(r.id);
          if (s.status === 'accepted') { line.textContent = `${inv.to.name} accepted: connecting…`; clearInterval(tm); }
          else if (s.status === 'declined') { line.textContent = `${inv.to.name} declined.`; clearInterval(tm); }
        } catch { /* keep waiting */ }
      }, 15000);
    }, (e) => { line.textContent = `Could not send the invite (${e.message || 'offline'}). Share the code or the link instead.`; });
  } else line.textContent = 'Send a friend the link: it opens the game straight into this room.';
  return el;
}
// Leaving the lobby or starting the match closes the room's open invites.
export function closeInvites(app) { if (app.inviteRoom) { cancelInvites(app.inviteRoom); app.inviteRoom = null; } }

// ───────────── invite links (/i/CODE → ?i=CODE) ─────────────
export async function showInviteLink(app, id) {
  try { history.replaceState(null, '', location.pathname); } catch { /* ignore */ }
  const body = h('div', { class: 'panel col center invland' }, h('p', { class: 'muted' }, 'Opening the invite…'));
  mount(document.getElementById('screen'), h('div', { class: 'lobby panel col', style: { alignItems: 'center' } }, h('h2', {}, 'Match invite'), body));
  const home = h('button', { class: 'btn', onclick: () => app.menu() }, 'Main menu');
  if (!/^[A-Z0-9]{8}$/.test(id) || !(await ping())) { mount(body, h('p', {}, 'This invite could not be opened (offline or broken link).'), home); return; }
  try {
    const inv = await getInvite(id);
    const acct = getAccount() || await ensureAccount(app.name);
    if (inv.from.id === acct.id) { mount(body, h('p', {}, 'This is your own invite link: send it to a friend.'), home); return; }
    if (inv.status !== 'open' && inv.status !== 'pending') { mount(body, h('p', {}, `${inv.from.name}'s invite has ${inv.status === 'expired' ? 'expired' : 'closed'}.`), h('small', { class: 'muted' }, 'Ask them for a new link, or add them as a friend.'), h('div', { class: 'row' }, h('button', { class: 'chip', onclick: () => showPlayer(app, inv.from.id, { name: inv.from.name }) }, 'Profile'), home)); return; }
    mount(body, h('p', {}, h('b', { class: 'gold' }, inv.from.name), ` invites you to ${MODE_NAME[inv.mode] || 'a match'}.`),
      inv.mode === 'ranked' ? h('small', { class: 'muted' }, 'Ranked: joining agrees to a rated match. It counts when both games report the same result.') : null,
      h('div', { class: 'row', style: { justifyContent: 'center' } },
        h('button', { class: 'btn big', onclick: () => acceptInvite(app, id) }, 'Join'),
        h('button', { class: 'chip', onclick: () => showPlayer(app, inv.from.id, { name: inv.from.name }) }, 'Profile'), home));
  } catch (e) { mount(body, h('p', {}, e.message === 'This invite was not found' ? 'This invite was not found.' : 'Could not open the invite.'), home); }
}

// ───────────── Profile → Friends tab ─────────────
// Friend code + add box, requests, friends (presence, Invite), recent opponents, sent requests, blocked.
export function friendsTab(app) {
  const el = h('div', { class: 'col friends' });
  const render = () => {
    if (!el.isConnected && el.dataset.done) { off(); return; }
    el.dataset.done = '1';
    const acct = getAccount(), d = st.data;
    if (!acct || !online.ok) { mount(el, emptyState('assets/img/icons/Vision.png', 'Friends are online only', 'Connect to the internet to add friends, see who is online and invite them.')); return; }
    let input;
    const add = async (id) => { try { const r = await friendAction('add', id); audio.sfx('accept', 0.6); toast(r.state === 'friend' ? `You and ${r.name} are now friends` : `Friend request sent to ${r.name}`); if (input) input.value = ''; refresh(); } catch (e) { toast(e.message); } };
    const act = (action, id, msg) => async () => { try { await friendAction(action, id); if (msg) toast(msg); refresh(); } catch (e) { toast(e.message); } };
    const known = new Set([acct.id, ...((d && [...d.friends, ...d.sent, ...d.blocked, ...d.requests]) || []).map((x) => x.id)]);
    const recent = []; for (const m of profile.d.history) if (m.opp && !known.has(m.opp) && !recent.some((r) => r.id === m.opp) && recent.length < 5) recent.push({ id: m.opp, name: (m.names || [])[1 - m.side] || 'Coach', t: m.t, mode: m.mode });
    const nameBtn = (f, extra) => h('button', { class: 'fname', title: 'View profile', onclick: () => showPlayer(app, f.id, { name: f.name }) }, f.elo ? tierBadge(f.elo, 22) : null, h('span', {}, f.name), extra || null);
    mount(el,
      h('div', { class: 'panel fcode' },
        h('div', { class: 'col', style: { gap: '2px' } }, h('small', { class: 'muted' }, 'Your friend code'), h('b', { class: 'gold' }, friendCode(acct.id))),
        h('button', { class: 'chip', onclick: async () => { try { await navigator.clipboard.writeText(friendCode(acct.id)); toast('Friend code copied'); } catch { toast(friendCode(acct.id), 5000); } } }, 'Copy'),
        input = h('input', { class: 'acin', placeholder: 'Friend code', maxlength: 16, autocapitalize: 'characters', spellcheck: 'false', 'aria-label': 'Friend code', onkeydown: (e) => { if (e.key === 'Enter') add(input.value); } }),
        h('button', { class: 'btn', onclick: () => { if (input.value.trim()) add(input.value); else toast('Type a friend code first'); } }, 'Add')),
      !d ? h('p', { class: 'muted center' }, 'Loading friends…') : [
        d.requests.length ? h('div', { class: 'panel flist' }, h('b', {}, 'Friend requests'), ...d.requests.map((f) => h('div', { class: 'frow' }, nameBtn(f),
          h('button', { class: 'chip', onclick: act('decline', f.id) }, 'Ignore'), h('button', { class: 'btn', onclick: act('accept', f.id, `You and ${f.name} are now friends`) }, 'Accept')))) : null,
        h('div', { class: 'panel flist' }, h('div', { class: 'row', style: { justifyContent: 'space-between' } }, h('b', {}, `Friends (${d.friends.length})`), h('small', { class: 'muted' }, `${d.friends.filter((f) => f.presence !== 'offline').length} online`)),
          d.friends.length ? d.friends.map((f) => h('div', { class: 'frow p-' + f.presence }, h('i', { class: 'pdot', title: PRES[f.presence] }), nameBtn(f, h('small', { class: 'muted' }, f.presence === 'offline' ? (f.seen ? `seen ${ago(f.seen)}` : 'offline') : PRES[f.presence])),
            h('button', { class: 'btn', disabled: f.presence !== 'online', title: f.presence === 'online' ? 'Invite to a private match' : f.presence === 'match' ? 'Playing a match right now' : 'Offline', onclick: () => inviteFriend(app, f) }, 'Invite')))
            : h('small', { class: 'muted' }, 'No friends yet: add the coaches you just played, or swap friend codes.')),
        recent.length ? h('div', { class: 'panel flist' }, h('b', {}, 'Recently played'), ...recent.map((r) => h('div', { class: 'frow' }, nameBtn(r, h('small', { class: 'muted' }, `${MODE_LABEL[r.mode] || 'Online'} · ${ago(r.t)}`)),
          h('button', { class: 'btn', onclick: () => add(r.id) }, 'Add')))) : null,
        d.sent.length ? h('div', { class: 'panel flist' }, h('b', {}, 'Waiting for an answer'), ...d.sent.map((f) => h('div', { class: 'frow' }, nameBtn(f), h('button', { class: 'chip', onclick: act('remove', f.id) }, 'Cancel')))) : null,
        d.blocked.length ? h('details', { class: 'panel flist' }, h('summary', {}, `Blocked (${d.blocked.length})`), ...d.blocked.map((f) => h('div', { class: 'frow' }, h('span', { class: 'fname' }, f.name), h('button', { class: 'chip', onclick: act('unblock', f.id, `${f.name} unblocked`) }, 'Unblock')))) : null,
      ]);
  };
  const off = onSocial(() => { if (!el.isConnected) { off(); return; } render(); });
  const refresh = () => { st.last = 0; beat(true); };
  render();
  refresh();
  return el;
}

// ───────────── public profile (read-only) ─────────────
// Tier, title, border, ladder line, top heroes by mastery and recent results. Friends also see presence.
export async function showPlayer(app, id, { name = 'Coach' } = {}) {
  const body = h('div', { class: 'col pprof' }, h('p', { class: 'muted center' }, 'Loading profile…'));
  const close = modal('Coach profile', body);
  let r;
  try { r = await playerProfile(id, profile.season.id); } catch (e) { mount(body, emptyState('assets/img/icons/Vision.png', 'Profile unavailable', e.message === 'Coach not found' ? 'This coach could not be found.' : 'The profile could not be loaded right now.')); return; }
  const pub = r.pub, rk = rankOf(pub ? pub.elo : 1000), ban = pub && BANNERS[pub.banner], title = pub && pub.title ? titleName(pub.title) : null;
  const border = pub && pub.border ? tierById(pub.border.tier) : null;
  const act = (action, msg) => async () => { try { await friendAction(action, id); if (msg) toast(msg); refreshSocial(); close(); showPlayer(app, id, { name: r.name }); } catch (e) { toast(e.message); } };
  const rel = r.relation;
  const actions = rel === 'me' ? [h('small', { class: 'muted' }, `This is you · friend code ${friendCode(id)}`)] : [
    rel === 'friend' ? h('button', { class: 'btn', disabled: r.presence !== 'online', onclick: () => { close(); inviteFriend(app, { id, name: r.name }); } }, 'Invite') : null,
    rel === null ? h('button', { class: 'btn', onclick: act('add', 'Friend request sent') }, 'Add friend') : null,
    rel === 'incoming' ? h('button', { class: 'btn', onclick: act('accept', `You and ${r.name} are now friends`) }, 'Accept request') : null,
    rel === 'sent' ? h('small', { class: 'muted' }, 'Friend request sent') : null,
    rel === 'friend' ? h('button', { class: 'chip', onclick: () => { if (confirm(`Remove ${r.name} from your friends?`)) act('remove', 'Friend removed')(); } }, 'Remove') : null,
    rel === 'blocked' ? h('button', { class: 'chip', onclick: act('unblock', 'Unblocked') }, 'Unblock')
      : h('button', { class: 'chip', onclick: () => { if (confirm(`Block ${r.name}? They can no longer invite you or send requests.`)) act('block', 'Blocked')(); } }, 'Block'),
  ];
  mount(body,
    h('div', { class: 'phead', style: { background: ban ? ban.bg : null, borderColor: border ? border.color : null } },
      tierBadge(rk, 44),
      h('div', { class: 'col', style: { gap: '2px', minWidth: 0 } },
        h('b', { class: 'pname' }, r.name, r.presence ? h('small', { class: 'ppres p-' + r.presence }, ' · ' + PRES[r.presence]) : null),
        title ? h('small', { class: 'gold' }, title) : null,
        h('small', { style: { color: rk.tier.color } }, `${rk.label} · ${pub ? pub.elo : '-'}${pub ? ` · ${pub.w}W ${pub.l}L` : ''}`)),
      border ? h('span', { class: 'pborder', style: { borderColor: border.color, color: border.color }, title: `Season ${pub.border.season} border` }, border.name) : null),
    h('div', { class: 'pline' },
      r.ladder ? h('span', {}, h('b', { class: 'gold' }, `#${r.ladder.rank}`), ` online ladder · ${r.ladder.rating} · ${r.ladder.wins}W ${r.ladder.losses}L`) : h('span', { class: 'muted' }, 'Not on the online ladder this season'),
      pub && (pub.trophies.gold || pub.trophies.silver) ? h('span', { class: 'muted' }, ` · ${pub.trophies.gold ? `${pub.trophies.gold} Golden Cup${pub.trophies.gold > 1 ? 's' : ''}` : ''}${pub.trophies.gold && pub.trophies.silver ? ', ' : ''}${pub.trophies.silver ? `${pub.trophies.silver} Silver` : ''}`) : null),
    !pub ? h('p', { class: 'muted center' }, 'This coach has not shared a profile yet.') : [
      pub.top.length ? h('div', { class: 'ptop' }, h('small', { class: 'muted' }, 'Top heroes'), h('div', { class: 'ptopl' }, ...pub.top.map(([hid, pts]) => HERO_BY_ID[hid] ? h('div', { class: 'phero', title: `${HERO_BY_ID[hid].name} · mastery ${masteryLevel(pts)}` },
        h('img', { src: face(hid), alt: '' }), masteryBadge(masteryLevel(pts), { always: true }), h('small', {}, HERO_BY_ID[hid].name)) : null))) : null,
      pub.recent.length ? h('div', { class: 'precent' }, h('small', { class: 'muted' }, 'Recent results'), ...pub.recent.map((m) => h('div', { class: 'prow2 ' + (m.won ? 'win' : 'loss') },
        h('b', {}, m.won ? 'W' : 'L'), h('span', { class: 'pmode' }, MODE_LABEL[m.mode] || m.mode || ''), h('span', { class: 'pfaces' }, ...m.picks.filter((x) => HERO_BY_ID[x]).map((x) => h('img', { src: face(x), alt: '', class: m.mvp === x ? 'mvp' : '' }))),
        h('b', { class: 'pk' }, `${m.k[0]}-${m.k[1]}`), h('small', { class: 'muted' }, m.t ? ago(m.t) : '')))) : h('small', { class: 'muted center' }, 'No matches played yet.'),
    ],
    h('div', { class: 'row pact' }, ...actions));
}

// ───────────── results: opponent + Rematch ─────────────
// Shown on online results. Rematch needs both coaches; the original host then starts it with sides swapped.
export function socialPanel(app, s) {
  if (!s || !(s.mode === 'host' || s.mode === 'join' || s.wasOnline) || (!s.oppId && !app.net)) return null;
  const opp = s.names[1 - s.myTeam] || 'Opponent';
  if (!app.rematch || app.rematch.match !== s.matchId) app.rematch = { match: s.matchId, me: false, them: false, gone: !app.net };
  const rm = app.rematch;
  const el = h('div', { class: 'panel rmatch' });
  const known = st.data && [...st.data.friends, ...st.data.sent].some((f) => f.id === s.oppId);
  const render = () => {
    if (!el.isConnected && rm.drawn) return;
    rm.drawn = true;
    const status = rm.gone ? `${opp} left.` : rm.me && rm.them ? 'Starting the rematch…' : rm.me ? `Waiting for ${opp} to accept…` : rm.them ? `${opp} wants a rematch!` : 'Same opponent, sides swapped.';
    mount(el,
      h('div', { class: 'col', style: { gap: '2px', minWidth: 0, flex: 1 } }, h('b', {}, `vs ${opp}`), h('small', { class: rm.them && !rm.me && !rm.gone ? 'gold' : 'muted' }, status)),
      s.oppId ? h('button', { class: 'chip', onclick: () => showPlayer(app, s.oppId, { name: opp }) }, 'Profile') : null,
      s.oppId && !known && getAccount() ? h('button', { class: 'chip', onclick: async (e) => { e.target.disabled = true; try { const r = await friendAction('add', s.oppId); toast(r.state === 'friend' ? `You and ${opp} are now friends` : 'Friend request sent'); e.target.textContent = r.state === 'friend' ? 'Friends' : 'Sent'; } catch (err) { toast(err.message); e.target.disabled = false; } } }, 'Add friend') : null,
      h('button', { class: 'btn' + (rm.them && !rm.me && !rm.gone ? ' hot' : ''), disabled: rm.gone || rm.me, onclick: () => askRematch(app) }, rm.them ? 'Accept rematch' : 'Rematch'));
  };
  rm.render = render;
  render();
  return el;
}
function askRematch(app) {
  const rm = app.rematch; if (!rm || rm.me || rm.gone || !app.net) return;
  rm.me = true; audio.sfx('accept', 0.6);
  app.net.t.send({ t: 'rm', match: rm.match, elo: profile.elo });
  rm.render && rm.render();
  maybeStartRematch(app);
}
// Network: the opponent asked (or accepted). main.onNet routes 'rm' here.
export function onRematch(app, m) {
  const s = app.resultsSession(); if (!s || !s.finished) return;
  if (!app.rematch || app.rematch.match !== s.matchId) app.rematch = { match: s.matchId, me: false, them: false, gone: false };
  const rm = app.rematch;
  if (m.match && m.match !== rm.match) return;
  rm.them = true; if (m.elo) rm.oppElo = m.elo;
  if (!rm.me) audio.sfx('move', 0.6);
  rm.render && rm.render();
  maybeStartRematch(app);
}
function maybeStartRematch(app) { const rm = app.rematch, s = app.resultsSession(); if (rm.me && rm.them && !rm.gone && s && s.mode === 'host') app.startRematch(rm.oppElo); }
// The connection closed while on the results screen.
export function rematchGone(app) { const rm = app.rematch; if (rm && !rm.gone) { rm.gone = true; rm.render && rm.render(); } }

// ───────────── small modal ─────────────
function modal(title, ...kids) {
  const close = () => { m.remove(); document.removeEventListener('keydown', esc); };
  const esc = (e) => { if (e.key === 'Escape') close(); };
  const m = h('div', { class: 'modal smodal', onclick: (e) => { if (e.target === m) close(); } },
    h('div', { class: 'panel mpanel' }, h('div', { class: 'mhead' }, h('b', {}, title), h('button', { class: 'x', 'aria-label': 'Close', onclick: close }, 'X')), ...kids));
  document.addEventListener('keydown', esc);
  document.body.append(m);
  return close;
}
