//! Linux (D101). The window's own icon reaches title bars and X11 task lists. GNOME and KDE draw
//! the dock, the app grid and the menu from the app's desktop entry instead, so Logbook writes its
//! own copy of the package's entry, same name, with `Icon=` the picture, in the person's
//! `~/.local/share/applications`, which comes before the system's. It's made again from the
//! package's at every launch, so an updated package's changes still come through, and deleting it
//! brings the usual entry back. An AppImage has an entry only when a tool like AppImageLauncher
//! added it to the menu; then that entry's `Icon=` is changed, and put back afterwards.

use crate::folder::EntryIcon;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

/// tauri-bundler names the entry after the product, for the .deb, the .rpm and the AppImage.
const DESKTOP_ID: &str = "Logbook.desktop";
/// In each entry Logbook writes, so it never deletes one the person made in a menu editor.
const MARKER: &str = "X-Logbook-Custom-Icon";

pub fn show_in_window(app: &AppHandle, png: &Path) -> Result<(), String> {
    let image = ico::IconImage::read_png(fs::File::open(png).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    let (width, height) = (image.width(), image.height());
    let icon = tauri::image::Image::new_owned(image.into_rgba_data(), width, height);
    app.get_webview_window("main").ok_or("no window")?.set_icon(icon).map_err(|e| e.to_string())
}

pub fn forget_in_window(app: &AppHandle) -> Result<(), String> {
    // Tauri ignores "no icon", so the one it started with.
    let Some(icon) = app.default_window_icon().cloned() else { return Ok(()) };
    app.get_webview_window("main").ok_or("no window")?.set_icon(icon).map_err(|e| e.to_string())
}

/// Where desktop entries are: the person's (`$XDG_DATA_HOME`) first, then the system's.
pub struct Dirs {
    data_home: Option<PathBuf>,
    data_dirs: Vec<PathBuf>,
    /// The AppImage Logbook runs from, if it does.
    appimage: Option<PathBuf>,
}

impl Dirs {
    pub fn from_env() -> Dirs {
        let data_home = std::env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .filter(|p| p.is_absolute())
            .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".local/share")));
        let dirs = std::env::var("XDG_DATA_DIRS").ok().filter(|s| !s.is_empty()).unwrap_or_else(|| "/usr/local/share:/usr/share".into());
        let data_dirs = dirs.split(':').filter(|d| d.starts_with('/')).map(PathBuf::from).collect();
        Dirs { data_home, data_dirs, appimage: std::env::var_os("APPIMAGE").map(PathBuf::from).filter(|p| p.is_absolute()) }
    }

    fn ours(&self) -> Option<PathBuf> {
        Some(self.data_home.as_ref()?.join("applications").join(DESKTOP_ID))
    }

    /// The package's entry (/usr/share/applications/Logbook.desktop).
    fn system(&self) -> Option<PathBuf> {
        self.data_dirs.iter().map(|d| d.join("applications").join(DESKTOP_ID)).find(|p| p.is_file())
    }

    /// The entry a menu tool made for this AppImage: AppImageLauncher's and appimaged's
    /// `appimagekit_….desktop`, which name the AppImage in TryExec or Exec.
    fn appimage_entry(&self) -> Option<PathBuf> {
        let image = self.appimage.as_ref()?.to_string_lossy().into_owned();
        let dir = self.data_home.as_ref()?.join("applications");
        let mut found: Vec<PathBuf> = fs::read_dir(dir)
            .ok()?
            .flatten()
            .map(|e| e.path())
            .filter(|p| {
                p.file_name().is_some_and(|n| n.to_string_lossy().starts_with("appimagekit_"))
                    && p.extension().is_some_and(|e| e == "desktop")
            })
            .filter(|p| fs::read_to_string(p).is_ok_and(|text| names_program(&text, &image)))
            .collect();
        found.sort();
        found.into_iter().next()
    }
}

