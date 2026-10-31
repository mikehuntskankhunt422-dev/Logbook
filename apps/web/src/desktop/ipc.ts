import { invoke as tauriInvoke, type InvokeArgs, type InvokeOptions } from '@tauri-apps/api/core';

/**
 * Logbook's commands, from its own page only (D111). Each call carries this launch's secret, which
 * Rust hands to the window's main frame alone (src-tauri/src/session.rs), so a frame inside the
 * page, such as one of your own apps, can't use them even where Tauri's command script reaches it.
 */
let secret: Promise<string> | undefined;

function session(): Promise<string> {
  secret ??= new Promise<string>((resolve, reject) => {
    (window as Window & { __logbookSession?: (s: string) => void }).__logbookSession = resolve;
    tauriInvoke('session_ready').catch(reject);
  }).catch((err: unknown) => {
    secret = undefined;
    throw err;
  });
  return secret;
}

export async function invoke<T>(cmd: string, args?: InvokeArgs, options?: InvokeOptions): Promise<T> {
  const key = await session();
  // A plain object: Android's channel sends the options as JSON, where Headers would be lost.
  const given = options?.headers instanceof Headers ? Object.fromEntries(options.headers.entries()) : options?.headers;
  return tauriInvoke<T>(cmd, args, { ...options, headers: { ...given, 'logbook-session': key } });
}
