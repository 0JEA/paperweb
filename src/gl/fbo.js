// Float render targets, with a format ladder and a size-keyed pool.
//
// paperlab allocates one FBO per pass for the life of the app. On a page with
// many paper elements of different sizes that would be a lot of dead VRAM, so
// targets are pooled by (format, w, h) and handed back after each render.

import { gl, capabilities } from './context.js';

/**
 * Pick the best available internal format for a scalar or vector target.
 * @param {'scalar'|'vec3'} kind
 */
export function pickFormat(kind) {
  const g = gl();
  const caps = capabilities();
  if (kind === 'scalar') {
    if (caps.floatRender) return { internal: g.R32F, format: g.RED, type: g.FLOAT, linear: caps.floatLinear };
    return { internal: g.R16F, format: g.RED, type: g.HALF_FLOAT, linear: true };
  }
  // Normals only need half precision; they are unit vectors.
  return { internal: g.RGBA16F, format: g.RGBA, type: g.HALF_FLOAT, linear: true };
}

export class Fbo {
  constructor(w, h, kind = 'scalar') {
    const g = gl();
    this.gl = g;
    this.w = w;
    this.h = h;
    this.kind = kind;
    const f = pickFormat(kind);
    this.fmt = f;

    this.tex = g.createTexture();
    g.bindTexture(g.TEXTURE_2D, this.tex);
    g.texImage2D(g.TEXTURE_2D, 0, f.internal, w, h, 0, f.format, f.type, null);
    const filter = f.linear ? g.LINEAR : g.NEAREST;
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, filter);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, filter);
    // CLAMP_TO_EDGE matters: the blur and the shadow offset both sample outside
    // the buffer, and REPEAT would wrap the shadow around to the opposite edge.
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);

    this.fbo = g.createFramebuffer();
    g.bindFramebuffer(g.FRAMEBUFFER, this.fbo);
    g.framebufferTexture2D(g.FRAMEBUFFER, g.COLOR_ATTACHMENT0, g.TEXTURE_2D, this.tex, 0);
    const status = g.checkFramebufferStatus(g.FRAMEBUFFER);
    g.bindFramebuffer(g.FRAMEBUFFER, null);
    if (status !== g.FRAMEBUFFER_COMPLETE) {
      this.destroy();
      throw new Error(`paperweb: framebuffer incomplete (0x${status.toString(16)}) for ${kind} ${w}x${h}`);
    }
  }

  bind() {
    const g = this.gl;
    g.bindFramebuffer(g.FRAMEBUFFER, this.fbo);
    g.viewport(0, 0, this.w, this.h);
    return this;
  }

  destroy() {
    const g = this.gl;
    if (this.fbo) g.deleteFramebuffer(this.fbo);
    if (this.tex) g.deleteTexture(this.tex);
    this.fbo = null;
    this.tex = null;
  }
}

// --- pool -------------------------------------------------------------------

/** @type {Map<string, Fbo[]>} */
const free = new Map();
const key = (kind, w, h) => `${kind}:${w}x${h}`;

export function acquire(w, h, kind = 'scalar') {
  const k = key(kind, w, h);
  const bucket = free.get(k);
  if (bucket && bucket.length) return bucket.pop();
  return new Fbo(w, h, kind);
}

export function release(f) {
  if (!f) return;
  const k = key(f.kind, f.w, f.h);
  let bucket = free.get(k);
  if (!bucket) free.set(k, (bucket = []));
  // Cap the pool so a page that resizes through many sizes does not hoard VRAM.
  if (bucket.length >= 4) { f.destroy(); return; }
  bucket.push(f);
}

/** Drop every pooled target. Used on teardown and by tests. */
export function drainPool() {
  for (const bucket of free.values()) for (const f of bucket) f.destroy();
  free.clear();
}

/** Number of pooled (idle) targets. Test seam. */
export function poolSize() {
  let n = 0;
  for (const bucket of free.values()) n += bucket.length;
  return n;
}
