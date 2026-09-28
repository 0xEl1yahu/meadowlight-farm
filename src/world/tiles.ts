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
});

export function blockedTile(blocker: SolidBlocker, hp = 0): Tile {
  return { state: TileState.Blocked, blocker, blockerHp: hp, crop: null };
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

export function isWalkable(tile: Tile): boolean {
  return tile.state !== TileState.Blocked;
}

export function isSoil(tile: Tile): boolean {
  return tile.state === TileState.Plowed || tile.state === TileState.Watered;
}

/** Enforces the Blocked ⇔ blocker ≠ None invariant and the crop placement rules. */
export function assertTileConsistent(tile: Tile): void {
  const blocked = tile.state === TileState.Blocked;
  invariant(blocked === (tile.blocker !== Blocker.None), `tile state ${tile.state} inconsistent with blocker ${tile.blocker}`);
  invariant(
    tile.crop === null || isSoil(tile) || (tile.crop.wild && tile.state === TileState.Unplowed),
    'crops may only exist on plowed or watered soil (wild crops also on grass)',
  );
  invariant(Number.isInteger(tile.blockerHp) && tile.blockerHp >= 0, `invalid blockerHp ${tile.blockerHp}`);
}
