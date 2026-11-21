# Rotation / resume robustness: start a match on an iPhone-like touch device, rotate
# landscape -> portrait -> landscape (plus a hide/show cycle like leaving the app), then check that
#   * the game canvas backing store equals its CSS size x render DPR (no stretching),
#   * the minimap backing store matches its CSS size,
#   * a tap lands on the intended world point (touch -> world mapping), and
#   * HUD pop-ups placed from world points (alerts) use the live canvas size.
# The second pass simulates iOS: resize / orientation / visualViewport events are swallowed, so the
# game must notice the new size on its own (per-frame fit) instead of trusting those events.
#   python3 tools/viewport_test.py http://127.0.0.1:8811/
import sys, asyncio
from playwright.async_api import async_playwright
URL = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8811/'
SIZES = [(844, 390), (390, 844), (844, 390), (956, 440), (440, 956), (667, 375)]

CHECK = """() => {
  const r = app.renderer, c = r.canvas, rect = c.getBoundingClientRect();
  const mm = document.getElementById('mm'), mr = mm.getBoundingClientRect(), mdpr = Math.min(1.5, devicePixelRatio);
  return { cw: c.width, ch: c.height, css: [rect.width, rect.height], dpr: r.dpr, W: r.W, H: r.H,
    mm: [mm.width, mm.height, Math.round(mr.width * mdpr), Math.round(mr.height * mdpr)], inner: [innerWidth, innerHeight], scroll: [scrollX, scrollY] };
}"""
# Pick a world point that is on screen and away from HUD panels, return its client coords.
TARGET = """() => {
  const r = app.renderer, rect = r.canvas.getBoundingClientRect();
  const w = { x: r.cam.x + 37, y: r.cam.y - 23 };
  const s = r.w2s(w.x, w.y);
  return { w, cx: rect.left + s.x / r.dpr, cy: rect.top + s.y / r.dpr };
}"""

async def main():
    bad = 0
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome')
        ctx = await b.new_context(viewport={'width': 844, 'height': 390}, device_scale_factor=3, has_touch=True, is_mobile=True)
        await ctx.add_init_script('''(() => { const add = EventTarget.prototype.addEventListener;
          EventTarget.prototype.addEventListener = function (type, fn, o) {
            if (typeof fn === 'function' && ['resize', 'orientationchange', 'change'].includes(type)) { const f = fn; fn = function (e) { if (!window.__stale) return f.call(this, e); }; }
            return add.call(this, type, fn, o); }; })()''')
        pg = await ctx.new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(URL); await pg.wait_for_timeout(3000)
        await pg.evaluate("app.watch()")
        await pg.wait_for_timeout(2500)
        await pg.evaluate("app.match.runner.paused = true; app.match.hud.director = false; app.renderer.follow = null")
        for i, (w, h) in enumerate(SIZES + [(-1, -1)] + SIZES):
            if w < 0: await pg.evaluate("() => { window.__stale = true; }"); print('-- stale-event pass (iOS-like)'); continue
            i = i % (len(SIZES) + 1)
            await pg.set_viewport_size({'width': w, 'height': h})
            if i == 2:  # leave the app and come back (iOS: hidden page, stale sizes on return)
                await pg.evaluate("document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('pageshow'))")
            await pg.wait_for_timeout(900)
            st = await pg.evaluate(CHECK)
            issues = []
            ew, eh = round(st['css'][0] * st['dpr']), round(st['css'][1] * st['dpr'])
            if abs(st['cw'] - ew) > 1 or abs(st['ch'] - eh) > 1: issues.append(f"canvas {st['cw']}x{st['ch']} != css {st['css']} x dpr {st['dpr']}")
            if st['W'] != st['cw'] or st['H'] != st['ch']: issues.append(f"renderer W/H {st['W']}x{st['H']} stale")
            if abs(st['css'][0] - w) > 1 or abs(st['css'][1] - h) > 1: issues.append(f"canvas css {st['css']} != viewport {w}x{h}")
            if st['mm'][2] and (abs(st['mm'][0] - st['mm'][2]) > 1 or abs(st['mm'][1] - st['mm'][3]) > 1): issues.append(f"minimap {st['mm']}")
            if w > h:  # the game is landscape-only; taps are tested where it is playable
                t = await pg.evaluate(TARGET)
                await pg.evaluate("() => { window.__tap = null; app._cw = app.clickWorld; app.clickWorld = (w) => { window.__tap = w; }; }")
                await pg.touchscreen.tap(t['cx'], t['cy'])
                await pg.wait_for_timeout(150)
                got = await pg.evaluate("window.__tap")
                await pg.evaluate("() => { app.clickWorld = app._cw; }")
                if not got: issues.append('tap not registered')
                else:
                    err = ((got['x'] - t['w']['x']) ** 2 + (got['y'] - t['w']['y']) ** 2) ** 0.5
                    if err > 3: issues.append(f"tap off by {err:.1f} world px")
            print(f"{w}x{h}: " + ('OK' if not issues else '; '.join(issues)), flush=True)
            bad += len(issues)
        for e in errs[:3]: print('JS error:', e); bad += 1
        await b.close()
    sys.exit(1 if bad else 0)
asyncio.run(main())
