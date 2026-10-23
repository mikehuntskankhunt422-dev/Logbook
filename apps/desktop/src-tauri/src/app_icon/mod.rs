//! The person's own picture as Logbook's icon (D101). The page crops it and draws it at the sizes
//! this computer needs (`SIZES`); this side keeps those pictures in the app's config folder, so
//! they belong to the computer and not to a journal, and puts them where the system shows the
//! app's icon:
//!
//! - Windows (win.rs): the window (title bar, taskbar button, Alt+Tab), and Logbook's shortcuts on
//!   the Start menu, the desktop and the taskbar, which is what pinned and closed icons come from.
//! - macOS (mac.rs): the Dock while Logbook is open, and Logbook in Applications (Finder, and the
//!   Dock when it's closed).
//! - Linux (linux.rs): the window, and Logbook's entry in the app menu, which is what the dock and
//!   app grid draw.
//!
//! Window and Dock icons last only while Logbook runs, and updates put the usual icon back on the
//! app itself, so `at_launch` applies the picture again every time Logbook starts.

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "macos")]
mod mac;
#[cfg(windows)]
mod win;

use crate::{body, folder, header, AppState};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::ipc::Request;
use tauri::{AppHandle, Manager, State};

/// The square PNGs the page sends: Windows' icon sizes from 16 to 256 px (an `.ico` holds them
/// all); 1024 px for macOS; 256 for Linux windows and 512 for its app menu. 128 is shown in
/// Settings everywhere.
#[cfg(windows)]
pub const SIZES: &[u32] = &[16, 20, 24, 30, 32, 36, 40, 48, 60, 64, 72, 80, 96, 128, 256];
#[cfg(target_os = "macos")]
pub const SIZES: &[u32] = &[128, 1024];
#[cfg(target_os = "linux")]
pub const SIZES: &[u32] = &[128, 256, 512];

const PREVIEW: u32 = 128;
/// Far more than any picture's icons take: a limit on what the page can make this side keep.
const MOST: usize = 64 << 20;

#[cfg(windows)]
const OS: &str = "windows";
#[cfg(target_os = "macos")]
const OS: &str = "macos";
#[cfg(target_os = "linux")]
const OS: &str = "linux";

/// Where the pictures are: one folder per picture chosen, a new name each time, as Explorer and
/// the desktops keep icons by file path.
fn icons_dir(config_file: &Path) -> PathBuf {
    config_file.with_file_name("app-icon")
}

