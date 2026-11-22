// Owner tools inside the game: open a flagged match's uploaded replay in the Replay Theater
// (/?ar=MATCH, linked from the dashboard), using the dashboard token saved on this device.
import { toast } from './dom.js';
import { API } from '../net/online.js';

async function gunzip64(b64) {
  const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const ds = new DecompressionStream('gzip');
  return new Response(new Blob([bin]).stream().pipeThrough(ds)).text();
}
export async function decodeReplay(r) {
  const text = r.enc === 'gz64' ? await gunzip64(r.data) : r.data;
  return JSON.parse(text);
}

export async function openAdminReplay(app, match, version) {
  try { history.replaceState(null, '', location.pathname); } catch { /* ignore */ }
  let tok = null; try { tok = localStorage.getItem('mobavs_admin'); } catch { /* ignore */ }
  if (!tok) { toast('Open the dashboard (admin.html) on this device and paste the token first.', 3500); app.menu(); return; }
  try {
    const r = await fetch(`${API}/api/admin/ops/replay?match=${encodeURIComponent(match)}`, { headers: { authorization: 'Bearer ' + tok } });
    if (!r.ok) throw new Error(r.status === 404 ? 'Replay not found (or the token is wrong)' : 'HTTP ' + r.status);
    const d = await r.json(), pick = d.replays.find((x) => x.status === 'bad') || d.replays[0];
    if (!pick) throw new Error('No replay was uploaded for this match');
    const doc = await decodeReplay(pick);
    if (doc.v !== version) { toast(`This replay is from game version ${doc.v}; this build plays ${version}. Re-check it with tools/verify.mjs instead.`, 4500); app.menu(); return; }
    if (doc.ai && doc.ai.length) toast(`Note: an AI coach took over at tick ${doc.ai[0][0]}; the Theater keeps the human log only.`, 3500);
    const m = d.match;
    app.watchReplay({ v: doc.v, cfg: { ...doc.cfg, coach: [false, false], coachLevel: [1, 1] }, log: doc.log, names: [m.bname || m.blue || 'Blue', m.rname || m.red || 'Red'], mapId: doc.cfg.map }, { back: () => app.menu() });
  } catch (e) { toast('Could not open the replay: ' + (e.message || e), 3500); app.menu(); }
}
