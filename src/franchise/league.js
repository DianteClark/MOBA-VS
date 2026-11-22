// Franchise mode: your league. Founding, the 14-round season, playoffs, the offseason (progression, retirements,
// contracts, rookie draft, free agency) and the AI general managers. Pure state transitions on a plain object
// that lives in the profile (profile.d.fr); every random roll comes from a seeded Rng whose state is saved with it.
import { HEROES, HERO_BY_ID, ROLES } from '../data/heroes.js';
import { Rng } from '../sim/rng.js';
import * as D from './data.js';
import { clamp, salaryFor, valueOf, heroMod, lineupMods, strengthOf, winProb, quickScore, bestLineup, coversRoles, chemistry } from './model.js';
import { compOf, DUOS } from '../data/synergy.js';

export const FR_VERSION = 1;
const NEWS_MAX = 12, HIST_MAX = 30, HOF_MAX = 24;

// Run fn with the franchise's own Rng (its state is stored, so a save/reload never changes what happens next).
export function withRng(fr, fn) { const r = new Rng(fr.rs); const out = fn(r); fr.rs = r.state(); return out; }
export const rosterOf = (fr, t) => Object.values(fr.h).filter((x) => x.t === t);
export const heroRec = (fr, id) => fr.h[id];
export const teamName = (fr, t) => fr.teams[t].name;
export function news(fr, text) { fr.news.unshift({ s: fr.season, r: fr.round, text }); fr.news.length = Math.min(fr.news.length, NEWS_MAX); }
export const budgetFor = (fans, prize) => Math.round(clamp(D.BUDGET_BASE + fans * D.BUDGET_PER_FAN + prize * 0.5, D.BUDGET_MIN, D.CAP));
export function payroll(fr, t) { const tm = fr.teams[t]; return rosterOf(fr, t).reduce((s, x) => s + x.s, 0) + (fr.phase === 'offseason' ? tm.deadNext || 0 : tm.dead || 0); }
export const capSpace = (fr, t) => fr.teams[t].bud - payroll(fr, t);

function gauss(r) { return (r.next() + r.next() + r.next() - 1.5) * 2; } // ~N(0,1), bounded
function career(r, id, o, a) {
  const p = a <= 2 ? clamp(o + 4 + r.int(20), o, 97) : clamp(o + r.int(4), o, 97);
  return { id, t: -1, o, p, a, y: 0, s: salaryFor(o, p, a), m: 60, f: 0, fo: 0, b: 0, inj: 0, g: 0, w: 0, pk: o, ys: 0 };
}
function prospect(r, id) {
  const o = 48 + r.int(15), p = clamp(o + 10 + r.int(26), o, 97);
  return { id, t: -2, o, p, a: 0, y: 0, s: 0, m: 65, f: 0, fo: 0, b: 0, inj: 0, g: 0, w: 0, pk: o, ys: 0 };
}

