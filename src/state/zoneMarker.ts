/**
 * The zone marker as an item (farmclaws part 3 spec §8): handing it out, and counting every copy
 * the player owns. Pure.
 */
import { MAP_IDS, type GameState, type InventoryState, type ItemStack } from '../core/types';
import { forEachTile } from '../world/tiles';
import { addItem } from './inventory';

/** The one zone marker a farm owns. */
export const ZONE_MARKER_STACK: ItemStack = { itemId: 'zoneMarker', quantity: 1, quality: 0 };

function markersIn(slots: readonly (ItemStack | null)[]): number {
  let count = 0;
  for (const stack of slots) if (stack !== null && stack.itemId === 'zoneMarker') count += stack.quantity;
  return count;
}

/** Zone markers in the player's inventory and in every chest on every map. */
export function countZoneMarkers(inventory: InventoryState, maps: GameState['maps']): number {
  let count = markersIn(inventory.slots);
  for (const id of MAP_IDS) {
    forEachTile(maps[id], (tile) => {
      if (tile.object !== null && tile.object.kind === 'chest') count += markersIn(tile.object.slots);
    });
  }
  return count;
}

/** `inventory` with the marker in its first free unlocked slot, or null when every unlocked slot is taken. */
export function withZoneMarker(inventory: InventoryState): InventoryState | null {
  const { inventory: next, added } = addItem(inventory, 'zoneMarker', 1);
  return added === 1 ? next : null;
}
