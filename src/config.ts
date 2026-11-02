/**
 * Global tuning constants. Everything that shapes the simulation lives here so gameplay
 * can be rebalanced without touching system code.
 */
import {
  Direction,
  EVERY_CHOICES,
  type ItemStack,
  type JobId,
  type MapId,
  type NpcId,
  type RobotActionKind,
  type RobotOwner,
  type RobotPartId,
  type RobotPlace,
  type RobotSize,
  type RobotUnlocks,
  type TileCoord,
  type TileRect,
  type TownsfolkId,
} from './core/types';
import type { SlopGem } from './people/slop';
import type { Leg, OutStop, Stop, Timetable, TownsfolkDay } from './people/timetable';

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
  /** The hotbar plus the first backpack row; Marigold's backpack upgrade at the general store unlocks all 36. */
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

/**
 * The number of choices for each part of a character's look: the colours in render/palette.ts
 * APPEARANCE_PALETTES, the hair styles and hats in render/playerModel.ts HAIR_STYLES and
 * HAT_STYLES. Index 0 of every list is the player's original look.
 */
export const APPEARANCE = {
  skinTones: 5,
  hairStyles: 3,
  hairColors: 6,
  shirtColors: 8,
  overallsColors: 6,
  /** 0 is the straw hat (the original look) and 1 is no hat. */
  hats: 4,
} as const;

/** The characters on screen (farmclaws part 4a spec §2.3). */
export const NPC_LOOKS = {
  /** One whole idle sway, from one side to the other and back (seconds). */
  swaySeconds: 3.2,
  /** How far the upper body leans to each side at the end of a sway (degrees). */
  swayDegrees: 2.5,
  /** Height of the nameplate's centre above the character's feet (world units; the model is ~1.1 tall with a hat). */
  nameplateHeight: 1.5,
  /** Height of the nameplate sprite (world units); its width follows the plate's aspect. */
  nameplateScale: 0.36,
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
  /** Added when job 2 is taken, because Cosmo's harvest needs them (part 4c spec §4.1). */
  job2: {
    blocks: [
      'bagFull',
      'if',
      'harvest',
      'deposit',
      'take',
      'cropIsReady',
      'soilIsDry',
      'tileIsTilled',
      'cropIs',
      'bagIsFull',
      'bagHas',
      'atEdgeOf',
      'tileAheadIs',
      'itIsRaining',
      'timeIsAfter',
      'and',
      'or',
      'not',
    ],
    cards: ['dontHarvest', 'dontDeposit'],
    tabs: [],
  },
  /** Added when job 3 is taken, for running Barnaby's team. */
  job3: {
    blocks: ['startsRaining', 'every', 'forEachTile', 'till', 'plant', 'tokensBelow', 'countInBag', 'arith'],
    cards: ['doReturn', 'doPowerDown'],
    tabs: ['stats'],
  },
} as const satisfies { readonly job1: RobotUnlocks; readonly job2: RobotUnlocks; readonly job3: RobotUnlocks };


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
  /** What new .MD card values start at: a DO return at 6:00 pm; "tokens are below" 10. */
  cardDefaults: { returnMinute: 18 * 60, tokensBelow: 10 },
} as const;

/**
 * Roof colours (sRGB hex) of the neighbours' farmhouses (farmclaws part 4a spec §5.2): the farm's
 * cottage under each farmer's own roof. Cosmo's is sunflower yellow, Barnaby's a bright blue.
 */
export const NEIGHBOUR_ROOFS = {
  cosmoHouse: 0xe9b949,
  barnabyHouse: 0x5b84c4,
} as const satisfies Readonly<Record<'cosmoHouse' | 'barnabyHouse', number>>;

/** What the characters say (farmclaws part 4a spec §3.3, §3.5). */
export const PEOPLE = {
  /** Barnaby's "4 or more robots" line holds from this many robots. */
  manyRobots: 4,
  /** Berlioz's "5 or more copper ore" line holds from this much copper ore in the inventory. */
  copperOreLine: 5,
  /** Lines in every character's everyday bank. */
  everydayLines: 6,
} as const;

/** How much each shop sells per day before it restocks the next morning (farmclaws part 4b spec §6). */
export const SHOP_STOCK = {
  /** Sol's parts: of each basic part. */
  partsPerDay: 2,
  /** Juniper's robots: of each size. */
  robotsPerSizePerDay: 1,
  /** Marigold's seeds: packets of each seed. */
  seedsPerDay: 30,
} as const;

