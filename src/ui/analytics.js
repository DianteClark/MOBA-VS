// Post-match analytics: why a match went the way it did.
//  * MatchRecorder: reads a running Game after every tick (events + a few state samples) and boils it down to
//    a compact, serialisable record. It never writes to the game, so it works live, headless (Replay Theater
//    scout) and in node (tools/theater.mjs).
//  * analyze(rec): fights, aces, the turning point (with a plain-language reason), call stats and payoffs,
//    missed chances and a key-event timeline.
//  * analysisCard / showAnalysis: the results-screen card and the full Analysis sheet (Story, Damage, Calls).
import { tr } from '../i18n/i18n.js';
import { TEAM_NAME, OBJ_NAME, DRAGON_INFO } from '../sim/constants.js';
import { MOMENTS } from '../sim/moments-coach.js';
import { HERO_BY_ID, ROLE_LABEL } from '../data/heroes.js';
import { BUILDS } from '../data/items.js';
import { h } from './dom.js';
import { normPlan } from '../sim/plans.js';
import { planLines } from './plans.js';
import { placeAt, placeFromKey, placeText } from '../world/places.js';

const D = typeof document !== 'undefined'; // node (tools) has no DOM: only the recorder and analyze() run there
const LANE = { top: 'Top', mid: 'Mid', bot: 'Bot' };
// "in top lane by your outer tower", "at the Kami pit"… for a stored place key, from the record's point of view
const where = (A, key) => { const pl = placeFromKey(key); return pl ? placeText(pl, { my: A.my }).where : 'on the map'; };
const coarse = (key) => String(key).split('.')[0]; // 'top.0.1' → 'top', 'jungle0.bot.wolf' → 'jungle0'
// calls that count as acting on an advantage (not play-safe, cancel, plan or build changes)
const ACTS = new Set(['gank', 'objective', 'group', 'invade', 'permit', 'surge', 'moment', 'herald', 'focus', 'split', 'tactic', 'shrine']);
const SAMPLE = 100; // gold-lead sample every 5s (100 ticks)
const r10 = (v) => Math.round(v / 10) * 10, r1 = (v) => Math.round(v * 10) / 10;
export const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
export const kGold = (v) => (Math.abs(v) >= 1000 ? (Math.round(v / 100) / 10) + 'k' : String(Math.round(v)));
const heroName = (id) => (HERO_BY_ID[id] ? HERO_BY_ID[id].name : id || '?');
// Living World objectives read as what happened to them
const took = (obj, steal) => (steal ? 'stole' : obj === 'yokai' ? 'tamed' : obj === 'boss' ? 'slew' : 'took');
const objName = (obj, el) => (obj === 'dragon' && DRAGON_INFO[el] ? DRAGON_INFO[el].name : OBJ_NAME[obj] || obj);

