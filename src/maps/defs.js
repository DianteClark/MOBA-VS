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
//   brush    tall-grass blobs [x, y, r]; rocks: blocking boulders [x, y, r]; clear: extra open areas [x, y, r]
//   theme    painter palette; weather: cycle used on this map

export const MAPS = [
  {
    id: 'sakura', name: 'Sakura Valley', theme: 'spring', weather: ['clear', 'rain', 'clear', 'fog', 'clear', 'wind'],
    blurb: 'Classic three-lane valley. Wide river, cherry groves, balanced jungle.',
    top: [[330, 2070], [262, 1760], [244, 1250], [252, 760], [292, 470], [380, 345], [500, 280], [760, 250], [1250, 244], [1760, 262], [2070, 330]],
    midHalf: [[330, 2070], [560, 1840], [880, 1520], [1200, 1200]],
    river: [[300, 300], [520, 560], [760, 760], [1000, 1000], [1200, 1200]], riverW: 74,
    paths: [
      [[262, 1500], [430, 1420], [600, 1460], [760, 1600]],
      [[248, 1080], [430, 1020], [620, 1120], [760, 1270], [880, 1100], [960, 940]],
      [[620, 1120], [560, 1300], [430, 1420]],
      [[760, 1600], [980, 1560], [1120, 1620], [1280, 1780], [1420, 1960], [1520, 2140]],
      [[1120, 1620], [1340, 1480], [1460, 1360]],
      [[1280, 1780], [1560, 1720], [1700, 1680]],
      [[980, 1560], [1000, 1760], [960, 2010], [1000, 2150]],
    ],
    camps: [
      { id: 'bb', at: [620, 1120], kind: 'bluebuff' }, { id: 'gromp', at: [430, 1020], kind: 'gromp' }, { id: 'wolf', at: [600, 1460], kind: 'wolf' },
      { id: 'rb', at: [1280, 1780], kind: 'redbuff' }, { id: 'rap', at: [1120, 1620], kind: 'raptor' }, { id: 'krug', at: [1420, 1960], kind: 'krug' },
    ],
    kraken: [700, 640], shrine: [1420, 1520],
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
    ],
    camps: [
      { id: 'bb', at: [700, 1300], kind: 'bluebuff' }, { id: 'gromp', at: [520, 880], kind: 'gromp' }, { id: 'wolf', at: [560, 1560], kind: 'wolf' },
      { id: 'rb', at: [1300, 1960], kind: 'redbuff' }, { id: 'rap', at: [1180, 1700], kind: 'raptor' }, { id: 'krug', at: [920, 1800], kind: 'krug' },
    ],
    kraken: [760, 700], shrine: [1460, 1440],
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
      [[300, 1450], [470, 1380], [620, 1290], [760, 1180], [900, 1050]],
      [[280, 760], [450, 900], [620, 1000], [760, 1180]],
      [[640, 1780], [860, 1840], [1080, 1900], [1320, 1960], [1500, 2140]],
      [[880, 1560], [1060, 1640], [1260, 1640], [1440, 1560], [1600, 1600]],
      [[1080, 1900], [1160, 1760], [1260, 1640]],
      [[470, 1380], [520, 1560], [640, 1780]],
    ],
    camps: [
      { id: 'bb', at: [620, 1000], kind: 'bluebuff' }, { id: 'gromp', at: [470, 1380], kind: 'gromp' }, { id: 'wolf', at: [620, 1290], kind: 'wolf' },
      { id: 'rb', at: [1320, 1960], kind: 'redbuff' }, { id: 'rap', at: [1160, 1760], kind: 'raptor' }, { id: 'krug', at: [860, 1840], kind: 'krug' },
    ],
    kraken: [720, 680], shrine: [1500, 1460],
    brush: [[400, 1180, 50], [760, 1420, 52], [1060, 1760, 50], [1460, 1720, 50], [360, 560, 50], [960, 900, 54], [1700, 2040, 46], [700, 1640, 44]],
    rocks: [[1080, 1380, 70], [540, 1160, 32], [1220, 1820, 32], [800, 1700, 28], [940, 1160, 30]],
    clear: [[1200, 1200, 140]],
  },
];
export const MAP_BY_ID = Object.fromEntries(MAPS.map((m) => [m.id, m]));
