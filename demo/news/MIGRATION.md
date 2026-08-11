# Migration: the renderer changed under these pages

Six rendering faults were fixed in `src/`. Four of them were bugs the showcase
pages had already *worked around* in their per-component `params`, so those
workarounds now fight the corrected renderer and have to come out.

Read this before touching a page, then go component by component. Do not
blanket-replace: each override was a deliberate choice about how that component
should look, and the job is to re-express the same intent against a renderer
that now behaves correctly.

## What changed, and what it means for your overrides

### 1. Highlights no longer blow out — remove the damping

A facet aligned to the half-vector used to push shade to 1.69 and clip to pure
white. There is now a shoulder rolling off toward `light.highlight_ceiling`
(1.22 by default).

Pages damped `light.spec_intensity` to 0.22–0.4 to fight this. That damping now
just removes the paper's sheen, because the blowout it was fighting is gone.

**Do:** raise damped values back toward the preset default (0.5), or delete the
override entirely and let the preset decide. Keep a deliberately low value only
where the component genuinely wants a matte, uncoated stock, and say so in the
caption. Keep a deliberately high one (the podcast player uses 0.9) where gloss
is the point — the ceiling now makes that safe.

### 2. Folds are a different shape — most depths want raising

The old fold was a Gaussian putting 68 um across 2.76 mm: 13.5x steeper than
cockle, tilting each face 11 degrees. It rendered as two flat grey bands with a
hard line, which is a roof.

A fold is now a BROAD tilt over ~14 mm at cockle-comparable amplitude plus a
NARROW crease line under a millimetre. Peak relief is `depth * 43 um` against
the old `depth * 150 um`, so **the same `depth` number is roughly a third as
deep**, and what you see is a crease rather than a bar.

**Do:** where a component wanted a visible crease, raise `folds.depth` by
roughly 2x–3x and look at it. Where a component wanted a barely-there fold,
leave it. `folds.sharpness` now controls the crease line width (1.8 mm at 0,
0.5 mm at 1) rather than the whole feature's width.

### 3. Sparse layers render whole now — halve the densities

Scratches, pits and marks used to be tested only against the pixel's own cell,
so any feature crossing a cell boundary was clipped to a hard square. They now
scan the 3x3 neighbourhood and render whole.

**The consequence: the same density looks about twice as busy**, because
features that were previously clipped to a sliver now appear in full.

**Do:**
- Roughly **halve** `imperfect.pit_density` and `imperfect.mark_density`
  everywhere, then look. The archive page runs up to 0.09 and 0.04; those will
  be far too busy now.
- **`scratches.scale_mm` must go up to ~11–13.** A 3–5 mm cell makes marks about
  1 mm long, which reads as lint. The library default is now 11.94 (zathura's
  tuned value) at a 25:1 aspect, giving scratches several millimetres long.
  Anything still at 3–5 will look wrong.
- Falloff is linear now, not smoothstep, so scratches have a crisp core.

### 4. Crumple is facets, not a crack network

Both old terms were functions of distance to the feature point, so every cell
boundary was drawn identically: a uniform polygon mesh that read as dried mud.
Each Worley cell is now its own flat tilted plane, so creases vary in prominence
because they are wherever two facets happen to meet.

The same `amplitude_um` now reads flatter and more paper-like.

**Do:** where a component wanted obvious crumple, `amplitude_um` can go up
somewhat. `crumple.crease` (0..1) still blends toward the old sharp ridge
network if a component genuinely wants crazing — the archive's photocopy and
aged stock may. `crumple.irregularity` (default 0.85) domain-warps the cells so
they are not a regular tiling.

### 5. The deckle edge is smoother — check anything above ~10

The fibre carrier used to be multiplied by the tuft envelope, so a 1 cycle/mm
carrier set the full amplitude and an 11 px deckle became a 3.8 px-pitch comb of
black teeth against a dark page. The two are now summed with the slow tuft term
dominant, and the edge feather also scales with `wobble_px`.

**Do:** deckle values should mostly stand, but look at anything at 11+ against
the dark ground. It reads as a torn edge now instead of a comb, which may mean
you want slightly more, not less.

### 6. Rasterized ink is no longer bold — check your showpieces

Kubelka-Munk drove optical thickness from the content grey. That is right for a
wash and wrong for an antialiased glyph edge, where grey means partial AREA
coverage at full ink strength. At `c = 0.5` the old path gave 0.273 where
coverage gives 0.521, so every glyph gained a dark rim and rasterized text read
bold.

`ink.coverage` now defaults to 1 (area blending). Set it to **0** on any
component whose content is genuinely a wash, a halftone or a photograph rather
than text — the broadsheet's halftone photo is the obvious candidate.

**Do:** re-look at every `content: 'rasterize'` component. Type should now be
its correct weight. If a showpiece was compensating with a reduced
`ink.thickness`, that compensation can come out.

## How to work

1. Read your page and list every component that overrides any of:
   `spec_intensity`, `folds.depth`, `folds.sharpness`, `crumple.amplitude_um`,
   `crumple.crease`, `pit_density`, `mark_density`, `scratches.scale_mm`,
   `deckle_px`, `ink.thickness`, `ink.coverage`.
2. Change them per the guidance above, using judgement per component rather than
   a global multiplier.
3. Update the caption wherever it quotes a number you changed. The captions are
   the documentation; a caption that lies is worse than no caption.
4. Verify and LOOK:
   ```
   cd /home/john/paperweb && node tools/checkpage.mjs demo/news/<page>.html
   ```
   Read the screenshot it writes with the Read tool. Actually look at it. Iterate
   until each component reads the way its caption claims.

Everything else about the pages stays as it is. This is a calibration pass, not
a redesign: do not restructure components, rewrite copy, or add new ones.
