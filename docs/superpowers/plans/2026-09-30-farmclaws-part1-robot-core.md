# Farmclaws Part 1: Robot Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put working, failing and recoverable farm robots into the simulation, the save and the scene: robot state, the executor, minute-by-minute running with bickering, mistakes, carrying and repairs, the token pool and wood burner, save version 4, the robot renderer, the HUD token count and development hooks.

**Architecture:** Robots live in a new `robots` section of `GameState`. A pure executor in `src/robots/` plans each robot action against the same tile rules as the player's tools, and applies it inside the reducer's `time/tick`, which now advances one minute at a time. Overnight steps run inside `startNextDay`. Rendering is one new instanced `RobotRenderer`. There's no way to get a robot in normal play until part 4; tests and a development-only hook add them.

**Tech Stack:** TypeScript (strict, `erasableSyntaxOnly`), Three.js, Vite, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-29-farmclaws-part1-robot-core.md`, within the umbrella design `docs/superpowers/specs/2026-09-29-farmclaws-design.md`. Read both before starting.

## Global Constraints

- The simulation stays pure and deterministic: no `Math.random`, no clock reads and no I/O in `src/core`, `src/state`, `src/world`, `src/farming`, `src/time` or `src/robots`. Randomness only through `hash32` / `hashFloat`.
- Strict TypeScript with `erasableSyntaxOnly`: no enums, no namespaces, no parameter properties, `as const` objects plus union types, `import type` for types. `noUnusedLocals` and `noUnusedParameters` are on, and `tests/` is typechecked too.
- No TODOs, placeholders or stubs.
- `npm run typecheck`, `npm test` and `npm run build` pass after every task.
- State is immutable, with structural sharing: an unchanged robot, chunk or tile keeps its reference.
- A robot does exactly what its script says. Nothing random happens to a robot in part 1.
- Robots work on the farm map only. They stay where they finish; nothing moves them home.
- Robot speech (`robotSays`) always ends in " ✓", even for failures. Only `whatHappened` and toasts tell the truth.
- Numbers come from `ROBOTS` and `GENERATORS` in `src/config.ts`, never inline.
- Commit messages end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Passing out or skipping the night while carrying a robot.** The robot must be set down on the spawn tile, `player.carrying` cleared and the save still valid. Pinned in Task 9.
2. **One big 16× tick that crosses the pass-out minute with robots mid-script.** It must give exactly the same state as the same minutes ticked one at a time. Pinned in Task 8.
3. **Two robots taking from a chest in the same minute when it holds only enough for one.** The first gets it, the second is blocked, and both pay. Pinned in Task 8.
4. **Weeds or a giant crop appearing overnight under a standing robot, or a broken robot carried onto land.** The robot moves to the nearest walkable tile and the save stays loadable. Pinned in Task 9.
5. **Saving and loading while a robot is carried, repairing, broken or mid-`wait` past midnight.** The game must load to an identical state. Pinned in Task 2.

---

## File map

| File | Responsibility |
| --- | --- |
| `src/core/types.ts` | Robot, action, log and section types; `woodBurner` object; `PlayerState.carrying`; `SAVE_VERSION = 4` |
| `src/config.ts` | `ROBOTS` and `GENERATORS` |
| `src/robots/parts.ts` | Which part each action needs; the action kind list |
| `src/robots/stats.ts` | Derived numbers: battery, bag, period, costs, repair, carry energy |
| `src/robots/world.ts` | Finding and replacing robots, robots on a tile, containers, nearest walkable tile |
| `src/robots/bag.ts` | Bag and chest slot arithmetic |
| `src/robots/log.ts` | Appending, collapsing and pruning farm log entries |
| `src/robots/execute.ts` | `planRobotAction`, `applyRobotPlan`, `applyBickerPlan` |
| `src/robots/create.ts` | `addRobot` and spec checks |
| `src/robots/run.ts` | `runRobotsMinute`, `runRobotsThrough`, going flat |
| `src/robots/overnight.ts` | Generators, set-down, repairs, recharge, morning reset |
| `src/robots/logText.ts` | `robotSays`, `whatHappened` |
| `src/farming/harvest.ts` | `harvestedTile`, extracted from the reducer |
| `src/state/robotValidation.ts` | Save validation for the robots section and robot programs |
| `src/state/persistence.ts` | v3 → v4 migration, player and robot validation hooks |
| `src/state/intents.ts` | Carry, repair and fuel intents; harvest functions take a map id; robot placement block |
| `src/state/reducer.ts` | Minute-by-minute tick, overnight robots, new intents, warp refusal |
| `src/render/robotLayout.ts` | Pure render rules: meshes per robot, poses, clips, offsets, timings |
| `src/render/robotGeometry.ts` | Robot, badge and particle geometry |
| `src/render/RobotRenderer.ts` | The instanced robot render system |
| `src/render/objectGeometry.ts`, `objectLayout.ts`, `TileHighlighter.ts` | Wood burner geometry and ghost |
| `src/render/PlayerRenderer.ts` | Carry pose |
| `src/ui/icons.ts`, `src/ui/Hud.ts`, `src/ui/hud.css` | Wood burner icon, bolt icon, token count |
| `src/dev/robotDev.ts` | Development-only presets, `addRobot`, `robotLog` |
| `src/main.ts` | Registers RobotRenderer and the dev hook |

---

### Task 1: Robot types, configuration and derived numbers

**Files:**
- Modify: `src/core/types.ts` (new section before "Sections for later workstreams")
- Modify: `src/config.ts` (append)
- Create: `src/robots/parts.ts`, `src/robots/stats.ts`
- Test: `tests/robotStats.test.ts`

**Interfaces:**
- Produces: types `RobotSize`, `RobotPartId`, `RobotPower`, `RobotAction`, `RobotActionKind`, `RobotScript`, `RobotProgram`, `RobotPlace`, `RobotActionEvent`, `Robot`, `RobotBlockReason`, `RobotDidDetail`, `RobotLogEvent`, `RobotLogEntry`, `RobotsState`; lists `ROBOT_SIZES`, `ROBOT_PART_IDS`, `ROBOT_POWERS`, `ROBOT_BLOCK_REASONS`, `ROBOT_LOG_EVENT_KINDS`; `ROBOTS`, `GENERATORS`; `PART_ACTIONS`, `ROBOT_ACTION_KINDS`, `canDo(robot, kind)`; `hasPart`, `batteryFor`, `bagStacks`, `periodFor`, `repairCost`, `carryEnergyFor`, `actionCost`.

- [ ] **Step 1: Add the robot types to `src/core/types.ts`**

Insert this block after the `MessageLog` interface and before the `// Sections for later workstreams` banner:

```ts
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

/** What a robot's power is doing. Being carried is separate (`Robot.carried`). */
export const ROBOT_POWERS = ['working', 'standby', 'flat', 'broken', 'repairing'] as const;
export type RobotPower = (typeof ROBOT_POWERS)[number];

/**
 * One robot action. `water`, `harvest`, `till` and `plant` work the robot's own tile;
 * `move`, `refill`, `deposit` and `take` work the tile ahead.
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
/** Part 2 widens this union with block programs. */
export type RobotProgram = RobotScript;

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
  readonly program: RobotProgram;
  /** Index of the next script step. */
  readonly pc: number;
  /** The next minute of the day it acts in. */
  readonly nextActMinute: number;
  /** Absolute day it comes back from repair; null unless power is 'repairing'. */
  readonly repairReadyDay: number | null;
  /** Tokens spent today; reset each morning. */
  readonly tokensToday: number;
  /** Render counters, like PlayerState's. */
  readonly moveSeq: number;
  readonly teleportSeq: number;
  readonly actionSeq: number;
  readonly lastAction: RobotActionEvent | null;
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
] as const;

export type RobotLogEvent =
  | { readonly kind: 'did'; readonly action: RobotActionKind; readonly detail: RobotDidDetail }
  | { readonly kind: 'blocked'; readonly action: RobotActionKind; readonly reason: RobotBlockReason }
  | { readonly kind: 'bickered'; readonly action: RobotActionKind; readonly withIds: readonly number[] }
  | { readonly kind: 'shortedOut' }
  | { readonly kind: 'flat' }
  | { readonly kind: 'finished' }
  | { readonly kind: 'poweredDown' }
  | { readonly kind: 'repaired' };

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
}
```

- [ ] **Step 2: Add `ROBOTS` and `GENERATORS` to `src/config.ts`**

Change the first import line to:

```ts
import { Direction, type ItemStack, type RobotActionKind, type RobotSize, type TileCoord, type TileRect } from './core/types';
```

Append to the end of the file:

```ts
/** One robot size (farmclaws design §3.6). */
export interface RobotSizeSpec {
  readonly price: number;
  readonly battery: number;
  readonly bagStacks: number;
  readonly partSlots: number;
  readonly costMultiplier: number;
}

const ROBOT_SIZE_SPECS = {
  mini: { price: 1500, battery: 80, bagStacks: 1, partSlots: 1, costMultiplier: 1 },
  standard: { price: 4000, battery: 200, bagStacks: 3, partSlots: 2, costMultiplier: 2 },
  big: { price: 10000, battery: 500, bagStacks: 9, partSlots: 3, costMultiplier: 4 },
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
} as const;

export const GENERATORS = {
  woodBurner: { hopper: 10, tokensPerWood: 6 },
} as const;
```

- [ ] **Step 3: Write the failing test `tests/robotStats.test.ts`**

```ts
/**
 * Robot derived numbers (src/robots/stats.ts) and part gating (src/robots/parts.ts).
 */
import { describe, expect, it } from 'vitest';
import type { RobotPartId, RobotSize } from '../src/core/types';
import { PART_ACTIONS, ROBOT_ACTION_KINDS, canDo } from '../src/robots/parts';
import { actionCost, bagStacks, batteryFor, carryEnergyFor, periodFor, repairCost } from '../src/robots/stats';

const body = (size: RobotSize, parts: readonly RobotPartId[] = []) => ({ size, parts });

describe('robot stats', () => {
  it('scales action costs by size, with the efficient core rounding down to at least 1', () => {
    expect(actionCost(body('mini'), 'harvest')).toBe(3);
    expect(actionCost(body('standard'), 'harvest')).toBe(6);
    expect(actionCost(body('big'), 'harvest')).toBe(12);
    expect(actionCost(body('big', ['efficientCore']), 'harvest')).toBe(9);
    expect(actionCost(body('mini', ['efficientCore']), 'move')).toBe(1);
    expect(actionCost(body('big'), 'wait')).toBe(0);
    expect(actionCost(body('big'), 'powerDown')).toBe(0);
    expect(actionCost(body('standard'), 'till')).toBe(10);
  });

  it('derives battery, bag, period, repair and carry numbers', () => {
    expect([batteryFor('mini'), batteryFor('standard'), batteryFor('big')]).toEqual([80, 200, 500]);
    expect(bagStacks(body('mini'))).toBe(1);
    expect(bagStacks(body('mini', ['basket']))).toBe(3);
    expect(bagStacks(body('standard', ['basket']))).toBe(5);
    expect(periodFor(body('mini'))).toBe(4);
    expect(periodFor(body('mini', ['quickCore']))).toBe(3);
    expect([repairCost(body('mini')), repairCost(body('standard')), repairCost(body('big'))]).toEqual([300, 800, 2000]);
    expect([carryEnergyFor(body('mini')), carryEnergyFor(body('big'))]).toEqual([4, 16]);
  });

  it('gates actions on parts', () => {
    expect(ROBOT_ACTION_KINDS).toHaveLength(12);
    expect(new Set(ROBOT_ACTION_KINDS).size).toBe(12);
    expect(canDo(body('mini', ['claw']), 'water')).toBe(false);
    expect(canDo(body('mini', ['claw']), 'move')).toBe(true);
    expect(canDo(body('mini', ['wateringHead']), 'water')).toBe(true);
    expect(canDo(body('mini', ['wateringHead']), 'refill')).toBe(true);
    expect(PART_ACTIONS.plant).toBe('seeder');
    expect(PART_ACTIONS.till).toBe('tiller');
  });
});
```

- [ ] **Step 4: Run it to see it fail**

Run: `npx vitest run tests/robotStats.test.ts`
Expected: FAIL, "Failed to resolve import ../src/robots/parts".

- [ ] **Step 5: Create `src/robots/parts.ts`**

```ts
/**
 * Which part each robot action needs (farmclaws design §3.7). Keyed by every action kind, so
 * the compiler keeps ROBOT_ACTION_KINDS in step with the RobotAction union.
 */
import type { Robot, RobotActionKind, RobotPartId } from '../core/types';

export const PART_ACTIONS = {
  move: null,
  turn: null,
  say: null,
  wait: null,
  powerDown: null,
  harvest: 'claw',
  deposit: 'claw',
  take: 'claw',
  water: 'wateringHead',
  refill: 'wateringHead',
  till: 'tiller',
  plant: 'seeder',
} as const satisfies Readonly<Record<RobotActionKind, RobotPartId | null>>;

/** Every action kind, each once. */
export const ROBOT_ACTION_KINDS = Object.keys(PART_ACTIONS) as readonly RobotActionKind[];

/** Whether the robot has the part `kind` needs (built-in actions always pass). */
export function canDo(robot: Pick<Robot, 'parts'>, kind: RobotActionKind): boolean {
  const part: RobotPartId | null = PART_ACTIONS[kind];
  return part === null || robot.parts.includes(part);
}
```

- [ ] **Step 6: Create `src/robots/stats.ts`**

```ts
/**
 * Numbers derived from a robot's size and parts (farmclaws part 1 spec §3.3). Pure.
 */
import { ROBOTS } from '../config';
import type { Robot, RobotActionKind, RobotPartId, RobotSize } from '../core/types';

export type RobotBody = Pick<Robot, 'size' | 'parts'>;

export function hasPart(robot: Pick<Robot, 'parts'>, part: RobotPartId): boolean {
  return robot.parts.includes(part);
}

export function batteryFor(size: RobotSize): number {
  return ROBOTS.sizes[size].battery;
}

export function bagStacks(robot: RobotBody): number {
  return ROBOTS.sizes[robot.size].bagStacks + (hasPart(robot, 'basket') ? ROBOTS.basketExtraStacks : 0);
}

/** Minutes between a robot's actions. */
export function periodFor(robot: Pick<Robot, 'parts'>): number {
  return hasPart(robot, 'quickCore') ? ROBOTS.quickCorePeriod : ROBOTS.period;
}

export function repairCost(robot: Pick<Robot, 'size'>): number {
  return Math.round(ROBOTS.sizes[robot.size].price * ROBOTS.repairShare);
}

export function carryEnergyFor(robot: Pick<Robot, 'size'>): number {
  return ROBOTS.carryEnergy[robot.size];
}

/** Tokens an action costs: 0 stays 0; otherwise base × size, × 0.75 with an efficient core, floored, at least 1. */
export function actionCost(robot: RobotBody, kind: RobotActionKind): number {
  const base: number = ROBOTS.cost[kind];
  if (base === 0) return 0;
  const factor = hasPart(robot, 'efficientCore') ? ROBOTS.efficientCoreFactor : 1;
  return Math.max(1, Math.floor(base * ROBOTS.sizes[robot.size].costMultiplier * factor));
}
```

- [ ] **Step 7: Run the test, typecheck, full suite**

Run: `npx vitest run tests/robotStats.test.ts && npm run typecheck && npm test`
Expected: PASS everywhere.

- [ ] **Step 8: Commit**

```bash
git add src/core/types.ts src/config.ts src/robots/parts.ts src/robots/stats.ts tests/robotStats.test.ts
git commit -m "Farmclaws part 1: robot types, config and derived numbers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Save version 4

**Files:**
- Modify: `src/core/types.ts` (`PlayerState`, `GameSections`, `SAVE_VERSION`)
- Modify: `src/state/initialState.ts`
- Create: `src/state/robotValidation.ts`
- Modify: `src/state/persistence.ts`
- Modify: `tests/testUtils.ts`, `tests/persistence.test.ts:159`, `tests/maps.test.ts:821`, `tests/reducer.test.ts:1019`
- Test: `tests/robotSave.test.ts`

**Interfaces:**
- Consumes: Task 1 types, `ROBOTS`, `ROBOT_ACTION_KINDS`, `batteryFor`, `bagStacks`.
- Produces: `GameState.robots: RobotsState`; `PlayerState.carrying: number | null`; `isValidRobotProgram(v): v is RobotProgram`; `isValidRobotAction(v): v is RobotAction`; `isValidRobotsSection(v, maps, player): boolean`; test helpers `robotOf(overrides?: Partial<Robot>): Robot` (a working Mini with a claw on `TARGET`, facing South, 80 tokens, script `[turn right]` looping) and `withRobots(state, robots): GameState`.

- [ ] **Step 1: Change the types**

In `src/core/types.ts`:
- Set `export const SAVE_VERSION = 4 as const;`
- In `PlayerState`, after `lastAction`, add:

```ts
  /** Id of the robot the player is carrying, or null (farmclaws part 1 §5.8). */
  readonly carrying: number | null;
```

- In `GameSections`, after `festival`, add:

```ts
  readonly robots: RobotsState;
```

- [ ] **Step 2: Defaults in `src/state/initialState.ts`**

In `createDefaultSections()`, add after `festival`:

```ts
    robots: { nextId: 1, list: [], pool: 0, log: { nextId: 0, entries: [] }, lastNightFuel: { wood: 0, tokens: 0 } },
```

In `createInitialState`, add `carrying: null,` after `lastAction: null,` in `player`.

- [ ] **Step 3: Create `src/state/robotValidation.ts`**

```ts
/**
 * Save validation for the robots section (farmclaws part 1 spec §6.2). Every check is a type
 * guard that returns false on any unexpected shape and never throws.
 */
import { ROBOTS, TIME } from '../config';
import {
  Blocker,
  CROP_IDS,
  QUALITIES,
  ROBOT_BLOCK_REASONS,
  ROBOT_LOG_EVENT_KINDS,
  ROBOT_PART_IDS,
  ROBOT_POWERS,
  ROBOT_SIZES,
  type GameState,
  type RobotAction,
  type RobotPartId,
  type RobotProgram,
  type WorldState,
} from '../core/types';
import { isItemId } from '../items/items';
import { ROBOT_ACTION_KINDS } from '../robots/parts';
import { bagStacks, batteryFor } from '../robots/stats';
import { inBounds } from '../world/grid';
import { getTile, isWalkable } from '../world/tiles';
import { isValidName } from './sectionValidation';
import { hasExactKeys, isBool, isCanonicalSubset, isCount, isInt, isIntIn, isObj, isOneOf, isValidStack } from './validation';

const MAX = Number.MAX_SAFE_INTEGER;

const ROBOT_KEYS = [
  'id', 'name', 'size', 'parts', 'tx', 'tz', 'facing', 'bag', 'tank', 'tokens', 'power', 'carried', 'program', 'pc',
  'nextActMinute', 'repairReadyDay', 'tokensToday', 'moveSeq', 'teleportSeq', 'actionSeq', 'lastAction',
] as const;

export function isValidRobotAction(v: unknown): v is RobotAction {
  if (!isObj(v) || typeof v.kind !== 'string') return false;
  switch (v.kind) {
    case 'move':
    case 'water':
    case 'harvest':
    case 'till':
    case 'refill':
    case 'deposit':
    case 'powerDown':
      return hasExactKeys(v, ['kind']);
    case 'turn':
      return hasExactKeys(v, ['kind', 'side']) && (v.side === 'left' || v.side === 'right');
    case 'plant':
      return hasExactKeys(v, ['kind', 'cropId']) && isOneOf(v.cropId, CROP_IDS);
    case 'take':
      return hasExactKeys(v, ['kind', 'itemId']) && isItemId(v.itemId);
    case 'say': {
      if (!hasExactKeys(v, ['kind', 'text']) || typeof v.text !== 'string' || v.text.trim() !== v.text) return false;
      const length = Array.from(v.text).length;
      return length >= 1 && length <= ROBOTS.sayMaxLength;
    }
    case 'wait':
      return hasExactKeys(v, ['kind', 'minutes']) && isIntIn(v.minutes, 1, ROBOTS.maxWaitMinutes);
    default:
      return false;
  }
}

export function isValidRobotProgram(v: unknown): v is RobotProgram {
  return (
    isObj(v) &&
    hasExactKeys(v, ['kind', 'steps', 'loop']) &&
    v.kind === 'script' &&
    isBool(v.loop) &&
    Array.isArray(v.steps) &&
    v.steps.length >= 1 &&
    v.steps.length <= ROBOTS.maxScriptSteps &&
    v.steps.every(isValidRobotAction)
  );
}

function isValidDetail(v: unknown): boolean {
  if (!isObj(v)) return false;
  switch (v.kind) {
    case 'none':
    case 'tile':
      return hasExactKeys(v, ['kind']);
    case 'crop':
      return hasExactKeys(v, ['kind', 'cropId', 'quantity', 'quality']) && isOneOf(v.cropId, CROP_IDS) && isIntIn(v.quantity, 1, MAX) && isOneOf(v.quality, QUALITIES);
    case 'planted':
      return hasExactKeys(v, ['kind', 'cropId']) && isOneOf(v.cropId, CROP_IDS);
    case 'items':
      return (
        hasExactKeys(v, ['kind', 'into', 'stacks', 'quantity']) &&
        isOneOf(v.into, ['chest', 'bin', 'bag']) &&
        isIntIn(v.stacks, 1, MAX) &&
        isIntIn(v.quantity, 1, MAX)
      );
    default:
      return false;
  }
}

function isValidLogEvent(v: unknown): boolean {
  if (!isObj(v) || !isOneOf(v.kind, ROBOT_LOG_EVENT_KINDS)) return false;
  switch (v.kind) {
    case 'did':
      return hasExactKeys(v, ['kind', 'action', 'detail']) && isOneOf(v.action, ROBOT_ACTION_KINDS) && isValidDetail(v.detail);
    case 'blocked':
      return hasExactKeys(v, ['kind', 'action', 'reason']) && isOneOf(v.action, ROBOT_ACTION_KINDS) && isOneOf(v.reason, ROBOT_BLOCK_REASONS);
    case 'bickered':
      return (
        hasExactKeys(v, ['kind', 'action', 'withIds']) &&
        isOneOf(v.action, ROBOT_ACTION_KINDS) &&
        Array.isArray(v.withIds) &&
        v.withIds.length >= 1 &&
        v.withIds.every((id: unknown) => isIntIn(id, 1, MAX))
      );
    default:
      return hasExactKeys(v, ['kind']);
  }
}

function isValidLog(v: unknown, farm: WorldState): boolean {
  if (!isObj(v) || !hasExactKeys(v, ['nextId', 'entries']) || !isCount(v.nextId) || !Array.isArray(v.entries)) return false;
  if (v.entries.length > ROBOTS.logCapacity) return false;
  let previous = -1;
  for (const entry of v.entries as readonly unknown[]) {
    if (
      !isObj(entry) ||
      !hasExactKeys(entry, ['id', 'day', 'minute', 'robotId', 'tx', 'tz', 'event', 'count']) ||
      !isIntIn(entry.id, previous + 1, v.nextId - 1) ||
      !isCount(entry.day) ||
      !isIntIn(entry.minute, TIME.dayStartMinute, TIME.passOutMinute) ||
      !isIntIn(entry.robotId, 1, MAX) ||
      !isInt(entry.tx) ||
      !isInt(entry.tz) ||
      !inBounds(farm.grid, entry.tx, entry.tz) ||
      !isIntIn(entry.count, 1, MAX) ||
      !isValidLogEvent(entry.event)
    ) {
      return false;
    }
    previous = entry.id;
  }
  return true;
}

function isValidLastAction(v: unknown, actionSeq: number): boolean {
  if (v === null) return true;
  return (
    isObj(v) &&
    hasExactKeys(v, ['seq', 'kind', 'success', 'bickered']) &&
    v.seq === actionSeq &&
    isOneOf(v.kind, ROBOT_ACTION_KINDS) &&
    isBool(v.success) &&
    isBool(v.bickered)
  );
}

function isValidRobot(v: unknown, farm: WorldState): boolean {
  if (!isObj(v) || !hasExactKeys(v, ROBOT_KEYS)) return false;
  if (!isIntIn(v.id, 1, MAX) || !isValidName(v.name) || !isOneOf(v.size, ROBOT_SIZES)) return false;
  if (!isCanonicalSubset(v.parts, ROBOT_PART_IDS) || v.parts.length > ROBOTS.sizes[v.size].partSlots) return false;
  const parts: readonly RobotPartId[] = v.parts;
  if (!isInt(v.tx) || !isInt(v.tz) || !inBounds(farm.grid, v.tx, v.tz) || !isIntIn(v.facing, 0, 3)) return false;
  if (!Array.isArray(v.bag) || v.bag.length > bagStacks({ size: v.size, parts }) || !v.bag.every((s: unknown) => isValidStack(s, true))) return false;
  if (!isIntIn(v.tank, 0, ROBOTS.tankCapacity) || (v.tank > 0 && !parts.includes('wateringHead'))) return false;
  if (!isIntIn(v.tokens, 0, batteryFor(v.size)) || !isCount(v.tokensToday)) return false;
  if (!isOneOf(v.power, ROBOT_POWERS) || !isBool(v.carried)) return false;
  if (!isValidRobotProgram(v.program) || !isIntIn(v.pc, 0, v.program.steps.length - 1)) return false;
  if (!isIntIn(v.nextActMinute, TIME.dayStartMinute, TIME.passOutMinute + ROBOTS.maxWaitMinutes)) return false;
  if (!isCount(v.moveSeq) || !isCount(v.teleportSeq) || !isCount(v.actionSeq)) return false;
  if (!isValidLastAction(v.lastAction, v.actionSeq)) return false;
  if (v.power === 'repairing') return isCount(v.repairReadyDay) && !v.carried;
  if (v.repairReadyDay !== null) return false;
  if (v.carried) return true;
  const tile = getTile(farm, v.tx, v.tz);
  if (tile === null) return false;
  if (v.power === 'broken') return tile.blocker === Blocker.Water || isWalkable(tile);
  return isWalkable(tile);
}

