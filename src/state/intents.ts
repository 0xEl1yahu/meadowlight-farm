/**
 * Action planning: decides what using the selected item (or interacting) on the active tile
 * *would* do, without changing state. The reducer executes plans; the tile highlighter and
 * HUD use the same plans to show whether an action is possible and what it will do, so the
 * preview and the outcome can never disagree.
 */
import { FARMING } from '../config';
import { Salt, hashFloat, hashRange } from '../core/hash';
import {
  Blocker,
  SEASON_NAMES,
  TileState,
  type ActionKind,
  type CropId,
  type CropInstance,
  type FertilizerKind,
  type GameState,
  PLACEABLE_ITEM_IDS,
  type PlaceableItemId,
  type PlacedObject,
  type Quality,
  type TileCoord,
} from '../core/types';
import { CROPS, isInSeason, isMature } from '../farming/crops';
import { getItem, type FertilizerItem, type PlaceableItem, type SeedItem, type ToolItem } from '../items/items';
import { isReservedTile, mapSeed } from '../world/maps';
import { getTile, isSoil } from '../world/tiles';
import { capacityFor, hasTool, selectedStack } from './inventory';
import { selectActiveMap, selectActiveWorld, selectScatterPatch, selectTargetTile } from './selectors';

export type Intent =
  | { readonly kind: 'till' }
  | { readonly kind: 'water' }
  | { readonly kind: 'refill' }
  | { readonly kind: 'mine' }
  /** One axe hit on a tree (which falls into a stump) or on a stump (which clears). */
  | { readonly kind: 'chop'; readonly blocker: typeof Blocker.Tree | typeof Blocker.Stump }
  /** The scythe cuts weeds down to grass, for free and without a drop. */
  | { readonly kind: 'clearWeeds' }
  | { readonly kind: 'untill' }
  /** Seeds land on every listed tile (empty tilled soil in the scatter patch, nearest first). */
  | { readonly kind: 'scatter'; readonly cropId: CropId; readonly tiles: readonly TileCoord[] }
  /** Every unit of one harvest shares one quality roll. */
  | { readonly kind: 'harvest'; readonly quantity: number; readonly quality: Quality }
  | { readonly kind: 'clearCrop' }
  | { readonly kind: 'ship' }
  /** Opens the chest on the target tile of the active map. */
  | { readonly kind: 'openChest' }
  /** Sets one of the selected placeable item down as its placed object. */
  | { readonly kind: 'place'; readonly itemId: PlaceableItemId }
  /** Mixes one of the selected fertiliser into empty tilled soil. */
  | { readonly kind: 'fertilize'; readonly fertilizer: FertilizerKind }
  /** The pickaxe or axe lifts a placed object back into the inventory. */
  | { readonly kind: 'pickUp'; readonly itemId: PlaceableItemId }
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

/** Silver and gold chances for soil holding `fertilizer` (Speed-Gro only speeds growth). */
export function qualityChanceFor(fertilizer: FertilizerKind | null): { readonly silver: number; readonly gold: number } {
  return fertilizer === 'basic' || fertilizer === 'quality' ? FARMING.qualityChance[fertilizer] : FARMING.qualityChance.none;
}

/**
 * Deterministic quality of a harvest, rolled with the map's seed from the tile, the day and the
 * harvest number. The chances come from the fertiliser in the target tile's soil (see
 * FARMING.qualityChance): gold for r < gold, silver for r < gold + silver, otherwise normal.
 */
export function harvestQuality(state: GameState, target: TileCoord, crop: CropInstance): Quality {
  const chance = qualityChanceFor(getTile(selectActiveWorld(state), target.tx, target.tz)?.fertilizer ?? null);
  const r = hashFloat(
    mapSeed(state.seed, state.player.mapId),
    target.tx,
    target.tz,
    state.time.absoluteDay,
    crop.harvestCount,
    Salt.Quality,
  );
  if (r < chance.gold) return 2;
  return r < chance.gold + chance.silver ? 1 : 0;
}

