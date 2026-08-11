// The pass graph. A direct port of paperlab's App::run_pipeline, including its
// resolution split: the effect fields render at HALF resolution and only the
// composite runs full-res, which is what keeps the ink and the sheet edge crisp
// while the (smooth, low-frequency) relief and albedo cost a quarter as much.
//
//   height  ->  heightblur  ->  cavity
//   height  ->  normal      ->  shade  (+ cavity)
//   albedo
//   mask    ->  shadowT (tight blur)
//           ->  shadowW (wide blur)
//   composite(content, shade, albedo, mask, shadowT, shadowW, cavity)
//
// Twelve full-screen draws in total; the blur is separable and runs twice per
// blurred target.
//
// Departure from paperlab: passes are dirty-flagged. paperlab re-renders
// everything every frame because it drives an ImGui panel. Here a Pipeline is
// bound to one element and usually renders exactly once, so each pass carries a
// signature of the parameters it actually reads and is skipped when that
// signature has not changed. Moving the light re-runs 2 passes out of 12.

import { gl, ensureSize } from './gl/context.js';
import { Program, drawFullscreen } from './gl/program.js';
import { acquire, release } from './gl/fbo.js';
import { pxPerMm, seedOffsetMm, layerSeed } from './params.js';
import { kmConstants } from './km.js';
import {
  QUAD_VERT, HEIGHT_FRAG, BLUR_FRAG, CAVITY_FRAG, NORMAL_FRAG,
  SHADE_FRAG, ALBEDO_FRAG, MASK_FRAG, COMPOSITE_FRAG, PRESENT_FRAG,
} from './shaders/passes.js';

// --- shared programs --------------------------------------------------------
// Compiled once per page, not per element.

// Two compiled program sets. The legacy set exists only so the height and mask
// passes can use the unbranched float hash, whose codegen artifact is the panel
// texture; see the note in common.js. Compiled lazily, so a page that never asks
// for it never pays for it.
const P = { std: null, legacy: null };

function programs(legacy = false) {
  const key = legacy ? 'legacy' : 'std';
  if (P[key]) return P[key];
  P[key] = {
    height: new Program(QUAD_VERT, HEIGHT_FRAG(legacy), 'height'),
    blur: new Program(QUAD_VERT, BLUR_FRAG, 'blur'),
    cavity: new Program(QUAD_VERT, CAVITY_FRAG, 'cavity'),
    normal: new Program(QUAD_VERT, NORMAL_FRAG, 'normal'),
    shade: new Program(QUAD_VERT, SHADE_FRAG, 'shade'),
    albedo: new Program(QUAD_VERT, ALBEDO_FRAG(legacy), 'albedo'),
    mask: new Program(QUAD_VERT, MASK_FRAG(legacy), 'mask'),
    composite: new Program(QUAD_VERT, COMPOSITE_FRAG, 'composite'),
    present: new Program(QUAD_VERT, PRESENT_FRAG, 'present'),
  };
  return P[key];
}

/** Free the shared programs. Teardown and tests only. */
export function destroyPrograms() {
  for (const key of ['std', 'legacy']) {
    if (!P[key]) continue;
    for (const k in P[key]) P[key][k].destroy();
    P[key] = null;
  }
}

// --- a 1x1 white content texture --------------------------------------------
// content is "1 paper, 0 ink", so an all-white texture means "no ink anywhere",
// which is exactly what the `behind` mode wants: the composite reduces to the lit
// paper substrate and the real DOM text sits on top.

let _white = null;

export function whiteTexture() {
  if (_white) return _white;
  const g = gl();
  _white = g.createTexture();
  g.bindTexture(g.TEXTURE_2D, _white);
  g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, 1, 1, 0, g.RGBA, g.UNSIGNED_BYTE,
    new Uint8Array([255, 255, 255, 255]));
  g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR);
  g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
  g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
  g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
  return _white;
}

// --- signatures -------------------------------------------------------------
// A pass is dirty when the parameters it reads have changed. Stringifying the
// relevant slices is not the fastest imaginable scheme, but the whole tree is a
// few hundred bytes and this is correct by construction: adding a uniform to a
// pass without adding it to the signature is the bug this avoids, and the
// signature lists the same groups the pass's uniform block does.

const sig = (...parts) => JSON.stringify(parts);

