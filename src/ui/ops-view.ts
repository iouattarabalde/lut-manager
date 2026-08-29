/**
 * The Operations panel: staged transforms applied to the loaded LUT.
 *
 * Kept deliberately separate from the header fields, because the two make
 * opposite promises. Header edits return the data table byte-for-byte; every
 * operation here rewrites it. Whenever any operation is active the panel says
 * so, so the difference is never a surprise at download time.
 */

import { type Lut, lutSampleCount } from '../core/lut.js';
import {
  LEGAL_MAX,
  LEGAL_MIN,
  clamp,
  concatenate,
  extract1D,
  invert,
  resample,
  resampleError,
} from '../core/ops.js';
import { parseCube } from '../format/cube.js';
import { $, esc } from './dom.js';

export type ExportFormat = 'cube' | '3dl' | 'csp' | 'clf';

interface OpsState {
  resampleTo: number | null;
  clampMode: 'none' | 'unit' | 'legal';
  invert: boolean;
  to1D: boolean;
  chain: { lut: Lut; name: string } | null;
  /** 'after' = this LUT then the chained one. */
  chainOrder: 'after' | 'before';
}

const state: OpsState = {
  resampleTo: null,
  clampMode: 'none',
  invert: false,
  to1D: false,
  chain: null,
  chainOrder: 'after',
};

let source: Lut | null = null;
let derived: Lut | null = null;
let onChange: () => void = () => {};

/**
 * Color spaces the staged operations imply, which differ from what the user
 * typed. Inverting a LogC->Rec.709 LUT produces a Rec.709->LogC one, and
 * chaining takes the output space from whichever LUT runs last. Without this
 * the file would ship claiming the original direction.
 */
let csOverride: { inputCS?: string; outputCS?: string } = {};

export function colorSpaceOverride(): { inputCS?: string; outputCS?: string } {
  return csOverride;
}

/** The chained LUT, if one is loaded, for comparison display. */
export function chainedLut(): { lut: Lut; name: string } | null {
  return state.chain;
}

export function isModifying(): boolean {
  return (
    state.resampleTo !== null ||
    state.clampMode !== 'none' ||
    state.invert ||
    state.to1D ||
    state.chain !== null
  );
}

export function setSource(lut: Lut | null): void {
  source = lut;
  derived = null;
  // A LUT the ops don't apply to cleanly shouldn't carry stale state over.
  if (!lut) {
    state.chain = null;
    updateChainUi();
  }
  recompute();
}

/** The LUT that should be previewed, plotted and written out. */
export function outputLut(): Lut | null {
  return derived ?? source;
}

export function exportFormat(): ExportFormat {
  return $<HTMLSelectElement>('exportFormat').value as ExportFormat;
}

function recompute(): void {
  const readout = $('opsReadout');
  const banner = $('opsBanner');

  if (!source) {
    derived = null;
    csOverride = {};
    readout.hidden = true;
    banner.hidden = true;
    $('opsStatus').textContent = 'data unchanged';
    onChange();
    return;
  }

  if (!isModifying()) {
    derived = null;
    csOverride = {};
    readout.hidden = true;
    banner.hidden = true;
    $('opsStatus').textContent = 'data unchanged';
    onChange();
    return;
  }

  const notes: string[] = [];
  let work = source;
  csOverride = {};

  try {
    if (state.chain) {
      const [first, then] =
        state.chainOrder === 'after' ? [work, state.chain.lut] : [state.chain.lut, work];
      const mismatch =
        first.meta.outputCS && then.meta.inputCS && first.meta.outputCS !== then.meta.inputCS;
      work = concatenate(first, then);
      // The chain ends wherever the last LUT ends, and starts where the first
      // one starts.
      if (first.meta.inputCS) csOverride.inputCS = first.meta.inputCS;
      if (then.meta.outputCS) csOverride.outputCS = then.meta.outputCS;
      notes.push(
        `<strong>Chained</strong> ${esc(state.chainOrder === 'after' ? 'this → ' + state.chain.name : state.chain.name + ' → this')} at size ${work.size}.`,
      );
      if (mismatch) {
        notes.push(
          `<span class="bad">The first LUT outputs ${esc(first.meta.outputCS)} but the second expects ${esc(then.meta.inputCS)}.</span>`,
        );
      }
    }

    if (state.invert) {
      const targetSize = state.resampleTo ?? Math.min(33, work.size);
      const result = invert(work, targetSize);
      // Inverting runs the transform the other way round.
      const beforeIn = csOverride.inputCS ?? source.meta.inputCS;
      const beforeOut = csOverride.outputCS ?? source.meta.outputCS;
      csOverride.inputCS = beforeOut;
      csOverride.outputCS = beforeIn;
      work = result.lut;
      const bad = result.maxError > 0.01;
      notes.push(
        `<strong>Inverted</strong> — worst round-trip error <span class="${bad ? 'bad' : ''}">${result.maxError.toFixed(4)}</span>, mean ${result.meanError.toFixed(4)}.`,
      );
      if (result.nonInjective) {
        notes.push(
          '<span class="bad">This LUT maps different inputs to the same output (it clips), so no exact inverse exists.</span>',
        );
      }
    }

    if (state.resampleTo && work.size !== state.resampleTo) {
      const before = work;
      work = resample(work, state.resampleTo);
      if (before.dims === 3 && work.dims === 3) {
        const err = resampleError(before, work);
        const bad = err.max > 0.02;
        notes.push(
          `<strong>Resampled</strong> ${before.size} → ${work.size} — worst deviation <span class="${bad ? 'bad' : ''}">${err.max.toFixed(4)}</span>, mean ${err.mean.toFixed(4)}.`,
        );
      }
    }

    if (state.clampMode !== 'none') {
      const [lo, hi] = state.clampMode === 'legal' ? [LEGAL_MIN, LEGAL_MAX] : [0, 1];
      const count = lutSampleCount(work) * 3;
      let touched = 0;
      for (let i = 0; i < count; i++) {
        if (work.data[i] < lo || work.data[i] > hi) touched++;
      }
      work = clamp(work, lo, hi);
      notes.push(
        `<strong>Clamped</strong> to ${lo.toFixed(4)}–${hi.toFixed(4)} — ${((touched / count) * 100).toFixed(2)}% of values moved.`,
      );
    }

    if (state.to1D) {
      const wasIndependent = work.dims === 3;
      work = extract1D(work, 1024);
      notes.push('<strong>Extracted 1D</strong> at 1024 points.');
      if (wasIndependent) {
        notes.push(
          'Only exact if the source did no cross-channel work — check the reducible-to-1D note in the queue.',
        );
      }
    }

    derived = work;
    banner.hidden = false;
    banner.innerHTML =
      '<strong>Data will be rewritten.</strong>' +
      '<span>Header-only edits keep the original table byte-for-byte; these operations do not.</span>';
    $('opsStatus').textContent = `${work.dims}D · ${work.size} · data rewritten`;
    readout.hidden = false;
    readout.innerHTML = notes.join('<br>');
  } catch (err) {
    derived = null;
    banner.hidden = false;
    banner.innerHTML = `<strong>Operation failed.</strong><span>${esc(
      err instanceof Error ? err.message : String(err),
    )}</span>`;
    readout.hidden = true;
  }

  onChange();
}

