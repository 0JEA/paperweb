// Autocorrelate a rendered field to find its repeat period, empirically.
import { chromium } from 'playwright-core';
import { serve } from './serve.mjs';
const { server, url } = await serve(0);
const b = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader'] });
const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
p.on('pageerror', e => console.log('PAGEERROR', e.message));
await p.goto(`${url}/test/browser/fixture.html`);
await p.waitForFunction('window.ready === true');

const out = await p.evaluate(async () => {
  const el = document.createElement('div');
  // Big enough to contain several periods of the formation field.
  el.style.cssText = 'width:1200px;height:800px;position:relative';
  document.body.appendChild(el);
  const pp = new window.PW.Paper(el, {
    retain: true, lazy: false, seed: 0,
    params: {
      cockle:{enabled:false}, folds:{enabled:false}, crumple:{enabled:false},
      fade:{enabled:false}, scratches:{enabled:false}, imperfect:{enabled:false},
      formation:{enabled:true, amplitude:0.05, scale_mm:2.5, source:0},
    },
  });
  await pp.render();
  const { data, w, h } = pp.floats('Albedo');
  const stride = data.length / (w * h);
  const at = (x, y) => data[(y * w + x) * stride];
  // Normalised autocorrelation along a row and a column, through the middle.
  const corr = (axis, maxLag) => {
    const res = [];
    for (let lag = 1; lag <= maxLag; lag++) {
      let sxy = 0, sxx = 0, syy = 0, n = 0;
      if (axis === 'x') {
        for (let y = 8; y < h - 8; y += 3) for (let x = 4; x + lag < w - 4; x += 2) {
          const a = at(x, y) - 1, c = at(x + lag, y) - 1;
          sxy += a * c; sxx += a * a; syy += c * c; n++;
        }
      } else {
        for (let x = 8; x < w - 8; x += 3) for (let y = 4; y + lag < h - 4; y += 2) {
          const a = at(x, y) - 1, c = at(x, y + lag) - 1;
          sxy += a * c; sxx += a * a; syy += c * c; n++;
        }
      }
      res.push([lag, sxy / Math.sqrt(sxx * syy)]);
    }
    return res;
  };
  const top = (arr, k) => arr.slice().sort((u, v) => v[1] - u[1]).slice(0, k);
  const cx = corr('x', Math.min(560, w - 12));
  const cy = corr('y', Math.min(360, h - 12));
  pp.destroy(); el.remove();
  return { w, h, topX: top(cx, 4), topY: top(cy, 4) };
});
console.log(`albedo buffer ${out.w}x${out.h} (half-res; 1 buffer px = 2 canvas px)`);
console.log('strongest self-similarity lags, X:', out.topX.map(([l,c]) => `${l}px r=${c.toFixed(3)}`).join('  '));
console.log('strongest self-similarity lags, Y:', out.topY.map(([l,c]) => `${l}px r=${c.toFixed(3)}`).join('  '));
await b.close(); server.close();
