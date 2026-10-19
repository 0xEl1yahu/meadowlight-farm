/**
 * Save version 10 (farmclaws part 4d spec §9): the v9 → v10 migration of the tiles part 4d changes.
 * The town's prop tiles become buildings, Cosmo's door front loses its fence and the chicken run
 * gains its own; anything a v9 save left on those tiles moves to the nearest free tile of its map
 * (spec §7.4), and so does anything shut inside the run or left on a town exit.
 */
import { describe, expect, it } from 'vitest';
import { INVENTORY } from '../src/config';
import { Blocker, Direction, SAVE_VERSION, type GameState, type MapId, type Tile, type TileCoord } from '../src/core/types';
import { deserializeGame, migrateSave } from '../src/state/persistence';
import { rectContains } from '../src/world/grid';
import { CHICKEN_RUN, COSMO_DOOR_GAP, ringInside, ringTiles } from '../src/world/maps/neighbours';
import { TOWN_EXITS } from '../src/world/maps/town';
import { EMPTY_TILE, blockedTile, isWalkable, requireTile } from '../src/world/tiles';
import saveV2Text from './fixtures/save-v2.json?raw';
import {
  BASE,
  must,
  reachableFrom,
  robotOf,
  savedTileAt,
  setSavedTile,
  stack,
  tileAt,
  townPropTiles,
  v9Save,
  withPlayer,
  withRobots,
  type SaveJson,
} from './testUtils';

const key = (tx: number, tz: number): string => `${tx},${tz}`;
const load = (save: SaveJson): GameState | null => deserializeGame(JSON.stringify(save));

const FENCE: Tile = { ...EMPTY_TILE, object: { kind: 'woodFence' } };
const RUN = ringInside(CHICKEN_RUN);

/** A chest holding `items` in its first slots. */
function chestTile(...items: ReturnType<typeof stack>[]): Tile {
  const slots = Array.from({ length: INVENTORY.chestSlots }, (_, i) => items[i] ?? null);
  return { ...EMPTY_TILE, object: { kind: 'chest', slots } };
}

/** A v9 save of `state` with these tiles as a v9 save could hold them. */
function v9With(state: GameState, tiles: readonly (readonly [MapId, TileCoord, Tile])[]): SaveJson {
  const save = v9Save(state);
  for (const [mapId, at, tile] of tiles) setSavedTile(save, mapId, at, tile);
  return save;
}

/** Every chest on `mapId`, by tile. */
function chestsOn(state: GameState, mapId: MapId): Map<string, Tile> {
  const found = new Map<string, Tile>();
  const world = state.maps[mapId];
  for (let tz = 0; tz < world.grid.depth; tz++) {
    for (let tx = 0; tx < world.grid.width; tx++) {
      const tile = requireTile(world, tx, tz);
      if (tile.object?.kind === 'chest') found.set(key(tx, tz), tile);
    }
  }
  return found;
}

describe('save version 10', () => {
  it('is the current version, and new games start in it', () => {
    expect(SAVE_VERSION).toBe(10);
    expect(BASE.version).toBe(10);
  });

  it('migrates a v9 save to version 10, and back to the same state', () => {
    const save = v9Save(BASE);
    expect((migrateSave(save) as SaveJson).version).toBe(10);
    expect(must(load(save))).toEqual(BASE);
  });

  it('v9Save opens the props and the run and fences Cosmo’s door front, as version 9 held them', () => {
    const save = v9Save(BASE);
    for (const at of townPropTiles()) expect(savedTileAt(save, 'town', at), key(at.tx, at.tz)).toEqual(EMPTY_TILE);
    expect(savedTileAt(save, 'neighbours', COSMO_DOOR_GAP)).toEqual(FENCE);
    for (const at of ringTiles(CHICKEN_RUN)) expect(savedTileAt(save, 'neighbours', at), key(at.tx, at.tz)).toEqual(EMPTY_TILE);
  });

  it('migrates the version-2 fixture through every version to 10', () => {
    const loaded = must(deserializeGame(saveV2Text));
    expect(loaded.version).toBe(10);
    for (const at of townPropTiles()) expect(tileAt(loaded, at, 'town')).toEqual(blockedTile(Blocker.Building));
    expect(loaded.maps.neighbours).toEqual(BASE.maps.neighbours);
  });

  it('leaves a save from a later version for the validator to reject', () => {
    const save = { ...v9Save(BASE), version: 11 };
    expect(migrateSave(save)).toBe(save);
    expect(load(save)).toBeNull();
  });

  it('leaves a v9 save with a malformed map for the validator to reject', () => {
    const save = v9Save(BASE);
    const broken = { ...save, maps: { ...(save.maps as SaveJson), town: 'gone' } };
    expect(load(broken)).toBeNull();
  });
});

