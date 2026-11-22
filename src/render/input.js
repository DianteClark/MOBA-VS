// Camera controls: one pointer-event pipeline for touch, pen and mouse (drag to pan, pinch / wheel to zoom,
// keyboard), the minimap tap / drag, and map taps.
// A tap is a press that stays within a small slop (10 CSS px for a finger, 5 for a mouse) and lifts within
// TAP_MS; it is reported at the point where the finger landed. The camera does not move inside the slop (a
// tap never nudges the map), and once a press becomes a drag it pans by the whole distance (no jump). A pinch
// zooms around the fingers' midpoint; a tap can't come out of a pinch until every finger has lifted.
// Pointer events only: no touch + emulated mouse double-fire, no 300ms delay (touch-action: none on the canvases).
export const TAP_SLOP = { touch: 10, pen: 8, mouse: 5 };
export const TAP_MS = 650;

export function bindCamera(r, canvas, minimap, mmCanvas, hooks = {}) {
  const keys = new Set();
  const pts = new Map(); // pointerId -> { x, y }
  let g = null; // gesture: { mode: 'press' | 'drag' | 'pinch', ... }
  // the player took the camera: stop following a hero / the auto-camera
  const stopFollow = () => { r.panTo = null; r.follow = null; hooks.onManual && hooks.onManual(); };
  const zoomTo = (z) => Math.max(0.45, Math.min(3, z));
  // CSS px inside the canvas -> world, against what is actually on screen (the backing store may lag a resize by a frame)
  const toWorld = (cx, cy) => {
    const rc = canvas.getBoundingClientRect(), k = rc.width > 0 && r.dpr ? r.W / r.dpr / rc.width : 1, kh = rc.height > 0 && r.dpr ? r.H / r.dpr / rc.height : 1;
    return r.s2w((cx - rc.left) * k, (cy - rc.top) * kh);
  };
  const pan = (dx, dy) => { r.cam.x -= dx / r.cam.zoom; r.cam.y -= dy / r.cam.zoom; };
  const startPinch = () => {
    const [a, b] = [...pts.values()];
    g = { mode: 'pinch', d: Math.max(8, Math.hypot(a.x - b.x, a.y - b.y)), z: r.cam.zoom, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, dead: true };
  };

  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (pts.size >= 2) return; // a third finger changes nothing
    try { canvas.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 1) g = { mode: 'press', id: e.pointerId, sx: e.clientX, sy: e.clientY, lx: e.clientX, ly: e.clientY, t: e.timeStamp, slop: TAP_SLOP[e.pointerType] || 10, type: e.pointerType };
    else startPinch();
    if (e.pointerType !== 'mouse') e.preventDefault();
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = pts.get(e.pointerId); if (!p || !g) return;
    p.x = e.clientX; p.y = e.clientY;
    if (g.mode === 'pinch') {
      if (pts.size < 2) return;
      const [a, b] = [...pts.values()], d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      // zoom around the midpoint (the world under the fingers stays under the fingers) and pan with it
      const before = toWorld(mx, my); r.cam.zoom = zoomTo(g.z * d / g.d); const after = toWorld(mx, my);
      r.cam.x += before.x - after.x; r.cam.y += before.y - after.y;
      pan(mx - g.mx, my - g.my); g.mx = mx; g.my = my;
      stopFollow();
      return;
    }
    if (e.pointerId !== g.id) return;
    if (g.mode === 'press') {
      if (Math.hypot(e.clientX - g.sx, e.clientY - g.sy) <= g.slop) return;
      g.mode = 'drag'; stopFollow();
    }
    pan(e.clientX - g.lx, e.clientY - g.ly); g.lx = e.clientX; g.ly = e.clientY;
  });
  const lift = (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    if (!g) return;
    if (g.mode === 'press' && e.pointerId === g.id && e.type === 'pointerup' && !g.dead && e.timeStamp - g.t <= TAP_MS && hooks.onClick) {
      const t = g; g = null;
      hooks.onClick(toWorld(t.sx, t.sy), t.sx, t.sy, t.type);
      return;
    }
    if (g.mode === 'pinch' && pts.size === 1) {
      // one finger left after a pinch: keep panning with it from where it is (no jump), never a tap
      const [[id, p]] = [...pts.entries()];
      g = { mode: 'drag', id, lx: p.x, ly: p.y, dead: true };
      return;
    }
    if (!pts.size) g = null;
  };
  canvas.addEventListener('pointerup', lift);
  canvas.addEventListener('pointercancel', lift);
  canvas.addEventListener('lostpointercapture', (e) => { if (pts.has(e.pointerId)) lift({ pointerId: e.pointerId, type: 'pointercancel', timeStamp: e.timeStamp }); });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault()); // a long press is not a context menu
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const before = toWorld(e.clientX, e.clientY);
    r.cam.zoom = zoomTo(r.cam.zoom * (e.deltaY > 0 ? 0.9 : 1.1));
    const after = toWorld(e.clientX, e.clientY);
    r.cam.x += before.x - after.x; r.cam.y += before.y - after.y;
  }, { passive: false });

  // Minimap: press or drag to move the camera there (captured: a drag that slides off the minimap keeps working)
  const mmGo = (cx, cy) => { const w = minimap.toWorld(cx, cy); r.cam.x = w.x; r.cam.y = w.y; stopFollow(); };
  let mmId = null;
  mmCanvas.addEventListener('pointerdown', (e) => {
    if ((e.pointerType === 'mouse' && e.button !== 0) || mmId !== null) return;
    mmId = e.pointerId; try { mmCanvas.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
    if (e.pointerType !== 'mouse') e.preventDefault();
    mmGo(e.clientX, e.clientY);
  });
  mmCanvas.addEventListener('pointermove', (e) => { if (e.pointerId === mmId) mmGo(e.clientX, e.clientY); });
  const mmUp = (e) => { if (e.pointerId === mmId) mmId = null; };
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) mmCanvas.addEventListener(ev, mmUp);
  mmCanvas.addEventListener('contextmenu', (e) => e.preventDefault());

  window.addEventListener('keydown', (e) => { if (e.target.tagName === 'INPUT') return; keys.add(e.key.toLowerCase()); hooks.onKey && hooks.onKey(e); });
  window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
  window.addEventListener('blur', () => keys.clear());
  return {
    // true while a finger / the mouse is down on the map (a drag or pinch in progress)
    get busy() { return !!g; },
    update(dt) {
      const sp = 900 / r.cam.zoom * dt;
      let mx = 0, my = 0;
      if (keys.has('arrowleft') || keys.has('a')) mx -= 1; if (keys.has('arrowright') || keys.has('d')) mx += 1;
      if (keys.has('arrowup') || keys.has('w')) my -= 1; if (keys.has('arrowdown') || keys.has('s')) my += 1;
      if (mx || my) { stopFollow(); r.cam.x += mx * sp; r.cam.y += my * sp; }
    },
  };
}
