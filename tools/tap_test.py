# Tap behaviour test with real touch emulation (hasTouch, isMobile, DPR 2; CDP touch events, Playwright tap()).
# Every case drives the page the way a finger does and checks what happened, so it runs against any build:
#   map: tap a hero of yours (follows it), tap open map (call ring), a tap with finger jitter, a drag (pans, no
#        ring), a pinch (zooms, no ring), taps right after a pan, a tap away closes the ring, a touch whose up never
#        came does not kill the next tap, the minimap jump/drag,
#        taps during hit-stop / punch zoom and slow motion, taps right after a rotation / resize
#   picking: a finger-sized radius at any zoom; heroes beat objectives beat structures
#   buttons: rapid taps fire exactly once each (no touch + mouse double fire), taps through a banner / toast,
#            a button re-drawn between finger down and up still takes the tap, a card that appears under a
#            falling finger is not chosen, a modal closed by a tap on its backdrop does not click what is under it
#   python3 tools/tap_test.py URL [WxH@l/r/t/b,...]      (default 844x390@47/47/0/21,667x375)
# REDUCED=1 runs with Reduced effects on. Prints PASS/FAIL per case and a total; exit code 1 on any failure.
import sys, os, asyncio, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))); sys.dont_write_bytecode = True
URL = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8891/'
SPEC = sys.argv[2] if len(sys.argv) > 2 else '844x390@47/47/0/21,667x375'
_argv = sys.argv; sys.argv = [_argv[0], URL, '', SPEC]
import ui_audit as UA  # noqa: E402
sys.argv = _argv
from playwright.async_api import async_playwright  # noqa: E402

PREFS = "try { localStorage.setItem('mobavs_settings', JSON.stringify(Object.assign(JSON.parse(localStorage.getItem('mobavs_settings') || '{}'), { reducedMotion: %s, readyCheck: false }))); } catch (e) {}" % ('true' if os.environ.get('REDUCED') == '1' else 'false')

# screen point (CSS px) of a world point, and of a unit's sprite centre
HELPERS = """window.__tt = {
  scr(x, y) { const r = app.renderer, c = r.canvas.getBoundingClientRect(), p = r.w2s(x, y); return { x: c.left + p.x / r.dpr, y: c.top + p.y / r.dpr }; },
  // a hero's sprite centre as drawn this frame
  at(id) { const x = app.match.game.units.find((u) => u.id === id), d = app.renderer.heroPos.get(id) || x; return this.scr(d.x, d.y - 14); },
  // an open map spot near the camera centre, away from every unit and button
  open(ax, ay) { const r = app.renderer, g = app.match.game, c = r.canvas.getBoundingClientRect();
    for (let k = 0; k < 400; k++) { const sx = c.left + c.width * (0.25 + 0.5 * ((k * 37) % 100) / 100), sy = c.top + c.height * (0.25 + 0.4 * ((k * 61) % 100) / 100);
      if (ax !== undefined && Math.hypot(sx - ax, sy - ay) < 140) continue; // away from (ax, ay): clear of the ring there
      const hit = document.elementFromPoint(sx, sy); if (hit !== r.canvas) continue;
      const w = r.s2w((sx - c.left), (sy - c.top)); if (g.units.some((u) => u.alive && (u.x - w.x) ** 2 + (u.y - w.y) ** 2 < 110 ** 2)) continue;
      if (g.world.distToLane(g.world.closestLane(w), w) > 300) continue; // a lane: the ring has calls there
      return { x: sx, y: sy }; }
    // nothing open here: look at the middle of each lane instead, once
    if (ax === undefined && !this._moved) { this._moved = true; for (const lane of g.world.laneNames) { const mr = document.getElementById('mm').getBoundingClientRect(), m = g.world.laneSnap(lane, app.minimap.toWorld(mr.left + mr.width / 2, mr.top + mr.height / 2));
      r.cam.x = m.x; r.cam.y = m.y; const q = this.open(); if (q) { this._moved = false; return q; } } this._moved = false; }
    return null; },
  ring() { const d = app.match.hud.dock; return !!(d && d.ring); },
  // the living hero of yours farthest from every other hero (so a near-miss tap has one sensible answer); camera on it
  // a fixed stage: the sim paused, the camera on the middle of the mid lane, one hero of yours right there and every
  // other hero back at its fountain (so a near-miss tap has one sensible answer and drags never hit the map edge)
  lone() { const g = app.match.game, r = app.renderer, W = g.world, mr = document.getElementById('mm').getBoundingClientRect();
    app.match.runner.paused = true; r.focus = null; r.panTo = null; r.follow = null; app.match.hud._dirTarget = null;
    const m = W.laneSnap('mid', app.minimap.toWorld(mr.left + mr.width / 2, mr.top + mr.height / 2)), me = g.teams[0].heroes[0];
    for (const t of g.teams) for (const x of t.heroes) { if (x === me) { x.x = m.x; x.y = m.y + 14; } else { x.x = W.fountain[x.team].x; x.y = W.fountain[x.team].y; } x.alive = true; }
    for (const u of g.units) if (u.alive && u.type !== 'hero' && !u.structure && (u.x - m.x) ** 2 + (u.y - m.y) ** 2 < 400 ** 2) { u.x += 900; } // clear the stage of minions / camps
    r.snapshot(); r.heroPos.clear(); r.cam.x = m.x; r.cam.y = m.y; r.clampCam(); return me.id; },
};"""


