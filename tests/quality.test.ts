/**
 * Item quality (spec §2.3, §5.2 quality roll, §5.3 payout): sell prices per quality, the
 * deterministic harvest roll and its distribution, harvests landing at their rolled quality,
 * shipping that keeps qualities apart, and the morning payout with its lifetime counters.
 */
import { describe, expect, it } from 'vitest';
import { FARMING, INVENTORY, PLAYER, QUALITY_MULTIPLIERS } from '../src/config';
import { Salt, hashFloat } from '../src/core/hash';
import { CROP_IDS, Direction, MATERIAL_IDS, QUALITIES, TOOL_TYPES, TileState, type GameState, type Quality } from '../src/core/types';
import { seedItemId } from '../src/farming/crops';
import { ITEMS, getItem, sellPriceFor } from '../src/items/items';
import { actions } from '../src/state/actions';
import { harvestQuality, harvestQuantity, planInteraction } from '../src/state/intents';
import { gameReducer, startNextDay } from '../src/state/reducer';
import { selectPendingShipmentValue } from '../src/state/selectors';
import { mapSeed } from '../src/world/maps';
import { EMPTY_TILE } from '../src/world/tiles';
import {
  BASE,
  TARGET,
  atDay,
  holding,
  matureCrop,
  must,
  soilTile,
  stack,
  tileAt,
  withPlayer,
  withSlots,
  withTile,
} from './testUtils';

describe('sell prices', () => {
  it('multiplies by 1, 1.25 and 1.5 and rounds down', () => {
    expect(QUALITY_MULTIPLIERS).toEqual([1, 1.25, 1.5]);
    expect(FARMING.qualityMultipliers).toBe(QUALITY_MULTIPLIERS);
    expect(sellPriceFor('parsnip', 0)).toBe(35);
    expect(sellPriceFor('parsnip', 1)).toBe(43);
    expect(sellPriceFor('parsnip', 2)).toBe(52);
    expect(sellPriceFor('melon', 1)).toBe(Math.floor(250 * 1.25));
    expect(sellPriceFor('pumpkin', 2)).toBe(480);
  });

  it('matches floor(sellPrice × multiplier) for every shippable item and quality', () => {
    for (const item of ITEMS.values()) {
      for (const quality of QUALITIES) {
        const expected = item.sellPrice === null ? 0 : Math.floor(item.sellPrice * QUALITY_MULTIPLIERS[quality]);
        expect(sellPriceFor(item.id, quality), `${item.id} q${quality}`).toBe(expected);
      }
    }
  });

  it('is 0 for items that cannot be shipped, and never lowers a price', () => {
    for (const tool of TOOL_TYPES) expect(sellPriceFor(tool, 0)).toBe(0);
    for (const id of [...CROP_IDS, ...MATERIAL_IDS]) {
      expect(sellPriceFor(id, 1)).toBeGreaterThanOrEqual(sellPriceFor(id, 0));
      expect(sellPriceFor(id, 2)).toBeGreaterThanOrEqual(sellPriceFor(id, 1));
    }
    expect(sellPriceFor(seedItemId('parsnip'), 0)).toBe(must(getItem(seedItemId('parsnip')).sellPrice));
  });
});

