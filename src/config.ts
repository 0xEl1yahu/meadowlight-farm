/**
 * Global tuning constants. Everything that shapes the simulation lives here so gameplay
 * can be rebalanced without touching system code.
 */
import { Direction, type ItemStack, type TileCoord, type TileRect } from './core/types';

export const WORLD = {
  /** Tiles along +X. Any positive size works; partial edge chunks are supported. */
  width: 48,
  /** Tiles along +Z. 40 / 16 → the last chunk row is a partial chunk of 8 rows. */
  depth: 40,
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
  ],
  rockDensity: 0.055,
  stumpDensity: 0.03,
};

export const PLAYER = {
  maxEnergy: 100,
  /** Energy restored when the day ends by passing out instead of sleeping. */
  passOutEnergyFraction: 0.5,
  /** Duration of one grid step; also the input repeat interval while a key is held. */
  moveDurationSeconds: 0.16,
  /** Forward raycast length in tiles. 1 = the tile directly in front of the player. */
  toolReachTiles: 1,
  /** Directly in front of the house door. */
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
  stoneFromRock: 1,
  woodFromStump: 2,
} as const;

export const INVENTORY = {
  hotbarSize: 12,
  maxStack: 999,
  starting: [
    { itemId: 'hoe', quantity: 1 },
    { itemId: 'wateringCan', quantity: 1 },
    { itemId: 'pickaxe', quantity: 1 },
    { itemId: 'axe', quantity: 1 },
    { itemId: 'scythe', quantity: 1 },
    { itemId: 'parsnip_seeds', quantity: 15 },
  ] satisfies readonly ItemStack[],
} as const;

export const FARMING = {
  /** Chance that an empty, un-watered plowed tile reverts to grass overnight. */
  untillChance: 0.1,
} as const;

export const MESSAGES = {
  /** Number of log entries retained in state. */
  capacity: 6,
} as const;
