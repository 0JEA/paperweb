// One WebGL2 context for the whole page.
//
// Browsers cap live WebGL contexts at roughly 16, so a context per paper element
// does not scale. Every Paper instance renders through this single shared context
// and then copies the finished pixels out to its own cheap 2D canvas. Instances
// hold pixels, not GPU contexts.

let _gl = null;
let _canvas = null;
let _caps = null;
let _probed = false;

/**
 * Capabilities of the shared context.
 * @typedef {object} Caps
 * @property {boolean} ok            WebGL2 available at all
 * @property {boolean} floatRender   can render to 32-bit float targets
 * @property {boolean} halfRender    can render to 16-bit float targets
 * @property {boolean} floatLinear   can LINEAR-filter 32-bit float textures
 * @property {boolean} halfLinear    can LINEAR-filter 16-bit float textures
 * @property {string}  reason        why it is unusable, when ok === false
 */

/**
 * Probe once and cache. Never throws: a machine without WebGL2 gets
 * `{ ok: false, reason }` and the library degrades to a flat background.
 * @returns {Caps}
 */
export function capabilities() {
  if (_probed) return _caps;
  _probed = true;
  _caps = { ok: false, floatRender: false, halfRender: false, floatLinear: false, halfLinear: false, reason: '' };

  if (typeof document === 'undefined') {
    _caps.reason = 'no document (server-side render)';
    return _caps;
  }
  let gl;
  try {
    const c = document.createElement('canvas');
    gl = c.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      // The composite is copied out with drawImage immediately after rendering.
      // Preserving the drawing buffer removes any dependence on when the browser
      // decides to composite, which is otherwise a real source of blank frames.
      preserveDrawingBuffer: true,
      powerPreference: 'low-power',
    });
    if (!gl) {
      _caps.reason = 'webgl2 context creation returned null';
      return _caps;
    }
    _canvas = c;
    _gl = gl;
  } catch (e) {
    _caps.reason = `webgl2 context creation threw: ${e && e.message}`;
    return _caps;
  }

  // Render-target formats. EXT_color_buffer_float in WebGL2 enables both 32F and
  // 16F colour attachments; the half-float extension is the narrower fallback.
  const cbf = gl.getExtension('EXT_color_buffer_float');
  const cbhf = gl.getExtension('EXT_color_buffer_half_float');
  _caps.floatRender = !!cbf;
  _caps.halfRender = !!(cbf || cbhf);

  // Filtering is a separate capability from rendering. The blur passes sample
  // with LINEAR; without it they must fall back to NEAREST, which is visibly
  // steppy on the shadow, so the pipeline picks the widest filterable format.
  _caps.floatLinear = !!gl.getExtension('OES_texture_float_linear');
  _caps.halfLinear = !!gl.getExtension('OES_texture_half_float_linear') || true; // core in WebGL2

  if (!_caps.halfRender) {
    _caps.reason = 'no float or half-float colour-buffer extension';
    _gl = null;
    _canvas = null;
    return _caps;
  }

  _caps.ok = true;
  return _caps;
}

/** @returns {WebGL2RenderingContext|null} */
export function gl() {
  capabilities();
  return _gl;
}

/** The offscreen canvas the shared context draws into. */
export function sharedCanvas() {
  capabilities();
  return _canvas;
}

/**
 * Size the shared drawing buffer to exactly w x h.
 *
 * A grow-only buffer would save the odd reallocation, but WebGL's drawing buffer
 * has its origin at the BOTTOM-left, so an oversized buffer leaves the rendered
 * region sitting at the bottom and every copy-out has to offset by
 * (height - h). Sizing exactly costs one reallocation per element per render,
 * which for surfaces that render once is nothing, and it removes that whole
 * class of off-by-a-buffer bug.
 */
export function ensureSize(w, h) {
  const c = sharedCanvas();
  if (!c) return;
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  }
}

/** Test seam: forget the cached probe so a test can re-run it. */
export function _resetForTests() {
  _gl = null;
  _canvas = null;
  _caps = null;
  _probed = false;
}
