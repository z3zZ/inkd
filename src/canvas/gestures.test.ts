import { describe, expect, it } from "vitest";
import { synthesizeLine } from "../dev/synthInk";
import { TEST_LINES } from "../dev/testLines";
import { isScribble, scratchedOut } from "./gestures";
import type { InkPoint, Stroke } from "./strokes";

let id = 10_000;
const stroke = (points: [number, number][]): Stroke => ({
  id: id++,
  points: points.map(([x, y]): InkPoint => [x, y, 0.5]),
  simulatePressure: false,
  size: 4.5,
  startedAt: 0,
  endedAt: 0,
});

/** A back-and-forth scribble across [left, right] at height y, with some vertical drift. */
function zigzag(left: number, right: number, y: number, passes: number, drift = 30): Stroke {
  const points: [number, number][] = [];
  for (let i = 0; i <= passes; i++) {
    const x = i % 2 === 0 ? left : right;
    for (let t = 0; t <= 1; t += 0.25) {
      const from = i % 2 === 0 ? right : left;
      points.push([from + (x - from) * t, y + (drift * (i + t)) / passes - drift / 2]);
    }
  }
  return stroke(points);
}

describe("scribble detection", () => {
  it("recognises a back-and-forth scribble", () => {
    expect(isScribble(zigzag(0, 120, 50, 6))).toBe(true);
  });

  it("does not mistake written maths for a scribble", () => {
    const offenders: string[] = [];
    for (const [i, line] of TEST_LINES.entries()) {
      for (const s of synthesizeLine(line.synth, 40, 60, 1000 + i)) {
        if (isScribble(s)) offenders.push(line.id);
      }
    }
    // Extra shapes with a few turns each: W, M, z, and a squiggly approximately-equals.
    const shapes = [
      stroke([[0, 0], [10, 40], [20, 10], [30, 40], [40, 0]]),
      stroke([[0, 40], [10, 0], [20, 30], [30, 0], [40, 40]]),
      stroke([[0, 0], [30, 0], [0, 40], [30, 40]]),
      stroke([[0, 10], [10, 0], [20, 10], [30, 0], [40, 10]]),
      // A figure 8 in one stroke: round the top loop, across, round the bottom loop, back up.
      stroke([[15, 0], [0, 15], [15, 30], [30, 45], [15, 60], [0, 45], [15, 30], [30, 15], [15, 0]]),
    ];
    for (const s of shapes) if (isScribble(s)) offenders.push("shape");
    expect(offenders).toEqual([]);
  });
});

describe("scratch-out", () => {
  const written = synthesizeLine(["3", "+", "4", "="], 40, 60, 77);
  const elsewhere = synthesizeLine(["7"], 40, 260, 78);
  const all = [...written, ...elsewhere];
  const xs = written.flatMap((s) => s.points.map((p) => p[0]));
  const ys = written.flatMap((s) => s.points.map((p) => p[1]));
  const mid = (Math.min(...ys) + Math.max(...ys)) / 2;
  const height = Math.max(...ys) - Math.min(...ys);

  it("erases the ink a scribble covers and nothing else", () => {
    const scribble = zigzag(Math.min(...xs) - 5, Math.max(...xs) + 5, mid, 10, height);
    const gone = scratchedOut(scribble, all);
    expect(gone.length).toBeGreaterThan(0);
    expect(gone.every((s) => written.includes(s))).toBe(true);
    expect(gone.some((s) => elsewhere.includes(s))).toBe(false);
  });

  it("leaves a scribble on empty paper as ink", () => {
    expect(scratchedOut(zigzag(400, 500, 600, 8), all)).toEqual([]);
  });

  it("leaves ink alone when the stroke is not a scribble", () => {
    const line = stroke([[0, mid], [Math.max(...xs) + 10, mid]]);
    expect(scratchedOut(line, all)).toEqual([]);
  });
});
