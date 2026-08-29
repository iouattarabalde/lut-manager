/**
 * Operations that change LUT data.
 *
 * Everything here returns a new Lut with `rawData` cleared, so the writer
 * re-serialises from samples instead of handing back the original rows. That
 * is the line between this module and header editing: those keep the data
 * table byte-identical, these deliberately do not.
 */

import {
  type Dims,
  type Lut,
  type RGB,
  createIdentity,
  getSample,
  index3D,
  lutSampleCount,
  setSample,
} from './lut.js';
import { type Interpolation, sampleLut } from './sample.js';

/** Carry metadata onto a derived LUT, leaving the data to the caller. */
function derive(source: Lut, size: number, dims: Dims = 3): Lut {
  const out = createIdentity(size, dims);
  out.meta = { ...source.meta };
  out.passthrough = [...source.passthrough];
  out.lineEnding = source.lineEnding;
  out.domainMin = [...source.domainMin] as RGB;
  out.domainMax = [...source.domainMax] as RGB;
  out.rawData = null;
  return out;
}

/**
 * Resample to a different cube size.
 *
 * Downsampling a LUT with hard clipping or a sharp knee loses detail the
 * coarser grid cannot represent — `resampleError` reports how much.
 */
export function resample(
  lut: Lut,
  size: number,
  mode: Interpolation = 'tetrahedral',
): Lut {
  if (lut.dims === 1) {
    const out = derive(lut, size, 1);
    for (let i = 0; i < size; i++) {
      const t = size > 1 ? i / (size - 1) : 0;
      setSample(out, i, sampleLut(lut, [t, t, t], mode));
    }
    return out;
  }

  const out = derive(lut, size, 3);
  const step = size > 1 ? 1 / (size - 1) : 0;
  const spanR = lut.domainMax[0] - lut.domainMin[0];
  const spanG = lut.domainMax[1] - lut.domainMin[1];
  const spanB = lut.domainMax[2] - lut.domainMin[2];

  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        const input: RGB = [
          lut.domainMin[0] + r * step * spanR,
          lut.domainMin[1] + g * step * spanG,
          lut.domainMin[2] + b * step * spanB,
        ];
        setSample(out, index3D(size, r, g, b), sampleLut(lut, input, mode));
      }
    }
  }
  return out;
}

/**
 * Largest error introduced by resampling, measured by comparing the resampled
 * LUT against the original on a dense probe grid. Use it to decide whether a
 * downsample is safe to ship.
 */
export function resampleError(
  original: Lut,
  resampled: Lut,
  probe = 24,
  mode: Interpolation = 'tetrahedral',
): { max: number; mean: number } {
  let max = 0;
  let total = 0;
  let n = 0;
  const step = probe > 1 ? 1 / (probe - 1) : 0;

  for (let b = 0; b < probe; b++) {
    for (let g = 0; g < probe; g++) {
      for (let r = 0; r < probe; r++) {
        const input: RGB = [r * step, g * step, b * step];
        const a = sampleLut(original, input, mode);
        const c = sampleLut(resampled, input, mode);
        for (let i = 0; i < 3; i++) {
          const d = Math.abs(a[i] - c[i]);
          if (d > max) max = d;
          total += d;
          n++;
        }
      }
    }
  }
  return { max, mean: n ? total / n : 0 };
}

/**
 * Bake B on top of A: the result applies A first, then B.
 *
 * A's output must be in B's input space. Nothing here can check that — the
 * caller should compare A's OutputColorSpace against B's InputColorSpace and
 * warn — but getting the order backwards is the easiest mistake to make, so
 * the parameter names say it plainly.
 */
export function concatenate(
  first: Lut,
  then: Lut,
  size = Math.max(first.dims === 1 ? 33 : first.size, then.dims === 1 ? 33 : then.size),
  mode: Interpolation = 'tetrahedral',
): Lut {
  const out = derive(first, size, 3);
  const step = size > 1 ? 1 / (size - 1) : 0;
  const span: RGB = [
    first.domainMax[0] - first.domainMin[0],
    first.domainMax[1] - first.domainMin[1],
    first.domainMax[2] - first.domainMin[2],
  ];

  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        const input: RGB = [
          first.domainMin[0] + r * step * span[0],
          first.domainMin[1] + g * step * span[1],
          first.domainMin[2] + b * step * span[2],
        ];
        const mid = sampleLut(first, input, mode);
        setSample(out, index3D(size, r, g, b), sampleLut(then, mid, mode));
      }
    }
  }

  out.meta = {
    ...first.meta,
    title: first.meta.title && then.meta.title
      ? `${first.meta.title} + ${then.meta.title}`
      : first.meta.title || then.meta.title,
    // The chain ends wherever the second LUT ends.
    outputCS: then.meta.outputCS || first.meta.outputCS,
  };
  return out;
}

