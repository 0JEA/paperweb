# paperweb — design spec

**Date:** 2026-08-08
**Status:** implemented and verified 2026-08-08. See README.md for the shipped API; this document records the design as agreed, plus the amendments found during the build (below).
**Source of truth for the effects:** `github.com/0JEA/paperlab` (C++/OpenGL 4.6)

## Purpose

Port paperlab's complete paper-rendering pipeline to the web as a dependency-free
ESM library that binds to any DOM element, so every effect paperlab implements can
be applied to real website content.

## Non-goals

- No in-browser live tuning panel (the ImGui port). Params are set in code/JSON.
- No baked-PNG / CSS static fallback pipeline. Absent WebGL2, the library no-ops
  to a flat `tone.paper` background colour.
- No pixel-parity guarantee against the C++ renderer (see Verification).

## Architecture

Seven modules. Zero runtime dependencies. No build step required: shaders ship as
JS modules exporting template literals, so the library loads directly from source
via `<script type="module">`.

```
src/
  gl/context.js    shared WebGL2 context, extension probe, precision ladder
  gl/program.js    compile/link, uniform-location cache, setUniforms
  gl/fbo.js        float render targets + pooled allocation
  shaders/*.js     the 9 ported shaders + common prelude, as template literals
  params.js        full param tree, paperlab-identical defaults + JSON schema
  presets.js       the paperlab presets, embedded
  km.js            Kubelka-Munk a/b/S derivation (port of app.cpp:370-381)
  pipeline.js      the pass graph, dirty-flagged
  content.js       the three content modes -> a content texture
  paper.js         public element-binding API
  scan.js          declarative [data-paper] scanner
  index.js         entry
  react.js         <PaperSurface> + usePaper (separate entry, core stays dep-free)
```

### The pass graph

Identical topology to `App::render()`:

```
height  ->  heightblur  ->  cavity
height  ->  normal      ->  shade  (+ cavity)
albedo
mask    ->  shadowT (tight blur)
        ->  shadowW (wide blur)
composite(content, shade, albedo, mask, shadowT, shadowW, cavity)
```

12 full-screen draws total (blur is separable, run twice per target).

**Dirty flagging.** Each pass declares the param groups it reads. Setting a param
marks dependent passes dirty; `render()` re-runs only those. Default behaviour is
render-once on bind, with no `requestAnimationFrame` loop. This is the main
departure from the C++ app, which re-renders continuously for the ImGui panel.

Dependency table:

| pass       | param groups |
|------------|--------------|
| height     | page, cockle, folds, crumple |
| heightblur | height + cavity.radius_mm |
| cavity     | heightblur |
| normal     | height + light.relief_exaggerate |
| shade      | normal, cavity, light |
| albedo     | page, formation, fade, scratches, imperfect |
| mask       | page, edge |
| shadowT/W  | mask + shadow.blur_px |
| composite  | everything above + tone, ink, shadow |

### One shared GL context

Browsers cap live WebGL contexts at roughly 16, so a per-element context does not
scale. Instead:

- one module-global WebGL2 context on an offscreen canvas,
- one shared set of compiled programs,
- an FBO pool sized to the largest live element,
- each instance's finished composite is copied out to its own 2D canvas via
  `drawImage`, so instances hold pixels rather than GPU contexts.

The shared canvas is resized to the current instance's dimensions before each
render. Renders are serialised through a microtask queue.

### Height is stored in micrometres

paperlab stores the height field in millimetres. On the half-float fallback path,
mm-scale values (about +/-0.011) quantise at roughly 0.05% relative, and
`normal.frag` takes a central difference of two of them, which destroys the slope.
Storing micrometres puts the values at about +/-11, where the difference survives.
`normal.frag` converts back to mm before computing physical slope. This is the one
intentional numerical divergence from the C++ source.

### Precision ladder

1. `EXT_color_buffer_float` + `OES_texture_float_linear` -> `R32F` / `RGBA16F`
2. `EXT_color_buffer_half_float` -> `R16F` / `RGBA16F`
3. neither -> library no-ops, element gets `background-color: tone.paper`

### Scale model: nominal DPI, element-sized

