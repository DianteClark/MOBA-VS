// Unique hero skins (render only: sprite sheet + portrait; hitboxes, effects and the sim never see them).
// Every hero has a Signature skin (Mastery 5 with that hero): a themed gradient map of its own sprite plus a
// pixel accessory baked onto the head. Eighteen heroes also have a Legendary skin: a different character
// body from the Ninja Adventure pack (same 4x7 sheet of 16px frames), earned from achievements, the season
// pass or season rank rewards. Built and cached by src/render/skins.js.

// Theme ramps (dark → light) used as gradient maps, plus an accent for accessories and the glow outline.
export const THEMES = {
  frost: { name: 'Frost', ramp: ['#14234a', '#2f6fb8', '#8fd3ff', '#f0ffff'], accent: '#c8f4ff' },
  infernal: { name: 'Infernal', ramp: ['#2a0606', '#8a1a0c', '#ff5a1a', '#ffd84a'], accent: '#ff9a2a' },
  golden: { name: 'Golden', ramp: ['#3a2406', '#8a5a10', '#e8b84a', '#fff4b8'], accent: '#ffe08a' },
  shadow: { name: 'Shadow', ramp: ['#08050e', '#261841', '#55378a', '#b892ff'], accent: '#c99bff' },
  jade: { name: 'Jade', ramp: ['#06241a', '#17643f', '#45c486', '#d2ffe0'], accent: '#7dffb2' },
  sakura: { name: 'Sakura', ramp: ['#3a1028', '#a03a6a', '#f48ab8', '#fff0f6'], accent: '#ffc2dc' },
  storm: { name: 'Storm', ramp: ['#0e1430', '#34428a', '#8c9cff', '#fff6a8'], accent: '#fff07a' },
  toxic: { name: 'Toxic', ramp: ['#121e08', '#356410', '#9be33a', '#f0ffa8'], accent: '#c8ff4a' },
  void: { name: 'Void', ramp: ['#040309', '#1a1030', '#4a2a6a', '#ff5ad0'], accent: '#ff7ae0' },
  spectral: { name: 'Spectral', ramp: ['#1c2228', '#62727a', '#c4d6d0', '#ffffff'], accent: '#d8fff4' },
  crimson: { name: 'Crimson', ramp: ['#1a0408', '#6a0a1a', '#d8303a', '#ffc0a8'], accent: '#ff6a6a' },
  ocean: { name: 'Tide', ramp: ['#041828', '#0a5878', '#2ac8c8', '#dafff6'], accent: '#6afff0' },
  celestial: { name: 'Celestial', ramp: ['#0c0a2a', '#3a2a8a', '#8a7aff', '#ffeaa8'], accent: '#ffe69a' },
  autumn: { name: 'Harvest', ramp: ['#2a1206', '#7a3410', '#e08a2a', '#ffe0a0'], accent: '#ffb04a' },
};
export const ACC_NAMES = { crown: 'Crown', horns: 'Horns', halo: 'Halo', flame: 'Flame', icecrown: 'Ice crown', blossom: 'Blossom', feather: 'Plume',
  star: 'Star', antenna: 'Antenna', ears: 'Ears', leaf: 'Leaf', wisp: 'Wisp', circlet: 'Circlet', hat: 'Top hat', bolt: 'Spark', gem: 'Jewel' };

