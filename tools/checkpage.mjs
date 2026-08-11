// Render a demo page on the REAL GPU and report anything wrong with it.
//
//   node tools/checkpage.mjs demo/news/whatever.html
//
// Uses ANGLE/Vulkan rather than SwiftShader on purpose: paperweb's relief
// texture is a shader-codegen artifact that SwiftShader does not reproduce, so a
// SwiftShader capture is not evidence of what the page looks like.

import { chromium } from 'playwright-core';
import { serve } from './serve.mjs';
import { SHOTS } from './shots.mjs';
import { basename, extname, join } from 'node:path';

const target = process.argv[2];
if (!target) {
  console.error('usage: node tools/checkpage.mjs <path-relative-to-repo-root>');
  process.exit(2);
}
const name = basename(target, extname(target));
const shot = join(SHOTS, `${name}.png`);

const { server, url } = await serve(0);
const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=vulkan', '--enable-features=Vulkan'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });

const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  const loc = m.location && m.location();
  errors.push(loc && loc.url ? `${m.text()} <- ${loc.url}` : m.text());
});

await page.goto(`${url}/${target.replace(/^\.?\//, '')}`, { waitUntil: 'networkidle' });

const renderer = await page.evaluate(() => {
  const g = document.createElement('canvas').getContext('webgl2');
  if (!g) return 'NO WEBGL2';
  const d = g.getExtension('WEBGL_debug_renderer_info');
  return d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER);
});

// Scroll the whole page so every lazy surface gets a chance to render.
await page.evaluate(async () => {
  const h = document.body.scrollHeight;
  for (let y = 0; y < h; y += 500) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 110)); }
  window.scrollTo(0, 0);
});
await page.waitForTimeout(7000);

const report = await page.evaluate(() => {
  const canvases = [...document.querySelectorAll('[data-paperweb-canvas]')];
  // A surface counts as rendered if its centre pixel is not transparent.
  let painted = 0, blank = 0;
  for (const c of canvases) {
    if (!c.width || !c.height) { blank++; continue; }
    try {
      const d = c.getContext('2d').getImageData(c.width >> 1, c.height >> 1, 1, 1).data;
      if (d[3] > 8) painted++; else blank++;
    } catch { blank++; }
  }
  const el = document.scrollingElement || document.documentElement;
  const before = el.scrollLeft;
  el.scrollLeft = 9999;
  const scrolled = el.scrollLeft;
  el.scrollLeft = before;

  // Anything sticking out past the viewport horizontally.
  const vw = document.documentElement.clientWidth;
  const overflowing = [...document.body.querySelectorAll('*')].filter((n) => {
    const r = n.getBoundingClientRect();
    return r.width > 0 && (r.right > vw + 2 || r.left < -2);
  }).slice(0, 6).map((n) => `${n.tagName.toLowerCase()}.${(n.className || '').toString().split(' ')[0]}`);

  // Text too small or too low contrast to read on cream.
  const tiny = [...document.body.querySelectorAll('p,li,td,span,figcaption')].filter((n) => {
    const s = getComputedStyle(n);
    return n.textContent.trim().length > 12 && parseFloat(s.fontSize) < 11;
  }).length;

  return {
    surfaces: canvases.length, painted, blank,
    scrollsSideways: scrolled > 0 ? scrolled : 0,
    overflowing, tiny,
    height: document.body.scrollHeight,
    headings: document.querySelectorAll('h1,h2,h3').length,
  };
});

await page.screenshot({ path: shot, fullPage: true });
await browser.close();
server.close();

const ok = (c) => (c ? '  ok  ' : ' FAIL ');
console.log(`\n${target}`);
console.log(`  renderer        ${renderer.slice(0, 70)}`);
console.log(`  page height     ${report.height}px, ${report.headings} headings`);
console.log(`${ok(report.surfaces > 0)} surfaces       ${report.surfaces} bound, ${report.painted} painted, ${report.blank} blank`);
console.log(`${ok(report.blank === 0)} none blank     ${report.blank} surfaces rendered nothing`);
console.log(`${ok(!report.scrollsSideways)} no h-scroll    ${report.scrollsSideways || 'none'}`);
console.log(`${ok(report.overflowing.length === 0)} in viewport    ${report.overflowing.join(', ') || 'all inside'}`);
console.log(`${ok(report.tiny === 0)} legible text   ${report.tiny} blocks under 11px`);
console.log(`${ok(errors.length === 0)} console clean  ${errors.length ? errors.slice(0, 4).join(' | ') : 'no errors'}`);
console.log(`  screenshot      ${shot}`);

const failed = report.surfaces === 0 || report.blank > 0 || report.scrollsSideways
  || report.overflowing.length || report.tiny || errors.length;
process.exit(failed ? 1 : 0);
