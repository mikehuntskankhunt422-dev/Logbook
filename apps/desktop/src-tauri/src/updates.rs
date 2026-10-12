//! Automatic updates on the desktop (M5 slice F, D88). Phones get new versions as a new APK or
//! from a store instead (D90), so this module is left out of the Android build.
//!
//! The updater reads `latest.json` from the newest GitHub release and accepts only files signed
//! with our updater key (tauri.conf.json holds the public half). Downloading and installing are two
//! steps so the page can save once more in between, with the window blocked, right before the
//! install: on Windows the installer ends the app straight away, and elsewhere the app restarts.

use crate::CLOSED;
use std::sync::atomic::Ordering;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};

/// An update found by the last check, kept until it's downloaded.
#[derive(Default)]
pub struct PendingUpdate(Mutex<Option<tauri_plugin_updater::Update>>);

/// An update downloaded and its signature checked, waiting to be installed.
#[derive(Default)]
pub struct DownloadedUpdate(Mutex<Option<(tauri_plugin_updater::Update, Vec<u8>)>>);

#[derive(serde::Serialize)]
pub struct UpdateInfo {
    version: String,
}

/// Looks for a newer version; None when this is the newest.
#[tauri::command]
pub async fn update_check(app: AppHandle, pending: State<'_, PendingUpdate>) -> Result<Option<UpdateInfo>, String> {
    use tauri_plugin_updater::UpdaterExt;
    let update = app.updater().map_err(|e| e.to_string())?.check().await.map_err(|e| e.to_string())?;
    let info = update.as_ref().map(|u| UpdateInfo { version: u.version.clone() });
    *pending.0.lock().map_err(|_| "busy".to_string())? = update;
    Ok(info)
}

/// Downloads the update found by `update_check` and checks its signature. Reports progress as
/// `logbook://update-progress` events: [bytes so far, total if known]. A download that fails
/// needs a fresh check: the release may have been fixed in the meantime.
#[tauri::command]
pub async fn update_download(
    app: AppHandle,
    pending: State<'_, PendingUpdate>,
    downloaded: State<'_, DownloadedUpdate>,
) -> Result<(), String> {
    let update = pending.0.lock().map_err(|_| "busy".to_string())?.take().ok_or("There's no update waiting.")?;
    let progress = app.clone();
    let mut received: u64 = 0;
    let bytes = update
        .download(
            move |chunk, total| {
                received += chunk as u64;
                let _ = progress.emit("logbook://update-progress", (received, total));
            },
            || {},
        )
        .await
        .map_err(|e| e.to_string())?;
    *downloaded.0.lock().map_err(|_| "busy".to_string())? = Some((update, bytes));
    Ok(())
}

/// Installs the downloaded update and starts the new version. The page has saved everything and
/// blocked the window first.
#[tauri::command]
pub async fn update_apply(app: AppHandle, downloaded: State<'_, DownloadedUpdate>) -> Result<(), String> {
    let (update, bytes) = downloaded.0.lock().map_err(|_| "busy".to_string())?.take().ok_or("There's no update downloaded.")?;
    update.install(&bytes).map_err(|e| e.to_string())?;
    // Windows never gets here: its installer has already ended the app and will start it again.
    // The restart goes straight through the close hold (D86): the page saved just before.
    CLOSED.store(true, Ordering::SeqCst);
    app.restart()
}
