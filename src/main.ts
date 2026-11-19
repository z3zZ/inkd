import { invoke, isTauri } from "@tauri-apps/api/core";
import "katex/dist/katex.min.css";
import { InkCanvas, type Tool } from "./canvas/InkCanvas";
import { BaselinePanel } from "./dev/baseline";
import { runSelfTest } from "./dev/selftest";
import { LineController } from "./lines/LineController";
import { noteLatex, renderNotePng } from "./notes/export";
import { NoteSession } from "./notes/NoteSession";
import { displayTitle, NotesPanel } from "./notes/NotesPanel";
import { createNoteStore } from "./notes/store";
import { createRecognizer } from "./recognition/TauriOnnxRecognizer";
import { bindEngineControls } from "./settings/engine";

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

function setStatus(message: string, latex?: string, isError = false): void {
  statusEl.replaceChildren();
  const text = document.createElement("span");
  text.textContent = message;
  if (isError) text.className = "error";
  statusEl.append(text);
  if (latex) {
    const code = document.createElement("code");
    code.textContent = latex;
    statusEl.append(code);
  }
}

const recognizer = createRecognizer();

const controller = new LineController(stage, recognizer, IDLE_MS, {
  onRecognising: () => setStatus("Recognising…"),
  onOutcome: ({ recognition, note }) => {
    const seconds = (recognition.ms / 1000).toFixed(2);
    const confidence = Math.round(recognition.confidence * 100);
    setStatus(`${seconds}s · ${confidence}% confident${note ? ` · ${note}` : ""}`, recognition.latex);
    session.changed();
  },
  onError: (message) => setStatus(message, undefined, true),
});

const ink = new InkCanvas(stage, {
  onChange: (change) => {
    controller.handleChange(change);
    session.changed();
  },
  onPenDown: () => controller.handlePenDown(),
  onPenUp: () => controller.handlePenUp(),
  onScroll: (y) => controller.setScroll(y),
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

const session = new NoteSession(createNoteStore(), ink, controller, {
  onCurrent: (meta) => {
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

const baseline = new BaselinePanel(document.getElementById("baseline")!, ink, recognizer);

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
  } else if (mod && e.shiftKey && key === "b") {
    e.preventDefault();
    baseline.toggle();
  } else if (!mod && key === "p") {
    selectTool("pen");
  } else if (!mod && key === "e") {
    selectTool("eraser");
  }
});

setStatus("Write a sum ending in =, then pause.");

if (isTauri()) {
  bindEngineControls(document.getElementById("engine")!);
  void invoke<string | null>("selftest_dir").then((dir) => {
    if (dir) void session.create().then(() => runSelfTest(ink, recognizer, controller, session, setStatus));
    else void session.start();
  });
} else {
  setStatus("Browser preview: ink only. Recognition needs the desktop app.");
  void session.start();
}
