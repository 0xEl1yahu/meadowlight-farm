/**
 * Pure inventory operations. Stacks merge up to each item's maxStack, and only when both the
 * item and the quality match; empty slots are null. Only slots below `unlockedSlots` ever hold
 * anything.
 */
import { INVENTORY } from '../config';
import { invariant } from '../core/invariant';
import type { InventoryState, ItemId, ItemStack, Quality, ToolType } from '../core/types';
import { getItem } from '../items/items';

/**
 * A fresh inventory: INVENTORY.slotCount slots, the first INVENTORY.startingUnlockedSlots of
 * them usable, holding `stacks` from slot 0 onwards, and a full watering can.
 */
export function createInventory(stacks: readonly ItemStack[], waterCapacity: number): InventoryState {
  const unlockedSlots = INVENTORY.startingUnlockedSlots;
  invariant(stacks.length <= unlockedSlots, 'more starting stacks than unlocked inventory slots');
  const slots: (ItemStack | null)[] = Array.from({ length: INVENTORY.slotCount }, (_, i) => stacks[i] ?? null);
  for (const stack of slots) {
    if (stack !== null) assertValidStack(stack);
  }
  return { slots, unlockedSlots, selected: 0, water: waterCapacity, waterCapacity };
}

/** Quantity 1 … maxStack, and a nonzero quality only on items that have one. */
export function assertValidStack(stack: ItemStack): void {
  const item = getItem(stack.itemId);
  invariant(
    Number.isInteger(stack.quantity) && stack.quantity >= 1 && stack.quantity <= item.maxStack,
    `invalid quantity ${stack.quantity} for ${stack.itemId}`,
  );
  invariant(
    stack.quality === 0 || stack.quality === 1 || stack.quality === 2,
    `invalid quality ${String(stack.quality)} for ${stack.itemId}`,
  );
  invariant(stack.quality === 0 || item.hasQuality, `${stack.itemId} has no quality, got ${stack.quality}`);
}

/** Whether two stacks may merge: the same item at the same quality. */
export function sameKind(a: ItemStack, b: ItemStack): boolean {
  return a.itemId === b.itemId && a.quality === b.quality;
}

export function selectedStack(inventory: InventoryState): ItemStack | null {
  return inventory.slots[inventory.selected] ?? null;
}

/** How many more units of `itemId` at `quality` fit (matching stacks first, then empty unlocked slots). */
export function capacityFor(inventory: InventoryState, itemId: ItemId, quality: Quality = 0): number {
  const maxStack = getItem(itemId).maxStack;
  let room = 0;
  for (let i = 0; i < inventory.unlockedSlots; i++) {
    const stack = inventory.slots[i] ?? null;
    if (stack === null) room += maxStack;
    else if (stack.itemId === itemId && stack.quality === quality) room += maxStack - stack.quantity;
  }
  return room;
}

/**
 * Adds up to `quantity` units of `itemId` at `quality`, exactly as many as `capacityFor`
 * allows. Tops up matching stacks in slot order, then fills empty unlocked slots in slot
 * order. Returns the new inventory and how many units were added; when none were, the same
 * inventory comes back. Callers that need everything to fit check `capacityFor` first.
 */
