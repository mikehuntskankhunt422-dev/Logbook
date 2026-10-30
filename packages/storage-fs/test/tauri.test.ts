import { beforeEach, describe, expect, it, vi } from 'vitest';

// The app's commands, recorded: what the page sends over the bridge.
const calls: { cmd: string; args: unknown; headers: Record<string, string> }[] = [];
vi.mock('@tauri-apps/api/core', () => ({
  invoke: async (cmd: string, args: unknown, options?: { headers?: Record<string, string> }) => {
    calls.push({ cmd, args, headers: options?.headers ?? {} });
  },
}));
const { PIECE, TauriFsBackend, toBase64 } = await import('../src/tauri.ts');

const bytes = (n: number) => Uint8Array.from({ length: n }, (_, i) => (i * 7 + (i >> 8)) & 255);

beforeEach(() => void (calls.length = 0));

describe('TauriFsBackend', () => {
  it('sends raw bytes on the desktop', async () => {
    const data = bytes(10);
    await new TauriFsBackend().write('media/ab/x.png', data);
    expect(calls).toEqual([{ cmd: 'journal_write', args: data, headers: { 'x-path': 'media%2Fab%2Fx.png' } }]);
  });

  it('sends base64 on Android, a big file in pieces of one write (D90)', async () => {
    const fs = new TauriFsBackend({ textOnly: true });
    const small = bytes(1000);
    await fs.write('entries/2026/a b.json', small);
    expect(calls).toEqual([{ cmd: 'journal_write', args: { data: Buffer.from(small).toString('base64') }, headers: { 'x-path': 'entries%2F2026%2Fa%20b.json' } }]);

    calls.length = 0;
    const big = bytes(PIECE * 2 + 5);
    await fs.write('media/cd/v.mp4', big);
    expect(calls.map((c) => c.headers['x-part'])).toEqual(['first', 'more', 'last']);
    expect(new Set(calls.map((c) => c.headers['x-write'])).size).toBe(1);
    expect(calls.every((c) => c.headers['x-path'] === 'media%2Fcd%2Fv.mp4')).toBe(true);
    const joined = Buffer.concat(calls.map((c) => Buffer.from((c.args as { data: string }).data, 'base64')));
    expect(joined.equals(Buffer.from(big))).toBe(true);

    // Exactly two pieces: a first and a last.
    calls.length = 0;
    await fs.write('media/cd/w.mp4', bytes(PIECE + 1));
    expect(calls.map((c) => c.headers['x-part'])).toEqual(['first', 'last']);
  });
});

describe('toBase64', () => {
  it('matches the standard encoding, across its 32 KiB steps', () => {
    for (const n of [0, 1, 2, 3, 0x8000 - 1, 0x8000, 0x8000 * 3 + 2]) {
      const data = bytes(n);
      expect(toBase64(data)).toBe(Buffer.from(data).toString('base64'));
    }
  });

  it('calls the commands the way it is given: the page’s own, with its secret (D111)', async () => {
    const mine: string[] = [];
    const fs = new TauriFsBackend({ invoke: (async (cmd: string) => void mine.push(cmd)) as never });
    await fs.remove('entries/a.json');
    await fs.write('entries/a.json', bytes(3));
    expect(mine).toEqual(['journal_remove', 'journal_write']);
    expect(calls).toEqual([]);
  });
});
