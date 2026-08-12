// @ts-nocheck -- this file assembles code that runs in the page's realm, where
// window carries the test helpers installed below; the checker cannot see them.
// Browser invariant tests.
//
// These are the tests that can actually establish the port produces correct
// arithmetic, because they read the intermediate float buffers back and assert
// properties that follow from the physics, not from whatever the shaders happen
// to output. A screenshot comparison would only tell us the output has not
// changed; these say what it should BE.
//
//   node test/browser/run.mjs [--headed] [--keep]

import { chromium } from 'playwright-core';
import { serve } from '../../tools/serve.mjs';

const HEADED = process.argv.includes('--headed');

let passed = 0;
let failed = 0;
const failures = [];

function check(name, cond, detail = '') {
  if (cond) { passed++; console.log(`  ok   ${name}`); }
  else { failed++; failures.push(`${name}${detail ? `\n       ${detail}` : ''}`); console.log(`  FAIL ${name}${detail ? `\n       ${detail}` : ''}`); }
}

const { server, url } = await serve(0);

const browser = await chromium.launch({
  headless: !HEADED,
  args: [
    // Headless chromium has no GPU here, so WebGL2 comes from SwiftShader.
    // That is the point: if the pipeline works on a software rasteriser it will
    // work anywhere, and the float-buffer readback is exact rather than subject
    // to a vendor's fast-math.
    '--enable-unsafe-swiftshader',
    '--use-gl=angle',
    '--use-angle=swiftshader',
  ],
});
const page = await browser.newPage({ viewport: { width: 900, height: 700 }, deviceScaleFactor: 1 });

const consoleErrors = [];
// The text of a network console error is generic ("Failed to load resource:
// ... 404"), so the originating URL is recorded alongside it; otherwise the
// deliberate 404 in the rasterize-failure test cannot be told from a real one.
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  const loc = m.location && m.location();
  consoleErrors.push(loc && loc.url ? `${m.text()} <- ${loc.url}` : m.text());
});
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

await page.goto(`${url}/test/browser/fixture.html`);
await page.waitForFunction('window.ready === true');

// --- capabilities -----------------------------------------------------------
console.log('\ncapabilities');
const caps = await page.evaluate(() => window.PW.capabilities());
console.log(`  ${JSON.stringify(caps)}`);
check('WebGL2 with a float-renderable colour buffer is available', caps.ok, caps.reason);

if (!caps.ok) {
  console.log('\nno usable WebGL2 in this browser; the invariant tests cannot run.');
  await browser.close();
  server.close();
  process.exit(1);
}

// --- helper: build a retained surface with a given param patch --------------
await page.evaluate(() => {
  // seed is pinned here on purpose. Every surface now gets its own sheet of
  // paper, so two instances differ by design; the tests below compare fields
  // ACROSS instances (incremental vs fresh render, amplitude scaling), and
  // without a fixed seed they would be comparing two different sheets. Seed
  // variation itself is covered by its own test.
  window.mk = async (patch, opts = {}) => {
    const el = document.getElementById('a');
    if (window.p) window.p.destroy();
    window.p = new window.PW.Paper(el, {
      params: patch, retain: true, lazy: false, seed: 0,
      onError: (m) => { (window.errs ||= []).push(m); },
      ...opts,
    });
    await window.p.render();
    return true;
  };
  // Reduce a float buffer to summary statistics; comparing millions of floats
  // across the bridge would be slower than the render.
  window.stats = (name, channels = 1) => {
    const { data, w, h } = window.p.floats(name);
    const stride = data.length / (w * h);
    let min = Infinity, max = -Infinity, sum = 0, sumsq = 0, n = 0;
    for (let i = 0; i < w * h; i++) {
      const v = data[i * stride];
      if (v < min) min = v;
      if (v > max) max = v;
      sum += v; sumsq += v * v; n++;
    }
    const mean = sum / n;
    return { min, max, mean, rms: Math.sqrt(sumsq / n), sd: Math.sqrt(sumsq / n - mean * mean), w, h, stride, channels };
  };
  // Sample the .r channel at a fractional position inside a buffer.
  window.sampleAt = (name, fx, fy) => {
    const { data, w, h } = window.p.floats(name);
    const stride = data.length / (w * h);
    const x = Math.min(w - 1, Math.max(0, Math.round(fx * (w - 1))));
    // float buffers are read bottom-up; flip so callers can think top-down
    const y = Math.min(h - 1, Math.max(0, Math.round((1 - fy) * (h - 1))));
    return data[(y * w + x) * stride];
  };
});

// --- invariant 1: a perfectly flat sheet -------------------------------------
console.log('\nflat sheet (every relief and albedo effect disabled)');
await page.evaluate(() => window.mk({
  cockle: { enabled: false }, folds: { enabled: false }, crumple: { enabled: false },
  formation: { enabled: false }, fade: { enabled: false },
  scratches: { enabled: false }, imperfect: { enabled: false },
  cavity: { enabled: false }, edge: { enabled: false }, shadow: { enabled: false },
  light: { specular: false },
}));

const flatH = await page.evaluate(() => window.stats('Height'));
check('height field is identically zero', flatH.min === 0 && flatH.max === 0,
  `min=${flatH.min} max=${flatH.max}`);

const flatShade = await page.evaluate(() => window.stats('Shade'));
check('shade is exactly 1.0 everywhere (a flat sheet must not be shaded)',
  Math.abs(flatShade.min - 1) < 1e-6 && Math.abs(flatShade.max - 1) < 1e-6,
  `min=${flatShade.min} max=${flatShade.max}`);

const flatAlb = await page.evaluate(() => window.stats('Albedo'));
check('albedo is exactly 1.0 everywhere', Math.abs(flatAlb.min - 1) < 1e-6 && Math.abs(flatAlb.max - 1) < 1e-6,
  `min=${flatAlb.min} max=${flatAlb.max}`);

// The composite at the sheet centre must be exactly the tone colour, because
// shade = albedo = 1, content = 1 (no ink) and duotone contributes nothing when
// shade - 1 == 0.
const centre = await page.evaluate(() => {
  const { data, w, h } = window.p.floats('Final');
  const stride = data.length / (w * h);
  const i = (Math.floor(h / 2) * w + Math.floor(w / 2)) * stride;
  return [data[i], data[i + 1], data[i + 2], data[i + 3]];
});
const tone = [1.0, 0.953, 0.871];
check('composite centre equals tone.paper within 1/255',
  centre.slice(0, 3).every((v, i) => Math.abs(v - tone[i]) < 1 / 255),
  `got [${centre.slice(0, 3).map((v) => v.toFixed(4))}] want [${tone}]`);
check('composite centre is fully opaque', Math.abs(centre[3] - 1) < 1e-3, `alpha=${centre[3]}`);

// --- invariant 2: cockle amplitude is physical -------------------------------
console.log('\ncockle relief carries the amplitude it claims');
for (const amp of [22, 60]) {
  await page.evaluate((a) => window.mk({
    cockle: { enabled: true, amplitude_um: a, irregularity: 1.0 },
    folds: { enabled: false }, crumple: { enabled: false },
  }), amp);
  const s = await page.evaluate(() => window.stats('Height'));
  // The field is roughly +/-0.5 x amplitude x 1.6 for the fully organic branch,
  // so peak-to-valley should land in the same order as the requested amplitude
  // and scale linearly with it.
  const p2v = s.max - s.min;
  check(`amplitude_um=${amp}: peak-to-valley is within 3x of the request`,
    p2v > amp * 0.3 && p2v < amp * 3,
    `p2v=${p2v.toFixed(2)}um, mean=${s.mean.toFixed(3)}, sd=${s.sd.toFixed(3)}`);
  if (amp === 22) globalThis.__p2v22 = p2v;
  if (amp === 60) globalThis.__p2v60 = p2v;
}
{
  const ratio = globalThis.__p2v60 / globalThis.__p2v22;
  check('relief scales linearly with amplitude_um (60/22 ~ 2.73)',
    Math.abs(ratio - 60 / 22) < 0.15,
    `ratio=${ratio.toFixed(3)} want ${(60 / 22).toFixed(3)}`);
}

