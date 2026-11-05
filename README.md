# inkd

A Windows desktop handwriting maths app for a pen tablet. Write a sum, pause, and the answer appears beside it. Everything runs locally: no accounts, no paid APIs, works offline.

See [PLAN.md](PLAN.md) for the roadmap and [step-zero/RESULTS.md](step-zero/RESULTS.md) for model measurements.

## Status

Milestones 0–3 of the plan: pressure ink, pen eraser end, stroke eraser, undo/redo, live solving of lines ending in `=`, and variables and functions shared down the page (`x = 5`, then `2x =`; `f(x) = x^2 + 1`, then `f(2) =`).

## Setup

Needs Node, Rust (MSVC toolchain), the Visual Studio C++ build tools, and WebView2 (included with Windows 11).

```bash
npm install
```

```bash
bash scripts/fetch-model.sh
```

```bash
npm run tauri dev
```

The model is about 1.25 GB and is not stored in git. In a dev build it loads from `src-tauri/models/texteller`; `INKD_MODEL_DIR` overrides that.

## Using it

Write with the pen, for example `3/4 + 1/2 =`, then lift it for 600 ms. The status bar shows what was read, how confident the model was, and how long it took.

| Input | Action |
|---|---|
| Pen tip | Ink |
| Pen eraser end, or Eraser tool (`E`) | Erase whole strokes |
| Ctrl+Z, Ctrl+Y | Undo, redo |
| Mouse wheel | Scroll the page |
| Ctrl+Shift+B | Record the handwritten baseline (below) |

Pressure needs **Windows Ink turned on** in the XP-Pen driver settings. Without it the pen arrives as a mouse, and ink falls back to simulated pressure.

## Tests

```bash
npm test
```

```bash
cargo test --lib --manifest-path src-tauri/Cargo.toml
```

```bash
bash scripts/selftest.sh
```

The self-test opens the real app, feeds generated strokes through the whole pipeline, and writes its report and line images to `step-zero/proxy/`.

## GPU

Recognition runs the encoder on the GPU through DirectML and the decoder on the CPU, and falls back to the CPU entirely if the GPU fails. The toolbar shows which is in use. **Force CPU** in the toolbar turns the GPU off and is remembered in `%LOCALAPPDATA%\app.inkd.desktop\settings.json`. See [step-zero/RESULTS.md](step-zero/RESULTS.md) for the comparison.

## Workflow

Each milestone gets a feature branch and a pull request. Nothing is pushed directly to `main`.

## Licences

Tauri (MIT/Apache-2.0), ONNX Runtime and `ort` (MIT/Apache-2.0), tokenizers (Apache-2.0), perfect-freehand (MIT), mathjs (Apache-2.0) and KaTeX (MIT) are permissive. TexTeller code and weights are Apache-2.0.

**One exception: `DirectML.dll`.** It is a closed-source Microsoft binary under the Microsoft Software License Terms, not a permissive licence. It is free to use, but it bans reverse engineering, and its redistribution terms need checking before shipping an installer. CPU-only mode doesn't use it for inference, but the app still builds with it.
