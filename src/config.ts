/**
 * Global tuning constants. Everything that shapes the simulation lives here so gameplay
 * can be rebalanced without touching system code.
 */
import {
  Direction,
  EVERY_CHOICES,
  type ItemStack,
  type RobotActionKind,
  type RobotSize,
  type RobotUnlocks,
  type TileCoord,
  type TileRect,
} from './core/types';

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
    zoneMarker: 0,
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

/** The zone marker's overlay (farmclaws part 3 spec §8). */
export const ZONE_MARKER = {
  /** Outline and letter colour of zones A … H, in ZONE_IDS order. */
  colors: [0xe2563f, 0xf2c14e, 0x5fa84a, 0x2f6fb0, 0x8e5ba8, 0xf28a3a, 0x3aa59c, 0xe87fa3],
  /** Height of a zone outline above the ground of the tile it borders (world units). */
  outlineHeight: 0.03,
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
  /**
   * Harvest quality chances per fertiliser in the soil ('none' also covers Speed-Gro). The roll
   * r ∈ [0, 1) gives gold when r < gold, silver when r < gold + silver, otherwise normal.
   */
  qualityChance: {
    none: { silver: 0.15, gold: 0.05 },
    basic: { silver: 0.25, gold: 0.1 },
    quality: { silver: 0.35, gold: 0.2 },
  },
  /** Speed-Gro removes this share of a crop's total grow days, rounded, and at least 1 day. */
  speedGroFraction: 0.1,
} as const;

/** Materials that clearing debris drops on top of the stone and wood (see farming/drops.ts). */
export const DROPS = {
  /** Chance that a broken rock also drops 1 copper ore. */
  copperOreFromRock: 0.25,
  /** Chance that a felled tree also drops 1 sap. */
  sapFromTree: 0.5,
  /** Chance that a cleared stump drops 1 sap. */
  sapFromStump: 0.15,
  /** Fiber from cutting one patch of weeds with the scythe. */
  fiberFromWeeds: 1,
} as const;

