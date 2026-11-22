// Living World in the match HUD (src/sim/living.js): ticker lines and banners for nightfall, Moon Spirits,
// the Yokai Parade, walls coming down and the Tengu. Called by Hud.processEvents for events it has no case for.
import { TEAM_NAME } from '../sim/constants.js';
import { LIVING } from '../sim/living.js';
import { TEAM_COL } from '../render/renderer.js';
import { bossFace } from './dom.js';

const LANE_L = { top: 'Top', mid: 'Mid', bot: 'Bot' };
const side = (t) => (t === 0 ? 'b' : 'r');
export function livingEvent(hud, e) {
  const g = hud.g;
  switch (e.type) {
    case 'dusk':
      hud.banner('NIGHTFALL', '#9fb8ff', 1800);
      hud.ticker(`Night until 9:00: sight shrinks, wards matter. Moon Spirits woke in the river${g.event === 'bloodmoon' ? ' (Blood Moon: darker, richer)' : ''}`, 'act', 2);
      break;
    case 'dawn': hud.ticker('Dawn: full sight returns', 'n', 1); break;
    case 'moonsight': hud.ticker(`${TEAM_NAME[e.team]} took the Moon Spirits: Moonsight, they see through the night`, side(e.team), 2); break;
    case 'tamed':
      hud.banner('PARADE TAMED', TEAM_COL[e.team], 2000, bossFace('yokai'));
      hud.ticker(`${TEAM_NAME[e.team]}'s yokai march down ${LANE_L[e.lane]} for ${LIVING.tameSec}s`, side(e.team), 3);
      break;
    case 'tameEnd': hud.ticker('The tamed yokai drift back into the forest', 'n', 0); break;
    case 'bossSoon':
      hud.banner('THE TENGU STIRS', '#ff4a5a', 1800, bossFace('boss'));
      hud.ticker(`The Tengu lands mid-map in ${LIVING.bossWarn}s. Its slayers get Tengu's Gale: a ${LIVING.bossBuff}s push`, 'act', 3);
      break;
    case 'wall':
      if (e.team === 0 || e.team === 1) hud.ticker(`${TEAM_NAME[e.team]} broke ${e.kind === 'thicket' ? 'a thicket' : 'a wall'}: a new shortcut is open`, side(e.team), 1);
      else if (e.kind === 'wall' && !hud._quake) { hud._quake = true; hud.ticker('The landing shook every wall down: new routes are open', 'act', 2); }
      break;
  }
}
// Extra words for an objective taken (after the shared banner / ticker).
export function livingObjective(hud, e) {
  if (e.obj === 'boss' && (e.team === 0 || e.team === 1)) hud.ticker(`Tengu's Gale: ${TEAM_NAME[e.team]}'s waves are empowered and hit towers harder for ${LIVING.bossBuff}s`, side(e.team), 3);
}
