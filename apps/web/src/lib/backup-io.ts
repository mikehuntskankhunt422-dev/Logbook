import { backupFileName, exportBackup, type Journal } from '@logbook/core';
import { IS_DESKTOP } from '../platform.ts';

/**
 * Getting backups out of the browser: a plain download everywhere, or "back up to a folder" through
 * the File System Access API where available (Chrome, Edge, Opera on desktop). The folder handle is
 * remembered in its own tiny IndexedDB so the next backup goes to the same place after one prompt.
 */

type DirHandle = FileSystemDirectoryHandle & {
  queryPermission?: (d: { mode: 'readwrite' }) => Promise<PermissionState>;
  requestPermission?: (d: { mode: 'readwrite' }) => Promise<PermissionState>;
};

/** Not on the desktop, where the journal already is a folder and backups use the save dialog. */
export function supportsFolderBackup(): boolean {
  return !IS_DESKTOP && typeof window !== 'undefined' && 'showDirectoryPicker' in window;
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
  return exportBackup(journal, { keepEncrypted, app: `logbook-${IS_DESKTOP ? 'desktop' : 'web'} ${import.meta.env.VITE_APP_VERSION ?? 'dev'}` });
}

/**
 * Downloads a backup zip; on the desktop, saves it where the user chooses (M5 §2.4). Returns false
 * if they cancelled.
 */
export async function downloadBackup(journal: Journal, keepEncrypted: boolean): Promise<boolean> {
  const blob = await makeBackup(journal, keepEncrypted);
  if (import.meta.env.VITE_PLATFORM === 'desktop') {
    const { saveFile } = await import('../desktop/save.ts');
    if (!(await saveFile(blob, backupFileName(), { name: 'Logbook backup', extensions: ['zip'] }))) return false;
  } else {
    downloadBlob(blob, backupFileName());
  }
  await journal.markBackedUp();
  return true;
}

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
