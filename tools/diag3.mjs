import { chromium } from 'playwright-core';
import { serve } from './serve.mjs';
const { server, url } = await serve(0);
const b = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader'] });
const p = await b.newPage({ viewport: { width: 900, height: 700 } });
await p.goto(`${url}/test/browser/fixture.html`);
await p.waitForFunction('window.ready === true');
await p.evaluate(() => {
  window.probe = async (opts, w, h) => {
    const el = document.createElement('div');
    el.style.cssText = `width:${w}px;height:${h}px;position:relative`;
    document.body.appendChild(el);
    const pp = new window.PW.Paper(el, { retain: true, lazy: false, ...opts });
    await pp.render();
    const { data, w: bw, h: bh } = pp.floats('Height');
    const stride = data.length / (bw * bh);
    // Where along the LEFT edge does each fold ridge sit, as a fraction of height?
    const peaks = [];
    let prev = 0;
    for (let y = 1; y < bh - 1; y++) {
      const v = data[(y * bw + 4) * stride];
      const nx = data[((y + 1) * bw + 4) * stride];
      if (v > prev && v > nx && Math.abs(v) > 8) peaks.push(+(y / bh).toFixed(3));
      prev = v;
    }
    pp.destroy(); el.remove();
    return peaks;
  };
});
const cfg = { params: { cockle:{enabled:false}, crumple:{enabled:false},
  folds:{enabled:true,count:3,depth:0.45,sharpness:0.6,seed:3} } };
for (const [w, h] of [[320,220],[480,220],[640,440],[900,300]]) {
  const peaks = await p.evaluate(([o,w,h]) => window.probe(o,w,h), [cfg,w,h]);
  console.log(`${String(w).padStart(4)}x${h}  fold ridges at height fractions: ${JSON.stringify(peaks)}`);
}
await b.close(); server.close();
