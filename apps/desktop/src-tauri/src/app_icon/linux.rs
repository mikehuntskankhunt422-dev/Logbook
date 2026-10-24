//! Linux (D101). The window's own icon reaches title bars and X11 task lists. GNOME and KDE draw
//! the dock, the app grid and the menu from the app's desktop entry instead, so Logbook writes its
//! own copy of the package's entry, same name, with `Icon=` the picture, in the person's
//! `~/.local/share/applications`, which comes before the system's. It's made again from the
//! package's at every launch, so an updated package's changes still come through, and deleting it
//! brings the usual entry back. That copy carries a fingerprint of what Logbook wrote: once the
//! person changes it in a menu editor it's theirs, like an entry they made themselves, and only its
//! `Icon=` changes. An AppImage has an entry only when a tool like AppImageLauncher added it to the
//! menu; then that entry's `Icon=` is changed. An entry of someone else's keeps the icon it had in
//! the entry itself, for going back.

use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

use super::Outside;

/// tauri-bundler names the entry after the product, for the .deb, the .rpm and the AppImage.
const DESKTOP_ID: &str = "Logbook.desktop";
/// In Logbook's own copy: a fingerprint of the rest of it, as Logbook wrote it.
const MARKER: &str = "X-Logbook-Custom-Icon";
/// In an entry of someone else's whose icon Logbook changed: the icon it had before.
const ORIGINAL: &str = "X-Logbook-Original-Icon";

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
        Dirs { data_home, data_dirs, appimage: appimage() }
    }

    fn applications(&self) -> Option<PathBuf> {
        Some(self.data_home.as_ref()?.join("applications"))
    }

    fn ours(&self) -> Option<PathBuf> {
        Some(self.applications()?.join(DESKTOP_ID))
    }

    /// The package's entry (/usr/share/applications/Logbook.desktop).
    fn system(&self) -> Option<PathBuf> {
        self.data_dirs.iter().map(|d| d.join("applications").join(DESKTOP_ID)).find(|p| p.is_file())
    }

    /// The person's own entries, which Logbook may have changed.
    fn entries(&self) -> Vec<PathBuf> {
        let Some(dir) = self.applications() else { return Vec::new() };
        let Ok(found) = fs::read_dir(dir) else { return Vec::new() };
        let mut out: Vec<PathBuf> = found.flatten().map(|e| e.path()).filter(|p| p.extension().is_some_and(|e| e == "desktop")).collect();
        out.sort();
        out
    }

    /// The entry a menu tool made for this AppImage: AppImageLauncher's and appimaged's
    /// `appimagekit_….desktop`, which name the AppImage in TryExec or Exec.
    fn appimage_entry(&self) -> Option<PathBuf> {
        let image = self.appimage.as_ref()?.to_string_lossy().into_owned();
        self.entries().into_iter().find(|p| {
            p.file_name().is_some_and(|n| n.to_string_lossy().starts_with("appimagekit_"))
                && matches!(read_entry(p), Entry::Text(text) if names_program(&text, &image))
        })
    }
}

/// The AppImage Logbook runs from, only when it does: APPIMAGE can be left over from another app's
/// (a terminal that's an AppImage itself), so Logbook must be inside the AppImage's own folder.
fn appimage() -> Option<PathBuf> {
    let image = PathBuf::from(std::env::var_os("APPIMAGE")?);
    let appdir = PathBuf::from(std::env::var_os("APPDIR")?);
    let exe = std::env::current_exe().ok()?;
    (image.is_absolute() && image.is_file() && appdir.is_absolute() && exe.starts_with(&appdir)).then_some(image)
}

enum Entry {
    Missing,
    /// Not text, or not Logbook's to read: left alone.
    Unreadable,
    Text(String),
}

fn read_entry(path: &Path) -> Entry {
    match fs::read(path) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Entry::Missing,
        Err(_) => Entry::Unreadable,
        Ok(bytes) => String::from_utf8(bytes).map(Entry::Text).unwrap_or(Entry::Unreadable),
    }
}

