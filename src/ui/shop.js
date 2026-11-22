// Champions shop (Dojo → Shop): Koban balance, free picks, this week's free rotation, Ranked progress, and every
// champion with its tier, price and state (owned / free this week / starter), filters by role and tier, buy
// with a confirm, a free General pick, and "Try it" (one vs-AI match with a champion you don't own).
// Also: the small Koban chip on Home, the Koban row on the results, the Ranked gate and draft access badges.
import { h, mount, face, toast, emptyState } from './dom.js';
import { HEROES, HERO_BY_ID, ROLES, ROLE_LABEL } from '../data/heroes.js';
import { CLANS } from '../sim/constants.js';
import { TIERS, TIER_ORDER, tierOf, priceOf, isStarter, ECON, RANKED_OWNED } from '../data/unlocks.js';
import { profile } from '../profile.js';
import { kb, owns, ownedCount, inRotation, freeRotation, rotationEnds, picksLeft, nextPickLevel, generalsDone, canTry, buyChampion, useFreePick, armTrial, syncKoban, roleCoverage } from '../unlocks.js';
import { kobanSignedIn } from '../net/koban.js';
import { heroRatings } from '../data/herostats.js';
import { audio } from '../audio.js';

const tap = () => audio.sfx('move', 0.4);
const fmt = (n) => Math.round(n).toLocaleString('en-US');
export const coin = (cls = '') => h('i', { class: 'koban' + (cls ? ' ' + cls : ''), 'aria-hidden': 'true' });
export const kobanAmount = (n, cls = '') => h('span', { class: 'kamt' + (cls ? ' ' + cls : '') }, coin(), fmt(n));
// Draft / Dojo card badge for a hero you may use without owning it.
const BADGE = { free: ['FREE', 'Free this week'], try: ['TRY', 'Try it: this vs-AI match only'], loan: ['LOAN', 'On loan for this match'] };
export function accessBadge(acc) {
  if (acc && BADGE[acc]) return h('span', { class: 'accb ' + acc, title: BADGE[acc][1] }, BADGE[acc][0]);
  return h('span', { class: 'accb lock', title: 'Locked: unlock it in the Shop', 'aria-label': 'Locked' });
}
const tierChip = (t) => h('span', { class: 'tierc', style: { '--tc': TIERS[t].color } }, TIERS[t].name);
const daysLeft = () => { const ms = rotationEnds() - Date.now(), d = Math.floor(ms / 86400000), hrs = Math.floor(ms / 3600000) % 24; return d ? `${d}d ${hrs}h` : `${hrs}h`; };

// ───────────── Home chip ─────────────
export function kobanChip(onOpen) {
  const K = kb(profile), picks = picksLeft(profile);
  return h('button', { class: 'h2icon kchip', title: `Koban: ${fmt(K.bal)} · ${ownedCount(profile)} champions owned${picks ? ` · ${picks} free pick${picks > 1 ? 's' : ''}` : ''}. Tap for the Champions shop.`,
    'aria-label': `Koban ${fmt(K.bal)}, open the Champions shop`, onclick: () => { tap(); onOpen(); } }, coin(), h('b', {}, fmt(K.bal)), picks ? h('i', { class: 'dot' }) : null);
}

// ───────────── results row ─────────────
export function kobanRow(k) {
  if (!k || !k.total) return null;
  return h('div', { class: 'prow krow' }, h('div', { class: 'lvb kb' }, coin(), `+${fmt(k.total)}`),
    h('div', { class: 'col', style: { gap: '3px', flex: 1 } },
      h('div', { class: 'xps' }, ...k.parts.map(([l, v]) => h('span', {}, `${l} +${fmt(v)}`))),
      h('small', { class: 'muted' }, `Koban ${fmt(k.bal)}`, k.picks ? ` · ${k.picks} free pick${k.picks > 1 ? 's' : ''} ready` : '', k.rookie ? ` · rookie boost: ${k.rookie} more match${k.rookie > 1 ? 'es' : ''}` : '',
        k.tried ? ` · Try it used: ${HERO_BY_ID[k.tried].name}` : '')));
}

