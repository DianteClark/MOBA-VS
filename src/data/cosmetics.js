// Emotes, achievement banners and coach-card borders (cosmetic only).
import { TIERS } from './ranks.js';

// Emotes (assets/img/emote/<id>.png). `free`: owned from the start; the rest come from achievements and the pass.
// Order is the quick-chat order. Only these keys ever cross the wire (src/ui/quickchat.js validates them).
export const EMOTES = {
  up: { name: 'Love it', free: true }, ok: { name: 'Got it', free: true }, think: { name: 'Thinking', free: true }, doubt: { name: 'Unsure', free: true },
  down: { name: 'Heartbroken', free: true }, tilt: { name: 'Tilted', free: true }, smile: { name: 'Smile', free: true }, grin: { name: 'Grin', free: true },
  happy: { name: 'Delighted' }, wink: { name: 'Wink' }, smug: { name: 'Smug' }, gasp: { name: 'Gasp' }, alert: { name: 'Alert!' }, huh: { name: 'Huh?!' },
  meh: { name: 'Meh' }, nervous: { name: 'Nervous' }, sad: { name: 'Sad' }, cry: { name: 'Teary' }, grumpy: { name: 'Grumpy' }, dizzy: { name: 'Dazed' },
  ko: { name: 'K.O.' }, zzz: { name: 'Sleepy' },
};
export const EMOTE_IDS = Object.keys(EMOTES);
export const FREE_EMOTES = EMOTE_IDS.filter((k) => EMOTES[k].free);
export const emoteSrc = (id) => `assets/img/emote/${id}.png`;

// Achievement banners (merged into BANNERS in src/data/seasons.js).
export const BANNERS_EXTRA = {
  phoenix: { name: 'Phoenix', bg: 'radial-gradient(circle at 75% 15%, #ffb04a, #8a1a0c 45%, #1e0806 85%)' },
  aurora: { name: 'Aurora', bg: 'linear-gradient(160deg, #0c2a3a, #1a6a5a 40%, #4a2a7a 75%, #120c24)' },
  thunder: { name: 'Thunderhead', bg: 'linear-gradient(150deg, #1a2240, #34428a 45%, #c8b84a 52%, #1a2240 60%, #0e1430)' },
  lotus: { name: 'Lotus Pond', bg: 'radial-gradient(circle at 25% 80%, #f48ab8, #2a5a4a 45%, #0e2420 85%)' },
  abyss: { name: 'Abyss', bg: 'radial-gradient(circle at 50% 120%, #ff5ad0, #2a1040 40%, #06040c 80%)' },
  dojo: { name: 'Dojo Hall', bg: 'repeating-linear-gradient(90deg, #3a2414 0 18px, #2a1a0e 18px 20px), linear-gradient(#3a2414, #1a1008)' },
  starfield: { name: 'Starfield', bg: 'radial-gradient(1px 1px at 20% 30%, #fff, transparent), radial-gradient(1px 1px at 70% 60%, #fff, transparent), radial-gradient(1.5px 1.5px at 85% 25%, #ffe69a, transparent), linear-gradient(160deg, #0c0a2a, #1a1440 60%, #2a1a5a)' },
};

// Coach-card borders: one per season tier (earned at season end, see src/data/ranks.js) and achievement borders.
// c1/c2: the two ring colours; shine: a slow sweep (off with Reduced effects).
export const BORDERS = {
  ...Object.fromEntries(TIERS.map((t) => [t.id, { name: t.name, c1: t.color, c2: t.dark, tier: true, shine: t.id === 'kami' || t.id === 'master' }])),
  jade: { name: 'Jade Ring', c1: '#7dffb2', c2: '#17643f' },
  phoenix: { name: 'Phoenix', c1: '#ffb04a', c2: '#8a1a0c', shine: true },
  storm: { name: 'Stormcaller', c1: '#fff07a', c2: '#34428a', shine: true },
  sensei: { name: 'Sensei', c1: '#ffe08a', c2: '#7a5410', shine: true },
  shogun: { name: 'Shogun', c1: '#ff6a6a', c2: '#3a0a12' },
  moon: { name: 'Moonlit', c1: '#d8fff4', c2: '#3a2a8a' },
};
export const borderStyle = (id) => { const b = BORDERS[id]; return b ? { '--bd1': b.c1, '--bd2': b.c2 } : null; };