describe('harvest quality roll', () => {
  it('follows the spec formula with the map seed, tile, day and harvest number', () => {
    for (let tx = 0; tx < 20; tx++) {
      const crop = matureCrop('parsnip', { harvestCount: tx % 3 });
      const at = { tx, tz: 12 };
      const r = hashFloat(mapSeed(BASE.seed, 'farm'), tx, 12, BASE.time.absoluteDay, crop.harvestCount, Salt.Quality);
      const expected: Quality = r < 0.05 ? 2 : r < 0.2 ? 1 : 0;
      expect(harvestQuality(BASE, at, crop)).toBe(expected);
    }
  });

  it('is deterministic and uses the farm seed unchanged on the farm', () => {
    expect(mapSeed(BASE.seed, 'farm')).toBe(BASE.seed);
    const crop = matureCrop('potato');
    for (let tz = 0; tz < 20; tz++) {
      expect(harvestQuality(BASE, { tx: 7, tz }, crop)).toBe(harvestQuality(BASE, { tx: 7, tz }, crop));
    }
  });

  it('comes out about 5% gold, 15% silver and 80% normal over many tiles and days', () => {
    const counts = [0, 0, 0];
    let total = 0;
    for (let day = 0; day < 8; day++) {
      const state = atDay(BASE, day * 5);
      for (let tx = 0; tx < 48; tx++) {
        for (let tz = 0; tz < 40; tz++) {
          const quality = harvestQuality(state, { tx, tz }, matureCrop('parsnip', { harvestCount: day % 2 }));
          counts[quality] = (counts[quality] ?? 0) + 1;
          total++;
        }
      }
    }
    const [normal = 0, silver = 0, gold = 0] = counts;
    expect(gold / total).toBeGreaterThan(0.04);
    expect(gold / total).toBeLessThan(0.06);
    expect(silver / total).toBeGreaterThan(0.135);
    expect(silver / total).toBeLessThan(0.165);
    expect(normal / total).toBeGreaterThan(0.77);
    expect(normal / total).toBeLessThan(0.83);
  });

  it('varies with the harvest number, the day and the map', () => {
    const qualities = (fn: (n: number) => Quality): Set<Quality> => new Set(Array.from({ length: 200 }, (_, n) => fn(n)));
    expect(qualities((n) => harvestQuality(BASE, TARGET, matureCrop('blueberry', { harvestCount: n }))).size).toBe(3);
    expect(qualities((n) => harvestQuality(atDay(BASE, n), TARGET, matureCrop('blueberry'))).size).toBe(3);
    const onForest = { ...BASE, player: { ...BASE.player, mapId: 'forest' as const } };
    const farm = Array.from({ length: 200 }, (_, tx) => harvestQuality(BASE, { tx, tz: 3 }, matureCrop('mushroom')));
    const forest = Array.from({ length: 200 }, (_, tx) => harvestQuality(onForest, { tx, tz: 3 }, matureCrop('mushroom')));
    expect(forest).not.toEqual(farm);
  });
});

/** The first tile of the farm's clear zone whose parsnip harvest rolls `quality` today. */
function tileRolling(state: GameState, quality: Quality): { readonly tx: number; readonly tz: number } {
  for (let tz = 10; tz < 18; tz++) {
    for (let tx = 1; tx < 17; tx++) {
      if (harvestQuality(state, { tx, tz }, matureCrop('parsnip')) === quality) return { tx, tz };
    }
  }
  throw new Error(`no tile rolls quality ${quality}`);
}

/** A ripe parsnip on `at`, with the player standing just north of it, facing it. */
function ripeAt(state: GameState, at: { readonly tx: number; readonly tz: number }): GameState {
  const planted = withTile(state, at, soilTile(TileState.Watered, matureCrop('parsnip')));
  return withPlayer(withTile(planted, { tx: at.tx, tz: at.tz - 1 }, EMPTY_TILE), { tx: at.tx, tz: at.tz - 1 }, Direction.South);
}

describe('harvests at their rolled quality', () => {
  it.each([0, 1, 2] as const)('adds the produce at quality %i and names it', (quality) => {
    const at = tileRolling(BASE, quality);
    const state = ripeAt(BASE, at);
    const quantity = harvestQuantity(state, at, matureCrop('parsnip'));
    expect(planInteraction(state).intent).toEqual({ kind: 'harvest', quantity, quality });
    const next = gameReducer(state, actions.interact());
    const held = next.inventory.slots.find((slot) => slot !== null && slot.itemId === 'parsnip');
    expect(held).toEqual(stack('parsnip', quantity, quality));
    const name = ['Parsnip', 'Silver Parsnip', 'Gold Parsnip'][quality];
    expect(next.messages.entries.at(-1)?.text).toBe(`Harvested ${name} ×${quantity}.`);
    expect(tileAt(next, at).crop).toBeNull();
  });

  it('stacks a harvest onto produce of the same quality only', () => {
    const at = tileRolling(BASE, 1);
    const state = withSlots(ripeAt(BASE, at), [stack('hoe', 1), stack('parsnip', 5, 0), stack('parsnip', 5, 1)]);
    const quantity = harvestQuantity(state, at, matureCrop('parsnip'));
    const next = gameReducer(state, actions.interact());
    expect(next.inventory.slots[1]).toBe(state.inventory.slots[1]);
    expect(next.inventory.slots[2]).toEqual(stack('parsnip', 5 + quantity, 1));
  });

  it('is refused when only stacks of another quality have room', () => {
    const at = tileRolling(BASE, 2);
    const filler = Array.from({ length: INVENTORY.startingUnlockedSlots - 1 }, () => stack('stone', INVENTORY.maxStack));
    const state = withSlots(ripeAt(BASE, at), [stack('parsnip', 1, 0), ...filler]);
    const next = gameReducer(state, actions.interact());
    expect(next.inventory).toBe(state.inventory);
    expect(next.messages.entries.at(-1)?.text).toBe('Your inventory is full.');
    expect(tileAt(next, at).crop).toEqual(matureCrop('parsnip'));
  });
});

