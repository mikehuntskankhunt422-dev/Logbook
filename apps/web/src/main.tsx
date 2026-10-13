import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/bricolage-grotesque';
import '@fontsource-variable/newsreader';
import '@fontsource-variable/newsreader/wght-italic.css';
import './styles/app.css';
import { loadFlagFont } from './lib/fonts.ts';
import { Journal } from '@logbook/core';
import { IndexedDbStore } from '@logbook/storage-idb';
import { JournalProvider } from './app/journal-context.tsx';
import { ToastProvider } from './app/toasts.tsx';
import { App } from './app/App.tsx';

loadFlagFont();

async function boot() {
  const root = createRoot(document.getElementById('root')!);
  const render = (journal: Journal) =>
    root.render(
      <StrictMode>
        <ToastProvider>
          <JournalProvider journal={journal}>
            <App />
          </JournalProvider>
        </ToastProvider>
      </StrictMode>,
    );

  // Written out rather than `isApp` so the browser build drops the apps' code entirely.
  if (import.meta.env.VITE_PLATFORM !== 'web') {
    // The journal folder on disk (D77; inside the app on Android, D90).
    const { bootApp, showError } = await import('./desktop/boot.tsx');
    return bootApp(root, render).catch((err: unknown) => showError(root, err));
  }

  try {
    render(await Journal.open(await IndexedDbStore.open()));
  } catch (err) {
    // Private browsing in some browsers, or storage disabled by policy.
    root.render(
      <main className="empty">
        <h1>Logbook can't open its storage</h1>
        <p>This browser is blocking on-device storage (private mode or a site-data setting). Logbook needs it to keep your journal.</p>
        <pre className="muted">{String(err)}</pre>
      </main>,
    );
  }
}

void boot();
