import { describe, expect, it } from 'vitest';
import { hemisphereOf, seasonOf, weatherOn } from '../src/index.ts';

/** The days from a date onward, as "YYYY-MM-DD". */
function days(from: string, n: number): string[] {
  const out: string[] = [];
  const at = new Date(`${from}T00:00:00Z`);
  for (let i = 0; i < n; i++, at.setUTCDate(at.getUTCDate() + 1)) out.push(at.toISOString().slice(0, 10));
  return out;
}

describe('seasons and weather (D99)', () => {
  it('gives each month its season, six months apart in the south', () => {
    expect(['2026-01', '2026-03', '2026-06', '2026-09', '2026-12'].map((m) => seasonOf(m, 'north'))).toEqual(['winter', 'spring', 'summer', 'autumn', 'winter']);
    expect(['2026-01', '2026-03', '2026-06', '2026-09', '2026-12'].map((m) => seasonOf(m, 'south'))).toEqual(['summer', 'autumn', 'winter', 'spring', 'summer']);
    expect(seasonOf('2026-07-15', 'south')).toBe('winter');
  });

  it('guesses the hemisphere from the time zone', () => {
    expect(['Australia/Adelaide', 'Pacific/Auckland', 'America/Argentina/Buenos_Aires', 'America/Sao_Paulo', 'Africa/Johannesburg'].map(hemisphereOf)).toEqual(['south', 'south', 'south', 'south', 'south']);
    expect(['Europe/London', 'America/New_York', 'Asia/Tokyo', 'UTC', ''].map(hemisphereOf)).toEqual(['north', 'north', 'north', 'north', 'north']);
  });

  it('shows the weather chosen, or none', () => {
    expect(weatherOn('', '2026-10-21', 'north')).toEqual({ weather: 'clear', rainbow: false });
    expect(weatherOn('petals', '2026-10-21', 'north')).toEqual({ weather: 'petals', rainbow: false });
  });

  it('rains about one day in five on Auto, snows in winter, and shows a rainbow the day after rain', () => {
    const year = days('2026-01-01', 365);
    const north = year.map((d) => weatherOn('auto', d, 'north'));
    const wet = north.filter((w) => w.weather !== 'clear').length;
    expect(wet).toBeGreaterThan(365 * 0.15);
    expect(wet).toBeLessThan(365 * 0.25);
    year.forEach((d, i) => {
      const w = north[i]!;
      if (w.weather === 'snow') expect(seasonOf(d, 'north')).toBe('winter');
      if (w.weather === 'rain') expect(seasonOf(d, 'north')).not.toBe('winter');
      // A rainbow only on a dry day after a rainy one.
      if (w.rainbow) expect([w.weather, north[i - 1]?.weather ?? weatherOn('auto', '2025-12-31', 'north').weather]).toEqual(['clear', 'rain']);
    });
    expect(north.some((w) => w.rainbow)).toBe(true);
    // The same days are wet in both hemispheres; only what falls differs.
    const south = year.map((d) => weatherOn('auto', d, 'south'));
    expect(south.map((w) => w.weather === 'clear')).toEqual(north.map((w) => w.weather === 'clear'));
    // The same day gives the same weather, every time.
    expect(weatherOn('auto', '2026-10-21', 'north')).toEqual(weatherOn('auto', '2026-10-21', 'north'));
  });
});
