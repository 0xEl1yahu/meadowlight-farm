/**
 * The root reducer: a pure, deterministic state machine.
 *
 *   (GameState, GameAction) → GameState
 *
 * No wall-clock reads, no Math.random, no I/O. Everything stochastic goes through the seeded
 * hash in core/hash.ts, so an action log replayed from the same initial state reproduces the
 * exact same game.
 */
import { INVENTORY, PLAYER, TIME, TOOLS } from '../config';
import { invariant } from '../core/invariant';
import { joinWithAnd, qualityPrefix } from '../core/text';
import {
  Blocker,
  DIRECTIONS,
  MAP_IDS,
  SEASON_NAMES,
  TileState,
  Weather,
  type ActionKind,
  type Direction,
  type GameState,
  type CraftingRecipeId,
  type CropId,
  type ItemStack,
  type PlaceableItemId,
  type PlacedObject,
  type Quality,
  type SeedItemId,
  type ShippingState,
  type SlotRef,
  type Tile,
  type TileCoord,
} from '../core/types';
import { CROPS, createCropInstance } from '../farming/crops';
import { harvestedTile } from '../farming/harvest';
import { RECIPES, consumeIngredients, craftCheck } from '../crafting/recipes';
import { runCrows } from '../farming/crows';
import { debrisDrops, type Drop, type DroppingBlocker } from '../farming/drops';
import { advanceWorldOvernight } from '../farming/growth';
import { runSprinklers } from '../farming/sprinklers';
import { getItem, isSeedItemId, sellPriceFor } from '../items/items';
import { runRobotsOvernight } from '../robots/overnight';
import { runRobotsThrough } from '../robots/run';
import { formatDate, nextDay } from '../time/clock';
import { rollWeather, weatherWaters } from '../time/weather';
import { inBounds, stepTile } from '../world/grid';
import { findWarp, getMap, mapSeed, type Warp } from '../world/maps';
import { EMPTY_TILE, blockedTile, getTile, isWalkable, requireTile, setTile, setTiles } from '../world/tiles';
import type { GameAction } from './actions';
import { planInteraction, planPrimaryAction, type ActionPlan, type Intent } from './intents';
import {
  addItem,
  capacityFor,
  mergeStacks,
  moveAcrossSlots,
  moveWithinSlots,
  removeFromSlot,
  selectedStack,
  type Slots,
} from './inventory';
import { pushMessage } from './messages';
import {
  selectActiveMap,
  selectActiveWorld,
  selectIsFrozen,
  selectPendingShipmentValue,
  selectShopStock,
  withActiveWorld,
  withMap,
} from './selectors';

export function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case 'time/tick':
      return tick(state, action.minutes);
    case 'day/sleep':
      return selectIsFrozen(state) ? state : startNextDay(state, false);
    case 'player/move':
      return movePlayer(state, action.direction);
    case 'player/face':
      return facePlayer(state, action.direction);
    case 'player/useTool':
      return selectIsFrozen(state) ? state : executePlan(state, planPrimaryAction(state));
    case 'player/interact':
      return selectIsFrozen(state) ? state : executePlan(state, planInteraction(state));
    case 'inventory/select':
      return selectSlot(state, action.slot);
    case 'inventory/cycle':
      return cycleSlot(state, action.delta);
    case 'inventory/move':
      return moveItem(state, action.from, action.to, action.quantity);
    case 'shop/setOpen':
      return setPanelOpen(state, { kind: 'shop' }, action.open);
    case 'ui/setInventoryOpen':
      return setPanelOpen(state, { kind: 'inventory' }, action.open);
    case 'ui/closePanel':
      return state.ui.panel.kind === 'none' ? state : { ...state, ui: { ...state.ui, panel: { kind: 'none' } } };
    case 'shop/buy':
      return buySeeds(state, action.itemId, action.quantity);
    case 'crafting/craft':
      return craft(state, action.recipe);
    case 'game/setPaused':
      return state.ui.paused === action.paused ? state : { ...state, ui: { ...state.ui, paused: action.paused } };
    case 'game/setTimeScale':
      return setTimeScale(state, action.timeScale);
    case 'game/load':
      return loadState(state, action.state);
    default: {
      const unknown: never = action;
      void unknown;
      return state;
    }
  }
}

