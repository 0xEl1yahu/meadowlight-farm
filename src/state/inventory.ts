/**
 * Pure inventory operations. Stacks merge up to each item's maxStack; empty slots are null.
 */
import { invariant } from '../core/invariant';
import type { InventoryState, ItemId, ItemStack, ToolType } from '../core/types';
import { getItem } from '../items/items';

export function createInventory(size: number, stacks: readonly ItemStack[], waterCapacity: number): InventoryState {
  invariant(Number.isInteger(size) && size > 0, `inventory size must be a positive integer, got ${size}`);
  invariant(stacks.length <= size, 'more starting stacks than inventory slots');
  const slots: (ItemStack | null)[] = Array.from({ length: size }, (_, i) => stacks[i] ?? null);
  for (const stack of slots) {
    if (stack !== null) assertValidStack(stack);
  }
  return { slots, selected: 0, water: waterCapacity, waterCapacity };
}

export function assertValidStack(stack: ItemStack): void {
  const item = getItem(stack.itemId);
  invariant(
    Number.isInteger(stack.quantity) && stack.quantity >= 1 && stack.quantity <= item.maxStack,
    `invalid quantity ${stack.quantity} for ${stack.itemId}`,
  );
}

export function selectedStack(inventory: InventoryState): ItemStack | null {
  return inventory.slots[inventory.selected] ?? null;
}

/** How many more units of `itemId` fit (existing stacks first, then empty slots). */
export function capacityFor(inventory: InventoryState, itemId: ItemId): number {
  const maxStack = getItem(itemId).maxStack;
  let room = 0;
  for (const stack of inventory.slots) {
    if (stack === null) room += maxStack;
    else if (stack.itemId === itemId) room += maxStack - stack.quantity;
  }
  return room;
}

/**
 * Adds up to `quantity` units. Tops up existing stacks in slot order, then fills empty slots
 * in slot order. Returns the new inventory and how many units were actually added.
 */
export function addItem(
  inventory: InventoryState,
  itemId: ItemId,
  quantity: number,
): { readonly inventory: InventoryState; readonly added: number } {
  invariant(Number.isInteger(quantity) && quantity >= 0, `addItem: invalid quantity ${quantity}`);
  if (quantity === 0) return { inventory, added: 0 };
  const maxStack = getItem(itemId).maxStack;
  const slots = inventory.slots.slice();
  let remaining = quantity;

  for (let i = 0; i < slots.length && remaining > 0; i++) {
    const stack = slots[i];
    if (stack === null || stack === undefined || stack.itemId !== itemId || stack.quantity >= maxStack) continue;
    const moved = Math.min(remaining, maxStack - stack.quantity);
    slots[i] = { itemId, quantity: stack.quantity + moved };
    remaining -= moved;
  }
  for (let i = 0; i < slots.length && remaining > 0; i++) {
    if (slots[i] !== null) continue;
    const moved = Math.min(remaining, maxStack);
    slots[i] = { itemId, quantity: moved };
    remaining -= moved;
  }

  const added = quantity - remaining;
  return added === 0 ? { inventory, added } : { inventory: { ...inventory, slots }, added };
}

/** Removes up to `quantity` units from one slot; the slot becomes null when emptied. */
export function removeFromSlot(inventory: InventoryState, slot: number, quantity: number): InventoryState {
  invariant(Number.isInteger(quantity) && quantity >= 1, `removeFromSlot: invalid quantity ${quantity}`);
  const stack = inventory.slots[slot];
  invariant(stack !== undefined && stack !== null, `removeFromSlot: slot ${slot} is empty`);
  invariant(stack.quantity >= quantity, `removeFromSlot: slot ${slot} holds ${stack.quantity} < ${quantity}`);
  const slots = inventory.slots.slice();
  slots[slot] = stack.quantity === quantity ? null : { itemId: stack.itemId, quantity: stack.quantity - quantity };
  return { ...inventory, slots };
}

export function countItem(inventory: InventoryState, itemId: ItemId): number {
  let total = 0;
  for (const stack of inventory.slots) {
    if (stack !== null && stack.itemId === itemId) total += stack.quantity;
  }
  return total;
}

export function hasTool(inventory: InventoryState, tool: ToolType): boolean {
  return countItem(inventory, tool) > 0;
}

/** Merges a stack into a list of stacks (used by the shipping bin, which has no size limit). */
export function mergeStacks(stacks: readonly ItemStack[], incoming: ItemStack): readonly ItemStack[] {
  const index = stacks.findIndex((stack) => stack.itemId === incoming.itemId);
  if (index === -1) return [...stacks, incoming];
  return stacks.map((stack, i) => (i === index ? { itemId: stack.itemId, quantity: stack.quantity + incoming.quantity } : stack));
}
