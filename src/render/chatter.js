// Hero chatter: short pixel speech bubbles reacting to calls, kills, deaths, trust and ults.
// Flavoured by personality, rate-limited, only for heroes on screen. Render-only (Math.random ok).
import { TEAM_COL } from './palette.js';
import { settings, textScale } from '../ui/settings.js';

const P = (o) => o; // readability
// Lines per situation and personality. Plain ASCII only (pixel font).
const LINES = {
  callOk: P({
    reckless: ['Say less!', 'Already there!', 'Finally!'], cautious: ['Copy. Moving carefully.', 'On it. Watching flanks.'],
    greedy: ['After this wave!', 'Fine, moving.'], loyal: ['On my way!', 'Right behind you!', 'You got it, coach!'],
    hothead: ["Let's GO!", 'About time!'], calm: ['Understood.', 'Moving.', 'On my way.'],
  }),
  callSlow: P({
    reckless: ['Gimme a sec!'], cautious: ['Hmm... okay.', 'Is it safe?'], greedy: ['Just one more camp...', 'Hold on...'],
    loyal: ['Coming!'], hothead: ['Wait for me!'], calm: ['One moment.'],
  }),
  callDoubt: P({
    reckless: ['Ugh, fine...', 'Boring call.'], cautious: ['This feels risky...', 'If you say so...'], greedy: ['Ugh, fine...', 'Again?'],
    loyal: ['...okay, coach.'], hothead: ['Seriously?!', 'Ugh, FINE.'], calm: ['If you insist.'],
  }),
  kill: P({
    reckless: ['Too easy!', 'Who is next?!'], cautious: ['Got one. Backing off.', 'Clean pick.'], greedy: ['Cha-ching!', 'Mine!'],
    loyal: ['For the team!', 'Got him!'], hothead: ['Sit DOWN!', 'Get wrecked!'], calm: ['Clean.', 'Target down.'],
  }),
  death: P({
    reckless: ['Worth it!', 'Oops.'], cautious: ['Told you it was risky...'], greedy: ['My gold...', 'My items!'],
    loyal: ['Sorry, team...'], hothead: ['THAT WAS LAG!', 'Unbelievable!'], calm: ['My mistake.', 'Regrouping.'],
  }),
  inspired: P({
    reckless: ['Coach is cooking!'], cautious: ['Okay, I trust you.'], greedy: ['Good calls = good gold!'],
    loyal: ['Best coach ever!'], hothead: ['NOW we are talking!'], calm: ['Great calls, coach.'],
  }),
  doubtful: P({
    reckless: ['These calls are lame...'], cautious: ['Coach, please...'], greedy: ['You are costing me gold.'],
    loyal: ['I still believe... mostly.'], hothead: ['Who made THAT call?!'], calm: ['Let us rethink this.'],
  }),
  tilted: P({ hothead: ['I am SO done.', 'This team...', 'Rage mode!'] }),
  ult: P({
    reckless: ['ALL IN!'], cautious: ['Now!'], greedy: ['Ult time!'], loyal: ['I got you!'], hothead: ['FEEL THIS!'], calm: ['Now.'],
  }),
  objective: P({ any: ['It is ours!', 'Got it!', 'Objective secured!'] }),
};
const pick = (a) => a[(Math.random() * a.length) | 0];

