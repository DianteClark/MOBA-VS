// The deterministic match simulation. Same seed + same commands => same game.
import { Rng, hashInts } from './rng.js';
import { dist2, dist, norm, r2 } from './geom.js';
import { DT, sec, BLUE, RED, NEUTRAL, T, GOLD, XP, xpNeeded, VISION, CMD, DRAGONS, RANGE, CLANS, WEATHER, HALFTIME, MOMENTUM, PERMIT } from './constants.js';
import { LEASH } from './constants.js';
import { World, S as MAP_SIZE, C as CELL, N as GRID_N } from './world.js';
import { MAP_BY_ID } from '../maps/defs.js';
import { HERO_BY_ID, PERSONALITIES } from '../data/heroes.js';
import { TACTICS, DEFAULT_DECK } from '../data/tactics.js';
import { TUNE } from '../data/tuning.js';
import { BUILDS } from '../data/items.js';
import { heroThink, heroMacro, laneBrain } from './ai.js';
import { Coach } from './coach.js';
import * as FX from './effects.js';
import { rulesFor } from './modes.js';
import { applyMoment } from './moments-coach.js';
import { normPlan, planChangeOk, planEdge } from './plans.js';
import { setupCoop, coopGate } from './coop.js';
import { openCrystal } from './endgame.js';

// Champion-vs-champion damage scale: keeps fights readable and lanes from snowballing at level 1.
const STEER_K = +(globalThis.process?.env?.SK || 0.45);
const HERO_VS_HERO = 0.6;
// Per-tick fair coin for who acts first (a 32-bit integer hash of the tick; deterministic, no RNG draw).
const tickCoin = (t) => { let h = Math.imul(t ^ 0x5bd1e995, 0x9e3779b1); h ^= h >>> 15; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; return (h >>> 7) & 1; };
// Tower reach (range + hero radius) must beat hero reach (range + both radii) to the tower.
const HERO_RANGE_CAP = RANGE.tower - 45;
const CAMP_DEFS = {
  bluebuff: { name: 'Sentinel', buff: 'blue', mobs: [{ k: 'camp_bluebuff', hp: 1800, ad: 45, big: true }] },
  redbuff: { name: 'Brambleback', buff: 'red', mobs: [{ k: 'camp_redbuff', hp: 1800, ad: 55, big: true }] },
  wolf: { name: 'Wolves', mobs: [{ k: 'camp_wolf', hp: 1100, ad: 35, big: true }, { k: 'camp_wolf', hp: 400, ad: 15, dx: 34, dy: 20 }, { k: 'camp_wolf', hp: 400, ad: 15, dx: -30, dy: 26 }] },
  raptor: { name: 'Raptors', mobs: [{ k: 'camp_raptor', hp: 800, ad: 25, big: true }, { k: 'camp_raptor', hp: 250, ad: 10, dx: 30, dy: -18 }, { k: 'camp_raptor', hp: 250, ad: 10, dx: -28, dy: 22 }, { k: 'camp_raptor', hp: 250, ad: 10, dx: 6, dy: 34 }] },
  gromp: { name: 'Gromp', mobs: [{ k: 'camp_gromp', hp: 1500, ad: 50, big: true }] },
  krug: { name: 'Krugs', mobs: [{ k: 'camp_krug', hp: 1300, ad: 40, big: true }, { k: 'camp_krug', hp: 700, ad: 20, dx: 34, dy: 10 }] },
};
const ROLE_LANE = { top: 'top', mid: 'mid', bot: 'bot', support: 'bot', jungle: null };
const STAT_KEYS = ['dmgPct', 'siegePct', 'power', 'powerMult', 'hp', 'armor', 'mr', 'asPct', 'crit', 'critDmg', 'pen', 'haste', 'msPct', 'range', 'omnivamp',
  'antiheal', 'thorns', 'healPower', 'execute', 'slowOnHit', 'regen', 'hpPct', 'lowHpShield', 'burnAura', 'shredAura', 'censer', 'resPct', 'regenPct',
  'tenacity', 'sight', 'sunder', 'tankBuster', 'waveClear', 'lone', 'spellblade', 'sbSlow', 'guard', 'peelSlow', 'onHit', 'drPct'];

class Grid {
  constructor(cell) { this.cell = cell; this.n = Math.ceil(MAP_SIZE / cell) + 2; this.cells = new Array(this.n * this.n); }
  clear() { for (let i = 0; i < this.cells.length; i++) this.cells[i] = undefined; }
  key(x, y) { const cx = Math.max(0, Math.min(this.n - 1, Math.floor(x / this.cell))), cy = Math.max(0, Math.min(this.n - 1, Math.floor(y / this.cell))); return cy * this.n + cx; }
  add(e) { const k = this.key(e.x, e.y); (this.cells[k] || (this.cells[k] = [])).push(e); }
  query(x, y, r, out = []) {
    const c = this.cell, n = this.n;
    const x0 = Math.max(0, Math.floor((x - r) / c)), x1 = Math.min(n - 1, Math.floor((x + r) / c));
    const y0 = Math.max(0, Math.floor((y - r) / c)), y1 = Math.min(n - 1, Math.floor((y + r) / c));
    const r2_ = r * r;
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
      const arr = this.cells[cy * n + cx]; if (!arr) continue;
      for (const e of arr) { const dx = e.x - x, dy = e.y - y; if (dx * dx + dy * dy <= r2_) out.push(e); }
    }
    return out;
  }
}

export class Game {
  /**
   * @param {object} cfg { seed, teams: [ {heroes:[{id, role, build}], plan, name}, {...} ], coach: [bool,bool] }
   */
  constructor(cfg) {
    this.cfg = cfg;
    this.rng = new Rng(cfg.seed >>> 0);
    this.mode = cfg.mode || 'classic'; this.rules = rulesFor(this.mode, cfg.event); this.T = this.rules.T;
    this.event = this.rules.event; // weekly map event id (src/data/events.js) or null for Classic
    this.tick = 0;
    this.nextId = 1;
    this.units = [];          // everything that can be hit
    this.projectiles = [];
    this.pending = [];        // delayed ground effects
    this.zones = [];
    this.wards = [];
    this.events = [];         // UI-facing event log (deterministic)
    this.fx = [];             // cosmetic hints for renderer (cleared by renderer)
    this.grid = new Grid(128);
    this.over = false; this.winner = -1;
    this.vision = [new Set(), new Set()];
    this.lastSeen = [{}, {}];
    this.callLog = [];
    this.teams = [0, 1].map((t) => ({
      id: t, plan: normPlan(cfg.teams[t].plan), name: cfg.teams[t].name || (t === 0 ? 'Blue' : 'Red'),
      charges: 1, kills: 0, towers: 0, dragons: [], soul: null, heraldEye: 0, baronUntil: 0, elderUntil: 0,
      focus: null, call: null, heroes: [], goldHistory: [], invadeCamp: null,
      deck: (cfg.teams[t].deck || DEFAULT_DECK).slice(0, 3).map((id) => ({ id, used: false })), siegeWaves: {}, siegeUntil: 0, fortifyUntil: 0, pactUntil: 0, swapUntil: 0,
      momentum: 0, surgeUntil: 0, permitCd: 0, moments: {}, momentCd: 0, allOut: 0,
    }));
    this.world = new World(MAP_BY_ID[cfg.map] || MAP_BY_ID.sakura);
    this.visGrid = [new Uint8Array(GRID_N * GRID_N), new Uint8Array(GRID_N * GRID_N)];
    this.camps = [];
    this.objectives = { dragon: null, herald: null, baron: null };
    this.objTimers = { dragon: sec(this.T.dragonFirst), herald: sec(this.T.heraldFirst), baron: sec(this.T.baronFirst) };
    this.dragonQueue = [];
    this.nextDragon = this.rollDragon();
    this.waveCount = 0;
    this.nextWave = sec(this.T.firstWave);
    this.coaches = [null, null];
    this.setupStructures();
    this.setupCamps();
    this.shrines = this.world.shrines.map((p, i) => ({ id: i, x: p.x, y: p.y, owner: -1, progress: 0, capTeam: -1 }));
    const wl = this.world.def.weather || ['clear'];
    const off = (cfg.seed >>> 3) % wl.length;
    this.weatherList = wl.map((_, i) => wl[(i + off) % wl.length]);
    this.weatherIdx = -1;
    this.clanStats = [{}, {}];
    for (let t = 0; t < 2; t++) for (const h of cfg.teams[t].heroes) this.spawnHero(t, h);
    if (cfg.coop) setupCoop(this); // co-op coaching: which coach owns which hero (src/sim/coop.js)
    for (let t = 0; t < 2; t++) {
      const counts = {};
      for (const h of this.teams[t].heroes) counts[h.def.clan] = (counts[h.def.clan] || 0) + 1;
      const st = {}, active = [];
      for (const [c, n] of Object.entries(counts)) {
        const tier = CLANS[c].tiers.filter((x) => n >= x.n).pop();
        if (tier) { active.push({ clan: c, n, text: tier.text }); for (const [k, v] of Object.entries(tier.stats)) st[k] = (st[k] || 0) + v; }
      }
      this.clanStats[t] = st; this.teams[t].clans = active;
    }
    FX.setupSynergy(this); // team comp bonus joins the clan stats; duo links
    for (let t = 0; t < 2; t++) for (const h of this.teams[t].heroes) { this.recalc(h); h.hp = h.maxHp; }
    for (let t = 0; t < 2; t++) if (cfg.coach && cfg.coach[t]) this.coaches[t] = new Coach(this, t, cfg.coachLevel?.[t] ?? 1, cfg.coachStyle?.[t] || null);
  }

  get time() { return this.tick * DT; }
  get timeLeft() { return Math.max(0, this.rules.seconds - this.time); }
  get siegeRamp() { const p = this.rules.pace; return 1 + Math.max(0, this.time - p.rampFrom) / p.rampPer + (p.lateFrom ? Math.max(0, this.time - p.lateFrom) / p.latePer : 0); }
  get finalPhase() { return this.time >= this.rules.final.at; }
  get finalMult() { return this.time >= this.rules.final.at ? this.rules.final.gold : 1; }
  get halftimeTick() { return this.rules.halftime ? sec(this.rules.halftime) : -1; }
  // Minutes on a classic-match clock (side modes run their scaling faster).
  get gameMinute() { return this.time / 60 * this.rules.timeScale; }
  get wx() { return WEATHER[this.weatherList[Math.max(0, this.weatherIdx)]] || WEATHER.clear; }
  updateWeather() {
    const idx = Math.min(this.weatherList.length - 1, Math.floor(this.time / this.T.weatherPhase));
    if (idx !== this.weatherIdx) { this.weatherIdx = idx; this.emit({ type: 'weather', weather: this.weatherList[idx] }); }
  }
  towersStanding(team) { let n = 0; for (const u of this.units) if (u.type === 'tower' && u.team === team && u.alive) n++; return n; }
  // Clock ran out: more towers standing wins; then crystal HP, kills, gold.
  timeUp() {
    const a = this.towersStanding(0), b = this.towersStanding(1);
    let w;
    if (a !== b) w = a > b ? 0 : 1;
    else {
      const nx = (t) => { const n = this.units.find((u) => u.type === 'nexus' && u.team === t); return n ? n.hp / n.maxHp : 0; };
      const ha = nx(0), hb = nx(1);
      if (Math.abs(ha - hb) > 1e-6) w = ha > hb ? 0 : 1;
      else if (this.teams[0].kills !== this.teams[1].kills) w = this.teams[0].kills > this.teams[1].kills ? 0 : 1;
      else { const g = (t) => this.teams[t].heroes.reduce((s, h) => s + h.goldEarned, 0); const ga = g(0), gb = g(1); w = ga !== gb ? (ga > gb ? 0 : 1) : (this.rng.next() < 0.5 ? 0 : 1); }
    }
    this.over = true; this.winner = w;
    this.emit({ type: 'victory', team: w, timeout: true, towers: [a, b] });
  }
  playTactic(c) {
    const team = this.teams[c.team], card = team.deck.find((d) => d.id === c.card && !d.used);
    if (!card || !TACTICS[c.card]) return false;
    const now = this.tick, alive = team.heroes.filter((h) => h.alive);
    const lanes = this.world.laneNames;
    if (!alive.length && ['smoke', 'rally', 'wind', 'ambush', 'bait', 'swap'].includes(c.card)) return false;
    switch (c.card) {
      case 'smoke': for (const h of alive) { h.stealthUntil = now + sec(8); this.addBuff(h, { msPct: 0.1 }, 8, 'smoke'); this.fx.push({ kind: 'fx', name: 'smoke', x: h.x, y: h.y, s: 1.6 }); } break;
      case 'rally': for (const h of alive) { this.addBuff(h, { msPct: 0.15, asPct: 0.15 }, 12, 'rally'); this.fx.push({ kind: 'fx', name: 'boost', x: h.x, y: h.y, s: 1.2, follow: h.id }); } break;
      case 'wind': for (const h of alive) { this.heal(h, h.maxHp * 0.25, null); h.slows = []; this.fx.push({ kind: 'fx', name: 'spirit', x: h.x, y: h.y, s: 1.4, follow: h.id }); } break;
      case 'sweep': {
        this.wards = this.wards.filter((w) => w.team === c.team);
        for (const e of this.teams[1 - c.team].heroes) if (e.alive) { e.revealUntil = now + sec(4); e.stealthUntil = 0; }
        break;
      }
      case 'fortify': team.fortifyUntil = now + sec(25); break;
      case 'siege': if (!lanes.includes(c.lane)) return false; team.siegeWaves[c.lane] = 2; team.siegeUntil = now + sec(30); break;
      case 'eyes': {
        const W = this.world, far = this.shrines.find((x) => x.id !== c.team) || this.shrines[0];
        for (const p of [W.pits.kami, W.pits.kraken, far]) { const sp = W.nearestOpen(p); this.wards.push({ team: c.team, x: sp.x, y: sp.y, until: now + sec(90), owner: 0 }); }
        break;
      }
      case 'council': team.charges = CMD.maxCharges; break;
      case 'barrier': for (const h of alive) { this.addShield(h, h.maxHp * 0.2, 4); this.fx.push({ kind: 'shield', id: h.id }); } break;
      case 'gate': for (const h of alive) { h.gateAt = now + sec(1.5); h.castLock = now + sec(1.5); h.recallAt = 0; this.fx.push({ kind: 'fx', name: 'spirit', x: h.x, y: h.y, s: 1.3, follow: h.id }); } break;
      case 'pact': {
        const live = ['dragon', 'herald', 'baron'].map((k) => this.objectives[k]).filter((o) => o && o.alive);
        if (!live.length) return false;
        const o = live.sort((a, b) => dist2(a, this.world.fountain[c.team]) - dist2(b, this.world.fountain[c.team]))[0];
        team.pactUntil = now + sec(20);
        const pick = alive.slice().sort((a, b) => dist2(a, o) - dist2(b, o)).slice(0, 4);
        for (const h of pick) this.setCallTask(h, { kind: 'objective', obj: o.kind, until: now + sec(T.objectiveTimeout), call: true });
        break;
      }
      case 'bait': {
        const b = team.heroes.find((h) => h.id === c.hero && h.alive); if (!b) return false;
        this.addShield(b, b.maxHp * 0.3, 6); this.fx.push({ kind: 'shield', id: b.id });
        for (const h of alive) if (h !== b && dist2(h, b) < 1300 * 1300) { h.task = { kind: 'help', ally: b.id, until: now + sec(10), call: true }; h.pendingCall = null; }
        break;
      }
      case 'ambush': {
        if (!lanes.includes(c.lane)) return false;
        const anchor = this.world.lanePoint(c.lane, c.team === 0 ? 0.42 : 0.58);
        let spot = null, bd = Infinity;
        const W = this.world;
        for (let i = 0; i < W.brush.length; i++) if (W.brush[i]) { const p = { x: (i % 100) * 24 + 12, y: ((i / 100) | 0) * 24 + 12 }; const d = dist2(p, anchor); if (d < bd && W.closestLane(p) === c.lane) { bd = d; spot = p; } }
        if (!spot || bd > 450 * 450) spot = W.nearestOpen(anchor);
        const jg = alive.find((h) => h.role === 'jungle');
        const pick = [jg, ...alive.filter((h) => h !== jg).sort((a, b) => dist2(a, spot) - dist2(b, spot))].filter(Boolean).slice(0, 3);
        for (const h of pick) this.setCallTask(h, { kind: 'ambush', x: spot.x, y: spot.y, until: now + sec(20), call: true });
        break;
      }
      case 'swap': {
        team.swapUntil = now + sec(90);
        for (const h of team.heroes) { if (h.homeLane === 'top') h.lane = 'bot'; else if (h.homeLane === 'bot') h.lane = 'top'; if (h.task.kind === 'lane') h.task = { kind: 'idle' }; }
        break;
      }
      default: return false;
    }
    card.used = true;
    this.emit({ type: 'tactic', team: c.team, card: c.card, lane: c.lane, hero: c.hero });
    return true;
  }

