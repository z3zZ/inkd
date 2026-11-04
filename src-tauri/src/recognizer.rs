//! TexTeller over ONNX Runtime: preprocessing, encoder, and greedy decoding with a KV cache.

use std::borrow::Cow;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::thread;

use image::imageops::{self, FilterType};
use image::GrayImage;
use ort::session::builder::GraphOptimizationLevel;
use ort::session::{Session, SessionInputValue};
use ort::value::{DynValue, Tensor};
use serde::Serialize;
use tokenizers::Tokenizer;

const IMAGE_SIZE: u32 = 448;
const IMAGE_MEAN: f32 = 0.954_546_7;
const IMAGE_STD: f32 = 0.153_944_45;
/// Difference from the background that counts as ink when trimming, as upstream.
const TRIM_THRESHOLD: i16 = 15;
const BOS_TOKEN: i64 = 0;
const EOS_TOKEN: i64 = 2;
/// A single handwritten line never needs more; this bounds a decoder stuck in a loop.
const MAX_TOKENS: usize = 256;

pub type Error = Box<dyn std::error::Error + Send + Sync>;

#[derive(Debug, Clone, Serialize)]
pub struct Recognition {
    pub latex: String,
    /// Geometric mean of the per-token probabilities, 0..1.
    pub confidence: f32,
    pub ms: u64,
    pub tokens: usize,
}

pub struct Recognizer {
    encoder: Session,
    decoder: Session,
    tokenizer: Tokenizer,
    /// Name and shape of each KV-cache placeholder the merged decoder needs on its first pass.
    /// That branch ignores their values, and ort cannot create a tensor with a zero dimension.
    empty_past: Vec<(String, [usize; 4])>,
    uses_encoder_mask: bool,
}

fn open_session(path: &Path) -> Result<Session, Error> {
    let threads = thread::available_parallelism().map(|n| n.get() / 2).unwrap_or(4).max(1);
    Ok(Session::builder()
        .map_err(|e| e.to_string())?
        .with_optimization_level(GraphOptimizationLevel::Level3)
        .map_err(|e| e.to_string())?
        .with_intra_threads(threads)
        .map_err(|e| e.to_string())?
        .commit_from_file(path)?)
}

/// Prefers an int8 build when one is present. INKD_FLOAT_MODEL forces the original.
fn pick_model(dir: &Path, stem: &str) -> PathBuf {
    let quantized = dir.join(format!("{stem}_int8.onnx"));
    if quantized.exists() && std::env::var_os("INKD_FLOAT_MODEL").is_none() {
        quantized
    } else {
        dir.join(format!("{stem}.onnx"))
    }
}

impl Recognizer {
    pub fn load(dir: &Path) -> Result<Self, Error> {
        let encoder = open_session(&pick_model(dir, "encoder_model"))?;
        let decoder = open_session(&pick_model(dir, "decoder_model_merged"))?;
        let tokenizer = Tokenizer::from_file(dir.join("tokenizer.json")).map_err(|e| e.to_string())?;

        let config: serde_json::Value = serde_json::from_slice(&std::fs::read(dir.join("config.json"))?)?;
        let d = &config["decoder"];
        let heads = d["decoder_attention_heads"].as_u64().ok_or("config: decoder heads")? as usize;
        let width = d["hidden_size"]
            .as_u64()
            .or_else(|| d["d_model"].as_u64())
            .ok_or("config: decoder width")? as usize;

        let empty_past = decoder
            .inputs()
            .iter()
            .map(|i| i.name().to_string())
            .filter(|n| n.starts_with("past_key_values"))
            .map(|n| (n, [1, heads, 1, width / heads]))
            .collect();
        let uses_encoder_mask = decoder.inputs().iter().any(|i| i.name() == "encoder_attention_mask");

        Ok(Self { encoder, decoder, tokenizer, empty_past, uses_encoder_mask })
    }

