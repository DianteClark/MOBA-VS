// Bosses & Beasts: look data (render / UI only, never in the sim). Monster and animal art from the Ninja
// Adventure pack (built by the asset script into assets/img/kami, mon, pets).
//   KAMI_ART    sprite atlas rows per Kami species: [base, elder] × { idle, atk: [y, frame w, frame h, frames] }
//   FAMILIES    minion families (cosmetic skins): melee / caster / siege / super monster sheets
//   CAMP_LOOK   each map's jungle camps re-themed (sprite + name); NIGHT_LOOK the camps' night forms
//   PARADE_LOOK each map's Yokai Parade band
//   PETS        the 27 scout animals (cosmetic: every one has the same stats)
// Unlocks are derived from the profile (pass level, achievements, mastery, clubs): nothing new is stored but
// the equipped choice (profile.d.equip.pet / .troop), so cloud saves stay small.
export const KAMI_ART = {
  frog: [{ idle: [0, 40, 40, 5], atk: [40, 40, 40, 3] }, { idle: [80, 40, 40, 5], atk: [120, 40, 40, 3] }],
  slime: [{ idle: [0, 62, 52, 5], atk: [52, 62, 52, 13] }, { idle: [104, 62, 52, 5], atk: [156, 62, 52, 13] }],
  bamboo: [{ idle: [0, 62, 62, 6], atk: [62, 62, 62, 5] }, { idle: [124, 62, 62, 6], atk: [186, 62, 62, 5] }],
  racoon: [{ idle: [0, 60, 60, 6], atk: [60, 60, 60, 4] }, { idle: [120, 60, 60, 6], atk: [180, 60, 60, 4] }],
  tengu: [{ idle: [0, 68, 68, 6], atk: [68, 82, 82, 15] }, { idle: [150, 82, 82, 6], atk: [232, 82, 82, 15] }],
  samurai: [{ idle: [0, 96, 48, 6], atk: [48, 96, 96, 4] }, { idle: [144, 96, 48, 6], atk: [192, 96, 96, 4] }],
};
// Draw scale per species (pack frames differ in size) and how high the HP bar sits.
export const KAMI_SCALE = { frog: 2.6, slime: 2.0, bamboo: 1.9, racoon: 2.0, tengu: 1.7, samurai: 1.9 };
export const kamiFace = (sp, elder) => `assets/img/kami/${sp}${elder ? '_elder' : ''}_face.png`;
export const monSrc = (k) => `assets/img/mon/${k}.png`;
export const monFace = (k) => `assets/img/mon/${k}_face.png`;