/**
 * When the town's shops are open, as minutes of the day (farmclaws part 4d spec §5.1): one table
 * for every shop, closed over lunch and from 5:00 pm until 9:00 am.
 */
export const SHOP_HOURS: readonly { readonly opens: number; readonly closes: number }[] = [
  { opens: 9 * 60, closes: 12 * 60 },
  { opens: 13 * 60, closes: 17 * 60 },
];

/** SLOPMART's mystery boxes (farmclaws part 4d spec §6.6): the price, the odds, the daily limit and the hash salts. */
export const SLOP = {
  boxPrice: 40,
  /** The share of boxes that hold a gem rather than slop. */
  gemChance: 0.1,
  boxesPerDay: 3,
  /** What one slop item ships for. */
  slopSellPrice: 1,
  greetingSalt: 4101,
  tierSalt: 4102,
  pickSalt: 4103,
  cropSalt: 4104,
  resultSalt: 4105,
} as const;

/** What a gem box can hold (part 4d spec §6.3), in the table's order. */
export const SLOP_GEMS: readonly SlopGem[] = [
  { kind: 'item', itemId: 'spectraherb_seeds', quantity: 3 },
  { kind: 'item', itemId: 'qualitySprinkler', quantity: 1 },
  { kind: 'item', itemId: 'speedGro', quantity: 5 },
  { kind: 'item', itemId: 'qualityFertilizer', quantity: 5 },
  { kind: 'outOfSeasonSeeds', quantity: 5 },
];

/** Robot part prices (farmclaws design §3.7) and the share of a price Sol pays to buy one back (part 4b spec §3.2). */
export const PARTS = {
  prices: {
    claw: 300,
    wateringHead: 400,
    tiller: 500,
    seeder: 500,
    basket: 350,
    antenna: 600,
    sensorEye: 450,
    efficientCore: 1500,
    quickCore: 1500,
  } satisfies Readonly<Record<RobotPartId, number>>,
  sellBackShare: 0.5,
} as const;

/** The jobs (farmclaws part 4c spec §3). */
export const JOBS = {
  /** Job 1's bed is a square block of farm tiles this many tiles a side. */
  bedSize: 3,
  /**
   * Where the search for job 1's bed starts (spec §3.1): two tiles south of the workbench, so the
   * bed sits in the yard clear of the bench, the door and the bin.
   */
  bedSearchFrom: { tx: 6, tz: 6 } satisfies TileCoord,
  /** The gold each job pays when it's done (spec §3). */
  rewards: { spinningRobot: 500, showHim: 1000, knowTheLimits: 2000 } satisfies Readonly<Record<JobId, number>>,
  /**
   * Each neighbour's generator, a wood burner on the Neighbours map (spec §3.2, §3.3): their
   * robots charge overnight within ROBOTS.chargeRadius of it, and only of it (spec §5.1).
   * Barnaby's stands on the lane two tiles east of his field's gate, so the gate and the field's
   * top row are in reach of it but his Minis' starting tiles aren't.
   */
  generators: {
    cosmo: { tx: 10, tz: 13 },
    barnaby: { tx: 26, tz: 15 },
  } satisfies Readonly<Record<Exclude<RobotOwner, 'player'>, TileCoord>>,
  /** Where Cosmo's Wave stands on the lane when job 2 is taken, facing North (spec §3.2). */
  waveAt: { tx: 8, tz: 13 } satisfies TileCoord,
  /** Cosmo's field (spec §3.2): the parsnips on odd tiles, (tx + tz) odd, are this many days from ripe. */
  unripeDaysLeft: 2,
  /**
   * Where Barnaby's Minis B-1 … B-4 stand when job 3 is taken, in that order (spec §3.3):
   * scattered in and around his field.
   */
  barnabyRobots: [
    { tx: 22, tz: 18, facing: Direction.East },
    { tx: 27, tz: 22, facing: Direction.North },
    { tx: 23, tz: 14, facing: Direction.South },
    { tx: 22, tz: 23, facing: Direction.East },
  ] satisfies readonly RobotPlace[],
  /** Job 3's deadline (spec §3.3), 6:00 pm: also when Barnaby's .MD sends his team back to his generator. */
  barnabyDeadline: 18 * 60,
  /**
   * Job 3 sows this many rows of Barnaby's field, from its gate side (north) down, as Zone H: a
   * quarter of them, 4 × 3, is a day's harvest for one of his Minis with tokens to spare.
   */
  barnabyRows: 6,
  /** Job 3's budget (spec §3.3): Barnaby's team may spend at most this many tokens a sown crop of his field in the day. */
  tokensPerCrop: 6,
} as const;

