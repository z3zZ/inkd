import { invoke, isTauri } from "@tauri-apps/api/core";
import type { InkCanvas } from "../canvas/InkCanvas";
import { rasterizeStrokes } from "../lines/rasterize";
import { latexEquivalent } from "../math/engine";
import type { Recognizer } from "../recognition/Recognizer";
import { TEST_LINES } from "./testLines";

export interface BaselineRow {
  id: string;
  expected: string;
  latex: string;
  correct: boolean;
  confidence: number;
  ms: number;
}

export function summarize(rows: BaselineRow[]) {
  const times = rows.map((r) => r.ms).sort((a, b) => a - b);
  return {
    lines: rows.length,
    correct: rows.filter((r) => r.correct).length,
    medianMs: times[Math.floor(times.length / 2)] ?? 0,
    worstMs: times[times.length - 1] ?? 0,
  };
}

export async function writeDevFile(name: string, data: Uint8Array): Promise<string> {
  return invoke<string>("dev_write", data, { headers: { "x-file-name": name } });
}

export function jsonBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value, null, 2));
}

/** Ctrl+Shift+B: walks through the step-zero lines to record the real, handwritten baseline. */
export class BaselinePanel {
  private index = 0;
  private rows: BaselineRow[] = [];
  private busy = false;

  constructor(
    private readonly el: HTMLElement,
    private readonly ink: InkCanvas,
    private readonly recognizer: Recognizer,
  ) {}

  toggle(): void {
    this.el.hidden = !this.el.hidden;
    if (!this.el.hidden) {
      this.index = 0;
      this.rows = [];
      this.show();
    }
  }

  private show(message = ""): void {
    this.el.replaceChildren();
    const heading = document.createElement("h2");
    const done = this.index >= TEST_LINES.length;
    heading.textContent = done ? "Baseline finished" : `Baseline line ${this.index + 1} of ${TEST_LINES.length}`;
    this.el.append(heading);

    const body = document.createElement("div");
    body.className = "target";
    if (done) {
      const s = summarize(this.rows);
      body.textContent = `${s.correct}/${s.lines} correct, median ${(s.medianMs / 1000).toFixed(2)}s`;
    } else {
      body.textContent = TEST_LINES[this.index].prompt;
    }
    this.el.append(body);

    if (message) {
      const note = document.createElement("p");
      note.textContent = message;
      this.el.append(note);
    }
    if (done) return;

    const next = document.createElement("button");
    next.className = "tool";
    next.textContent = "Record and next";
    next.addEventListener("click", () => void this.record());
    this.el.append(next);
  }

  private async record(): Promise<void> {
    if (this.busy) return;
    const strokes = this.ink.allStrokes;
    if (!strokes.length) return this.show("Write the line first.");
    this.busy = true;
    try {
      const line = TEST_LINES[this.index];
      const png = await rasterizeStrokes(strokes);
      const recognition = await this.recognizer.recognise(png);
      this.rows.push({
        id: line.id,
        expected: line.latex,
        latex: recognition.latex,
        correct: latexEquivalent(recognition.latex, line.latex),
        confidence: recognition.confidence,
        ms: recognition.ms,
      });
      let saved = "";
      if (isTauri()) {
        await writeDevFile(`${line.id}.png`, png);
        saved = await writeDevFile("baseline.json", jsonBytes({ summary: summarize(this.rows), rows: this.rows }));
      }
      this.ink.clear();
      this.index++;
      this.show(`Read as: ${recognition.latex}${saved ? `\nSaved to ${saved}` : ""}`);
    } catch (error) {
      this.show(error instanceof Error ? error.message : String(error));
    } finally {
      this.busy = false;
    }
  }
}
