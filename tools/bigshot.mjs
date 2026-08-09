import { chromium } from 'playwright-core';
import { serve } from './serve.mjs';
const tag = process.argv[2] || 'x';
const { server, url } = await serve(0);
const b = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader'] });
const p = await b.newPage({ viewport: { width: 1000, height: 700 } });
p.on('pageerror', e => console.log('PAGEERROR', e.message));
await p.goto(`${url}/test/browser/fixture.html`);
await p.waitForFunction('window.ready === true');
await p.evaluate(async () => {
  document.body.innerHTML = '';
  document.body.style.cssText = 'margin:0;background:#17161a';
  const el = document.createElement('div');
  el.id = 'big';
  el.style.cssText = 'width:944px;height:378px;position:relative;margin:20px';
  document.body.appendChild(el);
  // Formation only, amplitude pushed up so the field itself is legible.
  // 944 x 378 is exactly two horizontal tiles and two vertical tiles of the
  // 472 x 189 px repeat the periodic hash produced.
  const pp = new window.PW.Paper(el, {
    lazy: false, seed: 0,
    params: {
      cockle:{enabled:false}, folds:{enabled:false}, crumple:{enabled:false},
      fade:{enabled:false}, scratches:{enabled:false}, imperfect:{enabled:false},
      cavity:{enabled:false}, edge:{enabled:false}, shadow:{enabled:false},
      formation:{enabled:true, amplitude:0.16, scale_mm:2.5, source:0},
    },
  });
  await pp.render();
});
await p.waitForTimeout(2500);
await (await p.$('#big')).screenshot({ path: `/home/john/screenshots/2026-08-08-paperweb/tile-${tag}.png` });
console.log('wrote tile-' + tag + '.png');
await b.close(); server.close();
