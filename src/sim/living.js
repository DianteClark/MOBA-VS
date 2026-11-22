// Living World (classic 5v5 maps, cfg.living): a battlefield that changes as the match goes on.
//   Night       6:00-9:00 (20s dusk / dawn fades): hero, minion and summon sight shrinks (wards, towers and
//               shrines keep theirs), and two Moon Spirit camps wake in the river. Their big spirit pays well
//               and grants Moonsight: the team sees through the dark for 90s. Blood Moon week: darker
//               nights, richer spirits. Weather stacks with the dark (never below half sight).
//   Yokai Parade a wandering band (lantern leader + two followers) that loops river > Blue jungle > river >
//               Red jungle from 4:00. It fights back and leashes like a pit boss around where it was engaged.
//               Killing the leader tames the parade: it marches down the enemy's weakest lane for 60s.
//   Walls       breakable walls and thickets (map defs `walls`) close shortcuts through the forest. Junglers
//               break the ones in their way (a few hits); thickets wilt at nightfall (into tall grass) and
//               every wall still standing crumbles when the Tengu lands.
//   Tengu       the World Boss lands in the map centre at 12:00. Its slayers get Tengu's Gale for 90s
//               (empowered minion waves, +40% structure damage, +6% speed): a stalemate breaker.
// Deterministic: only + - * / sqrt, the game's rng, and tick-based timers. Without cfg.living none of this
// exists and the classic match is bit-identical.
import { DT, sec, NEUTRAL, BLUE } from './constants.js';
import { dist2 } from './geom.js';

export const LIVING = {
  dusk: 360, dawn: 540, fade: 20,
  nightVision: 0.75, bloodVision: 0.68, minVision: 0.5,
  moonsight: 90, moonGold: [160, 30], moonXp: [200, 40], bloodMoonGold: 1.5,
  yokaiFirst: 240, yokaiRespawn: 150, tameSec: 60, paradeMs: 60,
  breachFrom: 150, wallHits: { wall: 10, thicket: 5 },
  bossAt: 720, bossWarn: 30, bossBuff: 90, bossSiege: 0.4, bossMs: 0.06,
};
const NIGHT = { name: 'Moon Spirits', night: true, mobs: [{ k: 'camp_moon', hp: 1900, ad: 50, big: true }, { k: 'camp_wisp', hp: 520, ad: 18, dx: 34, dy: -14 }, { k: 'camp_wisp', hp: 520, ad: 18, dx: -30, dy: 22 }] };
const FOLLOW = [{ k: 'yokai_skull', dx: -34, dy: 26 }, { k: 'yokai_kappa', dx: 34, dy: 26 }];
const P = (p) => ({ x: 2400 - p.x, y: 2400 - p.y });

export class Living {
  constructor(g) {
    this.g = g;
    const W = g.world, d = W.def;
    this.mask = 0; this.nightK = 0; this.quake = false;
    // walls: ends = the open ground at both sides (where a hero stands to break it)
    this.walls = W.walls.map((w) => ({ id: w.id, kind: w.kind, x: w.x, y: w.y, hp: LIVING.wallHits[w.kind] || 8, max: LIVING.wallHits[w.kind] || 8,
      ends: [W.nearestOpen(w.a), W.nearestOpen(w.b)], open: false }));
    // walking distance (in cells, walls closed) from both ends of every wall: static, so kept on the shared World
    if (!W.wallField) W.wallField = this.walls.map((w) => w.ends.map((e) => bfs(W, W.idx(e.x, e.y))));
    // Moon Spirits: two river camps, mirrored (the top one counts as Blue's side for jungle routing)
    const m = d.moon ? { x: d.moon[0], y: d.moon[1] } : { x: 700, y: 700 };
    for (const [side, p] of [[BLUE, W.nearestOpen(m)], [1 - BLUE, W.nearestOpen(P(m))]])
      g.camps.push({ def: { ...NIGHT, id: 'moon' }, side, x: p.x, y: p.y, mobs: [], respawnAt: 0, key: `${side}:moon`, ph: 40 + side, night: true });
    // Yokai Parade loop: top river > Blue jungle > bottom river > Red jungle (point-symmetric, so a seeded start keeps it fair)
    const k = W.pits.kraken, r1 = W.nearestOpen({ x: (k.x + 1200) / 2, y: (k.y + 1200) / 2 }), y = d.yokai ? { x: d.yokai[0], y: d.yokai[1] } : { x: 700, y: 1100 };
    this.route = [r1, W.nearestOpen(y), W.nearestOpen(P(r1)), W.nearestOpen(P(y))];
    this.leg = (g.cfg.seed & 1) * 2; // starting waypoint: top or bottom river
    this.parade = []; this.tamed = [];
    this.bossSpot = W.nearestOpen({ x: 1200, y: 1200 });
    g.objectives.yokai = null; g.objectives.boss = null;
    g.objTimers.yokai = sec(LIVING.yokaiFirst); g.objTimers.boss = sec(LIVING.bossAt);
    for (const t of g.teams) { t.moonUntil = 0; t.tenguUntil = 0; }
  }

