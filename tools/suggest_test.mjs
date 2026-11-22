// Headless audit of every coach prompt: analyst suggestions, Coach's Calls, hero requests and the lane-open
// alert action. Runs AI-vs-AI matches, generates blue's prompts every second exactly as the HUD would,
// keeps each one "on screen" for its lifetime (re-checking its own valid() like the tray does) and asserts
// that no option the player could tap is unaffordable, refused by the sim, or physically impossible:
//   - unaffordable (cost > charges) or refused (sim would reject it)
//   - a named hero dead / recalling / already on another call
//   - a ganker who can't arrive within the window (walking time along the real A* path)
//   - an objective the enemy finishes before our 2nd hero could get there (checked after the fact)
//   - a shrine nobody can reach in time
//   - fog leak: an enemy target that blue can't see
// Usage: node tools/suggest_test.mjs [matches=8] [--verbose]
import { Game } from '../src/sim/game.js';
import { HEROES } from '../src/data/heroes.js';
import { CMD, TICK_RATE, PERMIT } from '../src/sim/constants.js';
import { analystSuggestions } from '../src/ui/suggest.js';
import { coachMoment, heroRequests } from '../src/ui/moments.js';
import { laneOpenSend, WINDOW } from '../src/ui/feasible.js';

const N = +(process.argv.find((a) => /^\d+$/.test(a)) || 8), VERBOSE = process.argv.includes('--verbose');
const pick = (ids) => ids.map((id) => { const h = HEROES.find((x) => x.id === id); return { id, role: h.role, build: h.rec }; });
const COMPS = [
  [['bastion', 'kaze', 'ember', 'fletch', 'oak'], ['kenshi', 'leonin', 'raiden', 'marlowe', 'wu']],
  [['grok', 'umbra', 'totem', 'bolt', 'bonehook'], ['varro', 'gama', 'hex', 'sling', 'aurelia']],
];
const MAPS = [null, 'frost', 'ember', 'marsh', null, 'sakura', 'rush', null];
const ME = 0, SEC = TICK_RATE;
const d2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

// ── independent physical checks (not using feasible.js) ──
function walkSecs(g, h, p) {
  const path = g.world.findPath(h.x, h.y, p.x, p.y); let L = 0, x = h.x, y = h.y;
  for (const q of path) { L += Math.hypot(q.x - x, q.y - y); x = q.x; y = q.y; }
  return L / (h.stats.ms * g.wx.ms * g.rules.heroMs);
}
const recalling = (h) => !!h.recallAt || h.task.kind === 'recall' || h.task.kind === 'heal';
const onCall = (g, h) => !!h.pendingCall || (h.task.call && !(h.task.until <= g.tick));
function refused(g, cmd) {
  const t = g.teams[ME], hero = cmd.hero !== undefined ? g.byId(cmd.hero) : null, alive = t.heroes.filter((h) => h.alive);
  switch (cmd.type) {
    case 'gank': case 'split': return !hero || !hero.alive;
    case 'objective': return !g.objAvailable(cmd.obj);
    case 'shrine': return g.time < g.T.shrineUnlock || !g.shrines.some((s) => s.owner !== ME);
    case 'focus': { const e = g.byId(cmd.target); return !e || !e.alive; }
    case 'invade': { const jg = t.heroes.find((h) => h.role === 'jungle'); return !jg || !jg.alive || !g.camps.some((c) => c.side !== ME && c.mobs.length); }
    case 'herald': return t.heraldEye <= g.tick;
    case 'permit': return !hero || !hero.alive || t.permitCd > g.tick;
    case 'surge': return t.momentum < 100 || t.surgeUntil > g.tick || !alive.length;
    case 'tactic': return !t.deck.some((d) => d.id === cmd.card && !d.used);
    default: return false;
  }
}
// Problems with tapping `cmd` right now (prompt context `p` gives the gank target / window).
function problems(g, cmd, p, late) {
  const out = [], t = g.teams[ME], vis = g.vision[ME];
  if (t.charges + 1e-9 < (CMD.cost[cmd.type] ?? 1)) out.push('unaffordable');
  if (refused(g, cmd)) out.push('refused');
  const hero = cmd.hero !== undefined ? g.byId(cmd.hero) : null;
  if (hero && hero.alive && ['gank', 'split', 'permit'].includes(cmd.type)) {
    if (recalling(hero)) out.push('hero recalling');
    else if (onCall(g, hero) && cmd.type !== 'permit') out.push('hero on another call');
  }
  const foe = cmd.target !== undefined ? g.byId(cmd.target) : p.target;
  if (foe && foe.team !== ME && foe.alive && !vis.has(foe.id)) out.push('fog leak');
  if (cmd.type === 'gank' && hero && hero.alive && foe && foe.alive && walkSecs(g, hero, foe) > (p.window || WINDOW.gank) + 1) out.push('ganker too far');
  if (cmd.type === 'permit' && cmd.kind === 'fight' && hero && foe && d2(hero, foe) > PERMIT.range ** 2) out.push('target out of range');
  if (cmd.type === 'shrine') {
    const sh = g.shrines.find((s) => s.id === cmd.shrine) || g.shrines.find((s) => s.owner !== ME);
    if (sh && !t.heroes.some((h) => h.alive && !recalling(h) && walkSecs(g, h, sh) <= WINDOW.shrine + 2)) out.push('shrine out of reach');
  }
  if (cmd.type === 'objective' && !late.has(p)) {
    const o = g.objectives[cmd.obj];
    if (o && o.alive && o.hp < o.maxHp * 0.95) {
      const ts = t.heroes.filter((h) => h.alive && !recalling(h)).map((h) => walkSecs(g, h, o)).sort((a, b) => a - b);
      late.set(p, { o, at: g.tick + (ts.length >= 2 ? ts[1] : 999) * SEC, cmd }); // judged when we see whether it died first
    }
  }
  return out;
}

