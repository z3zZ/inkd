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

/**
 * Browser preview with ?fake-reader: reads every line as 3+4=, or as the LaTeX given
 * (?fake-reader=1/4%2B1=), so the UI around results can be tried without the desktop app.
 */
export class FakeRecognizer implements Recognizer {
  constructor(private readonly latex: string) {}

  async recognise(): Promise<Recognition> {
    await new Promise((resolve) => setTimeout(resolve, 150));
    return { latex: this.latex, confidence: 1, ms: 150 };
  }
}

export function createRecognizer(): Recognizer {
  if (isTauri()) return new TauriOnnxRecognizer();
  const fake = new URLSearchParams(location.search).get("fake-reader");
  if (fake === null) return new UnavailableRecognizer();
  return new FakeRecognizer(fake || String.raw`\[3+4=\]`);
}
