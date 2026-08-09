// Before/after on the REAL surfaces: full presets, everything on, at demo size.
import { chromium } from 'playwright-core';
import { serve } from './serve.mjs';
const tag = process.argv[2];
const { server, url } = await serve(0);
const b = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader'] });
const p = await b.newPage({ viewport: { width: 1260, height: 900 }, deviceScaleFactor: 1 });
p.on('pageerror', e => console.log('PAGEERROR', e.message));
await p.goto(`${url}/test/browser/fixture.html`);
await p.waitForFunction('window.ready === true');
// The four presets that enable folds: these are the ones that showed the creases.
const PRESETS = ['Interesting', 'pronounced', 'surface', 'worn'];
await p.evaluate(async ([presets]) => {
  document.body.innerHTML = '';
  document.body.style.cssText = 'margin:0;background:#17161a;padding:26px;display:grid;grid-template-columns:repeat(4,1fr);gap:30px 26px';
  let i = 0;
  for (const name of presets) {
    for (const dup of [0, 1]) {          // two of each, to show cross-card repetition
      const el = document.createElement('div');
      el.style.cssText = 'height:200px;position:relative';
      document.body.appendChild(el);
      const pp = new window.PW.Paper(el, { preset: name, lazy: false });
      await pp.render();
      i++;
    }
  }
}, [PRESETS]);
await p.waitForTimeout(3500);
await p.screenshot({ path: `demo/ba/${tag}.png`, clip: { x: 0, y: 0, width: 1260, height: 520 } });
console.log('  wrote', tag);
await b.close(); server.close();
