// Turn the approved showcase components into a block manifest.
//
//   node tools/build-blocks.mjs
//
// keep.html is a GALLERY: every component is wrapped in a numbered heading and
// an explanatory caption, sized in hard pixels, and carries a fully resolved
// ~1.5 kb parameter tree. A library needs the payload, a minimal parameter
// diff, and named slots for the text someone will actually want to change.
//
// This is a mechanical transform, so it asserts its POSTconditions rather than
// only its preconditions: chrome actually gone, surfaces still present, params
// still resolving to the same values. A conversion that silently drops a
// surface looks exactly like one that worked.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defaults, merge } from '../src/params.js';
import { preset as lookupPreset, presetNames } from '../src/presets.js';
import { SHAPES, SHAPES_CSS } from '../src/blocks/shapes.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const OUT = `${root}demo/blocks/`;

// --- read the gallery --------------------------------------------------------
const keep = readFileSync(`${root}demo/news/keep.html`, 'utf8');
const m = keep.match(/<script type="application\/json" id="keep-data">(.*?)<\/script>/s);
if (!m) throw new Error('keep.html: no keep-data block');
const DATA = JSON.parse(m[1]);

const FAMILY_LABEL = {
  archive: 'Archive', broadsheet: 'Broadsheet', desk: 'Desk', product: 'Product',
};

// --- html helpers ------------------------------------------------------------
// No DOM here, so these are deliberately narrow: they handle the shapes these
// four files actually contain and throw on anything else, rather than being a
// half-correct general HTML parser.

/** Find the matching close tag for the element starting at `i`, by depth. */
function matchTag(html, i, tag) {
  const re = new RegExp(`<(/?)${tag}\\b`, 'g');
  re.lastIndex = i;
  let depth = 0, mm;
  while ((mm = re.exec(html))) {
    depth += mm[1] ? -1 : 1;
    if (depth === 0) return html.indexOf('>', mm.index) + 1;
  }
  throw new Error(`unbalanced <${tag}> from ${i}`);
}

/**
 * Remove every element whose class matches, whatever tag it uses.
 *
 * Tag-agnostic on purpose: the four pages wrote the same heading block as a
 * <div>, a <header> and a <section> respectively, and keying on the tag made
 * the strip silently miss three of the four families.
 */
function dropByClass(html, classRe) {
  let out = html;
  for (;;) {
    const mm = matchOpen(out, classRe);
    if (!mm) return out;
    const end = matchTag(out, mm.index, mm.tag);
    out = out.slice(0, mm.index) + out.slice(end);
  }
}

/** First open tag whose class attribute matches `classRe`. */
function matchOpen(html, classRe) {
  const re = /<(\w+)\b[^>]*\bclass="([^"]*)"[^>]*>/g;
  let mm;
  while ((mm = re.exec(html))) {
    if (classRe.test(mm[2])) return { index: mm.index, tag: mm[1] };
  }
  return null;
}

/** Remove a whole element (open tag through its matching close). */
function dropElement(html, openRe, tag) {
  let out = html;
  for (;;) {
    const mm = out.match(openRe);
    if (!mm) return out;
    const end = matchTag(out, mm.index, tag);
    out = out.slice(0, mm.index) + out.slice(end);
  }
}