// ───────────────────────── recording ─────────────────────────
export class MatchRecorder {
  constructor(game) {
    this.g = game; this.ei = game.events.length; this.ev = []; this.gold = []; this.missed = [];
    this.win = [null, null]; this.lastMissed = [-1e9, -1e9];
    if (game.tick === 0) this.sampleGold();
  }
  // After every sim tick (cheap: new events, and a sample every second).
  step() {
    const g = this.g, ev = g.events;
    for (; this.ei < ev.length; this.ei++) this.onEvent(ev[this.ei]);
    if (g.tick % 20 === 0) this.second();
    if (g.tick % SAMPLE === 0) this.sampleGold();
  }
  sampleGold() { const g = this.g, tot = (t) => g.teams[t].heroes.reduce((a, x) => a + x.goldEarned, 0); this.gold.push(r10(tot(0) - tot(1))); }
  place(x, y) { return placeAt(this.g.world, { x, y }, this.g).key; } // src/world/places.js keys ('top.0.1', 'kami', 'jungle1.bot'…)
  onEvent(e) {
    const g = this.g, t = r1(e.t / 20), win = (team) => { const w = this.win[team]; if (w) w.got = true; };
    switch (e.type) {
      case 'kill': {
        const v = g.byId(e.victim); if (!v || v.type !== 'hero') break;
        const k = e.killer ? g.byId(e.killer) : null, ace = g.teams[v.team].heroes.every((x) => !x.alive);
        this.ev.push([t, 'k', 1 - v.team, v.heroId, k && k.heroId ? k.heroId : '', this.place(e.x, e.y), ace ? 1 : 0]);
        break;
      }
      case 'tower': this.ev.push([t, 'tw', e.team, e.lane || '', e.tier || 0]); win(e.team); break;
      case 'inhib': this.ev.push([t, 'in', e.team, e.lane || '']); win(e.team); break;
      case 'objective': if (e.team === 0 || e.team === 1) { this.ev.push([t, 'ob', e.team, e.obj, e.element || '', e.steal ? 1 : 0]); win(e.team); } break;
      case 'soul': this.ev.push([t, 'sl', e.team, e.element]); break;
      case 'heraldDrop': this.ev.push([t, 'on', e.team, e.lane || '']); break;
      case 'moment': this.ev.push([t, 'mo', e.team, e.id]); break;
      case 'call': { const w = this.win[e.team]; if (w && ACTS.has(e.call.type)) w.acted = true; break; }
      case 'victory': this.ev.push([t, 'v', e.team, e.timeout ? 1 : 0]); break;
    }
  }
  // Missed chances: a 2+ hero advantage (enemies dead) that lasted 5s+ with no call to use it and nothing taken.
  second() {
    const g = this.g;
    for (let T = 0; T < 2; T++) {
      const dead = (t) => g.teams[t].heroes.filter((x) => !x.alive).length, adv = dead(1 - T) - dead(T);
      const up = () => [g.teams[T].heroes.length - dead(T), g.teams[1 - T].heroes.length - dead(1 - T)];
      let w = this.win[T];
      if (adv >= 2) {
        if (!w) {
          const o = g.objectives;
          // a call made in the last 3s already counts
          const recent = g.events.some((e) => e.type === 'call' && e.team === T && e.t >= g.tick - 60 && ACTS.has(e.call.type));
          w = this.win[T] = { tick: g.tick, adv, n: up(), obj: o.boss && o.boss.alive ? 'boss' : o.baron && o.baron.alive ? 'baron' : o.dragon && o.dragon.alive ? 'dragon' : o.herald && o.herald.alive ? 'herald' : '', acted: recent, got: false };
        } else if (adv > w.adv) { w.adv = adv; w.n = up(); }
      } else if (w) {
        if (g.tick - w.tick >= 100 && !w.acted && !w.got && w.tick - this.lastMissed[T] > 800) { this.missed.push([r1(w.tick / 20), T, w.n[0], w.n[1], w.obj]); this.lastMissed[T] = w.tick; }
        this.win[T] = null;
      }
    }
  }
  // The record so far (also mid-match: the Theater draws markers while its scout is still running).
  // extra: { my, cc: [Coach's Call cards offered, answered] }
  finish(extra = {}) {
    const g = this.g, gold = this.gold.slice();
    if (g.tick % SAMPLE) { const tot = (t) => g.teams[t].heroes.reduce((a, x) => a + x.goldEarned, 0); gold.push(r10(tot(0) - tot(1))); }
    const name = (id) => { const u = id && g.byId(id); return u && u.heroId ? u.heroId : ''; };
    return {
      v: 1, map: g.world.def.id, mode: g.mode, len: Math.round(g.time), winner: g.winner, my: extra.my ?? -1, step: SAMPLE / 20,
      heroes: [...g.teams[0].heroes, ...g.teams[1].heroes].map((x) => [x.heroId, x.team, x.role, x.kills, x.deaths, x.assists, Math.round(x.dmgHeroes), Math.round(x.dmgTaken), Math.round(x.healed), Math.round(x.goldEarned), x.cs, x.build, x.level]),
      gold, ev: this.ev.slice(), missed: this.missed.slice(),
      calls: g.callLog.filter((c) => c.type !== 'tactic').map((c) => [r1(c.t / 20), c.team, c.type, c.type === 'permit' ? name(c.target) || name(c.hero) : c.lane || c.obj || '', c.result || 'expired', c.why || '', c.kind || '']),
      cc: extra.cc || null,
      // game plans (v22): [start, end, halftime switch second] per team, the clock scale, and Protect the Carry's carry
      plans: g.teams.map((t) => [normPlan(g.cfg.teams[t.id].plan), t.plan, t.planAt ? r1(t.planAt / 20) : 0]), k: g.rules.k || 1,
      carry: g.teams.map((t) => (t.planCarry && t.planCarry.heroId) || ''),
    };
  }
}

// ───────────────────────── analysis ─────────────────────────
// a missed chance: [t, team, our heroes up, their heroes up, objective up]
const missText = (m) => `${m[2]}v${m[3]} ${m[4] ? `with the ${objName(m[4])} up` : 'with lanes open'}`;
function goldAt(A, s) {
  const G = A.gold, f = s / (A.step || 5), i = Math.max(0, Math.min(G.length - 1, Math.floor(f))), j = Math.min(G.length - 1, i + 1);
  return G[i] + (G[j] - G[i]) * Math.max(0, Math.min(1, f - i));
}
const CALL_NAME = { gank: 'Gank', objective: 'Objective', group: 'Push', shrine: 'Shrine', invade: 'Invade', permit: 'Green light' };
const WHY = { stolen: 'stolen by their jungler', lostTower: 'lost a tower there', lostHero: 'lost a hero', died: 'the hero died', gankerDied: 'the ganker died first',
  flashed: 'the enemy flashed away', recalled: 'the target recalled', escaped: 'the target escaped', empty: 'no one was in lane', pickedOff: 'the team got picked off', slow: 'ran out of time',
  notStarted: 'the team never got there', contested: 'the shrine was contested', noTower: 'no tower fell', fizzled: 'it fizzled', expired: 'nothing came of it' };
function callLabel(c) {
  const [, , type, tgt, , , kind] = c;
  if (type === 'objective') return `Take ${objName(tgt)}`;
  if (type === 'gank') return `Gank ${LANE[tgt] || ''}`.trim();
  if (type === 'group') return `Push ${LANE[tgt] || ''}`.trim();
  if (type === 'permit') return `${heroName(tgt)} ${kind === 'split' ? 'split' : 'play'}`;
  return CALL_NAME[type] || type;
}
// side: 'you'/'they' wording for a coach, Blue/Red for spectators
const teamWord = (A, t, cap = true) => (A.my >= 0 ? (t === A.my ? (cap ? 'You' : 'you') : (cap ? 'They' : 'they')) : TEAM_NAME[t]);
const teamSubj = (A, t) => (A.my >= 0 ? (t === A.my ? 'Your team' : 'The enemy') : TEAM_NAME[t]);

