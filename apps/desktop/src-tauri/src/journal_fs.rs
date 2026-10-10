//! File operations inside the journal folder, for the web side's `TauriFsBackend`
//! (packages/storage-fs/src/tauri.ts). Every path is relative to the folder and checked the same
//! way as `assertRelativePath` in packages/storage-fs/src/backend.ts, so nothing outside it can be
//! read or written.

use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};

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

/// The file's bytes, or None when it doesn't exist.
pub fn read(root: &Path, rel: &str) -> Result<Option<Vec<u8>>, String> {
    match fs::read(resolve(root, rel)?) {
        Ok(data) => Ok(Some(data)),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(describe(rel, e)),
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
    if let Some(dir) = b.parent() {
        fs::create_dir_all(dir).map_err(|e| describe(to, e))?;
    }
    fs::rename(&a, &b).map_err(|e| describe(from, e))
}

/// Deletes a file; a missing file is fine.
pub fn remove(root: &Path, rel: &str) -> Result<(), String> {
    match fs::remove_file(resolve(root, rel)?) {
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
            let child = format!("{rel}/{name}");
            if kind.is_dir() {
                stack.push((entry.path(), child));
            } else if kind.is_file() {
                out.push(child);
            }
        }
    }
    out.sort();
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
}
