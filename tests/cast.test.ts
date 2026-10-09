/**
 * The cast (farmclaws part 4a spec §2): names, role lines and looks; the characters' spots on the
 * maps and the startup check over them (one broken definition per rule); `npcAt`; a character's
 * tile blocking movement and placement; and the chat box's action list (spec §3.2). The
 * Neighbours map adds Cosmo's and Barnaby's cases.
 */
import { describe, expect, it } from 'vitest';
import { APPEARANCE } from '../src/config';
import { DIRECTIONS, Direction, MAP_IDS, NPC_IDS, type GameState, type MapId, type NpcId } from '../src/core/types';
import { CAST, CAST_LOOKS, NPC_PROPS, npcActions, npcAt, npcSpot } from '../src/people/cast';
import { actions } from '../src/state/actions';
import { placementProblem } from '../src/state/intents';
import { gameReducer } from '../src/state/reducer';
import { stepTile } from '../src/world/grid';
import { MAPS, assertMapDefinitions, isReservedTile, type MapDefinition, type NpcPlacement } from '../src/world/maps';
import { arrivalTiles } from '../src/world/maps/lookup';
import { isWalkable } from '../src/world/tiles';
import { BASE, holding, reachableFrom, tileAt, withPlayer } from './testUtils';

/** The town's characters as spec §2.1 places them. */
const TOWN_SPOTS: readonly NpcPlacement[] = [
  { id: 'sol', tx: 21, tz: 7, facing: Direction.South },
  { id: 'marigold', tx: 7, tz: 7, facing: Direction.South },
  { id: 'berlioz', tx: 16, tz: 7, facing: Direction.South },
  { id: 'juniper', tx: 24, tz: 7, facing: Direction.South },
  { id: 'tallulah', tx: 35, tz: 7, facing: Direction.South },
];

/** The shipped definitions with the town's characters replaced by `npcs`. */
function withTownNpcs(npcs: readonly NpcPlacement[]): Record<MapId, MapDefinition> {
  return { ...MAPS, town: { ...MAPS.town, npcs } };
}

/** The town's characters with `npc` moved to (tx, tz). */
function moved(npc: NpcId, tx: number, tz: number): readonly NpcPlacement[] {
  return MAPS.town.npcs.map((p) => (p.id === npc ? { ...p, tx, tz } : p));
}

