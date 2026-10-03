/**
 * Finding, replacing and placing robots. Robots always live on the farm map.
 */
import { invariant } from '../core/invariant';
import { Blocker, DIRECTIONS, type GameState, type Robot, type Tile, type TileCoord, type WorldState } from '../core/types';
import { withMap } from '../state/selectors';
import { inBounds, stepTile } from '../world/grid';
import { getTile, isWalkable } from '../world/tiles';
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

/** Robots standing on a farm tile (not carried, not on the workbench, not away for repair), lowest id first. */
export function robotsOnTile(state: GameState, tx: number, tz: number): readonly Robot[] {
  return state.robots.list.filter((r) => !r.carried && !r.onBench && r.power !== 'repairing' && r.tx === tx && r.tz === tz);
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

/** `from` when it's walkable, else the nearest walkable tile by breadth-first search in DIRECTIONS order. */
export function nearestWalkable(world: WorldState, from: TileCoord): TileCoord {
  const key = (c: TileCoord): number => c.tz * world.grid.width + c.tx;
  const seen = new Set<number>([key(from)]);
  const queue: TileCoord[] = [from];
  for (let head = 0; head < queue.length; head++) {
    const current = queue[head];
    if (current === undefined) break;
    const tile = getTile(world, current.tx, current.tz);
    if (tile !== null && isWalkable(tile)) return current;
    for (const direction of DIRECTIONS) {
      const next = stepTile(current, direction);
      if (!inBounds(world.grid, next.tx, next.tz) || seen.has(key(next))) continue;
      seen.add(key(next));
      queue.push(next);
    }
  }
  throw new Error('nearestWalkable: the map has no walkable tile');
}
