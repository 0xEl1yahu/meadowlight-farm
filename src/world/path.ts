/**
 * Map-agnostic breadth-first path search on a tile grid, shared by the robots' routes and the
 * walkers (farmclaws part 4d spec §4.3). Pure.
 */
import { DIRECTIONS, type GridSpec, type TileCoord } from '../core/types';
import { directionStep, inBounds, stepTile } from './grid';

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
 *
 * The same search as `searchFrom`, stopping as soon as the target is reached (every tile on its
 * path is already settled), with its bookkeeping in typed arrays: the walkers run it every minute.
 */
export function findPath(grid: GridSpec, from: TileCoord, to: TileCoord, canStep: CanStep): readonly TileCoord[] | null {
  if (from.tx === to.tx && from.tz === to.tz) return [];
  if (!inBounds(grid, to.tx, to.tz)) return null;
  const { width, depth } = grid;
  const seen = new Uint8Array(width * depth);
  // The queue, in discovery order: each tile and the queue position of the tile it was reached from.
  const xs = new Int32Array(width * depth + 1);
  const zs = new Int32Array(width * depth + 1);
  const ups = new Int32Array(width * depth + 1);
  xs[0] = from.tx;
  zs[0] = from.tz;
  ups[0] = -1;
  if (inBounds(grid, from.tx, from.tz)) seen[from.tz * width + from.tx] = 1;
  let tail = 1;
  for (let head = 0; head < tail; head++) {
    const x = xs[head] ?? 0;
    const z = zs[head] ?? 0;
    let current: TileCoord | null = null;
    for (const direction of DIRECTIONS) {
      const { dx, dz } = directionStep(direction);
      const nx = x + dx;
      const nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= width || nz >= depth || seen[nz * width + nx] === 1) continue;
      current ??= { tx: x, tz: z };
      if (!canStep(current, { tx: nx, tz: nz })) continue;
      seen[nz * width + nx] = 1;
      xs[tail] = nx;
      zs[tail] = nz;
      ups[tail] = head;
      tail++;
      if (nx === to.tx && nz === to.tz) return pathBack(xs, zs, ups, tail - 1);
    }
  }
  return null;
}

/** The tiles from the queue's start (excluded) to position `end` (included), following each tile's way back. */
function pathBack(xs: Int32Array, zs: Int32Array, ups: Int32Array, end: number): readonly TileCoord[] {
  const path: TileCoord[] = [];
  for (let at = end; at > 0; at = ups[at] ?? 0) path.push({ tx: xs[at] ?? 0, tz: zs[at] ?? 0 });
  return path.reverse();
}
