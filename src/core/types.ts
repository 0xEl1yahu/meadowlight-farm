/**
 * Core domain types shared by the simulation, the renderer and the UI.
 *
 * Conventions
 * - Ground plane is XZ, +Y is up. Tile X grows toward world +X, tile Z toward world +Z.
 * - All state is immutable. Reducers return new objects and keep old references for
 *   unchanged branches (structural sharing), so render systems can diff by reference:
 *   an unchanged chunk keeps its object identity, and so does an unchanged tile.
 * - "Enums" are `as const` objects plus a union type of their values, which keeps the
 *   code erasable (no TypeScript runtime enums) and JSON-serialisable.
 */

import type { BlockKind } from '../robots/blockKinds';

export const SAVE_VERSION = 6 as const;

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

/** The four soil states required by the design. `Blocked` always carries a non-None blocker. */
export const TileState = {
  Unplowed: 0,
  Plowed: 1,
  Watered: 2,
  Blocked: 3,
} as const;
export type TileState = (typeof TileState)[keyof typeof TileState];

/** What occupies a Blocked tile. `None` is only valid for non-Blocked tiles. */
export const Blocker = {
  None: 0,
  Rock: 1,
  Stump: 2,
  Water: 3,
  House: 4,
  ShippingBin: 5,
  /** A forest tree: chopped with the axe into a Stump. */
  Tree: 6,
  /** Tall weeds: cut with the scythe. */
  Weeds: 7,
  /** Any multi-tile structure other than the farmhouse and the shipping bin (town buildings, coop, barn). */
  Building: 8,
} as const;
export type Blocker = (typeof Blocker)[keyof typeof Blocker];
export type SolidBlocker = Exclude<Blocker, typeof Blocker.None>;

/** Cardinal facing. North = -Z, East = +X, South = +Z, West = -X. */
export const Direction = {
  North: 0,
  East: 1,
  South: 2,
  West: 3,
} as const;
export type Direction = (typeof Direction)[keyof typeof Direction];
export const DIRECTIONS: readonly Direction[] = [
  Direction.North,
  Direction.East,
  Direction.South,
  Direction.West,
];

export const Season = {
  Spring: 0,
  Summer: 1,
  Fall: 2,
  Winter: 3,
} as const;
export type Season = (typeof Season)[keyof typeof Season];
export const SEASONS: readonly Season[] = [Season.Spring, Season.Summer, Season.Fall, Season.Winter];
export const SEASON_NAMES: Readonly<Record<Season, string>> = {
  [Season.Spring]: 'Spring',
  [Season.Summer]: 'Summer',
  [Season.Fall]: 'Fall',
  [Season.Winter]: 'Winter',
};

export const Weather = {
  Sunny: 'sunny',
  Rain: 'rain',
  Storm: 'storm',
  Snow: 'snow',
} as const;
export type Weather = (typeof Weather)[keyof typeof Weather];

// ---------------------------------------------------------------------------
// Identifiers
// ---------------------------------------------------------------------------

export const CROP_IDS = [
  'parsnip',
  'potato',
  'cauliflower',
  'strawberry',
  'blueberry',
  'melon',
  'corn',
  'pumpkin',
  'carrot',
  'wheat',
  'blackberry',
  'spectraherb',
  'mushroom',
  'snozberry',
] as const;
export type CropId = (typeof CROP_IDS)[number];

export const TOOL_TYPES = ['hoe', 'wateringCan', 'pickaxe', 'axe', 'scythe', 'zoneMarker'] as const;
export type ToolType = (typeof TOOL_TYPES)[number];

export const MATERIAL_IDS = ['stone', 'wood', 'copperOre', 'sap', 'fiber'] as const;
export type MaterialItemId = (typeof MATERIAL_IDS)[number];

/** Items that become a placed object of the same kind when used on an empty tile. */
export const PLACEABLE_ITEM_IDS = [
  'chest',
  'woodFence',
  'woodPath',
  'stonePath',
  'scarecrow',
  'sprinkler',
  'qualitySprinkler',
  'woodBurner',
] as const;
export type PlaceableItemId = (typeof PLACEABLE_ITEM_IDS)[number];

export const FERTILIZER_ITEM_IDS = ['basicFertilizer', 'qualityFertilizer', 'speedGro'] as const;
export type FertilizerItemId = (typeof FERTILIZER_ITEM_IDS)[number];

export type SeedItemId = `${CropId}_seeds`;
export type ProduceItemId = CropId;
export type ItemId = ToolType | SeedItemId | ProduceItemId | MaterialItemId | PlaceableItemId | FertilizerItemId;

// Identifier lists for later workstreams. They are data keys only: their item registry
// entries, icons and behaviour arrive with the workstream that uses them.

export const MAP_IDS = ['farm', 'forest', 'town'] as const;
export type MapId = (typeof MAP_IDS)[number];

/** 0 normal, 1 silver, 2 gold. */
export const QUALITIES = [0, 1, 2] as const;
export type Quality = (typeof QUALITIES)[number];

export const FERTILIZER_KINDS = ['basic', 'quality', 'speedGro'] as const;
export type FertilizerKind = (typeof FERTILIZER_KINDS)[number];

