// One image: the old behaviour on top, the current behaviour below.
import { chromium } from 'playwright-core';
import { serve } from './serve.mjs';
const { server, url } = await serve(0);
const b = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader'] });
const p = await b.newPage({ viewport: { width: 1180, height: 760 }, deviceScaleFactor: 1 });
p.on('pageerror', e => console.log('PAGEERROR', e.message));
await p.goto(`${url}/test/browser/fixture.html`);
await p.waitForFunction('window.ready === true');
await p.evaluate(async () => {
  document.body.innerHTML = '';
  document.body.style.cssText = 'margin:0;background:#17161a;padding:22px 26px;font:600 12px/1.4 ui-monospace,Menlo,monospace;color:#8d8880;letter-spacing:.1em';
  const row = (title, seeds) => {
    const hd = document.createElement('div');
    hd.textContent = title;
    hd.style.cssText = 'text-transform:uppercase;margin:0 0 14px;padding-bottom:8px;border-bottom:1px solid #34323a';
    document.body.appendChild(hd);
    const g = document.createElement('div');
    g.style.cssText = 'display:grid;grid-template-columns:repeat(4,1fr);gap:30px;margin-bottom:34px';
    document.body.appendChild(g);
    return seeds.map(s => { const d = document.createElement('div');
      d.style.cssText = 'height:190px;position:relative'; g.appendChild(d); return [d, s]; });
  };
  const before = row('before  ·  every surface the same sheet (seed fixed, as paperlab ships it)', [0,0,0,0]);
  const after  = row('after   ·  every surface its own sheet', [11,12,13,14]);
  for (const [el, seed] of [...before, ...after]) {
    const pp = new window.PW.Paper(el, { preset: 'surface', lazy: false, seed });
    await pp.render();
  }
});
await p.waitForTimeout(3000);
await p.screenshot({ path: '/home/john/screenshots/2026-08-08-paperweb/compare-seeds.png' });
console.log('wrote compare-seeds.png');
await b.close(); server.close();