function planHarvest(
  state: GameState,
  target: TileCoord,
  crop: CropInstance,
  feedback: ActionKind,
  energyCost: number,
): ActionPlan {
  const quantity = harvestQuantity(state, target, crop);
  const quality = harvestQuality(state, target, crop);
  if (capacityFor(state.inventory, crop.cropId, quality) < quantity) {
    return blocked(target, feedback, 'Your inventory is full.');
  }
  return plan(target, { kind: 'harvest', quantity, quality }, feedback, energyCost);
}

/** Why a tool can't clear this blocker, naming the tool that can; null for blockers that never clear. */
function blockerHint(blocker: Blocker): string | null {
  switch (blocker) {
    case Blocker.Rock:
      return 'This rock needs a pickaxe.';
    case Blocker.Stump:
      return 'This stump needs an axe.';
    case Blocker.Tree:
      return 'Chop this tree with the axe.';
    case Blocker.Weeds:
      return 'Cut these weeds with the scythe.';
    case Blocker.None:
    case Blocker.Water:
    case Blocker.House:
    case Blocker.ShippingBin:
    case Blocker.Building:
      return null;
  }
}

/** Shown when the hoe or seeds are used on a map that isn't the player's own land. */
export const FARM_ONLY_REASON = 'You can only farm on your own land.';

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
    case 'hoe': {
      // A placed object (a path, a chest, a sprinkler on soil) is never dug up.
      if (tile.object !== null) return blocked(target, tool);
      if (tile.crop !== null && tile.crop.dead) return plan(target, { kind: 'clearCrop' }, tool, cost);
      const allowsTilling = selectActiveMap(state).allowsTilling;
      // Wild crops sit on unplowed ground. Off the farm, foraging one wouldn't make the tile
      // tillable, so the hoe gives the farm-only reason rather than a hint to forage first.
      if (tile.crop !== null && tile.crop.wild) {
        return allowsTilling
          ? blocked(target, tool, `Forage the ${CROPS[tile.crop.cropId].name.toLowerCase()} first (E).`)
          : blocked(target, tool, FARM_ONLY_REASON);
      }
      if (tile.state === TileState.Unplowed) {
        return allowsTilling ? plan(target, { kind: 'till' }, tool, cost) : blocked(target, tool, FARM_ONLY_REASON);
      }
      if (tile.state === TileState.Blocked) return blocked(target, tool, blockerHint(tile.blocker));
      return blocked(target, tool);
    }

    case 'wateringCan':
      // Any water on any map refills the can: the farm pond, the forest brook, the town river.
      if (tile.blocker === Blocker.Water) {
        return state.inventory.water < state.inventory.waterCapacity
          ? plan(target, { kind: 'refill' }, 'refill')
          : blocked(target, 'refill', 'Your watering can is already full.');
      }
      // Soil under a placed object (a sprinkler) is watered too; the object stays.
      if (tile.state === TileState.Plowed) {
        return state.inventory.water > 0
          ? plan(target, { kind: 'water' }, tool, cost)
          : blocked(target, tool, 'Your watering can is empty. Refill it at the pond.');
      }
      return blocked(target, tool);

    case 'pickaxe':
      // Clearing soil under a placed object would delete the object (and a chest's items).
      if (tile.object !== null) return planPickUp(state, target, tile.object, tool);
      if (tile.blocker === Blocker.Rock) return plan(target, { kind: 'mine' }, tool, cost);
      if (isSoil(tile) && (tile.crop === null || tile.crop.dead)) return plan(target, { kind: 'untill' }, tool, cost);
      if (tile.state === TileState.Blocked) return blocked(target, tool, blockerHint(tile.blocker));
      return blocked(target, tool);

    case 'axe':
      if (tile.object !== null) return planPickUp(state, target, tile.object, tool);
      if (tile.blocker === Blocker.Tree || tile.blocker === Blocker.Stump) {
        return plan(target, { kind: 'chop', blocker: tile.blocker }, tool, cost);
      }
      if (tile.state === TileState.Blocked) return blocked(target, tool, blockerHint(tile.blocker));
      return blocked(target, tool);

    case 'scythe':
      if (tile.blocker === Blocker.Weeds) return plan(target, { kind: 'clearWeeds' }, tool, 0);
      if (tile.crop !== null) {
        if (tile.crop.dead) return plan(target, { kind: 'clearCrop' }, tool, cost);
        if (isMature(tile.crop)) return planHarvest(state, target, tile.crop, tool, cost);
      }
      if (tile.state === TileState.Blocked) return blocked(target, tool, blockerHint(tile.blocker));
      return blocked(target, tool);
  }
}

