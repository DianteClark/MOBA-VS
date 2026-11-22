// Read-only match analysis for the coach's UI: Coach's Call moments, hero requests,
// place names, the Play of the Game and the post-match report card.
// Nothing here mutates the game; everything only uses what the coach's team can see.
import { TICK_RATE, OBJ_NAME, DRAGON_INFO, MOMENTUM } from '../sim/constants.js';
import { fmtTime } from './dom.js';
import { costOf, affordable, readyIn, accepted, canIssue, seen, busy, eta, bestGanker, teamEta, objTimeLeft, SOON, WINDOW } from './feasible.js';

const LANE_L = { top: 'Top', mid: 'Mid', bot: 'Bot' };
const ROLE_L = { top: 'top', mid: 'mid', bot: 'carry', support: 'support', jungle: 'jungler' };
const d2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
const CARRY = (h) => h.def.cls === 'marksman' || h.def.cls === 'mage';
const objName = (g, k) => (k === 'dragon' ? DRAGON_INFO[g.objectives.dragon ? g.objectives.dragon.element : g.teams.some((t) => t.soul) ? 'elder' : g.nextDragon].short + ' Kami' : OBJ_NAME[k]);
const pitOf = (g, k) => g.objPit(k); // (Living World: the Tengu's spot, the parade's current spot)

// "KAMI", "TOP", "ENEMY JUNGLE"… for a world point, from `my` team's point of view.
export function placeName(g, p, my) {
  const W = g.world;
  if (d2(W.pits.kami, p) < 450 * 450) return 'KAMI';
  if (d2(W.pits.kraken, p) < 450 * 450) return g.time < g.T.heraldDespawn && !g.objectives.baron ? 'ONI' : 'KRAKEN';
  if (g.shrines.some((s) => d2(s, p) < 320 * 320)) return 'SHRINE';
  const me = Math.max(0, my);
  for (const t of [0, 1]) if (d2(W.fountain[t], p) < 950 * 950) return t === me ? 'YOUR BASE' : 'ENEMY BASE';
  const lane = W.closestLane(p);
  if (W.distToLane(lane, p) < 300) return LANE_L[lane].toUpperCase();
  return d2(W.fountain[me], p) < d2(W.fountain[1 - me], p) ? 'YOUR JUNGLE' : 'ENEMY JUNGLE';
}

// The enemy lane with the fewest structures left (same rule as the AI coach).
function weakestLane(g, my) {
  let best = 'mid', bs = Infinity;
  for (const ln of ['mid', 'top', 'bot'].filter((x) => g.world.laneNames.includes(x))) {
    let n = 0; for (const u of g.units) if (u.alive && u.team === 1 - my && (u.type === 'tower' || u.type === 'inhib') && u.lane === ln) n += u.type === 'inhib' ? 2 : 1;
    if (n < bs) { bs = n; best = ln; }
  }
  return best;
}
function splitter(g, my) {
  const a = g.teams[my].heroes.filter((x) => x.alive);
  return a.find((x) => x.role === 'top') || a.filter((x) => x.role !== 'support').sort((p, q) => q.level - p.level)[0] || null;
}
// An option: `ok()` is its physical check (who goes, can they make it in time), re-run while the card is up.
const opt = (label, cmd, sub, ok) => ({ label, cmd, sub, ok, cost: costOf(cmd) });
const WAIT = () => opt('Wait & see', null, 'no call');

// An option right now: 'go' (tap works), 'soon' (only a charge short, and it lands within SOON seconds:
// shown greyed with a countdown) or 'no' (hidden). Options without a command are always 'go'.
export function optState(g, my, o) {
  if (!o.cmd) return 'go';
  if (!accepted(g, my, o.cmd) || (o.ok && !o.ok())) return 'no';
  if (affordable(g, my, o.cmd)) return 'go';
  return readyIn(g, my, o.cmd) <= SOON ? 'soon' : 'no';
}
// Make a Coach's Call real: options the player can't use are dropped (a free "Wait & see" takes the place
// of the first one if the card has no free option yet). No usable call left: no card at all.
// The card keeps checking itself (valid) and closes when its last usable option goes.
function finish(g, my, m) {
  const opts = []; let swapped = false;
  for (const o of m.opts) {
    o.state = () => optState(g, my, o);
    if (o.state() !== 'no') opts.push(o);
    else if (!swapped && !m.opts.some((x) => !x.cmd)) { swapped = true; opts.push(WAIT()); }
  }
  for (const o of opts) if (!o.state) o.state = () => 'go';
  const live = () => opts.some((o) => o.cmd && o.state() !== 'no');
  if (!live()) return null;
  m.opts = opts; m.valid = () => (!m.still || m.still()) && live();
  return m;
}