const bad = {}, total = { prompts: 0, badPrompts: 0, shownSecs: 0, badSecs: 0 }, bySrc = {};
const note = (src, why, g, p) => { bad[why] = (bad[why] || 0) + 1; if (VERBOSE) console.log(`  ${(g.time / 60).toFixed(1)}m ${src} ${p.key || ''} ${why} ${p.text || ''}`); };

for (let m = 0; m < N; m++) {
  const map = MAPS[m % MAPS.length], comp = COMPS[m % COMPS.length];
  const g = new Game({ seed: 1000 + m * 17, coach: [m % 2 === 0, true], ...(map === 'rush' ? { mode: 'rush', map: 'rush_ember' } : map ? { map } : {}),
    teams: [{ heroes: pick(comp[0]), plan: 'objective' }, { heroes: pick(comp[1]), plan: 'aggro' }] });
  const st = { cool: {}, carding: false }, live = [], seenKeys = new Set(), late = new Map();
  const add = (src, p, ttl) => { if (p.key && seenKeys.has(src + p.key)) return; if (p.key) seenKeys.add(src + p.key); p.src = src; p.until = g.tick + ttl * SEC; p.bad = false; live.push(p); total.prompts++; bySrc[src] = (bySrc[src] || 0) + 1; };
  while (!g.over && g.tick < 20 * 60 * TICK_RATE) {
    g.step([]); g.fx.length = 0;
    if (g.tick % SEC) continue;
    // generate (as the HUD does once a second; calls/requests every second here for coverage)
    for (const s of analystSuggestions(g, ME, st)) add('sug', s, 12);
    if (g.time >= 75) { const c = coachMoment(g, ME); if (c) add('call', c, 8); }
    if (g.time > 120) for (const r of heroRequests(g, ME)) add('req', r, 9);
    for (const [lane, o] of Object.entries(g.teams[ME].laneOpen || {})) {
      const s = laneOpenSend(g, ME, lane, o);
      if (s) add('lane', { key: 'open' + lane + o.since, cmd: s.cmd, text: `${lane} open`, valid: () => !!g.teams[ME].laneOpen[lane] && !!laneOpenSend(g, ME, lane, g.teams[ME].laneOpen[lane]) }, 6);
    }
    // judge everything on screen
    for (let i = live.length - 1; i >= 0; i--) {
      const p = live[i];
      if (g.tick > p.until || (p.valid && !p.valid())) { live.splice(i, 1); continue; }
      total.shownSecs++;
      const opts = p.opts ? p.opts.filter((o) => o.cmd && o.state() === 'go') : p.cmd ? [{ cmd: p.cmd }] : [];
      let b = false;
      for (const o of opts) for (const why of problems(g, o.cmd, p, late)) { b = true; note(p.src, why, g, p); }
      if (b) { total.badSecs++; if (!p.bad) { p.bad = true; total.badPrompts++; } }
    }
    for (const [p, l] of late) if (!l.done && (!l.o.alive || g.tick >= l.at)) {
      l.done = true;
      if (!l.o.alive && g.tick < l.at && g.events.some((e) => e.type === 'objective' && e.team !== ME && e.t > l.at - 40 * SEC)) { note(p.src, 'objective lost before arrival', g, p); if (!p.bad) { p.bad = true; total.badPrompts++; } }
    }
  }
  if (VERBOSE) console.log(`match ${m} (${map || 'sakura'}) done at ${(g.time / 60).toFixed(1)}m`);
}
console.log(`prompts: ${total.prompts} (${Object.entries(bySrc).map(([k, v]) => `${k} ${v}`).join(', ')}) · on-screen prompt-seconds ${total.shownSecs}`);
console.log(`bad prompts: ${total.badPrompts} · bad prompt-seconds: ${total.badSecs}`);
console.log('by problem:', JSON.stringify(bad));
if (total.badPrompts) { console.log('FAIL'); process.exit(1); }
console.log('OK');
