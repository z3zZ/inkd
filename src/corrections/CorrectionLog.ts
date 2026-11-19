import { invoke, isTauri } from "@tauri-apps/api/core";
import type { Stroke } from "../canvas/strokes";
import { rasterizeStrokes } from "../lines/rasterize";
import { stripMathDelimiters } from "../math/latexToMath";
import { newNoteId } from "../notes/format";

export interface Correction {
  original: string;
  corrected: string;
}

/**
 * Keeps each hand correction with the exact image the model saw, as training data for
 * fine-tuning on this handwriting. Lives in the app data folder under corrections/.
 */
export async function logCorrection(strokes: readonly Stroke[], correction: Correction): Promise<void> {
  if (!isTauri()) return;
  const png = await rasterizeStrokes(strokes);
  const json = new TextEncoder().encode(
    JSON.stringify({
      id: newNoteId(),
      // Both sides without the model's \[ \] wrapper, so the pairs compare like for like.
      original: stripMathDelimiters(correction.original),
      corrected: stripMathDelimiters(correction.corrected),
      at: Date.now(),
    }),
  );
  const body = new Uint8Array(4 + json.length + png.length);
  new DataView(body.buffer).setUint32(0, json.length, true);
  body.set(json, 4);
  body.set(png, 4 + json.length);
  await invoke("correction_log", body);
}
