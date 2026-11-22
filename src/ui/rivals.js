// Rival coaches in the UI and the vs-AI session: who you face (picked on the Rivals screen or rolled from the
// difficulty's tier), how they draft and plan, the Rivals screen with your record against each, nemesis
// callouts, and their lines at the draft and on the results screen. Records live in profile.d.rivals.
import { rivalMascot } from './beastsui.js';
import { h, mount, face } from './dom.js';
import { RIVALS, RIVAL_BY_ID, TIER_NAME, rivalFace, rivalLine, MOMENT_HABIT, BAN_HABIT } from '../data/rivals.js';
import { PLAN_INFO } from '../data/plans.js';
import { HERO_BY_ID } from '../data/heroes.js';
import { aiPrep, recommendPlan, PLAN_DECK } from '../sim/draft.js';
import { rankOf } from '../data/ranks.js';
import { tierBadge } from './badges.js';
import { profile } from '../profile.js';
import { audio } from '../audio.js';
import { settings } from './settings.js';

const screen = () => document.getElementById('screen');
const planIcon = (id) => `assets/img/icons/${PLAN_INFO[id].icon}.png`;

// ── who you face ──
// The rival for the next Play vs AI match at difficulty `tier`: the one picked on the Rivals screen (when it is
// of that tier), else a roll among the tier (not the one you just played, unless it is your nemesis: they come back).
export function nextRival(app, tier = app.aiLevel) {
  if (app.rivalPick && RIVAL_BY_ID[app.rivalPick] && RIVAL_BY_ID[app.rivalPick].tier === tier) return RIVAL_BY_ID[app.rivalPick];
  if (app.rivalRoll && app.rivalRoll.tier === tier && RIVAL_BY_ID[app.rivalRoll.id]) return RIVAL_BY_ID[app.rivalRoll.id];
  const list = RIVALS.filter((r) => r.tier === tier), nem = profile.nemesis();
  const pool = list.filter((r) => r.id !== app.lastRival || r.id === nem);
  const r = pool[Math.floor(Math.random() * pool.length)] || list[0];
  app.rivalRoll = { tier, id: r.id };
  return r;
}
// After a match against `id`: roll a new one next time (a picked rival stays picked).
export function rivalPlayed(app, id) { app.lastRival = id; app.rivalRoll = null; }

// Draft habits as an autoChoice preference: favourites and tags on picks; bans by style; never ban a favourite.
export function rivalPref(r) {
  const fav = new Set(r.draft.fav), tags = r.draft.tags;
  const best = r.draft.ban === 'best' ? yourBest() : [];
  return (x, act) => {
    if (act === 'pick') return (fav.has(x.id) ? 2.2 : 0) + tags.filter((t) => x.tags.includes(t)).length * 0.6;
    if (fav.has(x.id)) return -3;
    if (r.draft.ban === 'best') { const i = best.indexOf(x.id); return i >= 0 ? 3.2 - i * 0.6 : 0; }
    if (r.draft.ban === 'carry') return x.cls === 'marksman' || x.cls === 'mage' ? 1.2 : 0;
    return 0;
  };
}
// Your most dangerous heroes (games and wins with them): what a 'best'-banning rival takes away.
function yourBest() {
  return Object.entries(profile.d.heroStats || {}).filter(([id, s]) => HERO_BY_ID[id] && s.g >= 3)
    .map(([id, s]) => [id, (s.w + 1) / (s.g + 2) * Math.min(1, s.g / 8)]).sort((a, b) => b[1] - a[1]).slice(0, 4).map((q) => q[0]);
}
// The rival's prep: counter-builds as usual, then their game plan (signature most of the time, else the recommended
// one for the matchup) and a deck that fits it. rng: the session's seeded Rng.
export function rivalPrep(r, ids, enemyIds, rng, mode) {
  const p = aiPrep(ids, enemyIds, mode), sig = r.plans.find((x) => !(mode === 'rush' && x === 'split'));
  p.plan = rng.next() < r.stick ? sig : recommendPlan(ids, enemyIds, mode).id;
  p.deck = PLAN_DECK[p.plan].slice();
  return p;
}
// Coach style for the match cfg (part of the replay): Coach Moment habit and the halftime switch plan.
export const rivalStyle = (r) => ({ moment: r.moment || '', backup: r.plans[1] });

