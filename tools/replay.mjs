// Replay check: record a vs-AI style match with random player commands, then play it back
// from the log and compare checksums.  node tools/replay.mjs
import { Game } from '../src/sim/game.js';
import { LocalRunner } from '../src/net/runner.js';
import { aiPrep } from '../src/sim/draft.js';
const cfg = { seed: 4242, map: 'frost', coach: [false, true], teams: [aiPrep(['bastion', 'kaze', 'ember', 'fletch', 'aurelia'], ['varro', 'gama', 'hex', 'bolt', 'frost']), aiPrep(['varro', 'gama', 'hex', 'bolt', 'frost'], ['bastion', 'kaze', 'ember', 'fletch', 'aurelia'])] };
const g1 = new Game(JSON.parse(JSON.stringify(cfg))), r1 = new LocalRunner(g1, 0, { noHalftime: true });
const calls = [{ type: 'gank', lane: 'mid' }, { type: 'group', lane: 'bot' }, { type: 'objective', obj: 'dragon' }, { type: 'ult', mode: 'go' }, { type: 'safe' }, { type: 'plan', plan: 'aggressive' }];
let k = 0;
while (g1.time < 600) { if (g1.tick % 400 === 7) r1.send(calls[k++ % calls.length]); r1.update(0.05); }
const log = JSON.parse(JSON.stringify(r1.log));
const g2 = new Game(JSON.parse(JSON.stringify(cfg))), r2 = new LocalRunner(g2, -1, { noHalftime: true, script: log });
while (g2.tick < g1.tick) r2.update(0.05);
console.log(`commands ${log.reduce((a, b) => a + b[1].length, 0)}, ticks ${g1.tick}`);
console.log(g1.checksum() === g2.checksum() ? 'REPLAY MATCHES ✔' : 'REPLAY DIVERGED ✘');
process.exit(g1.checksum() === g2.checksum() ? 0 : 1);
