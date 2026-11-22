# Fight pop-up check in the real game (Playwright): on every classic map and both Lane Rush maps, plays a vs-AI
# match at speed until "FIGHT AT ..." prompts appear, then for several of them
#   * the prompt's name matches the shared place helper (src/world/places.js) for the centroid of the
#     visible heroes in that fight, as the game is right now,
#   * tapping it (Alerts.go, the prompt's own tap) puts the camera on the fight, and 1.5s later the camera is
#     still within the fight's radius as it moves (or the fight is on screen with the camera clamped at the map edge).
#   python3 tools/places_test.py URL [viewport=844x390] [maps=all] [fights=3]
import sys, asyncio
from playwright.async_api import async_playwright
URL = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8855/'
VW, VH = map(int, (sys.argv[2] if len(sys.argv) > 2 and sys.argv[2] else '844x390').split('x'))
MAPS = (sys.argv[3] if len(sys.argv) > 3 and sys.argv[3] not in ('', 'all') else 'sakura,frost,ember,marsh,oasis,ruins,rush_sakura,rush_ember').split(',')
FIGHTS = int(sys.argv[4]) if len(sys.argv) > 4 else 3

SETUP = """async (id) => {
  app.startVsAI(id.startsWith('rush_') ? 'rush' : 'classic', true);
  const m = await import('./src/sim/draft.js'); const s = app.session; s.mapId = id;
  while (!s.draft.done) { const t = m.currentTurn(s.draft); m.apply(s.draft, t.team, m.autoChoice(s.draft, t.team, s.rng, 1)); }
  app.afterDraftAct();
}"""
# The open big-fight prompt (if any): its label against the helper, then tap it.
PICK = """async () => {
  const P = await import('./src/world/places.js'), H = app.match.hud, g = app.match.game, r = H.r;
  const it = [...H.alerts.items.values()].find((q) => q.kind === 'bigfight');
  if (!it) return null;
  const see = H.my >= 0 ? (x) => r.visible(x) : null;
  const f = P.fightClusters(g, see).filter((q) => q.n >= 3).sort((a, b) => Math.hypot(a.x - it.x, a.y - it.y) - Math.hypot(b.x - it.x, b.y - it.y))[0];
  const want = f ? 'FIGHT AT ' + P.placeName(g.world, f, { my: H.my >= 0 ? H.view : -1, g }).short : null;
  const res = { map: g.world.def.id, t: Math.round(g.time), label: it.label, want, at: [Math.round(it.x), Math.round(it.y)], fc: f ? [Math.round(f.x), Math.round(f.y), Math.round(f.r)] : null };
  H.alerts.go(it);
  res.cam0 = [Math.round(r.cam.x), Math.round(r.cam.y)];
  return res;
}"""
CHECK = """async () => {
  const P = await import('./src/world/places.js'), H = app.match.hud, g = app.match.game, r = H.r, fc = H.fightCam;
  const see = H.my >= 0 ? (x) => r.visible(x) : null;
  const ids = fc ? fc.ids : [];
  let best = null, bn = 0;
  for (const f of P.fightClusters(g, see)) { const n = f.ids.filter((id) => ids.includes(id)).length; if (n > bn) { bn = n; best = f; } }
  const s = best && r.w2s(best.x, best.y), W = r.cssW || innerWidth, Hh = r.cssH || innerHeight;
  return { cam: [Math.round(r.cam.x), Math.round(r.cam.y)], fight: best ? [Math.round(best.x), Math.round(best.y), Math.round(best.r)] : null,
    onScreen: !!s && s.x / r.dpr > 0 && s.x / r.dpr < W && s.y / r.dpr > 0 && s.y / r.dpr < Hh, track: !!(fc && fc.track) };
}"""

async def main():
    bad = 0
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome')
        for mid in MAPS:
            ctx = await b.new_context(viewport={'width': VW, 'height': VH}, has_touch=VW < 1000, is_mobile=VW < 1000, device_scale_factor=2 if VW < 1000 else 1)
            pg = await ctx.new_page(); errs = []
            pg.on('pageerror', lambda e: errs.append(str(e)))
            await pg.goto(URL); await pg.wait_for_timeout(2500)
            await pg.evaluate(SETUP, mid); await pg.wait_for_timeout(1500)
            await pg.evaluate("app.prepReady()"); await pg.wait_for_timeout(1500)
            got, tries, issues = 0, 0, []
            while got < FIGHTS and tries < 150:
                tries += 1
                await pg.evaluate("app.match.runner.speed = 12"); await pg.wait_for_timeout(700)
                await pg.evaluate("app.match.runner.speed = 1")
                if await pg.evaluate("!app.match || app.match.game.over"): break
                await pg.wait_for_timeout(250)
                res = await pg.evaluate(PICK)
                if not res: continue
                got += 1
                if res['label'] != res['want']: issues.append(f"{res['t']}s prompt says '{res['label']}' but the fight at {res['fc']} is '{res['want']}'")
                f = res['fc']
                if f and ((res['cam0'][0] - f[0]) ** 2 + (res['cam0'][1] - f[1]) ** 2) ** 0.5 > f[2]:
                    # the camera may be clamped at the map edge: then the fight must still be on screen
                    c0 = await pg.evaluate(CHECK)
                    if not c0['onScreen']: issues.append(f"{res['t']}s tap put the camera at {res['cam0']}, fight at {f}")
                await pg.wait_for_timeout(1500)
                c = await pg.evaluate(CHECK)
                if c['fight']:
                    fx, fy, fr = c['fight']; d = ((c['cam'][0] - fx) ** 2 + (c['cam'][1] - fy) ** 2) ** 0.5
                    if d > fr and not c['onScreen']: issues.append(f"{res['t']}s +1.5s: camera {c['cam']} lost the fight at {c['fight']} ({int(d)} away)")
                print(f"  {mid} {res['t']}s {res['label']} (fight {f}) cam {res['cam0']} → +1.5s cam {c['cam']} fight {c['fight']} {'tracking' if c['track'] else 'done'}", flush=True)
                await pg.evaluate("app.match.hud.manualCam()")
            if got == 0: issues.append('no big fight prompt appeared')
            issues += [f'JS error: {e}' for e in errs[:3]]
            print(f"{mid}: {got} prompts checked, " + ('OK' if not issues else f'{len(issues)} issue(s)'), flush=True)
            for s in issues: print('   ', s)
            bad += len(issues)
            await ctx.close()
        await b.close()
    sys.exit(1 if bad else 0)
asyncio.run(main())
