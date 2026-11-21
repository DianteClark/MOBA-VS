// Dead-code finder (a guide, not an oracle: dynamic names like `'tier-' + id` are reported as candidates).
//   node tools/deadcode.mjs            unused exports, CSS classes/ids never mentioned in code, unreferenced assets
//   node tools/deadcode.mjs exports    only one section (exports | css | assets)
// An export is "unused" when no other file mentions its name; "dead" when its own file doesn't use it either.
// A CSS class/id is "unused" when its name never appears in any JS/HTML file (as a whole word or a prefix of a
// string that is concatenated, e.g. 'tier-' for .tier-gold).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, extname, basename } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SKIP = new Set(['node_modules', '.git', '.wrangler', 'tools']);
const walk = (d, out = []) => {
  for (const n of readdirSync(d)) {
    if (SKIP.has(n)) continue;
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
};
const files = walk(ROOT);
const rel = (p) => relative(ROOT, p);
const text = (p) => readFileSync(p, 'utf8');
const js = files.filter((p) => extname(p) === '.js' || extname(p) === '.mjs');
const html = files.filter((p) => extname(p) === '.html');
const css = files.filter((p) => extname(p) === '.css');
// tools may use src exports (determinism etc.): count them as users
const tools = readdirSync(join(ROOT, 'tools')).filter((n) => /\.(mjs|js|py)$/.test(n)).map((n) => join(ROOT, 'tools', n));
const src = new Map([...js, ...html, ...css, ...tools, join(ROOT, 'sw.js'), join(ROOT, 'manifest.webmanifest')].map((p) => [p, text(p)]));
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
const want = process.argv[2];
const esc = (s) => s.replace(/[$]/g, '\\$');
const countWord = (s, w) => (s.match(new RegExp(`(?<![\\w$])${esc(w)}(?![\\w$])`, 'g')) || []).length;

if (!want || want === 'exports') {
  console.log('== exports never imported or used by another file ==');
  for (const f of js) {
    if (f.includes('/worker/')) continue;
    const body = strip(src.get(f)), names = new Set();
    for (const m of body.matchAll(/export\s+(?:async\s+)?(?:function\*?|const|let|var|class)\s+([\w$]+)/g)) names.add(m[1]);
    for (const m of body.matchAll(/export\s*\{([^}]*)\}(?!\s*from)/g)) for (const part of m[1].split(',')) { const n = part.trim().split(/\s+as\s+/).pop(); if (n) names.add(n); }
    for (const n of names) {
      let other = 0;
      for (const [p, s] of src) if (p !== f) other += countWord(s, n);
      if (other) continue;
      const own = countWord(body, n) - 1;
      console.log(`${own > 0 ? 'unused ' : 'DEAD   '} ${rel(f)}: ${n}${own > 0 ? ` (used ${own}x in its own file: drop the export)` : ''}`);
    }
  }
}

if (!want || want === 'css') {
  console.log('\n== CSS classes / ids never mentioned in JS or HTML ==');
  const code = [...js, ...html].map((p) => strip(src.get(p))).join('\n');
  const words = new Set(code.match(/[\w-]+/g));
  // string prefixes like 'tier-' + x or `rk-${...}`
  const prefixes = [...code.matchAll(/['"`\s.]([a-z][\w-]*-)(?:['"`]\s*\+|\$\{)/g)].map((m) => m[1]);
  for (const f of css) {
    const body = text(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/url\([^)]*\)/g, '');
    const sel = new Set();
    for (const block of body.matchAll(/([^{}]+)\{/g)) {
      if (/^\s*@/.test(block[1]) || /^\s*(from|to|\d+%)/.test(block[1])) continue;
      for (const m of block[1].matchAll(/([.#])(-?[a-zA-Z_][\w-]*)/g)) sel.add(m[1] + m[2]);
    }
    const out = [];
    for (const s of sel) {
      const n = s.slice(1);
      if (words.has(n) || prefixes.some((p) => n.startsWith(p))) continue;
      out.push(s);
    }
    if (out.length) console.log(`${rel(f)} (${out.length}): ${out.sort().join(' ')}`);
  }
}

if (!want || want === 'assets') {
  console.log('\n== asset files whose name never appears in code ==');
  const code = [...js, ...html, ...css, join(ROOT, 'sw.js'), join(ROOT, 'manifest.webmanifest')].map((p) => src.get(p)).join('\n');
  for (const f of files.filter((p) => rel(p).startsWith('assets/') && !p.endsWith('.txt'))) {
    const stem = basename(f).replace(/\.[^.]+$/, '');
    if (code.includes(stem)) continue;
    // numbered / templated names (e.g. faces/kaze.png from `faces/${id}.png`) are reported in their folder
    console.log(`  ${rel(f)}`);
  }
}
