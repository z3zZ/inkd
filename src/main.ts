import { invoke, isTauri } from "@tauri-apps/api/core";
import "katex/dist/katex.min.css";
import { InkCanvas, type Tool } from "./canvas/InkCanvas";
import { BaselinePanel } from "./dev/baseline";
import { runSelfTest } from "./dev/selftest";
import { LineController } from "./lines/LineController";
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
  },
  onError: (message) => setStatus(message, undefined, true),
});

const ink = new InkCanvas(stage, {
  onChange: (change) => controller.handleChange(change),
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

const baseline = new BaselinePanel(document.getElementById("baseline")!, ink, recognizer);

window.addEventListener("keydown", (e) => {
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();
  if (mod && key === "z") {
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
    if (dir) void runSelfTest(ink, recognizer, controller, setStatus);
  });
} else {
  setStatus("Browser preview: ink only. Recognition needs the desktop app.");
}
