/**
 * Garden update 2, "Weather" (D99, docs/GARDEN.md): each month's bed in its season, and the day's
 * weather over the garden. Worked out from dates alone, so every device shows the same garden on
 * the same day, and nothing is stored.
 */

export type Season = 'winter' | 'spring' | 'summer' | 'autumn';
export type Hemisphere = 'north' | 'south';
/** The weather drawn over the garden. */
export type Weather = 'clear' | 'rain' | 'snow' | 'petals';
/** What the person chose: '' is no weather at all; 'auto' follows the day. */
export type WeatherChoice = '' | 'auto' | 'rain' | 'snow' | 'petals';

const NORTH: Season[] = ['winter', 'winter', 'spring', 'spring', 'spring', 'summer', 'summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter'];

/** The season of a month ("2026-10" or a whole date): December to February is the northern winter. */
export function seasonOf(month: string, hemisphere: Hemisphere): Season {
  const m = Number(month.slice(5, 7)) - 1;
  const i = hemisphere === 'south' ? (m + 6) % 12 : m;
  return NORTH[i] ?? 'summer';
}

/**
 * Time zones whose places are south of the equator, for the hemisphere a device starts with. Under
 * both their IANA names and the shorter ones browser engines report (Chromium gives
 * America/Buenos_Aires for America/Argentina/Buenos_Aires).
 */
const SOUTHERN = [
  /^Australia\//,
  /^Antarctica\//,
  /^America\/(Argentina\/.+|Buenos_Aires|Catamarca|Cordoba|Jujuy|Mendoza|Rosario)$/,
  /^America\/(Santiago|Punta_Arenas|Sao_Paulo|Montevideo|Asuncion|La_Paz|Lima|Campo_Grande|Cuiaba)$/,
  /^Pacific\/(Auckland|Chatham|Easter|Fiji|Noumea|Tongatapu|Apia|Tahiti|Norfolk|Efate)$/,
  /^Africa\/(Johannesburg|Windhoek|Maputo|Harare|Lusaka|Gaborone|Maseru|Mbabane|Blantyre|Luanda|Lubumbashi)$/,
  /^Indian\/(Antananarivo|Mauritius|Reunion|Mayotte|Comoro)$/,
  /^Atlantic\/(Stanley|South_Georgia|St_Helena)$/,
];

/** South when the time zone is one of SOUTHERN's, else north. A guess: it can be chosen in the shed. */
export function hemisphereOf(timeZone: string): Hemisphere {
  return SOUTHERN.some((re) => re.test(timeZone)) ? 'south' : 'north';
}

/** FNV-1a, 32 bits: the same number for the same day everywhere. */
function fnv1a32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** The day before a date ("2026-10-21" → "2026-10-20"), by the calendar alone. */
function dayBefore(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const at = new Date(0);
  at.setUTCFullYear(y!, m! - 1, d! - 1);
  return `${String(at.getUTCFullYear()).padStart(4, '0')}-${String(at.getUTCMonth() + 1).padStart(2, '0')}-${String(at.getUTCDate()).padStart(2, '0')}`;
}

/** Whether a day is wet: about one day in five, the same for everyone. */
const wet = (date: string) => fnv1a32(date) % 5 === 0;

/**
 * The weather over the garden on a day (its local date, "2026-10-21"), and whether a rainbow
 * shows. Auto rains one day in five, as snow in winter, with a rainbow the day after rain.
 */
export function weatherOn(choice: WeatherChoice, date: string, hemisphere: Hemisphere): { weather: Weather; rainbow: boolean } {
  if (choice !== 'auto') return { weather: choice || 'clear', rainbow: false };
  const winter = (day: string) => seasonOf(day, hemisphere) === 'winter';
  if (wet(date)) return { weather: winter(date) ? 'snow' : 'rain', rainbow: false };
  const yesterday = dayBefore(date);
  return { weather: 'clear', rainbow: wet(yesterday) && !winter(yesterday) };
}
