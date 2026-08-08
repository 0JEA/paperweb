// Shared GLSL prelude. Ported verbatim from paperlab shaders/common.glsl; the
// only change is that it is a JS template literal so the library needs no build
// step. All noise here is a pure function of physical position (mm), so a given
// seed produces the same field at any DPI or element size.

export const COMMON = /* glsl */ `
// --- hashing (PCG-ish, good enough for fields) -----------------------------
float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 345.45));
    p += dot(p, p + 34.345);
    return fract(p.x * p.y);
}
vec2 hash22(vec2 p) {
    float n = sin(dot(p, vec2(41.0, 289.0)));
    return fract(vec2(262144.0, 32768.0) * n);
}

// --- value noise + fbm -----------------------------------------------------
float vnoise(vec2 x) {
    vec2 i = floor(x), f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash21(i), b = hash21(i + vec2(1, 0));
    float c = hash21(i + vec2(0, 1)), d = hash21(i + vec2(1, 1));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 x, int octaves, float gain, float lac) {
    float sum = 0.0, amp = 1.0, tot = 0.0;
    mat2 rot = mat2(0.7648, -0.6442, 0.6442, 0.7648);
    for (int i = 0; i < 8; ++i) {
        if (i >= octaves) break;
        sum += amp * vnoise(x);
        tot += amp;
        amp *= gain;
        x = rot * x * lac;
    }
    return sum / max(tot, 1e-5);
}

// --- Gabor noise (Lagae et al. 2009): band-limited isotropic ---------------
// Sparse convolution of Gabor kernels (Gaussian envelope x cosine harmonic) at
// impulses seeded per cell. Unlike fbm (broadband 1/f), this has a spectral PEAK
// at principal frequency F0 (cycles/mm) with bandwidth set by envelope width a
// (per mm) -- the correct, band-limited model for paper formation.
float gaborNoise(vec2 mm, float F0, float a, float seed) {
    float cell_mm = 1.0 / max(a, 1e-3);
    vec2 pc = mm / cell_mm;
    vec2 n = floor(pc), fpart = fract(pc);
    float sum = 0.0;
    const int IMP = 3;                         // impulses per cell (fixed for speed)
    for (int j = -1; j <= 1; ++j)
    for (int i = -1; i <= 1; ++i) {
        vec2 g = vec2(float(i), float(j));
        vec2 cell = n + g;
        for (int k = 0; k < IMP; ++k) {
            float s = seed + float(k) * 19.0;
            vec2 rp = hash22(cell + vec2(s, s * 1.7));
            float w  = hash21(cell * 1.3 + s) * 2.0 - 1.0;
            float om = hash21(cell * 2.7 + s + 5.0) * 6.2831853;
            vec2 d = (fpart - (g + rp)) * cell_mm;
            float env = exp(-3.14159265 * a * a * dot(d, d));
            float har = cos(6.2831853 * F0 * (d.x * cos(om) + d.y * sin(om)));
            sum += w * env * har;
        }
    }
    return sum * 0.9;
}

// --- Worley / cellular noise (Worley 1996) ---------------------------------
// One feature point per cell, 3x3 search. Returns (F1, F2) = distance to nearest
// and 2nd-nearest. fbm(F1) is Worley's own "crumpled paper" bump; F2 - F1 is ~0 on
// the Voronoi boundaries, giving a crease/ridge network.
vec2 worleyF1F2(vec2 x) {
    vec2 n = floor(x), f = fract(x);
    float F1 = 1e30, F2 = 1e30;
    for (int j = -1; j <= 1; ++j)
    for (int i = -1; i <= 1; ++i) {
        vec2 g = vec2(float(i), float(j));
        vec2 o = hash22(n + g);
        vec2 r = g + o - f;
        float d = dot(r, r);
        if (d < F1) { F2 = F1; F1 = d; }
        else if (d < F2) { F2 = d; }
    }
    return sqrt(vec2(F1, F2));
}
`;

// Every fragment shader starts with this. GLSL ES 3.00 requires an explicit
// default precision for float; highp is needed because the height field carries
// sub-micrometre detail and mediump would band it visibly.
export const FRAG_HEADER = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
`;

/** Assemble a fragment shader: header + optional common prelude + body. */
export function frag(body, { common = false } = {}) {
  return FRAG_HEADER + (common ? COMMON : '') + body;
}
