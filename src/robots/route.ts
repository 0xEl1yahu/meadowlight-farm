/**
 * Routes for `Go to`, `For each tile` and DO return (farmclaws part 2 spec §5.3), on the robot's
 * own map. Pure.
 */
import { invariant } from '../core/invariant';
import { Blocker, DIRECTIONS, type GameState, type Robot, type RobotAction, type TileCoord } from '../core/types';
import { stepTile } from '../world/grid';
import { findPath, searchFrom } from '../world/path';
import { getTile, isWalkable } from '../world/tiles';
import { moveForbiddenBy } from './md';
import { robotWorld } from './world';

/** Whether the robot may stand on `tile`: a walkable tile of its own map that isn't water. */
function standable(state: GameState, robot: Robot, tile: TileCoord): boolean {
  const t = getTile(robotWorld(state, robot), tile.tx, tile.tz);
  return t !== null && isWalkable(t) && t.blocker !== Blocker.Water;
}

/** Whether a route may take one step from `from` to the adjacent tile `to`. */
export function canEnter(state: GameState, robot: Robot, from: TileCoord, to: TileCoord): boolean {
  return standable(state, robot, to) && moveForbiddenBy(robot, from, to, state) === null;
}

/**
 * The shortest walkable path from the robot to `target`, by breadth-first search in DIRECTIONS
 * order, over steps its DON'T cards allow. Excludes the start, includes the target; `[]` when
 * the robot stands on it; null when the target can't be stood on or can't be reached. Other
 * robots never block a route.
 */
export function planRoute(state: GameState, robot: Robot, target: TileCoord): readonly TileCoord[] | null {
  if (!standable(state, robot, target)) return null;
  return findPath(robotWorld(state, robot).grid, robot, target, (from, to) => canEnter(state, robot, from, to));
}

/** Every tile (as `${tx},${tz}`) a route from the robot's tile can reach, that tile included, under the rules `planRoute` uses. */
export function reachableFrom(state: GameState, robot: Robot): ReadonlySet<string> {
  const { parent } = searchFrom(robotWorld(state, robot).grid, robot, (from, to) => canEnter(state, robot, from, to));
  const width = robotWorld(state, robot).grid.width;
  return new Set(Array.from(parent.keys(), (k) => `${k % width},${Math.floor(k / width)}`));
}

/** `move` when the robot faces `next` (an adjacent tile), otherwise the shorter turn toward it (`right` on a tie). */
export function nextRouteAction(robot: Pick<Robot, 'tx' | 'tz' | 'facing'>, next: TileCoord): RobotAction {
  const direction = DIRECTIONS.find((d) => {
    const step = stepTile({ tx: robot.tx, tz: robot.tz }, d);
    return step.tx === next.tx && step.tz === next.tz;
  });
  invariant(direction !== undefined, `nextRouteAction: (${next.tx}, ${next.tz}) isn't next to (${robot.tx}, ${robot.tz})`);
  if (direction === robot.facing) return { kind: 'move' };
  const quarterTurnsRight = (direction - robot.facing + 4) % 4;
  return { kind: 'turn', side: quarterTurnsRight === 3 ? 'left' : 'right' };
}

/**
 * Every tile a route from the robot's tile can reach, with its move count, in breadth-first
 * discovery order (so `steps` never decreases). The robot's own tile comes first, at 0 steps.
 */
export function reachableInOrder(state: GameState, robot: Robot): readonly { readonly tile: TileCoord; readonly steps: number }[] {
  return searchFrom(robotWorld(state, robot).grid, robot, (from, to) => canEnter(state, robot, from, to)).order;
}