function updateChainUi(): void {
  const label = $('opChainLabel');
  const name = $('opChainName');
  const clear = $('opChainClear');
  const order = $<HTMLSelectElement>('opChainOrder');

  if (state.chain) {
    label.classList.add('loaded');
    name.textContent = state.chain.name;
    clear.hidden = false;
    order.hidden = false;
    // Rebuilt each time so the names in the options stay accurate.
    const thisName = source?.meta.title || 'this LUT';
    order.replaceChildren(
      Object.assign(document.createElement('option'), {
        value: 'after',
        textContent: `${thisName}  →  ${state.chain.name}`,
      }),
      Object.assign(document.createElement('option'), {
        value: 'before',
        textContent: `${state.chain.name}  →  ${thisName}`,
      }),
    );
    order.value = state.chainOrder;
  } else {
    label.classList.remove('loaded');
    name.textContent = 'Drop or click to add a second .cube';
    clear.hidden = true;
    order.hidden = true;
  }
}

async function loadChain(file: File): Promise<void> {
  const { lut } = parseCube(await file.text());
  state.chain = { lut, name: lut.meta.title || file.name.replace(/\.[^.]+$/, '') };
  updateChainUi();
  recompute();
}

export function reset(): void {
  state.resampleTo = null;
  state.clampMode = 'none';
  state.invert = false;
  state.to1D = false;
  state.chain = null;
  $<HTMLSelectElement>('opResample').value = '';
  $<HTMLSelectElement>('opClamp').value = 'none';
  $<HTMLInputElement>('opInvert').checked = false;
  $<HTMLInputElement>('opTo1D').checked = false;
  syncToggle('opInvert', 'opInvertLabel');
  syncToggle('opTo1D', 'opTo1DLabel');
  updateChainUi();
  recompute();
}

function syncToggle(inputId: string, labelId: string): void {
  $(labelId).classList.toggle('matched', $<HTMLInputElement>(inputId).checked);
}

export function init(onChangeCallback: () => void): void {
  onChange = onChangeCallback;

  $<HTMLSelectElement>('opResample').addEventListener('change', function () {
    state.resampleTo = this.value ? Number(this.value) : null;
    recompute();
  });

  $<HTMLSelectElement>('opClamp').addEventListener('change', function () {
    state.clampMode = this.value as OpsState['clampMode'];
    recompute();
  });

  for (const [inputId, labelId, key] of [
    ['opInvert', 'opInvertLabel', 'invert'],
    ['opTo1D', 'opTo1DLabel', 'to1D'],
  ] as const) {
    $<HTMLInputElement>(inputId).addEventListener('change', function () {
      state[key] = this.checked;
      syncToggle(inputId, labelId);
      recompute();
    });
  }

  $<HTMLInputElement>('opChainInput').addEventListener('change', (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (f) void loadChain(f);
    (e.target as HTMLInputElement).value = '';
  });

  const drop = $('opChainLabel');
  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    drop.classList.add('drag-over');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('drag-over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    drop.classList.remove('drag-over');
    const f = (e as DragEvent).dataTransfer?.files[0];
    if (f) void loadChain(f);
  });

  $('opChainClear').addEventListener('click', () => {
    state.chain = null;
    updateChainUi();
    recompute();
  });

  $<HTMLSelectElement>('opChainOrder').addEventListener('change', function () {
    state.chainOrder = this.value as OpsState['chainOrder'];
    recompute();
  });

  $('exportFormat').addEventListener('change', onChange);
}
