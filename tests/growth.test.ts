/**
 * Crop registry (src/farming/crops.ts) and the overnight growth pipeline
 * (src/farming/growth.ts).
 *
 * Pins down the growth arithmetic stage by stage for every crop, regrowth after harvest,
 * withering at season changes (including multi-season corn surviving Summer → Fall), soil
 * moisture evaporating and rain re-watering, the deterministic untill chance for empty dry
 * soil, and identity preservation for every tile the night does not change.
 */
import { describe, expect, it } from 'vitest';
import { FARMING, WORLD } from '../src/config';
import { Salt, hashFloat } from '../src/core/hash';
import { InvariantError } from '../src/core/invariant';
import { Blocker, CROP_IDS, Season, TileState, Weather, type CropId, type CropInstance, type Tile } from '../src/core/types';
import {
  CROPS,
  createCropInstance,
  cropsInSeason,
  daysRequiredForStage,
  getCrop,
  growthProgress,
  isInSeason,
  isMature,
  seedItemId,
  stageCount,
  totalGrowDays,
  validateCropDefinition,
  type CropDefinition,
} from '../src/farming/crops';
import { advanceTileOvernight, advanceWorldOvernight, growCrop, type DayContext } from '../src/farming/growth';
import { createGridSpec } from '../src/world/grid';
import { EMPTY_TILE, blockedTile, countTiles, createWorld, forEachTile, requireTile, setTile } from '../src/world/tiles';
import { HEAVY_TEST_TIMEOUT_MS, Violations, cropOf, deepEqual, matureCrop, soilTile, worldChangesOutside } from './testUtils';

function ctx(overrides: Partial<DayContext> = {}): DayContext {
  return { seed: WORLD.seed, day: 5, season: Season.Spring, seasonChanged: false, weather: Weather.Sunny, ...overrides };
}

/** The crop's state right after its first harvest (what the reducer produces for regrowers). */
function harvested(cropId: CropId): CropInstance {
  const def = CROPS[cropId];
  return cropOf(cropId, { stage: stageCount(def) - 1, daysInStage: 0, regrowing: true, harvestCount: 1 });
}

