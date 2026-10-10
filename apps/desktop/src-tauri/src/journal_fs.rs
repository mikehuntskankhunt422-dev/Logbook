//! File operations inside the journal folder, for the web side's `TauriFsBackend`
//! (packages/storage-fs/src/tauri.ts). Every path is relative to the folder and checked the same
//! way as `assertRelativePath` in packages/storage-fs/src/backend.ts, so nothing outside it can be
//! read or written.
//!
//! iCloud Drive on macOS 13 and earlier replaces a file it has offloaded to save space with a hidden
//! placeholder, `.<name>.icloud`, until it's downloaded again (macOS 14 keeps the real name and
//! downloads on read). The journal would lose sight of those entries and photos, so `list` reports a
//! placeholder under its real name and `read` asks iCloud for the file and waits for it.

use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::thread;
use std::time::{Duration, Instant};

/// How long a read waits for iCloud to bring an offloaded file back.
const ICLOUD_WAIT: Duration = Duration::from_secs(30);
/// After a download timed out (offline, most likely), later reads within this long don't wait:
/// a journal with many offloaded files would otherwise stall for 30 s per file.
const ICLOUD_QUIET: Duration = Duration::from_secs(120);
static LAST_ICLOUD_TIMEOUT: std::sync::Mutex<Option<Instant>> = std::sync::Mutex::new(None);

/// Joins a checked relative path (`/`-separated) onto the journal folder.
pub fn resolve(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let ok = !rel.is_empty()
        && rel.len() <= 1024
        && !rel.starts_with('/')
        && !rel.contains('\\')
        && !rel.contains('\0')
        && !(rel.len() >= 2 && rel.as_bytes()[1] == b':')
        && rel.split('/').all(|s| !s.is_empty() && s != "." && s != "..");
    if !ok {
        return Err(format!("Not a path inside the journal folder: {rel:?}"));
    }
    let mut out = root.to_path_buf();
    for seg in rel.split('/') {
        out.push(seg);
    }
    Ok(out)
}

/// The file's bytes, or None when it doesn't exist. May wait for iCloud (see the module comment),
/// so call it off the async runtime's worker threads.
pub fn read(root: &Path, rel: &str) -> Result<Option<Vec<u8>>, String> {
    read_with(root, rel, &icloud_download, icloud_wait())
}

/// The full wait, unless a download timed out a moment ago.
fn icloud_wait() -> Duration {
    let last = *LAST_ICLOUD_TIMEOUT.lock().unwrap_or_else(|e| e.into_inner());
    match last {
        Some(at) if at.elapsed() < ICLOUD_QUIET => Duration::ZERO,
        _ => ICLOUD_WAIT,
    }
}

fn read_with(root: &Path, rel: &str, download: &dyn Fn(&Path) -> bool, wait: Duration) -> Result<Option<Vec<u8>>, String> {
    let path = resolve(root, rel)?;
    if !materialize(&path, download, wait).map_err(|e| describe(rel, e))? {
        return Ok(None);
    }
    match fs::read(&path) {
        Ok(data) => Ok(Some(data)),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(describe(rel, e)),
    }
}

/// The placeholder iCloud leaves for an offloaded `path`.
fn icloud_placeholder(path: &Path) -> Option<PathBuf> {
    let name = path.file_name()?.to_str()?;
    Some(path.with_file_name(format!(".{name}.icloud")))
}

/// `a.json` for a placeholder named `.a.json.icloud`.
fn placeholder_for(name: &str) -> Option<&str> {
    name.strip_prefix('.')?.strip_suffix(".icloud").filter(|n| !n.is_empty() && !n.starts_with('.'))
}

