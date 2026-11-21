# MOBA-VS — Design Document (v5.0)

**Live:** https://dianteclark.github.io/MOBA-VS/

> A head-to-head **MOBA manager**. You don't pilot a hero; you *coach* five of them.
> Every hero is a capable AI with its own personality. Your draft, builds, tactic deck and live calls decide the game.

---

## 1. Pillars

1. **Watching is playing.** Everything you need to make a call is on screen: who's missing, which lane is shoved, when the next Kami wakes, which shrine is open.
2. **Calls are bets, not cheats.** Heroes follow you, but they keep their survival instincts, and a bad call costs time, lives and *trust*.
3. **Our own world.** Spirits instead of dragons, shrines instead of passive rivers, weather that changes the fight, heroes with personalities.
4. **Short and decisive.** 15-minute matches with a tower-count finish. Every minute matters.
5. **Fair and deterministic.** Point-symmetric maps; both peers run the same simulation bit-for-bit; only commands travel.

## 2. Match flow

| Phase | What you do |
|---|---|
| Lobby | Host gets a 5-letter room code (or play vs AI / watch AI vs AI). Pick a map or Random. |
| **Draft** | Tournament bans/picks from 40 heroes, 5 roles. Bans are always manual (with suggested bans). With an active **lineup**, your picks lock in automatically (backup if the main is gone, a 3-hero prompt if both are). |
| **Prep** | A quick confirm: lanes, builds, team plan and **3 tactic cards** come prefilled from your lineup; *Adjust* opens the editors. |
| **Match** | 15:00 countdown. Make calls with your command charges; play your tactic cards. |
| Results | Play of the Game (replayed from the match replay), coach report card (Calls / Objectives / Macro grades + one tip), MVP, stats, gold-lead graph, call log with outcomes. |

**Victory:** destroy the enemy Shrine Crystal, or have **more towers standing at 0:00**. Tiebreaks: Crystal HP, then kills, then gold.

## 3. Maps

Four handcrafted maps share the same rules (3 lanes, 3 towers + gate per lane, 2 base towers, Crystal, 6 jungle camps per side, Kami pit, Kraken pit, 2 river shrines) but differ in layout, theme and weather:

| Map | Theme | Character | Weather cycle |
|---|---|---|---|
| **Sakura Valley** | Spring | Classic, wide river, balanced jungle | clear, rain, fog, gale |
| **Frostfang Pass** | Winter | Winding lanes, frozen central lake, long rotations | snow, blizzard, fog |
| **Ember Canyon** | Autumn | Tight canyon lanes, brawly | gale, heatwave, dust storm |
| **Moonlit Marsh** | Night | Misty swamp, reed beds, two jungle crossings | fog, rain |

Maps are authored for one half and point-mirrored. Trees and rocks are **real walls**: they block movement and line of sight. **Tall grass** hides units (attacking reveals you). Towers sit beside the lanes.

**Living map:**
* **River shrines:** stand on one to capture it. Owner gets +5% team damage, vision around it, and healing on the platform.
* **Weather** changes every 2.5 minutes: rain (vision −15%, burns −30%), fog (vision −30%), gale (move +5%, projectiles +20%), snow, blizzard, heatwave (burns +35%, regen −40%), dust storm.

## 4. Objectives

| Objective | When | Reward |
|---|---|---|
| **Kami** (Ember, Tide, Stone, Gale) | 1:30, every 2:00 | Team blessing stack; 4 = Kami Blessing; then **Ancient Kami** (execute low-HP enemies) |
| **Oni** | 3:00 → leaves at 7:30 | **Oni Mask**: unleash the Oni down a lane to smash towers |
| **Kraken** | 7:30, every 3:00 | Kraken's Wrath: +power and empowered minions for 75s |
| **Gate** (inhibitor) | — | Destroyed gate spawns super minions in that lane until it's restored (3:00) |

Objectives are **only started by your calls**. Junglers auto-smite to secure (or steal) them.

## 5. Heroes

