// paperlab presets, embedded so the library needs no fetch at runtime.
//
// Generated from the JSON in presets/ at build time (tools/gen-presets.mjs).
// Each preset is a PARTIAL patch over params.defaults(), which is exactly how
// paperlab stores them, so the two stay interchangeable: a preset saved by
// paperlab loads here and vice versa.
//
// Note that paperlab authored these at 150 DPI against a Letter sheet. On the web
// the nominal DPI is 96 and the sheet is the element, so millimetre-denominated
// values (cockle wavelength, formation scale) land at proportionally larger
// on-screen sizes. That is the intended behaviour of the nominal-DPI scale model:
// the relief keeps its physical meaning rather than its pixel count.

export const presets = {
  "Interesting": {
    "cavity": {
      "enabled": true,
      "lambda": 0.7300000190734863,
      "radius_mm": 3
    },
    "cockle": {
      "amplitude_um": 1,
      "anisotropy": 6,
      "enabled": true,
      "irregularity": 1,
      "md_angle_deg": -90,
      "wavelength_mm": 5
    },
    "crumple": {
      "amplitude_um": 3,
      "crease": 0.009999999776482582,
      "enabled": true,
      "scale_mm": 8.5,
      "seed": 1
    },
    "edge": {
      "curl": 0,
      "deckle_px": 0,
      "enabled": true,
      "wobble_px": 7
    },
    "fade": {
      "amount": 0.5099999904632568,
      "enabled": true,
      "scale_mm": 85
    },
    "folds": {
      "count": 2,
      "depth": 0.22,
      "enabled": true,
      "seed": 3,
      "sharpness": 0.4000000059604645
    },
    "formation": {
      "amplitude": 0.024000000208616257,
      "bandwidth": 1.5,
      "beta": 1.25,
      "enabled": true,
      "gsm_amount": 0.5400000214576721,
      "scale_mm": 2.4000000953674316,
      "skew": 1,
      "source": 1
    },
    "ink": {
      "color": [
        0.05999999865889549,
        0.05999999865889549,
        0.05999999865889549
      ],
      "gate_hi": 1,
      "gate_lo": 0,
      "granulation": 0.8199999928474426,
      "ink_over_black": [
        0.017999999225139618,
        0.017999999225139618,
        0.023000000044703484
      ],
      "ink_over_white": [
        0.04500000178813934,
        0.04399999976158142,
        0.05299999937415123
      ],
      "kubelka_munk": false,
      "thickness": 0.7099999785423279
    },
    "light": {
      "altitude_deg": 65,
      "azimuth_deg": 130,
      "relief_exaggerate": 6,
      "spec_intensity": 1.340000033378601,
      "spec_power": 35,
      "specular": true
    },
    "page": {
      "margin_mm": 16
    },
    "scratches": {
      "density": 0.07,
      "enabled": true,
      "lightness": 0.1599999964237213,
      "scale_mm": 12.5,
      "seed": 5
    },
    "shadow": {
      "blur_px": 25,
      "contact": 1,
      "darkness": 0.6600000262260437,
      "enabled": true,
      "offset_px": 17
    },
    "tone": {
      "duotone": 0.3499999940395355,
      "highlight": [
        1.0199999809265137,
        1,
        0.9599999785423279
      ],
      "paper": [
        1,
        0.953000009059906,
        0.8709999918937683
      ],
      "shadow": [
        0,
        0.07612477988004684,
        0.30449825525283813
      ]
    }
  },

  "paper": {
    "cockle": {
      "enabled": true,
      "amplitude_um": 22,
      "wavelength_mm": 30,
      "anisotropy": 2.2,
      "irregularity": 0.9
    },
    "formation": {
      "enabled": true,
      "amplitude": 0.02,
      "gsm_amount": 0.7,
      "skew": -0.3,
      "source": 0
    },
    "fade": {
      "enabled": true,
      "amount": 0.65
    },
    "cavity": {
      "enabled": true,
      "radius_mm": 0.8,
      "lambda": 0.6
    },
    "folds": {
      "enabled": false
    },
    "crumple": {
      "enabled": false
    },
    "scratches": {
      "enabled": false
    },
    "shadow": {
      "enabled": true,
      "offset_px": 9,
      "blur_px": 16,
      "darkness": 0.65,
      "contact": 0.7
    },
    "edge": {
      "enabled": true,
      "wobble_px": 5
    },
    "light": {
      "azimuth_deg": 116,
      "altitude_deg": 50,
      "relief_exaggerate": 7,
      "specular": true,
      "spec_intensity": 0.5,
      "spec_power": 40
    },
    "tone": {
      "duotone": 0.5
    },
    "ink": {
      "kubelka_munk": true,
      "ink_over_white": [
        0.045,
        0.044,
        0.053
      ],
      "ink_over_black": [
        0.018,
        0.018,
        0.023
      ],
      "thickness": 1.1,
      "granulation": 0
    }
  },

  "paperlab": {
    "cockle": {
      "enabled": true,
      "amplitude_um": 22,
      "wavelength_mm": 26,
      "anisotropy": 1.2,
      "irregularity": 0.95
    },
    "formation": {
      "enabled": true,
      "amplitude": 0.1,
      "gsm_amount": 0.65,
      "skew": -0.25,
      "source": 0,
      "scale_mm": 0.9
    },
    "fade": {
      "enabled": true,
      "amount": 0.5
    },
    "cavity": {
      "enabled": true,
      "radius_mm": 0.7,
      "lambda": 0.6
    },
    "shadow": {
      "enabled": true,
      "offset_px": 9,
      "blur_px": 16,
      "darkness": 0.65,
      "contact": 0.7
    },
    "edge": {
      "enabled": true,
      "wobble_px": 5
    },
    "light": {
      "azimuth_deg": 116,
      "altitude_deg": 50,
      "relief_exaggerate": 8,
      "specular": true,
      "spec_intensity": 0.5,
      "spec_power": 40
    },
    "tone": {
      "duotone": 0.5
    },
    "ink": {
      "kubelka_munk": true,
      "ink_over_white": [
        0.045,
        0.044,
        0.053
      ],
      "ink_over_black": [
        0.018,
        0.018,
        0.023
      ],
      "thickness": 1.1
    },
    "scratches": {
      "enabled": false,
      "density": 0.012,
      "lightness": 0.14,
      "scale_mm": 3.5,
      "dark_frac": 0.3,
      "seed": 5
    },
    "imperfect": {
      "enabled": false,
      "pit_density": 0.015,
      "pit_depth": 0.4,
      "pit_scale_mm": 8,
      "mark_density": 0,
      "mark_strength": 0.18,
      "mark_scale_mm": 22,
      "seed": 2
    }
  },

  "pronounced": {
    "cockle": {
      "enabled": true,
      "amplitude_um": 45,
      "wavelength_mm": 24,
      "anisotropy": 3,
      "irregularity": 0.8
    },
    "formation": {
      "enabled": true,
      "amplitude": 0.03
    },
    "fade": {
      "enabled": true,
      "amount": 0.55
    },
    "folds": {
      "enabled": true,
      "count": 2,
      "depth": 1.05
    },
    "light": {
      "relief_exaggerate": 10,
      "specular": true,
      "spec_intensity": 0.7,
      "spec_power": 30
    }
  },

  "reading": {
    "cockle": {
      "enabled": true,
      "amplitude_um": 26,
      "wavelength_mm": 28,
      "anisotropy": 2.1,
      "irregularity": 0.9
    },
    "formation": {
      "enabled": true,
      "amplitude": 0.028,
      "gsm_amount": 0.75,
      "skew": -0.3,
      "source": 0
    },
    "fade": {
      "enabled": true,
      "scale_mm": 62,
      "amount": 0.6
    },
    "cavity": {
      "enabled": true,
      "radius_mm": 0.75,
      "lambda": 0.6
    },
    "crumple": {
      "enabled": false
    },
    "folds": {
      "enabled": false
    },
    "scratches": {
      "enabled": false
    },
    "shadow": {
      "enabled": true,
      "offset_px": 10,
      "blur_px": 16,
      "darkness": 0.66,
      "contact": 0.72
    },
    "edge": {
      "enabled": true,
      "wobble_px": 5,
      "deckle_px": 0
    },
    "light": {
      "azimuth_deg": 116,
      "altitude_deg": 50,
      "relief_exaggerate": 8,
      "specular": true,
      "spec_intensity": 0.5,
      "spec_power": 40
    },
    "tone": {
      "duotone": 0.5
    },
    "ink": {
      "kubelka_munk": true,
      "ink_over_white": [
        0.045,
        0.044,
        0.053
      ],
      "ink_over_black": [
        0.018,
        0.018,
        0.023
      ],
      "thickness": 1.1,
      "granulation": 0
    }
  },

  "subtle": {
    "cockle": {
      "enabled": true,
      "amplitude_um": 14,
      "wavelength_mm": 32,
      "anisotropy": 2,
      "irregularity": 0.95
    },
    "formation": {
      "enabled": true,
      "amplitude": 0.014
    },
    "fade": {
      "enabled": true,
      "amount": 0.7
    },
    "light": {
      "relief_exaggerate": 6,
      "specular": true,
      "spec_intensity": 0.4
    }
  },

  "surface": {
    "cockle": {
      "enabled": true,
      "amplitude_um": 30,
      "wavelength_mm": 26
    },
    "formation": {
      "enabled": true,
      "amplitude": 0.03,
      "gsm_amount": 0.8,
      "skew": -0.4
    },
    "fade": {
      "enabled": true,
      "amount": 0.75
    },
    "cavity": {
      "enabled": true,
      "radius_mm": 0.8,
      "lambda": 0.8
    },
    "folds": {
      "enabled": true,
      "count": 3,
      "depth": 1.3,
      "sharpness": 0.5
    },
    "scratches": {
      "enabled": true,
      "density": 0.05,
      "lightness": 0.2,
      "scale_mm": 11
    },
    "tone": {
      "duotone": 0.6
    }
  },

  "textured": {
    "cockle": {
      "enabled": true,
      "amplitude_um": 20,
      "wavelength_mm": 28,
      "anisotropy": 2,
      "irregularity": 0.92
    },
    "formation": {
      "enabled": true,
      "amplitude": 0.03,
      "gsm_amount": 0.6,
      "skew": -0.2,
      "scale_mm": 1.8,
      "bandwidth": 1.1,
      "source": 1
    },
    "fade": {
      "enabled": true,
      "amount": 0.5
    },
    "cavity": {
      "enabled": true,
      "radius_mm": 0.7,
      "lambda": 0.6
    },
    "crumple": {
      "enabled": false
    },
    "folds": {
      "enabled": false
    },
    "scratches": {
      "enabled": false
    },
    "shadow": {
      "enabled": true,
      "offset_px": 9,
      "blur_px": 16,
      "darkness": 0.65,
      "contact": 0.7
    },
    "edge": {
      "enabled": true,
      "wobble_px": 6,
      "deckle_px": 7
    },
    "light": {
      "azimuth_deg": 116,
      "altitude_deg": 48,
      "relief_exaggerate": 8,
      "specular": true,
      "spec_intensity": 0.5,
      "spec_power": 36
    },
    "tone": {
      "duotone": 0.55
    },
    "ink": {
      "kubelka_munk": true,
      "ink_over_white": [
        0.05,
        0.049,
        0.058
      ],
      "ink_over_black": [
        0.02,
        0.02,
        0.025
      ],
      "thickness": 1,
      "granulation": 0.7
    }
  },

  "worn": {
    "cockle": {
      "enabled": true,
      "amplitude_um": 30,
      "wavelength_mm": 26,
      "anisotropy": 2.4,
      "irregularity": 0.85
    },
    "formation": {
      "enabled": true,
      "amplitude": 0.03,
      "gsm_amount": 0.75,
      "skew": -0.35,
      "source": 0
    },
    "fade": {
      "enabled": true,
      "scale_mm": 55,
      "amount": 0.85
    },
    "cavity": {
      "enabled": true,
      "radius_mm": 0.8,
      "lambda": 0.7
    },
    "crumple": {
      "enabled": true,
      "scale_mm": 13,
      "amplitude_um": 34,
      "crease": 0.07
    },
    "folds": {
      "enabled": true,
      "count": 3,
      "depth": 1.2,
      "sharpness": 0.6
    },
    "scratches": {
      "enabled": true,
      "density": 0.036,
      "lightness": 0.15,
      "scale_mm": 11.94
    },
    "shadow": {
      "enabled": true,
      "offset_px": 11,
      "blur_px": 18,
      "darkness": 0.72,
      "contact": 0.65
    },
    "edge": {
      "enabled": true,
      "wobble_px": 8,
      "deckle_px": 11
    },
    "light": {
      "azimuth_deg": 116,
      "altitude_deg": 46,
      "relief_exaggerate": 9,
      "specular": true,
      "spec_intensity": 0.55,
      "spec_power": 32
    },
    "tone": {
      "paper": [
        1,
        0.94,
        0.84
      ],
      "duotone": 0.6
    },
    "ink": {
      "kubelka_munk": true,
      "ink_over_white": [
        0.075,
        0.07,
        0.08
      ],
      "ink_over_black": [
        0.028,
        0.027,
        0.033
      ],
      "thickness": 0.92,
      "granulation": 1
    }
  },

};

/** Preset names, sorted. */
export const presetNames = Object.keys(presets);

/**
 * Look up a preset by name.
 * @throws if the name is unknown, because silently rendering defaults when a
 *   caller asked for "worn" is the kind of failure nobody notices for months.
 */
export function preset(name) {
  const p = presets[name];
  if (!p) throw new Error(`paperweb: unknown preset "${name}" (have: ${presetNames.join(", ")})`);
  return p;
}
