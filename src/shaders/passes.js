// The pass shaders, ported from paperlab's shaders/*.frag to GLSL ES 3.00.
//
// Two intentional divergences from the C++ source, both documented in the spec:
//
//  1. The height buffer stores MICROMETRES, not millimetres. On the half-float
//     fallback path mm-scale values (~0.011) quantise at ~0.05% relative, and
//     the normal pass takes a central difference of two of them, which destroys
//     the slope. In um the values are ~11 and the difference survives. The
//     normal and cavity passes convert back to mm.
//
//  2. Dynamic loop bounds are replaced with fixed bounds plus an early break.
//     GLSL ES 3.00 permits dynamic loops, but several mobile drivers miscompile
//     or refuse to unroll them.
//
// Everything else is the same maths as paperlab, including every comment that
// records WHY a term exists.

import { frag } from './common.js';

// --- attributeless full-screen triangle ------------------------------------
export const QUAD_VERT = /* glsl */ `#version 300 es
precision highp float;
out vec2 uv;
void main() {
    vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
    uv = p;
    gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

// --- height (um) ------------------------------------------------------------
// Cockle is the dominant, best-sourced height layer (Land 2004). Formation is
// NOT here: paper's mass variation is a reflectance change, not relief, so it
// lives in the albedo pass.
export const HEIGHT_FRAG = (legacy = false) => frag(/* glsl */ `
in vec2 uv;
out vec4 frag_out;

uniform vec2  u_res;
uniform float u_px_per_mm;
// Per-surface offset into the (infinite) noise fields, in mm. paperlab renders
// one sheet, so its seeds are constants; a page renders many, and constants make
// every card the same piece of paper. Sliding the sample position decorrelates
// every position-based layer at once.
uniform vec2  u_seed_mm;

uniform int   u_cockle_on;
uniform float u_cockle_wavelength_mm;
uniform float u_cockle_amp_um;
uniform float u_cockle_aniso;
uniform float u_cockle_md_deg;
uniform float u_cockle_irregularity;
uniform float u_cockle_facet;
uniform float u_cockle_facet_scale;

uniform int   u_folds_on;
uniform float u_fold_count;
uniform float u_fold_depth;
uniform float u_fold_sharpness;
uniform float u_fold_seed;

uniform int   u_crumple_on;
uniform float u_crumple_scale_mm;
uniform float u_crumple_amp_um;
uniform float u_crumple_crease;
uniform float u_crumple_irregularity;
uniform float u_crumple_seed;