  // Walls live on the shared World: put them back to this game's state before it steps (the Replay Theater and
  // the instant replay run other copies of the same match on the same World).
  sync() { if (this.g.world.wallMask !== this.mask) this.g.world.setWalls(this.mask); }
  setMask(mask) {
    if (mask === this.mask) return;
    this.mask = mask; this.g.world.setWalls(mask);
    for (const u of this.g.units) { u.path = null; u._clearT = null; } // routes planned around the old walls
  }
  openWall(w, team) {
    if (w.open) return;
    w.open = true; w.hp = 0;
    this.setMask(this.mask | (1 << w.id));
    this.g.emit({ type: 'wall', wall: w.id, kind: w.kind, team, x: w.x, y: w.y });
  }

  get night() { return this.nightK > 0; }
  // Sight multiplier for a team's heroes / minions / summons (1 by day; Moonsight ignores the dark).
  visMult(team) {
    const k = this.nightK; if (!k || this.g.teams[team].moonUntil > this.g.tick) return 1;
    const g = this.g, nv = g.event === 'bloodmoon' ? LIVING.bloodVision : LIVING.nightVision;
    const floor = LIVING.minVision / (g.wx.vision * g.rules.vision);
    return Math.min(1, Math.max(1 - (1 - nv) * k, floor));
  }

  update() {
    const g = this.g, now = g.tick, t = g.time, L = LIVING;
    // night: fades in from dusk, out from dawn
    const kin = Math.min(1, Math.max(0, (t - L.dusk) / L.fade)), kout = Math.min(1, Math.max(0, (L.dawn + L.fade - t) / L.fade));
    this.nightK = t >= L.dusk && t < L.dawn + L.fade ? Math.min(kin, kout) : 0;
    if (now === sec(L.dusk)) this.dusk();
    if (now === sec(L.dawn)) this.dawn();
    if (now === sec(L.bossAt - L.bossWarn)) g.emit({ type: 'bossSoon', x: this.bossSpot.x, y: this.bossSpot.y });
    if (!g.objectives.boss && g.objTimers.boss && now >= g.objTimers.boss) this.spawnBoss();
    if (!g.objectives.yokai && g.objTimers.yokai && now >= g.objTimers.yokai) this.spawnParade();
    this.updateParade();
    if (this.tamed.length) {
      for (const u of this.tamed) if (u.alive && now >= u.expireAt) { u.alive = false; g.fx.push({ kind: 'death', id: u.id, x: u.x, y: u.y, type: u.type, team: u.team }); }
      if (this.tamed.every((u) => !u.alive)) { g.emit({ type: 'tameEnd', team: this.tamed[0].team }); this.tamed = []; }
    }
  }