// ── small pieces used by home, draft and results ──
export const rivalFaceImg = (r, size = 26, cls = '') => h('img', { class: 'rvface ' + cls, src: rivalFace(r.id), alt: '', style: { width: size + 'px', height: size + 'px' } });
const recText = (rec) => (rec.w + rec.l ? `${rec.w}-${rec.l}` : 'new');
// Home's Play vs AI card: who you will face, tap for the Rivals screen.
export function rivalChip(app, onOpen) {
  const r = nextRival(app), rec = profile.rivalRec(r.id), nem = profile.nemesis() === r.id;
  return h('button', { class: 'h2rival' + (nem ? ' nem' : ''), title: `Next rival: ${r.name}, ${r.title}. Tap to see every rival.`, onclick: onOpen },
    rivalFaceImg(r, 26), h('span', { class: 'rvn' }, h('b', {}, r.name), h('small', {}, nem ? 'NEMESIS' : app.rivalPick === r.id ? `picked · ${recText(rec)}` : `rival · ${recText(rec)}`)), h('i', { class: 'rvgo' }, '›'));
}
// Draft side panel: the rival's opening line (and their habits).
export function rivalDraftNote(s) {
  const r = s.rival && RIVAL_BY_ID[s.rival]; if (!r) return null;
  return h('div', { class: 'rvquote' }, rivalFaceImg(r, 30), h('div', {}, h('b', {}, r.name), h('span', {}, `“${rivalLine(r, 'hi', s.seed)}”`)));
}
// Results: the rival's line (trash talk when they win, respect when they lose), your record, and nemesis news.
export function rivalPanel(sum, s, won) {
  const r = s && s.rival && RIVAL_BY_ID[s.rival]; if (!r) return null;
  const rv = sum && sum.rival, rec = rv || profile.rivalRec(r.id);
  const news = !rv ? null : rv.revenge ? `Revenge! ${r.name} was your nemesis.` : rv.newNemesis ? `${r.name} is now your NEMESIS.` : rv.nemesis ? `Nemesis: ${r.name} leads ${rv.l}-${rv.w}.`
    : rv.s >= 3 ? `${rv.s} wins in a row vs ${r.name}.` : rv.s <= -3 ? `${-rv.s} losses in a row vs ${r.name}.` : null;
  return h('div', { class: 'panel rvres' + (rv && (rv.nemesis || rv.revenge) ? ' nem' : '') },
    rivalFaceImg(r, 44, 'big'),
    h('div', { class: 'rvtxt' }, h('b', {}, `${r.name} `, h('small', {}, r.title), ' ', rivalMascot(r.id)), h('span', { class: 'rvline' }, `“${rivalLine(r, won ? 'lose' : 'win', s.seed)}”`),
      h('small', { class: 'muted' }, `You vs ${r.name}: ${rec.w}-${rec.l}`, news ? h('b', { class: 'rvnews' }, ' · ' + news) : null)));
}