/** Which tool lifts each pick-up-able placed object: the axe for wooden things, else the pickaxe. */
const PICKUP_TOOL: Readonly<Record<PlaceableItemId, 'pickaxe' | 'axe'>> = {
  chest: 'axe',
  woodFence: 'axe',
  woodPath: 'axe',
  scarecrow: 'axe',
  stonePath: 'pickaxe',
  sprinkler: 'pickaxe',
  qualitySprinkler: 'pickaxe',
  woodBurner: 'pickaxe',
};

export function pickUpTool(kind: PlaceableItemId): 'pickaxe' | 'axe' {
  return PICKUP_TOOL[kind];
}

function isPlaceableKind(kind: PlacedObject['kind']): kind is PlaceableItemId {
  return (PLACEABLE_ITEM_IDS as readonly string[]).includes(kind);
}

/** Picking a placed object up with the pickaxe or axe; free, but it must fit and a chest must be empty. */
function planPickUp(state: GameState, target: TileCoord, object: PlacedObject, tool: 'pickaxe' | 'axe'): ActionPlan {
  if (!isPlaceableKind(object.kind) || PICKUP_TOOL[object.kind] !== tool) return blocked(target, tool);
  if (object.kind === 'chest' && object.slots.some((slot) => slot !== null)) {
    return blocked(target, tool, 'Empty the chest first.');
  }
  if (object.kind === 'woodBurner' && object.fuel > 0) return blocked(target, tool, 'Burn off the wood first.');
  if (capacityFor(state.inventory, object.kind) < 1) return blocked(target, tool, 'Your inventory is full.');
  return plan(target, { kind: 'pickUp', itemId: object.kind }, tool);
}

/** Sprinklers and scarecrows work the fields, so they only go on the farm. */
export function isFarmOnlyPlaceable(itemId: PlaceableItemId): boolean {
  return itemId === 'sprinkler' || itemId === 'qualitySprinkler' || itemId === 'scarecrow' || itemId === 'woodBurner';
}

/**
 * Why `itemId` can't be placed on `target` of the active map, or null when it can. The tile must
 * be free walkable ground (no object, blocker or crop) and not a reserved tile; paths go on
 * grass only, everything else on grass or unfertilised soil; sprinklers and scarecrows only on
 * the farm. An empty string means "no, silently" (out of bounds).
 */
export function placementProblem(state: GameState, itemId: PlaceableItemId, target: TileCoord | null): string | null {
  if (target === null) return '';
  const tile = getTile(selectActiveWorld(state), target.tx, target.tz);
  if (tile === null) return '';
  if (isFarmOnlyPlaceable(itemId) && state.player.mapId !== 'farm') return `The ${getItem(itemId).name.toLowerCase()} belongs on your farm.`;
  if (isReservedTile(selectActiveMap(state), target.tx, target.tz)) return 'Keep this spot clear.';
  if (tile.object !== null || tile.state === TileState.Blocked || tile.crop !== null) return "There's something in the way.";
  if (itemId === 'woodPath' || itemId === 'stonePath') {
    return tile.state === TileState.Unplowed ? null : 'Paths go on grass.';
  }
  if (tile.fertilizer !== null) return 'This soil is fertilised. Plant something here instead.';
  return null;
}