/**
 * The robots section: ids unique, ascending and below nextId; at most maxRobots; every robot
 * valid on the farm; the carried robot (if any) matches `player.carrying` and the player is on
 * the farm; the pool, last night's fuel and the log valid.
 */
export function isValidRobotsSection(v: unknown, maps: GameState['maps'], player: unknown): boolean {
  if (!isObj(v) || !hasExactKeys(v, ['nextId', 'list', 'pool', 'log', 'lastNightFuel']) || !isObj(player)) return false;
  if (!isIntIn(v.nextId, 1, MAX) || !Array.isArray(v.list) || v.list.length > ROBOTS.maxRobots) return false;
  let previous = 0;
  let carried = 0;
  for (const robot of v.list as readonly unknown[]) {
    if (!isValidRobot(robot, maps.farm) || !isObj(robot) || !isInt(robot.id)) return false;
    if (robot.id <= previous || robot.id >= v.nextId) return false;
    previous = robot.id;
    if (robot.carried === true) {
      carried++;
      if (player.carrying !== robot.id || player.mapId !== 'farm') return false;
    }
  }
  if (carried !== (player.carrying === null ? 0 : 1)) return false;
  const fuel = v.lastNightFuel;
  if (!isCount(v.pool) || !isObj(fuel) || !hasExactKeys(fuel, ['wood', 'tokens']) || !isCount(fuel.wood) || !isCount(fuel.tokens)) return false;
  return isValidLog(v.log, maps.farm);
}
```

- [ ] **Step 4: Wire it into `src/state/persistence.ts`**

1. Import it: `import { isValidRobotsSection } from './robotValidation';`
2. In `isValidPlayer`, extend the big condition with a `carrying` check. Change the line `!isCount(player.actionSeq)` to:

```ts
    !isCount(player.actionSeq) ||
    !(player.carrying === null || isIntIn(player.carrying, 1, Number.MAX_SAFE_INTEGER))
```

3. In `isValidGameState`, after `isValidSections(v)` add `&& isValidRobotsSection(v.robots, v.maps, v.player)`.
4. Add the migration above `migrateSave`:

```ts
/** Version 3 predates robots: the robots section starts empty and the player carries nothing. */
function migrateV3toV4(save: Obj): Obj {
  if (!isObj(save.player)) return save;
  return { ...save, version: 4, robots: createDefaultSections().robots, player: { ...save.player, carrying: null } };
}
```

5. In `migrateSave`, after the v2 line add: `if (isObj(v) && v.version === 3) v = migrateV3toV4(v);`

- [ ] **Step 5: Update the test helpers in `tests/testUtils.ts`**

Add `ROBOTS`-free imports as needed: extend the types import with `type Robot`, and add `TIME` to the config import (`import { INVENTORY, TIME } from '../src/config';`). Then:

1. In `legacySave`, after `delete (save.player as SaveJson).mapId;` add `delete (save.player as SaveJson).carrying;`
2. In `livelySections()`, add `robots: createDefaultSections().robots,` after `festival`.
3. Append:

```ts
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
    program: { kind: 'script', steps: [{ kind: 'turn', side: 'right' }], loop: true },
    pc: 0,
    nextActMinute: TIME.dayStartMinute + 4,
    repairReadyDay: null,
    tokensToday: 0,
    moveSeq: 0,
    teleportSeq: 0,
    actionSeq: 0,
    lastAction: null,
    ...overrides,
  };
}

/** Replaces the robot list (ascending ids) and sets nextId past the highest id. */
export function withRobots(state: GameState, robots: readonly Robot[]): GameState {
  const nextId = robots.reduce((max, robot) => Math.max(max, robot.id), 0) + 1;
  return { ...state, robots: { ...state.robots, list: robots, nextId } };
}
```

- [ ] **Step 6: Update the three existing tests that pin the old shape**

- `tests/persistence.test.ts:159`: `expect(SAVE_VERSION).toBe(4);`
- `tests/maps.test.ts:821`: `expect(migrated.version).toBe(4);`
- `tests/reducer.test.ts:1019` (the `state.player` `toEqual` block): add `carrying: null,` after `lastAction: null,`.

- [ ] **Step 7: Write the failing test `tests/robotSave.test.ts`**

```ts
/**
 * Save version 4: the robots section, player.carrying, the v3 → v4 migration and validation.
 */
import { describe, expect, it } from 'vitest';
import { TIME } from '../src/config';
import { Blocker, Direction, type GameState, type Robot } from '../src/core/types';
import { deserializeGame, migrateSave, serializeGame } from '../src/state/persistence';
import { blockedTile } from '../src/world/tiles';
import saveV2Text from './fixtures/save-v2.json?raw';
import { BASE, TARGET, must, robotOf, withRobots, withTile, type SaveJson } from './testUtils';

const WATER = { tx: 6, tz: 10 };

/** Robots in every state part 1 knows: working, standby, flat, broken in water, repairing, carried. */
function lively(): GameState {
  const base = withTile(BASE, WATER, blockedTile(Blocker.Water), 'farm');
  const robots: Robot[] = [
    robotOf({ id: 1, name: 'Ada', bag: [{ itemId: 'parsnip', quantity: 3, quality: 1 }] }),
    robotOf({ id: 2, name: 'Bolt', power: 'standby', tx: 4, tz: 10 }),
    robotOf({ id: 3, name: 'Cog', power: 'flat', tokens: 0, tx: 3, tz: 10 }),
    robotOf({ id: 4, name: 'Dot', power: 'broken', tx: WATER.tx, tz: WATER.tz, parts: ['wateringHead'], tank: 7 }),
    robotOf({ id: 6, name: 'Echo', power: 'repairing', repairReadyDay: 1, tx: 2, tz: 10 }),
    robotOf({ id: 7, name: 'Fizz', carried: true, nextActMinute: TIME.passOutMinute + 30 }),
  ];
  const state = withRobots(base, robots);
  return {
    ...state,
    player: { ...state.player, carrying: 7 },
    robots: {
      ...state.robots,
      nextId: 9,
      pool: 42,
      lastNightFuel: { wood: 5, tokens: 30 },
      log: {
        nextId: 3,
        entries: [
          { id: 0, day: 0, minute: 364, robotId: 1, tx: TARGET.tx, tz: TARGET.tz, event: { kind: 'did', action: 'harvest', detail: { kind: 'crop', cropId: 'parsnip', quantity: 3, quality: 1 } }, count: 1 },
          { id: 2, day: 0, minute: 368, robotId: 4, tx: WATER.tx, tz: WATER.tz, event: { kind: 'shortedOut' }, count: 2 },
        ],
      },
    },
  };
}

/** Serialises `state`, lets `edit` change the parsed JSON, and loads it again. */
function corrupt(state: GameState, edit: (save: SaveJson) => void): GameState | null {
  const save = JSON.parse(serializeGame(state)) as SaveJson;
  edit(save);
  return deserializeGame(JSON.stringify(save));
}

const robotsOf = (save: SaveJson) => save.robots as SaveJson & { list: SaveJson[]; log: SaveJson & { entries: SaveJson[] } };

describe('save version 4', () => {
  it('round-trips robots in every state', () => {
    const state = lively();
    expect(deserializeGame(serializeGame(state))).toEqual({ ...state, ui: { ...state.ui, panel: { kind: 'none' }, paused: false } });
  });

  it('migrates a version-3 save to an empty robots section', () => {
    const save = JSON.parse(serializeGame(BASE)) as SaveJson;
    delete save.robots;
    delete (save.player as SaveJson).carrying;
    save.version = 3;
    const migrated = migrateSave(save) as SaveJson;
    expect(migrated.version).toBe(4);
    expect(must(deserializeGame(JSON.stringify(save)))).toEqual(BASE);
  });

  it('migrates the version-2 fixture all the way to 4', () => {
    const loaded = must(deserializeGame(saveV2Text));
    expect(loaded.version).toBe(4);
    expect(loaded.robots.list).toEqual([]);
    expect(loaded.player.carrying).toBeNull();
  });

  const rejections: readonly [string, (save: SaveJson) => void][] = [
    ['a blank name', (s) => void (robotsOf(s).list[0]!.name = ' ')],
    ['too many parts for a Mini', (s) => void (robotsOf(s).list[0]!.parts = ['claw', 'basket'])],
    ['parts out of canonical order', (s) => void (robotsOf(s).list[1]!.parts = ['basket', 'claw'])],
    ['a bag over its stack limit', (s) => void (robotsOf(s).list[0]!.bag = [{ itemId: 'wood', quantity: 1, quality: 0 }, { itemId: 'stone', quantity: 1, quality: 0 }])],
    ['water in a tank without a watering head', (s) => void (robotsOf(s).list[0]!.tank = 3)],
    ['more tokens than the battery holds', (s) => void (robotsOf(s).list[0]!.tokens = 81)],
    ['an unknown power', (s) => void (robotsOf(s).list[0]!.power = 'sleeping')],
    ['pc outside the script', (s) => void (robotsOf(s).list[0]!.pc = 1)],
    ['a working robot on a water tile', (s) => void Object.assign(robotsOf(s).list[0]!, { tx: WATER.tx, tz: WATER.tz })],
    ['a repair day on a working robot', (s) => void (robotsOf(s).list[0]!.repairReadyDay = 3)],
    ['a carried robot the player is not carrying', (s) => void ((s.player as SaveJson).carrying = null)],
    ['the player carrying a robot that is not carried', (s) => void ((s.player as SaveJson).carrying = 1)],
    ['ids out of order', (s) => void robotsOf(s).list.reverse()],
    ['an id at or above nextId', (s) => void (robotsOf(s).nextId = 7)],
    ['a log entry with an unknown reason', (s) => void (robotsOf(s).log.entries[0]!.event = { kind: 'blocked', action: 'move', reason: 'tired' })],
    ['a log entry with count 0', (s) => void (robotsOf(s).log.entries[0]!.count = 0)],
    ['nextActMinute far past midnight', (s) => void (robotsOf(s).list[0]!.nextActMinute = TIME.passOutMinute + 241)],
    ['an invalid script step', (s) => void ((robotsOf(s).list[0]!.program as SaveJson).steps = [{ kind: 'wait', minutes: 0 }])],
    ['a negative pool', (s) => void (robotsOf(s).pool = -1)],
  ];

  it.each(rejections)('rejects %s', (_label, edit) => {
    expect(corrupt(lively(), edit)).toBeNull();
  });

  it('keeps the robot a player carries facing any way', () => {
    const state = lively();
    const turned = { ...state, robots: { ...state.robots, list: state.robots.list.map((r) => (r.carried ? { ...r, facing: Direction.West } : r)) } };
    expect(deserializeGame(serializeGame(turned))).not.toBeNull();
  });
});
```

- [ ] **Step 8: Run and iterate until green**

Run: `npx vitest run tests/robotSave.test.ts`
Expected before steps 1 to 6: FAIL (no `robots`). After: PASS.

Run: `npm run typecheck && npm test`
Expected: PASS. If a test constructs a full `PlayerState` or `GameSections` literal and now fails to compile, add `carrying: null` or `robots: createDefaultSections().robots` there. Change nothing else.

- [ ] **Step 9: Commit**

```bash
git add src/core/types.ts src/state/initialState.ts src/state/robotValidation.ts src/state/persistence.ts tests/
git commit -m "Farmclaws part 1: save version 4 with robots and carrying

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The wood burner

**Files:**
- Modify: `src/core/types.ts` (`PLACEABLE_ITEM_IDS`, `PLACED_OBJECT_KINDS`, `CRAFTING_RECIPE_IDS`, `PlacedObject`)
- Modify: `src/items/items.ts`, `src/crafting/recipes.ts`, `src/state/intents.ts`, `src/state/reducer.ts`, `src/state/validation.ts`, `src/state/robotValidation.ts`
- Modify: `src/render/objectGeometry.ts`, `src/render/objectLayout.ts`, `src/render/TileHighlighter.ts`, `src/ui/icons.ts`
- Test: `tests/woodBurner.test.ts`

**Interfaces:**
- Produces: `PlacedObject` variant `{ kind: 'woodBurner'; fuel: number }`; `createWoodBurnerGeometry(): THREE.BufferGeometry`; recipe `woodBurner` (not known by default).

- [ ] **Step 1: Write the failing test `tests/woodBurner.test.ts`**

```ts
/**
 * The wood burner: crafting, placing on the farm only, picking up only when empty, and saving.
 */
import { describe, expect, it } from 'vitest';
import { CRAFTING_RECIPE_IDS, type GameState } from '../src/core/types';
import { actions } from '../src/state/actions';
import { countItem } from '../src/state/inventory';
import { placementProblem } from '../src/state/intents';
import { deserializeGame, serializeGame } from '../src/state/persistence';
import { gameReducer } from '../src/state/reducer';
import { EMPTY_TILE } from '../src/world/tiles';
import { BASE, TARGET, holding, scenario, stack, tileAt, withSlots, withTile, type SaveJson } from './testUtils';

const lastText = (state: GameState) => state.messages.entries[state.messages.entries.length - 1]?.text;
const knowing = (state: GameState): GameState => ({ ...state, crafting: { known: [...CRAFTING_RECIPE_IDS] } });

describe('wood burner', () => {
  it('is not known at first, and crafts from 20 stone, 10 wood and 2 copper ore once known', () => {
    const stocked = withSlots(BASE, [stack('stone', 20), stack('wood', 10), stack('copperOre', 2)]);
    expect(lastText(gameReducer(stocked, actions.craft('woodBurner')))).toBe("You don't know that recipe yet.");
    const crafted = gameReducer(knowing(stocked), actions.craft('woodBurner'));
    expect(countItem(crafted.inventory, 'woodBurner')).toBe(1);
    expect(countItem(crafted.inventory, 'stone')).toBe(0);
  });

  it('places empty on the farm and belongs only there', () => {
    const placed = gameReducer(holding(scenario(EMPTY_TILE), 'woodBurner'), actions.useTool());
    expect(tileAt(placed, TARGET).object).toEqual({ kind: 'woodBurner', fuel: 0 });
    const forest = { ...BASE, player: { ...BASE.player, mapId: 'forest' as const } };
    expect(placementProblem(forest, 'woodBurner', { tx: 0, tz: 0 })).toMatch(/belongs on your farm/);
  });

  it('picks up with the pickaxe only when it holds no wood', () => {
    const loaded = holding(scenario({ ...EMPTY_TILE, object: { kind: 'woodBurner', fuel: 4 } }), 'pickaxe');
    const refused = gameReducer(loaded, actions.useTool());
    expect(lastText(refused)).toBe('Burn off the wood first.');
    expect(tileAt(refused, TARGET).object).toEqual({ kind: 'woodBurner', fuel: 4 });
    const empty = holding(scenario({ ...EMPTY_TILE, object: { kind: 'woodBurner', fuel: 0 } }), 'pickaxe');
    const picked = gameReducer(empty, actions.useTool());
    expect(tileAt(picked, TARGET).object).toBeNull();
    expect(countItem(picked.inventory, 'woodBurner')).toBe(1);
  });

  it('saves its fuel and rejects impossible fuel or a burner off the farm', () => {
    const state = withTile(BASE, TARGET, { ...EMPTY_TILE, object: { kind: 'woodBurner', fuel: 7 } }, 'farm');
    expect(deserializeGame(serializeGame(state))).toEqual(state);
    const tooFull = JSON.parse(serializeGame(withTile(BASE, TARGET, { ...EMPTY_TILE, object: { kind: 'woodBurner', fuel: 7 } }, 'farm'))) as SaveJson;
    const text = JSON.stringify(tooFull).replace('"fuel":7', '"fuel":11');
    expect(deserializeGame(text)).toBeNull();
    const inForest = withTile(BASE, { tx: 3, tz: 3 }, { ...EMPTY_TILE, object: { kind: 'woodBurner', fuel: 0 } }, 'forest');
    expect(deserializeGame(serializeGame(inForest))).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/woodBurner.test.ts`
Expected: FAIL (typecheck error or unknown item `woodBurner`).

- [ ] **Step 3: Add the ids and the object variant in `src/core/types.ts`**

Append `'woodBurner'` as the last entry of `PLACEABLE_ITEM_IDS`, `PLACED_OBJECT_KINDS` and `CRAFTING_RECIPE_IDS`. Add to the `PlacedObject` union:

```ts
  /** Burns its wood overnight into the farm's token pool (farmclaws part 1 §5.7). */
  | { readonly kind: 'woodBurner'; readonly fuel: number };
```

- [ ] **Step 4: Fill in every exhaustive table the compiler now flags**

Run `npm run typecheck`. Each error is one of the following, so make exactly these edits:

`src/items/items.ts`, in `PLACEABLE_INFO`:

```ts
  woodBurner: {
    name: 'Wood Burner',
    description: 'Burns wood overnight and turns it into tokens for your robots. Load it with wood (E).',
    sellPrice: null,
    color: 0x8a5a3c,
  },
```

`src/crafting/recipes.ts`, in `RECIPES`:

```ts
  woodBurner: recipe('woodBurner', [need('stone', 20), need('wood', 10), need('copperOre', 2)]),
```

`src/state/intents.ts`:
- In `PICKUP_TOOL`, add `woodBurner: 'pickaxe',`.
- `isFarmOnlyPlaceable` becomes `return itemId === 'sprinkler' || itemId === 'qualitySprinkler' || itemId === 'scarecrow' || itemId === 'woodBurner';`
- In `planPickUp`, after the chest check, add:

```ts
  if (object.kind === 'woodBurner' && object.fuel > 0) return blocked(target, tool, 'Burn off the wood first.');
```

`src/state/reducer.ts`: replace the `case 'place'` body with a helper. Add above `applyIntent`:

```ts
/** The placed object a placeable item becomes: an empty chest, a cold wood burner, or the plain kind. */
function placedObjectFor(itemId: PlaceableItemId): PlacedObject {
  switch (itemId) {
    case 'chest':
      return { kind: 'chest', slots: new Array<null>(INVENTORY.chestSlots).fill(null) };
    case 'woodBurner':
      return { kind: 'woodBurner', fuel: 0 };
    default:
      return { kind: itemId };
  }
}
```

and change the case to:

```ts
    case 'place': {
      const next = withTile(state, target, { ...tile, object: placedObjectFor(intent.itemId) });
      return { ...next, inventory: removeFromSlot(state.inventory, state.inventory.selected, 1) };
    }
```

Add `type PlaceableItemId` to the reducer's `core/types` import.

`src/state/validation.ts`: import `GENERATORS` (`import { GENERATORS, INVENTORY } from '../config';`). Add `woodBurner: ['fuel'],` to `OBJECT_FIELDS`. In `isValidPlacedObject` add:

```ts
    case 'woodBurner':
      return isIntIn(v.fuel, 0, GENERATORS.woodBurner.hopper);
```

`src/render/objectLayout.ts`: add `case 'woodBurner':` to the list that returns `{ kind: object.kind, variant: '' }`.

`src/render/objectGeometry.ts`: add after `createQualitySprinklerGeometry`:

```ts
// ---------------------------------------------------------------------------
// Wood burner
// ---------------------------------------------------------------------------

/** A squat iron stove with a glowing grate, a chimney and a copper cap. */
export function createWoodBurnerGeometry(): THREE.BufferGeometry {
  const iron = 0x4a4541;
  const ironDark = 0x34302d;
  const ember = 0xe8743b;
  return mergeParts(
    [
      box(0.5, 0.06, 0.44, { y: 0.03 }, ironDark),
      box(0.44, 0.36, 0.38, { y: 0.24 }, iron),
      box(0.3, 0.14, 0.02, { y: 0.2, z: 0.2 }, ember),
      box(0.34, 0.03, 0.03, { y: 0.28, z: 0.205 }, ironDark),
      cylinder(0.06, 0.06, 0.34, 8, { x: 0.12, y: 0.59, z: -0.08 }, ironDark),
      cylinder(0.08, 0.08, 0.04, 8, { x: 0.12, y: 0.78, z: -0.08 }, OBJECT_COLORS.copper),
    ],
    'wood burner',
  );
}
```

Add `'woodBurner'` to `OBJECT_PART_IDS`, `woodBurner: part('woodBurner', 'painted', createWoodBurnerGeometry),` to `OBJECT_PARTS`, and to `objectPartsFor`:

```ts
    case 'woodBurner':
      return ['woodBurner'];
```

`src/render/TileHighlighter.ts`: add `woodBurner: 0.9,` to `BOX_HEIGHT.object`. Add `createWoodBurnerGeometry` to its `objectGeometry` import, and add to `createGhostGeometry`:

```ts
    case 'woodBurner':
      return createWoodBurnerGeometry();
```

`src/ui/icons.ts`, in `placeableParts`:

```ts
    case 'woodBurner':
      return [
        faceted('6,12 26,12 26,28 6,28', hex(color), [facet('20,12 26,12 26,28 20,28', dark(color, 0.2))]),
        faceted('10,18 22,18 22,24 10,24', hex(0xe8743b), [facet('10,18 22,18 22,20 10,20', light(0xe8743b, 0.35))]),
        faceted('18,3 23,3 23,12 18,12', dark(color, 0.1), [facet('18,3 20,3 20,12 18,12', light(color, 0.25))]),
      ];
```

`src/state/robotValidation.ts`: burners belong on the farm. Add `forEachTile` to the `../world/tiles` import and this function:

```ts
/** Wood burners work the farm's robots, so a burner on another map means a corrupt save. */
function burnersOnlyOnFarm(maps: GameState['maps']): boolean {
  let stray = false;
  for (const id of ['forest', 'town'] as const) {
    forEachTile(maps[id], (tile) => {
      if (tile.object?.kind === 'woodBurner') stray = true;
    });
  }
  return !stray;
}
```

and change the last line of `isValidRobotsSection` to `return isValidLog(v.log, maps.farm) && burnersOnlyOnFarm(maps);`

- [ ] **Step 5: Run the tests, typecheck and the full suite**

Run: `npx vitest run tests/woodBurner.test.ts && npm run typecheck && npm test`
Expected: PASS. If `tests/placement.test.ts` iterates `PLACEABLE_ITEM_IDS` and expects every item to place, it now includes `woodBurner`, which places fine on the farm.

- [ ] **Step 6: Commit**

```bash
git add src/ tests/woodBurner.test.ts
git commit -m "Farmclaws part 1: the wood burner

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Robot helpers: harvest extraction, world, bag and log

**Files:**
- Create: `src/farming/harvest.ts`, `src/robots/world.ts`, `src/robots/bag.ts`, `src/robots/log.ts`
- Modify: `src/state/reducer.ts` (`harvest` uses `harvestedTile`), `src/state/intents.ts` (`harvestQuantity`, `harvestQuality` take `mapId`)
- Test: `tests/robotHelpers.test.ts`

**Interfaces:**
- Produces:
  - `harvestedTile(tile: Tile): Tile`
  - `harvestQuantity(state, target, crop, mapId: MapId = state.player.mapId): number`
  - `harvestQuality(state, target, crop, mapId: MapId = state.player.mapId): Quality`
  - `findRobot(state, id): Robot | null`, `requireRobot(state, id): Robot`, `withRobot(state, robot): GameState`, `withFarm(state, world): GameState`, `robotsOnTile(state, tx, tz): readonly Robot[]`, `containerOf(tile: Tile | null): 'chest' | 'bin' | null`, `chestSlots(tile: Tile | null): Slots`, `nearestWalkable(world, from: TileCoord): TileCoord`
  - `type Slots = readonly (ItemStack | null)[]`; `bagCount(bag, itemId)`, `bagRoom(bag, limit, itemId, quality)`, `addToBag(bag, limit, itemId, quantity, quality): { bag; added }`, `removeFromBag(bag, itemId, quantity): readonly ItemStack[]`, `slotsRoom(slots, itemId, quality)`, `addToSlots(slots, stack): { slots; added }`, `takeIntoBag(slots, bag, limit, itemId): { slots; bag; moved; stacks }`
  - `logRobotEvent(state, robotId, event): GameState`, `pruneRobotLog(state): GameState`

- [ ] **Step 1: Write the failing test `tests/robotHelpers.test.ts`**

```ts
/**
 * Robot helper modules: harvested tiles, robot lookup, bag and chest arithmetic, the farm log.
 */
import { describe, expect, it } from 'vitest';
import { ROBOTS } from '../src/config';
import { Blocker, TileState, type ItemStack } from '../src/core/types';
import { harvestedTile } from '../src/farming/harvest';
import { addToBag, addToSlots, bagCount, bagRoom, removeFromBag, takeIntoBag } from '../src/robots/bag';
import { logRobotEvent, pruneRobotLog } from '../src/robots/log';
import { containerOf, nearestWalkable, robotsOnTile, withRobot } from '../src/robots/world';
import { blockedTile, EMPTY_TILE } from '../src/world/tiles';
import { BASE, TARGET, atDay, matureCrop, robotOf, soilTile, stack, withRobots, withTile } from './testUtils';

const empties = (n: number): (ItemStack | null)[] => Array.from({ length: n }, () => null);

