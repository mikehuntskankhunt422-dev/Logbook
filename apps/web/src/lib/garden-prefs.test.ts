import { describe, expect, it } from 'vitest';
import { cardFeatures, CATALOGUE, FEATURES, gardenPrefs, noteUpdate, rankUpNews, type Feature, type GardenPrefs } from './garden-prefs.ts';

/** A device's choices: what it has seen (tier × 1000) and the updates it has run. */
const device = (patch: Partial<GardenPrefs>): GardenPrefs => ({ ...gardenPrefs(), seen: -1, catalogue: 0, noted: {}, ...patch });
/** The device once it has run the version with these features. */
const updated = (prefs: GardenPrefs, features: Feature[] = FEATURES): GardenPrefs => ({ ...prefs, ...noteUpdate(prefs, features) });
const titles = (prefs: GardenPrefs, features: Feature[] = FEATURES) => cardFeatures(prefs, features).map((f) => f.title);
/** A later garden update, as a test: a feature at Rare. */
const LATER: Feature[] = [...FEATURES, { tier: 2, catalogue: 2, title: 'Weather', text: '' }];

describe('garden updates (D98)', () => {
  it('tells a device in a card of features at the tiers it had reached when the update came', () => {
    expect(titles(updated(device({ seen: 6000 })))).toEqual(['Garden history', 'Postcards']);
    expect(titles(updated(device({ seen: 5001 })))).toEqual(['Garden history']);
  });

  it('tells nothing in a card to a new garden, or to one below the new features’ tiers', () => {
    for (const seen of [-1, 0, 3000]) {
      const prefs = updated(device({ seen }));
      expect(titles(prefs)).toEqual([]);
      expect(prefs.catalogue).toBe(CATALOGUE);
    }
  });

  it('leaves tiers reached after the update to the rank-up, which names every feature it passes', () => {
    // At Mythic when the update came, Radiant since: the card still tells only of Garden history.
    expect(titles({ ...updated(device({ seen: 5000 })), seen: 6000 })).toEqual(['Garden history']);
    expect(rankUpNews(5, 6)).toEqual(['Lanterns', 'Postcards']);
    // From Epic straight to Radiant (a hidden garden, a restore): both features are named.
    expect(rankUpNews(3, 6)).toEqual(['Lanterns', 'Garden history', 'Postcards']);
    expect(rankUpNews(0, 1)).toEqual(['Petal celebrations']);
    // Straight to a ring past Worldbloom: its perk and every feature passed; a ring alone adds nothing.
    expect(rankUpNews(3, 14)).toEqual(['Keeper of the Worldbloom', 'Garden history', 'Postcards']);
    expect(rankUpNews(14, 14)).toEqual([]);
  });

  it('keeps each update’s tier, so a later update never repeats what a rank-up told', () => {
    // At Mythic for update 1, the card left open; Radiant since (its toast told of Postcards).
    const first = { ...updated(device({ seen: 5000 })), seen: 6000 };
    const second = updated(first, LATER);
    expect(second.noted).toEqual({ 1: 5, 2: 6 });
    expect(titles(second, LATER)).toEqual(['Garden history', 'Weather']);
    // A device that skipped update 1 hears of its features at the tier it had for update 2.
    expect(titles(updated(device({ seen: 6000 }), LATER), LATER)).toEqual(['Garden history', 'Postcards', 'Weather']);
  });

  it('notes an update once, and a closed card stays closed', () => {
    const prefs = updated(device({ seen: 6000 }));
    expect(noteUpdate(prefs)).toBeNull();
    expect(titles({ ...prefs, catalogue: CATALOGUE })).toEqual([]);
  });
});
