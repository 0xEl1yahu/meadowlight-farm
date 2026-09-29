/**
 * Shared fixtures for the simulation test-suite.
 *
 * Small, explicit state builders let each test say exactly which tile, item, player position
 * and calendar day it exercises, instead of depending on where the seeded world generator
 * happened to put debris. The canonical scenario stands the player on STAND (inside the
 * guaranteed-clear zone south of the house) facing South, so the forward ray hits TARGET.
 *
 * BASE is deep-frozen: any reducer that mutates state instead of copying it throws a
 * TypeError the moment a test touches it.
 */
import { INVENTORY } from '../src/config';
import { deepFreeze } from '../src/core/store';
import {
  Blocker,
  Direction,
  TileState,
  type CropId,
  type CropInstance,
  type GameState,
  type ItemId,
  type ItemStack,
  type MapId,
  type Quality,
  type Tile,
  type TileCoord,
  type WorldState,
} from '../src/core/types';
import { createCropInstance, CROPS, stageCount } from '../src/farming/crops';
import { createDefaultSections, createInitialState } from '../src/state/initialState';
import { countItem } from '../src/state/inventory';
import { serializeGame } from '../src/state/persistence';
import { withMap } from '../src/state/selectors';
import { calendarTime } from '../src/time/clock';
import { locateTile } from '../src/world/grid';
import { isWalkable, requireTile, setTile } from '../src/world/tiles';

/** Tile the canonical scenario stands on (clear zone, always walkable). */
export const STAND: TileCoord = { tx: 5, tz: 9 };
/** Tile directly South of STAND: the forward-ray target of the canonical scenario. */
export const TARGET: TileCoord = { tx: 5, tz: 10 };

/** Deep-frozen default new game. Shared safely because nothing may mutate it. */
export const BASE: GameState = deepFreeze(createInitialState());

/** Narrows an optional value, failing the test with a clear message when it is missing. */
export function must<T>(value: T | null | undefined, message = 'expected a value'): T {
  if (value === null || value === undefined) throw new Error(message);
  return value;
}

/** Timeout for the dense randomised tests, generous enough for heavily loaded CI machines. */
export const HEAVY_TEST_TIMEOUT_MS = 120_000;

/**
 * Structural equality for plain JSON-like data (objects, arrays, primitives). Used by dense
 * property loops, which collect violations and assert once instead of calling `expect`
 * hundreds of thousands of times.
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const recordA = a as Record<string, unknown>;
  const recordB = b as Record<string, unknown>;
  const keysA = Object.keys(recordA);
  if (keysA.length !== Object.keys(recordB).length) return false;
  return keysA.every((key) => Object.prototype.hasOwnProperty.call(recordB, key) && deepEqual(recordA[key], recordB[key]));
}

/** Accumulates human-readable violations; `list` stays empty while every check holds. */
export class Violations {
  readonly list: string[] = [];

  check(condition: boolean, message: string | (() => string)): void {
    if (!condition) this.list.push(typeof message === 'string' ? message : message());
  }

