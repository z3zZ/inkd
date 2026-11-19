import { describe, expect, it } from "vitest";
import type { Stroke } from "../canvas/strokes";
import { noteLatex } from "./export";
import { lineKey, type NoteMeta, NoteFormatError, newNoteId, parseNote, serializeNote } from "./format";

const meta: NoteMeta = { id: "nabc-123456", title: "Fractions", createdAt: 1, updatedAt: 2, preview: ["x=5"] };

const stroke = (id: number, points: [number, number, number][]): Stroke => ({
  id,
  points,
  simulatePressure: false,
  size: 4.5,
  startedAt: 0,
  endedAt: 0,
});

describe("note files", () => {
  it("round-trips strokes, readings and details", () => {
    const strokes = [stroke(3, [[10.123456, 20.5, 0.51234], [11, 21, 0.6]]), stroke(9, [[5, 5, 0.5]])];
    const lines = [{ strokes: [9, 3], latex: "x=5" }];
    const note = parseNote(JSON.stringify(serializeNote(meta, strokes, lines)));

    expect(note.meta).toEqual(meta);
    expect(note.lines).toEqual(lines);
    expect(note.strokes.map((s) => s.id)).toEqual([3, 9]);
    // Rounded to keep files small, well below anything visible.
    expect(note.strokes[0].points[0]).toEqual([10.12, 20.5, 0.512]);
    expect(note.strokes[1].points).toEqual([[5, 5, 0.5]]);
  });

  it("rejects files it cannot trust", () => {
    expect(() => parseNote("not json")).toThrow(NoteFormatError);
    expect(() => parseNote("{}")).toThrow(NoteFormatError);
    const good = serializeNote(meta, [stroke(1, [[0, 0, 0.5]])], []);
    expect(() => parseNote(JSON.stringify({ ...good, version: 99 }))).toThrow(/newer version/);
    const badPoints = { ...good, strokes: [{ ...good.strokes[0], points: [1, 2] }] };
    expect(() => parseNote(JSON.stringify(badPoints))).toThrow(NoteFormatError);
  });

  it("keeps what the model read when a line was corrected", () => {
    const lines = [
      { strokes: [1], latex: "x=5", original: "\[x=s\]" },
      { strokes: [2], latex: "2x=" },
    ];
    const note = parseNote(JSON.stringify(serializeNote(meta, [stroke(1, [[0, 0, 0.5]]), stroke(2, [[0, 50, 0.5]])], lines)));
    expect(note.lines).toEqual(lines);
    expect("original" in note.lines[1]).toBe(false);
  });

  it("drops damaged readings but keeps the ink", () => {
    const good = serializeNote(meta, [stroke(1, [[0, 0, 0.5]])], []);
    const note = parseNote(JSON.stringify({ ...good, lines: [{ strokes: "1", latex: 4 }, { strokes: [1], latex: "2=" }] }));
    expect(note.strokes).toHaveLength(1);
    expect(note.lines).toEqual([{ strokes: [1], latex: "2=" }]);
  });

  it("keys a line by its strokes in any order", () => {
    expect(lineKey([10, 2, 3])).toBe(lineKey([3, 10, 2]));
    expect(lineKey([1, 2])).not.toBe(lineKey([1, 2, 3]));
  });

  it("makes ids the backend accepts", () => {
    for (let i = 0; i < 50; i++) expect(newNoteId()).toMatch(/^[a-z0-9-]{1,64}$/);
  });
});

describe("LaTeX export", () => {
  it("fills in answers after the equals sign and keeps other lines as written", () => {
    const at = { left: 0, top: 0 };
    expect(
      noteLatex([
        { latex: "x=5", result: null },
        { latex: "2x=", result: { value: "10", ...at } },
        { latex: "f(x)=x^2+1", result: null },
      ]),
    ).toBe("x=5\n2x= 10\nf(x)=x^2+1");
  });

  it("drops the model's display delimiters so answers still go after the equals sign", () => {
    expect(
      noteLatex([
        { latex: "\\[f \\left( 2 \\right)=\\]", result: { value: "5", left: 0, top: 0 } },
        { latex: "\\[3+4=\\]", result: null },
      ]),
    ).toBe("f \\left( 2 \\right)= 5\n3+4=");
  });
});
