//! Your own apps (D111) open from an origin of their own, `appbox:`, never from Logbook's: the page
//! hands Rust an app's code (`app_stage`), and the app's frame loads it from here, under a policy
//! that lets it use the internet (https) but not Logbook's command channel. The frame is sandboxed
//! too (no same-origin), and every command needs the page's secret (session.rs).

use std::collections::VecDeque;
use std::sync::Mutex;
use tauri::http::{header, Method, Request, Response, StatusCode};
use tauri::State;

/// What an app may load and reach: anything on the internet over https, inline code, nothing of
/// Logbook's (no `ipc:`, no `http://ipc.localhost`, no `tauri:`, nothing local).
pub const CSP: &str = "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' https: blob: data:; \
style-src 'unsafe-inline' https: data:; img-src https: data: blob:; media-src https: data: blob:; font-src https: data:; \
connect-src https: wss: data: blob:; worker-src https: blob: data:; frame-src https: data: blob:; form-action https:; \
base-uri 'none'; object-src 'none'";

/// Apps kept ready to load (the one open, and a few before it, for going back).
const KEEP: usize = 4;
/// The largest app that opens: far more than any page of code.
const MAX_BYTES: usize = 8 * 1024 * 1024;

#[derive(Default)]
pub struct Staged(Mutex<VecDeque<(String, String)>>);

impl Staged {
    fn keep(&self, token: String, html: String) {
        let mut kept = self.0.lock().unwrap_or_else(|e| e.into_inner());
        kept.push_back((token, html));
        while kept.len() > KEEP {
            kept.pop_front();
        }
    }
}

/// Gets an app ready to load, and returns the name its frame loads it by.
#[tauri::command]
pub fn app_stage(html: String, staged: State<'_, Staged>) -> Result<String, String> {
    if html.len() > MAX_BYTES {
        return Err("This app is too big to open (8 MB at most).".into());
    }
    let token = crate::session::random_hex::<16>();
    staged.keep(token.clone(), html);
    Ok(token)
}

/// `appbox://localhost/<name>` (`http://appbox.localhost/<name>` on Windows and Android).
pub fn serve(staged: &Staged, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let refuse =
        |status: StatusCode| Response::builder().status(status).header(header::CONTENT_TYPE, "text/plain").body(Vec::new()).unwrap();
    if request.method() != Method::GET {
        return refuse(StatusCode::METHOD_NOT_ALLOWED);
    }
    let token = request.uri().path().trim_matches('/');
    let found = staged.0.lock().unwrap_or_else(|e| e.into_inner()).iter().find(|(t, _)| t == token).map(|(_, html)| html.clone());
    match found {
        Some(html) => Response::builder()
            .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
            .header(header::CONTENT_SECURITY_POLICY, CSP)
            .header(header::CACHE_CONTROL, "no-store")
            .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
            .header(header::REFERRER_POLICY, "no-referrer")
            .body(html.into_bytes())
            .unwrap(),
        None => refuse(StatusCode::NOT_FOUND),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn get(staged: &Staged, path: &str) -> Response<Vec<u8>> {
        serve(staged, &Request::builder().uri(format!("appbox://localhost/{path}")).body(Vec::new()).unwrap())
    }

    #[test]
    fn serves_only_staged_apps_under_their_own_policy() {
        let staged = Staged::default();
        staged.keep("abc".into(), "<p>hi</p>".into());
        let found = get(&staged, "abc");
        assert_eq!(found.status(), StatusCode::OK);
        assert_eq!(found.body(), b"<p>hi</p>");
        let csp = found.headers()[header::CONTENT_SECURITY_POLICY].to_str().unwrap();
        assert!(csp.contains("connect-src https: wss:"));
        assert!(!csp.contains("ipc") && !csp.contains("'self'") && !csp.contains("http:"));
        assert_eq!(get(&staged, "abd").status(), StatusCode::NOT_FOUND);
        assert_eq!(get(&staged, "").status(), StatusCode::NOT_FOUND);
    }

    #[test]
    fn keeps_only_the_last_few() {
        let staged = Staged::default();
        for i in 0..6 {
            staged.keep(format!("t{i}"), String::new());
        }
        assert_eq!(get(&staged, "t1").status(), StatusCode::NOT_FOUND);
        assert_eq!(get(&staged, "t5").status(), StatusCode::OK);
    }
}
