import { describe, expect, it } from 'vitest';
import { ENCODING_LIST, ENCODINGS, encodingForColorSpace } from '../src/render/transfer.js';

describe('round trips', () => {
  it('returns to scene linear for every encoding', () => {
    for (const enc of ENCODING_LIST) {
      for (const x of [0.0, 0.005, 0.018, 0.18, 0.5, 1.0, 2.0, 8.0]) {
        const back = enc.toLinear(enc.fromLinear(x));
        expect(back, `${enc.id} at ${x}`).toBeCloseTo(x, 4);
      }
    }
  });

  it('is continuous across each curve\'s toe/log join', () => {
    for (const enc of ENCODING_LIST) {
      for (const x of [0.0089, 0.009, 0.01, 0.011, 0.0112, 0.0113]) {
        const back = enc.toLinear(enc.fromLinear(x));
        expect(back, `${enc.id} near join at ${x}`).toBeCloseTo(x, 4);
      }
    }
  });
});

describe('published anchor points', () => {
  // 18% scene grey against each manufacturer's documented code value.
  const MID_GREY: [keyof typeof ENCODINGS, number, number][] = [
    ['logc3', 0.391, 0.002],   // ARRI LogC3 EI 800
    ['logc4', 0.2782, 0.002],  // ARRI LogC4
    ['slog3', 0.4106, 0.002],  // Sony S-Log3 (420/1023)
    ['vlog', 0.42, 0.005],     // Panasonic V-Log
    ['log3g10', 0.333, 0.002], // RED Log3G10
    ['davinci', 0.336, 0.002], // DaVinci Intermediate
  ];

  for (const [id, expected, tol] of MID_GREY) {
    it(`${id} puts 18% grey at ${expected}`, () => {
      expect(Math.abs(ENCODINGS[id].fromLinear(0.18) - expected)).toBeLessThan(tol);
    });
  }

  it('maps sRGB and Rec.709 white to 1.0', () => {
    expect(ENCODINGS.srgb.fromLinear(1)).toBeCloseTo(1, 5);
    expect(ENCODINGS.rec709.fromLinear(1)).toBeCloseTo(1, 5);
  });

  it('keeps every log curve monotonic across the working range', () => {
    for (const enc of ENCODING_LIST) {
      let prev = -Infinity;
      for (let x = 0; x <= 16; x += 0.01) {
        const v = enc.fromLinear(x);
        expect(v, `${enc.id} at ${x}`).toBeGreaterThanOrEqual(prev - 1e-9);
        prev = v;
      }
    }
  });
});

describe('color space inference', () => {
  it('picks the encoding a LUT\'s InputColorSpace implies', () => {
    expect(encodingForColorSpace('ARRI LogC4 / AWG4')).toBe('logc4');
    expect(encodingForColorSpace('ARRI LogC3 / AWG3')).toBe('logc3');
    expect(encodingForColorSpace('Sony S-Log3 / S-Gamut3.Cine')).toBe('slog3');
    expect(encodingForColorSpace('Panasonic V-Log / V-Gamut')).toBe('vlog');
    expect(encodingForColorSpace('RED Log3G10 / REDWideGamutRGB')).toBe('log3g10');
    expect(encodingForColorSpace('Rec.709 Gamma 2.4')).toBe('rec709');
  });

  it('returns null when it cannot tell', () => {
    expect(encodingForColorSpace('')).toBeNull();
    expect(encodingForColorSpace('Some Custom Space')).toBeNull();
  });
});