40 heroes (8 per clan) across five roles (Top, Jungle, Mid, Bot, Support), many with a flex role. Each has a passive, two abilities and an ultimate (level 5), all data-driven.

* **Range tiers:** melee 55, short 150, long 180. Towers 255 out-range every hero. Ability ranges are capped.
* **Clans:** Shinobi, Beast, Spirit, Iron, Wild. 2+ and 3+ of a clan give team bonuses.
* **Personalities:** Reckless, Cautious, Greedy, Loyal, Hothead, Calm. These shape aggression, discipline, dodging, reaction time, greed, peel, and how fast they trust you.
* **Builds:** Burst, Burn, Tank, Sustain, Crit, Haste, Guardian (5 items each). Pivot mid-game with a call.

### Dojo
Browse every hero: animated sprite, abilities in plain English, 0-10 ratings (Damage, Toughness, Control, Mobility, Range, Sustain, Difficulty; computed from hero data in `src/data/herostats.js` and spread across the roster), Strong vs / Weak vs, your own record, and skins.
**Lineups:** 5 presets (`src/presets.js`), each with a hero + backup per role, builds, a team plan and 3 tactic cards. The starred lineup drives draft auto-picks and prep.

## 6. Coaching

### Calls (command charges: max 3, +1 every 20s)
Six big buttons: **Gank · Objective · Push · Shrine · Defend · Regroup**. Each opens one sheet of big target tiles (lanes show live hints like "Overextended!"; objectives show live timers) or fires instantly.
* **Tap the map:** a call ring appears where you tapped, with only the calls that fit (lane → Gank/Push/Split/Oni, pit → Take it, shrine → Capture, enemy → Focus, enemy jungle → Invade).
* **Decision tray:** one slot directly above the call buttons, a priority queue (never stacked): Coach's Calls > hero requests > Kami Surge > call payoffs > one-tap analyst suggestions ("Mid overextended: Gank"). Gold = act now, red = danger, team colour = your hero.
* **Coach's Call moments:** at key moments (objective waking or contested, enemy jungler spotted far from an objective, teamfight brewing, enemy tower low, enemy carry caught out) a card offers 2-3 concrete options that are ordinary calls (cost pips shown). Vs AI, time slows to 0.25x for up to 3s while it is up (runner speed only); online it is just a timed card. At least 45s apart, at most 8 a match, never around halftime.
* **Heroes ask you:** "Kurai: I can solo-kill their mid. Go?" Yes sends a `permit` (a short green-lit solo task: hunt that target for 12s, or split-push a lane for 60s; free, one per team every 20s); No costs nothing. Reckless and hothead heroes ask most, cautious ones least. The outcome moves that hero's trust (+10 / -3).
* **Payoffs:** when a call resolves the tray shows CALL PAID OFF (+trust) or a one-line reason ("Gank failed: enemy flashed / target recalled / jungler died first"). The sim records the reason.
* **Context-aware buttons:** calls that fit the moment glow gold (Defend glows red while a structure is under attack); calls that cannot help right now dim.
* **Momentum & Kami Surge:** a team meter (in the charge meter) fills from paid-off calls (+14), kills (+4), objectives (+18), towers (+10) and shrines (+8). Full: tap it for Kami Surge, +10% damage and +5% move speed for 8s for the whole team. The AI coach spends it on even-or-better fights in the open and objective races.
* Tap your hero's portrait to change its build; tap an enemy portrait to Focus them. A Cancel pill appears while calls are active.
* Keys: G O R K X B (calls), Q E T (cards), U (ults), V (Kami Surge), C (cancel), Esc.

### Trust
Each hero has trust 0–100. Successful calls raise it; deaths on your calls, stolen objectives and wasted calls lower it.
* **Inspired (70+):** answers calls instantly, +4% damage, commits harder.
* **Doubtful (≤30):** hesitates 1–2s before following calls, −3% damage.
* Hotheads tilt for 60s after dying. Emotes over heroes show reactions.

