/**
 * Deterministic daily weather (src/time/weather.ts): a pure function of (seed, day), always
 * clear on the first day of the save and of each season, snow only in winter, and a long-run
 * distribution that matches the per-season odds.
 */
import { describe, expect, it } from 'vitest';
import { TIME, WORLD } from '../src/config';
import { Season, Weather } from '../src/core/types';
import { seasonOfDay } from '../src/time/clock';
import { rollWeather, weatherLabel, weatherWaters } from '../src/time/weather';

const DAYS_PER_YEAR = TIME.daysPerSeason * TIME.seasonsPerYear;

/** Expected odds from the design (mirrors the table in weather.ts). */
const ODDS: Readonly<Record<Season, { readonly rain: number; readonly storm: number; readonly snow: number }>> = {
  [Season.Spring]: { rain: 0.18, storm: 0.04, snow: 0 },
  [Season.Summer]: { rain: 0.1, storm: 0.08, snow: 0 },
  [Season.Fall]: { rain: 0.18, storm: 0.03, snow: 0 },
  [Season.Winter]: { rain: 0, storm: 0, snow: 0.35 },
};

describe('rollWeather', () => {
  it('is a pure function of (seed, day)', () => {
    for (const seed of [WORLD.seed, 0, 1, 0xffffffff]) {
      for (let day = 0; day < 400; day++) {
        expect(rollWeather(seed, day)).toBe(rollWeather(seed, day));
      }
    }
  });

  it('differs between seeds', () => {
    let differences = 0;
    for (let day = 1; day < 400; day++) {
      if (rollWeather(1, day) !== rollWeather(2, day)) differences++;
    }
    expect(differences).toBeGreaterThan(40);
  });

  it('is sunny on day 0 and on the first day of every season', () => {
    for (let seed = 0; seed < 50; seed++) {
      expect(rollWeather(seed, 0)).toBe(Weather.Sunny);
      for (let season = 0; season < 40; season++) {
        expect(rollWeather(seed, season * TIME.daysPerSeason)).toBe(Weather.Sunny);
      }
    }
  });

  it('only snows in winter, and winter is only snow or sun', () => {
    const wrong: string[] = [];
    let snowyDays = 0;
    for (let seed = 0; seed < 20; seed++) {
      for (let day = 0; day < 4 * DAYS_PER_YEAR; day++) {
        const weather = rollWeather(seed, day);
        const winter = seasonOfDay(day) === Season.Winter;
        if (weather === Weather.Snow) snowyDays++;
        const allowed = winter ? weather === Weather.Snow || weather === Weather.Sunny : weather !== Weather.Snow;
        if (!allowed) wrong.push(`seed ${seed} day ${day}: ${weather}`);
      }
    }
    expect(wrong).toEqual([]);
    expect(snowyDays).toBeGreaterThan(100);
  });

  it('matches the per-season odds over many days', () => {
    const tallies = new Map<Season, Record<Weather, number>>();
    let samplesPerSeason = 0;
    for (const season of [Season.Spring, Season.Summer, Season.Fall, Season.Winter]) {
      tallies.set(season, { sunny: 0, rain: 0, storm: 0, snow: 0 });
    }
    for (let year = 0; year < 300; year++) {
      for (let dayOfSeason = 1; dayOfSeason < TIME.daysPerSeason; dayOfSeason++) {
        for (const season of [Season.Spring, Season.Summer, Season.Fall, Season.Winter]) {
          const day = year * DAYS_PER_YEAR + season * TIME.daysPerSeason + dayOfSeason;
          const tally = tallies.get(season);
          if (tally === undefined) throw new Error('missing tally');
          tally[rollWeather(WORLD.seed, day)]++;
        }
        samplesPerSeason++;
      }
    }
    for (const [season, tally] of tallies) {
      const odds = ODDS[season];
      const n = samplesPerSeason;
      // ±0.02 is > 5 standard errors for n ≈ 8100 and p ≤ 0.35.
      expect(Math.abs(tally.rain / n - odds.rain), `rain in season ${season}`).toBeLessThan(0.02);
      expect(Math.abs(tally.storm / n - odds.storm)).toBeLessThan(0.02);
      expect(Math.abs(tally.snow / n - odds.snow)).toBeLessThan(0.02);
      expect(Math.abs(tally.sunny / n - (1 - odds.rain - odds.storm - odds.snow))).toBeLessThan(0.025);
      if (odds.rain === 0) expect(tally.rain).toBe(0);
      if (odds.storm === 0) expect(tally.storm).toBe(0);
      if (odds.snow === 0) expect(tally.snow).toBe(0);
    }
  });
});

describe('weather helpers', () => {
  it('only rain and storms water the soil', () => {
    expect(weatherWaters(Weather.Rain)).toBe(true);
    expect(weatherWaters(Weather.Storm)).toBe(true);
    expect(weatherWaters(Weather.Sunny)).toBe(false);
    expect(weatherWaters(Weather.Snow)).toBe(false);
  });

  it('labels every weather', () => {
    expect(weatherLabel(Weather.Sunny)).toBe('Sunny');
    expect(weatherLabel(Weather.Rain)).toBe('Rain');
    expect(weatherLabel(Weather.Storm)).toBe('Storm');
    expect(weatherLabel(Weather.Snow)).toBe('Snow');
  });
});