describe('harvestedTile', () => {
  it('clears a one-off crop and its fertiliser, and drops a regrowing crop back a stage', () => {
    const parsnip = { ...soilTile(TileState.Watered, matureCrop('parsnip')), fertilizer: 'basic' as const };
    expect(harvestedTile(parsnip)).toEqual({ ...parsnip, crop: null, fertilizer: null });
    const berry = { ...soilTile(TileState.Plowed, matureCrop('strawberry')), fertilizer: 'basic' as const };
    const after = harvestedTile(berry);
    expect(after.crop?.regrowing).toBe(true);
    expect(after.crop?.harvestCount).toBe(1);
    expect(after.fertilizer).toBe('basic');
  });
});

describe('robot world helpers', () => {
  it('finds robots on a tile, skipping carried and repairing ones', () => {
    const state = withRobots(BASE, [robotOf({ id: 1 }), robotOf({ id: 2, carried: true }), robotOf({ id: 3, power: 'repairing', repairReadyDay: 1 }), robotOf({ id: 4 })]);
    expect(robotsOnTile(state, TARGET.tx, TARGET.tz).map((r) => r.id)).toEqual([1, 4]);
  });

  it('keeps the state when a robot is replaced by itself or an identical copy', () => {
    const state = withRobots(BASE, [robotOf()]);
    const robot = state.robots.list[0]!;
    expect(withRobot(state, robot)).toBe(state);
    expect(withRobot(state, { ...robot })).toBe(state);
    expect(withRobot(state, { ...robot, tokens: 1 }).robots.list[0]?.tokens).toBe(1);
  });

  it('names chests and the shipping bin as containers', () => {
    expect(containerOf({ ...EMPTY_TILE, object: { kind: 'chest', slots: empties(36) } })).toBe('chest');
    expect(containerOf(blockedTile(Blocker.ShippingBin))).toBe('bin');
    expect(containerOf(EMPTY_TILE)).toBeNull();
    expect(containerOf(null)).toBeNull();
  });

  it('finds the nearest walkable tile', () => {
    const blocked = withTile(BASE, TARGET, blockedTile(Blocker.Weeds), 'farm');
    expect(nearestWalkable(blocked.maps.farm, TARGET)).toEqual({ tx: TARGET.tx, tz: TARGET.tz - 1 });
    expect(nearestWalkable(BASE.maps.farm, TARGET)).toEqual(TARGET);
  });
});

describe('bag arithmetic', () => {
  it('adds into matching stacks, then new stacks up to the limit', () => {
    const { bag, added } = addToBag([stack('parsnip', 998)], 2, 'parsnip', 5);
    expect(added).toBe(5);
    expect(bag).toEqual([stack('parsnip', 999), stack('parsnip', 4)]);
    expect(addToBag(bag, 2, 'wood', 1).added).toBe(0);
    expect(bagRoom([stack('parsnip', 990)], 1, 'parsnip', 0)).toBe(9);
    expect(bagRoom([stack('parsnip', 990)], 1, 'parsnip', 1)).toBe(0);
  });

  it('removes lowest quality first and counts every quality', () => {
    const bag = [stack('parsnip', 2, 1), stack('parsnip', 1, 0)];
    expect(bagCount(bag, 'parsnip')).toBe(3);
    expect(removeFromBag(bag, 'parsnip', 2)).toEqual([stack('parsnip', 1, 1)]);
  });

  it('adds to chest slots like the inventory and takes lowest quality first', () => {
    const slots = [stack('wood', 999), null, stack('wood', 5)];
    const { slots: after, added } = addToSlots(slots, stack('wood', 10));
    expect(added).toBe(10);
    expect(after).toEqual([stack('wood', 999), null, stack('wood', 15)]);
    const chest = [stack('parsnip', 3, 2), stack('parsnip', 2, 0)];
    const taken = takeIntoBag(chest, [], 1, 'parsnip');
    expect(taken.moved).toBe(2);
    expect(taken.bag).toEqual([stack('parsnip', 2, 0)]);
    expect(taken.slots).toEqual([stack('parsnip', 3, 2), null]);
  });
});

describe('farm log', () => {
  it('collapses identical consecutive events of one robot and keeps the first tile and time', () => {
    let state = withRobots(BASE, [robotOf({ id: 1 }), robotOf({ id: 2 })]);
    state = logRobotEvent(state, 1, { kind: 'flat' });
    state = logRobotEvent(state, 2, { kind: 'flat' });
    state = logRobotEvent(state, 1, { kind: 'flat' });
    expect(state.robots.log.entries.map((e) => [e.robotId, e.count])).toEqual([[1, 2], [2, 1]]);
    state = logRobotEvent(state, 1, { kind: 'finished' });
    expect(state.robots.log.entries).toHaveLength(3);
    expect(state.robots.log.nextId).toBe(3);
  });

  it('keeps the newest entries within capacity and prunes days before yesterday', () => {
    let state = withRobots(BASE, [robotOf()]);
    for (let i = 0; i < ROBOTS.logCapacity + 5; i++) {
      state = logRobotEvent(state, 1, i % 2 === 0 ? { kind: 'flat' } : { kind: 'finished' });
    }
    expect(state.robots.log.entries).toHaveLength(ROBOTS.logCapacity);
    const later = pruneRobotLog(atDay(state, 2));
    expect(later.robots.log.entries).toHaveLength(0);
    expect(pruneRobotLog(atDay(state, 1)).robots.log).toBe(state.robots.log);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/robotHelpers.test.ts`
Expected: FAIL, "Failed to resolve import ../src/farming/harvest".

- [ ] **Step 3: Create `src/farming/harvest.ts` and use it in the reducer**

```ts
/**
 * What a tile looks like after its mature crop is harvested, shared by the player and robots.
 */
import type { Tile } from '../core/types';
import { CROPS, stageCount } from './crops';

/**
 * A regrowing crop drops back to its last growing stage and keeps the fertiliser; any other
 * crop leaves the soil bare, and the fertiliser goes with it.
 */
export function harvestedTile(tile: Tile): Tile {
  const crop = tile.crop;
  if (crop === null) throw new RangeError('harvestedTile: the tile has no crop');
  const def = CROPS[crop.cropId];
  const regrown =
    def.regrowDays === null
      ? null
      : { ...crop, stage: stageCount(def) - 1, daysInStage: 0, dryDays: 0, regrowing: true, harvestCount: crop.harvestCount + 1 };
  return { ...tile, crop: regrown, fertilizer: regrown === null ? null : tile.fertilizer };
}
```

In `src/state/reducer.ts`, `harvest()` becomes:

```ts
function harvest(state: GameState, target: TileCoord, tile: Tile, quantity: number, quality: Quality): GameState {
  const crop = tile.crop;
  invariant(crop !== null, 'harvest target has no crop');
  const def = CROPS[crop.cropId];
  const { inventory, added } = addItem(state.inventory, def.id, quantity, quality);
  invariant(added === quantity, 'harvest capacity is verified while planning');
  const next = withTile(state, target, harvestedTile(tile));
  return pushMessage({ ...next, inventory }, `Harvested ${qualityPrefix(quality)}${def.name} ×${quantity}.`, 'success');
}
```

Import `harvestedTile` from `../farming/harvest`, and drop `stageCount` from the crops import if it's no longer used there.

- [ ] **Step 4: Give the harvest functions a map id in `src/state/intents.ts`**

Add `type MapId` to the `core/types` import. Replace the two functions' signatures and seed/tile lookups:

```ts
export function harvestQuantity(state: GameState, target: TileCoord, crop: CropInstance, mapId: MapId = state.player.mapId): number {
  const def = CROPS[crop.cropId];
  return hashRange(def.yieldMin, def.yieldMax, mapSeed(state.seed, mapId), target.tx, target.tz, state.time.absoluteDay, crop.harvestCount, Salt.Yield);
}

export function harvestQuality(state: GameState, target: TileCoord, crop: CropInstance, mapId: MapId = state.player.mapId): Quality {
  const chance = qualityChanceFor(getTile(state.maps[mapId], target.tx, target.tz)?.fertilizer ?? null);
  const r = hashFloat(mapSeed(state.seed, mapId), target.tx, target.tz, state.time.absoluteDay, crop.harvestCount, Salt.Quality);
  if (r < chance.gold) return 2;
  return r < chance.gold + chance.silver ? 1 : 0;
}
```

Keep both doc comments, adding "on map `mapId` (default: the player's)".

- [ ] **Step 5: Create `src/robots/world.ts`**

```ts
/**
 * Finding, replacing and placing robots. Robots always live on the farm map.
 */
import { invariant } from '../core/invariant';
import { Blocker, DIRECTIONS, type GameState, type Robot, type Tile, type TileCoord, type WorldState } from '../core/types';
import { withMap } from '../state/selectors';
import { inBounds, stepTile } from '../world/grid';
import { getTile, isWalkable } from '../world/tiles';
import type { Slots } from './bag';

export function findRobot(state: GameState, id: number): Robot | null {
  return state.robots.list.find((robot) => robot.id === id) ?? null;
}

export function requireRobot(state: GameState, id: number): Robot {
  const robot = findRobot(state, id);
  if (robot === null) throw new RangeError(`requireRobot: no robot ${id}`);
  return robot;
}

/** Same object, or every field identical by reference: nothing about the robot changed. */
function sameRobot(a: Robot, b: Robot): boolean {
  if (a === b) return true;
  const keys = Object.keys(a) as (keyof Robot)[];
  return keys.every((key) => a[key] === b[key]);
}

/**
 * `state` with the robot of the same id replaced; `state` itself when nothing about the robot
 * changed, so an unchanged robot always keeps its identity (the render contract).
 */
export function withRobot(state: GameState, robot: Robot): GameState {
  const list = state.robots.list;
  const index = list.findIndex((r) => r.id === robot.id);
  invariant(index !== -1, `withRobot: no robot ${robot.id}`);
  const current = list[index];
  if (current !== undefined && sameRobot(current, robot)) return state;
  const next = list.slice();
  next[index] = robot;
  return { ...state, robots: { ...state.robots, list: next } };
}

export function withFarm(state: GameState, world: WorldState): GameState {
  return withMap(state, 'farm', world);
}

/** Robots standing on a farm tile (not carried, not away for repair), lowest id first. */
export function robotsOnTile(state: GameState, tx: number, tz: number): readonly Robot[] {
  return state.robots.list.filter((r) => !r.carried && r.power !== 'repairing' && r.tx === tx && r.tz === tz);
}

export type ContainerKind = 'chest' | 'bin';

export function containerOf(tile: Tile | null): ContainerKind | null {
  if (tile === null) return null;
  if (tile.object !== null && tile.object.kind === 'chest') return 'chest';
  return tile.blocker === Blocker.ShippingBin ? 'bin' : null;
}

export function chestSlots(tile: Tile | null): Slots {
  return tile !== null && tile.object !== null && tile.object.kind === 'chest' ? tile.object.slots : [];
}

/** `from` when it's walkable, else the nearest walkable tile by breadth-first search in DIRECTIONS order. */
export function nearestWalkable(world: WorldState, from: TileCoord): TileCoord {
  const key = (c: TileCoord): number => c.tz * world.grid.width + c.tx;
  const seen = new Set<number>([key(from)]);
  const queue: TileCoord[] = [from];
  for (let head = 0; head < queue.length; head++) {
    const current = queue[head];
    if (current === undefined) break;
    const tile = getTile(world, current.tx, current.tz);
    if (tile !== null && isWalkable(tile)) return current;
    for (const direction of DIRECTIONS) {
      const next = stepTile(current, direction);
      if (!inBounds(world.grid, next.tx, next.tz) || seen.has(key(next))) continue;
      seen.add(key(next));
      queue.push(next);
    }
  }
  throw new Error('nearestWalkable: the map has no walkable tile');
}
```

The test expects the tile North of TARGET for a weed at TARGET. `DIRECTIONS` starts with North, so the first neighbour checked is North, which is STAND (walkable).

- [ ] **Step 6: Create `src/robots/bag.ts`**

```ts
/**
 * Stack arithmetic for robot bags (a short list of stacks) and chest slots (a fixed array).
 * Mirrors state/inventory.ts's rules: stacks merge on item and quality up to the item's maxStack.
 */
import type { ItemId, ItemStack, Quality } from '../core/types';
import { getItem } from '../items/items';

export type Slots = readonly (ItemStack | null)[];

export function bagCount(bag: readonly ItemStack[], itemId: ItemId): number {
  return bag.reduce((sum, s) => (s.itemId === itemId ? sum + s.quantity : sum), 0);
}

/** Units of `itemId` at `quality` that still fit a bag holding at most `limit` stacks. */
export function bagRoom(bag: readonly ItemStack[], limit: number, itemId: ItemId, quality: Quality): number {
  const max = getItem(itemId).maxStack;
  let room = Math.max(0, limit - bag.length) * max;
  for (const s of bag) if (s.itemId === itemId && s.quality === quality) room += max - s.quantity;
  return room;
}

/** Tops up matching stacks, then opens new ones up to `limit`. Returns the bag and how much fit. */
export function addToBag(
  bag: readonly ItemStack[],
  limit: number,
  itemId: ItemId,
  quantity: number,
  quality: Quality = 0,
): { readonly bag: readonly ItemStack[]; readonly added: number } {
  const max = getItem(itemId).maxStack;
  const next = bag.slice();
  let remaining = quantity;
  for (let i = 0; i < next.length && remaining > 0; i++) {
    const s = next[i];
    if (s === undefined || s.itemId !== itemId || s.quality !== quality || s.quantity >= max) continue;
    const moved = Math.min(remaining, max - s.quantity);
    next[i] = { ...s, quantity: s.quantity + moved };
    remaining -= moved;
  }
  while (remaining > 0 && next.length < limit) {
    const moved = Math.min(remaining, max);
    next.push({ itemId, quantity: moved, quality });
    remaining -= moved;
  }
  const added = quantity - remaining;
  return added === 0 ? { bag, added } : { bag: next, added };
}

/** Removes `quantity` units of `itemId`, lowest quality first. The bag must hold them. */
export function removeFromBag(bag: readonly ItemStack[], itemId: ItemId, quantity: number): readonly ItemStack[] {
  let remaining = quantity;
  const order = bag
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => s.itemId === itemId)
    .sort((a, b) => a.s.quality - b.s.quality || a.i - b.i);
  const next: (ItemStack | null)[] = bag.slice();
  for (const { s, i } of order) {
    if (remaining === 0) break;
    const taken = Math.min(remaining, s.quantity);
    next[i] = taken === s.quantity ? null : { ...s, quantity: s.quantity - taken };
    remaining -= taken;
  }
  if (remaining > 0) throw new RangeError(`removeFromBag: only ${quantity - remaining} of ${quantity} ${itemId}`);
  return next.filter((s): s is ItemStack => s !== null);
}

/** Units of `itemId` at `quality` that still fit `slots`. */
export function slotsRoom(slots: Slots, itemId: ItemId, quality: Quality): number {
  const max = getItem(itemId).maxStack;
  let room = 0;
  for (const s of slots) {
    if (s === null) room += max;
    else if (s.itemId === itemId && s.quality === quality) room += max - s.quantity;
  }
  return room;
}

/** Adds as much of `stack` as fits: matching stacks first, then empty slots, each in slot order. */
export function addToSlots(slots: Slots, stack: ItemStack): { readonly slots: Slots; readonly added: number } {
  const max = getItem(stack.itemId).maxStack;
  const next = slots.slice();
  let remaining = stack.quantity;
  for (let i = 0; i < next.length && remaining > 0; i++) {
    const s = next[i] ?? null;
    if (s === null || s.itemId !== stack.itemId || s.quality !== stack.quality || s.quantity >= max) continue;
    const moved = Math.min(remaining, max - s.quantity);
    next[i] = { ...s, quantity: s.quantity + moved };
    remaining -= moved;
  }
  for (let i = 0; i < next.length && remaining > 0; i++) {
    if (next[i] !== null) continue;
    const moved = Math.min(remaining, max);
    next[i] = { itemId: stack.itemId, quantity: moved, quality: stack.quality };
    remaining -= moved;
  }
  const added = stack.quantity - remaining;
  return added === 0 ? { slots, added } : { slots: next, added };
}

/**
 * Moves `itemId` from chest slots into a bag, lowest quality first, then slot order, until the
 * bag is full or the chest has none. `stacks` counts the chest slots touched.
 */
export function takeIntoBag(
  slots: Slots,
  bag: readonly ItemStack[],
  limit: number,
  itemId: ItemId,
): { readonly slots: Slots; readonly bag: readonly ItemStack[]; readonly moved: number; readonly stacks: number } {
  const order = slots
    .map((s, i) => ({ s, i }))
    .filter((e): e is { s: ItemStack; i: number } => e.s !== null && e.s.itemId === itemId)
    .sort((a, b) => a.s.quality - b.s.quality || a.i - b.i);
  let nextSlots: (ItemStack | null)[] | null = null;
  let nextBag = bag;
  let moved = 0;
  let stacks = 0;
  for (const { s, i } of order) {
    const room = bagRoom(nextBag, limit, itemId, s.quality);
    if (room === 0) continue;
    const taken = Math.min(room, s.quantity);
    nextBag = addToBag(nextBag, limit, itemId, taken, s.quality).bag;
    nextSlots ??= slots.slice();
    nextSlots[i] = taken === s.quantity ? null : { ...s, quantity: s.quantity - taken };
    moved += taken;
    stacks++;
  }
  return { slots: nextSlots ?? slots, bag: nextBag, moved, stacks };
}
```

- [ ] **Step 7: Create `src/robots/log.ts`**

```ts
/**
 * The farm log: structured facts about what robots really did (farmclaws part 1 spec §5.6).
 */
import { ROBOTS } from '../config';
import type { GameState, RobotLogEntry, RobotLogEvent } from '../core/types';
import { requireRobot } from './world';

/** Events are small plain objects built in one key order, so their JSON is a faithful equality key. */
function sameEvent(a: RobotLogEvent, b: RobotLogEvent): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Appends an event for `robotId` at the current day, minute and the robot's tile. If the most
 * recent entry of that robot has an equal event, its count goes up instead.
 */
export function logRobotEvent(state: GameState, robotId: number, event: RobotLogEvent): GameState {
  const robot = requireRobot(state, robotId);
  const { nextId, entries } = state.robots.log;
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry === undefined || entry.robotId !== robotId) continue;
    if (!sameEvent(entry.event, event)) break;
    const next = entries.slice();
    next[i] = { ...entry, count: entry.count + 1 };
    return { ...state, robots: { ...state.robots, log: { nextId, entries: next } } };
  }
  const entry: RobotLogEntry = {
    id: nextId,
    day: state.time.absoluteDay,
    minute: state.time.minuteOfDay,
    robotId,
    tx: robot.tx,
    tz: robot.tz,
    event,
    count: 1,
  };
  const next = [...entries, entry].slice(-ROBOTS.logCapacity);
  return { ...state, robots: { ...state.robots, log: { nextId: nextId + 1, entries: next } } };
}

/** Drops entries older than yesterday; the same state when nothing is dropped. */
export function pruneRobotLog(state: GameState): GameState {
  const oldest = state.time.absoluteDay - 1;
  const { entries } = state.robots.log;
  if (entries.every((e) => e.day >= oldest)) return state;
  return { ...state, robots: { ...state.robots, log: { ...state.robots.log, entries: entries.filter((e) => e.day >= oldest) } } };
}
```

- [ ] **Step 8: Run the tests, typecheck and the full suite**

Run: `npx vitest run tests/robotHelpers.test.ts && npm run typecheck && npm test`
Expected: PASS. The existing harvest and quality tests pass unchanged.

- [ ] **Step 9: Commit**

```bash
git add src/farming/harvest.ts src/robots/ src/state/reducer.ts src/state/intents.ts tests/robotHelpers.test.ts
git commit -m "Farmclaws part 1: robot world, bag and log helpers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The executor and `addRobot`

**Files:**
- Create: `src/robots/execute.ts`, `src/robots/create.ts`
- Test: `tests/robotExecute.test.ts`

**Interfaces:**
- Consumes: Task 4 helpers; `harvestQuantity`/`harvestQuality` with `'farm'`; `canDo`, `actionCost`, `bagStacks`, `periodFor`; `pushMessage`; `isValidRobotProgram`; `isValidName`; `isCanonicalSubset`.
- Produces:
  - `type RobotPlan = { ok: true; action; target: TileCoord; cost } | { ok: false; action; target: TileCoord; reason: RobotBlockReason; cost }`
  - `planRobotAction(state, robot, action): RobotPlan`
  - `applyRobotPlan(state, robotId, plan): GameState`
  - `applyBickerPlan(state, robotId, plan, withIds: readonly number[]): GameState`
  - `interface RobotSpec { name; size; parts; place: RobotPlace; program }`
  - `type AddRobotResult = { state: GameState; id: number } | { error: string }`
  - `addRobot(state, spec): AddRobotResult`

- [ ] **Step 1: Write the failing test `tests/robotExecute.test.ts`**

```ts
/**
 * The robot executor: every action's success, every block reason, costs, and addRobot.
 */
import { describe, expect, it } from 'vitest';
import { ROBOTS, TIME } from '../src/config';
import { Blocker, Direction, TileState, type GameState, type Robot, type RobotAction } from '../src/core/types';
import { createCropInstance } from '../src/farming/crops';
import { addRobot } from '../src/robots/create';
import { applyRobotPlan, planRobotAction } from '../src/robots/execute';
import { requireRobot } from '../src/robots/world';
import { harvestQuality, harvestQuantity } from '../src/state/intents';
import { blockedTile, EMPTY_TILE } from '../src/world/tiles';
import { BASE, TARGET, atDay, matureCrop, must, robotOf, soilTile, stack, tileAt, withRobots, withTile } from './testUtils';

const AHEAD = { tx: TARGET.tx, tz: TARGET.tz + 1 };
const chestWith = (...stacks: ReturnType<typeof stack>[]) => ({
  ...EMPTY_TILE,
  object: { kind: 'chest' as const, slots: Array.from({ length: 36 }, (_, i) => stacks[i] ?? null) },
});

/** One robot (id 1) on the farm, then plans and applies `action`. */
function act(state: GameState, robot: Robot, action: RobotAction): { next: GameState; robot: Robot } {
  const placed = withRobots(state, [robot]);
  const plan = planRobotAction(placed, robot, action);
  const next = applyRobotPlan(placed, robot.id, plan);
  return { next, robot: requireRobot(next, robot.id) };
}

const lastEvent = (state: GameState) => state.robots.log.entries[state.robots.log.entries.length - 1]?.event;

describe('robot actions that succeed', () => {
  it('moves forward and counts the step', () => {
    const { robot } = act(BASE, robotOf(), { kind: 'move' });
    expect([robot.tx, robot.tz, robot.moveSeq, robot.tokens]).toEqual([AHEAD.tx, AHEAD.tz, 1, 79]);
  });

  it('shorts out driving into water, with a toast', () => {
    const wet = withTile(BASE, AHEAD, blockedTile(Blocker.Water), 'farm');
    const { next, robot } = act(wet, robotOf(), { kind: 'move' });
    expect(robot.power).toBe('broken');
    expect([robot.tx, robot.tz]).toEqual([AHEAD.tx, AHEAD.tz]);
    expect(lastEvent(next)).toEqual({ kind: 'shortedOut' });
    expect(next.messages.entries.at(-1)?.text).toBe('Sprocket drove into the water and shorted out.');
  });

  it('turns left and right a quarter turn', () => {
    expect(act(BASE, robotOf({ facing: Direction.North }), { kind: 'turn', side: 'left' }).robot.facing).toBe(Direction.West);
    expect(act(BASE, robotOf({ facing: Direction.West }), { kind: 'turn', side: 'right' }).robot.facing).toBe(Direction.North);
  });

  it('waters its own plowed tile from the tank', () => {
    const state = withTile(BASE, TARGET, soilTile(TileState.Plowed), 'farm');
    const { next, robot } = act(state, robotOf({ parts: ['wateringHead'], tank: 3 }), { kind: 'water' });
    expect(tileAt(next, TARGET, 'farm').state).toBe(TileState.Watered);
    expect([robot.tank, robot.tokens]).toEqual([2, 78]);
  });

  it('harvests into its bag with the same size and quality the player would get', () => {
    const state = withTile(atDay(BASE, 3), TARGET, soilTile(TileState.Watered, matureCrop('parsnip')), 'farm');
    const crop = must(tileAt(state, TARGET, 'farm').crop);
    const quantity = harvestQuantity(state, TARGET, crop, 'farm');
    const quality = harvestQuality(state, TARGET, crop, 'farm');
    const { next, robot } = act(state, robotOf(), { kind: 'harvest' });
    expect(robot.bag).toEqual([stack('parsnip', quantity, quality)]);
    expect(tileAt(next, TARGET, 'farm').crop).toBeNull();
    expect(lastEvent(next)).toEqual({ kind: 'did', action: 'harvest', detail: { kind: 'crop', cropId: 'parsnip', quantity, quality } });
    expect(next.messages).toBe(state.messages);
  });

  it('tills grass and plants one seed from the bag', () => {
    const tilled = act(BASE, robotOf({ parts: ['tiller'] }), { kind: 'till' });
    expect(tileAt(tilled.next, TARGET, 'farm').state).toBe(TileState.Plowed);
    const soil = withTile(BASE, TARGET, soilTile(TileState.Plowed), 'farm');
    const { next, robot } = act(soil, robotOf({ parts: ['seeder'], bag: [stack('parsnip_seeds', 2)] }), { kind: 'plant', cropId: 'parsnip' });
    expect(tileAt(next, TARGET, 'farm').crop).toEqual(createCropInstance('parsnip', 0));
    expect(robot.bag).toEqual([stack('parsnip_seeds', 1)]);
  });

  it('refills from water ahead', () => {
    const wet = withTile(BASE, AHEAD, blockedTile(Blocker.Water), 'farm');
    expect(act(wet, robotOf({ parts: ['wateringHead'], tank: 2 }), { kind: 'refill' }).robot.tank).toBe(ROBOTS.tankCapacity);
  });

  it('deposits into a chest ahead, keeping what does not fit', () => {
    const full = Array.from({ length: 35 }, () => stack('stone', 999));
    const state = withTile(BASE, AHEAD, chestWith(...full), 'farm');
    const robot = robotOf({ size: 'standard', parts: ['claw'], bag: [stack('parsnip', 5), stack('wood', 3)] });
    const { next, robot: after } = act(state, robot, { kind: 'deposit' });
    const slots = (tileAt(next, AHEAD, 'farm').object as { slots: unknown[] }).slots;
    expect(slots[35]).toEqual(stack('parsnip', 5));
    expect(after.bag).toEqual([stack('wood', 3)]);
    expect(lastEvent(next)).toEqual({ kind: 'did', action: 'deposit', detail: { kind: 'items', into: 'chest', stacks: 1, quantity: 5 } });
  });

  it('ships every sellable stack into the bin, seeds included, and keeps unsellable ones', () => {
    const atBin = robotOf({ size: 'standard', tx: 9, tz: 6, facing: Direction.North, bag: [stack('parsnip_seeds', 4), stack('parsnip', 2), stack('chest', 1)] });
    const { next, robot } = act(BASE, atBin, { kind: 'deposit' });
    expect(next.shipping.pending).toEqual([stack('parsnip_seeds', 4), stack('parsnip', 2)]);
    expect(robot.bag).toEqual([stack('chest', 1)]);
  });

  it('takes an item from a chest ahead', () => {
    const state = withTile(BASE, AHEAD, chestWith(stack('parsnip_seeds', 12)), 'farm');
    const { next, robot } = act(state, robotOf(), { kind: 'take', itemId: 'parsnip_seeds' });
    expect(robot.bag).toEqual([stack('parsnip_seeds', 12)]);
    expect((tileAt(next, AHEAD, 'farm').object as { slots: unknown[] }).slots[0]).toBeNull();
  });

  it('says, waits and powers down', () => {
    expect(act(BASE, robotOf(), { kind: 'say', text: 'Hello' }).robot.tokens).toBe(79);
    const waited = act(BASE, robotOf(), { kind: 'wait', minutes: 30 }).robot;
    expect([waited.tokens, waited.nextActMinute]).toEqual([80, BASE.time.minuteOfDay + 30]);
    const down = act(BASE, robotOf(), { kind: 'powerDown' });
    expect(down.robot.power).toBe('standby');
    expect(lastEvent(down.next)).toEqual({ kind: 'poweredDown' });
  });
});

describe('robot actions that are blocked', () => {
  const cases: readonly [string, GameState, Robot, RobotAction, string, number][] = [
    ['no part', BASE, robotOf(), { kind: 'water' }, 'noPart', 0],
    ['bumping a rock', withTile(BASE, AHEAD, blockedTile(Blocker.Rock, 2), 'farm'), robotOf(), { kind: 'move' }, 'bumped', 1],
    ['the farm edge', BASE, robotOf({ tx: 5, tz: 0, facing: Direction.North }), { kind: 'move' }, 'farmEdge', 1],
    ['nothing ripe', BASE, robotOf(), { kind: 'harvest' }, 'nothingToHarvest', 3],
    ['a full bag', withTile(BASE, TARGET, soilTile(TileState.Watered, matureCrop('parsnip')), 'farm'), robotOf({ bag: [stack('wood', 1)] }), { kind: 'harvest' }, 'bagFull', 3],
    ['an empty tank', withTile(BASE, TARGET, soilTile(TileState.Plowed), 'farm'), robotOf({ parts: ['wateringHead'] }), { kind: 'water' }, 'tankEmpty', 2],
    ['watered soil', withTile(BASE, TARGET, soilTile(TileState.Watered), 'farm'), robotOf({ parts: ['wateringHead'], tank: 5 }), { kind: 'water' }, 'notWaterable', 2],
    ['tilled soil', withTile(BASE, TARGET, soilTile(TileState.Plowed), 'farm'), robotOf({ parts: ['tiller'] }), { kind: 'till' }, 'notTillable', 5],
    ['no seeds', withTile(BASE, TARGET, soilTile(TileState.Plowed), 'farm'), robotOf({ parts: ['seeder'] }), { kind: 'plant', cropId: 'parsnip' }, 'noSeed', 3],
    ['the wrong season', withTile(BASE, TARGET, soilTile(TileState.Plowed), 'farm'), robotOf({ parts: ['seeder'], bag: [stack('pumpkin_seeds', 1)] }), { kind: 'plant', cropId: 'pumpkin' }, 'outOfSeason', 3],
    ['grass', BASE, robotOf({ parts: ['seeder'], bag: [stack('parsnip_seeds', 1)] }), { kind: 'plant', cropId: 'parsnip' }, 'cannotPlant', 3],
    ['no water ahead', BASE, robotOf({ parts: ['wateringHead'] }), { kind: 'refill' }, 'noWaterAhead', 1],
    ['a full tank', withTile(BASE, AHEAD, blockedTile(Blocker.Water), 'farm'), robotOf({ parts: ['wateringHead'], tank: ROBOTS.tankCapacity }), { kind: 'refill' }, 'tankFull', 1],
    ['nothing ahead', BASE, robotOf({ bag: [stack('wood', 1)] }), { kind: 'deposit' }, 'nothingAhead', 1],
    ['an empty bag', withTile(BASE, AHEAD, chestWith(), 'farm'), robotOf(), { kind: 'deposit' }, 'bagEmpty', 1],
    ['a full chest', withTile(BASE, AHEAD, chestWith(...Array.from({ length: 36 }, () => stack('stone', 999))), 'farm'), robotOf({ bag: [stack('wood', 1)] }), { kind: 'deposit' }, 'containerFull', 1],
    ['a missing item', withTile(BASE, AHEAD, chestWith(stack('wood', 3)), 'farm'), robotOf(), { kind: 'take', itemId: 'stone' }, 'itemNotFound', 1],
  ];

  it.each(cases)('is blocked by %s, paying its cost and changing nothing else', (_label, state, robot, action, reason, cost) => {
    const placed = withRobots(state, [robot]);
    const plan = planRobotAction(placed, robot, action);
    expect(plan).toMatchObject({ ok: false, reason, cost });
    const next = applyRobotPlan(placed, robot.id, plan);
    expect(next.maps).toBe(placed.maps);
    expect(requireRobot(next, robot.id).tokens).toBe(robot.tokens - cost);
    expect(lastEvent(next)).toEqual({ kind: 'blocked', action: action.kind, reason });
  });
});

describe('scripts advance as robots act', () => {
  it('goes to standby after the last step of a non-looping script, and logs it', () => {
    const robot = robotOf({ program: { kind: 'script', steps: [{ kind: 'turn', side: 'left' }], loop: false } });
    const { next, robot: after } = act(BASE, robot, { kind: 'turn', side: 'left' });
    expect([after.power, after.pc]).toEqual(['standby', 0]);
    expect(lastEvent(next)).toEqual({ kind: 'finished' });
    expect(after.lastAction).toEqual({ seq: 1, kind: 'turn', success: true, bickered: false });
    expect(after.nextActMinute).toBe(BASE.time.minuteOfDay + 4);
  });
});

describe('addRobot', () => {
  const spec = {
    name: 'Sprocket',
    size: 'mini' as const,
    parts: ['wateringHead' as const],
    place: { tx: TARGET.tx, tz: TARGET.tz, facing: Direction.East },
    program: { kind: 'script' as const, steps: [{ kind: 'water' as const }], loop: false },
  };

  it('adds a charged, working robot with a full tank at its place', () => {
    const result = addRobot(BASE, spec);
    if ('error' in result) throw new Error(result.error);
    const robot = requireRobot(result.state, result.id);
    expect(robot).toMatchObject({ id: 1, tokens: 80, tank: ROBOTS.tankCapacity, power: 'working', tx: TARGET.tx, facing: Direction.East, nextActMinute: TIME.dayStartMinute + 4 });
    expect(result.state.robots.nextId).toBe(2);
  });

  it('refuses bad specs without changing the state', () => {
    const bad: readonly (typeof spec | Record<string, unknown>)[] = [
      { ...spec, name: '' },
      { ...spec, parts: ['claw', 'basket'] },
      { ...spec, parts: ['basket', 'claw'], size: 'standard' },
      { ...spec, place: { tx: -1, tz: 0, facing: Direction.North } },
      { ...spec, program: { kind: 'script', steps: [], loop: false } },
    ];
    for (const s of bad) expect('error' in addRobot(BASE, s as typeof spec)).toBe(true);
    const rock = withTile(BASE, TARGET, blockedTile(Blocker.Rock, 2), 'farm');
    expect('error' in addRobot(rock, spec)).toBe(true);
    let full = BASE;
    for (let i = 0; i < ROBOTS.maxRobots; i++) {
      const r = addRobot(full, spec);
      if ('error' in r) throw new Error(r.error);
      full = r.state;
    }
    expect(addRobot(full, spec)).toEqual({ error: 'The farm already has 12 robots.' });
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/robotExecute.test.ts`
Expected: FAIL, "Failed to resolve import ../src/robots/create".

- [ ] **Step 3: Create `src/robots/execute.ts`**

```ts
/**
 * The robot executor (farmclaws part 1 spec §4): plans one robot action against the same tile
 * rules as the player's tools, then applies it and pays for it in tokens. Pure.
 */
import { ROBOTS } from '../config';
import { invariant } from '../core/invariant';
import {
  Blocker,
  TileState,
  type Direction,
  type GameState,
  type ItemStack,
  type Robot,
  type RobotAction,
  type RobotActionKind,
  type RobotBlockReason,
  type RobotDidDetail,
  type RobotLogEvent,
  type TileCoord,
} from '../core/types';
import { CROPS, createCropInstance, isInSeason, isMature, seedItemId } from '../farming/crops';
import { harvestedTile } from '../farming/harvest';
import { getItem } from '../items/items';
import { harvestQuality, harvestQuantity } from '../state/intents';
import { mergeStacks } from '../state/inventory';
import { pushMessage } from '../state/messages';
import { stepTile } from '../world/grid';
import { getTile, isSoil, isWalkable, requireTile, setTile } from '../world/tiles';
import { addToBag, addToSlots, bagCount, bagRoom, removeFromBag, slotsRoom, takeIntoBag } from './bag';
import { logRobotEvent } from './log';
import { canDo } from './parts';
import { actionCost, bagStacks, periodFor } from './stats';
import { chestSlots, containerOf, requireRobot, withFarm, withRobot } from './world';

export type RobotPlan =
  | { readonly ok: true; readonly action: RobotAction; readonly target: TileCoord; readonly cost: number }
  | { readonly ok: false; readonly action: RobotAction; readonly target: TileCoord; readonly reason: RobotBlockReason; readonly cost: number };

type OkPlan = Extract<RobotPlan, { readonly ok: true }>;

/** Actions that work the tile ahead; the rest work the robot's own tile. */
const AHEAD: ReadonlySet<RobotActionKind> = new Set<RobotActionKind>(['move', 'refill', 'deposit', 'take']);

function turned(facing: Direction, side: 'left' | 'right'): Direction {
  return ((facing + (side === 'left' ? 3 : 1)) % 4) as Direction;
}

/** What `action` would do for `robot` now, and what it costs. Reads only the farm, time, shipping and the robot. */
export function planRobotAction(state: GameState, robot: Robot, action: RobotAction): RobotPlan {
  const own: TileCoord = { tx: robot.tx, tz: robot.tz };
  const target = AHEAD.has(action.kind) ? stepTile(own, robot.facing) : own;
  const cost = actionCost(robot, action.kind);
  const ok: RobotPlan = { ok: true, action, target, cost };
  const no = (reason: RobotBlockReason): RobotPlan => ({ ok: false, action, target, reason, cost: reason === 'noPart' ? 0 : cost });
  if (!canDo(robot, action.kind)) return no('noPart');
  const tile = getTile(state.maps.farm, target.tx, target.tz);

  switch (action.kind) {
    case 'move':
      if (tile === null) return no('farmEdge');
      return tile.blocker === Blocker.Water || isWalkable(tile) ? ok : no('bumped');
    case 'turn':
    case 'say':
    case 'wait':
    case 'powerDown':
      return ok;
    case 'water':
      if (robot.tank <= 0) return no('tankEmpty');
      return tile !== null && tile.state === TileState.Plowed ? ok : no('notWaterable');
    case 'harvest': {
      const crop = tile?.crop ?? null;
      if (crop === null || crop.dead || !isMature(crop)) return no('nothingToHarvest');
      const quantity = harvestQuantity(state, target, crop, 'farm');
      const quality = harvestQuality(state, target, crop, 'farm');
      return bagRoom(robot.bag, bagStacks(robot), crop.cropId, quality) >= quantity ? ok : no('bagFull');
    }
    case 'till':
      return tile !== null && tile.state === TileState.Unplowed && tile.object === null && tile.crop === null ? ok : no('notTillable');
    case 'plant': {
      if (bagCount(robot.bag, seedItemId(action.cropId)) === 0) return no('noSeed');
      const def = CROPS[action.cropId];
      if (!isInSeason(def, state.time.season)) return no('outOfSeason');
      const plantable = tile !== null && def.habitat === 'field' && isSoil(tile) && tile.crop === null && tile.object === null;
      return plantable ? ok : no('cannotPlant');
    }
    case 'refill':
      if (tile === null || tile.blocker !== Blocker.Water) return no('noWaterAhead');
      return robot.tank < ROBOTS.tankCapacity ? ok : no('tankFull');
    case 'deposit': {
      const kind = containerOf(tile);
      if (kind === null) return no('nothingAhead');
      if (robot.bag.length === 0) return no('bagEmpty');
      const slots = chestSlots(tile);
      const fits =
        kind === 'bin'
          ? robot.bag.some((s) => getItem(s.itemId).sellPrice !== null)
          : robot.bag.some((s) => slotsRoom(slots, s.itemId, s.quality) > 0);
      return fits ? ok : no('containerFull');
    }
    case 'take': {
      if (containerOf(tile) !== 'chest') return no('nothingAhead');
      const slots = chestSlots(tile);
      if (!slots.some((s) => s !== null && s.itemId === action.itemId)) return no('itemNotFound');
      return takeIntoBag(slots, robot.bag, bagStacks(robot), action.itemId).moved > 0 ? ok : no('bagFull');
    }
  }
}

/**
 * Finishes a robot's turn: advances pc (a non-looping script past its end goes to standby and
 * logs 'finished'), schedules its next action and records lastAction for the renderer.
 */
function settle(state: GameState, robotId: number, action: RobotAction, success: boolean, bickered: boolean): GameState {
  const robot = requireRobot(state, robotId);
  const seq = robot.actionSeq + 1;
  let pc = robot.pc + 1;
  let power = robot.power;
  let finished = false;
  if (pc >= robot.program.steps.length) {
    pc = 0;
    if (!robot.program.loop && power === 'working') {
      power = 'standby';
      finished = true;
    }
  }
  const minute = state.time.minuteOfDay;
  const next = withRobot(state, {
    ...robot,
    pc,
    power,
    nextActMinute: minute + (action.kind === 'wait' ? action.minutes : periodFor(robot)),
    actionSeq: seq,
    lastAction: { seq, kind: action.kind, success, bickered },
  });
  return finished ? logRobotEvent(next, robotId, { kind: 'finished' }) : next;
}

function pay(state: GameState, robotId: number, cost: number): { readonly state: GameState; readonly robot: Robot } {
  const before = requireRobot(state, robotId);
  invariant(before.tokens >= cost, `robot ${robotId} can't afford ${cost} tokens`);
  const robot = { ...before, tokens: before.tokens - cost, tokensToday: before.tokensToday + cost };
  return { state: withRobot(state, robot), robot };
}

