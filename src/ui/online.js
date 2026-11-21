// Online screens: global ladder, account (recovery code / sign in), shared-match links,
// and the post-match ladder result panel.
import { h, mount, toast, emptyState } from './dom.js';
import { HERO_BY_ID } from '../data/heroes.js';
import { profile } from '../profile.js';
import { online, ping, getAccount, recover, leaderboard, getShare, ensureAccount } from '../net/online.js';
import { drawShareCard } from './share.js';
import { audio } from '../audio.js';
import { tierBadge } from './badges.js';
import { rankOf } from '../data/ranks.js';

const screen = () => document.getElementById('screen');
const back = (app) => h('button', { class: 'btn backbtn', onclick: () => { audio.sfx('move', 0.5); app.menu(); } }, '‹ Back');

// ── Global ladder ──
export async function showLeaderboard(app) {
  const season = profile.season;
  const body = h('div', { class: 'panel col lb' }, h('p', { class: 'muted center' }, 'Loading the ladder…'));
  mount(screen(), h('div', { class: 'subscreen' },
    h('div', { class: 'shead' }, back(app), h('div', {}, h('small', {}, `SEASON ${season.id} · ONLINE LADDER`), h('h2', {}, 'Leaderboard')), h('div')),
    h('p', { class: 'muted center small' }, 'Only verified online Ranked matches count: both players’ games must agree on the result. Casual and Lane Rush never change your rating.'),
    body, accountPanel(app)));
  if (!(await ping())) { mount(body, emptyState('assets/img/icons/Vision.png', 'Ladder offline', 'The online ladder can\'t be reached right now. Your matches still count on this device.')); return; }
  try {
    if (!getAccount()) await ensureAccount(app.name);
    const lb = await leaderboard(season.id);
    const me = getAccount();
    const row = (r) => h('div', { class: 'lbr' + (me && r.id === me.id ? ' me' : '') + (r.rank <= 3 ? ' top' + r.rank : '') },
      h('b', { class: 'lbrank' }, `#${r.rank}`), tierBadge(r.rating, 24, 'lbtier'), h('span', { class: 'lbname' }, r.name), h('span', { class: 'lbrat', style: { color: rankOf(r.rating).tier.color } }, h('small', {}, rankOf(r.rating).label + ' '), r.rating), h('small', {}, `${r.wins}W ${r.losses}L`));
    mount(body,
      lb.me ? h('div', { class: 'lbme' }, tierBadge(lb.me.rating, 34), h('span', {}, 'You'), h('b', {}, `#${lb.me.rank}`), h('span', { style: { color: rankOf(lb.me.rating).tier.color } }, `${rankOf(lb.me.rating).label} · ${lb.me.rating}`), h('small', {}, `${lb.me.wins}W ${lb.me.losses}L · peak ${rankOf(lb.me.peak).label}`)) : h('div', { class: 'lbme muted' }, 'Play an online Ranked match to join the ladder.'),
      lb.top.length ? h('div', { class: 'lblist' }, h('div', { class: 'lbr head' }, h('b', { class: 'lbrank' }, 'Rank'), h('i', { class: 'lbtier' }), h('span', { class: 'lbname' }, 'Coach'), h('span', { class: 'lbrat' }, 'Rating'), h('small', {}, 'Record')), ...lb.top.map(row))
        : emptyState('assets/img/items/GoldCup.png', 'No ranked matches yet', 'Be the first this season: Find Match, or Host and send a friend the link.'));
  } catch (e) { mount(body, emptyState('assets/img/icons/Vision.png', 'Could not load the ladder', String(e.message || e))); }
}

// ── Account: recovery code + sign in on another device ──
function accountPanel(app) {
  const el = h('div', { class: 'panel col acct' });
  const render = () => {
    const a = getAccount();
    let input;
    mount(el, h('b', {}, 'Online account'),
      a ? h('div', { class: 'col', style: { gap: '6px' } },
        h('small', { class: 'muted' }, 'Your progress is saved to the cloud. To play on another device, sign in there with this recovery code. Keep it private.'),
        h('div', { class: 'acode' }, h('code', {}, a.code), h('button', { class: 'chip', onclick: async () => { try { await navigator.clipboard.writeText(a.code); toast('Recovery code copied'); } catch { toast(a.code, 6000); } } }, 'Copy')))
        : h('small', { class: 'muted' }, online.ok ? 'Creating your account…' : 'Offline: progress is saved on this device only.'),
      h('div', { class: 'row', style: { gap: '6px', flexWrap: 'nowrap' } },
        input = h('input', { class: 'acin', placeholder: 'MOBA-XXXXX-…', maxlength: 48, autocapitalize: 'characters', spellcheck: 'false' }),
        h('button', { class: 'chip', onclick: async () => {
          const code = input.value.trim(); if (!code) { toast('Paste a recovery code first'); return; }
          if (!confirm('Sign in with this code? This device will switch to that account’s progress.')) return;
          try { const r = await recover(code); if (r.profile) profile.adopt(r.profile); if (r.name) app.setName(r.name); toast(`Signed in as ${r.name}`); app.menu(); }
          catch (e) { toast(e.message || 'Sign in failed'); }
        } }, 'Sign in')));
  };
  render();
  if (!getAccount() && online.ok) ensureAccount(app.name).then(render, () => {});
  return el;
}

