#!/usr/bin/env python3
# Builds the v24 music packs from the Ninja Adventure pack (CC0):
#   per-map laning ("calm") and fight ("tension") tracks, a victory theme per clan, and the Hearth clan cast sounds.
# Music: mono 32 kHz, 48 kbps mp3, gain-matched to about -20 LUFS (so src/audio.js track gains stay near 1).
# They stream lazily through the music decks (only the current map's pack is ever fetched).
# Usage: python3 -I tools/music_assets.py "/path/to/Ninja Adventure - Asset Pack/Audio"
import os, re, subprocess, sys

PACK = sys.argv[1]
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets', 'audio')
M = os.path.join(PACK, 'Musics')
MUSIC = {
  # map packs
  'map_sakura': '31 - Sunny', 'map_frost': '22 - Dream', 'map_ember': '23 - Road', 'map_marsh': '13 - Mystical',
  'map_oasis': '11 - Clearing', 'map_ruins': '30 - Ruins', 'map_tide': '39 - Boat', 'map_sky': '35 - Adventure',
  'fight_bright': '1 - Adventure Begin', 'fight_cold': '3 - Revelation', 'fight_dark': '14 - Curse',
  # clan victory themes
  'win_iron': '12 - Temple', 'win_beast': '2 - The Cave', 'win_shinobi': '6 - Story (Short)', 'win_spirit': '19 - Ascension',
  'win_wild': '5 - Peaceful', 'win_hearth': '4 - Village',
}
SFX = {'hearth1': 'Sounds/Elemental/Fire2', 'hearth2': 'Sounds/Magic & Skill/Magic3'}

def loudness(path):
  r = subprocess.run(['ffmpeg', '-v', 'info', '-nostats', '-i', path, '-af', 'ebur128', '-f', 'null', '-'], capture_output=True, text=True).stderr
  return float(re.findall(r'I:\s+(-?[\d.]+) LUFS', r)[-1])

for name, src in MUSIC.items():
  p = os.path.join(M, src + '.ogg')
  gain = max(-12.0, min(12.0, -20.0 - loudness(p)))
  subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', p, '-af', f'volume={gain:.2f}dB,alimiter=limit=0.89', '-ac', '1', '-ar', '32000', '-b:a', '48k',
                  os.path.join(OUT, 'music', name + '.mp3')], check=True)
for name, src in SFX.items():
  p = os.path.join(PACK, src + '.wav')
  gain = max(-12.0, min(18.0, -16.0 - loudness(p)))
  subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', p, '-af', f'volume={gain:.2f}dB,alimiter=limit=0.89', '-ac', '1', '-ar', '44100', '-b:a', '64k',
                  os.path.join(OUT, 'sfx', name + '.mp3')], check=True)
print('ok')
