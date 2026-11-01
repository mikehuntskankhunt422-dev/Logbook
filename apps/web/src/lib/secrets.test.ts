import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./motion.ts', () => ({ celebrate: vi.fn() }));
const announced: string[] = [];
vi.mock('../app/toasts.tsx', () => ({ announce: (message: string) => announced.push(message) }));

const { ALL_FOUND_SHIELDS, endsWithCode, findSecret, isTheAnswer, KONAMI, SECRETS, secrets, setPerk, spendShields } = await import('./secrets.ts');

const KEY = 'logbook.secrets';

beforeEach(() => {
  localStorage.clear();
  announced.length = 0;
  // A fresh start: the store reads storage again before every change.
  localStorage.setItem(KEY, '{}');
  setPerk('stars', false);
});

describe('secrets (D115)', () => {
  it('has eight, with perks and rewards both among them, and every id once', () => {
    expect(SECRETS).toHaveLength(8);
    expect(new Set(SECRETS.map((s) => s.id)).size).toBe(8);
    expect(SECRETS.filter((s) => s.prize.kind === 'perk')).toHaveLength(4);
    expect(SECRETS.filter((s) => s.prize.kind === 'reward')).toHaveLength(4);
    expect(new Set(SECRETS.flatMap((s) => (s.prize.kind === 'perk' ? [s.prize.perk] : []))).size).toBe(4);
  });

  it('a perk is switched on when its secret is found, and says so once', () => {
    expect(secrets().stars).toBe(false);
    expect(findSecret('starstruck')).toBe(true);
    expect(secrets().stars).toBe(true);
    expect(secrets().found.starstruck).toMatch(/^\d{4}-\d\d-\d\d$/);
    expect(announced).toEqual(['🥚 Secret found: ✦ Starstruck (1 of 8). New perk: Star celebrations.']);
    // Switched off, it stays off: finding it again does nothing.
    setPerk('stars', false);
    expect(findSecret('starstruck')).toBe(false);
    expect(secrets().stars).toBe(false);
    expect(announced).toHaveLength(1);
  });

  it('a reward adds its shields; all eight add three more', () => {
    findSecret('sand');
    expect(secrets().shields).toBe(2);
    expect(announced.at(-1)).toBe('🥚 Secret found: 📕 The Book of Sand (1 of 8). Reward: 2 streak shields.');
    findSecret('spoton');
    expect(secrets().shields).toBe(3);
    for (const s of SECRETS) findSecret(s.id);
    const rewards = SECRETS.reduce((n, s) => n + (s.prize.kind === 'reward' ? s.prize.shields : 0), 0);
    expect(secrets().shields).toBe(rewards + ALL_FOUND_SHIELDS);
    expect(announced.at(-1)).toMatch(/\(8 of 8\)\. Reward: a streak shield\. That’s every secret: the ✦ by Logbook’s name turns gold, and you get 3 more streak shields\.$/);
    expect(secrets()).toMatchObject({ stars: true, arcade: true, gnome: true, curious: true });
  });

  it('spends shields only when there are enough for every day missed, and never twice on one day', () => {
    findSecret('sand');
    expect(spendShields(['2026-10-04', '2026-10-05', '2026-10-06'])).toBe(0);
    expect(secrets().shields).toBe(2);
    expect(spendShields(['2026-10-04'])).toBe(1);
    expect(secrets()).toMatchObject({ shields: 1, shielded: ['2026-10-04'] });
    expect(spendShields(['2026-10-04'])).toBe(0);
    expect(spendShields(['2026-10-04', '2026-10-05'])).toBe(1);
    expect(secrets()).toMatchObject({ shields: 0, shielded: ['2026-10-04', '2026-10-05'] });
  });

  it('reads back only what fits, whatever is in storage', () => {
    localStorage.setItem(KEY, JSON.stringify({ found: { sand: '2026-10-01', bogus: '2026-10-01', spoton: 'yesterday' }, shields: -4, shielded: ['2026-10-02', 7, 'x'], stars: 'yes', gnome: true }));
    setPerk('arcade', false);
    expect(secrets()).toEqual({ found: { sand: '2026-10-01' }, shields: 0, shielded: ['2026-10-02'], stars: false, arcade: false, gnome: true, curious: false });
    localStorage.setItem(KEY, 'not json');
    setPerk('arcade', true);
    expect(secrets().arcade).toBe(true);
  });

  it('knows the code, at the end of whatever was typed before it', () => {
    expect(endsWithCode([...KONAMI])).toBe(true);
    expect(endsWithCode(['ArrowUp', ...KONAMI])).toBe(true);
    expect(endsWithCode(KONAMI.slice(1))).toBe(false);
    expect(endsWithCode([...KONAMI.slice(0, -1), 'b'])).toBe(false);
  });

  it('knows the answer to life, the universe and everything', () => {
    for (const q of ['42', ' 42 ', 'The answer to life, the universe and everything', 'what is the answer to the ultimate question of life, the universe, and everything?']) expect(isTheAnswer(q), q).toBe(true);
    for (const q of ['4', '420', '142', 'answer', 'the universe']) expect(isTheAnswer(q), q).toBe(false);
  });
});
