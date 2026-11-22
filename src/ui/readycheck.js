// Ready check: before Find Match (any queue), vs AI and online rooms, a compact sheet shows the active Dojo
// lineup (heroes per role + backups, builds, plan, cards) and flags problems, with "Looks good" and "Edit in
// Dojo" (the Dojo then offers a button straight back into the match). "Don't ask again" turns it off;
// Settings > Match turns it back on.
import { h, face, icon } from './dom.js';
import { HERO_BY_ID, ROLES, ROLE_LABEL } from '../data/heroes.js';
import { BUILDS } from '../data/items.js';
import { TACTICS } from '../data/tactics.js';
import { PLANS, presetIssues } from '../presets.js';
import { EVENT_BY_ID } from '../data/events.js';
import { profile } from '../profile.js';
import { settings, setSetting } from './settings.js';
import { audio } from '../audio.js';
import { showDojo } from './dojo.js';

// What is wrong with a lineup: { bad: [text], warn: [text], roles: { role: 'bad' | 'warn' } }.
function lineupProblems(p) {
  const out = { bad: [], warn: [], roles: {} };
  if (!p) { out.warn.push('No active lineup: you will draft every pick yourself.'); return out; }
  for (const r of ROLES) for (const k of ['main', 'backup']) if (p[k][r] && !HERO_BY_ID[p[k][r]]) { out.bad.push(`${ROLE_LABEL[r]}: a hero that no longer exists`); out.roles[r] = 'bad'; }
  for (const t of presetIssues(p)) out.bad.push(t);
  for (const r of ROLES) if (!p.main[r]) out.roles[r] = 'bad';
  const noBackup = ROLES.filter((r) => p.main[r] && !p.backup[r]);
  if (noBackup.length) {
    out.warn.push(`No backup for ${noBackup.map((r) => ROLE_LABEL[r]).join(', ')}: if that hero is banned or taken, you pick yourself.`);
    for (const r of noBackup) out.roles[r] = out.roles[r] || 'warn';
  }
  return out;
}

// Show the check before `go` (a start that skips the check). Returns false when the check is off (start now).
//   label: the confirm button's verb ('Find match', 'Play', 'Host room', 'Join room'); queue/gameMode: for the
//   weekly event note (Mirror Match does not use lineups).
export function readyCheck(app, { label, go, queue, gameMode }) {
  if (!settings.readyCheck || document.querySelector('.rcmodal')) return !!document.querySelector('.rcmodal');
  const p = profile.activePreset, prob = lineupProblems(p);
  const evId = app.eventFor(gameMode || 'classic', queue || 'ai'), ev = evId && EVENT_BY_ID[evId];
  let dontAsk = false;
  const close = () => { wrap.remove(); document.removeEventListener('keydown', esc, true); };
  const esc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  const start = () => { if (dontAsk) setSetting('readyCheck', false); audio.sfx('accept', 0.6); close(); go(); };
  const edit = () => {
    if (dontAsk) setSetting('readyCheck', false);
    audio.sfx('move', 0.5); close();
    app.dojoReturn = { label, go }; // the Dojo shows "<label> ›" to come straight back
    showDojo(app, { tab: 'lineups', hero: null });
  };
  const hero = (id, cls) => id && HERO_BY_ID[id] ? h('span', { class: cls }, h('img', { src: face(id), alt: '' }), h('b', {}, HERO_BY_ID[id].name)) : h('span', { class: cls + ' none' }, h('i', {}, '?'), h('b', {}, cls === 'rcmain' ? 'Draft it' : 'No backup'));
  const col = (r) => {
    const id = p && p.main[r], b = id && HERO_BY_ID[id] && BUILDS[p.builds[id] || HERO_BY_ID[id].rec];
    return h('div', { class: 'rccol' + (prob.roles[r] ? ' ' + prob.roles[r] : '') },
      h('small', { class: 'rcrole' }, ROLE_LABEL[r]), hero(id, 'rcmain'),
      b ? h('span', { class: 'rcbuild', style: { '--bc': b.color } }, b.name) : h('span', { class: 'rcbuild empty' }, '-'),
      hero(p && p.backup[r], 'rcbk'));
  };
  const plan = p && PLANS[p.plan];
  const panel = h('div', { class: 'panel mpanel rcpanel', role: 'dialog', 'aria-label': 'Ready check' },
    h('div', { class: 'mhead' }, h('b', {}, 'Ready check'), h('small', { class: 'muted rcname' }, p ? `★ ${p.name}` : 'No lineup'), h('button', { class: 'x', title: 'Close', onclick: close }, 'X')),
    p ? h('div', { class: 'rccols' }, ...ROLES.map(col)) : null,
    p ? h('div', { class: 'rcmeta' }, h('span', { class: 'rcplan' }, 'Plan: ', h('b', {}, plan ? plan[0] : 'Auto')),
      h('span', { class: 'rcdeck' }, ...p.deck.map((c) => h('span', { class: 'pdc' }, h('img', { src: icon(TACTICS[c].icon), alt: '' }), TACTICS[c].name)))) : null,
    ev && ev.mirror ? h('div', { class: 'rcnote' }, `${ev.name} this week: both teams get the same heroes, and the same cards, so your lineup is not used.`) : null,
    prob.bad.length || prob.warn.length ? h('div', { class: 'rcissues' }, ...prob.bad.map((t) => h('div', { class: 'bad' }, t)), ...prob.warn.map((t) => h('div', { class: 'warn' }, t))) : null,
    h('div', { class: 'rcfoot' },
      h('label', { class: 'rcdont' }, h('input', { type: 'checkbox', onchange: (e) => { dontAsk = e.target.checked; } }), "Don't ask again"),
      h('button', { class: 'btn', onclick: edit }, 'Edit in Dojo'),
      h('button', { class: 'btn big rcgo', onclick: start }, prob.bad.length ? `${label} anyway` : `Looks good, ${label.toLowerCase()}`)));
  const wrap = h('div', { class: 'modal rcmodal', onpointerdown: (e) => { if (e.target === wrap) close(); } }, panel);
  document.body.append(wrap);
  document.addEventListener('keydown', esc, true);
  return true;
}
