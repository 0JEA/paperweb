// Shader compilation with a uniform-location cache.
//
// Uniform lookups by name are the obvious way to write this and also the obvious
// way to make it slow: gl.getUniformLocation is a string lookup into the driver.
// Every program caches its locations on first use, so the per-frame cost of the
// pointer-tracking light mode stays in the noise.

import { gl } from './context.js';

function compile(g, type, src, label) {
  const sh = g.createShader(type);
  g.shaderSource(sh, src);
  g.compileShader(sh);
  if (!g.getShaderParameter(sh, g.COMPILE_STATUS)) {
    const log = g.getShaderInfoLog(sh) || '';
    g.deleteShader(sh);
    // Numbered source makes a driver's "ERROR: 0:57" actually actionable.
    const numbered = src.split('\n').map((l, i) => `${String(i + 1).padStart(4)}| ${l}`).join('\n');
    throw new Error(`paperweb: ${label} failed to compile\n${log}\n${numbered}`);
  }
  return sh;
}

export class Program {
  /**
   * @param {string} vsSrc
   * @param {string} fsSrc
   * @param {string} label  used in error messages
   */
  constructor(vsSrc, fsSrc, label = 'shader') {
    const g = gl();
    this.gl = g;
    this.label = label;
    const vs = compile(g, g.VERTEX_SHADER, vsSrc, `${label} (vertex)`);
    const fs = compile(g, g.FRAGMENT_SHADER, fsSrc, `${label} (fragment)`);
    const p = g.createProgram();
    g.attachShader(p, vs);
    g.attachShader(p, fs);
    g.linkProgram(p);
    g.deleteShader(vs);
    g.deleteShader(fs);
    if (!g.getProgramParameter(p, g.LINK_STATUS)) {
      const log = g.getProgramInfoLog(p) || '';
      g.deleteProgram(p);
      throw new Error(`paperweb: ${label} failed to link\n${log}`);
    }
    this.prog = p;
    /** @type {Map<string, WebGLUniformLocation|null>} */
    this.locs = new Map();
    this.unit = 0;
  }

  use() {
    this.gl.useProgram(this.prog);
    this.unit = 0;
    return this;
  }

  loc(name) {
    if (!this.locs.has(name)) {
      this.locs.set(name, this.gl.getUniformLocation(this.prog, name));
    }
    return this.locs.get(name);
  }

  /**
   * Set uniforms from a plain object. Type is inferred from the value:
   * number -> float, boolean/int-flagged -> int, array of 2/3/4 -> vecN.
   * Values of `undefined` are skipped so callers can pass sparse objects.
   *
   * Integers must be passed as `{ i: n }` because JS cannot distinguish 1 from
   * 1.0, and glUniform1f into an `int` uniform is a silent no-op on some drivers.
   */
  set(uniforms) {
    const g = this.gl;
    for (const name in uniforms) {
      const v = uniforms[name];
      if (v === undefined) continue;
      const l = this.loc(name);
      if (l === null) continue;         // optimised out; not an error
      if (typeof v === 'number') g.uniform1f(l, v);
      else if (typeof v === 'boolean') g.uniform1i(l, v ? 1 : 0);
      else if (v && typeof v === 'object' && 'i' in v) g.uniform1i(l, v.i | 0);
      else if (v.length === 2) g.uniform2f(l, v[0], v[1]);
      else if (v.length === 3) g.uniform3f(l, v[0], v[1], v[2]);
      else if (v.length === 4) g.uniform4f(l, v[0], v[1], v[2], v[3]);
      else throw new Error(`paperweb: cannot set uniform ${name} from ${JSON.stringify(v)}`);
    }
    return this;
  }

  /** Bind a texture to the next free unit and point `name` at it. */
  tex(name, texture) {
    const g = this.gl;
    const l = this.loc(name);
    if (l === null) return this;
    const u = this.unit++;
    g.activeTexture(g.TEXTURE0 + u);
    g.bindTexture(g.TEXTURE_2D, texture);
    g.uniform1i(l, u);
    return this;
  }

  destroy() {
    this.gl.deleteProgram(this.prog);
    this.locs.clear();
  }
}

// --- attributeless full-screen triangle -------------------------------------
// The vertex shader derives its positions from gl_VertexID, so there is no vertex
// buffer at all; WebGL2 still requires *some* VAO to be bound.
let _vao = null;

export function fullscreenVao() {
  const g = gl();
  if (!_vao) _vao = g.createVertexArray();
  return _vao;
}

export function drawFullscreen() {
  const g = gl();
  g.bindVertexArray(fullscreenVao());
  g.drawArrays(g.TRIANGLES, 0, 3);
}
