import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parsePublicKey, verifySignature } from './verify-signatures.ts';

// Made with `tauri signer` (CLI 2.11.5) and a throwaway key that was deleted straight after.
const fixtures = join(import.meta.dirname, 'fixtures');
const payload = readFileSync(join(fixtures, 'payload.txt'));
const signature = readFileSync(join(fixtures, 'payload.txt.sig'), 'utf8');
const throwaway = parsePublicKey(readFileSync(join(fixtures, 'throwaway.key.pub'), 'utf8'));
const conf = JSON.parse(readFileSync(join(import.meta.dirname, '../src-tauri/tauri.conf.json'), 'utf8')) as { plugins: { updater: { pubkey: string } } };

describe('update signatures checked as the updater checks them', () => {
  it('accepts the file signed with the key and reads the signed version', () => {
    expect(verifySignature(payload, signature, throwaway)).toMatch(/\tfile:payload\.txt\tversion:1\.2\.3$/);
  });

  it('refuses a changed file', () => {
    expect(() => verifySignature(Buffer.concat([payload, Buffer.from('!')]), signature, throwaway)).toThrow(/doesn't match the file/);
  });

  it('refuses a signature from another key, naming both', () => {
    const app = parsePublicKey(conf.plugins.updater.pubkey);
    expect(app.id).toBe('66639b46eb2ef083');
    expect(() => verifySignature(payload, signature, app)).toThrow('Signed with key 3A3A0DB561A1CAD7, but the app trusts key 66639B46EB2EF083.');
  });

  it('refuses an altered trusted comment (a version changed after signing)', () => {
    const lines = Buffer.from(signature, 'base64').toString('utf8').split('\n');
    lines[2] = lines[2]!.replace('version:1.2.3', 'version:9.9.9');
    expect(() => verifySignature(payload, Buffer.from(lines.join('\n')).toString('base64'), throwaway)).toThrow(/trusted comment/);
  });

  it('refuses things that are not keys or signatures', () => {
    expect(() => parsePublicKey(Buffer.from('untrusted comment: x\nnot-a-key\n').toString('base64'))).toThrow(/public key/);
    expect(() => verifySignature(payload, 'bm9wZQ==', throwaway)).toThrow(/signature/);
  });
});