// --- invariant 3: height is in micrometres, not millimetres ------------------
// This is the port's one deliberate numerical divergence, so it gets an explicit
// test: a 22um cockle must read as ~22, not as ~0.022.
{
  await page.evaluate(() => window.mk({
    cockle: { enabled: true, amplitude_um: 22, irregularity: 1.0 },
    folds: { enabled: false }, crumple: { enabled: false },
  }));
  const s = await page.evaluate(() => window.stats('Height'));
  check('height buffer is denominated in micrometres',
    Math.abs(s.max) > 1 && Math.abs(s.max) < 1000,
    `max=${s.max} (mm would give ~0.02, um gives ~20)`);
}

// --- invariant 4: the mask is the sheet silhouette ---------------------------
console.log('\nsheet mask');
await page.evaluate(() => window.mk({
  edge: { enabled: true, wobble_px: 4, deckle_px: 0 },
  shadow: { enabled: true },
}));
const maskIn = await page.evaluate(() => window.sampleAt('Alpha', 0.5, 0.5));
const maskOut = await page.evaluate(() => window.sampleAt('Alpha', 0.005, 0.005));
check('mask is ~1 well inside the page rect', maskIn > 0.99, `centre=${maskIn}`);
check('mask is ~0 in the margin outside the sheet', maskOut < 0.01, `corner=${maskOut}`);

// --- invariant 5: cavity is a signed curvature, zero-mean on a smooth field --
console.log('\ncavity (blur(h) - h) behaves like a Laplacian');
{
  const c = await page.evaluate(() => window.stats('Cavity'));
  check('cavity has both signs (valleys positive, peaks negative)',
    c.min < 0 && c.max > 0, `min=${c.min} max=${c.max}`);
  check('cavity is close to zero-mean, as a Laplacian of a smooth field must be',
    Math.abs(c.mean) < 0.05 * (c.max - c.min), `mean=${c.mean}, range=${c.max - c.min}`);
}

// --- invariant 6: disabling the shadow clears it, it does not linger ---------
console.log('\nshadow lifecycle');
{
  await page.evaluate(() => window.mk({ shadow: { enabled: true, blur_px: 20, darkness: 0.8 } }));
  const on = await page.evaluate(() => window.stats('Shadow'));
  await page.evaluate(() => window.p.set({ shadow: { enabled: false } }));
  const off = await page.evaluate(() => window.stats('Shadow'));
  check('shadow buffer is non-empty when enabled', on.max > 0.5, `max=${on.max}`);
  check('shadow buffer is cleared when disabled, not left stale',
    off.max < 1e-6, `max=${off.max}`);
}

// --- invariant 7: the light actually moves the shading -----------------------
console.log('\nlighting responds to azimuth');
{
  await page.evaluate(() => window.mk({
    cockle: { enabled: true, amplitude_um: 40, irregularity: 1.0 },
    cavity: { enabled: false }, light: { specular: false },
  }));
  const a = await page.evaluate(() => window.sampleAt('Shade', 0.42, 0.42));
  await page.evaluate(() => window.p.set({ light: { azimuth_deg: 116 - 180 } }));
  const b = await page.evaluate(() => window.sampleAt('Shade', 0.42, 0.42));
  check('flipping the light 180 degrees flips the shading at a point',
    Math.abs((a - 1) + (b - 1)) < 1e-3 && Math.abs(a - b) > 1e-4,
    `az=116 -> ${a}, az=-64 -> ${b} (deviations should be equal and opposite)`);
}

// --- invariant 8: dirty flagging does not change the result ------------------
console.log('\ndirty flagging is transparent');
{
  await page.evaluate(() => window.mk({ cockle: { enabled: true, amplitude_um: 30 } }));
  const incremental = await page.evaluate(async () => {
    window.p.set({ light: { azimuth_deg: 40 } });
    await window.p.render();
    return window.stats('Shade');
  });
  const fromScratch = await page.evaluate(async () => {
    await window.mk({ cockle: { enabled: true, amplitude_um: 30 }, light: { azimuth_deg: 40 } });
    return window.stats('Shade');
  });
  check('an incremental re-render matches a fresh render exactly',
    Math.abs(incremental.mean - fromScratch.mean) < 1e-6
    && Math.abs(incremental.rms - fromScratch.rms) < 1e-6,
    `incremental mean=${incremental.mean} rms=${incremental.rms}; fresh mean=${fromScratch.mean} rms=${fromScratch.rms}`);
}

// --- invariant 9: content 'behind' leaves the DOM alone ----------------------
console.log("\ncontent:'behind' preserves the document");
{
  await page.evaluate(() => window.mk({}, { content: 'behind' }));
  const text = await page.locator('#body').innerText();
  const visible = await page.locator('#body').isVisible();
  const canvasCount = await page.evaluate(() => document.querySelectorAll('[data-paperweb-canvas]').length);
  const zIndex = await page.evaluate(() => getComputedStyle(document.querySelector('[data-paperweb-canvas]')).zIndex);
  const isolation = await page.evaluate(() => getComputedStyle(document.getElementById('a')).isolation);
  check('the element text is still present and visible', visible && text.includes('selectable'), text);
  check('exactly one canvas was inserted', canvasCount === 1, `count=${canvasCount}`);
  check('the canvas sits at z-index -1 behind the content', zIndex === '-1', zIndex);
  check('the host element was given its own stacking context', isolation === 'isolate', isolation);
  const ariaHidden = await page.evaluate(() => document.querySelector('[data-paperweb-canvas]').getAttribute('aria-hidden'));
  check('the canvas is hidden from assistive technology', ariaHidden === 'true', String(ariaHidden));
}

// --- invariant 10: the surface actually painted ------------------------------
console.log('\nthe visible canvas carries the sheet');
{
  const px = await page.evaluate(() => {
    const c = document.querySelector('[data-paperweb-canvas]');
    const ctx = c.getContext('2d');
    const d = ctx.getImageData(Math.floor(c.width / 2), Math.floor(c.height / 2), 1, 1).data;
    return [d[0], d[1], d[2], d[3]];
  });
  // tone.paper #FFF3DE = (255, 243, 222) before shading; shading and formation
  // move it a little, so allow a generous window but insist it is warm and light.
  check('the 2D canvas centre is a warm off-white, not blank',
    px[3] > 250 && px[0] > 220 && px[1] > 200 && px[2] > 170 && px[0] >= px[1] && px[1] >= px[2],
    `rgba(${px.join(', ')})`);
}

// --- invariant 11: rasterize failure degrades instead of blanking ------------
console.log('\ncontent:"rasterize" failure path');
{
  const res = await page.evaluate(async () => {
    window.errs = [];
    const el = document.getElementById('a');
    if (window.p) window.p.destroy();
    // Force the failure with a same-origin 404. An unreachable host would do the
    // same job but Chromium refuses several low port numbers outright, which
    // produces a net::ERR_UNSAFE_PORT console error from the harness rather than
    // from the library and makes the console-hygiene check meaningless.
    window.p = new window.PW.Paper(el, {
      content: '/test/browser/no-such-image.png',
      retain: true, lazy: false,
      onError: (m) => window.errs.push(m),
    });
    await window.p.render();
    return {
      errs: window.errs,
      mode: window.p.contentMode,
      bodyVisible: getComputedStyle(document.getElementById('body')).visibility,
    };
  });
  check('a failing content source is reported, not swallowed', res.errs.length > 0, JSON.stringify(res.errs));
  check("it falls back to content:'behind'", res.mode === 'behind', res.mode);
  check('the element content is left visible after the fallback',
    res.bodyVisible === 'visible', res.bodyVisible);
  const px = await page.evaluate(() => {
    const c = document.querySelector('[data-paperweb-canvas]');
    const d = c.getContext('2d').getImageData(Math.floor(c.width / 2), Math.floor(c.height / 2), 1, 1).data;
    return [d[0], d[1], d[2], d[3]];
  });
  check('the surface still rendered after the fallback', px[3] > 250 && px[0] > 200, `rgba(${px.join(', ')})`);
}

