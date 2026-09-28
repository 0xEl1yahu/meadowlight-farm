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
 */
import { FARMING } from '../config';
import { Salt, hashFloat } from '../core/hash';
import { TileState, type CropInstance, type Season, type Tile, type Weather, type WorldState } from '../core/types';
import { weatherWaters } from '../time/weather';
import { mapTiles } from '../world/tiles';
import { CROPS, daysRequiredForStage, isInSeason, stageCount } from './crops';

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

export function advanceTileOvernight(tile: Tile, tx: number, tz: number, ctx: DayContext): Tile {
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
  return { ...tile, state, crop };
}

export function advanceWorldOvernight(world: WorldState, ctx: DayContext): WorldState {
  return mapTiles(world, (tile, tx, tz) => advanceTileOvernight(tile, tx, tz, ctx));
}