/// Whether `path` is on disk, after asking iCloud for it and waiting when only its placeholder is.
fn materialize(path: &Path, download: &dyn Fn(&Path) -> bool, wait: Duration) -> io::Result<bool> {
    if path.exists() {
        return Ok(true);
    }
    match icloud_placeholder(path) {
        Some(placeholder) if placeholder.exists() => {}
        _ => return Ok(false),
    }
    // Off a Mac, or when iCloud refuses: nothing will arrive, so don't wait for it.
    if !download(path) {
        return Err(io::Error::other("offloaded to iCloud Drive; open the journal on a Mac signed in to iCloud to download it"));
    }
    let end = Instant::now() + wait;
    loop {
        if path.exists() {
            return Ok(true);
        }
        if Instant::now() >= end {
            break;
        }
        thread::sleep(Duration::from_millis(100));
    }
    if !wait.is_zero() {
        *LAST_ICLOUD_TIMEOUT.lock().unwrap_or_else(|e| e.into_inner()) = Some(Instant::now());
    }
    Err(io::Error::new(io::ErrorKind::TimedOut, "still downloading from iCloud Drive; try again in a moment"))
}

/// Asks iCloud Drive for a local copy; false when that isn't possible here.
fn icloud_download(path: &Path) -> bool {
    #[cfg(target_os = "macos")]
    {
        // `brctl download` (macOS 10.15 and later) starts the download and returns.
        std::process::Command::new("brctl").arg("download").arg(path).status().is_ok_and(|s| s.success())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = path;
        false
    }
}

/// Writes to a temporary file beside the target, flushes it to disk, then renames it over the
/// target, so a crash or a sync tool never sees half a file.
pub fn write(root: &Path, rel: &str, data: &[u8]) -> Result<(), String> {
    let target = resolve(root, rel)?;
    write_atomic(&target, data).map_err(|e| describe(rel, e))
}

