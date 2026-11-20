import type { Plot } from "../math/engine";

/** What part of the plane is on screen. */
export interface Viewport {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

/** A tick spacing of 1, 2 or 5 × 10ⁿ giving about `target` ticks across `span`. */
export function niceStep(span: number, target: number): number {
  const raw = span / Math.max(1, target);
  const power = 10 ** Math.floor(Math.log10(raw));
  const scaled = raw / power;
  const nice = scaled < 1.5 ? 1 : scaled < 3.5 ? 2 : scaled < 7.5 ? 5 : 10;
  return nice * power;
}

/** Multiples of `step` from min to max, without float noise such as 0.30000000000000004. */
export function ticks(min: number, max: number, step: number): number[] {
  const out: number[] = [];
  const decimals = Math.max(0, -Math.floor(Math.log10(step)) + 1);
  for (let i = Math.ceil(min / step - 1e-9); i * step <= max + step * 1e-9; i++) {
    out.push(Number((i * step).toFixed(decimals)));
  }
  return out;
}

/** A tick label: as many decimals as the step needs, and "−" for minus. */
export function formatTick(value: number, step: number): string {
  const decimals = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
  const text = Math.abs(value) >= 1e6 || (value !== 0 && Math.abs(value) < 1e-4) ? value.toExponential(1) : value.toFixed(decimals);
  return text.replace("-", "−");
}

/**
 * Samples a curve across the view as runs of connected points. A run ends where the curve
 * is undefined, or where it leaps off screen and back between neighbouring samples, as at
 * an asymptote, so no false vertical line is drawn there.
 */
export function sampleCurve(at: Plot, view: Viewport, samples: number): [number, number][][] {
  const runs: [number, number][][] = [];
  let run: [number, number][] = [];
  const height = view.yMax - view.yMin;
  let previous: number | null = null;
  for (let i = 0; i <= samples; i++) {
    const x = view.xMin + ((view.xMax - view.xMin) * i) / samples;
    const y = at(x);
    if (!Number.isFinite(y)) {
      if (run.length) runs.push(run);
      run = [];
      previous = null;
      continue;
    }
    if (previous !== null) {
      const above = (v: number) => v > view.yMax;
      const below = (v: number) => v < view.yMin;
      // A jump of more than a screen that crosses from above to below (or back): an asymptote.
      const leap = Math.abs(y - previous) > height && ((above(previous) && below(y)) || (below(previous) && above(y)));
      if (leap) {
        if (run.length) runs.push(run);
        run = [];
      }
    }
    run.push([x, y]);
    previous = y;
  }
  if (run.length) runs.push(run);
  return runs;
}

/**
 * The starting view. Like a graphing calculator: x from −10 to 10 with equal units on both
 * axes (so `aspect`, the plot's height over its width, sets the y range), centred on the origin.
 * Only if some curve would not appear there at all does it fit the curves' values instead,
 * ignoring the huge ones near asymptotes so 1/x stays readable.
 */
export function fitView(curves: readonly Plot[], aspect = 1): Viewport {
  const xMin = -10;
  const xMax = 10;
  const half = 10 * aspect;
  const standard = { xMin, xMax, yMin: -half, yMax: half };
  const samples = (at: Plot) => {
    const out: number[] = [];
    for (let i = 0; i <= 200; i++) {
      const y = at(xMin + ((xMax - xMin) * i) / 200);
      if (Number.isFinite(y)) out.push(y);
    }
    return out;
  };
  const all = curves.map(samples);
  if (all.every((values) => values.some((y) => y >= -half && y <= half))) return standard;

  const values = all.flat().sort((a, b) => a - b);
  if (values.length < 2) return standard;
  let low = values[Math.floor(values.length * 0.05)];
  let high = values[Math.ceil(values.length * 0.95) - 1];
  // Keep the x-axis in view when the curves are near it, so there is a reference line.
  if (low > 0 && low < (high - low) * 0.5) low = 0;
  if (high < 0 && -high < (high - low) * 0.5) high = 0;
  if (high - low < 1e-9) {
    low -= 5;
    high += 5;
  }
  const pad = (high - low) * 0.1;
  return { xMin, xMax, yMin: low - pad, yMax: high + pad };
}
