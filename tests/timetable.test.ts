/**
 * The cast's and the townsfolk's days (farmclaws part 4d spec §2, §3.2): the startup check on
 * every stop and loop spot, the current leg at each boundary, dry and wet, the pace targets, and
 * where the save migration puts a walker.
 */
import { describe, expect, it } from 'vitest';
import { JOBS, TOWNSFOLK } from '../src/config';
import { Direction, NPC_IDS, TOWNSFOLK_IDS, type TileCoord } from '../src/core/types';
import {
  assertTimetables,
  currentLeg,
  farmerStops,
  homeFront,
  legsFor,
  placeAt,
  targetOf,
  walkerHome,
} from '../src/people/timetable';
import { rectContains } from '../src/world/grid';
import { BARNABY_FIELD, COSMO_FIELD } from '../src/world/maps/neighbours';

/** A minute of the day: `hour` in 24-hour time. */
const at = (hour: number, minute = 0): number => hour * 60 + minute;
const key = (c: TileCoord): string => `${c.tx},${c.tz}`;

describe('assertTimetables', () => {
  it('passes for every walker’s stops and loop spots', () => {
    expect(() => assertTimetables()).not.toThrow();
  });
});

describe('currentLeg', () => {
  it('sends Sol out at 6:00 am on dry and wet days alike', () => {
    expect(currentLeg('sol', at(5, 59), false)).toBeNull();
    expect(legsFor('sol', false)[0]?.departs).toBe(at(6));
    expect(legsFor('sol', true)[0]?.departs).toBe(at(6));
    expect(currentLeg('sol', at(6), false)?.to).toEqual({ kind: 'spot', mapId: 'town', tx: 21, tz: 13, facing: Direction.West });
    expect(currentLeg('sol', at(6), true)?.to).toEqual({ kind: 'spot', mapId: 'town', tx: 21, tz: 7, facing: Direction.South });
  });

  it('walks Marigold through her dry day at each boundary', () => {
    const stopAt = (minute: number): unknown => currentLeg('marigold', minute, false)?.to ?? null;
    const morning = { kind: 'spot', mapId: 'town', tx: 8, tz: 22, facing: Direction.South };
    const work = { kind: 'spot', mapId: 'town', tx: 7, tz: 7, facing: Direction.South };
    expect(stopAt(at(6, 59))).toBeNull();
    expect(stopAt(at(7))).toEqual(morning);
    expect(stopAt(at(8, 29))).toEqual(morning);
    expect(stopAt(at(8, 30))).toEqual(work);
    expect(stopAt(at(12))).toEqual({ kind: 'spot', mapId: 'town', tx: 18, tz: 13, facing: Direction.East });
    expect(stopAt(at(12, 50))).toEqual(work);
    expect(stopAt(at(17))).toEqual({ kind: 'spot', mapId: 'town', tx: 5, tz: 16, facing: Direction.South });
    expect(stopAt(at(19))).toEqual({ kind: 'home' });
    expect(stopAt(at(25, 30))).toEqual({ kind: 'home' });
  });

  it('keeps Marigold in on a wet morning and over lunch', () => {
    const kindAt = (minute: number): string | null => currentLeg('marigold', minute, true)?.to.kind ?? null;
    expect(kindAt(at(8, 29))).toBeNull();
    expect(kindAt(at(8, 30))).toBe('spot');
    expect(kindAt(at(12))).toBe('home');
    expect(kindAt(at(12, 50))).toBe('spot');
    expect(kindAt(at(17))).toBe('home');
  });

  it('skips the farmers’ lunch in town on a wet day', () => {
    expect(legsFor('cosmo', false).map((leg) => leg.departs)).toEqual([at(6), at(11, 15), at(13), at(18), at(20)]);
    expect(legsFor('cosmo', true).map((leg) => leg.departs)).toEqual([at(6), at(18), at(20)]);
    expect(legsFor('barnaby', false)[1]?.departs).toBe(at(11, 5));
    expect(currentLeg('cosmo', at(11, 15), false)?.to).toEqual({ kind: 'spot', mapId: 'town', tx: 19, tz: 15, facing: Direction.North });
    expect(currentLeg('cosmo', at(11, 30), true)?.departs).toBe(at(6));
    expect(currentLeg('cosmo', at(17, 59), true)?.to.kind).toBe('pace');
  });
});

