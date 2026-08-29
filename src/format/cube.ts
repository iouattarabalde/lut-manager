/**
 * Iridas `.cube` reader and writer, for both 1D and 3D LUTs.
 *
 * Two guarantees this module exists to provide:
 *   1. Any header line we do not recognise survives a round-trip verbatim.
 *      The previous implementation rebuilt the header from scratch and kept
 *      only LUT_3D_SIZE / DOMAIN_MIN / DOMAIN_MAX, which silently destroyed
 *      LUT_1D_SIZE (producing an unloadable file) and LUT_3D_INPUT_RANGE.
 *   2. A header-only edit leaves the data table byte-for-byte identical.
 */

import {
  type Dims,
  type Lut,
  type RGB,
  emptyMeta,
  sampleCount,
} from '../core/lut.js';

export interface ParseIssue {
  level: 'error' | 'warning';
  code: string;
  message: string;
  line?: number;
}

export interface ParseResult {
  lut: Lut;
  issues: ParseIssue[];
}

/** Managed `# Key: value` comments, in the order we emit them. */
const META_KEYS = [
  ['Author', 'author'],
  ['Date', 'date'],
  ['Project', 'project'],
  ['Notes', 'notes'],
  ['ExposureShift', 'expShift'],
  ['InputColorSpace', 'inputCS'],
  ['OutputColorSpace', 'outputCS'],
] as const;

const NUMBER = String.raw`[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?`;
const DATA_ROW = new RegExp(`^${NUMBER}\\s+${NUMBER}\\s+${NUMBER}\\s*$`);

function parseTriplet(s: string): RGB | null {
  const parts = s.trim().split(/\s+/);
  if (parts.length < 3) return null;
  const v = parts.slice(0, 3).map(Number);
  if (v.some((n) => !Number.isFinite(n))) return null;
  return [v[0], v[1], v[2]];
}

