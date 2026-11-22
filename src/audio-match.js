// Match audio director: turns the sim's cosmetic fx hints and UI events into sound, and steers the dynamic music.
// Read-only on the game (never touches sim state or its Rng). Driven from main.js:
//   attach(game, renderer, runner, myTeam)  at match start      consume()  after every sim tick (before the renderer clears fx)
//   frame()                                  every drawn frame   detach()   when the match is torn down
//
// Music states: calm (laning) → tension (a fight, or a contested objective) → back to calm once it has been quiet a
// while; Last Stand switches to its own track for the rest of the match. Aces duck the music under a stinger and
// release it into a swell; victory / defeat cut to a stinger. Halftime, a paused game and slow-motion muffle it.
// Mixing: sounds are panned toward their side of the screen and quieter off-screen; your team's sounds get a higher
// voice priority; nothing in the fog makes a sound (no information leaks). Reduced effects: no minion pops, coin
// ticks or music swell, and fewer hit layers.
import { audio } from './audio.js';
import { settings } from './ui/settings.js';

const CLAN = { iron: ['iron1', 'iron2'], beast: ['beast1', 'beast2'], shinobi: ['shin1', 'shin2'], spirit: ['spir1', 'spir2'], wild: ['wild1', 'wild2'], hearth: ['hearth1', 'hearth2'] };
// v24 map music packs: [laning theme, fight theme]. Other maps (Lane Rush) keep the classic calm/calm2 + tension.
const MAP_MUSIC = { sakura: ['map_sakura', 'fight_bright'], frost: ['map_frost', 'fight_cold'], ember: ['map_ember', 'fight_cold'],
  marsh: ['map_marsh', 'fight_dark'], oasis: ['map_oasis', 'fight_bright'], ruins: ['map_ruins', 'fight_dark'] };
export const mapMusic = (mapId) => MAP_MUSIC[mapId] || null;
// Victory theme: the clan with the most heroes on the winning team (2+, ties to the earlier pick), else the classic one.
export function victoryTheme(game, team) {
  const tm = game && game.teams && game.teams[team]; if (!tm) return 'victory';
  const n = {}; let best = null;
  for (const h of tm.heroes) { const c = h.def.clan; n[c] = (n[c] || 0) + 1; if (!best || n[c] > n[best]) best = c; }
  return best && n[best] >= 2 ? 'win_' + best : 'victory';
}
const CLS_RATE = { tank: 0.86, bruiser: 0.94, assassin: 1.08, mage: 1, marksman: 1.04, support: 1.06 };
// ability fx sprite → element layer
const ELEM = { explosion: 'fireball', flame: 'fire', circle_orange: 'fireball', water: 'water1', ice: 'ice', thunder: 'zap', spark: 'zap',
  rock: 'rock', rockspike: 'rock', impact: 'rock', plant: 'plant', shield: 'shield', shield_yellow: 'shield', boost: 'heal' };
const PRELOAD = ['hit_l1', 'hit_l2', 'hit_m1', 'hit_m2', 'hit_h1', 'hit_h2', 'crit', 'minion', 'tshot', 'coin2', 'kill', 'death', 'impact', 'magic', 'boom', 'explosion',
  'roar', 'objective', 'levelup', 'st_ace', 'st_obj', 'st_last', 'st_win', 'st_lose', ...Object.values(CLAN).flat(), ...new Set(Object.values(ELEM))];
const TENSION_IN = 0.6, TENSION_OUT = 0.2, CALM_AFTER = 5, MIN_TENSION = 12, MIN_CALM = 8;

