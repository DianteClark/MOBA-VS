// Living World in the match HUD (src/sim/living.js): ticker lines and banners for nightfall, Moon Spirits,
// the Yokai Parade, walls coming down; Bosses & Beasts (src/sim/beasts.js): the Elder Kami and the scout pets.
// Called by Hud.processEvents for events it has no case for.
import { TEAM_NAME } from '../sim/constants.js';
import { LIVING } from '../sim/living.js';
import { BEASTS, KAMI } from '../sim/beasts.js';
import { PETS } from '../data/beasts.js';
import { TEAM_COL } from '../render/renderer.js';
import { bossFace } from './dom.js';
import { terrainEvent } from './terrainhud.js';

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
    case 'bossSoon': {
      const k = KAMI[e.kami]; if (!k) break;
      hud.banner(`THE ${k.elder.toUpperCase()} STIRS`, k.color, 1800, bossFace('boss', e.kami));
      hud.ticker(`The ${k.elder} lands mid-map in ${BEASTS.elderWarn}s. Its slayers get ${k.blessing} at Elder strength and a ${BEASTS.push}s push`, 'act', 3);
      break;
    }
    case 'scoutDown': {
      if (hud.my < 0) break;
      const pet = PETS[hud.r.bf.petId(e.team)].name;
      if (e.team === hud.my) hud.ticker(`Your ${pet} scout was caught`, 'n', 1);
      else hud.ticker(`Caught their scout (+${BEASTS.scoutGold} gold)`, side(1 - e.team), 1);
      break;
    }
    case 'wall':
      if (e.team === 0 || e.team === 1) hud.ticker(`${TEAM_NAME[e.team]} broke ${e.kind === 'thicket' ? 'a thicket' : 'a wall'}: a new shortcut is open`, side(e.team), 1);
      else if (e.kind === 'wall' && !hud._quake) { hud._quake = true; hud.ticker('The landing shook every wall down: new routes are open', 'act', 2); }
      break;
    default: terrainEvent(hud, e); // v25 maps: the tide, the wind
  }
}
// Extra words for an objective taken (after the shared banner / ticker).
export function livingObjective(hud, e) {
  if (e.obj === 'boss' && (e.team === 0 || e.team === 1)) hud.ticker(`The Elder's Push: ${TEAM_NAME[e.team]}'s waves are empowered and hit towers harder for ${BEASTS.push}s, with ${KAMI[e.element] ? KAMI[e.element].blessing : 'the blessing'} at Elder strength`, side(e.team) + ' extra', 3); // (extra: news of its own, not the banner's sub-line)
  if (e.obj === 'dragon' && KAMI[e.element] && (e.team === 0 || e.team === 1)) { const k = KAMI[e.element], n = hud.g.teams[e.team].dragons.length; hud.ticker(`${TEAM_NAME[e.team]}: ${k.blessing}${n > 1 ? ' ×' + n : ''}. ${k.desc}`, side(e.team) + ' extra', 2); }
  if (e.rare && (e.team === 0 || e.team === 1)) hud.ticker(`Rare ${e.obj === 'herald' ? 'Oni' : 'Kraken'}: +${BEASTS.rareGold} gold each${e.obj === 'baron' ? `, and the buff lasts ${BEASTS.rareBaronSec}s longer` : ', and its charge is tougher'}`, side(e.team) + ' extra', 2);
}
