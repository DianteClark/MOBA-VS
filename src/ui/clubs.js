// Clubs: create or join a club (name, tag, crest), the club page (members and roles, preset chat, this week's
// points and ladder place, the weekend Club War, weekly goals with rewards), the club ladder, and club invites
// through the friends system (Invite → the friend's invite card → Join club). Online only. Rules:
// src/data/clubs.js; Worker: worker/clubs.js. The page polls the Worker only while it is open (every 20 s).
import { h, mount, toast, emptyState } from './dom.js';
import { crest } from './franchise.js';
import { profile } from '../profile.js';
import { TITLES } from '../data/seasons.js';
import { tierBadge } from './badges.js';
import { audio } from '../audio.js';
import { getAccount, ensureAccount, online, ping, createInvite } from '../net/online.js';
import { myClub, clubByCode, clubLadder, createClub, joinClub, leaveClub, clubChat, clubEdit, clubMember } from '../net/social2.js';
import { CHAT, GOALS, ROLES, ROLE_RANK, MAX_MEMBERS, CREST_EMBLEMS, CREST_PATTERNS, CREST_COLORS, crestOf, cleanCrest, cleanClubName, cleanTag,
  CLUB_TITLES, WAR_REWARD, GOALS_REWARD, WAR_XP, CODE_RE } from '../data/clubs.js';
import { socialData, showPlayer } from './social.js';