- `dpi` option, default 96 (CSS px per inch), so `px_per_mm = dpi / 25.4 = 3.7795`.
  paperlab's research-grounded mm defaults then map to sensible CSS-px sizes.
- Backing store = element rect x `min(devicePixelRatio, maxDpr)`, `maxDpr` default 2.
- When `shadow.enabled`, the canvas is inset negatively by `margin_mm` so the cast
  shadow has void to fall on, and `page_rect` is the element's own box within that
  larger canvas. When shadow is off, `page_rect` is the whole canvas.
- `ResizeObserver` re-runs only size-dependent passes, debounced 100ms.
- `IntersectionObserver` (rootMargin 200px) defers the first render until near
  viewport.

### Content modes

`content: 'behind'` (default)
: The canvas is inserted as an absolutely-positioned first child at `z-index: 0`
  with the element forced to `position: relative` and its own children raised to
  `z-index: 1`. DOM text is untouched, selectable, and accessible. `u_content` is
  bound to a 1x1 white texture, so `c = 1` everywhere and the composite reduces to
  the lit paper substrate. Every effect except ink coupling.

`content: 'rasterize'`
: The element's subtree is serialised into an SVG `<foreignObject>` with computed
  styles inlined and same-origin fonts/images embedded as data URIs, rasterised to
  an `<img>`, and uploaded as the content texture (luminance -> R). The element's
  own children are then hidden with `visibility: hidden` so only the composited
  canvas is visible. Full Kubelka-Munk and granulation: text sits inside the sheet.
  Re-snapshots on resize when `watch: true`.

  **Failure handling is part of the contract.** foreignObject rasterisation is
  historically unreliable in Safari with webfonts, and any cross-origin image
  taints the canvas. The mode validates its own output (image loads, canvas is
  readable, raster is not uniformly blank) and falls back to `'behind'` on any
  failure, restoring child visibility. It never leaves the element blank.

`content: <HTMLImageElement | HTMLCanvasElement | string>`
: Uploaded directly as the content texture. Full ink coupling. A string is treated
  as a URL and loaded with `crossOrigin = 'anonymous'`.

### Public API

```js
import { Paper, scan, presets } from './src/index.js';

const p = new Paper(el, {
  preset: 'paper',            // or omit for defaults
  content: 'behind',
  dpi: 96,
  maxDpr: 2,
  light: 'static',            // or 'pointer'
  watch: false,
  params: { cockle: { amplitude_um: 40 } },   // deep-merged over the preset
});

p.set({ light: { azimuth_deg: 60 } });   // marks dirty, re-renders affected passes
p.render();                              // force
p.buffer('Height');                      // ImageData of any intermediate, for debug
p.destroy();
```

Declarative:

```html
<div data-paper="worn" data-paper-content="behind" data-paper-dpi="120">…</div>
<script type="module">
  import { scan } from '/paperweb/src/index.js'; scan();
</script>
```

`light: 'pointer'` maps cursor position to `light.azimuth_deg` / `altitude_deg` and
re-runs only shade + composite (2 of 12 passes) on a rAF-throttled pointermove.
Respects `prefers-reduced-motion`, which forces `'static'`.

### React wrapper

Separate entry `src/react.js`, imports the core. `<PaperSurface preset content
params>{children}</PaperSurface>` renders a div, binds a `Paper` on mount, calls
`set()` on param change, `destroy()` on unmount. Plus `usePaper(ref, opts)`.

## Verification

Per the project rule that aggregate green tests are not proof, each claim is
labelled by what it actually establishes.

**Unit (`node:test`), proves real logic:**
- Kubelka-Munk `a/b/S` derivation against values computed by hand from the
  paperlab defaults.
- mm/px conversion at several DPIs.
- deep param merge and preset loading; every shipped preset parses into a complete
  param tree with no missing fields.

**Browser invariants (Playwright + cached chromium), proves the pipeline:**
- all effects disabled -> `Height` buffer is exactly 0, `Shade` is exactly 1.0,
  composite equals `tone.paper` within 1/255.
- cockle enabled -> `Height` RMS matches `amplitude_um` within tolerance.
- `Mask` is ~1 well inside `page_rect` and ~0 outside it.
- `content:'behind'` leaves DOM text present and selectable in the accessibility
  tree.
