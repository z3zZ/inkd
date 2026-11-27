import { scratchedOut } from "./gestures";
import {
  DEFAULT_PEN_SIZE,
  type InkPoint,
  liveStrokePath,
  newStrokeId,
  reserveStrokeIds,
  type Stroke,
  strokeBBox,
  strokeHit,
  strokePath,
} from "./strokes";

export type Tool = "pen" | "eraser";
export type PageBackground = "plain" | "grid" | "lined" | "dots";

/** Spacing of the page background, in page pixels. Lined suits a line of handwriting. */
const GRID = 32;
const RULE = 64;

export interface StrokeChange {
  added: Stroke[];
  removed: Stroke[];
}

export interface InkCanvasEvents {
  onChange?: (change: StrokeChange) => void;
  onPenDown?: () => void;
  onPenUp?: () => void;
  onScroll?: (scrollY: number) => void;
  onHistory?: (canUndo: boolean, canRedo: boolean) => void;
  /** Right-click, or the pen's barrel button. x, y on the page; clientX, clientY on screen. */
  onSecondary?: (x: number, y: number, clientX: number, clientY: number) => void;
}

const ERASER_RADIUS = 10;
/** Pointer Events: button 5 / buttons bit 32 is the pen's eraser end. */
const ERASER_BUTTON = 5;
const ERASER_BUTTONS_BIT = 32;
/** Right mouse button, and the barrel button on most pens. */
const SECONDARY_BUTTON = 2;
const SECONDARY_BUTTONS_BIT = 2;
/** A finger only scrolls once the pen has been away this long, so a resting palm cannot move the page. */
const PEN_QUIET_MS = 700;
/** Shortest scrollbar thumb, so it stays easy to grab with a pen. */
const MIN_THUMB = 36;
/** Gap above and below the scrollbar; matches .scrollbar in styles.css. */
const TRACK_INSET = 4;

export class InkCanvas {
  private readonly base: HTMLCanvasElement;
  private readonly live: HTMLCanvasElement;
  private readonly baseCtx: CanvasRenderingContext2D;
  private readonly liveCtx: CanvasRenderingContext2D;

  private strokes: Stroke[] = [];
  private undoStack: StrokeChange[] = [];
  private redoStack: StrokeChange[] = [];

  private tool: Tool = "pen";
  private background: PageBackground = "plain";
  private inkColor = "#1d2433";
  private guideColor = "#e3e0d6";
  private scrollY = 0;
  private dpr = 1;

  private activePointer: number | null = null;
  private drawing: Stroke | null = null;
  private erasedThisGesture: Stroke[] | null = null;
  private liveFrame = 0;

  /** A finger dragging the page. */
  private pan: { pointer: number; lastY: number } | null = null;
  private lastPenAt = -Infinity;
  /** Bottom edge of the lowest ink, in page pixels. */
  private contentBottom = 0;
  private readonly track: HTMLElement;
  private readonly thumb: HTMLElement;
  /** A drag of the scrollbar thumb: where it started, and the page length it was measured against. */
  private thumbDrag: { pointer: number; startY: number; startScroll: number; perPixel: number } | null = null;

  constructor(
    private readonly host: HTMLElement,
    private readonly events: InkCanvasEvents = {},
  ) {
    this.base = document.createElement("canvas");
    this.live = document.createElement("canvas");
    host.append(this.base, this.live);
    this.baseCtx = this.base.getContext("2d")!;
    this.liveCtx = this.live.getContext("2d")!;

    this.track = document.createElement("div");
    this.track.className = "scrollbar";
    this.thumb = document.createElement("div");
    this.thumb.className = "scroll-thumb";
    this.thumb.title = "Drag to scroll the page";
    this.track.append(this.thumb);
    host.append(this.track);
    this.thumb.addEventListener("pointerdown", this.onThumbDown);
    this.thumb.addEventListener("pointermove", this.onThumbMove);
    this.thumb.addEventListener("pointerup", this.onThumbEnd);
    this.thumb.addEventListener("pointercancel", this.onThumbEnd);

    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
    this.watchPixelRatio();

    const el = this.live;
    el.addEventListener("pointerdown", this.onPointerDown);
    el.addEventListener("pointermove", this.onPointerMove);
    el.addEventListener("pointerup", this.onPointerEnd);
    el.addEventListener("pointercancel", this.onPointerEnd);
    el.addEventListener("contextmenu", (e) => e.preventDefault());
    el.addEventListener("wheel", this.onWheel, { passive: false });
  }