export function analyze(A) {
  const kills = A.ev.filter((e) => e[1] === 'k');
  // fights: kills no more than 10s apart
  const fights = [];
  for (const k of kills) {
    let f = fights[fights.length - 1];
    if (!f || k[0] - f.t1 > 10) fights.push(f = { t0: k[0], t1: k[0], n: [0, 0], places: {}, ace: -1 });
    f.t1 = k[0]; f.n[k[2]]++; f.places[k[5]] = (f.places[k[5]] || 0) + 1; if (k[6]) f.ace = k[2];
  }
  // a fight's place: the area most of its kills were in (then the most common exact spot inside it)
  const top = (o) => Object.entries(o).sort((a, b) => b[1] - a[1])[0][0];
  for (const f of fights) { const by = {}; for (const [k, n] of Object.entries(f.places)) by[coarse(k)] = (by[coarse(k)] || 0) + n; const c = top(by);
    f.place = top(Object.fromEntries(Object.entries(f.places).filter(([k]) => coarse(k) === c))); f.total = f.n[0] + f.n[1]; f.won = f.n[0] === f.n[1] ? -1 : f.n[0] > f.n[1] ? 0 : 1; }
  const big = fights.filter((f) => f.total >= 2);
  // calls: stats + payoff = gold-lead swing over the next 30s, from the caller's side
  const calls = A.calls.map((c) => { const sg = c[1] === 0 ? 1 : -1; return { c, t: c[0], team: c[1], label: callLabel(c), result: c[4], why: c[5], swing: r10((goldAt(A, Math.min(A.len, c[0] + 30)) - goldAt(A, c[0])) * sg) }; });
  const coach = [0, 1].map((T) => {
    const mine = calls.filter((c) => c.team === T), ok = mine.filter((c) => c.result === 'success');
    const best = ok.slice().sort((a, b) => b.swing - a.swing)[0] || null;
    return { made: mine.length, paid: ok.length, traded: mine.filter((c) => c.result === 'traded' || c.result === 'stolen').length, list: mine, best, missed: A.missed.filter((m) => m[1] === T) };
  });
  const turn = turningPoint(A, big, calls);
  // the key-event timeline
  const tl = [];
  const add = (t, team, kind, text, extra = {}) => tl.push({ t, team, kind, text, ...extra });
  if (kills.length) { const k = kills[0]; add(k[0], k[2], 'fb', `First blood: ${k[4] ? heroName(k[4]) : teamWord(A, k[2])} on ${heroName(k[3])}`); }
  for (const e of A.ev) {
    const [t, ty, tm] = e, W = teamWord(A, tm);
    if (ty === 'tw') add(t, tm, 'tw', `${W} took a ${LANE[e[3]] || 'base'} tower`);
    else if (ty === 'in') add(t, tm, 'in', `${W} broke the ${LANE[e[3]] || ''} gate`.replace('  ', ' '));
    else if (ty === 'ob') add(t, tm, 'ob', `${W} ${took(e[3], e[5])} the ${objName(e[3], e[4])}${e[3] === 'boss' ? ": Tengu's Gale" : ''}`, { obj: e[3], el: e[4] });
    else if (ty === 'sl') add(t, tm, 'sl', `${W} earned the ${DRAGON_INFO[e[3]] ? DRAGON_INFO[e[3]].short : ''} Kami Blessing`);
    else if (ty === 'on') add(t, tm, 'on', `${W} unleashed the Oni ${LANE[e[3]] || ''}`.trim());
    else if (ty === 'mo') add(t, tm, 'mo', `${A.my >= 0 ? (tm === A.my ? 'Your' : 'Their') : TEAM_NAME[tm]} Coach Moment: ${(MOMENTS[e[3]] || {}).name || e[3]}`);
  }
  for (const f of big) {
    if (f.ace >= 0) add(f.t1, f.ace, 'ace', `${teamWord(A, f.ace)} aced ${teamWord(A, 1 - f.ace, false)} ${where(A, f.place)}`);
    else if (f.total >= 3) add(f.t0, f.won, 'fight', `Fight ${where(A, f.place)}: ${f.won < 0 ? `even ${f.n[0]}-${f.n[1]}` : `${teamWord(A, f.won)} won ${Math.max(...f.n)}-${Math.min(...f.n)}`}`);
  }
  for (const c of calls) if (A.my < 0 || c.team === A.my) {
    const ok = c.result === 'success';
    add(c.t, c.team, 'call', `${A.my >= 0 ? 'Your call' : TEAM_NAME[c.team] + ' call'}: ${c.label}`, { ok, sub: ok ? `paid off${c.swing ? `, ${c.swing > 0 ? '+' : ''}${kGold(c.swing)} gold swing` : ''}` : (WHY[c.why] || WHY[c.result] || c.result) });
  }
  for (const m of A.missed) if (A.my < 0 || m[1] === A.my) add(m[0], m[1], 'miss', `Missed chance: ${missText(m)}`, { sub: `no call (try ${m[4] ? 'Objective' : 'Push'})` });
  if (turn) add(turn.t0, turn.team, 'turn', 'Turning point', { sub: turn.short });
  tl.sort((a, b) => a.t - b.t);
  const kda = A.heroes.map((x) => ({ id: x[0], team: x[1], role: x[2], k: x[3], d: x[4], a: x[5], dealt: x[6], taken: x[7], healed: x[8], gold: x[9], cs: x[10], build: x[11], lv: x[12] }));
  const lead = A.gold.reduce((m, v) => ({ max: Math.max(m.max, v), min: Math.min(m.min, v) }), { max: 0, min: 0 });
  return { fights: big, kills, calls, coach, turn, tl, heroes: kda, lead };
}