// ---------------------------------------------------------------------------
// Time & day cycle
// ---------------------------------------------------------------------------

/**
 * Advances the clock. With robots on the farm it goes one minute at a time so every robot acts
 * on its minute (farmclaws part 1 §5.5); however the minutes arrive, the result is the same.
 */
function tick(state: GameState, minutes: number): GameState {
  if (selectIsFrozen(state) || !Number.isFinite(minutes)) return state;
  const whole = Math.min(TIME.maxTickMinutes, Math.floor(minutes));
  if (whole <= 0) return state;
  const target = state.time.minuteOfDay + whole;
  if (target >= TIME.passOutMinute) return startNextDay(runRobotsThrough(state, TIME.passOutMinute - 1), true);
  if (state.robots.list.length === 0) return { ...state, time: { ...state.time, minuteOfDay: target } };
  return runRobotsThrough(state, target);
}

/** The placed object a placeable item becomes: an empty chest, a cold wood burner, or the plain kind. */
function placedObjectFor(itemId: PlaceableItemId): PlacedObject {
  switch (itemId) {
    case 'chest':
      return { kind: 'chest', slots: new Array<null>(INVENTORY.chestSlots).fill(null) };
    case 'woodBurner':
      return { kind: 'woodBurner', fuel: 0 };
    default:
      return { kind: itemId };
  }
}

/** Lifetime counters after a morning payout: gold earned and parsnips shipped (every quality). */
function shippedStats(state: GameState, payout: number): GameState['stats'] {
  let parsnips = 0;
  for (const stack of state.shipping.pending) if (stack.itemId === 'parsnip') parsnips += stack.quantity;
  if (payout === 0 && parsnips === 0) return state.stats;
  return {
    ...state.stats,
    totalEarned: state.stats.totalEarned + payout,
    parsnipsShipped: state.stats.parsnipsShipped + parsnips,
  };
}

/**
 * Day transition: pay out the shipping bin (each stack at its quality's price, counted into the
 * lifetime stats), advance the calendar, roll the (global) weather, run the overnight growth
 * pipeline on every map with that map's seed, restore energy and put the player back at the
 * house on the farm. Then the robots' night runs (farmclaws part 1 §5.7); its toasts follow the
 * morning's own messages.
 */
