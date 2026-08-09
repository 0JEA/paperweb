// Paper: bind the pipeline to a DOM element.
//
// This is the layer with no counterpart in paperlab, which renders one sheet into
// one window. Here the sheet IS an element, so this module owns everything that
// makes that work: sizing against the element box and device pixel ratio,
// inserting a canvas without disturbing the element's own content, deferring the
// first render until the element is near the viewport, and handing the pipeline's
// targets back when the surface is static (which is the default).

import { capabilities, gl, sharedCanvas, ensureSize } from './gl/context.js';
import { Pipeline } from './pipeline.js';
import { resolve, merge, pxPerMm } from './params.js';
import { preset as lookupPreset } from './presets.js';
import { resolveContent } from './content.js';

const DEFAULTS = {
  preset: null,
  params: null,
  content: 'behind',
  // Which sheet of paper this is. Left unset, each instance gets the next one in
  // sequence. Pin it to reproduce a specific sheet.
  seed: null,
  // How the cast shadow gets room to fall.
  //
  //   'grow'  (default) the canvas extends past the element by the shadow
  //           margin. Correct rendering, but an absolutely-positioned box that
  //           sticks out past the element contributes to the ROOT scroller's
  //           overflow, so an element flush against the viewport edge makes the
  //           page scroll sideways. Pair with `html { overflow-x: clip }`
  //           (clip, not hidden: it does not create a scroll container and does
  //           not break position: sticky).
  //   'inset' the canvas matches the element exactly and the SHEET is inset
  //           within it, with matching padding added to the element so its
  //           content stays on the paper. No overflow, at the cost of a
  //           slightly smaller sheet and a reflow on bind.
  //   'clip'  the canvas matches the element exactly and the sheet fills it.
  //           No overflow and no cast shadow, since there is no void for one to
  //           fall on. The contact-darkened silhouette still reads.
  overhang: 'grow',
  dpi: null,            // overrides params.page.dpi when given
  maxDpr: 2,
  light: 'static',      // or 'pointer'
  watch: false,         // re-snapshot rasterized content on resize
  lazy: true,           // defer first render until near the viewport
  retain: false,        // keep GPU targets alive between renders
  onError: null,        // (message, paper) => void
};

/** Every live instance, so a page-wide teardown is possible. */
const live = new Set();

// Sheet counter. Deliberately a counter rather than Math.random(): a surface
// must look the same on every reload, or a screenshot test, a cached render and
// a server-rendered page would each disagree with the last. Binding order is
// stable for a given page, so the sequence is too. Anything that needs a
// guaranteed-stable identity across page edits should pass `seed` explicitly.
let seedCounter = 0;
function nextSeed() { return seedCounter++; }

/** Reset the sheet counter. Tests only. */
export function _resetSeedsForTests() { seedCounter = 0; }

export class Paper {
  /**
   * @param {HTMLElement} el
   * @param {object} [opts]
   */
  constructor(el, opts = {}) {
    if (!el || !el.nodeType) throw new Error('paperweb: Paper needs a DOM element');
    this.el = el;
    this.opts = { ...DEFAULTS, ...opts };

    let base = this.opts.preset ? lookupPreset(this.opts.preset) : {};
    if (this.opts.params) base = merge(base, this.opts.params);
    if (this.opts.dpi != null) base = merge(base, { page: { dpi: this.opts.dpi } });
    // Every surface gets its own sheet of paper. Without this, paperlab's
    // constant seeds make every card on a page the identical piece of paper,
    // and the fold layer is the loudest tell because its creases are placed in
    // sheet-relative coordinates: the same crease lands across the middle of
    // every sheet at every size.
    if (this.opts.seed == null && base?.page?.seed == null) {
      base = merge(base, { page: { seed: nextSeed() } });
    } else if (this.opts.seed != null) {
      base = merge(base, { page: { seed: Number(this.opts.seed) } });
    }
    this.params = resolve(base);

    this.caps = capabilities();
    this.canvas = null;
    this.ctx = null;
    this.pipe = null;
    this.contentTex = null;
    this.contentHasAlpha = false;
    this.contentMode = this.opts.content;
    this.geom = null;
    this.destroyed = false;
    this._renderSeq = 0;
    this._pendingRender = null;
    this._io = null;
    this._ro = null;
    this._onPointer = null;
    this._rafPending = false;
    this._prevStyle = null;
    this._hiddenChildren = false;

    // Reduced motion turns off the only thing here that moves.
    if (this.opts.light === 'pointer' && prefersReducedMotion()) {
      this.opts.light = 'static';
    }

    if (!this.caps.ok) {
      // No WebGL2: leave a flat sheet colour so the element still reads as paper
      // rather than as a hole in the design.
      this._degradeToFlat();
      return;
    }

    this._mount();
  }

