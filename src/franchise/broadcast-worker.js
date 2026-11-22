// Module worker: finds the broadcast seed for a featured Pro League match (see broadcast.js). Posts
// { t: 'try', n } before each full sim and { t: 'done', tries } at the end (tries = -1 if none agreed).
import { Game } from '../sim/game.js';
import { proWeek } from './pro.js';
import { broadcastCfg, MAX_TRIES } from './broadcast.js';

self.onmessage = (e) => {
  const { w, day, idx } = e.data, want = proWeek(w).days[day].matches[idx].w;
  for (let n = 0; n < MAX_TRIES; n++) {
    self.postMessage({ t: 'try', n });
    const g = new Game(broadcastCfg(w, day, idx, n));
    while (!g.over) { g.step([]); g.fx.length = 0; }
    if (g.winner === want) { self.postMessage({ t: 'done', tries: n, len: Math.round(g.time) }); return; }
  }
  self.postMessage({ t: 'done', tries: -1 });
};