describe('v9 → v10: the town', () => {
  it('blocks every prop tile, keeping each chunk’s revision', () => {
    const loaded = must(load(v9Save(BASE)));
    for (const at of townPropTiles()) expect(tileAt(loaded, at, 'town'), key(at.tx, at.tz)).toEqual(blockedTile(Blocker.Building));
    expect(loaded.maps.town.chunks.map((c) => c.revision)).toEqual(BASE.maps.town.chunks.map((c) => c.revision));
  });

  it('moves a chest on a prop tile to the nearest free tile, with its items', () => {
    const chest = chestTile(stack('wood', 40), stack('parsnip', 3, 2));
    const loaded = must(load(v9With(BASE, [['town', { tx: 9, tz: 9 }, chest]])));
    expect(tileAt(loaded, { tx: 9, tz: 9 }, 'town')).toEqual(blockedTile(Blocker.Building));
    expect(tileAt(loaded, { tx: 9, tz: 8 }, 'town')).toEqual(chest);
    expect([...chestsOn(loaded, 'town').keys()]).toEqual([key(9, 8)]);
  });

  it('never moves two things onto one tile, nor onto the player', () => {
    const player = withPlayer(BASE, { tx: 9, tz: 8 }, Direction.South, 'town');
    const first = chestTile(stack('wood', 1));
    const second = chestTile(stack('stone', 2));
    const loaded = must(load(v9With(player, [['town', { tx: 9, tz: 9 }, first], ['town', { tx: 9, tz: 11 }, second]])));
    // (9, 8) is the player's, so the first goes south to (9, 10), and the second, from (9, 11), past it to (9, 12).
    expect(tileAt(loaded, { tx: 9, tz: 10 }, 'town')).toEqual(first);
    expect(tileAt(loaded, { tx: 9, tz: 12 }, 'town')).toEqual(second);
    expect(tileAt(loaded, { tx: 9, tz: 8 }, 'town').object).toBeNull();
    expect(loaded.player).toEqual(player.player);
  });

  it('moves the player off a prop tile', () => {
    const save = v9Save(withPlayer(BASE, { tx: 1, tz: 16 }, Direction.North, 'town'));
    save.player = { ...(save.player as SaveJson), tx: 9, tz: 9 };
    const loaded = must(load(save));
    expect(loaded.player).toMatchObject({ mapId: 'town', tx: 9, tz: 8, facing: Direction.North });
  });

  it('moves anything on an exit off it', () => {
    const chest = chestTile(stack('wood', 5));
    const loaded = must(load(v9With(BASE, TOWN_EXITS.map((exit) => ['town', exit, chest] as const))));
    for (const exit of TOWN_EXITS) expect(tileAt(loaded, exit, 'town'), key(exit.tx, exit.tz)).toEqual(EMPTY_TILE);
    expect([...chestsOn(loaded, 'town').keys()].sort()).toEqual([key(0, 29), key(39, 29)]);
  });
});