// --- invariant 12: rasterize success path couples ink to paper ---------------
console.log('\ncontent:"rasterize" success path');
{
  const res = await page.evaluate(async () => {
    window.errs = [];
    const el = document.getElementById('a');
    if (window.p) window.p.destroy();
    window.p = new window.PW.Paper(el, {
      content: 'rasterize', retain: true, lazy: false,
      onError: (m) => window.errs.push(m),
    });
    await window.p.render();
    const c = document.querySelector('[data-paperweb-canvas]');
    const ctx = c.getContext('2d');
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    // The heading is dark text near the top-left of the sheet. If the raster
    // reached the composite there must be genuinely dark pixels somewhere.
    let darkest = 255;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200 && d[i] < darkest) darkest = d[i];
    return { errs: window.errs, mode: window.p.contentMode, darkest };
  });
  if (res.mode === 'rasterize') {
    check('the rasterised text reaches the composite as real ink',
      res.darkest < 120, `darkest red channel = ${res.darkest}`);
  } else {
    // Not a failure of the library: the contract is that it degrades. Record it.
    console.log(`  note rasterize degraded in this browser (${res.errs.join('; ')})`);
    check('degradation was reported rather than silent', res.errs.length > 0, JSON.stringify(res.errs));
  }
}

// --- invariant 12b: rasterised styles land on the right children -------------
// Regression test. inlineStyles walks the source and the clone in parallel by
// child index, and paperweb inserts its own canvas as the element's first child.
// If only one side filters that canvas out, every child inherits its sibling's
// styles: a real bug that shipped once and reads as merely "a bit off" rather
// than broken.
//
// The content texture is a single luminance channel ("1 paper, 0 ink"), so the
// probe uses three grey levels rather than three colours. Under the bug the
// first band would inherit the canvas's style (no background, so it stays paper)
// and each real background would slide down one, making the top two bands equal.
console.log('\nrasterised styles align with their source children');
{
  const res = await page.evaluate(async () => {
    const probe = document.createElement('div');
    probe.id = 'probe';
    probe.style.cssText = 'width:300px;height:300px;margin:40px;position:relative';
    for (const c of ['rgb(255,255,255)', 'rgb(128,128,128)', 'rgb(0,0,0)']) {
      const d = document.createElement('div');
      d.style.cssText = `background:${c};height:100px;width:100%`;
      probe.appendChild(d);
    }
    document.body.appendChild(probe);
    // Bind first, so paperweb's canvas really is child 0 when the snapshot runs.
    // That is the precondition the bug needed.
    const errs = [];
    const p = new window.PW.Paper(probe, {
      content: 'rasterize', retain: true, lazy: false, onError: (m) => errs.push(m),
      params: {
        shadow: { enabled: false }, edge: { enabled: false },
        cockle: { enabled: false }, formation: { enabled: false },
        fade: { enabled: false }, cavity: { enabled: false },
      },
    });
    await p.render();
    const cv = document.querySelector('#probe [data-paperweb-canvas]');
    const ctx = cv.getContext('2d');
    const x = Math.floor(cv.width / 2);
    const lum = (frac) => ctx.getImageData(x, Math.floor(cv.height * frac), 1, 1).data[0];
    const out = { mode: p.contentMode, errs, top: lum(0.17), mid: lum(0.5), bot: lum(0.83) };
    p.destroy();
    probe.remove();
    return out;
  });
  if (res.mode !== 'rasterize') {
    console.log(`  note rasterize unavailable here (${res.errs.join('; ')}); alignment not checked`);
  } else {
    const { top, mid, bot } = res;
    check('the white band renders as bare paper', top > 200, `top=${top}`);
    check('the three bands are distinct and in source order (light, mid, dark)',
      top - mid > 30 && mid - bot > 20,
      `top=${top} mid=${mid} bot=${bot}`);
    check('the black band renders as near-full ink', bot < 80, `bot=${bot}`);
  }
}

// --- invariant 12c: overhang modes ------------------------------------------
// The cast shadow needs void to fall on, and the default way to give it that is
// to grow the canvas past the element. That growth contributes to the ROOT
// scroller's overflow, which is a real layout hazard, so the two non-growing
// modes must genuinely not stick out.
console.log('\noverhang modes');
{
  const res = await page.evaluate(async () => {
    const out = {};
    for (const mode of ['grow', 'inset', 'clip']) {
      const host = document.createElement('div');
      host.style.cssText = 'width:240px;height:160px;position:relative';
      document.body.appendChild(host);
      const p = new window.PW.Paper(host, { preset: 'paper', overhang: mode, retain: true, lazy: false });
      await p.render();
      const hr = host.getBoundingClientRect();
      const cr = host.querySelector('[data-paperweb-canvas]').getBoundingClientRect();
      // How far the canvas sticks out past the element, per side.
      const stick = Math.max(hr.left - cr.left, cr.right - hr.right,
                             hr.top - cr.top, cr.bottom - hr.bottom);
      // How much of the canvas is void (mask ~ 0), i.e. room for a shadow, and
      // is the middle of the sheet solid?
      const { data, w, h } = p.floats('Alpha');
      const stride = data.length / (w * h);
      let voidPx = 0;
      for (let i = 0; i < w * h; i++) if (data[i * stride] < 0.05) voidPx++;
      const centre = data[(Math.floor(h / 2) * w + Math.floor(w / 2)) * stride];
      out[mode] = {
        stick: Math.round(stick),
        voidFrac: +(voidPx / (w * h)).toFixed(3),
        centre: +centre.toFixed(3),
        padding: getComputedStyle(host).paddingTop,
      };
      p.destroy();
      host.remove();
    }
    return out;
  });
  check("overhang 'grow' extends past the element so the shadow has void",
    res.grow.stick > 10 && res.grow.voidFrac > 0.1, JSON.stringify(res.grow));
  check("overhang 'inset' never extends past the element",
    res.inset.stick <= 0, JSON.stringify(res.inset));
  check("overhang 'inset' still leaves void for the cast shadow",
    res.inset.voidFrac > 0.1, JSON.stringify(res.inset));
  check("overhang 'inset' pads the element so content stays on the sheet",
    parseFloat(res.inset.padding) > 10, JSON.stringify(res.inset));
  check("overhang 'clip' never extends past the element",
    res.clip.stick <= 0, JSON.stringify(res.clip));
  // 'clip' still keeps the wobbly silhouette, so a thin void band survives at
  // the very edge. That is wanted: the alternative is a hard rectangle. What
  // must hold is that the sheet fills the box, leaving no room for a shadow.
  check("overhang 'clip' fills the element, leaving only a thin edge band",
    res.clip.voidFrac < 0.08 && res.clip.voidFrac < res.grow.voidFrac / 3,
    `clip=${JSON.stringify(res.clip)} grow=${JSON.stringify(res.grow)}`);
  check("overhang 'clip' leaves the middle of the sheet solid",
    res.clip.centre > 0.99, JSON.stringify(res.clip));
}

