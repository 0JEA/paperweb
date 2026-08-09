import { chromium } from 'playwright-core';
import { serve } from './serve.mjs';
const { server, url } = await serve(0);
const b = await chromium.launch({ headless: true, args: ['--use-gl=angle','--use-angle=vulkan','--enable-features=Vulkan'] });
const p = await b.newPage({ viewport: { width: 1300, height: 500 } });
p.on('pageerror', e => console.log('PAGEERROR', e.message));
await p.goto(`${url}/test/browser/fixture.html`);
await p.waitForFunction('window.ready === true');
for (const [tag, facet, scale] of [['match-0.70',0.70,7],['0.6',0.6,7],['0.8',0.8,7]]) {
  const stats = await p.evaluate(async ([facet, scale]) => {
    document.body.innerHTML=''; document.body.style.cssText='margin:0;background:#17161a';
    const el=document.createElement('div'); el.id='h';
    el.style.cssText='width:1180px;height:340px;position:relative;margin:12px';
    document.body.appendChild(el);
    const pp=new window.PW.Paper(el,{preset:'reading',lazy:false,seed:0,retain:true,
      params:{cockle:{facet, facet_scale_mm:scale}}});
    await pp.render();
    const {data,w,h}=pp.floats('Shade'); const st=data.length/(w*h);
    let sharp=0,n=0;
    for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
      const g=Math.abs(data[(y*w+x+1)*st]-data[(y*w+x-1)*st])+Math.abs(data[((y+1)*w+x)*st]-data[((y-1)*w+x)*st]);
      if(g>0.02)sharp++; n++;}
    return +(100*sharp/n).toFixed(2);
  }, [facet, scale]);
  await p.waitForTimeout(1600);
  await (await p.$('#h')).screenshot({ path: `demo/facet/${tag}.png` });
  console.log('  facet', tag.padEnd(11), 'sharp-gradient', stats + '%   (old build was 14%)');
}
await b.close(); server.close();
