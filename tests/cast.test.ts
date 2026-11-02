/**
 * The cast (farmclaws part 4a spec §2): names, role lines and looks; their 4a spots, now their
 * places at work (part 4d spec §2); `walkerAt` finding them where they stand; a character's tile
 * blocking movement and placement; and the chat box's action list (spec §3.2). The Neighbours map
 * adds Cosmo's and Barnaby's cases.
 */
import { describe, expect, it } from 'vitest';
import { APPEARANCE } from '../src/config';
import { TIMETABLES } from '../src/config';
import { DIRECTIONS, Direction, NPC_IDS, type GameState, type MapId, type NpcId, type TileCoord } from '../src/core/types';
import { CAST, CAST_LOOKS, NPC_PROPS, npcActions } from '../src/people/cast';
import { walkerAt } from '../src/people/walk';
import { actions } from '../src/state/actions';
import { placementProblem } from '../src/state/intents';
import { gameReducer } from '../src/state/reducer';
import { stepTile } from '../src/world/grid';
import { MAPS, assertMapDefinitions, isReservedTile } from '../src/world/maps';
import { isWalkable } from '../src/world/tiles';
import { BASE, arrivalTiles, holding, reachableFrom, tileAt, withPlayer, withWalkerAt } from './testUtils';

/** A character's 4a spot: where they stand, and which way they face. */
interface Spot extends TileCoord {
  readonly id: NpcId;
  readonly facing: Direction;
}

/** The town's characters as part 4a spec §2.1 placed them: now where each stands at work. */
const TOWN_SPOTS: readonly Spot[] = [
  { id: 'sol', tx: 21, tz: 7, facing: Direction.South },
  { id: 'marigold', tx: 7, tz: 7, facing: Direction.South },
  { id: 'berlioz', tx: 16, tz: 7, facing: Direction.South },
  { id: 'juniper', tx: 24, tz: 7, facing: Direction.South },
  { id: 'tallulah', tx: 35, tz: 7, facing: Direction.South },
];

/** Cosmo and Barnaby, as part 4a spec §2.1 placed them on the Neighbours map: now their evening spots on the lane. */
const NEIGHBOURS_SPOTS: readonly Spot[] = [
  { id: 'cosmo', tx: 7, tz: 13, facing: Direction.South },
  { id: 'barnaby', tx: 25, tz: 15, facing: Direction.North },
];

/** BASE with every character out on their 4a spot. */
const ALL_OUT: GameState = [
  ...TOWN_SPOTS.map((spot) => ['town', spot] as const),
  ...NEIGHBOURS_SPOTS.map((spot) => ['neighbours', spot] as const),
].reduce<GameState>((state, [mapId, spot]) => withWalkerAt(state, spot.id, mapId, spot.tx, spot.tz, spot.facing), BASE);

/** The player in town on the tile south of `spot`, facing `facing` (by default, the character). */
function southOf(spot: Spot, facing: Direction = Direction.North): GameState {
  return withPlayer(ALL_OUT, { tx: spot.tx, tz: spot.tz + 1 }, facing, 'town');
}

/** Whether `id`'s timetable stands them on `spot`, facing its way, on `mapId`. */
function isTimetabled(id: NpcId, mapId: MapId, spot: Spot): boolean {
  return TIMETABLES[id].dry.some(({ to }) => to.kind === 'spot' && to.mapId === mapId && to.tx === spot.tx && to.tz === spot.tz && to.facing === spot.facing);
}

function lastText(state: GameState): string | undefined {
  return state.messages.entries[state.messages.entries.length - 1]?.text;
}