// --- invariant 12d: surfaces do not all look the same ------------------------
// paperlab is a single-sheet inspector, so every stochastic layer carries a
// hard-coded constant seed. Rendering many sheets from those constants gives a
// page where every card is the same piece of paper. Two ways it showed:
//
//   - folds are positioned in SHEET-RELATIVE coordinates (p0 is a fraction of
//     the sheet), so the identical crease layout landed on every sheet at every
//     size: measured ridge at height fraction 0.50 / 0.52 / 0.50 / 0.56 across
//     four different sizes, and four presets all shipped folds.seed = 3.
//   - every other layer is positioned in absolute mm, so any two sheets of the
//     same size were pixel-identical.
//
// Each surface now gets its own seed, which must be deterministic (so a reload
// or a re-render reproduces the same sheet) but distinct per instance.
console.log('\nevery surface is its own piece of paper');
{
  const res = await page.evaluate(async () => {
    const sig = async (opts, w, h) => {
      const el = document.createElement('div');
      el.style.cssText = `width:${w}px;height:${h}px;position:relative`;
      document.body.appendChild(el);
      const pp = new window.PW.Paper(el, { retain: true, lazy: false, ...opts });
      await pp.render();
      const { data, w: bw, h: bh } = pp.floats('Height');
      const stride = data.length / (bw * bh);
      const out = [];
      for (let i = 0; i < 96; i++) {
        out.push(Math.round(data[Math.floor((i / 96) * bw * bh) * stride] * 100) / 100);
      }
      pp.destroy(); el.remove();
      return out.join(',');
    };
    const auto1 = await sig({ preset: 'worn' }, 320, 220);
    const auto2 = await sig({ preset: 'worn' }, 320, 220);
    const pin1 = await sig({ preset: 'worn', seed: 41 }, 320, 220);
    const pin2 = await sig({ preset: 'worn', seed: 41 }, 320, 220);
    const pin3 = await sig({ preset: 'worn', seed: 42 }, 320, 220);
    // Folds specifically: where does the ridge sit down the left edge?
    const ridge = async (seed) => {
      const el = document.createElement('div');
      el.style.cssText = 'width:420px;height:300px;position:relative';
      document.body.appendChild(el);
      const pp = new window.PW.Paper(el, {
        retain: true, lazy: false, seed,
        // chance pinned to 1 so every seed definitely has folds; this probe is
        // about WHERE they land, and rarity is asserted separately below.
        params: { cockle: { enabled: false }, crumple: { enabled: false },
                  folds: { enabled: true, count: 3, chance: 1.0, depth: 1.2,
                           sharpness: 0.6, seed: 3 } },
      });
      await pp.render();
      const { data, w: bw, h: bh } = pp.floats('Height');
      const stride = data.length / (bw * bh);
      // ABSOLUTE height, and a column a quarter of the way in rather than the
      // far edge. A fold can be a valley as easily as a ridge, so signing the
      // test throws away half the draws, and folds are finite now so one need
      // not reach x = 4 at all.
      let best = -1, bestV = 8;
      const col = Math.floor(bw * 0.25);
      for (let y = 1; y < bh - 1; y++) {
        const v = Math.abs(data[(y * bw + col) * stride]);
        if (v > bestV) { bestV = v; best = y / bh; }
      }
      pp.destroy(); el.remove();
      return best < 0 ? null : +best.toFixed(3);
    };
    const ridges = [];
    // More seeds than before: creases are rare now, so some sheets legitimately
    // have none and a four-sample probe can come back mostly empty.
    for (let s = 0; s < 8; s++) ridges.push(await ridge(s));
    return { auto1, auto2, pin1, pin2, pin3, ridges };
  });

  check('two surfaces with the same preset and size are NOT identical',
    res.auto1 !== res.auto2, 'both instances produced the same height field');
  check('an explicitly pinned seed is reproducible',
    res.pin1 === res.pin2, 'seed 41 gave two different fields');
  check('a different pinned seed gives a different sheet',
    res.pin1 !== res.pin3, 'seeds 41 and 42 gave the same field');
  const found = res.ridges.filter((r) => r !== null);
  const uniq = new Set(found);
  check('some seeds put a crease in this column at all',
    found.length >= 3, `only ${found.length} of 8 seeds: ${JSON.stringify(res.ridges)}`);
  // The bug this guards: paperlab places folds in sheet-relative coordinates, so
  // the same crease landed at height fraction ~0.50 on every sheet at every size.
  check('the fold layout differs between surfaces instead of landing mid-sheet every time',
    uniq.size >= 3, `ridge height fractions: ${JSON.stringify(res.ridges)}`);
}

// --- invariant 12d2: folds are rare, finite and mostly horizontal -------------
// paperlab draws exactly `count` folds on every sheet, each an infinite line at
// a uniformly random angle. That makes a page of sheets look stamped from one
// die: same number of creases, same edge-to-edge runs, no preferred direction.
// A sheet is folded across its width far more often than on a diagonal, and a
// crease near the left or right edge is usually a side turned in.
console.log('\nfolds are rare, finite and biased horizontal');
{
  const res = await page.evaluate(async () => {
    const measure = async (seed, chance) => {
      const el = document.createElement('div');
      el.style.cssText = 'width:520px;height:360px;position:relative';
      document.body.appendChild(el);
      const pp = new window.PW.Paper(el, {
        retain: true, lazy: false, seed,
        params: { cockle: { enabled: false }, crumple: { enabled: false },
                  folds: { enabled: true, count: 4, chance, depth: 1.4, seed: 3 } },
      });
      await pp.render();
      const { data, w, h } = pp.floats('Height');
      const st = data.length / (w * h);
      const at = (x, y) => data[(y * w + x) * st];
      let peak = 0, covered = 0, gx = 0, gy = 0;
      // Gradient orientation, not coverage. A horizontal crease is a step in y,
      // so it puts its energy in dh/dy. Coverage sounds equivalent but is not:
      // a single vertical crease marks every row and swamps the average, so one
      // fold in six decides the answer.
      for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
        const v = Math.abs(at(x, y));
        if (v > peak) peak = v;
        if (v > 6) covered++;
        gx += Math.abs(at(x + 1, y) - at(x - 1, y));
        gy += Math.abs(at(x, y + 1) - at(x, y - 1));
      }
      const cols = new Set();
      for (let x = 0; x < w; x++) {
        for (let y = 0; y < h; y++) if (Math.abs(at(x, y)) > 6) { cols.add(x); break; }
      }
      pp.destroy(); el.remove();
      return { peak: +peak.toFixed(1), coverage: +(100 * covered / (w * h)).toFixed(1),
               gx, gy, cols: cols.size / w };
    };
    const rare = [], always = [];
    for (let s = 0; s < 10; s++) rare.push(await measure(s, 0.35));
    for (let s = 0; s < 6; s++) always.push(await measure(s, 1.0));
    return { rare, always };
  });

  const bare = res.rare.filter((r) => r.peak < 6).length;
  check('at a low chance, some sheets get no fold at all',
    bare >= 1, `${bare} of 10 sheets were unfolded (peaks: ${res.rare.map((r) => r.peak).join(', ')})`);
  check('at a low chance, some sheets DO get folds',
    res.rare.filter((r) => r.peak >= 6).length >= 2,
    `only ${res.rare.filter((r) => r.peak >= 6).length} of 10 had any`);

  // A fold that runs edge to edge marks every column. Finite ones do not.
  const folded = res.always.filter((r) => r.peak >= 6);
  check('creases do not always run the full width',
    folded.some((r) => r.cols < 0.97), `column coverage: ${folded.map((r) => r.cols.toFixed(2)).join(', ')}`);

  // Horizontal bias: summed across seeds so no single draw decides it. A level
  // crease is a step in y, so dh/dy should carry more energy than dh/dx.
  const GX = folded.reduce((s, r) => s + r.gx, 0);
  const GY = folded.reduce((s, r) => s + r.gy, 0);
  check('creases are biased toward horizontal rather than uniformly angled',
    GY > GX * 1.15,
    `vertical gradient energy ${(GY / GX).toFixed(2)}x horizontal (1.0 would be no bias)`);
}

// --- invariant 12e: the noise must not tile ----------------------------------
// paperlab's float hash,
//     p = fract(p * vec2(123.34, 345.45)); ... fract(p.x * p.y)
// is EXACTLY periodic on the integer lattice: 123.34 x 50 and 345.45 x 20 are
// both whole numbers, so hash21(x, y) == hash21(x+50, y) == hash21(x, y+20) at
// 100% of lattice points. Every value-noise field therefore repeats, and at the
// default formation scale of 2.5 mm that is a visible 472 x 189 canvas-pixel
// tile. A per-surface seed cannot fix this: offsetting inside a periodic field
// just picks a different phase of the same tile.
//
// This asserts the rendered field, not the hash, because the hash is an
// implementation detail and the tiling is what anyone actually sees.
console.log('\nthe noise field does not tile');
{
  const res = await page.evaluate(async () => {
    const el = document.createElement('div');
    el.style.cssText = 'width:1200px;height:800px;position:relative';
    document.body.appendChild(el);
    const pp = new window.PW.Paper(el, {
      retain: true, lazy: false, seed: 0,
      params: {
        cockle: { enabled: false }, folds: { enabled: false }, crumple: { enabled: false },
        fade: { enabled: false }, scratches: { enabled: false }, imperfect: { enabled: false },
        formation: { enabled: true, amplitude: 0.05, scale_mm: 2.5, source: 0 },
      },
    });
    await pp.render();
    const { data, w, h } = pp.floats('Albedo');
    const stride = data.length / (w * h);
    const at = (x, y) => data[(y * w + x) * stride] - 1;
    // Normalised autocorrelation. Lags below 16 px are ignored: a smooth field
    // is legitimately self-similar at short range, and that is not tiling.
    const worst = (axis, maxLag) => {
      let bestLag = 0, best = -1;
      for (let lag = 16; lag <= maxLag; lag++) {
        let sxy = 0, sxx = 0, syy = 0;
        if (axis === 'x') {
          for (let y = 8; y < h - 8; y += 4) for (let x = 4; x + lag < w - 4; x += 3) {
            const a = at(x, y), c = at(x + lag, y); sxy += a * c; sxx += a * a; syy += c * c;
          }
        } else {
          for (let x = 8; x < w - 8; x += 4) for (let y = 4; y + lag < h - 4; y += 3) {
            const a = at(x, y), c = at(x, y + lag); sxy += a * c; sxx += a * a; syy += c * c;
          }
        }
        const r = sxy / Math.sqrt(sxx * syy);
        if (r > best) { best = r; bestLag = lag; }
      }
      return { lag: bestLag, r: +best.toFixed(3) };
    };
    const out = { x: worst('x', Math.min(560, w - 12)), y: worst('y', Math.min(360, h - 12)) };
    pp.destroy(); el.remove();
    return out;
  });
  // A non-repeating field decorrelates: beyond a few cells there should be no
  // strong self-similarity at any lag. 0.35 is well clear of the ~0.67 the
  // periodic hash produced and well above the noise floor of an aperiodic one.
  check('no strong horizontal repeat at any lag',
    res.x.r < 0.35, `peak r=${res.x.r} at lag ${res.x.lag}px (half-res)`);
  check('no strong vertical repeat at any lag',
    res.y.r < 0.35, `peak r=${res.y.r} at lag ${res.y.lag}px (half-res)`);
}