  // ───────── night ─────────
  dusk() {
    const g = this.g, gm = g.gameMinute;
    for (const c of g.camps) if (c.night && !c.mobs.length) {
      const k = 1 + gm * 0.07;
      for (const [i, m] of c.def.mobs.entries()) {
        const dx = (m.dx || 0) * (c.side ? -1 : 1), dy = (m.dy || 0) * (c.side ? -1 : 1);
        c.mobs.push(g.addUnit({ type: 'mob', kind: m.k, camp: c.key, team: NEUTRAL, ph: c.ph * 8 + i, x: c.x + dx, y: c.y + dy, home: { x: c.x + dx, y: c.y + dy },
          maxHp: m.hp * k, hp: m.hp * k, radius: m.big ? 16 : 10, big: !!m.big, buff: null, moon: !!m.big,
          gold: (m.big ? LIVING.moonGold[0] : LIVING.moonGold[1]) * (g.event === 'bloodmoon' ? LIVING.bloodMoonGold : 1), xpv: m.big ? LIVING.moonXp[0] : LIVING.moonXp[1],
          stats: { ad: m.ad * k * 0.6, ap: 0, armor: 14, mr: 14, as: 0.8, range: 50, ms: 90, pen: 0 } }));
      }
    }
    for (const w of this.walls) if (w.kind === 'thicket') this.openWall(w, -1); // the thickets wilt into tall grass
    g.emit({ type: 'dusk' });
  }
  dawn() {
    const g = this.g;
    for (const c of g.camps) if (c.night) { for (const m of c.mobs) if (m.alive) { m.alive = false; g.fx.push({ kind: 'death', id: m.id, x: m.x, y: m.y, type: m.type, team: m.team }); } c.mobs = []; }
    g.emit({ type: 'dawn' });
  }
  // A Moon Spirit fell (game.kill, mob case): Moonsight for the hero's team.
  onMob(u, h) {
    if (!u.moon || !h) return;
    const g = this.g, tm = g.teams[h.team];
    tm.moonUntil = g.tick + sec(LIVING.moonsight);
    g.emit({ type: 'moonsight', team: h.team, hero: h.id, x: u.x, y: u.y });
  }

