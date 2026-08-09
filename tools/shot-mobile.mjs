import { chromium } from 'playwright-core';
import { serve } from './serve.mjs';
const { server, url } = await serve(0);
const b = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader'] });
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const errs=[]; p.on('pageerror',e=>errs.push(e.message)); p.on('console',m=>{if(m.type()==='error')errs.push(m.text());});
await p.goto(`${url}/demo/`, { waitUntil: 'networkidle' });
await p.waitForTimeout(7000);
const dir='/home/john/screenshots/2026-08-08-paperweb';
await p.screenshot({ path: `${dir}/mobile-top.png` });
// The page must not actually scroll sideways. scrollWidth still reports the
// unclipped content extent even when overflow-x: clip is in effect, so the only
// honest test is to try to scroll and see whether it moved.
const overflow = await p.evaluate(() => {
  const el = document.scrollingElement || document.documentElement;
  const before = el.scrollLeft;
  el.scrollLeft = 9999;
  const after = el.scrollLeft;
  el.scrollLeft = before;
  return {
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
    scrolledTo: after,
  };
});
console.log('viewport 390@2x  content extent:', overflow.scrollW, 'vs viewport', overflow.clientW);
console.log('viewport 390@2x  actually scrolls sideways:',
  overflow.scrolledTo > 0 ? `YES (${overflow.scrolledTo}px) -- FAIL` : 'no -- OK');
console.log('status:', await p.textContent('#picknote'));
console.log('errors:', errs.length ? errs.join('\n') : 'none');
await b.close(); server.close();
