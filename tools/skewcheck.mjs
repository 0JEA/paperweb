import { chromium } from 'playwright-core';
import { serve } from './serve.mjs';
const { server, url } = await serve(0);
const b = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader'] });
const p = await b.newPage({ viewport: { width: 900, height: 700 } });
p.on('pageerror', e => console.log('PAGEERROR', e.message));
await p.goto(`${url}/test/browser/fixture.html`);
await p.waitForFunction('window.ready === true');
const rows = await p.evaluate(async () => {
  const out = [];
  for (const [skew, gsm] of [[0,0.7],[-0.3,0.7],[-1.0,0.7],[-3.0,0.7],[-0.3,0],[-0.3,2.0]]) {
    const el = document.createElement('div');
    el.style.cssText = 'width:800px;height:600px;position:relative';
    document.body.appendChild(el);
    const pp = new window.PW.Paper(el, { retain: true, lazy: false, seed: 0,
      params: { cockle:{enabled:false}, folds:{enabled:false}, crumple:{enabled:false},
        fade:{enabled:false}, scratches:{enabled:false}, imperfect:{enabled:false},
        formation:{enabled:true, amplitude:0.05, scale_mm:2.5, gsm_amount:gsm, skew, source:0} } });
    await pp.render();
    const { data, w, h } = pp.floats('Albedo');
    const st = data.length / (w * h);
    const n = w * h;
    let s = 0; for (let i=0;i<n;i++) s += data[i*st];
    const mu = s/n;
    let m2=0,m3=0; for (let i=0;i<n;i++){const d=data[i*st]-mu; m2+=d*d; m3+=d*d*d;}
    m2/=n; m3/=n;
    out.push({ skew, gsm, measured: +(m3/Math.pow(m2,1.5)).toFixed(4), sd: +(Math.sqrt(m2)*1e3).toFixed(2) });
    pp.destroy(); el.remove();
  }
  return out;
});
console.log('formation.skew  gsm_amount   measured histogram skew   sd(x1e-3)');
for (const r of rows) console.log(`${String(r.skew).padStart(11)}  ${String(r.gsm).padStart(9)}   ${String(r.measured).padStart(20)}   ${r.sd}`);
await b.close(); server.close();
