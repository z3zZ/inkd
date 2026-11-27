import katex from "katex";
import type { StrokeChange } from "../canvas/InkCanvas";
import type { BBox } from "../canvas/strokes";
import { type Plot, type Solution, solveNote } from "../math/engine";
import { lineKey, type SavedLine } from "../notes/format";
import { type AnswerFormat, formatAnswer } from "../math/answerFormat";
import type { AngleUnit } from "../math/latexToMath";
import type { Recognition, Recognizer } from "../recognition/Recognizer";
import { stripMathDelimiters } from "../math/latexToMath";
import { type Line, LineSegmenter } from "./LineSegmenter";
import { rasterizeStrokes } from "./rasterize";

const RESULT_GAP = 14;
const FLAG_GAP = 8;
/** Below this, a reading is shown as unsure. Misreads in the handwriting baseline scored under it. */
export const UNSURE_BELOW = 0.8;
/** Lines that are not sums are ordinary notes, not problems worth flagging. */
const QUIET_REASONS = new Set(["no equals sign", "not a calculation"]);

/** Why a line is marked on the page, if it is. */
export interface LineFlag {
  /** error: could not be read. unsolved: read, but no answer. unsure: answered from a doubtful reading. */
  kind: "error" | "unsolved" | "unsure";
  title: string;
}

/** Decides whether a line needs a mark beside it, and what the mark says. */
export function flagFor(
  line: { error: string | null; latex: string | null; confidence: number | null },
  solution: Solution | undefined,
): LineFlag | null {
  if (line.error !== null) return { kind: "error", title: `This line could not be read: ${line.error} Click to try again.` };
  if (line.latex === null || !solution) return null;
  const read = stripMathDelimiters(line.latex);
  const reason =
    solution.kind === "none" ? solution.reason : solution.kind === "assignment" && solution.value === null ? solution.reason : undefined;
  if (reason !== undefined) {
    if (QUIET_REASONS.has(reason)) return null;
    return { kind: "unsolved", title: `Read as ${read}, but there is no answer: ${reason}. Click to correct the reading.` };
  }
  if (line.confidence !== null && line.confidence < UNSURE_BELOW) {
    const percent = Math.round(line.confidence * 100);
    return { kind: "unsure", title: `Read as ${read}, but only ${percent}% sure. Click to check the reading.` };
  }
  return null;
}

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
  /** `value` is LaTeX; `text` is the same answer as plain text. */
  result: { value: string; text: string; left: number; top: number } | null;
}

export interface LineCurve {
  lineId: number;
  name: string;
  latex: string;
  at: Plot;
}

export interface LineControllerEvents {
  onRecognising?: () => void;
  onOutcome?: (outcome: LineOutcome) => void;
  onError?: (message: string) => void;
  /** Lines that can be graphed, top to bottom, sent each time the page is solved again. */
  onCurves?: (curves: LineCurve[]) => void;
  /** The mark beside a line that was read, but doubtfully or without an answer, was clicked. */
  onFlagClick?: (line: Line) => void;
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
  /** How sure the model was of `latex`, 0..1. Null for a reading typed in by hand, or not known. */
  confidence: number | null;
  /** Why the last attempt to read the line failed. Cleared when it is read or edited. */
  error: string | null;
  shown: { value: string; text: string; left: number; top: number } | null;
  resultEl: HTMLElement | null;
  /** The mark beside a line that failed or is doubtful, and what it currently says. */
  flagEl: HTMLButtonElement | null;
  flagKey: string | null;
  /** Colour mark beside a graphed line, matching its curve. */
  markEl: HTMLElement | null;
}

