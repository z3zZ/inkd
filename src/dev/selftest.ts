import { invoke } from "@tauri-apps/api/core";
import type { InkCanvas } from "../canvas/InkCanvas";
import type { LineController } from "../lines/LineController";
import { rasterizeStrokes } from "../lines/rasterize";
import { latexEquivalent } from "../math/engine";
import type { Recognizer } from "../recognition/Recognizer";
import { type BaselineRow, jsonBytes, summarize, writeDevFile } from "./baseline";
import { synthesizeLine } from "./synthInk";
import { TEST_LINES } from "./testLines";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForResult(timeoutMs: number): Promise<string | null> {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    const el = document.querySelector(".result .katex-mathml annotation");
    if (el?.textContent) return el.textContent;
    await wait(50);
  }
  return null;
}

/**
 * Runs with INKD_SELFTEST=<dir>: drives the real pipeline in the real window, writes the
 * images and a report to <dir>, then closes the app.
 */
export async function runSelfTest(
  ink: InkCanvas,
  recognizer: Recognizer,
  controller: LineController,
  setStatus: (message: string) => void,
): Promise<void> {
  const report: Record<string, unknown> = {};
  try {
    // Milestone 2 end to end: ink → idle timer → recognise → solve → result on the page.
    setStatus("Self-test: end to end");
    controller.handlePenUp();
    ink.addStrokes(synthesizeLine(TEST_LINES[4].synth, 60, 90, 1005));
    const shown = await waitForResult(120_000);
    const hasInk = ink.allStrokes.length > 0;
    await wait(150);
    await writeDevFile("e2e-canvas.png", new Uint8Array(await (await ink.toPngBlob()).arrayBuffer()));
    report.endToEnd = { line: TEST_LINES[4].prompt, shown, pass: shown === "1.25" && hasInk };

    // Milestone 1 history: undo removes the ink and its result, redo restores the ink.
    const before = ink.allStrokes.length;
    ink.undo();
    const afterUndo = ink.allStrokes.length;
    const resultGone = document.querySelector(".result") === null;
    ink.redo();
    report.history = { before, afterUndo, afterRedo: ink.allStrokes.length, resultGone };
    ink.clear();

    const rows: BaselineRow[] = [];
    for (const [i, line] of TEST_LINES.entries()) {
      setStatus(`Self-test: proxy line ${i + 1}/${TEST_LINES.length}`);
      const png = await rasterizeStrokes(synthesizeLine(line.synth, 40, 60, 1000 + i));
      await writeDevFile(`${line.id}.png`, png);
      const r = await recognizer.recognise(png);
      rows.push({
        id: line.id,
        expected: line.latex,
        latex: r.latex,
        correct: latexEquivalent(r.latex, line.latex),
        confidence: r.confidence,
        ms: r.ms,
      });
    }
    report.proxy = { summary: summarize(rows), rows };
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error);
  }
  await writeDevFile("selftest.json", jsonBytes(report));
  await invoke("selftest_finish");
}
