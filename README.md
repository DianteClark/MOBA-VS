# MOBA-VS

## ▶ Play now: **https://dianteclark.github.io/MOBA-VS/**

*(Served by GitHub Pages from `main` / root. If the link 404s, enable it in Settings → Pages → Deploy from branch → `main` / `(root)`.)*
Invite a friend straight into your room: `https://dianteclark.github.io/MOBA-VS/?join=CODE`

A peer-to-peer **MOBA manager** in the browser. You don't pilot a hero; you coach five of them.
Draft, pick builds and a tactic deck, then win the match with your calls.

**v5.0, built for phones first** (portrait and landscape, installable: *Share → Add to Home Screen*), and it plays great on desktop too.

* **15-minute matches.** If no Crystal falls, the team with more towers standing at 0:00 wins. **Halftime** at 7:30 and a **Last Stand** for the final 3 minutes.
* **Four handcrafted maps:** Sakura Valley, Frostfang Pass, Ember Canyon and Moonlit Marsh. Real walls, tall grass, line-of-sight fog, river shrines and changing weather.
* **40 heroes**, each with a clan (Shinobi, Beast, Spirit, Iron, Wild) and a personality that shapes how they play and how fast they trust you.
* **Simple, deep calling:** six big calls, tap-the-map call ring, one-tap analyst suggestions, ult calls (Auto / Hold / ALL-IN), and 14 tactic cards.
* **Seasons:** ranked ladder, a 20-level pass with skins, banners and titles, the Season Cup, and automatic season-end balancing.
* **Replays** of your last match; peer-to-peer online play with deterministic lockstep.

Modes: **Play vs AI** (Easy / Normal / Hard), **Host / Join** (WebRTC, deterministic lockstep), **Watch AI vs AI**.

See **[DESIGN.md](DESIGN.md)** for the full design.

## Running locally

```bash
python3 -m http.server 8000      # ES modules need an HTTP server
# open http://localhost:8000      (add ?local=1 to test Host/Join in two tabs)
```

## Tools

```bash
node tools/determinism.mjs        # same seed + commands → identical checksums
node tools/lockstep.mjs           # two peers over a laggy link stay in sync
node tools/maps.mjs [outdir]      # every map fully connected, pits/camps out of tower range (+ previews)
node tools/pathq.mjs 6 2           # movement quality: stuck, jitter, facing flips, wall scrapes, A* cost
node tools/replay.mjs             # a recorded match replays to the identical checksum
node tools/balance.mjs 50         # AI-vs-AI batch: side win rates, kills, hero table
node tools/tune.mjs 2 80 2        # self-play tuner → writes src/data/tuning.js
python3 tools/ui_audit.py http://localhost:8000/ "" iphones   # HUD audit: every iPhone (PWA + Safari, notch insets), 12 popup states
python3 tools/screen_audit.py http://localhost:8000/ out       # every menu scene: overflow, safe area, overlaps (+ screenshots)
python3 tools/viewport_test.py http://localhost:8000/          # rotate/resume: canvas size = CSS x DPR, taps land right
python3 tools/sw_test.py                                       # service worker: offline, deploys, never mid-match, VERSION bump
python3 tools/chat_test.py http://localhost:8000/              # quick chat across two ?local=1 tabs
```

`dev.html?map=frost&fog=0&speed=4` is a bare AI-vs-AI viewer for debugging.

## Project layout

```
src/sim/     deterministic simulation: game, world (grid/A*/vision), AI, coach, draft rules
src/maps/    map definitions (authored for one half, mirrored)
src/data/    heroes, item builds, tactic cards, tuning
src/render/  canvas renderer, map painter, minimap, camera input, assets
src/ui/      menu / draft / prep / HUD / results
src/net/     lockstep runner + PeerJS transport
tools/       headless tests, balance, tuning, UI audit
```

## Credits

Art, music and sound: [Ninja Adventure Asset Pack](https://pixel-boy.itch.io/ninja-adventure-asset-pack) by Pixel-boy & AAA, CC0.

## Seasons & balance

* `src/data/seasons.js`: season calendar (themes, featured map/clan), rank tiers, pass rewards, skins.
* `tools/season.mjs`: the season balancer. Runs self-play, moves each legend toward 50% (max ±5% per season),
  writes `src/data/tuning.js`, prepends patch notes and bumps the netcode version.
* `.github/workflows/season.yml`: runs the balancer daily; it only acts when a new season starts
  (or when run by hand with **force**). Real match reports dropped in `data/matches/` are counted too.