class T:
    def __init__(self, pg, cdp): self.pg, self.cdp, self.res = pg, cdp, []
    def ok(self, name, cond, info=''): self.res.append((name, bool(cond), info))
    async def ev(self, js, arg=None): return await self.pg.evaluate(js, arg) if arg is not None else await self.pg.evaluate(js)
    async def touch(self, kind, pts):
        await self.cdp.send('Input.dispatchTouchEvent', {'type': kind, 'touchPoints': [{'x': x, 'y': y, 'id': i} for i, (x, y) in enumerate(pts)]})
    async def stroke(self, path, hold=0):  # one finger along a path (first point = down, last = up)
        await self.touch('touchStart', [path[0]])
        for p in path[1:]: await self.touch('touchMove', [p]); await self.pg.wait_for_timeout(16)
        if hold: await self.pg.wait_for_timeout(hold)
        await self.touch('touchEnd', [])
        await self.pg.wait_for_timeout(120)
    async def tap(self, x, y): await self.pg.touchscreen.tap(x, y); await self.pg.wait_for_timeout(120)
    async def reset(self):
        await self.ev("() => { const H = app.match.hud; H.dock.close(); H.dock.closeRing(); H.closePop(); app.renderer.follow = null; for (const e of document.querySelectorAll('.modal')) e.remove(); }")
        await self.pg.wait_for_timeout(80)


