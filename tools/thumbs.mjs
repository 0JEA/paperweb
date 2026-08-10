// Generate gallery thumbnails for the news showcase pages.
//
//   node tools/thumbs.mjs
//
// Real GPU, same reason as checkpage.mjs: SwiftShader does not reproduce the
// relief texture, so a thumbnail rendered on it would misrepresent the page.

import { chromium } from 'playwright-core';
import { serve } from './serve.mjs';
import { mkdir, readdir } from 'node:fs/promises';

const DIR = 'demo/news';
const OUT = `${DIR}/thumbs`;
await mkdir(OUT, { recursive: true });

const files = (await readdir(DIR))
  .filter((f) => f.endsWith('.html') && f !== 'index.html' && f !== 'smoke.html');

if (!files.length) { console.log('no showcase pages yet'); process.exit(0); }

const { server, url } = await serve(0);
const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=vulkan', '--enable-features=Vulkan'],
});

for (const file of files) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  try {
    await page.goto(`${url}/${DIR}/${file}`, { waitUntil: 'networkidle' });
    // Nudge the scroll so lazy surfaces near the top render, then come back.
    await page.evaluate(async () => {
      for (let y = 0; y < 1400; y += 400) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 110)); }
      window.scrollTo(0, 0);
    });
    await page.waitForTimeout(6000);
    await page.screenshot({ path: `${OUT}/${file.replace('.html', '.png')}`, clip: { x: 0, y: 0, width: 1440, height: 900 } });
    console.log('  thumb', file);
  } catch (e) {
    console.log('  FAILED', file, e.message.split('\n')[0]);
  }
  await page.close();
}

await browser.close();
server.close();
