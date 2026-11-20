import { invoke } from "@tauri-apps/api/core";
import type { InkCanvas } from "../canvas/InkCanvas";
import { type InkPoint, newStrokeId, strokeBBox, unionBBox } from "../canvas/strokes";
import { logCorrection } from "../corrections/CorrectionLog";
import type { LineController } from "../lines/LineController";
import { noteLatex, renderNotePng } from "../notes/export";
import type { NoteSession } from "../notes/NoteSession";
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
  session: NoteSession,
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

    // Milestone 6: the note saves itself, and reopening it shows the same results without reading again.
    setStatus("Self-test: notes");
    session.rename("Self-test functions");
    await session.flush();
    const savedId = session.current.id;
    const strokeCount = ink.allStrokes.length;
    const latex = noteLatex(controller.exportLines());
    const exported = await renderNotePng(ink.allStrokes, controller.exportLines());
    await writeDevFile("notes-export.png", new Uint8Array(await exported.arrayBuffer()));
    await session.create();
    const blankAfterNew = ink.allStrokes.length === 0 && document.querySelector(".result") === null;
    const listed = (await session.list()).some((n) => n.id === savedId && n.title === "Self-test functions");
    await session.open(savedId);
    const reopened = {
      strokes: ink.allStrokes.length,
      // Nothing waiting to be read: every line came back with its saved reading.
      pending: controller.pending,
      results: await waitForResults(["5", "7"], 500),
      latex: noteLatex(controller.exportLines()),
    };
    await session.remove(savedId);
    const goneFromList = !(await session.list()).some((n) => n.id === savedId);
    report.notes = {
      latex,
      blankAfterNew,
      listed,
      reopened,
      goneFromList,
      pass:
        blankAfterNew &&
        listed &&
        reopened.strokes === strokeCount &&
        !reopened.pending &&
        JSON.stringify(reopened.results) === JSON.stringify(["5", "7"]) &&
        reopened.latex === latex &&
        latex.split(/\n/).filter((l) => /= (5|7)$/.test(l)).length === 2 &&
        goneFromList,
    };
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

    // Milestone 8: a corrected reading drives the result, survives reopening, and "read again" undoes it.
    setStatus("Self-test: corrections");
    const sum = synthesizeLine(["3", "+", "4", "="], 60, 80, 3001);
    ink.addStrokes(sum);
    const beforeFix = await waitForResults(["7"], 60_000);
    const box = unionBBox(sum.map(strokeBBox));
    const target = controller.lineAt((box.left + box.right) / 2, (box.top + box.bottom) / 2);
    const fixed = target ? controller.correct(target.id, "3+5=") : null;
    const afterFix = await waitForResults(["8"], 2_000);
    let logged = false;
    if (fixed && target) {
      await logCorrection(target.strokes, { original: fixed.original, corrected: "3+5=" });
      logged = true;
    }
    const savedOriginal = controller.readings()[0]?.original ?? null;
    await session.flush();
    const fixId = session.current.id;
    await session.create();
    await session.open(fixId);
    const reopenedFix = { pending: controller.pending, results: await waitForResults(["8"], 500) };
    const reopenedTarget = controller.lineAt((box.left + box.right) / 2, (box.top + box.bottom) / 2);
    if (reopenedTarget) controller.reread(reopenedTarget.id);
    const afterReread = await waitForResults(["7"], 60_000);
    const originalAfterReread = controller.readings()[0]?.original ?? null;
    await session.remove(fixId);
    report.corrections = {
      beforeFix,
      found: target !== null,
      afterFix,
      savedOriginal,
      logged,
      reopenedFix,
      afterReread,
      originalAfterReread,
      pass:
        JSON.stringify([beforeFix, afterFix, reopenedFix.results, afterReread]) ===
          JSON.stringify([["7"], ["8"], ["8"], ["7"]]) &&
        savedOriginal !== null &&
        logged &&
        !reopenedFix.pending &&
        originalAfterReread === null,
    };

    // Polish: a scribble over a line erases it in one undoable step; ordinary ink stays.
    setStatus("Self-test: scratch-out");
    ink.clear();
    const victim = synthesizeLine(["3", "+", "4", "="], 60, 80, 4001);
    const bystander = synthesizeLine(["1", "+", "1", "="], 60, 220, 4002);
    ink.addStrokes(victim);
    ink.addStrokes(bystander);
    const beforeScratch = await waitForResults(["7", "2"], 60_000);
    const vb = unionBBox(victim.map(strokeBBox));
    const scribble: InkPoint[] = [];
    for (let pass = 0; pass <= 10; pass++) {
      const x = pass % 2 === 0 ? vb.left - 4 : vb.right + 4;
      const y = vb.top + ((vb.bottom - vb.top) * pass) / 10;
      scribble.push([x, y, 0.5]);
    }
    const dense: InkPoint[] = [];
    for (let i = 1; i < scribble.length; i++) {
      for (let t = 0; t < 1; t += 0.1) {
        const [x0, y0] = scribble[i - 1];
        const [x1, y1] = scribble[i];
        dense.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, 0.5]);
      }
    }
    const strokesBefore = ink.allStrokes.length;
    ink.finishStroke({ id: newStrokeId(), points: dense, simulatePressure: true, size: 4.5, startedAt: 0, endedAt: 0 });
    const afterScratch = { strokes: ink.allStrokes.length, results: await waitForResults(["2"], 5_000) };
    ink.undo();
    const afterUndoScratch = { strokes: ink.allStrokes.length, results: await waitForResults(["7", "2"], 60_000) };
    report.scratchOut = {
      beforeScratch,
      strokesBefore,
      afterScratch,
      afterUndoScratch,
      pass:
        JSON.stringify(beforeScratch) === JSON.stringify(["7", "2"]) &&
        afterScratch.strokes === bystander.length &&
        JSON.stringify(afterScratch.results) === JSON.stringify(["2"]) &&
        afterUndoScratch.strokes === strokesBefore &&
        JSON.stringify(afterUndoScratch.results) === JSON.stringify(["7", "2"]),
    };
    ink.clear();

    // Graphing: curves written on the page are drawn, each in its own colour, with marks on the page.
    setStatus("Self-test: graph");
    ink.clear();
    const curveLines = [
      synthesizeLine(["y", "=", "x", { sup: ["2"] }, "-", "3"], 60, 80, 5001),
      synthesizeLine(["f", "(", "x", ")", "=", "x", { sup: ["2"] }, "+", "1"], 60, 200, 5002),
      synthesizeLine(["y", "=", "2", "x", "+", "1"], 60, 320, 5003),
    ];
    for (const strokes of curveLines) ink.addStrokes(strokes);
    const legendItems = async (count: number) => {
      const deadline = performance.now() + 60_000;
      let items: string[] = [];
      while (performance.now() < deadline) {
        items = [...document.querySelectorAll(".graph-legend-item annotation")].map((a) => a.textContent ?? "");
        if (items.length >= count) break;
        await wait(100);
      }
      return items;
    };
    (document.getElementById("graph-toggle") as HTMLButtonElement).click();
    const legend = await legendItems(3);
    await wait(300);
    const marks = [...document.querySelectorAll<HTMLElement>(".curve-mark")].map((m) => m.style.background);
    const graphCanvas = document.querySelector<HTMLCanvasElement>(".graph-plot canvas")!;
    const graphPng = await new Promise<Blob>((resolve, reject) =>
      graphCanvas.toBlob((b) => (b ? resolve(b) : reject(new Error("graph capture failed"))), "image/png"),
    );
    await writeDevFile("graph.png", new Uint8Array(await graphPng.arrayBuffer()));
    (document.getElementById("graph-toggle") as HTMLButtonElement).click();
    const marksAfterClose = document.querySelectorAll(".curve-mark").length;
    report.graph = {
      legend,
      marks,
      marksAfterClose,
      pass: legend.length === 3 && new Set(marks).size === 3 && marksAfterClose === 0,
    };
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