void main() {
    vec2 px = uv * u_res;
    // Folds are placed in SHEET-RELATIVE coordinates (p0 below is a fraction of
    // the sheet), so they must keep the un-offset position: sliding mm by the
    // seed would push every crease line off the sheet entirely. Their variation
    // comes through u_fold_seed instead. Cockle and crumple are pure fields and
    // take the offset.
    vec2 mm_sheet = px / u_px_per_mm;
    vec2 mm = mm_sheet + u_seed_mm;
    float h_um = 0.0;

    if (u_cockle_on == 1) {
        // Real cockle is ORGANIC, lumpy buckling, not a periodic corrugation. A
        // sine reads as cardboard; use an anisotropic low-frequency noise field
        // (crests elongated along MD). irregularity blends from a gentle
        // directional wave toward fully organic buckling.
        float a = radians(u_cockle_md_deg);
        mat2 R = mat2(cos(a), -sin(a), sin(a), cos(a));
        vec2 t = R * mm;
        t.x /= max(u_cockle_aniso, 0.1);

        float organic = fbm(t / max(u_cockle_wavelength_mm * 0.55, 0.5), 3, 0.5, 2.0) - 0.5;
        float warp = (fbm(t / max(u_cockle_wavelength_mm, 1.0), 2, 0.5, 2.0) - 0.5) * 2.0;
        float wave = 0.5 * sin(t.y * 6.2831853 / max(u_cockle_wavelength_mm, 1.0) + warp * 1.5);

        float field = mix(wave, organic * 1.6, clamp(u_cockle_irregularity, 0.0, 1.0));

        // FACETING. Real buckled paper does not curve smoothly: it collapses
        // into flat panels meeting along creases, which is why crumpled paper
        // reads as a polygon network and not as a wavy sheet.
        //
        // This was discovered by accident. paperlab's float hash, compiled
        // UNBRANCHED by NVIDIA's shader compiler, quantises into discrete levels
        // and turns the cockle field into exactly that panel network: measured
        // on an RTX 4070, 14% of the shade buffer carries a sharp gradient
        // against 0.01% for the smooth version. Wrapping the SAME formula in an
        // if() destroys it, so it is a shader-codegen artifact and cannot be
        // relied on. SwiftShader never produced it at all, which is why several
        // rounds of measurement here missed it completely.
        //
        // So quantise on purpose. Rounding the field to a set of levels makes
        // flat panels whose boundaries the normal pass turns into creases, on
        // every GPU, with a knob on it.
        if (u_cockle_facet > 0.001) {
            float levels = mix(40.0, 5.0, clamp(u_cockle_facet, 0.0, 1.0));
            // Warp the level boundaries so the creases are not iso-contours of a
            // smooth field, which would read as a topographic map. A little
            // high-frequency jitter breaks them into straight-ish panel edges.
            float j = (fbm(t / max(u_cockle_facet_scale, 0.5), 3, 0.5, 2.0) - 0.5);
            float q = field + j * (1.2 / levels);
            float stepped = floor(q * levels + 0.5) / levels;
            field = mix(field, stepped, clamp(u_cockle_facet, 0.0, 1.0));
        }

        h_um += field * u_cockle_amp_um;   // field ~ +/-0.5, amp = peak-to-valley
    }

    if (u_folds_on == 1) {
        // Each fold is a straight crease line; its height profile is a signed
        // ridge. Sharp = narrow (pressed fold), broad = wide (crumple ridge).
        vec2 sheet_mm = u_res / u_px_per_mm;
        float width_mm = mix(6.0, 0.6, clamp(u_fold_sharpness, 0.0, 1.0));
        for (int i = 0; i < 8; ++i) {
            if (float(i) >= u_fold_count) break;
            vec2 r1 = hash22(vec2(float(i) * 3.7 + u_fold_seed, 1.3));
            vec2 r2 = hash22(vec2(float(i) * 7.1 + u_fold_seed, 5.9));
            float ang = r1.x * 3.14159265;
            vec2 dir = vec2(cos(ang), sin(ang));
            vec2 nrm = vec2(-dir.y, dir.x);
            vec2 p0 = r1.y * sheet_mm + 0.2 * sheet_mm;
            float d = dot(mm_sheet - p0, nrm);
            float sgn = (r2.x < 0.5) ? -1.0 : 1.0;
            float profile = exp(-(d * d) / (width_mm * width_mm));
            h_um += sgn * u_fold_depth * 150.0 * profile;   // 0.15mm max -> 150um
        }
    }

    if (u_crumple_on == 1) {
        // All-over crumple network (Worley 1996). Two shapes blended by crease:
        //  fbm(F1): smooth lumpy facets = Worley's own "crumpled paper" bump.
        //  F2-F1:   sharp ridge lines along the Voronoi boundaries.
        vec2 cp = (mm + vec2(u_crumple_seed * 13.7)) / max(u_crumple_scale_mm, 0.5);

        // Domain warp before the Worley lookup.
        //
        // This exists because of what a CORRECT hash costs here. Worley places
        // one feature point per cell at hash22(cell), and paperlab's hash22
        // derives both components from a single sin(), so the points land on a
        // curve rather than filling the cell: measured, they occupy 25% of the
        // available positions and clump 118x more than uniform scatter. That
        // degeneracy aligned and clustered the points, which is what produced
        // irregular stretched cells -- crazing that reads as crumpled paper.
        // An honest uniform hash scatters the points evenly and the cells come
        // out regular and hexagon-ish, which reads as bubble wrap.
        //
        // So the irregularity has to come from somewhere deliberate. Warping the
        // sample position with a low-frequency fbm stretches and bends the cells
        // organically, and unlike a broken hash it is controllable, and it does
        // not depend on how a particular driver rounds sin() with a 2^18
        // multiplier.
        if (u_legacy_noise != 1 && u_crumple_irregularity > 0.001) {
            vec2 wp = cp * 0.45;
            vec2 warp = vec2(fbm(wp + vec2(3.1, 7.7), 3, 0.5, 2.0),
                             fbm(wp + vec2(9.3, 1.9), 3, 0.5, 2.0)) - 0.5;
            cp += warp * u_crumple_irregularity * 2.2;
        }
        float lump = 0.0, amp = 1.0, fr = 1.0, tot = 0.0;
        for (int i = 0; i < 4; ++i) {
            lump += amp * worleyF1F2(cp * fr).x;
            tot += amp; amp *= 0.5; fr *= 2.0;
        }
        lump = lump / tot - 0.35;
        vec2 F = worleyF1F2(cp);
        float crease = (1.0 - smoothstep(0.0, 0.14, F.y - F.x)) - 0.2;
        float field = mix(lump * 1.4, crease, clamp(u_crumple_crease, 0.0, 1.0));
        h_um += field * u_crumple_amp_um;
    }

    frag_out = vec4(h_um, 0.0, 0.0, 1.0);
}
`, { common: true, legacy });

// --- separable Gaussian blur ------------------------------------------------
// Run twice (u_dir = (1,0) then (0,1)). Fixed loop bound with early break; the
// symmetric taps are gathered in one iteration so the worst case is 65 steps,
// not 129.
export const BLUR_FRAG = frag(/* glsl */ `
in vec2 uv;
out vec4 frag_out;

