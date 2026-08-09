import { chromium } from 'playwright-core';
import { serve } from './serve.mjs';
const tag = process.argv[2], irr = Number(process.argv[3] ?? 0.85);
const { server, url } = await serve(0);
const b = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader'] });
const p = await b.newPage({ viewport: { width: 800, height: 700 } });
p.on('pageerror', e => console.log('PAGEERROR', e.message));
await p.goto(`${url}/test/browser/fixture.html`);
await p.waitForFunction('window.ready === true');
await p.evaluate(async ([irr]) => {
  document.body.innerHTML = '';
  document.body.style.cssText = 'margin:0;background:#17161a';
  const el = document.createElement('div');
  el.id = 'c';
  el.style.cssText = 'width:600px;height:420px;position:relative;margin:16px';
  document.body.appendChild(el);
  const pp = new window.PW.Paper(el, { lazy: false, seed: 2, params: {
    cockle:{enabled:false}, folds:{enabled:false},
    formation:{enabled:false}, fade:{enabled:false},
    scratches:{enabled:false}, imperfect:{enabled:false},
    edge:{enabled:false}, shadow:{enabled:false},
    cavity:{enabled:true, lambda:0.9},
    crumple:{enabled:true, scale_mm:13, amplitude_um:34, crease:0.2, irregularity:irr, seed:1} } });
  await pp.render();
}, [irr]);
await p.waitForTimeout(2500);
await (await p.$('#c')).screenshot({ path: `demo/crumple/${tag}.png` });
console.log('  ', tag);
await b.close(); server.close();