  updateShrines() {
    if (this.time < this.T.shrineUnlock) return;
    const R = this.rules.shrine, step = 5 * DT * (R ? R.speed : 1);
    for (const sh of this.shrines) {
      const n = [0, 0];
      for (const u of this.grid.query(sh.x, sh.y, 120)) if (u.type === 'hero' && u.alive) n[u.team]++;
      const who = n[0] && !n[1] ? 0 : n[1] && !n[0] ? 1 : -1;
      if (who >= 0 && who !== sh.owner) {
        if (sh.capTeam !== who) { sh.capTeam = who; sh.progress = 0; }
        sh.progress += step * (1 + 0.25 * (n[who] - 1));
        if (sh.progress >= T.shrineCapture) {
          const prev = sh.owner; sh.owner = who; sh.progress = 0; sh.capTeam = -1;
          this.addMomentum(who, MOMENTUM.shrine * (R ? R.momentum : 1));
          if (R) for (const h of this.teams[who].heroes) this.giveGold(h, R.gold);
          const sev = { type: 'shrine', team: who, id: sh.id, prev }; this.emit(sev); this.resolveCalls(sev);
          for (const t of this.teams) for (const h of t.heroes) this.recalc(h);
        }
      } else if (who < 0 && !(n[0] && n[1])) { sh.progress = Math.max(0, sh.progress - step); if (!sh.progress) sh.capTeam = -1; }
      // owned shrines mend allies standing on them
      if (sh.owner >= 0) for (const u of this.grid.query(sh.x, sh.y, 120)) if (u.type === 'hero' && u.alive && u.team === sh.owner && this.tick - u.lastCombat > sec(2)) this.heal(u, u.maxHp * 0.02 * 5 * DT, null, true);
    }
  }
  rollDragon() {
    const last = this.dragonQueue[this.dragonQueue.length - 1];
    let d; do { d = DRAGONS[this.rng.int(4)]; } while (d === last);
    this.dragonQueue.push(d); return d;
  }

  // ───────────────────────── setup ─────────────────────────
  addUnit(u) { u.id = this.nextId++; if (u.ph === undefined) u.ph = u.id; u.alive = true; u.buffs = u.buffs || []; u.slows = []; u.burns = []; u.shields = [];
    u.stunUntil = 0; u.rootUntil = 0; u.knockUntil = 0; u.vx = 0; u.vy = 0; u.attackCd = 0; u.target = null; u.lastCombat = -999;
    u.animAttack = -999; u.facing = u.facing || 0; this.units.push(u); return u; }

  setupStructures() {
    for (const s of this.world.structures) {
      const t = s.team, pos = { x: s.x, y: s.y };
      const base = s.kind === 'nexus' ? { hp: 3600, ad: 0, range: 0 } : s.kind === 'inhib' ? { hp: 2000, ad: 0, range: 0 }
        : { hp: [0, 2300, 2500, 2700, 2200][s.tier], ad: 160, range: RANGE.tower };
      base.hp *= this.rules.towerHp;
      this.addUnit({ type: s.kind === 'tower' ? 'tower' : s.kind, team: t, x: pos.x, y: pos.y, tier: s.tier || 0, lane: s.lane,
        maxHp: base.hp, hp: base.hp, radius: s.kind === 'nexus' ? 50 : 34, structure: true,
        stats: { ad: base.ad, ap: 0, armor: 40, mr: 40, as: 0.83, range: base.range, ms: 0, pen: 0 }, streak: 0 });
    }
  }

  setupCamps() {
    for (const c of this.world.camps) {
      const def = CAMP_DEFS[c.kind];
      this.camps.push({ def: { ...def, id: c.id }, side: c.side, x: c.x, y: c.y, mobs: [], respawnAt: sec(T.campFirst), key: `${c.side}:${c.id}`, ph: this.camps.length >> 1 });
    }
  }

  spawnHero(team, spec) {
    const def = HERO_BY_ID[spec.id];
    const f = this.world.fountain[team];
    const lane = this.world.laneNames.length === 1 ? this.world.laneNames[0] : ROLE_LANE[spec.role]; // single-lane maps: everyone lanes together
    const gold0 = this.rules.startGold || GOLD.start;
    const h = this.addUnit({
      type: 'hero', team, def, heroId: def.id, role: spec.role, lane, homeLane: lane,
      build: spec.build || def.rec, items: [], x: f.x + (this.teams[team].heroes.length - 2) * 22 * (team === BLUE ? 1 : -1), y: f.y - (this.teams[team].heroes.length - 2) * 22 * (team === BLUE ? 1 : -1),
      ph: this.teams[team].heroes.length * 7,
      level: this.rules.startLevel, xp: 0, gold: gold0, radius: 14, cds: [0, 0, 0], castLock: 0, dash: null, every3: 0, passiveCd: 0,
      kills: 0, deaths: 0, assists: 0, cs: 0, dmgHeroes: 0, dmgTaken: 0, healed: 0, goldEarned: gold0, streak: 0,
      respawnAt: 0, recallAt: 0, flashCd: 0, task: { kind: 'idle' }, dmgBy: {}, lowShieldCd: 0, smiteCd: 0, wardCd: sec(50), lastHurtByHero: -999,
      fmod: spec.mod ? Math.max(-0.1, Math.min(0.1, +spec.mod || 0)) : 0, // Franchise roster form (src/franchise/roster.js): small stat edge
      stats: null, maxHp: 1, hp: 1, trust: 50, tiltUntil: 0, pendingCall: null, stealthUntil: 0, ambushUntil: 0, revealUntil: 0,
    });
    h.pers = PERSONALITIES[def.pers] || PERSONALITIES.calm;
    this.updateMods(h);
    this.recalc(h); h.hp = h.maxHp;
    this.teams[team].heroes.push(h);
    this.buyItems(h);
    return h;
  }

  // ───────────────────────── personality & trust ─────────────────────────
  updateMods(h) {
    const b = h.pers.mods, m = { ...b };
    if (h.trust >= 70) { m.aggro *= 1.05; m.discipline += 0.1; m.react = Math.max(3, m.react - 1); }
    else if (h.trust <= 30) { m.discipline -= 0.1; m.react += 2; }
    if (h.tiltUntil > this.tick) { m.aggro *= 1.2; m.discipline *= 0.85; m.dodge *= 0.85; }
    h.mods = m;
    h.trustMult = h.trust >= 70 ? 1.04 : h.trust <= 30 ? 0.97 : 1;
  }
  addTrust(h, v, why) {
    const before = h.trust;
    h.trust = Math.max(0, Math.min(100, h.trust + (v > 0 ? v * h.pers.trustGain : v)));
    const tier = (x) => (x >= 70 ? 2 : x <= 30 ? 0 : 1);
    if (tier(before) !== tier(h.trust)) this.emit({ type: 'trust', hero: h.id, team: h.team, tier: tier(h.trust), why });
    this.fx.push({ kind: 'emote', id: h.id, e: v > 0 ? 'up' : 'down' });
    this.updateMods(h);
  }
  // Calls reach heroes after a delay that depends on trust and personality.
  // A hero back from the fountain (respawn / gate) walks to the team's live group call instead of
  // its old lane, so a won fight can turn into a 5-man push.
  rejoinCall(h) {
    const c = this.teams[h.team].call;
    if (c && c.type === 'group' && c.until > this.tick + sec(8)) h.task = { kind: 'group', lane: c.lane, until: c.until, call: true };
  }
  setCallTask(h, task) {
    if (this._callHeroes) this._callHeroes.push(h.id);
    const base = h.trust >= 70 ? 0 : h.trust >= 45 ? 6 : h.trust >= 25 ? 20 : 34;
    const d = Math.round(base * h.pers.delay);
    if (d <= 0) { h.task = task; h.pendingCall = null; this.fx.push({ kind: 'emote', id: h.id, e: 'ok' }); }
    else { h.pendingCall = { task, at: this.tick + d }; this.fx.push({ kind: 'emote', id: h.id, e: h.trust < 30 ? 'doubt' : 'think' }); }
  }

  // ───────────────────────── stats ─────────────────────────
  recalc(h) {
    const b = h.def.base, L = h.level - 1;
    const s = { maxHp: b.hp + b.hpL * L, ad: b.ad + b.adL * L, ap: b.ap || 0, armor: b.armor + b.armorL * L, mr: b.mr + b.mrL * L,
      as: b.as, ms: b.ms, burn: null };
    for (const k of STAT_KEYS) s[k] = 0;
    s.asPct = b.asL * L; s.range = b.range; s.regen = b.regen;
    const add = (st) => {
      for (const k in st) {
        if (k === 'burn') { const v = st.burn; s.burn = s.burn ? { b: s.burn.b + v.b, l: s.burn.l + v.l, hp: (s.burn.hp || 0) + (v.hp || 0), dur: Math.max(s.burn.dur, v.dur) } : { ...v }; }
        else s[k] = (s[k] || 0) + st[k];
      }
    };
    for (const it of h.items) add(it.stats);
    const now = this.tick;
    for (const bf of h.buffs) if (bf.until > now && bf.stats) add(bf.stats);
    const team = this.teams[h.team];
    if (this.clanStats) add(this.clanStats[h.team]);
    const tn = TUNE[h.heroId] || 1; if (tn !== 1) { s.dmgPct += tn - 1; s.hpPct += (tn - 1) * 0.6; }
    if (h.fmod) { s.dmgPct += h.fmod; s.hpPct += h.fmod * 0.6; }
    if (this.shrines) for (const sh of this.shrines) if (sh.owner === h.team) s.dmgPct += this.rules.shrine ? this.rules.shrine.dmg : 0.05;
    s.dmgPct += planEdge(this, h.team); // game plans: countering the enemy's plan
    for (const d of team.dragons) {
      if (d === 'infernal') s.powerMult += 0.05; else if (d === 'ocean') s.regenPct += 0.005; else if (d === 'mountain') s.resPct += 0.06; else if (d === 'cloud') s.msPct += 0.03;
    }
    if (team.soul === 'infernal') s.powerMult += 0.1; else if (team.soul === 'ocean') s.regenPct += 0.01; else if (team.soul === 'mountain') s.resPct += 0.12; else if (team.soul === 'cloud') s.msPct += 0.1;
    if (h.baronUntil > now) s.power += 40;
    if (h.blueBuffUntil > now) { s.haste += 20; s.regen += 6; }
    const p = h.def.passive;
    if (p.kind === 'spellVamp') s.omnivamp += p.pct;
    if (p.kind === 'msOutOfCombat' && now - h.lastCombat > sec(4)) s.msPct += p.pct;
    FX.passiveStats(this, h, s);
    const pw = s.power * (1 + s.powerMult);
    if (h.def.dmgType === 'phys') s.ad = (s.ad + pw) * (1 + s.powerMult * 0.5); else s.ap = (s.ap + pw) * (1 + s.powerMult);
    s.maxHp = (s.maxHp + s.hp) * (1 + s.hpPct);
    s.armor *= 1 + s.resPct; s.mr *= 1 + s.resPct;
    s.as = Math.min(2.5, b.as * (1 + s.asPct));
    s.ms = b.ms * (1 + s.msPct);
    s.cdMult = 100 / (100 + s.haste);
    s.pen = Math.min(0.45, s.pen);
    s.range = Math.min(s.range, HERO_RANGE_CAP); // towers always out-range heroes
    if (h.maxHp > 1 && s.maxHp !== h.maxHp) h.hp = Math.max(1, h.hp + (s.maxHp - h.maxHp));
    h.maxHp = s.maxHp;
    h.stats = s;
    // Cached strength numbers for AI power estimates.
    const abDps = h.def.abilities.reduce((a, ab, i) => a + (ab.dmg && (i < 2 || h.level >= 5) ? this.abilityDamage(h, ab, null) / Math.max(4, ab.cd * s.cdMult) : 0), 0);
    h.dps = s.ad * s.as * (1 + Math.min(1, s.crit) * (0.75 + s.critDmg)) + abDps;
    h.burst = h.def.abilities.reduce((a, ab, i) => a + (ab.dmg && (i < 2 || h.level >= 5) ? this.abilityDamage(h, ab, null) : 0), 0) + s.ad * 2;
  }

  abilityDamage(h, ab, tgt) {
    const d = ab.dmg; if (!d) return 0;
    const L = h.level - 1, s = h.stats;
    let v = (d.b || 0) + (d.l || 0) * L + (d.ad || 0) * s.ad + (d.ap || 0) * s.ap + (d.hp || 0) * h.maxHp;
    if (d.miss && tgt) v += d.miss * (tgt.maxHp - tgt.hp);
    return v;
  }
  scaleVal(h, v) { if (!v) return 0; const L = h.level - 1; return (v.b || 0) + (v.l || 0) * L + (v.ap || 0) * h.stats.ap + (v.ad || 0) * h.stats.ad + (v.hp || 0) * h.maxHp; }

  ehp(u) { const s = u.stats; return u.hp * (1 + ((s.armor || 0) + (s.mr || 0)) / 200) + this.shieldTotal(u); }
  shieldTotal(u) { let a = 0; for (const s of u.shields) if (s.until > this.tick) a += s.amt; return a; }

