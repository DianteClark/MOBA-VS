// Long-term coach progression at run time: coach levels and the skill tree, hero mastery perks, daily coaching
// goals (rerolls, streaks), Season 2 story weeks, Weekly Divisions (local mirror; the Worker is authoritative
// when signed in, see src/net/divisions.js) and Prestige looks. All state lives in profile.d.meta, bounded:
// known ids only, short fixed-size lists, and it rides along with the cloud save.
import { COACH_XP, coachLevelOf, coachPoints, TREE, TREE_BY_ID, nodeReq, PERKS, PRESTIGE_REWARDS, STREAK_REWARDS } from './data/meta.js';
import { GOALS, GOAL_REWARD, REROLLS, dayOf, dailyGoals, rerollGoal, STORY, STORY_XP, storyAt } from './data/goals.js';
import { LEAGUES, weekOf, matchPts, finalPlace, moveOf, LEAGUE_REWARDS, TOP5_XP, GROUP } from './data/divisions.js';
import { TACTICS, SKILL_TACTICS } from './data/tactics.js';
import { MOMENT_VARIANTS } from './sim/sidegrades.js';
import { prestigeOf } from './data/ranks.js';
import { HERO_BY_ID } from './data/heroes.js';
import { compOf } from './data/synergy.js';

const fresh = () => ({ cxp: 0, tree: [], mv: {}, perks: {}, goals: null, streak: { n: 0, last: -9, best: 0 }, story: {}, div: null, prestige: 0 });
const num = (v, lo = 0, hi = 1e9) => Math.max(lo, Math.min(hi, Math.round(Number(v) || 0)));
// Sanitize profile.d.meta (old saves, cloud copies): known keys and ids only.
export function normalizeMeta(d) {
  const m = d.meta && typeof d.meta === 'object' ? d.meta : {}, o = fresh();
  o.cxp = num(m.cxp, 0, 5e7);
  o.tree = [...new Set(Array.isArray(m.tree) ? m.tree.filter((k) => TREE_BY_ID[k]) : [])];
  for (const [slot, v] of Object.entries(m.mv && typeof m.mv === 'object' ? m.mv : {})) if (MOMENT_VARIANTS[v] && MOMENT_VARIANTS[v].slot === slot) o.mv[slot] = v;
  for (const [h, p] of Object.entries(m.perks && typeof m.perks === 'object' ? m.perks : {})) if (HERO_BY_ID[h] && PERKS[p]) o.perks[h] = p;
  const g = m.goals;
  if (g && Array.isArray(g.list) && g.list.length === 3 && g.list.every((k) => GOALS[k])) {
    o.goals = { day: num(g.day), list: g.list.slice(), prog: [0, 1, 2].map((i) => num((g.prog || [])[i], 0, 999)), rr: num(g.rr, 0, 9), all: !!g.all };
  }
  const s = m.streak || {}; o.streak = { n: num(s.n, 0, 9999), last: Number.isFinite(s.last) ? s.last : -9, best: num(s.best, 0, 9999) };
  for (const e of STORY) { const x = m.story && m.story[e.id]; if (x) o.story[e.id] = { p: [0, 1, 2].map((i) => num((x.p || [])[i], 0, 999)), got: !!x.got }; }
  const v = m.div;
  if (v && typeof v === 'object') {
    o.div = { week: num(v.week, -1e4, 1e6), league: num(v.league, 0, LEAGUES.length - 1), best: num(v.best, 0, LEAGUES.length - 1), pts: num(v.pts, 0, 1e5), g: num(v.g, 0, 999), grp: num(v.grp, 0, 1e6),
      others: (Array.isArray(v.others) ? v.others : []).slice(0, GROUP - 1).map((x) => num(x, 0, 1e5)), paid: num(v.paid, -1e4, 1e6),
      last: v.last && typeof v.last === 'object' ? { week: num(v.last.week, -1e4, 1e6), place: num(v.last.place, 1, GROUP), move: Math.sign(Number(v.last.move) || 0), league: num(v.last.league, 0, LEAGUES.length - 1), seen: !!v.last.seen } : null };
  }
  o.prestige = num(m.prestige, 0, 10);
  d.meta = o;
  return o;
}

