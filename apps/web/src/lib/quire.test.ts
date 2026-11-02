import { beforeEach, describe, expect, it } from 'vitest';
import { PAGES } from './lore.ts';
import { findPage, quire, setRest } from './quire.ts';

describe('Silas Quire’s pages (D119)', () => {
  beforeEach(() => {
    localStorage.removeItem('logbook.quire');
    setRest(false);
  });

  it('are kept as they’re found, each once, and counted', () => {
    expect(quire()).toEqual({ found: [], rest: false });
    expect(findPage('p3')).toEqual({ fresh: true, count: 1, all: false });
    expect(findPage('p3')).toEqual({ fresh: false, count: 1, all: false });
    expect(findPage('p1')).toEqual({ fresh: true, count: 2, all: false });
    // In the notebook's order, whatever order they were found in.
    expect(quire().found).toEqual(['p1', 'p3']);
    expect(JSON.parse(localStorage.getItem('logbook.quire')!)).toEqual({ found: ['p1', 'p3'], rest: false });
  });

  it('all seven lay him to rest; he can be woken, and laid to rest again; never with pages missing', () => {
    setRest(true);
    expect(quire().rest).toBe(false);
    let last = { fresh: false, count: 0, all: false };
    for (const p of PAGES) last = findPage(p.id);
    expect(last).toEqual({ fresh: true, count: 7, all: true });
    expect(quire().rest).toBe(true);
    setRest(false);
    expect(quire().rest).toBe(false);
    setRest(true);
    expect(quire().rest).toBe(true);
    // Whatever was stored, rest needs every page.
    localStorage.setItem('logbook.quire', JSON.stringify({ found: ['p1', 'nonsense'], rest: true }));
    setRest(true);
    expect(quire()).toEqual({ found: ['p1'], rest: false });
  });
});
