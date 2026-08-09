import { chromium } from 'playwright-core';
const flagsets = {
  'swiftshader': ['--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader'],
  'angle-vulkan': ['--use-gl=angle','--use-angle=vulkan','--enable-features=Vulkan'],
  'angle-gl':     ['--use-gl=angle','--use-angle=gl'],
  'egl':          ['--use-gl=egl'],
  'desktop-gl':   ['--use-gl=desktop'],
};
for (const [name, args] of Object.entries(flagsets)) {
  try {
    const b = await chromium.launch({ headless: true, args });
    const p = await b.newPage();
    const info = await p.evaluate(() => {
      const c = document.createElement('canvas');
      const g = c.getContext('webgl2');
      if (!g) return { ok: false };
      const dbg = g.getExtension('WEBGL_debug_renderer_info');
      return { ok: true,
        renderer: dbg ? g.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER),
        vendor: dbg ? g.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : g.getParameter(g.VENDOR),
        float: !!g.getExtension('EXT_color_buffer_float') };
    });
    console.log(name.padEnd(14), info.ok ? `${info.renderer} | float:${info.float}` : 'no webgl2');
    await b.close();
  } catch (e) { console.log(name.padEnd(14), 'launch failed:', e.message.split('\n')[0]); }
}
