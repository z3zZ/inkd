import { cancelModelDownload, type DownloadProgress, downloadModel, type EngineStatus } from "./engine";

const GB = 1024 ** 3;
const MB = 1024 ** 2;

export function formatBytes(bytes: number): string {
  return bytes >= GB ? `${(bytes / GB).toFixed(2)} GB` : `${Math.round(bytes / MB)} MB`;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "";
  if (seconds < 60) return "under a minute";
  const minutes = Math.round(seconds / 60);
  return minutes === 1 ? "about 1 minute" : `about ${minutes} minutes`;
}

/** Download speed, smoothed over the last few seconds so the estimate does not jump around. */
class Rate {
  private samples: { t: number; bytes: number }[] = [];

  add(bytes: number): void {
    const t = performance.now();
    this.samples.push({ t, bytes });
    while (this.samples.length > 2 && t - this.samples[0].t > 5000) this.samples.shift();
  }

  /** Bytes per second, or null until there is enough to go on. */
  get perSecond(): number | null {
    if (this.samples.length < 2) return null;
    const first = this.samples[0];
    const last = this.samples[this.samples.length - 1];
    const seconds = (last.t - first.t) / 1000;
    return seconds < 1 ? null : (last.bytes - first.bytes) / seconds;
  }
}

export interface ModelSetupEvents {
  onReady: (status: EngineStatus) => void;
}

/** The first-run screen: explains the model download, runs it, and shows progress. */
export class ModelSetup {
  private readonly root: HTMLElement;
  private running = false;
  private size = 0;

  constructor(
    parent: HTMLElement,
    private readonly events: ModelSetupEvents,
  ) {
    this.root = document.createElement("div");
    this.root.className = "setup-backdrop";
    this.root.hidden = true;
    parent.append(this.root);
  }

  show(status: EngineStatus): void {
    if (this.running) {
      this.root.hidden = false;
      return;
    }
    this.size = status.downloadSize;
    this.renderIntro();
    this.root.hidden = false;
  }

  private hide(): void {
    this.root.hidden = true;
  }

  private card(...children: Node[]): void {
    const card = document.createElement("div");
    card.className = "setup";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "true");
    card.setAttribute("aria-labelledby", "setup-title");
    card.append(...children);
    this.root.replaceChildren(card);
  }

  private el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag);
    e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  private button(label: string, primary: boolean, onClick: () => void): HTMLButtonElement {
    const b = this.el("button", primary ? "tool primary" : "tool", label);
    b.addEventListener("click", onClick);
    return b;
  }

  private renderIntro(error?: string): void {
    const size = this.size;
    const title = this.el("h2", "setup-title", error ? "The download did not finish" : "One-time setup");
    title.id = "setup-title";
    const body = this.el(
      "p",
      "setup-text",
      `inkd reads your handwriting with TexTeller, an open model that runs entirely on this computer. ` +
        `It needs a one-time ${formatBytes(size)} download from Hugging Face. After that, inkd works offline ` +
        `and nothing you write ever leaves your computer.`,
    );
    const children: Node[] = [title];
    if (error) children.push(this.el("p", "setup-error", error));
    children.push(body);
    if (error) children.push(this.el("p", "setup-hint", "Anything already downloaded is kept, so trying again picks up where it stopped."));
    const actions = this.el("div", "setup-actions");
    const later = this.button("Not now", false, () => this.hide());
    later.title = "You can still write. Lines are read once the model is downloaded.";
    actions.append(later, this.button(error ? "Try again" : `Download ${formatBytes(size)}`, true, () => void this.run()));
    children.push(actions);
    this.card(...children);
    actions.querySelector<HTMLButtonElement>(".primary")!.focus();
  }

  private async run(): Promise<void> {
    this.running = true;
    const title = this.el("h2", "setup-title", "Downloading the handwriting model");
    title.id = "setup-title";
    const bar = this.el("div", "setup-bar");
    const fill = this.el("div", "setup-bar-fill");
    bar.append(fill);
    bar.setAttribute("role", "progressbar");
    bar.setAttribute("aria-valuemin", "0");
    bar.setAttribute("aria-valuemax", "100");
    const detail = this.el("p", "setup-detail", "Connecting…");
    const hint = this.el("p", "setup-hint", "You can keep writing while this runs. Lines are read once it finishes.");
    const actions = this.el("div", "setup-actions");
    const cancel = this.button("Cancel", false, () => {
      cancel.disabled = true;
      void cancelModelDownload();
    });
    const background = this.button("Hide", false, () => this.hide());
    actions.append(cancel, background);
    this.card(title, bar, detail, hint, actions);

    const rate = new Rate();
    const onProgress = (p: DownloadProgress) => {
      const percent = p.total ? (p.done / p.total) * 100 : 0;
      fill.style.width = `${percent}%`;
      bar.setAttribute("aria-valuenow", String(Math.round(percent)));
      if (p.stage === "checking") {
        detail.textContent = `Checking the download… ${formatBytes(p.done)} of ${formatBytes(p.total)}`;
        return;
      }
      rate.add(p.done);
      const speed = rate.perSecond;
      const left = speed ? formatDuration((p.total - p.done) / speed) : "";
      detail.textContent =
        `${formatBytes(p.done)} of ${formatBytes(p.total)}` +
        (speed ? ` · ${formatBytes(speed)}/s` : "") +
        (left ? ` · ${left} left` : "");
    };

    try {
      const status = await downloadModel(onProgress);
      this.running = false;
      this.hide();
      this.events.onReady(status);
    } catch (error) {
      this.running = false;
      const message = error instanceof Error ? error.message : String(error);
      if (message === "cancelled") {
        this.renderIntro();
        this.hide();
      } else {
        this.renderIntro(message);
        this.root.hidden = false;
      }
    }
  }
}
