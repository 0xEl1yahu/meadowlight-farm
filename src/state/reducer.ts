/**
 * The root reducer: a pure, deterministic state machine.
 *
 *   (GameState, GameAction) → GameState
 *
 * No wall-clock reads, no Math.random, no I/O. Everything stochastic goes through the seeded
 * hash in core/hash.ts, so an action log replayed from the same initial state reproduces the
 * exact same game.
 */
import { PLAYER, TIME, TOOLS } from '../config';
import { invariant } from '../core/invariant';
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
  type ItemId,
  type SeedItemId,
  type Tile,
  type TileCoord,
} from '../core/types';
import { CROPS, stageCount, createCropInstance } from '../farming/crops';
import { advanceWorldOvernight } from '../farming/growth';
import { getItem, isSeedItemId } from '../items/items';
import { formatDate, nextDay } from '../time/clock';
import { rollWeather, weatherWaters } from '../time/weather';
import { inBounds, stepTile } from '../world/grid';
import { findWarp, getMap, mapSeed, type Warp } from '../world/maps';
import { EMPTY_TILE, blockedTile, getTile, isWalkable, requireTile, setTile, setTiles } from '../world/tiles';
import type { GameAction } from './actions';
import { planInteraction, planPrimaryAction, type ActionPlan, type Intent } from './intents';
import { addItem, capacityFor, mergeStacks, removeFromSlot, selectedStack } from './inventory';
import { pushMessage } from './messages';
import {
  selectActiveMap,
  selectActiveWorld,
  selectIsFrozen,
  selectPendingShipmentValue,
  selectShopStock,
  withActiveWorld,
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
    case 'shop/setOpen':
      return setShopOpen(state, action.open);
    case 'shop/buy':
      return buySeeds(state, action.itemId, action.quantity);
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

function tick(state: GameState, minutes: number): GameState {
  if (selectIsFrozen(state) || !Number.isFinite(minutes)) return state;
  const whole = Math.min(TIME.maxTickMinutes, Math.floor(minutes));
  if (whole <= 0) return state;
  const minuteOfDay = state.time.minuteOfDay + whole;
  if (minuteOfDay >= TIME.passOutMinute) return startNextDay(state, true);
  return { ...state, time: { ...state.time, minuteOfDay } };
}

/**
 * Day transition: pay out the shipping bin, advance the calendar, roll the (global) weather,
 * run the overnight growth pipeline on every map with that map's seed, restore energy and put
 * the player back at the house on the farm.
 */
export function startNextDay(state: GameState, passedOut: boolean): GameState {
  const payout = selectPendingShipmentValue(state);
  const time = nextDay(state.time);
  const seasonChanged = time.season !== state.time.season;
  const weather = rollWeather(state.seed, time.absoluteDay);
  const ctx = { day: time.absoluteDay, season: time.season, seasonChanged, weather };
  let maps = state.maps;
  for (const id of MAP_IDS) {
    const world = advanceWorldOvernight(state.maps[id], { ...ctx, seed: mapSeed(state.seed, id) }, getMap(id));
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
  };

  next = pushMessage(next, `Good morning! ${formatDate(time)}.`, 'info');
  if (passedOut) next = pushMessage(next, 'You passed out from exhaustion and woke up at home with half your energy.', 'warn');
  if (payout > 0) next = pushMessage(next, `Your shipment sold for ${payout}g.`, 'success');
  if (seasonChanged) next = pushMessage(next, `${SEASON_NAMES[time.season]} has arrived! Out-of-season crops have withered.`, 'info');
  if (weatherWaters(weather)) {
    next = pushMessage(next, `It's ${weather === Weather.Storm ? 'storming' : 'raining'} — your crops are watered today.`, 'info');
  } else if (weather === Weather.Snow) {
    next = pushMessage(next, 'Snow blankets the farm.', 'info');
  }
  return next;
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
      return countDebrisCleared(withTile(state, target, EMPTY_TILE));

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
      return harvest(state, target, tile, intent.quantity);

    case 'clearCrop':
      return withTile(state, target, { ...tile, crop: null });

    case 'ship':
      return shipSelected(state);
  }
}

