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

/**
 * The shortest walkable path from the robot to `target`, by breadth-first search in DIRECTIONS
 * order, over steps its DON'T cards allow. Excludes the start, includes the target; `[]` when
 * the robot stands on it; null when the target can't be stood on or can't be reached. Other
 * robots never block a route.
 */
export function planRoute(state: GameState, robot: Robot, target: TileCoord): readonly TileCoord[] | null {
  if (!standable(state, target)) return null;
  if (robot.tx === target.tx && robot.tz === target.tz) return [];
  const grid = state.maps.farm.grid;
  const key = (c: TileCoord): number => c.tz * grid.width + c.tx;
  const parent = new Map<number, TileCoord | null>([[key(robot), null]]);
  const queue: TileCoord[] = [{ tx: robot.tx, tz: robot.tz }];
  for (let head = 0; head < queue.length; head++) {
    const current = queue[head];
    if (current === undefined) break;
    for (const direction of DIRECTIONS) {
      const next = stepTile(current, direction);
      if (!inBounds(grid, next.tx, next.tz) || parent.has(key(next)) || !canEnter(state, robot, current, next)) continue;
      parent.set(key(next), current);
      if (next.tx === target.tx && next.tz === target.tz) {
        const path: TileCoord[] = [next];
        for (let back = current; back.tx !== robot.tx || back.tz !== robot.tz; ) {
          path.push(back);
          const up = parent.get(key(back));
          invariant(up !== undefined && up !== null, 'planRoute: broken parent chain');
          back = up;
        }
        return path.reverse();
      }
      queue.push(next);
    }
  }
  return null;
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
