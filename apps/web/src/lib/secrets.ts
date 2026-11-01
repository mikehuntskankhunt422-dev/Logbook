import { useSyncExternalStore } from 'react';
import { today } from '@logbook/core';
import { announce } from '../app/toasts.tsx';
import { celebrate } from './motion.ts';

/**
 * Secrets (D115): eight easter eggs hidden around Logbook. Finding one gives either a new perk
 * (switched on at once, and off again on the Secrets page) or a reward: streak shields, which keep
 * a streak going over a day with nothing written. Finding all eight turns the ✦ by Logbook's name
 * gold and gives three more shields. Like the garden's perks, all of it belongs to the device
 * (browser storage), so the journal's format doesn't change.
 */

export type SecretId = 'starstruck' | 'oldschool' | 'knock' | 'lastfolder' | 'sand' | 'spoton' | 'panic' | 'bookworm';
/** The perks secrets give, each a switch. */
export type SecretPerk = 'stars' | 'arcade' | 'gnome' | 'curious';

export type Prize = { kind: 'perk'; perk: SecretPerk; title: string; text: string } | { kind: 'reward'; shields: number };

export interface Secret {
  id: SecretId;
  emoji: string;
  name: string;
  /** Where to look, shown before it's found. */
  hint: string;
  /** What finding it was like, shown after. */
  found: string;
  prize: Prize;
}

export const SECRETS: readonly Secret[] = [
  {
    id: 'starstruck',
    emoji: '✦',
    name: 'Starstruck',
    hint: 'The star by Logbook’s name likes attention. Give it seven taps in a row.',
    found: 'You tapped the star until it spun.',
    prize: { kind: 'perk', perk: 'stars', title: 'Star celebrations', text: 'Celebrations throw gold stars instead of confetti or petals.' },
  },
  {
    id: 'sand',
    emoji: '📕',
    name: 'The Book of Sand',
    hint: 'In the 📚 Library, walk on through ten empty galleries past your newest book.',
    found: 'Ten galleries past your newest book, a book with no first page and no last.',
    prize: { kind: 'reward', shields: 2 },
  },
  {
    id: 'oldschool',
    emoji: '🕹️',
    name: 'Old school',
    hint: 'On a keyboard, anywhere but a text box: up, up, down, down, left, right, left, right, B, A.',
    found: 'You know the code.',
    prize: { kind: 'perk', perk: 'arcade', title: 'Arcade colours', text: 'Neon arcade colours for the whole app.' },
  },
  {
    id: 'spoton',
    emoji: '⏱️',
    name: 'Spot on',
    hint: 'On the ⏰ Clock, stop the stopwatch at exactly 0:10.00.',
    found: 'Ten seconds, not a hundredth more.',
    prize: { kind: 'reward', shields: 1 },
  },
  {
    id: 'knock',
    emoji: '🚪',
    name: 'Knock knock',
    hint: 'Someone lives behind the 🌱 Garden’s gate. Knock three times.',
    found: 'Who’s there? A garden gnome, who moved in.',
    prize: { kind: 'perk', perk: 'gnome', title: 'A garden gnome', text: 'A gnome stands by the garden gate.' },
  },
  {
    id: 'panic',
    emoji: '🌌',
    name: 'Don’t panic',
    hint: '🔍 Search for the answer to life, the universe and everything.',
    found: 'You searched for 42. Don’t panic: here are two shields for days that go wrong.',
    prize: { kind: 'reward', shields: 2 },
  },
  {
    id: 'lastfolder',
    emoji: '🗂️',
    name: 'The last folder',
    hint: 'The storage room behind the Library has no end. Walk thirty empty aisles past your last folder anyway.',
    found: 'In the last folder, questions nobody has answered yet.',
    prize: { kind: 'perk', perk: 'curious', title: 'Curious prompts', text: 'A dozen stranger writing prompts join the usual ones on new entries.' },
  },
  {
    id: 'bookworm',
    emoji: '🐛',
    name: 'Bookworm',
    hint: 'In the 📚 Library, read a book of four pages or more to its last page.',
    found: 'You read one of your own books to the end.',
    prize: { kind: 'reward', shields: 1 },
  },
];

/** Shields for finding every secret, besides the ✦ turning gold. */
export const ALL_FOUND_SHIELDS = 3;

export interface SecretsState {
  /** Each secret found, and the day it was. */
  found: Partial<Record<SecretId, string>>;
  /** Streak shields not yet used. */
  shields: number;
  /** Days shields have covered. */
  shielded: string[];
  stars: boolean;
  arcade: boolean;
  gnome: boolean;
  curious: boolean;
}

const DEFAULTS: SecretsState = { found: {}, shields: 0, shielded: [], stars: false, arcade: false, gnome: false, curious: false };
const ISO_DAY = /^\d{4}-\d\d-\d\d$/;

const KEY = 'logbook.secrets';
const listeners = new Set<() => void>();
let current: SecretsState = load();

