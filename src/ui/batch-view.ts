/**
 * Batch panel: the "stamp and ship a look package" view. Active whenever more
 * than one file is in the queue.
 */

import { zipSync, strToU8 } from 'fflate';
import {
  type BatchEntry,
  type BatchSettings,
  type FieldKey,
  type SharedFields,
  FIELD_KEYS,
  makeEntry,
  resolveFields,
  outputPath,
  renderBatch,
  stamp,
  worstLevel,
} from '../batch/batch.js';
import { DEFAULT_TEMPLATE, TEMPLATE_TOKENS } from '../core/naming.js';
import { type LookKind } from '../core/naming.js';
import { $, download, esc, fmtSize, setVal, toast, today, val } from './dom.js';
import { buildLookSheet, type LookSheetTile } from '../batch/looksheet.js';
import { renderThumbnail } from '../render/offscreen.js';
import { CHARTS, type ChartId, renderChart } from '../render/charts.js';
import { stillSource } from './preview-view.js';
import { encodingForColorSpace, type EncodingId } from '../render/transfer.js';
import { csListId, exposureValue, populateCS, wireExposure } from './colorspaces.js';

const PREFS_KEY = 'lut-editor/batch-prefs';

let entries: BatchEntry[] = [];
let onEmpty: () => void = () => {};
let onSelect: (entry: BatchEntry | null) => void = () => {};
let selectedId: string | null = null;

/** Fields stamped identically on every file; the rest come from each entry. */
const sharedKeys = new Set<FieldKey>(FIELD_KEYS);

/** Short labels for the per-file inputs in a queue row. */
const OWN_LABELS: Record<FieldKey, string> = {
  author: 'Author',
  date: 'Date',
  project: 'Project',
  notes: 'Notes',
  expShift: 'Exposure',
  inputCS: 'Input CS',
  outputCS: 'Output CS',
};

/** Fields worth remembering between sessions, so they aren't retyped. */
interface Prefs {
  author: string;
  project: string;
  template: string;
  lookKind: LookKind;
  useFolders: boolean;
  /** Fields last set per file rather than shared. */
  perFile: FieldKey[];
}

function loadPrefs(): Partial<Prefs> {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<Prefs>;
  } catch {
    return {};
  }
}

function savePrefs(): void {
  try {
    const prefs: Prefs = {
      author: val('bAuthor'),
      project: val('bProject'),
      template: val('bTemplate'),
      lookKind: $<HTMLSelectElement>('bLookKind').value as LookKind,
      useFolders: $<HTMLInputElement>('bFolders').checked,
      perFile: FIELD_KEYS.filter((k) => !sharedKeys.has(k)),
    };
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Private windows and blocked site data are fine; prefs are a convenience.
  }
}

function customCS(dir: 'Input' | 'Output'): string {
  const sel = $<HTMLSelectElement>(`b${dir}CS`);
  if (sel.value === '__same__') return customCS('Input');
  if (sel.value === '__custom__') return val(`b${dir}CSCustom`);
  return sel.value;
}

function shared(): SharedFields {
  const exp = exposureValue($<HTMLInputElement>('bExpShift'));
  return {
    author: val('bAuthor'),
    date: val('bDate'),
    project: val('bProject'),
    notes: $<HTMLTextAreaElement>('bNotes').value.trim(),
    expShift: exp,
    inputCS: customCS('Input'),
    outputCS: customCS('Output'),
  };
}

function settings(): BatchSettings {
  return {
    template: val('bTemplate') || DEFAULT_TEMPLATE,
    lookKind: $<HTMLSelectElement>('bLookKind').value as LookKind,
    useFolders: $<HTMLInputElement>('bFolders').checked,
  };
}

