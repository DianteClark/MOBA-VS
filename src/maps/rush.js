// Lane Rush maps: one short, winding lane through the middle of the world, two flank trails,
// a Kami pit and a Kraken pit on the centre line (equally far from both Crystals) and a shrine
// per side. Same authoring format as defs.js (Blue's half, point-mirrored), plus:
//   single      only the mid lane exists
//   nexus/fountain/baseCenter/baseR   a smaller base pulled in toward the centre
//   towers      [[fraction of the half-lane, tier]] (tier 4 = the gate); baseTowers: offsets from the Crystal
//   laneW       lane half-width (ten heroes share it)

const RUSH_COMMON = {
  single: true, mode: 'rush', laneW: 78, baseR: 250,
  nexus: [600, 1800], fountain: [440, 1960], baseCenter: [610, 1790],
  towers: [[0.6, 2], [0.33, 3], [0.15, 4]], baseTowers: [[-40, -175], [175, 40]],
  midHalf: [[600, 1800], [650, 1580], [880, 1560], [960, 1350], [1200, 1200]],
  river: [[700, 700], [880, 880], [1040, 1040], [1200, 1200]], riverW: 46,
  kraken: [870, 870], // on the centre line, out of tower reach (tools/maps.mjs checks it)
  camps: [],
};

export const RUSH_MAPS = [
  {
    ...RUSH_COMMON,
    id: 'rush_sakura', name: 'Blossom Bridge', theme: 'spring', weather: ['clear', 'wind', 'clear', 'rain'],
    blurb: 'Lane Rush: one cherry-lined lane over the valley stream. Kami and Kraken wait on the centre line.',
    paths: [
      [[1200, 1200], [1100, 1100], [870, 870]],
      [[690, 1610], [700, 1400], [800, 1200], [870, 870]],
      [[990, 1360], [1150, 1500], [1330, 1500], [1440, 1400]],
    ],
    shrine: [740, 1330],
    brush: [[610, 1520, 44], [880, 1380, 46], [1230, 1440, 44], [860, 1100, 40], [1080, 1640, 42], [800, 1700, 36]],
    rocks: [[960, 1720, 30], [820, 1470, 24], [1290, 1330, 22], [560, 1420, 26]],
    clear: [[1200, 1200, 150], [840, 1420, 110], [1080, 1520, 110], [820, 1660, 90], [900, 1180, 90], [1260, 1420, 80]],
  },
  {
    ...RUSH_COMMON,
    id: 'rush_ember', name: 'Cinder Run', theme: 'autumn', weather: ['clear', 'heat', 'wind', 'dust'],
    blurb: 'Lane Rush: a scorched canyon lane. Tight flanks, brawls at the Kami pit, first Crystal wins.',
    midHalf: [[600, 1800], [800, 1720], [900, 1520], [1080, 1440], [1200, 1200]],
    paths: [
      [[1200, 1200], [1100, 1100], [870, 870]],
      [[800, 1720], [700, 1500], [800, 1260], [870, 870]],
      [[1080, 1440], [1240, 1560], [1400, 1480]],
    ],
    shrine: [730, 1400], riverW: 38,
    brush: [[700, 1640, 40], [990, 1300, 40], [1260, 1600, 42], [860, 1120, 40], [1090, 1640, 34], [800, 1400, 34]],
    rocks: [[980, 1700, 28], [640, 1380, 28], [1180, 1380, 22]],
    clear: [[1200, 1200, 120], [940, 1420, 100], [1120, 1580, 90], [860, 1180, 80], [700, 1680, 70]],
  },
];
