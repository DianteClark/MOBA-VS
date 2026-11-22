// Clubs: shared rules for the game and the Worker (worker/clubs.js imports this file). Pure data + helpers.
// A club is up to 30 coaches (owner, officers, members). Members' matches earn weekly club points with the
// Weekly Divisions rule (src/data/divisions.js matchPts: win 10, loss 4, +2 per good call, max 3), counted by
// the server when the division report is accepted (one request per match for both). Clubs climb a weekly
// ladder, are paired for a weekend Club War (Saturday-Sunday UTC) and share three weekly goals.
// Club chat is presets only (no free text, nothing to moderate).
import { weekOf, weekStart, WEEK_MS, matchPts, PTS } from './divisions.js';
export { weekOf, weekStart, WEEK_MS, matchPts };

export const MAX_MEMBERS = 30;
export const ROLES = { owner: 'Owner', officer: 'Officer', member: 'Member' };
export const ROLE_RANK = { owner: 2, officer: 1, member: 0 };
// The weekend war: the last two days of the UTC week (Monday 00:00 start).
export const WAR_FROM = 5 * 86400000;
export const warOpen = (now = Date.now()) => now - weekStart(weekOf(now)) >= WAR_FROM;
export const warStart = (w) => weekStart(w) + WAR_FROM;
export const warEnd = (w) => weekStart(w) + WEEK_MS;

// Crests: one of the pack's emblems (assets/img/crest) on two colours and a pattern (same art as Franchise crests).
export const CREST_EMBLEMS = 17, CREST_PATTERNS = 5;
export const CREST_COLORS = ['#e0453a', '#f08a24', '#f2c12e', '#7cc242', '#2fa36b', '#2bb3b1', '#3b82d6', '#5a5fd6', '#9b59d0', '#d64f9c', '#f4f1e8', '#2b2b3a'];
// Stored as "e.p.c1.c2" (indices): small, and easy to validate on both sides.
export function cleanCrest(v) {
  const m = /^(\d{1,2})\.(\d)\.(\d{1,2})\.(\d{1,2})$/.exec(String(v || ''));
  if (!m) return '0.0.6.2';
  const [e, p, a, b] = m.slice(1).map(Number);
  return `${e % CREST_EMBLEMS}.${p % CREST_PATTERNS}.${a % CREST_COLORS.length}.${b % CREST_COLORS.length}`;
}
export function crestOf(v) { const [e, p, a, b] = cleanCrest(v).split('.').map(Number); return { e, p, c1: CREST_COLORS[a], c2: CREST_COLORS[b] }; }
export const cleanClubName = (n) => String(n || '').replace(/[^\p{L}\p{N} _.'-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 20);
export const cleanTag = (t) => String(t || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
export const CODE_RE = /^[A-Z]{5}$/; // shares the invite system's room-code format (worker/index.js MODES 'club')

// Club chat: preset lines only. A message is an index into CHAT.
export const CHAT = ['Hi club!', 'GG everyone', 'War this weekend: let\'s go!', 'Who wants to play?', 'Nice win!', 'One more goal to go', 'Good luck today', 'Back later', 'Thanks for the invite', 'Club war won!', 'Push the ladder!', 'Rest up, coaches'];

// Weekly club goals (the whole club's matches). Each gives every member pass XP once, claimed from the club page.
export const GOALS = [
  { id: 'g', name: 'Busy week', text: 'Play 25 club matches', need: 25, of: 'g', xp: 120 },
  { id: 'w', name: 'Winning habit', text: 'Win 12 club matches', need: 12, of: 'wins', xp: 150 },
  { id: 'p', name: 'Club climb', text: 'Earn 400 club points', need: 400, of: 'pts', xp: 200 },
];
// Rewards that are not pass XP (cosmetic titles): the first weekend war won, and all three goals in one week.
export const CLUB_TITLES = { clubWar: 'Club War Victor', clubStalwart: 'Club Stalwart' };
export const WAR_REWARD = { kind: 'title', id: 'clubWar' }, GOALS_REWARD = { kind: 'title', id: 'clubStalwart' };
export const WAR_XP = 150;
// Points for one match (the division rule, so both systems always agree).
export const clubPts = (won, calls) => matchPts(won, Math.min(PTS.callCap, Math.max(0, calls | 0)));