/** The saved state, or `fallback` when there's none (or storage can't be read), cleaned of anything that doesn't fit. */
function load(fallback: SecretsState = DEFAULTS): SecretsState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return fallback;
    const data = JSON.parse(raw) as Partial<Record<keyof SecretsState, unknown>>;
    const found: SecretsState['found'] = {};
    if (data.found && typeof data.found === 'object')
      for (const s of SECRETS) {
        const day = (data.found as Record<string, unknown>)[s.id];
        if (typeof day === 'string' && ISO_DAY.test(day)) found[s.id] = day;
      }
    const flag = (k: SecretPerk) => data[k] === true;
    return {
      found,
      shields: typeof data.shields === 'number' && Number.isInteger(data.shields) && data.shields > 0 ? data.shields : 0,
      shielded: Array.isArray(data.shielded) ? data.shielded.filter((d): d is string => typeof d === 'string' && ISO_DAY.test(d)) : [],
      stars: flag('stars'),
      arcade: flag('arcade'),
      gnome: flag('gnome'),
      curious: flag('curious'),
    };
  } catch {
    return fallback;
  }
}

function save(patch: (state: SecretsState) => Partial<SecretsState>): SecretsState {
  // Read again first, so what another window did meanwhile isn't written over.
  const fresh = load(current);
  current = { ...fresh, ...patch(fresh) };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // Private browsing: it lasts until the page closes.
  }
  for (const l of listeners) l();
  return current;
}

if (typeof window !== 'undefined')
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY && e.key !== null) return;
    current = load();
    for (const l of listeners) l();
  });

export function secrets(): SecretsState {
  return current;
}

export function useSecrets(): SecretsState {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => current,
  );
}

export const foundCount = (state: SecretsState) => SECRETS.filter((s) => state.found[s.id]).length;
export const allFound = (state: SecretsState) => foundCount(state) === SECRETS.length;

export function setPerk(perk: SecretPerk, on: boolean): void {
  save(() => ({ [perk]: on }));
}

const shieldWord = (n: number) => (n === 1 ? 'a streak shield' : `${n} streak shields`);

/** What a secret gives, in a few words: "New perk: Star celebrations." */
export function prizeText(prize: Prize): string {
  return prize.kind === 'perk' ? `New perk: ${prize.title}.` : `Reward: ${shieldWord(prize.shields)}.`;
}

/**
 * Finds a secret: its prize given (a perk switched on, or shields added), and a word and a
 * celebration to say so. Only the first time; false after.
 */
export function findSecret(id: SecretId): boolean {
  const secret = SECRETS.find((s) => s.id === id);
  if (!secret || load(current).found[id]) return false;
  const state = save((s) => {
    const found = { ...s.found, [id]: today() };
    const every = SECRETS.every((x) => found[x.id]);
    const prize = secret.prize;
    return {
      found,
      shields: s.shields + (prize.kind === 'reward' ? prize.shields : 0) + (every ? ALL_FOUND_SHIELDS : 0),
      ...(prize.kind === 'perk' ? { [prize.perk]: true } : {}),
    };
  });
  const n = foundCount(state);
  const every = n === SECRETS.length;
  const more = every ? ` That’s every secret: the ✦ by Logbook’s name turns gold, and you get ${ALL_FOUND_SHIELDS} more streak shields.` : '';
  announce(`🥚 Secret found: ${secret.emoji} ${secret.name} (${n} of ${SECRETS.length}). ${prizeText(secret.prize)}${more}`, { label: 'See secrets', run: () => (location.hash = '#/secrets') }, 9000);
  celebrate('streak');
  return true;
}

/**
 * Spends shields on days missed (`missedDays`), if there are enough for all of them and they aren't
 * covered already (by another window, say). How many were spent: 0 when none could be.
 */
export function spendShields(days: readonly string[]): number {
  const fresh = load(current);
  const need = days.filter((d) => !fresh.shielded.includes(d));
  if (!need.length || need.length > fresh.shields) return 0;
  save((s) => ({ shields: s.shields - need.length, shielded: [...s.shielded, ...need] }));
  return need.length;
}

/** The Konami code, key by key (letters in lower case). */
export const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'] as const;

/** Whether the last keys pressed end with the code. */
export function endsWithCode(keys: readonly string[], code: readonly string[] = KONAMI): boolean {
  return keys.length >= code.length && code.every((k, i) => keys[keys.length - code.length + i] === k);
}

/** A search for the answer to life, the universe and everything. */
export function isTheAnswer(query: string): boolean {
  const q = query.trim().toLowerCase().replace(/[’']/g, "'");
  return q === '42' || /^(what is |what's )?the answer to (the ultimate question of )?life,? the universe,? and everything\??$/.test(q);
}

/** Thirty of the storage room's empty aisles past the last folder; ten of the Library's empty galleries past the newest book. */
export const LAST_FOLDER_AISLES = 30;
export const BOOK_OF_SAND_GALLERIES = 10;
