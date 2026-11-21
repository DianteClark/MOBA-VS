// Turn balance.mjs JSON dumps into a markdown report.
//   node tools/balreport.mjs before.json after.json changes.json > report.md
// changes.json: { "<heroId>": { "changes": "text", "rework": "text" }, "_notes": ["..."] }
import { readFileSync } from 'node:fs';
const [bf, af, cf] = process.argv.slice(2);
const B = JSON.parse(readFileSync(bf, 'utf8')), A = JSON.parse(readFileSync(af, 'utf8'));
const CH = cf ? JSON.parse(readFileSync(cf, 'utf8')) : {};
const { HEROES } = await import('../src/data/heroes.js');
const { BUILDS, BUILD_ORDER } = await import('../src/data/items.js');
const { TUNE } = await import('../src/data/tuning.js');
const wr = (s) => (s && s.g ? `${(100 * s.w / s.g).toFixed(0)}% (${s.g})` : '-');
const kda = (s) => (s && s.g ? `${(s.k / s.g).toFixed(1)}/${(s.d / s.g).toFixed(1)}/${(s.a / s.g).toFixed(1)}` : '-');
const share = (s) => (s && s.g ? `${(100 * s.share / s.g).toFixed(0)}%` : '-');
const abil = (s, h) => (s ? s.ab.map((v, i) => `${(v[0] / s.min).toFixed(1)}${['shot', 'hook', 'line', 'target', 'circle', 'nova', 'dash'].includes(h.abilities[i].kind) ? '·' + (v[0] ? Math.round(100 * v[1] / v[0]) : 0) + '%' : ''}`).join(' / ') : '-');
const L = [];
L.push('# MOBA-VS v20 balance report', '');
L.push(`Self-play scan with balanced hero coverage (per-role shuffled decks, random build from each hero's list, AI coaches on both sides, all four maps).`, '');
L.push(`* **Before**: ${B.n} games, blue ${(100 * B.blue / B.n).toFixed(0)}%, avg ${(B.len / B.n).toFixed(1)} min, decided on time ${(100 * B.timeouts / B.n).toFixed(0)}%.`);
L.push(`* **After**: ${A.n} games, blue ${(100 * A.blue / A.n).toFixed(0)}%, avg ${(A.len / A.n).toFixed(1)} min, decided on time ${(100 * A.timeouts / A.n).toFixed(0)}%.`);
L.push(`* Events per game after: ${Object.entries(A.ev).map(([k, v]) => `${k} ${(v / A.n).toFixed(2)}`).join(', ')}.`);
L.push(`* Sample size: ~${Math.round(A.n * 10 / HEROES.length)} games per hero per scan, so a single hero's win rate carries roughly ±${Math.round(50 / Math.sqrt(A.n * 10 / HEROES.length))} points (1 s.d.) of noise; changes were made on consistent signals (win rate plus KDA/damage share/usage), not on single numbers.`, '');
for (const n of CH._notes || []) L.push(`* ${n}`);
L.push('', '## Range sanity', '');
L.push(`Hero basic-attack range is now capped at ${A.cap} (tower ${255}), so a tower always out-ranges a hero standing at max range. Heroes that could exceed it with buffs/items: ${A.rangeRows.filter((r) => r.max > A.cap).map((r) => `${r.id} (${r.max})`).join(', ') || 'none'}. Melee heroes: every melee hero lands basic attacks on heroes (see "basic hits/min" below).`, '');
L.push('## Per hero', '');
L.push('Win rate (games) before → after. Impact = after win rate − 50. KDA, damage share of team and ability use are from the after scan. Abilities: casts per minute · % of casts that hit an enemy hero (Q / W / R; self/ally spells show casts only).', '');
L.push('| Hero | Role | Clan | Builds (★ rec) | Win before | Win after | Impact | KDA | Dmg share | Basic hits/min | Abilities | Tune | Changes | Rework |');
L.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const h of HEROES) {
  const b = B.H[h.id], a = A.H[h.id], c = CH[h.id] || {};
  L.push(`| ${h.name} | ${h.role} | ${h.clan} | ${h.builds.map((x) => (x === h.rec ? '★' : '') + BUILDS[x].name).join(', ')} | ${wr(b)} | ${wr(a)} | ${a ? ((a.w / a.g - 0.5) * 100).toFixed(0) : '-'} | ${kda(a)} | ${share(a)} | ${a ? (a.bh / a.min).toFixed(1) : '-'} | ${abil(a, h)} | ${(TUNE[h.id] || 1).toFixed(3)} | ${c.changes || ''} | ${c.rework || ''} |`);
}
L.push('', '## Per build', '');
L.push('| Build | Heroes with it | Win before | Win after | Good at | Weak to |', '|---|---|---|---|---|---|');
for (const k of BUILD_ORDER) {
  const on = HEROES.filter((h) => h.builds.includes(k)).length, rec = HEROES.filter((h) => h.rec === k).length;
  L.push(`| ${BUILDS[k].name} | ${on} (${rec} rec) | ${wr(B.B[k])} | ${wr(A.B[k])} | ${BUILDS[k].goodAt} | ${BUILDS[k].weakTo} |`);
}
L.push('', '### Hero + build (after)', '');
L.push('Win rate per hero per build in the after scan (small samples; used to spot builds that are traps on a hero).', '');
L.push('| Hero | ' + 'Builds |', '|---|---|');
for (const h of HEROES) L.push(`| ${h.name} | ${h.builds.map((x) => `${BUILDS[x].name} ${wr(A.HB[h.id + ':' + x])}`).join(' · ')} |`);
L.push('', '## Team comps (after)', '');
L.push('| Comp | Games active | Win |', '|---|---|---|');
for (const [k, c] of Object.entries(A.C)) L.push(`| ${k} | ${c.g} | ${(100 * c.w / c.g).toFixed(0)}% |`);
console.log(L.join('\n'));
