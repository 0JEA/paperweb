// Render one comparison panel to demo/compare/<name>.png
import { chromium } from 'playwright-core';
import { serve } from './serve.mjs';
const [name, json] = process.argv.slice(2);
const spec = JSON.parse(json);
const { server, url } = await serve(0);
const b = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader'] });
const p = await b.newPage({ viewport: { width: 700, height: 560 } });
p.on('pageerror', e => console.log('PAGEERROR', e.message));
await p.goto(`${url}/test/browser/fixture.html`);
await p.waitForFunction('window.ready === true');
await p.evaluate(async ([spec]) => {
  document.body.innerHTML = '';
  document.body.style.cssText = 'margin:0;background:#17161a';
  const el = document.createElement('div');
  el.id = 'panel';
  el.style.cssText = 'width:520px;height:360px;position:relative;margin:20px';
  document.body.appendChild(el);
  const pp = new window.PW.Paper(el, { lazy: false, seed: spec.seed, params: spec.params });
  await pp.render();
}, [spec]);
await p.waitForTimeout(2500);
await (await p.$('#panel')).screenshot({ path: `demo/compare/${name}.png` });
console.log('  panel', name);
await b.close(); server.close();
