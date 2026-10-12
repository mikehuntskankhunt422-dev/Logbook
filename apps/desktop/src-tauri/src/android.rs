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

/// The document, emptied and open for writing from its start.
pub fn open_for_writing<R: Runtime>(app: &AppHandle<R>, uri: &str) -> Result<std::fs::File, String> {
    #[derive(serde::Deserialize)]
    struct Opened {
        fd: i32,
    }
    let opened: Opened = plugin(app).run_mobile_plugin("openForWriting", Document { uri }).map_err(|e| e.to_string())?;
    // Kotlin detached the descriptor from its ParcelFileDescriptor: it's ours to close.
    Ok(unsafe { std::fs::File::from_raw_fd(opened.fd) })
}

/// The document's name as the person sees it, if the provider says.
pub fn display_name<R: Runtime>(app: &AppHandle<R>, uri: &str) -> Option<String> {
    #[derive(serde::Deserialize)]
    struct Named {
        name: Option<String>,
    }
    plugin(app).run_mobile_plugin::<Named>("displayName", Document { uri }).ok()?.name
}

/// Deletes the document; false when the provider can't (it's then left empty).
pub fn delete_document<R: Runtime>(app: &AppHandle<R>, uri: &str) -> bool {
    #[derive(serde::Deserialize)]
    struct Deleted {
        deleted: bool,
    }
    plugin(app).run_mobile_plugin::<Deleted>("deleteDocument", Document { uri }).map(|d| d.deleted).unwrap_or(false)
}