// ── founding ──
// opts: { name, abbr, c1, c2, p (pattern), e (emblem), seed }
export function newFranchise(opts) {
  const seed = opts.seed >>> 0, r = new Rng(seed ^ 0xf4a7c41);
  const fr = { v: FR_VERSION, seed, rs: 0, season: 1, phase: 'season', round: 0, teams: [], h: {}, sched: [], po: null, off: null,
    news: [], hist: [], troph: { titles: 0, finals: 0, best: null }, hof: [], mine: [], lineup: null, live: null, seen: 0 };
  fr.teams.push({ name: opts.name, abbr: opts.abbr, c1: opts.c1, c2: opts.c2, p: opts.p, e: opts.e, fans: D.FANS_START, bud: 0, dead: 0, deadNext: 0, gm: null, place: 0 });
  const names = D.FR_NAMES.filter(([n, a]) => n.toLowerCase() !== String(opts.name).toLowerCase() && a !== opts.abbr);
  for (let i = names.length - 1; i > 0; i--) { const j = r.int(i + 1); [names[i], names[j]] = [names[j], names[i]]; }
  for (let i = 1; i < D.LEAGUE_TEAMS; i++) {
    const c1 = r.int(D.COLORS.length); let c2 = r.int(D.COLORS.length); if (c2 === c1) c2 = (c2 + 5) % D.COLORS.length;
    fr.teams.push({ name: names[i - 1][0], abbr: names[i - 1][1], c1: D.COLORS[c1], c2: D.COLORS[c2], p: r.int(D.PATTERNS.length), e: r.int(D.EMBLEMS.length),
      fans: D.FANS_START, bud: 0, dead: 0, deadNext: 0, gm: D.GM_ORDER[(i - 1) % D.GM_ORDER.length], place: 0 });
  }
  for (const tm of fr.teams) tm.bud = budgetFor(tm.fans, 6);
  // every hero gets a career; rosters are dealt by a per-role snake draft so every franchise starts even
  for (const hd of HEROES) fr.h[hd.id] = career(r, hd.id, clamp(Math.round(68 + gauss(r) * 8), 50, 90), r.int(8));
  const order = Array.from({ length: D.LEAGUE_TEAMS }, (_, i) => i);
  for (let i = order.length - 1; i > 0; i--) { const j = r.int(i + 1); [order[i], order[j]] = [order[j], order[i]]; }
  const deal = (pool, rounds) => {
    for (let k = 0; k < rounds; k++) {
      const seq = k % 2 ? order.slice().reverse() : order;
      for (const t of seq) { const x = pool.shift(); if (x) { x.t = t; } }
    }
  };
  for (const role of ROLES) deal(Object.values(fr.h).filter((x) => x.t === -1 && HERO_BY_ID[x.id].role === role).sort((a, b) => valueOf(b) - valueOf(a)), 1);
  deal(Object.values(fr.h).filter((x) => x.t === -1).sort((a, b) => valueOf(b) - valueOf(a)), 2);
  for (const x of Object.values(fr.h)) {
    if (x.t >= 0) { x.y = 1 + r.int(3); x.b = 2 + r.int(3); x.ys = x.t === 0 ? 0 : 1 + r.int(3); } // a short training camp: everyone starts a little bonded
  }
  // contracts signed before this season: trim salaries so every payroll fits its budget with some room
  for (let t = 0; t < D.LEAGUE_TEAMS; t++) {
    const ros = rosterOf(fr, t), pay = ros.reduce((s, x) => s + x.s, 0), room = fr.teams[t].bud - 8;
    if (pay > room) for (const x of ros) x.s = Math.max(3, Math.round(x.s * room / pay));
  }
  fr.rs = r.state();
  fr.sched = withRng(fr, (rr) => schedule(rr));
  news(fr, `${opts.name} join the league. ${D.ROUNDS} matches, the top ${D.PLAYOFF_TEAMS} make the playoffs.`);
  return fr;
}

// Double round robin (circle method), the second half mirrored. sched[round] = [[home, away, w, kh, ka], ...]; w -1 unplayed.
function schedule(r) {
  const n = D.LEAGUE_TEAMS, ids = Array.from({ length: n }, (_, i) => i);
  for (let i = ids.length - 1; i > 0; i--) { const j = r.int(i + 1); [ids[i], ids[j]] = [ids[j], ids[i]]; }
  const half = [];
  for (let k = 0; k < n - 1; k++) {
    const rd = [];
    for (let i = 0; i < n / 2; i++) { const a = ids[i], b = ids[n - 1 - i]; rd.push(k % 2 ? [b, a, -1, 0, 0] : [a, b, -1, 0, 0]); }
    half.push(rd);
    ids.splice(1, 0, ids.pop());
  }
  return [...half, ...half.map((rd) => rd.map(([a, b]) => [b, a, -1, 0, 0]))];
}

// ── standings ──
export function standings(fr) {
  const rows = fr.teams.map((tm, t) => ({ t, w: 0, l: 0, kd: 0, streak: '' }));
  for (const rd of fr.sched) for (const [a, b, w, ka, kb] of rd) {
    if (w < 0) continue;
    const win = w === 0 ? a : b, lose = w === 0 ? b : a;
    rows[win].w++; rows[lose].l++; rows[a].kd += ka - kb; rows[b].kd += kb - ka;
    rows[win].streak = rows[win].streak[0] === 'W' ? 'W' + (+rows[win].streak.slice(1) + 1) : 'W1';
    rows[lose].streak = rows[lose].streak[0] === 'L' ? 'L' + (+rows[lose].streak.slice(1) + 1) : 'L1';
  }
  return rows.sort((x, y) => y.w - x.w || y.kd - x.kd || x.t - y.t);
}

