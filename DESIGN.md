# MOBA-VS — Design Document

**Live:** https://dianteclark.github.io/MOBA-VS/

> A head-to-head **MOBA manager**. You don't pilot a hero; you *coach* five of them.
> Every hero is a competent AI. Draft, builds and live **calls** are what decide the game.

---

## 1. Pillars

1. **Watching is playing.** The match is simulated in real time and everything you need to make a decision is on screen: who's missing from a lane, which lane is shoved, when dragon spawns.
2. **Calls are bets, not cheats.** Your heroes follow calls, but a bad call still costs you: a gank into fog, a dragon fight while your bot lane is dead. AI heroes keep self-preservation, so they won't suicide on command, but they will lose tempo.
3. **Draft and builds matter before the first minion spawns.** Counters, power curves and team composition create edges that compound.
4. **Fair, deterministic and peer-to-peer.** Both browsers run the identical simulation; only commands travel over the wire.

---

## 2. Match flow

| Phase | Length | What you do |
|---|---|---|
| Lobby | — | Host creates a room code, guest joins (or play vs AI) |
| **Draft** | ~3 min | Alternating bans and picks; 25-hero pool, 5 roles |
| **Prep** | 45 s | Assign lanes, choose each hero's **build path**, pick a **team game plan** |
| **Match** | ~12–18 min | Watch, read the map, make **calls** with your command budget |
| Results | — | Stats, gold graph, call log (what you called and what happened) |

### 2.1 Draft (tournament style)

```
Ban phase 1:  B  R  B  R            (2 bans each)
Pick phase 1: B  R R  B B  R        (3 picks each)
Ban phase 2:  R  B                  (1 ban each)
Pick phase 2: R  B B  R             (2 picks each)
```

* 30 s per turn; on timeout the best available pick for an unfilled role is auto-locked.
* Each hero lists a **primary role** and sometimes a **flex role**. A pick is only legal if your team can still field all five roles.
* Hovering a hero shows its **counter notes** against already-locked enemies.

### 2.2 Prep — builds & plan

Each hero has 2–3 allowed **build paths** (5 items each, bought automatically when the hero is at base with enough gold):

| Build | Identity | Good against |
|---|---|---|
| **Burst** | Raw damage + penetration, executes low-HP targets | Squishy carries, no-tank comps |
| **Burn** | Damage over time scaling on target **max HP** + grievous wounds | Tanks, healers, lifesteal |
| **Tank** | HP, armor, MR, thorns | Burst / assassin comps |
| **Sustain** | Lifesteal / omnivamp, regen | Poke, long lane phases |
| **Crit** | Crit chance, crit damage, attack speed | Long fights, front-to-back |
| **Haste** | Ability haste + mana flow, utility | Teams that need CC uptime |
| **Guardian** | Heal/shield power, auras | Protecting a hyper-carry |

You can **pivot** a hero's build mid-game with a call: future purchases switch paths (items already bought stay).

