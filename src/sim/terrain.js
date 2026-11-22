// Map terrain that changes on a clock (the two v25 maps; maps without `tide`, `wind` or `pads` never build this):
//   Tide   (Tidebreak Harbor, map def `tide`): the sea rises at 4:00 and 10:00 and ebbs at 7:00 and 13:00, with a
//          20s warning. At high tide the channel and the tidal flats (T_SAND) flood: units wading there move 22%
//          slower (lanes never flood; 30% in Blood Moon week's spring tide). The sandbars (gates 'bar') go under, and the log rafts (gates 'raft') float
//          into place across the channel. Four seconds before a crossing closes, new routes stop using it.
//   Wind   (Skyreach Isles, map def `wind`): the wind bridges (gates 'windA' / 'windB') take turns: one set holds
//          for 50s while the other is down, with a 6s fade the minimap and the bridges themselves show.
//   Pads   (map def `pads`): jump pads launch a hero across the void to the pad on the other side (A* plans them
//          like a walk of their straight line; the flight is a dash that stuns and pulls cannot cancel; 30% faster
//          in Swift Winds week).
// Every state is a pure function of the tick, applied to the shared World at the start of each step (sync), so
// Theater copies, replays and lockstep peers agree. Only + - * / and integer ticks.
import { sec, DT } from './constants.js';
import { dist2 } from './geom.js';

export const TERRAIN = {
  tide: { high: [[240, 420], [600, 780]], warn: 20, avoid: 4, slow: 0.22 },
  wind: { period: 50, warn: 6, avoid: 3 },
  pad: { speed: 620, reach: 44, shield: 0.05, shieldSec: 3, cd: 4 }, // cd: a hero who just landed walks for 4s (no ping-pong)
  // weekly events on these maps (src/data/events.js `maps`): Blood Moon brings a spring tide, Swift Winds faster flights
  bloodTide: 0.3, swiftPad: 1.3,
};
export const tideSlow = (event) => (event === 'bloodmoon' ? TERRAIN.bloodTide : TERRAIN.tide.slow);

export class Terrain {
  constructor(g) {
    this.g = g;
    const W = g.world, d = W.def;
    this.tide = !!d.tide; this.wind = !!d.wind;
    this.mask = 0; this.avoid = 0; this.high = false;
    // which way each gate opens: bars at low tide, rafts at high tide, wind sets by phase
    this.kinds = W.gates.map((w) => w.kind);
  }

  // ── state as a function of time ──
  isHigh(t) { if (!this.tide) return false; for (const [a, b] of TERRAIN.tide.high) if (t >= a && t < b) return true; return false; }
  windPhase(t) { return Math.floor(t / TERRAIN.wind.period) % 2; }
  maskAt(t) {
    let m = 0; const high = this.isHigh(t), ph = this.wind ? this.windPhase(t) : 0;
    this.kinds.forEach((k, i) => {
      const open = k === 'bar' ? !high : k === 'raft' ? high : k === 'windA' ? ph === 0 : k === 'windB' ? ph === 1 : false;
      if (open) m |= 1 << i;
    });
    return m;
  }

  // Put this game's crossings back on the shared World before it steps (Theater copies share the World).
  sync() {
    const W = this.g.world;
    if (W.gateMask !== this.mask) W.setGates(this.mask);
    if ((W.avoidMask || 0) !== this.avoid) W.setAvoid(this.avoid);
  }
  update() {
    const g = this.g, t = g.time, now = g.tick;
    const mask = this.maskAt(t), soon = this.maskAt(t + (this.tide ? TERRAIN.tide.avoid : TERRAIN.wind.avoid));
    const avoid = mask & ~soon;
    if (mask !== this.mask) {
      this.mask = mask; g.world.setGates(mask);
      for (const u of g.units) { u.path = null; u._clearT = null; } // routes planned over the old crossings
    }
    if (avoid !== this.avoid) { this.avoid = avoid; g.world.setAvoid(avoid); for (const u of g.units) if (u.type === 'hero') u.path = null; }
    if (this.tide) {
      const T = TERRAIN.tide, high = this.isHigh(t);
      for (const [a, b] of T.high) {
        if (now === sec(a - T.warn)) g.emit({ type: 'tideSoon', high: true, at: sec(a) });
        else if (now === sec(b - T.warn)) g.emit({ type: 'tideSoon', high: false, at: sec(b) });
      }
      if (high !== this.high) { this.high = high; g.emit({ type: 'tide', high }); }
    }
    if (this.wind) {
      const P = TERRAIN.wind.period, ph = this.windPhase(t);
      if (now > 0 && now % sec(P) === 0) g.emit({ type: 'wind', phase: ph });
    }
  }

  // ── floodwater ──
  // Move-speed multiplier on a unit's cell (game.moveSpeed). Ryujin's blessing wades through it.
  msMult(u) {
    if (!this.high) return 1;
    const W = this.g.world;
    if (!W.flood) this.buildFlood();
    if (!W.flood[W.idx(u.x, u.y)] || u.type === 'objective') return 1;
    if (u.type === 'hero' && this.g.beasts && this.g.beasts.species === 'ryujin' && this.g.beasts.power(u.team) > 0) return 1;
    return 1 - tideSlow(this.g.event);
  }
  // The cells that flood (static per World): the channel's water and the tidal flats, never a lane.
  buildFlood() {
    const W = this.g.world, f = new Uint8Array(W.type.length);
    for (let i = 0; i < f.length; i++) { const t = W.type[i]; f[i] = t === 3 || t === 9 ? 1 : 0; } // T_RIVER, T_SAND
    W.flood = f;
  }

  // ── jump pads ──
  // moveToward: a hero standing on a pad whose next waypoint is its landing takes off. Returns true when it did.
  launch(h, step) {
    const g = this.g, pd = g.world.pads[step.land]; if (!pd || h.type !== 'hero') return false;
    const from = step.dir ? pd.b : pd.a, to = step.dir ? pd.a : pd.b;
    if (dist2(h, from) > TERRAIN.pad.reach ** 2) return false;
    const sp = TERRAIN.pad.speed * (g.event === 'swift' ? TERRAIN.swiftPad : 1), ticks = Math.ceil(pd.len / sp / DT);
    h.dash = { x: to.x, y: to.y, speed: sp, until: g.tick + ticks + 4, pulled: true, pad: 1, from: { x: h.x, y: h.y }, t0: g.tick, t1: g.tick + ticks, arrive: { k: 'pad', pad: pd.id } };
    h.recallAt = 0; h.vx = h.vy = 0;
    g.fx.push({ kind: 'pad', id: h.id, team: h.team, x: h.x, y: h.y, tx: to.x, ty: to.y });
    return true;
  }
  // game.dashArrive for a pad flight: the landing (Updraft: a shield per blessing).
  land(h) {
    const g = this.g;
    g.fx.push({ kind: 'padLand', id: h.id, team: h.team, x: h.x, y: h.y });
    h.padCd = g.tick + sec(TERRAIN.pad.cd); h.path = null;
    if (g.beasts && g.beasts.species === 'nimbus') {
      const p = g.beasts.power(h.team);
      if (p) g.addShield(h, h.maxHp * TERRAIN.pad.shield * p, TERRAIN.pad.shieldSec, h);
    }
  }
}
