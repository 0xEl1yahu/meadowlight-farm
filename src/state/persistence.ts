/**
 * Save / load. GameState is plain JSON-compatible data, so persistence is serialisation plus a
 * strict structural validator — a corrupted or outdated save is rejected, never half-loaded.
 */
import { TIME } from '../config';
import {
  Blocker,
  CROP_IDS,
  SAVE_VERSION,
  TOOL_TYPES,
  TileState,
  Weather,
  type ActionEvent,
  type CropInstance,
  type GameState,
  type GridSpec,
  type ItemStack,
  type Tile,
} from '../core/types';
import { CROPS, stageCount } from '../farming/crops';
import { getItem, isItemId } from '../items/items';
import { calendarTime } from '../time/clock';
import { chunkCount, chunkRectByIndex, createGridSpec, inBounds } from '../world/grid';
import { getTile, isWalkable } from '../world/tiles';

export const SAVE_KEY = 'meadowlight-farm.save.v1';

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const isIntIn = (v: unknown, min: number, max: number): v is number => isInt(v) && v >= min && v <= max;
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
const TILE_STATES: readonly number[] = Object.values(TileState);
const BLOCKERS: readonly number[] = Object.values(Blocker);
const WEATHERS: readonly string[] = Object.values(Weather);

function isValidCrop(v: unknown): v is CropInstance {
  if (!isObj(v) || typeof v.cropId !== 'string' || !(CROP_IDS as readonly string[]).includes(v.cropId)) return false;
  const def = CROPS[v.cropId as CropInstance['cropId']];
  return (
    isIntIn(v.stage, 0, stageCount(def)) &&
    isIntIn(v.daysInStage, 0, 1000) &&
    isIntIn(v.dryDays, 0, 1_000_000) &&
    isBool(v.regrowing) &&
    isBool(v.dead) &&
    isIntIn(v.plantedDay, 0, Number.MAX_SAFE_INTEGER) &&
    isIntIn(v.harvestCount, 0, Number.MAX_SAFE_INTEGER)
  );
}

function isValidTile(v: unknown): v is Tile {
  if (!isObj(v) || !isInt(v.state) || !TILE_STATES.includes(v.state) || !isInt(v.blocker) || !BLOCKERS.includes(v.blocker)) {
    return false;
  }
  if ((v.state === TileState.Blocked) !== (v.blocker !== Blocker.None)) return false;
  if (!isIntIn(v.blockerHp, 0, 100)) return false;
  if (v.crop === null) return true;
  return (v.state === TileState.Plowed || v.state === TileState.Watered) && isValidCrop(v.crop);
}

function isValidGrid(v: unknown): v is GridSpec {
  if (!isObj(v) || !isIntIn(v.width, 1, 4096) || !isIntIn(v.depth, 1, 4096) || !isIntIn(v.chunkSize, 1, 4096)) return false;
  if (typeof v.tileSize !== 'number' || !Number.isFinite(v.tileSize) || !(v.tileSize > 0)) return false;
  const expected = createGridSpec(v.width, v.depth, v.chunkSize, v.tileSize);
  return (Object.keys(expected) as (keyof GridSpec)[]).every((key) => expected[key] === v[key]);
}

const ACTION_KINDS: readonly string[] = [...TOOL_TYPES, 'plant', 'harvest', 'ship', 'refill', 'sleep', 'none'];

function isValidActionEvent(v: unknown): v is ActionEvent {
  if (!isObj(v) || !isIntIn(v.seq, 1, Number.MAX_SAFE_INTEGER) || typeof v.kind !== 'string') return false;
  if (!ACTION_KINDS.includes(v.kind) || !isBool(v.success)) return false;
  return v.target === null || (isObj(v.target) && isInt(v.target.tx) && isInt(v.target.tz));
}

function isValidStack(v: unknown, enforceMaxStack: boolean): v is ItemStack {
  if (!isObj(v) || !isItemId(v.itemId) || !isInt(v.quantity) || v.quantity < 1) return false;
  return !enforceMaxStack || v.quantity <= getItem(v.itemId).maxStack;
}