export const UPGRADABLE_TOOLS = ['hoe', 'wateringCan', 'pickaxe', 'axe'] as const satisfies readonly ToolType[];
export type UpgradableTool = (typeof UPGRADABLE_TOOLS)[number];
/** 0 basic, 1 copper, 2 steel. */
export type ToolLevel = 0 | 1 | 2;

export const NPC_IDS = ['marigold', 'bram', 'juniper', 'tess', 'fennick', 'pip'] as const;
export type NpcId = (typeof NPC_IDS)[number];

export const ANIMAL_KINDS = ['chicken', 'cow'] as const;
export type AnimalKind = (typeof ANIMAL_KINDS)[number];

export const FARM_BUILDING_KINDS = ['coop', 'barn'] as const;
export type FarmBuildingKind = (typeof FARM_BUILDING_KINDS)[number];

export const FORAGE_IDS = [
  'wildLeek',
  'springOnion',
  'wildBerries',
  'sweetPea',
  'hazelnut',
  'chanterelle',
  'frostRoot',
  'holly',
] as const;
export type ForageId = (typeof FORAGE_IDS)[number];

export const DISH_IDS = [
  'friedMushrooms',
  'veggieStew',
  'berryTart',
  'pumpkinSoup',
  'snozberryJam',
  'spectralTea',
  'omelette',
  'forestSalad',
] as const;
export type DishId = (typeof DISH_IDS)[number];

export const CRAFTING_RECIPE_IDS = [
  'chest',
  'woodFence',
  'woodPath',
  'stonePath',
  'scarecrow',
  'sprinkler',
  'qualitySprinkler',
  'basicFertilizer',
  'qualityFertilizer',
  'speedGro',
  'woodBurner',
] as const;
export type CraftingRecipeId = (typeof CRAFTING_RECIPE_IDS)[number];

export const STORY_QUEST_IDS = [
  'shipParsnips',
  'clearDebris',
  'visitTown',
  'craftChest',
  'forageForest',
  'buildCoop',
  'makeFriend',
  'earnGold',
] as const;
export type StoryQuestId = (typeof STORY_QUEST_IDS)[number];

export const FESTIVAL_IDS = ['blossomFair', 'lanternNight', 'harvestFair', 'starfallFeast'] as const;
export type FestivalId = (typeof FESTIVAL_IDS)[number];

export const DECORATION_IDS = ['paperLantern', 'stoneLantern', 'flowerArch'] as const;
export type DecorationId = (typeof DECORATION_IDS)[number];

export const GIANT_CROP_IDS = ['cauliflower', 'melon', 'pumpkin'] as const satisfies readonly CropId[];
export type GiantCropId = (typeof GIANT_CROP_IDS)[number];

export const STRUCTURE_KINDS = [
  'generalStore',
  'blacksmith',
  'carpenter',
  'ranch',
  'noticeBoard',
  'well',
  'lampPost',
  'hedge',
] as const;
export type StructureKind = (typeof STRUCTURE_KINDS)[number];

export const PLACED_OBJECT_KINDS = [
  'chest',
  'sprinkler',
  'qualitySprinkler',
  'scarecrow',
  'woodFence',
  'woodPath',
  'stonePath',
  'giantCrop',
  'forage',
  'trophy',
  'decoration',
  'woodBurner',
  'workbench',
] as const;
export type PlacedObjectKind = (typeof PLACED_OBJECT_KINDS)[number];

// ---------------------------------------------------------------------------
// Geometry primitives
// ---------------------------------------------------------------------------

export interface TileCoord {
  readonly tx: number;
  readonly tz: number;
}

/** Axis-aligned rectangle in tile space: x ∈ [x0, x0 + width), z ∈ [z0, z0 + depth). */
export interface TileRect {
  readonly x0: number;
  readonly z0: number;
  readonly width: number;
  readonly depth: number;
}

/**
 * Immutable description of the tile grid and its world-space placement.
 *
 * Tile (tx, tz) covers world x ∈ [originX + tx·tileSize, originX + (tx+1)·tileSize) and the
 * matching half-open range on z. The grid is centred on the world origin, so
 * originX = -width·tileSize/2 and originZ = -depth·tileSize/2.
 */
export interface GridSpec {
  readonly width: number;
  readonly depth: number;
  readonly chunkSize: number;
  readonly tileSize: number;
  /** ceil(width / chunkSize) — the last column of chunks may be partial. */
  readonly chunksX: number;
  /** ceil(depth / chunkSize) — the last row of chunks may be partial. */
  readonly chunksZ: number;
  readonly originX: number;
  readonly originZ: number;
}

// ---------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------

export interface CropInstance {
  readonly cropId: CropId;
  /** 0 … stageCount. `stage === stageDays.length` means mature / harvestable. */
  readonly stage: number;
  /** Watered days accumulated in the current stage. */
  readonly daysInStage: number;
  /** Consecutive nights that ended without water (drives wilting visuals). */
  readonly dryDays: number;
  /** True after the first harvest of a regrowing crop; the last stage then uses `regrowDays`. */
  readonly regrowing: boolean;
  /** Out-of-season crops wither and must be cleared. */
  readonly dead: boolean;
  readonly plantedDay: number;
  readonly harvestCount: number;
  /** Sprouted on its own in the shade (see farming/wild.ts): grows on grass without water. */
  readonly wild: boolean;
}