function renderQueue(): void {
  const queue = $('queue');
  queue.replaceChildren();

  for (const entry of entries) {
    const level = worstLevel(entry);
    const row = document.createElement('div');
    row.className = `qrow qrow-${level}${entry.included ? '' : ' excluded'}`;

    const dot = document.createElement('span');
    dot.className = 'qrow-dot';

    const main = document.createElement('div');
    main.className = 'qrow-main';
    const name = document.createElement('div');
    name.className = 'qrow-name';
    name.textContent = entry.fileName;
    const meta = document.createElement('div');
    meta.className = 'qrow-meta';

    const dims = `${entry.lut.dims}D · ${entry.lut.size} · ${fmtSize(entry.fileSize)}`;
    const problems = [...entry.parseIssues, ...entry.checks].filter(
      (i) => i.level === 'error' || i.level === 'warning',
    );
    meta.append(document.createTextNode(dims));
    if (problems.length) {
      const sep = document.createTextNode('  ·  ');
      const issue = document.createElement('span');
      issue.className = 'qrow-issue';
      issue.textContent =
        problems.length === 1 ? problems[0].message : `${problems.length} issues — ${problems[0].message}`;
      meta.append(sep, issue);
    }
    main.append(name, meta);

    const look = document.createElement('input');
    look.className = 'qrow-look';
    look.value = entry.look;
    look.placeholder = 'Look name';
    look.addEventListener('input', () => {
      entry.look = look.value;
      renderPreview();
    });

    const toggle = document.createElement('button');
    toggle.className = 'qrow-toggle';
    toggle.textContent = entry.included ? '✓' : '✕';
    toggle.title = entry.included ? 'Exclude from export' : 'Include in export';
    toggle.addEventListener('click', () => {
      entry.included = !entry.included;
      renderQueue();
      renderPreview();
    });

    if (entry.id === selectedId) row.classList.add('selected');
    row.addEventListener('click', (e) => {
      // The look field and the include toggle have their own behaviour.
      if ((e.target as HTMLElement).closest('.qrow-look, .qrow-toggle, .qrow-own')) return;
      select(entry.id);
    });

    row.append(dot, main, look, toggle);
    const own = ownFields(entry);
    if (own) row.append(own);
    queue.append(row);
  }

  const included = entries.filter((e) => e.included).length;
  const errors = entries.filter((e) => worstLevel(e) === 'error').length;
  $('batchCount').textContent =
    `${included} of ${entries.length} selected${errors ? ` · ${errors} with errors` : ''}`;
}

/** Inputs for the fields this batch sets per file, or null when all are shared. */
function ownFields(entry: BatchEntry): HTMLElement | null {
  const keys = FIELD_KEYS.filter((k) => !sharedKeys.has(k));
  if (!keys.length) return null;

  const wrap = document.createElement('div');
  wrap.className = 'qrow-own';
  for (const key of keys) {
    const field = document.createElement('label');
    field.className = `qrow-own-field qrow-own-${key}`;
    const tag = document.createElement('span');
    tag.textContent = OWN_LABELS[key];
    const input = document.createElement('input');
    input.className = 'qrow-look';

    if (key === 'expShift') {
      input.value = entry.own.expShift === '0' ? '' : entry.own.expShift;
      wireExposure(input, () => {
        entry.own.expShift = exposureValue(input);
        renderPreview();
      });
      input.placeholder = '0';
    } else {
      input.value = entry.own[key];
      if (key === 'inputCS' || key === 'outputCS') input.setAttribute('list', csListId());
      input.addEventListener('input', () => {
        entry.own[key] = input.value.trim();
        renderPreview();
      });
    }
    field.append(tag, input);
    wrap.append(field);
  }
  return wrap;
}

/** Reflect `sharedKeys` on the Shared Header fields. */
function syncShareUI(): void {
  for (const box of document.querySelectorAll<HTMLInputElement>('[data-share]')) {
    const key = box.dataset.share as FieldKey;
    const on = sharedKeys.has(key);
    box.checked = on;
    (box.nextElementSibling as HTMLElement).textContent = on ? 'All' : 'Per file';
    const field = box.closest<HTMLElement>('.field')!;
    field.classList.toggle('per-file', !on);
    field
      .querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
        ':scope > input, :scope > select, :scope > textarea, .custom-input-wrapper input',
      )
      .forEach((el) => (el.disabled = !on));
  }
}

