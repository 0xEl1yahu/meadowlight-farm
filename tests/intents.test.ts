/**
 * Action planning (src/state/intents.ts) and read-only selectors (src/state/selectors.ts).
 *
 * The tile highlighter and HUD preview actions through the same plans the reducer executes,
 * so "the preview never disagrees with the outcome" is a hard guarantee. Besides unit tests
 * for every tool on every relevant tile, a property-style test generates thousands of random
 * situations (position, facing, target tile, hotbar, energy, water, season) and checks that
 * executing `player/useTool` / `player/interact` does exactly what the plan announced.
 */
import { describe, expect, it } from 'vitest';
import { INVENTORY, PLAYER, TIME, TOOLS } from '../src/config';
import { mulberry32 } from '../src/core/hash';
import {
  Blocker,
  CROP_IDS,
  DIRECTIONS,
  TOOL_TYPES,
  Direction,
  Season,
  TileState,
  Weather,
  type CropInstance,
  type GameState,
  type ItemId,
  type ItemStack,
  type Tile,
} from '../src/core/types';
import { CROPS, createCropInstance, seedItemId, stageCount } from '../src/farming/crops';
import { ITEMS, getItem } from '../src/items/items';
import { actions } from '../src/state/actions';
import {
  describeIntent,
  harvestQuantity,
  isActionable,
  planInteraction,
  planPrimaryAction,
  type ActionPlan,
  type IntentKind,
} from '../src/state/intents';
import { capacityFor } from '../src/state/inventory';
import { gameReducer } from '../src/state/reducer';
import {
  selectClockLabel,
  selectDateLabel,
  selectForecast,
  selectIsFrozen,
  selectMinutesUntilPassOut,
  selectPendingShipmentValue,
  selectSelectedItem,
  selectShopStock,
  selectTargetTile,
  selectTargetTileData,
} from '../src/state/selectors';
import { rollWeather } from '../src/time/weather';
import { forwardTile } from '../src/world/grid';
import { EMPTY_TILE, blockedTile, getTile, isWalkable } from '../src/world/tiles';
import {
  BASE,
  HEAVY_TEST_TIMEOUT_MS,
  Violations,
  STAND,
  TARGET,
  atDay,
  count,
  cropOf,
  emptyHanded,
  holding,
  matureCrop,
  must,
  scenario,
  soilTile,
  tileAt,
  withEnergy,
  withPlayer,
  withSlots,
  withTile,
  withWater,
  worldChangesOutside,
} from './testUtils';

const plowed = soilTile(TileState.Plowed);
const watered = soilTile(TileState.Watered);

function planFor(tile: Tile, itemId: ItemId | null, base: GameState = BASE): ActionPlan {
  const state = scenario(tile, base);
  return planPrimaryAction(itemId === null ? emptyHanded(state) : holding(state, itemId));
}

// ---------------------------------------------------------------------------
// Tool plans
// ---------------------------------------------------------------------------

