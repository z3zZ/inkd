import { describe, expect, it } from "vitest";
import { decimalAnswer, formatAnswer, toFraction } from "./answerFormat";

describe("fractions", () => {
  it("finds exact fractions, including from float noise", () => {
    expect(toFraction(1.25)).toEqual({ numerator: 5, denominator: 4 });
    expect(toFraction(1 / 3)).toEqual({ numerator: 1, denominator: 3 });
    expect(toFraction(0.1 + 0.2)).toEqual({ numerator: 3, denominator: 10 });
    expect(toFraction(-7 / 6)).toEqual({ numerator: -7, denominator: 6 });
    expect(toFraction(4)).toEqual({ numerator: 4, denominator: 1 });
  });

  it("gives up on numbers that are not simple fractions", () => {
    expect(toFraction(Math.SQRT2)).toBeNull();
    expect(toFraction(Math.PI)).toBeNull();
    expect(toFraction(1 / 1009)).toBeNull();
    expect(toFraction(Infinity)).toBeNull();
  });
});

describe("answer formats", () => {
  it("shows decimals unchanged", () => {
    expect(formatAnswer(1.25, "1.25", "decimal")).toEqual({ latex: "1.25", text: "1.25" });
  });

  it("shows improper fractions", () => {
    expect(formatAnswer(1.25, "1.25", "fraction")).toEqual({ latex: "\\frac{5}{4}", text: "5/4" });
    expect(formatAnswer(-0.5, "-0.5", "fraction")).toEqual({ latex: "-\\frac{1}{2}", text: "-1/2" });
  });

  it("shows mixed numbers, and plain fractions below one", () => {
    expect(formatAnswer(1.25, "1.25", "mixed")).toEqual({ latex: "1\\tfrac{1}{4}", text: "1 1/4" });
    expect(formatAnswer(-7 / 6, "-1.16666666667", "mixed")).toEqual({ latex: "-1\\tfrac{1}{6}", text: "-1 1/6" });
    expect(formatAnswer(0.75, "0.75", "mixed")).toEqual({ latex: "\\frac{3}{4}", text: "3/4" });
  });

  it("keeps whole numbers and irrational results as they are", () => {
    expect(formatAnswer(14, "14", "fraction")).toEqual({ latex: "14", text: "14" });
    expect(formatAnswer(Math.SQRT2, "1.41421356237", "mixed")).toEqual({ latex: "1.41421356237", text: "1.41421356237" });
  });
});

describe("very large and very small results", () => {
  it("writes e-notation as a power of ten", () => {
    expect(decimalAnswer("1.26765060023e+30")).toEqual({
      latex: "1.26765060023\\times 10^{30}",
      text: "1.26765060023 × 10^30",
    });
    expect(decimalAnswer("-2.5e-7").latex).toBe("-2.5\\times 10^{-7}");
    expect(decimalAnswer("1e+21").latex).toBe("10^{21}");
    expect(formatAnswer(2 ** 100, "1.26765060023e+30", "fraction").latex).toBe("1.26765060023\\times 10^{30}");
  });

  it("leaves ordinary decimals alone", () => {
    expect(decimalAnswer("1234.5")).toEqual({ latex: "1234.5", text: "1234.5" });
    expect(decimalAnswer("-0.25").latex).toBe("-0.25");
  });
});