/** Pays for `plan`, carries it out (or logs why not) and settles the robot's turn. */
export function applyRobotPlan(state: GameState, robotId: number, plan: RobotPlan): GameState {
  const paid = pay(state, robotId, plan.cost);
  if (!plan.ok) {
    const logged = logRobotEvent(paid.state, robotId, { kind: 'blocked', action: plan.action.kind, reason: plan.reason });
    return settle(logged, robotId, plan.action, false, false);
  }
  const { next, event } = perform(paid.state, paid.robot, plan);
  return settle(logRobotEvent(next, robotId, event), robotId, plan.action, true, false);
}

/** A bicker: the robot pays, the world doesn't change, and the clash is logged with the other robots' ids. */
export function applyBickerPlan(state: GameState, robotId: number, plan: RobotPlan, withIds: readonly number[]): GameState {
  const paid = pay(state, robotId, plan.cost);
  const logged = logRobotEvent(paid.state, robotId, { kind: 'bickered', action: plan.action.kind, withIds });
  return settle(logged, robotId, plan.action, false, true);
}

function perform(state: GameState, robot: Robot, plan: OkPlan): { readonly next: GameState; readonly event: RobotLogEvent } {
  const { action, target } = plan;
  const farm = state.maps.farm;
  const did = (detail: RobotDidDetail): RobotLogEvent => ({ kind: 'did', action: action.kind, detail });
  const none = did({ kind: 'none' });

  switch (action.kind) {
    case 'move': {
      const moved: Robot = { ...robot, tx: target.tx, tz: target.tz, moveSeq: robot.moveSeq + 1 };
      if (requireTile(farm, target.tx, target.tz).blocker === Blocker.Water) {
        const broken = withRobot(state, { ...moved, power: 'broken' });
        return { next: pushMessage(broken, `${robot.name} drove into the water and shorted out.`, 'warn'), event: { kind: 'shortedOut' } };
      }
      return { next: withRobot(state, moved), event: none };
    }
    case 'turn':
      return { next: withRobot(state, { ...robot, facing: turned(robot.facing, action.side) }), event: none };
    case 'water': {
      const tile = requireTile(farm, target.tx, target.tz);
      const wet = withFarm(state, setTile(farm, target.tx, target.tz, { ...tile, state: TileState.Watered }));
      return { next: withRobot(wet, { ...robot, tank: robot.tank - 1 }), event: did({ kind: 'tile' }) };
    }
    case 'harvest': {
      const tile = requireTile(farm, target.tx, target.tz);
      const crop = tile.crop;
      invariant(crop !== null, 'harvest plan without a crop');
      const quantity = harvestQuantity(state, target, crop, 'farm');
      const quality = harvestQuality(state, target, crop, 'farm');
      const { bag } = addToBag(robot.bag, bagStacks(robot), crop.cropId, quantity, quality);
      const next = withRobot(withFarm(state, setTile(farm, target.tx, target.tz, harvestedTile(tile))), { ...robot, bag });
      return { next, event: did({ kind: 'crop', cropId: crop.cropId, quantity, quality }) };
    }
    case 'till': {
      const tile = requireTile(farm, target.tx, target.tz);
      return { next: withFarm(state, setTile(farm, target.tx, target.tz, { ...tile, state: TileState.Plowed })), event: did({ kind: 'tile' }) };
    }
    case 'plant': {
      const tile = requireTile(farm, target.tx, target.tz);
      const crop = createCropInstance(action.cropId, state.time.absoluteDay);
      const planted = withFarm(state, setTile(farm, target.tx, target.tz, { ...tile, crop }));
      const bag = removeFromBag(robot.bag, seedItemId(action.cropId), 1);
      return { next: withRobot(planted, { ...robot, bag }), event: did({ kind: 'planted', cropId: action.cropId }) };
    }
    case 'refill':
      return { next: withRobot(state, { ...robot, tank: ROBOTS.tankCapacity }), event: none };
    case 'deposit':
      return deposit(state, robot, target);
    case 'take': {
      const tile = requireTile(farm, target.tx, target.tz);
      const taken = takeIntoBag(chestSlots(tile), robot.bag, bagStacks(robot), action.itemId);
      const chest = withFarm(state, setTile(farm, target.tx, target.tz, { ...tile, object: { kind: 'chest', slots: taken.slots } }));
      return {
        next: withRobot(chest, { ...robot, bag: taken.bag }),
        event: did({ kind: 'items', into: 'bag', stacks: taken.stacks, quantity: taken.moved }),
      };
    }
    case 'say':
    case 'wait':
      return { next: state, event: none };
    case 'powerDown':
      return { next: withRobot(state, { ...robot, power: 'standby' }), event: { kind: 'poweredDown' } };
  }
}

function deposit(state: GameState, robot: Robot, target: TileCoord): { readonly next: GameState; readonly event: RobotLogEvent } {
  const farm = state.maps.farm;
  const tile = requireTile(farm, target.tx, target.tz);
  const kept: ItemStack[] = [];
  let stacks = 0;
  let quantity = 0;
  if (containerOf(tile) === 'bin') {
    let pending = state.shipping.pending;
    for (const s of robot.bag) {
      if (getItem(s.itemId).sellPrice === null) {
        kept.push(s);
        continue;
      }
      pending = mergeStacks(pending, s);
      stacks++;
      quantity += s.quantity;
    }
    const next = withRobot({ ...state, shipping: { ...state.shipping, pending } }, { ...robot, bag: kept });
    return { next, event: { kind: 'did', action: 'deposit', detail: { kind: 'items', into: 'bin', stacks, quantity } } };
  }
  let slots = chestSlots(tile);
  for (const s of robot.bag) {
    const result = addToSlots(slots, s);
    slots = result.slots;
    if (result.added > 0) {
      stacks++;
      quantity += result.added;
    }
    if (result.added < s.quantity) kept.push({ ...s, quantity: s.quantity - result.added });
  }
  const chest = withFarm(state, setTile(farm, target.tx, target.tz, { ...tile, object: { kind: 'chest', slots } }));
  return {
    next: withRobot(chest, { ...robot, bag: kept }),
    event: { kind: 'did', action: 'deposit', detail: { kind: 'items', into: 'chest', stacks, quantity } },
  };
}
```

- [ ] **Step 4: Create `src/robots/create.ts`**

```ts
/**
 * Adding robots to the farm (farmclaws part 1 spec §3.4).
 */
import { ROBOTS } from '../config';
import { ROBOT_PART_IDS, type GameState, type Robot, type RobotPartId, type RobotPlace, type RobotProgram, type RobotSize } from '../core/types';
import { isValidRobotProgram } from '../state/robotValidation';
import { isValidName } from '../state/sectionValidation';
import { isCanonicalSubset } from '../state/validation';
import { MAPS, isReservedTile } from '../world/maps';
import { getTile, isWalkable } from '../world/tiles';
import { batteryFor, hasPart, periodFor } from './stats';

export interface RobotSpec {
  readonly name: string;
  readonly size: RobotSize;
  readonly parts: readonly RobotPartId[];
  /** Where it's delivered. */
  readonly place: RobotPlace;
  readonly program: RobotProgram;
}

export type AddRobotResult = { readonly state: GameState; readonly id: number } | { readonly error: string };

function specProblem(state: GameState, spec: RobotSpec): string | null {
  if (state.robots.list.length >= ROBOTS.maxRobots) return `The farm already has ${ROBOTS.maxRobots} robots.`;
  if (!isValidName(spec.name)) return 'A robot needs a name of 1 to 24 characters.';
  if (!isCanonicalSubset(spec.parts, ROBOT_PART_IDS)) return 'Parts must be listed once each, in catalogue order.';
  if (spec.parts.length > ROBOTS.sizes[spec.size].partSlots) return `A ${spec.size} robot has room for ${ROBOTS.sizes[spec.size].partSlots} parts.`;
  if (!isValidRobotProgram(spec.program)) return 'That program is not a valid script.';
  const { tx, tz } = spec.place;
  const tile = getTile(state.maps.farm, tx, tz);
  if (tile === null || !isWalkable(tile) || isReservedTile(MAPS.farm, tx, tz)) return 'Robots are delivered to open ground on the farm.';
  return null;
}

/** Adds a robot at `spec.place`, fully charged (not from the pool), working and not carried. */
export function addRobot(state: GameState, spec: RobotSpec): AddRobotResult {
  const problem = specProblem(state, spec);
  if (problem !== null) return { error: problem };
  const id = state.robots.nextId;
  const robot: Robot = {
    id,
    name: spec.name,
    size: spec.size,
    parts: spec.parts,
    tx: spec.place.tx,
    tz: spec.place.tz,
    facing: spec.place.facing,
    bag: [],
    tank: hasPart(spec, 'wateringHead') ? ROBOTS.tankCapacity : 0,
    tokens: batteryFor(spec.size),
    power: 'working',
    carried: false,
    program: spec.program,
    pc: 0,
    nextActMinute: state.time.minuteOfDay + periodFor(spec),
    repairReadyDay: null,
    tokensToday: 0,
    moveSeq: 0,
    teleportSeq: 0,
    actionSeq: 0,
    lastAction: null,
  };
  return { state: { ...state, robots: { ...state.robots, nextId: id + 1, list: [...state.robots.list, robot] } }, id };
}
```

- [ ] **Step 5: Run the tests, typecheck and the full suite**

Run: `npx vitest run tests/robotExecute.test.ts && npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/robots/execute.ts src/robots/create.ts tests/robotExecute.test.ts
git commit -m "Farmclaws part 1: the robot executor and addRobot

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Parity with the player's tools

