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

## GPU vs CPU

Measured 2026-11-04 on an RTX 3060 with DirectML, same 20 lines, release build. Three runs each except the full-GPU row, which had two.

| Setup | Median per line | Worst per line | Model load | Lines correct |
|---|---|---|---|---|
| **GPU encoder, CPU decoder (default)** | **0.63–0.69 s** | 0.90–1.26 s | 5.2–5.8 s | 20/20 |
| CPU only | 1.08–1.38 s | 1.66–1.87 s | 3.9–5.1 s | 20/20 |
| GPU encoder and decoder (rejected) | 7.96–8.47 s | 9.11–9.83 s | 13.4–15.4 s | 0/20 |

The default is about twice as fast as CPU only and now stays under the 1.5 s target on this set. Load time on the GPU includes reading one test line. It used about 0.5 GB more video memory in a single reading taken during a run.

**The decoder stays on the CPU.** With DirectML on both models, nothing reports an error, but the decoder returns garbage and runs to the 256-token limit on every line. The cause was not investigated further. Only the merged decoder (`decoder_model_merged.onnx`) was tried. Set `INKD_DML_DECODER=1` to re-test after an `ort` upgrade.

**Fallback.** On startup the app reads a known line on the GPU and checks the answer, then uses the CPU if that fails, because a working run does not prove a correct one. Both cases fall back and report why:

- A bad adapter (`INKD_DML_DEVICE=99`) fails at initialisation.
- The garbage decoder (`INKD_DML_DECODER=1`) fails the answer check.

A GPU error during later use also switches to the CPU and retries that line. That path has not been triggered in a test.

## Accuracy

### Stand-in ink: 20/20

The 20 lines are not handwriting. `src/dev/synthInk.ts` generates them from hand-tuned glyph shapes with small random variation, and they come out tidy (see `proxy/`). This shows that the pipeline works and that the model reads clean pen-style ink. **It does not predict accuracy on real handwriting.** Report: `proxy/selftest.json`.

### Real handwriting: 18/20 read correctly

Recorded 2026-11-05 with the XP-Pen, GPU encoder and CPU decoder. Median 0.55 s per line, worst 0.88 s.

The baseline panel scored 14/20. It compares against the prompt, though, and four lines were written differently from the prompt, mostly by leaving out the final `=`. On every one of those, the model read exactly what was on the page. Scored against what was actually written, it read 18/20.

| Line | Written | Read as | Verdict |
|---|---|---|---|
| 03 | `6 × 8` (no `=`) | `6 \times 8` | Correct read |
| 06 | `5/6 − 1/3` (no `=`) | `5/6- \frac{1}{3}` | Correct read |
| 08 | `3² + 4²` (no `=`) | `3^2+4^2` | Correct read |
| 20 | `(x+1)/2 = (stacked)`; the word was copied from the prompt | the same, including the word | Correct read |
| 11 | `sin(30) =` | `\sin(30^{\circ})=` | **Misread**: added a degree sign |
| 14 | `x = 5` | `x=s` | **Misread**: 5 as s |

The letter x was read correctly in all four lines that use it (14, 15, 16, 19). Lines with variables, such as `2x + 3 =`, show no answer yet, because variables arrive in milestone 3. That is a solving gap, not a recognition one.

Two prompts were followed differently than intended:

- Line 20 printed "(stacked)" inside the prompt, so it was written as part of the line.
- Lines 05 and 06 were meant to be stacked fractions but were written inline. The model read `/` fine, so those still count.

The baseline panel now shows instructions apart from the prompt, and reminds you to include `=`.

**Gate: passed.** 18/20 on real handwriting is acceptable to continue. The CROHME-trained backup (CoMER/BTTR) was not needed. The two misreads (5 as s, a stray degree sign) are the kind the planned correction and fine-tune loop (milestone 8) is for.

The handwriting images stay on this machine and are not committed.
