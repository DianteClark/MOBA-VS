// Dojo: browse the roster (hero pages with ratings, abilities, matchups, skins) and edit lineup presets.
import { h, mount, face, icon, toast } from './dom.js';
import { HEROES, HERO_BY_ID, ROLES, ROLE_LABEL, PERSONALITIES } from '../data/heroes.js';
import { CLANS } from '../sim/constants.js';
import { BUILDS } from '../data/items.js';
import { TACTICS, TACTIC_IDS } from '../data/tactics.js';
import { SKINS, TRACK } from '../data/seasons.js';
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
import { SEASON_REWARDS, tierById } from '../data/ranks.js';

const screen = () => document.getElementById('screen');
const tap = () => audio.sfx('move', 0.4);
const CURVE = { early: 'Strong early', mid: 'Mid-game peak', late: 'Scales late' };
let state = { tab: 'heroes', role: 'all', clan: 'all', hero: null, slot: 0 };

export function showDojo(app, patch = {}) {
  state = { ...state, ...patch };
  stopParade();
  if (patch.tab === 'lineups' && patch.slot === undefined) state.slot = Math.max(0, profile.d.presets.active);
  const prevScroll = screen().scrollTop;
  const body = state.tab === 'lineups' ? lineups(app) : state.tab === 'builds' ? buildGuide((id) => { tap(); showDojo(app, { tab: 'heroes', hero: id }); }) : state.hero ? heroPage(app, state.hero) : heroList(app);
  const head = h('div', { class: 'shead dojohead' },
    h('button', { class: 'btn backbtn', onclick: () => { tap(); if (state.hero && state.tab === 'heroes') showDojo(app, { hero: null }); else app.menu(); } }, state.hero && state.tab === 'heroes' ? '‹ Heroes' : '‹ Back'),
    h('div', { class: 'dojotabs' }, ...[['heroes', 'Heroes'], ['builds', 'Builds'], ['lineups', 'Lineups']].map(([k, l]) => h('button', { class: 'chip' + (state.tab === k ? ' on' : ''), onclick: () => { tap(); showDojo(app, { tab: k }); } }, l))),
    h('h2', {}, 'Dojo'));
  mount(screen(), h('div', { class: 'subscreen dojo' }, head, body));
  if (patch.keepScroll) screen().scrollTop = prevScroll; else screen().scrollTop = 0;
}

