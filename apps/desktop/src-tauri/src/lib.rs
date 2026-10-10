//! Logbook's desktop shell (PLAN §3 M5, docs/M5.md). The window shows the same web build as the
//! browser version, built with `LOGBOOK_PLATFORM=desktop`; this side gives it a journal folder on
//! disk and a few things a web page can't do (save dialogs, opening the browser for payment).

mod folder;
mod journal_fs;

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Manager, Runtime, State, WebviewWindow, WindowEvent};
use tauri_plugin_dialog::DialogExt;

struct AppState {
    config_file: PathBuf,
    /// The open journal folder; None until one is chosen.
    root: Mutex<Option<PathBuf>>,
    /// A remembered folder that wasn't there at startup (an unplugged drive, a moved folder).
    missing: Option<PathBuf>,
}

#[derive(serde::Serialize)]
struct FolderStatus {
    folder: Option<String>,
    missing: Option<String>,
}

impl AppState {
    fn root(&self) -> Result<PathBuf, String> {
        self.root.lock().map_err(|_| "busy".to_string())?.clone().ok_or_else(|| "No journal folder is open.".to_string())
    }
}

/// Paths and file names travel in headers, percent-encoded by `encodeURIComponent`.
fn header(request: &Request<'_>, name: &str) -> Result<String, String> {
    let raw = request.headers().get(name).and_then(|v| v.to_str().ok()).ok_or_else(|| format!("missing {name}"))?;
    percent_decode(raw).ok_or_else(|| format!("bad {name}"))
}

