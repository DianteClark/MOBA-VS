// Camera controls: mouse drag / wheel, touch pan + pinch, keyboard, minimap tap.
export function bindCamera(r, canvas, minimap, mmCanvas, hooks = {}) {
  const keys = new Set();
  let drag = null, pinch = null, moved = 0;
  const stopFollow = () => { r.panTo = null; if (r.follow) { r.follow = null; hooks.onFollow && hooks.onFollow(null); } };

  canvas.addEventListener('mousedown', (e) => { drag = { x: e.clientX, y: e.clientY }; moved = 0; });
  window.addEventListener('mousemove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y; moved += Math.abs(dx) + Math.abs(dy);
    if (moved > 4) stopFollow();
    r.cam.x -= dx / r.cam.zoom; r.cam.y -= dy / r.cam.zoom; drag = { x: e.clientX, y: e.clientY };
  });
  window.addEventListener('mouseup', (e) => {
    if (drag && moved < 5 && hooks.onClick && e.target === canvas) hooks.onClick(r.s2w(e.clientX - canvas.getBoundingClientRect().left, e.clientY - canvas.getBoundingClientRect().top), e.clientX, e.clientY);
    drag = null;
  });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const before = r.s2w(e.clientX - rect.left, e.clientY - rect.top);
    r.cam.zoom = Math.max(0.45, Math.min(3, r.cam.zoom * (e.deltaY > 0 ? 0.9 : 1.1)));
    const after = r.s2w(e.clientX - rect.left, e.clientY - rect.top);
    r.cam.x += before.x - after.x; r.cam.y += before.y - after.y;
  }, { passive: false });

  canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (e.touches.length === 1) { drag = { x: e.touches[0].clientX, y: e.touches[0].clientY }; moved = 0; pinch = null; }
    else if (e.touches.length === 2) { const [a, b] = e.touches; pinch = { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), z: r.cam.zoom }; drag = null; }
  }, { passive: false });
  canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    if (pinch && e.touches.length === 2) {
      const [a, b] = e.touches; const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      r.cam.zoom = Math.max(0.45, Math.min(3, pinch.z * d / pinch.d)); stopFollow();
    } else if (drag && e.touches.length === 1) {
      const t = e.touches[0]; const dx = t.clientX - drag.x, dy = t.clientY - drag.y; moved += Math.abs(dx) + Math.abs(dy);
      if (moved > 6) stopFollow();
      r.cam.x -= dx / r.cam.zoom; r.cam.y -= dy / r.cam.zoom; drag = { x: t.clientX, y: t.clientY };
    }
  }, { passive: false });
  canvas.addEventListener('touchend', (e) => {
    if (drag && moved < 8 && hooks.onClick && e.changedTouches[0]) {
      const t = e.changedTouches[0], rect = canvas.getBoundingClientRect();
      hooks.onClick(r.s2w(t.clientX - rect.left, t.clientY - rect.top), t.clientX, t.clientY);
    }
    if (e.touches.length === 0) { drag = null; pinch = null; }
  });

  const mmGo = (cx, cy) => { const w = minimap.toWorld(cx, cy); r.cam.x = w.x; r.cam.y = w.y; stopFollow(); };
  let mmDown = false;
  mmCanvas.addEventListener('mousedown', (e) => { mmDown = true; mmGo(e.clientX, e.clientY); });
  window.addEventListener('mousemove', (e) => { if (mmDown) mmGo(e.clientX, e.clientY); });
  window.addEventListener('mouseup', () => { mmDown = false; });
  mmCanvas.addEventListener('touchstart', (e) => { e.preventDefault(); mmGo(e.touches[0].clientX, e.touches[0].clientY); }, { passive: false });
  mmCanvas.addEventListener('touchmove', (e) => { e.preventDefault(); mmGo(e.touches[0].clientX, e.touches[0].clientY); }, { passive: false });

  window.addEventListener('keydown', (e) => { if (e.target.tagName === 'INPUT') return; keys.add(e.key.toLowerCase()); hooks.onKey && hooks.onKey(e); });
  window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
  return {
    update(dt) {
      const sp = 900 / r.cam.zoom * dt;
      let mx = 0, my = 0;
      if (keys.has('arrowleft') || keys.has('a')) mx -= 1; if (keys.has('arrowright') || keys.has('d')) mx += 1;
      if (keys.has('arrowup') || keys.has('w')) my -= 1; if (keys.has('arrowdown') || keys.has('s')) my += 1;
      if (mx || my) { stopFollow(); r.cam.x += mx * sp; r.cam.y += my * sp; }
    },
  };
}