/** 10-bit broadcast-legal range, as a 0-1 fraction. */
export const LEGAL_MIN = 64 / 1023;
export const LEGAL_MAX = 940 / 1023;

export function clamp(lut: Lut, min = 0, max = 1): Lut {
  const out = derive(lut, lut.size, lut.dims);
  out.meta = { ...lut.meta };
  const count = lutSampleCount(lut);
  for (let i = 0; i < count * 3; i++) {
    const v = lut.data[i];
    out.data[i] = v < min ? min : v > max ? max : v;
  }
  return out;
}

/**
 * Pull the per-channel response out of a 3D LUT as a 1D LUT.
 *
 * Exact only when the LUT does no cross-channel work — check
 * `analyze().isChannelIndependent` first. Otherwise this captures each
 * channel's response along its own axis and discards the rest.
 */
export function extract1D(lut: Lut, size = 1024): Lut {
  const out = derive(lut, size, 1);
  const n = lut.size;

  for (let i = 0; i < size; i++) {
    const t = size > 1 ? i / (size - 1) : 0;
    if (lut.dims === 1) {
      setSample(out, i, sampleLut(lut, [t, t, t]));
      continue;
    }
    // Each channel measured along its own axis with the others at zero.
    const p = t * (n - 1);
    const lo = Math.min(n - 2, Math.max(0, Math.floor(p)));
    const f = p - lo;
    const rgb: RGB = [0, 0, 0];
    const axes: [number, number, number][] = [
      [lo, 0, 0],
      [0, lo, 0],
      [0, 0, lo],
    ];
    for (let c = 0; c < 3; c++) {
      const [ar, ag, ab] = axes[c];
      const a = getSample(lut, index3D(n, ar, ag, ab))[c];
      const bIdx = c === 0 ? index3D(n, lo + 1, 0, 0)
        : c === 1 ? index3D(n, 0, lo + 1, 0)
        : index3D(n, 0, 0, lo + 1);
      const b = getSample(lut, bIdx)[c];
      rgb[c] = a + (b - a) * f;
    }
    setSample(out, i, rgb);
  }
  return out;
}

export interface InvertResult {
  lut: Lut;
  /** Worst round-trip error over the inverted grid, 0-1. */
  maxError: number;
  meanError: number;
  /** True when the forward LUT maps distinct inputs to the same output. */
  nonInjective: boolean;
}

/**
 * Approximate inverse of a 3D LUT.
 *
 * 3D LUT inversion is ill-posed: a LUT that clips highlights maps a whole
 * range of inputs onto one output, so no exact inverse exists. This does a
 * coarse nearest-output search followed by Gauss-Newton refinement, and
 * reports the residual honestly rather than pretending the result is exact.
 * Check `maxError` before shipping the result.
 */