// ── minion families ──
// unlock: free | { pass: level (any season) } | { ach: id } | { mastery: heroes at Mastery 5 } | { club: true }
export const FAMILIES = {
  spirits: { name: 'Spirit Wisps', set: null, unlock: 'free', blurb: 'The classic wisps, skulls and eyes' },
  garden: { name: 'Mushroom Grove', set: { melee: 'Mushroom', caster: 'Butterfly', siege: 'Mole', super: 'Panda' }, map: 'sakura', unlock: 'free', blurb: 'Sakura Valley' },
  frost: { name: 'Frost Folk', set: { melee: 'Mushroom2', caster: 'BlueBat', siege: 'Larva2', super: 'Octopus2' }, map: 'frost', unlock: { pass: 5 }, blurb: 'Frostfang Pass' },
  ember: { name: 'Cinder Crew', set: { melee: 'Snake', caster: 'Flam', siege: 'Cyclope', super: 'TRex' }, map: 'ember', unlock: { ach: 'blitz' }, blurb: 'Ember Canyon' },
  swamp: { name: 'Bog Brood', set: { melee: 'Slime4', caster: 'Larva', siege: 'Mollusc2', super: 'Reptile2' }, map: 'marsh', unlock: { ach: 'steal' }, blurb: 'Moonlit Marsh' },
  dune: { name: 'Dune Scuttlers', set: { melee: 'Mouse', caster: 'SpiderYellow', siege: 'Lizard2', super: 'GoldRacoon' }, map: 'oasis', unlock: { pass: 14 }, blurb: 'Sunscar Oasis' },
  temple: { name: 'Temple Guard', set: { melee: 'Bamboo', caster: 'Owl2', siege: 'Cyclope2', super: 'Bear' }, map: 'ruins', unlock: { mastery: 1 }, blurb: 'Mossgate Ruins' },
  tide: { name: 'Tide Swarm', set: { melee: 'Fish', caster: 'Octopus', siege: 'FishRed', super: 'RedOctopus' }, unlock: { club: true }, blurb: 'Club reward' },
};
export const FAMILY_IDS = Object.keys(FAMILIES);
export const MAP_FAMILY = { sakura: 'garden', frost: 'frost', ember: 'ember', marsh: 'swamp', oasis: 'dune', ruins: 'temple' };
// The featured family of each weekly event (src/data/events.js): the default look that week, and anyone may wear it.
export const EVENT_FAMILY = { bloodmoon: 'ember', fog: 'frost', kamistorm: 'tide', golden: 'dune', swift: 'garden', iron: 'temple', shrine: 'spirits', mirror: 'swamp' };
// Which monster sheet a minion of a family draws with (null: the classic team sprites).
export function familySheet(fam, kind) { const f = FAMILIES[fam]; return f && f.set ? f.set[kind === 'super' ? 'super' : kind] : null; }

// ── jungle camps per map (sprite, name) ──
const CAMP_DEFAULT = { bluebuff: ['camp_bluebuff', 'Sentinel'], redbuff: ['camp_redbuff', 'Brambleback'], wolf: ['camp_wolf', 'Wolves'], raptor: ['camp_raptor', 'Raptors'], gromp: ['camp_gromp', 'Gromp'], krug: ['camp_krug', 'Krugs'] };
export const CAMP_LOOK = {
  sakura: CAMP_DEFAULT,
  frost: { bluebuff: ['Octopus2', 'Frost Sentinel'], redbuff: ['Bear', 'Ice Bear'], wolf: ['Beast2', 'Snow Wolves'], raptor: ['BlueBat', 'Ice Bats'], gromp: ['Slime3', 'Frost Gromp'], krug: ['Mole2', 'Rime Moles'] },
  ember: { bluebuff: ['Cyclope2', 'Ash Sentinel'], redbuff: ['Cyclope', 'Cinder Cyclops'], wolf: ['Beast', 'Ember Hounds'], raptor: ['Snake3', 'Scorch Snakes'], gromp: ['DragonYellow', 'Magma Drake'], krug: ['Mole', 'Ash Moles'] },
  marsh: { bluebuff: ['Reptile', 'Bog Sentinel'], redbuff: ['RedOctopus', 'Mire Squid'], wolf: ['Lizard2', 'Marsh Lizards'], raptor: ['Larva2', 'Grubs'], gromp: ['GreenOctopus', 'Gromp'], krug: ['Mollusc2', 'Shellbacks'] },
  oasis: { bluebuff: ['Axolot', 'Oasis Sentinel'], redbuff: ['Racoon', 'Bandit Racoon'], wolf: ['SpiderYellow', 'Sand Spiders'], raptor: ['Snake4', 'Dune Vipers'], gromp: ['Dragon', 'Sand Drake'], krug: ['MouseBlack', 'Burrowers'] },
  ruins: { bluebuff: ['Panda', 'Temple Panda'], redbuff: ['GreyTrex', 'Stone Rex'], wolf: ['Beast2', 'Ruin Wolves'], raptor: ['SpiderRed', 'Crypt Spiders'], gromp: ['Mushroom2', 'Moss Cap'], krug: ['BambooYellow', 'Bamboo Kin'] },
};
// sprite key for a camp mob: map art for the camp kind (the mob's sprite key is camp_<kind>)
export function campSprite(map, kind) { const L = CAMP_LOOK[map] || CAMP_DEFAULT, k = kind.replace(/^camp_/, ''); const v = L[k]; return v ? (v[0].startsWith('camp_') ? v[0] : 'mon_' + v[0]) : kind; }
export function campName(map, kind) { const L = CAMP_LOOK[map] || CAMP_DEFAULT; const v = L[kind] || CAMP_DEFAULT[kind]; return v ? v[1] : kind; }
// night forms (a camp that wakes at night): yokai of the dark
export const NIGHT_LOOK = { bluebuff: 'Owl2', redbuff: 'KappaRed', wolf: 'Owl', raptor: 'YellowsBat', gromp: 'HeartGreen', krug: 'Mushroom2' };
// the Yokai Parade band per map: [leader lantern, two followers]
export const PARADE_LOOK = {
  sakura: ['yokai_lantern', 'yokai_skull', 'yokai_kappa'], frost: ['mon_LanternGreen', 'mon_SkullBlue', 'mon_Flam2'], ember: ['yokai_lantern', 'mon_Flam', 'yokai_skull'],
  marsh: ['mon_LanternGreen', 'yokai_kappa', 'mon_KappaRed'], oasis: ['yokai_lantern', 'mon_Snake2', 'yokai_skull'], ruins: ['mon_LanternGreen', 'mon_Eye', 'mon_Spirit'],
};
// every monster sheet the match may draw (loaded with the match art)
export const MON_SHEETS = [...new Set([
  ...Object.values(FAMILIES).flatMap((f) => (f.set ? Object.values(f.set) : [])),
  ...Object.values(CAMP_LOOK).flatMap((L) => Object.values(L).map((v) => v[0]).filter((k) => !k.startsWith('camp_'))),
  ...Object.values(NIGHT_LOOK), ...Object.values(PARADE_LOOK).flat().filter((k) => k.startsWith('mon_')).map((k) => k.slice(4)),
])];