    pub fn describe(&self) -> String {
        let list = |s: &Session| {
            let mut out = String::new();
            for i in s.inputs() {
                out += &format!("  in  {} {:?}\n", i.name(), i.dtype());
            }
            for o in s.outputs() {
                out += &format!("  out {} {:?}\n", o.name(), o.dtype());
            }
            out
        };
        format!("encoder\n{}decoder\n{}", list(&self.encoder), list(&self.decoder))
    }

    pub fn recognise(&mut self, png: &[u8]) -> Result<Recognition, Error> {
        let started = std::time::Instant::now();
        let image = image::load_from_memory(png)?.to_luma8();
        let pixels = preprocess(&image)?;
        let size = IMAGE_SIZE as usize;
        let input = Tensor::from_array(([1usize, 1, size, size], pixels))?;

        let (hidden_shape, hidden) = {
            let outputs = self.encoder.run(ort::inputs!["pixel_values" => input])?;
            let (shape, data) = outputs[0].try_extract_tensor::<f32>()?;
            (shape.iter().map(|&d| d as usize).collect::<Vec<_>>(), data.to_vec())
        };
        let hidden_shape: [usize; 3] = hidden_shape.try_into().map_err(|_| "encoder output is not rank 3")?;

        let mut ids = vec![BOS_TOKEN];
        let mut log_prob_sum = 0.0f32;
        let mut past: HashMap<String, DynValue> = HashMap::new();
        let mut encoder_past: HashMap<String, DynValue> = HashMap::new();

        for step in 0..MAX_TOKENS {
            let last = *ids.last().unwrap();
            let mut inputs: Vec<(Cow<'_, str>, SessionInputValue<'_>)> = vec![
                ("input_ids".into(), Tensor::from_array(([1usize, 1], vec![last]))?.into_dyn().into()),
                (
                    "encoder_hidden_states".into(),
                    Tensor::from_array((hidden_shape, hidden.clone()))?.into_dyn().into(),
                ),
                ("use_cache_branch".into(), Tensor::from_array(([1usize], vec![step > 0]))?.into_dyn().into()),
            ];
            if self.uses_encoder_mask {
                let mask = vec![1i64; hidden_shape[1]];
                inputs.push((
                    "encoder_attention_mask".into(),
                    Tensor::from_array(([1usize, hidden_shape[1]], mask))?.into_dyn().into(),
                ));
            }
            for (name, shape) in &self.empty_past {
                let value: SessionInputValue<'_> = if step == 0 {
                    Tensor::from_array((*shape, vec![0.0f32; shape.iter().product()]))?.into_dyn().into()
                } else {
                    past.get(name)
                        .or_else(|| encoder_past.get(name))
                        .ok_or_else(|| format!("missing cache tensor {name}"))?
                        .view()
                        .into()
                };
                inputs.push((name.as_str().into(), value));
            }

            let mut outputs = self.decoder.run(inputs)?;
            let (shape, logits) = outputs["logits"].try_extract_tensor::<f32>()?;
            let vocab = shape[2] as usize;
            let (next, probability) = best_token(&logits[logits.len() - vocab..]);
            log_prob_sum += probability.max(1e-9).ln();

            let names: Vec<String> = outputs.keys().map(|k| k.to_string()).collect();
            let mut new_past = HashMap::new();
            for name in names {
                let Some(rest) = name.strip_prefix("present") else { continue };
                let key = format!("past_key_values{rest}");
                let value = outputs.remove(&name).ok_or("missing output")?;
                // Cross-attention entries are only meaningful on the first pass, then kept.
                if !rest.contains("encoder") {
                    new_past.insert(key, value);
                } else if step == 0 {
                    encoder_past.insert(key, value);
                }
            }
            drop(outputs);
            past = new_past;

            if next == EOS_TOKEN {
                break;
            }
            ids.push(next);
        }

        let produced = ids.len();
        let tokens: Vec<u32> = ids.iter().map(|&i| i as u32).collect();
        let latex = self.tokenizer.decode(&tokens, true).map_err(|e| e.to_string())?;
        Ok(Recognition {
            latex: latex.trim().to_string(),
            confidence: (log_prob_sum / produced as f32).exp(),
            ms: started.elapsed().as_millis() as u64,
            tokens: produced,
        })
    }
}

