/**
 * CPU LUT sampling. Mirrors the shader in src/render/preview.ts, and is the
 * basis for the operations that resample or concatenate LUTs.
 */

import { type Lut, type RGB, index3D } from './lut.js';

export type Interpolation = 'tetrahedral' | 'trilinear';

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

function corner(lut: Lut, r: number, g: number, b: number): RGB {
  const n = lut.size;
  const ri = r < 0 ? 0 : r > n - 1 ? n - 1 : r;
  const gi = g < 0 ? 0 : g > n - 1 ? n - 1 : g;
  const bi = b < 0 ? 0 : b > n - 1 ? n - 1 : b;
  const o = index3D(n, ri, gi, bi) * 3;
  return [lut.data[o], lut.data[o + 1], lut.data[o + 2]];
}

const add = (a: RGB, b: RGB, k: number): RGB => [
  a[0] + b[0] * k,
  a[1] + b[1] * k,
  a[2] + b[2] * k,
];

const sub = (a: RGB, b: RGB): RGB => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

const lerp = (a: RGB, b: RGB, t: number): RGB => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

/** Per-channel 1D lookup with linear interpolation. */
function sample1D(lut: Lut, rgb: RGB): RGB {
  const n = lut.size;
  const out: RGB = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const p = clamp01(rgb[c]) * (n - 1);
    const i = Math.min(n - 2, Math.max(0, Math.floor(p)));
    const f = p - i;
    const a = lut.data[i * 3 + c];
    const b = lut.data[(i + 1) * 3 + c];
    out[c] = a + (b - a) * f;
  }
  return out;
}

function trilinear(lut: Lut, p: RGB): RGB {
  const i = [Math.floor(p[0]), Math.floor(p[1]), Math.floor(p[2])];
  const f = [p[0] - i[0], p[1] - i[1], p[2] - i[2]];

  const c000 = corner(lut, i[0], i[1], i[2]);
  const c100 = corner(lut, i[0] + 1, i[1], i[2]);
  const c010 = corner(lut, i[0], i[1] + 1, i[2]);
  const c110 = corner(lut, i[0] + 1, i[1] + 1, i[2]);
  const c001 = corner(lut, i[0], i[1], i[2] + 1);
  const c101 = corner(lut, i[0] + 1, i[1], i[2] + 1);
  const c011 = corner(lut, i[0], i[1] + 1, i[2] + 1);
  const c111 = corner(lut, i[0] + 1, i[1] + 1, i[2] + 1);

  return lerp(
    lerp(lerp(c000, c100, f[0]), lerp(c010, c110, f[0]), f[1]),
    lerp(lerp(c001, c101, f[0]), lerp(c011, c111, f[0]), f[1]),
    f[2],
  );
}

/**
 * Tetrahedral interpolation — the six-tetrahedron decomposition of the unit
 * cell used by Resolve and most LUT hardware. Differs from trilinear inside
 * the cell, most visibly on saturated colors.
 */
function tetrahedral(lut: Lut, p: RGB): RGB {
  const i = [Math.floor(p[0]), Math.floor(p[1]), Math.floor(p[2])];
  const fx = p[0] - i[0];
  const fy = p[1] - i[1];
  const fz = p[2] - i[2];

  const c000 = corner(lut, i[0], i[1], i[2]);
  const c111 = corner(lut, i[0] + 1, i[1] + 1, i[2] + 1);

  if (fx > fy) {
    if (fy > fz) {
      const c100 = corner(lut, i[0] + 1, i[1], i[2]);
      const c110 = corner(lut, i[0] + 1, i[1] + 1, i[2]);
      let r = add(c000, sub(c100, c000), fx);
      r = add(r, sub(c110, c100), fy);
      return add(r, sub(c111, c110), fz);
    }
    if (fx > fz) {
      const c100 = corner(lut, i[0] + 1, i[1], i[2]);
      const c101 = corner(lut, i[0] + 1, i[1], i[2] + 1);
      let r = add(c000, sub(c100, c000), fx);
      r = add(r, sub(c111, c101), fy);
      return add(r, sub(c101, c100), fz);
    }
    const c001 = corner(lut, i[0], i[1], i[2] + 1);
    const c101 = corner(lut, i[0] + 1, i[1], i[2] + 1);
    let r = add(c000, sub(c101, c001), fx);
    r = add(r, sub(c111, c101), fy);
    return add(r, sub(c001, c000), fz);
  }

  if (fz > fy) {
    const c001 = corner(lut, i[0], i[1], i[2] + 1);
    const c011 = corner(lut, i[0], i[1] + 1, i[2] + 1);
    let r = add(c000, sub(c111, c011), fx);
    r = add(r, sub(c011, c001), fy);
    return add(r, sub(c001, c000), fz);
  }
  if (fz > fx) {
    const c010 = corner(lut, i[0], i[1] + 1, i[2]);
    const c011 = corner(lut, i[0], i[1] + 1, i[2] + 1);
    let r = add(c000, sub(c111, c011), fx);
    r = add(r, sub(c010, c000), fy);
    return add(r, sub(c011, c010), fz);
  }
  const c010 = corner(lut, i[0], i[1] + 1, i[2]);
  const c110 = corner(lut, i[0] + 1, i[1] + 1, i[2]);
  let r = add(c000, sub(c110, c010), fx);
  r = add(r, sub(c010, c000), fy);
  return add(r, sub(c111, c110), fz);
}

/** Apply a LUT to one RGB triplet, honouring its domain. */
export function sampleLut(
  lut: Lut,
  rgb: RGB,
  mode: Interpolation = 'tetrahedral',
): RGB {
  if (lut.dims === 1) return sample1D(lut, rgb);

  const n = lut.size;
  const p: RGB = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const span = lut.domainMax[c] - lut.domainMin[c];
    const norm = span > 1e-9 ? (rgb[c] - lut.domainMin[c]) / span : 0;
    p[c] = clamp01(norm) * (n - 1);
  }

  return mode === 'trilinear' ? trilinear(lut, p) : tetrahedral(lut, p);
}