async def map_cases(t):
    await t.reset()
    # 1. tap your own hero: it is followed
    h = await t.ev("() => __tt.lone()")
    await t.pg.wait_for_timeout(100)
    p = await t.ev(f"() => __tt.at({h})")
    await t.tap(p['x'], p['y'])
    dbg = f"() => {{ const x = app.match.game.teams[0].heroes.find((u) => u.id === {h}), q = __tt.at({h}); return JSON.stringify({{ follow: app.renderer.follow, ring: __tt.ring(), tapped: [{p['x']:.0f}, {p['y']:.0f}], now: [Math.round(q.x), Math.round(q.y)], hit: document.elementFromPoint({p['x']}, {p['y']}).id, alive: x.alive }}); }}"
    t.ok('tap own hero follows it', await t.ev("() => app.renderer.follow") == h, await t.ev(dbg))
    # 2. a tap 20 CSS px off the hero (a fat finger) still picks it
    await t.reset()
    await t.tap(p['x'] + 16, p['y'] + 12)
    t.ok('finger-sized radius picks the hero', await t.ev("() => app.renderer.follow") == h, await t.ev(f"() => {{ const r = app.renderer, c = r.canvas.getBoundingClientRect(), w = r.s2w({p['x'] + 16} - c.left, {p['y'] + 12} - c.top), pk = window.__pk && window.__pk.pickAt(app.match.game, r, w), e = document.elementFromPoint({p['x'] + 16}, {p['y'] + 12}); return JSON.stringify({{ follow: r.follow, ring: __tt.ring(), pick: pk && [pk.kind, pk.unit.id], el: e && (e.id || e.className), p: [{p['x']:.0f}, {p['y']:.0f}], now: __tt.at({h}) }}); }}"))
    await t.reset()
    # 3. open map: the call ring opens; a tap away closes it
    o = await t.ev("() => __tt.open()")
    if not o: t.ok('found an open map spot', False); return
    await t.tap(o['x'], o['y'])
    t.ok('tap open map opens the ring', await t.ev("() => __tt.ring()"))
    a = await t.ev(f"() => __tt.open({o['x']}, {o['y']})")
    await t.tap(a['x'], a['y'])
    t.ok('tap away closes the ring', not await t.ev("() => __tt.ring()"))
    await t.reset()
    # 4. a tap with finger jitter (6px wobble each way) is still a tap, and the camera did not move
    cam0 = await t.ev("() => [app.renderer.cam.x, app.renderer.cam.y]")
    await t.stroke([(o['x'], o['y']), (o['x'] + 4, o['y'] + 3), (o['x'] + 6, o['y'] - 3), (o['x'] + 2, o['y'] + 5)])
    cam1 = await t.ev("() => [app.renderer.cam.x, app.renderer.cam.y]")
    t.ok('jittery tap opens the ring', await t.ev("() => __tt.ring()"))
    t.ok('jittery tap leaves the camera still', abs(cam0[0] - cam1[0]) < 0.5 and abs(cam0[1] - cam1[1]) < 0.5, f'{cam0} -> {cam1}')
    await t.reset()
    # 5. a drag pans (by the whole distance) and opens nothing
    z = await t.ev("() => app.renderer.cam.zoom")
    cam0 = await t.ev("() => [app.renderer.cam.x, app.renderer.cam.y]")
    await t.stroke([(o['x'], o['y'])] + [(o['x'] - 8 * k, o['y']) for k in range(1, 11)])
    cam1 = await t.ev("() => [app.renderer.cam.x, app.renderer.cam.y]")
    t.ok('drag opens no ring', not await t.ev("() => __tt.ring()"))
    t.ok('drag pans the whole 80px', abs((cam1[0] - cam0[0]) * z - 80) < 2, f'moved {(cam1[0] - cam0[0]) * z:.1f}px from {o}; ' + await t.ev(f"() => {{ const e = document.elementFromPoint({o['x']}, {o['y']}); return (e && (e.id || e.className)) + ' follow=' + app.renderer.follow; }}"))
    # 6. right after that pan, a tap still opens the ring (and where the finger is)
    o = await t.ev("() => __tt.open()")
    await t.tap(o['x'], o['y'])
    t.ok('tap right after a pan opens the ring', await t.ev("() => __tt.ring()"), json.dumps(o) + await t.ev(f"() => {{ const e = document.elementFromPoint({o['x']}, {o['y']}); const r = app.renderer, c = r.canvas.getBoundingClientRect(), w = r.s2w({o['x']} - c.left, {o['y']} - c.top); const P = window.__pk; const pk = P ? P.pickAt(app.match.game, r, w) : 'nomod'; return (e && (e.id || e.className)) + ' busy=' + app.camCtl.busy + ' pick=' + (pk && pk.kind); }}"))
    await t.reset()
    # 7. a pan closes an open ring (it points at a spot that just moved)
    await t.tap(o['x'], o['y'])
    q = await t.ev(f"() => __tt.open({o['x']}, {o['y']})")
    pre = await t.ev(f"() => {{ const e = document.elementFromPoint({q['x']}, {q['y']}); return 'open=' + __tt.ring() + ' start=' + (e && (e.id || e.className)); }}")
    await t.stroke([(q['x'], q['y'])] + [(q['x'] + 6 * k, q['y'] + 2 * k) for k in range(1, 8)])
    t.ok('a pan closes the ring', not await t.ev("() => __tt.ring()"), pre)
    await t.reset()
    # 7b. a touch whose up never came (a system gesture took it) must not leave the map dead
    await t.ev(f"() => app.renderer.canvas.dispatchEvent(new PointerEvent('pointerdown', {{ pointerId: 77, isPrimary: true, pointerType: 'touch', clientX: {o['x']}, clientY: {o['y']}, bubbles: true }}))")
    await t.tap(o['x'], o['y'])
    t.ok('a lost touch-up does not kill the next tap', await t.ev("() => __tt.ring()"))
    await t.reset()
    # 8. pinch: zooms, never opens a ring, even when one finger lifts first
    o = await t.ev("() => __tt.open()")
    z0 = await t.ev("() => app.renderer.cam.zoom")
    a, b = (o['x'] - 30, o['y']), (o['x'] + 30, o['y'])
    await t.touch('touchStart', [a, b])
    for k in range(1, 8): await t.touch('touchMove', [(a[0] - 6 * k, a[1]), (b[0] + 6 * k, b[1])]); await t.pg.wait_for_timeout(16)
    await t.touch('touchEnd', [(b[0] + 42, b[1])]); await t.touch('touchEnd', [])
    await t.pg.wait_for_timeout(150)
    t.ok('pinch zooms in', await t.ev("() => app.renderer.cam.zoom") > z0 * 1.2)
    t.ok('pinch opens no ring', not await t.ev("() => __tt.ring()"))
    await t.ev(f"() => {{ app.renderer.cam.zoom = {z0}; }}")
    # 9. minimap: a tap jumps the camera there, a drag keeps following the finger
    mm = await t.ev("() => { const r = document.getElementById('mm').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; }")
    await t.tap(mm['x'] + mm['w'] * 0.45, mm['y'] + mm['h'] * 0.55)
    w = await t.ev(f"() => app.minimap.toWorld({mm['x'] + mm['w'] * 0.45}, {mm['y'] + mm['h'] * 0.55})")
    c = await t.ev("() => app.renderer.cam")
    t.ok('minimap tap moves the camera there', abs(c['x'] - w['x']) < 2 and abs(c['y'] - w['y']) < 2, f"cam {c['x']:.0f},{c['y']:.0f} want {w['x']:.0f},{w['y']:.0f}")
    await t.stroke([(mm['x'] + mm['w'] * 0.3, mm['y'] + mm['h'] * 0.3)] + [(mm['x'] + mm['w'] * (0.3 + 0.04 * k), mm['y'] + mm['h'] * 0.3) for k in range(1, 8)])
    w = await t.ev(f"() => app.minimap.toWorld({mm['x'] + mm['w'] * 0.58}, {mm['y'] + mm['h'] * 0.3})")
    c = await t.ev("() => app.renderer.cam")
    t.ok('minimap drag follows the finger', abs(c['x'] - w['x']) < 30 and abs(c['y'] - w['y']) < 30)
    # 10. taps during hit-stop + punch zoom and slow motion still land
    await t.reset()
    h = await t.ev("() => { const id = __tt.lone(); app.match.runner.speed = 0.25; app.renderer.motion = true; app.renderer.impact(3, 0.04); return id; }")
    await t.pg.wait_for_timeout(200)
    p = await t.ev(f"() => __tt.at({h})")
    await t.tap(p['x'], p['y'])
    t.ok('tap during hit-stop / slow motion picks the hero', await t.ev("() => app.renderer.follow") == h)
    await t.ev("() => { app.match.runner.speed = 0.0001; app.renderer.hitStop = 0; app.renderer.punch = 0; }")


