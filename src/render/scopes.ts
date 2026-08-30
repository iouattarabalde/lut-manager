/**
 * Waveform and vectorscope, drawn from the graded preview pixels.
 *
 * These read the LUT's *output*, so they answer the questions a colorist
 * actually asks of a LUT: where does it put black and white, does it clip,
 * and which way does it push hue and saturation.
 */

export interface Pixels {
  data: Uint8Array;
  w: number;
  h: number;
}

const BG = '#131316';
const PANEL = '#1b1b20';

function frame(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = PANEL;
  ctx.beginPath();
  // roundRect throws on a radius larger than half the shorter side.
  ctx.roundRect(0, 0, w, h, Math.min(4, w / 2, h / 2));
  ctx.fill();
}

/**
 * Below this the scope is too small to read, and the geometry starts
 * producing negative radii. The panel is resizable, so this is reachable.
 */
const MIN_SIZE = 24;

/**
 * RGB-overlay waveform. Columns map to image columns, height to code value,
 * and the three channels accumulate additively the way a hardware scope does.
 */
export function drawWaveform(
  ctx: CanvasRenderingContext2D,
  px: Pixels,
  w: number,
  h: number,
): void {
  frame(ctx, w, h);
  if (!px.w || !px.h || w < MIN_SIZE || h < MIN_SIZE) return;

  const pad = 6;
  const gw = Math.max(1, Math.floor(w - pad * 2));
  const gh = Math.max(1, Math.floor(h - pad * 2));

  // Accumulate into an RGB density buffer.
  const acc = new Float32Array(gw * gh * 3);
  const colStep = px.w / gw;

  for (let gx = 0; gx < gw; gx++) {
    const x0 = Math.floor(gx * colStep);
    const x1 = Math.max(x0 + 1, Math.floor((gx + 1) * colStep));
    for (let x = x0; x < x1 && x < px.w; x++) {
      for (let y = 0; y < px.h; y++) {
        // readPixels is bottom-up; the scope's own Y is also bottom-up.
        const o = (y * px.w + x) * 4;
        for (let c = 0; c < 3; c++) {
          const v = px.data[o + c] / 255;
          const gy = Math.min(gh - 1, Math.floor(v * (gh - 1)));
          acc[((gh - 1 - gy) * gw + gx) * 3 + c] += 1;
        }
      }
    }
  }

  let peak = 0;
  for (let i = 0; i < acc.length; i++) if (acc[i] > peak) peak = acc[i];
  if (peak <= 0) return;

  const img = ctx.createImageData(gw, gh);
  const gain = 3.2;
  for (let i = 0; i < gw * gh; i++) {
    for (let c = 0; c < 3; c++) {
      const d = acc[i * 3 + c] / peak;
      img.data[i * 4 + c] = Math.min(255, Math.round(Math.sqrt(d) * gain * 255));
    }
    img.data[i * 4 + 3] = 255;
  }

  // Composite over the panel so the graticule shows through the dark areas.
  const tmp = document.createElement('canvas');
  tmp.width = gw;
  tmp.height = gh;
  tmp.getContext('2d')!.putImageData(img, 0, 0);

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.drawImage(tmp, pad, pad);
  ctx.restore();

  // Graticule at 0, 25, 50, 75, 100 IRE.
  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.fillStyle = 'rgba(200,200,200,0.35)';
  ctx.font = "500 8px 'IBM Plex Mono', monospace";
  ctx.lineWidth = 0.5;
  for (let i = 0; i <= 4; i++) {
    const y = pad + (gh * i) / 4;
    ctx.beginPath();
    ctx.moveTo(pad, y);
    ctx.lineTo(pad + gw, y);
    ctx.stroke();
    ctx.fillText(String(100 - i * 25), pad + 2, y - 2);
  }
  ctx.fillText('WAVEFORM', pad + gw - 58, pad + 9);
}

/** Rec.709 luma coefficients, matching how the targets below are placed. */
const KR = 0.2126;
const KB = 0.0722;
const KG = 1 - KR - KB;

