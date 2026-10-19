/**
 * The walk (farmclaws part 4d spec §4.2, §4.3, §4.5, §4.7): one tile a minute towards the current
 * leg's target on the live map, round anything placed and round robots, waiting for the player,
 * in and out of doors and exits, across the east gate; walkers sharing tiles, walking off-screen
 * and freezing with the game; a whole day on the maps with nothing placed; a big tick equal to its
 * minutes one at a time; and everyone indoors the next morning.
 */
import { describe, expect, it } from 'vitest';
import { INVENTORY, TIME } from '../src/config';
import {
  Direction,
  NPC_IDS,
  TOWNSFOLK_IDS,
  Weather,
  type GameState,
  type MapId,
  type TileCoord,
  type WalkerId,
  type WalkerPlace,
} from '../src/core/types';
import { legsFor, targetOf } from '../src/people/timetable';
import { runWalkersMinute, walkerPlace, walkersIndoors, withWalkerPlace } from '../src/people/walk';
import { runMinutesThrough } from '../src/robots/run';
import { actions } from '../src/state/actions';
import { gameReducer } from '../src/state/reducer';
import { manhattanDistance } from '../src/world/grid';
import { BASE, placesOf, robotOf, tileAt, withPlaces, withPlayer, withRobots, withTile } from './testUtils';

const WALKER_IDS: readonly WalkerId[] = [...NPC_IDS, ...TOWNSFOLK_IDS];

/** A minute of the day: `hour` in 24-hour time. */
const at = (hour: number, minute = 0): number => hour * 60 + minute;

const out = (mapId: MapId, tx: number, tz: number, facing: Direction): WalkerPlace => ({ kind: 'out', mapId, tx, tz, facing });
const INDOORS: WalkerPlace = { kind: 'indoors' };

/** `state` with the clock at `minute` of the same day. */
function atMinute(state: GameState, minute: number): GameState {
  return { ...state, time: { ...state.time, minuteOfDay: minute } };
}

/** Runs the minute loop (robots, then walkers) through `minute`. */
function runTo(state: GameState, minute: number): GameState {
  return runMinutesThrough(state, minute);
}

/** The state after each minute from the one after `state`'s clock through `last`, in order. */
function timeline(state: GameState, last: number): GameState[] {
  const states: GameState[] = [];
  let next = state;
  while (next.time.minuteOfDay < last) {
    next = runMinutesThrough(next, next.time.minuteOfDay + 1);
    states.push(next);
  }
  return states;
}

function tileOf(place: WalkerPlace): TileCoord & { readonly mapId: MapId } {
  if (place.kind !== 'out') throw new Error('expected an out place');
  return { mapId: place.mapId, tx: place.tx, tz: place.tz };
}

const onTile = (place: WalkerPlace, mapId: MapId, tile: TileCoord): boolean =>
  place.kind === 'out' && place.mapId === mapId && place.tx === tile.tx && place.tz === tile.tz;

/** A dry day at 6:00 am on the maps with nothing placed, the player at home on the farm. */
const DRY = BASE;
const WET: GameState = { ...BASE, weather: Weather.Rain };

describe('a step', () => {
  it('takes Sol one tile a minute from his door to the well, facing the way he walks', () => {
    const states = timeline(DRY, at(6, 8));
    expect(walkerPlace(states[0] as GameState, 'sol')).toEqual(out('town', 20, 7, Direction.South));
    const target = { tx: 21, tz: 13 };
    for (let i = 1; i < states.length; i++) {
      const before = tileOf(walkerPlace(states[i - 1] as GameState, 'sol'));
      const place = walkerPlace(states[i] as GameState, 'sol');
      const now = tileOf(place);
      expect(manhattanDistance(before, now)).toBe(1);
      expect(manhattanDistance(now, target)).toBe(manhattanDistance(before, target) - 1);
      const facing = now.tx > before.tx ? Direction.East : now.tx < before.tx ? Direction.West : now.tz > before.tz ? Direction.South : Direction.North;
      expect(place.kind === 'out' && place.facing).toBe(facing);
    }
    expect(onTile(walkerPlace(states.at(-1) as GameState, 'sol'), 'town', target)).toBe(true);
  });

  it('turns to the stop’s facing the minute after arriving, then keeps the same place', () => {
    const arrived = runTo(DRY, at(6, 8));
    expect(walkerPlace(arrived, 'sol')).toEqual(out('town', 21, 13, Direction.South));
    const turned = runTo(arrived, at(6, 9));
    expect(walkerPlace(turned, 'sol')).toEqual(out('town', 21, 13, Direction.West));
    const later = runTo(turned, at(6, 10));
    expect(walkerPlace(later, 'sol')).toBe(walkerPlace(turned, 'sol'));
  });
});

