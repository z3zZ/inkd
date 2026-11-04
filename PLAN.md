# inkd — Build Plan

A Windows desktop handwriting maths app, modelled on the *behaviour* of MyScript Math: Solve & Plot, built for an XP-Pen tablet.

**Rules**
- Fully free and local: no paid APIs, no accounts, works offline.
- All original code, UI and assets. Do not decompile, copy, or reuse MyScript's name, branding or assets.
- Every dependency and model weight must have a permissive licence (MIT / Apache-2.0 / BSD), so the app is fully owned.

---

## 1. Stack

| Layer | Choice | Why |
|---|---|---|
| Shell | **Tauri 2** (Rust backend) + **TypeScript** frontend (Vite, no heavy framework needed; Svelte or React if preferred) | Small native Windows app, web canvas for ink |
| Pen input | **Pointer Events** (`pressure`, `tiltX/Y`, `pointerType === "pen"`, eraser via `buttons`) + `getCoalescedEvents()` for smooth strokes | XP-Pen works through Windows Ink, no driver code |
| Ink rendering | Canvas 2D, strokes smoothed with **perfect-freehand** (MIT) | Pressure-sensitive, good-looking ink |
| Recognition | **TexTeller** (Apache-2.0, ViT encoder-decoder, ~298M params, handwritten support, ONNX-exportable) run via **ONNX Runtime** in the Rust backend (`ort` crate) | Free, local, best open accuracy |
| Solving | **mathjs** (Apache-2.0) + a LaTeX→mathjs converter | Fractions, variables, units, number formats |
| Graphing | **function-plot** (MIT) | Multiple functions per graph, pan/zoom |
| Maths rendering | **KaTeX** (MIT) | Show recognised LaTeX and results |
| Storage | JSON note files in app data dir (via Tauri fs) | Simple, local, portable |
| Export | LaTeX (string), PNG (canvas), PDF (**jsPDF**, MIT) | |
| Optional AI steps | **Ollama** on localhost, off by default | Free, local step-by-step explanations |

---

## 2. Step zero — verify before building

1. Confirm TexTeller licence on **both** the GitHub repo and the Hugging Face weights (expected Apache-2.0).
2. Export TexTeller to ONNX (or use a provided ONNX build) and run it from a tiny Rust test on Windows, CPU only.
3. Measure latency per line. Target < 1.5 s on CPU. If too slow, try int8 quantisation (`onnxruntime` dynamic quantisation).
4. Hand-write 20 test lines (digits, fractions, powers, roots, trig, `x =` assignments), render to images, and record accuracy. This is the baseline.
5. Backup candidate: a CROHME-trained model (CoMER / BTTR). **Check the licence of code and weights first** — only use if permissive and it beats TexTeller on the test set.

Do not continue past step zero until a model runs locally with acceptable accuracy.

---

## 3. Architecture

```
src/                      # TypeScript frontend
  canvas/
    InkCanvas.ts          # pointer capture, stroke model, rendering
    strokes.ts            # Stroke type, smoothing (perfect-freehand)
    gestures.ts           # scratch-out detection
  lines/
    LineSegmenter.ts      # groups strokes into lines (by y-bands + time gaps)
    LineController.ts     # idle timer → recognise → solve → render result
  recognition/
    Recognizer.ts         # interface: recognise(image) -> { latex, confidence }
    TauriOnnxRecognizer.ts# calls Rust command
  math/
    latexToMath.ts        # LaTeX -> mathjs expression
    engine.ts             # evaluate, variable scope, number formats
  graph/
    GraphBlock.ts         # function-plot wrapper
  notes/
    store.ts              # load/save notes
  settings/
    schema.ts             # all customisable options + defaults
    SettingsPanel.ts
  export/
  corrections/
    CorrectionLog.ts      # saves (strokes, image, corrected latex) pairs
src-tauri/                # Rust backend
  src/recognizer.rs       # ONNX Runtime session, preprocessing, decoding
  src/main.rs
  models/                 # onnx model + tokenizer
training/                 # Python scripts for fine-tuning on my handwriting
```

