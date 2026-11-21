// Hand-authored maps. Each map is described for the BLUE half; the world builder mirrors
// everything through the map centre (point symmetry), so every map is perfectly fair.
//
//   top      full top-lane polyline from Blue base to Red base (bot lane = its mirror)
//   midHalf  mid lane from Blue base to the map centre
//   river    river polyline from the top-left corner to the centre (mirrored onward)
//   paths    jungle corridors (polylines) on Blue's side
//   camps    Blue jungle camps
//   kraken   top-side river pit (the Kami pit is its mirror)
//   shrine   Blue's river shrine (Red's is the mirror)
//   towerLayout optional tower layout: outer (side-lane towers on the outer edge of the lane), midFlip (mid
//            towers on the other side), side / mid (tier 1-3 + inhibitor spots as fractions of half a lane,
//            from the owner's base). Pits and camps must stay out of tower range: tools/maps.mjs checks it.
//   brush    tall-grass blobs [x, y, r]; rocks: blocking boulders [x, y, r]; clear: extra open areas [x, y, r]
//   theme    painter palette; weather: cycle used on this map
//   Lane Rush maps live in rush.js (single lane, smaller base); they are looked up by id like any map.
import { RUSH_MAPS } from './rush.js';
export { RUSH_MAPS };

export const MAPS = [
  {
    id: 'sakura', name: 'Sakura Valley', theme: 'spring', weather: ['clear', 'rain', 'clear', 'fog', 'clear', 'wind'],
    blurb: 'Classic three-lane valley. Wide river, cherry groves, balanced jungle.',
    top: [[330, 2070], [262, 1760], [244, 1250], [252, 760], [292, 470], [380, 345], [500, 280], [760, 250], [1250, 244], [1760, 262], [2070, 330]],
    midHalf: [[330, 2070], [560, 1840], [880, 1520], [1200, 1200]],
    river: [[300, 300], [520, 560], [760, 760], [1000, 1000], [1200, 1200]], riverW: 74,
    paths: [
      [[262, 1500], [430, 1420], [588, 1428], [760, 1600]],
      [[248, 1080], [444, 1068], [636, 1140], [760, 1270], [880, 1100], [960, 940]],
      [[636, 1140], [560, 1300], [430, 1420]],
      [[760, 1600], [980, 1560], [1120, 1620], [1308, 1740], [1420, 1960], [1520, 2140]],
      [[1120, 1620], [1340, 1480], [1460, 1360]],
      [[1308, 1740], [1560, 1720], [1700, 1680]],
      [[980, 1560], [1000, 1760], [960, 2010], [1000, 2150]],
      // spurs to camps moved out of tower range
      [[1120, 1620], [1140, 1884]], [[1420, 1960], [1332, 1956]],
    ],
    camps: [
      { id: 'bb', at: [636, 1140], kind: 'bluebuff' }, { id: 'gromp', at: [444, 1068], kind: 'gromp' }, { id: 'wolf', at: [588, 1428], kind: 'wolf' },
      { id: 'rb', at: [1308, 1740], kind: 'redbuff' }, { id: 'rap', at: [1140, 1884], kind: 'raptor' }, { id: 'krug', at: [1332, 1956], kind: 'krug' },
    ],
    towerLayout: { outer: true },
    kraken: [649, 678], shrine: [1420, 1520],
    brush: [[430, 1240, 60], [850, 1700, 56], [1180, 1440, 54], [1500, 1880, 50], [340, 620, 58], [1640, 2150, 52], [980, 860, 58], [760, 420, 50], [1020, 1980, 46], [520, 1640, 44]],
    rocks: [[520, 1240, 34], [900, 1400, 30], [1180, 1880, 34], [740, 1060, 28], [1380, 1640, 28]],
    clear: [[1200, 1200, 150]],
  },
  {
    id: 'frost', name: 'Frostfang Pass', theme: 'winter', weather: ['snow', 'clear', 'blizzard', 'snow', 'clear', 'fog'],
    blurb: 'Winding mountain lanes around a frozen central lake. Long rotations, deadly chokepoints.',
    top: [[330, 2070], [300, 1800], [400, 1560], [300, 1300], [250, 1000], [360, 760], [300, 520], [430, 360], [640, 300], [900, 380], [1150, 260], [1460, 300], [1800, 250], [2070, 330]],
    midHalf: [[330, 2070], [620, 1880], [760, 1640], [1000, 1520], [1200, 1200]],
    river: [[340, 340], [600, 640], [880, 880], [1200, 1200]], riverW: 66,
    paths: [
      [[400, 1560], [560, 1420], [700, 1300], [760, 1100], [920, 1000]],
      [[360, 760], [520, 880], [700, 1000]],
      [[760, 1640], [900, 1760], [1100, 1840], [1300, 1960], [1500, 2120]],
      [[1000, 1520], [1180, 1560], [1380, 1600], [1560, 1640]],
      [[1100, 1840], [1180, 1700], [1180, 1560]],
      [[560, 1420], [600, 1600], [760, 1640]],
      // spurs to camps moved out of tower range
      [[700, 1300], [732, 1140]], [[520, 880], [516, 1044]], [[560, 1560], [564, 1236]], [[1300, 1960], [1236, 1884]], [[920, 1800], [948, 1836]],
    ],
    camps: [
      { id: 'bb', at: [732, 1140], kind: 'bluebuff' }, { id: 'gromp', at: [516, 1044], kind: 'gromp' }, { id: 'wolf', at: [564, 1236], kind: 'wolf' },
      { id: 'rb', at: [1236, 1884], kind: 'redbuff' }, { id: 'rap', at: [1180, 1700], kind: 'raptor' }, { id: 'krug', at: [948, 1836], kind: 'krug' },
    ],
    towerLayout: { outer: true, midFlip: true },
    kraken: [781, 755], shrine: [1460, 1440],
    brush: [[470, 1180, 56], [880, 1640, 54], [1300, 1720, 52], [1650, 2010, 50], [420, 600, 56], [1050, 980, 56], [620, 380, 46], [1040, 2080, 46]],
    rocks: [[600, 1240, 40], [820, 1460, 34], [1060, 1700, 36], [460, 1000, 30], [1500, 1800, 32], [880, 1200, 30]],
    clear: [[1200, 1200, 230], [1000, 1520, 90]], lake: 210,
  },
  {
    id: 'ember', name: 'Ember Canyon', theme: 'autumn', weather: ['clear', 'wind', 'heat', 'clear', 'dust', 'wind'],
    blurb: 'Tight canyon lanes and a split mid around the Sunstone mesa. Brawly and fast.',
    top: [[330, 2070], [240, 1780], [300, 1450], [230, 1100], [280, 760], [250, 470], [420, 300], [760, 270], [1100, 220], [1450, 290], [1780, 230], [2070, 330]],
    midHalf: [[330, 2070], [640, 1780], [880, 1560], [960, 1300], [1200, 1200]],
    river: [[330, 330], [560, 600], [840, 800], [1040, 1060], [1200, 1200]], riverW: 58,
    paths: [
      [[300, 1450], [516, 1428], [636, 1260], [760, 1180], [900, 1050]],
      [[280, 760], [450, 900], [620, 1000], [760, 1180]],
      [[640, 1780], [860, 1840], [1080, 1900], [1380, 1908], [1500, 2140]],
      [[880, 1560], [1060, 1640], [1260, 1640], [1440, 1560], [1600, 1600]],
      [[1080, 1900], [1160, 1760], [1260, 1640]],
      [[516, 1428], [520, 1560], [640, 1780]],
      // spurs to camps moved out of tower range
      [[1160, 1760], [1236, 1692]], [[860, 1840], [1164, 1884]],
    ],
    camps: [
      { id: 'bb', at: [620, 1000], kind: 'bluebuff' }, { id: 'gromp', at: [516, 1428], kind: 'gromp' }, { id: 'wolf', at: [636, 1260], kind: 'wolf' },
      { id: 'rb', at: [1380, 1908], kind: 'redbuff' }, { id: 'rap', at: [1236, 1692], kind: 'raptor' }, { id: 'krug', at: [1164, 1884], kind: 'krug' },
    ],
    towerLayout: { outer: true },
    kraken: [683, 701], shrine: [1500, 1460],
    brush: [[400, 1180, 50], [760, 1420, 52], [1060, 1760, 50], [1460, 1720, 50], [360, 560, 50], [960, 900, 54], [1700, 2040, 46], [700, 1640, 44]],
    rocks: [[1080, 1380, 70], [540, 1160, 32], [1220, 1820, 32], [800, 1700, 28], [940, 1160, 30]],
    clear: [[1200, 1200, 140]],
  },
  {
    id: 'marsh', name: 'Moonlit Marsh', theme: 'marsh', weather: ['fog', 'clear', 'rain', 'fog', 'clear', 'rain'],
    blurb: 'A misty swamp at night. Two jungle crossings, reed beds everywhere: vision wins games here.',
    top: [[330, 2070], [280, 1820], [330, 1560], [250, 1300], [270, 1000], [240, 720], [330, 470], [480, 330], [720, 290], [1000, 250], [1300, 300], [1600, 250], [1820, 280], [2070, 330]],
    midHalf: [[330, 2070], [520, 1900], [700, 1640], [960, 1440], [1200, 1200]],
    river: [[320, 320], [560, 520], [700, 760], [960, 960], [1200, 1200]], riverW: 80,
    paths: [
      [[330, 1560], [540, 1428], [700, 1640]],
      [[270, 1000], [480, 1060], [640, 1220], [760, 1060], [900, 900]],
      [[640, 1220], [700, 1400], [700, 1640]],
      [[700, 1640], [880, 1760], [1060, 1700], [1284, 1788], [1420, 2000], [1560, 2150]],
      [[1060, 1700], [1160, 1520], [1360, 1460]],
      [[1284, 1788], [1480, 1760], [1680, 1700]],
      [[880, 1760], [860, 1980], [940, 2150]],
      [[480, 1060], [420, 840], [560, 700]],
      // spurs to camps moved out of tower range
      [[1060, 1700], [1092, 1860]], [[1420, 2000], [1452, 1908]],
    ],
    camps: [
      { id: 'bb', at: [640, 1220], kind: 'bluebuff' }, { id: 'gromp', at: [480, 1060], kind: 'gromp' }, { id: 'wolf', at: [540, 1428], kind: 'wolf' },
      { id: 'rb', at: [1284, 1788], kind: 'redbuff' }, { id: 'rap', at: [1092, 1860], kind: 'raptor' }, { id: 'krug', at: [1452, 1908], kind: 'krug' },
    ],
    towerLayout: { outer: true, side: [0.76, 0.5, 0.27, 0.15], mid: [0.75, 0.44, 0.29, 0.15] },
    kraken: [656, 688], shrine: [1400, 1560],
    brush: [[400, 1300, 62], [820, 1580, 58], [1160, 1400, 56], [1520, 1900, 54], [380, 600, 58], [1700, 2140, 50], [960, 820, 60], [780, 380, 52], [1000, 2020, 50], [580, 1720, 50], [300, 860, 44], [1300, 1640, 44]],
    rocks: [[560, 1340, 32], [920, 1340, 28], [1160, 1900, 32], [780, 1120, 28], [1340, 1700, 26]],
    clear: [[1200, 1200, 170]],
  },
  {
    id: 'oasis', name: 'Sunscar Oasis', theme: 'desert', weather: ['heat', 'clear', 'dust', 'heat', 'clear', 'dust'],
    blurb: 'Desert roads cut the corners: the Kraken and Kami lairs hide in dune pockets behind the side lanes. A causeway crosses the central oasis.',
    top: [[330, 2070], [250, 1760], [240, 1300], [270, 1060], [560, 770], [770, 560], [1060, 270], [1300, 240], [1760, 250], [2070, 330]],
    midHalf: [[330, 2070], [600, 1800], [900, 1500], [1200, 1200]],
    river: [[430, 430], [700, 700], [950, 950], [1200, 1200]], riverW: 44, lake: 190,
    paths: [
      [[250, 1500], [420, 1460], [560, 1460], [700, 1300], [700, 1180], [860, 1040], [960, 980]],
      [[700, 1180], [520, 1100], [470, 920]],
      [[560, 1460], [660, 1620], [760, 1660]],
      [[760, 1660], [940, 1760], [1200, 1840], [1300, 1760], [1440, 1560], [1380, 1500]],
      [[1300, 1760], [1560, 1660], [1680, 1680]],
      [[1200, 1840], [1100, 1990], [1060, 2150]],
    ],
    camps: [
      { id: 'bb', at: [700, 1180], kind: 'bluebuff' }, { id: 'gromp', at: [520, 1100], kind: 'gromp' }, { id: 'wolf', at: [560, 1460], kind: 'wolf' },
      { id: 'rb', at: [1300, 1760], kind: 'redbuff' }, { id: 'rap', at: [1200, 1840], kind: 'raptor' }, { id: 'krug', at: [1560, 1660], kind: 'krug' },
    ],
    towerLayout: { outer: true, side: [0.62, 0.42, 0.25, 0.15] },
    kraken: [470, 470], shrine: [1380, 1500],
    brush: [[400, 1700, 62], [380, 1250, 58], [760, 860, 58], [1060, 1620, 56], [1640, 1880, 58], [1240, 2010, 52], [880, 1320, 50], [300, 640, 44]],
    rocks: [[760, 1400, 34], [600, 1300, 26], [1180, 1660, 34], [960, 1940, 30], [400, 1000, 26]],
    clear: [[1200, 1200, 150], [470, 470, 220]],
  },
  {
    id: 'ruins', name: 'Mossgate Ruins', theme: 'ruins', weather: ['clear', 'rain', 'fog', 'clear', 'wind', 'rain'],
    blurb: 'A ruined temple city. Narrow stone streets, stepped corners, and a pillared plaza around the centre made for ambushes.',
    laneW: 58,
    top: [[330, 2070], [250, 1780], [250, 1000], [250, 640], [310, 580], [400, 580], [470, 510], [510, 470], [580, 400], [580, 310], [640, 250], [1000, 250], [1780, 250], [2070, 330]],
    midHalf: [[330, 2070], [600, 1800], [760, 1600], [960, 1440], [1200, 1200]],
    river: [[320, 320], [700, 700], [1200, 1200]], riverW: 50,
    paths: [
      [[250, 1240], [460, 1240], [640, 1240], [640, 1000], [640, 820], [760, 760]],
      [[640, 1000], [840, 1000], [840, 1120], [1060, 1120]],
      [[460, 1240], [460, 1420], [620, 1420], [720, 1560]],
      [[250, 860], [460, 860], [640, 820]],
      [[960, 1440], [1160, 1560], [1360, 1560], [1360, 1440]],
      [[1160, 1560], [1160, 1760], [1260, 1760], [1500, 1760], [1500, 1860]],
      [[1360, 1560], [1420, 1600], [1600, 1600], [1680, 1680]],
      [[1160, 1760], [1000, 1880], [960, 2150]],
      [[1500, 1860], [1560, 1960], [1600, 2150]],
    ],
    camps: [
      { id: 'bb', at: [840, 1120], kind: 'bluebuff' }, { id: 'gromp', at: [500, 1000], kind: 'gromp' }, { id: 'wolf', at: [640, 1240], kind: 'wolf' },
      { id: 'rb', at: [1260, 1760], kind: 'redbuff' }, { id: 'rap', at: [1420, 1600], kind: 'raptor' }, { id: 'krug', at: [1500, 1860], kind: 'krug' },
    ],
    towerLayout: { outer: true },
    kraken: [700, 720], shrine: [1360, 1440],
    brush: [[470, 1100, 48], [520, 1500, 46], [980, 1240, 44], [1300, 1900, 46], [1700, 1900, 44], [430, 700, 46], [800, 1980, 40], [1000, 1660, 44]],
    rocks: [[1060, 1210, 24], [1210, 1060, 24], [760, 1300, 30], [900, 1600, 28], [1340, 1660, 26], [1060, 1980, 30], [360, 1400, 26]],
    clear: [[1200, 1200, 250]],
  },
];
export const MAP_BY_ID = Object.fromEntries([...MAPS, ...RUSH_MAPS].map((m) => [m.id, m]));