fn percent_decode(s: &str) -> Option<String> {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = s.get(i + 1..i + 3)?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

/// The request's raw bytes, borrowed: a backup can be gigabytes, so it isn't copied again here.
fn body<'a>(request: &'a Request<'_>) -> Result<&'a [u8], String> {
    match request.body() {
        InvokeBody::Raw(data) => Ok(data),
        InvokeBody::Json(_) => Err("expected raw bytes".into()),
    }
}

// ── the journal folder ───────────────────────────────────────────────────────────────────────

/// The open journal folder, and a remembered one that has gone missing.
#[tauri::command]
fn journal_folder(state: State<'_, AppState>) -> FolderStatus {
    let folder = state.root.lock().ok().and_then(|r| r.as_ref().map(|p| p.display().to_string()));
    FolderStatus { folder, missing: state.missing.as_ref().map(|p| p.display().to_string()) }
}

/// Where a new journal goes by default: `Documents/Logbook`.
#[tauri::command]
fn default_journal_folder(app: AppHandle) -> Result<String, String> {
    let docs = app.path().document_dir().or_else(|_| app.path().home_dir()).map_err(|e| e.to_string())?;
    Ok(docs.join("Logbook").display().to_string())
}

/// Shows the system's folder picker; None when cancelled.
#[tauri::command]
async fn pick_folder(app: AppHandle) -> Option<String> {
    let picked = app.dialog().file().set_title("Choose where to keep your journal").blocking_pick_folder()?;
    picked.into_path().ok().map(|p| p.display().to_string())
}

/// Opens (or starts) the journal in `path` and remembers it. Returns the folder actually used,
/// which is a `Logbook` folder inside `path` when `path` holds other files.
#[tauri::command]
async fn use_journal_folder(path: String, state: State<'_, AppState>) -> Result<String, String> {
    let folder = folder::journal_folder_for(&PathBuf::from(path))?;
    folder::prepare(&folder)?;
    let mut config = folder::load(&state.config_file);
    config.journal_folder = Some(folder.clone());
    folder::save(&state.config_file, &config)?;
    *state.root.lock().map_err(|_| "busy".to_string())? = Some(folder.clone());
    Ok(folder.display().to_string())
}

/// Shows the journal folder in Explorer, Finder or the file manager.
#[tauri::command]
fn reveal_journal_folder(state: State<'_, AppState>) -> Result<(), String> {
    tauri_plugin_opener::open_path(state.root()?, None::<&str>).map_err(|e| e.to_string())
}

// ── files inside it (packages/storage-fs/src/tauri.ts) ───────────────────────────────────────

#[tauri::command]
async fn journal_read(path: String, state: State<'_, AppState>) -> Result<Response, String> {
    let root = state.root()?;
    // A read may wait for iCloud to bring a file back: keep it off the async workers.
    let data = tauri::async_runtime::spawn_blocking(move || journal_fs::read(&root, &path)).await.map_err(|e| e.to_string())??;
    match data {
        Some(data) => Ok(Response::new(data)),
        None => Err("ENOENT".into()),
    }
}

#[tauri::command]
async fn journal_write(request: Request<'_>, state: State<'_, AppState>) -> Result<(), String> {
    journal_fs::write(&state.root()?, &header(&request, "x-path")?, body(&request)?)
}

#[tauri::command]
async fn journal_rename(from: String, to: String, state: State<'_, AppState>) -> Result<(), String> {
    journal_fs::rename(&state.root()?, &from, &to)
}

#[tauri::command]
async fn journal_remove(path: String, state: State<'_, AppState>) -> Result<(), String> {
    journal_fs::remove(&state.root()?, &path)
}

#[tauri::command]
async fn journal_list(dir: String, state: State<'_, AppState>) -> Result<Vec<String>, String> {
    journal_fs::list(&state.root()?, &dir)
}

// ── things a web page can't do ───────────────────────────────────────────────────────────────

/// Asks where to save a file (a backup, an attachment) and writes it. None when cancelled.
#[tauri::command]
async fn save_file(request: Request<'_>, app: AppHandle) -> Result<Option<String>, String> {
    let name = header(&request, "x-name")?;
    let data = body(&request)?;
    let mut dialog = app.dialog().file().set_file_name(&name);
    if let Ok(docs) = app.path().document_dir() {
        dialog = dialog.set_directory(docs);
    }
    let Some(picked) = dialog.blocking_save_file() else { return Ok(None) };
    let path = picked.into_path().map_err(|e| e.to_string())?;
    journal_fs::write_atomic(&path, data).map_err(|e| format!("Couldn't save {}: {e}", path.display()))?;
    Ok(Some(path.display().to_string()))
}

// ── closing and quitting (D86) ───────────────────────────────────────────────────────────────
//
// The editor saves 0.7 s after the last key, and a closed window can't finish a save. So a close
// (the close button, ⌘W, Alt+F4) or a quit (the app's Quit item, ⌘Q) is held here: the page is
// asked to save, and the window closes when it answers (`close_ready`) or after CLOSE_TIMEOUT,
// whichever is first. The timeout lives here, not in the page, so a page that reloaded onto another
// screen, or crashed, can't keep the window open.

const CLOSE_TIMEOUT: Duration = Duration::from_secs(4);
/// A close or quit is under way: the page has been asked to save.
static CLOSING: AtomicBool = AtomicBool::new(false);
/// The app quits, rather than only the window closing, when the close finishes.
static QUITTING: AtomicBool = AtomicBool::new(false);
/// The close has been carried out; any later request goes straight through.
static CLOSED: AtomicBool = AtomicBool::new(false);

fn begin_close<R: Runtime>(window: &WebviewWindow<R>, quit: bool) {
    if quit {
        QUITTING.store(true, Ordering::SeqCst);
    }
    if CLOSING.swap(true, Ordering::SeqCst) {
        return; // already asked; the timer is running
    }
    let _ = window.emit("logbook://save-before-close", ());
    let window = window.clone();
    std::thread::spawn(move || {
        std::thread::sleep(CLOSE_TIMEOUT);
        finish_close(&window);
    });
}

fn finish_close<R: Runtime>(window: &WebviewWindow<R>) {
    if CLOSED.swap(true, Ordering::SeqCst) {
        return;
    }
    if QUITTING.load(Ordering::SeqCst) {
        window.app_handle().exit(0);
    } else {
        let _ = window.destroy();
    }
}

/// The page has saved what it was writing: close now.
#[tauri::command]
fn close_ready(window: WebviewWindow) {
    finish_close(&window);
}

/// The macOS menu bar: Tauri's usual one, except that Quit goes through `begin_close`. The stock
/// Quit item ends the app at once (it never reaches Tauri's exit hook), losing the last edit.
/// Logging out or shutting down with Logbook open still ends it without that chance.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn mac_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let quit = MenuItem::with_id(app, "quit", "Quit Logbook", true, Some("CmdOrCtrl+Q"))?;
    let app_menu = Submenu::with_items(
        app,
        "Logbook",
        true,
        &[
            &PredefinedMenuItem::about(app, None, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::services(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::show_all(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;
    // Without an Edit menu, ⌘C, ⌘V and ⌘Z don't reach text fields on macOS.
    let edit = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;
    let window = Submenu::with_items(
        app,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, None)?,
            &PredefinedMenuItem::fullscreen(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, None)?,
        ],
    )?;
    Menu::with_items(app, &[&app_menu, &edit, &window])
}

/// Opens a web address in the default browser: links in entries, and Stripe's payment page.
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    let lower = url.to_ascii_lowercase();
    if !(lower.starts_with("https://") || lower.starts_with("http://") || lower.starts_with("mailto:")) {
        return Err("Only web and email links can be opened.".into());
    }
    tauri_plugin_opener::open_url(url, None::<&str>).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();
    #[cfg(desktop)]
    {
        // One window per computer: two copies writing the same folder could undo each other's saves.
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }));
    }
    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let config_file = app.path().app_config_dir()?.join("config.json");
            let config = folder::load(&config_file);
            // A remembered folder that's gone (an unplugged drive) is offered again on the first-run
            // screen rather than silently started afresh somewhere else.
            let (root, missing) = match config.journal_folder {
                Some(p) if p.is_dir() => (Some(p), None),
                other => (None, other),
            };
            app.manage(AppState { config_file, root: Mutex::new(root), missing });
            #[cfg(target_os = "macos")]
            app.set_menu(mac_menu(app.handle())?)?;
            Ok(())
        })
        .on_menu_event(|app, event| {
            if event.id().as_ref() == "quit" {
                match app.get_webview_window("main") {
                    Some(window) => begin_close(&window, true),
                    None => app.exit(0),
                }
            }
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if !CLOSED.load(Ordering::SeqCst) {
                    api.prevent_close();
                    if let Some(webview) = window.app_handle().get_webview_window(window.label()) {
                        begin_close(&webview, false);
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            journal_folder,
            default_journal_folder,
            pick_folder,
            use_journal_folder,
            reveal_journal_folder,
            journal_read,
            journal_write,
            journal_rename,
            journal_remove,
            journal_list,
            save_file,
            open_url,
            close_ready,
        ])
        .run(tauri::generate_context!())
        .expect("Logbook couldn't start");
}

#[cfg(test)]
mod tests {
    #[test]
    fn decodes_percent_encoded_headers() {
        assert_eq!(super::percent_decode("entries%2F2026%2Fa%20b.json").as_deref(), Some("entries/2026/a b.json"));
        assert_eq!(super::percent_decode("caf%C3%A9").as_deref(), Some("café"));
        assert_eq!(super::percent_decode("bad%2"), None);
    }
}
