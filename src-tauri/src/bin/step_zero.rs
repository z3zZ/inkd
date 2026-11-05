//! Step-zero benchmark: runs TexTeller from Rust on every PNG in a folder and prints latency.
//!
//!   cargo run --release --bin step_zero -- <image-folder> [--cpu] [--describe]
//!
//! Without --cpu it uses the same GPU-then-CPU logic as the app, and says which one it got.

use std::path::{Path, PathBuf};
use std::time::Instant;

use inkd_lib::recognizer::Recognizer;

fn main() -> Result<(), inkd_lib::recognizer::Error> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let folder = args.first().map(PathBuf::from).ok_or("usage: step_zero <image-folder> [--cpu] [--describe]")?;
    let model = std::env::var_os("INKD_MODEL_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| Path::new(env!("CARGO_MANIFEST_DIR")).join("models").join("texteller"));

    let started = Instant::now();
    let (mut recognizer, gpu_error) = Recognizer::load_best(&model, args.iter().any(|a| a == "--cpu"))?;
    println!("backend: {:?}", recognizer.backend());
    if let Some(error) = gpu_error {
        println!("GPU fell back to CPU: {error}");
    }
    println!("model load: {} ms", started.elapsed().as_millis());
    if args.iter().any(|a| a == "--describe") {
        println!("{}", recognizer.describe());
    }

    let mut images: Vec<PathBuf> = std::fs::read_dir(&folder)?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().is_some_and(|x| x == "png") && !p.ends_with("e2e-canvas.png"))
        .collect();
    images.sort();

    let mut times = Vec::new();
    for path in &images {
        let result = recognizer.recognise(&std::fs::read(path)?)?;
        println!(
            "{:>6} ms  {:>3} tok  {:>3.0}%  {:<14} {}",
            result.ms,
            result.tokens,
            result.confidence * 100.0,
            path.file_stem().unwrap().to_string_lossy(),
            result.latex
        );
        times.push(result.ms);
    }
    if !times.is_empty() {
        // The first run pays for lazy allocation in ONNX Runtime, so it is reported apart.
        let first = times[0];
        let mut rest = times[1.min(times.len() - 1)..].to_vec();
        rest.sort_unstable();
        println!(
            "first {} ms | median {} ms | worst {} ms | {} lines",
            first,
            rest[rest.len() / 2],
            rest[rest.len() - 1],
            times.len()
        );
    }
    Ok(())
}