**Files:**
- Test: `tests/robotParity.test.ts`

**Interfaces:**
- Consumes: `planRobotAction`, `planPrimaryAction`, test helpers.

- [ ] **Step 1: Write the test**

```ts
/**
 * Robots follow the player's tile rules: for every kind of tile, a robot's till, water and
 * harvest succeed exactly when the player's hoe, watering can and scythe would, and a
 * harvest yields the same size and quality.
 */
import { describe, expect, it } from 'vitest';
import { Blocker, TileState, type GameState, type Tile } from '../src/core/types';
import { planRobotAction } from '../src/robots/execute';
import { planPrimaryAction } from '../src/state/intents';
import { forEachTile, blockedTile, EMPTY_TILE } from '../src/world/tiles';
import { BASE, Violations, cropOf, holding, matureCrop, robotOf, scenario, soilTile, withRobots } from './testUtils';

function distinctFarmTiles(): Tile[] {
  const seen = new Map<string, Tile>();
  forEachTile(BASE.maps.farm, (tile) => {
    seen.set(JSON.stringify(tile), tile);
  });
  const crafted: Tile[] = [
    EMPTY_TILE,
    soilTile(TileState.Plowed),
    soilTile(TileState.Watered),
    soilTile(TileState.Plowed, cropOf('parsnip')),
    soilTile(TileState.Watered, matureCrop('parsnip')),
    soilTile(TileState.Watered, matureCrop('strawberry')),
    soilTile(TileState.Plowed, matureCrop('parsnip', { dead: true })),
    { ...EMPTY_TILE, crop: matureCrop('mushroom', { wild: true }) },
    { ...soilTile(TileState.Plowed), fertilizer: 'quality' },
    { ...soilTile(TileState.Watered, matureCrop('cauliflower')), fertilizer: 'quality' },
    { ...EMPTY_TILE, object: { kind: 'woodPath' } },
    { ...soilTile(TileState.Plowed), object: { kind: 'sprinkler' } },
    blockedTile(Blocker.Rock, 2),
    blockedTile(Blocker.Water),
    blockedTile(Blocker.Weeds),
  ];
  for (const tile of crafted) seen.set(JSON.stringify(tile), tile);
  return [...seen.values()];
}

/** A Big robot on the scenario's target tile, with `overrides` (its parts). */
function robotOn(state: GameState, overrides: Parameters<typeof robotOf>[0]) {
  const robot = robotOf({ size: 'big', tank: 5, ...overrides });
  return { robot, state: withRobots(state, [robot]) };
}

describe('robot and player tile rules agree', () => {
  it('for tilling, watering and harvesting on every kind of farm tile', () => {
    const v = new Violations();
    for (const tile of distinctFarmTiles()) {
      const state = scenario(tile);
      const label = JSON.stringify(tile);

      const hoe = planPrimaryAction(holding(state, 'hoe')).intent.kind === 'till';
      const tiller = robotOn(state, { parts: ['tiller'] });
      v.equal(`till ${label}`, planRobotAction(tiller.state, tiller.robot, { kind: 'till' }).ok, hoe);

      const can = planPrimaryAction(holding(state, 'wateringCan')).intent.kind === 'water';
      const waterer = robotOn(state, { parts: ['wateringHead'] });
      v.equal(`water ${label}`, planRobotAction(waterer.state, waterer.robot, { kind: 'water' }).ok, can);

      const scythe = planPrimaryAction(holding(state, 'scythe')).intent;
      const harvester = robotOn(state, { parts: ['claw', 'basket'] });
      const robotHarvest = planRobotAction(harvester.state, harvester.robot, { kind: 'harvest' });
      v.equal(`harvest ${label}`, robotHarvest.ok, scythe.kind === 'harvest');
    }
    expect(v.head()).toEqual([]);
  });
});
```

The size and quality equality is already pinned by Task 5's harvest test, which compares the robot's bag to `harvestQuantity`/`harvestQuality` for the farm.

- [ ] **Step 2: Run it**

Run: `npx vitest run tests/robotParity.test.ts`
Expected: PASS. If it fails, the robot rule in `planRobotAction` differs from the player's. Fix `execute.ts` to match `intents.ts`, never the other way round.

- [ ] **Step 3: Commit**

```bash
git add tests/robotParity.test.ts
git commit -m "Farmclaws part 1: robot and player tile-rule parity test

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Log text

**Files:**
- Create: `src/robots/logText.ts`
- Test: `tests/robotLogText.test.ts`

**Interfaces:**
- Consumes: `RobotLogEntry`, `CROPS`, `ROBOT_BLOCK_REASONS`, `ROBOT_ACTION_KINDS`.
- Produces: `robotSays(entry: RobotLogEntry): string` and `whatHappened(entry: RobotLogEntry, names: ReadonlyMap<number, string>): string`.

- [ ] **Step 1: Write the failing test `tests/robotLogText.test.ts`**

```ts
/**
 * Every log event has an innocent "Robot says" line ending in ✓ and a truthful "What happened" line.
 */
import { describe, expect, it } from 'vitest';
import { ROBOT_BLOCK_REASONS, type RobotLogEntry, type RobotLogEvent } from '../src/core/types';
import { robotSays, whatHappened } from '../src/robots/logText';
import { ROBOT_ACTION_KINDS } from '../src/robots/parts';

const entry = (event: RobotLogEvent): RobotLogEntry => ({ id: 0, day: 0, minute: 400, robotId: 1, tx: 5, tz: 10, event, count: 1 });
const names = new Map([[1, 'Sprocket'], [2, 'Bolt'], [3, 'Cog']]);

function everyEvent(): RobotLogEvent[] {
  const events: RobotLogEvent[] = [
    { kind: 'shortedOut' },
    { kind: 'flat' },
    { kind: 'finished' },
    { kind: 'poweredDown' },
    { kind: 'repaired' },
    { kind: 'bickered', action: 'harvest', withIds: [2, 3] },
    { kind: 'did', action: 'harvest', detail: { kind: 'crop', cropId: 'parsnip', quantity: 2, quality: 1 } },
    { kind: 'did', action: 'plant', detail: { kind: 'planted', cropId: 'potato' } },
    { kind: 'did', action: 'deposit', detail: { kind: 'items', into: 'bin', stacks: 2, quantity: 7 } },
    { kind: 'did', action: 'take', detail: { kind: 'items', into: 'bag', stacks: 1, quantity: 3 } },
  ];
  for (const action of ROBOT_ACTION_KINDS) events.push({ kind: 'did', action, detail: { kind: 'none' } });
  for (const action of ROBOT_ACTION_KINDS) for (const reason of ROBOT_BLOCK_REASONS) events.push({ kind: 'blocked', action, reason });
  return events;
}

