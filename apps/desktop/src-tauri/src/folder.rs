//! The journal folder (D79). It is chosen in a native folder dialog, remembered in the app's
//! config folder, and granted to the fs plugin's runtime scope at each start. Nothing else is
//! granted, so the web page can reach only a folder the user picked.
//!
//! Two commands read the folder in bulk, which the fs plugin would need a round trip per file for
//! (D83): `scan_journal` lists every file with its size and time, and `read_journal_texts` reads
//! many small files at once. Both work only inside the current folder.

use std::{
    fs, io,
    path::{Path, PathBuf},
    sync::Mutex,
    time::UNIX_EPOCH,
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_fs::FsExt;

/// Where the chosen folder is remembered, inside the app's config folder.
const REMEMBERED: &str = "journal-folder.json";
/// Opens this folder instead of the remembered one, without remembering it (tests, scripts).
const OVERRIDE_ENV: &str = "LOGBOOK_JOURNAL_FOLDER";
/// Journal text files are small; anything bigger is read as empty and reported as damaged.
const MAX_TEXT_BYTES: u64 = 16 * 1024 * 1024;
/// Files operating systems drop into folders; a folder holding only these counts as empty.
const OS_JUNK: [&str; 4] = [".DS_Store", "desktop.ini", "Thumbs.db", ".localized"];

#[derive(Default)]
pub struct JournalFolder(Mutex<Option<PathBuf>>);

#[derive(Serialize, Deserialize)]
struct Remembered {
    folder: PathBuf,
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileInfo {
    path: String,
    size: u64,
    mtime_ms: f64,
}

/// At start: the folder from `LOGBOOK_JOURNAL_FOLDER`, else the remembered one, granted to the fs
/// plugin. A remembered folder that's missing (an unplugged drive) is still set, so the page can say
/// so and offer to choose another.
pub fn restore<R: Runtime>(app: &AppHandle<R>) {
    let folder = match std::env::var_os(OVERRIDE_ENV).filter(|v| !v.is_empty()) {
        Some(dir) => {
            let dir = PathBuf::from(dir);
            if let Err(err) = fs::create_dir_all(&dir) {
                log_error("creating LOGBOOK_JOURNAL_FOLDER", &err);
            }
            Some(dir)
        }
        None => remembered(app),
    };
    if let Some(folder) = folder {
        if let Err(err) = app.fs_scope().allow_directory(&folder, true) {
            log_error("granting the journal folder", &err);
        }
        *app.state::<JournalFolder>().0.lock().unwrap() = Some(folder);
    }
}

#[tauri::command]
pub fn journal_folder(state: State<'_, JournalFolder>) -> Option<String> {
    state.0.lock().unwrap().as_ref().map(|p| p.to_string_lossy().into_owned())
}

/// Shows the folder dialog. Returns the journal folder, which is the chosen one or a `Logbook`
/// folder made inside it (see `journal_root`), or `None` if the dialog was cancelled.
#[tauri::command]
pub async fn choose_journal_folder<R: Runtime>(app: AppHandle<R>, state: State<'_, JournalFolder>) -> Result<Option<String>, String> {
    let Some(picked) = app.dialog().file().set_title("Choose a folder for your Logbook journal").blocking_pick_folder() else {
        return Ok(None);
    };
    let picked = picked.into_path().map_err(|e| e.to_string())?;
    let root = journal_root(&picked).map_err(|e| e.to_string())?;
    app.fs_scope().allow_directory(&root, true).map_err(|e| e.to_string())?;
    remember(&app, &root).map_err(|e| format!("Logbook couldn't remember the folder: {e}"))?;
    *state.0.lock().unwrap() = Some(root.clone());
    Ok(Some(root.to_string_lossy().into_owned()))
}

#[tauri::command]
pub async fn scan_journal(state: State<'_, JournalFolder>) -> Result<Vec<FileInfo>, String> {
    let root = current(&state)?;
    tauri::async_runtime::spawn_blocking(move || scan(&root))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn read_journal_texts(state: State<'_, JournalFolder>, paths: Vec<String>) -> Result<Vec<Option<String>>, String> {
    let root = current(&state)?;
    tauri::async_runtime::spawn_blocking(move || paths.iter().map(|p| read_text(&root, p)).collect::<io::Result<Vec<_>>>())
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

fn current(state: &State<'_, JournalFolder>) -> Result<PathBuf, String> {
    state.0.lock().unwrap().clone().ok_or_else(|| "No journal folder has been chosen.".into())
}

/// The folder to keep the journal in, given the one the user picked: the picked folder if it
/// already holds a journal or is empty, otherwise a `Logbook` folder inside it, so that picking
/// "Documents" doesn't scatter journal files through Documents.
pub fn journal_root(picked: &Path) -> io::Result<PathBuf> {
    if picked.join("logbook.json").is_file() || is_empty(picked)? {
        return Ok(picked.to_path_buf());
    }
    let inner = picked.join("Logbook");
    if inner.join("logbook.json").is_file() {
        return Ok(inner);
    }
    if inner.exists() && !is_empty(&inner)? {
        return Err(io::Error::new(
            io::ErrorKind::AlreadyExists,
            "That folder already has a “Logbook” folder with other files in it. Choose an empty folder or an existing journal.",
        ));
    }
    fs::create_dir_all(&inner)?;
    Ok(inner)
}

fn is_empty(dir: &Path) -> io::Result<bool> {
    for entry in fs::read_dir(dir)? {
        if !OS_JUNK.contains(&entry?.file_name().to_string_lossy().as_ref()) {
            return Ok(false);
        }
    }
    Ok(true)
}

/// Every file under `root` with its path relative to it (always `/`), size and modification time.
/// Symbolic links aren't followed, so nothing outside the folder is listed.
pub fn scan(root: &Path) -> io::Result<Vec<FileInfo>> {
    let mut out = Vec::new();
    let mut pending = vec![PathBuf::new()];
    while let Some(rel) = pending.pop() {
        let entries = match fs::read_dir(root.join(&rel)) {
            Ok(entries) => entries,
            // A subfolder removed while scanning (a sync service at work) isn't an error.
            Err(err) if err.kind() == io::ErrorKind::NotFound && !rel.as_os_str().is_empty() => continue,
            Err(err) => return Err(err),
        };
        for entry in entries {
            let entry = entry?;
            let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
                continue; // not UTF-8, so not a name Logbook writes
            };
            let child = rel.join(&name);
            let kind = entry.file_type()?;
            if kind.is_dir() {
                pending.push(child);
            } else if kind.is_file() {
                let Ok(meta) = entry.metadata() else { continue };
                let mtime_ms = meta.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map_or(0.0, |d| d.as_secs_f64() * 1000.0);
                out.push(FileInfo { path: slash_path(&child), size: meta.len(), mtime_ms });
            }
        }
    }
    Ok(out)
}

fn read_text(root: &Path, rel: &str) -> io::Result<Option<String>> {
    let path = inside(root, rel).ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, format!("not a path inside the journal: {rel}")))?;
    match fs::metadata(&path) {
        Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(err) => Err(err),
        Ok(meta) if meta.len() > MAX_TEXT_BYTES => Ok(Some(String::new())),
        Ok(_) => match fs::read(&path) {
            Ok(bytes) => Ok(Some(String::from_utf8_lossy(&bytes).into_owned())),
            Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(None),
            Err(err) => Err(err),
        },
    }
}

/// `root` joined with a `/`-separated relative path, or `None` if any part could climb out of it
/// or name something else (`..`, `.`, empty, a drive or a Windows separator).
pub fn inside(root: &Path, rel: &str) -> Option<PathBuf> {
    let mut path = root.to_path_buf();
    for part in rel.split('/') {
        if part.is_empty() || part == "." || part == ".." || part.contains(['\\', ':', '\0']) {
            return None;
        }
        path.push(part);
    }
    Some(path)
}

fn slash_path(rel: &Path) -> String {
    rel.components().map(|c| c.as_os_str().to_string_lossy()).collect::<Vec<_>>().join("/")
}

fn remembered<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    let file = app.path().app_config_dir().ok()?.join(REMEMBERED);
    let raw = fs::read_to_string(file).ok()?;
    serde_json::from_str::<Remembered>(&raw).ok().map(|r| r.folder)
}

