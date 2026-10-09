//! Logbook's desktop shell: a window around the web app (D78).

pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("Logbook could not start");
}
