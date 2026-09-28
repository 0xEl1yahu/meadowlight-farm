/**
 * Data-driven crop registry. Adding a crop = adding an id to CROP_IDS (core/types.ts) and an
 * entry here; seeds, produce items, shop stock and visuals are all derived from it.
 *
 * Growth model: a crop starts at stage 0 and advances one stage after `stageDays[stage]`
 * watered nights. It is mature at `stage === stageDays.length`. Regrowing crops return to
 * the last growth stage after harvest and need `regrowDays` watered nights to mature again.
 */
import { CROP_IDS, Season, type CropId, type CropInstance, type SeedItemId } from '../core/types';
import { invariant } from '../core/invariant';

/** Silhouette of the foliage while growing. */
export type CropForm = 'leafy' | 'bush' | 'stalk' | 'vine';
/** Shape of the produce shown on mature plants. */
export type ProduceForm = 'bulb' | 'head' | 'berries' | 'cob' | 'gourd';

export interface CropVisual {
  readonly foliageColor: number;
  readonly produceColor: number;
  readonly form: CropForm;
  readonly produce: ProduceForm;
  /** Mature foliage height in world units. */
  readonly height: number;
}

export interface CropDefinition {
  readonly id: CropId;
  readonly name: string;
  readonly seasons: readonly Season[];
  readonly stageDays: readonly number[];
  readonly regrowDays: number | null;
  readonly yieldMin: number;
  readonly yieldMax: number;
  readonly seedPrice: number;
  readonly sellPrice: number;
  readonly visual: CropVisual;
}

export const CROPS: Readonly<Record<CropId, CropDefinition>> = {
  parsnip: {
    id: 'parsnip',
    name: 'Parsnip',
    seasons: [Season.Spring],
    stageDays: [1, 1, 1, 1],
    regrowDays: null,
    yieldMin: 1,
    yieldMax: 1,
    seedPrice: 20,
    sellPrice: 35,
    visual: { foliageColor: 0x7ccf6b, produceColor: 0xf3e2b3, form: 'leafy', produce: 'bulb', height: 0.42 },
  },
  potato: {
    id: 'potato',
    name: 'Potato',
    seasons: [Season.Spring],
    stageDays: [1, 1, 1, 2, 1],
    regrowDays: null,
    yieldMin: 1,
    yieldMax: 2,
    seedPrice: 50,
    sellPrice: 80,
    visual: { foliageColor: 0x6fbf73, produceColor: 0xc9a26b, form: 'bush', produce: 'bulb', height: 0.5 },
  },
  cauliflower: {
    id: 'cauliflower',
    name: 'Cauliflower',
    seasons: [Season.Spring],
    stageDays: [1, 2, 4, 4, 1],
    regrowDays: null,
    yieldMin: 1,
    yieldMax: 1,
    seedPrice: 80,
    sellPrice: 175,
    visual: { foliageColor: 0x8fd18a, produceColor: 0xfaf4df, form: 'leafy', produce: 'head', height: 0.5 },
  },
  strawberry: {
    id: 'strawberry',
    name: 'Strawberry',
    seasons: [Season.Spring],
    stageDays: [1, 1, 2, 2, 2],
    regrowDays: 4,
    yieldMin: 1,
    yieldMax: 2,
    seedPrice: 100,
    sellPrice: 120,
    visual: { foliageColor: 0x5fbf6a, produceColor: 0xf26d7d, form: 'bush', produce: 'berries', height: 0.4 },
  },
  blueberry: {
    id: 'blueberry',
    name: 'Blueberry',
    seasons: [Season.Summer],
    stageDays: [1, 3, 3, 4, 2],
    regrowDays: 4,
    yieldMin: 2,
    yieldMax: 3,
    seedPrice: 80,
    sellPrice: 50,
    visual: { foliageColor: 0x4fa86a, produceColor: 0x6b8cff, form: 'bush', produce: 'berries', height: 0.7 },
  },
  melon: {
    id: 'melon',
    name: 'Melon',
    seasons: [Season.Summer],
    stageDays: [1, 2, 3, 3, 3],
    regrowDays: null,
    yieldMin: 1,
    yieldMax: 1,
    seedPrice: 80,
    sellPrice: 250,
    visual: { foliageColor: 0x7cc36b, produceColor: 0x9ad97c, form: 'vine', produce: 'gourd', height: 0.35 },
  },
  corn: {
    id: 'corn',
    name: 'Corn',
    seasons: [Season.Summer, Season.Fall],
    stageDays: [2, 3, 3, 3, 3],
    regrowDays: 4,
    yieldMin: 1,
    yieldMax: 1,
    seedPrice: 150,
    sellPrice: 50,
    visual: { foliageColor: 0x9bd46a, produceColor: 0xffd966, form: 'stalk', produce: 'cob', height: 1.1 },
  },
  pumpkin: {
    id: 'pumpkin',
    name: 'Pumpkin',
    seasons: [Season.Fall],
    stageDays: [1, 2, 3, 4, 3],
    regrowDays: null,
    yieldMin: 1,
    yieldMax: 1,
    seedPrice: 100,
    sellPrice: 320,
    visual: { foliageColor: 0x6fb86a, produceColor: 0xff9a4d, form: 'vine', produce: 'gourd', height: 0.4 },
  },
};

