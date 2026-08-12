// Paper shapes.
//
// The block library answers "which of these 52 news components do I want". This
// answers a different and more basic question: what SHAPE is the piece of paper.
//
// Every shape carries the same sample text, so the picker compares silhouettes
// rather than comparing an obituary against a crossword. Swap the copy once and
// it swaps everywhere, which is the only way a set of thumbnails is honest about
// what is actually different between them.
//
// A shape is: a proportion, a trim, a text layout, and occasionally one fixture
// that IS the shape (a tag has a hole; a ticket has a perforation). Anything
// beyond that belongs in the controls, not here.

/** The sample copy, identical on every shape. */
export const SAMPLE = {
  label: 'Filed · no. 4417',
  headline: 'The tide came in at four',
  body: 'Sir, I have lived on Bell Street for thirty-one years and I found out '
      + 'that the river was being opened from the woman who sells me my paper.\n\n'
      + 'If the city consulted anybody, it was not anybody on Bell Street.',
  signoff: 'R. Okonkwo, Bell Street',
};

const SLOTS = [
  { name: 'label', label: 'Label', sel: '.pp-label' },
  { name: 'headline', label: 'Headline', sel: '.pp-headline' },
  { name: 'body', label: 'Body', sel: '.pp-body', multiline: true },
  { name: 'signoff', label: 'Signoff', sel: '.pp-signoff' },
];

/**
 * Markup is identical for every shape; only the class and the fixtures differ.
 * That is deliberate: if the markup varied per shape, the slots would have to
 * vary too, and "the same text on every shape" would stop being true.
 */
const body = (id, fixtures = '') => `<article class="pp pp-${id}" data-paper="">
  ${fixtures}<div class="pp-inner">
    <p class="pp-label">${SAMPLE.label}</p>
    <h3 class="pp-headline">${SAMPLE.headline}</h3>
    <div class="pp-body"><p>${SAMPLE.body.split('\n\n')[0]}</p><p>${SAMPLE.body.split('\n\n')[1]}</p></div>
    <p class="pp-signoff">${SAMPLE.signoff}</p>
  </div>
</article>`;

/**
 * @typedef {object} Shape
 * @property {string} id
 * @property {string} name
 * @property {string} note      one line on what the shape is FOR
 * @property {object} paper     paper params the shape needs to BE that shape
 */
const DEF = [
  { id: 'sheet', name: 'Sheet', note: 'Upright letter stock. The default piece of paper.',
    paper: { edge: { deckle_px: 0, wobble_px: 3 } } },

  { id: 'landscape', name: 'Landscape', note: 'The same stock turned, for wide pull quotes.',
    paper: { edge: { deckle_px: 0, wobble_px: 3 } } },

  { id: 'card', name: 'Card', note: 'Stiff, ruled, a single fact per card.',
    paper: { edge: { deckle_px: 0, wobble_px: 2 }, cockle: { amplitude_um: 9 } } },

  { id: 'square', name: 'Square', note: 'A note pad sheet. Reads as jotted.',
    paper: { edge: { deckle_px: 0, wobble_px: 4 } } },

  { id: 'slip', name: 'Slip', note: 'A narrow strip torn off something larger.',
    paper: { edge: { tear_px: 9, wobble_px: 7 } } },

  { id: 'receipt', name: 'Receipt', note: 'Long, thin, curled. Till roll.',
    paper: { edge: { tear_px: 7, wobble_px: 5 }, cockle: { amplitude_um: 26, wavelength_mm: 14 } } },

  { id: 'ticket', name: 'Ticket', note: 'Perforated stub. Admission, cloakroom, raffle.',
    paper: { edge: { deckle_px: 0, wobble_px: 2 } } },

  { id: 'tag', name: 'Tag', note: 'Punched and strung. Exhibit, luggage, price.',
    paper: { edge: { deckle_px: 2, wobble_px: 4 } } },

  { id: 'postcard', name: 'Postcard', note: 'Thick, square-cut, written on the back.',
    paper: { edge: { deckle_px: 0, wobble_px: 2 }, cockle: { amplitude_um: 8 } } },

  { id: 'torn', name: 'Torn', note: 'The top half of a sheet, torn across.',
    paper: { edge: { tear_px: 13, wobble_px: 9 } } },

  { id: 'broadsheet', name: 'Broadsheet', note: 'Full newspaper page, folded once.',
    paper: { edge: { deckle_px: 0, wobble_px: 4 },
             folds: { enabled: true, count: 1, chance: 1, depth: 1.2, sharpness: 0.7 } } },

  { id: 'sticky', name: 'Sticky', note: 'Square, lifted at one corner.',
    paper: { edge: { deckle_px: 0, wobble_px: 2 }, cockle: { amplitude_um: 14 } } },

  { id: 'envelope', name: 'Envelope', note: 'Sealed flap, address panel.',
    paper: { edge: { deckle_px: 0, wobble_px: 3 }, cockle: { amplitude_um: 10 } } },

  { id: 'folded', name: 'Folded', note: 'Creased down the middle, standing.',
    paper: { edge: { deckle_px: 0, wobble_px: 3 },
             folds: { enabled: true, count: 1, chance: 1, depth: 1.4, sharpness: 0.85 } } },

  { id: 'deckle', name: 'Deckle', note: 'Hand-made, feathered on every edge.',
    paper: { edge: { deckle_px: 9, wobble_px: 7 } } },

  { id: 'strip', name: 'Strip', note: 'A single column torn off the wire.',
    paper: { edge: { tear_px: 8, wobble_px: 6 } } },
];

