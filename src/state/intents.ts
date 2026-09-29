/**
 * Action planning: decides what using the selected item (or interacting) on the active tile
 * *would* do, without changing state. The reducer executes plans; the tile highlighter and
 * HUD use the same plans to show whether an action is possible and what it will do, so the
 * preview and the outcome can never disagree.
 */
import { Salt, hashRange } from '../core/hash';
import {
  Blocker,
  SEASON_NAMES,
  TileState,
  type ActionKind,
  type CropId,
  type CropInstance,
  type GameState,
  type TileCoord,
} from '../core/types';
import { CROPS, isInSeason, isMature } from '../farming/crops';
import { getItem, type SeedItem, type ToolItem } from '../items/items';
import { mapSeed } from '../world/maps';
import { getTile, isSoil } from '../world/tiles';
import { capacityFor, hasTool, selectedStack } from './inventory';
import { selectActiveWorld, selectScatterPatch, selectTargetTile } from './selectors';

export type Intent =
  | { readonly kind: 'till' }
  | { readonly kind: 'water' }
  | { readonly kind: 'refill' }
  | { readonly kind: 'mine' }
  | { readonly kind: 'chop' }
  | { readonly kind: 'untill' }
  /** Seeds land on every listed tile (empty tilled soil in the scatter patch, nearest first). */
  | { readonly kind: 'scatter'; readonly cropId: CropId; readonly tiles: readonly TileCoord[] }
  | { readonly kind: 'harvest'; readonly quantity: number }
  | { readonly kind: 'clearCrop' }
  | { readonly kind: 'ship' }
  | { readonly kind: 'sleep' }
  | { readonly kind: 'blocked'; readonly reason: string | null };

export type IntentKind = Intent['kind'];

export interface ActionPlan {
  readonly target: TileCoord | null;
  readonly intent: Intent;
  /** Feedback category (animation / particles). A blocked plan with feedback 'none' and no reason is a silent no-op. */
  readonly feedback: ActionKind;
  readonly energyCost: number;
}

function plan(target: TileCoord, intent: Intent, feedback: ActionKind, energyCost = 0): ActionPlan {
  return { target, intent, feedback, energyCost };
}

function blocked(target: TileCoord | null, feedback: ActionKind, reason: string | null = null): ActionPlan {
  return { target, intent: { kind: 'blocked', reason }, feedback, energyCost: 0 };
}

export function isActionable(actionPlan: ActionPlan): boolean {
  return actionPlan.intent.kind !== 'blocked';
}

/**
 * Deterministic harvest size for a crop on a given tile of the active map, day and harvest
 * number. Rolled with the map's seed, which on the farm is the save seed itself.
 */
export function harvestQuantity(state: GameState, target: TileCoord, crop: CropInstance): number {
  const def = CROPS[crop.cropId];
  return hashRange(
    def.yieldMin,
    def.yieldMax,
    mapSeed(state.seed, state.player.mapId),
    target.tx,
    target.tz,
    state.time.absoluteDay,
    crop.harvestCount,
    Salt.Yield,
  );
}

function planHarvest(
  state: GameState,
  target: TileCoord,
  crop: CropInstance,
  feedback: ActionKind,
  energyCost: number,
): ActionPlan {
  const quantity = harvestQuantity(state, target, crop);
  if (capacityFor(state.inventory, crop.cropId) < quantity) {
    return blocked(target, feedback, 'Your inventory is full.');
  }
  return plan(target, { kind: 'harvest', quantity }, feedback, energyCost);
}

function blockerHint(blocker: Blocker): string | null {
  switch (blocker) {
    case Blocker.Rock:
      return 'This rock needs a pickaxe.';
    case Blocker.Stump:
      return 'This stump needs an axe.';
    default:
      return null;
  }
}

function withEnergy(state: GameState, actionPlan: ActionPlan): ActionPlan {
  if (actionPlan.energyCost > 0 && state.player.energy < actionPlan.energyCost) {
    return blocked(actionPlan.target, actionPlan.feedback, "You're too exhausted. Get some sleep.");
  }
  return actionPlan;
}

function planTool(state: GameState, item: ToolItem, target: TileCoord | null): ActionPlan {
  const tool = item.tool;
  if (target === null) return blocked(null, tool);
  const tile = getTile(selectActiveWorld(state), target.tx, target.tz);
  if (tile === null) return blocked(null, tool);
  const cost = item.energyCost;

  switch (tool) {
    case 'hoe':
      if (tile.crop !== null && tile.crop.dead) return plan(target, { kind: 'clearCrop' }, tool, cost);
      if (tile.crop !== null && tile.crop.wild) {
        return blocked(target, tool, `Forage the ${CROPS[tile.crop.cropId].name.toLowerCase()} first (E).`);
      }
      if (tile.state === TileState.Unplowed) return plan(target, { kind: 'till' }, tool, cost);
      if (tile.state === TileState.Blocked) return blocked(target, tool, blockerHint(tile.blocker));
      return blocked(target, tool);

    case 'wateringCan':
      if (tile.blocker === Blocker.Water) {
        return state.inventory.water < state.inventory.waterCapacity
          ? plan(target, { kind: 'refill' }, 'refill')
          : blocked(target, 'refill', 'Your watering can is already full.');
      }
      if (tile.state === TileState.Plowed) {
        return state.inventory.water > 0
          ? plan(target, { kind: 'water' }, tool, cost)
          : blocked(target, tool, 'Your watering can is empty. Refill it at the pond.');
      }
      return blocked(target, tool);

    case 'pickaxe':
      if (tile.blocker === Blocker.Rock) return plan(target, { kind: 'mine' }, tool, cost);
      if (isSoil(tile) && (tile.crop === null || tile.crop.dead)) return plan(target, { kind: 'untill' }, tool, cost);
      if (tile.blocker === Blocker.Stump) return blocked(target, tool, blockerHint(tile.blocker));
      return blocked(target, tool);

    case 'axe':
      if (tile.blocker === Blocker.Stump) return plan(target, { kind: 'chop' }, tool, cost);
      if (tile.blocker === Blocker.Rock) return blocked(target, tool, blockerHint(tile.blocker));
      return blocked(target, tool);

    case 'scythe':
      if (tile.crop !== null) {
        if (tile.crop.dead) return plan(target, { kind: 'clearCrop' }, tool, cost);
        if (isMature(tile.crop)) return planHarvest(state, target, tile.crop, tool, cost);
      }
      return blocked(target, tool);
  }
}

