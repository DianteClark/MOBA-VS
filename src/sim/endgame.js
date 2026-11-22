// Endgame focus (hotfix): once a team's Crystal is open (its Crystal towers are down), the attackers finish it
// instead of brawling with defenders around the base. Heroes near the open Crystal only fight enemy heroes
// that actually threaten them (hitting them or a sieging ally, or standing in their way), never chase into the
// enemy fountain, and keep hitting the Crystal when it dies before they do. Retreat when a fight is clearly
// lost still comes from the normal combat brain (ai.js). Pure + deterministic: no rng, no clocks.
import { dist2, segDist2 } from './geom.js';

const SIEGE_R = 950;      // a hero this close to an open enemy Crystal commits to it
const FOUNTAIN_R = 230;          // the enemy fountain's killing platform (190px) plus a margin: never chase in there

function nexusOf(g, team) {
  const c = g._nexus || (g._nexus = [null, null]);
  if (!c[team]) c[team] = g.units.find((u) => u.type === 'nexus' && u.team === team) || null;
  return c[team];
}
// The enemy Crystal that `team` can damage right now, or null (cached per tick).
export function openCrystal(g, team) {
  const c = g._crOpen || (g._crOpen = { t: -1, v: [null, null] });
  if (c.t !== g.tick) {
    c.t = g.tick;
    for (let k = 0; k < 2; k++) { const n = nexusOf(g, 1 - k); c.v[k] = n && n.alive && g.isTargetable(n) ? n : null; }
  }
  return c.v[team];
}
// The open Crystal hero `h` is committed to (close to it and not nearly dead), or null.
export function crystalSiege(g, h) {
  const n = openCrystal(g, h.team);
  return n && dist2(h, n) < SIEGE_R * SIEGE_R && h.hp > h.maxHp * 0.2 ? n : null;
}
const recent = (u, e, now) => u.dmgBy && u.dmgBy[e.id] > now - 40; // e damaged u in the last 2s
// Is enemy hero `e` worth fighting while we siege `nexus`? It hit us or a sieging ally, or it blocks us
// (in our face, or standing on our path to the Crystal). Never one sitting in their fountain.
export function crystalThreat(g, h, e, nexus, allies) {
  if (dist2(e, g.world.fountain[e.team]) < FOUNTAIN_R * FOUNTAIN_R) return false;
  const now = g.tick;
  if (recent(h, e, now)) return true;
  for (const a of allies) if (a !== h && recent(a, e, now) && dist2(a, nexus) < SIEGE_R * SIEGE_R) return true;
  const face = h.stats.range + h.radius + e.radius + 40;
  if (dist2(e, h) < face * face) return true;
  return dist2(e, nexus) < dist2(h, nexus) && segDist2(e, h, nexus) < 90 * 90;
}
// Race check: our sieging heroes kill the Crystal well before the threats around `h` kill `h`.
export function crystalRace(g, h, nexus, allies, threats) {
  let ours = 0; for (const a of allies) if (dist2(a, nexus) < (a.stats.range + nexus.radius + 160) ** 2) ours += a.stats.ad * a.stats.as;
  if (ours <= 0) return false;
  let theirs = 0; for (const e of threats) theirs += e.dps;
  const tKill = nexus.hp / ours, tDie = theirs > 0 ? g.ehp(h) / theirs : Infinity;
  return tKill < 6 && tKill < tDie * 0.7;
}
