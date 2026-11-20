import { type BBox, type Stroke, strokeBBox, strokePath, unionBBox } from "../canvas/strokes";
import type { ExportLine } from "../lines/LineController";
import { stripMathDelimiters } from "../math/latexToMath";

/** The note as LaTeX, one line per written line, with answers filled in after the `=`. */
export function noteLatex(lines: readonly Pick<ExportLine, "latex" | "result">[]): string {
  return lines
    .map(({ latex, result }) => {
      const text = stripMathDelimiters(latex);
      return result && text.endsWith("=") ? `${text} ${result.value}` : text;
    })
    .join("\n");
}

const PADDING = 32;
const SCALE = 2;
/** Matches the page: `.result` is 26px and KaTeX draws its maths at 1.21em. */
const RESULT_FONT = 26 * 1.21;

/** Exports are always light: they get pasted into documents, whatever the app's theme. */
const PAPER = "#ffffff";
const INK = "#1d2433";
const RESULT = "#3f7fb5";

/** The whole note as a PNG: ink plus the answers, on paper, cropped to what is written. */
export async function renderNotePng(strokes: readonly Stroke[], lines: readonly ExportLine[]): Promise<Blob> {
  if (!strokes.length) throw new Error("nothing to export: the note is empty");

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  const font = `${RESULT_FONT}px KaTeX_Main, "Times New Roman", serif`;
  ctx.font = font;

  const boxes: BBox[] = strokes.map(strokeBBox);
  for (const { result } of lines) {
    if (!result) continue;
    const width = ctx.measureText(result.text).width;
    boxes.push({
      left: result.left,
      right: result.left + width,
      top: result.top - RESULT_FONT / 2,
      bottom: result.top + RESULT_FONT / 2,
    });
  }
  const box = unionBBox(boxes);

  canvas.width = Math.ceil((box.right - box.left + 2 * PADDING) * SCALE);
  canvas.height = Math.ceil((box.bottom - box.top + 2 * PADDING) * SCALE);
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(SCALE, 0, 0, SCALE, (PADDING - box.left) * SCALE, (PADDING - box.top) * SCALE);

  ctx.fillStyle = INK;
  for (const stroke of strokes) ctx.fill(strokePath(stroke));

  // Results are drawn as plain text (5/4 rather than a stacked fraction), close to what the page shows.
  ctx.font = font;
  ctx.textBaseline = "middle";
  ctx.fillStyle = RESULT;
  for (const { result } of lines) {
    if (result) ctx.fillText(result.text, result.left, result.top);
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("image export failed"))), "image/png");
  });
}
