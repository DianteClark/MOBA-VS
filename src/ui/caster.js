// Caster lines: a play-by-play voice for the big moments (first blood, multi-kills, shutdowns,
// objectives, aces, comebacks). One line at a time in the existing ticker, never a new panel.
// Render-side only: reads sim events, never touches the sim (Math.random is fine here).
import { TICK_RATE, DRAGON_INFO, OBJ_NAME, TEAM_NAME } from '../sim/constants.js';
import { elderName } from '../sim/beasts.js';

const MULTI = { 2: 'DOUBLE KILL', 3: 'TRIPLE KILL', 4: 'QUADRA KILL', 5: 'PENTAKILL' };
const CHAIN = 10 * TICK_RATE; // kills within 10s of each other chain into a multi-kill
const pick = (a) => a[Math.floor(Math.random() * a.length)];

export class Caster {
  constructor(g, view) {
    this.g = g; this.view = view;
    this.first = false; this.chain = new Map(); // hero id -> { n, last }
    this.worst = [0, 0]; // deepest kill deficit each team has been in
    this.lastComeback = -1e9;
  }
  team(t) { return TEAM_NAME[t]; }
  name(id) { const u = this.g.byId(id); return u && u.def ? u.def.name : null; }
  // Returns { text, big } for an event worth a line, else null. `big` lines may also earn a banner.
  line(e) {
    const g = this.g;
    if (e.type === 'kill') {
      const k = e.killer ? this.name(e.killer) : null, v = this.name(e.victim), kt = 1 - e.team;
      const diff = g.teams[kt].kills - g.teams[e.team].kills;
      this.worst[e.team] = Math.min(this.worst[e.team], -diff);
      let out = null;
      if (!this.first) { this.first = true; out = { text: k ? pick([`${k} draws first blood!`, `First blood to ${k}, and ${v} is sent home early!`]) : `First blood: ${v} falls to the ${this.team(kt)} side!`, prio: 4 }; }
      if (e.killer) {
        const c = this.chain.get(e.killer);
        const n = c && g.tick - c.last <= CHAIN ? c.n + 1 : 1;
        this.chain.set(e.killer, { n, last: g.tick });
        if (n >= 2) {
          const text = n >= 5 ? `PENTAKILL! ${k} has wiped the whole team!` : n === 2 ? pick([`Double kill for ${k}!`, `${k} takes two!`, `Two down: ${k} is on a roll.`])
            : n === 3 ? pick([`TRIPLE KILL! ${k} is unstoppable!`, `TRIPLE! Somebody stop ${k}!`]) : `QUADRA KILL! ${k} is one away from the penta!`;
          out = { text, prio: 3 + n, big: n >= 3 ? MULTI[n] : null };
        }
      }
      if (!out && e.shutdown) out = { text: pick([`Shut down! ${k || 'The tower'} ends ${v}'s rampage.`, `${v}'s bounty is cashed in${k ? ' by ' + k : ''}!`]), prio: 4 };
      const ace = g.teams[e.team].heroes.every((x) => !x.alive);
      if (ace) {
        const comeback = this.comeback(kt);
        out = { text: comeback || pick([`ACE! ${this.team(kt)} wipe out every last hero!`, `It's an ACE: ${this.team(e.team)} have no one left standing!`]), prio: 6 };
      } else if (!out) {
        // the kill count draws level after a deep deficit
        if (diff === 0 && this.worst[kt] <= -5) { const c = this.comeback(kt); if (c) out = { text: c, prio: 5 }; }
      }
      return out;
    }
    if (e.type === 'objective' && (e.team === 0 || e.team === 1)) {
      const t = this.team(e.team), who = e.killer ? this.name(e.killer) : null;
      const nm = e.obj === 'dragon' ? DRAGON_INFO[e.element].name : e.obj === 'boss' ? elderName(e.element) : (e.rare ? 'rare ' : '') + OBJ_NAME[e.obj];
      if (e.steal) return { text: `STOLEN! ${who || t} snatches the ${nm} right out of their hands!`, prio: 6 };
      const comeback = (e.obj === 'baron' || e.obj === 'dragon') && this.comeback(e.team, true);
      if (comeback) return { text: comeback, prio: 5 };
      if (e.obj === 'baron') return { text: pick([`${t} slay the Kraken: now they march!`, `The Kraken falls to ${t}. Here comes the push.`]), prio: 5 };
      if (e.obj === 'herald') return { text: `${t} tame the Oni. A tower is about to feel it.`, prio: 4 };
      if (e.obj === 'boss') return { text: pick([`${t} bring down the ${nm}! Its push is at their backs.`, `The ${nm} falls to ${t}: two minutes to break the base open.`]), prio: 6 };
      if (e.rare) return { text: pick([`A shiny one! ${t} take the ${nm}, and the bonus gold with it.`, `${t} claim the ${nm}. Rare, and it pays.`]), prio: 5 };
      if (e.obj === 'yokai') return { text: `${t} tame the Yokai Parade. The lanterns march for them now.`, prio: 4 };
      return { text: pick([`${t} secure the ${nm}.`, `${nm} goes to ${t}${who ? ', last hit by ' + who : ''}.`]), prio: 3 };
    }
    if (e.type === 'soul') return { text: `${this.team(e.team)} claim the ${DRAGON_INFO[e.element].name} blessing. That changes everything.`, prio: 5 };
    return null;
  }
  // A team that was well behind turns it around (kills, or towers on the board).
  comeback(t, objective) {
    const g = this.g, o = 1 - t, now = g.tick;
    if (now - this.lastComeback < 90 * TICK_RATE) return null;
    const killGap = g.teams[o].kills - g.teams[t].kills, wasDown = this.worst[t] <= -5;
    const towersDown = g.towersStanding(t) + 2 <= g.towersStanding(o);
    if (!(wasDown && killGap <= 2) && !(objective && towersDown)) return null;
    this.lastComeback = now;
    return pick([`What a comeback from ${this.team(t)}!`, `${this.team(t)} refuse to go quietly: this game is wide open again!`, `From the brink! ${this.team(t)} are clawing it back!`]);
  }
}
