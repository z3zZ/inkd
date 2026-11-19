import katex from "katex";
import type { NoteMeta } from "./format";
import type { NoteSession } from "./NoteSession";

const CONFIRM_MS = 3000;

export function displayTitle(meta: Pick<NoteMeta, "title">): string {
  return meta.title || "Untitled";
}

function when(ms: number): string {
  const date = new Date(ms);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: date.getFullYear() === today.getFullYear() ? undefined : "numeric",
  });
}

/** The drawer listing every note: open, start a new one, or delete. */
export class NotesPanel {
  private readonly list: HTMLElement;
  private refreshing = false;
  private again = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly toggleButton: HTMLButtonElement,
    private readonly session: NoteSession,
  ) {
    root.replaceChildren();
    const header = document.createElement("div");
    header.className = "notes-header";
    const heading = document.createElement("h2");
    heading.textContent = "Notes";
    const create = document.createElement("button");
    create.className = "tool primary";
    create.textContent = "New note";
    create.title = "New note (Ctrl+N)";
    create.addEventListener("click", () => void this.session.create().then(() => this.close()));
    header.append(heading, create);

    this.list = document.createElement("ul");
    this.list.className = "notes-list";
    root.append(header, this.list);

    toggleButton.addEventListener("click", () => this.toggle());
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  open(): void {
    this.root.hidden = false;
    this.toggleButton.setAttribute("aria-expanded", "true");
    void this.refresh();
  }

  close(): void {
    this.root.hidden = true;
    this.toggleButton.setAttribute("aria-expanded", "false");
  }

  /** Re-reads the list. Cheap to call often: only does work while the panel is open. */
  async refresh(): Promise<void> {
    if (!this.isOpen) return;
    if (this.refreshing) {
      this.again = true;
      return;
    }
    this.refreshing = true;
    try {
      const notes = await this.session.list();
      this.render(notes);
    } finally {
      this.refreshing = false;
      if (this.again) {
        this.again = false;
        void this.refresh();
      }
    }
  }

  private render(notes: NoteMeta[]): void {
    const currentId = this.session.current.id;
    const items = notes.map((meta) => this.item(meta, meta.id === currentId));
    if (!items.length) {
      const empty = document.createElement("li");
      empty.className = "notes-empty";
      empty.textContent = "No saved notes yet. Anything you write is saved automatically.";
      items.push(empty);
    }
    this.list.replaceChildren(...items);
  }

  private item(meta: NoteMeta, current: boolean): HTMLElement {
    const li = document.createElement("li");
    li.className = "note-item";
    if (current) li.classList.add("current");

    const open = document.createElement("button");
    open.className = "note-open";
    if (current) open.setAttribute("aria-current", "true");
    const title = document.createElement("span");
    title.className = "note-title";
    title.textContent = displayTitle(meta);
    const date = document.createElement("span");
    date.className = "note-date";
    date.textContent = when(meta.updatedAt);
    const preview = document.createElement("span");
    preview.className = "note-preview";
    if (meta.preview[0]) katex.render(meta.preview[0], preview, { throwOnError: false });
    else preview.textContent = "No lines read yet";
    open.append(title, date, preview);
    open.addEventListener("click", () => void this.session.open(meta.id).then(() => this.close()));

    const remove = document.createElement("button");
    remove.className = "note-delete";
    remove.textContent = "Delete";
    remove.title = `Delete "${displayTitle(meta)}"`;
    let armed: number | undefined;
    remove.addEventListener("click", () => {
      if (armed === undefined) {
        remove.textContent = "Confirm";
        remove.classList.add("armed");
        armed = window.setTimeout(() => {
          armed = undefined;
          remove.textContent = "Delete";
          remove.classList.remove("armed");
        }, CONFIRM_MS);
        return;
      }
      clearTimeout(armed);
      void this.session.remove(meta.id);
    });

    li.append(open, remove);
    return li;
  }
}
