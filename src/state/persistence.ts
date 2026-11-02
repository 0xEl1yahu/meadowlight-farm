/**
 * The pure half of saving. GameState is plain JSON-compatible data, so persistence is serialisation,
 * migration and a strict structural validator — a corrupted or outdated save is rejected, never
 * half-loaded. Reading and writing the browser's storage lives in io/saveStore.ts.
 */
import { INVENTORY, JOBS, PLAYER, TIME, UNLOCKS, WORKBENCH } from '../config';
import {
  Blocker,
  CRAFTING_RECIPE_IDS,
  MAP_IDS,
  NPC_IDS,
  SAVE_VERSION,
  TOWNSFOLK_IDS,
  TileState,
  Weather,
  ZONE_IDS,
  type ActionEvent,
  type ActionKind,
  type CraftingRecipeId,
  type GameState,
  type GridSpec,
  type MapId,
  type NpcId,
  type TileCoord,
  type WalkerId,
  type WalkerPlace,
  type WorldState,
} from '../core/types';
import { knownWith } from '../crafting/known';
import { placeAt } from '../people/timetable';
import { freeSpotNear, withWorkbenchAt } from '../robots/workbench';
import { calendarTime } from '../time/clock';
import { weatherWaters } from '../time/weather';
import { chunkCount, chunkRectByIndex, createGridSpec, inBounds } from '../world/grid';
import { MAPS, isReservedTile } from '../world/maps';
import { CHICKEN_RUN, COSMO_DOOR_GAP, ringInside, ringTiles } from '../world/maps/neighbours';
import { TOWN_EXITS, TOWN_PROP_KINDS } from '../world/maps/town';
import { EMPTY_TILE, assertWorldObjectsConsistent, blockedTile, getTile, isWalkable } from '../world/tiles';
import { createDefaultSections } from './initialState';
import { isValidRobotsSection } from './robotValidation';
import { isValidSections } from './sectionValidation';
import { ZONE_MARKER_STACK, countZoneMarkers } from './zoneMarker';
import {
  hasExactKeys,
  isBool,
  isCanonicalSubset,
  isCount,
  isInt,
  isIntIn,
  isObj,
  isOneOf,
  isValidStack,
  isValidTile,
  type Obj,
} from './validation';

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
  zoneMarker: true,
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
export function isValidWorld(world: unknown, id: MapId): world is WorldState {
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

/** A zone draft (farmclaws part 3 spec §8): null, or a zone letter and a farm tile, nothing more. */
function isValidZoneDraft(v: unknown): boolean {
  if (v === null) return true;
  if (!isObj(v) || !hasExactKeys(v, ['zone', 'corner']) || !isOneOf(v.zone, ZONE_IDS)) return false;
  const corner = v.corner;
  return (
    isObj(corner) &&
    hasExactKeys(corner, ['tx', 'tz']) &&
    isInt(corner.tx) &&
    isInt(corner.tz) &&
    inBounds(MAPS.farm.grid, corner.tx, corner.tz)
  );
}

/**
 * The UI section. Only the panel's shape is checked (an object with a string `kind`): the loader
 * resets it anyway, and later panel kinds must not need a migration. The zone draft and letter
 * are reset on load too, but must still be well formed.
 */
function isValidUi(ui: unknown): boolean {
  return (
    isObj(ui) &&
    isObj(ui.panel) &&
    typeof ui.panel.kind === 'string' &&
    isBool(ui.paused) &&
    typeof ui.timeScale === 'number' &&
    (TIME.timeScales as readonly number[]).includes(ui.timeScale) &&
    isValidZoneDraft(ui.zoneDraft) &&
    isOneOf(ui.zoneLetter, ZONE_IDS)
  );
}

/**
 * At most one zone marker in the inventory and every chest together, and `pendingMarker` only
 * while there is none (farmclaws part 3 spec §9.2). Called once every section is known valid.
 */
function isValidZoneMarker(state: GameState): boolean {
  const held = countZoneMarkers(state.inventory, state.maps);
  return held <= 1 && !(state.robots.pendingMarker && held > 0);
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
    isValidSections(v, v.maps) &&
    isValidRobotsSection(v.robots, v.maps, v.player) &&
    isValidZoneMarker(v as unknown as GameState)
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

/** A v5 robot as a v6 one: `tokensToday` becomes today's and this week's tokens, with no actions or crops counted, and off the bench, with paint 0. */
function migrateRobotV5(robot: unknown): unknown {
  if (!isObj(robot)) return robot;
  const { tokensToday, ...rest } = robot;
  return { ...rest, onBench: false, stats: { today: { tokens: tokensToday, actions: 0, crops: 0 }, week: { tokens: tokensToday, actions: 0, crops: 0 } }, paint: 0 };
}

/**
 * Version 5 predates the robot screen (farmclaws part 3 spec §9.1): robots gain stats in place of
 * tokensToday, the robots section gains job 1's unlocks, and the farm gains its workbench.
 */
function migrateV5toV6(save: Obj): Obj {
  const robots = save.robots;
  if (!isObj(robots) || !Array.isArray(robots.list)) return save;
  const list = (robots.list as readonly unknown[]).map(migrateRobotV5);
  return placeWorkbenchV6({ ...save, version: 6, robots: { ...robots, list, unlocks: UNLOCKS.job1 } });
}

/**
 * The workbench for a migrated farm (part 3 spec §2.1): WORKBENCH.home, or the nearest free farm
 * tile when the player built something there. Standing robots (not carried, not away for repairs)
 * and the player, when on the farm, take their tiles, and so does the spawn tile. A malformed farm passes through without one,
 * so the validator rejects the save.
 */
function placeWorkbenchV6(save: Obj): Obj {
  const maps = save.maps;
  const robots = save.robots;
  if (!isObj(maps) || !isObj(robots) || !Array.isArray(robots.list)) return save;
  const farm: unknown = maps.farm;
  if (!isValidWorld(farm, 'farm')) return save;
  // The spawn tile is where a carried robot lands at day end, and where a new game starts the player.
  const taken: TileCoord[] = [PLAYER.spawn];
  for (const robot of robots.list as readonly unknown[]) {
    if (isObj(robot) && robot.carried !== true && robot.power !== 'repairing' && isInt(robot.tx) && isInt(robot.tz)) taken.push({ tx: robot.tx, tz: robot.tz });
  }
  const player = save.player;
  if (isObj(player) && player.mapId === 'farm' && isInt(player.tx) && isInt(player.tz)) taken.push({ tx: player.tx, tz: player.tz });
  return { ...save, maps: { ...maps, farm: withWorkbenchAt(farm, freeSpotNear(farm, WORKBENCH.home, taken)) } };
}

/** Zone markers in a saved inventory and in every saved chest, read from the raw JSON. */
function savedMarkerCount(save: Obj): number {
  let count = 0;
  const countIn = (slots: unknown): void => {
    if (!Array.isArray(slots)) return;
    for (const slot of slots as readonly unknown[]) if (isObj(slot) && slot.itemId === ZONE_MARKER_STACK.itemId) count++;
  };
  if (isObj(save.inventory)) countIn(save.inventory.slots);
  if (!isObj(save.maps)) return count;
  for (const world of Object.values(save.maps)) {
    if (!isObj(world) || !Array.isArray(world.chunks)) continue;
    for (const chunk of world.chunks as readonly unknown[]) {
      if (!isObj(chunk) || !Array.isArray(chunk.tiles)) continue;
      for (const tile of chunk.tiles as readonly unknown[]) {
        if (isObj(tile) && isObj(tile.object) && tile.object.kind === 'chest') countIn(tile.object.slots);
      }
    }
  }
  return count;
}

/**
 * Version 6's zone marker (farmclaws part 3 spec §8, §9.1), the last part of the v5 → v6 step:
 * the marker goes into the first free unlocked inventory slot, or `robots.pendingMarker` is set
 * when the backpack is full. A save that already holds a marker keeps just that one. The UI
 * gains an empty draft and Zone A.
 */
function migrateZoneMarker(save: Obj): Obj {
  const { inventory, robots } = save;
  if (save.version !== 6 || !isObj(inventory) || !Array.isArray(inventory.slots) || !isObj(robots)) return save;
  const ui = isObj(save.ui) ? { ...save.ui, zoneDraft: null, zoneLetter: 'A' } : save.ui;
  if (savedMarkerCount(save) > 0) return { ...save, ui, robots: { ...robots, pendingMarker: false } };
  const unlocked = isInt(inventory.unlockedSlots) ? inventory.unlockedSlots : 0;
  const slots = (inventory.slots as readonly unknown[]).slice();
  const free = slots.findIndex((slot, i) => slot === null && i < unlocked);
  if (free === -1) return { ...save, ui, robots: { ...robots, pendingMarker: true } };
  slots[free] = { ...ZONE_MARKER_STACK };
  return { ...save, ui, inventory: { ...inventory, slots }, robots: { ...robots, pendingMarker: false } };
}

/** The cast as version 7 saves it (farmclaws part 4a spec §2.1), before part 4b renamed Bram and Tess. */
const V7_NPC_IDS: readonly string[] = ['sol', 'cosmo', 'barnaby', 'marigold', 'bram', 'juniper', 'tess'];
/** The characters version 7 keeps from version 6, with their chats (farmclaws part 4a spec §6.2). */
const KEPT_NPCS: readonly string[] = ['marigold', 'bram', 'juniper', 'tess'];
/** Part 4b's renames (spec §8): a version-7 character id and the id version 8 gives it. */
const RENAMED_NPCS: ReadonlyMap<string, NpcId> = new Map([
  ['bram', 'berlioz'],
  ['tess', 'tallulah'],
]);

/**
 * A saved character as a v7 NpcTalk: only `talks` and `talkedToday`, copied as found, so a corrupt
 * value still fails validation. A v6 relation and a v7 NpcTalk migrate alike; anything that isn't
 * an object passes through for the validator to reject.
 */
function migrateNpcV6(saved: unknown): unknown {
  return isObj(saved) ? { talks: saved.talks, talkedToday: saved.talkedToday } : saved;
}

/**
 * A kept character's record in a v6 save. migrateV2toV3 fills `npcs` from the current defaults,
 * so a save that started at version 2 names Bram and Tess by their version-8 ids.
 */
function savedNpcV6(npcs: Obj, id: string): unknown {
  const renamed = RENAMED_NPCS.get(id);
  return npcs[id] === undefined && renamed !== undefined ? npcs[renamed] : npcs[id];
}

/**
 * Version 6 predates the farmclaws cast (part 4a spec §6.2): `npcs` becomes the seven version-7
 * ids, where Marigold, Bram, Juniper and Tess keep their chats and Sol, Cosmo and Barnaby start at
 * none. Fennick, Pip and every friendship field are dropped. `npcs` may already have a later
 * shape, because migrateV2toV3 fills it from the current defaults. The Neighbours map is generated
 * from its fixed definition.
 */
function migrateV6toV7(save: Obj): Obj {
  const { npcs } = save;
  if (!isObj(npcs)) return save;
  let migrated: Obj = {
    ...save,
    version: 7,
    npcs: Object.fromEntries(
      V7_NPC_IDS.map((id) => [id, KEPT_NPCS.includes(id) ? migrateNpcV6(savedNpcV6(npcs, id)) : { talks: 0, talkedToday: false }]),
    ),
  };
  if (isObj(save.maps) && isIntIn(save.seed, 0, 0xffffffff)) {
    migrated = { ...migrated, maps: { ...save.maps, neighbours: MAPS.neighbours.generate(save.seed) } };
  }
  return migrated;
}

/**
 * Version 7 predates the shops (farmclaws part 4b spec §9): the robots section gains no deliveries,
 * every shop has sold nothing today, and Bram and Tess become Berlioz and Tallulah: their `npcs`
 * records move to the new ids unchanged. A record already under a new id stays where it is, so
 * the validator rejects the old id beside it.
 */
function migrateV7toV8(save: Obj): Obj {
  const { npcs, robots } = save;
  if (!isObj(npcs) || !isObj(robots)) return save;
  const renameKey = (id: string): string => {
    const renamed = RENAMED_NPCS.get(id);
    return renamed === undefined || Object.prototype.hasOwnProperty.call(npcs, renamed) ? id : renamed;
  };
  return {
    ...save,
    version: 8,
    robots: { ...robots, deliveries: [] },
    shopsSoldToday: createDefaultSections().shopsSoldToday,
    npcs: Object.fromEntries(Object.entries(npcs).map(([id, talk]) => [renameKey(id), talk])),
  };
}

/**
 * Version 8 predates the jobs (farmclaws part 4c spec §7): every robot lives on the farm and is
 * the player's, every zone is on the farm, and `jobs` starts as a new game's, except that a farm
 * with any robot or delivery has job 1 done (with no reward and no Sprinkle) and job 2 offered
 * (spec §4.3). A malformed robots section passes through for the validator to reject.
 */
function migrateV8toV9(save: Obj): Obj {
  const { robots } = save;
  if (!isObj(robots) || !Array.isArray(robots.list) || !Array.isArray(robots.deliveries) || !isObj(robots.zones)) return save;
  const list = (robots.list as readonly unknown[]).map((robot) => (isObj(robot) ? { ...robot, mapId: 'farm', owner: 'player' } : robot));
  const zones = Object.fromEntries(Object.entries(robots.zones).map(([id, rect]) => [id, isObj(rect) ? { ...rect, mapId: 'farm' } : rect]));
  const fresh = createDefaultSections().jobs;
  const hasRobots = robots.list.length > 0 || robots.deliveries.length > 0;
  const jobs = hasRobots ? { ...fresh, status: { ...fresh.status, spinningRobot: 'done', showHim: 'offered' } } : fresh;
  return { ...save, version: 9, robots: { ...robots, list, zones }, jobs };
}

/**
 * What version 10 does to a tile it changes (farmclaws part 4d spec §7.4, §9.2): 'block' makes a
 * town prop's tile a building, 'fence' puts the chicken run's fence on its ring (a fence already
 * there stays), 'gap' takes the fence off Cosmo's door front, 'shut' keeps the run's inside as
 * open ground, and 'exit' keeps a town exit clear. Anything else on a changed tile moves away;
 * the player and robots move off 'block', 'fence' and 'shut' tiles.
 */
type TileChangeV10 = 'block' | 'fence' | 'gap' | 'shut' | 'exit';

/** The tiles version 10 changes on `mapId`, keyed by row (tz × width + tx). */
function tileChangesV10(mapId: 'town' | 'neighbours'): ReadonlyMap<number, TileChangeV10> {
  const { width } = MAPS[mapId].grid;
  const changes = new Map<number, TileChangeV10>();
  const set = (tx: number, tz: number, change: TileChangeV10): void => void changes.set(tz * width + tx, change);
  if (mapId === 'town') {
    for (const s of MAPS.town.structures) {
      if (!TOWN_PROP_KINDS.includes(s.kind)) continue;
      for (let tz = s.rect.z0; tz < s.rect.z0 + s.rect.depth; tz++) for (let tx = s.rect.x0; tx < s.rect.x0 + s.rect.width; tx++) set(tx, tz, 'block');
    }
    for (const exit of TOWN_EXITS) set(exit.tx, exit.tz, 'exit');
    return changes;
  }
  set(COSMO_DOOR_GAP.tx, COSMO_DOOR_GAP.tz, 'gap');
  for (const at of ringTiles(CHICKEN_RUN)) set(at.tx, at.tz, 'fence');
  const run = ringInside(CHICKEN_RUN);
  for (let tz = run.z0; tz < run.z0 + run.depth; tz++) for (let tx = run.x0; tx < run.x0 + run.width; tx++) set(tx, tz, 'shut');
  return changes;
}

const FENCE_TILE_V10 = { ...EMPTY_TILE, object: { kind: 'woodFence' } };

/** The saved tile version 10 puts where `change` falls on `tile`; `displace` is called with anything that has to move. */
function changedTileV10(tile: Obj, change: TileChangeV10, displace: (object: unknown) => void): Obj {
  const object: unknown = tile.object;
  const isFence = isObj(object) && object.kind === 'woodFence';
  // The fence a v9 save holds at Cosmo's door front is the map's own, so it goes rather than moves.
  const stays = object === null || object === undefined || (isFence && (change === 'fence' || change === 'gap'));
  if (!stays) displace(object);
  if (change === 'block') return { ...blockedTile(Blocker.Building) };
  if (change === 'fence') return FENCE_TILE_V10;
  return { ...tile, object: null };
}

/**
 * One map's part of the v9 → v10 step: its changed tiles (tileChangesV10), then the player and
 * that map's robots off a tile they can no longer stand on, then every displaced object, each in
 * scan order to `freeSpotNear` on that map. A spot once given is taken, and so is every changed
 * tile, every robot or player who stays and, on the Neighbours, the jobs' generator tiles, so
 * nothing lands on anything else, in the run, on Cosmo's door front or where a generator will
 * go. Chunk revisions are kept. A malformed map passes through unchanged: the same `save` comes
 * back, which migrateV9toV10 checks for.
 */
function migrateMapV10(save: Obj, mapId: 'town' | 'neighbours'): Obj {
  const { maps, player, robots } = save;
  if (!isObj(maps)) return save;
  const { width } = MAPS[mapId].grid;
  const changes = tileChangesV10(mapId);
  const displaced: { readonly object: unknown; readonly from: TileCoord }[] = [];
  const reshaped = mapSavedTiles(maps[mapId], (tile, tx, tz) => {
    const change = changes.get(tz * width + tx);
    return change === undefined ? tile : changedTileV10(tile, change, (object) => displaced.push({ object, from: { tx, tz } }));
  });
  if (reshaped === null || !isValidWorld(reshaped, mapId)) return save;
  const mustLeave = (tx: number, tz: number): boolean => {
    const change = changes.get(tz * width + tx);
    return change === 'block' || change === 'fence' || change === 'shut';
  };
  const standing = (v: unknown): v is Obj & { tx: number; tz: number } => isObj(v) && v.mapId === mapId && isInt(v.tx) && isInt(v.tz);
  const list: readonly unknown[] = isObj(robots) && Array.isArray(robots.list) ? robots.list : [];
  const taken: TileCoord[] = [...changes.keys()].map((k) => ({ tx: k % width, tz: Math.floor(k / width) }));
  if (mapId === 'neighbours') taken.push(...Object.values(JOBS.generators));
  for (const at of [player, ...list]) if (standing(at) && !mustLeave(at.tx, at.tz)) taken.push({ tx: at.tx, tz: at.tz });
  const moveOff = <T>(at: T): T => {
    if (!standing(at) || !mustLeave(at.tx, at.tz)) return at;
    const spot = freeSpotNear(reshaped, { tx: at.tx, tz: at.tz }, taken, mapId);
    taken.push(spot);
    return { ...at, tx: spot.tx, tz: spot.tz };
  };
  let migrated: Obj = { ...save, player: moveOff(player) };
  if (isObj(robots) && Array.isArray(robots.list)) migrated = { ...migrated, robots: { ...robots, list: robots.list.map(moveOff) } };
  const placed = new Map<number, unknown>();
  for (const { object, from } of displaced) {
    const spot = freeSpotNear(reshaped, from, taken, mapId);
    taken.push(spot);
    placed.set(spot.tz * width + spot.tx, object);
  }
  const world = mapSavedTiles(reshaped, (tile, tx, tz) => {
    const object = placed.get(tz * width + tx);
    return object === undefined ? tile : { ...tile, object };
  });
  return { ...migrated, maps: { ...maps, [mapId]: world } };
}

/**
 * Where version 10 puts each walker (farmclaws part 4d spec §9.2): where their current leg puts
 * them at the save's minute and weather (`placeAt`), or indoors when the save holds something on
 * that tile, so nobody stands on what the player has built. Every character's record gains its
 * place, and the townsfolk join. A save with a malformed clock, weather, map or cast passes
 * through for the validator to reject.
 */
function placeWalkersV10(save: Obj): Obj {
  const { time, weather, maps, npcs } = save;
  if (!isObj(time) || !isInt(time.minuteOfDay) || !isOneOf(weather, WEATHERS) || !isObj(maps) || !isObj(npcs)) return save;
  const minute = time.minuteOfDay;
  const wet = weatherWaters(weather as Weather);
  const worlds = new Map<MapId, WorldState | null>();
  const worldOf = (mapId: MapId): WorldState | null => {
    if (!worlds.has(mapId)) worlds.set(mapId, isValidWorld(maps[mapId], mapId) ? maps[mapId] : null);
    return worlds.get(mapId) ?? null;
  };
  const placeOf = (id: WalkerId): WalkerPlace | null => {
    const place = placeAt(id, minute, wet);
    if (place.kind === 'indoors') return place;
    const world = worldOf(place.mapId);
    if (world === null) return null;
    const tile = getTile(world, place.tx, place.tz);
    return tile !== null && isWalkable(tile) ? place : { kind: 'indoors' };
  };
  const places = new Map<WalkerId, WalkerPlace>();
  for (const id of [...NPC_IDS, ...TOWNSFOLK_IDS]) {
    const place = placeOf(id);
    if (place === null) return save;
    places.set(id, place);
  }
  const placed = (id: string, talk: unknown): unknown => {
    const place = isOneOf(id, NPC_IDS) ? places.get(id) : undefined;
    return isObj(talk) && place !== undefined ? { ...talk, place } : talk;
  };
  return {
    ...save,
    npcs: Object.fromEntries(Object.entries(npcs).map(([id, talk]) => [id, placed(id, talk)])),
    townsfolk: Object.fromEntries(TOWNSFOLK_IDS.map((id) => [id, { place: places.get(id) }])),
  };
}

/**
 * Version 9 predates SLOPMART's booth, the town's props and exits, Cosmo's door gap and his
 * chicken run, and the walkers (farmclaws part 4d spec §9.2). The booth stands on the old hedge's
 * tiles, so only the props, the exits, the door gap and the run change saved tiles, on the town
 * and the Neighbours map (migrateMapV10). Then every walker is placed on the reshaped maps
 * (placeWalkersV10), and SLOPMART has sold no boxes, today or ever. When either map can't be
 * reshaped (malformed, or holding an object kind version 12 no longer has), the save stays at
 * version 9 for the validator to reject, rather than going on with that map half-migrated.
 */
function migrateV9toV10(save: Obj): Obj {
  const v10 = { ...save, version: 10 };
  const town = migrateMapV10(v10, 'town');
  if (town === v10) return save;
  const both = migrateMapV10(town, 'neighbours');
  if (both === town) return save;
  const placed = placeWalkersV10(both);
  const sold = placed.shopsSoldToday;
  return {
    ...placed,
    slopShop: createDefaultSections().slopShop,
    shopsSoldToday: isObj(sold) ? { ...sold, slopBoxes: createDefaultSections().shopsSoldToday.slopBoxes } : sold,
  };
}

/**
 * Version 10 predates job 1 teaching the Wood Burner recipe when it's taken (part 4c spec §3.1),
 * so a farm that has taken job 1 learns it now, in canonical order; one with job 1 still offered
 * doesn't. As in the v12 step, a recipe list that isn't already canonical passes through as found
 * for the validator to reject.
 */
function migrateV10toV11(save: Obj): Obj {
  const next = { ...save, version: 11 };
  const jobs = save.jobs;
  const crafting = save.crafting;
  if (!isObj(jobs) || !isObj(jobs.status) || !isObj(crafting) || !isCanonicalSubset(crafting.known, CRAFTING_RECIPE_IDS)) return next;
  const taken = jobs.status.spinningRobot === 'active' || jobs.status.spinningRobot === 'done';
  if (!taken) return next;
  const known = knownWith(crafting.known, ['woodBurner']);
  return known === crafting.known ? next : { ...next, crafting: { ...crafting, known } };
}

/** The placed-object kinds version 12 drops (release 1 cleanup spec §2.1). */
const REMOVED_OBJECT_KINDS: readonly string[] = ['trophy', 'decoration'];

/** A saved tile without a trophy or a decoration on it; any other tile as found. */
function withoutRemovedObjectV12(tile: Obj): Obj {
  return isObj(tile.object) && isOneOf(tile.object.kind, REMOVED_OBJECT_KINDS) ? { ...tile, object: null } : tile;
}

/**
 * Version 11 still saves the v2 features release 1 cut (release 1 cleanup spec §2.3): the
 * cooking, quests and festival sections go whatever they hold, every saved character loses
 * `talkedToday`, and every trophy and decoration on every map is cleared, chunk revisions kept. A
 * farm that has done job 2 learns the Quality Fertilizer and Speed-Gro recipes, and one that has
 * done job 3 the Quality Sprinkler, in canonical order (spec §5.2). The recipes are named here
 * rather than read from the job table, so a later table can't change what this step did. A
 * recipe list that isn't already canonical, a malformed map and a malformed character pass
 * through as found for the validator to reject.
 */
function migrateV11toV12(save: Obj): Obj {
  const next: Obj = { ...save, version: 12 };
  delete next.cooking;
  delete next.quests;
  delete next.festival;
  const { npcs, maps, jobs, crafting } = save;
  if (isObj(npcs)) {
    next.npcs = Object.fromEntries(
      Object.entries(npcs).map(([id, talk]) => {
        if (!isObj(talk)) return [id, talk];
        const kept = { ...talk };
        delete kept.talkedToday;
        return [id, kept];
      }),
    );
  }
  if (isObj(maps)) {
    next.maps = Object.fromEntries(Object.entries(maps).map(([id, world]) => [id, mapSavedTiles(world, withoutRemovedObjectV12) ?? world]));
  }
  if (!isObj(jobs) || !isObj(jobs.status) || !isObj(crafting) || !isCanonicalSubset(crafting.known, CRAFTING_RECIPE_IDS)) return next;
  const recipes: CraftingRecipeId[] = [];
  if (jobs.status.showHim === 'done') recipes.push('qualityFertilizer', 'speedGro');
  if (jobs.status.knowTheLimits === 'done') recipes.push('qualitySprinkler');
  const known = knownWith(crafting.known, recipes);
  return known === crafting.known ? next : { ...next, crafting: { ...crafting, known } };
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
  if (isObj(v) && v.version === 5) v = migrateZoneMarker(migrateV5toV6(v));
  if (isObj(v) && v.version === 6) v = migrateV6toV7(v);
  if (isObj(v) && v.version === 7) v = migrateV7toV8(v);
  if (isObj(v) && v.version === 8) v = migrateV8toV9(v);
  if (isObj(v) && v.version === 9) v = migrateV9toV10(v);
  if (isObj(v) && v.version === 10) v = migrateV10toV11(v);
  if (isObj(v) && v.version === 11) v = migrateV11toV12(v);
  return v;
}

export function deserializeGame(json: string): GameState | null {
  try {
    const parsed: unknown = migrateSave(JSON.parse(json));
    if (!isValidGameState(parsed)) return null;
    return { ...parsed, ui: { ...parsed.ui, panel: { kind: 'none' }, paused: false, zoneDraft: null, zoneLetter: 'A' } };
  } catch {
    return null;
  }
}