// Where the winner pulled away for good. If they came from behind: the 60s window around the moment they took
// the gold lead for the last time (biggest swing their way). If they led throughout: the biggest 60s swing
// before the final push (a Crystal falling is the result, not the turning point). Too even on gold? Then the
// structure that decided it.
function turningPoint(A, fights, calls) {
  const w = A.winner, G = A.gold, st = A.step || 5;
  if (!(w === 0 || w === 1) || G.length < 4) return null;
  const s = G.map((v) => (w === 0 ? v : -v));
  let cross = -1;
  for (let k = s.length - 1; k > 0 && s[k] > 0; k--) if (s[k - 1] <= 0) { cross = k; break; }
  const crystal = A.ev.some((e) => e[1] === 'v' && !e[3]);
  const lastJ = crystal ? Math.max(1, s.length - 1 - Math.round(45 / st)) : s.length - 1;
  let best = null;
  for (let i = 0; i < s.length; i++) for (let j = i + 1; j < Math.min(s.length, i + 13); j++) {
    if (cross > 0 ? !(i < cross && j >= cross) : j > lastJ) continue;
    const gain = s[j] - s[i]; if (gain <= 0) continue;
    if (!best || gain > best.gain) best = { i, j, gain, flip: cross > 0 };
  }
  const subj = teamSubj(A, w), them = A.my >= 0 ? (w === A.my ? 'them' : 'you') : TEAM_NAME[1 - w];
  // won without the gold (on time, or a late base race): the run of structures that decided it
  if (!best || best.gain < 600 || s[s.length - 1] <= 0) {
    const sts = A.ev.filter((e) => (e[1] === 'in' || e[1] === 'tw') && e[2] === w);
    if (!sts.length) return null;
    let run = null;
    for (const a of sts) { const n = sts.filter((b) => b[0] >= a[0] && b[0] <= a[0] + 120); if (!run || n.length >= run.length) run = n; }
    const t0 = run[0][0], t1 = run[run.length - 1][0], tw = run.filter((e) => e[1] === 'tw').length, gate = run.find((e) => e[1] === 'in');
    const what = [tw ? (tw === 1 ? 'took a tower' : `took ${tw} towers`) : null, gate ? `broke the ${LANE[gate[3]] || ''} gate`.replace('  ', ' ') : null].filter(Boolean).join(' and ');
    const lose = teamSubj(A, 1 - w), ahead = s[s.length - 1] < -600;
    const timeout = A.ev.find((e) => e[1] === 'v' && e[3]);
    const head = ahead ? `${lose} led on gold, but ${subj === 'Your team' ? 'your team' : subj === 'The enemy' ? 'the enemy' : subj} won on structures. ` : '';
    return { t0: Math.max(0, t0 - 10), t1, team: w, gain: 0, flip: false, at: fmt(t0), short: `${subj} ${what}`,
      text: `${head}${fmt(t0)}${t1 > t0 ? '-' + fmt(t1) : ''}: ${subj} ${what}${timeout ? ', and that tower count decided it at 0:00' : ''}.` };
  }
  const t0 = best.i * st, t1 = best.j * st, inW = (t) => t >= t0 - 5 && t <= t1 + 5;
  const parts = [];
  // fights in the window, merged per place ("won fights at the Kraken pit 5-1")
  const byPlace = {};
  for (const f of fights) if (inW(f.t0)) { const pk = coarse(f.place), q = byPlace[pk] || (byPlace[pk] = { n: [0, 0], k: 0, ace: false }); q.n[0] += f.n[0]; q.n[1] += f.n[1]; q.k++; q.ace = q.ace || f.ace === w; }
  for (const [pl, q] of Object.entries(byPlace)) if (q.n[w] > q.n[1 - w]) parts.push(`won ${q.k > 1 ? 'fights' : 'a fight'} ${where(A, pl)} ${q.n[w]}-${q.n[1 - w]}${q.ace ? ' and aced ' + them : ''}`);
  for (const e of A.ev) if (inW(e[0]) && e[2] === w) {
    if (e[1] === 'ob') parts.push(`${took(e[3], e[5])} the ${objName(e[3], e[4])}`);
    if (e[1] === 'in') parts.push(`broke the ${LANE[e[3]] || ''} gate`);
  }
  const tw = A.ev.filter((e) => e[1] === 'tw' && e[2] === w && inW(e[0])).length;
  if (tw) parts.push(tw === 1 ? 'took a tower' : `took ${tw} towers`);
  if (!parts.length) parts.push('out-farmed and out-rotated ' + them);
  const never = s.slice(best.j + 1).every((v) => v > 0);
  const list = parts.length > 1 ? parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1] : parts[0];
  let text = `${fmt(t0)}-${fmt(t1)}: ${subj} ${list}. That was a ${kGold(best.gain)} gold swing${best.flip ? ' that flipped the lead' : ''}${never ? (best.flip ? ', and they never trailed again' : ' they never gave back') : ''}.`;
  const myCalls = A.my >= 0 ? calls.filter((c) => c.team === A.my && c.t >= t0 - 15 && c.t <= t1) : [];
  if (A.my >= 0 && w === A.my) { const good = myCalls.find((c) => c.result === 'success'); if (good) text += ` Your "${good.label}" call set it up.`; }
  else if (A.my >= 0 && !myCalls.length) text += ' Your team had no call out while it happened.';
  return { t0, t1, team: w, gain: best.gain, flip: best.flip, at: fmt(t0), short: `${subj} ${parts[0]} (${kGold(best.gain)} swing)`, text };
}