describe('log text', () => {
  it('gives every event a ✓ line and a truthful line', () => {
    for (const event of everyEvent()) {
      const e = entry(event);
      expect(robotSays(e)).toMatch(/ ✓$/);
      const truth = whatHappened(e, names);
      expect(truth.length).toBeGreaterThan(5);
      expect(truth).not.toContain('✓');
    }
  });

  it('speaks plainly about specific outcomes', () => {
    expect(whatHappened(entry({ kind: 'did', action: 'harvest', detail: { kind: 'crop', cropId: 'parsnip', quantity: 2, quality: 1 } }), names)).toBe('Harvested Silver Parsnip ×2.');
    expect(whatHappened(entry({ kind: 'bickered', action: 'harvest', withIds: [2, 3] }), names)).toBe('Fought Bolt and Cog over the same tile. Nobody got it.');
    expect(whatHappened(entry({ kind: 'blocked', action: 'harvest', reason: 'nothingToHarvest' }), names)).toBe('Tried to harvest, but nothing was ready.');
    expect(whatHappened(entry({ kind: 'shortedOut' }), names)).toBe('Drove into the water and shorted out.');
    expect(robotSays(entry({ kind: 'shortedOut' }))).toBe('Taking a swim ✓');
    expect(robotSays(entry({ kind: 'blocked', action: 'harvest', reason: 'bagFull' }))).toBe('Harvested ✓');
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/robotLogText.test.ts`
Expected: FAIL, "Failed to resolve import ../src/robots/logText".

- [ ] **Step 3: Create `src/robots/logText.ts`**

```ts
/**
 * The two columns of a robot's log (farmclaws part 1 spec §8.3). "Robot says" is innocent and
 * always ends in ✓; "What happened" is the truth. Part 6 swaps in personality voices for the first.
 */
import type { Quality, RobotActionKind, RobotBlockReason, RobotLogEntry, RobotLogEvent } from '../core/types';
import { CROPS } from '../farming/crops';

const SAYS: Readonly<Record<RobotActionKind, string>> = {
  move: 'Moved forward',
  turn: 'Turned',
  water: 'Watered',
  harvest: 'Harvested',
  till: 'Tilled',
  plant: 'Planted',
  refill: 'Topped up',
  deposit: 'Deposited',
  take: 'Picked up supplies',
  say: 'Said my piece',
  wait: 'Waited',
  powerDown: 'Powering down',
};

const VERB: Readonly<Record<RobotActionKind, string>> = {
  move: 'move',
  turn: 'turn',
  water: 'water',
  harvest: 'harvest',
  till: 'till',
  plant: 'plant',
  refill: 'refill',
  deposit: 'deposit',
  take: 'take something',
  say: 'speak',
  wait: 'wait',
  powerDown: 'power down',
};

const BLOCKED: Readonly<Record<RobotBlockReason, (verb: string) => string>> = {
  noPart: (verb) => `Tried to ${verb}, but it doesn't have the part for that.`,
  bumped: () => 'Bumped into something: nothing moved.',
  farmEdge: () => 'Reached the edge of the farm: nothing moved.',
  nothingToHarvest: () => 'Tried to harvest, but nothing was ready.',
  bagFull: () => 'Its bag was full, so nothing went in.',
  tankEmpty: () => 'Its water tank was empty: nothing got watered.',
  tankFull: () => 'Tried to refill a tank that was already full.',
  notTillable: () => "Tried to till ground that can't be tilled.",
  notWaterable: () => 'Tried to water, but there was no dry tilled soil there.',
  noSeed: () => 'Tried to plant, but had no seeds of that kind.',
  cannotPlant: () => 'Tried to plant where nothing can be planted.',
  outOfSeason: () => "Tried to plant a crop that won't grow this season.",
  noWaterAhead: () => 'Tried to refill with no water in front of it.',
  nothingAhead: () => "Reached for a chest or bin that isn't there.",
  bagEmpty: () => 'Tried to deposit with an empty bag.',
  containerFull: () => 'Nothing in its bag would go in.',
  itemNotFound: () => "Looked in the chest for something it doesn't hold.",
};

const DID: Readonly<Record<RobotActionKind, string>> = {
  move: 'Moved one tile.',
  turn: 'Turned on the spot.',
  water: 'Watered the soil.',
  harvest: 'Harvested.',
  till: 'Tilled the ground.',
  plant: 'Planted.',
  refill: 'Filled its water tank.',
  deposit: 'Deposited its bag.',
  take: 'Took from the chest.',
  say: 'Spoke up.',
  wait: 'Waited.',
  powerDown: 'Powered down.',
};

function qualityPrefix(quality: Quality): string {
  return quality === 2 ? 'Gold ' : quality === 1 ? 'Silver ' : '';
}

function listNames(ids: readonly number[], names: ReadonlyMap<number, string>): string {
  const list = ids.map((id) => names.get(id) ?? `robot ${id}`);
  return list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list[list.length - 1] ?? ''}` : (list[0] ?? 'another robot');
}

/** The robot's own report: always a success, always ending in ✓. */
export function robotSays(entry: RobotLogEntry): string {
  const event = entry.event;
  switch (event.kind) {
    case 'did':
    case 'blocked':
      return `${SAYS[event.action]} ✓`;
    case 'bickered':
      return 'Waiting my turn ✓';
    case 'shortedOut':
      return 'Taking a swim ✓';
    case 'flat':
      return 'Resting ✓';
    case 'finished':
      return 'All done ✓';
    case 'poweredDown':
      return 'Powering down ✓';
    case 'repaired':
      return 'Good as new ✓';
  }
}

function didText(event: Extract<RobotLogEvent, { readonly kind: 'did' }>): string {
  const d = event.detail;
  switch (d.kind) {
    case 'crop':
      return `Harvested ${qualityPrefix(d.quality)}${CROPS[d.cropId].name} ×${d.quantity}.`;
    case 'planted':
      return `Planted ${CROPS[d.cropId].name}.`;
    case 'items':
      if (d.into === 'bag') return `Took ${d.quantity} from the chest.`;
      return `Put ${d.quantity} ${d.quantity === 1 ? 'item' : 'items'} in the ${d.into === 'bin' ? 'shipping bin' : 'chest'}.`;
    case 'none':
    case 'tile':
      return DID[event.action];
  }
}

/** What really happened, in plain words. */
export function whatHappened(entry: RobotLogEntry, names: ReadonlyMap<number, string>): string {
  const event = entry.event;
  switch (event.kind) {
    case 'did':
      return didText(event);
    case 'blocked':
      return BLOCKED[event.reason](VERB[event.action]);
    case 'bickered':
      return `Fought ${listNames(event.withIds, names)} over the same tile. Nobody got it.`;
    case 'shortedOut':
      return 'Drove into the water and shorted out.';
    case 'flat':
      return 'Ran out of power.';
    case 'finished':
      return 'Finished its program and went to standby.';
    case 'poweredDown':
      return 'Powered down.';
    case 'repaired':
      return 'Came back from repairs.';
  }
}
```

- [ ] **Step 4: Run the tests and typecheck**

Run: `npx vitest run tests/robotLogText.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/robots/logText.ts tests/robotLogText.test.ts
git commit -m "Farmclaws part 1: robot log text

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Running robots minute by minute

**Files:**
- Create: `src/robots/run.ts`
- Modify: `src/state/reducer.ts` (`tick`)
- Test: `tests/robotRun.test.ts`, `tests/robotTickBatching.test.ts`

**Interfaces:**
- Consumes: `planRobotAction`, `applyRobotPlan`, `applyBickerPlan`, `logRobotEvent`, `pushMessage`.
- Produces: `runRobotsMinute(state): GameState` and `runRobotsThrough(state, lastMinute): GameState`.

- [ ] **Step 1: Write the failing test `tests/robotRun.test.ts`**

```ts
/**
 * Robots acting on the shared rhythm inside time/tick: scripts, going flat, bickering,
 * re-planning after another robot, waiting and carried robots.
 */
import { describe, expect, it } from 'vitest';
import { TileState, type GameState, type Robot, type RobotAction } from '../src/core/types';
import { requireRobot } from '../src/robots/world';
import { actions } from '../src/state/actions';
import { gameReducer } from '../src/state/reducer';
import { EMPTY_TILE } from '../src/world/tiles';
import { BASE, TARGET, matureCrop, robotOf, soilTile, stack, tileAt, withRobots, withTile } from './testUtils';

const AHEAD = { tx: TARGET.tx, tz: TARGET.tz + 1 };
const script = (steps: RobotAction[], loop = true): Robot['program'] => ({ kind: 'script', steps, loop });
const tick = (state: GameState, minutes: number) => gameReducer(state, actions.tick(minutes));
const events = (state: GameState, id: number) => state.robots.log.entries.filter((e) => e.robotId === id).map((e) => e.event.kind);

describe('robots in the tick', () => {
  it('act on the shared rhythm: first at 6:04, then every 4 minutes', () => {
    const state = withRobots(BASE, [robotOf()]);
    expect(requireRobot(tick(state, 3), 1).actionSeq).toBe(0);
    expect(requireRobot(tick(state, 4), 1).actionSeq).toBe(1);
    expect(requireRobot(tick(state, 12), 1).actionSeq).toBe(3);
  });

  it('go flat when they cannot pay, keep their step, and toast it', () => {
    const state = withRobots(BASE, [robotOf({ tokens: 0, program: script([{ kind: 'move' }]) })]);
    const next = tick(state, 4);
    const robot = requireRobot(next, 1);
    expect([robot.power, robot.pc, robot.actionSeq]).toEqual(['flat', 0, 0]);
    expect(events(next, 1)).toEqual(['flat']);
    expect(next.messages.entries.at(-1)?.text).toBe('Sprocket ran out of power.');
    expect(requireRobot(tick(next, 60), 1).actionSeq).toBe(0);
  });

  it('bicker over one tile: both pay, the crop stays, both are logged', () => {
    const field = withTile(BASE, TARGET, soilTile(TileState.Watered, matureCrop('parsnip')), 'farm');
    const harvest = script([{ kind: 'harvest' }]);
    const state = withRobots(field, [robotOf({ id: 1, program: harvest }), robotOf({ id: 2, name: 'Bolt', program: harvest })]);
    const next = tick(state, 4);
    expect(tileAt(next, TARGET, 'farm').crop).not.toBeNull();
    for (const id of [1, 2]) {
      const robot = requireRobot(next, id);
      expect(robot.tokens).toBe(77);
      expect(robot.lastAction).toMatchObject({ success: false, bickered: true });
    }
    expect(next.robots.log.entries.map((e) => e.event)).toEqual([
      { kind: 'bickered', action: 'harvest', withIds: [2] },
      { kind: 'bickered', action: 'harvest', withIds: [1] },
    ]);
  });

  it('re-plan after an earlier robot empties a chest in the same minute', () => {
    const chest = { ...EMPTY_TILE, object: { kind: 'chest' as const, slots: Array.from({ length: 36 }, (_, i) => (i === 0 ? stack('parsnip', 1) : null)) } };
    const state = withRobots(withTile(BASE, AHEAD, chest, 'farm'), [
      robotOf({ id: 1, program: script([{ kind: 'take', itemId: 'parsnip' }]) }),
      robotOf({ id: 2, name: 'Bolt', program: script([{ kind: 'take', itemId: 'parsnip' }]) }),
    ]);
    const next = tick(state, 4);
    expect(requireRobot(next, 1).bag).toEqual([stack('parsnip', 1)]);
    expect(requireRobot(next, 2).bag).toEqual([]);
    expect(requireRobot(next, 2).tokens).toBe(79);
    expect(next.robots.log.entries.at(-1)?.event).toEqual({ kind: 'blocked', action: 'take', reason: 'itemNotFound' });
  });

  it('wait, and never act while carried', () => {
    const waiting = withRobots(BASE, [robotOf({ program: script([{ kind: 'wait', minutes: 30 }, { kind: 'turn', side: 'right' }]) })]);
    expect(requireRobot(tick(waiting, 33), 1).actionSeq).toBe(1);
    expect(requireRobot(tick(waiting, 34), 1).actionSeq).toBe(2);
    const carried = withRobots({ ...BASE, player: { ...BASE.player, carrying: 1 } }, [robotOf({ carried: true })]);
    expect(requireRobot(tick(carried, 60), 1).actionSeq).toBe(0);
  });

  it('leaves an idle farm untouched apart from the clock', () => {
    const state = withRobots(BASE, [robotOf({ power: 'standby' })]);
    const next = tick(state, 30);
    expect(next.robots).toBe(state.robots);
    expect(next.maps).toBe(state.maps);
    expect(next.time.minuteOfDay).toBe(BASE.time.minuteOfDay + 30);
  });
});
```

- [ ] **Step 2: Write the failing test `tests/robotTickBatching.test.ts`**

```ts
/**
 * Review focus 2: however minutes arrive (one big tick, or the same minutes one at a time),
 * robots produce exactly the same state, including a tick that ends exactly at pass-out. (The
 * game drops a tick's minutes past pass-out, with or without robots, so the late run's first
 * tick is sized to land on it.)
 */
import { describe, expect, it } from 'vitest';
import { TIME } from '../src/config';
import { mulberry32 } from '../src/core/hash';
import { CROP_IDS, DIRECTIONS, ROBOT_PART_IDS, ROBOT_SIZES, type GameState, type RobotAction, type RobotPartId } from '../src/core/types';
import { addRobot } from '../src/robots/create';
import { ROBOT_ACTION_KINDS } from '../src/robots/parts';
import { actions } from '../src/state/actions';
import { serializeGame } from '../src/state/persistence';
import { gameReducer } from '../src/state/reducer';
import { atDay, BASE, HEAVY_TEST_TIMEOUT_MS, must } from './testUtils';

function pick<T>(rng: () => number, list: readonly T[]): T {
  return must(list[Math.floor(rng() * list.length)]);
}

function randomAction(rng: () => number): RobotAction {
  const kind = pick(rng, ROBOT_ACTION_KINDS);
  switch (kind) {
    case 'turn':
      return { kind, side: rng() < 0.5 ? 'left' : 'right' };
    case 'plant':
      return { kind, cropId: pick(rng, CROP_IDS) };
    case 'take':
      return { kind, itemId: 'parsnip_seeds' };
    case 'say':
      return { kind, text: 'Hello' };
    case 'wait':
      return { kind, minutes: 1 + Math.floor(rng() * 40) };
    default:
      return { kind };
  }
}

function farmWithRobots(seed: number): GameState {
  const rng = mulberry32(seed);
  let state = atDay(BASE, 0, TIME.dayStartMinute);
  const count = 1 + Math.floor(rng() * 12);
  for (let i = 0; i < count; i++) {
    const size = pick(rng, ROBOT_SIZES);
    const parts = ROBOT_PART_IDS.filter(() => rng() < 0.35).slice(0, size === 'mini' ? 1 : size === 'standard' ? 2 : 3) as RobotPartId[];
    const steps = Array.from({ length: 1 + Math.floor(rng() * 10) }, () => randomAction(rng));
    const result = addRobot(state, {
      name: `R${i}`,
      size,
      parts,
      place: { tx: 1 + Math.floor(rng() * 16), tz: 9 + Math.floor(rng() * 8), facing: pick(rng, DIRECTIONS) },
      program: { kind: 'script', steps, loop: rng() < 0.7 },
    });
    if (!('error' in result)) state = result.state;
  }
  return state;
}

describe('tick batching', () => {
  it(
    'gives the same state for big and minute ticks, across pass-out too',
    () => {
      for (let seed = 1; seed <= 50; seed++) {
        const start = farmWithRobots(seed);
        const late = { ...start, time: { ...start.time, minuteOfDay: TIME.passOutMinute - 90 } };
        const runs: readonly [GameState, readonly number[]][] = [
          [start, [120, 120, 120]],
          [late, [90, 120, 120]],
        ];
        for (const [from, chunks] of runs) {
          let big = from;
          let small = from;
          for (const chunk of chunks) {
            big = gameReducer(big, actions.tick(chunk));
            for (let m = 0; m < chunk; m++) small = gameReducer(small, actions.tick(1));
          }
          expect(serializeGame(big)).toBe(serializeGame(small));
        }
      }
    },
    HEAVY_TEST_TIMEOUT_MS,
  );
});
```

- [ ] **Step 3: Run both to see them fail**

Run: `npx vitest run tests/robotRun.test.ts tests/robotTickBatching.test.ts`
Expected: FAIL (robots never act).

- [ ] **Step 4: Create `src/robots/run.ts`**

```ts
/**
 * Robots acting minute by minute (farmclaws part 1 spec §5.1–5.3). Pure.
 */
import type { GameState, RobotActionKind } from '../core/types';
import { invariant } from '../core/invariant';
import { pushMessage } from '../state/messages';
import { applyBickerPlan, applyRobotPlan, planRobotAction, type RobotPlan } from './execute';
import { logRobotEvent } from './log';
import { requireRobot, withRobot } from './world';

/** Tile actions two robots can't share in one minute. */
const BICKER_ACTIONS: ReadonlySet<RobotActionKind> = new Set<RobotActionKind>(['harvest', 'water', 'till', 'plant']);

function goFlat(state: GameState, robotId: number): GameState {
  const robot = requireRobot(state, robotId);
  const flat = logRobotEvent(withRobot(state, { ...robot, power: 'flat' }), robotId, { kind: 'flat' });
  return pushMessage(flat, `${robot.name} ran out of power.`, 'warn');
}

/**
 * One minute (state.time.minuteOfDay is the minute being processed): every due robot chooses
 * against the state at the start of the minute; robots that can't pay go flat; successful
 * tile actions on a shared tile bicker; the rest are re-planned and applied in id order.
 */
export function runRobotsMinute(state: GameState): GameState {
  const minute = state.time.minuteOfDay;
  const due = state.robots.list.filter((r) => !r.carried && r.power === 'working' && r.nextActMinute <= minute);
  if (due.length === 0) return state;

  let next = state;
  const chosen: { readonly id: number; readonly plan: RobotPlan }[] = [];
  for (const robot of due) {
    const action = robot.program.steps[robot.pc];
    invariant(action !== undefined, `robot ${robot.id} pc ${robot.pc} outside its script`);
    const plan = planRobotAction(state, robot, action);
    if (robot.tokens < plan.cost) next = goFlat(next, robot.id);
    else chosen.push({ id: robot.id, plan });
  }

  const byTile = new Map<string, number[]>();
  for (const { id, plan } of chosen) {
    if (!plan.ok || !BICKER_ACTIONS.has(plan.action.kind)) continue;
    const key = `${plan.target.tx},${plan.target.tz}`;
    byTile.set(key, [...(byTile.get(key) ?? []), id]);
  }
  const rivals = new Map<number, readonly number[]>();
  for (const ids of byTile.values()) {
    if (ids.length < 2) continue;
    for (const id of ids) rivals.set(id, ids.filter((other) => other !== id));
  }

  for (const { id, plan } of chosen) {
    const others = rivals.get(id);
    if (others !== undefined) {
      next = applyBickerPlan(next, id, plan, others);
      continue;
    }
    next = applyRobotPlan(next, id, planRobotAction(next, requireRobot(next, id), plan.action));
  }
  return next;
}

/** Runs every minute after the current one up to and including `lastMinute`. */
export function runRobotsThrough(state: GameState, lastMinute: number): GameState {
  let next = state;
  for (let minute = state.time.minuteOfDay + 1; minute <= lastMinute; minute++) {
    next = runRobotsMinute({ ...next, time: { ...next.time, minuteOfDay: minute } });
  }
  return next;
}
```

- [ ] **Step 5: Make `tick` advance minute by minute in `src/state/reducer.ts`**

Import `runRobotsThrough` from `../robots/run`. Replace `tick` with:

```ts
/**
 * Advances the clock. With robots on the farm it goes one minute at a time so every robot acts
 * on its minute (farmclaws part 1 §5.5); however the minutes arrive, the result is the same.
 */
function tick(state: GameState, minutes: number): GameState {
  if (selectIsFrozen(state) || !Number.isFinite(minutes)) return state;
  const whole = Math.min(TIME.maxTickMinutes, Math.floor(minutes));
  if (whole <= 0) return state;
  const target = state.time.minuteOfDay + whole;
  if (target >= TIME.passOutMinute) return startNextDay(runRobotsThrough(state, TIME.passOutMinute - 1), true);
  if (state.robots.list.length === 0) return { ...state, time: { ...state.time, minuteOfDay: target } };
  return runRobotsThrough(state, target);
}
```

- [ ] **Step 6: Run the tests and the full suite**

Run: `npx vitest run tests/robotRun.test.ts tests/robotTickBatching.test.ts && npm run typecheck && npm test`
Expected: PASS. The existing determinism test still passes: it has no robots, and its clock values are unchanged.

- [ ] **Step 7: Commit**

```bash
git add src/robots/run.ts src/state/reducer.ts tests/robotRun.test.ts tests/robotTickBatching.test.ts
git commit -m "Farmclaws part 1: robots act minute by minute in the tick

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Overnight

**Files:**
- Create: `src/robots/overnight.ts`
- Modify: `src/state/reducer.ts` (`startNextDay`)
- Test: `tests/robotOvernight.test.ts`

**Interfaces:**
- Consumes: `nearestWalkable`, `withRobot`, `withFarm`, `logRobotEvent`, `pruneRobotLog`, `batteryFor`, `periodFor`, `GENERATORS`, `ROBOTS`, `PLAYER`.
- Produces: `interface RobotNote { text: string; tone: MessageTone }` and `runRobotsOvernight(state): { state: GameState; notes: readonly RobotNote[] }`.

- [ ] **Step 1: Write the failing test `tests/robotOvernight.test.ts`**

```ts
/**
 * The robots' night (farmclaws part 1 spec §5.7): generators, set-down, repairs, recharge near
 * a generator, and the morning reset where robots stay where they are.
 */
import { describe, expect, it } from 'vitest';
import { PLAYER, ROBOTS, TIME } from '../src/config';
import { Blocker, Direction, type GameState } from '../src/core/types';
import { requireRobot } from '../src/robots/world';
import { actions } from '../src/state/actions';
import { isValidGameState } from '../src/state/persistence';
import { gameReducer } from '../src/state/reducer';
import { blockedTile, EMPTY_TILE } from '../src/world/tiles';
import { BASE, TARGET, robotOf, tileAt, withRobots, withTile } from './testUtils';

const BURNER = { tx: 8, tz: 10 };
const sleep = (state: GameState) => gameReducer(state, actions.sleep());
const texts = (state: GameState) => state.messages.entries.map((m) => m.text);
const withBurner = (state: GameState, fuel: number) => withTile(state, BURNER, { ...EMPTY_TILE, object: { kind: 'woodBurner', fuel } }, 'farm');

describe('robots overnight', () => {
  it('burns the wood into the pool and records it', () => {
    const next = sleep(withBurner(BASE, 5));
    expect(next.robots.pool).toBe(30);
    expect(next.robots.lastNightFuel).toEqual({ wood: 5, tokens: 30 });
    expect(tileAt(next, BURNER, 'farm').object).toEqual({ kind: 'woodBurner', fuel: 0 });
    expect(texts(next)).toContain('Your wood burners turned 5 wood into 30 tokens.');
  });

  it('recharges only robots near a generator, in id order, and says who missed out', () => {
    const near = robotOf({ id: 1, tx: 7, tz: 10, tokens: 30 });
    const alsoNear = robotOf({ id: 2, name: 'Bolt', tx: 8, tz: 12, tokens: 60 });
    const far = robotOf({ id: 3, name: 'Cog', tx: 2, tz: 12, tokens: 5 });
    // 10 wood make 60 tokens: Sprocket takes 50 to fill up, Bolt gets the last 10 of the 20 it wants.
    const next = sleep(withRobots(withBurner(BASE, 10), [near, alsoNear, far]));
    expect(requireRobot(next, 1).tokens).toBe(80);
    expect(requireRobot(next, 2).tokens).toBe(70);
    expect(requireRobot(next, 3).tokens).toBe(5);
    expect(next.robots.pool).toBe(0);
    expect(texts(next)).toContain('Not enough tokens to fully charge Bolt.');
    expect(texts(next)).toContain("Cog ended the day away from a generator and didn't recharge.");
  });

  it('leaves robots where they finished, restarts their scripts and resets the day counters', () => {
    const robot = robotOf({ tx: 12, tz: 14, facing: Direction.East, pc: 0, tokensToday: 40, power: 'standby', program: { kind: 'script', steps: [{ kind: 'turn', side: 'left' }, { kind: 'move' }], loop: false } });
    const next = sleep(withRobots(BASE, [{ ...robot, pc: 1 }]));
    expect(requireRobot(next, 1)).toMatchObject({ tx: 12, tz: 14, facing: Direction.East, pc: 0, tokensToday: 0, power: 'working', nextActMinute: TIME.dayStartMinute + 4 });
    const flat = sleep(withRobots(BASE, [robotOf({ tokens: 0, power: 'flat' })]));
    expect(requireRobot(flat, 1).power).toBe('flat');
  });

  it('moves a robot off a tile that grew weeds overnight (review focus 4)', () => {
    const state = withRobots(withTile(BASE, TARGET, blockedTile(Blocker.Weeds), 'farm'), [robotOf()]);
    const next = sleep(state);
    const robot = requireRobot(next, 1);
    expect([robot.tx, robot.tz]).toEqual([TARGET.tx, TARGET.tz - 1]);
    expect(robot.teleportSeq).toBe(1);
    expect(isValidGameState(next)).toBe(true);
  });

  it('sets a carried robot down on the spawn tile when the day ends (review focus 1)', () => {
    const state = withRobots({ ...BASE, player: { ...BASE.player, carrying: 1 } }, [robotOf({ carried: true })]);
    const late = { ...state, time: { ...state.time, minuteOfDay: TIME.passOutMinute - 10 } };
    for (const next of [sleep(state), gameReducer(late, actions.tick(20))]) {
      expect(next.player.carrying).toBeNull();
      expect(requireRobot(next, 1)).toMatchObject({ carried: false, tx: PLAYER.spawn.tx, tz: PLAYER.spawn.tz, power: 'working' });
      expect(isValidGameState(next)).toBe(true);
    }
  });

  it('brings repaired robots back charged in front of the bin, and keeps broken ones broken', () => {
    const ready = robotOf({ id: 1, power: 'repairing', repairReadyDay: 1, tokens: 0 });
    const later = robotOf({ id: 2, name: 'Bolt', power: 'repairing', repairReadyDay: 2 });
    const wet = withTile(BASE, { tx: 6, tz: 10 }, blockedTile(Blocker.Water), 'farm');
    const broken = robotOf({ id: 3, name: 'Cog', power: 'broken', tx: 6, tz: 10 });
    const next = sleep(withRobots(wet, [ready, later, broken]));
    expect(requireRobot(next, 1)).toMatchObject({ power: 'working', tx: ROBOTS.repairDropOff.tx, tz: ROBOTS.repairDropOff.tz, tokens: 80, repairReadyDay: null });
    expect(requireRobot(next, 2).power).toBe('repairing');
    expect(requireRobot(next, 3)).toMatchObject({ power: 'broken', tx: 6, tz: 10 });
    expect(texts(next)).toContain('Sprocket is back from repairs.');
    expect(isValidGameState(next)).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/robotOvernight.test.ts`
Expected: FAIL.

- [ ] **Step 3: Create `src/robots/overnight.ts`**

```ts
/**
 * The robots' night, run inside startNextDay after the maps grow (farmclaws part 1 spec §5.7):
 * generators burn, a carried robot is set down, repairs come back, robots near a generator
 * recharge, and every robot is reset for the morning where it stands. Pure.
 */
import { GENERATORS, PLAYER, ROBOTS, TIME } from '../config';
import { Blocker, Direction, type GameState, type MessageTone, type Robot, type TileCoord } from '../core/types';
import { chebyshevDistance } from '../world/grid';
import { forEachTile, getTile, isWalkable, setTiles, type TileEdit } from '../world/tiles';
import { logRobotEvent, pruneRobotLog } from './log';
import { batteryFor, periodFor } from './stats';
import { nearestWalkable, withFarm, withRobot } from './world';

export interface RobotNote {
  readonly text: string;
  readonly tone: MessageTone;
}

function names(robots: readonly Robot[]): string {
  const list = robots.map((r) => r.name);
  return list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list[list.length - 1] ?? ''}` : (list[0] ?? '');
}

function burnGenerators(state: GameState, notes: RobotNote[]): { readonly state: GameState; readonly burners: readonly TileCoord[] } {
  const edits: TileEdit[] = [];
  const burners: TileCoord[] = [];
  let wood = 0;
  forEachTile(state.maps.farm, (tile, tx, tz) => {
    const object = tile.object;
    if (object === null || object.kind !== 'woodBurner') return;
    burners.push({ tx, tz });
    if (object.fuel === 0) return;
    wood += object.fuel;
    edits.push({ tx, tz, tile: { ...tile, object: { kind: 'woodBurner', fuel: 0 } } });
  });
  const tokens = wood * GENERATORS.woodBurner.tokensPerWood;
  if (wood > 0) notes.push({ text: `Your wood burners turned ${wood} wood into ${tokens} tokens.`, tone: 'info' });
  const burned = withFarm(state, setTiles(state.maps.farm, edits));
  return {
    state: { ...burned, robots: { ...burned.robots, pool: burned.robots.pool + tokens, lastNightFuel: { wood, tokens } } },
    burners,
  };
}

function setDownCarried(state: GameState): GameState {
  const id = state.player.carrying;
  const robot = state.robots.list.find((r) => r.id === id);
  if (id === null || robot === undefined) return state;
  const down: Robot = { ...robot, carried: false, tx: PLAYER.spawn.tx, tz: PLAYER.spawn.tz, facing: PLAYER.spawnFacing, teleportSeq: robot.teleportSeq + 1 };
  return withRobot({ ...state, player: { ...state.player, carrying: null } }, down);
}

function returnRepaired(state: GameState, notes: RobotNote[]): GameState {
  let next = state;
  for (const robot of state.robots.list) {
    if (robot.power !== 'repairing' || robot.repairReadyDay === null || robot.repairReadyDay > state.time.absoluteDay) continue;
    const at = nearestWalkable(next.maps.farm, ROBOTS.repairDropOff);
    next = withRobot(next, {
      ...robot,
      tx: at.tx,
      tz: at.tz,
      facing: Direction.South,
      tokens: batteryFor(robot.size),
      power: 'working',
      repairReadyDay: null,
      teleportSeq: robot.teleportSeq + 1,
    });
    next = logRobotEvent(next, robot.id, { kind: 'repaired' });
    notes.push({ text: `${robot.name} is back from repairs.`, tone: 'success' });
  }
  return next;
}

function recharge(state: GameState, burners: readonly TileCoord[], notes: RobotNote[]): GameState {
  let next = state;
  const short: Robot[] = [];
  const away: Robot[] = [];
  for (const robot of state.robots.list) {
    if (robot.power === 'broken' || robot.power === 'repairing') continue;
    if (!burners.some((b) => chebyshevDistance(b, robot) <= ROBOTS.chargeRadius)) {
      if (robot.tokens < batteryFor(robot.size)) away.push(robot);
      continue;
    }
    const want = batteryFor(robot.size) - robot.tokens;
    const give = Math.min(want, next.robots.pool);
    if (give < want) short.push(robot);
    if (give === 0) continue;
    next = withRobot({ ...next, robots: { ...next.robots, pool: next.robots.pool - give } }, { ...robot, tokens: robot.tokens + give });
  }
  if (short.length > 0) notes.push({ text: `Not enough tokens to fully charge ${names(short)}.`, tone: 'warn' });
  if (away.length > 0) notes.push({ text: `${names(away)} ended the day away from a generator and didn't recharge.`, tone: 'warn' });
  return next;
}

function resetForMorning(state: GameState): GameState {
  let next = state;
  const farm = state.maps.farm;
  for (const robot of state.robots.list) {
    if (robot.power === 'repairing') continue;
    const tile = getTile(farm, robot.tx, robot.tz);
    const inWater = tile !== null && tile.blocker === Blocker.Water;
    const standable = tile !== null && (isWalkable(tile) || (robot.power === 'broken' && inWater));
    const at = standable ? { tx: robot.tx, tz: robot.tz } : nearestWalkable(farm, robot);
    const moved = at.tx !== robot.tx || at.tz !== robot.tz;
    next = withRobot(next, {
      ...robot,
      tx: at.tx,
      tz: at.tz,
      teleportSeq: moved ? robot.teleportSeq + 1 : robot.teleportSeq,
      pc: 0,
      tokensToday: 0,
      nextActMinute: TIME.dayStartMinute + periodFor(robot),
      power: robot.power === 'broken' ? 'broken' : robot.tokens > 0 ? 'working' : 'flat',
    });
  }
  return next;
}

/** The whole night, in the spec's order. `notes` become morning toasts. */
export function runRobotsOvernight(state: GameState): { readonly state: GameState; readonly notes: readonly RobotNote[] } {
  const notes: RobotNote[] = [];
  const burned = burnGenerators(state, notes);
  let next = setDownCarried(burned.state);
  next = returnRepaired(next, notes);
  next = recharge(next, burned.burners, notes);
  next = resetForMorning(next);
  return { state: pruneRobotLog(next), notes };
}
```

- [ ] **Step 4: Call it from `startNextDay` in `src/state/reducer.ts`**

Import `runRobotsOvernight` from `../robots/overnight`. In `startNextDay`, after the `let next: GameState = { ... };` literal and before the first `pushMessage`, add:

```ts
  const night = runRobotsOvernight(next);
  next = night.state;
```

At the end, just before `return next;`, add:

```ts
  for (const note of night.notes) next = pushMessage(next, note.text, note.tone);
```

Robot notes come after "Good morning", so the morning reads in order.

- [ ] **Step 5: Run the tests and the full suite**

Run: `npx vitest run tests/robotOvernight.test.ts && npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/robots/overnight.ts src/state/reducer.ts tests/robotOvernight.test.ts
git commit -m "Farmclaws part 1: robots overnight

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Carrying, repairs, fuel and the placement block

**Files:**
- Modify: `src/state/intents.ts`, `src/state/reducer.ts`
- Test: `tests/robotInteract.test.ts`

**Interfaces:**
- Consumes: `robotsOnTile`, `requireRobot`, `withRobot`, `carryEnergyFor`, `repairCost`, `periodFor`, `GENERATORS`.
- Produces: `Intent` gains `pickUpRobot`, `putDownRobot`, `repairRobot` and `fuel`; `planInteraction` and `planPrimaryAction` handle carrying.

- [ ] **Step 1: Write the failing test `tests/robotInteract.test.ts`**

```ts
/**
 * Picking robots up (and fishing them out), putting them down, sending broken ones for repair
 * at the shipping bin, loading the wood burner, and the rules around them.
 */
import { describe, expect, it } from 'vitest';
import { Blocker, Direction, type GameState } from '../src/core/types';
import { requireRobot } from '../src/robots/world';
import { actions } from '../src/state/actions';
import { countItem } from '../src/state/inventory';
import { placementProblem } from '../src/state/intents';
import { gameReducer } from '../src/state/reducer';
import { blockedTile, EMPTY_TILE } from '../src/world/tiles';
import { BASE, TARGET, emptyHanded, holding, robotOf, scenario, tileAt, withEnergy, withGold, withPlayer, withRobots } from './testUtils';

const interact = (state: GameState) => gameReducer(state, actions.interact());
const lastText = (state: GameState) => state.messages.entries.at(-1)?.text;
const carrying = (state: GameState, id = 1) => withRobots({ ...state, player: { ...state.player, carrying: id } }, [robotOf({ carried: true })]);

describe('picking robots up', () => {
  it('costs carry energy and stops the robot', () => {
    const state = withRobots(emptyHanded(scenario(EMPTY_TILE)), [robotOf()]);
    const next = interact(state);
    expect(next.player.carrying).toBe(1);
    expect(requireRobot(next, 1).carried).toBe(true);
    expect(next.player.energy).toBe(state.player.energy - 4);
    expect(requireRobot(gameReducer(next, actions.tick(60)), 1).actionSeq).toBe(0);
  });

  it('refuses when the player is too tired', () => {
    const state = withEnergy(withRobots(emptyHanded(scenario(EMPTY_TILE)), [robotOf({ size: 'big' })]), 10);
    expect(lastText(interact(state))).toBe("You're too tired to carry Sprocket.");
  });

  it('fishes a broken robot out of the water for the same energy', () => {
    const state = withRobots(emptyHanded(scenario(blockedTile(Blocker.Water))), [robotOf({ power: 'broken' })]);
    const next = interact(state);
    expect(next.player.carrying).toBe(1);
    expect(next.player.energy).toBe(state.player.energy - 4);
  });
});

describe('putting robots down', () => {
  it('resumes the program on open ground, facing the way the player faces', () => {
    const state = carrying(scenario(EMPTY_TILE));
    const next = interact(state);
    expect(next.player.carrying).toBeNull();
    expect(requireRobot(next, 1)).toMatchObject({ carried: false, tx: TARGET.tx, tz: TARGET.tz, facing: Direction.South, power: 'working', nextActMinute: state.time.minuteOfDay + 4 });
  });

  it('works with Space too, and refuses rocks', () => {
    expect(gameReducer(carrying(scenario(EMPTY_TILE)), actions.useTool()).player.carrying).toBeNull();
    expect(lastText(interact(carrying(scenario(blockedTile(Blocker.Rock, 2)))))).toBe('Put Sprocket down on open ground.');
  });

  it('keeps a broken robot broken on land', () => {
    const state = withRobots({ ...scenario(EMPTY_TILE), player: { ...scenario(EMPTY_TILE).player, carrying: 1 } }, [robotOf({ carried: true, power: 'broken' })]);
    expect(requireRobot(interact(state), 1).power).toBe('broken');
  });
});

describe('repairs at the shipping bin', () => {
  const atBin = (state: GameState) => withPlayer(state, { tx: 9, tz: 6 }, Direction.North);

  it('sends a broken robot off for gold, back tomorrow', () => {
    const state = withRobots(atBin({ ...BASE, player: { ...BASE.player, carrying: 1 } }), [robotOf({ carried: true, power: 'broken' })]);
    const next = interact(state);
    expect(next.player.gold).toBe(state.player.gold - 300);
    expect(next.player.carrying).toBeNull();
    expect(requireRobot(next, 1)).toMatchObject({ power: 'repairing', repairReadyDay: 1, carried: false });
    expect(lastText(next)).toBe('Sprocket is off to be repaired. Back tomorrow.');
  });

  it('refuses without the gold, and refuses robots that are not broken', () => {
    const broke = withGold(withRobots(atBin({ ...BASE, player: { ...BASE.player, carrying: 1 } }), [robotOf({ carried: true, power: 'broken' })]), 10);
    expect(lastText(interact(broke))).toBe('Repairs cost 300g.');
    const fine = withRobots(atBin({ ...BASE, player: { ...BASE.player, carrying: 1 } }), [robotOf({ carried: true })]);
    expect(lastText(interact(fine))).toBe('Only broken robots go for repair.');
  });
});

describe('the rest', () => {
  it('refuses to leave the farm while carrying', () => {
    const atGate = withPlayer(carrying(BASE), { tx: 0, tz: 13 }, Direction.West);
    const next = gameReducer(atGate, actions.move(Direction.West));
    expect(next.player.mapId).toBe('farm');
    expect(lastText(next)).toBe('Put Sprocket down before you leave the farm.');
  });

  it('loads a wood burner from the held wood, up to 10', () => {
    const burner = { ...EMPTY_TILE, object: { kind: 'woodBurner' as const, fuel: 3 } };
    const loaded = interact(holding(scenario(burner), 'wood', 25));
    expect(tileAt(loaded, TARGET, 'farm').object).toEqual({ kind: 'woodBurner', fuel: 10 });
    expect(countItem(loaded.inventory, 'wood')).toBe(18);
    expect(lastText(interact(holding(scenario({ ...burner, object: { kind: 'woodBurner', fuel: 10 } }), 'wood', 5)))).toBe('The burner is full.');
    expect(lastText(interact(emptyHanded(scenario(burner))))).toBe('3/10 wood. Load it with wood.');
  });

  it('keeps placed objects off a robot', () => {
    const state = withRobots(scenario(EMPTY_TILE), [robotOf()]);
    expect(placementProblem(state, 'chest', TARGET)).toBe("There's a robot in the way.");
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/robotInteract.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add the intents in `src/state/intents.ts`**

Imports to add:

```ts
import { GENERATORS } from '../config';
import { carryEnergyFor, repairCost } from '../robots/stats';
import { requireRobot, robotsOnTile } from '../robots/world';
import { isWalkable } from '../world/tiles';
```

(Merge them into the existing import lines. `getTile` and `isSoil` are already imported from `../world/tiles`.)

Add to the `Intent` union:

```ts
  /** Pick up (or fish out) a robot: it stops and rides in the player's arms. */
  | { readonly kind: 'pickUpRobot'; readonly robotId: number; readonly name: string; readonly fromWater: boolean }
  | { readonly kind: 'putDownRobot'; readonly robotId: number; readonly name: string }
  /** Send the carried broken robot for repair from the shipping bin. */
  | { readonly kind: 'repairRobot'; readonly robotId: number; readonly name: string; readonly cost: number }
  /** Load wood from the selected stack into a wood burner. */
  | { readonly kind: 'fuel'; readonly quantity: number }
```

Add these planners above `planInteraction`:

```ts
/** While carrying: the shipping bin sends a broken robot for repair; open ground puts it down. */
function planCarry(state: GameState, robotId: number): ActionPlan {
  const robot = requireRobot(state, robotId);
  const target = selectTargetTile(state);
  const tile = target === null ? null : getTile(selectActiveWorld(state), target.tx, target.tz);
  const openGround = `Put ${robot.name} down on open ground.`;
  if (target === null || tile === null) return blocked(target, 'place', openGround);
  if (tile.blocker === Blocker.ShippingBin) {
    if (robot.power !== 'broken') return blocked(target, 'place', 'Only broken robots go for repair.');
    const cost = repairCost(robot);
    if (state.player.gold < cost) return blocked(target, 'place', `Repairs cost ${cost}g.`);
    return plan(target, { kind: 'repairRobot', robotId, name: robot.name, cost }, 'place');
  }
  if (isWalkable(tile) && !isReservedTile(selectActiveMap(state), target.tx, target.tz)) {
    return plan(target, { kind: 'putDownRobot', robotId, name: robot.name }, 'place');
  }
  return blocked(target, 'place', openGround);
}

/** A robot on the target tile (lowest id): pick it up for carry energy. Null when there's none. */
function planPickUpRobot(state: GameState, target: TileCoord): ActionPlan | null {
  if (state.player.mapId !== 'farm') return null;
  const robot = robotsOnTile(state, target.tx, target.tz)[0];
  if (robot === undefined) return null;
  const energy = carryEnergyFor(robot);
  if (state.player.energy < energy) return blocked(target, 'harvest', `You're too tired to carry ${robot.name}.`);
  const fromWater = getTile(state.maps.farm, target.tx, target.tz)?.blocker === Blocker.Water;
  return plan(target, { kind: 'pickUpRobot', robotId: robot.id, name: robot.name, fromWater }, 'harvest', energy);
}

function planFuel(state: GameState, target: TileCoord, fuel: number): ActionPlan {
  const stack = selectedStack(state.inventory);
  const hopper = GENERATORS.woodBurner.hopper;
  if (stack === null || stack.itemId !== 'wood') return blocked(target, 'none', `${fuel}/${hopper} wood. Load it with wood.`);
  const quantity = Math.min(stack.quantity, hopper - fuel);
  if (quantity === 0) return blocked(target, 'place', 'The burner is full.');
  return plan(target, { kind: 'fuel', quantity }, 'place');
}
```

In `planInteraction`, add first thing, before `const target = ...`:

```ts
  if (state.player.carrying !== null) return planCarry(state, state.player.carrying);
```

After the `tile === null` check, add:

```ts
  const pickUp = planPickUpRobot(state, target);
  if (pickUp !== null) return pickUp;
```

In the placed-object branch, add the burner case:

```ts
  if (tile.object !== null) {
    if (tile.object.kind === 'woodBurner') return planFuel(state, target, tile.object.fuel);
    return tile.object.kind === 'chest' ? plan(target, { kind: 'openChest' }, 'openChest') : blocked(target, 'none');
  }
```

In `planPrimaryAction`, add first thing:

```ts
  if (state.player.carrying !== null) return planCarry(state, state.player.carrying);
```

In `placementProblem`, after the reserved-tile line, add:

```ts
  if (state.player.mapId === 'farm' && robotsOnTile(state, target.tx, target.tz).length > 0) return "There's a robot in the way.";
```

In `describeIntent`, add:

```ts
    case 'pickUpRobot':
      return `${intent.fromWater ? 'Fish out' : 'Pick up'} ${intent.name}`;
    case 'putDownRobot':
      return `Put down ${intent.name}`;
    case 'repairRobot':
      return `Send ${intent.name} for repair · ${intent.cost}g`;
    case 'fuel':
      return 'Load wood';
```

- [ ] **Step 4: Apply them in `src/state/reducer.ts`**

Imports: `requireRobot, withRobot` from `../robots/world`, and `periodFor` from `../robots/stats`. Add cases to `applyIntent`:

```ts
    case 'pickUpRobot': {
      const robot = requireRobot(state, intent.robotId);
      return withRobot({ ...state, player: { ...state.player, carrying: robot.id } }, { ...robot, carried: true });
    }

    case 'putDownRobot': {
      const robot = requireRobot(state, intent.robotId);
      const power = robot.power === 'broken' ? 'broken' : robot.tokens > 0 ? 'working' : 'flat';
      return withRobot(
        { ...state, player: { ...state.player, carrying: null } },
        {
          ...robot,
          carried: false,
          tx: target.tx,
          tz: target.tz,
          facing: state.player.facing,
          power,
          nextActMinute: state.time.minuteOfDay + periodFor(robot),
          teleportSeq: robot.teleportSeq + 1,
        },
      );
    }

    case 'repairRobot': {
      const robot = requireRobot(state, intent.robotId);
      const sent = withRobot(
        { ...state, player: { ...state.player, carrying: null, gold: state.player.gold - intent.cost } },
        { ...robot, carried: false, power: 'repairing', repairReadyDay: state.time.absoluteDay + 1 },
      );
      return pushMessage(sent, `${robot.name} is off to be repaired. Back tomorrow.`, 'info');
    }

    case 'fuel': {
      const object = tile.object;
      invariant(object !== null && object.kind === 'woodBurner', 'fuel plan without a wood burner');
      const next = withTile(state, target, { ...tile, object: { kind: 'woodBurner', fuel: object.fuel + intent.quantity } });
      return { ...next, inventory: removeFromSlot(state.inventory, state.inventory.selected, intent.quantity) };
    }
```

In `movePlayer`, refuse warps while carrying. Replace the `else` branch with:

```ts
  } else {
    const warp = findWarp(selectActiveMap(state), player.tx, player.tz, direction);
    if (warp !== null && player.carrying !== null) {
      const name = requireRobot(state, player.carrying).name;
      const faced = player.facing === direction ? state : { ...state, player: { ...player, facing: direction } };
      return pushMessage(faced, `Put ${name} down before you leave the farm.`, 'warn');
    }
    if (warp !== null) {
      const arrival = getTile(state.maps[warp.to.mapId], warp.to.tx, warp.to.tz);
      if (arrival !== null && isWalkable(arrival)) return takeWarp(state, warp);
    }
  }
```

- [ ] **Step 5: Run the tests and the full suite**

Run: `npx vitest run tests/robotInteract.test.ts && npm run typecheck && npm test`
Expected: PASS. If an existing test (`intents.test.ts` or `rightClickGate.test.ts`) enumerates intent kinds exhaustively, add the four new kinds to its table.

- [ ] **Step 6: Commit**

```bash
git add src/state/intents.ts src/state/reducer.ts tests/robotInteract.test.ts
git commit -m "Farmclaws part 1: carrying robots, repairs and loading the burner

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Robot rendering

**Files:**
- Create: `src/render/robotLayout.ts`, `src/render/robotGeometry.ts`, `src/render/RobotRenderer.ts`
- Modify: `src/main.ts`, `src/render/PlayerRenderer.ts`
- Test: `tests/robotRender.test.ts`

**Interfaces:**
- Consumes: `Robot`, `RobotActionEvent`, `periodFor`, `InstanceSlotMap`, `createFlatMaterial`, geometry helpers.
- Produces:
  - `ROBOT_MESH_IDS`, `type RobotMeshId`, `robotMeshes(robot)`, `SIZE_SCALE`, `moveSeconds(robot, timeScale)`, `sharedTileOffsets(robots)`, `robotPose(power, carried)`, `EYE_COLORS`, `type RobotClip`, `clipFor(event)`, `clipOffsets(clip, t)`, `CLIP_SECONDS`, `BADGE_SECONDS`, `SPARK_SECONDS`
  - `HEAD_MESHES`, `NECK_Y`, `createRobotMeshGeometry(id)`, `createBadgeGeometry()`, `createParticleGeometry()`
  - `class RobotRenderer implements RenderSystem`, `constructor(ctx: SceneContext, carryAnchor: () => THREE.Vector3)`

- [ ] **Step 1: Write the failing test `tests/robotRender.test.ts`**

```ts
/**
 * RobotRenderer's pure rules (src/render/robotLayout.ts).
 */
import { describe, expect, it } from 'vitest';
import { clipFor, clipOffsets, moveSeconds, robotMeshes, robotPose, sharedTileOffsets } from '../src/render/robotLayout';
import { robotOf } from './testUtils';

describe('robot render rules', () => {
  it('shows the body plus one mesh per part', () => {
    expect(robotMeshes(robotOf({ parts: ['claw'] }))).toEqual(['treads', 'body', 'head', 'eyes', 'arm', 'claw']);
    expect(robotMeshes(robotOf({ size: 'big', parts: ['wateringHead', 'basket', 'quickCore'] }))).toEqual(['treads', 'body', 'head', 'eyes', 'arm', 'spout', 'basket', 'coreOrange']);
  });

  it('lerps faster at higher speeds and never over 0.45 s', () => {
    expect(moveSeconds(robotOf(), 1)).toBeCloseTo(0.45);
    expect(moveSeconds(robotOf(), 16)).toBeCloseTo((0.8 * 4 * 0.7) / 16);
  });

  it('spreads robots that share a tile, in id order', () => {
    const offsets = sharedTileOffsets([robotOf({ id: 1 }), robotOf({ id: 2 }), robotOf({ id: 3, tx: 1 }), robotOf({ id: 4, carried: true })]);
    expect(offsets.get(1)).toBeCloseTo(-0.18);
    expect(offsets.get(2)).toBeCloseTo(0.18);
    expect(offsets.get(3)).toBe(0);
    expect(offsets.has(4)).toBe(false);
  });

  it('poses each power', () => {
    expect(robotPose('working', false)).toMatchObject({ eyes: 'lit', visible: true, sink: 0 });
    expect(robotPose('standby', false).eyes).toBe('dim');
    expect(robotPose('flat', false)).toMatchObject({ eyes: 'off' });
    expect(robotPose('flat', false).headPitch).toBeGreaterThan(0.3);
    expect(robotPose('broken', false)).toMatchObject({ eyes: 'off', sink: 0.25 });
    expect(robotPose('repairing', false).visible).toBe(false);
    expect(robotPose('broken', true)).toMatchObject({ sink: 0, tilt: 0, eyes: 'off' });
  });

  it('plays clips for actions, smaller when they fail, and shakes on a bicker', () => {
    expect(clipFor({ seq: 1, kind: 'move', success: true, bickered: false })).toBeNull();
    const harvest = clipFor({ seq: 1, kind: 'harvest', success: true, bickered: false });
    const failed = clipFor({ seq: 1, kind: 'harvest', success: false, bickered: false });
    expect(harvest?.scale).toBe(1);
    expect(failed?.scale).toBe(0.5);
    const bicker = clipFor({ seq: 1, kind: 'harvest', success: false, bickered: true });
    expect(bicker?.bickered).toBe(true);
    expect(clipOffsets(harvest!, 0.2).pitch).toBeGreaterThan(clipOffsets(failed!, 0.2).pitch);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/robotRender.test.ts`
Expected: FAIL.

- [ ] **Step 3: Create `src/render/robotLayout.ts`**

```ts
/**
 * Pure render rules for robots (farmclaws part 1 spec §7): which meshes a robot shows, how it
 * poses in each power state, its action clips, shared-tile offsets and movement timing.
 */
import { TIME } from '../config';
import type { Robot, RobotActionEvent, RobotActionKind, RobotPartId, RobotPower, RobotSize } from '../core/types';
import { periodFor } from '../robots/stats';

export const ROBOT_MESH_IDS = [
  'treads', 'body', 'head', 'eyes', 'arm', 'claw', 'spout', 'tines', 'hopper', 'basket', 'antenna', 'lens', 'coreGreen', 'coreOrange',
] as const;
export type RobotMeshId = (typeof ROBOT_MESH_IDS)[number];

const PART_MESH: Readonly<Record<RobotPartId, RobotMeshId>> = {
  claw: 'claw',
  wateringHead: 'spout',
  tiller: 'tines',
  seeder: 'hopper',
  basket: 'basket',
  antenna: 'antenna',
  sensorEye: 'lens',
  efficientCore: 'coreGreen',
  quickCore: 'coreOrange',
};

export function robotMeshes(robot: Pick<Robot, 'parts'>): readonly RobotMeshId[] {
  return ['treads', 'body', 'head', 'eyes', 'arm', ...robot.parts.map((p) => PART_MESH[p])];
}

/** The model is authored at Standard size (0.6 tall); Big is also wider. */
export const SIZE_SCALE: Readonly<Record<RobotSize, { readonly height: number; readonly width: number }>> = {
  mini: { height: 0.75, width: 0.75 },
  standard: { height: 1, width: 1 },
  big: { height: 1.42, width: 1.85 },
};

export function moveSeconds(robot: Pick<Robot, 'parts'>, timeScale: number): number {
  return Math.min(0.45, (0.8 * periodFor(robot) * TIME.realSecondsPerGameMinute) / Math.max(1, timeScale));
}

export const SHARED_OFFSET = 0.18;

/** Sideways offset per robot on the map; robots sharing a tile spread ±0.18 in id order. */
export function sharedTileOffsets(robots: readonly Robot[]): ReadonlyMap<number, number> {
  const groups = new Map<string, number[]>();
  for (const r of robots) {
    if (r.carried || r.power === 'repairing') continue;
    const key = `${r.tx},${r.tz}`;
    groups.set(key, [...(groups.get(key) ?? []), r.id]);
  }
  const offsets = new Map<number, number>();
  for (const ids of groups.values()) {
    ids.forEach((id, i) => offsets.set(id, (i - (ids.length - 1) / 2) * SHARED_OFFSET * 2));
  }
  return offsets;
}

export type EyeState = 'lit' | 'dim' | 'off';
export const EYE_COLORS: Readonly<Record<EyeState, number>> = { lit: 0xfff3b8, dim: 0x8a8366, off: 0x2b2b2e };

export interface RobotPose {
  /** How far the robot sinks below its ground, in tiles. */
  readonly sink: number;
  /** Roll, radians. */
  readonly tilt: number;
  readonly headPitch: number;
  readonly eyes: EyeState;
  readonly visible: boolean;
}

export function robotPose(power: RobotPower, carried: boolean): RobotPose {
  const eyes: EyeState = power === 'working' ? 'lit' : power === 'standby' ? 'dim' : 'off';
  if (carried) return { sink: 0, tilt: 0, headPitch: 0, eyes, visible: true };
  switch (power) {
    case 'working':
    case 'standby':
      return { sink: 0, tilt: 0, headPitch: 0, eyes, visible: true };
    case 'flat':
      return { sink: 0, tilt: 0, headPitch: 0.35, eyes, visible: true };
    case 'broken':
      return { sink: 0.25, tilt: 0.26, headPitch: 0.15, eyes, visible: true };
    case 'repairing':
      return { sink: 0, tilt: 0, headPitch: 0, eyes, visible: false };
  }
}

export const CLIP_SECONDS = 0.45;
export const BADGE_SECONDS = 1.5;
export const SPARK_SECONDS = 1.2;

export interface RobotClip {
  readonly kind: RobotActionKind;
  readonly scale: number;
  readonly bickered: boolean;
}

const NO_CLIP: ReadonlySet<RobotActionKind> = new Set<RobotActionKind>(['move', 'turn', 'wait', 'powerDown']);

export function clipFor(event: RobotActionEvent): RobotClip | null {
  if (event.bickered) return { kind: event.kind, scale: 1, bickered: true };
  if (NO_CLIP.has(event.kind)) return null;
  return { kind: event.kind, scale: event.success ? 1 : 0.5, bickered: false };
}

export interface ClipOffsets {
  readonly dip: number;
  readonly pitch: number;
  readonly shake: number;
  readonly headYaw: number;
}

const STILL: ClipOffsets = { dip: 0, pitch: 0, shake: 0, headYaw: 0 };

/** Offsets `t` seconds into a clip: one smooth rise and fall over CLIP_SECONDS. */
export function clipOffsets(clip: RobotClip, t: number): ClipOffsets {
  if (t >= CLIP_SECONDS) return STILL;
  const s = Math.sin((t / CLIP_SECONDS) * Math.PI) * clip.scale;
  if (clip.bickered) return { ...STILL, shake: Math.sin(t * 40) * 0.05 * s };
  switch (clip.kind) {
    case 'harvest':
      return { ...STILL, dip: -0.06 * s, pitch: 0.2 * s };
    case 'water':
      return { ...STILL, pitch: 0.3 * s };
    case 'till':
      return { ...STILL, dip: -0.04 * s, pitch: 0.25 * s };
    case 'plant':
      return { ...STILL, dip: -0.03 * s, pitch: 0.1 * s };
    case 'deposit':
    case 'take':
    case 'refill':
      return { ...STILL, pitch: 0.18 * s };
    case 'say':
      return { ...STILL, headYaw: Math.sin(t * 20) * 0.25 * s };
    default:
      return STILL;
  }
}
```

- [ ] **Step 4: Create `src/render/robotGeometry.ts`**

```ts
/**
 * Low-poly robot geometry, authored at Standard size (0.6 tall), facing +Z, feet at y = 0.
 * One merged, vertex-painted geometry per mesh id; eyes and particles are unpainted and take
 * their colour from the instance.
 */
import * as THREE from 'three';
import { box, mergeParts, normalizePart, paint, pose, type Pose } from './geometryParts';
import type { RobotMeshId } from './robotLayout';

export const ROBOT_COLORS = {
  body: 0xf2c14e,
  trim: 0xf4efe6,
  tread: 0x3a3836,
  metal: 0x9aa0b5,
  metalDark: 0x6e7384,
  copper: 0xc9783f,
  wicker: 0xc8a064,
  lens: 0x6fb7e8,
  coreGreen: 0x5fd08a,
  coreOrange: 0xf28a3a,
  badge: 0xe24b4a,
} as const;

/** Meshes that ride on the head (they pitch with it). */
export const HEAD_MESHES: ReadonlySet<RobotMeshId> = new Set<RobotMeshId>(['head', 'eyes', 'antenna', 'lens']);
/** Height of the neck pivot. */
export const NECK_Y = 0.36;

function cylinder(rTop: number, rBottom: number, height: number, segments: number, p: Pose, color: number): THREE.BufferGeometry {
  return paint(pose(new THREE.CylinderGeometry(rTop, rBottom, height, segments), p), color);
}

function unpainted(geometry: THREE.BufferGeometry, p: Pose): THREE.BufferGeometry {
  return normalizePart(pose(geometry, p));
}

export function createRobotMeshGeometry(id: RobotMeshId): THREE.BufferGeometry {
  const c = ROBOT_COLORS;
  switch (id) {
    case 'treads':
      return mergeParts([box(0.1, 0.1, 0.34, { x: -0.14, y: 0.05 }, c.tread), box(0.1, 0.1, 0.34, { x: 0.14, y: 0.05 }, c.tread)], 'robot treads');
    case 'body':
      return mergeParts(
        [box(0.36, 0.24, 0.3, { y: 0.22 }, c.body), box(0.38, 0.03, 0.32, { y: 0.335 }, c.trim), box(0.1, 0.04, 0.1, { y: 0.36 }, c.metal)],
        'robot body',
      );
    case 'head':
      return mergeParts([box(0.28, 0.18, 0.24, { y: 0.47 }, c.body), box(0.3, 0.03, 0.26, { y: 0.565 }, c.trim)], 'robot head');
    case 'eyes':
      return mergeParts(
        [unpainted(new THREE.BoxGeometry(0.06, 0.05, 0.02), { x: -0.06, y: 0.48, z: 0.121 }), unpainted(new THREE.BoxGeometry(0.06, 0.05, 0.02), { x: 0.06, y: 0.48, z: 0.121 })],
        'robot eyes',
      );
    case 'arm':
      return mergeParts([box(0.05, 0.05, 0.2, { x: 0.2, y: 0.24, z: 0.08 }, c.metal)], 'robot arm');
    case 'claw':
      return mergeParts([box(0.02, 0.06, 0.06, { x: 0.18, y: 0.24, z: 0.2 }, c.metalDark), box(0.02, 0.06, 0.06, { x: 0.22, y: 0.24, z: 0.2 }, c.metalDark)], 'robot claw');
    case 'spout':
      return mergeParts([cylinder(0.06, 0.07, 0.14, 8, { y: 0.28, z: -0.19 }, c.copper), box(0.03, 0.03, 0.1, { y: 0.34, z: -0.27, rx: -0.5 }, c.copper)], 'robot spout');
    case 'tines':
      return mergeParts([-0.1, 0, 0.1].map((x) => box(0.02, 0.08, 0.02, { x, y: 0.06, z: 0.2 }, c.metalDark)), 'robot tines');
    case 'hopper':
      return mergeParts([box(0.14, 0.08, 0.1, { x: -0.1, y: 0.39, z: -0.1 }, c.wicker)], 'robot hopper');
    case 'basket':
      return mergeParts([box(0.08, 0.12, 0.18, { x: -0.23, y: 0.22 }, c.wicker)], 'robot basket');
    case 'antenna':
      return mergeParts([box(0.015, 0.16, 0.015, { x: 0.08, y: 0.66 }, c.metal), box(0.04, 0.04, 0.04, { x: 0.08, y: 0.75 }, c.coreOrange)], 'robot antenna');
    case 'lens':
      return mergeParts([cylinder(0.025, 0.025, 0.02, 8, { y: 0.53, z: 0.12, rx: Math.PI / 2 }, c.lens)], 'robot lens');
    case 'coreGreen':
      return mergeParts([box(0.08, 0.06, 0.02, { y: 0.22, z: 0.151 }, c.coreGreen)], 'robot core');
    case 'coreOrange':
      return mergeParts([box(0.08, 0.06, 0.02, { y: 0.22, z: 0.151 }, c.coreOrange)], 'robot core');
  }
}

/** A red "!" tag: a red plate with a white bar and dot, facing +Z. */
export function createBadgeGeometry(): THREE.BufferGeometry {
  return mergeParts(
    [box(0.16, 0.24, 0.03, { y: 0 }, ROBOT_COLORS.badge), box(0.04, 0.1, 0.035, { y: 0.03 }, 0xffffff), box(0.04, 0.035, 0.035, { y: -0.07 }, 0xffffff)],
    'robot badge',
  );
}

export function createParticleGeometry(): THREE.BufferGeometry {
  return normalizePart(new THREE.BoxGeometry(0.05, 0.05, 0.05));
}
```

- [ ] **Step 5: Create `src/render/RobotRenderer.ts`**

```ts
/**
 * RobotRenderer: the farm's robots (farmclaws part 1 spec §7).
 *
 * - One InstancedMesh per robot mesh id (robotGeometry.ts), capacity ROBOTS.maxRobots, keyed by
 *   robot id. Robots move every frame, so these meshes skip frustum culling instead of
 *   recomputing bounds; at 12 robots that's cheap.
 * - Robots are drawn only while the player is on the farm.
 * - A new moveSeq lerps to the new tile; a new teleportSeq, a rebuild or a new robot snaps.
 * - A new actionSeq plays a clip (robotLayout.clipFor); water and till clips spray particles,
 *   bickers show a red badge; broken robots spark.
 * - A carried robot is drawn above the player's visual position (the carryAnchor callback).
 */
import * as THREE from 'three';
import { ROBOTS } from '../config';
import { Blocker, type GameState, type Robot } from '../core/types';
import { selectActiveMapId } from '../state/selectors';
import { directionYaw, tileCenterX, tileCenterZ } from '../world/grid';
import { getTile, isSoil } from '../world/tiles';
import { CAMERA, HEIGHTS } from './constants';
import { InstanceSlotMap } from './InstanceSlotMap';
import { createFlatMaterial } from './materials';
import { HEAD_MESHES, NECK_Y, createBadgeGeometry, createParticleGeometry, createRobotMeshGeometry } from './robotGeometry';
import {
  BADGE_SECONDS,
  CLIP_SECONDS,
  EYE_COLORS,
  ROBOT_MESH_IDS,
  SIZE_SCALE,
  SPARK_SECONDS,
  clipFor,
  clipOffsets,
  moveSeconds,
  robotMeshes,
  robotPose,
  sharedTileOffsets,
  type RobotClip,
  type RobotMeshId,
} from './robotLayout';
import type { SceneContext } from './SceneContext';
import type { FrameContext, RenderSystem } from './types';

const PARTICLE_CAPACITY = 64;
const CAMERA_YAW = (CAMERA.yawDeg * Math.PI) / 180;

interface Visual {
  robot: Robot;
  x: number;
  z: number;
  fromX: number;
  fromZ: number;
  toX: number;
  toZ: number;
  moveT: number;
  moveDur: number;
  yaw: number;
  groundY: number;
  offset: number;
  clip: RobotClip | null;
  clipT: number;
  badgeT: number;
  sparkT: number;
  moveSeq: number;
  teleportSeq: number;
  actionSeq: number;
}

interface Particle {
  readonly key: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
}

const m = new THREE.Matrix4();
const headLocal = new THREE.Matrix4();
const headM = new THREE.Matrix4();
const tmp = new THREE.Matrix4();
const pos = new THREE.Vector3();
const quat = new THREE.Quaternion();
const scl = new THREE.Vector3();
const euler = new THREE.Euler(0, 0, 0, 'YXZ');
const color = new THREE.Color();

function groundOf(state: GameState, robot: Robot): number {
  const tile = getTile(state.maps.farm, robot.tx, robot.tz);
  if (tile === null) return HEIGHTS.grassTop;
  if (tile.blocker === Blocker.Water) return HEIGHTS.waterSurface;
  return isSoil(tile) ? HEIGHTS.soilTop : HEIGHTS.grassTop;
}

export class RobotRenderer implements RenderSystem {
  private readonly group = new THREE.Group();
  private readonly painted = createFlatMaterial(0xffffff, { vertexColors: true });
  private readonly eyeMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
  private readonly particleMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
  private readonly meshes: Record<RobotMeshId, InstanceSlotMap>;
  private readonly badges: InstanceSlotMap;
  private readonly particles: InstanceSlotMap;
  private readonly visuals = new Map<number, Visual>();
  private readonly live: Particle[] = [];
  private nextParticle = 0;
  private state: GameState | null = null;
  /** The player's visual feet position; a carried robot rides above it. */
  private readonly carryAnchor: () => THREE.Vector3;

  constructor(ctx: SceneContext, carryAnchor: () => THREE.Vector3) {
    this.carryAnchor = carryAnchor;
    this.group.name = 'robots';
    const meshes = {} as Record<RobotMeshId, InstanceSlotMap>;
    for (const id of ROBOT_MESH_IDS) {
      const eyes = id === 'eyes';
      const mesh = new THREE.InstancedMesh(createRobotMeshGeometry(id), eyes ? this.eyeMaterial : this.painted, ROBOTS.maxRobots);
      mesh.castShadow = !eyes;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      meshes[id] = new InstanceSlotMap(mesh, eyes);
    }
    this.meshes = meshes;
    const badge = new THREE.InstancedMesh(createBadgeGeometry(), this.painted, ROBOTS.maxRobots);
    badge.frustumCulled = false;
    this.group.add(badge);
    this.badges = new InstanceSlotMap(badge, false);
    const particle = new THREE.InstancedMesh(createParticleGeometry(), this.particleMaterial, PARTICLE_CAPACITY);
    particle.frustumCulled = false;
    this.group.add(particle);
    this.particles = new InstanceSlotMap(particle, true);
    ctx.scene.add(this.group);
  }

  sync(state: GameState, prev: GameState | null): void {
    this.state = state;
    if (selectActiveMapId(state) !== 'farm') {
      this.clearAll();
      return;
    }
    if (prev !== null && state.robots.list === prev.robots.list && state.maps.farm === prev.maps.farm && state.ui.timeScale === prev.ui.timeScale) return;
    const offsets = sharedTileOffsets(state.robots.list);
    const seen = new Set<number>();
    for (const robot of state.robots.list) {
      seen.add(robot.id);
      const grid = state.maps.farm.grid;
      const toX = tileCenterX(grid, robot.tx);
      const toZ = tileCenterZ(grid, robot.tz);
      const existing = this.visuals.get(robot.id);
      const snap = prev === null || existing === undefined || robot.teleportSeq !== existing.teleportSeq;
      const visual: Visual = existing ?? {
        robot, x: toX, z: toZ, fromX: toX, fromZ: toZ, toX, toZ, moveT: 1, moveDur: 0.45, yaw: directionYaw(robot.facing),
        groundY: groundOf(state, robot), offset: 0, clip: null, clipT: CLIP_SECONDS, badgeT: BADGE_SECONDS, sparkT: 0,
        moveSeq: robot.moveSeq, teleportSeq: robot.teleportSeq, actionSeq: robot.actionSeq,
      };
      if (snap) {
        Object.assign(visual, { x: toX, z: toZ, fromX: toX, fromZ: toZ, toX, toZ, moveT: 1, yaw: directionYaw(robot.facing) });
      } else if (robot.moveSeq !== visual.moveSeq) {
        Object.assign(visual, { fromX: visual.x, fromZ: visual.z, toX, toZ, moveT: 0, moveDur: moveSeconds(robot, state.ui.timeScale) });
      }
      if (!snap && robot.actionSeq !== visual.actionSeq && robot.lastAction !== null) {
        visual.clip = clipFor(robot.lastAction);
        visual.clipT = 0;
        if (robot.lastAction.bickered) visual.badgeT = 0;
        if (robot.lastAction.success && (robot.lastAction.kind === 'water' || robot.lastAction.kind === 'till')) {
          this.spray(toX, groundOf(state, robot) + 0.1, toZ, robot.lastAction.kind === 'water' ? 0x7fb8e6 : 0x8a6a4a, 6);
        }
      }
      Object.assign(visual, {
        robot,
        groundY: groundOf(state, robot),
        offset: offsets.get(robot.id) ?? 0,
        moveSeq: robot.moveSeq,
        teleportSeq: robot.teleportSeq,
        actionSeq: robot.actionSeq,
      });
      this.visuals.set(robot.id, visual);
      this.syncMeshes(robot);
    }
    for (const id of [...this.visuals.keys()]) {
      if (!seen.has(id)) {
        this.visuals.delete(id);
        for (const mesh of Object.values(this.meshes)) mesh.remove(id);
        this.badges.remove(id);
      }
    }
  }

  update(frame: FrameContext): void {
    const state = this.state;
    if (state === null || selectActiveMapId(state) !== 'farm') return;
    const dt = frame.dt;
    for (const visual of this.visuals.values()) this.animate(visual, dt, state);
    this.updateParticles(dt);
    for (const mesh of Object.values(this.meshes)) mesh.commit({ bounds: false });
    this.badges.commit({ bounds: false });
    this.particles.commit({ bounds: false });
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const mesh of Object.values(this.meshes)) mesh.mesh.geometry.dispose();
    this.badges.mesh.geometry.dispose();
    this.particles.mesh.geometry.dispose();
    this.painted.dispose();
    this.eyeMaterial.dispose();
    this.particleMaterial.dispose();
  }

  private clearAll(): void {
    this.visuals.clear();
    for (const mesh of Object.values(this.meshes)) {
      mesh.clear();
      mesh.commit();
    }
    this.badges.clear();
    this.badges.commit();
    this.particles.clear();
    this.particles.commit();
    this.live.length = 0;
  }

  /** Adds or removes this robot's instance on every mesh to match its parts and visibility. */
  private syncMeshes(robot: Robot): void {
    const wanted = new Set(robotMeshes(robot));
    const visible = robotPose(robot.power, robot.carried).visible;
    for (const id of ROBOT_MESH_IDS) {
      const map = this.meshes[id];
      if (visible && wanted.has(id)) {
        if (!map.has(robot.id)) map.set(robot.id, m.identity());
      } else {
        map.remove(robot.id);
      }
    }
  }

  private animate(v: Visual, dt: number, state: GameState): void {
    const robot = v.robot;
    const pose = robotPose(robot.power, robot.carried);
    if (!pose.visible) return;
    if (v.moveT < 1) {
      v.moveT = Math.min(1, v.moveT + dt / Math.max(0.01, v.moveDur));
      const t = v.moveT * v.moveT * (3 - 2 * v.moveT);
      v.x = v.fromX + (v.toX - v.fromX) * t;
      v.z = v.fromZ + (v.toZ - v.fromZ) * t;
    }
    const targetYaw = directionYaw(robot.carried ? state.player.facing : robot.facing);
    const delta = Math.atan2(Math.sin(targetYaw - v.yaw), Math.cos(targetYaw - v.yaw));
    v.yaw += delta * (1 - Math.exp(-12 * dt));
    v.clipT += dt;
    v.badgeT += dt;
    const clip = v.clip === null ? { dip: 0, pitch: 0, shake: 0, headYaw: 0 } : clipOffsets(v.clip, v.clipT);
    const size = SIZE_SCALE[robot.size];

    let x: number;
    let y: number;
    let z: number;
    let s = 1;
    if (robot.carried) {
      const anchor = this.carryAnchor();
      x = anchor.x;
      y = anchor.y + 0.9;
      z = anchor.z;
      s = 0.7;
    } else {
      const side = v.yaw + Math.PI / 2;
      x = v.x + Math.sin(side) * (v.offset + clip.shake);
      z = v.z + Math.cos(side) * (v.offset + clip.shake);
      y = v.groundY - pose.sink * size.height + clip.dip;
    }
    euler.set(clip.pitch, v.yaw, pose.tilt);
    quat.setFromEuler(euler);
    pos.set(x, y, z);
    scl.set(size.width * s, size.height * s, size.width * s);
    m.compose(pos, quat, scl);
    headLocal.makeTranslation(0, NECK_Y, 0).multiply(tmp.makeRotationX(pose.headPitch)).multiply(tmp.makeRotationY(clip.headYaw)).multiply(tmp.makeTranslation(0, -NECK_Y, 0));
    headM.multiplyMatrices(m, headLocal);

    for (const id of robotMeshes(robot)) {
      const map = this.meshes[id];
      map.setMatrix(robot.id, HEAD_MESHES.has(id) ? headM : m);
    }
    this.meshes.eyes.setColor(robot.id, color.setHex(EYE_COLORS[pose.eyes]));

    if (v.badgeT < BADGE_SECONDS) {
      pos.set(x, y + 0.85 * size.height, z);
      quat.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, CAMERA_YAW);
      this.badges.set(robot.id, tmp.compose(pos, quat, scl.setScalar(1)));
    } else {
      this.badges.remove(robot.id);
    }

    if (robot.power === 'broken' && !robot.carried) {
      v.sparkT += dt;
      if (v.sparkT >= SPARK_SECONDS) {
        v.sparkT = 0;
        this.spray(x, y + 0.4 * size.height, z, 0xffd866, 3);
      }
    }
  }

  private spray(x: number, y: number, z: number, hex: number, count: number): void {
    for (let i = 0; i < count; i++) {
      if (this.live.length >= PARTICLE_CAPACITY) return;
      const angle = (i / count) * Math.PI * 2 + this.nextParticle;
      const key = this.nextParticle++;
      this.live.push({ key, x, y, z, vx: Math.cos(angle) * 0.6, vy: 1.2, vz: Math.sin(angle) * 0.6, life: 0.5 });
      this.particles.set(key, m.makeTranslation(x, y, z), color.setHex(hex));
    }
  }

  private updateParticles(dt: number): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const p = this.live[i];
      if (p === undefined) continue;
      p.life -= dt;
      if (p.life <= 0) {
        this.particles.remove(p.key);
        this.live.splice(i, 1);
        continue;
      }
      p.vy -= 4 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      this.particles.setMatrix(p.key, m.makeTranslation(p.x, p.y, p.z));
    }
  }
}
```

`spray` writes the shared scratch matrix `m`, so it must never run in the middle of `animate`'s matrix work. It's only called from `sync`, and at the very end of `animate` after `m` has been written to every mesh.

- [ ] **Step 6: Register it in `src/main.ts`**

Import `RobotRenderer` from `./render/RobotRenderer`. In `systems`, after `new ObjectRenderer(ctx),`, add:

```ts
    new RobotRenderer(ctx, () => player.focus),
```

- [ ] **Step 7: Add the carry pose in `src/render/PlayerRenderer.ts`**

1. `type CarryStyle = 'empty' | 'tool' | 'scythe' | 'can' | 'small' | 'robot';`
2. Add to `CARRY_POSES`:

```ts
  robot: createPose({ rArmSwing: 1.25, rArmSpread: 0.22, lArmSwing: 1.25, lArmSpread: 0.22, lean: -0.05 }),
```

3. Add `robot: 0.1,` to `CARRY_ARM_SWING`.
4. Add a field next to `carryStyle`: `private carryingRobot = false;`
5. In `sync`, extend the early-return condition so a change in `player.carrying` isn't skipped. It already compares `state.player === prev.player`, which covers this, so no change is needed there.
6. In `syncHeldItem`, replace the `choice` line with:

```ts
    this.carryingRobot = state.player.carrying !== null;
    const choice = this.carryingRobot ? EMPTY_HAND : heldChoiceFor(inventory.slots[inventory.selected] ?? null);
```

7. In `showHeld`, replace `this.carryStyle = carryStyleFor(choice.kind);` with `this.carryStyle = this.carryingRobot ? 'robot' : carryStyleFor(choice.kind);`, and at the end of `syncHeldItem` add `if (this.carryingRobot) this.carryStyle = 'robot'; else if (this.carryStyle === 'robot') this.carryStyle = carryStyleFor(this.held.kind);`

- [ ] **Step 8: Run the render test, typecheck, suite and build**

Run: `npx vitest run tests/robotRender.test.ts && npm run typecheck && npm test && npm run build`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/render/ src/main.ts tests/robotRender.test.ts
git commit -m "Farmclaws part 1: robot rendering and the carry pose

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: The HUD token count

**Files:**
- Modify: `src/ui/icons.ts`, `src/ui/Hud.ts`, `src/ui/hud.css`

**Interfaces:**
- Produces: `createBoltIcon(className?)`; the clock panel shows the pool.

- [ ] **Step 1: Add the bolt icon to `src/ui/icons.ts`** (after `createCoinIcon`)

```ts
/** A faceted blue lightning bolt: the farm's token pool. */
export function createBoltIcon(className: string = INLINE_ICON_CLASS): SVGSVGElement {
  const bolt = 0x7fd3ff;
  return svgRoot(
    [
      faceted('18,3 7,18 15,18 13,29 25,13 17,13', hex(bolt), [
        facet('18,3 7,18 15,18 17,13', light(bolt, 0.35)),
        facet('13,29 25,13 17,13 15,18', dark(bolt, 0.18)),
      ]),
    ],
    className,
  );
}
```

- [ ] **Step 2: Generalise the gold counter in `src/ui/Hud.ts`**

Rename `class GoldCounter` to `class CountUpValue` and give it a constructor that takes its look:

```ts
interface CountUpLook {
  readonly block: string;
  readonly title: string;
  readonly unit: string;
  /** Suffix on the floating delta ("g" for gold, " tokens" for tokens). */
  readonly deltaUnit: string;
  readonly icon: SVGSVGElement;
}

/** A number that counts smoothly toward its target and floats a +/- delta (gold, tokens). */
class CountUpValue {
  readonly element: HTMLElement;
  private readonly value: HTMLElement;
  private readonly delta: HTMLElement;
  private readonly deltaUnit: string;
  private from = 0;
  private target = 0;
  private shown = 0;
  private t = 1;

  constructor(look: CountUpLook) {
    this.element = h('div', look.block);
    this.value = h('span', `${look.block}__value`);
    this.delta = h('span', `${look.block}__delta`);
    this.deltaUnit = look.deltaUnit;
    this.element.title = look.title;
    this.delta.setAttribute('aria-hidden', 'true');
    this.element.append(iconHost(`${look.block}__coin`, look.icon), this.value, h('span', `${look.block}__unit`, look.unit), this.delta);
  }
```

Keep `set`, `update` and `render` as they are, except that the delta text becomes:

```ts
    this.delta.textContent = `${change > 0 ? '+' : '−'}${numberFormat.format(Math.abs(change))}${this.deltaUnit}`;
```

In `ClockPanel`:

```ts
  private readonly gold = new CountUpValue({ block: 'hud-gold', title: 'Gold', unit: 'g', deltaUnit: 'g', icon: createCoinIcon() });
  private readonly tokens = new CountUpValue({ block: 'hud-tokens', title: 'Token pool: robots recharge from it overnight', unit: ' tokens', deltaUnit: '', icon: createBoltIcon() });
```

In the constructor, change `money.append(this.gold.element, this.pending);` to:

```ts
    this.tokens.element.hidden = true;
    money.append(this.gold.element, this.tokens.element, this.pending);
```

In `sync`, add:

```ts
    if (prev === null || state.robots.pool !== prev.robots.pool || state.robots.list.length !== prev.robots.list.length) {
      this.tokens.element.hidden = state.robots.pool === 0 && state.robots.list.length === 0;
      this.tokens.set(state.robots.pool, prev === null);
    }
```

In `update`, add `this.tokens.update(dt);`. Import `createBoltIcon`.

- [ ] **Step 3: Style it in `src/ui/hud.css`**

Find the `.hud-gold` rules (around line 529). Duplicate every `.hud-gold…` selector as `.hud-tokens…`, with `--hud-tokens: #7fd3ff;` added next to `--hud-gold` and used for the colour. The simplest correct edit is to extend each selector list, for example `.hud-gold, .hud-tokens { … }` and `.hud-gold__value, .hud-tokens__value { … }`. Then add:

```css
.hud-tokens {
  color: var(--hud-tokens);
}
```

- [ ] **Step 4: Typecheck, test, build**

Run: `npm run typecheck && npm test && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/
git commit -m "Farmclaws part 1: token pool in the HUD

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Development hooks

**Files:**
- Create: `src/dev/robotDev.ts`
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `addRobot`, `robotSays`, `whatHappened`, `selectTargetTile`, `actions.load`.
- Produces: `installRobotDev(store)`, which adds `window.__meadowlight.addRobot(preset, place?)` and `window.__meadowlight.robotLog()`.

- [ ] **Step 1: Create `src/dev/robotDev.ts`**

```ts
/**
 * Development-only robot hooks (farmclaws part 1 spec §8.4). main.ts imports this only when
 * import.meta.env.DEV is true, so production builds contain none of it.
 */
import type { Store } from '../core/store';
import { CRAFTING_RECIPE_IDS, type GameState, type RobotAction, type RobotPlace } from '../core/types';
import { addRobot, type RobotSpec } from '../robots/create';
import { robotSays, whatHappened } from '../robots/logText';
import { actions, type GameAction } from '../state/actions';
import { selectTargetTile } from '../state/selectors';

export type RobotPresetId = 'spinner' | 'waterer' | 'harvester' | 'swimmer' | 'pair';

const repeat = <T>(n: number, steps: readonly T[]): T[] => Array.from({ length: n }, () => steps).flat();

function presetSpecs(id: RobotPresetId, place: RobotPlace): RobotSpec[] {
  const spec = (name: string, size: RobotSpec['size'], parts: RobotSpec['parts'], steps: RobotAction[], loop: boolean): RobotSpec => ({
    name,
    size,
    parts,
    place,
    program: { kind: 'script', steps, loop },
  });
  switch (id) {
    case 'spinner':
      return [spec('Spinner', 'mini', ['wateringHead'], [{ kind: 'turn', side: 'right' }], true)];
    case 'waterer':
      return [spec('Drizzle', 'mini', ['wateringHead'], [{ kind: 'water' }, { kind: 'move' }, { kind: 'water' }, { kind: 'move' }, { kind: 'water' }, { kind: 'powerDown' }], false)];
    case 'harvester':
      return [spec('Reaper', 'standard', ['claw', 'basket'], [...repeat(6, [{ kind: 'harvest' }, { kind: 'move' }] as RobotAction[]), { kind: 'turn', side: 'right' }, { kind: 'turn', side: 'right' }], true)];
    case 'swimmer':
      return [spec('Splash', 'mini', ['claw'], repeat(30, [{ kind: 'move' }] as RobotAction[]), false)];
    case 'pair': {
      const steps: RobotAction[] = [{ kind: 'harvest' }, { kind: 'move' }, { kind: 'harvest' }, { kind: 'move' }, { kind: 'turn', side: 'right' }, { kind: 'turn', side: 'right' }];
      return [spec('Tweedle', 'mini', ['claw'], steps, true), spec('Dee', 'mini', ['claw'], steps, true)];
    }
  }
}

function withBurnerKnown(state: GameState): GameState {
  if (state.crafting.known.includes('woodBurner')) return state;
  const known = CRAFTING_RECIPE_IDS.filter((id) => id === 'woodBurner' || state.crafting.known.includes(id));
  return { ...state, crafting: { known } };
}

export function installRobotDev(store: Store<GameState, GameAction>): void {
  const handle = window.__meadowlight;
  if (handle === undefined) return;

  const add = (preset: RobotPresetId, place?: RobotPlace): string => {
    let state = withBurnerKnown(store.getState());
    const target = selectTargetTile(state) ?? { tx: state.player.tx, tz: state.player.tz };
    const at = place ?? { tx: target.tx, tz: target.tz, facing: state.player.facing };
    const added: string[] = [];
    for (const spec of presetSpecs(preset, at)) {
      const result = addRobot(state, spec);
      if ('error' in result) return result.error;
      state = result.state;
      added.push(spec.name);
    }
    store.dispatch(actions.load(state));
    return `Added ${added.join(' and ')}.`;
  };

  const log = (): void => {
    const state = store.getState();
    const names = new Map(state.robots.list.map((r) => [r.id, r.name]));
    console.table(
      state.robots.log.entries.map((e) => ({
        robot: names.get(e.robotId) ?? e.robotId,
        day: e.day,
        minute: e.minute,
        says: robotSays(e),
        happened: whatHappened(e, names),
        count: e.count,
      })),
    );
  };

  window.__meadowlight = { ...handle, addRobot: add, robotLog: log };
}
```

- [ ] **Step 2: Wire it into `src/main.ts`**

In the `declare global` block, add two optional members to `__meadowlight`:

```ts
      readonly addRobot?: (preset: 'spinner' | 'waterer' | 'harvester' | 'swimmer' | 'pair', place?: { tx: number; tz: number; facing: 0 | 1 | 2 | 3 }) => string;
      readonly robotLog?: () => void;
```

After the `window.__meadowlight = { store, ctx, systems, actions };` line, inside the same `if (import.meta.env.DEV)` block, add:

```ts
    void import('./dev/robotDev').then(({ installRobotDev }) => installRobotDev(store));
```

- [ ] **Step 3: Build and check that production has no hook code**

Run: `npm run typecheck && npm test && npm run build && ! grep -rl "robotLog\|installRobotDev" dist/`
Expected: every command succeeds, and the final `grep` finds nothing. If it does find something, the dynamic import wasn't eliminated. Move the import into a top-level `if (import.meta.env.DEV) { … }` statement so Vite's dead-code pass drops the whole branch.

- [ ] **Step 4: Commit**

```bash
git add src/dev/robotDev.ts src/main.ts
git commit -m "Farmclaws part 1: development robot hooks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Determinism with robots, and the final checks

**Files:**
- Test: `tests/robotDeterminism.test.ts`

**Interfaces:**
- Consumes: `createStore`, `createActionRecorder`, `gameReducer`, `addRobot`, test helpers.

- [ ] **Step 1: Write the test**

```ts
/**
 * Determinism and the render contract with robots on the farm: a busy session played twice
 * through a freezing store ends identically, replaying its log reproduces it, and every
 * transition keeps unchanged robots (and the robot list when nothing robot-related changed)
 * by reference.
 */
import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../src/core/hash';
import { createActionRecorder, createStore } from '../src/core/store';
import { DIRECTIONS, type GameState } from '../src/core/types';
import { addRobot } from '../src/robots/create';
import { actions, type GameAction } from '../src/state/actions';
import { serializeGame } from '../src/state/persistence';
import { gameReducer } from '../src/state/reducer';
import { BASE, HEAVY_TEST_TIMEOUT_MS, must } from './testUtils';

function withPresetRobots(): GameState {
  let state = BASE;
  const specs = [
    { name: 'Ada', size: 'mini' as const, parts: ['wateringHead' as const], steps: [{ kind: 'water' as const }, { kind: 'move' as const }, { kind: 'turn' as const, side: 'left' as const }] },
    { name: 'Bolt', size: 'standard' as const, parts: ['claw' as const, 'basket' as const], steps: [{ kind: 'harvest' as const }, { kind: 'move' as const }] },
    { name: 'Cog', size: 'mini' as const, parts: ['tiller' as const], steps: [{ kind: 'till' as const }, { kind: 'move' as const }, { kind: 'turn' as const, side: 'right' as const }] },
  ];
  specs.forEach((s, i) => {
    const result = addRobot(state, { name: s.name, size: s.size, parts: s.parts, place: { tx: 3 + i * 3, tz: 11, facing: 2 }, program: { kind: 'script', steps: s.steps, loop: true } });
    if ('error' in result) throw new Error(result.error);
    state = result.state;
  });
  return state;
}

function session(seed: number, length: number): GameAction[] {
  const rng = mulberry32(seed);
  const list: GameAction[] = [];
  for (let i = 0; i < length; i++) {
    const roll = rng();
    if (roll < 0.35) list.push(actions.move(must(DIRECTIONS[Math.floor(rng() * 4)])));
    else if (roll < 0.5) list.push(actions.interact());
    else if (roll < 0.6) list.push(actions.useTool());
    else if (roll < 0.95) list.push(actions.tick(1 + Math.floor(rng() * 90)));
    else list.push(actions.sleep());
  }
  return list;
}

function play(start: GameState, list: readonly GameAction[]): { state: GameState; recorded: readonly GameAction[]; problems: string[] } {
  const recorder = createActionRecorder<GameState, GameAction>();
  const store = createStore(gameReducer, start, { freeze: true, middleware: [recorder.middleware] });
  const problems: string[] = [];
  store.subscribe((state, prev) => {
    for (const robot of state.robots.list) {
      const before = prev.robots.list.find((r) => r.id === robot.id);
      if (before !== undefined && before !== robot && JSON.stringify(before) === JSON.stringify(robot)) problems.push(`robot ${robot.id} copied without changing`);
    }
  });
  for (const action of list) store.dispatch(action);
  return { state: store.getState(), recorded: recorder.actions, problems };
}

describe('determinism with robots', () => {
  it(
    'plays the same twice, replays from its log, and never copies an unchanged robot',
    () => {
      const start = withPresetRobots();
      for (let seed = 1; seed <= 5; seed++) {
        const list = session(seed, 600);
        const a = play(start, list);
        const b = play(start, list);
        expect(serializeGame(a.state)).toBe(serializeGame(b.state));
        expect(serializeGame(play(start, a.recorded).state)).toBe(serializeGame(a.state));
        expect(a.problems.slice(0, 10)).toEqual([]);
      }
    },
    HEAVY_TEST_TIMEOUT_MS,
  );
});
```

- [ ] **Step 2: Run it**

Run: `npx vitest run tests/robotDeterminism.test.ts`
Expected: PASS. If "copied without changing" appears, some code path spreads a robot without changing it. Find it with the robot id and fix it at source, for example by returning the same robot when nothing changed.

- [ ] **Step 3: The full gate**

Run: `npm run typecheck && npm test && npm run build && ! grep -rl "robotLog\|installRobotDev" dist/`
Expected: all green, and no dev-hook code in `dist/`.

- [ ] **Step 4: Browser check (development mode)**

Start the dev server with the preview tools (`.claude/launch.json` → `npm run dev`). Then, in the page console:

1. `__meadowlight.addRobot('spinner')`: it spins, the log grows, and at 16× (T) it goes flat with the toast "Spinner ran out of power."
2. `__meadowlight.addRobot('swimmer')`, facing the pond: it drives in, sinks, sparks, and the toast says it shorted out. Walk to the shore facing it and press E: energy drops, and it's in your arms. Walk to the shipping bin and press E: gold drops by 300. Sleep (N): it's back in front of the bin.
3. `__meadowlight.addRobot('pair')` on a tilled row with mature parsnips: both shake, show the red "!", and the crop stays. Check `__meadowlight.robotLog()` shows "Waiting my turn ✓" beside "Fought … over the same tile."
4. Craft a wood burner (the dev hook teaches it), place it, load wood (E), sleep: the HUD shows the token count, and robots within 2 tiles recharge.
5. Leave a robot far from the burner, sleep: the "didn't recharge" toast appears.
6. Pick up a working robot mid-script (E), walk, put it down (E): it resumes.
7. The console has no errors. Add 12 robots and check the frame rate stays near 60 (the HUD FPS readout, if enabled).

Take a screenshot of the pair bickering and of the token count in the HUD.

- [ ] **Step 5: Commit**

```bash
git add tests/robotDeterminism.test.ts
git commit -m "Farmclaws part 1: determinism with robots

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 6: Update the spec where the plan refined it**

Make these edits in `docs/superpowers/specs/2026-09-29-farmclaws-part1-robot-core.md`, then commit them as "Farmclaws part 1: sync the spec with the build":
- §8.3: `robotSays(entry)` takes no robot argument in part 1.
- §5.3 step 4: "re-planned" means every remaining plan is re-planned just before it applies.
- §5.7: robot toasts come after the "Good morning" message.
- §9.2: the determinism check lives in `tests/robotDeterminism.test.ts`.
- §4.1: `containerFull` also covers "nothing in the bag is sellable" at the shipping bin.
- `RobotPlan` carries `target` on blocked plans too.
- §11: three existing tests pinned the old save version and player shape (`persistence.test.ts`, `maps.test.ts`, `reducer.test.ts`) and were updated in Task 2, alongside the new determinism file.