describe('planPrimaryAction — tools', () => {
  it('hoe: tills grass, clears withered crops, explains debris, ignores the rest', () => {
    expect(planFor(EMPTY_TILE, 'hoe')).toEqual({ target: TARGET, intent: { kind: 'till' }, feedback: 'hoe', energyCost: TOOLS.energyCost.hoe });
    expect(planFor(soilTile(TileState.Plowed, cropOf('parsnip', { dead: true })), 'hoe')).toEqual({
      target: TARGET,
      intent: { kind: 'clearCrop' },
      feedback: 'hoe',
      energyCost: TOOLS.energyCost.hoe,
    });
    expect(planFor(blockedTile(Blocker.Rock, 2), 'hoe').intent).toEqual({ kind: 'blocked', reason: 'This rock needs a pickaxe.' });
    expect(planFor(blockedTile(Blocker.Stump, 3), 'hoe').intent).toEqual({ kind: 'blocked', reason: 'This stump needs an axe.' });
    for (const tile of [plowed, watered, soilTile(TileState.Plowed, cropOf('parsnip')), blockedTile(Blocker.House), blockedTile(Blocker.Water)]) {
      expect(planFor(tile, 'hoe')).toEqual({ target: TARGET, intent: { kind: 'blocked', reason: null }, feedback: 'hoe', energyCost: 0 });
    }
  });

  it('watering can: waters dry soil, refills at water, explains empty / full cans', () => {
    expect(planFor(plowed, 'wateringCan')).toEqual({
      target: TARGET,
      intent: { kind: 'water' },
      feedback: 'wateringCan',
      energyCost: TOOLS.energyCost.wateringCan,
    });
    expect(planFor(soilTile(TileState.Plowed, cropOf('corn')), 'wateringCan').intent.kind).toBe('water');
    expect(planFor(watered, 'wateringCan')).toEqual({ target: TARGET, intent: { kind: 'blocked', reason: null }, feedback: 'wateringCan', energyCost: 0 });
    expect(planFor(EMPTY_TILE, 'wateringCan').intent).toEqual({ kind: 'blocked', reason: null });
    expect(planFor(plowed, 'wateringCan', withWater(BASE, 0)).intent).toEqual({
      kind: 'blocked',
      reason: 'Your watering can is empty. Refill it at the pond.',
    });
    expect(planFor(blockedTile(Blocker.Water), 'wateringCan', withWater(BASE, 3))).toEqual({
      target: TARGET,
      intent: { kind: 'refill' },
      feedback: 'refill',
      energyCost: 0,
    });
    expect(planFor(blockedTile(Blocker.Water), 'wateringCan')).toEqual({
      target: TARGET,
      intent: { kind: 'blocked', reason: 'Your watering can is already full.' },
      feedback: 'refill',
      energyCost: 0,
    });
  });

  it('pickaxe: mines rocks, clears empty or withered soil, explains stumps', () => {
    expect(planFor(blockedTile(Blocker.Rock, 2), 'pickaxe')).toEqual({
      target: TARGET,
      intent: { kind: 'mine' },
      feedback: 'pickaxe',
      energyCost: TOOLS.energyCost.pickaxe,
    });
    expect(planFor(plowed, 'pickaxe').intent.kind).toBe('untill');
    expect(planFor(watered, 'pickaxe').intent.kind).toBe('untill');
    expect(planFor(soilTile(TileState.Watered, cropOf('melon', { dead: true })), 'pickaxe').intent.kind).toBe('untill');
    expect(planFor(soilTile(TileState.Watered, cropOf('melon')), 'pickaxe').intent).toEqual({ kind: 'blocked', reason: null });
    expect(planFor(blockedTile(Blocker.Stump, 3), 'pickaxe').intent).toEqual({ kind: 'blocked', reason: 'This stump needs an axe.' });
    expect(planFor(EMPTY_TILE, 'pickaxe').intent).toEqual({ kind: 'blocked', reason: null });
  });

  it('axe: chops stumps, explains rocks', () => {
    expect(planFor(blockedTile(Blocker.Stump, 1), 'axe')).toEqual({
      target: TARGET,
      intent: { kind: 'chop' },
      feedback: 'axe',
      energyCost: TOOLS.energyCost.axe,
    });
    expect(planFor(blockedTile(Blocker.Rock, 2), 'axe').intent).toEqual({ kind: 'blocked', reason: 'This rock needs a pickaxe.' });
    expect(planFor(EMPTY_TILE, 'axe').intent).toEqual({ kind: 'blocked', reason: null });
    expect(planFor(soilTile(TileState.Plowed, matureCrop('parsnip')), 'axe').intent).toEqual({ kind: 'blocked', reason: null });
  });

  it('scythe: harvests mature crops for free, clears withered ones, ignores growing ones', () => {
    const mature = soilTile(TileState.Plowed, matureCrop('parsnip'));
    const plan = planFor(mature, 'scythe');
    expect(plan).toEqual({ target: TARGET, intent: { kind: 'harvest', quantity: 1 }, feedback: 'scythe', energyCost: 0 });
    expect(planFor(soilTile(TileState.Plowed, cropOf('parsnip', { stage: 3 })), 'scythe').intent).toEqual({ kind: 'blocked', reason: null });
    expect(planFor(soilTile(TileState.Plowed, cropOf('parsnip', { dead: true })), 'scythe').intent.kind).toBe('clearCrop');
    expect(planFor(EMPTY_TILE, 'scythe').intent).toEqual({ kind: 'blocked', reason: null });
  });

  it('blocks tools that cost more energy than the player has, but not free actions', () => {
    const tired = withEnergy(BASE, 1);
    expect(planFor(EMPTY_TILE, 'hoe', tired)).toEqual({
      target: TARGET,
      intent: { kind: 'blocked', reason: "You're too exhausted. Get some sleep." },
      feedback: 'hoe',
      energyCost: 0,
    });
    expect(planFor(EMPTY_TILE, 'hoe', withEnergy(BASE, 2)).intent.kind).toBe('till');
    expect(planFor(blockedTile(Blocker.Rock, 2), 'pickaxe', withEnergy(BASE, 2)).intent.kind).toBe('blocked');
    const exhausted = withEnergy(BASE, 0);
    expect(planFor(soilTile(TileState.Plowed, matureCrop('parsnip')), 'scythe', exhausted).intent.kind).toBe('harvest');
    expect(planFor(blockedTile(Blocker.Water), 'wateringCan', withWater(exhausted, 0)).intent.kind).toBe('refill');
  });

  it('blocks with feedback but no target when the player faces the edge of the world', () => {
    const atEdge = withPlayer(BASE, { tx: 5, tz: 0 }, Direction.North);
    expect(selectTargetTile(atEdge)).toBeNull();
    expect(planPrimaryAction(atEdge)).toEqual({ target: null, intent: { kind: 'blocked', reason: null }, feedback: 'hoe', energyCost: 0 });
    expect(planPrimaryAction(holding(atEdge, 'parsnip_seeds', 3)).feedback).toBe('plant');
    expect(planInteraction(atEdge)).toEqual({ target: null, intent: { kind: 'blocked', reason: null }, feedback: 'none', energyCost: 0 });
  });
});

