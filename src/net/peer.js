// WebRTC transport via PeerJS (free public signaling server). Room code = 5 letters.
const PREFIX = 'mobavs-v1-';
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
export function makeCode() { let s = ''; for (let i = 0; i < 5; i++) s += ALPHA[Math.floor(Math.random() * ALPHA.length)]; return s; }

class Transport {
  constructor(conn) {
    this.conn = conn; this.handlers = []; this.closeHandlers = []; this.open = true;
    conn.on('data', (d) => { let m = d; if (typeof d === 'string') { try { m = JSON.parse(d); } catch { return; } } for (const h of this.handlers) h(m); });
    conn.on('close', () => { this.open = false; for (const h of this.closeHandlers) h(); });
    conn.on('error', () => { this.open = false; for (const h of this.closeHandlers) h(); });
  }
  send(m) { if (this.open) { try { this.conn.send(JSON.stringify(m)); } catch { /* closed */ } } }
  onMessage(h) { this.handlers.push(h); }
  onClose(h) { this.closeHandlers.push(h); }
  close() { try { this.conn.close(); } catch { /* ignore */ } }
}

// Same-device transport (several tabs) via BroadcastChannel — used for local testing with ?local=1.
// Every message is addressed: `from` this end, `to` the other end (tabs ignore mail for others).
const LOCAL = typeof location !== 'undefined' && new URLSearchParams(location.search).has('local');
const tabId = () => 'g' + Math.random().toString(36).slice(2, 9);
class BcTransport {
  constructor(code, me, peerId = null) {
    this.bc = new BroadcastChannel('mobavs-' + code); this.me = me; this.peerId = peerId; this.handlers = []; this.closeHandlers = []; this.open = true;
    this.bc.onmessage = (e) => {
      const d = e.data; if (d.from === this.me || (d.to && d.to !== this.me) || (this.peerId && d.from !== this.peerId)) return;
      if (d.bye) { this.open = false; for (const h of this.closeHandlers) h(); return; }
      for (const h of this.handlers) h(JSON.parse(d.m));
    };
  }
  send(m) { if (this.open) this.bc.postMessage({ from: this.me, to: this.peerId, m: JSON.stringify(m) }); }
  onMessage(h) { this.handlers.push(h); } onClose(h) { this.closeHandlers.push(h); }
  close() { if (this.open) { this.open = false; try { this.bc.postMessage({ from: this.me, to: this.peerId, bye: 1 }); } catch { /* closed */ } } this.bc.close(); }
}
// A raw listener for knocks on a code (the host side of ?local=1).
function knocks(code, onKnock) {
  const bc = new BroadcastChannel('mobavs-' + code), seen = new Set();
  bc.onmessage = (e) => { const d = e.data; if (d.to !== 'host' || d.bye || seen.has(d.from)) return; let m; try { m = JSON.parse(d.m); } catch { return; } if (m.t !== 'knock') return; seen.add(d.from); onKnock(d.from); };
  return bc;
}
function localHost(code, onStatus) {
  return new Promise((resolve) => {
    onStatus && onStatus('waiting');
    const bc = knocks(code, (id) => { bc.close(); const t = new BcTransport(code, 'host', id); t.send({ t: 'welcome' }); resolve({ peer: { destroy() {} }, transport: t }); });
  });
}
function localJoin(code) {
  return new Promise((resolve) => {
    const t = new BcTransport(code, tabId(), 'host');
    const iv = setInterval(() => t.send({ t: 'knock' }), 300);
    const first = (m) => { if (m.t === 'welcome') { clearInterval(iv); t.handlers = t.handlers.filter((h) => h !== first); resolve({ peer: { destroy() {} }, transport: t }); } };
    t.onMessage(first);
  });
}

