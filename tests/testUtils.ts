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
import { INVENTORY, TIME, UNLOCKS, WORKBENCH } from '../src/config';
import { deepFreeze } from '../src/core/store';
import {
  Blocker,
  CRAFTING_RECIPE_IDS,
  Direction,
  TileState,
  type Animal,
  type Robot,
  type AnimalKind,
  type CropId,
  type CropInstance,
  type GameSections,
  type GameState,
  type ItemId,
  type ItemStack,
  type MapId,
  type NpcTalk,
  type RobotStats,
  type Quality,
  type Tile,
  type TileCoord,
  type WorldState,
  type ZoneId,
  type ZoneRect,
} from '../src/core/types';
import { createCropInstance, CROPS, stageCount } from '../src/farming/crops';
import { ZERO_ROBOT_STATS } from '../src/robots/stats';
import { createDefaultSections, createInitialState } from '../src/state/initialState';
import { countItem } from '../src/state/inventory';
import { serializeGame } from '../src/state/persistence';
import { withMap } from '../src/state/selectors';
import { MAPS } from '../src/world/maps';
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
  const save = v5Save(state);
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
  delete (save.player as SaveJson).carrying;
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

/** Part 4b's renames (spec §8), turned back: a version-8 character id and the id version 7 saves it under. */
const V7_NPC_IDS: ReadonlyMap<string, string> = new Map([
  ['berlioz', 'bram'],
  ['tallulah', 'tess'],
]);
const v7NpcId = (id: unknown): unknown => (typeof id === 'string' ? (V7_NPC_IDS.get(id) ?? id) : id);

/**
 * Hand-transforms a current (version 8) state back into the JSON of a version-7 save (farmclaws
 * part 4b spec §9): no deliveries, no stock counts, and Berlioz and Tallulah back to Bram and Tess
 * in `npcs`, the board and the festival gift target. The state must not hold anything a version-7
 * save cannot express. v6Save starts from this, so every older-save builder inherits it.
 */
export function v7Save(state: GameState): SaveJson {
  const save = JSON.parse(serializeGame(state)) as SaveJson;
  save.version = 7;
  if (state.robots.deliveries.length > 0) throw new Error('v7Save: a version-7 save has no robot deliveries');
  delete (save.robots as SaveJson).deliveries;
  const sold = state.shopsSoldToday;
  for (const counts of [sold.parts, sold.robots, sold.seeds] as readonly Readonly<Record<string, number>>[]) {
    if (Object.values(counts).some((count) => count !== 0)) throw new Error('v7Save: a version-7 save has no shop stock sold');
  }
  delete save.shopsSoldToday;
  save.npcs = Object.fromEntries(Object.entries(save.npcs as SaveJson).map(([id, talk]) => [v7NpcId(id), talk]));
  const board = (save.quests as { board: SaveJson | null }).board;
  if (board !== null) board.npc = v7NpcId(board.npc);
  const festival = save.festival as SaveJson;
  festival.giftTarget = v7NpcId(festival.giftTarget);
  return save;
}

/**
 * Hand-transforms a state back into the JSON of a version-6 save (farmclaws part 4a spec §6): it
 * starts from v7Save, and every field version 7 added is taken out again or turned back. The state
 * must not hold anything a version-6 save cannot express. v5Save starts from this, so every
 * older-save builder inherits it.
 */
export function v6Save(state: GameState): SaveJson {
  const save = v7Save(state);
  save.version = 6;
  // The cast: version 6 has no Sol, Cosmo or Barnaby, and still has Fennick, Pip and friendship.
  const npcs = state.npcs;
  for (const id of ['sol', 'cosmo', 'barnaby'] as const) {
    if (npcs[id].talks !== 0 || npcs[id].talkedToday) throw new Error(`v6Save: a version-6 save has no ${id} to have talked to`);
  }
  const relation = ({ talks, talkedToday }: NpcTalk): SaveJson => ({ points: 0, talkedToday, giftsToday: 0, giftsThisWeek: 0, heartEventsSeen: [], talks });
  const idle: NpcTalk = { talks: 0, talkedToday: false };
  save.npcs = {
    marigold: relation(npcs.marigold),
    bram: relation(npcs.berlioz),
    juniper: relation(npcs.juniper),
    tess: relation(npcs.tallulah),
    fennick: relation(idle),
    pip: relation(idle),
  };
  // The Neighbours map: version 6 has none, so the player can't be on it and it must be as a new game makes it.
  if (state.player.mapId === 'neighbours') throw new Error('v6Save: a version-6 save has no Neighbours map to stand on');
  if (!deepEqual(state.maps.neighbours, MAPS.neighbours.generate(state.seed))) {
    throw new Error('v6Save: a version-6 save has no Neighbours map to have changed');
  }
  delete (save.maps as SaveJson).neighbours;
  return save;
}

