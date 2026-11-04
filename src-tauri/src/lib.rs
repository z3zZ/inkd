pub mod recognizer;

use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock};

use recognizer::{Recognition, Recognizer};
use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, Manager, State};

const SELFTEST_ENV: &str = "INKD_SELFTEST";

/// Loads the model once, off the UI thread; callers wait until it is ready.
#[derive(Clone, Default)]
struct Engine {
    model_dirs: Arc<Mutex<Vec<PathBuf>>>,
    loaded: Arc<OnceLock<Result<Mutex<Recognizer>, String>>>,
}

impl Engine {
    fn get(&self) -> &Result<Mutex<Recognizer>, String> {
        self.loaded.get_or_init(|| {
            let dirs = self.model_dirs.lock().unwrap().clone();
            let Some(dir) = dirs.iter().find(|d| d.join("tokenizer.json").exists()) else {
                return Err(format!(
                    "TexTeller model not found. Run scripts/fetch-model.sh. Looked in: {}",
                    dirs.iter().map(|d| d.display().to_string()).collect::<Vec<_>>().join(", ")
                ));
            };
            Recognizer::load(dir).map(Mutex::new).map_err(|e| format!("Could not load the model: {e}"))
        })
    }

    fn recognise(&self, png: &[u8]) -> Result<Recognition, String> {
        let model = self.get().as_ref().map_err(Clone::clone)?;
        model.lock().unwrap().recognise(png).map_err(|e| e.to_string())
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
            if let Ok(dir) = app.path().app_local_data_dir() {
                dirs.push(dir.join("models").join("texteller"));
            }
            if cfg!(debug_assertions) {
                dirs.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("models").join("texteller"));
            }
            *engine.model_dirs.lock().unwrap() = dirs;

            // Warm up early so the first line written does not pay for loading the model.
            let warm = engine.clone();
            std::thread::spawn(move || {
                warm.get();
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![recognize, selftest_dir, selftest_finish, dev_write])
        .run(tauri::generate_context!())
        .expect("failed to start inkd");
}