// ── Post-match: ladder result for online games ──
export function ladderPanel(promise) {
  if (!promise) return null;
  const el = h('div', { class: 'panel ladderres' }, h('span', { class: 'muted' }, 'Reporting the result…'));
  promise.then((r) => {
    if (!r) { el.remove(); return; }
    if (r.casual) { mount(el, h('span', { class: 'muted' }, r.status === 'verified' ? 'Casual match verified: hero stats recorded, no rating change.' : r.status === 'pending' ? 'Casual match: no rating change.' : r.status === 'disputed' ? 'The two games disagreed on the result.' : 'Casual match: no rating change.')); return; }
    if (r.status === 'verified') {
      const me = r.delta ? (r.mySide === 1 ? r.delta.red : r.delta.blue) : null;
      mount(el, h('b', { class: 'gold' }, 'Ladder match verified'), me !== null && me !== undefined ? h('span', { class: me >= 0 ? 'up' : 'down' }, ` ${me >= 0 ? '+' : ''}${me} rating`) : null);
    } else if (r.status === 'pending') mount(el, h('span', { class: 'muted' }, 'Waiting for your opponent’s report. The ladder updates when both games agree.'));
    else if (r.status === 'disputed') mount(el, h('span', { class: 'down' }, 'The two games disagreed on the result, so this match does not count.'));
    else mount(el, h('span', { class: 'muted' }, 'Ladder offline: this match was not reported.'));
  });
  return el;
}

// ── Shared match links (/s/CODE → ?s=CODE) ──
export async function showShared(app, code) {
  const body = h('div', { class: 'panel col center sharedv' }, h('p', { class: 'muted' }, 'Loading shared match…'));
  mount(screen(), h('div', { class: 'subscreen' }, h('div', { class: 'shead' }, back(app), h('h2', {}, 'Shared match'), h('div')), body));
  try { history.replaceState(null, '', location.pathname); } catch { /* ignore */ }
  try {
    const s = await getShare(code);
    const m = s.data && s.data.match, coach = (s.data && s.data.coach) || { name: 'A coach', rank: '' };
    if (!m) throw new Error('empty');
    const card = await drawShareCard(m, coach); card.className = 'sharedcard';
    const replay = s.data.replay;
    mount(body, card,
      h('div', { class: 'row', style: { justifyContent: 'center' } },
        replay ? h('button', { class: 'btn big', onclick: () => app.watchReplay(replay) }, 'Watch the replay') : null,
        h('button', { class: 'btn big', onclick: () => app.menu() }, 'Play MOBA-VS')),
      h('small', { class: 'muted' }, `${coach.name}${coach.rank ? ' · ' + coach.rank : ''} · your five: ${m.picks[m.side].map((id) => (HERO_BY_ID[id] || { name: id }).name).join(', ')}`));
  } catch { mount(body, h('p', { class: 'muted' }, 'This shared match could not be found.'), h('button', { class: 'btn big', onclick: () => app.menu() }, 'Play MOBA-VS')); }
}

// ── Matchmaking search screen ──
const QUEUE_L = { ranked: 'Ranked', casual: 'Casual 5v5', rush: 'Lane Rush (casual)' };
export function showSearch(app, { elapsed, limit, status, onCancel, queue = 'ranked' }) {
  const left = Math.max(0, Math.ceil((limit - elapsed) / 1000)), frac = Math.min(1, elapsed / limit);
  const el = document.getElementById('mmsearch');
  if (el) { el.querySelector('.mm-st').textContent = status; el.querySelector('.mm-t').textContent = `${left}s`; el.querySelector('.pbar i').style.width = `${Math.round(frac * 100)}%`; return; }
  mount(screen(), h('div', { class: 'panel col center mmsearch', id: 'mmsearch' },
    h('div', { class: 'mm-spin' }), h('h2', { class: 'gold' }, 'Finding a match'),
    h('b', { class: 'mm-st' }, status), h('div', { class: 'pbar' }, h('i', { style: { width: `${Math.round(frac * 100)}%`, background: 'var(--gold)' } })),
    h('small', { class: 'muted' }, `${QUEUE_L[queue] || 'Ranked'} · real players only · gives up in `, h('span', { class: 'mm-t' }, `${left}s`)),
    h('button', { class: 'btn big', onclick: onCancel }, 'Cancel')));
}
