// Extracts the English source strings of the UI into src/i18n/en.json (the translation catalog).
//
//   node tools/i18n_extract.mjs            rewrite src/i18n/en.json
//   node tools/i18n_extract.mjs --check    exit 1 if the catalog is out of date (CI / before .done)
//   node tools/i18n_extract.mjs --stats    print counts per file
//
// It tokenizes every UI/data/display source file, keeps string literals, template literals (each `${...}`
// becomes {0}, {1}, ...) and simple 'a ' + x + ' b' chains that read like player-facing text, and drops
// ids, CSS classes, selectors, paths, URLs, event/key names and console/Error messages. Runtime text that
// is built in ways the extractor cannot see is added from src/i18n/extra.json (hand-kept list).
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const DIRS = ['src/ui', 'src/data', 'src/franchise', 'src/maps', 'src/render', 'src/net', 'src/sim'];
const FILES = ['src/main.js', 'src/cup.js', 'src/meta.js', 'src/mastery.js', 'src/coop-room.js', 'src/looks.js', 'src/presets.js', 'src/profile.js', 'src/talentprefs.js', 'src/audio-match.js'];
const SKIP = /(^|\/)(admin|adminreplay|broadcast-worker)\.js$|src\/i18n\//; // owner dashboard stays English

function walk(d) {
  const out = [];
  for (const f of readdirSync(join(ROOT, d))) {
    const p = join(d, f);
    if (statSync(join(ROOT, p)).isDirectory()) out.push(...walk(p));
    else if (f.endsWith('.js')) out.push(p);
  }
  return out;
}

// ── tokenizer: strings, templates (with nested ${}), regex literals, comments, punctuation, words ──
function tokenize(src) {
  const toks = []; let i = 0; const n = src.length;
  const prevSig = () => { for (let k = toks.length - 1; k >= 0; k--) return toks[k]; return null; };
  const regexOk = () => {
    const p = prevSig(); if (!p) return true;
    if (p.t === 'str' || p.t === 'tpl' || p.t === 'num' || p.t === 're') return false;
    if (p.t === 'w') return /^(return|typeof|case|do|else|in|of|new|delete|void|throw|yield|await)$/.test(p.v);
    return !/^[)\]}]$/.test(p.v);
  };
  function readTemplate() { // at the opening backtick
    i++; const parts = [''], exprs = [];
    while (i < n) {
      const c = src[i];
      if (c === '\\') { parts[parts.length - 1] += unesc(src.slice(i, i + 2)); i += 2; continue; }
      if (c === '`') { i++; break; }
      if (c === '$' && src[i + 1] === '{') {
        i += 2; let depth = 1; const st = i;
        while (i < n && depth) {
          const d = src[i];
          if (d === '`') { readTemplate(); continue; }
          if (d === '"' || d === "'") { readString(d); continue; }
          if (d === '{') depth++; else if (d === '}') depth--;
          i++;
        }
        exprs.push(src.slice(st, i - 1)); parts.push(''); continue;
      }
      parts[parts.length - 1] += c; i++;
    }
    return { parts, exprs };
  }
  function readString(q) {
    i++; let s = '';
    while (i < n && src[i] !== q) { if (src[i] === '\\') { s += unesc(src.slice(i, i + 2)); i += 2; } else s += src[i++]; }
    i++; return s;
  }
  while (i < n) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i + 2); i = i < 0 ? n : i + 2; continue; }
    if (c === '"' || c === "'") { const pos = i; toks.push({ t: 'str', v: readString(c), pos }); continue; }
    if (c === '`') { const pos = i; const tp = readTemplate(); toks.push({ t: 'tpl', v: tp, pos }); continue; }
    if (c === '/' && regexOk()) {
      i++; let cls = false;
      while (i < n) { const d = src[i]; if (d === '\\') { i += 2; continue; } if (d === '[') cls = true; else if (d === ']') cls = false; else if (d === '/' && !cls) break; else if (d === '\n') break; i++; }
      i++; while (/[a-z]/.test(src[i] || '')) i++; toks.push({ t: 're', v: '' }); continue;
    }
    if (/[A-Za-z_$]/.test(c)) { let s = ''; while (i < n && /[\w$]/.test(src[i])) s += src[i++]; toks.push({ t: 'w', v: s }); continue; }
    if (/[0-9]/.test(c)) { let s = ''; while (i < n && /[\w.]/.test(src[i])) s += src[i++]; toks.push({ t: 'num', v: s }); continue; }
    const three = src.slice(i, i + 3), two = src.slice(i, i + 2);
    if (['===', '!==', '...', '**=', '>>>'].includes(three)) { toks.push({ t: 'p', v: three }); i += 3; continue; }
    if (['=>', '==', '!=', '<=', '>=', '&&', '||', '??', '?.', '++', '--', '+=', '-=', '*=', '/=', '**'].includes(two)) { toks.push({ t: 'p', v: two }); i += 2; continue; }
    toks.push({ t: 'p', v: c }); i++;
  }
  return toks;
}
function unesc(e) { const m = { n: '\n', t: '\t', "'": "'", '"': '"', '\\': '\\', '`': '`', $: '$' }; return m[e[1]] !== undefined ? m[e[1]] : e[1]; }

