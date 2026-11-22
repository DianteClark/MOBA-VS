// Dojo: browse the roster (hero pages with ratings, abilities, matchups, skins) and edit lineup presets.
import { shopTab, accessBadge, openShop, kobanAmount } from './shop.js';
import { TIERS, tierOf, priceOf, isStarter } from '../data/unlocks.js';
import { owns, inRotation } from '../unlocks.js';
import { h, mount, face, icon, emptyState } from './dom.js';
import { HEROES, HERO_BY_ID, ROLES, ROLE_LABEL, PERSONALITIES } from '../data/heroes.js';
import { CLANS } from '../sim/constants.js';
import { BUILDS } from '../data/items.js';
import { TACTICS } from '../data/tactics.js';
import { deckPicker, cardList } from './deckpick.js';
import { SKINS } from '../data/seasons.js';
import { skinViewer, heroSkinKeys } from './collection.js';
import { matchups } from '../data/herostats.js';
import { PLANS, presetIssues, presetRole, newPreset } from '../presets.js';
import { profile } from '../profile.js';
import { abilitySentence } from './herotext.js';
import { statBars, heroSprite, heroStill } from './heroui.js';
import { audio } from '../audio.js';
import { stopParade } from './screens.js';
import { buildGuide, buildLine } from './buildguide.js';
import { masteryPanel } from './mastery.js';
import { masteryBadge } from './badges.js';
import { duoSection } from './comp.js';
import { searchBox, applySearch } from './herosearch.js';
import { talentList, talentPicker, talentSummary } from './talentui.js';
import { heroPrefs, setHeroPref } from '../talentprefs.js';
import { feudsOf } from '../data/feuds.js';
import { lorePanel } from './lore.js';
import { HEARTH_TEXT } from '../data/hearth.js';

const screen = () => document.getElementById('screen');
const tap = () => audio.sfx('move', 0.4);
const CURVE = { early: 'Strong early', mid: 'Mid-game peak', late: 'Scales late' };
let state = { tab: 'heroes', role: 'all', clan: 'all', q: '', hero: null, slot: 0, page: 'info' };

export function showDojo(app, patch = {}) {
  state = { ...state, ...patch };
  stopParade();
  if (patch.tab === 'lineups' && patch.slot === undefined) state.slot = Math.max(0, profile.d.presets.active);
  const prevScroll = screen().scrollTop;
  const body = state.tab === 'shop' ? shopTab(app, () => showDojo(app, { keepScroll: true })) : state.tab === 'lineups' ? lineups(app) : state.tab === 'builds' ? buildGuide((id) => { tap(); showDojo(app, { tab: 'heroes', hero: id }); }) : state.tab === 'cards' ? cardList() : state.hero ? heroPage(app, state.hero) : heroList(app);
  const head = h('div', { class: 'shead dojohead' + (app.dojoReturn ? ' ret' : '') },
    h('button', { class: 'btn backbtn', onclick: () => { tap(); if (state.hero && state.tab === 'heroes') showDojo(app, { hero: null }); else app.menu(); } }, state.hero && state.tab === 'heroes' ? '‹ Heroes' : '‹ Back'),
    // opened from the ready check (src/ui/readycheck.js): straight back into the match start
    h('div', { class: 'dojotabs' }, ...[['heroes', 'Heroes'], ['builds', 'Builds'], ['cards', 'Cards'], ['lineups', 'Lineups'], ['shop', 'Shop']].map(([k, l]) => h('button', { class: 'chip' + (state.tab === k ? ' on' : ''), onclick: () => { tap(); showDojo(app, { tab: k }); } }, l))),
    app.dojoReturn ? h('button', { class: 'btn dojoret', onclick: () => { const r = app.dojoReturn; app.dojoReturn = null; audio.sfx('accept', 0.6); r.go(); } }, `${app.dojoReturn.label} ›`) : h('h2', {}, 'Dojo'));
  mount(screen(), h('div', { class: 'subscreen dojo', 'data-view': 'dojo:' + state.tab + ':' + (state.tab === 'heroes' && state.hero ? 'hero' : '') }, head, body));
  if (patch.keepScroll) screen().scrollTop = prevScroll; else screen().scrollTop = 0;
}