export const matchAudio = {
  g: null, r: null, runner: null, my: -1, evIdx: 0, pid: 0, heat: 0, state: null, calm: 'calm', tensionAt: 0, calmAt: 0, quietFor: 0, contested: false,
  nextScan: 0, lastT: 0, roared: {}, objAt: {}, fight: 'tension',

  attach(game, renderer, runner, myTeam) {
    this.g = game; this.r = renderer; this.runner = runner; this.my = myTeam;
    this.evIdx = game.events.length; this.pid = 0; for (const p of game.projectiles) this.pid = Math.max(this.pid, p.id);
    this.heat = 0; this.state = null; this.tensionAt = 0; this.calmAt = 0; this.quietFor = 0; this.contested = false; this.nextScan = 0; this.lastT = performance.now(); this.roared = {}; this.objAt = {};
    const pack = mapMusic(game.cfg.map);
    this.calm = pack ? pack[0] : Math.random() < 0.5 ? 'calm' : 'calm2'; this.fight = pack ? pack[1] : 'tension';
    audio.preload(PRELOAD);
    this.setState(game.finalPhase ? 'laststand' : 'calm');
  },
  detach() { this.g = this.r = this.runner = null; audio.setMuffle(1); },
  get team() { return this.my < 0 ? -1 : this.my; },
  mine(team) { return this.my < 0 || team === this.my; },
  // pan / attenuation for a world point: centre of the screen is 0, its edges ±0.6, off-screen up to ±0.85 and quieter.
  where(x, y) {
    const r = this.r, s = r.scale || 1, hw = r.W / 2 / s, hh = r.H / 2 / s;
    const dx = (x - r.cam.x) / hw, dy = (y - r.cam.y) / hh, d = Math.max(Math.abs(dx), Math.abs(dy));
    const on = d <= 1.08;
    return { on, pan: Math.max(-0.85, Math.min(0.85, dx * 0.6)), att: on ? 1 : Math.max(0.18, 1.25 - d * 0.35) };
  },
  at(name, x, y, vol, o = {}) { const w = this.where(x, y); return audio.play(name, { ...o, vol: vol * w.att, pan: w.pan, prio: (o.prio ?? 1) + (w.on ? 1 : 0) }); },

  consume() {
    const g = this.g; if (!g) return;
    const r = this.r, rd = !!settings.reducedMotion;
    for (const f of g.fx) {
      const u = f.id ? g.byId(f.id) : null;
      if (u && !r.visible(u) && f.kind !== 'death') continue;
      switch (f.kind) {
        case 'cast': if (u && u.def) this.cast(u, f); break;
        case 'dmg': {
          if (!u) break;
          if (f.hero) {
            const v = f.v, w = v < 90 ? 'l' : v < 220 ? 'm' : 'h', mine = this.mine(u.team) || this.mine(1 - u.team);
            this.at(`hit_${w}${Math.random() < 0.5 ? 1 : 2}`, u.x, u.y, 0.35 + Math.min(0.65, v / 380), { prio: mine ? 1 : 0, throttle: 25 });
            if (f.crit && !rd) this.at('crit', u.x, u.y, 0.7, { throttle: 80 });
            this.heat = Math.min(1, this.heat + 0.03 + Math.min(0.07, v / 3000));
          } else if (u.type === 'tower' && u.team === this.team) this.heat = Math.min(1, this.heat + 0.004);
          else if ((u.type === 'mob' || u.type === 'objective') && this.where(u.x, u.y).on && !rd) this.at(Math.random() < 0.5 ? 'hit_l1' : 'hit_l2', u.x, u.y, 0.22, { prio: 0, throttle: 90 });
          break;
        }
        case 'death': if (f.type === 'minion' && !rd && this.where(f.x, f.y).on && (this.my < 0 || f.team === this.my || r.visiblePoint(f.x, f.y))) this.at('minion', f.x, f.y, 0.35, { prio: 0, throttle: 50 }); break;
        case 'gold': if (u && !rd && this.mine(u.team) && this.where(f.x, f.y).on) this.at('coin2', f.x, f.y, 0.45, { prio: 0, throttle: 110 }); break;
        case 'levelup': if (u && this.mine(u.team)) this.at('levelup', u.x, u.y, 0.5, { throttle: 500 }); break;
        case 'ultUp': if (u && r.visible(u)) this.at('powerup', u.x, u.y, 0.5, { throttle: 400 }); break; // v23: empowered ultimate
        case 'duoUlt': if (r.visiblePoint(f.x, f.y)) this.at('explosion', f.x, f.y, 0.8, { prio: 2, rate: 0.8 }); break;
        case 'shield': if (u && this.where(u.x, u.y).on) this.at('shield', u.x, u.y, 0.4, { throttle: 120 }); break;
        case 'flash': if (r.visiblePoint(f.x, f.y)) this.at('shin1', f.x, f.y, 0.5, { rate: 1.3 }); break;
      }
    }
    // tower shots: new projectiles fired by towers (the sim has no fx for them)
    let pid = this.pid;
    for (const p of g.projectiles) {
      if (p.id <= this.pid) continue;
      pid = Math.max(pid, p.id);
      if (!p.src || p.src.type !== 'tower' || !(this.my < 0 || p.src.team === this.my || r.visiblePoint(p.x, p.y))) continue;
      // a tower shooting a hero is news (louder, heard off-screen too); one shooting minions is on-screen ambience
      const t = p.homing ? g.byId(p.homing) : null, atHero = !!(t && t.type === 'hero');
      if (atHero || this.where(p.x, p.y).on) this.at('tshot', p.x, p.y, atHero ? 0.7 : 0.35, { prio: atHero ? 2 : 0, throttle: 70 });
    }
    this.pid = pid;
    const ev = g.events;
    // (events from a stretch the page spent hidden are stale: skip them rather than play a burst on return)
    for (; this.evIdx < ev.length; this.evIdx++) if (g.tick - ev[this.evIdx].t <= 10) this.event(ev[this.evIdx]);
  },
  cast(u, f) {
    const ab = u.def.abilities && u.def.abilities[f.ab]; if (!ab) return;
    const fam = CLAN[u.def.clan] || CLAN.iron, rate = CLS_RATE[u.def.cls] || 1, mine = this.mine(u.team);
    const vol = (mine ? 0.8 : 0.65) * (f.ult ? 1.25 : 1), prio = (mine ? 1 : 0) + (f.ult ? 2 : 0);
    const heal = ab.heal || ab.shield || ab.kind === 'ally' || ab.kind === 'allynova';
    this.at(fam[f.ab % 2], u.x, u.y, vol * (heal ? 0.6 : 1), { rate: rate * (f.ult ? 0.82 : 1), prio, throttle: 30 });
    let el = heal && !ELEM[ab.fx] ? 'heal' : ELEM[ab.fx];
    if (el === 'water1' && Math.random() < 0.5) el = 'water2';
    if (el) this.at(el, f.x, f.y, vol * 0.8, { prio, throttle: 40, delay: 0.05 });
    if (f.ult) {
      this.at('magic', u.x, u.y, 0.8, { prio: prio + 1, throttle: 200 });
      if (this.where(u.x, u.y).on) audio.duck(0.6, 500);
      this.heat = Math.min(1, this.heat + 0.2);
    }
  },
  event(e) {
    const g = this.g, rd = !!settings.reducedMotion;
    switch (e.type) {
      case 'kill': {
        const v = g.byId(e.victim); if (!v) break;
        const ours = this.my >= 0 && v.team === this.my;
        this.at(ours ? 'death' : 'kill', e.x, e.y, 0.9, { prio: 3, throttle: 0 });
        if (!ours && this.my >= 0 && e.killerTeam === this.my) this.at('gold', e.x, e.y, 0.5, { prio: 2, delay: 0.12, throttle: 0 });
        this.heat = Math.min(1, this.heat + 0.35);
        if (g.teams[v.team].heroes.every((x) => !x.alive)) { // ACE
          audio.play('st_ace', { prio: 5, throttle: 0 }); audio.duck(0.35, 1500, rd ? 1 : 1.3);
          this.heat = 1; this.tensionAt = performance.now();
        } else if (e.shutdown) audio.duck(0.6, 600);
        break;
      }
      case 'objective': {
        const o = this.objPos(e.obj);
        this.at('roar', o.x, o.y, 0.9, { prio: 3, throttle: 0 });
        audio.play('objective', { prio: 3, throttle: 0, delay: 0.25 });
        if (this.mine(e.team) && e.team >= 0) { audio.play('st_obj', { prio: 4, throttle: 0, delay: 0.3 }); audio.duck(0.45, 1300); } else audio.duck(0.6, 900);
        break;
      }
      case 'spawn': { const o = this.objPos(e.obj); this.at('roar', o.x, o.y, 0.6, { throttle: 0, rate: 1.08 }); audio.play('alert', { vol: 0.5 }); break; }
      // Living World: a wall coming down, a parade tamed, the Tengu's warning
      case 'wall': this.at('boom', e.x, e.y, e.kind === 'thicket' ? 0.35 : 0.6, { throttle: 0 }); break;
      case 'tamed': this.at('roar', e.x, e.y, 0.7, { throttle: 0, rate: 1.35 }); break;
      case 'bossSoon': audio.play('alert', { vol: 0.6 }); break;
      case 'tower': case 'inhib':
        this.at('boom', e.x, e.y, e.type === 'inhib' ? 1 : 0.85, { prio: 3, throttle: 0 }); this.at('explosion', e.x, e.y, 0.7, { prio: 3, throttle: 0, delay: 0.08 });
        audio.duck(0.55, e.type === 'inhib' ? 1100 : 700); this.heat = Math.min(1, this.heat + 0.2);
        break;
      case 'heraldDrop': audio.play('roar', { vol: 0.8, prio: 3, rate: 0.92 }); audio.play('explosion', { vol: 0.8, delay: 0.15 }); break;
      case 'shrine': audio.play('powerup', { vol: this.mine(e.team) ? 0.6 : 0.4 }); break;
      case 'surge': if (this.mine(e.team)) audio.play('powerup', { vol: 0.8, prio: 3 }); break;
      case 'tactic': if (this.mine(e.team)) audio.play('powerup', { vol: 0.7, prio: 3 }); break;
      case 'finalPhase': audio.play('st_last', { prio: 5, throttle: 0 }); audio.duck(0.4, 1400); this.setState('laststand'); break;
      case 'victory': {
        const won = this.my < 0 || e.team === this.my;
        this.setState(null, 400);
        audio.play(won ? 'st_win' : 'st_lose', { prio: 6, throttle: 0, delay: 0.3 });
        break;
      }
    }
  },
  objPos(kind) {
    const u = this.g.units.find((x) => x.type === 'objective' && x.kind === kind);
    return u || this.objAt[kind] || this.r.cam;
  },
  setState(s, fadeMs) {
    if (s === this.state) return;
    this.state = s; audio.log('state', s, +this.heat.toFixed(2));
    audio.music(s === 'calm' ? this.calm : s === 'tension' ? this.fight : s, fadeMs ?? (s === 'tension' ? 900 : 2200));
  },

  frame() {
    const g = this.g; if (!g) return;
    const now = performance.now(), dt = Math.min(0.5, (now - this.lastT) / 1000); this.lastT = now;
    const R = this.runner;
    const held = !!(R.ht && !R.htDone) || !!R.paused;
    const slow = (R.slow || 1) < 1 || !!(this.r.visSlow && now < this.r.visSlow.until);
    audio.setMuffle(held ? 0.16 : slow ? 0.45 : 1);
    if (g.over || held) return;
    this.heat *= Math.exp(-dt * (R.speed || 1) / 5);
    if (now >= this.nextScan) { this.nextScan = now + 500; this.contested = this.scanObjectives(); }
    if (this.state === 'laststand' || this.state === null) return;
    // calm → tension; right after a fight ends it takes a bigger one (or a contested objective) to flip straight back
    const hot = this.contested || this.heat > (now - this.calmAt < MIN_CALM * 1000 ? 0.85 : TENSION_IN);
    if (this.state === 'calm') { if (hot) { this.tensionAt = now; this.quietFor = 0; this.setState('tension'); } return; }
    // tension: back to calm once it has been quiet for a while (and the track has had time to land)
    this.quietFor = this.heat < TENSION_OUT && !this.contested ? this.quietFor + dt : 0;
    if (this.quietFor > CALM_AFTER && now - this.tensionAt > MIN_TENSION * 1000) { this.calmAt = now; this.setState('calm'); }
  },
  // An epic monster being fought with heroes of both teams nearby. Fogged enemies do not count (no info leak).
  scanObjectives() {
    const g = this.g;
    for (const o of g.units) {
      if (o.type !== 'objective' || !o.alive) continue;
      this.objAt[o.kind] = { x: o.x, y: o.y };
      if (o.hp >= o.maxHp * 0.97) continue;
      const n = [0, 0];
      for (const t of g.teams) for (const x of t.heroes) if (x.alive && (x.x - o.x) ** 2 + (x.y - o.y) ** 2 < 700 * 700 && this.r.visible(x)) n[x.team]++;
      if (n[0] && n[1]) {
        if (!this.roared[o.id]) { this.roared[o.id] = 1; this.at('roar', o.x, o.y, 0.7, { throttle: 0, rate: 0.95 }); }
        return true;
      }
    }
    return false;
  },
};