describe('the cast', () => {
  it('names every character with their role line, as the spec writes them', () => {
    expect(CAST).toEqual({
      sol: { name: 'Sol', role: 'Parts exchange' },
      cosmo: { name: 'Cosmo', role: 'Farmer' },
      barnaby: { name: 'Barnaby', role: 'Farmer' },
      marigold: { name: 'Marigold', role: 'General store' },
      berlioz: { name: 'Berlioz', role: 'Blacksmith' },
      juniper: { name: 'Juniper', role: 'Carpenter' },
      tallulah: { name: 'Tallulah', role: 'Ranch' },
    });
    expect(Object.keys(CAST)).toEqual([...NPC_IDS]);
  });

  it('gives each character a look within the appearance ranges and their own prop', () => {
    const ranges = {
      skinTone: APPEARANCE.skinTones,
      hairStyle: APPEARANCE.hairStyles,
      hairColor: APPEARANCE.hairColors,
      shirtColor: APPEARANCE.shirtColors,
      overallsColor: APPEARANCE.overallsColors,
      hat: APPEARANCE.hats,
    } as const;
    for (const id of NPC_IDS) {
      const { appearance } = CAST_LOOKS[id];
      expect(Object.keys(appearance).sort(), id).toEqual(Object.keys(ranges).sort());
      for (const [field, size] of Object.entries(ranges)) {
        const value = appearance[field as keyof typeof ranges];
        expect(Number.isInteger(value) && value >= 0 && value < size, `${id} ${field} = ${value}`).toBe(true);
      }
    }
    expect(NPC_IDS.map((id) => CAST_LOOKS[id].prop)).toEqual([
      'toolApron',
      'featherHat',
      'clipboard',
      'seedPouch',
      'smithApron',
      'pencil',
      'neckerchief',
    ]);
    expect(new Set(NPC_IDS.map((id) => CAST_LOOKS[id].prop)).size).toBe(NPC_PROPS.length);
  });

  it('makes the characters look unlike each other and unlike a new player', () => {
    const shirts = NPC_IDS.map((id) => CAST_LOOKS[id].appearance.shirtColor);
    expect(new Set(shirts).size).toBe(NPC_IDS.length);
    expect(shirts).not.toContain(BASE.profile.appearance.shirtColor);
    // Cosmo's feathered straw hat is his prop, so he wears no hat of the model's own (hat 1;
    // hat 0 is the straw hat the farmer has always worn, Task 8).
    expect(CAST_LOOKS.cosmo.appearance.hat).toBe(1);
  });
});

describe('spots on the map', () => {
  it('stands Sol and the shopkeepers at work on their 4a spots in town, facing south', () => {
    for (const spot of TOWN_SPOTS) expect(isTimetabled(spot.id, 'town', spot), spot.id).toBe(true);
  });

  it('keeps every spot walkable, unreserved, off the door paths and reachable from the gate', () => {
    const town = BASE.maps.town;
    const reachable = reachableFrom(town, { tx: 1, tz: 16 });
    for (const spot of TOWN_SPOTS) {
      expect(isWalkable(tileAt(BASE, spot, 'town')), spot.id).toBe(true);
      expect(isReservedTile(MAPS.town, spot.tx, spot.tz), spot.id).toBe(false);
      for (const s of MAPS.town.structures) {
        if (s.door === null) continue;
        expect([spot.tx, spot.tz], `${spot.id} by the ${s.kind} door`).not.toEqual([s.door.tx, s.door.tz + 1]);
      }
      const neighbours = DIRECTIONS.map((direction) => stepTile(spot, direction));
      expect(neighbours.some((n) => reachable.has(`${n.tx},${n.tz}`)), spot.id).toBe(true);
    }
  });

  it('finds each character with walkerAt, and no one anywhere else', () => {
    for (const spot of TOWN_SPOTS) expect(walkerAt(ALL_OUT, 'town', spot.tx, spot.tz)).toBe(spot.id);
    expect(walkerAt(ALL_OUT, 'town', 20, 7)).toBeNull();
    expect(walkerAt(ALL_OUT, 'town', 21, 8)).toBeNull();
    expect(walkerAt(ALL_OUT, 'town', -1, 7)).toBeNull();
    expect(walkerAt(ALL_OUT, 'farm', 21, 7)).toBeNull();
    expect(walkerAt(ALL_OUT, 'forest', 7, 7)).toBeNull();
  });

  it('lists the arrival tiles of a map from every warp into it, in map order', () => {
    expect(arrivalTiles(MAPS, 'farm')).toEqual([
      { tx: 1, tz: 13 },
      { tx: 46, tz: 38 },
    ]);
    expect(arrivalTiles(MAPS, 'town')).toContainEqual({ tx: 1, tz: 16 });
  });
});

describe('the startup check', () => {
  it('accepts the shipped definitions', () => {
    expect(() => assertMapDefinitions(MAPS)).not.toThrow();
  });
});

