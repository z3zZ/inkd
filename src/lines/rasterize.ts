import { type Stroke, strokeBBox, strokePath, unionBBox } from "../canvas/strokes";

/** Normalised ink height of a line image, in pixels. */
const TARGET_HEIGHT = 96;
const PADDING = 12;
const MAX_WIDTH = 2400;

/** Renders strokes black on white at a normalised height: the image the recogniser sees. */
export function rasterizeStrokes(strokes: readonly Stroke[]): Promise<Uint8Array> {
  const box = unionBBox(strokes.map(strokeBBox));
  const inkWidth = Math.max(1, box.right - box.left);
  const inkHeight = Math.max(1, box.bottom - box.top);
  const scale = Math.min(TARGET_HEIGHT / inkHeight, (MAX_WIDTH - 2 * PADDING) / inkWidth);

  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(inkWidth * scale) + 2 * PADDING;
  canvas.height = Math.ceil(inkHeight * scale) + 2 * PADDING;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(scale, 0, 0, scale, PADDING - box.left * scale, PADDING - box.top * scale);
  ctx.fillStyle = "#000";
  for (const stroke of strokes) ctx.fill(strokePath(stroke));

  return new Promise((resolve, reject) => {
    canvas.toBlob(async (blob) => {
      if (!blob) return reject(new Error("line rasterisation failed"));
      resolve(new Uint8Array(await blob.arrayBuffer()));
    }, "image/png");
  });
}
