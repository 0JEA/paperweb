// Declarative binding, so a static site needs no per-element JavaScript.
//
//   <div data-paper="worn" data-paper-content="behind" data-paper-dpi="120">…</div>
//   <script type="module">
//     import { scan } from '/paperweb/src/index.js';
//     scan();
//   </script>
//
// Any `data-paper-*` attribute maps to an option; dashes become camelCase, and
// values are parsed as JSON when they look like JSON so `data-paper-params` can
// carry a whole patch. Already-bound elements are skipped, so scan() is safe to
// call again after content is added.

import { Paper } from './paper.js';

// The DOM already camelCases dataset keys, so `data-paper-max-dpr` arrives as
// `paperMaxDpr` and only the `paper` prefix has to be stripped.
const bound = new WeakMap();

function parseValue(v) {
  if (v === '' || v === 'true') return true;
  if (v === 'false') return false;
  if (v === 'null') return null;
  const n = Number(v);
  if (v.trim() !== '' && Number.isFinite(n)) return n;
  const t = v.trim();
  if (t.startsWith('{') || t.startsWith('[')) {
    try { return JSON.parse(t); } catch { /* fall through to the raw string */ }
  }
  return v;
}

/**
 * Bind every `[data-paper]` element under `root`.
 * @param {ParentNode} [root=document]
 * @param {object} [defaults] merged under each element's own attributes
 * @returns {Paper[]} the instances created by this call
 */
export function scan(root = document, defaults = {}) {
  const out = [];
  for (const el of root.querySelectorAll('[data-paper]')) {
    if (bound.has(el)) continue;
    const opts = { ...defaults };
    const presetName = el.dataset.paper;
    if (presetName) opts.preset = presetName;
    for (const key of Object.keys(el.dataset)) {
      if (key === 'paper' || !key.startsWith('paper')) continue;
      // data-paper-content -> dataset.paperContent -> opts.content
      const name = key.slice('paper'.length);
      opts[name.charAt(0).toLowerCase() + name.slice(1)] = parseValue(el.dataset[key]);
    }
    // data-paper-canvas is set by paperweb itself; never treat it as an option.
    delete opts.webCanvas;
    const p = new Paper(el, opts);
    bound.set(el, p);
    out.push(p);
  }
  return out;
}

/** The instance bound to an element by scan(), if any. */
export function boundTo(el) {
  return bound.get(el) || null;
}

/** Unbind everything scan() created under `root`. */
export function unscan(root = document) {
  for (const el of root.querySelectorAll('[data-paper]')) {
    const p = bound.get(el);
    if (p) { p.destroy(); bound.delete(el); }
  }
}