// --- invariant 12f: formation.skew actually skews ----------------------------
// Real paper's albedo histogram has a longer DARK tail: fibre flocs read darker
// than the gaps between them read light. paperlab's skew term is
//     f += skew * (f * abs(f) - 0.15)
// and f * abs(f) is an ODD function, so with a negative coefficient it shrinks
// both tails equally. That is contrast compression, not skew: measured histogram
// skew was 0.0102 at skew=0 and 0.0103 at skew=-1.0 while sd collapsed from
// 9.58e-3 to 8.18e-3. The knob only ever removed contrast.
console.log('\nformation.skew produces an actually skewed histogram');
{
  const res = await page.evaluate(async () => {
    const measure = async (skew) => {
      const el = document.createElement('div');
      el.style.cssText = 'width:800px;height:600px;position:relative';
      document.body.appendChild(el);
      const pp = new window.PW.Paper(el, {
        retain: true, lazy: false, seed: 0,
        params: {
          cockle: { enabled: false }, folds: { enabled: false }, crumple: { enabled: false },
          fade: { enabled: false }, scratches: { enabled: false }, imperfect: { enabled: false },
          formation: { enabled: true, amplitude: 0.05, scale_mm: 2.5, skew, source: 0 },
        },
      });
      await pp.render();
      const { data, w, h } = pp.floats('Albedo');
      const st = data.length / (w * h);
      const n = w * h;
      let sum = 0;
      for (let i = 0; i < n; i++) sum += data[i * st];
      const mu = sum / n;
      let m2 = 0, m3 = 0;
      for (let i = 0; i < n; i++) { const d = data[i * st] - mu; m2 += d * d; m3 += d * d * d; }
      m2 /= n; m3 /= n;
      pp.destroy(); el.remove();
      return { skewness: m3 / Math.pow(m2, 1.5), sd: Math.sqrt(m2) };
    };
    return { zero: await measure(0), neg: await measure(-0.3), strong: await measure(-1.0) };
  });

  check('with skew 0 the histogram is symmetric',
    Math.abs(res.zero.skewness) < 0.1, `skewness=${res.zero.skewness.toFixed(4)}`);
  check('the default skew of -0.3 produces a real dark tail',
    res.neg.skewness < -0.25, `skewness=${res.neg.skewness.toFixed(4)} (was 0.0102 when broken)`);
  check('a stronger negative skew produces a longer dark tail',
    res.strong.skewness < res.neg.skewness - 0.3,
    `-1.0 gave ${res.strong.skewness.toFixed(4)}, -0.3 gave ${res.neg.skewness.toFixed(4)}`);
  // The old term's real effect was to eat contrast. The fix must not do that.
  check('skewing does not collapse contrast the way the odd term did',
    res.neg.sd > res.zero.sd * 0.95,
    `sd ${(res.neg.sd * 1e3).toFixed(2)}e-3 vs ${(res.zero.sd * 1e3).toFixed(2)}e-3 at skew 0`);
}

// --- invariant 13: teardown restores the DOM ---------------------------------
console.log('\ndestroy() restores the element');
{
  const after = await page.evaluate(() => {
    const el = document.getElementById('a');
    const before = { position: el.style.position, isolation: el.style.isolation };
    window.p.destroy();
    return {
      before,
      canvases: document.querySelectorAll('[data-paperweb-canvas]').length,
      isolation: el.style.isolation,
      bodyVisible: getComputedStyle(document.getElementById('body')).visibility,
    };
  });
  check('the canvas is removed', after.canvases === 0, `count=${after.canvases}`);
  check('the isolation override is reverted', after.isolation === '', `"${after.isolation}"`);
  check('element content is visible again', after.bodyVisible === 'visible', after.bodyVisible);
}

// --- every preset renders without error --------------------------------------
console.log('\nevery preset renders');
{
  const results = await page.evaluate(async () => {
    const out = [];
    for (const name of window.PW.presetNames) {
      const el = document.getElementById('a');
      const errs = [];
      let p = null;
      try {
        p = new window.PW.Paper(el, { preset: name, retain: true, lazy: false, onError: (m) => errs.push(m) });
        await p.render();
        const c = document.querySelector('[data-paperweb-canvas]');
        const d = c.getContext('2d').getImageData(Math.floor(c.width / 2), Math.floor(c.height / 2), 1, 1).data;
        out.push({ name, errs, px: [d[0], d[1], d[2], d[3]] });
      } catch (e) {
        out.push({ name, errs: [...errs, String(e && e.message)], px: null });
      } finally {
        if (p) p.destroy();
      }
    }
    return out;
  });
  for (const r of results) {
    check(`preset "${r.name}" renders an opaque sheet`,
      r.errs.length === 0 && r.px && r.px[3] > 250 && r.px[0] > 150,
      `errs=${JSON.stringify(r.errs)} px=${JSON.stringify(r.px)}`);
  }
}