function signatures(p, geom) {
  const g = [geom.fxW, geom.fxH, geom.canvasW, geom.canvasH, geom.pageRect, p.page.dpi, p.page.seed, p.page.legacy];
  const height = sig(g, p.cockle, p.folds, p.crumple);
  const cavity = sig(height, p.cavity.radius_mm);
  const normal = sig(height, p.light.relief_exaggerate);
  const shade = sig(normal, cavity, p.cavity.enabled, p.cavity.lambda, p.light);
  const albedo = sig(g, p.formation, p.fade, p.mould, p.scratches, p.imperfect);
  const mask = sig(g, p.edge);
  const shadow = sig(mask, p.shadow.blur_px, p.shadow.enabled);
  const composite = sig(shade, albedo, mask, shadow, cavity,
    p.tone, p.ink, p.shadow, geom.contentId);
  return { height, cavity, normal, shade, albedo, mask, shadow, composite };
}

// --- the pipeline -----------------------------------------------------------

export class Pipeline {
  constructor() {
    this.fx = null;          // { w, h } of the effect targets
    this.t = {};             // targets by name
    this.last = {};          // last signature per pass
    this.geom = null;
  }

  /** Allocate (or reuse) targets for this geometry. */
  _ensureTargets(fxW, fxH, canvasW, canvasH) {
    if (this.fx && this.fx.w === fxW && this.fx.h === fxH
      && this.fx.cw === canvasW && this.fx.ch === canvasH) return;
    this.releaseTargets();
    const t = this.t;
    for (const name of ['height', 'heightblur', 'blurtmp', 'cavity', 'shade',
      'albedo', 'shadowT', 'shadowW']) {
      t[name] = acquire(fxW, fxH, 'scalar');
    }
    t.normal = acquire(fxW, fxH, 'vec3');
    // The mask runs at FULL resolution, unlike every other field. paperlab keeps
    // it at half res because its sheet is 1275 px wide, so half res is still 637
    // px of silhouette. A 300 px card on a web page has only 150 px of half-res
    // silhouette, and the deckle fringe aliases into a hard comb against the page
    // background. The mask is also the crispest thing in the image: it is the
    // sheet's outline. It gets its own resolution.
    t.mask = acquire(canvasW, canvasH, 'scalar');
    t.composite = acquire(canvasW, canvasH, 'vec3');
    this.fx = { w: fxW, h: fxH, cw: canvasW, ch: canvasH };
    this.last = {};          // geometry changed: everything is dirty
  }

  /**
   * Hand every target back to the pool. A static surface calls this straight
   * after copying its pixels out, so a page of many paper elements holds one
   * element's worth of VRAM rather than N.
   */
  releaseTargets() {
    for (const k in this.t) release(this.t[k]);
    this.t = {};
    this.fx = null;
    this.last = {};
  }