function setShared(key: FieldKey, on: boolean): void {
  if (on) sharedKeys.add(key);
  else {
    sharedKeys.delete(key);
    // Files whose header had nothing for this field start from the shared value.
    const fallback = shared()[key];
    for (const entry of entries) {
      if (!entry.own[key] || (key === 'expShift' && entry.own[key] === '0')) entry.own[key] = fallback;
    }
  }
  syncShareUI();
  refresh();
}

function select(id: string | null): void {
  selectedId = id;
  const entry = entries.find((e) => e.id === id) ?? null;
  onSelect(entry);
  renderQueue();
}

function renderPreview(): void {
  const s = shared();
  const set = settings();
  const included = entries.filter((e) => e.included);

  const lines = included.map((entry, i) => {
    const path = outputPath(entry, resolveFields(entry, s, sharedKeys), set, i);
    const cut = path.lastIndexOf('/');
    const dir = cut === -1 ? '' : path.slice(0, cut + 1);
    const file = cut === -1 ? path : path.slice(cut + 1);
    const bad = worstLevel(entry) === 'error';
    return (
      `<span class="pp">${esc(dir)}</span>` +
      `<span class="${bad ? 'pd' : 'pf'}">${esc(file)}</span>`
    );
  });

  $('bPreview').innerHTML = lines.length ? lines.join('\n') : ' ';
  $('bExportBadge').textContent = `${included.length} file${included.length === 1 ? '' : 's'}`;
  savePrefs();
}

function refresh(): void {
  renderQueue();
  renderPreview();
}

/** Re-announce the selected entry, e.g. once the viz panel has a size to draw into. */
export function reselect(): void {
  onSelect(entries.find((e) => e.id === selectedId) ?? null);
}

export function isActive(): boolean {
  return entries.length > 0;
}

export async function addFiles(files: File[]): Promise<void> {
  const parsed = await Promise.all(files.map(makeEntry));
  entries = [...entries, ...parsed];
  $('batch').classList.add('show');
  // Show something in the left panel straight away.
  if (!selectedId && entries.length) selectedId = entries[0].id;
  onSelect(entries.find((e) => e.id === selectedId) ?? null);
  refresh();
}

export function clear(): void {
  entries = [];
  selectedId = null;
  onSelect(null);
  $('batch').classList.remove('show');
  onEmpty();
}

function exportZip(): void {
  const files = renderBatch(entries, shared(), settings(), sharedKeys);
  if (!files.size) {
    toast('Nothing selected to export');
    return;
  }

  const zipInput: Record<string, Uint8Array> = {};
  for (const [path, text] of files) zipInput[path] = strToU8(text);

  const project = val('bProject');
  const stem = project ? project.replace(/[^A-Za-z0-9]+/g, '') : 'LUTPackage';
  const zipped = zipSync(zipInput, { level: 6 });

  download(`${stem}_${val('bDate').replace(/-/g, '')}.zip`, zipped, 'application/zip');
  toast(`Exported ${files.size} file${files.size === 1 ? '' : 's'}`);
}

/** Nearest-neighbour fit of a still into the thumbnail, preserving aspect. */
function resampleStill(
  still: { linear: Float32Array; w: number; h: number },
  w: number,
  h: number,
): Float32Array {
  const out = new Float32Array(w * h * 3);
  const scale = Math.max(w / still.w, h / still.h);
  const dw = still.w * scale;
  const dh = still.h * scale;
  const ox = (dw - w) / 2;
  const oy = (dh - h) / 2;

  for (let y = 0; y < h; y++) {
    const sy = Math.min(still.h - 1, Math.max(0, Math.floor((y + oy) / scale)));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(still.w - 1, Math.max(0, Math.floor((x + ox) / scale)));
      const src = (sy * still.w + sx) * 3;
      const dst = (y * w + x) * 3;
      out[dst] = still.linear[src];
      out[dst + 1] = still.linear[src + 1];
      out[dst + 2] = still.linear[src + 2];
    }
  }
  return out;
}

