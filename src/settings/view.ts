import type { PageBackground } from "../canvas/InkCanvas";
import type { AnswerFormat } from "../math/answerFormat";
import type { AngleUnit } from "../math/latexToMath";

export type Theme = "system" | "light" | "dark";

export interface ViewSettings {
  theme: Theme;
  background: PageBackground;
  answers: AnswerFormat;
  angles: AngleUnit;
}

const DEFAULTS: ViewSettings = { theme: "system", background: "plain", answers: "decimal", angles: "rad" };
const KEY = "inkd.view";

const CHOICES: { [K in keyof ViewSettings]: { label: string; options: [ViewSettings[K], string][] } } = {
  theme: {
    label: "Theme",
    options: [
      ["system", "System"],
      ["light", "Light"],
      ["dark", "Dark"],
    ],
  },
  background: {
    label: "Page",
    options: [
      ["plain", "Plain"],
      ["grid", "Grid"],
      ["lined", "Lined"],
      ["dots", "Dots"],
    ],
  },
  answers: {
    label: "Answers",
    options: [
      ["decimal", "1.25"],
      ["fraction", "5/4"],
      ["mixed", "1 ¼"],
    ],
  },
  angles: {
    label: "Angles (sin, cos, tan)",
    options: [
      ["rad", "Radians"],
      ["deg", "Degrees"],
    ],
  },
};

/** Reads saved view settings, falling back to defaults for anything missing or unknown. */
export function loadView(): ViewSettings {
  let saved: Partial<ViewSettings> = {};
  try {
    saved = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<ViewSettings>;
  } catch {
    // Storage unavailable or damaged: use the defaults.
  }
  const pick = <K extends keyof ViewSettings>(key: K): ViewSettings[K] => {
    const value = saved[key];
    return CHOICES[key].options.some(([v]) => v === value) ? (value as ViewSettings[K]) : DEFAULTS[key];
  };
  return { theme: pick("theme"), background: pick("background"), answers: pick("answers"), angles: pick("angles") };
}

function saveView(view: ViewSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(view));
  } catch {
    // Not remembered this time; the choice still applies now.
  }
}

/** Applies a theme to the page. "system" follows Windows' light or dark setting. */
export function applyTheme(theme: Theme): void {
  if (theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}

/** The View popover: theme, page background, answer format and angle unit, saved between launches. */
export class ViewMenu {
  private readonly root: HTMLElement;
  private view: ViewSettings;

  constructor(
    private readonly button: HTMLButtonElement,
    private readonly onChange: (view: ViewSettings) => void,
  ) {
    this.view = loadView();
    this.root = document.createElement("div");
    this.root.className = "view-menu";
    this.root.hidden = true;
    this.root.setAttribute("role", "dialog");
    this.root.setAttribute("aria-label", "View");
    document.body.append(this.root);
    this.render();

    button.addEventListener("click", () => (this.root.hidden ? this.open() : this.close()));
    document.addEventListener(
      "pointerdown",
      (e) => {
        const target = e.target as Node;
        if (!this.root.hidden && !this.root.contains(target) && !button.contains(target)) this.close();
      },
      true,
    );
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !this.root.hidden) this.close();
    });
  }

  get current(): ViewSettings {
    return this.view;
  }

  open(): void {
    const box = this.button.getBoundingClientRect();
    this.root.style.top = `${box.bottom + 6}px`;
    this.root.style.left = `${Math.max(8, Math.min(box.left, window.innerWidth - 290))}px`;
    this.root.hidden = false;
    this.button.setAttribute("aria-expanded", "true");
  }

  close(): void {
    this.root.hidden = true;
    this.button.setAttribute("aria-expanded", "false");
  }

  private set<K extends keyof ViewSettings>(key: K, value: ViewSettings[K]): void {
    this.view = { ...this.view, [key]: value };
    saveView(this.view);
    this.render();
    this.onChange(this.view);
  }

  private render(): void {
    const groups = (Object.keys(CHOICES) as (keyof ViewSettings)[]).map((key) => {
      const group = document.createElement("div");
      group.className = "view-group";
      const label = document.createElement("span");
      label.className = "view-label";
      label.textContent = CHOICES[key].label;
      label.id = `view-${key}`;
      const options = document.createElement("div");
      options.className = "segmented";
      options.setAttribute("role", "radiogroup");
      options.setAttribute("aria-labelledby", label.id);
      for (const [value, text] of CHOICES[key].options) {
        const b = document.createElement("button");
        b.textContent = text;
        b.setAttribute("role", "radio");
        b.setAttribute("aria-checked", String(this.view[key] === value));
        b.addEventListener("click", () => this.set(key, value as ViewSettings[typeof key]));
        options.append(b);
      }
      group.append(label, options);
      return group;
    });
    this.root.replaceChildren(...groups);
  }
}
