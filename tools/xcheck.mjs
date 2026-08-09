import { chromium } from 'playwright-core';
const b = await chromium.launch({ headless: true, args: ['--use-gl=angle','--use-angle=vulkan','--enable-features=Vulkan'] });
async function sig(port, params) {
  const p = await b.newPage({ viewport: { width: 900, height: 600 } });
  p.on('pageerror', e => console.log('PAGEERROR', port, e.message));
  await p.goto(`http://127.0.0.1:${port}/test/browser/fixture.html`);
  await p.waitForFunction('window.ready === true');
  const r = await p.evaluate(async ([params]) => {
    const el = document.createElement('div');
    el.style.cssText = 'width:600px;height:300px;position:relative';
    document.body.appendChild(el);
    const pp = new window.PW.Paper(el, { preset: 'reading', retain: true, lazy: false, seed: 0, params });
    await pp.render();
    const out = {};
    for (const buf of ['Height', 'Normal', 'Shade']) {
      const { data, w, h } = pp.floats(buf);
      const st = data.length / (w * h);
      let s = 0, ss = 0; const head = [];
      for (let i = 0; i < w * h; i++) { const v = data[i * st]; s += v; ss += v * v;
        if (i % 1013 === 0 && head.length < 5) head.push(+v.toFixed(4)); }
      const n = w * h, mu = s / n;
      out[buf] = { sd: +Math.sqrt(ss / n - mu * mu).toFixed(4), head: head.join(',') };
    }
    // How "creased" is the shade? Count sharp local gradients.
    const { data, w, h } = pp.floats('Shade');
    const st = data.length / (w * h);
    let sharp = 0, n2 = 0;
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const g = Math.abs(data[(y*w+x+1)*st] - data[(y*w+x-1)*st])
              + Math.abs(data[((y+1)*w+x)*st] - data[((y-1)*w+x)*st]);
      if (g > 0.02) sharp++; n2++;
    }
    out.creaseFraction = +(100 * sharp / n2).toFixed(2);
    pp.destroy(); el.remove();
    return out;
  }, [params]);
  await p.close();
  return r;
}
const old = await sig(8232, {});
const m2  = await sig(8231, { page: { legacy: 2 } });
const m0  = await sig(8231, { page: { legacy: 0 } });
console.log('                 Height sd   Shade sd   sharp-gradient %  (the creases)');
for (const [k, v] of [['OLD build', old], ['new mode2', m2], ['new mode0', m0]]) {
  console.log(k.padEnd(16), String(v.Height.sd).padEnd(11), String(v.Shade.sd).padEnd(10), v.creaseFraction + '%');
}
console.log();
console.log('OLD height head :', old.Height.head);
console.log('new m2   head   :', m2.Height.head);
console.log('identical field :', old.Height.head === m2.Height.head ? 'YES' : 'NO');
await b.close();