describe('planPrimaryAction — seeds', () => {
  it('scatters in-season seeds on empty soil for free', () => {
    expect(planFor(plowed, 'parsnip_seeds')).toEqual({
      target: TARGET,
      intent: { kind: 'scatter', cropId: 'parsnip', tiles: [TARGET] },
      feedback: 'plant',
      energyCost: 0,
    });
    expect(planFor(watered, 'strawberry_seeds').intent).toEqual({ kind: 'scatter', cropId: 'strawberry', tiles: [TARGET] });
  });

  it('explains unplowed ground, out-of-season seeds and shade-only crops', () => {
    expect(planFor(EMPTY_TILE, 'parsnip_seeds').intent).toEqual({ kind: 'blocked', reason: 'Till the soil with the hoe first.' });
    expect(planFor(plowed, 'pumpkin_seeds').intent).toEqual({ kind: 'blocked', reason: "Pumpkin won't grow in Spring." });
    expect(planFor(plowed, 'parsnip_seeds', atDay(BASE, 30)).intent).toEqual({ kind: 'blocked', reason: "Parsnip won't grow in Summer." });
    expect(planFor(plowed, 'corn_seeds', atDay(BASE, 60)).intent).toEqual({ kind: 'scatter', cropId: 'corn', tiles: [TARGET] });
    expect(planFor(plowed, 'mushroom_seeds').intent).toEqual({ kind: 'blocked', reason: 'Mushrooms only grow wild in the shade.' });
  });

  it('refuses occupied soil and blocked tiles when nothing else in the patch is tilled', () => {
    // The rest of the patch is grass, so the handful has nowhere to land.
    for (const tile of [soilTile(TileState.Plowed, cropOf('parsnip')), blockedTile(Blocker.Rock, 2), blockedTile(Blocker.ShippingBin)]) {
      expect(planFor(tile, 'parsnip_seeds')).toEqual({
        target: TARGET,
        intent: { kind: 'blocked', reason: 'Till the soil with the hoe first.' },
        feedback: 'plant',
        energyCost: 0,
      });
    }
  });
});

// ---------------------------------------------------------------------------
// Interaction plans
// ---------------------------------------------------------------------------

