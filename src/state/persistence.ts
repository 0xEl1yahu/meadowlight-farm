/**
 * Save / load. GameState is plain JSON-compatible data, so persistence is serialisation plus a
 * strict structural validator — a corrupted or outdated save is rejected, never half-loaded.
 */
import { INVENTORY, TIME } from '../config';
import {
  Blocker,
  MAP_IDS,
  SAVE_VERSION,
  TileState,
  Weather,
  type ActionEvent,
  type ActionKind,
  type GameState,
  type GridSpec,
  type MapId,
  type WorldState,
} from '../core/types';
import { calendarTime } from '../time/clock';
import { chunkCount, chunkRectByIndex, createGridSpec, inBounds } from '../world/grid';
import { MAPS, isReservedTile } from '../world/maps';
import { assertWorldObjectsConsistent, getTile, isWalkable } from '../world/tiles';
import { createDefaultSections } from './initialState';
import { isValidRobotsSection } from './robotValidation';
import { isValidSections } from './sectionValidation';
import {
  hasExactKeys,
  isBool,
  isCount,
  isInt,
  isIntIn,
  isObj,
  isOneOf,
  isValidStack,
  isValidTile,
  type Obj,
} from './validation';

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
  place: true,
  fertilize: true,
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

/**
 * The map's grid (deep-equal to the map definition's: the same fields, no others), chunk
 * layout, every tile, and the world-level placed-object rules (giant crops).
 */
