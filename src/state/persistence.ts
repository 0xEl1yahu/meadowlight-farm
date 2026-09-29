/**
 * Save / load. GameState is plain JSON-compatible data, so persistence is serialisation plus a
 * strict structural validator — a corrupted or outdated save is rejected, never half-loaded.
 */
import { TIME } from '../config';
import {
  SAVE_VERSION,
  Weather,
  type ActionEvent,
  type ActionKind,
  type GameState,
  type GridSpec,
  type WorldState,
} from '../core/types';
import { calendarTime } from '../time/clock';
import { chunkCount, chunkRectByIndex, createGridSpec, inBounds } from '../world/grid';
import { assertWorldObjectsConsistent, getTile, isWalkable } from '../world/tiles';
import { createDefaultSections } from './initialState';
import { isValidSections } from './sectionValidation';
import { isBool, isCount, isInt, isIntIn, isObj, isOneOf, isValidStack, isValidTile, type Obj } from './validation';

export const SAVE_KEY = 'meadowlight-farm.save.v1';

const WEATHERS: readonly string[] = Object.values(Weather);

/**
 * One entry per ActionKind. The `satisfies` clause makes the compiler reject a missing or an
 * unknown kind, so the validator's list can never drift from the type again.
 */
const ACTION_KIND_TABLE = {
  hoe: true,
  wateringCan: true,
  pickaxe: true,
  axe: true,
  scythe: true,
  plant: true,
  harvest: true,
  ship: true,
  refill: true,
  sleep: true,
  openChest: true,
  none: true,
} as const satisfies Readonly<Record<ActionKind, true>>;

/** Every ActionKind, each exactly once. */
export const ACTION_KINDS = Object.keys(ACTION_KIND_TABLE) as readonly ActionKind[];

function isValidGrid(v: unknown): v is GridSpec {
  if (!isObj(v) || !isIntIn(v.width, 1, 4096) || !isIntIn(v.depth, 1, 4096) || !isIntIn(v.chunkSize, 1, 4096)) return false;
  if (typeof v.tileSize !== 'number' || !Number.isFinite(v.tileSize) || !(v.tileSize > 0)) return false;
  const expected = createGridSpec(v.width, v.depth, v.chunkSize, v.tileSize);
  return (Object.keys(expected) as (keyof GridSpec)[]).every((key) => expected[key] === v[key]);
}

function isValidActionEvent(v: unknown): v is ActionEvent {
  if (!isObj(v) || !isIntIn(v.seq, 1, Number.MAX_SAFE_INTEGER) || !isOneOf(v.kind, ACTION_KINDS)) return false;
  if (!isBool(v.success)) return false;
  return v.target === null || (isObj(v.target) && isInt(v.target.tx) && isInt(v.target.tz));
}

function isValidTime(time: unknown): boolean {
  if (
    !isObj(time) ||
    !isIntIn(time.minuteOfDay, TIME.dayStartMinute, TIME.passOutMinute) ||
    !isIntIn(time.dayOfSeason, 1, TIME.daysPerSeason) ||
    !isIntIn(time.season, 0, TIME.seasonsPerYear - 1) ||
    !isIntIn(time.year, 1, Number.MAX_SAFE_INTEGER) ||
    !isCount(time.absoluteDay)
  ) {
    return false;
  }
  // Day, season and year are derived from absoluteDay; a save where they disagree is corrupt.
  const calendar = calendarTime(time.absoluteDay, time.minuteOfDay);
  return calendar.dayOfSeason === time.dayOfSeason && calendar.season === time.season && calendar.year === time.year;
}

/** Grid, chunk layout, every tile, and the world-level placed-object rules (giant crops). */
function isValidWorld(world: unknown): world is WorldState {
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
      !isCount(chunk.revision) ||
      !Array.isArray(chunk.tiles) ||
      chunk.tiles.length !== rect.width * rect.depth ||
      !chunk.tiles.every(isValidTile)
    ) {
      return false;
    }
  }
  try {
    assertWorldObjectsConsistent(world as unknown as WorldState);
  } catch {
    return false;
  }
  return true;
}

/** Position, energy, gold and sequence counters; the player must stand on a walkable tile. */
function isValidPlayer(player: unknown, world: WorldState): boolean {
  if (
    !isObj(player) ||
    !isInt(player.tx) ||
    !isInt(player.tz) ||
    !inBounds(world.grid, player.tx, player.tz) ||
    !isIntIn(player.facing, 0, 3) ||
    !isIntIn(player.maxEnergy, 1, 100_000) ||
    !isIntIn(player.energy, 0, player.maxEnergy) ||
    !isCount(player.gold) ||
    !isCount(player.moveSeq) ||
    !isCount(player.teleportSeq) ||
    !isCount(player.actionSeq)
  ) {
    return false;
  }
  const standingOn = getTile(world, player.tx, player.tz);
  if (standingOn === null || !isWalkable(standingOn)) return false;
  if (player.lastAction === null) return true;
  return isValidActionEvent(player.lastAction) && player.lastAction.seq === player.actionSeq;
}

