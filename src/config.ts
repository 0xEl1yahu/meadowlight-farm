/**
 * Global tuning constants. Everything that shapes the simulation lives here so gameplay
 * can be rebalanced without touching system code.
 */
import { Direction, type ItemStack, type TileCoord, type TileRect } from './core/types';

/** Settings shared by every map. Each map's size lives in its definition (src/world/maps/). */
export const WORLD = {
  /** Partial edge chunks are supported, so map sizes need not be multiples of this. */
  chunkSize: 16,
  /** World units per tile edge. */
  tileSize: 1,
  seed: 0x5eedf00d,
} as const;

export const TIME = {
  /** 06:00 */
  dayStartMinute: 6 * 60,
  /** 02:00 the next morning, expressed past midnight so the day is monotonic. */
  passOutMinute: 26 * 60,
  daysPerSeason: 28,
  seasonsPerYear: 4,
  /** Stardew pacing: 10 in-game minutes every 7 real seconds. */
  realSecondsPerGameMinute: 0.7,
  /** The HUD clock advances in 10-minute steps. */
  clockStepMinutes: 10,
  /** Upper bound for a single tick action (guards against huge frame hitches). */
  maxTickMinutes: 120,
  timeScales: [1, 2, 4, 8, 16],
} as const;

export interface PondSpec {
  /** Ellipse centre in continuous tile space (tile (tx,tz) has centre (tx + 0.5, tz + 0.5)). */
  readonly centerX: number;
  readonly centerZ: number;
  readonly radiusX: number;
  readonly radiusZ: number;
}

export interface FarmLayout {
  readonly house: TileRect;
  /** House tile that holds the front door (on the house's +Z face). */
  readonly houseDoor: TileCoord;
  readonly shippingBin: TileRect;
  readonly pond: PondSpec;
  /** Areas guaranteed free of debris. */
  readonly clearZones: readonly TileRect[];
  readonly rockDensity: number;
  readonly stumpDensity: number;
  /** Building plots for the coop and the barn; FarmBuilding.plot indexes this list. */
  readonly plots: readonly TileRect[];
}

/**
 * The house sits in the far (-X, -Z) corner on purpose: the isometric camera looks from +X/+Z,
 * so anything tall hides the ground behind it along -X/-Z. In the corner there is no walkable
 * tile behind the house for the player to disappear into.
 */
export const LAYOUT: FarmLayout = {
  house: { x0: 0, z0: 0, width: 5, depth: 5 },
  houseDoor: { tx: 2, tz: 4 },
  shippingBin: { x0: 9, z0: 5, width: 2, depth: 1 },
  pond: { centerX: 39.5, centerZ: 31, radiusX: 5.2, radiusZ: 4.2 },
  clearZones: [
    { x0: 0, z0: 0, width: 14, depth: 9 },
    { x0: 1, z0: 9, width: 17, depth: 9 },
    /** West gate to the forest. */
    { x0: 0, z0: 13, width: 1, depth: 1 },
    /** South-east gate to the town. */
    { x0: 46, z0: 38, width: 2, depth: 1 },
  ],
  rockDensity: 0.055,
  stumpDensity: 0.03,
  plots: [
    { x0: 20, z0: 3, width: 7, depth: 6 },
    { x0: 30, z0: 3, width: 8, depth: 7 },
  ],
};

export const PLAYER = {
  maxEnergy: 100,
  /** Energy restored when the day ends by passing out instead of sleeping. */
  passOutEnergyFraction: 0.5,
  /** Duration of one grid step; also the input repeat interval while a key is held. */
  moveDurationSeconds: 0.16,
  /** Forward raycast length in tiles. 1 = the tile directly in front of the player. */
  toolReachTiles: 1,
  /** Directly in front of the house door, on the farm. */
  spawn: { tx: 2, tz: 5 } satisfies TileCoord,
  spawnFacing: Direction.South as Direction,
  startingGold: 500,
} as const;

export const TOOLS = {
  energyCost: {
    hoe: 2,
    wateringCan: 2,
    pickaxe: 3,
    axe: 3,
    scythe: 0,
  },
  wateringCanCapacity: 40,
  rockHits: 2,
  stumpHits: 3,
  /** Axe hits that fell a tree; the tree then becomes a stump. */
  treeHits: 4,
  stoneFromRock: 1,
  woodFromStump: 2,
  /** Wood dropped when a tree falls (the stump it leaves drops `woodFromStump` more). */
  woodFromTree: 4,
} as const;

export const INVENTORY = {
  /** Slots 0 … hotbarSize - 1 are the hotbar; the rest is the backpack. */
  hotbarSize: 12,
  /** Every inventory holds this many slots; those at or above `unlockedSlots` stay empty. */
  slotCount: 36,
  /** The hotbar plus the first backpack row; the general-store upgrade (later) unlocks all 36. */
  startingUnlockedSlots: 24,
  maxStack: 999,
  /** Slots in every placed chest. */
  chestSlots: 36,
  starting: [
    { itemId: 'hoe', quantity: 1, quality: 0 },
    { itemId: 'wateringCan', quantity: 1, quality: 0 },
    { itemId: 'pickaxe', quantity: 1, quality: 0 },
    { itemId: 'axe', quantity: 1, quality: 0 },
    { itemId: 'scythe', quantity: 1, quality: 0 },
    { itemId: 'parsnip_seeds', quantity: 15, quality: 0 },
  ] satisfies readonly ItemStack[],
} as const;

/** Sell-price multiplier per quality: normal, silver, gold. */
export const QUALITY_MULTIPLIERS = [1, 1.25, 1.5] as const;

export const FARMING = {
  /** Chance that an empty, un-watered plowed tile reverts to grass overnight. */
  untillChance: 0.1,
  /** Seed scattering: a handful covers the `depth` rows in front of the player, `width` wide. */
  scatter: { width: 3, depth: 3 },
  /** Indexed by Quality (see QUALITY_MULTIPLIERS). */
  qualityMultipliers: QUALITY_MULTIPLIERS,
  /** Harvest quality roll r ∈ [0, 1): gold when r < gold, silver when r < silver, otherwise normal. */
  qualityChance: { gold: 0.05, silver: 0.2 },
} as const;

/**
 * The farm's shade and the wild crops that grow in it (the farm map's `WildTuning` comes from
 * here). Shaded tiles are the strips under the woodland on the far (-X / -Z) edges and a ring
 * around the farmhouse.
 */
export const SHADE = {
  /** Tiles with tx < edgeBand or tz < edgeBand lie under the border woodland. */
  edgeBand: 2,
  /** Chebyshev distance around the house footprint that its shadow covers. */
  houseRing: 1,
  /** Nightly chance that an empty shaded grass tile sprouts a wild crop by itself. */
  sproutChance: 0.015,
  /** Extra nightly chance per orthogonal neighbour holding a mature wild crop (spreading). */
  spreadChancePerNeighbor: 0.12,
  /** Upper bound on wild crops on the farm, so shade never fills up completely. */
  maxWild: 40,
  /** Share of empty shaded tiles that already hold a wild crop on a brand-new farm. */
  initialDensity: 0.12,
} as const;

/** Palette sizes for the player's look. Index 0 of every palette is the original look. */
export const APPEARANCE = {
  skinTones: 5,
  hairStyles: 3,
  hairColors: 6,
  shirtColors: 8,
  overallsColors: 6,
  /** Including 0 = no hat. */
  hats: 4,
} as const;

export const PROFILE = {
  /** Maximum length of the player and farm names. */
  maxNameLength: 24,
} as const;

export const MESSAGES = {
  /** Number of log entries retained in state. */
  capacity: 6,
} as const;
