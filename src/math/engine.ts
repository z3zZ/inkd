import { all, create } from "mathjs";
import { LatexError, latexToMath } from "./latexToMath";

const math = create(all);
// Expressions come from a recognition model, so they get arithmetic and nothing else.
const evaluate = math.evaluate.bind(math);
const blocked = () => {
  throw new Error("function disabled");
};
math.import(
  {
    import: blocked,
    createUnit: blocked,
    evaluate: blocked,
    parse: blocked,
    simplify: blocked,
    derivative: blocked,
    resolve: blocked,
  },
  { override: true },
);

export type Solution =
  | { kind: "result"; expression: string; value: string }
  | { kind: "none"; reason: string };

export function formatValue(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    // 12 significant figures hides binary float noise such as 0.30000000000000004.
    return math.format(value, { precision: 12 });
  }
  return null;
}

/** Solves a recognised line. A result needs a trailing "=", as in "3/4 + 1/2 =". */
export function solve(latex: string): Solution {
  let expression: string;
  try {
    expression = latexToMath(latex);
  } catch (error) {
    if (error instanceof LatexError) return { kind: "none", reason: error.message };
    throw error;
  }

  const parts = expression.split("=");
  if (parts.length !== 2 || parts[1] !== "") {
    return { kind: "none", reason: parts.length === 1 ? "no equals sign" : "not a calculation" };
  }
  if (!parts[0]) return { kind: "none", reason: "nothing before the equals sign" };

  try {
    const value = formatValue(evaluate(parts[0]));
    return value === null
      ? { kind: "none", reason: "result is not a number" }
      : { kind: "result", expression: parts[0], value };
  } catch (error) {
    return { kind: "none", reason: error instanceof Error ? error.message : "could not evaluate" };
  }
}

const PROBE_SCOPE = { x: 1.37, y: 0.73, a: 2.11, b: 1.19 };

function probe(side: string): number | null {
  try {
    const value = evaluate(side, { ...PROBE_SCOPE, f: (t: number) => t * 1.5 + 0.25 });
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

/** Whether two recognised lines mean the same thing, however the LaTeX is spelt. */
export function latexEquivalent(a: string, b: string): boolean {
  let left: string[];
  let right: string[];
  try {
    left = latexToMath(a).split("=");
    right = latexToMath(b).split("=");
  } catch {
    return false;
  }
  if (left.length !== right.length) return false;
  return left.every((side, i) => {
    if (side === right[i]) return true;
    const p = probe(side);
    const q = probe(right[i]);
    return p !== null && q !== null && Math.abs(p - q) < 1e-9;
  });
}
