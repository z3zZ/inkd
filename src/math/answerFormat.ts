export type AnswerFormat = "decimal" | "fraction" | "mixed";

export const ANSWER_FORMATS: readonly AnswerFormat[] = ["decimal", "fraction", "mixed"];

export interface FormattedAnswer {
  /** For KaTeX and LaTeX export. */
  latex: string;
  /** Plain text, for the exported image. */
  text: string;
}

/** Fractions with bigger denominators than this read better as decimals. */
const MAX_DENOMINATOR = 1000;

/**
 * The simplest fraction equal to `value`, by continued fractions, or null if none with a
 * small denominator matches to within floating-point noise (so √2 or π stay decimal).
 */
export function toFraction(value: number): { numerator: number; denominator: number } | null {
  if (!Number.isFinite(value)) return null;
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value);
  const tolerance = 1e-9 * Math.max(1, x);
  // Convergents h/k of the continued fraction of x.
  let [h0, h1] = [0, 1];
  let [k0, k1] = [1, 0];
  let rest = x;
  for (let i = 0; i < 32; i++) {
    const a = Math.floor(rest);
    [h0, h1] = [h1, a * h1 + h0];
    [k0, k1] = [k1, a * k1 + k0];
    if (k1 > MAX_DENOMINATOR) return null;
    if (Math.abs(x - h1 / k1) <= tolerance) return { numerator: sign * h1, denominator: k1 };
    const fraction = rest - a;
    if (fraction < 1e-12) return null;
    rest = 1 / fraction;
  }
  return null;
}

/** Shows a result as a decimal, an improper fraction or a mixed number. */
export function formatAnswer(value: number, decimal: string, format: AnswerFormat): FormattedAnswer {
  const plain = { latex: decimal, text: decimal };
  if (format === "decimal") return plain;
  const f = toFraction(value);
  if (!f || f.denominator === 1) return plain;

  const minus = f.numerator < 0 ? "-" : "";
  const n = Math.abs(f.numerator);
  const d = f.denominator;
  if (format === "mixed" && n > d) {
    const whole = Math.floor(n / d);
    const part = n % d;
    return { latex: `${minus}${whole}\\tfrac{${part}}{${d}}`, text: `${minus}${whole} ${part}/${d}` };
  }
  return { latex: `${minus}\\frac{${n}}{${d}}`, text: `${minus}${n}/${d}` };
}