// ───────────── Ranked gate (Find Match → Ranked with fewer than 25 owned) ─────────────
export function rankedGate(app) {
  const n = ownedCount(profile), cov = roleCoverage(profile);
  const close = () => m.remove();
  const m = h('div', { class: 'modal', onclick: (e) => { if (e.target === m) close(); } },
    h('div', { class: 'panel mpanel rgate' }, h('div', { class: 'mhead' }, h('b', {}, 'Ranked unlocks at 25 champions'), h('button', { class: 'x', onclick: close, 'aria-label': 'Close' }, 'X')),
      h('div', { class: 'rgrow' }, h('b', { class: 'gold' }, `${n}/${RANKED_OWNED}`), h('div', { class: 'pbar rgbar' }, h('i', { style: { width: Math.round(Math.min(1, n / RANKED_OWNED) * 100) + '%' } }))),
      h('div', { class: 'muted small' }, 'Owned per role: ', ROLES.map((r) => `${ROLE_LABEL[r]} ${cov[r]}`).join(' · ')),
      h('div', { class: 'small' }, `Every match pays Koban: win ${ECON.win}, loss ${ECON.loss}, double for your first ${ECON.rookieGames}, plus ${ECON.firstWin} for the first win of the day and daily goals. Casual and Lane Rush are open now.`),
      h('div', { class: 'row rgbtns' },
        h('button', { class: 'btn on', onclick: () => { close(); openShop(app); } }, 'Champions shop'),
        h('button', { class: 'btn', onclick: () => { close(); app.setQueueMode('casual'); app.findMatch(); } }, 'Play Casual'),
        h('button', { class: 'btn', onclick: () => { close(); app.startVsAI('classic'); } }, 'Play vs AI'))));
  document.body.append(m);
  audio.sfx('move', 0.5);
}
export async function openShop(app, patch = {}) { const { showDojo } = await import('./dojo.js'); showDojo(app, { tab: 'shop', ...patch }); }