/**
 * Hand-transforms a state back into the JSON of a version-5 save (farmclaws part 3 spec §9.1): it
 * starts from v6Save, and every field version 6 added is taken out again. The state must not hold
 * anything a version-5 save cannot express. legacySave starts from this, so older saves never
 * carry part 3 or part 4a fields either.
 */
export function v5Save(state: GameState): SaveJson {
  const save = v6Save(state);
  save.version = 5;
  // Stats: a v5 robot counts only today's tokens, as tokensToday.
  for (const robot of (save.robots as { list: SaveJson[] }).list) {
    const { today, week } = robot.stats as RobotStats;
    if (today.actions !== 0 || today.crops !== 0 || !deepEqual(week, today)) {
      throw new Error(`v5Save: a version-5 save counts only today's tokens (robot ${String(robot.id)})`);
    }
    robot.tokensToday = today.tokens;
    delete robot.stats;
    // Ruin and paint (part 3 spec §3.2, §3.4): version 5 has no ruined power and no paint.
    if (robot.power === 'ruined') throw new Error(`v5Save: version 5 has no ruined robots (robot ${String(robot.id)})`);
    delete robot.paint;
  }
  // Log: version 5 has no crashed or ruined events.
  for (const entry of (save.robots as { log: { entries: SaveJson[] } }).log.entries) {
    const kind = (entry.event as { kind: string }).kind;
    if (kind === 'crashed' || kind === 'ruined') throw new Error(`v5Save: version 5 has no ${kind} log events (log entry ${String(entry.id)})`);
  }
  // Unlocks: a v5 save has none; the migration gives it job 1's.
  const robots = save.robots as SaveJson;
  if (!deepEqual(robots.unlocks, UNLOCKS.job1)) throw new Error("v5Save: a version-5 save starts from job 1's unlocks");
  delete robots.unlocks;
  // The workbench: no v5 robot is on it or switched off at it, and the v5 farm has none. Its tile's
  // chunk revision steps back one, as the migration's withWorkbenchAt steps it forward again.
  for (const robot of robots.list as SaveJson[]) {
    if (robot.onBench === true || robot.off === 'player') {
      throw new Error(`v5Save: a version-5 save has no workbench and no on/off switch (robot ${String(robot.id)})`);
    }
    delete robot.onBench;
  }
  const farm = (save.maps as SaveJson).farm as { chunks: { tiles: SaveJson[]; revision: number }[] };
  for (const chunk of farm.chunks) {
    for (const tile of chunk.tiles) {
      if ((tile.object as SaveJson | null)?.kind !== 'workbench') continue;
      tile.object = null;
      chunk.revision -= 1;
    }
  }
  // The zone marker: version 5 has no marker item, no pending marker and no zone draft or letter.
  const dropMarkers = (slots: (SaveJson | null)[]): void => {
    slots.forEach((slot, i) => {
      if (slot !== null && slot.itemId === 'zoneMarker') slots[i] = null;
    });
  };
  dropMarkers((save.inventory as { slots: (SaveJson | null)[] }).slots);
  for (const world of Object.values(save.maps as Record<string, { chunks: { tiles: { object: SaveJson | null }[] }[] }>)) {
    for (const chunk of world.chunks) {
      for (const tile of chunk.tiles) if (tile.object !== null && tile.object.kind === 'chest') dropMarkers(tile.object.slots as (SaveJson | null)[]);
    }
  }
  delete (save.robots as SaveJson).pendingMarker;
  delete (save.ui as SaveJson).zoneDraft;
  delete (save.ui as SaveJson).zoneLetter;
  return save;
}

/** A valid animal with the given id, kind and name; the other fields are fixed mid-range values. */
export const animal = (id: number, kind: AnimalKind, name: string): Animal => ({
  id,
  kind,
  name,
  bornDay: 6,
  fedToday: true,
  pettedToday: false,
  happiness: 200,
  hasProduct: true,
});

/**
 * Every later-workstream section filled in far from its defaults, still valid: a steel hoe with
 * an upgrade under way, every recipe, a full coop and a barn, chats with Berlioz and Tallulah, a board
 * request, lifetime stats and a festival in progress with a full display.
 */
