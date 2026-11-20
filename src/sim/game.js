// The deterministic match simulation. Same seed + same commands => same game.
import { Rng, hashInts } from './rng.js';
import { dist2, dist, norm, r2 } from './geom.js';
import { DT, sec, BLUE, RED, NEUTRAL, T, GOLD, XP, xpNeeded, VISION, CMD, DRAGONS } from './constants.js';
import { MAP_SIZE, P, LANES, LANE_NAMES, STRUCTURES_BLUE, CAMPS_BLUE, NODES, PITS, FOUNTAIN, navStep, nearestNode, laneProgress, WARD_SPOTS_BLUE } from './map.js';
import { HERO_BY_ID } from '../data/heroes.js';
import { BUILDS } from '../data/items.js';
import { heroThink, heroMacro } from './ai.js';
import { Coach } from './coach.js';

// Champion-vs-champion damage scale: keeps fights readable and lanes from snowballing at level 1.
const HERO_VS_HERO = 0.6;
const ROLE_LANE = { top: 'top', mid: 'mid', bot: 'bot', support: 'bot', jungle: null };
const STAT_KEYS = ['power', 'powerMult', 'hp', 'armor', 'mr', 'asPct', 'crit', 'critDmg', 'pen', 'haste', 'msPct', 'range', 'omnivamp',
  'antiheal', 'thorns', 'healPower', 'execute', 'slowOnHit', 'regen', 'hpPct', 'lowHpShield', 'burnAura', 'shredAura', 'censer', 'resPct', 'regenPct'];

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
      id: t, plan: cfg.teams[t].plan || 'balanced', name: cfg.teams[t].name || (t === 0 ? 'Blue' : 'Red'),
      charges: 1, kills: 0, towers: 0, dragons: [], soul: null, heraldEye: 0, baronUntil: 0, elderUntil: 0,
      focus: null, call: null, heroes: [], goldHistory: [], invadeCamp: null,
    }));
    this.camps = [];
    this.objectives = { dragon: null, herald: null, baron: null };
    this.objTimers = { dragon: sec(T.dragonFirst), herald: sec(T.heraldFirst), baron: sec(T.baronFirst) };
    this.dragonQueue = [];
    this.nextDragon = this.rollDragon();
    this.waveCount = 0;
    this.nextWave = sec(T.firstWave);
    this.coaches = [null, null];
    this.setupStructures();
    this.setupCamps();
    for (let t = 0; t < 2; t++) for (const h of cfg.teams[t].heroes) this.spawnHero(t, h);
    for (let t = 0; t < 2; t++) if (cfg.coach && cfg.coach[t]) this.coaches[t] = new Coach(this, t, cfg.coachLevel?.[t] ?? 1);
  }

  get time() { return this.tick * DT; }
  rollDragon() {
    const last = this.dragonQueue[this.dragonQueue.length - 1];
    let d; do { d = DRAGONS[this.rng.int(4)]; } while (d === last);
    this.dragonQueue.push(d); return d;
  }

  // ───────────────────────── setup ─────────────────────────
  addUnit(u) { u.id = this.nextId++; u.alive = true; u.buffs = u.buffs || []; u.slows = []; u.burns = []; u.shields = [];
    u.stunUntil = 0; u.rootUntil = 0; u.knockUntil = 0; u.vx = 0; u.vy = 0; u.attackCd = 0; u.target = null; u.lastCombat = -999;
    u.animAttack = -999; u.facing = u.facing || 0; this.units.push(u); return u; }

  setupStructures() {
    for (let t = 0; t < 2; t++) for (const s of STRUCTURES_BLUE) {
      const pos = t === 0 ? { x: s.x, y: s.y } : P(s);
      const base = s.kind === 'nexus' ? { hp: 4200, ad: 0, range: 0 } : s.kind === 'inhib' ? { hp: 2200, ad: 0, range: 0 }
        : { hp: [0, 2600, 2800, 3000, 2400][s.tier], ad: 165, range: 235 };
      this.addUnit({ type: s.kind === 'tower' ? 'tower' : s.kind, team: t, x: pos.x, y: pos.y, tier: s.tier || 0, lane: s.lane,
        maxHp: base.hp, hp: base.hp, radius: s.kind === 'nexus' ? 50 : 34, structure: true,
        stats: { ad: base.ad, ap: 0, armor: 40, mr: 40, as: 0.83, range: base.range, ms: 0, pen: 0 }, streak: 0 });
    }
  }

  setupCamps() {
    for (let t = 0; t < 2; t++) for (const c of CAMPS_BLUE) {
      const node = t === 0 ? c.node : c.node.replace(/^b_/, 'r_');
      const pos = NODES[node];
      this.camps.push({ def: c, side: t, x: pos.x, y: pos.y, node, mobs: [], respawnAt: sec(T.campFirst), key: `${t}:${c.id}` });
    }
  }

  spawnHero(team, spec) {
    const def = HERO_BY_ID[spec.id];
    const f = FOUNTAIN[team];
    const h = this.addUnit({
      type: 'hero', team, def, heroId: def.id, role: spec.role, lane: ROLE_LANE[spec.role], homeLane: ROLE_LANE[spec.role],
      build: spec.build || def.rec, items: [], x: f.x + (this.teams[team].heroes.length - 2) * 22, y: f.y - (this.teams[team].heroes.length - 2) * 22,
      level: 1, xp: 0, gold: GOLD.start, radius: 14, cds: [0, 0, 0], castLock: 0, dash: null, every3: 0, passiveCd: 0,
      kills: 0, deaths: 0, assists: 0, cs: 0, dmgHeroes: 0, dmgTaken: 0, healed: 0, goldEarned: GOLD.start, streak: 0,
      respawnAt: 0, recallAt: 0, flashCd: 0, task: { kind: 'idle' }, dmgBy: {}, lowShieldCd: 0, smiteCd: 0, wardCd: sec(50), lastHurtByHero: -999,
      stats: null, maxHp: 1, hp: 1,
    });
    this.recalc(h); h.hp = h.maxHp;
    this.teams[team].heroes.push(h);
    this.buyItems(h);
    return h;
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
    for (const d of team.dragons) {
      if (d === 'infernal') s.powerMult += 0.05; else if (d === 'ocean') s.regenPct += 0.005; else if (d === 'mountain') s.resPct += 0.06; else if (d === 'cloud') s.msPct += 0.03;
    }
    if (team.soul === 'infernal') s.powerMult += 0.1; else if (team.soul === 'ocean') s.regenPct += 0.01; else if (team.soul === 'mountain') s.resPct += 0.12; else if (team.soul === 'cloud') s.msPct += 0.1;
    if (h.baronUntil > now) s.power += 40;
    if (h.blueBuffUntil > now) { s.haste += 20; s.regen += 6; }
    const p = h.def.passive;
    if (p.kind === 'spellVamp') s.omnivamp += p.pct;
    if (p.kind === 'msOutOfCombat' && now - h.lastCombat > sec(4)) s.msPct += p.pct;
    const pw = s.power * (1 + s.powerMult);
    if (h.def.dmgType === 'phys') s.ad = (s.ad + pw) * (1 + s.powerMult * 0.5); else s.ap = (s.ap + pw) * (1 + s.powerMult);
    s.maxHp = (s.maxHp + s.hp) * (1 + s.hpPct);
    s.armor *= 1 + s.resPct; s.mr *= 1 + s.resPct;
    s.as = Math.min(2.5, b.as * (1 + s.asPct));
    s.ms = b.ms * (1 + s.msPct);
    s.cdMult = 100 / (100 + s.haste);
    s.pen = Math.min(0.45, s.pen);
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
  giveGold(h, g) { h.gold += g; h.goldEarned += g; }
  giveXp(h, x) {
    if (h.level >= XP.maxLevel) return;
    h.xp += x;
    while (h.level < XP.maxLevel && h.xp >= xpNeeded(h.level)) {
      h.xp -= xpNeeded(h.level); h.level++;
      const ratio = h.hp / h.maxHp; this.recalc(h); h.hp = Math.min(h.maxHp, h.hp + h.def.base.hpL * 0.6);
      if (h.level === 5) this.emit({ type: 'ult', hero: h.id, team: h.team });
      this.fx.push({ kind: 'levelup', id: h.id });
      void ratio;
    }
  }

  emit(e) { e.t = this.tick; this.events.push(e); }

  // ───────────────────────── commands ─────────────────────────
  applyCommand(c) {
    const team = this.teams[c.team]; if (!team || this.over) return false;
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
        if (!h || !h.alive || !LANE_NAMES.includes(c.lane)) { ok = false; break; }
        h.task = { kind: 'gank', lane: c.lane, until: until(T.gankTimeout), call: true };
        break;
      }
      case 'objective': {
        const o = c.obj; if (!['dragon', 'herald', 'baron'].includes(o)) { ok = false; break; }
        const pit = o === 'dragon' ? PITS.dragon : PITS.baron;
        const pref = o === 'dragon' ? ['jungle', 'bot', 'support', 'mid', 'top'] : o === 'herald' ? ['jungle', 'top', 'mid', 'support', 'bot'] : ['jungle', 'mid', 'top', 'support', 'bot'];
        const n = o === 'baron' ? 5 : 4;
        const pick = alive.slice().sort((a, b) => (pref.indexOf(a.role) - pref.indexOf(b.role)) || (dist2(a, pit) - dist2(b, pit))).slice(0, n);
        for (const h of pick) if (!(h.task.kind === 'split' && h.task.call)) h.task = { kind: 'objective', obj: o, until: until(T.objectiveTimeout), call: true };
        team.call = { type: 'objective', obj: o, until: until(T.objectiveTimeout) };
        break;
      }
      case 'group': {
        if (!LANE_NAMES.includes(c.lane)) { ok = false; break; }
        for (const h of alive) if (!(h.task.kind === 'split' && h.task.call)) h.task = { kind: 'group', lane: c.lane, until: until(T.groupTimeout), call: true };
        team.call = { type: 'group', lane: c.lane, until: until(T.groupTimeout) };
        break;
      }
      case 'split': {
        const h = heroes.find((x) => x.id === c.hero);
        if (!h || !LANE_NAMES.includes(c.lane)) { ok = false; break; }
        h.task = { kind: 'split', lane: c.lane, until: until(90), call: true };
        break;
      }
      case 'focus': {
        const tgt = this.units.find((u) => u.id === c.target && u.type === 'hero' && u.team !== c.team);
        if (!tgt) { ok = false; break; }
        team.focus = { id: tgt.id, until: until(20) };
        break;
      }
      case 'safe':
        for (const h of alive) h.task = { kind: 'safe', until: until(T.safeTimeout), call: true };
        team.call = { type: 'safe', until: until(T.safeTimeout) };
        break;
      case 'reset':
        for (const h of alive) h.task = { kind: 'recall', call: true };
        break;
      case 'invade': {
        const enemyCamps = this.camps.filter((cp) => cp.side !== c.team && cp.mobs.length > 0);
        if (!jungler || !jungler.alive || !enemyCamps.length) { ok = false; break; }
        const camp = enemyCamps.sort((a, b) => dist2(a, jungler) - dist2(b, jungler))[0];
        const buddy = alive.filter((h) => h.role === 'support' || h.role === 'mid').sort((a, b) => dist2(a, camp) - dist2(b, camp))[0];
        for (const h of [jungler, buddy]) if (h) h.task = { kind: 'invade', camp: camp.key, until: until(30), call: true };
        break;
      }
      case 'herald': {
        if (team.heraldEye <= this.tick || !LANE_NAMES.includes(c.lane)) { ok = false; break; }
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
      case 'cancel':
        for (const h of alive) if (h.task.call) h.task = { kind: 'idle' };
        team.call = null; team.focus = null;
        break;
      default: ok = false;
    }
    if (ok) {
      team.charges -= cost;
      const entry = { t: this.tick, team: c.team, type: c.type, lane: c.lane, obj: c.obj, hero: c.hero, target: c.target, build: c.build, result: null };
      if (['gank', 'objective', 'invade', 'group'].includes(c.type)) this.callLog.push(entry);
      this.emit({ type: 'call', team: c.team, call: entry });
    }
    return ok;
  }

  resolveCalls(ev) {
    for (const c of this.callLog) {
      if (c.result || this.tick - c.t > sec(c.type === 'objective' ? T.objectiveTimeout : T.gankTimeout + 4)) {
        if (!c.result && this.tick - c.t > sec(c.type === 'objective' ? T.objectiveTimeout : T.gankTimeout + 4)) c.result = 'expired';
        continue;
      }
      if (ev.type === 'kill') {
        const v = this.byId(ev.victim);
        if (c.type === 'gank' && v && ev.killerTeam === c.team && this.laneOf(v) === c.lane) c.result = 'success';
        else if (c.type === 'gank' && v && v.team === c.team && this.laneOf(v) === c.lane) c.result = 'traded';
      }
      if (ev.type === 'objective' && c.type === 'objective' && ev.obj === c.obj) c.result = ev.team === c.team ? (ev.steal ? 'success' : 'success') : 'stolen';
    }
  }
  laneOf(u) {
    let best = null, bd = 360 * 360;
    for (const ln of LANE_NAMES) for (const p of LANES[ln]) { const d = dist2(u, p); if (d < bd) { bd = d; best = ln; } }
    if (best) return best;
    // fall back to lane progress geometry
    return u.x + u.y < MAP_SIZE * 0.9 ? 'top' : u.x + u.y > MAP_SIZE * 1.1 ? 'bot' : 'mid';
  }
  byId(id) { for (const u of this.units) if (u.id === id) return u; return null; }

  // ───────────────────────── main step ─────────────────────────
  step(commands = []) {
    if (this.over) return;
    const now = this.tick;
    // Commands are applied in a canonical order so both peers agree.
    const cmds = commands.slice().sort((a, b) => a.team - b.team || (a.seq || 0) - (b.seq || 0));
    for (const c of cmds) this.applyCommand(c);
    for (let t = 0; t < 2; t++) { if (this.coaches[t]) this.coaches[t].update(); }

    for (const tm of this.teams) {
      tm.charges = Math.min(CMD.maxCharges, tm.charges + DT / CMD.regen);
      if (tm.focus && tm.focus.until <= now) tm.focus = null;
      if (tm.call && tm.call.until <= now) tm.call = null;
    }

    this.spawnWaves();
    this.updateCamps();
    this.updateObjectivesSpawn();

    // rebuild grid
    this.grid.clear();
    for (const u of this.units) if (u.alive) this.grid.add(u);
    if (now % 4 === 0) this.updateVision();

    // heroes
    for (const u of this.units) if (u.type === 'hero') this.updateHero(u);
    for (const u of this.units) {
      if (!u.alive) continue;
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
    this.separate();
    this.fountain();

    // cleanup
    if (now % 20 === 0) {
      this.units = this.units.filter((u) => u.alive || u.type === 'hero' || u.structure);
      this.wards = this.wards.filter((w) => w.until > now);
      if (now % 200 === 0) for (const t of this.teams) t.goldHistory.push(t.heroes.reduce((a, h) => a + h.goldEarned, 0));
    }
    this.tick++;
  }

  // ───────────────────────── waves ─────────────────────────
  spawnWaves() {
    if (this.tick < this.nextWave) return;
    this.nextWave += sec(T.waveEvery);
    this.waveCount++;
    const minute = this.time / 60;
    for (let t = 0; t < 2; t++) for (const ln of LANE_NAMES) {
      const kinds = ['melee', 'melee', 'melee', 'caster', 'caster', 'caster'];
      if (this.waveCount % T.siegeEvery === 0) kinds.splice(3, 0, 'siege');
      const enemyInhibDown = this.units.some((u) => u.type === 'inhib' && u.team !== t && u.lane === ln && !u.alive);
      if (enemyInhibDown) kinds.unshift('super');
      const baron = this.teams[t].heroes.some((h) => h.alive && h.baronUntil > this.tick);
      kinds.forEach((k, i) => this.spawnMinion(t, ln, k, i, minute, baron));
    }
  }
  spawnMinion(team, lane, kind, i, minute, baron) {
    const pts = LANES[lane];
    const start = team === BLUE ? pts[0] : pts[pts.length - 1];
    const nextIdx = team === BLUE ? 1 : pts.length - 2;
    const d = norm(pts[nextIdx].x - start.x, pts[nextIdx].y - start.y);
    const back = i * 26;
    const S = { melee: { hp: 480, ad: 14, range: 46, as: 1.0, armor: 0, mr: 0 }, caster: { hp: 300, ad: 24, range: 165, as: 0.67, armor: 0, mr: 0 },
      siege: { hp: 900, ad: 42, range: 210, as: 0.5, armor: 25, mr: 0 }, super: { hp: 1600, ad: 120, range: 60, as: 0.85, armor: 40, mr: 0 } }[kind];
    const growth = 1 + minute * 0.055;
    const bm = baron ? 1.5 : 1;
    const hp = S.hp * growth * bm;
    this.addUnit({ type: 'minion', kind, team, lane, x: start.x + d.x * (60 - back) + (i % 2 ? 6 : -6), y: start.y + d.y * (60 - back), wp: nextIdx,
      maxHp: hp, hp, radius: kind === 'siege' || kind === 'super' ? 12 : 9, empowered: baron,
      stats: { ad: S.ad * growth * bm, ap: 0, armor: S.armor * (baron ? 1.5 : 1), mr: S.mr, as: S.as, range: S.range, ms: 72, pen: 0 } });
  }
  spawnSummon(team, lane) {
    // Herald charges down the lane from the team's furthest allied presence.
    const pts = LANES[lane];
    let prog = team === BLUE ? 0.15 : 0.85;
    for (const u of this.units) if (u.alive && u.team === team && (u.type === 'minion' || (u.type === 'tower' && u.lane === lane)) && (u.lane === lane)) {
      const pr = laneProgress(lane, u); if (team === BLUE ? pr > prog : pr < prog) prog = pr;
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
  lanePointAt(lane, prog) {
    const pts = LANES[lane];
    // Walk the polyline.
    let total = 0; const seg = [];
    for (let i = 1; i < pts.length; i++) { const l = dist(pts[i - 1], pts[i]); seg.push(l); total += l; }
    let d = prog * total;
    for (let i = 1; i < pts.length; i++) { if (d <= seg[i - 1]) { const k = d / seg[i - 1]; return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * k, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * k }; } d -= seg[i - 1]; }
    return { ...pts[pts.length - 1] };
  }

  // ───────────────────────── jungle ─────────────────────────
  updateCamps() {
    const minute = this.time / 60;
    for (const c of this.camps) {
      if (c.mobs.length) { c.mobs = c.mobs.filter((m) => m.alive); if (!c.mobs.length) c.respawnAt = this.tick + sec(c.def.buff ? T.buffRespawn : T.campRespawn); continue; }
      if (this.tick >= c.respawnAt && c.respawnAt > 0) {
        c.respawnAt = 0;
        const g = 1 + minute * 0.07;
        for (const m of c.def.mobs) {
          const dx = (m.dx || 0) * (c.side ? -1 : 1), dy = (m.dy || 0) * (c.side ? -1 : 1);
          const mob = this.addUnit({ type: 'mob', kind: m.k, camp: c.key, team: NEUTRAL, x: c.x + dx, y: c.y + dy, home: { x: c.x + dx, y: c.y + dy },
            maxHp: m.hp * g, hp: m.hp * g, radius: m.big ? 16 : 10, big: !!m.big, buff: m.big ? c.def.buff : null,
            gold: m.big ? (c.def.buff ? 110 : 70) : 22, xpv: m.big ? (c.def.buff ? 170 : 110) : 30,
            stats: { ad: m.ad * g * 0.6, ap: 0, armor: 12, mr: 12, as: 0.8, range: 50, ms: 90, pen: 0 } });
          c.mobs.push(mob);
        }
      }
    }
  }

  updateObjectivesSpawn() {
    const now = this.tick, minute = this.time / 60;
    const ob = this.objectives;
    if (!ob.dragon && this.objTimers.dragon && now >= this.objTimers.dragon) {
      const elder = this.teams.some((t) => t.soul);
      const el = elder ? 'elder' : this.nextDragon;
      const hp = (elder ? 6500 : 3200) + minute * 120;
      ob.dragon = this.addUnit({ type: 'objective', kind: 'dragon', element: el, team: NEUTRAL, x: PITS.dragon.x, y: PITS.dragon.y, home: { ...PITS.dragon },
        maxHp: hp, hp, radius: 30, big: true, boss: true, stats: { ad: (elder ? 150 : 55) + minute * 5, ap: 0, armor: 40, mr: 40, as: 0.7, range: 220, ms: 80, pen: 0 } });
      this.objTimers.dragon = 0;
      this.emit({ type: 'spawn', obj: 'dragon', element: el });
    }
    if (!ob.herald && this.objTimers.herald && now >= this.objTimers.herald && !ob.baron) {
      if (this.time < T.heraldDespawn - 20) {
        const hp = 5000 + minute * 100;
        ob.herald = this.addUnit({ type: 'objective', kind: 'herald', team: NEUTRAL, x: PITS.baron.x, y: PITS.baron.y, home: { ...PITS.baron },
          maxHp: hp, hp, radius: 26, big: true, boss: true, stats: { ad: 80, ap: 0, armor: 50, mr: 50, as: 0.6, range: 90, ms: 80, pen: 0 } });
        this.emit({ type: 'spawn', obj: 'herald' });
      }
      this.objTimers.herald = 0;
    }
    if (ob.herald && ob.herald.alive && this.time >= T.heraldDespawn) { ob.herald.alive = false; ob.herald = null; this.emit({ type: 'despawn', obj: 'herald' }); }
    if (!ob.baron && this.objTimers.baron && now >= this.objTimers.baron && !(ob.herald && ob.herald.alive)) {
      const hp = 9000 + Math.max(0, minute - 9) * 220;
      ob.baron = this.addUnit({ type: 'objective', kind: 'baron', team: NEUTRAL, x: PITS.baron.x, y: PITS.baron.y, home: { ...PITS.baron },
        maxHp: hp, hp, radius: 34, big: true, boss: true, slam: 0, stats: { ad: 170 + minute * 6, ap: 0, armor: 70, mr: 70, as: 0.75, range: 230, ms: 0, pen: 0 } });
      this.objTimers.baron = 0;
      this.emit({ type: 'spawn', obj: 'baron' });
    }
  }

  // ───────────────────────── vision ─────────────────────────
  updateVision() {
    for (let t = 0; t < 2; t++) {
      const vis = new Set();
      const tmp = [];
      const look = (x, y, r) => { tmp.length = 0; this.grid.query(x, y, r, tmp); for (const e of tmp) if (e.team !== t) vis.add(e.id); };
      for (const u of this.units) {
        if (!u.alive || u.team !== t) continue;
        const r = u.type === 'hero' ? VISION.hero : u.type === 'minion' ? VISION.minion : u.type === 'summon' ? VISION.summon : u.structure ? VISION.tower : 0;
        if (r) look(u.x, u.y, r);
      }
      for (const w of this.wards) if (w.team === t && w.until > this.tick) look(w.x, w.y, VISION.ward);
      look(FOUNTAIN[t].x, FOUNTAIN[t].y, VISION.fountain);
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
    let amt = raw;
    const ss = src && src.stats;
    if (src && src.type === 'hero') {
      const lowHp = tgt.hp / tgt.maxHp < 0.35;
      if (lowHp && src.def.passive.kind === 'executer') amt *= 1 + src.def.passive.pct;
      if (lowHp && ss.execute) amt *= 1 + ss.execute;
      if (tgt.structure && src.def.passive.kind === 'siege') amt *= 1 + src.def.passive.pct;
      if ((tgt.type === 'mob' || tgt.type === 'objective') && src.role === 'jungle') amt *= 1.6;
      if (tgt.structure && !flags.summon) {
        // Backdoor protection: heroes deal reduced damage without minion cover.
        const cover = this.grid.query(tgt.x, tgt.y, 450).some((u) => (u.type === 'minion' || u.type === 'summon') && u.team === src.team && u.alive);
        if (!cover) amt *= 0.35;
      }
    }
    if (type !== 'true') {
      const res = type === 'phys' ? (tgt.stats.armor || 0) : (tgt.stats.mr || 0);
      const eff = res * (1 - ((ss && ss.pen) || 0));
      amt *= eff >= 0 ? 100 / (100 + eff) : 2 - 100 / (100 - eff);
    }
    if (tgt.type === 'hero') {
      if (tgt.def.passive.kind === 'dr') amt *= 1 - tgt.def.passive.pct;
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
    if (src) src.lastCombat = this.tick;
    if (tgt.type === 'hero') {
      tgt.dmgTaken += amt;
      if (tgt.recallAt) { tgt.recallAt = 0; }
      if (src && src.type === 'hero') {
        tgt.dmgBy[src.id] = this.tick; tgt.lastHurtByHero = this.tick; src.dmgHeroes += amt; src.lastHitHero = this.tick;
        // passive shield
        const p = tgt.def.passive;
        if (p.kind === 'shieldOnHit' && this.tick >= tgt.passiveCd) { this.addShield(tgt, tgt.maxHp * p.pct, 3); tgt.passiveCd = this.tick + sec(p.cd); }
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
    const now = this.tick;
    if (cc.stun) { u.stunUntil = Math.max(u.stunUntil, now + sec(cc.stun)); }
    if (cc.knock) { u.stunUntil = Math.max(u.stunUntil, now + sec(cc.knock)); u.knockUntil = now + sec(cc.knock); }
    if (cc.root) u.rootUntil = Math.max(u.rootUntil, now + sec(cc.root));
    if (cc.slow) u.slows.push({ pct: cc.slow[0], until: now + sec(cc.slow[1]) });
    if ((cc.stun || cc.knock) && u.type === 'hero') { u.recallAt = 0; if (u.dash && !u.dash.pulled) u.dash = null; }
    if (cc.stun || cc.root || cc.knock) this.fx.push({ kind: 'cc', id: u.id, cc: cc.knock ? 'knock' : cc.stun ? 'stun' : 'root' });
    void src;
  }
  addBurn(u, src, dps, dur, key) {
    if (!u.alive || dps <= 0) return;
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
  face(u, dx, dy) { if (Math.abs(dx) > Math.abs(dy)) u.facing = dx > 0 ? 3 : 2; else u.facing = dy > 0 ? 0 : 1; }

  moveSpeed(u) {
    let ms = u.stats.ms;
    let slow = 0; for (const s of u.slows) if (s.until > this.tick && s.pct > slow) slow = s.pct;
    return ms * (1 - slow);
  }
  canMove(u) { return u.alive && this.tick >= u.stunUntil && this.tick >= u.rootUntil && !(u.castLock > this.tick); }
  moveToward(u, p, nav = true, stopAt = 0) {
    if (!this.canMove(u)) { u.vx = u.vy = 0; return; }
    const step = nav ? navStep(u, p) : p;
    const dx = step.x - u.x, dy = step.y - u.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    const rem = step === p ? d - stopAt : d;
    if (rem <= 0.5) { u.vx = u.vy = 0; return; }
    const sp = Math.min(this.moveSpeed(u) * DT, rem);
    u.vx = dx / d * sp; u.vy = dy / d * sp;
    u.x += u.vx; u.y += u.vy;
    this.face(u, dx, dy);
  }

  // ───────────────────────── unit updates ─────────────────────────
  findTarget(u, r, pred) {
    let best = null, bd = Infinity;
    for (const e of this.grid.query(u.x, u.y, r)) {
      if (!e.alive || e.team === u.team || !pred(e)) continue;
      const d = dist2(u, e); if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  updateMinion(m) {
    if (this.tick < m.stunUntil) return;
    const now = this.tick;
    // Re-target periodically
    if (!m.target || !m.target.alive || (now + m.id) % 10 === 0) {
      const aggro = 280;
      let tgt = null;
      // hero attacking an allied hero nearby
      tgt = this.findTarget(m, aggro, (e) => e.type === 'hero' && e.lastHitHero > now - sec(1.5) && this.canSee(m.team, e)
        && this.grid.query(e.x, e.y, 400).some((a) => a.type === 'hero' && a.team === m.team && a.lastHurtByHero > now - sec(1.5)));
      if (!tgt) tgt = this.findTarget(m, aggro, (e) => (e.type === 'minion' || e.type === 'summon'));
      if (!tgt && m.type === 'summon') tgt = this.findTarget(m, 350, (e) => e.structure && this.isTargetable(e));
      if (!tgt) tgt = this.findTarget(m, aggro, (e) => e.type === 'hero' && this.canSee(m.team, e));
      if (!tgt) tgt = this.findTarget(m, aggro + 60, (e) => e.structure && this.isTargetable(e));
      if (tgt !== m.target && m.target && m.target.alive && m.target.type !== 'hero' && dist2(m, m.target) < (m.stats.range + 40) ** 2 && tgt && tgt.type !== 'hero') tgt = m.target;
      m.target = tgt;
    }
    if (m.target && m.target.alive && dist2(m, m.target) < 380 * 380) {
      if (!this.tryAttack(m, m.target)) this.moveToward(m, m.target, false, m.stats.range * 0.8 + m.target.radius);
      else { m.vx = m.vy = 0; }
      return;
    }
    // follow lane
    const pts = LANES[m.lane];
    const wp = pts[m.wp];
    if (dist2(m, wp) < 40 * 40) {
      if (m.team === BLUE && m.wp < pts.length - 1) m.wp++; else if (m.team === RED && m.wp > 0) m.wp--;
    }
    this.moveToward(m, pts[m.wp], false);
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
    const leash = m.type === 'objective' ? 520 : 330;
    if (m.resetting) {
      this.moveToward(m, home, false);
      m.hp = Math.min(m.maxHp, m.hp + m.maxHp * 0.08);
      if (dist2(m, home) < 20 * 20) { m.resetting = false; m.hp = m.maxHp; }
      return;
    }
    // aggro: whoever damaged it recently & still near
    if (m.target && (!m.target.alive || dist2(m.target, home) > leash * leash)) m.target = null;
    if (!m.target && now - m.lastCombat < sec(2)) {
      m.target = this.findTarget(m, 400, (e) => e.type === 'hero' && e.lastCombat >= m.lastCombat - 2) || this.findTarget(m, 300, (e) => e.type === 'hero' || e.type === 'minion' || e.type === 'summon');
    }
    if (m.target && now - (m.lastHurt || 0) > sec(3)) { m.target = null; if (dist2(m, home) > 30 * 30) m.resetting = true; return; }
    if (!m.target) {
      if (dist2(m, home) > 25 * 25) { if (now - m.lastCombat > sec(3)) m.resetting = true; else this.moveToward(m, home, false); }
      else if (now - m.lastCombat > sec(4)) m.hp = Math.min(m.maxHp, m.hp + m.maxHp * 0.02 * DT * 20);
      return;
    }
    if (dist2(m, home) > leash * leash) { m.resetting = true; m.target = null; return; }
    // Objectives: AoE attacks
    if (m.type === 'objective') {
      const rr = m.stats.range + m.radius + m.target.radius;
      if (dist2(m, m.target) > rr * rr) { if (m.stats.ms) this.moveToward(m, m.target, false, m.stats.range * 0.8); return; }
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
    if (!this.tryAttack(m, m.target)) this.moveToward(m, m.target, false, m.stats.range * 0.7);
  }

  // ───────────────────────── hero update ─────────────────────────
  updateHero(h) {
    const now = this.tick;
    if (!h.alive) {
      if (now >= h.respawnAt) {
        h.alive = true; h.hp = h.maxHp; const f = FOUNTAIN[h.team]; h.x = f.x; h.y = f.y; h.task = { kind: 'idle' };
        h.burns = []; h.slows = []; h.shields = []; h.stunUntil = h.rootUntil = 0; h.dash = null;
        this.buyItems(h);
      }
      return;
    }
    // passive gold
    if (this.time > 15) this.giveGold(h, (GOLD.passive + (h.role === 'support' ? 1.6 : 0)) * DT);
    // regen
    const regen = h.stats.regen + h.stats.regenPct * h.maxHp + (h.def.passive.kind === 'lowhpRegen' && h.hp / h.maxHp < 0.35 ? h.def.passive.pct * h.maxHp : 0)
      + (now - h.lastCombat > sec(5) ? h.maxHp * 0.012 : 0);
    if (h.hp < h.maxHp) h.hp = Math.min(h.maxHp, h.hp + regen * DT * (h.grievousUntil > now ? 0.6 : 1));
    // buffs expiry → recalc occasionally
    if ((now + h.id) % 10 === 0) this.recalc(h);
    // dash in progress
    if (h.dash) { this.updateDash(h); return; }
    if (now < h.stunUntil) return;
    // recall channel
    if (h.recallAt) {
      if (now >= h.recallAt) { const f = FOUNTAIN[h.team]; h.x = f.x; h.y = f.y; h.recallAt = 0; this.emit({ type: 'recalled', hero: h.id, team: h.team }); }
      return;
    }
    if ((now + h.id) % 10 === 0) heroMacro(this, h);
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
        this.projectiles.push({ id: this.nextId++, x: h.x, y: h.y - 6, dx: d.x, dy: d.y, speed: ab.speed || 800, max: ab.range, trav: 0, team: h.team,
          src: h, ab, abi: i, width: ab.width || 30, pierce: !!ab.pierce, hit: [], sprite: ab.proj || 'p_energy', hook: ab.kind === 'hook', type });
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
        dest.x = Math.max(20, Math.min(MAP_SIZE - 20, dest.x)); dest.y = Math.max(20, Math.min(MAP_SIZE - 20, dest.y));
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
        this.applyAllyEffects(h, a, ab);
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
  }
  applyAllyEffects(h, a, ab) {
    if (ab.heal) this.heal(a, this.scaleVal(h, ab.heal), h);
    if (ab.shield) this.addShield(a, this.scaleVal(h, ab.shield), ab.shield.dur || 2, h);
    if (ab.buff) this.addBuff(a, ab.buff.stats, ab.buff.dur, 'ally' + h.id);
    if (h.stats.censer && a !== h) this.addBuff(a, { asPct: h.stats.censer }, 4, 'censer');
    this.fx.push({ kind: 'fx', name: ab.fx || 'spirit', x: a.x, y: a.y, s: 1.2, follow: a.id });
  }
  isEnemyHittable(h, e) {
    return e.alive && e.team !== h.team && !e.structure && (e.type !== 'objective' || true) && e.type !== 'ward';
  }
  abilityHit(h, e, ab, type, aoe) {
    const dmg = this.abilityDamage(h, ab, e);
    if (dmg) this.dealDamage(h, e, dmg, type, { ability: true, aoe });
    if (!e.alive) return;
    if (ab.cc) this.applyCC(e, ab.cc, h);
    if (ab.burn) this.addBurn(e, h, this.scaleVal(h, ab.burn), ab.burn.dur, 'ab');
    if (h.def.passive.kind === 'burnAbilities') this.addBurn(e, h, this.scaleVal(h, h.def.passive.burn), h.def.passive.burn.dur, 'passive');
    this.itemBurn(h, e, 1);
    if (h.stats.slowOnHit) e.slows.push({ pct: h.stats.slowOnHit, until: this.tick + sec(1) });
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
      const sp = p.speed * DT;
      p.x += p.dx * sp; p.y += p.dy * sp; p.trav += sp;
      let done = p.trav >= p.max;
      for (const e of this.grid.query(p.x, p.y, p.width / 2 + 20)) {
        if (!this.isEnemyHittable(p.src, e) || p.hit.includes(e.id)) continue;
        if (dist2(p, e) > (p.width / 2 + e.radius) ** 2) continue;
        if (!p.pierce && done) break;
        p.hit.push(e.id);
        this.abilityHit(p.src, e, p.ab, p.type);
        this.fx.push({ kind: 'fx', name: p.ab.fx || 'spark', x: e.x, y: e.y, s: p.ab.ult ? 2 : 1.2 });
        if (p.hook && e.alive && !e.boss) {
          const src = p.src, d = norm(src.x - e.x, src.y - e.y), l = dist(src, e);
          e.dash = { x: e.x + d.x * Math.max(0, l - 40), y: e.y + d.y * Math.max(0, l - 40), speed: 1100, until: this.tick + sec(0.7), pulled: true };
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
        }
      }
    }
  }

  updateStatus() {
    const now = this.tick;
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

  separate() {
    const tmp = [];
    for (const u of this.units) {
      if (!u.alive || u.structure || u.boss || u.dash) continue;
      if (u.type !== 'minion' && u.type !== 'hero' && u.type !== 'mob' && u.type !== 'summon') continue;
      tmp.length = 0; this.grid.query(u.x, u.y, 30, tmp);
      for (const o of tmp) {
        if (o === u || !o.alive || o.structure || o.id < u.id) continue;
        const dx = o.x - u.x, dy = o.y - u.y, d2 = dx * dx + dy * dy, rr = (u.radius + o.radius) * 0.75;
        if (d2 >= rr * rr || d2 < 1e-6) { if (d2 < 1e-6) { u.x -= 0.5; o.x += 0.5; } continue; }
        const d = Math.sqrt(d2), push = (rr - d) * 0.25;
        const ux = dx / d, uy = dy / d;
        if (!o.boss && !o.structure) { o.x += ux * push; o.y += uy * push; }
        u.x -= ux * push; u.y -= uy * push;
      }
      // Structures are solid
      for (const s of this.grid.query(u.x, u.y, 60)) if (s.structure && s.alive) {
        const dx = u.x - s.x, dy = u.y - s.y, d2 = dx * dx + dy * dy, rr = s.radius * 0.8 + u.radius * 0.5;
        if (d2 < rr * rr && d2 > 1e-6) { const d = Math.sqrt(d2); u.x = s.x + dx / d * rr; u.y = s.y + dy / d * rr; }
      }
    }
  }

  fountain() {
    for (let t = 0; t < 2; t++) {
      const f = FOUNTAIN[t];
      for (const u of this.grid.query(f.x, f.y, 300)) {
        if (!u.alive) continue;
        if (u.team !== t && dist2(u, f) > 190 * 190) continue;
        if (u.team === t && u.type === 'hero') { if (u.hp < u.maxHp) u.hp = Math.min(u.maxHp, u.hp + u.maxHp * 0.15 * DT); if (this.tick % 10 === 0) this.buyItems(u); }
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
        u.respawnAt = now + sec(Math.min(32, 4 + u.level * 1.7 + Math.max(0, this.time / 60 - 10) * 0.6));
        u.dash = null; u.recallAt = 0; u.burns = []; u.task = { kind: 'idle' };
        const assists = [];
        for (const k in u.dmgBy) { const a = this.byId(+k); if (a && a !== killer && u.dmgBy[k] > now - sec(10) && a.team !== u.team) assists.push(a); }
        // healers/shielders near the fight count too
        if (killer) for (const a of this.grid.query(u.x, u.y, 700)) if (a.type === 'hero' && a.alive && a.team === killer.team && a !== killer && !assists.includes(a) && a.lastCombat > now - sec(5)) assists.push(a);
        const victimStreak = u.killStreak || 0; u.killStreak = 0;
        if (killer) {
          killer.kills++; killer.killStreak = (killer.killStreak || 0) + 1;
          this.giveGold(killer, GOLD.kill + Math.min(5, Math.max(0, victimStreak - 1)) * GOLD.shutdownPerStreak);
          this.teams[killer.team].kills++;
        } else if (killerTeam !== NEUTRAL && killerTeam !== u.team) this.teams[killerTeam].kills++;
        for (const a of assists) { a.assists++; this.giveGold(a, GOLD.assist / Math.max(1, assists.length) * 1.5); }
        const xp = XP.killBase + XP.killPerLevel * u.level;
        const near = this.grid.query(u.x, u.y, 900).filter((h) => h.type === 'hero' && h.alive && h.team !== u.team);
        for (const h of near) this.giveXp(h, xp / near.length * (near.length > 1 ? 1.3 : 1));
        const ev = { type: 'kill', victim: u.id, killer: killer ? killer.id : 0, killerTeam, assists: assists.map((a) => a.id), team: u.team, x: u.x, y: u.y, shutdown: victimStreak >= 3 };
        this.emit(ev); this.resolveCalls(ev);
        break;
      }
      case 'minion': case 'summon': {
        if (u.type === 'summon') break;
        const g = GOLD[u.kind], x = XP[u.kind];
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
          if (u.big && !u.camp.startsWith(String(h.team) + ':')) this.emit({ type: 'stolenCamp', team: h.team, camp: u.camp });
        }
        break;
      }
      case 'objective': {
        const team = killer ? killer.team : (src && src.team !== NEUTRAL ? src.team : -1);
        this.objectives[u.kind] = null;
        if (team < 0) { this.objTimers[u.kind] = now + sec(30); break; }
        const tm = this.teams[team];
        const smite = src && src.smited === now;
        for (const h of tm.heroes) if (h.alive) { this.giveGold(h, GOLD.objectiveTeam); this.giveXp(h, 120); }
        if (u.kind === 'dragon') {
          if (u.element === 'elder') { for (const h of tm.heroes) if (h.alive) h.elderUntil = now + sec(T.elderBuff); this.objTimers.dragon = now + sec(T.elderRespawn); }
          else {
            tm.dragons.push(u.element);
            if (tm.dragons.length >= 4 && !tm.soul) {
              const cnt = {}; for (const d of tm.dragons) cnt[d] = (cnt[d] || 0) + 1;
              let best = tm.dragons[tm.dragons.length - 1]; for (const d of DRAGONS) if ((cnt[d] || 0) > (cnt[best] || 0)) best = d;
              tm.soul = best; this.emit({ type: 'soul', team, element: best });
            }
            this.nextDragon = this.rollDragon();
            this.objTimers.dragon = now + sec(this.teams.some((t) => t.soul) ? T.elderRespawn : T.dragonRespawn);
          }
          for (const h of tm.heroes) this.recalc(h);
        } else if (u.kind === 'herald') {
          tm.heraldEye = now + sec(T.heraldEye);
          if (this.time + T.heraldRespawn < T.heraldDespawn) this.objTimers.herald = now + sec(T.heraldRespawn);
        } else if (u.kind === 'baron') {
          for (const h of tm.heroes) if (h.alive) { h.baronUntil = now + sec(T.baronBuff); this.recalc(h); }
          tm.baronUntil = now + sec(T.baronBuff);
          this.objTimers.baron = now + sec(T.baronRespawn);
        }
        const ev = { type: 'objective', obj: u.kind, element: u.element, team, killer: killer ? killer.id : 0, steal: smite };
        this.emit(ev); this.resolveCalls(ev);
        break;
      }
      case 'tower': case 'inhib': case 'nexus': {
        const team = 1 - u.team;
        if (u.type === 'nexus') { this.over = true; this.winner = team; this.emit({ type: 'victory', team }); break; }
        for (const h of this.teams[team].heroes) this.giveGold(h, u.type === 'tower' ? GOLD.tower : GOLD.inhib);
        if (u.type === 'tower') this.teams[team].towers++;
        if (u.type === 'inhib') u.respawnAt = now + sec(T.inhibRespawn);
        this.emit({ type: u.type === 'tower' ? 'tower' : 'inhib', team, lane: u.lane, tier: u.tier, x: u.x, y: u.y });
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
  wardSpots(team) { return WARD_SPOTS_BLUE.map((s) => team === BLUE ? s : P(s)); }

  // ───────────────────────── checksum ─────────────────────────
  checksum() {
    let h = 2166136261 >>> 0;
    h = hashInts(h, this.tick, this.units.length, this.projectiles.length, this.rng.state());
    for (const u of this.units) if (u.alive) h = hashInts(h, u.id, r2(u.x), r2(u.y), r2(u.hp));
    for (const t of this.teams) for (const x of t.heroes) h = hashInts(h, r2(x.gold), x.level, x.items.length);
    return h >>> 0;
  }

  // Public summary for UI.
  heroesOf(team) { return this.teams[team].heroes; }
  nearestNodeTo(p) { return nearestNode(p); }
}