/** Crows raid the farm at night (see farming/crows.ts). */
export const CROWS = {
  /** Crows only come when more than this many field crops grow on the farm. */
  minCrops: 15,
  /** Nightly chance that each unprotected field crop is eaten. */
  chance: 0.03,
  /** Most crops eaten in one night. */
  maxPerNight: 3,
  /** A scarecrow protects every crop within this Euclidean distance in tiles. */
  scarecrowRadius: 8,
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

/** One robot size (farmclaws design §3.6). */
export interface RobotSizeSpec {
  readonly price: number;
  readonly battery: number;
  readonly bagStacks: number;
  readonly partSlots: number;
  readonly costMultiplier: number;
  /** Most blocks a program may hold (farmclaws part 2 §3). */
  readonly blocks: number;
  /** Most variables a program may declare. */
  readonly vars: number;
  /** Most .MD cards. */
  readonly mdCards: number;
}

const ROBOT_SIZE_SPECS = {
  mini: { price: 1500, battery: 80, bagStacks: 1, partSlots: 1, costMultiplier: 1, blocks: 12, vars: 1, mdCards: 3 },
  standard: { price: 4000, battery: 200, bagStacks: 3, partSlots: 2, costMultiplier: 2, blocks: 30, vars: 3, mdCards: 6 },
  big: { price: 10000, battery: 500, bagStacks: 9, partSlots: 3, costMultiplier: 4, blocks: 80, vars: 6, mdCards: 10 },
} as const satisfies Readonly<Record<RobotSize, RobotSizeSpec>>;

/** Base token cost of each action, for a Mini before the multiplier and the efficient core. */
const ROBOT_ACTION_COSTS = {
  move: 1,
  turn: 1,
  water: 2,
  harvest: 3,
  till: 5,
  plant: 3,
  refill: 1,
  deposit: 1,
  take: 1,
  say: 1,
  wait: 0,
  powerDown: 0,
} as const satisfies Readonly<Record<RobotActionKind, number>>;

const ROBOT_CARRY_ENERGY = { mini: 4, standard: 8, big: 16 } as const satisfies Readonly<Record<RobotSize, number>>;

/** Farmclaws (src/robots/). */
export const ROBOTS = {
  maxRobots: 12,
  maxScriptSteps: 80,
  tankCapacity: 20,
  /** A robot acts every this many in-game minutes; the quick core makes it quickCorePeriod. */
  period: 4,
  quickCorePeriod: 3,
  sizes: ROBOT_SIZE_SPECS,
  basketExtraStacks: 2,
  efficientCoreFactor: 0.75,
  /** Repairs cost this share of the size's price. */
  repairShare: 0.2,
  cost: ROBOT_ACTION_COSTS,
  logCapacity: 400,
  /** Player energy to pick up (or fish out) a robot. */
  carryEnergy: ROBOT_CARRY_ENERGY,
  /** Robots recharge overnight only within this Chebyshev distance of a generator. */
  chargeRadius: 2,
  /** Repaired robots come back to the nearest walkable tile to this one (in front of the shipping bin). */
  repairDropOff: { tx: 9, tz: 6 } satisfies TileCoord,
  sayMaxLength: 60,
  maxWaitMinutes: 240,
  /** Free blocks a robot may pass in one due minute before it gets dizzy (part 2 §5.1). */
  stepBudget: 50,
  /** Trigger stacks per program. */
  maxStacks: 8,
  /** Frame stack depth: nesting plus helper calls. */
  maxFrames: 16,
  /** Numbers clamp to ±this after arithmetic. */
  maxNumber: 999_999,
  /** Longest text value (the same as sayMaxLength). */
  maxTextLength: 60,
  /** Longest variable or helper name. */
  maxIdentifierLength: 16,
  /** `Every [n] minutes` options. */
  everyChoices: EVERY_CHOICES,
  /** Base tokens to wake from standby on a trigger; scaled like an action cost. */
  wakeCost: 1,
  /** `Repeat [n] times` clamps n to 0 … this at run time. */
  maxRepeatTimes: 999,
  /** Days in a robot stats week; weeks start on day 1 of the season (part 3 §6.1). */
  weekLength: 7,
} as const;

/** What the robot screen offers (farmclaws part 3 spec §7). Part 4's jobs add to it through withUnlocks. */
export const UNLOCKS = {
  /** Job 1's set: the start for new farms and migrated saves. `tokensLeft` and `compare` give Repeat until a condition. */
  job1: {
    blocks: [
      'morning',
      'atTime',
      'repeatTimes',
      'repeatUntil',
      'repeatForever',
      'move',
      'turn',
      'goTo',
      'water',
      'refill',
      'powerDown',
      'wait',
      'say',
      'num',
      'text',
      'yes',
      'item',
      'tile',
      'myTile',
      'tileAhead',
      'tokensLeft',
      'compare',
    ],
    cards: ['dontLeave', 'dontGoIntoWater'],
    tabs: ['program', 'md', 'looks', 'log'],
  },
} as const satisfies { readonly job1: RobotUnlocks };


/** The workbench built into every farm (farmclaws part 3 spec §2.1). */
export const WORKBENCH = {
  /** In the farmhouse yard, east of the house and off the door, the spawn and the bin. */
  home: { tx: 6, tz: 4 } satisfies TileCoord,
  /** Height of the bench top above its tile's ground, where a robot on it stands (render only). */
  topHeight: 0.55,
} as const;

export const GENERATORS = {
  woodBurner: { hopper: 10, tokensPerWood: 6 },
} as const;

/** The workbench's other jobs and the ruined look (farmclaws part 3 spec §3.2–3.4). */
export const ROBOT_CARE = {
  /** Scrapping pays this share of the size's price, whatever the robot's power. */
  scrapShare: 0.25,
  /** Gold per paint job. */
  paintCost: 50,
  /** A ruined robot's paint is drawn at this brightness. */
  ruinedShade: 0.45,
} as const;

/** The 16 base paints (`Robot.paint` indexes this list). Sunflower is the factory colour. */
export const ROBOT_PAINTS = [
  { name: 'Sunflower', color: 0xf2c14e },
  { name: 'Tomato', color: 0xe2563f },
  { name: 'Pumpkin', color: 0xf28a3a },
  { name: 'Peach', color: 0xf4b38a },
  { name: 'Rose', color: 0xe87fa3 },
  { name: 'Plum', color: 0x8e5ba8 },
  { name: 'Lavender', color: 0xa99be0 },
  { name: 'Sky', color: 0x6fb7e8 },
  { name: 'Ocean', color: 0x2f6fb0 },
  { name: 'Teal', color: 0x3aa59c },
  { name: 'Mint', color: 0x8fdcb0 },
  { name: 'Leaf', color: 0x5fa84a },
  { name: 'Olive', color: 0x8a8f3c },
  { name: 'Cocoa', color: 0x8a5a3c },
  { name: 'Slate', color: 0x5e6670 },
  { name: 'Cream', color: 0xece2c6 },
] as const satisfies readonly { readonly name: string; readonly color: number }[];

/** The robot screen (farmclaws part 3 spec §4, §5). */
export const ROBOT_SCREEN = {
  /** Below this window width (px) the robot screen uses its phone layout. */
  phoneMaxWidth: 700,
  /** Vertical gap (px) between the top-level stacks of a loaded program. */
  stackGap: 40,
  /** Minutes between the options of the editor's time dropdowns. */
  timeStep: 10,
} as const;
