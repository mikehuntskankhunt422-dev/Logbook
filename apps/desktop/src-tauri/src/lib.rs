//! Logbook's desktop shell (PLAN §3 M5, docs/M5.md). The window shows the same web build as the
//! browser version, built with `LOGBOOK_PLATFORM=desktop`; this side gives it a journal folder on
//! disk and a few things a web page can't do (save dialogs, opening the browser for payment).

#[cfg(target_os = "android")]
mod android;
mod clock;
mod folder;
mod journal_fs;
#[cfg(desktop)]
mod updates;

use std::borrow::Cow;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::ipc::{InvokeBody, Request, Response};
#[cfg(desktop)]
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Manager, Runtime, State, WebviewWindow, WindowEvent};
use tauri_plugin_dialog::DialogExt;

struct AppState {
    #[cfg_attr(mobile, allow(dead_code))]
    config_file: PathBuf,
    /// The open journal folder; None until one is chosen.
    root: Mutex<Option<PathBuf>>,
    /// A remembered folder that wasn't there at startup (an unplugged drive, a moved folder).
    missing: Option<PathBuf>,
    /// On Android, why the journal's folder inside the app couldn't be made (D90).
    problem: Option<String>,
}

#[derive(serde::Serialize)]
struct FolderStatus {
    folder: Option<String>,
    missing: Option<String>,
    problem: Option<String>,
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

/// The request's bytes. The desktop's webviews send them raw, borrowed here (a backup can be
/// gigabytes, so it isn't copied again). Android's can only send text, so there they come as
/// base64 in `{ "data": "…" }`, a few megabytes at a time (D90).
fn body<'a>(request: &'a Request<'_>) -> Result<Cow<'a, [u8]>, String> {
    use base64::Engine;
    match request.body() {
        InvokeBody::Raw(data) => Ok(Cow::Borrowed(data)),
        InvokeBody::Json(json) => {
            let text = json.get("data").and_then(|d| d.as_str()).ok_or("expected bytes")?;
            base64::engine::general_purpose::STANDARD.decode(text).map(Cow::Owned).map_err(|e| format!("bad bytes: {e}"))
        }
    }
}

// ── the journal folder ───────────────────────────────────────────────────────────────────────

/// The open journal folder, and a remembered one that has gone missing.
#[tauri::command]
fn journal_folder(state: State<'_, AppState>) -> FolderStatus {
    let folder = state.root.lock().ok().and_then(|r| r.as_ref().map(|p| p.display().to_string()));
    FolderStatus { folder, missing: state.missing.as_ref().map(|p| p.display().to_string()), problem: state.problem.clone() }
}

/// Where a new journal goes by default: `Documents/Logbook`.
#[cfg(desktop)]
#[tauri::command]
fn default_journal_folder(app: AppHandle) -> Result<String, String> {
    let docs = app.path().document_dir().or_else(|_| app.path().home_dir()).map_err(|e| e.to_string())?;
    Ok(docs.join("Logbook").display().to_string())
}

/// Shows the system's folder picker; None when cancelled.
#[cfg(desktop)]
#[tauri::command]
async fn pick_folder(app: AppHandle) -> Option<String> {
    let picked = app.dialog().file().set_title("Choose where to keep your journal").blocking_pick_folder()?;
    picked.into_path().ok().map(|p| p.display().to_string())
}

/// Opens (or starts) the journal in `path` and remembers it. Returns the folder actually used,
/// which is a `Logbook` folder inside `path` when `path` holds other files.
#[cfg(desktop)]
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
#[cfg(desktop)]
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

/// Writes a file whole, or, with `x-write` (the write's id) and `x-part` (`first`, `more`, `last`),
/// a piece of one: Android sends big files that way (D90).
#[tauri::command]
async fn journal_write(request: Request<'_>, state: State<'_, AppState>, pieces: State<'_, journal_fs::Pieces>) -> Result<(), String> {
    let (root, path, data) = (state.root()?, header(&request, "x-path")?, body(&request)?);
    match request.headers().get("x-part") {
        None => journal_fs::write(&root, &path, &data),
        Some(_) => {
            let part = journal_fs::Part::parse(&header(&request, "x-part")?).ok_or("bad x-part")?;
            pieces.write(&root, &path, &header(&request, "x-write")?, part, &data)
        }
    }
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

/// Where a file being saved goes.
enum SaveDest {
    /// On the desktop: the path picked, and the temporary file beside it that the pieces go into
    /// until the last one puts it in place.
    #[cfg_attr(target_os = "android", allow(dead_code))]
    File { path: PathBuf, tmp: PathBuf },
    /// On Android: the document the save dialog gave (a content:// address, D90), written
    /// directly, since there's no folder beside it for a temporary file. `name` is what it's
    /// called; `existed` when the person picked a file that already had content, to replace;
    /// `id` once it's open, until the provider is told it's complete.
    #[cfg_attr(not(target_os = "android"), allow(dead_code))]
    Document { uri: String, name: String, existed: bool, id: Option<i32> },
}

struct SaveTarget {
    dest: SaveDest,
    file: Option<std::fs::File>,
}

impl SaveTarget {
    /// Where the file went, for the page to say.
    fn shown(&self) -> String {
        match &self.dest {
            SaveDest::File { path, .. } => path.display().to_string(),
            SaveDest::Document { name, .. } => name.clone(),
        }
    }

    /// Opens what the pieces are written into.
    fn open(&mut self, _app: &AppHandle) -> Result<std::fs::File, String> {
        match &mut self.dest {
            SaveDest::File { path, tmp } => (|| {
                if let Some(dir) = path.parent() {
                    std::fs::create_dir_all(dir)?;
                }
                std::fs::File::create(tmp)
            })()
            .map_err(|e| e.to_string()),
            #[cfg(target_os = "android")]
            SaveDest::Document { uri, id, .. } => {
                let (file, opened) = android::open_for_writing(_app, uri)?;
                *id = Some(opened);
                Ok(file)
            }
            #[cfg(not(target_os = "android"))]
            SaveDest::Document { .. } => unreachable!("only Android's save dialog gives documents"),
        }
    }

    /// After the last piece: the file is complete and in place.
    fn finish(&mut self, _app: &AppHandle) -> Result<(), String> {
        let Some(file) = self.file.take() else { return Ok(()) };
        match &mut self.dest {
            SaveDest::File { path, tmp } => (|| {
                file.sync_all()?;
                drop(file);
                std::fs::rename(&*tmp, &*path)
            })()
            .map_err(|e| e.to_string()),
            SaveDest::Document { id, .. } => {
                // Cloud storage may hand over a pipe, which can't be synced.
                let _ = file.sync_all();
                drop(file);
                // Now the provider may take it (Google Drive uploads it).
                #[cfg(target_os = "android")]
                if let Some(opened) = id.take() {
                    android::close_document(_app, opened, true)?;
                }
                let _ = id;
                Ok(())
            }
        }
    }

    /// Calls the save off. On the desktop nothing is left behind. On Android a document the
    /// dialog created is deleted (a provider that can't delete keeps it empty), and so is one
    /// picked to be replaced once writing has started, as its old content is gone by then; one
    /// picked to be replaced but not yet opened is left as it was.
    fn discard(self, _app: &AppHandle) {
        drop(self.file);
        match self.dest {
            SaveDest::File { tmp, .. } => {
                let _ = std::fs::remove_file(tmp);
            }
            #[cfg(target_os = "android")]
            SaveDest::Document { uri, existed, id, .. } => {
                if let Some(opened) = id {
                    let _ = android::close_document(_app, opened, false);
                }
                if !existed || id.is_some() {
                    android::delete_document(_app, &uri);
                }
            }
            #[cfg(not(target_os = "android"))]
            SaveDest::Document { .. } => {}
        }
    }
}

/// Where the save dialog's answer says to save.
#[cfg(not(target_os = "android"))]
fn save_target(_app: &AppHandle, picked: tauri_plugin_dialog::FilePath, _name: &str) -> Result<SaveTarget, String> {
    let path = picked.into_path().map_err(|e| e.to_string())?;
    let file_name = path.file_name().and_then(|n| n.to_str()).unwrap_or("file");
    let tmp = path.with_file_name(format!("{file_name}.logbook-tmp-{:08x}", journal_fs::random_u32()));
    Ok(SaveTarget { dest: SaveDest::File { path, tmp }, file: None })
}

/// Android's save dialog has created the document, or the person picked one to replace (D90).
#[cfg(target_os = "android")]
fn save_target(app: &AppHandle, picked: tauri_plugin_dialog::FilePath, name: &str) -> Result<SaveTarget, String> {
    let tauri_plugin_dialog::FilePath::Url(url) = picked else { return Err("Android's save dialog didn't say where to save.".into()) };
    let uri = url.to_string();
    let (shown, size) = android::describe(app, &uri);
    let dest = SaveDest::Document { uri, name: shown.unwrap_or_else(|| name.to_string()), existed: size.is_some_and(|s| s > 0), id: None };
    Ok(SaveTarget { dest, file: None })
}

#[derive(Default)]
struct PendingSave(Mutex<Option<SaveTarget>>);

impl PendingSave {
    /// Calls off a save under way: nothing is left behind.
    fn cancel(&self, app: &AppHandle) {
        let target = self.0.lock().ok().and_then(|mut t| t.take());
        if let Some(target) = target {
            target.discard(app);
        }
    }
}

/// Asks where to save a file (a backup, an export, an attachment); None when cancelled. The page
/// then sends the file in pieces (`save_write`), or calls it off (`save_cancel`): if the journal
/// locked while the dialog was open, nothing is written. Writes go only to the place picked here.
/// Answers where the file goes: its path, or on Android its name.
#[tauri::command]
async fn save_pick(name: String, app: AppHandle, pending: State<'_, PendingSave>) -> Result<Option<String>, String> {
    pending.cancel(&app);
    let mut dialog = app.dialog().file().set_file_name(&name);
    if let Ok(docs) = app.path().document_dir() {
        dialog = dialog.set_directory(docs);
    }
    let Some(picked) = dialog.blocking_save_file() else { return Ok(None) };
    let target = save_target(&app, picked, &name)?;
    let shown = target.shown();
    *pending.0.lock().map_err(|_| "busy".to_string())? = Some(target);
    Ok(Some(shown))
}

/// The next piece of the file being saved, in order; with `x-last: 1` the file is complete and
/// moves into place. A big export never has to cross over as one block.
#[tauri::command]
async fn save_write(request: Request<'_>, app: AppHandle, pending: State<'_, PendingSave>) -> Result<(), String> {
    use std::io::Write;
    let last = header(&request, "x-last")? == "1";
    let data = body(&request)?;
    let mut slot = pending.0.lock().map_err(|_| "busy".to_string())?;
    let target = slot.as_mut().ok_or("No file is being saved.")?;
    let written = (|| -> Result<(), String> {
        if target.file.is_none() {
            target.file = Some(target.open(&app)?);
        }
        target.file.as_mut().expect("opened above").write_all(&data).map_err(|e| e.to_string())?;
        if last {
            target.finish(&app)?;
        }
        Ok(())
    })();
    match written {
        Err(e) => {
            let target = slot.take().expect("checked above");
            drop(slot);
            let shown = target.shown();
            target.discard(&app);
            Err(format!("Couldn't save {shown}: {e}"))
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
async fn save_cancel(app: AppHandle, pending: State<'_, PendingSave>) -> Result<(), String> {
    pending.cancel(&app);
    Ok(())
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
#[cfg(desktop)]
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
#[cfg(desktop)]
#[tauri::command]
fn print_page(window: WebviewWindow) -> Result<(), String> {
    window.print().map_err(|e| e.to_string())
}

/// Android's print screen, with "Save as PDF" (D90): Android's webview has no print of its own.
#[cfg(target_os = "android")]
#[tauri::command]
async fn print_page(app: AppHandle) -> Result<(), String> {
    android::print(&app)
}

/// Opens a web address in the default browser: links in entries and the app's own links.
#[tauri::command]
async fn open_url(url: String, app: AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let lower = url.to_ascii_lowercase();
    if !(lower.starts_with("https://") || lower.starts_with("http://") || lower.starts_with("mailto:")) {
        return Err("Only web and email links can be opened.".into());
    }
    // Through the plugin rather than its `open_url` function, which can't reach Android's browser.
    app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())
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
    // The page's commands: the journal folder's files, saving, links and printing everywhere; on
    // the desktop also choosing the folder, closing and updates.
    #[cfg(desktop)]
    let handler: fn(tauri::ipc::Invoke) -> bool = tauri::generate_handler![
        journal_folder,
        journal_read,
        journal_write,
        journal_rename,
        journal_remove,
        journal_list,
        save_pick,
        save_write,
        save_cancel,
        open_url,
        print_page,
        default_journal_folder,
        pick_folder,
        use_journal_folder,
        reveal_journal_folder,
        close_ready,
        close_cancel,
        updates::update_check,
        updates::update_download,
        updates::update_apply,
        clock::clock_schedule,
        clock::clock_permission,
    ];
    #[cfg(mobile)]
    let handler: fn(tauri::ipc::Invoke) -> bool = tauri::generate_handler![
        journal_folder,
        journal_read,
        journal_write,
        journal_rename,
        journal_remove,
        journal_list,
        save_pick,
        save_write,
        save_cancel,
        open_url,
        print_page,
        close_ready,
        close_cancel,
        clock::clock_schedule,
        clock::clock_permission,
    ];
    #[cfg(desktop)]
    {
        builder = builder
            .on_menu_event(|app, event| {
                if event.id().as_ref() == "quit" {
                    match app.get_webview_window("main") {
                        Some(window) => begin_close(&window, true),
                        None => app.exit(0),
                    }
                }
            })
            .plugin(tauri_plugin_updater::Builder::new().build())
            .manage(updates::PendingUpdate::default())
            .manage(updates::DownloadedUpdate::default())
            .manage(clock::Watcher::default());
    }
    #[cfg(target_os = "android")]
    {
        builder = builder.plugin(android::init());
    }
    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        // Links go through `open_url` (the page routes them, src/desktop/bridge.ts), not the
        // plugin's own script, which the window isn't allowed to use.
        .plugin(tauri_plugin_opener::Builder::new().open_js_links_on_click(false).build())
        .manage(PendingSave::default())
        .manage(journal_fs::Pieces::default())
        .setup(|app| {
            let config_file = app.path().app_config_dir()?.join("config.json");
            #[cfg(desktop)]
            {
                let config = folder::load(&config_file);
                // A remembered folder that's gone (an unplugged drive) is offered again on the
                // first-run screen rather than silently started afresh somewhere else.
                let (root, missing) = match config.journal_folder {
                    Some(p) if p.is_dir() => (Some(p), None),
                    other => (None, other),
                };
                app.manage(AppState { config_file, root: Mutex::new(root), missing, problem: None });
            }
            // Phones have no folder to choose (D90): the journal is a folder inside the app's own
            // storage, which only Logbook can read, and which goes when Logbook is uninstalled.
            #[cfg(mobile)]
            {
                let journal = app.path().app_data_dir().map_err(|e| e.to_string()).map(|d| d.join("journal"));
                let (root, problem) = match journal.and_then(|d| folder::prepare(&d).map(|()| d)) {
                    Ok(dir) => {
                        journal_fs::remove_unfinished_writes(&dir);
                        (Some(dir), None)
                    }
                    Err(e) => (None, Some(e)),
                };
                app.manage(AppState { config_file, root: Mutex::new(root), missing: None, problem });
            }
            #[cfg(target_os = "macos")]
            app.set_menu(mac_menu(app.handle())?)?;
            Ok(())
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
        .invoke_handler(handler)
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