function planPlace(state: GameState, item: PlaceableItem, target: TileCoord | null): ActionPlan {
  const problem = placementProblem(state, item.id, target);
  if (problem === null && target !== null) return plan(target, { kind: 'place', itemId: item.id }, 'place');
  return blocked(target, 'place', problem === '' ? null : problem);
}

function planFertilize(state: GameState, item: FertilizerItem, target: TileCoord | null): ActionPlan {
  if (target === null) return blocked(null, 'fertilize');
  const tile = getTile(selectActiveWorld(state), target.tx, target.tz);
  if (tile === null) return blocked(null, 'fertilize');
  if (!isSoil(tile) || tile.object !== null) return blocked(target, 'fertilize', 'Fertiliser goes on tilled soil.');
  if (tile.crop !== null) return blocked(target, 'fertilize', 'Fertilise the soil before planting.');
  if (tile.fertilizer !== null) return blocked(target, 'fertilize', 'This soil is already fertilised.');
  return plan(target, { kind: 'fertilize', fertilizer: item.fertilizer }, 'fertilize');
}

/**
 * Scattering: one handful covers the scatter patch (selectScatterPatch) and plants a seed on
 * every empty tilled tile it reaches, nearest first, until the stack runs out. Tilling is the
 * precision tool: till a single tile and the handful plants just that one. Seeds are only
 * scattered on maps that allow tilling (the farm).
 */
function planScatter(state: GameState, item: SeedItem, target: TileCoord | null): ActionPlan {
  if (target === null) return blocked(null, 'plant');
  if (!selectActiveMap(state).allowsTilling) return blocked(target, 'plant', FARM_ONLY_REASON);
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
    // Occupied soil and placed objects (a sprinkler on soil, a path on grass) take no seed.
    if (tile === null || tile.crop !== null || tile.object !== null) continue;
    if (isSoil(tile)) tiles.push(coord);
    else if (tile.state === TileState.Unplowed) untilled = true;
  }
  if (tiles.length === 0) return blocked(target, 'plant', untilled ? 'Till the soil with the hoe first.' : null);
  return plan(target, { kind: 'scatter', cropId: item.cropId, tiles }, 'plant');
}

/** Plan for the context action (E): open a chest, harvest, clear, ship, sleep, refill. */
export function planInteraction(state: GameState): ActionPlan {
  const target = selectTargetTile(state);
  if (target === null) return blocked(null, 'none');
  const tile = getTile(selectActiveWorld(state), target.tx, target.tz);
  if (tile === null) return blocked(null, 'none');

  // A chest opens; the other placed objects have nothing to interact with yet.
  if (tile.object !== null) {
    return tile.object.kind === 'chest' ? plan(target, { kind: 'openChest' }, 'openChest') : blocked(target, 'none');
  }

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
    // Debris waits for the right tool, and town buildings, the notice board, hedges and props
    // have nothing to interact with yet: silent, so no toast.
    case Blocker.None:
    case Blocker.Rock:
    case Blocker.Stump:
    case Blocker.Tree:
    case Blocker.Weeds:
    case Blocker.Building:
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
    case 'placeable':
      return planPlace(state, item, target);
    case 'fertilizer':
      return planFertilize(state, item, target);
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
      return intent.blocker === Blocker.Tree ? 'Chop tree' : 'Chop stump';
    case 'clearWeeds':
      return 'Cut weeds';
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
    case 'openChest':
      return 'Open chest';
    case 'place':
      return `Place ${getItem(intent.itemId).name.toLowerCase()}`;
    case 'fertilize':
      return 'Fertilise';
    case 'pickUp':
      return `Pick up ${getItem(intent.itemId).name.toLowerCase()}`;
    case 'blocked':
      return null;
  }
}