export function startNextDay(state: GameState, passedOut: boolean): GameState {
  const payout = selectPendingShipmentValue(state);
  const time = nextDay(state.time);
  const seasonChanged = time.season !== state.time.season;
  const weather = rollWeather(state.seed, time.absoluteDay);
  const ctx = { day: time.absoluteDay, season: time.season, seasonChanged, weather };
  let maps = state.maps;
  let eaten: readonly CropId[] = [];
  for (const id of MAP_IDS) {
    const seed = mapSeed(state.seed, id);
    // Sprinklers water before the crops grow (the night counts) and again after (wet soil at dawn).
    let world = runSprinklers(advanceWorldOvernight(runSprinklers(state.maps[id]), { ...ctx, seed }, getMap(id)));
    if (id === 'farm') {
      const raid = runCrows(world, seed, time.absoluteDay);
      world = raid.world;
      eaten = raid.eaten;
    }
    if (world !== maps[id]) maps = { ...maps, [id]: world };
  }
  const energy = passedOut
    ? Math.max(1, Math.round(state.player.maxEnergy * PLAYER.passOutEnergyFraction))
    : state.player.maxEnergy;

  let next: GameState = {
    ...state,
    time,
    weather,
    maps,
    player: {
      ...state.player,
      mapId: 'farm',
      tx: PLAYER.spawn.tx,
      tz: PLAYER.spawn.tz,
      facing: PLAYER.spawnFacing,
      energy,
      gold: state.player.gold + payout,
      teleportSeq: state.player.teleportSeq + 1,
    },
    shipping: { pending: [], lastPayout: payout },
    stats: shippedStats(state, payout),
  };
  const night = runRobotsOvernight(next);
  next = night.state;

  next = pushMessage(next, `Good morning! ${formatDate(time)}.`, 'info');
  if (passedOut) next = pushMessage(next, 'You passed out from exhaustion and woke up at home with half your energy.', 'warn');
  if (payout > 0) next = pushMessage(next, `Your shipment sold for ${payout}g.`, 'success');
  if (eaten.length > 0) next = pushMessage(next, crowReport(eaten), 'warn');
  if (seasonChanged) next = pushMessage(next, `${SEASON_NAMES[time.season]} has arrived! Out-of-season crops have withered.`, 'info');
  if (weatherWaters(weather)) {
    next = pushMessage(next, `It's ${weather === Weather.Storm ? 'storming' : 'raining'} — your crops are watered today.`, 'info');
  } else if (weather === Weather.Snow) {
    next = pushMessage(next, 'Snow blankets the farm.', 'info');
  }
  for (const note of night.notes) next = pushMessage(next, note.text, note.tone);
  return next;
}

/** "Crows ate 2 Parsnips and 1 Potato overnight." (in the order they were eaten). */
export function crowReport(eaten: readonly CropId[]): string {
  const counts = new Map<CropId, number>();
  for (const id of eaten) counts.set(id, (counts.get(id) ?? 0) + 1);
  const parts = [...counts].map(([id, n]) => `${n} ${CROPS[id].name}${n > 1 ? 's' : ''}`);
  const list = joinWithAnd(parts, '');
  return `Crows ate ${list} overnight. A scarecrow keeps them away.`;
}

// ---------------------------------------------------------------------------
// Movement
// ---------------------------------------------------------------------------

function isDirection(value: number): value is Direction {
  return (DIRECTIONS as readonly number[]).includes(value);
}

/**
 * One grid step. Inside the grid the destination must be walkable. Stepping off the edge takes
 * the map's warp from this tile in this direction, if there is one: the player lands on the
 * warp's arrival tile on the other map, facing into it (a teleport, so `moveSeq` is untouched).
 * A warp whose arrival tile isn't walkable is refused like any blocked step.
 */
function movePlayer(state: GameState, direction: Direction): GameState {
  if (selectIsFrozen(state) || !isDirection(direction)) return state;
  const { player } = state;
  const destination = stepTile(player, direction);
  const world = selectActiveWorld(state);
  if (inBounds(world.grid, destination.tx, destination.tz)) {
    if (isWalkable(requireTile(world, destination.tx, destination.tz))) {
      return {
        ...state,
        player: { ...player, tx: destination.tx, tz: destination.tz, facing: direction, moveSeq: player.moveSeq + 1 },
      };
    }
  } else {
    const warp = findWarp(selectActiveMap(state), player.tx, player.tz, direction);
    if (warp !== null) {
      const arrival = getTile(state.maps[warp.to.mapId], warp.to.tx, warp.to.tz);
      if (arrival !== null && isWalkable(arrival)) return takeWarp(state, warp);
    }
  }
  return player.facing === direction ? state : { ...state, player: { ...player, facing: direction } };
}

function takeWarp(state: GameState, warp: Warp): GameState {
  const { mapId, tx, tz, facing } = warp.to;
  const next: GameState = {
    ...state,
    player: { ...state.player, mapId, tx, tz, facing, teleportSeq: state.player.teleportSeq + 1 },
  };
  if (mapId !== 'town' || state.stats.visitedTown) return next;
  return { ...next, stats: { ...next.stats, visitedTown: true } };
}