// --- stains -------------------------------------------------------------------
// The whole Deegan claim is that a dried drop is a dark RING with a PALE
// INTERIOR, not a soft disc. If the ring is not measurably darker than the
// middle, the layer is wrong no matter how it looks.
console.log('\nstains');
{
  const res = await page.evaluate(async () => {
    // Radial profile of a single centred stain, in both albedo and height.
    const profile = async (enabled) => {
      const el = document.createElement('div');
      el.style.cssText = 'width:400px;height:400px;position:relative';
      document.body.appendChild(el);
      const pp = new window.PW.Paper(el, {
        retain: true, lazy: false, seed: 7,
        params: {
          // Every other source of variation off, so anything we measure is the
          // stain and not formation noise sitting on top of it.
          formation: { enabled: false }, fade: { enabled: false },
          mould: { enabled: false }, scratches: { enabled: false },
          imperfect: { enabled: false }, foxing: { enabled: false },
          cockle: { enabled: false }, folds: { enabled: false },
          crumple: { enabled: false },
          stains: {
            enabled, amount: 1, relief_um: 9, seed: 2,
            marks: [{ x: 0.5, y: 0.5, r_mm: 20, strength: 0.7, kind: 'ring' }],
          },
        },
      });
      await pp.render();
      const rd = (name, ch) => {
        const { data, w, h } = pp.floats(name);
        const stride = data.length / (w * h);
        // Mean over a ring at radius t*R, in the same mm units the shader used.
        return (t) => {
          // The canvas is GROWN past the element to fit the deckle and shadow,
          // so the buffer does not span 400 px and the sheet is not centred in
          // it by assumption. Both the centre and the scale come from the
          // reported sheet rect, in the same buffer pixels the data is in.
          const gm = pp.geometry();
          const s = gm.sheet;                     // canvas px [x0,y0,x1,y1]
          const k = w / gm.canvas.w;              // canvas px -> buffer px
          const pxmm = window.PW.defaults().page.dpi / 25.4;
          const cx = ((s[0] + s[2]) / 2) * k, cy = ((s[1] + s[3]) / 2) * k;
          const rpx = t * 20 * pxmm * k;
          let sum = 0, n = 0;
          for (let a = 0; a < 64; a++) {
            const th = (a / 64) * Math.PI * 2;
            const x = Math.round(cx + Math.cos(th) * rpx);
            const y = Math.round(cy + Math.sin(th) * rpx);
            if (x < 0 || y < 0 || x >= w || y >= h) continue;
            sum += data[(y * w + x) * stride + ch]; n++;
          }
          return n ? sum / n : NaN;
        };
      };
      const alb = rd('Albedo', 0);
      const albB = rd('Albedo', 2);
      const hgt = rd('Height', 0);
      const out = {
        alb: { centre: alb(0.0), mid: alb(0.5), rim: alb(0.97), outside: alb(1.6) },
        blue: { centre: albB(0.0), rim: albB(0.97) },
        h: { centre: hgt(0.0), rim: hgt(0.97) },
      };
      pp.destroy(); el.remove();
      return out;
    };
    return { on: await profile(true), off: await profile(false) };
  });

  const { on, off } = res;
  // POSITIVE CONTROL FIRST: with the layer off the profile must be flat, which
  // proves the probe is reading the stain and not some pre-existing gradient.
  const flat = Math.abs(off.alb.rim - off.alb.mid) < 1e-3
    && Math.abs(off.h.rim - off.h.centre) < 1e-3;
  check('control: with stains off the radial profile is flat', flat,
    `off albedo mid=${off.alb.mid.toFixed(4)} rim=${off.alb.rim.toFixed(4)} `
    + `height centre=${off.h.centre.toFixed(3)} rim=${off.h.rim.toFixed(3)}`);

  check('the ring is darker than the interior (Deegan)', on.alb.rim < on.alb.mid - 0.01,
    `rim=${on.alb.rim.toFixed(4)} mid=${on.alb.mid.toFixed(4)}`);
  check('the interior is paler than the ring but darker than clean paper',
    on.alb.mid < on.alb.outside - 1e-3 && on.alb.mid > on.alb.rim,
    `mid=${on.alb.mid.toFixed(4)} outside=${on.alb.outside.toFixed(4)}`);
  check('the stain is coloured, not grey: blue absorbs harder than red',
    on.blue.rim < on.alb.rim - 5e-3,
    `red=${on.alb.rim.toFixed(4)} blue=${on.blue.rim.toFixed(4)}`);
  check('fibre swelling raises the rim above the dished centre',
    on.h.rim > on.h.centre + 0.5,
    `centre=${on.h.centre.toFixed(3)}um rim=${on.h.rim.toFixed(3)}um`);
}

// --- stamps -------------------------------------------------------------------
// The claim worth testing is not "the die appears". It is that a stamp inks
// where the paper is HIGH: the crests reach the rubber first, so the impression
// skips in the hollows. That is what separates a pressed stamp from a pasted
// one, and it is a correlation, so it has to be measured.
//
// Measured as a DIFFERENCE between two runs that vary only in `contact`. The
// impression carries the sheet's own shading, and shading correlates with the
// height field whether contact does anything or not, so correlating a single
// run against relief would score ~0.48 with the feature switched off. The
// difference cancels the shading and leaves the ink.
console.log('\nstamps');
{
  const res = await page.evaluate(async () => {
    const run = async (contact) => {
      const die = document.createElement('canvas');
      die.width = die.height = 128;
      const dc = die.getContext('2d');
      dc.fillStyle = '#fff'; dc.fillRect(0, 0, 128, 128);
      dc.fillStyle = '#000'; dc.beginPath();
      dc.arc(64, 64, 52, 0, Math.PI * 2); dc.fill();

      const el = document.createElement('div');
      el.style.cssText = 'width:360px;height:360px;position:relative';
      document.body.appendChild(el);
      const pp = new window.PW.Paper(el, {
        retain: true, lazy: false, seed: 11,
        params: {
          // Strong, purely relief-driven variation and nothing else, so nothing
          // in the albedo can produce the correlation.
          cockle: { enabled: true, amplitude_um: 34 },
          formation: { enabled: false }, fade: { enabled: false },
          mould: { enabled: false }, scratches: { enabled: false },
          imperfect: { enabled: false }, folds: { enabled: false },
          crumple: { enabled: false }, stains: { enabled: false },
          foxing: { enabled: false },
          stamp: {
            enabled: true, image: die, x: 0.5, y: 0.5, scale: 0.5,
            rotation_deg: 0, threshold: 0.5, pressure: 1, wear: 0,
            opacity: 1, reach_um: 12, contact,
          },
        },
      });
      await pp.render();
      const F = pp.floats('Final');
      const H = pp.floats('Height');
      const fs = F.data.length / (F.w * F.h);
      const hs = H.data.length / (H.w * H.h);
      const gm = pp.geometry();
      const [x0, y0, x1, y1] = gm.sheet;
      const k = F.w / gm.canvas.w;

      // Well inside the die, so its soft edge cannot dominate the statistic.
      const cx = ((x0 + x1) / 2) * k, cy = ((y0 + y1) / 2) * k;
      const rad = 0.5 * 0.5 * (x1 - x0) * k * 0.72;
      const lum = [], depth = [];
      for (let y = Math.floor(cy - rad); y < cy + rad; y++) {
        for (let x = Math.floor(cx - rad); x < cx + rad; x++) {
          if ((x - cx) ** 2 + (y - cy) ** 2 > rad * rad) continue;
          if (x < 0 || y < 0 || x >= F.w || y >= F.h) continue;
          lum.push(F.data[(y * F.w + x) * fs]);
          const hx = Math.min(H.w - 1, Math.round((x / F.w) * H.w));
          const hy = Math.min(H.h - 1, Math.round((y / F.h) * H.h));
          depth.push(Math.max(-H.data[(hy * H.w + hx) * hs], 0));  // um below plane
        }
      }
      pp.destroy(); el.remove();
      return { lum, depth };
    };
    const a = await run(0.9);
    const b = await run(0.0);
    const c = await run(0.0);        // identical to b: the null difference
    return { a, b, c };
  });

  const corr = (X, Y) => {
    const m = (v) => v.reduce((s, x) => s + x, 0) / v.length;
    const mx = m(X), my = m(Y);
    let n = 0, dx = 0, dy = 0;
    for (let i = 0; i < X.length; i++) {
      n += (X[i] - mx) * (Y[i] - my); dx += (X[i] - mx) ** 2; dy += (Y[i] - my) ** 2;
    }
    return n / Math.sqrt(Math.max(dx * dy, 1e-12));
  };
  const diff = (P, Q) => P.lum.map((v, i) => v - Q.lum[i]);
  const { a, b, c } = res;

  check('the stamp probe found die interior to measure', a.lum.length > 500,
    `n=${a.lum.length}`);
  // CONTROL: two identical runs must differ by nothing. This proves the
  // difference isolates the parameter and is not picking up render-to-render
  // noise, which is what would make the assertion below meaningless.
  const nullMax = Math.max(...diff(b, c).map(Math.abs));
  check('control: two runs with contact 0 are bit-identical', nullMax < 1e-6,
    `max |diff| = ${nullMax}`);

  const d = diff(a, b);
  const r = corr(d, a.depth);
  check('the ink removed by contact tracks how deep the paper sits', r > 0.5,
    `r=${r.toFixed(3)}`);
  // The area that lightens must be the area that sits below the sheet plane,
  // not some fraction chosen to make the test pass. Under this seed the die
  // happens to land on mostly-raised paper, so only ~12% of it is in a hollow;
  // tying the assertion to the geometry keeps it honest if the seed changes.
  const lifted = d.filter((v) => v > 1e-4).length / d.length;
  const inHollow = a.depth.filter((v) => v > 0).length / a.depth.length;
  check('exactly the part of the die over a hollow loses ink',
    Math.abs(lifted - inHollow) < 0.03 && lifted > 0.05,
    `lightened ${(lifted * 100).toFixed(1)}%, below the plane ${(inHollow * 100).toFixed(1)}%`);
  check('contact only ever removes ink, never adds it', d.every((v) => v > -1e-4),
    `min delta ${Math.min(...d).toExponential(1)}`);
}