export interface Tile {
  readonly state: TileState;
  readonly blocker: Blocker;
  /** Remaining hits for Rock/Stump/Tree blockers, 0 otherwise. */
  readonly blockerHp: number;
  readonly crop: CropInstance | null;
  /** Player-placed thing on this tile (chest, sprinkler, path…). Paths are walkable; every other kind blocks. */
  readonly object: PlacedObject | null;
  /** Fertiliser mixed into tilled soil (workstream C applies it). Only on soil tiles. */
  readonly fertilizer: FertilizerKind | null;
}

/** Always INVENTORY.chestSlots (36) long. */
export type ChestSlots = readonly (ItemStack | null)[];

export type PlacedObject =
  | { readonly kind: 'chest'; readonly slots: ChestSlots }
  | { readonly kind: 'sprinkler' }
  | { readonly kind: 'qualitySprinkler' }
  /** Burns its wood overnight into the farm's token pool (farmclaws part 1 §5.7). */
  | { readonly kind: 'woodBurner'; readonly fuel: number }
  | { readonly kind: 'scarecrow' }
  | { readonly kind: 'woodFence' }
  | { readonly kind: 'woodPath' }
  | { readonly kind: 'stonePath' }
  /** One 3×3 giant crop. The same object value sits on all 9 covered tiles; anchor = min-x, min-z corner. */
  | {
      readonly kind: 'giantCrop';
      readonly cropId: GiantCropId;
      readonly anchorTx: number;
      readonly anchorTz: number;
    }
  | { readonly kind: 'forage'; readonly itemId: ForageId; readonly spawnDay: number }
  | { readonly kind: 'trophy'; readonly festival: FestivalId; readonly year: number }
  | { readonly kind: 'decoration'; readonly variant: DecorationId }
  /** Built into every farm beside the farmhouse; robots are modded on it (farmclaws part 3 spec §2). Never picked up. */
  | { readonly kind: 'workbench' };

/**
 * A chunk is a TileRect of the grid. Its tiles are stored row-major using the chunk's *actual*
 * width (edge chunks can be narrower than chunkSize): localIndex = lz · width + lx.
 */
export interface Chunk extends TileRect {
  readonly cx: number;
  readonly cz: number;
  readonly tiles: readonly Tile[];
  /** Incremented every time any tile in the chunk changes. */
  readonly revision: number;
}

export interface WorldState {
  readonly grid: GridSpec;
  /** Chunk (cx, cz) lives at index cz · chunksX + cx. */
  readonly chunks: readonly Chunk[];
}

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

export interface TimeState {
  /** Minutes since midnight of the current day; runs from dayStart (06:00) to passOut (26:00). */
  readonly minuteOfDay: number;
  /** 1 … daysPerSeason */
  readonly dayOfSeason: number;
  readonly season: Season;
  /** 1-based */
  readonly year: number;
  /** 0-based count of days since the save was created. Drives deterministic RNG. */
  readonly absoluteDay: number;
}

// ---------------------------------------------------------------------------
// Player, inventory, economy
// ---------------------------------------------------------------------------

/** Feedback category for the last attempted action (animations, particles, sounds). */
export type ActionKind =
  | ToolType
  | 'plant'
  | 'harvest'
  | 'ship'
  | 'refill'
  | 'sleep'
  | 'openChest'
  | 'place'
  | 'fertilize'
  | 'none';

export interface ActionEvent {
  readonly seq: number;
  readonly kind: ActionKind;
  readonly target: TileCoord | null;
  readonly success: boolean;
}

export interface PlayerState {
  /** The map the player stands on; `tx`/`tz` are tile coordinates on that map. */
  readonly mapId: MapId;
  readonly tx: number;
  readonly tz: number;
  readonly facing: Direction;
  readonly energy: number;
  readonly maxEnergy: number;
  readonly gold: number;
  /** Incremented on every successful grid step (render: start a lerp). */
  readonly moveSeq: number;
  /** Incremented when the player is placed without walking (sleep, load, warp). Render: snap. */
  readonly teleportSeq: number;
  /** Incremented on every attempted tool use / interaction that produced feedback. */
  readonly actionSeq: number;
  readonly lastAction: ActionEvent | null;
  /** Id of the robot the player is carrying, or null (farmclaws part 1 §5.8). */
  readonly carrying: number | null;
}

/** Stacks merge only when both `itemId` and `quality` are equal. */
export interface ItemStack {
  readonly itemId: ItemId;
  readonly quantity: number;
  /** Nonzero only for items whose `hasQuality` is set (produce, and later forage, food, animal products). */
  readonly quality: Quality;
}

export interface InventoryState {
  /** Always INVENTORY.slotCount (36). 0–11 = hotbar, 12–35 = backpack. */
  readonly slots: readonly (ItemStack | null)[];
  /** 24 at the start (12 hotbar + 12 backpack); the general-store upgrade (later) makes it 36. Slots ≥ unlockedSlots are always null. */
  readonly unlockedSlots: 24 | 36;
  /** Always < INVENTORY.hotbarSize. */
  readonly selected: number;
  readonly water: number;
  readonly waterCapacity: number;
}

/** One slot of the player's inventory, or of the chest open in `ui.panel`. */
export type SlotRef =
  | { readonly container: 'player'; readonly index: number }
  | {
      readonly container: 'chest';
      readonly mapId: MapId;
      readonly tx: number;
      readonly tz: number;
      readonly index: number;
    };

