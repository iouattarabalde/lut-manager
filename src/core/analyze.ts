/**
 * Delivery QC. These are the checks worth running before a look package goes
 * out: things that make a LUT fail to load, grade badly, or not fit the
 * hardware it is headed for.
 */

import { type Lut, getSample, index3D, lutSampleCount, neutralAxis } from './lut.js';

export interface Check {
  level: 'error' | 'warning' | 'info';
  code: string;
  message: string;
}

export interface Metrics {
  /** Fraction of samples pinned at or below 0 / at or above 1. */
  clippedLow: number;
  clippedHigh: number;
  /** Output at the darkest and brightest neutral input. */
  blackPoint: [number, number, number];
  whitePoint: [number, number, number];
  /** Neutral output at the middle of the input range. */
  midPoint: [number, number, number];
  /** Slope of the neutral curve around mid — a contrast proxy. */
  midSlope: number;
  /** True when the LUT is (within tolerance) a no-op. */
  isIdentity: boolean;
  /** True when no sample depends on a channel other than its own. */
  isChannelIndependent: boolean;
  /** Neutral axis never decreases. */
  neutralMonotonic: boolean;
  /** Largest deviation from the identity transform, per channel, 0..1. */
  maxDeviation: number;
}

const EPS = 1e-4;

export function analyze(lut: Lut): Metrics {
  const count = lutSampleCount(lut);
  const n = lut.size;
  const step = n > 1 ? 1 / (n - 1) : 0;

  let clippedLow = 0;
  let clippedHigh = 0;
  let maxDeviation = 0;
  let isIdentity = true;

  for (let i = 0; i < count; i++) {
    const [r, g, b] = getSample(lut, i);
    for (const v of [r, g, b]) {
      if (v <= 0) clippedLow++;
      if (v >= 1) clippedHigh++;
    }
    // Expected identity output for this sample position.
    let er: number, eg: number, eb: number;
    if (lut.dims === 1) {
      er = eg = eb = i * step;
    } else {
      const ri = i % n;
      const gi = Math.floor(i / n) % n;
      const bi = Math.floor(i / (n * n));
      er = ri * step;
      eg = gi * step;
      eb = bi * step;
    }
    const dev = Math.max(Math.abs(r - er), Math.abs(g - eg), Math.abs(b - eb));
    if (dev > maxDeviation) maxDeviation = dev;
    if (dev > EPS) isIdentity = false;
  }

  const axis = neutralAxis(lut);
  const blackPoint = axis.length ? axis[0].rgb : [0, 0, 0];
  const whitePoint = axis.length ? axis[axis.length - 1].rgb : [1, 1, 1];
  const mid = axis[Math.floor(axis.length / 2)];
  const midPoint = mid ? mid.rgb : [0.5, 0.5, 0.5];

  // Central difference of neutral luma around the midpoint.
  let midSlope = 1;
  const m = Math.floor(axis.length / 2);
  if (axis.length >= 3 && m > 0 && m < axis.length - 1) {
    const luma = (i: number) =>
      (axis[i].rgb[0] + axis[i].rgb[1] + axis[i].rgb[2]) / 3;
    const dt = axis[m + 1].t - axis[m - 1].t;
    if (dt > 0) midSlope = (luma(m + 1) - luma(m - 1)) / dt;
  }

  let neutralMonotonic = true;
  for (let i = 1; i < axis.length; i++) {
    const prev = (axis[i - 1].rgb[0] + axis[i - 1].rgb[1] + axis[i - 1].rgb[2]) / 3;
    const cur = (axis[i].rgb[0] + axis[i].rgb[1] + axis[i].rgb[2]) / 3;
    if (cur < prev - EPS) {
      neutralMonotonic = false;
      break;
    }
  }

  return {
    clippedLow: clippedLow / (count * 3),
    clippedHigh: clippedHigh / (count * 3),
    blackPoint: blackPoint as [number, number, number],
    whitePoint: whitePoint as [number, number, number],
    midPoint: midPoint as [number, number, number],
    midSlope,
    isIdentity,
    isChannelIndependent: lut.dims === 1 || isChannelIndependent(lut),
    neutralMonotonic,
    maxDeviation,
  };
}

