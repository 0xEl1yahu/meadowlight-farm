/**
 * The walk (farmclaws part 4d spec §4.2, §4.3, §4.5, §4.7): one tile a minute towards the current
 * leg's target on the live map, round anything placed and round robots, waiting for the player,
 * in and out of doors and exits, across the east gate; walkers sharing tiles, walking off-screen
 * and freezing with the game; a whole day on the maps with nothing placed; a big tick equal to its
 * minutes one at a time; and everyone indoors the next morning.
 */
import { describe, expect, it } from 'vitest';
import { INVENTORY, JOBS, ROBOTS, TIME } from '../src/config';
import {
  DIRECTIONS,
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
import { LINE_BANKS, STUCK_LINE, lineFor } from '../src/people/lines';
import { farmerStops, legsFor, targetOf } from '../src/people/timetable';
import { isStuck, nudgeWalkersOff, runWalkersMinute, walkerAt, walkerPlace, walkersIndoors, withWalkerPlace } from '../src/people/walk';
import { runMinutesThrough } from '../src/robots/run';
import { freeSpotInReach } from '../src/robots/world';
import { actions } from '../src/state/actions';
import { placementProblem } from '../src/state/intents';
import { isValidGameState } from '../src/state/persistence';
import { gameReducer } from '../src/state/reducer';
import { chebyshevDistance, manhattanDistance, stepTile } from '../src/world/grid';
import { getTile, isWalkable } from '../src/world/tiles';
import { BASE, emptyHanded, holding, placesOf, robotOf, tileAt, withPlaces, withPlayer, withRobots, withTile } from './testUtils';

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

/** `state` with the player on the first free walkable tile next to `tile` (in DIRECTIONS order), facing it. */
function standBeside(state: GameState, tile: TileCoord & { readonly mapId: MapId }): GameState {
  for (const way of DIRECTIONS) {
    const step = stepTile(tile, way);
    const stand = { tx: 2 * tile.tx - step.tx, tz: 2 * tile.tz - step.tz };
    const ground = getTile(state.maps[tile.mapId], stand.tx, stand.tz);
    if (ground !== null && isWalkable(ground) && walkerAt(state, tile.mapId, stand.tx, stand.tz) === null) return withPlayer(state, stand, way, tile.mapId);
  }
  throw new Error(`standBeside: no free tile next to (${tile.tx}, ${tile.tz})`);
}

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

  it('walks up to the player standing in the only way out of Cosmo’s yard, waits, then moves on when they step aside', () => {
    const blocking = withPlayer(inYard, { tx: 6, tz: 12 }, Direction.North, 'neighbours');
    const waiting = runTo(blocking, at(6, 5));
    expect(walkerPlace(waiting, 'cosmo')).toEqual(out('neighbours', 6, 11, Direction.South));
    const aside = withPlayer(waiting, { tx: 7, tz: 13 }, Direction.North, 'neighbours');
    const moved = runTo(aside, at(6, 6));
    expect(walkerPlace(moved, 'cosmo')).toEqual(out('neighbours', 6, 12, Direction.South));
  });

  it('walks up next to the player standing on Sol’s stop, never onto them, and steps on once they leave', () => {
    const well = { tx: 21, tz: 13 };
    const onStop = withPlayer(DRY, well, Direction.North, 'town');
    const states = timeline(onStop, at(6, 20));
    for (const state of states) expect(onTile(walkerPlace(state, 'sol'), 'town', well)).toBe(false);
    const waiting = states.at(-1) as GameState;
    const beside = tileOf(walkerPlace(waiting, 'sol'));
    expect(manhattanDistance(beside, well)).toBe(1);
    expect(walkerPlace(states.at(-2) as GameState, 'sol')).toBe(walkerPlace(waiting, 'sol'));
    const aside = withPlayer(waiting, { tx: 23, tz: 15 }, Direction.North, 'town');
    expect(onTile(walkerPlace(runTo(aside, at(6, 21)), 'sol'), 'town', well)).toBe(true);
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

  it('has both farmers in the square by 12:00 pm, and all seven characters there from 12:25 to 12:50 pm', () => {
    const states = timeline(DRY, at(12, 50));
    const stateAt = (minute: number): GameState => states[minute - DRY.time.minuteOfDay - 1] as GameState;
    expect(walkerPlace(stateAt(at(12)), 'cosmo')).toMatchObject({ kind: 'out', mapId: 'town', tx: 19, tz: 15 });
    expect(walkerPlace(stateAt(at(12)), 'barnaby')).toMatchObject({ kind: 'out', mapId: 'town', tx: 20, tz: 15 });
    for (let minute = at(12, 25); minute < at(12, 50); minute++) {
      for (const id of NPC_IDS) {
        const target = targetOf(id, minute, false);
        if (target === 'home' || target.facing === null) throw new Error(`${id} has no lunch spot`);
        expect(walkerPlace(stateAt(minute), id), `${id} at minute ${minute}`).toEqual(out(target.mapId, target.tile.tx, target.tile.tz, target.facing));
      }
    }
  });

  it('gets Barnaby to each of his three pace spots during his morning field leg', () => {
    const states = timeline(DRY, at(11, 5));
    for (const spot of [
      { tx: 30, tz: 18 },
      { tx: 30, tz: 22 },
      { tx: 19, tz: 20 },
    ]) {
      expect(states.some((s) => onTile(walkerPlace(s, 'barnaby'), 'neighbours', spot)), `(${spot.tx}, ${spot.tz})`).toBe(true);
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

describe('walkerAt', () => {
  it('finds a walker mid-walk on their tile and map, and nobody anywhere else', () => {
    const walking = runTo(DRY, at(6, 4));
    const sol = tileOf(walkerPlace(walking, 'sol'));
    expect(manhattanDistance(sol, { tx: 20, tz: 7 })).toBe(3);
    expect(walkerAt(walking, 'town', sol.tx, sol.tz)).toBe('sol');
    expect(walkerAt(walking, 'town', 20, 7)).toBeNull();
    expect(walkerAt(walking, 'farm', sol.tx, sol.tz)).toBeNull();
    expect(walkerAt(walking, 'town', -1, 7)).toBeNull();
    // Indoors is off the map: Marigold's 4a spot is empty before she comes out.
    expect(walkerAt(walking, 'town', 7, 7)).toBeNull();
  });

  it('gives the first walker on a shared tile: characters before townsfolk, each in id order', () => {
    const shared = withPlaces(DRY, {
      kid: out('town', 18, 12, Direction.South),
      busker: out('town', 18, 12, Direction.South),
      marigold: out('town', 18, 12, Direction.East),
      sol: out('town', 18, 12, Direction.West),
    });
    expect(walkerAt(shared, 'town', 18, 12)).toBe('sol');
    expect(walkerAt(withPlaces(shared, { sol: INDOORS, marigold: INDOORS }), 'town', 18, 12)).toBe('busker');
  });
});

describe('a walker’s tile and the player', () => {
  const walking = runTo(DRY, at(6, 4));
  const sol = tileOf(walkerPlace(walking, 'sol'));
  /** The player beside Sol, facing him. */
  const beside = standBeside(walking, sol);

  it('refuses the player’s step onto it: they only turn to face the walker', () => {
    const way = beside.player.facing;
    const sideways = { ...beside, player: { ...beside.player, facing: way === Direction.North ? Direction.East : Direction.North } };
    expect(gameReducer(sideways, actions.move(way)).player).toEqual({ ...sideways.player, facing: way });
    const busker = withPlaces(beside, { sol: INDOORS, busker: out('town', sol.tx, sol.tz, Direction.South) });
    expect(gameReducer(busker, actions.move(way))).toBe(busker);
  });

  it("refuses to place anything on it: Someone's standing there.", () => {
    const placing = holding(beside, 'chest');
    expect(placementProblem(placing, 'chest', sol)).toBe("Someone's standing there.");
    const refused = gameReducer(placing, actions.useTool());
    expect(refused.maps).toBe(placing.maps);
    expect(refused.messages.entries.at(-1)?.text).toBe("Someone's standing there.");
  });
});

describe('Review Focus 4: a chest on a stop', () => {
  const lunch = { tx: 18, tz: 13 };
  /** Marigold on her way to lunch, one step from her spot. */
  const nearly = runTo(DRY, at(12, 15));
  const chest = { ...tileAt(nearly, lunch, 'town'), object: { kind: 'chest' as const, slots: new Array<null>(INVENTORY.chestSlots).fill(null) } };
  const blocked = withTile(nearly, lunch, chest, 'town');
  const beside = tileOf(walkerPlace(blocked, 'marigold'));

  it('stops Marigold beside it, stuck, and keeps her still for the next 30 minutes', () => {
    expect(manhattanDistance(beside, lunch)).toBe(1);
    expect(isStuck(nearly, 'marigold')).toBe(false);
    const states = timeline(blocked, at(12, 45));
    expect(states).toHaveLength(30);
    for (const state of states) {
      expect(walkerPlace(state, 'marigold'), `${state.time.minuteOfDay}`).toBe(walkerPlace(blocked, 'marigold'));
      expect(isStuck(state, 'marigold')).toBe(true);
    }
  });

  it('opens her chat with the stuck line, after her introduction', () => {
    const facing = emptyHanded(standBeside(blocked, beside));
    expect(walkerAt(facing, 'town', beside.tx, beside.tz)).toBe('marigold');
    expect(isStuck(facing, 'marigold')).toBe(true);
    const first = gameReducer(facing, actions.interact());
    expect(first.ui.panel).toEqual({ kind: 'talk', npc: 'marigold', line: LINE_BANKS.marigold.introduction, card: 'line' });
    const second = gameReducer(gameReducer(first, actions.closePanel()), actions.interact());
    expect(second.ui.panel).toEqual({ kind: 'talk', npc: 'marigold', line: "Someone's put something in my way. I'll wait.", card: 'line' });
    expect(STUCK_LINE).toBe("Someone's put something in my way. I'll wait.");
  });

  it('is not stuck while only the player is in the way, indoors, or at the target', () => {
    const well = { tx: 21, tz: 13 };
    const onStop = withPlayer(DRY, well, Direction.North, 'town');
    const waiting = runTo(onStop, at(6, 20));
    expect(walkerPlace(waiting, 'sol').kind).toBe('out');
    expect(isStuck(waiting, 'sol')).toBe(false);
    expect(isStuck(DRY, 'sol')).toBe(false);
    expect(isStuck(runTo(DRY, at(6, 9)), 'sol')).toBe(false);
  });

  it('is stuck behind a chest in the only way out, and says so', () => {
    const inYard = withPlaces(DRY, { cosmo: out('neighbours', 6, 10, Direction.South) });
    const gap = { tx: 6, tz: 12 };
    const shut = withTile(inYard, gap, { ...tileAt(inYard, gap, 'neighbours'), object: { kind: 'chest', slots: new Array<null>(INVENTORY.chestSlots).fill(null) } }, 'neighbours');
    expect(isStuck(inYard, 'cosmo')).toBe(false);
    expect(isStuck(shut, 'cosmo')).toBe(true);
    const talked: GameState = { ...shut, npcs: { ...shut.npcs, cosmo: { ...shut.npcs.cosmo, talks: 1 } } };
    expect(lineFor(talked, 'cosmo')).toBe(STUCK_LINE);
  });
});

describe('a generator placed under a walker', () => {
  it('moves Barnaby off (26, 15) to the nearest free tile when job 3 is taken', () => {
    const gen = JOBS.generators.barnaby;
    expect(gen).toEqual({ tx: 26, tz: 15 });
    const offered: GameState = { ...DRY, jobs: { ...DRY.jobs, status: { spinningRobot: 'done', showHim: 'done', knowTheLimits: 'offered' } } };
    const onGen = withPlayer(withPlaces(offered, { barnaby: out('neighbours', gen.tx, gen.tz, Direction.North) }), { tx: gen.tx, tz: gen.tz - 1 }, Direction.South, 'neighbours');
    const chat = gameReducer(onGen, actions.interact());
    expect(chat.ui.panel).toMatchObject({ kind: 'talk', npc: 'barnaby' });
    const taken = gameReducer(gameReducer(chat, actions.npcAct('barnaby', 'job')), actions.takeJob('knowTheLimits'));
    expect(taken.jobs.status.knowTheLimits).toBe('active');
    expect(tileAt(taken, gen, 'neighbours').object?.kind).toBe('woodBurner');
    const moved = walkerPlace(taken, 'barnaby');
    const now = tileOf(moved);
    expect(now.mapId).toBe('neighbours');
    expect(manhattanDistance(now, gen)).toBe(1);
    expect(now).not.toEqual({ mapId: 'neighbours', tx: gen.tx, tz: gen.tz - 1 });
    expect(isWalkable(tileAt(taken, now, 'neighbours'))).toBe(true);
    expect(isValidGameState(taken)).toBe(true);
  });

  it('leaves the walkers alone when nobody stands on the tile', () => {
    expect(nudgeWalkersOff(DRY, 'neighbours', JOBS.generators.barnaby)).toBe(DRY);
    const elsewhere = withPlaces(DRY, { barnaby: out('neighbours', 25, 15, Direction.North) });
    expect(nudgeWalkersOff(elsewhere, 'neighbours', JOBS.generators.barnaby)).toBe(elsewhere);
  });

  it('moves every walker on the tile, never onto another walker or a robot', () => {
    const gen = JOBS.generators.barnaby;
    const crowd = withRobots(
      withPlaces(DRY, {
        barnaby: out('neighbours', gen.tx, gen.tz, Direction.North),
        cosmo: out('neighbours', gen.tx, gen.tz, Direction.West),
        sol: out('neighbours', gen.tx, gen.tz - 1, Direction.West),
      }),
      [robotOf({ id: 1, mapId: 'neighbours', owner: 'barnaby', tx: gen.tx + 1, tz: gen.tz })],
    );
    const nudged = nudgeWalkersOff(crowd, 'neighbours', gen);
    const barnaby = tileOf(walkerPlace(nudged, 'barnaby'));
    const cosmo = tileOf(walkerPlace(nudged, 'cosmo'));
    for (const tile of [barnaby, cosmo]) {
      expect(tile).not.toEqual({ mapId: 'neighbours', ...gen });
      expect(tile).not.toEqual({ mapId: 'neighbours', tx: gen.tx, tz: gen.tz - 1 });
      expect(tile).not.toEqual({ mapId: 'neighbours', tx: gen.tx + 1, tz: gen.tz });
    }
    expect(barnaby).not.toEqual(cosmo);
    expect(walkerPlace(nudged, 'sol')).toBe(walkerPlace(crowd, 'sol'));
  });
});

describe('4c’s drag-back', () => {
  it('never picks a farmer’s stop beside Barnaby’s generator, even with every other tile in reach taken', () => {
    const gen = JOBS.generators.barnaby;
    const stops = farmerStops('neighbours');
    const inReach = stops.filter((stop) => chebyshevDistance(stop, gen) <= ROBOTS.chargeRadius);
    expect(inReach.length).toBeGreaterThan(0);
    let state = DRY;
    const picked: TileCoord[] = [];
    for (let id = 1; ; id++) {
      const spot = freeSpotInReach(state, 'neighbours', gen, 0);
      if (spot === null) break;
      picked.push(spot);
      state = withRobots(state, [...state.robots.list, robotOf({ id, mapId: 'neighbours', owner: 'barnaby', tx: spot.tx, tz: spot.tz })]);
    }
    expect(picked.length).toBeGreaterThan(0);
    for (const spot of picked) expect(stops.some((stop) => stop.tx === spot.tx && stop.tz === spot.tz), `${spot.tx},${spot.tz}`).toBe(false);
  });
});
