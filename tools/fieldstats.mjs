// Compare the STATISTICS of the albedo field, which is what "papery" is made of.
import { chromium } from 'playwright-core';
import { serve } from './serve.mjs';
const tag = process.argv[2] || 'x';
const { server, url } = await serve(0);
const b = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader'] });
const p = await b.newPage({ viewport: { width: 900, height: 700 } });
p.on('pageerror', e => console.log('PAGEERROR', e.message));
await p.goto(`${url}/test/browser/fixture.html`);
await p.waitForFunction('window.ready === true');
const r = await p.evaluate(async () => {
  const el = document.createElement('div');
  el.style.cssText = 'width:800px;height:600px;position:relative';
  document.body.appendChild(el);
  const pp = new window.PW.Paper(el, {
    retain: true, lazy: false, seed: 0,
    params: { cockle:{enabled:false}, folds:{enabled:false}, crumple:{enabled:false},
      fade:{enabled:false}, scratches:{enabled:false}, imperfect:{enabled:false},
      formation:{enabled:true, amplitude:0.05, scale_mm:2.5, gsm_amount:0.7, skew:-0.3, source:0} },
  });
  await pp.render();
  const { data, w, h } = pp.floats('Albedo');
  const stride = data.length / (w * h);
  const v = [];
  for (let i = 0; i < w * h; i++) v.push(data[i * stride] - 1);
  const n = v.length;
  const mean = v.reduce((a, c) => a + c, 0) / n;
  const m = (k) => v.reduce((a, c) => a + (c - mean) ** k, 0) / n;
  const sd = Math.sqrt(m(2));
  const skew = m(3) / sd ** 3;
  const kurt = m(4) / sd ** 4;                 // 3.0 = Gaussian

  // LOCAL contrast variation: the Gaussian-scale-mixture signature. Split into
  // tiles, take each tile's own sd, then report how much those sds vary. A field
  // whose local contrast is constant reads as procedural; real paper's does not.
  const T = 24, sds = [];
  for (let ty = 0; ty + T < h; ty += T) for (let tx = 0; tx + T < w; tx += T) {
    let s = 0, ss = 0, c = 0;
    for (let y = ty; y < ty + T; y++) for (let x = tx; x < tx + T; x++) {
      const q = data[(y * w + x) * stride] - 1; s += q; ss += q * q; c++;
    }
    sds.push(Math.sqrt(Math.max(ss / c - (s / c) ** 2, 0)));
  }
  const sm = sds.reduce((a, c) => a + c, 0) / sds.length;
  const ssd = Math.sqrt(sds.reduce((a, c) => a + (c - sm) ** 2, 0) / sds.length);

  // Spectral slope beta, from a 1-D FFT-free estimate: variance of the field
  // after box-blurring at increasing radii tells us how energy falls with scale.
  const energyAt = (step) => {
    let s = 0, c = 0;
    for (let y = step; y < h - step; y += 5) for (let x = step; x < w - step; x += 5) {
      const a = data[(y * w + x) * stride];
      const bl = (data[(y * w + x - step) * stride] + data[(y * w + x + step) * stride]
                + data[((y - step) * w + x) * stride] + data[((y + step) * w + x) * stride]) / 4;
      s += (a - bl) ** 2; c++;
    }
    return Math.sqrt(s / c);
  };
  const oct = [2, 4, 8, 16, 32, 64, 128, 200].map((k) => +(energyAt(k) * 1e3).toFixed(3));
  pp.destroy(); el.remove();

  // And the same for the COCKLE relief, which is the layer that carries the
  // sheet's shape rather than its colour.
  const el2 = document.createElement('div');
  el2.style.cssText = 'width:800px;height:600px;position:relative';
  document.body.appendChild(el2);
  const p2 = new window.PW.Paper(el2, {
    retain: true, lazy: false, seed: 0,
    params: { folds:{enabled:false}, crumple:{enabled:false}, formation:{enabled:false},
      fade:{enabled:false}, scratches:{enabled:false}, imperfect:{enabled:false},
      cockle:{enabled:true, amplitude_um:22, wavelength_mm:30, anisotropy:2.2, irregularity:0.9} },
  });
  await p2.render();
  const H = p2.floats('Height');
  const hs = H.data.length / (H.w * H.h);
  let hmin = Infinity, hmax = -Infinity, hsum = 0, hsq = 0;
  for (let i = 0; i < H.w * H.h; i++) {
    const q = H.data[i * hs];
    if (q < hmin) hmin = q; if (q > hmax) hmax = q; hsum += q; hsq += q * q;
  }
  const hn = H.w * H.h, hmean = hsum / hn;
  const hsd = Math.sqrt(hsq / hn - hmean * hmean);
  p2.destroy(); el2.remove();

  return { sd, skew, kurt, localContrastMean: sm, localContrastSd: ssd,
           gsmRatio: ssd / sm, octaves: oct,
           cockle: { p2v: +(hmax - hmin).toFixed(2), sd: +hsd.toFixed(2) } };
});
console.log(`[${tag}] sd=${(r.sd*1e3).toFixed(2)}e-3  skew=${r.skew.toFixed(3)}  kurtosis=${r.kurt.toFixed(3)} (3.0=Gaussian)`);
console.log(`[${tag}] local-contrast variation (GSM signature) = ${r.gsmRatio.toFixed(3)}`);
console.log(`[${tag}] detail energy by scale (2,4,8,16,32,64,128,200 px): ${r.octaves.join('  ')}`);
console.log(`[${tag}] cockle relief: peak-to-valley ${r.cockle.p2v}um  sd ${r.cockle.sd}um`);
await b.close(); server.close();
