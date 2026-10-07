/**
 * Where order files live (D16): the uploaded print bundle, then the rendered PDFs. Browsers upload
 * and Lulu downloads through short-lived signed URLs, so content never has to pass through the API
 * process (PLAN §6). Two backends: Cloudflare R2 (S3 API) and, for development and tests only, a
 * folder on this machine behind URLs the API signs itself (D51).
 */
export interface SignedUpload {
  url: string;
  method: 'PUT';
  /** Headers the upload must send exactly as given (they're part of the signature). */
  headers: Record<string, string>;
}

export interface ObjectStore {
  readonly kind: 'r2' | 'local';
  /** True when outside services (Lulu) can fetch `signGet` URLs. The local store's can't. */
  readonly reachableFromInternet: boolean;
  signPut(key: string, opts: { contentType: string; expiresInSeconds: number }): Promise<SignedUpload>;
  signGet(key: string, expiresInSeconds: number, opts?: { downloadName?: string }): Promise<string>;
  /** Size of an object, or null when it doesn't exist. */
  size(key: string): Promise<number | null>;
  get(key: string): Promise<Uint8Array | null>;
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  /** Deletes every object under `prefix`; returns how many. */
  deletePrefix(prefix: string): Promise<number>;
}

/** Keys are plain paths: letters, digits, `-`, `_`, `.` and `/`, no `..` and no leading slash. */
export function assertKey(key: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,511}$/.test(key) || key.split('/').some((part) => part === '..' || part === '.' || part === '')) {
    throw new Error(`Invalid storage key: ${key.slice(0, 80)}`);
  }
}
