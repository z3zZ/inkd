pub mod download;
pub mod recognizer;

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use tauri::ipc::Channel;

use recognizer::{Backend, Recognition, Recognizer};
use serde::{Deserialize, Serialize};
use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, Manager, State};

const SELFTEST_ENV: &str = "INKD_SELFTEST";

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct Settings {
    force_cpu: bool,
}

/// What the app is running on, for the status bar.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct EngineStatus {
    backend: Option<Backend>,
    force_cpu: bool,
    /// Why the GPU was given up on, if it was.
    gpu_error: Option<String>,
    /// Why no model could load at all.
    load_error: Option<String>,
    /// No model files were found: the first-run download is needed.
    model_missing: bool,
    /// Bytes the first-run download fetches in all.
    download_size: u64,
}

#[derive(Default)]
struct Slot {
    model: Option<Result<Recognizer, String>>,
    gpu_error: Option<String>,
    missing: bool,
}

/// Holds the model. Loading happens under the lock, so callers wait until it is ready.
#[derive(Clone, Default)]
struct Engine {
    model_dirs: Arc<Mutex<Vec<PathBuf>>>,
    settings_path: Arc<Mutex<Option<PathBuf>>>,
    settings: Arc<Mutex<Settings>>,
    slot: Arc<Mutex<Slot>>,
    /// Where the first-run download puts the model.
    download_dir: Arc<Mutex<Option<PathBuf>>>,
    downloading: Arc<AtomicBool>,
    cancel: Arc<AtomicBool>,
}

/// A model folder is usable once every file is there under its final name. The downloader only
/// gives a file its final name after checking its hash, so a half-finished download never counts.
fn has_model(dir: &Path) -> bool {
    download::MODEL_FILES.iter().all(|f| dir.join(f.name).is_file())
}

impl Engine {
    fn force_cpu(&self) -> bool {
        self.settings.lock().unwrap().force_cpu
    }

    fn load_into(&self, slot: &mut Slot) {
        let dirs = self.model_dirs.lock().unwrap().clone();
        slot.missing = false;
        let Some(dir) = dirs.iter().find(|d| has_model(d)) else {
            slot.missing = true;
            eprintln!("model not found; looked in: {dirs:?}");
            slot.model = Some(Err(
                "Lines will be read once the handwriting model is downloaded (see the toolbar).".into(),
            ));
            return;
        };
        match Recognizer::load_best(dir, self.force_cpu()) {
            Ok((model, gpu_error)) => {
                slot.model = Some(Ok(model));
                slot.gpu_error = gpu_error;
            }
            Err(error) => slot.model = Some(Err(format!("Could not load the model: {error}"))),
        }
    }

    fn recognise(&self, png: &[u8]) -> Result<Recognition, String> {
        let mut slot = self.slot.lock().unwrap();
        if slot.model.is_none() {
            self.load_into(&mut slot);
        }
        let model = slot.model.as_mut().unwrap().as_mut().map_err(|e| e.clone())?;
        let outcome = model.recognise(png);
        let backend = model.backend();
        match outcome {
            Ok(recognition) => Ok(recognition),
            Err(error) if backend == Backend::DirectMl => {
                // The GPU can fail after a good start, e.g. a driver reset. Finish on the CPU.
                let dirs = self.model_dirs.lock().unwrap().clone();
                let dir = dirs.iter().find(|d| has_model(d)).ok_or("model folder is gone")?;
                let mut cpu = Recognizer::load(dir, Backend::Cpu).map_err(|e| e.to_string())?;
                let result = cpu.recognise(png).map_err(|e| e.to_string());
                slot.model = Some(Ok(cpu));
                slot.gpu_error = Some(error.to_string());
                result
            }
            Err(error) => Err(error.to_string()),
        }
    }

    fn status(&self) -> EngineStatus {
        let mut slot = self.slot.lock().unwrap();
        if slot.model.is_none() {
            self.load_into(&mut slot);
        }
        let (backend, load_error) = match slot.model.as_ref().unwrap() {
            Ok(model) => (Some(model.backend()), None),
            Err(error) => (None, Some(error.clone())),
        };
        EngineStatus {
            backend,
            force_cpu: self.force_cpu(),
            gpu_error: slot.gpu_error.clone(),
            load_error,
            model_missing: slot.missing,
            download_size: download::total_size(),
        }
    }

    fn download_model(&self, report: impl FnMut(download::Progress)) -> Result<EngineStatus, String> {
        if self.downloading.swap(true, Ordering::SeqCst) {
            return Err("the model is already downloading".into());
        }
        self.cancel.store(false, Ordering::SeqCst);
        let dir = self.download_dir.lock().unwrap().clone();
        let outcome = match dir {
            Some(dir) => download::download(&dir, &self.cancel, report),
            None => Err(download::DownloadError::Failed("no app data folder to download into".into())),
        };
        self.downloading.store(false, Ordering::SeqCst);
        match outcome {
            Ok(()) => {
                // Forget the "not found" result, so the next status loads the new model.
                *self.slot.lock().unwrap() = Slot::default();
                Ok(self.status())
            }
            Err(download::DownloadError::Cancelled) => Err("cancelled".into()),
            Err(download::DownloadError::Failed(message)) => Err(message),
        }
    }

