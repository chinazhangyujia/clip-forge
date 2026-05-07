//! ClipForge desktop shell.
//!
//! Responsibilities:
//!   * Resolve / persist the user's project directory in
//!     `<app_config_dir>/config.json`.
//!   * Spawn the bundled FastAPI backend as a child process with that
//!     directory and a free port; relay backend logs to the parent stderr.
//!   * Expose `get_backend_url` and `pick_project_dir` Tauri commands so the
//!     WebView (Next.js static export) can talk to the backend at runtime.
//!   * Inject API keys (compile-time) into the backend's environment so the
//!     Python side reads them via `pydantic-settings` exactly as in dev.

use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, RunEvent, State};

#[derive(Default)]
struct AppState {
    backend: Mutex<Option<Child>>,
    port: Mutex<Option<u16>>,
}

#[derive(Serialize, Deserialize, Default, Clone)]
struct Config {
    #[serde(default)]
    project_dir: Option<String>,
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("app_config_dir: {}", e))?;
    Ok(dir.join("config.json"))
}

fn load_config(app: &AppHandle) -> Config {
    if let Ok(p) = config_path(app) {
        if let Ok(s) = std::fs::read_to_string(&p) {
            return serde_json::from_str(&s).unwrap_or_default();
        }
    }
    Config::default()
}

fn save_config(app: &AppHandle, cfg: &Config) -> Result<(), String> {
    let p = config_path(app)?;
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&p, serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())
}

fn ensure_project_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let cfg = load_config(app);
    if let Some(dir) = cfg.project_dir.as_ref() {
        let p = PathBuf::from(dir);
        if p.exists() {
            return Ok(p);
        }
        // Stale path (user moved/deleted it) — fall through to default.
    }
    let default = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {}", e))?
        .join("projects");
    std::fs::create_dir_all(&default).map_err(|e| e.to_string())?;
    let new_cfg = Config {
        project_dir: Some(default.to_string_lossy().to_string()),
    };
    save_config(app, &new_cfg)?;
    Ok(default)
}

fn ffmpeg_resource_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let r = app.path().resource_dir().map_err(|e| e.to_string())?;
    Ok(r.join("binaries").join("ffmpeg"))
}

fn backend_exe_path(app: &AppHandle) -> Result<PathBuf, String> {
    let r = app.path().resource_dir().map_err(|e| e.to_string())?;
    let dir = r.join("binaries").join("clipforge-backend");
    let exe = if cfg!(windows) {
        dir.join("clipforge-backend.exe")
    } else {
        dir.join("clipforge-backend")
    };
    Ok(exe)
}

