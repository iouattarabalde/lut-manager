import { describe, expect, it } from 'vitest';
import { CHARTS, renderChart } from '../src/render/charts.js';
import { ENCODINGS } from '../src/render/transfer.js';

describe('chart generation', () => {
  for (const chart of CHARTS) {
    it(`${chart.id} produces finite, non-negative scene-linear data`, () => {
      const w = 64;
      const h = 48;
      const data = renderChart(chart.id, w, h);
      expect(data).toHaveLength(w * h * 3);
      for (let i = 0; i < data.length; i++) {
        expect(Number.isFinite(data[i]), `${chart.id} index ${i}`).toBe(true);
        expect(data[i]).toBeGreaterThanOrEqual(0);
      }
    });
  }

  it('the grey ramp is neutral and increases left to right', () => {
    const w = 64;
    const data = renderChart('ramp', w, 10);
    let prev = -1;
    for (let x = 0; x < w; x++) {
      const o = (2 * w + x) * 3; // a row inside the continuous section
      expect(data[o]).toBeCloseTo(data[o + 1], 6);
      expect(data[o + 1]).toBeCloseTo(data[o + 2], 6);
      expect(data[o]).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = data[o];
    }
  });

  it('the exposure wedge runs past diffuse white so clipping is visible', () => {
    const data = renderChart('wedge', 128, 32);
    let max = 0;
    for (let i = 0; i < data.length; i++) max = Math.max(max, data[i]);
    expect(max).toBeGreaterThan(1.5);
  });

  it('the ColorChecker white patch is far brighter than the black patch', () => {
    const w = 120;
    const h = 80;
    const data = renderChart('checker', w, h);
    const at = (fx: number, fy: number) => {
      const x = Math.floor(w * fx);
      const y = Math.floor(h * fy);
      return data[(y * w + x) * 3];
    };
    // Bottom row: white at far left, black at far right.
    const white = at(0.08, 0.88);
    const black = at(0.92, 0.88);
    expect(white).toBeGreaterThan(0.7);
    expect(black).toBeLessThan(0.08);
  });

  it('the hue sweep desaturates towards the bottom', () => {
    const w = 64;
    const h = 64;
    const data = renderChart('hues', w, h);
    const spread = (y: number) => {
      const o = (y * w + 10) * 3;
      return Math.max(data[o], data[o + 1], data[o + 2]) -
             Math.min(data[o], data[o + 1], data[o + 2]);
    };
    expect(spread(0)).toBeGreaterThan(spread(h - 1));
  });

  it('charts encode into a log space without producing NaN', () => {
    const data = renderChart('wedge', 32, 16);
    for (const id of ['logc3', 'logc4', 'slog3', 'vlog', 'log3g10'] as const) {
      for (let i = 0; i < data.length; i++) {
        expect(Number.isFinite(ENCODINGS[id].fromLinear(data[i])), `${id} @ ${i}`).toBe(true);
      }
    }
  });
});
