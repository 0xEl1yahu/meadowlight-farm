/**
 * Structural validators for untrusted values (parsed save JSON). Each one is a type guard that
 * returns false on any unexpected shape and never throws, so the save loader can reject a
 * corrupted save as a whole instead of half-loading it.
 */
import { GENERATORS, INVENTORY } from '../config';
import {
  Blocker,
  CROP_IDS,
  DECORATION_IDS,
  FERTILIZER_KINDS,
  FESTIVAL_IDS,
  FORAGE_IDS,
  GIANT_CROP_IDS,
  PLACED_OBJECT_KINDS,
  QUALITIES,
  TileState,
  type CropInstance,
  type ItemStack,
  type PlacedObject,
  type PlacedObjectKind,
  type Tile,
} from '../core/types';
import { CROPS, stageCount } from '../farming/crops';
import { getItem, isItemId } from '../items/items';
import { isHittableBlocker, isPathObject } from '../world/tiles';

export type Obj = Record<string, unknown>;

export const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
export const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
export const isIntIn = (v: unknown, min: number, max: number): v is number => isInt(v) && v >= min && v <= max;
/** A non-negative safe integer (counters, days, amounts). */
export const isCount = (v: unknown): v is number => isIntIn(v, 0, Number.MAX_SAFE_INTEGER);
export const isBool = (v: unknown): v is boolean => typeof v === 'boolean';

/** Whether `v` is one of `values` (identity comparison, so it works for strings and numbers). */
export function isOneOf<T>(v: unknown, values: readonly T[]): v is T {
  return (values as readonly unknown[]).includes(v);
}

/** Whether `v` has exactly the keys `keys`: none missing, none extra. */
export function hasExactKeys(v: Obj, keys: readonly string[]): boolean {
  const own = Object.keys(v);
  return own.length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(v, key));
}

/**
 * Whether `v` lists some of `ids` with no repeats, in the order `ids` gives them. This is the
 * canonical form of every id list in the save, so equal sets always serialise identically.
 */
export function isCanonicalSubset<T>(v: unknown, ids: readonly T[]): v is readonly T[] {
  if (!Array.isArray(v)) return false;
  let previous = -1;
  for (const id of v as readonly unknown[]) {
    const index = (ids as readonly unknown[]).indexOf(id);
    if (index <= previous) return false;
    previous = index;
  }
  return true;
}

/**
 * An item stack: a known item, a quantity ≥ 1 (≤ maxStack when `enforceMaxStack`; the shipping
 * bin has no limit), and a quality in {0, 1, 2} that is nonzero only for items with a quality.
 */
export function isValidStack(v: unknown, enforceMaxStack: boolean): v is ItemStack {
  if (!isObj(v) || !isItemId(v.itemId) || !isInt(v.quantity) || v.quantity < 1) return false;
  const item = getItem(v.itemId);
  if (!isOneOf(v.quality, QUALITIES) || (v.quality !== 0 && !item.hasQuality)) return false;
  return !enforceMaxStack || v.quantity <= item.maxStack;
}

export function isValidCrop(v: unknown): v is CropInstance {
  if (!isObj(v) || !isOneOf(v.cropId, CROP_IDS)) return false;
  const def = CROPS[v.cropId];
  return (
    isIntIn(v.stage, 0, stageCount(def)) &&
    isIntIn(v.daysInStage, 0, 1000) &&
    isIntIn(v.dryDays, 0, 1_000_000) &&
    isBool(v.regrowing) &&
    isBool(v.dead) &&
    isCount(v.plantedDay) &&
    isCount(v.harvestCount) &&
    isBool(v.wild) &&
    (!v.wild || def.habitat === 'shade')
  );
}

/** The fields each placed-object kind carries besides `kind`. Anything else is rejected. */
const OBJECT_FIELDS: Readonly<Record<PlacedObjectKind, readonly string[]>> = {
  chest: ['slots'],
  sprinkler: [],
  qualitySprinkler: [],
  woodBurner: ['fuel'],
  scarecrow: [],
  woodFence: [],
  woodPath: [],
  stonePath: [],
  giantCrop: ['cropId', 'anchorTx', 'anchorTz'],
  forage: ['itemId', 'spawnDay'],
  trophy: ['festival', 'year'],
  decoration: ['variant'],
};

/** Shape of one placed object. Placement rules against its tile live in `isValidTile`. */
export function isValidPlacedObject(v: unknown): v is PlacedObject {
  if (!isObj(v) || !isOneOf(v.kind, PLACED_OBJECT_KINDS)) return false;
  if (!hasExactKeys(v, ['kind', ...OBJECT_FIELDS[v.kind]])) return false;
  switch (v.kind) {
    case 'chest':
      return (
        Array.isArray(v.slots) &&
        v.slots.length === INVENTORY.chestSlots &&
        v.slots.every((slot: unknown) => slot === null || isValidStack(slot, true))
      );
    case 'giantCrop':
      return isOneOf(v.cropId, GIANT_CROP_IDS) && isInt(v.anchorTx) && isInt(v.anchorTz);
    case 'forage':
      return isOneOf(v.itemId, FORAGE_IDS) && isCount(v.spawnDay);
    case 'trophy':
      return isOneOf(v.festival, FESTIVAL_IDS) && isIntIn(v.year, 1, Number.MAX_SAFE_INTEGER);
    case 'decoration':
      return isOneOf(v.variant, DECORATION_IDS);
    case 'woodBurner':
      return isIntIn(v.fuel, 0, GENERATORS.woodBurner.hopper);
    case 'sprinkler':
    case 'qualitySprinkler':
    case 'scarecrow':
    case 'woodFence':
    case 'woodPath':
    case 'stonePath':
      return true;
  }
}

const TILE_STATES: readonly TileState[] = Object.values(TileState);
const BLOCKERS: readonly Blocker[] = Object.values(Blocker);

/**
 * One tile, with every `assertTileConsistent` invariant duplicated here so that a corrupted
 * save is rejected instead of throwing later inside a reducer.
 */
export function isValidTile(v: unknown): v is Tile {
  if (!isObj(v) || !isOneOf(v.state, TILE_STATES) || !isOneOf(v.blocker, BLOCKERS)) return false;
  const soil = v.state === TileState.Plowed || v.state === TileState.Watered;
  if ((v.state === TileState.Blocked) !== (v.blocker !== Blocker.None)) return false;
  if (!isIntIn(v.blockerHp, 0, 100)) return false;
  if (v.blockerHp > 0 && !isHittableBlocker(v.blocker)) return false;

  if (v.crop !== null) {
    if (!isValidCrop(v.crop)) return false;
    if (!soil && !(v.state === TileState.Unplowed && v.crop.wild)) return false;
  }

  const object = v.object;
  if (object !== null) {
    if (!isValidPlacedObject(object) || v.blocker !== Blocker.None || v.crop !== null) return false;
    if (isPathObject(object) && (v.state !== TileState.Unplowed || v.fertilizer !== null)) return false;
  }

  if (v.fertilizer !== null) {
    if (!isOneOf(v.fertilizer, FERTILIZER_KINDS) || !soil || object !== null) return false;
  }
  return true;
}
