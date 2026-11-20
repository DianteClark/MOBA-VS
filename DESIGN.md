# MOBA-VS — Design Document (v1.0)

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
| **Draft** | Tournament bans/picks from 25 heroes, 5 roles. Clans and matchups are shown live. Any unbanned hero can be picked. |
| **Prep** | Lanes, build path per hero, team plan, and **3 tactic cards** for your deck. |
| **Match** | 15:00 countdown. Make calls with your command charges; play your tactic cards. |
| Results | MVP, stats, gold-lead graph, call log with outcomes. |

**Victory:** destroy the enemy Shrine Crystal, or have **more towers standing at 0:00**. Tiebreaks: Crystal HP, then kills, then gold.

## 3. Maps

Three handcrafted maps share the same rules (3 lanes, 3 towers + gate per lane, 2 base towers, Crystal, 6 jungle camps per side, Kami pit, Kraken pit, 2 river shrines) but differ in layout, theme and weather:

| Map | Theme | Character | Weather cycle |
|---|---|---|---|
| **Sakura Valley** | Spring | Classic, wide river, balanced jungle | clear, rain, fog, gale |
| **Frostfang Pass** | Winter | Winding lanes, frozen central lake, long rotations | snow, blizzard, fog |
| **Ember Canyon** | Autumn | Tight canyon lanes, brawly | gale, heatwave, dust storm |

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

25 heroes, 5 per role (Top, Jungle, Mid, Bot, Support). Each has a passive, two abilities and an ultimate (level 5), all data-driven.

* **Range tiers:** melee 55, short 150, long 180. Towers 255 out-range every hero. Ability ranges are capped.
* **Clans:** Shinobi, Beast, Spirit, Iron, Wild. 2+ and 3+ of a clan give team bonuses.
* **Personalities:** Reckless, Cautious, Greedy, Loyal, Hothead, Calm. These shape aggression, discipline, dodging, reaction time, greed, peel, and how fast they trust you.
* **Builds:** Burst, Burn, Tank, Sustain, Crit, Haste, Guardian (5 items each). Pivot mid-game with a call.

## 6. Coaching

### Calls (command charges: max 3, +1 every 20s)
Gank, Objective (2), Shrine, Group, Split, Focus, Safe, Reset, Invade (2), Oni (free), Build pivot (free), Cancel.

### Trust
Each hero has trust 0–100. Successful calls raise it; deaths on your calls, stolen objectives and wasted calls lower it.
* **Inspired (70+):** answers calls instantly, +4% damage, commits harder.
* **Doubtful (≤30):** hesitates 1–2s before following calls, −3% damage.
* Hotheads tilt for 60s after dying. Emotes over heroes show reactions.

### Tactic cards (pick 3, each usable once)
Smoke Bomb · Ambush · Rally Cry · Second Wind · Siege Formation · Ward Sweep · Bait · Lane Swap · Fortify · Ancient Pact.

### Analyst feed
Only what your team can see: overextended laners (one-tap Gank), open shrines, enemy on an objective (Contest), missing enemies, numbers advantage.

## 7. AI

* **Macro (2×/s):** lane / jungle routing / recall / defend / contest / help a fighting ally / shrines / call tasks.
* **Micro (every tick):** dodge skillshots and telegraphs, fight-or-flight via Lanchester strength (towers count only when they can shoot), sticky target choice (killable, focus calls, carries, peel), role positioning (kiting, divers, supports escorting the carry), lane trading discipline, Flash + escapes.
* Vision-limited: AI only reacts to what its team sees.

## 8. Technology

* Static ES-module web app (GitHub Pages). Canvas 2D renderer.
* Deterministic sim at 20 Hz, seeded PRNG, IEEE-exact math only, integer A*.
* Lockstep netcode over WebRTC (PeerJS); periodic checksums detect desyncs; AI coach takes over if a peer leaves.
* Tooling: determinism, lockstep, map connectivity, stuck-unit, balance, self-play tuner and UI-overlap audits.