/**
 * A 3D LUT does no cross-channel work when each output channel depends only on
 * its own input axis — in which case it carries size^3 samples to express what
 * size samples would. Tested by comparing every sample against the value
 * predicted from the three axis ramps.
 */
function isChannelIndependent(lut: Lut): boolean {
  const n = lut.size;
  if (n < 2) return true;

  // Response of each channel along its own axis, other channels at 0.
  const rRamp: number[] = [];
  const gRamp: number[] = [];
  const bRamp: number[] = [];
  for (let i = 0; i < n; i++) {
    rRamp.push(getSample(lut, index3D(n, i, 0, 0))[0]);
    gRamp.push(getSample(lut, index3D(n, 0, i, 0))[1]);
    bRamp.push(getSample(lut, index3D(n, 0, 0, i))[2]);
  }

  const base = getSample(lut, index3D(n, 0, 0, 0));
  for (let b = 0; b < n; b++) {
    for (let g = 0; g < n; g++) {
      for (let r = 0; r < n; r++) {
        const [sr, sg, sb] = getSample(lut, index3D(n, r, g, b));
        // Channel-independent means each output equals its own ramp; the
        // shared black offset is counted once, not three times.
        if (Math.abs(sr - rRamp[r]) > EPS) return false;
        if (Math.abs(sg - gRamp[g]) > EPS) return false;
        if (Math.abs(sb - bRamp[b]) > EPS) return false;
      }
    }
  }
  void base;
  return true;
}

/** Sizes that on-set boxes and camera monitor paths reliably accept. */
const HARDWARE_SIZES = new Set([17, 33, 65]);

export function runChecks(lut: Lut, metrics = analyze(lut)): Check[] {
  const checks: Check[] = [];

  if (metrics.isIdentity) {
    checks.push({
      level: 'warning',
      code: 'identity',
      message: 'This LUT is an identity transform — it does nothing.',
    });
  }

  if (!metrics.neutralMonotonic) {
    checks.push({
      level: 'warning',
      code: 'non-monotonic',
      message:
        'The neutral axis reverses direction, which usually shows as banding or posterisation.',
    });
  }

  const clipHigh = metrics.clippedHigh;
  const clipLow = metrics.clippedLow;
  if (clipHigh > 0.02) {
    checks.push({
      level: 'warning',
      code: 'clipping-high',
      message: `${pct(clipHigh)} of output values are at or above 1.0 — highlights are clipped.`,
    });
  }
  if (clipLow > 0.02) {
    checks.push({
      level: 'warning',
      code: 'clipping-low',
      message: `${pct(clipLow)} of output values are at or below 0.0 — shadows are crushed.`,
    });
  }

  if (lut.dims === 3 && metrics.isChannelIndependent && !metrics.isIdentity) {
    checks.push({
      level: 'info',
      code: 'reducible-to-1d',
      message:
        'No cross-channel work — this could ship as a much smaller 1D LUT.',
    });
  }

  if (lut.dims === 3 && !HARDWARE_SIZES.has(lut.size)) {
    checks.push({
      level: 'warning',
      code: 'unusual-size',
      message: `Size ${lut.size} is outside 17 / 33 / 65; some LUT boxes and camera monitor paths will reject it.`,
    });
  }

  const domainDefault =
    lut.domainMin.every((v) => v === 0) && lut.domainMax.every((v) => v === 1);
  if (!domainDefault) {
    checks.push({
      level: 'info',
      code: 'non-default-domain',
      message: `Domain is ${fmt(lut.domainMin)} to ${fmt(lut.domainMax)}, not 0-1. Some applications ignore DOMAIN_* entirely.`,
    });
  }

  if (!lut.meta.title) {
    checks.push({
      level: 'info',
      code: 'no-title',
      message: 'No TITLE — some applications will show the filename instead.',
    });
  }

  return checks;
}

const pct = (v: number): string =>
  v >= 0.01 ? `${(v * 100).toFixed(1)}%` : `${(v * 100).toFixed(2)}%`;

const fmt = (v: number[]): string => v.map((n) => n.toFixed(2)).join('/');
