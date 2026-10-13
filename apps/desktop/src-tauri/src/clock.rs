//! The clock's rings (D92): alarms, the timer and snoozes, as the page lists them
//! (apps/web/src/lib/clock.ts). On Android they're handed to the system's alarm service, so they
//! ring with Logbook closed. On the desktop they're watched here while Logbook runs: a hidden
//! window's page slows its timers down, so it would ring late, and only Rust can show the
//! system's notification. Either way the page rings too, with sound, while it's open.

use serde::Deserialize;
use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;

#[derive(Deserialize, Clone)]
pub struct Ring {
    id: i32,
    /// Milliseconds since 1970 (UTC).
    at: i64,
    title: String,
    body: String,
}

/// Replaces every ring scheduled before with these.
#[tauri::command]
pub async fn clock_schedule(app: AppHandle, rings: Vec<Ring>) -> Result<(), String> {
    #[cfg(desktop)]
    desktop::watch(&app, rings);
    #[cfg(mobile)]
    mobile::schedule(&app, rings)?;
    Ok(())
}

/// Whether notifications may be shown ("granted", "denied", "prompt"), asking first when `ask`
/// (Android 13 and later ask; the desktop doesn't).
#[tauri::command]
pub async fn clock_permission(app: AppHandle, ask: bool) -> Result<String, String> {
    let n = app.notification();
    let state = if ask { n.request_permission() } else { n.permission_state() };
    state.map(|s| s.to_string()).map_err(|e| e.to_string())
}

#[cfg(desktop)]
pub use desktop::Watcher;

#[cfg(desktop)]
mod desktop {
    use super::Ring;
    use std::sync::Mutex;
    use std::time::{Duration, SystemTime, UNIX_EPOCH};
    use tauri::async_runtime::JoinHandle;
    use tauri::{AppHandle, Emitter, Manager};
    use tauri_plugin_notification::NotificationExt;

    /// Rung later than this (the computer was asleep), a ring is let go.
    const STALE_MS: i64 = 5 * 60_000;

    #[derive(Default)]
    pub struct Watcher(Mutex<Option<JoinHandle<()>>>);

    fn now_ms() -> i64 {
        SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
    }

    pub fn watch(app: &AppHandle, mut rings: Vec<Ring>) {
        rings.sort_by_key(|r| r.at);
        let handle = app.clone();
        let task = tauri::async_runtime::spawn(async move {
            for ring in rings {
                // Short sleeps against the wall clock: a sleeping computer or a changed clock
                // doesn't throw the time off.
                loop {
                    let left = ring.at - now_ms();
                    if left <= 0 {
                        break;
                    }
                    tokio::time::sleep(Duration::from_millis(left.min(5_000) as u64)).await;
                }
                if now_ms() - ring.at > STALE_MS {
                    continue;
                }
                let _ = handle.notification().builder().title(&ring.title).body(&ring.body).show();
                let _ = handle.emit("clock-ring", ring.id);
            }
        });
        if let Some(old) = app.state::<Watcher>().0.lock().unwrap().replace(task) {
            old.abort();
        }
    }
}

#[cfg(mobile)]
mod mobile {
    use super::Ring;
    use tauri::AppHandle;
    use tauri_plugin_notification::{Channel, Importance, NotificationExt, Schedule};

    const CHANNEL: &str = "clock";

    pub fn schedule(app: &AppHandle, rings: Vec<Ring>) -> Result<(), String> {
        let n = app.notification();
        // Its own channel, loud and vibrating, which people can set apart in Android's settings.
        let _ = n.create_channel(
            Channel::builder(CHANNEL, "Alarms and timers")
                .description("Logbook's alarms and timers")
                .importance(Importance::High)
                .vibration(true)
                .build(),
        );
        n.cancel_all().map_err(|e| e.to_string())?;
        for ring in rings {
            let date = time::OffsetDateTime::from_unix_timestamp_nanos(i128::from(ring.at) * 1_000_000).map_err(|e| e.to_string())?;
            n.builder()
                .id(ring.id)
                .channel_id(CHANNEL)
                .title(ring.title)
                .body(ring.body)
                .auto_cancel()
                .schedule(Schedule::At { date, repeating: false, allow_while_idle: true })
                .show()
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }
}
