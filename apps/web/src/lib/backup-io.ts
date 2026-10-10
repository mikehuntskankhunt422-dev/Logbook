import { backupFileName, exportBackup, type Journal } from '@logbook/core';
import { isDesktop } from './platform.ts';

/**
 * Getting backups out of the browser: a plain download everywhere, or "back up to a folder" through
 * the File System Access API where available (Chrome, Edge, Opera on desktop). The folder handle is
 * remembered in its own tiny IndexedDB so the next backup goes to the same place after one prompt.
 */

type DirHandle = FileSystemDirectoryHandle & {
  queryPermission?: (d: { mode: 'readwrite' }) => Promise<PermissionState>;
  requestPermission?: (d: { mode: 'readwrite' }) => Promise<PermissionState>;
};

export function supportsFolderBackup(): boolean {
  // The desktop app saves through its own dialog; its webview may also offer this API, but the
  // remembered folder would live in browser storage the app doesn't otherwise use.
  return !isDesktop && typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export async function makeBackup(journal: Journal, keepEncrypted: boolean): Promise<Blob> {
  return exportBackup(journal, { keepEncrypted, app: `logbook-${isDesktop ? 'desktop' : 'web'} ${import.meta.env.VITE_APP_VERSION ?? 'dev'}` });
}

/** Downloads a backup zip (the desktop app asks where to save it). False when the person cancelled. */
export async function downloadBackup(journal: Journal, keepEncrypted: boolean): Promise<boolean> {
  const blob = await makeBackup(journal, keepEncrypted);
  if (import.meta.env.VITE_PLATFORM === 'desktop') {
    const { saveFile } = await import('../desktop/bridge.ts');
    if (!(await saveFile(blob, backupFileName()))) return false;
  } else downloadBlob(blob, backupFileName());
  await journal.markBackedUp();
  return true;
}

/** What the person just did with a backup, for the confirmation. */
export const BACKUP_DONE = isDesktop ? 'Backup saved.' : 'Backup downloaded.';

// ── remembered folder ───────────────────────────────────────────────────────────────────────────

function handleDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('logbook-handles', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('h');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function loadHandle(): Promise<DirHandle | undefined> {
  const db = await handleDb();
  return new Promise((resolve) => {
    const req = db.transaction('h').objectStore('h').get('backupDir');
    req.onsuccess = () => resolve(req.result as DirHandle | undefined);
    req.onerror = () => resolve(undefined);
  });
}

async function saveHandle(h: DirHandle | undefined): Promise<void> {
  const db = await handleDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('h', 'readwrite');
    if (h) tx.objectStore('h').put(h, 'backupDir');
    else tx.objectStore('h').delete('backupDir');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function rememberedFolderName(): Promise<string | null> {
  if (!supportsFolderBackup()) return null;
  return (await loadHandle())?.name ?? null;
}

export async function forgetFolder(): Promise<void> {
  await saveHandle(undefined);
}

/** Writes a timestamped zip into the chosen folder. Prompts for a folder the first time. */
export async function backupToFolder(journal: Journal, keepEncrypted: boolean, chooseNew = false): Promise<string> {
  let dir = chooseNew ? undefined : await loadHandle();
  if (dir?.queryPermission && (await dir.queryPermission({ mode: 'readwrite' })) !== 'granted') {
    if ((await dir.requestPermission?.({ mode: 'readwrite' })) !== 'granted') dir = undefined;
  }
  if (!dir) {
    const picker = (window as unknown as { showDirectoryPicker: (o: object) => Promise<DirHandle> }).showDirectoryPicker;
    dir = await picker({ id: 'logbook-backups', mode: 'readwrite', startIn: 'documents' });
    await saveHandle(dir);
  }
  const blob = await makeBackup(journal, keepEncrypted);
  const name = backupFileName();
  const file = await dir.getFileHandle(name, { create: true });
  const writable = await file.createWritable();
  await writable.write(blob);
  await writable.close();
  await journal.markBackedUp();
  return `${dir.name}/${name}`;
}

export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}