describe('routing round', () => {
  it('re-plans round a chest put down on Tallulah’s route mid-walk', () => {
    // She comes out at 6:30 am, the minute her leg departs.
    const started = runTo(DRY, at(6, 31));
    expect(walkerPlace(started, 'tallulah')).toEqual(out('town', 34, 8, Direction.South));
    const chest = { tx: 34, tz: 10 };
    const blocked = withTile(started, chest, { ...tileAt(started, chest, 'town'), object: { kind: 'chest', slots: new Array<null>(INVENTORY.chestSlots).fill(null) } }, 'town');
    const states = timeline(blocked, at(6, 45));
    for (const state of states) expect(onTile(walkerPlace(state, 'tallulah'), 'town', chest)).toBe(false);
    // Round the chest: six steps where four would do.
    expect(onTile(walkerPlace(states[4] as GameState, 'tallulah'), 'town', { tx: 34, tz: 12 })).toBe(false);
    expect(onTile(walkerPlace(states[5] as GameState, 'tallulah'), 'town', { tx: 34, tz: 12 })).toBe(true);
  });

  it('walks round a robot standing on Cosmo’s route', () => {
    const robot = robotOf({ id: 1, mapId: 'neighbours', owner: 'cosmo', tx: 11, tz: 11, power: 'flat' });
    const state = withRobots(withPlaces(DRY, { cosmo: out('neighbours', 11, 13, Direction.West) }), [robot]);
    const states = timeline(state, at(6, 10));
    for (const s of states) expect(onTile(walkerPlace(s, 'cosmo'), 'neighbours', { tx: 11, tz: 11 })).toBe(false);
    expect(onTile(walkerPlace(states.at(-1) as GameState, 'cosmo'), 'neighbours', { tx: 11, tz: 10 })).toBe(true);
  });
});

describe('the player in the way', () => {
  const inYard = withPlaces(DRY, { cosmo: out('neighbours', 6, 10, Direction.South) });

  it('waits while the player stands in the only way out of Cosmo’s yard, then moves on when they step aside', () => {
    const blocking = withPlayer(inYard, { tx: 6, tz: 12 }, Direction.North, 'neighbours');
    const waiting = runTo(blocking, at(6, 5));
    expect(walkerPlace(waiting, 'cosmo')).toBe(walkerPlace(inYard, 'cosmo'));
    const aside = withPlayer(waiting, { tx: 7, tz: 13 }, Direction.North, 'neighbours');
    const moved = runTo(aside, at(6, 7));
    expect(walkerPlace(moved, 'cosmo')).toEqual(out('neighbours', 6, 12, Direction.South));
  });

  it('stays put, stuck, when even without the player there is no way out', () => {
    const gap = { tx: 6, tz: 12 };
    const shut = withTile(inYard, gap, { ...tileAt(inYard, gap, 'neighbours'), object: { kind: 'chest', slots: new Array<null>(INVENTORY.chestSlots).fill(null) } }, 'neighbours');
    const after = runTo(shut, at(6, 20));
    expect(walkerPlace(after, 'cosmo')).toBe(walkerPlace(inYard, 'cosmo'));
  });
});