fn png_path(picture: &Path, size: u32) -> PathBuf {
    picture.join(format!("{size}.png"))
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    os: &'static str,
    sizes: &'static [u32],
    /// The picture in use, at 128 px (base64 PNG); None for the usual icon.
    picture: Option<String>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Applied {
    /// Whether the picture reached the shortcuts (Windows), Logbook in Applications (macOS) or
    /// the app menu (Linux) as well as the window or Dock.
    everywhere: bool,
}

/// What Settings shows: which sizes to make here, and the picture in use.
#[tauri::command]
pub fn app_icon_status(state: State<'_, AppState>) -> Status {
    use base64::Engine;
    let picture = folder::load(&state.config_file)
        .app_icon
        .and_then(|id| fs::read(png_path(&icons_dir(&state.config_file).join(id), PREVIEW)).ok())
        .map(|png| base64::engine::general_purpose::STANDARD.encode(png));
    Status { os: OS, sizes: SIZES, picture }
}

/// The person's picture becomes the app's icon: one PNG for each of `SIZES`, back to back, with
/// `x-parts` saying which and how long ("16:1234,20:1456,…").
#[tauri::command]
pub async fn app_icon_set(request: Request<'_>, app: AppHandle, state: State<'_, AppState>) -> Result<Applied, String> {
    let data = body(&request)?;
    let pngs = split(&header(&request, "x-parts")?, &data)?;
    let dir = icons_dir(&state.config_file);
    let id = store(&dir, &pngs)?;
    let picture = dir.join(&id);
    show_in_window(&app, &picture)?;
    let config_file = state.config_file.clone();
    let everywhere = tauri::async_runtime::spawn_blocking(move || {
        let everywhere = show_outside(&config_file, &picture, true);
        let mut before = None;
        folder::update(&config_file, |c| before = c.app_icon.replace(id.clone()))?;
        // The picture before stays until the next one: a shortcut or menu entry that couldn't be
        // changed this time still shows it, where a deleted file would show a blank icon.
        tidy(&dir, &[Some(id.as_str()), before.as_deref()]);
        Ok::<_, String>(everywhere)
    })
    .await
    .map_err(|e| e.to_string())??;
    Ok(Applied { everywhere })
}

/// Back to the usual icon everywhere, and the pictures deleted.
#[tauri::command]
pub async fn app_icon_reset(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let config_file = state.config_file.clone();
    tauri::async_runtime::spawn_blocking(move || {
        // Outside the window first: if that fails the picture stays chosen, for another try.
        forget_outside(&config_file)?;
        folder::update(&config_file, |c| {
            c.app_icon = None;
            c.app_icon_on_bundle = false;
            c.app_icon_entry = None;
        })?;
        tidy(&icons_dir(&config_file), &[]);
        Ok::<_, String>(())
    })
    .await
    .map_err(|e| e.to_string())??;
    forget_in_window(&app)
}

/// At every launch, once the window is up: the picture back on the window or Dock, and, off the
/// main thread, back on whatever an update or a reinstall reset.
pub fn at_launch(app: &AppHandle) {
    let config_file = app.state::<AppState>().config_file.clone();
    let Some(id) = folder::load(&config_file).app_icon else { return };
    let picture = icons_dir(&config_file).join(id);
    if !picture.is_dir() {
        return;
    }
    if let Err(e) = show_in_window(app, &picture) {
        eprintln!("Logbook couldn't show its icon: {e}");
    }
    std::thread::spawn(move || {
        show_outside(&config_file, &picture, false);
    });
}

/// Checks the parts against `SIZES` and each PNG's own size (its IHDR, no decoding needed).
fn split<'a>(parts: &str, data: &'a [u8]) -> Result<Vec<(u32, &'a [u8])>, String> {
    if data.len() > MOST {
        return Err("That picture is too big to use as an icon.".into());
    }
    let bad = || "The icon's pictures didn't arrive whole.".to_string();
    let (mut out, mut at) = (Vec::new(), 0usize);
    for part in parts.split(',') {
        let (size, len) = part.split_once(':').ok_or_else(bad)?;
        let (size, len): (u32, usize) = (size.parse().map_err(|_| bad())?, len.parse().map_err(|_| bad())?);
        let end = at.checked_add(len).ok_or_else(bad)?;
        let png = data.get(at..end).ok_or_else(bad)?;
        if !SIZES.contains(&size) || out.iter().any(|(s, _)| *s == size) || png_size(png) != Some((size, size)) {
            return Err(bad());
        }
        out.push((size, png));
        at = end;
    }
    if at != data.len() || out.len() != SIZES.len() {
        return Err(bad());
    }
    Ok(out)
}

fn png_size(png: &[u8]) -> Option<(u32, u32)> {
    let ok = png.len() >= 24 && png[..8] == *b"\x89PNG\r\n\x1a\n" && png[12..16] == *b"IHDR";
    ok.then(|| (u32::from_be_bytes(png[16..20].try_into().unwrap()), u32::from_be_bytes(png[20..24].try_into().unwrap())))
}

/// Keeps the pictures in a new folder; answers its name.
fn store(dir: &Path, pngs: &[(u32, &[u8])]) -> Result<String, String> {
    let id = format!("{:08x}", crate::journal_fs::random_u32());
    let picture = dir.join(&id);
    let kept = (|| {
        for (size, png) in pngs {
            crate::journal_fs::write_atomic(&png_path(&picture, *size), png)?;
        }
        #[cfg(windows)]
        crate::journal_fs::write_atomic(&picture.join("icon.ico"), &ico(pngs)?)?;
        Ok::<_, std::io::Error>(())
    })();
    if let Err(e) = kept {
        let _ = fs::remove_dir_all(&picture);
        return Err(format!("Couldn't keep the picture: {e}"));
    }
    Ok(id)
}

