import '@fontsource/ibm-plex-mono/300.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/barlow-condensed/300.css';
import '@fontsource/barlow-condensed/400.css';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
import './styles.css';

import { type Lut } from './core/lut.js';
import { type ParseIssue, parseCube, writeCube } from './format/cube.js';
import { CurveView } from './render/curve.js';
import { exposureSuffix } from './core/naming.js';
import { $, download, esc, fmtSize, setVal, toast, today, val } from './ui/dom.js';
import { populateCS, populateExposure } from './ui/colorspaces.js';
import * as batch from './ui/batch-view.js';
import * as preview from './ui/preview-view.js';
import * as ops from './ui/ops-view.js';
import * as analysis from './ui/analysis-view.js';
import { write3dl } from './format/lustre3dl.js';
import { writeCsp } from './format/csp.js';
import { writeClf } from './format/clf.js';

let lut: Lut | null = null;
let srcFileName = '';

populateExposure($<HTMLSelectElement>('fieldExpShift'));
populateCS($<HTMLSelectElement>('selInputCS'), 'Input');
populateCS($<HTMLSelectElement>('selOutputCS'), 'Output');

const curve = new CurveView($<HTMLCanvasElement>('vizCanvas'));

setVal('fieldDate', today());

// ── Loading ──────────────────────────────────────────────────────

const isImage = (f: File): boolean =>
  f.type.startsWith('image/') || /\.(png|jpe?g|webp|avif|gif|bmp)$/i.test(f.name);

/** One .cube opens the editor; several open the batch panel; images become the preview source. */
async function loadFiles(files: File[]): Promise<void> {
  if (!files.length) return;

  const images = files.filter(isImage);
  const luts = files.filter((f) => !isImage(f));

  if (images.length) {
    try {
      await preview.setStill(images[0]);
      toast(`Preview source: ${images[0].name}`);
    } catch {
      toast('Could not read that image');
    }
    if (!luts.length) return;
  }

  files = luts;
  if (!files.length) return;
  if (files.length === 1 && !batch.isActive()) {
    await loadFile(files[0]);
    return;
  }
  $('emptyState').style.display = 'none';
  $('editor').classList.remove('show');
  $('filePill').classList.remove('show');
  renderIssues([]);
  await batch.addFiles(files);
  showViz();
}

async function loadFile(file: File): Promise<void> {
  srcFileName = file.name;
  const text = await file.text();
  const { lut: parsed, issues } = parseCube(text);
  lut = parsed;

  applyMetaToFields(parsed);
  renderIssues(issues);

  $('pillName').textContent = file.name;
  $('pillSize').textContent = fmtSize(file.size);
  $('filePill').classList.add('show');
  $('emptyState').style.display = 'none';
  $('editor').classList.add('show');

  ops.setSource(parsed);
  syncFilename();
  updatePreview();
  showViz();
}

function applyMetaToFields(l: Lut): void {
  setVal('fieldTitle', l.meta.title);
  setVal('fieldAuthor', l.meta.author);
  setVal('fieldDate', l.meta.date || today());
  setVal('fieldProject', l.meta.project);
  setVal('fieldNotes', l.meta.notes);

  const expSel = $<HTMLSelectElement>('fieldExpShift');
  const expNum = parseFloat(l.meta.expShift);
  if (Number.isFinite(expNum)) {
    const match = Array.from(expSel.options).find(
      (o) => parseFloat(o.value) === expNum,
    );
    expSel.value = match ? match.value : '0';
  } else {
    expSel.value = '0';
  }

  applyCS('Input', l.meta.inputCS);
  applyCS('Output', l.meta.outputCS);
}

