import { useSyncExternalStore } from 'react';
import type { Hemisphere, WeatherChoice } from '@logbook/core';
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
  /** Seasons and weather (D99): each bed in its month's season, the weather, and the hemisphere ('' from the time zone). */
  seasons: boolean;
  weather: WeatherChoice;
  hemisphere: '' | Hemisphere;
  /** Garden sounds' volume, 0 to 1. They never play by themselves, so whether they play isn't kept. */
  soundVolume: number;
  /** Companions (D100): up to two pets and their names, and the star map. */
  pet: '' | PetKind;
  petName: string;
  pet2: '' | PetKind;
  pet2Name: string;
  starMap: boolean;
  /** The highest rank seen on this device (tier × 1000 + ring), for "your garden reached…". */
  seen: number;
  /** The garden update last announced on this device (FEATURES' catalogue numbers). */
  catalogue: number;
  /** For each garden update this device has run, the tier it had reached when it first ran it. */
  noted: Record<string, number>;
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
  seasons: false,
  weather: '',
  hemisphere: '',
  soundVolume: 0.5,
  pet: '',
  petName: '',
  pet2: '',
  pet2Name: '',
  starMap: false,
  seen: -1,
  catalogue: 0,
  noted: {},
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
  /** Its choices in the shed. */
  controls?: FeatureControl[];
}

export type FeatureControl =
  | { kind: 'toggle'; pref: keyof GardenPrefs; label: string }
  | { kind: 'choice'; pref: keyof GardenPrefs; label: string; none: string; choices: { value: string; label: string; tier?: number }[] }
  | { kind: 'text'; pref: keyof GardenPrefs; label: string; max: number; hint: string };

/** The garden's pets (D100), each with the tier that brings it. */
export type PetKind = 'cat' | 'fox' | 'hedgehog' | 'tortoise' | 'dragon' | 'dinosaur';
export const PETS: { value: PetKind; label: string; emoji: string; tier: number }[] = [
  { value: 'cat', label: 'Cat', emoji: '🐈', tier: 8 },
  { value: 'fox', label: 'Fox', emoji: '🦊', tier: 8 },
  { value: 'hedgehog', label: 'Hedgehog', emoji: '🦔', tier: 8 },
  { value: 'tortoise', label: 'Tortoise', emoji: '🐢', tier: 8 },
  { value: 'dragon', label: 'Baby dragon', emoji: '🐉', tier: 13 },
  { value: 'dinosaur', label: 'Little dinosaur', emoji: '🦕', tier: 13 },
];
/** A pet's name: at most this many characters. */
export const PET_NAME_MAX = 20;
const NAME_HINT = 'Kept on this device only, outside your journal and its passcode.';

