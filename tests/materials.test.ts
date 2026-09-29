/**
 * Materials from debris, fertiliser (quality and Speed-Gro), sprinklers and crows.
 */
import { describe, expect, it } from 'vitest';
import { CROWS, FARMING, TOOLS } from '../src/config';
import { Blocker, CROP_IDS, TileState, type GameState, type TileCoord } from '../src/core/types';
import { CROPS, speedGroStageDays, stageCount, totalGrowDays } from '../src/farming/crops';
import { runCrows } from '../src/farming/crows';
import { debrisDrops } from '../src/farming/drops';
import { advanceTileOvernight, growCrop } from '../src/farming/growth';
import { runSprinklers } from '../src/farming/sprinklers';
import { actions } from '../src/state/actions';
import { countItem } from '../src/state/inventory';
import { harvestQuality, planPrimaryAction } from '../src/state/intents';
import { crowReport, gameReducer } from '../src/state/reducer';
import { mapSeed } from '../src/world/maps';
import { EMPTY_TILE, blockedTile, requireTile, setTiles } from '../src/world/tiles';
import { BASE, TARGET, atDay, cropOf, holding, matureCrop, scenario, soilTile, tileAt, withTile } from './testUtils';

const useTool = (state: GameState): GameState => gameReducer(state, actions.useTool());

describe('debris drops', () => {
  const rate = (blocker: Parameters<typeof debrisDrops>[1], itemId: string): number => {
    let hits = 0;
    const n = 4000;
    for (let i = 0; i < n; i++) {
      const drops = debrisDrops(BASE.seed, blocker, i % 64, Math.floor(i / 64), 3);
      if (drops.some((d) => d.itemId === itemId)) hits++;
    }
    return hits / n;
  };

  it('drops copper ore from a quarter of rocks, sap from half of trees and some stumps', () => {
    expect(rate(Blocker.Rock, 'copperOre')).toBeCloseTo(0.25, 1);
    expect(rate(Blocker.Tree, 'sap')).toBeCloseTo(0.5, 1);
    expect(rate(Blocker.Stump, 'sap')).toBeCloseTo(0.15, 1);
    expect(rate(Blocker.Rock, 'stone')).toBe(1);
    expect(rate(Blocker.Tree, 'wood')).toBe(1);
  });

  it('always drops 1 fiber from weeds, and is deterministic', () => {
    expect(debrisDrops(1, Blocker.Weeds, 4, 4, 9)).toEqual([{ itemId: 'fiber', quantity: 1 }]);
    expect(debrisDrops(7, Blocker.Rock, 4, 4, 9)).toEqual(debrisDrops(7, Blocker.Rock, 4, 4, 9));
  });

  it('gives the rolled drops when the last hit lands', () => {
    for (let day = 0; day < 12; day++) {
      const state = holding(scenario(blockedTile(Blocker.Rock, 1), atDay(BASE, day)), 'pickaxe');
      const next = useTool(state);
      const drops = debrisDrops(mapSeed(BASE.seed, 'farm'), Blocker.Rock, TARGET.tx, TARGET.tz, day);
      const copper = drops.find((d) => d.itemId === 'copperOre')?.quantity ?? 0;
      expect(countItem(next.inventory, 'copperOre')).toBe(copper);
      expect(countItem(next.inventory, 'stone')).toBe(TOOLS.stoneFromRock);
    }
  });
});

describe('fertiliser', () => {
  it('goes on empty tilled soil only, one at a time', () => {
    const next = useTool(holding(scenario(soilTile(TileState.Plowed)), 'qualityFertilizer', 2));
    expect(tileAt(next, TARGET).fertilizer).toBe('quality');
    expect(countItem(next.inventory, 'qualityFertilizer')).toBe(1);
    const reason = (tile: Parameters<typeof scenario>[0]): unknown => {
      const intent = planPrimaryAction(holding(scenario(tile), 'basicFertilizer')).intent;
      return intent.kind === 'blocked' ? intent.reason : intent.kind;
    };
    expect(reason(EMPTY_TILE)).toBe('Fertiliser goes on tilled soil.');
    expect(reason(soilTile(TileState.Plowed, cropOf('parsnip')))).toBe('Fertilise the soil before planting.');
    expect(reason({ ...soilTile(TileState.Plowed), fertilizer: 'speedGro' })).toBe('This soil is already fertilised.');
  });

  it('shifts the harvest quality odds per the plan table', () => {
    for (const [fertilizer, expected] of [
      [null, FARMING.qualityChance.none],
      ['basic', FARMING.qualityChance.basic],
      ['quality', FARMING.qualityChance.quality],
    ] as const) {
      const state = withTile(BASE, TARGET, { ...soilTile(TileState.Plowed, matureCrop('parsnip')), fertilizer });
      const counts = [0, 0, 0];
      const n = 6000;
      for (let day = 0; day < n; day++) counts[harvestQuality(atDay(state, day), TARGET, matureCrop('parsnip'))]! += 1;
      expect((counts[2] ?? 0) / n).toBeCloseTo(expected.gold, 1);
      expect((counts[1] ?? 0) / n).toBeCloseTo(expected.silver, 1);
    }
    expect(FARMING.qualityChance).toEqual({
      none: { silver: 0.15, gold: 0.05 },
      basic: { silver: 0.25, gold: 0.1 },
      quality: { silver: 0.35, gold: 0.2 },
    });
  });

  it('Speed-Gro cuts 10% of the grow days (rounded, at least 1) for every crop', () => {
    for (const id of CROP_IDS) {
      const def = CROPS[id];
      const total = totalGrowDays(def);
      const cut = Math.max(1, Math.round(total * 0.1));
      expect(speedGroStageDays(def).reduce((a, b) => a + b, 0)).toBe(total - cut);
      let crop = cropOf(id);
      let nights = 0;
      while (crop.stage < stageCount(def)) {
        crop = growCrop(crop, true, 'speedGro');
        nights++;
      }
      expect(nights, id).toBe(total - cut);
    }
  });

  it('lasts until a non-regrowing crop is harvested, and survives a regrowing one', () => {
    const parsnip = useTool(holding(scenario({ ...soilTile(TileState.Plowed, matureCrop('parsnip')), fertilizer: 'basic' }), 'scythe'));
    expect(tileAt(parsnip, TARGET).fertilizer).toBeNull();
    const berry = useTool(holding(scenario({ ...soilTile(TileState.Plowed, matureCrop('strawberry')), fertilizer: 'basic' }), 'scythe'));
    expect(tileAt(berry, TARGET).crop).not.toBeNull();
    expect(tileAt(berry, TARGET).fertilizer).toBe('basic');
  });

  it('is lost when empty soil reverts to grass', () => {
    const tile = { ...soilTile(TileState.Plowed), fertilizer: 'quality' as const };
    let reverted = 0;
    for (let tx = 0; tx < 300; tx++) {
      const next = advanceTileOvernight(tile, tx, 0, { seed: 1, day: 5, season: 0, seasonChanged: false, weather: 'sunny' });
      if (next.state === TileState.Unplowed) {
        reverted++;
        expect(next.fertilizer).toBeNull();
      } else expect(next.fertilizer).toBe('quality');
    }
    expect(reverted).toBeGreaterThan(0);
  });
});