// ───────────── roster ─────────────
function record(id) { const r = profile.d.heroStats[id]; return r && r.g ? r : null; }
function heroList(app) {
  const lineup = profile.activePreset;
  const list = HEROES.filter((x) => (state.role === 'all' || x.roles.includes(state.role)) && (state.clan === 'all' || x.clan === state.clan))
    .sort((a, b) => (state.role === 'all' ? ROLES.indexOf(a.role) - ROLES.indexOf(b.role) : (a.role === state.role ? 0 : 1) - (b.role === state.role ? 0 : 1)));
  const grid = h('div', { class: 'dgrid' }, ...list.map((x) => {
    const r = record(x.id), mine = presetRole(lineup, x.id), have = owns(profile, x.id), free = !have && inRotation(x.id);
    return h('button', { class: 'dcard' + (have ? '' : ' dlock'), 'data-hero': x.id, style: { '--cc': CLANS[x.clan].color }, onclick: () => { tap(); showDojo(app, { hero: x.id }); } },
      h('img', { src: face(x.id) }), h('b', {}, x.name), h('small', {}, x.roles.map((q) => ROLE_LABEL[q]).join(' / ')),
      masteryBadge(profile.mastery(x.id).lv), r ? h('span', { class: 'drec' }, `${r.w}-${r.g - r.w}`) : null, mine ? h('span', { class: 'mine', title: 'In your active lineup' }, '★') : null,
      have ? null : accessBadge(free ? 'free' : null));
  }));
  const none = emptyState('assets/img/emote/doubt.png', 'No heroes match', 'Try another role, clan or search.');
  const filter = () => { none.classList.toggle('hidden', applySearch(grid, (id) => HERO_BY_ID[id], state.q) > 0); };
  const out = h('div', { class: 'col' },
    h('div', { class: 'dfilters' },
      h('div', { class: 'rtabs' }, ...['all', ...ROLES].map((r) => h('button', { class: 'rtab' + (state.role === r ? ' on' : ''), onclick: () => { tap(); showDojo(app, { role: r }); } }, r === 'all' ? 'All' : ROLE_LABEL[r])),
        searchBox(state.q, (q) => { state.q = q; filter(); })),
      h('div', { class: 'clanf' }, h('button', { class: 'cf' + (state.clan === 'all' ? ' on' : ''), onclick: () => showDojo(app, { clan: 'all' }) }, 'All clans'),
        ...Object.entries(CLANS).map(([k, c]) => h('button', { class: 'cf' + (state.clan === k ? ' on' : ''), style: { '--cc': c.color }, onclick: () => { tap(); showDojo(app, { clan: k }); } }, c.name)))),
    grid, none);
  filter();
  return out;
}

