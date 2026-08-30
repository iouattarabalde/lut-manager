/**
 * The image preview panel: pick a source, state what encoding it is being
 * converted to, and see the LUT applied with a before/after split.
 *
 * The encoding control is deliberately prominent. A still dropped in from
 * Finder is Rec.709/sRGB; a show LUT expects camera log. Applying one to the
 * other unconverted shows something that is not what the LUT does, so the
 * assumption is always on screen rather than buried.
 */

import { type Lut } from '../core/lut.js';
import { PreviewRenderer, type Interpolation } from '../render/preview.js';
import { CHARTS, type ChartId, renderChart } from '../render/charts.js';
import { drawVectorscope, drawWaveform } from '../render/scopes.js';
import { CubeView } from '../render/cube3d.js';
import {
  ENCODINGS,
  ENCODING_LIST,
  type EncodingId,
  encodingForColorSpace,
} from '../render/transfer.js';
import { $ } from './dom.js';

/** A still the user dropped in, held as scene-linear RGB at native size. */
interface DroppedStill {
  name: string;
  linear: Float32Array;
  w: number;
  h: number;
}

let renderer: PreviewRenderer | null = null;
let rendererFailed = false;
let cube: CubeView | null = null;
let cubeFailed = false;
let lut: Lut | null = null;
let still: DroppedStill | null = null;
let sourceId: ChartId | 'still' = 'checker';
/** LUT strength shared by every tab. */
let mixValue = 1;
let onMixChange: (mix: number) => void = () => {};
let encodingId: EncodingId = 'logc3';
/** True until the user picks an encoding, so the LUT can keep suggesting one. */
let encodingAuto = true;

function canvas(): HTMLCanvasElement {
  return $<HTMLCanvasElement>('previewCanvas');
}

function ensureRenderer(): PreviewRenderer | null {
  if (renderer || rendererFailed) return renderer;
  try {
    renderer = new PreviewRenderer(canvas());
  } catch (err) {
    rendererFailed = true;
    const box = $('previewError');
    box.textContent =
      err instanceof Error ? err.message : 'The image preview could not start.';
    box.hidden = false;
    canvas().hidden = true;
  }
  return renderer;
}

/** Preview resolution: the canvas's own pixel size, capped for sanity. */
function stageSize(): { w: number; h: number } {
  const c = canvas();
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.min(2048, Math.round(c.clientWidth * dpr)));
  const h = Math.max(1, Math.min(2048, Math.round(c.clientHeight * dpr)));
  return { w, h };
}

/**
 * Build the source in scene-linear at preview resolution. Stills are scaled
 * by a 2D canvas so the browser does a smooth downscale, which keeps the GPU
 * path on exact 1:1 texels.
 */
function buildLinearSource(w: number, h: number): Float32Array {
  if (sourceId === 'still' && still) {
    const scratch = document.createElement('canvas');
    scratch.width = w;
    scratch.height = h;
    const ctx = scratch.getContext('2d');
    if (!ctx) return renderChart('checker', w, h);

    // Re-rasterise the still into an ImageData we can scale.
    const src = document.createElement('canvas');
    src.width = still.w;
    src.height = still.h;
    const sctx = src.getContext('2d')!;
    const img = sctx.createImageData(still.w, still.h);
    for (let i = 0; i < still.w * still.h; i++) {
      img.data[i * 4] = Math.round(ENCODINGS.srgb.fromLinear(still.linear[i * 3]) * 255);
      img.data[i * 4 + 1] = Math.round(ENCODINGS.srgb.fromLinear(still.linear[i * 3 + 1]) * 255);
      img.data[i * 4 + 2] = Math.round(ENCODINGS.srgb.fromLinear(still.linear[i * 3 + 2]) * 255);
      img.data[i * 4 + 3] = 255;
    }
    sctx.putImageData(img, 0, 0);

    // Fit the still to the stage, recording the rect so the shader can matte
    // around it rather than grading the bars along with the picture.
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, w, h);
    const scale = Math.min(w / still.w, h / still.h);
    const dw = still.w * scale;
    const dh = still.h * scale;
    const dx = (w - dw) / 2;
    const dy = (h - dh) / 2;
    ctx.drawImage(src, dx, dy, dw, dh);
    if (renderer) {
      renderer.imageRect = [dx / w, dy / h, (dx + dw) / w, (dy + dh) / h];
    }

    const data = ctx.getImageData(0, 0, w, h).data;
    const out = new Float32Array(w * h * 3);
    for (let i = 0; i < w * h; i++) {
      out[i * 3] = ENCODINGS.srgb.toLinear(data[i * 4] / 255);
      out[i * 3 + 1] = ENCODINGS.srgb.toLinear(data[i * 4 + 1] / 255);
      out[i * 3 + 2] = ENCODINGS.srgb.toLinear(data[i * 4 + 2] / 255);
    }
    return out;
  }

  if (renderer) renderer.imageRect = [0, 0, 1, 1];
  return renderChart(sourceId === 'still' ? 'checker' : sourceId, w, h);
}