  /**
   * Run the graph.
   *
   * @param {object} p         resolved parameter tree
   * @param {object} geom      { canvasW, canvasH, pageRect: [x0,y0,x1,y1], contentId }
   * @param {WebGLTexture} contentTex   "1 paper, 0 ink"
   * @param {boolean} contentHasAlpha   true for a rasterised DOM snapshot
   * @returns {{w:number,h:number}} the composite's dimensions
   */
  render(p, geom, contentTex, contentHasAlpha = false) {
    const g = gl();
    const canvasW = Math.max(1, Math.round(geom.canvasW));
    const canvasH = Math.max(1, Math.round(geom.canvasH));
    const fxW = Math.max(8, canvasW >> 1);
    const fxH = Math.max(8, canvasH >> 1);
    this._ensureTargets(fxW, fxH, canvasW, canvasH);

    const t = this.t;
    const s = signatures(p, { ...geom, fxW, fxH, canvasW, canvasH });
    const dirty = (k) => this.last[k] !== s[k];

    const pxmm = pxPerMm(p);
    const seed = p.page.legacy === 1 ? 0 : (p.page.seed || 0);
    // Per-PASS hash choice, which is the whole trick.
    //
    // The crease network that reads as crumpled paper comes from the cockle
    // height field: paperlab's float hash quantises on real GPU hardware into
    // flat facets, and facet boundaries are creases. (Measured on an RTX 4070;
    // SwiftShader does not do it, which is why every earlier measurement here
    // missed it entirely.)
    //
    // The tiling that had to go came from the same hash in the ALBEDO pass: at
    // the 2.5 mm formation grain its 50 x 20 cell period is 472 x 189 px, which
    // repeats several times across a hero.
    //
    // Cockle's grain is 15.4 mm, so its period is 20 x 15.4 = 308 mm = 1164 px
    // vertically and over 6000 px horizontally after the anisotropic stretch.
    // Nothing on a page is that big. So the height pass can keep the float hash
    // and its facets while the albedo pass takes the aperiodic one, and both
    // problems are solved at once.
    //
    // page.legacy overrides this for A/B: 1 = float hash everywhere (original),
    // 0 = uniform everywhere, 2 = the split above.
    const mode = p.page.legacy;
    // mode 1 = legacy everywhere, 2 = legacy relief + aperiodic albedo, 0 = none
    const pr = programs(mode === 1 || mode === 2);   // relief + mask
    const prA = programs(mode === 1);                // albedo
    const heightHash = { i: mode === 1 ? 1 : mode === 2 ? 1 : 0 };
    const albedoHash = { i: mode === 1 ? 1 : 0 };
    const legacy = heightHash;
    // How far to slide into the noise field per surface. Small on the height
    // pass: the float hash's facet character is a precision effect, so pushing
    // the coordinates out to hundreds of millimetres changes the regime and the
    // facets dissolve. The albedo pass has no such constraint and takes the full
    // range, which it needs because its grain is 6x finer.
    const seedMm = seedOffsetMm(seed, 400);
    const seedMmHeight = seedOffsetMm(seed, p.page.legacy === 0 ? 400 : 24);
    // effect scale: the fields run at half res, so px/mm is halved there too.
    const fxs = fxW / canvasW;
    const pxmmFx = pxmm * fxs;
    const FX = [fxW, fxH];

    g.disable(g.BLEND);
    g.disable(g.DEPTH_TEST);

    // --- height (um) ---
    if (dirty('height')) {
      t.height.bind();
      pr.height.use().set({
        u_res: FX,
        u_px_per_mm: pxmmFx,
        u_seed_mm: seedMmHeight,
        u_legacy_noise: heightHash,
        u_cockle_on: { i: p.cockle.enabled ? 1 : 0 },
        u_cockle_wavelength_mm: p.cockle.wavelength_mm,
        u_cockle_amp_um: p.cockle.amplitude_um,
        u_cockle_aniso: p.cockle.anisotropy,
        u_cockle_md_deg: p.cockle.md_angle_deg,
        u_cockle_irregularity: p.cockle.irregularity,
        u_cockle_facet: p.cockle.facet,
        u_cockle_facet_scale: p.cockle.facet_scale_mm,
        u_folds_on: { i: p.folds.enabled ? 1 : 0 },
        u_fold_count: p.folds.count,
        u_fold_depth: p.folds.depth,
        u_fold_sharpness: p.folds.sharpness,
        u_fold_seed: layerSeed(p.folds.seed, seed),
        u_crumple_on: { i: p.crumple.enabled ? 1 : 0 },
        u_crumple_scale_mm: p.crumple.scale_mm,
        u_crumple_amp_um: p.crumple.amplitude_um,
        u_crumple_crease: p.crumple.crease,
        u_crumple_irregularity: p.crumple.irregularity,
        u_crumple_seed: layerSeed(p.crumple.seed, seed),
      });
      drawFullscreen();
    }

    // separable blur helper: src -> blurtmp (x) -> dst (y)
    const blurInto = (dst, srcTex, radius) => {
      t.blurtmp.bind();
      pr.blur.use().tex('u_src', srcTex).set({ u_res: FX, u_dir: [1, 0], u_radius: radius });
      drawFullscreen();
      dst.bind();
      pr.blur.use().tex('u_src', t.blurtmp.tex).set({ u_res: FX, u_dir: [0, 1], u_radius: radius });
      drawFullscreen();
    };

    // --- cavity: blur(height) - height ---
    if (dirty('cavity')) {
      blurInto(t.heightblur, t.height.tex, Math.max(p.cavity.radius_mm * pxmmFx, 1.0));
      t.cavity.bind();
      pr.cavity.use().tex('u_height', t.height.tex).tex('u_heightblur', t.heightblur.tex);
      drawFullscreen();
    }

    // --- normal ---
    if (dirty('normal')) {
      t.normal.bind();
      pr.normal.use().tex('u_height', t.height.tex).set({
        u_res: FX, u_px_per_mm: pxmmFx, u_exaggerate: p.light.relief_exaggerate,
      });
      drawFullscreen();
    }

    // --- shade ---
    if (dirty('shade')) {
      t.shade.bind();
      pr.shade.use().tex('u_normal', t.normal.tex).tex('u_cavity', t.cavity.tex).set({
        u_cavity_on: { i: p.cavity.enabled ? 1 : 0 },
        u_cavity_lambda: p.cavity.lambda,
        u_light_az_deg: p.light.azimuth_deg,
        u_light_alt_deg: p.light.altitude_deg,
        u_diffuse_gain: p.light.diffuse_gain,
        u_spec_on: { i: p.light.specular ? 1 : 0 },
        u_spec_intensity: p.light.spec_intensity,
        u_spec_power: p.light.spec_power,
        u_highlight_ceiling: p.light.highlight_ceiling,
      });
      drawFullscreen();
    }

    // --- albedo ---
    if (dirty('albedo')) {
      t.albedo.bind();
      prA.albedo.use().tex('u_form_tile', p._formTile || whiteTexture()).set({
        u_res: FX,
        u_px_per_mm: pxmmFx,
        u_seed_mm: seedMm,
        u_legacy_noise: albedoHash,
        u_form_on: { i: p.formation.enabled ? 1 : 0 },
        u_form_scale_mm: p.formation.scale_mm,
        u_form_amp: p.formation.amplitude,
        u_form_gsm: p.formation.gsm_amount,
        u_form_skew: p.formation.skew,
        u_form_source: { i: p.formation.source | 0 },
        u_form_bandwidth: p.formation.bandwidth,
        u_form_tile_mm: p.formation.tile_mm,
        u_fade_on: { i: p.fade.enabled ? 1 : 0 },
        u_fade_scale_mm: p.fade.scale_mm,
        u_fade_amount: p.fade.amount,
        u_mould_on: { i: p.mould.enabled ? 1 : 0 },
        u_laid_pitch_mm: p.mould.laid_pitch_mm,
        u_chain_pitch_mm: p.mould.chain_pitch_mm,
        u_mould_angle_deg: p.mould.angle_deg,
        u_mould_amount: p.mould.amount,
        u_chain_ratio: p.mould.chain_ratio,
        u_mould_wander: p.mould.wander,
        u_scr_on: { i: p.scratches.enabled ? 1 : 0 },
        u_scr_density: p.scratches.density,
        u_scr_lightness: p.scratches.lightness,
        u_scr_scale_mm: p.scratches.scale_mm,
        u_scr_dark_frac: p.scratches.dark_frac,
        u_scr_seed: layerSeed(p.scratches.seed, seed),
        u_imp_on: { i: p.imperfect.enabled ? 1 : 0 },
        u_pit_density: p.imperfect.pit_density,
        u_pit_depth: p.imperfect.pit_depth,
        u_pit_scale_mm: p.imperfect.pit_scale_mm,
        u_mark_density: p.imperfect.mark_density,
        u_mark_strength: p.imperfect.mark_strength,
        u_mark_scale_mm: p.imperfect.mark_scale_mm,
        u_imp_seed: layerSeed(p.imperfect.seed, seed),
      });
      drawFullscreen();
    }

    const [px0, py0, px1, py1] = geom.pageRect;

    // --- mask (sheet silhouette), at full resolution ---
    // Every edge quantity is in real canvas px here, with no fxs scaling, so
    // `wobble_px` and `deckle_px` mean the number of device pixels they say.
    if (dirty('mask')) {
      t.mask.bind();
      pr.mask.use().set({
        u_res: [canvasW, canvasH],
        u_page_rect: [px0, py0, px1, py1],
        u_px_per_mm: pxmm,
        u_seed_mm: seedMm,
        u_legacy_noise: heightHash,
        u_wobble_px: p.edge.enabled ? p.edge.wobble_px : 0,
        u_curl: p.edge.enabled ? p.edge.curl : 0,
        u_deckle_px: p.edge.enabled ? p.edge.deckle_px : 0,
        u_radius_px: p.edge.radius_px,
      });
      drawFullscreen();
    }

    // --- shadow: the mask blurred at two radii ---
    // The source is the full-res mask and the destinations are half-res. The
    // blur's first tap step is sized in DESTINATION texels, so this downsamples
    // and blurs in one pass, which is exactly right for something that is about
    // to be blurred anyway.
    if (dirty('shadow')) {
      if (p.shadow.enabled) {
        blurInto(t.shadowT, t.mask.tex, Math.max(p.shadow.blur_px * fxs * 0.25, 1.0));
        blurInto(t.shadowW, t.mask.tex, Math.max(p.shadow.blur_px * fxs, 1.0));
      } else {
        // Clear rather than skip: a stale shadow from a previous parameter set
        // would otherwise linger under the sheet.
        for (const dst of [t.shadowT, t.shadowW]) {
          dst.bind();
          g.clearColor(0, 0, 0, 0);
          g.clear(g.COLOR_BUFFER_BIT);
        }
      }
    }

    // --- composite ---
    if (dirty('composite')) {
      const km = kmConstants(p.ink.ink_over_white, p.ink.ink_over_black);
      const az = (p.light.azimuth_deg * Math.PI) / 180;
      // The shadow falls opposite the light, and canvas y points down.
      const sdirX = -Math.cos(az) / canvasW;
      const sdirY = Math.sin(az) / canvasH;

      t.composite.bind();
      pr.composite.use()
        .tex('u_content', contentTex)
        .tex('u_shade', t.shade.tex)
        .tex('u_albedo', t.albedo.tex)
        .tex('u_mask', t.mask.tex)
        .tex('u_shadow_t', t.shadowT.tex)
        .tex('u_shadow_w', t.shadowW.tex)
        .tex('u_cavity', t.cavity.tex)
        .set({
          u_res: [canvasW, canvasH],
          u_page_rect: [px0, py0, px1, py1],
          u_tone: p.tone.paper,
          u_ink: p.ink.color,
          u_gate_lo: p.ink.gate_lo,
          u_gate_hi: p.ink.gate_hi,
          u_ink_km: { i: p.ink.kubelka_munk ? 1 : 0 },
          u_km_a: km.a,
          u_km_b: km.b,
          u_km_S: km.S,
          u_ink_thickness: p.ink.thickness,
          u_ink_gran: p.cavity.enabled ? p.ink.granulation : 0,
          u_ink_coverage: p.ink.coverage,
          u_hi_tint: p.tone.highlight,
          u_lo_tint: p.tone.shadow,
          u_duotone: p.tone.duotone,
          u_shadow_dir: [sdirX, sdirY],
          u_shadow_offset: p.shadow.enabled ? p.shadow.offset_px : 0,
          u_shadow_darkness: p.shadow.enabled ? p.shadow.darkness : 0,
          u_shadow_contact: p.shadow.contact,
          u_content_alpha: { i: contentHasAlpha ? 1 : 0 },
          u_opacity: p.tone.opacity,
        });
      drawFullscreen();
    }

    this.last = s;
    g.bindFramebuffer(g.FRAMEBUFFER, null);
    return { w: canvasW, h: canvasH };
  }

