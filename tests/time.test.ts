/**
 * Calendar & clock maths (src/time/clock.ts) and the fixed-step accumulator
 * (src/core/loop.ts): HUD clock formatting past midnight with 10-minute quantisation,
 * day / season / year rollovers, and whole-minute stepping of variable frame times.
 */
import { describe, expect, it } from 'vitest';
import { TIME } from '../src/config';
import { FixedStepClock } from '../src/core/loop';
import { Season } from '../src/core/types';
import {
  calendarTime,
  createInitialTime,
  dayProgress,
  formatClock,
  formatDate,
  nextDay,
  seasonName,
  seasonOfDay,
  weekdayName,
} from '../src/time/clock';

describe('formatClock', () => {
  const cases: readonly (readonly [number, string])[] = [
    [360, '6:00 am'],
    [365, '6:00 am'],
    [369, '6:00 am'],
    [370, '6:10 am'],
    [659, '10:50 am'],
    [719, '11:50 am'],
    [720, '12:00 pm'],
    [779, '12:50 pm'],
    [780, '1:00 pm'],
    [1080, '6:00 pm'],
    [1430, '11:50 pm'],
    [1439, '11:50 pm'],
    [1440, '12:00 am'],
    [1450, '12:10 am'],
    [1500, '1:00 am'],
    [1550, '1:50 am'],
    [1559, '1:50 am'],
    [1560, '2:00 am'],
    [0, '12:00 am'],
  ];
  it.each(cases)('formats minute %i as "%s"', (minute, label) => {
    expect(formatClock(minute)).toBe(label);
  });

  it('quantises down to the step for every minute of the day', () => {
    for (let minute = TIME.dayStartMinute; minute <= TIME.passOutMinute; minute++) {
      const quantised = minute - (minute % TIME.clockStepMinutes);
      expect(formatClock(minute)).toBe(formatClock(quantised));
      const [clock, suffix] = formatClock(minute).split(' ');
      const [hours, minutes] = (clock ?? '').split(':').map(Number) as [number, number];
      expect(hours).toBeGreaterThanOrEqual(1);
      expect(hours).toBeLessThanOrEqual(12);
      expect(minutes % TIME.clockStepMinutes).toBe(0);
      expect(['am', 'pm']).toContain(suffix);
    }
  });

  it('honours a custom step', () => {
    expect(formatClock(367, 1)).toBe('6:07 am');
    expect(formatClock(367, 5)).toBe('6:05 am');
    expect(formatClock(1559, 30)).toBe('1:30 am');
  });
});

describe('calendarTime', () => {
  it('starts the save on Spring 1, Year 1 at 6:00', () => {
    expect(createInitialTime()).toEqual({ minuteOfDay: 360, dayOfSeason: 1, season: Season.Spring, year: 1, absoluteDay: 0 });
  });

  it('rolls over from the last day of Spring (day 27) into Summer', () => {
    expect(calendarTime(27, 360)).toMatchObject({ dayOfSeason: 28, season: Season.Spring, year: 1 });
    expect(calendarTime(28, 360)).toMatchObject({ dayOfSeason: 1, season: Season.Summer, year: 1 });
    expect(nextDay(calendarTime(27, 1500))).toEqual({
      minuteOfDay: TIME.dayStartMinute,
      dayOfSeason: 1,
      season: Season.Summer,
      year: 1,
      absoluteDay: 28,
    });
  });

  it('rolls over from the last day of Winter (day 111) into Spring of Year 2', () => {
    expect(calendarTime(111, 360)).toMatchObject({ dayOfSeason: 28, season: Season.Winter, year: 1 });
    expect(calendarTime(112, 360)).toMatchObject({ dayOfSeason: 1, season: Season.Spring, year: 2 });
    expect(nextDay(calendarTime(111, 900))).toMatchObject({ absoluteDay: 112, season: Season.Spring, year: 2, dayOfSeason: 1 });
  });

  it('is consistent for every day of the first three years', () => {
    let time = createInitialTime();
    for (let day = 0; day < 3 * 112; day++) {
      expect(time.absoluteDay).toBe(day);
      expect(time.dayOfSeason).toBe((day % 28) + 1);
      expect(time.season).toBe(Math.floor(day / 28) % 4);
      expect(time.season).toBe(seasonOfDay(day));
      expect(time.year).toBe(Math.floor(day / 112) + 1);
      expect(time.minuteOfDay).toBe(TIME.dayStartMinute);
      time = nextDay(time);
    }
  });

  it('rejects negative and fractional days', () => {
    expect(() => calendarTime(-1, 360)).toThrow(RangeError);
    expect(() => calendarTime(1.5, 360)).toThrow(RangeError);
    expect(() => calendarTime(Number.NaN, 360)).toThrow(RangeError);
  });

  it('names weekdays, seasons and full dates', () => {
    expect(weekdayName(1)).toBe('Mon');
    expect(weekdayName(7)).toBe('Sun');
    expect(weekdayName(8)).toBe('Mon');
    expect(weekdayName(28)).toBe('Sun');
    expect(seasonName(Season.Spring)).toBe('Spring');
    expect(seasonName(Season.Winter)).toBe('Winter');
    expect(formatDate(createInitialTime())).toBe('Mon. 1 · Spring · Year 1');
    expect(formatDate(calendarTime(112 + 28 + 2, 360))).toBe('Wed. 3 · Summer · Year 2');
  });

  it('maps the day to progress in [0, 1]', () => {
    expect(dayProgress(360)).toBe(0);
    expect(dayProgress(960)).toBe(0.5);
    expect(dayProgress(1560)).toBe(1);
    expect(dayProgress(0)).toBe(0);
    expect(dayProgress(2000)).toBe(1);
  });
});