export interface ShippingState {
  /** Items in the shipping bin, paid out at the start of the next day. */
  readonly pending: readonly ItemStack[];
  readonly lastPayout: number;
}

/**
 * The open menu. Any panel other than `none` freezes the clock and the player. Later
 * workstreams add kinds; the UI is reset on load, so a new kind never needs a save migration.
 */
export type UiPanel =
  | { readonly kind: 'none' }
  | { readonly kind: 'shop' }
  | { readonly kind: 'inventory' }
  | { readonly kind: 'chest'; readonly mapId: MapId; readonly tx: number; readonly tz: number }
  /** The robot screen (farmclaws part 3 spec §4): editable at the workbench, read-only when peeking. */
  | { readonly kind: 'robot'; readonly robotId: number; readonly mode: 'bench' | 'peek' };

export interface UiState {
  readonly panel: UiPanel;
  readonly paused: boolean;
  /** Real-time multiplier applied by the game loop. Presentation only; ticks carry minutes. */
  readonly timeScale: number;
  /** The zone marker's first corner while a zone is being painted (farmclaws part 3 spec §8). Reset on load. */
  readonly zoneDraft: null | { readonly zone: ZoneId; readonly corner: TileCoord };
  /** The zone the marker paints next. Presentation only; reset to A on load. */
  readonly zoneLetter: ZoneId;
}

export type MessageTone = 'info' | 'success' | 'warn';

export interface GameMessage {
  readonly id: number;
  readonly text: string;
  readonly tone: MessageTone;
  readonly day: number;
  readonly minute: number;
}

export interface MessageLog {
  readonly nextId: number;
  readonly entries: readonly GameMessage[];
}

// ---------------------------------------------------------------------------
// Farmclaws: robots (docs/superpowers/specs/2026-09-29-farmclaws-part1-robot-core.md)
// ---------------------------------------------------------------------------

export const ROBOT_SIZES = ['mini', 'standard', 'big'] as const;
export type RobotSize = (typeof ROBOT_SIZES)[number];

export const ROBOT_PART_IDS = [
  'claw',
  'wateringHead',
  'tiller',
  'seeder',
  'basket',
  'antenna',
  'sensorEye',
  'efficientCore',
  'quickCore',
] as const;
export type RobotPartId = (typeof ROBOT_PART_IDS)[number];

/**
 * What a robot's power is doing. Being carried is separate (`Robot.carried`). `ruined`: a broken
 * robot left in the water overnight; it can only be scrapped (farmclaws part 3 spec §3.2).
 */
export const ROBOT_POWERS = ['working', 'standby', 'flat', 'broken', 'repairing', 'ruined'] as const;
export type RobotPower = (typeof ROBOT_POWERS)[number];

/**
 * One robot action. `water`, `harvest`, `till` and `plant` work the robot's own tile;
 * `move`, `refill`, `deposit` and `take` work the tile ahead. `take` never takes a tool (the zone
 * marker included): a tool reads as not found.
 */
export type RobotAction =
  | { readonly kind: 'move' }
  | { readonly kind: 'turn'; readonly side: 'left' | 'right' }
  | { readonly kind: 'water' }
  | { readonly kind: 'harvest' }
  | { readonly kind: 'till' }
  | { readonly kind: 'plant'; readonly cropId: CropId }
  | { readonly kind: 'refill' }
  | { readonly kind: 'deposit' }
  | { readonly kind: 'take'; readonly itemId: ItemId }
  | { readonly kind: 'say'; readonly text: string }
  | { readonly kind: 'wait'; readonly minutes: number }
  | { readonly kind: 'powerDown' };
export type RobotActionKind = RobotAction['kind'];

export interface RobotScript {
  readonly kind: 'script';
  /** 1 … ROBOTS.maxScriptSteps actions. */
  readonly steps: readonly RobotAction[];
  /** After the last step: true starts again at step 0, false goes to standby. */
  readonly loop: boolean;
}
/** A part 1 script or a part 2 block program. */
export type RobotProgram = RobotScript | BlockProgram;

export interface RobotPlace {
  readonly tx: number;
  readonly tz: number;
  readonly facing: Direction;
}

export interface RobotActionEvent {
  readonly seq: number;
  readonly kind: RobotActionKind;
  readonly success: boolean;
  /** True when the action was a bicker (success is then false). */
  readonly bickered: boolean;
}

/** One period's robot counters (farmclaws part 3 spec §6.1). */
export interface RobotStatCounts {
  /** Tokens paid: actions, bickers, bumps and wakes. */
  readonly tokens: number;
  /** Resolved actions, blocked and bickered ones included; skips and wakes aren't actions. */
  readonly actions: number;
  /** Successful harvests plus plantings. */
  readonly crops: number;
}

export interface RobotStats {
  /** Since this morning. */
  readonly today: RobotStatCounts;
  /** Since the morning of this week's first day (day 1, 8, 15 or 22 of the season); never below today's. */
  readonly week: RobotStatCounts;
}