export function addItem(
  inventory: InventoryState,
  itemId: ItemId,
  quantity: number,
  quality: Quality = 0,
): { readonly inventory: InventoryState; readonly added: number } {
  invariant(Number.isInteger(quantity) && quantity >= 0, `addItem: invalid quantity ${quantity}`);
  if (quantity === 0) return { inventory, added: 0 };
  const maxStack = getItem(itemId).maxStack;
  const slots = inventory.slots.slice();
  let remaining = quantity;

  for (let i = 0; i < inventory.unlockedSlots && remaining > 0; i++) {
    const stack = slots[i] ?? null;
    if (stack === null || stack.itemId !== itemId || stack.quality !== quality || stack.quantity >= maxStack) continue;
    const moved = Math.min(remaining, maxStack - stack.quantity);
    slots[i] = { itemId, quantity: stack.quantity + moved, quality };
    remaining -= moved;
  }
  for (let i = 0; i < inventory.unlockedSlots && remaining > 0; i++) {
    if (slots[i] !== null) continue;
    const moved = Math.min(remaining, maxStack);
    slots[i] = { itemId, quantity: moved, quality };
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
  slots[slot] = stack.quantity === quantity ? null : { ...stack, quantity: stack.quantity - quantity };
  return { ...inventory, slots };
}

/** Units of `itemId` held, summed across every quality. */
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

/** Merges a stack into a list of stacks on item and quality (the shipping bin, which has no size limit). */
export function mergeStacks(stacks: readonly ItemStack[], incoming: ItemStack): readonly ItemStack[] {
  const index = stacks.findIndex((stack) => sameKind(stack, incoming));
  if (index === -1) return [...stacks, incoming];
  return stacks.map((stack, i) => (i === index ? { ...stack, quantity: stack.quantity + incoming.quantity } : stack));
}

// ---------------------------------------------------------------------------
// Slot moves (inventory/move)
// ---------------------------------------------------------------------------

export type Slots = readonly (ItemStack | null)[];

/**
 * What moving `q` units of `src` onto `dst` leaves in the two slots, or null for a no-op:
 * - an empty target takes `q` units, and the source keeps the rest (null when none);
 * - the same item at the same quality tops the target up to maxStack (a no-op when it is full);
 * - a different item or quality swaps the two stacks when the whole source moves;
 * - anything else (part of a stack onto a different one) is a no-op.
 */
function resolveMove(
  src: ItemStack,
  dst: ItemStack | null,
  q: number,
): { readonly src: ItemStack | null; readonly dst: ItemStack } | null {
  const rest = (moved: number): ItemStack | null => (moved === src.quantity ? null : { ...src, quantity: src.quantity - moved });
  if (dst === null) return { src: rest(q), dst: { ...src, quantity: q } };
  if (sameKind(src, dst)) {
    const moved = Math.min(q, getItem(dst.itemId).maxStack - dst.quantity);
    return moved <= 0 ? null : { src: rest(moved), dst: { ...dst, quantity: dst.quantity + moved } };
  }
  return q === src.quantity ? { src: dst, dst: src } : null;
}

/**
 * The pure slot-array move behind `inventory/move`: `q` units from `srcSlots[srcIndex]` to
 * `dstSlots[dstIndex]`. The two arrays may be the same array (a move inside one container), in
 * which case both results are the same new array. Returns null for a no-op (the same slot, a
 * full target stack, part of a stack onto a different item). The source slot must hold a stack
 * and `q` must be an integer in 1 … its quantity. Untouched slots keep their identity.
 */
export function moveBetweenSlots(
  srcSlots: Slots,
  srcIndex: number,
  dstSlots: Slots,
  dstIndex: number,
  q: number,
): { readonly src: Slots; readonly dst: Slots } | null {
  const src = srcSlots[srcIndex];
  invariant(src !== undefined && src !== null, `moveBetweenSlots: source slot ${srcIndex} is empty`);
  invariant(dstIndex >= 0 && dstIndex < dstSlots.length, `moveBetweenSlots: target slot ${dstIndex} is out of range`);
  invariant(Number.isInteger(q) && q >= 1 && q <= src.quantity, `moveBetweenSlots: invalid quantity ${q}`);
  const same = srcSlots === dstSlots;
  if (same && srcIndex === dstIndex) return null;
  const result = resolveMove(src, dstSlots[dstIndex] ?? null, q);
  if (result === null) return null;
  const nextSrc = srcSlots.slice();
  const nextDst = same ? nextSrc : dstSlots.slice();
  nextSrc[srcIndex] = result.src;
  nextDst[dstIndex] = result.dst;
  for (const stack of [result.src, result.dst]) if (stack !== null) assertValidStack(stack);
  return { src: nextSrc, dst: nextDst };
}

/** A move between two slots of one container; null for a no-op. */
export function moveWithinSlots(slots: Slots, srcIndex: number, dstIndex: number, q: number): Slots | null {
  return moveBetweenSlots(slots, srcIndex, slots, dstIndex, q)?.src ?? null;
}

/** A move from one container to another (player ↔ chest); null for a no-op. */
export function moveAcrossSlots(
  srcSlots: Slots,
  srcIndex: number,
  dstSlots: Slots,
  dstIndex: number,
  q: number,
): { readonly src: Slots; readonly dst: Slots } | null {
  invariant(srcSlots !== dstSlots, 'moveAcrossSlots: use moveWithinSlots for one container');
  return moveBetweenSlots(srcSlots, srcIndex, dstSlots, dstIndex, q);
}
