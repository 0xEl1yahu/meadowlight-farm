/**
 * Wild shade crops. Mushrooms and snozberries are never sown: overnight they sprout by
 * themselves on empty shaded grass and spread to shaded neighbours of mature plants. Like
 * everything in the simulation this is a pure function of the world, the seed and the day.
 */
import { SHADE } from '../config';
import { Salt, hash32, hashFloat } from '../core/hash';
import { TileState, type CropId, type GridSpec, type Tile, type WorldState } from '../core/types';
import { DIRECTION_STEPS } from '../world/grid';
import { isShadedTile } from '../world/shade';
import { countTiles, getTile, mapTiles } from '../world/tiles';
import { createCropInstance, isMature, shadeCropsInSeason, stageCount, CROPS } from './crops';
import type { DayContext } from './growth';

/** A tile a wild crop could sprout on: shaded grass holding nothing. */
export function canSproutWild(grid: GridSpec, tile: Tile, tx: number, tz: number): boolean {
  return tile.state === TileState.Unplowed && tile.crop === null && isShadedTile(grid, tx, tz);
}

/** Mature wild neighbours (orthogonal) whose crop can grow this season, as crop ids. */
function matureWildNeighbours(world: WorldState, tx: number, tz: number, allowed: readonly CropId[]): CropId[] {
  const found: CropId[] = [];
  for (const { dx, dz } of DIRECTION_STEPS) {
    const crop = getTile(world, tx + dx, tz + dz)?.crop;
    if (crop && crop.wild && isMature(crop) && allowed.includes(crop.cropId)) found.push(crop.cropId);
  }
  return found;
}

/**
 * One night of sprouting and spreading. Neighbours are read from the incoming world (not the
 * partially updated one), so the result does not depend on iteration order beyond the
 * population cap, which is applied in row-major order.
 */
export function spreadWildCrops(world: WorldState, ctx: DayContext): WorldState {
  const allowed = shadeCropsInSeason(ctx.season).map((def) => def.id);
  if (allowed.length === 0) return world;
  let population = countTiles(world, (tile) => tile.crop !== null && tile.crop.wild);
  if (population >= SHADE.maxWild) return world;

  return mapTiles(world, (tile, tx, tz) => {
    if (population >= SHADE.maxWild || !canSproutWild(world.grid, tile, tx, tz)) return tile;
    const neighbours = matureWildNeighbours(world, tx, tz, allowed);
    const chance = SHADE.sproutChance + SHADE.spreadChancePerNeighbor * neighbours.length;
    if (hashFloat(ctx.seed, tx, tz, ctx.day, Salt.Wild) >= chance) return tile;
    const pool = neighbours.length > 0 ? neighbours : allowed;
    const cropId = pool[hash32(ctx.seed, tx, tz, ctx.day, Salt.WildPick) % pool.length];
    if (cropId === undefined) return tile;
    population++;
    return { ...tile, crop: createCropInstance(cropId, ctx.day, true) };
  });
}

/**
 * The wild crop (if any) a brand-new farm starts with on an empty shaded tile, at a random
 * growth stage so the first morning already has a few ready to forage.
 */
export function initialWildCrop(seed: number, day: number, allowed: readonly CropId[], tx: number, tz: number): Tile['crop'] {
  if (allowed.length === 0 || hashFloat(seed, tx, tz, Salt.Wild) >= SHADE.initialDensity) return null;
  const cropId = allowed[hash32(seed, tx, tz, Salt.WildPick) % allowed.length];
  if (cropId === undefined) return null;
  const stage = hash32(seed, tz, tx, Salt.WildPick) % (stageCount(CROPS[cropId]) + 1);
  return { ...createCropInstance(cropId, day, true), stage };
}
