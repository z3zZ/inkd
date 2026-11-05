import { describe, expect, it } from "vitest";
import { latexEquivalent, solve } from "./engine";
import { LatexError, latexToMath } from "./latexToMath";

describe("latexToMath", () => {
  it.each([
    ["1+2", "1+2"],
    ["\\[1+2=\\]", "1+2="],
    ["\\(1+2\\)", "1+2"],
    ["$$1+2$$", "1+2"],
    ["$1+2$", "1+2"],
    ["\\[\\sin \\left( 30 \\right)=\\]", "sin((30))="],
    ["1 2 + 3 4", "12+34"],
    ["1 . 5 + 2", "1.5+2"],
    ["\\frac{3}{4}+\\frac{1}{2}=", "((3)/(4))+((1)/(2))="],
    ["{\\frac{3}{4}}", "(((3)/(4)))"],
    ["\\dfrac{a}{b}", "((a)/(b))"],
    ["2\\frac{1}{2}", "(2+((1)/(2)))"],
    ["x\\frac{1}{2}", "x*((1)/(2))"],
    ["2x", "2*x"],
    ["xy", "x*y"],
    ["2(3+1)", "2*(3+1)"],
    ["(1+2)(3)", "(1+2)*(3)"],
    ["x^2", "x^(2)"],
    ["x^{2}+1", "x^(2)+1"],
    ["2^{1 0}", "2^(10)"],
    ["\\sqrt{16}", "sqrt(16)"],
    ["\\sqrt[3]{8}", "nthRoot(8,3)"],
    ["\\sqrt 4", "sqrt(4)"],
    ["\\sin(30)", "sin((30))"],
    ["\\sin 30", "sin(30)"],
    ["\\sin^2 x", "sin(x)^(2)"],
    ["\\ln x", "log(x)"],
    ["\\log(100)", "log10((100))"],
    ["\\operatorname{sin}(1)", "sin((1))"],
    ["\\mathrm{x}", "x"],
    ["6\\times 8", "6*8"],
    ["6\\cdot 8", "6*8"],
    ["9\\div 3", "9/3"],
    ["\\left(1+2\\right)", "(1+2)"],
    ["1\\,+\\;2", "1+2"],
    ["2\\pi", "2*pi"],
    ["x_1+1", "x_1+1"],
    ["f(x)=x^2", "f(x)=x^(2)"],
    ["f\\left(2\\right)=", "f(2)="],
    ["f \\left( x \\right)=x^{2}+1", "f(x)=x^(2)+1"],
    ["f\\,x", "f*x"],
    ["x(2)", "x*(2)"],
    ["5\\%", "(5/100)"],
    ["3!", "3!"],
    ["1−2", "1-2"],
  ])("%s -> %s", (latex, expected) => {
    expect(latexToMath(latex)).toBe(expected);
  });

  it.each(["\\frac{1}", "\\unknown{1}", "(1+2", "1+2)", "\\sqrt{}", "1.2.3", "|x|", "\\begin{matrix}"])(
    "rejects %s",
    (latex) => {
      expect(() => latexToMath(latex)).toThrow(LatexError);
    },
  );
});

describe("solve", () => {
  it.each([
    ["\\frac{3}{4}+\\frac{1}{2}=", "1.25"],
    ["3/4+1/2=", "1.25"],
    ["{\\frac{3}{4}}+{\\frac{1}{2}}=", "1.25"],
    ["\\[\\frac{3}{4}+ \\frac{1}{2}=\\]", "1.25"],
    ["0.1+0.2=", "0.3"],
    ["2^{1 0}=", "1024"],
    ["\\sqrt{1 6}=", "4"],
    ["(2+3)\\times 4=", "20"],
    ["2\\frac{1}{2}+1=", "3.5"],
    ["-3+1=", "-2"],
  ])("%s = %s", (latex, value) => {
    expect(solve(latex)).toMatchObject({ kind: "result", value });
  });

  it.each(["1+2", "x=5", "=", "2x=", "1/0=", "\\frac{1}", "a=b="])("has no result for %s", (latex) => {
    expect(solve(latex).kind).not.toBe("result");
  });

  it("does not expose mathjs internals to recognised text", () => {
    expect(solve("\\mathrm{import}(1)=").kind).toBe("none");
  });
});

describe("latexEquivalent", () => {
  it.each([
    ["\\frac{3}{4}+\\frac{1}{2}=", "3/4+1/2="],
    ["x=5", "x = 5"],
    ["y=2x+1", "y=2\\cdot x+1"],
    ["f(x)=x^2+1", "f(x)=x^{2}+1"],
  ])("%s ~ %s", (a, b) => {
    expect(latexEquivalent(a, b)).toBe(true);
  });

  it.each([
    ["1+2=", "1+3="],
    ["x=5", "y=5"],
    ["1+2", "1+2="],
    ["garbage\\foo", "1"],
  ])("%s !~ %s", (a, b) => {
    expect(latexEquivalent(a, b)).toBe(false);
  });
});