  // ───────── Yokai Parade ─────────
  spawnParade() {
    const g = this.g, gm = g.gameMinute;
    for (const f of this.parade) if (f.alive) f.alive = false;
    const at = this.route[this.leg % 4];
    const hp = 2800 + gm * 160;
    const lead = g.addUnit({ type: 'objective', kind: 'yokai', team: NEUTRAL, x: at.x, y: at.y, home: { x: at.x, y: at.y },
      maxHp: hp, hp, radius: 18, big: true, parade: true, stats: { ad: 55 + gm * 4, ap: 0, armor: 30, mr: 30, as: 0.8, range: 70, ms: LIVING.paradeMs, pen: 0 } });
    this.parade = FOLLOW.map((f, i) => g.addUnit({ type: 'mob', kind: f.k, team: NEUTRAL, ph: lead.id * 4 + i, x: at.x + f.dx, y: at.y + f.dy, home: { x: at.x + f.dx, y: at.y + f.dy }, off: f,
      maxHp: 900 + gm * 50, hp: 900 + gm * 50, radius: 12, big: false, parade: true, gold: 45, xpv: 70,
      stats: { ad: 28 + gm * 2, ap: 0, armor: 20, mr: 20, as: 0.8, range: 55, ms: LIVING.paradeMs + 30, pen: 0 } }));
    g.objectives.yokai = lead; g.objTimers.yokai = 0;
    this.leg = (this.leg + 1) % 4;
    g.emit({ type: 'spawn', obj: 'yokai', x: at.x, y: at.y });
  }
  updateParade() {
    const g = this.g, lead = g.objectives.yokai, now = g.tick;
    if (!lead || !lead.alive) return;
    const band = [lead, ...this.parade.filter((f) => f.alive)];
    // one band: whoever fights, the whole parade joins in
    let lc = -999; for (const u of band) if (u.lastCombat > lc) lc = u.lastCombat;
    for (const u of band) u.lastCombat = lc;
    const calm = !lead.target && !lead.resetting && now - lc > sec(3) && lead.hp >= lead.maxHp;
    if (calm) {
      const wp = this.route[this.leg];
      if (dist2(lead, wp) < 40 * 40) this.leg = (this.leg + 1) % 4;
      g.moveToward(lead, this.route[this.leg], true);
      lead.home = { x: lead.x, y: lead.y };
    }
    // followers keep formation behind the leader (their leash home walks with it)
    for (const f of this.parade) if (f.alive && !f.target && !f.resetting) f.home = { x: lead.home.x + f.off.dx, y: lead.home.y + f.off.dy };
  }
  // Tamed: the band marches down the enemy's weakest lane for the team that slew the leader.
  tame(u, team) {
    const g = this.g, W = g.world, gm = g.gameMinute;
    for (const f of this.parade) if (f.alive) { f.alive = false; g.fx.push({ kind: 'death', id: f.id, x: f.x, y: f.y, type: f.type, team: f.team }); }
    this.parade = [];
    const lane = this.weakestLane(1 - team);
    // join the lane at our wave front (at least a third of the way, at most three quarters)
    let prog = 0.35;
    for (const m of g.units) if (m.alive && m.team === team && m.type === 'minion' && m.lane === lane) { const p = W.laneProgress(lane, m), mine = team === BLUE ? p : 1 - p; if (mine > prog) prog = mine; }
    prog = Math.min(0.75, prog);
    const meet = W.nearestOpen(W.lanePoint(lane, team === BLUE ? prog : 1 - prog));
    const hp = 1500 + gm * 70;
    this.tamed = [{ k: 'yokai_lantern', dx: 0, dy: 0 }, ...FOLLOW].map((f, i) => g.addUnit({ type: 'summon', kind: 'yokai', look: f.k, team, lane, x: u.x + f.dx * 0.6, y: u.y + f.dy * 0.6,
      wp: 0, returning: { x: meet.x + f.dx * 0.5, y: meet.y + f.dy * 0.5 }, ph: u.id * 4 + i,
      maxHp: hp * (i ? 0.7 : 1), hp: hp * (i ? 0.7 : 1), radius: i ? 12 : 16, expireAt: g.tick + sec(LIVING.tameSec),
      stats: { ad: (i ? 45 : 70) + gm * 3, ap: 0, armor: 30, mr: 30, as: 0.8, range: 60, ms: 80, pen: 0 } }));
    g.objTimers.yokai = g.tick + sec(LIVING.yokaiRespawn);
    g.emit({ type: 'tamed', team, lane, x: u.x, y: u.y });
  }
  // The lane where a team has the fewest towers standing (ties: least tower HP left there).
  weakestLane(team) {
    const g = this.g; let best = 'mid', bn = Infinity, bh = Infinity;
    for (const ln of g.world.laneNames) {
      let n = 0, hp = 0;
      for (const s of g.units) if (s.alive && s.team === team && s.lane === ln && (s.type === 'tower' || s.type === 'inhib')) { n++; hp += s.hp; }
      if (n < bn || (n === bn && hp < bh)) { bn = n; bh = hp; best = ln; }
    }
    return best;
  }

  // ───────── Tengu (World Boss) ─────────
  spawnBoss() {
    const g = this.g, gm = g.gameMinute, p = this.bossSpot;
    const first = !this.quake;
    const hp = 15000 + Math.max(0, gm - 12) * 600;
    g.objectives.boss = g.addUnit({ type: 'objective', kind: 'boss', team: NEUTRAL, x: p.x, y: p.y, home: { ...p },
      maxHp: hp, hp, radius: 34, big: true, boss: true, slam: 0, stats: { ad: 190 + gm * 5, ap: 0, armor: 70, mr: 70, as: 0.75, range: 220, ms: 0, pen: 0 } });
    g.objTimers.boss = 0;
    g.emit({ type: 'spawn', obj: 'boss', x: p.x, y: p.y, first });
    if (first) {
      // the landing shakes the forest: every wall still standing crumbles
      this.quake = true;
      for (const w of this.walls) if (!w.open) this.openWall(w, -1);
    }
  }
  // game.kill, objective case (yokai / boss), after the shared objective rewards.
  onObjective(u, team) {
    const g = this.g, tm = g.teams[team];
    if (u.kind === 'yokai') { this.tame(u, team); return; }
    if (u.kind === 'boss') {
      tm.tenguUntil = g.tick + sec(LIVING.bossBuff);
      for (const h of tm.heroes) if (h.alive) g.addBuff(h, { siegePct: LIVING.bossSiege, msPct: LIVING.bossMs }, LIVING.bossBuff, 'tengu');
    }
  }
  objPit(o) {
    if (o === 'boss') return this.bossSpot;
    const y = this.g.objectives.yokai;
    return y && y.alive ? y.home : this.route[this.leg % 4];
  }

