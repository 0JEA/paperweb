import { chromium } from 'playwright-core';
const port = process.argv[2], tag = process.argv[3], gpu = process.argv[4] !== 'sw';
const args = gpu
  ? ['--use-gl=angle','--use-angle=vulkan','--enable-features=Vulkan']
  : ['--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader'];
const b = await chromium.launch({ headless: true, args });
const p = await b.newPage({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 1 });
p.on('pageerror', e => console.log('PAGEERROR', e.message));
await p.goto(`http://127.0.0.1:${port}/demo/`, { waitUntil: 'networkidle' });
const renderer = await p.evaluate(() => {
  const g = document.createElement('canvas').getContext('webgl2');
  const d = g.getExtension('WEBGL_debug_renderer_info');
  return d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : '?';
});
await p.evaluate(async () => { for (let y=0;y<3000;y+=350){window.scrollTo(0,y);await new Promise(r=>setTimeout(r,90));} });
await p.waitForTimeout(6000);
const el = await p.$('.hero');
await el.scrollIntoViewIfNeeded(); await p.waitForTimeout(900);
await el.screenshot({ path: `/home/john/screenshots/2026-08-08-paperweb/gpu-hero-${tag}.png` });
console.log(`gpu-hero-${tag}.png  <-  ${renderer.slice(0,64)}`);
await b.close();