function noteFor(solution: Solution): string | null {
  switch (solution.kind) {
    case "none":
      return solution.reason;
    case "assignment":
      return solution.value === null ? `${solution.name} not set: ${solution.reason}` : `${solution.name} = ${solution.value}`;
    case "function":
      return `${solution.name} defined · open Graph (Ctrl+G) to plot it`;
    case "graph":
      return `${solution.name} plotted against x · open Graph (Ctrl+G) to see it`;
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
  private answerFormat: AnswerFormat = "decimal";
  private angles: AngleUnit = "rad";
  private curveColors = new Map<number, string>();

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
        state.confidence = saved.confidence ?? null;
        state.error = null;
        continue;
      }
      state.dirty = true;
      state.latex = null;
      state.original = null;
      state.confidence = null;
      state.error = null;
      if (!this.penDown) this.arm(line);
    }
    if (gone.length || dirty.length) this.resolve();
  }

  /** Marks graphed lines with their curve's colour. An empty map removes the marks. */
  markCurves(colors: Map<number, string>): void {
    this.curveColors = colors;
    this.renderMarks();
  }

  private renderMarks(): void {
    for (const line of this.segmenter.all) {
      const state = this.states.get(line.id);
      if (!state) continue;
      const color = this.curveColors.get(line.id);
      if (!color) {
        state.markEl?.remove();
        state.markEl = null;
        continue;
      }
      if (!state.markEl) {
        state.markEl = document.createElement("div");
        state.markEl.className = "curve-mark";
        state.markEl.title = "This line is drawn in the graph in this colour";
        this.overlay.append(state.markEl);
      }
      state.markEl.style.background = color;
      state.markEl.style.left = `${line.bbox.right + RESULT_GAP}px`;
      state.markEl.style.top = `${(line.bbox.top + line.bbox.bottom) / 2}px`;
    }
  }

  /** Decimal, fraction or mixed number, for every result on the page. */
  setAnswerFormat(format: AnswerFormat): void {
    if (format === this.answerFormat) return;
    this.answerFormat = format;
    this.resolve();
  }

  /** Radians or degrees for sin, cos and tan, on every line of the page. */
  setAngleUnit(angles: AngleUnit): void {
    if (angles === this.angles) return;
    this.angles = angles;
    this.resolve();
  }

  /** Every line read so far, top to bottom, for saving with the note. */
  readings(): SavedLine[] {
    return this.readLines().map(({ line, latex, state }) => {
      const saved: SavedLine = { strokes: line.strokes.map((s) => s.id), latex };
      if (state.original !== null) saved.original = state.original;
      if (state.confidence !== null) saved.confidence = Math.round(state.confidence * 1000) / 1000;
      return saved;
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
      // A reading typed in by hand is not in doubt.
      state.confidence = null;
    }
    state.latex = latex;
    this.resolve();
    return { original };
  }

  /** Reads every line that has no reading yet, such as lines written before the model was ready. */
  rereadAll(): void {
    for (const line of this.segmenter.all) {
      const state = this.states.get(line.id);
      // Not dirty: not waiting on its idle timer, so not about to be read anyway.
      if (state && state.latex == null && !state.dirty) void this.run(line);
    }
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
    state.confidence = null;
    state.error = null;
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
      state = {
        revision: 0,
        timer: undefined,
        dirty: false,
        latex: null,
        original: null,
        confidence: null,
        error: null,
        shown: null,
        resultEl: null,
        markEl: null,
        flagEl: null,
        flagKey: null,
      };
      this.states.set(id, state);
    }
    return state;
  }

  private forget(id: number): void {
    const state = this.states.get(id);
    if (!state) return;
    clearTimeout(state.timer);
    state.resultEl?.remove();
    state.markEl?.remove();
    state.flagEl?.remove();
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
    if (state.error !== null) {
      state.error = null;
      this.resolve();
    }
    this.events.onRecognising?.();

    try {
      const image = await rasterizeStrokes(line.strokes);
      const recognition = await this.recognizer.recognise(image);
      if (this.states.get(line.id) !== state || state.revision !== revision) return;

      state.latex = recognition.latex;
      state.confidence = recognition.confidence;
      const solution = this.resolve().get(line.id)!;
      this.events.onOutcome?.({
        line,
        recognition,
        value: solution.kind === "result" ? solution.value : null,
        note: noteFor(solution),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // The line stays on the page unread: say so beside it, where it can be tried again.
      if (this.states.get(line.id) === state && state.revision === revision) {
        state.error = message;
        this.resolve();
      }
      this.events.onError?.(message);
    }
  }

  /** Solves every recognised line top to bottom and brings the results on the page up to date. */
  private resolve(): Map<number, Solution> {
    const lines = this.segmenter.all
      .filter((line) => this.states.get(line.id)?.latex != null)
      .sort((a, b) => a.bbox.top - b.bbox.top);
    const solutions = solveNote(lines.map((line) => this.states.get(line.id)!.latex!), { angles: this.angles });
    const byLine = new Map(lines.map((line, i) => [line.id, solutions[i]]));

    for (const line of this.segmenter.all) {
      const state = this.stateOf(line.id);
      const solution = byLine.get(line.id);
      const answer =
        solution?.kind === "result" ? formatAnswer(solution.number, solution.value, this.answerFormat) : null;
      const value = answer?.latex ?? null;
      const left = line.bbox.right + RESULT_GAP;
      const top = (line.bbox.top + line.bbox.bottom) / 2;
      const same = state.shown && value !== null && state.shown.value === value && state.shown.left === left && state.shown.top === top;
      if (!same) {
        state.resultEl?.remove();
        state.resultEl = null;
        state.shown = null;
        if (value !== null) {
          state.resultEl = this.renderResult(left, top, value);
          state.shown = { value, text: answer!.text, left, top };
        }
      }
      this.renderFlag(line, state, flagFor(state, solution), left, top);
    }
    const curves: LineCurve[] = [];
    for (const line of lines) {
      const solution = byLine.get(line.id)!;
      if (solution.kind === "graph" || solution.kind === "function") {
        curves.push({ lineId: line.id, name: solution.name, latex: this.states.get(line.id)!.latex!, at: solution.at });
      }
    }
    this.events.onCurves?.(curves);
    this.renderMarks();
    return byLine;
  }

  /** The small "?" beside a line that could not be read, has no answer, or was read doubtfully. */
  private renderFlag(line: Line, state: LineState, flag: LineFlag | null, left: number, top: number): void {
    state.resultEl?.classList.toggle("unsure", flag?.kind === "unsure");
    // After the answer when there is one, otherwise where the answer would be.
    const x = state.resultEl ? left + state.resultEl.offsetWidth + FLAG_GAP : left;
    const key = flag ? `${flag.kind}|${flag.title}|${x}|${top}` : null;
    if (key === state.flagKey) return;
    state.flagKey = key;
    state.flagEl?.remove();
    state.flagEl = null;
    if (!flag) return;

    const el = document.createElement("button");
    el.className = `line-flag ${flag.kind}`;
    el.textContent = "?";
    el.title = flag.title;
    el.setAttribute("aria-label", flag.title);
    el.style.left = `${x}px`;
    el.style.top = `${top}px`;
    el.addEventListener("click", () => {
      if (flag.kind === "error") this.reread(line.id);
      else this.events.onFlagClick?.(line);
    });
    this.overlay.append(el);
    state.flagEl = el;
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
