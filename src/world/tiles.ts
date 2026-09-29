/**
 * Immutable tile storage with per-chunk structural sharing.
 *
 * Writing one tile copies exactly one chunk's tile array (≤ chunkSize² entries) and the
 * chunk list; every other chunk keeps its identity. Render systems therefore detect dirty
 * chunks with `next.chunks[i] !== prev.chunks[i]`, and dirty tiles within a chunk with
 * `next.tiles[j] !== prev.tiles[j]`.
 */
import { invariant } from '../core/invariant';
import {
  Blocker,
  TileState,
  type Chunk,
  type GridSpec,
  type PlacedObject,
  type SolidBlocker,
  type Tile,
  type WorldState,
} from '../core/types';
import { chunkCount, chunkRectByIndex, inBounds, locateTile } from './grid';

export const EMPTY_TILE: Tile = Object.freeze({
  state: TileState.Unplowed,
  blocker: Blocker.None,
  blockerHp: 0,
  crop: null,
  object: null,
  fertilizer: null,
});

export function blockedTile(blocker: SolidBlocker, hp = 0): Tile {
  return { state: TileState.Blocked, blocker, blockerHp: hp, crop: null, object: null, fertilizer: null };
}

/** Builds a world by sampling `tileAt` for every tile, chunk by chunk. */
export function createWorld(grid: GridSpec, tileAt: (tx: number, tz: number) => Tile): WorldState {
  const chunks: Chunk[] = [];
  for (let index = 0; index < chunkCount(grid); index++) {
    const rect = chunkRectByIndex(grid, index);
    const tiles: Tile[] = [];
    for (let lz = 0; lz < rect.depth; lz++) {
      for (let lx = 0; lx < rect.width; lx++) {
        tiles.push(tileAt(rect.x0 + lx, rect.z0 + lz));
      }
    }
    chunks.push({ ...rect, tiles, revision: 0 });
  }
  return { grid, chunks };
}

/** Tile at (tx, tz), or null when out of bounds. */
export function getTile(world: WorldState, tx: number, tz: number): Tile | null {
  if (!inBounds(world.grid, tx, tz)) return null;
  const loc = locateTile(world.grid, tx, tz);
  const chunk = world.chunks[loc.chunkIndex];
  invariant(chunk !== undefined, `chunk ${loc.chunkIndex} missing`);
  const tile = chunk.tiles[loc.localIndex];
  invariant(tile !== undefined, `tile (${tx}, ${tz}) missing from chunk ${loc.chunkIndex}`);
  return tile;
}

export function requireTile(world: WorldState, tx: number, tz: number): Tile {
  const tile = getTile(world, tx, tz);
  if (tile === null) throw new RangeError(`requireTile: (${tx}, ${tz}) is out of bounds`);
  return tile;
}

/** Returns a new world with one tile replaced; returns `world` itself when nothing changes. */
export function setTile(world: WorldState, tx: number, tz: number, tile: Tile): WorldState {
  const loc = locateTile(world.grid, tx, tz);
  const chunk = world.chunks[loc.chunkIndex];
  invariant(chunk !== undefined, `chunk ${loc.chunkIndex} missing`);
  if (chunk.tiles[loc.localIndex] === tile) return world;
  assertTileConsistent(tile);
  const tiles = chunk.tiles.slice();
  tiles[loc.localIndex] = tile;
  const chunks = world.chunks.slice();
  chunks[loc.chunkIndex] = { ...chunk, tiles, revision: chunk.revision + 1 };
  return { ...world, chunks };
}

export function updateTile(world: WorldState, tx: number, tz: number, update: (tile: Tile) => Tile): WorldState {
  return setTile(world, tx, tz, update(requireTile(world, tx, tz)));
}

/**
 * Maps every tile. Chunks where `fn` returns the same reference for every tile are kept as-is,
 * and the world itself is returned unchanged when no tile changed.
 */
export function mapTiles(world: WorldState, fn: (tile: Tile, tx: number, tz: number) => Tile): WorldState {
  let chunks: Chunk[] | null = null;
  for (let ci = 0; ci < world.chunks.length; ci++) {
    const chunk = world.chunks[ci];
    invariant(chunk !== undefined, `chunk ${ci} missing`);
    let tiles: Tile[] | null = null;
    for (let i = 0; i < chunk.tiles.length; i++) {
      const tile = chunk.tiles[i];
      invariant(tile !== undefined, `chunk ${ci} tile ${i} missing`);
      const lz = Math.floor(i / chunk.width);
      const next = fn(tile, chunk.x0 + (i - lz * chunk.width), chunk.z0 + lz);
      if (next !== tile) {
        assertTileConsistent(next);
        tiles ??= chunk.tiles.slice();
        tiles[i] = next;
      }
    }
    if (tiles !== null) {
      chunks ??= world.chunks.slice();
      chunks[ci] = { ...chunk, tiles, revision: chunk.revision + 1 };
    }
  }
  return chunks === null ? world : { ...world, chunks };
}

export function forEachTile(world: WorldState, fn: (tile: Tile, tx: number, tz: number) => void): void {
  for (const chunk of world.chunks) {
    for (let i = 0; i < chunk.tiles.length; i++) {
      const tile = chunk.tiles[i];
      if (tile === undefined) continue;
      const lz = Math.floor(i / chunk.width);
      fn(tile, chunk.x0 + (i - lz * chunk.width), chunk.z0 + lz);
    }
  }
}