// ── is this player-facing text? ──
const looksText = (s) => {
  s = s.trim();
  if (s.length < 2 || !/[A-Za-z]{2}/.test(s)) return false;
  if (/^(https?:|data:|mailto:|blob:|wss?:)/.test(s) || /^\.{0,2}\/[\w./-]*$/.test(s) || /\.(png|jpe?g|webp|mp3|ogg|wav|js|css|json|ttf|html)(\?|$)/i.test(s)) return false;
  if (/^[\w$]+$/.test(s) && !/^[A-Z][a-z]+$/.test(s) && !/^[A-Z]{2,}$/.test(s)) return false; // ids, camelCase, snake_case
  if (/^[A-Z][a-z]+[A-Z]\w*$/.test(s)) return false; // PascalCase ids (icons, key names: ArrowUp)
  if (/^[a-z0-9_ .#:>\[\]=*()"'-]+$/.test(s) && (/[#.:>\[\]=*_]|-[a-z]|\d/.test(s) || !/ /.test(s))) return false; // class lists, selectors
  if (/^[.#[]/.test(s) || /^[a-z-]+:\s?[^ ]+;?$/.test(s)) return false; // selectors, css
  if (/^(rgba?|hsla?|var|url|translate|scale|rotate|linear-gradient|cubic-bezier|calc)\(/.test(s) || /^#[0-9a-f]{3,8}$/i.test(s)) return false;
  if (/^\d+(px|ms|s|%|em|rem|vh|vw)?( \d+(px|%)?)*$/.test(s)) return false;
  if (/^(Escape|Enter|Tab|Space|Backspace|Shift|Control|Alt|Meta|Home|End|PageUp|PageDown|Delete|Insert)$/.test(s)) return false;
  if (/^(GET|POST|PUT|DELETE|PATCH|OPTIONS|HEAD|JSON|UTF|OK)$/.test(s)) return false;
  if (/<[a-z][^>]*>/i.test(s)) return false; // html snippets
  if (/^[a-z]+(\.[a-z]+)+$/i.test(s)) return false; // dotted keys
  return true;
};
// Tokens that pass looksText but are never shown: mime types, query strings, sprite keys, bare placeholders.
const junk = (s) => (!/ /.test(s) && /[_/;=&]|^[a-z]+\{\d\}|\{\d\}\{\d\}/.test(s)) || /^[{}\d\s.!?:,]+$/.test(s) || /^[a-z]+\/[a-z0-9.+-]+/.test(s);
// Context words in front of a literal that mean "not text".
const NOT_TEXT_PREV = new Set(['class', 'className', 'id', 'type', 'key', 'role', 'src', 'href', 'for', 'icon', 'fx', 'proj', 'sprite', 'img', 'face', 'sfx', 'bg', 'col', 'color',
  'path', 'url', 'route', 'voice', 'track', 'music', 'anim', 'shape', 'cmd', 'op', 'v', 'version', 'tag', 'clan', 'pers', 'curve', 'dmgType', 'element', 'cls', 'kind', 'slot', 'rarity', 'mood', 'sound']);
// method calls whose string arguments are never text (el.classList.add('x'), map.get('k'), audio.sfx('hit'))
const NOT_TEXT_METHOD = new Set(['querySelector', 'querySelectorAll', 'getElementById', 'getElementsByClassName', 'closest', 'matches', 'add', 'remove', 'toggle', 'contains', 'addEventListener',
  'removeEventListener', 'dispatchEvent', 'getItem', 'setItem', 'removeItem', 'createElement', 'setProperty', 'getPropertyValue', 'getAttribute', 'removeAttribute', 'hasAttribute', 'log', 'warn',
  'error', 'info', 'debug', 'sfx', 'ui', 'play', 'music', 'getContext', 'postMessage', 'startsWith', 'endsWith', 'includes', 'split', 'join', 'indexOf', 'has', 'get', 'set', 'delete', 'emit', 'on',
  'off', 'send', 'cheer', 'stinger', 'buzz', 'haptic', 'track', 'beacon', 'load', 'fonts', 'padStart', 'padEnd', 'match', 'test', 'exec', 'search', 'lastIndexOf', 'getEntriesByType', 'mark', 'measure']);
// plain functions whose string arguments are never text
const NOT_TEXT_FN = new Set(['import', 'fetch', 'Event', 'CustomEvent', 'Error', 'TypeError', 'RangeError', 'icon', 'face', 'matchMedia', 'loadImage', 'item', 'heroSprite', 'require', 'call', 'api', 'post', 'byId', 'haptic', 'track', 'Request', 'URL', 'RegExp', 'mapThumb', 'bossFace', 'tr']);
function extract(file, src) {
  const toks = tokenize(src), out = [];
  const add = (s) => { s = norm(s); if (s && looksText(s) && !junk(s)) out.push(s); };
  const tplKey = (tp) => { let s = tp.parts[0]; for (let k = 0; k < tp.exprs.length; k++) s += `{${k}}` + tp.parts[k + 1]; return s; };
  for (let k = 0; k < toks.length; k++) {
    const tk = toks[k];
    if (tk.t !== 'str' && tk.t !== 'tpl') continue;
    const p1 = toks[k - 1], p2 = toks[k - 2], p3 = toks[k - 3];
    // object keys ('foo': ...), imports, exports
    const nx = toks[k + 1];
    if (nx && nx.v === ':' && p1 && (p1.v === '{' || p1.v === ',')) continue;
    if (p1 && p1.t === 'w' && (p1.v === 'from' || p1.v === 'import')) continue;
    // attr: 'x'  /  .attr = 'x'
    if (p1 && (p1.v === ':' || p1.v === '=') && p2 && p2.t === 'w' && NOT_TEXT_PREV.has(p2.v)) continue;
    if (p1 && (p1.v === ':' || p1.v === '=') && p2 && p2.t === 'str' && NOT_TEXT_PREV.has(p2.v)) continue;
    // comparisons: x === 'id'
    if (p1 && ['===', '!==', '==', '!='].includes(p1.v)) continue;
    if (nx && ['===', '!==', '==', '!='].includes(nx.v)) continue;
    if (p1 && p1.v === 'case') continue;
    // f('selector') / el.classList.add('x') / h('div', ...)
    if (p1 && p1.v === '(' && p2 && p2.t === 'w' && (NOT_TEXT_FN.has(p2.v) || (p3 && (p3.v === '.' || p3.v === '?.') && NOT_TEXT_METHOD.has(p2.v)))) continue;
    if (p1 && p1.v === ',' ) { // second+ args of non-text calls: find the call name
      let d = 0, j = k - 1;
      for (; j >= 0; j--) { const v = toks[j].v; if (v === ')' || v === ']' || v === '}') d++; else if (v === '(' || v === '[' || v === '{') { if (d === 0) break; d--; } }
      if (j > 0 && toks[j].v === '(' && toks[j - 1].t === 'w' && ['setAttribute', 'setProperty', 'addEventListener', 'replace', 'log', 'warn', 'error', 'sfx', 'ui', 'Error'].includes(toks[j - 1].v)) {
        if (!(toks[j - 1].v === 'setAttribute' && toks[j + 1] && /^(title|aria-label|placeholder|alt|aria-description)$/.test(toks[j + 1].v))) continue;
      }
    }
    if (p1 && p1.v === '[' && nx && nx.v === ']' && p2 && (p2.t === 'w' || p2.v === ')')) continue; // obj['key']
    if (p1 && p1.v === 'in' ) continue;
    // throw new Error('...')
    if (p3 && p3.v === 'new' && p2 && /Error$/.test(p2.v)) continue;
    // h('tag', ...): first arg is the tag
    if (p1 && p1.v === '(' && p2 && p2.v === 'h') continue;
    if (tk.t === 'str') add(tk.v);
    else {
      const key = tplKey(tk.v);
      const lit = tk.v.parts.join('');
      if (looksText(lit) || (/[A-Za-z]{3}/.test(lit) && !/^[\w-]*\{\d\}[\w-]*$/.test(key) && !/[;#=<>]|^\.|\/\w|px|\(\{/.test(key) && tk.v.exprs.length)) add(key);
      // literals inside ${...} are scanned as their own files (cheap: recursive extract)
      for (const e of tk.v.exprs) out.push(...extract(file, e));
    }
    // 'a ' + x + ' b' chains: join into one key with placeholders
    if (nx && nx.v === '+' && !(p1 && p1.v === '+')) {
      let key = tk.t === 'str' ? tk.v : tplKey(tk.v), ph = tk.t === 'tpl' ? tk.v.exprs.length : 0, j = k + 1, any = false;
      while (toks[j] && toks[j].v === '+') {
        j++; const o = toks[j]; if (!o) break;
        if (o.t === 'str') { key += o.v; j++; continue; }
        if (o.t === 'tpl') { let s = o.v.parts[0]; for (let q = 0; q < o.v.exprs.length; q++) s += `{${ph++}}` + o.v.parts[q + 1]; key += s; j++; continue; }
        // an expression operand: words, member access, calls, parens
        let d = 0, st = j;
        while (toks[j]) {
          const v = toks[j].v;
          if (d === 0 && (v === '+' || v === ',' || v === ';' || v === ')' || v === ']' || v === '}' || v === '?' || v === ':' || v === '||' || v === '&&' || v === '??' || v === '===' || v === '!==')) break;
          if (v === '(' || v === '[' || v === '{') d++; else if (v === ')' || v === ']' || v === '}') d--;
          j++;
        }
        if (j === st) break;
        key += `{${ph++}}`; any = true;
      }
      if (any) add(key);
    }
  }
  return out;
}
// Normalize: trim, collapse whitespace. Keys keep inner punctuation.
export function norm(s) { return String(s).replace(/\s+/g, ' ').trim(); }

export async function buildCatalog() {
  const files = [...DIRS.flatMap(walk), ...FILES.filter((f) => existsSync(join(ROOT, f)))].filter((f) => !SKIP.test(f)).sort();
  const seen = new Map(); const per = {};
  for (const f of files) {
    const got = extract(f, readFileSync(join(ROOT, f), 'utf8'));
    per[f] = 0;
    for (const s of got) if (!seen.has(s)) { seen.set(s, f); per[f]++; }
  }
  // "Head: rest" (patch notes, tips) is shown as a bold head and its text: catalog the parts (the whole is
  // translated part by part at runtime)
  for (const [k, f] of [...seen]) {
    const m = k.match(/^([A-Z0-9][^:.!?]{1,38}): (.{3,})$/);
    if (!m || /\{\d\}/.test(m[1])) continue;
    seen.delete(k);
    for (const part of [m[1], m[2]]) if (!seen.has(part)) seen.set(part, f);
  }
  // data the UI shows that the source holds as ids/arrays (hero tags)
  const { HEROES } = await import('../src/data/heroes.js');
  for (const hero of HEROES) for (const tg of hero.tags || []) if (!seen.has(tg)) seen.set(tg, 'src/data/heroes.js');
  const extraP = join(ROOT, 'src/i18n/extra.json');
  if (existsSync(extraP)) for (const s of JSON.parse(readFileSync(extraP, 'utf8'))) if (!seen.has(norm(s))) { seen.set(norm(s), 'extra'); per.extra = (per.extra || 0) + 1; }
  return { strings: [...seen.keys()], per, src: seen };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { strings, per } = await buildCatalog();
  const target = join(ROOT, 'src/i18n/en.json');
  const json = JSON.stringify(strings, null, 0).replace(/","/g, '",\n"') + '\n';
  if (process.argv.includes('--stats')) { for (const [f, c] of Object.entries(per)) console.log(String(c).padStart(5), f); }
  if (process.argv.includes('--check')) {
    const cur = existsSync(target) ? readFileSync(target, 'utf8') : '';
    if (cur !== json) { console.log('i18n catalog out of date: run node tools/i18n_extract.mjs'); process.exit(1); }
    console.log(`i18n catalog up to date (${strings.length} strings)`);
  } else { writeFileSync(target, json); console.log(`wrote src/i18n/en.json: ${strings.length} strings, ${strings.join(' ').split(/\s+/).length} words`); }
}
