//! First-run download of the TexTeller model from Hugging Face.
//!
//! Pinned to one revision and checked against SHA-256 hashes, so what runs is exactly
//! what was tested. Downloads resume after a cancel, a crash or a dropped connection.

use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use serde::Serialize;
use sha2::{Digest, Sha256};

/// OleehyO/TexTeller on Hugging Face (Apache-2.0), as of the revision tested in step zero.
const REPO: &str = "https://huggingface.co/OleehyO/TexTeller/resolve/7b96df06b9d81cdb129c3bef68b7250bc3e2b0ea";

pub struct ModelFile {
    pub name: &'static str,
    pub size: u64,
    pub sha256: &'static str,
}

pub const MODEL_FILES: &[ModelFile] = &[
    ModelFile { name: "config.json", size: 4504, sha256: "ae1df4b712a25df6cbf0441d0e5602cee139f3f371c1b3555274db7aed2c0135" },
    ModelFile { name: "generation_config.json", size: 154, sha256: "dce3cbe591ed7fc9d9ea9c588697e9e3a05248446343cf1682df309c013d5ab7" },
    ModelFile { name: "tokenizer.json", size: 1044328, sha256: "3fd70ac72edab8213b7dd13271b3c69b6c2252ab3e04f8045939dad0847309be" },
    ModelFile { name: "encoder_model.onnx", size: 343553824, sha256: "071afc0a0c92b2ee3847612127eb9e82b1c39413725e692f4405e5ea9e265bf0" },
    ModelFile { name: "decoder_model_merged.onnx", size: 909186959, sha256: "8b78f10f67da98528fb507977f6d041fe0a8fb486a56b2132156f93b2d5de575" },
];

pub fn total_size() -> u64 {
    MODEL_FILES.iter().map(|f| f.size).sum()
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub done: u64,
    pub total: u64,
    /// "downloading" or "checking".
    pub stage: &'static str,
}

const CHUNK: usize = 256 * 1024;
const REPORT_EVERY: Duration = Duration::from_millis(150);

#[derive(Debug)]
pub enum DownloadError {
    Cancelled,
    Failed(String),
}

impl From<std::io::Error> for DownloadError {
    fn from(e: std::io::Error) -> Self {
        DownloadError::Failed(e.to_string())
    }
}

fn part_path(dir: &Path, file: &ModelFile) -> std::path::PathBuf {
    dir.join(format!("{}.part", file.name))
}

/// Bytes already on disk: finished files count in full, partial ones by length.
fn on_disk(dir: &Path, file: &ModelFile) -> u64 {
    if fs::metadata(dir.join(file.name)).map(|m| m.len() == file.size).unwrap_or(false) {
        return file.size;
    }
    fs::metadata(part_path(dir, file)).map(|m| m.len().min(file.size)).unwrap_or(0)
}

/// Whether every model file is present at its full size. Cheap: does not hash.
pub fn is_complete(dir: &Path) -> bool {
    MODEL_FILES
        .iter()
        .all(|f| fs::metadata(dir.join(f.name)).map(|m| m.len() == f.size).unwrap_or(false))
}

fn hash_into(hasher: &mut Sha256, path: &Path, cancel: &AtomicBool) -> Result<(), DownloadError> {
    let mut file = File::open(path)?;
    let mut buf = vec![0u8; 1024 * 1024];
    loop {
        if cancel.load(Ordering::Relaxed) {
            return Err(DownloadError::Cancelled);
        }
        let n = file.read(&mut buf)?;
        if n == 0 {
            return Ok(());
        }
        hasher.update(&buf[..n]);
    }
}

/// Downloads whatever is missing into `dir`. Files already complete are skipped.
pub fn download(dir: &Path, cancel: &AtomicBool, report: impl FnMut(Progress)) -> Result<(), DownloadError> {
    download_files(MODEL_FILES, dir, cancel, report)
}