  // ───────────────────────── items / economy ─────────────────────────
  buyItems(h) {
    const path = BUILDS[h.build].items;
    let bought = false;
    while (true) {
      // next unowned item from current build path
      const next = path.find((it) => !h.items.some((o) => o.name === it.name));
      if (!next || h.items.length >= 6 || h.gold < next.cost) break;
      h.gold -= next.cost; h.items.push(next); bought = true;
      this.emit({ type: 'buy', hero: h.id, team: h.team, item: next.name });
    }
    if (bought) this.recalc(h);
  }
  nextItemCost(h) {
    if (h.items.length >= 6) return Infinity;
    const next = BUILDS[h.build].items.find((it) => !h.items.some((o) => o.name === it.name));
    return next ? next.cost : Infinity;
  }
  giveGold(h, g) { g *= this.rules.gold; h.gold += g; h.goldEarned += g; }
  giveXp(h, x) {
    if (h.level >= XP.maxLevel) return;
    h.xp += x * this.rules.xp;
    while (h.level < XP.maxLevel && h.xp >= xpNeeded(h.level)) {
      h.xp -= xpNeeded(h.level); h.level++;
      this.recalc(h); h.hp = Math.min(h.maxHp, h.hp + h.def.base.hpL * 0.6);
      if (h.level === 5) this.emit({ type: 'ult', hero: h.id, team: h.team });
      this.fx.push({ kind: 'levelup', id: h.id });
    }
  }

  emit(e) { e.t = this.tick; this.events.push(e); }

  // ───────────────────────── commands ─────────────────────────
  applyCommand(c) {
    this._callHeroes = [];
    const team = this.teams[c.team]; if (!team || this.over) return false;
    if (team.coop) { const r = coopGate(this, c); if (r !== undefined) return r; }
    const cost = CMD.cost[c.type] ?? 1;
    if (team.charges + 1e-9 < cost) return false;
    const heroes = team.heroes;
    const alive = heroes.filter((h) => h.alive);
    const jungler = heroes.find((h) => h.role === 'jungle');
    const until = (s) => this.tick + sec(s);
    let ok = true;
    switch (c.type) {
      case 'gank': {
        const h = heroes.find((x) => x.id === c.hero) || jungler;
        if (!h || !h.alive || !this.world.laneNames.includes(c.lane)) { ok = false; break; }
        this.setCallTask(h, { kind: 'gank', lane: c.lane, until: until(T.gankTimeout), call: true });
        break;
      }
      case 'objective': {
        const o = c.obj; if (!['dragon', 'herald', 'baron'].includes(o)) { ok = false; break; }
        if (!this.objAvailable(o)) { ok = false; break; }
        const pit = o === 'dragon' ? this.world.pits.kami : this.world.pits.kraken;
        const pref = o === 'dragon' ? ['jungle', 'bot', 'support', 'mid', 'top'] : o === 'herald' ? ['jungle', 'top', 'mid', 'support', 'bot'] : ['jungle', 'mid', 'top', 'support', 'bot'];
        const n = o === 'baron' ? 5 : 4;
        const pick = alive.slice().sort((a, b) => (pref.indexOf(a.role) - pref.indexOf(b.role)) || (dist2(a, pit) - dist2(b, pit))).slice(0, n);
        for (const h of pick) if (!(h.task.kind === 'split' && h.task.call)) this.setCallTask(h, { kind: 'objective', obj: o, until: until(T.objectiveTimeout), call: true });
        team.call = { type: 'objective', obj: o, until: until(T.objectiveTimeout) };
        break;
      }
      case 'shrine': {
        const target = this.shrines.filter((x) => x.owner !== c.team).sort((a, b) => (c.shrine === a.id ? -1 : 0) - (c.shrine === b.id ? -1 : 0) || dist2(a, this.world.fountain[c.team]) - dist2(b, this.world.fountain[c.team]))[0];
        if (!target || this.time < this.T.shrineUnlock) { ok = false; break; }
        const pick = alive.slice().sort((a, b) => (a.role === 'jungle' ? -1 : 0) - (b.role === 'jungle' ? -1 : 0) || dist2(a, target) - dist2(b, target)).slice(0, 2);
        for (const h of pick) this.setCallTask(h, { kind: 'shrine', shrine: target.id, until: until(25), call: true });
        break;
      }
      case 'group': {
        if (!this.world.laneNames.includes(c.lane)) { ok = false; break; }
        for (const h of alive) if (!(h.task.kind === 'split' && h.task.call)) this.setCallTask(h, { kind: 'group', lane: c.lane, until: until(T.groupTimeout), call: true });
        team.call = { type: 'group', lane: c.lane, until: until(T.groupTimeout) };
        break;
      }
      case 'split': {
        const h = heroes.find((x) => x.id === c.hero);
        if (!h || !this.world.laneNames.includes(c.lane)) { ok = false; break; }
        this.setCallTask(h, { kind: 'split', lane: c.lane, until: until(90), call: true });
        break;
      }
      case 'focus': {
        const tgt = this.units.find((u) => u.id === c.target && u.type === 'hero' && u.team !== c.team);
        if (!tgt) { ok = false; break; }
        team.focus = { id: tgt.id, until: until(20) };
        break;
      }
      case 'safe':
        for (const h of alive) this.setCallTask(h, { kind: 'safe', until: until(T.safeTimeout), call: true });
        team.call = { type: 'safe', until: until(T.safeTimeout) };
        break;
      case 'reset':
        for (const h of alive) this.setCallTask(h, { kind: 'recall', call: true });
        break;
      case 'invade': {
        const enemyCamps = this.camps.filter((cp) => cp.side !== c.team && cp.mobs.length > 0);
        if (!jungler || !jungler.alive || !enemyCamps.length) { ok = false; break; }
        const camp = enemyCamps.sort((a, b) => dist2(a, jungler) - dist2(b, jungler))[0];
        const buddy = alive.filter((h) => h.role === 'support' || h.role === 'mid').sort((a, b) => dist2(a, camp) - dist2(b, camp))[0];
        for (const h of [jungler, buddy]) if (h) this.setCallTask(h, { kind: 'invade', camp: camp.key, until: until(30), call: true });
        break;
      }
      case 'herald': {
        if (team.heraldEye <= this.tick || !this.world.laneNames.includes(c.lane)) { ok = false; break; }
        team.heraldEye = 0;
        this.spawnSummon(c.team, c.lane);
        break;
      }
      case 'build': {
        const h = heroes.find((x) => x.id === c.hero);
        if (!h || !BUILDS[c.build] || !h.def.builds.includes(c.build)) { ok = false; break; }
        h.build = c.build; this.emit({ type: 'pivot', hero: h.id, team: h.team, build: c.build });
        break;
      }
      case 'tactic': ok = this.playTactic(c); break;
      case 'moment': ok = applyMoment(this, c); break;
      case 'ult': {
        // Ult calls: 'save' holds ultimates for a kill or self-defence; 'go' fires them in the next fight.
        if (c.mode !== 'save' && c.mode !== 'go' && c.mode !== 'free') { ok = false; break; }
        team.ultMode = c.mode === 'free' ? null : { mode: c.mode, until: this.tick + sec(c.mode === 'go' ? 20 : 45) };
        for (const h of alive) this.fx.push({ kind: 'emote', id: h.id, e: c.mode === 'go' ? 'up' : 'ok' });
        break;
      }
      case 'plan': { // halftime only (the halftime window); the last pick in the window stands
        if (!planChangeOk(this, team, c.plan) || c.plan === team.plan) { ok = false; break; }
        if (!team.planFrom) team.planFrom = team.plan;
        team.plan = c.plan; team.planAt = this.tick; this.emit({ type: 'plan', team: c.team, plan: c.plan, from: team.planFrom });
        break;
      }
      case 'redraw': {
        // Halftime only: swap one unused tactic card for another not in the deck.
        const ht = this.halftimeTick, now = this.tick;
        if (ht < 0 || now < ht || now > ht + sec(HALFTIME.window) || team.redrawn || !TACTICS[c.to] || team.deck.some((d) => d.id === c.to)) { ok = false; break; }
        const d = team.deck.find((x) => x.id === c.card && !x.used); if (!d) { ok = false; break; }
        d.id = c.to; team.redrawn = true; break;
      }
      case 'permit': {
        // A hero asked for the green light (UI request) and the coach said yes: a short, aggressive solo task.
        const h = heroes.find((x) => x.id === c.hero);
        if (!h || !h.alive || team.permitCd > this.tick || (c.kind !== 'fight' && c.kind !== 'split')) { ok = false; break; }
        if (c.kind === 'fight') {
          const tgt = this.units.find((u) => u.id === c.target && u.type === 'hero' && u.team !== c.team);
          if (!tgt || !tgt.alive || !this.vision[c.team].has(tgt.id) || dist2(tgt, h) > PERMIT.range * PERMIT.range) { ok = false; break; }
          h.task = { kind: 'permit', target: tgt.id, until: until(PERMIT.fight), call: true }; h.pendingCall = null;
        } else {
          if (!this.world.laneNames.includes(c.lane)) { ok = false; break; }
          h.task = { kind: 'split', lane: c.lane, until: until(PERMIT.split), call: true }; h.pendingCall = null;
        }
        this._callHeroes.push(h.id);
        this.fx.push({ kind: 'emote', id: h.id, e: 'up' });
        team.permitCd = until(PERMIT.cooldown);
        break;
      }
      case 'surge': {
        // Kami Surge: spend a full momentum meter for a short team-wide power spike.
        if (team.momentum < MOMENTUM.max || team.surgeUntil > this.tick || !alive.length) { ok = false; break; }
        team.momentum = 0; team.surgeUntil = until(MOMENTUM.surgeSec);
        for (const h of alive) { this.addBuff(h, { dmgPct: MOMENTUM.dmg, msPct: MOMENTUM.ms }, MOMENTUM.surgeSec, 'surge'); this.fx.push({ kind: 'fx', name: 'boost', x: h.x, y: h.y, s: 1.4, follow: h.id }); }
        this.emit({ type: 'surge', team: c.team });
        break;
      }
      case 'cancel':
        for (const h of alive) { if (h.task.call) h.task = { kind: 'idle' }; h.pendingCall = null; }
        team.call = null; team.focus = null;
        break;
      default: ok = false;
    }
    if (ok) {
      team.charges -= cost;
      const entry = { t: this.tick, team: c.team, seat: c.seat, type: c.type, lane: c.lane, obj: c.obj, hero: c.hero, target: c.target, build: c.build, card: c.card, mode: c.mode, plan: c.plan, kind: c.kind, result: null, heroes: this._callHeroes.slice() };
      if (c.type === 'tactic') { entry.result = 'played'; entry.trusted = true; }
      if (['gank', 'objective', 'invade', 'group', 'shrine', 'tactic', 'permit'].includes(c.type)) {
        entry.i = this.callLog.length;
        entry.d0 = entry.heroes.reduce((a, id) => a + this.byId(id).deaths, 0);
        this.callLog.push(entry);
      }
      this.emit({ type: 'call', team: c.team, call: entry });
    }
    return ok;
  }

  resolveCalls(ev) {
    for (const c of this.callLog) {
      if (c.result) continue;
      const life = c.type === 'objective' ? T.objectiveTimeout : c.type === 'group' ? T.groupTimeout + 10 : c.type === 'invade' ? 34 : c.type === 'shrine' ? 40
        : c.type === 'permit' ? (c.kind === 'split' ? PERMIT.split : PERMIT.fight) + 2 : T.gankTimeout + 4;
      if (this.tick - c.t > sec(life)) c.result = 'expired';
      if (!c.result && ev.type === 'kill') {
        const v = this.byId(ev.victim);
        if (c.type === 'gank' && v && ev.killerTeam === c.team && this.laneOf(v) === c.lane) c.result = 'success';
        else if (c.type === 'gank' && v && v.team === c.team && this.laneOf(v) === c.lane) { c.result = 'traded'; c.lost = v.id; }
        else if (c.type === 'permit' && c.kind === 'fight' && ev.victim === c.target && ev.killerTeam === c.team) c.result = 'success';
        else if (c.type === 'permit' && ev.victim === c.hero) { c.result = 'traded'; c.lost = c.hero; }
      }
      if (!c.result && ev.type === 'objective' && c.type === 'objective' && ev.obj === c.obj) c.result = ev.team === c.team ? 'success' : 'stolen';
      if (!c.result && ev.type === 'shrine' && c.type === 'shrine' && ev.team === c.team) c.result = 'success';
      if (!c.result && ev.type === 'stolenCamp' && c.type === 'invade' && ev.team === c.team) c.result = 'success';
      if (!c.result && (ev.type === 'tower' || ev.type === 'inhib') && (c.type === 'group' || (c.type === 'permit' && c.kind === 'split')) && ev.lane === c.lane) c.result = ev.team === c.team ? 'success' : 'traded';
      if (!c.result && ev.type === 'kill' && c.type === 'group' && ev.killerTeam === c.team) { const v = this.byId(ev.victim); if (v && this.laneOf(v) === c.lane) c.result = 'success'; }
      if (c.result && !c.trusted) {
        c.trusted = true;
        const ok = c.result === 'success';
        // A hero who asked for (and got) the green light cares more about how it went.
        const delta = c.type === 'permit' ? (ok ? 10 : c.result === 'expired' ? -1 : -3) : ok ? 8 : c.result === 'expired' ? -2 : -6;
        for (const id of c.heroes || []) { const x = this.byId(id); if (x) this.addTrust(x, delta, c.result); }
        if (!ok) c.why = this.callFailReason(c);
        if (ok) this.addMomentum(c.team, MOMENTUM.call);
        this.emit({ type: 'callResult', team: c.team, i: c.i, call: c.type, result: c.result, why: c.why || null, delta, hero: c.hero || (c.heroes && c.heroes[0]) || 0 });
      }
    }
  }
  // Why a call did not pay off (a short code; the HUD turns it into words). Read-only.
  callFailReason(c) {
    const died = (c.heroes || []).reduce((a, id) => a + this.byId(id).deaths, 0) > (c.d0 || 0);
    const enemies = this.teams[1 - c.team].heroes;
    if (c.result === 'stolen') return 'stolen';
    if (c.result === 'traded') return c.type === 'group' || c.type === 'permit' && c.kind === 'split' ? 'lostTower' : c.lost === c.hero && c.type === 'permit' ? 'died' : 'lostHero';
    if (c.type === 'gank') {
      const g = this.byId(c.heroes && c.heroes[0]);
      if (died || (g && !g.alive)) return 'gankerDied';
      const inLane = enemies.filter((e) => e.alive && this.world.distToLane(c.lane, e) < 400);
      if (inLane.some((e) => e.flashCd > c.t + sec(100))) return 'flashed';
      for (let k = this.events.length - 1; k >= 0 && this.events[k].t >= c.t; k--) {
        const e = this.events[k]; if (e.type === 'recalled' && e.team !== c.team) { const x = this.byId(e.hero); if (x && x.homeLane === c.lane) return 'recalled'; }
      }
      return inLane.length ? 'escaped' : 'empty';
    }
    if (c.type === 'permit') { const t = this.byId(c.target); return t && t.flashCd > c.t + sec(100) ? 'flashed' : 'escaped'; }
    if (died) return 'pickedOff';
    if (c.type === 'objective') { const o = this.objectives[c.obj]; return o && o.alive && o.hp < o.maxHp ? 'slow' : 'notStarted'; }
    if (c.type === 'shrine') return 'contested';
    if (c.type === 'group') return 'noTower';
    return 'fizzled';
  }
  addMomentum(team, v) {
    const t = this.teams[team]; if (!t || t.surgeUntil > this.tick) return;
    const before = t.momentum; t.momentum = Math.min(MOMENTUM.max, t.momentum + v);
    if (before < MOMENTUM.max && t.momentum >= MOMENTUM.max) this.emit({ type: 'momentumFull', team });
  }
  laneOf(u) { return this.world.closestLane(u); }
  // An objective can be called if it is up or wakes within 25s.
  objAvailable(o) {
    const u = this.objectives[o]; if (u && u.alive) return true;
    const t = this.objTimers[o]; return !!t && t - this.tick <= sec(25) && (o !== 'herald' || this.time < this.T.heraldDespawn);
  }

