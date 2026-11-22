// Today: one screen for the daily coaching goals, this week's division, the season pass and the story week.
// Home shows a single "Today" card (the season button) that opens it.
import { ECON } from '../data/unlocks.js';
import { h, mount } from './dom.js';
import { GOALS, storyAt, storyNext, storyLeft, storyIn, dayOf, STORY_XP, GOAL_REWARD } from '../data/goals.js';
import { LEAGUES, GROUP, PROMOTE, DEMOTE, PTS, weekOf, weekStart, WEEK_MS, weekFrac, fillGroup, TOP5_XP } from '../data/divisions.js';
import { daysLeft, rewardName, TITLES, XP_PER_LEVEL } from '../data/seasons.js';
import { goalsToday, reroll, rerollsLeft, nextStreakReward, divNow, adoptDivision, coachOf } from '../meta.js';
import { fetchDivision } from '../net/divisions.js';
import { getAccount } from '../net/online.js';
import { profile } from '../profile.js';
import { rewardIcon } from './collection.js';
import { audio } from '../audio.js';
import { showSeason, showProfile } from './home.js';

const screen = () => document.getElementById('screen');
const bar = (frac, color) => h('div', { class: 'pbar' }, h('i', { style: { width: Math.round(Math.max(0, Math.min(1, frac)) * 100) + '%', background: color || 'var(--gold)' } }));
const rname = (r) => (r.kind === 'title' ? `Title “${TITLES[r.id]}”` : rewardName(r));
const hoursLeft = (now = Date.now()) => Math.max(1, Math.ceil(((dayOf(now) + 1) * 86400000 - now) / 3600000));

// Summary for the Home card: goals done today, and whether anything new waits on the Today screen.
export function todaySummary(P = profile) {
  const G = goalsToday(P), done = G.list.filter((k, i) => G.prog[i] >= GOALS[k].n).length, v = divNow(P);
  return { done, total: 3, league: LEAGUES[v.league], fresh: (v.last && v.last.week === v.week - 1 && !v.last.seen) || (storyAt() && storyAt().season === P.season.id && !P.d.meta.story[storyAt().id]) };
}

// The division group as shown: real coaches (signed in: from the Worker) plus AI seats, always labelled AI.
function groupRows(P, v) {
  const name = (() => { try { return localStorage.getItem('mobavs_name') || 'You'; } catch { return 'You'; } })();
  const c = P._div && P._div.joined && P._div.week === v.week ? P._div : null;
  const real = c ? c.members.map((m) => ({ name: m.name, pts: m.me ? Math.max(m.pts, v.pts) : m.pts, me: !!m.me })) : [{ name, pts: v.pts, me: true }];
  return fillGroup(v.week, v.league, v.grp, real, weekFrac(v.week));
}