// [hero, theme, accessory, name, glow outline]
const SIG = [
  ['bastion', 'frost', 'icecrown', 'Glacier Bastion', 1], ['kenshi', 'shadow', 'horns', 'Oni Kenshi'], ['varro', 'crimson', 'circlet', 'Blood Laurel Varro'],
  ['brawlo', 'infernal', 'flame', 'Hellfire Brawlo', 1], ['grok', 'jade', 'leaf', 'Mossback Grok'], ['yuki', 'sakura', 'blossom', 'Sakura Yuki'],
  ['akaro', 'void', 'crown', 'Void King Akaro', 1], ['monolith', 'infernal', 'gem', 'Magma Monolith', 1], ['gorath', 'storm', 'horns', 'Thunder Tusk Gorath'],
  ['valka', 'celestial', 'feather', 'Valkyrie Valka'], ['sora', 'autumn', 'leaf', 'Harvest Sora'], ['tetsu', 'toxic', 'antenna', 'Toxic Tetsu', 1],
  ['kaze', 'frost', 'feather', 'Winter Wind Kaze'], ['leonin', 'shadow', 'crown', 'Night Pride Leonin'], ['karasu', 'golden', 'halo', 'Sun Crow Karasu'],
  ['umbra', 'spectral', 'wisp', 'Ghost Veil Umbra', 1], ['gama', 'crimson', 'crown', 'Blood Moon Gama'], ['ponta', 'celestial', 'star', 'Star Mask Ponta'],
  ['fang', 'spectral', 'ears', 'Ghost Lion Fang', 1], ['kumo', 'toxic', 'ears', 'Venom Kumo'], ['kaen', 'frost', 'flame', 'Blue Flame Kaen', 1],
  ['saru', 'golden', 'circlet', 'Great Sage Saru', 1], ['gaki', 'jade', 'wisp', 'Jade Ghost Gaki', 1], ['shiro', 'crimson', 'ears', 'Red Fang Shiro'],
  ['ember', 'shadow', 'flame', 'Hexfire Ember', 1], ['raiden', 'infernal', 'bolt', 'Red Storm Raiden'], ['totem', 'celestial', 'wisp', 'Star Spirit Totem', 1],
  ['sanguis', 'spectral', 'crown', 'Pale Count Sanguis'], ['hex', 'void', 'blossom', 'Night Bloom Hex'], ['kurai', 'storm', 'halo', 'Storm Sage Kurai', 1],
  ['nami', 'infernal', 'wisp', 'Lava Tide Nami'], ['kitsu', 'frost', 'ears', 'Snow Fox Kitsu'], ['azim', 'void', 'gem', 'Void Sultan Azim'],
  ['mori', 'golden', 'wisp', 'Blessed Mori', 1], ['fujin', 'crimson', 'horns', 'Oni Wind Fujin'], ['sumi', 'autumn', 'blossom', 'Autumn Ink Sumi'],
  ['fletch', 'crimson', 'feather', 'Scarlet Fletch'], ['marlowe', 'shadow', 'hat', 'Noir Marlowe'], ['shuri', 'storm', 'star', 'Shooting Star Shuri', 1],
  ['bolt', 'golden', 'antenna', 'Gold Unit Bolt'], ['sling', 'toxic', 'feather', 'Venomleaf Sling'], ['wren', 'ocean', 'feather', 'Reef Wren'],
  ['bakuha', 'toxic', 'flame', 'Toxic Bomber Bakuha', 1], ['tomoe', 'jade', 'feather', 'Jade Stance Tomoe'], ['voss', 'spectral', 'hat', 'Phantom Baron Voss'],
  ['morel', 'ocean', 'wisp', 'Glowshroom Morel', 1], ['hachi', 'golden', 'crown', 'Queen Hornet Hachi'], ['rekka', 'frost', 'bolt', 'Cryo Rocket Rekka'],
  ['oak', 'jade', 'halo', 'Jade Lotus Oak'], ['wu', 'celestial', 'halo', 'Starlit Sage Wu', 1], ['aurelia', 'shadow', 'halo', 'Eclipse Aurelia', 1],
  ['bonehook', 'ocean', 'horns', 'Drowned Bonehook'], ['frost', 'infernal', 'horns', 'Volcanic Frost'], ['gizmo', 'crimson', 'antenna', 'Red Alert Gizmo'],
  ['ruga', 'storm', 'feather', 'Thunder Drum Ruga'], ['hotaru', 'sakura', 'wisp', 'Blossom Lantern Hotaru', 1], ['hoshi', 'void', 'star', 'Black Hole Hoshi', 1],
  ['daikoku', 'jade', 'crown', 'Jade Fortune Daikoku'], ['kinta', 'spectral', 'star', 'Silver Luck Kinta'], ['zahra', 'ocean', 'blossom', 'Oasis Zahra'],
];
// [hero, pack body (assets/img/skins/<body>.png + <body>_face.png), name, accessory or null, accent for the accessory]
const LEG = [
  ['bastion', 'KnightGold', 'Paladin Bastion', 'halo', '#ffe08a'], ['brawlo', 'MonkeyBoxerBlue', 'Blue Corner Brawlo'], ['fang', 'CaveLion2', 'Elder Mane Fang'],
  ['sling', 'Cavegirl2', 'Wildheart Sling', 'feather', '#ff9ec7'], ['grok', 'Caveman2', 'Chieftain Grok', 'crown', '#ffd84a'], ['oak', 'Monk2', 'Mountain Monk Oak', 'halo', '#d2ffe0'],
  ['rekka', 'NinjaRed2', 'Crimson Comet Rekka'], ['sumi', 'NinjaBlue', 'Indigo Sumi', 'blossom', '#8fd3ff'], ['kaze', 'NinjaLeaf', 'Evergreen Kaze'],
  ['kenshi', 'SamuraiRed', 'Red Ronin Kenshi'], ['leonin', 'LionYellow', 'Sunmane Leonin', 'crown', '#fff2a8'], ['ruga', 'LionOrange', 'Ember Mane Ruga', 'feather', '#ff9a4a'],
  ['kaen', 'Flam', 'Living Flame Kaen'], ['gorath', 'Pig', 'Boar Lord Gorath', 'crown', '#e8b84a'], ['wu', 'OldMan', 'Hermit Wu'],
  ['hoshi', 'OldMan2', 'Wandering Star Hoshi', 'star', '#ffe69a'], ['shuri', 'FighterWhite', 'White Lotus Shuri'], ['hachi', 'FighterRed', 'Red Hornet Hachi', 'antenna', '#ffd84a'],
];
export const SIG_MASTERY = 5;
export const sigKey = (hero) => `sig_${hero}`;
export const legKey = (hero) => `leg_${hero}`;
// Entries share the SKINS table (src/data/seasons.js): { name, hero, tier, theme?, acc?, glow?, body?, accent, swatch, mastery? }
export const HERO_SKINS = {};
for (const [hero, theme, acc, name, glow] of SIG) {
  const T = THEMES[theme];
  HERO_SKINS[sigKey(hero)] = { name, hero, tier: 'signature', theme, acc, glow: !!glow, accent: T.accent, swatch: `linear-gradient(135deg, ${T.ramp[1]}, ${T.ramp[2]} 60%, ${T.ramp[3]})`, mastery: SIG_MASTERY };
}
for (const [hero, body, name, acc, accent] of LEG) {
  HERO_SKINS[legKey(hero)] = { name, hero, tier: 'legendary', body, acc: acc || null, accent: accent || '#ffd84a', swatch: 'linear-gradient(135deg, #ffd84a, #ff7a9a 55%, #7fb4ff)' };
}
export const SKIN_BODIES = [...new Set(LEG.map((l) => l[1]))];
