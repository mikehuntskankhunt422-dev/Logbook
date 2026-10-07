import MiniSearch from 'minisearch';
import type { Entry } from './model.ts';
import { entryPlainText } from './richtext.ts';

interface Doc {
  id: string;
  title: string;
  text: string;
  tags: string;
  date: string;
}

export interface SearchHit {
  id: string;
  score: number;
  terms: string[];
}

/**
 * Full-text index kept in memory only. It is rebuilt on unlock and never written to disk, so it
 * cannot leak plaintext from an encrypted journal.
 */
export class SearchIndex {
  private ms = new MiniSearch<Doc>({
    fields: ['title', 'text', 'tags'],
    storeFields: ['date'],
    searchOptions: { boost: { title: 3, tags: 2 }, prefix: true, fuzzy: 0.2, combineWith: 'AND' },
  });

  rebuild(entries: Entry[]): void {
    this.ms.removeAll();
    this.ms.addAll(entries.filter((e) => !e.deletedAt).map(toDoc));
  }

  upsert(entry: Entry): void {
    if (this.ms.has(entry.id)) this.ms.discard(entry.id);
    if (!entry.deletedAt) this.ms.add(toDoc(entry));
  }

  remove(id: string): void {
    if (this.ms.has(id)) this.ms.discard(id);
  }

  search(query: string): SearchHit[] {
    const q = query.trim();
    if (!q) return [];
    return this.ms.search(q).map((r) => ({ id: String(r.id), score: r.score, terms: r.terms }));
  }
}

function toDoc(e: Entry): Doc {
  return { id: e.id, title: e.title, text: entryPlainText(e), tags: e.tags.join(' '), date: e.date };
}

/** Tag → count, most used first. */
export function tagCounts(entries: Entry[]): [string, number][] {
  const m = new Map<string, number>();
  for (const e of entries) for (const t of e.tags) m.set(t, (m.get(t) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}
