// Custom games: rule toggles, a chosen map and weekly event, then one of three ways to play:
//  * Host a private room (code / invite link; the rules travel to the guest in the 'start' message),
//  * Pass & Play on this device (two coaches, src/passplay.js),
//  * Practice vs the AI.
// The toggles go into the match config (cfg.custom, src/sim/custom.js), so every peer and every replay plays the
// same rules. Custom games are never ranked and record no progress (no rating, XP, mastery, goals or divisions).
import { h, mount, toast } from './dom.js';
import { MAPS, MAP_BY_ID } from '../maps/defs.js';
import { RUSH_MAPS } from '../maps/rush.js';
import { EVENTS, EVENT_BY_ID } from '../data/events.js';
import { CUSTOM_RULES, cleanCustom, customLabel } from '../sim/custom.js';
import { mapThumb } from './screens.js';
import { lobbyInvite } from './social.js';
import { audio } from '../audio.js';

const KEY = 'mobavs_custom';
const screen = () => document.getElementById('screen');
// The last setup on this device: { rules, map, event }.
function load() {
  let v = null; try { v = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { v = null; }
  v = v && typeof v === 'object' ? v : {};
  return { rules: cleanCustom(v.rules) || {}, map: typeof v.map === 'string' ? v.map : 'random', event: EVENT_BY_ID[v.event] ? v.event : null };
}
const save = (o) => { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch { /* ignore */ } };
// The map for a custom game: the chosen one (classic or a Lane Rush map with Single lane), else seeded random.
export function customMap(o, seed) {
  const pool = o.rules.single ? RUSH_MAPS : MAPS;
  return pool.some((m) => m.id === o.map) ? o.map : pool[(seed >>> 1) % pool.length].id;
}
export const customMode = (o) => (o && o.rules && o.rules.single ? 'rush' : 'classic');
export const customSummary = (o) => `${customLabel(o.rules)}${o.event && !o.rules.single && EVENT_BY_ID[o.event] ? ' · ' + EVENT_BY_ID[o.event].name : ''}`;

export function showCustom(app) {
  const o = load();
  const render = () => {
    save(o);
    const maps = o.rules.single ? RUSH_MAPS : MAPS;
    if (o.map !== 'random' && !maps.some((m) => m.id === o.map)) o.map = 'random';
    const go = (how) => { audio.sfx('accept', 0.6); app.playCustom({ rules: { ...o.rules }, map: o.map, event: o.rules.single ? null : o.event }, how); };
    mount(screen(), h('div', { class: 'subscreen custom' },
      h('div', { class: 'shead' }, h('button', { class: 'btn backbtn', onclick: () => { audio.sfx('move', 0.5); app.menu(); } }, '‹ Back'), h('h2', {}, 'Custom Game'), h('div')),
      h('small', { class: 'muted center' }, 'House rules for friends. Never ranked: no rating, XP or goals.'),
      h('div', { class: 'panel col' }, h('b', {}, 'Rules'),
        h('div', { class: 'crules' }, ...CUSTOM_RULES.map((r) => h('button', { class: 'crule' + (o.rules[r.id] ? ' on' : ''), role: 'switch', 'aria-checked': String(!!o.rules[r.id]), title: r.desc,
          onclick: () => { if (o.rules[r.id]) delete o.rules[r.id]; else o.rules[r.id] = true; audio.sfx('move', 0.4); render(); } }, h('b', {}, r.name), h('small', {}, r.desc))))),
      h('div', { class: 'panel col' }, h('b', {}, o.rules.single ? 'Map (Lane Rush maps)' : 'Map'),
        h('div', { class: 'maprow cmaps' }, ...[['random', 'Random'], ...maps.map((m) => [m.id, m.name])].map(([id, l]) =>
          h('button', { class: 'mapchip' + (o.map === id ? ' on' : ''), title: id === 'random' ? 'A random map' : `${MAP_BY_ID[id] ? MAP_BY_ID[id].name : l}`, onclick: () => { o.map = id; render(); } },
            id === 'random' ? h('span', { class: 'q' }, '?') : mapThumb(id), h('span', id === 'random' ? {} : { translate: 'no' }, l.replace(/^(The |Lane Rush: )/, '').split(' ')[0]))))),
      o.rules.single ? null : h('div', { class: 'panel col' }, h('b', {}, 'Weekly event'),
        h('div', { class: 'cevents' }, h('button', { class: 'chip' + (!o.event ? ' on' : ''), onclick: () => { o.event = null; render(); } }, 'None'),
          ...EVENTS.map((e) => h('button', { class: 'chip' + (o.event === e.id ? ' on' : ''), title: e.blurb, style: { borderColor: o.event === e.id ? e.color : null }, onclick: () => { o.event = e.id; render(); } }, e.name)))),
      h('div', { class: 'cgo' },
        h('button', { class: 'btn big', title: 'A private room: share the code or invite a friend', onclick: () => go('host') }, 'Host room'),
        h('button', { class: 'btn big', title: 'Two coaches on this device: pass it between turns', onclick: () => go('pnp') }, 'Pass & Play'),
        h('button', { class: 'btn big', title: 'Try the rules against the AI', onclick: () => go('ai') }, 'vs AI'))));
  };
  render();
}
// The lobby's extra box for a custom room: the rules, then the usual invite box (link / friend invite).
export function customLobby(app, code, opts) {
  return h('div', { class: 'col clobby' }, h('small', { class: 'gold' }, `Custom game · ${customSummary(opts.custom)}`), lobbyInvite(app, code, { ...opts, mode: 'custom' }));
}
export function customToast(s) { if (s && s.customOpts) toast(`Custom game: ${customSummary(s.customOpts)}`, 2400); }