    fn set_force_cpu(&self, force_cpu: bool) -> Result<EngineStatus, String> {
        let mut slot = self.slot.lock().unwrap();
        let settings = {
            let mut settings = self.settings.lock().unwrap();
            settings.force_cpu = force_cpu;
            settings.clone()
        };
        if let Some(path) = self.settings_path.lock().unwrap().as_ref() {
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            let json = serde_json::to_vec_pretty(&settings).map_err(|e| e.to_string())?;
            std::fs::write(path, json).map_err(|e| e.to_string())?;
        }
        slot.model = None;
        slot.gpu_error = None;
        self.load_into(&mut slot);
        drop(slot);
        Ok(self.status())
    }
}

fn raw_body(request: &Request<'_>) -> Result<Vec<u8>, String> {
    match request.body() {
        InvokeBody::Raw(bytes) => Ok(bytes.clone()),
        InvokeBody::Json(_) => Err("expected a binary request body".into()),
    }
}

#[tauri::command]
async fn recognize(request: Request<'_>, engine: State<'_, Engine>) -> Result<Recognition, String> {
    let png = raw_body(&request)?;
    let engine = engine.inner().clone();
    tauri::async_runtime::spawn_blocking(move || engine.recognise(&png))
        .await
        .map_err(|e| e.to_string())?
}

/// Waits for the model to finish loading, then reports what it is running on.
#[tauri::command]
async fn engine_status(engine: State<'_, Engine>) -> Result<EngineStatus, String> {
    let engine = engine.inner().clone();
    tauri::async_runtime::spawn_blocking(move || engine.status()).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn set_force_cpu(force_cpu: bool, engine: State<'_, Engine>) -> Result<EngineStatus, String> {
    let engine = engine.inner().clone();
    tauri::async_runtime::spawn_blocking(move || engine.set_force_cpu(force_cpu))
        .await
        .map_err(|e| e.to_string())?
}

/// Downloads the model, reporting progress, then loads it and reports what it runs on.
#[tauri::command]
async fn model_download(engine: State<'_, Engine>, on_progress: Channel<download::Progress>) -> Result<EngineStatus, String> {
    let engine = engine.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        engine.download_model(|progress| {
            let _ = on_progress.send(progress);
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Stops a download. What is already on disk is kept, so the next one resumes.
#[tauri::command]
fn model_download_cancel(engine: State<'_, Engine>) {
    engine.cancel.store(true, Ordering::SeqCst);
}

#[tauri::command]
fn selftest_dir() -> Option<String> {
    std::env::var(SELFTEST_ENV).ok()
}

#[tauri::command]
fn selftest_finish(app: AppHandle) {
    app.exit(0);
}

/// Writes baseline and self-test output: to the self-test folder if set, else app data.
#[tauri::command]
fn dev_write(app: AppHandle, request: Request<'_>) -> Result<String, String> {
    let name = request
        .headers()
        .get("x-file-name")
        .and_then(|v| v.to_str().ok())
        .ok_or("missing file name")?;
    let is_plain = !name.is_empty()
        && !name.starts_with('.')
        && name.chars().all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c));
    if !is_plain {
        return Err("bad file name".into());
    }
    let dir = match std::env::var_os(SELFTEST_ENV) {
        Some(dir) => PathBuf::from(dir),
        None => app.path().app_local_data_dir().map_err(|e| e.to_string())?.join("baseline"),
    };
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(name);
    std::fs::write(&path, raw_body(&request)?).map_err(|e| e.to_string())?;
    Ok(path.display().to_string())
}

/// Note files: the self-test folder when running the self-test, so it never touches real notes.
fn notes_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = match std::env::var_os(SELFTEST_ENV) {
        Some(dir) => PathBuf::from(dir).join("notes"),
        None => app.path().app_data_dir().map_err(|e| e.to_string())?.join("notes"),
    };
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Note ids are generated by the app; anything else could escape the notes folder.
fn note_path(dir: &std::path::Path, id: &str) -> Result<PathBuf, String> {
    let ok = !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-');
    if !ok {
        return Err("bad note id".into());
    }
    Ok(dir.join(format!("{id}.json")))
}

/// The fields of a note file the list needs; the strokes are skipped.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NoteMeta {
    id: String,
    title: String,
    created_at: f64,
    updated_at: f64,
    #[serde(default)]
    preview: Vec<String>,
}

#[tauri::command]
async fn notes_list(app: AppHandle) -> Result<Vec<NoteMeta>, String> {
    let dir = notes_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut notes = Vec::new();
        for entry in std::fs::read_dir(&dir).map_err(|e| e.to_string())?.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            // A damaged file must not hide every other note.
            match std::fs::read(&path).map_err(|e| e.to_string()).and_then(|b| {
                serde_json::from_slice::<NoteMeta>(&b).map_err(|e| e.to_string())
            }) {
                Ok(meta) => notes.push(meta),
                Err(error) => eprintln!("skipping note {}: {error}", path.display()),
            }
        }
        notes.sort_by(|a, b| b.updated_at.total_cmp(&a.updated_at));
        Ok(notes)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn note_load(app: AppHandle, id: String) -> Result<String, String> {
    let path = note_path(&notes_dir(&app)?, &id)?;
    std::fs::read_to_string(path).map_err(|e| e.to_string())
}

/// Writes a note atomically: to a temporary file first, then renamed over the old one,
/// so a crash mid-write never leaves half a note.
#[tauri::command]
fn note_save(app: AppHandle, request: Request<'_>) -> Result<(), String> {
    let id = request
        .headers()
        .get("x-note-id")
        .and_then(|v| v.to_str().ok())
        .ok_or("missing note id")?;
    let path = note_path(&notes_dir(&app)?, id)?;
    let body = raw_body(&request)?;
    let meta: NoteMeta = serde_json::from_slice(&body).map_err(|e| format!("not a note: {e}"))?;
    if meta.id != id {
        return Err("note id does not match its file".into());
    }
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, &body).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

/// Moves a note into notes/trash rather than deleting it, so a mistaken delete can be recovered by hand.
#[tauri::command]
fn note_delete(app: AppHandle, id: String) -> Result<(), String> {
    let dir = notes_dir(&app)?;
    let path = note_path(&dir, &id)?;
    if !path.exists() {
        return Ok(());
    }
    let trash = dir.join("trash");
    std::fs::create_dir_all(&trash).map_err(|e| e.to_string())?;
    std::fs::rename(&path, trash.join(format!("{id}.json"))).map_err(|e| e.to_string())
}

/// One hand correction: what the model read a line as, and what it should have been.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Correction {
    id: String,
    original: String,
    corrected: String,
    at: f64,
}

