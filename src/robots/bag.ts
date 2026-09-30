/**
 * Stack arithmetic for robot bags (a short list of stacks) and chest slots (a fixed array).
 * Mirrors state/inventory.ts's rules: stacks merge on item and quality up to the item's maxStack.
 */
import type { ItemId, ItemStack, Quality } from '../core/types';
import { getItem } from '../items/items';
import { sameKind, type Slots } from '../state/inventory';

export type { Slots };

export function bagCount(bag: readonly ItemStack[], itemId: ItemId): number {
  return bag.reduce((sum, s) => (s.itemId === itemId ? sum + s.quantity : sum), 0);
}

/** Units of `itemId` at `quality` that still fit a bag holding at most `limit` stacks. */
export function bagRoom(bag: readonly ItemStack[], limit: number, itemId: ItemId, quality: Quality): number {
  const max = getItem(itemId).maxStack;
  let room = Math.max(0, limit - bag.length) * max;
  for (const s of bag) if (s.itemId === itemId && s.quality === quality) room += max - s.quantity;
  return room;
}

/** Tops up matching stacks, then opens new ones up to `limit`. Returns the bag and how much fit. */
export function addToBag(
  bag: readonly ItemStack[],
  limit: number,
  itemId: ItemId,
  quantity: number,
  quality: Quality = 0,
): { readonly bag: readonly ItemStack[]; readonly added: number } {
  const max = getItem(itemId).maxStack;
  const next = bag.slice();
  let remaining = quantity;
  for (let i = 0; i < next.length && remaining > 0; i++) {
    const s = next[i];
    if (s === undefined || s.itemId !== itemId || s.quality !== quality || s.quantity >= max) continue;
    const moved = Math.min(remaining, max - s.quantity);
    next[i] = { ...s, quantity: s.quantity + moved };
    remaining -= moved;
  }
  while (remaining > 0 && next.length < limit) {
    const moved = Math.min(remaining, max);
    next.push({ itemId, quantity: moved, quality });
    remaining -= moved;
  }
  const added = quantity - remaining;
  return added === 0 ? { bag, added } : { bag: next, added };
}

/** Removes `quantity` units of `itemId`, lowest quality first. The bag must hold them. */
export function removeFromBag(bag: readonly ItemStack[], itemId: ItemId, quantity: number): readonly ItemStack[] {
  let remaining = quantity;
  const order = bag
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => s.itemId === itemId)
    .sort((a, b) => a.s.quality - b.s.quality || a.i - b.i);
  const next: (ItemStack | null)[] = bag.slice();
  for (const { s, i } of order) {
    if (remaining === 0) break;
    const taken = Math.min(remaining, s.quantity);
    next[i] = taken === s.quantity ? null : { ...s, quantity: s.quantity - taken };
    remaining -= taken;
  }
  if (remaining > 0) throw new RangeError(`removeFromBag: only ${quantity - remaining} of ${quantity} ${itemId}`);
  return next.filter((s): s is ItemStack => s !== null);
}

/** Units of `itemId` at `quality` that still fit `slots`. */
export function slotsRoom(slots: Slots, itemId: ItemId, quality: Quality): number {
  const max = getItem(itemId).maxStack;
  let room = 0;
  for (const s of slots) {
    if (s === null) room += max;
    else if (s.itemId === itemId && s.quality === quality) room += max - s.quantity;
  }
  return room;
}

/** Adds as much of `stack` as fits: matching stacks first, then empty slots, each in slot order. */
export function addToSlots(slots: Slots, stack: ItemStack): { readonly slots: Slots; readonly added: number } {
  const max = getItem(stack.itemId).maxStack;
  const next = slots.slice();
  let remaining = stack.quantity;
  for (let i = 0; i < next.length && remaining > 0; i++) {
    const s = next[i] ?? null;
    if (s === null || !sameKind(s, stack) || s.quantity >= max) continue;
    const moved = Math.min(remaining, max - s.quantity);
    next[i] = { ...s, quantity: s.quantity + moved };
    remaining -= moved;
  }
  for (let i = 0; i < next.length && remaining > 0; i++) {
    if (next[i] !== null) continue;
    const moved = Math.min(remaining, max);
    next[i] = { itemId: stack.itemId, quantity: moved, quality: stack.quality };
    remaining -= moved;
  }
  const added = stack.quantity - remaining;
  return added === 0 ? { slots, added } : { slots: next, added };
}

/**
 * Moves `itemId` from chest slots into a bag, lowest quality first, then slot order, until the
 * bag is full or the chest has none. `stacks` counts the chest slots touched.
 */
export function takeIntoBag(
  slots: Slots,
  bag: readonly ItemStack[],
  limit: number,
  itemId: ItemId,
): { readonly slots: Slots; readonly bag: readonly ItemStack[]; readonly moved: number; readonly stacks: number } {
  const order = slots
    .map((s, i) => ({ s, i }))
    .filter((e): e is { s: ItemStack; i: number } => e.s !== null && e.s.itemId === itemId)
    .sort((a, b) => a.s.quality - b.s.quality || a.i - b.i);
  let nextSlots: (ItemStack | null)[] | null = null;
  let nextBag = bag;
  let moved = 0;
  let stacks = 0;
  for (const { s, i } of order) {
    const room = bagRoom(nextBag, limit, itemId, s.quality);
    if (room === 0) continue;
    const taken = Math.min(room, s.quantity);
    nextBag = addToBag(nextBag, limit, itemId, taken, s.quality).bag;
    nextSlots ??= slots.slice();
    nextSlots[i] = taken === s.quantity ? null : { ...s, quantity: s.quantity - taken };
    moved += taken;
    stacks++;
  }
  return { slots: nextSlots ?? slots, bag: nextBag, moved, stacks };
}
