import { chromium } from 'playwright-core';
import { serve } from './serve.mjs';
const tag = process.argv[2] || 'x';
const { server, url } = await serve(0);
const b = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader'] });
const p = await b.newPage({ viewport: { width: 1100, height: 780 } });
p.on('pageerror', e => console.log('PAGEERROR', e.message));
await p.goto(`${url}/test/browser/fixture.html`);
await p.waitForFunction('window.ready === true');
await p.evaluate(async ([tag]) => {
  document.body.innerHTML = '';
  document.body.style.cssText = 'margin:0;background:#17161a;padding:20px;font:600 11px/1.4 ui-monospace,Menlo,monospace;color:#8d8880;letter-spacing:.1em';
  const label = (t) => { const d=document.createElement('div');
    d.textContent = t; d.style.cssText='text-transform:uppercase;margin:0 0 10px'; document.body.appendChild(d); };
  const sheet = (w,h,opts,mb) => { const d=document.createElement('div');
    d.style.cssText=`width:${w}px;height:${h}px;position:relative;margin-bottom:${mb}px`;
    document.body.appendChild(d); return [d,opts]; };
  label(tag.toUpperCase() + '  ·  formation field alone, amplitude 0.10 (the grain, magnified)');
  const a = sheet(1040, 250, { seed: 0, lazy:false, params: {
    cockle:{enabled:false}, folds:{enabled:false}, crumple:{enabled:false},
    fade:{enabled:false}, scratches:{enabled:false}, imperfect:{enabled:false},
    cavity:{enabled:false}, edge:{enabled:false}, shadow:{enabled:false},
    formation:{enabled:true, amplitude:0.10, scale_mm:2.5, skew:-0.3, source:0} } }, 26);
  label('preset "paper" at its shipped defaults');
  const c = sheet(1040, 320, { preset:'paper', seed: 4, lazy:false }, 10);
  for (const [el, opts] of [a, c]) { const pp = new window.PW.Paper(el, opts); await pp.render(); }
}, [tag]);
await p.waitForTimeout(3000);
await p.screenshot({ path: `/home/john/screenshots/2026-08-08-paperweb/skew-${tag}.png`, clip:{x:0,y:0,width:1100,height:700} });
console.log('wrote skew-' + tag + '.png');
await b.close(); server.close();
