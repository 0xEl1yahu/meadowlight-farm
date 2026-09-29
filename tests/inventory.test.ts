/**
 * Pure inventory operations (src/state/inventory.ts) and the item registry
 * (src/items/items.ts): stacking rules on item and quality, partial adds against maxStack,
 * capacity maths within the unlocked slots, slot removal and shipping-bin stack merging — all
 * without mutating their inputs.
 */
import { describe, expect, it } from 'vitest';
import { INVENTORY, TOOLS } from '../src/config';
import { deepFreeze } from '../src/core/store';
import { InvariantError } from '../src/core/invariant';
import { CROP_IDS, MATERIAL_IDS, TOOL_TYPES, type InventoryState, type ItemStack } from '../src/core/types';
import { CROPS } from '../src/farming/crops';
import { ITEMS, getItem, isItemId, isSeedItemId } from '../src/items/items';
import {
  addItem,
  assertValidStack,
  capacityFor,
  countItem,
  createInventory,
  hasTool,
  mergeStacks,
  removeFromSlot,
  selectedStack,
} from '../src/state/inventory';
import { stack } from './testUtils';

const MAX = INVENTORY.maxStack;
const UNLOCKED = INVENTORY.startingUnlockedSlots;
/** Fills every unlocked slot a test doesn't use: a full, single-unit tool stack that takes no other item. */
const FILLER = stack('scythe', 1);

/**
 * A frozen 36-slot inventory holding `stacks` in slots 0 … usable - 1. The other unlocked
 * slots hold FILLER, so only the first `usable` slots take new items; the locked slots are
 * empty, as always.
 */
function inventory(stacks: readonly (ItemStack | null)[], usable = 4): InventoryState {
  const slots = Array.from({ length: INVENTORY.slotCount }, (_, i) => {
    if (i < usable) return stacks[i] ?? null;
    return i < UNLOCKED ? FILLER : null;
  });
  return deepFreeze({ slots, unlockedSlots: UNLOCKED, selected: 0, water: 10, waterCapacity: 40 });
}

/** The first `usable` slots, the part of an `inventory(...)` a test controls. */
function head(inv: InventoryState, usable = 4): readonly (ItemStack | null)[] {
  return inv.slots.slice(0, usable);
}

describe('item registry', () => {
  it('registers every tool, seed, produce and material exactly once', () => {
    expect(ITEMS.size).toBe(TOOL_TYPES.length + 2 * CROP_IDS.length + MATERIAL_IDS.length);
    for (const tool of TOOL_TYPES) {
      const item = getItem(tool);
      expect(item.kind).toBe('tool');
      expect(item.maxStack).toBe(1);
      expect(item.sellPrice).toBeNull();
      if (item.kind === 'tool') expect(item.energyCost).toBe(TOOLS.energyCost[tool]);
    }
    for (const id of CROP_IDS) {
      const seed = getItem(`${id}_seeds`);
      expect(seed.kind).toBe('seed');
      if (seed.kind === 'seed') {
        expect(seed.cropId).toBe(id);
        expect(seed.price).toBe(CROPS[id].seedPrice);
      }
      expect(seed.sellPrice).toBe(Math.max(1, Math.floor(CROPS[id].seedPrice / 2)));
      const produce = getItem(id);
      expect(produce.kind).toBe('produce');
      expect(produce.sellPrice).toBe(CROPS[id].sellPrice);
      expect(produce.maxStack).toBe(MAX);
    }
    for (const material of MATERIAL_IDS) expect(getItem(material).kind).toBe('material');
  });

  it('gives quality to produce only', () => {
    for (const item of ITEMS.values()) expect(item.hasQuality).toBe(item.kind === 'produce');
  });

  it('validates item ids', () => {
    expect(isItemId('hoe')).toBe(true);
    expect(isItemId('parsnip_seeds')).toBe(true);
    expect(isItemId('diamond')).toBe(false);
    expect(isItemId(7)).toBe(false);
    expect(isSeedItemId('corn_seeds')).toBe(true);
    expect(isSeedItemId('corn')).toBe(false);
    expect(isSeedItemId('axe')).toBe(false);
    expect(() => getItem('diamond' as never)).toThrow(RangeError);
  });
});