pub fn write_atomic(target: &Path, data: &[u8]) -> io::Result<()> {
    if let Some(dir) = target.parent() {
        fs::create_dir_all(dir)?;
    }
    let name = target.file_name().and_then(|n| n.to_str()).unwrap_or("file");
    let tmp = target.with_file_name(format!("{name}.logbook-tmp-{:08x}", random_u32()));
    let result = (|| {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(data)?;
        f.sync_all()?;
        drop(f);
        fs::rename(&tmp, target)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}

pub fn rename(root: &Path, from: &str, to: &str) -> Result<(), String> {
    let (a, b) = (resolve(root, from)?, resolve(root, to)?);
    materialize(&a, &icloud_download, icloud_wait()).map_err(|e| describe(from, e))?;
    if let Some(dir) = b.parent() {
        fs::create_dir_all(dir).map_err(|e| describe(to, e))?;
    }
    fs::rename(&a, &b).map_err(|e| describe(from, e))
}

/// Deletes a file, or its iCloud placeholder; a missing file is fine.
pub fn remove(root: &Path, rel: &str) -> Result<(), String> {
    let path = resolve(root, rel)?;
    let target = match icloud_placeholder(&path) {
        Some(placeholder) if !path.exists() && placeholder.exists() => placeholder,
        _ => path,
    };
    match fs::remove_file(target) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(describe(rel, e)),
    }
}

/// Every file under `dir`, recursively, relative to the journal folder with `/` separators.
/// Symbolic links aren't followed.
pub fn list(root: &Path, dir: &str) -> Result<Vec<String>, String> {
    let start = resolve(root, dir)?;
    let mut out = Vec::new();
    let mut stack = vec![(start, dir.to_string())];
    while let Some((abs, rel)) = stack.pop() {
        let entries = match fs::read_dir(&abs) {
            Ok(e) => e,
            Err(e) if e.kind() == io::ErrorKind::NotFound => continue,
            Err(e) => return Err(describe(&rel, e)),
        };
        for entry in entries {
            let entry = entry.map_err(|e| describe(&rel, e))?;
            let Some(name) = entry.file_name().to_str().map(str::to_string) else { continue };
            let kind = entry.file_type().map_err(|e| describe(&rel, e))?;
            if kind.is_dir() {
                stack.push((entry.path(), format!("{rel}/{name}")));
            } else if kind.is_file() {
                out.push(format!("{rel}/{}", placeholder_for(&name).unwrap_or(&name)));
            }
        }
    }
    out.sort();
    out.dedup();
    Ok(out)
}

fn describe(rel: &str, e: io::Error) -> String {
    format!("{rel}: {e}")
}

fn random_u32() -> u32 {
    use std::collections::hash_map::RandomState;
    use std::hash::{BuildHasher, Hasher};
    let mut h = RandomState::new().build_hasher();
    h.write_u128(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0));
    h.finish() as u32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refuses_paths_outside_the_folder() {
        let root = Path::new("/journal");
        for bad in ["", "../x", "/etc/passwd", "a/../b", "a//b", "C:/x", "a\\b", "./a", "a/."] {
            assert!(resolve(root, bad).is_err(), "{bad:?} should be refused");
        }
        assert_eq!(resolve(root, "entries/2026/a.json").unwrap(), Path::new("/journal/entries/2026/a.json"));
    }

    #[test]
    fn writes_reads_renames_lists_and_removes() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        assert_eq!(read(root, "entries/x.json").unwrap(), None);
        write(root, "entries/2026/x.json", b"one").unwrap();
        write(root, "entries/2026/x.json", b"two").unwrap();
        assert_eq!(read(root, "entries/2026/x.json").unwrap().as_deref(), Some(&b"two"[..]));
        rename(root, "entries/2026/x.json", "trash/2026/x.json").unwrap();
        write(root, "media/ab/abc.png", b"png").unwrap();
        assert_eq!(list(root, "entries").unwrap(), Vec::<String>::new());
        assert_eq!(list(root, "trash").unwrap(), vec!["trash/2026/x.json"]);
        assert_eq!(list(root, "media").unwrap(), vec!["media/ab/abc.png"]);
        assert_eq!(list(root, "missing").unwrap(), Vec::<String>::new());
        remove(root, "trash/2026/x.json").unwrap();
        remove(root, "trash/2026/x.json").unwrap();
        assert_eq!(list(root, "trash").unwrap(), Vec::<String>::new());
        // No temporary files are left behind.
        assert_eq!(fs::read_dir(root.join("media/ab")).unwrap().count(), 1);
    }

    #[test]
    fn brings_back_files_icloud_offloaded() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        fs::create_dir_all(root.join("entries/2025")).unwrap();
        fs::write(root.join("entries/2025/.2025-03-01--trip--abc.json.icloud"), b"placeholder").unwrap();
        fs::write(root.join("entries/2025/2025-03-02--home--def.json"), b"{}").unwrap();
        // Listed under the real name, so the journal still sees the entry.
        assert_eq!(
            list(root, "entries").unwrap(),
            vec!["entries/2025/2025-03-01--trip--abc.json", "entries/2025/2025-03-02--home--def.json"]
        );

        // Reading asks iCloud for the file and waits for it to arrive.
        let arrive = |p: &Path| {
            fs::write(p, b"{\"title\":\"Trip\"}").unwrap();
            true
        };
        let got = read_with(root, "entries/2025/2025-03-01--trip--abc.json", &arrive, Duration::from_secs(2)).unwrap();
        assert_eq!(got.as_deref(), Some(&b"{\"title\":\"Trip\"}"[..]));

        // A download that doesn't come in time is an error, never "no such file".
        fs::write(root.join("entries/2025/.2025-03-03--late--ghi.json.icloud"), b"placeholder").unwrap();
        let err = read_with(root, "entries/2025/2025-03-03--late--ghi.json", &|_| true, Duration::from_millis(300)).unwrap_err();
        assert!(err.contains("still downloading"), "{err}");

        // Where no download can start (not a Mac), it says so at once instead of waiting.
        let started = Instant::now();
        let err = read_with(root, "entries/2025/2025-03-03--late--ghi.json", &|_| false, Duration::from_secs(30)).unwrap_err();
        assert!(err.contains("offloaded to iCloud Drive") && started.elapsed() < Duration::from_secs(1), "{err}");

        // Deleting an offloaded file deletes its placeholder.
        remove(root, "entries/2025/2025-03-03--late--ghi.json").unwrap();
        assert!(!root.join("entries/2025/.2025-03-03--late--ghi.json.icloud").exists());
        assert_eq!(placeholder_for(".icloud"), None);
        assert_eq!(placeholder_for("..icloud"), None);
    }
}
