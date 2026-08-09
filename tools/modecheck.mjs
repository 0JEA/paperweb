import { chromium } from 'playwright-core';
import { serve } from './serve.mjs';
const { server, url } = await serve(0);
const b = await chromium.launch({ headless: true, args: ['--use-gl=angle','--use-angle=vulkan','--enable-features=Vulkan'] });
const p = await b.newPage({ viewport: { width: 900, height: 600 } });
p.on('pageerror', e => console.log('PAGEERROR', e.message));
await p.goto(`${url}/test/browser/fixture.html`);
await p.waitForFunction('window.ready === true');
const out = await p.evaluate(async () => {
  const sig = async (legacy) => {
    const el = document.createElement('div');
    el.style.cssText = 'width:600px;height:300px;position:relative';
    document.body.appendChild(el);
    const pp = new window.PW.Paper(el, { preset: 'reading', retain: true, lazy: false, seed: 0,
      params: { page: { legacy } } });
    await pp.render();
    const { data, w, h } = pp.floats('Height');
    const st = data.length / (w * h);
    let mn = Infinity, mx = -Infinity, s = 0, ss = 0;
    const vals = [];
    for (let i = 0; i < w * h; i++) { const v = data[i * st];
      if (v < mn) mn = v; if (v > mx) mx = v; s += v; ss += v * v; if (i % 977 === 0) vals.push(+v.toFixed(3)); }
    const n = w * h, mu = s / n;
    pp.destroy(); el.remove();
    return { sd: +(Math.sqrt(ss / n - mu * mu)).toFixed(4), mn: +mn.toFixed(3), mx: +mx.toFixed(3),
             head: vals.slice(0, 6).join(',') };
  };
  return { m0: await sig(0), m1: await sig(1), m2: await sig(2) };
});
for (const [k, v] of Object.entries(out)) console.log(' ', k, JSON.stringify(v));
console.log('  mode1 differs from mode0:', out.m0.head !== out.m1.head ? 'YES' : 'NO - uniform not reaching');
console.log('  mode2 matches mode1     :', out.m2.head === out.m1.head ? 'YES' : 'NO');
await b.close(); server.close();
