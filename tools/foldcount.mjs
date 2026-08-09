// How many creases actually land ON the sheet, across seeds?
// p0 = r1.y * sheet_mm + 0.2 * sheet_mm places each crease line somewhere along
// the sheet diagonal from 0.2x to 1.2x its size, so a line can miss entirely.
// With a fixed seed that was invisible: every sheet got the same three.
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
  for (let seed = 0; seed < 16; seed++) {
    const el = document.createElement('div');
    el.style.cssText = 'width:330px;height:220px;position:relative';
    document.body.appendChild(el);
    const pp = new window.PW.Paper(el, {
      retain: true, lazy: false, seed,
      params: { cockle:{enabled:false}, crumple:{enabled:false},
        folds:{enabled:true, count:3, depth:0.45, sharpness:0.6, seed:3} },
    });
    await pp.render();
    const { data, w, h } = pp.floats('Height');
    const stride = data.length / (w * h);
    // A crease is present where |height| is a decent fraction of the 67.5um
    // a single fold peaks at (depth 0.45 x 150um).
    let strong = 0, n = 0, peak = 0;
    for (let i = 0; i < w * h; i++) {
      const v = Math.abs(data[i * stride]);
      if (v > 20) strong++;
      if (v > peak) peak = v;
      n++;
    }
    out.push({ seed, coverage: +(100 * strong / n).toFixed(1), peak: +peak.toFixed(1) });
    pp.destroy(); el.remove();
  }
  return out;
});
console.log('seed  % of sheet carrying a crease   peak relief (um)');
for (const r of rows) {
  const bar = '#'.repeat(Math.round(r.coverage / 1.5));
  console.log(`${String(r.seed).padStart(4)}  ${String(r.coverage).padStart(5)}%  ${bar}${r.coverage < 3 ? '   <- essentially no creases' : ''}`);
}
const none = rows.filter(r => r.coverage < 3).length;
console.log(`\n${none} of ${rows.length} seeds produce a sheet with essentially no visible crease.`);
await b.close(); server.close();
