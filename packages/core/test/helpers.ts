import type { KdfParams } from '../src/crypto.ts';

/** Deliberately weak Argon2id parameters so tests run fast. Never use outside tests. */
export const FAST_KDF: Omit<KdfParams, 'salt'> = { alg: 'argon2id', memoryKiB: 1024, iterations: 1, parallelism: 1 };

export function pngBytes(): Uint8Array<ArrayBuffer> {
  // 1×1 transparent PNG
  const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}
