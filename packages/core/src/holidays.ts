/**
 * Holidays (D108): for a few days around each, the app takes on its colours and the garden a few
 * decorations; entries never change. Worked out from the date alone, on this device's calendar.
 * Halloween first; Christmas, New Year, Easter and birthdays join the list the same way.
 */

export type HolidayId = 'halloween';

export interface HolidayInfo {
  id: HolidayId;
  name: string;
  emoji: string;
  /** When it shows, for Settings. */
  when: string;
}

export const HOLIDAYS: readonly HolidayInfo[] = [{ id: 'halloween', name: 'Halloween', emoji: '🎃', when: '24 to 31 October' }];

export interface Holiday extends HolidayInfo {
  /** The day itself (31 October), rather than the days leading up to it. */
  day: boolean;
}

/** The holiday a date (YYYY-MM-DD) falls in, unless it's switched off. */
export function holidayOn(date: string, off: ReadonlySet<HolidayId> = new Set()): Holiday | undefined {
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  if (month === 10 && day >= 24 && !off.has('halloween')) return { ...HOLIDAYS[0]!, day: day === 31 };
  return undefined;
}

/** Writing prompts for a holiday's day itself, offered before the everyday ones. */
export const HOLIDAY_PROMPTS: Record<HolidayId, readonly string[]> = {
  halloween: [
    'What scared you when you were small? Does it still?',
    'Write about a Halloween you remember: the costume, the street, the sweets.',
    'What’s a story that still gives you a shiver?',
  ],
};