describe('planInteraction', () => {
  it('harvests mature crops and clears withered ones (feedback "harvest", no energy)', () => {
    expect(planInteraction(scenario(soilTile(TileState.Watered, matureCrop('parsnip'))))).toEqual({
      target: TARGET,
      intent: { kind: 'harvest', quantity: 1 },
      feedback: 'harvest',
      energyCost: 0,
    });
    expect(planInteraction(scenario(soilTile(TileState.Plowed, cropOf('potato', { dead: true }))))).toEqual({
      target: TARGET,
      intent: { kind: 'clearCrop' },
      feedback: 'harvest',
      energyCost: 0,
    });
  });

  it('refuses a harvest that does not fit in the inventory', () => {
    const full = withSlots(
      scenario(soilTile(TileState.Plowed, matureCrop('parsnip'))),
      Array.from({ length: INVENTORY.hotbarSize }, (): ItemStack => ({ itemId: 'stone', quantity: INVENTORY.maxStack })),
    );
    expect(planInteraction(full).intent).toEqual({ kind: 'blocked', reason: 'Your inventory is full.' });
    expect(planInteraction(full).feedback).toBe('harvest');
    // A partially filled matching stack is enough room.
    const almost = withSlots(full, [
      { itemId: 'parsnip', quantity: INVENTORY.maxStack - 1 },
      ...Array.from({ length: INVENTORY.hotbarSize - 1 }, (): ItemStack => ({ itemId: 'stone', quantity: 1 })),
    ]);
    expect(planInteraction(almost).intent.kind).toBe('harvest');
  });

  it('is a silent no-op on growing crops, grass and debris', () => {
    for (const tile of [soilTile(TileState.Plowed, cropOf('parsnip')), EMPTY_TILE, plowed, blockedTile(Blocker.Rock, 2), blockedTile(Blocker.Stump, 3)]) {
      expect(planInteraction(scenario(tile))).toEqual({ target: TARGET, intent: { kind: 'blocked', reason: null }, feedback: 'none', energyCost: 0 });
    }
  });

  it('ships sellable selections into the bin and explains the rest', () => {
    const bin = scenario(blockedTile(Blocker.ShippingBin));
    expect(planInteraction(holding(bin, 'parsnip', 3))).toEqual({ target: TARGET, intent: { kind: 'ship' }, feedback: 'ship', energyCost: 0 });
    expect(planInteraction(holding(bin, 'parsnip_seeds', 3)).intent.kind).toBe('ship');
    expect(planInteraction(holding(bin, 'stone', 3)).intent.kind).toBe('ship');
    expect(planInteraction(holding(bin, 'hoe')).intent).toEqual({ kind: 'blocked', reason: "Hoe can't be shipped." });
    expect(planInteraction(emptyHanded(bin))).toEqual({
      target: TARGET,
      intent: { kind: 'blocked', reason: 'Select something on your hotbar to ship it.' },
      feedback: 'ship',
      energyCost: 0,
    });
  });

  it('sleeps at the house', () => {
    expect(planInteraction(scenario(blockedTile(Blocker.House)))).toEqual({ target: TARGET, intent: { kind: 'sleep' }, feedback: 'sleep', energyCost: 0 });
    const atDoor = withPlayer(BASE, PLAYER.spawn, Direction.North);
    expect(planInteraction(atDoor)).toMatchObject({ target: { tx: PLAYER.spawn.tx, tz: PLAYER.spawn.tz - 1 }, intent: { kind: 'sleep' } });
  });

  it('refills at water only with a watering can that is not full', () => {
    const pond = scenario(blockedTile(Blocker.Water));
    expect(planInteraction(withWater(pond, 12))).toEqual({ target: TARGET, intent: { kind: 'refill' }, feedback: 'refill', energyCost: 0 });
    expect(planInteraction(pond)).toEqual({ target: TARGET, intent: { kind: 'blocked', reason: null }, feedback: 'none', energyCost: 0 });
    const noCan = withSlots(withWater(pond, 0), [{ itemId: 'hoe', quantity: 1 }]);
    expect(planInteraction(noCan).intent).toEqual({ kind: 'blocked', reason: null });
  });

  it('is what the primary action falls back to for empty hands, produce and materials', () => {
    const tiles: readonly Tile[] = [
      soilTile(TileState.Plowed, matureCrop('potato')),
      blockedTile(Blocker.ShippingBin),
      blockedTile(Blocker.House),
      blockedTile(Blocker.Water),
      EMPTY_TILE,
    ];
    for (const tile of tiles) {
      const state = withWater(scenario(tile), 5);
      expect(planPrimaryAction(emptyHanded(state))).toEqual(planInteraction(emptyHanded(state)));
      expect(planPrimaryAction(holding(state, 'melon', 2))).toEqual(planInteraction(holding(state, 'melon', 2)));
      expect(planPrimaryAction(holding(state, 'wood', 2))).toEqual(planInteraction(holding(state, 'wood', 2)));
    }
  });
});

