import { describe, expect, it } from 'vitest';
import { growGarden, plantHeight, plantWords, rankFor, rankName, sizeStage, wordGrowth } from '../src/garden.ts';
import type { Entry } from '../src/model.ts';
import { emptyDoc } from '../src/richtext.ts';

let n = 0;
function entry(text: string, opts: Partial<Entry> = {}): Entry {
  n++;
  const at = opts.createdAt ?? `2026-10-${String(1 + (n % 28)).padStart(2, '0')}T10:00:00.000Z`;
  return { v: 1, id: `e${n}`, date: at.slice(0, 10), title: '', mood: null, cover: { kind: 'gradient', gradient: 'sunrise' }, tags: [], blocks: [{ id: `b${n}`, type: 'text', doc: emptyDoc(text) }], createdAt: at, updatedAt: at, rev: 1, deletedAt: null, expiresAt: null, musicId: null, musicUrl: null, ...opts } as Entry;
}
const words = (k: number, seed = 'w') => Array.from({ length: k }, (_, i) => `${seed}${i.toString(36)}x`).join(' ');

describe('the garden (D97)', () => {
  it('counts written words, not links, junk, number lists or repeated sentences', () => {
    expect(plantWords(entry('A quiet walk by the river today.')).written).toBe(7);
    expect(plantWords(entry('See https://example.com/a/very/long/path and www.example.org now')).written).toBe(3);
    expect(plantWords(entry('aaaaaaa zzzz ok')).written).toBe(1);
    expect(plantWords(entry(Array.from({ length: 100 }, (_, i) => i).join(' '))).written).toBe(25);
    expect(plantWords(entry('I love this day. I love this day. I love this day.')).written).toBe(4);
  });

  it('gives copies of earlier entries nothing, and a little for pictures and voice', () => {
    const seen = new Set<number>();
    const text = 'The sea was calm and the sky was wide open.';
    expect(plantWords(entry(text), seen).written).toBe(10);
    expect(plantWords(entry(text), seen).written).toBe(0);
    const media = entry('Hi', { blocks: [{ id: 'p', type: 'photo', mediaId: 'm1', caption: '' }, { id: 'a', type: 'audio', mediaId: 'm2', caption: '' }] as Entry['blocks'] });
    expect(plantWords(media).words).toBe(50);
  });

  it('sizes plants by their words and grows Growth on a slowing curve', () => {
    expect([0, 19, 20, 150, 600, 2500].map(sizeStage)).toEqual([0, 0, 1, 3, 5, 7]);
    expect([0, 20, 3000, 9000].map(plantHeight)).toEqual([36, 60, 210, 210]);
    expect([20, 100, 1000, 3000, 9000].map(wordGrowth)).toEqual([18, 74, 294, 439, 439]);
  });

  it('ranks the garden on 15 tiers, then rings', () => {
    expect(rankName(rankFor(0))).toBe('Common');
    expect(rankName(rankFor(1_000))).toBe('Rare');
    expect(rankName(rankFor(249_999))).toBe('Primordial');
    expect(rankName(rankFor(250_000))).toBe('Worldbloom');
    expect(rankName(rankFor(350_000))).toBe('Worldbloom ★2');
    expect(rankFor(1_200)).toMatchObject({ from: 1_000, next: 2_000 });
  });

  it('gives each plant the garden’s rank before it, plus ribbons for long entries; a day counts once', () => {
    const day = '2026-03-01T09:00:00.000Z';
    const g = growGarden([
      entry(words(100, 'a'), { createdAt: day, mood: '🥰' }),
      entry(words(100, 'b'), { createdAt: '2026-03-01T20:00:00.000Z' }),
      entry(words(700, 'c'), { createdAt: '2026-03-02T09:00:00.000Z' }),
    ]);
    // Day 1: 100 for turning up + G(200) = 122; day 2: 100 + G(700) = 248.
    expect(g.rank.growth).toBe(100 + wordGrowth(200) + 100 + wordGrowth(700));
    expect(g.plants.map((p) => [p.species, p.tier, p.bonus])).toEqual([
      ['Rose', 0, 0],
      ['Wildflower', 0, 0],
      ['Wildflower', 1, 1],
    ]);
  });

  it('keeps trashed entries’ Growth but shows only live plants', () => {
    const g = growGarden([entry(words(50, 'd')), entry(words(50, 'e'), { deletedAt: '2026-10-10T00:00:00.000Z' })]);
    expect(g.plants).toHaveLength(1);
    expect(g.rank.growth).toBeGreaterThan(growGarden([entry(words(50, 'f'))]).rank.growth);
  });
});