export function livelySections(): GameSections {
  return {
    profile: {
      playerName: 'Eli',
      farmName: 'Sunny Acres',
      appearance: { skinTone: 4, hairStyle: 2, hairColor: 5, shirtColor: 7, overallsColor: 5, hat: 3 },
    },
    tools: { levels: { hoe: 2, wateringCan: 1, pickaxe: 0, axe: 1 }, upgrade: { tool: 'pickaxe', level: 1, readyDay: 12 } },
    crafting: { known: [...CRAFTING_RECIPE_IDS] },
    cooking: { known: ['friedMushrooms', 'berryTart', 'forestSalad'], kitchenLevel: 1 },
    buildings: [
      {
        id: 1,
        kind: 'coop',
        plot: 0,
        readyDay: 5,
        troughWheat: 12,
        animals: [animal(3, 'chicken', 'Pecky'), animal(4, 'chicken', 'Nugget'), animal(5, 'chicken', 'Clucky'), animal(6, 'chicken', 'Hen')],
      },
      { id: 2, kind: 'barn', plot: 1, readyDay: 9, troughWheat: 0, animals: [animal(7, 'cow', 'Daisy Mae Buttercup Mooo')] },
    ],
    nextEntityId: 8,
    npcs: {
      ...BASE.npcs,
      berlioz: { talks: 40, talkedToday: true },
      tallulah: { talks: 3, talkedToday: false },
    },
    quests: {
      completed: ['shipParsnips', 'visitTown', 'earnGold'],
      board: { week: 3, npc: 'juniper', itemId: 'potato', quantity: 5, dueDay: 30, delivered: 5, status: 'completed' },
    },
    stats: {
      parsnipsShipped: 40,
      debrisCleared: 12,
      forageFound: 3,
      totalEarned: 5400,
      visitedTown: true,
      craftedChest: true,
      builtCoop: true,
    },
    festival: {
      activeDay: 12,
      eggsFound: 4095,
      lanternReleased: true,
      // Pumpkins (produce) at every quality; wood (a material) has none.
      display: Array.from({ length: 9 }, (_, i) =>
        i % 2 === 0
          ? { itemId: 'pumpkin' as const, quantity: i + 1, quality: ((i / 2) % 3) as 0 | 1 | 2 }
          : { itemId: 'wood' as const, quantity: i + 1, quality: 0 as const },
      ),
      giftTarget: 'tallulah',
      giftGiven: true,
    },
    robots: createDefaultSections().robots,
    shopsSoldToday: createDefaultSections().shopsSoldToday,
  };
}

/** A working Mini with a claw on TARGET facing South, fully charged, spinning right forever. */
export function robotOf(overrides: Partial<Robot> = {}): Robot {
  return {
    id: 1,
    name: 'Sprocket',
    size: 'mini',
    parts: ['claw'],
    tx: TARGET.tx,
    tz: TARGET.tz,
    facing: Direction.South,
    bag: [],
    tank: 0,
    tokens: 80,
    power: 'working',
    carried: false,
    onBench: false,
    program: { kind: 'script', steps: [{ kind: 'turn', side: 'right' }], loop: true },
    pc: 0,
    exec: null,
    md: [],
    off: null,
    nextActMinute: TIME.dayStartMinute + 4,
    repairReadyDay: null,
    stats: ZERO_ROBOT_STATS,
    moveSeq: 0,
    teleportSeq: 0,
    actionSeq: 0,
    lastAction: null,
    paint: 0,
    ...overrides,
  };
}

/** robotOf standing on the workbench (farmclaws part 3): `onBench`, on WORKBENCH.home. */
export function benchedRobotOf(overrides: Partial<Robot> = {}): Robot {
  return robotOf({ onBench: true, tx: WORKBENCH.home.tx, tz: WORKBENCH.home.tz, ...overrides });
}

/** Replaces the robot list (ascending ids) and sets nextId past the highest id. */
export function withRobots(state: GameState, robots: readonly Robot[]): GameState {
  const nextId = robots.reduce((max, robot) => Math.max(max, robot.id), 0) + 1;
  return { ...state, robots: { ...state.robots, list: robots, nextId } };
}

/** Sets some zones (farmclaws part 2), leaving the others as they are. */
export function withZones(state: GameState, zones: Partial<Record<ZoneId, ZoneRect | null>>): GameState {
  return { ...state, robots: { ...state.robots, zones: { ...state.robots.zones, ...zones } } };
}
