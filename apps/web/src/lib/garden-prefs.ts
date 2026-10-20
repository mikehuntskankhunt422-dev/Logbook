import { useSyncExternalStore } from 'react';
import type { GardenTab } from '../app/router.ts';

/**
 * The garden's perks (D97) and the choices made with them. Every tier unlocks one; none changes
 * anything outside the garden until it's chosen, and none is ever taken back. Choices belong to
 * the device (browser storage), like the clock, so the journal's format doesn't change.
 */

export interface GardenPrefs {
  hidden: boolean;
  petals: boolean;
  visitors: boolean;
  accent: string;
  livingSky: boolean;
  path: string;
  lanterns: boolean;
  border: string;
  ornament: string;
  stars: boolean;
  aurora: boolean;
  nebula: boolean;
  goldSigns: boolean;
  ancient: boolean;
  /** The highest rank seen on this device (tier × 1000 + ring), for "your garden reached…". */
  seen: number;
  /** The garden update last announced on this device (FEATURES' catalogue numbers). */
  catalogue: number;
}

const DEFAULTS: GardenPrefs = {
  hidden: false,
  petals: false,
  visitors: true,
  accent: '',
  livingSky: false,
  path: '',
  lanterns: false,
  border: '',
  ornament: '',
  stars: false,
  aurora: false,
  nebula: false,
  goldSigns: false,
  ancient: false,
  seen: -1,
  catalogue: 0,
};

export type Choice = { value: string; label: string; tier: number };
export type Perk =
  | { tier: number; title: string; text: string; kind: 'none' }
  | { tier: number; title: string; text: string; kind: 'toggle'; pref: keyof GardenPrefs }
  | { tier: number; title: string; text: string; kind: 'choice'; pref: keyof GardenPrefs; choices: Choice[] };

export const ACCENTS: Choice[] = [
  { value: 'rose', label: 'Rose', tier: 3 },
  { value: 'lavender', label: 'Lavender', tier: 3 },
  { value: 'moss', label: 'Moss', tier: 3 },
  { value: 'lagoon', label: 'Lagoon', tier: 10 },
  { value: 'midnight', label: 'Midnight Bloom', tier: 10 },
  { value: 'sakura', label: 'Sakura', tier: 10 },
  { value: 'gold', label: 'Worldbloom gold', tier: 14 },
];

export const PERKS: Perk[] = [
  { tier: 0, kind: 'none', title: 'The garden', text: 'A plant for every entry, free forever. Tap one to open its entry.' },
  { tier: 1, kind: 'toggle', pref: 'petals', title: 'Petal celebrations', text: 'Celebrations throw petals instead of confetti.' },
  { tier: 2, kind: 'toggle', pref: 'visitors', title: 'Visitors', text: 'Butterflies, a bee and a ladybird visit the garden.' },
  { tier: 3, kind: 'choice', pref: 'accent', choices: ACCENTS, title: 'Garden colours', text: 'Give the whole app a garden colour.' },
  { tier: 4, kind: 'toggle', pref: 'livingSky', title: 'Living sky', text: 'The garden’s sky follows your clock: dawn, day, golden hour and night.' },
  {
    tier: 5,
    kind: 'choice',
    pref: 'path',
    choices: [
      { value: 'gravel', label: 'Gravel', tier: 5 },
      { value: 'brick', label: 'Brick', tier: 5 },
      { value: 'boardwalk', label: 'Boardwalk', tier: 11 },
      { value: 'stardust', label: 'Stardust', tier: 11 },
    ],
    title: 'Garden paths',
    text: 'A path between the beds.',
  },
  { tier: 6, kind: 'toggle', pref: 'lanterns', title: 'Lanterns', text: 'A lantern on every bed’s sign.' },
  {
    tier: 7,
    kind: 'choice',
    pref: 'border',
    choices: [
      { value: 'picket', label: 'Picket fence', tier: 7 },
      { value: 'hedge', label: 'Low hedge', tier: 7 },
      { value: 'tulips', label: 'Tulip border', tier: 7 },
    ],
    title: 'Bed borders',
    text: 'A border along the front of each month’s bed.',
  },
  {
    tier: 8,
    kind: 'choice',
    pref: 'ornament',
    choices: [
      { value: 'sundial', label: 'Sundial', tier: 8 },
      { value: 'birdbath', label: 'Birdbath', tier: 8 },
      { value: 'globe', label: 'Gazing ball', tier: 8 },
    ],
    title: 'Gate ornament',
    text: 'Something to greet you at the gate.',
  },
  { tier: 9, kind: 'toggle', pref: 'stars', title: 'Starry night', text: 'Stars and a moon over the garden.' },
  { tier: 10, kind: 'toggle', pref: 'aurora', title: 'Aurora sky', text: 'Aurora curtains across the garden’s sky, and three more garden colours.' },
  { tier: 11, kind: 'toggle', pref: 'nebula', title: 'Nebula sky', text: 'A nebula in the garden’s sky, and two more paths.' },
  { tier: 12, kind: 'toggle', pref: 'goldSigns', title: 'Gold signs', text: 'Gold signs on every bed.' },
  { tier: 13, kind: 'toggle', pref: 'ancient', title: 'Ancient ground', text: 'Old amber soil under every bed.' },
  { tier: 14, kind: 'none', title: 'Keeper of the Worldbloom', text: 'The title, and a gold colour for the app (in Garden colours).' },
];