uniform sampler2D u_src;
uniform vec2  u_res;
uniform vec2  u_dir;
uniform float u_radius;

void main() {
    float sigma = max(u_radius / 3.0, 0.5);
    float R = min(u_radius, 64.0);
    vec2 texel = u_dir / u_res;
    float sum = texture(u_src, uv).r;
    float wsum = 1.0;
    for (int i = 1; i <= 64; ++i) {
        if (float(i) > R) break;
        float w = exp(-0.5 * float(i * i) / (sigma * sigma));
        sum += w * (texture(u_src, uv + float(i) * texel).r +
                    texture(u_src, uv - float(i) * texel).r);
        wsum += 2.0 * w;
    }
    frag_out = vec4(sum / max(wsum, 1e-5), 0.0, 0.0, 1.0);
}
`);

// --- cavity / curvature -----------------------------------------------------
// dH = blur(height) - height. A discrete Laplacian, which for a nearly-flat
// surface IS the mean curvature: the one term that escapes the emboss, because
// the shade takes max(dH,0) and that nonlinearity adds the bumps-vs-pits
// asymmetry a gradient cannot. Luft et al. SIGGRAPH 2006.
// Inputs are um; convert to mm then apply paperlab's x40 unitless scale.
export const CAVITY_FRAG = frag(/* glsl */ `
in vec2 uv;
out vec4 frag_out;

uniform sampler2D u_height;      // um
uniform sampler2D u_heightblur;  // um

void main() {
    float dH_um = texture(u_heightblur, uv).r - texture(u_height, uv).r;
    float dH_mm = dH_um * 0.001;
    frag_out = vec4(dH_mm * 40.0, 0.0, 0.0, 1.0);
}
`);

// --- normal -----------------------------------------------------------------
// Central differences give a physical slope (mm/mm); relief_exaggerate scales it
// so the gentle real cockle (~0.1 deg) is visible.
export const NORMAL_FRAG = frag(/* glsl */ `
in vec2 uv;
out vec4 frag_out;

uniform sampler2D u_height;   // um
uniform vec2  u_res;
uniform float u_px_per_mm;
uniform float u_exaggerate;

float H_mm(vec2 p) { return texture(u_height, p).r * 0.001; }

void main() {
    vec2 t = 1.0 / u_res;
    float texel_mm = 1.0 / u_px_per_mm;
    float sx = (H_mm(uv + vec2(t.x, 0.0)) - H_mm(uv - vec2(t.x, 0.0))) / (2.0 * texel_mm);
    float sy = (H_mm(uv + vec2(0.0, t.y)) - H_mm(uv - vec2(0.0, t.y))) / (2.0 * texel_mm);
    vec3 n = normalize(vec3(-sx * u_exaggerate, -sy * u_exaggerate, 1.0));
    frag_out = vec4(n, 1.0);
}
`);

// --- shade ------------------------------------------------------------------
// Multiplicative shade, centred so a flat sheet reads exactly 1.0. N.L against a
// single above-left light (the human prior: Mamassian & Goutcher 2001;
// Ramachandran 1988) + a specular lobe for cockle gloss + cavity darkening.
export const SHADE_FRAG = frag(/* glsl */ `
in vec2 uv;
out vec4 frag_out;

uniform sampler2D u_normal;
uniform sampler2D u_cavity;
uniform int   u_cavity_on;
uniform float u_cavity_lambda;

uniform float u_light_az_deg;
uniform float u_light_alt_deg;
uniform float u_diffuse_gain;
uniform int   u_spec_on;
uniform float u_spec_intensity;
uniform float u_spec_power;