/**
 * Scattering: one handful covers the scatter patch (selectScatterPatch) and plants a seed on
 * every empty tilled tile it reaches, nearest first, until the stack runs out. Tilling is the
 * precision tool: till a single tile and the handful plants just that one.
 */
function planScatter(state: GameState, item: SeedItem, target: TileCoord | null): ActionPlan {
  if (target === null) return blocked(null, 'plant');
  const def = CROPS[item.cropId];
  if (def.habitat === 'shade') return blocked(target, 'plant', `${def.name}s only grow wild in the shade.`);
  if (!isInSeason(def, state.time.season)) {
    return blocked(target, 'plant', `${def.name} won't grow in ${SEASON_NAMES[state.time.season]}.`);
  }
  const stack = selectedStack(state.inventory);
  const available = stack === null ? 0 : stack.quantity;
  const patch = selectScatterPatch(state);
  const tiles: TileCoord[] = [];
  let untilled = false;
  for (const coord of patch) {
    if (tiles.length >= available) break;
    const tile = getTile(selectActiveWorld(state), coord.tx, coord.tz);
    if (tile === null || tile.crop !== null) continue;
    if (isSoil(tile)) tiles.push(coord);
    else if (tile.state === TileState.Unplowed) untilled = true;
  }
  if (tiles.length === 0) return blocked(target, 'plant', untilled ? 'Till the soil with the hoe first.' : null);
  return plan(target, { kind: 'scatter', cropId: item.cropId, tiles }, 'plant');
}

/** Plan for the context action (E): harvest, clear, ship, sleep, refill. */
export function planInteraction(state: GameState): ActionPlan {
  const target = selectTargetTile(state);
  if (target === null) return blocked(null, 'none');
  const tile = getTile(selectActiveWorld(state), target.tx, target.tz);
  if (tile === null) return blocked(null, 'none');

  if (tile.crop !== null) {
    if (tile.crop.dead) return plan(target, { kind: 'clearCrop' }, 'harvest');
    if (isMature(tile.crop)) return planHarvest(state, target, tile.crop, 'harvest', 0);
    return blocked(target, 'none');
  }

  switch (tile.blocker) {
    case Blocker.ShippingBin: {
      const stack = selectedStack(state.inventory);
      if (stack === null) return blocked(target, 'ship', 'Select something on your hotbar to ship it.');
      const item = getItem(stack.itemId);
      if (item.sellPrice === null) return blocked(target, 'ship', `${item.name} can't be shipped.`);
      return plan(target, { kind: 'ship' }, 'ship');
    }
    case Blocker.House:
      return plan(target, { kind: 'sleep' }, 'sleep');
    case Blocker.Water:
      if (hasTool(state.inventory, 'wateringCan') && state.inventory.water < state.inventory.waterCapacity) {
        return plan(target, { kind: 'refill' }, 'refill');
      }
      return blocked(target, 'none');
    default:
      return blocked(target, 'none');
  }
}

/** Plan for using the selected hotbar item (Space). Empty hands and non-tools fall back to interaction. */
export function planPrimaryAction(state: GameState): ActionPlan {
  const stack = selectedStack(state.inventory);
  if (stack === null) return planInteraction(state);
  const target = selectTargetTile(state);
  const item = getItem(stack.itemId);
  switch (item.kind) {
    case 'tool':
      return withEnergy(state, planTool(state, item, target));
    case 'seed':
      return planScatter(state, item, target);
    case 'produce':
    case 'material':
      return planInteraction(state);
  }
}

/** Short verb for HUD hints, e.g. "Till", or null when the plan does nothing. */
export function describeIntent(intent: Intent): string | null {
  switch (intent.kind) {
    case 'till':
      return 'Till';
    case 'water':
      return 'Water';
    case 'refill':
      return 'Refill can';
    case 'mine':
      return 'Break rock';
    case 'chop':
      return 'Chop stump';
    case 'untill':
      return 'Clear soil';
    case 'scatter':
      return `Scatter ${CROPS[intent.cropId].name}${intent.tiles.length > 1 ? ` ×${intent.tiles.length}` : ''}`;
    case 'harvest':
      return 'Harvest';
    case 'clearCrop':
      return 'Clear withered crop';
    case 'ship':
      return 'Ship';
    case 'sleep':
      return 'Sleep';
    case 'blocked':
      return null;
  }
}