// ── lineups and match context ──
export function aiLineup(fr, t) { return bestLineup(rosterOf(fr, t)); }
// Your saved lineup if it is still valid (5 healthy heroes on your roster covering the roles), else the best one.
export function myLineup(fr) {
  const ros = rosterOf(fr, 0);
  if (Array.isArray(fr.lineup) && fr.lineup.length === 5) {
    const xs = fr.lineup.map((id) => fr.h[id]).filter((x) => x && x.t === 0 && !x.inj);
    if (xs.length === 5) { const ordered = bestLineup(xs); if (ordered) return ordered; }
  }
  return bestLineup(ros);
}
export function lineupInfo(starters) { const lm = lineupMods(starters); return { ...lm, str: strengthOf(lm.mods) }; }

// The next match of your franchise: { kind: 'season'|'semi'|'final', round, idx, home, away, opp } or null.
export function nextFixture(fr) {
  if (fr.phase === 'season') {
    const rd = fr.sched[fr.round]; if (!rd) return null;
    const idx = rd.findIndex((m) => m[0] === 0 || m[1] === 0);
    const m = rd[idx]; return { kind: 'season', round: fr.round, idx, home: m[0], away: m[1], opp: m[0] === 0 ? m[1] : m[0] };
  }
  if (fr.phase === 'playoffs' && fr.po) {
    const list = fr.po.f ? [['final', fr.po.f, 0]] : fr.po.sf.map((m, i) => ['semi', m, i]);
    for (const [kind, m, i] of list) if (m[2] < 0 && (m[0] === 0 || m[1] === 0)) return { kind, round: fr.round, idx: i, home: m[0], away: m[1], opp: m[0] === 0 ? m[1] : m[0] };
  }
  return null;
}
// Everything a match needs: lineups, edges, names. side 0 = you (you always coach the blue side).
export function matchContext(fr, fx) {
  const mine = myLineup(fr), theirs = aiLineup(fr, fx.opp);
  const a = lineupInfo(mine), b = lineupInfo(theirs);
  return { fx, ids: [mine.map((x) => x.id), theirs.map((x) => x.id)], mods: [a.mods, b.mods], str: [a.str, b.str], chem: [a.chem, b.chem], p: winProb(a.str, b.str) };
}

// ── after a match: morale, form, fatigue, bond ──
// perf: { heroId: score } for the starters (bigger = better game), used for form.
function afterMatch(fr, t, starters, won, perf) {
  const ids = new Set(starters), ros = rosterOf(fr, t);
  const avgO = starters.reduce((s, id) => s + fr.h[id].o, 0) / starters.length;
  const ranked = starters.slice().sort((a, b) => (perf[b] || 0) - (perf[a] || 0));
  const comp = compOf(starters).active ? new Set(compOf(starters).heroes) : new Set();
  for (const x of ros) {
    if (ids.has(x.id)) {
      x.g++; if (won) x.w++;
      x.f = Math.min(10, x.f + (x.a >= 6 ? 1.5 : 1));
      const duo = DUOS.some((d) => (d.a === x.id && ids.has(d.b)) || (d.b === x.id && ids.has(d.a)));
      x.b = Math.min(D.BOND_MAX, x.b + 1 + (duo || comp.has(x.id) ? 0.5 : 0));
      x.m = clamp(x.m + (won ? 5 : -3) + (60 - x.m) * 0.05, 0, 100);
      const rk = ranked.indexOf(x.id);
      if (rk <= 1) x.fo = Math.min(2, Math.max(0, x.fo) + 1);
      else if (rk === ranked.length - 1) x.fo = Math.max(-2, Math.min(0, x.fo) - 1);
      else x.fo -= Math.sign(x.fo);
      x.inj = x.f >= D.FATIGUE.injured ? 1 : 0;
    } else {
      x.f = Math.max(0, x.f - 3); x.inj = 0;
      x.m = clamp(x.m - (x.o >= avgO - 2 ? 4 : 1.5) + (won ? 1 : 0), 0, 100);
      x.fo -= Math.sign(x.fo);
    }
    x.m = Math.round(x.m * 10) / 10;
  }
}
// Quick-resolved match between two teams (AI lineups): returns the result and applies the roster effects.
function quickMatch(fr, r, a, b) {
  const la = aiLineup(fr, a), lb = aiLineup(fr, b), ia = lineupInfo(la), ib = lineupInfo(lb);
  const sc = quickScore(r, ia.str, ib.str);
  for (const [t, L, info, won] of [[a, la, ia, sc.w === 0], [b, lb, ib, sc.w === 1]]) {
    const perf = Object.fromEntries(L.map((x, i) => [x.id, info.mods[i] * 20 + r.next() * 1.2]));
    afterMatch(fr, t, L.map((x) => x.id), won, perf);
  }
  return sc;
}