**Team game plan** (biases every AI's risk tolerance):

* **Aggressive:** more trades, earlier roams, AI chases further.
* **Balanced:** default.
* **Scaling:** safer laning, farm priority, avoids even fights before 2 items.

### 2.3 Calls (the core verb)

You have a **Command meter**: max 3 charges, +1 charge every 20 s. A dot pops on the meter when a call is affordable.

| Call | Cost | Effect |
|---|---|---|
| **Gank** `lane` | 1 | Jungler (or a picked roamer) paths to the lane via the river/jungle and fights with the laner |
| **Take objective** `Dragon/Herald/Baron` | 2 | Nearest 3–5 heroes group and start the objective |
| **Group** `lane` | 1 | Team collapses on a lane to push towers together |
| **Split** `hero` `lane` | 1 | One hero side-lanes alone; others play around it |
| **Focus** `enemy hero` | 1 | All heroes prioritise this target for 20 s |
| **Play safe** | 1 | Team holds under towers for 25 s (no trading, no facechecks) |
| **Reset** | 1 | Everyone recalls and buys |
| **Invade** | 2 | Jungler + 1 steal the enemy's next camp |
| **Drop Herald** `lane` | 0 | Only after taking Herald — summon a tower-breaker in that lane |
| **Pivot build** `hero` `build` | 0 | Change future item purchases |
| **Cancel** | 0 | Clear the active team call |

**Rules that make calls matter:**

* AI heroes **only know what their team can see** (fog of war). A call made with good information is stronger than any AI default.
* Heroes will **break off** a call to save their own life (HP below 25% and threatened), so you can't run your team into a wall, but the time you wasted is still gone.
* Objectives are **never** taken autonomously. Only your calls start Dragon, Herald or Baron. (AIs will still defend an objective being taken by the enemy if they see it.)
* Junglers gank autonomously only on near-certain opportunities, so most good ganks come from you.

### 2.4 Analyst feed

A scrolling ticker of *visible* information so you can react without staring at every lane:

* “Enemy jungler spotted top side (3:41)”
* “Bot lane shoved under enemy tower”
* “Dragon spawns in 30 s — Infernal”
* “Mid lane missing for 12 s” (enemy hero not visible anywhere)

---

## 3. The map

A 3-lane map on a 2400 × 2400 world grid. Blue base bottom-left, Red base top-right. River runs top-left → bottom-right.

* **Per lane, per team:** Outer tower, Inner tower, Inhibitor tower.
* **Base:** 2 Nexus towers and the Nexus crystal.
* **Jungle (per side):** Sentinel (blue buff: haste + mana regen), Brambleback (red buff: burn on hit), Wolves, Raptors, Gromp, Krugs.
* **River:** Dragon pit (bot side), Herald/Baron pit (top side).

### 3.1 Objectives

| Objective | Spawns | Reward |
|---|---|---|
| **Dragon** | 2:30, respawn 2:30 | Element stack for team: *Infernal* +AD/AP %, *Ocean* regen, *Mountain* resists, *Cloud* move speed. 4 stacks = **Soul** (big version) |
| **Rift Herald** | 4:00 → despawns at 9:30 | *Eye of the Herald*: a **Drop Herald** call; it charges down a lane, wrecking towers |
| **Baron** | 9:30, respawn 4:00 | *Hand of Baron* for 90 s: +AD/AP and empowered minions |
| **Inhibitor** | — | Destroyed inhibitor spawns super minions in that lane for 2 min |

### 3.2 Timings (compressed ~2× from LoL)

| | |
|---|---|
| First minion wave | 0:20, then every 25 s |
| Siege minion | every 3rd wave |
| Jungle camps | 0:45 first, respawn 60 s (buffs 120 s) |
| Respawn | 4 s + 1.5 s × level (cap 30 s) |
| Levels | 1–15, ultimate at level 5 |

---

## 4. Heroes

25 heroes, 5 per role. Each has a passive, two basic abilities and an ultimate, all **data-driven** in `src/data/heroes.js`.

| Role | Heroes |
|---|---|
| **Top** | Bastion (tank), Kenshi (bruiser), Varro (juggernaut), Brawlo (duelist), Grok (warden) |
| **Jungle** | Kaze (assassin), Leonin (bruiser), Karasu (diver), Umbra (assassin), Gama (tank) |
| **Mid** | Ember (burn mage), Raiden (burst mage), Totem (control mage), Sanguis (drain mage), Hex (assassin mage) |
| **Bot** | Fletch (sustained DPS), Marlowe (crit gunslinger), Shuri (on-hit), Bolt (artillery), Sling (lane bully) |
| **Support** | Oak (healer), Wu (shield), Aurelia (enchanter), Bonehook (hook), Frost (engage) |

### 4.1 Hero attributes

* **Power curve:** early / mid / late. Tells the AI (and you) when to force fights.
* **Tags:** `burst`, `burn`, `tank`, `cc`, `heal`, `poke`, `dive`, `split`, `scaling`, `antiheal`.
* **Counters** emerge mechanically (armor vs AD, %max-HP vs tanks, grievous wounds vs healing, CC vs dashers). The draft UI also surfaces a simple **matchup score** from tags.

### 4.2 Ability model

Every ability is a record of: `kind` (skillshot, target, aoe, dash, self-buff, ally-buff, hook, zone), `range`, `radius`, `cooldown`, `damage {base, perLevel, ratio}`, optional `cc {stun|root|slow|knockup, duration}`, `burn`, `shield`, `heal`, plus AI hints (`use: engage | poke | peel | execute | clear | escape`).

---

## 5. AI

Utility-based decision making in two layers:

**Macro (every 0.5 s):** chooses a *task*: `lane`, `jungle`, `recall`, `roam`, `objective`, `group`, `split`, `defend`, `retreat`. A team call overrides the default macro task for the heroes it targets.

**Micro (every tick):**

1. Threat assessment: compare local **power** (HP × DPS of visible allies vs enemies within 700 units, towers included).
2. If outmatched → kite / retreat toward nearest ally tower.
3. Else pick a target: killable hero > focus-called hero > lowest effective HP in range > minion (last-hit aware) > structure.
4. Cast abilities whose `use` hint fits the moment (engage when ahead, peel when an ally is dived, execute under threshold, clear on waves).
5. Respect enemy towers: only dive with minion cover or for a guaranteed kill.
6. Skillshots are aimed at **predicted** positions; targets can still walk out of them.

AI knowledge is **fog-limited**: it sees only what its team sees (plus last-known positions that decay).

---

## 6. Technology

* **Pure static web app** (HTML/CSS/ES modules, no build step) → served by GitHub Pages.
* **Deterministic simulation** (`src/sim/`): fixed 20 Hz tick, seeded PRNG (`mulberry32`), no `Math.random`, no trig in the sim, stable iteration order. Same seed + same commands ⇒ same match, bit for bit.
* **Lockstep netcode** (`src/net/`): WebRTC data channel via PeerJS. Each peer sends its command list for tick *T + 6* every tick; the sim advances only when both peers' inputs for a tick are present. A state checksum is exchanged every 2 s to detect desyncs.
* **Renderer** (`src/render/`): Canvas 2D, interpolates between sim ticks at 60 fps, pixel-perfect scaling, minimap, fog overlay, floating combat text.
* **Headless tooling** (`tools/`): Node scripts to run thousands of AI-vs-AI games for balance and to verify determinism.

---

## 7. Art & audio

All art and audio come from **Ninja Adventure Asset Pack** by Pixel-boy & AAA (CC0). See `assets/ASSETS_LICENSE_CC0.txt`.

* Heroes: 16 × 16 character sheets (4 directions × walk/attack), drawn at 2× with team-colour rings.
* Minions: Slime/Skull/Eye (blue) and Spirit/Skull/Eye (red).
* Jungle: AxolotBlue, Beast, Beast2, Lizard, GreenOctopus, Mole.
* Dragon: segmented DragonGreen/DragonBlue boss, recoloured per element.
* Herald: DemonCyclop. Baron: SquidRed.
* Towers: TilesetTowers (3 damage states). Nexus: crystal.
* FX: elemental sheets (flame, thunder, ice, rock spike), slash/claw/cut, shields, projectiles.

---

## 8. Roadmap

- [x] Design doc, curated assets
- [x] Deterministic sim core: map, minions, towers, jungle, objectives, heroes, abilities, AI
- [x] Renderer, camera (mouse + touch), minimap, fog of war
- [x] Draft, prep, call panel, analyst feed, results
- [x] Peer-to-peer lockstep + vs-AI mode (AI coach takes over if a peer disconnects)
- [x] Audio, first balance pass via headless sims, mobile layouts
- [ ] More balance passes (run `node tools/balance.mjs 200`)
- [ ] *Later:* ranked ELO, replays (free: they're just seed + command log), spectator links, more maps