  get allStrokes(): readonly Stroke[] {
    return this.strokes;
  }

  get scroll(): number {
    return this.scrollY;
  }

  /** Scrolls the page by a distance in page pixels. Used by the wheel, keys, fingers and the scrollbar. */
  scrollBy(dy: number): void {
    this.scrollTo(this.scrollY + dy);
  }

  scrollTo(y: number): void {
    const next = Math.max(0, y);
    if (next === this.scrollY) return;
    this.scrollY = next;
    this.redraw();
    this.requestLive();
    this.events.onScroll?.(this.scrollY);
  }

  /** Scrolls by a share of the visible page: 1 is one screenful down, -1 one up. */
  scrollPages(pages: number): void {
    this.scrollBy(pages * this.host.clientHeight);
  }

  setBackground(background: PageBackground): void {
    this.background = background;
    this.redraw();
  }

  /** Picks up the theme's colours. Call after the theme changes. */
  refreshTheme(): void {
    const style = getComputedStyle(this.host);
    this.inkColor = style.getPropertyValue("--ink").trim() || this.inkColor;
    this.guideColor = style.getPropertyValue("--guide").trim() || this.guideColor;
    this.redraw();
    this.requestLive();
  }

  setTool(tool: Tool): void {
    this.tool = tool;
    this.host.classList.toggle("erasing", tool === "eraser");
  }

  undo(): void {
    if (this.activePointer !== null) return;
    const change = this.undoStack.pop();
    if (!change) return;
    this.redoStack.push(change);
    this.apply({ added: change.removed, removed: change.added });
  }

  redo(): void {
    if (this.activePointer !== null) return;
    const change = this.redoStack.pop();
    if (!change) return;
    this.undoStack.push(change);
    this.apply(change);
  }

  clear(): void {
    if (this.strokes.length) this.commit({ added: [], removed: [...this.strokes] });
  }

  /**
   * Replaces the page with another note's strokes. Not undoable: history belongs to the note
   * being left, so it is dropped, and the view goes back to the top.
   */
  load(strokes: Stroke[]): void {
    if (this.activePointer !== null) return;
    reserveStrokeIds(strokes);
    const removed = this.strokes;
    this.undoStack = [];
    this.redoStack = [];
    this.scrollY = 0;
    this.events.onScroll?.(0);
    this.strokes = [];
    this.apply({ added: strokes, removed });
  }

  /**
   * A finished pen stroke: added as ink, unless it is a scribble over ink, in which case it
   * erases what it covers and leaves no mark of its own. Public so the self-test can write.
   */
  finishStroke(stroke: Stroke): void {
    const scratched = scratchedOut(stroke, this.strokes);
    this.commit(scratched.length ? { added: [], removed: scratched } : { added: [stroke], removed: [] });
  }

  /** Adds finished strokes as one undoable step. Used by non-pointer input such as the self-test. */
  addStrokes(strokes: Stroke[]): void {
    if (strokes.length) this.commit({ added: strokes, removed: [] });
  }

  /** Removes strokes as one undoable step. Used by non-pointer input such as the self-test. */
  removeStrokes(strokes: Stroke[]): void {
    const present = strokes.filter((s) => this.strokes.includes(s));
    if (present.length) this.commit({ added: [], removed: present });
  }

