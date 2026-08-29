/**
 * Procedurally generated reference images.
 *
 * Everything is produced in scene-linear RGB and encoded into the LUT's input
 * space by the preview pipeline. Generating in linear rather than baking a
 * particular log curve into the chart is what lets one chart serve a LogC LUT
 * and an S-Log3 LUT without lying to either.
 *
 * Generated rather than shipped as assets, so there are no binaries in the
 * repo and the charts scale to any preview size.
 */

import { ENCODINGS } from './transfer.js';

export type ChartId = 'ramp' | 'checker' | 'hues' | 'skin' | 'wedge';

export interface Chart {
  id: ChartId;
  label: string;
}

export const CHARTS: Chart[] = [
  { id: 'ramp', label: 'Grey ramp' },
  { id: 'checker', label: 'ColorChecker' },
  { id: 'hues', label: 'Hue / saturation sweep' },
  { id: 'skin', label: 'Skin tones' },
  { id: 'wedge', label: 'Exposure wedge' },
];

/** X-Rite ColorChecker, standard sRGB renderings, row-major from dark skin. */
const CHECKER_SRGB: [number, number, number][] = [
  [115, 82, 68], [194, 150, 130], [98, 122, 157], [87, 108, 67], [133, 128, 177], [103, 189, 170],
  [214, 126, 44], [80, 91, 166], [193, 90, 99], [94, 60, 108], [157, 188, 64], [224, 163, 46],
  [56, 61, 150], [70, 148, 73], [175, 54, 60], [231, 199, 31], [187, 86, 149], [8, 133, 161],
  [243, 243, 242], [200, 200, 200], [160, 160, 160], [122, 122, 121], [85, 85, 85], [52, 52, 52],
];

/** Representative skin tones, light to deep, as sRGB. */
const SKIN_SRGB: [number, number, number][] = [
  [255, 224, 196], [241, 194, 165], [224, 172, 138], [198, 134, 100],
  [172, 112, 80], [140, 88, 62], [110, 68, 48], [82, 50, 36],
];

const srgbToLinear = (v: number): number => ENCODINGS.srgb.toLinear(v / 255);

/** HSV to linear RGB, going via sRGB so hues land where a colorist expects. */
function hsvToLinear(h: number, s: number, v: number): [number, number, number] {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  let rgb: [number, number, number];
  switch (i % 6) {
    case 0: rgb = [v, t, p]; break;
    case 1: rgb = [q, v, p]; break;
    case 2: rgb = [p, v, t]; break;
    case 3: rgb = [p, q, v]; break;
    case 4: rgb = [t, p, v]; break;
    default: rgb = [v, p, q];
  }
  return rgb.map((c) => ENCODINGS.srgb.toLinear(c)) as [number, number, number];
}

/**
 * Render a chart as scene-linear RGB. Values can exceed 1.0 — the exposure
 * wedge deliberately runs into the highlights so you can see where a LUT
 * clips.
 */
export function renderChart(id: ChartId, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h * 3);
  const put = (x: number, y: number, rgb: [number, number, number]) => {
    const o = (y * w + x) * 3;
    out[o] = rgb[0];
    out[o + 1] = rgb[1];
    out[o + 2] = rgb[2];
  };

  switch (id) {
    case 'ramp': {
      // Continuous ramp on top, 11 steps below, both 0..1 in display terms
      // interpreted as scene linear via sRGB so the ramp is perceptual.
      const split = Math.floor(h * 0.62);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const t = w > 1 ? x / (w - 1) : 0;
          const v = y < split ? t : Math.floor(t * 10.999) / 10;
          const lin = ENCODINGS.srgb.toLinear(v);
          put(x, y, [lin, lin, lin]);
        }
      }
      break;
    }

    case 'checker': {
      const cols = 6;
      const rows = 4;
      for (let y = 0; y < h; y++) {
        const r = Math.min(rows - 1, Math.floor((y / h) * rows));
        for (let x = 0; x < w; x++) {
          const c = Math.min(cols - 1, Math.floor((x / w) * cols));
          // Thin gutter between patches, as on the physical chart.
          const gx = (x / w) * cols - c;
          const gy = (y / h) * rows - r;
          const gutter = gx < 0.04 || gx > 0.96 || gy < 0.05 || gy > 0.95;
          if (gutter) {
            put(x, y, [0.006, 0.006, 0.006]);
            continue;
          }
          const patch = CHECKER_SRGB[r * cols + c];
          put(x, y, patch.map(srgbToLinear) as [number, number, number]);
        }
      }
      break;
    }

    case 'hues': {
      for (let y = 0; y < h; y++) {
        const sat = h > 1 ? 1 - y / (h - 1) : 1;
        for (let x = 0; x < w; x++) {
          const hue = w > 1 ? x / (w - 1) : 0;
          put(x, y, hsvToLinear(hue, sat, 1));
        }
      }
      break;
    }

    case 'skin': {
      const n = SKIN_SRGB.length;
      for (let y = 0; y < h; y++) {
        // Vertical axis walks two stops either side of the nominal tone.
        const ev = h > 1 ? (y / (h - 1)) * 4 - 2 : 0;
        const gain = Math.pow(2, -ev);
        for (let x = 0; x < w; x++) {
          const i = Math.min(n - 1, Math.floor((x / w) * n));
          const base = SKIN_SRGB[i].map(srgbToLinear) as [number, number, number];
          put(x, y, [base[0] * gain, base[1] * gain, base[2] * gain]);
        }
      }
      break;
    }

    case 'wedge': {
      // Nine stops around 18% grey, running well past diffuse white so
      // highlight handling and clipping are visible.
      const stops = 9;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const step = Math.min(stops - 1, Math.floor((x / w) * stops));
          const ev = step - 4;
          const v = 0.18 * Math.pow(2, ev);
          // Bottom third repeats the wedge as a smooth sweep.
          const smooth = y > h * 0.66;
          const t = w > 1 ? x / (w - 1) : 0;
          const value = smooth ? 0.18 * Math.pow(2, t * 8 - 4) : v;
          put(x, y, [value, value, value]);
        }
      }
      break;
    }
  }

  return out;
}
