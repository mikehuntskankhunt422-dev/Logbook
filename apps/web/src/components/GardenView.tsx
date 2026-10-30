import { Fragment, memo, useCallback, useMemo, useRef, useState } from 'react';
import { hemisphereOf, rankName, seasonOf, SIZE_STAGES, starMap, TIERS, weatherOn, type Garden, type HolidayId, type Plant as PlantData, type Season } from '@logbook/core';
import { href, type GardenTab } from '../app/router.ts';
import { BIOMES, cardFeatures, CATALOGUE, FEATURES, fitText, listed, PERKS, PETS, setGardenPrefs, unlockedTier, useGardenPrefs, type GardenPrefs, type PetKind } from '../lib/garden-prefs.ts';
import { Pet, PET_TIER, SECOND_PET_TIER, STAR_TIER, StarSky } from './garden/Companions.tsx';
import { formatLongDate } from './common.tsx';
import { Almanac, HISTORY_TIER } from './garden/Almanac.tsx';
import { Herbarium } from './garden/Herbarium.tsx';
import { Plant, TIER_COLOURS } from './garden/Plant.tsx';
import { POSTCARD_TIER, PostcardDialog } from './garden/Postcard.tsx';
import { SEASONS_TIER, SOUNDS_TIER, SoundControls, useGardenNow, WeatherLayer } from './garden/Weather.tsx';
import { BIOME_TIER, GOLD_LANDMARK_TIER, Landmarks, TREE_TIER, WorldTree } from './garden/Wonders.tsx';
import { useForcedColors, useReducedMotion } from '../lib/motion.ts';
import { EGG_COUNT, useEggs, useHoliday, useToday } from '../lib/holidays.ts';
import { celebrate } from '../lib/motion.ts';
import { useToast } from '../app/toasts.tsx';
import { EasterEgg, HolidayDecor } from './garden/Holidays.tsx';

/** The garden (D97): a plant for every entry, in a bed for each month, newest first. */

const ORNAMENTS: Record<string, string> = { sundial: '🕰️', birdbath: '⛲', globe: '🔮' };

function skyNow(): 'dawn' | 'day' | 'golden' | 'night' {
  const h = new Date().getHours();
  return h >= 5 && h < 8 ? 'dawn' : h >= 8 && h < 17 ? 'day' : h >= 17 && h < 20 ? 'golden' : 'night';
}

/** A name field's text kept to its limit, the caret where it was (D100). */
function fitName(input: HTMLInputElement, pref: keyof GardenPrefs, max: number) {
  const { text, caret } = fitText(input.value, input.selectionStart ?? input.value.length, max);
  setGardenPrefs({ [pref]: text });
  if (text !== input.value) requestAnimationFrame(() => input.setSelectionRange(caret, caret));
}

/** Months shown at first, and added by "Show earlier months": a long journal's garden opens fast. */
const BEDS_AT_ONCE = 12;

const TABS: { view?: GardenTab; label: string }[] = [{ label: 'Garden' }, { view: 'herbarium', label: 'Herbarium' }, { view: 'almanac', label: 'Almanac' }];

