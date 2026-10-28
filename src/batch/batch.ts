/**
 * Batch model: a queue of parsed LUTs sharing one set of header fields and one
 * filename template. This is the "shipping a look package" workflow — stamp
 * forty files consistently, see which ones are broken, export the lot.
 */

import { type Lut } from '../core/lut.js';
import { type Check, type Metrics, analyze, runChecks } from '../core/analyze.js';
import { type ParseIssue, parseCube, writeCube } from '../format/cube.js';
import {
  type LookKind,
  applyTemplate,
  csToken,
  exposureToken,
  libraryFolder,
  normalizeStops,
  pascalCase,
  stopsFromName,
} from '../core/naming.js';

export interface BatchEntry {
  id: string;
  fileName: string;
  fileSize: number;
  lut: Lut;
  parseIssues: ParseIssue[];
  checks: Check[];
  metrics: Metrics;
  /** Per-file look name; defaults to the LUT's title or its filename. */
  look: string;
  /** Excluded from export when false. */
  included: boolean;
  /**
   * This file's own values, used for any field not shared across the batch.
   * Seeded from its header (exposure falls back to a token in the filename).
   */
  own: SharedFields;
}

/** Header fields stamped on each file — shared across the batch or per file. */
export interface SharedFields {
  author: string;
  date: string;
  project: string;
  notes: string;
  expShift: string;
  inputCS: string;
  outputCS: string;
}

export type FieldKey = keyof SharedFields;

export const FIELD_KEYS: readonly FieldKey[] = [
  'author', 'date', 'project', 'notes', 'expShift', 'inputCS', 'outputCS',
];

/**
 * The fields one entry is written with: shared values for the keys in
 * `sharedKeys`, the entry's own values for the rest.
 */
export function resolveFields(
  entry: BatchEntry,
  shared: SharedFields,
  sharedKeys: ReadonlySet<FieldKey> = new Set(FIELD_KEYS),
): SharedFields {
  const out = { ...shared };
  for (const key of FIELD_KEYS) if (!sharedKeys.has(key)) out[key] = entry.own[key];
  return out;
}

export interface BatchSettings {
  template: string;
  lookKind: LookKind;
  /** Lay the zip out as ColorLibrary folders rather than a flat list. */
  useFolders: boolean;
}

export const worstLevel = (entry: BatchEntry): 'error' | 'warning' | 'ok' => {
  const all = [...entry.parseIssues, ...entry.checks];
  if (all.some((i) => i.level === 'error')) return 'error';
  if (all.some((i) => i.level === 'warning')) return 'warning';
  return 'ok';
};

let nextId = 0;

export async function makeEntry(file: File): Promise<BatchEntry> {
  const { lut, issues } = parseCube(await file.text());
  const metrics = analyze(lut);
  return {
    id: `e${nextId++}`,
    fileName: file.name,
    fileSize: file.size,
    lut,
    parseIssues: issues,
    checks: runChecks(lut, metrics),
    metrics,
    look: lut.meta.title || file.name.replace(/\.[^.]+$/, ''),
    included: true,
    own: {
      author: lut.meta.author,
      date: lut.meta.date,
      project: lut.meta.project,
      notes: lut.meta.notes,
      expShift:
        (lut.meta.expShift && normalizeStops(lut.meta.expShift)) || stopsFromName(file.name),
      inputCS: lut.meta.inputCS,
      outputCS: lut.meta.outputCS,
    },
  };
}

/**
 * Push shared fields onto an entry's model. Per-file look name becomes TITLE.
 * Never touches sample data.
 */
export function stamp(entry: BatchEntry, shared: SharedFields): void {
  const exp = normalizeStops(shared.expShift) ?? '0';
  entry.lut.meta = {
    title: entry.look,
    author: shared.author,
    date: shared.date,
    project: shared.project,
    notes: shared.notes,
    expShift: exp && exp !== '0' ? `${exp} stops` : '',
    inputCS: shared.inputCS,
    outputCS: shared.outputCS,
  };
}

export function outputName(
  entry: BatchEntry,
  shared: SharedFields,
  settings: BatchSettings,
  index: number,
): string {
  const source = csToken(shared.inputCS);
  const dest = csToken(shared.outputCS);
  const base = applyTemplate(settings.template, {
    look: pascalCase(entry.look),
    source,
    dest,
    exp: exposureToken(shared.expShift),
    size: String(entry.lut.size),
    date: shared.date.replace(/-/g, ''),
    project: pascalCase(shared.project),
    author: pascalCase(shared.author),
    index: String(index + 1).padStart(2, '0'),
    srcname: pascalCase(entry.fileName.replace(/\.[^.]+$/, '')),
  });
  return `${base || 'Output'}.cube`;
}

export function outputPath(
  entry: BatchEntry,
  shared: SharedFields,
  settings: BatchSettings,
  index: number,
): string {
  const name = outputName(entry, shared, settings, index);
  if (!settings.useFolders) return name;
  const folder = libraryFolder(
    csToken(shared.inputCS),
    csToken(shared.outputCS),
    settings.lookKind,
  );
  return `${folder}/${name}`;
}

/**
 * Render every included entry. Returns path -> file contents; duplicate paths
 * get a numeric suffix so nothing is silently overwritten inside the zip.
 */
export function renderBatch(
  entries: BatchEntry[],
  shared: SharedFields,
  settings: BatchSettings,
  sharedKeys?: ReadonlySet<FieldKey>,
): Map<string, string> {
  const out = new Map<string, string>();
  const included = entries.filter((e) => e.included);

  included.forEach((entry, i) => {
    const fields = resolveFields(entry, shared, sharedKeys);
    stamp(entry, fields);
    let path = outputPath(entry, fields, settings, i);
    if (out.has(path)) {
      const dot = path.lastIndexOf('.');
      const stem = path.slice(0, dot);
      const ext = path.slice(dot);
      let n = 2;
      while (out.has(`${stem}_${String(n).padStart(2, '0')}${ext}`)) n++;
      path = `${stem}_${String(n).padStart(2, '0')}${ext}`;
    }
    out.set(path, writeCube(entry.lut));
  });

  return out;
}