// ── coach level and skill tree ──
export const coachOf = (M) => { const c = coachLevelOf(M.cxp); const spent = M.tree.reduce((a, k) => a + TREE_BY_ID[k].cost, 0); return { ...c, points: coachPoints(c.lv) - spent }; };
// Why a node cannot be bought yet (null = it can).
export function nodeBlock(M, n) {
  if (M.tree.includes(n.id)) return 'owned';
  const c = coachOf(M), req = nodeReq(n);
  if (c.lv < n.lv) return `Coach level ${n.lv}`;
  if (req && !M.tree.includes(req)) return 'Unlock the one before';
  if (c.points < n.cost) return `${n.cost} skill point${n.cost > 1 ? 's' : ''}`;
  return null;
}
// Buys a node; returns its rewards (for toasts) or null.
export function buyNode(P, id) {
  const M = P.d.meta, n = TREE_BY_ID[id]; if (!n || nodeBlock(M, n)) return null;
  M.tree.push(id); const got = []; if (n.reward) P.unlock(n.reward, got);
  P.save(); return got;
}
// Classic cards are owned from the start; skill-tree cards once their node is bought.
export function ownsTactic(M, id) {
  if (!TACTICS[id]) return false;
  if (!SKILL_TACTICS.includes(id)) return true;
  return TREE.some((n) => n.tactic === id && M.tree.includes(n.id));
}
export const ownsVariant = (M, v) => TREE.some((n) => n.moment === v && M.tree.includes(n.id));
// Equip a variant in its slot (or v = null for the classic moment).
export function setVariant(P, slot, v) { const M = P.d.meta; if (v && (!ownsVariant(M, v) || MOMENT_VARIANTS[v].slot !== slot)) return; if (v) M.mv[slot] = v; else delete M.mv[slot]; P.save(); }
// The team cfg field for this coach's matches (sidegrades: allowed everywhere, ranked and cups included).
export function momentLoadout(M) { const o = {}; for (const [s, v] of Object.entries(M.mv)) if (ownsVariant(M, v)) o[s] = v; return Object.keys(o).length ? o : null; }

// ── hero mastery perks (vs AI only) ──
export const perkUnlocked = (P, hero, perk) => !!PERKS[perk] && P.mastery(hero).lv >= PERKS[perk].lv;
export function setPerk(P, hero, perk) { const M = P.d.meta; if (perk && !perkUnlocked(P, hero, perk)) return; if (perk) M.perks[hero] = perk; else delete M.perks[hero]; P.save(); }
// Where perks apply: matches against the AI that are not online, not a cup, not a replay. Returns the cfg.perks
// entry for my team ({ heroId: perkId } for my heroes) or null.
export const PERK_MODES = 'Play vs AI, Lane Rush vs AI and Franchise';
export function perksFor(P, heroIds, { online = false, cup = false, replay = false, watch = false } = {}) {
  if (online || cup || replay || watch) return null;
  const o = {}; for (const id of heroIds) { const p = P.d.meta.perks[id]; if (p && perkUnlocked(P, id, p)) o[id] = p; }
  return Object.keys(o).length ? o : null;
}

// ── daily goals ──
export function goalsToday(P, now = Date.now()) {
  const M = P.d.meta, day = dayOf(now);
  if (!M.goals || M.goals.day !== day) M.goals = { day, list: dailyGoals(day), prog: [0, 0, 0], rr: 0, all: false };
  if (M.streak.last < day - 1) M.streak.n = 0; // a missed day breaks the streak
  return M.goals;
}
export const rerollsLeft = (P) => REROLLS - goalsToday(P).rr;
export function reroll(P, i) {
  const G = goalsToday(P); if (G.rr >= REROLLS || G.prog[i] >= GOALS[G.list[i]].n) return false;
  const k = rerollGoal(G.day, G.list, i, G.rr); if (k === G.list[i]) return false;
  G.list[i] = k; G.prog[i] = 0; G.rr++; P.save(); return true;
}
// Next streak reward: { n, r } or null.
export const nextStreakReward = (n) => { const k = Object.keys(STREAK_REWARDS).map(Number).find((x) => x > n); return k ? { n: k, r: STREAK_REWARDS[k] } : null; };