export interface Robot {
  readonly id: number;
  readonly name: string;
  readonly size: RobotSize;
  /** Canonical ROBOT_PART_IDS order, no repeats, at most the size's part slots. */
  readonly parts: readonly RobotPartId[];
  /** Farm tile it stands on. While carried or repairing, the tile it left from. */
  readonly tx: number;
  readonly tz: number;
  readonly facing: Direction;
  /** At most bagStacks(robot) stacks. */
  readonly bag: readonly ItemStack[];
  /** 0 … ROBOTS.tankCapacity; always 0 without a watering head. */
  readonly tank: number;
  /** 0 … batteryFor(size). */
  readonly tokens: number;
  readonly power: RobotPower;
  /** True while the player holds it (player.carrying === id). A carried robot never acts. */
  readonly carried: boolean;
  /** True while it stands on the workbench (part 3 spec §2.2): on the workbench tile, never carried, never due. */
  readonly onBench: boolean;
  readonly program: RobotProgram;
  /** Index of the next script step; always 0 for a block program. */
  readonly pc: number;
  /** Where a block program is; null for scripts. */
  readonly exec: RobotExec | null;
  /** The Managing Directive: 0 … ROBOTS.sizes[size].mdCards cards. */
  readonly md: readonly MdCard[];
  /**
   * Why the robot ignores everything. Separate from `power` (farmclaws design §5.4). 'dizzy' and
   * 'done' last until morning; 'player' (the bench's switch) lasts until it is switched on.
   */
  readonly off: null | 'dizzy' | 'done' | 'player';
  /** The next minute of the day it acts in. */
  readonly nextActMinute: number;
  /** Absolute day it comes back from repair; null unless power is 'repairing'. */
  readonly repairReadyDay: number | null;
  /** What it did today and this week (farmclaws part 3 spec §6.1). */
  readonly stats: RobotStats;
  /** Render counters, like PlayerState's. */
  readonly moveSeq: number;
  readonly teleportSeq: number;
  readonly actionSeq: number;
  readonly lastAction: RobotActionEvent | null;
  /** Index into ROBOT_PAINTS (0 … 15). Presentation only: it never changes what the robot does (part 3 spec §3.4). */
  readonly paint: number;
}

export const ROBOT_BLOCK_REASONS = [
  'noPart',
  'bumped',
  'farmEdge',
  'nothingToHarvest',
  'bagFull',
  'tankEmpty',
  'tankFull',
  'notTillable',
  'notWaterable',
  'noSeed',
  'cannotPlant',
  'outOfSeason',
  'noWaterAhead',
  'nothingAhead',
  'bagEmpty',
  'containerFull',
  'itemNotFound',
] as const;
export type RobotBlockReason = (typeof ROBOT_BLOCK_REASONS)[number];

export type RobotDidDetail =
  | { readonly kind: 'none' }
  | { readonly kind: 'tile' }
  | { readonly kind: 'crop'; readonly cropId: CropId; readonly quantity: number; readonly quality: Quality }
  | { readonly kind: 'planted'; readonly cropId: CropId }
  | { readonly kind: 'items'; readonly into: 'chest' | 'bin' | 'bag'; readonly stacks: number; readonly quantity: number };

export const ROBOT_LOG_EVENT_KINDS = [
  'did',
  'blocked',
  'bickered',
  'shortedOut',
  'flat',
  'finished',
  'poweredDown',
  'repaired',
  'skipped',
  'dizzy',
  'gaveUp',
  'woke',
  'doReturn',
  'doPowerDown',
  'conflict',
  'crashed',
  'ruined',
] as const;

export type RobotLogEvent =
  | { readonly kind: 'did'; readonly action: RobotActionKind; readonly detail: RobotDidDetail }
  | { readonly kind: 'blocked'; readonly action: RobotActionKind; readonly reason: RobotBlockReason }
  | { readonly kind: 'bickered'; readonly action: RobotActionKind; readonly withIds: readonly number[] }
  | { readonly kind: 'shortedOut' }
  | { readonly kind: 'flat' }
  | { readonly kind: 'finished' }
  | { readonly kind: 'poweredDown' }
  | { readonly kind: 'repaired' }
  // Farmclaws part 2 (spec §2.7). Events carry the card itself, so the log stays true after an .MD edit.
  | { readonly kind: 'skipped'; readonly action: RobotActionKind; readonly card: MdCard }
  | { readonly kind: 'dizzy' }
  | { readonly kind: 'gaveUp'; readonly target: TileCoord; readonly why: 'goTo' | 'forEach' | 'doReturn' }
  | { readonly kind: 'woke'; readonly trigger: Trigger }
  | { readonly kind: 'doReturn'; readonly card: MdCard; readonly phase: 'started' | 'arrived' | 'failed' }
  | { readonly kind: 'doPowerDown'; readonly card: MdCard }
  | { readonly kind: 'conflict'; readonly doCard: MdCard; readonly dontCard: MdCard }
  // Farmclaws part 3 (spec §3.1): a bump into robot `withId`; `forgot` is the trigger of the stack it forgot.
  | { readonly kind: 'crashed'; readonly withId: number; readonly forgot: Trigger | null }
  // A night in the water (part 3 spec §3.2).
  | { readonly kind: 'ruined' };

export interface RobotLogEntry {
  readonly id: number;
  readonly day: number;
  readonly minute: number;
  readonly robotId: number;
  readonly tx: number;
  readonly tz: number;
  readonly event: RobotLogEvent;
  /** Identical consecutive events of one robot collapse into one entry with a count. */
  readonly count: number;
}

