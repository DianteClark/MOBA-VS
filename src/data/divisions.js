// Weekly Divisions (pure logic, shared by the game and the Worker: worker/divisions.js imports this file).
// Groups of 30 coaches in a league compete on points from any match during the UTC week (Monday 00:00).
// When the week ends the top 5 move up a league and the bottom 5 move down. Seats nobody real has taken are
// filled by AI placeholders: always shown as "AI", never as people, with points that grow over the week from a
// fixed seed, so the game and the Worker agree on every placement.

export const LEAGUES = [
  { id: 'bronze', name: 'Bronze League', color: '#d08a4e' },
  { id: 'silver', name: 'Silver League', color: '#c9d6e6' },
  { id: 'gold', name: 'Gold League', color: '#ffd84a' },
  { id: 'jade', name: 'Jade League', color: '#5fe0a0' },
  { id: 'oni', name: 'Oni League', color: '#ff8a5a' },
  { id: 'kami', name: 'Kami League', color: '#ff7a9a' },
];
export const GROUP = 30, PROMOTE = 5, DEMOTE = 5;
export const WEEK_MS = 7 * 86400000;
const EPOCH = Date.UTC(2026, 10, 16); // a Monday
export const weekOf = (now = Date.now()) => Math.floor((now - EPOCH) / WEEK_MS);
export const weekStart = (w) => EPOCH + w * WEEK_MS;
export const weekFrac = (w, now = Date.now()) => Math.max(0, Math.min(1, (now - weekStart(w)) / WEEK_MS));

// Points for one match: a win 10, a loss 4, +2 per successful call (max 3 calls).
export const PTS = { win: 10, loss: 4, perCall: 2, callCap: 3 };
export const MAX_MATCH_PTS = PTS.win + PTS.perCall * PTS.callCap;
export const matchPts = (won, calls) => (won ? PTS.win : PTS.loss) + PTS.perCall * Math.min(PTS.callCap, Math.max(0, calls | 0));

// Seeded hash (32-bit) for the AI placeholders.
function hash(...xs) { let h = 2166136261; for (const x of xs) { h ^= x | 0; h = Math.imul(h, 16777619); h ^= h >>> 13; } return h >>> 0; }
const AI_NAMES = ['Kitsune', 'Tanuki', 'Kappa', 'Tengu', 'Oni', 'Yuki', 'Kodama', 'Baku', 'Nue', 'Raiju', 'Inugami', 'Bakeneko', 'Jorogumo', 'Kamaitachi',
  'Ittan', 'Nekomata', 'Hitotsume', 'Umibozu', 'Zashiki', 'Hoko', 'Shisa', 'Komainu', 'Karakasa', 'Amabie', 'Mujina', 'Sazae', 'Tsuchinoko', 'Ushi', 'Hyosube', 'Akaname'];
// AI placeholder i of a group: { ai: true, name, pts } at a point in the week (frac 0..1). Higher leagues play more.
export function aiSeat(week, league, grp, i, frac) {
  const r = hash(week, league, grp, i), r2 = hash(r, 7);
  const target = (40 + league * 22) * (0.35 + (r % 1000) / 1000 * 1.3);  // whole-week points
  const pace = 0.6 + (r2 % 100) / 100 * 0.8;                              // early birds vs late grinders
  // names: a seeded rotation stepping by 7 (coprime with 30), so no name repeats inside a group
  return { ai: true, name: `AI ${AI_NAMES[(hash(week, league, grp) + i * 7) % AI_NAMES.length]}`, pts: Math.round(target * Math.min(1, Math.pow(frac, pace))) };
}
// Fill a group to GROUP seats: real members (with pts) + AI seats, sorted (real players first on ties).
export function fillGroup(week, league, grp, real, frac) {
  const seats = real.slice(0, GROUP).map((m) => ({ ...m, ai: false }));
  for (let i = 0; seats.length < GROUP; i++) seats.push(aiSeat(week, league, grp, i, frac));
  return seats.sort((a, b) => b.pts - a.pts || (a.ai === b.ai ? 0 : a.ai ? 1 : -1));
}
// Final place (1-based) of a member with `pts` in a finished week, among `others` real members' points.
export function finalPlace(week, league, grp, pts, others) {
  let place = 1;
  for (const p of others) if (p > pts) place++;
  for (let i = 0; i < GROUP - 1 - others.length; i++) if (aiSeat(week, league, grp, i, 1).pts > pts) place++;
  return place;
}
// League move for a final place: +1 promote, -1 demote, 0 stay.
export function moveOf(place, league) {
  if (place <= PROMOTE && league < LEAGUES.length - 1) return 1;
  if (place > GROUP - DEMOTE && league > 0) return -1;
  return 0;
}
// Rewards: the first time you reach a league; and +250 season pass XP for a top-5 finish.
export const LEAGUE_REWARDS = {
  3: { kind: 'title', id: 'leagueJade' },
  5: { kind: 'border', id: 'kamiLeague', also: { kind: 'title', id: 'leagueKami' } },
};
export const TOP5_XP = 250;