// Champion ownership on the hero page: owned, free this week, or its tier and price with a way to the Shop.
function ownLine(app, id) {
  const t = TIERS[tierOf(id)];
  if (owns(profile, id)) return h('div', { class: 'downl' }, h('span', { class: 'tierc', style: { '--tc': t.color } }, t.name), h('small', { class: 'muted' }, isStarter(id) ? 'Starter' : 'Owned'));
  return h('button', { class: 'chip downl', title: 'Champions shop', onclick: () => { tap(); openShop(app); } }, h('span', { class: 'tierc', style: { '--tc': t.color } }, t.name),
    inRotation(id) ? h('small', {}, 'Free this week · ') : null, kobanAmount(priceOf(id)), h('small', {}, ' Unlock ›'));
}
// ───────────── hero page ─────────────
function heroPage(app, id) {
  const x = HERO_BY_ID[id], pers = PERSONALITIES[x.pers], clan = CLANS[x.clan];
  const equipped = profile.d.equip.skins[id] || 'base';
  const sprite = heroSprite(id, equipped, 112, 'walk');
  const idx = HEROES.indexOf(x), step = (k) => HEROES[(idx + k + HEROES.length) % HEROES.length].id;
  const r = record(id), mu = matchups(id);
  const animBtns = h('div', { class: 'animbtns' }, ...[['idle', 'Idle'], ['walk', 'Walk'], ['attack', 'Attack']].map(([k, l]) => h('button', { class: 'chip' + (k === 'walk' ? ' on' : ''),
    onclick: (e) => { sprite.anim = k; for (const b of e.target.parentNode.children) b.classList.toggle('on', b === e.target); } }, l)));
  const muRow = (q) => h('button', { class: 'murow', onclick: () => { tap(); showDojo(app, { hero: q.id }); } }, h('img', { src: face(q.id) }), h('b', {}, HERO_BY_ID[q.id].name), h('small', {}, q.note));
  // Skins: the hero's own (Signature, Legendary) and owned palette tints; tap for the skin viewer
  const viewer = (k) => { tap(); skinViewer(id, () => showDojo(app, { keepScroll: true }), k); };
  const skins = h('div', { class: 'dskins' }, ...heroSkinKeys(id).filter((k) => SKINS[k].hero || k === 'base' || profile.hasSkin(id, k)).map((k) => {
    const sk = SKINS[k], have = profile.hasSkin(id, k);
    return h('button', { class: 'skinopt' + (equipped === k ? ' on' : '') + (have ? '' : ' locked') + (sk.hero ? ' t-' + sk.tier : ''), title: k === 'base' ? 'Classic' : sk.name,
      onmouseenter: () => { sprite.skin = k; }, onmouseleave: () => { sprite.skin = equipped; }, onclick: () => viewer(k) },
      heroStill(id, k, 40), h('b', {}, k === 'base' ? 'Classic' : sk.hero ? (sk.tier === 'legendary' ? 'Legendary' : 'Signature') : sk.name),
      h('small', {}, equipped === k ? 'Equipped' : have ? 'Owned' : sk.mastery ? `M${sk.mastery}` : 'Locked'));
  }));
  const go = (pid) => { tap(); showDojo(app, { hero: pid }); };
  // v24: Overview / Lore pages on the right column (the left column with the sprite stays)
  const pageTabs = h('div', { class: 'dpages', role: 'tablist' }, ...[['info', 'Overview'], ['lore', 'Lore']].map(([k, l]) => h('button', { class: 'chip' + (state.page === k ? ' on' : ''), role: 'tab', 'aria-selected': String(state.page === k),
    onclick: () => { tap(); showDojo(app, { page: k, keepScroll: true }); } }, l)));
  const hearthSec = x.clan === 'hearth' ? h('div', { class: 'dsec hearthrules' }, h('div', { class: 'dsh', style: { color: clan.color } }, HEARTH_TEXT.name, h('small', { class: 'muted' }, ' clan mechanic')),
    ...HEARTH_TEXT.rules.map((t) => h('div', { class: 'small' }, t))) : null;
  return h('div', { class: 'dhero', style: { '--cc': clan.color } },
    h('div', { class: 'dh-left' },
      h('div', { class: 'stage' }, h('button', { class: 'navb', title: 'Previous hero', onclick: () => showDojo(app, { hero: step(-1) }) }, '‹'), sprite,
        h('button', { class: 'navb', title: 'Next hero', onclick: () => showDojo(app, { hero: step(1) }) }, '›')),
      animBtns,
      h('button', { class: 'chip dskinbtn', title: 'Preview and equip this hero\'s skins', onclick: () => viewer(equipped) }, `Skins ${heroSkinKeys(id).filter((k) => profile.hasSkin(id, k)).length}/${heroSkinKeys(id).length} ›`),
      h('div', { class: 'dh-name' }, h('h2', {}, x.name), h('div', { class: 'muted' }, x.title)),
      ownLine(app, id),
      x.lore ? h('p', { class: 'muted small' }, x.lore) : null,
      h('div', { class: 'chips' }, h('span', { class: 'chipx', style: { '--cc': clan.color }, title: clan.tiers.map((q) => `${q.n}+: ${q.text}`).join(' · ') }, clan.name),
        h('span', { class: 'chipx', style: { '--cc': pers.color } }, pers.name)),
      h('div', { class: 'chips' }, h('span', { class: 'chipx plain' }, ROLE_LABEL[x.role] + (x.flex.length ? ' · flex ' + x.flex.map((q) => ROLE_LABEL[q]).join('/') : '')),
        h('span', { class: 'chipx plain' }, x.ranged ? 'Ranged' : 'Melee'), h('span', { class: 'chipx plain' }, CURVE[x.curve])),
      h('div', { class: 'pers small' }, h('span', { style: { color: pers.color } }, pers.name + ': '), h('span', { class: 'muted' }, pers.desc)),
      h('div', { class: 'drecord' }, r ? [h('b', {}, `${r.w}W ${r.g - r.w}L`), h('span', {}, `${Math.round(r.w / r.g * 100)}% win rate in ${r.g} match${r.g > 1 ? 'es' : ''}`)] : h('span', { class: 'muted' }, 'You haven\'t played this hero yet.'))),
    state.page === 'lore' ? h('div', { class: 'dh-right' }, pageTabs, lorePanel(id, go)) : h('div', { class: 'dh-right' }, pageTabs,
      h('div', { class: 'dsec' }, h('div', { class: 'dsh' }, 'Ratings'), statBars(id)),
      h('div', { class: 'dsec' }, h('div', { class: 'dsh' }, 'Abilities'),
        h('div', { class: 'dab' }, h('img', { src: icon('LuckUpgrade') }), h('div', {}, h('b', {}, x.passive.name, h('small', {}, 'Passive')), h('p', {}, x.passive.desc))),
        ...x.abilities.map((a) => { const t = abilitySentence(a, x); return h('div', { class: 'dab' + (a.ult ? ' ult' : '') }, h('img', { src: icon(a.icon) }),
          h('div', {}, h('b', {}, a.name, h('small', {}, a.ult ? 'Ultimate · level 5' : t.meta.split(' · ')[0])), h('p', {}, t.text), h('div', { class: 'meta' }, t.meta))); })),
      hearthSec,
      h('div', { class: 'dsec mus' },
        h('div', {}, h('div', { class: 'dsh pos' }, 'Strong vs'), ...(mu.strong.length ? mu.strong.map(muRow) : [h('small', { class: 'muted' }, 'No clear edge')])),
        h('div', {}, h('div', { class: 'dsh neg' }, 'Weak vs'), ...(mu.weak.length ? mu.weak.map(muRow) : [h('small', { class: 'muted' }, 'No hard counters')]))),
      h('div', { class: 'dsec' }, h('div', { class: 'dsh' }, 'Builds'), h('div', { class: 'chips' }, ...x.builds.map((b) => h('span', { class: 'chipx', style: { '--cc': BUILDS[b].color }, title: buildLine(b), 'data-build': b, 'data-build-info': true }, BUILDS[b].name + (b === x.rec ? ' ★' : ''))))),
      h('div', { class: 'dsec' }, h('div', { class: 'dsh' }, 'Talents ', h('small', { class: 'muted' }, 'levels 4 · 8 · 12 · tap one to make it your default')),
        talentList(id, heroPrefs(id), (i, k) => { setHeroPref(id, i, k); showDojo(app, { keepScroll: true }); })),
      duoSection(id, (pid) => { tap(); showDojo(app, { hero: pid }); }),
      feudsOf(id).length ? h('div', { class: 'dsec' }, h('div', { class: 'dsh' }, 'Rivals'), ...feudsOf(id).map((q) => h('button', { class: 'murow', onclick: () => { tap(); showDojo(app, { hero: q.id }); } },
        h('img', { src: face(q.id) }), h('b', {}, HERO_BY_ID[q.id].name), h('small', {}, `"${q.line}"`)))) : null,
      masteryPanel(id),
      h('div', { class: 'dsec' }, h('div', { class: 'dsh row', style: { justifyContent: 'space-between' } }, 'Skins', h('button', { class: 'chip', onclick: () => viewer(equipped) }, 'Skin viewer')), skins,
        h('small', { class: 'muted' }, 'Skins change only the look: same hitbox, same effects. They show in every match, and online your opponent sees them too.'))));
}