fn start_backend(app: &AppHandle) -> Result<(Child, u16), String> {
    let backend_exe = backend_exe_path(app)?;
    if !backend_exe.exists() {
        return Err(format!(
            "Backend binary not found at {}. The bundle may be corrupt.",
            backend_exe.display()
        ));
    }
    let ffmpeg_dir = ffmpeg_resource_dir(app)?;
    let project_dir = ensure_project_dir(app)?;

    // API keys baked in at compile time. Build script sets these env vars
    // before invoking `cargo tauri build`. Falling back to empty string
    // surfaces a clear runtime error from the Python side.
    let deepseek_key = option_env!("CLIPFORGE_DEEPSEEK_API_KEY").unwrap_or("");
    let anthropic_key = option_env!("CLIPFORGE_ANTHROPIC_API_KEY").unwrap_or("");
    let provider = option_env!("CLIPFORGE_LLM_PROVIDER").unwrap_or("deepseek");
    let whisper_model = option_env!("CLIPFORGE_WHISPER_MODEL").unwrap_or("base");

    let mut cmd = Command::new(&backend_exe);
    cmd.arg("--data-dir")
        .arg(&project_dir)
        .arg("--port")
        .arg("0")
        .arg("--ffmpeg-dir")
        .arg(&ffmpeg_dir)
        .env("DEEPSEEK_API_KEY", deepseek_key)
        .env("ANTHROPIC_API_KEY", anthropic_key)
        .env("CLIPFORGE_LLM_PROVIDER", provider)
        .env("CLIPFORGE_WHISPER_MODEL", whisper_model)
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit());

    let mut child = cmd.spawn().map_err(|e| format!("spawn backend: {}", e))?;

    // Read CLIPFORGE_PORT=<n> from backend stdout. Subsequent lines are
    // uvicorn logs; forward them to parent stderr in a background thread.
    let stdout = child.stdout.take().ok_or("backend has no stdout")?;
    let mut reader = BufReader::new(stdout);
    let mut port: Option<u16> = None;
    let mut buf = String::new();
    for _ in 0..50 {
        buf.clear();
        match reader.read_line(&mut buf) {
            Ok(0) => return Err("backend exited before reporting port".into()),
            Ok(_) => {}
            Err(e) => return Err(format!("backend stdout read: {}", e)),
        }
        let trimmed = buf.trim();
        if let Some(rest) = trimmed.strip_prefix("CLIPFORGE_PORT=") {
            port = Some(rest.parse().map_err(|e: std::num::ParseIntError| e.to_string())?);
            break;
        }
        eprintln!("[backend] {}", trimmed);
    }
    let port = port.ok_or("backend did not report CLIPFORGE_PORT")?;

    std::thread::spawn(move || {
        let mut line = String::new();
        loop {
            line.clear();
            match reader.read_line(&mut line) {
                Ok(0) | Err(_) => break,
                Ok(_) => {
                    eprint!("[backend] {}", line);
                }
            }
        }
    });

    Ok((child, port))
}

#[tauri::command]
fn get_backend_url(state: State<'_, AppState>) -> Result<String, String> {
    let port = state
        .port
        .lock()
        .map_err(|_| "state lock poisoned")?
        .ok_or("backend not yet ready")?;
    Ok(format!("http://127.0.0.1:{}", port))
}

#[tauri::command]
fn get_project_dir(app: AppHandle) -> Result<String, String> {
    let p = ensure_project_dir(&app)?;
    Ok(p.to_string_lossy().to_string())
}

#[tauri::command]
async fn pick_project_dir(app: AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let picked = app.dialog().file().blocking_pick_folder();
    if let Some(path) = picked {
        let s = path.to_string();
        let mut cfg = load_config(&app);
        cfg.project_dir = Some(s.clone());
        save_config(&app, &cfg)?;
        Ok(Some(s))
    } else {
        Ok(None)
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .setup(|app| {
            let handle = app.handle().clone();
            match start_backend(&handle) {
                Ok((child, port)) => {
                    let state: State<AppState> = handle.state();
                    *state.backend.lock().unwrap() = Some(child);
                    *state.port.lock().unwrap() = Some(port);
                    eprintln!("[clipforge] backend listening on port {}", port);
                }
                Err(e) => {
                    eprintln!("[clipforge] FATAL: backend failed to start: {}", e);
                    use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
                    handle
                        .dialog()
                        .message(format!(
                            "ClipForge backend failed to start:\n\n{}\n\nThe app will exit.",
                            e
                        ))
                        .kind(MessageDialogKind::Error)
                        .title("ClipForge")
                        .blocking_show();
                    std::process::exit(1);
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_backend_url,
            get_project_dir,
            pick_project_dir
        ])
        .build(tauri::generate_context!())
        .expect("failed to build tauri app")
        .run(|app, event| match event {
            RunEvent::ExitRequested { .. } | RunEvent::Exit => {
                let state: State<AppState> = app.state();
                // Take ownership of the Child out of the mutex, then drop the
                // guard, then kill — keeps lifetimes tidy for the run-event
                // closure (otherwise the State borrow outlives the guard).
                let child_opt = state
                    .backend
                    .lock()
                    .ok()
                    .and_then(|mut g| g.take());
                if let Some(mut c) = child_opt {
                    let _ = c.kill();
                    let _ = c.wait();
                }
            }
            _ => {}
        });
}