// --- newsprint ------------------------------------------------------------------
// Three effects on the ink rather than the paper. Each one is asserted to
// change the composite when on AND to leave it bit-identical when off, because
// an effect that is silently inert looks exactly like an effect that is subtle.
console.log('\nnewsprint ink effects');
{
  const res = await page.evaluate(async () => {
    // Ink on the LEFT half only. Show-through mirrors in x, so the right half is
    // clean paper backing onto solid ink and is where show-through must appear.
    const art = document.createElement('canvas');
    art.width = art.height = 256;
    const ac = art.getContext('2d');
    ac.fillStyle = '#fff'; ac.fillRect(0, 0, 256, 256);
    ac.fillStyle = '#000'; ac.fillRect(24, 40, 84, 176);
    // A few thin strokes, which is what dot gain acts on.
    for (let i = 0; i < 6; i++) ac.fillRect(20, 20 + i * 38, 100, 3);

    const run = async (ink, extra = {}) => {
      const el = document.createElement('div');
      el.style.cssText = 'width:320px;height:320px;position:relative';
      document.body.appendChild(el);
      const pp = new window.PW.Paper(el, {
        retain: true, lazy: false, seed: 5, content: art,
        params: {
          formation: { enabled: false }, fade: { enabled: false },
          mould: { enabled: false }, scratches: { enabled: false },
          imperfect: { enabled: false }, stains: { enabled: false },
          foxing: { enabled: false }, cockle: { enabled: false },
          folds: { enabled: false }, crumple: { enabled: false },
          ...extra,
          ink: { show_through: 0, bleed_mm: 0, fold_crack: 0, ...ink },
        },
      });
      await pp.render();
      const F = pp.floats('Final');
      const st = F.data.length / (F.w * F.h);
      const gm = pp.geometry();
      const [x0, y0, x1, y1] = gm.sheet;
      const k = F.w / gm.canvas.w;
      let left = 0, right = 0, nl = 0, nr = 0, inked = 0, all = 0;
      for (let y = Math.ceil(y0 * k) + 2; y < y1 * k - 2; y++) {
        for (let x = Math.ceil(x0 * k) + 2; x < x1 * k - 2; x++) {
          const v = F.data[(y * F.w + x) * st];
          const u = (x / k - x0) / (x1 - x0);
          if (u < 0.45) { left += v; nl++; } else if (u > 0.55) { right += v; nr++; }
          all++; if (v < 0.55) inked++;
        }
      }
      pp.destroy(); el.remove();
      return { left: left / nl, right: right / nr, inkedFrac: inked / all };
    };

    return {
      base: await run({}),
      show: await run({ show_through: 0.09 }),
      bleed: await run({ bleed_mm: 0.35 }),
      crackOff: await run({ fold_crack: 0 }, { crumple: { enabled: true, amplitude_um: 60 } }),
      crackOn: await run({ fold_crack: 1 }, { crumple: { enabled: true, amplitude_um: 60 } }),
    };
  });

  const { base, show, bleed, crackOff, crackOn } = res;

  check('control: show-through off leaves the clean side untouched',
    Math.abs(base.right - 1.0) < 0.02, `right half mean ${base.right.toFixed(4)}`);
  check('show-through darkens the blank side, where the reverse type is',
    show.right < base.right - 0.005, `${base.right.toFixed(4)} -> ${show.right.toFixed(4)}`);
  check('show-through stays a suggestion, not readable type',
    show.right > base.right - 0.06, `drop ${(base.right - show.right).toFixed(4)}`);

  check('dot gain fattens the strokes', bleed.inkedFrac > base.inkedFrac + 0.004,
    `inked ${(base.inkedFrac * 100).toFixed(2)}% -> ${(bleed.inkedFrac * 100).toFixed(2)}%`);
  // Dilation must not invent ink. The blank half has nothing to wick from, so
  // if it darkens at all the effect is a blur rather than a dilation.
  check('control: dot gain does not create ink on the blank half',
    Math.abs(bleed.right - base.right) < 0.002,
    `blank half ${base.right.toFixed(4)} -> ${bleed.right.toFixed(4)}`);

  // Cracking removes ink, so the inked side gets LIGHTER. The control is the
  // same crumpled sheet with the effect off, so any difference is the flaking
  // and not the crease shading.
  check('ink cracks off where a crease crosses it', crackOn.left > crackOff.left + 0.002,
    `inked half ${crackOff.left.toFixed(4)} -> ${crackOn.left.toFixed(4)}`);
  check('cracking needs ink: it does not lighten the blank side',
    Math.abs(crackOn.right - crackOff.right) < 0.002,
    `blank half ${crackOff.right.toFixed(4)} -> ${crackOn.right.toFixed(4)}`);
}

// --- set({ preset }) ------------------------------------------------------------
// A preset is a whole tree, not a parameter, so merging it as one was a silent
// no-op: the studio's preset picker looked dead and threw no error. It must
// also REBUILD rather than layer, or the previous preset's layers stay on.
console.log('\nswitching preset at runtime');
{
  const res = await page.evaluate(async () => {
    const el = document.createElement('div');
    el.style.cssText = 'width:300px;height:300px;position:relative';
    document.body.appendChild(el);
    const pp = new window.PW.Paper(el, { preset: 'worn', retain: true, lazy: false });
    await pp.render();
    const stats = () => {
      const { data, w, h } = pp.floats('Height');
      const st = data.length / (w * h);
      let min = 1e9, max = -1e9;
      for (let i = 0; i < w * h; i++) {
        const v = data[i * st];
        if (v < min) min = v; if (v > max) max = v;
      }
      return +(max - min).toFixed(3);
    };
    const wornRange = stats();
    const wornFolds = pp.params.folds.enabled;
    const seed = pp.params.page.seed;

    pp.set({ preset: 'subtle' });
    await pp.render();
    const subtleRange = stats();
    const out = {
      wornRange, subtleRange, wornFolds,
      subtleFolds: pp.params.folds.enabled,
      seedKept: pp.params.page.seed === seed,
      name: pp.params.cockle.amplitude_um,
    };
    pp.destroy(); el.remove();
    return out;
  });

  check('switching preset changes the render', res.wornRange !== res.subtleRange,
    `height range worn=${res.wornRange} subtle=${res.subtleRange}`);
  // The rebuild, not the merge: 'worn' turns folds on and 'subtle' does not
  // mention them, so a layered merge would leave them on.
  check('switching preset does not leave the old preset\'s layers on',
    res.wornFolds === true && res.subtleFolds === false,
    `folds worn=${res.wornFolds} subtle=${res.subtleFolds}`);
  check('switching preset keeps the surface its own sheet of paper', res.seedKept,
    'page.seed must survive, or every card reshuffles on a theme change');
}

// --- blocks -----------------------------------------------------------------
// The conversion from gallery to library is a mechanical transform over 52
// components, so the thing worth asserting is that it lost nothing: every block
// still mounts, still binds the same number of surfaces, and no longer carries
// the gallery chrome.
console.log('\nblock library');
{
  const summary = await page.evaluate(async () => {
    const { manifest } = await import('/src/blocks/paper-block.js');
    const base = await manifest();
    const host = document.createElement('div');
    host.style.cssText = 'width:520px';
    document.body.appendChild(host);

    const bad = [];
    let mounted = 0, surfaces = 0, converted = 0;
    for (const b of base.blocks) {
      const el = document.createElement('paper-block');
      el.setAttribute('type', b.id);
      host.appendChild(el);
      // Mounting is async: manifest fetch, stylesheet fetch, then scan().
      for (let i = 0; i < 120 && !el.block; i++) await new Promise((r) => setTimeout(r, 25));
      if (!el.block) { bad.push(`${b.id}: never mounted`); el.remove(); continue; }
      mounted++;
      const bound = el.shadowRoot.querySelectorAll('[data-paper]').length;
      surfaces += bound;
      if (b.family !== 'shapes') converted += bound;
      if (bound !== b.surfaces) bad.push(`${b.id}: ${bound} surfaces, manifest says ${b.surfaces}`);
      const html = el.shadowRoot.innerHTML;
      for (const [name, re] of [['heading', /class="[^"]*\b(?:bay|demo|sec)-head\b/],
        ['caption', /class="[^"]*\bcap\b/], ['index badge', /class="[^"]*\bidx\b/]]) {
        if (re.test(html)) bad.push(`${b.id}: ${name} chrome survived`);
      }
      el.remove();
    }
    host.remove();
    return { total: base.blocks.length, mounted, surfaces, converted, bad };
  });

  check('every block in the manifest mounts',
    summary.mounted === summary.total, `${summary.mounted}/${summary.total}`);
  check('conversion kept every surface and dropped every bit of chrome',
    summary.bad.length === 0, summary.bad.slice(0, 6).join('; '));
  // Parity is a claim about the CONVERSION, so it counts converted blocks only.
  // The hand-authored shapes were never in the gallery and would inflate it.
  check('the converted blocks bind every surface the gallery had',
    summary.converted === 68,
    `${summary.converted} converted surfaces (keep.html renders 68), `
    + `${summary.surfaces} including shapes`);
}

