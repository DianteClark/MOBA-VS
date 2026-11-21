// Game plans in the match UI: the kickoff reveal (both plans are secret until the match starts), the halftime
// switch callout, and the post-match plan verdict ("Your plan: Scale. It worked: you out-scaled from 11:20").
import { h, icon } from './dom.js';
import { PLAN_INFO, planName, beats, losesTo } from '../data/plans.js';
import { TEAM_NAME } from '../sim/constants.js';
import { HERO_BY_ID } from '../data/heroes.js';
import { TEAM_COL } from '../render/palette.js';
import { audio } from '../audio.js';

const chip = (id, label, col) => { const P = PLAN_INFO[id]; return P ? h('span', { class: 'prv', style: { '--pc': P.color, '--tc': col } }, h('small', {}, label), h('b', {}, h('img', { src: icon(P.icon), alt: '' }), P.name)) : null; };

// Kickoff: once, in the first seconds of a match (not when joining mid-game, e.g. the Play of the Game).
export function planReveal(hud) {
  const g = hud.g;
  if (hud.planShown || g.tick < 12) return;
  hud.planShown = true;
  if (g.tick > 400) return;
  const plans = g.teams.map((t) => t.plan); if (!plans.every((p) => PLAN_INFO[p])) return;
  const me = hud.my, a = me >= 0 ? me : 0, b = 1 - a;
  hud.banner(null, '#ffd84a', 3200, null, false, [h('small', {}, 'GAME PLANS'),
    h('div', { class: 'prvrow' }, chip(plans[a], me >= 0 ? 'YOU' : TEAM_NAME[a].toUpperCase(), TEAM_COL[a]), h('i', { class: 'prvvs' }, 'VS'), chip(plans[b], me >= 0 ? 'THEM' : TEAM_NAME[b].toUpperCase(), TEAM_COL[b]))]);
  audio.sfx('lockin', 0.7);
  if (me >= 0) {
    const mine = plans[me], theirs = plans[1 - me], P = PLAN_INFO[theirs];
    const edge = beats(mine).includes(theirs) ? 'Your plan counters theirs.' : losesTo(mine).includes(theirs) ? 'Their plan counters yours: adapt with your calls.' : '';
    hud.ticker(`Their plan: ${P.name}. ${P.strong}; ${P.weak.toLowerCase()}. ${edge}`.trim(), losesTo(mine).includes(theirs) ? 'danger' : 'act', 2);
  }
}
// Halftime switch (the 'plan' sim event): both sides see it as play resumes.
export function planSwitch(hud, e) {
  const P = PLAN_INFO[e.plan]; if (!P) return;
  const mine = e.team === hud.my;
  if (mine) { hud.ticker(`New plan: ${P.name}. ${P.desc}`, 'act', 2); return; }
  const from = PLAN_INFO[e.from] ? PLAN_INFO[e.from].short.toUpperCase() : 'PLAN';
  hud.banner(null, P.color, 2200, null, false, [h('small', {}, `${hud.my >= 0 ? 'THEY' : TEAM_NAME[e.team].toUpperCase()} SWITCHED FROM ${from}`), h('b', {}, P.name.toUpperCase()), h('span', {}, `${P.strong} · ${P.weak.toLowerCase()}`)]);
  if (hud.my >= 0) hud.ticker(`They switched to ${P.name}: ${P.desc}`, 'danger', 2);
}