export interface RobotsState {
  /** Next robot id, from 1. Ids are never reused. */
  readonly nextId: number;
  /** At most ROBOTS.maxRobots, ascending by id. */
  readonly list: readonly Robot[];
  /** The farm's token pool (no cap). */
  readonly pool: number;
  readonly log: { readonly nextId: number; readonly entries: readonly RobotLogEntry[] };
  /** What generators burned last night. */
  readonly lastNightFuel: { readonly wood: number; readonly tokens: number };
  /** Named farm rectangles for programs and .MDs; null is an empty zone. */
  readonly zones: Readonly<Record<ZoneId, ZoneRect | null>>;
  /** True while the zone marker owed to a migrated save waits for a free backpack slot (part 3 spec §8). */
  readonly pendingMarker: boolean;
  /** What the robot screen offers (farmclaws part 3 spec §7). Gates the editor only, never the simulation. */
  readonly unlocks: RobotUnlocks;
}

// ---------------------------------------------------------------------------
// Robot language (docs/superpowers/specs/2026-10-02-farmclaws-part2-language.md)
// ---------------------------------------------------------------------------

export const ZONE_IDS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] as const;
export type ZoneId = (typeof ZONE_IDS)[number];

/** A rectangle of farm tiles: x0 … x0+w-1, z0 … z0+d-1. w, d ≥ 1; wholly inside the farm. */
export interface ZoneRect {
  readonly x0: number;
  readonly z0: number;
  readonly w: number;
  readonly d: number;
}

/**
 * `Every [n] minutes` options. Declared here rather than in config so the Trigger type needs
 * no config import (config imports this file); ROBOTS.everyChoices is this list.
 */
export const EVERY_CHOICES = [5, 10, 15, 30, 60] as const;

export const VALUE_TYPES = ['number', 'text', 'yesNo', 'item', 'tile'] as const;
export type ValueType = (typeof VALUE_TYPES)[number];

/** A runtime value. Numbers are integers in ±ROBOTS.maxNumber; texts 0 … ROBOTS.maxTextLength characters; tiles are farm tiles. */
export type Value =
  | { readonly type: 'number'; readonly value: number }
  | { readonly type: 'text'; readonly value: string }
  | { readonly type: 'yesNo'; readonly value: boolean }
  | { readonly type: 'item'; readonly value: ItemId }
  | { readonly type: 'tile'; readonly value: TileCoord };

/** One expression. Its type is decided by the checker (src/robots/check.ts), not by TypeScript. */
export type Expr =
  // literals (count 0 blocks)
  | { readonly kind: 'num'; readonly value: number }
  | { readonly kind: 'text'; readonly value: string }
  | { readonly kind: 'yes'; readonly value: boolean }
  | { readonly kind: 'item'; readonly itemId: ItemId }
  | { readonly kind: 'tile'; readonly tx: number; readonly tz: number }
  // values
  | { readonly kind: 'var'; readonly name: string }
  | { readonly kind: 'myTile' }
  | { readonly kind: 'tileAhead' }
  | { readonly kind: 'tokensLeft' }
  | { readonly kind: 'countInBag'; readonly itemId: ItemId }
  | { readonly kind: 'arith'; readonly op: '+' | '-' | '×'; readonly a: Expr; readonly b: Expr }
  | { readonly kind: 'compare'; readonly op: '=' | '≠' | '<' | '>'; readonly a: Expr; readonly b: Expr }
  | { readonly kind: 'and' | 'or'; readonly a: Expr; readonly b: Expr }
  | { readonly kind: 'not'; readonly a: Expr }
  // sensors (all Yes/No, all free; the last three need a sensor eye)
  | { readonly kind: 'cropIsReady' }
  | { readonly kind: 'soilIsDry' }
  | { readonly kind: 'tileIsTilled' }
  | { readonly kind: 'cropIs'; readonly cropId: CropId }
  | { readonly kind: 'bagIsFull' }
  | { readonly kind: 'bagHas'; readonly itemId: ItemId }
  | { readonly kind: 'atEdgeOf'; readonly zone: ZoneId }
  | { readonly kind: 'tokensBelow'; readonly n: Expr }
  | { readonly kind: 'tileAheadIs'; readonly what: 'water' | 'blocked' | 'clear' }
  | { readonly kind: 'itIsRaining' }
  | { readonly kind: 'timeIsAfter'; readonly minute: number };

/** An action block. Mirrors RobotAction, with expressions where the editor has sockets. */
export type ActionBlock =
  | { readonly kind: 'move' }
  | { readonly kind: 'turn'; readonly side: 'left' | 'right' }
  | { readonly kind: 'water' }
  | { readonly kind: 'harvest' }
  | { readonly kind: 'till' }
  | { readonly kind: 'plant'; readonly cropId: CropId }
  | { readonly kind: 'refill' }
  | { readonly kind: 'deposit' }
  /** `item` is an Item expression. */
  | { readonly kind: 'take'; readonly item: Expr }
  /** `text` is a Text expression. */
  | { readonly kind: 'say'; readonly text: Expr }
  /** `minutes` is a Number expression. */
  | { readonly kind: 'wait'; readonly minutes: Expr }
  | { readonly kind: 'powerDown' };

