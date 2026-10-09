import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Every file in a folder, relative, sorted. */
export function tree(dir: string, prefix = ''): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((d) => (d.isDirectory() ? tree(join(dir, d.name), `${prefix}${d.name}/`) : [`${prefix}${d.name}`]))
    .sort();
}

/** An entry as another computer's Logbook would have saved it. */
export function entry(id: string, date: string, title: string, text: string, rev = 1) {
  return {
    v: 1,
    id,
    date,
    title,
    mood: null,
    cover: { kind: 'gradient', gradient: 'sunrise' },
    tags: [],
    blocks: [{ id: 'b1', type: 'text', doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] } }],
    createdAt: `${date}T09:00:00.000Z`,
    updatedAt: `${date}T09:00:00.000Z`,
    rev,
    deletedAt: null,
  };
}

/** Writes a file into the folder the way a sync service would, creating folders. */
export function put(folder: string, path: string, value: unknown): void {
  mkdirSync(join(folder, path, '..'), { recursive: true });
  writeFileSync(join(folder, path), typeof value === 'string' ? value : JSON.stringify(value, null, 2));
}
