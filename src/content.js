// The content layer: turning "what the element contains" into the `u_content`
// texture the composite reads as "1 paper, 0 ink".
//
// This is the part of the port with no counterpart in paperlab. paperlab's
// content is a rasterised document it loaded from disk. A web page's content is
// live DOM, which cannot be sampled by a shader, so there are three modes:
//
//   'behind'     a 1x1 white texture. No ink anywhere, so the composite reduces
//                to the lit paper substrate, and real DOM text sits on top of the
//                canvas. Selectable, accessible, and the default.
//
//   'rasterize'  snapshot the element's own subtree into an image and feed that
//                in, so Kubelka-Munk actually applies and the text sits INSIDE
//                the sheet. Opt-in, because DOM rasterisation is the least
//                reliable thing on this page (see below).
//
//   an image     an <img>, a <canvas>, or a URL, uploaded directly. The cheap and
//                reliable way to get real ink coupling.

import { gl } from './gl/context.js';
import { whiteTexture } from './pipeline.js';

/** Upload an ImageBitmap/HTMLImageElement/HTMLCanvasElement as a content texture. */
export function textureFromSource(src, existing = null) {
  const g = gl();
  const tex = existing || g.createTexture();
  g.bindTexture(g.TEXTURE_2D, tex);
  // The composite works in paperlab's top-left page origin and samples the
  // content at `vec2(puv.x, 1.0 - puv.y)`, so it expects the document's TOP row
  // at v = 1. An unflipped upload puts the source's top row at v = 0, which
  // renders the page upside down. UNPACK_FLIP_Y_WEBGL is the correction.
  g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL, true);
  g.pixelStorei(g.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, src);
  // Global unpack state: restore it so nothing else inherits the flip.
  g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL, false);
  g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR);
  g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
  g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
  g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
  return tex;
}

/** Load a URL into an image, same-origin-safe. */
export function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`paperweb: could not load content image ${url}`));
    img.src = url;
  });
}

// --- DOM rasterisation ------------------------------------------------------
//
// The mechanism is an SVG <foreignObject> wrapping a clone of the element, drawn
// into an <img> via a data: URL. It is the only way to get live DOM into a
// texture without a heavyweight dependency, and it comes with three hard
// constraints that this module handles rather than hopes about:
//
//   1. The clone is rendered by the SVG image loader in a separate document with
//      NO access to the page's stylesheets. Every style that matters must be
//      inlined onto the clone as an explicit style attribute.
//   2. External resources cannot be fetched from inside an SVG data: URL. Fonts
//      and images must already be data: URIs or they simply will not appear.
//   3. Any cross-origin image taints the canvas, and Safari has a long history of
//      dropping webfonts in foreignObject entirely.
//
// So the result is VALIDATED before it is used, and the caller falls back to
// 'behind' when validation fails. A degraded surface is a fine outcome; a blank
// element is not.

const INLINE_PROPS = [
  'color', 'background-color', 'background-image', 'background-size',
  'background-position', 'background-repeat',
  'font-family', 'font-size', 'font-weight', 'font-style', 'font-variant',
  'letter-spacing', 'word-spacing', 'line-height', 'text-align', 'text-decoration',
  'text-transform', 'text-indent', 'white-space', 'vertical-align',
  'display', 'position', 'top', 'right', 'bottom', 'left', 'float', 'clear',
  'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style',
  'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
  'border-radius', 'box-sizing', 'opacity', 'overflow',
  'flex-direction', 'flex-wrap', 'justify-content', 'align-items', 'align-content',
  'flex-grow', 'flex-shrink', 'flex-basis', 'gap', 'row-gap', 'column-gap',
  'grid-template-columns', 'grid-template-rows', 'grid-column', 'grid-row',
  'list-style-type', 'list-style-position',
];

/** Children that take part in the snapshot, in order. */
function snapshotChildren(node) {
  return Array.from(node.children).filter((c) => !c.hasAttribute('data-paperweb-canvas'));
}

function inlineStyles(source, clone) {
  const cs = getComputedStyle(source);
  let css = '';
  for (const prop of INLINE_PROPS) {
    const v = cs.getPropertyValue(prop);
    if (v) css += `${prop}:${v};`;
  }
  clone.setAttribute('style', css);
  // The two trees are walked in parallel by index, so both sides must filter the
  // same nodes. Filtering paperweb's own canvas out of BOTH makes the pairing
  // hold no matter when the canvas is actually removed from the clone. Getting
  // this wrong shifts every child onto its sibling's styles, which renders as a
  // page where headings look like body text and the last element loses its
  // styling entirely: wrong, but plausible enough to ship unnoticed.
  const sk = snapshotChildren(source);
  const ck = snapshotChildren(clone);
  for (let i = 0; i < sk.length && i < ck.length; i++) inlineStyles(sk[i], ck[i]);
}

/**
 * Rasterise an element's subtree.
 *
 * @param {HTMLElement} el
 * @param {number} w  CSS px
 * @param {number} h  CSS px
 * @param {number} scale  device pixel scale
 * @returns {Promise<HTMLCanvasElement>} an opaque-white-backed raster
 * @throws if the snapshot cannot be produced or fails validation
 */