function facePlayer(state: GameState, direction: Direction): GameState {
  if (selectIsFrozen(state) || !isDirection(direction) || state.player.facing === direction) return state;
  return { ...state, player: { ...state.player, facing: direction } };
}

// ---------------------------------------------------------------------------
// Tool use & interaction
// ---------------------------------------------------------------------------

function recordAction(state: GameState, kind: ActionKind, target: TileCoord | null, success: boolean): GameState {
  const seq = state.player.actionSeq + 1;
  return { ...state, player: { ...state.player, actionSeq: seq, lastAction: { seq, kind, target, success } } };
}

/** Writes one tile of the active map. */
function withTile(state: GameState, target: TileCoord, tile: Tile): GameState {
  return withActiveWorld(state, setTile(selectActiveWorld(state), target.tx, target.tz, tile));
}

export function executePlan(state: GameState, plan: ActionPlan): GameState {
  const { intent, target } = plan;

  if (intent.kind === 'blocked') {
    if (plan.feedback === 'none' && intent.reason === null) return state;
    const next = recordAction(state, plan.feedback, target, false);
    return intent.reason === null ? next : pushMessage(next, intent.reason, 'warn');
  }

  invariant(target !== null, `actionable plan "${intent.kind}" has no target`);

  if (intent.kind === 'sleep') {
    return startNextDay(recordAction(state, 'sleep', target, true), false);
  }

  let next = applyIntent(state, intent, target);
  if (plan.energyCost > 0) {
    next = { ...next, player: { ...next.player, energy: Math.max(0, next.player.energy - plan.energyCost) } };
  }
  return recordAction(next, plan.feedback, target, true);
}

function applyIntent(state: GameState, intent: Exclude<Intent, { kind: 'blocked' | 'sleep' }>, target: TileCoord): GameState {
  const tile = requireTile(selectActiveWorld(state), target.tx, target.tz);
  switch (intent.kind) {
    case 'till':
      return withTile(state, target, { ...tile, state: TileState.Plowed });

    case 'water': {
      const next = withTile(state, target, { ...tile, state: TileState.Watered });
      return { ...next, inventory: { ...next.inventory, water: Math.max(0, next.inventory.water - 1) } };
    }

    case 'refill':
      return { ...state, inventory: { ...state.inventory, water: state.inventory.waterCapacity } };

    case 'mine':
    case 'chop':
      return hitBlocker(state, target, tile);

    case 'clearWeeds':
      return giveDrops(countDebrisCleared(withTile(state, target, EMPTY_TILE)), debrisDropsAt(state, Blocker.Weeds, target));

    case 'untill':
      return withTile(state, target, EMPTY_TILE);

    case 'scatter': {
      const world = selectActiveWorld(state);
      const planted = setTiles(
        world,
        intent.tiles.map(({ tx, tz }) => ({
          tx,
          tz,
          tile: { ...requireTile(world, tx, tz), crop: createCropInstance(intent.cropId, state.time.absoluteDay) },
        })),
      );
      const next = withActiveWorld(state, planted);
      return { ...next, inventory: removeFromSlot(state.inventory, state.inventory.selected, intent.tiles.length) };
    }

    case 'harvest':
      return harvest(state, target, tile, intent.quantity, intent.quality);

    case 'clearCrop':
      return withTile(state, target, { ...tile, crop: null });

    case 'ship':
      return shipSelected(state);

    case 'openChest':
      return {
        ...state,
        ui: { ...state.ui, panel: { kind: 'chest', mapId: state.player.mapId, tx: target.tx, tz: target.tz } },
      };

    case 'place': {
      const next = withTile(state, target, { ...tile, object: placedObjectFor(intent.itemId) });
      return { ...next, inventory: removeFromSlot(state.inventory, state.inventory.selected, 1) };
    }

    case 'fertilize': {
      const next = withTile(state, target, { ...tile, fertilizer: intent.fertilizer });
      return { ...next, inventory: removeFromSlot(state.inventory, state.inventory.selected, 1) };
    }

    case 'pickUp': {
      const { inventory, added } = addItem(state.inventory, intent.itemId, 1);
      invariant(added === 1, 'pick-up capacity is verified while planning');
      return { ...withTile(state, target, { ...tile, object: null }), inventory };
    }
  }
}

