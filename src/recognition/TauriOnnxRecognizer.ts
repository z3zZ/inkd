import { invoke, isTauri } from "@tauri-apps/api/core";
import type { Recognition, Recognizer } from "./Recognizer";

export class TauriOnnxRecognizer implements Recognizer {
  recognise(png: Uint8Array): Promise<Recognition> {
    return invoke<Recognition>("recognize", png);
  }
}

/** Used when the page runs in a plain browser, where there is no backend. */
export class UnavailableRecognizer implements Recognizer {
  recognise(): Promise<Recognition> {
    return Promise.reject(new Error("Recognition needs the desktop app (npm run tauri dev)"));
  }
}

export function createRecognizer(): Recognizer {
  return isTauri() ? new TauriOnnxRecognizer() : new UnavailableRecognizer();
}