function applyCS(dir: 'Input' | 'Output', value: string): void {
  const sel = $<HTMLSelectElement>(`sel${dir}CS`);
  const wrap = $(`custom${dir}CSWrap`);
  const cust = $<HTMLInputElement>(`custom${dir}CS`);
  if (!value) {
    sel.value = '';
    wrap.classList.remove('show');
    cust.value = '';
    return;
  }
  const match = Array.from(sel.options).find(
    (o) => o.text === value || o.value === value,
  );
  if (match && match.value !== '__custom__') {
    sel.value = match.value;
    wrap.classList.remove('show');
    cust.value = '';
  } else {
    sel.value = '__custom__';
    wrap.classList.add('show');
    cust.value = value;
  }
}

// ── Issues ───────────────────────────────────────────────────────

function renderIssues(issues: ParseIssue[]): void {
  const box = $('issues');
  box.innerHTML = '';
  box.classList.toggle('show', issues.length > 0);
  for (const issue of issues) {
    const el = document.createElement('div');
    el.className = `issue issue-${issue.level}`;

    const level = document.createElement('span');
    level.className = 'issue-level';
    level.textContent = issue.level;

    const msg = document.createElement('span');
    msg.className = 'issue-msg';
    msg.textContent = issue.message;

    el.append(level, msg);

    if (issue.line !== undefined) {
      const line = document.createElement('span');
      line.className = 'issue-line';
      line.textContent = `L${issue.line}`;
      el.append(line);
    }
    box.append(el);
  }
}

// ── Header assembly ──────────────────────────────────────────────

function getCS(dir: 'Input' | 'Output'): string {
  const sel = $<HTMLSelectElement>(`sel${dir}CS`);
  if (sel.value === '__same__') return getCS('Input');
  if (sel.value === '__custom__') return val(`custom${dir}CS`);
  return sel.value;
}

/** Push the form state onto the model. Never touches sample data. */
function collectMeta(l: Lut): void {
  const exp = val('fieldExpShift');
  l.meta = {
    title: val('fieldTitle'),
    author: val('fieldAuthor'),
    date: val('fieldDate'),
    project: val('fieldProject'),
    notes: $<HTMLTextAreaElement>('fieldNotes').value.trim(),
    expShift: exp && exp !== '0' ? `${exp} stops` : '',
    inputCS: getCS('Input'),
    outputCS: getCS('Output'),
  };
}