  byId(id) { for (const u of this.units) if (u.id === id) return u; return null; }

  // ───────────────────────── main step ─────────────────────────
  step(commands = []) {
    if (this.over) return;
    const now = this.tick;
    // Commands are applied in a canonical order so both peers agree.
    const cmds = commands.slice().sort((a, b) => a.team - b.team || (a.seat || 0) - (b.seat || 0) || (a.seq || 0) - (b.seq || 0)); // seat: co-op coaches
    for (const c of cmds) this.applyCommand(c);
    // Fairness: units act in list order and damage lands immediately, so who goes first is a per-tick
    // coin (a hash of the tick: no RNG draw, no fixed period that unit cooldowns could lock onto).
    // (Plain even/odd alternation aliased with the all-even minion attack periods: one side's whole
    // wave struck first in every clash of a lane.)
    const rev = tickCoin(now);
    for (let k = 0; k < 2; k++) { const t = rev ? 1 - k : k; if (this.coaches[t]) this.coaches[t].update(); }

    for (const tm of this.teams) {
      if (tm.swapUntil && now >= tm.swapUntil) { tm.swapUntil = 0; for (const h of tm.heroes) { h.lane = h.homeLane; if (h.task.kind === 'lane') h.task = { kind: 'idle' }; } }
      tm.charges = Math.min(CMD.maxCharges, tm.charges + DT / CMD.regen);
      if (tm.focus && tm.focus.until <= now) tm.focus = null;
      if (tm.call && tm.call.until <= now) tm.call = null;
      if (tm.ultMode && tm.ultMode.until <= now) tm.ultMode = null;
    }

    this.updateWeather();
    if (now === sec(this.rules.final.at)) this.emit({ type: 'finalPhase' });
    if (now === sec(this.rules.pace.wrathFrom)) this.emit({ type: 'wrath' });
    if (now === this.halftimeTick) this.emit({ type: 'halftime' });
    if (now % 5 === 0) this.updateShrines();
    this.spawnWaves();
    this.updateCamps();
    this.updateObjectivesSpawn();

    // rebuild grid
    this.grid.clear();
    for (const u of this.units) if (u.alive) this.grid.add(u);
    if (now % 4 === 0) this.updateVision();

    if (now % 10 === 5) { laneBrain(this, 0); laneBrain(this, 1); }
    const U = this.units, n = U.length;
    for (let k = 0; k < n; k++) { const u = U[rev ? n - 1 - k : k]; if (u.type === 'hero') this.updateHero(u); }
    for (let k = 0; k < n; k++) {
      const u = U[rev ? n - 1 - k : k];
      if (!u || !u.alive) continue;
      if (u.type === 'minion' || u.type === 'summon') this.updateMinion(u);
      else if (u.type === 'tower') this.updateTower(u);
      else if (u.type === 'mob' || u.type === 'objective') this.updateMob(u);
      else if (u.type === 'inhib' && u.respawnAt && now >= u.respawnAt) { /* handled in die */ }
    }
    for (const u of this.units) if (u.type === 'inhib' && !u.alive && u.respawnAt && now >= u.respawnAt) {
      u.alive = true; u.hp = u.maxHp; u.respawnAt = 0; this.emit({ type: 'inhibRespawn', team: u.team, lane: u.lane });
    }
    this.updateStatus();
    this.updateProjectiles();
    this.updatePending();
    this.separate(rev);
    this.fountain();

    if (!this.over && this.time >= this.rules.seconds) this.timeUp();
    // cleanup
    if (now % 20 === 0) {
      if (this.callLog.length) this.resolveCalls({ type: 'tick' });
      this.units = this.units.filter((u) => u.alive || u.type === 'hero' || u.structure);
      this.wards = this.wards.filter((w) => w.until > now);
      if (now % 200 === 0) for (const t of this.teams) t.goldHistory.push(t.heroes.reduce((a, h) => a + h.goldEarned, 0));
    }
    this.tick++;
  }

  // ───────────────────────── waves ─────────────────────────
  spawnWaves() {
    if (this.tick < this.nextWave) return;
    this.nextWave += sec(this.T.waveEvery);
    this.waveCount++;
    const minute = this.gameMinute;
    for (let t = 0; t < 2; t++) for (const ln of this.world.laneNames) {
      const kinds = ['melee', 'melee', 'melee', 'caster', 'caster', 'caster'];
      if (this.waveCount % this.T.siegeEvery === 0 || this.time >= this.rules.pace.siegeAllFrom) kinds.splice(3, 0, 'siege');
      if (this.time >= this.rules.pace.wrathFrom) kinds.unshift('super');
      const enemyInhibDown = this.units.some((u) => u.type === 'inhib' && u.team !== t && u.lane === ln && !u.alive);
      if (enemyInhibDown) kinds.unshift('super', 'super');
      let baron = this.teams[t].heroes.some((h) => h.alive && h.baronUntil > this.tick);
      if (this.teams[t].siegeWaves[ln] > 0) { this.teams[t].siegeWaves[ln]--; baron = true; }
      const allOut = this.teams[t].allOut > 0; // Coach Moment: All-Out Push
      if (allOut) kinds.unshift('super');
      kinds.forEach((k, i) => this.spawnMinion(t, ln, k, i, minute, baron, allOut));
    }
    for (const tm of this.teams) if (tm.allOut > 0) tm.allOut--;
  }
  spawnMinion(team, lane, kind, i, minute, baron, allOut) {
    const pts = this.world.lanes[lane];
    const start = team === BLUE ? pts[0] : pts[pts.length - 1];
    const nextIdx = team === BLUE ? 1 : pts.length - 2;
    const d = norm(pts[nextIdx].x - start.x, pts[nextIdx].y - start.y);
    const back = i * 26;
    const S = { melee: { hp: 480, ad: 14, range: 46, as: 1.0, armor: 0, mr: 0 }, caster: { hp: 300, ad: 24, range: 165, as: 0.67, armor: 0, mr: 0 },
      siege: { hp: 900, ad: 42, range: 210, as: 0.5, armor: 25, mr: 0 }, super: { hp: 1600, ad: 120, range: 60, as: 0.85, armor: 40, mr: 0 } }[kind];
    const growth = 1 + minute * 0.055;
    const bm = (baron ? 1.5 : 1) * (allOut ? 1.6 : 1);
    const hp = S.hp * growth * bm;
    // ph: mirrored minions (same lane, same slot) share a timing phase, so neither side re-targets / re-paths first
    this.addUnit({ type: 'minion', kind, team, lane, ph: this.world.laneNames.indexOf(lane) * 16 + i, x: start.x + d.x * (60 - back) + (i % 2 ? 6 : -6) * (team === BLUE ? 1 : -1), y: start.y + d.y * (60 - back), wp: nextIdx,
      maxHp: hp, hp, radius: kind === 'siege' || kind === 'super' ? 12 : 9, empowered: baron || allOut, allOut: !!allOut,
      stats: { ad: S.ad * growth * bm, ap: 0, armor: S.armor * (baron ? 1.5 : 1), mr: S.mr, as: S.as, range: S.range, ms: allOut ? 84 : 72, pen: 0 } });
  }
  spawnSummon(team, lane) {
    // Herald charges down the lane from the team's furthest allied presence.
    const pts = this.world.lanes[lane];
    let prog = team === BLUE ? 0.15 : 0.85;
    for (const u of this.units) if (u.alive && u.team === team && (u.type === 'minion' || (u.type === 'tower' && u.lane === lane)) && (u.lane === lane)) {
      const pr = this.world.laneProgress(lane, u); if (team === BLUE ? pr > prog : pr < prog) prog = pr;
    }
    prog = team === BLUE ? Math.min(prog, 0.8) : Math.max(prog, 0.2);
    const tot = this.lanePointAt(lane, prog);
    let wp = 0, bd = Infinity;
    for (let i = 0; i < pts.length; i++) { const dd = dist2(pts[i], tot); if (dd < bd) { bd = dd; wp = i; } }
    wp = team === BLUE ? Math.min(pts.length - 1, wp + 1) : Math.max(0, wp - 1);
    const u = this.addUnit({ type: 'summon', kind: 'herald', team, lane, x: tot.x, y: tot.y, wp, maxHp: 3500, hp: 3500, radius: 22, charge: true,
      stats: { ad: 120, ap: 0, armor: 40, mr: 40, as: 0.6, range: 70, ms: 85, pen: 0 } });
    this.emit({ type: 'heraldDrop', team, lane, id: u.id });
  }
  lanePointAt(lane, prog) { return this.world.lanePoint(lane, prog); }


  // ───────────────────────── jungle ─────────────────────────
  updateCamps() {
    const minute = this.gameMinute;
    for (const c of this.camps) {
      if (c.mobs.length) { c.mobs = c.mobs.filter((m) => m.alive); if (!c.mobs.length) c.respawnAt = this.tick + sec(c.def.buff ? T.buffRespawn : T.campRespawn); continue; }
      if (this.tick >= c.respawnAt && c.respawnAt > 0) {
        c.respawnAt = 0;
        const g = 1 + minute * 0.07;
        for (const [k, m] of c.def.mobs.entries()) {
          const dx = (m.dx || 0) * (c.side ? -1 : 1), dy = (m.dy || 0) * (c.side ? -1 : 1);
          const mob = this.addUnit({ type: 'mob', kind: m.k, camp: c.key, team: NEUTRAL, ph: c.ph * 8 + k, x: c.x + dx, y: c.y + dy, home: { x: c.x + dx, y: c.y + dy },
            maxHp: m.hp * g, hp: m.hp * g, radius: m.big ? 16 : 10, big: !!m.big, buff: m.big ? c.def.buff : null,
            gold: m.big ? (c.def.buff ? 110 : 70) : 22, xpv: m.big ? (c.def.buff ? 170 : 110) : 30,
            stats: { ad: m.ad * g * 0.6, ap: 0, armor: 12, mr: 12, as: 0.8, range: 50, ms: 90, pen: 0 } });
          c.mobs.push(mob);
        }
      }
    }
  }

  updateObjectivesSpawn() {
    const now = this.tick, minute = this.gameMinute;
    const ob = this.objectives;
    if (!ob.dragon && this.objTimers.dragon && now >= this.objTimers.dragon) {
      const elder = this.teams.some((t) => t.soul);
      const el = elder ? 'elder' : this.nextDragon;
      const hp = ((elder ? 6500 : 3200) + minute * 120) * this.rules.kamiPower;
      ob.dragon = this.addUnit({ type: 'objective', kind: 'dragon', element: el, team: NEUTRAL, x: this.world.pits.kami.x, y: this.world.pits.kami.y, home: { ...this.world.pits.kami },
        maxHp: hp, hp, radius: 30, big: true, boss: true, stats: { ad: ((elder ? 150 : 55) + minute * 5) * this.rules.kamiPower, ap: 0, armor: 40, mr: 40, as: 0.7, range: 220, ms: 80, pen: 0 } });
      this.objTimers.dragon = 0;
      this.emit({ type: 'spawn', obj: 'dragon', element: el });
    }
    if (!ob.herald && this.objTimers.herald && now >= this.objTimers.herald && !ob.baron) {
      if (this.time < this.T.heraldDespawn - 20) {
        const hp = 5000 + minute * 100;
        ob.herald = this.addUnit({ type: 'objective', kind: 'herald', team: NEUTRAL, x: this.world.pits.kraken.x, y: this.world.pits.kraken.y, home: { ...this.world.pits.kraken },
          maxHp: hp, hp, radius: 26, big: true, boss: true, stats: { ad: 80, ap: 0, armor: 50, mr: 50, as: 0.6, range: 90, ms: 80, pen: 0 } });
        this.emit({ type: 'spawn', obj: 'herald' });
      }
      this.objTimers.herald = 0;
    }
    if (ob.herald && ob.herald.alive && this.time >= this.T.heraldDespawn) { ob.herald.alive = false; ob.herald = null; this.emit({ type: 'despawn', obj: 'herald' }); }
    if (!ob.baron && this.objTimers.baron && now >= this.objTimers.baron && !(ob.herald && ob.herald.alive)) {
      const hp = 9000 + Math.max(0, minute - 9) * 220;
      ob.baron = this.addUnit({ type: 'objective', kind: 'baron', team: NEUTRAL, x: this.world.pits.kraken.x, y: this.world.pits.kraken.y, home: { ...this.world.pits.kraken },
        maxHp: hp, hp, radius: 34, big: true, boss: true, slam: 0, stats: { ad: 170 + minute * 6, ap: 0, armor: 70, mr: 70, as: 0.75, range: 230, ms: 0, pen: 0 } });
      this.objTimers.baron = 0;
      this.emit({ type: 'spawn', obj: 'baron' });
    }
  }

  // ───────────────────────── vision ─────────────────────────
  updateVision() {
    const W = this.world;
    for (let t = 0; t < 2; t++) {
      const src = [];
      for (const u of this.units) {
        if (!u.alive || u.team !== t) continue;
        const r = u.type === 'hero' ? VISION.hero : u.type === 'minion' ? VISION.minion : u.type === 'summon' ? VISION.summon : u.structure ? VISION.tower : 0;
        if (r) src.push({ x: u.x, y: u.y, r: u.structure ? r : r * this.wx.vision * (1 + ((u.stats && u.stats.sight) || 0)) * this.rules.vision });
      }
      for (const w of this.wards) if (w.team === t && w.until > this.tick) src.push({ x: w.x, y: w.y, r: VISION.ward * this.rules.vision });
      for (const sh of this.shrines) if (sh.owner === t) src.push({ x: sh.x, y: sh.y, r: VISION.shrine });
      src.push({ x: W.fountain[t].x, y: W.fountain[t].y, r: VISION.fountain });
      const grid = W.computeVision(src, this.visGrid[t]);
      const vis = new Set();
      for (const u of this.units) {
        if (!u.alive || u.team === t) continue;
        if (u.revealUntil > this.tick) { vis.add(u.id); continue; }
        if (!grid[W.idx(u.x, u.y)]) continue;
        if (u.stealthUntil > this.tick && !this.grid.query(u.x, u.y, 150).some((e) => e.alive && e.team === t && !e.structure)) continue;
        vis.add(u.id);
      }
      this.vision[t] = vis;
      const ls = this.lastSeen[t];
      for (const h of this.teams[1 - t].heroes) if (h.alive && vis.has(h.id)) ls[h.id] = { x: h.x, y: h.y, t: this.tick };
    }
  }
  canSee(team, u) { return u.team === team || u.structure || this.vision[team].has(u.id); }

  // ───────────────────────── combat core ─────────────────────────
  isTargetable(u) {
    if (!u.alive) return false;
    if (u.type === 'tower') {
      if (u.tier <= 1) return true;
      if (u.tier <= 3) return !this.units.some((o) => o.type === 'tower' && o.team === u.team && o.lane === u.lane && o.tier === u.tier - 1 && o.alive);
      return this.units.some((o) => o.type === 'inhib' && o.team === u.team && !o.alive);
    }
    if (u.type === 'inhib') return !this.units.some((o) => o.type === 'tower' && o.team === u.team && o.lane === u.lane && o.tier === 3 && o.alive);
    if (u.type === 'nexus') return !this.units.some((o) => o.type === 'tower' && o.team === u.team && o.tier === 4 && o.alive);
    return true;
  }