// ── scout pets ──
// row: the atlas row in assets/img/pets.png (two 24px frames).
export const PETS = {
  dog: { name: 'Dog', unlock: 'free' }, cat: { name: 'Cat', unlock: 'free' }, frog: { name: 'Frog', unlock: 'free' }, chick: { name: 'Chick', unlock: 'free' },
  shiba: { name: 'Shiba', unlock: { pass: 4 } }, hamster: { name: 'Hamster', unlock: { pass: 8 } }, racoon: { name: 'Racoon', unlock: { pass: 12 } },
  lioncub: { name: 'Lion Cub', unlock: { pass: 16 } }, blackdog: { name: 'Black Dog', unlock: { pass: 20 } }, koi: { name: 'Koi', unlock: { pass: 25 } },
  pup: { name: 'Pup', unlock: { ach: 'calls5' } }, goldendog: { name: 'Golden Dog', unlock: { ach: 'calls10' } }, boar: { name: 'Wild Boar', unlock: { ach: 'comeback' } },
  lion: { name: 'Lion', unlock: { ach: 'unstoppable' } }, hyena: { name: 'Hyena', unlock: { ach: 'blitz' } }, blackcat: { name: 'Black Cat', unlock: { ach: 'steal' } },
  hen: { name: 'Hen', unlock: { ach: 'duo3' } }, lioness: { name: 'Lioness', unlock: { ach: 'clan3' } }, gingercat: { name: 'Ginger Cat', unlock: { ach: 'tactics' } },
  whitecat: { name: 'White Cat', unlock: { ach: 'moments3' } }, parrot: { name: 'Parrot', unlock: { ach: 'potg' } }, cow: { name: 'Cow', unlock: { ach: 'giant' } },
  cyclopcat: { name: 'Cyclops Cat', unlock: { ach: 'cup' } }, pig: { name: 'Pig', unlock: { ach: 'wins10' } }, horse: { name: 'Horse', unlock: { ach: 'wins50' } },
  donkey: { name: 'Donkey', unlock: { ach: 'games25' } }, monkey: { name: 'Monkey', unlock: { mastery: 3 } },
};
// atlas order (the asset script's order)
const PET_ROWS = ['cat', 'blackcat', 'cyclopcat', 'gingercat', 'whitecat', 'chick', 'hen', 'cow', 'dog', 'pup', 'blackdog', 'shiba', 'goldendog', 'donkey', 'koi',
  'frog', 'hamster', 'horse', 'hyena', 'lion', 'lioncub', 'lioness', 'monkey', 'parrot', 'pig', 'racoon', 'boar'];
