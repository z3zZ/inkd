<p align="center"><b>inkd</b></p>
<p align="center"><i>your answers, inked.</i><br>
A free handwriting maths app for pen tablets on Windows. Write a sum, lift the pen, and the answer appears beside it. Everything runs on your computer: no account, no paid APIs, and it works offline.</p>

## Download

**[Get the latest release →](https://github.com/z3zZ/inkd/releases/latest)**

1. Download `inkd_<version>_x64-setup.exe` and run it. It installs for the current user, with no admin rights needed.
2. Windows may show a SmartScreen warning because the installer isn't code-signed: click *More info → Run anyway*. Each release lists a SHA-256 checksum if you want to check the file first (see [SECURITY.md](SECURITY.md)).
3. On first launch inkd offers to download the handwriting model (1.17 GB) from Hugging Face. The download resumes if it is interrupted, and each file is checked against a pinned SHA-256 hash. After that, inkd works offline.

Windows 10 or 11, x64. Built and tested with an XP-Pen tablet.

## What it does

- **Live solving.** Write a line ending in `=`, pause, and the answer appears beside it.
- **Variables and functions** carry down the page: `x = 5`, then `2x =`; `f(x) = x^2 + 1`, then `f(2) =`.
- **Graphing.** Every `y = …` and `f(x) = …` on the page in one graph, each in its own colour and marked beside its line.
- **Ink that feels like a pen.** Pressure, the pen's eraser end, scratch-out by scribbling over ink, undo and redo.
- **Notes that save themselves,** with a notes list, plus copy as LaTeX or as an image.
- **Answers your way:** decimals, fractions or mixed numbers; radians or degrees.
- **Honest about doubt.** A small `?` appears beside a line that could not be read, has no answer, or was read with low confidence. Hover to see what was read; click to fix it.
- **Corrections.** Right-click a line to correct what it was read as.
- Light and dark themes, and plain, grid, lined or dot paper.

What it does not do yet: integrals, sums, matrices, inequalities, or solving an equation for an unknown. Very long lines read less reliably than short ones.

## Using it

Write with the pen, for example `3/4 + 1/2 =`, then lift it for 600 ms. The status bar shows what was read, how confident the model was, and how long it took.

| Input | Action |
|---|---|
| Pen tip | Ink |
| Pen eraser end, or Eraser tool (`E`); `P` for the pen | Erase whole strokes |
| Scribble back and forth over ink | Scratch it out (undoable) |
| Right-click, or the pen's barrel button, on a line | Correct what it was read as |
| Click the `?` beside a line | Try reading it again, or correct the reading |
| Ctrl+Z; Ctrl+Y or Ctrl+Shift+Z | Undo; redo |
| Clear | Clear the page (undoable) |
| Ctrl+G, or Graph | Graph the curves on the page: drag to pan, scroll to zoom, double-click to fit, hover to read values |
| Ctrl+O; Ctrl+N | Notes list; new note |
| Ctrl+Shift+C; Copy image | Copy the note as LaTeX; as an image |
| Mouse wheel, PgUp/PgDn, Home, arrow keys, the scrollbar, or a finger on a touchscreen | Scroll the page |
| View | Theme, page, answer format, angle unit, and the settings below |
| Esc | Close the open panel or editor |

Pressure needs **Windows Ink turned on** in the tablet driver settings. Without it the pen arrives as a mouse, and ink falls back to simulated pressure.

A finger scrolls the page but never draws, and is ignored while the pen is in use, so a resting palm does nothing.

## Updates

When a newer release is on GitHub, a link appears in the toolbar. Clicking it opens the download page in your browser. inkd never downloads or installs anything by itself.

The check is one request to GitHub at start-up and sends nothing about you or your notes. To turn it off, set the environment variable `INKD_NO_UPDATE_CHECK`, or add `"noUpdateCheck": true` to `%LOCALAPPDATA%\app.inkd.desktop\settings.json`.

## Your data

Everything stays on your computer. There is no telemetry and no crash reporting.

| What | Where |
|---|---|
| Notes, one JSON file each | `%APPDATA%\app.inkd.desktop\notes` |
| Deleted notes | `%APPDATA%\app.inkd.desktop\notes\trash` (delete the files to remove them for good) |
| Corrections | `%APPDATA%\app.inkd.desktop\corrections` |
| The handwriting model | `%LOCALAPPDATA%\app.inkd.desktop\models\texteller` |
| Settings and `inkd.log` | `%LOCALAPPDATA%\app.inkd.desktop` |

**Notes folder** in the View menu opens the first three in File Explorer.

Each correction saves the line image the model saw, plus what it read and what it should have read. This is the dataset for fine-tuning the model on your handwriting later. Untick **Keep my corrections for training** in the View menu to stop keeping them.

`inkd.log` records problems such as the model failing to load. It never contains what you wrote.

## GPU

Recognition runs the encoder on the GPU through DirectML and the decoder on the CPU, and falls back to the CPU entirely if the GPU fails. The View menu shows which is in use. **Force CPU** there turns the GPU off and is remembered. See [step-zero/RESULTS.md](step-zero/RESULTS.md) for measurements.

## Development

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

The model is not stored in git. A dev build loads it from `src-tauri/models/texteller` or, failing that, from the first-run download folder. `INKD_MODEL_DIR` overrides both.

In a dev build, Ctrl+Shift+B records the handwritten baseline described in [step-zero/RESULTS.md](step-zero/RESULTS.md).

### Tests

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

### Building the installer

```bash
bash scripts/fetch-redist.sh
```

```bash
node scripts/notices.mjs
```

```bash
npm run tauri build
```

The first fetches Microsoft's `DirectML.dll`, checked against a pinned hash. The second rewrites the third-party notices; run it after changing dependencies. The installer lands in `src-tauri/target/release/bundle/nsis/`.

### Releasing

1. Set the same version in `package.json`, `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json`, and move the Unreleased notes in [CHANGELOG.md](CHANGELOG.md) under it.
2. Publish a GitHub release tagged `v<version>`. The workflow builds the installer, checks the tag against the version, and attaches the installer with its checksum.
3. Do not mark it as a pre-release: the update notice and the download link above both follow the latest full release.

Finished milestones are fast-forwarded straight onto `main`. See [PLAN.md](PLAN.md) for the roadmap.

## Licences

inkd is under the [MIT licence](LICENSE).

It is built on Tauri, ONNX Runtime and `ort`, tokenizers, ureq and rustls, perfect-freehand, mathjs and KaTeX, among others. Almost all of it is under permissive licences (MIT, Apache-2.0, BSD, ISC); a few Rust crates are under the Mozilla Public License 2.0 and are used unmodified. The TexTeller code and weights are Apache-2.0.

**One exception: `DirectML.dll`.** It is a closed-source Microsoft binary under the Microsoft Software License Terms, not an open-source licence. Section 1(a) of those terms allows it to be distributed inside applications for Windows, so the installer ships it unmodified. It is byte-for-byte the file in Microsoft's `Microsoft.AI.DirectML` 1.15.4 NuGet package. The terms ban reverse engineering it and require keeping its notices.

The installer puts every licence and notice in a `licenses` folder next to `inkd.exe`; see [src-tauri/licenses/README.txt](src-tauri/licenses/README.txt).