// Co-op rooms: the host keeps one link per guest (star). Guest messages are stamped with the guest's
// slot `p` (never trusted from the guest) and the lockstep / draft / prep / chat ones are relayed to the
// other guests, so every peer sees every peer. To the app the hub looks like one transport.
const RELAY = new Set(['in', 'h', 'ht', 'qc', 'draft', 'prep', 'quit', 'sug']);
export class Hub {
  constructor() { this.links = new Map(); this.handlers = []; this.leaveHandlers = []; this.open = true; }
  add(slot, t) {
    this.links.set(slot, t);
    t.onMessage((m) => {
      if (this.links.get(slot) !== t || !m || typeof m !== 'object') return;
      m.p = slot;
      if (RELAY.has(m.t)) for (const [s, o] of this.links) if (s !== slot) o.send(m);
      for (const h of this.handlers) h(m);
    });
    t.onClose(() => { if (this.links.get(slot) !== t) return; this.links.delete(slot); for (const h of this.leaveHandlers) h(slot); });
  }
  has(slot) { return this.links.has(slot); }
  send(m) { for (const t of this.links.values()) t.send(m); }
  sendTo(slot, m) { const t = this.links.get(slot); if (t) t.send(m); }
  kick(slot) { const t = this.links.get(slot); this.links.delete(slot); if (t) t.close(); }
  onMessage(h) { this.handlers.push(h); }
  onLeave(h) { this.leaveHandlers.push(h); }
  onClose() { /* the hub itself only closes when the host leaves */ }
  close() { this.open = false; for (const t of this.links.values()) t.close(); this.links.clear(); }
}
// Host a co-op room: resolves once the code is registered; every guest that connects is handed to
// onGuest(transport) (the app seats it in the hub, or turns it away).
export function hostRoom(code, { onStatus, onPeer, onGuest }) {
  if (LOCAL) {
    const bc = knocks(code, (id) => { const t = new BcTransport(code, 'host', id); t.send({ t: 'welcome' }); onGuest(t); });
    onStatus && onStatus('waiting');
    return Promise.resolve({ peer: { destroy() { bc.close(); } } });
  }
  return needPeer().then(() => new Promise((resolve, reject) => {
    const peer = new window.Peer(PREFIX + code, { debug: 0 });
    if (onPeer) onPeer(peer);
    let up = false;
    peer.on('open', () => { up = true; onStatus && onStatus('waiting'); resolve({ peer }); });
    peer.on('connection', (conn) => conn.on('open', () => onGuest(new Transport(conn))));
    peer.on('error', (e) => { if (!up) reject(e); });
  }));
}

// PeerJS is fetched on demand (never on the first-paint path); warmNet() preloads it once the menu is up.
const PEERJS_URL = 'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js';
let peerLib = null;
function needPeer() {
  if (window.Peer) return Promise.resolve();
  return peerLib || (peerLib = new Promise((resolve, reject) => {
    const s = document.createElement('script'); s.src = PEERJS_URL; s.async = true;
    s.onload = () => (window.Peer ? resolve() : reject(new Error('Networking library failed to load.')));
    s.onerror = () => { peerLib = null; s.remove(); reject(new Error('Networking library failed to load (check your connection).')); };
    document.head.append(s);
  }));
}
export function warmNet() { if (!LOCAL) needPeer().catch(() => {}); }

// Host: register the code and wait for one guest.
export function host(code, onStatus, onPeer) {
  if (LOCAL) return localHost(code, onStatus);
  return needPeer().then(() => new Promise((resolve, reject) => {
    const peer = new window.Peer(PREFIX + code, { debug: 0 });
    if (onPeer) onPeer(peer);
    let done = false;
    peer.on('open', () => onStatus && onStatus('waiting'));
    peer.on('connection', (conn) => {
      if (done) { conn.close(); return; }
      conn.on('open', () => { done = true; resolve({ peer, transport: new Transport(conn) }); });
    });
    peer.on('error', (e) => { if (!done) reject(e); });
  }));
}

// Guest: connect to a host code.
export function join(code, onStatus, onPeer) {
  if (LOCAL) return localJoin(code);
  return needPeer().then(() => new Promise((resolve, reject) => {
    const peer = new window.Peer(undefined, { debug: 0 });
    if (onPeer) onPeer(peer);
    const timer = setTimeout(() => reject(new Error('Could not reach that room.')), 15000);
    peer.on('open', () => {
      onStatus && onStatus('connecting');
      const conn = peer.connect(PREFIX + code.toUpperCase(), { reliable: true, serialization: 'raw' });
      conn.on('open', () => { clearTimeout(timer); resolve({ peer, transport: new Transport(conn) }); });
      conn.on('error', (e) => { clearTimeout(timer); reject(e); });
    });
    peer.on('error', (e) => { clearTimeout(timer); reject(e); });
  }));
}

// In-memory pair for tests / local debugging (adds artificial latency; delivery stays in order, like a data channel).
export function loopbackPair(latencyMs = 40) {
  const mk = () => ({ handlers: [], closeHandlers: [], other: null, open: true, last: 0,
    send(m) { if (!this.open) return; const o = this.other, s = JSON.stringify(m), now = Date.now(); this.last = Math.max(this.last, now + latencyMs + Math.random() * latencyMs * 0.5); setTimeout(() => { if (o.open) o.handlers.forEach((h) => h(JSON.parse(s))); }, this.last - now); },
    onMessage(h) { this.handlers.push(h); }, onClose(h) { this.closeHandlers.push(h); },
    close() { if (!this.open) return; this.open = false; const o = this.other; setTimeout(() => { o.open = false; o.closeHandlers.forEach((h) => h()); }, latencyMs * 2); } });
  const a = mk(), b = mk(); a.other = b; b.other = a; return [a, b];
}