// ───────────── the shop (a Dojo tab) ─────────────
let st = { role: 'all', tier: 'all', show: 'all' };
export function shopTab(app, rerender) {
  const P = profile, K = kb(P), n = ownedCount(P), picks = picksLeft(P), rot = freeRotation();
  const redo = (patch) => { st = { ...st, ...patch }; rerender(); };
  const list = HEROES.filter((x) => (st.role === 'all' || x.roles.includes(st.role)) && (st.tier === 'all' || tierOf(x.id) === st.tier)
    && (st.show === 'all' || (st.show === 'owned') === owns(P, x.id)))
    .sort((a, b) => (owns(P, a.id) ? 1 : 0) - (owns(P, b.id) ? 1 : 0) || TIER_ORDER.indexOf(tierOf(a.id)) - TIER_ORDER.indexOf(tierOf(b.id)) || ROLES.indexOf(a.role) - ROLES.indexOf(b.role) || (a.name < b.name ? -1 : 1));
  const card = (x) => {
    const t = tierOf(x.id), own = owns(P, x.id), free = !own && rot.includes(x.id);
    return h('button', { class: 'dcard scard' + (own ? ' owned' : '') + (free ? ' free' : ''), 'data-hero': x.id, style: { '--cc': CLANS[x.clan].color, '--tc': TIERS[t].color },
      onclick: () => { tap(); heroSheet(app, x.id, rerender); } },
      h('img', { src: face(x.id), alt: '' }), h('b', {}, x.name), h('small', {}, x.roles.map((q) => ROLE_LABEL[q]).join(' / ')),
      h('span', { class: 'sprice' }, own ? (isStarter(x.id) ? 'Starter' : 'Owned') : [coin(), fmt(priceOf(x.id))]),
      free ? h('span', { class: 'accb free', title: 'Free this week' }, 'FREE') : null, !own ? h('i', { class: 'stier', title: TIERS[t].name }) : null);
  };
  const head = h('div', { class: 'shophead' },
    h('div', { class: 'sbal' }, kobanAmount(K.bal, 'big'), h('small', { class: 'muted' }, kobanSignedIn() ? 'Synced with your account' : 'Offline ledger: it syncs once you are online')),
    h('div', { class: 'sranked' + (n >= RANKED_OWNED ? ' done' : '') }, h('small', {}, n >= RANKED_OWNED ? `Ranked unlocked · ${n} owned` : `Ranked: ${n}/${RANKED_OWNED} owned`),
      h('div', { class: 'pbar' }, h('i', { style: { width: Math.round(Math.min(1, n / RANKED_OWNED) * 100) + '%' } }))),
    h('button', { class: 'btn spick' + (picks ? ' on' : ''), disabled: !picks, title: picks ? 'Choose a free General' : `A free General every ${ECON.pickEvery} coach levels`,
      onclick: () => { tap(); if (generalsDone(P)) pickKoban(app, rerender); else redo({ tier: 'G', show: 'locked', role: 'all' }); } },
      picks ? `${picks} free pick${picks > 1 ? 's' : ''}` : nextPickLevel(P) ? `Free pick at coach Lv ${nextPickLevel(P)}` : 'All free picks used'));
  const rotRow = h('div', { class: 'srot' }, h('small', { class: 'muted' }, `Free this week · ${daysLeft()} left`),
    h('div', { class: 'srotl' }, ...rot.map((id) => h('button', { class: 'srh', title: `${HERO_BY_ID[id].name} (${TIERS[tierOf(id)].name})`, onclick: () => { tap(); heroSheet(app, id, rerender); } }, h('img', { src: face(id), alt: HERO_BY_ID[id].name })))));
  const filters = h('div', { class: 'dfilters sfilters' },
    h('div', { class: 'rtabs' }, ...['all', ...ROLES].map((r) => h('button', { class: 'rtab' + (st.role === r ? ' on' : ''), onclick: () => { tap(); redo({ role: r }); } }, r === 'all' ? 'All' : ROLE_LABEL[r]))),
    h('div', { class: 'rtabs' }, ...['all', ...TIER_ORDER].map((t) => h('button', { class: 'rtab' + (st.tier === t ? ' on' : ''), style: t !== 'all' ? { '--tc': TIERS[t].color } : null, onclick: () => { tap(); redo({ tier: t }); } }, t === 'all' ? 'Any tier' : `${TIERS[t].name} ${fmt(TIERS[t].price)}`))),
    h('div', { class: 'rtabs' }, ...[['all', 'All'], ['locked', 'Locked'], ['owned', 'Owned']].map(([k, l]) => h('button', { class: 'rtab' + (st.show === k ? ' on' : ''), onclick: () => { tap(); redo({ show: k }); } }, l))));
  const grid = list.length ? h('div', { class: 'dgrid sgrid' }, ...list.map(card)) : emptyState('assets/img/emote/doubt.png', 'Nothing here', st.show === 'locked' ? 'You own every champion that matches.' : 'Try another role or tier.');
  return h('div', { class: 'col shop' }, head, rotRow, filters, grid,
    h('small', { class: 'muted center' }, 'Koban buys champions only. Skins, banners and every other look stay earned in play.'));
}