**Key rule:** recognition sits behind the `Recognizer` interface, so models can be swapped without touching the UI.

---

## 4. How it works (core loop)

1. Pen strokes go into the stroke model and are drawn live.
2. `LineSegmenter` assigns each stroke to a line (vertical band + proximity).
3. When the pen is idle on a line for ~600 ms (configurable), that line's strokes are rasterised to a clean image (black on white, normalised height, padding).
4. Rust backend runs TexTeller → LaTeX.
5. LaTeX → mathjs. Handle:
   - `x = 5` → assign variable (scope shared down the note)
   - `3/4 + 1/2 =` → evaluate, show result after the `=`
   - `y = x^2 + 1` or `f(x) = …` → offer "plot"
6. Result rendered in a lighter ink colour beside the line. Editing strokes re-triggers the line and anything below that depends on its variables.

---

## 5. Features (parity list)

- [ ] Infinite/scrolling canvas, smooth pressure ink
- [ ] Pen eraser end + stroke eraser tool
- [ ] Scratch-to-erase (zigzag over ink deletes covered strokes)
- [ ] Live per-line recognition and results
- [ ] Variables across lines
- [ ] Answer format toggle: decimal / fraction / mixed (per line and global default)
- [ ] Undo / redo
- [ ] Function plotting, multiple functions per graph
- [ ] Multiple notes with a notes overview
- [ ] Export: LaTeX, PNG, PDF
- [ ] Lasso select + move
- [ ] Optional step-by-step via Ollama

## 6. Customisation (the bit MyScript doesn't do)

- Themes: background (plain, grid, dot, lined), ink colours, result colour, dark mode
- Pen presets: width, pressure curve, smoothing amount
- Recognition timing: idle delay, auto vs manual solve
- Pen button mapping: eraser, undo, lasso, toggle answer format
- Number settings: decimal places, angle units (deg/rad), default answer format
- Layout: toolbar position, compact mode, fullscreen
- All settings saved as JSON; importable/exportable

## 7. Personal accuracy loop (the edge)

1. Every line has a "correct this" action: fix the LaTeX by typing.
2. `CorrectionLog` saves the line image + corrected LaTeX to a local dataset folder.
3. `training/finetune.py` fine-tunes TexTeller on that dataset (can run on Google Colab free GPU if no local GPU), then re-exports to ONNX.
4. Swap the new model in via settings. Track accuracy on the step-zero test set before/after.

---

## 8. Milestones

| # | Milestone | Done when |
|---|---|---|
| 0 | Step zero | TexTeller runs from Rust on Windows; baseline accuracy + latency recorded |
| 1 | Ink | Tauri app, canvas, pressure ink, eraser end, undo/redo |
| 2 | One solved line | Write `3/4 + 1/2 =`, pause, see result |
| 3 | Lines + variables | Multi-line notes, `x = 5` then `2x =` works |
| 4 | Gestures | Scratch-to-erase, lasso |
| 5 | Graphing | `y = x^2` → plot, multiple functions |
| 6 | Notes + export | Save/load multiple notes, LaTeX/PNG/PDF |
| 7 | Customisation | Settings panel + all options in §6 |
| 8 | Accuracy loop | Correction logging + fine-tune script |
| 9 | Extras | Ollama step-by-step, polish |

**Start with milestones 0–2.** Commit after each milestone.

---

## 9. Risks

- **Accuracy on messy handwriting** — mitigated by per-line recognition, clean rasterisation, and the fine-tune loop.
- **CPU latency** (~298M param model) — mitigate with int8 quantisation, recognising only changed lines, and running inference off the UI thread.
- **LaTeX→mathjs conversion edge cases** — build a test suite of LaTeX strings early.
- **Licences** — re-check any new model or dataset before using its weights.
