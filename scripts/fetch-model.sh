#!/usr/bin/env bash
# Downloads the Apache-2.0 TexTeller ONNX build into src-tauri/models/texteller.
set -euo pipefail
dir="$(cd "$(dirname "$0")/.." && pwd)/src-tauri/models/texteller"
mkdir -p "$dir"
for f in tokenizer.json config.json generation_config.json encoder_model.onnx decoder_model_merged.onnx; do
  curl -fL -C - -o "$dir/$f" "https://huggingface.co/OleehyO/TexTeller/resolve/main/$f"
done