fn remember<R: Runtime>(app: &AppHandle<R>, folder: &Path) -> io::Result<()> {
    let dir = app.path().app_config_dir().map_err(|e| io::Error::other(e.to_string()))?;
    fs::create_dir_all(&dir)?;
    let json = serde_json::to_string_pretty(&Remembered { folder: folder.to_path_buf() })?;
    fs::write(dir.join(REMEMBERED), json)
}

fn log_error(what: &str, err: &dyn std::fmt::Display) {
    eprintln!("Logbook: {what} failed: {err}");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp() -> tempfile::TempDir {
        tempfile::tempdir().unwrap()
    }

    #[test]
    fn uses_an_empty_folder_or_an_existing_journal_as_it_is() {
        let empty = temp();
        fs::write(empty.path().join(".DS_Store"), "").unwrap();
        assert_eq!(journal_root(empty.path()).unwrap(), empty.path());

        let journal = temp();
        fs::write(journal.path().join("logbook.json"), "{}").unwrap();
        fs::write(journal.path().join("notes.txt"), "mine").unwrap();
        assert_eq!(journal_root(journal.path()).unwrap(), journal.path());
    }

    #[test]
    fn makes_a_logbook_folder_inside_a_busy_folder() {
        let documents = temp();
        fs::write(documents.path().join("tax.pdf"), "x").unwrap();
        let root = journal_root(documents.path()).unwrap();
        assert_eq!(root, documents.path().join("Logbook"));
        assert!(root.is_dir());
        // Picking Documents again opens the same journal.
        fs::write(root.join("logbook.json"), "{}").unwrap();
        assert_eq!(journal_root(documents.path()).unwrap(), root);
    }

    #[test]
    fn refuses_a_logbook_folder_that_holds_something_else() {
        let documents = temp();
        fs::write(documents.path().join("tax.pdf"), "x").unwrap();
        fs::create_dir(documents.path().join("Logbook")).unwrap();
        fs::write(documents.path().join("Logbook").join("ship-log.txt"), "x").unwrap();
        assert_eq!(journal_root(documents.path()).unwrap_err().kind(), io::ErrorKind::AlreadyExists);
    }

    #[test]
    fn scans_files_with_relative_slash_paths() {
        let dir = temp();
        fs::create_dir_all(dir.path().join("entries/2026")).unwrap();
        fs::write(dir.path().join("logbook.json"), "{}").unwrap();
        fs::write(dir.path().join("entries/2026/a.json"), "12345").unwrap();
        let mut files = scan(dir.path()).unwrap();
        files.sort_by(|a, b| a.path.cmp(&b.path));
        assert_eq!(files.iter().map(|f| (f.path.as_str(), f.size)).collect::<Vec<_>>(), [("entries/2026/a.json", 5), ("logbook.json", 2)]);
        assert!(files.iter().all(|f| f.mtime_ms > 1.6e12));
    }

    #[cfg(unix)]
    #[test]
    fn does_not_follow_symbolic_links_out_of_the_folder() {
        let outside = temp();
        fs::write(outside.path().join("secret.json"), "{}").unwrap();
        let dir = temp();
        std::os::unix::fs::symlink(outside.path(), dir.path().join("entries")).unwrap();
        std::os::unix::fs::symlink(outside.path().join("secret.json"), dir.path().join("logbook.json")).unwrap();
        assert_eq!(scan(dir.path()).unwrap(), []);
    }

    #[test]
    fn reads_texts_only_inside_the_folder() {
        let dir = temp();
        fs::write(dir.path().join("logbook.json"), "{\"format\":\"logbook\"}").unwrap();
        assert_eq!(read_text(dir.path(), "logbook.json").unwrap().as_deref(), Some("{\"format\":\"logbook\"}"));
        assert_eq!(read_text(dir.path(), "missing.json").unwrap(), None);
        for bad in ["../x.json", "entries/../../x.json", "/etc/passwd", "a//b", "./logbook.json", "C:\\x", "entries\\..\\x"] {
            assert!(read_text(dir.path(), bad).is_err(), "{bad} should be refused");
        }
    }
}
