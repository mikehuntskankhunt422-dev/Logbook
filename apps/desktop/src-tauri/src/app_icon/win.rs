//! Windows (D101). Tauri gives the window only a small icon (title bar), so the big one (Alt+Tab,
//! the taskbar button) is set here too. A pinned taskbar item, the Start menu and the desktop show
//! their shortcut's icon, running or not, so Logbook's shortcuts are pointed at the picture's
//! `.ico`; an update leaves shortcuts as they are, and a launch puts the picture back on any that
//! were made again (a reinstall).

use std::ffi::OsString;
use std::os::windows::ffi::OsStringExt;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::{AppHandle, Manager};

use super::Outside;
use windows::core::{Interface, Result, GUID, HSTRING};
use windows::Win32::Foundation::{HWND, LPARAM, RPC_E_CHANGED_MODE, WPARAM};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, IPersistFile, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED,
    COINIT_DISABLE_OLE1DDE, STGM_READ, STGM_READWRITE,
};
use windows::Win32::System::Environment::ExpandEnvironmentStringsW;
use windows::Win32::UI::HiDpi::{GetDpiForWindow, GetSystemMetricsForDpi};
use windows::Win32::UI::Shell::{
    FOLDERID_Desktop, FOLDERID_Programs, FOLDERID_UserPinned, IShellLinkW, SHChangeNotify, SHGetKnownFolderPath, ShellLink,
    KF_FLAG_DEFAULT, SHCNE_ASSOCCHANGED, SHCNE_UPDATEITEM, SHCNF_FLUSHNOWAIT, SHCNF_IDLIST, SHCNF_PATHW,
};
use windows::Win32::UI::WindowsAndMessaging::{
    DestroyIcon, LoadImageW, SendMessageW, HICON, ICON_BIG, ICON_SMALL, IMAGE_ICON, LR_LOADFROMFILE, SM_CXICON, SM_CXSMICON, WM_SETICON,
};

/// The window's icons from the `.ico`, at the window's DPI. On the main thread, as windows want.
pub fn show_in_window(app: &AppHandle, ico: &Path) -> std::result::Result<(), String> {
    let window = app.get_webview_window("main").ok_or("no window")?;
    let (w, ico) = (window.clone(), ico.to_path_buf());
    window
        .run_on_main_thread(move || {
            if let Err(e) = w.hwnd().map_err(|e| e.to_string()).and_then(|h| set_window_icons(h, &ico).map_err(|e| e.to_string())) {
                eprintln!("Logbook couldn't set its window's icon: {e}");
            }
        })
        .map_err(|e| e.to_string())
}

pub fn forget_in_window(app: &AppHandle) -> std::result::Result<(), String> {
    let window = app.get_webview_window("main").ok_or("no window")?;
    let w = window.clone();
    window
        .run_on_main_thread(move || {
            if let Ok(h) = w.hwnd() {
                reset_window_icons(h);
            }
        })
        .map_err(|e| e.to_string())
}

/// Points Logbook's shortcuts at the `.ico`.
pub fn show_on_shortcuts(ico: &Path) -> Outside {
    let Ok(exe) = std::env::current_exe() else { return Outside::Failed };
    match set_shortcut_icons(&exe, ico, &candidate_shortcuts()) {
        Ok(Done { found: 0, .. }) => Outside::Missing,
        Ok(Done { failed: 0, .. }) => Outside::Done,
        Ok(_) => Outside::Failed,
        Err(e) => {
            eprintln!("Logbook couldn't change its shortcuts: {e}");
            Outside::Failed
        }
    }
}

/// Logbook's shortcuts back to the app's own icon.
pub fn forget_on_shortcuts() -> std::result::Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    match set_shortcut_icons(&exe, &exe, &candidate_shortcuts()) {
        Ok(Done { failed: 0, .. }) => Ok(()),
        Ok(_) => Err("Some of Logbook's shortcuts couldn't be changed back. Try again in a moment.".into()),
        Err(e) => Err(format!("Logbook's shortcuts couldn't be changed back: {e}")),
    }
}

/// The icons Logbook's shortcuts show, so they aren't deleted while they do.
pub fn icons_in_use() -> Vec<PathBuf> {
    let (Ok(exe), Ok(_com)) = (std::env::current_exe(), Com::init()) else { return Vec::new() };
    candidate_shortcuts()
        .iter()
        .filter_map(|lnk| read_link(lnk).ok().filter(|l| same_file(&l.target, &exe)).map(|l| l.icon).filter(|i| !i.as_os_str().is_empty()))
        .collect()
}

