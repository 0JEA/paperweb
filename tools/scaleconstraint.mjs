// Approach C: keep the periodic hash, enlarge the grain so one tile exceeds the
// element. Does it survive a taller element?
import { chromium } from 'playwright-core';
import { serve } from './serve.mjs';
const { server, url } = await serve(0);
const b = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader'] });
const p = await b.newPage({ viewport: { width: 1000, height: 900 } });
p.on('pageerror', e => console.log('PAGEERROR', e.message));
await p.goto(`${url}/test/browser/fixture.html`);
await p.waitForFunction('window.ready === true');

const rows = await p.evaluate(async () => {
  const worstLag = async (h, scale_mm) => {
    const el = document.createElement('div');
    el.style.cssText = `width:640px;height:${h}px;position:relative`;
    document.body.appendChild(el);
    const pp = new window.PW.Paper(el, { retain: true, lazy: false, seed: 3,
      params: { cockle:{enabled:false}, folds:{enabled:false}, crumple:{enabled:false},
        fade:{enabled:false}, scratches:{enabled:false}, imperfect:{enabled:false},
        formation:{enabled:true, amplitude:0.07, scale_mm, source:0} } });
    await pp.render();
    const { data, w, hh } = { ...pp.floats('Albedo'), hh: pp.floats('Albedo').h };
    const H = hh, W = w, st = data.length / (W * H);
    const at = (x, y) => data[(y * W + x) * st] - 1;
    let best = -1, bestLag = 0;
    for (let lag = 16; lag < H - 8; lag++) {
      let sxy = 0, sxx = 0, syy = 0;
      for (let x = 6; x < W - 6; x += 4) for (let y = 4; y + lag < H - 4; y += 2) {
        const a = at(x, y), c = at(x, y + lag); sxy += a*c; sxx += a*a; syy += c*c;
      }
      const r = sxy / Math.sqrt(sxx * syy);
      if (r > best) { best = r; bestLag = lag; }
    }
    pp.destroy(); el.remove();
    return { r: +best.toFixed(3), lag: bestLag };
  };
  const out = [];
  for (const h of [200, 360, 600, 800]) {
    out.push({ h, needed: +(h / (20 * 96 / 25.4)).toFixed(2),
               at25: await worstLag(h, 2.5), at5mm: await worstLag(h, 5.0) });
  }
  return out;
});

console.log('APPROACH C: periodic hash, grain enlarged to 5.0 mm, offset per surface');
console.log('one tile is 20 cells tall = 20 x 5.0mm = 100mm = 378 css px\n');
console.log('element   grain needed |  2.5mm grain (research value) |  5.0mm grain (your fix)');
for (const r of rows) {
  const f = (o) => `r=${String(o.r).padEnd(5)} @lag ${String(o.lag).padStart(3)}px ${o.r > 0.35 ? 'REPEAT' : 'ok    '}`;
  console.log(`${String(r.h).padStart(5)}px   ${String(r.needed).padStart(9)}mm |  ${f(r.at25)} |  ${f(r.at5mm)}`);
}
console.log('\n(research puts formation at 1-3 mm; the eye peaks there)');
await b.close(); server.close();