  /**
   * Blit a target to the shared canvas's default framebuffer so it can be copied
   * out with drawImage. `name` is 'Final' or any intermediate buffer name.
   */
  present(name = 'Final', { falseColor = true } = {}) {
    const g = gl();
    const pr = programs();
    const map = {
      Final: [this.t.composite, 0, 0.5, 1],
      Height: [this.t.height, 1, 0, 60],       // um
      Normal: [this.t.normal, 2, 0, 1],
      Cavity: [this.t.cavity, 1, 0, 1],
      Shade: [this.t.shade, 1, 1, 0.6],
      Albedo: [this.t.albedo, 1, 1, 0.2],
      Shadow: [this.t.shadowW, 1, 0.5, 1],
      Alpha: [this.t.mask, 1, 0.5, 1],
    };
    const entry = map[name];
    if (!entry || !entry[0]) throw new Error(`paperweb: no such buffer "${name}"`);
    const [target, mode, center, span] = entry;

    const w = this.fx.cw, h = this.fx.ch;
    ensureSize(w, h);
    g.bindFramebuffer(g.FRAMEBUFFER, null);
    g.viewport(0, 0, w, h);
    g.disable(g.BLEND);
    // Transparent clear: the composite writes its own alpha so the void stays
    // see-through and the page behind shows through the margin.
    g.clearColor(0, 0, 0, 0);
    g.clear(g.COLOR_BUFFER_BIT);
    pr.present.use().tex('u_buf', target.tex).set({
      u_mode: { i: mode },
      u_center: center,
      u_span: span,
      u_false_color: { i: mode === 1 && falseColor ? 1 : 0 },
    });
    drawFullscreen();
    return { w, h };
  }