/// What a shortcut opens and the icon it names (empty for the target's own).
struct LinkInfo {
    target: PathBuf,
    icon: PathBuf,
    index: i32,
}

/// Read only: a shortcut of another app's that won't open this way is none of Logbook's business.
fn read_link(lnk: &Path) -> Result<LinkInfo> {
    unsafe {
        let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)?;
        let file: IPersistFile = link.cast()?;
        file.Load(&HSTRING::from(lnk), STGM_READ)?;
        let mut target = vec![0u16; 32768];
        link.GetPath(&mut target, std::ptr::null_mut(), 0)?;
        let mut icon = vec![0u16; 32768];
        let mut index = 0i32;
        link.GetIconLocation(&mut icon, &mut index)?;
        Ok(LinkInfo { target: wide_path(&target), icon: expanded(wide_path(&icon)), index })
    }
}

/// COM on this thread, released on drop when this call started it. A thread already in the
/// multithreaded apartment (RPC_E_CHANGED_MODE) is used as it is: shell links work in either.
struct Com(bool);

impl Com {
    fn init() -> Result<Com> {
        let hr = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE) };
        if hr == RPC_E_CHANGED_MODE {
            return Ok(Com(false));
        }
        hr.ok()?;
        Ok(Com(true))
    }
}

impl Drop for Com {
    fn drop(&mut self) {
        if self.0 {
            unsafe { CoUninitialize() }
        }
    }
}

fn known_folder(id: &GUID) -> Option<PathBuf> {
    unsafe {
        let p = SHGetKnownFolderPath(id, KF_FLAG_DEFAULT, None).ok()?;
        let path = PathBuf::from(OsString::from_wide(p.as_wide()));
        CoTaskMemFree(Some(p.0 as *const _));
        Some(path)
    }
}

fn collect_links(dir: &Path, depth: u32, out: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if depth > 0 {
                collect_links(&path, depth - 1, out);
            }
        } else if path.extension().is_some_and(|e| e.eq_ignore_ascii_case("lnk")) {
            out.push(path);
        }
    }
}

/// Where Logbook's shortcuts can be, whatever they're called (the installer's, copies the person
/// made, ones they moved): the Start menu and folders in it, the desktop, and the taskbar's pinned
/// copies. Only those that open Logbook's own exe are changed.
fn candidate_shortcuts() -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Some(programs) = known_folder(&FOLDERID_Programs) {
        collect_links(&programs, 2, &mut out);
    }
    if let Some(desktop) = known_folder(&FOLDERID_Desktop) {
        collect_links(&desktop, 0, &mut out);
    }
    if let Some(pinned) = known_folder(&FOLDERID_UserPinned) {
        collect_links(&pinned.join("TaskBar"), 0, &mut out);
        collect_links(&pinned.join("ImplicitAppShortcuts"), 2, &mut out);
    }
    out
}

/// An icon path the shell may hand back with %APPDATA% and the like still in it.
fn expanded(path: PathBuf) -> PathBuf {
    if !path.to_string_lossy().contains('%') {
        return path;
    }
    let mut out = vec![0u16; 32768];
    let len = unsafe { ExpandEnvironmentStringsW(&HSTRING::from(path.as_path()), Some(&mut out)) } as usize;
    if len == 0 || len > out.len() {
        return path;
    }
    wide_path(&out)
}

fn same_file(a: &Path, b: &Path) -> bool {
    // Names first: finding out what a shortcut to an unplugged network drive is can take a minute.
    let name = |p: &Path| p.file_name().map(|n| n.to_string_lossy().to_lowercase());
    if name(a) != name(b) {
        return false;
    }
    match (std::fs::canonicalize(a), std::fs::canonicalize(b)) {
        (Ok(a), Ok(b)) => a == b,
        _ => a.as_os_str().to_string_lossy().eq_ignore_ascii_case(&b.as_os_str().to_string_lossy()),
    }
}

fn wide_path(buffer: &[u16]) -> PathBuf {
    let len = buffer.iter().position(|&c| c == 0).unwrap_or(buffer.len());
    PathBuf::from(OsString::from_wide(&buffer[..len]))
}

enum Link {
    /// Not one of Logbook's.
    Other,
    /// Logbook's, already showing that icon.
    Unchanged,
    Changed,
}

