import { describe, expect, it } from 'vitest';
import { BOOK_HEIGHT, BOOK_MAX_HEIGHT, BOOK_MAX_THICKNESS, BOOK_MIN_THICKNESS, bookHeight, bookThickness, shelveLibrary } from '../src/library.ts';
import type { Entry } from '../src/model.ts';
import { emptyDoc, entryWordCount } from '../src/richtext.ts';

let n = 0;
function entry(date: string, text: string, opts: Partial<Entry> = {}): Entry {
  n++;
  const at = opts.createdAt ?? `${date}T10:00:00.000Z`;
  return { v: 1, id: `e${n}`, date, title: `Day ${n}`, mood: null, cover: { kind: 'gradient', gradient: 'sunrise' }, tags: [], blocks: [{ id: `b${n}`, type: 'text', doc: emptyDoc(text) }], createdAt: at, updatedAt: at, rev: 1, deletedAt: null, expiresAt: null, musicId: null, musicUrl: null, ...opts } as Entry;
}
const words = (k: number) => Array.from({ length: k }, (_, i) => `w${i}`).join(' ');

describe('the Library (D112)', () => {
  it('makes a book thicker the more was written, from a tappable spine to a thick one', () => {
    expect(bookThickness(0)).toBe(BOOK_MIN_THICKNESS);
    expect(bookThickness(-5)).toBe(BOOK_MIN_THICKNESS);
    expect(bookThickness(4000)).toBe(BOOK_MAX_THICKNESS);
    expect(bookThickness(1_000_000)).toBe(BOOK_MAX_THICKNESS);
    expect(BOOK_MIN_THICKNESS).toBeGreaterThanOrEqual(24);
    let last = 0;
    for (const w of [0, 10, 50, 100, 300, 600, 1000, 2000, 3000, 4000]) {
      const t = bookThickness(w);
      expect(t).toBeGreaterThanOrEqual(last);
      expect(Number.isInteger(t)).toBe(true);
      last = t;
    }
    // A long entry shows: a page-long one is clearly thicker than a note.
    expect(bookThickness(500) - bookThickness(20)).toBeGreaterThanOrEqual(8);
  });

  it('stands a very long entry taller, within the shelf, the same each time', () => {
    for (const id of ['a', 'b', 'c', 'zz', 'e123']) {
      for (const w of [0, 1499, 1500, 2999, 3000, 50_000]) {
        const h = bookHeight(w, id);
        expect(h).toBeGreaterThanOrEqual(BOOK_HEIGHT);
        expect(h).toBeLessThanOrEqual(BOOK_MAX_HEIGHT);
        expect(bookHeight(w, id)).toBe(h);
      }
      expect(bookHeight(3000, id)).toBeGreaterThan(bookHeight(1499, id));
    }
  });

  it('shelves books by month in a gallery for each year, in the order of their days', () => {
    const a = entry('2025-12-31', words(10));
    const b = entry('2026-01-02', words(800), { mood: '😄' });
    const c = entry('2026-01-02', words(5), { createdAt: '2026-01-02T08:00:00.000Z' });
    const d = entry('2026-03-15', '');
    const gone = entry('2026-02-01', words(20), { deletedAt: '2026-02-02T00:00:00.000Z' });
    const library = shelveLibrary([d, b, gone, a, c], entryWordCount);
    expect(library.map((g) => g.year)).toEqual(['2025', '2026']);
    expect(library[1]!.months.map((m) => m.month)).toEqual(['2026-01', '2026-03']);
    // The same day: the one written first comes first.
    expect(library[1]!.months[0]!.books.map((x) => x.id)).toEqual([c.id, b.id]);
    expect(library[1]!.books).toBe(3);
    const book = library[1]!.months[0]!.books[1]!;
    expect(book).toMatchObject({ title: b.title, date: '2026-01-02', words: 802, mood: '😄', thickness: bookThickness(802) });
    expect(book.tone).toBeGreaterThanOrEqual(0);
    expect(book.tone).toBeLessThan(4);
    expect(library[1]!.words).toBe(802 + 7 + 2);
    expect(library[1]!.months[0]!.words).toBe(802 + 7);
    // An empty entry is still a book, the thinnest.
    expect(library[1]!.months[1]!.books[0]).toMatchObject({ words: 2, thickness: bookThickness(2) });
  });

  it('is empty with no entries, and leaves the list it was given as it was', () => {
    expect(shelveLibrary([], entryWordCount)).toEqual([]);
    const list = [entry('2026-05-02', 'b'), entry('2026-05-01', 'a')];
    const ids = list.map((e) => e.id);
    shelveLibrary(list, entryWordCount);
    expect(list.map((e) => e.id)).toEqual(ids);
  });
});