const FIXTURES = {
  tag: '<span class="pp-hole" aria-hidden="true"></span>',
  ticket: '<span class="pp-perf" aria-hidden="true"></span>',
  envelope: '<span class="pp-flap" aria-hidden="true"></span>',
  folded: '<span class="pp-crease" aria-hidden="true"></span>',
  sticky: '<span class="pp-curl" aria-hidden="true"></span>',
};

/**
 * Width divided by height. Recorded on the shape rather than left only in the
 * CSS, because the picker has to fit a 1:3.2 receipt and a 2.6:1 ticket into
 * the same thumbnail box, and it cannot read an aspect-ratio out of a
 * stylesheet it has not applied yet.
 */
const ASPECT = {
  sheet: 0.7728,
  landscape: 1.414,
  card: 1.6667,
  square: 1,
  slip: 0.4762,
  receipt: 0.3125,
  ticket: 2.6,
  tag: 0.5714,
  postcard: 1.48,
  torn: 1.2821,
  broadsheet: 0.7042,
  sticky: 1,
  envelope: 1.9,
  folded: 1.4,
  deckle: 0.8065,
  strip: 0.3846,
};

export const SHAPES = DEF.map((s) => ({
  id: `shape-${s.id}`,
  n: s.id,
  name: s.name,
  note: s.note,
  family: 'shapes',
  html: body(s.id, FIXTURES[s.id] || ''),
  slots: SLOTS,
  paper: { preset: 'paper', params: s.paper },
  hasInk: false,
  surfaces: 1,
  aspect: ASPECT[s.id],
}));

/**
 * One stylesheet for all of them.
 *
 * Sizing is in `em` off a single `--pp-type` so the type control scales a shape
 * rather than reflowing it into something else, and every shape declares an
 * aspect-ratio so a thumbnail is a fair likeness of the full-size piece.
 */
