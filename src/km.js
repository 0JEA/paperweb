// Kubelka-Munk ink constants, ported from paperlab src/app.cpp:370-381.
//
// Curtis et al. 1997 (Computer-Generated Watercolor, S5) derives a pigment
// layer's scattering and absorption from two measurable appearances: the colour
// it shows over a white ground (Rw) and over a black ground (Rb). Given those,
//
//     a = 0.5 * (Rw + (Rb - Rw + 1) / Rb)
//     b = sqrt(a^2 - 1)
//     S = (1/b) * arccoth( (b^2 - (a - Rw)(a - 1)) / (b (1 - Rw)) )
//
// and the shader turns (a, b, S, thickness) into the layer's own reflectance and
// transmittance. These are constants of the material, not of the pixel, so they
// are computed once on the CPU per parameter change rather than per fragment.
//
// arccoth(z) = 0.5 * ln((z + 1) / (z - 1)) is only real for |z| > 1, so z is
// clamped just outside the pole. Without that clamp an ink whose Rw and Rb are
// close produces NaN, which propagates through the composite and paints the whole
// sheet black: a failure mode worth a clamp rather than a crash.

/**
 * @param {number[]} inkOverWhite Rw, per channel, in (0, 1)
 * @param {number[]} inkOverBlack Rb, per channel, in (0, Rw)
 * @returns {{a: number[], b: number[], S: number[]}}
 */
export function kmConstants(inkOverWhite, inkOverBlack) {
  const a = [0, 0, 0];
  const b = [0, 0, 0];
  const S = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const Rw = clamp(inkOverWhite[i], 1e-3, 0.999);
    const Rb = clamp(inkOverBlack[i], 1e-3, Rw - 1e-3);
    const ai = 0.5 * (Rw + (Rb - Rw + 1.0) / Rb);
    const bi = Math.sqrt(Math.max(ai * ai - 1.0, 1e-6));
    let z = (bi * bi - (ai - Rw) * (ai - 1.0)) / (bi * (1.0 - Rw));
    z = Math.max(z, 1.0 + 1e-4);                    // arccoth domain: |z| > 1
    const Si = (1.0 / bi) * 0.5 * Math.log((z + 1.0) / (z - 1.0));
    a[i] = ai;
    b[i] = bi;
    S[i] = Si;
  }
  return { a, b, S };
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