  /**
   * Blit the composite straight to the default framebuffer, preserving alpha.
   * `present('Final')` runs it through the inspector shader, which drops alpha;
   * this is the path the visible surface actually uses.
   */
  presentComposite() {
    const g = gl();
    const w = this.fx.cw, h = this.fx.ch;
    ensureSize(w, h);
    g.bindFramebuffer(g.READ_FRAMEBUFFER, this.t.composite.fbo);
    g.bindFramebuffer(g.DRAW_FRAMEBUFFER, null);
    g.viewport(0, 0, w, h);
    g.clearColor(0, 0, 0, 0);
    g.clear(g.COLOR_BUFFER_BIT);
    g.blitFramebuffer(0, 0, w, h, 0, 0, w, h, g.COLOR_BUFFER_BIT, g.NEAREST);
    g.bindFramebuffer(g.READ_FRAMEBUFFER, null);
    g.bindFramebuffer(g.DRAW_FRAMEBUFFER, null);
    return { w, h };
  }

  /**
   * Read a target back as raw floats. Used by the tests to assert invariants on
   * the intermediate buffers, which is the only way to check the port did the
   * right arithmetic rather than merely produced something plausible.
   */
  readFloats(name) {
    const g = gl();
    const map = {
      Height: this.t.height, Cavity: this.t.cavity, Shade: this.t.shade,
      Albedo: this.t.albedo, Alpha: this.t.mask, Shadow: this.t.shadowW,
      Normal: this.t.normal, Final: this.t.composite,
    };
    const target = map[name];
    if (!target) throw new Error(`paperweb: no such buffer "${name}"`);
    g.bindFramebuffer(g.FRAMEBUFFER, target.fbo);
    // WebGL2 guarantees exactly one format/type combination per framebuffer for
    // readPixels beyond RGBA/UNSIGNED_BYTE, and it is not always RGBA/FLOAT: an
    // R32F attachment commonly reports RED/FLOAT. Asking the implementation is
    // the only portable way to get this right.
    const fmt = g.getParameter(g.IMPLEMENTATION_COLOR_READ_FORMAT);
    const type = g.getParameter(g.IMPLEMENTATION_COLOR_READ_TYPE);
    const channels = fmt === g.RED ? 1 : fmt === g.RG ? 2 : fmt === g.RGB ? 3 : 4;
    const px = target.w * target.h;
    let out;
    if (type === g.FLOAT) {
      out = new Float32Array(px * channels);
      g.readPixels(0, 0, target.w, target.h, fmt, type, out);
    } else if (type === g.HALF_FLOAT) {
      const raw = new Uint16Array(px * channels);
      g.readPixels(0, 0, target.w, target.h, fmt, type, raw);
      out = new Float32Array(raw.length);
      for (let i = 0; i < raw.length; i++) out[i] = halfToFloat(raw[i]);
    } else {
      throw new Error(`paperweb: unsupported readback type 0x${type.toString(16)}`);
    }
    g.bindFramebuffer(g.FRAMEBUFFER, null);
    return { data: out, w: target.w, h: target.h, channels };
  }

  destroy() {
    this.releaseTargets();
  }
}

/** IEEE 754 binary16 -> JS number, for the half-float readback path. */
function halfToFloat(h) {
  const s = (h & 0x8000) >> 15;
  const e = (h & 0x7c00) >> 10;
  const f = h & 0x03ff;
  if (e === 0) return (s ? -1 : 1) * Math.pow(2, -14) * (f / 1024);
  if (e === 0x1f) return f ? NaN : (s ? -Infinity : Infinity);
  return (s ? -1 : 1) * Math.pow(2, e - 15) * (1 + f / 1024);
}
