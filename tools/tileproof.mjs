// Direct proof: compare the rendered sheet against itself shifted by exactly one
// predicted tile (472 x 189 canvas px). If the hash is periodic the two regions
// are the same pixels.
import { chromium } from 'playwright-core';
import { serve } from './serve.mjs';
const tag = process.argv[2] || 'x';
const { server, url } = await serve(0);
const b = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader'] });
const p = await b.newPage({ viewport: { width: 1000, height: 700 } });
p.on('pageerror', e => console.log('PAGEERROR', e.message));
await p.goto(`${url}/test/browser/fixture.html`);
await p.waitForFunction('window.ready === true');
const r = await p.evaluate(async () => {
  const el = document.createElement('div');
  el.style.cssText = 'width:1200px;height:600px;position:relative';
  document.body.appendChild(el);
  const pp = new window.PW.Paper(el, {
    retain: true, lazy: false, seed: 0,
    params: { cockle:{enabled:false}, folds:{enabled:false}, crumple:{enabled:false},
      fade:{enabled:false}, scratches:{enabled:false}, imperfect:{enabled:false},
      formation:{enabled:true, amplitude:0.05, scale_mm:2.5, source:0} },
  });
  await pp.render();
  const { data, w, h } = pp.floats('Albedo');   // half-res buffer
  const stride = data.length / (w * h);
  const at = (x, y) => data[(y * w + x) * stride];
  // predicted period in HALF-RES px: 50 cells and 20 cells at 2.5mm, 1.88976 px/mm
  const PX = Math.round(50 * 2.5 * (96 / 25.4) / 2);   // 236
  const PY = Math.round(20 * 2.5 * (96 / 25.4) / 2);   // 94
  const mad = (dx, dy) => {
    let s = 0, n = 0, peak = 0;
    for (let y = 4; y + dy < h - 4; y += 2) for (let x = 4; x + dx < w - 4; x += 2) {
      const d = Math.abs(at(x, y) - at(x + dx, y + dy));
      s += d; n++; if (d > peak) peak = d;
    }
    return { mean: s / n, peak };
  };
  const out = {
    PX, PY,
    onePeriodX: mad(PX, 0),
    onePeriodY: mad(0, PY),
    control: mad(PX + 37, 11),     // a deliberately wrong offset, for scale
  };
  pp.destroy(); el.remove();
  return out;
});
const f = (o) => `mean |diff| ${o.mean.toExponential(2)}  peak ${o.peak.toExponential(2)}`;
console.log(`[${tag}] predicted tile in half-res px: ${r.PX} x ${r.PY}`);
console.log(`[${tag}]   shifted one X period : ${f(r.onePeriodX)}`);
console.log(`[${tag}]   shifted one Y period : ${f(r.onePeriodY)}`);
console.log(`[${tag}]   shifted a wrong amount (control): ${f(r.control)}`);
await b.close(); server.close();