// --- block controls ----------------------------------------------------------
// Every control must move the render. The stamp studio shipped with eight dead
// sliders and no error, because nothing asserted that a control does anything;
// this is that assertion, and it runs over the whole schema rather than a
// sample of it.
console.log('\nblock controls');
{
  const res = await page.evaluate(async () => {
    const { manifest } = await import('/src/blocks/paper-block.js');
    const { CONTROLS } = await import('/src/blocks/controls.js');
    const base = await manifest();
    const target = base.blocks.find((b) => b.hasInk) || base.blocks[0];

    const host = document.createElement('div');
    host.style.cssText = 'width:520px';
    document.body.appendChild(host);
    const el = document.createElement('paper-block');
    el.setAttribute('type', target.id);
    host.appendChild(el);
    for (let i = 0; i < 160 && !el.block; i++) await new Promise((r) => setTimeout(r, 25));
    if (!el.block) return { error: 'block never mounted' };

    const settle = () => new Promise((r) => setTimeout(r, 260));
    const sig = () => {
      const c = el.shadowRoot.querySelector('canvas');
      if (!c) return 'nocanvas';
      const t = document.createElement('canvas');
      t.width = t.height = 72;
      t.getContext('2d').drawImage(c, 0, 0, 72, 72);
      const d = t.getContext('2d').getImageData(0, 0, 72, 72).data;
      let s = 0;
      for (let i = 0; i < d.length; i++) s += d[i] * ((i % 11) + 1);
      return s;
    };

    const VALUE = { stock: 'pronounced', paper: '#d8c49a', edge: 'torn',
      width: '300', rotate: '7', seed: '77', folds: '3',
      font: 'mono', ink: '#3a2a55', 'type-size': '22' };
    await settle();

    // Typography controls change the PRINTED TEXT, which is live DOM sitting on
    // top of the canvas, so sampling the canvas would call all three dead. Each
    // control is measured on the surface it actually acts on.
    const typeSig = () => {
      const t = el.shadowRoot.querySelector('h3, h2, .pp-headline, p');
      if (!t) return 'notext';
      const cs = getComputedStyle(t);
      return `${cs.fontFamily}|${cs.fontSize}|${cs.color}`;
    };

    let prev = sig(), prevType = typeSig();
    const dead = [], skipped = [];
    for (const c of CONTROLS) {
      if (c.needsContent && !target.hasInk) { skipped.push(c.name); continue; }
      // Typography reaches the shapes; converted blocks set their own type and
      // report these as unavailable. Asserted on a shape further down.
      if (c.css && target.family !== 'shapes') { skipped.push(c.name); continue; }
      el.setAttribute(c.name, VALUE[c.name] ?? '0.9');
      await settle();
      if (c.css) {
        const now = typeSig();
        if (now === prevType) dead.push(c.name);
        prevType = now;
      } else {
        const now = sig();
        if (now === prev) dead.push(c.name);
        prev = now;
      }
    }

    // Honesty: an ink control on a block with no ink must be REPORTED, not
    // silently accepted. Checked on a block that definitely has no ink.
    const plain = base.blocks.find((b) => !b.hasInk);
    const el2 = document.createElement('paper-block');
    el2.setAttribute('type', plain.id);
    host.appendChild(el2);
    for (let i = 0; i < 160 && !el2.block; i++) await new Promise((r) => setTimeout(r, 25));
    el2.setAttribute('fold-crack', '1');
    await settle();
    const reported = el2.unavailable;

    // Slots: setting one must change the rendered text.
    const withSlot = base.blocks.find((b) => b.slots.length);
    const el3 = document.createElement('paper-block');
    el3.setAttribute('type', withSlot.id);
    host.appendChild(el3);
    for (let i = 0; i < 160 && !el3.block; i++) await new Promise((r) => setTimeout(r, 25));
    const slot = withSlot.slots[0];
    const before = el3.shadowRoot.querySelectorAll(slot.tag)[slot.nth]?.textContent;
    el3.setSlot(slot.name, 'A DELIBERATELY DISTINCT STRING');
    await settle();
    const after = el3.shadowRoot.querySelectorAll(slot.tag)[slot.nth]?.textContent;

    // Typography, on the surface it is designed for.
    const shape = base.blocks.find((b) => b.family === 'shapes');
    const el4 = document.createElement('paper-block');
    el4.setAttribute('type', shape.id);
    host.appendChild(el4);
    for (let i = 0; i < 160 && !el4.block; i++) await new Promise((r) => setTimeout(r, 25));
    const shapeTypeSig = () => {
      const t = el4.shadowRoot.querySelector('.pp-headline');
      if (!t) return 'notext';
      const cs = getComputedStyle(t);
      return `${cs.fontFamily.split(',')[0]}|${cs.fontSize}|${cs.color}`;
    };
    const typeBefore = shapeTypeSig();
    el4.setAttribute('font', 'mono');
    el4.setAttribute('ink', '#3a2a55');
    el4.setAttribute('type-size', '22');
    await settle();
    const typeAfter = shapeTypeSig();

    host.remove();
    return { id: target.id, dead, skipped, reported, plainId: plain.id,
      slotBlock: withSlot.id, slotName: slot.name, before, after,
      shapeId: shape.id, typeBefore, typeAfter, typeMoved: typeBefore !== typeAfter };
  });

  check('the control probe found a block to drive', !res.error, res.error || '');
  check('every control in the schema changes the render', res.dead.length === 0,
    `dead on ${res.id}: ${res.dead.join(', ')}`);
  check('an ink control on an inkless block is reported, not silently accepted',
    res.reported && res.reported.includes('fold-crack'),
    `${res.plainId} reported ${JSON.stringify(res.reported)}`);
  check('typography controls change the type on a shape', res.typeMoved,
    `${res.shapeId}: ${res.typeBefore} -> ${res.typeAfter}`);
  check('setting a slot changes the rendered text',
    res.after === 'A DELIBERATELY DISTINCT STRING' && res.before !== res.after,
    `${res.slotBlock}.${res.slotName}: "${res.before}" -> "${res.after}"`);
}

// --- block geometry ------------------------------------------------------------
// The blocks were authored at fixed pixel widths for a gallery. Dropping one
// into a narrow column must not push a horizontal scrollbar onto the page,
// which is the failure mode that makes a component library unusable.
console.log('\nblock geometry');
{
  const res = await page.evaluate(async () => {
    const { manifest } = await import('/src/blocks/paper-block.js');
    const base = await manifest();
    const host = document.createElement('div');
    host.style.cssText = 'overflow:auto;margin:0';
    document.body.appendChild(host);

    // A spread across the four families rather than one convenient block.
    const picks = ['archive-02', 'broadsheet-01', 'desk-16', 'product-09']
      .filter((id) => base.blocks.some((b) => b.id === id));
    const out = [];
    for (const width of [280, 520, 900]) {
      host.style.width = `${width}px`;
      for (const id of picks) {
        const el = document.createElement('paper-block');
        el.setAttribute('type', id);
        el.setAttribute('width', String(width - 20));
        host.appendChild(el);
        for (let i = 0; i < 160 && !el.block; i++) await new Promise((r) => setTimeout(r, 25));
        await new Promise((r) => setTimeout(r, 200));
        const over = host.scrollWidth - host.clientWidth;
        if (over > 2) out.push(`${id} at ${width}px overflows by ${over}px`);
        el.remove();
      }
    }
    host.remove();
    return out;
  });
  check('blocks do not overflow the column they are dropped into',
    res.length === 0, res.slice(0, 4).join('; '));
}

// --- console hygiene ---------------------------------------------------------
console.log('\nconsole');
// The deliberate 404 from the rasterize-failure test is expected; anything else
// is a real problem.
const unexpected = consoleErrors.filter((e) => !e.includes('no-such-image'));
check('no unexpected page errors during the run', unexpected.length === 0,
  unexpected.join('\n       '));

// --- report ------------------------------------------------------------------
await browser.close();
server.close();

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) {
  console.log('\nfailures:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