/** The drops for clearing `blocker` on `target` of the active map today. */
function debrisDropsAt(state: GameState, blocker: DroppingBlocker, target: TileCoord): readonly Drop[] {
  return debrisDrops(mapSeed(state.seed, state.player.mapId), blocker, target.tx, target.tz, state.time.absoluteDay);
}

/** Adds each drop, as many as fit, with a warning for any that didn't. */
function giveDrops(state: GameState, drops: readonly Drop[]): GameState {
  let next = state;
  for (const drop of drops) {
    const { inventory, added } = addItem(next.inventory, drop.itemId, drop.quantity);
    next = { ...next, inventory };
    if (added < drop.quantity) next = pushMessage(next, `No room for ${getItem(drop.itemId).name}.`, 'warn');
  }
  return next;
}

/** What a hittable blocker leaves behind when its last hit lands. */
function blockerRemains(blocker: Blocker): { readonly tile: Tile; readonly blocker: DroppingBlocker } {
  switch (blocker) {
    case Blocker.Rock:
    case Blocker.Stump:
      return { tile: EMPTY_TILE, blocker };
    case Blocker.Tree:
      return { tile: blockedTile(Blocker.Stump, TOOLS.stumpHits), blocker };
    default:
      throw new RangeError(`blocker ${blocker} takes no hits`);
  }
}

/** Every Rock, Stump, Tree or Weeds blocker fully cleared counts once (a felled tree, then its stump). */
function countDebrisCleared(state: GameState): GameState {
  return { ...state, stats: { ...state.stats, debrisCleared: state.stats.debrisCleared + 1 } };
}

/**
 * One hit on a Rock, Stump or Tree. Each hit lowers its hp by 1; the last one replaces the tile
 * with the blocker's remains (a tree falls into a fresh stump, rocks and stumps clear) and drops
 * its items, as many as fit.
 */
function hitBlocker(state: GameState, target: TileCoord, tile: Tile): GameState {
  const hp = tile.blockerHp - 1;
  if (hp > 0) return withTile(state, target, { ...tile, blockerHp: hp });
  const remains = blockerRemains(tile.blocker);
  const cleared = countDebrisCleared(withTile(state, target, remains.tile));
  return giveDrops(cleared, debrisDropsAt(state, remains.blocker, target));
}

function harvest(state: GameState, target: TileCoord, tile: Tile, quantity: number, quality: Quality): GameState {
  const crop = tile.crop;
  invariant(crop !== null, 'harvest target has no crop');
  const def = CROPS[crop.cropId];
  const { inventory, added } = addItem(state.inventory, def.id, quantity, quality);
  invariant(added === quantity, 'harvest capacity is verified while planning');
  const next = withTile(state, target, harvestedTile(tile));
  return pushMessage({ ...next, inventory }, `Harvested ${qualityPrefix(quality)}${def.name} ×${quantity}.`, 'success');
}

function shipSelected(state: GameState): GameState {
  const stack = selectedStack(state.inventory);
  invariant(stack !== null, 'ship requires a selected stack');
  const item = getItem(stack.itemId);
  invariant(item.sellPrice !== null, `${item.id} cannot be shipped`);
  const shipping: ShippingState = { ...state.shipping, pending: mergeStacks(state.shipping.pending, stack) };
  const next: GameState = {
    ...state,
    inventory: removeFromSlot(state.inventory, state.inventory.selected, stack.quantity),
    shipping,
  };
  const value = sellPriceFor(stack.itemId, stack.quality) * stack.quantity;
  return pushMessage(
    next,
    `Shipped ${qualityPrefix(stack.quality)}${item.name} ×${stack.quantity} — ${value}g tomorrow.`,
    'success',
  );
}