/// The picture on Logbook's menu entry. `earlier` is an entry of someone else's changed before
/// (and its icon then). Answers whether the menu shows the picture, and the entry of someone
/// else's now changed, to keep.
pub fn show_in_menu(dirs: &Dirs, png: &Path, earlier: Option<EntryIcon>) -> (bool, Option<EntryIcon>) {
    let icon = escape(&png.to_string_lossy());
    // An AppImage's entry, made by a menu tool.
    if dirs.appimage.is_some() {
        return match dirs.appimage_entry() {
            Some(path) => edit_theirs(&path, &icon, earlier),
            None => (false, earlier),
        };
    }
    let Some(ours) = dirs.ours() else { return (false, earlier) };
    match fs::read_to_string(&ours) {
        // One the person made (a menu editor's copy): only its icon changes. One that hides
        // Logbook from the menu stays as it is.
        Ok(theirs) if !theirs.contains(MARKER) => {
            if group_keys(&theirs).any(|(k, v)| (k == "Hidden" || k == "NoDisplay") && v == "true") {
                return (false, earlier);
            }
            edit_theirs(&ours, &icon, earlier)
        }
        _ => {
            let Some(template) = dirs.system().and_then(|p| fs::read_to_string(p).ok()) else {
                // Not installed from a package (a build run from its folder): no menu entry.
                let _ = fs::remove_file(&ours);
                return (false, earlier);
            };
            let Some(program) = exec_program(&template) else { return (false, earlier) };
            let entry = build_entry(&template, &icon, &program);
            if fs::read_to_string(&ours).ok().as_deref() == Some(entry.as_str()) {
                return (true, earlier);
            }
            match write(&ours, &entry) {
                Ok(()) => (true, earlier),
                Err(e) => {
                    eprintln!("Logbook couldn't write {}: {e}", ours.display());
                    (false, earlier)
                }
            }
        }
    }
}

/// Changes the icon of an entry of someone else's, remembering the first icon it had.
fn edit_theirs(path: &Path, icon: &str, earlier: Option<EntryIcon>) -> (bool, Option<EntryIcon>) {
    let Ok(text) = fs::read_to_string(path) else { return (false, earlier) };
    let (entry, old) = set_icon_key(&text, icon);
    if entry == text {
        return (true, earlier);
    }
    if let Err(e) = write(path, &entry) {
        eprintln!("Logbook couldn't change {}: {e}", path.display());
        return (false, earlier);
    }
    // The icon it had before Logbook ever changed it: kept from the first change, unless that
    // was a different entry (the person moved the AppImage, say).
    let kept = match earlier {
        Some(e) if e.path == path => e,
        _ => EntryIcon { path: path.to_path_buf(), icon: old.unwrap_or_default() },
    };
    (true, Some(kept))
}

/// Back to the usual icon: Logbook's own entry deleted, an entry of someone else's given back its
/// icon.
pub fn forget_in_menu(dirs: &Dirs, theirs: Option<EntryIcon>) -> Result<(), String> {
    if let Some(ours) = dirs.ours() {
        if fs::read_to_string(&ours).is_ok_and(|t| t.contains(MARKER)) {
            fs::remove_file(&ours).map_err(|e| format!("Couldn't change Logbook's menu entry: {e}"))?;
            refresh_menus();
        }
    }
    if let Some(EntryIcon { path, icon }) = theirs {
        if let Ok(text) = fs::read_to_string(&path) {
            let entry = if icon.is_empty() { remove_icon_key(&text) } else { set_icon_key(&text, &icon).0 };
            if entry != text {
                write(&path, &entry).map_err(|e| format!("Couldn't change Logbook's menu entry: {e}"))?;
            }
        }
    }
    Ok(())
}

/// The `[Desktop Entry]` group's keys and values (not other groups', such as actions).
fn group_keys(text: &str) -> impl Iterator<Item = (&str, &str)> {
    let mut main = false;
    text.lines().filter_map(move |line| {
        let line = line.trim();
        if line.starts_with('[') {
            main = line == "[Desktop Entry]";
            return None;
        }
        if !main || line.starts_with('#') {
            return None;
        }
        let (k, v) = line.split_once('=')?;
        Some((k.trim(), v.trim()))
    })
}

/// Whether an entry runs `program`, by its TryExec or its Exec's first word.
fn names_program(text: &str, program: &str) -> bool {
    group_keys(text).any(|(k, v)| match k {
        "TryExec" => v == program,
        "Exec" => first_word(v).as_deref() == Some(program),
        _ => false,
    })
}

/// An Exec line's program: its first word, unquoted.
fn first_word(exec: &str) -> Option<String> {
    let exec = exec.trim();
    if let Some(rest) = exec.strip_prefix('"') {
        let mut out = String::new();
        let mut chars = rest.chars();
        while let Some(c) = chars.next() {
            match c {
                '\\' => out.push(chars.next()?),
                '"' => return Some(out),
                c => out.push(c),
            }
        }
        return None;
    }
    exec.split_whitespace().next().map(str::to_string)
}

fn exec_program(text: &str) -> Option<String> {
    group_keys(text).find(|(k, _)| *k == "Exec").and_then(|(_, v)| first_word(v))
}

/// A string value with the Desktop Entry spec's escapes.
fn escape(s: &str) -> String {
    s.replace('\\', "\\\\").replace('\n', "\\n").replace('\t', "\\t").replace('\r', "\\r")
}

