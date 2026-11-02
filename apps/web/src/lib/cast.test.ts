import { describe, expect, it } from 'vitest';
import { libraryFacts, type LibraryGallery } from '@logbook/core';
import { factsFor, greeting, persona, topics, type CastContext } from './cast.ts';
import { aiPrefs, aiReady, modelOf, setAiKey, setAiModel, setAiPrefs } from './ai.ts';

const book = (id: string, date: string, words: number, title = id) => ({ id, title, date, words, mood: null, thickness: 24, height: 96, tone: 0 });
const galleries: LibraryGallery[] = [
  { year: '2025', books: 1, words: 40, months: [{ month: '2025-11', words: 40, books: [book('a', '2025-11-02', 40, 'Dear diary')] }] },
  { year: '2026', books: 2, words: 1300, months: [{ month: '2026-03', words: 1300, books: [book('b', '2026-03-01', 1200, 'The big one'), book('c', '2026-03-09', 100, 'Small')] }] },
];
const facts = libraryFacts(galleries, '2026-11-01', 3);
const ctx = (patch: Partial<CastContext> = {}): CastContext => ({ facts, horror: 'off', found: new Set(), ...patch });
const ids = (c: CastContext, who: 'librarian' | 'clerk' = 'librarian') => topics(who, c).map((t) => t.id);

describe('what the Librarian and the Clerk say (D116)', () => {
  it('answer from the library’s numbers, and lead to the book where there is one', () => {
    const t = Object.fromEntries(topics('librarian', ctx()).map((x) => [x.id, x.reply]));
    expect(t['how-much']!.text).toBe('3 books and 1,340 words, across 2 galleries (2025, 2026). That’s about 447 words a book.');
    expect(t.longest!.text).toMatch(/^“The big one”, from .*2026: 1,200 words\. It stands in Gallery 2026\.$/);
    expect(t.longest!.take).toEqual({ kind: 'book', id: 'b', label: 'Take me there' });
    expect(t['year-ago']!.take?.id).toBe('a');
    expect(t.first!.take?.id).toBe('a');
    expect(t['how-much']!.take).toBeUndefined();
    const c = Object.fromEntries(topics('clerk', ctx()).map((x) => [x.id, x.reply]));
    expect(c.newest!.take).toEqual({ kind: 'folder', id: 'c', label: 'Show me the folder' });
    expect(c['how-many']!.text).toBe('3 folders in 2 aisles. After that, empty racks. Lots of them.');
  });

  it('with nothing written, say so, and lead nowhere', () => {
    const empty = ctx({ facts: libraryFacts([], '2026-11-01') });
    for (const who of ['librarian', 'clerk'] as const) for (const t of topics(who, empty)) expect(t.reply.take, `${who} ${t.id}`).toBeUndefined();
    expect(greeting('librarian', empty)).toMatch(/shelves are ready/);
  });

  it('hint at the next secret not yet found, until all are', () => {
    const hint = (found: string[]) => topics('librarian', ctx({ found: new Set(found) as CastContext['found'] })).find((t) => t.id === 'secrets')!.reply.text;
    expect(hint([])).toMatch(/^One I can tell you about: the star by Logbook’s name/);
    expect(hint(['starstruck'])).toMatch(/ten empty galleries past your newest book/);
    expect(hint(['starstruck', 'sand', 'oldschool', 'spoton', 'knock', 'panic', 'lastfolder', 'bookworm'])).toMatch(/^You’ve found every one/);
  });

  it('know what walks the empty places only with horror on', () => {
    expect(ids(ctx())).not.toContain('unwritten');
    expect(ids(ctx(), 'clerk')).not.toContain('who-else');
    expect(ids(ctx({ horror: 'unsettling' }))).toContain('unwritten');
    expect(ids(ctx({ horror: 'intense' }), 'clerk')).toContain('who-else');
    expect(topics('librarian', ctx({ horror: 'intense' })).find((t) => t.id === 'unwritten')!.reply.text).toMatch(/you’ll wake at my door/);
    expect(greeting('librarian', ctx({ horror: 'intense' }))).toMatch(/near your books/);
  });

  it('with horror on, tell his story and how to stop him (D118)', () => {
    expect(ids(ctx())).not.toContain('who-was-he');
    expect(ids(ctx())).not.toContain('stop-him');
    expect(ids(ctx(), 'clerk')).not.toContain('knew-him');
    const t = Object.fromEntries(topics('librarian', ctx({ horror: 'unsettling' })).map((x) => [x.id, x.reply.text]));
    expect(t['who-was-he']).toMatch(/Silas Quire/);
    expect(t['stop-him']).toMatch(/Look at him/);
    expect(t['stop-him']).toMatch(/fresh ink slows him/);
    expect(topics('clerk', ctx({ horror: 'intense' })).find((x) => x.id === 'knew-him')!.reply.text).toMatch(/empty folders/);
    // What's left of him (D119): his pages, by how many are found; the Clerk's drawer leads to one.
    const left = (pages: number) => topics('librarian', ctx({ horror: 'unsettling', pages })).find((x) => x.id === 'his-pages')!.reply.text;
    expect(left(0)).toMatch(/seven pages/);
    expect(left(3)).toMatch(/You’ve found 3 pages of his seven/);
    expect(left(7)).toMatch(/He’s resting now/);
    expect(topics('clerk', ctx({ horror: 'unsettling' })).find((x) => x.id === 'his-folder')!.reply.take).toEqual({ kind: 'quire', id: 'p7', label: 'Look inside' });
    expect(ids(ctx(), 'clerk')).not.toContain('his-folder');
  });
});