// Record your match (played live or simmed), then quick-resolve the rest of that round and move on.
// res: { w: 0 if you won else 1, k: [yours, theirs], tw, len, crystal, perf: { heroId: score }, ids: [mine, theirs], how: 'play'|'sim' }
export function recordFixture(fr, ctx, res) {
  const fx = ctx.fx, youHome = fx.home === 0, wHome = (res.w === 0) === youHome ? 0 : 1;
  const kh = youHome ? res.k[0] : res.k[1], ka = youHome ? res.k[1] : res.k[0];
  afterMatch(fr, 0, res.ids[0], res.w === 0, res.perf || {});
  afterMatch(fr, fx.opp, res.ids[1], res.w === 1, res.perf || {});
  const oppName = fr.teams[fx.opp].name;
  fr.mine.push({ s: fr.season, kind: fx.kind, opp: fx.opp, won: res.w === 0, k: res.k, len: res.len, how: res.how, ids: res.ids[0], mvp: res.mvp || null });
  fr.mine.length = Math.min(fr.mine.length, 20);
  fr.live = null;
  if (fx.kind === 'season') {
    const m = fr.sched[fx.round][fx.idx]; m[2] = wHome; m[3] = kh; m[4] = ka;
    withRng(fr, (r) => { for (const mm of fr.sched[fx.round]) if (mm[2] < 0) { const sc = quickMatch(fr, r, mm[0], mm[1]); mm[2] = sc.w; mm[3] = sc.k[0]; mm[4] = sc.k[1]; } });
    news(fr, `${res.w === 0 ? 'Win' : 'Loss'} vs ${oppName} (${res.k[0]}-${res.k[1]} kills).`);
    advanceRound(fr);
  } else {
    const m = fx.kind === 'final' ? fr.po.f : fr.po.sf[fx.idx]; m[2] = wHome; m[3] = kh; m[4] = ka;
    news(fr, `${fx.kind === 'final' ? 'Final' : 'Semifinal'}: ${res.w === 0 ? 'won' : 'lost'} vs ${oppName}.`);
    advancePlayoffs(fr);
  }
}
function advanceRound(fr) {
  fr.round++;
  if (fr.round === Math.floor(D.ROUNDS / 2)) aiMidseason(fr);
  if (fr.round >= D.ROUNDS) startPlayoffs(fr);
}
function startPlayoffs(fr) {
  const st = standings(fr), s = st.map((x) => x.t);
  fr.phase = 'playoffs';
  fr.po = { seeds: s.slice(0, D.PLAYOFF_TEAMS), sf: [[s[0], s[3], -1, 0, 0], [s[1], s[2], -1, 0, 0]], f: null };
  news(fr, `Regular season over: ${fr.teams[s[0]].name} finish first. Playoffs: ${s.slice(0, 4).map((t) => fr.teams[t].abbr).join(', ')}.`);
  advancePlayoffs(fr);
}
// Resolve the playoff matches that do not involve you (all of them when you did not qualify).
function advancePlayoffs(fr) {
  withRng(fr, (r) => {
    const run = (m) => { if (m[2] >= 0 || m[0] === 0 || m[1] === 0) return; const sc = quickMatch(fr, r, m[0], m[1]); m[2] = sc.w; m[3] = sc.k[0]; m[4] = sc.k[1]; };
    fr.po.sf.forEach(run);
    if (!fr.po.f && fr.po.sf.every((m) => m[2] >= 0)) {
      const w = fr.po.sf.map((m) => (m[2] === 0 ? m[0] : m[1]));
      fr.po.f = [w[0], w[1], -1, 0, 0];
      news(fr, `Final: ${fr.teams[w[0]].name} vs ${fr.teams[w[1]].name}.`);
    }
    if (fr.po.f) run(fr.po.f);
  });
  if (fr.po.f && fr.po.f[2] >= 0) endSeason(fr);
}
export const inPlayoffs = (fr) => !!(fr.po && fr.po.seeds.includes(0));

