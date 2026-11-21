// Replay upload for anti-cheat (ranked and Weekend Cup reports): the match config and the command log the
// sim consumed, enough for tools/verify.mjs to re-simulate the match at the same VERSION. Gzipped and
// base64-encoded when the browser has CompressionStream (a full match is ~3-6 KB), plain JSON otherwise.
// The coach flags are left out on purpose: online matches are always two human coaches, and an AI coach
// that took over a disconnected opponent is listed in `ai` as [tick, team].
export const REPLAY_MAX = 64 * 1024; // the Worker's cap (worker/anticheat.js)

export function replayDoc(v, cfg, log, ai) {
  const rest = { ...(cfg || {}) }; delete rest.coach; delete rest.coachLevel;
  return { v, cfg: rest, log, ai: ai && ai.length ? ai : undefined };
}

async function gzip64(text) {
  const cs = new CompressionStream('gzip');
  const buf = await new Response(new Blob([text]).stream().pipeThrough(cs)).arrayBuffer();
  const b = new Uint8Array(buf); let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
  return btoa(s);
}

// → { v, enc, data } or null when it does not fit (the report still goes through, just unverifiable).
export async function packReplay(v, cfg, log, ai) {
  try {
    const text = JSON.stringify(replayDoc(v, cfg, log, ai));
    let out = null;
    if (typeof CompressionStream === 'function') { try { out = { v, enc: 'gz64', data: await gzip64(text) }; } catch { out = null; } }
    if (!out) out = { v, enc: 'json', data: text };
    return out.data.length <= REPLAY_MAX ? out : null;
  } catch { return null; }
}