describe('doors and exits', () => {
  it('steps Sol in at his door when he goes home on a wet noon, and out again at 12:50 pm', () => {
    const atWork = withPlaces(atMinute(WET, at(11, 59)), { sol: out('town', 21, 7, Direction.South) });
    const front = runTo(atWork, at(12));
    expect(walkerPlace(front, 'sol')).toEqual(out('town', 20, 7, Direction.West));
    const inside = runTo(front, at(12, 1));
    expect(walkerPlace(inside, 'sol')).toEqual(INDOORS);
    expect(walkerPlace(runTo(inside, at(12, 49)), 'sol')).toEqual(INDOORS);
    const outAgain = runTo(inside, at(12, 50));
    expect(walkerPlace(outAgain, 'sol')).toEqual(out('town', 20, 7, Direction.South));
    expect(walkerPlace(runTo(outAgain, at(12, 51)), 'sol')).toEqual(out('town', 21, 7, Direction.East));
  });

  it('keeps Sol in while the player stands in front of his door', () => {
    const onFront = withPlayer(DRY, { tx: 20, tz: 7 }, Direction.North, 'town');
    const waited = runTo(onFront, at(6, 3));
    expect(walkerPlace(waited, 'sol')).toEqual(INDOORS);
    const aside = withPlayer(waited, { tx: 19, tz: 8 }, Direction.North, 'town');
    expect(walkerPlace(runTo(aside, at(6, 4)), 'sol')).toEqual(out('town', 20, 7, Direction.South));
  });

  it('brings the jogger in by the south-west exit at 8:00 am and takes them out by it at 7:00 pm', () => {
    const arrived = runTo(atMinute(DRY, at(7, 59)), at(8));
    expect(walkerPlace(arrived, 'jogger')).toEqual(out('town', 0, 30, Direction.North));

    const evening = withPlaces(atMinute(DRY, at(18, 59)), { jogger: out('town', 3, 22, Direction.West) });
    const states = timeline(evening, at(19, 30));
    const last = states.findIndex((s) => walkerPlace(s, 'jogger').kind === 'indoors');
    expect(last).toBeGreaterThan(0);
    expect(onTile(walkerPlace(states[last - 1] as GameState, 'jogger'), 'town', { tx: 0, tz: 30 })).toBe(true);
    expect(walkerPlace(states.at(-1) as GameState, 'jogger')).toEqual(INDOORS);
  });
});

describe('the east gate', () => {
  /** The minute index where `id` stands on `from` and, the minute after, on `to`. */
  function crossing(states: readonly GameState[], id: WalkerId, from: TileCoord & { readonly mapId: MapId }, to: TileCoord & { readonly mapId: MapId }): number {
    return states.findIndex((s, i) => {
      const next = states[i + 1];
      return next !== undefined && onTile(walkerPlace(s, id), from.mapId, from) && onTile(walkerPlace(next, id), to.mapId, to);
    });
  }

  it('takes Cosmo from the Neighbours (0, 14) to town (38, 16) for lunch, and back through (39, 16) after', () => {
    const morning = timeline(DRY, at(12));
    const there = crossing(morning, 'cosmo', { mapId: 'neighbours', tx: 0, tz: 14 }, { mapId: 'town', tx: 38, tz: 16 });
    expect(there).toBeGreaterThan(-1);
    expect(walkerPlace(morning[there + 1] as GameState, 'cosmo')).toEqual(out('town', 38, 16, Direction.West));

    const afternoon = timeline(morning.at(-1) as GameState, at(14));
    const back = crossing(afternoon, 'cosmo', { mapId: 'town', tx: 39, tz: 16 }, { mapId: 'neighbours', tx: 1, tz: 14 });
    expect(back).toBeGreaterThan(-1);
    expect(walkerPlace(afternoon[back + 1] as GameState, 'cosmo')).toEqual(out('neighbours', 1, 14, Direction.East));
  });

  it('waits at the gate while the player stands on the other side’s arrival tile', () => {
    const atGate = withPlaces(atMinute(DRY, at(11, 30)), { barnaby: out('neighbours', 0, 14, Direction.West) });
    const onArrival = withPlayer(atGate, { tx: 38, tz: 16 }, Direction.West, 'town');
    const waited = runTo(onArrival, at(11, 33));
    expect(walkerPlace(waited, 'barnaby')).toBe(walkerPlace(atGate, 'barnaby'));
    const aside = withPlayer(waited, { tx: 37, tz: 17 }, Direction.West, 'town');
    expect(walkerPlace(runTo(aside, at(11, 34)), 'barnaby')).toEqual(out('town', 38, 16, Direction.West));
  });
});

