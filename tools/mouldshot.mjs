import { chromium } from 'playwright-core';
import { serve } from './serve.mjs';
const { server, url } = await serve(0);
const b = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader'] });
const p = await b.newPage({ viewport: { width: 1300, height: 500 } });
p.on('pageerror', e => console.log('PAGEERROR', e.message));
await p.goto(`${url}/test/browser/fixture.html`);
await p.waitForFunction('window.ready === true');
const VARIANTS = [
  ['0-off',      { enabled: false }],
  ['1-subtle',   { enabled: true, amount: 0.010 }],
  ['2-default',  { enabled: true, amount: 0.016 }],
  ['3-strong',   { enabled: true, amount: 0.028 }],
  ['4-laid-only',{ enabled: true, amount: 0.020, chain_ratio: 0.0 }],
  ['5-wove',     { enabled: true, amount: 0.016, laid_pitch_mm: 0.55, chain_pitch_mm: 0.55, chain_ratio: 0.5 }],
];
for (const [tag, mould] of VARIANTS) {
  await p.evaluate(async ([mould]) => {
    document.body.innerHTML = '';
    document.body.style.cssText = 'margin:0;background:#17161a';
    const el = document.createElement('div');
    el.id = 'h';
    el.style.cssText = 'width:1180px;height:340px;position:relative;margin:14px';
    document.body.appendChild(el);
    const pp = new window.PW.Paper(el, { preset: 'reading', seed: 5, lazy: false, params: { mould } });
    await pp.render();
  }, [mould]);
  await p.waitForTimeout(2200);
  await (await p.$('#h')).screenshot({ path: `demo/mould/${tag}.png` });
  console.log('  ', tag);
}
await b.close(); server.close();
