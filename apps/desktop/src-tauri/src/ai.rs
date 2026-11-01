//! The Library's characters in your own words (D118): a request to one of the AI providers Logbook
//! knows (OpenAI, Google's Gemini, xAI, OpenRouter), made here rather than from the page, so a
//! provider's cross-origin rules don't matter and the window's own policy stays as tight as it was.
//! Only those providers' chat and model-list addresses, over HTTPS, with the person's own key; the
//! answer comes back as it is, for the page to read. (Claude's go from the page, through
//! Anthropic's SDK, which the window allows.)

use serde::Serialize;
use std::time::Duration;

/// Where each provider's OpenAI-style API lives; nothing else can be asked for.
const PROVIDERS: [&str; 4] = [
    "https://api.openai.com/v1/",
    "https://generativelanguage.googleapis.com/v1beta/openai/",
    "https://api.x.ai/v1/",
    "https://openrouter.ai/api/v1/",
];

/// The most a reply may be: a long model list is a few hundred kilobytes.
const MOST: usize = 4 * 1024 * 1024;

/// Whether `url` is one of the providers' chat or model-list addresses, and nothing more.
pub fn allowed(method: &str, url: &str) -> bool {
    PROVIDERS
        .iter()
        .any(|base| url.strip_prefix(base).is_some_and(|rest| matches!((method, rest), ("POST", "chat/completions") | ("GET", "models"))))
}

#[derive(Serialize)]
pub struct AiReply {
    status: u16,
    body: String,
}

#[tauri::command]
pub async fn ai_request(method: String, url: String, key: String, body: Option<String>) -> Result<AiReply, String> {
    if !allowed(&method, &url) {
        return Err("That isn't an AI provider Logbook knows.".into());
    }
    // The same TLS as the updater's.
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
    let client = reqwest::Client::builder().timeout(Duration::from_secs(90)).build().map_err(|e| e.to_string())?;
    let request = if method == "POST" {
        client.post(&url).header("content-type", "application/json").body(body.unwrap_or_default())
    } else {
        client.get(&url)
    };
    let mut reply = request.bearer_auth(key.trim()).send().await.map_err(|e| format!("Couldn't reach it: {e}"))?;
    let status = reply.status().as_u16();
    let mut bytes = Vec::new();
    while let Some(chunk) = reply.chunk().await.map_err(|e| e.to_string())? {
        if bytes.len() + chunk.len() > MOST {
            return Err("The reply was too long.".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(AiReply { status, body: String::from_utf8_lossy(&bytes).into_owned() })
}

#[cfg(test)]
mod tests {
    use super::allowed;

    #[test]
    fn only_the_providers_chat_and_model_lists() {
        assert!(allowed("POST", "https://api.openai.com/v1/chat/completions"));
        assert!(allowed("GET", "https://api.openai.com/v1/models"));
        assert!(allowed("POST", "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"));
        assert!(allowed("POST", "https://api.x.ai/v1/chat/completions"));
        assert!(allowed("GET", "https://openrouter.ai/api/v1/models"));
        // Anything else: another address, another path, another method, plain HTTP, a lookalike host.
        assert!(!allowed("POST", "https://example.com/v1/chat/completions"));
        assert!(!allowed("POST", "https://api.openai.com/v1/files"));
        assert!(!allowed("GET", "https://api.openai.com/v1/chat/completions"));
        assert!(!allowed("POST", "https://api.openai.com/v1/models"));
        assert!(!allowed("DELETE", "https://api.openai.com/v1/models"));
        assert!(!allowed("POST", "http://api.openai.com/v1/chat/completions"));
        assert!(!allowed("POST", "https://api.openai.com.evil.example/v1/chat/completions"));
        assert!(!allowed("POST", "https://api.openai.com/v1/chat/completions?x=1"));
        assert!(!allowed("POST", "https://api.openai.com/v1/chat/completions/../../files"));
    }
}
