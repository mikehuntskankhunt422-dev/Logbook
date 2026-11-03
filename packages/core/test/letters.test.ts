import { describe, expect, it } from 'vitest';
import { letterKey, letterSealed, lettersOpened } from '../src/letters.ts';
import { SearchIndex } from '../src/search.ts';
import { shelveLibrary } from '../src/library.ts';
import { entrySchema, type Entry } from '../src/model.ts';

const entry = (id: string, date: string, sealedUntil: string | null, text = 'the secret words', title = id): Entry =>
  entrySchema.parse({
    id,
    date,
    title,
    cover: { kind: 'gradient', gradient: 'sunrise' },
    blocks: [{ id: `${id}-b`, type: 'text', doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] } }],
    createdAt: `${date}T10:00:00.000Z`,
    updatedAt: `${date}T10:00:00.000Z`,
    rev: 1,
    sealedUntil,
  });

describe('letters to your future self (D122)', () => {
  it('are sealed until their day, and open on it', () => {
    const letter = entry('a', '2026-11-03', '2027-11-03');
    expect(letterSealed(letter, '2026-11-03')).toBe(true);
    expect(letterSealed(letter, '2027-11-02')).toBe(true);
    expect(letterSealed(letter, '2027-11-03')).toBe(false);
    expect(letterSealed(entry('b', '2026-11-03', null), '2026-11-03')).toBe(false);
    // Entries from before letters were a thing read as never sealed.
    expect(entrySchema.parse({ ...letter, sealedUntil: undefined }).sealedUntil).toBeNull();
  });

  it('say once that they’ve opened, oldest first, and again only if sealed anew', () => {
    const one = entry('one', '2026-01-01', '2026-06-01');
    const two = entry('two', '2026-02-01', '2026-05-01');
    const later = entry('later', '2026-03-01', '2027-01-01');
    const plain = entry('plain', '2026-03-02', null);
    const all = [one, two, later, plain];
    expect(lettersOpened(all, '2026-07-01', new Set()).map((e) => e.id)).toEqual(['two', 'one']);
    expect(lettersOpened(all, '2026-07-01', new Set([letterKey(two), letterKey(one)]))).toEqual([]);
    // Sealed again until a new day: news again on that day.
    const resealed = { ...one, sealedUntil: '2026-12-01' };
    expect(lettersOpened([resealed], '2026-12-01', new Set([letterKey(one)])).map((e) => e.id)).toEqual(['one']);
    // Trashed letters don't.
    expect(lettersOpened([{ ...two, deletedAt: '2026-05-02T00:00:00Z' }], '2026-07-01', new Set())).toEqual([]);
  });

  it('can’t be found by their words while sealed, only by their envelope', () => {
    const index = new SearchIndex();
    index.rebuild([entry('sealed', '2026-11-03', '2999-01-01', 'marmalade', 'Dear future me'), entry('open', '2026-11-03', null, 'marmalade', 'Groceries')]);
    expect(index.search('marmalade').map((h) => h.id)).toEqual(['open']);
    expect(index.search('future').map((h) => h.id)).toEqual(['sealed']);
  });

  it('stand on the Library’s shelves with a seal until their day', () => {
    const shelves = (day: string) => shelveLibrary([entry('l', '2026-11-03', '2027-01-01')], () => 10, day)[0]!.months[0]!.books[0]!;
    expect(shelves('2026-12-31').sealed).toBe('2027-01-01');
    expect(shelves('2027-01-01').sealed).toBeUndefined();
  });
});