async def pick_cases(t):
    res = await t.ev("""async () => {
      let P; try { P = await import('./src/ui/tappick.js'); } catch (e) { return null; }
      const g = app.match.game, r = app.renderer, me = g.teams[0].heroes[0], foe = g.teams[1].heroes[0], tw = g.units.find((u) => u.type === 'tower' && u.alive);
      const keep = [me.x, me.y, foe.x, foe.y, me.alive, foe.alive], z0 = r.cam.zoom, out = {};
      const others = g.teams.flatMap((t) => t.heroes).filter((u) => u !== me && u.alive); for (const u of others) u.alive = false; // one hero under test
      const drawn = r.heroPos.get(me.id); r.heroPos.delete(me.id); // measured at its sim position here
      const at = (u, dx, dy) => ({ x: u.x + dx, y: u.y + dy });
      // a hero and a tower under the same finger: the hero wins
      me.x = tw.x + 20; me.y = tw.y + 20; let p = P.pickAt(g, r, at(tw, 10, 10)); out.heroOverTower = p && p.unit === me;
      // nothing near: the tower alone
      me.x = keep[0]; me.y = keep[1]; p = P.pickAt(g, r, at(tw, 8, 0)); out.tower = p && p.kind === 'structure' && p.unit === tw;
      // the radius is a finger on screen: 26 CSS px off picks at zoom 0.5 and at zoom 2
      for (const z of [0.5, 2]) { r.cam.zoom = z; p = P.pickAt(g, r, { x: me.x + 26 / z, y: me.y - 14 }); out['z' + z] = p && p.unit === me;
        p = P.pickAt(g, r, { x: me.x + 70 / z, y: me.y - 14 }); out['far' + z] = !p || p.unit !== me; }
      r.cam.zoom = z0;
      [me.x, me.y, foe.x, foe.y] = keep; for (const u of others) u.alive = true; if (drawn) r.heroPos.set(me.id, drawn); return out; }""")
    if res is None: t.ok('map picking module (src/ui/tappick.js)', False, 'missing'); return
    t.ok('a hero beats a structure under the finger', res['heroOverTower'])
    t.ok('a structure is picked when it is all there is', res['tower'])
    t.ok('finger radius at zoom 0.5', res['z0.5'] and res['far0.5'])
    t.ok('finger radius at zoom 2', res['z2'] and res['far2'])