// ── AI general managers ──
function aiSign(fr, t, x, r, why) {
  const tm = fr.teams[t];
  x.t = t; x.y = 1 + r.int(3); x.s = salaryFor(x.o, x.p, x.a); x.b = 0; x.m = 62; x.ys = 0;
  if (why) news(fr, `${tm.name} sign ${HERO_BY_ID[x.id].name} (OVR ${x.o}, ${x.s}k).`);
}
function freeAgents(fr) { return Object.values(fr.h).filter((x) => x.t === -1); }
// Midseason: an AI franchise with room upgrades on its weakest hero when a clearly better free agent is out there.
function aiMidseason(fr) {
  withRng(fr, (r) => {
    for (let t = 1; t < D.LEAGUE_TEAMS; t++) {
      const st = fr.teams[t].gm, ros = rosterOf(fr, t);
      if (ros.length >= D.ROSTER_MAX) continue;
      const worst = Math.min(...ros.map((x) => valueOf(x, st)));
      const fa = freeAgents(fr).filter((x) => salaryFor(x.o, x.p, x.a) <= capSpace(fr, t)).sort((a, b) => valueOf(b, st) - valueOf(a, st))[0];
      if (fa && valueOf(fa, st) > worst + 4) aiSign(fr, t, fa, r, true);
    }
  });
}
// Offseason free agency for the AI: re-balance to budget, then fill to 7 (roles first), best value per k.
export function aiFreeAgency(fr, t, r) {
  const tm = fr.teams[t], st = tm.gm;
  let ros = rosterOf(fr, t);
  // over budget or too many: cut the worst value-for-money hero (never break the roles)
  while (ros.length > D.ROSTER_MIN && (payroll(fr, t) > tm.bud || ros.length > D.ROSTER_MAX - 1)) {
    const cut = ros.slice().sort((a, b) => (valueOf(a, st) - a.s * 0.3) - (valueOf(b, st) - b.s * 0.3)).find((x) => coversRoles(ros.filter((y) => y !== x)));
    if (!cut) break;
    tm.deadNext = (tm.deadNext || 0) + Math.round(cut.s * 0.5);
    cut.t = -1; cut.y = 0; cut.s = salaryFor(cut.o, cut.p, cut.a); cut.b = 0; cut.ys = 0; ros = rosterOf(fr, t);
  }
  for (let guard = 0; guard < 12; guard++) {
    ros = rosterOf(fr, t);
    const need = !coversRoles(ros), want = ros.length < 7 || need;
    if (!want || ros.length >= D.ROSTER_MAX) break;
    const room = capSpace(fr, t);
    let pool = freeAgents(fr).filter((x) => salaryFor(x.o, x.p, x.a) <= room);
    if (need) { const fill = pool.filter((x) => coversRoles([...ros, x]) || helpsRoles(ros, x)); if (fill.length) pool = fill; }
    if (!pool.length) {
      if (ros.length >= D.ROSTER_MIN && !need) break;
      // must field a team: the cheapest free agent signs a minimum deal
      const cheap = freeAgents(fr).filter((x) => !need || helpsRoles(ros, x)).sort((a, b) => a.o - b.o)[0] || freeAgents(fr).sort((a, b) => a.o - b.o)[0];
      if (!cheap) break;
      aiSign(fr, t, cheap, r, false); cheap.s = 3; continue;
    }
    pool.sort((a, b) => (valueOf(b, st) + 30) / (8 + salaryFor(b.o, b.p, b.a)) - (valueOf(a, st) + 30) / (8 + salaryFor(a.o, a.p, a.a)));
    const pickTop = pool.slice(0, 3).sort((a, b) => valueOf(b, st) - valueOf(a, st))[0];
    aiSign(fr, t, pickTop, r, pickTop.o >= 74);
  }
}
// Does adding x give the roster a hero for a role it cannot fill yet?
function helpsRoles(ros, x) {
  const have = new Set(); for (const y of ros) for (const rl of HERO_BY_ID[y.id].roles) have.add(rl);
  return HERO_BY_ID[x.id].roles.some((rl) => !have.has(rl));
}