void main() {
    vec3 N = normalize(texture(u_normal, uv).xyz);

    float az = radians(u_light_az_deg), al = radians(u_light_alt_deg);
    vec3 L = normalize(vec3(cos(al) * cos(az), cos(al) * sin(az), sin(al)));

    float ndl = dot(N, L);
    float ndl_flat = L.z;
    float shade = 1.0 + u_diffuse_gain * (ndl - ndl_flat);

    if (u_spec_on == 1) {
        vec3 V = vec3(0.0, 0.0, 1.0);
        vec3 Hh = normalize(L + V);
        float s = pow(max(dot(N, Hh), 0.0), max(u_spec_power, 1.0));
        // remove the flat-surface baseline so gloss shows only on tilted crests
        float s_flat = pow(max(dot(vec3(0.0, 0.0, 1.0), Hh), 0.0), max(u_spec_power, 1.0));
        shade += u_spec_intensity * (s - s_flat);
    }

    if (u_cavity_on == 1) {
        float dH = texture(u_cavity, uv).r;
        shade -= u_cavity_lambda * max(dH, 0.0);   // darken valleys, not peaks
    }

    frag_out = vec4(shade, 0.0, 0.0, 1.0);
}
`);

// --- albedo -----------------------------------------------------------------
// Paper's mass variation is a reflectance change, not relief, so formation lives
// here. Built as a Gaussian Scale Mixture (a field x a slowly-varying local
// scale), the actual model of natural images; a flat Gaussian is the degenerate
// case that reads as procedural. Modulated by a big-scale non-stationary FADE,
// plus sparse LIGHT scratches (fibre lift reads bright, not dark) and varied
// imperfections.
export const ALBEDO_FRAG = (legacy = false) => frag(/* glsl */ `
in vec2 uv;
out vec4 frag_out;

uniform vec2  u_res;
uniform float u_px_per_mm;
uniform vec2  u_seed_mm;   // per-surface offset into the noise fields

uniform int   u_form_on;
uniform float u_form_scale_mm;
uniform float u_form_amp;
uniform float u_form_gsm;
uniform float u_form_skew;
uniform int   u_form_source;
uniform float u_form_bandwidth;
uniform sampler2D u_form_tile;
uniform float u_form_tile_mm;

uniform int   u_fade_on;
uniform float u_fade_scale_mm;
uniform float u_fade_amount;

uniform int   u_scr_on;
uniform float u_scr_density;
uniform float u_scr_lightness;
uniform float u_scr_scale_mm;
uniform float u_scr_dark_frac;
uniform float u_scr_seed;

uniform int   u_mould_on;
uniform float u_laid_pitch_mm;
uniform float u_chain_pitch_mm;
uniform float u_mould_angle_deg;
uniform float u_mould_amount;
uniform float u_chain_ratio;
uniform float u_mould_wander;

uniform int   u_imp_on;
uniform float u_pit_density;
uniform float u_pit_depth;
uniform float u_pit_scale_mm;
uniform float u_mark_density;
uniform float u_mark_strength;
uniform float u_mark_scale_mm;
uniform float u_imp_seed;

