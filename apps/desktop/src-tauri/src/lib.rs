//! Logbook's desktop shell: a window around the web app (D78), with the journal kept in a folder
//! the user chooses (D79), updating itself from signed releases (D87).

mod folder;

use tauri::Manager;

/// Whether this build can update itself: only with an updater public key in its configuration.
struct Updates(bool);

#[tauri::command]
fn updates_enabled(updates: tauri::State<'_, Updates>) -> bool {
    updates.0
}

/// The updater checks signatures against `plugins.updater.pubkey`. Until the release key's public
/// half is configured (M5 §6), the plugin isn't started and the app doesn't offer updates.
fn has_updater_key(config: &tauri::Config) -> bool {
    config
        .plugins
        .0
        .get("updater")
        .and_then(|u| u.get("pubkey"))
        .and_then(|k| k.as_str())
        .is_some_and(|k| !k.trim().is_empty())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .manage(folder::JournalFolder::default())
        .setup(|app| {
            folder::restore(app.handle());
            let updates = has_updater_key(app.config());
            if updates {
                app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
            }
            app.manage(Updates(updates));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            folder::journal_folder,
            folder::choose_journal_folder,
            folder::scan_journal,
            folder::read_journal_texts,
            updates_enabled,
        ])
        .run(tauri::generate_context!())
        .expect("Logbook could not start");
}