/// Keeps a corrected line for fine-tuning: its image as `<id>.png`, and a row in `corrections.jsonl`.
/// The body is a 4-byte little-endian length, that many bytes of JSON (`Correction`), then the PNG.
#[tauri::command]
fn correction_log(app: AppHandle, request: Request<'_>) -> Result<(), String> {
    let body = raw_body(&request)?;
    let len = body.get(..4).ok_or("body too short")?;
    let len = u32::from_le_bytes(len.try_into().unwrap()) as usize;
    let json = body.get(4..4 + len).ok_or("body too short")?;
    let png = &body[4 + len..];
    if !png.starts_with(b"\x89PNG") {
        return Err("expected a PNG image".into());
    }
    let correction: Correction = serde_json::from_slice(json).map_err(|e| e.to_string())?;

    let dir = match std::env::var_os(SELFTEST_ENV) {
        Some(dir) => PathBuf::from(dir).join("corrections"),
        None => app.path().app_data_dir().map_err(|e| e.to_string())?.join("corrections"),
    };
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let image = note_path(&dir, &correction.id)?.with_extension("png");
    std::fs::write(&image, png).map_err(|e| e.to_string())?;

    let mut row = serde_json::to_value(&correction).map_err(|e| e.to_string())?;
    row["image"] = format!("{}.png", correction.id).into();
    let mut line = serde_json::to_string(&row).map_err(|e| e.to_string())?;
    line.push('\n');
    use std::io::Write;
    std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join("corrections.jsonl"))
        .and_then(|mut f| f.write_all(line.as_bytes()))
        .map_err(|e| e.to_string())
}

pub fn run() {
    let engine = Engine::default();
    tauri::Builder::default()
        .manage(engine.clone())
        .setup(move |app| {
            let mut dirs = Vec::new();
            if let Some(dir) = std::env::var_os("INKD_MODEL_DIR") {
                dirs.push(PathBuf::from(dir));
            }
            if let Ok(data) = app.path().app_local_data_dir() {
                let models = data.join("models").join("texteller");
                *engine.download_dir.lock().unwrap() = Some(models.clone());
                dirs.push(models);
                let path = data.join("settings.json");
                if let Some(saved) = std::fs::read(&path).ok().and_then(|b| serde_json::from_slice(&b).ok()) {
                    *engine.settings.lock().unwrap() = saved;
                }
                *engine.settings_path.lock().unwrap() = Some(path);
            }
            if cfg!(debug_assertions) {
                dirs.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("models").join("texteller"));
            }
            *engine.model_dirs.lock().unwrap() = dirs;

            // Warm up early so the first line written does not pay for loading the model.
            let warm = engine.clone();
            std::thread::spawn(move || {
                warm.status();
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            recognize,
            engine_status,
            set_force_cpu,
            selftest_dir,
            selftest_finish,
            dev_write,
            notes_list,
            note_load,
            note_save,
            note_delete,
            correction_log,
            model_download,
            model_download_cancel
        ])
        .run(tauri::generate_context!())
        .expect("failed to start inkd");
}
