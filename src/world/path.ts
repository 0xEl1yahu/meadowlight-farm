/**
 * Map-agnostic breadth-first path search on a tile grid, shared by the robots' routes and the
 * walkers (farmclaws part 4d spec §4.3). Pure.
 */
import { invariant } from '../core/invariant';
import { DIRECTIONS, type GridSpec, type TileCoord } from '../core/types';
import { inBounds, stepTile } from './grid';

/** Whether one step from `from` to the adjacent tile `to` is allowed. */
export type CanStep = (from: TileCoord, to: TileCoord) => boolean;

/** What a search from one tile reached: each tile's parent (null for the start) and every tile in discovery order. */
export interface Search {
  readonly parent: Map<number, TileCoord | null>;
  readonly key: (c: TileCoord) => number;
  readonly order: readonly { readonly tile: TileCoord; readonly steps: number }[];
}

/** Breadth-first search from `from` in DIRECTIONS order over the steps `canStep` allows. */
export function searchFrom(grid: GridSpec, from: TileCoord, canStep: CanStep): Search {
  const key = (c: TileCoord): number => c.tz * grid.width + c.tx;
  const start: TileCoord = { tx: from.tx, tz: from.tz };
  const parent = new Map<number, TileCoord | null>([[key(start), null]]);
  const queue: TileCoord[] = [start];
  const order: { readonly tile: TileCoord; readonly steps: number }[] = [{ tile: start, steps: 0 }];
  for (let head = 0; head < queue.length; head++) {
    const current = queue[head];
    const here = order[head];
    if (current === undefined || here === undefined) break;
    for (const direction of DIRECTIONS) {
      const next = stepTile(current, direction);
      if (!inBounds(grid, next.tx, next.tz) || parent.has(key(next)) || !canStep(current, next)) continue;
      parent.set(key(next), current);
      queue.push(next);
      order.push({ tile: next, steps: here.steps + 1 });
    }
  }
  return { parent, key, order };
}

/**
 * The shortest path from `from` to `to`, by breadth-first search in DIRECTIONS order over the
 * steps `canStep` allows. Excludes the start, includes the target; `[]` when they are the same
 * tile; null when the target can't be reached.
 */
export function findPath(grid: GridSpec, from: TileCoord, to: TileCoord, canStep: CanStep): readonly TileCoord[] | null {
  if (from.tx === to.tx && from.tz === to.tz) return [];
  const { parent, key } = searchFrom(grid, from, canStep);
  if (!parent.has(key(to))) return null;
  const path: TileCoord[] = [];
  for (let back: TileCoord = to; back.tx !== from.tx || back.tz !== from.tz; ) {
    path.push(back);
    const up = parent.get(key(back));
    invariant(up !== undefined && up !== null, 'findPath: broken parent chain');
    back = up;
  }
  return path.reverse();
}
