import { describe, expect, it } from 'vitest';
import { createIdentity, index3D, setSample, type Lut, type RGB } from '../src/core/lut.js';
import { sampleLut } from '../src/core/sample.js';
import {
  LEGAL_MAX,
  LEGAL_MIN,
  clamp,
  concatenate,
  extract1D,
  invert,
  resample,
  resampleError,
} from '../src/core/ops.js';
import { analyze } from '../src/core/analyze.js';

function build(size: number, fn: (r: number, g: number, b: number) => RGB): Lut {
  const lut = createIdentity(size);
  const step = 1 / (size - 1);
  for (let b = 0; b < size; b++)
    for (let g = 0; g < size; g++)
      for (let r = 0; r < size; r++)
        setSample(lut, index3D(size, r, g, b), fn(r * step, g * step, b * step));
  return lut;
}

const smooth = (x: number) => x * x * (3 - 2 * x);
const gamma = (x: number) => Math.pow(Math.max(x, 0), 1 / 2.2);

describe('resample', () => {
  it('keeps an identity an identity at any size', () => {
    for (const size of [17, 33, 65]) {
      const out = resample(createIdentity(33), size);
      expect(out.size).toBe(size);
      expect(analyze(out).isIdentity).toBe(true);
    }
  });

  it('round-trips a smooth LUT with small error', () => {
    const src = build(33, (r, g, b) => [smooth(r), smooth(g), smooth(b)]);
    const down = resample(src, 17);
    expect(down.size).toBe(17);
    expect(resampleError(src, down).max).toBeLessThan(0.01);
  });

  it('reports larger error when downsampling a hard knee', () => {
    // A sharp clip is exactly what a coarse grid cannot represent.
    const hard = build(65, (r, g, b) => [
      Math.min(1, r * 3), Math.min(1, g * 3), Math.min(1, b * 3),
    ]);
    const smoothSrc = build(65, (r, g, b) => [smooth(r), smooth(g), smooth(b)]);
    const hardErr = resampleError(hard, resample(hard, 17)).max;
    const smoothErr = resampleError(smoothSrc, resample(smoothSrc, 17)).max;
    expect(hardErr).toBeGreaterThan(smoothErr);
  });

  it('clears rawData so the writer re-serialises', () => {
    const src = createIdentity(33);
    src.rawData = ['stale'];
    expect(resample(src, 17).rawData).toBeNull();
  });

  it('resamples a 1D LUT', () => {
    const src = createIdentity(1024, 1);
    const out = resample(src, 64);
    expect(out.dims).toBe(1);
    expect(out.size).toBe(64);
    expect(sampleLut(out, [0.5, 0.5, 0.5])[0]).toBeCloseTo(0.5, 4);
  });
});

describe('concatenate', () => {
  it('A then identity equals A', () => {
    const a = build(17, (r, g, b) => [smooth(r), smooth(g), smooth(b)]);
    const out = concatenate(a, createIdentity(17), 17);
    for (const t of [0.1, 0.35, 0.6, 0.9]) {
      expect(sampleLut(out, [t, t, t])[0]).toBeCloseTo(sampleLut(a, [t, t, t])[0], 4);
    }
  });

  it('identity then B equals B', () => {
    const b = build(17, (r, g, bb) => [gamma(r), gamma(g), gamma(bb)]);
    const out = concatenate(createIdentity(17), b, 17);
    for (const t of [0.2, 0.5, 0.8]) {
      expect(sampleLut(out, [t, t, t])[0]).toBeCloseTo(sampleLut(b, [t, t, t])[0], 4);
    }
  });

  it('applies first then second, not the other way round', () => {
    const brighten = build(17, (r, g, b) => [Math.min(1, r * 2), g, b]);
    const half = build(17, (r, g, b) => [r * 0.5, g, b]);

    // brighten then half: 0.2 -> 0.4 -> 0.2
    const bh = concatenate(brighten, half, 33);
    expect(sampleLut(bh, [0.2, 0, 0])[0]).toBeCloseTo(0.2, 2);

    // half then brighten: 0.2 -> 0.1 -> 0.2, same here, so use a clipping value
    // 0.8 -> brighten -> 1.0 -> half -> 0.5   vs   0.8 -> half -> 0.4 -> brighten -> 0.8
    const hb = concatenate(half, brighten, 33);
    expect(sampleLut(bh, [0.8, 0, 0])[0]).toBeCloseTo(0.5, 2);
    expect(sampleLut(hb, [0.8, 0, 0])[0]).toBeCloseTo(0.8, 2);
  });

  it('takes the output color space from the second LUT', () => {
    const a = createIdentity(9);
    a.meta.inputCS = 'ARRI LogC3 / AWG3';
    a.meta.outputCS = 'Rec.709 Gamma 2.4';
    const b = createIdentity(9);
    b.meta.outputCS = 'P3-D65';
    expect(concatenate(a, b, 9).meta.outputCS).toBe('P3-D65');
  });
});