// ───────────── lineups ─────────────
const cur = () => JSON.parse(JSON.stringify(profile.d.presets.slots[state.slot]));
function save(app, p) { profile.savePreset(state.slot, p); showDojo(app, { keepScroll: true }); }

function lineups(app) {
  const P = profile.d.presets, p = cur(), issues = presetIssues(p);
  const slotTabs = h('div', { class: 'lslots' }, ...P.slots.map((q, i) => h('button', { class: 'lslot' + (i === state.slot ? ' on' : '') + (P.active === i ? ' active' : ''), onclick: () => { tap(); showDojo(app, { slot: i }); } },
    h('b', {}, P.active === i ? '★ ' : '', q.name), h('span', { class: 'lfaces' }, ...ROLES.map((r) => q.main[r] ? h('img', { src: face(q.main[r]) }) : h('i'))))));
  const isActive = P.active === state.slot;
  const heroBtn = (role, kind) => {
    const id = p[kind][role];
    return h('button', { class: 'lhero' + (id ? '' : ' empty') + (kind === 'backup' ? ' bk' : ''), onclick: () => { tap(); pickHero(app, role, kind); } },
      id ? h('img', { src: face(id) }) : h('span', { class: 'plus' }, '+'), h('span', { class: 'ln' }, id ? HERO_BY_ID[id].name : kind === 'main' ? 'Choose' : 'Backup'),
      id && !owns(profile, id) ? accessBadge(inRotation(id) ? 'free' : null) : null,
      id && !HERO_BY_ID[id].roles.includes(role) ? h('span', { class: 'offr', title: `Off-role: ${HERO_BY_ID[id].name} usually plays ${HERO_BY_ID[id].roles.map((r) => ROLE_LABEL[r]).join(' / ')}` }, 'OFF') : null);
  };
  const buildChips = (id) => id ? h('div', { class: 'lbuilds' }, ...HERO_BY_ID[id].builds.map((b) => h('button', { class: 'bchip' + (p.builds[id] === b ? ' on' : ''), style: { '--bc': BUILDS[b].color }, title: buildLine(b), 'data-build': b,
    onclick: () => { tap(); p.builds[id] = b; save(app, p); } }, BUILDS[b].name)),
    h('button', { class: 'ltal', title: 'Talent defaults (levels 4, 8, 12)', onclick: () => { tap(); pickTalents(app, id); } }, talentSummary(id, heroPrefs(id)))) : h('div', { class: 'lbuilds' });
  const rows = ROLES.map((role) => h('div', { class: 'lrow2' },
    h('span', { class: 'lrole' }, ROLE_LABEL[role]),
    h('div', { class: 'lcell' }, heroBtn(role, 'main'), buildChips(p.main[role])),
    h('div', { class: 'lcell' }, heroBtn(role, 'backup'), buildChips(p.backup[role]))));
  return h('div', { class: 'col lineups' },
    slotTabs,
    h('div', { class: 'panel leditor' },
      h('div', { class: 'lhead' },
        h('input', { class: 'lname', value: p.name, maxlength: 16, 'aria-label': 'Lineup name', onchange: (e) => { p.name = e.target.value.trim() || `Lineup ${state.slot + 1}`; save(app, p); } }),
        h('button', { class: 'btn' + (isActive ? ' on' : ''), onclick: () => { tap(); profile.setActivePreset(isActive ? -1 : state.slot); showDojo(app, { keepScroll: true }); } }, isActive ? '★ Active' : 'Use in draft'),
        h('button', { class: 'btn small', onclick: () => { if (confirm('Clear this lineup?')) { save(app, newPreset(`Lineup ${state.slot + 1}`)); } } }, 'Clear')),
      h('div', { class: 'muted small' }, isActive ? 'Your picks lock in automatically from this lineup (top to support). If a hero is banned or taken, the backup steps in.' : 'Make this lineup active to auto-pick it in the draft.'),
      h('div', { class: 'lgrid' }, h('div', { class: 'lrow2 lh' }, h('span'), h('small', {}, 'Main pick + build'), h('small', {}, 'Backup + build')), ...rows),
      h('div', { class: 'lbottom' },
        h('div', { class: 'lplan' }, h('div', { class: 'dsh' }, 'Team plan'), h('div', { class: 'seg3 segplan' }, ...Object.entries(PLANS).map(([k, [nm, dsc]]) => h('button', { class: 'chip' + (p.plan === k ? ' on' : ''), title: dsc, onclick: () => { tap(); p.plan = k; save(app, p); } }, nm)))),
        h('div', { class: 'ldeck' }, h('div', { class: 'dsh' }, 'Tactic cards'),
          h('button', { class: 'ldeckbtn', onclick: () => { tap(); pickCards(app); } }, ...p.deck.map((c) => h('span', { class: 'pdc' }, h('img', { src: icon(TACTICS[c].icon) }), TACTICS[c].name)), h('span', { class: 'chg' }, 'Change')))),
      issues.length ? h('div', { class: 'lissues' }, ...issues.map((t) => h('div', {}, t))) : null));
}