fn download_files(
    files: &[ModelFile],
    dir: &Path,
    cancel: &AtomicBool,
    mut report: impl FnMut(Progress),
) -> Result<(), DownloadError> {
    fs::create_dir_all(dir)?;
    let total: u64 = files.iter().map(|f| f.size).sum();
    let mut done: u64 = files.iter().map(|f| on_disk(dir, f)).sum();
    let mut last_report = Instant::now();
    report(Progress { done, total, stage: "downloading" });

    let agent = ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(20))
        .timeout_read(Duration::from_secs(60))
        .build();

    for file in files {
        let target = dir.join(file.name);
        if fs::metadata(&target).map(|m| m.len() == file.size).unwrap_or(false) {
            continue;
        }
        let part = part_path(dir, file);
        let mut have = fs::metadata(&part).map(|m| m.len()).unwrap_or(0);
        if have > file.size {
            fs::remove_file(&part)?;
            done -= file.size.min(have);
            have = 0;
        }

        if have < file.size {
            let url = format!("{REPO}/{}", file.name);
            let mut request = agent.get(&url);
            if have > 0 {
                request = request.set("Range", &format!("bytes={have}-"));
            }
            let response = request.call().map_err(|e| DownloadError::Failed(format!("could not reach Hugging Face: {e}")))?;
            if have > 0 && response.status() != 206 {
                // The server ignored the range: start this file again.
                done -= have;
                have = 0;
            }
            let mut out = OpenOptions::new().create(true).write(true).append(have > 0).truncate(have == 0).open(&part)?;
            let mut body = response.into_reader();
            let mut buf = vec![0u8; CHUNK];
            loop {
                if cancel.load(Ordering::Relaxed) {
                    return Err(DownloadError::Cancelled);
                }
                let n = body.read(&mut buf).map_err(|e| DownloadError::Failed(format!("download interrupted: {e}")))?;
                if n == 0 {
                    break;
                }
                out.write_all(&buf[..n])?;
                have += n as u64;
                done += n as u64;
                if last_report.elapsed() >= REPORT_EVERY {
                    report(Progress { done, total, stage: "downloading" });
                    last_report = Instant::now();
                }
            }
            out.flush()?;
            drop(out);
            if have != file.size {
                return Err(DownloadError::Failed(format!(
                    "{} stopped early ({have} of {} bytes). Try again to resume.",
                    file.name, file.size
                )));
            }
        }

        report(Progress { done, total, stage: "checking" });
        let mut hasher = Sha256::new();
        hash_into(&mut hasher, &part, cancel)?;
        let actual = format!("{:x}", hasher.finalize());
        if actual != file.sha256 {
            fs::remove_file(&part)?;
            return Err(DownloadError::Failed(format!(
                "{} did not match its checksum, so it was thrown away. Try again.",
                file.name
            )));
        }
        fs::rename(&part, &target)?;
        last_report = Instant::now();
        report(Progress { done, total, stage: "downloading" });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The small files only, so the test is quick. Needs the network: `cargo test -- --ignored`.
    fn small() -> &'static [ModelFile] {
        &MODEL_FILES[..3]
    }

    fn temp_dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("inkd-download-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    #[ignore]
    fn downloads_resumes_and_rejects_bad_files() {
        let cancel = AtomicBool::new(false);

        // Fresh download: every file arrives under its final name with the right size.
        let dir = temp_dir("fresh");
        let mut last = None;
        download_files(small(), &dir, &cancel, |p| last = Some(p)).unwrap();
        for f in small() {
            assert_eq!(fs::metadata(dir.join(f.name)).unwrap().len(), f.size, "{}", f.name);
        }
        let last = last.unwrap();
        assert_eq!(last.done, last.total);

        // Resume: a cut-off .part file is finished with a range request, not started again.
        let tokenizer = &small()[2];
        let whole = fs::read(dir.join(tokenizer.name)).unwrap();
        fs::remove_file(dir.join(tokenizer.name)).unwrap();
        fs::write(part_path(&dir, tokenizer), &whole[..400_000]).unwrap();
        let mut first = None;
        download_files(small(), &dir, &cancel, |p| {
            first.get_or_insert(p.done);
        })
        .unwrap();
        assert_eq!(first, Some(4504 + 154 + 400_000), "progress starts from what is on disk");
        assert_eq!(fs::read(dir.join(tokenizer.name)).unwrap(), whole);

        // Corrupt: a full-length .part with wrong bytes fails its checksum and is thrown away.
        fs::remove_file(dir.join(tokenizer.name)).unwrap();
        fs::write(part_path(&dir, tokenizer), vec![b'x'; tokenizer.size as usize]).unwrap();
        let error = download_files(small(), &dir, &cancel, |_| {}).unwrap_err();
        assert!(matches!(error, DownloadError::Failed(ref m) if m.contains("checksum")), "{error:?}");
        assert!(!part_path(&dir, tokenizer).exists());
        assert!(!dir.join(tokenizer.name).exists());

        // Cancel: stops without finishing, and leaves nothing under a final name.
        cancel.store(true, Ordering::SeqCst);
        assert!(matches!(download_files(small(), &dir, &cancel, |_| {}), Err(DownloadError::Cancelled)));
        assert!(!dir.join(tokenizer.name).exists());

        let _ = fs::remove_dir_all(&dir);
    }
}
