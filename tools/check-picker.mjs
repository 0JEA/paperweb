import { chromium } from 'playwright-core';
const url = process.env.URL || 'http://127.0.0.1:8231';
const b = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader'] });
const p = await b.newPage({ viewport: { width: 1400, height: 1000 } });
const errs=[]; p.on('pageerror',e=>errs.push(e.message)); p.on('console',m=>{if(m.type()==='error')errs.push(m.text());});
await p.goto(`${url}/demo/`, { waitUntil: 'networkidle' });
await p.waitForTimeout(6000);
const info = await p.evaluate(() => ({
  wraps: document.querySelectorAll('.pickwrap').length,
  checkboxes: document.querySelectorAll('.pick input[type=checkbox]').length,
  surfaces: document.querySelectorAll('[data-paperweb-canvas]').length,
  count: document.getElementById('pickcount')?.textContent,
  note: document.getElementById('picknote')?.textContent,
  // every wrapped element must still actually have a rendered canvas inside it
  wrapsWithCanvas: [...document.querySelectorAll('.pickwrap')].filter(w => w.querySelector('[data-paperweb-canvas]')).length,
  labels: [...document.querySelectorAll('.pick-name')].slice(0,4).map(n=>n.textContent),
}));
console.log(JSON.stringify(info, null, 1));
// Exercise the flow: discard two, submit. The input itself is visually hidden
// (the standard accessible pattern), so click the label the way a user does.
await p.locator('.pick').nth(1).click();
await p.locator('.pick').nth(5).click();
const states = await p.evaluate(() => [1, 5].map(i =>
  document.querySelectorAll('.pick input')[i].checked));
console.log('toggled off:', JSON.stringify(states), states.every(v => v === false) ? 'OK' : 'FAIL');
const dimmed = await p.evaluate(() =>
  document.querySelectorAll('.pickwrap')[1].classList.contains('discarded'));
console.log('discarded card is visually marked:', dimmed ? 'OK' : 'FAIL');
await p.click('#picksubmit');
await p.waitForTimeout(800);
console.log('after submit:', await p.textContent('#picknote'));
console.log('count:', await p.textContent('#pickcount'));
await p.screenshot({ path: '/home/john/screenshots/2026-08-08-paperweb/picker.png', clip: { x: 0, y: 180, width: 1400, height: 820 } });
await p.screenshot({ path: '/home/john/screenshots/2026-08-08-paperweb/picker-bar.png', clip: { x: 0, y: 930, width: 1400, height: 70 } });
console.log('errors:', errs.length ? errs.join('\n') : 'none');
await b.close();
