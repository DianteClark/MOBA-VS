// Hero Mastery: every hero levels 1-10 from the matches you coach with it.
// Points per match: played 40, win +60, MVP +30, Play of the Game +50, and +15 for each of your
// calls that hero answered and that paid off (max 3). Stored in the profile (cloud-saved).
// Rewards: a mastery badge (draft cards, Dojo), titles at 4 / 7 / 10, the hero's Signature skin (5) and two sprite tints (6, 10).
import { HERO_SKINS, SIG_MASTERY, sigKey } from './data/skins.js';

export const MASTERY_MAX = 10;
// Total points needed to reach each level (index = level).
export const MASTERY_AT = [0, 0, 100, 250, 450, 700, 1000, 1350, 1750, 2200, 2750];
export const MASTERY_PTS = { play: 40, win: 60, mvp: 30, potg: 50, call: 15, callCap: 3 };
export const MASTERY_TITLES = { 4: 'Adept', 7: 'Master', 10: 'Sensei' };
export const MASTERY_TINTS = { 6: 'mastery', 10: 'sensei' };
// Badge colours by level band.
export const masteryColor = (lv) => (lv >= 10 ? '#ffe08a' : lv >= 7 ? '#ffd84a' : lv >= 4 ? '#c9d6e6' : '#d08a4e');

export function masteryLevel(pts = 0) { let lv = 1; for (let l = 2; l <= MASTERY_MAX; l++) if (pts >= MASTERY_AT[l]) lv = l; return lv; }
export function masteryInfo(pts = 0) {
  const lv = masteryLevel(pts), max = lv >= MASTERY_MAX;
  return { lv, pts, max, into: max ? 1 : (pts - MASTERY_AT[lv]) / (MASTERY_AT[lv + 1] - MASTERY_AT[lv]), toNext: max ? 0 : MASTERY_AT[lv + 1] - pts };
}
// Title keys are 'm:<heroId>:<level>' so they live alongside the season titles in the profile.
export const masteryTitleKey = (id, lv) => `m:${id}:${lv}`;
export function masteryTitleName(key, heroName) {
  const m = /^m:([a-z0-9_]+):(\d+)$/.exec(key || ''); if (!m) return null;
  return `${heroName || m[1]} ${MASTERY_TITLES[+m[2]] || 'Adept'}`;
}
// Rewards unlocked when going from level a to level b.
export function masteryRewards(id, a, b) {
  const out = [];
  for (let l = a + 1; l <= b; l++) {
    if (MASTERY_TITLES[l]) out.push({ kind: 'title', id: masteryTitleKey(id, l), hero: id, lv: l });
    if (MASTERY_TINTS[l]) out.push({ kind: 'tint', id: MASTERY_TINTS[l], hero: id, lv: l });
    if (l === SIG_MASTERY && HERO_SKINS[sigKey(id)]) out.push({ kind: 'skin', id: sigKey(id), hero: id, lv: l });
  }
  return out;
}
// Points for one hero from a finished match.
export function matchPoints(game, hero, myTeam, { mvp, potgHero } = {}) {
  const won = game.winner === myTeam;
  const parts = [['Played', MASTERY_PTS.play]];
  if (won) parts.push(['Win', MASTERY_PTS.win]);
  const calls = game.callLog.filter((c) => c.team === myTeam && c.result === 'success' && (c.heroes || []).includes(hero.id)).length;
  if (calls) parts.push([`${Math.min(calls, MASTERY_PTS.callCap)} good call${calls > 1 ? 's' : ''}`, Math.min(calls, MASTERY_PTS.callCap) * MASTERY_PTS.call]);
  if (mvp && mvp.id === hero.heroId && mvp.team === myTeam) parts.push(['MVP', MASTERY_PTS.mvp]);
  if (potgHero && potgHero === hero.heroId) parts.push(['Play of the Game', MASTERY_PTS.potg]);
  return { parts, total: parts.reduce((a, p) => a + p[1], 0) };
}
