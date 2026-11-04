pub mod recognizer;

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

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
}

#[derive(Default)]
struct Slot {
    model: Option<Result<Recognizer, String>>,
    gpu_error: Option<String>,
}

/// Holds the model. Loading happens under the lock, so callers wait until it is ready.
#[derive(Clone, Default)]
struct Engine {
    model_dirs: Arc<Mutex<Vec<PathBuf>>>,
    settings_path: Arc<Mutex<Option<PathBuf>>>,
    settings: Arc<Mutex<Settings>>,
    slot: Arc<Mutex<Slot>>,
}

impl Engine {
    fn force_cpu(&self) -> bool {
        self.settings.lock().unwrap().force_cpu
    }

    fn load_into(&self, slot: &mut Slot) {
        let dirs = self.model_dirs.lock().unwrap().clone();
        let Some(dir) = dirs.iter().find(|d| d.join("tokenizer.json").exists()) else {
            slot.model = Some(Err(format!(
                "TexTeller model not found. Run scripts/fetch-model.sh. Looked in: {}",
                dirs.iter().map(|d| d.display().to_string()).collect::<Vec<_>>().join(", ")
            )));
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
                let dir = dirs.iter().find(|d| d.join("tokenizer.json").exists()).ok_or("model folder is gone")?;
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
        EngineStatus { backend, force_cpu: self.force_cpu(), gpu_error: slot.gpu_error.clone(), load_error }
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
                dirs.push(data.join("models").join("texteller"));
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
            dev_write
        ])
        .run(tauri::generate_context!())
        .expect("failed to start inkd");
}