/** Structural validation of an untrusted value (e.g. parsed JSON). */
export function isValidGameState(v: unknown): v is GameState {
  if (!isObj(v) || v.version !== SAVE_VERSION || !isIntIn(v.seed, 0, 0xffffffff)) return false;

  const time = v.time;
  if (
    !isObj(time) ||
    !isIntIn(time.minuteOfDay, TIME.dayStartMinute, TIME.passOutMinute) ||
    !isIntIn(time.dayOfSeason, 1, TIME.daysPerSeason) ||
    !isIntIn(time.season, 0, TIME.seasonsPerYear - 1) ||
    !isIntIn(time.year, 1, Number.MAX_SAFE_INTEGER) ||
    !isIntIn(time.absoluteDay, 0, Number.MAX_SAFE_INTEGER)
  ) {
    return false;
  }
  // Day, season and year are derived from absoluteDay; a save where they disagree is corrupt.
  const calendar = calendarTime(time.absoluteDay, time.minuteOfDay);
  if (calendar.dayOfSeason !== time.dayOfSeason || calendar.season !== time.season || calendar.year !== time.year) {
    return false;
  }
  if (typeof v.weather !== 'string' || !WEATHERS.includes(v.weather)) return false;

  const world = v.world;
  if (!isObj(world) || !isValidGrid(world.grid) || !Array.isArray(world.chunks)) return false;
  const grid = world.grid;
  if (world.chunks.length !== chunkCount(grid)) return false;
  for (let i = 0; i < world.chunks.length; i++) {
    const chunk: unknown = world.chunks[i];
    const rect = chunkRectByIndex(grid, i);
    if (
      !isObj(chunk) ||
      chunk.cx !== rect.cx ||
      chunk.cz !== rect.cz ||
      chunk.x0 !== rect.x0 ||
      chunk.z0 !== rect.z0 ||
      chunk.width !== rect.width ||
      chunk.depth !== rect.depth ||
      !isIntIn(chunk.revision, 0, Number.MAX_SAFE_INTEGER) ||
      !Array.isArray(chunk.tiles) ||
      chunk.tiles.length !== rect.width * rect.depth ||
      !chunk.tiles.every(isValidTile)
    ) {
      return false;
    }
  }

  const player = v.player;
  if (
    !isObj(player) ||
    !isInt(player.tx) ||
    !isInt(player.tz) ||
    !inBounds(grid, player.tx, player.tz) ||
    !isIntIn(player.facing, 0, 3) ||
    !isIntIn(player.maxEnergy, 1, 100_000) ||
    !isIntIn(player.energy, 0, player.maxEnergy) ||
    !isIntIn(player.gold, 0, Number.MAX_SAFE_INTEGER) ||
    !isIntIn(player.moveSeq, 0, Number.MAX_SAFE_INTEGER) ||
    !isIntIn(player.teleportSeq, 0, Number.MAX_SAFE_INTEGER) ||
    !isIntIn(player.actionSeq, 0, Number.MAX_SAFE_INTEGER)
  ) {
    return false;
  }
  const standingOn = getTile(world as unknown as GameState['world'], player.tx, player.tz);
  if (standingOn === null || !isWalkable(standingOn)) return false;
  if (player.lastAction !== null && !isValidActionEvent(player.lastAction)) return false;
  if (player.lastAction !== null && player.lastAction.seq !== player.actionSeq) return false;

  const inventory = v.inventory;
  if (
    !isObj(inventory) ||
    !Array.isArray(inventory.slots) ||
    inventory.slots.length < 1 ||
    !inventory.slots.every((slot: unknown) => slot === null || isValidStack(slot, true)) ||
    !isIntIn(inventory.selected, 0, inventory.slots.length - 1) ||
    !isIntIn(inventory.waterCapacity, 1, 100_000) ||
    !isIntIn(inventory.water, 0, inventory.waterCapacity)
  ) {
    return false;
  }

  const shipping = v.shipping;
  if (
    !isObj(shipping) ||
    !Array.isArray(shipping.pending) ||
    !shipping.pending.every((stack: unknown) => isValidStack(stack, false)) ||
    !isIntIn(shipping.lastPayout, 0, Number.MAX_SAFE_INTEGER)
  ) {
    return false;
  }

  const ui = v.ui;
  if (
    !isObj(ui) ||
    !isBool(ui.shopOpen) ||
    !isBool(ui.paused) ||
    typeof ui.timeScale !== 'number' ||
    !(TIME.timeScales as readonly number[]).includes(ui.timeScale)
  ) {
    return false;
  }

  const messages = v.messages;
  return (
    isObj(messages) &&
    isIntIn(messages.nextId, 0, Number.MAX_SAFE_INTEGER) &&
    Array.isArray(messages.entries) &&
    messages.entries.every(
      (entry: unknown) =>
        isObj(entry) &&
        isInt(entry.id) &&
        typeof entry.text === 'string' &&
        (entry.tone === 'info' || entry.tone === 'success' || entry.tone === 'warn') &&
        isInt(entry.day) &&
        isInt(entry.minute),
    )
  );
}

export function serializeGame(state: GameState): string {
  return JSON.stringify(state);
}

export function deserializeGame(json: string): GameState | null {
  try {
    const parsed: unknown = JSON.parse(json);
    if (!isValidGameState(parsed)) return null;
    return { ...parsed, ui: { ...parsed.ui, shopOpen: false, paused: false } };
  } catch {
    return null;
  }
}

function storage(): Storage | null {
  try {
    return typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage;
  } catch {
    return null;
  }
}

export function saveGame(state: GameState): boolean {
  try {
    const store = storage();
    if (store === null) return false;
    store.setItem(SAVE_KEY, serializeGame(state));
    return true;
  } catch {
    return false;
  }
}

export function loadGame(): GameState | null {
  try {
    const raw = storage()?.getItem(SAVE_KEY);
    return raw === null || raw === undefined ? null : deserializeGame(raw);
  } catch {
    return null;
  }
}

export function clearSave(): void {
  try {
    storage()?.removeItem(SAVE_KEY);
  } catch {
    // Storage unavailable (private mode, sandboxed iframe): nothing to clear.
  }
}
