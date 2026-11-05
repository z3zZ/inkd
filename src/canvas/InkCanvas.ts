import {
  DEFAULT_PEN_SIZE,
  type InkPoint,
  liveStrokePath,
  newStrokeId,
  type Stroke,
  strokeHit,
  strokePath,
} from "./strokes";

export type Tool = "pen" | "eraser";

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
}

const ERASER_RADIUS = 10;
/** Pointer Events: button 5 / buttons bit 32 is the pen's eraser end. */
const ERASER_BUTTON = 5;
const ERASER_BUTTONS_BIT = 32;
const INK = "#1d2433";

export class InkCanvas {
  private readonly base: HTMLCanvasElement;
  private readonly live: HTMLCanvasElement;
  private readonly baseCtx: CanvasRenderingContext2D;
  private readonly liveCtx: CanvasRenderingContext2D;

  private strokes: Stroke[] = [];
  private undoStack: StrokeChange[] = [];
  private redoStack: StrokeChange[] = [];

  private tool: Tool = "pen";
  private scrollY = 0;
  private dpr = 1;

  private activePointer: number | null = null;
  private drawing: Stroke | null = null;
  private erasedThisGesture: Stroke[] | null = null;
  private liveFrame = 0;

  constructor(
    private readonly host: HTMLElement,
    private readonly events: InkCanvasEvents = {},
  ) {
    this.base = document.createElement("canvas");
    this.live = document.createElement("canvas");
    host.append(this.base, this.live);
    this.baseCtx = this.base.getContext("2d")!;
    this.liveCtx = this.live.getContext("2d")!;

    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();

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

  private prepare(ctx: CanvasRenderingContext2D): void {
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, -this.scrollY * this.dpr);
    ctx.fillStyle = INK;
  }

  private redraw(): void {
    const ctx = this.baseCtx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.base.width, this.base.height);
    this.prepare(ctx);
    for (const stroke of this.strokes) ctx.fill(strokePath(stroke));
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
    // Fingers and palms never ink; a resting hand must not leave marks.
    if (e.pointerType === "touch" || this.activePointer !== null) return;
    const isEraserEnd = e.button === ERASER_BUTTON || (e.buttons & ERASER_BUTTONS_BIT) !== 0;
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
      if (e.type === "pointerup") this.commit({ added: [stroke], removed: [] });
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
    this.scrollY = Math.max(0, this.scrollY + e.deltaY);
    this.redraw();
    this.requestLive();
    this.events.onScroll?.(this.scrollY);
  };
}