function modal(title, ...kids) {
  const close = () => m.remove();
  const m = h('div', { class: 'modal', onclick: (e) => { if (e.target === m) close(); } },
    h('div', { class: 'panel mpanel' }, h('div', { class: 'mhead' }, h('b', {}, title), h('button', { class: 'x', onclick: close }, 'X')), ...kids));
  document.body.append(m);
  return close;
}
function pickHero(app, role, kind) {
  const p = cur(), here = p[kind][role];
  const usedAt = {}; for (const k of ['main', 'backup']) for (const r of ROLES) if (p[k][r] && !(k === kind && r === role)) usedAt[p[k][r]] = `${ROLE_LABEL[r]}${k === 'backup' ? ' backup' : ''}`;
  // champion ownership: lineups hold heroes you own (or this week's free ones, which the draft skips once they rotate out).
  // The role's own heroes come first; then every other champion you have, to play this role off-role.
  const mayHave = (x) => owns(profile, x.id) || inRotation(x.id) || x.id === here;
  const list = HEROES.filter((x) => x.roles.includes(role) && mayHave(x)).sort((a, b) => (a.role === role ? 0 : 1) - (b.role === role ? 0 : 1));
  const others = HEROES.filter((x) => !x.roles.includes(role) && mayHave(x)).sort((a, b) => ROLES.indexOf(a.role) - ROLES.indexOf(b.role) || (a.name < b.name ? -1 : 1));
  let close = null;
  const choose = (id) => {
    if (id) p.builds[id] = p.builds[id] || HERO_BY_ID[id].rec;
    p[kind][role] = id; close(); save(app, p);
  };
  const card = (x, off) => {
    const used = usedAt[x.id];
    return h('button', { class: 'dcard' + (here === x.id ? ' sel' : ''), disabled: !!used, style: { '--cc': CLANS[x.clan].color }, onclick: () => choose(x.id) },
      h('img', { src: face(x.id) }), h('b', {}, x.name), h('small', {}, used ? `in ${used}` : off ? ROLE_LABEL[x.role] : x.role === role ? ROLE_LABEL[role] : 'flex'), owns(profile, x.id) ? null : accessBadge(inRotation(x.id) ? 'free' : null),
      off ? h('span', { class: 'offr', title: 'Off-role for ' + ROLE_LABEL[role] }, 'OFF') : null);
  };
  close = modal(`${ROLE_LABEL[role]} · ${kind === 'main' ? 'main pick' : 'backup'}`,
    h('div', { class: 'pgrid' }, ...list.map((x) => card(x, false)),
      others.length ? h('div', { class: 'pgall' }, `All champions: any of them can play ${ROLE_LABEL[role]} off-role`) : null, ...others.map((x) => card(x, true))),
    h('button', { class: 'linkbtn', onclick: () => { close(); openShop(app); } }, 'More champions in the Shop'),
    here ? h('button', { class: 'btn', onclick: () => choose(null) }, 'Remove ' + HERO_BY_ID[here].name) : null);
}
// Talent defaults for one hero (shared by every lineup and the hero page).
function pickTalents(app, id) {
  const box = h('div');
  const draw = () => mount(box, talentPicker(id, heroPrefs(id), (i, k) => { setHeroPref(id, i, k); draw(); }));
  draw();
  const close = modal(`${HERO_BY_ID[id].name} · talents`, h('small', { class: 'muted' }, 'Auto: the hero picks for the game it is having. You can still swap live in a match.'), box,
    h('button', { class: 'btn big', onclick: () => { close(); showDojo(app, { keepScroll: true }); } }, 'Done'));
}
function pickCards(app) {
  const p = cur();
  const count = h('span', { class: 'dcount' }, `${p.deck.length}/3`);
  const picker = deckPicker({ get: () => p.deck, set: (d) => { p.deck = d; }, plan: p.plan, onChange: () => { tap(); count.textContent = `${p.deck.length}/3`; } });
  const close = modal('Tactic cards', h('div', { class: 'row', style: { justifyContent: 'space-between' } }, h('small', { class: 'muted' }, 'Pick 3. Each can be played once per match.'), count), picker,
    h('button', { class: 'btn big', onclick: () => { close(); save(app, p); } }, 'Done'));
}