  dealDamage(src, tgt, raw, type, flags = {}) {
    if (!tgt.alive || raw <= 0) return 0;
    if (tgt.type === 'nexus' || tgt.type === 'inhib' || tgt.type === 'tower') { if (!this.isTargetable(tgt)) return 0; }
    if (FX.tryParry(this, src, tgt, flags)) return 0;
    let amt = raw;
    const ss = src && src.stats;
    if (src && src.type === 'hero') {
      const lowHp = tgt.hp / tgt.maxHp < 0.35;
      if (lowHp && src.def.passive.kind === 'executer') amt *= 1 + src.def.passive.pct;
      if (lowHp && ss.execute) amt *= 1 + ss.execute;
      if (tgt.structure && src.def.passive.kind === 'siege') amt *= 1 + src.def.passive.pct;
      if (ss.dmgPct) amt *= 1 + ss.dmgPct;
      amt *= src.trustMult || 1;
      amt = FX.heroDamageMods(this, src, tgt, amt, flags);
      if (ss.waveClear && (tgt.type === 'minion' || tgt.type === 'mob')) amt *= 1 + ss.waveClear;
      if (!flags.dot && (src.stealthUntil > this.tick || src.ambushUntil > this.tick)) { amt *= 1.25; if (src.stealthUntil > this.tick) { src.stealthUntil = 0; src.ambushUntil = this.tick + sec(3); } }
      const st = this.teams[src.team];
      if (tgt.structure && st.siegeUntil > this.tick) amt *= 1.25;
      if ((tgt.type === 'objective') && st.pactUntil > this.tick) amt *= 1.3;
      if (tgt.structure && ss.siegePct) amt *= 1 + ss.siegePct;
      if ((tgt.type === 'mob' || tgt.type === 'objective') && src.role === 'jungle') amt *= 1.6;
      if (tgt.structure && !flags.summon) {
        // Backdoor protection: heroes deal reduced damage without minion cover.
        const cover = this.grid.query(tgt.x, tgt.y, 450).some((u) => (u.type === 'minion' || u.type === 'summon') && u.team === src.team && u.alive);
        if (!cover && this.time < this.rules.pace.backdoorOffFrom) amt *= 0.5;
      }
    }
    if (tgt.structure) amt *= this.siegeRamp * (src && src.type === 'minion' ? this.rules.minionSiege : 1);
    if (tgt.structure && tgt.team < 2 && this.teams[tgt.team].fortifyUntil > this.tick) amt *= 0.6;
    if (type !== 'true') {
      const res = type === 'phys' ? (tgt.stats.armor || 0) : (tgt.stats.mr || 0);
      const eff = res * (1 - FX.shredOf(this, tgt)) * (1 - ((ss && ss.pen) || 0));
      amt *= eff >= 0 ? 100 / (100 + eff) : 2 - 100 / (100 - eff);
    }
    if (tgt.type === 'hero') {
      if (tgt.def.passive.kind === 'dr') amt *= 1 - tgt.def.passive.pct;
      if (tgt.stats.drPct) amt *= FX.drMult(tgt);
      if (src && src.type === 'minion') amt *= 0.5;
      if (src && src.type === 'hero') amt *= HERO_VS_HERO;
    }
    // shields
    let left = amt;
    for (const s of tgt.shields) { if (s.until <= this.tick || left <= 0) continue; const a = Math.min(s.amt, left); s.amt -= a; left -= a; }
    tgt.shields = tgt.shields.filter((s) => s.amt > 0.5 && s.until > this.tick);
    tgt.hp -= left;
    tgt.lastCombat = this.tick;
    if (src && src.team !== tgt.team) tgt.lastHurt = this.tick;
    if ((tgt.type === 'mob' || tgt.type === 'objective') && src && src.type !== 'tower' && src.team !== NEUTRAL && (!tgt.target || !tgt.target.alive)) tgt.target = src;
    if (src) { src.lastCombat = this.tick; if (src.type === 'hero' && tgt.type === 'hero') src.revealUntil = this.tick + 20; }
    if (tgt.type === 'hero') {
      tgt.dmgTaken += amt;
      if (tgt.recallAt) { tgt.recallAt = 0; }
      if (src && src.type === 'hero') {
        tgt.dmgBy[src.id] = this.tick; tgt.lastHurtByHero = this.tick; src.dmgHeroes += amt; src.lastHitHero = this.tick;
        // passive shield
        const p = tgt.def.passive;
        if (p.kind === 'shieldOnHit' && this.tick >= tgt.passiveCd) { this.addShield(tgt, tgt.maxHp * p.pct, 3); tgt.passiveCd = this.tick + sec(p.cd); }
        if (src.team !== tgt.team) FX.onHeroHurt(this, src, tgt);
      } else if (src) tgt.lastHurtBy = this.tick;
      if (tgt.hp > 0 && tgt.hp / tgt.maxHp < 0.3 && tgt.stats.lowHpShield && this.tick >= tgt.lowShieldCd) {
        this.addShield(tgt, tgt.maxHp * tgt.stats.lowHpShield, 3); tgt.lowShieldCd = this.tick + sec(60); this.fx.push({ kind: 'shield', id: tgt.id });
      }
    }
    if (src && src.type === 'hero' && !tgt.structure) {
      const vamp = ss.omnivamp || 0;
      if (vamp > 0) this.heal(src, amt * vamp * (flags.aoe ? 0.4 : 1), null, true);
      if (flags.basic && tgt.type === 'hero' && tgt.stats.thorns) this.dealDamage(tgt, src, amt * tgt.stats.thorns + 10, 'magic', { thorns: true });
    }
    if (flags.basic || flags.ability) this.fx.push({ kind: 'dmg', id: tgt.id, v: Math.round(amt), crit: flags.crit, t: type, hero: src && src.type === 'hero' && tgt.type === 'hero' });
    if (tgt.hp <= 0) this.kill(tgt, src);
    return amt;
  }

  heal(u, amt, src, silent) {
    if (!u.alive || amt <= 0) return;
    let a = amt;
    if (src && src.stats) a *= 1 + (src.stats.healPower || 0);
    if (u.type === 'hero') a *= 1 + (u.stats.healPower && src === u ? 0 : 0);
    if (u.grievousUntil > this.tick) a *= 0.6;
    const before = u.hp; u.hp = Math.min(u.maxHp, u.hp + a);
    if (src && src.type === 'hero' && src !== u) src.healed += u.hp - before;
    if (!silent && u.hp - before > 5) this.fx.push({ kind: 'heal', id: u.id, v: Math.round(u.hp - before) });
  }
  addShield(u, amt, dur, src) {
    let a = amt; if (src && src.stats) a *= 1 + (src.stats.healPower || 0);
    u.shields.push({ amt: a, until: this.tick + sec(dur) });
  }
  addBuff(u, stats, dur, key) {
    if (key) u.buffs = u.buffs.filter((b) => b.key !== key);
    u.buffs.push({ stats, until: this.tick + sec(dur), key });
    if (u.type === 'hero') this.recalc(u);
  }
  applyCC(u, cc, src) {
    if (!cc || !u.alive || u.structure || u.boss) return;
    const now = this.tick, ten = FX.tenacity(u);
    if (cc.stun) { u.stunUntil = Math.max(u.stunUntil, now + sec(cc.stun * ten)); }
    if (cc.knock) { u.stunUntil = Math.max(u.stunUntil, now + sec(cc.knock)); u.knockUntil = now + sec(cc.knock); }
    if (cc.root) u.rootUntil = Math.max(u.rootUntil, now + sec(cc.root * ten));
    if (cc.slow) u.slows.push({ pct: cc.slow[0], until: now + sec(cc.slow[1] * ten) });
    FX.applyExtraCC(this, u, cc, src, ten);
    if ((cc.stun || cc.knock) && u.type === 'hero') { u.recallAt = 0; if (u.dash && !u.dash.pulled) u.dash = null; }
    if (cc.stun || cc.root || cc.knock) this.fx.push({ kind: 'cc', id: u.id, cc: cc.knock ? 'knock' : cc.stun ? 'stun' : 'root' });
  }
  addBurn(u, src, dps, dur, key) {
    if (!u.alive || dps <= 0) return;
    dps *= this.wx.burn;
    const k = key + ':' + (src ? src.id : 0);
    const ex = u.burns.find((b) => b.key === k);
    if (ex) { ex.dps = Math.max(ex.dps, dps); ex.until = this.tick + sec(dur); }
    else u.burns.push({ key: k, src, dps, until: this.tick + sec(dur) });
    if (src && src.stats && src.stats.antiheal) u.grievousUntil = this.tick + sec(3);
  }
  itemBurn(src, tgt, mult = 1) {
    const b = src.stats.burn; if (!b) return;
    const dps = ((b.b || 0) + (b.l || 0) * (src.level - 1) + (b.hp || 0) * tgt.maxHp) * mult;
    this.addBurn(tgt, src, tgt.structure ? 0 : dps, b.dur, 'item');
  }

  basicHit(att, tgt) {
    if (!tgt.alive || !att.alive) return;
    const s = att.stats;
    let dmg = s.ad, crit = false;
    if (att.type === 'hero') {
      if (s.crit > 0 && this.rng.next() < s.crit) { dmg *= 1.75 + s.critDmg; crit = true; }
      const p = att.def.passive;
      att.every3++;
      if (p.kind === 'every3' && att.every3 % 3 === 0) this.dealDamage(att, tgt, this.scaleVal(att, p.dmg), p.type || 'phys', { ability: true });
      if (p.kind === 'burnHits') this.addBurn(tgt, att, this.scaleVal(att, p.burn), p.burn.dur, 'passive');
      if (att.redBuffUntil > this.tick && !tgt.structure) { this.addBurn(tgt, att, 12 + att.level * 3, 3, 'red'); tgt.slows.push({ pct: 0.1, until: this.tick + sec(1) }); }
      if (!tgt.structure) this.itemBurn(att, tgt, 0.5);
      if (p.kind === 'healAllies' && tgt.type === 'hero') {
        const ally = this.lowestAlly(att, 500); if (ally) this.heal(ally, this.scaleVal(att, p.heal), att);
      }
      if (att.elderUntil > this.tick && tgt.type === 'hero' && tgt.hp / tgt.maxHp < 0.2) { this.dealDamage(att, tgt, 99999, 'true', {}); return; }
      dmg = FX.basicBonus(this, att, tgt, dmg);
    }
    if (tgt.structure && att.type === 'minion') dmg *= att.kind === 'siege' ? 3 : 2;
    if (att.type === 'tower') {
      if (tgt.type === 'minion') dmg = tgt.maxHp * ({ melee: 0.45, caster: 0.7, siege: 0.14, super: 0.07 }[tgt.kind] || 0.3);
      else if (tgt.type === 'hero') { dmg *= 1 + Math.min(1.2, att.streak * 0.35); att.streak++; }
      else if (tgt.type === 'summon') dmg *= 1.5;
      this.dealDamage(att, tgt, dmg, 'true', { basic: true });
      return;
    }
    if (att.type === 'summon' && tgt.structure) {
      const first = att.charge; att.charge = false;
      this.dealDamage(att, tgt, first ? 1400 : 380, 'true', { basic: true, summon: true });
      this.fx.push({ kind: 'fx', name: 'explosion', x: tgt.x, y: tgt.y, s: 2 });
      return;
    }
    this.dealDamage(att, tgt, dmg, 'phys', { basic: true, crit });
    if (att.type === 'hero') FX.onBasicHit(this, att, tgt);
  }

  lowestAlly(h, r) {
    let best = null, bv = 1;
    for (const u of this.grid.query(h.x, h.y, r)) if (u.type === 'hero' && u.team === h.team && u.alive) { const v = u.hp / u.maxHp; if (v < bv) { bv = v; best = u; } }
    return best;
  }

  // Start an attack on target if ready & in range. Returns true if attacking.
  tryAttack(u, tgt) {
    if (!tgt || !tgt.alive) return false;
    const rr = u.stats.range + u.radius + tgt.radius;
    if (dist2(u, tgt) > rr * rr) return false;
    this.face(u, tgt.x - u.x, tgt.y - u.y);
    if (this.tick < u.attackCd) return true;
    u.attackCd = this.tick + Math.max(1, Math.round(1 / u.stats.as / DT));
    u.animAttack = this.tick;
    if (u.type === 'hero' && u.def.ranged || (u.type === 'minion' && (u.kind === 'caster' || u.kind === 'siege')) || u.type === 'tower' || (u.type === 'objective' && u.kind !== 'herald')) {
      const sprite = u.type === 'hero' ? (u.def.proj || 'p_energy') : u.type === 'tower' ? 'tower' : u.type === 'objective' ? (u.kind === 'baron' ? 'p_bigenergy' : 'p_fireball') : u.kind === 'siege' ? 'p_cannon' : 'p_energy_small';
      this.projectiles.push({ id: this.nextId++, homing: tgt.id, x: u.x, y: u.y - 8, speed: u.type === 'tower' ? 900 : 750, team: u.team, src: u, basic: true, sprite });
    } else {
      this.basicHit(u, tgt);
      if (u.type === 'hero') this.fx.push({ kind: 'swing', id: u.id, tid: tgt.id });
    }
    return true;
  }