function exportLookSheet(): void {
  const included = entries.filter((e) => e.included);
  if (!included.length) {
    toast('Nothing selected for the look sheet');
    return;
  }

  const s = shared();

  const W = 480;
  const H = 270;

  // A photographic still separates looks far better than a patch chart; fall
  // back to skin tones, which at least move visibly under a grade.
  const still = stillSource();
  const chart: ChartId = 'skin';
  let linear: Float32Array;
  let label: string;

  if (still) {
    linear = resampleStill(still, W, H);
    label = still.name;
  } else {
    linear = renderChart(chart, W, H);
    label = CHARTS.find((c) => c.id === chart)?.label ?? chart;
  }

  const tiles: LookSheetTile[] = [];
  for (const entry of included) {
    const fields = resolveFields(entry, s, sharedKeys);
    stamp(entry, fields);
    // Preview each look through the encoding its declared input space implies.
    const encoding: EncodingId = encodingForColorSpace(fields.inputCS) ?? 'linear';
    const image = renderThumbnail(entry.lut, { linear }, encoding, W, H);
    if (!image) {
      toast('The look sheet needs WebGL2, which this browser did not provide');
      return;
    }
    tiles.push({ entry, image });
  }
  // The sheet header only states what every look shares.
  const common = { ...s };
  for (const key of FIELD_KEYS) if (!sharedKeys.has(key)) common[key] = '';
  const html = buildLookSheet(tiles, common, label);
  const stem = val('bProject')
    ? val('bProject').replace(/[^A-Za-z0-9]+/g, '')
    : 'LookSheet';
  download(`${stem}_LookSheet.html`, html, 'text/html');
  toast(`Look sheet with ${tiles.length} look${tiles.length === 1 ? '' : 's'}`);
}

export function init(
  onEmptyCallback: () => void,
  onSelectCallback: (entry: BatchEntry | null) => void,
): void {
  onEmpty = onEmptyCallback;
  onSelect = onSelectCallback;

  populateCS($<HTMLSelectElement>('bInputCS'), 'Input');
  populateCS($<HTMLSelectElement>('bOutputCS'), 'Output');

  $('bTokenHint').textContent = TEMPLATE_TOKENS.map((t) => `{${t}}`).join(' ');

  const prefs = loadPrefs();
  setVal('bDate', today());
  setVal('bAuthor', prefs.author ?? '');
  setVal('bProject', prefs.project ?? '');
  setVal('bTemplate', prefs.template ?? DEFAULT_TEMPLATE);
  $<HTMLSelectElement>('bLookKind').value = prefs.lookKind ?? 'Creative';
  const folders = $<HTMLInputElement>('bFolders');
  folders.checked = prefs.useFolders ?? true;
  syncFoldersToggle();

  for (const key of prefs.perFile ?? []) if (FIELD_KEYS.includes(key)) sharedKeys.delete(key);
  syncShareUI();
  for (const box of document.querySelectorAll<HTMLInputElement>('[data-share]')) {
    box.addEventListener('change', () => setShared(box.dataset.share as FieldKey, box.checked));
  }
  wireExposure($<HTMLInputElement>('bExpShift'), renderPreview);

  (['Input', 'Output'] as const).forEach((dir) => {
    $<HTMLSelectElement>(`b${dir}CS`).addEventListener('change', function (this: HTMLSelectElement) {
      const wrap = $(`b${dir}CSWrap`);
      if (this.value === '__custom__') wrap.classList.add('show');
      else {
        wrap.classList.remove('show');
        setVal(`b${dir}CSCustom`, '');
      }
      renderPreview();
    });
  });

  ['bAuthor', 'bDate', 'bProject', 'bNotes', 'bTemplate', 'bInputCSCustom', 'bOutputCSCustom'].forEach(
    (id) => $(id).addEventListener('input', renderPreview),
  );
  $('bLookKind').addEventListener('change', renderPreview);

  folders.addEventListener('change', () => {
    syncFoldersToggle();
    renderPreview();
  });

  $('bClear').addEventListener('click', clear);
  $('bExport').addEventListener('click', exportZip);
  $('bLookSheet').addEventListener('click', exportLookSheet);
}

function syncFoldersToggle(): void {
  const on = $<HTMLInputElement>('bFolders').checked;
  $('bFoldersLabel').classList.toggle('matched', on);
  $('bFoldersText').textContent = on ? 'ColorLibrary folders' : 'Flat list';
}