// ───────────── Coach's Call moments ─────────────
// Returns { key, kind, title, text, at:{x,y}, opts:[{label, cmd|null, cost, state()}], valid() } or null.
// own(hero): co-op, the heroes this coach runs (gankers are only picked from them).
export function coachMoment(g, my, own) {
  if (my < 0 || g.over) return null;
  const now = g.tick, team = g.teams[my], vis = g.vision[my];
  const mine = team.heroes.filter((x) => x.alive), foes = g.teams[1 - my].heroes.filter((x) => x.alive && vis.has(x.id));
  const jg = mine.find((x) => x.role === 'jungle');
  const eyes = team.deck.find((d) => d.id === 'eyes' && !d.used);
  const wait = (label) => (eyes ? opt('Ward & wait', { type: 'tactic', card: 'eyes' }, 'Spirit Eyes') : opt(label || 'Hold', null, 'no call'));
  const surgeReady = team.momentum >= MOMENTUM.max && !(team.surgeUntil > now);
  const callOn = (k) => team.call && team.call.type === 'objective' && team.call.obj === k;
  const sees = (e) => () => seen(g, my, e);
  let m;

  // 1) an objective under enemy attack
  for (const k of g.living ? ['boss', 'baron', 'dragon', 'herald', 'yokai'] : ['baron', 'dragon', 'herald']) {
    const o = g.objectives[k];
    if (!o || !o.alive || !vis.has(o.id) || o.hp > o.maxHp * 0.95 || callOn(k)) continue;
    objTimeLeft(g, o);
    const on = foes.filter((e) => d2(e, o) < 650 * 650).length;
    if (!on) continue;
    const lane = weakestLane(g, my);
    if ((m = finish(g, my, { key: 'contest' + k + o.id, kind: 'contest', title: `${objName(g, k)} contested`, text: `${on} enemy on ${OBJ_NAME[k]}. Fight for it?`, at: o, danger: true, still: () => o.alive,
      opts: [opt(`Contest ${OBJ_NAME[k]}`, { type: 'objective', obj: k }, null, () => teamEta(g, my, o, 2) <= objTimeLeft(g, o)), opt(`Trade: push ${LANE_L[lane]}`, { type: 'group', lane }), opt('Let it go', null, 'no call')] }))) return m;
  }
  // 2) an enemy carry caught alone near our heroes
  for (const e of foes) {
    if (!CARRY(e) || e.hp / e.maxHp > 0.8) continue;
    if (foes.some((o) => o !== e && d2(o, e) < 1000 * 1000)) continue;
    const near = mine.filter((a) => d2(a, e) < 1300 * 1300);
    if (near.length < 2) continue;
    // the ganker is whoever can really get there before the carry walks off (jungler first), or no gank option
    const lane = g.world.closestLane(e), gk = bestGanker(g, my, e, lane, WINDOW.caught, own), x = gk && gk.hero;
    if ((m = finish(g, my, { key: 'caught' + e.id + Math.floor(now / (TICK_RATE * 40)), kind: 'caught', topic: 'pick:' + e.id, title: `${e.def.name} caught out`, text: `Their ${ROLE_L[e.role]} is alone at ${placeName(g, e, my).toLowerCase()}.`, at: e, still: sees(e),
      opts: [x ? opt(`${x.def.name}: gank ${LANE_L[lane]}`, { type: 'gank', lane, hero: x.id }, `${Math.max(1, Math.round(gk.t))}s away`, () => seen(g, my, e) && !busy(g, x) && eta(g, x, e) <= WINDOW.caught) : null,
        opt(`Focus ${e.def.name}`, { type: 'focus', target: e.id }, null, sees(e)), opt('Leave it', null, 'no call')].filter(Boolean) }))) return m;
  }
  // 3) a teamfight about to break near our heroes
  if (mine.length >= 3 && foes.length >= 3) {
    for (const a of mine) {
      const allies = mine.filter((x) => d2(x, a) < 900 * 900), enemies = foes.filter((e) => d2(e, a) < 1000 * 1000);
      if (allies.length < 3 || enemies.length < 3) continue;
      const fighting = [...allies, ...enemies].filter((x) => now - x.lastHitHero < TICK_RATE * 1.5).length;
      if (fighting >= 2) continue;
      const fed = enemies.slice().sort((p, q) => (q.kills * 2 + q.items.length) - (p.kills * 2 + p.items.length))[0];
      const ults = allies.filter((x) => x.level >= 5 && g.abilityReady(x, 2)).length;
      const first = surgeReady ? opt('Kami Surge', { type: 'surge' }, '+12% dmg & speed') : ults >= 2 ? opt('ALL-IN', { type: 'ult', mode: 'go' }, `${ults} ults ready`) : opt('Fight!', { type: 'ult', mode: 'go' }, 'ults fire');
      if ((m = finish(g, my, { key: 'brew' + Math.floor(now / (TICK_RATE * 30)), kind: 'brew', title: 'Teamfight brewing', text: `${allies.length}v${enemies.length} at ${placeName(g, a, my).toLowerCase()}.`, at: a,
        opts: [first, opt(`Focus ${fed.def.name}`, { type: 'focus', target: fed.id }, null, sees(fed)), opt('Back off', { type: 'safe' })] }))) return m;
      break;
    }
  }
  // 4) an enemy tower low with our heroes close
  for (const u of g.units) {
    if (u.type !== 'tower' || !u.alive || u.team !== 1 - my || u.hp > u.maxHp * 0.35 || !g.isTargetable(u)) continue;
    if (!mine.some((a) => d2(a, u) < 1000 * 1000)) continue;
    const lane = u.lane || 'mid', opts = [opt(`Push ${LANE_L[lane] || 'it'}`, { type: 'group', lane }, null, () => u.alive && teamEta(g, my, u, 2) <= WINDOW.objective)];
    if (team.heraldEye > now) opts.push(opt(`Oni ${LANE_L[lane]}`, { type: 'herald', lane }));
    const sp = splitter(g, my);
    if (sp && (!own || own(sp)) && lane !== 'mid' && opts.length < 2) opts.push(opt(`${sp.def.name} split`, { type: 'split', hero: sp.id, lane }, null, () => u.alive && !busy(g, sp) && eta(g, sp, u) <= WINDOW.split));
    opts.push(opt('Not now', null, 'no call'));
    if ((m = finish(g, my, { key: 'tower' + u.id, kind: 'tower', title: 'Enemy tower low', text: `Their ${LANE_L[lane] || 'base'} tower is at ${Math.round(u.hp / u.maxHp * 100)}%.`, at: u, still: () => u.alive, opts }))) return m;
  }
  // 5) their jungler shows far from a live (or waking) objective
  const ej = g.teams[1 - my].heroes.find((x) => x.role === 'jungle' && x.alive && vis.has(x.id));
  if (ej) {
    for (const k of ['baron', 'dragon', 'herald']) {
      const o = g.objectives[k], tm = g.objTimers[k];
      const live = (o && o.alive) || (tm && tm - now < TICK_RATE * 15 && g.objAvailable(k));
      if (!live || callOn(k) || d2(ej, pitOf(g, k)) < 2200 * 2200) continue;
      const pit = pitOf(g, k), wakeIn = () => (tm && !(o && o.alive) ? Math.max(0, (tm - g.tick) / TICK_RATE) : 0);
      const invade = jg && jg.alive && g.camps.some((c) => c.side !== my && c.mobs.length);
      // three of ours get there in the window (or by the time it wakes), ahead of their jungler
      if ((m = finish(g, my, { key: 'ej' + k + (o ? o.id : tm), kind: 'jungler', title: 'Enemy jungler spotted', text: `${ej.def.name} is at ${placeName(g, ej, my).toLowerCase()}, far from ${OBJ_NAME[k]}.`, at: pit,
        opts: [opt(`Take ${OBJ_NAME[k]}`, { type: 'objective', obj: k }, null, () => teamEta(g, my, pit, 3) <= Math.max(WINDOW.objective, wakeIn() + 10)), invade ? opt('Invade', { type: 'invade' }, null, () => !busy(g, jg)) : wait(), opt('Ignore', null, 'no call')] }))) return m;
    }
  }
  // 5b) Living World: the Yokai Parade wanders through our half, or night falls with the enemy's Moon Spirits up
  if (g.living) {
    const y = g.objectives.yokai;
    if (y && y.alive && vis.has(y.id) && !callOn('yokai') && d2(y, g.world.fountain[my]) < d2(y, g.world.fountain[1 - my]) && mine.length >= 3) {
      const lane = weakestLane(g, my);
      return { key: 'yokai' + y.id, kind: 'yokai', title: 'Yokai Parade in your half', text: `Tame it: the band marches down their ${LANE_L[lane]} lane for 60s.`, at: y,
        opts: [opt('Tame it', { type: 'objective', obj: 'yokai' }), opt(`Push ${LANE_L[lane]}`, { type: 'group', lane }), opt('Leave it', null, 'no call')] };
    }
    const moon = g.living.night && g.camps.find((c) => c.night && c.side !== my && c.mobs.some((m) => m.alive && m.big));
    if (moon && jg && jg.alive && g.living.nightK >= 1 && g.time < 400) { // (the first 20s of full dark)
      return { key: 'moon' + Math.floor(g.time / 120), kind: 'moon', title: 'Night falls', text: 'Their Moon Spirits grant Moonsight: steal them, or ward up and wait?', at: moon,
        opts: [opt('Steal Moon Spirits', { type: 'invade', camp: moon.key }), wait('Ward & wait'), opt('Ignore', null, 'no call')] };
    }
  }
  // 6) an objective about to wake
  for (const k of g.living ? ['dragon', 'herald', 'baron', 'boss'] : ['dragon', 'herald', 'baron']) {
    const tm = g.objTimers[k];
    if (!tm || tm - now > TICK_RATE * 20 || tm - now < TICK_RATE * 6 || !g.objAvailable(k) || callOn(k)) continue;
    const lane = weakestLane(g, my), pit = pitOf(g, k);
    const wake = () => (tm > g.tick ? `${objName(g, k)} wakes in ${Math.ceil((tm - g.tick) / TICK_RATE)}s` : `${objName(g, k)} is up!`);
    if ((m = finish(g, my, { key: 'wake' + k + tm, kind: 'wake', title: wake(), liveTitle: wake, text: 'Set up for it, or trade elsewhere?', at: pit,
      opts: [opt(`Take ${OBJ_NAME[k]}`, { type: 'objective', obj: k }, null, () => teamEta(g, my, pit, 3) <= Math.max(0, (tm - g.tick) / TICK_RATE) + 15), wait('Wait & see'), opt(`Push ${LANE_L[lane]}`, { type: 'group', lane })] }))) return m;
  }
  return null;
}