export type Statement =
  | { readonly kind: 'do'; readonly action: ActionBlock }
  | { readonly kind: 'repeatTimes'; readonly times: Expr; readonly body: readonly Statement[] }
  | { readonly kind: 'repeatUntil'; readonly until: Expr; readonly body: readonly Statement[] }
  | { readonly kind: 'repeatForever'; readonly body: readonly Statement[] }
  | { readonly kind: 'if'; readonly cond: Expr; readonly then: readonly Statement[]; readonly else: readonly Statement[] | null }
  | { readonly kind: 'forEachTile'; readonly zone: ZoneId; readonly body: readonly Statement[] }
  /** `tile` is a Tile expression. */
  | { readonly kind: 'goTo'; readonly tile: Expr }
  | { readonly kind: 'set'; readonly name: string; readonly value: Expr }
  /** Adds `by` to a Number variable. */
  | { readonly kind: 'change'; readonly name: string; readonly by: Expr }
  | { readonly kind: 'runHelper'; readonly name: string };

export type Trigger =
  /** Starts at the morning reset (TIME.dayStartMinute) only. */
  | { readonly kind: 'morning' }
  | { readonly kind: 'atTime'; readonly minute: number }
  | { readonly kind: 'bagFull' }
  | { readonly kind: 'startsRaining' }
  /** `minutes` is one of ROBOTS.everyChoices. */
  | { readonly kind: 'every'; readonly minutes: (typeof EVERY_CHOICES)[number] };

/** A variable; `initial` is a literal of `type`, restored each morning. */
export interface VarDecl {
  readonly name: string;
  readonly type: ValueType;
  readonly initial: Expr;
}

export interface TriggerStack {
  readonly trigger: Trigger;
  readonly body: readonly Statement[];
}

export interface HelperDef {
  readonly name: string;
  readonly body: readonly Statement[];
}

export interface BlockProgram {
  readonly kind: 'blocks';
  readonly vars: readonly VarDecl[];
  /** 1 … ROBOTS.maxStacks. */
  readonly stacks: readonly TriggerStack[];
  readonly helpers: readonly HelperDef[];
}

/** Which statement list a frame walks: a stack or helper body, then (statement index, branch) steps down. */
export interface ListRef {
  readonly root: 'stack' | 'helper';
  readonly index: number;
  readonly path: readonly (readonly [statement: number, branch: 'body' | 'then' | 'else'])[];
}

export type LoopState =
  /** `left`: iterations still to start, after this one. */
  | { readonly kind: 'times'; readonly left: number }
  | { readonly kind: 'until' }
  | { readonly kind: 'forever' }
  | { readonly kind: 'forEach'; readonly tiles: readonly TileCoord[]; readonly i: number };

export type Frame =
  /** Walking a statement list. `loop` is set when the list is a loop's body. */
  | { readonly kind: 'list'; readonly list: ListRef; readonly next: number; readonly loop: LoopState | null }
  /** Walking a route to `target`, one move or turn per due minute. `why` says who asked. */
  | {
      readonly kind: 'route';
      readonly target: TileCoord;
      readonly path: readonly TileCoord[];
      readonly why: 'goTo' | 'forEach' | 'doReturn';
    };

/** Where a block program is. Scripts keep `Robot.pc` instead and have `exec: null`. */
export interface RobotExec {
  /**
   * The trigger stack running, or null while idle. Also null during a DO return, which stops
   * the program: then `frames` holds exactly the return's route frame.
   */
  readonly running: number | null;
  /**
   * Innermost last. At most ROBOTS.maxFrames. Empty exactly when `running` is null, except
   * during a DO return: then it is exactly one `route` frame with `why: 'doReturn'` (plan R1).
   */
  readonly frames: readonly Frame[];
  /** One per program.vars, same order and type. */
  readonly vars: readonly Value[];
  /** Per stack: the next minute an `every` / `atTime` trigger may fire today, or null when spent. Other triggers: null. */
  readonly due: readonly (number | null)[];
  /** Per stack: whether a once-a-day trigger (bagFull, startsRaining) already fired today. */
  readonly firedToday: readonly boolean[];
  /** Indices of DO cards already carried out today. */
  readonly doneCards: readonly number[];
}

/** One card of the Managing Directive (.MD): DON'T cards forbid, DO cards take over. */
export type MdCard =
  | { readonly kind: 'dontLeave'; readonly zone: ZoneId }
  | { readonly kind: 'dontGoIntoWater' }
  | { readonly kind: 'dontHarvest'; readonly cropId: CropId }
  | { readonly kind: 'dontDeposit'; readonly itemId: ItemId }
  | {
      readonly kind: 'doReturn';
      readonly to: { readonly kind: 'tile'; readonly tx: number; readonly tz: number } | { readonly kind: 'generator' };
      readonly minute: number;
    }
  | {
      readonly kind: 'doPowerDown';
      readonly when: { readonly kind: 'bagFull' } | { readonly kind: 'tokensBelow'; readonly n: number } | { readonly kind: 'raining' };
    };

/** Every .MD card kind, in the order unlocks list them. */
export const MD_CARD_KINDS = [
  'dontLeave',
  'dontGoIntoWater',
  'dontHarvest',
  'dontDeposit',
  'doReturn',
  'doPowerDown',
] as const satisfies readonly MdCard['kind'][];

/** The robot screen's tabs, in screen order. */
export const ROBOT_TABS = ['program', 'md', 'looks', 'stats', 'log'] as const;
export type RobotTab = (typeof ROBOT_TABS)[number];

