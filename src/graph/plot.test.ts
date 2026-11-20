import { describe, expect, it } from "vitest";
import { fitView, formatTick, niceStep, sampleCurve, ticks } from "./plot";

describe("axis ticks", () => {
  it("picks 1, 2 or 5 times a power of ten", () => {
    expect(niceStep(20, 10)).toBe(2);
    expect(niceStep(1, 10)).toBe(0.1);
    expect(niceStep(700, 8)).toBe(100);
    expect(niceStep(30, 8)).toBe(5);
  });

  it("lists ticks without float noise", () => {
    expect(ticks(-0.3, 0.3, 0.1)).toEqual([-0.3, -0.2, -0.1, 0, 0.1, 0.2, 0.3]);
    expect(ticks(-10, 10, 5)).toEqual([-10, -5, 0, 5, 10]);
  });

  it("labels ticks with the decimals the step needs", () => {
    expect(formatTick(2, 1)).toBe("2");
    expect(formatTick(-0.5, 0.1)).toBe("−0.5");
    expect(formatTick(0.25, 0.05)).toBe("0.25");
  });
});

describe("sampling curves", () => {
  const view = { xMin: -5, xMax: 5, yMin: -5, yMax: 5 };

  it("draws a smooth curve as one run", () => {
    const runs = sampleCurve((x) => x * x, view, 100);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toHaveLength(101);
  });

  it("breaks at an asymptote instead of drawing a vertical line", () => {
    const runs = sampleCurve((x) => 1 / x, view, 101);
    expect(runs).toHaveLength(2);
    expect(runs[0].every(([x]) => x < 0)).toBe(true);
    expect(runs[1].every(([x]) => x > 0)).toBe(true);
  });

  it("leaves gaps where the curve is undefined", () => {
    const runs = sampleCurve((x) => Math.sqrt(x), view, 100);
    expect(runs).toHaveLength(1);
    expect(runs[0][0][0]).toBeGreaterThanOrEqual(0);
  });

  it("keeps steep but continuous curves in one piece", () => {
    expect(sampleCurve((x) => x ** 3, view, 100)).toHaveLength(1);
  });
});

describe("fitting the view", () => {
  it("starts with equal units around the origin when the curves pass through it", () => {
    expect(fitView([(x) => x * x - 3, (x) => 2 * x + 1], 0.8)).toEqual({ xMin: -10, xMax: 10, yMin: -8, yMax: 8 });
    expect(fitView([(x) => 1 / x], 1)).toEqual({ xMin: -10, xMax: 10, yMin: -10, yMax: 10 });
  });

  it("fits the values when a curve would be off screen, with the x-axis kept in view", () => {
    const view = fitView([(x) => x * x + 20]);
    expect(view.yMin).toBeLessThanOrEqual(0);
    expect(view.yMax).toBeGreaterThan(100);
  });

  it("ignores the huge values near an asymptote when fitting", () => {
    const view = fitView([(x) => 1 / x + 100]);
    expect(view.yMax).toBeLessThan(150);
    expect(view.yMin).toBeGreaterThan(50);
  });

  it("falls back to a standard view with nothing to show", () => {
    expect(fitView([])).toEqual({ xMin: -10, xMax: 10, yMin: -10, yMax: 10 });
  });
});
