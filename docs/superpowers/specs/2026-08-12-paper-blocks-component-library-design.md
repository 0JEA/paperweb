# Paper blocks: a component library with universal controls

**Date:** 2026-08-12
**Status:** approved, implementing pass 1
**Origin:** "is there a way to turn all of those into components and a set of
universal controls for all of them? Some way so later its easy to drag and drop
those in onto my site and edit them all live?"

## The goal

The 52 components in `demo/news/keep.html` are a gallery. The goal is a library:
drop one onto a page, edit it live, and eventually do that from a visual editor.

The editor is explicitly **not** in this scope. What is in scope is the data
model an editor would need, so that building one later is assembly rather than
excavation.

## What the components are today

Measured, not assumed:

| page | components | css rules | rules a component uses |
|---|---|---|---|
| archive | 19 | 203 | 18-42 |
| broadsheet | 15 | 244 | 1-61 |
| desk | 11 | 139 | 20-41 |
| product | 7 | 308 | 6-87 |

Every component is wrapped in gallery chrome (`<section class="bay">`, an index
badge, a heading, an explanatory caption). Every component carries a fully
resolved ~1.5 kb parameter tree rather than a diff. Sizes are hardcoded in
pixels (`width: 250px`, `height: 268px`) and the copy is baked into the markup.

Six of the 52 were not components at all: the extractor keyed on a two-digit
text marker and the crossword numbers its grid cells, so cells won the match.
Repaired before this work started; 68 surfaces now bind where 61 did.

## Decisions

**Packaging: a manifest plus one custom element.** `components.json` describes
every block; a single `<paper-block>` mounts one. Fifty-two bespoke element
classes would be the same behaviour written fifty-two times, and an editor wants
to write data rather than markup.

```html
<paper-block type="desk-16" stock="worn" age="0.6" fold-crack="1"
             rotate="-3deg" width="320">
  <h3 slot="headline">Council votes to keep the mural</h3>
  <p slot="body">Sir, I have lived on Bell Street…</p>
</paper-block>
```

**Scope: twelve first.** Chosen for structural variety rather than beauty, so
the schema meets every awkward case early. A schema mistake found late costs
twelve conversions, not fifty-two.

**Editability: named slots for real content only.** Headline, kicker, body,
byline, date. Rules, folios and ornaments stay fixed: they carry the layout, and
exposing them produces a panel of thirty unlabelled inputs that invites wrecking
the design.

**CSS is NOT tree-shaken.** Tempting, given a component uses 18-87 of its
family's rules, but a rewriter has to be simultaneously right about at-rules,
custom properties, inheritance and specificity, and being wrong is invisible
until you look at a render. That already happened once here: scoping silently
dropped rules and 52 components rendered near-white ink on cream. Four family
stylesheets, loaded once each, isolated by shadow DOM.

## The universal control schema

The controls that apply to all 52. Anything that does not apply to all of them
is a per-component fixture, not a control.

| control | range | maps to |
|---|---|---|
| `stock` | preset name | `preset` |
| `paper` | colour | `tone.paper` |
| `duotone` | 0-1 | `tone.duotone` |
| `age` | 0-1 | drives `stains.amount`, `foxing.strength`, `scratches.density`, `imperfect.*` together |
| `stains` | 0-3 marks | `stains.marks` |
| `relief` | 0-1 | scales `cockle.amplitude_um`, `crumple.amplitude_um` |
| `folds` | 0-4 | `folds.count` + `folds.chance` |
| `edge` | clean/deckle/torn | `edge.deckle_px`, `edge.tear_px`, `edge.wobble_px` |
| `lift` | 0-1 | `shadow.offset_px`, `shadow.darkness` |
| `bleed` | 0-1 | `ink.bleed_mm` |
| `show-through` | 0-1 | `ink.show_through` |
| `fold-crack` | 0-1 | `ink.fold_crack` |
| `stamp` | image + placement | `stamp.*` |
| `width` | px or % | CSS |
| `rotate` | deg | `--pb-rotate` |

