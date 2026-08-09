// Render every surface on the demo page individually, at its real size, so the
// one carrying the reported artifact can be identified rather than guessed at.
import { chromium } from 'playwright-core';
import { serve } from './serve.mjs';
import { writeFile } from 'node:fs/promises';
const { server, url } = await serve(0);
const b = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader'] });
const p = await b.newPage({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 1 });
p.on('pageerror', e => console.log('PAGEERROR', e.message));
await p.goto(`${url}/demo/`, { waitUntil: 'networkidle' });
// Scroll the whole page so every lazy surface renders.
await p.evaluate(async () => {
  for (let y = 0; y < document.body.scrollHeight; y += 400) {
    window.scrollTo(0, y); await new Promise(r => setTimeout(r, 90));
  }
  window.scrollTo(0, 0);
});
await p.waitForTimeout(6000);

const items = await p.evaluate(() =>
  [...document.querySelectorAll('.pickwrap')].map((w, i) => {
    const name = w.querySelector('.pick-name')?.textContent || `surface ${i}`;
    const el = w.querySelector('[data-paperweb-canvas]')?.parentElement;
    const r = el?.getBoundingClientRect();
    if (el) el.setAttribute('data-atlas', String(i));
    return { i, name, w: Math.round(r?.width || 0), h: Math.round(r?.height || 0) };
  }));

const rows = [];
for (const it of items) {
  const el = await p.$(`[data-atlas="${it.i}"]`);
  if (!el) continue;
  await el.scrollIntoViewIfNeeded();
  await p.waitForTimeout(120);
  const file = `s${String(it.i).padStart(2,'0')}.png`;
  try { await el.screenshot({ path: `demo/atlas/${file}` }); rows.push({ ...it, file }); }
  catch (e) { console.log('skip', it.name, e.message); }
}
await writeFile('demo/atlas/index.json', JSON.stringify(rows, null, 1));
console.log(`captured ${rows.length} surfaces`);
await b.close(); server.close();