  equal(label: string, actual: unknown, expected: unknown): void {
    if (!deepEqual(actual, expected)) this.list.push(`${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
  }

  same(label: string, actual: unknown, expected: unknown): void {
    if (actual !== expected) this.list.push(`${label}: reference changed`);
  }

  /** The first few violations (keeps failure output readable). */
  head(count = 15): string[] {
    return this.list.slice(0, count);
  }
}

/** Tile at `coord` on `mapId` (default: the map the player stands on). */
export function tileAt(state: GameState, coord: TileCoord, mapId: MapId = state.player.mapId): Tile {
  return requireTile(state.maps[mapId], coord.tx, coord.tz);
}

/** Writes one tile on `mapId` (default: the map the player stands on). */
export function withTile(state: GameState, coord: TileCoord, tile: Tile, mapId: MapId = state.player.mapId): GameState {
  return withMap(state, mapId, setTile(state.maps[mapId], coord.tx, coord.tz, tile));
}

/**
 * Places the player without walking, on `mapId` (default: the map they stand on). The
 * destination must be walkable.
 */
export function withPlayer(state: GameState, coord: TileCoord, facing: Direction, mapId: MapId = state.player.mapId): GameState {
  if (!isWalkable(requireTile(state.maps[mapId], coord.tx, coord.tz))) {
    throw new Error(`withPlayer: (${coord.tx}, ${coord.tz}) on ${mapId} is not walkable`);
  }
  return { ...state, player: { ...state.player, mapId, tx: coord.tx, tz: coord.tz, facing } };
}

/** A stack of `quantity` × `itemId` at `quality` (normal by default). */
export function stack(itemId: ItemId, quantity: number, quality: Quality = 0): ItemStack {
  return { itemId, quantity, quality };
}

/**
 * Replaces every inventory slot: `stacks` from slot 0 onwards, padded with empty slots to
 * INVENTORY.slotCount, and selects hotbar slot `selected`.
 */
export function withSlots(state: GameState, stacks: readonly (ItemStack | null)[], selected = 0): GameState {
  const slots = Array.from({ length: INVENTORY.slotCount }, (_, i) => stacks[i] ?? null);
  return { ...state, inventory: { ...state.inventory, slots, selected } };
}

/**
 * Selects a stack of `itemId` at `quality` on the hotbar: reuses the hotbar slot that already
 * holds that item (setting its quantity and quality), otherwise the first empty hotbar slot.
 */
export function holding(state: GameState, itemId: ItemId, quantity = 1, quality: Quality = 0): GameState {
  const slots = state.inventory.slots.slice();
  const hotbar = slots.slice(0, INVENTORY.hotbarSize);
  let slot = hotbar.findIndex((held) => held !== null && held.itemId === itemId);
  if (slot === -1) slot = hotbar.findIndex((held) => held === null);
  if (slot === -1) throw new Error('holding: no free hotbar slot');
  slots[slot] = { itemId, quantity, quality };
  return { ...state, inventory: { ...state.inventory, slots, selected: slot } };
}

/** Selects an empty hotbar slot (empty hands). */
export function emptyHanded(state: GameState): GameState {
  const slot = state.inventory.slots.slice(0, INVENTORY.hotbarSize).findIndex((held) => held === null);
  if (slot === -1) throw new Error('emptyHanded: no free hotbar slot');
  return { ...state, inventory: { ...state.inventory, selected: slot } };
}

export function withEnergy(state: GameState, energy: number): GameState {
  return { ...state, player: { ...state.player, energy } };
}

export function withWater(state: GameState, water: number): GameState {
  return { ...state, inventory: { ...state.inventory, water } };
}

export function withGold(state: GameState, gold: number): GameState {
  return { ...state, player: { ...state.player, gold } };
}

/** Moves the calendar to `absoluteDay` (weather is left as-is). */
export function atDay(state: GameState, absoluteDay: number, minuteOfDay = 600): GameState {
  return { ...state, time: calendarTime(absoluteDay, minuteOfDay) };
}

export function soilTile(state: typeof TileState.Plowed | typeof TileState.Watered, crop: CropInstance | null = null): Tile {
  return { state, blocker: Blocker.None, blockerHp: 0, crop, object: null, fertilizer: null };
}

export function cropOf(cropId: CropId, overrides: Partial<CropInstance> = {}): CropInstance {
  return { ...createCropInstance(cropId, 0), ...overrides };
}

export function matureCrop(cropId: CropId, overrides: Partial<CropInstance> = {}): CropInstance {
  return cropOf(cropId, { stage: stageCount(CROPS[cropId]), ...overrides });
}

/** The canonical scenario: TARGET holds `tile`, the player stands on STAND facing South. */
export function scenario(tile: Tile, base: GameState = BASE): GameState {
  return withPlayer(withTile(base, TARGET, tile), STAND, Direction.South);
}

export function count(state: GameState, itemId: ItemId): number {
  return countItem(state.inventory, itemId);
}

/**
 * Asserts that `next` differs from `prev` in at most the tile at `coord`: every other chunk
 * keeps its identity, and so does every other tile of the touched chunk. Returns a list of
 * violations (empty when the change is confined).
 */
export function worldChangesOutside(prev: WorldState, next: WorldState, coord: TileCoord | null): string[] {
  const problems: string[] = [];
  if (prev.chunks.length !== next.chunks.length) return ['chunk count changed'];
  const loc = coord === null ? null : locateTile(prev.grid, coord.tx, coord.tz);
  for (let ci = 0; ci < prev.chunks.length; ci++) {
    const a = prev.chunks[ci];
    const b = next.chunks[ci];
    if (a === b) continue;
    if (a === undefined || b === undefined) {
      problems.push(`chunk ${ci} missing`);
      continue;
    }
    if (loc === null || ci !== loc.chunkIndex) {
      problems.push(`chunk ${ci} replaced`);
      continue;
    }
    for (let i = 0; i < a.tiles.length; i++) {
      if (i !== loc.localIndex && a.tiles[i] !== b.tiles[i]) problems.push(`chunk ${ci} tile ${i} replaced`);
    }
  }
  return problems;
}

/** Breadth-first search over walkable tiles; returns the set of reachable global tile keys. */
export function reachableFrom(world: WorldState, start: TileCoord): Set<string> {
  const key = (tx: number, tz: number): string => `${tx},${tz}`;
  const seen = new Set<string>([key(start.tx, start.tz)]);
  const queue: TileCoord[] = [start];
  const steps: readonly TileCoord[] = [
    { tx: 0, tz: -1 },
    { tx: 1, tz: 0 },
    { tx: 0, tz: 1 },
    { tx: -1, tz: 0 },
  ];
  for (let head = 0; head < queue.length; head++) {
    const current = queue[head];
    if (current === undefined) break;
    for (const step of steps) {
      const tx = current.tx + step.tx;
      const tz = current.tz + step.tz;
      if (tx < 0 || tz < 0 || tx >= world.grid.width || tz >= world.grid.depth) continue;
      if (seen.has(key(tx, tz)) || !isWalkable(requireTile(world, tx, tz))) continue;
      seen.add(key(tx, tz));
      queue.push({ tx, tz });
    }
  }
  return seen;
}

/** JSON object shape of a save, as parsed. */
export type SaveJson = Record<string, unknown>;

/** A saved stack without its quality; only normal-quality stacks exist before version 3. */
function legacyStack(saved: SaveJson, version: 1 | 2): SaveJson {
  if (saved.quality !== 0) throw new Error(`legacySave: a version-${version} save has no item quality`);
  const { quality: _quality, ...rest } = saved;
  return rest;
}

/**
 * Hand-transforms a current state back into the JSON of an older save version.
 * - Version 2 has a single `world` (the farm) instead of `maps`, no `player.mapId`, no
 *   later-workstream sections and no `object` / `fertilizer` on tiles. Its stacks have no
 *   quality, its inventory is the 12-slot hotbar with no `unlockedSlots`, and its UI has
 *   `shopOpen` instead of `panel`.
 * - Version 1 additionally predates wild crops: they are dropped, and sown crops lose `wild`.
 * The state must not hold anything an old save cannot express (a player off the farm, placed
 * objects, fertiliser, silver or gold stacks, anything in the backpack).
 */
export function legacySave(state: GameState, version: 1 | 2): SaveJson {
  if (state.player.mapId !== 'farm') throw new Error(`legacySave: a version-${version} save has only the farm`);
  const save = JSON.parse(serializeGame(state)) as SaveJson;
  for (const key of Object.keys(createDefaultSections())) delete save[key];
  save.version = version;
  const inventory = save.inventory as SaveJson;
  const slots = inventory.slots as (SaveJson | null)[];
  if (slots.slice(INVENTORY.hotbarSize).some((slot) => slot !== null)) {
    throw new Error(`legacySave: a version-${version} save has no backpack`);
  }
  inventory.slots = slots.slice(0, INVENTORY.hotbarSize).map((slot) => (slot === null ? null : legacyStack(slot, version)));
  delete inventory.unlockedSlots;
  const shipping = save.shipping as SaveJson;
  shipping.pending = (shipping.pending as SaveJson[]).map((pending) => legacyStack(pending, version));
  const ui = save.ui as SaveJson;
  save.ui = { shopOpen: false, paused: ui.paused, timeScale: ui.timeScale };
  save.world = (save.maps as SaveJson).farm;
  delete save.maps;
  delete (save.player as SaveJson).mapId;
  const world = save.world as { chunks: { tiles: SaveJson[] }[] };
  for (const chunk of world.chunks) {
    for (const tile of chunk.tiles) {
      if (tile.object !== null || tile.fertilizer !== null) {
        throw new Error(`legacySave: a version-${version} save cannot hold placed objects or fertiliser`);
      }
      delete tile.object;
      delete tile.fertilizer;
      if (version === 1 && tile.crop !== null) {
        const crop = tile.crop as SaveJson;
        if (crop.wild === true) tile.crop = null;
        else delete crop.wild;
      }
    }
  }
  return save;
}
