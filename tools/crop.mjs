// Capture 1:1 slices of a showcase page on the real GPU.
import { chromium } from 'playwright-core';
import { serve } from './serve.mjs';
import { SHOTS } from './shots.mjs';
import { join } from 'node:path';
const [target, ...ys] = process.argv.slice(2);
const { server, url } = await serve(0);
const b = await chromium.launch({ headless: true, args: ['--use-gl=angle','--use-angle=vulkan','--enable-features=Vulkan'] });
const p = await b.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
p.on('pageerror', e => console.log('PAGEERROR', e.message));
await p.goto(`${url}/${target}`, { waitUntil: 'networkidle' });
await p.evaluate(async () => { const h=document.body.scrollHeight;
  for(let y=0;y<h;y+=500){window.scrollTo(0,y);await new Promise(r=>setTimeout(r,110));} window.scrollTo(0,0); });
await p.waitForTimeout(7000);
const name = target.split('/').pop().replace('.html','');
// A clip beyond the current viewport needs the page scrolled there first;
// fullPage clipping is relative to the rendered image, not the document.
for (const y of ys) {
  await p.evaluate((yy) => window.scrollTo(0, yy), Number(y));
  await p.waitForTimeout(700);
  await p.screenshot({ path: join(SHOTS, `${name}-y${y}.png`) });
  console.log('  slice y=' + y);
}
await b.close(); server.close();
