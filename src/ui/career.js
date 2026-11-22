// Career stats: lifetime numbers per hero, build, map and comp, best calls, streaks and personal records.
// Stored in profile.d.career (cloud-saved), so every list is bounded: 60 heroes, 11 builds, a handful of maps
// and comps, the top 5 calls and one entry per record (about 4 KB when full).
import { heroInfo } from './heroinfo.js';
import { h, face, emptyState } from './dom.js';
import { HERO_BY_ID } from '../data/heroes.js';
import { BUILDS } from '../data/items.js';
import { COMPS, compOf } from '../data/synergy.js';
import { MAP_BY_ID } from '../maps/defs.js';
import { analyze, kGold, fmt } from './analytics.js';

const fresh = () => ({ v: 1, n: 0, w: 0, heroes: {}, builds: {}, maps: {}, comps: {}, streak: [0, 0], calls: [0, 0], best: [], rec: {} });
const RECORDS = [
  // key, label, better ('hi' | 'lo'), format
  ['kills', 'Most team kills', 'hi', (v) => String(v)],
  ['dmg', 'Most hero damage (one hero)', 'hi', (v) => kGold(v)],
  ['fast', 'Fastest win', 'lo', (v) => fmt(v)],
  ['comeback', 'Biggest comeback', 'hi', (v) => `${kGold(v)} gold down`],
  ['lead', 'Biggest gold lead', 'hi', (v) => `+${kGold(v)}`],
  ['paid', 'Most calls paid off', 'hi', (v) => String(v)],
  ['aces', 'Most aces', 'hi', (v) => String(v)],
  ['streak', 'Longest win streak', 'hi', (v) => `${v} wins`],
];

// After a match (profile.record): fold one finished game into the career. A: the analytics record, if any.
export function recordCareer(d, game, myTeam, A) {
  const c = d.career && d.career.v === 1 ? d.career : (d.career = fresh());
  const won = game.winner === myTeam, team = game.teams[myTeam], now = Date.now();
  const wl = (o, k) => { const e = o[k] || (o[k] = [0, 0]); e[0]++; if (won) e[1]++; };
  c.n++; if (won) c.w++;
  for (const x of team.heroes) {
    const e = c.heroes[x.heroId] || (c.heroes[x.heroId] = [0, 0, 0, 0, 0, 0]);
    e[0]++; if (won) e[1]++; e[2] += x.kills; e[3] += x.deaths; e[4] += x.assists; e[5] += Math.round(x.dmgHeroes);
    if (BUILDS[x.build]) wl(c.builds, x.build);
  }
  wl(c.maps, game.world.def.id);
  const comp = compOf(team.heroes.map((x) => x.heroId)); wl(c.comps, comp.active ? comp.id : 'mixed');
  c.streak[0] = won ? c.streak[0] + 1 : 0; c.streak[1] = Math.max(c.streak[1], c.streak[0]);
  const rec = (k, v, extra) => {
    const def = RECORDS.find((r) => r[0] === k), cur = c.rec[k];
    if (v === null || v === undefined || (def[2] === 'hi' && v <= 0)) return;
    if (!cur || (def[2] === 'hi' ? v > cur[0] : v < cur[0])) c.rec[k] = [v, now, extra || ''];
  };
  rec('kills', team.kills, game.world.def.id);
  const top = team.heroes.slice().sort((a, b) => b.dmgHeroes - a.dmgHeroes)[0]; if (top) rec('dmg', Math.round(top.dmgHeroes), top.heroId);
  if (won && game.mode !== 'rush') rec('fast', Math.round(game.time), game.world.def.id);
  rec('streak', c.streak[0]);
  const mine = game.callLog.filter((x) => x.team === myTeam && x.type !== 'tactic');
  c.calls[0] += mine.length; c.calls[1] += mine.filter((x) => x.result === 'success').length;
  rec('paid', mine.filter((x) => x.result === 'success').length);
  if (A) {
    const an = analyze(A), sg = myTeam === 0 ? 1 : -1, lead = A.gold.map((v) => v * sg);
    if (won) rec('comeback', -Math.min(0, ...lead));
    rec('lead', Math.max(0, ...lead));
    rec('aces', an.fights.filter((f) => f.ace === myTeam).length);
    // best calls: the biggest gold swings from calls that paid off
    for (const x of an.coach[myTeam].list) if (x.result === 'success' && x.swing > 0) c.best.push([x.swing, x.label, now, game.world.def.id, Math.round(x.t)]);
    c.best.sort((a, b) => b[0] - a[0]); c.best.length = Math.min(c.best.length, 5);
  }
}