export function showToday(app, opts = {}) {
  const P = profile, s = P.season, G = goalsToday(P), M = P.d.meta, v = divNow(P), now = Date.now();
  const L = LEAGUES[v.league], left = Math.max(0, weekStart(weekOf(now)) + WEEK_MS - now), dleft = Math.ceil(left / 86400000);
  const redraw = () => { const y = screen().scrollTop; showToday(app, opts); screen().scrollTop = y; };
  // ── goals ──
  const rr = rerollsLeft(P), S = M.streak, nx = nextStreakReward(S.n);
  const goals = h('div', { class: 'panel tdgoals' },
    h('div', { class: 'tdh' }, h('b', {}, 'Daily goals'), h('small', { class: 'muted' }, `New goals in ${hoursLeft()}h`)),
    ...G.list.map((k, i) => {
      const g = GOALS[k], p = Math.min(g.n, G.prog[i]), done = p >= g.n;
      return h('div', { class: 'tdgoal' + (done ? ' done' : '') },
        h('i', { class: 'tdtick' }, done ? '✓' : ''),
        h('div', { class: 'col', style: { gap: '2px', flex: 1, minWidth: 0 } }, h('span', {}, g.text), bar(p / g.n, done ? '#6fdc8c' : 'var(--gold)')),
        h('small', { class: 'tdn' }, `${p}/${g.n}`),
        !done && rr > 0 ? h('button', { class: 'chip small tdrr', title: 'Swap this goal for another of the same difficulty (once a day)', 'aria-label': `Reroll: ${g.text}`, onclick: () => { if (reroll(P, i)) { audio.sfx('move', 0.5); redraw(); } } }, '↻') : null);
    }),
    h('small', { class: 'muted' }, `+${GOAL_REWARD.xp} pass XP per goal, +${GOAL_REWARD.allXp} for all three. Koban: ${ECON.goal.join(' / ')} (easy / medium / hard).`),
    h('div', { class: 'tdstreak' }, h('b', {}, S.n ? `Streak: ${S.n} day${S.n > 1 ? 's' : ''}` : 'No streak yet'),
      h('small', { class: 'muted' }, nx ? `${nx.n} days: ${rname(nx.r)}` : `Best ${S.best} days`)));
  // ── division ──
  const rows = groupRows(P, v), mine = rows.findIndex((x) => x.me) + 1;
  const signed = !!getAccount();
  const last = v.last && v.last.week === v.week - 1 ? v.last : null;
  if (last && !last.seen) { last.seen = true; P.save({ local: true }); }
  const div = h('div', { class: 'panel tddiv', style: { '--lc': L.color } },
    h('div', { class: 'tdh' }, h('b', { style: { color: L.color } }, L.name), h('small', { class: 'muted' }, `Week ends in ${dleft}d`)),
    last ? h('div', { class: 'tdlast ' + (last.move > 0 ? 'up' : last.move < 0 ? 'down' : '') }, `Last week: #${last.place} in ${LEAGUES[last.league].name}${last.move > 0 ? ` · promoted to ${LEAGUES[last.league + 1].name}!` : last.move < 0 ? ` · down to ${LEAGUES[last.league - 1].name}` : ' · stayed'}${last.place <= PROMOTE ? ` · +${TOP5_XP} pass XP` : ''}`) : null,
    h('div', { class: 'tdme' }, h('b', {}, `#${mine}`), h('span', {}, `${v.pts} pts · ${v.g} match${v.g === 1 ? '' : 'es'}`),
      h('small', { class: 'muted' }, `Top ${PROMOTE} go up, bottom ${DEMOTE} go down`)),
    h('div', { class: 'tdlist', role: 'list' }, ...rows.map((x, i) => h('div', { role: 'listitem', class: 'tdrow' + (x.me ? ' me' : '') + (i < PROMOTE && v.league < LEAGUES.length - 1 ? ' up' : '') + (i >= GROUP - DEMOTE && v.league > 0 ? ' down' : '') },
      h('small', {}, i + 1), h('span', {}, x.me ? 'You' : x.ai ? x.name.replace(/^AI /, '') : x.name), x.ai ? h('i', { class: 'aitag', title: 'AI placeholder, not a real coach' }, 'AI') : null, h('b', {}, x.pts)))),
    h('small', { class: 'muted' }, `Every match counts: win ${PTS.win}, loss ${PTS.loss}, +${PTS.perCall} per good call (max ${PTS.callCap}). ${signed ? 'Real coaches in your group are shown by name; empty seats are AI.' : 'Sign in (Settings → Online) to meet real coaches; until then the other seats are AI.'}`));
  // ── pass ──
  const ps = P.pass, lv = P.level, ss = P.ss();
  const nextLv = Object.keys(ps.track).map(Number).find((l) => l > lv), nr = nextLv ? ps.track[nextLv] : null;
  const pass = h('button', { class: 'panel tdpass', style: { '--sc': s.color, background: `linear-gradient(90deg, #120c1ee6, #120c1e99)${s.art ? ', ' + s.art.bg : ''}` }, onclick: () => { audio.sfx('move', 0.5); showSeason(app); } },
    h('div', { class: 'tdh' }, h('b', {}, `Season ${s.id} Pass · Level ${lv}/${ps.max}`), h('small', {}, `${daysLeft(s)}d left ›`)),
    bar(P.levelProgress, s.color),
    nr ? h('div', { class: 'tdnext' }, rewardIcon(nr), h('small', {}, `Level ${nextLv}: ${rname(nr)}`), h('small', { class: 'muted' }, lv < ps.max ? `${ss.xp % XP_PER_LEVEL}/${XP_PER_LEVEL} XP` : '')) : h('small', {}, 'Pass complete!'));
  // ── story week ──
  const ev = storyAt(now), nev = storyNext(now);
  const story = ev && ev.season === s.id ? (() => {
    const st = M.story[ev.id] || { p: [0, 0, 0], got: false };
    return h('div', { class: 'panel tdstory', style: { '--ec': ev.color } },
      h('div', { class: 'tdh' }, h('b', { style: { color: ev.color } }, ev.name), h('small', { class: 'muted' }, `Story week · ${storyLeft(ev, now)}d left`)),
      h('small', { class: 'muted' }, ev.blurb),
      ...ev.goals.map((g, i) => { const p = Math.min(g.n, st.p[i]); return h('div', { class: 'tdgoal' + (p >= g.n ? ' done' : '') }, h('i', { class: 'tdtick' }, p >= g.n ? '✓' : ''), h('div', { class: 'col', style: { gap: '2px', flex: 1, minWidth: 0 } }, h('span', {}, g.text), bar(p / g.n, ev.color)), h('small', { class: 'tdn' }, `${p}/${g.n}`)); }),
      h('div', { class: 'tdnext' }, rewardIcon(ev.reward), h('small', {}, st.got ? `Earned: ${rname(ev.reward)}` : `Reward: ${[ev.reward, ev.reward.also].filter(Boolean).map(rname).join(' + ')} · +${STORY_XP} pass XP per objective`)));
  })() : nev && nev.season >= s.id ? h('div', { class: 'panel tdstory soon', style: { '--ec': nev.color } }, h('div', { class: 'tdh' }, h('b', {}, `Next story week: ${nev.name}`), h('small', { class: 'muted' }, `in ${storyIn(nev, now)}d`)), h('small', { class: 'muted' }, nev.blurb)) : null;
  const c = coachOf(M);
  const coach = h('button', { class: 'panel tdcoach', onclick: () => { audio.sfx('move', 0.5); showProfile(app, 'coach'); } },
    h('div', { class: 'clv' }, h('small', {}, 'COACH'), h('b', {}, c.lv)),
    h('div', { class: 'col', style: { gap: '3px', flex: 1, minWidth: 0 } }, h('b', {}, c.points > 0 ? `${c.points} skill point${c.points > 1 ? 's' : ''} to spend` : 'Coach skill tree'), bar(c.into, '#8fd3ff')), h('small', {}, '›'));
  mount(screen(), h('div', { class: 'subscreen today' },
    h('div', { class: 'shead', style: { '--sc': s.color } }, h('button', { class: 'btn backbtn', onclick: () => { audio.sfx('move', 0.5); app.menu(); } }, '‹ Back'), h('div', {}, h('small', {}, `SEASON ${s.id} · ${s.name.toUpperCase()}`), h('h2', {}, 'Today')), h('div')),
    h('div', { class: 'tdgrid' }, h('div', { class: 'col tdcol' }, goals, story, coach), h('div', { class: 'col tdcol' }, pass, div))));
  // signed in: refresh the group from the Worker once, then redraw with the real names
  if (signed && !opts.fetched) fetchDivision().then((r) => { if (!r) return; P._div = r; adoptDivision(P, r); if (screen().querySelector('.today')) showToday(app, { fetched: true }); });
}
