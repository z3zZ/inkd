import katex from "katex";
import { stripMathDelimiters } from "../math/latexToMath";

export interface CorrectionRequest {
  /** What the line reads as now. */
  latex: string;
  /** What the model read, when the line has already been corrected. */
  original: string | null;
  /** Screen position to open at: just below the line. */
  left: number;
  top: number;
  onSave: (latex: string) => void;
  onReread: () => void;
}

/** A small editor for what a line was read as: type the LaTeX, see it rendered, save. */
export class CorrectionPopover {
  private readonly root: HTMLElement;
  private readonly preview: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly modelRead: HTMLElement;
  private request: CorrectionRequest | null = null;

  constructor(parent: HTMLElement) {
    this.root = document.createElement("div");
    this.root.className = "correction";
    this.root.hidden = true;
    this.root.setAttribute("role", "dialog");
    this.root.setAttribute("aria-label", "Correct this line");

    const heading = document.createElement("div");
    heading.className = "correction-heading";
    heading.textContent = "Correct this line";

    this.preview = document.createElement("div");
    this.preview.className = "correction-preview";

    this.input = document.createElement("input");
    this.input.type = "text";
    this.input.className = "correction-input";
    this.input.spellcheck = false;
    this.input.setAttribute("aria-label", "LaTeX for this line");
    this.input.addEventListener("input", () => this.renderPreview());
    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.save();
      } else if (e.key === "Escape") {
        e.preventDefault();
        this.close();
      }
    });

    this.modelRead = document.createElement("div");
    this.modelRead.className = "correction-model";

    const actions = document.createElement("div");
    actions.className = "correction-actions";
    const reread = this.button("Read again", "tool", () => {
      const request = this.request;
      this.close();
      request?.onReread();
    });
    reread.title = "Forget this reading and read the ink again";
    const cancel = this.button("Cancel", "tool", () => this.close());
    const save = this.button("Save", "tool primary", () => this.save());
    save.title = "Save (Enter)";
    actions.append(reread, document.createElement("span"), cancel, save);
    actions.children[1].className = "spacer";

    this.root.append(heading, this.preview, this.input, this.modelRead, actions);
    parent.append(this.root);

    // Clicking or writing anywhere else closes it without saving.
    document.addEventListener(
      "pointerdown",
      (e) => {
        if (this.isOpen && !this.root.contains(e.target as Node)) this.close();
      },
      true,
    );
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  open(request: CorrectionRequest): void {
    this.request = request;
    this.input.value = stripMathDelimiters(request.latex);
    this.modelRead.replaceChildren();
    if (request.original !== null) {
      this.modelRead.append("Model read: ");
      const code = document.createElement("code");
      code.textContent = stripMathDelimiters(request.original);
      this.modelRead.append(code);
    }
    this.modelRead.hidden = request.original === null;
    this.root.hidden = false;
    this.renderPreview();

    // Keep it on screen.
    const { width, height } = this.root.getBoundingClientRect();
    const left = Math.max(8, Math.min(request.left, window.innerWidth - width - 8));
    const below = request.top + height + 8 <= window.innerHeight;
    this.root.style.left = `${left}px`;
    this.root.style.top = `${below ? request.top : Math.max(8, request.top - height - 60)}px`;

    this.input.focus();
    this.input.select();
  }

  close(): void {
    this.root.hidden = true;
    this.request = null;
  }

  private save(): void {
    const request = this.request;
    const text = this.input.value.trim();
    this.close();
    if (!request || !text) return;
    if (text !== stripMathDelimiters(request.latex)) request.onSave(text);
  }

  private renderPreview(): void {
    const text = this.input.value.trim();
    if (!text) {
      this.preview.textContent = "Type the LaTeX for this line";
      this.preview.classList.add("empty");
      return;
    }
    this.preview.classList.remove("empty");
    katex.render(text, this.preview, { throwOnError: false, displayMode: false });
  }

  private button(label: string, className: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement("button");
    b.className = className;
    b.textContent = label;
    b.addEventListener("click", onClick);
    return b;
  }
}