export const SHAPES_CSS = `
/* The defaults live on :host, NOT on .pp.
   
   A custom property declared on .pp overrides one inherited from an ancestor,
   and the element sets these on .pb-root, which sits between the host and .pp.
   Declaring them here means the shape supplies a default and the Type controls
   can still override it -- with them on .pp, all three controls were inert. */
:host {
  display: block;
  --pp-type: 16px;
  --pp-ink: #241f18;
  --pp-face: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif;
}

.pp {
  position: relative;
  width: 100%;
  color: var(--pp-ink);
  font-family: var(--pp-face);
  font-size: var(--pp-type);
}
.pp-inner { position: absolute; inset: 0; padding: 7% 8%; display: flex;
            flex-direction: column; overflow: hidden; }

.pp-label { margin: 0 0 .5em; font-family: ui-monospace, "SF Mono", Menlo, monospace;
            font-size: .7em; letter-spacing: .14em; text-transform: uppercase;
            color: color-mix(in srgb, var(--pp-ink) 55%, transparent); }
.pp-headline { margin: 0 0 .45em; font-size: 1.25em; line-height: 1.14;
               font-weight: 600; letter-spacing: -0.01em; }
.pp-body { flex: 1; min-height: 0; overflow: hidden; }
.pp-body p { margin: 0 0 .55em; font-size: .78em; line-height: 1.5;
             color: color-mix(in srgb, var(--pp-ink) 82%, transparent); }
.pp-signoff { margin: .4em 0 0; font-size: .7em; font-style: italic;
              color: color-mix(in srgb, var(--pp-ink) 62%, transparent); }

/* --- the shapes ------------------------------------------------------------ */
.pp-sheet      { aspect-ratio: 1 / 1.294; }
.pp-landscape  { aspect-ratio: 1.414 / 1; }
.pp-card       { aspect-ratio: 5 / 3; }
.pp-square     { aspect-ratio: 1 / 1; }
.pp-slip       { aspect-ratio: 1 / 2.1; }
.pp-receipt    { aspect-ratio: 1 / 3.2; }
.pp-ticket     { aspect-ratio: 2.6 / 1; }
.pp-tag        { aspect-ratio: 1 / 1.75; }
.pp-postcard   { aspect-ratio: 1.48 / 1; }
.pp-torn       { aspect-ratio: 1 / 0.78; }
.pp-broadsheet { aspect-ratio: 1 / 1.42; }
.pp-sticky     { aspect-ratio: 1 / 1; }
.pp-envelope   { aspect-ratio: 1.9 / 1; }
.pp-folded     { aspect-ratio: 1.4 / 1; }
.pp-deckle     { aspect-ratio: 1 / 1.24; }
.pp-strip      { aspect-ratio: 1 / 2.6; }

/* Narrow shapes cannot carry a 1.25em headline over four words, so they step
   the scale down rather than letting the text overrun the sheet. */
.pp-slip .pp-headline, .pp-receipt .pp-headline,
.pp-strip .pp-headline, .pp-tag .pp-headline { font-size: 1.02em; }
.pp-receipt .pp-inner, .pp-strip .pp-inner { padding: 9% 9%; }
.pp-ticket .pp-inner { padding: 6% 5% 6% 13%; }
.pp-envelope .pp-inner { padding: 16% 9% 8%; }
.pp-tag .pp-inner { padding: 16% 10% 8%; }

/* --- fixtures that ARE the shape ------------------------------------------- */
.pp-hole {
  position: absolute; left: 50%; top: 5.5%; width: 9%; aspect-ratio: 1;
  translate: -50% 0; border-radius: 50%;
  background: #0d0b09;
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, .6), 0 1px 0 rgba(255, 255, 255, .3);
}
.pp-perf {
  position: absolute; left: 9%; top: 0; bottom: 0; width: 2px;
  background: repeating-linear-gradient(180deg,
    color-mix(in srgb, var(--pp-ink) 42%, transparent) 0 4px, transparent 4px 9px);
}
.pp-flap {
  position: absolute; left: 0; right: 0; top: 0; height: 46%;
  background: linear-gradient(180deg, rgba(0, 0, 0, .07), rgba(0, 0, 0, .015));
  clip-path: polygon(0 0, 100% 0, 50% 100%);
  border-bottom: 1px solid color-mix(in srgb, var(--pp-ink) 18%, transparent);
}
.pp-crease {
  position: absolute; left: 50%; top: 0; bottom: 0; width: 1px;
  background: color-mix(in srgb, var(--pp-ink) 20%, transparent);
}
.pp-curl {
  position: absolute; right: 0; bottom: 0; width: 17%; aspect-ratio: 1;
  background: linear-gradient(315deg, rgba(0, 0, 0, .16), rgba(0, 0, 0, 0) 62%);
  clip-path: polygon(100% 0, 100% 100%, 0 100%);
}

/* A thumbnail is the same markup at a small size. Hiding the body below a
   certain width keeps it a picture of the SHAPE rather than a grey smudge. */
/* Thumbnail mode is keyed on the HOST attribute, not on a container query.
   A container query on .pp made .pp its own container while it also carried an
   aspect-ratio, which is a self-referential sizing loop: the query hides
   content, layout changes, the container resizes, and the element and its
   canvas settle on different widths. The picker already knows it is drawing a
   thumbnail, so it says so. */
:host([thumb]) .pp-label,
:host([thumb]) .pp-body,
:host([thumb]) .pp-signoff,
:host([thumb]) .pp-headline { display: none; }
:host([thumb]) .pp-inner { padding: 15% 13%; gap: 13%; }
:host([thumb]) .pp-inner::before {
  content: ''; display: block; height: 9%; min-height: 3px; width: 78%;
  background: color-mix(in srgb, var(--pp-ink) 62%, transparent);
}
:host([thumb]) .pp-inner::after {
  content: ''; display: block; flex: 1; min-height: 0;
  background: repeating-linear-gradient(180deg,
    color-mix(in srgb, var(--pp-ink) 34%, transparent) 0 1.5px,
    transparent 1.5px 6px);
  -webkit-mask-image: linear-gradient(180deg, #000 0 58%, transparent 92%);
  mask-image: linear-gradient(180deg, #000 0 58%, transparent 92%);
}
`;