  moveSpeed(u) {
    let ms = u.stats.ms * this.wx.ms;
    if (u.type === 'hero') ms *= this.rules.heroMs;
    let slow = 0; for (const s of u.slows) if (s.until > this.tick && s.pct > slow) slow = s.pct;
    return ms * (1 - slow);
  }
  canMove(u) { return u.alive && this.tick >= u.stunUntil && this.tick >= u.rootUntil && !(u.castLock > this.tick); }
  // Move toward p. With nav, units follow an A* path (cached, refreshed as the goal moves);
  // movement always slides along walls instead of passing through them.
  moveToward(u, p, nav = true, stopAt = 0) {
    if (!this.canMove(u)) { u.vx = u.vy = 0; u.mvx = u.mvy = 0; return; }
    const W = this.world, now = this.tick;
    let step = p;
    const d2p = dist2(u, p);
    // Straight-line moves only with a clear, body-wide line; otherwise follow a path.
    // Hysteresis: while following a live route to (about) this goal, keep following it.
    const onRoute = u.path && now < u.path.until && dist2(u.path.goal, p) < 64 * 64 && u.path.i < u.path.pts.length - 1;
    let clear = !onRoute && d2p < 300 * 300 && ((now + u.ph) % 4 !== 0 && u._clearT === p ? u._clear : (u._clearT = p, u._clear = W.losWide(u.x, u.y, p.x, p.y)));
    // progress watchdog (both modes): if we stop advancing, fall back to a fresh path
    if (!u.prog || dist2(u, u.prog) > 18 * 18 || now - u.prog.t > 60) u.prog = { x: u.x, y: u.y, t: now };
    else if (now - u.prog.t > 16 && clear) { clear = false; u.forcePath = now + 40; }
    if (u.forcePath > now) clear = false;
    if (!clear) {
      let pc = u.path;
      if (pc && dist2(pc.goal, p) > 40 * 40 && pc.pts.length && now < pc.until) {
        // goal drifted: if the end of the current route still sees it, just retarget the end
        const last = pc.pts.length > 1 ? pc.pts[pc.pts.length - 2] : u;
        if (W.losWide(last.x, last.y, p.x, p.y)) { pc.pts[pc.pts.length - 1] = { x: p.x, y: p.y }; pc.goal = { x: p.x, y: p.y }; } else pc = null;
      }
      if (!pc || now >= pc.until || pc.i >= pc.pts.length) {
        pc = u.path = { goal: { x: p.x, y: p.y }, pts: W.findPath(u.x, u.y, p.x, p.y), i: 0, until: now + 60 + (u.ph % 13) };
      }
      const pts = pc.pts;
      while (pc.i < pts.length - 1 && dist2(u, pts[pc.i]) < 18 * 18) pc.i++;
      // skip ahead when the next waypoint is already in clear view
      if (pc.i < pts.length - 1 && (now + u.ph) % 3 === 0 && W.losWide(u.x, u.y, pts[pc.i + 1].x, pts[pc.i + 1].y)) pc.i++;
      step = pts[pc.i];
      // no progress for a while: replan, and step sideways to unstick
      if (!pc.prog || dist2(u, pc.prog) > 20 * 20) pc.prog = { x: u.x, y: u.y, t: now };
      else if (now - pc.prog.t > 24) { pc.until = now; pc.prog = null; u.unstick = now + 6; }
    } else u.path = null;
    let dx = step.x - u.x, dy = step.y - u.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    const rem = step === p ? d - stopAt : d;
    if (rem <= 0.5) { u.vx = u.vy = 0; u.mvx = u.mvy = 0; return; }
    const sp = Math.min(this.moveSpeed(u) * DT, rem);
    if (rem > 30) u.moveIntent = now;
    let mx = dx / d * sp, my = dy / d * sp;
    if (u.unstick > now) { const side = (u.ph & 1) ? 1 : -1; mx += -dy / d * sp * 0.8 * side; my += dx / d * sp * 0.8 * side; }
    if (u.type === 'hero') {
      // steering: heroes turn over a few ticks instead of snapping (reads as weight, kills jitter)
      const fresh = u.mvT === now - 1; u.mvT = now;
      const pvx = fresh ? u.mvx || 0 : 0, pvy = fresh ? u.mvy || 0 : 0;
      if (pvx || pvy) {
        const k = STEER_K;
        const rx = mx, ry = my;
        mx = pvx + (mx - pvx) * k; my = pvy + (my - pvy) * k;
        const l = Math.sqrt(mx * mx + my * my); if (l > sp) { mx = mx / l * sp; my = my / l * sp; }
        // a lagging turn that would clip a wall (late corner): take the route's own heading instead
        if (!this.world.isWalk(u.x + mx * 3, u.y + my * 3) && this.world.isWalk(u.x + rx * 3, u.y + ry * 3)) { mx = rx; my = ry; }
      }
      u.mvx = mx; u.mvy = my;
    }
    this.slide(u, mx, my);
    // walking never flips facing more than once per 0.2s (attacks still turn instantly)
    if (!(now - (u.faceT || -99) < 4)) this.face(u, mx, my);
  }
  // Facing with hysteresis: only switch axis when the new one clearly dominates.
  face(u, dx, dy) {
    const ax = Math.abs(dx), ay = Math.abs(dy);
    if (ax < 0.05 && ay < 0.05) return;
    const f0 = u.facing;
    const horiz = u.facing === 2 || u.facing === 3;
    if (horiz ? ay > ax * 1.35 : ax > ay * 1.35) { if (ax > ay) u.facing = dx > 0 ? 3 : 2; else u.facing = dy > 0 ? 0 : 1; }
    else if (horiz) u.facing = dx > 0.05 ? 3 : dx < -0.05 ? 2 : u.facing;
    else u.facing = dy > 0.05 ? 0 : dy < -0.05 ? 1 : u.facing;
    if (u.facing !== f0) u.faceT = this.tick;
  }
  slide(u, mx, my) {
    const W = this.world, ox = u.x, oy = u.y;
    if (W.isWalk(u.x + mx, u.y + my)) { u.x += mx; u.y += my; }
    else {
      if (this.navStats && u.type === 'hero') this.navStats.scrapes++;
      // slide along the wall, keeping most of the step's length on the free axis
      const l = Math.sqrt(mx * mx + my * my) || 1, ax = Math.abs(mx), ay = Math.abs(my);
      const sx = Math.sign(mx) * Math.max(ax, l * 0.7), sy = Math.sign(my) * Math.max(ay, l * 0.7);
      const tryX = ax > 0.01 && W.isWalk(u.x + sx, u.y), tryY = ay > 0.01 && W.isWalk(u.x, u.y + sy);
      if (tryX && (!tryY || ax >= ay)) u.x += sx;
      else if (tryY) u.y += sy;
      else if (W.isWalk(u.x - my / l * 2, u.y + mx / l * 2)) { u.x -= my / l * 2; u.y += mx / l * 2; }
      else if (W.isWalk(u.x + my / l * 2, u.y - mx / l * 2)) { u.x += my / l * 2; u.y -= mx / l * 2; }
    }
    u.vx = u.x - ox; u.vy = u.y - oy;
  }
  // Furthest walkable point from a toward b (for dashes / knockbacks).
  rayEnd(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, l = Math.sqrt(dx * dx + dy * dy);
    if (l < 1) return { x: a.x, y: a.y };
    const steps = Math.ceil(l / 8); let last = { x: a.x, y: a.y };
    for (let i = 1; i <= steps; i++) { const t = i / steps, p = { x: a.x + dx * t, y: a.y + dy * t }; if (!this.world.isWalk(p.x, p.y)) break; last = p; }
    return last;
  }

  // ───────────────────────── unit updates ─────────────────────────
  findTarget(u, r, pred) {
    let best = null, bd = Infinity;
    for (const e of this.grid.query(u.x, u.y, r)) {
      if (!e.alive || e.team === u.team || !pred(e)) continue;
      // exact ties go to the lower timing phase, the same pick a mirrored unit would make (not grid order)
      const d = dist2(u, e); if (d < bd || (d === bd && (e.ph < best.ph || (e.ph === best.ph && e.id < best.id)))) { bd = d; best = e; }
    }
    return best;
  }

  updateMinion(m) {
    if (this.tick < m.stunUntil) return;
    const now = this.tick, W = this.world, lane = m.lane, L = LEASH.minion;
    // Leash: a minion that strayed too far off its lane (chasing, shoved, hooked) drops its target,
    // walks back to the closest lane point and carries on from there.
    if (m.returning) {
      if (dist2(m, m.returning) > 28 * 28 && W.laneDistAt(lane, m) > 40) { this.moveToward(m, m.returning, true); return; }
      m.returning = null; m.wp = this.laneWp(m);
    } else if (W.laneDistAt(lane, m) > L) {
      m.target = null; m.returning = W.nearestOpen(W.laneSnap(lane, m)); this.moveToward(m, m.returning, true); return;
    }
    // only fight what can be reached without leaving the lane
    const reach = L + m.stats.range;
    const inZone = (e) => W.laneDistAt(lane, e) < reach;
    // Re-target periodically
    if (!m.target || !m.target.alive || (now + m.ph) % 10 === 0) {
      const aggro = 280;
      let tgt = null;
      // hero attacking an allied hero nearby
      tgt = this.findTarget(m, aggro, (e) => e.type === 'hero' && e.lastHitHero > now - sec(1.5) && this.canSee(m.team, e) && inZone(e)
        && this.grid.query(e.x, e.y, 400).some((a) => a.type === 'hero' && a.team === m.team && a.lastHurtByHero > now - sec(1.5)));
      if (!tgt) tgt = this.findTarget(m, aggro, (e) => (e.type === 'minion' || e.type === 'summon') && inZone(e));
      if (!tgt && m.type === 'summon') tgt = this.findTarget(m, 350, (e) => e.structure && this.isTargetable(e));
      // endgame: an open enemy Crystal in reach beats chasing heroes (src/sim/endgame.js)
      if (!tgt) { const n = openCrystal(this, m.team); if (n && dist2(m, n) < (aggro + 60) ** 2) tgt = n; }
      if (!tgt) tgt = this.findTarget(m, aggro, (e) => e.type === 'hero' && this.canSee(m.team, e) && inZone(e));
      if (!tgt) tgt = this.findTarget(m, aggro + 60, (e) => e.structure && this.isTargetable(e));
      if (tgt !== m.target && m.target && m.target.alive && m.target.type !== 'hero' && dist2(m, m.target) < (m.stats.range + 40) ** 2 && tgt && tgt.type !== 'hero') tgt = m.target;
      m.target = tgt;
    }
    const t = m.target;
    if (t && t.alive && dist2(m, t) < 380 * 380 && (t.structure || W.laneDistAt(lane, t) < reach + 40)) {
      if (!this.tryAttack(m, t)) this.moveToward(m, t, false, m.stats.range * 0.8 + t.radius);
      else { m.vx = m.vy = 0; }
      return;
    }
    if (t && !t.structure) m.target = null;
    // follow lane: advance once the waypoint is reached or already behind us (no walking back to it)
    const pts = W.lanes[lane], dir = m.team === BLUE ? 1 : -1;
    let wp = pts[m.wp];
    const prev = pts[m.wp - dir];
    if (dist2(m, wp) < 40 * 40 || (prev && (wp.x - m.x) * (wp.x - prev.x) + (wp.y - m.y) * (wp.y - prev.y) <= 0)) {
      if (m.team === BLUE && m.wp < pts.length - 1) m.wp++; else if (m.team === RED && m.wp > 0) m.wp--;
      wp = pts[m.wp];
    }
    this.moveToward(m, wp, false);
  }
  // The next lane waypoint ahead of a unit (in its team's marching direction).
  laneWp(m) {
    const W = this.world, pts = W.lanes[m.lane], cum = W.laneLen[m.lane], tot = cum[cum.length - 1];
    const d = W.laneProgress(m.lane, m) * tot;
    if (m.team === BLUE) { for (let i = 0; i < pts.length; i++) if (cum[i] > d + 20) return i; return pts.length - 1; }
    for (let i = pts.length - 1; i >= 0; i--) if (cum[i] < d - 20) return i;
    return 0;
  }

  updateTower(t) {
    if (!t.alive || !t.stats.range) return;
    const now = this.tick, R = t.stats.range + 14;
    let tgt = t.target;
    if (tgt && (!tgt.alive || dist2(t, tgt) > R * R)) { tgt = null; t.streak = 0; }
    // Enemy hero hitting an allied hero in range takes priority.
    const prio = this.findTarget(t, R, (e) => e.type === 'hero' && e.lastHitHero > now - sec(1)
      && this.grid.query(t.x, t.y, R + 100).some((a) => a.type === 'hero' && a.team === t.team && a.lastHurtByHero > now - sec(1)));
    if (prio && prio !== tgt) { tgt = prio; t.streak = 0; }
    if (!tgt) {
      tgt = this.findTarget(t, R, (e) => e.type === 'summon') || this.findTarget(t, R, (e) => e.type === 'minion') || this.findTarget(t, R, (e) => e.type === 'hero');
      t.streak = 0;
    }
    t.target = tgt;
    if (tgt) this.tryAttack(t, tgt);
  }

  updateMob(m) {
    const now = this.tick;
    if (now < m.stunUntil) return;
    const home = m.home;
    // Leash (standard MOBA reset): monsters and bosses fight only near their camp / pit. Pulled too
    // far, kited from out of reach, or left alone for 3s, they walk home, healing so fast that hits
    // barely land, and arrive at full HP with a clean slate.
    const leash = m.type === 'objective' ? LEASH.boss : LEASH.mob;
    if (m.resetting) {
      m.target = null; m.burns.length = 0; m.slows.length = 0;
      m.hp = Math.min(m.maxHp, m.hp + m.maxHp * 0.1);
      if (dist2(m, home) < 20 * 20) { m.resetting = false; m.hp = m.maxHp; m.leashT = 0; return; }
      if (m.stats.ms) this.moveToward(m, home, true); else { m.x = home.x; m.y = home.y; }
      return;
    }
    const reset = () => { m.target = null; m.leashT = 0; if (dist2(m, home) > 20 * 20) m.resetting = true; else m.hp = m.maxHp; };
    // aggro: whoever damaged it recently & still near
    if (m.target && (!m.target.alive || dist2(m.target, home) > (leash + m.stats.range + 60) ** 2)) m.target = null;
    if (!m.target && now - m.lastCombat < sec(2)) {
      m.target = this.findTarget(m, 400, (e) => e.type === 'hero' && e.lastCombat >= m.lastCombat - 2 && dist2(e, home) < (leash + m.stats.range) ** 2)
        || this.findTarget(m, 300, (e) => (e.type === 'hero' || e.type === 'minion' || e.type === 'summon') && dist2(e, home) < (leash + m.stats.range) ** 2);
    }
    if (m.target && now - (m.lastHurt || 0) > sec(3)) { reset(); return; }
    if (!m.target) {
      if (m.hp < m.maxHp && now - m.lastCombat > sec(1.5)) { reset(); return; }
      if (dist2(m, home) > 25 * 25) this.moveToward(m, home, true);
      return;
    }
    if (dist2(m, home) > leash * leash) { reset(); return; }
    // Objectives: AoE attacks
    if (m.type === 'objective') {
      const rr = m.stats.range + m.radius + m.target.radius;
      if (dist2(m, m.target) > rr * rr) { if (!m.stats.ms || !this.mobChase(m, leash)) return; this.moveToward(m, this.leashed(m, m.target, leash), false, m.stats.range * 0.8); return; }
      if (now < m.attackCd) return;
      m.attackCd = now + Math.round(1 / m.stats.as / DT); m.animAttack = now;
      const splash = m.kind === 'baron' ? ((m.slam = (m.slam || 0) + 1) % 4 === 0 ? 320 : 110) : m.kind === 'dragon' ? 110 : 0;
      if (splash) {
        for (const e of this.grid.query(m.target.x, m.target.y, splash)) if (e.alive && e.team !== NEUTRAL && (e.type === 'hero' || e.type === 'minion')) {
          this.dealDamage(m, e, m.stats.ad * (e === m.target ? 1 : 0.5), 'magic', { basic: true });
          if (splash > 200) this.applyCC(e, { knock: 0.75 });
        }
        this.fx.push({ kind: 'fx', name: m.kind === 'dragon' ? 'flame' : splash > 200 ? 'rockspike' : 'water', x: m.target.x, y: m.target.y, s: splash > 200 ? 3 : 1.5 });
      } else this.dealDamage(m, m.target, m.stats.ad, 'phys', { basic: true });
      return;
    }
    if (!this.tryAttack(m, m.target) && this.mobChase(m, leash)) this.moveToward(m, this.leashed(m, m.target, leash), false, m.stats.range * 0.7);
  }
  // Where a monster may stand to chase t: the target, or the edge of its leash on the way there.
  leashed(m, t, leash) {
    const h = m.home, dx = t.x - h.x, dy = t.y - h.y, d = Math.sqrt(dx * dx + dy * dy), lim = leash - 12;
    return d <= lim ? t : { x: h.x + dx / d * lim, y: h.y + dy / d * lim };
  }
  // A monster stuck at its leash edge with the target out of reach gives up after 1.5s and resets.
  mobChase(m, leash) {
    const atEdge = dist2(m, m.home) > (leash - 30) ** 2;
    if (!atEdge) { m.leashT = 0; return true; }
    if (!m.leashT) m.leashT = this.tick;
    if (this.tick - m.leashT > sec(1.5)) { m.target = null; m.leashT = 0; m.resetting = true; return false; }
    return true;
  }