function refreshSource(): void {
  const r = ensureRenderer();
  if (!r) return;
  const { w, h } = stageSize();
  const linear = buildLinearSource(w, h);

  // Into the space the LUT expects.
  const encode = ENCODINGS[encodingId].fromLinear;
  const encoded = new Float32Array(linear.length);
  for (let i = 0; i < linear.length; i++) encoded[i] = encode(linear[i]);

  r.setSource(encoded, w, h);
  r.draw();
}

function updateNote(): void {
  const note = $('pvNote');
  const declared = lut?.meta.inputCS ?? '';
  const suggested = encodingForColorSpace(declared);

  if (!declared) {
    note.className = 'pc-note warn';
    note.textContent =
      'This LUT declares no InputColorSpace — the encoding above is a guess.';
    return;
  }
  if (!suggested) {
    note.className = 'pc-note warn';
    note.textContent = `Declares "${declared}", which maps to no known curve.`;
    return;
  }
  if (suggested !== encodingId) {
    note.className = 'pc-note warn';
    note.textContent = `LUT declares ${declared} — expected ${ENCODINGS[suggested].label}.`;
    return;
  }
  note.className = 'pc-note';
  note.textContent = `Matches the LUT's declared ${declared}.`;
}

export function setLut(next: Lut | null): void {
  lut = next;
  $('mixRow').hidden = !next;
  const r = ensureRenderer();
  if (!r) return;
  r.mix = mixValue;
  r.setLut(next);

  // Follow the LUT's declared input space until the user overrides it.
  if (next && encodingAuto) {
    const suggested = encodingForColorSpace(next.meta.inputCS);
    if (suggested) {
      encodingId = suggested;
      $<HTMLSelectElement>('pvEncoding').value = suggested;
    }
  }
  updateNote();
  redraw();
}

export async function setStill(file: File): Promise<void> {
  const bitmap = await createImageBitmap(file);
  const cap = 1600;
  const scale = Math.min(1, cap / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));

  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  const data = ctx.getImageData(0, 0, w, h).data;
  const linear = new Float32Array(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    linear[i * 3] = ENCODINGS.srgb.toLinear(data[i * 4] / 255);
    linear[i * 3 + 1] = ENCODINGS.srgb.toLinear(data[i * 4 + 1] / 255);
    linear[i * 3 + 2] = ENCODINGS.srgb.toLinear(data[i * 4 + 2] / 255);
  }

  still = { name: file.name, linear, w, h };

  const sel = $<HTMLSelectElement>('pvSource');
  if (!sel.querySelector('option[value="still"]')) {
    sel.append(Object.assign(document.createElement('option'), { value: 'still' }));
  }
  (sel.querySelector('option[value="still"]') as HTMLOptionElement).textContent = file.name;
  sel.value = 'still';
  sourceId = 'still';

  showImageTab();
  refreshSource();
}

export function hasStill(): boolean {
  return still !== null;
}

/** The dropped still as scene-linear RGB, for the look sheet to reuse. */
export function stillSource(): { linear: Float32Array; w: number; h: number; name: string } | null {
  return still;
}

type Tab = 'curve' | 'image' | 'scopes' | 'cube';

function ensureCube(): CubeView | null {
  if (cube || cubeFailed) return cube;
  try {
    cube = new CubeView($<HTMLCanvasElement>('cubeCanvas'));
  } catch {
    cubeFailed = true;
  }
  return cube;
}
let activeTab: Tab = 'curve';

function drawScopes(): void {
  const r = ensureRenderer();
  if (!r) return;

  // The scopes need a graded frame, which means the preview must render even
  // though its canvas is hidden behind the scope stack.
  canvas().hidden = false;
  refreshSource();
  const px = r.readGraded();
  canvas().hidden = true;

  const dpr = window.devicePixelRatio || 1;
  for (const [id, fn] of [
    ['waveformCanvas', drawWaveform],
    ['vectorCanvas', drawVectorscope],
  ] as const) {
    const c = $<HTMLCanvasElement>(id);
    const w = Math.max(1, Math.round(c.clientWidth * dpr));
    const h = Math.max(1, Math.round(c.clientHeight * dpr));
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    if (ctx) fn(ctx, px, w, h);
  }
}