// ───────────── hero requests ─────────────
// Personality: reckless & hothead heroes ask far more often than cautious ones.
export const ASK_WEIGHT = { reckless: 1.8, hothead: 1.6, greedy: 1, loyal: 0.8, calm: 0.7, cautious: 0.4 };
// Candidate requests from our heroes right now: [{ hero, text, cmd, key, target?, valid() }].
// A hero only asks for what it can do now: free (not recalling, not on a call), its target in sight and range.
export function heroRequests(g, my) {
  if (my < 0 || g.over) return [];
  const now = g.tick, team = g.teams[my], vis = g.vision[my], out = [];
  if (team.permitCd > now) return out;
  const foes = g.teams[1 - my].heroes.filter((x) => x.alive && vis.has(x.id));
  const towerAt = (p) => g.units.find((u) => u.type === 'tower' && u.alive && u.team === 1 - my && d2(u, p) < (u.stats.range + 20) ** 2);
  const ask = (r) => { r.valid = () => !busy(g, r.hero) && canIssue(g, my, r.cmd) && (!r.target || d2(r.target, r.hero) < 1000 * 1000); if (r.valid()) out.push(r); };
  for (const h of team.heroes) {
    if (busy(g, h) || h.hp / h.maxHp < 0.6) continue;
    if (h.role !== 'support') {
      for (const e of foes) {
        if (d2(e, h) > 800 * 800 || foes.some((o) => o !== e && d2(o, e) < 900 * 900)) continue;
        const weak = e.hp / e.maxHp < 0.5 || h.level >= e.level + 2;
        if (!weak) continue;
        const tw = towerAt(e);
        if (tw && e.hp / e.maxHp > 0.35) continue;
        ask({ hero: h, key: 'fight' + h.id + e.id, text: tw ? `Their ${ROLE_L[e.role]} is low under tower. Dive?` : `I can solo-kill their ${ROLE_L[e.role]}. Go?`, cmd: { type: 'permit', kind: 'fight', hero: h.id, target: e.id }, target: e });
        break;
      }
    }
    if ((h.role === 'top' || h.def.cls === 'bruiser') && g.time > 360 && h.hp / h.maxHp > 0.75 && h.level >= 7) {
      const lanes = ['top', 'bot'].filter((l) => g.world.laneNames.includes(l)).map((l) => ({ l, n: foes.filter((e) => g.world.distToLane(l, e) < 600).length })).sort((a, b) => a.n - b.n);
      if (lanes.length && lanes[0].n === 0 && g.units.some((u) => u.type === 'tower' && u.alive && u.team === 1 - my && u.lane === lanes[0].l))
        ask({ hero: h, key: 'split' + h.id + lanes[0].l, text: `Let me split-push ${LANE_L[lanes[0].l]}?`, cmd: { type: 'permit', kind: 'split', hero: h.id, lane: lanes[0].l } });
    }
  }
  return out;
}

