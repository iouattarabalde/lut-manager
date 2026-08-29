/**
 * Transfer functions, for putting a preview source into the color space a LUT
 * expects.
 *
 * A still dropped in from Finder is display-referred (sRGB or Rec.709). A show
 * LUT expects camera log. Feeding one to the other without an encode shows you
 * something that is not what the LUT does, which is the classic way preview
 * tools mislead people — so this is explicit in the UI, never silent.
 *
 * Constants follow the manufacturers' published curves. Where a vendor
 * publishes several variants (ARRI's per-EI LogC3 curves, for instance) the
 * most common one is used and named in the comment.
 */

export type EncodingId =
  | 'linear'
  | 'srgb'
  | 'rec709'
  | 'logc3'
  | 'logc4'
  | 'slog3'
  | 'vlog'
  | 'log3g10'
  | 'davinci';

export interface Encoding {
  id: EncodingId;
  label: string;
  /** Scene-linear (1.0 = diffuse white) to this encoding's code values. */
  fromLinear: (x: number) => number;
  /** This encoding's code values back to scene-linear. */
  toLinear: (x: number) => number;
}

const log10 = (x: number) => Math.log(x) / Math.LN10;

/** ARRI LogC3, EI 800 — the published Alexa curve. */
const logc3 = {
  cut: 0.010591,
  a: 5.555556,
  b: 0.052272,
  c: 0.247190,
  d: 0.385537,
  e: 5.367655,
  f: 0.092809,
};

/** ARRI LogC4. */
const LOGC4_A = (Math.pow(2, 18) - 16) / 117.45;
const LOGC4_B = (1023 - 95) / 1023;
const LOGC4_C = 95 / 1023;
const LOGC4_S = (7 * Math.LN2 * Math.pow(2, 7 - (14 * LOGC4_C) / LOGC4_B)) / (LOGC4_A * LOGC4_B);
const LOGC4_T = (Math.pow(2, (14 * -LOGC4_C) / LOGC4_B + 6) - 64) / LOGC4_A;

export const ENCODINGS: Record<EncodingId, Encoding> = {
  linear: {
    id: 'linear',
    label: 'Scene linear',
    fromLinear: (x) => x,
    toLinear: (x) => x,
  },

  srgb: {
    id: 'srgb',
    label: 'sRGB',
    fromLinear: (x) =>
      x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(Math.max(x, 0), 1 / 2.4) - 0.055,
    toLinear: (x) =>
      x <= 0.04045 ? x / 12.92 : Math.pow((Math.max(x, 0) + 0.055) / 1.055, 2.4),
  },

  rec709: {
    id: 'rec709',
    label: 'Rec.709 (gamma 2.4)',
    fromLinear: (x) => Math.pow(Math.max(x, 0), 1 / 2.4),
    toLinear: (x) => Math.pow(Math.max(x, 0), 2.4),
  },

  logc3: {
    id: 'logc3',
    label: 'ARRI LogC3 (EI 800)',
    fromLinear: (x) =>
      x > logc3.cut
        ? logc3.c * log10(logc3.a * x + logc3.b) + logc3.d
        : logc3.e * x + logc3.f,
    toLinear: (x) =>
      x > logc3.e * logc3.cut + logc3.f
        ? (Math.pow(10, (x - logc3.d) / logc3.c) - logc3.b) / logc3.a
        : (x - logc3.f) / logc3.e,
  },

  logc4: {
    id: 'logc4',
    label: 'ARRI LogC4',
    fromLinear: (x) =>
      x < LOGC4_T
        ? (x - LOGC4_T) / LOGC4_S
        : ((Math.log2(LOGC4_A * x + 64) - 6) / 14) * LOGC4_B + LOGC4_C,
    toLinear: (x) =>
      x < 0
        ? x * LOGC4_S + LOGC4_T
        : (Math.pow(2, (14 * (x - LOGC4_C)) / LOGC4_B + 6) - 64) / LOGC4_A,
  },

  slog3: {
    id: 'slog3',
    label: 'Sony S-Log3',
    fromLinear: (x) =>
      x >= 0.01125
        ? (420 + log10((x + 0.01) / (0.18 + 0.01)) * 261.5) / 1023
        : (x * (171.2102946929 - 95)) / 0.01125 / 1023 + 95 / 1023,
    toLinear: (x) =>
      x >= 171.2102946929 / 1023
        ? Math.pow(10, ((x * 1023 - 420) / 261.5)) * (0.18 + 0.01) - 0.01
        : ((x * 1023 - 95) * 0.01125) / (171.2102946929 - 95),
  },

  vlog: {
    id: 'vlog',
    label: 'Panasonic V-Log',
    fromLinear: (x) =>
      x < 0.01 ? 5.6 * x + 0.125 : 0.241514 * log10(x + 0.00873) + 0.598206,
    toLinear: (x) =>
      x < 0.181 ? (x - 0.125) / 5.6 : Math.pow(10, (x - 0.598206) / 0.241514) - 0.00873,
  },

  log3g10: {
    id: 'log3g10',
    label: 'RED Log3G10',
    fromLinear: (x) => {
      const s = x + 0.01;
      return s < 0 ? s * 15.1927 : 0.224282 * log10(s * 155.975327 + 1);
    },
    toLinear: (x) =>
      (x < 0 ? x / 15.1927 : (Math.pow(10, x / 0.224282) - 1) / 155.975327) - 0.01,
  },

  davinci: {
    id: 'davinci',
    label: 'DaVinci Intermediate',
    fromLinear: (x) =>
      x <= 0.00262409
        ? x * 10.44426855
        : (Math.log2(x + 0.0075) + 7) * 0.07329248,
    toLinear: (x) =>
      x <= 0.02740668
        ? x / 10.44426855
        : Math.pow(2, x / 0.07329248 - 7) - 0.0075,
  },
};

/** Encoding a LUT's declared InputColorSpace implies, if we recognise one. */
export function encodingForColorSpace(label: string): EncodingId | null {
  if (!label) return null;
  const l = label.toLowerCase();
  if (l.includes('logc4')) return 'logc4';
  if (l.includes('logc3') || l.includes('logc')) return 'logc3';
  if (l.includes('s-log3') || l.includes('slog3')) return 'slog3';
  if (l.includes('v-log') || l.includes('vlog')) return 'vlog';
  if (l.includes('log3g10')) return 'log3g10';
  if (l.includes('davinci intermediate')) return 'davinci';
  if (l.includes('linear')) return 'linear';
  if (l.startsWith('srgb')) return 'srgb';
  if (l.includes('rec.709') || l.includes('rec709')) return 'rec709';
  return null;
}

export const ENCODING_LIST: Encoding[] = [
  ENCODINGS.linear,
  ENCODINGS.srgb,
  ENCODINGS.rec709,
  ENCODINGS.logc3,
  ENCODINGS.logc4,
  ENCODINGS.slog3,
  ENCODINGS.vlog,
  ENCODINGS.log3g10,
  ENCODINGS.davinci,
];
