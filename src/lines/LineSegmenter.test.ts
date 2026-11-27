import { describe, expect, it } from "vitest";
import type { Stroke } from "../canvas/strokes";
import { LineSegmenter } from "./LineSegmenter";

let id = 1;
/** A straight stroke from (x0, y0) to (x1, y1). */
function stroke(x0: number, y0: number, x1: number, y1: number): Stroke {
  return { id: id++, points: [[x0, y0, 0.5], [x1, y1, 0.5]], simulatePressure: false, size: 4, startedAt: 0, endedAt: 0 };
}
/** A glyph-sized stroke 40 px tall with its top at y. */
const glyph = (x: number, y: number) => stroke(x, y, x + 20, y + 40);

describe("LineSegmenter", () => {
  it("keeps glyphs on one line together", () => {
    const s = new LineSegmenter();
    s.update([glyph(0, 100), glyph(30, 104), glyph(60, 98)], []);
    expect(s.all).toHaveLength(1);
  });

  it("separates lines with ordinary spacing", () => {
    const s = new LineSegmenter();
    s.update([glyph(0, 100), glyph(30, 100)], []);
    s.update([glyph(0, 170), glyph(30, 172)], []);
    expect(s.all.map((l) => l.strokes.length)).toEqual([2, 2]);
  });

  it("keeps a stacked fraction in one line, whatever order it is written in", () => {
    const s = new LineSegmenter();
    // numerator, denominator, then the bar between them
    s.update([glyph(0, 100)], []);
    s.update([glyph(0, 160)], []);
    s.update([stroke(-5, 150, 25, 150)], []);
    expect(s.all).toHaveLength(1);
    expect(s.all[0].strokes).toHaveLength(3);
  });

  it("reports the line ids that merged away", () => {
    const s = new LineSegmenter();
    s.update([glyph(0, 100)], []);
    s.update([glyph(0, 160)], []);
    const [top, bottom] = s.all;
    const { gone } = s.update([stroke(-5, 150, 25, 150)], []);
    expect(gone).toEqual([bottom.id]);
    expect(s.all[0].id).toBe(top.id);
  });

  it("drops a line when its last stroke is erased", () => {
    const s = new LineSegmenter();
    const a = glyph(0, 100);
    const b = glyph(0, 200);
    s.update([a, b], []);
    const lineB = s.all.find((l) => l.strokes.includes(b))!;
    const { gone, dirty } = s.update([], [b]);
    expect(gone).toEqual([lineB.id]);
    expect(dirty).toEqual([]);
    expect(s.all).toHaveLength(1);
  });

  it("splits lines again when the stroke that joined them is taken away", () => {
    const s = new LineSegmenter();
    const top = [glyph(0, 100), glyph(30, 100)];
    const bottom = [glyph(0, 170), glyph(30, 172)];
    s.update(top, []);
    s.update(bottom, []);
    // A stray tall mark running through both lines makes them one.
    const stray = stroke(60, 110, 62, 200);
    s.update([stray], []);
    expect(s.all).toHaveLength(1);
    const merged = s.all[0];

    const { dirty, gone } = s.update([], [stray]);
    expect(gone).toEqual([]);
    expect(dirty).toHaveLength(2);
    const lines = s.all.sort((a, b) => a.bbox.top - b.bbox.top);
    expect(lines.map((l) => l.strokes)).toEqual([top, bottom]);
    // The top part keeps the line's id; the rest becomes a new line.
    expect(lines[0].id).toBe(merged.id);
    expect(lines[1].id).not.toBe(merged.id);
  });

  it("keeps a line whole when erasing part of it leaves the rest touching", () => {
    const s = new LineSegmenter();
    const strokes = [glyph(0, 100), glyph(30, 104), glyph(60, 98)];
    s.update(strokes, []);
    const { dirty } = s.update([], [strokes[1]]);
    expect(s.all).toHaveLength(1);
    expect(dirty).toEqual([s.all[0]]);
    expect(s.all[0].strokes).toEqual([strokes[0], strokes[2]]);
  });

  it("keeps a stacked fraction together when another stroke on the line is erased", () => {
    const s = new LineSegmenter();
    const extra = glyph(60, 130);
    s.update([glyph(0, 100)], []);
    s.update([glyph(0, 160)], []);
    s.update([stroke(-5, 150, 25, 150)], []);
    s.update([extra], []);
    expect(s.all).toHaveLength(1);
    s.update([], [extra]);
    expect(s.all).toHaveLength(1);
    expect(s.all[0].strokes).toHaveLength(3);
  });
});