// ── per-match context for goals and story objectives ──
export function goalContext(game, my) {
  const team = game.teams[my], ids = team.heroes.map((x) => x.heroId);
  const evs = game.events, obj = (k) => evs.filter((e) => e.type === 'objective' && e.team === my && e.obj === k).length;
  const clanHeroes = {}; for (const id of ids) { const c = HERO_BY_ID[id] && HERO_BY_ID[id].clan; if (c) clanHeroes[c] = (clanHeroes[c] || 0) + 1; }
  const comp = compOf(ids);
  return {
    won: game.winner === my, my, rush: game.mode === 'rush', map: game.world.def.id,
    calls: game.callLog.filter((c) => c.team === my && c.result === 'success').length,
    tactics: evs.filter((e) => e.type === 'tactic' && e.team === my).length,
    moments: evs.filter((e) => e.type === 'moment' && e.team === my).length,
    kami: obj('dragon'), oni: obj('herald'), kraken: obj('baron'), towers: team.towers, kills: team.kills,
    comp: comp.active ? comp.id : null, clans: Math.max(0, ...Object.values(clanHeroes)), clanHeroes,
  };
}

// ── Weekly Divisions (local mirror) ──
// Settles finished weeks (place from the cached group points + AI seats), then returns this week's state.
export function divNow(P, now = Date.now(), out = []) {
  const M = P.d.meta, w = weekOf(now);
  let v = M.div;
  if (!v) v = M.div = { week: w, league: 0, best: 0, pts: 0, g: 0, grp: 0, others: [], paid: w - 1, last: null };
  if (v.week !== w) {
    if (v.g > 0 && v.paid < v.week) {
      const place = finalPlace(v.week, v.league, v.grp, v.pts, v.others), move = moveOf(place, v.league);
      v.last = { week: v.week, place, move, league: v.league, seen: false };
      v.paid = v.week;
      if (place <= 5) P.addPassXp(TOP5_XP);
      v.league = Math.max(0, Math.min(LEAGUES.length - 1, v.league + move));
      if (v.league > v.best) { for (let l = v.best + 1; l <= v.league; l++) P.unlock(LEAGUE_REWARDS[l], out); v.best = v.league; }
    }
    v.week = w; v.pts = 0; v.g = 0; v.grp = 0; v.others = [];
  }
  return v;
}
// The Worker's answer for a signed-in coach (src/net/divisions.js): league, group and the real members' points.
export function adoptDivision(P, r, myId) {
  if (!r || typeof r !== 'object') return;
  const v = divNow(P), out = [];
  if (Number.isInteger(r.league) && r.league >= 0 && r.league < LEAGUES.length && r.week === v.week) {
    v.league = r.league;
    if (v.league > v.best) { for (let l = v.best + 1; l <= v.league; l++) P.unlock(LEAGUE_REWARDS[l], out); v.best = v.league; }
  }
  if (r.last && r.week === v.week && r.last.week === v.week - 1) { // the Worker's finish for last week wins over the local estimate
    const L = r.last, same = v.last && v.last.week === L.week;
    v.last = { week: L.week, place: num(L.place, 1, GROUP), move: Math.sign(Number(L.move) || 0), league: num(L.league, 0, LEAGUES.length - 1), seen: same ? v.last.seen : false };
  }
  if (r.joined && r.week === v.week) {
    v.grp = num(r.grp, 0, 1e6);
    const me = (r.members || []).find((x) => x.me);
    if (me) { v.pts = Math.max(v.pts, num(me.pts, 0, 1e5)); v.g = Math.max(v.g, num(me.g, 0, 999)); }
    v.others = (r.members || []).filter((x) => !x.me).map((x) => num(x.pts, 0, 1e5)).slice(0, GROUP - 1);
  }
  P.save({ local: true });
  return out;
}

