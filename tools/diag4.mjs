import { chromium } from 'playwright-core';
import { serve } from './serve.mjs';
const { server, url } = await serve(0);
const b = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader'] });
const p = await b.newPage({ viewport: { width: 1200, height: 900 } });
p.on('pageerror', e => console.log('PAGEERROR', e.message));
await p.goto(`${url}/test/browser/fixture.html`);
await p.waitForFunction('window.ready === true');
// Six 'surface' sheets side by side: previously all six were pixel-identical.
await p.evaluate(async () => {
  document.body.innerHTML = '';
  document.body.style.cssText = 'margin:0;background:#202024;display:grid;grid-template-columns:repeat(3,1fr);gap:34px;padding:34px';
  for (let i = 0; i < 6; i++) {
    const el = document.createElement('div');
    el.style.cssText = 'height:210px;position:relative';
    document.body.appendChild(el);
    const pp = new window.PW.Paper(el, { preset: 'surface', lazy: false });
    await pp.render();
  }
});
await p.waitForTimeout(2500);
await p.screenshot({ path: '/home/john/screenshots/2026-08-08-paperweb/seed-after.png' });
console.log('rendered six "surface" sheets');
await b.close(); server.close();