/// The picture on Logbook's menu entry; `png` is in the app's `app-icon/` folder. Answers whether
/// the menu shows it.
pub fn show_in_menu(dirs: &Dirs, png: &Path) -> Outside {
    let icon = escape(&png.to_string_lossy());
    let pictures = png.parent().and_then(Path::parent).map(|p| escape(&p.to_string_lossy())).unwrap_or_default();
    let result = if dirs.appimage.is_some() {
        // An AppImage's entry, made by a menu tool.
        match dirs.appimage_entry() {
            Some(path) => match read_entry(&path) {
                Entry::Text(text) => edit_theirs(&path, &text, &icon, &pictures, None),
                _ => Ok(Outside::Failed),
            },
            None => Ok(Outside::Missing),
        }
    } else {
        let Some(ours) = dirs.ours() else { return Outside::Missing };
        let template = dirs.system().and_then(|p| match read_entry(&p) {
            Entry::Text(t) => Some(t),
            _ => None,
        });
        match read_entry(&ours) {
            Entry::Unreadable => Ok(Outside::Failed),
            Entry::Text(text) if !untouched(&text) => {
                // The person's: one they made, or Logbook's copy they've changed since. One that
                // hides Logbook from the menu stays as it is.
                if group_keys(&text).any(|(k, v)| (k == "Hidden" || k == "NoDisplay") && v == "true") {
                    Ok(Outside::Missing)
                } else {
                    let usual = template.as_deref().and_then(|t| group_keys(t).find(|(k, _)| *k == "Icon").map(|(_, v)| v.to_string()));
                    edit_theirs(&ours, &text, &icon, &pictures, usual.as_deref())
                }
            }
            current => match template.as_deref().and_then(|t| Some((t, exec_program(t)?))) {
                Some((template, program)) => {
                    let entry = build_entry(template, &icon, &program);
                    if matches!(&current, Entry::Text(t) if *t == entry) {
                        Ok(Outside::Done)
                    } else {
                        write(&ours, &entry).map(|()| Outside::Done)
                    }
                }
                // Not installed from a package (a build run from its folder): no menu entry.
                None => {
                    if matches!(current, Entry::Text(_)) {
                        let _ = fs::remove_file(&ours);
                    }
                    Ok(Outside::Missing)
                }
            },
        }
    };
    result.unwrap_or_else(|e| {
        eprintln!("Logbook couldn't change its menu entry: {e}");
        Outside::Failed
    })
}

/// Changes the icon of an entry of someone else's, noting in it the icon it had before Logbook
/// first changed it (never one of Logbook's own pictures, which go when they're replaced: then
/// `usual`, or none).
fn edit_theirs(path: &Path, text: &str, icon: &str, pictures: &str, usual: Option<&str>) -> std::io::Result<Outside> {
    let current = main_value(text, "Icon");
    let mut entry = set_key(text, "Icon", icon);
    if main_value(text, ORIGINAL).is_none() {
        let before = match current {
            Some(c) if pictures.is_empty() || !c.starts_with(pictures) => c,
            _ => usual.unwrap_or_default().to_string(),
        };
        entry = set_key(&entry, ORIGINAL, &before);
    }
    if entry != text {
        write(path, &entry)?;
    }
    Ok(Outside::Done)
}

/// Back to the usual icon: Logbook's own entry deleted, as it wrote it, and every entry of
/// someone else's given back the icon it had.
pub fn forget_in_menu(dirs: &Dirs) -> Result<(), String> {
    let failed = |e: std::io::Error| format!("Couldn't change Logbook's menu entry: {e}");
    for path in dirs.entries() {
        let Entry::Text(text) = read_entry(&path) else { continue };
        if dirs.ours().as_deref() == Some(path.as_path()) && untouched(&text) {
            fs::remove_file(&path).map_err(failed)?;
            refresh_menus();
        } else if let Some(before) = main_value(&text, ORIGINAL) {
            let entry = remove_key(&text, ORIGINAL);
            let entry = if before.is_empty() { remove_key(&entry, "Icon") } else { set_key(&entry, "Icon", &before) };
            write(&path, &entry).map_err(failed)?;
        }
    }
    Ok(())
}

