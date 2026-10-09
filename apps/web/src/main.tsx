import { createRoot } from 'react-dom/client';
import '@fontsource-variable/bricolage-grotesque';
import '@fontsource-variable/newsreader';
import '@fontsource-variable/newsreader/wght-italic.css';
import './styles/app.css';
import { Journal } from '@logbook/core';
import { IndexedDbStore } from '@logbook/storage-idb';
import { renderJournal } from './app/render.tsx';

async function boot() {
  const root = createRoot(document.getElementById('root')!);
  // Written out rather than IS_DESKTOP so the bundler drops the import from the website's build.
  if (import.meta.env.VITE_PLATFORM === 'desktop') {
    // The journal is a folder of files on the desktop (M5).
    const { bootDesktop } = await import('./desktop/boot.tsx');
    return bootDesktop(root);
  }
  try {
    renderJournal(root, await Journal.open(await IndexedDbStore.open()));
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
