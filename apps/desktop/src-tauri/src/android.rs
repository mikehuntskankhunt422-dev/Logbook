//! The Android app's own plugin (D90): `LogbookPlugin.kt` in
//! gen/android/app/src/main/java/app/logbookjournal/android/, for what Tauri's plugins don't do on
//! Android: printing the page, and writing the document Android's save dialog created, which is a
//! content:// address rather than a path.
//!
//! Each call waits for Android's main thread, so it must never be made from it: only from async
//! commands, which run on Tauri's worker threads.

use std::os::fd::FromRawFd;
use tauri::plugin::{Builder, PluginHandle, TauriPlugin};
use tauri::{AppHandle, Manager, Runtime};

struct Plugin<R: Runtime>(PluginHandle<R>);

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("logbook-android")
        .setup(|app, api| {
            let handle = api.register_android_plugin("app.logbookjournal.android", "LogbookPlugin")?;
            app.manage(Plugin(handle));
            Ok(())
        })
        .build()
}

fn plugin<R: Runtime>(app: &AppHandle<R>) -> &PluginHandle<R> {
    &app.state::<Plugin<R>>().inner().0
}

#[derive(serde::Serialize)]
struct Document<'a> {
    uri: &'a str,
}

/// Android's print screen for what the page shows, with "Save as PDF".
pub fn print<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    plugin(app).run_mobile_plugin::<()>("print", ()).map_err(|e| e.to_string())
}

/// The document, emptied and open for writing from its start, and the id that `close_document`
/// takes once writing is over.
pub fn open_for_writing<R: Runtime>(app: &AppHandle<R>, uri: &str) -> Result<(std::fs::File, i32), String> {
    #[derive(serde::Deserialize)]
    struct Opened {
        fd: i32,
        id: i32,
    }
    let opened: Opened = plugin(app).run_mobile_plugin("openForWriting", Document { uri }).map_err(|e| e.to_string())?;
    // A copy of the descriptor Kotlin keeps open, detached for us: ours to close.
    Ok((unsafe { std::fs::File::from_raw_fd(opened.fd) }, opened.id))
}

/// After Rust has closed its copy: tells the provider the document is complete, or that writing
/// it failed. Until then the provider (Google Drive) holds off.
pub fn close_document<R: Runtime>(app: &AppHandle<R>, id: i32, ok: bool) -> Result<(), String> {
    #[derive(serde::Serialize)]
    struct Close {
        id: i32,
        ok: bool,
    }
    plugin(app).run_mobile_plugin::<()>("closeDocument", Close { id, ok }).map_err(|e| e.to_string())
}

/// The document's name as the person sees it, and its size, when the provider says.
pub fn describe<R: Runtime>(app: &AppHandle<R>, uri: &str) -> (Option<String>, Option<u64>) {
    #[derive(serde::Deserialize)]
    struct Described {
        name: Option<String>,
        size: Option<u64>,
    }
    match plugin(app).run_mobile_plugin::<Described>("describe", Document { uri }) {
        Ok(d) => (d.name, d.size),
        Err(_) => (None, None),
    }
}

/// Deletes the document; false when the provider can't (it's then left empty).
pub fn delete_document<R: Runtime>(app: &AppHandle<R>, uri: &str) -> bool {
    #[derive(serde::Deserialize)]
    struct Deleted {
        deleted: bool,
    }
    plugin(app).run_mobile_plugin::<Deleted>("deleteDocument", Document { uri }).map(|d| d.deleted).unwrap_or(false)
}
