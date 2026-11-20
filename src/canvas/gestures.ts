import { type BBox, type Stroke, strokeBBox, strokeHit } from "./strokes";

/** Direction changes a scribble needs. A written W, M or z has at most three, a one-stroke 8 four. */
const MIN_REVERSALS = 5;
/** Ink travelled per unit of width along the zigzag: a scribble goes back and forth over itself. */
const MIN_PATH_RATIO = 3;
/** Movement smaller than this does not count as a change of direction (pen jitter). */
const MIN_LEG = 6;
/** How near the scribble's path a stroke must pass to be hit. */
const HIT_RADIUS = 6;
/** A hit stroke is erased only if this share of its extent lies inside the scribble's area. */
const MIN_COVERED = 0.5;

/** Counts back-and-forth movements along one axis, ignoring legs shorter than MIN_LEG. */
function reversals(values: number[]): { count: number; travel: number } {
  let count = 0;
  let travel = 0;
  let direction = 0;
  let anchor = values[0];
  for (let i = 1; i < values.length; i++) {
    travel += Math.abs(values[i] - values[i - 1]);
    const delta = values[i] - anchor;
    if (Math.abs(delta) < MIN_LEG) continue;
    const sign = Math.sign(delta);
    if (direction !== 0 && sign !== direction) count++;
    direction = sign;
    anchor = values[i];
  }
  return { count, travel };
}

/** Whether a stroke is shaped like a scribble: a tight zigzag along one axis. */
export function isScribble(stroke: Pick<Stroke, "points">): boolean {
  if (stroke.points.length < 8) return false;
  const xs = stroke.points.map((p) => p[0]);
  const ys = stroke.points.map((p) => p[1]);
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);
  // The zigzag runs along the longer axis... or across it, for a tall narrow scribble.
  for (const [values, span] of [
    [xs, width],
    [ys, height],
  ] as const) {
    const { count, travel } = reversals(values);
    if (count >= MIN_REVERSALS && span > 0 && travel / span >= MIN_PATH_RATIO) return true;
  }
  return false;
}

function overlapShare(inner: BBox, outer: BBox): number {
  const w = Math.max(0, Math.min(inner.right, outer.right) - Math.max(inner.left, outer.left));
  const h = Math.max(0, Math.min(inner.bottom, outer.bottom) - Math.max(inner.top, outer.top));
  const area = Math.max(1, inner.right - inner.left) * Math.max(1, inner.bottom - inner.top);
  return (Math.max(1, w) * Math.max(1, h)) / area;
}

/**
 * The strokes a scribble scratches out: touched by its path, and mostly inside its area.
 * Empty when the stroke is not a scribble, or covers nothing, in which case it is ordinary ink.
 */
export function scratchedOut(scribble: Stroke, strokes: readonly Stroke[]): Stroke[] {
  if (!isScribble(scribble)) return [];
  const area = strokeBBox(scribble);
  // Checking every few points along the path is plenty at writing speed.
  const step = Math.max(1, Math.floor(scribble.points.length / 120));
  return strokes.filter((stroke) => {
    if (stroke === scribble) return false;
    const box = strokeBBox(stroke);
    if (box.right < area.left || box.left > area.right || box.bottom < area.top || box.top > area.bottom) return false;
    if (overlapShare(box, area) < MIN_COVERED) return false;
    for (let i = 0; i < scribble.points.length; i += step) {
      const [x, y] = scribble.points[i];
      if (strokeHit(stroke, x, y, HIT_RADIUS)) return true;
    }
    return false;
  });
}
