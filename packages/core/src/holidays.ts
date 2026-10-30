import { addDays } from './dates.ts';

/**
 * Holidays (D108, D109): for a few days around each, the app takes on its colours, the garden a few
 * decorations and the day itself its own writing prompts; entries never change. Worked out from the
 * date alone, on this device's calendar.
 */

export type HolidayId = 'newyear' | 'easter' | 'halloween' | 'christmas' | 'birthday';

export interface HolidayInfo {
  id: HolidayId;
  name: string;
  emoji: string;
  /** When it shows, for Settings. */
  when: string;
}

/** In the order of the year, your birthday last. */
export const HOLIDAYS: readonly HolidayInfo[] = [
  { id: 'newyear', name: 'New Year', emoji: '🎆', when: '31 December and 1 January' },
  { id: 'easter', name: 'Easter', emoji: '🐣', when: 'Good Friday to Easter Monday' },
  { id: 'halloween', name: 'Halloween', emoji: '🎃', when: '24 to 31 October' },
  { id: 'christmas', name: 'Christmas', emoji: '🎄', when: '1 to 26 December' },
  { id: 'birthday', name: 'Your birthday', emoji: '🎂', when: 'the day itself' },
];

export interface Holiday extends HolidayInfo {
  /** The day itself (Christmas Day, Easter Sunday, both days of New Year…), with its own prompts. */
  day: boolean;
  /** Before the day itself ("Christmas is coming"). */
  upcoming: boolean;
  /** What the app says: "Merry Christmas", "Happy New Year's Eve", "Halloween is coming"… */
  greeting: string;
  /** The day's writing prompts, offered before the everyday ones; none on the days around it. */
  prompts: readonly string[];
}

export interface HolidayChoices {
  /** Every holiday off at once (Settings → Holidays). */
  all?: boolean;
  /** Holidays switched off one by one. */
  off?: ReadonlySet<HolidayId>;
  /** Your birthday, as MM-DD; no year. */
  birthday?: string;
}

const PROMPTS = {
  newyearsEve: ['What are you glad to leave behind in this year?', 'What was the best thing that happened this year?', 'Who made this year better?'],
  newYearsDay: ['What do you hope the year ahead brings?', 'What’s one small thing you’d like to do more of this year?', 'Write a note to yourself to read next New Year’s Day.'],
  easter: ['What feels new or renewed in your life right now?', 'Write about an Easter or a spring day you remember.', 'What’s starting to grow, in the garden or in you?'],
  halloween: [
    'What scared you when you were small? Does it still?',
    'Write about a Halloween you remember: the costume, the street, the sweets.',
    'What’s a story that still gives you a shiver?',
  ],
  christmas: ['What’s a Christmas memory that still makes you smile?', 'Who are you thinking of today, near or far?', 'What made today feel like Christmas, or not quite?'],
  birthday: ['What do you hope this year of your life brings?', 'What did the last year teach you?', 'Write a letter to yourself to open on your next birthday.'],
} as const;

/** Easter Sunday (Western churches) of a year, as YYYY-MM-DD: the Gregorian computus (Meeus, Jones, Butcher). */
export function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Whether a birthday (MM-DD) falls on a date: 29 February is the 28th in other years. */
export function isBirthday(date: string, birthday: string): boolean {
  const year = Number(date.slice(0, 4));
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  return date.slice(5) === (birthday === '02-29' && !leap ? '02-28' : birthday);
}

/**
 * The holiday a date (YYYY-MM-DD) falls in, unless switched off. Your birthday comes before any
 * other holiday that falls on it.
 */
export function holidayOn(date: string, choices: HolidayChoices = {}): Holiday | undefined {
  if (choices.all === false) return undefined;
  const off = choices.off ?? new Set<HolidayId>();
  const info = (id: HolidayId) => HOLIDAYS.find((h) => h.id === id)!;
  const make = (id: HolidayId, day: boolean, upcoming: boolean, greeting: string, prompts: readonly string[]): Holiday => ({
    ...info(id),
    day,
    upcoming,
    greeting: upcoming ? `${info(id).name} is coming` : greeting,
    prompts: day ? prompts : [],
  });
  const md = date.slice(5);
  if (choices.birthday && !off.has('birthday') && isBirthday(date, choices.birthday)) return make('birthday', true, false, 'Happy birthday', PROMPTS.birthday);
  if (!off.has('newyear')) {
    if (md === '12-31') return make('newyear', true, false, 'Happy New Year’s Eve', PROMPTS.newyearsEve);
    if (md === '01-01') return make('newyear', true, false, 'Happy New Year', PROMPTS.newYearsDay);
  }
  if (!off.has('easter')) {
    const sunday = easterSunday(Number(date.slice(0, 4)));
    if (date >= addDays(sunday, -2) && date <= addDays(sunday, 1)) return make('easter', date === sunday, date < sunday, 'Happy Easter', PROMPTS.easter);
  }
  if (!off.has('halloween') && md >= '10-24' && md <= '10-31') return make('halloween', md === '10-31', md < '10-31', 'Happy Halloween', PROMPTS.halloween);
  if (!off.has('christmas') && md >= '12-01' && md <= '12-26') return make('christmas', md === '12-25', md < '12-25', 'Merry Christmas', PROMPTS.christmas);
  return undefined;
}