/// Deletes every picture folder but those in `keep`.
fn tidy(dir: &Path, keep: &[Option<&str>]) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        if !keep.iter().flatten().any(|k| entry.file_name() == *k) {
            let _ = fs::remove_dir_all(entry.path());
        }
    }
}

/// An `.ico` with every size: plain bitmaps below 256 px, which every part of Windows reads, and
/// PNG at 256, as Microsoft's guidelines have it.
#[cfg_attr(not(windows), allow(dead_code))]
fn ico(pngs: &[(u32, &[u8])]) -> std::io::Result<Vec<u8>> {
    let mut dir = ico::IconDir::new(ico::ResourceType::Icon);
    for (size, png) in pngs {
        let image = ico::IconImage::read_png(*png)?;
        dir.add_entry(if *size >= 256 { ico::IconDirEntry::encode_as_png(&image)? } else { ico::IconDirEntry::encode_as_bmp(&image)? });
    }
    let mut out = Vec::new();
    dir.write(&mut out)?;
    Ok(out)
}

// ── each system ──────────────────────────────────────────────────────────────────────────────

/// The window's or the Dock's icon, for as long as Logbook runs.
fn show_in_window(app: &AppHandle, picture: &Path) -> Result<(), String> {
    #[cfg(windows)]
    return win::show_in_window(app, &picture.join("icon.ico"));
    #[cfg(target_os = "macos")]
    return mac::show_in_dock(app, Some(fs::read(png_path(picture, 1024)).map_err(|e| e.to_string())?));
    #[cfg(target_os = "linux")]
    return linux::show_in_window(app, &png_path(picture, 256));
}

fn forget_in_window(app: &AppHandle) -> Result<(), String> {
    #[cfg(windows)]
    return win::forget_in_window(app);
    #[cfg(target_os = "macos")]
    return mac::show_in_dock(app, None);
    #[cfg(target_os = "linux")]
    return linux::forget_in_window(app);
}

/// Shortcuts, Logbook in Applications, or the app menu; blocking. `chosen` when the person has
/// just picked the picture, as opposed to a launch putting it back. Answers whether it got there.
fn show_outside(config_file: &Path, picture: &Path, chosen: bool) -> bool {
    #[cfg(windows)]
    {
        let _ = (config_file, chosen);
        win::show_on_shortcuts(&picture.join("icon.ico"))
    }
    #[cfg(target_os = "macos")]
    {
        // A launch tries again only when an update took it off; after a refusal (a copy of
        // Logbook this account can't change), only choosing a picture asks again.
        let tried = folder::load(config_file).app_icon_on_bundle;
        if !chosen && (!tried || mac::bundle_has_icon()) {
            return tried;
        }
        let on = fs::read(png_path(picture, 1024)).is_ok_and(|png| mac::show_on_bundle(Some(&png)));
        let _ = folder::update(config_file, |c| c.app_icon_on_bundle = on);
        on
    }
    #[cfg(target_os = "linux")]
    {
        let _ = chosen;
        let earlier = folder::load(config_file).app_icon_entry;
        let (on, edited) = linux::show_in_menu(&linux::Dirs::from_env(), &png_path(picture, 512), earlier.clone());
        if edited != earlier {
            let _ = folder::update(config_file, |c| c.app_icon_entry = edited.clone());
        }
        on
    }
}

