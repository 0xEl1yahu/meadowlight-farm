/**
 * Deterministic daily weather. Weather for a day is a pure function of (seed, absoluteDay),
 * which means tomorrow's forecast can be shown without storing it.
 */
import { TIME } from '../config';
import { Salt, hashFloat } from '../core/hash';
import { Season, Weather } from '../core/types';
import { seasonOfDay } from './clock';

interface WeatherOdds {
  readonly rain: number;
  readonly storm: number;
  readonly snow: number;
}

const ODDS: Readonly<Record<Season, WeatherOdds>> = {
  [Season.Spring]: { rain: 0.18, storm: 0.04, snow: 0 },
  [Season.Summer]: { rain: 0.1, storm: 0.08, snow: 0 },
  [Season.Fall]: { rain: 0.18, storm: 0.03, snow: 0 },
  [Season.Winter]: { rain: 0, storm: 0, snow: 0.35 },
};

export function rollWeather(seed: number, absoluteDay: number): Weather {
  // The first day of the save and of every season is always clear.
  if (absoluteDay === 0 || absoluteDay % TIME.daysPerSeason === 0) return Weather.Sunny;
  const odds = ODDS[seasonOfDay(absoluteDay)];
  const roll = hashFloat(seed, absoluteDay, Salt.Weather);
  if (roll < odds.storm) return Weather.Storm;
  if (roll < odds.storm + odds.rain) return Weather.Rain;
  if (roll < odds.storm + odds.rain + odds.snow) return Weather.Snow;
  return Weather.Sunny;
}

/** Rain and storms water every tilled tile for the day. */
export function weatherWaters(weather: Weather): boolean {
  return weather === Weather.Rain || weather === Weather.Storm;
}

export function weatherLabel(weather: Weather): string {
  switch (weather) {
    case Weather.Sunny:
      return 'Sunny';
    case Weather.Rain:
      return 'Rain';
    case Weather.Storm:
      return 'Storm';
    case Weather.Snow:
      return 'Snow';
  }
}
