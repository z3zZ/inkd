export interface Recognition {
  latex: string;
  /** Geometric mean of the per-token probabilities, 0..1. */
  confidence: number;
  /** Inference time in the backend, in milliseconds. */
  ms: number;
}

/** Models sit behind this interface, so one can be swapped without touching the UI. */
export interface Recognizer {
  recognise(png: Uint8Array): Promise<Recognition>;
}