describe('createInventory', () => {
  it('makes 36 slots, 24 unlocked, selects slot 0 and fills the watering can', () => {
    const inv = createInventory(INVENTORY.starting, TOOLS.wateringCanCapacity);
    expect(inv.slots).toHaveLength(36);
    expect(inv.unlockedSlots).toBe(24);
    expect(inv.slots.slice(0, 6)).toEqual(INVENTORY.starting);
    expect(inv.slots.slice(6).every((slot) => slot === null)).toBe(true);
    expect(inv.selected).toBe(0);
    expect(inv.water).toBe(40);
    expect(inv.waterCapacity).toBe(40);
  });

  it('gives every starting stack normal quality', () => {
    for (const starting of INVENTORY.starting) expect(starting.quality).toBe(0);
  });

  it('rejects more stacks than unlocked slots, and invalid stacks', () => {
    const tooMany = Array.from({ length: UNLOCKED + 1 }, () => stack('stone', 1));
    expect(() => createInventory(tooMany, 10)).toThrow(InvariantError);
    expect(() => createInventory(tooMany.slice(1), 10)).not.toThrow();
    expect(() => createInventory([stack('hoe', 2)], 10)).toThrow(InvariantError);
    expect(() => createInventory([stack('stone', 0)], 10)).toThrow(InvariantError);
    expect(() => createInventory([stack('stone', 1, 1)], 10)).toThrow(InvariantError);
  });

  it('assertValidStack enforces 1 ≤ quantity ≤ maxStack, integer quantities and quality rules', () => {
    expect(() => assertValidStack(stack('stone', MAX))).not.toThrow();
    expect(() => assertValidStack(stack('stone', MAX + 1))).toThrow(InvariantError);
    expect(() => assertValidStack(stack('stone', 1.5))).toThrow(InvariantError);
    expect(() => assertValidStack(stack('axe', 2))).toThrow(InvariantError);
    expect(() => assertValidStack(stack('parsnip', 5, 1))).not.toThrow();
    expect(() => assertValidStack(stack('parsnip', 5, 2))).not.toThrow();
    expect(() => assertValidStack(stack('stone', 5, 1))).toThrow(InvariantError);
    expect(() => assertValidStack(stack('parsnip_seeds', 5, 2))).toThrow(InvariantError);
    expect(() => assertValidStack(stack('hoe', 1, 1))).toThrow(InvariantError);
    expect(() => assertValidStack({ itemId: 'parsnip', quantity: 1, quality: 3 as never })).toThrow(InvariantError);
  });
});

