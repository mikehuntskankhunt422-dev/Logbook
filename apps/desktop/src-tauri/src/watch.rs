//! Watching the journal folder (M5 slice D, D102): another computer's changes arriving through
//! OneDrive, Dropbox or iCloud Drive, a sync tool's conflict copies, files put back by hand. The
//! page is told which files changed once they've settled, and reads the folder again. Logbook's own
//! writes, its temporary files and the clutter systems leave in folders aren't news.

use crate::{folder, journal_fs, AppState};
use notify::event::ModifyKind;
use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::{BTreeSet, HashMap};
use std::path::{Path, PathBuf};
use std::sync::{mpsc, Mutex};
use std::time::{Duration, Instant, SystemTime};
use tauri::{AppHandle, Emitter, State};

/// Changes are told once the folder has been quiet this long: a sync tool writes a file in steps.
const SETTLE: Duration = Duration::from_millis(600);
/// But never later than this after the first, while a big sync goes on and on.
const AT_MOST: Duration = Duration::from_secs(3);
/// Stands for "anything may have changed": the system's queue of changes overflowed.
const EVERYTHING: &str = "*";

#[derive(Default)]
pub struct FolderWatch(Mutex<Option<(PathBuf, RecommendedWatcher)>>);

#[derive(Clone, serde::Serialize)]
struct Changed {
    paths: Vec<String>,
}

/// A file's size and modification time when last heard of.
type Stamp = (SystemTime, u64);

/// Starts watching the open journal folder (again: a watch on a folder that went away and came back
/// is dead), replacing any watch before; the page calls it once the journal is open. Changes arrive
/// as `logbook://journal-changed` events. Off the main thread: a recursive watch walks the folder.
#[tauri::command]
pub async fn journal_watch(app: AppHandle, state: State<'_, AppState>, watch: State<'_, FolderWatch>) -> Result<(), String> {
    let root = state.root()?;
    let (tx, rx) = mpsc::channel::<Vec<String>>();
    // Paths come back resolved on some systems (macOS's /private/var for /var).
    let roots = [root.clone(), std::fs::canonicalize(&root).unwrap_or_else(|_| root.clone())];
    let mut seen = HashMap::new();
    let mut watcher = notify::recommended_watcher(move |result: notify::Result<notify::Event>| {
        let paths = match result {
            Ok(event) => news(&roots, &event, &mut seen),
            Err(_) => vec![EVERYTHING.to_string()],
        };
        if !paths.is_empty() {
            let _ = tx.send(paths);
        }
    })
    .map_err(|e| format!("Logbook can't watch the journal folder: {e}"))?;
    watcher.watch(&root, RecursiveMode::Recursive).map_err(|e| format!("Logbook can't watch the journal folder: {e}"))?;
    // Ends when this watcher is replaced or dropped: its sender goes with it.
    std::thread::spawn(move || {
        settle(rx, |paths| {
            let _ = app.emit("logbook://journal-changed", Changed { paths });
        })
    });
    *watch.0.lock().map_err(|_| "busy".to_string())? = Some((root, watcher));
    Ok(())
}

/// The journal files an event is about, relative to the folder with `/` separators, leaving out
/// what isn't news. `seen` holds each file's size and modification time as last heard of.
fn news(roots: &[PathBuf], event: &notify::Event, seen: &mut HashMap<String, Stamp>) -> Vec<String> {
    if event.need_rescan() {
        return vec![EVERYTHING.to_string()];
    }
    // Reads, and metadata (a sync tool's own attributes, times), change nothing in the journal.
    if matches!(event.kind, EventKind::Access(_) | EventKind::Modify(ModifyKind::Metadata(_))) {
        return Vec::new();
    }
    let mut out = Vec::new();
    for path in &event.paths {
        let Some(rel) = relative(roots, path) else {
            // The journal folder itself gone (deleted, moved, a drive unplugged): read it all again.
            if roots.iter().any(|r| r == path) && !path.exists() {
                out.push(EVERYTHING.to_string());
            }
            continue;
        };
        let meta = std::fs::metadata(path).ok();
        // A folder "changed" when a file in it did: the file tells its own news.
        if matches!(event.kind, EventKind::Modify(_)) && meta.as_ref().is_some_and(|m| m.is_dir()) {
            continue;
        }
        let stamp = meta.filter(|m| m.is_file()).and_then(|m| Some((m.modified().ok()?, m.len())));
        // A change that leaves the file as it was: on Windows, OneDrive marking a file uploaded is
        // reported like any other change.
        let same = matches!(event.kind, EventKind::Modify(ModifyKind::Any | ModifyKind::Data(_) | ModifyKind::Other))
            && stamp.is_some()
            && seen.get(&rel) == stamp.as_ref();
        match stamp {
            Some(stamp) => seen.insert(rel.clone(), stamp),
            None => seen.remove(&rel),
        };
        if !same && is_news(&rel) {
            out.push(rel);
        }
    }
    out
}