/** A minute of the day: `hour` in 24-hour time. */
const clock = (hour: number, minute = 0): number => hour * 60 + minute;
const spot = (mapId: MapId, tx: number, tz: number, facing: Direction): OutStop => ({ kind: 'spot', mapId, tx, tz, facing });
const HOME: Stop = { kind: 'home' };

/** A tradie's stops (farmclaws part 4d spec §2.2): their 4a spot is work. */
interface TradieStops {
  readonly door: TileCoord;
  readonly morningAt: number;
  readonly morning: Stop;
  readonly work: Stop;
  readonly lunch: Stop;
  readonly evening: Stop;
  /** When a wet day's first leg goes to work: 8:30 am, but Sol's 6:00 am. */
  readonly wetWorkAt: number;
}

/**
 * A tradie's day (spec §2.2). Dry: the morning stop, work at 8:30 am, lunch in the square at
 * 12:00 pm, work again at 12:50 pm, the evening stop at 5:00 pm, home at 7:00 pm. Wet: they stay
 * in until work and spend lunch and the evening indoors.
 */
function tradieDay(stops: TradieStops): Timetable {
  const { work } = stops;
  return {
    home: { mapId: 'town', door: stops.door },
    dry: [
      { departs: stops.morningAt, to: stops.morning },
      { departs: clock(8, 30), to: work },
      { departs: clock(12), to: stops.lunch },
      { departs: clock(12, 50), to: work },
      { departs: clock(17), to: stops.evening },
      { departs: clock(19), to: HOME },
    ],
    wet: [
      { departs: stops.wetWorkAt, to: work },
      { departs: clock(12), to: HOME },
      { departs: clock(12, 50), to: work },
      { departs: clock(17), to: HOME },
    ],
  };
}

/**
 * A farmer's day (spec §2.3). Dry: beside the field from 6:00 am, lunch in town, the field again
 * at 1:00 pm, their 4a spot on the lane at 6:00 pm, home at 8:00 pm. Wet: no lunch in town, so the
 * field leg runs until 6:00 pm.
 */
function farmerDay(door: TileCoord, field: Stop, lunch: Leg, lane: Stop): Timetable {
  const evening: readonly Leg[] = [
    { departs: clock(18), to: lane },
    { departs: clock(20), to: HOME },
  ];
  const morning: Leg = { departs: clock(6), to: field };
  return {
    home: { mapId: 'neighbours', door },
    dry: [morning, lunch, { departs: clock(13), to: field }, ...evening],
    wet: [morning, ...evening],
  };
}

