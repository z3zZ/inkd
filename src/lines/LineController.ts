import katex from "katex";
import type { StrokeChange } from "../canvas/InkCanvas";
import type { BBox } from "../canvas/strokes";
import { type Solution, solveNote } from "../math/engine";
import { lineKey, type SavedLine } from "../notes/format";
import type { Recognition, Recognizer } from "../recognition/Recognizer";
import { type Line, LineSegmenter } from "./LineSegmenter";
import { rasterizeStrokes } from "./rasterize";

const RESULT_GAP = 14;

export interface LineOutcome {
  line: Line;
  recognition: Recognition;
  /** The value shown beside the line, or null when the line has no result. */
  value: string | null;
  note: string | null;
}

export interface ExportLine {
  latex: string;
  bbox: BBox;
  /** The result as shown on the page, in page coordinates; its top is the vertical centre. */
  result: { value: string; left: number; top: number } | null;
}

export interface LineControllerEvents {
  onRecognising?: () => void;
  onOutcome?: (outcome: LineOutcome) => void;
  onError?: (message: string) => void;
}

interface LineState {
  /** Bumped on every edit, so a slow recognition of older ink is discarded. */
  revision: number;
  timer: number | undefined;
  dirty: boolean;
  /** What the line was last read as; null while its ink is being edited or recognised. */
  latex: string | null;
  /** When the reading was corrected by hand: what the model had read. Editing the ink clears it. */
  original: string | null;
  shown: { value: string; left: number; top: number } | null;
  resultEl: HTMLElement | null;
}

function noteFor(solution: Solution): string | null {
  switch (solution.kind) {
    case "none":
      return solution.reason;
    case "assignment":
      return solution.value === null ? `${solution.name} not set: ${solution.reason}` : `${solution.name} = ${solution.value}`;
    case "function":
      return `${solution.name} defined`;
    case "result":
      return null;
  }
}

/**
 * Idle timer → recognise a line → solve the whole note → render results.
 * Only edited lines are recognised again, but every line is solved again, so a change
 * to a variable shows up in all the lines below that use it.
 */
export class LineController {
  private readonly segmenter = new LineSegmenter();
  private readonly states = new Map<number, LineState>();
  private readonly overlay: HTMLElement;
  private penDown = false;
  private primed: Map<string, SavedLine> | null = null;

  constructor(
    host: HTMLElement,
    private readonly recognizer: Recognizer,
    private readonly idleMs: number,
    private readonly events: LineControllerEvents = {},
  ) {
    this.overlay = document.createElement("div");
    this.overlay.className = "overlay";
    host.append(this.overlay);
  }

  /**
   * Readings saved with a note. Used for the very next change only (the note being loaded):
   * a line whose strokes match exactly gets its saved reading instead of being recognised again.
   */
  primeReadings(lines: readonly SavedLine[]): void {
    this.primed = new Map(lines.map((l) => [lineKey(l.strokes), l]));
  }

  handleChange(change: StrokeChange): void {
    const primed = this.primed;
    this.primed = null;
    const { dirty, gone } = this.segmenter.update(change.added, change.removed);
    for (const id of gone) this.forget(id);
    for (const line of dirty) {
      const state = this.stateOf(line.id);
      state.revision++;
      clearTimeout(state.timer);
      const saved = primed?.get(lineKey(line.strokes.map((s) => s.id)));
      if (saved !== undefined) {
        state.dirty = false;
        state.latex = saved.latex;
        state.original = saved.original ?? null;
        continue;
      }
      state.dirty = true;
      state.latex = null;
      state.original = null;
      if (!this.penDown) this.arm(line);
    }
    if (gone.length || dirty.length) this.resolve();
  }

  /** Every line read so far, top to bottom, for saving with the note. */
  readings(): SavedLine[] {
    return this.readLines().map(({ line, latex, state }) => {
      const strokes = line.strokes.map((s) => s.id);
      return state.original === null ? { strokes, latex } : { strokes, latex, original: state.original };
    });
  }

  /** The line at a point on the page, if any. Generous vertically, so a tap just above or below still finds it. */
  lineAt(x: number, y: number): Line | null {
    const SLOP = 12;
    let best: Line | null = null;
    let bestDistance = Infinity;
    for (const line of this.segmenter.all) {
      const { left, right, top, bottom } = line.bbox;
      const shown = this.states.get(line.id)?.shown;
      // The result beside a line counts as part of it.
      const reach = shown ? Math.max(right, shown.left + 120) : right;
      if (x < left - SLOP || x > reach + SLOP || y < top - SLOP || y > bottom + SLOP) continue;
      const distance = Math.abs(y - (top + bottom) / 2);
      if (distance < bestDistance) {
        best = line;
        bestDistance = distance;
      }
    }
    return best;
  }

  /** What a line reads as now, and what the model read if that was corrected. Null while it is still being read. */
  readingOf(lineId: number): { latex: string; original: string | null } | null {
    const state = this.states.get(lineId);
    return state?.latex == null ? null : { latex: state.latex, original: state.original };
  }

