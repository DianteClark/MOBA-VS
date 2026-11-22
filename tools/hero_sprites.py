#!/usr/bin/env python3
# Builds the v24 hero sprite sheets (assets/img/heroes/<id>.png, 4x7 frames of 16px) and portraits
# (assets/img/faces/<id>.png, 38x38) from the Ninja Adventure pack.
#   Character bodies (already 4x7: columns down/up/left/right, rows walk x4, attack, jump, special) are copied.
#   Monster bodies (4x4: columns down/left/up/right, rows = walk frames) are re-ordered to the hero column order
#   and given synthesized attack (lunge), jump (lift) and special (squash) rows, so the renderer treats them alike.
# Usage: python3 -I tools/hero_sprites.py "/path/to/Ninja Adventure - Asset Pack"
import os, sys
from PIL import Image

PACK = sys.argv[1]
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets', 'img')
CHAR = {  # hero id -> Actor/Character/<name>
  'daichi': 'Villager', 'tobi': 'Villager4', 'kenta': 'Boy', 'isamu': 'Villager3', 'taro': 'EggBoy',
  'mame': 'Village6', 'suzu': 'EggGirl', 'momo': 'Child', 'ume': 'OldWoman', 'aki': 'Woman',
}
MON = {  # hero id -> (Actor/Monster/<dir>, sheet file)
  'kuma': ('Bear', 'SpriteSheet.png'), 'mogura': ('Mole', None), 'hebi': ('Snake2', None), 'upa': ('Axolot', 'SpriteSheet.png'),
  'fukuro': ('Owl', 'Owl.png'), 'hitotsume': ('Cyclope', 'SpriteSheet.png'), 'komori': ('BlueBat', None), 'tako': ('Octopus', 'SpriteSheet.png'),
  'bao': ('Panda', 'SpriteSheet.png'), 'kinoko': ('Mushroom', None),
}
DIR_FROM_MON = [0, 2, 1, 3]  # hero column (down, up, left, right) -> monster column (down, left, up, right)
SHIFT = [(0, 1), (0, -1), (-1, 0), (1, 0)]  # facing direction per hero column

def frame(sheet, c, r):
  return sheet.crop((c * 16, r * 16, c * 16 + 16, r * 16 + 16))

def shifted(img, dx, dy):
  out = Image.new('RGBA', (16, 16), (0, 0, 0, 0)); out.paste(img, (dx, dy), img); return out

def squash(img):
  s = img.resize((16, 14), Image.NEAREST); out = Image.new('RGBA', (16, 16), (0, 0, 0, 0)); out.paste(s, (0, 2), s); return out

def monster_sheet(src):
  out = Image.new('RGBA', (64, 112), (0, 0, 0, 0))
  for hc in range(4):
    mc = DIR_FROM_MON[hc]
    for r in range(4): out.paste(frame(src, mc, r), (hc * 16, r * 16))
    dx, dy = SHIFT[hc]
    out.paste(shifted(frame(src, mc, 1), dx * 2, dy * 2), (hc * 16, 64))   # attack: lunge toward the facing
    out.paste(shifted(frame(src, mc, 2), 0, -2), (hc * 16, 80))              # jump / dash: lifted
    out.paste(squash(frame(src, 0, 0)), (hc * 16, 96))                       # special (cast): squashed front pose
  return out

for hid, name in CHAR.items():
  d = os.path.join(PACK, 'Actor', 'Character', name)
  Image.open(os.path.join(d, 'SpriteSheet.png')).convert('RGBA').save(os.path.join(OUT, 'heroes', hid + '.png'), optimize=True)
  Image.open(os.path.join(d, 'Faceset.png')).convert('RGBA').save(os.path.join(OUT, 'faces', hid + '.png'), optimize=True)
for hid, (name, f) in MON.items():
  d = os.path.join(PACK, 'Actor', 'Monster', name)
  if not f: f = next(x for x in sorted(os.listdir(d)) if x.endswith('.png') and 'Face' not in x)
  src = Image.open(os.path.join(d, f)).convert('RGBA')
  assert src.size == (64, 64), (name, src.size)
  monster_sheet(src).save(os.path.join(OUT, 'heroes', hid + '.png'), optimize=True)
  Image.open(os.path.join(d, 'Faceset.png')).convert('RGBA').save(os.path.join(OUT, 'faces', hid + '.png'), optimize=True)
print('ok', len(CHAR) + len(MON))
