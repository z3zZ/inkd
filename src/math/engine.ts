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
  /** `x = 5`. `value` is null when the right-hand side could not be worked out. */
  | { kind: "assignment"; name: string; value: string | null; reason?: string }
  /** `f(x) = x^2 + 1`. */
  | { kind: "function"; name: string }
  | { kind: "none"; reason: string };

/** Values and functions defined so far, read by the lines below. */
type Scope = Map<string, unknown>;

const VARIABLE = /^[a-zA-Z](?:_\w+)?$/;
const FUNCTION_HEAD = /^([a-zA-Z])\(([a-zA-Z])\)$/;

function errorReason(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function formatValue(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    // 12 significant figures hides binary float noise such as 0.30000000000000004.
    return math.format(value, { precision: 12 });
  }
  return null;
}

/**
 * Solves one line against the scope built by the lines above it, and adds anything it defines.
 *   "3/4 + 1/2 ="  → a result
 *   "x = 5"        → defines x for the lines below
 *   "f(x) = x^2"   → defines f for the lines below
 */
function solveLine(latex: string, scope: Scope): Solution {
  let expression: string;
  try {
    expression = latexToMath(latex);
  } catch (error) {
    if (error instanceof LatexError) return { kind: "none", reason: error.message };
    throw error;
  }

  const parts = expression.split("=");
  if (parts.length === 1) return { kind: "none", reason: "no equals sign" };
  if (parts.length > 2) return { kind: "none", reason: "more than one equals sign" };
  const [lhs, rhs] = parts;
  if (!lhs) return { kind: "none", reason: "nothing before the equals sign" };

  if (rhs === "") {
    try {
      const value = formatValue(evaluate(lhs, scope));
      return value === null
        ? { kind: "none", reason: "result is not a number" }
        : { kind: "result", expression: lhs, value };
    } catch (error) {
      return { kind: "none", reason: errorReason(error, "could not evaluate") };
    }
  }

  if (VARIABLE.test(lhs)) {
    try {
      const raw = evaluate(rhs, scope);
      const value = formatValue(raw);
      if (value !== null) {
        scope.set(lhs, raw);
        return { kind: "assignment", name: lhs, value };
      }
      scope.delete(lhs);
      return { kind: "assignment", name: lhs, value: null, reason: "value is not a number" };
    } catch (error) {
      // Lines below must not keep using an older value of a name that has been redefined.
      scope.delete(lhs);
      return { kind: "assignment", name: lhs, value: null, reason: errorReason(error, "could not evaluate") };
    }
  }

  const head = FUNCTION_HEAD.exec(lhs);
  if (head) {
    try {
      evaluate(`${lhs}=${rhs}`, scope);
      return { kind: "function", name: head[1] };
    } catch (error) {
      scope.delete(head[1]);
      return { kind: "none", reason: errorReason(error, "could not define function") };
    }
  }

  return { kind: "none", reason: "not a calculation" };
}

/** Solves a note's lines top to bottom, so each line sees what the lines above define. */
export function solveNote(latexLines: readonly string[]): Solution[] {
  const scope: Scope = new Map();
  return latexLines.map((latex) => solveLine(latex, scope));
}

/** Solves a single line on its own. */
export function solve(latex: string): Solution {
  return solveLine(latex, new Map());
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