  // ───────── breakable walls (AI) ─────────
  // A hero walking to `goal` stands at one end of a closed wall with the goal past the other end: break it.
  // Returns true when the hero spent this tick on the wall.
  breach(h, goal) {
    const g = this.g;
    if (g.time < LIVING.breachFrom || this.mask === (1 << this.walls.length) - 1) return false;
    if (g.tick - h.lastHurtByHero < sec(4) || g.tick - h.lastHitHero < sec(4) || h.recallAt) return false; // never mid-fight
    for (const w of this.walls) {
      if (w.open) continue;
      for (let e = 0; e < 2; e++) {
        const here = w.ends[e], there = w.ends[1 - e];
        if (dist2(h, here) > 150 * 150) continue;
        // worth it only when the way through saves a real detour (> 10 cells, about 240px)
        const F = g.world.wallField[w.id], gi = g.world.idx(goal.x, goal.y), around = F[e][gi], through = F[1 - e][gi];
        if (around < 0 || through < 0 || around - through - Math.sqrt(dist2(here, there)) / 24 < 10) continue;
        h.why = w.kind === 'thicket' ? 'cut through the thicket' : 'break the wall';
        if (dist2(h, here) > 30 * 30) { g.moveToward(h, here, true); return true; }
        h.vx = h.vy = 0;
        this.hitWall(h, w);
        return true;
      }
    }
    return false;
  }
  // A jungler with time to spare opens the nearest closed wall in its own half (an end within ~500px).
  idleBreach(h) {
    const g = this.g, own = (p) => (h.team === BLUE ? p.y - p.x : p.x - p.y) > 0;
    let best = null, bd = 500 * 500;
    for (const w of this.walls) {
      if (w.open || !own(w)) continue;
      for (const e of w.ends) { const d = dist2(h, e); if (d < bd) { bd = d; best = w; } }
    }
    if (!best) return false;
    const far = dist2(h, best.ends[0]) < dist2(h, best.ends[1]) ? best.ends[1] : best.ends[0];
    return this.breach(h, far);
  }
  hitWall(h, w) {
    const g = this.g, now = g.tick;
    if (now < h.attackCd) return;
    h.attackCd = now + Math.round(1 / h.stats.as / DT); h.animAttack = now;
    g.face(h, w.x - h.x, w.y - h.y);
    w.hp--;
    g.fx.push({ kind: 'wallHit', wall: w.id, x: w.x, y: w.y });
    if (w.hp <= 0) this.openWall(w, h.team);
  }
}
// 4-neighbour walking distance in cells from one cell (-1 = unreachable).
function bfs(W, start) {
  const N = 100, d = new Int16Array(N * N).fill(-1), q = new Int32Array(N * N); let qh = 0, qt = 0;
  d[start] = 0; q[qt++] = start;
  while (qh < qt) {
    const c = q[qh++], x = c % N, y = (c / N) | 0, nd = d[c] + 1;
    if (x > 0 && W.walk[c - 1] && d[c - 1] < 0) { d[c - 1] = nd; q[qt++] = c - 1; }
    if (x < N - 1 && W.walk[c + 1] && d[c + 1] < 0) { d[c + 1] = nd; q[qt++] = c + 1; }
    if (y > 0 && W.walk[c - N] && d[c - N] < 0) { d[c - N] = nd; q[qt++] = c - N; }
    if (y < N - 1 && W.walk[c + N] && d[c + N] < 0) { d[c + N] = nd; q[qt++] = c + N; }
  }
  return d;
}
