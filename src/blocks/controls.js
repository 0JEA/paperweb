// The universal control schema.
//
// Fifty-two components, one set of controls. Anything that does not apply to
// every block is a per-component FIXTURE (the pin, the tape, the cork board)
// and does not belong here.
//
// This file is the single source of truth: the <paper-block> element reads it
// to know which attributes to observe, and an editor generates its panel from
// it rather than hand-listing inputs. Adding a control here makes it work in
// both places, which is the whole reason the schema is data.

/**
 * Two of these are COMPOUND: one control moving several parameters along a
 * curve. `age` and `relief` exist because "make it older" and "make it more
 * crumpled" are the actual requests; nobody thinks in pit_density. The
 * individual parameters stay reachable through `params` for anyone who wants
 * them, and an explicit param always wins over the compound control.
 *
 * `needsContent: true` marks a control that acts on INK. A surface using
 * content:'behind' has its text as live DOM on top of the canvas, so there is
 * no ink in the shader for these to touch and they would be dead knobs. The
 * element reports them as unavailable rather than accepting them silently.
 */
export const CONTROLS = [
  { name: 'stock', type: 'preset', label: 'Stock', default: null,
    help: 'Which paper the block is printed on.' },

  { name: 'paper', type: 'color', label: 'Paper colour', default: null,
    help: 'The unlit sheet colour.' },

  { name: 'duotone', type: 'range', label: 'Duotone', min: 0, max: 1, step: 0.01, default: null,
    help: 'Warm highlights and cool shadows. A scalar shade cannot hue-shift on its own.' },

  { name: 'age', type: 'range', label: 'Age', min: 0, max: 1, step: 0.01, default: null,
    compound: true,
    help: 'Foxing, pits, blotches, scratches and fade together.' },

  { name: 'relief', type: 'range', label: 'Relief', min: 0, max: 1, step: 0.01, default: null,
    compound: true,
    help: 'How much the sheet buckles and crumples.' },

  { name: 'folds', type: 'range', label: 'Folds', min: 0, max: 4, step: 1, default: null,
    help: 'Deliberate pressed creases. Cracking needs at least one.' },

  { name: 'edge', type: 'enum', label: 'Edge', options: ['clean', 'deckle', 'torn'], default: null,
    help: 'Guillotined, hand-made, or torn.' },

  { name: 'lift', type: 'range', label: 'Lift', min: 0, max: 1, step: 0.01, default: null,
    help: 'How far off the page the sheet sits, via its cast shadow.' },

  { name: 'stain', type: 'range', label: 'Stains', min: 0, max: 1, step: 0.01, default: null,
    help: 'Strength of any coffee rings the block carries.' },

  { name: 'bleed', type: 'range', label: 'Dot gain', min: 0, max: 1, step: 0.01, default: null,
    needsContent: true,
    help: 'Ink wicking along the fibres, so strokes fatten.' },

  { name: 'show-through', type: 'range', label: 'Show-through', min: 0, max: 1, step: 0.01, default: null,
    needsContent: true,
    help: 'Type on the reverse, faintly visible through thin stock.' },

  { name: 'fold-crack', type: 'range', label: 'Ink cracking', min: 0, max: 1, step: 0.01, default: null,
    needsContent: true,
    help: 'The dried ink film flaking off along a crease.' },

  { name: 'width', type: 'length', label: 'Width', min: 180, max: 1200, step: 10, default: null,
    help: 'Block width. Fluid blocks reflow; fixed-ratio blocks scale.' },

  { name: 'rotate', type: 'range', label: 'Rotation', min: -12, max: 12, step: 0.1, default: null,
    unit: 'deg', help: 'How squarely it was put down.' },

  { name: 'seed', type: 'number', label: 'Sheet', min: 0, max: 9999, step: 1, default: null,
    help: 'Which physical sheet of paper this is. Change it for a different one.' },
];

export const CONTROL_NAMES = CONTROLS.map((c) => c.name);
const BY_NAME = new Map(CONTROLS.map((c) => [c.name, c]));
export const control = (name) => BY_NAME.get(name);

const lerp = (a, b, t) => a + (b - a) * t;
const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

/**
 * Turn control values into a paperweb parameter patch.
 *
 * Only controls that were actually SET produce parameters. An unset control
 * leaves the block exactly as its manifest authored it, which is what makes it
 * safe to expose fifteen controls on fifty-two blocks that were each tuned by
 * hand.
 *
 * @param {object} c          control values, keyed by control name
 * @param {boolean} hasInk    whether the surface has content for ink effects
 * @param {boolean} hasStains whether the block already places stain marks
 * @returns {{params: object, unavailable: string[]}}
 */
