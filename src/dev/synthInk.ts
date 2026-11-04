import { type InkPoint, newStrokeId, type Stroke } from "../canvas/strokes";

/**
 * Generates pen strokes for test lines from hand-tuned glyph skeletons, with seeded wobble.
 * It lets the whole pipeline run without a person. It is a stand-in, not real handwriting:
 * accuracy measured on it says little about how well someone's own writing is read.
 */
export type SynthItem =
  | string
  | { frac: [SynthItem[], SynthItem[]] }
  | { sup: SynthItem[] }
  | { sqrt: SynthItem[] };

type Pt = [number, number];
interface Glyph {
  width: number;
  strokes: Pt[][];
}

function arc(cx: number, cy: number, rx: number, ry: number, fromDeg: number, toDeg: number, steps = 14): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = ((fromDeg + ((toDeg - fromDeg) * i) / steps) * Math.PI) / 180;
    out.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  return out;
}

// Coordinates: x grows right, y grows down, digit height spans y 0..1, x-height letters y 0.35..1.
const GLYPHS: Record<string, Glyph> = {
  "0": { width: 0.6, strokes: [arc(0.3, 0.5, 0.27, 0.48, -95, 265)] },
  "1": { width: 0.32, strokes: [[[0.05, 0.2], [0.2, 0.02], [0.2, 0.5], [0.21, 1]]] },
  "2": { width: 0.6, strokes: [[...arc(0.28, 0.27, 0.25, 0.25, -170, 40), [0.25, 0.68], [0.03, 0.98], [0.3, 0.96], [0.58, 0.97]]] },
  "3": { width: 0.58, strokes: [[...arc(0.27, 0.24, 0.24, 0.23, -160, 80), ...arc(0.27, 0.72, 0.27, 0.27, -80, 165)]] },
  "4": { width: 0.62, strokes: [[[0.38, 0.02], [0.03, 0.68], [0.6, 0.68]], [[0.45, 0.3], [0.45, 1]]] },
  "5": { width: 0.58, strokes: [[[0.5, 0.03], [0.1, 0.05], [0.07, 0.45], ...arc(0.27, 0.68, 0.28, 0.3, -70, 160)]] },
  "6": { width: 0.58, strokes: [[[0.45, 0.02], [0.2, 0.3], ...arc(0.29, 0.7, 0.26, 0.28, 190, 540)]] },
  "7": { width: 0.58, strokes: [[[0.03, 0.05], [0.3, 0.04], [0.56, 0.03], [0.32, 0.5], [0.2, 1]]] },
  "8": { width: 0.56, strokes: [[...arc(0.28, 0.25, 0.22, 0.24, 90, -270), ...arc(0.28, 0.73, 0.26, 0.26, -90, 270)]] },
  "9": { width: 0.58, strokes: [[...arc(0.28, 0.28, 0.25, 0.26, 20, -340), [0.52, 0.6], [0.42, 1]]] },
  "+": { width: 0.6, strokes: [[[0.05, 0.55], [0.55, 0.55]], [[0.3, 0.28], [0.3, 0.82]]] },
  "-": { width: 0.55, strokes: [[[0.05, 0.55], [0.5, 0.55]]] },
  "=": { width: 0.58, strokes: [[[0.05, 0.42], [0.53, 0.42]], [[0.05, 0.68], [0.53, 0.68]]] },
  "×": { width: 0.55, strokes: [[[0.07, 0.32], [0.48, 0.8]], [[0.48, 0.32], [0.07, 0.8]]] },
  "÷": { width: 0.6, strokes: [[[0.05, 0.55], [0.55, 0.55]], arc(0.3, 0.32, 0.03, 0.03, 0, 360, 6), arc(0.3, 0.78, 0.03, 0.03, 0, 360, 6)] },
  ".": { width: 0.2, strokes: [arc(0.1, 0.96, 0.03, 0.03, 0, 360, 6)] },
  "(": { width: 0.3, strokes: [arc(0.42, 0.5, 0.32, 0.58, 120, 240)] },
  ")": { width: 0.3, strokes: [arc(-0.12, 0.5, 0.32, 0.58, -60, 60)] },
  x: { width: 0.5, strokes: [[[0.04, 0.38], [0.25, 0.68], [0.46, 1]], [[0.46, 0.38], [0.25, 0.68], [0.04, 1]]] },
  y: { width: 0.5, strokes: [[[0.04, 0.38], [0.25, 0.85]], [[0.46, 0.38], [0.25, 0.85], [0.1, 1.28]]] },
  f: { width: 0.42, strokes: [[...arc(0.33, 0.14, 0.1, 0.13, -20, -170), [0.2, 0.6], [0.18, 1.2]], [[0.04, 0.5], [0.38, 0.5]]] },
  s: { width: 0.42, strokes: [[...arc(0.22, 0.52, 0.16, 0.14, -30, -240), ...arc(0.2, 0.84, 0.17, 0.16, -80, 170)]] },
  i: { width: 0.2, strokes: [[[0.1, 0.4], [0.1, 1]], arc(0.1, 0.15, 0.02, 0.02, 0, 360, 6)] },
  n: { width: 0.5, strokes: [[[0.05, 0.38], [0.05, 1], ...arc(0.25, 0.55, 0.2, 0.18, -170, 0), [0.45, 1]]] },
  c: { width: 0.42, strokes: [arc(0.27, 0.69, 0.24, 0.3, -50, -305)] },
  o: { width: 0.5, strokes: [arc(0.25, 0.69, 0.22, 0.3, -90, 270)] },
  t: { width: 0.36, strokes: [[[0.17, 0.08], [0.17, 0.8], ...arc(0.28, 0.88, 0.11, 0.11, 180, 60, 6)], [[0.02, 0.38], [0.34, 0.38]]] },
  a: { width: 0.52, strokes: [[...arc(0.24, 0.69, 0.21, 0.3, -20, -350), [0.46, 0.38], [0.47, 1]]] },
};