/** The unlocked blocks, cards and tabs (part 3 spec §7), each in canonical order without repeats. */
export interface RobotUnlocks {
  readonly blocks: readonly BlockKind[];
  readonly cards: readonly MdCard['kind'][];
  readonly tabs: readonly RobotTab[];
}

// ---------------------------------------------------------------------------
// Sections for later workstreams (data only in Phase 0)
// ---------------------------------------------------------------------------

export interface Appearance {
  /** 0 … APPEARANCE.skinTones - 1 */
  readonly skinTone: number;
  /** 0 … APPEARANCE.hairStyles - 1 */
  readonly hairStyle: number;
  /** 0 … APPEARANCE.hairColors - 1 */
  readonly hairColor: number;
  /** 0 … APPEARANCE.shirtColors - 1 */
  readonly shirtColor: number;
  /** 0 … APPEARANCE.overallsColors - 1 */
  readonly overallsColor: number;
  /** 0 = no hat, 1 … APPEARANCE.hats - 1 */
  readonly hat: number;
}

export interface ProfileState {
  readonly playerName: string;
  readonly farmName: string;
  readonly appearance: Appearance;
}

export interface ToolUpgradeOrder {
  readonly tool: UpgradableTool;
  readonly level: 1 | 2;
  readonly readyDay: number;
}

export interface ToolProgressState {
  readonly levels: Readonly<Record<UpgradableTool, ToolLevel>>;
  readonly upgrade: ToolUpgradeOrder | null;
}

export interface CraftingState {
  /** Unique, in CRAFTING_RECIPE_IDS order. */
  readonly known: readonly CraftingRecipeId[];
}

export interface CookingState {
  /** Unique, in DISH_IDS order. */
  readonly known: readonly DishId[];
  readonly kitchenLevel: 0 | 1;
}

export interface Animal {
  readonly id: number;
  readonly kind: AnimalKind;
  readonly name: string;
  readonly bornDay: number;
  readonly fedToday: boolean;
  readonly pettedToday: boolean;
  /** 0 … 255 */
  readonly happiness: number;
  readonly hasProduct: boolean;
}

export interface FarmBuilding {
  readonly id: number;
  readonly kind: FarmBuildingKind;
  /** Index into the farm layout's `plots` (0 = coop plot, 1 = barn plot). */
  readonly plot: number;
  /** Absolute day construction finishes; the building is standing once time.absoluteDay ≥ readyDay. */
  readonly readyDay: number;
  readonly troughWheat: number;
  readonly animals: readonly Animal[];
}

export type HeartEventLevel = 2 | 4 | 6;

export interface NpcRelation {
  /** 0 … 2500 (250 per heart) */
  readonly points: number;
  readonly talkedToday: boolean;
  /** 0 … 1 */
  readonly giftsToday: number;
  /** 0 … 2 */
  readonly giftsThisWeek: number;
  /** Ascending, unique. */
  readonly heartEventsSeen: readonly HeartEventLevel[];
  /** Lifetime conversations; rotates dialogue lines. */
  readonly talks: number;
}

export interface BoardRequest {
  readonly week: number;
  readonly npc: NpcId;
  readonly itemId: ItemId;
  readonly quantity: number;
  readonly dueDay: number;
  readonly delivered: number;
  readonly status: 'active' | 'completed' | 'expired';
}

export interface QuestState {
  /** Unique, in STORY_QUEST_IDS order. */
  readonly completed: readonly StoryQuestId[];
  readonly board: BoardRequest | null;
}

export interface LifetimeStats {
  readonly parsnipsShipped: number;
  readonly debrisCleared: number;
  readonly forageFound: number;
  readonly totalEarned: number;
  readonly visitedTown: boolean;
  readonly craftedChest: boolean;
  readonly builtCoop: boolean;
}

export interface FestivalState {
  /** Absolute day the fields below belong to; -1 when no festival progress is stored. */
  readonly activeDay: number;
  /** Bitmask of the 12 Blossom Fair eggs (0 … 4095). */
  readonly eggsFound: number;
  readonly lanternReleased: boolean;
  /** Harvest Fair display, ≤ 9 stacks. */
  readonly display: readonly ItemStack[];
  readonly giftTarget: NpcId | null;
  readonly giftGiven: boolean;
}

/** Every §2.7 section of GameState, as produced by `createDefaultSections()`. */
export interface GameSections {
  readonly profile: ProfileState;
  readonly tools: ToolProgressState;
  readonly crafting: CraftingState;
  readonly cooking: CookingState;
  readonly buildings: readonly FarmBuilding[];
  /** Next id for buildings and animals (shared counter, starts at 1). */
  readonly nextEntityId: number;
  readonly npcs: Readonly<Record<NpcId, NpcRelation>>;
  readonly quests: QuestState;
  readonly stats: LifetimeStats;
  readonly festival: FestivalState;
  readonly robots: RobotsState;
}

export interface GameState extends GameSections {
  readonly version: typeof SAVE_VERSION;
  readonly seed: number;
  readonly time: TimeState;
  readonly weather: Weather;
  /** One world per map; the player stands on `maps[player.mapId]`. */
  readonly maps: Readonly<Record<MapId, WorldState>>;
  readonly player: PlayerState;
  readonly inventory: InventoryState;
  readonly shipping: ShippingState;
  readonly ui: UiState;
  readonly messages: MessageLog;
}