/// The pictures Logbook's menu entries show, so they aren't deleted while they do.
pub fn icons_in_use(dirs: &Dirs) -> Vec<PathBuf> {
    dirs.entries()
        .iter()
        .filter_map(|p| match read_entry(p) {
            Entry::Text(text) if main_value(&text, MARKER).is_some() || main_value(&text, ORIGINAL).is_some() => {
                main_value(&text, "Icon").map(PathBuf::from)
            }
            _ => None,
        })
        .collect()
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

fn main_value(text: &str, key: &str) -> Option<String> {
    group_keys(text).find(|(k, _)| *k == key).map(|(_, v)| v.to_string())
}

/// FNV-1a, 64 bits: whether an entry is still as Logbook wrote it.
fn fingerprint(text: &str) -> String {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in text.bytes() {
        h = (h ^ b as u64).wrapping_mul(0x100000001b3);
    }
    format!("{h:016x}")
}

/// Logbook's own copy, unchanged since Logbook wrote it.
fn untouched(text: &str) -> bool {
    main_value(text, MARKER).is_some_and(|mark| mark == fingerprint(&remove_key(text, MARKER)))
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
/// the entry once Logbook is uninstalled, and GNOME does that anyway. The package's own icon is
/// noted for going back, should the person change the copy. Last, the fingerprint of the rest.
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
                let usual = main_value(template, "Icon").unwrap_or_default();
                out.push_str(&format!("Icon={icon}\nTryExec={}\n{ORIGINAL}={usual}\n", escape(program)));
            }
            continue;
        }
        let key = t.split('=').next().unwrap_or("").trim();
        let base = key.split('[').next().unwrap_or("");
        if main && (base == "Icon" || base == "TryExec" || key == MARKER || key == ORIGINAL) {
            continue;
        }
        out.push_str(line);
        out.push('\n');
    }
    let mark = fingerprint(&out);
    set_key(&out, MARKER, &mark)
}

/// The `[Desktop Entry]` group's `key=` (translations aside) set to `value`: in place, or added at
/// the group's start.
fn set_key(text: &str, key: &str, value: &str) -> String {
    let has = group_keys(text).any(|(k, _)| k == key);
    let (mut out, mut main, mut done) = (String::new(), false, false);
    for line in text.lines() {
        let t = line.trim_start();
        if t.starts_with('[') {
            main = t.trim_end() == "[Desktop Entry]";
            out.push_str(line);
            out.push('\n');
            if main && !has && !done {
                out.push_str(&format!("{key}={value}\n"));
                done = true;
            }
            continue;
        }
        if main && !done && t.split_once('=').is_some_and(|(k, _)| k.trim() == key) {
            out.push_str(&format!("{key}={value}\n"));
            done = true;
            continue;
        }
        out.push_str(line);
        out.push('\n');
    }
    out
}

