// One attention system for the match HUD (v23 flow2). Every player-facing message has a priority and ONE home:
//   card    the decision tray (one slot above the calls): Coach's Calls, fight forecasts, hero requests, talents,
//           Kami Surge, suggestions, payoffs. Same-topic cards merge (the higher priority one stays), and a topic
//           that was just shown is not asked again for a few seconds (a forecast, then a "teamfight brewing" call
//           about the same fight, is one decision, not two).
//   banner  one big centred line at a time (queue of 2; a stale queued banner is dropped).
//   ticker  one line under the score. Low-priority lines are rate-limited, repeats are dropped, and while a
//           decision card is up only lines that matter get through.
//   edge    off-screen arrows (alerts.js); a fight that has a decision card does not get its own arrow.
//   world   chatter bubbles and callouts on the map (renderer).
// One sim event = one message: while the HUD handles an event, its ticker lines and banners are collected and
// flushed as a single message (a banner carries the best line as its sub-line; with no banner, the best line
// goes to the ticker alone). Pure UI: reads the game, never writes it.
import { PRIO } from './tray.js';

// Ticker budget
export const TICKER = { lowGap: 4000, dupMs: 30000, focusMin: 2 };
// Banner budget
export const BANNER = { queue: 2, staleMs: 4000 };
// Cards: how long after a topic was on screen the same topic may not ask again
export const CARD = { topicGap: 12000, decideMin: 35 };

export class Attention {
  constructor(hud) { this.hud = hud; this.scope = null; this.lowAt = -1e9; this.recent = new Map(); }

  // ── one sim event → one message ──
  begin(e) { this.scope = { e, lines: [], banners: [] }; }
  end() {
    const s = this.scope; this.scope = null;
    if (!s || (!s.lines.length && !s.banners.length)) return;
    const hud = this.hud;
    // the best line: a caster line reads best, then the most important one, then the first
    // ('extra' lines are news of their own, e.g. what a Tengu kill unlocks: they follow on the ticker)
    const extra = s.lines.filter((l) => /\bextra\b/.test(l.cls)), lines = s.lines.filter((l) => !extra.includes(l));
    const best = lines.slice().sort((a, b) => (b.cls === 'cast') - (a.cls === 'cast') || b.prio - a.prio)[0] || null;
    if (s.banners.length) {
      const [b, ...rest] = s.banners;
      if (best && !b.node && !sameText(best.text, b.text)) b.sub = best.text;
      for (const x of [b, ...rest]) hud.showBannerItem(x);
    } else if (best) hud.tickerNow(best.text, best.cls, best.prio);
    for (const l of extra) hud.tickerNow(l.text, l.cls, l.prio);
  }
  // Hud.ticker / Hud.banner ask first: true = taken into the current event's message.
  takeLine(text, cls, prio) { if (!this.scope) return false; this.scope.lines.push({ text, cls, prio }); return true; }
  takeBanner(it) { if (!this.scope || it.urgent) return false; this.scope.banners.push(it); return true; }

  // ── ticker gate: false = drop the line ──
  // prio: 0 trivia, 1 info, 2 news, 3+ big moments.
  tickerOk(text, prio) {
    const now = performance.now();
    for (const [t, at] of this.recent) if (now - at > TICKER.dupMs) this.recent.delete(t);
    if (this.recent.has(text)) return false; // said already
    if (this.deciding() && prio < TICKER.focusMin) return false; // a decision is up: no trivia
    if (prio <= 1) { if (now - this.lowAt < TICKER.lowGap) return false; this.lowAt = now; }
    this.recent.set(text, now);
    return true;
  }
  // A decision card holds the tray slot (Coach's Call, forecast, request, talent): the HUD goes quiet around it.
  deciding() { const d = this.hud.dock, c = d && d.tray && d.tray.cur; return !!(c && c.prio >= CARD.decideMin); }
  // The fight card on screen covers this world point (its edge arrow would say the same thing again).
  covers(p) {
    const d = this.hud.dock, c = d && d.tray && d.tray.cur;
    return !!(c && c.topic === 'fight' && c.at && (c.at.x - p.x) ** 2 + (c.at.y - p.y) ** 2 < 1100 * 1100);
  }
  // The objective's decision card is up (contest it / take it): its "under attack" arrow would repeat it.
  coversObj(k) { const d = this.hud.dock, c = d && d.tray && d.tray.cur; return !!(c && c.topic === 'obj:' + k); }
  // per HUD tick: the focus class dims the map-side chatter of the HUD while a decision is up
  tick() {
    const on = this.deciding(), el = document.getElementById('hud');
    if (el && el.classList.contains('deciding') !== on) el.classList.toggle('deciding', on);
  }
  destroy() { const el = document.getElementById('hud'); if (el) el.classList.remove('deciding'); }
}
const norm = (t) => String(t || '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
const sameText = (a, b) => { const x = norm(a), y = norm(b); return !x || !y || x === y || x.startsWith(y) || y.startsWith(x); };

// Topic of a tray card from its key (merging and the topic gap). Unknown keys have no topic.
export function cardTopic(key) {
  const k = String(key || '');
  if (/^(fc|brew)/.test(k)) return 'fight';
  if (/^(contest|wake|numbers|ejspot|ej)/.test(k)) { const m = k.match(/dragon|baron|herald/); return 'obj:' + (m ? m[0] : 'any'); }
  if (/^shr/.test(k)) return 'shrine:' + k.slice(3);
  if (/^lo:/.test(k)) return 'lane:' + k.replace(/^lo:open/, '');
  if (/^surge/.test(k)) return 'surge';
  return null;
}
export { PRIO };
