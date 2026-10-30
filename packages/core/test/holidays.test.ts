import { describe, expect, it } from 'vitest';
import { easterSunday, holidayOn, isBirthday } from '../src/holidays.ts';

const id = (date: string, choices?: Parameters<typeof holidayOn>[1]) => holidayOn(date, choices)?.id;

describe('holidays (D108, D109)', () => {
  it('is Halloween from 24 to 31 October, the 31st being the day itself, every year', () => {
    expect(holidayOn('2026-10-23')).toBeUndefined();
    expect(holidayOn('2026-10-24')).toMatchObject({ id: 'halloween', emoji: '🎃', day: false, upcoming: true, greeting: 'Halloween is coming', prompts: [] });
    expect(holidayOn('2027-10-31')).toMatchObject({ id: 'halloween', day: true, upcoming: false, greeting: 'Happy Halloween' });
    expect(holidayOn('2027-10-31')!.prompts.length).toBe(3);
    expect(holidayOn('2026-11-01')).toBeUndefined();
  });

  it('is Christmas from 1 to 26 December, the 25th the day itself', () => {
    expect(id('2026-11-30')).toBeUndefined();
    expect(holidayOn('2026-12-01')).toMatchObject({ id: 'christmas', upcoming: true, greeting: 'Christmas is coming', day: false });
    expect(holidayOn('2026-12-25')).toMatchObject({ id: 'christmas', day: true, greeting: 'Merry Christmas' });
    expect(holidayOn('2026-12-26')).toMatchObject({ id: 'christmas', day: false, upcoming: false, greeting: 'Merry Christmas', prompts: [] });
    expect(id('2026-12-27')).toBeUndefined();
  });

  it('is New Year on 31 December and 1 January, each with its own greeting and prompts', () => {
    const eve = holidayOn('2026-12-31')!;
    const day = holidayOn('2027-01-01')!;
    expect(eve).toMatchObject({ id: 'newyear', day: true, greeting: 'Happy New Year’s Eve' });
    expect(day).toMatchObject({ id: 'newyear', day: true, greeting: 'Happy New Year' });
    expect(eve.prompts).not.toEqual(day.prompts);
    expect(id('2027-01-02')).toBeUndefined();
  });

  it('works out Easter each year, from Good Friday to Easter Monday', () => {
    expect([2024, 2025, 2026, 2027, 2028, 2038, 2285].map(easterSunday)).toEqual(['2024-03-31', '2025-04-20', '2026-04-05', '2027-03-28', '2028-04-16', '2038-04-25', '2285-03-22']);
    expect(id('2027-03-25')).toBeUndefined();
    expect(holidayOn('2027-03-26')).toMatchObject({ id: 'easter', upcoming: true, day: false });
    expect(holidayOn('2027-03-28')).toMatchObject({ id: 'easter', day: true, greeting: 'Happy Easter' });
    expect(holidayOn('2027-03-29')).toMatchObject({ id: 'easter', day: false, upcoming: false });
    expect(id('2027-03-30')).toBeUndefined();
  });

  it('is your birthday on the day you set (29 February on the 28th in other years), before any other holiday', () => {
    expect(id('2027-03-07')).toBeUndefined();
    expect(holidayOn('2027-03-07', { birthday: '03-07' })).toMatchObject({ id: 'birthday', day: true, greeting: 'Happy birthday' });
    expect(id('2026-10-31', { birthday: '10-31' })).toBe('birthday');
    expect(isBirthday('2027-02-28', '02-29')).toBe(true);
    expect(isBirthday('2028-02-28', '02-29')).toBe(false);
    expect(isBirthday('2028-02-29', '02-29')).toBe(true);
  });

  it('is nothing once switched off, one at a time or all at once', () => {
    expect(id('2026-10-31', { off: new Set(['halloween']) })).toBeUndefined();
    expect(id('2026-12-25', { off: new Set(['halloween']) })).toBe('christmas');
    // A birthday switched off leaves the holiday under it.
    expect(id('2026-10-31', { birthday: '10-31', off: new Set(['birthday']) })).toBe('halloween');
    for (const date of ['2026-10-31', '2026-12-25', '2027-01-01', '2027-03-28', '2027-03-07']) expect(id(date, { all: false, birthday: '03-07' })).toBeUndefined();
  });
});
