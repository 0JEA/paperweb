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
uniform float u_fold_chance;
uniform float u_fold_seed;

uniform int   u_stain_count;
uniform vec4  u_stain[4];        // x, y in mm from the sheet origin; z radius_mm; w strength
uniform int   u_stain_kind[4];   // 0 ring, 1 tide, 2 blot
uniform float u_stain_seed;
uniform float u_stain_amount;
uniform float u_stain_relief_um;

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
        vec2 sheet_mm = u_res / u_px_per_mm;
        float longest = max(sheet_mm.x, sheet_mm.y);
        for (int i = 0; i < 8; ++i) {
            if (float(i) >= u_fold_count) break;
            vec2 r1 = hash22(vec2(float(i) * 3.7 + u_fold_seed, 1.3));
            vec2 r2 = hash22(vec2(float(i) * 7.1 + u_fold_seed, 5.9));
            vec2 r3 = hash22(vec2(float(i) * 11.9 + u_fold_seed, 2.7));

            // count is a MAXIMUM, not a quota. paperlab draws exactly the count
            // folds on every sheet, which is why a page of them looked
            // stamped: same number of creases everywhere. Each candidate now
            // has to pass a roll, so sheets genuinely differ in how used they
            // look and an unfolded sheet is a possible outcome.
            if (r3.x > u_fold_chance) continue;

            // Anywhere on the sheet. paperlab places p0 along the diagonal
            // (r1.y * sheet + 0.2 * sheet), which quietly concentrates every
            // crease on one axis of the page.
            vec2 p0 = r1 * sheet_mm;

            // ORIENTATION. A sheet is folded across its width far more often
            // than on a diagonal, so the angle is biased hard toward
            // horizontal: a power curve on a symmetric variate keeps most
            // creases within a few degrees of level while still allowing the
            // occasional slant.
            float t = r2.x * 2.0 - 1.0;
            float ang = sign(t) * pow(abs(t), 2.4) * 1.0472;   // +/-60 deg, dense near 0

            // ...except near the left and right edges, where a crease is
            // usually a side or corner turned in, and those run vertically.
            float edgeDist = min(p0.x, sheet_mm.x - p0.x) / max(sheet_mm.x, 1.0);
            // Threshold kept tight on purpose. edgeDist is uniform on [0, 0.5]
            // because p0 is uniform, so a 0.30 cutoff would turn 60% of creases
            // vertical and swamp the horizontal bias. At 0.16 it is about a
            // quarter, which reads as "usually across, sometimes a side turned
            // in".
            float nearSide = smoothstep(0.16, 0.03, edgeDist);
            ang = mix(ang, 1.5708 + ang * 0.30, nearSide);

            vec2 dir = vec2(cos(ang), sin(ang));
            vec2 nrm = vec2(-dir.y, dir.x);
            vec2 rel = mm_sheet - p0;
            float d = dot(rel, nrm);
            float along = dot(rel, dir);

            // FINITE LENGTH. paperlab's fold is an infinite line, so every
            // crease runs edge to edge. Real folds often stop: a dog-ear, a
            // half fold, a crease that peters out. The end taper is soft so it
            // does not terminate in a visible cap.
            float halfLen = mix(0.28, 1.10, r3.y) * longest * 0.5;
            float ends = 1.0 - smoothstep(halfLen * 0.62, halfLen, abs(along));
            if (ends <= 0.0) continue;

            // Two scales: a broad relaxed tilt, and the narrow crease line that
            // actually catches the light. The crease is clamped to about a
            // texel and a half or it aliases into a dashed line.
            // The relaxed tilt is narrower than a first guess suggests, and
            // carries LESS of the amplitude than the crease does. At 14 mm it
            // spans 106 px of a 220 px card, so the soft wedge swamped the
            // crease line and a fold read as a broad diagonal band. What you
            // actually notice on folded paper is the crease; the tilt is the
            // quiet part that tells you which way it went.
            float broad = 1.0 - abs(clamp(d / 9.0, -1.0, 1.0));
            float crease_mm = max(mix(1.8, 0.5, clamp(u_fold_sharpness, 0.0, 1.0)),
                                  1.5 / max(u_px_per_mm, 0.5));
            float crease = exp(-(d * d) / (crease_mm * crease_mm));
            float sgn = (r2.y < 0.5) ? -1.0 : 1.0;
            h_um += sgn * u_fold_depth * (14.0 * broad + 29.0 * crease) * ends;
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
        // FACETS, not a crack network.
        //
        // paperlab builds this from fbm(F1) plus an F2-F1 ridge. Both terms are
        // functions of DISTANCE to the feature point, so every cell boundary is
        // treated identically and the result is a uniform polygon mesh: dried
        // mud, not paper. Worse, fbm(F1) inherits F1's kinked gradient at the
        // boundaries, so even at crease 0 the network shows.
        //
        // A crumpled sheet is a polyhedron. Each facet is FLAT and sits at its
        // own random tilt; the creases are wherever two facets happen to meet,
        // so they vary in prominence for free rather than all being drawn the
        // same. Giving each Worley cell its own plane produces that directly.
        vec4 W = worleyCell(cp);
        vec2 cell = W.zw;
        vec2 feat = cell + hash22(cell);
        vec2 tilt = hash22(cell + vec2(17.3, 5.9)) * 2.0 - 1.0;

        // Each cell is a tilted plane, but the plane is faded out toward the
        // cell BOUNDARY rather than carrying a per-cell height offset.
        //
        // A per-cell offset gives every boundary a height step, and a height
        // step is a cliff. Rendered, that is cracked ceramic: hard-edged plates
        // with shadow in the gaps. Paper does not break when it crumples, so a
        // crease is a discontinuity in ANGLE and never in height.
        //
        // Fading both neighbours to zero at the boundary they share makes the
        // surface continuous across it while leaving their slopes to disagree,
        // which is exactly a crease. It also dishes each facet slightly, which
        // is what a crumpled panel really does between its folds.
        float atBoundary = smoothstep(0.0, 0.22, W.y - W.x);
        float facet = dot(cp - feat, tilt) * 0.62 * atBoundary;

        // The crease term is kept as a blendable extra rather than the default,
        // because a sharply creased network is a real look, just not the baseline.
        float crease = (1.0 - smoothstep(0.0, 0.14, W.y - W.x)) - 0.2;
        float field = mix(facet, crease, clamp(u_crumple_crease, 0.0, 1.0));
        h_um += field * u_crumple_amp_um;
    }

    // Stains lift the sheet. Liquid swells the fibres, so a dried stain is a
    // shallow dish with a raised rim, and that relief is what makes it sit in
    // the paper instead of on top of it.
    for (int i = 0; i < 4; ++i) {
        if (i >= u_stain_count) break;
        vec2 sm = mm_sheet - u_stain[i].xy;
        vec2 f = stainField(sm, u_stain[i].z, u_stain_seed + float(i) * 7.3, u_stain_kind[i]);
        h_um += f.y * u_stain_relief_um * u_stain[i].w * u_stain_amount;
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
uniform float u_highlight_ceiling;

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

    // HIGHLIGHT SHOULDER.
    //
    // Measured with the default light: a facet aligned to the half-vector takes
    // diffuse to +0.234 and specular to +0.459, so shade peaks near 1.69. On a
    // #FFF3DE sheet that clips to pure white, and everything inside the
    // highlight flattens to the same value: a fold stops being paper catching
    // the light and becomes a painted white bar.
    //
    // Rolling off exponentially toward a ceiling keeps the ORDERING of values
    // inside the highlight, so the crease stays legible. The curve is very close
    // to linear for small excursions, so ordinary cockle sheen is untouched;
    // only the extremes are compressed.
    if (shade > 1.0) {
        float over = shade - 1.0;
        float head = max(u_highlight_ceiling - 1.0, 1e-3);
        shade = 1.0 + head * (1.0 - exp(-over / head));
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

uniform int   u_stain_count;
uniform vec4  u_stain[4];        // x, y in mm from the sheet origin; z radius_mm; w strength
uniform int   u_stain_kind[4];   // 0 ring, 1 tide, 2 blot
uniform float u_stain_seed;
uniform float u_stain_amount;
uniform vec3  u_stain_tint[4];
uniform int   u_fox_on;
uniform float u_fox_density;
uniform float u_fox_strength;

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
    vec3 albedo = vec3(1.0);

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

    // --- sparse blemishes: scratches, pits, marks ---------------------------
    // Every one of these scans the 3x3 CELL NEIGHBOURHOOD rather than only the
    // pixel's own cell.
    //
    // Testing just the own cell clips any feature whose extent crosses a cell
    // boundary, so a pit near an edge renders as a hard SQUARE and a scratch is
    // chopped at the cell wall. paperlab has this bug; the zathura port fixed it
    // and calls it the "bounding box artifact". Neighbours must contribute.
    //
    // Falloff is linear rather than smoothstep, also following zathura: a
    // smoothstepped scratch has no crisp core and reads as a smudge.

    // Scratches: LONG and thin. paperlab's 3 mm cell with a 0.28-0.48 half-length
    // makes marks about 1 mm long at a 10:1 aspect, which reads as lint rather
    // than fibre lift. zathura's tuned values are a ~12 mm cell at 25:1, giving
    // scratches several millimetres long. Mostly light, because lifted fibre
    // catches the light; a minority are dark, from pressed lines and dirt.
    if (u_scr_on == 1) {
        float cell_sz = max(u_scr_scale_mm, 0.5);
        vec2 cm = mm / cell_sz;
        vec2 base = floor(cm);
        for (int j = -1; j <= 1; ++j)
        for (int i = -1; i <= 1; ++i) {
            vec2 g = base + vec2(float(i), float(j));
            if (hash21(g * 1.7 + u_scr_seed) >= u_scr_density) continue;
            vec2 o = hash22(g * 2.3 + u_scr_seed + 5.0);
            float ang = hash21(g * 3.1 + u_scr_seed + 11.0) * 3.14159265;
            float ca = cos(ang), sa = sin(ang);
            vec2 d = cm - (g + o);
            float perp  = d.x * -sa + d.y * ca;
            float along = d.x *  ca + d.y * sa;
            float len = 0.30 + 0.45 * hash21(g * 4.3 + u_scr_seed);
            float wid = 0.010 + 0.020 * hash21(g * 6.1 + u_scr_seed);
            if (abs(perp) >= wid || abs(along) >= len) continue;
            float fall = (1.0 - abs(perp) / wid) * (1.0 - abs(along) / len);
            float sgn = (hash21(g * 8.9 + u_scr_seed) < u_scr_dark_frac) ? -1.0 : 1.0;
            albedo *= (1.0 + sgn * u_scr_lightness * fall * (1.0 - fade));
        }
    }

    if (u_imp_on == 1) {
        // Pits: small dark dents from fibre pull and impressions.
        float pcell = max(u_pit_scale_mm, 0.5);
        vec2 pm = mm / pcell;
        vec2 pbase = floor(pm);
        for (int j = -1; j <= 1; ++j)
        for (int i = -1; i <= 1; ++i) {
            vec2 g = pbase + vec2(float(i), float(j));
            if (hash21(g * 1.9 + u_imp_seed + 31.0) >= u_pit_density) continue;
            vec2 ctr = hash22(g * 2.3 + u_imp_seed + 7.0);
            float rad = 0.06 + 0.12 * hash21(g * 3.7 + u_imp_seed);
            float dist = length(pm - (g + ctr));
            if (dist >= rad) continue;
            float m = 1.0 - dist / rad;
            float dep = u_pit_depth * (0.5 + 0.5 * hash21(g * 5.1 + u_imp_seed));
            albedo *= (1.0 - dep * m * (1.0 - 0.5 * fade));
        }

        // Marks: rarer, larger, light OR dark blotches. Squared falloff keeps
        // them soft-edged so they read as stains rather than as discs.
        float kcell = max(u_mark_scale_mm, 1.0);
        vec2 km = mm / kcell;
        vec2 kbase = floor(km);
        for (int j = -1; j <= 1; ++j)
        for (int i = -1; i <= 1; ++i) {
            vec2 g = kbase + vec2(float(i), float(j));
            if (hash21(g * 1.3 + u_imp_seed + 71.0) >= u_mark_density) continue;
            vec2 ctr = hash22(g * 2.9 + u_imp_seed + 13.0);
            float rad = 0.12 + 0.20 * hash21(g * 4.1 + u_imp_seed);
            float dist = length(km - (g + ctr));
            if (dist >= rad) continue;
            float m = 1.0 - dist / rad;
            m *= m;
            float sgn = (hash21(g * 6.7 + u_imp_seed) < 0.5) ? -1.0 : 1.0;
            float str = u_mark_strength * (0.5 + 0.5 * hash21(g * 9.2 + u_imp_seed));
            albedo *= (1.0 + sgn * str * m);
        }
    }

    // --- stains --------------------------------------------------------------
    // Placed marks, in sheet coordinates rather than the seed-offset field: a
    // stain is somewhere specific on this sheet, not a property of the stock.
    vec2 mm_sheet_a = (uv * u_res) / u_px_per_mm;
    for (int i = 0; i < 4; ++i) {
        if (i >= u_stain_count) break;
        vec2 sm = mm_sheet_a - u_stain[i].xy;
        vec2 f = stainField(sm, u_stain[i].z, u_stain_seed + float(i) * 7.3, u_stain_kind[i]);
        float amt = f.x * u_stain[i].w * u_stain_amount;
        // The tint is what the stain takes OUT of the paper, per channel, which
        // is how a brown stain stays brown over a cream sheet.
        albedo *= clamp(1.0 - amt * u_stain_tint[i], 0.0, 1.0);
    }

    // --- foxing --------------------------------------------------------------
    // Rusty age spots. Separate from imperfect because foxing is CLUSTERED:
    // it follows damp and residual iron in the stock, so a low-frequency mask
    // gates it rather than scattering it evenly.
    if (u_fox_on == 1) {
        float cluster = fbm(mm / 34.0 + 5.5, 3, 0.5, 2.0);
        cluster = smoothstep(0.45, 0.85, cluster);
        if (cluster > 0.01) {
            vec2 fm = mm / 3.2;
            vec2 fb = floor(fm);
            for (int j = -1; j <= 1; ++j)
            for (int i = -1; i <= 1; ++i) {
                vec2 g = fb + vec2(float(i), float(j));
                if (hash21(g * 2.7 + 91.0) >= u_fox_density * cluster) continue;
                vec2 ctr = hash22(g * 3.3 + 17.0);
                float rad = 0.10 + 0.22 * hash21(g * 5.9 + 3.0);
                float dist = length(fm - (g + ctr));
                if (dist >= rad) continue;
                float m = 1.0 - dist / rad;
                m *= m;
                float fx = u_fox_strength * m * (0.5 + 0.5 * hash21(g * 7.1));
                // Iron-tannate rust: strongest absorption in blue, least in red.
                albedo *= clamp(1.0 - fx * vec3(0.62, 0.86, 1.0), 0.0, 1.0);
            }
        }
    }

    frag_out = vec4(albedo, 1.0);
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
uniform vec2  u_seed_mm;
uniform float u_wobble_px;   // slow wander: the cut was never perfectly straight
uniform float u_deckle_px;   // fibrous mould edge: tufts with fibres riding them
uniform float u_tear_px;     // torn edge: angular runs with sudden direction changes
uniform float u_curl;
uniform float u_radius_px;
// 1 = the sheet's real silhouette. 0 = its BODY only, with the fibre-scale
// detail left off. The cast shadow uses the body: a torn fringe is thin paper
// lying almost flat against the sheet and does not cast a resolvable shadow
// into its own notches. Blurring the detailed mask instead paints every notch
// dark, which against a dark page turns a torn edge into a row of black teeth.
uniform float u_edge_detail;

void main() {
    vec2 p = vec2(uv.x, 1.0 - uv.y) * u_res;
    vec2 lo = u_page_rect.xy, hi = u_page_rect.zw;
    vec2 c = 0.5 * (lo + hi);
    vec2 halfSz = max(0.5 * (hi - lo), vec2(1.0));
    float r = clamp(u_radius_px, 0.0, min(halfSz.x, halfSz.y) - 0.5);

    // ONE signed distance for the whole silhouette, rounded-rect with r = 0
    // giving a plain rectangle, so there is a single code path.
    vec2 q = abs(p - c) - (halfSz - vec2(r));
    float sd = length(max(q, vec2(0.0))) + min(max(q.x, q.y), 0.0) - r;

    // The edge noise is sampled at the CLOSEST POINT ON THE BOUNDARY.
    //
    // paperlab displaces each of the four edges by an independent function of a
    // single coordinate, then multiplies four smoothsteps together. Two things
    // follow, and both are visible. The corners are attenuated twice, so they
    // read as chewed rather than cut. And the left edge's wander is unrelated to
    // the top edge's, so the outline jumps exactly where a corner draws the eye.
    //
    // Sampling a 2-D field at the nearest boundary point instead gives one
    // continuous contour: walking around the outline, the displacement varies
    // smoothly, corners included, because adjacent boundary points are adjacent
    // in the field.
    vec2 near = c + clamp(p - c, -halfSz, halfSz);
    vec2 nmm = near / max(u_px_per_mm, 1e-3) + u_seed_mm;

    float disp = 0.0;

    // BAND-LIMIT the fine edge detail to what the raster can actually carry.
    //
    // The fibre carrier runs at 1.03 cycles/mm, which at 96 dpi and dpr 1 is one
    // cycle every 3.7 px: right at Nyquist, where it cannot resolve and can only
    // alias into a regular comb. At dpr 2 the same field has 7.3 px per cycle
    // and renders as the fibrous tuft edge it is meant to be. Measured both:
    // magnified 2x on a large sheet the edge is correct, and the comb only
    // appears on small low-dpr cards.
    //
    // So fade the fine terms out as they approach the pixel grid, instead of
    // drawing something the grid will turn into a pattern. Detail reappears on
    // its own when there are pixels to draw it with.
    float fibrePx = u_px_per_mm / 1.03;          // px per fibre cycle
    float fine = smoothstep(2.5, 6.0, fibrePx);

    // WOBBLE: a slow undulation, ~34 mm period. Even a guillotined edge has it.
    if (u_wobble_px > 0.001) {
        disp += (fbm(nmm * 0.0295, 3, 0.5, 2.0) - 0.5) * 2.0 * u_wobble_px;
    }

    // DECKLE: the mould edge. A clustered tuft envelope with fine fibres riding
    // on it, summed rather than multiplied so the fibres modulate the tufts
    // instead of setting the whole amplitude.
    if (u_deckle_px > 0.001 && u_edge_detail > 0.5) {
        float env = fbm(nmm * 0.133 + vec2(11.0, 3.0), 2, 0.5, 2.0) - 0.5;
        float car = fbm(nmm * 1.03 + vec2(2.0, 7.0), 3, 0.5, 2.0) - 0.5;
        // The TUFT envelope scales with deckle_px. The FIBRE carrier does NOT:
        // it is capped at a physical fibre width, because a fibre is a fibre
        // whatever size tuft it sits in.
        //
        // Letting the carrier scale was the comb. At 1.03 cycles/mm it
        // oscillates every ~3.7 px at 96 dpi, so a 14 px deckle swung it +/-5.9
        // px over a 3.7 px period: far faster than the feather can resolve, and
        // it aliased into regular black teeth. Capped at 0.35 mm the fibres are
        // sub-pixel-ish and read as fuzz on the tuft, which is what they are.
        float fibre_px = min(u_deckle_px * 0.42, 0.35 * u_px_per_mm);
        disp += env * 1.55 * u_deckle_px + car * 2.0 * fibre_px * fine;
    }

    // TEAR: paper does not tear smoothly. It runs straight for a while, catches,
    // and turns. A ridged (folded) noise gives exactly that: near-linear runs
    // separated by sudden direction changes, where a plain fbm would only wander.
    // Biased inward, because a tear removes material more often than it adds a
    // flap.
    if (u_tear_px > 0.001 && u_edge_detail > 0.5) {
        float n1 = fbm(nmm * 0.28 + vec2(5.5, 1.7), 3, 0.55, 2.1) - 0.5;
        float n2 = fbm(nmm * 0.9 + vec2(0.3, 9.1), 2, 0.5, 2.0) - 0.5;
        float ridged = 0.5 - abs(n1) * 2.0;
        // Same cap as the deckle carrier, for the same reason: the fine term is
        // physical roughness along the tear, not a fraction of how deep it runs.
        float rough_px = min(u_tear_px * 0.35, 0.45 * u_px_per_mm);
        disp += (ridged - 0.12) * u_tear_px + n2 * 2.0 * rough_px * fine;
    }

    // Curl pulls the corners inward: a lifted corner occludes toward the centre.
    vec2 rel = (p - c) / halfSz;
    float corner = smoothstep(0.6, 1.0, max(abs(rel.x), abs(rel.y)));
    disp -= u_curl * corner * 0.04 * halfSz.x * 2.0;

    // Feather in proportion to how hard the edge is being displaced. A 1 px
    // transition on an outline that wanders 8 px reads as a stair, because the
    // displacement changes faster than the feather can hide it.
    // Feather. Kept small: the signed distance is already smooth, so this only
    // has to cover one pixel of rasterisation. The old value scaled hard with
    // deckle and reached 5.3 px at deckle 14, which blurred a torn edge into a
    // soft grey band and threw away the fibre detail underneath it.
    float aa = 0.7 + (u_deckle_px + u_tear_px) * 0.05 + u_wobble_px * 0.03;

    frag_out = vec4(1.0 - smoothstep(-aa, aa, sd - disp), 0.0, 0.0, 1.0);
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
uniform float u_ink_coverage;

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
    vec3 albedo = texture(u_albedo, uv).rgb;

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
        float cover = 1.0 - c;

        // COVERAGE vs THICKNESS. A mid-grey in the content texture means two
        // completely different things depending on where it came from, and
        // paperlab only models one of them.
        //
        //   thickness  a wash or a halftone: the ink layer covers the whole
        //              pixel but is thinner, so drive optical depth by the grey.
        //   coverage   an antialiased glyph edge: full-strength ink covers PART
        //              of the pixel, so keep the layer at full thickness and
        //              blend by area.
        //
        // Kubelka-Munk is strongly nonlinear, so the difference is not subtle.
        // Measured against the default ink, a half-covered edge (c = 0.5) comes
        // out at 0.273 under the thickness reading and 0.521 under coverage.
        // Every glyph therefore gains a dark rim and rasterized text reads bold.
        // Text is the common case for content:'rasterize', so coverage is the
        // default; drop u_ink_coverage to 0 for scanned washes and photographs.
        float x = u_ink_thickness * max(gran, 0.0) * mix(cover, 1.0, u_ink_coverage);
        vec3 bSx = u_km_b * u_km_S * x;
        vec3 sh = sinh(bSx), ch = cosh(bSx);
        vec3 cc = u_km_a * sh + u_km_b * ch;
        vec3 Rink = sh / cc;
        vec3 Tink = u_km_b / cc;
        vec3 inked = Rink + Tink * Tink * paper / max(1.0 - Rink * paper, vec3(1e-3));
        sheet = mix(inked, mix(paper, inked, cover), u_ink_coverage);
    } else {
        // Legacy lerp + luminance gate (kept for A/B).
        vec3 base = mix(u_ink, u_tone, c);
        float lum = dot(base, vec3(0.299, 0.587, 0.114));
        float w = smoothstep(u_gate_lo, u_gate_hi, lum);
        float eff_shade = mix(1.0, shade, w);
        vec3 eff_alb = mix(vec3(1.0), albedo, w);
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
