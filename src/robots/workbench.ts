/**
 * The workbench (farmclaws part 3 spec §2.1–2.2): where it stands, where it goes when its home
 * tile is built on, which robot is on it, and the free ground near it where robots and job 1's
 * bed are placed. Pure.
 */
import { invariant } from '../core/invariant';
import { Blocker, DIRECTIONS, TileState, type GameState, type Robot, type Tile, type TileCoord, type WorldState } from '../core/types';
import { inBounds, stepTile } from '../world/grid';
import { MAPS, isReservedTile } from '../world/maps';
import { EMPTY_TILE, forEachTile, getTile, isWalkable, setTile } from '../world/tiles';

/** The farm's workbench tile, or null when there is none (only while a save is being migrated). */
export function workbenchTile(farm: WorldState): TileCoord | null {
  let found: TileCoord | null = null;
  forEachTile(farm, (tile, tx, tz) => {
    if (found === null && tile.object?.kind === 'workbench') found = { tx, tz };
  });
  return found;
}

/**
 * Ground a workbench can go on: walkable, with no object, crop or fertiliser (an object never
 * sits on fertilised soil), and not a reserved tile.
 */
function isFreeGround(tile: Tile, tx: number, tz: number): boolean {
  return isWalkable(tile) && tile.object === null && tile.crop === null && tile.fertilizer === null && !isReservedTile(MAPS.farm, tx, tz);
}

/**
 * The first farm tile, breadth-first from `from` over in-bounds tiles in DIRECTIONS order (passing
 * through any tile), for which `fits` holds; null when none does. Tiles are keyed by row.
 */
function nearestOnFarm(farm: WorldState, from: TileCoord, fits: (at: TileCoord, key: (c: TileCoord) => number) => boolean): TileCoord | null {
  const key = (c: TileCoord): number => c.tz * farm.grid.width + c.tx;
  const seen = new Set<number>([key(from)]);
  const queue: TileCoord[] = [from];
  for (let head = 0; head < queue.length; head++) {
    const current = queue[head];
    if (current === undefined) break;
    if (fits(current, key)) return current;
    for (const direction of DIRECTIONS) {
      const next = stepTile(current, direction);
      if (!inBounds(farm.grid, next.tx, next.tz) || seen.has(key(next))) continue;
      seen.add(key(next));
      queue.push(next);
    }
  }
  return null;
}

/**
 * `from` when it is free, else the nearest free farm tile: breadth-first over in-bounds tiles in
 * DIRECTIONS order, passing through any tile. A tile in `taken` (robots, the player) is never free.
 */
export function freeSpotNear(farm: WorldState, from: TileCoord, taken: readonly TileCoord[]): TileCoord {
  const blocked = new Set(taken.map((c) => c.tz * farm.grid.width + c.tx));
  const spot = nearestOnFarm(farm, from, (at, key) => {
    const tile = getTile(farm, at.tx, at.tz);
    return tile !== null && !blocked.has(key(at)) && isFreeGround(tile, at.tx, at.tz);
  });
  if (spot === null) throw new Error('freeSpotNear: the farm has no free tile');
  return spot;
}

/** Plain grass with nothing on it: untilled, no blocker, object or crop, and not a reserved tile. */
function isFreeGrass(tile: Tile, tx: number, tz: number): boolean {
  return tile.state === TileState.Unplowed && tile.blocker === Blocker.None && isFreeGround(tile, tx, tz);
}

/**
 * The corner (lowest tx and tz) of the `size` × `size` block of free grass nearest `from`, searched
 * like freeSpotNear with each tile as a corner (farmclaws part 4c spec §3.1): every tile of the
 * block lies on the farm, is free grass (isFreeGrass) and isn't in `taken` (robots). Null when the
 * farm has no such block.
 */
export function findFreeBlock(farm: WorldState, from: TileCoord, size: number, taken: readonly TileCoord[]): TileCoord | null {
  const blocked = new Set(taken.map((c) => c.tz * farm.grid.width + c.tx));
  return nearestOnFarm(farm, from, (corner, key) => {
    for (let dz = 0; dz < size; dz++) {
      for (let dx = 0; dx < size; dx++) {
        const at = { tx: corner.tx + dx, tz: corner.tz + dz };
        const tile = getTile(farm, at.tx, at.tz);
        if (tile === null || blocked.has(key(at)) || !isFreeGrass(tile, at.tx, at.tz)) return false;
      }
    }
    return true;
  });
}

/** `farm` with the workbench on `at`, which must be free ground; the tile becomes plain grass under it. */
export function withWorkbenchAt(farm: WorldState, at: TileCoord): WorldState {
  const tile = getTile(farm, at.tx, at.tz);
  invariant(tile !== null && isFreeGround(tile, at.tx, at.tz), `withWorkbenchAt: (${at.tx}, ${at.tz}) is not free ground`);
  return setTile(farm, at.tx, at.tz, { ...EMPTY_TILE, object: { kind: 'workbench' } });
}

/** The robot on the bench, or null. */
export function robotOnBench(state: GameState): Robot | null {
  return state.robots.list.find((robot) => robot.onBench) ?? null;
}