describe('v9 → v10: the Neighbours', () => {
  it("opens Cosmo's door front and fences the chicken run", () => {
    const save = v9Save(BASE);
    expect(savedTileAt(save, 'neighbours', COSMO_DOOR_GAP)).toEqual(FENCE);
    const loaded = must(load(save));
    expect(tileAt(loaded, COSMO_DOOR_GAP, 'neighbours')).toEqual(EMPTY_TILE);
    for (const at of ringTiles(CHICKEN_RUN)) expect(tileAt(loaded, at, 'neighbours'), key(at.tx, at.tz)).toEqual(FENCE);
    expect(loaded.maps.neighbours).toEqual(BASE.maps.neighbours);
  });

  it('moves a chest on the ring, or shut inside the run, out to free ground the player can reach', () => {
    const onRing = chestTile(stack('wood', 7));
    const inside = chestTile(stack('stone', 9));
    const loaded = must(load(v9With(BASE, [['neighbours', { tx: 13, tz: 5 }, onRing], ['neighbours', { tx: 13, tz: 6 }, inside]])));
    expect(tileAt(loaded, { tx: 13, tz: 5 }, 'neighbours')).toEqual(FENCE);
    expect(tileAt(loaded, { tx: 13, tz: 6 }, 'neighbours')).toEqual(EMPTY_TILE);
    const chests = chestsOn(loaded, 'neighbours');
    expect([...chests.values()].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))).toEqual(
      [onRing, inside].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    );
    const reach = reachableFrom(loaded.maps.neighbours, { tx: 1, tz: 14 });
    for (const at of chests.keys()) {
      const [tx, tz] = at.split(',').map(Number) as [number, number];
      expect(rectContains(RUN, tx, tz), at).toBe(false);
      // A chest isn't walkable, so check that the player can stand next to it.
      expect([[0, -1], [1, 0], [0, 1], [-1, 0]].some(([dx, dz]) => reach.has(key(tx + (dx ?? 0), tz + (dz ?? 0)))), at).toBe(true);
    }
  });

  it("keeps a player-placed fence on the ring, and moves a chest off Cosmo's door front", () => {
    const chest = chestTile(stack('wood', 3));
    const loaded = must(load(v9With(BASE, [['neighbours', { tx: 11, tz: 5 }, FENCE], ['neighbours', COSMO_DOOR_GAP, chest]])));
    expect(tileAt(loaded, { tx: 11, tz: 5 }, 'neighbours')).toEqual(FENCE);
    expect(tileAt(loaded, COSMO_DOOR_GAP, 'neighbours')).toEqual(EMPTY_TILE);
    expect(chestsOn(loaded, 'neighbours').size).toBe(1);
    expect(isWalkable(tileAt(loaded, COSMO_DOOR_GAP, 'neighbours'))).toBe(true);
  });

  it("moves the player and a neighbour's robot out of the run", () => {
    const b1 = robotOf({ id: 3, name: 'B-1', mapId: 'neighbours', owner: 'barnaby', tx: 20, tz: 14 });
    const state = withPlayer(withRobots(BASE, [b1]), { tx: 20, tz: 13 }, Direction.North, 'neighbours');
    const save = v9Save(state);
    save.player = { ...(save.player as SaveJson), tx: 13, tz: 6 };
    const robots = save.robots as { list: SaveJson[] };
    robots.list = robots.list.map((robot) => ({ ...robot, tx: 12, tz: 8 }));
    const loaded = must(load(save));
    const robot = must(loaded.robots.list[0]);
    for (const at of [loaded.player, robot]) {
      expect(rectContains(RUN, at.tx, at.tz), key(at.tx, at.tz)).toBe(false);
      expect(isWalkable(tileAt(loaded, at, 'neighbours')), key(at.tx, at.tz)).toBe(true);
    }
    expect(key(robot.tx, robot.tz)).not.toBe(key(loaded.player.tx, loaded.player.tz));
    expect(loaded.player.mapId).toBe('neighbours');
  });
});
