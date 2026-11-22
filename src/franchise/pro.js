// Pro League: 16 fixed AI teams, one short season every ISO week, the same for every player.
// Everything is a pure function of the week index (and PRO_SEED), so the client, the Worker (prediction
// scoring) and tools/franchise_sim.mjs --pro all see the same league without storing or sending it.
//
// A week: Monday-Friday five matchdays of division play (East and West, 8 teams each, 4 matches per division
// per day), Saturday the semifinals (East #1 v West #2, West #1 v East #2), Sunday the Final. A matchday
// resolves at 18:00 UTC; predictions for it lock at that moment. Matches use the quick-resolve model
// (src/franchise/model.js winProb/quickScore): about 0.05 ms per match, so a whole week costs under 1 ms.
import { HERO_BY_ID, HEROES, ROLES } from '../data/heroes.js';
import { PRO_TEAMS, PRO_DIVS } from './data.js';
import { hseed, rngOf, winProb, quickScore, clamp } from './model.js';

export const PRO_SEED = 0x5a17e;
export const PRO_K = 40; // the Pro League's own model: established pro teams are more consistent than the 5v5 edge alone
export const PRO_BY_ID = Object.fromEntries(PRO_TEAMS.map((t) => [t.id, t]));
const DAY = 86400000, HOUR = 3600000;
export const RESOLVE_HOUR = 18;          // UTC
export const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const DAY_LABEL = ['Matchday 1', 'Matchday 2', 'Matchday 3', 'Matchday 4', 'Matchday 5', 'Semifinals', 'Final'];
const EPOCH_MONDAY = Date.UTC(1970, 0, 5);  // the first Monday after the epoch

// Week index (Monday 00:00 UTC based) for a time in ms, and the ISO week label (e.g. "2026-W48").
export const weekIndex = (ms) => Math.floor((ms - EPOCH_MONDAY) / (7 * DAY));
export const weekStart = (w) => EPOCH_MONDAY + w * 7 * DAY;
export function weekLabel(w) {
  const d = new Date(weekStart(w) + 3 * DAY); // ISO: the week's Thursday decides the year
  const y = d.getUTCFullYear(), jan4 = Date.UTC(y, 0, 4), wk1 = jan4 - ((new Date(jan4).getUTCDay() + 6) % 7) * DAY;
  return `${y}-W${String(1 + Math.round((weekStart(w) - wk1) / (7 * DAY))).padStart(2, '0')}`;
}
export const resolveAt = (w, day) => weekStart(w) + day * DAY + RESOLVE_HOUR * HOUR;
// How many matchdays of week w have resolved at time ms (0-7).
export function daysDone(w, ms) { let n = 0; while (n < 7 && ms >= resolveAt(w, n)) n++; return n; }

// Team strength for a week: base + a slow drift (6-week blocks, interpolated) + this week's form.
// Units: the average hero edge of the quick model (0.01 = +1%).
function noise(t, k) { return (rngOf(PRO_SEED, t, k).next() * 2 - 1); }
export function proStrength(ti, w) {
  const tm = PRO_TEAMS[ti], b = Math.floor(w / 6), f = (w - b * 6) / 6;
  const drift = noise(ti, b) * (1 - f) + noise(ti, b + 1) * f;
  const form = noise(ti, 100000 + w);
  return ((tm.base - 72) * 0.5 + drift * 2 + form * 1) / 100;
}
// This week's five starters (one per role): signature heroes first, then a seeded pick of the rest.
export function proLineup(ti, w) {
  const tm = PRO_TEAMS[ti], r = rngOf(PRO_SEED, ti, w, 7), used = new Set(), out = [];
  for (const role of ROLES) {
    const sig = tm.sig.filter((id) => HERO_BY_ID[id] && HERO_BY_ID[id].role === role && !used.has(id));
    const pool = sig.length && r.next() < 0.8 ? sig : HEROES.filter((h) => h.role === role && !used.has(h.id)).map((h) => h.id);
    const id = pool[r.int(pool.length)]; used.add(id); out.push(id);
  }
  return out;
}

// Division round robin (circle method) for 8 teams: 7 rounds; the week plays five of them (seeded).
function rounds(ids) {
  const a = ids.slice(), out = [];
  for (let k = 0; k < a.length - 1; k++) {
    const rd = []; for (let i = 0; i < a.length / 2; i++) rd.push(k % 2 ? [a[a.length - 1 - i], a[i]] : [a[i], a[a.length - 1 - i]]);
    out.push(rd); a.splice(1, 0, a.pop());
  }
  return out;
}
// Points for a correct prediction: more for an underdog (favourite at 80% = 7, coin flip = 10, 20% underdog = 13).
export const pickPoints = (pPicked) => Math.round(5 + 10 * (1 - pPicked));

