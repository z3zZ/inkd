import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "katex/dist/katex.min.css";
import { InkCanvas, type Tool } from "./canvas/InkCanvas";
import { GraphPanel } from "./graph/GraphPanel";
import { logCorrection } from "./corrections/CorrectionLog";
import { CorrectionPopover } from "./corrections/CorrectionPopover";
import { BaselinePanel } from "./dev/baseline";
import { runSelfTest } from "./dev/selftest";
import { LineController } from "./lines/LineController";
import type { Line } from "./lines/LineSegmenter";
import { stripMathDelimiters } from "./math/latexToMath";
import { noteLatex, renderNotePng } from "./notes/export";
import { NoteSession } from "./notes/NoteSession";
import { displayTitle, NotesPanel } from "./notes/NotesPanel";
import { createNoteStore } from "./notes/store";
import { createRecognizer } from "./recognition/TauriOnnxRecognizer";
import { bindEngineControls } from "./settings/engine";
import { ModelSetup } from "./settings/ModelSetup";
import { applyTheme, loadView, ViewMenu, type ViewSettings } from "./settings/view";

const IDLE_MS = 600;

const stage = document.getElementById("stage")!;
const statusEl = document.getElementById("status")!;
const penButton = document.getElementById("tool-pen") as HTMLButtonElement;
const eraserButton = document.getElementById("tool-eraser") as HTMLButtonElement;
const undoButton = document.getElementById("undo") as HTMLButtonElement;
const redoButton = document.getElementById("redo") as HTMLButtonElement;
const clearButton = document.getElementById("clear") as HTMLButtonElement;
const titleInput = document.getElementById("note-title") as HTMLInputElement;
const copyLatexButton = document.getElementById("copy-latex") as HTMLButtonElement;
const copyImageButton = document.getElementById("copy-image") as HTMLButtonElement;

const FIX_HINT = "Right-click a line, or press the pen button on it, to fix a misread.";

function setStatus(message: string, latex?: string, isError = false, onFix?: () => void): void {
  statusEl.replaceChildren();
  const text = document.createElement("span");
  text.textContent = message;
  if (isError) text.className = "error";
  statusEl.append(text);
  if (latex) {
    const code = document.createElement("code");
    code.textContent = latex;
    if (onFix) {
      code.className = "fixable";
      code.title = "Click to correct this line";
      code.addEventListener("click", onFix);
    }
    statusEl.append(code);
  }
}

const recognizer = createRecognizer();

const controller = new LineController(stage, recognizer, IDLE_MS, {
  onRecognising: () => setStatus("Recognising…"),
  onOutcome: ({ line, recognition, note }) => {
    const seconds = (recognition.ms / 1000).toFixed(2);
    const confidence = Math.round(recognition.confidence * 100);
    setStatus(`${seconds}s · ${confidence}% confident${note ? ` · ${note}` : ""}`, recognition.latex, false, () =>
      openCorrection(line),
    );
    session.changed();
  },
  onError: (message) => setStatus(message, undefined, true),
  onCurves: (curves) => graph.setCurves(curves),
  onFlagClick: (line) => openCorrection(line),
});

const ink = new InkCanvas(stage, {
  onChange: (change) => {
    // The line being corrected may just have changed under the editor.
    correction.close();
    controller.handleChange(change);
    session.changed();
  },
  onPenDown: () => controller.handlePenDown(),
  onPenUp: () => controller.handlePenUp(),
  onScroll: (y) => controller.setScroll(y),
  onSecondary: (x, y) => {
    const line = controller.lineAt(x, y);
    if (line) openCorrection(line);
    else setStatus(`Nothing written there. ${FIX_HINT}`);
  },
  onHistory: (canUndo, canRedo) => {
    undoButton.disabled = !canUndo;
    redoButton.disabled = !canRedo;
  },
});

function selectTool(tool: Tool): void {
  ink.setTool(tool);
  penButton.setAttribute("aria-pressed", String(tool === "pen"));
  eraserButton.setAttribute("aria-pressed", String(tool === "eraser"));
}

