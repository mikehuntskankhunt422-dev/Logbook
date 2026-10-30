//! Opening Logbook when the person signs in to the computer, if they choose (D110): the autostart
//! plugin's entry, a Run key on Windows, a Launch Agent on macOS and an autostart `.desktop` file on
//! Linux. Only these two commands reach it; the plugin's own aren't allowed in the window.

use tauri::AppHandle;
use tauri_plugin_autostart::ManagerExt;

/// Whether Logbook opens at sign-in.
#[tauri::command]
pub fn autostart_status(app: AppHandle) -> Result<bool, String> {
    app.autolaunch().is_enabled().map_err(|e| e.to_string())
}

/// Turns opening at sign-in on or off, and says how it is now.
#[tauri::command]
pub fn autostart_set(app: AppHandle, on: bool) -> Result<bool, String> {
    let launch = app.autolaunch();
    if on { launch.enable() } else { launch.disable() }.map_err(|e| e.to_string())?;
    launch.is_enabled().map_err(|e| e.to_string())
}
