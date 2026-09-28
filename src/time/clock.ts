/**
 * Calendar & clock math. The day runs 06:00 → 26:00 (02:00 next morning) as a single
 * monotonic minute counter; a season is 28 days; a year is 4 seasons.
 */
import { TIME } from '../config';
import { SEASON_NAMES, type Season, type TimeState } from '../core/types';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

export function createInitialTime(): TimeState {
  return calendarTime(0, TIME.dayStartMinute);
}

/** Full calendar for a 0-based absolute day. */
export function calendarTime(absoluteDay: number, minuteOfDay: number): TimeState {
  if (!Number.isInteger(absoluteDay) || absoluteDay < 0) {
    throw new RangeError(`calendarTime: absoluteDay must be a non-negative integer, got ${absoluteDay}`);
  }
  const daysPerYear = TIME.daysPerSeason * TIME.seasonsPerYear;
  return {
    minuteOfDay,
    dayOfSeason: (absoluteDay % TIME.daysPerSeason) + 1,
    season: seasonOfDay(absoluteDay),
    year: Math.floor(absoluteDay / daysPerYear) + 1,
    absoluteDay,
  };
}

export function seasonOfDay(absoluteDay: number): Season {
  return (Math.floor(absoluteDay / TIME.daysPerSeason) % TIME.seasonsPerYear) as Season;
}

/** Morning of the following day. */
export function nextDay(time: TimeState): TimeState {
  return calendarTime(time.absoluteDay + 1, TIME.dayStartMinute);
}

export function weekdayName(dayOfSeason: number): string {
  return WEEKDAYS[(dayOfSeason - 1) % WEEKDAYS.length] ?? WEEKDAYS[0];
}

export function seasonName(season: Season): string {
  return SEASON_NAMES[season];
}

/** "6:00 am" style, quantised down to the HUD clock step. Handles minutes past midnight. */
export function formatClock(minuteOfDay: number, stepMinutes: number = TIME.clockStepMinutes): string {
  const quantised = Math.floor(minuteOfDay / stepMinutes) * stepMinutes;
  const hour24 = Math.floor(quantised / 60) % 24;
  const minutes = quantised % 60;
  const suffix = hour24 < 12 ? 'am' : 'pm';
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${minutes.toString().padStart(2, '0')} ${suffix}`;
}

/** "Mon. 1 · Spring · Year 1" */
export function formatDate(time: TimeState): string {
  return `${weekdayName(time.dayOfSeason)}. ${time.dayOfSeason} · ${seasonName(time.season)} · Year ${time.year}`;
}

/** 0 at 06:00, 1 at 02:00 (pass-out). */
export function dayProgress(minuteOfDay: number): number {
  const span = TIME.passOutMinute - TIME.dayStartMinute;
  return Math.min(1, Math.max(0, (minuteOfDay - TIME.dayStartMinute) / span));
}
