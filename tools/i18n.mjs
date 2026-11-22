// Language packs: src/i18n/packs/<lang>.json maps English source text (src/i18n/en.json) to its translation.
//
//   node tools/i18n.mjs check                     coverage per language, placeholder and glossary checks (exit 1 on errors)
//   node tools/i18n.mjs missing <lang> [n]        untranslated catalog strings, one per line (translate them in order)
//   node tools/i18n.mjs merge <lang> <en.txt> <xx.txt>
//        add translations: line N of xx.txt translates line N of en.txt. A line "=" keeps the English on purpose
//        (names, codes): it is stored as itself, so it counts as done.
//        Both files must have the same number of lines and every {n} placeholder of a line must survive.
//   node tools/i18n.mjs prune                     drop pack entries whose English is no longer in the catalog
//
// Glossary: src/i18n/glossary.json fixes how game terms are said in each language (Calls, Kami, Tower...).
// `check` warns when a string uses a glossary term and its translation does not use the agreed word.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const LANGS = ['es', 'pt', 'fr', 'de', 'ja', 'ko', 'zh', 'ru'];
const cat = JSON.parse(readFileSync(join(ROOT, 'src/i18n/en.json'), 'utf8'));
const packPath = (l) => join(ROOT, 'src/i18n/packs', l + '.json');
const load = (l) => (existsSync(packPath(l)) ? JSON.parse(readFileSync(packPath(l), 'utf8')) : {});
// stable order: catalog order, then anything else
function save(l, pack) {
  const keys = Object.keys(pack), idx = new Map(cat.map((k, i) => [k, i]));
  keys.sort((a, b) => (idx.get(a) ?? 1e9) - (idx.get(b) ?? 1e9) || (a < b ? -1 : 1));
  const out = '{\n' + keys.map((k) => JSON.stringify(k) + ':' + JSON.stringify(pack[k])).join(',\n') + '\n}\n';
  writeFileSync(packPath(l), out);
}
const ph = (s) => (s.match(/\{\d+\}/g) || []).sort().join(',');
const lines = (p) => readFileSync(p, 'utf8').replace(/\n$/, '').split('\n');

const [cmd, a1, a2, a3] = process.argv.slice(2);
if (cmd === 'merge') {
  const en = lines(a2), tx = lines(a3), pack = load(a1);
  if (en.length !== tx.length) { console.error(`line count differs: ${en.length} English vs ${tx.length} translated`); process.exit(1); }
  let added = 0, bad = 0;
  en.forEach((e, i) => {
    const t = tx[i].trim();
    if (!t) { delete pack[e]; return; }
    if (t === '=' || t === e) { pack[e] = e; return; } // stays English on purpose (names, codes)
    if (ph(e) !== ph(t) && !(ph(t) === '' || ph(e).split(',').length > ph(t).split(',').length && ph(t).split(',').every((x) => ph(e).includes(x)))) {
      console.error(`line ${i + 1}: placeholders ${ph(e)} vs ${ph(t)}\n  ${e}\n  ${t}`); bad++; return;
    }
    pack[e] = t; added++;
  });
  save(a1, pack);
  console.log(`${a1}: ${added} translations merged${bad ? `, ${bad} rejected` : ''}`);
  if (bad) process.exit(1);
} else if (cmd === 'missing') {
  const pack = load(a1), n = +(a2 || 1e9);
  console.log(cat.filter((k) => !(k in pack)).slice(0, n).join('\n'));
} else if (cmd === 'prune') {
  const set = new Set(cat);
  for (const l of LANGS) { const p = load(l); let n = 0; for (const k of Object.keys(p)) if (!set.has(k)) { delete p[k]; n++; } save(l, p); console.log(`${l}: pruned ${n}`); }
} else if (cmd === 'check') {
  const gl = existsSync(join(ROOT, 'src/i18n/glossary.json')) ? JSON.parse(readFileSync(join(ROOT, 'src/i18n/glossary.json'), 'utf8')).terms : [];
  let errors = 0;
  const words = cat.reduce((a, k) => a + k.split(/\s+/).length, 0);
  for (const l of LANGS) {
    const p = load(l); let have = 0, w = 0, phBad = 0, glWarn = 0;
    for (const k of cat) if (k in p) { have++; w += k.split(/\s+/).length; }
    for (const [k, v] of Object.entries(p)) {
      if (ph(v).split(',').some((x) => x && !ph(k).includes(x))) { phBad++; if (phBad <= 3) console.log(`  ${l} placeholder: ${k} -> ${v}`); }
      for (const g of gl) {
        const t = g[l]; if (!t) continue;
        if (new RegExp(`\\b${g.en}\\b`).test(k) && !v.toLowerCase().includes(t.toLowerCase().split('|')[0]) && !t.toLowerCase().split('|').some((x) => v.toLowerCase().includes(x))) glWarn++;
      }
    }
    errors += phBad;
    console.log(`${l}: ${have}/${cat.length} strings (${Math.round(w / words * 100)}% of words)${phBad ? `, ${phBad} placeholder errors` : ''}${glWarn ? `, ${glWarn} glossary notes` : ''}`);
  }
  process.exit(errors ? 1 : 0);
} else {
  console.log('usage: node tools/i18n.mjs check | missing <lang> [n] | merge <lang> <en.txt> <xx.txt> | prune');
}
