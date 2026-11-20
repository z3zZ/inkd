import katex from "katex";
import type { Plot } from "../math/engine";
import { stripMathDelimiters } from "../math/latexToMath";
import { fitView, formatTick, niceStep, sampleCurve, ticks, type Viewport } from "./plot";

/** A line on the page that can be graphed. */
export interface Curve {
  lineId: number;
  /** y, or f for f(x) = …: what the legend and tooltip call it. */
  name: string;
  latex: string;
  at: Plot;
}

/** Fixed order of series colours (CSS --series-1…8, validated for both themes). Never cycled. */
const MAX_CURVES = 8;
const MARGIN = { left: 40, right: 12, top: 10, bottom: 24 };
const ZOOM_STEP = 1.0015;

export interface GraphPanelEvents {
  /** The colour shown for each line, so the page can mark which line is which curve. */
  onColors: (colors: Map<number, string>) => void;
  onClose: () => void;
  onStatus: (message: string, isError?: boolean) => void;
}

/** The docked graph: every curve on the page, with pan, zoom, hover readout and a legend. */
export class GraphPanel {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly legend: HTMLElement;
  private readonly tooltip: HTMLElement;
  private readonly plotArea: HTMLElement;
  private readonly empty: HTMLElement;

  private curves: Curve[] = [];
  /** Slot per line, kept while the line exists, so a curve keeps its colour as others come and go. */
  private readonly slots = new Map<number, number>();
  private readonly hidden = new Set<number>();
  private view: Viewport = fitView([]);
  /** Whether the user has panned or zoomed; until then new curves re-fit the view. */
  private moved = false;
  private hoverX: number | null = null;
  private drag: { id: number; x: number; y: number; view: Viewport } | null = null;
  private frame = 0;

