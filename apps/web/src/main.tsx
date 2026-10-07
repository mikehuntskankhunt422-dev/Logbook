import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/bricolage-grotesque';
import '@fontsource-variable/newsreader';
import '@fontsource-variable/newsreader/wght-italic.css';
import './styles/app.css';
import { Journal } from '@logbook/core';
import { IndexedDbStore } from '@logbook/storage-idb';
import { JournalProvider } from './app/journal-context.tsx';
import { ToastProvider } from './app/toasts.tsx';
import { App } from './app/App.tsx';

async function boot() {
  const root = createRoot(document.getElementById('root')!);
  try {
    const journal = await Journal.open(await IndexedDbStore.open());
    root.render(
      <StrictMode>
        <ToastProvider>
          <JournalProvider journal={journal}>
            <App />
          </JournalProvider>
        </ToastProvider>
      </StrictMode>,
    );
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