export function parseCube(text: string): ParseResult {
  const issues: ParseIssue[] = [];
  const lineEnding: '\n' | '\r\n' = text.includes('\r\n') ? '\r\n' : '\n';

  // Strip a BOM and normalise for scanning; `lineEnding` is what we write back.
  const lines = text.replace(/^﻿/, '').split(/\r\n|\r|\n/);

  const meta = emptyMeta();
  const passthrough: string[] = [];
  const rawData: string[] = [];
  const values: number[] = [];
  const unkeyedComments: string[] = [];
  const unkeyedIndices: number[] = [];

  let dims: Dims | null = null;
  let declaredSize: number | null = null;
  let domainMin: RGB = [0, 0, 0];
  let domainMax: RGB = [1, 1, 1];
  let sawDomainMin = false;
  let sawDomainMax = false;
  let seenTitle = false;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const t = raw.trim();
    if (!t) continue;

    // Data rows are the common case; test them first.
    if (DATA_ROW.test(t)) {
      const rgb = parseTriplet(t);
      if (rgb) {
        rawData.push(raw);
        values.push(rgb[0], rgb[1], rgb[2]);
        continue;
      }
    }

    const sizeMatch = t.match(/^LUT_(1D|3D)_SIZE\s+(\d+)\s*$/i);
    if (sizeMatch) {
      const thisDims: Dims = sizeMatch[1].toUpperCase() === '1D' ? 1 : 3;
      if (dims !== null && dims !== thisDims) {
        issues.push({
          level: 'error',
          code: 'mixed-dims',
          message: 'File declares both LUT_1D_SIZE and LUT_3D_SIZE.',
          line: i + 1,
        });
      }
      dims = thisDims;
      declaredSize = parseInt(sizeMatch[2], 10);
      continue;
    }

    if (/^TITLE\b/i.test(t)) {
      if (seenTitle) {
        issues.push({
          level: 'warning',
          code: 'duplicate-title',
          message: 'More than one TITLE line; keeping the last.',
          line: i + 1,
        });
      }
      const m = t.match(/^TITLE\s+"(.*)"\s*$/i) ?? t.match(/^TITLE\s+(.*)$/i);
      meta.title = m ? m[1].trim() : '';
      seenTitle = true;
      continue;
    }

    const domMatch = t.match(/^DOMAIN_(MIN|MAX)\s+(.*)$/i);
    if (domMatch) {
      const rgb = parseTriplet(domMatch[2]);
      if (!rgb) {
        issues.push({
          level: 'warning',
          code: 'bad-domain',
          message: `Could not parse ${t}; keeping the line but ignoring its value.`,
          line: i + 1,
        });
        passthrough.push(t);
      } else if (domMatch[1].toUpperCase() === 'MIN') {
        domainMin = rgb;
        sawDomainMin = true;
      } else {
        domainMax = rgb;
        sawDomainMax = true;
      }
      continue;
    }

    // Pre-1.0 spec: LUT_3D_INPUT_RANGE <min> <max>, equivalent to DOMAIN_*.
    const rangeMatch = t.match(/^LUT_(?:1D|3D)_INPUT_RANGE\s+(.*)$/i);
    if (rangeMatch) {
      const parts = rangeMatch[1].trim().split(/\s+/).map(Number);
      if (parts.length >= 2 && parts.every((n) => Number.isFinite(n))) {
        if (!sawDomainMin) domainMin = [parts[0], parts[0], parts[0]];
        if (!sawDomainMax) domainMax = [parts[1], parts[1], parts[1]];
        issues.push({
          level: 'warning',
          code: 'legacy-input-range',
          message:
            'File uses the legacy LUT_..._INPUT_RANGE keyword; it will be written as DOMAIN_MIN / DOMAIN_MAX.',
          line: i + 1,
        });
        continue;
      }
      passthrough.push(t);
      continue;
    }

    if (t.startsWith('#')) {
      const keyed = t.match(/^#\s*([A-Za-z][A-Za-z ]*?)\s*:\s*(.*)$/);
      const entry = keyed
        ? META_KEYS.find(([label]) => label.toLowerCase() === keyed[1].trim().toLowerCase())
        : undefined;
      if (keyed && entry) {
        const [, field] = entry;
        const value = keyed[2].trim();
        // Notes may span several `# Notes:` lines; re-join them.
        meta[field] = meta[field] ? `${meta[field]}\n${value}` : value;
      } else {
        // Recorded in both places for now; if these end up promoted into
        // Notes below, they are dropped from passthrough so the writer does
        // not emit them twice.
        unkeyedComments.push(t.replace(/^#\s?/, ''));
        passthrough.push(t);
        unkeyedIndices.push(passthrough.length - 1);
      }
      continue;
    }

    // Anything else is a keyword we do not model. Keep it verbatim.
    passthrough.push(t);
    issues.push({
      level: 'warning',
      code: 'unknown-keyword',
      message: `Unrecognised header line kept as-is: ${t}`,
      line: i + 1,
    });
  }

  if (dims === null || declaredSize === null) {
    issues.push({
      level: 'error',
      code: 'missing-size',
      message: 'No LUT_1D_SIZE or LUT_3D_SIZE keyword found.',
    });
    // Guess from the row count so the file is still inspectable.
    const rows = values.length / 3;
    const cubeRoot = Math.round(Math.cbrt(rows));
    if (cubeRoot >= 2 && cubeRoot ** 3 === rows) {
      dims = 3;
      declaredSize = cubeRoot;
    } else {
      dims = 1;
      declaredSize = rows;
    }
  }

  const expected = sampleCount(dims, declaredSize) * 3;
  if (values.length !== expected) {
    issues.push({
      level: 'error',
      code: 'size-mismatch',
      message:
        `LUT_${dims}D_SIZE ${declaredSize} needs ${expected / 3} rows, ` +
        `but the file has ${values.length / 3}.`,
    });
  }

  const data = new Float32Array(expected);
  data.set(values.slice(0, Math.min(values.length, expected)));

  // Unkeyed comments become Notes only when there is no explicit Notes field,
  // so we never fabricate metadata that overwrites something real. When they
  // are promoted, drop them from passthrough — otherwise the writer emits each
  // one twice, once as `# Notes:` and once verbatim.
  if (!meta.notes && unkeyedComments.length) {
    meta.notes = unkeyedComments.join('\n');
    for (const i of [...unkeyedIndices].reverse()) passthrough.splice(i, 1);
  }

  return {
    lut: {
      dims,
      size: declaredSize,
      data,
      domainMin,
      domainMax,
      meta,
      passthrough,
      // Only trustworthy as a verbatim copy when the table is complete.
      rawData: values.length === expected ? rawData : null,
      lineEnding,
    },
    issues,
  };
}

/**
 * `TITLE` is a quoted single-line string. A stray quote or newline in the
 * value produces a file that other tools mis-parse, so strip both and cap the
 * length — Resolve in particular is unhappy with very long titles.
 */
export const TITLE_MAX = 240;

export function sanitizeTitle(title: string): string {
  return title
    .replace(/[\r\n]+/g, ' ')
    .replace(/"/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, TITLE_MAX);
}

function formatSample(v: number): string {
  if (!Number.isFinite(v)) return '0.000000';
  return v.toFixed(6);
}

export function writeCube(lut: Lut): string {
  const out: string[] = [];

  const title = sanitizeTitle(lut.meta.title);
  if (title) out.push(`TITLE "${title}"`);

  for (const [label, field] of META_KEYS) {
    const value = lut.meta[field];
    if (!value) continue;
    // Every line gets its own `#`. Without this a multi-line Notes value
    // emits a bare line into the header, which corrupts the file.
    for (const line of String(value).split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed) out.push(`# ${label}: ${trimmed}`);
    }
  }

  for (const line of lut.passthrough) out.push(line);

  if (out.length) out.push('');

  out.push(`LUT_${lut.dims}D_SIZE ${lut.size}`);

  const isDefaultDomain =
    lut.domainMin.every((v) => v === 0) && lut.domainMax.every((v) => v === 1);
  if (!isDefaultDomain) {
    out.push(`DOMAIN_MIN ${lut.domainMin.map(formatSample).join(' ')}`);
    out.push(`DOMAIN_MAX ${lut.domainMax.map(formatSample).join(' ')}`);
  }

  out.push('');

  if (lut.rawData) {
    // Header-only edit: hand back the original rows untouched.
    for (const row of lut.rawData) out.push(row.replace(/[\r\n]+$/, ''));
  } else {
    const count = sampleCount(lut.dims, lut.size);
    for (let i = 0; i < count; i++) {
      const o = i * 3;
      out.push(
        `${formatSample(lut.data[o])} ${formatSample(lut.data[o + 1])} ${formatSample(lut.data[o + 2])}`,
      );
    }
  }

  return out.join(lut.lineEnding) + lut.lineEnding;
}