export class Chatter {
  constructor(r) { this.r = r; this.bubbles = []; this.heroCd = new Map(); this.lastAny = 0; }
  reset() { this.bubbles = []; this.heroCd.clear(); this.lastAny = 0; }
  // prio: 0 = minor (calls), 1 = normal, 2 = big (kills, deaths, ults)
  say(u, kind, prio = 1, extra) {
    if (!settings.chatter || !u || u.type !== 'hero') return false;
    const r = this.r, now = r.time;
    const dead = !u.alive; if (dead && kind !== 'death' && kind !== 'tilted') return false;
    if (!(dead ? r.visiblePoint(u.x, u.y) : r.visible(u)) || !r.onScreen(u.x, u.y - 30, 20)) return false;
    // enemies only taunt on big moments
    if (r.viewTeam >= 0 && u.team !== r.viewTeam && prio < 2) return false;
    const cd = this.heroCd.get(u.id) || 0;
    if (now < cd && prio < 2) return false;
    if (prio < 2 && now - this.lastAny < 0.9) return false;
    if (this.bubbles.length >= 3 && prio < 2) return false;
    const pers = u.def.pers, set = LINES[kind]; if (!set) return false;
    let line = extra || pick(set[pers] || set.any || set.calm || Object.values(set)[0]);
    if (kind === 'ult' && Math.random() < 0.55) line = (u.def.abilities.find((a) => a.ult) || {}).name + '!';
    this.bubbles = this.bubbles.filter((b) => b.id !== u.id);
    if (this.bubbles.length >= 4) this.bubbles.shift();
    this.bubbles.push({ id: u.id, team: u.team, text: line, born: now, dur: 2.1 + line.length * 0.03, at: dead ? { x: u.x, y: u.y } : null });
    this.heroCd.set(u.id, now + (prio >= 2 ? 4 : 8));
    this.lastAny = now;
    return true;
  }
  // Screen-space draw (ctx identity transform). pos(id) → interpolated world position or null.
  draw(ctx, pos) {
    if (!this.bubbles.length) return;
    const r = this.r, d = r.dpr, now = r.time, ts = textScale();
    this.bubbles = this.bubbles.filter((b) => now - b.born < b.dur);
    const fs = Math.round(11 * ts * d);
    ctx.font = `${fs}px PixelFont, monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const b of this.bubbles) {
      const p = b.at || pos(b.id); if (!p) continue;
      const k = (now - b.born) / b.dur, tt = now - b.born;
      const pop = tt < 0.18 ? 0.4 + 0.75 * Math.sin(tt / 0.18 * Math.PI * 0.62) / Math.sin(Math.PI * 0.62) : 1;
      const a = k > 0.85 ? (1 - k) / 0.15 : 1;
      const s = r.w2s(p.x, p.y - 64);
      if (s.x < 0 || s.x > r.W || s.y < 0 || s.y > r.H) continue; // speaker off-screen: no bubble pinned to a corner under the HUD
      const txt = String(b.text).replace(/ /g, ' ');
      const tw = ctx.measureText(txt).width, w = tw + 12 * d, hh = fs + 9 * d;
      const x = Math.max(w / 2 + 4 * d, Math.min(r.W - w / 2 - 4 * d, s.x)), y = r.dodge(x, Math.max(hh + 4 * d, s.y - 4 * d * (1 - Math.min(1, tt * 4))), w, hh);
      ctx.save(); ctx.globalAlpha = a; ctx.translate(x, y); ctx.scale(pop, pop);
      const bx = -w / 2, by = -hh;
      // shadow, body, team stripe, tail
      ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(bx + 2 * d, by + 2 * d, w, hh);
      ctx.fillStyle = '#2a1608'; ctx.fillRect(bx - d, by - d, w + 2 * d, hh + 2 * d);
      ctx.fillStyle = '#fff6e0'; ctx.fillRect(bx, by, w, hh);
      ctx.fillStyle = TEAM_COL[b.team] || '#888'; ctx.fillRect(bx, by, w, 2 * d);
      const tx = Math.max(-w / 2 + 6 * d, Math.min(w / 2 - 6 * d, s.x - x));
      ctx.fillStyle = '#2a1608'; ctx.beginPath(); ctx.moveTo(tx - 5 * d, -d); ctx.lineTo(tx + 5 * d, -d); ctx.lineTo(tx, 6 * d); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#fff6e0'; ctx.beginPath(); ctx.moveTo(tx - 3.5 * d, -d * 1.2); ctx.lineTo(tx + 3.5 * d, -d * 1.2); ctx.lineTo(tx, 4 * d); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#2a1608'; ctx.fillText(txt, 0, by + hh / 2 + d);
      ctx.restore();
    }
  }
}