  // ───────────────────────── hero update ─────────────────────────
  updateHero(h) {
    const now = this.tick;
    if (!h.alive) {
      if (now >= h.respawnAt) {
        h.alive = true; h.hp = h.maxHp; const f = this.world.fountain[h.team]; h.x = f.x; h.y = f.y; h.task = { kind: 'idle' };
        h.burns = []; h.slows = []; h.shields = []; h.stunUntil = h.rootUntil = 0; h.dash = null;
        h.silenceUntil = h.fearUntil = h.shredUntil = h.grievousUntil = 0; h.mark = null;
        this.buyItems(h);
        this.rejoinCall(h);
      }
      return;
    }
    if (h.gateAt) {
      if (now < h.stunUntil) h.gateAt = 0; // interrupted
      else if (now >= h.gateAt) { const f = this.world.fountain[h.team]; h.x = f.x; h.y = f.y; h.hp = h.maxHp; h.gateAt = 0; h.path = null; h.task = { kind: 'idle' }; this.rejoinCall(h); this.fx.push({ kind: 'fx', name: 'spirit', x: f.x, y: f.y, s: 1.6 }); }
    }
    if (h.pendingCall && now >= h.pendingCall.at) { h.task = h.pendingCall.task; h.task.since = now; h.pendingCall = null; }
    if (h.tiltUntil && now >= h.tiltUntil) { h.tiltUntil = 0; this.updateMods(h); }
    // passive gold
    if (this.time > 15) this.giveGold(h, (GOLD.passive + (h.role === 'support' ? 1.6 : 0)) * DT);
    // regen
    const regen = h.stats.regen + h.stats.regenPct * h.maxHp + (h.def.passive.kind === 'lowhpRegen' && h.hp / h.maxHp < 0.35 ? h.def.passive.pct * h.maxHp : 0)
      + (now - h.lastCombat > sec(5) ? h.maxHp * 0.012 : 0);
    const wxRegen = this.wx.regen;
    if (h.hp < h.maxHp) h.hp = Math.min(h.maxHp, h.hp + regen * wxRegen * DT * (h.grievousUntil > now ? 0.6 : 1));
    // buffs expiry → recalc occasionally
    if ((now + h.ph) % 10 === 0) this.recalc(h);
    // dash in progress
    if (h.dash) { this.updateDash(h); return; }
    if (now < h.stunUntil) return;
    if (FX.fearStep(this, h)) return;
    // recall channel
    if (h.recallAt) {
      if (now >= h.recallAt) { const f = this.world.fountain[h.team]; h.x = f.x; h.y = f.y; h.recallAt = 0; h.path = null; h.task = { kind: 'heal' }; this.emit({ type: 'recalled', hero: h.id, team: h.team }); }
      return;
    }
    if ((now + h.ph) % 10 === 0) heroMacro(this, h);
    heroThink(this, h);
  }

  updateDash(h) {
    const d = h.dash;
    const dx = d.x - h.x, dy = d.y - h.y, l = Math.sqrt(dx * dx + dy * dy);
    const sp = d.speed * DT;
    if (l <= sp || this.tick >= d.until) {
      h.x = d.x; h.y = d.y; h.dash = null;
      if (d.onArrive) d.onArrive();
      return;
    }
    h.x += dx / l * sp; h.y += dy / l * sp; h.vx = dx / l * sp; h.vy = dy / l * sp;
    this.face(h, dx, dy);
  }

  // ───────────────────────── abilities ─────────────────────────
  abilityReady(h, i) {
    const ab = h.def.abilities[i];
    if (ab.ult && h.level < 5) return false;
    if (h.silenceUntil > this.tick || ((ab.kind === 'dash' || ab.allyDash) && h.rootUntil > this.tick)) return false;
    return this.tick >= h.cds[i];
  }

  cast(h, i, tgt, pt) {
    const ab = h.def.abilities[i];
    h.cds[i] = this.tick + sec(ab.cd * h.stats.cdMult);
    h.castLock = this.tick + 4;
    h.lastCombat = this.tick;
    h.animAttack = this.tick;
    if (h.recallAt) h.recallAt = 0;
    const type = ab.type || h.def.dmgType;
    const aim = pt || (tgt ? { x: tgt.x, y: tgt.y } : { x: h.x, y: h.y });
    this.face(h, aim.x - h.x, aim.y - h.y);
    this.fx.push({ kind: 'cast', id: h.id, ab: i, x: aim.x, y: aim.y, name: ab.name, ult: !!ab.ult });
    if (ab.ult) this.emit({ type: 'ultCast', hero: h.id, team: h.team, name: ab.name });
    const selfBuff = () => {
      if (ab.buff && !['ally', 'allynova'].includes(ab.kind)) this.addBuff(h, ab.buff.stats, ab.buff.dur, 'ab' + i);
      if (ab.shield && !['ally', 'allynova'].includes(ab.kind)) this.addShield(h, this.scaleVal(h, ab.shield), ab.shield.dur || 2, h);
      if (ab.heal && ['self'].includes(ab.kind)) this.heal(h, this.scaleVal(h, ab.heal), h);
    };
    switch (ab.kind) {
      case 'shot': case 'hook': {
        const d = norm(aim.x - h.x, aim.y - h.y);
        this.projectiles.push({ id: this.nextId++, x: h.x, y: h.y, dx: d.x, dy: d.y, speed: ab.speed || 800, max: ab.range, trav: 0, team: h.team,
          src: h, ab, abi: i, width: ab.width || 30, speedMul: this.wx.proj, pierce: !!ab.pierce, hit: [], sprite: ab.proj || 'p_energy', hook: ab.kind === 'hook', type });
        selfBuff();
        break;
      }
      case 'line': {
        const d = norm(aim.x - h.x, aim.y - h.y);
        const end = { x: h.x + d.x * ab.range, y: h.y + d.y * ab.range };
        const w = (ab.width || 50) / 2;
        for (const e of this.grid.query((h.x + end.x) / 2, (h.y + end.y) / 2, ab.range / 2 + 40)) {
          if (!this.isEnemyHittable(h, e)) continue;
          const t = Math.max(0, Math.min(1, ((e.x - h.x) * d.x + (e.y - h.y) * d.y) / ab.range));
          const px = h.x + d.x * ab.range * t - e.x, py = h.y + d.y * ab.range * t - e.y;
          if (px * px + py * py <= (w + e.radius) ** 2) this.abilityHit(h, e, ab, type);
        }
        this.fx.push({ kind: 'line', x1: h.x, y1: h.y, x2: end.x, y2: end.y, name: ab.fx || 'slash', team: h.team });
        selfBuff();
        break;
      }
      case 'target': {
        if (tgt && tgt.alive) { this.abilityHit(h, tgt, ab, type); this.fx.push({ kind: 'fx', name: ab.fx || 'spark', x: tgt.x, y: tgt.y, s: ab.ult ? 2 : 1.3 }); if (ab.heal) this.heal(h, this.scaleVal(h, ab.heal), h); }
        selfBuff();
        break;
      }
      case 'circle': {
        this.pending.push({ at: this.tick + sec(ab.delay || 0.4), x: aim.x, y: aim.y, r: ab.radius, src: h, ab, type, team: h.team });
        this.fx.push({ kind: 'telegraph', x: aim.x, y: aim.y, r: ab.radius, until: this.tick + sec(ab.delay || 0.4), team: h.team });
        selfBuff();
        break;
      }
      case 'nova': {
        let n = 0;
        for (const e of this.grid.query(h.x, h.y, ab.radius + 20)) if (this.isEnemyHittable(h, e) && dist2(h, e) <= (ab.radius + e.radius) ** 2) { this.abilityHit(h, e, ab, type, true); n++; }
        if (ab.heal && n) this.heal(h, this.scaleVal(h, ab.heal), h);
        this.fx.push({ kind: 'fx', name: ab.fx || 'circle', x: h.x, y: h.y, s: ab.radius / 60 });
        selfBuff();
        break;
      }
      case 'dash': {
        let dest;
        if (tgt && tgt.team !== h.team) {
          const d = norm(tgt.x - h.x, tgt.y - h.y), l = dist(h, tgt);
          const go = Math.min(ab.range, Math.max(0, l - (tgt.radius + h.radius)));
          dest = { x: h.x + d.x * go, y: h.y + d.y * go };
        } else {
          const d = norm(aim.x - h.x, aim.y - h.y);
          dest = { x: h.x + d.x * ab.range, y: h.y + d.y * ab.range };
        }
        dest = this.rayEnd(h, dest);
        const tid = tgt ? tgt.id : 0;
        h.dash = { x: dest.x, y: dest.y, speed: 1000, until: this.tick + sec(0.8), onArrive: () => {
          if (ab.radius) {
            for (const e of this.grid.query(h.x, h.y, ab.radius + 20)) if (this.isEnemyHittable(h, e) && dist2(h, e) <= (ab.radius + e.radius) ** 2) this.abilityHit(h, e, ab, type, true);
            this.fx.push({ kind: 'fx', name: ab.fx || 'smoke_ring', x: h.x, y: h.y, s: ab.radius / 50 });
          } else if (ab.dmg || ab.cc) {
            const t2 = this.units.find((u) => u.id === tid);
            if (t2 && t2.alive && dist2(h, t2) < (90 + t2.radius) ** 2) { this.abilityHit(h, t2, ab, type); this.fx.push({ kind: 'fx', name: ab.fx || 'impact', x: t2.x, y: t2.y, s: 1.4 }); }
          }
        } };
        selfBuff();
        break;
      }
      case 'self': selfBuff(); this.fx.push({ kind: 'fx', name: ab.fx || 'aura', x: h.x, y: h.y, s: 1.2, follow: h.id }); break;
      case 'ally': {
        const a = tgt && tgt.team === h.team ? tgt : h;
        if (ab.allyDash && a !== h) {
          // Intercept: dash to the ally, then protect both
          const d = norm(a.x - h.x, a.y - h.y), go = Math.min(ab.range, Math.max(0, dist(h, a) - 30));
          const dest = this.rayEnd(h, { x: h.x + d.x * go, y: h.y + d.y * go });
          h.dash = { x: dest.x, y: dest.y, speed: 1100, until: this.tick + sec(0.6), onArrive: () => { if (a.alive) this.applyAllyEffects(h, a, ab); this.applyAllyEffects(h, h, ab); } };
        } else this.applyAllyEffects(h, a, ab);
        break;
      }
      case 'allynova': {
        for (const e of this.grid.query(h.x, h.y, ab.radius)) if (e.type === 'hero' && e.team === h.team && e.alive) this.applyAllyEffects(h, e, ab);
        this.fx.push({ kind: 'fx', name: ab.fx || 'aura', x: h.x, y: h.y, s: ab.radius / 50 });
        break;
      }
      case 'zone': {
        this.zones.push({ x: aim.x, y: aim.y, r: ab.radius, until: this.tick + sec(ab.dur || 3), next: this.tick, src: h, ab, type, team: h.team });
        this.fx.push({ kind: 'zone', x: aim.x, y: aim.y, r: ab.radius, until: this.tick + sec(ab.dur || 3), name: ab.fx, team: h.team });
        break;
      }
    }
    FX.onCast(this, h, ab, tgt, aim);
  }
  applyAllyEffects(h, a, ab) {
    if (ab.heal) this.heal(a, this.scaleVal(h, ab.heal), h);
    if (ab.shield) this.addShield(a, this.scaleVal(h, ab.shield), ab.shield.dur || 2, h);
    if (ab.buff) this.addBuff(a, ab.buff.stats, ab.buff.dur, 'ally' + h.id);
    if (h.stats.censer && a !== h) this.addBuff(a, { asPct: h.stats.censer }, 4, 'censer');
    FX.onAllyEffect(this, h, a, ab);
    this.fx.push({ kind: 'fx', name: ab.fx || 'spirit', x: a.x, y: a.y, s: 1.2, follow: a.id });
  }
  isEnemyHittable(h, e) {
    return e.alive && e.team !== h.team && !e.structure && (e.type !== 'objective' || true) && e.type !== 'ward';
  }
  abilityHit(h, e, ab, type, aoe) {
    let dmg = this.abilityDamage(h, ab, e);
    if (dmg && h.stats.tankBuster && e.type === 'hero') dmg += e.maxHp * h.stats.tankBuster * 0.5;
    if (dmg) this.dealDamage(h, e, dmg, type, { ability: true, aoe });
    if (!e.alive) return;
    if (ab.cc) this.applyCC(e, ab.cc, h);
    if (ab.burn) this.addBurn(e, h, this.scaleVal(h, ab.burn), ab.burn.dur, 'ab');
    if (h.def.passive.kind === 'burnAbilities' && e.type !== 'minion') this.addBurn(e, h, this.scaleVal(h, h.def.passive.burn), h.def.passive.burn.dur, 'passive');
    this.itemBurn(h, e, 1);
    if (h.stats.slowOnHit) e.slows.push({ pct: h.stats.slowOnHit, until: this.tick + sec(1) });
    FX.onAbilityHit(this, h, e, ab);
  }

  updateProjectiles() {
    const keep = [];
    for (const p of this.projectiles) {
      if (p.homing) {
        const t = p.tgt || (p.tgt = this.units.find((u) => u.id === p.homing));
        if (!t || !t.alive) continue;
        const dx = t.x - p.x, dy = t.y - 8 - p.y, l = Math.sqrt(dx * dx + dy * dy), sp = p.speed * DT;
        if (l <= sp + t.radius * 0.5) { if (p.src.alive || p.src.type === 'tower') this.basicHit(p.src, t); continue; }
        p.x += dx / l * sp; p.y += dy / l * sp; p.dx = dx / l; p.dy = dy / l;
        keep.push(p); continue;
      }
      const sp = p.speed * (p.speedMul || 1) * DT;
      p.x += p.dx * sp; p.y += p.dy * sp; p.trav += sp;
      let done = p.trav >= p.max;
      for (const e of this.grid.query(p.x, p.y, p.width / 2 + 20)) {
        if (!this.isEnemyHittable(p.src, e) || p.hit.includes(e.id)) continue;
        if (dist2(p, e) > (p.width / 2 + e.radius) ** 2) continue;
        if (!p.pierce && done) break;
        p.hit.push(e.id);
        this.abilityHit(p.src, e, p.ab, p.type);
        if (p.ab.splash) FX.splashHit(this, p, e);
        this.fx.push({ kind: 'fx', name: p.ab.fx || 'spark', x: e.x, y: e.y, s: p.ab.ult ? 2 : 1.2 });
        if (p.hook && e.alive && !e.boss) {
          const src = p.src, d = norm(src.x - e.x, src.y - e.y), l = dist(src, e);
          const pend = this.world.nearestOpen({ x: e.x + d.x * Math.max(0, l - 40), y: e.y + d.y * Math.max(0, l - 40) });
          e.dash = { x: pend.x, y: pend.y, speed: 1100, until: this.tick + sec(0.7), pulled: true };
          if (e.type !== 'hero') { e.x = e.dash.x; e.y = e.dash.y; e.dash = null; }
        }
        if (!p.pierce) { done = true; break; }
      }
      if (!done) keep.push(p);
    }
    this.projectiles = keep;
    // Non-hero units can be pulled by hooks too (handled instantly above); heroes run updateDash.
  }

