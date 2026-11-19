import type { InkPoint, Stroke } from "../canvas/strokes";

export const NOTE_VERSION = 1;

/** A stroke as written to disk: points flattened to [x, y, pressure, x, y, pressure, …]. */
export interface SavedStroke {
  id: number;
  size: number;
  simulatePressure: boolean;
  points: number[];
}

/** What a line was read as, keyed by the strokes it was made of, so reopening a note needs no recognition. */
export interface SavedLine {
  strokes: number[];
  latex: string;
  /** Present when the reading was corrected by hand: what the model read. */
  original?: string;
}

export interface NoteMeta {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  /** The first lines as LaTeX, for the notes list. */
  preview: string[];
}

export interface NoteFile extends NoteMeta {
  version: number;
  strokes: SavedStroke[];
  lines: SavedLine[];
}

export interface OpenNote {
  meta: NoteMeta;
  strokes: Stroke[];
  lines: SavedLine[];
}

export class NoteFormatError extends Error {}

const round = (n: number, places: number) => {
  const f = 10 ** places;
  return Math.round(n * f) / f;
};

export function newNoteId(): string {
  const random = Math.floor(Math.random() * 36 ** 6).toString(36).padStart(6, "0");
  return `n${Date.now().toString(36)}-${random}`;
}

export function saveStroke(stroke: Stroke): SavedStroke {
  const points: number[] = [];
  for (const [x, y, p] of stroke.points) points.push(round(x, 2), round(y, 2), round(p, 3));
  return { id: stroke.id, size: stroke.size, simulatePressure: stroke.simulatePressure, points };
}

export function loadStroke(saved: SavedStroke): Stroke {
  const points: InkPoint[] = [];
  for (let i = 0; i + 2 < saved.points.length; i += 3) {
    points.push([saved.points[i], saved.points[i + 1], saved.points[i + 2]]);
  }
  return {
    id: saved.id,
    points,
    simulatePressure: saved.simulatePressure,
    size: saved.size,
    startedAt: 0,
    endedAt: 0,
  };
}

/** The key a line's recognition is cached under: its stroke ids, order-independent. */
export function lineKey(strokeIds: readonly number[]): string {
  return [...strokeIds].sort((a, b) => a - b).join(",");
}

export function serializeNote(meta: NoteMeta, strokes: readonly Stroke[], lines: readonly SavedLine[]): NoteFile {
  return { version: NOTE_VERSION, ...meta, strokes: strokes.map(saveStroke), lines: [...lines] };
}

const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function check(condition: boolean, what: string): asserts condition {
  if (!condition) throw new NoteFormatError(`note file is damaged: ${what}`);
}

/** Parses and checks a note file. Throws NoteFormatError on anything it cannot trust. */
export function parseNote(json: string): OpenNote {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new NoteFormatError("note file is not valid JSON");
  }
  check(typeof raw === "object" && raw !== null, "not an object");
  const note = raw as Partial<NoteFile>;
  check(isNumber(note.version), "no version");
  if (note.version! > NOTE_VERSION) {
    throw new NoteFormatError("this note was saved by a newer version of inkd");
  }
  check(typeof note.id === "string" && typeof note.title === "string", "id or title");
  check(isNumber(note.createdAt) && isNumber(note.updatedAt), "dates");
  check(Array.isArray(note.strokes) && Array.isArray(note.lines), "strokes or lines");

  const strokes = note.strokes!.map((s, i) => {
    check(
      isNumber(s?.id) && isNumber(s.size) && typeof s.simulatePressure === "boolean" && Array.isArray(s.points),
      `stroke ${i}`,
    );
    check(s.points.length >= 3 && s.points.length % 3 === 0 && s.points.every(isNumber), `stroke ${i} points`);
    return loadStroke(s);
  });
  const lines = note.lines!
    .filter(
      (l): l is SavedLine => Array.isArray(l?.strokes) && l.strokes.every(isNumber) && typeof l.latex === "string",
    )
    .map(({ strokes, latex, original }) =>
      typeof original === "string" ? { strokes, latex, original } : { strokes, latex },
    );
  const preview = Array.isArray(note.preview) ? note.preview.filter((p) => typeof p === "string") : [];

  return {
    meta: { id: note.id!, title: note.title!, createdAt: note.createdAt!, updatedAt: note.updatedAt!, preview },
    strokes,
    lines,
  };
}
