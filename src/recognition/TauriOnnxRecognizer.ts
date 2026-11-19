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

/** Browser preview with ?fake-reader: reads every line as 3+4=, so the UI around results can be tried. */
export class FakeRecognizer implements Recognizer {
  async recognise(): Promise<Recognition> {
    await new Promise((resolve) => setTimeout(resolve, 150));
    return { latex: String.raw`\[3+4=\]`, confidence: 1, ms: 150 };
  }
}

export function createRecognizer(): Recognizer {
  if (isTauri()) return new TauriOnnxRecognizer();
  return new URLSearchParams(location.search).has("fake-reader") ? new FakeRecognizer() : new UnavailableRecognizer();
}