/** Unwrap the gallery <section> and drop its heading and caption. */
function stripChrome(html) {
  let out = html.trim();

  // 1. unwrap the outer gallery section, if there is one
  const wrap = out.match(/^<section class="(?:bay|demo|sec)(?:\s[^"]*)?"[^>]*>/);
  if (wrap) {
    const end = matchTag(out, 0, 'section');
    const close = out.lastIndexOf('</section>', end);
    out = out.slice(wrap[0].length, close);
  }

  // 2. drop heading blocks and captions, whatever tag the four pages used
  out = dropByClass(out, /(?:^|\s)(?:bay|demo|sec)-head(?:\s|$)/);
  out = dropByClass(out, /(?:^|\s)(?:cap|role|sec-sub|demo-sub|bay-sub)(?:\s|$)/);
  out = dropByClass(out, /(?:^|\s)(?:idx|num)(?:\s|$)/);
  out = dropElement(out, /<h2\b[^>]*>/, 'h2');

  // 3. the .stage wrapper is gallery framing too, but ONLY when it is the sole
  //    child; on some pages it carries the positioning the component needs.
  const stage = out.match(/^\s*<div class="stage"[^>]*>/);
  if (stage) {
    const end = matchTag(out, stage.index, 'div');
    if (!out.slice(end).trim()) {
      out = out.slice(stage.index + stage[0].length, out.lastIndexOf('</div>', end));
    }
  }
  return out.trim();
}

// --- params ------------------------------------------------------------------
const DEF = defaults();

/** Deep diff of `full` against `base`, keeping only leaves that differ. */
function diff(full, base) {
  const out = {};
  for (const k of Object.keys(full)) {
    const a = full[k], b = base?.[k];
    if (a && typeof a === 'object' && !Array.isArray(a)) {
      const d = diff(a, b || {});
      if (Object.keys(d).length) out[k] = d;
    } else if (JSON.stringify(a) !== JSON.stringify(b)) {
      // float32 round-trips: 0.73 stored as 0.7300000190734863 is not a change
      if (typeof a === 'number' && typeof b === 'number'
        && Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a))) continue;
      out[k] = a;
    }
  }
  return out;
}

/**
 * Pick the preset that leaves the smallest diff, and return that diff.
 *
 * The gallery baked out resolved trees, so every block currently declares all
 * ~90 parameters. Most of them are just whichever preset the author started
 * from, and saying so in one word is both smaller and legible.
 */
function minimiseParams(resolved) {
  let best = { name: null, patch: diff(resolved, DEF), size: 0 };
  best.size = JSON.stringify(best.patch).length;
  for (const name of presetNames) {
    const base = merge(DEF, lookupPreset(name));
    const patch = diff(resolved, base);
    const size = JSON.stringify(patch).length;
    if (size < best.size) best = { name, patch, size };
  }
  return best;
}

// --- slots -------------------------------------------------------------------
// Which text is worth exposing. Decorative furniture (rules, folios, ornaments)
// stays fixed: it carries the layout, and an editor showing thirty unlabelled
// fields per block invites wrecking the design.
const SLOT_RULES = [
  { name: 'kicker', label: 'Kicker', re: /<(?:p|span|div)\s+class="(?:kicker|stamp|eyebrow|slug|tag|label)[^"]*"[^>]*>/ },
  { name: 'headline', label: 'Headline', re: /<h3\b[^>]*>/ },
  { name: 'subhead', label: 'Subhead', re: /<h4\b[^>]*>/ },
  { name: 'byline', label: 'Byline', re: /<(?:p|span|div)\s+class="(?:byline|by|credit|sig)[^"]*"[^>]*>/ },
  { name: 'body', label: 'Body', multiline: true, re: /<p(?!\s+class="(?:cap|role|kicker|byline|by|credit|sig)")[^>]*>/ },
];

/** First matching element for each rule, as a 0-based index among same-tag elements. */
function findSlots(html) {
  const slots = [];
  const taken = new Set();
  for (const rule of SLOT_RULES) {
    const mm = html.match(rule.re);
    if (!mm || taken.has(mm.index)) continue;
    taken.add(mm.index);
    // Address the target by tag + ordinal rather than by a CSS selector: these
    // components reuse class names freely and a selector would be ambiguous.
    const tag = mm[0].match(/^<(\w+)/)[1];
    const before = html.slice(0, mm.index).match(new RegExp(`<${tag}\\b`, 'g'));
    slots.push({
      name: rule.name, label: rule.label, tag,
      nth: before ? before.length : 0,
      multiline: !!rule.multiline,
    });
  }
  return slots;
}