describe('walkers and the world', () => {
  it('lets two walkers share a tile without blocking each other', () => {
    const busker = out('town', 18, 12, Direction.South);
    const state = withPlaces(atMinute(DRY, at(12, 30)), { busker, marigold: out('town', 18, 11, Direction.South) });
    const shared = runTo(state, at(12, 31));
    expect(walkerPlace(shared, 'marigold')).toEqual(out('town', 18, 12, Direction.South));
    expect(walkerPlace(shared, 'busker')).toBe(busker);
    expect(walkerPlace(runTo(shared, at(12, 32)), 'marigold')).toEqual(out('town', 18, 13, Direction.South));
  });

  it('moves walkers on the town and the Neighbours while the player is on the farm', () => {
    expect(DRY.player.mapId).toBe('farm');
    const next = gameReducer(DRY, actions.tick(1));
    expect(walkerPlace(next, 'sol')).toEqual(out('town', 20, 7, Direction.South));
    expect(walkerPlace(next, 'cosmo')).toEqual(out('neighbours', 5, 5, Direction.South));
  });

  it('moves nobody while a panel is open or the game is paused', () => {
    const panel: GameState = { ...DRY, ui: { ...DRY.ui, panel: { kind: 'inventory' } } };
    expect(gameReducer(panel, actions.tick(30))).toBe(panel);
    const paused: GameState = { ...DRY, ui: { ...DRY.ui, paused: true } };
    expect(gameReducer(paused, actions.tick(30))).toBe(paused);
  });

  it('keeps an unmoved walker’s place object, and the sections when nobody moves', () => {
    const lunch = out('town', 18, 14, Direction.East);
    const state = withPlaces(atMinute(DRY, at(12, 30)), { berlioz: lunch });
    expect(walkerPlace(runWalkersMinute(atMinute(state, at(12, 31))), 'berlioz')).toBe(lunch);

    const night = atMinute(DRY, at(22));
    const still = runWalkersMinute(night);
    expect(still.npcs).toBe(night.npcs);
    expect(still.townsfolk).toBe(night.townsfolk);
  });

  it('sets and reads a place, returning the same state when it’s unchanged', () => {
    const place = out('town', 5, 16, Direction.South);
    const moved = withWalkerPlace(DRY, 'courier', place);
    expect(walkerPlace(moved, 'courier')).toBe(place);
    expect(moved.npcs).toBe(DRY.npcs);
    expect(withWalkerPlace(moved, 'courier', out('town', 5, 16, Direction.South))).toBe(moved);
    expect(withWalkerPlace(DRY, 'sol', INDOORS)).toBe(DRY);
  });
});

