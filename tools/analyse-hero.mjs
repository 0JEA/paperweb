// Autocorrelate the actual rendered hero PNG to find what the eye is picking up.
import { chromium } from 'playwright-core';
import { serve } from './serve.mjs';
import { copyFile, mkdir } from 'node:fs/promises';
await mkdir('demo/an', { recursive: true });
for (const t of ['old','new']) await copyFile(`/home/john/screenshots/2026-08-08-paperweb/hero-${t}.png`, `demo/an/hero-${t}.png`);
const { server, url } = await serve(0);
const b = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
// Navigate to the SAME origin the images are served from; a page on about:blank
// treats them as cross-origin and taints the canvas.
await p.goto(`${url}/demo/`, { waitUntil: 'domcontentloaded' });
const out = await p.evaluate(async ([base]) => {
  const load = (src) => new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = src; });
  const res = {};
  for (const tag of ['old', 'new']) {
    const img = await load(`${base}/demo/an/hero-${tag}.png`);
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const x = c.getContext('2d'); x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height).data;
    const W = c.width, H = c.height;
    // luminance, high-passed to remove the lighting gradient so only texture remains
    const lum = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) lum[i] = (d[i*4]*0.299 + d[i*4+1]*0.587 + d[i*4+2]*0.114) / 255;
    const hp = new Float32Array(W * H);
    const R = 24;
    for (let y = R; y < H - R; y++) for (let xx = R; xx < W - R; xx++) {
      let s = 0, n = 0;
      for (let k = -R; k <= R; k += 6) { s += lum[y*W + xx + k] + lum[(y+k)*W + xx]; n += 2; }
      hp[y*W + xx] = lum[y*W + xx] - s / n;
    }
    const corr = (axis, maxLag) => {
      const arr = [];
      for (let lag = 8; lag <= maxLag; lag++) {
        let sxy=0,sxx=0,syy=0;
        for (let y = R+2; y < H-R-2; y += 3) for (let xx = R+2; xx < W-R-2; xx += 3) {
          const ax = axis === 'x' ? xx + lag : xx, ay = axis === 'x' ? y : y + lag;
          if (ax >= W-R-2 || ay >= H-R-2) continue;
          const a = hp[y*W+xx], c2 = hp[ay*W+ax];
          sxy += a*c2; sxx += a*a; syy += c2*c2;
        }
        arr.push([lag, sxy / Math.sqrt(sxx*syy)]);
      }
      return arr;
    };
    const top = (a) => a.slice().sort((u,v)=>v[1]-u[1]).slice(0,3)
      .map(([l,r])=>`${l}px r=${r.toFixed(3)}`).join('  ');
    res[tag] = { w: W, h: H, x: top(corr('x', 620)), y: top(corr('y', 160)) };
  }
  return res;
}, [url]);
console.log('what repeats in the RENDERED hero (high-passed, lighting removed)');
for (const t of ['old','new']) {
  console.log(`  ${t.toUpperCase().padEnd(4)} ${out[t].w}x${out[t].h}`);
  console.log(`    horizontal: ${out[t].x}`);
  console.log(`    vertical  : ${out[t].y}`);
}
await b.close(); server.close();