// --- build -------------------------------------------------------------------
const blocks = [];
const families = {};
let stripped = 0, surfacesIn = 0, surfacesOut = 0;

for (const [family, { css, components }] of Object.entries(DATA)) {
  families[family] = { label: FAMILY_LABEL[family] || family, css: `${family}.css` };
  writeFileSync(`${OUT}${family}.css`, css);

  for (const c of components) {
    const before = (c.html.match(/data-paper(?:=|\s|>)/g) || []).length;
    const html = stripChrome(c.html);
    const after = (html.match(/data-paper(?:=|\s|>)/g) || []).length;
    surfacesIn += before; surfacesOut += after;
    if (html.length < c.html.length) stripped++;

    // POSTCONDITION: stripping chrome must not cost a surface.
    if (after !== before) {
      throw new Error(`${family}-${c.n}: stripping chrome lost a surface (${before} -> ${after})`);
    }
    // POSTCONDITION: the chrome must actually be gone.
    for (const bad of [/class="[^"]*\b(?:bay|demo|sec)-head\b/, /class="[^"]*\bcap\b/,
      /class="[^"]*\bidx\b/, /class="[^"]*\bsec-sub\b/, /<h2\b/]) {
      if (bad.test(html)) throw new Error(`${family}-${c.n}: chrome survived (${bad})`);
    }

    // Minimise the first surface's params; the rest keep theirs inline.
    const attr = html.match(/data-paper-params="([^"]*)"/);
    let paper = null;
    if (attr) {
      const resolved = JSON.parse(attr[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
      const best = minimiseParams(resolved);
      // POSTCONDITION, and the one that actually matters: preset + patch must
      // resolve back to exactly what the gallery baked out. Shrinking a
      // parameter tree by dropping a value that turned out to matter is
      // invisible until someone looks at a render.
      const back = merge(merge(DEF, best.name ? lookupPreset(best.name) : {}), best.patch);
      const lost = diff(resolved, back);
      if (Object.keys(lost).length) {
        throw new Error(`${family}-${c.n}: minimising params lost `
          + JSON.stringify(lost).slice(0, 200));
      }
      paper = { preset: best.name, params: best.patch };
    }

    const hasInk = /data-paper-content="(?!behind)/.test(html) || /content:\s*'rasterize'/.test(html);

    blocks.push({
      id: `${family}-${c.n}`,
      n: c.n,
      name: c.title || `${FAMILY_LABEL[family]} ${c.n}`,
      family,
      html,
      slots: findSlots(html),
      paper,
      hasInk,
      surfaces: after,
    });
  }
}

// --- shapes ------------------------------------------------------------------
// Hand-authored rather than converted: they answer "what shape is the paper",
// which the 52 news components cannot, because each carries its own copy and
// comparing an obituary against a crossword compares content, not silhouette.
families.shapes = { label: 'Shapes', css: 'shapes.css' };
writeFileSync(`${OUT}shapes.css`, SHAPES_CSS);
blocks.push(...SHAPES);

blocks.sort((a, b) => a.id.localeCompare(b.id));
mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}manifest.json`, JSON.stringify({ families, blocks }, null, 1));

const sizeBefore = Object.values(DATA).reduce((s, v) =>
  s + v.components.reduce((t, c) => t + c.html.length, 0), 0);
const sizeAfter = blocks.reduce((s, b) => s + b.html.length, 0);
console.log(`${blocks.length} blocks, ${surfacesOut} surfaces (was ${surfacesIn})`);
console.log(`chrome stripped from ${stripped}; html ${(sizeBefore / 1024).toFixed(0)}kb -> ${(sizeAfter / 1024).toFixed(0)}kb`);
console.log(`slots: ${blocks.reduce((s, b) => s + b.slots.length, 0)} across ${blocks.filter((b) => b.slots.length).length} blocks`);
console.log(`with a preset: ${blocks.filter((b) => b.paper?.preset).length}/${blocks.filter((b) => b.paper).length}`);