describe('clamp', () => {
  it('pulls out-of-range values back to 0-1', () => {
    const wild = build(9, (r, g, b) => [r * 2 - 0.5, g * 2 - 0.5, b * 2 - 0.5]);
    const out = clamp(wild);
    for (let i = 0; i < out.data.length; i++) {
      expect(out.data[i]).toBeGreaterThanOrEqual(0);
      expect(out.data[i]).toBeLessThanOrEqual(1);
    }
  });

  it('clamps to broadcast-legal range', () => {
    const out = clamp(createIdentity(17), LEGAL_MIN, LEGAL_MAX);
    // Samples live in a Float32Array, which cannot hold 64/1023 or 940/1023
    // exactly, so the bound holds to float32 precision rather than float64.
    const eps = 1e-6;
    for (let i = 0; i < out.data.length; i++) {
      expect(out.data[i]).toBeGreaterThanOrEqual(LEGAL_MIN - eps);
      expect(out.data[i]).toBeLessThanOrEqual(LEGAL_MAX + eps);
    }
  });
});

describe('extract1D', () => {
  it('is exact for a channel-independent LUT', () => {
    const src = build(33, (r, g, b) => [gamma(r), gamma(g), gamma(b)]);
    expect(analyze(src).isChannelIndependent).toBe(true);
    const oned = extract1D(src, 256);
    expect(oned.dims).toBe(1);
    for (const t of [0.15, 0.4, 0.65, 0.9]) {
      expect(sampleLut(oned, [t, t, t])[0]).toBeCloseTo(sampleLut(src, [t, t, t])[0], 2);
    }
  });

  it('produces a 1D LUT of the requested size', () => {
    expect(extract1D(createIdentity(33), 512).size).toBe(512);
  });
});

describe('invert', () => {
  it('inverts a smooth per-channel curve to within a small residual', () => {
    const src = build(33, (r, g, b) => [gamma(r), gamma(g), gamma(b)]);
    const { lut: inv, maxError } = invert(src, 17);
    expect(maxError).toBeLessThan(0.02);

    // Forward then inverse should return roughly where it started.
    for (const t of [0.2, 0.5, 0.8]) {
      const forward = sampleLut(src, [t, t, t]);
      const back = sampleLut(inv, forward);
      expect(back[0]).toBeCloseTo(t, 1);
    }
  });

  it('inverts an identity to an identity', () => {
    const { lut: inv, maxError } = invert(createIdentity(17), 17);
    expect(maxError).toBeLessThan(0.01);
    for (const t of [0.25, 0.5, 0.75]) {
      expect(sampleLut(inv, [t, t, t])[0]).toBeCloseTo(t, 2);
    }
  });

  it('flags a clipping LUT as non-invertible rather than pretending', () => {
    // Everything above 1/3 maps to white — no exact inverse exists.
    const clipper = build(17, (r, g, b) => [
      Math.min(1, r * 3), Math.min(1, g * 3), Math.min(1, b * 3),
    ]);
    const res = invert(clipper, 17);
    expect(res.nonInjective).toBe(true);
  });

  it('swaps the declared input and output spaces', () => {
    const src = createIdentity(9);
    src.meta.inputCS = 'ARRI LogC3 / AWG3';
    src.meta.outputCS = 'Rec.709 Gamma 2.4';
    const { lut } = invert(src, 9);
    expect(lut.meta.inputCS).toBe('Rec.709 Gamma 2.4');
    expect(lut.meta.outputCS).toBe('ARRI LogC3 / AWG3');
  });
});