// ── season end and the offseason ──
function endSeason(fr) {
  const st = standings(fr), champ = fr.po.f[2] === 0 ? fr.po.f[0] : fr.po.f[1], fin = fr.po.f[2] === 0 ? fr.po.f[1] : fr.po.f[0];
  const semis = fr.po.sf.map((m) => (m[2] === 0 ? m[1] : m[0]));
  const place = (t) => (t === champ ? 1 : t === fin ? 2 : semis.includes(t) ? 3 : 1 + st.findIndex((x) => x.t === t));
  const summary = [];
  for (let t = 0; t < D.LEAGUE_TEAMS; t++) {
    const tm = fr.teams[t], row = st.find((x) => x.t === t), pl = place(t), prize = D.PRIZE[Math.min(D.PRIZE.length - 1, pl - 1)];
    const fans0 = tm.fans;
    tm.fans = clamp(Math.round(D.FANS_START + (tm.fans - D.FANS_START) * 0.8 + (row.w - D.ROUNDS / 2) * 2.2 + (pl <= 4 ? 3 : 0) + (pl <= 2 ? 3 : 0) + (pl === 1 ? 5 : 0)), 10, 100);
    const bud0 = tm.bud; tm.bud = budgetFor(tm.fans, prize); tm.place = pl;
    summary.push({ t, w: row.w, l: row.l, place: pl, prize, fans: [fans0, tm.fans], bud: [bud0, tm.bud] });
  }
  const me = summary[0], rec = st.find((x) => x.t === 0);
  // your MVP: most wins started
  const mvp = rosterOf(fr, 0).sort((a, b) => b.w - a.w || b.g - a.g || b.o - a.o)[0];
  fr.hist.unshift({ s: fr.season, w: rec.w, l: rec.l, rank: 1 + st.findIndex((x) => x.t === 0), place: me.place, champ: fr.teams[champ].abbr, mvp: mvp ? mvp.id : null, bud: me.bud[1], fans: me.fans[1] });
  fr.hist.length = Math.min(fr.hist.length, HIST_MAX);
  if (champ === 0) fr.troph.titles++;
  if (champ === 0 || fin === 0) fr.troph.finals++;
  if (!fr.troph.best || rec.w > fr.troph.best.w) fr.troph.best = { s: fr.season, w: rec.w, l: rec.l };
  news(fr, `${fr.teams[champ].name} are Season ${fr.season} champions!`);
  fr.phase = 'offseason';
  fr.off = { step: 'review', sum: summary, champ, changes: [], exp: [], order: [], pick: 0 };
  progressHeroes(fr);
}
// Aging, growth toward potential, decline, retirement (a retired hero's name returns as a draft prospect) and contracts.
function progressHeroes(fr) {
  const ch = fr.off.changes;
  withRng(fr, (r) => {
    for (const x of Object.values(fr.h)) {
      if (x.t === -2) continue;
      const before = x.o;
      x.a++;
      const grow = x.a <= 3 ? 2 + r.int(6) : x.a <= 5 ? r.int(4) - 1 : -(1 + r.int(4));
      x.o = clamp(x.o + grow + (x.g >= 10 && x.w / Math.max(1, x.g) > 0.6 ? 1 : 0), 40, Math.max(x.p, x.o));
      x.pk = Math.max(x.pk || 0, x.o);
      if (x.t === 0 && x.o !== before) ch.push({ id: x.id, d: x.o - before });
      const retire = x.a >= 10 || (x.a >= 7 && r.next() < 0.3 + (x.a - 7) * 0.15) || (x.o < 52 && x.a >= 5);
      if (retire) {
        if (x.t === 0 || x.pk >= 84) {
          const legend = { id: x.id, s: fr.season, pk: x.pk, a: x.a, mine: x.t === 0, ys: x.ys };
          if (x.t === 0 && (x.ys >= 2 || x.pk >= 80)) { fr.hof.unshift(legend); fr.hof.length = Math.min(fr.hof.length, HOF_MAX); }
          if (x.t === 0) ch.push({ id: x.id, retired: true });
        }
        if (x.t >= 0 && x.pk >= 84) news(fr, `${HERO_BY_ID[x.id].name} retires (peak OVR ${x.pk}).`);
        fr.h[x.id] = prospect(r, x.id);
        continue;
      }
      if (x.t >= 0) { x.ys++; x.y = Math.max(0, x.y - 1); }
      x.g = 0; x.w = 0;
    }
    // AI contracts: keep the heroes worth their new price if the budget allows (best value first)
    for (let t = 1; t < D.LEAGUE_TEAMS; t++) {
      const tm = fr.teams[t];
      for (const x of rosterOf(fr, t).filter((y) => y.y === 0).sort((a, b) => valueOf(b, tm.gm) - valueOf(a, tm.gm))) {
        const ask = salaryFor(x.o, x.p, x.a), keep = valueOf(x, tm.gm) > ask * 0.35 && payroll(fr, t) - x.s + ask <= tm.bud;
        if (keep) { x.s = ask; x.y = 1 + r.int(3); } else { x.t = -1; x.s = ask; x.b = 0; x.ys = 0; }
      }
    }
  });
  // your expiring deals wait for your decision
  fr.off.exp = rosterOf(fr, 0).filter((x) => x.y === 0).map((x) => x.id);
  for (const x of rosterOf(fr, 0)) if (x.y === 0) x.ask = askFor(x);
  for (const tm of fr.teams) { tm.dead = 0; }
}
// Re-signing: what an expiring hero of yours asks. Happy heroes give a hometown discount; unhappy ones walk.
export function askFor(x) { return x.m < 30 ? -1 : Math.max(3, Math.round(salaryFor(x.o, x.p, x.a) * (x.m >= 75 ? 0.9 : 1))); }
export function resign(fr, id, years) {
  const x = fr.h[id]; if (!x || x.t !== 0 || x.y !== 0 || !(x.ask > 0)) return false;
  x.s = x.ask; x.y = clamp(years | 0, 1, 3); delete x.ask;
  fr.off.exp = fr.off.exp.filter((k) => k !== id); return true;
}
export function letGo(fr, id) {
  const x = fr.h[id]; if (!x || x.t !== 0 || x.y !== 0) return false;
  x.t = -1; x.s = salaryFor(x.o, x.p, x.a); x.b = 0; x.ys = 0; delete x.ask;
  fr.off.exp = fr.off.exp.filter((k) => k !== id); news(fr, `${HERO_BY_ID[id].name} leaves ${fr.teams[0].name} as a free agent.`); return true;
}
// Contracts step done: unanswered expiring deals leave. Then the draft order (worst first) and AI picks up to you.
export function startDraft(fr) {
  for (const id of fr.off.exp.slice()) letGo(fr, id);
  const st = fr.off.sum.slice().sort((a, b) => b.place - a.place || a.w - b.w);
  fr.off.order = st.map((x) => x.t); fr.off.pick = 0; fr.off.step = 'draft';
  fr.off.picks = [];
  draftAI(fr);
}
export const prospects = (fr) => Object.values(fr.h).filter((x) => x.t === -2).sort((a, b) => b.p - a.p || b.o - a.o);
function draftPick(fr, t, x) {
  const slot = fr.off.pick;
  x.t = t; x.y = 3; x.s = D.ROOKIE_SAL[Math.min(slot, D.ROOKIE_SAL.length - 1)]; x.b = 0; x.m = 70; x.ys = 0;
  fr.off.picks.push({ t, id: x.id, slot });
  fr.off.pick++;
}
function draftAI(fr) {
  while (fr.off.pick < fr.off.order.length) {
    const t = fr.off.order[fr.off.pick], pool = prospects(fr);
    if (!pool.length) { fr.off.pick = fr.off.order.length; break; }
    if (t === 0) return;
    const st = fr.teams[t].gm, ros = rosterOf(fr, t);
    if (ros.length >= D.ROSTER_MAX) { fr.off.picks.push({ t, id: null, slot: fr.off.pick }); fr.off.pick++; continue; }
    const best = pool.sort((a, b) => valueOf(b, st) + (helpsRoles(ros, b) ? 4 : 0) - valueOf(a, st) - (helpsRoles(ros, a) ? 4 : 0))[0];
    draftPick(fr, t, best);
  }
  finishDraft(fr);
}
export function myDraftPick(fr, id) {
  if (fr.off.step !== 'draft' || fr.off.order[fr.off.pick] !== 0) return false;
  if (id === null) { fr.off.picks.push({ t: 0, id: null, slot: fr.off.pick }); fr.off.pick++; draftAI(fr); return true; }
  const x = fr.h[id]; if (!x || x.t !== -2 || rosterOf(fr, 0).length >= D.ROSTER_MAX) return false;
  draftPick(fr, 0, x); news(fr, `${fr.teams[0].name} draft ${HERO_BY_ID[id].name} (pick ${fr.off.pick}).`);
  draftAI(fr); return true;
}
export const myDraftTurn = (fr) => fr.phase === 'offseason' && fr.off.step === 'draft' && fr.off.order[fr.off.pick] === 0;
function finishDraft(fr) {
  if (fr.off.pick < fr.off.order.length) return;
  for (const x of prospects(fr)) { x.t = -1; x.s = salaryFor(x.o, x.p, x.a); }
  fr.off.step = 'fa';
}
// Ready for the new season? Returns a list of problems with your roster (empty = good to go).
export function seasonBlockers(fr) {
  const ros = rosterOf(fr, 0), out = [];
  if (ros.length < D.ROSTER_MIN) out.push(`Sign ${D.ROSTER_MIN - ros.length} more hero${D.ROSTER_MIN - ros.length > 1 ? 'es' : ''} (at least ${D.ROSTER_MIN}).`);
  if (ros.length > D.ROSTER_MAX) out.push(`Release ${ros.length - D.ROSTER_MAX} (at most ${D.ROSTER_MAX}).`);
  if (!coversRoles(ros)) out.push('Your roster cannot fill all five roles.');
  if (payroll(fr, 0) > fr.teams[0].bud) out.push(`Payroll ${payroll(fr, 0)}k is over your ${fr.teams[0].bud}k budget.`);
  return out;
}
export function startNextSeason(fr) {
  if (seasonBlockers(fr).length) return false;
  withRng(fr, (r) => { for (let t = 1; t < D.LEAGUE_TEAMS; t++) aiFreeAgency(fr, t, r); });
  for (const tm of fr.teams) { tm.dead = tm.deadNext || 0; tm.deadNext = 0; }
  for (const x of Object.values(fr.h)) { x.m = Math.round(60 + (x.m - 60) * 0.5); x.f = 0; x.fo = 0; x.inj = 0; x.g = 0; x.w = 0; delete x.ask; }
  fr.season++; fr.round = 0; fr.phase = 'season'; fr.po = null; fr.off = null; fr.mine = []; fr.live = null;
  fr.sched = withRng(fr, (r) => schedule(r));
  news(fr, `Season ${fr.season} begins.`);
  return true;
}
export { chemistry, heroMod };

