// Watch: the Public Replay Hub (the week's top-voted replays, newest), friends you can watch live right now,
// and AI vs AI. Also the Home screen's one small "Featured" card and "Publish to the Replay Hub" on results.
import { h, mount, toast, emptyState, face, fmtTime } from './dom.js';
import { HERO_BY_ID } from '../data/heroes.js';
import { MAP_BY_ID } from '../maps/defs.js';
import { getShare, getAccount, ensureAccount, online, ping } from '../net/online.js';
import { hubList, hubPublish, hubVote } from '../net/social2.js';
import { socialData, refreshSocial } from './social.js';
import { watchFriend } from './spectate.js';
import { audio } from '../audio.js';

const screen = () => document.getElementById('screen');
const back = (app) => h('button', { class: 'btn backbtn', onclick: () => { audio.sfx('move', 0.5); app.menu(); } }, '‹ Back');
const ago = (t) => { const m = Math.max(0, Math.round((Date.now() - t) / 60000)); return m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`; };
const faces = (ids, cls) => h('span', { class: 'hubfaces ' + cls }, ...(ids || []).filter((id) => HERO_BY_ID[id]).map((id) => h('img', { src: face(id), alt: HERO_BY_ID[id].name, title: HERO_BY_ID[id].name })));

// Open a hub replay in the Theater (a share link: kind 'replay', data { replay }).
export async function watchHub(app, code, backTo) {
  try {
    const s = await getShare(code), rep = s && s.data && (s.data.replay || null);
    if (!rep) throw new Error('empty');
    app.watchReplay(rep, { back: backTo || (() => showHub(app)) });
  } catch { toast('That replay could not be loaded.'); }
}
let cache = null, cacheAt = 0;
async function list(kind, force = false) {
  if (!force && kind === 'week' && cache && Date.now() - cacheAt < 300000) return cache;
  const r = await hubList(kind);
  if (kind === 'week') { cache = r; cacheAt = Date.now(); }
  return r;
}
function entry(app, e, opts = {}) {
  const m = e.meta || {}, mp = MAP_BY_ID[m.map];
  const votes = h('b', {}, String(e.votes));
  const mine = getAccount() && e.author.id === getAccount().id;
  const up = h('button', { class: 'chip hubvote' + (e.voted ? ' on' : ''), disabled: e.voted || mine, title: mine ? 'Your replay' : e.voted ? 'You voted for this replay' : 'Upvote',
    'aria-label': `Upvote (${e.votes})`, onclick: async () => {
      try { if (!getAccount()) await ensureAccount(app.name); const r = await hubVote(e.code); e.votes = r.votes; e.voted = true; votes.textContent = String(r.votes); up.classList.add('on'); up.disabled = true; audio.sfx('accept', 0.5); }
      catch (err) { toast(err.message || 'Could not vote'); }
    } }, '▲ ', votes);
  return h('div', { class: 'panel hubrow' + (opts.feat ? ' feat' : '') },
    h('div', { class: 'hubmain' },
      h('div', { class: 'hubtitle' }, opts.feat ? h('small', { class: 'kick' }, 'FEATURED') : null, h('b', {}, m.title || m.potg || `${(m.names || [])[0] || 'Blue'} vs ${(m.names || [])[1] || 'Red'}`)),
      h('div', { class: 'hubteams' }, faces(m.picks && m.picks[0], 'b' + (m.winner === 0 ? ' won' : '')), h('span', { class: 'hubk' }, `${(m.kills || [0, 0])[0]}-${(m.kills || [0, 0])[1]}`), faces(m.picks && m.picks[1], 'r' + (m.winner === 1 ? ' won' : ''))),
      h('small', { class: 'muted' }, `${e.author.name} · ${mp ? mp.name : m.mode === 'rush' ? 'Lane Rush' : m.map || ''} · ${fmtTime(m.len || 0)}${m.custom ? ' · custom rules' : ''} · ${ago(e.created)}`)),
    h('div', { class: 'hubact' }, up, h('button', { class: 'btn', disabled: m.v && m.v !== app.version, title: m.v && m.v !== app.version ? 'Recorded on another version of the game' : 'Watch in the Replay Theater', onclick: () => watchHub(app, e.code) }, '▶ Watch')));
}
export async function showHub(app, kind = 'week') {
  const body = h('div', { class: 'col hublist' }, h('p', { class: 'muted center' }, 'Loading the Replay Hub…'));
  const d = socialData(), live = ((d && d.friends) || []).filter((f) => f.presence === 'match' && f.watch);
  mount(screen(), h('div', { class: 'subscreen hub' },
    h('div', { class: 'shead' }, back(app), h('h2', {}, 'Watch'), h('div')),
    h('div', { class: 'row hubtop' },
      h('button', { class: 'chip', title: 'Watch an AI vs AI match (Broadcast mode available)', onclick: () => app.watch() }, 'AI vs AI'),
      live.length ? h('span', { class: 'muted' }, 'Live now:') : null,
      ...live.slice(0, 4).map((f) => h('button', { class: 'chip livechip', title: `Watch ${f.name} live (10 s delay)`, onclick: () => watchFriend(app, f) }, h('i', { class: 'pdot' }), f.name))),
    h('div', { class: 'tabs' }, ...[['week', 'Top this week'], ['new', 'Newest']].map(([k, l]) => h('button', { class: 'chip' + (kind === k ? ' on' : ''), onclick: () => showHub(app, k) }, l))),
    body));
  if (getAccount() && online.ok) refreshSocial();
  if (!online.ok && !(await ping())) { mount(body, emptyState('assets/img/icons/Vision.png', 'The Replay Hub is online only', 'Connect to the internet to watch the week\'s best matches.')); return; }
  try {
    const r = await list(kind, true);
    if (!r.list.length) { mount(body, emptyState('assets/img/emote/think.png', 'No replays yet this week', 'Win a great match, then tap "Publish to the Replay Hub" on the results screen.')); return; }
    mount(body, ...r.list.map((e) => entry(app, e)));
  } catch { mount(body, emptyState('assets/img/icons/Vision.png', 'Replay Hub unavailable', 'It could not be loaded right now. Try again in a moment.')); }
}
// Home: one small Featured card (nothing at all while there is no featured replay or no connection).
export function featuredCard(app) {
  const el = h('button', { class: 'h2card h2feat hidden', onclick: () => showHub(app) });
  if (online.ok) list('week').then((r) => {
    const f = r && r.featured; if (!f || !el.isConnected) return;
    const m = f.meta || {};
    mount(el, h('span', { class: 'h2h' }, h('small', { class: 'kick' }, 'FEATURED REPLAY'), h('b', {}, m.title || m.potg || `${(m.names || [])[0]} vs ${(m.names || [])[1]}`)),
      h('span', { class: 'h2featf' }, faces((m.picks || [])[m.winner === 1 ? 1 : 0], ''), h('small', {}, `▲ ${f.votes}`)));
    el.classList.remove('hidden');
  }).catch(() => {});
  return el;
}
// Results: publish this match's replay (one tap; a few a day). rep: the stored replay entry (src/ui/replays.js).
export function publishChip(app, rep, meta) {
  if (!rep || !rep.cfg) return null;
  const b = h('button', { class: 'linkbtn pubbtn', title: 'Share this replay with everyone in the Replay Hub (Watch)', onclick: async () => {
    b.disabled = true; b.textContent = 'Publishing…';
    try {
      if (!(await ping())) throw new Error('You are offline');
      if (!getAccount()) await ensureAccount(app.name);
      await hubPublish({ v: rep.v, cfg: rep.cfg, log: rep.log, names: rep.names, mapId: rep.mapId, winner: rep.winner, skins: rep.skins, len: rep.len }, meta);
      cache = null; audio.sfx('accept', 0.6);
      b.textContent = 'Published to the Replay Hub ✓'; toast('Published: find it under Watch');
    } catch (e) { b.disabled = false; b.textContent = 'Publish to the Replay Hub'; toast(e.message || 'Could not publish'); }
  } }, 'Publish to the Replay Hub');
  return b;
}
