// The full parameter tree, ported field-for-field from paperlab's src/params.hpp.
//
// The JSON shape is kept schema-identical to paperlab so its presets/*.json load
// here unchanged. Every default is paperlab's default, which in turn is the
// sourced value from the research where one exists. The comments record WHY a
// default is what it is; they are the most valuable part of the port and they are
// deliberately carried over rather than summarised.
//
// Two fields are web-only and marked as such: `page.dpi` defaults to 96 rather
// than 150 (CSS px per inch, so millimetre defaults land at sensible CSS sizes),
// and `edge.radius_px` lets the sheet silhouette match a CSS border-radius.

/** @returns {object} a fresh, complete parameter tree at paperlab defaults */
export function defaults() {
  return {
    page: {
      // paperlab measures a real sheet in points at a print DPI. On the web the
      // element IS the sheet, so width/height are supplied by the binding layer
      // and only dpi and margin matter here. dpi is the nominal CSS resolution:
      // 96 px/in gives px_per_mm = 3.7795, which puts paperlab's mm-denominated
      // defaults (cockle 30mm, formation 2.5mm) at sensible on-screen sizes.
      dpi: 96,
      margin_mm: 16,            // void around the sheet, for the cast shadow
      // Which sheet of paper this is. paperlab renders one sheet, so all of its
      // seeds are constants; a page renders many, and constants make every card
      // the identical piece of paper. The seed offsets the sample position into
      // the noise fields and perturbs each layer's own seed, so every surface
      // gets its own cockle, formation, creases and torn edge. Paper assigns one
      // per instance automatically; pin it to reproduce a specific sheet.
      seed: 0,
      // Debug A/B: 1 restores paperlab's original hashes, skew term and a fixed
      // seed, so the two can be flipped live on one page.
      legacy: 0,
    },

    tone: {
      paper: [1.0, 0.953, 0.871],       // #FFF3DE, the evidence-backed cream
      // Painter's rule: cool shadows, warm highlights. A scalar times a beige
      // tint cannot hue-shift; this is the missing dimension that makes
      // "correct" paper less dead.
      highlight: [1.02, 1.0, 0.96],
      shadow: [0.90, 0.92, 0.98],
      duotone: 0.5,                     // 0 = pure luminance multiply
      opacity: 1.0,                     // web-only: fade the whole surface
    },

    ink: {
      // Kubelka-Munk (Curtis et al. 1997, watercolor S5): model ink as a thin
      // absorbing/scattering layer OVER the scattering paper substrate, so the
      // paper's shade, formation and tint show THROUGH the ink via its
      // transmittance. This is the fix for ink reading "pasted on". K and S are
      // derived from the ink's appearance over white (Rw) and over black (Rb);
      // thickness x scales optical depth.
      kubelka_munk: true,
      // Real uncoated black ink is L*~31 (#4C4846); over white it is near-black
      // and faintly cool, over black darker. Constraint: 0 < Rb < Rw < 1.
      ink_over_white: [0.095, 0.093, 0.105],
      ink_over_black: [0.022, 0.022, 0.028],
      thickness: 1.0,
      // Granulation (Curtis et al. 1997 S4.5): pigment pools in the paper's
      // relief valleys, so ink is denser where the sheet dips. 0 = flat ink.
      granulation: 0.0,
      // Legacy lerp+gate path (kubelka_munk = false), kept for A/B comparison.
      color: [0.06, 0.06, 0.06],
      gate_lo: 0.55,
      gate_hi: 0.85,
    },

    light: {
      // Human prior: single source, above-left, ~26 deg off vertical, and
      // screen-relative (Mamassian & Goutcher 2001; Ramachandran 1988).
      // Azimuth 0 = +x (right), 90 = +y (up). 116 = up and 26 deg to the left.
      azimuth_deg: 116,
      altitude_deg: 50,
      // Real cockle slopes are ~0.1 deg. Exaggeration scales them so the
      // geometry is gently visible rather than invisible.
      relief_exaggerate: 7.0,
      specular: true,           // cockle's signal IS gloss off the peaks
      spec_intensity: 0.5,
      spec_power: 40,
      diffuse_gain: 1.0,        // web-only knob on the N.L term
    },

    cockle: {
      // Land 2004: 16-34 mm dominant wavelength, visible above 25 um
      // peak-to-valley, crests along the machine direction.
      enabled: true,
      wavelength_mm: 30,
      amplitude_um: 22,
      anisotropy: 2.2,          // MD:CD stretch of the field
      md_angle_deg: 0,
      irregularity: 0.9,        // 0 = gentle directional wave, 1 = fully organic
    },

    formation: {
      // Mid-scale mass clumping, the visible signature of paper (CSF peak
      // ~1-3 mm). Built as a Gaussian Scale Mixture: a field times a
      // slowly-varying local scale.
      enabled: true,
      scale_mm: 2.5,
      amplitude: 0.02,          // fraction of tone
      gsm_amount: 0.7,          // strength of local-variance modulation
      beta: 1.25,               // measured spectral slope (creases rejected)
      skew: -0.3,               // real albedo is slightly dark-skewed
      // 0 = broadband fbm (the clean reading cloud), 1 = Gabor band-limited
      // (Lagae 2009: a spectral PEAK at 1/scale_mm instead of fbm's scale-free
      // 1/f, reads toothy/art-paper), 2 = a baked RPN tile from a real scan
      // (Galerne 2011). All three are random-phase, which Galerne proves is the
      // correct model for formation.
      source: 0,
      bandwidth: 0.6,           // Gabor envelope width a = F0 * bandwidth
      tile_mm: 48,              // physical size a baked tile spans (paperlab's value)
    },

    fade: {
      // Big-scale, cubed, non-stationary mask. Its absence is the single biggest
      // "this is procedural" tell: real paper is not uniformly distressed.
      enabled: true,
      scale_mm: 60,
      amount: 0.7,
    },

    scratches: {
      // Sparse, and they read LIGHT (fibre lift), not dark. A fraction are dark
      // (embedded dirt / pressed lines). Wear-correlated rather than stacked.
      enabled: false,
      density: 0.03,
      lightness: 0.15,
      scale_mm: 3.0,
      dark_frac: 0.3,
      seed: 5.0,
    },

    imperfect: {
      // Sparse, VARIED, non-stationary blemishes: the "here and there" that stops
      // the texture reading procedural. Pits are small dark dents; marks are
      // rarer, larger light-or-dark blotches. Each instance randomises size and
      // strength so no two look alike.
      enabled: false,
      pit_density: 0.03,
      pit_depth: 0.35,
      pit_scale_mm: 9.0,
      mark_density: 0.02,
      mark_strength: 0.16,
      mark_scale_mm: 24.0,
      seed: 2.0,
    },

    folds: {
      enabled: false,
      count: 3,
      depth: 0.4,
      sharpness: 0.6,           // sharp pressed fold vs broad crumple ridge
      seed: 3.0,
    },

    crumple: {
      // Worley 1996: an all-over crumple network, distinct from Folds' few
      // deliberate creases. crease 0 = smooth fbm(F1) lumps (Worley's actual
      // "crumpled paper"), 1 = sharp F2-F1 Voronoi creases (reads leathery, less
      // paper). Off by default: crumple is a specific worn look, not baseline.
      enabled: false,
      scale_mm: 9.0,
      amplitude_um: 60,
      crease: 0.3,
      // How much the cell network is bent out of a regular tiling. Worley with a
      // correctly uniform hash gives evenly scattered feature points and so
      // roughly hexagonal, similar-sized cells, which reads as bubble wrap.
      // Real crumple crazing is irregular and stretched. This warps the sample
      // position with a low-frequency fbm to get that back deliberately, rather
      // than relying on a degenerate hash to do it by accident.
      irregularity: 0.85,
      seed: 1.0,
    },

    cavity: {
      // dH = blur(height) - height, darken max(dH,0). The only escape from the
      // emboss. Luft 2006 puts the radius at 2-5% of the diagonal.
      enabled: true,
      radius_mm: 0.8,
      lambda: 0.6,
    },

    shadow: {
      // Contact-hardened cast shadow: tight and dark at contact, soft and wide
      // where the sheet lifts. A uniform offset blur is exactly what makes a fake
      // drop shadow read as fake.
      enabled: true,
      offset_px: 9,
      blur_px: 14,
      darkness: 0.7,
      contact: 0.7,             // 0 = uniform offset blur, 1 = full hardening
    },

    edge: {
      enabled: true,
      wobble_px: 6,             // irregular silhouette (low-frequency)
      curl: 0.0,                // corner lift
      // Fibrous deckle: the honest real-time P&S Group-C, energy clustered ALONG
      // the contour. A clustered low-frequency envelope times a fine along-edge
      // carrier feathers the silhouette into fibre tufts. 0 = clean cut edge.
      deckle_px: 0.0,
      radius_px: 0,             // web-only: match a CSS border-radius
    },
  };
}