void main() {
    // Everything in this pass is a pure function of position, so one offset
    // decorrelates formation, fade, scratches and imperfections together.
    vec2 mm = (uv * u_res) / u_px_per_mm + u_seed_mm;
    float albedo = 1.0;

    // --- non-stationary fade (cubed big-scale mask) ---
    // Its absence is the single biggest "this is procedural" tell: real paper is
    // not uniformly distressed.
    float fade = 0.0;
    if (u_fade_on == 1) {
        float m = fbm(mm / max(u_fade_scale_mm, 1.0), 3, 0.5, 2.0);
        fade = clamp(8.0 * m * m * m, 0.0, 1.0) * u_fade_amount;
    }

    // --- formation as a Gaussian Scale Mixture ---
    if (u_form_on == 1) {
        float f;
        if (u_form_source == 1) {
            float F0 = 1.0 / max(u_form_scale_mm, 0.1);
            float a = F0 * max(u_form_bandwidth, 0.05);
            f = gaborNoise(mm, F0, a, 7.0);
        } else if (u_form_source == 2) {
            f = texture(u_form_tile, mm / max(u_form_tile_mm, 1.0)).r - 0.5;
        } else {
            f = fbm(mm / max(u_form_scale_mm, 0.1), 4, 0.55, 2.0) - 0.5;
        }
        // local scale: a slowly-varying positive field multiplies the amplitude,
        // so local contrast itself fluctuates (the GSM structure).
        float ls = 0.4 + u_form_gsm * fbm(mm / max(u_form_scale_mm * 5.0, 0.5), 3, 0.5, 2.0);
        f *= ls;
        // Marginal skew. Real formation has a longer DARK tail: fibre flocs read
        // darker than the gaps between them read light. Breaking symmetry needs
        // an EVEN function of f. paperlab uses f * abs(f), which is ODD, so with
        // a negative coefficient it shrinks both tails equally: measured
        // histogram skew was 0.0102 at skew=0 and 0.0103 at skew=-1.0 while sd
        // collapsed from 9.58e-3 to 8.18e-3. The knob only ever removed contrast.
        if (u_legacy_noise == 1) {
            f += u_form_skew * (f * abs(f) - 0.15);
        } else {
            const float NOM_SD = 0.13;
            float fn = f / NOM_SD;
            f += u_form_skew * NOM_SD * 0.5 * (fn * fn - 1.0);
        }
        float dev = u_form_amp * f * 2.0;
        dev *= mix(1.0, 0.35, fade);
        albedo *= (1.0 + dev);
    }

    // --- mould marks: laid lines + chain lines ------------------------------
    // The one structural feature real paper has that paperlab does not model.
    // A sheet is formed on a wire mould, and the wires leave thinner paper where
    // they pressed: closely spaced LAID lines (roughly 1 mm apart, from the
    // wires themselves) and sparse perpendicular CHAIN lines (roughly every
    // 25-30 mm, from the stitching that holds the wires together). Thinner paper
    // is more translucent, so they read as a lightness variation, which is why
    // this belongs in the albedo alongside formation rather than in the height.
    //
    // This exists because of what removing the tiling revealed. The periodic
    // hash repeated the formation field every 472 x 189 px, which on a wide
    // element produced a coherent two-direction motif -- accidentally a passable
    // imitation of a mould mark. The statistics of the field did not change when
    // the tiling was removed (sd 3.77e-3 vs 3.70e-3), but the recognisable
    // structure did, and structure is what read as paper. So it is modelled
    // deliberately instead of arriving as an artifact.
    //
    // The lines WANDER: a mould is a woven wire screen under tension, not a
    // printing plate, so mechanically straight lines are the tell that gives a
    // procedural texture away.
    if (u_mould_on == 1) {
        float a = radians(u_mould_angle_deg);
        mat2 R = mat2(cos(a), -sin(a), sin(a), cos(a));
        vec2 t = R * mm;
        float wob = (fbm(mm / 45.0, 2, 0.5, 2.0) - 0.5) * u_mould_wander;
        float wob2 = (fbm(mm / 22.0 + vec2(11.3, 4.7), 2, 0.5, 2.0) - 0.5) * u_mould_wander * 0.5;

        // Laid lines: fine, dense, and not a pure sine. Real wires give a
        // rounded ridge, so the wave is biased toward its peaks.
        float lp = 6.2831853 * (t.x + wob + wob2) / max(u_laid_pitch_mm, 0.05);
        float laid = sin(lp);
        laid = sign(laid) * pow(abs(laid), 0.7);

        // Chain lines: NARROW ridges at a wide spacing, not a slow alternation.
        // A sine at a 26 mm pitch spends half its period light and half dark,
        // which the eye reads as general mottling rather than as lines. The
        // stitching wire is thin, so the mark is a thin bright line with flat
        // paper between: a narrow Gaussian pulse once per spacing.
        float cphase = fract((t.y + wob * 2.0) / max(u_chain_pitch_mm, 1.0));
        float cd = (cphase - 0.5) * 11.0;
        float chain = exp(-cd * cd) * 2.0 - 0.12;   // pulse, then re-centred

        // ADDED rather than mixed. Mixing trades one direction against the
        // other, and two directions at once is the entire point of a mould
        // mark. chain_ratio sets the balance; the 3.2 compensates for the
        // pulse being near zero most of the time, so the two read as comparable.
        float r = clamp(u_chain_ratio, 0.0, 1.0);
        float mould = laid * (1.0 - r) + chain * r * 3.2;
        // Quieted by the same non-stationary fade as everything else, so the
        // mould does not read as uniformly stamped across the whole sheet.
        albedo *= (1.0 + u_mould_amount * mould * (1.0 - 0.55 * fade));
    }

    // --- sparse scratches (mostly light fibre-lift, a fraction dark) ---
    if (u_scr_on == 1) {
        vec2 cell_mm = mm / max(u_scr_scale_mm, 0.2);
        vec2 cell = floor(cell_mm);
        float exists = step(1.0 - u_scr_density, hash21(cell * 1.7 + u_scr_seed));
        if (exists > 0.5) {
            vec2 f = fract(cell_mm) - 0.5;
            float ang = hash21(cell * 3.1 + u_scr_seed + 11.0) * 3.14159;
            vec2 dir = vec2(cos(ang), sin(ang));
            float perp = f.x * -dir.y + f.y * dir.x;
            float len = 0.28 + 0.2 * hash21(cell * 4.3 + u_scr_seed);
            float wid = 0.02 + 0.03 * hash21(cell * 6.1 + u_scr_seed);
            float along = f.x * dir.x + f.y * dir.y;
            float line = (1.0 - smoothstep(0.0, wid, abs(perp))) *
                         (1.0 - smoothstep(len, len + 0.15, abs(along)));
            float dark = step(hash21(cell * 8.9 + u_scr_seed), u_scr_dark_frac);
            float sgn = mix(1.0, -1.0, dark);
            albedo *= (1.0 + sgn * u_scr_lightness * line * (1.0 - fade));
        }
    }

    // --- sparse VARIED imperfections: pits + rarer larger marks ---
    if (u_imp_on == 1) {
        vec2 pm = mm / max(u_pit_scale_mm, 0.5);
        vec2 pc = floor(pm);
        if (hash21(pc * 1.9 + u_imp_seed + 31.0) < u_pit_density) {
            vec2 ctr = hash22(pc * 2.3 + u_imp_seed + 7.0);
            float rad = 0.06 + 0.12 * hash21(pc * 3.7 + u_imp_seed);
            float pit = 1.0 - smoothstep(0.0, rad, length(fract(pm) - ctr));
            float d = u_pit_depth * (0.5 + 0.5 * hash21(pc * 5.1 + u_imp_seed));
            albedo *= (1.0 - d * pit * (1.0 - 0.5 * fade));
        }
        vec2 kk = mm / max(u_mark_scale_mm, 1.0);
        vec2 kc = floor(kk);
        if (hash21(kc * 1.3 + u_imp_seed + 71.0) < u_mark_density) {
            vec2 ctr = hash22(kc * 2.9 + u_imp_seed + 13.0);
            float rad = 0.12 + 0.28 * hash21(kc * 4.1 + u_imp_seed);
            float m = 1.0 - smoothstep(0.0, rad, length(fract(kk) - ctr));
            m *= m;
            float sgn = (hash21(kc * 6.7 + u_imp_seed) < 0.5) ? -1.0 : 1.0;
            float str = u_mark_strength * (0.5 + 0.5 * hash21(kc * 9.2 + u_imp_seed));
            albedo *= (1.0 + sgn * str * m);
        }
    }

    frag_out = vec4(albedo, 0.0, 0.0, 1.0);
}
`, { common: true, legacy });

// --- mask (sheet silhouette) ------------------------------------------------
// A real sheet's edge is not a perfect line, and the silhouette is a strong
// "physical object" cue: the curled corner displaces the outline far more than
// any surface texture can.
export const MASK_FRAG = (legacy = false) => frag(/* glsl */ `
in vec2 uv;
out vec4 frag_out;