describe('FixedStepClock', () => {
  it('converts accumulated real time into whole steps and keeps the remainder', () => {
    const clock = new FixedStepClock(0.5, 100);
    expect(clock.advance(0.2)).toBe(0);
    expect(clock.fraction).toBeCloseTo(0.4, 12);
    expect(clock.advance(0.2)).toBe(0);
    expect(clock.advance(0.2)).toBe(1);
    expect(clock.fraction).toBeCloseTo(0.2, 9);
    expect(clock.advance(1.0)).toBe(2);
    expect(clock.fraction).toBeCloseTo(0.2, 9);
  });

  it('drops the backlog beyond maxStepsPerAdvance', () => {
    const clock = new FixedStepClock(0.1, 5);
    expect(clock.advance(10)).toBe(5);
    expect(clock.fraction).toBe(0);
    expect(clock.advance(0.05)).toBe(0);
  });

  it('ignores non-positive and non-finite input and can be reset', () => {
    const clock = new FixedStepClock(1, 10);
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) expect(clock.advance(bad)).toBe(0);
    expect(clock.fraction).toBe(0);
    clock.advance(0.75);
    expect(clock.fraction).toBeCloseTo(0.75, 12);
    clock.reset();
    expect(clock.fraction).toBe(0);
  });

  it('never reports a fraction of 1 or more', () => {
    const clock = new FixedStepClock(0.7, 120);
    for (let i = 0; i < 1000; i++) {
      clock.advance(0.016 + (i % 7) * 0.003);
      expect(clock.fraction).toBeGreaterThanOrEqual(0);
      expect(clock.fraction).toBeLessThan(1);
    }
  });

  it('matches the Stardew pacing: 10 game minutes per 7 real seconds', () => {
    const clock = new FixedStepClock(TIME.realSecondsPerGameMinute, TIME.maxTickMinutes);
    let minutes = 0;
    for (let frame = 0; frame < 700; frame++) minutes += clock.advance(0.01);
    expect(minutes).toBeGreaterThanOrEqual(9);
    expect(minutes).toBeLessThanOrEqual(10);
  });

  it('rejects invalid construction parameters', () => {
    expect(() => new FixedStepClock(0, 1)).toThrow(RangeError);
    expect(() => new FixedStepClock(-1, 1)).toThrow(RangeError);
    expect(() => new FixedStepClock(Number.NaN, 1)).toThrow(RangeError);
    expect(() => new FixedStepClock(1, 0)).toThrow(RangeError);
    expect(() => new FixedStepClock(1, 1.5)).toThrow(RangeError);
  });
});
