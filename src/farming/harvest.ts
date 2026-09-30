/**
 * What a tile looks like after its mature crop is harvested, shared by the player and robots.
 */
import type { Tile } from '../core/types';
import { CROPS, stageCount } from './crops';

/**
 * A regrowing crop drops back to its last growing stage and keeps the fertiliser; any other
 * crop leaves the soil bare, and the fertiliser goes with it.
 */
export function harvestedTile(tile: Tile): Tile {
  const crop = tile.crop;
  if (crop === null) throw new RangeError('harvestedTile: the tile has no crop');
  const def = CROPS[crop.cropId];
  const regrown =
    def.regrowDays === null
      ? null
      : { ...crop, stage: stageCount(def) - 1, daysInStage: 0, dryDays: 0, regrowing: true, harvestCount: crop.harvestCount + 1 };
  return { ...tile, crop: regrown, fertilizer: regrown === null ? null : tile.fertilizer };
}
