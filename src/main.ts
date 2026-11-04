import { InkCanvas, type Tool } from "./canvas/InkCanvas";

const penButton = document.getElementById("tool-pen") as HTMLButtonElement;
const eraserButton = document.getElementById("tool-eraser") as HTMLButtonElement;
const undoButton = document.getElementById("undo") as HTMLButtonElement;
const redoButton = document.getElementById("redo") as HTMLButtonElement;
const clearButton = document.getElementById("clear") as HTMLButtonElement;

const ink = new InkCanvas(document.getElementById("stage")!, {
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
  } else if (!mod && key === "p") {
    selectTool("pen");
  } else if (!mod && key === "e") {
    selectTool("eraser");
  }
});
