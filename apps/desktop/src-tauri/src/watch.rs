//! Watching the journal folder (M5 slice D, D102): another computer's changes arriving through
//! OneDrive, Dropbox or iCloud Drive, a sync tool's conflict copies, files put back by hand. The
//! page is told which files changed once they've settled, and reads the folder again. Logbook's own
//! writes, its temporary files and the clutter systems leave in folders aren't news.

use crate::{folder, journal_fs, AppState};
use notify::event::ModifyKind;
use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::sync::{mpsc, Mutex};
use std::time::{Duration, Instant};
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

/// Starts watching the open journal folder, or the new one after a switch; the page calls it once
/// the journal is open. Changes arrive as `logbook://journal-changed` events.
#[tauri::command]
pub fn journal_watch(app: AppHandle, state: State<'_, AppState>, watch: State<'_, FolderWatch>) -> Result<(), String> {
    let root = state.root()?;
    let mut current = watch.0.lock().map_err(|_| "busy".to_string())?;
    if current.as_ref().is_some_and(|(watched, _)| *watched == root) {
        return Ok(());
    }
    let (tx, rx) = mpsc::channel::<Vec<String>>();
    // Paths come back resolved on some systems (macOS's /private/var for /var).
    let roots = [root.clone(), std::fs::canonicalize(&root).unwrap_or_else(|_| root.clone())];
    let mut watcher = notify::recommended_watcher(move |result: notify::Result<notify::Event>| {
        let paths = match result {
            Ok(event) => news(&roots, &event),
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
    *current = Some((root, watcher));
    Ok(())
}

/// The journal files an event is about, relative to the folder with `/` separators, leaving out
/// what isn't news.
fn news(roots: &[PathBuf], event: &notify::Event) -> Vec<String> {
    if event.need_rescan() {
        return vec![EVERYTHING.to_string()];
    }
    // Reads, and metadata (a sync tool's own attributes, times), change nothing in the journal.
    if matches!(event.kind, EventKind::Access(_) | EventKind::Modify(ModifyKind::Metadata(_))) {
        return Vec::new();
    }
    event.paths.iter().filter_map(|p| relative(roots, p)).filter(|rel| is_news(rel)).collect()
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
    use notify::event::{AccessKind, CreateKind, DataChange, MetadataKind};

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
        assert_eq!(news(&roots, &created), ["entries/2026/a--k3f9x2m4n5p6.json"]);
        // Through the resolved path, a conflict copy.
        let copy = event(
            EventKind::Modify(ModifyKind::Data(DataChange::Content)),
            &["/real/home/me/Logbook/entries/2026/a (conflicted copy).json"],
        );
        assert_eq!(news(&roots, &copy), ["entries/2026/a (conflicted copy).json"]);
        // Not: reads, metadata, temporary files, clutter, other folders.
        assert!(news(&roots, &event(EventKind::Access(AccessKind::Any), &["/home/me/Logbook/logbook.json"])).is_empty());
        assert!(
            news(&roots, &event(EventKind::Modify(ModifyKind::Metadata(MetadataKind::Any)), &["/home/me/Logbook/logbook.json"])).is_empty()
        );
        let clutter = [
            "/home/me/Logbook/entries/x.json.logbook-tmp-0a1b2c3d",
            "/home/me/Logbook/.DS_Store",
            "/home/me/Logbook/media/Thumbs.db",
            "/home/me/Other/x.json",
        ];
        assert!(news(&roots, &event(EventKind::Create(CreateKind::File), &clutter)).is_empty());
        // A lost queue: anything may have changed.
        let overflow = event(EventKind::Other, &[]).set_flag(notify::event::Flag::Rescan);
        assert_eq!(news(&roots, &overflow), [EVERYTHING]);
    }

    #[test]
    fn leaves_out_logbooks_own_writes() {
        let dir = tempfile::tempdir().unwrap();
        journal_fs::write(dir.path(), "entries/2026/own--k3f9x2m4n5p6.json", b"{}").unwrap();
        let roots = [dir.path().to_path_buf()];
        let own = event(EventKind::Create(CreateKind::File), &[dir.path().join("entries/2026/own--k3f9x2m4n5p6.json").to_str().unwrap()]);
        assert!(news(&roots, &own).is_empty());
        let theirs =
            event(EventKind::Create(CreateKind::File), &[dir.path().join("entries/2026/theirs--a1b2c3d4e5f6.json").to_str().unwrap()]);
        assert_eq!(news(&roots, &theirs), ["entries/2026/theirs--a1b2c3d4e5f6.json"]);
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
