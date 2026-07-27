import { describe, expect, it } from 'vitest';
import {
  computeNextRunAt,
  normalizeSchedule,
  parseTimeOfDay,
  type ScheduledSchedule,
} from './scheduled';

describe('normalizeSchedule', () => {
  it('rejects intervals below the 30-minute floor and rounds the rest', () => {
    expect(() => normalizeSchedule({ kind: 'interval', intervalMinutes: 29 })).toThrow(/30/);
    expect(normalizeSchedule({ kind: 'interval', intervalMinutes: 30.4 }))
      .toEqual({ kind: 'interval', intervalMinutes: 30 });
  });

  it('accepts and canonicalizes a 24-hour HH:mm time', () => {
    expect(normalizeSchedule({ kind: 'daily', timeOfDay: ' 09:05 ' }))
      .toEqual({ kind: 'daily', timeOfDay: '09:05' });
    expect(normalizeSchedule({ kind: 'weekly', weekday: 6, timeOfDay: '23:59' }))
      .toEqual({ kind: 'weekly', weekday: 6, timeOfDay: '23:59' });
  });

  it('rejects malformed times, out-of-range weekdays, and unknown kinds', () => {
    expect(() => normalizeSchedule({ kind: 'daily', timeOfDay: '24:00' })).toThrow(/HH:mm/);
    expect(() => normalizeSchedule({ kind: 'daily', timeOfDay: '9:00' })).toThrow(/HH:mm/);
    expect(() => normalizeSchedule({ kind: 'daily', timeOfDay: '09:60' })).toThrow(/HH:mm/);
    expect(() => normalizeSchedule({ kind: 'weekly', weekday: 7 as 0, timeOfDay: '09:00' }))
      .toThrow(/weekday/);
    expect(() => normalizeSchedule({ kind: 'monthly' } as unknown as ScheduledSchedule))
      .toThrow(/Unsupported/);
  });
});

describe('parseTimeOfDay', () => {
  it('splits a valid time into local hour and minute', () => {
    expect(parseTimeOfDay('07:45')).toEqual({ hour: 7, minute: 45 });
    expect(parseTimeOfDay('00:00')).toEqual({ hour: 0, minute: 0 });
  });
});

describe('computeNextRunAt', () => {
  it('keeps interval schedules relative to the given instant', () => {
    const from = Date.UTC(2026, 6, 26, 9, 0);
    expect(computeNextRunAt({ kind: 'interval', intervalMinutes: 90 }, from))
      .toBe(from + 90 * 60_000);
  });

  it('returns today for a daily slot still ahead, tomorrow once it has passed', () => {
    const beforeSlot = new Date(2026, 6, 26, 8, 59).getTime();
    expect(computeNextRunAt({ kind: 'daily', timeOfDay: '09:00' }, beforeSlot))
      .toBe(new Date(2026, 6, 26, 9, 0).getTime());

    const atSlot = new Date(2026, 6, 26, 9, 0).getTime();
    expect(computeNextRunAt({ kind: 'daily', timeOfDay: '09:00' }, atSlot))
      .toBe(new Date(2026, 6, 27, 9, 0).getTime());
  });

  it('walks a weekly slot forward to the next matching weekday', () => {
    // 2026-07-26 is a Sunday (getDay() === 0).
    const sundayAfternoon = new Date(2026, 6, 26, 14, 30).getTime();
    expect(computeNextRunAt({ kind: 'weekly', weekday: 1, timeOfDay: '08:15' }, sundayAfternoon))
      .toBe(new Date(2026, 6, 27, 8, 15).getTime());
    expect(computeNextRunAt({ kind: 'weekly', weekday: 0, timeOfDay: '10:00' }, sundayAfternoon))
      .toBe(new Date(2026, 7, 2, 10, 0).getTime());
    expect(computeNextRunAt({ kind: 'weekly', weekday: 0, timeOfDay: '18:00' }, sundayAfternoon))
      .toBe(new Date(2026, 6, 26, 18, 0).getTime());
  });

  it('holds the wall-clock time across a day boundary instead of adding fixed milliseconds', () => {
    // Local field arithmetic, not `+86_400_000` — the run stays at 09:00 even
    // when the local day is 23 or 25 hours long (DST transitions).
    const from = new Date(2026, 6, 26, 9, 0).getTime();
    const next = new Date(computeNextRunAt({ kind: 'daily', timeOfDay: '09:00' }, from));
    expect(next.getHours()).toBe(9);
    expect(next.getMinutes()).toBe(0);
    expect(next.getDate()).toBe(27);
  });
});
