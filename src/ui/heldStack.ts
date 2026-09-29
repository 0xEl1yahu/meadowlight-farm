/**
 * Pick-up-and-place rules for the inventory screen, kept free of the DOM so they can be tested.
 *
 * The screen holds at most one `HeldStack`: a slot reference and how many of that slot's units
 * the cursor carries. Nothing leaves `GameState` while an item is held; the units stay in their
 * source slot until a click dispatches `inventory/move`, and the reducer decides what happens.
 *
 *   Left click, nothing held     pick up the whole stack (empty slots do nothing)
 *   Left click, holding          move everything held onto the slot and let go; the source slot cancels
 *   Right click, nothing held    pick up half the stack, rounded up
 *   Right click, holding         move one unit onto the slot and keep holding the rest
 */
import { INVENTORY } from '../config';
import type { GameState, ItemStack, SlotRef } from '../core/types';
import { selectOpenChest } from '../state/selectors';

export interface HeldStack {
  readonly ref: SlotRef;
  readonly quantity: number;
}

export interface SlotMove {
  readonly from: SlotRef;
  readonly to: SlotRef;
  readonly quantity: number;
}

/** What a click does: the new held stack, plus the move to dispatch (if any). */
export interface SlotClickResult {
  readonly held: HeldStack | null;
  readonly move: SlotMove | null;
}

export function sameSlotRef(a: SlotRef, b: SlotRef): boolean {
  if (a.container === 'player') return b.container === 'player' && a.index === b.index;
  return b.container === 'chest' && a.mapId === b.mapId && a.tx === b.tx && a.tz === b.tz && a.index === b.index;
}

/**
 * The stack in a slot the inventory screen shows, or null for an empty slot. Undefined when the
 * reference doesn't resolve: a locked or out-of-range player slot, or a chest slot of any chest
 * but the one open in `ui.panel` (found through `selectOpenChest`).
 */
export function stackAtRef(state: GameState, ref: SlotRef): ItemStack | null | undefined {
  if (!Number.isInteger(ref.index) || ref.index < 0) return undefined;
  if (ref.container === 'player') {
    return ref.index < state.inventory.unlockedSlots ? (state.inventory.slots[ref.index] ?? null) : undefined;
  }
  const chest = selectOpenChest(state);
  if (chest === null || chest.mapId !== ref.mapId || chest.tx !== ref.tx || chest.tz !== ref.tz) return undefined;
  return ref.index < INVENTORY.chestSlots ? (chest.slots[ref.index] ?? null) : undefined;
}

const NOTHING: SlotClickResult = { held: null, move: null };

export function leftClickSlot(held: HeldStack | null, target: SlotRef, targetStack: ItemStack | null): SlotClickResult {
  if (held === null) {
    return targetStack === null ? NOTHING : { held: { ref: target, quantity: targetStack.quantity }, move: null };
  }
  if (sameSlotRef(held.ref, target)) return NOTHING;
  return { held: null, move: { from: held.ref, to: target, quantity: held.quantity } };
}

export function rightClickSlot(held: HeldStack | null, target: SlotRef, targetStack: ItemStack | null): SlotClickResult {
  if (held === null) {
    if (targetStack === null) return NOTHING;
    return { held: { ref: target, quantity: Math.ceil(targetStack.quantity / 2) }, move: null };
  }
  if (sameSlotRef(held.ref, target)) return { held, move: null };
  const rest = held.quantity - 1;
  return { held: rest > 0 ? { ref: held.ref, quantity: rest } : null, move: { from: held.ref, to: target, quantity: 1 } };
}

/**
 * Keeps a held stack consistent with the state: dropped when no inventory or chest panel is open,
 * when its slot no longer resolves or is empty, or when a different item or quality replaced it;
 * clamped to the slot's quantity when that shrank below it. `prev` is the state the held stack
 * was last checked against (null when unknown, which only clamps).
 */
export function reconcileHeld(held: HeldStack | null, state: GameState, prev: GameState | null): HeldStack | null {
  if (held === null) return null;
  const panel = state.ui.panel.kind;
  if (panel !== 'inventory' && panel !== 'chest') return null;
  const stack = stackAtRef(state, held.ref);
  if (stack === undefined || stack === null) return null;
  const before = prev === null ? undefined : stackAtRef(prev, held.ref);
  if (before === stack) return held;
  if (before !== undefined && before !== null && (before.itemId !== stack.itemId || before.quality !== stack.quality)) return null;
  if (before === undefined && prev !== null) return null;
  return held.quantity <= stack.quantity ? held : { ref: held.ref, quantity: stack.quantity };
}