/// The package's entry with the picture as its icon. Everything else stays (Name, Exec,
/// StartupWMClass, which matches the window to it, translations, actions). TryExec makes KDE drop
/// the entry once Logbook is uninstalled, and GNOME does that anyway.
fn build_entry(template: &str, icon: &str, program: &str) -> String {
    let mut out = String::new();
    let mut main = false;
    for line in template.lines() {
        let t = line.trim_start();
        if t.starts_with('[') {
            main = t.trim_end() == "[Desktop Entry]";
            out.push_str(line);
            out.push('\n');
            if main {
                out.push_str(&format!("Icon={icon}\nTryExec={}\n{MARKER}=true\n", escape(program)));
            }
            continue;
        }
        let key = t.split('=').next().unwrap_or("").trim();
        let base = key.split('[').next().unwrap_or("");
        if main && (base == "Icon" || base == "TryExec" || key == MARKER) {
            continue;
        }
        out.push_str(line);
        out.push('\n');
    }
    out
}

/// The `[Desktop Entry]` group's `Icon=` (translations aside) set to `value`, added when missing;
/// answers what it was.
fn set_icon_key(text: &str, value: &str) -> (String, Option<String>) {
    let (mut out, mut old, mut main, mut done) = (String::new(), None, false, false);
    for line in text.lines() {
        let t = line.trim_start();
        if t.starts_with('[') {
            main = t.trim_end() == "[Desktop Entry]";
            out.push_str(line);
            out.push('\n');
            if main && !done && !group_keys(text).any(|(k, _)| k == "Icon") {
                out.push_str(&format!("Icon={value}\n"));
                done = true;
            }
            continue;
        }
        if main && !done {
            if let Some(v) = t.strip_prefix("Icon=") {
                old = Some(v.trim_end().to_string());
                out.push_str(&format!("Icon={value}\n"));
                done = true;
                continue;
            }
        }
        out.push_str(line);
        out.push('\n');
    }
    (out, old)
}

fn remove_icon_key(text: &str) -> String {
    let mut main = false;
    let mut out = String::new();
    for line in text.lines() {
        let t = line.trim_start();
        if t.starts_with('[') {
            main = t.trim_end() == "[Desktop Entry]";
        } else if main && t.starts_with("Icon=") {
            continue;
        }
        out.push_str(line);
        out.push('\n');
    }
    out
}

/// Through a temporary file, as GNOME reloads the folder as soon as it changes.
fn write(target: &Path, entry: &str) -> std::io::Result<()> {
    crate::journal_fs::write_atomic(target, entry.as_bytes())?;
    refresh_menus();
    Ok(())
}

