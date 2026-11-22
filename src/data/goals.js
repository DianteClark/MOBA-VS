// Daily coaching goals and Season 2 story events (data + per-match progress).
// A goal's `inc(m)` returns how much one finished match adds; m is the match context built in src/meta.js:
//   { won, calls, my, game, mode, rush, comp, clans, kami, oni, kraken, towers, kills, tactics, moments, map, clanHeroes }
// Every match counts (vs AI, online, cups, co-op, Lane Rush), except matches you only watched.

export const GOALS = {
  calls3: { text: 'Land 3 successful calls', n: 3, tier: 0, inc: (m) => m.calls },
  play2: { text: 'Coach 2 matches', n: 2, tier: 0, inc: () => 1 },
  tactic3: { text: 'Play 3 tactic cards', n: 3, tier: 0, inc: (m) => m.tactics },
  moment2: { text: 'Use 2 Coach Moments', n: 2, tier: 0, inc: (m) => m.moments },
  win1: { text: 'Win a match', n: 1, tier: 1, inc: (m) => (m.won ? 1 : 0) },
  kami2: { text: 'Take 2 Kami', n: 2, tier: 1, inc: (m) => m.kami },
  oni: { text: 'Take the Oni', n: 1, tier: 1, inc: (m) => m.oni },
  towers5: { text: 'Destroy 5 towers', n: 5, tier: 1, inc: (m) => m.towers },
  kills20: { text: 'Score 20 kills', n: 20, tier: 1, inc: (m) => m.kills },
  calls6: { text: 'Land 6 successful calls', n: 6, tier: 1, inc: (m) => m.calls },
  dive: { text: 'Win with a Dive comp', n: 1, tier: 2, inc: (m) => (m.won && m.comp === 'dive' ? 1 : 0) },
  poke: { text: 'Win with a Poke comp', n: 1, tier: 2, inc: (m) => (m.won && m.comp === 'poke' ? 1 : 0) },
  protect: { text: 'Win with a Protect comp', n: 1, tier: 2, inc: (m) => (m.won && m.comp === 'protect' ? 1 : 0) },
  teamfight: { text: 'Win with a Teamfight comp', n: 1, tier: 2, inc: (m) => (m.won && m.comp === 'teamfight' ? 1 : 0) },
  kraken: { text: 'Slay the Kraken', n: 1, tier: 2, inc: (m) => m.kraken },
  clan3: { text: 'Win with 3 heroes of one clan', n: 1, tier: 2, inc: (m) => (m.won && m.clans >= 3 ? 1 : 0) },
  win2: { text: 'Win 2 matches', n: 2, tier: 2, inc: (m) => (m.won ? 1 : 0) },
  rushwin: { text: 'Win a Lane Rush match', n: 1, tier: 2, inc: (m) => (m.won && m.rush ? 1 : 0) },
};
export const GOAL_IDS = Object.keys(GOALS);
export const GOAL_REWARD = { xp: 100, allXp: 150 }; // season pass XP per goal, and for all three
export const REROLLS = 1; // per day

const hash = (...xs) => { let h = 2166136261; for (const x of xs) { h ^= x | 0; h = Math.imul(h, 16777619); h ^= h >>> 13; } return h >>> 0; };
export const dayOf = (now = Date.now()) => Math.floor(now / 86400000); // UTC day number
// The day's three goals: one per tier (easy, medium, hard), the same for everyone that day.
export function dailyGoals(day) {
  return [0, 1, 2].map((t) => { const ids = GOAL_IDS.filter((k) => GOALS[k].tier === t); return ids[hash(day, t) % ids.length]; });
}
// A reroll replaces slot i with another goal of the same tier that is not already on the list.
export function rerollGoal(day, list, i, n) {
  const t = GOALS[list[i]].tier, ids = GOAL_IDS.filter((k) => GOALS[k].tier === t && !list.includes(k));
  return ids.length ? ids[hash(day, i, n + 1, 99) % ids.length] : list[i];
}

// ── Season 2 story events: three short timed weeks, each with three themed objectives and a reward ──
export const STORY = [
  { id: 'parade', season: 2, name: 'The Lantern Parade', start: '2027-02-08', end: '2027-02-14', color: '#ffae4a',
    blurb: 'Paper lanterns drift over the marsh and the spirits come to watch. Show them a good game.',
    goals: [
      { text: 'Win 3 matches', n: 3, inc: (m) => (m.won ? 1 : 0) },
      { text: 'Land 12 successful calls', n: 12, inc: (m) => m.calls },
      { text: 'Field 6 Spirit heroes', n: 6, inc: (m) => m.clanHeroes.spirit || 0 },
    ],
    reward: { kind: 'border', id: 'lantern' } },
  { id: 'hyakki', season: 2, name: 'Night of a Hundred Yokai', start: '2027-03-01', end: '2027-03-07', color: '#c99bff',
    blurb: 'The hundred demons march at midnight. Hunt the great spirits before dawn.',
    goals: [
      { text: 'Take 6 Kami', n: 6, inc: (m) => m.kami },
      { text: 'Win 2 matches on Moonlit Marsh', n: 2, inc: (m) => (m.won && m.map === 'marsh' ? 1 : 0) },
      { text: 'Slay 2 Kraken', n: 2, inc: (m) => m.kraken },
    ],
    reward: { kind: 'skin', id: 'leg_raiden', also: { kind: 'title', id: 'hyakki' } } },
  { id: 'festival', season: 2, name: 'Moon Festival', start: '2027-03-29', end: '2027-04-04', color: '#fff6dc',
    blurb: 'The full moon festival: the shrine keepers reward the boldest coaches.',
    goals: [
      { text: 'Win 4 matches', n: 4, inc: (m) => (m.won ? 1 : 0) },
      { text: 'Use 6 Coach Moments', n: 6, inc: (m) => m.moments },
      { text: 'Destroy 15 towers', n: 15, inc: (m) => m.towers },
    ],
    reward: { kind: 'banner', id: 'moonShrine', also: { kind: 'title', id: 'festival' } } },
];
export const STORY_XP = 150; // season pass XP per story objective
const day = (s) => Date.parse(s + 'T00:00:00Z');
export const storyOpen = (e, now = Date.now()) => now >= day(e.start) && now < day(e.end) + 86400000;
export const storyAt = (now = Date.now()) => STORY.find((e) => storyOpen(e, now)) || null;
export const storyNext = (now = Date.now()) => STORY.filter((e) => day(e.start) > now).sort((a, b) => day(a.start) - day(b.start))[0] || null;
export const storyLeft = (e, now = Date.now()) => Math.max(0, Math.ceil((day(e.end) + 86400000 - now) / 86400000));
export const storyIn = (e, now = Date.now()) => Math.max(0, Math.ceil((day(e.start) - now) / 86400000));
