import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { Journal } from '@logbook/core';
import { IndexedDbStore } from '../src/index.ts';
import { recordStoreContract } from '../../core/test/contract.ts';

let n = 0;
recordStoreContract('IndexedDbStore', () => IndexedDbStore.open(`test-${++n}`));

describe('IndexedDbStore with Journal', () => {
  it('persists across reopen', async () => {
    const name = `persist-${++n}`;
    const s1 = await IndexedDbStore.open(name);
    const j1 = await Journal.open(s1);
    const saved = await j1.saveEntry(j1.newEntry({ title: 'Still here' }));
    s1.close();

    const j2 = await Journal.open(await IndexedDbStore.open(name));
    expect((await j2.getEntry(saved.id))?.title).toBe('Still here');
  });
});