`age` and `relief` are **compound**: one control moving several parameters on a
curve. They exist because "make it older" is the actual request, and the
individual parameters remain available underneath for anyone who wants them.

Three of these do nothing without content to act on (`bleed`, `show-through`,
`fold-crack`). The manifest records per-component whether the block is
content-bearing, so an editor can grey them out rather than offering a dead knob.

## The manifest

```json
{
  "id": "desk-16",
  "name": "Coffee-ringed sheet",
  "family": "desk",
  "tags": ["letters", "aged", "single-sheet"],
  "html": "<article class=\"sheet tilt\" data-pb-surface>…</article>",
  "slots": [
    { "name": "kicker",  "selector": ".stamp",  "label": "Kicker" },
    { "name": "headline","selector": "h3",      "label": "Headline" },
    { "name": "body",    "selector": ".letter", "label": "Body", "multiline": true }
  ],
  "paper": { "preset": "worn", "params": { "…minimal diff…" } },
  "content": "behind",
  "fixtures": ["coffee-stains"],
  "size": { "min": 220, "default": 320, "fluid": true }
}
```

`html` is the payload with the gallery chrome stripped. `paper` is a **diff**
against the named preset, not a resolved tree; the resolved trees in keep.html
are regenerated output and about 1.5 kb of noise each.

## Fluidity

The blocks are currently fixed-pixel. Each converted block gets:

- a `--pb-width` custom property with a sensible default and a stated minimum,
- internal dimensions expressed in `%`, `em` or `clamp()` rather than px,
- `--pb-rotate` replacing the ad-hoc `--r`.

Anything that genuinely cannot go fluid (a crossword grid is square by
definition) declares `"fluid": false` and an aspect ratio.

## The twelve

Picked for structural variety: single sheet, stacked sheets, sheet plus fixture,
sheet plus overlay, interactive, and full-bleed.

| id | name | why it is in the first pass |
|---|---|---|
| desk-16 | Coffee-ringed sheet | single sheet, stains, the one that started this |
| desk-07 | Front page on the blotter | sheet on a surface, large format |
| desk-12 | Marked page proof | overlay annotations on a sheet |
| archive-02 | Taped clipping | fixture (tape) crossing the sheet edge |
| archive-11 | Tissue over a front page | two stacked translucent sheets |
| archive-13 | Exhibit tag | small format, string fixture, non-rectangular |
| archive-07 | Reader-printer copy | heavy tone treatment, full-bleed content |
| broadsheet-01 | Front page above the fold | dense multi-column type |
| broadsheet-20 | Late edition stamp | two surfaces, stamp layer, marked BIG YES |
| broadsheet-09 | Obituary, black-ruled | solid ink rules, the best fold-crack target |
| product-06 | Card grid with hover lift | a CONTAINER of repeated blocks |
| product-13 | Reader poll | interactive state, and more poll types were asked for |

## Verification

Per `feedback-verify-the-instrument`, every claim gets a control.

- **Conversion is lossless:** each converted block renders with the same number
  of bound, painted surfaces as its keep.html original. Control: a deliberately
  broken conversion must fail this, so the count is asserted per block and not
  in aggregate.
- **Chrome is gone:** no converted block contains an index badge, a caption or
  a `<section class="bay|demo|sec">` wrapper.
- **Slots work:** setting each declared slot changes the rendered text, and a
  block with no slot content falls back to its default copy.
- **Controls are live:** every control in the schema, applied via attribute
  after mount, changes the render. This is the test the stamp studio did not
  have, which is why eight dead sliders shipped.
- **Controls are honest:** a control the block cannot honour (`fold-crack` on a
  `content: 'behind'` block) is reported as unavailable rather than accepted
  silently.
- **Fluid:** each block renders without horizontal overflow at 280 px, 520 px
  and 900 px.

## Non-goals

- The editor itself. This is its data model, not its UI.
- Converting the other 40 blocks. Mechanical once pass 1 holds.
- A CSS tree-shaker, for the reasons above.
- Server-side anything. The manifest is a static file.
