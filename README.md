# MOBA-VS

A peer-to-peer **MOBA manager** that runs in the browser. Draft five heroes, choose their builds, then coach them through a fully simulated 5v5 match by making calls: gank bot, take dragon, focus their carry, play safe.

Every hero is a capable AI. Your draft, builds and calls decide who wins.

## ▶ Play now: **https://dianteclark.github.io/MOBA-VS/**

*(Served by GitHub Pages from `main` / root. If the link 404s, enable it in Settings → Pages → Deploy from branch → `main` / `(root)`.)*

Invite a friend straight into your room: `https://dianteclark.github.io/MOBA-VS/?join=CODE`

* **vs AI**: instant match against an AI coach.
* **Host / Join**: share the 5-letter room code with a friend. Matches are peer-to-peer (WebRTC) and fully deterministic, so both screens play out the same game.

See **[DESIGN.md](DESIGN.md)** for the full design.

## Running locally

ES modules need an HTTP server:

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

## Tools

```bash
node tools/determinism.mjs      # same seed + commands → identical checksums
node tools/balance.mjs 200      # 200 AI-vs-AI games, win rates by hero and side
```

## Credits

Art, music and sound: [Ninja Adventure Asset Pack](https://pixel-boy.itch.io/ninja-adventure-asset-pack) by Pixel-boy & AAA, CC0.