/**
 * Features garden updates added to tiers (D98): each tier's perk stays as it was, and these come
 * with it. `catalogue` is the update that added one; a device that had already reached its tier
 * hears about it once, in a "Garden update" card.
 */
export interface Feature {
  tier: number;
  catalogue: number;
  title: string;
  text: string;
  /** Where it is: a garden page. */
  view?: GardenTab;
}

export const FEATURES: Feature[] = [
  { tier: 5, catalogue: 1, view: 'almanac', title: 'Garden history', text: 'The Almanac, your garden month by month, and the Time-lapse: watch it grow from its first plant.' },
  { tier: 6, catalogue: 1, title: 'Postcards', text: 'Save a picture of a plant or a whole bed. Moods, titles and dates stay off it unless you add them.' },
];
/** The newest garden update. */
export const CATALOGUE = Math.max(...FEATURES.map((f) => f.catalogue));

const KEY = 'logbook.garden';
const listeners = new Set<() => void>();
let current: GardenPrefs = load();

/** The saved choices, or `fallback` when there are none (or storage can't be read). */
function load(fallback: GardenPrefs = DEFAULTS): GardenPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return fallback;
    const prefs = { ...DEFAULTS, ...(JSON.parse(raw) as Partial<GardenPrefs>) };
    if (!Number.isFinite(prefs.seen)) prefs.seen = -1;
    if (!Number.isFinite(prefs.catalogue)) prefs.catalogue = 0;
    return prefs;
  } catch {
    return fallback;
  }
}

export function gardenPrefs(): GardenPrefs {
  return current;
}

export function setGardenPrefs(patch: Partial<GardenPrefs>): void {
  // Read again first, so a choice made meanwhile in another window isn't written over.
  current = { ...load(current), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // Private browsing: the choice lasts until the page closes.
  }
  for (const l of listeners) l();
}

if (typeof window !== 'undefined')
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY && e.key !== null) return;
    current = load();
    for (const l of listeners) l();
  });

/**
 * The tiers whose perks are open: the garden's tier, or the highest this device has seen if
 * that's higher, so a perk never locks again (if Growth falls when old entries are deleted).
 */
export function unlockedTier(rankTier: number, prefs: GardenPrefs): number {
  return Math.max(rankTier, Math.floor(prefs.seen / 1000));
}

export function useGardenPrefs(): GardenPrefs {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => current,
  );
}