function updatePreview(): void {
  if (!lut) return;
  collectMeta(lut);
  const shown = ops.outputLut() ?? lut;
  if (shown !== lut) shown.meta = { ...lut.meta };
  // Preview the header only: everything up to the first data row.
  const full = writeCube(shown).split(/\r?\n/);
  const firstData = full.findIndex((l) => /^[-+.\d]/.test(l) && !/^[A-Z]/i.test(l));
  const header = full.slice(0, firstData === -1 ? full.length : firstData);

  $('previewBox').innerHTML = header
    .map((line) => {
      if (!line.trim()) return ' ';
      if (/^TITLE/i.test(line))
        return `<span class="pk">TITLE</span> <span class="pv">${esc(line.slice(6))}</span>`;
      if (/^LUT_\dD_SIZE/i.test(line)) {
        const [kw, ...rest] = line.split(/\s+/);
        return `<span class="pk">${esc(kw)}</span> <span class="pn">${esc(rest.join(' '))}</span>`;
      }
      if (/^DOMAIN/i.test(line)) {
        const [kw, ...rest] = line.split(/\s+/);
        return `<span class="pk">${esc(kw)}</span> <span class="pv">${esc(rest.join(' '))}</span>`;
      }
      const keyed = line.match(/^#\s*([^:]+):\s*(.+)$/);
      if (keyed)
        return `<span class="pc"># </span><span class="pk">${esc(keyed[1])}</span><span class="pc">: </span><span class="pcs">${esc(keyed[2])}</span>`;
      if (/^#/.test(line)) return `<span class="pc">${esc(line)}</span>`;
      return esc(line);
    })
    .join('\n');
}

// ── Filename ─────────────────────────────────────────────────────

function toFilename(str: string): string {
  return (
    str
      .trim()
      .replace(/\s+to\s+/gi, '-')
      .replace(/\.+/g, '-')
      .replace(/[^a-zA-Z0-9-]+/g, '_')
      .replace(/^[_-]+|[_-]+$/g, '') || 'output'
  );
}

function syncFilename(): void {
  if (!$<HTMLInputElement>('chkCustomFilename').checked) return;
  const title = val('fieldTitle');
  const base = title
    ? toFilename(title)
    : toFilename(srcFileName.replace(/\.[^.]+$/, '')) || 'output';
  setVal('fieldFilename', base + exposureSuffix(val('fieldExpShift')) + '.cube');
}

function resetFilenameToggle(): void {
  const chk = $<HTMLInputElement>('chkCustomFilename');
  chk.checked = true;
  $<HTMLInputElement>('fieldFilename').disabled = true;
  $('chkLabel').classList.add('matched');
  $('toggleText').textContent = 'Match LUT Name';
}

// ── Reset / clear ────────────────────────────────────────────────

const TEXT_FIELDS = [
  'fieldTitle',
  'fieldAuthor',
  'fieldProject',
  'fieldNotes',
  'customInputCS',
  'customOutputCS',
];

function resetFields(): void {
  TEXT_FIELDS.forEach((id) => setVal(id, ''));
  $<HTMLSelectElement>('fieldExpShift').value = '0';
  setVal('fieldDate', today());
  (['selInputCS', 'selOutputCS'] as const).forEach((id) => {
    $<HTMLSelectElement>(id).value = '';
  });
  ['customInputCSWrap', 'customOutputCSWrap'].forEach((id) =>
    $(id).classList.remove('show'),
  );
  resetFilenameToggle();
}

function clearAll(): void {
  if (batch.isActive()) {
    batch.clear();
    return;
  }
  lut = null;
  ops.setSource(null);
  ops.reset();
  srcFileName = '';
  $('filePill').classList.remove('show');
  $('editor').classList.remove('show');
  $('emptyState').style.display = '';
  $<HTMLInputElement>('fileInput').value = '';
  renderIssues([]);
  resetFields();
  setVal('fieldFilename', '');
  hideViz();
}

// ── Viz show/hide ────────────────────────────────────────────────

function showViz(): void {
  $('dropZone').style.display = 'none';
  $('lutViz').classList.add('show');
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const shown = ops.outputLut() ?? lut;
      curve.setLut(shown);
      preview.setLut(shown);
      analysis.render(shown, shown ? `${shown.dims}D · ${shown.size}` : '');
    }),
  );
}

function hideViz(): void {
  $('dropZone').style.display = '';
  $('lutViz').classList.remove('show');
  curve.setLut(null);
}

// ── Wiring ───────────────────────────────────────────────────────

function wireDropTarget(zone: HTMLElement): void {
  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.classList.add('drag-over');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    const dropped = [...((e as DragEvent).dataTransfer?.files ?? [])];
    void loadFiles(dropped);
  });
}

wireDropTarget($('dropZone'));
wireDropTarget($('vizDropOverlay'));

(['fileInput', 'fileInputViz'] as const).forEach((id) => {
  $<HTMLInputElement>(id).addEventListener('change', (e) => {
    const input = e.target as HTMLInputElement;
    void loadFiles([...(input.files ?? [])]);
    input.value = '';
  });
});

$('btnClear').addEventListener('click', clearAll);

(['Input', 'Output'] as const).forEach((dir) => {
  $<HTMLSelectElement>(`sel${dir}CS`).addEventListener('change', function (this: HTMLSelectElement) {
    const wrap = $(`custom${dir}CSWrap`);
    if (this.value === '__custom__') {
      wrap.classList.add('show');
    } else {
      wrap.classList.remove('show');
      setVal(`custom${dir}CS`, '');
    }
    updatePreview();
  });
});

$<HTMLInputElement>('chkCustomFilename').addEventListener('change', function (this: HTMLInputElement) {
  const matched = this.checked;
  $<HTMLInputElement>('fieldFilename').disabled = matched;
  $('chkLabel').classList.toggle('matched', matched);
  $('toggleText').textContent = matched ? 'Match LUT Name' : 'Custom';
  if (matched) syncFilename();
});

