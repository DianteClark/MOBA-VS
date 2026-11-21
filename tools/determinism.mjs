// Same seed + same commands must produce bit-identical games.
import { Game } from '../src/sim/game.js';
import { HEROES } from '../src/data/heroes.js';
const pick = (ids) => ids.map((id) => { const h = HEROES.find((x) => x.id === id); return { id, role: h.role, build: h.rec }; });
const cfg = (mode) => ({ seed: 777, coach: [false, true], ...(mode === 'rush' ? { mode: 'rush', map: 'rush_ember' } : {}), teams: [
  { heroes: pick(['grok', 'umbra', 'totem', 'bolt', 'bonehook']), plan: 'aggro', deck: ['smoke', 'ambush', 'rally'] },
  { heroes: pick(['varro', 'gama', 'hex', 'sling', 'aurelia']), plan: 'scale' } ] });
// A scripted "human" for blue.
const script = { 1800: { type: 'gank', lane: 'bot' }, 3200: { type: 'objective', obj: 'dragon' }, 6000: { type: 'focus', targetIdx: 3 },
  1700: { type: 'moment', id: 'rally' }, 2600: { type: 'moment', id: 'timeout' }, 5000: { type: 'moment', id: 'push' },
  7000: { type: 'group', lane: 'mid' }, 7600: { type: 'tactic', card: 'smoke' }, 8200: { type: 'tactic', card: 'ambush', lane: 'bot' }, 9000: { type: 'reset' }, 11000: { type: 'objective', obj: 'baron' }, 12000: { type: 'build', heroIdx: 2, build: 'burn' } };
function run(mode) {
  const g = new Game(cfg(mode)); const sums = [];
  while (!g.over && g.tick < 20 * 60 * 25) {
    const s = script[g.tick]; const cmds = [];
    if (s) {
      const c = { ...s, team: 0, seq: 1 };
      if (s.targetIdx !== undefined) c.target = g.teams[1].heroes[s.targetIdx].id;
      if (s.heroIdx !== undefined) c.hero = g.teams[0].heroes[s.heroIdx].id;
      cmds.push(c);
    }
    g.step(cmds); g.fx.length = 0;
    if (g.tick % 200 === 0) sums.push(g.checksum());
  }
  return { sums, winner: g.winner, tick: g.tick, moments: g.events.filter((e) => e.type === 'moment').length };
}
// Classic 5v5 and Lane Rush (single lane, rush rules), each with Coach Moments from both sides.
let ok = true;
for (const mode of ['classic', 'rush']) {
  const a = run(mode), b = run(mode);
  const same = a.sums.length === b.sums.length && a.sums.every((v, i) => v === b.sums[i]);
  console.log(`${mode} run A: ${a.sums.length} checkpoints, winner ${a.winner} @${(a.tick / 1200).toFixed(1)}m, ${a.moments} moments`);
  console.log(`${mode} run B: ${b.sums.length} checkpoints, winner ${b.winner} @${(b.tick / 1200).toFixed(1)}m, ${b.moments} moments`);
  ok = ok && same;
}
// Co-op: two coaches on blue (seat-stamped commands, ownership checks, a lead pass, then the partner leaving)
// and two on red (red's coaches both leave: the AI coach takes over).
const coopCfg = () => ({ ...cfg('classic'), coach: [false, false], coop: [{ seats: 2, own: { top: 0, jungle: 0, mid: 0, bot: 1, support: 1 }, lead: 0 }, { seats: 2, own: { top: 1, jungle: 1, mid: 0, bot: 0, support: 0 }, lead: 1 }] });
const coopScript = { 1500: [0, 0, { type: 'gank', lane: 'top' }], 1600: [0, 1, { type: 'objective', obj: 'dragon' }], 1700: [0, 1, { type: 'gank', lane: 'bot', role: 'support' }], 2100: [0, 0, { type: 'moment', id: 'rally' }],
  2400: [1, 1, { type: 'group', lane: 'mid' }], 2500: [1, 0, { type: 'group', lane: 'mid' }], 3000: [0, 0, { type: 'lead' }], 3100: [0, 1, { type: 'objective', obj: 'dragon' }], 3300: [0, 1, { type: 'build', role: 'mid', build: 1 }],
  4000: [1, 1, { type: 'leave', sys: 1 }], 4200: [1, 0, { type: 'safe' }], 5000: [0, 1, { type: 'leave', sys: 1 }], 5200: [0, 0, { type: 'build', role: 'bot', build: 1 }], 6000: [1, 0, { type: 'leave', sys: 1 }], 7000: [0, 0, { type: 'cancel' }] };
function runCoop() {
  const g = new Game(coopCfg()); const sums = []; let accepted = '';
  while (!g.over && g.tick < 20 * 60 * 12) {
    const s = coopScript[g.tick]; const cmds = [];
    if (s) {
      const [team, seat, c0] = s, c = { ...c0, team, seat, seq: 1 };
      if (c.role) { const x = g.teams[team].heroes.find((y) => y.role === c.role); c.hero = x.id; if (c.type === 'build') c.build = x.def.builds[c0.build]; delete c.role; }
      cmds.push(c);
    }
    const n = g.callLog.length; g.step(cmds); g.fx.length = 0;
    if (s) accepted += g.events.some((e) => e.t === g.tick - 1 && (e.type === 'call' || e.type === 'coop')) || g.callLog.length > n ? '1' : '0';
    if (g.tick % 200 === 0) sums.push(g.checksum());
  }
  return { sums, winner: g.winner, tick: g.tick, accepted, ai: !!g.coaches[1] && g.teams[1].coop.ai, owners: g.teams[0].heroes.map((x) => x.seat).join('') };
}
const ca = runCoop(), cb = runCoop();
const coopSame = ca.sums.length === cb.sums.length && ca.sums.every((v, i) => v === cb.sums[i]) && ca.accepted === cb.accepted;
// expected verdicts: gank ok, partner objective no, partner support gank ok, rally ok, red lead (seat 1) push ok, red seat 0 push no,
// lead pass ok, partner objective now ok, partner mid build (host's hero) no, red partner leaves ok, red seat 0 safe ok, blue partner leaves ok,
// host builds the bot hero (now theirs) ok, red lead leaves ok (AI), cancel ok
const expect = '101110110111111';
console.log(`coop run A: ${ca.sums.length} checkpoints, winner ${ca.winner} @${(ca.tick / 1200).toFixed(1)}m, verdicts ${ca.accepted}, red AI ${ca.ai}, blue owners ${ca.owners}`);
console.log(`coop run B: ${cb.sums.length} checkpoints, winner ${cb.winner}, verdicts ${cb.accepted}`);
const coopRules = ca.accepted === expect && ca.ai && ca.owners === '00000';
if (!coopRules) console.log(`coop rules: expected verdicts ${expect}`);
ok = ok && coopSame && coopRules;
console.log(ok ? 'DETERMINISTIC ✔' : 'DESYNC ✘');
process.exit(ok ? 0 : 1);
