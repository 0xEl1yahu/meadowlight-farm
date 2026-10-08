/**
 * Pure lookups over a MapDefinition, plus the helpers the map modules use to precompute their
 * static masks and to walk their worlds. Kept apart from `index.ts` (which re-exports the
 * lookups) so simulation modules that the generators themselves import (farming/wild.ts) and the
 * map modules themselves can use them without an import cycle.
 */
import { Salt, hash32 } from '../../core/hash';
import { DIRECTIONS, MAP_IDS, type Direction, type GridSpec, type MapId, type TileCoord, type WorldState } from '../../core/types';
import { inBounds, rectContains, stepTile, tileCount, tileIndex } from '../grid';
import { getTile, isWalkable } from '../tiles';
import type { MapDefinition, StructurePlacement, Surface, Warp } from './types';

/**
 * The seed every per-map roll uses in place of the save seed: generation, the overnight
 * DayContext, harvest yield and quality. The farm keeps the save seed, so every farm hash is
 * unchanged; the other maps get their own uncorrelated streams.
 */
export function mapSeed(seed: number, id: MapId): number {
  switch (id) {
    case 'farm':
      return seed;
    case 'forest':
      return hash32(seed, Salt.MapForest);
    case 'town':
      return hash32(seed, Salt.MapTown);
  }
}

/** The warp that stepping `dir` from (tx, tz) triggers, or null. */
export function findWarp(def: MapDefinition, tx: number, tz: number, dir: Direction): Warp | null {
  for (const warp of def.warps) {
    if (warp.from.tx === tx && warp.from.tz === tz && warp.exit === dir) return warp;
  }
  return null;
}

/** Where the warps into map `id` land: every map's warps in MAP_IDS order, each map's in its own order. */
export function arrivalTiles(defs: Readonly<Record<MapId, MapDefinition>>, id: MapId): readonly TileCoord[] {
  const tiles: TileCoord[] = [];
  for (const from of MAP_IDS) {
    for (const warp of defs[from].warps) {
      if (warp.to.mapId === id) tiles.push({ tx: warp.to.tx, tz: warp.to.tz });
    }
  }
  return tiles;
}

/**
 * The tiles a walker reaches from `starts` in orthogonal steps over walkable tiles of `world`,
 * never entering a tile `isClosed` names. A start that is unwalkable or closed reaches nothing.
 * The result answers false out of bounds.
 */
export function reachableTiles(
  world: WorldState,
  starts: readonly TileCoord[],
  isClosed: (tx: number, tz: number) => boolean,
): (tx: number, tz: number) => boolean {
  const { grid } = world;
  const reached = new Uint8Array(tileCount(grid));
  const queue: TileCoord[] = [];
  const visit = (coord: TileCoord): void => {
    const tile = getTile(world, coord.tx, coord.tz);
    if (tile === null || !isWalkable(tile) || isClosed(coord.tx, coord.tz)) return;
    const index = tileIndex(grid, coord.tx, coord.tz);
    if (reached[index] === 1) return;
    reached[index] = 1;
    queue.push(coord);
  };
  starts.forEach(visit);
  for (let head = 0; head < queue.length; head++) {
    const current = queue[head];
    if (current === undefined) break;
    for (const direction of DIRECTIONS) visit(stepTile(current, direction));
  }
  return (tx, tz) => inBounds(grid, tx, tz) && reached[tileIndex(grid, tx, tz)] === 1;
}

export function isReservedTile(def: MapDefinition, tx: number, tz: number): boolean {
  return coordIn(def.reserved, tx, tz);
}

/** The structure whose footprint covers (tx, tz), or null. */
export function structureAt(def: MapDefinition, tx: number, tz: number): StructurePlacement | null {
  for (const structure of def.structures) {
    if (rectContains(structure.rect, tx, tz)) return structure;
  }
  return null;
}

/** Samples `fn` once per tile into a row-major mask; the result answers false out of bounds. */
export function precomputeMask(grid: GridSpec, fn: (tx: number, tz: number) => boolean): (tx: number, tz: number) => boolean {
  const mask = new Uint8Array(grid.width * grid.depth);
  for (let tz = 0; tz < grid.depth; tz++) {
    for (let tx = 0; tx < grid.width; tx++) mask[tileIndex(grid, tx, tz)] = fn(tx, tz) ? 1 : 0;
  }
  return (tx, tz) => inBounds(grid, tx, tz) && mask[tileIndex(grid, tx, tz)] === 1;
}

const SURFACE_CODES: readonly Surface[] = ['grass', 'dirt', 'cobble'];

/** Samples `fn` once per tile into a row-major surface table; 'grass' out of bounds. */
export function precomputeSurfaces(grid: GridSpec, fn: (tx: number, tz: number) => Surface): (tx: number, tz: number) => Surface {
  const codes = new Uint8Array(grid.width * grid.depth);
  for (let tz = 0; tz < grid.depth; tz++) {
    for (let tx = 0; tx < grid.width; tx++) codes[tileIndex(grid, tx, tz)] = SURFACE_CODES.indexOf(fn(tx, tz));
  }
  return (tx, tz) => {
    if (!inBounds(grid, tx, tz)) return 'grass';
    return SURFACE_CODES[codes[tileIndex(grid, tx, tz)] ?? 0] ?? 'grass';
  };
}

/** Is (tx, tz) one of these coordinates? */
export function coordIn(coords: readonly TileCoord[], tx: number, tz: number): boolean {
  return coords.some((c) => c.tx === tx && c.tz === tz);
}
