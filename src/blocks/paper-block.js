// <paper-block> — one element, fifty-two blocks.
//
//   <paper-block type="desk-16" stock="worn" age="0.6" width="320">
//     <span slot="headline">Council votes to keep the mural</span>
//   </paper-block>
//
// Fifty-two bespoke element classes would be the same behaviour written
// fifty-two times. The block's markup, its slots and its paper come from a
// manifest, so adding a block is a data change and an editor writes data rather
// than markup.
//
// Each block mounts in a SHADOW ROOT with its family stylesheet. The four
// showcase pages were written independently and collide on generic names
// (.sheet, .demo, .tag, .grid); an earlier attempt to scope them by rewriting
// selectors silently dropped rules and rendered 52 components in near-white ink
// on cream. A shadow root needs none of that.

import { scan, unscan, boundTo } from '../scan.js';
import { CONTROL_NAMES, controlsToParams } from './controls.js';
import { merge } from '../params.js';
import { FONT_STACKS } from './controls.js';
import { preset as lookupPreset } from '../presets.js';

let manifestUrl = new URL('../../demo/blocks/manifest.json', import.meta.url).href;
let manifestPromise = null;
const sheetCache = new Map();

/** Point the element at a manifest. Call before the first block mounts. */
export function setManifestUrl(url) {
  manifestUrl = url;
  manifestPromise = null;
  sheetCache.clear();
}

export function manifest() {
  if (!manifestPromise) {
    manifestPromise = fetch(manifestUrl).then((r) => {
      if (!r.ok) throw new Error(`paper-block: manifest ${r.status} at ${manifestUrl}`);
      return r.json();
    });
  }
  return manifestPromise;
}

/**
 * Family stylesheets are fetched once and shared as a CONSTRUCTED stylesheet.
 * Twelve blocks from the same family on one page would otherwise parse the same
 * 27 kb twelve times, once per shadow root.
 */
async function familySheet(family, base) {
  if (sheetCache.has(family)) return sheetCache.get(family);
  const p = (async () => {
    const href = new URL(base.families[family].css, manifestUrl).href;
    const css = await (await fetch(href)).text();
    const sheet = new CSSStyleSheet();
    // The gallery styled the page; inside a shadow root the page is :host.
    await sheet.replace(css.replace(/(^|[},;\s])(?:html|body|:root)\b/g, '$1:host'));
    return sheet;
  })();
  sheetCache.set(family, p);
  return p;
}

const HOST_CSS = `
:host { display: block; position: relative; contain: layout style; }
:host([hidden]) { display: none; }
/* Fluidity: the blocks were authored at fixed pixel widths for a gallery.
   --pb-width is the one knob that overrides that, and the rotation is applied
   here rather than on the inner sheet so a block can be rotated without
   fighting whatever transform its own design already uses. */
.pb-root { width: var(--pb-width, 100%); margin-inline: auto;
           transform: rotate(var(--pb-rotate, 0deg)); transform-origin: 50% 40%; }
/* A thumbnail lays out at a comfortable size and is ZOOMED down to fit its
   swatch, rather than being squeezed into a small box.
   
   Forcing width and height onto a shape that carries its own aspect-ratio left
   the element and its canvas disagreeing about how wide they were, and the
   canvas is what you actually see. Zoom re-lays-out rather than rasterising, so
   the render stays crisp and there is only one size to be right about. */
:host([thumb]) .pb-root { transform: none; height: 100%; }
:host([thumb]) .pb-root > * { width: 100% !important; height: 100% !important;
                              aspect-ratio: auto !important; }
`;

export class PaperBlock extends HTMLElement {
  static observedAttributes = ['type', 'thumb', ...CONTROL_NAMES];

  constructor() {
    super();
    this._shadow = this.attachShadow({ mode: 'open' });
    this._mounted = null;      // the block record currently mounted
    this._root = null;         // .pb-root inside the shadow
    this._seq = 0;
    this._unavailable = [];
    this._slotObserver = null;
  }

  connectedCallback() {
    if (!this.isConnected) return;
    this._sync();
    // Light-DOM slot content can arrive after upgrade (a framework filling
    // children, or an editor typing), so watch for it rather than reading once.
    this._slotObserver = new MutationObserver(() => this._applySlots());
    this._slotObserver.observe(this, { childList: true, subtree: true, characterData: true });
  }

  disconnectedCallback() {
    this._slotObserver?.disconnect();
    this._slotObserver = null;
    if (this._root) unscan(this._shadow);
  }

  attributeChangedCallback(name, before, after) {
    if (before === after) return;
    if (name === 'type') this._sync();
    else if (this._root) this._applyControls();
  }

  // --- public API used by an editor -----------------------------------------

  /** The manifest record for the mounted block. */
  get block() { return this._mounted; }

  /** Controls the mounted block cannot honour, e.g. ink effects with no ink. */
  get unavailable() { return [...this._unavailable]; }

