import { describe, expect, it } from 'vitest';
import { createIdentity, index3D, setSample, type Lut } from '../src/core/lut.js';
import { analyze, runChecks } from '../src/core/analyze.js';

/** Apply a per-channel function to every sample of a fresh identity LUT. */
function build(size: number, fn: (r: number, g: number, b: number) => [number, number, number]): Lut {
  const lut = createIdentity(size);
  const step = 1 / (size - 1);
  for (let b = 0; b < size; b++)
    for (let g = 0; g < size; g++)
      for (let r = 0; r < size; r++)
        setSample(lut, index3D(size, r, g, b), fn(r * step, g * step, b * step));
  return lut;
}

describe('metrics', () => {
  it('recognises an identity LUT', () => {
    const m = analyze(createIdentity(17));
    expect(m.isIdentity).toBe(true);
    expect(m.maxDeviation).toBeLessThan(1e-4);
    expect(m.midSlope).toBeCloseTo(1, 3);
    expect(m.neutralMonotonic).toBe(true);
  });

  it('measures black, white and mid points', () => {
    // Lift the black, keep white.
    const lut = build(17, (r, g, b) => [0.05 + r * 0.95, 0.05 + g * 0.95, 0.05 + b * 0.95]);
    const m = analyze(lut);
    expect(m.blackPoint[0]).toBeCloseTo(0.05, 3);
    expect(m.whitePoint[0]).toBeCloseTo(1, 3);
    expect(m.isIdentity).toBe(false);
  });

  it('reports a steeper mid slope for a contrast curve', () => {
    const s = (x: number) => x * x * (3 - 2 * x);
    const m = analyze(build(33, (r, g, b) => [s(r), s(g), s(b)]));
    expect(m.midSlope).toBeGreaterThan(1.2);
  });

  it('detects clipping', () => {
    const m = analyze(build(17, (r, g, b) => [Math.min(r * 2, 1), Math.min(g * 2, 1), Math.min(b * 2, 1)]));
    expect(m.clippedHigh).toBeGreaterThan(0.2);
  });

  it('flags a non-monotonic neutral axis', () => {
    const lut = createIdentity(17);
    // Push one neutral sample below its predecessor.
    setSample(lut, index3D(17, 8, 8, 8), [0.1, 0.1, 0.1]);
    expect(analyze(lut).neutralMonotonic).toBe(false);
  });
});

describe('channel independence', () => {
  it('sees a per-channel curve as reducible to 1D', () => {
    const s = (x: number) => Math.pow(x, 1 / 2.2);
    const m = analyze(build(17, (r, g, b) => [s(r), s(g), s(b)]));
    expect(m.isChannelIndependent).toBe(true);
    expect(runChecks(m ? build(17, (r, g, b) => [s(r), s(g), s(b)]) : createIdentity(17))
      .some((c) => c.code === 'reducible-to-1d')).toBe(true);
  });

  it('sees a saturation change as genuinely 3D', () => {
    const lut = build(17, (r, g, b) => {
      const l = (r + g + b) / 3;
      const sat = 1.4;
      return [l + (r - l) * sat, l + (g - l) * sat, l + (b - l) * sat];
    });
    expect(analyze(lut).isChannelIndependent).toBe(false);
  });
});

describe('checks', () => {
  it('warns on an identity LUT', () => {
    expect(runChecks(createIdentity(33)).some((c) => c.code === 'identity')).toBe(true);
  });

  it('warns about sizes hardware may reject', () => {
    expect(runChecks(createIdentity(20)).some((c) => c.code === 'unusual-size')).toBe(true);
    expect(runChecks(createIdentity(33)).some((c) => c.code === 'unusual-size')).toBe(false);
    expect(runChecks(createIdentity(17)).some((c) => c.code === 'unusual-size')).toBe(false);
    expect(runChecks(createIdentity(65)).some((c) => c.code === 'unusual-size')).toBe(false);
  });

  it('notes a non-default domain', () => {
    const lut = createIdentity(17);
    lut.domainMax = [4, 4, 4];
    expect(runChecks(lut).some((c) => c.code === 'non-default-domain')).toBe(true);
  });
});