- rasterize failure path degrades to `'behind'` with children visible.

**Not established:** pixel parity with the C++ renderer. The paperlab binary is not
built on this machine and building it is out of scope. Any claim of visual
equivalence is by construction (same shader maths), not measured.

**Eyeball:** `demo/index.html` renders every preset against every content mode.

## Risks

1. foreignObject rasterisation is the least reliable component. Mitigated by the
   validate-and-degrade contract above; it is opt-in and never the default.
2. Sharing one GL context serialises renders. With many elements the first paint
   is staggered. Mitigated by IntersectionObserver so only visible elements render.
3. `gaborNoise` is a 3x3x3 = 27-iteration inner loop per pixel. At full DPR on a
   large hero element this is the most expensive pass. It is off by default
   (`formation.source = 0`, fbm) and only the `textured` preset enables it.


---

## Amendments made during implementation

Four things the design did not anticipate, each found by rendering the thing and
looking at it.

**The mask moved to full resolution.** The design inherited paperlab's
half-resolution effect fields for every pass. That is fine when the sheet is
1275 px wide; a 300 px card has only 150 px of half-res silhouette, and the
deckle fringe aliased into a hard black comb against the page background. The
mask is the sheet's outline and the crispest thing in the image, so it now gets
its own full-resolution target. The shadow blur reads it and downsamples in the
same pass.

**Edge frequencies are per millimetre.** paperlab denominates the deckle carrier
and the silhouette wobble per pixel, which silently ties the fringe to the render
resolution. Converted to per-mm at paperlab's native 150 DPI so the look is
preserved and only the resolution coupling is removed.

**The composite writes alpha.** Not in the original design. paperlab paints an
opaque void; on a page the void has to be transparent or the sheet cannot sit
over the site's own background. The cast shadow now writes alpha instead of
darkening a void colour, and the output is premultiplied.

**A per-surface seed was added.** The design carried paperlab's seeds over as
constants without asking what happens when there are 35 sheets instead of one.
Answer: every sheet is the same piece of paper. Two mechanisms, both measured:
folds are placed in sheet-RELATIVE coordinates so the identical crease landed at
height fraction 0.50 / 0.52 / 0.50 / 0.56 across four different sizes, and four
presets shipped `folds.seed = 3`; everything else is placed in absolute mm, so
two sheets of the same size were byte-identical. Fixed with a `page.seed` that
offsets the sample position into the noise fields (decorrelating every
position-based layer at once) and perturbs each layer's own seed (so fold angles
differ too, since an offset alone would slide the creases off the sheet). The
seed is a counter rather than a random number so a surface survives a reload
unchanged.

**`overhang` was added.** The design assumed the canvas would always grow past
the element to give the shadow void to fall on. Measured at a 390 px viewport,
that made the page scroll sideways by exactly the margin (41 px), because an
absolutely-positioned box sticking out past its element contributes to the root
scroller's overflow. Rather than silently mutating the host page, the mode is now
explicit: `'grow'` (default, needs `html { overflow-x: clip }`), `'inset'`
(canvas matches the element, sheet shrinks, element gets matching padding), and
`'clip'` (sheet fills the element, no shadow).

## Verification outcome

- 15 unit tests (`node:test`): Kubelka-Munk derivation against an independent
  longhand implementation of the published formulae, the full legal (Rw, Rb)
  domain swept for real/finite output, degenerate inks clamped rather than NaN,
  mm/px conversion, deep merge, and every shipped preset resolving to a complete
  tree with no NaN or null leaves.
- 52 browser invariant tests in headless chromium on SwiftShader, reading the
  intermediate float buffers back.
- Two real bugs were caught by rendering and looking, not by the tests:
  the content texture was vertically flipped, and `inlineStyles` walked the
  source and clone by index while only the clone had paperweb's own canvas
  filtered out, shifting every child onto its sibling's styles. Both are now
  covered by tests, and the style-alignment test was mutation-tested (the bug
  reintroduced, the test observed to fail, the fix restored).
- **Not established:** pixel parity with the C++ renderer. paperlab is not built
  on this machine.
