import { useMemo } from 'react';
import { rankName, SIZE_STAGES, TIERS, type Plant as PlantData } from '@logbook/core';
import { useGarden } from '../app/garden.tsx';
import { href } from '../app/router.ts';
import { PERKS, setGardenPrefs, useGardenPrefs, type GardenPrefs } from '../lib/garden-prefs.ts';
import { formatLongDate } from './common.tsx';
import { Plant, TIER_COLOURS } from './garden/Plant.tsx';

/** The garden (D97): a plant for every entry, in a bed for each month, newest first. */

const ORNAMENTS: Record<string, string> = { sundial: '🕰️', birdbath: '⛲', globe: '🔮' };

function skyNow(): 'dawn' | 'day' | 'golden' | 'night' {
  const h = new Date().getHours();
  return h >= 5 && h < 8 ? 'dawn' : h >= 8 && h < 17 ? 'day' : h >= 17 && h < 20 ? 'golden' : 'night';
}

export function GardenView() {
  const garden = useGarden();
  const prefs = useGardenPrefs();
  const beds = useMemo(() => {
    const byMonth = new Map<string, PlantData[]>();
    for (const p of garden?.plants ?? []) {
      const m = p.entry.date.slice(0, 7);
      byMonth.set(m, [...(byMonth.get(m) ?? []), p]);
    }
    return [...byMonth.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([month, plants]) => ({ month, plants: plants.sort((a, b) => a.entry.date.localeCompare(b.entry.date)) }));
  }, [garden]);

  if (!garden) return <p className="muted">Opening the garden…</p>;
  const { rank } = garden;
  const top = rank.tier === TIERS.length - 1;
  const has = (tier: number) => rank.tier >= tier;
  const on = (tier: number, pref: keyof GardenPrefs) => has(tier) && Boolean(prefs[pref]);
  const sky = on(4, 'livingSky') ? skyNow() : 'day';
  const progress = Math.min(1, (rank.growth - rank.from) / (rank.next - rank.from));
  const nextName = top ? `${TIERS[rank.tier]!.name} ★${rank.ring + 1}` : TIERS[rank.tier + 1]!.name;

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

      <div
        className="garden-scene"
        data-sky={sky}
        data-stars={on(9, 'stars') || undefined}
        data-aurora={on(10, 'aurora') || undefined}
        data-nebula={on(11, 'nebula') || undefined}
        data-path={(has(5) && prefs.path) || undefined}
        data-border={(has(7) && prefs.border) || undefined}
        data-gold={on(12, 'goldSigns') || undefined}
        data-ancient={on(13, 'ancient') || undefined}
      >
        <div className="garden-gate" aria-hidden="true">
          <span>🚪</span>
          {has(8) && prefs.ornament && <span>{ORNAMENTS[prefs.ornament]}</span>}
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
        {beds.length === 0 ? (
          <p className="garden-empty">Write your first entry to plant your first seed. 🌱</p>
        ) : (
          beds.map((bed) => (
            <section key={bed.month} className="garden-bed" aria-labelledby={`bed-${bed.month}`}>
              <h2 className="garden-sign" id={`bed-${bed.month}`}>
                {on(6, 'lanterns') && <span aria-hidden="true">🏮 </span>}
                {new Date(`${bed.month}-15T12:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
                <span className="muted"> · {bed.plants.length === 1 ? '1 plant' : `${bed.plants.length} plants`}</span>
              </h2>
              <ul className="garden-ground">
                {bed.plants.map((p) => (
                  <li key={p.entry.id}>
                    <a
                      className="garden-plant"
                      href={href({ name: 'entry', id: p.entry.id })}
                      title={`${p.entry.title || 'Untitled'} · ${TIERS[p.tier]!.name} ${p.species}`}
                      aria-label={`${p.entry.title || 'Untitled'}, ${formatLongDate(p.entry.date)}: ${TIERS[p.tier]!.name} ${p.species}, ${SIZE_STAGES[p.stage]!.name}`}
                    >
                      <Plant plant={p} />
                      <span className="garden-tier-dot" style={{ background: TIER_COLOURS[p.tier] }} aria-hidden="true" />
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </div>

      <section className="panel garden-shed" aria-labelledby="shed-h">
        <h2 id="shed-h">Garden shed</h2>
        <p className="hint">Every tier unlocks a perk. Nothing changes until you choose it, and nothing is ever taken back.</p>
        <ul className="perk-list">
          {PERKS.map((perk) => {
            const open = has(perk.tier);
            return (
              <li key={perk.tier} className="perk" data-open={open}>
                <span className="perk-tier" style={{ background: TIER_COLOURS[perk.tier] }} aria-hidden="true">
                  {TIERS[perk.tier]!.emoji}
                </span>
                <div className="perk-body">
                  <strong>{perk.title}</strong> <span className="muted">· {TIERS[perk.tier]!.name}</span>
                  <p className="hint">{open ? perk.text : `🔒 Reach ${TIERS[perk.tier]!.name} (${TIERS[perk.tier]!.at.toLocaleString()} Growth).`}</p>
                  {open && perk.kind === 'toggle' && (
                    <label className="row">
                      <input type="checkbox" checked={Boolean(prefs[perk.pref])} onChange={(e) => setGardenPrefs({ [perk.pref]: e.target.checked })} /> On
                    </label>
                  )}
                  {open && perk.kind === 'choice' && (
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
    </div>
  );
}
