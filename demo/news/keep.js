// Mount the approved components, each in its own shadow root.
//
// The four showcase pages were written independently and their CSS collides on
// generic names (.sheet, .demo, .tag, .grid). The first attempt scoped all four
// stylesheets by prefixing every selector, and it silently dropped rules: the
// archive components rendered near-white ink on cream paper because the rules
// defining the ink never survived the rewrite. A CSS rewriter has to be right
// about at-rules, custom properties, inheritance and specificity at once, and
// being wrong is invisible until you look at a render.
//
// A shadow root needs none of that. Each page's CSS goes in unmodified except
// for mapping html/body/:root onto :host, and nothing leaks either way.
// paperweb binds inside because scan() takes a root and a ShadowRoot supports
// querySelectorAll.

import { scan } from '../../src/index.js';

const DATA = JSON.parse(document.getElementById('keep-data').textContent);
const LABEL = {
  archive: 'The Archive', broadsheet: 'The Broadsheet',
  desk: 'The Desk', product: 'The Product',
};

for (const [key, { css, components }] of Object.entries(DATA)) {
  const grid = document.querySelector(`.keeps[data-src="${key}"]`);
  if (!grid) continue;

  for (const c of components) {
    const art = document.createElement('article');
    art.className = 'keep';
    art.id = `${key}-${c.n}`;

    const head = document.createElement('header');
    head.className = 'keep-head';
    const src = document.createElement('span');
    src.className = 'keep-src';
    src.textContent = LABEL[key] || key;
    const num = document.createElement('span');
    num.className = 'keep-n';
    num.textContent = c.n;
    const h3 = document.createElement('h3');
    h3.textContent = c.title;
    head.append(src, num, h3);

    const holder = document.createElement('div');
    holder.className = 'keep-body';
    const shadow = holder.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = css;
    const mount = document.createElement('div');
    mount.innerHTML = c.html;
    shadow.append(style, mount);

    art.append(head, holder);
    grid.appendChild(art);
    scan(shadow);
  }
}
