/**
 * Pure inventory operations (src/state/inventory.ts) and the item registry
 * (src/items/items.ts): stacking rules, partial adds against maxStack, capacity maths,
 * slot removal and shipping-bin stack merging — all without mutating their inputs.
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

const MAX = INVENTORY.maxStack;

function inventory(stacks: readonly (ItemStack | null)[], size = 4): InventoryState {
  const slots = Array.from({ length: size }, (_, i) => stacks[i] ?? null);
  return deepFreeze({ slots, selected: 0, water: 10, waterCapacity: 40 });
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
  it('pads with empty slots, selects slot 0 and fills the watering can', () => {
    const inv = createInventory(INVENTORY.hotbarSize, INVENTORY.starting, TOOLS.wateringCanCapacity);
    expect(inv.slots).toHaveLength(12);
    expect(inv.slots.slice(0, 6)).toEqual(INVENTORY.starting);
    expect(inv.slots.slice(6)).toEqual([null, null, null, null, null, null]);
    expect(inv.selected).toBe(0);
    expect(inv.water).toBe(40);
    expect(inv.waterCapacity).toBe(40);
  });

  it('rejects bad sizes, too many stacks and invalid stacks', () => {
    expect(() => createInventory(0, [], 10)).toThrow(InvariantError);
    expect(() => createInventory(1.5, [], 10)).toThrow(InvariantError);
    expect(() => createInventory(1, [{ itemId: 'hoe', quantity: 1 }, { itemId: 'axe', quantity: 1 }], 10)).toThrow(InvariantError);
    expect(() => createInventory(2, [{ itemId: 'hoe', quantity: 2 }], 10)).toThrow(InvariantError);
    expect(() => createInventory(2, [{ itemId: 'stone', quantity: 0 }], 10)).toThrow(InvariantError);
  });

  it('assertValidStack enforces 1 ≤ quantity ≤ maxStack and integer quantities', () => {
    expect(() => assertValidStack({ itemId: 'stone', quantity: MAX })).not.toThrow();
    expect(() => assertValidStack({ itemId: 'stone', quantity: MAX + 1 })).toThrow(InvariantError);
    expect(() => assertValidStack({ itemId: 'stone', quantity: 1.5 })).toThrow(InvariantError);
    expect(() => assertValidStack({ itemId: 'axe', quantity: 2 })).toThrow(InvariantError);
  });
});

describe('addItem', () => {
  it('tops up an existing stack before using empty slots', () => {
    const inv = inventory([null, { itemId: 'stone', quantity: 5 }]);
    const { inventory: next, added } = addItem(inv, 'stone', 3);
    expect(added).toBe(3);
    expect(next.slots).toEqual([null, { itemId: 'stone', quantity: 8 }, null, null]);
  });

  it('fills partial stacks in slot order, then empty slots in slot order', () => {
    const inv = inventory([
      { itemId: 'wood', quantity: MAX - 2 },
      null,
      { itemId: 'wood', quantity: MAX - 3 },
      null,
    ]);
    const { inventory: next, added } = addItem(inv, 'wood', 10);
    expect(added).toBe(10);
    expect(next.slots).toEqual([
      { itemId: 'wood', quantity: MAX },
      { itemId: 'wood', quantity: 5 },
      { itemId: 'wood', quantity: MAX },
      null,
    ]);
  });

  it('keeps the identity of every slot it does not change (full stacks, other items)', () => {
    const inv = inventory([
      { itemId: 'wood', quantity: MAX },
      { itemId: 'hoe', quantity: 1 },
      { itemId: 'wood', quantity: 7 },
      null,
    ]);
    const { inventory: next } = addItem(inv, 'wood', 3);
    expect(next.slots[0]).toBe(inv.slots[0]);
    expect(next.slots[1]).toBe(inv.slots[1]);
    expect(next.slots[2]).toEqual({ itemId: 'wood', quantity: 10 });
    expect(next.slots[3]).toBeNull();
  });

  it('splits quantities larger than maxStack across empty slots', () => {
    const { inventory: next, added } = addItem(inventory([]), 'parsnip', 2 * MAX + 7);
    expect(added).toBe(2 * MAX + 7);
    expect(next.slots).toEqual([
      { itemId: 'parsnip', quantity: MAX },
      { itemId: 'parsnip', quantity: MAX },
      { itemId: 'parsnip', quantity: 7 },
      null,
    ]);
  });

  it('adds only what fits and reports the partial amount', () => {
    const inv = inventory([
      { itemId: 'hoe', quantity: 1 },
      { itemId: 'stone', quantity: MAX - 4 },
      { itemId: 'axe', quantity: 1 },
      null,
    ]);
    const { inventory: next, added } = addItem(inv, 'stone', MAX + 100);
    expect(added).toBe(4 + MAX);
    expect(next.slots[1]).toEqual({ itemId: 'stone', quantity: MAX });
    expect(next.slots[3]).toEqual({ itemId: 'stone', quantity: MAX });
    expect(capacityFor(next, 'stone')).toBe(0);
  });

  it('respects maxStack 1 for tools', () => {
    const { inventory: next, added } = addItem(inventory([{ itemId: 'hoe', quantity: 1 }]), 'hoe', 5);
    expect(added).toBe(3);
    expect(next.slots).toEqual([
      { itemId: 'hoe', quantity: 1 },
      { itemId: 'hoe', quantity: 1 },
      { itemId: 'hoe', quantity: 1 },
      { itemId: 'hoe', quantity: 1 },
    ]);
  });

  it('returns the same inventory when nothing is added', () => {
    const full = inventory([
      { itemId: 'hoe', quantity: 1 },
      { itemId: 'axe', quantity: 1 },
      { itemId: 'wood', quantity: MAX },
      { itemId: 'stone', quantity: 3 },
    ]);
    const zero = addItem(full, 'stone', 0);
    expect(zero.inventory).toBe(full);
    expect(zero.added).toBe(0);
    const none = addItem(full, 'wood', 10);
    expect(none.inventory).toBe(full);
    expect(none.added).toBe(0);
  });

  it('never mutates its input (frozen inventories work) and keeps other fields', () => {
    const inv = inventory([{ itemId: 'stone', quantity: 1 }]);
    const { inventory: next } = addItem(inv, 'stone', 2);
    expect(inv.slots[0]).toEqual({ itemId: 'stone', quantity: 1 });
    expect(next.water).toBe(inv.water);
    expect(next.waterCapacity).toBe(inv.waterCapacity);
    expect(next.selected).toBe(inv.selected);
  });

  it('rejects negative and fractional quantities', () => {
    expect(() => addItem(inventory([]), 'stone', -1)).toThrow(InvariantError);
    expect(() => addItem(inventory([]), 'stone', 1.5)).toThrow(InvariantError);
  });

  it('always adds exactly min(quantity, capacityFor) units', () => {
    const inv = inventory(
      [{ itemId: 'stone', quantity: 990 }, null, { itemId: 'wood', quantity: 3 }, { itemId: 'stone', quantity: 999 }, null],
      5,
    );
    for (const quantity of [0, 1, 9, 10, 500, 2007, 2008, 2009, 5000]) {
      const capacity = capacityFor(inv, 'stone');
      const { inventory: next, added } = addItem(inv, 'stone', quantity);
      expect(added).toBe(Math.min(quantity, capacity));
      expect(countItem(next, 'stone')).toBe(countItem(inv, 'stone') + added);
      for (const stack of next.slots) if (stack !== null) expect(stack.quantity).toBeLessThanOrEqual(MAX);
    }
  });
});

describe('capacityFor', () => {
  it('counts room in matching stacks plus maxStack per empty slot', () => {
    expect(capacityFor(inventory([]), 'stone')).toBe(4 * MAX);
    expect(capacityFor(inventory([]), 'hoe')).toBe(4);
    const inv = inventory([{ itemId: 'stone', quantity: 900 }, { itemId: 'wood', quantity: 1 }, null, { itemId: 'hoe', quantity: 1 }]);
    expect(capacityFor(inv, 'stone')).toBe(99 + MAX);
    expect(capacityFor(inv, 'wood')).toBe(MAX - 1 + MAX);
    expect(capacityFor(inv, 'hoe')).toBe(1);
    expect(capacityFor(inv, 'parsnip_seeds')).toBe(MAX);
  });
});

describe('removeFromSlot', () => {
  const inv = inventory([{ itemId: 'parsnip_seeds', quantity: 5 }, { itemId: 'hoe', quantity: 1 }]);

  it('removes part of a stack', () => {
    const next = removeFromSlot(inv, 0, 2);
    expect(next.slots[0]).toEqual({ itemId: 'parsnip_seeds', quantity: 3 });
    expect(next.slots[1]).toBe(inv.slots[1]);
    expect(inv.slots[0]).toEqual({ itemId: 'parsnip_seeds', quantity: 5 });
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
    const one = mergeStacks(empty, { itemId: 'parsnip', quantity: 3 });
    expect(one).toEqual([{ itemId: 'parsnip', quantity: 3 }]);
    const two = mergeStacks(one, { itemId: 'stone', quantity: 1 });
    expect(two).toEqual([
      { itemId: 'parsnip', quantity: 3 },
      { itemId: 'stone', quantity: 1 },
    ]);
    const merged = mergeStacks(deepFreeze(two), { itemId: 'parsnip', quantity: MAX });
    expect(merged).toEqual([
      { itemId: 'parsnip', quantity: 3 + MAX },
      { itemId: 'stone', quantity: 1 },
    ]);
    expect(merged[1]).toBe(two[1]);
    expect(two[0]).toEqual({ itemId: 'parsnip', quantity: 3 });
  });
});

describe('queries', () => {
  it('countItem sums across stacks; hasTool; selectedStack follows the selection', () => {
    const inv: InventoryState = {
      ...inventory([{ itemId: 'stone', quantity: 4 }, { itemId: 'axe', quantity: 1 }, { itemId: 'stone', quantity: 6 }, null]),
      selected: 1,
    };
    expect(countItem(inv, 'stone')).toBe(10);
    expect(countItem(inv, 'wood')).toBe(0);
    expect(hasTool(inv, 'axe')).toBe(true);
    expect(hasTool(inv, 'hoe')).toBe(false);
    expect(selectedStack(inv)).toEqual({ itemId: 'axe', quantity: 1 });
    expect(selectedStack({ ...inv, selected: 3 })).toBeNull();
    expect(selectedStack({ ...inv, selected: 17 })).toBeNull();
  });
});