// ───────────────────────── UI ─────────────────────────
const css = (v, fb) => (D ? getComputedStyle(document.documentElement).getPropertyValue(v).trim() || fb : fb);
const bossImg = {};
function boss(obj, el, redraw) {
  const k = obj + (el || '');
  if (!bossImg[k]) {
    const KF = { infernal: 'kami_infernal', ocean: 'kami_ocean', mountain: 'kami_mountain', cloud: 'kami_cloud', elder: 'kami_elder' };
    const i = new Image(); i.src = `assets/img/boss/${obj === 'dragon' ? KF[el] || 'kami_elder' : obj === 'herald' ? 'herald_faceset' : obj === 'boss' ? 'tengu_faceset' : obj === 'yokai' ? 'yokai_faceset' : 'baron_faceset'}.png`;
    bossImg[k] = i; i.redraws = [];
    i.onload = () => { for (const f of i.redraws.splice(0)) f(); };
  }
  const i = bossImg[k]; if (!i.complete && redraw) i.redraws.push(redraw);
  return i.complete && i.naturalWidth ? i : null;
}

// Marker glyphs for the graph and the Theater scrub bar (kind → how it is drawn).
export function markerList(A, d) {
  const out = [];
  for (const e of A.ev) {
    if (e[1] === 'ob') out.push({ t: e[0], team: e[2], kind: 'ob', obj: e[3], el: e[4], label: `${fmt(e[0])} ${teamWord(A, e[2])} ${took(e[3], e[5])} the ${objName(e[3], e[4])}` });
    else if (e[1] === 'tw' || e[1] === 'in') out.push({ t: e[0], team: e[2], kind: e[1], label: `${fmt(e[0])} ${teamWord(A, e[2])} ${e[1] === 'in' ? 'broke the ' + (LANE[e[3]] || '') + ' gate' : 'took a ' + (LANE[e[3]] || 'base') + ' tower'}` });
    else if (e[1] === 'mo') out.push({ t: e[0], team: e[2], kind: 'mo', label: `${fmt(e[0])} ${TEAM_NAME[e[2]]} Coach Moment: ${(MOMENTS[e[3]] || {}).name || e[3]}` });
  }
  for (const f of d.fights) out.push({ t: f.t0, t1: f.t1, team: f.won < 0 ? -1 : f.won, kind: f.ace >= 0 ? 'ace' : 'fight', n: f.total, label: `${fmt(f.t0)} ${f.ace >= 0 ? 'Ace' : 'Fight'} ${where({ my: -1 }, f.place)}: Blue ${f.n[0]} - Red ${f.n[1]}` });
  return out.sort((a, b) => a.t - b.t);
}
// One marker glyph at (x, y). Shared by the gold graph and the Theater bar.
export function drawMarker(ctx, m, x, y, s, redraw) {
  const col = m.team === 0 ? css('--team0', '#4aa3ff') : m.team === 1 ? css('--team1', '#ff5a5a') : '#cfc6d6';
  ctx.save(); ctx.fillStyle = col; ctx.strokeStyle = '#120f18'; ctx.lineWidth = Math.max(1, s / 6);
  if (m.kind === 'ob') {
    const img = boss(m.obj, m.el, redraw);
    ctx.fillStyle = col; ctx.fillRect(x - s / 2 - 1, y - s / 2 - 1, s + 2, s + 2);
    if (img) { ctx.imageSmoothingEnabled = false; ctx.drawImage(img, x - s / 2, y - s / 2, s, s); }
  } else if (m.kind === 'tw' || m.kind === 'in') {
    const q = m.kind === 'in' ? s * 0.8 : s * 0.6; ctx.fillRect(x - q / 2, y - q / 2, q, q); ctx.strokeRect(x - q / 2, y - q / 2, q, q);
  } else if (m.kind === 'mo') {
    const q = s * 0.55; ctx.beginPath(); ctx.moveTo(x, y - q); ctx.lineTo(x + q, y); ctx.lineTo(x, y + q); ctx.lineTo(x - q, y); ctx.closePath(); ctx.fill(); ctx.stroke();
  } else if (m.kind === 'ace') {
    const R = s * 0.6, r = R * 0.45; ctx.beginPath();
    for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + k * Math.PI / 5, rr = k % 2 ? r : R; ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
    ctx.closePath(); ctx.fill(); ctx.stroke();
  } else { const r = Math.min(s * 0.5, 2 + (m.n || 2) * 0.8); ctx.beginPath(); ctx.arc(x, y, r, 0, 6.3); ctx.fill(); ctx.stroke(); }
  ctx.restore();
}

