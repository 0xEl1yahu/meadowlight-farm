/**
 * Finding, replacing and placing robots. Each robot lives on its own map, the farm or the
 * Neighbours map (farmclaws part 4c spec §5.1), and every robot rule reads that map through
 * robotWorld.
 */
import { JOBS, ROBOTS } from '../config';
import { invariant } from '../core/invariant';
import { Blocker, DIRECTIONS, type GameState, type Robot, type RobotMapId, type Tile, type TileCoord, type WorldState } from '../core/types';
import { withMap } from '../state/selectors';
import { chebyshevDistance, inBounds, stepTile } from '../world/grid';
import { MAPS, isReservedTile } from '../world/maps';
import { forEachTile, getTile, isWalkable } from '../world/tiles';
import type { Slots } from './bag';

export function findRobot(state: GameState, id: number): Robot | null {
  return state.robots.list.find((robot) => robot.id === id) ?? null;
}

export function requireRobot(state: GameState, id: number): Robot {
  const robot = findRobot(state, id);
  if (robot === null) throw new RangeError(`requireRobot: no robot ${id}`);
  return robot;
}

/** Same object, or every field identical by reference: nothing about the robot changed. */
function sameRobot(a: Robot, b: Robot): boolean {
  if (a === b) return true;
  const keys = Object.keys(a) as (keyof Robot)[];
  return keys.every((key) => a[key] === b[key]);
}

/**
 * `state` with the robot of the same id replaced; `state` itself when nothing about the robot
 * changed, so an unchanged robot always keeps its identity (the render contract).
 */
export function withRobot(state: GameState, robot: Robot): GameState {
  const list = state.robots.list;
  const index = list.findIndex((r) => r.id === robot.id);
  invariant(index !== -1, `withRobot: no robot ${robot.id}`);
  const current = list[index];
  if (current !== undefined && sameRobot(current, robot)) return state;
  const next = list.slice();
  next[index] = robot;
  return { ...state, robots: { ...state.robots, list: next } };
}

export function withFarm(state: GameState, world: WorldState): GameState {
  return withMap(state, 'farm', world);
}

/** The world of the map the robot lives on. */
export function robotWorld(state: GameState, robot: Pick<Robot, 'mapId'>): WorldState {
  return state.maps[robot.mapId];
}

/** `state` with the world of the robot's map replaced; `state` itself when the world is unchanged. */
export function withRobotWorld(state: GameState, robot: Pick<Robot, 'mapId'>, world: WorldState): GameState {
  return withMap(state, robot.mapId, world);
}

/** Robots standing on a tile of `mapId` (not carried, not on the workbench, not away for repair), lowest id first. */
export function robotsOnTile(state: GameState, mapId: RobotMapId, tx: number, tz: number): readonly Robot[] {
  return state.robots.list.filter((r) => r.mapId === mapId && !r.carried && !r.onBench && r.power !== 'repairing' && r.tx === tx && r.tz === tz);
}

/**
 * The generators a robot charges from and a DO return heads for, in tile order (by row, then
 * column): the farm's wood burners for the player's robots; for a neighbour's robot, its owner's
 * wood burner at JOBS.generators when one stands there (part 4c spec §5.1).
 */
export function generatorTiles(state: GameState, robot: Pick<Robot, 'mapId' | 'owner'>): readonly TileCoord[] {
  const world = robotWorld(state, robot);
  if (robot.owner !== 'player') {
    const at = JOBS.generators[robot.owner];
    return getTile(world, at.tx, at.tz)?.object?.kind === 'woodBurner' ? [at] : [];
  }
  const burners: TileCoord[] = [];
  forEachTile(world, (tile, tx, tz) => {
    if (tile.object?.kind === 'woodBurner') burners.push({ tx, tz });
  });
  return burners.sort((a, b) => a.tz - b.tz || a.tx - b.tx);
}

export type ContainerKind = 'chest' | 'bin';

export function containerOf(tile: Tile | null): ContainerKind | null {
  if (tile === null) return null;
  if (tile.object !== null && tile.object.kind === 'chest') return 'chest';
  return tile.blocker === Blocker.ShippingBin ? 'bin' : null;
}

export function chestSlots(tile: Tile | null): Slots {
  return tile !== null && tile.object !== null && tile.object.kind === 'chest' ? tile.object.slots : [];
}

/**
 * `from` when it `fits`, else the nearest tile that does, by breadth-first search over in-bounds
 * tiles in DIRECTIONS order (passing through any tile). Null when none fits.
 */
function nearestFittingOrNull(world: WorldState, from: TileCoord, fits: (tile: Tile, at: TileCoord) => boolean): TileCoord | null {
  const key = (c: TileCoord): number => c.tz * world.grid.width + c.tx;
  const seen = new Set<number>([key(from)]);
  const queue: TileCoord[] = [from];
  for (let head = 0; head < queue.length; head++) {
    const current = queue[head];
    if (current === undefined) break;
    const tile = getTile(world, current.tx, current.tz);
    if (tile !== null && fits(tile, current)) return current;
    for (const direction of DIRECTIONS) {
      const next = stepTile(current, direction);
      if (!inBounds(world.grid, next.tx, next.tz) || seen.has(key(next))) continue;
      seen.add(key(next));
      queue.push(next);
    }
  }
  return null;
}

/** nearestFittingOrNull, throwing `failure` when no tile fits. */
function nearestFitting(world: WorldState, from: TileCoord, fits: (tile: Tile, at: TileCoord) => boolean, failure: string): TileCoord {
  const found = nearestFittingOrNull(world, from, fits);
  if (found === null) throw new Error(failure);
  return found;
}

/** `from` when it's walkable, else the nearest walkable tile by breadth-first search in DIRECTIONS order. */
export function nearestWalkable(world: WorldState, from: TileCoord): TileCoord {
  return nearestFitting(world, from, isWalkable, 'nearestWalkable: the map has no walkable tile');
}

/**
 * The nearest walkable tile of `mapId` to `from` with no standing robot on it but `selfId` (part
 * 3 spec §3.1): where a repaired robot is dropped off, and where the morning reset moves a robot
 * whose tile stopped being walkable.
 */
export function nearestFreeWalkable(state: GameState, mapId: RobotMapId, from: TileCoord, selfId: number): TileCoord {
  const free = (tile: Tile, at: TileCoord): boolean => isWalkable(tile) && robotsOnTile(state, mapId, at.tx, at.tz).every((r) => r.id === selfId);
  return nearestFitting(state.maps[mapId], from, free, 'nearestFreeWalkable: the map has no free walkable tile');
}

/**
 * The tile of `mapId` nearest `generator`, within ROBOTS.chargeRadius of it, where a robot can be
 * set down: walkable, not reserved, not a character's spot, with no standing robot on it but
 * `selfId`. Where a neighbour drags a flat robot back to overnight; null when every such tile is
 * taken.
 */
export function freeSpotInReach(state: GameState, mapId: RobotMapId, generator: TileCoord, selfId: number): TileCoord | null {
  const def = MAPS[mapId];
  const free = (tile: Tile, at: TileCoord): boolean =>
    chebyshevDistance(at, generator) <= ROBOTS.chargeRadius &&
    isWalkable(tile) &&
    !isReservedTile(def, at.tx, at.tz) &&
    !def.npcs.some((p) => p.tx === at.tx && p.tz === at.tz) &&
    robotsOnTile(state, mapId, at.tx, at.tz).every((r) => r.id === selfId);
  return nearestFittingOrNull(state.maps[mapId], generator, free);
}