/** Vectorscope: Cb/Cr scatter with the six primary/secondary targets. */
export function drawVectorscope(
  ctx: CanvasRenderingContext2D,
  px: Pixels,
  w: number,
  h: number,
): void {
  frame(ctx, w, h);
  if (!px.w || !px.h || w < MIN_SIZE || h < MIN_SIZE) return;

  const size = Math.min(w, h);
  const cx = w / 2;
  const cy = h / 2;
  // Never let the inset drive this negative on a narrow panel.
  const radius = Math.max(4, size / 2 - 8);

  // Graticule: rings and cross hairs.
  ctx.strokeStyle = 'rgba(255,255,255,0.14)';
  ctx.lineWidth = 0.5;
  for (const r of [0.25, 0.5, 0.75, 1]) {
    ctx.beginPath();
    ctx.arc(cx, cy, radius * r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(cx - radius, cy);
  ctx.lineTo(cx + radius, cy);
  ctx.moveTo(cx, cy - radius);
  ctx.lineTo(cx, cy + radius);
  ctx.stroke();

  // Scatter, accumulated into a density buffer rather than drawn point by
  // point: a chart with few distinct colors would otherwise be almost
  // invisible, while a photograph would blow out.
  const step = Math.max(1, Math.floor(Math.sqrt((px.w * px.h) / 120000)));
  const sw = Math.max(1, Math.round(w));
  const sh = Math.max(1, Math.round(h));
  const acc = new Float32Array(sw * sh * 3);
  let peak = 0;

  for (let y = 0; y < px.h; y += step) {
    for (let x = 0; x < px.w; x += step) {
      const o = (y * px.w + x) * 4;
      const r = px.data[o] / 255;
      const g = px.data[o + 1] / 255;
      const b = px.data[o + 2] / 255;
      const luma = KR * r + KG * g + KB * b;
      const cb = (b - luma) / (2 * (1 - KB));
      const cr = (r - luma) / (2 * (1 - KR));
      const dx = Math.round(cx + cb * radius * 2);
      const dy = Math.round(cy - cr * radius * 2);
      // Splat over a small footprint: a single device pixel is invisible on
      // a high-DPR canvas.
      for (let oy = 0; oy < 2; oy++) {
        for (let ox = 0; ox < 2; ox++) {
          const px2 = dx + ox;
          const py2 = dy + oy;
          if (px2 < 0 || py2 < 0 || px2 >= sw || py2 >= sh) continue;
          const i = (py2 * sw + px2) * 3;
          acc[i] += r;
          acc[i + 1] += g;
          acc[i + 2] += b;
          const m = Math.max(acc[i], acc[i + 1], acc[i + 2]);
          if (m > peak) peak = m;
        }
      }
    }
  }

  if (peak > 0) {
    const img = ctx.createImageData(sw, sh);
    for (let i = 0; i < sw * sh; i++) {
      let any = 0;
      for (let c = 0; c < 3; c++) {
        // Cube root keeps sparse points visible without crushing dense ones.
        const d = Math.cbrt(acc[i * 3 + c] / peak);
        const v = Math.min(255, Math.round(d * 255));
        img.data[i * 4 + c] = v;
        if (v > any) any = v;
      }
      img.data[i * 4 + 3] = any;
    }
    const tmp = document.createElement('canvas');
    tmp.width = sw;
    tmp.height = sh;
    tmp.getContext('2d')!.putImageData(img, 0, 0);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(tmp, 0, 0);
    ctx.restore();
  }

  // Primary and secondary targets at 75% bars.
  const targets: [string, [number, number, number]][] = [
    ['R', [1, 0, 0]], ['Y', [1, 1, 0]], ['G', [0, 1, 0]],
    ['C', [0, 1, 1]], ['B', [0, 0, 1]], ['M', [1, 0, 1]],
  ];
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.fillStyle = 'rgba(230,230,230,0.75)';
  ctx.font = "500 8px 'IBM Plex Mono', monospace";
  ctx.lineWidth = 1;
  for (const [label, rgb] of targets) {
    const [r, g, b] = rgb.map((v) => v * 0.75) as [number, number, number];
    const luma = KR * r + KG * g + KB * b;
    const cb = (b - luma) / (2 * (1 - KB));
    const cr = (r - luma) / (2 * (1 - KR));
    const dx = cx + cb * radius * 2;
    const dy = cy - cr * radius * 2;
    ctx.beginPath();
    ctx.rect(dx - 3, dy - 3, 6, 6);
    ctx.stroke();
    ctx.fillText(label, dx + 5, dy + 3);
  }

  ctx.fillStyle = 'rgba(200,200,200,0.35)';
  ctx.fillText('VECTORSCOPE', 8, 14);
}
