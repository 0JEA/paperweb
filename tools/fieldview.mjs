// Show the ALBEDO field alone (no text, no lighting) at hero size, contrast
// stretched, from whichever build is on the given port.
import { chromium } from 'playwright-core';
const port = process.argv[2], tag = process.argv[3];
const b = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader'] });
const p = await b.newPage({ viewport: { width: 1300, height: 600 } });
p.on('pageerror', e => console.log('PAGEERROR', e.message));
await p.goto(`http://127.0.0.1:${port}/test/browser/fixture.html`);
await p.waitForFunction('window.ready === true');
const info = await p.evaluate(async () => {
  document.body.innerHTML = '';
  document.body.style.cssText = 'margin:0;background:#000';
  const el = document.createElement('div');
  el.style.cssText = 'width:1180px;height:350px;position:relative';
  document.body.appendChild(el);
  const pp = new window.PW.Paper(el, { preset: 'reading', retain: true, lazy: false });
  await pp.render();
  const { data, w, h } = pp.floats('Albedo');
  const st = data.length / (w * h);
  // contrast stretch to 2 sigma so the field is unmistakable
  let s = 0; for (let i = 0; i < w*h; i++) s += data[i*st];
  const mu = s/(w*h);
  let v = 0; for (let i = 0; i < w*h; i++) v += (data[i*st]-mu)**2;
  const sd = Math.sqrt(v/(w*h));
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  cv.style.cssText = 'display:block;width:1180px;height:350px;image-rendering:pixelated';
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    // float buffers read bottom-up
    const q = data[((h-1-y)*w + x)*st];
    const t = Math.max(0, Math.min(1, (q - mu) / (2*sd) * 0.5 + 0.5));
    const o = (y*w + x)*4;
    img.data[o] = img.data[o+1] = img.data[o+2] = Math.round(t*255); img.data[o+3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  document.body.innerHTML = '';
  document.body.appendChild(cv);
  return { w, h, sd };
});
await p.waitForTimeout(300);
await p.screenshot({ path: `/home/john/screenshots/2026-08-08-paperweb/field-${tag}.png`, clip: { x:0, y:0, width:1180, height:350 } });
console.log(`field-${tag}.png  buffer ${info.w}x${info.h}  sd ${(info.sd*1e3).toFixed(2)}e-3`);
await b.close();