  /** Current control values, as authored on the element. */
  get controls() {
    const out = {};
    for (const n of CONTROL_NAMES) {
      const v = this.getAttribute(n);
      if (v !== null) out[n] = v;
    }
    return out;
  }

  set controls(values) {
    for (const [k, v] of Object.entries(values)) {
      if (v === null || v === undefined || v === '') this.removeAttribute(k);
      else this.setAttribute(k, String(v));
    }
  }

  /** Set a slot's text without touching the DOM by hand. */
  setSlot(name, text) {
    let el = this.querySelector(`[slot="${name}"]`);
    if (!el) {
      el = document.createElement('template');
      el.setAttribute('slot', name);
      this.appendChild(el);
    }
    el.textContent = text;
    this._applySlots();
  }

  /** Serialise back to markup, for copy-out and for saving a layout. */
  toHTML() {
    const attrs = ['type', ...CONTROL_NAMES]
      .filter((n) => this.hasAttribute(n))
      .map((n) => `${n}="${escapeAttr(this.getAttribute(n))}"`)
      .join(' ');
    const slots = [...this.querySelectorAll('[slot]')]
      .map((n) => `  <span slot="${n.getAttribute('slot')}">${escapeText(n.textContent)}</span>`)
      .join('\n');
    return slots
      ? `<paper-block ${attrs}>\n${slots}\n</paper-block>`
      : `<paper-block ${attrs}></paper-block>`;
  }

  /** Force a re-render, e.g. after the manifest changed. */
  refresh() { return this._sync(); }

  // --- internals -------------------------------------------------------------

  async _sync() {
    const seq = ++this._seq;
    const type = this.getAttribute('type');
    if (!type) return;

    let base;
    try {
      base = await manifest();
    } catch (e) {
      this._fail(e.message);
      return;
    }
    if (seq !== this._seq || !this.isConnected) return;

    const block = base.blocks.find((b) => b.id === type);
    if (!block) { this._fail(`unknown block "${type}"`); return; }

    const sheet = await familySheet(block.family, base);
    if (seq !== this._seq || !this.isConnected) return;

    if (this._root) unscan(this._shadow);
    this._shadow.adoptedStyleSheets = [hostSheet(), sheet];
    // TRUST BOUNDARY: block.html comes from the manifest, which is this
    // library's own markup built from its own showcase files -- the same trust
    // level as the script tag that loaded this module. It is not user input and
    // must never become user input: if an editor ever lets someone author block
    // markup, that path needs sanitising before it reaches here.
    this._shadow.innerHTML = `<div class="pb-root">${block.html}</div>`;
    this._root = this._shadow.querySelector('.pb-root');
    this._mounted = block;
    this._naturalWidth = 0;

    this._applySlots();
    this._applyControls({ mount: true });
    this.dispatchEvent(new CustomEvent('pb-mount', { detail: { block }, bubbles: true }));
  }

  /**
   * Copy light-DOM slot text into the shadow target.
   *
   * Deliberately NOT native <slot>: slotted nodes live in the light DOM, so the
   * family stylesheet inside the shadow root cannot reach them, and every
   * headline would arrive unstyled. Copying the text keeps the block's
   * typography, which is the entire reason to use these blocks.
   */
  _applySlots() {
    if (!this._root || !this._mounted) return;
    for (const slot of this._mounted.slots) {
      const src = this.querySelector(`[slot="${slot.name}"]`);
      if (!src) continue;
      // Converted blocks are addressed by tag + ordinal, because they reuse
      // class names freely and a selector would be ambiguous. Hand-authored
      // shapes declare a selector, which is both stable and legible.
      const target = slot.sel
        ? this._root.querySelector(slot.sel)
        : this._root.querySelectorAll(slot.tag)[slot.nth];
      if (!target) continue;
      const text = src.textContent.trim();
      if (slot.multiline && text.includes('\n\n')) {
        target.innerHTML = '';
        for (const para of text.split(/\n{2,}/)) {
          const p = document.createElement('p');
          p.textContent = para.trim();
          target.appendChild(p);
        }
      } else {
        target.textContent = text;
      }
    }
  }