// ───────────── Play of the Game ─────────────
const MULTI = ['', '', 'double kill', 'triple kill', 'quadra kill', 'PENTA KILL'];
// The ~12s window with the biggest swing for the winner (kills, ultimates, objectives, towers).
export function findPOTG(g) {
  const W = g.winner >= 0 ? g.winner : 0, L = 1 - W, WIN = TICK_RATE * 12;
  const ev = g.events.filter((e) => e.type === 'kill' || e.type === 'ultCast' || e.type === 'objective' || e.type === 'tower' || e.type === 'inhib');
  const val = (e) => {
    if (e.type === 'kill') return e.killerTeam === W ? [3, 0] : e.killerTeam === L ? [0, 3] : [0, 0];
    if (e.type === 'ultCast') return e.team === W ? [1, 0] : [0, 1];
    if (e.type === 'objective') return e.team === W ? [4, 0] : e.team === L ? [0, 4] : [0, 0];
    return e.team === W ? [2, 0] : [0, 2];
  };
  let best = null, bs = 0;
  for (let i = 0; i < ev.length; i++) {
    if (ev[i].type !== 'kill' && ev[i].type !== 'ultCast') continue;
    let sw = 0, sl = 0, kills = 0;
    for (let j = i; j < ev.length && ev[j].t < ev[i].t + WIN; j++) { const [a, b] = val(ev[j]); sw += a; sl += b; if (ev[j].type === 'kill' && ev[j].killerTeam === W) kills++; }
    const swing = sw - sl * 0.5;
    if (kills && swing > bs) { bs = swing; best = i; }
  }
  if (best === null) return null;
  const t0 = ev[best].t, inWin = ev.filter((e) => e.t >= t0 && e.t < t0 + WIN);
  const kills = inWin.filter((e) => e.type === 'kill' && e.killerTeam === W);
  const pts = kills.length ? kills : inWin.filter((e) => e.x !== undefined);
  const x = pts.reduce((a, e) => a + (e.x || 0), 0) / Math.max(1, pts.length), y = pts.reduce((a, e) => a + (e.y || 0), 0) / Math.max(1, pts.length);
  const by = {}; for (const k of kills) if (k.killer) by[k.killer] = (by[k.killer] || 0) + 1;
  const topId = +Object.keys(by).sort((a, b) => by[b] - by[a])[0] || 0, top = topId ? g.byId(topId) : null, n = topId ? by[topId] : 0;
  const obj = inWin.find((e) => e.type === 'objective' && e.team === W);
  const title = kills.length >= 5 ? `${g.teams[W].name || 'Team'} ACE` : top && n >= 2 ? `${top.def.name} ${MULTI[Math.min(5, n)]}` : obj ? `${top ? top.def.name + ' secures ' : 'The '}${OBJ_NAME[obj.obj]}` : top ? `${top.def.name} makes the play` : 'The decisive fight';
  const last = inWin[inWin.length - 1].t;
  const start = Math.max(0, t0 - TICK_RATE * 3), end = Math.min(g.tick, Math.max(start + TICK_RATE * 12, last + TICK_RATE * 2));
  return { start, end, x, y, title, team: W, heroId: top ? top.heroId : null, kills: kills.length, at: fmtTime(t0 / TICK_RATE) };
}