/// GNOME sees the change itself (within about 5 s). KDE's menu database is rebuilt on its next
/// lookup, or straight away by kbuildsycoca, which Plasma's task manager listens for.
fn refresh_menus() {
    let kde = std::env::var("XDG_CURRENT_DESKTOP").is_ok_and(|d| d.split(':').any(|d| d == "KDE"));
    if !kde {
        return;
    }
    for tool in ["kbuildsycoca6", "kbuildsycoca5"] {
        let started = std::process::Command::new(tool)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn();
        if let Ok(mut child) = started {
            std::thread::spawn(move || child.wait());
            return;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const PACKAGE: &str = "[Desktop Entry]\nCategories=Education;\nComment=A private journal\nExec=logbook\nStartupWMClass=logbook\nIcon=logbook\nName=Logbook\nTerminal=false\nType=Application\n";

    struct Home {
        _dir: tempfile::TempDir,
        dirs: Dirs,
    }

    fn home(package: bool, appimage: Option<&str>) -> Home {
        let dir = tempfile::tempdir().unwrap();
        let system = dir.path().join("usr/share");
        if package {
            fs::create_dir_all(system.join("applications")).unwrap();
            fs::write(system.join("applications").join(DESKTOP_ID), PACKAGE).unwrap();
        }
        let dirs =
            Dirs { data_home: Some(dir.path().join("home/.local/share")), data_dirs: vec![system], appimage: appimage.map(PathBuf::from) };
        Home { _dir: dir, dirs }
    }

    fn read(path: &Path) -> String {
        fs::read_to_string(path).unwrap()
    }

    #[test]
    fn writes_its_own_entry_over_the_packages_and_takes_it_away_again() {
        let h = home(true, None);
        let ours = h.dirs.ours().unwrap();
        assert_eq!(show_in_menu(&h.dirs, Path::new("/home/me/.config/app/app-icon/1a/512.png"), None), (true, None));
        let entry = read(&ours);
        assert!(
            entry.starts_with(
                "[Desktop Entry]\nIcon=/home/me/.config/app/app-icon/1a/512.png\nTryExec=logbook\nX-Logbook-Custom-Icon=true\n"
            ),
            "{entry}"
        );
        assert!(entry.contains("StartupWMClass=logbook\n") && entry.contains("Exec=logbook\n") && entry.contains("Name=Logbook\n"));
        assert!(!entry.contains("Icon=logbook"));
        // Again (a launch): the same; a new picture replaces the path.
        assert_eq!(show_in_menu(&h.dirs, Path::new("/home/me/.config/app/app-icon/1a/512.png"), None), (true, None));
        show_in_menu(&h.dirs, Path::new("/p/2b/512.png"), None);
        assert_eq!(read(&ours).lines().filter(|l| l.starts_with("Icon=")).count(), 1);
        assert!(read(&ours).contains("Icon=/p/2b/512.png\n"));
        forget_in_menu(&h.dirs, None).unwrap();
        assert!(!ours.exists());
    }

    #[test]
    fn changes_only_the_icon_of_an_entry_the_person_made() {
        let h = home(true, None);
        let ours = h.dirs.ours().unwrap();
        fs::create_dir_all(ours.parent().unwrap()).unwrap();
        fs::write(&ours, "[Desktop Entry]\nName=My journal\nExec=logbook\nIcon=accessories-text-editor\n").unwrap();
        let (on, kept) = show_in_menu(&h.dirs, Path::new("/p/1a/512.png"), None);
        assert!(on);
        assert_eq!(kept, Some(EntryIcon { path: ours.clone(), icon: "accessories-text-editor".into() }));
        assert_eq!(read(&ours), "[Desktop Entry]\nName=My journal\nExec=logbook\nIcon=/p/1a/512.png\n");
        // A second picture keeps the first icon to go back to.
        let (_, kept) = show_in_menu(&h.dirs, Path::new("/p/2b/512.png"), kept);
        assert_eq!(kept.as_ref().unwrap().icon, "accessories-text-editor");
        forget_in_menu(&h.dirs, kept).unwrap();
        assert_eq!(read(&ours), "[Desktop Entry]\nName=My journal\nExec=logbook\nIcon=accessories-text-editor\n");
        // One that hides Logbook from the menu is left alone.
        fs::write(&ours, "[Desktop Entry]\nName=Logbook\nHidden=true\n").unwrap();
        assert_eq!(show_in_menu(&h.dirs, Path::new("/p/1a/512.png"), None), (false, None));
        assert_eq!(read(&ours), "[Desktop Entry]\nName=Logbook\nHidden=true\n");
    }

    #[test]
    fn has_no_menu_entry_to_change_outside_a_package() {
        let h = home(false, None);
        assert_eq!(show_in_menu(&h.dirs, Path::new("/p/1a/512.png"), None), (false, None));
        assert!(!h.dirs.ours().unwrap().exists());
    }

    #[test]
    fn changes_an_appimages_entry_only_when_a_menu_tool_made_one() {
        let h = home(false, Some("/home/me/Apps/Logbook 0.9.AppImage"));
        assert_eq!(show_in_menu(&h.dirs, Path::new("/p/1a/512.png"), None), (false, None));
        let apps = h.dirs.data_home.as_ref().unwrap().join("applications");
        fs::create_dir_all(&apps).unwrap();
        // Another AppImage's entry, and Logbook's (AppImageLauncher's way).
        fs::write(
            apps.join("appimagekit_0123-Other.desktop"),
            "[Desktop Entry]\nName=Other\nExec=/home/me/Apps/Other.AppImage\nIcon=appimagekit_0123_other\n",
        )
        .unwrap();
        let path = apps.join("appimagekit_4567-Logbook.desktop");
        let entry = "[Desktop Entry]\nName=Logbook\nExec=\"/home/me/Apps/Logbook 0.9.AppImage\" %U\nTryExec=/home/me/Apps/Logbook 0.9.AppImage\nIcon=appimagekit_4567_logbook\n\n[Desktop Action New]\nIcon=new\n";
        fs::write(&path, entry).unwrap();
        let (on, kept) = show_in_menu(&h.dirs, Path::new("/p/1a/512.png"), None);
        assert!(on);
        assert_eq!(kept, Some(EntryIcon { path: path.clone(), icon: "appimagekit_4567_logbook".into() }));
        assert!(read(&path).contains("Icon=/p/1a/512.png\n") && read(&path).contains("Icon=new\n"));
        assert!(read(&apps.join("appimagekit_0123-Other.desktop")).contains("Icon=appimagekit_0123_other"));
        assert!(!h.dirs.ours().unwrap().exists());
        forget_in_menu(&h.dirs, kept).unwrap();
        assert_eq!(read(&path), entry);
    }

    #[test]
    fn reads_exec_lines() {
        assert_eq!(first_word("logbook %U").as_deref(), Some("logbook"));
        assert_eq!(first_word(r#""/a b/Log\"book" %U"#).as_deref(), Some("/a b/Log\"book"));
        assert_eq!(first_word(r#""unclosed"#), None);
        assert_eq!(escape("a\\b\nc"), "a\\\\b\\nc");
    }
}
