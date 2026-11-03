import { beforeEach, describe, expect, it } from 'vitest';
import { CLERK_FOLDERS, clerkQuest, findClerkFolder, handBack } from './clerk-quest.ts';
import { secrets } from './secrets.ts';

describe('the Clerk’s quest (D123)', () => {
  beforeEach(() => {
    localStorage.removeItem('logbook.clerk');
    localStorage.removeItem('logbook.secrets');
  });

  it('keeps his folders as they’re found, each once, in order', () => {
    expect(findClerkFolder('f3')).toEqual({ fresh: true, count: 1 });
    expect(findClerkFolder('f3')).toEqual({ fresh: false, count: 1 });
    expect(findClerkFolder('f1')).toEqual({ fresh: true, count: 2 });
    expect(clerkQuest()).toEqual({ found: ['f1', 'f3'], done: false });
  });

  it('only all three can be handed back: two shields and his lantern', () => {
    const before = secrets().shields;
    findClerkFolder('f1');
    expect(handBack()).toBe(false);
    for (const f of CLERK_FOLDERS) findClerkFolder(f.id);
    expect(handBack()).toBe(true);
    expect(clerkQuest().done).toBe(true);
    expect(secrets().shields).toBe(before + 2);
    // Once.
    expect(handBack()).toBe(false);
    expect(secrets().shields).toBe(before + 2);
  });

  it('are spread out: the first just past your folders, the rest further, each a different aisle', () => {
    const aisles = CLERK_FOLDERS.map((f) => f.aisles);
    expect(new Set(aisles).size).toBe(aisles.length);
    expect(Math.min(...aisles)).toBe(1);
  });
});
