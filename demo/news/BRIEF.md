# Brief: a paper-rendered news site

You are designing and building components for a **news website** whose entire
surface is rendered paper. Not a paper *texture image* — a real WebGL2 paper
simulation with cockle relief, formation grain, cast shadows, torn deckle edges
and Kubelka-Munk ink.

Your job: **20 distinct components**, built and working, in one self-contained
HTML page.

## The palette

Creams and whites, plus whatever genuinely complements them. The paper itself is
`#FFF3DE` cream by default and you can retint it per element. Suggested range,
not a cage:

- paper: warm creams `#FFF3DE`, `#F7F1E3`, cooler `#FAFAF7`, aged `#F0E4CC`
- ink: near-black warm `#14110D`, softer `#564E43`, faded `#8A7F6D`
- accents that sit well on cream: newsprint red `#B03A2E`, ochre `#C8A06A`,
  ink-blue `#2E4756`, sage `#7D8C7C`
- the page *behind* the paper: choose deliberately. A dark ground makes sheets
  glow and read as objects; a light ground makes them read as one continuous
  surface. Both are valid, pick one and commit.

Avoid: pure `#FFFFFF` paper (kills the whole point), saturated brand colours,
gradients that fight the paper's own lighting.

## paperweb API

Load from `../../src/index.js` (your page lives in `demo/news/`).

```js
import { Paper, scan, presetNames, capabilities } from '../../src/index.js';

new Paper(element, {
  preset: 'paper',      // see presets below; omit for defaults
  params: {},           // deep-merged over the preset, full tree below
  content: 'behind',    // 'behind' | 'rasterize' | an <img>/<canvas>/url
  overhang: 'grow',     // 'grow' | 'inset' | 'clip'
  dpi: 96,              // nominal CSS px/inch; drives every mm value
  maxDpr: 2,
  light: 'static',      // or 'pointer' — light follows the cursor
  seed: null,           // auto per instance; pin for a reproducible sheet
  lazy: true,           // defer first render until near viewport
  onError: (msg) => {},
});
```

Declarative, no JS per element:

```html
<div data-paper="worn" data-paper-light="pointer" data-paper-dpi="120">…</div>
<script type="module">
  import { scan } from '../../src/index.js'; scan();
</script>
```

Any `data-paper-*` attribute becomes an option. Values are JSON-parsed when they
look like JSON, so `data-paper-params='{"tone":{"paper":[1,0.95,0.87]}}'` works.

### Presets

`paper` (clean default) · `reading` (long-form, quieter) · `subtle` (barely
there, for UI chrome) · `textured` (art paper, Gabor grain, deckle edge) ·
`worn` (crumple, folds, scratches, torn edge) · `pronounced` (relief pushed
hard) · `surface` · `paperlab` · `Interesting`

### The parameter tree (all optional, deep-merged)

```js
{
  page:    { dpi: 96, margin_mm: 16, seed: 0, legacy: 2 },
  tone:    { paper: [1,0.953,0.871], highlight: [1.02,1,0.96],
             shadow: [0.90,0.92,0.98], duotone: 0.5, opacity: 1 },
  ink:     { kubelka_munk: true, thickness: 1, granulation: 0 },
  light:   { azimuth_deg: 116, altitude_deg: 50, relief_exaggerate: 7,
             specular: true, spec_intensity: 0.5, spec_power: 40 },
  cockle:  { enabled: true, wavelength_mm: 30, amplitude_um: 22,
             anisotropy: 2.2, md_angle_deg: 0, irregularity: 0.9,
             facet: 0, facet_scale_mm: 7 },
  formation:{ enabled: true, scale_mm: 2.5, amplitude: 0.02, gsm_amount: 0.7,
             skew: -0.3, source: 0 },        // source 1 = Gabor, toothier
  fade:    { enabled: true, scale_mm: 60, amount: 0.7 },
  mould:   { enabled: false, laid_pitch_mm: 1.1, chain_pitch_mm: 26,
             angle_deg: 0, amount: 0.012, chain_ratio: 0.35, wander: 0.6 },
  scratches:{ enabled: false, density: 0.03, lightness: 0.15, scale_mm: 3 },
  imperfect:{ enabled: false, pit_density: 0.03, mark_density: 0.02 },
  folds:   { enabled: false, count: 3, depth: 0.4, sharpness: 0.6 },
  crumple: { enabled: false, scale_mm: 9, amplitude_um: 60, crease: 0.3,
             irregularity: 0.85 },
  cavity:  { enabled: true, radius_mm: 0.8, lambda: 0.6 },
  shadow:  { enabled: true, offset_px: 9, blur_px: 14, darkness: 0.7,
             contact: 0.7 },
  edge:    { enabled: true, wobble_px: 6, curl: 0, deckle_px: 0, radius_px: 0 },
}
```

