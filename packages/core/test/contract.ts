import { describe, expect, it } from 'vitest';
import type { RecordStore } from '../src/storage.ts';
import type { Entry } from '../src/model.ts';

/** Behaviour every RecordStore implementation must share. Run by each adapter's own tests. */
export function recordStoreContract(name: string, make: () => Promise<RecordStore>): void {
  const entry = (id: string, title = 't'): Entry => ({
    v: 1,
    id,
    date: '2026-10-07',
    title,
    mood: null,
    cover: { kind: 'gradient', gradient: 'sunrise' },
    tags: [],
    blocks: [],
    createdAt: '2026-10-07T00:00:00.000Z',
    updatedAt: '2026-10-07T00:00:00.000Z',
    rev: 1,
    deletedAt: null,
  });

  describe(`${name} RecordStore contract`, () => {
    it('puts, gets, lists and deletes records per store', async () => {
      const s = await make();
      await s.put('entries', entry('a'));
      await s.put('entries', entry('b'));
      await s.put('entries', entry('a', 'updated'));
      expect((await s.get('entries', 'a')) as Entry).toMatchObject({ title: 'updated' });
      expect((await s.all('entries')).map((r) => r.id).sort()).toEqual(['a', 'b']);
      expect(await s.all('media')).toEqual([]);
      await s.delete('entries', 'a');
      expect(await s.get('entries', 'a')).toBeUndefined();
    });

    it('returns copies, not live references', async () => {
      const s = await make();
      await s.put('entries', entry('a'));
      const got = (await s.get('entries', 'a')) as Entry;
      got.title = 'mutated';
      expect(((await s.get('entries', 'a')) as Entry).title).toBe('t');
    });

    it('stores blobs with their bytes and type', async () => {
      const s = await make();
      await s.putBlob('m', new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }));
      const b = await s.getBlob('m');
      expect(b?.type).toBe('image/png');
      expect(new Uint8Array(await b!.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
      await s.deleteBlob('m');
      expect(await s.getBlob('m')).toBeUndefined();
    });

    it('keeps keys across clearContent, which removes everything else', async () => {
      const s = await make();
      await s.setKey('settings', { theme: 'dark' });
      await s.put('entries', entry('a'));
      await s.putBlob('m', new Blob(['x']));
      await s.clearContent();
      expect(await s.all('entries')).toEqual([]);
      expect(await s.getBlob('m')).toBeUndefined();
      expect(await s.getKey('settings')).toEqual({ theme: 'dark' });
      await s.setKey('settings', undefined);
      expect(await s.getKey('settings')).toBeUndefined();
    });
  });
}