// ── the Rivals screen ──
// Three columns (Easy / Normal / Hard), four rivals each; the detail panel shows the selected rival and Challenge.
export function showRivals(app, sel = null) {
  const nem = profile.nemesis();
  sel = sel || app.rivalPick || nem || nextRival(app).id;
  const r = RIVAL_BY_ID[sel];
  const card = (x) => {
    const rec = profile.rivalRec(x.id), isNem = nem === x.id;
    return h('button', { class: 'rvcard' + (x.id === sel ? ' on' : '') + (isNem ? ' nem' : '') + (app.rivalPick === x.id ? ' picked' : ''), 'data-rival': x.id, title: `${x.name}, ${x.title}`,
      onclick: () => { audio.sfx('move', 0.4); showRivals(app, x.id); } },
      rivalFaceImg(x, 34), h('span', { class: 'rvn' }, h('b', {}, x.name), h('small', {}, isNem ? 'NEMESIS' : recText(rec))),
      h('img', { class: 'rvplan', src: planIcon(x.plans[0]), alt: '', title: `Signature plan: ${PLAN_INFO[x.plans[0]].name}` }));
  };
  const cols = [0, 1, 2].map((t) => h('div', { class: 'rvcol' + (t === app.aiLevel ? ' cur' : '') }, h('div', { class: 'rvtier' }, TIER_NAME[t]), ...RIVALS.filter((x) => x.tier === t).map(card)));
  const rec = profile.rivalRec(r.id), rk = rankOf(r.elo);
  const favs = r.draft.fav.map((id) => h('img', { src: face(id), alt: HERO_BY_ID[id].name, title: HERO_BY_ID[id].name }));
  const streak = rec.s >= 2 ? `${rec.s} wins in a row` : rec.s <= -2 ? `${-rec.s} losses in a row` : '';
  const detail = h('div', { class: 'panel rvdetail' + (nem === r.id ? ' nem' : '') },
    h('div', { class: 'rvhead' }, rivalFaceImg(r, 52, 'big'),
      h('div', { class: 'rvid' }, h('b', {}, r.name), h('small', {}, r.title, ' ', rivalMascot(r.id)), h('span', { class: 'rvrank' }, tierBadge(rk, 18), `${rk.label} · ${TIER_NAME[r.tier]}`)),
      h('div', { class: 'rvrec' }, h('b', {}, recText(rec) === 'new' ? '—' : `${rec.w}-${rec.l}`), h('small', {}, nem === r.id ? 'NEMESIS' : streak || 'your record'))),
    h('div', { class: 'rvpers' }, r.pers),
    h('div', { class: 'rvplans' }, ...r.plans.map((p, i) => h('span', { class: 'rvpl', style: { '--pc': PLAN_INFO[p].color }, title: PLAN_INFO[p].desc }, h('img', { src: planIcon(p), alt: '' }), h('small', {}, i ? 'Halftime' : 'Signature'), PLAN_INFO[p].short))),
    h('div', { class: 'rvhab' }, h('div', { class: 'rvfav' }, h('small', {}, 'Favourites'), ...favs), h('small', { class: 'muted' }, `${BAN_HABIT[r.draft.ban]} · ${MOMENT_HABIT[r.moment || '']}`)),
    h('div', { class: 'rvbtns' },
      h('button', { class: 'btn big rvgo', onclick: () => { app.rivalPick = r.id; app.aiLevel = r.tier; audio.sfx('accept', 0.6); app.startVsAI('classic'); } }, `Challenge ${r.name}`),
      h('button', { class: 'btn' + (app.rivalPick === r.id ? ' on' : ''), title: app.rivalPick === r.id ? 'Back to a random rival of each difficulty' : `Play vs AI faces ${r.name} until you change it`,
        onclick: () => { app.rivalPick = app.rivalPick === r.id ? null : r.id; if (app.rivalPick) app.aiLevel = r.tier; app.rivalRoll = null; audio.sfx('move', 0.5); showRivals(app, r.id); } }, app.rivalPick === r.id ? '★ Picked' : 'Pick')));
  const random = () => {
    const list = RIVALS.filter((x) => x.tier === app.aiLevel && x.id !== sel), pickR = list[Math.floor(Math.random() * list.length)];
    app.rivalPick = null; app.rivalRoll = { tier: app.aiLevel, id: pickR.id };
    if (settings.reducedMotion) { audio.sfx('lockin', 0.6); showRivals(app, pickR.id); return; }
    // a short shuffle over the tier's cards, then it lands
    const cards = [...screen().querySelectorAll(`.rvcol.cur .rvcard`)];
    const idx = Math.max(0, cards.findIndex((c) => c.dataset.rival === pickR.id)), steps = cards.length + idx;
    let i = 0;
    const tick = () => {
      if (!cards[0] || !cards[0].isConnected) return; // left the screen mid-shuffle
      cards.forEach((c, k) => c.classList.toggle('spin', k === i % cards.length));
      audio.sfx('move', 0.25);
      if (i++ < steps) setTimeout(tick, 60 + i * 14); else setTimeout(() => { if (cards[0].isConnected) { audio.sfx('lockin', 0.7); showRivals(app, pickR.id); } }, 260);
    };
    tick();
  };
  mount(screen(), h('div', { class: 'subscreen rivals' },
    h('div', { class: 'shead' }, h('button', { class: 'btn backbtn', onclick: () => { audio.sfx('move', 0.5); app.menu(); } }, '‹ Back'), h('h2', {}, 'Rivals'),
      h('button', { class: 'btn small rvrand', title: `A random ${TIER_NAME[app.aiLevel]} rival`, onclick: random }, 'Random')),
    h('div', { class: 'rvbody' }, h('div', { class: 'rvgrid' }, cols), detail)));
}