export function countTiles(world: WorldState, predicate: (tile: Tile) => boolean): number {
  let count = 0;
  forEachTile(world, (tile) => {
    if (predicate(tile)) count++;
  });
  return count;
}

/** Paths are the only placed objects the player can walk over. */
export function isPathObject(object: PlacedObject): boolean {
  return object.kind === 'woodPath' || object.kind === 'stonePath';
}

export function isWalkable(tile: Tile): boolean {
  return tile.state !== TileState.Blocked && (tile.object === null || isPathObject(tile.object));
}

export function isSoil(tile: Tile): boolean {
  return tile.state === TileState.Plowed || tile.state === TileState.Watered;
}

/** Blockers that take several hits to clear and count them down in `blockerHp`. */
export function isHittableBlocker(blocker: Blocker): boolean {
  return blocker === Blocker.Rock || blocker === Blocker.Stump || blocker === Blocker.Tree;
}

/**
 * Enforces the per-tile invariants in O(1) (chest contents are not scanned):
 * - Blocked ⇔ blocker ≠ None;
 * - crops only on plowed or watered soil (wild crops also on grass);
 * - blockerHp is a non-negative integer, and positive only for Rock, Stump and Tree;
 * - a placed object excludes blockers and crops, and a path lies on grass without fertiliser;
 * - fertiliser only on plowed or watered soil without an object.
 */
export function assertTileConsistent(tile: Tile): void {
  const blocked = tile.state === TileState.Blocked;
  invariant(blocked === (tile.blocker !== Blocker.None), `tile state ${tile.state} inconsistent with blocker ${tile.blocker}`);
  invariant(
    tile.crop === null || isSoil(tile) || (tile.crop.wild && tile.state === TileState.Unplowed),
    'crops may only exist on plowed or watered soil (wild crops also on grass)',
  );
  invariant(Number.isInteger(tile.blockerHp) && tile.blockerHp >= 0, `invalid blockerHp ${tile.blockerHp}`);
  invariant(
    tile.blockerHp === 0 || isHittableBlocker(tile.blocker),
    `blockerHp ${tile.blockerHp} on blocker ${tile.blocker}, which takes no hits`,
  );
  const object = tile.object;
  if (object !== null) {
    invariant(tile.blocker === Blocker.None, `placed ${object.kind} on a tile with blocker ${tile.blocker}`);
    invariant(tile.crop === null, `placed ${object.kind} on a tile with a crop`);
    if (isPathObject(object)) {
      invariant(tile.state === TileState.Unplowed, `${object.kind} on tile state ${tile.state}; paths lie on grass`);
      invariant(tile.fertilizer === null, `${object.kind} on fertilised soil`);
    }
  }
  if (tile.fertilizer !== null) {
    invariant(isSoil(tile), `${tile.fertilizer} fertiliser on tile state ${tile.state}; only soil holds fertiliser`);
    invariant(object === null, `${tile.fertilizer} fertiliser under a placed ${object?.kind ?? ''}`);
  }
}

/** Side length of the square every giant crop covers. */
export const GIANT_CROP_SIZE = 3;

/**
 * World-level placed-object checks (the save validator and tests use it): every giant crop
 * covers exactly its 3×3 footprint. The footprint lies inside the grid, all nine tiles hold an
 * equal object (same kind, crop and anchor), and no tile outside it names that anchor.
 */
export function assertWorldObjectsConsistent(world: WorldState): void {
  const { grid } = world;
  const last = GIANT_CROP_SIZE - 1;
  /** Anchor tile index → number of tiles naming that anchor. */
  const named = new Map<number, number>();
  forEachTile(world, (tile, tx, tz) => {
    const object = tile.object;
    if (object === null || object.kind !== 'giantCrop') return;
    const { anchorTx: ax, anchorTz: az } = object;
    invariant(
      Number.isInteger(ax) && Number.isInteger(az) && inBounds(grid, ax, az) && inBounds(grid, ax + last, az + last),
      `giant crop at (${tx}, ${tz}): footprint anchored at (${ax}, ${az}) leaves the grid`,
    );
    invariant(
      tx >= ax && tx <= ax + last && tz >= az && tz <= az + last,
      `giant crop at (${tx}, ${tz}) lies outside the footprint it names at (${ax}, ${az})`,
    );
    const key = az * grid.width + ax;
    named.set(key, (named.get(key) ?? 0) + 1);
    if (tx !== ax || tz !== az) return;
    for (let dz = 0; dz <= last; dz++) {
      for (let dx = 0; dx <= last; dx++) {
        const other = requireTile(world, ax + dx, az + dz).object;
        invariant(
          other !== null &&
            other.kind === 'giantCrop' &&
            other.cropId === object.cropId &&
            other.anchorTx === ax &&
            other.anchorTz === az,
          `giant crop anchored at (${ax}, ${az}) does not cover (${ax + dx}, ${az + dz})`,
        );
      }
    }
  });
  for (const [key, count] of named) {
    const ax = key % grid.width;
    const az = Math.floor(key / grid.width);
    invariant(
      count === GIANT_CROP_SIZE * GIANT_CROP_SIZE,
      `giant crop anchored at (${ax}, ${az}) covers ${count} tiles instead of ${GIANT_CROP_SIZE * GIANT_CROP_SIZE}`,
    );
  }
}