  /**
   * Replaces what a line was read as, and solves the note again. Returns what the model had read,
   * so the caller can log the pair. Returns null if the line is gone or still being read.
   */
  correct(lineId: number, latex: string): { original: string } | null {
    const state = this.states.get(lineId);
    if (!state || state.latex == null) return null;
    const original = state.original ?? state.latex;
    if (latex === original) {
      state.original = null;
    } else {
      state.original = original;
    }
    state.latex = latex;
    this.resolve();
    return { original };
  }

  /** Throws away a line's reading, corrected or not, and reads its ink again straight away. */
  reread(lineId: number): void {
    const line = this.segmenter.all.find((l) => l.id === lineId);
    const state = this.states.get(lineId);
    if (!line || !state) return;
    clearTimeout(state.timer);
    state.revision++;
    state.latex = null;
    state.original = null;
    state.dirty = true;
    this.resolve();
    void this.run(line);
  }

  /** Every line read so far, top to bottom, with the result shown beside it, for export. */
  exportLines(): ExportLine[] {
    return this.readLines().map(({ line, latex, state }) => ({
      latex,
      bbox: line.bbox,
      result: state.shown,
    }));
  }

  /** Whether any line is still waiting to be read. */
  get pending(): boolean {
    return this.segmenter.all.some((line) => this.states.get(line.id)?.latex == null);
  }

  private readLines() {
    return this.segmenter.all
      .map((line) => ({ line, state: this.states.get(line.id)!, latex: this.states.get(line.id)?.latex }))
      .filter((r): r is { line: Line; state: LineState; latex: string } => r.latex != null)
      .sort((a, b) => a.line.bbox.top - b.line.bbox.top);
  }

  handlePenDown(): void {
    this.penDown = true;
    for (const state of this.states.values()) {
      clearTimeout(state.timer);
      state.timer = undefined;
    }
  }

  handlePenUp(): void {
    this.penDown = false;
    for (const line of this.segmenter.all) {
      if (this.stateOf(line.id).dirty) this.arm(line);
    }
  }

  setScroll(scrollY: number): void {
    this.overlay.style.transform = `translateY(${-scrollY}px)`;
  }

  private stateOf(id: number): LineState {
    let state = this.states.get(id);
    if (!state) {
      state = { revision: 0, timer: undefined, dirty: false, latex: null, original: null, shown: null, resultEl: null };
      this.states.set(id, state);
    }
    return state;
  }

  private forget(id: number): void {
    const state = this.states.get(id);
    if (!state) return;
    clearTimeout(state.timer);
    state.resultEl?.remove();
    this.states.delete(id);
  }

  private arm(line: Line): void {
    const state = this.stateOf(line.id);
    clearTimeout(state.timer);
    state.timer = window.setTimeout(() => void this.run(line), this.idleMs);
  }

  private async run(line: Line): Promise<void> {
    const state = this.states.get(line.id);
    if (!state) return;
    const revision = state.revision;
    state.dirty = false;
    this.events.onRecognising?.();

    try {
      const image = await rasterizeStrokes(line.strokes);
      const recognition = await this.recognizer.recognise(image);
      if (this.states.get(line.id) !== state || state.revision !== revision) return;

      state.latex = recognition.latex;
      const solution = this.resolve().get(line.id)!;
      this.events.onOutcome?.({
        line,
        recognition,
        value: solution.kind === "result" ? solution.value : null,
        note: noteFor(solution),
      });
    } catch (error) {
      this.events.onError?.(error instanceof Error ? error.message : String(error));
    }
  }

  /** Solves every recognised line top to bottom and brings the results on the page up to date. */
  private resolve(): Map<number, Solution> {
    const lines = this.segmenter.all
      .filter((line) => this.states.get(line.id)?.latex != null)
      .sort((a, b) => a.bbox.top - b.bbox.top);
    const solutions = solveNote(lines.map((line) => this.states.get(line.id)!.latex!));
    const byLine = new Map(lines.map((line, i) => [line.id, solutions[i]]));

    for (const line of this.segmenter.all) {
      const state = this.stateOf(line.id);
      const solution = byLine.get(line.id);
      const value = solution?.kind === "result" ? solution.value : null;
      const left = line.bbox.right + RESULT_GAP;
      const top = (line.bbox.top + line.bbox.bottom) / 2;
      const same = state.shown && value !== null && state.shown.value === value && state.shown.left === left && state.shown.top === top;
      if (same) continue;

      state.resultEl?.remove();
      state.resultEl = null;
      state.shown = null;
      if (value !== null) {
        state.resultEl = this.renderResult(left, top, value);
        state.shown = { value, left, top };
      }
    }
    return byLine;
  }

  private renderResult(left: number, top: number, value: string): HTMLElement {
    const el = document.createElement("div");
    el.className = "result";
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    katex.render(value, el, { throwOnError: false });
    this.overlay.append(el);
    return el;
  }
}