export function GardenView({ garden, view }: { garden: Garden | null; view?: GardenTab }) {
  const prefs = useGardenPrefs();
  const [shown, setShown] = useState(BEDS_AT_ONCE);
  const [postcard, setPostcard] = useState<string | null>(null);
  const scene = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const forced = useForcedColors();
  const now = useGardenNow();
  const holiday = useHoliday();
  const toast = useToast();
  const eggs = useEggs(useToday().slice(0, 4));
  const findEgg = eggs.find;
  // Easter (D109): eggs among the newest bed's plants; every one found is a celebration.
  const onFindEgg = useCallback(
    (egg: number) => {
      if (eggs.found.includes(egg)) return;
      const n = findEgg(egg);
      if (n === EGG_COUNT) {
        celebrate('streak');
        toast('You found every egg. Happy Easter!');
      } else toast(`You found an egg: ${n} of ${EGG_COUNT}.`);
    },
    [eggs.found, findEgg, toast],
  );
  const beds = useMemo(() => {
    const byMonth = new Map<string, PlantData[]>();
    for (const p of garden?.plants ?? []) {
      const m = p.entry.date.slice(0, 7);
      byMonth.set(m, [...(byMonth.get(m) ?? []), p]);
    }
    return [...byMonth.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([month, plants]) => ({ month, plants: plants.sort((a, b) => a.entry.date.localeCompare(b.entry.date)) }));
  }, [garden]);
  // Each year's constellation (D100), worked out once per garden.
  const skies = useMemo(() => new Map([...new Set(beds.map((b) => b.month.slice(0, 4)))].map((y) => [y, starMap(garden?.plants ?? [], y)])), [beds, garden]);

  if (prefs.hidden)
    return (
      <div className="garden-page">
        <h1>Garden</h1>
        <p>The garden is turned off on this device.</p>
        <button type="button" className="btn" onClick={() => setGardenPrefs({ hidden: false })}>
          🌱 Show the garden
        </button>
      </div>
    );
  if (!garden) return <p className="muted">Opening the garden…</p>;
  const { rank } = garden;
  const top = rank.tier === TIERS.length - 1;
  // Perks stay open once reached, even if Growth later falls (old entries deleted for good).
  const open = unlockedTier(rank.tier, prefs);
  const has = (tier: number) => open >= tier;
  const on = (tier: number, pref: keyof GardenPrefs) => has(tier) && Boolean(prefs[pref]);
  const sky = on(4, 'livingSky') ? skyNow() : 'day';
  // Seasons and weather (D99), from the date alone, in this device's hemisphere.
  const guessed = hemisphereOf(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const hemisphere = prefs.hemisphere || guessed;
  const seasons = has(SEASONS_TIER) && prefs.seasons;
  const { weather, rainbow } = weatherOn(has(SEASONS_TIER) ? prefs.weather : '', now.day, hemisphere);
  const night = sky === 'night' || (sky === 'day' && now.dark);
  // Companions (D100): the pets chosen, each only once its tier is reached.
  const allowed = (kind: '' | PetKind, tier: number): '' | PetKind => (has(tier) && kind && has(PETS.find((p) => p.value === kind)?.tier ?? Infinity) ? kind : '');
  const pets = [
    { kind: allowed(prefs.pet, PET_TIER), name: prefs.petName },
    { kind: allowed(prefs.pet2, SECOND_PET_TIER), name: prefs.pet2Name },
  ].flatMap((p): { kind: PetKind; name: string }[] => (p.kind ? [{ kind: p.kind, name: p.name }] : []));
  const stars = has(STAR_TIER) && prefs.starMap;
  // Wonders (D103).
  const biome = has(BIOME_TIER) ? BIOMES.find((b) => b.value === prefs.biome) : undefined;
  const progress = Math.min(1, (rank.growth - rank.from) / (rank.next - rank.from));
  const nextName = top ? `${TIERS[rank.tier]!.name} ★${rank.ring + 1}` : TIERS[rank.tier + 1]!.name;
  // Features a garden update added to tiers this device had already reached: said once.
  const fresh = cardFeatures(prefs);
  // Not on the page it would open: a link to where you are would only take focus away.
  const tryIt = fresh.find((f) => f.view && f.view !== view);
  const postcardBed = postcard ? beds.find((b) => b.month === postcard) : undefined;

  return (
    <div className="garden-page">
      <h1>Garden</h1>
      <section className="garden-rank panel" aria-label="Your garden">
        <div className="garden-rank-emoji" aria-hidden="true">
          {TIERS[rank.tier]!.emoji}
        </div>
        <div className="garden-rank-text">
          <p className="garden-rank-name">
            Your garden is <strong style={{ color: `var(--tier-${rank.tier})` }}>{rankName(rank)}</strong>
            {top && <span className="muted"> · Keeper of the Worldbloom</span>}
          </p>
          <div className="meter" role="progressbar" aria-label={`Growth to ${nextName}`} aria-valuemin={rank.from} aria-valuemax={rank.next} aria-valuenow={rank.growth}>
            <span style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
          <p className="hint">
            {rank.growth.toLocaleString()} Growth · {(rank.next - rank.growth).toLocaleString()} more to {nextName}. New plants bloom {TIERS[rank.tier]!.name}; long entries bloom higher.
          </p>
        </div>
      </section>

      {fresh.length > 0 && (
        <section className="panel garden-card" aria-labelledby="garden-update-h">
          <h2 id="garden-update-h">🎁 Garden update</h2>
          <p>Your {TIERS[open]!.name} garden now has {listed(fresh.map((f) => f.title))}.</p>
          <ul>
            {fresh.map((f) => (
              <li key={f.title}>
                <strong>{f.title}:</strong> {f.text}
              </li>
            ))}
          </ul>
          <div className="row">
            {tryIt && (
              <a className="btn btn-primary" href={href({ name: 'garden', view: tryIt.view })} onClick={() => setGardenPrefs({ catalogue: CATALOGUE })}>
                Try it
              </a>
            )}
            <button
              type="button"
              className="btn"
              onClick={() => {
                setGardenPrefs({ catalogue: CATALOGUE });
                // The card goes: keep keyboard focus on the page, on the garden's current tab.
                document.querySelector<HTMLElement>('.garden-tabs [aria-current="page"]')?.focus();
              }}
            >
              Close
            </button>
          </div>
        </section>
      )}

      <nav className="segmented garden-tabs" aria-label="Garden pages">
        {TABS.map((t) => (
          <a key={t.label} href={href({ name: 'garden', view: t.view })} aria-current={view === t.view ? 'page' : undefined}>
            {t.label}
          </a>
        ))}
      </nav>

      {view === 'herbarium' && <Herbarium plants={garden.plants} />}
      {view === 'almanac' && <Almanac plants={garden.plants} unlocked={has(HISTORY_TIER)} />}
      {!view && (
        <>
          <button type="button" className="btn garden-skip" onClick={() => document.getElementById('shed-h')?.focus()}>
            Skip to the garden shed
          </button>
          {has(SOUNDS_TIER) && <SoundControls night={night} rain={weather === 'rain'} volume={prefs.soundVolume} />}
          <div
            ref={scene}
            className="garden-scene"
            data-sky={sky}
            data-seasons={seasons || undefined}
            data-weather={weather === 'clear' ? undefined : weather}
            data-stars={on(9, 'stars') || undefined}
            data-aurora={on(10, 'aurora') || undefined}
            data-nebula={on(11, 'nebula') || undefined}
            data-path={(has(5) && prefs.path) || undefined}
            data-border={(has(7) && prefs.border) || undefined}
            data-gold={on(12, 'goldSigns') || undefined}
            data-ancient={on(13, 'ancient') || undefined}
            data-biome={biome?.value}
          >
            {rainbow && <div className="garden-rainbow" aria-hidden="true" />}
            {!reduced && !forced && <WeatherLayer weather={weather} night={night} scene={scene} />}
            <div className="garden-gate" aria-hidden="true">
              <span>🚪</span>
              {has(8) && prefs.ornament && <span>{ORNAMENTS[prefs.ornament]}</span>}
              {biome && <span>{biome.scenery}</span>}
            </div>
            {on(2, 'visitors') && (
              <div className="garden-visitors" aria-hidden="true">
                {['🦋', '🐝', '🦋', '🐞', '🦋', '🦋'].map((v, i) => (
                  <span key={i} style={{ left: `${8 + i * 16}%`, animationDelay: `${i * 1.7}s` }}>
                    {v}
                  </span>
                ))}
              </div>
            )}
            {on(TREE_TIER, 'worldTree') && garden.plants.length > 0 && <WorldTree garden={garden} />}
            {prefs.landmarks && <Landmarks garden={garden} today={now.day} gold={on(GOLD_LANDMARK_TIER, 'goldLandmarks')} />}
            {beds.length === 0 ? (
              <p className="garden-empty">Write your first entry to plant your first seed. 🌱</p>
            ) : (
              beds.slice(0, shown).map((bed, i, list) => {
                const year = bed.month.slice(0, 4);
                const sky = stars && (i === 0 || list[i - 1]!.month.slice(0, 4) !== year) ? skies.get(year) : undefined;
                return (
                  <Fragment key={bed.month}>
                    {sky && <StarSky map={sky} />}
                    <Bed month={bed.month} plants={bed.plants} lantern={on(6, 'lanterns')} season={seasons ? seasonOf(bed.month, hemisphere) : undefined} pets={i === 0 ? pets : undefined} holiday={i === 0 ? holiday?.id : undefined} snow={i === 0 && holiday?.id === 'christmas' && hemisphere === 'north'} eggs={i === 0 && holiday?.id === 'easter' ? eggs.found : undefined} onFindEgg={i === 0 ? onFindEgg : undefined} onPostcard={has(POSTCARD_TIER) ? setPostcard : undefined} />
                  </Fragment>
                );
              })
            )}
          </div>
          {beds.length > shown && (
            <button type="button" className="btn garden-more" onClick={() => setShown((n) => n + BEDS_AT_ONCE)}>
              Show earlier months ({beds.length - shown} more)
            </button>
          )}

          <section className="panel garden-shed" aria-labelledby="shed-h">
            <h2 id="shed-h" tabIndex={-1}>
              Garden shed
            </h2>
            <p className="hint">Every tier unlocks a perk. Nothing changes until you choose it, and nothing is ever taken back.</p>
            <ul className="perk-list">
              {PERKS.map((perk) => {
                const unlocked = has(perk.tier);
                return (
                  <li key={perk.tier} className="perk" data-open={unlocked}>
                    <span className="perk-tier" style={{ background: TIER_COLOURS[perk.tier] }} aria-hidden="true">
                      {TIERS[perk.tier]!.emoji}
                    </span>
                    <div className="perk-body">
                      <strong>{perk.title}</strong> <span className="muted">· {TIERS[perk.tier]!.name}</span>
                      <p className="hint">{unlocked ? perk.text : `🔒 Reach ${TIERS[perk.tier]!.name} (${TIERS[perk.tier]!.at.toLocaleString()} Growth).`}</p>
                      {unlocked && perk.kind === 'toggle' && (
                        <label className="row">
                          <input type="checkbox" aria-label={perk.title} checked={Boolean(prefs[perk.pref])} onChange={(e) => setGardenPrefs({ [perk.pref]: e.target.checked })} /> On
                        </label>
                      )}
                      {unlocked && perk.kind === 'choice' && (
                        <div className="row" role="group" aria-label={perk.title}>
                          <button type="button" className="chip" aria-pressed={!prefs[perk.pref]} onClick={() => setGardenPrefs({ [perk.pref]: '' })}>
                            None
                          </button>
                          {perk.choices
                            .filter((c) => has(c.tier))
                            .map((c) => (
                              <button key={c.value} type="button" className="chip" aria-pressed={prefs[perk.pref] === c.value} onClick={() => setGardenPrefs({ [perk.pref]: c.value })}>
                                {c.label}
                              </button>
                            ))}
                        </div>
                      )}
                      {FEATURES.filter((f) => f.tier === perk.tier).map((f) => (
                        <div key={f.title}>
                          <p className="hint">
                            ➕ <strong>{f.title}</strong>
                            {unlocked ? `: ${f.text}` : ' comes with it.'}{' '}
                            {unlocked && f.view && <a href={href({ name: 'garden', view: f.view })}>Open it</a>}
                          </p>
                          {unlocked &&
                            f.controls?.map((c) =>
                              c.kind === 'toggle' ? (
                                <label key={c.pref} className="row feature-control">
                                  <input type="checkbox" checked={Boolean(prefs[c.pref])} onChange={(e) => setGardenPrefs({ [c.pref]: e.target.checked })} /> {c.label}
                                </label>
                              ) : c.kind === 'text' ? (
                                <div key={c.pref} className="field feature-control feature-text">
                                  <label htmlFor={`garden-${c.pref}`}>{c.label}</label>
                                  <input
                                    id={`garden-${c.pref}`}
                                    className="text-input"
                                    type="text"
                                    value={String(prefs[c.pref] ?? '')}
                                    aria-describedby={`garden-${c.pref}-hint`}
                                    onChange={(e) => {
                                      // While an input method composes, its text isn't final: it's fitted once done.
                                      if ((e.nativeEvent as InputEvent).isComposing) setGardenPrefs({ [c.pref]: e.target.value });
                                      else fitName(e.target, c.pref, c.max);
                                    }}
                                    onCompositionEnd={(e) => fitName(e.currentTarget, c.pref, c.max)}
                                  />
                                  <span id={`garden-${c.pref}-hint`} className="hint">
                                    {c.hint}
                                  </span>
                                </div>
                              ) : (
                                <div key={c.pref} className="row feature-control" role="group" aria-label={c.label}>
                                  <span className="muted">{c.label}:</span>
                                  {/* The time zone's guess is named, so a wrong one shows. */}
                                  {[{ value: '', label: c.pref === 'hemisphere' ? `${c.none} (${guessed === 'south' ? 'South' : 'North'})` : c.none }, ...c.choices.filter((o) => has(o.tier ?? 0))].map((o) => (
                                    <button key={o.value} type="button" className="chip" aria-pressed={(prefs[c.pref] || '') === o.value} onClick={() => setGardenPrefs({ [c.pref]: o.value })}>
                                      {o.label}
                                    </button>
                                  ))}
                                </div>
                              ),
                            )}
                        </div>
                      ))}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>

          <details className="panel garden-guide">
            <summary>Field guide</summary>
            <p>
              <strong>Size is the entry; rarity is your whole garden.</strong> Each plant grows as big as its entry is long. Its flower comes from the mood you picked. Its rarity is your garden’s tier when you wrote it, and entries of 600 or 1,200 words bloom 1 or 2 tiers higher (a ribbon on the stem). Growth comes from the days you write: 100 for turning up and more for your words, though copied or repeated text, links and number lists add nothing. Plants never wilt.
            </p>
            <ol className="tier-list">
              {TIERS.map((tier, i) => (
                <li key={tier.name}>
                  <span aria-hidden="true">{tier.emoji}</span> <strong style={{ color: `var(--tier-${i})` }}>{tier.name}</strong> <span className="muted">{tier.at.toLocaleString()} Growth</span>
                </li>
              ))}
            </ol>
            <p className="hint">After Worldbloom, a ★ ring every 100,000 Growth. Sizes: {SIZE_STAGES.map((s) => `${s.name} (${s.from}+ words)`).join(', ')}.</p>
          </details>
        </>
      )}
      {postcardBed && <PostcardDialog month={postcardBed.month} plants={postcardBed.plants} onClose={() => setPostcard(null)} />}
    </div>
  );
}

/** One month's bed. Memoised, so choosing a perk doesn't redraw every plant. */
const Bed = memo(function Bed({
  month,
  plants,
  lantern,
  season,
  pets,
  holiday,
  snow,
  eggs,
  onFindEgg,
  onPostcard,
}: {
  month: string;
  plants: PlantData[];
  lantern: boolean;
  season?: Season;
  pets?: { kind: PetKind; name: string }[];
  /** A holiday's decorations, in the newest bed while it lasts (D108, D109). */
  holiday?: HolidayId;
  /** Snow on the ground at Christmas, in the northern hemisphere only. */
  snow?: boolean;
  /** At Easter, the eggs found so far; the eggs are hidden among this bed's plants. */
  eggs?: readonly number[];
  onFindEgg?: (egg: number) => void;
  onPostcard?: (month: string) => void;
}) {
  const name = new Date(`${month}-15T12:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  // Each egg after one of the plants, spread along the bed.
  const eggsAfter = (i: number) => (eggs ? Array.from({ length: EGG_COUNT }, (_, k) => k).filter((k) => Math.min(plants.length - 1, Math.floor(((k + 1) * plants.length) / (EGG_COUNT + 1))) === i) : []);
  return (
    <section className="garden-bed" aria-labelledby={`bed-${month}`} data-season={season} data-snow={snow || undefined}>
      <div className="garden-bed-head">
        <h2 className="garden-sign" id={`bed-${month}`}>
          {lantern && <span aria-hidden="true">🏮 </span>}
          {name}
          <span className="garden-count"> · {plants.length === 1 ? '1 plant' : `${plants.length} plants`}</span>
        </h2>
        {eggs && (
          <span className="garden-eggs-count">
            🥚 {eggs.length} of {EGG_COUNT} eggs found
          </span>
        )}
        {onPostcard && (
          <button type="button" className="btn btn-small garden-postcard" aria-label={`Postcard of ${name}`} onClick={() => onPostcard(month)}>
            📮 Postcard
          </button>
        )}
      </div>
      <ul className="garden-ground">
        {plants.map((p, i) => (
          // The pets nap beside the newest plant (D100), in its place, so they wrap with it.
          <li key={p.entry.id} className={pets?.length && i === plants.length - 1 ? 'garden-newest' : undefined}>
            <a
              className="garden-plant"
              href={href({ name: 'entry', id: p.entry.id })}
              title={`${p.entry.title || 'Untitled'} · ${TIERS[p.tier]!.name} ${p.species}`}
              aria-label={`${p.entry.title || 'Untitled'}, ${formatLongDate(p.entry.date)}: ${TIERS[p.tier]!.name} ${p.species}, ${SIZE_STAGES[p.stage]!.name}`}
            >
              <Plant plant={p} />
              <span className="garden-tier-dot" style={{ background: TIER_COLOURS[p.tier] }} aria-hidden="true" />
            </a>
            {i === plants.length - 1 && pets?.map((pet, k) => <Pet key={k} kind={pet.kind} name={pet.name} />)}
          </li>
        )).flatMap((plant, i) => [plant, ...eggsAfter(i).map((k) => <EasterEgg key={`egg-${k}`} index={k} found={eggs!.includes(k)} onFind={(egg) => onFindEgg?.(egg)} />)])}
        {holiday && holiday !== 'easter' && <HolidayDecor id={holiday} />}
      </ul>
    </section>
  );
});