  updatePending() {
    const now = this.tick;
    if (this.pending.length) {
      const keep = [];
      for (const p of this.pending) {
        if (p.at > now) { keep.push(p); continue; }
        let n = 0;
        for (const e of this.grid.query(p.x, p.y, p.r + 20)) if (this.isEnemyHittable(p.src, e) && dist2(p, e) <= (p.r + e.radius) ** 2) { this.abilityHit(p.src, e, p.ab, p.type, true); n++; }
        if (p.ab.heal && n && p.src.alive) this.heal(p.src, this.scaleVal(p.src, p.ab.heal), p.src);
        this.fx.push({ kind: 'fx', name: p.ab.fx || 'explosion', x: p.x, y: p.y, s: p.r / 45 });
      }
      this.pending = keep;
    }
    if (this.zones.length) {
      this.zones = this.zones.filter((z) => z.until > now);
      for (const z of this.zones) {
        if (now < z.next) continue;
        z.next = now + sec(0.5);
        for (const e of this.grid.query(z.x, z.y, z.r + 20)) if (this.isEnemyHittable(z.src, e) && dist2(z, e) <= (z.r + e.radius) ** 2) {
          this.dealDamage(z.src, e, this.abilityDamage(z.src, z.ab, e) * 0.5, z.type, { ability: true, aoe: true });
          if (z.ab.cc && z.ab.cc.slow) e.slows.push({ pct: z.ab.cc.slow[0], until: now + sec(0.6) });
          if (e.alive) FX.zoneTick(this, z, e);
        }
      }
    }
  }

  updateStatus() {
    const now = this.tick;
    FX.updateEffects(this);
    for (const u of this.units) {
      if (!u.alive) continue;
      if (u.burns.length) {
        u.burns = u.burns.filter((b) => b.until > now);
        for (const b of u.burns) { if (!u.alive) break; this.dealDamage(b.src && b.src.alive !== undefined ? b.src : null, u, b.dps * DT, 'magic', { dot: true }); }
      }
      if (u.slows.length && now % 10 === 0) u.slows = u.slows.filter((s) => s.until > now);
      if (u.type === 'hero' && now % 20 === 0) {
        if (u.stats.burnAura) for (const e of this.grid.query(u.x, u.y, 200)) if (e.alive && e.team !== u.team && !e.structure) this.dealDamage(u, e, 15 + u.maxHp * u.stats.burnAura, 'magic', { dot: true });
        if (u.stats.shredAura) for (const e of this.grid.query(u.x, u.y, 260)) if (e.type === 'hero' && e.alive && e.team !== u.team) this.addBuff(e, { asPct: -u.stats.shredAura }, 1.1, 'frozen');
      }
    }
  }

  separate(rev) {
    const tmp = [], W = this.world, U = this.units, n = U.length;
    for (let k = 0; k < n; k++) {
      const u = U[rev ? n - 1 - k : k];
      if (!u.alive || u.structure || u.boss || u.dash) continue;
      if (u.type !== 'minion' && u.type !== 'hero' && u.type !== 'mob' && u.type !== 'summon') continue;
      tmp.length = 0; this.grid.query(u.x, u.y, 30, tmp);
      for (const o of tmp) {
        if (o === u || !o.alive || o.structure || o.boss || o.dash || o.id < u.id) continue;
        const dx = o.x - u.x, dy = o.y - u.y, d2 = dx * dx + dy * dy, rr = (u.radius + o.radius) * 0.7;
        if (d2 >= rr * rr) continue;
        let ux, uy, d;
        if (d2 < 1e-6) { ux = (u.id & 1) ? 1 : -1; uy = 0; d = 0; } else { d = Math.sqrt(d2); ux = dx / d; uy = dy / d; }
        const push = (rr - d) * 0.22;
        // heroes yield less to minions; nobody is pushed into walls
        const wu = o.type === 'hero' && u.type !== 'hero' ? 1.6 : u.type === 'hero' && o.type !== 'hero' ? 0.4 : 1;
        const wo = 2 - wu;
        if (W.isWalk(o.x + ux * push * wo, o.y + uy * push * wo)) { o.x += ux * push * wo; o.y += uy * push * wo; }
        if (W.isWalk(u.x - ux * push * wu, u.y - uy * push * wu)) { u.x -= ux * push * wu; u.y -= uy * push * wu; }
      }
      // never end a tick inside a wall (e.g. after a knock or hook)
      if (!W.isWalk(u.x, u.y)) { const o = W.nearestOpen(u); u.x = o.x; u.y = o.y; }
    }
  }

  fountain() {
    for (let t = 0; t < 2; t++) {
      const f = this.world.fountain[t];
      for (const u of this.grid.query(f.x, f.y, 300)) {
        if (!u.alive) continue;
        const inner = dist2(u, f) <= 190 * 190;
        if (u.team !== t && !inner) continue;
        // the healing platform is the inner circle only: the Crystal (226-269px from the fountain) sits
        // outside it, so defenders at their Crystal no longer regenerate 15% HP per second
        if (u.team === t && u.type === 'hero') { if (inner && u.hp < u.maxHp) u.hp = Math.min(u.maxHp, u.hp + u.maxHp * 0.15 * DT); if (this.tick % 10 === 0) this.buyItems(u); }
        else if (u.team === 1 - t && (u.type === 'hero' || u.type === 'minion' || u.type === 'summon')) this.dealDamage(null, u, 900 * DT, 'true', {});
      }
    }
  }

  // ───────────────────────── death ─────────────────────────
  kill(u, src) {
    if (!u.alive) return;
    u.alive = false; u.hp = 0;
    const now = this.tick;
    this.fx.push({ kind: 'death', id: u.id, x: u.x, y: u.y, type: u.type, team: u.team });
    // credit hero
    let killer = src && src.type === 'hero' ? src : null;
    if (!killer && u.type === 'hero') {
      let best = -1;
      for (const k in u.dmgBy) if (u.dmgBy[k] > now - sec(10) && u.dmgBy[k] > best) { best = u.dmgBy[k]; killer = this.byId(+k); }
    }
    const killerTeam = src ? (src.team === NEUTRAL ? NEUTRAL : src.team) : (killer ? killer.team : 1 - u.team);
    switch (u.type) {
      case 'hero': {
        u.deaths++; u.streak = 0;
        if (u.task.call) this.addTrust(u, -8, 'died on call');
        if (u.pers.tilts) { u.tiltUntil = now + sec(60); this.addTrust(u, -4, 'tilted'); }
        u.pendingCall = null; u.stealthUntil = 0;
        u.respawnAt = now + sec(Math.min(40, (4 + u.level * 1.7 + Math.max(0, this.time / 60 - 10) * 0.6) * (this.finalPhase ? this.rules.final.respawn : 1) * this.rules.respawn));
        u.dash = null; u.recallAt = 0; u.burns = []; u.task = { kind: 'idle' };
        const assists = [];
        for (const k in u.dmgBy) { const a = this.byId(+k); if (a && a !== killer && u.dmgBy[k] > now - sec(10) && a.team !== u.team) assists.push(a); }
        // healers/shielders near the fight count too
        if (killer) for (const a of this.grid.query(u.x, u.y, 700)) if (a.type === 'hero' && a.alive && a.team === killer.team && a !== killer && !assists.includes(a) && a.lastCombat > now - sec(5)) assists.push(a);
        const victimStreak = u.killStreak || 0; u.killStreak = 0;
        if (killer) {
          killer.kills++; killer.killStreak = (killer.killStreak || 0) + 1;
          this.addTrust(killer, killer.pers.tilts ? 4 : 2, 'kill');
          this.giveGold(killer, (GOLD.kill + Math.min(5, Math.max(0, victimStreak - 1)) * GOLD.shutdownPerStreak) * this.finalMult * this.rules.killGold);
          this.teams[killer.team].kills++;
          this.addMomentum(killer.team, MOMENTUM.kill);
        } else if (killerTeam !== NEUTRAL && killerTeam !== u.team) this.teams[killerTeam].kills++;
        for (const a of assists) { a.assists++; this.giveGold(a, GOLD.assist / Math.max(1, assists.length) * 1.5 * this.rules.killGold); }
        FX.onTakedown(this, u, killer, assists);
        const xp = XP.killBase + XP.killPerLevel * u.level;
        const near = this.grid.query(u.x, u.y, 900).filter((h) => h.type === 'hero' && h.alive && h.team !== u.team);
        for (const h of near) this.giveXp(h, xp / near.length * (near.length > 1 ? 1.3 : 1));
        const ev = { type: 'kill', victim: u.id, killer: killer ? killer.id : 0, killerTeam, assists: assists.map((a) => a.id), team: u.team, x: u.x, y: u.y, shutdown: victimStreak >= 3 };
        this.emit(ev); this.resolveCalls(ev);
        break;
      }
      case 'minion': case 'summon': {
        if (u.type === 'summon') break;
        const g = GOLD[u.kind] * this.rules.minionGold, x = XP[u.kind];
        if (src && src.type === 'hero') { this.giveGold(src, g); src.cs++; this.fx.push({ kind: 'gold', id: src.id, x: u.x, y: u.y, v: g }); }
        const near = this.grid.query(u.x, u.y, 900).filter((h) => h.type === 'hero' && h.alive && h.team !== u.team);
        for (const h of near) this.giveXp(h, x / near.length * (near.length > 1 ? 1.25 : 1));
        break;
      }
      case 'mob': {
        let h = killer;
        if (!h) h = this.findTarget(u, 500, (e) => e.type === 'hero');
        if (h) {
          this.giveGold(h, u.gold); this.giveXp(h, u.xpv); h.cs += u.big ? 4 : 1;
          if (h.role === 'jungle') this.heal(h, h.maxHp * (u.big ? 0.12 : 0.04), null, true);
          if (u.buff === 'blue') { h.blueBuffUntil = now + sec(90); this.recalc(h); this.emit({ type: 'buff', hero: h.id, team: h.team, buff: 'blue', camp: u.camp }); }
          if (u.buff === 'red') { h.redBuffUntil = now + sec(90); this.emit({ type: 'buff', hero: h.id, team: h.team, buff: 'red', camp: u.camp }); }
          const near = this.grid.query(u.x, u.y, 600).filter((o) => o.type === 'hero' && o.alive && o.team === h.team && o !== h);
          for (const o of near) this.giveXp(o, u.xpv * 0.3);
          // Jungle-camp kills on the enemy side are notable (invades)
          if (u.camp && !u.camp.startsWith(String(h.team) + ':') && !this.events.some((e) => e.type === 'stolenCamp' && e.camp === u.camp && e.t === now)) { const sev = { type: 'stolenCamp', team: h.team, camp: u.camp, big: !!u.big }; this.emit(sev); this.resolveCalls(sev); }
        }
        break;
      }
      case 'objective': {
        const team = killer ? killer.team : (src && src.team !== NEUTRAL ? src.team : -1);
        this.objectives[u.kind] = null;
        if (team < 0) { this.objTimers[u.kind] = now + sec(30); break; }
        const tm = this.teams[team];
        const smite = src && src.smited === now;
        for (const h of tm.heroes) if (h.alive) { this.giveGold(h, GOLD.objectiveTeam * this.finalMult); this.giveXp(h, 120); this.addTrust(h, 3, 'objective'); }
        this.addMomentum(team, MOMENTUM.objective);
        if (u.kind === 'dragon') {
          if (u.element === 'elder') { for (const h of tm.heroes) if (h.alive) h.elderUntil = now + sec(this.T.elderBuff); this.objTimers.dragon = now + sec(this.T.elderRespawn); }
          else {
            tm.dragons.push(u.element);
            if (tm.dragons.length >= 4 && !tm.soul) {
              const cnt = {}; for (const d of tm.dragons) cnt[d] = (cnt[d] || 0) + 1;
              let best = tm.dragons[tm.dragons.length - 1]; for (const d of DRAGONS) if ((cnt[d] || 0) > (cnt[best] || 0)) best = d;
              tm.soul = best; this.emit({ type: 'soul', team, element: best });
            }
            this.nextDragon = this.rollDragon();
            this.objTimers.dragon = now + sec(this.teams.some((t) => t.soul) ? this.T.elderRespawn : this.T.dragonRespawn);
          }
          for (const h of tm.heroes) this.recalc(h);
        } else if (u.kind === 'herald') {
          tm.heraldEye = now + sec(this.T.heraldEye);
          if (this.time + this.T.heraldRespawn < this.T.heraldDespawn) this.objTimers.herald = now + sec(this.T.heraldRespawn);
        } else if (u.kind === 'baron') {
          for (const h of tm.heroes) if (h.alive) { h.baronUntil = now + sec(this.T.baronBuff); this.recalc(h); }
          tm.baronUntil = now + sec(this.T.baronBuff);
          this.objTimers.baron = now + sec(this.T.baronRespawn);
        }
        const ev = { type: 'objective', obj: u.kind, element: u.element, team, killer: killer ? killer.id : 0, steal: smite };
        this.emit(ev); this.resolveCalls(ev);
        break;
      }
      case 'tower': case 'inhib': case 'nexus': {
        const team = 1 - u.team;
        if (u.type === 'nexus') { this.over = true; this.winner = team; this.emit({ type: 'victory', team }); break; }
        for (const h of this.teams[team].heroes) this.giveGold(h, (u.type === 'tower' ? GOLD.tower : GOLD.inhib) * this.finalMult);
        if (u.type === 'tower') this.teams[team].towers++;
        this.addMomentum(team, MOMENTUM.tower);
        if (u.type === 'inhib') u.respawnAt = now + sec(this.T.inhibRespawn);
        const sev = { type: u.type === 'tower' ? 'tower' : 'inhib', team, lane: u.lane, tier: u.tier, x: u.x, y: u.y };
        this.emit(sev); this.resolveCalls(sev);
        break;
      }
    }
  }

  // Jungler smite: auto-used to secure (or steal) a nearly dead objective/buff.
  trySmite(h) {
    if (h.role !== 'jungle' || this.tick < h.smiteCd) return false;
    const dmg = 450 + 40 * h.level;
    for (const e of this.grid.query(h.x, h.y, 260)) {
      if (!e.alive || !(e.type === 'objective' || (e.type === 'mob' && e.big))) continue;
      if (e.hp <= dmg) {
        h.smiteCd = this.tick + sec(45);
        h.smited = this.tick;
        this.fx.push({ kind: 'fx', name: 'thunder', x: e.x, y: e.y, s: 2.5 });
        this.dealDamage(h, e, dmg * 5, 'true', {});
        return true;
      }
    }
    return false;
  }

  placeWard(h, spot) {
    const mine = this.wards.filter((w) => w.team === h.team && w.until > this.tick);
    if (mine.length >= 4) mine[0].until = this.tick;
    this.wards.push({ team: h.team, x: spot.x, y: spot.y, until: this.tick + sec(90), owner: h.id });
    this.fx.push({ kind: 'ward', x: spot.x, y: spot.y, team: h.team });
  }
  wardSpots(team) { return this.world.wardSpots[team]; }

  // ───────────────────────── checksum ─────────────────────────
  checksum() {
    let h = 2166136261 >>> 0;
    h = hashInts(h, this.tick, this.units.length, this.projectiles.length, this.rng.state());
    for (const u of this.units) if (u.alive) h = hashInts(h, u.id, r2(u.x), r2(u.y), r2(u.hp));
    for (const t of this.teams) { h = hashInts(h, r2(t.momentum), t.surgeUntil, t.momentCd, t.allOut); for (const x of t.heroes) h = hashInts(h, r2(x.gold), x.level, x.items.length); }
    return h >>> 0;
  }

  // Public summary for UI.
}