// ───────────── roster ─────────────
function record(id) { const r = profile.d.heroStats[id]; return r && r.g ? r : null; }
function heroList(app) {
  const lineup = profile.activePreset;
  const list = HEROES.filter((x) => (state.role === 'all' || x.roles.includes(state.role)) && (state.clan === 'all' || x.clan === state.clan))
    .sort((a, b) => (state.role === 'all' ? 0 : (a.role === state.role ? 0 : 1) - (b.role === state.role ? 0 : 1)));
  return h('div', { class: 'col' },
    h('div', { class: 'dfilters' },
      h('div', { class: 'rtabs' }, ...['all', ...ROLES].map((r) => h('button', { class: 'rtab' + (state.role === r ? ' on' : ''), onclick: () => { tap(); showDojo(app, { role: r }); } }, r === 'all' ? 'All' : ROLE_LABEL[r]))),
      h('div', { class: 'clanf' }, h('button', { class: 'cf' + (state.clan === 'all' ? ' on' : ''), onclick: () => showDojo(app, { clan: 'all' }) }, 'All clans'),
        ...Object.entries(CLANS).map(([k, c]) => h('button', { class: 'cf' + (state.clan === k ? ' on' : ''), style: { '--cc': c.color }, onclick: () => { tap(); showDojo(app, { clan: k }); } }, c.name)))),
    h('div', { class: 'dgrid' }, ...list.map((x) => {
      const r = record(x.id), mine = presetRole(lineup, x.id);
      return h('button', { class: 'dcard', style: { '--cc': CLANS[x.clan].color }, onclick: () => { tap(); showDojo(app, { hero: x.id }); } },
        h('img', { src: face(x.id) }), h('b', {}, x.name), h('small', {}, x.roles.map((q) => ROLE_LABEL[q]).join(' / ')),
        masteryBadge(profile.mastery(x.id).lv), r ? h('span', { class: 'drec' }, `${r.w}-${r.g - r.w}`) : null, mine ? h('span', { class: 'mine', title: 'In your active lineup' }, '★') : null);
    })),
    list.length ? null : h('p', { class: 'muted center' }, 'No heroes match these filters.'));
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
  const skins = h('div', { class: 'dskins' }, ...Object.entries(SKINS).map(([k, sk]) => {
    const have = profile.hasSkin(id, k), lvl = Object.entries(TRACK).find(([, rw]) => rw.kind === 'skin' && rw.id === k);
    const rank = Object.entries(SEASON_REWARDS).find(([, list]) => list.some((rw) => rw.kind === 'skin' && rw.id === k));
    const how = sk.mastery ? `${x.name} Mastery ${sk.mastery}` : rank ? `${tierById(rank[0]).name} season reward` : `Season Pass level ${lvl ? lvl[0] : '?'}`;
    const short = sk.mastery ? `M${sk.mastery}` : rank ? tierById(rank[0]).name : `Lv ${lvl ? lvl[0] : '?'}`;
    return h('button', { class: 'skinopt' + (equipped === k ? ' on' : '') + (have ? '' : ' locked'), title: sk.name,
      onclick: () => {
        sprite.skin = k;
        if (!have) { toast(`${sk.name}: unlocks with ${how}`); return; }
        profile.equipSkin(id, k); audio.sfx('accept', 0.5); showDojo(app, { keepScroll: true });
      } },
      heroStill(id, k, 40), h('b', {}, sk.name), h('small', {}, have ? (equipped === k ? 'Equipped' : 'Equip') : short));
  }));
  return h('div', { class: 'dhero', style: { '--cc': clan.color } },
    h('div', { class: 'dh-left' },
      h('div', { class: 'stage' }, h('button', { class: 'navb', title: 'Previous hero', onclick: () => showDojo(app, { hero: step(-1) }) }, '‹'), sprite,
        h('button', { class: 'navb', title: 'Next hero', onclick: () => showDojo(app, { hero: step(1) }) }, '›')),
      animBtns,
      h('div', { class: 'dh-name' }, h('h2', {}, x.name), h('div', { class: 'muted' }, x.title)),
      h('div', { class: 'chips' }, h('span', { class: 'chipx', style: { '--cc': clan.color }, title: clan.tiers.map((q) => `${q.n}+: ${q.text}`).join(' · ') }, clan.name),
        h('span', { class: 'chipx', style: { '--cc': pers.color } }, pers.name)),
      h('div', { class: 'chips' }, h('span', { class: 'chipx plain' }, ROLE_LABEL[x.role] + (x.flex.length ? ' · flex ' + x.flex.map((q) => ROLE_LABEL[q]).join('/') : '')),
        h('span', { class: 'chipx plain' }, x.ranged ? 'Ranged' : 'Melee'), h('span', { class: 'chipx plain' }, CURVE[x.curve])),
      h('div', { class: 'pers small' }, h('span', { style: { color: pers.color } }, pers.name + ': '), h('span', { class: 'muted' }, pers.desc)),
      h('div', { class: 'drecord' }, r ? [h('b', {}, `${r.w}W ${r.g - r.w}L`), h('span', {}, `${Math.round(r.w / r.g * 100)}% win rate in ${r.g} match${r.g > 1 ? 'es' : ''}`)] : h('span', { class: 'muted' }, 'You haven\'t played this hero yet.'))),
    h('div', { class: 'dh-right' },
      h('div', { class: 'dsec' }, h('div', { class: 'dsh' }, 'Ratings'), statBars(id)),
      h('div', { class: 'dsec' }, h('div', { class: 'dsh' }, 'Abilities'),
        h('div', { class: 'dab' }, h('img', { src: icon('LuckUpgrade') }), h('div', {}, h('b', {}, x.passive.name, h('small', {}, 'Passive')), h('p', {}, x.passive.desc))),
        ...x.abilities.map((a) => { const t = abilitySentence(a, x); return h('div', { class: 'dab' + (a.ult ? ' ult' : '') }, h('img', { src: icon(a.icon) }),
          h('div', {}, h('b', {}, a.name, h('small', {}, a.ult ? 'Ultimate · level 5' : t.meta.split(' · ')[0])), h('p', {}, t.text), h('div', { class: 'meta' }, t.meta))); })),
      h('div', { class: 'dsec mus' },
        h('div', {}, h('div', { class: 'dsh pos' }, 'Strong vs'), ...(mu.strong.length ? mu.strong.map(muRow) : [h('small', { class: 'muted' }, 'No clear edge')])),
        h('div', {}, h('div', { class: 'dsh neg' }, 'Weak vs'), ...(mu.weak.length ? mu.weak.map(muRow) : [h('small', { class: 'muted' }, 'No hard counters')]))),
      h('div', { class: 'dsec' }, h('div', { class: 'dsh' }, 'Builds'), h('div', { class: 'chips' }, ...x.builds.map((b) => h('span', { class: 'chipx', style: { '--cc': BUILDS[b].color }, title: buildLine(b), 'data-build': b, 'data-build-info': true }, BUILDS[b].name + (b === x.rec ? ' ★' : ''))))),
      duoSection(id, (pid) => { tap(); showDojo(app, { hero: pid }); }),
      masteryPanel(id),
      h('div', { class: 'dsec' }, h('div', { class: 'dsh' }, 'Skins'), skins, h('small', { class: 'muted' }, 'Skins show on this hero in every match. Online, your opponent sees them too.'))));
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
      id ? h('img', { src: face(id) }) : h('span', { class: 'plus' }, '+'), h('span', { class: 'ln' }, id ? HERO_BY_ID[id].name : kind === 'main' ? 'Choose' : 'Backup'));
  };
  const buildChips = (id) => id ? h('div', { class: 'lbuilds' }, ...HERO_BY_ID[id].builds.map((b) => h('button', { class: 'bchip' + (p.builds[id] === b ? ' on' : ''), style: { '--bc': BUILDS[b].color }, title: buildLine(b), 'data-build': b,
    onclick: () => { tap(); p.builds[id] = b; save(app, p); } }, BUILDS[b].name))) : h('div', { class: 'lbuilds' });
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
        h('div', { class: 'lplan' }, h('div', { class: 'dsh' }, 'Team plan'), h('div', { class: 'seg3' }, ...Object.entries(PLANS).map(([k, [nm, dsc]]) => h('button', { class: 'chip' + (p.plan === k ? ' on' : ''), title: dsc, onclick: () => { tap(); p.plan = k; save(app, p); } }, nm)))),
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
  const list = HEROES.filter((x) => x.roles.includes(role)).sort((a, b) => (a.role === role ? 0 : 1) - (b.role === role ? 0 : 1));
  let close = null;
  const choose = (id) => {
    if (id) p.builds[id] = p.builds[id] || HERO_BY_ID[id].rec;
    p[kind][role] = id; close(); save(app, p);
  };
  close = modal(`${ROLE_LABEL[role]} · ${kind === 'main' ? 'main pick' : 'backup'}`,
    h('div', { class: 'pgrid' }, ...list.map((x) => {
      const used = usedAt[x.id];
      return h('button', { class: 'dcard' + (here === x.id ? ' sel' : ''), disabled: !!used, style: { '--cc': CLANS[x.clan].color }, onclick: () => choose(x.id) },
        h('img', { src: face(x.id) }), h('b', {}, x.name), h('small', {}, used ? `in ${used}` : x.role === role ? ROLE_LABEL[role] : 'flex'));
    })),
    here ? h('button', { class: 'btn', onclick: () => choose(null) }, 'Remove ' + HERO_BY_ID[here].name) : null);
}
function pickCards(app) {
  const p = cur();
  let close = null;
  const grid = h('div', { class: 'deck' });
  const draw = () => mount(grid, ...TACTIC_IDS.map((id) => {
    const t = TACTICS[id], on = p.deck.includes(id);
    return h('button', { class: 'card' + (on ? ' sel' : ''), onclick: () => { if (on) p.deck = p.deck.filter((d) => d !== id); else p.deck = [...p.deck.slice(p.deck.length >= 3 ? 1 : 0), id]; tap(); draw(); count.textContent = `${p.deck.length}/3`; } },
      h('img', { src: icon(t.icon) }), h('div', { class: 'cn' }, t.name), h('div', { class: 'cd' }, t.desc), on ? h('i', { class: 'tick' }) : null);
  }));
  const count = h('span', { class: 'dcount' }, `${p.deck.length}/3`);
  draw();
  close = modal('Tactic cards', h('div', { class: 'row', style: { justifyContent: 'space-between' } }, h('small', { class: 'muted' }, 'Pick 3. Each can be played once per match.'), count), grid,
    h('button', { class: 'btn big', onclick: () => { close(); save(app, p); } }, 'Done'));
}
