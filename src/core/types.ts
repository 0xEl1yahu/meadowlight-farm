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

export const SAVE_VERSION = 2 as const;

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
  /** Remaining hits for Rock/Stump blockers, 0 otherwise. */
  readonly blockerHp: number;
  readonly crop: CropInstance | null;
}

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
export type ActionKind = ToolType | 'plant' | 'harvest' | 'ship' | 'refill' | 'sleep' | 'none';

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

export interface GameState {
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
