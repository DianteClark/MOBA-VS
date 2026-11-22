// Story campaign + tutorial, headless:
//   * every mission's data is valid (rival, map, lineups that fill the five roles, goals, sanitized rules)
//   * every mission plays to the end with its rules (cfg.mission), deterministically (two runs, same checksums)
//   * a mission without rules is bit-identical to a plain match (cfg.mission gating)
//   * the goals and stars read from the finished game; a loss never earns a star; Koban only for new stars
//   * the tutorial's timeline: early Kami (+ the scripted enemy Kami call), Oni, Kraken and Elder all happen
//   node tools/campaign_test.mjs            all checks; one mission per chapter played out (the Lane Rush chapter's boss too)
//   node tools/campaign_test.mjs --all      every mission played out (slow: a full match each, twice)
//   node tools/campaign_test.mjs --odds N   also N seeds per mission with a Normal AI coach on your side (difficulty curve)
import { Game } from '../src/sim/game.js';
import { HERO_BY_ID } from '../src/data/heroes.js';
import { RIVAL_BY_ID } from '../src/data/rivals.js';
import { MAP_BY_ID, RUSH_MAPS } from '../src/maps/defs.js';
import { EVENT_BY_ID } from '../src/data/events.js';
import { Rng } from '../src/sim/rng.js';
import { newDraft, currentTurn, apply, autoChoice, aiPrep, assignRoles, defaultPrep } from '../src/sim/draft.js';
import { cleanMission } from '../src/sim/mission.js';
import { sec } from '../src/sim/constants.js';
import { MISSIONS, CHAPTERS, TUTORIAL, missionOutcome, starKoban, starsOf, goalText, missionDraft } from '../src/data/campaign.js';
import { PLAN_IDS } from '../src/sim/plans.js';

let fails = 0;
const fail = (m) => { fails++; console.log('FAIL', m); };
const args = process.argv.slice(2), oddsN = args.includes('--odds') ? +args[args.indexOf('--odds') + 1] || 4 : 0;

// The lineups a mission plays with (the app: missionDraft for a squad, else the normal draft vs the rival).
function lineups(m, seed) {
  const rng = new Rng(seed ^ 0x5eed);
  if (m.squad) return missionDraft(m, rng).picks;
  const d = newDraft();
  while (!d.done) { const t = currentTurn(d); apply(d, t.team, autoChoice(d, t.team, rng, 1)); }
  return d.picks;
}
const MODE = (m) => (m.mode === 'rush' ? { mode: 'rush', beasts: 1 } : { living: 1, beasts: 1, depth: true });
function cfgOf(m, seed, blueAI = 1) {
  const [a, b] = lineups(m, seed), rv = RIVAL_BY_ID[m.rival] || RIVAL_BY_ID.goro;
  const pa = m.squad ? defaultPrep(a) : aiPrep(a, b, m.mode), pb = aiPrep(b, a, m.mode);
  if (m.squad) pa.heroes.forEach((x, i) => { x.role = ['top', 'jungle', 'mid', 'bot', 'support'][i]; });
  if (m.plan) pa.plan = m.plan;
  return { seed, map: m.map, ...MODE(m), ...(m.event ? { event: m.event } : {}),
    teams: [{ heroes: pa.heroes, plan: pa.plan, deck: pa.deck, name: 'You' }, { heroes: pb.heroes, plan: pb.plan, deck: pb.deck, name: rv.name }],
    coach: [blueAI !== null, true], coachLevel: [blueAI ?? 1, m.lvl], coachStyle: [null, { moment: rv.moment || '', backup: rv.plans[1] }],
    ...(m.rules && cleanMission(m.rules) ? { mission: m.rules } : {}) };
}
function run(cfg, maxTick = 20 * 60 * 16) {
  const g = new Game(cfg), sums = [];
  while (!g.over && g.tick < maxTick) { g.step([]); g.fx.length = 0; if (g.tick % 400 === 0) sums.push(g.checksum()); }
  return { g, sums };
}

