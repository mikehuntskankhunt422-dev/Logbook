//! Which folder holds the journal: chosen on first run, remembered in the app's config file
//! (`config.json` in the OS's app config folder), changeable in Settings.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub journal_folder: Option<PathBuf>,
}

pub fn load(config_file: &Path) -> Config {
    fs::read(config_file).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

pub fn save(config_file: &Path, config: &Config) -> Result<(), String> {
    let data = serde_json::to_vec_pretty(config).map_err(|e| e.to_string())?;
    crate::journal_fs::write_atomic(config_file, &data).map_err(|e| format!("Couldn't save the app's settings: {e}"))
}

/// The folder a journal goes in when someone picks `chosen`: the folder itself when it already
/// holds a journal or is empty, otherwise a `Logbook` folder inside it, so a journal never mixes
/// with someone's other files (picking "Documents" gives "Documents/Logbook").
pub fn journal_folder_for(chosen: &Path) -> Result<PathBuf, String> {
    if !chosen.is_absolute() {
        return Err("Choose a folder on this computer.".into());
    }
    // A journal, possibly with logbook.json offloaded by iCloud Drive (journal_fs.rs).
    if chosen.join("logbook.json").is_file() || chosen.join(".logbook.json.icloud").is_file() {
        return Ok(chosen.to_path_buf());
    }
    let empty = match fs::read_dir(chosen) {
        // Files the system or a sync tool leaves in any folder (Finder's .DS_Store) don't count.
        Ok(entries) => entries.filter_map(Result::ok).all(|e| is_clutter(&e.file_name().to_string_lossy())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => true,
        Err(e) => return Err(format!("Logbook can't open {}: {e}", chosen.display())),
    };
    let is_logbook_named = chosen.file_name().is_some_and(|n| n.eq_ignore_ascii_case("logbook"));
    Ok(if empty || is_logbook_named { chosen.to_path_buf() } else { chosen.join("Logbook") })
}

/// Files the system or a sync tool leaves in folders (as FolderStore's IGNORED list).
fn is_clutter(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    matches!(lower.as_str(), ".ds_store" | "desktop.ini" | "thumbs.db" | "icon\r" | ".localized" | ".logbook-write-test")
        || lower.starts_with(".dropbox")
        || lower.starts_with("._")
}

/// Creates the folder and checks Logbook can write in it.
pub fn prepare(folder: &Path) -> Result<(), String> {
    fs::create_dir_all(folder).map_err(|e| format!("Logbook can't create {}: {e}", folder.display()))?;
    let probe = folder.join(".logbook-write-test");
    fs::write(&probe, b"ok").map_err(|e| format!("Logbook can't save files in {}: {e}", folder.display()))?;
    let _ = fs::remove_file(probe);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn picks_a_logbook_folder_inside_a_busy_one() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        // Empty: used as is.
        assert_eq!(journal_folder_for(root).unwrap(), root);
        // Only system clutter: still empty.
        fs::write(root.join(".DS_Store"), b"").unwrap();
        fs::write(root.join("desktop.ini"), b"").unwrap();
        assert_eq!(journal_folder_for(root).unwrap(), root);
        // Holding other files: a Logbook folder inside it.
        fs::write(root.join("taxes.pdf"), b"").unwrap();
        assert_eq!(journal_folder_for(root).unwrap(), root.join("Logbook"));
        // Already a journal, even with logbook.json offloaded by iCloud: used as is.
        fs::write(root.join(".logbook.json.icloud"), b"").unwrap();
        assert_eq!(journal_folder_for(root).unwrap(), root);
        fs::write(root.join("logbook.json"), b"{}").unwrap();
        assert_eq!(journal_folder_for(root).unwrap(), root);
        // Doesn't exist yet: created where chosen.
        assert_eq!(journal_folder_for(&root.join("new")).unwrap(), root.join("new"));
        assert!(journal_folder_for(Path::new("relative")).is_err());
    }

    #[test]
    fn remembers_the_folder() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("config/config.json");
        assert!(load(&file).journal_folder.is_none());
        save(&file, &Config { journal_folder: Some(dir.path().join("Logbook")) }).unwrap();
        assert_eq!(load(&file).journal_folder, Some(dir.path().join("Logbook")));
    }
}
