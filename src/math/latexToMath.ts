/** Converts recognised LaTeX to a mathjs expression string. Throws LatexError on anything unsupported. */
export class LatexError extends Error {}

type Token =
  | { type: "number"; text: string }
  | { type: "letter"; text: string }
  | { type: "command"; text: string }
  | { type: "symbol"; text: string };

const IGNORED_COMMANDS = new Set([
  "left", "right", "big", "Big", "bigg", "Bigg", "bigl", "bigr", "Bigl", "Bigr",
  "displaystyle", "textstyle", "limits", "nolimits", "quad", "qquad",
  ",", ";", ":", "!", " ",
]);

const FUNCTIONS: Record<string, string> = {
  sin: "sin", cos: "cos", tan: "tan", sec: "sec", csc: "csc", cot: "cot",
  arcsin: "asin", arccos: "acos", arctan: "atan",
  sinh: "sinh", cosh: "cosh", tanh: "tanh",
  ln: "log", log: "log10", exp: "exp",
};

const OPERATORS: Record<string, string> = { times: "*", cdot: "*", ast: "*", div: "/" };
const CONSTANTS: Record<string, string> = { pi: "pi" };
const GREEK = new Set(["alpha", "beta", "gamma", "delta", "theta", "lambda", "mu", "phi", "omega"]);
const UNWRAP_COMMANDS = new Set(["mathrm", "mathit", "mathbf", "operatorname", "text", "boldsymbol"]);
const FRACTIONS = new Set(["frac", "dfrac", "tfrac", "cfrac"]);
/** Single letters that read as a function when followed by "(". */
const FUNCTION_LETTERS = new Set(["f", "g", "h"]);

function tokenize(latex: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < latex.length) {
    const c = latex[i];
    if (/\s/.test(c) || c === "~") {
      i++;
    } else if (c === "\\") {
      const name = /^\\([a-zA-Z]+|[^a-zA-Z])/.exec(latex.slice(i));
      if (!name) throw new LatexError("stray backslash");
      tokens.push({ type: "command", text: name[1] });
      i += name[0].length;
    } else if (/[0-9.]/.test(c)) {
      // The model emits spaced digits ("1 2 . 5"); they are one number.
      const number = /^[0-9.](?:\s*(?:[0-9.]|\{,\}(?=\s*[0-9])))*/.exec(latex.slice(i))!;
      const text = number[0].replace(/\s|\{,\}/g, "");
      if ((text.match(/\./g) ?? []).length > 1 || text === ".") throw new LatexError(`bad number "${text}"`);
      tokens.push({ type: "number", text });
      i += number[0].length;
    } else if (/[a-zA-Z]/.test(c)) {
      tokens.push({ type: "letter", text: c });
      i++;
    } else {
      tokens.push({ type: "symbol", text: c === "−" ? "-" : c === "×" ? "*" : c === "÷" ? "/" : c });
      i++;
    }
  }
  return tokens;
}

class Translator {
  private pos = 0;
  constructor(private readonly tokens: Token[]) {}

