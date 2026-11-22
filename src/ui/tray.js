// Decision tray: ONE slot directly above the call buttons. Coach's Calls, hero requests,
// Kami Surge, call payoffs and analyst suggestions share it as a priority queue:
// the highest-priority live item shows, the rest wait (a "+N" badge says how many).
// Visual language: gold = act now, red = danger, team colour = one of your heroes.
// Topics (attention.js): cards about the same thing merge (the higher priority one stays), and a topic that was
// just on screen does not ask again for TOPIC_GAP ms.
import { h, mount } from './dom.js';

export const PRIO = { call: 50, request: 40, surge: 30, tip: 25, payoff: 20, danger: 15, sug: 10 };
const TOPIC_GAP = 12000;

export class Tray {
  constructor(el, topicOf) { this.el = el; this.items = []; this.cur = null; this.seq = 0; this.topicOf = topicOf || (() => null); this.topicSeen = new Map(); }
  has(key) { return this.items.some((i) => i.key === key); }
  // item: { key, prio, ttl(ms), cls, build(item) → [children] (may set item.upd for live text), valid?(), onShow?(), onEnd?(reason), staleMs?, topic?, at? }
  push(item) {
    if (item.key && this.has(item.key)) return null;
    const now = performance.now();
    if (item.topic === undefined) item.topic = this.topicOf(item.key);
    if (item.topic) {
      if (now - (this.topicSeen.get(item.topic) || -1e9) < TOPIC_GAP) return null; // just decided / seen
      const o = this.items.find((i) => i.topic === item.topic);
      if (o) { if (o.prio >= item.prio) return null; this.end(o, 'merged'); } // one card per topic: the better one
    }
    item.seq = ++this.seq; item.born = now; item.until = now + (item.ttl || 10000);
    if (item.staleMs) item.staleAt = now + item.staleMs; // drop if never shown by then
    this.items.push(item);
    this.tick();
    return item;
  }
  // Close an item (chosen / dismissed / expired).
  end(item, reason) {
    const i = this.items.indexOf(item); if (i < 0) return;
    this.items.splice(i, 1);
    if (item.topic && item.shown) this.topicSeen.set(item.topic, performance.now());
    if (item.onEnd) item.onEnd(reason);
    if (this.cur === item) { const el = item.el; this.cur = null; if (el) { el.classList.add('out'); setTimeout(() => el.remove(), 200); } }
    this.tick();
  }
  clear(pred = () => true) { for (const it of this.items.slice()) if (pred(it)) this.end(it, 'cleared'); }
  tick() {
    const now = performance.now();
    for (const it of this.items.slice()) {
      if (now > it.until || (it.valid && !it.valid())) { this.end(it, 'expired'); return; }
      if (it !== this.cur && !it.shown && it.staleAt && now > it.staleAt) { this.end(it, 'stale'); return; }
    }
    const top = this.items.slice().sort((a, b) => b.prio - a.prio || a.seq - b.seq)[0] || null;
    if (top !== this.cur) {
      if (this.cur && this.cur.el) this.cur.el.remove();
      this.cur = top;
      if (top) {
        top.el = h('div', { class: 'titem ' + (top.cls || '') }, top.build(top), h('i', { class: 'ttl', style: { animationDuration: Math.max(0.2, (top.until - now) / 1000) + 's' } }));
        mount(this.el, top.el, this.badge = h('b', { class: 'tq' }));
        if (!top.shown) { top.shown = true; if (top.onShow) top.onShow(top); }
      } else mount(this.el);
    }
    if (this.cur && this.cur.upd) this.cur.upd(); // live text (e.g. a countdown in the title)
    if (this.cur && this.badge) { const n = this.items.length - 1, t = n > 0 ? '+' + n : ''; if (this.badge.textContent !== t) this.badge.textContent = t; }
    this.el.classList.toggle('empty', !this.cur);
  }
}
