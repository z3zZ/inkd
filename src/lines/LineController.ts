import katex from "katex";
import type { StrokeChange } from "../canvas/InkCanvas";
import { solve } from "../math/engine";
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
  resultEl: HTMLElement | null;
}

/** Idle timer → recognise → solve → render, per line. */
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
      state.resultEl?.remove();
      state.resultEl = null;
      if (!this.penDown) this.arm(line);
    }
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
      state = { revision: 0, timer: undefined, dirty: false, resultEl: null };
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

      const solution = solve(recognition.latex);
      const value = solution.kind === "result" ? solution.value : null;
      if (value !== null) state.resultEl = this.renderResult(line, value);
      this.events.onOutcome?.({ line, recognition, value, note: solution.kind === "none" ? solution.reason : null });
    } catch (error) {
      this.events.onError?.(error instanceof Error ? error.message : String(error));
    }
  }

  private renderResult(line: Line, value: string): HTMLElement {
    const el = document.createElement("div");
    el.className = "result";
    el.style.left = `${line.bbox.right + RESULT_GAP}px`;
    el.style.top = `${(line.bbox.top + line.bbox.bottom) / 2}px`;
    katex.render(value, el, { throwOnError: false });
    this.overlay.append(el);
    return el;
  }
}