async def button_cases(t):
    await t.reset()
    # rapid taps on one button: exactly one click per tap (no touch + emulated mouse double fire)
    await t.ev("() => { window.__n = 0; const b = document.querySelector('#cmdbar .call'); b.addEventListener('click', () => window.__n++); }")
    b = await t.ev("() => { const r = document.querySelector('#cmdbar .call').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }")
    for _ in range(8): await t.pg.touchscreen.tap(b['x'], b['y']); await t.pg.wait_for_timeout(40)
    await t.pg.wait_for_timeout(400)
    n = await t.ev("() => window.__n")
    t.ok('8 rapid taps = 8 clicks', n == 8, f'{n} clicks')
    await t.reset()
    # a banner and a toast on screen: the dock and the minimap still take taps
    await t.ev("() => { app.match.hud.banner('FIRST BLOOD', '#4aa3ff', 60000, null, true); import('./src/ui/dom.js').then((m) => m.toast('A toast over the map', 4000)); }")
    await t.pg.wait_for_timeout(500)
    await t.tap(b['x'], b['y'])
    t.ok('tap a call during a banner + toast opens its sheet', await t.ev("() => !!app.match.hud.dock.sheetId"))
    await t.reset()
    # a button re-drawn between finger down and up (a live list) still takes the tap, once
    await t.ev("""() => { const host = document.createElement('div'); host.id = 'tthost'; host.className = 'hud'; host.style.cssText = 'position:fixed;left:200px;top:150px;z-index:99;pointer-events:auto';
      document.body.append(host); window.__rr = 0; const mk = () => { const b = document.createElement('button'); b.className = 'chip'; b.textContent = 'Same'; b.style.cssText = 'width:90px;height:40px'; b.onclick = () => window.__rr++; return b; };
      host.append(mk()); window.__mk = mk; }""")
    await t.touch('touchStart', [(245, 170)]); await t.pg.wait_for_timeout(60)
    await t.ev("() => { const h = document.getElementById('tthost'); h.replaceChildren(window.__mk()); }")
    await t.pg.wait_for_timeout(40); await t.touch('touchEnd', []); await t.pg.wait_for_timeout(250)
    n = await t.ev("() => window.__rr")
    t.ok('a button re-drawn mid-tap still gets it (once)', n == 1, f'{n} clicks')
    # a card that appears under a falling finger is not chosen by that finger
    await t.ev("() => { window.__new = 0; document.getElementById('tthost').replaceChildren(); }")
    await t.touch('touchStart', [(245, 170)]); await t.pg.wait_for_timeout(60)
    await t.ev("""() => { const H = app.match.hud; H.dock.tray.clear(); const b = window.__mk(); b.onclick = () => window.__new++; b.textContent = 'New';
      const card = document.createElement('div'); card.className = 'titem'; card.append(b); card._born = performance.now(); document.getElementById('tthost').append(card); }""")
    await t.pg.wait_for_timeout(40); await t.touch('touchEnd', []); await t.pg.wait_for_timeout(250)
    t.ok('content born under a falling finger is not chosen', await t.ev("() => window.__new") == 0)
    await t.tap(245, 170)
    t.ok('...and the next tap chooses it', await t.ev("() => window.__new") == 1)
    # a modal that closes on a backdrop tap does not click the button under it
    await t.ev("""() => { document.getElementById('tthost').replaceChildren(window.__mk()); window.__rr = 0;
      const m = document.createElement('div'); m.className = 'modal'; m.style.cssText = 'position:fixed;inset:0;z-index:200;background:#0008';
      m.addEventListener('pointerdown', (e) => { if (e.target === m) m.remove(); }); document.body.append(m); }""")
    await t.tap(245, 170); await t.pg.wait_for_timeout(200)
    t.ok('closing a modal on its backdrop clicks nothing under it', await t.ev("() => window.__rr") == 0)
    await t.ev("() => document.getElementById('tthost').remove()")


