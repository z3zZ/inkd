import type { SynthItem } from "./synthInk";

export interface TestLine {
  id: string;
  /** What the person is asked to write. */
  prompt: string;
  /** Correct LaTeX, compared by meaning rather than spelling. */
  latex: string;
  /** Layout for the synthetic stand-in ink. */
  synth: SynthItem[];
}

const frac = (top: SynthItem[], bottom: SynthItem[]): SynthItem => ({ frac: [top, bottom] });
const sup = (...items: SynthItem[]): SynthItem => ({ sup: items });
const sqrt = (...items: SynthItem[]): SynthItem => ({ sqrt: items });

/** The step-zero set: digits, fractions, powers, roots, trig and assignments. */
export const TEST_LINES: TestLine[] = [
  { id: "01-add", prompt: "12 + 34 =", latex: "12+34=", synth: ["1", "2", "+", "3", "4", "="] },
  { id: "02-sub", prompt: "7 − 5 =", latex: "7-5=", synth: ["7", "-", "5", "="] },
  { id: "03-mul", prompt: "6 × 8 =", latex: "6\\times 8=", synth: ["6", "×", "8", "="] },
  { id: "04-div", prompt: "9 ÷ 3 =", latex: "9\\div 3=", synth: ["9", "÷", "3", "="] },
  { id: "05-frac", prompt: "3/4 + 1/2 = (stacked)", latex: "\\frac{3}{4}+\\frac{1}{2}=", synth: [frac(["3"], ["4"]), "+", frac(["1"], ["2"]), "="] },
  { id: "06-frac", prompt: "5/6 − 1/3 = (stacked)", latex: "\\frac{5}{6}-\\frac{1}{3}=", synth: [frac(["5"], ["6"]), "-", frac(["1"], ["3"]), "="] },
  { id: "07-pow", prompt: "2¹⁰ =", latex: "2^{10}=", synth: ["2", sup("1", "0"), "="] },
  { id: "08-pow", prompt: "3² + 4² =", latex: "3^2+4^2=", synth: ["3", sup("2"), "+", "4", sup("2"), "="] },
  { id: "09-root", prompt: "√16 =", latex: "\\sqrt{16}=", synth: [sqrt("1", "6"), "="] },
  { id: "10-root", prompt: "√2 + 1 =", latex: "\\sqrt{2}+1=", synth: [sqrt("2"), "+", "1", "="] },
  { id: "11-trig", prompt: "sin(30) =", latex: "\\sin(30)=", synth: ["s", "i", "n", "(", "3", "0", ")", "="] },
  { id: "12-trig", prompt: "cos(0) + 1 =", latex: "\\cos(0)+1=", synth: ["c", "o", "s", "(", "0", ")", "+", "1", "="] },
  { id: "13-trig", prompt: "tan(45) =", latex: "\\tan(45)=", synth: ["t", "a", "n", "(", "4", "5", ")", "="] },
  { id: "14-assign", prompt: "x = 5", latex: "x=5", synth: ["x", "=", "5"] },
  { id: "15-assign", prompt: "y = 2x + 1", latex: "y=2x+1", synth: ["y", "=", "2", "x", "+", "1"] },
  { id: "16-assign", prompt: "f(x) = x² + 1", latex: "f(x)=x^2+1", synth: ["f", "(", "x", ")", "=", "x", sup("2"), "+", "1"] },
  { id: "17-brackets", prompt: "(2 + 3) × 4 =", latex: "(2+3)\\times 4=", synth: ["(", "2", "+", "3", ")", "×", "4", "="] },
  { id: "18-decimal", prompt: "1.5 + 2.25 =", latex: "1.5+2.25=", synth: ["1", ".", "5", "+", "2", ".", "2", "5", "="] },
  { id: "19-var", prompt: "2x + 3 =", latex: "2x+3=", synth: ["2", "x", "+", "3", "="] },
  { id: "20-frac", prompt: "(x + 1)/2 = (stacked)", latex: "\\frac{x+1}{2}=", synth: [frac(["x", "+", "1"], ["2"]), "="] },
];