  // --- setup ----------------------------------------------------------------

  _degradeToFlat() {
    const [r, g, b] = this.params.tone.paper;
    const to255 = (v) => Math.round(Math.max(0, Math.min(1, v)) * 255);
    this.el.style.backgroundColor = `rgb(${to255(r)}, ${to255(g)}, ${to255(b)})`;
    this._report(`paperweb: falling back to a flat sheet colour (${this.caps.reason})`);
  }

  _mount() {
    const el = this.el;
    const cs = getComputedStyle(el);
    this._prevStyle = { position: el.style.position, isolation: el.style.isolation };
    if (cs.position === 'static') el.style.position = 'relative';
    // isolation:isolate makes the element a stacking context, which is what lets
    // the canvas sit at z-index -1: inside a stacking context a negative z-index
    // child paints above the root's own background but below all in-flow
    // content. That is exactly "behind the text, in front of the element's
    // background", and it gets there without touching a single child node.
    el.style.isolation = 'isolate';

    const c = document.createElement('canvas');
    c.setAttribute('data-paperweb-canvas', '');
    c.setAttribute('aria-hidden', 'true');
    Object.assign(c.style, {
      position: 'absolute',
      zIndex: '-1',
      pointerEvents: 'none',
      display: 'block',
    });
    this.canvas = c;
    this.ctx = c.getContext('2d');
    el.insertBefore(c, el.firstChild);

    this.pipe = new Pipeline();
    live.add(this);

    this._ro = new ResizeObserver(debounce(() => this._onResize(), 100));
    this._ro.observe(el);

    if (this.opts.light === 'pointer') this._bindPointer();

    if (this.opts.lazy && typeof IntersectionObserver !== 'undefined') {
      this._io = new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          this._io.disconnect();
          this._io = null;
          this.render();
        }
      }, { rootMargin: '200px' });
      this._io.observe(el);
    } else {
      this.render();
    }
  }

  // --- geometry -------------------------------------------------------------

  /**
   * Work out the canvas box.
   *
   * The sheet is the element's own border box. When the cast shadow is on, the
   * canvas is grown beyond it so the shadow has void to fall on, and the amount
   * is derived from the shadow itself (offset plus a couple of blur radii) rather
   * than from paperlab's fixed 16mm desk margin, which on a UI element would put
   * a 60px transparent skirt around every card. page.margin_mm remains the cap.
   */
  _measure() {
    const rect = this.el.getBoundingClientRect();
    const p = this.params;
    const scale = Math.min(window.devicePixelRatio || 1, this.opts.maxDpr);
    const mode = this.opts.overhang;

    const boxW = Math.max(1, rect.width);
    const boxH = Math.max(1, rect.height);

    // How much void the shadow needs, derived from the shadow itself rather than
    // paperlab's fixed 16mm desk margin, which on a UI element would put a 60px
    // transparent skirt around every card. page.margin_mm remains the cap.
    const capMargin = p.page.margin_mm * pxPerMm(p);
    const needed = p.shadow.enabled ? p.shadow.offset_px + p.shadow.blur_px * 2 : 0;
    const margin = mode === 'clip' ? 0
      : Math.round(Math.max(0, Math.min(needed, capMargin)));

    // 'grow' widens the canvas beyond the element and keeps the sheet at the
    // element's own size. The other two keep the canvas at the element's size,
    // so 'inset' has to shrink the sheet to make the same room.
    const grow = mode === 'grow';
    const canvasCssW = grow ? boxW + 2 * margin : boxW;
    const canvasCssH = grow ? boxH + 2 * margin : boxH;
    const sheetW = grow ? boxW : Math.max(1, boxW - 2 * margin);
    const sheetH = grow ? boxH : Math.max(1, boxH - 2 * margin);
    const offset = grow ? margin : (canvasCssW - sheetW) / 2;
    const offsetY = grow ? margin : (canvasCssH - sheetH) / 2;

    const canvasW = Math.max(2, Math.round(canvasCssW * scale));
    const canvasH = Math.max(2, Math.round(canvasCssH * scale));

    return {
      // cssW/cssH are the SHEET, which is what a content raster must match.
      cssW: sheetW, cssH: sheetH, scale,
      marginCss: grow ? margin : 0,     // how far the canvas sticks out
      insetPad: mode === 'inset' ? margin : 0,
      canvasCssW, canvasCssH, canvasW, canvasH,
      // page rect in canvas (backing-store) px, top-left origin
      pageRect: [
        offset * scale, offsetY * scale,
        (offset + sheetW) * scale, (offsetY + sheetH) * scale,
      ],
    };
  }

  _applyCanvasBox(geom) {
    const c = this.canvas;
    if (c.width !== geom.canvasW || c.height !== geom.canvasH) {
      c.width = geom.canvasW;
      c.height = geom.canvasH;
    }
    c.style.left = `${-geom.marginCss}px`;
    c.style.top = `${-geom.marginCss}px`;
    c.style.width = `${geom.canvasCssW}px`;
    c.style.height = `${geom.canvasCssH}px`;

    // In 'inset' mode the sheet is smaller than the element, so the element's
    // own content has to move in by the same amount or it would sit on the void.
    // Padding is added ON TOP of whatever the element already had, and the
    // original value is restored on destroy.
    if (this.opts.overhang === 'inset' && geom.insetPad !== this._appliedPad) {
      if (this._basePad === undefined) this._basePad = this.el.style.padding || '';
      const cs = getComputedStyle(this.el);
      const base = [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft]
        .map((v) => parseFloat(v) || 0);
      // Subtract any padding this method added last time before re-adding, so
      // repeated resizes do not accumulate.
      const prev = this._appliedPad || 0;
      this.el.style.padding = base
        .map((v) => `${Math.max(0, v - prev + geom.insetPad)}px`).join(' ');
      this._appliedPad = geom.insetPad;
    }
  }

  // --- rendering ------------------------------------------------------------

  /**
   * Render now. Safe to call repeatedly: renders are coalesced, and a render
   * already in flight is superseded rather than queued behind.
   * @returns {Promise<void>}
   */
  render() {
    if (this.destroyed || !this.caps.ok) return Promise.resolve();
    const seq = ++this._renderSeq;
    this._pendingRender = this._doRender(seq).catch((e) => {
      this._report((e && e.message) || String(e));
    });
    return this._pendingRender;
  }

  async _doRender(seq) {
    const geom = this._measure();
    this.geom = geom;
    this._applyCanvasBox(geom);

    // Content is resolved before the GL work so an async snapshot cannot
    // interleave with another instance's draw calls on the shared context.
    if (!this.contentTex || this._contentDirty) {
      const res = await resolveContent(this.contentMode, this.el, geom, this.contentTex);
      if (seq !== this._renderSeq || this.destroyed) return;   // superseded
      if (res.error) {
        this._report(`${res.error} — falling back to content:'behind'`);
        this._restoreChildren();
        this.contentMode = 'behind';
      }
      this.contentTex = res.tex;
      this.contentHasAlpha = res.hasAlpha;
      this._contentDirty = false;
      // A successful rasterize replaces the element's own text with the version
      // baked into the sheet, so the original must be hidden. visibility rather
      // than display: the element keeps its layout, and screen readers still see
      // the text, which display:none would remove from the accessibility tree.
      if (res.mode === 'rasterize') this._hideChildren();
    }

    if (seq !== this._renderSeq || this.destroyed) return;

    const g = gl();
    ensureSize(geom.canvasW, geom.canvasH);
    this.pipe.render(
      this.params,
      { canvasW: geom.canvasW, canvasH: geom.canvasH, pageRect: geom.pageRect, contentId: this.contentMode },
      this.contentTex,
      this.contentHasAlpha,
    );
    this.pipe.presentComposite();
    g.finish();

    // Copy the shared context's output into this element's own 2D canvas. The
    // shared buffer is sized exactly, so this is a straight 1:1 blit.
    this.ctx.clearRect(0, 0, geom.canvasW, geom.canvasH);
    this.ctx.drawImage(sharedCanvas(), 0, 0);

    if (!this.opts.retain && this.opts.light !== 'pointer') {
      // Static surface: hand the targets back so a page of many paper elements
      // holds one element's worth of VRAM rather than N.
      this.pipe.releaseTargets();
    }
  }

  /**
   * Merge a parameter patch and re-render the affected passes.
   * @param {object} patch
   */
  set(patch) {
    this.params = resolve(merge(this.params, patch));
    if (!this.caps.ok) { this._degradeToFlat(); return this; }
    this.render();
    return this;
  }

  /** Swap the content source. */
  setContent(content) {
    this.contentMode = content;
    this._contentDirty = true;
    if (content === 'behind') this._restoreChildren();
    this.render();
    return this;
  }

  /**
   * Read an intermediate buffer as an ImageData, for debugging and tests.
   * Requires `retain: true`, since a static surface has already released its
   * targets by the time anyone could ask.
   * @param {'Final'|'Height'|'Normal'|'Cavity'|'Shade'|'Albedo'|'Shadow'|'Alpha'} name
   */
  buffer(name = 'Final', { falseColor = true } = {}) {
    if (!this.caps.ok) throw new Error('paperweb: no WebGL2, no buffers');
    if (!this.pipe.fx) {
      throw new Error('paperweb: targets have been released; construct with { retain: true } to inspect buffers');
    }
    const { w, h } = this.pipe.present(name, { falseColor });
    const tmp = document.createElement('canvas');
    tmp.width = w;
    tmp.height = h;
    tmp.getContext('2d').drawImage(sharedCanvas(), 0, 0);
    return tmp.getContext('2d').getImageData(0, 0, w, h);
  }

  /** Raw float readback of an intermediate buffer. Requires `retain: true`. */
  floats(name) {
    if (!this.pipe || !this.pipe.fx) {
      throw new Error('paperweb: targets have been released; construct with { retain: true }');
    }
    return this.pipe.readFloats(name);
  }

  // --- children visibility (rasterize mode) ---------------------------------

  _hideChildren() {
    if (this._hiddenChildren) return;
    for (const child of this.el.children) {
      if (child === this.canvas) continue;
      child.dataset.paperwebPrevVisibility = child.style.visibility || '';
      child.style.visibility = 'hidden';
    }
    this._hiddenChildren = true;
  }

  _restoreChildren() {
    if (!this._hiddenChildren) return;
    for (const child of this.el.children) {
      if (child === this.canvas) continue;
      child.style.visibility = child.dataset.paperwebPrevVisibility || '';
      delete child.dataset.paperwebPrevVisibility;
    }
    this._hiddenChildren = false;
  }

  // --- reactivity -----------------------------------------------------------

  _onResize() {
    if (this.destroyed) return;
    const geom = this._measure();
    if (this.geom
      && geom.canvasW === this.geom.canvasW
      && geom.canvasH === this.geom.canvasH) return;
    // A resize invalidates a DOM snapshot; an image or the white texture survives.
    if (this.contentMode === 'rasterize' && this.opts.watch) this._contentDirty = true;
    this.render();
  }

  _bindPointer() {
    this._onPointer = (ev) => {
      if (this._rafPending) return;
      this._rafPending = true;
      requestAnimationFrame(() => {
        this._rafPending = false;
        if (this.destroyed || !this.geom) return;
        const r = this.el.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        // Azimuth 0 = +x (right), 90 = +y (up); screen y points down, so negate.
        const az = (Math.atan2(-(ev.clientY - cy), ev.clientX - cx) * 180) / Math.PI;
        // Distance from centre maps to altitude: near the middle the light is
        // high and the relief flattens, at the edges it rakes across the sheet.
        const d = Math.min(1, Math.hypot(ev.clientX - cx, ev.clientY - cy)
          / Math.max(1, Math.hypot(r.width, r.height) / 2));
        this.params = merge(this.params, {
          light: { azimuth_deg: az, altitude_deg: 70 - 45 * d },
        });
        this.render();
      });
    };
    window.addEventListener('pointermove', this._onPointer, { passive: true });
  }

  _report(msg) {
    if (typeof this.opts.onError === 'function') this.opts.onError(msg, this);
    else if (typeof console !== 'undefined') console.warn(msg);
  }

  // --- teardown -------------------------------------------------------------

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    live.delete(this);
    if (this._io) this._io.disconnect();
    if (this._ro) this._ro.disconnect();
    if (this._onPointer) window.removeEventListener('pointermove', this._onPointer);
    this._restoreChildren();
    if (this.pipe) this.pipe.destroy();
    if (this.contentTex && this.contentTex !== null) {
      // The shared white texture is not ours to delete; every other content
      // texture is.
      const g = gl();
      if (g && this.contentMode !== 'behind') g.deleteTexture(this.contentTex);
    }
    this.contentTex = null;
    if (this.canvas && this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas);
    if (this._prevStyle) {
      this.el.style.position = this._prevStyle.position;
      this.el.style.isolation = this._prevStyle.isolation;
    }
    if (this._basePad !== undefined) this.el.style.padding = this._basePad;
  }
}

/** Tear down every live instance. */
export function destroyAll() {
  for (const p of [...live]) p.destroy();
}

// --- helpers ----------------------------------------------------------------

function debounce(fn, ms) {
  let t = null;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

function prefersReducedMotion() {
  return typeof matchMedia !== 'undefined'
    && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