/// Sets one shortcut's icon to the first in `icon` when it opens `exe`.
fn set_link_icon(lnk: &Path, exe: &Path, icon: &Path) -> Result<Link> {
    let Ok(info) = read_link(lnk) else { return Ok(Link::Other) };
    if !same_file(&info.target, exe) {
        return Ok(Link::Other);
    }
    // No icon of its own is the exe's icon, which is where going back leaves it.
    let shows = if info.icon.as_os_str().is_empty() { icon == exe } else { info.index == 0 && same_file(&info.icon, icon) };
    if shows {
        return Ok(Link::Unchanged);
    }
    unsafe {
        let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)?;
        let file: IPersistFile = link.cast()?;
        let lnk_w = HSTRING::from(lnk);
        file.Load(&lnk_w, STGM_READWRITE)?;
        link.SetIconLocation(&HSTRING::from(icon), 0)?;
        file.Save(&lnk_w, true)?;
    }
    Ok(Link::Changed)
}

struct Done {
    /// Logbook's shortcuts found.
    found: usize,
    /// Of those, the ones that couldn't be changed.
    failed: usize,
}

/// Points every Logbook shortcut at `icon` (with `icon = exe`, back at the app's own), then tells
/// Explorer. Blocking: off the main thread.
fn set_shortcut_icons(exe: &Path, icon: &Path, candidates: &[PathBuf]) -> Result<Done> {
    let _com = Com::init()?;
    let mut done = Done { found: 0, failed: 0 };
    let mut changed = Vec::new();
    for lnk in candidates {
        match set_link_icon(lnk, exe, icon) {
            Ok(Link::Other) => {}
            Ok(Link::Unchanged) => done.found += 1,
            Ok(Link::Changed) => {
                done.found += 1;
                changed.push(lnk);
            }
            Err(e) => {
                eprintln!("Logbook couldn't change {}: {e}", lnk.display());
                done.found += 1;
                done.failed += 1;
            }
        }
    }
    if !changed.is_empty() {
        unsafe {
            for lnk in changed {
                let w = HSTRING::from(lnk.as_path());
                SHChangeNotify(SHCNE_UPDATEITEM, SHCNF_PATHW | SHCNF_FLUSHNOWAIT, Some(w.as_ptr() as *const _), None);
            }
            // "invalidate the icon and thumbnail cache" (SHChangeNotify's remarks)
            SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, None, None);
        }
    }
    Ok(done)
}

/// The icons this module gave the window, kept as isize because HICON isn't Send.
struct WindowIcons {
    big: isize,
    small: isize,
    /// Tauri's own small icon, still Tauri's (never destroyed here).
    original_small: isize,
}

static ICONS: Mutex<Option<WindowIcons>> = Mutex::new(None);

fn send_icon(hwnd: HWND, which: u32, icon: isize) -> isize {
    unsafe { SendMessageW(hwnd, WM_SETICON, Some(WPARAM(which as usize)), Some(LPARAM(icon))).0 }
}

fn set_window_icons(hwnd: HWND, ico: &Path) -> Result<()> {
    unsafe {
        let dpi = GetDpiForWindow(hwnd);
        let (big_px, small_px) = (GetSystemMetricsForDpi(SM_CXICON, dpi), GetSystemMetricsForDpi(SM_CXSMICON, dpi));
        let path = HSTRING::from(ico);
        let big = LoadImageW(None, &path, IMAGE_ICON, big_px, big_px, LR_LOADFROMFILE)?.0 as isize;
        let small = LoadImageW(None, &path, IMAGE_ICON, small_px, small_px, LR_LOADFROMFILE)?.0 as isize;
        send_icon(hwnd, ICON_BIG, big);
        let previous_small = send_icon(hwnd, ICON_SMALL, small);
        let mut icons = ICONS.lock().unwrap_or_else(|e| e.into_inner());
        let original_small = match icons.take() {
            // Replacing an earlier picture: its icons go, Tauri's stays.
            Some(old) => {
                let _ = DestroyIcon(HICON(old.big as _));
                let _ = DestroyIcon(HICON(old.small as _));
                old.original_small
            }
            None => previous_small,
        };
        *icons = Some(WindowIcons { big, small, original_small });
    }
    Ok(())
}

/// As Tauri left it: no big icon (the taskbar uses the exe's), Tauri's small one.
fn reset_window_icons(hwnd: HWND) {
    let mut icons = ICONS.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(old) = icons.take() {
        send_icon(hwnd, ICON_BIG, 0);
        send_icon(hwnd, ICON_SMALL, old.original_small);
        unsafe {
            let _ = DestroyIcon(HICON(old.big as _));
            let _ = DestroyIcon(HICON(old.small as _));
        }
    }
}
