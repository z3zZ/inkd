import { invoke, isTauri } from "@tauri-apps/api/core";
import type { NoteFile, NoteMeta } from "./format";

/** Where notes live. Every call works on whole note files as JSON text. */
export interface NoteStore {
  /** Newest first. Damaged files are skipped. */
  list(): Promise<NoteMeta[]>;
  load(id: string): Promise<string>;
  save(note: NoteFile): Promise<void>;
  /** Moves the note out of the list. The desktop store keeps it in a trash folder. */
  remove(id: string): Promise<void>;
}

/** One JSON file per note in the app's data folder, written by the Rust backend. */
export class TauriNoteStore implements NoteStore {
  list(): Promise<NoteMeta[]> {
    return invoke<NoteMeta[]>("notes_list");
  }

  load(id: string): Promise<string> {
    return invoke<string>("note_load", { id });
  }

  async save(note: NoteFile): Promise<void> {
    const body = new TextEncoder().encode(JSON.stringify(note));
    await invoke("note_save", body, { headers: { "x-note-id": note.id } });
  }

  async remove(id: string): Promise<void> {
    await invoke("note_delete", { id });
  }
}

const PREFIX = "inkd.note.";

/** Browser preview only: keeps notes in localStorage so the notes UI can be tried without the desktop app. */
export class BrowserNoteStore implements NoteStore {
  async list(): Promise<NoteMeta[]> {
    const metas: NoteMeta[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(PREFIX)) continue;
      try {
        const { id, title, createdAt, updatedAt, preview } = JSON.parse(localStorage.getItem(key)!) as NoteFile;
        metas.push({ id, title, createdAt, updatedAt, preview: preview ?? [] });
      } catch {
        // Skip damaged entries, as the desktop store does.
      }
    }
    return metas.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async load(id: string): Promise<string> {
    const json = localStorage.getItem(PREFIX + id);
    if (json === null) throw new Error("note not found");
    return json;
  }

  async save(note: NoteFile): Promise<void> {
    localStorage.setItem(PREFIX + note.id, JSON.stringify(note));
  }

  async remove(id: string): Promise<void> {
    localStorage.removeItem(PREFIX + id);
  }
}

export function createNoteStore(): NoteStore {
  return isTauri() ? new TauriNoteStore() : new BrowserNoteStore();
}