// ── verdict (analytics) ──
// A.plans: [[start plan, end plan, halftime-switch second | 0], ...] per team; A.k clock scale; A.carry: protect carries.
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const kg = (v) => (Math.abs(v) >= 1000 ? (Math.round(v / 100) / 10) + 'k' : String(Math.round(v)));
export function planVerdict(A, T) {
  if (!A.plans || !A.plans[T]) return null;
  const [p0, p1, at] = A.plans[T], plan = p1 || p0, P = PLAN_INFO[plan]; if (!P) return null;
  const sg = T === 0 ? 1 : -1, G = A.gold, st = A.step || 5, k = A.k || 1, you = A.my >= 0 && A.my === T;
  const W = you ? 'you' : 'they', Wc = you ? 'You' : 'They', them = you ? 'them' : 'you';
  const lead = (s) => { const i = Math.max(0, Math.min(G.length - 1, Math.round(s / st))); return (G[i] || 0) * sg; };
  const end = lead(A.len), mid = Math.min(A.len, 480 * k);
  let ok = null, text = '';
  if (A.len < 300 * k) text = 'The match ended before it could play out.';
  else if (plan === 'aggro') {
    const l = lead(mid), early = A.ev.filter((e) => e[2] === T && e[0] <= mid && (e[1] === 'tw' || e[1] === 'ob')).length;
    ok = l >= 800 || (l >= 0 && early >= 3);
    text = ok ? `It worked: ${l >= 0 ? '+' : ''}${kg(l)} gold and ${early} tower${early === 1 ? '' : 's'}/objective${early === 1 ? '' : 's'} by ${fmt(mid)}.` : `It stalled: ${l >= 0 ? `only +${kg(l)}` : `${kg(-l)} gold behind`} at ${fmt(mid)}.`;
  } else if (plan === 'scale') {
    // the last time the gold lead turned our way and stayed there
    let from = -1; for (let i = G.length - 1; i > 0 && G[i] * sg > 0; i--) if (G[i - 1] * sg <= 0) { from = i * st; break; }
    if (from < 0 && G.length && G.every((v, i) => i === 0 || v * sg > 0)) from = 0;
    ok = end > 0;
    text = !ok ? `It never came online: ${kg(-end)} gold behind at the end.` : from > mid * 0.6 ? `It worked: ${W} out-scaled ${them} from ${fmt(from)}.`
      : `It worked: ${W} led from ${from > 0 ? fmt(from) : 'the start'} and finished +${kg(end)}.`;
  } else if (plan === 'objective') {
    const ob = (t) => A.ev.filter((e) => e[1] === 'ob' && e[2] === t).length, a = ob(T), b = ob(1 - T);
    ok = a + b ? a > b : null;
    text = a + b === 0 ? 'No objective was taken all game.' : ok ? `It worked: ${W} took ${a} of ${a + b} objectives.` : `It slipped: ${W} took ${a} of ${a + b} objectives.`;
  } else if (plan === 'split') {
    const side = (t) => A.ev.filter((e) => e[1] === 'tw' && e[2] === t && (e[3] === 'top' || e[3] === 'bot')).length, a = side(T), b = side(1 - T);
    ok = a > b;
    text = ok ? `It worked: ${a} side-lane towers to ${b}.` : `It stalled: ${a} side-lane tower${a === 1 ? '' : 's'} to ${b}.`;
  } else if (plan === 'protect') {
    const id = A.carry && A.carry[T], x = id && A.heroes.find((r) => r[0] === id && r[1] === T);
    if (x) {
      const name = HERO_BY_ID[x[0]] ? HERO_BY_ID[x[0]].name : x[0];
      ok = x[4] <= 4 && x[3] + x[5] >= x[4] * 2;
      text = ok ? `It worked: ${name} went ${x[3]}/${x[4]}/${x[5]}.` : `The peel broke: ${name} went ${x[3]}/${x[4]}/${x[5]}.`;
    }
  }
  const sw = at && p0 !== p1 ? ` (switched from ${planName(p0)} at halftime)` : '';
  return { plan, name: P.name, color: P.color, icon: P.icon, ok, text, head: `${you ? 'Your plan' : A.my >= 0 ? 'Their plan' : TEAM_NAME[T] + ' plan'}: ${P.name}${sw}.` };
}
// One results/analysis line per side: "Your plan: Scale. It worked: ..."
export function planLines(A) {
  if (!A || !A.plans) return null;
  const sides = A.my >= 0 ? [A.my, 1 - A.my] : [0, 1];
  const rows = sides.map((T) => planVerdict(A, T)).filter(Boolean);
  if (!rows.length) return null;
  return h('div', { class: 'aplans' }, ...rows.map((v) => h('div', { class: 'aplan' + (v.ok === true ? ' good' : v.ok === false ? ' bad' : ''), style: { '--pc': v.color } },
    h('img', { src: icon(v.icon), alt: '' }), h('span', {}, h('b', {}, v.head), ' ', v.text))));
}
