// Diagnostic: which pass produces the long straight creases, and is the field
// identical across surfaces?
import { chromium } from 'playwright-core';
import { serve } from './serve.mjs';
const { server, url } = await serve(0);
const b = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader'] });
const p = await b.newPage({ viewport: { width: 900, height: 700 } });
p.on('pageerror', e => console.log('PAGEERROR', e.message));
await p.goto(`${url}/test/browser/fixture.html`);
await p.waitForFunction('window.ready === true');

// Which presets enable which height layers?
const cfg = await p.evaluate(() => {
  const out = {};
  for (const n of window.PW.presetNames) {
    const r = window.PW.resolve(window.PW.preset(n));
    out[n] = { folds: r.folds.enabled, crumple: r.crumple.enabled,
               scratches: r.scratches.enabled, foldCount: r.folds.count,
               foldSeed: r.folds.seed, crumpleSeed: r.crumple.seed };
  }
  return out;
});
console.log('=== which presets enable the straight-line layers ===');
for (const [n, c] of Object.entries(cfg)) {
  const on = [c.folds && `folds(n=${c.foldCount},seed=${c.foldSeed})`, c.crumple && `crumple(seed=${c.crumpleSeed})`, c.scratches && 'scratches'].filter(Boolean);
  console.log(`  ${n.padEnd(12)} ${on.length ? on.join(' + ') : '(none)'}`);
}

// Is the height field identical between two separate surfaces of the same size?
await p.evaluate(() => {
  window.hashOf = async (opts, w, h) => {
    const el = document.createElement('div');
    el.style.cssText = `width:${w}px;height:${h}px;position:relative`;
    document.body.appendChild(el);
    const pp = new window.PW.Paper(el, { retain: true, lazy: false, ...opts });
    await pp.render();
    const { data, w: bw, h: bh } = pp.floats('Height');
    const stride = data.length / (bw * bh);
    // coarse signature: 64 evenly spaced samples, rounded
    const sig = [];
    for (let i = 0; i < 64; i++) {
      const idx = Math.floor((i / 64) * bw * bh) * stride;
      sig.push(Math.round(data[idx] * 100) / 100);
    }
    pp.destroy(); el.remove();
    return sig.join(',');
  };
});
const a1 = await p.evaluate(() => window.hashOf({ preset: 'worn' }, 320, 220));
const a2 = await p.evaluate(() => window.hashOf({ preset: 'worn' }, 320, 220));
const a3 = await p.evaluate(() => window.hashOf({ preset: 'worn' }, 480, 220));
console.log('\n=== is the field identical across separate surfaces? ===');
console.log('  same size, two instances :', a1 === a2 ? 'IDENTICAL' : 'different');
console.log('  different width          :', a1 === a3 ? 'IDENTICAL' : 'different');

await b.close(); server.close();
