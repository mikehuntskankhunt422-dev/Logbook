/**
 * The few file operations FolderStore needs, rooted at the journal folder. Paths are relative,
 * use `/`, and never contain `.` or `..` segments. Implemented by Node (tests, scripts) and by the
 * desktop app's Rust side.
 */
export interface FsBackend {
  /** The file's bytes, or undefined when it doesn't exist. */
  read(path: string): Promise<Uint8Array<ArrayBuffer> | undefined>;
  /** Replaces the file atomically (temporary file, then rename), creating folders as needed. */
  write(path: string, data: Uint8Array): Promise<void>;
  /** Moves a file, replacing any file at `to` and creating folders as needed. */
  rename(from: string, to: string): Promise<void>;
  /** Deletes a file; nothing happens when it doesn't exist. */
  remove(path: string): Promise<void>;
  /** Every file under `dir`, recursively, as paths relative to the root; [] when `dir` doesn't exist. */
  list(dir: string): Promise<string[]>;
}

/** Throws unless `path` is a safe relative path inside the journal folder. */
export function assertRelativePath(path: string): void {
  const ok =
    path.length > 0 &&
    path.length <= 1024 &&
    !path.startsWith('/') &&
    !path.includes('\\') &&
    !path.includes('\0') &&
    !/^[a-zA-Z]:/.test(path) &&
    path.split('/').every((s) => s !== '' && s !== '.' && s !== '..');
  if (!ok) throw new Error(`Not a path inside the journal folder: ${JSON.stringify(path)}`);
}