describe('harvestQuantity / describeIntent / isActionable', () => {
  it('is deterministic and stays within the crop’s yield range', () => {
    const seen = new Set<number>();
    for (let day = 0; day < 60; day++) {
      for (let tx = 0; tx < 10; tx++) {
        const state = atDay(BASE, day);
        const crop: CropInstance = matureCrop('potato', { harvestCount: tx % 3 });
        const quantity = harvestQuantity(state, { tx, tz: 12 }, crop);
        expect(harvestQuantity(state, { tx, tz: 12 }, crop)).toBe(quantity);
        expect(quantity).toBeGreaterThanOrEqual(CROPS.potato.yieldMin);
        expect(quantity).toBeLessThanOrEqual(CROPS.potato.yieldMax);
        seen.add(quantity);
      }
    }
    expect([...seen].sort()).toEqual([1, 2]);
    for (const id of CROP_IDS) {
      const quantity = harvestQuantity(BASE, TARGET, matureCrop(id));
      expect(quantity).toBeGreaterThanOrEqual(CROPS[id].yieldMin);
      expect(quantity).toBeLessThanOrEqual(CROPS[id].yieldMax);
    }
  });

  it('varies the yield with each documented input: tile, day and harvest number', () => {
    const potato = (harvestCount: number): CropInstance => matureCrop('potato', { harvestCount });
    const values = (quantities: readonly number[]): number[] => [...new Set(quantities)].sort();
    // Same tile and harvest number, different days.
    expect(values(Array.from({ length: 60 }, (_, day) => harvestQuantity(atDay(BASE, day), { tx: 3, tz: 12 }, potato(0))))).toEqual([1, 2]);
    // Same day and harvest number, different tiles.
    expect(values(Array.from({ length: 40 }, (_, tx) => harvestQuantity(BASE, { tx, tz: 12 }, potato(0))))).toEqual([1, 2]);
    // Same tile and day, different harvest numbers.
    expect(values(Array.from({ length: 40 }, (_, n) => harvestQuantity(BASE, { tx: 3, tz: 12 }, potato(n))))).toEqual([1, 2]);
    // Different world seeds.
    expect(values(Array.from({ length: 40 }, (_, seed) => harvestQuantity({ ...BASE, seed }, { tx: 3, tz: 12 }, potato(0))))).toEqual([1, 2]);
  });

  it('describes every actionable intent and nothing for blocked plans', () => {
    expect(describeIntent({ kind: 'till' })).toBe('Till');
    expect(describeIntent({ kind: 'water' })).toBe('Water');
    expect(describeIntent({ kind: 'refill' })).toBe('Refill can');
    expect(describeIntent({ kind: 'mine' })).toBe('Break rock');
    expect(describeIntent({ kind: 'chop' })).toBe('Chop stump');
    expect(describeIntent({ kind: 'untill' })).toBe('Clear soil');
    expect(describeIntent({ kind: 'scatter', cropId: 'cauliflower', tiles: [{ tx: 1, tz: 1 }] })).toBe('Scatter Cauliflower');
    expect(describeIntent({ kind: 'scatter', cropId: 'wheat', tiles: [{ tx: 1, tz: 1 }, { tx: 2, tz: 1 }] })).toBe('Scatter Wheat ×2');
    expect(describeIntent({ kind: 'harvest', quantity: 2 })).toBe('Harvest');
    expect(describeIntent({ kind: 'clearCrop' })).toBe('Clear withered crop');
    expect(describeIntent({ kind: 'ship' })).toBe('Ship');
    expect(describeIntent({ kind: 'sleep' })).toBe('Sleep');
    expect(describeIntent({ kind: 'blocked', reason: 'nope' })).toBeNull();
    expect(isActionable(planFor(EMPTY_TILE, 'hoe'))).toBe(true);
    expect(isActionable(planFor(EMPTY_TILE, 'axe'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

describe('selectors', () => {
  it('targets the tile in front of the player', () => {
    expect(selectTargetTile(BASE)).toEqual({ tx: PLAYER.spawn.tx, tz: PLAYER.spawn.tz + 1 });
    expect(selectTargetTile(withPlayer(BASE, PLAYER.spawn, Direction.North))).toEqual({ tx: PLAYER.spawn.tx, tz: PLAYER.spawn.tz - 1 });
    expect(selectTargetTile(withPlayer(BASE, STAND, Direction.East))).toEqual({ tx: 6, tz: 9 });
    expect(selectTargetTile(withPlayer(BASE, { tx: 5, tz: 0 }, Direction.North))).toBeNull();
    expect(selectTargetTileData(withPlayer(BASE, PLAYER.spawn, Direction.North))?.blocker).toBe(Blocker.House);
    expect(selectTargetTileData(withPlayer(BASE, { tx: 5, tz: 0 }, Direction.North))).toBeNull();
  });

  it('reads the selected item, frozen flag, labels and forecast', () => {
    expect(selectSelectedItem(BASE)?.id).toBe('hoe');
    expect(selectSelectedItem(emptyHanded(BASE))).toBeNull();
    expect(selectIsFrozen(BASE)).toBe(false);
    expect(selectIsFrozen({ ...BASE, ui: { ...BASE.ui, paused: true } })).toBe(true);
    expect(selectIsFrozen({ ...BASE, ui: { ...BASE.ui, shopOpen: true } })).toBe(true);
    expect(selectClockLabel(BASE)).toBe('6:00 am');
    expect(selectDateLabel(BASE)).toBe('Mon. 1 · Spring · Year 1');
    for (let day = 0; day < 50; day++) {
      expect(selectForecast(atDay(BASE, day))).toBe(rollWeather(BASE.seed, day + 1));
    }
    expect(selectMinutesUntilPassOut(BASE)).toBe(TIME.passOutMinute - TIME.dayStartMinute);
    expect(selectMinutesUntilPassOut(atDay(BASE, 0, 1500))).toBe(60);
    expect(selectMinutesUntilPassOut(atDay(BASE, 0, 1600))).toBe(0);
  });

  it('values pending shipments at their sell prices', () => {
    const state: GameState = {
      ...BASE,
      shipping: {
        pending: [
          { itemId: 'parsnip', quantity: 3 },
          { itemId: 'stone', quantity: 10 },
          { itemId: 'corn_seeds', quantity: 2 },
        ],
        lastPayout: 0,
      },
    };
    expect(selectPendingShipmentValue(state)).toBe(3 * 35 + 10 * 2 + 2 * 75);
    expect(selectPendingShipmentValue(BASE)).toBe(0);
  });

  it('stocks the seeds of every crop in season', () => {
    // Field crops only: mushrooms and snozberries grow wild and are never sold.
    expect(selectShopStock(BASE).map((item) => item.id)).toEqual([
      'parsnip_seeds',
      'potato_seeds',
      'cauliflower_seeds',
      'strawberry_seeds',
      'carrot_seeds',
      'spectraherb_seeds',
    ]);
    expect(selectShopStock(atDay(BASE, 56)).map((item) => item.id)).toEqual([
      'corn_seeds',
      'pumpkin_seeds',
      'carrot_seeds',
      'wheat_seeds',
      'blackberry_seeds',
      'spectraherb_seeds',
    ]);
    expect(selectShopStock(atDay(BASE, 90))).toEqual([]);
    for (const item of selectShopStock(atDay(BASE, 30))) expect(item.kind).toBe('seed');
  });
});

// ---------------------------------------------------------------------------
// Property: plan ⇔ reducer outcome
// ---------------------------------------------------------------------------

const ALL_ITEMS: readonly ItemId[] = [...ITEMS.keys()];

function pick<T>(rng: () => number, values: readonly T[]): T {
  return must(values[Math.floor(rng() * values.length)]);
}

function randomCrop(rng: () => number, day: number): CropInstance {
  const cropId = pick(rng, CROP_IDS);
  const def = CROPS[cropId];
  const roll = rng();
  if (roll < 0.15) return { ...createCropInstance(cropId, day), dead: true, stage: Math.floor(rng() * stageCount(def)) };
  if (roll < 0.55) return { ...createCropInstance(cropId, day), stage: stageCount(def), harvestCount: Math.floor(rng() * 3) };
  if (roll < 0.7 && def.regrowDays !== null) {
    return { ...createCropInstance(cropId, day), stage: stageCount(def) - 1, regrowing: true, harvestCount: 1 };
  }
  return { ...createCropInstance(cropId, day), stage: Math.floor(rng() * stageCount(def)), daysInStage: 0 };
}

function randomTile(rng: () => number, day: number): Tile {
  const roll = rng();
  if (roll < 0.12) return EMPTY_TILE;
  if (roll < 0.22) return soilTile(rng() < 0.5 ? TileState.Plowed : TileState.Watered);
  if (roll < 0.52) return soilTile(rng() < 0.5 ? TileState.Plowed : TileState.Watered, randomCrop(rng, day));
  if (roll < 0.62) return blockedTile(Blocker.Rock, 1 + Math.floor(rng() * TOOLS.rockHits));
  if (roll < 0.72) return blockedTile(Blocker.Stump, 1 + Math.floor(rng() * TOOLS.stumpHits));
  if (roll < 0.82) return blockedTile(Blocker.Water);
  if (roll < 0.9) return blockedTile(Blocker.ShippingBin);
  return blockedTile(Blocker.House);
}

function randomStack(rng: () => number, forceFull: boolean, itemId: ItemId = pick(rng, ALL_ITEMS)): ItemStack {
  const maxStack = getItem(itemId).maxStack;
  const quantity = forceFull ? maxStack : Math.min(maxStack, 1 + Math.floor(rng() * 25));
  return { itemId, quantity };
}

/** What the player holds: biased toward tools and seeds so every tool branch is exercised. */
function randomSelection(rng: () => number): ItemStack | null {
  const roll = rng();
  if (roll < 0.45) return { itemId: pick(rng, TOOL_TYPES), quantity: 1 };
  if (roll < 0.7) return randomStack(rng, false, seedItemId(pick(rng, CROP_IDS)));
  if (roll < 0.85) return randomStack(rng, false);
  return null;
}

function randomSituation(rng: () => number): GameState {
  const day = Math.floor(rng() * 224);
  let state = atDay(BASE, day, 360 + Math.floor(rng() * 1000));
  const facing = pick(rng, DIRECTIONS);
  // Bias toward edges so null targets are exercised too.
  const tx = rng() < 0.1 ? pick(rng, [0, state.maps.farm.grid.width - 1]) : Math.floor(rng() * state.maps.farm.grid.width);
  const tz = rng() < 0.1 ? pick(rng, [0, state.maps.farm.grid.depth - 1]) : Math.floor(rng() * state.maps.farm.grid.depth);
  const standing = must(getTile(state.maps.farm, tx, tz));
  if (!isWalkable(standing)) state = withTile(state, { tx, tz }, EMPTY_TILE);
  state = withPlayer(state, { tx, tz }, facing);
  const target = forwardTile(state.maps.farm.grid, { tx, tz }, facing, PLAYER.toolReachTiles);
  if (target !== null && rng() < 0.9) state = withTile(state, target, randomTile(rng, day));

  const full = rng() < 0.15;
  const stacks = Array.from({ length: INVENTORY.hotbarSize }, () => (full || rng() < 0.55 ? randomStack(rng, full) : null));
  const selected = Math.floor(rng() * INVENTORY.hotbarSize);
  if (rng() < 0.85) stacks[selected] = randomSelection(rng);
  state = withSlots(state, stacks, selected);
  state = withWater(state, pick(rng, [0, 1, 17, TOOLS.wateringCanCapacity - 1, TOOLS.wateringCanCapacity]));
  state = withEnergy(state, pick(rng, [0, 1, 2, 3, 40, PLAYER.maxEnergy, PLAYER.maxEnergy, PLAYER.maxEnergy]));
  if (rng() < 0.3) state = { ...state, shipping: { pending: [{ itemId: 'parsnip', quantity: 4 }], lastPayout: 0 } };
  return state;
}

function lastMessageText(state: GameState): string | undefined {
  return state.messages.entries[state.messages.entries.length - 1]?.text;
}

/**
 * Records every way in which `next = reducer(state, action)` differs from what `plan`
 * announced. Uses a violation collector rather than `expect` so the dense property loop
 * stays fast.
 */
function checkOutcomeMatchesPlan(v: Violations, state: GameState, plan: ActionPlan, next: GameState): void {
  const { intent, target } = plan;
  const seq = state.player.actionSeq + 1;

  if (intent.kind === 'blocked') {
    if (plan.feedback === 'none' && intent.reason === null) {
      v.same('silent no-op state', next, state);
      return;
    }
    v.same('maps', next.maps, state.maps);
    v.same('inventory', next.inventory, state.inventory);
    v.same('shipping', next.shipping, state.shipping);
    v.same('time', next.time, state.time);
    v.equal('player (except feedback)', { ...next.player, actionSeq: 0, lastAction: null }, { ...state.player, actionSeq: 0, lastAction: null });
    v.equal('failure feedback', next.player.lastAction, { seq, kind: plan.feedback, target, success: false });
    if (intent.reason === null) v.same('messages', next.messages, state.messages);
    else v.equal('warning', lastMessageText(next), intent.reason);
    return;
  }

  if (target === null) {
    v.check(false, `actionable plan "${intent.kind}" without a target`);
    return;
  }
  const at = target;
  if (intent.kind === 'sleep') {
    v.equal('next day', next.time.absoluteDay, state.time.absoluteDay + 1);
    v.equal('rested', next.player.energy, state.player.maxEnergy);
    v.equal('sleep feedback', next.player.lastAction, { seq, kind: 'sleep', target: at, success: true });
    return;
  }

  v.check(plan.energyCost <= state.player.energy, `plan costs ${plan.energyCost} with only ${state.player.energy} energy`);
  v.equal('energy', next.player.energy, state.player.energy - plan.energyCost);
  v.equal('success feedback', next.player.lastAction, { seq, kind: plan.feedback, target: at, success: true });
  v.equal('position', [next.player.tx, next.player.tz], [state.player.tx, state.player.tz]);
  v.equal('gold', next.player.gold, state.player.gold);
  v.same('time', next.time, state.time);
  v.equal('world changes outside the target', worldChangesOutside(state.maps.farm, next.maps.farm, at), []);
  v.same('forest', next.maps.forest, state.maps.forest);
  v.same('town', next.maps.town, state.maps.town);

  const before = tileAt(state, at);
  const after = tileAt(next, at);
  switch (intent.kind) {
    case 'till':
      v.equal('tilled tile was grass', before.state, TileState.Unplowed);
      v.equal('tilled tile', after, { ...before, state: TileState.Plowed });
      v.same('inventory', next.inventory, state.inventory);
      break;
    case 'water':
      v.equal('watered tile', after, { ...before, state: TileState.Watered });
      v.equal('water left', next.inventory.water, state.inventory.water - 1);
      v.same('slots', next.inventory.slots, state.inventory.slots);
      break;
    case 'refill':
      v.same('maps', next.maps, state.maps);
      v.equal('water refilled', next.inventory.water, state.inventory.waterCapacity);
      break;
    case 'mine':
    case 'chop': {
      const drop = intent.kind === 'mine' ? 'stone' : 'wood';
      const yieldQty = intent.kind === 'mine' ? TOOLS.stoneFromRock : TOOLS.woodFromStump;
      v.equal('debris kind', before.blocker, intent.kind === 'mine' ? Blocker.Rock : Blocker.Stump);
      if (before.blockerHp > 1) {
        v.equal('damaged debris', after, { ...before, blockerHp: before.blockerHp - 1 });
        v.equal(`${drop} unchanged`, count(next, drop), count(state, drop));
      } else {
        v.equal('cleared debris', after, EMPTY_TILE);
        v.equal(`${drop} dropped`, count(next, drop), count(state, drop) + Math.min(yieldQty, capacityFor(state.inventory, drop)));
      }
      break;
    }
    case 'untill':
      v.check(before.crop === null || before.crop.dead, 'untilled a living crop');
      v.equal('untilled tile', after, EMPTY_TILE);
      v.same('inventory', next.inventory, state.inventory);
      break;
    case 'scatter':
      v.check(intent.tiles.length > 0, 'scatter plants at least one tile');
      for (const coord of intent.tiles) {
        const soilBefore = tileAt(state, coord);
        v.equal('scattered on empty soil', soilBefore.crop, null);
        v.equal('scattered tile', tileAt(next, coord), { ...soilBefore, crop: createCropInstance(intent.cropId, state.time.absoluteDay) });
      }
      v.equal('one seed per tile', count(next, seedItemId(intent.cropId)), count(state, seedItemId(intent.cropId)) - intent.tiles.length);
      break;
    case 'harvest': {
      const crop = before.crop;
      if (crop === null) {
        v.check(false, 'harvested an empty tile');
        break;
      }
      v.equal('announced quantity', intent.quantity, harvestQuantity(state, at, crop));
      v.equal('produce added', count(next, crop.cropId), count(state, crop.cropId) + intent.quantity);
      const def = CROPS[crop.cropId];
      const expected =
        def.regrowDays === null
          ? null
          : { ...crop, stage: stageCount(def) - 1, daysInStage: 0, dryDays: 0, regrowing: true, harvestCount: crop.harvestCount + 1 };
      v.equal('crop after harvest', after.crop, expected);
      break;
    }
    case 'clearCrop':
      v.check(before.crop?.dead === true, 'cleared a living crop');
      v.equal('cleared tile', after, { ...before, crop: null });
      v.same('inventory', next.inventory, state.inventory);
      break;
    case 'ship': {
      const stack = state.inventory.slots[state.inventory.selected] ?? null;
      if (stack === null) {
        v.check(false, 'shipped an empty slot');
        break;
      }
      v.same('maps', next.maps, state.maps);
      v.equal('slot emptied', next.inventory.slots[state.inventory.selected], null);
      v.equal(
        'pending value',
        selectPendingShipmentValue(next) - selectPendingShipmentValue(state),
        (getItem(stack.itemId).sellPrice ?? Number.NaN) * stack.quantity,
      );
      break;
    }
  }
}

describe('property: the planned outcome always matches what the reducer does', () => {
  it(
    'holds for thousands of random situations, for both useTool and interact',
    () => {
      const rng = mulberry32(0xa11ce);
      const kinds = new Map<IntentKind | 'silent', number>();
      const violations = new Violations();
      let nullTargets = 0;
      for (let i = 0; i < 5000; i++) {
        const state = randomSituation(rng);
        for (const action of [actions.useTool(), actions.interact()]) {
          const plan = action.type === 'player/useTool' ? planPrimaryAction(state) : planInteraction(state);
          const replanned = action.type === 'player/useTool' ? planPrimaryAction(state) : planInteraction(state);
          violations.equal(`#${i} ${action.type} plan is deterministic`, replanned, plan);
          const before = violations.list.length;
          checkOutcomeMatchesPlan(violations, state, plan, gameReducer(state, action));
          for (let k = before; k < violations.list.length; k++) {
            violations.list[k] = `#${i} ${action.type} ${JSON.stringify(plan.intent)}: ${violations.list[k]}`;
          }
          const silent = plan.intent.kind === 'blocked' && plan.feedback === 'none' && plan.intent.reason === null;
          const label = silent ? 'silent' : plan.intent.kind;
          kinds.set(label, (kinds.get(label) ?? 0) + 1);
          if (plan.target === null) nullTargets++;
        }
      }
      expect(violations.head()).toEqual([]);
      // The generator really exercised every branch.
      for (const kind of ['till', 'water', 'refill', 'mine', 'chop', 'untill', 'scatter', 'harvest', 'clearCrop', 'ship', 'sleep', 'blocked', 'silent'] as const) {
        expect(kinds.get(kind) ?? 0, `intent ${kind}`).toBeGreaterThan(10);
      }
      expect(nullTargets).toBeGreaterThan(10);
    },
    HEAVY_TEST_TIMEOUT_MS,
  );

  it('never lets a frozen game act, whatever the plan says', () => {
    const rng = mulberry32(7);
    let acted = 0;
    for (let i = 0; i < 300; i++) {
      const state = randomSituation(rng);
      const paused: GameState = { ...state, ui: { ...state.ui, paused: true } };
      const shopping: GameState = { ...state, ui: { ...state.ui, shopOpen: true } };
      for (const frozen of [paused, shopping]) {
        if (gameReducer(frozen, actions.useTool()) !== frozen) acted++;
        if (gameReducer(frozen, actions.interact()) !== frozen) acted++;
      }
    }
    expect(acted).toBe(0);
  });

  it('weather and season never change what a plan does to the targeted tile', () => {
    const rainy: GameState = { ...scenario(EMPTY_TILE), weather: Weather.Rain };
    expect(planPrimaryAction(rainy)).toEqual(planPrimaryAction(scenario(EMPTY_TILE)));
    expect(planPrimaryAction(atDay(scenario(EMPTY_TILE), 90))).toEqual(planPrimaryAction(scenario(EMPTY_TILE)));
    expect(atDay(BASE, 90).time.season).toBe(Season.Winter);
  });
});