uniform vec2  u_res;
uniform vec4  u_page_rect;   // x0,y0,x1,y1 in canvas px (top-left origin)
uniform float u_px_per_mm;
uniform vec2  u_seed_mm;   // per-surface offset into the edge noise
uniform float u_wobble_px;
uniform float u_curl;
uniform float u_deckle_px;
uniform float u_radius_px;   // web addition: rounded corners, to match CSS boxes

// Fibrous deckle displacement along an edge: a clustered low-frequency ENVELOPE
// (where the tufts are) times a fine along-edge CARRIER (the fibres). The cheap
// P&S Group-C recipe: energy organized along the contour by construction.
//
// paperlab expresses both frequencies per PIXEL, which silently ties the fringe
// to the render resolution: the same sheet at another DPI grows or shrinks its
// fibres. Here they are per MILLIMETRE, matching the rest of the scale model.
// The constants are paperlab's own frequencies converted at its native 150 DPI
// half-resolution (2.95 px/mm), so the look is preserved and only the coupling
// to resolution is removed.
//   carrier  0.35 /px x 2.95 px/mm = 1.03 cycles/mm  (individual fibres, ~1 mm)
//   envelope 0.045/px x 2.95 px/mm = 0.133 cycles/mm (tuft clusters, ~7.5 mm)
float deckle(float t_mm, float seed) {
    float carrier  = fbm(vec2(t_mm * 1.03, seed), 3, 0.5, 2.0) - 0.5;
    float envelope = fbm(vec2(t_mm * 0.133, seed + 11.0), 2, 0.5, 2.0);
    return carrier * 2.0 * envelope * u_deckle_px;
}

