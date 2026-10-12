//! Logbook's desktop shell (PLAN §3 M5, docs/M5.md). The window shows the same web build as the
//! browser version, built with `LOGBOOK_PLATFORM=desktop`; this side gives it a journal folder on
//! disk and a few things a web page can't do (save dialogs, opening the browser for payment).

mod folder;
mod journal_fs;

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
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

/// A file being saved: where the save dialog said, and the temporary file beside it that the
/// pieces go into until the last one puts it in place.
struct SaveTarget {
    path: PathBuf,
    tmp: PathBuf,
    file: Option<std::fs::File>,
}

#[derive(Default)]
struct PendingSave(Mutex<Option<SaveTarget>>);

impl PendingSave {
    /// Calls off a save under way: nothing is left behind.
    fn cancel(&self) {
        if let Some(target) = self.0.lock().ok().and_then(|mut t| t.take()) {
            drop(target.file);
            let _ = std::fs::remove_file(&target.tmp);
        }
    }
}

/// Asks where to save a file (a backup, an export, an attachment); None when cancelled. The page
/// then sends the file in pieces (`save_write`), or calls it off (`save_cancel`): if the journal
/// locked while the dialog was open, nothing is written. Writes go only to the place picked here.
#[tauri::command]
async fn save_pick(name: String, app: AppHandle, pending: State<'_, PendingSave>) -> Result<Option<String>, String> {
    pending.cancel();
    let mut dialog = app.dialog().file().set_file_name(&name);
    if let Ok(docs) = app.path().document_dir() {
        dialog = dialog.set_directory(docs);
    }
    let Some(picked) = dialog.blocking_save_file() else { return Ok(None) };
    let path = picked.into_path().map_err(|e| e.to_string())?;
    let file_name = path.file_name().and_then(|n| n.to_str()).unwrap_or("file");
    let tmp = path.with_file_name(format!("{file_name}.logbook-tmp-{:08x}", journal_fs::random_u32()));
    *pending.0.lock().map_err(|_| "busy".to_string())? = Some(SaveTarget { path: path.clone(), tmp, file: None });
    Ok(Some(path.display().to_string()))
}

/// The next piece of the file being saved, in order; with `x-last: 1` the file is complete and
/// moves into place. A big export never has to cross over as one block.
#[tauri::command]
async fn save_write(request: Request<'_>, pending: State<'_, PendingSave>) -> Result<(), String> {
    use std::io::Write;
    let last = header(&request, "x-last")? == "1";
    let data = body(&request)?;
    let mut slot = pending.0.lock().map_err(|_| "busy".to_string())?;
    let target = slot.as_mut().ok_or("No file is being saved.")?;
    let written = (|| -> std::io::Result<()> {
        if target.file.is_none() {
            if let Some(dir) = target.path.parent() {
                std::fs::create_dir_all(dir)?;
            }
            target.file = Some(std::fs::File::create(&target.tmp)?);
        }
        let file = target.file.as_mut().expect("opened above");
        file.write_all(data)?;
        if last {
            file.sync_all()?;
            target.file = None;
            std::fs::rename(&target.tmp, &target.path)?;
        }
        Ok(())
    })();
    match written {
        Err(e) => {
            let target = slot.take().expect("checked above");
            drop(target.file);
            let _ = std::fs::remove_file(&target.tmp);
            Err(format!("Couldn't save {}: {e}", target.path.display()))
        }
        Ok(()) => {
            if last {
                *slot = None;
            }
            Ok(())
        }
    }
}

