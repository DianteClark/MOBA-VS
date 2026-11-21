// Season Cup: an 8-team single-elimination bracket. You vs seven AI teams.
// AI-vs-AI matches in the bracket are resolved from team strength (no 15-minute wait).
import { profile } from './profile.js';
import { HEROES } from './data/heroes.js';

export const CUP_TEAMS = [
  { name: 'Stone Lanterns', lvl: 0, crest: 'totem' }, { name: 'Moonlit Foxes', lvl: 0, crest: 'shuri' },
  { name: 'Tide Callers', lvl: 1, crest: 'marlowe' }, { name: 'Iron Ravens', lvl: 1, crest: 'karasu' },
  { name: 'Ember Fangs', lvl: 1, crest: 'ember' }, { name: 'Jade Tigers', lvl: 2, crest: 'leonin' },
  { name: 'Crimson Oni', lvl: 2, crest: 'varro' },
];
export const ROUND_NAMES = ['Quarterfinal', 'Semifinal', 'Grand Final'];
const valid = (id) => HEROES.some((h) => h.id === id) ? id : HEROES[0].id;

export function newCup(myName) {
  const ai = CUP_TEAMS.map((t) => ({ ...t, crest: valid(t.crest) }));
  // Seeding: you face a weaker team first; the two strongest are on opposite sides.
  const order = [null, ai[0], ai[2], ai[5], ai[3], ai[1], ai[4], ai[6]];
  const teams = order.map((t, i) => (i === 0 ? { name: myName, lvl: -1, crest: 'kaze', you: true } : t));
  const r0 = [0, 2, 4, 6].map((i) => ({ a: i, b: i + 1, w: null }));
  const cup = { season: profile.season.id, started: Date.now(), teams, rounds: [r0], round: 0, done: false, result: null, seed: (Math.random() * 1e9) | 0 };
  profile.d.cup = cup; profile.save();
  return cup;
}
export function myMatch(cup) {
  if (cup.done) return null;
  const r = cup.rounds[cup.round];
  const m = r.find((x) => (cup.teams[x.a].you || cup.teams[x.b].you) && x.w === null);
  if (!m) return null;
  const opp = cup.teams[m.a].you ? m.b : m.a;
  return { match: m, opp: cup.teams[opp], oppIdx: opp, round: cup.round };
}
function rnd(cup) { cup.seed = (cup.seed * 1103515245 + 12345) & 0x7fffffff; return cup.seed / 0x7fffffff; }
// Your result is in: resolve the rest of the round, build the next one.
export function recordCup(cup, won) {
  const mm = myMatch(cup); if (!mm) return null;
  const me = cup.teams.findIndex((t) => t.you);
  mm.match.w = won ? me : mm.oppIdx;
  for (const m of cup.rounds[cup.round]) {
    if (m.w !== null) continue;
    const la = cup.teams[m.a].lvl, lb = cup.teams[m.b].lvl;
    m.w = rnd(cup) < 0.5 + 0.17 * (la - lb) ? m.a : m.b;
  }
  const out = { won, round: cup.round, rewards: [] };
  if (!won) {
    cup.done = true; cup.result = cup.round === 2 ? 'runner-up' : 'out';
    if (cup.round === 2) { profile.d.trophies.silver++; out.rewards.push({ kind: 'trophy', id: 'silver' }); }
    // finish the bracket for display
    while (cup.round < 2) advance(cup);
    if (cup.round === 2 && cup.rounds[2] && cup.rounds[2][0].w === null) { const m = cup.rounds[2][0]; m.w = rnd(cup) < 0.5 + 0.17 * (cup.teams[m.a].lvl - cup.teams[m.b].lvl) ? m.a : m.b; }
  } else if (cup.round === 2) {
    cup.done = true; cup.result = 'champion';
    profile.d.trophies.gold++; out.rewards.push({ kind: 'trophy', id: 'gold' });
    const u = []; profile.unlock({ kind: 'title', id: 'champ' }, u); profile.unlock({ kind: 'banner', id: 'gold' }, u);
    if (profile.d.trophies.gold >= 3) profile.unlock({ kind: 'title', id: 'tripleChamp' }, u);
    out.rewards.push(...u);
  } else advance(cup);
  profile.save();
  return out;
}
function advance(cup) {
  const prev = cup.rounds[cup.round];
  const next = [];
  for (let i = 0; i < prev.length; i += 2) next.push({ a: prev[i].w, b: prev[i + 1].w, w: null });
  cup.rounds.push(next); cup.round++;
  if (cup.done) for (const m of next) if (m.w === null) m.w = rnd(cup) < 0.5 + 0.17 * (cup.teams[m.a].lvl - cup.teams[m.b].lvl) ? m.a : m.b;
}
