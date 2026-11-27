import { all, create } from "mathjs";
import { LatexError, latexToMath, type MathOptions } from "./latexToMath";

const math = create(all);
// Expressions come from a recognition model, so they get arithmetic and nothing else.
const evaluate = math.evaluate.bind(math);
// Taken before parse is blocked below, like evaluate: graphs compile a line once and run it per pixel.
const compile = math.compile.bind(math);
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
  /** `value` is the decimal shown by default; `number` is the same result, for other formats. */
  | { kind: "result"; expression: string; value: string; number: number }
  /** `x = 5`. `value` is null when the right-hand side could not be worked out. */
  | { kind: "assignment"; name: string; value: string | null; reason?: string }
  /** `f(x) = x^2 + 1`. `at` evaluates it, for graphing. */
  | { kind: "function"; name: string; at: Plot }
  /** `y = x^2 + 1` with x not defined above: a curve to graph rather than a value. */
  | { kind: "graph"; name: string; at: Plot }
  | { kind: "none"; reason: string };

/** One point of a curve: NaN where it is undefined, as at x = 0 for 1/x. */
export type Plot = (x: number) => number;

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
function solveLine(latex: string, scope: Scope, options: MathOptions): Solution {
  let expression: string;
  try {
    expression = latexToMath(latex, options);
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
      const raw = evaluate(lhs, scope);
      const value = formatValue(raw);
      return value === null
        ? { kind: "none", reason: "result is not a number" }
        : { kind: "result", expression: lhs, value, number: raw as number };
    } catch (error) {
      return { kind: "none", reason: errorReason(error, "could not evaluate") };
    }
  }

  if (VARIABLE.test(lhs)) {
    const curve = lhs !== PLOT_VARIABLE && !scope.has(PLOT_VARIABLE) ? asCurve(rhs, scope) : null;
    if (curve) {
      // y is a curve now, not a number: lines below must not use an older value of it.
      scope.delete(lhs);
      return { kind: "graph", name: lhs, at: curve };
    }
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
      const fn = scope.get(head[1]) as (t: number) => unknown;
      return { kind: "function", name: head[1], at: (t) => toNumber(() => fn(t)) };
    } catch (error) {
      scope.delete(head[1]);
      return { kind: "none", reason: errorReason(error, "could not define function") };
    }
  }

  return { kind: "none", reason: "not a calculation" };
}

/** The variable curves are drawn against. */
const PLOT_VARIABLE = "x";

function toNumber(run: () => unknown): number {
  try {
    const value = run();
    return typeof value === "number" ? value : NaN;
  } catch {
    return NaN;
  }
}

/**
 * The right-hand side as a function of x, if it uses x and gives numbers for it.
 * Uses the values defined above, as they are on this line.
 */
function asCurve(rhs: string, scope: Scope): Plot | null {
  let code: { evaluate: (scope: Map<string, unknown>) => unknown };
  try {
    code = compile(rhs);
  } catch {
    return null;
  }
  const local = new Map(scope);
  const at: Plot = (x) => {
    local.set(PLOT_VARIABLE, x);
    return toNumber(() => code.evaluate(local));
  };
  // It must depend on x: changing x changes the value somewhere on a few probe points.
  const probes = [-1.7, 0.3, 1.3, 2.9].map(at);
  if (probes.every((v) => !Number.isFinite(v))) return null;
  const finite = probes.filter(Number.isFinite);
  return finite.some((v) => Math.abs(v - finite[0]) > 1e-12) ? at : null;
}

/** Solves a note's lines top to bottom, so each line sees what the lines above define. */
export function solveNote(latexLines: readonly string[], options: MathOptions = {}): Solution[] {
  const scope: Scope = new Map();
  return latexLines.map((latex) => solveLine(latex, scope, options));
}

/** Solves a single line on its own. */
export function solve(latex: string, options: MathOptions = {}): Solution {
  return solveLine(latex, new Map(), options);
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
