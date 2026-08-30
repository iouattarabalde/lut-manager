import { describe as suite, expect, it } from 'vitest';
import { createIdentity, index3D, setSample, type Lut, type RGB } from '../src/core/lut.js';
import { describe as describeLut, readZones } from '../src/core/describe.js';
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

const clamp = (v: number) => Math.max(0, Math.min(1, v));
const sCurve = (x: number) => x * x * (3 - 2 * x);

suite('headline', () => {
  it('says plainly when a LUT does nothing', () => {
    expect(describeLut(createIdentity(17)).headline).toContain('does nothing');
  });

  it('calls out added contrast', () => {
    const lut = build(33, (r, g, b) => [sCurve(r), sCurve(g), sCurve(b)]);
    expect(describeLut(lut).headline).toMatch(/contrast/);
  });

  it('calls out a flattened image', () => {
    const flat = (x: number) => 0.25 + x * 0.5;
    const lut = build(33, (r, g, b) => [flat(r), flat(g), flat(b)]);
    expect(describeLut(lut).headline).toMatch(/soften|flatten/);
  });

  it('names a warm midtone push', () => {
    const lut = build(33, (r, g, b) => [clamp(r * 1.12), g, clamp(b * 0.88)]);
    const d = describeLut(lut);
    expect(d.headline).toMatch(/warmer/);
  });

  it('names a cool push', () => {
    const lut = build(33, (r, g, b) => [clamp(r * 0.88), g, clamp(b * 1.12)]);
    expect(describeLut(lut).headline).toMatch(/cooler/);
  });
});

suite('zones', () => {
  it('reads shadows, midtones and highlights', () => {
    const zones = readZones(createIdentity(17));
    expect(zones.map((z) => z.name)).toEqual(['Shadows', 'Midtones', 'Highlights']);
    for (const z of zones) {
      expect(z.tint).toBe('neutral');
      expect(Math.abs(z.levelShift)).toBeLessThan(0.01);
    }
  });

  it('reports a lift in the shadows', () => {
    const lut = build(17, (r, g, b) => [
      clamp(0.1 + r * 0.9), clamp(0.1 + g * 0.9), clamp(0.1 + b * 0.9),
    ]);
    expect(readZones(lut)[0].levelShift).toBeGreaterThan(0.05);
  });

  it('detects a split tone: cool shadows, warm highlights', () => {
    const lut = build(33, (r, g, b) => {
      const l = (r + g + b) / 3;
      // Warm up as the image gets brighter, cool down as it gets darker.
      const warm = (l - 0.5) * 0.24;
      return [clamp(r + warm), g, clamp(b - warm)];
    });
    const zones = readZones(lut);
    expect(zones[0].tint).toBe('cooler');
    expect(zones[2].tint).toBe('warmer');
  });
});

suite('supporting points', () => {
  const pointsFor = (lut: Lut) => describeLut(lut).points.join(' ');

  it('mentions lifted blacks', () => {
    const lut = build(17, (r, g, b) => [
      clamp(0.12 + r * 0.88), clamp(0.12 + g * 0.88), clamp(0.12 + b * 0.88),
    ]);
    expect(pointsFor(lut)).toMatch(/[Ll]ifts the blacks/);
  });

  it('mentions clipped highlights', () => {
    const lut = build(17, (r, g, b) => [clamp(r * 2), clamp(g * 2), clamp(b * 2)]);
    expect(pointsFor(lut)).toMatch(/[Cc]lips/);
  });

  it('mentions crushed shadows', () => {
    const lut = build(17, (r, g, b) => [
      clamp(r * 2 - 1), clamp(g * 2 - 1), clamp(b * 2 - 1),
    ]);
    expect(pointsFor(lut)).toMatch(/[Cc]rushes/);
  });

  it('mentions desaturation', () => {
    const lut = build(17, (r, g, b) => {
      const l = (r + g + b) / 3;
      return [l + (r - l) * 0.3, l + (g - l) * 0.3, l + (b - l) * 0.3];
    });
    expect(pointsFor(lut)).toMatch(/saturation|colour out/i);
    expect(analyze(lut).saturation).toBeLessThan(0.5);
  });

  it('warns about a reversing tone curve', () => {
    const lut = createIdentity(17);
    setSample(lut, index3D(17, 8, 8, 8), [0.05, 0.05, 0.05]);
    expect(pointsFor(lut)).toMatch(/reverses/);
  });
});

suite('saturation metric', () => {
  it('is about 1 for an identity LUT', () => {
    expect(analyze(createIdentity(33)).saturation).toBeCloseTo(1, 1);
  });

  it('rises when saturation is pushed', () => {
    const lut = build(33, (r, g, b) => {
      const l = (r + g + b) / 3;
      return [clamp(l + (r - l) * 1.5), clamp(l + (g - l) * 1.5), clamp(l + (b - l) * 1.5)];
    });
    expect(analyze(lut).saturation).toBeGreaterThan(1.2);
  });
});
