/**
 * Analysis panel.
 *
 * One sentence, then four pictures: the grey ramp, the three tonal zones, the
 * tone curve, and where black and white land. Anything only a number can say
 * (clipping, odd sizes) shows up as a check below, and only when it matters.
 */

import { type Lut } from '../core/lut.js';
import { type Check, analyze } from '../core/analyze.js';
import { runChecks } from '../core/analyze.js';
import {
  rampStrip,
  swatchPair,
  toneCurve,
  zoneSwatches,
} from '../render/analysis-graphics.js';
import { describe as describeLut } from '../core/describe.js';
import { $ } from './dom.js';

interface Card {
  title: string;
  /** Plain-language reading of the visual. */
  caption: string;
  visual: Element;
  wide?: boolean;
  bad?: boolean;
}

/** How a contrast slope reads in words. */
function contrastWord(slope: number): string {
  if (slope > 1.6) return 'much more contrast';
  if (slope > 1.15) return 'more contrast';
  if (slope > 0.9) return 'about the same contrast';
  if (slope > 0.6) return 'softer, flatter';
  return 'much flatter';
}

function castWord(lut: Lut): string {
  const m = analyze(lut);
  const dev = (rgb: [number, number, number]) => {
    const mean = (rgb[0] + rgb[1] + rgb[2]) / 3;
    return [rgb[0] - mean, rgb[1] - mean, rgb[2] - mean];
  };
  const [dr, , db] = dev(m.midPoint);
  const warm = dr - db;
  if (Math.abs(warm) < 0.004) return 'neutral through the midtones';
  return warm > 0 ? 'warmer through the midtones' : 'cooler through the midtones';
}

export function render(lut: Lut | null, subject = ''): void {
  const box = $('metrics');
  const checksBox = $('checks');
  $('analysisSubject').textContent = subject;

  if (!lut) {
    box.replaceChildren();
    checksBox.replaceChildren();
    $('analysisSummary').replaceChildren();
    return;
  }

  const m = analyze(lut);
  const summary = describeLut(lut, m);
  renderSummary(summary);

  const zoneLabels = summary.zones
    .map((z) => {
      const level =
        Math.abs(z.levelShift) < 0.02
          ? 'held'
          : `${z.levelShift > 0 ? 'up' : 'down'} ${Math.round(Math.abs(z.levelShift) * 100)}%`;
      const tint = z.tint === 'neutral' ? 'neutral' : z.tint;
      return `${z.name.toLowerCase()} ${level}, ${tint}`;
    })
    .join(' · ');

  const lifted = m.blackPoint[0] > 0.02;
  const heldBack = m.whitePoint[0] < 0.98;
  const ends = document.createElement('div');
  ends.className = 'acard-ends';
  ends.append(swatchPair([0, 0, 0], m.blackPoint), swatchPair([1, 1, 1], m.whitePoint));

  const cards: Card[] = [
    {
      title: 'Grey ramp — input above, result below',
      caption: m.isIdentity
        ? 'unchanged — this LUT does nothing'
        : `${contrastWord(m.midSlope)}, ${castWord(lut)}`,
      visual: rampStrip(lut),
      wide: true,
      bad: m.isIdentity,
    },
    {
      title: 'Shadows · Midtones · Highlights',
      caption: zoneLabels,
      visual: zoneSwatches(summary.zones),
      wide: true,
    },
    {
      title: 'Tone curve',
      caption: `${m.midSlope.toFixed(2)}× at mid, against the dashed identity line`,
      visual: toneCurve(lut),
    },
    {
      title: 'Black · White',
      caption: `black → ${m.blackPoint[0].toFixed(3)}${lifted ? ' lifted' : ''} · white → ${m.whitePoint[0].toFixed(3)}${heldBack ? ' held back' : ''}`,
      visual: ends,
      bad: m.clippedHigh > 0.02 || m.clippedLow > 0.02,
    },
  ];

  box.replaceChildren(...cards.map(buildCard));
  // A missing TITLE is already obvious from the empty LUT Name field.
  renderChecks(checksBox, runChecks(lut, m).filter((c) => c.code !== 'no-title'));
}

/** The one-sentence read of the look. */
function renderSummary(summary: { headline: string }): void {
  const headline = document.createElement('p');
  headline.className = 'summary-headline';
  headline.textContent = summary.headline;
  $('analysisSummary').replaceChildren(headline);
}

function buildCard(card: Card): HTMLElement {
  const el = document.createElement('div');
  el.className = `acard${card.wide ? ' acard-wide' : ''}${card.bad ? ' acard-bad' : ''}`;

  const title = document.createElement('div');
  title.className = 'acard-title';
  title.textContent = card.title;

  const visual = document.createElement('div');
  visual.className = 'acard-visual';
  visual.append(card.visual);

  const caption = document.createElement('div');
  caption.className = 'acard-caption';
  caption.textContent = card.caption;

  el.append(title, visual, caption);
  return el;
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
