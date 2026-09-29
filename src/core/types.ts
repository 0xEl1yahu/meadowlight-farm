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

export const SAVE_VERSION = 3 as const;

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

export const TOOL_TYPES = ['hoe', 'wateringCan', 'pickaxe', 'axe', 'scythe'] as const;
export type ToolType = (typeof TOOL_TYPES)[number];

export const MATERIAL_IDS = ['stone', 'wood'] as const;
export type MaterialItemId = (typeof MATERIAL_IDS)[number];

export type SeedItemId = `${CropId}_seeds`;
export type ProduceItemId = CropId;
export type ItemId = ToolType | SeedItemId | ProduceItemId | MaterialItemId;

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
  | { readonly kind: 'decoration'; readonly variant: DecorationId };

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
  | 'none';

export interface ActionEvent {
  readonly seq: number;
  readonly kind: ActionKind;
  readonly target: TileCoord | null;
  readonly success: boolean;
}

export interface PlayerState {
  readonly tx: number;
  readonly tz: number;
  readonly facing: Direction;
  readonly energy: number;
  readonly maxEnergy: number;
  readonly gold: number;
  /** Incremented on every successful grid step (render: start a lerp). */
  readonly moveSeq: number;
  /** Incremented when the player is placed without walking (sleep, load). Render: snap. */
  readonly teleportSeq: number;
  /** Incremented on every attempted tool use / interaction that produced feedback. */
  readonly actionSeq: number;
  readonly lastAction: ActionEvent | null;
}

export interface ItemStack {
  readonly itemId: ItemId;
  readonly quantity: number;
}

export interface InventoryState {
  readonly slots: readonly (ItemStack | null)[];
  readonly selected: number;
  readonly water: number;
  readonly waterCapacity: number;
}

export interface ShippingState {
  /** Items in the shipping bin, paid out at the start of the next day. */
  readonly pending: readonly ItemStack[];
  readonly lastPayout: number;
}

export interface UiState {
  readonly shopOpen: boolean;
  readonly paused: boolean;
  /** Real-time multiplier applied by the game loop. Presentation only; ticks carry minutes. */
  readonly timeScale: number;
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
}

export interface GameState extends GameSections {
  readonly version: typeof SAVE_VERSION;
  readonly seed: number;
  readonly time: TimeState;
  readonly weather: Weather;
  readonly world: WorldState;
  readonly player: PlayerState;
  readonly inventory: InventoryState;
  readonly shipping: ShippingState;
  readonly ui: UiState;
  readonly messages: MessageLog;
}
