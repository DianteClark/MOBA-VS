// Hearth clan (v24): HEARTHFIRE, a shared team meter of embers, plus the Hearth heroes' own passives.
// Deterministic sim code called from small hooks (effects.js passiveStats / onTakedown / onBasicHit, game.js objectives).
// g.hearth only exists when a team drafted a Hearth hero, so every other match stays bit-identical.
//
//   +1 ember  a Hearth hero takes part in an enemy hero takedown (Kenta's takedowns: +2)
//   +1 ember  the team takes an epic monster (Kami, Oni, Kraken)
//   -2 embers a Hearth hero falls
//   Each ember: Hearth heroes deal +3% damage and heal/shield +3% more. At 5+ embers (Bonfire) they also move 5% faster.
//   Aki (lanternKeeper): while she lives the meter never drops below 1, and it holds up to 6.
import { sec } from './constants.js';
import { HEARTH } from '../data/hearth.js';

const isHearth = (h) => h.def.clan === 'hearth';
const keeper = (h) => h.def.passive.kind === 'lanternKeeper';
export const hearthMax = (g, t) => (g.teams[t].heroes.some(keeper) ? HEARTH.keeperMax : HEARTH.max);
const floorOf = (g, t) => (g.teams[t].heroes.some((h) => keeper(h) && h.alive) ? 1 : 0);

// Constructor (after spawning, before the first recalc).
export function setupHearth(g) {
  const has = g.teams.map((tm) => tm.heroes.some(isHearth));
  if (!has[0] && !has[1]) return;
  g.hearth = has.map((x, t) => (x ? { embers: floorOf(g, t), max: hearthMax(g, t), peak: floorOf(g, t) } : null));
}

function setEmbers(g, t, v, why, x, y) {
  const H = g.hearth[t];
  v = Math.max(floorOf(g, t), Math.min(H.max, v));
  if (v === H.embers) return;
  const up = v > H.embers;
  H.embers = v; H.peak = Math.max(H.peak, v);
  for (const h of g.teams[t].heroes) if (isHearth(h)) g.recalc(h);
  g.emit({ type: 'hearth', team: t, embers: v, max: H.max, up, why });
  g.fx.push({ kind: 'hearth', team: t, embers: v, max: H.max, up, x, y });
}

// Stats (inside Game.recalc via effects.passiveStats).
export function hearthStats(g, h, s) {
  const H = g.hearth && g.hearth[h.team];
  if (!H || !isHearth(h)) return;
  const n = H.embers, p = h.def.passive;
  s.dmgPct += HEARTH.dmg * n; s.healPower += HEARTH.heal * n;
  if (n >= HEARTH.bonfire) s.msPct += HEARTH.ms;
  if (p.kind === 'hearthGuard') { s.armor += p.per * n; s.mr += p.per * n; }
  else if (p.kind === 'hearthBrew') s.healPower += p.per * n;
  else if (p.kind === 'emberChase') s.msPct += p.ms * n;
}

// Hero takedowns (effects.onTakedown). The victim is already dead here.
export function hearthTakedown(g, victim, killer, assists) {
  if (!g.hearth) return;
  const vt = victim.team, kt = 1 - vt;
  if (g.hearth[vt] && isHearth(victim)) setEmbers(g, vt, g.hearth[vt].embers - HEARTH.loss, 'fall', victim.x, victim.y);
  if (!g.hearth[kt]) return;
  const party = (killer ? [killer, ...assists] : assists).filter((h) => h.team === kt && isHearth(h));
  if (!party.length) return;
  setEmbers(g, kt, g.hearth[kt].embers + (party.some((h) => h.def.passive.kind === 'emberChase') ? 2 : 1), 'takedown', victim.x, victim.y);
}

// Epic monsters (Game.kill, objective case).
export function hearthObjective(g, team, u) {
  if (g.hearth && team >= 0 && g.hearth[team]) setEmbers(g, team, g.hearth[team].embers + 1, 'objective', u.x, u.y);
}

// Aki back from the fountain: the eternal flame relights the floor ember.
export function hearthRespawn(g, h) {
  if (g.hearth && keeper(h) && g.hearth[h.team] && g.hearth[h.team].embers < 1) setEmbers(g, h.team, 1, 'keeper', h.x, h.y);
}

// Basic-attack passives of Hearth heroes (effects.onBasicHit, after the hit).
export function hearthHit(g, att, tgt, hero) {
  const p = att.def.passive;
  if (p.kind === 'repeater') {
    if (att.every3 % p.n === 0) { g.dealDamage(att, tgt, att.stats.ad * p.pct, 'phys', { proc: true }); g.fx.push({ kind: 'fx', name: 'cut', x: tgt.x, y: tgt.y, s: 0.9 }); }
  } else if (p.kind === 'kiteWind' && hero) {
    att.kite = Math.min(p.max, (att.kiteUntil > g.tick ? att.kite || 0 : 0) + 1); att.kiteUntil = g.tick + sec(p.dur);
    g.addBuff(att, { msPct: p.ms * att.kite }, p.dur, 'kite');
  }
}
