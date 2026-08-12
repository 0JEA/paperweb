# paperweb

Every paper-rendering effect from [paperlab](https://github.com/0JEA/paperlab),
applied to DOM elements. WebGL2, no dependencies, no build step.

```js
import { Paper } from './src/index.js';
new Paper(document.querySelector('.card'), { preset: 'paper' });
```

or with no per-element JavaScript at all:

```html
<div data-paper="worn">…</div>
<script type="module">
  import { scan } from './src/index.js'; scan();
</script>
```

Open `demo/index.html` (`npm run demo`) to see all nine presets, every effect in
isolation, and both ink modes.

## What it renders

The same twelve-draw pass graph as paperlab, with the same research-grounded
defaults:

```
height  ->  heightblur  ->  cavity
height  ->  normal      ->  shade  (+ cavity)
albedo
mask    ->  shadowT (tight blur)
        ->  shadowW (wide blur)
composite(content, shade, albedo, mask, shadowT, shadowW, cavity)
```

| effect | what it is | source |
|---|---|---|
| cockle | organic 16-34 mm buckling, crests along the machine direction | Land 2004 |
| formation | mid-scale mass clumping as a Gaussian scale mixture | CSF peak 1-3 mm |
| Gabor formation | band-limited alternative with a spectral peak, not 1/f | Lagae et al. 2009 |
| RPN tile | a random-phase bake of a real scan | Galerne 2011 |
| cavity shading | `blur(h) - h`, the discrete Laplacian: the one term that escapes the emboss | Luft et al. 2006 |
| specular | cockle's real signal is gloss off the crests | |
| non-stationary fade | big-scale cubed mask; its absence is the biggest "procedural" tell | |
| crumple | all-over facet/crease network | Worley 1996 |
| folds | a few deliberate pressed creases | |
| scratches | sparse, mostly LIGHT (fibre lift), a fraction dark | |
| imperfections | pits and rarer larger blotches, each randomising its own size | |
| deckle edge | clustered envelope x along-edge carrier, feathered into fibre tufts | Portilla & Simoncelli, Group C |
| cast shadow | contact-hardened: tight core, soft halo | |
| duotone | warm highlights, cool shadows, because a scalar cannot hue-shift | |
| Kubelka-Munk ink | ink as an absorbing layer OVER the lit paper, not painted on it | Curtis et al. 1997 |
| granulation | pigment pools in the relief valleys | Curtis et al. 1997 |
| stains | dark ring, pale interior, and a dish with a swollen rim | Deegan et al. 1997 |
| foxing | rusty age spots, clustered by damp rather than scattered | |
| stamps | a rubber die that inks off the paper's HIGH points | |
| show-through | reverse-side type coming faintly through thin stock | |
| dot gain | ink wicking along the fibres, so strokes fatten | |
| fold cracking | the dried ink film flaking off along a crease | |

### The newsprint preset

`preset: 'newsprint'` bundles the whole newspaper look: greyer stock, coarse
formation, a couple of hard folds, dot gain, show-through and ink cracking along
the creases. The three ink effects only do anything when the surface has content
to act on, so on a `content: 'behind'` surface you get the paper and the folds
and nothing else, which is correct rather than broken. `demo/newsprint.html`
shows each of them against an otherwise identical sheet.

Cracking is the one worth reaching for on its own: `ink.fold_crack` needs only a
crease and some solid ink, and it is the single strongest "this is old print"
signal in the library.

## Content modes

The one thing the web cannot do is sample live DOM in a shader. There are three
answers, and you pick per element.

**`content: 'behind'` (default)** puts the canvas behind untouched, selectable,
accessible DOM text. You get every effect except ink coupling. This is the mode
for anything a user reads or interacts with.

**`content: 'rasterize'`** snapshots the element through an SVG `foreignObject`
and feeds it in as the content texture, so text is optically *inside* the sheet:
thin antialiased edges let the lit, textured paper show through, and granulation
pools pigment in the relief valleys. Opt-in, because DOM rasterisation is
genuinely unreliable: styles have to be inlined, external fonts and images must
already be data URIs, any cross-origin image taints the canvas, and Safari has a
long history of dropping webfonts in `foreignObject`. So the snapshot is
validated (loads, readable, not uniformly blank) and **falls back to `'behind'`
on any failure**, restoring the element's own content. It never leaves a blank
element.

**`content: <img|canvas|url>`** uploads a source directly. Full ink coupling,
none of the rasterisation risk. The reliable way to get Kubelka-Munk.

## API

```js
const p = new Paper(el, {
  preset: 'paper',     // any of presetNames; omit for defaults
  params: {},          // deep-merged over the preset
  content: 'behind',   // 'behind' | 'rasterize' | HTMLImageElement | HTMLCanvasElement | url
  seed: null,          // which sheet of paper; auto-assigned per instance
  overhang: 'grow',    // 'grow' | 'inset' | 'clip'  (see Layout below)
  dpi: 96,             // nominal CSS px per inch; drives every mm value
  maxDpr: 2,           // cap on devicePixelRatio
  light: 'static',     // or 'pointer'
  watch: false,        // re-snapshot rasterized content on resize
  lazy: true,          // defer first render until near the viewport
  retain: false,       // keep GPU targets alive between renders
  onError: (msg) => {},
});

p.set({ light: { azimuth_deg: 60 } });  // re-runs only the affected passes
p.set({ preset: 'newsprint' });         // rebuilds from the preset, keeps the seed
p.render();
p.setContent(imgElement);
p.buffer('Height');                     // ImageData of any pass; needs retain: true
p.floats('Shade');                      // raw Float32Array; needs retain: true
p.destroy();                            // fully restores the DOM
```

`scan(root?, defaults?)` binds every `[data-paper]` element. Any `data-paper-*`
attribute becomes an option, JSON-parsed when it looks like JSON.

React, from a separate entry so the core stays dependency-free:

```jsx
import { PaperSurface, usePaper } from './src/react.js';
<PaperSurface preset="paper" className="card">…</PaperSurface>
```

## How it differs from paperlab

Seven intentional divergences, all of them because a web page is not a desktop
inspector.

**The height buffer is in micrometres, not millimetres.** On the half-float
fallback path, mm-scale values (about ±0.011) quantise at roughly 0.05% relative,
and `normal` takes a central difference of two of them, which destroys the slope.
In µm the values are about ±11 and the difference survives.

**Passes are dirty-flagged.** paperlab re-renders all twelve draws every frame to
drive its ImGui panel. Here a surface usually renders exactly once, with no
`requestAnimationFrame` loop. Moving the light re-runs 2 passes out of 12.

**The mask runs at full resolution.** paperlab keeps every field at half res,
which is fine when the sheet is 1275 px wide. A 300 px card has only 150 px of
half-res silhouette, and the deckle fringe aliases into a hard comb against the
page background.

**Edge frequencies are per millimetre, not per pixel.** paperlab ties the deckle
carrier and the silhouette wobble to the render resolution, so the same sheet at
another DPI grows or shrinks its fibres. The constants here are paperlab's own,
converted at its native 150 DPI, so the look is preserved and only the coupling
to resolution is removed.

**There is an alpha channel.** paperlab always paints an opaque void because it
is a desktop inspector. On a page the void has to be transparent so the sheet
composites over whatever is behind it, so the cast shadow writes alpha rather
than darkening a void colour, and the output is premultiplied.

**The noise hash is an integer bit-mixer.** paperlab's float hash is exactly
periodic on the integer lattice (123.34 x 50 and 345.45 x 20 are both whole
numbers, so it repeats identically every 50 steps in x and 20 in y), which tiled
every noise field at 472 x 189 canvas px. Replaced with PCG's output hash.

**formation.skew was fixed.** paperlab applies `skew * (f * abs(f) - 0.15)`, and
`f * abs(f)` is an odd function, so a negative coefficient shrinks both tails
equally: contrast compression, not skew. Measured histogram skew was 0.0102 at
skew 0 and 0.0103 at skew -1.0 while sd collapsed. Now uses an even function of
f, normalised so it stays comparable to f at any amplitude. Real formation has a
longer dark tail, because fibre flocs read darker than the gaps read light.

Everything else is the same arithmetic, including the comments that record why
each term exists.

## Every surface is its own sheet

paperlab renders one sheet, so all of its seeds are constants. Rendering many
sheets from those constants gives a page where every card is the same piece of
paper, and the fold layer is the loudest tell: its creases are placed in
*sheet-relative* coordinates, so before this was fixed the identical crease ran
across the middle of every sheet at every size (measured ridge at height
fraction 0.50 / 0.52 / 0.50 / 0.56 across four sizes), and four presets shipped
the same `folds.seed`.

Each `Paper` now takes a `seed`, assigned per instance, that offsets the sample
position into the noise fields and perturbs each layer's own seed. Cockle,
formation, fade, scratches, imperfections, crumple, fold angles and the torn
edge all differ between surfaces.

The seed is a **counter, not a random number**, so a surface looks the same on
every reload. Pin it to reproduce a specific sheet:

```js
new Paper(el, { preset: 'worn', seed: 41 });   // same sheet every time
```

Folds are the one layer the offset cannot vary, because sliding the sample
position would push every crease off the sheet; their variation comes through
the fold seed instead.

## Scale model

`page.dpi` (default 96) is the nominal resolution, so `px_per_mm = dpi / 25.4`.
paperlab's millimetre defaults then land at sensible CSS sizes, and changing
`dpi` changes the *physical* size of the relief rather than scaling a bitmap.
The element's border box is the sheet; when the cast shadow is on, the canvas is
grown beyond it by `offset_px + 2 * blur_px` (capped at `page.margin_mm`) so the
shadow has void to fall on.

## Performance

One shared WebGL2 context for the whole page, because browsers cap live contexts
at around 16. Each surface renders through it and copies the result to its own 2D
canvas, so instances hold pixels rather than GPU contexts. Static surfaces hand
their render targets back to a pool immediately, so a page of thirty sheets holds
one sheet's worth of VRAM. `IntersectionObserver` defers the first render until
an element is near the viewport.

The Gabor formation source is a 27-iteration inner loop per pixel and is the one
genuinely expensive pass. It is off by default; only the `textured` preset uses
it.

## Fallbacks

- No `EXT_color_buffer_float` but half-float present: R16F targets.
- No WebGL2 at all: the surface no-ops and the element gets a flat `tone.paper`
  background colour.
- `prefers-reduced-motion`: `light: 'pointer'` is forced to `'static'`.
- Rasterisation failure: falls back to `content: 'behind'` and reports via
  `onError`.

## Showcase: a news site made of paper

`demo/news/` is 80 components across four directions, built to see how far the
library goes on real editorial furniture. Open `demo/news/` after `npm run demo`.

| page | direction |
|---|---|
| `desk.html` | the physical newsroom: pinned leads, a spike, index cards, carbon flimsies, fanfold wire copy, a marked page proof |
| `broadsheet.html` | print typography: front page above the fold, crossword, TV grid, agate, halftone photo, rasterized ink |
| `archive.html` | time and evidence: taped cuttings, redacted FOI, photocopy of a photocopy, tissue over a front page |
| `product.html` | contemporary interface: sticky masthead, ticker, live blog, paywall, poll, podcast player, dark mode for paper |

`demo/news/BRIEF.md` is the brief they were built from and doubles as a
practical guide to the API. Recipes worth knowing that came out of building them:

- **`clip-path` on the host clips the canvas too**, which is how you get a folder
  tab or a cut tag corner from one surface. Pair it with `overhang: 'clip'` and a
  CSS `drop-shadow()`, since a grown cast shadow gets sliced by the same path.
- **A child painted in the page's ground colour reads as a punched hole**,
  because the sheet genuinely is behind it.
- **`mix-blend-mode: multiply` children blend against the paper render**, because
  the host gets `isolation: isolate`. Highlighter, coffee rings and ink washes
  just work.
- **The element's own `background` is invisible** for the same reason: the canvas
  sits above it at `z-index: -1`. Ruled lines and shading must be child elements.
- **Legibility on crumpled stock dies from gloss, not relief.**
  `light.spec_intensity 0.28-0.32` with `spec_power ~50` keeps the creases and
  stops ridges blowing out to white.
- **Grid gaps must exceed twice the shadow margin** (`offset_px + 2 x blur_px`)
  or neighbouring cast shadows overlap and double-darken.
- **Rotation and sizing fight.** paperweb measures from `getBoundingClientRect`,
  which for a rotated element is the rotated bounding box, so a 6 degree tilt
  makes the sheet oversized and off-centre. Render first, let the ResizeObserver
  settle, then apply the tilt. Do not put `light: 'pointer'` on a tilted sheet.
- **A surface inside `display: none` measures zero and renders nothing**, and
  stays that way. Bind it with `{ lazy: false }` when the container first opens.

## Blocks

The 52 approved showcase components are also a component library. One custom
element reads a manifest, so a block is data rather than a bespoke class:

```html
<script type="module">import 'paperweb/src/blocks/paper-block.js';<\/script>

<paper-block type="desk-16" stock="worn" age="0.6" fold-crack="1" width="320">
  <span slot="headline">Council votes to keep the mural</span>
</paper-block>
```

Fifteen controls apply to every block: `stock`, `paper`, `duotone`, `age`,
`relief`, `folds`, `edge`, `lift`, `stain`, `bleed`, `show-through`,
`fold-crack`, `width`, `rotate`, `seed`. Anything that does not apply to all 52
is a per-block fixture, not a control. An unset control leaves the block exactly
as authored, so the defaults are always the hand-tuned ones.

`age` and `relief` are COMPOUND: one control moving several parameters along a
curve, because "make it older" is the actual request and nobody thinks in
`pit_density`. Individual parameters remain reachable underneath.

Three controls need ink to act on (`bleed`, `show-through`, `fold-crack`). On a
`content: 'behind'` block the text is live DOM on top of the canvas, so there is
nothing for them to touch; the element reports them through `.unavailable` and
the studio greys them out rather than accepting them silently.

`demo/studio.html` is the studio, and it works one piece at a time: pick a
SHAPE from live thumbnails, edit its text, and turn the paper, trim, wear and
type on the right. Sixteen shapes carry identical sample copy, so the picker
compares silhouettes rather than comparing an obituary against a crossword; the
52 converted components are on a second tab. `node tools/build-blocks.mjs`
regenerates the manifest.

## Tools

```
node tools/checkpage.mjs <page>   render on the real GPU; fail on console errors,
                                  blank surfaces, overflow, illegible text
node tools/crop.mjs <page> <y>... 1:1 slices for judging detail
node tools/thumbs.mjs             gallery thumbnails for demo/news
```

All three drive Chromium through ANGLE/Vulkan rather than SwiftShader, on
purpose: part of paperweb's relief character comes from how the shader compiler
quantises the noise hash, and software rasterisers do not reproduce it. A
SwiftShader capture is not evidence of what a page looks like. Screenshots go to
`screenshots/`, override with `PAPERWEB_SHOTS`.

## Tests

```
npm test              # 15 unit tests, node:test
npm run test:browser  # 52 invariant tests in headless chromium (SwiftShader)
```

The browser tests read the intermediate float buffers back and assert properties
that follow from the physics, not from whatever the shaders happen to output: a
flat sheet has a shade of exactly 1.0 and a height of exactly 0; the composite
centre equals `tone.paper` within 1/255; cockle relief scales linearly with
`amplitude_um`; the cavity is a signed, near-zero-mean Laplacian; flipping the
light 180 degrees produces an equal and opposite shading deviation; an
incremental re-render matches a fresh one exactly.

They also cover the parts that are not physics: that `content: 'behind'` leaves
the text visible and out of the accessibility tree's way, that a failing content
source degrades to `'behind'` rather than blanking the element, that `destroy()`
fully restores the DOM, that every preset renders, and that the three `overhang`
modes really do or do not stick out past their element.

**Not established:** pixel parity with the C++ renderer. paperlab is not built on
this machine, so any claim of visual equivalence is by construction (the same
shader maths) rather than measured.

## Layout

The cast shadow needs void to fall on, and how it gets that room is the one
place paperweb has to negotiate with your page. An absolutely-positioned box
that sticks out past its element contributes to the **root scroller's** overflow,
so a full-width surface makes the page scroll sideways. Three modes:

| `overhang` | canvas | shadow | page overflow |
|---|---|---|---|
| `'grow'` (default) | extends past the element by `offset_px + 2·blur_px`, capped at `page.margin_mm` | full | yes, unless you clip |
| `'inset'` | exactly the element | full | none |
| `'clip'` | exactly the element | none | none |

With the default, add one line:

```css
html { overflow-x: clip; }
```

`clip`, not `hidden`: it creates no scroll container and does not break
`position: sticky`.

`'inset'` keeps the canvas inside the element and shrinks the sheet instead,
adding matching padding to the element so its content stays on the paper. The
padding is restored on `destroy()`. `'clip'` fills the element with sheet, so
there is no void and no cast shadow, though the wobbly silhouette still cuts a
thin band at the edge rather than leaving a hard rectangle.

A parent with `overflow: hidden` clips the `'grow'` shadow; use `'inset'` there.
