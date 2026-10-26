import { describe, expect, it } from 'vitest';
import { cardFeatures, CATALOGUE, clampText, FEATURES, fitText, gardenPrefs, listed, noteUpdate, rankUpNews, type Feature, type GardenPrefs } from './garden-prefs.ts';

/** A device's choices: what it has seen (tier × 1000) and the updates it has run. */
const device = (patch: Partial<GardenPrefs>): GardenPrefs => ({ ...gardenPrefs(), seen: -1, catalogue: 0, noted: {}, ...patch });
/** The device once it has run the version with these features. */
const updated = (prefs: GardenPrefs, features: Feature[] = FEATURES): GardenPrefs => ({ ...prefs, ...noteUpdate(prefs, features) });
const titles = (prefs: GardenPrefs, features: Feature[] = FEATURES) => cardFeatures(prefs, features).map((f) => f.title);
/** A later garden update, as a test: a feature at Rare. */
const LATER: Feature[] = [...FEATURES, { tier: 2, catalogue: CATALOGUE + 1, title: 'Later', text: '' }];

describe('garden updates (D98)', () => {
  it('tells a device in a card of features at the tiers it had reached when the update came, lowest tier first', () => {
    expect(titles(updated(device({ seen: 7000 })))).toEqual(['Landmarks', 'Garden sounds', 'Garden history', 'Postcards', 'Seasons and weather']);
    expect(titles(updated(device({ seen: 5001 })))).toEqual(['Landmarks', 'Garden sounds', 'Garden history']);
  });

  it('tells a 0.6.1 device only what later updates add, once its 0.6.1 card was closed', () => {
    // Closed the 0.6.1 card at Radiant; Prismatic since.
    const prefs = updated({ ...device({ seen: 6000, catalogue: 1, noted: { 1: 6 } }), seen: 7000 });
    expect(prefs.noted).toEqual({ 1: 6, [CATALOGUE]: 7 });
    expect(titles(prefs)).toEqual(['Landmarks', 'Garden sounds', 'Seasons and weather']);
    // Left it open: the 0.6.1 features are still told as before, with later ones.
    expect(titles(updated(device({ seen: 5000, noted: { 1: 5 } })))).toEqual(['Landmarks', 'Garden sounds', 'Garden history']);
  });

  it('tells nothing in a card to a new garden, and one below the other features’ tiers only of the free Landmarks', () => {
    const fresh = updated(device({ seen: -1 }));
    expect([titles(fresh), fresh.catalogue]).toEqual([[], CATALOGUE]);
    for (const seen of [0, 3000]) expect(titles(updated(device({ seen })))).toEqual(['Landmarks']);
  });

  it('leaves tiers reached after the update to the rank-up, which names every feature it passes', () => {
    // At Mythic when the update came, Radiant since: the card still tells only of tiers up to Mythic.
    expect(titles({ ...updated(device({ seen: 5000 })), seen: 6000 })).toEqual(['Landmarks', 'Garden sounds', 'Garden history']);
    expect(rankUpNews(5, 6)).toEqual(['Lanterns', 'Postcards']);
    // From Epic straight to Radiant (a hidden garden, a restore): every feature passed is named.
    expect(rankUpNews(3, 6)).toEqual(['Lanterns', 'Garden sounds', 'Garden history', 'Postcards']);
    expect(rankUpNews(6, 7)).toEqual(['Bed borders', 'Seasons and weather']);
    expect(rankUpNews(0, 1)).toEqual(['Petal celebrations']);
    // Straight to a ring past Worldbloom: its perk and every feature passed; a ring alone adds nothing.
    expect(rankUpNews(3, 14)).toEqual(['Keeper of the Worldbloom', 'Garden sounds', 'Garden history', 'Postcards', 'Seasons and weather', 'A garden pet', 'Star map', 'Biomes', 'A second pet', 'Golden landmarks', 'Ancient companions', 'The World Tree']);
    expect(rankUpNews(7, 8)).toEqual(['Gate ornament', 'A garden pet']);
    expect(rankUpNews(14, 14)).toEqual([]);
    expect([listed([]), listed(['A']), listed(['A', 'B']), listed(['A', 'B', 'C'])]).toEqual(['', 'A', 'A and B', 'A, B and C']);
  });

  it('keeps each update’s tier, so a later update never repeats what a rank-up told', () => {
    // At Mythic for this update, the card left open; Radiant since (its toast told of Postcards).
    const first = { ...updated(device({ seen: 5000 })), seen: 6000 };
    const second = updated(first, LATER);
    expect(second.noted).toEqual({ [CATALOGUE]: 5, [CATALOGUE + 1]: 6 });
    expect(titles(second, LATER)).toEqual(['Landmarks', 'Later', 'Garden sounds', 'Garden history']);
    // A device that skipped this update hears of its features at the tier it had for the next.
    expect(titles(updated(device({ seen: 6000 }), LATER), LATER)).toEqual(['Landmarks', 'Later', 'Garden sounds', 'Garden history', 'Postcards']);
  });

  it('tells a 0.7.0 device at Primordial only what the companions and wonders add', () => {
    const prefs = updated({ ...device({ seen: 13000, catalogue: 2, noted: { 1: 13, 2: 13 } }) });
    expect(titles(prefs)).toEqual(['Landmarks', 'A garden pet', 'Star map', 'Biomes', 'A second pet', 'Golden landmarks', 'Ancient companions']);
  });

  it('tells a 0.8 device at Worldbloom of every wonder (D103)', () => {
    const prefs = updated({ ...device({ seen: 14000, catalogue: 3, noted: { 1: 14, 2: 14, 3: 14 } }) });
    expect(titles(prefs)).toEqual(['Landmarks', 'Biomes', 'Golden landmarks', 'The World Tree']);
  });

  it('cuts a pet’s name at 20 characters as people count them, never inside an emoji', () => {
    expect(clampText('abcdefghijklmnopqr🐱🐱', 20)).toBe('abcdefghijklmnopqr🐱🐱');
    expect(clampText('abcdefghijklmnopqrs🐱🐱', 20)).toBe('abcdefghijklmnopqrs🐱');
    expect(clampText('👨‍👩‍👧‍👦'.repeat(21), 20)).toBe('👨‍👩‍👧‍👦'.repeat(20));
    expect(clampText('Biscuit', 20)).toBe('Biscuit');
  });

  it('keeps a full name as it was when more is typed mid-way, and cuts a paste to what fits', () => {
    // 'X' typed after 'e' in a full name: nothing changes, the caret stays.
    expect(fitText('abcdeXfghijklmnopqrst', 6, 20)).toEqual({ text: 'abcdefghijklmnopqrst', caret: 5 });
    // '12' pasted after 'c' in a 19-character name: only '1' fits, and the end is kept.
    expect(fitText('abc12defghijklmnopqrs', 5, 20)).toEqual({ text: 'abc1defghijklmnopqrs', caret: 4 });
    // Within the limit: as typed.
    expect(fitText('Biscuit', 7, 20)).toEqual({ text: 'Biscuit', caret: 7 });
    // An emoji is one character, and never cut in two.
    expect(fitText('abcdefghijklmnopqrs🐱🐱', 21, 20).text).toBe('abcdefghijklmnopqrs🐱');
  });

  it('notes an update once, and a closed card stays closed', () => {
    const prefs = updated(device({ seen: 6000 }));
    expect(noteUpdate(prefs)).toBeNull();
    expect(titles({ ...prefs, catalogue: CATALOGUE })).toEqual([]);
  });
});