export async function rasterize(el, w, h, scale) {
  if (w < 1 || h < 1) throw new Error('paperweb: cannot rasterize a zero-sized element');

  const clone = el.cloneNode(true);
  // Inline the styles FIRST, while the clone is still a structural mirror of the
  // source. inlineStyles walks the two trees in parallel by child index, so
  // removing anything from the clone beforehand shifts every subsequent child
  // onto its sibling's styles: headings render as body text, tags as headings,
  // and the last child silently loses its styling altogether.
  inlineStyles(el, clone);
  // Only now drop the canvas paperweb itself inserted, which must not be
  // snapshotted back into the content and fed to the surface a frame late.
  for (const c of clone.querySelectorAll('[data-paperweb-canvas]')) c.remove();
  // The clone is positioned by the foreignObject, not by the page.
  clone.style.position = 'static';
  clone.style.margin = '0';
  clone.style.width = `${w}px`;
  clone.style.height = `${h}px`;
  clone.style.visibility = 'visible';

  const xhtml = new XMLSerializer().serializeToString(clone);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<foreignObject width="100%" height="100%">` +
    `<div xmlns="http://www.w3.org/1999/xhtml" style="width:${w}px;height:${h}px">${xhtml}</div>` +
    `</foreignObject></svg>`;

  // encodeURIComponent rather than btoa: the subtree can contain any Unicode and
  // btoa throws on anything outside Latin-1.
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error('paperweb: foreignObject snapshot failed to load'));
    i.src = url;
    // Safari occasionally resolves neither handler. A timeout turns a hang into
    // a clean fallback.
    setTimeout(() => reject(new Error('paperweb: foreignObject snapshot timed out')), 3000);
  });

  const cw = Math.max(1, Math.round(w * scale));
  const ch = Math.max(1, Math.round(h * scale));
  const cv = document.createElement('canvas');
  cv.width = cw;
  cv.height = ch;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  // White ground: the composite treats content 1 as paper, so anywhere the
  // element is transparent must read as bare paper rather than solid ink.
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, cw, ch);
  ctx.drawImage(img, 0, 0, cw, ch);

  validateRaster(ctx, cw, ch);
  return cv;
}

/**
 * Reject a snapshot that is readable-but-useless. Two failure modes matter: the
 * canvas is tainted (getImageData throws), and the raster came back uniformly
 * blank because the fonts and styles did not survive. Both look like success to
 * the image loader.
 */
function validateRaster(ctx, w, h) {
  let data;
  try {
    data = ctx.getImageData(0, 0, w, h).data;
  } catch (e) {
    throw new Error('paperweb: snapshot canvas is tainted by a cross-origin resource');
  }
  // Sample a coarse grid rather than every pixel; this runs on the main thread.
  const step = Math.max(1, Math.floor(Math.min(w, h) / 64));
  let min = 255, max = 0;
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const v = data[(y * w + x) * 4];      // red channel is enough for a range test
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  if (max - min < 2) {
    throw new Error('paperweb: snapshot rasterised blank (styles or fonts did not survive)');
  }
}

// --- the content resolver ---------------------------------------------------

/**
 * Resolve a `content` option into a texture.
 *
 * Never throws. On any failure it returns the white texture and reports the
 * reason, so the caller can fall back to 'behind' and log rather than leaving the
 * element unrendered.
 *
 * @returns {Promise<{tex: WebGLTexture, hasAlpha: boolean, mode: string, error?: string}>}
 */
export async function resolveContent(mode, el, geom, existingTex) {
  if (!mode || mode === 'behind') {
    return { tex: whiteTexture(), hasAlpha: false, mode: 'behind' };
  }

  try {
    if (mode === 'rasterize') {
      const cv = await rasterize(el, geom.cssW, geom.cssH, geom.scale);
      return { tex: textureFromSource(cv, existingTex), hasAlpha: false, mode: 'rasterize' };
    }
    if (typeof mode === 'string') {
      const img = await loadImage(mode);
      return { tex: textureFromSource(img, existingTex), hasAlpha: false, mode: 'image' };
    }
    if (mode instanceof HTMLImageElement) {
      if (!mode.complete) await mode.decode();
      return { tex: textureFromSource(mode, existingTex), hasAlpha: true, mode: 'image' };
    }
    if (mode instanceof HTMLCanvasElement || (typeof OffscreenCanvas !== 'undefined' && mode instanceof OffscreenCanvas)) {
      return { tex: textureFromSource(mode, existingTex), hasAlpha: true, mode: 'canvas' };
    }
  } catch (e) {
    return {
      tex: whiteTexture(), hasAlpha: false, mode: 'behind',
      error: (e && e.message) || String(e),
    };
  }

  return {
    tex: whiteTexture(), hasAlpha: false, mode: 'behind',
    error: `paperweb: unrecognised content option ${String(mode)}`,
  };
}