function waterNights(crop: CropInstance, nights: number): CropInstance {
  let current = crop;
  for (let i = 0; i < nights; i++) current = growCrop(current, true);
  return current;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

describe('crop registry', () => {
  it('has a valid definition keyed by its own id for every crop', () => {
    for (const id of CROP_IDS) {
      const def = getCrop(id);
      expect(def).toBe(CROPS[id]);
      expect(def.id).toBe(id);
      expect(() => validateCropDefinition(def)).not.toThrow();
      expect(stageCount(def)).toBe(def.stageDays.length);
      expect(totalGrowDays(def)).toBe(def.stageDays.reduce((a, b) => a + b, 0));
      expect(seedItemId(id)).toBe(`${id}_seeds`);
    }
  });

  it('pins the headline crop timings', () => {
    expect(totalGrowDays(CROPS.parsnip)).toBe(4);
    expect(totalGrowDays(CROPS.potato)).toBe(6);
    expect(totalGrowDays(CROPS.cauliflower)).toBe(12);
    expect(totalGrowDays(CROPS.strawberry)).toBe(8);
    expect(CROPS.strawberry.regrowDays).toBe(4);
    expect(CROPS.corn.seasons).toEqual([Season.Summer, Season.Fall]);
  });

  it('rejects malformed definitions', () => {
    const base = CROPS.parsnip;
    const broken: readonly (readonly [string, CropDefinition])[] = [
      ['no stages', { ...base, stageDays: [] }],
      ['zero-day stage', { ...base, stageDays: [1, 0, 1] }],
      ['fractional stage', { ...base, stageDays: [1, 1.5] }],
      ['zero regrow days', { ...base, regrowDays: 0 }],
      ['no seasons', { ...base, seasons: [] }],
      ['yieldMax < yieldMin', { ...base, yieldMin: 3, yieldMax: 2 }],
      ['zero yield', { ...base, yieldMin: 0, yieldMax: 0 }],
      ['free seeds', { ...base, seedPrice: 0 }],
      ['giant visual', { ...base, visual: { ...base.visual, height: 3 } }],
    ];
    for (const [label, def] of broken) expect(() => validateCropDefinition(def), label).toThrow(InvariantError);
  });

  it('lists the crops each season can grow', () => {
    const ids = (season: Season): CropId[] => cropsInSeason(season).map((def) => def.id);
    expect(ids(Season.Spring)).toEqual(['parsnip', 'potato', 'cauliflower', 'strawberry', 'carrot', 'spectraherb', 'mushroom']);
    expect(ids(Season.Summer)).toEqual(['blueberry', 'melon', 'corn', 'wheat', 'blackberry', 'spectraherb', 'mushroom', 'snozberry']);
    expect(ids(Season.Fall)).toEqual(['corn', 'pumpkin', 'carrot', 'wheat', 'blackberry', 'spectraherb', 'mushroom', 'snozberry']);
    expect(ids(Season.Winter)).toEqual([]);
    for (const id of CROP_IDS) {
      for (const season of [Season.Spring, Season.Summer, Season.Fall, Season.Winter]) {
        expect(isInSeason(CROPS[id], season)).toBe(ids(season).includes(id));
      }
    }
  });

  it('creates fresh crop instances', () => {
    expect(createCropInstance('melon', 17)).toEqual({
      cropId: 'melon',
      stage: 0,
      daysInStage: 0,
      dryDays: 0,
      regrowing: false,
      dead: false,
      plantedDay: 17,
      harvestCount: 0,
      wild: false,
    });
  });

  it('isMature is true exactly at stage === stageCount for living crops', () => {
    for (const id of CROP_IDS) {
      const n = stageCount(CROPS[id]);
      for (let stage = 0; stage < n; stage++) expect(isMature(cropOf(id, { stage }))).toBe(false);
      expect(isMature(cropOf(id, { stage: n }))).toBe(true);
      expect(isMature(cropOf(id, { stage: n, dead: true }))).toBe(false);
    }
  });

  it('daysRequiredForStage uses regrowDays only for the last stage of a regrowing crop', () => {
    const def = CROPS.strawberry;
    const last = stageCount(def) - 1;
    for (let stage = 0; stage <= last; stage++) {
      expect(daysRequiredForStage(def, cropOf('strawberry', { stage }))).toBe(def.stageDays[stage]);
    }
    expect(daysRequiredForStage(def, cropOf('strawberry', { stage: last, regrowing: true }))).toBe(4);
    expect(daysRequiredForStage(def, cropOf('strawberry', { stage: 1, regrowing: true }))).toBe(def.stageDays[1]);
    // A non-regrowing crop ignores the flag.
    expect(daysRequiredForStage(CROPS.parsnip, cropOf('parsnip', { stage: 3, regrowing: true }))).toBe(1);
    expect(() => daysRequiredForStage(def, cropOf('strawberry', { stage: stageCount(def) }))).toThrow(InvariantError);
  });

  it('growthProgress runs monotonically from 0 (planted) to 1 (mature)', () => {
    for (const id of CROP_IDS) {
      let crop = createCropInstance(id, 0);
      let previous = growthProgress(crop);
      expect(previous).toBe(0);
      for (let night = 0; night < totalGrowDays(CROPS[id]); night++) {
        crop = growCrop(crop, true);
        const progress = growthProgress(crop);
        expect(progress).toBeGreaterThan(previous);
        expect(progress).toBeLessThanOrEqual(1);
        previous = progress;
      }
      expect(previous).toBe(1);
    }
  });
});

// ---------------------------------------------------------------------------
// growCrop
// ---------------------------------------------------------------------------

describe('growCrop', () => {
  it.each(CROP_IDS)('advances %s one stage after exactly stageDays[stage] watered nights', (id) => {
    const def = CROPS[id];
    let crop = createCropInstance(id, 0);
    let night = 0;
    for (let stage = 0; stage < stageCount(def); stage++) {
      const days = def.stageDays[stage] ?? 0;
      for (let d = 1; d <= days; d++) {
        expect(crop.stage).toBe(stage);
        expect(crop.daysInStage).toBe(d - 1);
        crop = growCrop(crop, true);
        night++;
      }
      expect(crop.stage).toBe(stage + 1);
      expect(crop.daysInStage).toBe(0);
    }
    expect(night).toBe(totalGrowDays(def));
    expect(isMature(crop)).toBe(true);
  });

  it('matures a parsnip after exactly 4 watered nights', () => {
    const fresh = createCropInstance('parsnip', 0);
    expect(isMature(waterNights(fresh, 3))).toBe(false);
    expect(isMature(waterNights(fresh, 4))).toBe(true);
    expect(waterNights(fresh, 4).stage).toBe(4);
  });

  it('does not grow unwatered crops and counts the dry nights', () => {
    let crop = cropOf('potato', { stage: 2, daysInStage: 0 });
    for (let night = 1; night <= 5; night++) {
      const next = growCrop(crop, false);
      expect(next).not.toBe(crop);
      expect(next).toEqual({ ...crop, dryDays: night });
      crop = next;
    }
    const watered = growCrop(crop, true);
    expect(watered.dryDays).toBe(0);
    expect(watered.stage).toBe(3);
  });

  it('only counts watered nights, however they interleave with dry ones', () => {
    let crop = createCropInstance('parsnip', 0);
    let wateredNights = 0;
    for (let night = 0; wateredNights < 4; night++) {
      const watered = night % 3 !== 2;
      expect(isMature(crop)).toBe(false);
      crop = growCrop(crop, watered);
      if (watered) wateredNights++;
    }
    expect(isMature(crop)).toBe(true);
  });

  it('leaves mature and dead crops untouched (same reference)', () => {
    for (const id of CROP_IDS) {
      const mature = matureCrop(id);
      expect(growCrop(mature, true)).toBe(mature);
      expect(growCrop(mature, false)).toBe(mature);
      const dead = cropOf(id, { stage: 1, dead: true });
      expect(growCrop(dead, true)).toBe(dead);
      expect(growCrop(dead, false)).toBe(dead);
    }
  });

  it.each(['strawberry', 'blueberry', 'corn'] as const)('regrows %s from the last stage in exactly regrowDays nights', (id) => {
    const def = CROPS[id];
    const regrowDays = def.regrowDays ?? 0;
    expect(regrowDays).toBeGreaterThan(0);
    const start = harvested(id);
    expect(isMature(start)).toBe(false);
    expect(isMature(waterNights(start, regrowDays - 1))).toBe(false);
    const regrown = waterNights(start, regrowDays);
    expect(isMature(regrown)).toBe(true);
    expect(regrown.regrowing).toBe(true);
    expect(regrown.harvestCount).toBe(1);
  });

  it('non-regrowing crops have no regrow time', () => {
    for (const id of ['parsnip', 'potato', 'cauliflower', 'melon', 'pumpkin'] as const) {
      expect(CROPS[id].regrowDays).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// Overnight pipeline
// ---------------------------------------------------------------------------

describe('advanceTileOvernight', () => {
  it('returns Blocked and Unplowed tiles by reference', () => {
    const tiles: readonly Tile[] = [
      EMPTY_TILE,
      { ...EMPTY_TILE },
      blockedTile(Blocker.Rock, 2),
      blockedTile(Blocker.Water),
      blockedTile(Blocker.House),
    ];
    for (const tile of tiles) {
      for (const weather of [Weather.Sunny, Weather.Rain, Weather.Storm, Weather.Snow]) {
        expect(advanceTileOvernight(tile, 3, 3, ctx({ weather, seasonChanged: true, season: Season.Summer }))).toBe(tile);
      }
    }
  });

  it('grows a watered crop and dries the soil', () => {
    const tile = soilTile(TileState.Watered, cropOf('parsnip'));
    const next = advanceTileOvernight(tile, 3, 3, ctx());
    expect(next.state).toBe(TileState.Plowed);
    expect(next.crop).toEqual({ ...cropOf('parsnip'), stage: 1 });
  });

  it('does not grow a crop on dry soil and increments dryDays', () => {
    const tile = soilTile(TileState.Plowed, cropOf('cauliflower', { stage: 2, daysInStage: 1 }));
    const next = advanceTileOvernight(tile, 3, 3, ctx());
    expect(next.state).toBe(TileState.Plowed);
    expect(next.crop).toEqual({ ...cropOf('cauliflower', { stage: 2, daysInStage: 1 }), dryDays: 1 });
  });

  it('uses yesterday’s moisture: rain today waters the soil but does not grow a dry crop', () => {
    const tile = soilTile(TileState.Plowed, cropOf('parsnip'));
    for (const weather of [Weather.Rain, Weather.Storm]) {
      const next = advanceTileOvernight(tile, 3, 3, ctx({ weather }));
      expect(next.state).toBe(TileState.Watered);
      expect(next.crop).toEqual({ ...cropOf('parsnip'), dryDays: 1 });
    }
    const snowy = advanceTileOvernight(tile, 3, 3, ctx({ weather: Weather.Snow, season: Season.Winter }));
    expect(snowy.state).toBe(TileState.Plowed);
  });

  it('dries watered empty soil without ever untilling it', () => {
    for (let tx = 0; tx < 200; tx++) {
      const next = advanceTileOvernight(soilTile(TileState.Watered), tx, 7, ctx());
      expect(next).toEqual(soilTile(TileState.Plowed));
    }
  });

  it('keeps identity for watered empty soil on a rainy night (nothing changes)', () => {
    const tile = soilTile(TileState.Watered);
    expect(advanceTileOvernight(tile, 4, 4, ctx({ weather: Weather.Rain }))).toBe(tile);
    const withMature = soilTile(TileState.Watered, matureCrop('parsnip'));
    expect(advanceTileOvernight(withMature, 4, 4, ctx({ weather: Weather.Storm }))).toBe(withMature);
  });

  it('keeps identity for dry plowed soil holding a mature crop on a sunny night', () => {
    const tile = soilTile(TileState.Plowed, matureCrop('melon'));
    expect(advanceTileOvernight(tile, 4, 4, ctx({ season: Season.Summer }))).toBe(tile);
  });

  it('withers out-of-season crops when the season changes, mature or not', () => {
    const summer = ctx({ season: Season.Summer, seasonChanged: true, day: 28 });
    for (const id of ['parsnip', 'potato', 'cauliflower', 'strawberry'] as const) {
      for (const crop of [cropOf(id), cropOf(id, { stage: 2 }), matureCrop(id)]) {
        const next = advanceTileOvernight(soilTile(TileState.Watered, crop), 2, 2, summer);
        expect(next.crop).toEqual({ ...crop, dead: true });
        expect(next.state).toBe(TileState.Plowed);
      }
    }
  });

  it('keeps multi-season corn alive (and growing) from Summer into Fall', () => {
    const fall = ctx({ season: Season.Fall, seasonChanged: true, day: 56 });
    const corn = cropOf('corn', { stage: 1, daysInStage: 1 });
    const next = advanceTileOvernight(soilTile(TileState.Watered, corn), 2, 2, fall);
    expect(next.crop?.dead).toBe(false);
    expect(next.crop).toEqual({ ...corn, daysInStage: 2 });
    // …but Winter kills it, as it does pumpkins.
    const winter = ctx({ season: Season.Winter, seasonChanged: true, day: 84 });
    expect(advanceTileOvernight(soilTile(TileState.Watered, corn), 2, 2, winter).crop?.dead).toBe(true);
    expect(advanceTileOvernight(soilTile(TileState.Plowed, matureCrop('pumpkin')), 2, 2, winter).crop?.dead).toBe(true);
    // Blueberries and melons die when Summer turns to Fall.
    for (const id of ['blueberry', 'melon'] as const) {
      expect(advanceTileOvernight(soilTile(TileState.Watered, cropOf(id)), 2, 2, fall).crop?.dead).toBe(true);
    }
  });

  it('only withers at the season boundary, not mid-season', () => {
    const next = advanceTileOvernight(soilTile(TileState.Watered, cropOf('parsnip')), 2, 2, ctx({ season: Season.Summer, day: 30 }));
    expect(next.crop?.dead).toBe(false);
    expect(next.crop?.stage).toBe(1);
  });

  it('leaves dead crops dead (same crop reference) while the soil dries', () => {
    const dead = cropOf('parsnip', { dead: true, stage: 2 });
    const next = advanceTileOvernight(soilTile(TileState.Watered, dead), 2, 2, ctx({ season: Season.Summer, seasonChanged: true }));
    expect(next.crop).toBe(dead);
    expect(next.state).toBe(TileState.Plowed);
    const dry = soilTile(TileState.Plowed, dead);
    for (let tx = 0; tx < 100; tx++) expect(advanceTileOvernight(dry, tx, 0, ctx())).toBe(dry);
  });

  it('reverts empty dry soil exactly when the seeded untill roll is below FARMING.untillChance', () => {
    const tile = soilTile(TileState.Plowed);
    for (let tz = 0; tz < 20; tz++) {
      for (let tx = 0; tx < 20; tx++) {
        const day = 3 + ((tx + tz) % 5);
        const next = advanceTileOvernight(tile, tx, tz, ctx({ day }));
        const reverts = hashFloat(WORLD.seed, tx, tz, day, Salt.Untill) < FARMING.untillChance;
        if (reverts) expect(next).toEqual(EMPTY_TILE);
        else expect(next).toBe(tile);
      }
    }
  });

  it('never untills soil that holds a crop', () => {
    for (let tx = 0; tx < 300; tx++) {
      const next = advanceTileOvernight(soilTile(TileState.Plowed, cropOf('parsnip')), tx, 1, ctx());
      expect(next.state).toBe(TileState.Plowed);
    }
  });

  it('on a rainy night empty dry soil either reverts to grass or starts the day watered', () => {
    let reverted = 0;
    for (let tx = 0; tx < 400; tx++) {
      const next = advanceTileOvernight(soilTile(TileState.Plowed), tx, 2, ctx({ weather: Weather.Rain }));
      expect([TileState.Unplowed, TileState.Watered]).toContain(next.state);
      if (next.state === TileState.Unplowed) reverted++;
    }
    expect(reverted).toBeGreaterThan(0);
  });
});

describe('advanceWorldOvernight', () => {
  const grid = createGridSpec(48, 40, 16);

  // Winter: no shade crop is in season, so nothing sprouts wild and only field soil can change.
  it('returns the same world when there is no soil at all', () => {
    const world = createWorld(grid, (tx, tz) => ((tx + tz) % 7 === 0 ? blockedTile(Blocker.Rock, 2) : EMPTY_TILE));
    for (const weather of [Weather.Sunny, Weather.Rain]) {
      expect(advanceWorldOvernight(world, ctx({ weather, seasonChanged: true, season: Season.Winter }))).toBe(world);
    }
  });

  it('touches only chunks with soil that actually changed', () => {
    let world = createWorld(grid, () => EMPTY_TILE);
    world = setTile(world, 20, 20, soilTile(TileState.Watered, cropOf('parsnip')));
    const next = advanceWorldOvernight(world, ctx({ season: Season.Winter }));
    expect(worldChangesOutside(world, next, { tx: 20, tz: 20 })).toEqual([]);
    expect(next.chunks[4]).not.toBe(world.chunks[4]);
    expect(requireTile(next, 20, 20).crop?.stage).toBe(1);
  });

  it(
    'reverts empty dry soil at roughly FARMING.untillChance, deterministically',
    () => {
      const plowed = soilTile(TileState.Plowed);
      const world = createWorld(grid, () => plowed);
      const v = new Violations();
      let reverted = 0;
      let total = 0;
      const perDay: Set<string>[] = [];
      for (let day = 1; day <= 10; day++) {
        const context = ctx({ day });
        const next = advanceWorldOvernight(world, context);
        v.check(deepEqual(advanceWorldOvernight(world, context), next), `day ${day} is not deterministic`);
        const set = new Set<string>();
        forEachTile(next, (tile, tx, tz) => {
          total++;
          const roll = hashFloat(WORLD.seed, tx, tz, day, Salt.Untill);
          if (tile.state === TileState.Unplowed) {
            reverted++;
            set.add(`${tx},${tz}`);
            v.check(roll < FARMING.untillChance, `day ${day} (${tx}, ${tz}) reverted with roll ${roll}`);
          } else {
            v.check(tile === plowed && roll >= FARMING.untillChance, `day ${day} (${tx}, ${tz}) kept wrongly`);
          }
        });
        perDay.push(set);
      }
      expect(v.head()).toEqual([]);
      expect(Math.abs(reverted / total - FARMING.untillChance)).toBeLessThan(0.01);
      // Different days (and seeds) pick different tiles.
      const [first, second] = perDay;
      expect(first).toBeDefined();
      expect([...(first ?? [])].filter((key) => second?.has(key)).length).toBeLessThan((first?.size ?? 0) / 2);
      const otherSeed = advanceWorldOvernight(world, ctx({ day: 1, seed: 99 }));
      expect(countTiles(otherSeed, (tile) => tile.state === TileState.Unplowed)).toBeGreaterThan(0);
      expect(deepEqual(otherSeed, advanceWorldOvernight(world, ctx({ day: 1 })))).toBe(false);
    },
    HEAVY_TEST_TIMEOUT_MS,
  );

  it('re-waters every plowed tile that survives a rainy night', () => {
    let world = createWorld(grid, () => EMPTY_TILE);
    for (let tx = 0; tx < 48; tx++) world = setTile(world, tx, 10, soilTile(TileState.Plowed, cropOf('parsnip')));
    const next = advanceWorldOvernight(world, ctx({ weather: Weather.Storm }));
    for (let tx = 0; tx < 48; tx++) expect(requireTile(next, tx, 10).state).toBe(TileState.Watered);
  });
});
