import { Channel, invoke } from "@tauri-apps/api/core";

export interface EngineStatus {
  backend: "directml" | "cpu" | null;
  forceCpu: boolean;
  gpuError: string | null;
  loadError: string | null;
  /** The model has not been downloaded yet. */
  modelMissing: boolean;
  /** Bytes the first-run download fetches in all. */
  downloadSize: number;
}

export interface DownloadProgress {
  done: number;
  total: number;
  stage: "downloading" | "checking";
}

export function getEngineStatus(): Promise<EngineStatus> {
  return invoke<EngineStatus>("engine_status");
}

export function setForceCpu(forceCpu: boolean): Promise<EngineStatus> {
  return invoke<EngineStatus>("set_force_cpu", { forceCpu });
}

/** Downloads the model (resuming any earlier attempt), then loads it. Rejects with "cancelled" if stopped. */
export function downloadModel(onProgress: (p: DownloadProgress) => void): Promise<EngineStatus> {
  const channel = new Channel<DownloadProgress>();
  channel.onmessage = onProgress;
  return invoke<EngineStatus>("model_download", { onProgress: channel });
}

export function cancelModelDownload(): Promise<void> {
  return invoke("model_download_cancel");
}

export interface EngineControls {
  /** Shows a status that arrived some other way, such as after a download. */
  show(status: EngineStatus): void;
}

/**
 * Wires the backend label and Force CPU checkbox in the View menu, and the toolbar button that
 * appears only when the model needs attention: not downloaded yet, or failed to load.
 */
export function bindEngineControls(
  root: HTMLElement,
  alert: HTMLButtonElement,
  /** fromClick: the user clicked "Download model", rather than a status arriving. */
  events: { onMissing?: (status: EngineStatus, fromClick: boolean) => void } = {},
): EngineControls {
  const label = root.querySelector<HTMLElement>("#engine-backend")!;
  const checkbox = root.querySelector<HTMLInputElement>("#force-cpu")!;
  const forceLabel = checkbox.closest("label")!;
  let missing: EngineStatus | null = null;

  const show = (status: EngineStatus) => {
    missing = status.modelMissing ? status : null;
    checkbox.checked = status.forceCpu;
    checkbox.disabled = false;
    forceLabel.hidden = status.modelMissing;
    const failed = status.backend === "cpu" && status.gpuError !== null;
    label.textContent = status.modelMissing
      ? "Download model"
      : status.backend === "directml"
        ? "GPU"
        : failed
          ? "CPU (GPU failed)"
          : status.backend === "cpu"
            ? "CPU"
            : "No model";
    label.className = status.modelMissing ? "link" : failed || status.loadError ? "warn" : "";
    label.title = status.modelMissing ? "Download the handwriting model" : (status.gpuError ?? status.loadError ?? "");
    const broken = !status.modelMissing && status.loadError !== null;
    alert.hidden = !status.modelMissing && !broken;
    alert.textContent = status.modelMissing ? "Download model" : "Model problem";
    alert.title = status.modelMissing
      ? "Lines are read once the handwriting model is downloaded"
      : `${status.loadError ?? ""} Details are in inkd.log, next to the model.`;
    if (status.modelMissing) events.onMissing?.(status, false);
  };

  root.hidden = false;
  label.textContent = "Loading model…";
  checkbox.disabled = true;
  for (const el of [label, alert]) {
    el.addEventListener("click", () => {
      if (missing) events.onMissing?.(missing, true);
    });
  }
  checkbox.addEventListener("change", () => {
    checkbox.disabled = true;
    label.textContent = "Loading model…";
    void setForceCpu(checkbox.checked).then(show);
  });
  void getEngineStatus().then(show);
  return { show };
}
