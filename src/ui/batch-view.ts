/**
 * Batch panel: the "stamp and ship a look package" view. Active whenever more
 * than one file is in the queue.
 */

import { zipSync, strToU8 } from 'fflate';
import {
  type BatchEntry,
  type BatchSettings,
  type SharedFields,
  makeEntry,
  outputPath,
  renderBatch,
  worstLevel,
} from '../batch/batch.js';
import { DEFAULT_TEMPLATE, TEMPLATE_TOKENS } from '../core/naming.js';
import { type LookKind } from '../core/naming.js';
import { $, download, esc, fmtSize, setVal, toast, today, val } from './dom.js';
import { populateCS, populateExposure } from './colorspaces.js';

const PREFS_KEY = 'lut-editor/batch-prefs';

let entries: BatchEntry[] = [];
let onEmpty: () => void = () => {};
let onSelect: (entry: BatchEntry | null) => void = () => {};
let selectedId: string | null = null;

/** Fields worth remembering between sessions, so they aren't retyped. */
interface Prefs {
  author: string;
  project: string;
  template: string;
  lookKind: LookKind;
  useFolders: boolean;
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
  const exp = $<HTMLSelectElement>('bExpShift').value;
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
      if ((e.target as HTMLElement).closest('.qrow-look, .qrow-toggle')) return;
      select(entry.id);
    });

    row.append(dot, main, look, toggle);
    queue.append(row);
  }

  const included = entries.filter((e) => e.included).length;
  const errors = entries.filter((e) => worstLevel(e) === 'error').length;
  $('batchCount').textContent =
    `${included} of ${entries.length} selected${errors ? ` · ${errors} with errors` : ''}`;
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
    const path = outputPath(entry, s, set, i);
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
  const files = renderBatch(entries, shared(), settings());
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

export function init(
  onEmptyCallback: () => void,
  onSelectCallback: (entry: BatchEntry | null) => void,
): void {
  onEmpty = onEmptyCallback;
  onSelect = onSelectCallback;

  populateExposure($<HTMLSelectElement>('bExpShift'));
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
  ['bExpShift', 'bLookKind'].forEach((id) => $(id).addEventListener('change', renderPreview));

  folders.addEventListener('change', () => {
    syncFoldersToggle();
    renderPreview();
  });

  $('bClear').addEventListener('click', clear);
  $('bExport').addEventListener('click', exportZip);
}

function syncFoldersToggle(): void {
  const on = $<HTMLInputElement>('bFolders').checked;
  $('bFoldersLabel').classList.toggle('matched', on);
  $('bFoldersText').textContent = on ? 'ColorLibrary folders' : 'Flat list';
}