// ---------------------------------------------------------------------------
// Inventory, shop, UI
// ---------------------------------------------------------------------------

/** Only hotbar slots can be selected; the backpack is reached through the inventory screen. */
function selectSlot(state: GameState, slot: number): GameState {
  if (!Number.isInteger(slot) || slot < 0 || slot >= INVENTORY.hotbarSize) return state;
  if (slot === state.inventory.selected) return state;
  return { ...state, inventory: { ...state.inventory, selected: slot } };
}

function cycleSlot(state: GameState, delta: number): GameState {
  if (!Number.isInteger(delta) || delta === 0) return state;
  const size = INVENTORY.hotbarSize;
  const selected = (((state.inventory.selected + delta) % size) + size) % size;
  return selectSlot(state, selected);
}

/**
 * Opens `panel` only when no panel is open and the game isn't paused; closes it only when that
 * kind of panel is the one open. Anything else is a no-op.
 */
function setPanelOpen(state: GameState, panel: { readonly kind: 'shop' | 'inventory' }, open: boolean): GameState {
  const current = state.ui.panel;
  if (open) {
    if (current.kind !== 'none' || state.ui.paused) return state;
    return { ...state, ui: { ...state.ui, panel } };
  }
  return current.kind === panel.kind ? { ...state, ui: { ...state.ui, panel: { kind: 'none' } } } : state;
}

/** A slot reference checked against the current state: the container's slots and where they live. */
type ResolvedSlot =
  | { readonly container: 'player'; readonly slots: Slots; readonly index: number }
  | {
      readonly container: 'chest';
      readonly slots: Slots;
      readonly index: number;
      readonly target: TileCoord;
      readonly mapId: GameState['player']['mapId'];
    };

/**
 * Resolves a slot reference, or null when it is invalid: a non-integer index or coordinate, a
 * player slot outside the unlocked ones, or a chest slot of any chest but the one open in
 * `ui.panel` (whose tile must still hold a chest).
 */
function resolveSlot(state: GameState, ref: SlotRef): ResolvedSlot | null {
  if (typeof ref !== 'object' || ref === null || !Number.isInteger(ref.index) || ref.index < 0) return null;
  if (ref.container === 'player') {
    return ref.index < state.inventory.unlockedSlots ? { container: 'player', slots: state.inventory.slots, index: ref.index } : null;
  }
  if (ref.container !== 'chest') return null;
  const { mapId, tx, tz } = ref;
  if (!Number.isInteger(tx) || !Number.isInteger(tz) || !(MAP_IDS as readonly unknown[]).includes(mapId)) return null;
  const panel = state.ui.panel;
  if (panel.kind !== 'chest' || panel.mapId !== mapId || panel.tx !== tx || panel.tz !== tz) return null;
  const object = getTile(state.maps[mapId], tx, tz)?.object ?? null;
  if (object === null || object.kind !== 'chest' || ref.index >= INVENTORY.chestSlots) return null;
  return { container: 'chest', slots: object.slots, index: ref.index, target: { tx, tz }, mapId };
}

/** Writes a container's new slots: the player's inventory, or the chest object on its tile. */
function writeSlots(state: GameState, where: ResolvedSlot, slots: Slots): GameState {
  if (where.container === 'player') return { ...state, inventory: { ...state.inventory, slots } };
  const world = state.maps[where.mapId];
  const tile = requireTile(world, where.target.tx, where.target.tz);
  return withMap(state, where.mapId, setTile(world, where.target.tx, where.target.tz, { ...tile, object: { kind: 'chest', slots } }));
}

/**
 * `inventory/move`: moves `quantity` units (null = the whole stack) between two slots of the
 * player's inventory, or between it and the open chest. Rejected (the same state comes back)
 * while paused, for an invalid ref, an empty source or a quantity outside 1 … its size; a no-op
 * for the same slot, a full target, or part of a stack onto a different item or quality. The
 * selection and the watering can's water never change.
 */
