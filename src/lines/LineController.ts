import katex from "katex";
import type { StrokeChange } from "../canvas/InkCanvas";
import { type Solution, solveNote } from "../math/engine";
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

  handleChange(change: StrokeChange): void {
    const { dirty, gone } = this.segmenter.update(change.added, change.removed);
    for (const id of gone) this.forget(id);
    for (const line of dirty) {
      const state = this.stateOf(line.id);
      state.revision++;
      state.dirty = true;
      state.latex = null;
      if (!this.penDown) this.arm(line);
    }
    if (gone.length || dirty.length) this.resolve();
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
      state = { revision: 0, timer: undefined, dirty: false, latex: null, shown: null, resultEl: null };
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
