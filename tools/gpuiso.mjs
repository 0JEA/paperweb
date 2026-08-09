import { chromium } from 'playwright-core';
const port = process.argv[2];
const b = await chromium.launch({ headless: true, args: ['--use-gl=angle','--use-angle=vulkan','--enable-features=Vulkan'] });
const p = await b.newPage({ viewport: { width: 1300, height: 500 } });
p.on('pageerror', e => console.log('PAGEERROR', e.message));
await p.goto(`http://127.0.0.1:${port}/test/browser/fixture.html`);
await p.waitForFunction('window.ready === true');
const R = { cockle:{enabled:true,amplitude_um:26,wavelength_mm:28,anisotropy:2.1,irregularity:0.9},
            formation:{enabled:true,amplitude:0.028,gsm_amount:0.75,skew:-0.3,source:0},
            fade:{enabled:true,scale_mm:62,amount:0.6}, cavity:{enabled:true,radius_mm:0.75,lambda:0.6} };
const OFF = { cockle:{enabled:false}, formation:{enabled:false}, fade:{enabled:false},
              cavity:{enabled:false}, folds:{enabled:false}, crumple:{enabled:false},
              scratches:{enabled:false}, imperfect:{enabled:false},
              edge:{enabled:false}, shadow:{enabled:false} };
const CASES = {
  'A-reading-full':      { ...R },
  'B-cockle+cavity':     { ...OFF, cockle: R.cockle, cavity: R.cavity },
  'C-cockle-nocavity':   { ...OFF, cockle: R.cockle },
  'D-formation-only':    { ...OFF, formation: R.formation },
  'E-full-nocavity':     { ...R, cavity: { enabled: false } },
};
for (const [tag, params] of Object.entries(CASES)) {
  await p.evaluate(async ([params]) => {
    document.body.innerHTML = '';
    document.body.style.cssText = 'margin:0;background:#17161a';
    const el = document.createElement('div');
    el.id = 'h'; el.style.cssText = 'width:1180px;height:340px;position:relative;margin:12px';
    document.body.appendChild(el);
    const pp = new window.PW.Paper(el, { lazy: false, params });
    await pp.render();
  }, [params]);
  await p.waitForTimeout(2200);
  await (await p.$('#h')).screenshot({ path: `/home/john/screenshots/2026-08-08-paperweb/iso-${tag}.png` });
  console.log('  ', tag);
}
await b.close();
