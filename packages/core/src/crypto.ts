import { argon2id } from 'hash-wasm';
import type { SealedRecord } from './storage.ts';

/**
 * Passcode encryption.
 *  - Argon2id derives a key-encryption key (KEK) from the passcode.
 *  - A random 256-bit data key (DEK) encrypts every record and blob with AES-GCM (WebCrypto).
 *  - The vault stores the DEK encrypted under the KEK, so changing the passcode re-wraps one key.
 *  - There is no recovery path: without the passcode the DEK cannot be recovered. That is the point.
 */

export interface KdfParams {
  alg: 'argon2id';
  memoryKiB: number;
  iterations: number;
  parallelism: number;
  salt: string;
}

export interface Vault {
  v: 1;
  kdf: KdfParams;
  wrappedKey: { iv: string; data: string };
  createdAt: string;
}

/** OWASP-recommended range; 64 MiB / 3 passes takes roughly 0.3–1 s on a modern laptop. */
export const DEFAULT_KDF: Omit<KdfParams, 'salt'> = { alg: 'argon2id', memoryKiB: 64 * 1024, iterations: 3, parallelism: 1 };

export const MIN_PASSCODE_LENGTH = 6;

export class WrongPasscodeError extends Error {
  constructor() {
    super('That passcode is not right.');
    this.name = 'WrongPasscodeError';
  }
}

const BLOB_MAGIC = new Uint8Array([0x4c, 0x42, 0x4b, 0x31]); // "LBK1"
const enc = new TextEncoder();
const dec = new TextDecoder();

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(n));
}

async function deriveKek(passcode: string, kdf: KdfParams): Promise<CryptoKey> {
  const raw = await argon2id({
    password: passcode.normalize('NFC'),
    salt: fromBase64(kdf.salt),
    iterations: kdf.iterations,
    parallelism: kdf.parallelism,
    memorySize: kdf.memoryKiB,
    hashLength: 32,
    outputType: 'binary',
  });
  return crypto.subtle.importKey('raw', new Uint8Array(raw), 'AES-GCM', false, ['encrypt', 'decrypt']);
}

function importDek(raw: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function wrap(kek: CryptoKey, dekRaw: Uint8Array<ArrayBuffer>): Promise<Vault['wrappedKey']> {
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode('logbook:dek') }, kek, dekRaw);
  return { iv: toBase64(iv), data: toBase64(new Uint8Array(ct)) };
}

async function unwrap(kek: CryptoKey, wrapped: Vault['wrappedKey']): Promise<Uint8Array<ArrayBuffer>> {
  try {
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(wrapped.iv), additionalData: enc.encode('logbook:dek') },
      kek,
      fromBase64(wrapped.data),
    );
    return new Uint8Array(pt);
  } catch {
    throw new WrongPasscodeError();
  }
}

export async function createVault(
  passcode: string,
  params: Omit<KdfParams, 'salt'> = DEFAULT_KDF,
): Promise<{ vault: Vault; cipher: Cipher }> {
  if (passcode.length < MIN_PASSCODE_LENGTH) throw new Error(`Use at least ${MIN_PASSCODE_LENGTH} characters.`);
  const kdf: KdfParams = { ...params, salt: toBase64(randomBytes(16)) };
  const dekRaw = randomBytes(32);
  const vault: Vault = { v: 1, kdf, wrappedKey: await wrap(await deriveKek(passcode, kdf), dekRaw), createdAt: new Date().toISOString() };
  const cipher = new Cipher(await importDek(dekRaw));
  dekRaw.fill(0);
  return { vault, cipher };
}

export async function openVault(vault: Vault, passcode: string): Promise<Cipher> {
  const dekRaw = await unwrap(await deriveKek(passcode, vault.kdf), vault.wrappedKey);
  const cipher = new Cipher(await importDek(dekRaw));
  dekRaw.fill(0);
  return cipher;
}

/** New passcode, same data key: nothing else needs re-encrypting. */
export async function rewrapVault(
  vault: Vault,
  oldPasscode: string,
  newPasscode: string,
  params: Omit<KdfParams, 'salt'> = vault.kdf,
): Promise<Vault> {
  if (newPasscode.length < MIN_PASSCODE_LENGTH) throw new Error(`Use at least ${MIN_PASSCODE_LENGTH} characters.`);
  const dekRaw = await unwrap(await deriveKek(oldPasscode, vault.kdf), vault.wrappedKey);
  const kdf: KdfParams = { alg: 'argon2id', memoryKiB: params.memoryKiB, iterations: params.iterations, parallelism: params.parallelism, salt: toBase64(randomBytes(16)) };
  const wrapped = await wrap(await deriveKek(newPasscode, kdf), dekRaw);
  dekRaw.fill(0);
  return { v: 1, kdf, wrappedKey: wrapped, createdAt: vault.createdAt };
}

export function isSealedBlob(bytes: Uint8Array): boolean {
  return bytes.length >= 16 && BLOB_MAGIC.every((b, i) => bytes[i] === b);
}

/** Holds the unwrapped data key. The key is non-extractable; dropping the Cipher is "locking". */
export class Cipher {
  private readonly key: CryptoKey;
  constructor(key: CryptoKey) {
    this.key = key;
  }

  /** The record id is bound as associated data, so ciphertexts can't be swapped between records. */
  async sealJson(scope: string, id: string, value: unknown): Promise<SealedRecord> {
    const iv = randomBytes(12);
    const ct = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: enc.encode(`${scope}:${id}`) },
      this.key,
      enc.encode(JSON.stringify(value)),
    );
    return { id, sealed: 1, iv: toBase64(iv), data: toBase64(new Uint8Array(ct)) };
  }

  async openJson<T>(scope: string, rec: SealedRecord): Promise<T> {
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(rec.iv), additionalData: enc.encode(`${scope}:${rec.id}`) },
      this.key,
      fromBase64(rec.data),
    );
    return JSON.parse(dec.decode(pt)) as T;
  }

  async sealBytes(id: string, data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
    const iv = randomBytes(12);
    const ct = new Uint8Array(
      await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(`blob:${id}`) }, this.key, data),
    );
    const out = new Uint8Array(BLOB_MAGIC.length + iv.length + ct.length);
    out.set(BLOB_MAGIC, 0);
    out.set(iv, BLOB_MAGIC.length);
    out.set(ct, BLOB_MAGIC.length + iv.length);
    return out;
  }

  async openBytes(id: string, data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
    if (!isSealedBlob(data)) return data;
    const iv = data.subarray(BLOB_MAGIC.length, BLOB_MAGIC.length + 12);
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: enc.encode(`blob:${id}`) },
      this.key,
      data.subarray(BLOB_MAGIC.length + 12),
    );
    return new Uint8Array(pt);
  }
}
