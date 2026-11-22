// Weekly map events: one rotating twist per ISO week (UTC), the same for every player.
// Each event is plain data. `rules` are modifiers merged into the classic 5v5 rules by src/sim/modes.js
// (rulesFor(mode, event)); the event id travels in the match cfg (cfg.event), so lockstep peers and
// replays always agree. A cfg without `event` is the unchanged Classic. `draft` changes the draft only
// (src/sim/draft.js). `look` is render-only (tint/ambience, see src/render/eventfx.js).
//   ranked: true = balance-neutral (symmetric and no hero class favoured): online Ranked plays it too.
//           false = Ranked plays Classic that week; vs AI, Casual, private rooms and Watch use the event.
export const EVENTS = [
  { id: 'bloodmoon', name: 'Blood Moon', icon: 'icons/OrbDarkness', color: '#ff5a6a', ranked: false,
    short: '+25% kill gold', blurb: 'A red moon hangs over the map. Kills and assists pay 25% more gold: fights snowball.',
    rules: { killGold: 1.25 }, look: { night: [150, 104, 124], motes: 'ember' } },
  { id: 'fog', name: 'Fog Week', icon: 'icons/Mist', color: '#c9d4e4', ranked: false,
    short: 'Vision -20%', blurb: 'Thick mist: heroes, minions and wards see 20% less. Wards and brush control win fights.',
    rules: { vision: 0.8 }, look: { veil: 'rgba(205,214,228,0.13)', motes: 'mist' } },
  { id: 'kamistorm', name: 'Kami Storm', icon: 'icons/BookThunder', color: '#b8a2ff', ranked: false,
    short: 'Kami sooner & stronger', blurb: 'The Kami wake early (1:00) and return faster (every 1:30), with 25% more HP and damage. Blessings stack up quickly.',
    rules: { kamiPower: 1.25, T: { dragonFirst: 60, dragonRespawn: 90 } }, look: { veil: 'rgba(60,40,120,0.07)', flash: true } },
  { id: 'golden', name: 'Golden Waves', icon: 'icons/LuckUpgrade', color: '#ffd24a', ranked: true,
    short: '+25% minion gold', blurb: 'Every minion carries a purse: last hits pay 25% more. Farming lanes pays off.',
    rules: { minionGold: 1.25 }, look: { motes: 'gold' } },
  { id: 'swift', name: 'Swift Winds', icon: 'icons/BookWind', color: '#9fe6c8', ranked: true,
    short: '+10% move speed', blurb: 'A tailwind everywhere: heroes move 10% faster. Faster rotations, faster ganks.',
    rules: { heroMs: 1.1 }, look: { motes: 'wind' } },
  { id: 'iron', name: 'Iron Towers', icon: 'icons/DefenseUpgrade', color: '#c8ccd8', ranked: false,
    short: 'Structures +30% HP', blurb: 'Towers, gates and Crystals have 30% more HP. Sieges take longer: plan your pushes.',
    rules: { towerHp: 1.3 }, look: { veil: 'rgba(120,130,150,0.06)' } },
  { id: 'shrine', name: 'Shrine Rush', icon: 'icons/OrbLight', color: '#7fe9d6', ranked: true,
    short: 'Shrines worth more', blurb: 'Shrines open at 0:30, capture faster, pay 60 gold to each hero and give +8% damage (not 5%).',
    rules: { shrine: { dmg: 0.08, gold: 60, speed: 1.5, momentum: 2 }, T: { shrineUnlock: 30 } }, look: { motes: 'spirit' } },
  { id: 'mirror', name: 'Mirror Match', icon: 'icons/Counter', color: '#ff9ed2', ranked: true,
    short: 'Same 5 heroes, same cards', blurb: 'No draft: both teams get the same five heroes and the same three tactic cards, a balanced lineup picked for the match. Builds, plan and calls are yours: the better coach wins.',
    mirror: true, look: {} },
];
export const EVENT_BY_ID = Object.fromEntries(EVENTS.map((e) => [e.id, e]));

const WEEK_MS = 7 * 864e5;
// ISO week (UTC) of a timestamp: { year, week, ends } with `ends` = next Monday 00:00 UTC (ms).
function isoWeek(ms) {
  const d = new Date(ms), day = (d.getUTCDay() + 6) % 7; // Monday = 0
  const monday = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - day * 864e5;
  const thu = new Date(monday + 3 * 864e5), year = thu.getUTCFullYear();
  const week = 1 + Math.floor((monday + 3 * 864e5 - Date.UTC(year, 0, 1)) / WEEK_MS);
  return { year, week, ends: monday + WEEK_MS };
}
// This week's event (and the next one), picked from the ISO week number.
export function weekEvent(ms) {
  const w = isoWeek(ms);
  return { ev: EVENTS[w.week % EVENTS.length], next: EVENTS[(w.week + 1) % EVENTS.length], week: w.week, ends: w.ends };
}
// Mirror Match lineups: curated, balanced comps (one hero per role, in ROLES order: top, jungle, mid, bot,
// support) with a tactic deck that suits them. Both teams field the same one, chosen by the match seed.
export const MIRROR_LINEUPS = [
  { name: 'Classic', heroes: ['bastion', 'kaze', 'ember', 'fletch', 'oak'], deck: ['rally', 'smoke', 'wind'] },
  { name: 'Brawlers', heroes: ['kenshi', 'leonin', 'raiden', 'sling', 'ruga'], deck: ['ambush', 'rally', 'smoke'] },
  { name: 'Late Game', heroes: ['monolith', 'umbra', 'totem', 'tomoe', 'wu'], deck: ['fortify', 'wind', 'pact'] },
  { name: 'Control', heroes: ['valka', 'gama', 'mori', 'shuri', 'aurelia'], deck: ['eyes', 'pact', 'smoke'] },
  { name: 'Siege', heroes: ['varro', 'karasu', 'hex', 'bolt', 'hoshi'], deck: ['siege', 'fortify', 'rally'] },
  { name: 'Skirmish', heroes: ['yuki', 'kumo', 'kurai', 'wren', 'gizmo'], deck: ['barrier', 'wind', 'rally'] },
];
// This match's mirror lineup (pure: both peers share the seed, so both see the same one).
export function mirrorLineup(seed) { return MIRROR_LINEUPS[((seed ^ 0x5bd1e995) >>> 0) % MIRROR_LINEUPS.length]; }
