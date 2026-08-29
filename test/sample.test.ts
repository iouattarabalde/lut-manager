import { describe, expect, it } from 'vitest';
import { createIdentity, index3D, setSample, type Lut, type RGB } from '../src/core/lut.js';
import { sampleLut } from '../src/core/sample.js';

function build(size: number, fn: (r: number, g: number, b: number) => RGB): Lut {
  const lut = createIdentity(size);
  const step = 1 / (size - 1);
  for (let b = 0; b < size; b++)
    for (let g = 0; g < size; g++)
      for (let r = 0; r < size; r++)
        setSample(lut, index3D(size, r, g, b), fn(r * step, g * step, b * step));
  return lut;
}

const MODES = ['tetrahedral', 'trilinear'] as const;

describe('identity', () => {
  for (const mode of MODES) {
    it(`${mode} sampling of an identity LUT is a no-op`, () => {
      const lut = createIdentity(17);
      for (const c of [0, 0.1, 0.25, 0.333, 0.5, 0.618, 0.75, 1]) {
        const out = sampleLut(lut, [c, c * 0.4, 1 - c], mode);
        expect(out[0]).toBeCloseTo(c, 5);
        expect(out[1]).toBeCloseTo(c * 0.4, 5);
        expect(out[2]).toBeCloseTo(1 - c, 5);
      }
    });
  }

  it('is a no-op for a 1D identity too', () => {
    const lut = createIdentity(64, 1);
    for (const c of [0, 0.2, 0.5, 0.77, 1]) {
      const out = sampleLut(lut, [c, c, c]);
      expect(out[0]).toBeCloseTo(c, 5);
    }
  });
});

describe('agreement', () => {
  it('both modes agree exactly on grid points', () => {
    const s = (x: number) => x * x * (3 - 2 * x);
    const lut = build(9, (r, g, b) => [s(r), s(g), s(b)]);
    for (let i = 0; i < 9; i++) {
      const t = i / 8;
      const tet = sampleLut(lut, [t, t, t], 'tetrahedral');
      const tri = sampleLut(lut, [t, t, t], 'trilinear');
      for (let c = 0; c < 3; c++) expect(tet[c]).toBeCloseTo(tri[c], 6);
    }
  });

  it('both reproduce an affine transform exactly, anywhere in the cell', () => {
    // A saturation matrix is linear in r,g,b. Both interpolants are exact for
    // affine functions, so they agree everywhere — this is why a saturation
    // change is NOT where the two methods diverge.
    const lut = build(5, (r, g, b) => {
      const l = (r + g + b) / 3;
      return [l + (r - l) * 1.6, l + (g - l) * 1.6, l + (b - l) * 1.6];
    });
    for (let i = 0; i < 200; i++) {
      const p: RGB = [Math.random(), Math.random(), Math.random()];
      const tet = sampleLut(lut, p, 'tetrahedral');
      const tri = sampleLut(lut, p, 'trilinear');
      for (let c = 0; c < 3; c++) expect(tet[c]).toBeCloseTo(tri[c], 6);
    }
  });

  it('they diverge on a multiplicative cross term', () => {
    // r*g is multilinear: trilinear reproduces it exactly, tetrahedral does
    // not. This is the real difference between the two.
    const lut = build(5, (r, g, b) => [r * g, g * b, b * r]);
    let maxDiff = 0;
    for (let i = 0; i < 500; i++) {
      const p: RGB = [Math.random(), Math.random(), Math.random()];
      const tet = sampleLut(lut, p, 'tetrahedral');
      const tri = sampleLut(lut, p, 'trilinear');
      for (let c = 0; c < 3; c++) maxDiff = Math.max(maxDiff, Math.abs(tet[c] - tri[c]));
    }
    expect(maxDiff).toBeGreaterThan(0.005);
    expect(maxDiff).toBeLessThan(0.1);
  });
});

describe('curves and domain', () => {
  it('reproduces a known curve at grid points', () => {
    const gamma = (x: number) => Math.pow(x, 1 / 2.2);
    const lut = build(33, (r, g, b) => [gamma(r), gamma(g), gamma(b)]);
    for (const t of [0.25, 0.5, 0.75]) {
      expect(sampleLut(lut, [t, t, t])[0]).toBeCloseTo(gamma(t), 2);
    }
  });

  it('normalises through a non-default domain', () => {
    const lut = createIdentity(17);
    lut.domainMax = [4, 4, 4];
    // With domain 0..4, an input of 4 lands at the top of the grid.
    expect(sampleLut(lut, [4, 4, 4])[0]).toBeCloseTo(1, 5);
    expect(sampleLut(lut, [2, 2, 2])[0]).toBeCloseTo(0.5, 5);
  });

  it('clamps out-of-range input rather than reading past the grid', () => {
    const lut = createIdentity(17);
    expect(sampleLut(lut, [-5, -5, -5])[0]).toBeCloseTo(0, 5);
    expect(sampleLut(lut, [99, 99, 99])[0]).toBeCloseTo(1, 5);
  });
});
