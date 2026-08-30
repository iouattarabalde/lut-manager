/**
 * Plain-English description of what a LUT does.
 *
 * The point is to be able to say out loud what a look is doing — to a
 * director or a DP who does not care about slope figures. Everything here
 * turns a measurement into the words a colorist would actually use.
 */

import { type Lut, type RGB } from './lut.js';
import { type Metrics, analyze } from './analyze.js';
import { sampleLut } from './sample.js';

export interface Zone {
  name: string;
  /** Where the zone sits on the input ramp. */
  t: number;
  input: RGB;
  output: RGB;
  /** Output level minus input level, as a fraction of full range. */
  levelShift: number;
  /** "warmer", "cooler", "greener", "more magenta", or "neutral". */
  tint: string;
  /** How strong that tint is: none | slight | clear | strong. */
  tintStrength: string;
}

export interface Description {
  /** One sentence covering the dominant behaviour. */
  headline: string;
  /** Supporting observations, most significant first. */
  points: string[];
  zones: Zone[];
}

export const ZONE_POINTS: [string, number][] = [
  ['Shadows', 0.2],
  ['Midtones', 0.5],
  ['Highlights', 0.8],
];

function tintOf(input: RGB, output: RGB): { tint: string; strength: string; amount: number } {
  // Measured against the change in overall level, so a simple brightness
  // move is not mistaken for a colour shift.
  const inMean = (input[0] + input[1] + input[2]) / 3;
  const outMean = (output[0] + output[1] + output[2]) / 3;
  const d = output.map((v, i) => v - outMean - (input[i] - inMean));

  const warm = d[0] - d[2];
  const green = d[1] - (d[0] + d[2]) / 2;

  const amount = Math.max(Math.abs(warm), Math.abs(green));
  let tint = 'neutral';
  if (amount >= 0.004) {
    tint = Math.abs(warm) >= Math.abs(green)
      ? warm > 0 ? 'warmer' : 'cooler'
      : green > 0 ? 'greener' : 'more magenta';
  }

  const strength =
    amount < 0.004 ? 'none' : amount < 0.015 ? 'slight' : amount < 0.045 ? 'clear' : 'strong';

  return { tint, strength, amount };
}

export function readZones(lut: Lut): Zone[] {
  return ZONE_POINTS.map(([name, t]) => {
    const input: RGB = [t, t, t];
    const output = sampleLut(lut, input);
    const outMean = (output[0] + output[1] + output[2]) / 3;
    const { tint, strength } = tintOf(input, output);
    return {
      name,
      t,
      input,
      output,
      levelShift: outMean - t,
      tint,
      tintStrength: strength,
    };
  });
}

const pct = (v: number): string => `${Math.round(Math.abs(v) * 100)}%`;

function contrastPhrase(slope: number): string | null {
  if (slope > 1.8) return 'adds hard contrast';
  if (slope > 1.35) return 'adds strong contrast';
  if (slope > 1.12) return 'adds contrast';
  if (slope > 0.92) return null;
  if (slope > 0.7) return 'softens contrast';
  return 'flattens the image out';
}

function saturationPhrase(ratio: number): string | null {
  if (ratio > 1.35) return 'pushes colour hard';
  if (ratio > 1.12) return 'adds saturation';
  if (ratio > 0.92) return null;
  if (ratio > 0.7) return 'pulls saturation back';
  return 'takes most of the colour out';
}

export function describe(lut: Lut, metrics: Metrics = analyze(lut)): Description {
  const zones = readZones(lut);
  const [shadows, mids, highs] = zones;
  const points: string[] = [];

  if (metrics.isIdentity) {
    return {
      headline: 'This LUT does nothing — the image comes out exactly as it went in.',
      points: [],
      zones,
    };
  }

  // The headline takes the two strongest of contrast, colour and saturation.
  const clauses: string[] = [];
  const contrast = contrastPhrase(metrics.midSlope);
  if (contrast) clauses.push(contrast);

  if (mids.tint !== 'neutral' && mids.tintStrength !== 'slight') {
    clauses.push(`makes the midtones ${mids.tint}`);
  }
  const sat = saturationPhrase(metrics.saturation);
  if (sat && clauses.length < 2) clauses.push(sat);

  if (!clauses.length) clauses.push('makes a subtle adjustment');

  const headline =
    clauses.length === 1
      ? `This LUT ${clauses[0]}.`
      : `This LUT ${clauses.slice(0, -1).join(', ')} and ${clauses[clauses.length - 1]}.`;

  // Shadows.
  if (metrics.blackPoint[0] > 0.04) {
    points.push(
      `Lifts the blacks to ${pct(metrics.blackPoint[0])} — a milky, filmic shadow rather than true black.`,
    );
  } else if (metrics.clippedLow > 0.02) {
    points.push(
      `Crushes ${pct(metrics.clippedLow)} of the shadows to pure black — detail down there is gone.`,
    );
  } else {
    points.push('Holds the blacks at zero.');
  }

  // Highlights.
  if (metrics.clippedHigh > 0.02) {
    points.push(
      `Clips ${pct(metrics.clippedHigh)} of the highlights — anything that bright reads as flat white.`,
    );
  } else if (metrics.whitePoint[0] < 0.95) {
    points.push(
      `Rolls the highlights off to ${pct(metrics.whitePoint[0])} rather than letting them hit white.`,
    );
  } else {
    points.push('Takes highlights all the way to white.');
  }

  // Zone-by-zone colour, only where it is actually visible.
  const coloured = zones.filter((z) => z.tint !== 'neutral' && z.tintStrength !== 'slight');
  if (coloured.length) {
    points.push(
      coloured
        .map((z) => `${z.name.toLowerCase()} go ${z.tint}`)
        .join(', ')
        .replace(/^./, (c) => c.toUpperCase()) + '.',
    );
  } else {
    points.push('Colour stays essentially neutral through the range.');
  }

  if (sat) {
    points.push(
      `${sat.replace(/^./, (c) => c.toUpperCase())} — saturation is about ${Math.round(metrics.saturation * 100)}% of the original.`,
    );
  }

  // Exposure feel, if any zone moved appreciably.
  const biggest = zones.reduce((a, b) => (Math.abs(b.levelShift) > Math.abs(a.levelShift) ? b : a));
  if (Math.abs(biggest.levelShift) > 0.06) {
    points.push(
      `${biggest.name} move the most — ${biggest.levelShift > 0 ? 'up' : 'down'} about ${pct(biggest.levelShift)}.`,
    );
  }

  if (!metrics.neutralMonotonic) {
    points.push('Warning: the tone curve reverses direction, which can band or posterise.');
  }

  return { headline, points, zones };
}