/// The highest-scoring token and its softmax probability.
fn best_token(logits: &[f32]) -> (i64, f32) {
    let peak = logits.iter().copied().fold(f32::MIN, f32::max);
    let mut best = 0usize;
    let mut total = 0.0f32;
    for (i, &score) in logits.iter().enumerate() {
        total += (score - peak).exp();
        if score == peak {
            best = i;
        }
    }
    (best as i64, 1.0 / total)
}

/// Crops to the ink, using the most common corner value as the background.
fn trim_border(image: &GrayImage) -> Result<GrayImage, Error> {
    let (w, h) = image.dimensions();
    let corners = [
        image.get_pixel(0, 0)[0],
        image.get_pixel(w - 1, 0)[0],
        image.get_pixel(0, h - 1)[0],
        image.get_pixel(w - 1, h - 1)[0],
    ];
    let background = *corners.iter().max_by_key(|c| corners.iter().filter(|o| o == c).count()).unwrap() as i16;

    let (mut left, mut top, mut right, mut bottom) = (w, h, 0u32, 0u32);
    for (x, y, p) in image.enumerate_pixels() {
        if (p[0] as i16 - background).abs() > TRIM_THRESHOLD {
            left = left.min(x);
            top = top.min(y);
            right = right.max(x);
            bottom = bottom.max(y);
        }
    }
    if left > right {
        return Err("image has no ink".into());
    }
    Ok(imageops::crop_imm(image, left, top, right - left + 1, bottom - top + 1).to_image())
}

/// Matches TexTeller's inference transform: trim, fit to 448 by bicubic, normalise, pad with 0.
fn preprocess(image: &GrayImage) -> Result<Vec<f32>, Error> {
    let trimmed = trim_border(image)?;
    let (w, h) = trimmed.dimensions();
    let (short, long) = (w.min(h) as f32, w.max(h) as f32);
    let scale = if long * ((IMAGE_SIZE - 1) as f32 / short) > IMAGE_SIZE as f32 {
        IMAGE_SIZE as f32 / long
    } else {
        (IMAGE_SIZE - 1) as f32 / short
    };
    let nw = ((w as f32 * scale) as u32).clamp(1, IMAGE_SIZE);
    let nh = ((h as f32 * scale) as u32).clamp(1, IMAGE_SIZE);
    let resized = imageops::resize(&trimmed, nw, nh, FilterType::CatmullRom);

    let size = IMAGE_SIZE as usize;
    let mut out = vec![0.0f32; size * size];
    for (x, y, p) in resized.enumerate_pixels() {
        out[y as usize * size + x as usize] = (p[0] as f32 / 255.0 - IMAGE_MEAN) / IMAGE_STD;
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::Luma;

    #[test]
    fn preprocess_trims_fits_and_pads() {
        // A 100x20 black block on white: it fits to 448 wide and about 90 tall.
        let mut img = GrayImage::from_pixel(300, 100, Luma([255]));
        for y in 40..60 {
            for x in 100..200 {
                img.put_pixel(x, y, Luma([0]));
            }
        }
        let out = preprocess(&img).unwrap();
        let black = (0.0 - IMAGE_MEAN) / IMAGE_STD;
        assert!((out[0] - black).abs() < 1e-3, "ink starts at the origin after trimming");
        assert!((out[447] - black).abs() < 1e-3, "ink reaches the right edge");
        assert_eq!(out[447 * 448], 0.0, "area below the ink is padded with 0");
    }

    #[test]
    fn blank_image_is_an_error() {
        assert!(preprocess(&GrayImage::from_pixel(64, 64, Luma([255]))).is_err());
    }

    #[test]
    fn best_token_probability_is_softmax() {
        let (index, p) = best_token(&[0.0, 2.0f32.ln(), 0.0]);
        assert_eq!(index, 1);
        assert!((p - 0.5).abs() < 1e-5);
    }
}
