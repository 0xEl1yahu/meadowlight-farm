/**
 * The overnight growth pipeline. Runs once per day transition as a pure function of the
 * world and a DayContext; unchanged tiles and chunks keep their identity.
 *
 * Per tile, in order:
 *   1. Crop update, using *yesterday's* soil moisture:
 *        - season changed and the crop cannot grow in the new season → withers (dead)
 *        - watered → +1 day in stage, advancing the stage when the requirement is met
 *        - dry      → no growth, dryDays += 1
 *   2. Moisture evaporates: Watered → Plowed.
 *   3. Empty, un-watered plowed soil may revert to grass (deterministic chance).
 *   4. Rain or storm today → every plowed tile starts the day Watered.
 * Wild shade crops skip all of that: they grow every night without water while they stay in
 * shade and in season, and quietly disappear otherwise. After the per-tile pass, new wild crops
 * sprout and spread on shaded grass (farming/wild.ts).
 */
import { FARMING } from '../config';
import { Salt, hashFloat } from '../core/hash';
import { TileState, type CropInstance, type Season, type Tile, type Weather, type WorldState } from '../core/types';
import { weatherWaters } from '../time/weather';
import { isShadedTile } from '../world/shade';
import { mapTiles } from '../world/tiles';
import { CROPS, daysRequiredForStage, isInSeason, stageCount } from './crops';
import { spreadWildCrops } from './wild';

export interface DayContext {
  readonly seed: number;
  /** Absolute index of the day that is starting. */
  readonly day: number;
  readonly season: Season;
  readonly seasonChanged: boolean;
  readonly weather: Weather;
}

/** One night of growth for a living crop. Returns the same object when nothing changes. */
export function growCrop(crop: CropInstance, watered: boolean): CropInstance {
  if (crop.dead) return crop;
  const def = CROPS[crop.cropId];
  if (crop.stage >= stageCount(def)) return crop;
  if (!watered) return { ...crop, dryDays: crop.dryDays + 1 };
  const daysInStage = crop.daysInStage + 1;
  if (daysInStage >= daysRequiredForStage(def, crop)) {
    return { ...crop, stage: crop.stage + 1, daysInStage: 0, dryDays: 0 };
  }
  return { ...crop, daysInStage, dryDays: 0 };
}

/** One night for a wild shade crop: grows without water in shade and in season, else vanishes. */
function advanceWildCrop(crop: CropInstance, shaded: boolean, ctx: DayContext): CropInstance | null {
  if (!shaded || !isInSeason(CROPS[crop.cropId], ctx.season)) return null;
  return growCrop(crop, true);
}

export function advanceTileOvernight(tile: Tile, tx: number, tz: number, ctx: DayContext, shaded = false): Tile {
  if (tile.crop !== null && tile.crop.wild) {
    const crop = advanceWildCrop(tile.crop, shaded, ctx);
    return crop === tile.crop ? tile : { ...tile, crop };
  }
  if (tile.state === TileState.Blocked || tile.state === TileState.Unplowed) return tile;

  const wasWatered = tile.state === TileState.Watered;
  let crop = tile.crop;
  if (crop !== null && !crop.dead) {
    const def = CROPS[crop.cropId];
    crop = ctx.seasonChanged && !isInSeason(def, ctx.season) ? { ...crop, dead: true } : growCrop(crop, wasWatered);
  }

  let state: TileState = TileState.Plowed;
  if (crop === null && !wasWatered && hashFloat(ctx.seed, tx, tz, ctx.day, Salt.Untill) < FARMING.untillChance) {
    state = TileState.Unplowed;
  }
  if (state === TileState.Plowed && weatherWaters(ctx.weather)) state = TileState.Watered;

  if (state === tile.state && crop === tile.crop) return tile;
  // Grass never holds fertiliser: soil that reverts loses whatever was mixed into it.
  if (state === TileState.Unplowed) return { ...tile, state, crop, fertilizer: null };
  return { ...tile, state, crop };
}

export function advanceWorldOvernight(world: WorldState, ctx: DayContext): WorldState {
  const grown = mapTiles(world, (tile, tx, tz) =>
    advanceTileOvernight(tile, tx, tz, ctx, isShadedTile(world.grid, tx, tz)),
  );
  return spreadWildCrops(grown, ctx);
}
