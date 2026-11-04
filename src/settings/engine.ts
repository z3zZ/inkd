import { invoke } from "@tauri-apps/api/core";

export interface EngineStatus {
  backend: "directml" | "cpu" | null;
  forceCpu: boolean;
  gpuError: string | null;
  loadError: string | null;
}

export function getEngineStatus(): Promise<EngineStatus> {
  return invoke<EngineStatus>("engine_status");
}

export function setForceCpu(forceCpu: boolean): Promise<EngineStatus> {
  return invoke<EngineStatus>("set_force_cpu", { forceCpu });
}

/** Wires the toolbar's backend label and Force CPU checkbox. */
export function bindEngineControls(root: HTMLElement): void {
  const label = root.querySelector<HTMLElement>("#engine-backend")!;
  const checkbox = root.querySelector<HTMLInputElement>("#force-cpu")!;

  const show = (status: EngineStatus) => {
    checkbox.checked = status.forceCpu;
    checkbox.disabled = false;
    const failed = status.backend === "cpu" && status.gpuError !== null;
    label.textContent = status.backend === "directml" ? "GPU" : failed ? "CPU (GPU failed)" : status.backend === "cpu" ? "CPU" : "No model";
    label.className = failed || status.loadError ? "warn" : "";
    label.title = status.gpuError ?? status.loadError ?? "";
  };

  root.hidden = false;
  label.textContent = "Loading…";
  checkbox.disabled = true;
  checkbox.addEventListener("change", () => {
    checkbox.disabled = true;
    label.textContent = "Loading…";
    void setForceCpu(checkbox.checked).then(show);
  });
  void getEngineStatus().then(show);
}