  constructor(
    private readonly root: HTMLElement,
    private readonly events: GraphPanelEvents,
  ) {
    root.replaceChildren();
    const header = document.createElement("div");
    header.className = "graph-header";
    const title = document.createElement("h2");
    title.textContent = "Graph";
    const fit = this.button("Fit", "Show the curves again after panning or zooming (double-click the graph)", () => this.fit());
    const copy = this.button("Copy image", "Copy the graph as an image", () => void this.copyImage());
    const close = this.button("Close", "Close the graph (Ctrl+G)", () => this.events.onClose());
    const spacer = document.createElement("span");
    spacer.className = "spacer";
    header.append(title, spacer, fit, copy, close);

    this.plotArea = document.createElement("div");
    this.plotArea.className = "graph-plot";
    this.canvas = document.createElement("canvas");
    this.canvas.setAttribute("role", "img");
    this.ctx = this.canvas.getContext("2d")!;
    this.tooltip = document.createElement("div");
    this.tooltip.className = "graph-tooltip";
    this.tooltip.hidden = true;
    this.empty = document.createElement("div");
    this.empty.className = "graph-empty";
    this.empty.innerHTML = "";
    this.empty.append(
      "Write a curve such as ",
      this.math("y = x^2 - 3"),
      " or ",
      this.math("f(x) = \\sin(x)"),
      " and it is drawn here.",
    );
    this.plotArea.append(this.canvas, this.tooltip, this.empty);

    this.legend = document.createElement("ul");
    this.legend.className = "graph-legend";
    const hint = document.createElement("p");
    hint.className = "graph-hint";
    hint.textContent = "Drag to pan · scroll to zoom · double-click to fit · click a curve below to hide it";
    root.append(header, this.plotArea, hint, this.legend);

    new ResizeObserver(() => this.request()).observe(this.plotArea);
    this.bindPointer();
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  open(): void {
    this.root.hidden = false;
    this.request();
  }

  close(): void {
    this.root.hidden = true;
  }

  /** The note was switched: colours and the view start afresh. */
  reset(): void {
    this.slots.clear();
    this.hidden.clear();
    this.moved = false;
  }

  /** Curves on the page now, top to bottom. Call whenever the page is solved again. */
  setCurves(curves: Curve[]): void {
    const ids = new Set(curves.map((c) => c.lineId));
    for (const id of [...this.slots.keys()]) if (!ids.has(id)) this.slots.delete(id);
    for (const id of [...this.hidden]) if (!ids.has(id)) this.hidden.delete(id);
    // New curves take the lowest free slot; existing ones keep theirs.
    const shown: Curve[] = [];
    for (const curve of curves) {
      let slot = this.slots.get(curve.lineId);
      if (slot === undefined) {
        const used = new Set(this.slots.values());
        for (let s = 0; s < MAX_CURVES; s++) {
          if (!used.has(s)) {
            slot = s;
            break;
          }
        }
        if (slot === undefined) continue;
        this.slots.set(curve.lineId, slot);
      }
      shown.push(curve);
    }
    // Two curves both called y become y₁ and y₂, so labels and the readout can tell them apart.
    const counts = new Map<string, number>();
    for (const c of shown) counts.set(c.name, (counts.get(c.name) ?? 0) + 1);
    const seen = new Map<string, number>();
    this.curves = shown.map((c) => {
      if ((counts.get(c.name) ?? 0) < 2) return c;
      const n = (seen.get(c.name) ?? 0) + 1;
      seen.set(c.name, n);
      return { ...c, name: c.name + String(n).replace(/\d/g, (d) => "₀₁₂₃₄₅₆₇₈₉"[Number(d)]) };
    });
    if (!this.moved) this.view = fitView(this.visible().map((c) => c.at), this.aspect());
    this.renderLegend(curves.length - shown.length);
    this.events.onColors(new Map(shown.map((c) => [c.lineId, this.color(c)])));
    this.request();
  }

  /** Picks up theme colours. */
  refreshTheme(): void {
    this.renderLegend(0);
    this.events.onColors(new Map(this.curves.map((c) => [c.lineId, this.color(c)])));
    this.request();
  }

  private visible(): Curve[] {
    return this.curves.filter((c) => !this.hidden.has(c.lineId));
  }

  private color(curve: Curve): string {
    const slot = (this.slots.get(curve.lineId) ?? 0) + 1;
    return this.cssVar(`--series-${slot}`) || "#2a78d6";
  }

  private cssVar(name: string): string {
    return getComputedStyle(this.root).getPropertyValue(name).trim();
  }

  private fit(): void {
    this.moved = false;
    this.view = fitView(this.visible().map((c) => c.at), this.aspect());
    this.request();
  }

  /** Plot height over width, so the starting view has equal units on both axes. */
  private aspect(): number {
    const { w, h } = this.size();
    const pw = w - MARGIN.left - MARGIN.right;
    const ph = h - MARGIN.top - MARGIN.bottom;
    return pw > 0 && ph > 0 ? ph / pw : 0.8;
  }

  private request(): void {
    if (!this.frame) {
      this.frame = requestAnimationFrame(() => {
        this.frame = 0;
        this.draw();
      });
    }
  }

  // ---- drawing ----

  private size(): { w: number; h: number; dpr: number } {
    return { w: this.plotArea.clientWidth, h: this.plotArea.clientHeight, dpr: window.devicePixelRatio || 1 };
  }

  private toScreen(x: number, y: number, w: number, h: number): [number, number] {
    const { xMin, xMax, yMin, yMax } = this.view;
    const pw = w - MARGIN.left - MARGIN.right;
    const ph = h - MARGIN.top - MARGIN.bottom;
    return [MARGIN.left + ((x - xMin) / (xMax - xMin)) * pw, MARGIN.top + ((yMax - y) / (yMax - yMin)) * ph];
  }

  private toPlane(sx: number, sy: number): [number, number] {
    const { w, h } = this.size();
    const { xMin, xMax, yMin, yMax } = this.view;
    const pw = w - MARGIN.left - MARGIN.right;
    const ph = h - MARGIN.top - MARGIN.bottom;
    return [xMin + ((sx - MARGIN.left) / pw) * (xMax - xMin), yMax - ((sy - MARGIN.top) / ph) * (yMax - yMin)];
  }

  private draw(): void {
    if (!this.isOpen) return;
    const { w, h, dpr } = this.size();
    if (w < 50 || h < 50) return;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.empty.hidden = this.curves.length > 0;
    this.drawInto(this.ctx, w, h, dpr, this.cssVar("--paper"));
    this.renderTooltip(w, h);
  }

  private drawInto(ctx: CanvasRenderingContext2D, w: number, h: number, dpr: number, paper: string): void {
    const grid = this.cssVar("--guide");
    const axis = this.cssVar("--chrome-text");
    const text = this.cssVar("--chrome-text");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = paper;
    ctx.fillRect(0, 0, w, h);

    const { xMin, xMax, yMin, yMax } = this.view;
    const pw = w - MARGIN.left - MARGIN.right;
    const ph = h - MARGIN.top - MARGIN.bottom;
    const xStep = niceStep(xMax - xMin, Math.max(2, pw / 70));
    const yStep = niceStep(yMax - yMin, Math.max(2, ph / 45));
    const [ox, oy] = this.toScreen(0, 0, w, h);

    // Grid: recessive, behind everything.
    ctx.save();
    ctx.beginPath();
    ctx.rect(MARGIN.left, MARGIN.top, pw, ph);
    ctx.clip();
    ctx.strokeStyle = grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const x of ticks(xMin, xMax, xStep)) {
      const [sx] = this.toScreen(x, 0, w, h);
      ctx.moveTo(Math.round(sx) + 0.5, MARGIN.top);
      ctx.lineTo(Math.round(sx) + 0.5, MARGIN.top + ph);
    }
    for (const y of ticks(yMin, yMax, yStep)) {
      const [, sy] = this.toScreen(0, y, w, h);
      ctx.moveTo(MARGIN.left, Math.round(sy) + 0.5);
      ctx.lineTo(MARGIN.left + pw, Math.round(sy) + 0.5);
    }
    ctx.stroke();

    // Axes through the origin, when in view.
    ctx.strokeStyle = axis;
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    if (oy >= MARGIN.top && oy <= MARGIN.top + ph) {
      ctx.moveTo(MARGIN.left, Math.round(oy) + 0.5);
      ctx.lineTo(MARGIN.left + pw, Math.round(oy) + 0.5);
    }
    if (ox >= MARGIN.left && ox <= MARGIN.left + pw) {
      ctx.moveTo(Math.round(ox) + 0.5, MARGIN.top);
      ctx.lineTo(Math.round(ox) + 0.5, MARGIN.top + ph);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Curves: 2px lines, one sample per pixel.
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    // Each curve's points on screen, inside the plot: where its label may go, and what other labels avoid.
    const onScreen: { text: string; color: string; points: [number, number][] }[] = [];
    for (const curve of this.visible()) {
      ctx.strokeStyle = this.color(curve);
      const runs = sampleCurve(curve.at, this.view, Math.max(50, Math.round(pw)));
      ctx.beginPath();
      for (const run of runs) {
        run.forEach(([x, y], i) => {
          const [sx, sy] = this.toScreen(x, Math.max(yMin - 1e3 * (yMax - yMin), Math.min(yMax + 1e3 * (yMax - yMin), y)), w, h);
          if (i === 0) ctx.moveTo(sx, sy);
          else ctx.lineTo(sx, sy);
        });
      }
      ctx.stroke();
      const points: [number, number][] = [];
      for (const run of runs) for (const [x, y] of run) if (y >= yMin && y <= yMax) points.push(this.toScreen(x, y, w, h));
      onScreen.push({ text: curve.name, color: this.color(curve), points });
    }
    ctx.restore();

    // Axis numbers.
    ctx.fillStyle = text;
    ctx.font = "11px 'Segoe UI', system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (const x of ticks(xMin, xMax, xStep)) {
      const [sx] = this.toScreen(x, 0, w, h);
      ctx.fillText(formatTick(x, xStep), sx, MARGIN.top + ph + 6);
    }
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (const y of ticks(yMin, yMax, yStep)) {
      const [, sy] = this.toScreen(0, y, w, h);
      ctx.fillText(formatTick(y, yStep), MARGIN.left - 6, sy);
    }

    // Direct labels: the name in text colour with a colour swatch, set beside its curve where it
    // is furthest from the other curves and labels. Where there is no clear spot, the legend
    // below still names every curve.
    ctx.font = "italic 13px 'Cambria Math', 'Times New Roman', serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const placed: { left: number; right: number; top: number; bottom: number }[] = [];
    const inside = (b: { left: number; right: number; top: number; bottom: number }) =>
      b.left >= MARGIN.left + 2 && b.right <= MARGIN.left + pw - 2 && b.top >= MARGIN.top + 2 && b.bottom <= MARGIN.top + ph - 2;
    for (const [i, curve] of onScreen.entries()) {
      const boxWidth = ctx.measureText(curve.text).width + 22;
      const others = onScreen.filter((_, j) => j !== i).flatMap((c) => c.points.filter((_, k) => k % 3 === 0));
      let best: { box: { left: number; right: number; top: number; bottom: number }; score: number } | null = null;
      for (let k = 0; k < curve.points.length; k += 6) {
        const [cx, cy] = curve.points[k];
        for (const box of [
          { left: cx + 6, right: cx + 6 + boxWidth, top: cy - 22, bottom: cy - 6 },
          { left: cx + 6, right: cx + 6 + boxWidth, top: cy + 6, bottom: cy + 22 },
          { left: cx - 6 - boxWidth, right: cx - 6, top: cy - 22, bottom: cy - 6 },
        ]) {
          if (!inside(box)) continue;
          if (placed.some((p) => box.left < p.right && box.right > p.left && box.top < p.bottom && box.bottom > p.top)) continue;
          const mx = (box.left + box.right) / 2;
          const my = (box.top + box.bottom) / 2;
          let score = Infinity;
          for (const [ox, oy] of others) score = Math.min(score, Math.hypot(ox - mx, oy - my));
          for (const p of placed) score = Math.min(score, Math.hypot((p.left + p.right) / 2 - mx, (p.top + p.bottom) / 2 - my));
          // Clear space matters up to a point; past it, prefer the right-hand side of the plot.
          score = Math.min(score, 60) + (cx - MARGIN.left) / pw;
          if (!best || score > best.score) best = { box, score };
        }
      }
      if (!best || best.score < 12) continue;
      const { box } = best;
      placed.push(box);
      ctx.fillStyle = paper;
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.roundRect(box.left, box.top, box.right - box.left, box.bottom - box.top, 4);
      ctx.fill();
      ctx.globalAlpha = 1;
      const mid = (box.top + box.bottom) / 2;
      ctx.fillStyle = curve.color;
      ctx.fillRect(box.left + 4, mid - 1.5, 10, 3);
      ctx.fillStyle = text;
      ctx.fillText(curve.text, box.left + 18, mid + 1);
    }

    // Hover crosshair, with a ringed marker on each curve.
    if (this.hoverX !== null) {
      const [sx] = this.toScreen(this.hoverX, 0, w, h);
      ctx.strokeStyle = axis;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.round(sx) + 0.5, MARGIN.top);
      ctx.lineTo(Math.round(sx) + 0.5, MARGIN.top + ph);
      ctx.stroke();
      ctx.globalAlpha = 1;
      for (const curve of this.visible()) {
        const y = curve.at(this.hoverX);
        if (!Number.isFinite(y) || y < yMin || y > yMax) continue;
        const [, sy] = this.toScreen(this.hoverX, y, w, h);
        ctx.beginPath();
        ctx.arc(sx, sy, 4, 0, Math.PI * 2);
        ctx.fillStyle = this.color(curve);
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = paper;
        ctx.stroke();
      }
    }
  }

  private renderTooltip(w: number, h: number): void {
    if (this.hoverX === null || this.drag || !this.visible().length) {
      this.tooltip.hidden = true;
      return;
    }
    const x = this.hoverX;
    const step = niceStep(this.view.xMax - this.view.xMin, 200);
    const rows = [`<div class="graph-tip-x">x = ${formatTick(x, step)}</div>`];
    for (const curve of this.visible()) {
      const y = curve.at(x);
      const value = Number.isFinite(y) ? formatTick(Number(y.toPrecision(6)), step / 10) : "undefined";
      rows.push(
        `<div class="graph-tip-row"><span class="graph-swatch" style="background:${this.color(curve)}"></span>` +
          `<span class="graph-tip-name">${curve.name}</span><span>${value}</span></div>`,
      );
    }
    this.tooltip.innerHTML = rows.join("");
    this.tooltip.hidden = false;
    const [sx] = this.toScreen(x, 0, w, h);
    const tw = this.tooltip.offsetWidth;
    this.tooltip.style.left = `${sx + 12 + tw > w ? sx - tw - 12 : sx + 12}px`;
    this.tooltip.style.top = `${MARGIN.top + 4}px`;
  }

  // ---- interaction ----

  private bindPointer(): void {
    const el = this.canvas;
    el.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      el.setPointerCapture(e.pointerId);
      this.drag = { id: e.pointerId, x: e.offsetX, y: e.offsetY, view: { ...this.view } };
      el.classList.add("dragging");
    });
    el.addEventListener("pointermove", (e) => {
      if (this.drag && e.pointerId === this.drag.id) {
        const { w, h } = this.size();
        const start = this.drag.view;
        const dx = ((e.offsetX - this.drag.x) / (w - MARGIN.left - MARGIN.right)) * (start.xMax - start.xMin);
        const dy = ((e.offsetY - this.drag.y) / (h - MARGIN.top - MARGIN.bottom)) * (start.yMax - start.yMin);
        this.view = { xMin: start.xMin - dx, xMax: start.xMax - dx, yMin: start.yMin + dy, yMax: start.yMax + dy };
        this.moved = true;
      }
      this.hoverX = this.toPlane(e.offsetX, e.offsetY)[0];
      this.request();
    });
    const end = (e: PointerEvent) => {
      if (this.drag?.id === e.pointerId) {
        this.drag = null;
        el.classList.remove("dragging");
        this.request();
      }
    };
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
    el.addEventListener("pointerleave", () => {
      if (this.drag) return;
      this.hoverX = null;
      this.request();
    });
    el.addEventListener("dblclick", () => this.fit());
    el.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        // Zoom about the point under the cursor, so it stays put.
        const [px, py] = this.toPlane(e.offsetX, e.offsetY);
        const k = ZOOM_STEP ** e.deltaY;
        const { xMin, xMax, yMin, yMax } = this.view;
        this.view = { xMin: px - (px - xMin) * k, xMax: px + (xMax - px) * k, yMin: py - (py - yMin) * k, yMax: py + (yMax - py) * k };
        this.moved = true;
        this.request();
      },
      { passive: false },
    );
  }

  private renderLegend(dropped: number): void {
    const items = this.curves.map((curve) => {
      const li = document.createElement("li");
      const b = document.createElement("button");
      b.className = "graph-legend-item";
      b.setAttribute("aria-pressed", String(!this.hidden.has(curve.lineId)));
      b.title = this.hidden.has(curve.lineId) ? "Show this curve" : "Hide this curve";
      const swatch = document.createElement("span");
      swatch.className = "graph-swatch";
      swatch.style.background = this.color(curve);
      const formula = document.createElement("span");
      formula.className = "graph-formula";
      katex.render(stripMathDelimiters(curve.latex), formula, { throwOnError: false });
      b.append(swatch);
      // A numbered name (y₁, y₂) is not in the formula itself, so show it alongside.
      if (/[₀-₉]$/.test(curve.name)) {
        const name = document.createElement("span");
        name.className = "graph-name";
        name.textContent = `${curve.name}:`;
        b.append(name);
      }
      b.append(formula);
      b.addEventListener("click", () => {
        if (this.hidden.has(curve.lineId)) this.hidden.delete(curve.lineId);
        else this.hidden.add(curve.lineId);
        this.renderLegend(dropped);
        this.request();
      });
      li.append(b);
      return li;
    });
    if (dropped > 0) {
      const li = document.createElement("li");
      li.className = "graph-note";
      li.textContent = `Showing the first ${MAX_CURVES} curves; ${dropped} more not drawn.`;
      items.push(li);
    }
    this.legend.replaceChildren(...items);
  }

  private async copyImage(): Promise<void> {
    if (!this.curves.length) {
      this.events.onStatus("Nothing to copy: no curves on the page yet.");
      return;
    }
    try {
      const { w, h } = this.size();
      const scale = 2;
      const canvas = document.createElement("canvas");
      canvas.width = w * scale;
      canvas.height = h * scale;
      const hover = this.hoverX;
      this.hoverX = null;
      this.drawInto(canvas.getContext("2d")!, w, h, scale, this.cssVar("--paper"));
      this.hoverX = hover;
      const png = new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("image export failed"))), "image/png"),
      );
      await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
      this.events.onStatus("Copied the graph as an image.");
    } catch (error) {
      this.events.onStatus(`Could not copy: ${error instanceof Error ? error.message : String(error)}`, true);
    }
  }

  private button(label: string, title: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement("button");
    b.className = "tool";
    b.textContent = label;
    b.title = title;
    b.addEventListener("click", onClick);
    return b;
  }

  private math(latex: string): HTMLElement {
    const span = document.createElement("span");
    katex.render(latex, span, { throwOnError: false });
    return span;
  }
}