describe('sprinklers', () => {
  const at = (dx: number, dz: number): TileCoord => ({ tx: TARGET.tx + dx, tz: TARGET.tz + dz });
  const ring = [at(0, -1), at(1, 0), at(0, 1), at(-1, 0), at(-1, -1), at(1, -1), at(1, 1), at(-1, 1)];

  function field(kind: 'sprinkler' | 'qualitySprinkler'): GameState['maps']['farm'] {
    const world = BASE.maps.farm;
    return setTiles(world, [
      { ...TARGET, tile: { ...EMPTY_TILE, object: { kind } } },
      ...ring.map((c) => ({ ...c, tile: soilTile(TileState.Plowed) })),
    ]);
  }

  it('water the 4 tiles beside a sprinkler, or the 8 around a quality one', () => {
    const plain = runSprinklers(field('sprinkler'));
    ring.forEach((c, i) => expect(requireTile(plain, c.tx, c.tz).state).toBe(i < 4 ? TileState.Watered : TileState.Plowed));
    const quality = runSprinklers(field('qualitySprinkler'));
    for (const c of ring) expect(requireTile(quality, c.tx, c.tz).state).toBe(TileState.Watered);
    // Idempotent: nothing left to water keeps the world.
    expect(runSprinklers(quality)).toBe(quality);
  });

  it('water overnight so crops grow and the soil is wet in the morning', () => {
    let state: GameState = { ...BASE, maps: { ...BASE.maps, farm: field('sprinkler') } };
    state = withTile(state, at(0, 1), soilTile(TileState.Plowed, cropOf('parsnip')));
    const next = gameReducer(state, actions.sleep());
    const tile = tileAt(next, at(0, 1), 'farm');
    expect(tile.crop?.stage).toBe(1);
    expect(tile.state).toBe(TileState.Watered);
  });
});

describe('crows', () => {
  const plot: TileCoord[] = Array.from({ length: 40 }, (_, i) => ({ tx: 2 + (i % 10), tz: 10 + Math.floor(i / 10) }));
  const planted = (n: number): GameState['maps']['farm'] =>
    setTiles(BASE.maps.farm, plot.slice(0, n).map((c) => ({ ...c, tile: soilTile(TileState.Watered, cropOf('parsnip')) })));

  it('leave small fields alone', () => {
    const world = planted(CROWS.minCrops);
    for (let day = 0; day < 100; day++) expect(runCrows(world, BASE.seed, day).world).toBe(world);
  });

  it('eat at most 3 unprotected crops a night, deterministically', () => {
    const world = planted(40);
    let total = 0;
    for (let day = 0; day < 100; day++) {
      const raid = runCrows(world, BASE.seed, day);
      expect(raid.eaten.length).toBeLessThanOrEqual(CROWS.maxPerNight);
      expect(runCrows(world, BASE.seed, day)).toEqual(raid);
      total += raid.eaten.length;
    }
    expect(total).toBeGreaterThan(20);
  });

  it('stay away from crops within 8 tiles of a scarecrow', () => {
    const guarded = setTiles(planted(40), [{ tx: 7, tz: 14, tile: { ...EMPTY_TILE, object: { kind: 'scarecrow' } } }]);
    for (let day = 0; day < 100; day++) expect(runCrows(guarded, BASE.seed, day).eaten).toEqual([]);
  });

  it('are reported in the morning', () => {
    expect(crowReport(['parsnip', 'potato', 'parsnip'])).toBe('Crows ate 2 Parsnips and 1 Potato overnight. A scarecrow keeps them away.');
    const world = planted(40);
    const day = Array.from({ length: 100 }, (_, d) => d).find((d) => runCrows(world, BASE.seed, d + 1).eaten.length > 0);
    if (day === undefined) throw new Error('no raid in 100 days');
    const next = gameReducer({ ...atDay(BASE, day), maps: { ...BASE.maps, farm: world } }, actions.sleep());
    expect(next.messages.entries.some((m) => m.text.startsWith('Crows ate'))).toBe(true);
  });
});
