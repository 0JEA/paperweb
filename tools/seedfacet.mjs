import { chromium } from 'playwright-core';
import { serve } from './serve.mjs';
const { server, url } = await serve(0);
const b = await chromium.launch({ headless: true, args: ['--use-gl=angle','--use-angle=vulkan','--enable-features=Vulkan'] });
const p = await b.newPage({ viewport: { width: 1300, height: 500 } });
p.on('pageerror', e => console.log('PAGEERROR', e.message));
await p.goto(`${url}/test/browser/fixture.html`);
await p.waitForFunction('window.ready === true');
for (const seed of [0, 1, 3, 9]) {
  await p.evaluate(async ([seed]) => {
    document.body.innerHTML = '';
    document.body.style.cssText = 'margin:0;background:#17161a';
    const el = document.createElement('div');
    el.id='h'; el.style.cssText='width:1180px;height:340px;position:relative;margin:12px';
    document.body.appendChild(el);
    const pp = new window.PW.Paper(el, { preset:'reading', lazy:false, seed,
      params:{ page:{ legacy: 2 }, edge:{enabled:false}, shadow:{enabled:false} } });
    await pp.render();
  }, [seed]);
  await p.waitForTimeout(2000);
  await (await p.$('#h')).screenshot({ path: `/home/john/screenshots/2026-08-08-paperweb/facet-seed${seed}.png` });
  console.log('  seed', seed);
}
await b.close(); server.close();
