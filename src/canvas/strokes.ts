import { getStroke } from "perfect-freehand";

/** x, y in world coordinates; pressure 0..1. */
export type InkPoint = [number, number, number];

export interface BBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Stroke {
  id: number;
  points: InkPoint[];
  /** True when the device reports no real pressure (mouse, touch). */
  simulatePressure: boolean;
  size: number;
  startedAt: number;
  endedAt: number;
}

export const DEFAULT_PEN_SIZE = 4.5;

let nextStrokeId = 1;
export function newStrokeId(): number {
  return nextStrokeId++;
}

export function strokeBBox(stroke: Stroke): BBox {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const [x, y] of stroke.points) {
    if (x < left) left = x;
    if (x > right) right = x;
    if (y < top) top = y;
    if (y > bottom) bottom = y;
  }
  const r = stroke.size / 2;
  return { left: left - r, top: top - r, right: right + r, bottom: bottom + r };
}

export function unionBBox(boxes: BBox[]): BBox {
  return {
    left: Math.min(...boxes.map((b) => b.left)),
    top: Math.min(...boxes.map((b) => b.top)),
    right: Math.max(...boxes.map((b) => b.right)),
    bottom: Math.max(...boxes.map((b) => b.bottom)),
  };
}

function outlineToPath(outline: number[][]): Path2D {
  const path = new Path2D();
  if (outline.length < 2) return path;
  // Quadratic segments through midpoints keep the outline smooth at any zoom.
  path.moveTo(outline[0][0], outline[0][1]);
  for (let i = 1; i < outline.length; i++) {
    const [x0, y0] = outline[i];
    const [x1, y1] = outline[(i + 1) % outline.length];
    path.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
  }
  path.closePath();
  return path;
}

function outlineOf(stroke: Pick<Stroke, "points" | "simulatePressure" | "size">, complete: boolean): Path2D {
  return outlineToPath(
    getStroke(stroke.points, {
      size: stroke.size,
      thinning: 0.55,
      smoothing: 0.55,
      streamline: 0.4,
      simulatePressure: stroke.simulatePressure,
      last: complete,
    }),
  );
}

const pathCache = new WeakMap<Stroke, Path2D>();

export function strokePath(stroke: Stroke): Path2D {
  let path = pathCache.get(stroke);
  if (!path) {
    path = outlineOf(stroke, true);
    pathCache.set(stroke, path);
  }
  return path;
}

/** Outline of a stroke still being drawn; deliberately not cached. */
export function liveStrokePath(stroke: Stroke): Path2D {
  return outlineOf(stroke, false);
}

function distanceToSegmentSq(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  const qx = ax + t * dx - px;
  const qy = ay + t * dy - py;
  return qx * qx + qy * qy;
}

export function strokeHit(stroke: Stroke, x: number, y: number, radius: number): boolean {
  const reach = radius + stroke.size / 2;
  const reachSq = reach * reach;
  const { points } = stroke;
  if (points.length === 1) {
    return distanceToSegmentSq(x, y, points[0][0], points[0][1], points[0][0], points[0][1]) <= reachSq;
  }
  for (let i = 1; i < points.length; i++) {
    if (distanceToSegmentSq(x, y, points[i - 1][0], points[i - 1][1], points[i][0], points[i][1]) <= reachSq) {
      return true;
    }
  }
  return false;
}