function isValidWorld(world: unknown, id: MapId): world is WorldState {
  if (!isObj(world) || !isValidGrid(world.grid) || !Array.isArray(world.chunks)) return false;
  const grid = world.grid;
  const expected = MAPS[id].grid;
  const keys = Object.keys(expected) as (keyof GridSpec)[];
  if (!hasExactKeys(grid as unknown as Obj, keys) || keys.some((key) => expected[key] !== grid[key])) return false;
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

/** Exactly one valid world per map id. */
function isValidMaps(maps: unknown): maps is GameState['maps'] {
  return isObj(maps) && hasExactKeys(maps, MAP_IDS) && MAP_IDS.every((id) => isValidWorld(maps[id], id));
}

/** Map, position, energy, gold and sequence counters; the player must stand on a walkable tile of their map. */
function isValidPlayer(player: unknown, maps: GameState['maps']): boolean {
  if (!isObj(player) || !isOneOf(player.mapId, MAP_IDS)) return false;
  const world = maps[player.mapId];
  if (
    !isInt(player.tx) ||
    !isInt(player.tz) ||
    !inBounds(world.grid, player.tx, player.tz) ||
    !isIntIn(player.facing, 0, 3) ||
    !isIntIn(player.maxEnergy, 1, 100_000) ||
    !isIntIn(player.energy, 0, player.maxEnergy) ||
    !isCount(player.gold) ||
    !isCount(player.moveSeq) ||
    !isCount(player.teleportSeq) ||
    !isCount(player.actionSeq) ||
    !(player.carrying === null || isIntIn(player.carrying, 1, Number.MAX_SAFE_INTEGER))
  ) {
    return false;
  }
  const standingOn = getTile(world, player.tx, player.tz);
  if (standingOn === null || !isWalkable(standingOn)) return false;
  if (player.lastAction === null) return true;
  return isValidActionEvent(player.lastAction) && player.lastAction.seq === player.actionSeq;
}

/** The two sizes the backpack comes in: the starting 24 slots, and all 36 after the upgrade. */
const UNLOCKED_SLOT_COUNTS: readonly number[] = [INVENTORY.startingUnlockedSlots, INVENTORY.slotCount];

/**
 * INVENTORY.slotCount slots, each null or a valid stack; every slot at or above `unlockedSlots`
 * is null; the selection is a hotbar slot; the water fits the can.
 */
function isValidInventory(inventory: unknown): boolean {
  if (!isObj(inventory) || !Array.isArray(inventory.slots) || inventory.slots.length !== INVENTORY.slotCount) return false;
  const unlocked = inventory.unlockedSlots;
  if (!isOneOf(unlocked, UNLOCKED_SLOT_COUNTS)) return false;
  return (
    (inventory.slots as readonly unknown[]).every(
      (slot, i) => slot === null || (i < unlocked && isValidStack(slot, true)),
    ) &&
    isIntIn(inventory.selected, 0, INVENTORY.hotbarSize - 1) &&
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

/**
 * The UI section. Only the panel's shape is checked (an object with a string `kind`): the loader
 * resets it anyway, and later panel kinds must not need a migration.
 */
function isValidUi(ui: unknown): boolean {
  return (
    isObj(ui) &&
    isObj(ui.panel) &&
    typeof ui.panel.kind === 'string' &&
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
    isValidMaps(v.maps) &&
    isValidPlayer(v.player, v.maps) &&
    isValidInventory(v.inventory) &&
    isValidShipping(v.shipping) &&
    isValidUi(v.ui) &&
    isValidMessages(v.messages) &&
    isValidSections(v) &&
    isValidRobotsSection(v.robots, v.maps, v.player)
  );
}

export function serializeGame(state: GameState): string {
  return JSON.stringify(state);
}

/**
 * Rebuilds every tile of a saved world with `fn(tile, tx, tz)`; returns null when the world is
 * malformed. Tile coordinates come from each chunk's own `x0`, `z0` and `width`.
 */
function mapSavedTiles(world: unknown, fn: (tile: Obj, tx: number, tz: number) => Obj): Obj | null {
  if (!isObj(world) || !Array.isArray(world.chunks)) return null;
  const chunks: unknown[] = [];
  for (const chunk of world.chunks as readonly unknown[]) {
    if (!isObj(chunk) || !Array.isArray(chunk.tiles)) return null;
    const { x0, z0, width } = chunk;
    if (!isInt(x0) || !isInt(z0) || !isIntIn(width, 1, 4096)) return null;
    const tiles: unknown[] = [];
    (chunk.tiles as readonly unknown[]).forEach((tile, i) => {
      if (isObj(tile)) tiles.push(fn(tile, x0 + (i % width), z0 + Math.floor(i / width)));
    });
    if (tiles.length !== chunk.tiles.length) return null;
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
 * A saved v2 tile as a v3 tile: gains `object: null, fertilizer: null`, and a Rock or Stump on
 * a farm gate (reserved) tile is carved away. Only well-formed debris is carved: a corrupt
 * tile keeps its fault, so the validator still rejects the save instead of the migration
 * laundering it into grass.
 */
function migrateFarmTile(tile: Obj, tx: number, tz: number): Obj {
  const migrated = { ...tile, object: null, fertilizer: null };
  const debris = tile.blocker === Blocker.Rock || tile.blocker === Blocker.Stump;
  if (debris && isReservedTile(MAPS.farm, tx, tz) && isValidTile(migrated)) {
    return { state: TileState.Unplowed, blocker: Blocker.None, blockerHp: 0, crop: null, object: null, fertilizer: null };
  }
  return migrated;
}

/** A saved v2 stack as a v3 stack: normal quality. Non-objects pass through for the validator to reject. */
function migrateStack(stack: unknown): unknown {
  return isObj(stack) ? { ...stack, quality: 0 } : stack;
}

/**
 * A saved v2 inventory as a v3 one: every stack at normal quality, the slots padded with null
 * to INVENTORY.slotCount, and the starting unlocked count. Null when it can't be expressed: more
 * than slotCount slots, or anything held at or above the starting unlocked count.
 */
function migrateInventory(inventory: unknown): Obj | null {
  if (!isObj(inventory) || !Array.isArray(inventory.slots)) return null;
  const old = inventory.slots as readonly unknown[];
  if (old.length > INVENTORY.slotCount) return null;
  if (old.some((slot, i) => slot !== null && i >= INVENTORY.startingUnlockedSlots)) return null;
  const slots = Array.from({ length: INVENTORY.slotCount }, (_, i) => {
    const slot = old[i];
    return slot === undefined || slot === null ? null : migrateStack(slot);
  });
  return { ...inventory, slots, unlockedSlots: INVENTORY.startingUnlockedSlots };
}

/**
 * Version 2 predates multiple maps, placed objects, fertiliser, item quality, the 36-slot
 * inventory, UI panels and the later-workstream sections. The old `world` becomes `maps.farm`:
 * every tile gains `object: null, fertilizer: null` (chunk revisions are kept), and Rock or
 * Stump debris on the four farm reserved (gate) tiles is cleared so the gates are passable;
 * crops and soil there stay, being walkable. The forest and the town are generated from the
 * save's seed and the player stands on the farm. Every inventory and shipping stack gets normal
 * quality and the inventory grows to 36 slots (24 unlocked). The UI keeps a valid time scale
 * with no panel open. Every section starts from `createDefaultSections()`, exactly as a new
 * game would.
 */
function migrateV2toV3(save: Obj): Obj {
  if (!isIntIn(save.seed, 0, 0xffffffff)) return save;
  const farm = mapSavedTiles(save.world, migrateFarmTile);
  const inventory = migrateInventory(save.inventory);
  const { shipping } = save;
  if (farm === null || inventory === null || !isObj(save.player)) return save;
  if (!isObj(shipping) || !Array.isArray(shipping.pending)) return save;
  const maps = { farm, forest: MAPS.forest.generate(save.seed), town: MAPS.town.generate(save.seed) };
  const oldScale = isObj(save.ui) ? save.ui.timeScale : undefined;
  const timeScale = isOneOf(oldScale, TIME.timeScales as readonly number[]) ? oldScale : 1;
  const migrated: Obj = {
    ...save,
    ...createDefaultSections(),
    version: 3,
    maps,
    player: { ...save.player, mapId: 'farm' },
    inventory,
    shipping: { ...shipping, pending: (shipping.pending as readonly unknown[]).map(migrateStack) },
    ui: { panel: { kind: 'none' }, paused: false, timeScale },
  };
  delete migrated.world;
  return migrated;
}

/** Version 3 predates robots: the robots section starts empty and the player carries nothing. */
function migrateV3toV4(save: Obj): Obj {
  if (!isObj(save.player)) return save;
  return { ...save, version: 4, robots: createDefaultSections().robots, player: { ...save.player, carrying: null } };
}

/**
 * Version 4 predates the robot language: every robot keeps its script and gains `exec: null`,
 * an empty .MD and `off: null`, and every zone starts empty.
 */
function migrateV4toV5(save: Obj): Obj {
  const robots = save.robots;
  if (!isObj(robots) || !Array.isArray(robots.list)) return save;
  const list = (robots.list as readonly unknown[]).map((robot) => (isObj(robot) ? { ...robot, exec: null, md: [], off: null } : robot));
  return { ...save, version: 5, robots: { ...robots, list, zones: createDefaultSections().robots.zones } };
}

/** A v5 robot as a v6 one: `tokensToday` becomes today's and this week's tokens, with no actions or crops counted. */
function migrateRobotV5(robot: unknown): unknown {
  if (!isObj(robot)) return robot;
  const { tokensToday, ...rest } = robot;
  return { ...rest, stats: { today: { tokens: tokensToday, actions: 0, crops: 0 }, week: { tokens: tokensToday, actions: 0, crops: 0 } } };
}

/** Version 5 predates the robot screen (farmclaws part 3 spec §9.1): robots gain stats in place of tokensToday. */
function migrateV5toV6(save: Obj): Obj {
  const robots = save.robots;
  if (!isObj(robots) || !Array.isArray(robots.list)) return save;
  const list = (robots.list as readonly unknown[]).map(migrateRobotV5);
  return { ...save, version: 6, robots: { ...robots, list } };
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
  if (isObj(v) && v.version === 3) v = migrateV3toV4(v);
  if (isObj(v) && v.version === 4) v = migrateV4toV5(v);
  if (isObj(v) && v.version === 5) v = migrateV5toV6(v);
  return v;
}

export function deserializeGame(json: string): GameState | null {
  try {
    const parsed: unknown = migrateSave(JSON.parse(json));
    if (!isValidGameState(parsed)) return null;
    return { ...parsed, ui: { ...parsed.ui, panel: { kind: 'none' }, paused: false } };
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