export function invert(
  lut: Lut,
  size = 33,
  mode: Interpolation = 'tetrahedral',
): InvertResult {
  // Dense forward sampling, used as the seed for each search.
  const seedN = Math.min(33, Math.max(17, lut.size));
  const seedStep = 1 / (seedN - 1);
  const seedCount = seedN * seedN * seedN;
  const seedIn = new Float32Array(seedCount * 3);
  const seedOut = new Float32Array(seedCount * 3);

  let si = 0;
  for (let b = 0; b < seedN; b++) {
    for (let g = 0; g < seedN; g++) {
      for (let r = 0; r < seedN; r++) {
        const input: RGB = [r * seedStep, g * seedStep, b * seedStep];
        const output = sampleLut(lut, input, mode);
        seedIn[si] = input[0];
        seedIn[si + 1] = input[1];
        seedIn[si + 2] = input[2];
        seedOut[si] = output[0];
        seedOut[si + 1] = output[1];
        seedOut[si + 2] = output[2];
        si += 3;
      }
    }
  }

  // Voxel grid over the OUTPUT space, so finding the nearest seed for a target
  // is a local search rather than a scan of every seed. Without this, inverting
  // a 33-point LUT would be over a billion distance computations.
  const GRID = 24;
  const cellOf = (v: number) => Math.min(GRID - 1, Math.max(0, Math.floor(v * GRID)));
  const buckets: number[][] = Array.from({ length: GRID * GRID * GRID }, () => []);
  for (let i = 0; i < seedCount; i++) {
    const o = i * 3;
    const key =
      cellOf(seedOut[o]) * GRID * GRID + cellOf(seedOut[o + 1]) * GRID + cellOf(seedOut[o + 2]);
    buckets[key].push(i);
  }

  /** Nearest seed index to `target` in output space, widening the search ring. */
  const nearestSeed = (target: RGB): number => {
    const cr = cellOf(target[0]);
    const cg = cellOf(target[1]);
    const cb = cellOf(target[2]);
    let best = -1;
    let bestD = Infinity;

    for (let ring = 0; ring < GRID; ring++) {
      for (let dr = -ring; dr <= ring; dr++) {
        for (let dg = -ring; dg <= ring; dg++) {
          for (let db = -ring; db <= ring; db++) {
            // Only the shell of this ring; inner cells were covered already.
            if (Math.max(Math.abs(dr), Math.abs(dg), Math.abs(db)) !== ring) continue;
            const r = cr + dr;
            const g = cg + dg;
            const b = cb + db;
            if (r < 0 || g < 0 || b < 0 || r >= GRID || g >= GRID || b >= GRID) continue;
            for (const i of buckets[r * GRID * GRID + g * GRID + b]) {
              const o = i * 3;
              const d =
                (seedOut[o] - target[0]) ** 2 +
                (seedOut[o + 1] - target[1]) ** 2 +
                (seedOut[o + 2] - target[2]) ** 2;
              if (d < bestD) {
                bestD = d;
                best = i;
              }
            }
          }
        }
      }
      // One extra ring past the first hit, since a diagonal neighbour can be
      // closer than something found in the current shell.
      if (best >= 0 && ring > 0) break;
    }
    return best < 0 ? 0 : best;
  };

  // Distinct inputs landing on the same output means no exact inverse exists.
  let nonInjective = false;
  const seen = new Set<string>();
  for (let i = 0; i < seedCount; i++) {
    const o = i * 3;
    const key = `${Math.round(seedOut[o] * 512)},${Math.round(seedOut[o + 1] * 512)},${Math.round(seedOut[o + 2] * 512)}`;
    if (seen.has(key)) {
      nonInjective = true;
      break;
    }
    seen.add(key);
  }

  const out = derive(lut, size, 3);
  out.meta = {
    ...lut.meta,
    title: lut.meta.title ? `${lut.meta.title} (inverse)` : '',
    // The inverse runs the other way round.
    inputCS: lut.meta.outputCS,
    outputCS: lut.meta.inputCS,
  };

  const step = size > 1 ? 1 / (size - 1) : 0;
  let maxError = 0;
  let totalError = 0;
  let count = 0;

  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        const target: RGB = [r * step, g * step, b * step];

        const seed = nearestSeed(target) * 3;
        const x: RGB = [seedIn[seed], seedIn[seed + 1], seedIn[seed + 2]];
        const h = 1 / 512;

        // Gauss-Newton with a finite-difference Jacobian.
        for (let iter = 0; iter < 12; iter++) {
          const fx = sampleLut(lut, x, mode);
          const err: RGB = [
            target[0] - fx[0],
            target[1] - fx[1],
            target[2] - fx[2],
          ];
          const mag = Math.hypot(err[0], err[1], err[2]);
          if (mag < 1e-5) break;

          const J: number[][] = [];
          for (let c = 0; c < 3; c++) {
            const xp: RGB = [...x] as RGB;
            xp[c] = Math.min(1, x[c] + h);
            const xm: RGB = [...x] as RGB;
            xm[c] = Math.max(0, x[c] - h);
            const fp = sampleLut(lut, xp, mode);
            const fm = sampleLut(lut, xm, mode);
            const d = xp[c] - xm[c] || h;
            J.push([(fp[0] - fm[0]) / d, (fp[1] - fm[1]) / d, (fp[2] - fm[2]) / d]);
          }

          // Solve J^T * delta = err. J is stored column-major (J[c] = d f / d x_c).
          const a = [
            [J[0][0], J[1][0], J[2][0]],
            [J[0][1], J[1][1], J[2][1]],
            [J[0][2], J[1][2], J[2][2]],
          ];
          const delta = solve3(a, err);
          if (!delta) break;

          // Damped step, kept inside the domain.
          let moved = false;
          for (let c = 0; c < 3; c++) {
            const next = Math.max(0, Math.min(1, x[c] + delta[c] * 0.8));
            if (Math.abs(next - x[c]) > 1e-9) moved = true;
            x[c] = next;
          }
          if (!moved) break;
        }

        const check = sampleLut(lut, x, mode);
        const residual = Math.max(
          Math.abs(check[0] - target[0]),
          Math.abs(check[1] - target[1]),
          Math.abs(check[2] - target[2]),
        );
        if (residual > maxError) maxError = residual;
        totalError += residual;
        count++;

        setSample(out, index3D(size, r, g, b), x);
      }
    }
  }

  return {
    lut: out,
    maxError,
    meanError: count ? totalError / count : 0,
    nonInjective,
  };
}

/** Cramer's rule for a 3x3 system; null when the matrix is near-singular. */
function solve3(a: number[][], b: RGB): RGB | null {
  const det =
    a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) -
    a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0]) +
    a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0]);
  if (Math.abs(det) < 1e-12) return null;

  const col = (i: number, v: RGB): number[][] =>
    a.map((row, r) => row.map((x, c) => (c === i ? v[r] : x)));

  const d = (m: number[][]): number =>
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);

  return [d(col(0, b)) / det, d(col(1, b)) / det, d(col(2, b)) / det];
}

export { createIdentity };
