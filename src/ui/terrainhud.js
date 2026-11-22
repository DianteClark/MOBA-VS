// The v25 maps in the match HUD (src/sim/terrain.js): banners and ticker lines for the tide, a one-time line for the
// wind bridges. Called by livingEvent (src/ui/livinghud.js) for the events it has no case for.
import { TERRAIN, tideSlow } from '../sim/terrain.js';

export function terrainEvent(hud, e) {
  switch (e.type) {
    case 'tideSoon':
      if (e.high) {
        hud.banner('THE TIDE IS RISING', '#5ec8e8', 1800);
        hud.ticker(`High tide in ${TERRAIN.tide.warn}s: the sandbars go under, the rafts float in, and the shallows slow everyone ${Math.round(tideSlow(hud.g.event) * 100)}%`, 'act', 2);
      } else hud.ticker(`The tide turns in ${TERRAIN.tide.warn}s: the sandbars come back and the rafts drift ashore`, 'act', 1);
      break;
    case 'tide':
      if (e.high) hud.banner('HIGH TIDE', '#5ec8e8', 1600);
      else hud.ticker('Low tide: the sandbars are open, the shallows are clear', 'n', 1);
      break;
    case 'wind':
      if (!hud._windTold) { hud._windTold = true; hud.ticker(`The wind turned: the other bridges are up. They swap every ${TERRAIN.wind.period}s (watch the pennants and the minimap)`, 'n', 1); }
      break;
  }
}
// The clock's sub-line: the tide state (the weather / night text otherwise).
export function tideLabel(g, base) {
  if (!g.terrain || !g.terrain.tide) return base;
  return g.terrain.high ? (base.startsWith('Night') ? 'Night · High tide' : 'High tide') : base; // (kept short: the clock chip is narrow)
}
