// Shared GLSL prelude. Ported verbatim from paperlab shaders/common.glsl; the
// only change is that it is a JS template literal so the library needs no build
// step. All noise here is a pure function of physical position (mm), so a given
// seed produces the same field at any DPI or element size.

export const COMMON = /* glsl */ `
// A/B switch between paperlab's original hashes and the current ones. A uniform
// rather than a #define so a page can flip between them live: the branch is the
// same for every pixel, so it costs essentially nothing.
uniform int u_legacy_noise;

// --- hashing ----------------------------------------------------------------
// paperlab's hash21 is exactly periodic on the integer lattice: 123.34 x 50 and
// 345.45 x 20 are whole numbers, so it repeats every 50 steps in x and 20 in y
// (identical at 100% of lattice points). Every value-noise field built on it
// tiles, which at the default 2.5 mm formation scale is a visible 472 x 189
// canvas-pixel repeat.
//
// paperlab's hash22 has a different problem: both components come from ONE
// sin(), so the 2-D result lands on a curve rather than filling the square.
// Measured over the unit cell it occupies 25% of the available positions and
// clumps 118x more than uniform scatter. Worley puts its feature point at
// hash22(cell), so that degeneracy is what shaped the crumple cells.
//
// The replacements are PCG's output hash (O'Neill 2014) over the inputs' bit
// patterns. Bit patterns rather than floor() because several call sites pass
// deliberately fractional keys (gaborNoise uses cell * 1.3 + seed; the scratch
// and pit layers use cell * 1.7 + seed) and flooring would collapse distinct
// cells together.
uint pcgHash(uint v) {
    uint state = v * 747796405u + 2891336453u;
    uint word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
    return (word >> 22u) ^ word;
}
uint pcgHash2(vec2 p) {
    uvec2 q = floatBitsToUint(p);
    return pcgHash(q.x ^ pcgHash(q.y ^ 0x9e3779b9u));
}
const float UINT_TO_UNIT = 1.0 / 4294967296.0;

// u_legacy_noise selects the hash:
//   0  PCG integer mixer. Uniform, aperiodic, and identical on every GPU.
//   1  paperlab's original. Periodic every 50 x 20 cells.
//   2  CRYSTALLINE: paperlab's formula with long-period constants.
//
// Mode 2 exists because mode 0 lost something real. paperlab's float hash is not
// a good hash, and on some GPUs it is a spectacularly bad one: fract(p.x * p.y)
// on large intermediates quantises into discrete level sets, and the fbm built
// on top turns those into a network of fine creases in two diagonal families.
// It reads as crumpled tissue and it looks better than the correct version.
//
// It cannot simply be restored, because 123.34 = 6167/50 and 345.45 = 6909/20
// make it repeat every 50 steps in x and 20 in y. Moving the constants to
// 123.3457 = 1233457/10000 and 345.4531 = 3454531/10000 -- both already in
// lowest terms -- raises the period to 10000 cells, which at the default 2.5 mm
// grain is 25 metres. Same formula, same quantisation behaviour, same look; the
// repeat is gone.
//
// The honest caveat: the character comes from float PRECISION, so it varies by
// GPU. Measured here, SwiftShader renders mode 2 as smooth mottle while an
// RTX 4070 renders it as the crease network. Mode 0 is the one that looks
// identical everywhere.
// The legacy hash is selected at COMPILE time, not by a uniform.
//
// That is not a style preference. The texture this restores is a shader-codegen
// artifact: NVIDIA compiles the unbranched expression into something that
// quantises into flat panels, and the panel boundaries are creases. Measured on
// an RTX 4070, 14% of the shade buffer carries a sharp gradient with it and
// 0.01% without. Wrapping the SAME arithmetic in a runtime if() was enough to
// destroy it. So the two variants have to be separate compilations with the
// legacy path written exactly as paperlab writes it, down to reassigning the
// parameter.
#ifdef LEGACY_HASH
float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 345.45));
    p += dot(p, p + 34.345);
    return fract(p.x * p.y);
}
vec2 hash22(vec2 p) {
    float n = sin(dot(p, vec2(41.0, 289.0)));
    return fract(vec2(262144.0, 32768.0) * n);
}
#else
float hash21(vec2 p) {
    return float(pcgHash2(p)) * UINT_TO_UNIT;
}
vec2 hash22(vec2 p) {
    uint h = pcgHash2(p);
    return vec2(float(h), float(pcgHash(h ^ 0x85ebca6bu))) * UINT_TO_UNIT;
}
#endif

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

// --- stains (Deegan et al., Nature 389, 1997) -------------------------------
// "Capillary flow as the cause of ring stains from dried liquid drops". A drop
// pins at its contact line; evaporation is fastest at the perimeter, so liquid
// flows outward to replenish it and carries every suspended particle with it.
// The signature is a DARK RING with a PALE INTERIOR, which is why a soft radial
// gradient never looks like a coffee stain.
//
// Returns (pigment, relief): how much the stain darkens, and how much the
// swollen fibres lift. mm is position relative to the stain centre.
vec2 stainField(vec2 mm, float radius_mm, float seed, int kind) {
    float d = length(mm);
    float ang = atan(mm.y, mm.x);

    // Irregular pinning: surface roughness pins the contact line unevenly, so
    // the ring is scalloped rather than circular. Sampled on the angle so it is
    // continuous all the way round.
    float wob = fbm(vec2(cos(ang), sin(ang)) * 2.4 + seed, 3, 0.5, 2.0) - 0.5;
    float R = radius_mm * (1.0 + wob * 0.16);
    float t = d / max(R, 0.1);
    if (t > 1.28) return vec2(0.0);

    // Mottled interior. Real stains dry unevenly across the middle.
    float mott = fbm(mm / max(radius_mm * 0.22, 0.4) + seed * 3.1, 3, 0.55, 2.0) - 0.5;

    float pigment = 0.0;
    if (kind == 2) {
        // BLOT: no ring. Ink soaks in from the centre and feathers along the
        // fibres, so the edge is ragged rather than sharp.
        float feather = 1.0 - smoothstep(0.55, 1.0 + wob * 0.5, t);
        pigment = feather * (0.75 + 0.5 * mott);
    } else {
        // The main ring, then the stick-slip rings inside it: the contact line
        // pins, depins and re-pins as it retreats, leaving fainter concentric
        // marks rather than one clean edge.
        float w = (kind == 1) ? 0.19 : 0.075;      // tide lines are much softer
        float e = (t - 1.0) / w;
        float ring = exp(-e * e);
        float e2 = (t - 0.83) / (w * 1.5);
        float e3 = (t - 0.64) / (w * 2.0);
        float slip = exp(-e2 * e2) * 0.34 + exp(-e3 * e3) * 0.18;
        // Interior: pale, and paler still toward the middle.
        float inner = (t < 1.0 ? 1.0 : 0.0) * (0.10 + 0.16 * smoothstep(0.0, 1.0, t))
                    * (0.7 + 0.6 * mott);
        pigment = ring + (kind == 1 ? 0.0 : slip) + inner;
        if (kind == 1) pigment *= 0.55;            // a tide line carries no pigment
    }

    // Fibre swelling: the wetted area dries as a shallow dish with a raised rim.
    // Without this a stain is painted on; with it the stain is IN the sheet.
    float rim = exp(-pow((t - 0.97) / 0.16, 2.0));
    float dish = (t < 1.0 ? 1.0 : 0.0) * (1.0 - t * t) * 0.6;
    float relief = rim - dish;

    return vec2(max(pigment, 0.0), relief);
}

// --- Worley / cellular noise (Worley 1996) ---------------------------------
// One feature point per cell, 3x3 search. Returns (F1, F2) = distance to nearest
// and 2nd-nearest. fbm(F1) is Worley's own "crumpled paper" bump; F2 - F1 is ~0 on
// the Voronoi boundaries, giving a crease/ridge network.
// Worley variant that also reports WHICH cell won, so a caller can give each
// cell its own plane. Crumpled paper is a polyhedron: flat facets at random
// tilts meeting along creases. Shading the crease network alone (which is all
// F2-F1 gives you) treats every boundary identically and reads as dried mud.
// Returns (F1, F2, cell.x, cell.y).
vec4 worleyCell(vec2 x) {
    vec2 n = floor(x), f = fract(x);
    float F1 = 1e30, F2 = 1e30;
    vec2 best = n;
    for (int j = -1; j <= 1; ++j)
    for (int i = -1; i <= 1; ++i) {
        vec2 g = vec2(float(i), float(j));
        vec2 o = hash22(n + g);
        vec2 r = g + o - f;
        float d = dot(r, r);
        if (d < F1) { F2 = F1; F1 = d; best = n + g; }
        else if (d < F2) { F2 = d; }
    }
    return vec4(sqrt(F1), sqrt(F2), best);
}

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
export function frag(body, { common = false, legacy = false } = {}) {
  // The #define must come after #version, which FRAG_HEADER owns.
  const def = legacy ? '#define LEGACY_HASH 1\n' : '';
  return FRAG_HEADER + def + (common ? COMMON : '') + body;
}