/** The player in town on the tile south of `spot`, facing `facing` (by default, the character). */
function southOf(spot: NpcPlacement, facing: Direction = Direction.North): GameState {
  return withPlayer(BASE, { tx: spot.tx, tz: spot.tz + 1 }, facing, 'town');
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
  it('stands Sol and the shopkeepers in town, facing south, and no one on the farm or in the forest', () => {
    expect(MAPS.town.npcs).toEqual(TOWN_SPOTS);
    expect(MAPS.farm.npcs).toEqual([]);
    expect(MAPS.forest.npcs).toEqual([]);
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

  it('finds each character with npcAt and npcSpot, and no one anywhere else', () => {
    for (const spot of TOWN_SPOTS) {
      expect(npcAt('town', spot.tx, spot.tz)).toBe(spot.id);
      expect(npcSpot(spot.id)).toEqual({ mapId: 'town', placement: spot });
    }
    expect(npcAt('town', 20, 7)).toBeNull();
    expect(npcAt('town', 21, 8)).toBeNull();
    expect(npcAt('town', -1, 7)).toBeNull();
    expect(npcAt('farm', 21, 7)).toBeNull();
    expect(npcAt('forest', 7, 7)).toBeNull();
  });

  it('lists the arrival tiles of a map from every warp into it, in map order', () => {
    expect(arrivalTiles(MAPS, 'farm')).toEqual([
      { tx: 1, tz: 13 },
      { tx: 46, tz: 38 },
    ]);
    expect(arrivalTiles(MAPS, 'town')).toContainEqual({ tx: 1, tz: 16 });
  });
});

describe('the startup check on the characters', () => {
  it('accepts the shipped spots', () => {
    expect(() => assertMapDefinitions(MAPS)).not.toThrow();
  });

  const broken: readonly (readonly [string, Record<MapId, MapDefinition>, string])[] = [
    ['a spot off the map', withTownNpcs(moved('sol', 40, 7)), 'Map town: sol at (40, 7) is out of bounds'],
    ['a spot inside a structure', withTownNpcs(moved('sol', 21, 6)), 'Map town: sol at (21, 6) is not walkable'],
    ['a spot on a door, which is part of its building', withTownNpcs(moved('marigold', 6, 6)), 'Map town: marigold at (6, 6) is not walkable'],
    ['a spot on a reserved tile', withTownNpcs(moved('sol', 1, 16)), 'Map town: sol at (1, 16) is on a reserved tile'],
    [
      'a spot in front of a door',
      withTownNpcs(moved('marigold', 6, 7)),
      'Map town: marigold at (6, 7) is on a door or the tile in front of one',
    ],
    ['two characters on one tile', withTownNpcs(moved('berlioz', 21, 7)), 'Map town: berlioz at (21, 7) shares its tile with sol'],
    [
      'a spot walled in by the other characters',
      withTownNpcs([
        { id: 'sol', tx: 21, tz: 9, facing: Direction.South },
        { id: 'marigold', tx: 20, tz: 9, facing: Direction.South },
        { id: 'berlioz', tx: 22, tz: 9, facing: Direction.South },
        { id: 'juniper', tx: 21, tz: 10, facing: Direction.South },
        { id: 'tallulah', tx: 21, tz: 8, facing: Direction.South },
      ]),
      "Map town: sol at (21, 9) can't be reached from the map's arrival tiles",
    ],
    [
      'a character on two maps',
      { ...MAPS, forest: { ...MAPS.forest, npcs: [{ id: 'sol', tx: 30, tz: 14, facing: Direction.South }] } },
      'Character sol is placed more than once',
    ],
  ];

  it.each(broken)('throws on %s, naming the character', (_name, defs, message) => {
    expect(() => assertMapDefinitions(defs)).toThrow(RangeError);
    expect(() => assertMapDefinitions(defs)).toThrow(new RangeError(message));
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
  it('gives Marigold the Shop button and everyone else none', () => {
    expect(npcActions('marigold')).toEqual([{ kind: 'shop', label: 'Shop' }]);
    for (const id of NPC_IDS) {
      if (id === 'marigold') continue;
      expect(npcActions(id), id).toEqual([]);
      expect(npcActions(id), id).toBe(npcActions('sol'));
    }
    expect(Object.isFrozen(npcActions('sol'))).toBe(true);
    expect(Object.isFrozen(npcActions('marigold'))).toBe(true);
  });
});

/** Cosmo and Barnaby, as spec §2.1 places them on the Neighbours map. */
const NEIGHBOURS_SPOTS: readonly NpcPlacement[] = [
  { id: 'cosmo', tx: 7, tz: 13, facing: Direction.South },
  { id: 'barnaby', tx: 25, tz: 15, facing: Direction.North },
];

describe('the Neighbours cast', () => {
  it('stands Cosmo and Barnaby on the lane by their fields, facing it', () => {
    expect(MAPS.neighbours.npcs).toEqual(NEIGHBOURS_SPOTS);
    for (const spot of NEIGHBOURS_SPOTS) {
      expect(npcAt('neighbours', spot.tx, spot.tz)).toBe(spot.id);
      expect(npcSpot(spot.id)).toEqual({ mapId: 'neighbours', placement: spot });
    }
    expect(npcAt('neighbours', 6, 13)).toBeNull();
    expect(npcAt('town', 7, 13)).toBeNull();
    expect(arrivalTiles(MAPS, 'neighbours')).toEqual([{ tx: 1, tz: 14 }]);
    expect(arrivalTiles(MAPS, 'town')).toEqual([
      { tx: 1, tz: 16 },
      { tx: 38, tz: 16 },
    ]);
  });

  it('places every character on exactly one map', () => {
    for (const id of NPC_IDS) {
      const maps = MAP_IDS.filter((mapId) => MAPS[mapId].npcs.some((p) => p.id === id));
      expect(maps, id).toEqual([npcSpot(id).mapId]);
    }
  });

  it('throws on a character placed on no map, naming them', () => {
    const defs: Record<MapId, MapDefinition> = {
      ...MAPS,
      neighbours: { ...MAPS.neighbours, npcs: MAPS.neighbours.npcs.filter((p) => p.id !== 'barnaby') },
    };
    expect(() => assertMapDefinitions(defs)).toThrow(new RangeError('Character barnaby is placed on no map'));
  });

  it("blocks walking into Cosmo and placing a chest on Barnaby's tile", () => {
    const beside = withPlayer(BASE, { tx: 6, tz: 13 }, Direction.West, 'neighbours');
    expect(gameReducer(beside, actions.move(Direction.East)).player).toEqual({ ...beside.player, facing: Direction.East });
    const facingBarnaby = holding(withPlayer(BASE, { tx: 25, tz: 14 }, Direction.South, 'neighbours'), 'chest');
    expect(placementProblem(facingBarnaby, 'chest', { tx: 25, tz: 15 })).toBe("Someone's standing there.");
    expect(lastText(gameReducer(facingBarnaby, actions.useTool()))).toBe("Someone's standing there.");
  });
});