/// Calls off the save under way.
#[tauri::command]
fn save_cancel(pending: State<'_, PendingSave>) {
    pending.cancel();
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
/// Bumped when a close is called off, so that close's timer no longer fires.
static CLOSE_ROUND: AtomicU64 = AtomicU64::new(0);

fn begin_close<R: Runtime>(window: &WebviewWindow<R>, quit: bool) {
    if quit {
        QUITTING.store(true, Ordering::SeqCst);
    }
    if CLOSING.swap(true, Ordering::SeqCst) {
        return; // already asked; the timer is running
    }
    let round = CLOSE_ROUND.load(Ordering::SeqCst);
    let _ = window.emit("logbook://save-before-close", ());
    let window = window.clone();
    std::thread::spawn(move || {
        std::thread::sleep(CLOSE_TIMEOUT);
        if CLOSE_ROUND.load(Ordering::SeqCst) == round {
            finish_close(&window);
        }
    });
}

/// Calls off a close under way: the window stays open.
fn cancel_close() {
    CLOSE_ROUND.fetch_add(1, Ordering::SeqCst);
    QUITTING.store(false, Ordering::SeqCst);
    CLOSING.store(false, Ordering::SeqCst);
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

/// The page couldn't save its last writing: stay open, so it isn't lost without a word.
#[tauri::command]
fn close_cancel() {
    if !CLOSED.load(Ordering::SeqCst) {
        cancel_close();
    }
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

/// The system print window for what the page is showing: the PDF export (D89) lays the entries out
/// for print first. A web page's own `print()` does nothing in macOS's webview, so it goes through
/// here: Windows and Linux show their print dialog, macOS its print sheet, each with "Save as PDF".
#[tauri::command]
fn print_page(window: WebviewWindow) -> Result<(), String> {
    window.print().map_err(|e| e.to_string())
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

// ── updates (M5 slice F, D88) ────────────────────────────────────────────────────────────────
//
// The updater reads `latest.json` from the newest GitHub release and accepts only files signed
// with our updater key (tauri.conf.json holds the public half). Downloading and installing are two
// steps so the page can save once more in between, with the window blocked, right before the
// install: on Windows the installer ends the app straight away, and elsewhere the app restarts.

/// An update found by the last check, kept until it's downloaded.
#[derive(Default)]
struct PendingUpdate(Mutex<Option<tauri_plugin_updater::Update>>);

/// An update downloaded and its signature checked, waiting to be installed.
#[derive(Default)]
struct DownloadedUpdate(Mutex<Option<(tauri_plugin_updater::Update, Vec<u8>)>>);

#[derive(serde::Serialize)]
struct UpdateInfo {
    version: String,
}

/// Looks for a newer version; None when this is the newest.
#[tauri::command]
async fn update_check(app: AppHandle, pending: State<'_, PendingUpdate>) -> Result<Option<UpdateInfo>, String> {
    use tauri_plugin_updater::UpdaterExt;
    let update = app.updater().map_err(|e| e.to_string())?.check().await.map_err(|e| e.to_string())?;
    let info = update.as_ref().map(|u| UpdateInfo { version: u.version.clone() });
    *pending.0.lock().map_err(|_| "busy".to_string())? = update;
    Ok(info)
}

/// Downloads the update found by `update_check` and checks its signature. Reports progress as
/// `logbook://update-progress` events: [bytes so far, total if known]. A download that fails
/// needs a fresh check: the release may have been fixed in the meantime.
#[tauri::command]
async fn update_download(app: AppHandle, pending: State<'_, PendingUpdate>, downloaded: State<'_, DownloadedUpdate>) -> Result<(), String> {
    let update = pending.0.lock().map_err(|_| "busy".to_string())?.take().ok_or("There's no update waiting.")?;
    let progress = app.clone();
    let mut received: u64 = 0;
    let bytes = update
        .download(
            move |chunk, total| {
                received += chunk as u64;
                let _ = progress.emit("logbook://update-progress", (received, total));
            },
            || {},
        )
        .await
        .map_err(|e| e.to_string())?;
    *downloaded.0.lock().map_err(|_| "busy".to_string())? = Some((update, bytes));
    Ok(())
}

/// Installs the downloaded update and starts the new version. The page has saved everything and
/// blocked the window first.
#[tauri::command]
async fn update_apply(app: AppHandle, downloaded: State<'_, DownloadedUpdate>) -> Result<(), String> {
    let (update, bytes) = downloaded.0.lock().map_err(|_| "busy".to_string())?.take().ok_or("There's no update downloaded.")?;
    update.install(&bytes).map_err(|e| e.to_string())?;
    // Windows never gets here: its installer has already ended the app and will start it again.
    // The restart goes straight through the close hold (D86): the page saved just before.
    CLOSED.store(true, Ordering::SeqCst);
    app.restart()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();
    #[cfg(desktop)]
    {
        // One window per computer: two copies writing the same folder could undo each other's saves.
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // Opened again while closing (not quitting): the person wants it, so keep the window.
            if CLOSING.load(Ordering::SeqCst) && !QUITTING.load(Ordering::SeqCst) && !CLOSED.load(Ordering::SeqCst) {
                cancel_close();
            }
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }));
    }
    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(PendingUpdate::default())
        .manage(DownloadedUpdate::default())
        .manage(PendingSave::default())
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
            save_pick,
            save_write,
            save_cancel,
            open_url,
            close_ready,
            close_cancel,
            update_check,
            update_download,
            update_apply,
            print_page,
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