### Things worth knowing

- **`light: 'pointer'`** makes the light rake across the relief as the cursor
  moves. Only 2 of 12 passes re-run. It is the single most alive-feeling option;
  the owner specifically loves it. Use it, but not on all 20.
- **`mould`** adds laid + chain lines from the wire mould — real two-direction
  paper structure. A "wove" setting the owner liked:
  `{ enabled: true, laid_pitch_mm: 0.55, chain_pitch_mm: 0.55, chain_ratio: 0.5,
     amount: 0.016 }`
- **`edge.deckle_px`** (try 8–14) gives a torn fibrous edge. Great for clippings.
- **`edge.radius_px`** matches a CSS `border-radius` so the sheet follows a
  rounded box.
- **`folds` / `crumple`** for creased, pocketed, screwed-up-and-flattened paper.
- **`content: 'rasterize'`** puts the text optically INSIDE the sheet via
  Kubelka-Munk, so ink takes the paper's shading. Costs interactivity (the
  element's own children are hidden) — use on 1–3 showpieces, never on
  navigation or anything clickable.
- **`tone.paper`** is plain sRGB divided by 255, not hex and NOT linear-light.
  `#F0E4CC` → `[240/255, 228/255, 204/255]` = `[0.94, 0.89, 0.80]`. The default
  `[1, 0.953, 0.871]` is exactly `#FFF3DE`. Author it by dividing your hex.
- **`dpi`** changes the physical scale of the relief. Low (48–72) = coarse
  buckling, good for big sheets. High (150–200) = fine grain, good for small
  cards.
- **`overhang`** — `'grow'` (default) lets the cast shadow fall outside the
  element, which is what makes sheets read as objects. It requires
  `html { overflow-x: clip }` on your page or the page scrolls sideways. Use
  `'inset'` inside anything with `overflow: hidden`.

### Hard requirements

1. `html { overflow-x: clip }` in your CSS.
2. Rotation: **do not** apply CSS `transform: rotate()` to a papered element and
   expect the shadow to follow — the canvas rotates with it, which is usually
   fine, but the cast shadow direction will no longer match the light. For
   pinned/scattered looks this is acceptable and looks good; just know it.
3. Keep it to roughly 20–30 papered surfaces on the page. Each is a real render.
4. Real semantic HTML. Headlines are `<h1>`–`<h3>`, articles are `<article>`,
   nav is `<nav>`. Text must stay selectable except on deliberate `rasterize`
   showpieces.
5. Accessible: readable contrast on cream, focus states on anything interactive,
   `prefers-reduced-motion` respected for anything that moves.
6. No external assets. No CDN, no webfonts, no images. System font stacks only
   (serif stacks read as newsprint: `"Iowan Old Style", "Palatino Linotype",
   Palatino, Georgia, serif`). If you want an image, draw it as inline SVG or CSS.

## Deliverable

One file: `demo/news/<your-name>.html`, self-contained apart from importing
paperweb. It should read as a **showcase page**: each of your 20 components in
its own labelled section, with a short caption naming the idea and the paperweb
settings that make it work. Someone should be able to scroll it and immediately
see 20 different things they could steal.

Verify before you finish:

```bash
node tools/checkpage.mjs demo/news/<your-name>.html
```

That renders your page on the real GPU and reports console errors, broken
layout, horizontal overflow and how many surfaces actually rendered. Fix
anything it flags. It also writes a screenshot you should look at with the Read
tool — actually look at it, and iterate if it is ugly or if components collide.

## What "go wild" means here

Twenty ideas that are genuinely *different from each other*, not twenty cards
with different text. Vary: the physical metaphor (pinned, taped, folded, stacked,
torn, spiked, clipped), the scale (thumbnail to full-bleed), the paper stock
(newsprint, index card, tissue, cardstock, tracing paper), the interaction, and
the editorial function (headline, ticker, weather, obituary, classified, letter
to the editor, correction notice, crossword, stock table, photo caption).

Be specific to news. A generic "card" is a wasted slot.
