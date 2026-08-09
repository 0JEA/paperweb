import { chromium } from 'playwright-core';
import { serve } from './serve.mjs';
const { server, url } = await serve(0);
const b = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader'] });
const p = await b.newPage({ viewport: { width: 800, height: 700 } });
p.on('pageerror', e => console.log('PAGEERROR', e.message));
await p.goto(`${url}/test/browser/fixture.html`);
await p.waitForFunction('window.ready === true');

const OFF = {
  cockle:{enabled:false}, folds:{enabled:false}, crumple:{enabled:false},
  formation:{enabled:false}, fade:{enabled:false}, scratches:{enabled:false},
  imperfect:{enabled:false}, cavity:{enabled:false},
  edge:{enabled:false}, shadow:{enabled:false},
};
const CASES = {
  'worn-full':      { preset: 'worn' },
  'only-folds':     { params: { ...OFF, folds:{enabled:true,count:3,depth:0.45,sharpness:0.6,seed:3}, cavity:{enabled:true} } },
  'only-crumple':   { params: { ...OFF, crumple:{enabled:true,scale_mm:13,amplitude_um:34,crease:0.2,seed:1}, cavity:{enabled:true} } },
  'only-scratches': { params: { ...OFF, scratches:{enabled:true,density:0.04,lightness:0.15,scale_mm:3,seed:5} } },
  'only-cockle':    { params: { ...OFF, cockle:{enabled:true,amplitude_um:30,wavelength_mm:26,anisotropy:2.4,irregularity:0.85}, cavity:{enabled:true} } },
  'surface-full':    { preset: 'surface' },
  'pronounced-full': { preset: 'pronounced' },
  'interesting-full':{ preset: 'Interesting' },
};
await p.evaluate(() => {
  window.shot = async (opts, w, h) => {
    const el = document.createElement('div');
    el.id = 'probe';
    el.style.cssText = `width:${w}px;height:${h}px;position:relative`;
    document.body.appendChild(el);
    const pp = new window.PW.Paper(el, { retain: true, lazy: false, ...opts });
    await pp.render();
    window._probe = { pp, el };
    return true;
  };
  window.clear = () => { window._probe.pp.destroy(); window._probe.el.remove(); };
});
for (const [name, opts] of Object.entries(CASES)) {
  await p.evaluate(([o]) => window.shot(o, 653, 510), [opts]);
  const el = await p.$('#probe');
  await el.screenshot({ path: `/home/john/screenshots/2026-08-08-paperweb/diag-${name}.png` });
  await p.evaluate(() => window.clear());
}
console.log('rendered:', Object.keys(CASES).join(', '));
await b.close(); server.close();