function moveItem(state: GameState, from: SlotRef, to: SlotRef, quantity: number | null): GameState {
  if (state.ui.paused) return state;
  const src = resolveSlot(state, from);
  const dst = resolveSlot(state, to);
  if (src === null || dst === null) return state;
  const stack: ItemStack | null = src.slots[src.index] ?? null;
  if (stack === null) return state;
  const q = quantity ?? stack.quantity;
  if (!Number.isInteger(q) || q < 1 || q > stack.quantity) return state;
  if (src.container === dst.container) {
    if (src.index === dst.index) return state;
    const slots = moveWithinSlots(src.slots, src.index, dst.index, q);
    return slots === null ? state : writeSlots(state, src, slots);
  }
  const moved = moveAcrossSlots(src.slots, src.index, dst.slots, dst.index, q);
  return moved === null ? state : writeSlots(writeSlots(state, src, moved.src), dst, moved.dst);
}

function buySeeds(state: GameState, itemId: SeedItemId, quantity: number): GameState {
  if (state.ui.panel.kind !== 'shop' || !Number.isInteger(quantity) || quantity < 1 || !isSeedItemId(itemId)) return state;
  const item = getItem(itemId);
  if (item.kind !== 'seed') return state;
  if (!selectShopStock(state).some((stock) => stock.id === itemId)) {
    return pushMessage(state, `${item.name} aren't sold in ${SEASON_NAMES[state.time.season]}.`, 'warn');
  }
  const cost = item.price * quantity;
  if (cost > state.player.gold) return pushMessage(state, "You can't afford that.", 'warn');
  if (capacityFor(state.inventory, itemId) < quantity) return pushMessage(state, 'Your inventory is full.', 'warn');
  const { inventory } = addItem(state.inventory, itemId, quantity);
  const next: GameState = { ...state, inventory, player: { ...state.player, gold: state.player.gold - cost } };
  return pushMessage(next, `Bought ${item.name} ×${quantity} for ${cost}g.`, 'success');
}

/**
 * `crafting/craft`: rejected while paused or for an unknown id; otherwise, when craftCheck
 * allows it, uses the ingredients (lowest quality first) and adds the output, or explains why not.
 */
function craft(state: GameState, id: CraftingRecipeId): GameState {
  if (state.ui.paused || !Object.hasOwn(RECIPES, id)) return state;
  const check = craftCheck(state, id);
  if (!check.ok) return pushMessage(state, check.reason, 'warn');
  const recipe = RECIPES[id];
  const { inventory, added } = addItem(consumeIngredients(state.inventory, recipe), recipe.output, recipe.quantity);
  invariant(added === recipe.quantity, 'craft output room is verified by craftCheck');
  const stats = id === 'chest' && !state.stats.craftedChest ? { ...state.stats, craftedChest: true } : state.stats;
  const name = getItem(recipe.output).name;
  return pushMessage({ ...state, inventory, stats }, `Crafted ${name}${recipe.quantity > 1 ? ` ×${recipe.quantity}` : ''}.`, 'success');
}

function setTimeScale(state: GameState, timeScale: number): GameState {
  if (!(TIME.timeScales as readonly number[]).includes(timeScale) || state.ui.timeScale === timeScale) return state;
  return { ...state, ui: { ...state.ui, timeScale } };
}

/** Replaces the whole state (new game / loaded save): no panel open, unpaused, the player flagged as teleported. */
function loadState(prev: GameState, loaded: GameState): GameState {
  return {
    ...loaded,
    ui: { ...loaded.ui, panel: { kind: 'none' }, paused: false },
    player: { ...loaded.player, teleportSeq: Math.max(prev.player.teleportSeq, loaded.player.teleportSeq) + 1 },
  };
}
