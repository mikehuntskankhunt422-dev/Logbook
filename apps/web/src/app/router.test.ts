import { describe, expect, it } from 'vitest';
import { href, parseHash, type Route } from './router.ts';

describe('hash router', () => {
  it.each<[string, Route]>([
    ['', { name: 'home' }],
    ['#/', { name: 'home' }],
    ['#/entry/abc123', { name: 'entry', id: 'abc123' }],
    ['#/new?date=2026-10-07', { name: 'new', date: '2026-10-07' }],
    ['#/calendar?month=2026-10', { name: 'calendar', month: '2026-10' }],
    ['#/search?tag=beach-day', { name: 'search', tag: 'beach-day' }],
    ['#/memories', { name: 'memories' }],
    ['#/settings', { name: 'settings' }],
    ['#/nonsense', { name: 'home' }],
    ['#/entry/', { name: 'home' }],
  ])('parses %s', (hash, route) => {
    expect(parseHash(hash)).toMatchObject(route);
  });

  it('round-trips href → parseHash', () => {
    const routes: Route[] = [{ name: 'entry', id: 'a b/c' }, { name: 'new', date: '2026-01-02' }, { name: 'search', tag: 'x&y' }, { name: 'calendar', month: '2025-12' }];
    for (const r of routes) expect(parseHash(href(r))).toMatchObject(r);
  });
});
