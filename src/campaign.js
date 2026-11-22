// Story campaign + guided first match: progress, unlocks, sessions and results (the data: src/data/campaign.js;
// the screens: src/ui/campaign.js; the in-match guide: src/ui/tutorial.js).
// Progress lives in the profile, small and bounded (synced with the cloud copy):
//   profile.d.camp = { m: { missionId: goal mask (bit i = goal i met in a won match) }, ch: { n: 1 intro seen | 2 outro seen },
//                      tut: { stage: 0 new | 1 draft done | 2 prep done | 3 finished, s: [lesson ids seen], offered, paid, skip } }
// Campaign matches are vs AI, offline-capable and never rated (history key 'story'); their only reward is Koban,
// granted through grantKoban (src/koban.js), once per star.
import { Rng } from './sim/rng.js';
import { profile } from './profile.js';
import { RIVAL_BY_ID } from './data/rivals.js';
import { MISSIONS, MISSION_BY_ID, CHAPTERS, TUTORIAL, TUTORIAL_KOBAN, missionOutcome, starKoban, starsOf, missionsOf } from './data/campaign.js';
import { grantKoban } from './koban.js';

const SEEN_MAX = 40;
export function camp() {
  const d = profile.d;
  if (!d.camp || typeof d.camp !== 'object') d.camp = {};
  const c = d.camp;
  if (!c.m || typeof c.m !== 'object') c.m = {};
  if (!c.ch || typeof c.ch !== 'object') c.ch = {};
  if (!c.tut || typeof c.tut !== 'object') c.tut = { stage: 0, s: [] };
  if (!Array.isArray(c.tut.s)) c.tut.s = [];
  for (const k of Object.keys(c.m)) if (!MISSION_BY_ID[k]) delete c.m[k]; // bounded: known missions only
  return c;
}
export const maskOf = (id) => (camp().m[id] | 0) & 7;
export const cleared = (id) => !!(maskOf(id) & 1);
export const missionStars = (id) => starsOf(maskOf(id));
export const totalStars = () => MISSIONS.reduce((a, m) => a + missionStars(m.id), 0);
export const MAX_STARS = MISSIONS.length * 3;
// Missions open in order: each needs the one before it cleared (a won match).
export function unlocked(id) { const i = MISSIONS.findIndex((m) => m.id === id); return i === 0 || (i > 0 && cleared(MISSIONS[i - 1].id)); }
export const chapterOpen = (n) => unlocked(missionsOf(n)[0].id);
export const chapterDone = (n) => cleared(missionsOf(n)[4].id);
// The mission to play next (the first not cleared), or null when the whole campaign is won.
export const nextMission = () => MISSIONS.find((m) => !cleared(m.id)) || null;
export const currentChapter = () => { const m = nextMission(); return m ? m.ch : CHAPTERS[CHAPTERS.length - 1].n; };
export const chapterSeen = (n, bit) => !!((camp().ch[n] | 0) & bit);
export function markChapter(n, bit) { const c = camp(); c.ch[n] = (c.ch[n] | 0) | bit; profile.save(); }

// ── tutorial progress ──
export const tut = () => camp().tut;
export const tutorialDone = () => tut().stage >= 3 || !!tut().skip;
export const lessonSeen = (id) => tut().s.includes(id);
export function markLesson(id) { const t = tut(); if (!t.s.includes(id)) { t.s.push(id); if (t.s.length > SEEN_MAX) t.s.shift(); profile.save(); } }
export function tutStage(n) { const t = tut(); if (n > (t.stage | 0)) { t.stage = n; profile.save(); } }
export function skipTutorial() { const t = tut(); t.skip = 1; t.offered = 1; profile.save(); }
// First launch: a brand-new coach (no match played) is offered the guided match once.
export const shouldOffer = () => !profile.d.history.length && !tut().offered && !tutorialDone();
export function markOffered() { tut().offered = 1; profile.save(); }
// Started part-way (a quit match): the draft lessons already seen → straight to prep with the academy squad.
export const tutorialResumes = () => (tut().stage | 0) >= 1 && !tutorialDone();

// The rival a mission faces ('nemesis': the coach who beat you most, else Goro).
export function rivalOf(m) {
  if (m.rival === 'nemesis') { const n = profile.nemesis && profile.nemesis(); return RIVAL_BY_ID[n] || RIVAL_BY_ID.goro; }
  return RIVAL_BY_ID[m.rival] || RIVAL_BY_ID.goro;
}

// ── sessions ──
// A mission (or the tutorial) as a vs-AI session: the app's normal draft → prep → match flow reads
// s.mission (fixed squad, preset plan, cfg.mission rules) and s.tutorial (guide, no draft / prep clock).
function session(app, m, extra) {
  const seed = (Math.random() * 2 ** 31) >>> 0, rv = rivalOf(m), gameMode = m.mode === 'rush' ? 'rush' : 'classic';
  return { mode: 'ai', gameMode, myTeam: 0, seed, mapId: m.map, aiLevel: m.lvl, names: [app.name, rv.name], rng: new Rng(seed ^ 0x5eed),
    rival: rv.id, event: m.event || null, mission: m, ...extra };
}
export function startMission(app, id) {
  const m = MISSION_BY_ID[id]; if (!m || !unlocked(id)) return false;
  app.immersive();
  app.session = session(app, m, {});
  app.startDraft();
  return true;
}
export function startTutorial(app) {
  markOffered();
  const t = tut(); if (t.skip && t.stage < 3) t.skip = 0; // replaying it turns the guide back on
  if (t.stage >= 3) { t.stage = 0; t.s = []; } // a finished academy replays from the start
  profile.save();
  const resume = tutorialResumes();
  app.immersive();
  app.session = session(app, { ...TUTORIAL, squad: resume ? TUTORIAL.squad : null }, { tutorial: true, noClock: true });
  app.startDraft();
}

// ── results ──
// A finished campaign match: the stars, the Koban for new stars, and what comes next. Saves progress.
export function recordMission(s, game) {
  const m = s.mission, my = s.myTeam;
  if (s.tutorial) {
    const t = tut(), first = !t.paid, won = game.winner === my;
    t.stage = 3; t.skip = 0;
    const koban = first ? grantKoban(TUTORIAL_KOBAN, 'tutorial') : 0;
    if (first) t.paid = 1;
    profile.d.tips = Object.assign(profile.d.tips || {}, { calls: 1, ring: 1, stance: 1, moments: 1 }); // the academy taught the coach tips
    profile.save();
    return { tutorial: true, won, koban, next: nextMission() };
  }
  const out = missionOutcome(m, game, my), prev = maskOf(m.id), mask = prev | out.mask;
  const firstClear = !(prev & 1) && !!(mask & 1);
  if (mask !== prev) { camp().m[m.id] = mask; }
  const koban = starKoban(m, prev, out.mask) ? grantKoban(starKoban(m, prev, out.mask), 'campaign:' + m.id) : 0;
  profile.save();
  const i = MISSIONS.indexOf(m), next = MISSIONS[i + 1] || null;
  return { m, out, prev, mask, koban, firstClear, bossDown: firstClear && !!m.boss, next: next && unlocked(next.id) ? next : null, last: !MISSIONS[i + 1] };
}
