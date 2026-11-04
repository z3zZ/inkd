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

    for (const stroke of removed) {
      for (const line of this.lines.values()) {
        const index = line.strokes.indexOf(stroke);
        if (index === -1) continue;
        line.strokes.splice(index, 1);
        if (line.strokes.length) {
          line.bbox = this.boundsOf(line.strokes);
          dirty.add(line);
        } else {
          this.lines.delete(line.id);
          dirty.delete(line);
          gone.add(line.id);
        }
        break;
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

function bandsTouch(a: BBox, b: BBox): boolean {
  const height = Math.max(a.bottom - a.top, b.bottom - b.top);
  const tolerance = Math.max(MIN_TOLERANCE, height * GAP_RATIO);
  return a.top - tolerance <= b.bottom && b.top - tolerance <= a.bottom;
}
