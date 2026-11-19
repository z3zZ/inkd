import type { InkCanvas } from "../canvas/InkCanvas";
import type { LineController } from "../lines/LineController";
import { newNoteId, type NoteMeta, parseNote, serializeNote } from "./format";
import type { NoteStore } from "./store";

/** Saves this soon after the last change. Short, so closing the window right after writing loses nothing. */
const SAVE_DELAY_MS = 250;
const PREVIEW_LINES = 2;

export interface NoteSessionEvents {
  /** A different note is now on the page, or the current one was renamed. */
  onCurrent?: (meta: NoteMeta) => void;
  /** The list of notes may have changed. */
  onListChanged?: () => void;
  onError?: (message: string) => void;
}

function blankNote(): NoteMeta {
  const now = Date.now();
  return { id: newNoteId(), title: "", createdAt: now, updatedAt: now, preview: [] };
}

/** The note on the page: which one it is, and keeping its file up to date. */
export class NoteSession {
  private meta: NoteMeta = blankNote();
  /** Whether the note has a file yet. Blank notes get one only once something is written. */
  private persisted = false;
  private loading = false;
  private timer: number | undefined;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly store: NoteStore,
    private readonly ink: InkCanvas,
    private readonly lines: LineController,
    private readonly events: NoteSessionEvents = {},
  ) {}

  get current(): NoteMeta {
    return this.meta;
  }

  list(): Promise<NoteMeta[]> {
    return this.store.list();
  }

  /** Call on any change to the ink or to what a line was read as. */
  changed(): void {
    if (this.loading) return;
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.save(), SAVE_DELAY_MS);
  }

  /** Writes any change still waiting, and resolves once it is on disk. */
  flush(): Promise<void> {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
      void this.save();
    }
    return this.queue;
  }

  rename(title: string): void {
    const clean = title.trim();
    if (clean === this.meta.title) return;
    this.meta = { ...this.meta, title: clean };
    this.events.onCurrent?.(this.meta);
    // Naming a blank note is a reason to keep it.
    this.persisted ||= clean !== "";
    this.changed();
  }

  /** Opens the newest note, or a blank one if there are none. */
  async start(): Promise<void> {
    try {
      const [newest] = await this.store.list();
      if (newest && (await this.open(newest.id))) return;
    } catch (error) {
      this.fail(error);
    }
    this.showBlank();
  }

  /** Returns false, leaving the page as it was, if the note could not be read. */
  async open(id: string): Promise<boolean> {
    await this.flush();
    if (id === this.meta.id && this.persisted) return true;
    let note;
    try {
      note = parseNote(await this.store.load(id));
    } catch (error) {
      this.fail(error);
      return false;
    }
    this.show(note.meta, () => {
      this.lines.primeReadings(note.lines);
      this.ink.load(note.strokes);
    });
    this.persisted = true;
    return true;
  }

  async create(): Promise<void> {
    await this.flush();
    this.showBlank();
  }

  /** Moves a note out of the list. If it is the one on the page, a blank note takes its place. */
  async remove(id: string): Promise<void> {
    await this.flush();
    try {
      await this.store.remove(id);
    } catch (error) {
      this.fail(error);
      return;
    }
    if (id === this.meta.id) this.showBlank();
    this.events.onListChanged?.();
  }

  private showBlank(): void {
    this.show(blankNote(), () => this.ink.load([]));
    this.persisted = false;
  }

  private show(meta: NoteMeta, load: () => void): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.loading = true;
    try {
      load();
    } finally {
      this.loading = false;
    }
    this.meta = meta;
    this.events.onCurrent?.(meta);
  }

  private save(): Promise<void> {
    this.timer = undefined;
    // Snapshot now, so a later note switch cannot mix one note's id with another's ink.
    const strokes = [...this.ink.allStrokes];
    if (!strokes.length && !this.persisted) return this.queue;
    const readings = this.lines.readings();
    this.meta = {
      ...this.meta,
      updatedAt: Date.now(),
      preview: readings.slice(0, PREVIEW_LINES).map((r) => r.latex),
    };
    const file = serializeNote(this.meta, strokes, readings);
    const first = !this.persisted;
    this.persisted = true;
    this.queue = this.queue
      .then(() => this.store.save(file))
      .then(
        () => this.events.onListChanged?.(),
        (error) => {
          // Try to create the file again next time rather than assume it exists.
          if (first) this.persisted = false;
          this.fail(error);
        },
      );
    return this.queue;
  }

  private fail(error: unknown): void {
    this.events.onError?.(`Notes: ${error instanceof Error ? error.message : String(error)}`);
  }
}
