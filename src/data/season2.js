// Season 2 "Yokai Moon": art direction, its 30-tier pass and the cosmetics it brings (merged into the shared
// SKINS / BANNERS / TITLES / BORDERS / EMOTES tables, so every existing system shows them).
// Art direction: a violet night under a huge pale moon, paper lanterns, ghost-fire (onibi) blue and torii red.

// Palette tints (account-wide skins).
export const S2_SKINS = {
  yokai: { name: 'Yokai Moon', recolor: { hue: 255, sat: 0.95, light: 0.04 }, swatch: '#a58cff' },
  onibi: { name: 'Onibi', recolor: { hue: 190, sat: 1.35, light: 0.06 }, swatch: '#5ad8ff' },
  lantern: { name: 'Paper Lantern', recolor: { hue: 28, sat: 1.45, light: 0.08 }, swatch: '#ffae4a' },
  moonlit: { name: 'Moonlit', recolor: { hue: 220, sat: 0.4, light: 0.16 }, swatch: '#d8e4ff' },
  torii: { name: 'Torii Red', recolor: { hue: -12, sat: 1.35, light: -0.02 }, swatch: '#e8483a' },
  ghost: { name: 'Ghostly', recolor: { hue: 170, sat: 0.25, light: 0.2 }, swatch: '#d8fff4' },
  kitsune: { name: 'Kitsune', recolor: { hue: 18, sat: 1.1, light: 0.14 }, swatch: '#ffc68a' },
  eclipse: { name: 'Eclipse', recolor: { hue: 275, sat: 0.8, light: -0.14 }, swatch: '#4a2a7a' },
};
export const S2_BANNERS = {
  yokaiMoon: { name: 'Yokai Moon', bg: 'radial-gradient(circle at 78% 26%, #fff6dc 0 9%, #c9b8ff 11%, #3a2470 32%, #140c2a 72%)' },
  lanternRow: { name: 'Lantern Row', bg: 'radial-gradient(circle at 15% 70%, #ffae4a 0 5%, transparent 9%), radial-gradient(circle at 45% 60%, #ff8a3a 0 5%, transparent 9%), radial-gradient(circle at 75% 70%, #ffae4a 0 5%, transparent 9%), linear-gradient(160deg, #2a1236, #12081e)' },
  kitsuneNight: { name: 'Kitsune Night', bg: 'linear-gradient(150deg, #10183a, #2a1a5a 45%, #5ad8ff 50%, #2a1a5a 55%, #0a0c22)' },
  toriiDusk: { name: 'Torii Dusk', bg: 'linear-gradient(180deg, #ff7a5a, #7a1a3a 45%, #22081a 46%, #22081a 52%, #3a0e24 53%, #120612)' },
  foxfireTrail: { name: 'Foxfire Trail', bg: 'radial-gradient(circle at 20% 30%, #5ad8ff 0 3%, transparent 6%), radial-gradient(circle at 52% 55%, #5ad8ff 0 3%, transparent 6%), radial-gradient(circle at 82% 35%, #8af0ff 0 3%, transparent 6%), linear-gradient(170deg, #0a1a2a, #12082a)' },
  hundredNights: { name: 'Hundred Nights', bg: 'repeating-linear-gradient(115deg, #1a0c2a 0 14px, #24123a 14px 16px), radial-gradient(circle at 70% 30%, #c99bff, #12081e 70%)' },
  moonShrine: { name: 'Moon Shrine', bg: 'radial-gradient(circle at 50% 12%, #fff6dc 0 7%, #8a7aff 9%, #241650 40%, #0a0618 80%)' },
};
export const S2_BORDERS = {
  lantern: { name: 'Lantern', c1: '#ffae4a', c2: '#5a1a0c', shine: true },
  yokai: { name: 'Night Parade', c1: '#c99bff', c2: '#1a0c3a', shine: true },
  moonring: { name: 'Moon Ring', c1: '#fff6dc', c2: '#3a2470', shine: true },
};
export const S2_TITLES = {
  moonwatcher: 'Moonwatcher', lanternKeeper: 'Lantern Keeper', yokaiHunter: 'Yokai Hunter', nightParade: 'Night Parade Leader',
  legend2: 'Legend of Yokai Moon', moonBlade: 'Moonlit Blade', festival: 'Moon Festival Champion', hyakki: 'Walker of a Hundred Nights',
};
// New emotes from the pack (assets/img/emote/<id>.png). Appended after the v22 emotes, so quick-chat order is stable.
export const S2_EMOTES = {
  blank: { name: 'Deadpan' }, poker: { name: 'Poker Face' }, worry: { name: 'Worried' }, yikes: { name: 'Yikes' },
  ugh: { name: 'Ugh' }, bang: { name: 'Heads up!' }, plus: { name: 'Plus one' }, sus: { name: 'Suspicious' },
};

// Season 2 pass: 30 tiers, every reward new this season. Legendary skins (src/data/skins.js): Kappa Gama,
// Komainu Shiro and Leaf Trick Ponta. Raijin Raiden comes from the second story event (src/data/story.js).
export const TRACK2 = {
  2: { kind: 'title', id: 'moonwatcher' },
  3: { kind: 'skin', id: 'moonlit' },
  4: { kind: 'emote', id: 'blank' },
  5: { kind: 'banner', id: 'lanternRow' },
  6: { kind: 'skin', id: 'leg_gama' },
  7: { kind: 'skin', id: 'lantern' },
  8: { kind: 'emote', id: 'worry' },
  9: { kind: 'title', id: 'lanternKeeper' },
  10: { kind: 'banner', id: 'kitsuneNight' },
  11: { kind: 'skin', id: 'onibi' },
  12: { kind: 'emote', id: 'yikes' },
  13: { kind: 'banner', id: 'toriiDusk' },
  14: { kind: 'skin', id: 'leg_shiro' },
  15: { kind: 'border', id: 'yokai' },
  16: { kind: 'title', id: 'yokaiHunter' },
  17: { kind: 'emote', id: 'sus' },
  18: { kind: 'skin', id: 'torii' },
  19: { kind: 'banner', id: 'foxfireTrail' },
  20: { kind: 'skin', id: 'leg_ponta' },
  21: { kind: 'skin', id: 'ghost' },
  22: { kind: 'emote', id: 'ugh' },
  23: { kind: 'title', id: 'nightParade' },
  24: { kind: 'banner', id: 'yokaiMoon' },
  25: { kind: 'skin', id: 'kitsune' },
  26: { kind: 'title', id: 'moonBlade' },
  27: { kind: 'banner', id: 'hundredNights' },
  28: { kind: 'skin', id: 'eclipse' },
  29: { kind: 'border', id: 'moonring' },
  30: { kind: 'skin', id: 'yokai', also: { kind: 'title', id: 'legend2' } },
};