export function controlsToParams(c = {}, hasInk = false, hasStains = false) {
  const p = {};
  const unavailable = [];
  const set = (path, value) => {
    const keys = path.split('.');
    let node = p;
    for (const k of keys.slice(0, -1)) node = node[k] || (node[k] = {});
    node[keys.at(-1)] = value;
  };

  const paper = c.paper;
  if (paper) set('tone.paper', hexToLinearish(paper));

  const duotone = num(c.duotone);
  if (duotone !== null) set('tone.duotone', duotone);

  // --- age ------------------------------------------------------------------
  // Each layer switches on at a different point, because a sheet does not age
  // uniformly: it picks up handling marks long before it foxes.
  const age = num(c.age);
  if (age !== null) {
    set('imperfect.enabled', age > 0.02);
    set('imperfect.pit_density', 0.022 * age);
    set('imperfect.mark_density', 0.04 * age);
    set('imperfect.mark_strength', lerp(0.05, 0.2, age));
    set('scratches.enabled', age > 0.06);
    set('scratches.density', 0.06 * age);
    set('foxing.enabled', age > 0.34);
    set('foxing.density', lerp(0.05, 0.16, age));
    set('foxing.strength', lerp(0.05, 0.17, age));
    set('fade.enabled', true);
    set('fade.amount', lerp(0.25, 0.9, age));
  }

  // --- relief ---------------------------------------------------------------
  const relief = num(c.relief);
  if (relief !== null) {
    set('cockle.enabled', relief > 0.02);
    set('cockle.amplitude_um', lerp(4, 44, relief));
    set('crumple.enabled', relief > 0.18);
    set('crumple.amplitude_um', lerp(6, 46, relief));
  }

  const folds = num(c.folds);
  if (folds !== null) {
    set('folds.enabled', folds >= 1);
    set('folds.count', Math.max(1, Math.round(folds)));
    // count is a MAXIMUM gated by chance, so asking for 1 fold and reliably
    // getting one means pinning chance high as the count goes down.
    set('folds.chance', folds >= 1 ? Math.min(1, 0.45 + 0.2 * folds) : 0);
  }

  if (c.edge) {
    const e = { clean: { deckle_px: 0, wobble_px: 2, tear_px: 0 },
                deckle: { deckle_px: 7, wobble_px: 6, tear_px: 0 },
                torn: { deckle_px: 3, wobble_px: 8, tear_px: 10 } }[c.edge];
    if (e) { set('edge.enabled', true); Object.entries(e).forEach(([k, v]) => set(`edge.${k}`, v)); }
    else unavailable.push('edge');
  }

  const lift = num(c.lift);
  if (lift !== null) {
    set('shadow.enabled', lift > 0.01);
    set('shadow.offset_px', lerp(1, 20, lift));
    set('shadow.blur_px', lerp(4, 26, lift));
    set('shadow.darkness', lerp(0.2, 0.8, lift));
  }

  // Stains need somewhere to be. Most blocks were authored without marks, so
  // raising this on one of them would move a slider and change nothing -- the
  // dead-knob failure again. If the block has no marks of its own, the control
  // places two: a mug set down twice, which is what the request actually means.
  const stain = num(c.stain);
  if (stain !== null) {
    set('stains.enabled', stain > 0.01);
    set('stains.amount', stain);
    if (!hasStains) {
      set('stains.marks', [
        { x: 0.68, y: 0.24, r_mm: 26, strength: 0.6, kind: 'ring' },
        { x: 0.32, y: 0.71, r_mm: 16, strength: 0.4, kind: 'ring' },
      ]);
    }
  }

  // --- ink ------------------------------------------------------------------
  // These need content. Reporting them rather than applying them is the point:
  // a knob that silently does nothing is worse than one that says it cannot.
  for (const [key, path, scale] of [
    ['bleed', 'ink.bleed_mm', 0.5],
    ['show-through', 'ink.show_through', 0.2],
    ['fold-crack', 'ink.fold_crack', 1],
  ]) {
    const v = num(c[key]);
    if (v === null) continue;
    if (!hasInk) { unavailable.push(key); continue; }
    set(path, v * scale);
  }

  const seed = num(c.seed);
  if (seed !== null) set('page.seed', seed);

  return { params: p, unavailable };
}

/**
 * `tone.paper` is sRGB scaled to 0-1, not linear light, which is easy to get
 * wrong from a hex string and produces a washed-out sheet when you do.
 */
export function hexToLinearish(hex) {
  const h = String(hex).replace('#', '');
  const s = h.length === 3 ? h.split('').map((x) => x + x).join('') : h;
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16) / 255);
}

export function toHex(rgb) {
  if (!Array.isArray(rgb)) return '#ffffff';
  return '#' + rgb.map((v) =>
    Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('');
}
