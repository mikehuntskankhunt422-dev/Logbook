import { describe, expect, it } from 'vitest';
import { createVault, isSealedBlob, openVault, rewrapVault, WrongPasscodeError, DEFAULT_KDF } from '../src/crypto.ts';
import { FAST_KDF } from './helpers.ts';

describe('vault', () => {
  it('opens with the right passcode and rejects the wrong one', async () => {
    const { vault } = await createVault('correct horse', FAST_KDF);
    await expect(openVault(vault, 'correct horse')).resolves.toBeDefined();
    await expect(openVault(vault, 'wrong horse!')).rejects.toBeInstanceOf(WrongPasscodeError);
  });

  it('refuses short passcodes', async () => {
    await expect(createVault('12345', FAST_KDF)).rejects.toThrow(/at least 6/);
  });

  it('rewrapping changes the passcode but keeps the same data key', async () => {
    const { vault, cipher } = await createVault('first-pass', FAST_KDF);
    const sealed = await cipher.sealJson('entry', 'e1', { hello: 'world' });
    const next = await rewrapVault(vault, 'first-pass', 'second-pass');
    await expect(openVault(next, 'first-pass')).rejects.toBeInstanceOf(WrongPasscodeError);
    const reopened = await openVault(next, 'second-pass');
    await expect(reopened.openJson('entry', sealed)).resolves.toEqual({ hello: 'world' });
    expect(next.kdf.salt).not.toBe(vault.kdf.salt);
  });

  it('defaults to OWASP-grade Argon2id parameters', () => {
    expect(DEFAULT_KDF).toMatchObject({ alg: 'argon2id', memoryKiB: 65536, iterations: 3, parallelism: 1 });
  });
});

describe('cipher', () => {
  it('round-trips JSON with a fresh IV each time', async () => {
    const { cipher } = await createVault('passcode', FAST_KDF);
    const a = await cipher.sealJson('entry', 'x', { n: 1 });
    const b = await cipher.sealJson('entry', 'x', { n: 1 });
    expect(a.iv).not.toBe(b.iv);
    expect(atob(a.data)).not.toContain('"n":1');
    expect(await cipher.openJson('entry', a)).toEqual({ n: 1 });
  });

  it('binds ciphertext to its record id and scope', async () => {
    const { cipher } = await createVault('passcode', FAST_KDF);
    const sealed = await cipher.sealJson('entry', 'a', { secret: true });
    await expect(cipher.openJson('entry', { ...sealed, id: 'b' })).rejects.toThrow();
    await expect(cipher.openJson('media', sealed)).rejects.toThrow();
  });

  it('round-trips bytes and marks them as sealed', async () => {
    const { cipher } = await createVault('passcode', FAST_KDF);
    const data = new Uint8Array([1, 2, 3, 4, 5]);
    const sealed = await cipher.sealBytes('m1', data);
    expect(isSealedBlob(sealed)).toBe(true);
    expect(await cipher.openBytes('m1', sealed)).toEqual(data);
    await expect(cipher.openBytes('m2', sealed)).rejects.toThrow();
  });

  it('passes through plaintext bytes (journals mid-migration)', async () => {
    const { cipher } = await createVault('passcode', FAST_KDF);
    const plain = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(await cipher.openBytes('m', plain)).toBe(plain);
  });
});