// ───────────── Profile → Career tab ─────────────
const n1 = (v) => String(Math.round(v * 10) / 10);
const pct = (e) => (e[0] ? Math.round(e[1] / e[0] * 100) : 0);
const date = (t) => { const d = new Date(t); return `${d.getMonth() + 1}/${d.getDate()}`; };
// a win-rate bar with a 50% tick (the number is printed too: never colour or length alone)
const wrBar = (e) => h('div', { class: 'wrbar', title: `${e[1]} wins of ${e[0]}` }, h('i', { style: { width: pct(e) + '%' } }), h('b', {}));
function wrRows(obj, label, icon, limit) {
  const rows = Object.entries(obj).sort((a, b) => b[1][0] - a[1][0] || pct(b[1]) - pct(a[1]));
  return (limit ? rows.slice(0, limit) : rows).map(([k, e]) => h('div', { class: 'crow3' }, icon ? icon(k) : h('i', { class: 'bdot none' }), h('span', { class: 'cn' }, label(k)), wrBar(e), h('span', { class: 'cv' }, `${pct(e)}%`), h('small', { class: 'muted' }, `${e[0]}`)));
}
export function careerTab(d, showAll, onToggle) {
  const c = d.career;
  if (!c || !c.n) return emptyState('assets/img/items/Hourglass.png', 'No career yet', 'Finish a match as a coach and your lifetime stats, records and best calls start here.');
  const tileC = (k, v) => h('div', { class: 'atile' }, h('b', {}, v), h('small', {}, k));
  const heroes = Object.entries(c.heroes).sort((a, b) => b[1][0] - a[1][0] || b[1][1] - a[1][1]);
  const heroRow = ([id, e]) => h('div', { class: 'crow3 hero hitap', ...(HERO_BY_ID[id] ? { role: 'button', tabindex: '0', title: 'Stats and abilities', onclick: () => heroInfo(id) } : {}) }, h('img', { src: face(id), alt: '' }), h('span', { class: 'cn' }, HERO_BY_ID[id] ? HERO_BY_ID[id].name : id), wrBar(e),
    h('span', { class: 'cv' }, `${pct(e)}%`), h('small', { class: 'muted ckda' }, `${e[0]}g · ${n1(e[2] / e[0])}/${n1(e[3] / e[0])}/${n1(e[4] / e[0])} · ${kGold(e[5] / e[0])} dmg`));
  const sec = (title, ...kids) => h('div', { class: 'panel csec' }, h('div', { class: 'rth' }, h('b', {}, title)), ...kids);
  const recRows = RECORDS.map(([k, l, , f]) => { const r = c.rec[k]; return r ? h('div', { class: 'crow3 rec' }, h('span', { class: 'cn' }, l), h('b', { class: 'cv' }, f(r[0])), h('small', { class: 'muted' }, `${r[2] && HERO_BY_ID[r[2]] ? HERO_BY_ID[r[2]].name + ' · ' : r[2] && MAP_BY_ID[r[2]] ? MAP_BY_ID[r[2]].name + ' · ' : ''}${date(r[1])}`)) : null; }).filter(Boolean);
  return h('div', { class: 'career' },
    h('div', { class: 'atiles ctop' }, tileC('Matches', String(c.n)), tileC('Win rate', `${pct([c.n, c.w])}%`), tileC('Win streak', `${c.streak[0]} (best ${c.streak[1]})`),
      tileC('Calls paid off', c.calls[0] ? `${Math.round(c.calls[1] / c.calls[0] * 100)}%` : '-')),
    h('div', { class: 'cgrid' },
      sec('Personal records', recRows.length ? recRows : h('small', { class: 'muted' }, 'Play a few more matches.')),
      sec('Best calls', c.best.length ? c.best.map((b) => h('div', { class: 'crow3 rec' }, h('span', { class: 'cn' }, b[1]), h('b', { class: 'cv up' }, `+${kGold(b[0])}`), h('small', { class: 'muted' }, `${fmt(b[4] || 0)} · ${MAP_BY_ID[b[3]] ? MAP_BY_ID[b[3]].name : ''} · ${date(b[2])}`)))
        : h('small', { class: 'muted' }, 'Calls that pay off with a gold swing land here.'), h('small', { class: 'muted' }, 'Gold-lead swing in the 30s after the call.')),
      sec(`Heroes (${heroes.length})`, ...(showAll ? heroes : heroes.slice(0, 8)).map(heroRow),
        heroes.length > 8 ? h('button', { class: 'chip cmore', onclick: onToggle }, showAll ? 'Show fewer' : `Show all ${heroes.length}`) : null),
      sec('Builds', ...wrRows(c.builds, (k) => BUILDS[k].name, (k) => h('i', { class: 'bdot', style: { background: BUILDS[k].color } }))),
      sec('Maps', ...wrRows(c.maps, (k) => (MAP_BY_ID[k] ? MAP_BY_ID[k].name : k))),
      sec('Team comps', ...wrRows(c.comps, (k) => (COMPS[k] ? COMPS[k].name : 'Mixed'), (k) => h('i', { class: 'bdot', style: { background: COMPS[k] ? COMPS[k].color : '#777' } })))));
}
