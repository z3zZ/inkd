import { type BBox, type Stroke, strokeBBox, unionBBox } from "../canvas/strokes";

export interface Line {
  id: number;
  strokes: Stroke[];
  bbox: BBox;
}

export interface SegmentUpdate {
  /** Lines whose strokes changed and need recognising again. */
  dirty: Line[];
  /** Line ids that no longer exist (emptied, or merged into another line). */
  gone: number[];
}

/** Vertical gap tolerated within a line, as a fraction of its height. Keeps fractions in one piece. */
const GAP_RATIO = 0.35;
const MIN_TOLERANCE = 8;

/** Groups strokes into lines by overlapping vertical bands. */
export class LineSegmenter {
  private lines = new Map<number, Line>();
  private nextId = 1;

  get all(): Line[] {
    return [...this.lines.values()];
  }

  update(added: Stroke[], removed: Stroke[]): SegmentUpdate {
    const dirty = new Set<Line>();
    const gone = new Set<number>();

    const shrunk = new Set<Line>();
    for (const stroke of removed) {
      for (const line of this.lines.values()) {
        const index = line.strokes.indexOf(stroke);
        if (index === -1) continue;
        line.strokes.splice(index, 1);
        if (line.strokes.length) {
          shrunk.add(line);
        } else {
          this.lines.delete(line.id);
          shrunk.delete(line);
          gone.add(line.id);
        }
        break;
      }
    }
    // The stroke taken away may have been all that joined two lines, such as a stray mark
    // between them: what is left goes back to being separate lines.
    for (const line of shrunk) {
      const [first, ...rest] = groupByBand(line.strokes);
      line.strokes = first;
      line.bbox = this.boundsOf(first);
      dirty.add(line);
      for (const strokes of rest) {
        const split = this.createLine();
        split.strokes = strokes;
        split.bbox = this.boundsOf(strokes);
        dirty.add(split);
      }
    }

    for (const stroke of added) {
      const box = strokeBBox(stroke);
      const touching = this.all.filter((line) => bandsTouch(box, line.bbox));
      const target = touching[0] ?? this.createLine();
      target.strokes.push(stroke);
      for (const other of touching.slice(1)) {
        target.strokes.push(...other.strokes);
        this.lines.delete(other.id);
        dirty.delete(other);
        gone.add(other.id);
      }
      target.bbox = this.boundsOf(target.strokes);
      dirty.add(target);
    }

    return { dirty: [...dirty], gone: [...gone] };
  }

  private createLine(): Line {
    const line: Line = { id: this.nextId++, strokes: [], bbox: { left: 0, top: 0, right: 0, bottom: 0 } };
    this.lines.set(line.id, line);
    return line;
  }

  private boundsOf(strokes: Stroke[]): BBox {
    return unionBBox(strokes.map(strokeBBox));
  }
}

/**
 * Splits strokes into groups whose vertical bands touch, topmost group first. Groups are
 * merged until none touch, so the outcome does not depend on the order the strokes were written in.
 */
function groupByBand(strokes: Stroke[]): Stroke[][] {
  let groups = strokes.map((stroke) => ({ strokes: [stroke], bbox: strokeBBox(stroke) }));
  for (let merged = true; merged; ) {
    merged = false;
    const next: typeof groups = [];
    for (const group of groups) {
      const into = next.find((other) => bandsTouch(group.bbox, other.bbox));
      if (into) {
        into.strokes.push(...group.strokes);
        into.bbox = unionBBox([into.bbox, group.bbox]);
        merged = true;
      } else {
        next.push(group);
      }
    }
    groups = next;
  }
  return groups.sort((a, b) => a.bbox.top - b.bbox.top).map((group) => group.strokes);
}

function bandsTouch(a: BBox, b: BBox): boolean {
  const height = Math.max(a.bottom - a.top, b.bottom - b.top);
  const tolerance = Math.max(MIN_TOLERANCE, height * GAP_RATIO);
  return a.top - tolerance <= b.bottom && b.top - tolerance <= a.bottom;
}