// ── data ──
const ids = new Set();
for (const m of MISSIONS) {
  if (ids.has(m.id)) fail(`${m.id}: duplicate id`); ids.add(m.id);
  if (!RIVAL_BY_ID[m.rival] && m.rival !== 'nemesis') fail(`${m.id}: unknown rival ${m.rival}`);
  const rush = m.mode === 'rush';
  if (rush ? !RUSH_MAPS.some((x) => x.id === m.map) : !MAP_BY_ID[m.map] || MAP_BY_ID[m.map].single) fail(`${m.id}: bad map ${m.map}`);
  if (m.event && (!EVENT_BY_ID[m.event] || rush)) fail(`${m.id}: bad event ${m.event}`);
  if (m.squad && (m.squad.length !== 5 || !m.squad.every((id) => HERO_BY_ID[id]) || !assignRoles(m.squad))) fail(`${m.id}: squad does not fill five roles`);
  if (m.squad) m.squad.forEach((id, i) => { if (!HERO_BY_ID[id].roles.includes(['top', 'jungle', 'mid', 'bot', 'support'][i])) fail(`${m.id}: ${id} is not a ${i}`); });
  if (m.foe && (!m.squad || m.foe.some((id) => m.squad.includes(id)))) fail(`${m.id}: foe needs a squad and no shared hero`);
  if (m.plan && !PLAN_IDS.includes(m.plan)) fail(`${m.id}: bad plan`);
  if (m.plan === 'split' && rush) fail(`${m.id}: no Split Push in Lane Rush`);
  if (m.goals.length !== 3 || m.goals[0].k !== 'win') fail(`${m.id}: goals must be [win, bonus, bonus]`);
  for (const gl of m.goals) if (goalText(gl) === gl.k) fail(`${m.id}: unknown goal ${gl.k}`);
  if (m.rules && Object.keys(m.rules).length && !cleanMission(m.rules)) fail(`${m.id}: rules sanitize to nothing`);
  if (m.rules && cleanMission(m.rules) && JSON.stringify(cleanMission(m.rules)) !== JSON.stringify(cleanMission(JSON.parse(JSON.stringify(cleanMission(m.rules)))))) fail(`${m.id}: rules are not stable under cleanMission`);
}
for (const c of CHAPTERS) {
  const ms = MISSIONS.filter((m) => m.ch === c.n);
  if (ms.length !== 5) fail(`chapter ${c.n}: ${ms.length} missions`);
  const boss = ms.filter((m) => m.boss);
  if (boss.length !== 1 || boss[0] !== ms[4] || boss[0].rival !== c.boss) fail(`chapter ${c.n}: the boss (${c.boss}) must close the chapter`);
  for (const p of [...c.intro, ...c.outro]) if (!HERO_BY_ID[p.a] || (p.b && !HERO_BY_ID[p.b])) fail(`chapter ${c.n}: panel hero`);
}
console.log(`data: ${MISSIONS.length} missions in ${CHAPTERS.length} chapters`);

// ── sanitizer ──
const dirty = cleanMission({ kami: [5, 9999, 'x', 100, 200, 300], len: 50, mods: [[2, 'all', 1, 1], [0, 'bot', -9, 0.2], [1, 'wizard', 0, 0]], gold: [99999, -9999], script: [[10, 1, { type: 'tactic', card: 'council' }], [20, 0, { type: 'objective', obj: 'dragon', x: 1 }]], charges: 99 });
const want = { kami: [20, 640, 100], len: 180, charges: 3, mods: [[0, 'bot', -0.5, 0.2]], gold: [2000, -500], script: [[20, 0, { type: 'objective', obj: 'dragon' }]] };
if (JSON.stringify(dirty) !== JSON.stringify(want)) fail('cleanMission: ' + JSON.stringify(dirty));
if (cleanMission({}) !== null || cleanMission(null) !== null) fail('cleanMission: empty must be null');

// ── gating: empty rules = plain match ──
{
  const base = cfgOf({ ...MISSIONS[0], rules: {} }, 4242), a = run(base, 20 * 120), b = run({ ...base, mission: { bogus: 1 } }, 20 * 120);
  if (a.sums.join() !== b.sums.join()) fail('a mission with no valid rules changed the match');
  else console.log('gating: rule-less mission is bit-identical to a plain match');
}