// The gold-lead graph: lead line + fill, minute grid, turning-point band, and an event lane per team below.
// opts.small: the compact results-card version. Returns a hit-test function (css px → nearest item).
function drawGraph(c, A, d, opts = {}) {
  const r = c.getBoundingClientRect(); if (r.width < 10) return () => null;
  const dpr = Math.min(2, window.devicePixelRatio || 1); c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr);
  const ctx = c.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const W = r.width, H = r.height, G = A.gold, st = A.step || 5, len = Math.max(A.len, st);
  const lane = opts.small ? 11 : 15, plotB = H - lane * 2 - 14, padL = 4, padR = 4, top = 4;
  const X = (t) => padL + (W - padL - padR) * Math.min(1, t / len);
  const mx = Math.max(1000, ...G.map(Math.abs)), mid = (top + plotB) / 2, Y = (v) => mid - v / mx * (mid - top - 2);
  const c0 = css('--team0', '#4aa3ff'), c1 = css('--team1', '#ff5a5a'), ink = '#a99fb3', grid = '#2a2333';
  ctx.clearRect(0, 0, W, H);
  // minute grid + labels
  ctx.font = '10px PixelFont, monospace'; ctx.textBaseline = 'alphabetic';
  const every = len > 600 ? 300 : len > 240 ? 120 : 60;
  for (let s = every; s < len; s += every) { ctx.fillStyle = grid; ctx.fillRect(Math.round(X(s)), top, 1, plotB - top); ctx.fillStyle = ink; ctx.fillText(fmt(s).replace(/:00$/, 'm'), X(s) + 2, H - 2); }
  // turning point band
  if (d.turn) { ctx.fillStyle = 'rgba(255,216,74,0.13)'; ctx.fillRect(X(d.turn.t0), top, Math.max(3, X(d.turn.t1) - X(d.turn.t0)), plotB - top); ctx.fillStyle = '#ffd84a'; ctx.fillRect(X(d.turn.t0), top, 1, plotB - top); }
  ctx.fillStyle = '#3d3346'; ctx.fillRect(padL, Math.round(mid), W - padL - padR, 1);
  // filled lead, coloured by who is ahead
  if (G.length > 1) {
    for (const [sgn, col] of [[1, c0], [-1, c1]]) {
      ctx.save(); ctx.beginPath(); if (sgn > 0) ctx.rect(0, 0, W, mid); else ctx.rect(0, mid, W, H); ctx.clip();
      ctx.beginPath(); ctx.moveTo(X(0), mid); G.forEach((v, i) => ctx.lineTo(X(i * st), Y(v))); ctx.lineTo(X((G.length - 1) * st), mid); ctx.closePath();
      ctx.globalAlpha = 0.22; ctx.fillStyle = col; ctx.fill(); ctx.globalAlpha = 1;
      ctx.beginPath(); G.forEach((v, i) => (i ? ctx.lineTo(X(i * st), Y(v)) : ctx.moveTo(X(0), Y(v)))); ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.stroke();
      ctx.restore();
    }
  }
  // direct labels (identity is never colour alone)
  ctx.fillStyle = ink; ctx.fillText(tr(`Blue +${kGold(mx)}`), padL + 2, top + 10); ctx.fillText(tr(`Red +${kGold(mx)}`), padL + 2, plotB - 3);
  // event lanes: Blue's row, then Red's
  const ms = markerList(A, d), hits = [];
  const rowY = (t) => plotB + 4 + lane * (t === 1 ? 1 : 0) + lane / 2;
  ctx.fillStyle = 'rgba(255,255,255,0.03)'; ctx.fillRect(padL, plotB + 4, W - padL - padR, lane * 2);
  const redraw = () => drawGraph(c, A, d, opts);
  for (const m of ms) {
    if (opts.small && m.kind === 'fight') continue;
    const x = X(m.t), y = rowY(m.team < 0 ? 0 : m.team);
    drawMarker(ctx, m, x, y, lane - 3, redraw); hits.push({ x, y, m });
  }
  return (px, py) => {
    let best = null, bd = 14 * 14;
    for (const h of hits) { const dd = (h.x - px) ** 2 + (h.y - py) ** 2; if (dd < bd) { bd = dd; best = h; } }
    if (best) return { x: best.x, y: best.y, text: best.m.label };
    if (py <= plotB && px >= padL) { const t = Math.max(0, Math.min(len, (px - padL) / (W - padL - padR) * len)), v = goldAt(A, t); return { x: X(t), y: Y(v), text: `${fmt(t)} · ${v >= 0 ? 'Blue' : 'Red'} +${kGold(Math.abs(v))} gold`, line: true }; }
    return null;
  };
}
// A graph canvas with a hover / tap tooltip.
function graphBox(A, d, opts) {
  const c = h('canvas', { class: 'agraph' + (opts.small ? ' small' : ''), role: 'img', 'aria-label': `Gold lead over time. ${d.turn ? 'Turning point at ' + d.turn.at + '.' : ''}` });
  const tip = h('div', { class: 'atip hidden' }), line = h('i', { class: 'aline hidden' });
  const box = h('div', { class: 'agbox' }, c, line, tip);
  let hit = () => null;
  const draw = () => { hit = drawGraph(c, A, d, opts); };
  const show = (e) => {
    const r = c.getBoundingClientRect(), p = hit(e.clientX - r.left, e.clientY - r.top);
    if (!p) { tip.classList.add('hidden'); line.classList.add('hidden'); return; }
    tip.textContent = p.text; tip.classList.remove('hidden');
    const tw = tip.offsetWidth; tip.style.left = Math.max(0, Math.min(r.width - tw, p.x - tw / 2)) + 'px'; tip.style.top = Math.max(0, p.y - 30) + 'px';
    line.classList.toggle('hidden', !p.line); line.style.left = p.x + 'px';
  };
  c.addEventListener('pointermove', show); c.addEventListener('pointerdown', show);
  c.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') { tip.classList.add('hidden'); line.classList.add('hidden'); } });
  box.redraw = draw;
  requestAnimationFrame(draw);
  const ro = new ResizeObserver(() => { if (c.isConnected) draw(); else ro.disconnect(); }); ro.observe(c);
  return box;
}

