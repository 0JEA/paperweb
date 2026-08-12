# Stains, stamps and newsprint effects — design

**Date:** 2026-08-12
**Status:** approved, implementing
**Origin:** review feedback on the news showcase. "the coffee rings dont look
right, we should work on the coffee stain and make more effects like that",
"I love the stamps and stuff too, if I give you logos can we make stamps from
them? Maybe a thing to make images into stamps even would be sweet".

## 1. Stains

### Why the current ones fail

`demo/news/desk.html` draws its coffee rings as two CSS radial gradients with
`mix-blend-mode: multiply`. They are soft, perfectly circular, and painted on
top of the sheet. Real dried stains are none of those things.

### The physics

Deegan et al., *Nature* 389 (1997), "Capillary flow as the cause of ring stains
from dried liquid drops". A drop pins at its contact line. Evaporation is
fastest at the perimeter, so liquid flows outward to replenish it, carrying
every suspended particle with it. The result is a **dark, comparatively hard
ring with a pale interior** — not a soft disc.

Three further behaviours worth modelling:

- **Stick-slip.** The contact line does not retreat smoothly; it pins, depins,
  and re-pins, leaving fainter concentric rings inside the main one.
- **Irregular pinning.** Surface roughness pins the line unevenly, so the ring
  is scalloped rather than circular.
- **Fibre swelling.** Liquid swells the paper's fibres. A dried stain is a
  shallow dish with a raised rim. This is the part that makes a stain sit *in*
  the sheet rather than on it, and nothing in the library does it today.

### Design

A `stains` layer writing to BOTH the albedo and the height field.

```js
stains: {
  enabled: false,
  seed: 4,
  amount: 1,             // global multiplier
  relief_um: 9,          // rim height; the dish is ~60% of it, inverted
  marks: [               // up to 4; sheet-relative coordinates
    { x: 0.72, y: 0.18, r_mm: 26, strength: 0.5, kind: 'ring' },
  ],
}
```

`kind` is one of:

| kind | ring | interior | tint | use |
|---|---|---|---|---|
| `ring` | hard, dark | pale, mottled | brown | coffee, tea |
| `tide` | soft, pale | none | faint grey-brown | water damage, damp |
| `blot` | none | dark centre, feathered | ink blue-black | spilled ink |

Foxing is separate, because it is many small clustered spots rather than a
placed mark: a procedural `foxing` density in the same layer, rusty-tinted,
clustered by a low-frequency mask so it is not uniformly scattered.

Four marks is the cap. Uniform arrays need a fixed bound, and four placed
stains on one sheet is already more than any real page.

## 2. Stamps

### The physics

A rubber die flexes under hand pressure, so ink transfer is patchy. Edges are
ragged where the rubber has worn. A rocked hand leaves a double strike.

The detail worth building around: **a stamp inks where the paper is HIGH.** The
raised parts of the sheet reach the rubber first, so the impression is heavier
on the crests and skips in the hollows. That is the exact inverse of
granulation, which pools a wash in the valleys — and both read off the cavity
buffer the pipeline already computes. A stamp that follows the relief reads as
pressed; one that ignores it reads as pasted.

### Design

A `stamp` layer composited in the composite pass, over the lit paper.

```js
stamp: {
  enabled: false,
  image: null,           // <img> | <canvas> | url, alpha or luminance
  x: 0.7, y: 0.2,        // sheet-relative centre
  scale: 0.28,           // fraction of sheet width
  rotation_deg: -6,
  colour: [0.55, 0.14, 0.11],
  threshold: 0.5,        // luminance/alpha cut to the die shape
  pressure: 0.8,         // overall ink laid down
  contact: 0.7,          // how strongly the paper's relief modulates transfer
  wear: 0.3,             // patchy transfer and edge erosion
  opacity: 0.9,
}
```

### The stamp studio

`demo/stamp.html`. Drag any PNG or SVG onto it and it becomes a stamp on live
paper. Controls for every parameter above, with a preview that re-renders as you
drag. Copy-out produces either the `params` object or a ready-to-paste
`data-paper-params` attribute.

**Nothing is written to disk.** The owner asked for drag-and-drop only, on the
grounds that logos may be client work. The image never leaves the page: it is
read with `FileReader` into a data URL, uploaded straight to a texture, and
dropped when the page closes. No upload endpoint, no `demo/stamps/` folder.

## 3. Newsprint effects

Three, all in the composite pass, all acting on the content texture.

**Show-through.** Type from the reverse of the sheet, faintly visible. The most
newspaper-specific effect available and the cheapest: sample the content texture
mirrored in x, scale it hard, and let it through in proportion to how thin the
stock is. `ink.show_through` (0 off, ~0.06 typical).

**Ink bleed / dot gain.** Newsprint is absorbent, so ink wicks along the fibres
and strokes fatten. This is why newsprint type reads differently from book type
at the same size. Implemented as a small noise-modulated dilation of the content
coverage before the Kubelka-Munk step. `ink.bleed_mm` (0 off, 0.05-0.15 typical).

**Ink cracking on folds.** Where a crease crosses solid ink, the ink layer flakes
off along the crease. Reads as genuinely old print. The crease is already
visible to the composite as a strong cavity signal, so this is a threshold on
cavity times a fine noise, subtracting coverage. `ink.fold_crack` (0 off).

## Verification

Following `feedback-verify-the-instrument`, every claim below gets a positive
control: a test that the measurement can detect the effect being absent AND
present, not just that it runs.

- **Stains:** the ring must be measurably darker than the interior, which is the
  entire Deegan claim. Sample a radial profile and assert
  `albedo(r=R) < albedo(r=0.5R)`. Positive control: with `stains.enabled=false`
  the profile is flat.
- **Stain relief:** height at the rim exceeds height at the centre.
- **Stamp contact:** with `contact > 0`, ink coverage must correlate with the
  height field. Assert the correlation is positive, and that it is ~zero at
  `contact = 0`.
- **Show-through / bleed / crack:** each measurably changes the composite with
  the feature on and provably does not with it off.
- All existing invariants keep passing, in particular the flat-sheet ones: with
  every new layer off, shade is exactly 1.0 and the composite equals
  `tone.paper`.

## Non-goals

- No stain library or preset gallery; the marks array is the interface.
- No server-side image handling for stamps. Drag-and-drop only, by request.
- Colour misregistration is out of scope: it only matters for colour offset
  printing and nothing in the showcase is colour-printed.