/** The cast's days (farmclaws part 4d spec §2): each character's home door and their dry-day and wet-day legs. */
export const TIMETABLES: Readonly<Record<NpcId, Timetable>> = {
  sol: tradieDay({
    door: { tx: 20, tz: 6 },
    morningAt: clock(6),
    morning: spot('town', 21, 13, Direction.West),
    work: spot('town', 21, 7, Direction.South),
    lunch: spot('town', 19, 12, Direction.South),
    evening: spot('town', 14, 22, Direction.South),
    // Sol is out at 6:00 am on a wet day too, so job 1 can still be found on a wet first morning.
    wetWorkAt: clock(6),
  }),
  tallulah: tradieDay({
    door: { tx: 34, tz: 6 },
    morningAt: clock(6, 30),
    morning: spot('town', 34, 12, Direction.North),
    work: spot('town', 35, 7, Direction.South),
    lunch: spot('town', 21, 14, Direction.West),
    evening: spot('town', 33, 16, Direction.North),
    wetWorkAt: clock(8, 30),
  }),
  marigold: tradieDay({
    door: { tx: 6, tz: 6 },
    morningAt: clock(7),
    morning: spot('town', 8, 22, Direction.South),
    work: spot('town', 7, 7, Direction.South),
    lunch: spot('town', 18, 13, Direction.East),
    evening: spot('town', 5, 16, Direction.South),
    wetWorkAt: clock(8, 30),
  }),
  berlioz: tradieDay({
    door: { tx: 15, tz: 6 },
    morningAt: clock(7),
    morning: spot('town', 16, 23, Direction.South),
    work: spot('town', 16, 7, Direction.South),
    lunch: spot('town', 18, 14, Direction.East),
    evening: spot('town', 20, 12, Direction.South),
    wetWorkAt: clock(8, 30),
  }),
  juniper: tradieDay({
    door: { tx: 25, tz: 6 },
    morningAt: clock(7, 30),
    morning: spot('town', 18, 14, Direction.East),
    work: spot('town', 24, 7, Direction.South),
    lunch: spot('town', 21, 13, Direction.West),
    evening: spot('town', 26, 22, Direction.South),
    wetWorkAt: clock(8, 30),
  }),
  cosmo: farmerDay(
    { tx: 5, tz: 4 },
    {
      kind: 'pace',
      mapId: 'neighbours',
      spots: [
        { tx: 11, tz: 10 },
        { tx: 16, tz: 7 },
        { tx: 4, tz: 13 },
      ],
      facing: Direction.West,
      everyMinutes: 20,
    },
    { departs: clock(11, 15), to: spot('town', 19, 15, Direction.North) },
    spot('neighbours', 7, 13, Direction.South),
  ),
  barnaby: farmerDay(
    { tx: 26, tz: 4 },
    {
      kind: 'pace',
      mapId: 'neighbours',
      spots: [
        { tx: 30, tz: 18 },
        { tx: 30, tz: 22 },
        { tx: 19, tz: 20 },
      ],
      facing: Direction.West,
      everyMinutes: 25,
    },
    { departs: clock(11, 5), to: spot('town', 20, 15, Direction.North) },
    spot('neighbours', 25, 15, Direction.North),
  ),
};

/** The town's two south exits (spec §3.1): the south-west and south-east corners of the river's south bank. */
const SOUTH_WEST_EXIT: TileCoord = { tx: 0, tz: 30 };
const SOUTH_EAST_EXIT: TileCoord = { tx: 39, tz: 30 };

/** A townsperson's loop of several spots, walked in order, moving on every `everyMinutes`; they keep the facing they walked in with. */
const loop = (everyMinutes: number, ...spots: readonly TileCoord[]): OutStop => ({ kind: 'pace', mapId: 'town', spots, facing: null, everyMinutes });

/**
 * The townsfolk (farmclaws part 4d spec §3.1, §3.2): out at 8:00 am to their loop, home at
 * 7:00 pm, by their exit. On a wet day only the jogger and the courier come out ("rain or shine").
 */
export const TOWNSFOLK = {
  outAt: clock(8),
  homeAt: clock(19),
  days: {
    jogger: { exit: SOUTH_WEST_EXIT, loop: loop(35, { tx: 3, tz: 22 }, { tx: 36, tz: 22 }), rainOrShine: true },
    dogWalker: {
      exit: SOUTH_WEST_EXIT,
      loop: loop(15, { tx: 14, tz: 9 }, { tx: 25, tz: 10 }, { tx: 25, tz: 18 }, { tx: 14, tz: 18 }),
      rainOrShine: false,
    },
    retiree: { exit: SOUTH_EAST_EXIT, loop: spot('town', 17, 21, Direction.South), rainOrShine: false },
    courier: {
      exit: SOUTH_EAST_EXIT,
      loop: loop(30, { tx: 7, tz: 8 }, { tx: 16, tz: 8 }, { tx: 24, tz: 8 }, { tx: 35, tz: 8 }),
      rainOrShine: true,
    },
    busker: { exit: SOUTH_WEST_EXIT, loop: spot('town', 18, 12, Direction.South), rainOrShine: false },
    kid: { exit: SOUTH_EAST_EXIT, loop: loop(25, { tx: 29, tz: 8 }, { tx: 31, tz: 9 }), rainOrShine: false },
  } satisfies Readonly<Record<TownsfolkId, TownsfolkDay>>,
} as const;

/**
 * The walk (farmclaws part 4d spec §4.2): how many planned moves each map's world remembers. The
 * walkers walk the same routes every day, so most minutes' plans were already made on an earlier
 * day; past this many the world forgets them all and starts again.
 */
export const WALK = {
  plansPerWorld: 4096,
} as const;
