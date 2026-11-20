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

// Same-device transport (two tabs) via BroadcastChannel — used for local testing with ?local=1.
const LOCAL = typeof location !== 'undefined' && new URLSearchParams(location.search).has('local');
class BcTransport {
  constructor(code, me) {
    this.bc = new BroadcastChannel('mobavs-' + code); this.me = me; this.handlers = []; this.closeHandlers = []; this.open = true;
    this.bc.onmessage = (e) => { if (e.data.from !== this.me) for (const h of this.handlers) h(JSON.parse(e.data.m)); };
  }
  send(m) { this.bc.postMessage({ from: this.me, m: JSON.stringify(m) }); }
  onMessage(h) { this.handlers.push(h); } onClose(h) { this.closeHandlers.push(h); } close() { this.bc.close(); }
}
function localHost(code, onStatus) {
  return new Promise((resolve) => {
    const t = new BcTransport(code, 'host'); onStatus && onStatus('waiting');
    const first = (m) => { if (m.t === 'knock') { t.handlers = t.handlers.filter((h) => h !== first); t.send({ t: 'welcome' }); resolve({ peer: { destroy() {} }, transport: t }); } };
    t.onMessage(first);
  });
}
function localJoin(code) {
  return new Promise((resolve) => {
    const t = new BcTransport(code, 'guest');
    const iv = setInterval(() => t.send({ t: 'knock' }), 300);
    const first = (m) => { if (m.t === 'welcome') { clearInterval(iv); t.handlers = t.handlers.filter((h) => h !== first); resolve({ peer: { destroy() {} }, transport: t }); } };
    t.onMessage(first);
  });
}

function needPeer() {
  if (!window.Peer) throw new Error('Networking library failed to load (check your connection).');
}

// Host: register the code and wait for one guest.
export function host(code, onStatus, onPeer) {
  if (LOCAL) return localHost(code, onStatus);
  needPeer();
  return new Promise((resolve, reject) => {
    const peer = new window.Peer(PREFIX + code, { debug: 0 });
    if (onPeer) onPeer(peer);
    let done = false;
    peer.on('open', () => onStatus && onStatus('waiting'));
    peer.on('connection', (conn) => {
      if (done) { conn.close(); return; }
      conn.on('open', () => { done = true; resolve({ peer, transport: new Transport(conn) }); });
    });
    peer.on('error', (e) => { if (!done) reject(e); });
  });
}

// Guest: connect to a host code.
export function join(code, onStatus, onPeer) {
  if (LOCAL) return localJoin(code);
  needPeer();
  return new Promise((resolve, reject) => {
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
  });
}

// In-memory pair for tests / local debugging (adds artificial latency).
export function loopbackPair(latencyMs = 40) {
  const mk = () => ({ handlers: [], closeHandlers: [], other: null, open: true,
    send(m) { const o = this.other, s = JSON.stringify(m); setTimeout(() => o.handlers.forEach((h) => h(JSON.parse(s))), latencyMs + Math.random() * latencyMs * 0.5); },
    onMessage(h) { this.handlers.push(h); }, onClose(h) { this.closeHandlers.push(h); }, close() {} });
  const a = mk(), b = mk(); a.other = b; b.other = a; return [a, b];
}