describe('targetOf', () => {
  it('cycles a pace stop’s spots every everyMinutes, counted from the leg’s departure', () => {
    const tile = (minute: number): unknown => {
      const target = targetOf('cosmo', minute, false);
      return target === 'home' ? 'home' : key(target.tile);
    };
    expect(tile(at(6))).toBe('11,10');
    expect(tile(at(6, 19))).toBe('11,10');
    expect(tile(at(6, 20))).toBe('16,7');
    expect(tile(at(6, 40))).toBe('4,13');
    expect(tile(at(7))).toBe('11,10');
    expect(tile(at(13))).toBe('11,10');
    expect(tile(at(13, 20))).toBe('16,7');
    expect(tile(at(20))).toBe('home');
  });

  it('cycles the courier round the shop fronts every 30 minutes, keeping no facing of its own', () => {
    const spots = [at(8), at(8, 30), at(9), at(9, 30), at(10)].map((minute) => targetOf('courier', minute, true));
    expect(spots.map((t) => (t === 'home' ? t : key(t.tile)))).toEqual(['7,8', '16,8', '24,8', '35,8', '7,8']);
    expect(spots.every((t) => t !== 'home' && t.facing === null)).toBe(true);
  });

  it('is home before the first leg and after the last', () => {
    expect(targetOf('juniper', at(7, 29), false)).toBe('home');
    expect(targetOf('jogger', at(7, 59), false)).toBe('home');
    expect(targetOf('jogger', at(19), false)).toBe('home');
  });
});

describe('the townsfolk', () => {
  it('come out at 8:00 am and go home at 7:00 pm on a dry day', () => {
    for (const id of TOWNSFOLK_IDS) {
      expect(legsFor(id, false).map((leg) => [leg.departs, leg.to.kind]), id).toEqual([
        [TOWNSFOLK.outAt, TOWNSFOLK.days[id].loop.kind],
        [TOWNSFOLK.homeAt, 'home'],
      ]);
    }
    expect([TOWNSFOLK.outAt, TOWNSFOLK.homeAt]).toEqual([at(8), at(19)]);
  });

  it('come out on a wet day only if they are the jogger or the courier', () => {
    expect(TOWNSFOLK_IDS.filter((id) => legsFor(id, true).length > 0)).toEqual(['jogger', 'courier']);
  });

  it('live behind the town’s south exits', () => {
    expect(walkerHome('jogger')).toEqual({ kind: 'exit', tile: { tx: 0, tz: 30 } });
    expect(homeFront('kid')).toEqual({ mapId: 'town', tile: { tx: 39, tz: 30 } });
  });
});

describe('homes', () => {
  it('put each character behind their door, with the tile in front of it as their front', () => {
    expect(walkerHome('marigold')).toEqual({ kind: 'door', mapId: 'town', door: { tx: 6, tz: 6 } });
    expect(homeFront('marigold')).toEqual({ mapId: 'town', tile: { tx: 6, tz: 7 } });
    expect(homeFront('cosmo')).toEqual({ mapId: 'neighbours', tile: { tx: 5, tz: 5 } });
    expect(homeFront('barnaby')).toEqual({ mapId: 'neighbours', tile: { tx: 26, tz: 5 } });
  });
});

describe('the farmers’ stops', () => {
  it('lie beside the fields, never on a field, a generator or a job robot’s tile', () => {
    const stops = farmerStops('neighbours');
    expect(stops.map(key).sort()).toEqual(['11,10', '16,7', '19,20', '25,15', '30,18', '30,22', '4,13', '7,13'].sort());
    const robots: readonly TileCoord[] = [JOBS.waveAt, ...JOBS.barnabyRobots, ...Object.values(JOBS.generators)];
    for (const stop of stops) {
      expect(rectContains(COSMO_FIELD, stop.tx, stop.tz), key(stop)).toBe(false);
      expect(rectContains(BARNABY_FIELD, stop.tx, stop.tz), key(stop)).toBe(false);
      expect(robots.map(key), key(stop)).not.toContain(key(stop));
    }
  });

  it('include their lunch spots in town', () => {
    expect(farmerStops('town').map(key).sort()).toEqual(['19,15', '20,15']);
  });
});

describe('placeAt', () => {
  it('stands a walker on their current target, facing its way, or indoors', () => {
    expect(placeAt('sol', at(6), false)).toEqual({ kind: 'out', mapId: 'town', tx: 21, tz: 13, facing: Direction.West });
    expect(placeAt('marigold', at(6), false)).toEqual({ kind: 'indoors' });
    expect(placeAt('barnaby', at(11, 40), true)).toEqual({ kind: 'out', mapId: 'neighbours', tx: 30, tz: 22, facing: Direction.West });
    expect(placeAt('busker', at(12), false)).toEqual({ kind: 'out', mapId: 'town', tx: 18, tz: 12, facing: Direction.South });
    for (const id of [...NPC_IDS, ...TOWNSFOLK_IDS]) expect(placeAt(id, at(25, 30), false), id).toEqual({ kind: 'indoors' });
  });

  it('faces a townsperson on a loop south, towards the camera', () => {
    expect(placeAt('kid', at(8, 25), false)).toEqual({ kind: 'out', mapId: 'town', tx: 31, tz: 9, facing: Direction.South });
  });
});