for (const [i, k] of PET_ROWS.entries()) PETS[k].row = i;
export const PET_IDS = Object.keys(PETS);
export const petFace = (id) => `assets/img/pets/${PETS[id] ? id : 'dog'}.png`;
// An AI coach's scout: a fixed animal per team and seed (rivals bring their own).
export const aiPet = (seed, team) => PET_IDS[((seed >>> 0) + team * 7) % 4];

// ── mascots (monster portraits) ──
// rival coaches (src/data/rivals.js ids) and Franchise clubs (by index)
export const RIVAL_MASCOT = { buta: 'Bear', goro: 'Cyclope', jin: 'Owl', kenta: 'Racoon', kin: 'GoldRacoon', kuma: 'Panda', momo: 'Mushroom', ozu: 'Octopus2', rin: 'Butterfly', shishi: 'TRex', taro: 'Mole', ume: 'KappaGreen' };
export const RIVAL_PET = { buta: 'pig', goro: 'boar', jin: 'parrot', kenta: 'racoon', kin: 'goldendog', kuma: 'lioncub', momo: 'chick', ozu: 'koi', rin: 'whitecat', shishi: 'lion', taro: 'hamster', ume: 'frog' };
export const CLUB_MASCOTS = ['Beast', 'Bear', 'Cyclope', 'Dragon', 'Owl', 'Panda', 'Racoon', 'TRex', 'Snake2', 'Octopus', 'Reptile', 'Mole', 'SpiderRed', 'Lizard', 'KappaGreen', 'Flam'];
export const clubMascot = (i) => CLUB_MASCOTS[((i % CLUB_MASCOTS.length) + CLUB_MASCOTS.length) % CLUB_MASCOTS.length];

// ── unlocks (derived from the profile) ──
const bestPass = (p) => Math.max(1, ...Object.keys(p.d.seasons || {}).map((id) => { try { return p.passLevel(id); } catch { return 1; } }));
const masters = (p) => Object.keys(p.d.mastery || {}).filter((id) => p.mastery(id).lv >= 5).length;
const inClub = (p) => !!(p.d.unlocked && p.d.unlocked.titles && (p.d.unlocked.titles.includes('clubStalwart') || p.d.unlocked.titles.includes('clubWar')));
export function unlocked(p, u) {
  if (!u || u === 'free') return true;
  if (u.pass) return bestPass(p) >= u.pass;
  if (u.ach) return p.hasAch(u.ach);
  if (u.mastery) return masters(p) >= u.mastery;
  if (u.club) return inClub(p);
  return false;
}
// How to earn a locked one, in words (achievement names come from the caller's lookup).
export function unlockText(u, achName = (id) => id) {
  if (!u || u === 'free') return 'Free';
  if (u.pass) return `Season Pass level ${u.pass}`;
  if (u.ach) return `Achievement: ${achName(u.ach)}`;
  if (u.mastery) return u.mastery === 1 ? 'Any hero at Mastery 5' : `${u.mastery} heroes at Mastery 5`;
  if (u.club) return 'Club goals or a Club War win';
  return 'Locked';
}
export const hasPet = (p, id) => !!PETS[id] && unlocked(p, PETS[id].unlock);
export const hasFamily = (p, id, event) => !!FAMILIES[id] && (unlocked(p, FAMILIES[id].unlock) || EVENT_FAMILY[event] === id);