  run(): string {
    const out = this.sequence(() => this.pos >= this.tokens.length);
    return out;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private isSymbol(text: string): boolean {
    const t = this.peek();
    return t?.type === "symbol" && t.text === text;
  }

  private skipIgnored(): void {
    for (let t = this.peek(); t?.type === "command" && IGNORED_COMMANDS.has(t.text); t = this.peek()) this.pos++;
  }

  private expectSymbol(text: string): void {
    this.skipIgnored();
    if (!this.isSymbol(text)) throw new LatexError(`expected "${text}"`);
    this.pos++;
  }

  /** Translates atoms until `done`, inserting the multiplication LaTeX leaves implicit. */
  private sequence(done: () => boolean): string {
    let out = "";
    let prevIsValue = false;
    let prevWasInteger = false;
    for (;;) {
      this.skipIgnored();
      if (done()) return out;
      const t = this.peek();
      if (!t) throw new LatexError("unexpected end of input");

      if (t.type === "symbol" && "+-*/=".includes(t.text)) {
        out += t.text;
        this.pos++;
        prevIsValue = false;
        prevWasInteger = false;
        continue;
      }
      if (t.type === "command" && OPERATORS[t.text]) {
        out += OPERATORS[t.text];
        this.pos++;
        prevIsValue = false;
        prevWasInteger = false;
        continue;
      }

      const isFraction = t.type === "command" && FRACTIONS.has(t.text);
      const isInteger = t.type === "number" && /^\d+$/.test(t.text);
      const atom = this.withPostfix(this.atom());

      if (prevWasInteger && isFraction) {
        // "2\frac{1}{2}" is a mixed number: add it to the whole part just written.
        const whole = /(\d+)$/.exec(out)!;
        out = `${out.slice(0, whole.index)}(${whole[1]}+${atom})`;
      } else {
        out += (prevIsValue ? "*" : "") + atom;
      }
      prevIsValue = true;
      prevWasInteger = isInteger && !atom.includes("^");
    }
  }

  private withPostfix(base: string): string {
    let out = base;
    for (;;) {
      this.skipIgnored();
      if (this.isSymbol("^")) {
        this.pos++;
        out += `^(${this.argument()})`;
      } else if (this.isSymbol("%")) {
        this.pos++;
        out = `(${out}/100)`;
      } else if (this.peek()?.type === "command" && this.peek()!.text === "%") {
        this.pos++;
        out = `(${out}/100)`;
      } else if (this.isSymbol("!")) {
        this.pos++;
        out += "!";
      } else {
        return out;
      }
    }
  }

  /** One argument of a command: a braced group or the next single atom. */
  private argument(): string {
    this.skipIgnored();
    if (this.isSymbol("{")) return this.group("{", "}");
    return this.atom();
  }

  private group(open: string, close: string): string {
    this.expectSymbol(open);
    const inner = this.sequence(() => this.isSymbol(close));
    this.expectSymbol(close);
    if (!inner) throw new LatexError("empty group");
    return inner;
  }

  private atom(): string {
    const t = this.peek();
    if (!t) throw new LatexError("expression ended early");

    switch (t.type) {
      case "number":
        this.pos++;
        return t.text;
      case "letter":
        return this.letter(t.text);
      case "symbol":
        if (t.text === "(") return `(${this.group("(", ")")})`;
        if (t.text === "[") return `(${this.group("[", "]")})`;
        if (t.text === "{") return `(${this.group("{", "}")})`;
        throw new LatexError(`unsupported symbol "${t.text}"`);
      case "command":
        return this.command(t.text);
    }
  }

  private letter(text: string): string {
    this.pos++;
    if (this.isSymbol("_")) {
      this.pos++;
      const sub = this.argument();
      if (!/^\w+$/.test(sub)) throw new LatexError("unsupported subscript");
      return `${text}_${sub}`;
    }
    if (FUNCTION_LETTERS.has(text)) {
      // The model often writes "f\left(2\right)", so look past \left before deciding.
      const before = this.pos;
      this.skipIgnored();
      if (this.isSymbol("(")) return `${text}(${this.group("(", ")")})`;
      this.pos = before;
    }
    return text;
  }

  private command(name: string): string {
    this.pos++;
    if (FRACTIONS.has(name)) {
      const numerator = this.argument();
      const denominator = this.argument();
      return `((${numerator})/(${denominator}))`;
    }
    if (name === "sqrt") {
      this.skipIgnored();
      if (this.isSymbol("[")) {
        const degree = this.group("[", "]");
        return `nthRoot(${this.argument()},${degree})`;
      }
      return `sqrt(${this.argument()})`;
    }
    if (FUNCTIONS[name]) return this.functionCall(FUNCTIONS[name]);
    if (CONSTANTS[name]) return CONSTANTS[name];
    if (GREEK.has(name)) return name;
    if (name === "{" || name === "}") {
      throw new LatexError(`unsupported "\\${name}"`);
    }
    if (UNWRAP_COMMANDS.has(name)) {
      const word = this.braceWord();
      if (word !== null && FUNCTIONS[word]) return this.functionCall(FUNCTIONS[word]);
      if (word !== null && word.length > 1) return word.split("").join("*");
      if (word !== null) return word;
      return `(${this.argument()})`;
    }
    throw new LatexError(`unsupported "\\${name}"`);
  }

  /** Reads "{abc}" as one word when the group holds only letters; otherwise leaves it unread. */
  private braceWord(): string | null {
    const start = this.pos;
    if (!this.isSymbol("{")) return null;
    this.pos++;
    let word = "";
    while (this.peek()?.type === "letter") word += this.tokens[this.pos++].text;
    if (word && this.isSymbol("}")) {
      this.pos++;
      return word;
    }
    this.pos = start;
    return null;
  }

  /** Handles "\sin(x)", "\sin x" and "\sin^2 x" (the last meaning (sin x)^2). */
  private functionCall(fn: string): string {
    this.skipIgnored();
    let power = "";
    if (this.isSymbol("^")) {
      this.pos++;
      power = `^(${this.argument()})`;
    }
    this.skipIgnored();
    const arg = this.argument();
    return `${fn}(${arg})${power}`;
  }
}

/** Removes the display-math wrapper the model puts around its output. */
function stripMathDelimiters(latex: string): string {
  const text = latex.trim();
  for (const [open, close] of [["\\[", "\\]"], ["\\(", "\\)"], ["$$", "$$"], ["$", "$"]]) {
    if (text.length >= open.length + close.length && text.startsWith(open) && text.endsWith(close)) {
      return text.slice(open.length, text.length - close.length);
    }
  }
  return text;
}

export function latexToMath(latex: string): string {
  return new Translator(tokenize(stripMathDelimiters(latex))).run();
}