describe('addItem', () => {
  it('tops up an existing stack before using empty slots', () => {
    const inv = inventory([null, stack('stone', 5)]);
    const { inventory: next, added } = addItem(inv, 'stone', 3);
    expect(added).toBe(3);
    expect(head(next)).toEqual([null, stack('stone', 8), null, null]);
  });

  it('fills partial stacks in slot order, then empty slots in slot order', () => {
    const inv = inventory([stack('wood', MAX - 2), null, stack('wood', MAX - 3), null]);
    const { inventory: next, added } = addItem(inv, 'wood', 10);
    expect(added).toBe(10);
    expect(head(next)).toEqual([stack('wood', MAX), stack('wood', 5), stack('wood', MAX), null]);
  });

  it('keeps the identity of every slot it does not change (full stacks, other items)', () => {
    const inv = inventory([stack('wood', MAX), stack('hoe', 1), stack('wood', 7), null]);
    const { inventory: next } = addItem(inv, 'wood', 3);
    expect(next.slots[0]).toBe(inv.slots[0]);
    expect(next.slots[1]).toBe(inv.slots[1]);
    expect(next.slots[2]).toEqual(stack('wood', 10));
    expect(next.slots[3]).toBeNull();
    for (let i = 4; i < INVENTORY.slotCount; i++) expect(next.slots[i]).toBe(inv.slots[i]);
  });

  it('splits quantities larger than maxStack across empty slots', () => {
    const { inventory: next, added } = addItem(inventory([]), 'parsnip', 2 * MAX + 7);
    expect(added).toBe(2 * MAX + 7);
    expect(head(next)).toEqual([stack('parsnip', MAX), stack('parsnip', MAX), stack('parsnip', 7), null]);
  });

  it('adds only what fits and reports the partial amount', () => {
    const inv = inventory([stack('hoe', 1), stack('stone', MAX - 4), stack('axe', 1), null]);
    const { inventory: next, added } = addItem(inv, 'stone', MAX + 100);
    expect(added).toBe(4 + MAX);
    expect(next.slots[1]).toEqual(stack('stone', MAX));
    expect(next.slots[3]).toEqual(stack('stone', MAX));
    expect(capacityFor(next, 'stone')).toBe(0);
  });

  it('respects maxStack 1 for tools', () => {
    const { inventory: next, added } = addItem(inventory([stack('hoe', 1)]), 'hoe', 5);
    expect(added).toBe(3);
    expect(head(next)).toEqual([stack('hoe', 1), stack('hoe', 1), stack('hoe', 1), stack('hoe', 1)]);
  });

  it('returns the same inventory when nothing is added', () => {
    const full = inventory([stack('hoe', 1), stack('axe', 1), stack('wood', MAX), stack('stone', 3)]);
    const zero = addItem(full, 'stone', 0);
    expect(zero.inventory).toBe(full);
    expect(zero.added).toBe(0);
    const none = addItem(full, 'wood', 10);
    expect(none.inventory).toBe(full);
    expect(none.added).toBe(0);
  });

  it('never mutates its input (frozen inventories work) and keeps other fields', () => {
    const inv = inventory([stack('stone', 1)]);
    const { inventory: next } = addItem(inv, 'stone', 2);
    expect(inv.slots[0]).toEqual(stack('stone', 1));
    expect(next.water).toBe(inv.water);
    expect(next.waterCapacity).toBe(inv.waterCapacity);
    expect(next.selected).toBe(inv.selected);
    expect(next.unlockedSlots).toBe(inv.unlockedSlots);
  });

  it('rejects negative and fractional quantities', () => {
    expect(() => addItem(inventory([]), 'stone', -1)).toThrow(InvariantError);
    expect(() => addItem(inventory([]), 'stone', 1.5)).toThrow(InvariantError);
  });

  it('always adds exactly min(quantity, capacityFor) units', () => {
    const inv = inventory([stack('stone', 990), null, stack('wood', 3), stack('stone', 999), null], 5);
    for (const quantity of [0, 1, 9, 10, 500, 2007, 2008, 2009, 5000]) {
      const capacity = capacityFor(inv, 'stone');
      const { inventory: next, added } = addItem(inv, 'stone', quantity);
      expect(added).toBe(Math.min(quantity, capacity));
      expect(countItem(next, 'stone')).toBe(countItem(inv, 'stone') + added);
      for (const held of next.slots) if (held !== null) expect(held.quantity).toBeLessThanOrEqual(MAX);
    }
  });

  it('merges only into stacks of the same quality', () => {
    const inv = inventory([stack('parsnip', 5, 0), stack('parsnip', 5, 1), stack('parsnip', 5, 2), null]);
    const silver = addItem(inv, 'parsnip', 3, 1).inventory;
    expect(head(silver)).toEqual([stack('parsnip', 5, 0), stack('parsnip', 8, 1), stack('parsnip', 5, 2), null]);
    const gold = addItem(inv, 'parsnip', 4, 2).inventory;
    expect(head(gold)).toEqual([stack('parsnip', 5, 0), stack('parsnip', 5, 1), stack('parsnip', 9, 2), null]);
    const normal = addItem(inv, 'parsnip', 2).inventory;
    expect(head(normal)).toEqual([stack('parsnip', 7, 0), stack('parsnip', 5, 1), stack('parsnip', 5, 2), null]);
  });

  it('starts a new stack for a quality it does not hold yet', () => {
    const inv = inventory([stack('parsnip', 5, 0), null, null, null]);
    const { inventory: next, added } = addItem(inv, 'parsnip', 2, 2);
    expect(added).toBe(2);
    expect(head(next)).toEqual([stack('parsnip', 5, 0), stack('parsnip', 2, 2), null, null]);
  });

  it('fills the backpack after the hotbar but never a locked slot', () => {
    const hotbar = Array.from({ length: INVENTORY.hotbarSize }, () => stack('hoe', 1));
    const inv = inventory(hotbar, UNLOCKED);
    const { inventory: next, added } = addItem(inv, 'wood', 13 * MAX);
    expect(added).toBe(12 * MAX);
    for (let i = INVENTORY.hotbarSize; i < UNLOCKED; i++) expect(next.slots[i]).toEqual(stack('wood', MAX));
    for (let i = UNLOCKED; i < INVENTORY.slotCount; i++) expect(next.slots[i]).toBeNull();
  });

  it('uses all 36 slots once they are unlocked', () => {
    const inv: InventoryState = { ...inventory([], UNLOCKED), unlockedSlots: 36 };
    const { inventory: next, added } = addItem(inv, 'stone', 40 * MAX);
    expect(added).toBe(36 * MAX);
    expect(next.slots.every((slot) => slot !== null && slot.itemId === 'stone')).toBe(true);
  });
});