fn forget_outside(config_file: &Path) -> Result<(), String> {
    #[cfg(windows)]
    {
        let _ = config_file;
        win::forget_on_shortcuts()
    }
    #[cfg(target_os = "macos")]
    {
        let _ = config_file;
        mac::show_on_bundle(None);
        Ok(())
    }
    #[cfg(target_os = "linux")]
    {
        linux::forget_in_menu(&linux::Dirs::from_env(), folder::load(config_file).app_icon_entry)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A PNG header claiming `size`×`size`: all `split` reads.
    fn png(size: u32, filler: usize) -> Vec<u8> {
        let mut out = b"\x89PNG\r\n\x1a\n\0\0\0\x0dIHDR".to_vec();
        out.extend(size.to_be_bytes());
        out.extend(size.to_be_bytes());
        out.extend(vec![0; filler]);
        out
    }

    fn sent(sizes: &[u32]) -> (String, Vec<u8>) {
        let pngs: Vec<_> = sizes.iter().map(|s| (*s, png(*s, *s as usize % 7))).collect();
        let parts = pngs.iter().map(|(s, p)| format!("{s}:{}", p.len())).collect::<Vec<_>>().join(",");
        (parts, pngs.into_iter().flat_map(|(_, p)| p).collect())
    }

    #[test]
    fn takes_exactly_the_sizes_this_computer_needs() {
        let (parts, data) = sent(SIZES);
        let pngs = split(&parts, &data).unwrap();
        assert_eq!(pngs.iter().map(|(s, _)| *s).collect::<Vec<_>>(), SIZES);
        // Any order.
        let mut reversed = SIZES.to_vec();
        reversed.reverse();
        let (parts, data) = sent(&reversed);
        assert!(split(&parts, &data).is_ok());
        // A size missing, one twice, one not wanted, a PNG of the wrong size, bytes left over.
        let (parts, data) = sent(&SIZES[1..]);
        assert!(split(&parts, &data).is_err());
        let (parts, data) = sent(&[SIZES, &SIZES[..1]].concat());
        assert!(split(&parts, &data).is_err());
        let (parts, data) = sent(&[SIZES, &[3]].concat());
        assert!(split(&parts, &data).is_err());
        let (parts, mut data) = sent(SIZES);
        data.push(0);
        assert!(split(&parts, &data).is_err());
        let wrong = parts.replacen(&format!("{}:", SIZES[0]), &format!("{}:", SIZES[1]), 1);
        assert!(split(&wrong, &sent(SIZES).1).is_err());
        assert!(split("16:99999999999999999999", &[]).is_err());
        assert!(split("", &[]).is_err());
    }

    #[test]
    fn keeps_each_picture_in_a_folder_of_its_own() {
        let dir = tempfile::tempdir().unwrap();
        let (parts, data) = sent(SIZES);
        let pngs = split(&parts, &data).unwrap();
        // The test PNGs are headers only, so no .ico on Windows: write the PNGs directly.
        let store_pngs = |id: &str| {
            for (size, png) in &pngs {
                crate::journal_fs::write_atomic(&png_path(&dir.path().join(id), *size), png).unwrap();
            }
        };
        store_pngs("aaaa0001");
        store_pngs("aaaa0002");
        store_pngs("aaaa0003");
        tidy(dir.path(), &[Some("aaaa0003"), Some("aaaa0002")]);
        let mut left: Vec<_> = fs::read_dir(dir.path()).unwrap().map(|e| e.unwrap().file_name()).collect();
        left.sort();
        assert_eq!(left, ["aaaa0002", "aaaa0003"]);
        assert!(png_path(&dir.path().join("aaaa0003"), PREVIEW).is_file());
        tidy(dir.path(), &[Some("aaaa0003"), None]);
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
        tidy(dir.path(), &[]);
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 0);
    }

    #[test]
    fn makes_an_ico_with_every_size() {
        let pngs: Vec<(u32, Vec<u8>)> = [16u32, 32, 256].iter().map(|s| (*s, real_png(*s))).collect();
        let refs: Vec<(u32, &[u8])> = pngs.iter().map(|(s, p)| (*s, p.as_slice())).collect();
        let data = ico(&refs).unwrap();
        let dir = ico::IconDir::read(std::io::Cursor::new(data)).unwrap();
        let entries: Vec<_> = dir.entries().iter().map(|e| (e.width(), e.is_png())).collect();
        assert_eq!(entries, [(16, false), (32, false), (256, true)]);
        assert_eq!(dir.entries()[1].decode().unwrap().rgba_data()[..4], [200, 30, 60, 255]);
    }

    /// A real one-colour PNG, through the ico crate's own encoder.
    fn real_png(size: u32) -> Vec<u8> {
        let rgba = [200u8, 30, 60, 255].repeat((size * size) as usize);
        let mut out = Vec::new();
        ico::IconImage::from_rgba_data(size, size, rgba).write_png(&mut out).unwrap();
        out
    }
}