export const FEATURES: Feature[] = [
  { tier: 5, catalogue: 1, view: 'almanac', title: 'Garden history', text: 'The Almanac, your garden month by month, and the Time-lapse: watch it grow from its first plant.' },
  { tier: 6, catalogue: 1, title: 'Postcards', text: 'Save a picture of a plant or a whole bed. Moods, titles and dates stay off it unless you add them.' },
  {
    tier: 4,
    catalogue: 2,
    title: 'Garden sounds',
    text: 'Birdsong by day, crickets at night, a breeze, and rain when it rains: press 🔈 Garden sounds above the garden. Never on by itself.',
  },
  {
    tier: 7,
    catalogue: 2,
    title: 'Seasons and weather',
    text: 'Each month’s bed in its season, with frost, blossom or fallen leaves, and rain, snow or petals in the air.',
    controls: [
      { kind: 'toggle', pref: 'seasons', label: 'Seasons' },
      {
        kind: 'choice',
        pref: 'weather',
        label: 'Weather',
        none: 'Off',
        choices: [
          { value: 'auto', label: 'Auto' },
          { value: 'rain', label: 'Rain' },
          { value: 'snow', label: 'Snow' },
          { value: 'petals', label: 'Petals' },
        ],
      },
      {
        kind: 'choice',
        pref: 'hemisphere',
        label: 'Hemisphere',
        none: 'From my time zone',
        choices: [
          { value: 'north', label: 'North' },
          { value: 'south', label: 'South' },
        ],
      },
    ],
  },
  {
    tier: 8,
    catalogue: 3,
    title: 'A garden pet',
    text: 'A cat, fox, hedgehog or tortoise naps beside your newest plant. Tap it to see it stretch.',
    controls: [
      { kind: 'choice', pref: 'pet', label: 'Pet', none: 'None', choices: PETS },
      { kind: 'text', pref: 'petName', label: 'Its name', max: PET_NAME_MAX, hint: NAME_HINT },
    ],
  },
  {
    tier: 9,
    catalogue: 3,
    title: 'Star map',
    text: 'Each year’s twelve longest entries become a constellation in the night sky above its months, named after its most-used tag. Each star opens its entry.',
    controls: [{ kind: 'toggle', pref: 'starMap', label: 'Star map' }],
  },
  {
    tier: 12,
    catalogue: 3,
    title: 'A second pet',
    text: 'Room for another companion.',
    controls: [
      { kind: 'choice', pref: 'pet2', label: 'Second pet', none: 'None', choices: PETS },
      { kind: 'text', pref: 'pet2Name', label: 'Its name', max: PET_NAME_MAX, hint: NAME_HINT },
    ],
  },
  { tier: 13, catalogue: 3, title: 'Ancient companions', text: 'A baby dragon and a little dinosaur join the pets.' },
];
/** The newest garden update. */
export const CATALOGUE = Math.max(...FEATURES.map((f) => f.catalogue));

const newest = (features: Feature[]) => Math.max(...features.map((f) => f.catalogue));

/** The tier this device had when it first ran a version with this feature, if it has run one. */
function tierWhenAdded(prefs: GardenPrefs, f: Feature): number | undefined {
  const runs = Object.keys(prefs.noted)
    .map(Number)
    .filter((c) => c >= f.catalogue)
    .sort((a, b) => a - b);
  return runs.length ? prefs.noted[runs[0]!] : undefined;
}

/**
 * What to remember the first time this device runs a new garden update: the tier it had reached
 * then. Features at those tiers are told in a "Garden update" card; features at tiers reached
 * later are told by the rank-up, so with none due, the update counts as told. A garden never seen
 * here has nothing to be told: all of it is new. Null once noted.
 */
export function noteUpdate(prefs: GardenPrefs, features: Feature[] = FEATURES): Partial<GardenPrefs> | null {
  const latest = newest(features);
  if (String(latest) in prefs.noted) return null;
  const noted = { ...prefs.noted, [latest]: prefs.seen < 0 ? -1 : Math.floor(prefs.seen / 1000) };
  return { noted, ...(cardFeatures({ ...prefs, noted }, features).length ? {} : { catalogue: latest }) };
}

/** The features a "Garden update" card tells of: new since the last card, at tiers reached before their update came. */
export function cardFeatures(prefs: GardenPrefs, features: Feature[] = FEATURES): Feature[] {
  return byTier(features).filter((f) => {
    const tier = tierWhenAdded(prefs, f);
    return f.catalogue > prefs.catalogue && tier !== undefined && f.tier <= tier;
  });
}

/** A rank-up's news from one tier to another: the new tier's perk, and the features of every tier passed. A ring adds none. */
export function rankUpNews(from: number, to: number, features: Feature[] = FEATURES): string[] {
  return [...PERKS.filter((p) => p.tier === to && to > from), ...byTier(features).filter((f) => f.tier > from && f.tier <= to)].map((p) => p.title);
}

/** Features in tier order, lowest first; a tier's own in the order they came. */
const byTier = (features: Feature[]) => [...features].sort((a, b) => a.tier - b.tier);

/** "A", "A and B", "A, B and C". */
export function listed(items: string[]): string {
  return items.length < 2 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

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
    if (!prefs.noted || typeof prefs.noted !== 'object') prefs.noted = {};
    if (!(prefs.soundVolume >= 0 && prefs.soundVolume <= 1)) prefs.soundVolume = DEFAULTS.soundVolume;
    for (const key of ['petName', 'pet2Name'] as const) if (typeof prefs[key] !== 'string') prefs[key] = '';
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
