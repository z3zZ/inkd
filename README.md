# inkd

A Windows desktop handwriting maths app for a pen tablet. Write a sum, pause, and the answer appears beside it. Everything runs locally: no accounts, no paid APIs, works offline.

See [PLAN.md](PLAN.md) for the roadmap and [step-zero/RESULTS.md](step-zero/RESULTS.md) for model measurements.

## Status

Working towards an MVP. Done so far:

- Pressure ink, pen eraser end, stroke eraser, undo/redo.
- Live solving of lines ending in `=`.
- Variables and functions shared down the page (`x = 5`, then `2x =`; `f(x) = x^2 + 1`, then `f(2) =`).
- Notes that save themselves, with a notes list, plus copy as LaTeX or as an image.
- Correcting misread lines. Each correction is kept as training data.
- A Windows installer, with the model downloaded on first run. Only one copy runs at a time.
- Scratch-to-erase, answers as fractions or mixed numbers, dark mode, and grid, lined or dot paper.

## Install

Build the installer with `bash scripts/fetch-redist.sh` (fetches Microsoft's `DirectML.dll`, checked against a pinned hash) and then `npm run tauri build`. Run `inkd_<version>_x64-setup.exe` from `src-tauri/target/release/bundle/nsis/`. It installs for the current user, with no admin rights needed.

On first launch inkd offers to download the handwriting model (1.17 GB) from Hugging Face. The download resumes if it is interrupted, and each file is checked against a pinned SHA-256 hash. The model goes to `%LOCALAPPDATA%\app.inkd.desktop\models\texteller`. After that, inkd works offline.

## Development setup

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

The model is about 1.25 GB and is not stored in git. A dev build loads it from `src-tauri/models/texteller` or, failing that, from the first-run download folder. `INKD_MODEL_DIR` overrides both.

## Using it

Write with the pen, for example `3/4 + 1/2 =`, then lift it for 600 ms. The status bar shows what was read, how confident the model was, and how long it took.

| Input | Action |
|---|---|
| Pen tip | Ink |
| Pen eraser end, or Eraser tool (`E`) | Erase whole strokes |
| Scribble back and forth over ink | Scratch it out (undoable) |
| View | Theme (system, light, dark), page (plain, grid, lined, dots), answers (decimal, fraction, mixed) |
| Ctrl+Z, Ctrl+Y | Undo, redo |
| Right-click, or the pen's barrel button, on a line | Correct what it was read as |
| Ctrl+O | Notes list |
| Ctrl+N | New note |
| Ctrl+Shift+C | Copy the note as LaTeX |
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

## Notes and corrections

Notes save themselves a moment after each change, as JSON files in `%APPDATA%\app.inkd.desktop\notes`. Deleting a note moves it to `notes\trash`.

Each correction saves the line image the model saw, plus what it read and what it should have read, in `%APPDATA%\app.inkd.desktop\corrections`. This is the dataset for fine-tuning the model on your handwriting (milestone 8).

## Workflow

Finished milestones are fast-forwarded straight onto `main`.

## Licences

Tauri (MIT/Apache-2.0), ONNX Runtime and `ort` (MIT/Apache-2.0), tokenizers (Apache-2.0), ureq and rustls (MIT/Apache-2.0/ISC), perfect-freehand (MIT), mathjs (Apache-2.0) and KaTeX (MIT) are permissive. TexTeller code and weights are Apache-2.0.

**One exception: `DirectML.dll`.** It is a closed-source Microsoft binary under the Microsoft Software License Terms, not a permissive licence. Section 1(a) of those terms allows it to be distributed inside applications for Windows, so the installer ships it unmodified. It is byte-for-byte the file in Microsoft's `Microsoft.AI.DirectML` 1.15.4 NuGet package. The terms ban reverse engineering it and require keeping its notices.

The installer puts every licence and notice in a `licenses` folder next to `inkd.exe`; see [src-tauri/licenses/README.txt](src-tauri/licenses/README.txt).
