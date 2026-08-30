/**
 * Neutral-axis plot: input ramp against the LUT's RGB response along r=g=b.
 *
 * Works for both 1D and 3D LUTs because it reads `neutralAxis`, which knows
 * how each is indexed. The previous version hard-coded the 3D stride and drew
 * nonsense for 1D files.
 */

import { type Lut, neutralAxis } from '../core/lut.js';

const CHANNELS = [
  { key: 0, color: 'rgba(220,80,60,0.55)' },
  { key: 1, color: 'rgba(80,190,100,0.55)' },
  { key: 2, color: 'rgba(80,140,220,0.55)' },
] as const;

export class CurveView {
  private ctx: CanvasRenderingContext2D;
  private lut: Lut | null = null;
  /** Optional second LUT, drawn as a dashed overlay for comparison. */
  private compare: { lut: Lut; label: string } | null = null;
  /** LUT strength, matching the other views. */
  mix = 1;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas context unavailable');
    this.ctx = ctx;
    // Cheap enough to keep up with a drag.
    window.addEventListener('resize', () => this.draw());
  }

  setLut(lut: Lut | null): void {
    this.lut = lut;
    this.draw();
  }

  setCompare(lut: Lut | null, label = ''): void {
    this.compare = lut ? { lut, label } : null;
    this.draw();
  }

  draw(): void {
    const { canvas, ctx } = this;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    // The panel is resizable; below this there is nothing meaningful to draw.
    if (w < 24 || h < 24 || !this.lut) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    ctx.fillStyle = '#131316';
    ctx.beginPath();
    ctx.roundRect(0, 0, w, h, Math.min(4, w / 2, h / 2));
    ctx.fill();

    // Blend each plotted value back toward the identity ramp.
    const raw = neutralAxis(this.lut);
    const axis = raw.map((p) => ({
      t: p.t,
      rgb: p.rgb.map((v, i) => p.t + (v - p.t) * this.mix) as typeof p.rgb,
    }));
    void 0;
    if (axis.length < 2) return;

    const pad = Math.min(20, w / 6, h / 6);
    const ip = 6;
    const pw = Math.max(1, w - pad * 2);
    const ph = Math.max(1, h - pad * 2);

    ctx.fillStyle = '#1b1b20';
    ctx.beginPath();
    ctx.roundRect(pad, pad, pw, ph, Math.min(4, pw / 2, ph / 2));
    ctx.fill();

    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 0.5;
    for (let i = 1; i < 4; i++) {
      const gx = pad + (pw * i) / 4;
      const gy = pad + (ph * i) / 4;
      ctx.beginPath();
      ctx.moveTo(gx, pad);
      ctx.lineTo(gx, pad + ph);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(pad, gy);
      ctx.lineTo(pad + pw, gy);
      ctx.stroke();
    }

    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(pad + ip, pad + ph - ip);
    ctx.lineTo(pad + pw - ip, pad + ip);
    ctx.stroke();
    ctx.setLineDash([]);

    const cx = (t: number) => pad + ip + t * (pw - ip * 2);
    const cy = (v: number) => pad + ph - ip - v * (ph - ip * 2);

    for (const ch of CHANNELS) {
      ctx.beginPath();
      axis.forEach((p, i) => {
        const x = cx(p.t);
        const y = cy(p.rgb[ch.key]);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.strokeStyle = ch.color;
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    ctx.beginPath();
    axis.forEach((p, i) => {
      const luma = (p.rgb[0] + p.rgb[1] + p.rgb[2]) / 3;
      const x = cx(p.t);
      const y = cy(luma);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 1.8;
    ctx.stroke();

    ctx.fillStyle = 'rgba(200,200,200,0.35)';
    ctx.font = "500 9px 'IBM Plex Mono', monospace";
    const label = this.lut.dims === 1 ? '1D RESPONSE' : 'NEUTRAL AXIS';
    ctx.fillText(`${label} · ${this.lut.size}`, pad + ip + 2, pad + ip + 10);
  }
}
