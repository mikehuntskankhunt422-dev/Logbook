import { describe, expect, it } from 'vitest';
import { cardFeatures, CATALOGUE, gardenPrefs, noteUpdate, rankUpNews, type GardenPrefs } from './garden-prefs.ts';

/** A device's choices: what it has seen (tier × 1000) and the updates it has run. */
const device = (patch: Partial<GardenPrefs>): GardenPrefs => ({ ...gardenPrefs(), seen: -1, catalogue: 0, updateFor: 0, updateTier: -1, ...patch });
/** The device once it has run this update. */
const updated = (prefs: GardenPrefs): GardenPrefs => ({ ...prefs, ...noteUpdate(prefs) });
const titles = (prefs: GardenPrefs) => cardFeatures(prefs).map((f) => f.title);

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
  });

  it('notes an update once, and a closed card stays closed', () => {
    const prefs = updated(device({ seen: 6000 }));
    expect(noteUpdate(prefs)).toBeNull();
    expect(titles({ ...prefs, catalogue: CATALOGUE })).toEqual([]);
  });
});
