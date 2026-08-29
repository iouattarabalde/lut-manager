/**
 * Analysis readouts: the numbers a colorist wants before shipping a LUT.
 * Reads whatever is currently on screen, so staged operations are reflected.
 */

import { type Lut } from '../core/lut.js';
import { type Check, analyze, runChecks } from '../core/analyze.js';
import { $ } from './dom.js';

const pct = (v: number): string =>
  v === 0 ? '0%' : v >= 0.01 ? `${(v * 100).toFixed(1)}%` : `${(v * 100).toFixed(2)}%`;

/** A small colour chip so black/white/mid points read at a glance. */
function swatch(rgb: [number, number, number]): string {
  const to8 = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255);
  return `<span class="metric-swatch" style="background:rgb(${to8(rgb[0])},${to8(rgb[1])},${to8(rgb[2])})"></span>`;
}

const triplet = (rgb: [number, number, number]): string =>
  rgb.map((v) => v.toFixed(3)).join(' ');

interface Metric {
  label: string;
  value: string;
  sub?: string;
  bad?: boolean;
}

export function render(lut: Lut | null, subject = ''): void {
  const box = $('metrics');
  const checksBox = $('checks');
  $('analysisSubject').textContent = subject;

  if (!lut) {
    box.replaceChildren();
    checksBox.replaceChildren();
    return;
  }

  const m = analyze(lut);

  const metrics: Metric[] = [
    {
      label: 'Black point',
      value: `${swatch(m.blackPoint)}${triplet(m.blackPoint)}`,
      sub: 'output at input 0',
    },
    {
      label: 'White point',
      value: `${swatch(m.whitePoint)}${triplet(m.whitePoint)}`,
      sub: 'output at input 1',
    },
    {
      label: 'Mid point',
      value: `${swatch(m.midPoint)}${triplet(m.midPoint)}`,
      sub: 'neutral at mid input',
    },
    {
      label: 'Contrast',
      value: m.midSlope.toFixed(2) + '×',
      sub: 'slope at mid',
    },
    {
      label: 'Clipped high',
      value: pct(m.clippedHigh),
      sub: 'values ≥ 1.0',
      bad: m.clippedHigh > 0.02,
    },
    {
      label: 'Clipped low',
      value: pct(m.clippedLow),
      sub: 'values ≤ 0.0',
      bad: m.clippedLow > 0.02,
    },
    {
      label: 'Max deviation',
      value: m.maxDeviation.toFixed(4),
      sub: 'vs identity',
    },
    {
      label: 'Neutral',
      value: m.neutralMonotonic ? 'monotonic' : 'reverses',
      sub: m.neutralMonotonic ? 'no inversions' : 'banding risk',
      bad: !m.neutralMonotonic,
    },
    {
      label: 'Channels',
      value: m.isChannelIndependent ? 'independent' : 'cross-linked',
      sub: m.isChannelIndependent ? 'reducible to 1D' : 'genuinely 3D',
    },
    {
      label: 'Grid',
      value: `${lut.dims}D · ${lut.size}`,
      sub: m.isIdentity ? 'identity — does nothing' : 'active transform',
      bad: m.isIdentity,
    },
  ];

  box.replaceChildren(
    ...metrics.map((metric) => {
      const el = document.createElement('div');
      el.className = 'metric';
      const label = document.createElement('div');
      label.className = 'metric-label';
      label.textContent = metric.label;
      const value = document.createElement('div');
      value.className = `metric-value${metric.bad ? ' bad' : ''}`;
      value.innerHTML = metric.value;
      el.append(label, value);
      if (metric.sub) {
        const sub = document.createElement('div');
        sub.className = 'metric-sub';
        sub.textContent = metric.sub;
        el.append(sub);
      }
      return el;
    }),
  );

  renderChecks(checksBox, runChecks(lut, m));
}

function renderChecks(box: HTMLElement, checks: Check[]): void {
  box.replaceChildren(
    ...checks.map((check) => {
      const el = document.createElement('div');
      el.className = `check check-${check.level}`;
      const level = document.createElement('span');
      level.className = 'check-level';
      level.textContent = check.level;
      const msg = document.createElement('span');
      msg.textContent = check.message;
      el.append(level, msg);
      return el;
    }),
  );
}
