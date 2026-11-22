// Analyst suggestions (the one-tap tray prompts): pure, read-only, no DOM, so tools/suggest_test.mjs
// can run them headless. Only uses what `me` can see. Every suggestion passes the feasibility gate
// (src/ui/feasible.js) when made and again on every tray tick (valid): affordable, accepted by the sim,
// and doable in time by the heroes it names.
import { TICK_RATE, OBJ_NAME } from '../sim/constants.js';
import { canIssue, seen, busy, eta, bestGanker, teamEta, objTimeLeft, WINDOW } from './feasible.js';

const LANE_L = { top: 'Top', mid: 'Mid', bot: 'Bot' };
const OBJ_L = OBJ_NAME;
const pitOf = (g, k) => (k === 'dragon' ? g.world.pits.kami : g.world.pits.kraken);

// st: { cool: {} (per-key cooldowns, kept by the caller), carding: bool (a call/request is up), own?(hero) (co-op) }
// Returns [{ key, text, label, cmd, cls?, valid }].
export function analystSuggestions(g, me, st) {
  const vis = g.vision[me], now = g.tick, out = [];
  const ready = (k, s) => { if ((st.cool[k] || 0) > now) return false; st.cool[k] = now + s * TICK_RATE; return true; };
  // feasible first, so a suggestion that can't be done yet doesn't burn its cooldown
  const offer = (s, ok, cool) => {
    const valid = () => canIssue(g, me, s.cmd) && ok();
    if (valid() && ready(s.key, cool)) out.push({ ...s, valid });
  };
  const enemy = g.teams[1 - me].heroes, carding = st.carding;
  const deadEnemies = enemy.filter((x) => !x.alive && x.respawnAt - now > 15 * TICK_RATE);
  if (deadEnemies.length >= 2) {
    const best = ['baron', 'dragon', 'herald'].find((k) => g.objectives[k] && g.objectives[k].alive);
    // the numbers edge lasts until the second enemy is back: 3 of ours must get there before that
    const edge = () => deadEnemies.map((x) => (x.respawnAt - g.tick) / TICK_RATE).sort((a, b) => a - b)[1] || 0;
    if (best) offer({ key: 'numbers', text: `${deadEnemies.length} enemies down`, label: `Take ${OBJ_L[best]}`, cmd: { type: 'objective', obj: best }, cls: 'good' },
      () => !!(g.objectives[best] && g.objectives[best].alive) && teamEta(g, me, pitOf(g, best), 3) <= edge(), 30);
    else offer({ key: 'numbers2', text: `${deadEnemies.length} enemies down`, label: 'Push Mid', cmd: { type: 'group', lane: 'mid' }, cls: 'good' },
      () => teamEta(g, me, g.world.lanePoint('mid', 0.5), 3) <= edge(), 30);
  }
  const ej = enemy.find((x) => x.role === 'jungle');
  if (ej && seen(g, me, ej) && !carding) {
    const W = g.world, nearKraken = (ej.x - W.pits.kraken.x) ** 2 + (ej.y - W.pits.kraken.y) ** 2 < (ej.x - W.pits.kami.x) ** 2 + (ej.y - W.pits.kami.y) ** 2;
    const o = nearKraken ? g.objectives.dragon : (g.objectives.baron || g.objectives.herald);
    // we must beat their jungler (from where we last saw him) to the pit
    if (o && o.alive) offer({ key: 'ejspot', text: `Their jungler is far from ${OBJ_L[o.kind]}`, label: `Take ${OBJ_L[o.kind]}`, cmd: { type: 'objective', obj: o.kind } },
      () => o.alive && teamEta(g, me, o, 3) <= Math.min(WINDOW.objective, eta(g, ej, o)), 40);
  }
  for (const e of enemy) {
    if (!seen(g, me, e) || e.role === 'jungle') continue;
    for (const lane of g.world.laneNames) {
      if (g.world.distToLane(lane, e) > 260) continue;
      const pr = g.world.laneProgress(lane, e), deep = me === 0 ? pr : 1 - pr;
      if (deep >= 0.47 || st.cool['gank' + lane] > now) continue;
      // the right ganker (jungler, else a roamer) who can actually get there while the laner is still out
      const gk = bestGanker(g, me, e, lane, WINDOW.gank, st.own);
      if (!gk) continue;
      const x = gk.hero;
      offer({ key: 'gank' + lane, text: `${e.def.name} overextended ${LANE_L[lane]} · ${x.def.name} ${Math.max(1, Math.round(gk.t))}s away`, label: `${x.def.name} ganks`, cmd: { type: 'gank', lane, hero: x.id }, target: e },
        () => seen(g, me, e) && !busy(g, x) && eta(g, x, e) <= WINDOW.gank, 30);
    }
  }
  for (const k of ['dragon', 'baron', 'herald']) {
    const o = g.objectives[k];
    if (!o || !o.alive || o.hp > o.maxHp * 0.95 || !vis.has(o.id) || carding) continue;
    const on = () => enemy.filter((e) => seen(g, me, e) && (e.x - o.x) ** 2 + (e.y - o.y) ** 2 < 500 * 500).length;
    objTimeLeft(g, o); // keep its kill-rate reading fresh
    // two of ours must arrive before the enemy finishes it
    if (on()) offer({ key: 'contest' + k, text: `Enemy is taking ${OBJ_L[k]}!`, label: 'Contest', cmd: { type: 'objective', obj: k }, cls: 'bad' },
      () => o.alive && on() > 0 && teamEta(g, me, o, 2) <= objTimeLeft(g, o), 25);
  }
  for (const sh of g.shrines) {
    if (sh.owner === me || g.time <= g.T.shrineUnlock || enemy.some((e) => seen(g, me, e) && (e.x - sh.x) ** 2 + (e.y - sh.y) ** 2 < 800 * 800)) continue;
    offer({ key: 'shr' + sh.id, text: `${sh.id === me ? 'Home' : 'Far'} shrine is open`, label: 'Capture', cmd: { type: 'shrine', shrine: sh.id }, shrine: true },
      () => sh.owner !== me && teamEta(g, me, sh, 1) <= WINDOW.shrine, 70);
  }
  return out;
}
