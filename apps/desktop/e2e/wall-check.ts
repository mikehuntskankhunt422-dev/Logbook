/**
 * An app of your own (D111) that tries every way out of its frame and says how far it got, for the
 * desktop and Android tests. Where Tauri's command script reaches the frame (Windows, Android), it
 * tries to write a file into the journal folder, which only Logbook's own page may do: Rust refuses
 * it, and on Android the answer goes to the page, not the frame, so there may be no answer at all.
 */
export const WALL_CHECK = `<!doctype html><title>Wall check</title><p id="walls">checking</p><script>
(async () => {
  const out = [];
  const answer = (p) => Promise.race([p.then(() => 'REACHED', (e) => String(e)), new Promise((r) => setTimeout(() => r('no answer'), 3000))]);
  const tauri = window.__TAURI_INTERNALS__;
  if (!tauri) out.push('commands: no channel');
  else {
    tauri.invoke('session_ready').catch(() => {});
    out.push('commands: ' + (await answer(tauri.invoke('journal_write', { data: btoa('escaped') }, { headers: { 'x-path': 'escaped.txt' } }))));
  }
  try { out.push('page: ' + parent.document.title); } catch { out.push('page: walled off'); }
  const ipc = (url) => fetch(url, { method: 'POST' }).then(() => 'REACHED', () => 'walled off');
  out.push('ipc: ' + (await ipc('ipc://localhost/journal_folder')) + ' ' + (await ipc('http://ipc.localhost/journal_folder')));
  localStorage.setItem('ran', 'yes');
  document.getElementById('walls').textContent = out.join(', ');
})();
</script>`;

/** What the app should say: no way out. */
export const WALLED_OFF = /^commands: (no channel|no answer|Only Logbook's own page can do that\.), page: walled off, ipc: walled off walled off$/;

/** The file the app tries to write, which must never appear. */
export const ESCAPED = 'escaped.txt';
