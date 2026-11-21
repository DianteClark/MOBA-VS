// Game snapshots for the Replay Theater (render side; the sim is never changed).
// A snapshot is a deep copy of a Game that keeps every class prototype, so a copy steps on exactly like the
// original (checked by tools/theater.mjs). The map (World, with its path/vision caches) and all static data
// (heroes, items, tuning, map defs...) are shared, never copied: the sim only reads them, and some code
// compares them by identity (waypoints, item objects).
import * as K from '../sim/constants.js';
import * as ITEMS from '../data/items.js';
import * as SYN from '../data/synergy.js';
import * as HEROES from '../data/heroes.js';
import * as MAPS from '../maps/defs.js';
import * as TACT from '../data/tactics.js';
import * as TUNE from '../data/tuning.js';
import * as MODES from '../sim/modes.js';

const DATA = [K, ITEMS, SYN, HEROES, MAPS, TACT, TUNE, MODES].flatMap((m) => Object.values(m));
let dataSet = null;
const shared = new WeakMap(); // world -> Set of objects never copied

function reach(roots, into) {
  const st = [...roots];
  while (st.length) {
    const v = st.pop();
    if (!v || typeof v !== 'object' || into.has(v)) continue;
    into.add(v);
    if (ArrayBuffer.isView(v)) continue;
    if (v instanceof Map) { for (const x of v.values()) st.push(x); continue; }
    if (v instanceof Set) { for (const x of v) st.push(x); continue; }
    for (const k of Object.keys(v)) st.push(v[k]);
  }
  return into;
}
function sharedFor(world) {
  let s = shared.get(world);
  if (!s) { if (!dataSet) dataSet = reach(DATA, new Set()); s = reach([world], new Set(dataSet)); shared.set(world, s); }
  return s;
}
// Deep copy with prototypes. Iterative, so long unit chains never blow the stack on a phone.
function copy(root, keep) {
  const seen = new Map(), out = make(root), work = [[root, out]];
  function make(v) {
    let o;
    if (ArrayBuffer.isView(v)) o = v.slice();
    else if (Array.isArray(v)) o = new Array(v.length);
    else if (v instanceof Map) o = new Map();
    else if (v instanceof Set) o = new Set();
    else o = Object.create(Object.getPrototypeOf(v));
    seen.set(v, o); return o;
  }
  const val = (v) => {
    if (v === null || typeof v !== 'object' || keep.has(v)) return v;
    const o = seen.get(v); if (o) return o;
    const n = make(v); if (!ArrayBuffer.isView(v)) work.push([v, n]); return n;
  };
  while (work.length) {
    const [v, o] = work.pop();
    if (Array.isArray(v)) { for (let i = 0; i < v.length; i++) o[i] = val(v[i]); }
    else if (v instanceof Map) { for (const [k, x] of v) o.set(k, val(x)); }
    else if (v instanceof Set) { for (const x of v) o.add(val(x)); }
    else for (const k of Object.keys(v)) o[k] = val(v[k]);
  }
  return out;
}
// A frozen copy of the game at its current tick (cosmetic fx are dropped).
export function snapshot(game) { const s = copy(game, sharedFor(game.world)); s.fx = []; return s; }
// A live game from a snapshot (the snapshot itself stays untouched and reusable).
export function restore(snap) { return copy(snap, sharedFor(snap.world)); }
