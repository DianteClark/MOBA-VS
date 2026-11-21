#!/usr/bin/env python3
# Rebuilds the extra audio assets (v21 audio overhaul) from the Ninja Adventure pack.
# Usage: python3 -I tools/audio_assets.py "/path/to/Ninja Adventure - Asset Pack/Audio"
# SFX: mono 44.1k mp3 (~64 kbps), each clip normalized so its loudest 50 ms window sits at -14 dBFS RMS
# (peak capped at -1 dBFS), so the per-sound gains in src/audio.js start from the same level.
# Music: stereo 96 kbps mp3, like the tracks already in assets/audio/music.
import os, subprocess, sys
import numpy as np

PACK = sys.argv[1]
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets', 'audio')
S = os.path.join(PACK, 'Sounds')
J = os.path.join(PACK, 'Jingles')
SFX = {
  # hits by weight
  'hit_l1': 'Hit & Impact/Hit1', 'hit_l2': 'Hit & Impact/Hit6', 'hit_m1': 'Hit & Impact/Hit5', 'hit_m2': 'Hit & Impact/Hit8',
  'hit_h1': 'Hit & Impact/Impact3', 'hit_h2': 'Hit & Impact/Impact', 'crit': 'Whoosh & Slash/Slash3',
  # clan cast families
  'iron1': 'Whoosh & Slash/Sword2', 'iron2': 'Hit & Impact/Impact4',
  'beast1': 'Hit & Impact/Impact5', 'beast2': 'Hit & Impact/Hit7',
  'shin1': 'Whoosh & Slash/Whoosh', 'shin2': 'Whoosh & Slash/Slash',
  'spir1': 'Magic & Skill/Magic1', 'spir2': 'Magic & Skill/Magic2',
  'wild1': 'Elemental/Grass', 'wild2': 'Creature/Wings2',
  # element layers
  'water1': 'Elemental/Water2', 'water2': 'Elemental/Water5', 'ice': 'Magic & Skill/Magic4', 'zap': 'Magic & Skill/Magic5',
  'rock': 'Elemental/Explosion3', 'plant': 'Elemental/Grass2', 'shield': 'Bonus/Bonus3',
  # world
  'tshot': 'Elemental/Fireball2', 'boom': 'Elemental/Explosion6', 'minion': 'Hit & Impact/Hit3', 'coin2': 'Bonus/Coin2',
  'gold': 'Bonus/Gold1', 'kill': 'Hit & Impact/Impact2',
  # stingers (music bus)
  'st_win': 'J:Success3', 'st_lose': 'J:GameOver3', 'st_ace': 'J:LevelUp2', 'st_obj': 'J:Secret2', 'st_last': 'Alert/Alert5',
}
MUSIC = {'calm': 'Musics/38 - Intro.ogg', 'laststand': 'Musics/24 - Final Area.ogg'}

def pcm(path, extra=()):
  raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, *extra, '-ac', '1', '-ar', '44100', '-f', 'f32le', '-'], capture_output=True, check=True).stdout
  return np.frombuffer(raw, dtype=np.float32)

def enc(a, out):
  subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', '44100', '-ac', '1', '-i', '-', '-b:a', '64k', out], input=a.astype(np.float32).tobytes(), check=True)

def norm(a, target=-14.0):
  w = 2205; n = max(1, len(a) // w)
  rms = np.sqrt((a[:n * w].reshape(n, w) ** 2).mean(1)).max() if len(a) >= w else np.sqrt((a ** 2).mean())
  g = 10 ** (target / 20) / max(rms, 1e-6)
  g = min(g, 10 ** (-1 / 20) / max(np.abs(a).max(), 1e-6))
  return a * g

for name, src in SFX.items():
  p = os.path.join(J, src[2:] + '.wav') if src.startswith('J:') else os.path.join(S, src + '.wav')
  enc(norm(pcm(p), -16.0 if name.startswith('st_') else -14.0), os.path.join(OUT, 'sfx', name + '.mp3'))

# Objective roar: a voice grunt pitched down an octave and a half, layered on a low explosion, with a short tail.
v = pcm(os.path.join(S, 'Voice/Voice5.wav'), ['-af', 'asetrate=44100*0.42,aresample=44100,lowpass=f=2400'])
b = pcm(os.path.join(S, 'Elemental/Explosion4.wav'), ['-af', 'asetrate=44100*0.6,aresample=44100'])
n = max(len(v), len(b)); r = np.zeros(n + 22050, dtype=np.float32)
r[:len(v)] += v; r[:len(b)] += 0.6 * b
tail = np.zeros_like(r); d = 6615
for k in range(1, 4): tail[d * k:] += r[:len(r) - d * k] * (0.35 ** k)
r = r + tail
fade = np.ones_like(r); fade[-8000:] = np.linspace(1, 0, 8000); r *= fade
enc(norm(r, -13.0), os.path.join(OUT, 'sfx', 'roar.mp3'))

for name, src in MUSIC.items():
  subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', os.path.join(PACK, src), '-ac', '2', '-ar', '44100', '-b:a', '96k', os.path.join(OUT, 'music', name + '.mp3')], check=True)
print('ok')
