import { describe, expect, it } from "vitest";
import { type Solution, solveNote } from "./engine";

const shown = (solutions: Solution[]) => solutions.map((s) => (s.kind === "result" ? s.value : s.kind));

describe("solveNote", () => {
  it("uses a variable defined on an earlier line", () => {
    expect(shown(solveNote(["x=5", "2x="]))).toEqual(["assignment", "10"]);
  });

  it("chains variables through several lines", () => {
    expect(shown(solveNote(["x=5", "y=2x+1", "x+y=", "\\frac{y}{x}="]))).toEqual(["assignment", "assignment", "16", "2.2"]);
  });

  it("only lets a line see variables defined above it", () => {
    const [first] = solveNote(["2x=", "x=5"]);
    expect(first).toMatchObject({ kind: "none", reason: expect.stringContaining("x") });
  });

  it("uses the latest value when a variable is redefined", () => {
    expect(shown(solveNote(["x=5", "x=", "x=7", "x="]))).toEqual(["assignment", "5", "assignment", "7"]);
  });

  it("forgets a variable whose new definition cannot be worked out", () => {
    const solutions = solveNote(["x=5", "x=y+1", "x="]);
    expect(solutions[1]).toMatchObject({ kind: "assignment", name: "x", value: null });
    expect(solutions[2].kind).toBe("none");
  });

  it("defines and calls a function", () => {
    expect(shown(solveNote(["f(x)=x^2+1", "f(2)=", "f(3)+f(1)="]))).toEqual(["function", "5", "12"]);
  });

  it("defines and calls a function written with \\left and \\right", () => {
    expect(shown(solveNote(["\\[f \\left( x \\right)=x^{2}+1\\]", "\\[f \\left( 2 \\right)=\\]"]))).toEqual(["function", "5"]);
  });

  it("a function sees variables defined above it", () => {
    expect(shown(solveNote(["a=3", "g(x)=ax", "g(2)="]))).toEqual(["assignment", "function", "6"]);
  });

  it("reports the assigned value", () => {
    expect(solveNote(["x=2^{1 0}"])[0]).toEqual({ kind: "assignment", name: "x", value: "1024" });
  });

  it("works with the model's display-math wrapper", () => {
    expect(shown(solveNote(["\\[x=5\\]", "\\[2x=\\]"]))).toEqual(["assignment", "10"]);
  });

  it("leaves lines it cannot read alone without breaking the rest", () => {
    expect(shown(solveNote(["x=5", "\\unknown", "x+1="]))).toEqual(["assignment", "none", "6"]);
  });

  it("does not treat an equation as an assignment", () => {
    expect(shown(solveNote(["2x+3=7", "x=5=", "5=x"]))).toEqual(["none", "none", "none"]);
  });

  it("starts each note with an empty scope", () => {
    solveNote(["x=5"]);
    expect(solveNote(["x="])[0].kind).toBe("none");
  });
});
