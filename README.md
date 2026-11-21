# MOBA-VS

## ▶ Play now: **https://dianteclark.github.io/MOBA-VS/**

*(Served by GitHub Pages from `main` / root. If the link 404s, enable it in Settings → Pages → Deploy from branch → `main` / `(root)`.)*
Invite a friend straight into your room: `https://dianteclark.github.io/MOBA-VS/?join=CODE`

A peer-to-peer **MOBA manager** in the browser. You don't pilot a hero; you coach five of them.
Draft, pick builds and a tactic deck, then win the match with your calls.

* **15-minute matches.** If no Crystal falls, the team with more towers standing when the clock hits 0:00 wins.
* **Three handcrafted maps** (Sakura Valley, Frostfang Pass, Ember Canyon) with real walls, tall grass, line-of-sight fog, river shrines and changing weather.
* **25 heroes**, each with a clan (Shinobi, Beast, Spirit, Iron, Wild) and a personality (Reckless, Cautious, Greedy, Loyal, Hothead, Calm).
* **Trust:** good calls inspire your heroes; bad ones make them hesitate.
* **Tactic cards:** Smoke Bomb, Ambush, Rally Cry, Second Wind, Siege Formation, Ward Sweep, Bait, Lane Swap, Fortify, Ancient Pact.
* **Our world:** Kami spirits (Ember, Tide, Stone, Gale, Ancient), the Oni, the Kraken and the Shrine Crystal.

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
node tools/maps.mjs [outdir]      # every map fully connected (+ preview images)
node tools/stuck.mjs              # pathing regression: heroes that stop making progress
node tools/balance.mjs 50         # AI-vs-AI batch: side win rates, kills, hero table
node tools/tune.mjs 2 80 2        # self-play tuner → writes src/data/tuning.js
python3 tools/ui_audit.py http://localhost:8000/index.html   # HUD overlap audit, 10 viewports
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