void main() {
    vec2 p = vec2(uv.x, 1.0 - uv.y) * u_res;
    // The seed offsets only where the edge noise is SAMPLED. Variable p stays in
    // real canvas pixels because the rectangle test and the corner curl are
    // geometry, not noise: offsetting those would move the sheet off the element.
    vec2 mm = p / max(u_px_per_mm, 1e-3) + u_seed_mm;
    vec2 lo = u_page_rect.xy, hi = u_page_rect.zw;

    // Low-frequency silhouette wobble, also per mm: 0.01/px at 2.95 px/mm is
    // 0.0295 cycles/mm, a ~34 mm undulation down the edge.
    const float WOB = 0.0295;
    float wl = (fbm(vec2(mm.y * WOB, 1.0), 3, 0.5, 2.0) - 0.5) * 2.0 * u_wobble_px + deckle(mm.y, 1.5);
    float wr = (fbm(vec2(mm.y * WOB, 9.0), 3, 0.5, 2.0) - 0.5) * 2.0 * u_wobble_px + deckle(mm.y, 8.5);
    float wt = (fbm(vec2(mm.x * WOB, 3.0), 3, 0.5, 2.0) - 0.5) * 2.0 * u_wobble_px + deckle(mm.x, 3.5);
    float wb = (fbm(vec2(mm.x * WOB, 7.0), 3, 0.5, 2.0) - 0.5) * 2.0 * u_wobble_px + deckle(mm.x, 6.5);

    // curl pulls corners inward (a lifted corner occludes toward the sheet centre)
    vec2 c = 0.5 * (lo + hi);
    vec2 rel = (p - c) / max(0.5 * (hi - lo), vec2(1.0));
    float corner = smoothstep(0.6, 1.0, max(abs(rel.x), abs(rel.y)));
    float curl_in = u_curl * corner * 0.04 * (hi.x - lo.x);

    float aa = 1.0 + u_deckle_px * 0.6;

    float inside;
    if (u_radius_px > 0.5) {
        // Rounded-rect signed distance, so the sheet can match a CSS
        // border-radius. Edge displacement is applied as a radial perturbation
        // sampled from the same wobble/deckle fields, so a rounded sheet still
        // gets a fibrous silhouette.
        vec2 half_sz = 0.5 * (hi - lo);
        float r = min(u_radius_px, min(half_sz.x, half_sz.y));
        vec2 q = abs(p - c) - (half_sz - vec2(r));
        float sd = length(max(q, vec2(0.0))) + min(max(q.x, q.y), 0.0) - r;
        // pick the perturbation from whichever axis dominates at this point
        float w = mix(mix(wl, wr, step(0.0, rel.x)), mix(wt, wb, step(0.0, rel.y)),
                      step(abs(rel.x), abs(rel.y)));
        inside = 1.0 - smoothstep(-aa, aa, sd - w + curl_in);
    } else {
        inside =
            smoothstep(lo.x + wl - aa, lo.x + wl + aa, p.x + curl_in) *
            smoothstep(hi.x + wr + aa, hi.x + wr - aa, p.x - curl_in) *
            smoothstep(lo.y + wt - aa, lo.y + wt + aa, p.y + curl_in) *
            smoothstep(hi.y + wb + aa, hi.y + wb - aa, p.y - curl_in);
    }

    frag_out = vec4(inside, 0.0, 0.0, 1.0);
}
`, { common: true, legacy });

// --- composite --------------------------------------------------------------
// Final image: void -> contact-hardened cast shadow -> sheet. The sheet occupies
// u_page_rect within the (larger) canvas; the margin is void so the shadow has
// somewhere to fall. The shadow mixes a tight core (contact) with a soft halo
// (lift): a uniform offset blur is exactly what makes a fake drop shadow read as
// fake.
//
// Web addition over paperlab: an alpha output. paperlab always paints an opaque
// void because it is a desktop inspector; on a page the void must be transparent
// so the sheet composites over whatever the site's own background is. The cast
// shadow therefore writes alpha rather than darkening an opaque void colour.
export const COMPOSITE_FRAG = frag(/* glsl */ `
in vec2 uv;
out vec4 frag_out;

uniform vec2  u_res;
uniform vec4  u_page_rect;

uniform sampler2D u_content;
uniform sampler2D u_shade;
uniform sampler2D u_albedo;
uniform sampler2D u_mask;
uniform sampler2D u_shadow_t;
uniform sampler2D u_shadow_w;
uniform sampler2D u_cavity;

uniform vec3  u_tone;
uniform vec3  u_ink;
uniform float u_gate_lo;
uniform float u_gate_hi;

uniform int   u_ink_km;
uniform vec3  u_km_a;
uniform vec3  u_km_b;
uniform vec3  u_km_S;
uniform float u_ink_thickness;
uniform float u_ink_gran;

uniform vec3  u_hi_tint;
uniform vec3  u_lo_tint;
uniform float u_duotone;

uniform vec2  u_shadow_dir;
uniform float u_shadow_offset;
uniform float u_shadow_darkness;
uniform float u_shadow_contact;

uniform int   u_content_alpha;   // 1 = content texture carries meaningful alpha
uniform float u_opacity;

