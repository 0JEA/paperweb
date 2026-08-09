import { chromium } from 'playwright-core';
import { serve } from '/home/john/paperweb/tools/serve.mjs';
const { server, url } = await serve(0);
const b = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader'] });
const p = await b.newPage({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 1 });
const errs=[]; p.on('pageerror',e=>errs.push(e.message)); p.on('console',m=>{if(m.type()==='error')errs.push(m.text());});
await p.goto(`${url}/demo/`, { waitUntil: 'networkidle' });
await p.waitForTimeout(6000);
const dir='/home/john/screenshots/2026-08-08-paperweb';
await p.screenshot({ path: `${dir}/demo-full.png`, fullPage: true });
for (const [name, sel] of [['presets','#presetGrid'],['hero','.hero'],['isolation','#isolationGrid'],['ink','#rasterDemo']]) {
  const el = await p.$(sel); if (el) await el.screenshot({ path: `${dir}/${name}.png` });
}
console.log('status:', await p.textContent('#picknote'));
console.log('note:', await p.textContent('#rasterNote'));
console.log('errors:', errs.length ? errs.join('\n') : 'none');
await b.close(); server.close();