// ───────────── coach report card ─────────────
const grade = (s) => (s >= 0.85 ? 'S' : s >= 0.7 ? 'A' : s >= 0.55 ? 'B' : s >= 0.4 ? 'C' : 'D');
export function reportCard(g, my, stats = {}) {
  if (my < 0) return null;
  const mins = Math.max(1, g.time / 60), them = 1 - my;
  // calls
  const calls = g.callLog.filter((c) => c.team === my && c.type !== 'tactic');
  const done = calls.filter((c) => c.result), ok = done.filter((c) => c.result === 'success');
  const rate = done.length ? ok.length / done.length : 0, usage = calls.length / mins;
  const cS = calls.length ? rate * 0.75 + Math.min(1, usage / 0.8) * 0.25 : 0.1;
  // objectives
  const objEv = g.events.filter((e) => e.type === 'objective');
  const taken = objEv.filter((e) => e.team === my).length, lost = objEv.filter((e) => e.team === them).length;
  const contested = calls.filter((c) => c.type === 'objective').length;
  const oS = taken + lost ? (taken + 0.25 * Math.min(contested, lost)) / (taken + lost) : 0.5;
  // macro
  const tk = g.teams[my].towers, tl = g.teams[them].towers;
  const shr = g.events.filter((e) => e.type === 'shrine' && e.team === my).length;
  const a = g.teams[my].goldHistory, b = g.teams[them].goldHistory, n = Math.min(a.length, b.length);
  let lead = 0; for (let i = 0; i < n; i++) if (a[i] > b[i]) lead++;
  const leadF = n ? lead / n : 0.5;
  const mS = 0.45 * (tk + tl ? tk / (tk + tl) : 0.5) + 0.35 * leadF + 0.2 * Math.min(1, shr / 3);
  const rows = [
    { k: 'Calls', g: grade(cS), s: cS, d: `${ok.length}/${done.length} paid off · ${usage.toFixed(1)}/min` },
    { k: 'Objectives', g: grade(oS), s: oS, d: `${taken} taken · ${contested} called · ${lost} lost` },
    { k: 'Macro', g: grade(mS), s: mS, d: `${tk}-${tl} towers · ${shr} shrine${shr === 1 ? '' : 's'} · ahead ${Math.round(leadF * 100)}%` },
  ];
  // one concrete tip, for the weakest area
  const weakest = rows.slice().sort((p, q) => p.s - q.s)[0].k;
  let tip;
  const ganks = calls.filter((c) => c.type === 'gank'), gFail = ganks.filter((c) => c.result && c.result !== 'success').length;
  const open = stats.shrineOpen || 0, full = stats.fullCharge || 0;
  if (weakest === 'Calls') {
    if (calls.length < mins * 0.4) tip = `You made ${calls.length} call${calls.length === 1 ? '' : 's'} in ${Math.round(mins)} min. Charges refill every 20s: spend them.`;
    else if (ganks.length >= 2 && gFail * 2 > ganks.length) tip = `${gFail} of ${ganks.length} ganks failed. Gank lanes marked "Overextended!".`;
    else tip = `Only ${ok.length} of ${done.length} calls paid off. Gold-glowing buttons are the good bets.`;
  } else if (weakest === 'Objectives') {
    tip = lost > taken ? `The enemy took ${lost} objective${lost === 1 ? '' : 's'}. Call Objective ~20s before one wakes.` : `You called ${contested} objective${contested === 1 ? '' : 's'}. Call them as they wake to snowball.`;
  } else if (open > shr) tip = `You took ${shr} of ${open} open shrines. Each one is +5% team damage.`;
  else if (tl > tk) tip = `You lost ${tl} towers to ${tk}. Answer the red tower arrows with Defend.`;
  else if (full > 60) tip = `Your charges sat full for ${fmtTime(full)}. A full meter is wasted calls.`;
  else tip = `Gold lead held ${Math.round(leadF * 100)}% of the game. Push after won fights to turn kills into towers.`;
  return { rows, tip };
}
