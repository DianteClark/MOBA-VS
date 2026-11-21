// Coach Moment presentation: a big centred title card with a ring burst, a screen tint and shake,
// a sound sting, and a ticker line for the other side. Purely cosmetic (reads the 'moment' event).
import { h, mount } from './dom.js';
import { MOMENTS } from '../sim/moments-coach.js';
import { TEAM_NAME } from '../sim/constants.js';
import { audio } from '../audio.js';

const SFX = { timeout: ['heal', 'levelup'], rally: ['wings', 'powerup'], push: ['tower', 'explosion'] };
export function momentFx(hud, e) {
  const m = MOMENTS[e.id]; if (!m) return;
  const mine = e.team === hud.view || hud.my < 0;
  if (!mine) {
    hud.ticker(`Enemy ${m.name}! ${m.short}`, 'danger', 3);
    audio.sfx('alert2', 0.6);
    return;
  }
  let el = document.getElementById('momentfx');
  if (!el) { el = h('div', { id: 'momentfx' }); document.body.append(el); }
  const card = h('div', { class: 'mfx', style: { '--mc': m.color } }, h('small', {}, hud.my < 0 ? `${TEAM_NAME[e.team].toUpperCase()} COACH MOMENT` : 'COACH MOMENT'), h('b', {}, m.name.toUpperCase()), h('span', {}, m.short));
  mount(el, h('i', { class: 'mring', style: { '--mc': m.color } }), card);
  clearTimeout(el._t); el._t = setTimeout(() => mount(el), 2000);
  const [a, b] = SFX[e.id] || ['powerup', 'objective'];
  audio.sfx(a, 0.9); setTimeout(() => audio.sfx(b, 0.7), 180);
  const r = hud.r; if (r) { r.screenTint(m.color, 0.22, 0.7); r.shakeBy(e.id === 'push' ? 0.6 : 0.35); }
  if (hud.my >= 0) hud.ticker(e.id === 'push' ? 'All-Out Push: the next wave marches with super minions!' : `${m.name}: ${m.short}`, 'act', 2);
}
