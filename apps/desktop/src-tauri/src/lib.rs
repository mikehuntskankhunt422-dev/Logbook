//! Logbook's desktop shell: a window around the web app (D78), with the journal kept in a folder
//! the user chooses (D79).

mod folder;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(folder::JournalFolder::default())
        .setup(|app| {
            folder::restore(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            folder::journal_folder,
            folder::choose_journal_folder,
            folder::scan_journal,
            folder::read_journal_texts,
        ])
        .run(tauri::generate_context!())
        .expect("Logbook could not start");
}