// --- merging ----------------------------------------------------------------

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Deep-merge `patch` over `base`, returning a new tree. Arrays (colours) are
 * replaced wholesale rather than element-merged, because a partially-overridden
 * colour is never what anyone means.
 *
 * Unknown keys are kept, not dropped: paperlab presets carry `view` and extra
 * `page` fields this port has no use for, and silently discarding them would
 * make a round-trip through paperweb lossy.
 */
export function merge(base, patch) {
  if (!isPlain(patch)) return base;
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const k of Object.keys(patch)) {
    const pv = patch[k];
    if (pv === undefined) continue;
    out[k] = isPlain(pv) && isPlain(out[k]) ? merge(out[k], pv) : pv;
  }
  return out;
}

/**
 * A complete tree from an arbitrary (possibly partial, possibly paperlab-native)
 * params object.
 */
export function resolve(patch) {
  const p = merge(defaults(), patch || {});
  // paperlab stores page size in points and a print dpi. If a preset supplies
  // those, honour the dpi only when the caller has not overridden it; the sheet
  // dimensions come from the DOM element, so width_pt/height_pt are ignored.
  return p;
}

/** Canvas pixels per millimetre at this tree's nominal DPI. */
export function pxPerMm(p) {
  return p.page.dpi / 25.4;
}

/**
 * Turn a seed into an offset in millimetres into the noise fields.
 *
 * Consecutive seeds must land far apart, or surfaces 3 and 4 on a page would be
 * near-identical crops of the same field. A sine hash scatters them. The range
 * is capped at 400 mm because float32 in the shader has to resolve sub-0.1 mm
 * formation detail on top of the offset, and precision there degrades with
 * magnitude.
 */
export function seedOffsetMm(seed) {
  const h = (n) => {
    const x = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
    return x - Math.floor(x);
  };
  return [h(seed + 1.3) * 400, h(seed + 57.9) * 400];
}

/**
 * Per-layer seed for a given surface. Keeps each layer's own authored seed
 * meaningful (so a preset's `folds.seed` still distinguishes it from another
 * preset) while separating surfaces from each other.
 */
export function layerSeed(base, seed) {
  return base + seed * 17.31;
}

/** Canvas pixels per point (1 pt = 1/72 in). */
export function pxPerPt(p) {
  return p.page.dpi / 72;
}