describe("a character's tile", () => {
  it('refuses a step onto it silently: the player only turns to face the character', () => {
    for (const spot of TOWN_SPOTS) {
      const sideways = southOf(spot, Direction.East);
      const next = gameReducer(sideways, actions.move(Direction.North));
      expect(next.player, spot.id).toEqual({ ...sideways.player, facing: Direction.North });
      expect(next.messages, spot.id).toBe(sideways.messages);
      // Facing them already, the step changes nothing at all.
      const facing = southOf(spot);
      expect(gameReducer(facing, actions.move(Direction.North)), spot.id).toBe(facing);
    }
    // The tile beside a character is walkable as before.
    const beside = gameReducer(southOf(TOWN_SPOTS[0]!), actions.move(Direction.West));
    expect(beside.player).toMatchObject({ tx: 20, tz: 8, facing: Direction.West });
  });

  it("refuses to place a chest there: Someone's standing there.", () => {
    for (const spot of TOWN_SPOTS) {
      const state = holding(southOf(spot), 'chest');
      expect(placementProblem(state, 'chest', spot), spot.id).toBe("Someone's standing there.");
      const next = gameReducer(state, actions.useTool());
      expect(lastText(next), spot.id).toBe("Someone's standing there.");
      expect(next.maps, spot.id).toBe(state.maps);
      expect(next.inventory, spot.id).toBe(state.inventory);
    }
  });

  it('keeps the farm-only rule first: a sprinkler belongs on the farm', () => {
    const state = holding(southOf(TOWN_SPOTS[0]!), 'sprinkler');
    expect(placementProblem(state, 'sprinkler', TOWN_SPOTS[0]!)).toBe('The sprinkler belongs on your farm.');
  });
});

describe('npcActions', () => {
  /** BASE with every job done, so no character has a job open. */
  const ALL_DONE: GameState = { ...BASE, jobs: { ...BASE.jobs, status: { spinningRobot: 'done', showHim: 'done', knowTheLimits: 'done' } } };

  it("gives Marigold the seed shop, Sol the parts shop, Juniper the workshop and everyone else none", () => {
    expect(npcActions(ALL_DONE, 'marigold')).toEqual([{ kind: 'shop', label: 'Shop' }]);
    expect(npcActions(ALL_DONE, 'sol')).toEqual([{ kind: 'partsShop', label: 'Shop' }]);
    expect(npcActions(ALL_DONE, 'juniper')).toEqual([{ kind: 'workshop', label: 'Workshop' }]);
    for (const id of NPC_IDS) {
      if (id === 'marigold' || id === 'sol' || id === 'juniper') continue;
      expect(npcActions(ALL_DONE, id), id).toEqual([]);
      expect(npcActions(ALL_DONE, id), id).toBe(npcActions(ALL_DONE, 'cosmo'));
    }
    for (const id of NPC_IDS) expect(Object.isFrozen(npcActions(ALL_DONE, id)), id).toBe(true);
  });

  it("puts Job in front of a giver's buttons while their job is open (part 4c spec §2.2)", () => {
    expect(npcActions(BASE, 'sol')).toEqual([{ kind: 'job', label: 'Job' }]);
    expect(npcActions(BASE, 'sol')).toBe(npcActions(BASE, 'sol'));
    expect(Object.isFrozen(npcActions(BASE, 'sol'))).toBe(true);
    expect(npcActions(BASE, 'marigold')).toBe(npcActions(ALL_DONE, 'marigold'));
  });
});

describe('the Neighbours cast', () => {
  it('stands Cosmo and Barnaby on the lane by their fields in the evening, facing it', () => {
    for (const spot of NEIGHBOURS_SPOTS) {
      expect(isTimetabled(spot.id, 'neighbours', spot), spot.id).toBe(true);
      expect(walkerAt(ALL_OUT, 'neighbours', spot.tx, spot.tz)).toBe(spot.id);
    }
    expect(walkerAt(ALL_OUT, 'neighbours', 6, 13)).toBeNull();
    expect(walkerAt(ALL_OUT, 'town', 7, 13)).toBeNull();
    expect(arrivalTiles(MAPS, 'neighbours')).toEqual([{ tx: 1, tz: 14 }]);
    expect(arrivalTiles(MAPS, 'town')).toEqual([
      { tx: 1, tz: 16 },
      { tx: 38, tz: 16 },
    ]);
  });

  it("blocks walking into Cosmo and placing a chest on Barnaby's tile", () => {
    const beside = withPlayer(ALL_OUT, { tx: 6, tz: 13 }, Direction.West, 'neighbours');
    expect(gameReducer(beside, actions.move(Direction.East)).player).toEqual({ ...beside.player, facing: Direction.East });
    const facingBarnaby = holding(withPlayer(ALL_OUT, { tx: 25, tz: 14 }, Direction.South, 'neighbours'), 'chest');
    expect(placementProblem(facingBarnaby, 'chest', { tx: 25, tz: 15 })).toBe("Someone's standing there.");
    expect(lastText(gameReducer(facingBarnaby, actions.useTool()))).toBe("Someone's standing there.");
  });
});
