/**
 * Read-only derivations from GameState, shared by reducers, render systems and the HUD.
 */
import { FARMING, PLAYER, TIME } from '../config';
import type { ChestSlots, GameState, MapId, Tile, TileCoord, Weather, WorldState } from '../core/types';
import { cropsInSeason, seedItemId } from '../farming/crops';
import { getItem, sellPriceFor, type ItemDefinition, type SeedItem } from '../items/items';
import { formatClock, formatDate } from '../time/clock';
import { rollWeather } from '../time/weather';
import { DIRECTION_STEPS, forwardTile, inBounds } from '../world/grid';
import { getMap, type MapDefinition } from '../world/maps';
import { getTile } from '../world/tiles';
import { selectedStack } from './inventory';

/** The map the player stands on. */
export function selectActiveMapId(state: GameState): MapId {
  return state.player.mapId;
}

/** The world of the map the player stands on. */
export function selectActiveWorld(state: GameState): WorldState {
  return state.maps[state.player.mapId];
}

/** The static definition of the map the player stands on. */
export function selectActiveMap(state: GameState): MapDefinition {
  return getMap(state.player.mapId);
}

/** `state` with one map's world replaced; `state` itself when the world is unchanged. */
export function withMap(state: GameState, mapId: MapId, world: WorldState): GameState {
  if (world === state.maps[mapId]) return state;
  return { ...state, maps: { ...state.maps, [mapId]: world } };
}

/** `state` with the active map's world replaced; `state` itself when the world is unchanged. */
export function withActiveWorld(state: GameState, world: WorldState): GameState {
  return withMap(state, state.player.mapId, world);
}

/**
 * The active tile: a ray cast from the centre of the player's tile along the facing vector
 * (see world/grid.ts forwardTile). Null when the player faces the edge of the world.
 */
export function selectTargetTile(state: GameState): TileCoord | null {
  const { player } = state;
  return forwardTile(selectActiveWorld(state).grid, player, player.facing, PLAYER.toolReachTiles);
}

/**
 * The patch a handful of scattered seeds covers: FARMING.scatter.depth rows starting at the
 * active tile and running away from the player, FARMING.scatter.width tiles wide, centred on
 * the facing line. Out-of-bounds tiles are dropped. Ordered nearest row first and, within a
 * row, centre first, so a partial handful lands closest to the player.
 */
export function selectScatterPatch(state: GameState): readonly TileCoord[] {
  const { player } = state;
  const world = selectActiveWorld(state);
  const { dx, dz } = DIRECTION_STEPS[player.facing];
  const half = Math.floor(FARMING.scatter.width / 2);
  const laterals: number[] = [0];
  for (let k = 1; k <= half; k++) laterals.push(-k, k);
  const patch: TileCoord[] = [];
  for (let row = 1; row <= FARMING.scatter.depth; row++) {
    for (const lateral of laterals) {
      // The lateral axis is the facing vector rotated a quarter turn: (dx, dz) -> (-dz, dx).
      const tx = player.tx + dx * row - dz * lateral;
      const tz = player.tz + dz * row + dx * lateral;
      if (inBounds(world.grid, tx, tz)) patch.push({ tx, tz });
    }
  }
  return patch;
}

export function selectTargetTileData(state: GameState): Tile | null {
  const target = selectTargetTile(state);
  return target === null ? null : getTile(selectActiveWorld(state), target.tx, target.tz);
}

export function selectSelectedItem(state: GameState): ItemDefinition | null {
  const stack = selectedStack(state.inventory);
  return stack === null ? null : getItem(stack.itemId);
}

/** True while a menu or pause freezes the clock and the player. */
export function selectIsFrozen(state: GameState): boolean {
  return state.ui.paused || state.ui.panel.kind !== 'none';
}

/** The chest open in `ui.panel`, with its place; null when no chest panel is open or its tile holds no chest. */
export function selectOpenChest(
  state: GameState,
): { readonly mapId: MapId; readonly tx: number; readonly tz: number; readonly slots: ChestSlots } | null {
  const panel = state.ui.panel;
  if (panel.kind !== 'chest') return null;
  const tile = getTile(state.maps[panel.mapId], panel.tx, panel.tz);
  if (tile === null || tile.object === null || tile.object.kind !== 'chest') return null;
  return { mapId: panel.mapId, tx: panel.tx, tz: panel.tz, slots: tile.object.slots };
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
    total += sellPriceFor(stack.itemId, stack.quality) * stack.quantity;
  }
  return total;
}

/** Seeds the shop sells today: every field crop that can grow in the current season. */
export function selectShopStock(state: GameState): readonly SeedItem[] {
  return cropsInSeason(state.time.season)
    .filter((crop) => crop.habitat === 'field')
    .map((crop) => {
      const item = getItem(seedItemId(crop.id));
      if (item.kind !== 'seed') throw new Error(`Item ${item.id} is not a seed`);
      return item;
    });
}

/** Minutes left before the player passes out. */
export function selectMinutesUntilPassOut(state: GameState): number {
  return Math.max(0, TIME.passOutMinute - state.time.minuteOfDay);
}
