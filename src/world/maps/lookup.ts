/**
 * Pure lookups over a MapDefinition, plus the helpers the map modules use to precompute their
 * static masks. Kept apart from `index.ts` (which re-exports the lookups) so simulation modules
 * that the generators themselves import (farming/wild.ts) can use them without an import cycle.
 */
import { Salt, hash32 } from '../../core/hash';
import type { Direction, GridSpec, MapId, TileCoord } from '../../core/types';
import { inBounds, rectContains, tileIndex } from '../grid';
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