void main() {
    float mask = texture(u_mask, uv).r;

    // --- shadow (only visible on the void, i.e. where mask ~ 0) ---
    vec2 s_uv = uv + u_shadow_dir * u_shadow_offset;
    float st = texture(u_shadow_t, s_uv).r;
    float sw = texture(u_shadow_w, s_uv).r;
    float shadow = max(st * u_shadow_contact, sw);
    float occl = clamp(shadow, 0.0, 1.0) * (1.0 - mask);

    // --- sheet ---
    vec2 cpx = vec2(uv.x, 1.0 - uv.y) * u_res;
    vec2 lo = u_page_rect.xy, hi = u_page_rect.zw;
    vec2 puv = (cpx - lo) / max(hi - lo, vec2(1.0));
    vec4 csample = texture(u_content, vec2(puv.x, 1.0 - puv.y));
    // Content is "1 paper, 0 ink". A rasterised DOM snapshot arrives premultiplied
    // with transparent gaps where the element has no background, so composite it
    // over white first: transparent must read as paper, not as full ink.
    float c = u_content_alpha == 1
        ? clamp(csample.r + (1.0 - csample.a), 0.0, 1.0)
        : clamp(csample.r, 0.0, 1.0);

    float shade = texture(u_shade, uv).r;
    float albedo = texture(u_albedo, uv).r;

    // warm/cool duotone: a scalar shade x a beige tint cannot hue-shift; tint the
    // highlights warm and the shadows cool (painter's rule).
    float s = shade - 1.0;
    vec3 warm = mix(vec3(1.0), u_hi_tint, clamp(s * 4.0, 0.0, 1.0) * u_duotone);
    vec3 cool = mix(vec3(1.0), u_lo_tint, clamp(-s * 4.0, 0.0, 1.0) * u_duotone);
    vec3 tint = warm * cool;

    vec3 sheet;
    if (u_ink_km == 1) {
        // Kubelka-Munk: the paper substrate carries the FULL shade/albedo/tint (no
        // gate). Ink is a layer of optical thickness x on top; its transmittance
        // lets the lit, textured paper show through, so thin ink (AA edges) is
        // partly transparent and thick ink hides the sheet. c drives x.
        vec3 paper = u_tone * shade * albedo * tint;
        // Granulation: pigment pools in the relief valleys (cavity > 0), so ink is
        // denser there and thinner on the peaks.
        float gran = 1.0 + u_ink_gran * texture(u_cavity, uv).r;
        float x = (1.0 - c) * u_ink_thickness * max(gran, 0.0);
        vec3 bSx = u_km_b * u_km_S * x;
        vec3 sh = sinh(bSx), ch = cosh(bSx);
        vec3 cc = u_km_a * sh + u_km_b * ch;
        vec3 Rink = sh / cc;
        vec3 Tink = u_km_b / cc;
        sheet = Rink + Tink * Tink * paper / max(1.0 - Rink * paper, vec3(1e-3));
    } else {
        // Legacy lerp + luminance gate (kept for A/B).
        vec3 base = mix(u_ink, u_tone, c);
        float lum = dot(base, vec3(0.299, 0.587, 0.114));
        float w = smoothstep(u_gate_lo, u_gate_hi, lum);
        float eff_shade = mix(1.0, shade, w);
        float eff_alb = mix(1.0, albedo, w);
        vec3 eff_tint = mix(vec3(1.0), tint, w);
        sheet = base * eff_shade * eff_alb * eff_tint;
    }

    // Alpha-out: the sheet is opaque, the void is transparent except where the
    // cast shadow falls. Colour is premultiplied so the canvas composites
    // correctly over the page behind it.
    float shadow_a = u_shadow_darkness * occl;
    float a = clamp(mask + shadow_a * (1.0 - mask), 0.0, 1.0) * u_opacity;
    vec3 col = clamp(sheet, 0.0, 2.0) * mask;   // shadow contributes black, so no term
    frag_out = vec4(col * u_opacity, a);
}
`);

// --- present / inspector ----------------------------------------------------
// Debug readback: map any intermediate buffer into a viewable RGBA image. Ported
// from paperlab's present.frag, minus pan/zoom (the web debug path reads the
// whole buffer at once).
export const PRESENT_FRAG = frag(/* glsl */ `
in vec2 uv;
out vec4 frag_out;

uniform sampler2D u_buf;
uniform int   u_mode;        // 0 = rgba passthrough, 1 = scalar, 2 = normal
uniform float u_center;
uniform float u_span;
uniform int   u_false_color;

vec3 heat(float t) {
    t = clamp(t, 0.0, 1.0);
    return clamp(vec3(1.5 - abs(4.0 * t - 3.0),
                      1.5 - abs(4.0 * t - 2.0),
                      1.5 - abs(4.0 * t - 1.0)), 0.0, 1.0);
}

void main() {
    vec4 v = texture(u_buf, uv);
    vec3 col;
    if (u_mode == 2) {
        col = v.xyz * 0.5 + 0.5;
    } else if (u_mode == 1) {
        float t = (v.r - u_center) / max(u_span, 1e-6) + 0.5;
        col = (u_false_color == 1) ? heat(t) : vec3(clamp(t, 0.0, 1.0));
    } else {
        col = v.rgb;
    }
    frag_out = vec4(col, 1.0);
}
`);
