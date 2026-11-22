// Franchise mode: the market. Signing free agents, releasing heroes and trading with the AI franchises.
// AI teams judge a trade with the same value model they use to build (src/franchise/model.js valueOf + their GM
// style), want a small edge, and never take a deal that breaks their roles, roster size or budget.
import { HERO_BY_ID } from '../data/heroes.js';
import * as D from './data.js';
import { salaryFor, valueOf, coversRoles, clamp } from './model.js';
import { rosterOf, payroll, news } from './league.js';

export const freeAgents = (fr) => Object.values(fr.h).filter((x) => x.t === -1).sort((a, b) => b.o - a.o || b.p - a.p);
export const marketOpen = (fr) => fr.phase !== 'playoffs';
export const tradeOpen = (fr) => fr.phase === 'offseason' ? fr.off && fr.off.step === 'fa' : fr.phase === 'season' && fr.round < D.TRADE_DEADLINE;
// Releasing costs dead money: half of this season's salary (in the offseason: half of next season's).
export const releaseCost = (x) => Math.round(x.s * 0.5);

// Can you sign this free agent? Returns '' when you can, else the reason.
export function signBlock(fr, id) {
  const x = fr.h[id];
  if (!x || x.t !== -1) return 'Not a free agent';
  if (!marketOpen(fr)) return 'The market is closed during the playoffs';
  if (fr.phase === 'offseason' && fr.off.step !== 'fa') return 'Free agency opens after the draft';
  if (rosterOf(fr, 0).length >= D.ROSTER_MAX) return `Roster full (${D.ROSTER_MAX})`;
  const ask = salaryFor(x.o, x.p, x.a);
  if (payroll(fr, 0) + ask > fr.teams[0].bud) return `Needs ${ask}k: only ${Math.max(0, fr.teams[0].bud - payroll(fr, 0))}k of budget left`;
  return '';
}
export function sign(fr, id, years) {
  if (signBlock(fr, id)) return false;
  const x = fr.h[id];
  x.t = 0; x.s = salaryFor(x.o, x.p, x.a); x.y = clamp(years | 0, 1, 3); x.b = 0; x.m = 66; x.ys = 0; x.f = 0; x.fo = 0; x.inj = 0;
  news(fr, `${fr.teams[0].name} sign ${HERO_BY_ID[id].name} (${x.y} season${x.y > 1 ? 's' : ''}, ${x.s}k).`);
  return true;
}
export function releaseBlock(fr, id) {
  const x = fr.h[id], ros = rosterOf(fr, 0);
  if (!x || x.t !== 0) return 'Not on your roster';
  if (!marketOpen(fr)) return 'The market is closed during the playoffs';
  if (ros.length <= 5) return 'You need at least five heroes';
  if (!coversRoles(ros.filter((y) => y !== x))) return 'Nobody else could play their role';
  return '';
}
export function release(fr, id) {
  if (releaseBlock(fr, id)) return false;
  const x = fr.h[id], tm = fr.teams[0], cost = releaseCost(x);
  if (fr.phase === 'offseason') tm.deadNext = (tm.deadNext || 0) + cost; else tm.dead = (tm.dead || 0) + cost;
  x.t = -1; x.y = 0; x.s = salaryFor(x.o, x.p, x.a); x.b = 0; x.ys = 0; x.m = Math.max(30, x.m - 10);
  if (fr.lineup) fr.lineup = fr.lineup.filter((k) => k !== id);
  news(fr, `${tm.name} release ${HERO_BY_ID[id].name} (${cost}k dead money).`);
  return true;
}

// ── trades ──
// give: your hero ids (1-2), get: their hero ids (0-2). Returns { ok, why, mine, theirs, need } where mine/theirs are
// the value of each side to the AI, and need is how much more value they want (0 when accepted).
export function evalTrade(fr, t, give, get) {
  const tm = fr.teams[t], st = tm.gm;
  const G = give.map((id) => fr.h[id]), R = get.map((id) => fr.h[id]);
  const out = (ok, why, extra = {}) => ({ ok, why, mine: 0, theirs: 0, need: 0, ...extra });
  if (!tradeOpen(fr)) return out(false, fr.phase === 'season' ? `Trade deadline passed (round ${D.TRADE_DEADLINE})` : 'Trades open in free agency');
  if (!G.length || G.length > 2 || R.length > 2) return out(false, 'Offer one or two heroes for up to two');
  if (G.some((x) => !x || x.t !== 0) || R.some((x) => !x || x.t !== t)) return out(false, 'Pick heroes from both rosters');
  const myAfter = [...rosterOf(fr, 0).filter((x) => !give.includes(x.id)), ...R], theirAfter = [...rosterOf(fr, t).filter((x) => !get.includes(x.id)), ...G];
  if (myAfter.length > D.ROSTER_MAX) return out(false, `Your roster would have ${myAfter.length} (max ${D.ROSTER_MAX})`);
  if (myAfter.length < 5 || !coversRoles(myAfter)) return out(false, 'You could not fill all five roles after this');
  if (theirAfter.length > D.ROSTER_MAX || theirAfter.length < D.ROSTER_MIN) return out(false, `${tm.name} must keep ${D.ROSTER_MIN}-${D.ROSTER_MAX} heroes`);
  if (!coversRoles(theirAfter)) return out(false, `${tm.name} could not fill all five roles`);
  const sal = (xs) => xs.reduce((s, x) => s + x.s, 0);
  if (payroll(fr, 0) - sal(G) + sal(R) > fr.teams[0].bud) return out(false, 'That would put you over your budget');
  if (payroll(fr, t) - sal(R) + sal(G) > tm.bud) return out(false, `${tm.name} cannot fit the salary`);
  // value to them: what they get (plus a little for filling a thin role) vs what they give up
  const ros = rosterOf(fr, t);
  const fills = (x) => { const r = HERO_BY_ID[x.id].role, best = Math.max(0, ...ros.filter((y) => HERO_BY_ID[y.id].roles.includes(r) && !get.includes(y.id)).map((y) => y.o)); return x.o > best ? 2.5 : 0; };
  const mine = Math.round(G.reduce((s, x) => s + valueOf(x, st) + fills(x), 0) * 10) / 10;
  const theirs = Math.round(R.reduce((s, x) => s + valueOf(x, st), 0) * 10) / 10;
  const want = theirs * 1.08 + (R.length ? 1.5 : 0); // they want a small edge for their trouble
  const need = Math.max(0, Math.round((want - mine) * 10) / 10);
  if (need > 0) return out(false, need > 12 ? `${tm.name}: "Not even close."` : need > 4 ? `${tm.name}: "We need more value back."` : `${tm.name}: "Close. Sweeten it a little."`, { mine, theirs, need });
  return out(true, `${tm.name}: "Deal."`, { mine, theirs, need: 0 });
}
export function trade(fr, t, give, get) {
  const ev = evalTrade(fr, t, give, get); if (!ev.ok) return ev;
  for (const id of give) { const x = fr.h[id]; x.t = t; x.b = 0; x.ys = 0; }
  for (const id of get) { const x = fr.h[id]; x.t = 0; x.b = 0; x.ys = 0; x.m = Math.max(x.m, 60); }
  if (fr.lineup) fr.lineup = fr.lineup.filter((k) => !give.includes(k));
  const nm = (ids) => ids.map((id) => HERO_BY_ID[id].name).join(' + ') || 'nothing';
  news(fr, `Trade: ${fr.teams[0].abbr} send ${nm(give)} to ${fr.teams[t].abbr} for ${nm(get)}.`);
  return ev;
}
