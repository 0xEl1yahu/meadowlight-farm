/**
 * Crows. Each night, when more than CROWS.minCrops field crops grow on the farm, every living
 * field crop farther than CROWS.scarecrowRadius tiles (Euclidean) from every scarecrow has a
 * CROWS.chance of being eaten, at most CROWS.maxPerNight a night (in row-major order). The
 * rolls hash the map seed, the tile and the day, so they are deterministic.
 */
import { CROWS } from '../config';
import { Salt, hashFloat } from '../core/hash';
import type { CropId, TileCoord, WorldState } from '../core/types';
import { forEachTile, requireTile, setTiles } from '../world/tiles';

export interface CrowRaid {
  readonly world: WorldState;
  /** The crops eaten tonight, in the order they were taken. */
  readonly eaten: readonly CropId[];
}

/** Whether (tx, tz) lies within CROWS.scarecrowRadius of any listed scarecrow. */
export function isProtected(scarecrows: readonly TileCoord[], tx: number, tz: number): boolean {
  const r2 = CROWS.scarecrowRadius * CROWS.scarecrowRadius;
  return scarecrows.some((s) => (s.tx - tx) ** 2 + (s.tz - tz) ** 2 <= r2);
}

export function runCrows(world: WorldState, seed: number, day: number): CrowRaid {
  const scarecrows: TileCoord[] = [];
  const crops: TileCoord[] = [];
  forEachTile(world, (tile, tx, tz) => {
    if (tile.object?.kind === 'scarecrow') scarecrows.push({ tx, tz });
    if (tile.crop !== null && !tile.crop.wild && !tile.crop.dead) crops.push({ tx, tz });
  });
  if (crops.length <= CROWS.minCrops) return { world, eaten: [] };
  // forEachTile walks chunk by chunk; sort row-major so the cap never depends on chunking.
  crops.sort((a, b) => a.tz - b.tz || a.tx - b.tx);
  const victims: TileCoord[] = [];
  for (const c of crops) {
    if (victims.length >= CROWS.maxPerNight) break;
    if (isProtected(scarecrows, c.tx, c.tz)) continue;
    if (hashFloat(seed, c.tx, c.tz, day, Salt.Crow) < CROWS.chance) victims.push(c);
  }
  if (victims.length === 0) return { world, eaten: [] };
  const eaten: CropId[] = [];
  const edits = victims.map(({ tx, tz }) => {
    const tile = requireTile(world, tx, tz);
    if (tile.crop !== null) eaten.push(tile.crop.cropId);
    return { tx, tz, tile: { ...tile, crop: null } };
  });
  return { world: setTiles(world, edits), eaten };
}
