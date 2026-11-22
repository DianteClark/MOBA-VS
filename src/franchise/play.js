// Franchise mode ↔ the app: the saved league (profile.d.fr), starting a fixture as a real 5v5 (your roster is
// your draft: the lineup goes straight to prep), the roster edges in the match cfg, and recording the result.
// Hooks: main.js startPrep (frPrep), endMatch (frRecord + the results panel), profile.record (key 'fr', unrated).
import { ROLES } from '../data/heroes.js';
import { MAPS } from '../maps/defs.js';
import { Rng } from '../sim/rng.js';
import { profile } from '../profile.js';
import * as L from './league.js';
import { FR_VERSION } from './league.js';

// The saved franchise (or null). Saves from a newer/unknown format are ignored rather than half-read.
export function getFr() { const fr = profile.d.fr; return fr && fr.v === FR_VERSION && Array.isArray(fr.teams) ? fr : null; }
export function saveFr(fr) { profile.d.fr = fr; profile.save(); }
export function foundFranchise(opts) { const fr = L.newFranchise({ ...opts, seed: (Math.random() * 2 ** 31) >>> 0 }); fr.diff = opts.diff ?? 1; saveFr(fr); return fr; }
export function retireFranchise() { profile.d.fr = null; profile.save(); }

// Map for a fixture: the playoffs use one map per season, the regular season rotates by round.
function mapFor(fr, fx) {
  const i = fx.kind === 'season' ? fr.season * 7 + fx.round : fr.season * 3 + (fx.kind === 'final' ? 1 : 0);
  return MAPS[((i % MAPS.length) + MAPS.length) % MAPS.length].id;
}

// Play your next fixture as a real match: lineups are fixed by the rosters, so the draft is skipped and the
// coach goes straight to prep (builds, plan, tactic deck). Returns false when there is nothing to play.
export function playFixture(app) {
  const fr = getFr(), fx = fr && L.nextFixture(fr); if (!fx) return false;
  const ctx = L.matchContext(fr, fx);
  const seed = (Math.random() * 2 ** 31) >>> 0;
  fr.live = { s: fr.season, kind: fx.kind, round: fx.round, idx: fx.idx }; saveFr(fr);
  app.immersive();
  app.session = { mode: 'ai', gameMode: 'classic', myTeam: 0, seed, mapId: mapFor(fr, fx), aiLevel: fr.diff ?? 1,
    names: [fr.teams[0].name, fr.teams[fx.opp].name], rng: new Rng(seed ^ 0xf4a7), preset: null,
    franchise: { fx, ids: ctx.ids, mods: ctx.mods, p: ctx.p } };
  app.session.draft = { turn: 16, bans: [[], []], picks: [ctx.ids[0].slice(), ctx.ids[1].slice()], done: true };
  app.showScreen(true);
  app.startPrep();
  return true;
}
// Prep hook: every hero plays the role the franchise lineup gave it and carries its roster edge (cfg mod).
export function frPrep(s) {
  const F = s.franchise; if (!F) return;
  for (const t of [0, 1]) {
    const prep = t === s.myTeam ? s.myPrep : s.preps[t]; if (!prep) continue;
    for (const hp of prep.heroes) { const i = F.ids[t].indexOf(hp.id); if (i >= 0) { hp.role = ROLES[i]; hp.mod = F.mods[t][i]; } }
  }
}
// After the match: apply it to the league (morale, form, fatigue, bonds, standings) and return a summary for the
// results screen, or null when the fixture no longer matches the save (e.g. it was simmed in another tab).
export function frRecord(s, game) {
  const F = s.franchise, fr = getFr(); if (!F || !fr || game.winner < 0) return null;
  const fx = L.nextFixture(fr);
  if (!fx || fx.kind !== F.fx.kind || fx.round !== F.fx.round || fx.idx !== F.fx.idx || fx.opp !== F.fx.opp) return null;
  const sc = (x) => x.kills * 3 + x.assists * 1.5 - x.deaths + x.dmgHeroes / 1500 + x.cs / 40;
  const perf = {}; let mvp = null;
  for (const t of [0, 1]) for (const x of game.teams[t].heroes) { perf[x.heroId] = sc(x); if (t === 0 && (!mvp || perf[x.heroId] > perf[mvp])) mvp = x.heroId; }
  const before = fr.phase, round = fr.round, st0 = L.standings(fr), r0 = st0.find((r) => r.t === 0), place = r0.w + r0.l ? st0.indexOf(r0) + 1 : 0;
  L.recordFixture(fr, L.matchContext(fr, fx), { w: game.winner === s.myTeam ? 0 : 1, k: [game.teams[0].kills, game.teams[1].kills], len: Math.round(game.time), perf, ids: F.ids, how: 'play', mvp });
  saveFr(fr);
  return { fr, fx, won: game.winner === s.myTeam, before, round, placeBefore: place };
}
// "Sim match": resolve your fixture with the quick model (no 5v5), same roster effects as a played match.
export function simFixture() {
  const fr = getFr(); if (!fr) return null;
  const fx = L.nextFixture(fr); if (!fx) return null;
  L.quickFixture(fr); fr.live = null; saveFr(fr);
  const last = fr.mine[fr.mine.length - 1];
  return last ? { fx, won: last.won, k: last.k } : null;
}