// Results-screen card: compact graph with markers, the turning point and the coach summary, plus the Analysis button.
export function analysisCard(A, onOpen) {
  const d = analyze(A), me = A.my >= 0 ? d.coach[A.my] : null;
  const sum = me ? [`Calls ${me.paid}/${me.made} paid off`, me.missed.length ? `${me.missed.length} missed chance${me.missed.length > 1 ? 's' : ''}` : 'no missed chances', me.best ? `best: ${me.best.label} ${me.best.swing > 0 ? '+' + kGold(me.best.swing) : ''}`.trim() : null].filter(Boolean) : [];
  return h('div', { class: 'panel acard' },
    h('div', { class: 'rth' }, h('b', {}, 'Match story'), h('span', { class: 'rstats' }, 'Gold lead · Blue above, Red below'), h('button', { class: 'btn small anbtn', onclick: onOpen, title: 'Turning point, damage, calls and the full timeline' }, 'Analysis')),
    graphBox(A, d, { small: true }),
    d.turn ? h('div', { class: 'aturn' }, h('b', {}, 'Turning point'), h('span', {}, d.turn.text)) : null,
    planLines(A),
    sum.length ? h('div', { class: 'asum muted' }, sum.join(' · ')) : null);
}

// ───────────────────────── the Analysis sheet ─────────────────────────
// opts: { title, onTheater, tab }
export function showAnalysis(A, opts = {}) {
  const d = analyze(A);
  document.getElementById('anasheet')?.remove();
  let tab = opts.tab || 'story';
  const body = h('div', { class: 'asbody' });
  const tabs = [['story', 'Story'], ['damage', 'Damage'], ['calls', 'Calls']];
  const tabEls = tabs.map(([k, l]) => h('button', { class: 'chip', role: 'tab', onclick: () => { tab = k; render(); } }, l));
  const close = () => { el.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  const res = A.my >= 0 ? (A.winner === A.my ? 'Victory' : A.winner < 0 ? 'No contest' : 'Defeat') : `${TEAM_NAME[A.winner] || '-'} won`;
  const el = h('div', { id: 'anasheet', class: 'anasheet', role: 'dialog', 'aria-label': 'Match analysis' },
    h('div', { class: 'ashead' },
      h('div', { class: 'astitle' }, h('b', {}, opts.title || 'Analysis'), h('small', { class: 'muted' }, `${res} · ${fmt(A.len)}`)),
      h('div', { class: 'tabs astabs', role: 'tablist' }, tabEls),
      h('div', { class: 'asbtns' }, opts.onTheater ? h('button', { class: 'btn small', title: 'Watch the replay with a timeline, speeds and jumps', onclick: () => { close(); opts.onTheater(); } }, '▶ Theater') : null,
        h('button', { class: 'btn small asclose', 'aria-label': 'Close', onclick: close }, '✕'))),
    body);
  const render = () => {
    tabEls.forEach((b, i) => { b.classList.toggle('on', tabs[i][0] === tab); b.setAttribute('aria-selected', String(tabs[i][0] === tab)); });
    body.replaceChildren(tab === 'story' ? storyTab(A, d) : tab === 'damage' ? damageTab(A, d) : callsTab(A, d));
    body.scrollTop = 0;
  };
  document.body.append(el);
  render();
  return el;
}
const KIND_ICON = { fb: '🩸', tw: '■', in: '▣', ob: '◉', sl: '✦', on: '☗', mo: '◆', ace: '★', fight: '⚔', call: '➤', miss: '!', turn: '⟳' };
function storyTab(A, d) {
  const rows = d.tl.map((x) => h('div', { class: 'tlrow k-' + x.kind + (x.team === 0 ? ' t0' : x.team === 1 ? ' t1' : '') + (x.ok === false ? ' bad' : x.ok ? ' good' : '') },
    h('span', { class: 'tlt' }, fmt(x.t)), h('i', { class: 'tli', 'aria-hidden': 'true' }, KIND_ICON[x.kind] || '•'),
    h('span', { class: 'tlx' }, x.text, x.sub ? h('small', {}, x.sub) : null)));
  const legend = h('div', { class: 'alegend muted' }, ...[['ob', 'Objective'], ['tw', 'Tower'], ['in', 'Gate'], ['ace', 'Ace'], ['fight', 'Fight'], ['mo', 'Coach Moment']].map(([k, l]) => {
    const c = h('canvas', { width: 28, height: 28, 'aria-hidden': 'true' }); const x = c.getContext('2d'); x.scale(2, 2);
    drawMarker(x, { kind: k, team: -1, obj: 'baron', n: 3 }, 7, 7, 11, () => { x.clearRect(0, 0, 14, 14); drawMarker(x, { kind: k, team: -1, obj: 'baron', n: 3 }, 7, 7, 11); });
    return h('span', {}, c, l);
  }));
  return h('div', { class: 'astory' },
    h('div', { class: 'asleft' }, graphBox(A, d, {}), legend,
      d.turn ? h('div', { class: 'aturn big' }, h('b', {}, `Turning point · ${d.turn.at}`), h('span', {}, d.turn.text)) : h('div', { class: 'aturn big' }, h('b', {}, 'No clear turning point'), h('span', {}, 'Nobody pulled away on gold.')),
      planLines(A),
      h('div', { class: 'atiles' }, tile('Biggest lead', `${d.lead.max >= -d.lead.min ? 'Blue' : 'Red'} +${kGold(Math.max(d.lead.max, -d.lead.min))}`), tile('Fights', String(d.fights.length)), tile('Aces', String(d.fights.filter((f) => f.ace >= 0).length)),
        tile('Objectives', `${A.ev.filter((e) => e[1] === 'ob' && e[2] === 0).length} - ${A.ev.filter((e) => e[1] === 'ob' && e[2] === 1).length}`))),
    h('div', { class: 'tl' }, h('div', { class: 'tlh' }, 'Key moments'), rows.length ? rows : h('div', { class: 'muted' }, 'A quiet game.')));
}
const tile = (k, v, cls = '') => h('div', { class: 'atile ' + cls }, h('b', {}, v), h('small', {}, k));
function damageTab(A, d) {
  const mx = Math.max(1, ...d.heroes.map((x) => Math.max(x.dealt, x.taken)));
  const topD = Math.max(...d.heroes.map((x) => x.dealt)), topT = Math.max(...d.heroes.map((x) => x.taken));
  const col = (t) => h('div', { class: 'dcol t' + t },
    h('div', { class: 'dch' }, h('b', {}, A.my >= 0 ? (t === A.my ? 'Your team' : 'Enemy team') : TEAM_NAME[t]), h('small', { class: 'muted' }, `${kGold(d.heroes.filter((x) => x.team === t).reduce((a, x) => a + x.dealt, 0))} dealt`)),
    ...d.heroes.filter((x) => x.team === t).map((x) => h('div', { class: 'drow' },
      h('img', { src: `assets/img/faces/${x.id}.png`, alt: '' }),
      h('div', { class: 'dn' }, h('b', {}, heroName(x.id)), h('small', { class: 'muted' }, `${ROLE_LABEL[x.role] || ''} · ${x.k}/${x.d}/${x.a}${BUILDS[x.build] ? ' · ' + BUILDS[x.build].name : ''}`)),
      h('div', { class: 'dbars' },
        h('div', { class: 'dbar dealt' + (x.dealt === topD ? ' top' : '') }, h('i', { style: { width: (x.dealt / mx * 100).toFixed(1) + '%' } }), h('span', {}, kGold(x.dealt))),
        h('div', { class: 'dbar taken' + (x.taken === topT ? ' top' : '') }, h('i', { style: { width: (x.taken / mx * 100).toFixed(1) + '%' } }), h('span', {}, kGold(x.taken)))))));
  return h('div', { class: 'adamage' },
    h('div', { class: 'alegend muted' }, h('span', {}, h('i', { class: 'sw dealt' }), 'Damage dealt to heroes'), h('span', {}, h('i', { class: 'sw taken' }), 'Damage taken'), h('span', {}, '★ = most in the match')),
    h('div', { class: 'dcols' }, col(A.my === 1 ? 1 : 0), col(A.my === 1 ? 0 : 1)));
}
function callsTab(A, d) {
  const teams = A.my >= 0 ? [A.my] : [0, 1];
  return h('div', { class: 'acalls' + (teams.length > 1 ? ' two' : '') }, ...teams.map((T) => {
    const c = d.coach[T], pct = c.made ? Math.round(c.paid / c.made * 100) : 0;
    const list = c.list.map((x) => h('div', { class: 'crow2 ' + (x.result === 'success' ? 'good' : 'bad') },
      h('span', { class: 'tlt' }, fmt(x.t)), h('b', {}, x.label),
      h('span', { class: 'badge ' + x.result }, x.result === 'success' ? 'paid off' : x.result),
      h('span', { class: 'cswing ' + (x.swing >= 0 ? 'up' : 'down'), title: 'Gold-lead swing in the 30s after the call' }, `${x.swing >= 0 ? '+' : ''}${kGold(x.swing)}`)));
    const miss = c.missed.map((m) => h('div', { class: 'crow2 miss' }, h('span', { class: 'tlt' }, fmt(m[0])), h('b', {}, missText(m)), h('span', { class: 'muted' }, `no call · try ${m[4] ? 'Objective' : 'Push'}`)));
    return h('div', { class: 'acteam' },
      teams.length > 1 ? h('div', { class: 'dch' }, h('b', { class: T ? 'red' : 'blue' }, `${TEAM_NAME[T]} coach`)) : null,
      h('div', { class: 'atiles' }, tile('Calls made', String(c.made)), tile('Paid off', `${c.paid} (${pct}%)`, pct >= 50 ? 'up' : ''), tile('Missed chances', String(c.missed.length), c.missed.length ? 'down' : ''),
        A.my === T && A.cc && A.cc[0] ? tile("Coach's Calls answered", `${A.cc[1]}/${A.cc[0]}`) : null),
      c.best ? h('div', { class: 'aturn' }, h('b', {}, `Best call · ${fmt(c.best.t)}`), h('span', {}, `${c.best.label}: ${c.best.swing > 0 ? `+${kGold(c.best.swing)} gold swing in 30s` : 'paid off'}.`)) : null,
      h('div', { class: 'tlh' }, 'Calls'), list.length ? list : h('div', { class: 'muted' }, 'No calls made. Calls cost charges (+1 every 20s): use them on open lanes, objectives and numbers advantages.'),
      miss.length ? [h('div', { class: 'tlh' }, 'Missed chances'), h('small', { class: 'muted' }, 'You were up two or more heroes for 5s+ and no call went out to cash it in.'), miss] : null);
  }));
}