// ── after every coached match (from Profile.record) ──
// ctx: goalContext(); key: the history mode key. Returns the results-screen summary.
export function recordMeta(P, ctx, { now = Date.now(), peakElo = 0 } = {}) {
  const M = P.d.meta, unlocks = [], parts = [];
  const before = coachLevelOf(M.cxp).lv;
  let cxp = ctx.won ? COACH_XP.win : COACH_XP.loss;
  parts.push([ctx.won ? 'Victory' : 'Played', cxp]);
  if (ctx.calls) { const c = Math.min(COACH_XP.callCap, ctx.calls * COACH_XP.perCall); parts.push(['Calls', c]); cxp += c; }
  // daily goals
  const G = goalsToday(P, now), goals = [];
  let passXp = 0;
  G.list.forEach((k, i) => {
    const g = GOALS[k], was = G.prog[i];
    if (was >= g.n) return;
    let inc = 0; try { inc = Math.max(0, g.inc(ctx) | 0); } catch { inc = 0; }
    if (!inc) return;
    G.prog[i] = Math.min(g.n, was + inc);
    const done = G.prog[i] >= g.n;
    goals.push({ text: g.text, prog: G.prog[i], n: g.n, done, tier: g.tier });
    if (done) { passXp += GOAL_REWARD.xp; cxp += COACH_XP.goal; parts.push(['Daily goal', COACH_XP.goal]); }
  });
  let streak = null;
  if (!G.all && G.list.every((k, i) => G.prog[i] >= GOALS[k].n)) {
    G.all = true; passXp += GOAL_REWARD.allXp;
    const S = M.streak; S.n = S.last === G.day - 1 ? S.n + 1 : 1; S.last = G.day; S.best = Math.max(S.best, S.n);
    if (STREAK_REWARDS[S.n]) P.unlock(STREAK_REWARDS[S.n], unlocks);
    streak = S.n;
  }
  // story week
  const ev = storyAt(now), story = [];
  if (ev && ev.season === P.season.id) {
    const st = M.story[ev.id] || (M.story[ev.id] = { p: [0, 0, 0], got: false });
    ev.goals.forEach((g, i) => {
      if (st.p[i] >= g.n) return;
      let inc = 0; try { inc = Math.max(0, g.inc(ctx) | 0); } catch { inc = 0; }
      if (!inc) return;
      st.p[i] = Math.min(g.n, st.p[i] + inc);
      if (st.p[i] >= g.n) { passXp += STORY_XP; cxp += COACH_XP.story; parts.push(['Story', COACH_XP.story]); }
      story.push({ text: g.text, prog: st.p[i], n: g.n, done: st.p[i] >= g.n });
    });
    if (!st.got && ev.goals.every((g, i) => st.p[i] >= g.n)) { st.got = true; P.unlock(ev.reward, unlocks); }
  }
  // division points
  const v = divNow(P, now, unlocks), dpts = matchPts(ctx.won, ctx.calls);
  v.pts += dpts; v.g++;
  // prestige looks (peak rating this season)
  const pr = prestigeOf(peakElo);
  if (pr > M.prestige) { for (let l = M.prestige + 1; l <= pr; l++) P.unlock(PRESTIGE_REWARDS[l], unlocks); M.prestige = pr; }
  M.cxp += cxp;
  const after = coachLevelOf(M.cxp);
  return { cxp, parts, calls: ctx.calls, lvBefore: before, lvAfter: after.lv, into: after.into, goals, streak, story, storyEv: ev && story.length ? ev.id : null, passXp, div: { pts: dpts, total: v.pts, league: v.league }, unlocks };
}
