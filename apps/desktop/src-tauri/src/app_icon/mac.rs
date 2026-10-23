//! macOS (D101). Tauri has no app icon to set (a window's does nothing there), so this goes to
//! AppKit: NSApplication's icon is the Dock tile and Cmd+Tab while Logbook runs; NSWorkspace's
//! custom icon on Logbook.app (an `Icon\r` file beside `Contents`, which code signing allows) is
//! what Finder, Launchpad and the Dock show when it's closed. An update replaces Logbook.app and
//! drops that, so a launch puts it back.

use objc2::rc::Retained;
use objc2::{AnyThread, MainThreadMarker};
use objc2_app_kit::{NSApplication, NSImage, NSWorkspace, NSWorkspaceIconCreationOptions};
use objc2_foundation::{NSData, NSString};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::AppHandle;

fn image(png: &[u8]) -> Option<Retained<NSImage>> {
    NSImage::initWithData(NSImage::alloc(), &NSData::with_bytes(png))
}

/// The Dock tile while Logbook runs; None for the usual one. AppKit wants the main thread.
pub fn show_in_dock(app: &AppHandle, png: Option<Vec<u8>>) -> Result<(), String> {
    app.run_on_main_thread(move || {
        let Some(mtm) = MainThreadMarker::new() else { return };
        let app = NSApplication::sharedApplication(mtm);
        match png.as_deref().map(image) {
            // SAFETY: applicationIconImage is null_resettable (NSApplication.h), so None is allowed.
            Some(Some(icon)) => unsafe { app.setApplicationIconImage(Some(&icon)) },
            Some(None) => eprintln!("Logbook couldn't read its icon"),
            None => unsafe { app.setApplicationIconImage(None) },
        }
    })
    .map_err(|e| e.to_string())
}

/// `/Applications/Logbook.app`, or wherever it is; None when not running from an app bundle
/// (`tauri dev`).
fn bundle() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let macos = exe.parent()?;
    let contents = macos.parent()?;
    let bundle = contents.parent()?;
    let ok = macos.file_name()? == "MacOS" && contents.file_name()? == "Contents" && bundle.extension()? == "app";
    ok.then(|| bundle.to_path_buf())
}

pub fn bundle_has_icon() -> bool {
    bundle().is_some_and(|b| b.join("Icon\r").exists())
}

/// NSWorkspace's setIcon: any thread, but one at a time.
static ONE_AT_A_TIME: Mutex<()> = Mutex::new(());

/// The picture on Logbook.app, or None to take it off. False when macOS doesn't allow it (a copy
/// another account installed, or one run straight from the disk image).
pub fn show_on_bundle(png: Option<&[u8]>) -> bool {
    let Some(bundle) = bundle() else { return false };
    let _one = ONE_AT_A_TIME.lock().unwrap_or_else(|e| e.into_inner());
    let path = NSString::from_str(&bundle.to_string_lossy());
    let workspace = NSWorkspace::sharedWorkspace();
    let done = match png {
        Some(png) => {
            image(png).is_some_and(|icon| workspace.setIcon_forFile_options(Some(&icon), &path, NSWorkspaceIconCreationOptions(0)))
        }
        None => workspace.setIcon_forFile_options(None, &path, NSWorkspaceIconCreationOptions(0)),
    };
    if done {
        workspace.noteFileSystemChanged_(&path);
    }
    done
}