describe('who they are to an AI (D116)', () => {
  it('numbers only, unless titles are allowed; never anything more', () => {
    const numbers = factsFor(facts, 'numbers');
    expect(numbers).toContain('Books (entries): 3; words: 1340');
    expect(numbers).toContain('Longest book: 2026-03-01, 1,200 words');
    expect(numbers).not.toMatch(/Dear diary|The big one|Small/);
    expect(numbers).toContain('Titles are private');
    const titles = factsFor(facts, 'titles');
    expect(titles).toContain('Longest book: “The big one”, 2026-03-01, 1,200 words');
  });

  it('stay in character, briefly, and only with the facts given', () => {
    const p = persona('clerk', ctx({ horror: 'unsettling' }), factsFor(facts, 'numbers'), 'Storage room · Aisle 1');
    expect(p).toMatch(/^You are the Clerk/);
    expect(p).toContain('The Unwritten');
    expect(p).toContain('Silas Quire');
    expect(p).toContain('one to three short sentences');
    expect(p).toContain('never invent entries');
    expect(persona('librarian', ctx(), 'x', 'Gallery 2026')).not.toContain('The Unwritten');
  });
});

describe('the AI settings (D116, D118)', () => {
  it('read 0.9.12’s Claude-only settings as Claude’s, cleaned', () => {
    localStorage.setItem('logbook.ai', JSON.stringify({ key: '  sk-ant-1  ', model: 'gpt-x', share: 'everything' }));
    setAiPrefs({});
    expect(aiPrefs()).toEqual({ provider: 'anthropic', keys: { anthropic: 'sk-ant-1' }, models: {}, share: 'numbers' });
    expect(modelOf(aiPrefs())).toBe('claude-opus-5-5');
    expect(aiReady(aiPrefs())).toBe(true);
    localStorage.setItem('logbook.ai', JSON.stringify({ key: 'sk-ant-2', model: 'claude-haiku-5-5', share: 'titles' }));
    setAiPrefs({});
    expect(aiPrefs()).toEqual({ provider: 'anthropic', keys: { anthropic: 'sk-ant-2' }, models: { anthropic: 'claude-haiku-5-5' }, share: 'titles' });
  });

  it('keep each provider’s key and model, need both for the one chosen, and nothing once they all go', () => {
    localStorage.removeItem('logbook.ai');
    setAiPrefs({});
    setAiKey('anthropic', ' sk-ant-1 ');
    setAiPrefs({ provider: 'openai' });
    expect(aiReady(aiPrefs())).toBe(false);
    setAiKey('openai', 'sk-1');
    // A key, but no model yet: the other providers' models must be picked.
    expect(modelOf(aiPrefs())).toBe('');
    expect(aiReady(aiPrefs())).toBe(false);
    setAiModel('openai', '  gpt-x  ');
    expect(aiReady(aiPrefs())).toBe(true);
    expect(JSON.parse(localStorage.getItem('logbook.ai')!)).toEqual({ provider: 'openai', keys: { anthropic: 'sk-ant-1', openai: 'sk-1' }, models: { openai: 'gpt-x' }, share: 'numbers' });
    // An unknown provider or a model Claude doesn't have reads as nothing.
    localStorage.setItem('logbook.ai', JSON.stringify({ provider: 'acme', keys: { acme: 'x', openai: 7 }, models: { anthropic: 'gpt-x' } }));
    setAiPrefs({});
    expect(aiPrefs()).toEqual({ provider: 'anthropic', keys: {}, models: {}, share: 'numbers' });
    expect(localStorage.getItem('logbook.ai')).toBeNull();
    setAiKey('gemini', 'AIza1');
    setAiKey('gemini', '');
    expect(localStorage.getItem('logbook.ai')).toBeNull();
  });
});