export function validateCropDefinition(def: CropDefinition): void {
  invariant(def.stageDays.length >= 1, `${def.id}: needs at least one growth stage`);
  for (const days of def.stageDays) {
    invariant(Number.isInteger(days) && days >= 1, `${def.id}: stage durations must be integers ≥ 1`);
  }
  invariant(
    def.regrowDays === null || (Number.isInteger(def.regrowDays) && def.regrowDays >= 1),
    `${def.id}: regrowDays must be null or an integer ≥ 1`,
  );
  invariant(def.seasons.length > 0, `${def.id}: must grow in at least one season`);
  invariant(
    Number.isInteger(def.yieldMin) && def.yieldMin >= 1 && Number.isInteger(def.yieldMax) && def.yieldMax >= def.yieldMin,
    `${def.id}: invalid yield range`,
  );
  invariant(def.seedPrice > 0 && def.sellPrice > 0, `${def.id}: prices must be positive`);
  invariant(def.visual.height > 0 && def.visual.height <= 2, `${def.id}: visual height out of range`);
}

for (const id of CROP_IDS) {
  const def = CROPS[id];
  invariant(def.id === id, `crop registry key ${id} does not match definition id ${def.id}`);
  validateCropDefinition(def);
}

export function getCrop(id: CropId): CropDefinition {
  return CROPS[id];
}

export function stageCount(def: CropDefinition): number {
  return def.stageDays.length;
}

export function isMature(crop: CropInstance): boolean {
  return !crop.dead && crop.stage >= stageCount(CROPS[crop.cropId]);
}

export function isInSeason(def: CropDefinition, season: Season): boolean {
  return def.seasons.includes(season);
}

/** Watered nights required to leave the crop's current stage. */
export function daysRequiredForStage(def: CropDefinition, crop: CropInstance): number {
  const last = stageCount(def) - 1;
  if (crop.regrowing && crop.stage === last && def.regrowDays !== null) return def.regrowDays;
  const days = def.stageDays[crop.stage];
  invariant(days !== undefined, `${def.id}: no duration for stage ${crop.stage}`);
  return days;
}

export function totalGrowDays(def: CropDefinition): number {
  return def.stageDays.reduce((sum, days) => sum + days, 0);
}

/** 0 → freshly planted, 1 → mature. Used for smooth visual scaling. */
export function growthProgress(crop: CropInstance): number {
  const def = CROPS[crop.cropId];
  if (crop.stage >= stageCount(def)) return 1;
  const required = daysRequiredForStage(def, crop);
  return Math.min(1, (crop.stage + crop.daysInStage / required) / stageCount(def));
}

export function createCropInstance(cropId: CropId, absoluteDay: number): CropInstance {
  return {
    cropId,
    stage: 0,
    daysInStage: 0,
    dryDays: 0,
    regrowing: false,
    dead: false,
    plantedDay: absoluteDay,
    harvestCount: 0,
  };
}

export function seedItemId(cropId: CropId): SeedItemId {
  return `${cropId}_seeds`;
}

export function cropsInSeason(season: Season): readonly CropDefinition[] {
  return CROP_IDS.map((id) => CROPS[id]).filter((def) => isInSeason(def, season));
}
