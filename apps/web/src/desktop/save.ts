import { save } from '@tauri-apps/plugin-dialog';
import { writeFile } from '@tauri-apps/plugin-fs';

/**
 * Saves a file where the user chooses, through the system's save dialog (which grants just that
 * file to the fs plugin). WebView downloads behave differently on each OS, so the desktop doesn't
 * rely on them. Returns false if the dialog was cancelled.
 */
export async function saveFile(blob: Blob, suggestedName: string, kind: { name: string; extensions: string[] }): Promise<boolean> {
  const path = await save({ defaultPath: suggestedName, filters: [kind] });
  if (!path) return false;
  await writeFile(path, new Uint8Array(await blob.arrayBuffer()));
  return true;
}
