import { invoke } from "@tauri-apps/api/core";
import type { InkCanvas } from "../canvas/InkCanvas";
import type { LineController } from "../lines/LineController";
import { rasterizeStrokes } from "../lines/rasterize";
import { latexEquivalent } from "../math/engine";
import type { Recognizer } from "../recognition/Recognizer";
import { getEngineStatus, setForceCpu } from "../settings/engine";
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

/** The results on the page, top to bottom. */
function shownResults(): string[] {
  return [...document.querySelectorAll<HTMLElement>(".result")]
    .sort((a, b) => parseFloat(a.style.top) - parseFloat(b.style.top))
    .map((el) => el.querySelector(".katex-mathml annotation")?.textContent ?? "");
}

/** Waits until the page shows exactly `expected`, and returns what it last showed. */
async function waitForResults(expected: string[], timeoutMs: number): Promise<string[]> {
  const deadline = performance.now() + timeoutMs;
  let shown = shownResults();
  while (JSON.stringify(shown) !== JSON.stringify(expected) && performance.now() < deadline) {
    await wait(50);
    shown = shownResults();
  }
  return shown;
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

    // Milestone 3: variables carry down the note, and editing one updates the lines below.
    setStatus("Self-test: variables");
    const gap = 100;
    const xIs5 = synthesizeLine(["x", "=", "5"], 60, 80, 2001);
    ink.addStrokes(xIs5);
    ink.addStrokes(synthesizeLine(["2", "x", "="], 60, 80 + gap, 2002));
    const first = await waitForResults(["10"], 60_000);
    ink.removeStrokes(xIs5);
    const whileEditing = await waitForResults([], 5_000);
    ink.addStrokes(synthesizeLine(["x", "=", "7"], 60, 80, 2003));
    const edited = await waitForResults(["14"], 60_000);
    ink.clear();

    const fnLines = [
      synthesizeLine(["f", "(", "x", ")", "=", "x", { sup: ["2"] }, "+", "1"], 60, 80, 2004),
      synthesizeLine(["f", "(", "2", ")", "="], 60, 80 + gap, 2005),
      synthesizeLine(["3", "+", "4", "="], 60, 80 + 2 * gap, 2006),
    ];
    for (const strokes of fnLines) ink.addStrokes(strokes);
    const functions = await waitForResults(["5", "7"], 60_000);
    const functionsReadAs: string[] = [];
    for (const strokes of fnLines) functionsReadAs.push((await recognizer.recognise(await rasterizeStrokes(strokes))).latex);
    await wait(150);
    await writeDevFile("variables-canvas.png", new Uint8Array(await (await ink.toPngBlob()).arrayBuffer()));
    ink.clear();
    report.variables = {
      first,
      whileEditing,
      edited,
      functions,
      functionsReadAs,
      pass:
        JSON.stringify([first, whileEditing, edited, functions]) === JSON.stringify([["10"], [], ["14"], ["5", "7"]]),
    };

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

    // Force CPU: the setting switches backend, still reads correctly, and switches back.
    const checkLine = TEST_LINES[4];
    const png = await rasterizeStrokes(synthesizeLine(checkLine.synth, 40, 60, 1004));
    const initial = await getEngineStatus();
    setStatus("Self-test: Force CPU");
    const forced = await setForceCpu(true);
    const onCpu = await recognizer.recognise(png);
    const restored = await setForceCpu(initial.forceCpu);
    const onDefault = await recognizer.recognise(png);
    report.forceCpu = {
      initial: initial.backend,
      forced: forced.backend,
      cpuCorrect: latexEquivalent(onCpu.latex, checkLine.latex),
      cpuMs: onCpu.ms,
      restored: restored.backend,
      restoredCorrect: latexEquivalent(onDefault.latex, checkLine.latex),
      restoredMs: onDefault.ms,
      gpuError: restored.gpuError,
    };
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error);
  }
  await writeDevFile("selftest.json", jsonBytes(report));
  await invoke("selftest_finish");
}