// ── assistant GM: does the offseason paperwork for you (also drives your team in tools/franchise_sim.mjs) ──
// Re-signs expiring heroes worth their price, drafts the best prospect, fills the roster in free agency.
export function assistant(fr, upTo = 'season') {
  if (fr.phase !== 'offseason') return false;
  if (fr.off.step === 'review') fr.off.step = 'contracts';
  if (fr.off.step === 'contracts') {
    for (const id of fr.off.exp.slice().sort((a, b) => valueOf(fr.h[b]) - valueOf(fr.h[a]))) {
      const x = fr.h[id];
      if (x.ask > 0 && valueOf(x) > x.ask * 0.35 && payroll(fr, 0) - x.s + x.ask <= fr.teams[0].bud) resign(fr, id, x.a <= 3 ? 3 : x.a >= 6 ? 1 : 2);
    }
    startDraft(fr);
    if (upTo === 'draft') return true;
  }
  while (myDraftTurn(fr)) {
    const ros = rosterOf(fr, 0), pool = prospects(fr).sort((a, b) => valueOf(b) - valueOf(a));
    myDraftPick(fr, ros.length < D.ROSTER_MAX && pool.length ? pool[0].id : null);
  }
  if (upTo === 'fa') return true;
  withRng(fr, (r) => aiFreeAgency(fr, 0, r));
  return upTo === 'season' ? startNextSeason(fr) : true;
}
// Quick-resolve your own fixture (no 5v5 sim): used by tools/franchise_sim.mjs for long economy runs.
export function quickFixture(fr) {
  const fx = nextFixture(fr); if (!fx) return false;
  const ctx = matchContext(fr, fx);
  withRng(fr, (r) => {
    const sc = quickScore(r, ctx.str[0], ctx.str[1], ctx.p);
    const perf = {}; ctx.ids.forEach((ids, s) => ids.forEach((id, i) => { perf[id] = ctx.mods[s][i] * 20 + r.next() * 1.2; }));
    recordFixture(fr, ctx, { w: sc.w, k: sc.k, tw: sc.tw, len: sc.len, crystal: sc.crystal, perf, ids: ctx.ids, how: 'quick' });
  });
  return true;
}