function isValidInventory(inventory: unknown): boolean {
  return (
    isObj(inventory) &&
    Array.isArray(inventory.slots) &&
    inventory.slots.length >= 1 &&
    inventory.slots.every((slot: unknown) => slot === null || isValidStack(slot, true)) &&
    isIntIn(inventory.selected, 0, inventory.slots.length - 1) &&
    isIntIn(inventory.waterCapacity, 1, 100_000) &&
    isIntIn(inventory.water, 0, inventory.waterCapacity)
  );
}

function isValidShipping(shipping: unknown): boolean {
  return (
    isObj(shipping) &&
    Array.isArray(shipping.pending) &&
    shipping.pending.every((stack: unknown) => isValidStack(stack, false)) &&
    isCount(shipping.lastPayout)
  );
}

function isValidUi(ui: unknown): boolean {
  return (
    isObj(ui) &&
    isBool(ui.shopOpen) &&
    isBool(ui.paused) &&
    typeof ui.timeScale === 'number' &&
    (TIME.timeScales as readonly number[]).includes(ui.timeScale)
  );
}

function isValidMessages(messages: unknown): boolean {
  return (
    isObj(messages) &&
    isCount(messages.nextId) &&
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

/** Structural validation of an untrusted value (e.g. parsed JSON), one section at a time. */
export function isValidGameState(v: unknown): v is GameState {
  return (
    isObj(v) &&
    v.version === SAVE_VERSION &&
    isIntIn(v.seed, 0, 0xffffffff) &&
    isValidTime(v.time) &&
    typeof v.weather === 'string' &&
    WEATHERS.includes(v.weather) &&
    isValidWorld(v.world) &&
    isValidPlayer(v.player, v.world) &&
    isValidInventory(v.inventory) &&
    isValidShipping(v.shipping) &&
    isValidUi(v.ui) &&
    isValidMessages(v.messages) &&
    isValidSections(v)
  );
}

export function serializeGame(state: GameState): string {
  return JSON.stringify(state);
}

/** Rebuilds every tile of a saved world with `fn`; returns null when the world is malformed. */
function mapSavedTiles(world: unknown, fn: (tile: Obj) => Obj): Obj | null {
  if (!isObj(world) || !Array.isArray(world.chunks)) return null;
  const chunks: unknown[] = [];
  for (const chunk of world.chunks as readonly unknown[]) {
    if (!isObj(chunk) || !Array.isArray(chunk.tiles)) return null;
    const tiles: unknown[] = [];
    for (const tile of chunk.tiles as readonly unknown[]) {
      if (!isObj(tile)) return null;
      tiles.push(fn(tile));
    }
    chunks.push({ ...chunk, tiles });
  }
  return { ...world, chunks };
}

/** Version 1 predates wild crops: every crop it holds was sown by the player, so each gains `wild: false`. */
function migrateV1toV2(save: Obj): Obj {
  const world = mapSavedTiles(save.world, (tile) => (isObj(tile.crop) ? { ...tile, crop: { ...tile.crop, wild: false } } : tile));
  return world === null ? save : { ...save, version: 2, world };
}

/**
 * Version 2 predates placed objects, fertiliser and the later-workstream sections: every tile
 * gains `object: null, fertilizer: null` (chunk revisions are kept) and every section starts
 * from `createDefaultSections()`, exactly as a new game would.
 */
function migrateV2toV3(save: Obj): Obj {
  if (!isIntIn(save.seed, 0, 0xffffffff)) return save;
  const world = mapSavedTiles(save.world, (tile) => ({ ...tile, object: null, fertilizer: null }));
  return world === null ? save : { ...save, ...createDefaultSections(), version: 3, world };
}

/**
 * Upgrades older save formats to the current one, one version at a time; each step writes its
 * own literal version. Unexpected shapes pass through untouched and are then rejected by the
 * validator.
 */
export function migrateSave(value: unknown): unknown {
  let v = value;
  if (isObj(v) && v.version === 1) v = migrateV1toV2(v);
  if (isObj(v) && v.version === 2) v = migrateV2toV3(v);
  return v;
}

export function deserializeGame(json: string): GameState | null {
  try {
    const parsed: unknown = migrateSave(JSON.parse(json));
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