const cache = new Map();
// The whole week, resolved: { w, label, str[16], lineups[16], days: [{ day, at, matches: [{ a, b, p, w, k, len, seed,
//   featured }] }], table: { East: [...], West: [...] }, champion, finalist }. Results exist for every day (the
// UI only shows the ones whose time has come).
export function proWeek(w) {
  if (cache.has(w)) return cache.get(w);
  const n = PRO_TEAMS.length, str = PRO_TEAMS.map((_, i) => proStrength(i, w)), lineups = PRO_TEAMS.map((_, i) => proLineup(i, w));
  const r = rngOf(PRO_SEED, w, 1);
  const play = (a, b, day, i) => {
    const p = winProb(str[a], str[b], PRO_K), seed = hseed(PRO_SEED, w, day, i, a, b);
    const sc = quickScore(rngOf(seed), str[a], str[b], p);
    return { a, b, p: Math.round(p * 1000) / 1000, w: sc.w, k: sc.k, len: sc.len, seed };
  };
  const divs = [0, 1].map((d) => { const ids = Array.from({ length: n / 2 }, (_, i) => d * (n / 2) + i); for (let i = ids.length - 1; i > 0; i--) { const j = r.int(i + 1); [ids[i], ids[j]] = [ids[j], ids[i]]; } return rounds(ids); });
  const pickR = [0, 1, 2, 3, 4, 5, 6]; for (let i = 6; i > 0; i--) { const j = r.int(i + 1); [pickR[i], pickR[j]] = [pickR[j], pickR[i]]; }
  const days = [];
  const rec = PRO_TEAMS.map(() => ({ w: 0, l: 0, kd: 0 }));
  for (let d = 0; d < 5; d++) {
    const ms = [...divs[0][pickR[d]], ...divs[1][pickR[d]]].map(([a, b], i) => play(a, b, d, i));
    for (const m of ms) { const win = m.w === 0 ? m.a : m.b, lose = m.w === 0 ? m.b : m.a; rec[win].w++; rec[lose].l++; rec[m.a].kd += m.k[0] - m.k[1]; rec[m.b].kd += m.k[1] - m.k[0]; }
    days.push({ day: d, at: resolveAt(w, d), matches: ms });
  }
  const table = Object.fromEntries(PRO_DIVS.map((name, d) => [name, Array.from({ length: n / 2 }, (_, i) => d * (n / 2) + i)
    .map((t) => ({ t, ...rec[t] })).sort((x, y) => y.w - x.w || y.kd - x.kd || str[y.t] - str[x.t] || x.t - y.t)]));
  const [e, wst] = [table[PRO_DIVS[0]], table[PRO_DIVS[1]]];
  const semis = [play(e[0].t, wst[1].t, 5, 0), play(wst[0].t, e[1].t, 5, 1)];
  days.push({ day: 5, at: resolveAt(w, 5), matches: semis });
  const fa = semis[0].w === 0 ? semis[0].a : semis[0].b, fb = semis[1].w === 0 ? semis[1].a : semis[1].b;
  const fin = play(fa, fb, 6, 0);
  days.push({ day: 6, at: resolveAt(w, 6), matches: [fin] });
  // featured: the closest match of each day (the Final always)
  for (const dd of days) { let best = dd.matches[0]; for (const m of dd.matches) if (Math.abs(m.p - 0.5) < Math.abs(best.p - 0.5)) best = m; best.featured = true; }
  const out = { w, label: weekLabel(w), str, lineups, days, table, champion: fin.w === 0 ? fin.a : fin.b, finalist: fin.w === 0 ? fin.b : fin.a };
  if (cache.size > 12) cache.delete(cache.keys().next().value);
  cache.set(w, out);
  return out;
}
// Standings after `done` matchdays (for the live table during the week).
export function tableAfter(L, done) {
  const n = PRO_TEAMS.length, rec = PRO_TEAMS.map(() => ({ w: 0, l: 0, kd: 0 }));
  for (const dd of L.days.slice(0, Math.min(5, done))) for (const m of dd.matches) {
    const win = m.w === 0 ? m.a : m.b, lose = m.w === 0 ? m.b : m.a; rec[win].w++; rec[lose].l++; rec[m.a].kd += m.k[0] - m.k[1]; rec[m.b].kd += m.k[1] - m.k[0];
  }
  return Object.fromEntries(PRO_DIVS.map((name, d) => [name, Array.from({ length: n / 2 }, (_, i) => d * (n / 2) + i)
    .map((t) => ({ t, ...rec[t] })).sort((x, y) => y.w - x.w || y.kd - x.kd || L.str[y.t] - L.str[x.t] || x.t - y.t)]));
}
// Matches of a day that can be predicted at time ms (the day has not resolved; the playoff pairings are known).
export function openDay(L, ms) {
  for (const dd of L.days) {
    if (ms >= dd.at) continue;
    if (dd.day === 5 && ms < L.days[4].at) return null; // semifinal pairings wait for Friday's results
    if (dd.day === 6 && ms < L.days[5].at) return null;
    return dd;
  }
  return null;
}
// Score a set of picks: picks = { [day]: [side per match (0 = a, 1 = b, -1 none)] }. Only resolved days count.
export function scorePicks(w, picks, ms) {
  const L = proWeek(w), done = daysDone(w, ms);
  let pts = 0, right = 0, made = 0;
  for (let d = 0; d < done; d++) {
    const ps = picks && picks[d]; if (!Array.isArray(ps)) continue;
    L.days[d].matches.forEach((m, i) => {
      const s = ps[i]; if (s !== 0 && s !== 1) return;
      made++;
      if (s === m.w) { right++; pts += pickPoints(s === 0 ? m.p : 1 - m.p); }
    });
  }
  return { pts, right, made };
}
// Hall of fame: champions of the last `n` weeks before (and including, once Sunday has resolved) week w.
export function hallOfFame(w, ms, n = 12) {
  const out = [], titles = {};
  for (let k = w; k > w - 60 && out.length < n; k--) {
    if (daysDone(k, ms) < 7) continue;
    const L = proWeek(k); out.push({ w: k, label: L.label, champion: L.champion, finalist: L.finalist });
  }
  for (let k = w; k > w - 52; k--) { if (daysDone(k, ms) < 7) continue; const c = proWeek(k).champion; titles[c] = (titles[c] || 0) + 1; }
  return { recent: out, titles: Object.entries(titles).map(([t, c]) => ({ t: +t, c })).sort((a, b) => b.c - a.c || a.t - b.t) };
}
