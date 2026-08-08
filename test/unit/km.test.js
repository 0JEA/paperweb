// Kubelka-Munk constants.
//
// These are checked against values computed independently from the published
// formulae rather than against whatever the implementation happens to return,
// which is the only version of this test that can fail for a real reason.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kmConstants } from '../../src/km.js';
import { defaults } from '../../src/params.js';

/** The reference derivation, written out longhand from Curtis et al. 1997 S5. */
function reference(Rw, Rb) {
  const a = 0.5 * (Rw + (Rb - Rw + 1) / Rb);
  const b = Math.sqrt(a * a - 1);
  const z = (b * b - (a - Rw) * (a - 1)) / (b * (1 - Rw));
  const S = (1 / b) * Math.atanh(1 / z);      // arccoth(z) === atanh(1/z)
  return { a, b, S };
}

test('matches an independent derivation for the default ink', () => {
  const p = defaults();
  const got = kmConstants(p.ink.ink_over_white, p.ink.ink_over_black);
  for (let i = 0; i < 3; i++) {
    const want = reference(p.ink.ink_over_white[i], p.ink.ink_over_black[i]);
    assert.ok(Math.abs(got.a[i] - want.a) < 1e-9, `a[${i}] ${got.a[i]} vs ${want.a}`);
    assert.ok(Math.abs(got.b[i] - want.b) < 1e-9, `b[${i}] ${got.b[i]} vs ${want.b}`);
    assert.ok(Math.abs(got.S[i] - want.S) < 1e-9, `S[${i}] ${got.S[i]} vs ${want.S}`);
  }
});

test('arccoth is real: a is always > 1 so b is real and positive', () => {
  // Sweep the whole legal domain (0 < Rb < Rw < 1) rather than one sample.
  for (let Rw = 0.02; Rw < 1; Rw += 0.07) {
    for (let Rb = 0.01; Rb < Rw; Rb += 0.05) {
      const { a, b, S } = kmConstants([Rw, Rw, Rw], [Rb, Rb, Rb]);
      assert.ok(a[0] > 1, `a should exceed 1 for Rw=${Rw} Rb=${Rb}, got ${a[0]}`);
      assert.ok(b[0] > 0 && Number.isFinite(b[0]), `b bad for Rw=${Rw} Rb=${Rb}: ${b[0]}`);
      assert.ok(Number.isFinite(S[0]) && S[0] > 0, `S bad for Rw=${Rw} Rb=${Rb}: ${S[0]}`);
    }
  }
});

test('degenerate inks are clamped instead of producing NaN', () => {
  // Rb === Rw violates the model's Rb < Rw premise. The clamp must keep the
  // result finite: a NaN here propagates through the composite and paints the
  // entire sheet black, which is a far worse failure than a slightly wrong ink.
  for (const [Rw, Rb] of [[0.5, 0.5], [0.5, 0.9], [0, 0], [1, 1], [1e-9, 1e-9]]) {
    const { a, b, S } = kmConstants([Rw, Rw, Rw], [Rb, Rb, Rb]);
    for (const v of [a[0], b[0], S[0]]) {
      assert.ok(Number.isFinite(v), `Rw=${Rw} Rb=${Rb} produced ${v}`);
    }
  }
});

test('a thicker-absorbing ink (lower Rw) yields a larger scattering coefficient path', () => {
  // Monotonicity sanity: as the ink gets darker over white, the derived layer
  // must absorb more, which shows up as a larger a = 1 + K/S.
  const dark = kmConstants([0.02, 0.02, 0.02], [0.01, 0.01, 0.01]);
  const light = kmConstants([0.60, 0.60, 0.60], [0.30, 0.30, 0.30]);
  assert.ok(dark.a[0] > light.a[0], `${dark.a[0]} should exceed ${light.a[0]}`);
});