penButton.addEventListener("click", () => selectTool("pen"));
eraserButton.addEventListener("click", () => selectTool("eraser"));
undoButton.addEventListener("click", () => ink.undo());
redoButton.addEventListener("click", () => ink.redo());
clearButton.addEventListener("click", () => ink.clear());

const correction = new CorrectionPopover(document.body);

function openCorrection(line: Line): void {
  const reading = controller.readingOf(line.id);
  if (!reading) {
    setStatus("That line is still being read. Try again in a moment.");
    return;
  }
  const stage = document.getElementById("stage")!.getBoundingClientRect();
  correction.open({
    ...reading,
    left: stage.left + line.bbox.left,
    top: stage.top + line.bbox.bottom - ink.scroll + 8,
    onSave: (latex) => {
      const original = reading.original ?? reading.latex;
      // Typing back exactly what the model read undoes the correction.
      const undone = latex === stripMathDelimiters(original);
      const result = controller.correct(line.id, undone ? original : latex);
      if (!result) return;
      session.changed();
      if (undone) {
        setStatus("Back to what the model read.", original);
        return;
      }
      setStatus("Corrected, and kept for training the model on your handwriting.", latex, false, () =>
        openCorrection(line),
      );
      logCorrection(line.strokes, { original: result.original, corrected: latex }).catch((error) =>
        setStatus(`Corrected, but could not keep it for training: ${error}`, latex, true),
      );
    },
    onReread: () => controller.reread(line.id),
  });
}

const session = new NoteSession(createNoteStore(), ink, controller, {
  onCurrent: (meta) => {
    graph.reset();
    titleInput.value = meta.title;
    document.title = `${displayTitle(meta)} · inkd`;
    void notesPanel.refresh();
  },
  onListChanged: () => void notesPanel.refresh(),
  onError: (message) => setStatus(message, undefined, true),
});
const notesPanel = new NotesPanel(
  document.getElementById("notes")!,
  document.getElementById("notes-toggle") as HTMLButtonElement,
  session,
);

titleInput.addEventListener("change", () => session.rename(titleInput.value));
titleInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === "Escape") {
    if (e.key === "Escape") titleInput.value = session.current.title;
    titleInput.blur();
  }
});

async function copyLatex(): Promise<void> {
  const lines = controller.exportLines();
  if (!lines.length) {
    setStatus("Nothing to copy yet: no lines have been read.");
    return;
  }
  try {
    await navigator.clipboard.writeText(noteLatex(lines));
    const unread = controller.pending ? " Some lines are still being read and were left out." : "";
    setStatus(`Copied ${lines.length} line${lines.length === 1 ? "" : "s"} as LaTeX.${unread}`);
  } catch (error) {
    setStatus(`Could not copy: ${error instanceof Error ? error.message : String(error)}`, undefined, true);
  }
}

async function copyImage(): Promise<void> {
  try {
    const png = renderNotePng(ink.allStrokes, controller.exportLines());
    // Passing the promise keeps the clipboard write tied to the click that asked for it.
    await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
    setStatus("Copied the note as an image.");
  } catch (error) {
    setStatus(`Could not copy: ${error instanceof Error ? error.message : String(error)}`, undefined, true);
  }
}

copyLatexButton.addEventListener("click", () => void copyLatex());
copyImageButton.addEventListener("click", () => void copyImage());

const graphButton = document.getElementById("graph-toggle") as HTMLButtonElement;
let curveColors = new Map<number, string>();
const graph = new GraphPanel(document.getElementById("graph")!, {
  onColors: (colors) => {
    curveColors = colors;
    controller.markCurves(graph.isOpen ? colors : new Map());
  },
  onClose: () => toggleGraph(false),
  onStatus: (message, isError) => setStatus(message, undefined, isError),
});

