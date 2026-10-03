/**
 * Routes for `Go to`, `For each tile` and DO return (farmclaws part 2 spec §5.3). Pure.
 */
import { invariant } from '../core/invariant';
import { Blocker, DIRECTIONS, type GameState, type Robot, type RobotAction, type TileCoord } from '../core/types';
import { inBounds, stepTile } from '../world/grid';
import { getTile, isWalkable } from '../world/tiles';
import { moveForbiddenBy } from './md';

/** Whether a robot may stand on (`tx`, `tz`): a walkable farm tile that isn't water. */
function standable(state: GameState, tile: TileCoord): boolean {
  const t = getTile(state.maps.farm, tile.tx, tile.tz);
  return t !== null && isWalkable(t) && t.blocker !== Blocker.Water;
}

/** Whether a route may take one step from `from` to the adjacent tile `to`. */
export function canEnter(state: GameState, robot: Robot, from: TileCoord, to: TileCoord): boolean {
  return standable(state, to) && moveForbiddenBy(robot, from, to, state) === null;
}

/** Breadth-first search from the robot's tile in DIRECTIONS order: each reached tile's parent (null for the start). */
function search(
  state: GameState,
  robot: Robot,
): { readonly parent: Map<number, TileCoord | null>; readonly key: (c: TileCoord) => number; readonly order: readonly { readonly tile: TileCoord; readonly steps: number }[] } {
  const grid = state.maps.farm.grid;
  const key = (c: TileCoord): number => c.tz * grid.width + c.tx;
  const parent = new Map<number, TileCoord | null>([[key(robot), null]]);
  const queue: TileCoord[] = [{ tx: robot.tx, tz: robot.tz }];
  const order: { readonly tile: TileCoord; readonly steps: number }[] = [{ tile: queue[0] as TileCoord, steps: 0 }];
  for (let head = 0; head < queue.length; head++) {
    const current = queue[head];
    const here = order[head];
    if (current === undefined || here === undefined) break;
    for (const direction of DIRECTIONS) {
      const next = stepTile(current, direction);
      if (!inBounds(grid, next.tx, next.tz) || parent.has(key(next)) || !canEnter(state, robot, current, next)) continue;
      parent.set(key(next), current);
      queue.push(next);
      order.push({ tile: next, steps: here.steps + 1 });
    }
  }
  return { parent, key, order };
}

/**
 * The shortest walkable path from the robot to `target`, by breadth-first search in DIRECTIONS
 * order, over steps its DON'T cards allow. Excludes the start, includes the target; `[]` when
 * the robot stands on it; null when the target can't be stood on or can't be reached. Other
 * robots never block a route.
 */
export function planRoute(state: GameState, robot: Robot, target: TileCoord): readonly TileCoord[] | null {
  if (!standable(state, target)) return null;
  if (robot.tx === target.tx && robot.tz === target.tz) return [];
  const { parent, key } = search(state, robot);
  if (!parent.has(key(target))) return null;
  const path: TileCoord[] = [];
  for (let back: TileCoord = target; back.tx !== robot.tx || back.tz !== robot.tz; ) {
    path.push(back);
    const up = parent.get(key(back));
    invariant(up !== undefined && up !== null, 'planRoute: broken parent chain');
    back = up;
  }
  return path.reverse();
}

/** Every tile (as `${tx},${tz}`) a route from the robot's tile can reach, that tile included, under the rules `planRoute` uses. */
export function reachableFrom(state: GameState, robot: Robot): ReadonlySet<string> {
  const { parent } = search(state, robot);
  const width = state.maps.farm.grid.width;
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
  return search(state, robot).order;
}