fn remove_key(text: &str, key: &str) -> String {
    let mut main = false;
    let mut out = String::new();
    for line in text.lines() {
        let t = line.trim_start();
        if t.starts_with('[') {
            main = t.trim_end() == "[Desktop Entry]";
        } else if main && t.split_once('=').is_some_and(|(k, _)| k.trim() == key) {
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
    const PICTURES: &str = "/home/me/.config/app/app-icon";

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
        fs::create_dir_all(dirs.applications().unwrap()).unwrap();
        Home { _dir: dir, dirs }
    }

    fn picture(id: &str) -> PathBuf {
        Path::new(PICTURES).join(id).join("512.png")
    }

    fn read(path: &Path) -> String {
        fs::read_to_string(path).unwrap()
    }

    #[test]
    fn writes_its_own_entry_over_the_packages_and_takes_it_away_again() {
        let h = home(true, None);
        let ours = h.dirs.ours().unwrap();
        assert_eq!(show_in_menu(&h.dirs, &picture("1a")), Outside::Done);
        let entry = read(&ours);
        assert!(entry.starts_with(&format!("[Desktop Entry]\n{MARKER}=")), "{entry}");
        assert!(
            entry.contains(&format!("\nIcon=/home/me/.config/app/app-icon/1a/512.png\nTryExec=logbook\n{ORIGINAL}=logbook\n")),
            "{entry}"
        );
        assert!(entry.contains("StartupWMClass=logbook\n") && entry.contains("Exec=logbook\n") && entry.contains("Name=Logbook\n"));
        assert!(!entry.lines().any(|l| l == "Icon=logbook") && untouched(&entry));
        assert_eq!(icons_in_use(&h.dirs), [picture("1a")]);
        // Again (a launch): the same; a new picture replaces the path.
        assert_eq!(show_in_menu(&h.dirs, &picture("1a")), Outside::Done);
        assert_eq!(read(&ours), entry);
        assert_eq!(show_in_menu(&h.dirs, &picture("2b")), Outside::Done);
        assert_eq!(read(&ours).lines().filter(|l| l.starts_with("Icon=")).count(), 1);
        assert!(read(&ours).contains(&format!("Icon={}\n", picture("2b").display())));
        forget_in_menu(&h.dirs).unwrap();
        assert!(!ours.exists());
        assert!(icons_in_use(&h.dirs).is_empty());
    }

    #[test]
    fn keeps_what_the_person_changed_in_logbooks_copy() {
        let h = home(true, None);
        let ours = h.dirs.ours().unwrap();
        show_in_menu(&h.dirs, &picture("1a"));
        // A menu editor renames it, and keeps the keys it doesn't know; going back straight away
        // keeps the name and gives the package's icon.
        fs::write(&ours, read(&ours).replace("Name=Logbook", "Name=My diary")).unwrap();
        forget_in_menu(&h.dirs).unwrap();
        assert!(read(&ours).contains("Name=My diary\n") && read(&ours).contains("\nIcon=logbook\n") && !read(&ours).contains(ORIGINAL));
        assert!(!icons_in_use(&h.dirs).iter().any(|p| p.starts_with(PICTURES)));
        assert_eq!(show_in_menu(&h.dirs, &picture("2b")), Outside::Done);
        let entry = read(&ours);
        assert!(entry.contains("Name=My diary\n") && entry.contains(&format!("Icon={}\n", picture("2b").display())));
        assert!(entry.contains(&format!("{ORIGINAL}=logbook\n")), "{entry}");
        forget_in_menu(&h.dirs).unwrap();
        let entry = read(&ours);
        assert!(entry.contains("Name=My diary\n") && entry.contains("\nIcon=logbook\n") && !entry.contains(ORIGINAL), "{entry}");
        // Hidden from the menu by the person: left as it is.
        fs::write(&ours, format!("{entry}NoDisplay=true\n")).unwrap();
        let hidden = read(&ours);
        assert_eq!(show_in_menu(&h.dirs, &picture("3c")), Outside::Missing);
        assert_eq!(read(&ours), hidden);
    }

    #[test]
    fn changes_only_the_icon_of_an_entry_the_person_made() {
        let h = home(true, None);
        let ours = h.dirs.ours().unwrap();
        let theirs = "[Desktop Entry]\nName=My journal\nExec=logbook --profile work\nIcon=accessories-text-editor\n";
        fs::write(&ours, theirs).unwrap();
        assert_eq!(show_in_menu(&h.dirs, &picture("1a")), Outside::Done);
        assert_eq!(
            read(&ours),
            format!(
                "[Desktop Entry]\n{ORIGINAL}=accessories-text-editor\nName=My journal\nExec=logbook --profile work\nIcon={}\n",
                picture("1a").display()
            )
        );
        // A second picture keeps the first icon to go back to.
        show_in_menu(&h.dirs, &picture("2b"));
        assert!(read(&ours).contains(&format!("{ORIGINAL}=accessories-text-editor\n")));
        assert_eq!(icons_in_use(&h.dirs), [picture("2b")]);
        forget_in_menu(&h.dirs).unwrap();
        assert_eq!(read(&ours), theirs);
        // One that isn't text Logbook can read is left alone.
        fs::write(&ours, b"[Desktop Entry]\nComment=Caf\xe9\nExec=logbook\n").unwrap();
        assert_eq!(show_in_menu(&h.dirs, &picture("1a")), Outside::Failed);
        assert_eq!(fs::read(&ours).unwrap(), b"[Desktop Entry]\nComment=Caf\xe9\nExec=logbook\n");
    }

    #[test]
    fn has_no_menu_entry_to_change_outside_a_package() {
        let h = home(false, None);
        assert_eq!(show_in_menu(&h.dirs, &picture("1a")), Outside::Missing);
        assert!(!h.dirs.ours().unwrap().exists());
    }

    #[test]
    fn changes_an_appimages_entry_only_when_a_menu_tool_made_one() {
        let h = home(false, Some("/home/me/Apps/Logbook 0.9.AppImage"));
        assert_eq!(show_in_menu(&h.dirs, &picture("1a")), Outside::Missing);
        let apps = h.dirs.applications().unwrap();
        // Another AppImage's entry, and Logbook's (AppImageLauncher's way).
        let other = "[Desktop Entry]\nName=Other\nExec=/home/me/Apps/Other.AppImage\nIcon=appimagekit_0123_other\n";
        fs::write(apps.join("appimagekit_0123-Other.desktop"), other).unwrap();
        let path = apps.join("appimagekit_4567-Logbook.desktop");
        let entry = "[Desktop Entry]\nName=Logbook\nExec=\"/home/me/Apps/Logbook 0.9.AppImage\" %U\nTryExec=/home/me/Apps/Logbook 0.9.AppImage\nIcon=appimagekit_4567_logbook\n\n[Desktop Action New]\nIcon=new\n";
        fs::write(&path, entry).unwrap();
        assert_eq!(show_in_menu(&h.dirs, &picture("1a")), Outside::Done);
        let changed = read(&path);
        assert!(
            changed.contains(&format!("Icon={}\n", picture("1a").display()))
                && changed.contains("Icon=new\n")
                && changed.contains(&format!("{ORIGINAL}=appimagekit_4567_logbook\n"))
        );
        assert_eq!(read(&apps.join("appimagekit_0123-Other.desktop")), other);
        assert!(!h.dirs.ours().unwrap().exists());
        forget_in_menu(&h.dirs).unwrap();
        assert_eq!(read(&path), entry);
        // Already showing a picture of Logbook's with nothing noted (a hand-edited entry): going
        // back takes the picture off rather than leaving a deleted file named.
        fs::write(&path, entry.replace("Icon=appimagekit_4567_logbook", &format!("Icon={}", picture("0z").display()))).unwrap();
        show_in_menu(&h.dirs, &picture("1a"));
        assert!(read(&path).contains(&format!("{ORIGINAL}=\n")));
        forget_in_menu(&h.dirs).unwrap();
        assert!(!read(&path).lines().any(|l| l.starts_with("Icon=/")) && !read(&path).contains(ORIGINAL));
    }

    #[test]
    fn reads_exec_lines_and_keys() {
        assert_eq!(first_word("logbook %U").as_deref(), Some("logbook"));
        assert_eq!(first_word(r#""/a b/Log\"book" %U"#).as_deref(), Some("/a b/Log\"book"));
        assert_eq!(first_word(r#""unclosed"#), None);
        assert_eq!(escape("a\\b\nc"), "a\\\\b\\nc");
        let text = "[Desktop Entry]\nIcon[de]=x\nIcon=y\n[Desktop Action A]\nIcon=z\n";
        assert_eq!(main_value(text, "Icon").as_deref(), Some("y"));
        assert_eq!(set_key(text, "Icon", "n"), "[Desktop Entry]\nIcon[de]=x\nIcon=n\n[Desktop Action A]\nIcon=z\n");
        assert_eq!(remove_key(text, "Icon"), "[Desktop Entry]\nIcon[de]=x\n[Desktop Action A]\nIcon=z\n");
    }
}