async def rotate_case(t, w, h):
    # rotate to portrait and back, then tap a hero on the map at once (stale sizes for a frame on iOS)
    await t.reset()
    await t.pg.set_viewport_size({'width': h, 'height': w}); await t.pg.wait_for_timeout(50)
    await t.pg.set_viewport_size({'width': w, 'height': h}); await t.pg.wait_for_timeout(30)
    hid = await t.ev("() => __tt.lone()")
    p = await t.ev(f"() => {{ const r = app.renderer, d = r.heroPos.get({hid}) || app.match.game.units.find((u) => u.id === {hid}), c = r.canvas.getBoundingClientRect(); return {{ x: c.left + c.width / 2 + (d.x - r.cam.x) * r.cam.zoom, y: c.top + c.height / 2 + (d.y - 14 - r.cam.y) * r.cam.zoom }}; }}")
    await t.tap(p['x'], p['y'])
    t.ok('tap right after a rotation picks the hero', await t.ev("() => app.renderer.follow") == hid, await t.ev("() => JSON.stringify({ follow: app.renderer.follow, ring: __tt.ring(), z: app.renderer.cam.zoom, W: app.renderer.W, dpr: app.renderer.dpr, cw: app.renderer.canvas.getBoundingClientRect().width, iw: innerWidth })"))


async def main():
    fails = total = 0
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome')
        for (w, h, sl, sr, st, sb, name) in UA.parse(SPEC):
            ctx = await b.new_context(viewport={'width': w, 'height': h}, has_touch=True, is_mobile=True, device_scale_factor=2)
            await ctx.add_init_script(PREFS)
            pg = await ctx.new_page(); errs = []
            pg.on('pageerror', lambda e: errs.append(str(e)))
            await pg.goto(URL); await pg.wait_for_timeout(3000)
            await pg.evaluate(f"() => {{ const s = document.documentElement.style; s.setProperty('--safe-l', '{sl}px'); s.setProperty('--safe-r', '{sr}px'); s.setProperty('--safe-t', '{st}px'); s.setProperty('--safe-b', '{sb}px'); }}")
            await pg.evaluate(UA.SETUP); await pg.wait_for_timeout(1500)
            await pg.evaluate("app.prepReady()"); await pg.wait_for_timeout(1500)
            await pg.evaluate("app.match.runner.speed = 30"); await pg.wait_for_timeout(2500)
            await pg.evaluate("() => { app.match.runner.speed = 0.0001; const H = app.match.hud; H.director = false; if (H.fightCam) H.fightCam.track = false; app.renderer.follow = null; }")
            await pg.evaluate(HELPERS)
            # edge-of-screen alerts are real buttons that would sit where the staged taps go: out of the way
            await pg.add_style_tag(content='#hud .alert { display: none !important; }')
            await pg.evaluate("async () => { try { window.__pk = await import('./src/ui/tappick.js'); } catch (e) {} }")
            t = T(pg, await ctx.new_cdp_session(pg))
            for f in (map_cases, pick_cases, button_cases):
                try: await f(t)
                except Exception as e: t.ok(f'{f.__name__} ran', False, str(e)[:200])
            try: await rotate_case(t, w, h)
            except Exception as e: t.ok('rotate_case ran', False, str(e)[:200])
            tag = f'{w}x{h}' + (' reduced' if os.environ.get('REDUCED') == '1' else '')
            for (n, ok, info) in t.res: print(f"  {tag} {'PASS' if ok else 'FAIL'} {n}" + (f' ({info})' if info and not ok else ''))
            for e in errs[:3]: print(f'  {tag} JS error: {e[:200]}')
            f = sum(1 for _, ok, _ in t.res if not ok) + len(errs[:3]); fails += f; total += len(t.res)
            print(f'{tag}: {len(t.res) - f}/{len(t.res)} passed', flush=True)
            await ctx.close()
        await b.close()
    print(f'TOTAL: {total} checks, {fails} failed')
    sys.exit(1 if fails else 0)

asyncio.run(main())