  _applyControls({ mount = false } = {}) {
    if (!this._root || !this._mounted) return;
    const block = this._mounted;
    const c = this.controls;

    // --- geometry, in CSS rather than in the paper params ---------------------
    // Width is applied as `zoom`, not as a width.
    //
    // These blocks were authored for a gallery at fixed pixel sizes, and many
    // position their sheets absolutely (a cork board pins slips at left: 2.5%).
    // Forcing width on the surfaces reflows some correctly and destroys others,
    // and max-width can only ever shrink. zoom re-lays-out rather than
    // rasterising, so the canvas re-renders at the new size and stays crisp,
    // and it means one control behaves identically on all 52.
    this._root.style.setProperty('--pb-rotate', c.rotate ? `${parseFloat(c.rotate)}deg` : '');
    if (c.width) {
      const natural = this._naturalWidth || (this._naturalWidth = this._measureNatural());
      const want = parseFloat(c.width);
      this._root.style.zoom = natural > 0 ? String(Math.max(0.2, want / natural)) : '';
    } else {
      this._root.style.zoom = '';
    }

    const hasStains = !!block.paper?.params?.stains?.marks?.length;
    // Typography is CSS, not paper. It is applied as custom properties on the
    // root so a shape's own stylesheet can size everything in em off one value
    // and scale coherently instead of having each element overridden.
    // These reach the SHAPES, which set every size and colour off them. The
    // converted news components declare their own faces and colours on their own
    // elements, so nothing inherits and the controls would move a slider and
    // change nothing. Forcing them with !important across a converted block
    // flattens the typographic hierarchy that makes it worth having, so they are
    // reported as unavailable instead -- the same answer the ink effects give.
    const typographic = block.family === 'shapes';
    const cssDead = [];
    for (const [attr, prop, fmt] of [
      ['font', '--pp-face', (v) => FONT_STACKS[v] || v],
      ['ink', '--pp-ink', (v) => v],
      ['type-size', '--pp-type', (v) => `${parseFloat(v)}px`],
    ]) {
      if (c[attr] && !typographic) { cssDead.push(attr); continue; }
      this._root.style.setProperty(prop, c[attr] ? fmt(c[attr]) : '');
    }

    const { params, unavailable } = controlsToParams(c, block.hasInk, hasStains);
    this._unavailable = [...unavailable, ...cssDead];

    // The block's own paper, then the controls over the top. An unset control
    // contributes nothing, so a block renders exactly as authored until it is
    // deliberately overridden.
    // `stock` replaces the preset the block was authored on, so it is applied
    // UNDER the block's own params rather than as one more override: a preset
    // is a whole tree, and merging it on top would bury the block's tuning.
    const stock = c.stock || block.paper?.preset;
    const authored = merge(stock ? lookupPreset(stock) || {} : {}, block.paper?.params || {});
    const full = merge(authored, params);

    // scan() binds [data-paper] specifically, so that is what to walk. An
    // element carrying only data-paper-params is not a surface to it.
    const surfaces = this._root.querySelectorAll('[data-paper]');
    if (mount) {
      // `thumb` means "render inside the box you were given".
      //
      // The default overhang GROWS the canvas past the element so the deckle
      // and the cast shadow have somewhere to fall. In a 74 px picker swatch
      // that overspill is wider than the swatch, so the canvas hangs outside
      // the rail and gets clipped. A thumbnail trades the shadow for staying
      // put, which is the right trade at that size.
      const thumb = this.hasAttribute('thumb');
      for (const el of surfaces) {
        el.setAttribute('data-paper-params', JSON.stringify(full));
        if (thumb) el.setAttribute('data-paper-overhang', 'inset');
      }
      scan(this._shadow);
    } else {
      // Already bound: patch the live instances instead of re-binding, so the
      // GPU targets and the seed survive a slider drag.
      for (const el of surfaces) {
        const inst = boundTo(el);
        if (inst) inst.set(full);
        else el.setAttribute('data-paper-params', JSON.stringify(full));
      }
    }

    if (unavailable.length) {
      this.dispatchEvent(new CustomEvent('pb-unavailable', {
        detail: { controls: unavailable, reason: 'this block has no ink for these to act on' },
        bubbles: true,
      }));
    }
  }

  /**
   * The width the block wants when nothing is forcing it, measured once with
   * zoom cleared so the reading is not of a previous zoom.
   */
  _measureNatural() {
    const prev = this._root.style.zoom;
    this._root.style.zoom = '';
    const w = this._root.getBoundingClientRect().width;
    this._root.style.zoom = prev;
    return w;
  }

  _fail(msg) {
    this._shadow.adoptedStyleSheets = [hostSheet()];
    this._shadow.innerHTML =
      `<div class="pb-root" style="padding:14px;border:1px dashed #a55;border-radius:6px;
        font:13px/1.5 ui-monospace,Menlo,monospace;color:#c77">paper-block: ${escapeText(msg)}</div>`;
    this._root = this._shadow.querySelector('.pb-root');
  }
}

let _hostSheet = null;
function hostSheet() {
  if (!_hostSheet) { _hostSheet = new CSSStyleSheet(); _hostSheet.replaceSync(HOST_CSS); }
  return _hostSheet;
}

const escapeAttr = (s) => String(s).replace(/[&"<>]/g, (ch) =>
  ({ '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;' }[ch]));
const escapeText = (s) => String(s).replace(/[&<>]/g, (ch) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]));

if (!customElements.get('paper-block')) customElements.define('paper-block', PaperBlock);