const UNIT = 48;
const SPACING = 0.14;

/** Small seeded PRNG (mulberry32), so a run is repeatable. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function densify(points: Pt[], maxStep: number): Pt[] {
  const out: Pt[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1];
    const [x1, y1] = points[i];
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / maxStep));
    for (let k = 1; k <= n; k++) out.push([x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n]);
  }
  return out;
}

class Layout {
  readonly strokes: Stroke[] = [];
  private readonly random: () => number;

  constructor(seed: number) {
    this.random = rng(seed);
  }

  private wobble(amount: number): number {
    return (this.random() - 0.5) * 2 * amount;
  }

  private emit(points: Pt[]): void {
    const dense = densify(points, 3);
    const phase = this.random() * Math.PI * 2;
    const ink: InkPoint[] = dense.map(([x, y], i) => {
      const t = i / Math.max(1, dense.length - 1);
      const drift = 0.5 * Math.sin(phase + t * 7);
      // Pressure swells mid-stroke, like a real pen landing and lifting.
      const pressure = 0.35 + 0.4 * Math.sin(Math.PI * t);
      return [x + drift, y + drift * 0.7, pressure];
    });
    this.strokes.push({ id: newStrokeId(), points: ink, simulatePressure: false, size: 4.5, startedAt: 0, endedAt: 0 });
  }

  private drawGlyph(char: string, x: number, y: number, scale: number): number {
    const glyph = GLYPHS[char];
    if (!glyph) throw new Error(`no synthetic glyph for "${char}"`);
    const dx = this.wobble(0.02) * UNIT * scale;
    const dy = this.wobble(0.04) * UNIT * scale;
    const stretch = 1 + this.wobble(0.06);
    const slant = 0.06 + this.wobble(0.04);
    for (const stroke of glyph.strokes) {
      this.emit(
        stroke.map(([gx, gy]): Pt => [
          x + dx + (gx * stretch + (1 - gy) * slant) * UNIT * scale,
          y + dy + gy * stretch * UNIT * scale,
        ]),
      );
    }
    return (glyph.width + SPACING) * UNIT * scale;
  }

  /** Width of a run, computed by a throwaway layout so wobble in the real one stays seeded. */
  private measure(items: SynthItem[], scale: number): number {
    const probe = new Layout(1);
    return probe.run(items, 0, 0, scale);
  }

  run(items: SynthItem[], x: number, y: number, scale: number): number {
    let cursor = x;
    for (const item of items) {
      if (typeof item === "string") {
        cursor += this.drawGlyph(item, cursor, y, scale);
      } else if ("sup" in item) {
        cursor += this.run(item.sup, cursor, y - 0.32 * UNIT * scale, scale * 0.6);
        cursor += 0.1 * UNIT * scale;
      } else if ("frac" in item) {
        const [top, bottom] = item.frac;
        const inner = scale * 0.85;
        const topWidth = this.measure(top, inner);
        const bottomWidth = this.measure(bottom, inner);
        const width = Math.max(topWidth, bottomWidth);
        const barY = y + 0.55 * UNIT * scale;
        this.run(top, cursor + (width - topWidth) / 2, barY - 1.1 * UNIT * inner, inner);
        this.emit([[cursor - 3, barY], [cursor + width + 3, barY + this.wobble(1.5)]]);
        this.run(bottom, cursor + (width - bottomWidth) / 2, barY + 0.15 * UNIT * inner, inner);
        cursor += width + (SPACING + 0.1) * UNIT * scale;
      } else {
        const width = this.measure(item.sqrt, scale);
        const left = cursor + 0.42 * UNIT * scale;
        const top = y - 0.14 * UNIT * scale;
        this.emit([
          [cursor, y + 0.6 * UNIT * scale],
          [cursor + 0.12 * UNIT * scale, y + 0.52 * UNIT * scale],
          [cursor + 0.24 * UNIT * scale, y + 1.05 * UNIT * scale],
          [left - 0.04 * UNIT * scale, top],
          [left + width, top],
        ]);
        this.run(item.sqrt, left, y, scale);
        cursor = left + width + SPACING * UNIT * scale;
      }
    }
    return cursor - x;
  }
}

export function synthesizeLine(items: SynthItem[], x: number, y: number, seed: number): Stroke[] {
  const layout = new Layout(seed);
  layout.run(items, x, y, 1);
  return layout.strokes;
}
