import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaults, merge, resolve, pxPerMm, pxPerPt } from '../../src/params.js';
import { presets, presetNames, preset } from '../../src/presets.js';

test('defaults() returns a fresh tree each call', () => {
  const a = defaults();
  const b = defaults();
  a.cockle.amplitude_um = 999;
  assert.equal(b.cockle.amplitude_um, 22, 'mutating one tree must not affect another');
});

test('paperlab defaults are carried over exactly', () => {
  const p = defaults();
  // Spot-check the values that are sourced from the research, not guessed.
  assert.equal(p.cockle.wavelength_mm, 30);       // Land 2004: 16-34mm
  assert.equal(p.cockle.amplitude_um, 22);        // visible above 25um p2v
  assert.equal(p.formation.scale_mm, 2.5);        // CSF peak 1-3mm
  assert.equal(p.light.azimuth_deg, 116);         // above-left, 26deg off vertical
  assert.equal(p.cavity.radius_mm, 0.8);          // Luft 2006
  assert.deepEqual(p.tone.paper, [1.0, 0.953, 0.871]);   // #FFF3DE
  assert.equal(p.ink.kubelka_munk, true);
});

test('merge is deep for objects and wholesale for arrays', () => {
  const base = { a: { x: 1, y: 2 }, c: [1, 2, 3] };
  const out = merge(base, { a: { y: 9 }, c: [7] });
  assert.deepEqual(out.a, { x: 1, y: 9 }, 'objects merge key by key');
  assert.deepEqual(out.c, [7], 'arrays replace: a half-overridden colour is never intended');
});

test('merge does not mutate its inputs', () => {
  const base = defaults();
  const before = JSON.stringify(base);
  merge(base, { cockle: { amplitude_um: 100 } });
  assert.equal(JSON.stringify(base), before);
});

test('merge keeps unknown keys so a paperlab round-trip is lossless', () => {
  const out = merge(defaults(), { view: { buffer: 3 }, page: { width_pt: 612 } });
  assert.equal(out.view.buffer, 3);
  assert.equal(out.page.width_pt, 612);
});

test('pxPerMm and pxPerPt are physically correct', () => {
  const p = defaults();
  assert.equal(p.page.dpi, 96, 'web nominal DPI');
  assert.ok(Math.abs(pxPerMm(p) - 96 / 25.4) < 1e-12);
  assert.ok(Math.abs(pxPerMm(p) - 3.779527559) < 1e-6);
  assert.ok(Math.abs(pxPerPt(p) - 96 / 72) < 1e-12);
  const hidpi = merge(p, { page: { dpi: 300 } });
  assert.ok(Math.abs(pxPerMm(hidpi) - 300 / 25.4) < 1e-12);
});

test('every shipped preset resolves to a complete tree', () => {
  assert.ok(presetNames.length >= 9, `expected the paperlab presets, got ${presetNames.length}`);
  const template = defaults();
  for (const name of presetNames) {
    const p = resolve(preset(name));
    // Every group and every leaf the defaults define must survive resolution.
    for (const group of Object.keys(template)) {
      assert.ok(p[group], `${name}: missing group ${group}`);
      for (const key of Object.keys(template[group])) {
        assert.notEqual(p[group][key], undefined, `${name}: missing ${group}.${key}`);
      }
    }
  }
});

test('presets contain no NaN or null leaves', () => {
  for (const name of presetNames) {
    const p = resolve(preset(name));
    walk(p, (path, v) => {
      assert.ok(v !== null, `${name}: ${path} is null`);
      if (typeof v === 'number') assert.ok(Number.isFinite(v), `${name}: ${path} is ${v}`);
    });
  }
});

test('the legacy formation.gabor flag was translated to formation.source', () => {
  for (const name of presetNames) {
    assert.equal(presets[name].gabor, undefined);
    assert.equal(presets[name].formation?.gabor, undefined,
      `${name} still carries the pre-source gabor flag`);
  }
  // textured is the preset that actually uses the Gabor path.
  assert.equal(resolve(preset('textured')).formation.source, 1);
  assert.equal(resolve(preset('paper')).formation.source, 0);
});

test('preset() rejects an unknown name rather than silently rendering defaults', () => {
  assert.throws(() => preset('nope'), /unknown preset/);
});

test('ink constraints hold for every preset: 0 < Rb < Rw < 1 per channel', () => {
  // The Kubelka-Munk derivation is only defined in this domain; a preset that
  // violates it would be clamped into something that is not what its author saw.
  for (const name of presetNames) {
    const { ink } = resolve(preset(name));
    for (let i = 0; i < 3; i++) {
      const Rw = ink.ink_over_white[i];
      const Rb = ink.ink_over_black[i];
      assert.ok(Rw > 0 && Rw < 1, `${name} ch${i}: Rw=${Rw} out of range`);
      assert.ok(Rb > 0 && Rb < Rw, `${name} ch${i}: Rb=${Rb} must be in (0, ${Rw})`);
    }
  }
});

function walk(obj, fn, path = '') {
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    const p = path ? `${path}.${k}` : k;
    if (Array.isArray(v)) v.forEach((x, i) => fn(`${p}[${i}]`, x));
    else if (v && typeof v === 'object') walk(v, fn, p);
    else fn(p, v);
  }
}