function showTab(which: Tab): void {
  activeTab = which;
  $('tabCurve').classList.toggle('active', which === 'curve');
  $('tabImage').classList.toggle('active', which === 'image');
  $('tabScopes').classList.toggle('active', which === 'scopes');
  $('tabCube').classList.toggle('active', which === 'cube');

  $<HTMLCanvasElement>('vizCanvas').hidden = which !== 'curve';
  $('scopeStack').hidden = which !== 'scopes';
  $<HTMLCanvasElement>('cubeCanvas').hidden = which !== 'cube';
  // The cube plots the LUT itself; the source and encoding controls don't
  // apply to it.
  $('previewControls').hidden = which === 'curve' || which === 'cube';
  $('mixRow').hidden = !lut;

  if (which === 'curve') {
    canvas().hidden = true;
    $('previewError').hidden = true;
    return;
  }

  if (which === 'cube') {
    canvas().hidden = true;
    $('previewError').hidden = true;
    const c = ensureCube();
    if (c) {
      c.mix = mixValue;
      c.setLut(lut);
      // The canvas has no size until the browser has laid out the newly
      // revealed element, so draw on the next frame rather than this one.
      requestAnimationFrame(() => requestAnimationFrame(() => c.draw()));
    }
    return;
  }

  ensureRenderer();
  if (rendererFailed) return;

  if (which === 'image') {
    canvas().hidden = false;
    refreshSource();
  } else {
    drawScopes();
  }
}

export function showImageTab(): void {
  showTab('image');
}

/** Set LUT strength, 0-1, and refresh whichever view is showing. */
export function setMix(next: number): void {
  mixValue = Math.max(0, Math.min(1, next));
  $<HTMLInputElement>('pvMix').value = String(Math.round(mixValue * 100));
  $('pvMixValue').textContent = `${Math.round(mixValue * 100)}%`;
  if (renderer) renderer.mix = mixValue;
  if (cube) cube.mix = mixValue;
  onMixChange(mixValue);
  redraw();
}

export function mix(): number {
  return mixValue;
}

export function redraw(): void {
  if (activeTab === 'curve') return;
  if (activeTab === 'cube') {
    const c = ensureCube();
    if (c) {
      c.mix = mixValue;
      c.setLut(lut);
      requestAnimationFrame(() => c.draw());
    }
    return;
  }
  if (activeTab === 'scopes') drawScopes();
  else refreshSource();
}

export function init(onMix: (mix: number) => void = () => {}): void {
  onMixChange = onMix;
  const sourceSel = $<HTMLSelectElement>('pvSource');
  for (const chart of CHARTS) {
    sourceSel.append(
      Object.assign(document.createElement('option'), {
        value: chart.id,
        textContent: chart.label,
      }),
    );
  }
  sourceSel.value = sourceId;

  const encSel = $<HTMLSelectElement>('pvEncoding');
  for (const enc of ENCODING_LIST) {
    encSel.append(
      Object.assign(document.createElement('option'), {
        value: enc.id,
        textContent: enc.label,
      }),
    );
  }
  encSel.value = encodingId;

  $('tabCurve').addEventListener('click', () => showTab('curve'));
  $('tabImage').addEventListener('click', () => showTab('image'));
  $('tabScopes').addEventListener('click', () => showTab('scopes'));
  $('tabCube').addEventListener('click', () => showTab('cube'));

  sourceSel.addEventListener('change', () => {
    sourceId = sourceSel.value as ChartId | 'still';
    redraw();
  });

  encSel.addEventListener('change', () => {
    encodingId = encSel.value as EncodingId;
    encodingAuto = false;
    updateNote();
    redraw();
  });

  const setInterp = (mode: Interpolation) => {
    $('pvTetra').classList.toggle('active', mode === 'tetrahedral');
    $('pvTri').classList.toggle('active', mode === 'trilinear');
    if (renderer) {
      renderer.interpolation = mode;
      redraw();
    }
  };
  $('pvTetra').addEventListener('click', () => setInterp('tetrahedral'));
  $('pvTri').addEventListener('click', () => setInterp('trilinear'));

  const mix = $<HTMLInputElement>('pvMix');
  mix.addEventListener('input', () => {
    setMix(Number(mix.value) / 100);
  });

  // Redrawing the scopes means a full readPixels plus a CPU pass over every
  // pixel, so coalesce bursts of resizes into one redraw at the end.
  let resizeTimer: number | undefined;
  window.addEventListener('resize', () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(redraw, 90);
  });
}

/** Exposed so tests and diagnostics can read pixels back. */
export function debugRenderer(): PreviewRenderer | null {
  return renderer;
}