describe('capacityFor', () => {
  it('counts room in matching stacks plus maxStack per empty slot', () => {
    expect(capacityFor(inventory([]), 'stone')).toBe(4 * MAX);
    expect(capacityFor(inventory([]), 'hoe')).toBe(4);
    const inv = inventory([stack('stone', 900), stack('wood', 1), null, stack('hoe', 1)]);
    expect(capacityFor(inv, 'stone')).toBe(99 + MAX);
    expect(capacityFor(inv, 'wood')).toBe(MAX - 1 + MAX);
    expect(capacityFor(inv, 'hoe')).toBe(1);
    expect(capacityFor(inv, 'parsnip_seeds')).toBe(MAX);
  });

  it('counts room only in stacks of the asked quality', () => {
    const inv = inventory([stack('parsnip', 900, 0), stack('parsnip', 990, 1), null, stack('parsnip', 1, 2)]);
    expect(capacityFor(inv, 'parsnip')).toBe(99 + MAX);
    expect(capacityFor(inv, 'parsnip', 0)).toBe(99 + MAX);
    expect(capacityFor(inv, 'parsnip', 1)).toBe(9 + MAX);
    expect(capacityFor(inv, 'parsnip', 2)).toBe(MAX - 1 + MAX);
  });

  it('ignores the locked slots', () => {
    const fresh = createInventory([], 10);
    expect(capacityFor(fresh, 'stone')).toBe(UNLOCKED * MAX);
    expect(capacityFor({ ...fresh, unlockedSlots: 36 }, 'stone')).toBe(INVENTORY.slotCount * MAX);
  });
});

describe('removeFromSlot', () => {
  const inv = inventory([stack('parsnip_seeds', 5), stack('hoe', 1), null, stack('parsnip', 4, 2)]);

  it('removes part of a stack and keeps its quality', () => {
    const next = removeFromSlot(inv, 0, 2);
    expect(next.slots[0]).toEqual(stack('parsnip_seeds', 3));
    expect(next.slots[1]).toBe(inv.slots[1]);
    expect(inv.slots[0]).toEqual(stack('parsnip_seeds', 5));
    expect(removeFromSlot(inv, 3, 1).slots[3]).toEqual(stack('parsnip', 3, 2));
  });

  it('empties the slot (null) when the whole stack is removed', () => {
    expect(removeFromSlot(inv, 0, 5).slots[0]).toBeNull();
    expect(removeFromSlot(inv, 1, 1).slots[1]).toBeNull();
  });

  it('rejects removing more than the stack, from empty slots, or non-positive amounts', () => {
    expect(() => removeFromSlot(inv, 0, 6)).toThrow(InvariantError);
    expect(() => removeFromSlot(inv, 2, 1)).toThrow(InvariantError);
    expect(() => removeFromSlot(inv, 99, 1)).toThrow(InvariantError);
    expect(() => removeFromSlot(inv, 0, 0)).toThrow(InvariantError);
    expect(() => removeFromSlot(inv, 0, 1.5)).toThrow(InvariantError);
  });
});

describe('mergeStacks', () => {
  it('appends new items and merges existing ones without a stack limit', () => {
    const empty: readonly ItemStack[] = deepFreeze([]);
    const one = mergeStacks(empty, stack('parsnip', 3));
    expect(one).toEqual([stack('parsnip', 3)]);
    const two = mergeStacks(one, stack('stone', 1));
    expect(two).toEqual([stack('parsnip', 3), stack('stone', 1)]);
    const merged = mergeStacks(deepFreeze(two), stack('parsnip', MAX));
    expect(merged).toEqual([stack('parsnip', 3 + MAX), stack('stone', 1)]);
    expect(merged[1]).toBe(two[1]);
    expect(two[0]).toEqual(stack('parsnip', 3));
  });

  it('merges on item and quality: each quality keeps its own stack', () => {
    const pending = deepFreeze([stack('parsnip', 3, 0), stack('parsnip', 2, 1)]);
    expect(mergeStacks(pending, stack('parsnip', 4, 1))).toEqual([stack('parsnip', 3, 0), stack('parsnip', 6, 1)]);
    expect(mergeStacks(pending, stack('parsnip', 1, 2))).toEqual([
      stack('parsnip', 3, 0),
      stack('parsnip', 2, 1),
      stack('parsnip', 1, 2),
    ]);
  });
});

describe('queries', () => {
  it('countItem sums across stacks and qualities; hasTool; selectedStack follows the selection', () => {
    const inv: InventoryState = {
      ...inventory([stack('stone', 4), stack('axe', 1), stack('stone', 6), null]),
      selected: 1,
    };
    expect(countItem(inv, 'stone')).toBe(10);
    expect(countItem(inv, 'wood')).toBe(0);
    expect(hasTool(inv, 'axe')).toBe(true);
    expect(hasTool(inv, 'hoe')).toBe(false);
    expect(selectedStack(inv)).toEqual(stack('axe', 1));
    expect(selectedStack({ ...inv, selected: 3 })).toBeNull();
    expect(selectedStack({ ...inv, selected: 47 })).toBeNull();
    const mixed = inventory([stack('parsnip', 4, 0), stack('parsnip', 5, 1), stack('parsnip', 6, 2), null]);
    expect(countItem(mixed, 'parsnip')).toBe(15);
  });
});