function toggleGraph(open = !graph.isOpen): void {
  if (open) graph.open();
  else graph.close();
  document.body.classList.toggle("graph-open", open);
  graphButton.setAttribute("aria-expanded", String(open));
  graphButton.setAttribute("aria-pressed", String(open));
  // Colour marks on the page only make sense while the graph is showing.
  controller.markCurves(open ? curveColors : new Map());
}
graphButton.addEventListener("click", () => toggleGraph());

function applyView(view: ViewSettings): void {
  applyTheme(view.theme);
  ink.setBackground(view.background);
  ink.refreshTheme();
  graph.refreshTheme();
  controller.setAnswerFormat(view.answers);
  controller.setAngleUnit(view.angles);
}
new ViewMenu(document.getElementById("view-toggle") as HTMLButtonElement, applyView);
applyView(loadView());
// "System" theme follows Windows when it switches between light and dark.
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  ink.refreshTheme();
  graph.refreshTheme();
});

// Development builds only: records the handwritten baseline (Ctrl+Shift+B).
const baseline = import.meta.env.DEV ? new BaselinePanel(document.getElementById("baseline")!, ink, recognizer) : null;

window.addEventListener("keydown", (e) => {
  // Typing a title must not trigger tools or undo ink.
  if (e.target instanceof HTMLInputElement && e.target.type === "text") return;
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();
  if (key === "escape" && notesPanel.isOpen) {
    notesPanel.close();
  } else if (mod && key === "n") {
    e.preventDefault();
    void session.create();
  } else if (mod && key === "g") {
    e.preventDefault();
    toggleGraph();
  } else if (mod && key === "o") {
    e.preventDefault();
    notesPanel.toggle();
  } else if (mod && e.shiftKey && key === "c") {
    e.preventDefault();
    void copyLatex();
  } else if (mod && key === "z") {
    e.preventDefault();
    if (e.shiftKey) ink.redo();
    else ink.undo();
  } else if (mod && key === "y") {
    e.preventDefault();
    ink.redo();
  } else if (baseline && mod && e.shiftKey && key === "b") {
    e.preventDefault();
    baseline.toggle();
  } else if (!mod && key === "p") {
    selectTool("pen");
  } else if (!mod && key === "e") {
    selectTool("eraser");
  }
});

setStatus(`Write a sum ending in =, then pause. ${FIX_HINT}`);

if (isTauri()) {
  const setup = new ModelSetup(document.body, {
    onReady: (status) => {
      engineControls.show(status);
      setStatus(`Model ready. Write a sum ending in =, then pause. ${FIX_HINT}`);
      // Lines written while the model was missing failed to read: read them now.
      controller.rereadAll();
    },
  });
  let shownSetup = false;
  const engineControls = bindEngineControls(document.getElementById("engine")!, {
    onMissing: (status, fromClick) => {
      // Open by itself once per launch; after "Not now" only the toolbar link opens it.
      if (shownSetup && !fromClick) return;
      shownSetup = true;
      setup.show(status);
    },
  });
  // A newer release on GitHub: a quiet link to its download page. Never an error.
  void invoke<{ version: string; url: string } | null>("check_update")
    .then((update) => {
      if (!update) return;
      const link = document.getElementById("update") as HTMLButtonElement;
      link.textContent = `Update available: v${update.version}`;
      link.hidden = false;
      link.addEventListener("click", () => {
        invoke("open_release_page", { url: update.url }).catch((error) =>
          setStatus(`Could not open the download page: ${error}`, undefined, true),
        );
      });
    })
    .catch(() => {});
  // Closing right after writing must not lose the last stroke: write it before the window goes.
  void getCurrentWindow().onCloseRequested(async () => {
    await session.flush();
  });
  void invoke<string | null>("selftest_dir").then((dir) => {
    if (dir && import.meta.env.DEV) void session.create().then(() => runSelfTest(ink, recognizer, controller, session, setStatus));
    else void session.start();
  });
} else {
  setStatus("Browser preview: ink only. Recognition needs the desktop app.");
  void session.start();
}