describe('shipping and the morning payout with qualities', () => {
  /** Standing at the shipping bin (LAYOUT.shippingBin starts at (9, 5)), facing it from the south. */
  function atBin(state: GameState): GameState {
    return withPlayer(state, { tx: 9, tz: 6 }, Direction.North);
  }

  it('ships each quality into its own pending stack and quotes the quality price', () => {
    let state = atBin(holding(BASE, 'parsnip', 4, 1));
    state = gameReducer(state, actions.interact());
    expect(state.shipping.pending).toEqual([stack('parsnip', 4, 1)]);
    expect(state.messages.entries.at(-1)?.text).toBe('Shipped Silver Parsnip ×4 — 172g tomorrow.');
    state = gameReducer(holding(state, 'parsnip', 2, 2), actions.interact());
    state = gameReducer(holding(state, 'parsnip', 3, 1), actions.interact());
    state = gameReducer(holding(state, 'parsnip', 5, 0), actions.interact());
    expect(state.shipping.pending).toEqual([stack('parsnip', 7, 1), stack('parsnip', 2, 2), stack('parsnip', 5, 0)]);
    expect(selectPendingShipmentValue(state)).toBe(7 * 43 + 2 * 52 + 5 * 35);
  });

  it('pays every stack at its quality price and counts the gold and the parsnips', () => {
    const pending = [stack('parsnip', 7, 1), stack('parsnip', 2, 2), stack('parsnip', 5, 0), stack('potato', 3, 2), stack('stone', 10)];
    const state: GameState = { ...BASE, shipping: { pending, lastPayout: 0 } };
    const payout = 7 * 43 + 2 * 52 + 5 * 35 + 3 * Math.floor(80 * 1.5) + 10 * 2;
    expect(selectPendingShipmentValue(state)).toBe(payout);
    const next = startNextDay(state, false);
    expect(next.player.gold).toBe(PLAYER.startingGold + payout);
    expect(next.shipping).toEqual({ pending: [], lastPayout: payout });
    expect(next.stats.totalEarned).toBe(payout);
    expect(next.stats.parsnipsShipped).toBe(14);
    expect(next.messages.entries.some((entry) => entry.text === `Your shipment sold for ${payout}g.`)).toBe(true);
    // The counters keep adding up, morning after morning.
    const again = startNextDay({ ...next, shipping: { pending: [stack('parsnip', 1, 2)], lastPayout: payout } }, false);
    expect(again.stats.totalEarned).toBe(payout + 52);
    expect(again.stats.parsnipsShipped).toBe(15);
  });

  it('leaves the counters untouched on a morning with nothing shipped', () => {
    const next = startNextDay(BASE, false);
    expect(next.stats).toBe(BASE.stats);
    const onlyStone = startNextDay({ ...BASE, shipping: { pending: [stack('stone', 3)], lastPayout: 0 } }, true);
    expect(onlyStone.stats.totalEarned).toBe(6);
    expect(onlyStone.stats.parsnipsShipped).toBe(0);
  });

  it('counts parsnips shipped through sleeping and passing out alike', () => {
    const shipped: GameState = { ...BASE, shipping: { pending: [stack('parsnip', 9, 1)], lastPayout: 0 } };
    const slept = gameReducer(shipped, actions.sleep());
    expect(slept.stats.parsnipsShipped).toBe(9);
    expect(slept.stats.totalEarned).toBe(9 * 43);
    const late = { ...shipped, time: { ...shipped.time, minuteOfDay: 25 * 60 + 55 } };
    const passedOut = gameReducer(late, actions.tick(10));
    expect(passedOut.stats).toEqual(slept.stats);
  });
});
