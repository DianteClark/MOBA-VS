// Module worker: finds the broadcast seed for a featured Pro League match (see broadcast.js). Posts
// { t: 'try', n } before each full sim, { t: 'p', n, f } progress (0-1) during it, and { t: 'done', tries } at the end (tries = -1 if none agreed).
import { Game } from '../sim/game.js';
import { proWeek } from './pro.js';
import { broadcastCfg, MAX_TRIES } from './broadcast.js';

self.onmessage = (e) => {
  const { w, day, idx } = e.data, want = proWeek(w).days[day].matches[idx].w;
  for (let n = 0; n < MAX_TRIES; n++) {
    self.postMessage({ t: 'try', n });
    const g = new Game(broadcastCfg(w, day, idx, n));
    const end = (g.rules.seconds || 900) * 20;
    while (!g.over) { g.step([]); g.fx.length = 0; if (g.tick % 1000 === 0) self.postMessage({ t: 'p', n, f: Math.min(1, g.tick / end) }); }
    if (g.winner === want) { self.postMessage({ t: 'done', tries: n, len: Math.round(g.time) }); return; }
  }
  self.postMessage({ t: 'done', tries: -1 });
};
