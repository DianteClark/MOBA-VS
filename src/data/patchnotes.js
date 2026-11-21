// Patch notes, newest first. tools/season.mjs prepends an entry at each season rollover.
export const PATCHES = [
  {
    version: '1.1', season: 1, date: '2026-11-20', title: 'The Coach Update',
    notes: [
      'Brand-new calling: six big calls, a hand of tactic cards, and a call ring when you tap the map.',
      'One-tap suggestions from your analyst. Hit the button and the call goes out.',
      'Seasons are here: ranked ladder (Ronin → Kami-touched), a 20-level reward track, skins, banners and titles.',
      'Season Cup: an 8-team knockout tournament against AI teams. Win it for the Golden Cup.',
      'Locker: dress your heroes in skins you have unlocked; your opponent sees them online too.',
      'Pop-ups and timers no longer flicker; banners queue instead of cutting each other off.',
    ],
    heroes: [
      { id: 'ember', dir: -1, text: 'Kindling no longer burns minions; Wildfire radius 220 → 170 and burn reduced; Flame Pillar root 1.0s → 0.75s.' },
      { id: 'hex', dir: 1, text: 'Personality changed Reckless → Calm; power +10%.' },
      { id: 'sanguis', dir: 1, text: 'Power +15% (self-play tuning).' },
      { id: 'brawlo', dir: 1, text: 'Power +18% (self-play tuning).' },
      { id: 'frost', dir: 1, text: 'Power +17% (self-play tuning).' },
      { id: 'oak', dir: -1, text: 'Power −17% (self-play tuning).' },
      { id: 'gama', dir: -1, text: 'Power −14% (self-play tuning).' },
      { id: 'kenshi', dir: -1, text: 'Power −14% (self-play tuning).' },
    ],
  },
  {
    version: '1.0', season: 0, date: '2026-11-19', title: 'Release',
    notes: ['Three handcrafted maps, 25 heroes with clans and personalities, trust, shrines, weather, tactic cards, and 15-minute matches.'],
    heroes: [],
  },
];