// One champion: tier and why, price, Buy / Use free pick / Try it.
function heroSheet(app, id, rerender) {
  const P = profile, x = HERO_BY_ID[id], t = tierOf(id), own = owns(P, id), price = priceOf(id), K = kb(P);
  const picks = picksLeft(P), freePick = !own && t === 'G' && picks > 0, tryable = canTry(P, id), armed = K.trial === id;
  const close = () => m.remove();
  const diff = heroRatings(id).difficulty;
  const status = own ? (isStarter(id) ? 'Starter: yours from day one.' : 'Owned.') : inRotation(id) ? `Free to play this week (${daysLeft()} left).` : 'Locked.';
  const buy = h('button', { class: 'btn big sbuy', disabled: own || K.bal < price, onclick: () => confirmBuy(app, id, () => { close(); rerender(); }) },
    own ? 'Owned' : K.bal >= price ? ['Unlock for ', coin(), fmt(price)] : `Needs ${fmt(price - K.bal)} more Koban`);
  const m = h('div', { class: 'modal', onclick: (e) => { if (e.target === m) close(); } },
    h('div', { class: 'panel mpanel ssheet', style: { '--tc': TIERS[t].color } },
      h('div', { class: 'mhead' }, h('b', {}, x.name), h('button', { class: 'x', onclick: close, 'aria-label': 'Close' }, 'X')),
      h('div', { class: 'sshead' }, h('img', { class: 'ssface', src: face(id), alt: '' }),
        h('div', { class: 'col', style: { gap: '3px', minWidth: 0 } }, h('div', { class: 'gold' }, x.title), h('div', { class: 'muted small' }, `${x.roles.map((r) => ROLE_LABEL[r]).join(' / ')} · ${CLANS[x.clan].name} · Difficulty ${diff}`),
          h('div', { class: 'chips' }, tierChip(t), h('span', { class: 'chipx plain' }, status)))),
      h('small', { class: 'muted' }, TIERS[t].desc),
      h('div', { class: 'col', style: { gap: '6px' } },
        own ? null : buy,
        freePick ? h('button', { class: 'btn big', onclick: async () => { const err = await useFreePick(P, id); if (err) { toast(err, 2600); return; } audio.sfx('powerup', 0.7); toast(`${x.name} unlocked with a free pick!`, 2200); close(); rerender(); } }, 'Use a free pick') : null,
        tryable ? h('button', { class: 'btn' + (armed ? ' on' : ''), title: 'One match against the AI with this champion', onclick: () => { close(); armTrial(P, id); toast(`Try it: ${x.name} is in your next match vs AI.`, 2400); app.startVsAI('classic'); } }, armed ? 'Try it armed: play vs AI' : 'Try it vs AI (one match)') : null,
        !own && !tryable ? h('small', { class: 'muted center' }, 'Already tried: unlock it to play again.') : null,
        h('button', { class: 'linkbtn', onclick: async () => { close(); const { showDojo } = await import('./dojo.js'); showDojo(app, { tab: 'heroes', hero: id }); } }, 'Abilities and matchups'))));
  document.body.append(m);
}
function confirmBuy(app, id, done) {
  const x = HERO_BY_ID[id], price = priceOf(id), K = kb(profile);
  const close = () => m.remove();
  let busy = false;
  const go = async (e) => {
    if (busy) return; busy = true; e.target.disabled = true;
    const err = await buyChampion(profile, id);
    close();
    if (err) { toast(err, 2800); return; }
    audio.sfx('powerup', 0.8); toast(`${x.name} unlocked!`, 2200); done();
  };
  const m = h('div', { class: 'modal', onclick: (e) => { if (e.target === m) close(); } },
    h('div', { class: 'panel mpanel sconfirm' }, h('div', { class: 'mhead' }, h('b', {}, `Unlock ${x.name}?`), h('button', { class: 'x', onclick: close, 'aria-label': 'Close' }, 'X')),
      h('div', { class: 'row', style: { gap: '10px', alignItems: 'center' } }, h('img', { src: face(id), class: 'scf', alt: '' }),
        h('div', { class: 'col', style: { gap: '2px' } }, h('span', {}, 'Price ', kobanAmount(price)), h('small', { class: 'muted' }, `Balance after: ${fmt(K.bal - price)}`))),
      h('div', { class: 'row', style: { gap: '8px', justifyContent: 'flex-end' } }, h('button', { class: 'btn', onclick: close }, 'Cancel'), h('button', { class: 'btn big', onclick: go }, 'Unlock'))));
  document.body.append(m);
}
// Every General owned: a free pick pays Koban instead.
async function pickKoban(app, rerender) {
  const err = await useFreePick(profile, null);
  if (err) { toast(err, 2600); return; }
  audio.sfx('powerup', 0.7); toast(`Every General is yours: the free pick paid ${fmt(ECON.pickKoban)} Koban.`, 2600); rerender();
}
export { syncKoban };
