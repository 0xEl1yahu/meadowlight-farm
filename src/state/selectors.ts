/**
 * Read-only derivations from GameState, shared by reducers, render systems and the HUD.
 */
import { PLAYER, TIME } from '../config';
import type { GameState, Tile, TileCoord, Weather } from '../core/types';
import { cropsInSeason, seedItemId } from '../farming/crops';
import { getItem, type ItemDefinition, type SeedItem } from '../items/items';
import { formatClock, formatDate } from '../time/clock';
import { rollWeather } from '../time/weather';
import { forwardTile } from '../world/grid';
import { getTile } from '../world/tiles';
import { selectedStack } from './inventory';

/**
 * The active tile: a ray cast from the centre of the player's tile along the facing vector
 * (see world/grid.ts forwardTile). Null when the player faces the edge of the world.
 */
export function selectTargetTile(state: GameState): TileCoord | null {
  const { player, world } = state;
  return forwardTile(world.grid, player, player.facing, PLAYER.toolReachTiles);
}

export function selectTargetTileData(state: GameState): Tile | null {
  const target = selectTargetTile(state);
  return target === null ? null : getTile(state.world, target.tx, target.tz);
}

export function selectSelectedItem(state: GameState): ItemDefinition | null {
  const stack = selectedStack(state.inventory);
  return stack === null ? null : getItem(stack.itemId);
}

/** True while a menu or pause freezes the clock and the player. */
export function selectIsFrozen(state: GameState): boolean {
  return state.ui.paused || state.ui.shopOpen;
}

export function selectClockLabel(state: GameState): string {
  return formatClock(state.time.minuteOfDay);
}

export function selectDateLabel(state: GameState): string {
  return formatDate(state.time);
}

export function selectForecast(state: GameState): Weather {
  return rollWeather(state.seed, state.time.absoluteDay + 1);
}

/** Gold that the shipping bin will pay out tomorrow morning. */
export function selectPendingShipmentValue(state: GameState): number {
  let total = 0;
  for (const stack of state.shipping.pending) {
    total += (getItem(stack.itemId).sellPrice ?? 0) * stack.quantity;
  }
  return total;
}

/** Seeds the shop sells today: everything that can grow in the current season. */
export function selectShopStock(state: GameState): readonly SeedItem[] {
  return cropsInSeason(state.time.season).map((crop) => {
    const item = getItem(seedItemId(crop.id));
    if (item.kind !== 'seed') throw new Error(`Item ${item.id} is not a seed`);
    return item;
  });
}

/** Minutes left before the player passes out. */
export function selectMinutesUntilPassOut(state: GameState): number {
  return Math.max(0, TIME.passOutMinute - state.time.minuteOfDay);
}