### Tactic cards (pick 3, each usable once)
Shown as a hand of big cards above the calls. Smoke Bomb · Ambush · Rally Cry · Second Wind · Siege Formation · Ward Sweep · Bait · Lane Swap · Fortify · Ancient Pact · Spirit Eyes · War Council · Kami Barrier · Spirit Gate.

### Ult calls
Auto (heroes decide) · **Hold** (save ultimates for kills/self-defence, 45s) · **ALL-IN** (fire them in the next fight, 20s). Free.

### Halftime (7:30) and Last Stand (12:00+)
At 7:30 the match pauses (up to 20s, both coaches ready to skip): change plan, builds and swap one unused card. In the final 3 minutes gold rewards are ×1.5 and respawns ×1.25.

### Ticker, alerts and fight cam
A single priority ticker line under the score (only what your team can see: missing enemies, objectives waking, captures, towers). Off-screen edge arrows show fights, structures and objectives under attack; a fight with 3+ heroes becomes "FIGHT AT KAMI, tap to watch": tapping cuts the camera there and the first big ultimate plays in brief slow motion (off with Reduced motion).

### Play of the Game & report card
At the end the event log is scanned for the ~12s window with the biggest swing for the winner (kills, ultimates, objectives, towers). The results screen replays it: a fresh game is fast-forwarded headlessly from the replay (config + command log) to the window, then shown with the director camera. The coach report card grades Calls, Objectives and Macro (S-D) and gives one concrete tip.

## 7. Seasons, ranks and the Cup

* **Seasons** (~10 weeks): a theme, a featured map (comes up most in Random) and a featured clan (bonus pass XP). Calendar in `src/data/seasons.js`.
* **Ranked ladder:** Ronin → Samurai → Daimyo → Shogun → Kami-touched (divisions III–I). RP per win: Easy 8, Normal 18, Hard 26, Online 24, Cup 20. Easy AI caps at Samurai, Normal at Shogun. Soft reset each season; peak Samurai+ earns a border.
* **Season Pass:** 20 levels of XP (win 120, loss 70, +15 per successful call, +10 per featured-clan hero, +50 in the Cup). Rewards are cosmetic only: hero skins (palette variants), banners, titles.
* **Season Cup:** 8-team knockout vs AI teams (★ to ★★★). Final on the featured map. Champion: Golden Cup, "Cup Champion" title and banner. Finalist: Silver Cup.
* **Auto-balance:** when a season starts, a GitHub Action plays hundreds of self-play matches and moves each legend toward 50% win rate (max ±5% per season), then publishes the patch notes and bumps the netcode version. Real match reports can be added later through `data/matches/`.
* Profiles live in the browser for now; every match is saved in a compact, backend-ready format.

## 8. AI

* **Macro (2×/s):** lane / jungle routing / recall / defend / contest / help a fighting ally / shrines / call tasks.
* **Micro (every tick):** dodge skillshots and telegraphs, fight-or-flight via Lanchester strength (towers count only when they can shoot), sticky target choice (killable, focus calls, carries, peel), role positioning (kiting, divers, supports escorting the carry), lane trading discipline, Flash + escapes.
* Vision-limited: AI only reacts to what its team sees.

## 9. Mobile & technology

* Phone-first HUD (portrait and landscape): Menu dropdown, finger-sized hit areas, a wide camera, a one-row landscape dock, and a graphics setting (Auto/Sharp/Battery).
* Installable web app (manifest + network-first service worker), full-screen button.
* Replays = match config + command log (the sim is deterministic).


* Static ES-module web app (GitHub Pages). Canvas 2D renderer.
* Deterministic sim at 20 Hz, seeded PRNG, IEEE-exact math only, integer A*.
* Lockstep netcode over WebRTC (PeerJS); periodic checksums detect desyncs; AI coach takes over if a peer leaves.
* Tooling: determinism, lockstep, map connectivity, stuck-unit, balance, self-play tuner and UI-overlap audits.