fn relative(roots: &[PathBuf], path: &Path) -> Option<String> {
    let rel = roots.iter().find_map(|r| path.strip_prefix(r).ok())?;
    let parts: Vec<String> = rel.components().map(|c| c.as_os_str().to_string_lossy().into_owned()).collect();
    (!parts.is_empty()).then(|| parts.join("/"))
}

fn is_news(rel: &str) -> bool {
    let name = rel.rsplit('/').next().unwrap_or(rel);
    !(name.contains(".logbook-tmp-") || name == ".logbook-write-test" || folder::is_clutter(name) || journal_fs::changed_by_us(rel))
}

/// Hands on each batch of changed paths once the folder has been quiet for SETTLE (or AT_MOST
/// after the batch's first change), until the sending side goes.
fn settle(rx: mpsc::Receiver<Vec<String>>, mut emit: impl FnMut(Vec<String>)) {
    while let Ok(first) = rx.recv() {
        let started = Instant::now();
        let mut paths: BTreeSet<String> = first.into_iter().collect();
        let mut open = true;
        loop {
            let left = AT_MOST.saturating_sub(started.elapsed());
            if left.is_zero() {
                break;
            }
            match rx.recv_timeout(SETTLE.min(left)) {
                Ok(more) => paths.extend(more),
                Err(mpsc::RecvTimeoutError::Timeout) => break,
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    open = false;
                    break;
                }
            }
        }
        emit(paths.into_iter().collect());
        if !open {
            return;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use notify::event::{AccessKind, CreateKind, DataChange, MetadataKind, RemoveKind};

    fn event(kind: EventKind, paths: &[&str]) -> notify::Event {
        let mut e = notify::Event::new(kind);
        for p in paths {
            e = e.add_path(PathBuf::from(p));
        }
        e
    }

    #[test]
    fn tells_of_journal_files_only() {
        let roots = [PathBuf::from("/home/me/Logbook"), PathBuf::from("/real/home/me/Logbook")];
        let created = event(EventKind::Create(CreateKind::File), &["/home/me/Logbook/entries/2026/a--k3f9x2m4n5p6.json"]);
        assert_eq!(news(&roots, &created, &mut HashMap::new()), ["entries/2026/a--k3f9x2m4n5p6.json"]);
        // Through the resolved path, a conflict copy.
        let copy = event(
            EventKind::Modify(ModifyKind::Data(DataChange::Content)),
            &["/real/home/me/Logbook/entries/2026/a (conflicted copy).json"],
        );
        assert_eq!(news(&roots, &copy, &mut HashMap::new()), ["entries/2026/a (conflicted copy).json"]);
        // Not: reads, metadata, temporary files, clutter, other folders.
        assert!(
            news(&roots, &event(EventKind::Access(AccessKind::Any), &["/home/me/Logbook/logbook.json"]), &mut HashMap::new()).is_empty()
        );
        assert!(news(
            &roots,
            &event(EventKind::Modify(ModifyKind::Metadata(MetadataKind::Any)), &["/home/me/Logbook/logbook.json"]),
            &mut HashMap::new()
        )
        .is_empty());
        let clutter = [
            "/home/me/Logbook/entries/x.json.logbook-tmp-0a1b2c3d",
            "/home/me/Logbook/.DS_Store",
            "/home/me/Logbook/media/Thumbs.db",
            "/home/me/Other/x.json",
        ];
        assert!(news(&roots, &event(EventKind::Create(CreateKind::File), &clutter), &mut HashMap::new()).is_empty());
        // A lost queue: anything may have changed.
        let overflow = event(EventKind::Other, &[]).set_flag(notify::event::Flag::Rescan);
        assert_eq!(news(&roots, &overflow, &mut HashMap::new()), [EVERYTHING]);
    }

    #[test]
    fn leaves_out_logbooks_own_writes() {
        let dir = tempfile::tempdir().unwrap();
        journal_fs::write(dir.path(), "entries/2026/own--k3f9x2m4n5p6.json", b"{}").unwrap();
        let roots = [dir.path().to_path_buf()];
        let own = event(EventKind::Create(CreateKind::File), &[dir.path().join("entries/2026/own--k3f9x2m4n5p6.json").to_str().unwrap()]);
        assert!(news(&roots, &own, &mut HashMap::new()).is_empty());
        let theirs =
            event(EventKind::Create(CreateKind::File), &[dir.path().join("entries/2026/theirs--a1b2c3d4e5f6.json").to_str().unwrap()]);
        assert_eq!(news(&roots, &theirs, &mut HashMap::new()), ["entries/2026/theirs--a1b2c3d4e5f6.json"]);
    }

    #[test]
    fn leaves_out_changes_that_change_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let roots = [dir.path().to_path_buf()];
        let mut seen = HashMap::new();
        std::fs::create_dir_all(dir.path().join("entries/2026")).unwrap();
        let file = dir.path().join("entries/2026/b--a1b2c3d4e5f6.json");
        std::fs::write(&file, b"{}").unwrap();
        let modified = event(EventKind::Modify(ModifyKind::Any), &[file.to_str().unwrap()]);
        assert_eq!(news(&roots, &modified, &mut seen), ["entries/2026/b--a1b2c3d4e5f6.json"]);
        // Told again with the file as it was (OneDrive marking it uploaded): not news.
        assert!(news(&roots, &modified, &mut seen).is_empty());
        std::fs::write(&file, b"{\"title\":\"x\"}").unwrap();
        assert_eq!(news(&roots, &modified, &mut seen), ["entries/2026/b--a1b2c3d4e5f6.json"]);
        // A folder "changed" because a file in it did.
        let folder = event(EventKind::Modify(ModifyKind::Any), &[dir.path().join("entries/2026").to_str().unwrap()]);
        assert!(news(&roots, &folder, &mut seen).is_empty());
        // A folder Logbook made for its own file isn't news; another computer's is.
        journal_fs::write(dir.path(), "entries/2031/own--k3f9x2m4n5p6.json", b"{}").unwrap();
        let made = |p: &str| event(EventKind::Create(CreateKind::Folder), &[dir.path().join(p).to_str().unwrap()]);
        assert!(news(&roots, &made("entries/2031"), &mut seen).is_empty());
        std::fs::create_dir_all(dir.path().join("entries/2032")).unwrap();
        assert_eq!(news(&roots, &made("entries/2032"), &mut seen), ["entries/2032"]);
    }

    #[test]
    fn reads_everything_again_when_the_folder_goes() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("Logbook");
        let roots = [root.clone()];
        let gone = event(EventKind::Remove(RemoveKind::Folder), &[root.to_str().unwrap()]);
        assert_eq!(news(&roots, &gone, &mut HashMap::new()), [EVERYTHING]);
    }

    #[test]
    fn tells_a_burst_of_changes_once_it_settles() {
        let (tx, rx) = mpsc::channel();
        let sender = std::thread::spawn(move || {
            tx.send(vec!["b".to_string(), "a".to_string()]).unwrap();
            std::thread::sleep(Duration::from_millis(100));
            tx.send(vec!["a".to_string(), "c".to_string()]).unwrap();
            std::thread::sleep(SETTLE * 2);
            tx.send(vec!["d".to_string()]).unwrap();
        });
        let mut batches = Vec::new();
        settle(rx, |paths| batches.push(paths));
        sender.join().unwrap();
        assert_eq!(batches, [vec!["a", "b", "c"], vec!["d"]]);
    }
}
