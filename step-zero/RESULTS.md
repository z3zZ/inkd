# Step zero results

Measured 2026-11-03 on a Ryzen 5 3600 (6 cores) with 16 GB RAM, CPU only, Windows 11.

## Licences

| Item | Licence | Where checked |
|---|---|---|
| TexTeller code | Apache-2.0 | `LICENSE` in OleehyO/TexTeller on GitHub |
| TexTeller weights | Apache-2.0 | Model metadata for OleehyO/TexTeller on Hugging Face |

## Model

The published ONNX build is used as is, so no export was needed: `encoder_model.onnx` (344 MB) and `decoder_model_merged.onnx` (909 MB). It runs from Rust through ONNX Runtime (`ort` 2.0.0-rc.12).

## Latency

Release build, from `step_zero`, 20 lines:

| Measure | Result |
|---|---|
| Model load | 5.1 s (on a background thread at startup) |
| Median per line | 1.11 s |
| Worst per line | 1.46 s |
| Target | under 1.5 s: **met** |

Int8 quantisation was not needed for this set. Time is about 0.75 s for the encoder plus about 45 ms per output token, so a line over roughly 16 tokens will exceed the target. Longer lines are the case to revisit, with int8 or the GPU.

## Accuracy

### Stand-in ink: 20/20

The 20 lines are not handwriting. `src/dev/synthInk.ts` generates them from hand-tuned glyph shapes with small random variation, and they come out tidy (see `proxy/`). This shows that the pipeline works and that the model reads clean pen-style ink. **It does not predict accuracy on real handwriting.** Report: `proxy/selftest.json`.

### Real handwriting: not yet recorded

The plan's baseline needs 20 lines written with the tablet, so this needs a person. In the app, press Ctrl+Shift+B and work through the prompts. Results are saved to `%LOCALAPPDATA%\app.inkd.desktop\baseline\baseline.json`. Add the score here once it exists.

The plan's gate, acceptable accuracy before moving on, stays open until then. The CROHME-trained backup (CoMER/BTTR) was not evaluated, because it only matters if TexTeller falls short on real handwriting.