Object.assign(TITLES, CLUB_TITLES); // club reward titles show up wherever titles do
const screen = () => document.getElementById('screen');
const back = (app) => h('button', { class: 'btn backbtn', onclick: () => { audio.sfx('move', 0.5); app.menu(); } }, '‹ Back');
const PRES = { online: 'Online', match: 'In a match', offline: 'Offline' };
const fmtLeft = (ms) => { const m = Math.max(0, Math.round(ms / 60000)); return m >= 1440 ? `${Math.floor(m / 1440)}d ${Math.floor(m % 1440 / 60)}h` : m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`; };
export const clubCrest = (c, size = 36, cls = '') => crest({ ...crestOf(c.crest), name: c.name || 'Club' }, size, 'clubcrest ' + cls);

// Club rewards (pass XP for each weekly goal, a title for the first war win / a week with every goal) are claimed
// on this device once per week: profile.d.club = { w, got: [goal ids], war: last war week claimed } (tiny, bounded).
function claims(w) {
  let c = profile.d.club;
  if (!c || typeof c !== 'object') c = profile.d.club = { w, got: [], war: -1 };
  if (c.w !== w) { c.w = w; c.got = []; }
  c.got = (Array.isArray(c.got) ? c.got : []).filter((id) => GOALS.some((g) => g.id === id));
  if (!Number.isInteger(c.war)) c.war = -1;
  return c;
}
function claim(xp, rewards = []) {
  const out = []; profile.addPassXp(xp, out); for (const r of rewards) profile.unlock(r, out);
  profile.save(); audio.sfx('powerup', 0.7);
  toast(`+${xp} pass XP${out.length ? ' · ' + out.map((r) => (r.kind === 'title' ? `Title: ${TITLES[r.id] || r.id}` : r.id)).join(', ') : ''}`, 2600);
}
// Goals ready to claim (Home dot on the Club tile, from the last loaded club view).
let lastView = null;
export const clubDot = () => { const v = lastView; if (!v || !v.club) return false; const c = claims(v.week); return GOALS.some((g) => v.stats[g.of] >= g.need && !c.got.includes(g.id)) || (v.lastWar && v.lastWar.result === 'won' && c.war !== v.week - 1); };

// ───────────── the Club screen ─────────────
let poll = 0;
export async function showClub(app, view = null) {
  clearInterval(poll);
  const body = h('div', { class: 'col clubbody' }, h('p', { class: 'muted center' }, 'Loading your club…'));
  mount(screen(), h('div', { class: 'subscreen club', 'data-view': 'club' }, h('div', { class: 'shead' }, back(app), h('h2', {}, 'Club'), h('div')), body));
  if (!online.ok && !(await ping())) { mount(body, emptyState('assets/img/crest/katana.png', 'Clubs are online only', 'Connect to the internet to create or join a club.')); return; }
  try {
    if (!getAccount()) await ensureAccount(app.name);
    const v = view || await myClub(); lastView = v;
    if (!body.isConnected) return;
    if (!v.club) { mount(body, noClub(app)); return; }
    render(app, body, v);
    poll = setInterval(async () => {
      if (!body.isConnected || document.hidden) { if (!body.isConnected) clearInterval(poll); return; }
      try { const nv = await myClub(); lastView = nv; if (body.isConnected && !body.querySelector('.clubedit')) { if (!nv.club) { clearInterval(poll); showClub(app, nv); } else render(app, body, nv); } } catch { /* next time */ }
    }, 20000);
  } catch (e) { mount(body, emptyState('assets/img/crest/katana.png', 'Club unavailable', e.message || 'Try again in a moment.')); }
}
// Run a club action and re-render with its answer.
const act = (app, fn, msg) => async (e) => {
  const b = e && e.currentTarget; if (b) b.disabled = true;
  try { const v = await fn(); lastView = v; if (msg) toast(msg); showClub(app, v); } catch (err) { toast(err.message || 'Could not do that'); if (b) b.disabled = false; }
};

function noClub(app) {
  let code;
  return [
    h('div', { class: 'panel col center clubintro' },
      h('div', { class: 'row', style: { justifyContent: 'center', gap: '6px' } }, ...[[0, 0, 6, 2], [7, 3, 0, 10], [12, 1, 8, 2]].map((c) => crest({ ...crestOf(c.join('.')), name: '' }, 30))),
      h('b', {}, 'Coach together'),
      h('small', { class: 'muted' }, `Up to ${MAX_MEMBERS} coaches. Every match you play earns club points, clubs climb a weekly ladder, meet another club in the weekend Club War and share weekly goals for pass XP.`)),
    h('div', { class: 'clubpick' },
      h('div', { class: 'panel col' }, h('b', {}, 'Join a club'), h('small', { class: 'muted' }, 'Ask a member for the 5-letter club code, or accept a club invite.'),
        h('div', { class: 'row' }, code = h('input', { class: 'acin', maxlength: 5, placeholder: 'CODE', autocapitalize: 'characters', 'aria-label': 'Club code', onkeydown: (e) => { if (e.key === 'Enter') showClubJoin(app, code.value.trim().toUpperCase()); } }),
          h('button', { class: 'btn', onclick: () => showClubJoin(app, code.value.trim().toUpperCase()) }, 'Find'))),
      h('div', { class: 'panel col' }, h('b', {}, 'Start a club'), h('small', { class: 'muted' }, 'Pick a name, a tag and a crest. You can invite friends right away.'),
        h('button', { class: 'btn', onclick: () => editor(app) }, 'Create club'))),
    h('div', { class: 'row', style: { justifyContent: 'center' } }, h('button', { class: 'chip', onclick: () => showClubLadder(app) }, 'Club ladder')),
  ];
}
// Name, tag and crest (emblem, colours and pattern from the pack's crest art).
function editor(app) {
  const st = { name: '', tag: '', c: [Math.floor(Math.random() * CREST_EMBLEMS), Math.floor(Math.random() * CREST_PATTERNS), 6, 2] };
  const prev = h('div', { class: 'cprev' });
  const draw = () => mount(prev, crest({ ...crestOf(st.c.join('.')), name: st.name }, 56), h('div', { class: 'col' }, h('b', {}, cleanClubName(st.name) || 'Your club'), h('small', { class: 'gold' }, `[${cleanTag(st.tag) || 'TAG'}]`)));
  const cyc = (i, n, label) => h('div', { class: 'ccyc' }, h('small', { class: 'muted' }, label), h('div', { class: 'row' },
    h('button', { class: 'chip', 'aria-label': `Previous ${label}`, onclick: () => { st.c[i] = (st.c[i] + n - 1) % n; draw(); } }, '‹'), h('button', { class: 'chip', 'aria-label': `Next ${label}`, onclick: () => { st.c[i] = (st.c[i] + 1) % n; draw(); } }, '›')));
  const body = screen().querySelector('.clubbody');
  mount(body, h('div', { class: 'panel col clubedit' },
    prev,
    h('div', { class: 'row cfields' },
      h('input', { class: 'acin', maxlength: 20, placeholder: 'Club name', 'aria-label': 'Club name', oninput: (e) => { st.name = e.target.value; draw(); } }),
      h('input', { class: 'acin ctag', maxlength: 4, placeholder: 'TAG', autocapitalize: 'characters', 'aria-label': 'Club tag', oninput: (e) => { st.tag = e.target.value; draw(); } })),
    h('div', { class: 'row ccycs' }, cyc(0, CREST_EMBLEMS, 'Emblem'), cyc(1, CREST_PATTERNS, 'Pattern'), cyc(2, CREST_COLORS.length, 'Colour'), cyc(3, CREST_COLORS.length, 'Trim')),
    h('div', { class: 'row', style: { justifyContent: 'center' } },
      h('button', { class: 'chip', onclick: () => showClub(app) }, 'Cancel'),
      h('button', { class: 'btn big', onclick: act(app, () => {
        if (cleanClubName(st.name).length < 3) throw new Error('Club names need at least 3 letters');
        if (cleanTag(st.tag).length < 2) throw new Error('Tags are 2-4 letters or digits');
        return createClub(cleanClubName(st.name), cleanTag(st.tag), cleanCrest(st.c.join('.')));
      }, 'Club created: invite your friends!') }, 'Create'))));
  draw();
}
// Join preview: from a code typed in, a club invite card or an invite link.
export async function showClubJoin(app, code, from = null) {
  if (!CODE_RE.test(code || '')) { toast('Club codes are 5 letters'); return; }
  clearInterval(poll);
  const body = h('div', { class: 'col clubbody' }, h('p', { class: 'muted center' }, 'Looking up the club…'));
  mount(screen(), h('div', { class: 'subscreen club' }, h('div', { class: 'shead' }, back(app), h('h2', {}, 'Join a club'), h('div')), body));
  try {
    if (!getAccount()) await ensureAccount(app.name);
    const c = await clubByCode(code), mine = await myClub();
    mount(body, h('div', { class: 'panel col center clubjoin' },
      clubCrest(c, 64), h('b', { class: 'cjname' }, c.name, ' ', h('small', { class: 'gold' }, `[${c.tag}]`)),
      h('small', { class: 'muted' }, `${c.members}/${MAX_MEMBERS} coaches · ${c.pts} points this week${c.wars ? ` · ${c.wars} war${c.wars === 1 ? '' : 's'} won` : ''}`),
      from ? h('small', {}, `Invited by ${from.name}`) : null,
      mine.club ? h('small', { class: 'muted' }, `You are in ${mine.club.name}: leave it first to join another club.`) : null,
      h('div', { class: 'row', style: { justifyContent: 'center' } }, h('button', { class: 'chip', onclick: () => showClub(app) }, mine.club ? 'My club' : 'Back'),
        h('button', { class: 'btn big', disabled: !!mine.club || c.full, onclick: act(app, () => joinClub(code), `Welcome to ${c.name}!`) }, c.full ? 'Club full' : 'Join club'))));
  } catch (e) { mount(body, emptyState('assets/img/crest/katana.png', 'Club not found', e.message || 'Check the code and try again.'), h('button', { class: 'btn', onclick: () => showClub(app) }, 'Back')); }
}

function render(app, body, v) {
  const c = v.club, me = getAccount().id, myRole = v.role, cl = claims(v.week);
  const s = v.stats;
  // head
  const head = h('div', { class: 'panel clubhead' }, clubCrest(c, 52),
    h('div', { class: 'col', style: { gap: '2px', minWidth: 0, flex: 1 } }, h('b', { class: 'cjname' }, c.name, ' ', h('small', { class: 'gold' }, `[${c.tag}]`)),
      h('small', { class: 'muted' }, `${c.members}/${MAX_MEMBERS} coaches · ${ROLES[myRole]}${c.wars ? ` · ${c.wars} war${c.wars === 1 ? '' : 's'} won` : ''}`),
      h('small', {}, h('b', { class: 'gold' }, `${s.pts} pts`), ` this week${s.rank ? ` · #${s.rank} on the club ladder` : ''} · ${s.g} matches`)),
    h('div', { class: 'col cjcode' }, h('small', { class: 'muted' }, 'Club code'), h('b', { class: 'gold' }, c.code),
      h('div', { class: 'row' }, h('button', { class: 'chip', onclick: async () => { try { await navigator.clipboard.writeText(c.code); toast('Club code copied'); } catch { toast(c.code, 4000); } } }, 'Copy'),
        h('button', { class: 'chip', onclick: () => inviteSheet(app, c) }, 'Invite'))));
  // the weekend war
  const w = v.war, lw = v.lastWar;
  const warEl = h('div', { class: 'panel clubwar' + (v.warOpen && w ? ' live' : '') }, h('div', { class: 'row', style: { justifyContent: 'space-between' } }, h('b', {}, 'Weekend Club War'),
    h('small', { class: 'muted' }, v.warOpen ? `ends in ${fmtLeft(v.warEnds)}` : `starts Saturday · in ${fmtLeft(v.warEnds - 2 * 86400000)}`)),
    w ? h('div', { class: 'warvs' }, h('div', { class: 'wside us' }, clubCrest(c, 28), h('b', {}, String(w.ours))), h('span', { class: 'muted' }, 'vs'), h('div', { class: 'wside them' }, h('b', {}, String(w.theirs)), clubCrest(w.opp, 28)),
      h('div', { class: 'warbar' }, h('i', { style: { width: Math.round(100 * w.ours / Math.max(1, w.ours + w.theirs)) + '%' } })), h('small', { class: 'muted wopp' }, `${w.opp.name} [${w.opp.tag}] · every member match this weekend scores`))
      : h('small', { class: 'muted' }, v.warOpen ? 'No opponent this weekend: clubs are paired on Saturday from the ones that played this week.' : 'On Saturday your club is paired with a club of similar weekly points. Every match your members play over the weekend adds to the war score.'),
    lw ? h('div', { class: 'row lastwar' }, h('small', {}, `Last weekend vs ${lw.opp.name} [${lw.opp.tag}]: `, h('b', { class: lw.result === 'won' ? 'gold' : '' }, { won: 'won', lost: 'lost', draw: 'draw', pending: 'being counted' }[lw.result])),
      lw.result === 'won' && cl.war !== v.week - 1 ? h('button', { class: 'btn small hot', onclick: () => { cl.war = v.week - 1; claim(WAR_XP, [WAR_REWARD]); render(app, body, v); } }, `Claim +${WAR_XP} XP`) : null) : null);
  // weekly goals
  const allDone = GOALS.every((g) => cl.got.includes(g.id));
  const goals = h('div', { class: 'panel clubgoals' }, h('div', { class: 'row', style: { justifyContent: 'space-between' } }, h('b', {}, 'Weekly club goals'), h('small', { class: 'muted' }, 'the whole club, every match counts')),
    ...GOALS.map((g) => {
      const have = Math.min(g.need, s[g.of] || 0), done = have >= g.need, got = cl.got.includes(g.id);
      return h('div', { class: 'cgoal' + (got ? ' got' : '') }, h('div', { class: 'col', style: { flex: 1, gap: '3px', minWidth: 0 } }, h('span', {}, h('b', {}, g.name), ` · ${g.text}`),
        h('div', { class: 'pbar' }, h('i', { style: { width: Math.round(have / g.need * 100) + '%' } }))),
        got ? h('small', { class: 'gold' }, '✓ claimed') : h('button', { class: 'btn small' + (done ? ' hot' : ''), disabled: !done, title: done ? 'Claim the reward' : `${have}/${g.need}`, onclick: () => {
          cl.got.push(g.id); const all = GOALS.every((x) => cl.got.includes(x.id)); claim(g.xp, all ? [GOALS_REWARD] : []); render(app, body, v);
        } }, done ? `+${g.xp} XP` : `${have}/${g.need}`));
    }),
    allDone ? h('small', { class: 'muted center' }, 'All three done this week. New goals on Monday.') : null);
  // chat (presets only)
  const chat = h('div', { class: 'panel clubchat' }, h('b', {}, 'Club chat'),
    h('div', { class: 'cclog', role: 'log', 'aria-label': 'Club chat' }, ...(v.chat.length ? v.chat.slice(-8).map((m) => h('div', { class: 'ccl' + (m.id === me ? ' me' : '') }, h('b', {}, m.name), h('span', {}, CHAT[m.line] || ''))) : [h('small', { class: 'muted' }, 'Say hi to your club.')])),
    h('div', { class: 'cclines' }, ...CHAT.map((l, i) => h('button', { class: 'chip', onclick: act(app, () => clubChat(i)) }, l))));
  // members
  const canKick = (m) => myRole === 'owner' || (myRole === 'officer' && m.role === 'member');
  const memberRow = (m) => {
    const tools = m.id === me ? null : h('div', { class: 'row mtools' },
      myRole === 'owner' && m.role === 'member' ? h('button', { class: 'chip', onclick: act(app, () => clubMember(m.id, 'promote'), `${m.name} is an officer`) }, 'Officer') : null,
      myRole === 'owner' && m.role === 'officer' ? h('button', { class: 'chip', onclick: act(app, () => clubMember(m.id, 'demote')) }, 'Member') : null,
      myRole === 'owner' ? h('button', { class: 'chip', onclick: (e) => { if (confirm(`Hand ${c.name} over to ${m.name}? You become an officer.`)) act(app, () => clubMember(m.id, 'owner'), `${m.name} owns the club now`)(e); } }, 'Owner') : null,
      canKick(m) ? h('button', { class: 'chip', onclick: (e) => { if (confirm(`Remove ${m.name} from the club?`)) act(app, () => clubMember(m.id, 'kick'))(e); } }, 'Remove') : null);
    return h('div', { class: 'frow cmem p-' + m.presence }, h('i', { class: 'pdot', title: PRES[m.presence] }),
      h('button', { class: 'fname', onclick: () => showPlayer(app, m.id, { name: m.name }) }, m.elo ? tierBadge(m.elo, 20) : null, h('span', {}, m.name), m.id === me ? h('small', { class: 'muted' }, ' (you)') : null),
      h('small', { class: 'crole r-' + m.role }, ROLES[m.role]), h('b', { class: 'cpts', title: `${m.g} matches this week` }, `${m.pts}`), tools && tools.childElementCount ? tools : null);
  };
  const members = h('div', { class: 'panel flist clubmem' }, h('div', { class: 'row', style: { justifyContent: 'space-between' } }, h('b', {}, `Members (${v.members.length})`), h('small', { class: 'muted' }, 'points this week')),
    ...v.members.map(memberRow));
  const foot = h('div', { class: 'row clubfoot' },
    h('button', { class: 'chip', onclick: () => showClubLadder(app) }, 'Club ladder'),
    ROLE_RANK[myRole] >= 1 ? h('button', { class: 'chip', title: 'Make a new club code (the old one stops working)', onclick: (e) => { if (confirm('Make a new club code? The old code stops working.')) act(app, () => clubEdit({ newCode: true }), 'New club code ready')(e); } }, 'New code') : null,
    h('button', { class: 'chip', onclick: (e) => { if (confirm(myRole === 'owner' && v.members.length > 1 ? `Leave ${c.name}? Ownership passes to your oldest officer.` : `Leave ${c.name}?`)) act(app, () => leaveClub(), 'You left the club')(e); } }, 'Leave club'));
  mount(body, head, h('div', { class: 'clubcols' }, h('div', { class: 'col' }, warEl, goals), h('div', { class: 'col' }, chat, members)), foot);
}
// Invite friends: through the friends invite system (mode 'club'; their invite card offers "Join club").
function inviteSheet(app, c) {
  const d = socialData(), fr = (d && d.friends) || [];
  const close = () => m.remove();
  const m = h('div', { class: 'modal smodal', onclick: (e) => { if (e.target === m) close(); } }, h('div', { class: 'panel mpanel' },
    h('div', { class: 'mhead' }, h('b', {}, `Invite to ${c.name}`), h('button', { class: 'x', 'aria-label': 'Close', onclick: close }, 'X')),
    h('small', { class: 'muted' }, `Friends get a club invite card. Or share the club code ${c.code}.`),
    fr.length ? h('div', { class: 'flist' }, ...fr.map((f) => h('div', { class: 'frow p-' + f.presence }, h('i', { class: 'pdot' }), h('span', { class: 'fname' }, f.name),
      h('button', { class: 'btn', onclick: async (e) => { e.currentTarget.disabled = true; try { await createInvite(c.code, 'club', f.id); e.target.textContent = 'Sent'; } catch (err) { toast(err.message); e.target.disabled = false; } } }, 'Invite'))))
      : h('small', { class: 'muted' }, 'No friends yet: add friends in Profile → Friends.')));
  document.body.append(m);
}
// The weekly club ladder.
export async function showClubLadder(app) {
  clearInterval(poll);
  const body = h('div', { class: 'col clubbody' }, h('p', { class: 'muted center' }, 'Loading the club ladder…'));
  mount(screen(), h('div', { class: 'subscreen club' }, h('div', { class: 'shead' }, h('button', { class: 'btn backbtn', onclick: () => showClub(app) }, '‹ Club'), h('h2', {}, 'Club Ladder'), h('div')), body));
  try {
    const r = await clubLadder();
    if (!r.top.length) { mount(body, emptyState('assets/img/items/BarGold.png', 'No club points yet this week', 'Every match a club member plays counts. Be the first!')); return; }
    mount(body, h('small', { class: 'muted center' }, 'This week\'s club points. Resets Monday 00:00 UTC.'),
      h('div', { class: 'panel flist cladder' }, ...r.top.map((x) => h('div', { class: 'frow' + (r.me && r.me.id === x.id ? ' me' : '') }, h('b', { class: 'crank' }, `#${x.rank}`), clubCrest(x, 22),
        h('span', { class: 'fname' }, h('span', {}, x.name), h('small', { class: 'gold' }, ` [${x.tag}]`)), h('small', { class: 'muted' }, `${x.members} coaches`), h('b', { class: 'cpts' }, `${x.pts}`)))),
      r.me && !r.top.some((x) => x.id === r.me.id) ? h('div', { class: 'panel frow me' }, h('b', { class: 'crank' }, `#${r.me.rank}`), h('span', { class: 'fname' }, 'Your club'), h('b', { class: 'cpts' }, `${r.me.pts}`)) : null);
  } catch (e) { mount(body, emptyState('assets/img/items/BarGold.png', 'Ladder unavailable', e.message || 'Try again in a moment.')); }
}