/** What a hittable blocker leaves behind when its last hit lands, and what it drops. */
function blockerRemains(blocker: Blocker): { readonly tile: Tile; readonly drop: ItemId; readonly quantity: number } {
  switch (blocker) {
    case Blocker.Rock:
      return { tile: EMPTY_TILE, drop: 'stone', quantity: TOOLS.stoneFromRock };
    case Blocker.Stump:
      return { tile: EMPTY_TILE, drop: 'wood', quantity: TOOLS.woodFromStump };
    case Blocker.Tree:
      return { tile: blockedTile(Blocker.Stump, TOOLS.stumpHits), drop: 'wood', quantity: TOOLS.woodFromTree };
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
  const { inventory, added } = addItem(cleared.inventory, remains.drop, remains.quantity);
  const next = { ...cleared, inventory };
  return added < remains.quantity ? pushMessage(next, `No room for ${getItem(remains.drop).name}.`, 'warn') : next;
}

function harvest(state: GameState, target: TileCoord, tile: Tile, quantity: number): GameState {
  const crop = tile.crop;
  invariant(crop !== null, 'harvest target has no crop');
  const def = CROPS[crop.cropId];
  const { inventory, added } = addItem(state.inventory, def.id, quantity);
  invariant(added === quantity, 'harvest capacity is verified while planning');
  const regrown =
    def.regrowDays === null
      ? null
      : { ...crop, stage: stageCount(def) - 1, daysInStage: 0, dryDays: 0, regrowing: true, harvestCount: crop.harvestCount + 1 };
  const next = withTile(state, target, { ...tile, crop: regrown });
  return pushMessage({ ...next, inventory }, `Harvested ${def.name} ×${quantity}.`, 'success');
}

function shipSelected(state: GameState): GameState {
  const stack = selectedStack(state.inventory);
  invariant(stack !== null, 'ship requires a selected stack');
  const item = getItem(stack.itemId);
  invariant(item.sellPrice !== null, `${item.id} cannot be shipped`);
  const next: GameState = {
    ...state,
    inventory: removeFromSlot(state.inventory, state.inventory.selected, stack.quantity),
    shipping: { ...state.shipping, pending: mergeStacks(state.shipping.pending, stack) },
  };
  return pushMessage(next, `Shipped ${item.name} ×${stack.quantity} — ${item.sellPrice * stack.quantity}g tomorrow.`, 'success');
}

// ---------------------------------------------------------------------------
// Inventory, shop, UI
// ---------------------------------------------------------------------------

function selectSlot(state: GameState, slot: number): GameState {
  if (!Number.isInteger(slot) || slot < 0 || slot >= state.inventory.slots.length) return state;
  if (slot === state.inventory.selected) return state;
  return { ...state, inventory: { ...state.inventory, selected: slot } };
}

function cycleSlot(state: GameState, delta: number): GameState {
  if (!Number.isInteger(delta) || delta === 0) return state;
  const size = state.inventory.slots.length;
  const selected = (((state.inventory.selected + delta) % size) + size) % size;
  return selectSlot(state, selected);
}

function setShopOpen(state: GameState, open: boolean): GameState {
  if (state.ui.shopOpen === open || (open && state.ui.paused)) return state;
  return { ...state, ui: { ...state.ui, shopOpen: open } };
}

function buySeeds(state: GameState, itemId: SeedItemId, quantity: number): GameState {
  if (!state.ui.shopOpen || !Number.isInteger(quantity) || quantity < 1 || !isSeedItemId(itemId)) return state;
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

function setTimeScale(state: GameState, timeScale: number): GameState {
  if (!(TIME.timeScales as readonly number[]).includes(timeScale) || state.ui.timeScale === timeScale) return state;
  return { ...state, ui: { ...state.ui, timeScale } };
}

/** Replaces the whole state (new game / loaded save). The player is flagged as teleported. */
function loadState(prev: GameState, loaded: GameState): GameState {
  return {
    ...loaded,
    ui: { ...loaded.ui, shopOpen: false, paused: false },
    player: { ...loaded.player, teleportSeq: Math.max(prev.player.teleportSeq, loaded.player.teleportSeq) + 1 },
  };
}
