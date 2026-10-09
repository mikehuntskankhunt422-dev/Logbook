import { createHash, createPublicKey, verify } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

/**
 * Checks update signatures against the public key the app trusts, the way the updater will
 * (minisign: Ed25519 over the BLAKE2b-512 of the file, and over the signature plus its trusted
 * comment). Run by the workflow after each build, so a GitHub secret holding a different private
 * key than `tauri.conf.json`'s public key fails the build instead of shipping updates no installed
 * app would accept (M5 §2.6).
 *
 *   node scripts/verify-signatures.ts --dir dist [--pubkey <base64 key>]   (default: tauri.conf.json's)
 */

const SPKI_ED25519 = Buffer.from('302a300506032b6570032100', 'hex');

/** A minisign key id, written as minisign shows it (the 8 bytes little-endian). */
const keyId = (bytes: Buffer) => Buffer.from(bytes).reverse().toString('hex');

interface PublicKey {
  id: string;
  key: ReturnType<typeof createPublicKey>;
}

/** Tauri's public key: base64 of a minisign `.pub` file (comment line, then base64 of "Ed" + id + key). */
export function parsePublicKey(tauriPubkey: string): PublicKey {
  const lines = Buffer.from(tauriPubkey.trim(), 'base64').toString('utf8').split('\n');
  const raw = Buffer.from(lines[1] ?? '', 'base64');
  if (raw.length !== 42 || raw.subarray(0, 2).toString() !== 'Ed') throw new Error('Not a minisign public key.');
  return { id: keyId(raw.subarray(2, 10)), key: createPublicKey({ key: Buffer.concat([SPKI_ED25519, raw.subarray(10)]), format: 'der', type: 'spki' }) };
}

/** Verifies one `.sig` (as Tauri writes it: base64 of a minisign signature file). Returns its trusted comment. */
export function verifySignature(file: Buffer, tauriSignature: string, pub: PublicKey): string {
  const lines = Buffer.from(tauriSignature.trim(), 'base64').toString('utf8').split('\n');
  const sig = Buffer.from(lines[1] ?? '', 'base64');
  const trusted = (lines[2] ?? '').replace(/^trusted comment: /, '');
  const global = Buffer.from(lines[3] ?? '', 'base64');
  if (sig.length !== 74 || global.length !== 64) throw new Error('Not a minisign signature.');
  const alg = sig.subarray(0, 2).toString();
  const id = keyId(sig.subarray(2, 10));
  if (id !== pub.id) throw new Error(`Signed with key ${id.toUpperCase()}, but the app trusts key ${pub.id.toUpperCase()}.`);
  const message = alg === 'ED' ? createHash('blake2b512').update(file).digest() : file;
  if (!verify(null, message, pub.key, sig.subarray(10))) throw new Error("The signature doesn't match the file.");
  if (!verify(null, Buffer.concat([sig.subarray(10), Buffer.from(trusted)]), pub.key, global)) throw new Error("The signature's trusted comment has been altered.");
  return trusted;
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { dir: { type: 'string' }, pubkey: { type: 'string' } } });
  if (!values.dir) {
    console.error('Usage: node scripts/verify-signatures.ts --dir <folder with files and .sig> [--pubkey <base64>]');
    process.exit(2);
  }
  const sigs = readdirSync(values.dir).filter((n) => n.endsWith('.sig'));
  if (!sigs.length) {
    console.log('No update signatures to check (built without TAURI_SIGNING_PRIVATE_KEY).');
    process.exit(0);
  }
  const conf = JSON.parse(readFileSync(join(import.meta.dirname, '../src-tauri/tauri.conf.json'), 'utf8')) as { plugins: { updater: { pubkey: string } } };
  const pub = parsePublicKey(values.pubkey || conf.plugins.updater.pubkey);
  let failed = false;
  for (const name of sigs) {
    const file = name.slice(0, -4);
    try {
      const trusted = verifySignature(readFileSync(join(values.dir, file)), readFileSync(join(values.dir, name), 'utf8'), pub);
      console.log(`✔ ${file}: ${trusted.replace(/\t/g, ' · ')}`);
    } catch (err) {
      failed = true;
      console.error(`✖ ${file}: ${(err as Error).message}`);
    }
  }
  if (failed) {
    console.error('::error::Update signatures don\'t match the public key in tauri.conf.json: check that TAURI_SIGNING_PRIVATE_KEY is the partner of that key (docs/SIGNING.md §1).');
    process.exit(1);
  }
}
