// Hero search for the draft grid and the Dojo roster: type a name, title, clan, role, personality or tag
// ("tank", "dive", "shinobi", "support"...). Filtering happens in place on the cards (no re-render, so the
// field keeps focus while the draft timer or the AI re-renders around it).
import { h } from './dom.js';
import { ROLE_LABEL, PERSONALITIES } from '../data/heroes.js';
import { CLANS } from '../sim/constants.js';

const hay = new Map();
function haystack(x) {
  let s = hay.get(x.id);
  if (!s) {
    s = [x.name, x.title, CLANS[x.clan] && CLANS[x.clan].name, PERSONALITIES[x.pers] && PERSONALITIES[x.pers].name, ...(x.roles || []).map((r) => ROLE_LABEL[r]), ...(x.tags || []), x.ranged ? 'ranged' : 'melee', x.cls]
      .filter(Boolean).join(' ').toLowerCase();
    hay.set(x.id, s);
  }
  return s;
}
// Every word of the query must appear (prefix of a word, so "sup" finds supports and "fire" finds Fire...).
function heroMatches(x, q) {
  const words = String(q || '').toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const s = ' ' + haystack(x);
  return words.every((w) => s.includes(' ' + w) || s.includes('-' + w));
}
// Show/hide cards ([data-hero]) inside `root`; returns how many match.
export function applySearch(root, heroes, q) {
  let n = 0;
  for (const el of root.querySelectorAll('[data-hero]')) {
    const x = heroes(el.dataset.hero), ok = !x || heroMatches(x, q);
    el.classList.toggle('hidden', !ok); if (ok) n++;
  }
  return n;
}
// The search field: a compact input with a clear button.
export function searchBox(value, onInput, placeholder = 'Search heroes') {
  const inp = h('input', { class: 'hsearch', type: 'search', value: value || '', placeholder, 'aria-label': placeholder, autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'done',
    oninput: (e) => { wrap.classList.toggle('has', !!e.target.value); onInput(e.target.value); },
    onkeydown: (e) => { e.stopPropagation(); if (e.key === 'Enter' || e.key === 'Escape') e.target.blur(); } });
  const wrap = h('div', { class: 'hsearchw' + (value ? ' has' : '') }, inp,
    h('button', { class: 'hsx', title: 'Clear search', 'aria-label': 'Clear search', onclick: () => { inp.value = ''; wrap.classList.remove('has'); onInput(''); } }, '✕'));
  wrap.input = inp;
  return wrap;
}
// v24 clan filter for the draft grid: one compact chip that cycles All -> each clan -> All (tap), so 80 heroes
// stay easy to scan on a phone without another row of tabs. Long-press / right-click goes back to All.
export function clanChip(clan, onChange) {
  const keys = Object.keys(CLANS), c = clan && CLANS[clan];
  const next = () => { const i = clan ? keys.indexOf(clan) : -1; onChange(i + 1 < keys.length ? keys[i + 1] : null); };
  return h('button', { class: 'clanchip' + (c ? ' on' : ''), style: c ? { '--cc': c.color } : null, title: 'Filter by clan (tap to cycle)', 'aria-label': 'Clan filter: ' + (c ? c.name : 'all clans'),
    onclick: next, oncontextmenu: (e) => { e.preventDefault(); onChange(null); } }, c ? c.name : 'Clan');
}