$('fieldTitle').addEventListener('input', syncFilename);
$('fieldExpShift').addEventListener('change', () => {
  syncFilename();
  updatePreview();
});
[
  'fieldTitle',
  'fieldAuthor',
  'fieldDate',
  'fieldProject',
  'fieldNotes',
  'customInputCS',
  'customOutputCS',
].forEach((id) => $(id).addEventListener('input', updatePreview));

$('btnReset').addEventListener('click', () => {
  resetFields();
  ops.reset();
  // The old build skipped this, leaving the filename box empty while the
  // toggle still claimed to be tracking the LUT name.
  syncFilename();
  updatePreview();
  toast('Fields cleared');
});

const WRITERS: Record<ops.ExportFormat, (l: Lut) => string> = {
  cube: writeCube,
  '3dl': (l) => write3dl(l),
  csp: writeCsp,
  clf: writeClf,
};

$('btnDownload').addEventListener('click', () => {
  if (!lut) return;
  collectMeta(lut);

  const out = ops.outputLut() ?? lut;
  if (out !== lut) out.meta = { ...lut.meta };

  const format = ops.exportFormat();
  const base = (val('fieldFilename') || 'output_edited.cube').replace(/\.[^.]+$/, '');
  const name = `${base}.${format}`;

  try {
    download(name, WRITERS[format](out));
    toast(`Downloaded ${name}`);
  } catch (err) {
    toast(err instanceof Error ? err.message : 'Export failed');
  }
});

// ── Misc ─────────────────────────────────────────────────────────

// ── Startup ──────────────────────────────────────────────────────

preview.init();

// Re-render whatever is on screen when the staged operations change.
ops.init(() => {
  // Operations that change the transform's direction rewrite the color space
  // fields, so what the form shows is what gets written.
  const override = ops.colorSpaceOverride();
  if (override.inputCS !== undefined) applyCS('Input', override.inputCS);
  if (override.outputCS !== undefined) applyCS('Output', override.outputCS);

  if (lut) updatePreview();
  const shown = ops.outputLut();
  const chained = ops.chainedLut();
  curve.setCompare(chained?.lut ?? null, chained?.name ?? '');
  curve.setLut(shown);
  preview.setLut(shown);
  analysis.render(shown, shown ? `${shown.dims}D · ${shown.size}` : '');
});

batch.init(
  () => {
    $('emptyState').style.display = '';
    $('filePill').classList.remove('show');
    $<HTMLInputElement>('fileInput').value = '';
    hideViz();
  },
  (entry) => {
    curve.setLut(entry?.lut ?? null);
    preview.setLut(entry?.lut ?? null);
    analysis.render(entry?.lut ?? null, entry ? entry.fileName : '');
    if (entry) {
      $('pillName').textContent = entry.fileName;
      $('pillSize').textContent = fmtSize(entry.fileSize);
      $('filePill').classList.add('show');
    }
  },
);

// ── Keyboard shortcuts ───────────────────────────────────────────

const TABS: Record<string, string> = {
  '1': 'tabCurve',
  '2': 'tabImage',
  '3': 'tabScopes',
  '4': 'tabCube',
};

document.addEventListener('keydown', (e) => {
  // Never steal keys from a field the user is typing in.
  const el = document.activeElement;
  if (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement
  ) {
    return;
  }
  if (e.metaKey || e.ctrlKey || e.altKey) return;

  const tab = TABS[e.key];
  if (tab && !$('lutViz').classList.contains('show') === false) {
    $(tab).click();
    e.preventDefault();
    return;
  }

  if (e.key.toLowerCase() === 'd' && (lut || batch.isActive())) {
    ($(batch.isActive() ? 'bExport' : 'btnDownload') as HTMLButtonElement).click();
    e.preventDefault();
  } else if (e.key === 'Escape') {
    clearAll();
    e.preventDefault();
  }
});