describe('the day on the empty maps', () => {
  for (const [name, start, wet] of [
    ['dry', DRY, false],
    ['wet', WET, true],
  ] as const) {
    it(`gets every walker to every stop before their next leg departs on a ${name} day, and home by night`, () => {
      const states = timeline(start, at(21));
      const stateAt = (minute: number): GameState => states[minute - start.time.minuteOfDay - 1] as GameState;
      for (const id of WALKER_IDS) {
        const legs = legsFor(id, wet);
        legs.forEach((leg, i) => {
          if (leg.to.kind === 'home') return;
          const ends = legs[i + 1]?.departs ?? at(21);
          let reached = false;
          for (let minute = Math.max(leg.departs, start.time.minuteOfDay + 1); minute < ends && !reached; minute++) {
            const target = targetOf(id, minute, wet);
            if (target !== 'home' && onTile(walkerPlace(stateAt(minute), id), target.mapId, target.tile)) reached = true;
          }
          expect(reached, `${id}'s leg at minute ${leg.departs}`).toBe(true);
        });
      }
      for (const id of WALKER_IDS) expect(walkerPlace(states.at(-1) as GameState, id), id).toEqual(INDOORS);
    });
  }

  it('has both farmers in the square by 12:14 pm, and all seven characters there from 12:21 to 12:50 pm', () => {
    const states = timeline(DRY, at(12, 50));
    const stateAt = (minute: number): GameState => states[minute - DRY.time.minuteOfDay - 1] as GameState;
    // The last to arrive: Cosmo, 44 steps from (16, 7) at 11:30 am; Barnaby, 49 steps from his
    // field at 11:15 am; Marigold, 17 steps from her shop at 12:00 pm; Tallulah, 21 steps.
    expect(walkerPlace(stateAt(at(12, 14)), 'cosmo')).toMatchObject({ kind: 'out', mapId: 'town', tx: 19, tz: 15 });
    expect(walkerPlace(stateAt(at(12, 14)), 'barnaby')).toMatchObject({ kind: 'out', mapId: 'town', tx: 20, tz: 15 });
    for (let minute = at(12, 21); minute < at(12, 50); minute++) {
      for (const id of NPC_IDS) {
        const target = targetOf(id, minute, false);
        if (target === 'home' || target.facing === null) throw new Error(`${id} has no lunch spot`);
        expect(walkerPlace(stateAt(minute), id), `${id} at minute ${minute}`).toEqual(out(target.mapId, target.tile.tx, target.tile.tz, target.facing));
      }
    }
  });
});

describe('Review Focus 1: a big tick', () => {
  for (const start of [at(6), at(10, 30), at(18, 30)]) {
    it(`from minute ${start}, tick(120) equals 120 one-minute ticks`, () => {
      let from = DRY;
      while (from.time.minuteOfDay < start) from = gameReducer(from, actions.tick(Math.min(TIME.maxTickMinutes, start - from.time.minuteOfDay)));
      expect(from.time.minuteOfDay).toBe(start);
      const big = gameReducer(from, actions.tick(120));
      let small = from;
      for (let i = 0; i < 120; i++) small = gameReducer(small, actions.tick(1));
      expect(placesOf(big)).toEqual(placesOf(small));
      expect(big).toEqual(small);
    });
  }
});

describe('Review Focus 5: the morning', () => {
  const awayAt = (minute: number): GameState =>
    withPlaces(atMinute(DRY, minute), {
      cosmo: out('town', 19, 15, Direction.North),
      barnaby: out('town', 39, 16, Direction.East),
      sol: out('town', 19, 12, Direction.South),
      jogger: out('town', 3, 22, Direction.West),
    });

  it('has everyone indoors after sleeping with Cosmo in town at 12:30 pm and Barnaby on the gate tile', () => {
    const slept = gameReducer(awayAt(at(12, 30)), actions.sleep());
    expect(slept.time.minuteOfDay).toBe(TIME.dayStartMinute);
    for (const id of WALKER_IDS) expect(walkerPlace(slept, id), id).toEqual(INDOORS);
  });

  it('has everyone indoors after passing out with them still out', () => {
    const late = withPlaces(awayAt(TIME.passOutMinute - 2), { barnaby: out('neighbours', 0, 14, Direction.West) });
    const morning = gameReducer(late, actions.tick(5));
    expect(morning.time.minuteOfDay).toBe(TIME.dayStartMinute);
    expect(morning.time.absoluteDay).toBe(late.time.absoluteDay + 1);
    for (const id of WALKER_IDS) expect(walkerPlace(morning, id), id).toEqual(INDOORS);
  });

  it('walkersIndoors keeps the state when everyone is already in', () => {
    expect(walkersIndoors(DRY)).toBe(DRY);
    const away = awayAt(at(12, 30));
    const reset = walkersIndoors(away);
    for (const id of WALKER_IDS) expect(walkerPlace(reset, id)).toEqual(INDOORS);
    expect(reset.npcs.marigold).toBe(away.npcs.marigold);
  });
});