// ── every mission: plays out, deterministic, goals evaluate ──
const t0 = Date.now();
const PLAY = args.includes('--all') ? MISSIONS : MISSIONS.filter((m, i) => i % 5 === 0 || m.id === 'c4m5' || m.rival === 'nemesis');
for (const m0 of PLAY) {
  const m = m0.rival === 'nemesis' ? { ...m0, rival: 'goro' } : m0;
  const seed = 1000 + MISSIONS.indexOf(m0) * 17, cfg = cfgOf(m, seed);
  const a = run(JSON.parse(JSON.stringify(cfg))), b = run(JSON.parse(JSON.stringify(cfg)));
  if (a.sums.join() !== b.sums.join() || a.g.winner !== b.g.winner) fail(`${m.id}: not deterministic`);
  if (!a.g.over) fail(`${m.id}: did not finish`);
  const r = cfg.mission ? cleanMission(cfg.mission) : null;
  if (r && r.len && Math.abs(a.g.time - r.len) > 1 && a.g.events.some((e) => e.type === 'victory' && e.timeout)) fail(`${m.id}: clock did not follow len`);
  const out = missionOutcome(m, a.g, 0), lost = missionOutcome(m, a.g, 1);
  if (!out.won && out.stars) fail(`${m.id}: stars on a loss`);
  if (out.won && !(out.mask & 1)) fail(`${m.id}: a win is not a star`);
  if (lost.won === out.won) fail(`${m.id}: both sides won`);
  console.log(`${m.id} ${m.title.padEnd(20)} ${a.g.winner === 0 ? 'WIN ' : 'loss'} ${(a.g.time / 60).toFixed(1)}m  ${'*'.repeat(out.stars).padEnd(3)} ${out.goals.map((x) => (x.done ? '+' : '-') + x.text).join(' | ')}`);
}
console.log(`missions played in ${((Date.now() - t0) / 1000).toFixed(0)}s`);

// ── stars and Koban ──
{
  const m = MISSIONS[0], boss = MISSIONS.find((x) => x.boss);
  if (starKoban(m, 0, 0b111) !== 150 || starKoban(m, 0b001, 0b011) !== 40 || starKoban(m, 0b111, 0b111) !== 0 || starKoban(boss, 0, 0b001) !== 120) fail('starKoban');
  if (starsOf(0b101) !== 2) fail('starsOf');
}

// ── tutorial timeline ──
{
  const cfg = cfgOf(TUTORIAL, 777);
  cfg.coach = [false, true]; // a coach who does nothing: the story still happens
  const g = new Game(cfg), seen = {};
  while (!g.over && g.tick < sec(600) + 20) {
    g.step([]); g.fx.length = 0;
    for (const e of g.events.slice(-4)) if (e.type === 'spawn' || e.type === 'bossSoon') seen[e.obj || e.type] = seen[e.obj || e.type] ?? Math.round(e.t / 20);
    if (!seen.call && g.events.some((e) => e.type === 'call' && e.team === 1 && e.call.type === 'objective' && e.call.obj === 'dragon')) seen.call = Math.round(g.time);
  }
  console.log('tutorial timeline (s):', JSON.stringify(seen), 'winner', g.winner, 'at', Math.round(g.time));
  for (const [k, at] of [['dragon', 75], ['herald', 150], ['baron', 320], ['bossSoon', 390]]) if (seen[k] === undefined || Math.abs(seen[k] - at) > 2 && k !== 'baron') fail(`tutorial: ${k} not at ${at}s (${seen[k]})`);
  if (!seen.call) fail('tutorial: the scripted enemy Kami call did not happen');
  if (!g.mission || g.mission.si !== 2) fail('tutorial: script cursor');
}

// ── difficulty curve: a Normal AI coach plays your side ──
if (oddsN) {
  for (const m0 of MISSIONS) {
    const m = m0.rival === 'nemesis' ? { ...m0, rival: 'goro' } : m0;
    let w = 0, st = 0;
    for (let i = 0; i < oddsN; i++) { const { g } = run(cfgOf(m, 5000 + i * 101 + MISSIONS.indexOf(m0))); const o = missionOutcome(m, g, 0); if (o.won) w++; st += o.stars; }
    console.log(`odds ${m.id} ${m.title.padEnd(20)} lvl ${m.lvl}: wins ${w}/${oddsN}, stars ${(st / oddsN).toFixed(1)}`);
  }
}
console.log(fails ? `${fails} FAILED` : 'campaign: all checks passed');
process.exit(fails ? 1 : 0);
