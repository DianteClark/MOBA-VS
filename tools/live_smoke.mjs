// Live smoke test (used by .github/workflows/smoke.yml): opens the deployed game in WebKit (iPhone) and
// Chromium, twice each (the second load goes through the service worker), and prints boot state + errors.
import { webkit, chromium, devices } from 'playwright';
const URL = process.env.SMOKE_URL || 'https://moba-vs.chesscomplex.workers.dev/';
let failed = false;
for (const [name, type, dev] of [['webkit-iphone', webkit, devices['iPhone 15 Pro landscape']], ['chromium', chromium, { viewport: { width: 858, height: 396 } }]]) {
  const b = await type.launch();
  const ctx = await b.newContext({ ...dev });
  const pg = await ctx.newPage();
  const errs = [];
  pg.on('pageerror', (e) => errs.push('PAGEERR ' + (e.stack || e.message)));
  pg.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type().toUpperCase() + ' ' + m.text()); });
  pg.on('requestfailed', (r) => errs.push('REQFAIL ' + r.url() + ' ' + (r.failure() && r.failure().errorText)));
  pg.on('response', async (r) => { if (r.status() >= 400) { let t = ''; try { t = (await r.text()).slice(0, 300); } catch { /* none */ } errs.push('HTTP ' + r.status() + ' ' + r.request().method() + ' ' + r.url() + ' ' + t); } });
  for (let i = 0; i < 2; i++) {
    try { await pg.goto(URL, { timeout: 45000 }); } catch (e) { errs.push('GOTO ' + e.message); }
    await pg.waitForTimeout(15000);
    const st = await pg.evaluate(() => ({ app: typeof window.app, booted: !!window.__mobavsBooted, loading: !!document.getElementById('loading'), tip: (document.getElementById('ldtip') || {}).textContent, ver: (document.body.innerText.match(/v\d+\.\d+/) || [''])[0] })).catch((e) => ({ evalError: e.message }));
    console.log(`[${name}] load ${i}:`, JSON.stringify(st));
    if (!st.booted) failed = true;
    await pg.screenshot({ path: `smoke-${name}-${i}.png` });
  }
  if (!failed) {
    const dojo = await pg.evaluate(async () => { try { const m = await import('./src/ui/dojo.js'); m.showDojo(window.app, { tab: 'heroes', hero: 'kaze' }); await new Promise((r) => setTimeout(r, 2000)); return document.querySelector('#screen').innerText.slice(0, 200); } catch (e) { return 'DOJO ERROR ' + (e.stack || e.message); } });
    console.log(`[${name}] dojo:`, JSON.stringify(dojo));
    await pg.screenshot({ path: `smoke-${name}-dojo.png` });
  }
  console.log(`[${name}] errors:\n  ` + [...new Set(errs)].slice(0, 40).join('\n  '));
  await b.close();
}
process.exit(failed ? 1 : 0);