  toPngBlob(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      this.base.toBlob((b) => (b ? resolve(b) : reject(new Error("canvas export failed"))), "image/png");
    });
  }

  private commit(change: StrokeChange): void {
    this.undoStack.push(change);
    this.redoStack.length = 0;
    this.apply(change);
  }

  private apply(change: StrokeChange): void {
    const removed = new Set(change.removed);
    this.strokes = this.strokes.filter((s) => !removed.has(s)).concat(change.added);
    this.contentBottom = this.strokes.reduce((bottom, s) => Math.max(bottom, strokeBBox(s).bottom), 0);
    this.redraw();
    this.events.onChange?.(change);
    this.events.onHistory?.(this.undoStack.length > 0, this.redoStack.length > 0);
  }

  private resize(): void {
    const { clientWidth: w, clientHeight: h } = this.host;
    this.dpr = window.devicePixelRatio || 1;
    for (const canvas of [this.base, this.live]) {
      canvas.width = Math.max(1, Math.round(w * this.dpr));
      canvas.height = Math.max(1, Math.round(h * this.dpr));
    }
    this.redraw();
  }

  /**
   * Windows scaling can change with no change in size, as when the window is dragged to a
   * monitor with a different scale. Redraw at the new pixel ratio so ink stays sharp.
   */
  private watchPixelRatio(): void {
    const query = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    query.addEventListener(
      "change",
      () => {
        this.resize();
        this.watchPixelRatio();
      },
      { once: true },
    );
  }

  /** How long the page is for scrolling: past the lowest ink, and never shorter than what is in view. */
  private pageLength(): number {
    const view = this.host.clientHeight;
    return Math.max(this.contentBottom + view / 2, this.scrollY + view);
  }

  /** Height of the scrollbar's track. Worked out from the page, since a hidden track has no size. */
  private trackLength(): number {
    return this.host.clientHeight - 2 * TRACK_INSET;
  }

  private updateScrollbar(): void {
    const view = this.host.clientHeight;
    const length = this.pageLength();
    const room = this.trackLength();
    // Nothing to scroll to: the page fits and is at the top.
    if (length <= view + 1 || room <= MIN_THUMB) {
      this.track.hidden = true;
      return;
    }
    this.track.hidden = false;
    const size = Math.max(MIN_THUMB, (view / length) * room);
    const travel = Math.max(1, room - size);
    this.thumb.style.height = `${size}px`;
    this.thumb.style.transform = `translateY(${(this.scrollY / (length - view)) * travel}px)`;
  }

  private onThumbDown = (e: PointerEvent): void => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    e.preventDefault();
    e.stopPropagation();
    const view = this.host.clientHeight;
    const travel = Math.max(1, this.trackLength() - this.thumb.offsetHeight);
    this.thumb.setPointerCapture(e.pointerId);
    this.thumbDrag = {
      pointer: e.pointerId,
      startY: e.clientY,
      startScroll: this.scrollY,
      perPixel: (this.pageLength() - view) / travel,
    };
    this.thumb.classList.add("dragging");
  };

  private onThumbMove = (e: PointerEvent): void => {
    const drag = this.thumbDrag;
    if (!drag || e.pointerId !== drag.pointer) return;
    this.scrollTo(drag.startScroll + (e.clientY - drag.startY) * drag.perPixel);
  };

  private onThumbEnd = (e: PointerEvent): void => {
    if (this.thumbDrag?.pointer !== e.pointerId) return;
    this.thumbDrag = null;
    this.thumb.classList.remove("dragging");
  };

  private prepare(ctx: CanvasRenderingContext2D): void {
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, -this.scrollY * this.dpr);
    ctx.fillStyle = this.inkColor;
  }

  private redraw(): void {
    const ctx = this.baseCtx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.base.width, this.base.height);
    this.prepare(ctx);
    this.drawBackground(ctx);
    ctx.fillStyle = this.inkColor;
    for (const stroke of this.strokes) ctx.fill(strokePath(stroke));
    this.updateScrollbar();
  }

  /** Grid, rules or dots in page coordinates, so they scroll with the ink. Never part of what is recognised. */
  private drawBackground(ctx: CanvasRenderingContext2D): void {
    if (this.background === "plain") return;
    const width = this.host.clientWidth;
    const top = this.scrollY;
    const bottom = top + this.host.clientHeight;
    ctx.save();
    ctx.fillStyle = this.guideColor;
    ctx.strokeStyle = this.guideColor;
    ctx.lineWidth = 1;
    const spacing = this.background === "lined" ? RULE : GRID;
    const first = Math.floor(top / spacing) * spacing;
    if (this.background === "dots") {
      for (let y = first; y <= bottom; y += spacing) {
        for (let x = spacing; x < width; x += spacing) {
          ctx.beginPath();
          ctx.arc(x, y, 1.4, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    } else {
      ctx.beginPath();
      // Half-pixel offsets keep 1px lines crisp.
      for (let y = first; y <= bottom; y += spacing) {
        ctx.moveTo(0, y + 0.5);
        ctx.lineTo(width, y + 0.5);
      }
      if (this.background === "grid") {
        for (let x = spacing; x < width; x += spacing) {
          ctx.moveTo(x + 0.5, top);
          ctx.lineTo(x + 0.5, bottom);
        }
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawLive = (): void => {
    this.liveFrame = 0;
    const ctx = this.liveCtx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.live.width, this.live.height);
    if (!this.drawing) return;
    this.prepare(ctx);
    ctx.fill(liveStrokePath(this.drawing));
  };

  private requestLive(): void {
    if (!this.liveFrame) this.liveFrame = requestAnimationFrame(this.drawLive);
  }

  private toPoint(e: PointerEvent): InkPoint {
    const rect = this.live.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top + this.scrollY, e.pointerType === "pen" ? Math.max(e.pressure, 0.05) : 0.5];
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (e.pointerType === "pen") this.lastPenAt = e.timeStamp;
    // Fingers and palms never ink; a resting hand must not leave marks. A finger may drag the
    // page, but only when the pen is not in use, so a palm laid down while writing does nothing.
    if (e.pointerType === "touch") {
      const penBusy = this.activePointer !== null || e.timeStamp - this.lastPenAt < PEN_QUIET_MS;
      if (!penBusy && this.pan === null) {
        this.live.setPointerCapture(e.pointerId);
        this.pan = { pointer: e.pointerId, lastY: e.clientY };
      }
      return;
    }
    // The pen has arrived: a finger that was scrolling was a hand coming to rest.
    this.pan = null;
    if (this.activePointer !== null) return;
    const isEraserEnd = e.button === ERASER_BUTTON || (e.buttons & ERASER_BUTTONS_BIT) !== 0;
    const isSecondary =
      !isEraserEnd && (e.button === SECONDARY_BUTTON || (e.pointerType === "pen" && (e.buttons & SECONDARY_BUTTONS_BIT) !== 0));
    if (isSecondary) {
      e.preventDefault();
      const [x, y] = this.toPoint(e);
      this.events.onSecondary?.(x, y, e.clientX, e.clientY);
      return;
    }
    if (e.pointerType === "mouse" && e.button !== 0) return;

    e.preventDefault();
    this.live.setPointerCapture(e.pointerId);
    this.activePointer = e.pointerId;
    this.events.onPenDown?.();

    if (isEraserEnd || this.tool === "eraser") {
      this.erasedThisGesture = [];
      this.eraseAt(e);
      return;
    }

    this.drawing = {
      id: newStrokeId(),
      points: [this.toPoint(e)],
      simulatePressure: e.pointerType !== "pen",
      size: DEFAULT_PEN_SIZE,
      startedAt: e.timeStamp,
      endedAt: e.timeStamp,
    };
    this.requestLive();
  };

  private onPointerMove = (e: PointerEvent): void => {
    // Hovering counts: the pen is near, so the hand is about to write.
    if (e.pointerType === "pen") this.lastPenAt = e.timeStamp;
    if (this.pan && e.pointerId === this.pan.pointer) {
      this.scrollBy(this.pan.lastY - e.clientY);
      this.pan.lastY = e.clientY;
      return;
    }
    if (e.pointerId !== this.activePointer) return;
    const samples = e.getCoalescedEvents?.() ?? [];
    const events = samples.length ? samples : [e];

    if (this.erasedThisGesture) {
      for (const sample of events) this.eraseAt(sample);
      return;
    }
    if (!this.drawing) return;

    for (const sample of events) {
      const point = this.toPoint(sample);
      const last = this.drawing.points[this.drawing.points.length - 1];
      if (point[0] !== last[0] || point[1] !== last[1]) this.drawing.points.push(point);
    }
    this.requestLive();
  };

  private onPointerEnd = (e: PointerEvent): void => {
    if (this.pan?.pointer === e.pointerId) {
      this.pan = null;
      return;
    }
    if (e.pointerId !== this.activePointer) return;
    this.activePointer = null;

    if (this.erasedThisGesture) {
      const removed = this.erasedThisGesture;
      this.erasedThisGesture = null;
      if (removed.length) {
        // Already gone from the page; put back so commit() records one undoable step.
        this.strokes.push(...removed);
        this.commit({ added: [], removed });
      }
    } else if (this.drawing) {
      const stroke = this.drawing;
      this.drawing = null;
      stroke.endedAt = e.timeStamp;
      if (e.type === "pointerup") this.finishStroke(stroke);
      this.requestLive();
    }
    this.events.onPenUp?.();
  };

  private eraseAt(e: PointerEvent): void {
    const [x, y] = this.toPoint(e);
    const hit = this.strokes.filter((s) => strokeHit(s, x, y, ERASER_RADIUS));
    if (!hit.length) return;
    this.erasedThisGesture!.push(...hit);
    const gone = new Set(hit);
    this.strokes = this.strokes.filter((s) => !gone.has(s));
    this.redraw();
  }

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.scrollBy(e.deltaY);
  };
}
