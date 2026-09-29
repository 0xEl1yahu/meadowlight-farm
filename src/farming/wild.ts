/**
 * Wild shade crops. Mushrooms and snozberries are never sown: overnight they sprout by
 * themselves on empty shaded grass and spread to shaded neighbours of mature plants. Like
 * everything in the simulation this is a pure function of the world, the seed and the day.
 */
import { Salt, hash32, hashFloat } from '../core/hash';
import { TileState, type CropId, type Tile, type WorldState } from '../core/types';
import { DIRECTION_STEPS } from '../world/grid';
import { isReservedTile } from '../world/maps/lookup';
import type { MapDefinition } from '../world/maps/types';
import { countTiles, getTile, mapTiles } from '../world/tiles';
import { createCropInstance, isMature, shadeCropsInSeason, stageCount, CROPS } from './crops';
import type { DayContext } from './growth';

/**
 * A tile a wild crop could sprout on: the map's shaded grass holding no crop and no placed
 * object, and not one of its reserved (warp and arrival) tiles.
 */
export function canSproutWild(def: MapDefinition, tile: Tile, tx: number, tz: number): boolean {
  return (
    tile.state === TileState.Unplowed &&
    tile.crop === null &&
    tile.object === null &&
    def.isShaded(tx, tz) &&
    !isReservedTile(def, tx, tz)
  );
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
 * One night of sprouting and spreading on one map, tuned by `def.wild` (a map without wild
 * tuning is returned unchanged). Neighbours are read from the incoming world (not the
 * partially updated one), so the result does not depend on iteration order beyond the
 * population cap, which is applied in row-major order. `ctx.seed` is the map's seed.
 */
export function spreadWildCrops(world: WorldState, ctx: DayContext, def: MapDefinition): WorldState {
  const wild = def.wild;
  if (wild === null) return world;
  const allowed = shadeCropsInSeason(ctx.season).map((crop) => crop.id);
  if (allowed.length === 0) return world;
  let population = countTiles(world, (tile) => tile.crop !== null && tile.crop.wild);
  if (population >= wild.maxWild) return world;

  return mapTiles(world, (tile, tx, tz) => {
    if (population >= wild.maxWild || !canSproutWild(def, tile, tx, tz)) return tile;
    const neighbours = matureWildNeighbours(world, tx, tz, allowed);
    const chance = wild.sproutChance + wild.spreadChancePerNeighbor * neighbours.length;
    if (hashFloat(ctx.seed, tx, tz, ctx.day, Salt.Wild) >= chance) return tile;
    const pool = neighbours.length > 0 ? neighbours : allowed;
    const cropId = pool[hash32(ctx.seed, tx, tz, ctx.day, Salt.WildPick) % pool.length];
    if (cropId === undefined) return tile;
    population++;
    return { ...tile, crop: createCropInstance(cropId, ctx.day, true) };
  });
}

/**
 * The wild crop (if any) a freshly generated map starts with on an empty shaded tile, at a
 * random growth stage so the first morning already has a few ready to forage. `seed` is the
 * map's seed and `density` its `WildTuning.initialDensity`.
 */
export function initialWildCrop(
  seed: number,
  day: number,
  allowed: readonly CropId[],
  tx: number,
  tz: number,
  density: number,
): Tile['crop'] {
  if (allowed.length === 0 || hashFloat(seed, tx, tz, Salt.Wild) >= density) return null;
  const cropId = allowed[hash32(seed, tx, tz, Salt.WildPick) % allowed.length];
  if (cropId === undefined) return null;
  const stage = hash32(seed, tz, tx, Salt.WildPick) % (stageCount(CROPS[cropId]) + 1);
  return { ...createCropInstance(cropId, day, true), stage };
}
