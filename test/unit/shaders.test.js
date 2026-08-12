// Guards on the shader sources themselves.
//
// The shaders are JS template literals, so a stray backtick inside a GLSL
// comment silently ends the string and the whole module stops parsing. That has
// happened three times while writing prose about parameter names. These tests
// catch it at `npm test` instead of at the next render.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as passes from '../../src/shaders/passes.js';
import { COMMON, FRAG_HEADER, frag } from '../../src/shaders/common.js';

const BUILDERS = ['HEIGHT_FRAG', 'ALBEDO_FRAG', 'MASK_FRAG'];
const STATICS = ['QUAD_VERT', 'BLUR_FRAG', 'CAVITY_FRAG', 'NORMAL_FRAG',
  'SHADE_FRAG', 'COMPOSITE_FRAG', 'PRESENT_FRAG'];

function sources() {
  const out = {};
  for (const k of STATICS) out[k] = passes[k];
  for (const k of BUILDERS) { out[`${k}(std)`] = passes[k](false); out[`${k}(legacy)`] = passes[k](true); }
  return out;
}

test('every shader source is a complete, non-empty string', () => {
  for (const [name, src] of Object.entries(sources())) {
    assert.equal(typeof src, 'string', `${name} is not a string`);
    assert.ok(src.length > 200, `${name} is suspiciously short (${src.length} chars)`);
    assert.match(src, /void main\(\)/, `${name} has no main()`);
    assert.match(src, /^#version 300 es/, `${name} does not start with the ES 3.00 directive`);
  }
});

test('no shader source contains a backtick', () => {
  // A backtick cannot appear in valid GLSL, so if one reaches a source string
  // the template was assembled wrong.
  for (const [name, src] of Object.entries(sources())) {
    assert.ok(!src.includes('`'), `${name} contains a backtick`);
  }
});

test('braces and parens balance in every shader', () => {
  // A truncated template usually shows up as unbalanced delimiters long before
  // a driver would report a compile error.
  for (const [name, src] of Object.entries(sources())) {
    const strip = src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const [open, close] of [['{', '}'], ['(', ')']]) {
      const o = (strip.match(new RegExp(`\\${open}`, 'g')) || []).length;
      const c = (strip.match(new RegExp(`\\${close}`, 'g')) || []).length;
      assert.equal(o, c, `${name} has ${o} '${open}' and ${c} '${close}'`);
    }
  }
});

test('the legacy variant differs from the standard one only by the hash', () => {
  for (const k of BUILDERS) {
    const std = passes[k](false), leg = passes[k](true);
    assert.notEqual(std, leg, `${k} legacy and standard are identical`);
    assert.ok(leg.includes('#define LEGACY_HASH'), `${k} legacy lacks the define`);
    assert.ok(!std.includes('#define LEGACY_HASH'), `${k} standard has the define`);
  }
});

test('every uniform a pass declares is spelled consistently', () => {
  // Catches a rename that touched the declaration but not the use, which the
  // GL compiler would silently optimise away rather than report.
  for (const [name, src] of Object.entries(sources())) {
    const declared = [...src.matchAll(/uniform\s+\w+\s+(\w+)\s*;/g)].map((m) => m[1]);
    for (const u of declared) {
      const uses = (src.match(new RegExp(`\\b${u}\\b`, 'g')) || []).length;
      assert.ok(uses >= 2, `${name} declares ${u} but never reads it`);
    }
  }
});

test('the common prelude is included exactly once where requested', () => {
  const withCommon = frag('void main() { }', { common: true });
  assert.ok(withCommon.includes('pcgHash'), 'common prelude missing');
  assert.equal(withCommon.indexOf(COMMON), withCommon.lastIndexOf(COMMON), 'prelude included twice');
  assert.ok(frag('void main() { }').startsWith(FRAG_HEADER), 'header missing');
  assert.ok(!frag('void main() { }').includes('pcgHash'), 'prelude included when not asked for');
});
