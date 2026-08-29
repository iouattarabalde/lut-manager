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

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
};

const val = (id: string): string => $<HTMLInputElement>(id).value.trim();
const setVal = (id: string, v: string): void => {
  $<HTMLInputElement>(id).value = v;
};

let lut: Lut | null = null;
let srcFileName = '';

const curve = new CurveView($<HTMLCanvasElement>('vizCanvas'));

/**
 * Local calendar date, not UTC. `toISOString` rolls over at 00:00 UTC, which
 * stamps tomorrow's date on anything graded after ~4pm in North America.
 */
const today = (): string => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
setVal('fieldDate', today());

// ── Loading ──────────────────────────────────────────────────────

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
  // Preview the header only: everything up to the first data row.
  const full = writeCube(lut).split(/\r?\n/);
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

const esc = (s: string): string =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

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

/**
 * `+2/3` becomes `plus0_67`. The old version let the raw `+` and the decimal
 * point through, since the suffix bypassed `toFilename` entirely.
 */
function exposureSuffix(): string {
  const raw = val('fieldExpShift');
  const n = parseFloat(raw);
  if (!raw || raw === '0' || !Number.isFinite(n) || n === 0) return '';
  // Keep the decimal readable: 0.67 -> 0_67. Routing this through
  // `toFilename` would turn the dot into a dash and read as a range.
  const magnitude = Math.abs(n)
    .toFixed(2)
    .replace(/0+$/, '')
    .replace(/\.$/, '')
    .replace('.', '_');
  return `_${n > 0 ? 'plus' : 'minus'}${magnitude}stop`;
}

function syncFilename(): void {
  if (!$<HTMLInputElement>('chkCustomFilename').checked) return;
  const title = val('fieldTitle');
  const base = title
    ? toFilename(title)
    : toFilename(srcFileName.replace(/\.[^.]+$/, '')) || 'output';
  setVal('fieldFilename', base + exposureSuffix() + '.cube');
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
  lut = null;
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
    requestAnimationFrame(() => curve.setLut(lut)),
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
    const f = (e as DragEvent).dataTransfer?.files[0];
    if (f) void loadFile(f);
  });
}

wireDropTarget($('dropZone'));
wireDropTarget($('vizDropOverlay'));

(['fileInput', 'fileInputViz'] as const).forEach((id) => {
  $<HTMLInputElement>(id).addEventListener('change', (e) => {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0];
    if (f) void loadFile(f);
    if (id === 'fileInputViz') input.value = '';
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
  // The old build skipped this, leaving the filename box empty while the
  // toggle still claimed to be tracking the LUT name.
  syncFilename();
  updatePreview();
  toast('Fields cleared');
});

$('btnDownload').addEventListener('click', () => {
  if (!lut) return;
  collectMeta(lut);
  const name = val('fieldFilename') || 'output_edited.cube';
  const blob = new Blob([writeCube(lut)], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  URL.revokeObjectURL(url);
  toast(`Downloaded ${name}`);
});

// ── Misc ─────────────────────────────────────────────────────────

let toastTimer: number | undefined;
function toast(msg: string): void {
  const el = $('toast');
  $('toastMsg').textContent = msg;
  el.classList.add('show');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove('show'), 2600);
}

function fmtSize(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1048576).toFixed(2)} MB`;
}
