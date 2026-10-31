//! Only Logbook's own page may use its commands (D111). On Windows and Android, Tauri's command
//! script reaches every frame in the window, an app of your own's included; so each command call
//! must carry this launch's secret, which only the window's own page is ever given (`session_ready`
//! hands it to the main frame with `eval`, which no frame inside the page can read).

use std::sync::Arc;
use tauri::ipc::Invoke;
use tauri::{Runtime, State, Webview};

/// The header each command call carries the secret in (src/desktop/ipc.ts).
pub const HEADER: &str = "logbook-session";

/// This launch's secret: 32 random bytes, as hex.
#[derive(Clone)]
pub struct Session(Arc<str>);

impl Session {
    pub fn new() -> Self {
        Session(random_hex::<32>().into())
    }

    /// Whether a call carries the secret. Every command but `session_ready` needs it.
    pub fn allows(&self, invoke: &Invoke<impl Runtime>) -> bool {
        if invoke.message.command() == "session_ready" {
            return true;
        }
        let given = invoke.message.headers().get(HEADER).map(|v| v.as_bytes()).unwrap_or_default();
        // Compared in full whatever matches, so the time taken says nothing about the secret.
        given.len() == self.0.len() && given.iter().zip(self.0.as_bytes()).fold(0u8, |acc, (a, b)| acc | (a ^ b)) == 0
    }
}

/// Hands the secret to the window's own page: run in its main frame, never in a frame inside it,
/// whoever asks.
#[tauri::command]
pub fn session_ready(webview: Webview, session: State<'_, Session>) -> Result<(), String> {
    webview.eval(format!("window.__logbookSession && window.__logbookSession({:?})", &*session.0)).map_err(|e| e.to_string())
}

/// `N` random bytes from the system, as hex.
pub fn random_hex<const N: usize>() -> String {
    let mut bytes = [0u8; N];
    getrandom::fill(&mut bytes).expect("no randomness from the system");
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::Session;

    #[test]
    fn secrets_are_long_and_differ() {
        let (a, b) = (Session::new(), Session::new());
        assert_eq!(a.0.len(), 64);
        assert!(a.0.bytes().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(a.0, b.0);
    }
}
