# Farmclaws Part 2: The Language Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Robots run real block programs — typed blocks, triggers, loops, helpers, zones and routes — through a deterministic, resumable interpreter, and obey a Managing Directive (.MD) with fixed precedence, all saved in save version 5 and drivable from the dev console.

**Architecture:** Programs are typed block trees stored as plain data (`BlockProgram`). A checker (`src/robots/check.ts`) is the only gate for programs and .MDs. A pure interpreter (`src/robots/interpret.ts`) walks a saved frame stack (`Robot.exec`) until it reaches one part-1 `RobotAction` per due minute. A turn layer (`src/robots/turn.ts`) applies .MD precedence and triggers around it. Part 1's `runRobotsMinute` and executor apply the result unchanged, apart from a committed `exec` and a deposit `keep` set.

**Tech Stack:** TypeScript (strict, `erasableSyntaxOnly`), Three.js, Vite, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-02-farmclaws-part2-language.md`, building on `docs/superpowers/specs/2026-09-29-farmclaws-part1-robot-core.md`, within the umbrella design `docs/superpowers/specs/2026-09-29-farmclaws-design.md`. Read the part 2 spec before starting; it is the binding authority.

## Global Constraints

- The simulation stays pure and deterministic: no `Math.random`, no clock reads and no I/O in `src/core`, `src/state`, `src/world`, `src/farming`, `src/time` or `src/robots`. Randomness only through `hash32` / `hashFloat` (tests may use `mulberry32`).
- Strict TypeScript with `erasableSyntaxOnly`: no enums, no namespaces, no parameter properties, `as const` objects plus union types, `import type` for types. `noUnusedLocals` and `noUnusedParameters` are on, and `tests/` is typechecked too.
- No TODOs, placeholders or stubs.
- `npm run typecheck && npm test && npm run build` pass after every task.
- State is immutable, with structural sharing: an unchanged robot, chunk or tile keeps its reference.
- A robot does exactly what its program and .MD say. Nothing random happens to a robot.
- Numbers come from `ROBOTS` (and `TIME`, `PROFILE`) in `src/config.ts`, never inline.
- Robot speech (`robotSays`) always ends in " ✓", even for failures. Only `whatHappened` and toasts tell the truth.
- `checkProgram` / `checkMd` are the only gate for programs and .MDs: dev hooks, `addRobot` and save validation all call them.
- Part 1 behaviour for script robots is unchanged; part 1's tests pass untouched apart from save-version literals and fixture fields.
- Commit messages end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Saving and loading mid-loop, mid-route, mid-helper, during a DO return, dizzy, done, or idle with a pending `every` trigger.** The game must load to an identical state. Pinned in Task 3 (validation) and Task 8 (round trips through real turns).
2. **A robot picked up and put down in the middle of a `Go to` or `For each tile`.** The next path tile is no longer adjacent, so the route re-plans from where it stands instead of walking a stale path. Pinned in Task 6.
3. **One big 16× tick that crosses a DO return minute, a trigger time and pass-out, with block robots mid-program.** It must equal the same minutes ticked one at a time. Pinned in Task 11.
4. **An idle robot with `Every 5 minutes` and too few tokens to wake.** It goes flat on the wake, its `exec` is unchanged, and it never wakes for free. Pinned in Task 8.
5. **A robot standing outside its `DON'T leave` zone (the player carried it there), or a `For each tile` whose next tile can only be reached by leaving the zone.** The robot can walk back in, and an unreachable tile is a logged `gaveUp`, never a stuck robot or a dizzy one. Pinned in Task 6 and Task 7.

---

## File map

| File | Responsibility |
| --- | --- |
| `src/core/types.ts` | Zones, values, expressions, statements, triggers, programs, exec frames, .MD cards (Task 1); `Robot.exec/md/off`, `RobotsState.zones`, `SAVE_VERSION = 5` (Task 3); new log events (Task 8) |
| `src/config.ts` | `ROBOT_SIZE_SPECS` blocks/vars/mdCards; new `ROBOTS` keys |
| `src/robots/stats.ts` | `scaledCost`, `wakeCostFor` |
| `src/robots/program.ts` | Program structure helpers: `resolveList`, `blockCount`, `literalValue`, `isLiteral`, `farmContains` |
| `src/robots/blocks.ts` | The builder `b` |
| `src/robots/check.ts` | `typeOf`, `checkProgram`, `checkMd`, `isValidZoneRect` |
| `src/robots/exec.ts` | `freshExec` (Task 3), `morningExec` (Task 7) |
| `src/robots/zones.ts` | `zoneOf`, `inZone`, `snakeTiles`, `tileAheadOf` |
| `src/robots/eval.ts` | `evaluate` and sensors |
| `src/robots/interpret.ts` | `stepProgram`, frames, step budget |
| `src/robots/route.ts` | `planRoute`, `nextRouteAction` |
| `src/robots/md.ts` | DON'T checks (Task 6), DO checks (Task 7), `mdCardText` (Task 8) |
| `src/robots/turn.ts` | `decideTurn`: precedence, triggers, wake |
| `src/robots/execute.ts` | deposit `keep`, committed `exec` in settle, `applyTurnOutcome` helpers |
| `src/robots/run.ts` | block robots in `runRobotsMinute` |
| `src/robots/overnight.ts` | morning reset for block robots |
| `src/robots/logText.ts` | text for the new events, `triggerText` |
| `src/state/robotValidation.ts` | program shape, `isValidExec`, zones, md, off |
| `src/state/persistence.ts` | v4 → v5 |
| `src/render/robotLayout.ts`, `src/render/RobotRenderer.ts` | dizzy spin, off eyes |
| `src/dev/robotDev.ts` | `setProgram`, `setMd`, `setZone`, `blocks` |

---

## Part 1 facts every task needs

- Exports already on `v2`: `src/robots/execute.ts` — `type RobotPlan`, `planRobotAction(state, robot, action)`, `applyRobotPlan(state, robotId, plan)`, `applyBickerPlan(state, robotId, plan, withIds)`, private `settle(state, robotId, action, success, bickered)`. `src/robots/run.ts` — `runRobotsMinute(state)`, `runRobotsThrough(state, lastMinute)`. `src/robots/world.ts` — `findRobot`, `requireRobot`, `withRobot` (returns same state when unchanged), `withFarm`, `robotsOnTile`, `containerOf`, `chestSlots`, `nearestWalkable(world, from)`. `src/robots/stats.ts` — `RobotBody`, `hasPart`, `batteryFor`, `bagStacks`, `periodFor`, `repairCost`, `resumedPower`, `carryEnergyFor`, `actionCost(robot, kind)`. `src/robots/log.ts` — `logRobotEvent(state, robotId, event)`, `pruneRobotLog`. `src/robots/logText.ts` — `robotSays(entry)`, `whatHappened(entry, names)`. `src/robots/overnight.ts` — `runRobotsOvernight(state)`. `src/robots/create.ts` — `RobotSpec`, `addRobot(state, spec)`. `src/robots/bag.ts` — `bagCount`, `bagRoom`, `addToBag`, `removeFromBag`, `takeIntoBag`. `src/core/text.ts` — `qualityPrefix`, `joinWithAnd(list, empty)`. `src/state/robotValidation.ts` — `isValidRobotAction`, `isValidRobotProgram`, `isValidRobotsSection(v, maps, player)`. `src/state/persistence.ts` — `migrateV3toV4`, `migrateSave`, `serializeGame`, `deserializeGame` (check exact names), `isValidGameState`. `src/world/tiles.ts` — `getTile(world, tx, tz)`, `isWalkable(tile)`. `src/world/grid.ts` — `stepTile(from, direction)`. `src/world/maps/index.ts` — `MAPS.farm`. `src/state/messages.ts` — `pushMessage(state, text, tone)`.
- Test helpers in `tests/testUtils.ts`: `BASE`, `STAND` (5,9), `TARGET` (5,10), `tileAt`, `withTile`, `withPlayer`, `stack`, `soilTile`, `cropOf`, `matureCrop`, `robotOf(overrides)`, `withRobots(state, robots)`, `atDay`, `HEAVY_TEST_TIMEOUT_MS`, `must`.
- A Mini acts every `ROBOTS.period` (4) minutes; costs from `ROBOTS.cost` × size multiplier (Mini ×1). `TIME.dayStartMinute` 360, `TIME.passOutMinute` 1560.
- Robots act on their **own tile** for water/harvest/till/plant, and the **tile ahead** for refill/deposit/take.

---

## Plan refinements of the spec

Decided while drafting and verifying this plan. Task 11 writes each into the spec.

- R1. During a DO return, `exec.running` is `null` and `exec.frames` is exactly one `route` frame with `why: 'doReturn'`. So the validation rule is "frames empty exactly when running is null, except a single doReturn route frame".
- R2. A turn that woke the robot charges `wakeCostFor(robot)` on top of the action cost. If the robot can't pay both, it goes flat, nothing is committed, and `firedToday` / `due` are not spent.
- R3. `RobotPlan` carries `keep: ReadonlySet<ItemId>`, so the apply phase deposits with the same kept set as the choose phase.
- R4. A robot on the farm edge facing out reads its own tile as `tile ahead`, so `Value.tile` is always a farm tile.
- R5. `statementDepth` counts `goTo` / `forEachTile` as one extra frame at their level (route frame on top), so checker limits and exec validation agree.
- `route.ts` also exports `canEnter(state, robot, from, to)` (single-step entry rule used by `planRoute` and the route re-plan check); a route move is never skipped by a DON'T card.
- Step budget: a loop statement pays one step covering its first iteration; each further iteration pays one more.
- Builder: `b.textVar(name, string)`, `b.yesVar(name, boolean)`, `b.itemVar(name, ItemId)`, `b.forever(...body)`, `b.take(ItemId | Expr)`, `b.program` takes mutable arrays.
- `checkProgram`'s script message is 'That program is not a valid script.' (part 1's string; part 1 tests stay untouched).
- `check.ts` ↔ `robotValidation.ts` import each other's functions only (no load-time use); `isValidRobotProgram` is removed in Task 3 in favour of `isProgramShape` + `checkProgram`.
- "Within the day" = `TIME.dayStartMinute` … `TIME.passOutMinute − 1`. Variable declarations count 0 blocks.
- `program.ts` also exports `exprChildren`, `statementExprs`, `childLists`.
- Task 7 also edits `src/state/robotValidation.ts` (`isValidLogEvent` for the new events).
- `applyTurn` schedules `wait`/`skip`/`finish` at `minute + period` (equal to `nextActMinute + period` when due; avoids a stale nextActMinute making a robot due every minute). `chargeWake` sets power `working`; `wait` sets `standby`.
- `doReturn failed` text takes its reason from the card ("no generator I could reach" / "no way through"); a preceding `conflict` line explains a DON'T block.
- `md.ts` also exports `returnFrameOf(exec)`. `triggerText` uses log wording, not editor labels.
- (Verification of Tasks 4–11) Task 7's DO return walk re-plans when the next path tile can no longer be entered (`canEnter`), the same rule as Task 6's route frames, so a return never walks into a rock that landed on its path.
- (Verification) Task 8's morning reset keeps a block robot's exec object when it deep-equals the morning's (`morningExecOf` in `overnight.ts`), so sleeping without anything changing never copies a robot (the determinism test's render contract).
- (Ruling, coordinator) Task 10's and Task 11's dist check is `! grep -rl "robotLog\|installRobotDev\|addScriptedRobot\|setMd\|setZone" dist/`. It leaves out `setProgram`: three.js's WebGLRenderer has its own internal `setProgram`, which the bundle's source map always carries.
- (Verification) Task 11's spec sync spells out the rulings as explicit edits 16–19 (day range, variable declarations count 0, the loop step rule, the dist check); edit 20 is the catch-all.
- Rulings from verification: a loop statement pays one step that covers its first iteration (so `Repeat 24 × change` costs 48 steps; the spec is updated to match); `DON'T go into water` never decides a route outcome because routes never end in water; a robot woken from standby that gets dizzy in the same turn is left `working` with `off: 'dizzy'` (the wake happened).

---

### Task 1: Language types and configuration

**Files:**
- Modify: `src/core/types.ts` (widen `RobotProgram` at ~line 538; new section "Robot language" after `RobotsState`, before "Sections for later workstreams", ~line 661)
- Modify: `src/config.ts` (import line 5; `RobotSizeSpec` and `ROBOT_SIZE_SPECS` ~lines 222–234; end of `ROBOTS` ~line 276)
- Modify: `src/robots/stats.ts` (`actionCost`, end of file)
- Modify: `src/robots/run.ts` (`runRobotsMinute` due filter and step read, ~lines 21–34)
- Modify: `src/robots/execute.ts` (`settle`, ~lines 109–125)
- Modify: `src/state/robotValidation.ts` (the `RobotProgram` import and `isValidRobotProgram`'s guard type)
- Test: `tests/robotStats.test.ts` (extend)

**Interfaces:**
- Consumes: part 1 only (`ROBOTS`, `RobotScript`, `actionCost`, `hasPart`).
- Produces:
  - `src/core/types.ts`: `ZONE_IDS`, `ZoneId`, `ZoneRect`, `EVERY_CHOICES = [5, 10, 15, 30, 60] as const`, `VALUE_TYPES`, `ValueType`, `Value`, `Expr`, `ActionBlock`, `Statement`, `Trigger` (with `every.minutes: (typeof EVERY_CHOICES)[number]`, the same type as `(typeof ROBOTS.everyChoices)[number]`), `VarDecl`, `TriggerStack`, `HelperDef`, `BlockProgram`, `ListRef`, `LoopState`, `Frame`, `RobotExec`, `MdCard`; `type RobotProgram = RobotScript | BlockProgram`.
  - `src/config.ts`: `RobotSizeSpec.blocks/vars/mdCards` (mini 12/1/3, standard 30/3/6, big 80/6/10); `ROBOTS.stepBudget` 50, `maxStacks` 8, `maxFrames` 16, `maxNumber` 999_999, `maxTextLength` 60, `maxIdentifierLength` 16, `everyChoices: EVERY_CHOICES`, `wakeCost` 1, `maxRepeatTimes` 999.
  - `src/robots/stats.ts`: `export function scaledCost(robot: RobotBody, base: number): number`; `export function wakeCostFor(robot: RobotBody): number`.
  - `runRobotsMinute` runs only script robots (block robots join in Task 8); `settle` advances `pc` only for scripts; `isValidRobotProgram(v): v is RobotScript` (scripts only).

- [ ] **Step 1: Write the failing test** — extend `tests/robotStats.test.ts`

Replace the imports at the top of the file:

```ts
import { describe, expect, it } from 'vitest';
import type { RobotPartId, RobotSize } from '../src/core/types';
import { PART_ACTIONS, ROBOT_ACTION_KINDS, canDo } from '../src/robots/parts';
import { actionCost, bagStacks, batteryFor, carryEnergyFor, periodFor, repairCost } from '../src/robots/stats';
```

with:

```ts
import { describe, expect, it } from 'vitest';
import { ROBOTS } from '../src/config';
import { EVERY_CHOICES, type RobotActionKind, type RobotPartId, type RobotSize } from '../src/core/types';
import { PART_ACTIONS, ROBOT_ACTION_KINDS, canDo } from '../src/robots/parts';
import { actionCost, bagStacks, batteryFor, carryEnergyFor, periodFor, repairCost, scaledCost, wakeCostFor } from '../src/robots/stats';
```

Append at the end of the file:

```ts
describe('robot stats for the language (part 2)', () => {
  /** Every action's cost per body, written out so a change to the scaling rule shows up here. */
  const COSTS: readonly [RobotSize, readonly RobotPartId[], Readonly<Record<RobotActionKind, number>>][] = [
    ['mini', [], { move: 1, turn: 1, water: 2, harvest: 3, till: 5, plant: 3, refill: 1, deposit: 1, take: 1, say: 1, wait: 0, powerDown: 0 }],
    ['standard', [], { move: 2, turn: 2, water: 4, harvest: 6, till: 10, plant: 6, refill: 2, deposit: 2, take: 2, say: 2, wait: 0, powerDown: 0 }],
    ['big', [], { move: 4, turn: 4, water: 8, harvest: 12, till: 20, plant: 12, refill: 4, deposit: 4, take: 4, say: 4, wait: 0, powerDown: 0 }],
    ['mini', ['efficientCore'], { move: 1, turn: 1, water: 1, harvest: 2, till: 3, plant: 2, refill: 1, deposit: 1, take: 1, say: 1, wait: 0, powerDown: 0 }],
    ['standard', ['efficientCore'], { move: 1, turn: 1, water: 3, harvest: 4, till: 7, plant: 4, refill: 1, deposit: 1, take: 1, say: 1, wait: 0, powerDown: 0 }],
    ['big', ['efficientCore'], { move: 3, turn: 3, water: 6, harvest: 9, till: 15, plant: 9, refill: 3, deposit: 3, take: 3, say: 3, wait: 0, powerDown: 0 }],
  ];

  it.each(COSTS)('keeps every action cost for a %s with %j', (size, parts, costs) => {
    for (const kind of ROBOT_ACTION_KINDS) expect([kind, actionCost(body(size, parts), kind)]).toEqual([kind, costs[kind]]);
  });

  it('scales a base cost the way actions are scaled', () => {
    expect(scaledCost(body('mini'), 5)).toBe(5);
    expect(scaledCost(body('big'), 5)).toBe(20);
    expect(scaledCost(body('standard', ['efficientCore']), 1)).toBe(1);
    expect(scaledCost(body('big', ['efficientCore']), 2)).toBe(6);
  });

  it('charges a size-scaled wake cost', () => {
    expect(wakeCostFor(body('mini'))).toBe(1);
    expect(wakeCostFor(body('standard'))).toBe(2);
    expect(wakeCostFor(body('big'))).toBe(4);
    expect(wakeCostFor(body('big', ['efficientCore']))).toBe(3);
  });

  it('gives each size its block, variable and .MD card limits', () => {
    const limits = (size: RobotSize) => [ROBOTS.sizes[size].blocks, ROBOTS.sizes[size].vars, ROBOTS.sizes[size].mdCards];
    expect(limits('mini')).toEqual([12, 1, 3]);
    expect(limits('standard')).toEqual([30, 3, 6]);
    expect(limits('big')).toEqual([80, 6, 10]);
  });

  it('has the language numbers from the spec', () => {
    expect(ROBOTS).toMatchObject({
      stepBudget: 50,
      maxStacks: 8,
      maxFrames: 16,
      maxNumber: 999_999,
      maxTextLength: 60,
      maxIdentifierLength: 16,
      wakeCost: 1,
      maxRepeatTimes: 999,
    });
    expect(ROBOTS.everyChoices).toEqual([5, 10, 15, 30, 60]);
    expect(ROBOTS.everyChoices).toBe(EVERY_CHOICES);
  });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run tests/robotStats.test.ts`
Expected: FAIL, 4 failed / 9 passed — `TypeError: scaledCost is not a function`, `TypeError: wakeCostFor is not a function`, `expected [ undefined, undefined, undefined ] to deeply equal [ 12, 1, 3 ]`, and the `ROBOTS` `toMatchObject` mismatch. (The type errors in the test file show up under `npm run typecheck`, not under vitest.)

- [ ] **Step 3: Implement**

**3a. `src/core/types.ts`.** Replace:

```ts
/** Part 2 widens this union with block programs. */
export type RobotProgram = RobotScript;
```

with:

```ts
/** A part 1 script or a part 2 block program. */
export type RobotProgram = RobotScript | BlockProgram;
```

Then insert this section directly after the closing `}` of `export interface RobotsState { … }` (before the `// Sections for later workstreams` banner). Types are copied from spec §2.1–§2.5; only comments moved onto their own lines.

```ts
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
  /** The trigger stack running, or null while idle. */
  readonly running: number | null;
  /** Innermost last. Empty while idle. At most ROBOTS.maxFrames. */
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
```

**3b. `src/config.ts`.** Replace the import on line 5:

```ts
import { Direction, type ItemStack, type RobotActionKind, type RobotSize, type TileCoord, type TileRect } from './core/types';
```

with:

```ts
import { Direction, EVERY_CHOICES, type ItemStack, type RobotActionKind, type RobotSize, type TileCoord, type TileRect } from './core/types';
```

Replace `RobotSizeSpec` and `ROBOT_SIZE_SPECS`:

```ts
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
```

In `ROBOTS`, replace the last two keys:

```ts
  sayMaxLength: 60,
  maxWaitMinutes: 240,
} as const;
```

with:

```ts
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
} as const;
```

**3c. `src/robots/stats.ts`.** Replace `actionCost` (the last function in the file) with:

```ts
/** A base (Mini) token cost scaled for this robot: × size, × 0.75 with an efficient core, floored, at least 1. */
export function scaledCost(robot: RobotBody, base: number): number {
  const factor = hasPart(robot, 'efficientCore') ? ROBOTS.efficientCoreFactor : 1;
  return Math.max(1, Math.floor(base * ROBOTS.sizes[robot.size].costMultiplier * factor));
}

/** Tokens an action costs: 0 stays 0; otherwise scaledCost of its base cost. */
export function actionCost(robot: RobotBody, kind: RobotActionKind): number {
  const base: number = ROBOTS.cost[kind];
  return base === 0 ? 0 : scaledCost(robot, base);
}

/** Tokens a trigger costs to wake the robot from standby (farmclaws part 2 §7). */
export function wakeCostFor(robot: RobotBody): number {
  return scaledCost(robot, ROBOTS.wakeCost);
}
```

**3d. `src/robots/run.ts`.** Widening `RobotProgram` breaks `robot.program.steps`. Replace the start of `runRobotsMinute`:

```ts
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
```

with:

```ts
/**
 * One minute (state.time.minuteOfDay is the minute being processed): every due robot chooses
 * against the state at the start of the minute; robots that can't pay go flat; successful
 * tile actions on a shared tile bicker; the rest are re-planned and applied in id order.
 * Due robots are working script robots that aren't carried; a script robot chooses `steps[pc]`.
 */
export function runRobotsMinute(state: GameState): GameState {
  const minute = state.time.minuteOfDay;
  const due = state.robots.list.filter(
    (r) => r.program.kind === 'script' && !r.carried && r.power === 'working' && r.nextActMinute <= minute,
  );
  if (due.length === 0) return state;

  let next = state;
  const chosen: { readonly id: number; readonly plan: RobotPlan }[] = [];
  for (const robot of due) {
    const program = robot.program;
    invariant(program.kind === 'script', `robot ${robot.id} is due without a script`);
    const action = program.steps[robot.pc];
```

(The next line, `invariant(action !== undefined, …)`, stays.)

**3e. `src/robots/execute.ts`.** Replace the doc comment and the opening of `settle` down to the end of the `if (pc >= …)` block:

```ts
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
```

with:

```ts
/**
 * Finishes a robot's turn: advances a script's pc (a non-looping script past its end goes to
 * standby and logs 'finished'; a block program's pc stays 0), schedules its next action and
 * records lastAction for the renderer.
 */
function settle(state: GameState, robotId: number, action: RobotAction, success: boolean, bickered: boolean): GameState {
  const robot = requireRobot(state, robotId);
  const program = robot.program;
  const seq = robot.actionSeq + 1;
  let pc = robot.pc;
  let power = robot.power;
  let finished = false;
  if (program.kind === 'script') {
    pc = robot.pc + 1;
    if (pc >= program.steps.length) {
      pc = 0;
      if (!program.loop && power === 'working') {
        power = 'standby';
        finished = true;
      }
    }
  }
```

The rest of `settle` is unchanged.

**3f. `src/state/robotValidation.ts`.** In the `../core/types` import, replace `type RobotProgram,` with `type RobotScript,`. Replace the first line of `isValidRobotProgram`:

```ts
export function isValidRobotProgram(v: unknown): v is RobotProgram {
```

with:

```ts
/** A part 1 script: 1 … maxScriptSteps valid steps and a loop flag. Block programs are checked separately. */
export function isValidRobotProgram(v: unknown): v is RobotScript {
```

(`isValidRobot`'s `v.program.steps.length` now type-checks again, because the guard narrows to a script.)

- [ ] **Step 4: Run it and see it pass**

Run: `npx vitest run tests/robotStats.test.ts`
Expected: PASS (13 tests).

- [ ] **Step 5: The full gate**

Run: `npm run typecheck && npm test && npm run build`
Expected: all green. Every part 1 test passes unchanged (no block-program robot can exist yet: `addRobot` still accepts scripts only).

- [ ] **Step 6: Commit**

```bash
git add src/core/types.ts src/config.ts src/robots/stats.ts src/robots/run.ts src/robots/execute.ts src/state/robotValidation.ts tests/robotStats.test.ts
git commit -m "Farmclaws part 2: language types, size limits and the wake cost

RobotProgram widens to RobotScript | BlockProgram. Until block robots run (task 8),
runRobotsMinute only runs scripts and settle only advances a script's pc.
EVERY_CHOICES lives in core/types so the Trigger type needs no config import.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Program helpers, the builder and the checker

**Files:**
- Create: `src/robots/program.ts`, `src/robots/blocks.ts`, `src/robots/check.ts`
- Test: `tests/robotCheck.test.ts`

**Interfaces:**
- Consumes: Task 1 types (`BlockProgram`, `Expr`, `Statement`, `ActionBlock`, `ListRef`, `Value`, `VarDecl`, `Trigger`, `TriggerStack`, `HelperDef`, `MdCard`, `ZoneRect`, `ZONE_IDS`, `EVERY_CHOICES`, `ValueType`) and config (`ROBOTS.sizes[size].blocks/vars/mdCards`, `maxStacks`, `maxFrames`, `maxNumber`, `maxTextLength`, `maxIdentifierLength`, `everyChoices`, `sayMaxLength`, `maxScriptSteps`; `TIME.dayStartMinute`, `TIME.passOutMinute`). Part 1: `MAPS.farm.grid` (`src/world/maps`), `inBounds(grid, tx, tz)` (`src/world/grid.ts`), `isValidRobotAction` (`src/state/robotValidation.ts`), `hasPart`, `batteryFor` (`src/robots/stats.ts`).
- Produces:
  - `src/robots/program.ts`: `export function farmContains(tx: number, tz: number): boolean`; `export function isLiteral(expr: Expr): boolean`; `export function literalValue(expr: Expr): Value` (RangeError for a non-literal); `export function resolveList(program: BlockProgram, ref: ListRef): readonly Statement[] | null`; `export function blockCount(program: BlockProgram): number`; `export function statementDepth(program: BlockProgram): number`. Also exported (extra walkers, used by check.ts): `exprChildren(expr): readonly Expr[]`, `statementExprs(statement): readonly Expr[]`, `childLists(statement): readonly (readonly Statement[])[]`.
  - `src/robots/blocks.ts`: `export const b` — every builder listed in the contract, with `numVar(name, number)`, `textVar(name, string)`, `yesVar(name, boolean)`, `itemVar(name, ItemId)`, `tileVar(name, tx, tz)`, `forever(...body)` (zero or more), `take(Expr | ItemId)`, `say(Expr | string)`, number-or-Expr sockets (`repeat`, `wait`, `change`, `tokensBelow`, `add/sub/mul`, `eq/ne/lt/gt`), and `program({ vars?, stacks, helpers? })` taking plain (mutable or readonly) arrays.
  - `src/robots/check.ts`: `export function typeOf(expr: Expr, vars: readonly VarDecl[]): ValueType | null`; `export function checkProgram(program: RobotProgram, robot: Pick<Robot, 'size' | 'parts'>): string | null`; `export function checkMd(md: readonly MdCard[], robot: Pick<Robot, 'size'>): string | null`; `export function isValidZoneRect(rect: ZoneRect): boolean`.

Rulings this task makes (recorded in the commit message):
- "Within the day" for `atTime`, `timeIsAfter` and DO return minutes is `TIME.dayStartMinute` … `TIME.passOutMinute − 1`: the minutes a robot can act in.
- `statementDepth` counts the frames the interpreter (Task 6) pushes: a stack body is 1; a loop body, an if branch and a helper body each add 1; `Go to` adds its route frame (+1); `For each tile` adds its body frame with a route frame on top (+2 at least). So a program the checker accepts never needs more than `ROBOTS.maxFrames` frames.
- Variable declarations count 0 blocks (spec §4 lists only triggers, statements, helper definitions and non-literal expressions).

- [ ] **Step 1: Write the failing test `tests/robotCheck.test.ts`**

```ts
/**
 * The checker (farmclaws part 2 spec §4) and the program helpers it stands on: one fault at a
 * time with its exact message, block counting (literals free), frame depth, the .MD rules and
 * zone rectangles.
 */
import { describe, expect, it } from 'vitest';
import { ROBOTS, TIME } from '../src/config';
import { ZONE_IDS, type BlockProgram, type MdCard, type RobotPartId, type RobotScript, type RobotSize, type Statement, type VarDecl } from '../src/core/types';
import { b } from '../src/robots/blocks';
import { checkMd, checkProgram, isValidZoneRect, typeOf } from '../src/robots/check';
import { blockCount, farmContains, isLiteral, literalValue, resolveList, statementDepth } from '../src/robots/program';

const body = (size: RobotSize, parts: readonly RobotPartId[] = []) => ({ size, parts });
/** Big robots have room for everything, so a fault test trips only the rule under test. */
const BIG = body('big');
const one = (...statements: Statement[]): BlockProgram => b.program({ stacks: [b.when(b.morning(), ...statements)] });
const withVars = (vars: VarDecl[], ...statements: Statement[]): BlockProgram => b.program({ vars, stacks: [b.when(b.morning(), ...statements)] });
const moves = (count: number): Statement[] => Array.from({ length: count }, () => b.move());
const check = (program: BlockProgram) => checkProgram(program, BIG);

describe('checkProgram: scripts', () => {
  const script = (steps: RobotScript['steps']): RobotScript => ({ kind: 'script', steps, loop: true });

  it('accepts a part 1 script', () => {
    expect(checkProgram(script([{ kind: 'move' }, { kind: 'wait', minutes: 30 }]), body('mini'))).toBeNull();
  });

  it.each([
    ['empty', script([])],
    ['too long', script(Array.from({ length: ROBOTS.maxScriptSteps + 1 }, () => ({ kind: 'move' as const })))],
    ['with an invalid step', script([{ kind: 'wait', minutes: 0 }])],
  ])('rejects a script that is %s', (_label, program) => {
    expect(checkProgram(program, body('mini'))).toBe('That program is not a valid script.');
  });
});

describe('checkProgram: shape', () => {
  it('needs 1 to maxStacks trigger stacks', () => {
    const stacks = (count: number) => b.program({ stacks: Array.from({ length: count }, () => b.when(b.morning(), b.move())) });
    expect(check(stacks(0))).toBe('A program needs 1 to 8 trigger stacks.');
    expect(check(stacks(ROBOTS.maxStacks + 1))).toBe('A program needs 1 to 8 trigger stacks.');
    expect(check(stacks(ROBOTS.maxStacks))).toBeNull();
  });

  it('needs valid, unique variable names', () => {
    const invalid = 'Variable names are 1 to 16 characters, with no spaces at either end.';
    expect(check(withVars([b.numVar('rows', 1), b.numVar('rows', 2)]))).toBe('Two variables are called "rows".');
    expect(check(withVars([b.numVar('', 1)]))).toBe(invalid);
    expect(check(withVars([b.numVar(' rows', 1)]))).toBe(invalid);
    expect(check(withVars([b.numVar('a'.repeat(ROBOTS.maxIdentifierLength + 1), 1)]))).toBe(invalid);
    expect(check(withVars([b.numVar('a'.repeat(ROBOTS.maxIdentifierLength), 1)]))).toBeNull();
  });

  it('needs valid, unique helper names', () => {
    const helpers = (...names: string[]) => b.program({ stacks: [b.when(b.morning(), b.move())], helpers: names.map((name) => b.helper(name, b.move())) });
    expect(check(helpers('spin', 'spin'))).toBe('Two helpers are called "spin".');
    expect(check(helpers('spin '))).toBe('Helper names are 1 to 16 characters, with no spaces at either end.');
    expect(check(helpers('spin', 'hop'))).toBeNull();
  });

  it('needs every variable it reads, sets or changes to be declared', () => {
    expect(check(withVars([b.numVar('rows', 1)], b.set('rows', b.v('cols'))))).toBe('There\'s no variable called "cols".');
    expect(check(one(b.set('cols', b.n(1))))).toBe('There\'s no variable called "cols".');
    expect(check(one(b.change('cols', 1)))).toBe('There\'s no variable called "cols".');
  });

  it('needs every helper it runs to exist', () => {
    expect(check(one(b.run('dance')))).toBe('There\'s no helper called "dance".');
  });

  it('refuses helpers that end up running themselves', () => {
    const cycle = b.program({ stacks: [b.when(b.morning(), b.run('a'))], helpers: [b.helper('a', b.run('b')), b.helper('b', b.run('a'))] });
    expect(check(cycle)).toBe('Helper "a" ends up running itself.');
    const self = b.program({ stacks: [b.when(b.morning(), b.run('x'))], helpers: [b.helper('x', b.move(), b.run('x'))] });
    expect(check(self)).toBe('Helper "x" ends up running itself.');
    const chain = b.program({ stacks: [b.when(b.morning(), b.run('a'), b.run('b'))], helpers: [b.helper('a', b.run('b')), b.helper('b', b.move())] });
    expect(check(chain)).toBeNull();
  });

  it('keeps tile literals on the farm', () => {
    expect(check(one(b.goTo(b.tileAt(48, 0))))).toBe("Tile (48, 0) isn't on the farm.");
    expect(check(one(b.goTo(b.tileAt(0, -1))))).toBe("Tile (0, -1) isn't on the farm.");
    expect(check(withVars([b.tileVar('home', 3, 40)]))).toBe("Tile (3, 40) isn't on the farm.");
    expect(check(one(b.goTo(b.tileAt(47, 39))))).toBeNull();
  });

  it('keeps times within the robot day', () => {
    const at = (minute: number) => b.program({ stacks: [b.when(b.atTime(minute), b.move())] });
    expect(check(at(TIME.dayStartMinute - 1))).toBe("That time is outside the robot's day.");
    expect(check(at(TIME.passOutMinute))).toBe("That time is outside the robot's day.");
    expect(check(at(TIME.dayStartMinute))).toBeNull();
    expect(check(at(TIME.passOutMinute - 1))).toBeNull();
    const after = (minute: number) => checkProgram(one(b.if(b.timeIsAfter(minute), [b.move()])), body('big', ['sensorEye']));
    expect(after(TIME.dayStartMinute - 1)).toBe("That time is outside the robot's day.");
    expect(after(TIME.passOutMinute)).toBe("That time is outside the robot's day.");
    expect(after(18 * 60)).toBeNull();
  });

  it('only allows the listed Every choices', () => {
    expect(check(b.program({ stacks: [b.when(b.every(7 as never), b.move())] }))).toBe('Every can only be 5, 10, 15, 30, 60 minutes.');
    for (const minutes of ROBOTS.everyChoices) expect(check(b.program({ stacks: [b.when(b.every(minutes), b.move())] }))).toBeNull();
  });

  it('keeps number literals whole and within ±maxNumber', () => {
    const message = 'Numbers must be whole and within ±999999.';
    expect(check(one(b.wait(b.n(ROBOTS.maxNumber + 1))))).toBe(message);
    expect(check(one(b.wait(b.n(-ROBOTS.maxNumber - 1))))).toBe(message);
    expect(check(one(b.wait(b.n(2.5))))).toBe(message);
    expect(check(one(b.wait(b.n(ROBOTS.maxNumber)), b.wait(b.n(-ROBOTS.maxNumber))))).toBeNull();
  });

  it('keeps Say literals 1 to sayMaxLength characters once trimmed', () => {
    expect(check(one(b.say('   ')))).toBe('Say needs something to say.');
    expect(check(one(b.say('a'.repeat(ROBOTS.sayMaxLength + 1))))).toBe('Say can say at most 60 characters.');
    expect(check(one(b.say(`  ${'a'.repeat(ROBOTS.sayMaxLength - 4)}  `)))).toBeNull();
  });

  it('keeps other text literals within maxTextLength', () => {
    expect(check(withVars([b.textVar('note', 'a'.repeat(ROBOTS.maxTextLength + 1))]))).toBe('Text holds at most 60 characters.');
    expect(check(withVars([b.textVar('note', '')]))).toBeNull();
  });

  it('reports shape problems before type problems', () => {
    const program = b.program({ stacks: [b.when(b.morning(), b.repeat(b.text('3'))), b.when(b.bagFull(), b.set('cols', b.n(1)))] });
    expect(check(program)).toBe('There\'s no variable called "cols".');
  });
});

describe('checkProgram: types', () => {
  const rows = b.numVar('rows', 3);
  const cases: readonly [string, BlockProgram, string][] = [
    ['Repeat with text', one(b.repeat(b.text('3'), b.move())), 'Repeat needs a number.'],
    ['Repeat until with a number', one(b.repeatUntil(b.n(1), b.move())), 'Repeat until needs a yes or no.'],
    ['If with a number', one(b.if(b.n(1), [b.move()])), 'If needs a yes or no.'],
    ['< on items', one(b.if(b.lt(b.item('parsnip'), b.item('wood')), [b.move()])), '< and > need two numbers.'],
    ['= mixing types', one(b.if(b.eq(b.n(1), b.text('1')), [b.move()])), '= and ≠ need two values of the same type.'],
    ['+ with a yes/no', one(b.wait(b.add(b.yes(true), 1))), '+, - and × need two numbers.'],
    ['And with a number', one(b.if(b.and(b.n(1), b.yes(true)), [b.move()])), 'And and Or need two yes-or-no values.'],
    ['Not with a tile', one(b.if(b.not(b.myTile()), [b.move()])), 'Not needs a yes-or-no value.'],
    ['Set with the wrong type', withVars([rows], b.set('rows', b.text('three'))), 'Set "rows" needs a number.'],
    ['an initial value that is not a literal', withVars([{ name: 'rows', type: 'number', initial: b.tokensLeft() }]), '"rows" must start as a fixed value.'],
    ['an initial value of the wrong type', withVars([{ name: 'rows', type: 'number', initial: b.text('3') }]), '"rows" must start as a number.'],
    ['Tokens below with text', one(b.if(b.tokensBelow(b.text('5')), [b.move()])), 'Tokens below needs a number.'],
    ['Go to with an item', one(b.goTo(b.item('wood'))), 'Go to needs a tile.'],
    ['Take with a number', one(b.take(b.n(3))), 'Take needs an item.'],
    ['Wait with text', one(b.wait(b.text('soon'))), 'Wait needs a number.'],
    ['Say with a number', one(b.say(b.n(5))), 'Say needs text.'],
    ['Change on a text variable', withVars([b.textVar('note', 'hi')], b.change('note', 1)), 'Change only works on number variables.'],
    ['Change by text', withVars([rows], b.change('rows', b.text('1'))), 'Change needs a number.'],
    ['an inner fault inside an outer one', one(b.if(b.not(b.add(b.yes(true), 1)), [b.move()])), '+, - and × need two numbers.'],
  ];

  it.each(cases)('rejects %s', (_label, program, message) => {
    expect(check(program)).toBe(message);
  });

  it('accepts well-typed sockets of every type', () => {
    const program = b.program({
      vars: [rows, b.textVar('note', 'Done'), b.yesVar('busy', false), b.itemVar('seed', 'parsnip_seeds'), b.tileVar('home', 5, 10)],
      stacks: [
        b.when(
          b.morning(),
          b.repeat(b.v('rows'), b.water(), b.move()),
          b.repeatUntil(b.or(b.v('busy'), b.tokensBelow(b.v('rows'))), b.change('rows', b.sub(b.v('rows'), 1))),
          b.if(b.eq(b.myTile(), b.v('home')), [b.say(b.v('note'))], [b.goTo(b.v('home'))]),
          b.if(b.and(b.ne(b.v('seed'), b.item('wood')), b.gt(b.countInBag('parsnip'), b.tokensLeft())), [b.take(b.v('seed'))]),
          b.set('home', b.tileAhead()),
          b.set('busy', b.not(b.bagIsFull())),
          b.wait(b.mul(b.v('rows'), 2)),
        ),
      ],
    });
    expect(check(program)).toBeNull();
  });

  it('types every expression kind', () => {
    const vars = [rows];
    expect(typeOf(b.n(1), vars)).toBe('number');
    expect(typeOf(b.text('hi'), vars)).toBe('text');
    expect(typeOf(b.yes(true), vars)).toBe('yesNo');
    expect(typeOf(b.item('wood'), vars)).toBe('item');
    expect(typeOf(b.tileAt(1, 1), vars)).toBe('tile');
    expect(typeOf(b.v('rows'), vars)).toBe('number');
    expect(typeOf(b.v('cols'), vars)).toBeNull();
    expect([typeOf(b.myTile(), vars), typeOf(b.tileAhead(), vars)]).toEqual(['tile', 'tile']);
    expect([typeOf(b.tokensLeft(), vars), typeOf(b.countInBag('wood'), vars)]).toEqual(['number', 'number']);
    expect([typeOf(b.add(1, 2), vars), typeOf(b.add(b.yes(true), 2), vars)]).toEqual(['number', null]);
    expect([typeOf(b.lt(1, 2), vars), typeOf(b.lt(b.item('wood'), b.item('wood')), vars)]).toEqual(['yesNo', null]);
    expect([typeOf(b.eq(b.item('wood'), b.item('stone')), vars), typeOf(b.eq(1, b.text('1')), vars)]).toEqual(['yesNo', null]);
    expect([typeOf(b.and(b.yes(true), b.yes(false)), vars), typeOf(b.not(b.n(1)), vars)]).toEqual(['yesNo', null]);
    expect([typeOf(b.tokensBelow(5), vars), typeOf(b.tokensBelow(b.text('5')), vars)]).toEqual(['yesNo', null]);
    const sensors = [b.cropIsReady(), b.soilIsDry(), b.tileIsTilled(), b.cropIs('parsnip'), b.bagIsFull(), b.bagHas('wood'), b.atEdgeOf('A'), b.tileAheadIs('water'), b.itIsRaining(), b.timeIsAfter(720)];
    for (const sensor of sensors) expect(typeOf(sensor, vars)).toBe('yesNo');
  });
});

describe('checkProgram: parts', () => {
  it.each([
    ['Tile ahead is', b.tileAheadIs('water')],
    ['It is raining', b.itIsRaining()],
    ['Time is after', b.timeIsAfter(720)],
  ])('needs a sensor eye for "%s"', (name, sensor) => {
    const program = one(b.if(sensor, [b.move()]));
    expect(checkProgram(program, body('mini'))).toBe(`The "${name}" sensor needs a sensor eye.`);
    expect(checkProgram(program, body('mini', ['sensorEye']))).toBeNull();
  });

  it('lets action blocks through without their parts (a run-time noPart mistake)', () => {
    expect(checkProgram(one(b.water(), b.harvest(), b.till()), body('mini'))).toBeNull();
  });
});

describe('checkProgram: limits', () => {
  it.each([
    ['mini', 'Mini robots hold 12 blocks; this program has 13.'],
    ['standard', 'Standard robots hold 30 blocks; this program has 31.'],
    ['big', 'Big robots hold 80 blocks; this program has 81.'],
  ] as const)('holds exactly the block limit of a %s', (size, message) => {
    const limit = ROBOTS.sizes[size].blocks;
    expect(checkProgram(one(...moves(limit - 1)), body(size))).toBeNull();
    expect(checkProgram(one(...moves(limit)), body(size))).toBe(message);
  });

  it.each([
    ['mini', 'Mini robots hold 1 variable; this program has 2.'],
    ['standard', 'Standard robots hold 3 variables; this program has 4.'],
    ['big', 'Big robots hold 6 variables; this program has 7.'],
  ] as const)('holds exactly the variable limit of a %s', (size, message) => {
    const vars = (count: number) => Array.from({ length: count }, (_, i) => b.numVar(`v${i}`, i));
    const limit = ROBOTS.sizes[size].vars;
    expect(checkProgram(withVars(vars(limit), b.move()), body(size))).toBeNull();
    expect(checkProgram(withVars(vars(limit + 1), b.move()), body(size))).toBe(message);
  });

  it('holds frames up to maxFrames deep', () => {
    const nest = (levels: number): Statement => (levels === 0 ? b.move() : b.forever(nest(levels - 1)));
    expect(check(one(nest(ROBOTS.maxFrames - 1)))).toBeNull();
    expect(check(one(nest(ROBOTS.maxFrames)))).toBe('This program nests 17 levels deep; robots keep track of 16.');
  });

  it('counts blocks before variables', () => {
    expect(checkProgram(withVars([b.numVar('a', 1), b.numVar('b', 2)], ...moves(12)), body('mini'))).toBe('Mini robots hold 12 blocks; this program has 13.');
  });
});

describe('valid programs', () => {
  it('passes a program for each size', () => {
    const mini = b.program({ vars: [b.numVar('rows', 3)], stacks: [b.when(b.morning(), b.repeat(b.v('rows'), b.water(), b.move()), b.powerDown())] });
    expect(checkProgram(mini, body('mini', ['wateringHead']))).toBeNull();

    const standard = b.program({
      vars: [b.textVar('note', 'All wet'), b.tileVar('home', 5, 10)],
      stacks: [
        b.when(b.morning(), b.forEach('A', b.if(b.soilIsDry(), [b.water()])), b.goTo(b.v('home')), b.say(b.v('note'))),
        b.when(b.every(15), b.if(b.itIsRaining(), [b.powerDown()], [b.run('spin')])),
      ],
      helpers: [b.helper('spin', b.turn('right'), b.turn('right'))],
    });
    expect(checkProgram(standard, body('standard', ['wateringHead', 'sensorEye']))).toBeNull();

    const big = b.program({
      vars: [b.numVar('count', 0), b.textVar('note', 'Full'), b.yesVar('done', false), b.itemVar('crop', 'parsnip'), b.tileVar('chest', 9, 12)],
      stacks: [
        b.when(b.morning(), b.repeatUntil(b.or(b.v('done'), b.bagIsFull()), b.run('row'), b.change('count', 1))),
        b.when(b.atTime(18 * 60), b.goTo(b.v('chest')), b.deposit()),
        b.when(b.bagFull(), b.say(b.v('note')), b.run('unload')),
        b.when(b.startsRaining(), b.set('done', b.yes(true))),
        b.when(b.every(60), b.if(b.and(b.timeIsAfter(20 * 60), b.gt(b.v('count'), 3)), [b.powerDown()])),
      ],
      helpers: [
        b.helper('row', b.repeat(6, b.if(b.and(b.cropIsReady(), b.cropIs('parsnip')), [b.harvest()]), b.if(b.tileAheadIs('clear'), [b.move()], [b.turn('left')]))),
        b.helper('unload', b.goTo(b.v('chest')), b.deposit(), b.take(b.item('parsnip_seeds'))),
      ],
    });
    expect(checkProgram(big, body('big', ['claw', 'basket', 'sensorEye']))).toBeNull();
  });
});

describe('blockCount', () => {
  it('counts triggers and statements, and leaves literals free', () => {
    const spec = b.program({ vars: [b.numVar('rows', 3)], stacks: [b.when(b.morning(), b.repeat(3, b.water(), b.move()), b.powerDown())] });
    expect(blockCount(spec)).toBe(5);
    expect(blockCount(one(b.goTo(b.tileAt(5, 10))))).toBe(2);
    expect(blockCount(one(b.goTo(b.myTile())))).toBe(3);
    expect(blockCount(one(b.say('Hello'), b.wait(30), b.turn('left'), b.plant('parsnip')))).toBe(5);
  });

  it('counts helper definitions and every non-literal expression node', () => {
    const helper = b.program({ stacks: [b.when(b.morning(), b.run('turnAround'))], helpers: [b.helper('turnAround', b.turn('right'), b.turn('right'))] });
    expect(blockCount(helper)).toBe(5);
    expect(blockCount(one(b.if(b.and(b.cropIsReady(), b.not(b.bagIsFull())), [b.harvest()], [b.move()])))).toBe(8);
    expect(blockCount(withVars([b.numVar('rows', 3)], b.set('rows', b.add(b.v('rows'), 1))))).toBe(4);
    expect(blockCount(one(b.if(b.tokensBelow(b.add(b.tokensLeft(), 2)), [])))).toBe(5);
  });

  it('does not count variable declarations', () => {
    expect(blockCount(withVars([b.numVar('a', 1), b.tileVar('b', 1, 1)], b.move()))).toBe(blockCount(one(b.move())));
  });
});

describe('statementDepth', () => {
  it('counts the frames each statement can push', () => {
    expect(statementDepth(one(b.move()))).toBe(1);
    expect(statementDepth(one(b.repeat(2, b.move())))).toBe(2);
    expect(statementDepth(one(b.goTo(b.myTile())))).toBe(2);
    // For each tile: its body frame, with a route frame on top while it walks to each tile.
    expect(statementDepth(one(b.forEach('A')))).toBe(3);
    expect(statementDepth(one(b.forEach('A', b.water())))).toBe(3);
    expect(statementDepth(one(b.forEach('A', b.if(b.soilIsDry(), [b.water()]))))).toBe(3);
    expect(statementDepth(one(b.forEach('A', b.if(b.soilIsDry(), [b.goTo(b.myTile())]))))).toBe(4);
    expect(statementDepth(one(b.if(b.yes(true), [b.move()], [b.repeat(2, b.goTo(b.myTile()))])))).toBe(4);
  });

  it('follows helpers through the call chain and takes the deepest stack', () => {
    const program = b.program({
      stacks: [b.when(b.morning(), b.move()), b.when(b.bagFull(), b.repeat(2, b.run('h')))],
      helpers: [b.helper('h', b.if(b.yes(true), [b.goTo(b.myTile())]))],
    });
    expect(statementDepth(program)).toBe(5);
  });
});

describe('program helpers', () => {
  it('tells literals apart and reads their values', () => {
    expect([b.n(1), b.text('a'), b.yes(true), b.item('wood'), b.tileAt(2, 3)].every(isLiteral)).toBe(true);
    expect([b.v('x'), b.myTile(), b.add(1, 2), b.cropIsReady()].some(isLiteral)).toBe(false);
    expect(literalValue(b.n(-4))).toEqual({ type: 'number', value: -4 });
    expect(literalValue(b.text('hi'))).toEqual({ type: 'text', value: 'hi' });
    expect(literalValue(b.yes(false))).toEqual({ type: 'yesNo', value: false });
    expect(literalValue(b.item('wood'))).toEqual({ type: 'item', value: 'wood' });
    expect(literalValue(b.tileAt(2, 3))).toEqual({ type: 'tile', value: { tx: 2, tz: 3 } });
    expect(() => literalValue(b.v('x'))).toThrow(RangeError);
  });

  it('knows the farm tiles', () => {
    expect([farmContains(0, 0), farmContains(47, 39)]).toEqual([true, true]);
    expect([farmContains(48, 0), farmContains(0, 40), farmContains(-1, 0), farmContains(1.5, 2)]).toEqual([false, false, false, false]);
  });

  it('resolves list references, and returns null for any that miss', () => {
    const inner = b.if(b.yes(true), [b.move()], [b.turn('left')]);
    const program = b.program({
      stacks: [b.when(b.morning(), b.repeat(2, inner), b.move(), b.if(b.yes(true), [b.water()]))],
      helpers: [b.helper('h', b.water())],
    });
    const stack = program.stacks[0]!;
    expect(resolveList(program, { root: 'stack', index: 0, path: [] })).toBe(stack.body);
    expect(resolveList(program, { root: 'stack', index: 0, path: [[0, 'body']] })).toEqual([inner]);
    expect(resolveList(program, { root: 'stack', index: 0, path: [[0, 'body'], [0, 'then']] })).toEqual([b.move()]);
    expect(resolveList(program, { root: 'stack', index: 0, path: [[0, 'body'], [0, 'else']] })).toEqual([b.turn('left')]);
    expect(resolveList(program, { root: 'helper', index: 0, path: [] })).toBe(program.helpers[0]!.body);
    expect(resolveList(program, { root: 'stack', index: 1, path: [] })).toBeNull();
    expect(resolveList(program, { root: 'helper', index: 1, path: [] })).toBeNull();
    expect(resolveList(program, { root: 'stack', index: 0, path: [[1, 'body']] })).toBeNull();
    expect(resolveList(program, { root: 'stack', index: 0, path: [[0, 'then']] })).toBeNull();
    expect(resolveList(program, { root: 'stack', index: 0, path: [[2, 'else']] })).toBeNull();
    expect(resolveList(program, { root: 'stack', index: 0, path: [[9, 'body']] })).toBeNull();
  });
});

describe('checkMd', () => {
  /** Eleven distinct cards: one more than the biggest robot holds. */
  const CARDS: readonly MdCard[] = [
    ...ZONE_IDS.map((zone): MdCard => ({ kind: 'dontLeave', zone })),
    { kind: 'dontGoIntoWater' },
    { kind: 'dontHarvest', cropId: 'pumpkin' },
    { kind: 'dontDeposit', itemId: 'wood' },
  ];

  it.each([
    ['mini', 'Mini robots hold 3 .MD cards; this .MD has 4.'],
    ['standard', 'Standard robots hold 6 .MD cards; this .MD has 7.'],
    ['big', 'Big robots hold 10 .MD cards; this .MD has 11.'],
  ] as const)('holds exactly the card limit of a %s', (size, message) => {
    const limit = ROBOTS.sizes[size].mdCards;
    expect(checkMd(CARDS.slice(0, limit), { size })).toBeNull();
    expect(checkMd(CARDS.slice(0, limit + 1), { size })).toBe(message);
  });

  it('keeps DO return tiles on the farm and its minute in the day', () => {
    const home = (tx: number, tz: number, minute: number): MdCard => ({ kind: 'doReturn', to: { kind: 'tile', tx, tz }, minute });
    expect(checkMd([home(48, 0, 1080)], { size: 'mini' })).toBe("Tile (48, 0) isn't on the farm.");
    expect(checkMd([home(9, 12, 1080)], { size: 'mini' })).toBeNull();
    const generator = (minute: number): MdCard => ({ kind: 'doReturn', to: { kind: 'generator' }, minute });
    expect(checkMd([generator(TIME.dayStartMinute - 1)], { size: 'mini' })).toBe("That time is outside the robot's day.");
    expect(checkMd([generator(TIME.passOutMinute)], { size: 'mini' })).toBe("That time is outside the robot's day.");
    expect(checkMd([generator(18 * 60)], { size: 'mini' })).toBeNull();
  });

  it('keeps DO power down below n tokens within 1 … battery', () => {
    const below = (n: number): MdCard => ({ kind: 'doPowerDown', when: { kind: 'tokensBelow', n } });
    expect(checkMd([below(0)], { size: 'mini' })).toBe('Power down below needs a number of tokens from 1 to 80.');
    expect(checkMd([below(81)], { size: 'mini' })).toBe('Power down below needs a number of tokens from 1 to 80.');
    expect(checkMd([below(1)], { size: 'mini' })).toBeNull();
    expect(checkMd([below(80)], { size: 'mini' })).toBeNull();
    expect(checkMd([below(500)], { size: 'big' })).toBeNull();
    expect(checkMd([below(501)], { size: 'big' })).toBe('Power down below needs a number of tokens from 1 to 500.');
  });

  it('refuses the same card twice, whatever its key order', () => {
    expect(checkMd([{ kind: 'dontGoIntoWater' }, { kind: 'dontGoIntoWater' }], { size: 'mini' })).toBe('The .MD has the same card twice.');
    const a: MdCard = { kind: 'doReturn', to: { kind: 'generator' }, minute: 1080 };
    const b2 = { minute: 1080, to: { kind: 'generator' }, kind: 'doReturn' } as MdCard;
    expect(checkMd([a, b2], { size: 'mini' })).toBe('The .MD has the same card twice.');
    expect(checkMd([a, { ...a, minute: 1081 }], { size: 'mini' })).toBeNull();
    expect(checkMd([], { size: 'mini' })).toBeNull();
  });
});

describe('isValidZoneRect', () => {
  it.each([
    [{ x0: 0, z0: 0, w: 48, d: 40 }, true],
    [{ x0: 47, z0: 39, w: 1, d: 1 }, true],
    [{ x0: 3, z0: 9, w: 3, d: 3 }, true],
    [{ x0: 0, z0: 0, w: 49, d: 40 }, false],
    [{ x0: 0, z0: 0, w: 48, d: 41 }, false],
    [{ x0: 46, z0: 0, w: 3, d: 1 }, false],
    [{ x0: -1, z0: 0, w: 2, d: 2 }, false],
    [{ x0: 0, z0: 0, w: 0, d: 3 }, false],
    [{ x0: 0, z0: 0, w: 3, d: 0 }, false],
    [{ x0: 1.5, z0: 0, w: 2, d: 2 }, false],
    [{ x0: 0, z0: 0, w: 2.5, d: 2 }, false],
  ])('%j is %s', (rect, valid) => {
    expect(isValidZoneRect(rect)).toBe(valid);
  });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run tests/robotCheck.test.ts`
Expected: FAIL — `Failed to resolve import "../src/robots/blocks"` (none of the three modules exist yet).

- [ ] **Step 3: Create `src/robots/program.ts`**

```ts
/**
 * Structure helpers for block programs (farmclaws part 2 spec §2.3, §2.4, §4). Pure.
 */
import type { ActionBlock, BlockProgram, Expr, ListRef, Statement, Value } from '../core/types';
import { inBounds } from '../world/grid';
import { MAPS } from '../world/maps';

/** Whether (tx, tz) is a tile of the farm (integers inside its grid). */
export function farmContains(tx: number, tz: number): boolean {
  return inBounds(MAPS.farm.grid, tx, tz);
}

/** Literals are the five constant expressions; they count 0 blocks. */
export function isLiteral(expr: Expr): boolean {
  return expr.kind === 'num' || expr.kind === 'text' || expr.kind === 'yes' || expr.kind === 'item' || expr.kind === 'tile';
}

/** The value of a literal. Throws a RangeError for any other expression. */
export function literalValue(expr: Expr): Value {
  switch (expr.kind) {
    case 'num':
      return { type: 'number', value: expr.value };
    case 'text':
      return { type: 'text', value: expr.value };
    case 'yes':
      return { type: 'yesNo', value: expr.value };
    case 'item':
      return { type: 'item', value: expr.itemId };
    case 'tile':
      return { type: 'tile', value: { tx: expr.tx, tz: expr.tz } };
    default:
      throw new RangeError(`literalValue: '${expr.kind}' is not a literal`);
  }
}

/** The expressions directly below `expr` (operands), in order. */
export function exprChildren(expr: Expr): readonly Expr[] {
  switch (expr.kind) {
    case 'arith':
    case 'compare':
    case 'and':
    case 'or':
      return [expr.a, expr.b];
    case 'not':
      return [expr.a];
    case 'tokensBelow':
      return [expr.n];
    default:
      return [];
  }
}

function actionExprs(action: ActionBlock): readonly Expr[] {
  switch (action.kind) {
    case 'take':
      return [action.item];
    case 'say':
      return [action.text];
    case 'wait':
      return [action.minutes];
    default:
      return [];
  }
}

/** The expressions in a statement's own sockets (not those of its nested statements), in order. */
export function statementExprs(statement: Statement): readonly Expr[] {
  switch (statement.kind) {
    case 'do':
      return actionExprs(statement.action);
    case 'repeatTimes':
      return [statement.times];
    case 'repeatUntil':
      return [statement.until];
    case 'if':
      return [statement.cond];
    case 'goTo':
      return [statement.tile];
    case 'set':
      return [statement.value];
    case 'change':
      return [statement.by];
    default:
      return [];
  }
}

/** The statement lists nested directly in a statement: a loop's body, or an if's then and else. */
export function childLists(statement: Statement): readonly (readonly Statement[])[] {
  switch (statement.kind) {
    case 'repeatTimes':
    case 'repeatUntil':
    case 'repeatForever':
    case 'forEachTile':
      return [statement.body];
    case 'if':
      return statement.else === null ? [statement.then] : [statement.then, statement.else];
    default:
      return [];
  }
}

/** The statement list `ref` names, or null when it doesn't resolve (a missing root, index or branch). */
export function resolveList(program: BlockProgram, ref: ListRef): readonly Statement[] | null {
  const root = ref.root === 'stack' ? program.stacks[ref.index] : program.helpers[ref.index];
  if (root === undefined) return null;
  let list: readonly Statement[] = root.body;
  for (const [index, branch] of ref.path) {
    const statement = list[index];
    if (statement === undefined) return null;
    if (branch === 'body') {
      if (statement.kind !== 'repeatTimes' && statement.kind !== 'repeatUntil' && statement.kind !== 'repeatForever' && statement.kind !== 'forEachTile') {
        return null;
      }
      list = statement.body;
    } else {
      if (statement.kind !== 'if') return null;
      const next = branch === 'then' ? statement.then : statement.else;
      if (next === null) return null;
      list = next;
    }
  }
  return list;
}

function exprBlocks(expr: Expr): number {
  return exprChildren(expr).reduce((sum, child) => sum + exprBlocks(child), isLiteral(expr) ? 0 : 1);
}

function listBlocks(list: readonly Statement[]): number {
  return list.reduce((sum, statement) => sum + statementBlocks(statement), 0);
}

function statementBlocks(statement: Statement): number {
  const exprs = statementExprs(statement).reduce((sum, expr) => sum + exprBlocks(expr), 0);
  return childLists(statement).reduce((sum, list) => sum + listBlocks(list), 1 + exprs);
}

/**
 * Blocks in a program (spec §4): every trigger, statement, helper definition and non-literal
 * expression node is 1; literals, fields inside a block and variable declarations are 0.
 */
export function blockCount(program: BlockProgram): number {
  const stacks = program.stacks.reduce((sum, stack) => sum + 1 + listBlocks(stack.body), 0);
  return program.helpers.reduce((sum, helper) => sum + 1 + listBlocks(helper.body), stacks);
}

/**
 * The deepest frame stack any trigger stack can reach: its body is 1 frame; a loop body, an if
 * branch and a helper body each add a frame; `Go to` adds a route frame; `For each tile` adds its
 * body frame with a route frame on top. Helper calls are followed through the call chain. A
 * helper chain that calls itself has no finite depth (Infinity); the checker rejects it first.
 */
export function statementDepth(program: BlockProgram): number {
  const bodies = new Map(program.helpers.map((helper) => [helper.name, helper.body] as const));
  const helperDepths = new Map<string, number>();
  const visiting = new Set<string>();

  const helperDepth = (name: string): number => {
    const known = helperDepths.get(name);
    if (known !== undefined) return known;
    const body = bodies.get(name);
    if (body === undefined) return 0;
    if (visiting.has(name)) return Number.POSITIVE_INFINITY;
    visiting.add(name);
    const depth = listDepth(body);
    visiting.delete(name);
    helperDepths.set(name, depth);
    return depth;
  };

  const extraDepth = (statement: Statement): number => {
    switch (statement.kind) {
      case 'repeatTimes':
      case 'repeatUntil':
      case 'repeatForever':
        return listDepth(statement.body);
      case 'forEachTile':
        return Math.max(listDepth(statement.body), 2);
      case 'if':
        return Math.max(listDepth(statement.then), statement.else === null ? 0 : listDepth(statement.else));
      case 'goTo':
        return 1;
      case 'runHelper':
        return helperDepth(statement.name);
      default:
        return 0;
    }
  };

  const listDepth = (list: readonly Statement[]): number => 1 + list.reduce((deepest, statement) => Math.max(deepest, extraDepth(statement)), 0);

  return program.stacks.reduce((deepest, stack) => Math.max(deepest, listDepth(stack.body)), 0);
}
```

- [ ] **Step 4: Create `src/robots/blocks.ts`**

```ts
/**
 * The block builder (farmclaws part 2 spec §13): tiny constructors for programs as data, used by
 * tests, the dev console and later the preloaded job programs. Pure. It only builds data;
 * whether a program is valid is checkProgram's job.
 */
import type {
  ActionBlock,
  BlockProgram,
  CropId,
  EVERY_CHOICES,
  Expr,
  HelperDef,
  ItemId,
  Statement,
  Trigger,
  TriggerStack,
  VarDecl,
  ZoneId,
} from '../core/types';

/** A number where an expression is expected becomes a number literal. */
type NumberLike = Expr | number;

const num = (value: NumberLike): Expr => (typeof value === 'number' ? { kind: 'num', value } : value);
const act = (action: ActionBlock): Statement => ({ kind: 'do', action });

export const b = {
  // programs
  program: (parts: { readonly vars?: readonly VarDecl[]; readonly stacks: readonly TriggerStack[]; readonly helpers?: readonly HelperDef[] }): BlockProgram => ({
    kind: 'blocks',
    vars: parts.vars ?? [],
    stacks: parts.stacks,
    helpers: parts.helpers ?? [],
  }),
  when: (trigger: Trigger, ...body: Statement[]): TriggerStack => ({ trigger, body }),
  helper: (name: string, ...body: Statement[]): HelperDef => ({ name, body }),

  // triggers
  morning: (): Trigger => ({ kind: 'morning' }),
  atTime: (minute: number): Trigger => ({ kind: 'atTime', minute }),
  bagFull: (): Trigger => ({ kind: 'bagFull' }),
  startsRaining: (): Trigger => ({ kind: 'startsRaining' }),
  every: (minutes: (typeof EVERY_CHOICES)[number]): Trigger => ({ kind: 'every', minutes }),

  // action statements
  move: (): Statement => act({ kind: 'move' }),
  turn: (side: 'left' | 'right'): Statement => act({ kind: 'turn', side }),
  water: (): Statement => act({ kind: 'water' }),
  harvest: (): Statement => act({ kind: 'harvest' }),
  till: (): Statement => act({ kind: 'till' }),
  plant: (cropId: CropId): Statement => act({ kind: 'plant', cropId }),
  refill: (): Statement => act({ kind: 'refill' }),
  deposit: (): Statement => act({ kind: 'deposit' }),
  take: (item: Expr | ItemId): Statement => act({ kind: 'take', item: typeof item === 'string' ? { kind: 'item', itemId: item } : item }),
  say: (text: Expr | string): Statement => act({ kind: 'say', text: typeof text === 'string' ? { kind: 'text', value: text } : text }),
  wait: (minutes: NumberLike): Statement => act({ kind: 'wait', minutes: num(minutes) }),
  powerDown: (): Statement => act({ kind: 'powerDown' }),

  // control statements
  repeat: (times: NumberLike, ...body: Statement[]): Statement => ({ kind: 'repeatTimes', times: num(times), body }),
  repeatUntil: (until: Expr, ...body: Statement[]): Statement => ({ kind: 'repeatUntil', until, body }),
  forever: (...body: Statement[]): Statement => ({ kind: 'repeatForever', body }),
  if: (cond: Expr, then: readonly Statement[], otherwise?: readonly Statement[]): Statement => ({ kind: 'if', cond, then, else: otherwise ?? null }),
  forEach: (zone: ZoneId, ...body: Statement[]): Statement => ({ kind: 'forEachTile', zone, body }),
  goTo: (tile: Expr): Statement => ({ kind: 'goTo', tile }),
  set: (name: string, value: Expr): Statement => ({ kind: 'set', name, value }),
  change: (name: string, by: NumberLike): Statement => ({ kind: 'change', name, by: num(by) }),
  run: (name: string): Statement => ({ kind: 'runHelper', name }),

  // literals and values
  n: (value: number): Expr => ({ kind: 'num', value }),
  text: (value: string): Expr => ({ kind: 'text', value }),
  yes: (value: boolean): Expr => ({ kind: 'yes', value }),
  item: (itemId: ItemId): Expr => ({ kind: 'item', itemId }),
  tileAt: (tx: number, tz: number): Expr => ({ kind: 'tile', tx, tz }),
  v: (name: string): Expr => ({ kind: 'var', name }),
  myTile: (): Expr => ({ kind: 'myTile' }),
  tileAhead: (): Expr => ({ kind: 'tileAhead' }),
  tokensLeft: (): Expr => ({ kind: 'tokensLeft' }),
  countInBag: (itemId: ItemId): Expr => ({ kind: 'countInBag', itemId }),
  add: (a: NumberLike, b: NumberLike): Expr => ({ kind: 'arith', op: '+', a: num(a), b: num(b) }),
  sub: (a: NumberLike, b: NumberLike): Expr => ({ kind: 'arith', op: '-', a: num(a), b: num(b) }),
  mul: (a: NumberLike, b: NumberLike): Expr => ({ kind: 'arith', op: '×', a: num(a), b: num(b) }),
  eq: (a: NumberLike, b: NumberLike): Expr => ({ kind: 'compare', op: '=', a: num(a), b: num(b) }),
  ne: (a: NumberLike, b: NumberLike): Expr => ({ kind: 'compare', op: '≠', a: num(a), b: num(b) }),
  lt: (a: NumberLike, b: NumberLike): Expr => ({ kind: 'compare', op: '<', a: num(a), b: num(b) }),
  gt: (a: NumberLike, b: NumberLike): Expr => ({ kind: 'compare', op: '>', a: num(a), b: num(b) }),
  and: (a: Expr, b: Expr): Expr => ({ kind: 'and', a, b }),
  or: (a: Expr, b: Expr): Expr => ({ kind: 'or', a, b }),
  not: (a: Expr): Expr => ({ kind: 'not', a }),

  // sensors
  cropIsReady: (): Expr => ({ kind: 'cropIsReady' }),
  soilIsDry: (): Expr => ({ kind: 'soilIsDry' }),
  tileIsTilled: (): Expr => ({ kind: 'tileIsTilled' }),
  cropIs: (cropId: CropId): Expr => ({ kind: 'cropIs', cropId }),
  bagIsFull: (): Expr => ({ kind: 'bagIsFull' }),
  bagHas: (itemId: ItemId): Expr => ({ kind: 'bagHas', itemId }),
  atEdgeOf: (zone: ZoneId): Expr => ({ kind: 'atEdgeOf', zone }),
  tokensBelow: (n: NumberLike): Expr => ({ kind: 'tokensBelow', n: num(n) }),
  tileAheadIs: (what: 'water' | 'blocked' | 'clear'): Expr => ({ kind: 'tileAheadIs', what }),
  itIsRaining: (): Expr => ({ kind: 'itIsRaining' }),
  timeIsAfter: (minute: number): Expr => ({ kind: 'timeIsAfter', minute }),

  // variable declarations
  numVar: (name: string, value: number): VarDecl => ({ name, type: 'number', initial: { kind: 'num', value } }),
  textVar: (name: string, value: string): VarDecl => ({ name, type: 'text', initial: { kind: 'text', value } }),
  yesVar: (name: string, value: boolean): VarDecl => ({ name, type: 'yesNo', initial: { kind: 'yes', value } }),
  itemVar: (name: string, itemId: ItemId): VarDecl => ({ name, type: 'item', initial: { kind: 'item', itemId } }),
  tileVar: (name: string, tx: number, tz: number): VarDecl => ({ name, type: 'tile', initial: { kind: 'tile', tx, tz } }),
};
```

- [ ] **Step 5: Create `src/robots/check.ts`**

The checker imports `isValidRobotAction` from `src/state/robotValidation.ts`; in Task 3 that module imports `checkProgram` back. The cycle is safe because both modules only use each other's function declarations at call time, never at module load.

```ts
/**
 * The checker (farmclaws part 2 spec §4). Pure. It is the only gate for programs and .MDs:
 * addRobot, the dev hooks and save validation all call it. A block program it accepts can't
 * hit a type error while it runs. Each problem is one short sentence a player can read.
 */
import { ROBOTS, TIME } from '../config';
import {
  ZONE_IDS,
  type BlockProgram,
  type Expr,
  type MdCard,
  type Robot,
  type RobotProgram,
  type RobotSize,
  type Statement,
  type Trigger,
  type ValueType,
  type VarDecl,
  type ZoneRect,
} from '../core/types';
import { isValidRobotAction } from '../state/robotValidation';
import { blockCount, childLists, exprChildren, farmContains, isLiteral, statementDepth, statementExprs } from './program';
import { batteryFor, hasPart } from './stats';

const SIZE_NAMES: Readonly<Record<RobotSize, string>> = { mini: 'Mini', standard: 'Standard', big: 'Big' };
const TYPE_PHRASES: Readonly<Record<ValueType, string>> = { number: 'a number', text: 'text', yesNo: 'a yes or no', item: 'an item', tile: 'a tile' };
const SENSOR_EYE_SENSORS: Readonly<Partial<Record<Expr['kind'], string>>> = {
  tileAheadIs: 'Tile ahead is',
  itIsRaining: 'It is raining',
  timeIsAfter: 'Time is after',
};

const SCRIPT_INVALID = 'That program is not a valid script.';
const STACK_COUNT = `A program needs 1 to ${ROBOTS.maxStacks} trigger stacks.`;
const VAR_NAME = `Variable names are 1 to ${ROBOTS.maxIdentifierLength} characters, with no spaces at either end.`;
const HELPER_NAME = `Helper names are 1 to ${ROBOTS.maxIdentifierLength} characters, with no spaces at either end.`;
const NUMBER_RANGE = `Numbers must be whole and within ±${ROBOTS.maxNumber}.`;
const TEXT_LENGTH = `Text holds at most ${ROBOTS.maxTextLength} characters.`;
const SAY_EMPTY = 'Say needs something to say.';
const SAY_LENGTH = `Say can say at most ${ROBOTS.sayMaxLength} characters.`;
const OUTSIDE_DAY = "That time is outside the robot's day.";
const EVERY_CHOICE = `Every can only be ${ROBOTS.everyChoices.join(', ')} minutes.`;
const ARITH = '+, - and × need two numbers.';
const COMPARE_ORDER = '< and > need two numbers.';
const COMPARE_SAME = '= and ≠ need two values of the same type.';
const AND_OR = 'And and Or need two yes-or-no values.';
const NOT = 'Not needs a yes-or-no value.';
const TOKENS_BELOW = 'Tokens below needs a number.';
const REPEAT = 'Repeat needs a number.';
const REPEAT_UNTIL = 'Repeat until needs a yes or no.';
const IF = 'If needs a yes or no.';
const GO_TO = 'Go to needs a tile.';
const TAKE = 'Take needs an item.';
const SAY = 'Say needs text.';
const WAIT = 'Wait needs a number.';
const CHANGE_VAR = 'Change only works on number variables.';
const CHANGE_BY = 'Change needs a number.';
const MD_DUPLICATE = 'The .MD has the same card twice.';

const unknownVar = (name: string): string => `There's no variable called "${name}".`;
const unknownHelper = (name: string): string => `There's no helper called "${name}".`;
const duplicateVar = (name: string): string => `Two variables are called "${name}".`;
const duplicateHelper = (name: string): string => `Two helpers are called "${name}".`;
const selfCalling = (name: string): string => `Helper "${name}" ends up running itself.`;
const offFarm = (tx: number, tz: number): string => `Tile (${tx}, ${tz}) isn't on the farm.`;
const unknownZone = (zone: string): string => `"${zone}" isn't a zone.`;
const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`;

function isName(name: string): boolean {
  const length = Array.from(name).length;
  return name.trim() === name && length >= 1 && length <= ROBOTS.maxIdentifierLength;
}

/** A minute a robot can act in: from the start of the day up to (not including) pass-out. */
function isDayMinute(minute: number): boolean {
  return Number.isInteger(minute) && minute >= TIME.dayStartMinute && minute < TIME.passOutMinute;
}

function isZone(zone: string): boolean {
  return (ZONE_IDS as readonly string[]).includes(zone);
}

/** The first problem `check` finds in `items`, in order. */
function firstProblem<T>(items: readonly T[], check: (item: T) => string | null): string | null {
  for (const item of items) {
    const problem = check(item);
    if (problem !== null) return problem;
  }
  return null;
}

/** Every statement of a list and of the lists nested in it, depth first, in order. */
function allStatements(list: readonly Statement[]): Statement[] {
  return list.flatMap((statement) => [statement, ...childLists(statement).flatMap(allStatements)]);
}

/** Every expression node of an expression, depth first, in order. */
function allExprNodes(expr: Expr): Expr[] {
  return [expr, ...exprChildren(expr).flatMap(allExprNodes)];
}

function programStatements(program: BlockProgram): Statement[] {
  return [...program.stacks.flatMap((stack) => allStatements(stack.body)), ...program.helpers.flatMap((helper) => allStatements(helper.body))];
}

// --- 1. Shape ------------------------------------------------------------------------------

interface Names {
  readonly vars: ReadonlySet<string>;
  readonly helpers: ReadonlySet<string>;
}

function namesProblem(names: readonly string[], invalid: string, duplicate: (name: string) => string): string | null {
  const seen = new Set<string>();
  for (const name of names) {
    if (!isName(name)) return invalid;
    if (seen.has(name)) return duplicate(name);
    seen.add(name);
  }
  return null;
}

function exprShapeProblem(expr: Expr, names: Names): string | null {
  switch (expr.kind) {
    case 'num':
      return Number.isInteger(expr.value) && Math.abs(expr.value) <= ROBOTS.maxNumber ? null : NUMBER_RANGE;
    case 'text':
      return Array.from(expr.value).length <= ROBOTS.maxTextLength ? null : TEXT_LENGTH;
    case 'tile':
      return farmContains(expr.tx, expr.tz) ? null : offFarm(expr.tx, expr.tz);
    case 'var':
      return names.vars.has(expr.name) ? null : unknownVar(expr.name);
    case 'atEdgeOf':
      return isZone(expr.zone) ? null : unknownZone(expr.zone);
    case 'timeIsAfter':
      return isDayMinute(expr.minute) ? null : OUTSIDE_DAY;
    default:
      return firstProblem(exprChildren(expr), (child) => exprShapeProblem(child, names));
  }
}

/** Shape rules a statement's own fields break, before its expressions are looked at. */
function ownShapeProblem(statement: Statement, names: Names): string | null {
  switch (statement.kind) {
    case 'do': {
      const { action } = statement;
      if (action.kind !== 'say' || action.text.kind !== 'text') return null;
      const said = Array.from(action.text.value.trim()).length;
      if (said === 0) return SAY_EMPTY;
      return said > ROBOTS.sayMaxLength ? SAY_LENGTH : null;
    }
    case 'forEachTile':
      return isZone(statement.zone) ? null : unknownZone(statement.zone);
    case 'set':
    case 'change':
      return names.vars.has(statement.name) ? null : unknownVar(statement.name);
    case 'runHelper':
      return names.helpers.has(statement.name) ? null : unknownHelper(statement.name);
    default:
      return null;
  }
}

function statementShapeProblem(statement: Statement, names: Names): string | null {
  return ownShapeProblem(statement, names) ?? firstProblem(statementExprs(statement), (expr) => exprShapeProblem(expr, names));
}

function triggerShapeProblem(trigger: Trigger): string | null {
  if (trigger.kind === 'atTime') return isDayMinute(trigger.minute) ? null : OUTSIDE_DAY;
  if (trigger.kind === 'every') return (ROBOTS.everyChoices as readonly number[]).includes(trigger.minutes) ? null : EVERY_CHOICE;
  return null;
}

/** Names of the helpers a list runs, at any depth. */
function calledHelpers(list: readonly Statement[]): string[] {
  return allStatements(list).flatMap((statement) => (statement.kind === 'runHelper' ? [statement.name] : []));
}

/** The first helper (in program order) whose calls lead back to itself. */
function cycleProblem(program: BlockProgram): string | null {
  const bodies = new Map(program.helpers.map((helper) => [helper.name, helper.body] as const));
  for (const start of program.helpers) {
    const seen = new Set<string>();
    const pending = calledHelpers(start.body);
    for (let name = pending.pop(); name !== undefined; name = pending.pop()) {
      if (name === start.name) return selfCalling(start.name);
      if (seen.has(name)) continue;
      seen.add(name);
      pending.push(...calledHelpers(bodies.get(name) ?? []));
    }
  }
  return null;
}

function shapeProblem(program: BlockProgram): string | null {
  if (program.stacks.length < 1 || program.stacks.length > ROBOTS.maxStacks) return STACK_COUNT;
  const names: Names = { vars: new Set(program.vars.map((v) => v.name)), helpers: new Set(program.helpers.map((h) => h.name)) };
  return (
    namesProblem(
      program.vars.map((v) => v.name),
      VAR_NAME,
      duplicateVar,
    ) ??
    namesProblem(
      program.helpers.map((h) => h.name),
      HELPER_NAME,
      duplicateHelper,
    ) ??
    firstProblem(program.vars, (decl) => exprShapeProblem(decl.initial, names)) ??
    firstProblem(program.stacks, (stack) => triggerShapeProblem(stack.trigger)) ??
    firstProblem(programStatements(program), (statement) => statementShapeProblem(statement, names)) ??
    cycleProblem(program)
  );
}

// --- 2. Types ------------------------------------------------------------------------------

/** The type of an expression, or null when it is ill-typed or names an unknown variable. */
export function typeOf(expr: Expr, vars: readonly VarDecl[]): ValueType | null {
  switch (expr.kind) {
    case 'num':
    case 'tokensLeft':
    case 'countInBag':
      return 'number';
    case 'text':
      return 'text';
    case 'yes':
    case 'cropIsReady':
    case 'soilIsDry':
    case 'tileIsTilled':
    case 'cropIs':
    case 'bagIsFull':
    case 'bagHas':
    case 'atEdgeOf':
    case 'tileAheadIs':
    case 'itIsRaining':
    case 'timeIsAfter':
      return 'yesNo';
    case 'item':
      return 'item';
    case 'tile':
    case 'myTile':
    case 'tileAhead':
      return 'tile';
    case 'var':
      return vars.find((decl) => decl.name === expr.name)?.type ?? null;
    case 'arith':
      return typeOf(expr.a, vars) === 'number' && typeOf(expr.b, vars) === 'number' ? 'number' : null;
    case 'compare': {
      const a = typeOf(expr.a, vars);
      const b = typeOf(expr.b, vars);
      if (expr.op === '<' || expr.op === '>') return a === 'number' && b === 'number' ? 'yesNo' : null;
      return a !== null && a === b ? 'yesNo' : null;
    }
    case 'and':
    case 'or':
      return typeOf(expr.a, vars) === 'yesNo' && typeOf(expr.b, vars) === 'yesNo' ? 'yesNo' : null;
    case 'not':
      return typeOf(expr.a, vars) === 'yesNo' ? 'yesNo' : null;
    case 'tokensBelow':
      return typeOf(expr.n, vars) === 'number' ? 'yesNo' : null;
  }
}

/** The innermost operand rule an expression breaks (operands first). */
function exprTypeProblem(expr: Expr, vars: readonly VarDecl[]): string | null {
  const inner = firstProblem(exprChildren(expr), (child) => exprTypeProblem(child, vars));
  if (inner !== null || typeOf(expr, vars) !== null) return inner;
  switch (expr.kind) {
    case 'arith':
      return ARITH;
    case 'compare':
      return expr.op === '<' || expr.op === '>' ? COMPARE_ORDER : COMPARE_SAME;
    case 'and':
    case 'or':
      return AND_OR;
    case 'not':
      return NOT;
    case 'tokensBelow':
      return TOKENS_BELOW;
    default:
      return null;
  }
}

/** An expression in a socket that needs `want`: its own problems first, then the socket's. */
function socketProblem(expr: Expr, want: ValueType, vars: readonly VarDecl[], message: string): string | null {
  return exprTypeProblem(expr, vars) ?? (typeOf(expr, vars) === want ? null : message);
}

function statementTypeProblem(statement: Statement, vars: readonly VarDecl[]): string | null {
  switch (statement.kind) {
    case 'do': {
      const { action } = statement;
      if (action.kind === 'take') return socketProblem(action.item, 'item', vars, TAKE);
      if (action.kind === 'say') return socketProblem(action.text, 'text', vars, SAY);
      if (action.kind === 'wait') return socketProblem(action.minutes, 'number', vars, WAIT);
      return null;
    }
    case 'repeatTimes':
      return socketProblem(statement.times, 'number', vars, REPEAT);
    case 'repeatUntil':
      return socketProblem(statement.until, 'yesNo', vars, REPEAT_UNTIL);
    case 'if':
      return socketProblem(statement.cond, 'yesNo', vars, IF);
    case 'goTo':
      return socketProblem(statement.tile, 'tile', vars, GO_TO);
    case 'set': {
      const type = vars.find((decl) => decl.name === statement.name)?.type ?? 'number';
      return socketProblem(statement.value, type, vars, `Set "${statement.name}" needs ${TYPE_PHRASES[type]}.`);
    }
    case 'change':
      if (vars.find((decl) => decl.name === statement.name)?.type !== 'number') return CHANGE_VAR;
      return socketProblem(statement.by, 'number', vars, CHANGE_BY);
    default:
      return null;
  }
}

function declTypeProblem(decl: VarDecl, vars: readonly VarDecl[]): string | null {
  if (!isLiteral(decl.initial)) return `"${decl.name}" must start as a fixed value.`;
  return typeOf(decl.initial, vars) === decl.type ? null : `"${decl.name}" must start as ${TYPE_PHRASES[decl.type]}.`;
}

function typesProblem(program: BlockProgram): string | null {
  return (
    firstProblem(program.vars, (decl) => declTypeProblem(decl, program.vars)) ??
    firstProblem(programStatements(program), (statement) => statementTypeProblem(statement, program.vars))
  );
}

// --- 3. Parts ------------------------------------------------------------------------------

function partsProblem(program: BlockProgram, robot: Pick<Robot, 'parts'>): string | null {
  if (hasPart(robot, 'sensorEye')) return null;
  const exprs = programStatements(program).flatMap((statement) => statementExprs(statement).flatMap(allExprNodes));
  return firstProblem(exprs, (expr) => {
    const sensor = SENSOR_EYE_SENSORS[expr.kind];
    return sensor === undefined ? null : `The "${sensor}" sensor needs a sensor eye.`;
  });
}

// --- 4. Limits -----------------------------------------------------------------------------

function limitsProblem(program: BlockProgram, robot: Pick<Robot, 'size'>): string | null {
  const spec = ROBOTS.sizes[robot.size];
  const size = SIZE_NAMES[robot.size];
  const blocks = blockCount(program);
  if (blocks > spec.blocks) return `${size} robots hold ${plural(spec.blocks, 'block')}; this program has ${blocks}.`;
  if (program.vars.length > spec.vars) return `${size} robots hold ${plural(spec.vars, 'variable')}; this program has ${program.vars.length}.`;
  const depth = statementDepth(program);
  if (depth > ROBOTS.maxFrames) return `This program nests ${depth} levels deep; robots keep track of ${ROBOTS.maxFrames}.`;
  return null;
}

/**
 * Null when `program` may run on `robot`, else the first problem. Scripts follow part 1's rules
 * (1 … maxScriptSteps valid steps). Block programs are checked for shape, then types, then
 * parts, then limits (spec §4).
 */
export function checkProgram(program: RobotProgram, robot: Pick<Robot, 'size' | 'parts'>): string | null {
  if (program.kind === 'script') {
    const { steps } = program;
    return steps.length >= 1 && steps.length <= ROBOTS.maxScriptSteps && steps.every(isValidRobotAction) ? null : SCRIPT_INVALID;
  }
  return shapeProblem(program) ?? typesProblem(program) ?? partsProblem(program, robot) ?? limitsProblem(program, robot);
}

/** One string per distinct card, whatever the key order of the card objects. */
function cardKey(card: MdCard): string {
  switch (card.kind) {
    case 'dontLeave':
      return `dontLeave ${card.zone}`;
    case 'dontGoIntoWater':
      return 'dontGoIntoWater';
    case 'dontHarvest':
      return `dontHarvest ${card.cropId}`;
    case 'dontDeposit':
      return `dontDeposit ${card.itemId}`;
    case 'doReturn':
      return card.to.kind === 'tile' ? `doReturn tile ${card.to.tx} ${card.to.tz} ${card.minute}` : `doReturn generator ${card.minute}`;
    case 'doPowerDown':
      return card.when.kind === 'tokensBelow' ? `doPowerDown tokensBelow ${card.when.n}` : `doPowerDown ${card.when.kind}`;
  }
}

function cardProblem(card: MdCard, robot: Pick<Robot, 'size'>): string | null {
  switch (card.kind) {
    case 'dontLeave':
      return isZone(card.zone) ? null : unknownZone(card.zone);
    case 'doReturn':
      if (card.to.kind === 'tile' && !farmContains(card.to.tx, card.to.tz)) return offFarm(card.to.tx, card.to.tz);
      return isDayMinute(card.minute) ? null : OUTSIDE_DAY;
    case 'doPowerDown': {
      if (card.when.kind !== 'tokensBelow') return null;
      const battery = batteryFor(robot.size);
      const { n } = card.when;
      return Number.isInteger(n) && n >= 1 && n <= battery ? null : `Power down below needs a number of tokens from 1 to ${battery}.`;
    }
    default:
      return null;
  }
}

/** Null when `md` suits `robot`, else the first problem (spec §4). */
export function checkMd(md: readonly MdCard[], robot: Pick<Robot, 'size'>): string | null {
  const limit = ROBOTS.sizes[robot.size].mdCards;
  if (md.length > limit) return `${SIZE_NAMES[robot.size]} robots hold ${plural(limit, '.MD card')}; this .MD has ${md.length}.`;
  const problem = firstProblem(md, (card) => cardProblem(card, robot));
  if (problem !== null) return problem;
  return new Set(md.map(cardKey)).size === md.length ? null : MD_DUPLICATE;
}

/** Whether `rect` is a zone: whole numbers, w and d at least 1, every tile on the farm. */
export function isValidZoneRect(rect: ZoneRect): boolean {
  const { x0, z0, w, d } = rect;
  return Number.isInteger(w) && Number.isInteger(d) && w >= 1 && d >= 1 && farmContains(x0, z0) && farmContains(x0 + w - 1, z0 + d - 1);
}
```

- [ ] **Step 6: Run it and see it pass**

Run: `npx vitest run tests/robotCheck.test.ts`
Expected: PASS (76 tests).

- [ ] **Step 7: The full gate**

Run: `npm run typecheck && npm test && npm run build`
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add src/robots/program.ts src/robots/blocks.ts src/robots/check.ts tests/robotCheck.test.ts
git commit -m "Farmclaws part 2: program helpers, the block builder and the checker

checkProgram checks shape, then types, then parts, then limits, with one player-readable
sentence per rule; checkMd and isValidZoneRect cover the .MD and zones. Rulings: a time
is within the day from dayStartMinute to passOutMinute - 1; statementDepth counts the
route frame of Go to and For each tile, so an accepted program never needs more than
maxFrames frames; variable declarations count no blocks.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Robot fields and save version 5

**Files:**
- Modify: `src/core/types.ts` (`SAVE_VERSION` line 13; `Robot` after `pc` ~line 576; `RobotsState` ~line 660)
- Create: `src/robots/exec.ts`
- Modify: `src/robots/create.ts` (imports, `RobotSpec`, `specProblem`, `addRobot`)
- Modify: `src/state/initialState.ts` (`robots` in `createDefaultSections`, line 40)
- Modify: `src/state/robotValidation.ts` (header and imports, `ROBOT_KEYS`, replace `isValidRobotProgram`, `isValidRobot`, `isValidRobotsSection`)
- Modify: `src/state/persistence.ts` (`migrateV4toV5` before `migrateSave`; one line in `migrateSave`)
- Modify: `tests/testUtils.ts` (imports; `robotOf`; new `withZones` at the end)
- Modify (save-version literals and fixture fields only): `tests/persistence.test.ts` (line 159), `tests/maps.test.ts` (line 821), `tests/robotSave.test.ts` (lines 77, 81–83), `tests/sections.test.ts` (line 166)
- Test: `tests/robotSaveV5.test.ts`

**Interfaces:**
- Consumes: Task 2 `checkProgram`, `checkMd`, `isValidZoneRect` (`src/robots/check.ts`); `resolveList`, `literalValue`, `farmContains` (`src/robots/program.ts`); `b` (tests). Task 1 types and `ROBOTS.maxFrames`, `maxRepeatTimes`, `maxNumber`, `maxTextLength`.
- Produces:
  - `Robot.exec: RobotExec | null`, `Robot.md: readonly MdCard[]`, `Robot.off: null | 'dizzy' | 'done'`; `RobotsState.zones: Readonly<Record<ZoneId, ZoneRect | null>>`; `SAVE_VERSION = 5`.
  - `src/robots/exec.ts`: `export function freshExec(program: BlockProgram): RobotExec`.
  - `src/robots/create.ts`: `RobotSpec.md?: readonly MdCard[]`; `addRobot` gates with `isProgramShape` + `checkProgram` and `isMdShape` + `checkMd`, and sets `exec: program.kind === 'blocks' ? freshExec(program) : null`, `md: spec.md ?? []`, `off: null`.
  - `src/state/robotValidation.ts`: `export function isProgramShape(v: unknown): v is RobotProgram`; `export function isMdShape(v: unknown): v is readonly MdCard[]`; `export function isValidExec(v: unknown, program: BlockProgram): v is RobotExec`; `isValidRobotsSection(v, maps, player)` (same signature) now validates `exec`, `md`, `off` and `zones`. `isValidRobotProgram` is removed: `isProgramShape` + `checkProgram` replace it everywhere.
  - `src/state/persistence.ts`: `migrateV4toV5` chained in `migrateSave`.
  - `tests/testUtils.ts`: `robotOf` gains `exec: null, md: [], off: null`; `export function withZones(state: GameState, zones: Partial<Record<ZoneId, ZoneRect | null>>): GameState`.

Validation rules (spec §10.2 with R1 and R4), all in `isValidRobot` / `isValidExec`:
- The program is shaped (`isProgramShape`) and passes `checkProgram` for the robot's size and parts; the .MD is shaped (`isMdShape`) and passes `checkMd`.
- Scripts: `exec` is null and `pc` is a step index. Block programs: `pc` is 0 and `exec` is valid.
- `vars`: one per declaration, each of the declared type; numbers whole within ±`maxNumber`, text within `maxTextLength`, items known, tiles on the farm (R4).
- `due`: one per stack; null, or the `atTime` minute itself, or for `every n` a whole minute in `dayStartMinute` … `passOutMinute + n`; other triggers always null. `firedToday`: one boolean per stack.
- `running` is null or a stack index. With `running` null, `frames` is empty or exactly one `doReturn` route frame (R1); with a stack running, `frames` is non-empty and holds no `doReturn` route frame.
- Every list frame's `ListRef` resolves and `next` is 0 … the list's length. A list reached through a `'body'` branch has the loop state of that loop statement (`times` ↔ Repeat times with `left` 0 … `maxRepeatTimes`, `until`, `forever`, `forEach` ↔ For each tile with farm `tiles` and `i` 0 … `tiles.length − 1`); any other list has `loop: null`.
- Route frames: farm target, farm path tiles, a known `why`. At most `maxFrames` frames.
- `doneCards`: whole, no repeats, each the index of a DO card (`doReturn` / `doPowerDown`) of the robot's .MD.
- `off` is null, `'dizzy'` or `'done'`, and non-null only for `working` or `standby` robots.
- `zones`: exactly the ids A–H, each null or a rect passing `isValidZoneRect`.

- [ ] **Step 1: Write the failing test `tests/robotSaveV5.test.ts`**

```ts
/**
 * Save version 5 (farmclaws part 2 spec §10): robots gain exec, md and off, the robots section
 * gains zones; the v4 → v5 migration; round trips of block-program robots in every exec shape
 * the interpreter makes; one corrupted field per validation rule; addRobot with block programs.
 */
import { describe, expect, it } from 'vitest';
import { ROBOTS, TIME } from '../src/config';
import { ZONE_IDS, type BlockProgram, type Frame, type GameState, type MdCard, type Robot, type RobotExec } from '../src/core/types';
import { b } from '../src/robots/blocks';
import { addRobot } from '../src/robots/create';
import { freshExec } from '../src/robots/exec';
import { requireRobot } from '../src/robots/world';
import { deserializeGame, migrateSave, serializeGame } from '../src/state/persistence';
import { isValidExec } from '../src/state/robotValidation';
import saveV2Text from './fixtures/save-v2.json?raw';
import { BASE, must, robotOf, withRobots, withZones, type SaveJson } from './testUtils';

/** A Standard waterer and harvester: four stacks, a helper, two variables. 21 blocks. */
const PROGRAM: BlockProgram = b.program({
  vars: [b.numVar('rows', 3), b.tileVar('home', 5, 10)],
  stacks: [
    b.when(b.morning(), b.repeat(4, b.water(), b.move()), b.forEach('A', b.water()), b.run('turnAround')),
    b.when(b.every(5), b.goTo(b.v('home')), b.say('Home')),
    b.when(b.atTime(720), b.if(b.bagIsFull(), [b.deposit()], [b.harvest()])),
    b.when(b.bagFull(), b.deposit()),
  ],
  helpers: [b.helper('turnAround', b.turn('right'), b.turn('right'))],
});

const MD: readonly MdCard[] = [
  { kind: 'dontLeave', zone: 'A' },
  { kind: 'doReturn', to: { kind: 'generator' }, minute: 1080 },
  { kind: 'doPowerDown', when: { kind: 'tokensBelow', n: 10 } },
];

const ZONE_A = { x0: 3, z0: 9, w: 4, d: 3 };
const SNAKE_A = [
  { tx: 3, tz: 9 },
  { tx: 4, tz: 9 },
  { tx: 5, tz: 9 },
  { tx: 6, tz: 9 },
];

const stackFrame = (index: number, next: number): Frame => ({ kind: 'list', list: { root: 'stack', index, path: [] }, next, loop: null });
const running = (index: number, frames: Frame[]): RobotExec => ({ ...freshExec(PROGRAM), running: index, frames });

/** The exec shapes the interpreter makes, one robot each. */
const EXECS = {
  idleWithEveryDue: freshExec(PROGRAM),
  midRepeat: running(0, [stackFrame(0, 1), { kind: 'list', list: { root: 'stack', index: 0, path: [[0, 'body']] }, next: 1, loop: { kind: 'times', left: 3 } }]),
  midForEach: running(0, [
    stackFrame(0, 2),
    { kind: 'list', list: { root: 'stack', index: 0, path: [[1, 'body']] }, next: 0, loop: { kind: 'forEach', tiles: SNAKE_A, i: 2 } },
    { kind: 'route', target: { tx: 5, tz: 9 }, path: [{ tx: 5, tz: 10 }, { tx: 5, tz: 9 }], why: 'forEach' },
  ]),
  midHelper: running(0, [stackFrame(0, 3), { kind: 'list', list: { root: 'helper', index: 0, path: [] }, next: 1, loop: null }]),
  midRoute: running(1, [stackFrame(1, 1), { kind: 'route', target: { tx: 5, tz: 10 }, path: [], why: 'goTo' }]),
  inElse: running(2, [stackFrame(2, 1), { kind: 'list', list: { root: 'stack', index: 2, path: [[0, 'else']] }, next: 0, loop: null }]),
  doReturn: {
    ...freshExec(PROGRAM),
    due: [null, 905, 720, null],
    firedToday: [false, false, false, true],
    frames: [{ kind: 'route', target: { tx: 9, tz: 13 }, path: [{ tx: 7, tz: 13 }], why: 'doReturn' }],
  },
  done: { ...freshExec(PROGRAM), due: [null, TIME.passOutMinute + 4, null, null], doneCards: [1] },
} satisfies Record<string, RobotExec>;

/** One block robot per exec shape (ids 1 … 8 on row tz 11), dizzy and done robots among them, and a script robot (id 9). */
function lively(): GameState {
  const shapes = Object.values(EXECS);
  const robots: Robot[] = shapes.map((exec, i) =>
    robotOf({ id: i + 1, name: `R${i + 1}`, size: 'standard', parts: ['claw', 'wateringHead'], tank: 20, tx: 2 + i, tz: 11, program: PROGRAM, exec, md: MD }),
  );
  const at = (id: number, overrides: Partial<Robot>) => robots.map((r) => (r.id === id ? { ...r, ...overrides } : r));
  let list = at(1, { power: 'standby' });
  list = list.map((r) => (r.id === 2 ? { ...r, off: 'dizzy' as const } : r));
  list = list.map((r) => (r.id === 8 ? { ...r, power: 'standby' as const, off: 'done' as const } : r));
  list = [...list, robotOf({ id: 9, name: 'Scripty', tx: 2, tz: 12 })];
  return withZones(withRobots(BASE, list), { A: ZONE_A, C: { x0: 0, z0: 0, w: 48, d: 40 } });
}

const loadedFrom = (state: GameState): GameState => ({ ...state, ui: { ...state.ui, panel: { kind: 'none' }, paused: false } });

/** Serialises `state`, lets `edit` change the parsed JSON, and loads it again. */
function corrupt(state: GameState, edit: (save: SaveJson) => void): GameState | null {
  const save = JSON.parse(serializeGame(state)) as SaveJson;
  edit(save);
  return deserializeGame(JSON.stringify(save));
}

type RobotJson = SaveJson & { program: SaveJson; exec: SaveJson & { frames: SaveJson[]; vars: SaveJson[]; due: unknown[]; firedToday: unknown[]; doneCards: unknown[] }; md: SaveJson[] };
const robotsOf = (save: SaveJson) => save.robots as SaveJson & { list: RobotJson[]; zones: SaveJson };
/** The saved robot with `id` (ids are 1-based and contiguous in lively()). */
const robot = (save: SaveJson, id: number): RobotJson => must(robotsOf(save).list[id - 1]);
const frame = (save: SaveJson, id: number, index: number): SaveJson => must(robot(save, id).exec.frames[index]);

describe('save version 5', () => {
  it('starts a new game with every zone empty', () => {
    expect(BASE.robots.zones).toEqual({ A: null, B: null, C: null, D: null, E: null, F: null, G: null, H: null });
  });

  it('builds a fresh exec from the program', () => {
    expect(EXECS.idleWithEveryDue).toEqual({
      running: null,
      frames: [],
      vars: [
        { type: 'number', value: 3 },
        { type: 'tile', value: { tx: 5, tz: 10 } },
      ],
      due: [null, TIME.dayStartMinute + 5, 720, null],
      firedToday: [false, false, false, false],
      doneCards: [],
    });
  });

  it('round-trips block robots in every exec shape, with zones', () => {
    const state = lively();
    for (const exec of Object.values(EXECS)) expect(isValidExec(exec, PROGRAM)).toBe(true);
    expect(deserializeGame(serializeGame(state))).toEqual(loadedFrom(state));
  });

  it('migrates a version-4 save: robots gain exec, md and off, and every zone is empty', () => {
    const state = withRobots(BASE, [robotOf({ id: 1 }), robotOf({ id: 2, name: 'Bolt', power: 'standby', tx: 4, tz: 10 })]);
    const save = JSON.parse(serializeGame(state)) as SaveJson;
    for (const r of robotsOf(save).list as SaveJson[]) {
      delete r.exec;
      delete r.md;
      delete r.off;
    }
    delete (save.robots as SaveJson).zones;
    save.version = 4;
    const migrated = migrateSave(save) as SaveJson;
    expect(migrated.version).toBe(5);
    expect(robotsOf(migrated).list.map((r) => [r.exec, r.md, r.off])).toEqual([
      [null, [], null],
      [null, [], null],
    ]);
    expect(robotsOf(migrated).zones).toEqual(Object.fromEntries(ZONE_IDS.map((id) => [id, null])));
    expect(must(deserializeGame(JSON.stringify(save)))).toEqual(state);
  });

  it('migrates the version-2 fixture through three steps to 5', () => {
    const loaded = must(deserializeGame(saveV2Text));
    expect(loaded.version).toBe(5);
    expect(loaded.robots.list).toEqual([]);
    expect(loaded.robots.zones).toEqual(BASE.robots.zones);
  });

  const rejections: readonly [string, (save: SaveJson) => void][] = [
    ['too few variable values', (s) => void robot(s, 1).exec.vars.pop()],
    ['a variable value of the wrong type', (s) => void (robot(s, 1).exec.vars[0] = { type: 'text', value: '3' })],
    ['a number variable beyond maxNumber', (s) => void (robot(s, 1).exec.vars[0] = { type: 'number', value: ROBOTS.maxNumber + 1 })],
    ['a tile variable off the farm', (s) => void (robot(s, 1).exec.vars[1] = { type: 'tile', value: { tx: 48, tz: 0 } })],
    ['a due list shorter than the stacks', (s) => void robot(s, 1).exec.due.pop()],
    ['a firedToday list shorter than the stacks', (s) => void robot(s, 1).exec.firedToday.pop()],
    ['a due minute on a bagFull stack', (s) => void (robot(s, 1).exec.due[3] = 700)],
    ['an atTime due that is not its own minute', (s) => void (robot(s, 1).exec.due[2] = 721)],
    ['running past the last stack', (s) => void (robot(s, 2).exec.running = 4)],
    ['frames while nothing runs', (s) => void (robot(s, 2).exec.running = null)],
    ['nothing in frames while a stack runs', (s) => void (robot(s, 2).exec.frames = [])],
    ['a list that does not resolve', (s) => void ((frame(s, 2, 1).list as SaveJson).path = [[0, 'then']])],
    ['a helper index past the helpers', (s) => void ((frame(s, 4, 1).list as SaveJson).index = 1)],
    ['next beyond the list length', (s) => void (frame(s, 2, 1).next = 3)],
    ['a loop state on a plain list', (s) => void (frame(s, 6, 1).loop = { kind: 'forever' })],
    ['a loop body without a loop state', (s) => void (frame(s, 2, 1).loop = null)],
    ['a loop state of the wrong kind', (s) => void (frame(s, 2, 1).loop = { kind: 'until' })],
    ['times.left beyond maxRepeatTimes', (s) => void (frame(s, 2, 1).loop = { kind: 'times', left: ROBOTS.maxRepeatTimes + 1 })],
    ['a For each tile off the farm', (s) => void (((frame(s, 3, 1).loop as SaveJson).tiles as SaveJson[])[0] = { tx: 48, tz: 9 })],
    ['a For each index out of range', (s) => void ((frame(s, 3, 1).loop as SaveJson).i = 4)],
    ['a route path tile off the farm', (s) => void ((frame(s, 3, 2).path as SaveJson[])[0] = { tx: -1, tz: 9 })],
    ['a route target off the farm', (s) => void (frame(s, 5, 1).target = { tx: 0, tz: 40 })],
    ['a route with an unknown reason', (s) => void (frame(s, 5, 1).why = 'lost')],
    ['a DO-return route while a stack runs', (s) => void (frame(s, 5, 1).why = 'doReturn')],
    ['a second frame during a DO return', (s) => void robot(s, 7).exec.frames.unshift({ kind: 'route', target: { tx: 9, tz: 13 }, path: [], why: 'doReturn' })],
    ['more frames than maxFrames', (s) => void (robot(s, 2).exec.frames = Array.from({ length: ROBOTS.maxFrames + 1 }, () => ({ kind: 'list', list: { root: 'stack', index: 0, path: [] }, next: 1, loop: null })))],
    ['a repeated done card', (s) => void (robot(s, 8).exec.doneCards = [1, 1])],
    ['a done card that is a DON\'T', (s) => void (robot(s, 8).exec.doneCards = [0])],
    ['a done card past the .MD', (s) => void (robot(s, 8).exec.doneCards = [3])],
    ['a zone off the farm', (s) => void (robotsOf(s).zones.A = { x0: 45, z0: 0, w: 4, d: 1 })],
    ['a zone of width 0', (s) => void (robotsOf(s).zones.A = { x0: 3, z0: 9, w: 0, d: 3 })],
    ['an unknown zone id', (s) => void (robotsOf(s).zones.I = null)],
    ['a missing zone id', (s) => void delete robotsOf(s).zones.H],
    ['an off flag on a flat robot', (s) => void Object.assign(robot(s, 2), { power: 'flat', tokens: 0 })],
    ['an unknown off reason', (s) => void (robot(s, 1).off = 'sleepy')],
    ['a program that fails the checker', (s) => void (((robot(s, 1).program.stacks as SaveJson[])[1]!.body as SaveJson[])[1] = { kind: 'do', action: { kind: 'say', text: { kind: 'text', value: '   ' } } })],
    ['a program with an unknown statement', (s) => void ((robot(s, 1).program.helpers as SaveJson[])[0]!.body = [{ kind: 'dance' }])],
    ['an .MD that fails the checker', (s) => void (robot(s, 1).md[2] = { kind: 'doPowerDown', when: { kind: 'tokensBelow', n: 0 } })],
    ['an .MD card of an unknown kind', (s) => void (robot(s, 1).md[0] = { kind: 'dontDance' })],
    ['a script robot with an exec', (s) => void (robot(s, 9).exec = robot(s, 1).exec)],
    ['a block robot without an exec', (s) => void (robot(s, 1).exec = null as never)],
    ['a block robot with pc 1', (s) => void (robot(s, 1).pc = 1)],
  ];

  it.each(rejections)('rejects %s', (_label, edit) => {
    expect(corrupt(lively(), edit)).toBeNull();
  });
});

describe('addRobot with block programs', () => {
  const place = { tx: 5, tz: 11, facing: 2 as const };

  it('starts a block robot idle on a fresh exec, with its .MD', () => {
    const result = addRobot(BASE, { name: 'Drizzle', size: 'standard', parts: ['claw', 'wateringHead'], place, program: PROGRAM, md: MD });
    if ('error' in result) throw new Error(result.error);
    const added = requireRobot(result.state, result.id);
    expect([added.exec, added.md, added.off, added.pc, added.power]).toEqual([freshExec(PROGRAM), MD, null, 0, 'working']);
    expect(deserializeGame(serializeGame(result.state))).toEqual(loadedFrom(result.state));
  });

  it('gives a script robot no exec and an empty .MD', () => {
    const result = addRobot(BASE, { name: 'Scripty', size: 'mini', parts: ['claw'], place, program: { kind: 'script', steps: [{ kind: 'move' }], loop: true } });
    if ('error' in result) throw new Error(result.error);
    expect(requireRobot(result.state, result.id)).toMatchObject({ exec: null, md: [], off: null });
  });

  it("returns the checker's message for a program or .MD it refuses", () => {
    const tooBig = b.program({ stacks: [b.when(b.morning(), ...Array.from({ length: 12 }, () => b.move()))] });
    expect(addRobot(BASE, { name: 'Bulky', size: 'mini', parts: [], place, program: tooBig })).toEqual({ error: 'Mini robots hold 12 blocks; this program has 13.' });
    const md: MdCard[] = [{ kind: 'dontGoIntoWater' }, { kind: 'dontGoIntoWater' }];
    const small = b.program({ stacks: [b.when(b.morning(), b.move())] });
    expect(addRobot(BASE, { name: 'Twice', size: 'mini', parts: [], place, program: small, md })).toEqual({ error: 'The .MD has the same card twice.' });
  });

  it('refuses shapes that are not programs or .MDs without throwing', () => {
    const spec = { name: 'Odd', size: 'mini' as const, parts: [], place };
    expect(addRobot(BASE, { ...spec, program: { kind: 'blocks', stacks: [] } as never })).toEqual({ error: 'That program is not a script or a block program.' });
    expect(addRobot(BASE, { ...spec, program: b.program({ stacks: [b.when(b.morning(), b.move())] }), md: [{ kind: 'dontDance' }] as never })).toEqual({ error: 'That .MD is not a list of cards.' });
  });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run tests/robotSaveV5.test.ts`
Expected: FAIL — `Failed to resolve import "../src/robots/exec"`.

- [ ] **Step 3: Robot and robots-section fields in `src/core/types.ts`**

Replace `export const SAVE_VERSION = 4 as const;` with `export const SAVE_VERSION = 5 as const;`.

In `interface Robot`, replace:

```ts
  readonly program: RobotProgram;
  /** Index of the next script step. */
  readonly pc: number;
```

with:

```ts
  readonly program: RobotProgram;
  /** Index of the next script step; always 0 for a block program. */
  readonly pc: number;
  /** Where a block program is; null for scripts. */
  readonly exec: RobotExec | null;
  /** The Managing Directive: 0 … ROBOTS.sizes[size].mdCards cards. */
  readonly md: readonly MdCard[];
  /** Why the robot ignores everything until morning. Separate from `power` (farmclaws design §5.4). Part 3 adds 'player'. */
  readonly off: null | 'dizzy' | 'done';
```

In `interface RobotsState`, after `lastNightFuel`, add:

```ts
  /** Named farm rectangles for programs and .MDs; null is an empty zone. */
  readonly zones: Readonly<Record<ZoneId, ZoneRect | null>>;
```

- [ ] **Step 4: Create `src/robots/exec.ts`**

```ts
/**
 * Building a block program's interpreter state (farmclaws part 2 spec §2.4, §7). Pure.
 */
import { TIME } from '../config';
import type { BlockProgram, RobotExec, Trigger } from '../core/types';
import { literalValue } from './program';

/** The first minute a trigger may fire in a fresh day: its time, the first `every` check, or null for the others. */
function firstDue(trigger: Trigger): number | null {
  if (trigger.kind === 'atTime') return trigger.minute;
  if (trigger.kind === 'every') return TIME.dayStartMinute + trigger.minutes;
  return null;
}

/**
 * An idle exec for a checked program at the start of a day: nothing running, every variable at
 * its initial value, every trigger's day unspent and no DO card done.
 */
export function freshExec(program: BlockProgram): RobotExec {
  return {
    running: null,
    frames: [],
    vars: program.vars.map((decl) => literalValue(decl.initial)),
    due: program.stacks.map((stack) => firstDue(stack.trigger)),
    firedToday: program.stacks.map(() => false),
    doneCards: [],
  };
}
```

- [ ] **Step 5: Validation in `src/state/robotValidation.ts`**

**5a.** Replace the file header and imports (everything above `const MAX = Number.MAX_SAFE_INTEGER;`) with:

```ts
/**
 * Save validation for the robots section (farmclaws part 1 spec §6.2, part 2 spec §10.2).
 * Every check is a type guard that returns false on any unexpected shape and never throws.
 */
import { ROBOTS, TIME } from '../config';
import {
  Blocker,
  CROP_IDS,
  EVERY_CHOICES,
  MAP_IDS,
  QUALITIES,
  ROBOT_BLOCK_REASONS,
  ROBOT_LOG_EVENT_KINDS,
  ROBOT_PART_IDS,
  ROBOT_POWERS,
  ROBOT_SIZES,
  VALUE_TYPES,
  ZONE_IDS,
  type BlockProgram,
  type Frame,
  type GameState,
  type ListRef,
  type MdCard,
  type Robot,
  type RobotAction,
  type RobotExec,
  type RobotPartId,
  type RobotProgram,
  type TileCoord,
  type Trigger,
  type ValueType,
  type WorldState,
} from '../core/types';
import { isItemId } from '../items/items';
import { checkMd, checkProgram, isValidZoneRect } from '../robots/check';
import { ROBOT_ACTION_KINDS } from '../robots/parts';
import { farmContains, resolveList } from '../robots/program';
import { bagStacks, batteryFor } from '../robots/stats';
import { inBounds } from '../world/grid';
import { forEachTile, getTile, isWalkable } from '../world/tiles';
import { isValidName } from './sectionValidation';
import { hasExactKeys, isBool, isCanonicalSubset, isCount, isInt, isIntIn, isObj, isOneOf, isValidStack, type Obj } from './validation';
```

**5b.** Replace `ROBOT_KEYS`:

```ts
const ROBOT_KEYS = [
  'id', 'name', 'size', 'parts', 'tx', 'tz', 'facing', 'bag', 'tank', 'tokens', 'power', 'carried', 'program', 'pc',
  'exec', 'md', 'off', 'nextActMinute', 'repairReadyDay', 'tokensToday', 'moveSeq', 'teleportSeq', 'actionSeq', 'lastAction',
] as const;
```

**5c.** Delete the whole `isValidRobotProgram` function (with its doc comment from Task 1) and put this block in its place, between `isValidRobotAction` and `isValidDetail`:

```ts
// --- Block programs, .MDs and exec (farmclaws part 2 spec §10.2) ---------------------------

const isString = (v: unknown): v is string => typeof v === 'string';
const isNumber = (v: unknown): v is number => typeof v === 'number';
const isList = (v: unknown): v is readonly unknown[] => Array.isArray(v);

function isFarmTile(v: unknown): v is TileCoord {
  return isObj(v) && hasExactKeys(v, ['tx', 'tz']) && isInt(v.tx) && isInt(v.tz) && farmContains(v.tx, v.tz);
}

/** The shape of one expression: a known kind with exactly its fields, each of the right JSON type. Ranges are checkProgram's job. */
function isExprShape(v: unknown): boolean {
  if (!isObj(v) || !isString(v.kind)) return false;
  switch (v.kind) {
    case 'num':
      return hasExactKeys(v, ['kind', 'value']) && isNumber(v.value);
    case 'text':
      return hasExactKeys(v, ['kind', 'value']) && isString(v.value);
    case 'yes':
      return hasExactKeys(v, ['kind', 'value']) && isBool(v.value);
    case 'item':
    case 'countInBag':
    case 'bagHas':
      return hasExactKeys(v, ['kind', 'itemId']) && isItemId(v.itemId);
    case 'tile':
      return hasExactKeys(v, ['kind', 'tx', 'tz']) && isNumber(v.tx) && isNumber(v.tz);
    case 'var':
      return hasExactKeys(v, ['kind', 'name']) && isString(v.name);
    case 'myTile':
    case 'tileAhead':
    case 'tokensLeft':
    case 'cropIsReady':
    case 'soilIsDry':
    case 'tileIsTilled':
    case 'bagIsFull':
    case 'itIsRaining':
      return hasExactKeys(v, ['kind']);
    case 'arith':
      return hasExactKeys(v, ['kind', 'op', 'a', 'b']) && isOneOf(v.op, ['+', '-', '×']) && isExprShape(v.a) && isExprShape(v.b);
    case 'compare':
      return hasExactKeys(v, ['kind', 'op', 'a', 'b']) && isOneOf(v.op, ['=', '≠', '<', '>']) && isExprShape(v.a) && isExprShape(v.b);
    case 'and':
    case 'or':
      return hasExactKeys(v, ['kind', 'a', 'b']) && isExprShape(v.a) && isExprShape(v.b);
    case 'not':
      return hasExactKeys(v, ['kind', 'a']) && isExprShape(v.a);
    case 'cropIs':
      return hasExactKeys(v, ['kind', 'cropId']) && isOneOf(v.cropId, CROP_IDS);
    case 'atEdgeOf':
      return hasExactKeys(v, ['kind', 'zone']) && isOneOf(v.zone, ZONE_IDS);
    case 'tokensBelow':
      return hasExactKeys(v, ['kind', 'n']) && isExprShape(v.n);
    case 'tileAheadIs':
      return hasExactKeys(v, ['kind', 'what']) && isOneOf(v.what, ['water', 'blocked', 'clear']);
    case 'timeIsAfter':
      return hasExactKeys(v, ['kind', 'minute']) && isNumber(v.minute);
    default:
      return false;
  }
}

function isActionBlockShape(v: unknown): boolean {
  if (!isObj(v) || !isString(v.kind)) return false;
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
      return hasExactKeys(v, ['kind', 'item']) && isExprShape(v.item);
    case 'say':
      return hasExactKeys(v, ['kind', 'text']) && isExprShape(v.text);
    case 'wait':
      return hasExactKeys(v, ['kind', 'minutes']) && isExprShape(v.minutes);
    default:
      return false;
  }
}

function isStatementListShape(v: unknown): boolean {
  return isList(v) && v.every(isStatementShape);
}

function isStatementShape(v: unknown): boolean {
  if (!isObj(v) || !isString(v.kind)) return false;
  switch (v.kind) {
    case 'do':
      return hasExactKeys(v, ['kind', 'action']) && isActionBlockShape(v.action);
    case 'repeatTimes':
      return hasExactKeys(v, ['kind', 'times', 'body']) && isExprShape(v.times) && isStatementListShape(v.body);
    case 'repeatUntil':
      return hasExactKeys(v, ['kind', 'until', 'body']) && isExprShape(v.until) && isStatementListShape(v.body);
    case 'repeatForever':
      return hasExactKeys(v, ['kind', 'body']) && isStatementListShape(v.body);
    case 'if':
      return (
        hasExactKeys(v, ['kind', 'cond', 'then', 'else']) &&
        isExprShape(v.cond) &&
        isStatementListShape(v.then) &&
        (v.else === null || isStatementListShape(v.else))
      );
    case 'forEachTile':
      return hasExactKeys(v, ['kind', 'zone', 'body']) && isOneOf(v.zone, ZONE_IDS) && isStatementListShape(v.body);
    case 'goTo':
      return hasExactKeys(v, ['kind', 'tile']) && isExprShape(v.tile);
    case 'set':
      return hasExactKeys(v, ['kind', 'name', 'value']) && isString(v.name) && isExprShape(v.value);
    case 'change':
      return hasExactKeys(v, ['kind', 'name', 'by']) && isString(v.name) && isExprShape(v.by);
    case 'runHelper':
      return hasExactKeys(v, ['kind', 'name']) && isString(v.name);
    default:
      return false;
  }
}

function isTriggerShape(v: unknown): boolean {
  if (!isObj(v) || !isString(v.kind)) return false;
  switch (v.kind) {
    case 'morning':
    case 'bagFull':
    case 'startsRaining':
      return hasExactKeys(v, ['kind']);
    case 'atTime':
      return hasExactKeys(v, ['kind', 'minute']) && isNumber(v.minute);
    case 'every':
      return hasExactKeys(v, ['kind', 'minutes']) && isOneOf(v.minutes, EVERY_CHOICES);
    default:
      return false;
  }
}

function isBlockProgramShape(v: Obj): boolean {
  return (
    hasExactKeys(v, ['kind', 'vars', 'stacks', 'helpers']) &&
    isList(v.vars) &&
    v.vars.every(
      (d) => isObj(d) && hasExactKeys(d, ['name', 'type', 'initial']) && isString(d.name) && isOneOf(d.type, VALUE_TYPES) && isExprShape(d.initial),
    ) &&
    isList(v.stacks) &&
    v.stacks.every((s) => isObj(s) && hasExactKeys(s, ['trigger', 'body']) && isTriggerShape(s.trigger) && isStatementListShape(s.body)) &&
    isList(v.helpers) &&
    v.helpers.every((h) => isObj(h) && hasExactKeys(h, ['name', 'body']) && isString(h.name) && isStatementListShape(h.body))
  );
}

/**
 * Whether `v` is shaped like a program, so checkProgram can read it: a script (its steps an
 * array; checkProgram checks each step) or a block program whose every node has a known kind
 * and exactly its fields. Never throws: input nested too deeply (or cyclic, from the console)
 * is rejected.
 */
export function isProgramShape(v: unknown): v is RobotProgram {
  try {
    if (!isObj(v)) return false;
    if (v.kind === 'script') return hasExactKeys(v, ['kind', 'steps', 'loop']) && isList(v.steps) && isBool(v.loop);
    return v.kind === 'blocks' && isBlockProgramShape(v);
  } catch {
    return false;
  }
}

function isMdCardShape(v: unknown): boolean {
  if (!isObj(v) || !isString(v.kind)) return false;
  switch (v.kind) {
    case 'dontLeave':
      return hasExactKeys(v, ['kind', 'zone']) && isOneOf(v.zone, ZONE_IDS);
    case 'dontGoIntoWater':
      return hasExactKeys(v, ['kind']);
    case 'dontHarvest':
      return hasExactKeys(v, ['kind', 'cropId']) && isOneOf(v.cropId, CROP_IDS);
    case 'dontDeposit':
      return hasExactKeys(v, ['kind', 'itemId']) && isItemId(v.itemId);
    case 'doReturn': {
      const to = v.to;
      const toShape =
        isObj(to) &&
        ((to.kind === 'generator' && hasExactKeys(to, ['kind'])) || (to.kind === 'tile' && hasExactKeys(to, ['kind', 'tx', 'tz']) && isNumber(to.tx) && isNumber(to.tz)));
      return hasExactKeys(v, ['kind', 'to', 'minute']) && toShape && isNumber(v.minute);
    }
    case 'doPowerDown': {
      const when = v.when;
      const whenShape =
        isObj(when) &&
        (((when.kind === 'bagFull' || when.kind === 'raining') && hasExactKeys(when, ['kind'])) ||
          (when.kind === 'tokensBelow' && hasExactKeys(when, ['kind', 'n']) && isNumber(when.n)));
      return hasExactKeys(v, ['kind', 'when']) && whenShape;
    }
    default:
      return false;
  }
}

/** Whether `v` is a list of .MD cards, each a known kind with exactly its fields. Ranges are checkMd's job. */
export function isMdShape(v: unknown): v is readonly MdCard[] {
  return isList(v) && v.every(isMdCardShape);
}

/** A value of `type`: a whole number within ±maxNumber, text within maxTextLength, a yes/no, a known item or a farm tile. */
function isValueOf(v: unknown, type: ValueType): boolean {
  if (!isObj(v) || !hasExactKeys(v, ['type', 'value']) || v.type !== type) return false;
  switch (type) {
    case 'number':
      return isIntIn(v.value, -ROBOTS.maxNumber, ROBOTS.maxNumber);
    case 'text':
      return isString(v.value) && Array.from(v.value).length <= ROBOTS.maxTextLength;
    case 'yesNo':
      return isBool(v.value);
    case 'item':
      return isItemId(v.value);
    case 'tile':
      return isFarmTile(v.value);
  }
}

function isListRefShape(v: unknown): v is ListRef {
  return (
    isObj(v) &&
    hasExactKeys(v, ['root', 'index', 'path']) &&
    (v.root === 'stack' || v.root === 'helper') &&
    isCount(v.index) &&
    isList(v.path) &&
    v.path.every((step) => isList(step) && step.length === 2 && isCount(step[0]) && isOneOf(step[1], ['body', 'then', 'else']))
  );
}

const LOOP_STATEMENTS = { times: 'repeatTimes', until: 'repeatUntil', forever: 'repeatForever', forEach: 'forEachTile' } as const;

/**
 * A list frame: its list resolves, `next` is 0 … its length, and its loop state matches the list:
 * a loop body (a 'body' branch) has the state of that loop's kind, any other list has none.
 */
function isValidListFrame(v: Obj, program: BlockProgram): boolean {
  const ref: unknown = v.list;
  if (!hasExactKeys(v, ['kind', 'list', 'next', 'loop']) || !isListRefShape(ref)) return false;
  const list = resolveList(program, ref);
  if (list === null || !isIntIn(v.next, 0, list.length)) return false;
  const last = ref.path[ref.path.length - 1];
  if (last === undefined || last[1] !== 'body') return v.loop === null;
  const parent = resolveList(program, { ...ref, path: ref.path.slice(0, -1) });
  const loopStatement = parent?.[last[0]];
  const loop = v.loop;
  if (loopStatement === undefined || !isObj(loop) || !isOneOf(loop.kind, Object.keys(LOOP_STATEMENTS))) return false;
  if (LOOP_STATEMENTS[loop.kind as keyof typeof LOOP_STATEMENTS] !== loopStatement.kind) return false;
  switch (loop.kind) {
    case 'times':
      return hasExactKeys(loop, ['kind', 'left']) && isIntIn(loop.left, 0, ROBOTS.maxRepeatTimes);
    case 'forEach':
      return hasExactKeys(loop, ['kind', 'tiles', 'i']) && isList(loop.tiles) && loop.tiles.every(isFarmTile) && isIntIn(loop.i, 0, loop.tiles.length - 1);
    default:
      return hasExactKeys(loop, ['kind']);
  }
}

function isValidRouteFrame(v: Obj): boolean {
  return (
    hasExactKeys(v, ['kind', 'target', 'path', 'why']) &&
    isFarmTile(v.target) &&
    isList(v.path) &&
    v.path.every(isFarmTile) &&
    isOneOf(v.why, ['goTo', 'forEach', 'doReturn'])
  );
}

function isValidFrame(v: unknown, program: BlockProgram): v is Frame {
  if (!isObj(v)) return false;
  if (v.kind === 'list') return isValidListFrame(v, program);
  return v.kind === 'route' && isValidRouteFrame(v);
}

/** The minutes a stack's trigger may still be due at: its own time for `atTime`, any minute up to pass-out plus n for `every n`. */
function isValidDue(v: unknown, trigger: Trigger): boolean {
  if (v === null) return true;
  if (trigger.kind === 'atTime') return v === trigger.minute;
  if (trigger.kind === 'every') return isIntIn(v, TIME.dayStartMinute, TIME.passOutMinute + trigger.minutes);
  return false;
}

/**
 * A block program's exec (spec §10.2 and plan refinement R1): one value per variable of its
 * declared type; one due and one firedToday entry per stack; running null or a stack index;
 * frames empty exactly when nothing runs, except a lone DO-return route frame; at most
 * maxFrames frames, each valid for the program; doneCards whole and without repeats (which DO
 * cards they name is checked against the robot's .MD).
 */
export function isValidExec(v: unknown, program: BlockProgram): v is RobotExec {
  if (!isObj(v) || !hasExactKeys(v, ['running', 'frames', 'vars', 'due', 'firedToday', 'doneCards'])) return false;
  const { running, frames, vars, due, firedToday, doneCards } = v;
  if (!isList(vars) || vars.length !== program.vars.length || !program.vars.every((decl, i) => isValueOf(vars[i], decl.type))) return false;
  if (!isList(due) || due.length !== program.stacks.length || !program.stacks.every((stack, i) => isValidDue(due[i], stack.trigger))) return false;
  if (!isList(firedToday) || firedToday.length !== program.stacks.length || !firedToday.every(isBool)) return false;
  if (!isList(doneCards) || !doneCards.every(isCount) || new Set(doneCards).size !== doneCards.length) return false;
  if (!(running === null || isIntIn(running, 0, program.stacks.length - 1))) return false;
  if (!isList(frames) || frames.length > ROBOTS.maxFrames || !frames.every((frame) => isValidFrame(frame, program))) return false;
  const returning = (frame: unknown): boolean => isObj(frame) && frame.kind === 'route' && frame.why === 'doReturn';
  if (running === null) return frames.length === 0 || (frames.length === 1 && returning(frames[0]));
  return frames.length > 0 && !frames.some(returning);
}

const isDoCard = (card: MdCard | undefined): boolean => card !== undefined && (card.kind === 'doReturn' || card.kind === 'doPowerDown');

/**
 * A robot's program, pc, exec and .MD: a shaped program that passes checkProgram for its body;
 * a script with exec null and pc on a step, or a block program with pc 0 and a valid exec whose
 * doneCards name DO cards of its .MD; a shaped .MD that passes checkMd.
 */
function isValidMind(v: Obj, body: Pick<Robot, 'size' | 'parts'>): boolean {
  const { program, pc, exec, md } = v;
  if (!isProgramShape(program) || checkProgram(program, body) !== null) return false;
  if (!isMdShape(md) || checkMd(md, body) !== null) return false;
  if (program.kind === 'script') return exec === null && isIntIn(pc, 0, program.steps.length - 1);
  return pc === 0 && isValidExec(exec, program) && exec.doneCards.every((i) => isDoCard(md[i]));
}

function isValidZones(v: unknown): boolean {
  if (!isObj(v) || !hasExactKeys(v, ZONE_IDS)) return false;
  return ZONE_IDS.every((id) => {
    const rect = v[id];
    if (rect === null) return true;
    return isObj(rect) && hasExactKeys(rect, ['x0', 'z0', 'w', 'd']) && isInt(rect.x0) && isInt(rect.z0) && isInt(rect.w) && isInt(rect.d) && isValidZoneRect({ x0: rect.x0, z0: rect.z0, w: rect.w, d: rect.d });
  });
}
```

**5d.** In `isValidRobot`, replace the line:

```ts
  if (!isValidRobotProgram(v.program) || !isIntIn(v.pc, 0, v.program.steps.length - 1)) return false;
```

with:

```ts
  if (!isValidMind(v, { size: v.size, parts })) return false;
  if (!(v.off === null || v.off === 'dizzy' || v.off === 'done')) return false;
  if (v.off !== null && v.power !== 'working' && v.power !== 'standby') return false;
```

**5e.** Replace the doc comment and first line of `isValidRobotsSection`:

```ts
/**
 * The robots section: ids unique, ascending and below nextId; at most maxRobots; every robot
 * valid on the farm; the carried robot (if any) matches `player.carrying` and the player is on
 * the farm; the pool, last night's fuel and the log valid.
 */
export function isValidRobotsSection(v: unknown, maps: GameState['maps'], player: unknown): boolean {
  if (!isObj(v) || !hasExactKeys(v, ['nextId', 'list', 'pool', 'log', 'lastNightFuel']) || !isObj(player)) return false;
```

with:

```ts
/**
 * The robots section: ids unique, ascending and below nextId; at most maxRobots; every robot
 * valid on the farm; the carried robot (if any) matches `player.carrying` and the player is on
 * the farm; the pool, last night's fuel, the log and the zones valid.
 */
export function isValidRobotsSection(v: unknown, maps: GameState['maps'], player: unknown): boolean {
  if (!isObj(v) || !hasExactKeys(v, ['nextId', 'list', 'pool', 'log', 'lastNightFuel', 'zones']) || !isObj(player)) return false;
  if (!isValidZones(v.zones)) return false;
```

- [ ] **Step 6: The default section and the migration**

In `src/state/initialState.ts`, replace:

```ts
    robots: { nextId: 1, list: [], pool: 0, log: { nextId: 0, entries: [] }, lastNightFuel: { wood: 0, tokens: 0 } },
```

with:

```ts
    robots: {
      nextId: 1,
      list: [],
      pool: 0,
      log: { nextId: 0, entries: [] },
      lastNightFuel: { wood: 0, tokens: 0 },
      zones: { A: null, B: null, C: null, D: null, E: null, F: null, G: null, H: null },
    },
```

In `src/state/persistence.ts`, insert directly above the doc comment of `migrateSave`:

```ts
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
```

and in `migrateSave`, after `if (isObj(v) && v.version === 3) v = migrateV3toV4(v);`, add:

```ts
  if (isObj(v) && v.version === 4) v = migrateV4toV5(v);
```

(`migrateV3toV4` already builds its robots section from `createDefaultSections()`, so it now carries `zones`; `migrateV4toV5` sets them to null again, which is the same value.)

- [ ] **Step 7: `addRobot` in `src/robots/create.ts`**

Replace the type import and the validation imports:

```ts
import { DIRECTIONS, ROBOT_PART_IDS, ROBOT_SIZES, type GameState, type Robot, type RobotPartId, type RobotPlace, type RobotProgram, type RobotSize } from '../core/types';
import { isValidRobotProgram } from '../state/robotValidation';
import { isValidName } from '../state/sectionValidation';
import { isCanonicalSubset, isInt } from '../state/validation';
import { MAPS, isReservedTile } from '../world/maps';
import { getTile, isWalkable } from '../world/tiles';
import { batteryFor, hasPart, periodFor } from './stats';
```

with:

```ts
import {
  DIRECTIONS,
  ROBOT_PART_IDS,
  ROBOT_SIZES,
  type GameState,
  type MdCard,
  type Robot,
  type RobotPartId,
  type RobotPlace,
  type RobotProgram,
  type RobotSize,
} from '../core/types';
import { isMdShape, isProgramShape } from '../state/robotValidation';
import { isValidName } from '../state/sectionValidation';
import { isCanonicalSubset, isInt } from '../state/validation';
import { MAPS, isReservedTile } from '../world/maps';
import { getTile, isWalkable } from '../world/tiles';
import { checkMd, checkProgram } from './check';
import { freshExec } from './exec';
import { batteryFor, hasPart, periodFor } from './stats';
```

In `RobotSpec`, after `readonly program: RobotProgram;`, add:

```ts
  /** The robot's .MD; none when left out. */
  readonly md?: readonly MdCard[];
```

In `specProblem`, replace:

```ts
  if (!isValidRobotProgram(spec.program)) return 'That program is not a valid script.';
```

with:

```ts
  if (!isProgramShape(spec.program)) return 'That program is not a script or a block program.';
  const programProblem = checkProgram(spec.program, spec);
  if (programProblem !== null) return programProblem;
  const md: unknown = spec.md ?? [];
  if (!isMdShape(md)) return 'That .MD is not a list of cards.';
  const mdProblem = checkMd(md, spec);
  if (mdProblem !== null) return mdProblem;
```

Replace the doc comment of `addRobot`:

```ts
/** Adds a robot at `spec.place`, fully charged (not from the pool), working and not carried. */
```

with:

```ts
/**
 * Adds a robot at `spec.place`, fully charged (not from the pool), working and not carried. A
 * block program starts idle (freshExec); its morning stack first runs at the next morning reset.
 */
```

and in the robot literal, after `pc: 0,`, add:

```ts
    exec: spec.program.kind === 'blocks' ? freshExec(spec.program) : null,
    md: spec.md ?? [],
    off: null,
```

- [ ] **Step 8: Test helpers and the existing tests' literals**

In `tests/testUtils.ts`, add `type ZoneId,` and `type ZoneRect,` to the `../src/core/types` import (after `type WorldState,`). In `robotOf`, after `pc: 0,` add:

```ts
    exec: null,
    md: [],
    off: null,
```

Append at the end of the file:

```ts
/** Sets some zones (farmclaws part 2), leaving the others as they are. */
export function withZones(state: GameState, zones: Partial<Record<ZoneId, ZoneRect | null>>): GameState {
  return { ...state, robots: { ...state.robots, zones: { ...state.robots.zones, ...zones } } };
}
```

Save-version literals and fixture fields in part 1's tests (nothing else in them changes):
- `tests/persistence.test.ts` line 159: `expect(SAVE_VERSION).toBe(4);` → `expect(SAVE_VERSION).toBe(5);`
- `tests/maps.test.ts` line 821: `expect(migrated.version).toBe(4);` → `expect(migrated.version).toBe(5);`
- `tests/robotSave.test.ts` line 77: `expect(migrated.version).toBe(4);` → `expect(migrated.version).toBe(5);`; lines 81–83: `it('migrates the version-2 fixture all the way to 4', …` → `… all the way to 5', …` and `expect(loaded.version).toBe(4);` → `expect(loaded.version).toBe(5);`
- `tests/sections.test.ts` line 166 (the expected default sections): replace
  ```ts
      robots: { nextId: 1, list: [], pool: 0, log: { nextId: 0, entries: [] }, lastNightFuel: { wood: 0, tokens: 0 } },
  ```
  with
  ```ts
      robots: {
        nextId: 1,
        list: [],
        pool: 0,
        log: { nextId: 0, entries: [] },
        lastNightFuel: { wood: 0, tokens: 0 },
        zones: { A: null, B: null, C: null, D: null, E: null, F: null, G: null, H: null },
      },
  ```

- [ ] **Step 9: Run it and see it pass**

Run: `npx vitest run tests/robotSaveV5.test.ts tests/robotSave.test.ts tests/robotDev.test.ts tests/sections.test.ts tests/persistence.test.ts tests/maps.test.ts`
Expected: PASS (`robotSaveV5.test.ts`: 51 tests).

- [ ] **Step 10: The full gate**

Run: `npm run typecheck && npm test && npm run build`
Expected: all green.

- [ ] **Step 11: Commit**

```bash
git add src/core/types.ts src/robots/exec.ts src/robots/create.ts src/state/initialState.ts src/state/robotValidation.ts src/state/persistence.ts tests/testUtils.ts tests/robotSaveV5.test.ts tests/persistence.test.ts tests/maps.test.ts tests/robotSave.test.ts tests/sections.test.ts
git commit -m "Farmclaws part 2: robot exec, .MD and off fields, zones, save version 5

addRobot and save validation gate programs with isProgramShape + checkProgram and .MDs
with isMdShape + checkMd; isValidRobotProgram is gone. isValidExec follows spec 10.2
with R1 (a lone doReturn route frame while nothing runs) and R4 (tile values on the
farm). Part 1 tests change only in save-version literals and the default robots
section (zones); checkProgram keeps part 1's script message, so robotDev.test.ts is untouched.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Zones and evaluation

**Files:**
- Create: `src/robots/zones.ts`
- Create: `src/robots/eval.ts`
- Test: `tests/robotEval.test.ts`

**Interfaces:**
- Consumes (Tasks 1–3, from the contracts):
  - `src/core/types.ts`: `ZoneId`, `ZoneRect`, `Value`, `Expr`, `BlockProgram`, `VarDecl`; `Robot.exec`, `Robot.md`; `RobotsState.zones: Readonly<Record<ZoneId, ZoneRect | null>>`.
  - `src/config.ts`: `ROBOTS.maxNumber`.
  - `src/robots/program.ts`: `farmContains(tx: number, tz: number): boolean`, `literalValue(expr: Expr): Value`.
  - `src/robots/blocks.ts`: `b` (tests only).
  - `src/robots/exec.ts`: `freshExec(program: BlockProgram): RobotExec` (tests only).
  - `tests/testUtils.ts`: `robotOf` (with `exec: null, md: [], off: null`), `withZones(state, zones: Partial<Record<ZoneId, ZoneRect | null>>): GameState`.
  - Part 1: `stepTile` (`src/world/grid.ts`), `getTile`, `requireTile`, `isWalkable`, `isSoil` (`src/world/tiles.ts`), `isMature` (`src/farming/crops.ts`), `bagCount` (`src/robots/bag.ts`), `bagStacks` (`src/robots/stats.ts`), `invariant` (`src/core/invariant.ts`).
- Produces:
  - `zones.ts`: `export function zoneOf(state: GameState, id: ZoneId): ZoneRect | null`; `export function inZone(rect: ZoneRect, tx: number, tz: number): boolean`; `export function snakeTiles(rect: ZoneRect): readonly TileCoord[]`; `export function tileAheadOf(robot: Pick<Robot, 'tx' | 'tz' | 'facing'>): TileCoord`.
  - `eval.ts`: `export interface EvalContext { readonly state: GameState; readonly robot: Robot; readonly program: BlockProgram; readonly vars: readonly Value[] }`; `export function evaluate(expr: Expr, ctx: EvalContext): Value`; `export function clampNumber(n: number): number`.

**Ruling recorded here (for Task 11's spec sync):** a `Tile` value is always a farm tile (spec §2.2), but `tile ahead` of a robot standing on the farm's edge and facing out is off the farm. `evaluate` then gives the robot's own tile (the tile ahead clamped onto the farm), so a `set` / `Go to` can never put an off-farm tile into `exec`, and every reachable `exec` still validates. The `tileAheadIs` sensor is unaffected: off the farm is `blocked`.

- [ ] **Step 1: Write the failing test `tests/robotEval.test.ts`**

```ts
/**
 * Zones and expression evaluation (farmclaws part 2 spec §2.1, §5.1): every expression kind and
 * every sensor, both ways, against real tiles.
 */
import { describe, expect, it } from 'vitest';
import { ROBOTS, TIME } from '../src/config';
import { Blocker, Direction, TileState, Weather, type Expr, type GameState, type Robot, type Value } from '../src/core/types';
import { b } from '../src/robots/blocks';
import { clampNumber, evaluate, type EvalContext } from '../src/robots/eval';
import { freshExec } from '../src/robots/exec';
import { inZone, snakeTiles, tileAheadOf, zoneOf } from '../src/robots/zones';
import { blockedTile, EMPTY_TILE } from '../src/world/tiles';
import { BASE, TARGET, cropOf, matureCrop, robotOf, soilTile, stack, withTile, withZones } from './testUtils';

/** TARGET is (5, 10); the default robot stands on it facing South, so the tile ahead is (5, 11). */
const AHEAD = { tx: TARGET.tx, tz: TARGET.tz + 1 };

const PROGRAM = b.program({
  vars: [b.numVar('n', 7), b.textVar('t', 'hi'), b.yesVar('y', true), b.itemVar('i', 'parsnip'), b.tileVar('home', 5, 9)],
  stacks: [b.when(b.morning(), b.move())],
});

function ctxOf(state: GameState = BASE, robot: Robot = robotOf(), vars: readonly Value[] = freshExec(PROGRAM).vars): EvalContext {
  return { state, robot, program: PROGRAM, vars };
}

const ev = (expr: Expr, state: GameState = BASE, robot: Robot = robotOf()): Value => evaluate(expr, ctxOf(state, robot));
const yes = (value: boolean): Value => ({ type: 'yesNo', value });
const num = (value: number): Value => ({ type: 'number', value });
const onTarget = (tile: Parameters<typeof withTile>[2]): GameState => withTile(BASE, TARGET, tile, 'farm');
const ahead = (tile: Parameters<typeof withTile>[2]): GameState => withTile(BASE, AHEAD, tile, 'farm');
const chest = { ...EMPTY_TILE, object: { kind: 'chest' as const, slots: Array.from({ length: 36 }, () => null) } };

describe('zones', () => {
  it('reads a zone from the save, null when empty', () => {
    const rect = { x0: 2, z0: 3, w: 3, d: 2 };
    expect(zoneOf(withZones(BASE, { A: rect }), 'A')).toEqual(rect);
    expect(zoneOf(BASE, 'B')).toBeNull();
  });

  it('knows which tiles are inside a rectangle, edges included', () => {
    const rect = { x0: 2, z0: 3, w: 3, d: 2 };
    expect([inZone(rect, 2, 3), inZone(rect, 4, 4), inZone(rect, 5, 3), inZone(rect, 2, 5), inZone(rect, 1, 3), inZone(rect, 2, 2)]).toEqual([
      true,
      true,
      false,
      false,
      false,
      false,
    ]);
  });

  it('walks a 3×2 zone in snake order and a 1×1 zone as its one tile', () => {
    expect(snakeTiles({ x0: 2, z0: 3, w: 3, d: 2 })).toEqual([
      { tx: 2, tz: 3 },
      { tx: 3, tz: 3 },
      { tx: 4, tz: 3 },
      { tx: 4, tz: 4 },
      { tx: 3, tz: 4 },
      { tx: 2, tz: 4 },
    ]);
    expect(snakeTiles({ x0: 7, z0: 9, w: 1, d: 1 })).toEqual([{ tx: 7, tz: 9 }]);
  });

  it('finds the tile ahead for each facing', () => {
    const at = (facing: Direction) => tileAheadOf({ tx: 5, tz: 10, facing });
    expect([at(Direction.North), at(Direction.East), at(Direction.South), at(Direction.West)]).toEqual([
      { tx: 5, tz: 9 },
      { tx: 6, tz: 10 },
      { tx: 5, tz: 11 },
      { tx: 4, tz: 10 },
    ]);
  });
});

describe('values', () => {
  it('evaluates every literal', () => {
    expect(ev(b.n(-12))).toEqual(num(-12));
    expect(ev(b.text('Hello'))).toEqual({ type: 'text', value: 'Hello' });
    expect(ev(b.yes(false))).toEqual(yes(false));
    expect(ev(b.item('wood'))).toEqual({ type: 'item', value: 'wood' });
    expect(ev(b.tileAt(3, 12))).toEqual({ type: 'tile', value: { tx: 3, tz: 12 } });
  });

  it("reads variables from the robot's current values, not the initials", () => {
    const vars: readonly Value[] = [num(42), { type: 'text', value: 'bye' }, yes(false), { type: 'item', value: 'wood' }, { type: 'tile', value: { tx: 1, tz: 9 } }];
    const ctx = ctxOf(BASE, robotOf(), vars);
    expect(['n', 't', 'y', 'i', 'home'].map((name) => evaluate(b.v(name), ctx))).toEqual(vars);
  });

  it('reads its own tile, the tile ahead, its tokens and its bag', () => {
    const robot = robotOf({ tokens: 33, bag: [stack('parsnip_seeds', 5)] });
    expect(ev(b.myTile(), BASE, robot)).toEqual({ type: 'tile', value: TARGET });
    expect(ev(b.tileAhead(), BASE, robot)).toEqual({ type: 'tile', value: AHEAD });
    expect(ev(b.tokensLeft(), BASE, robot)).toEqual(num(33));
    expect(ev(b.countInBag('parsnip_seeds'), BASE, robot)).toEqual(num(5));
    expect(ev(b.countInBag('wood'), BASE, robot)).toEqual(num(0));
  });

  it('gives its own tile as the tile ahead when it faces off the farm', () => {
    const robot = robotOf({ tx: 0, tz: 13, facing: Direction.West });
    expect(ev(b.tileAhead(), BASE, robot)).toEqual({ type: 'tile', value: { tx: 0, tz: 13 } });
  });

  it('does arithmetic and clamps to ±maxNumber', () => {
    expect(ev(b.add(b.n(2), b.n(3)))).toEqual(num(5));
    expect(ev(b.sub(b.n(2), b.n(3)))).toEqual(num(-1));
    expect(ev(b.mul(b.n(-4), b.n(3)))).toEqual(num(-12));
    expect(ev(b.add(b.n(ROBOTS.maxNumber), b.n(1)))).toEqual(num(ROBOTS.maxNumber));
    expect(ev(b.mul(b.n(ROBOTS.maxNumber), b.n(-ROBOTS.maxNumber)))).toEqual(num(-ROBOTS.maxNumber));
    expect([clampNumber(5), clampNumber(1_000_000), clampNumber(-1_000_000)]).toEqual([5, ROBOTS.maxNumber, -ROBOTS.maxNumber]);
  });

  it('compares numbers by order and every type by equality', () => {
    expect([ev(b.lt(b.n(1), b.n(2))), ev(b.lt(b.n(2), b.n(2))), ev(b.gt(b.n(3), b.n(2))), ev(b.gt(b.n(2), b.n(3)))]).toEqual([
      yes(true),
      yes(false),
      yes(true),
      yes(false),
    ]);
    expect([ev(b.eq(b.n(4), b.n(4))), ev(b.ne(b.n(4), b.n(4)))]).toEqual([yes(true), yes(false)]);
    expect([ev(b.eq(b.tileAt(5, 10), b.myTile())), ev(b.eq(b.tileAt(5, 11), b.myTile())), ev(b.ne(b.tileAt(6, 10), b.myTile()))]).toEqual([
      yes(true),
      yes(false),
      yes(true),
    ]);
    expect([ev(b.eq(b.item('wood'), b.item('wood'))), ev(b.eq(b.item('wood'), b.item('stone')))]).toEqual([yes(true), yes(false)]);
    expect([ev(b.eq(b.text('a'), b.text('a'))), ev(b.ne(b.yes(true), b.yes(false)))]).toEqual([yes(true), yes(true)]);
  });

  it('combines Yes/No values', () => {
    const t = b.yes(true);
    const f = b.yes(false);
    expect([ev(b.and(t, t)), ev(b.and(t, f)), ev(b.or(f, t)), ev(b.or(f, f)), ev(b.not(t)), ev(b.not(f))]).toEqual([
      yes(true),
      yes(false),
      yes(true),
      yes(false),
      yes(false),
      yes(true),
    ]);
  });
});

describe('sensors', () => {
  it('crop is ready only on a living, mature crop', () => {
    expect(ev(b.cropIsReady(), onTarget(soilTile(TileState.Watered, matureCrop('parsnip'))))).toEqual(yes(true));
    expect(ev(b.cropIsReady(), onTarget(soilTile(TileState.Watered, cropOf('parsnip'))))).toEqual(yes(false));
    expect(ev(b.cropIsReady(), onTarget(soilTile(TileState.Watered, matureCrop('parsnip', { dead: true }))))).toEqual(yes(false));
    expect(ev(b.cropIsReady(), onTarget(EMPTY_TILE))).toEqual(yes(false));
  });

  it('soil is dry when plowed but not watered', () => {
    expect(ev(b.soilIsDry(), onTarget(soilTile(TileState.Plowed)))).toEqual(yes(true));
    expect(ev(b.soilIsDry(), onTarget(soilTile(TileState.Watered)))).toEqual(yes(false));
    expect(ev(b.soilIsDry(), onTarget(EMPTY_TILE))).toEqual(yes(false));
  });

  it('tile is tilled when plowed or watered', () => {
    expect(ev(b.tileIsTilled(), onTarget(soilTile(TileState.Plowed)))).toEqual(yes(true));
    expect(ev(b.tileIsTilled(), onTarget(soilTile(TileState.Watered)))).toEqual(yes(true));
    expect(ev(b.tileIsTilled(), onTarget(EMPTY_TILE))).toEqual(yes(false));
  });

  it('crop is names the crop on its own tile', () => {
    const potatoes = onTarget(soilTile(TileState.Plowed, cropOf('potato')));
    expect(ev(b.cropIs('potato'), potatoes)).toEqual(yes(true));
    expect(ev(b.cropIs('parsnip'), potatoes)).toEqual(yes(false));
    expect(ev(b.cropIs('potato'), onTarget(EMPTY_TILE))).toEqual(yes(false));
  });

  it('bag is full at its stack capacity, basket included', () => {
    const basket = (stacks: number) => robotOf({ parts: ['basket'], bag: [stack('wood', 1), stack('stone', 1), stack('fiber', 1)].slice(0, stacks) });
    expect(ev(b.bagIsFull(), BASE, basket(3))).toEqual(yes(true));
    expect(ev(b.bagIsFull(), BASE, basket(2))).toEqual(yes(false));
    expect(ev(b.bagIsFull(), BASE, robotOf({ bag: [stack('wood', 1)] }))).toEqual(yes(true));
    expect(ev(b.bagIsFull(), BASE, robotOf())).toEqual(yes(false));
  });

  it('bag has an item when any stack holds it', () => {
    const robot = robotOf({ bag: [stack('parsnip', 2)] });
    expect([ev(b.bagHas('parsnip'), BASE, robot), ev(b.bagHas('wood'), BASE, robot)]).toEqual([yes(true), yes(false)]);
  });

  it("at edge of: inside the zone with a neighbour outside it", () => {
    const state = withZones(BASE, { A: { x0: 4, z0: 9, w: 3, d: 3 } });
    expect(ev(b.atEdgeOf('A'), state, robotOf({ tx: 5, tz: 10 }))).toEqual(yes(false));
    expect(ev(b.atEdgeOf('A'), state, robotOf({ tx: 4, tz: 10 }))).toEqual(yes(true));
    expect(ev(b.atEdgeOf('A'), state, robotOf({ tx: 6, tz: 11 }))).toEqual(yes(true));
    expect(ev(b.atEdgeOf('A'), state, robotOf({ tx: 7, tz: 10 }))).toEqual(yes(false));
    expect(ev(b.atEdgeOf('B'), state, robotOf({ tx: 4, tz: 10 }))).toEqual(yes(false));
  });

  it('tokens below compares with its number', () => {
    const robot = robotOf({ tokens: 10 });
    expect([ev(b.tokensBelow(11), BASE, robot), ev(b.tokensBelow(10), BASE, robot), ev(b.tokensBelow(b.add(b.n(5), b.n(6))), BASE, robot)]).toEqual([
      yes(true),
      yes(false),
      yes(true),
    ]);
  });

  it('tile ahead is water, blocked or clear', () => {
    const cases: readonly [string, GameState, Robot, 'water' | 'blocked' | 'clear'][] = [
      ['water', ahead(blockedTile(Blocker.Water)), robotOf(), 'water'],
      ['a rock', ahead(blockedTile(Blocker.Rock, 2)), robotOf(), 'blocked'],
      ['a chest', ahead(chest), robotOf(), 'blocked'],
      ['the farm edge', BASE, robotOf({ tx: 0, tz: 13, facing: Direction.West }), 'blocked'],
      ['grass', ahead(EMPTY_TILE), robotOf(), 'clear'],
      ['soil', ahead(soilTile(TileState.Plowed)), robotOf(), 'clear'],
    ];
    for (const [label, state, robot, what] of cases) {
      const answers = (['water', 'blocked', 'clear'] as const).map((w) => ev(b.tileAheadIs(w), state, robot));
      expect(answers, label).toEqual((['water', 'blocked', 'clear'] as const).map((w) => yes(w === what)));
    }
  });

  it('it is raining in rain and storms only', () => {
    const answer = (weather: Weather) => ev(b.itIsRaining(), { ...BASE, weather });
    expect([answer(Weather.Rain), answer(Weather.Storm), answer(Weather.Sunny), answer(Weather.Snow)]).toEqual([yes(true), yes(true), yes(false), yes(false)]);
  });

  it('time is after: No at the minute, Yes one minute later', () => {
    const at = (minuteOfDay: number) => ev(b.timeIsAfter(TIME.dayStartMinute + 60), { ...BASE, time: { ...BASE.time, minuteOfDay } });
    expect([at(TIME.dayStartMinute + 60), at(TIME.dayStartMinute + 61)]).toEqual([yes(false), yes(true)]);
  });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run tests/robotEval.test.ts`
Expected: FAIL — `Error: Cannot find module '../src/robots/eval'` (neither `eval.ts` nor `zones.ts` exists yet).

- [ ] **Step 3: Create `src/robots/zones.ts`**

```ts
/**
 * Zones A–H: named farm rectangles (farmclaws part 2 spec §2.1), and the tile ahead of a robot. Pure.
 */
import type { GameState, Robot, TileCoord, ZoneId, ZoneRect } from '../core/types';
import { stepTile } from '../world/grid';

/** The zone's rectangle, or null when the zone is empty. */
export function zoneOf(state: GameState, id: ZoneId): ZoneRect | null {
  return state.robots.zones[id];
}

export function inZone(rect: ZoneRect, tx: number, tz: number): boolean {
  return tx >= rect.x0 && tx < rect.x0 + rect.w && tz >= rect.z0 && tz < rect.z0 + rect.d;
}

/**
 * Every tile of `rect` in snake order (spec §5.1): rows by ascending z; even rows (counting from
 * z0) by ascending x, odd rows by descending x. No walkability filter.
 */
export function snakeTiles(rect: ZoneRect): readonly TileCoord[] {
  const tiles: TileCoord[] = [];
  for (let row = 0; row < rect.d; row++) {
    for (let col = 0; col < rect.w; col++) {
      const tx = row % 2 === 0 ? rect.x0 + col : rect.x0 + rect.w - 1 - col;
      tiles.push({ tx, tz: rect.z0 + row });
    }
  }
  return tiles;
}

/** The tile one step ahead of the robot (it may be off the farm). */
export function tileAheadOf(robot: Pick<Robot, 'tx' | 'tz' | 'facing'>): TileCoord {
  return stepTile({ tx: robot.tx, tz: robot.tz }, robot.facing);
}
```

- [ ] **Step 4: Create `src/robots/eval.ts`**

```ts
/**
 * Expression evaluation and sensors (farmclaws part 2 spec §5.1 "Expressions"). Pure.
 *
 * Expressions are read against `state` and the robot as they are at the start of the minute.
 * Sensors read the robot's own tile unless they say "ahead". The program has passed
 * `checkProgram`, so every expression has the type its socket needs; a mismatch here is an
 * invariant failure, never a player-facing error.
 */
import { ROBOTS } from '../config';
import { invariant } from '../core/invariant';
import {
  Blocker,
  DIRECTIONS,
  TileState,
  Weather,
  type BlockProgram,
  type Expr,
  type GameState,
  type Robot,
  type Tile,
  type TileCoord,
  type Value,
} from '../core/types';
import { isMature } from '../farming/crops';
import { stepTile } from '../world/grid';
import { getTile, isSoil, isWalkable, requireTile } from '../world/tiles';
import { bagCount } from './bag';
import { farmContains, literalValue } from './program';
import { bagStacks } from './stats';
import { inZone, tileAheadOf, zoneOf } from './zones';

export interface EvalContext {
  readonly state: GameState;
  readonly robot: Robot;
  readonly program: BlockProgram;
  /** The robot's current variable values, one per program.vars. */
  readonly vars: readonly Value[];
}

/** Clamps a number to ±ROBOTS.maxNumber. */
export function clampNumber(n: number): number {
  return Math.max(-ROBOTS.maxNumber, Math.min(ROBOTS.maxNumber, n));
}

function numberOf(expr: Expr, ctx: EvalContext): number {
  const value = evaluate(expr, ctx);
  invariant(value.type === 'number', `expected a number from ${expr.kind}, got ${value.type}`);
  return value.value;
}

function yesNoOf(expr: Expr, ctx: EvalContext): boolean {
  const value = evaluate(expr, ctx);
  invariant(value.type === 'yesNo', `expected a yes/no from ${expr.kind}, got ${value.type}`);
  return value.value;
}

function sameValue(a: Value, b: Value): boolean {
  invariant(a.type === b.type, `compared a ${a.type} with a ${b.type}`);
  if (a.type === 'tile' && b.type === 'tile') return a.value.tx === b.value.tx && a.value.tz === b.value.tz;
  return a.value === b.value;
}

/**
 * The tile ahead as a Tile value. Values only ever hold farm tiles, so a robot facing off the
 * farm's edge gets its own tile (the tile ahead clamped onto the farm).
 */
function tileAheadValue(robot: Robot): TileCoord {
  const ahead = tileAheadOf(robot);
  return farmContains(ahead.tx, ahead.tz) ? ahead : { tx: robot.tx, tz: robot.tz };
}

const number = (value: number): Value => ({ type: 'number', value });
const yesNo = (value: boolean): Value => ({ type: 'yesNo', value });

export function evaluate(expr: Expr, ctx: EvalContext): Value {
  const { state, robot } = ctx;
  const own = (): Tile => requireTile(state.maps.farm, robot.tx, robot.tz);
  switch (expr.kind) {
    case 'num':
    case 'text':
    case 'yes':
    case 'item':
    case 'tile':
      return literalValue(expr);
    case 'var': {
      const index = ctx.program.vars.findIndex((decl) => decl.name === expr.name);
      const value = ctx.vars[index];
      invariant(index !== -1 && value !== undefined, `unknown variable ${expr.name}`);
      return value;
    }
    case 'myTile':
      return { type: 'tile', value: { tx: robot.tx, tz: robot.tz } };
    case 'tileAhead':
      return { type: 'tile', value: tileAheadValue(robot) };
    case 'tokensLeft':
      return number(robot.tokens);
    case 'countInBag':
      return number(bagCount(robot.bag, expr.itemId));
    case 'arith': {
      const a = numberOf(expr.a, ctx);
      const b = numberOf(expr.b, ctx);
      return number(clampNumber(expr.op === '+' ? a + b : expr.op === '-' ? a - b : a * b));
    }
    case 'compare': {
      if (expr.op === '<' || expr.op === '>') {
        const a = numberOf(expr.a, ctx);
        const b = numberOf(expr.b, ctx);
        return yesNo(expr.op === '<' ? a < b : a > b);
      }
      const same = sameValue(evaluate(expr.a, ctx), evaluate(expr.b, ctx));
      return yesNo(expr.op === '=' ? same : !same);
    }
    case 'and':
      return yesNo(yesNoOf(expr.a, ctx) && yesNoOf(expr.b, ctx));
    case 'or':
      return yesNo(yesNoOf(expr.a, ctx) || yesNoOf(expr.b, ctx));
    case 'not':
      return yesNo(!yesNoOf(expr.a, ctx));
    case 'cropIsReady': {
      const crop = own().crop;
      return yesNo(crop !== null && isMature(crop));
    }
    case 'soilIsDry':
      return yesNo(own().state === TileState.Plowed);
    case 'tileIsTilled':
      return yesNo(isSoil(own()));
    case 'cropIs': {
      const crop = own().crop;
      return yesNo(crop !== null && crop.cropId === expr.cropId);
    }
    case 'bagIsFull':
      return yesNo(robot.bag.length >= bagStacks(robot));
    case 'bagHas':
      return yesNo(bagCount(robot.bag, expr.itemId) > 0);
    case 'atEdgeOf': {
      const rect = zoneOf(state, expr.zone);
      if (rect === null || !inZone(rect, robot.tx, robot.tz)) return yesNo(false);
      const neighbours = DIRECTIONS.map((d) => stepTile({ tx: robot.tx, tz: robot.tz }, d));
      return yesNo(neighbours.some((n) => !inZone(rect, n.tx, n.tz)));
    }
    case 'tokensBelow':
      return yesNo(robot.tokens < numberOf(expr.n, ctx));
    case 'tileAheadIs': {
      const ahead = tileAheadOf(robot);
      const tile = getTile(state.maps.farm, ahead.tx, ahead.tz);
      const water = tile !== null && tile.blocker === Blocker.Water;
      const clear = tile !== null && isWalkable(tile);
      if (expr.what === 'water') return yesNo(water);
      if (expr.what === 'clear') return yesNo(clear);
      return yesNo(!water && !clear);
    }
    case 'itIsRaining':
      return yesNo(state.weather === Weather.Rain || state.weather === Weather.Storm);
    case 'timeIsAfter':
      return yesNo(state.time.minuteOfDay > expr.minute);
  }
}
```

- [ ] **Step 5: Run it and see it pass**

Run: `npx vitest run tests/robotEval.test.ts`
Expected: PASS (22 tests).

- [ ] **Step 6: The full gate**

Run: `npm run typecheck && npm test && npm run build`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add src/robots/zones.ts src/robots/eval.ts tests/robotEval.test.ts
git commit -m "Farmclaws part 2: zones and expression evaluation

A robot facing off the farm's edge reads its own tile as 'tile ahead', so Tile values
stay farm tiles.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Routes and DON'T checks

**Files:**
- Create: `src/robots/md.ts` (the DON'T half; Task 7 adds the DO half and `mdCardText` to this file)
- Create: `src/robots/route.ts`
- Test: `tests/robotRoute.test.ts`

**Interfaces:**
- Consumes:
  - Task 4: `zoneOf(state: GameState, id: ZoneId): ZoneRect | null`, `inZone(rect: ZoneRect, tx: number, tz: number): boolean`, `tileAheadOf(robot: Pick<Robot, 'tx' | 'tz' | 'facing'>): TileCoord`.
  - Task 3: `Robot.md: readonly MdCard[]`; `tests/testUtils.ts` `robotOf`, `withZones`.
  - Task 1: `MdCard`.
  - Part 1: `DIRECTIONS`, `Blocker` (`src/core/types.ts`), `inBounds`, `stepTile` (`src/world/grid.ts`), `getTile`, `isWalkable` (`src/world/tiles.ts`), `invariant`.
- Produces:
  - `md.ts`: `export function dontForbids(state: GameState, robot: Robot, action: RobotAction): MdCard | null`; `export function moveForbiddenBy(robot: Robot, from: TileCoord, to: TileCoord, state: GameState): MdCard | null`; `export function keptItems(robot: Robot): ReadonlySet<ItemId>`.
  - `route.ts`: `export function planRoute(state: GameState, robot: Robot, target: TileCoord): readonly TileCoord[] | null`; `export function nextRouteAction(robot: Pick<Robot, 'tx' | 'tz' | 'facing'>, next: TileCoord): RobotAction`.
  - One addition beyond the contract (an extra export, nothing renamed): `route.ts` `export function canEnter(state: GameState, robot: Robot, from: TileCoord, to: TileCoord): boolean` — the single-step rule `planRoute` searches with. Task 6's route frames use it to notice a saved path whose next tile can no longer be entered.

Rules pinned by this task:
- `planRoute` searches breadth-first in `DIRECTIONS` order (North, East, South, West), recording each tile's parent on first discovery, so ties always break the same way. A tile may be entered when it is on the farm, walkable, not water, and `moveForbiddenBy` allows the step. Other robots never block.
- `dontForbids` checks cards in .MD order and returns the first that forbids the action. A deposit is forbidden only when the bag is non-empty and every stack's item is kept; the card named is the first `dontDeposit` card whose item is in the bag.

- [ ] **Step 1: Write the failing test `tests/robotRoute.test.ts`**

```ts
/**
 * Routes and DON'T checks (farmclaws part 2 spec §5.3, §6.2): shortest paths in a fixed order,
 * the cards that shape them, and what each DON'T card forbids.
 */
import { describe, expect, it } from 'vitest';
import { Blocker, Direction, TileState, type GameState, type MdCard, type TileCoord } from '../src/core/types';
import { dontForbids, keptItems, moveForbiddenBy } from '../src/robots/md';
import { nextRouteAction, planRoute } from '../src/robots/route';
import { blockedTile } from '../src/world/tiles';
import { BASE, TARGET, matureCrop, robotOf, soilTile, stack, withTile, withZones } from './testUtils';

const rockAt = (state: GameState, ...tiles: TileCoord[]): GameState =>
  tiles.reduce((s, t) => withTile(s, t, blockedTile(Blocker.Rock, 2), 'farm'), state);
const waterAt = (state: GameState, ...tiles: TileCoord[]): GameState =>
  tiles.reduce((s, t) => withTile(s, t, blockedTile(Blocker.Water), 'farm'), state);
const tiles = (...coords: [number, number][]): TileCoord[] => coords.map(([tx, tz]) => ({ tx, tz }));

const WATER: MdCard = { kind: 'dontGoIntoWater' };
const LEAVE_A: MdCard = { kind: 'dontLeave', zone: 'A' };
/** Zone A: x 4…6, z 9…11, around TARGET (5, 10). */
const ZONE_A = { x0: 4, z0: 9, w: 3, d: 3 };

describe('planRoute', () => {
  it('goes straight to a tile in line', () => {
    expect(planRoute(BASE, robotOf(), { tx: 5, tz: 13 })).toEqual(tiles([5, 11], [5, 12], [5, 13]));
  });

  it('is [] on the target and null for a target nobody can stand on', () => {
    expect(planRoute(BASE, robotOf(), TARGET)).toEqual([]);
    expect(planRoute(rockAt(BASE, { tx: 5, tz: 12 }), robotOf(), { tx: 5, tz: 12 })).toBeNull();
    expect(planRoute(waterAt(BASE, { tx: 5, tz: 12 }), robotOf(), { tx: 5, tz: 12 })).toBeNull();
    expect(planRoute(BASE, robotOf(), { tx: -1, tz: 10 })).toBeNull();
  });

  it('goes round a rock, breaking ties in DIRECTIONS order (exact path)', () => {
    expect(planRoute(rockAt(BASE, { tx: 5, tz: 11 }), robotOf(), { tx: 5, tz: 12 })).toEqual(tiles([6, 10], [6, 11], [6, 12], [5, 12]));
    expect(planRoute(BASE, robotOf(), { tx: 7, tz: 12 })).toEqual(tiles([6, 10], [7, 10], [7, 11], [7, 12]));
  });

  it('goes round water like any obstacle', () => {
    const path = planRoute(waterAt(BASE, { tx: 5, tz: 11 }), robotOf(), { tx: 5, tz: 12 });
    expect(path).toEqual(tiles([6, 10], [6, 11], [6, 12], [5, 12]));
  });

  it('is null when walled in', () => {
    const walled = rockAt(BASE, { tx: 5, tz: 9 }, { tx: 6, tz: 10 }, { tx: 5, tz: 11 }, { tx: 4, tz: 10 });
    expect(planRoute(walled, robotOf(), { tx: 5, tz: 13 })).toBeNull();
  });

  it("keeps a robot inside its DON'T leave zone, and lets one outside walk in", () => {
    const state = withZones(BASE, { A: ZONE_A });
    expect(planRoute(state, robotOf({ md: [LEAVE_A] }), { tx: 5, tz: 13 })).toBeNull();
    expect(planRoute(state, robotOf({ md: [LEAVE_A] }), { tx: 6, tz: 11 })).toEqual(tiles([6, 10], [6, 11]));
    expect(planRoute(state, robotOf({ md: [LEAVE_A], tz: 13 }), TARGET)).toEqual(tiles([5, 12], [5, 11], [5, 10]));
    expect(planRoute(state, robotOf(), { tx: 5, tz: 13 })).toEqual(tiles([5, 11], [5, 12], [5, 13]));
  });

  it('is null when the only way inside the zone leads out of it', () => {
    const row = withZones(rockAt(BASE, { tx: 5, tz: 10 }), { A: { x0: 4, z0: 10, w: 3, d: 1 } });
    const robot = robotOf({ tx: 4, tz: 10, md: [LEAVE_A] });
    expect(planRoute(row, robot, { tx: 6, tz: 10 })).toBeNull();
    expect(planRoute(row, robotOf({ tx: 4, tz: 10 }), { tx: 6, tz: 10 })).toEqual(tiles([4, 9], [5, 9], [6, 9], [6, 10]));
  });

  it("never steps into water with DON'T go into water", () => {
    const pond = waterAt(BASE, { tx: 5, tz: 11 }, { tx: 6, tz: 11 });
    const path = planRoute(pond, robotOf({ md: [WATER] }), { tx: 5, tz: 12 });
    expect(path).toEqual(tiles([4, 10], [4, 11], [4, 12], [5, 12]));
  });
});

describe('nextRouteAction', () => {
  it('moves when facing the next tile, otherwise takes the shorter turn (right on a tie)', () => {
    const robot = { tx: 5, tz: 10, facing: Direction.South };
    expect(nextRouteAction(robot, { tx: 5, tz: 11 })).toEqual({ kind: 'move' });
    expect(nextRouteAction(robot, { tx: 6, tz: 10 })).toEqual({ kind: 'turn', side: 'left' });
    expect(nextRouteAction(robot, { tx: 4, tz: 10 })).toEqual({ kind: 'turn', side: 'right' });
    expect(nextRouteAction(robot, { tx: 5, tz: 9 })).toEqual({ kind: 'turn', side: 'right' });
    expect(nextRouteAction({ ...robot, facing: Direction.North }, { tx: 6, tz: 10 })).toEqual({ kind: 'turn', side: 'right' });
    expect(nextRouteAction({ ...robot, facing: Direction.North }, { tx: 4, tz: 10 })).toEqual({ kind: 'turn', side: 'left' });
  });
});

describe("what DON'T cards forbid", () => {
  const zoned = withZones(BASE, { A: ZONE_A });

  it("DON'T leave: a move from inside the zone to outside it", () => {
    const out = robotOf({ tx: 5, tz: 11, md: [LEAVE_A] });
    expect(dontForbids(zoned, out, { kind: 'move' })).toEqual(LEAVE_A);
    expect(dontForbids(zoned, robotOf({ md: [LEAVE_A] }), { kind: 'move' })).toBeNull();
    expect(dontForbids(zoned, robotOf({ tz: 13, md: [LEAVE_A] }), { kind: 'move' })).toBeNull();
    expect(dontForbids(zoned, out, { kind: 'turn', side: 'left' })).toBeNull();
    expect(dontForbids(BASE, out, { kind: 'move' })).toBeNull();
  });

  it("DON'T go into water: a move onto water", () => {
    const wet = waterAt(BASE, { tx: 5, tz: 11 });
    expect(dontForbids(wet, robotOf({ md: [WATER] }), { kind: 'move' })).toEqual(WATER);
    expect(dontForbids(BASE, robotOf({ md: [WATER] }), { kind: 'move' })).toBeNull();
    expect(dontForbids(wet, robotOf(), { kind: 'move' })).toBeNull();
  });

  it("DON'T harvest: a harvest on a tile with that crop", () => {
    const card: MdCard = { kind: 'dontHarvest', cropId: 'pumpkin' };
    const robot = robotOf({ md: [card] });
    const pumpkin = withTile(BASE, TARGET, soilTile(TileState.Watered, matureCrop('pumpkin')), 'farm');
    const parsnip = withTile(BASE, TARGET, soilTile(TileState.Watered, matureCrop('parsnip')), 'farm');
    expect(dontForbids(pumpkin, robot, { kind: 'harvest' })).toEqual(card);
    expect(dontForbids(parsnip, robot, { kind: 'harvest' })).toBeNull();
    expect(dontForbids(BASE, robot, { kind: 'harvest' })).toBeNull();
    expect(dontForbids(pumpkin, robot, { kind: 'water' })).toBeNull();
  });

  it("DON'T deposit: only when every stack in the bag is kept", () => {
    const wood: MdCard = { kind: 'dontDeposit', itemId: 'wood' };
    const parsnip: MdCard = { kind: 'dontDeposit', itemId: 'parsnip' };
    const md = [wood, parsnip];
    expect(dontForbids(BASE, robotOf({ md, bag: [stack('parsnip', 3)] }), { kind: 'deposit' })).toEqual(parsnip);
    expect(dontForbids(BASE, robotOf({ md, size: 'standard', bag: [stack('parsnip', 3), stack('wood', 2)] }), { kind: 'deposit' })).toEqual(wood);
    expect(dontForbids(BASE, robotOf({ md, size: 'standard', bag: [stack('parsnip', 3), stack('stone', 2)] }), { kind: 'deposit' })).toBeNull();
    expect(dontForbids(BASE, robotOf({ md }), { kind: 'deposit' })).toBeNull();
  });

  it('names the first card in .MD order when two forbid the same move', () => {
    const state = waterAt(zoned, { tx: 5, tz: 12 });
    const robot = robotOf({ tx: 5, tz: 11, md: [WATER, LEAVE_A] });
    expect(dontForbids(state, robot, { kind: 'move' })).toEqual(WATER);
    expect(dontForbids(state, { ...robot, md: [LEAVE_A, WATER] }, { kind: 'move' })).toEqual(LEAVE_A);
    expect(moveForbiddenBy(robot, { tx: 5, tz: 11 }, { tx: 6, tz: 11 }, state)).toBeNull();
  });

  it('keeps the items of every DON\'T deposit card', () => {
    const md: MdCard[] = [{ kind: 'dontDeposit', itemId: 'parsnip' }, LEAVE_A, { kind: 'dontDeposit', itemId: 'wood' }];
    expect([...keptItems(robotOf({ md }))]).toEqual(['parsnip', 'wood']);
    expect(keptItems(robotOf()).size).toBe(0);
  });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run tests/robotRoute.test.ts`
Expected: FAIL — `Error: Cannot find module '../src/robots/md'`.

- [ ] **Step 3: Create `src/robots/md.ts`**

```ts
/**
 * The Managing Directive (farmclaws part 2 spec §6). This half: what each DON'T card forbids
 * (§6.2). Pure.
 */
import { Blocker, type GameState, type ItemId, type MdCard, type Robot, type RobotAction, type TileCoord } from '../core/types';
import { getTile } from '../world/tiles';
import { inZone, tileAheadOf, zoneOf } from './zones';

/** The first card that forbids one step from `from` to `to` (`dontLeave`, `dontGoIntoWater`), or null. */
export function moveForbiddenBy(robot: Robot, from: TileCoord, to: TileCoord, state: GameState): MdCard | null {
  for (const card of robot.md) {
    if (card.kind === 'dontLeave') {
      const rect = zoneOf(state, card.zone);
      if (rect !== null && inZone(rect, from.tx, from.tz) && !inZone(rect, to.tx, to.tz)) return card;
    } else if (card.kind === 'dontGoIntoWater') {
      if (getTile(state.maps.farm, to.tx, to.tz)?.blocker === Blocker.Water) return card;
    }
  }
  return null;
}

/** Items the robot's `dontDeposit` cards keep in its bag. */
export function keptItems(robot: Robot): ReadonlySet<ItemId> {
  const kept = new Set<ItemId>();
  for (const card of robot.md) if (card.kind === 'dontDeposit') kept.add(card.itemId);
  return kept;
}

/**
 * The first card that forbids `action` for `robot` now, or null (spec §6.2). A deposit is
 * forbidden only when every stack in a non-empty bag is kept; then the first `dontDeposit` card
 * naming an item in the bag is the one that forbade it.
 */
export function dontForbids(state: GameState, robot: Robot, action: RobotAction): MdCard | null {
  switch (action.kind) {
    case 'move':
      return moveForbiddenBy(robot, { tx: robot.tx, tz: robot.tz }, tileAheadOf(robot), state);
    case 'harvest': {
      const crop = getTile(state.maps.farm, robot.tx, robot.tz)?.crop ?? null;
      if (crop === null) return null;
      return robot.md.find((card) => card.kind === 'dontHarvest' && card.cropId === crop.cropId) ?? null;
    }
    case 'deposit': {
      const kept = keptItems(robot);
      if (robot.bag.length === 0 || !robot.bag.every((s) => kept.has(s.itemId))) return null;
      return robot.md.find((card) => card.kind === 'dontDeposit' && robot.bag.some((s) => s.itemId === card.itemId)) ?? null;
    }
    default:
      return null;
  }
}
```

- [ ] **Step 4: Create `src/robots/route.ts`**

```ts
/**
 * Routes for `Go to`, `For each tile` and DO return (farmclaws part 2 spec §5.3). Pure.
 */
import { invariant } from '../core/invariant';
import { Blocker, DIRECTIONS, type GameState, type Robot, type RobotAction, type TileCoord } from '../core/types';
import { inBounds, stepTile } from '../world/grid';
import { getTile, isWalkable } from '../world/tiles';
import { moveForbiddenBy } from './md';

/** Whether a robot may stand on (`tx`, `tz`): a walkable farm tile that isn't water. */
function standable(state: GameState, tile: TileCoord): boolean {
  const t = getTile(state.maps.farm, tile.tx, tile.tz);
  return t !== null && isWalkable(t) && t.blocker !== Blocker.Water;
}

/** Whether a route may take one step from `from` to the adjacent tile `to`. */
export function canEnter(state: GameState, robot: Robot, from: TileCoord, to: TileCoord): boolean {
  return standable(state, to) && moveForbiddenBy(robot, from, to, state) === null;
}

/**
 * The shortest walkable path from the robot to `target`, by breadth-first search in DIRECTIONS
 * order, over steps its DON'T cards allow. Excludes the start, includes the target; `[]` when
 * the robot stands on it; null when the target can't be stood on or can't be reached. Other
 * robots never block a route.
 */
export function planRoute(state: GameState, robot: Robot, target: TileCoord): readonly TileCoord[] | null {
  if (!standable(state, target)) return null;
  if (robot.tx === target.tx && robot.tz === target.tz) return [];
  const grid = state.maps.farm.grid;
  const key = (c: TileCoord): number => c.tz * grid.width + c.tx;
  const parent = new Map<number, TileCoord | null>([[key(robot), null]]);
  const queue: TileCoord[] = [{ tx: robot.tx, tz: robot.tz }];
  for (let head = 0; head < queue.length; head++) {
    const current = queue[head];
    if (current === undefined) break;
    for (const direction of DIRECTIONS) {
      const next = stepTile(current, direction);
      if (!inBounds(grid, next.tx, next.tz) || parent.has(key(next)) || !canEnter(state, robot, current, next)) continue;
      parent.set(key(next), current);
      if (next.tx === target.tx && next.tz === target.tz) {
        const path: TileCoord[] = [next];
        for (let back = current; back.tx !== robot.tx || back.tz !== robot.tz; ) {
          path.push(back);
          const up = parent.get(key(back));
          invariant(up !== undefined && up !== null, 'planRoute: broken parent chain');
          back = up;
        }
        return path.reverse();
      }
      queue.push(next);
    }
  }
  return null;
}

/** `move` when the robot faces `next` (an adjacent tile), otherwise the shorter turn toward it (`right` on a tie). */
export function nextRouteAction(robot: Pick<Robot, 'tx' | 'tz' | 'facing'>, next: TileCoord): RobotAction {
  const direction = DIRECTIONS.find((d) => {
    const step = stepTile({ tx: robot.tx, tz: robot.tz }, d);
    return step.tx === next.tx && step.tz === next.tz;
  });
  invariant(direction !== undefined, `nextRouteAction: (${next.tx}, ${next.tz}) isn't next to (${robot.tx}, ${robot.tz})`);
  if (direction === robot.facing) return { kind: 'move' };
  const quarterTurnsRight = (direction - robot.facing + 4) % 4;
  return { kind: 'turn', side: quarterTurnsRight === 3 ? 'left' : 'right' };
}
```

- [ ] **Step 5: Run it and see it pass**

Run: `npx vitest run tests/robotRoute.test.ts`
Expected: PASS (15 tests).

- [ ] **Step 6: The full gate**

Run: `npm run typecheck && npm test && npm run build`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add src/robots/md.ts src/robots/route.ts tests/robotRoute.test.ts
git commit -m "Farmclaws part 2: routes and DON'T checks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The interpreter

**Files:**
- Create: `src/robots/interpret.ts`
- Test: `tests/robotInterpret.test.ts`

**Interfaces:**
- Consumes:
  - Task 4: `evaluate(expr: Expr, ctx: EvalContext): Value`, `EvalContext`, `clampNumber(n: number): number`, `snakeTiles(rect: ZoneRect): readonly TileCoord[]`, `zoneOf(state: GameState, id: ZoneId): ZoneRect | null`.
  - Task 5: `planRoute(state: GameState, robot: Robot, target: TileCoord): readonly TileCoord[] | null`, `nextRouteAction(robot: Pick<Robot, 'tx' | 'tz' | 'facing'>, next: TileCoord): RobotAction`, and the extra `canEnter(state, robot, from, to): boolean`.
  - Task 2: `resolveList(program: BlockProgram, ref: ListRef): readonly Statement[] | null`; `b` (tests).
  - Task 3: `freshExec(program: BlockProgram): RobotExec` (tests); `Robot.exec`; `robotOf`, `withZones` (tests).
  - Task 1: `ROBOTS.stepBudget`, `ROBOTS.maxRepeatTimes`, `Frame`, `ListRef`, `LoopState`, `RobotExec`, `Statement`, `ActionBlock`, `Value`.
  - Part 1: `ROBOTS.sayMaxLength`, `ROBOTS.maxWaitMinutes`, `manhattanDistance` (`src/world/grid.ts`), `getTile`, `isWalkable`.
- Produces:

```ts
export interface GaveUp { readonly target: TileCoord; readonly why: 'goTo' | 'forEach' | 'doReturn' }
export type Step =
  | { readonly kind: 'act'; readonly action: RobotAction; readonly exec: RobotExec; readonly gaveUp: readonly GaveUp[] }
  | { readonly kind: 'idle'; readonly exec: RobotExec; readonly gaveUp: readonly GaveUp[] }
  | { readonly kind: 'dizzy' };
export function stepProgram(state: GameState, robot: Robot): Step;
/** Starts trigger stack `index`: running = index, frames = [list frame on the stack body]. */
export function startStack(exec: RobotExec, index: number): RobotExec;
```

Rules pinned by this task (each one is tested below):
- **Frames.** Entering a body (loop, `if` branch, helper) first moves the parent frame's `next` past the statement, then pushes the child, so a popped child resumes its parent at the following statement. A body's `ListRef` is the parent's with `[statementIndex, branch]` appended; a helper's is `{ root: 'helper', index, path: [] }`. A loop frame finds its own statement (for `Repeat until`'s test) through the last `path` entry.
- **Step budget.** Each statement passed that isn't a `do` costs one step; each further iteration a loop starts costs one step (passing the loop statement starts the first). A loop that ends without going round costs nothing; expressions, route planning and arriving are free. At `ROBOTS.stepBudget` steps the result is `dizzy`. So 49 `change` blocks and a `move` act; 50 are dizzy; `Repeat 24 × change` (1 + 24 + 23 = 48) then `move` acts; `Repeat 25` is dizzy on its 25th change.
- **`For each tile`.** `LoopState.forEach.tiles` holds every tile of the zone in snake order (all farm tiles, so the saved exec validates); as each iteration starts it skips ahead to the next tile a robot can stand on now (`isWalkable`), then pushes a route frame to it. A zone that is empty or has no standable tile does nothing. A tile the route gives up on is recorded as `gaveUp` and its body is skipped.
- **Route frames.** At the target: pop (free). Otherwise re-plan when the frame has no path, the next path tile isn't next to the robot (blocked, or picked up and put down), or it can no longer be entered (`canEnter` false: a rock landed there, or a DON'T forbids the step — so a route move is never skipped). Emit `nextRouteAction`; a `move` drops the tile it heads for from the saved path, a `turn` keeps the path. No route: pop and record a `GaveUp` for the caller, who logs it (Task 7). A route frame with `why: 'doReturn'` (Task 7) is walked the same way.
- **`do`.** `wait` minutes clamp to 1 … `ROBOTS.maxWaitMinutes`; `say` text is trimmed, cut to `ROBOTS.sayMaxLength` code points (the length rule `isValidRobotAction` uses) and trimmed again, and an empty result says "…"; `take` uses the item value. `repeatTimes` clamps its count to 0 … `ROBOTS.maxRepeatTimes`, evaluated once. `set` / `change` clamp numbers to ±`ROBOTS.maxNumber`.
- `stepProgram` never mutates `state`, the robot or `robot.exec`; a robot with no block program or a null `exec` is an invariant failure. An exec with nothing running and no frames steps straight to `idle`.

- [ ] **Step 1: Write the failing test `tests/robotInterpret.test.ts`**

```ts
/**
 * The interpreter (farmclaws part 2 spec §5.1): every statement, loops and helpers resuming
 * across minutes, variables, the step budget, route frames and `For each tile`.
 */
import { describe, expect, it } from 'vitest';
import { ROBOTS } from '../src/config';
import { deepFreeze } from '../src/core/store';
import {
  Blocker,
  Direction,
  TileState,
  type BlockProgram,
  type GameState,
  type HelperDef,
  type MdCard,
  type Robot,
  type RobotAction,
  type Statement,
  type TileCoord,
  type VarDecl,
} from '../src/core/types';
import { b } from '../src/robots/blocks';
import { freshExec } from '../src/robots/exec';
import { startStack, stepProgram, type GaveUp, type Step } from '../src/robots/interpret';
import { stepTile } from '../src/world/grid';
import { blockedTile } from '../src/world/tiles';
import { BASE, TARGET, must, robotOf, soilTile, withTile, withZones } from './testUtils';

/** A program with one morning stack running `body`. */
function prog(body: Statement[], vars: VarDecl[] = [], helpers: HelperDef[] = []): BlockProgram {
  return b.program({ vars, stacks: [b.when(b.morning(), ...body)], helpers });
}

/** A robot (default: a Mini on TARGET facing South) running stack 0 of `program` from its start. */
function running(program: BlockProgram, overrides: Partial<Robot> = {}): Robot {
  return robotOf({ program, exec: startStack(freshExec(program), 0), ...overrides });
}

/** The robot after its turn resolved: the step's exec is committed, and moves and turns happen. */
function resolve(robot: Robot, step: Step): Robot {
  if (step.kind === 'dizzy') throw new Error('resolve: the robot is dizzy');
  if (step.kind === 'idle') return { ...robot, exec: step.exec };
  const action = step.action;
  if (action.kind === 'move') {
    const to = stepTile({ tx: robot.tx, tz: robot.tz }, robot.facing);
    return { ...robot, tx: to.tx, tz: to.tz, exec: step.exec };
  }
  if (action.kind === 'turn') {
    const facing = ((robot.facing + (action.side === 'left' ? 3 : 1)) % 4) as Direction;
    return { ...robot, facing, exec: step.exec };
  }
  return { ...robot, exec: step.exec };
}

type Outcome = RobotAction | 'idle' | 'dizzy';

/** Runs up to `limit` turns, stopping after the first idle or dizzy. */
function play(state: GameState, start: Robot, limit = 200): { outcomes: Outcome[]; robot: Robot; gaveUp: GaveUp[]; at: TileCoord[] } {
  let robot = start;
  const outcomes: Outcome[] = [];
  const gaveUp: GaveUp[] = [];
  const at: TileCoord[] = [];
  for (let i = 0; i < limit; i++) {
    const step = stepProgram(state, robot);
    if (step.kind === 'dizzy') {
      outcomes.push('dizzy');
      break;
    }
    gaveUp.push(...step.gaveUp);
    if (step.kind === 'idle') {
      outcomes.push('idle');
      robot = resolve(robot, step);
      break;
    }
    outcomes.push(step.action);
    at.push({ tx: robot.tx, tz: robot.tz });
    robot = resolve(robot, step);
  }
  return { outcomes, robot, gaveUp, at };
}

const actions = (body: Statement[], vars: VarDecl[] = [], helpers: HelperDef[] = []): Outcome[] =>
  play(BASE, running(prog(body, vars, helpers))).outcomes;

const MOVE: RobotAction = { kind: 'move' };
const LEFT: RobotAction = { kind: 'turn', side: 'left' };
const RIGHT: RobotAction = { kind: 'turn', side: 'right' };
const say = (text: string): RobotAction => ({ kind: 'say', text });
const rockAt = (state: GameState, ...tiles: TileCoord[]): GameState =>
  tiles.reduce((s, t) => withTile(s, t, blockedTile(Blocker.Rock, 2), 'farm'), state);

describe('startStack', () => {
  it('runs a stack from its first statement', () => {
    const program = b.program({ stacks: [b.when(b.morning(), b.move()), b.when(b.every(15), b.water())] });
    expect(startStack(freshExec(program), 1)).toEqual({
      ...freshExec(program),
      running: 1,
      frames: [{ kind: 'list', list: { root: 'stack', index: 1, path: [] }, next: 0, loop: null }],
    });
  });
});

describe('action blocks', () => {
  it('turns every action block into its part 1 action, in order, then goes idle', () => {
    const program = prog(
      [b.move(), b.turn('left'), b.water(), b.harvest(), b.till(), b.plant('parsnip'), b.refill(), b.deposit(), b.take('wood'), b.say('Hi'), b.wait(30), b.powerDown()],
    );
    expect(play(BASE, running(program)).outcomes).toEqual([
      MOVE,
      LEFT,
      { kind: 'water' },
      { kind: 'harvest' },
      { kind: 'till' },
      { kind: 'plant', cropId: 'parsnip' },
      { kind: 'refill' },
      { kind: 'deposit' },
      { kind: 'take', itemId: 'wood' },
      say('Hi'),
      { kind: 'wait', minutes: 30 },
      { kind: 'powerDown' },
      'idle',
    ]);
  });

  it('advances exec past the block it acts on', () => {
    const step = stepProgram(BASE, running(prog([b.move(), b.water()])));
    expect(step).toEqual({
      kind: 'act',
      action: MOVE,
      exec: { ...startStack(freshExec(prog([])), 0), frames: [{ kind: 'list', list: { root: 'stack', index: 0, path: [] }, next: 1, loop: null }] },
      gaveUp: [],
    });
  });

  it('trims and cuts what it says, and says "…" for blank text', () => {
    const long = 'x'.repeat(ROBOTS.sayMaxLength + 10);
    expect(actions([b.say('  Hello  '), b.say(long), b.say('   '), b.say(b.v('t'))], [b.textVar('t', ' from a var ')])).toEqual([
      say('Hello'),
      say('x'.repeat(ROBOTS.sayMaxLength)),
      say('…'),
      say('from a var'),
      'idle',
    ]);
  });

  it('clamps wait to 1 … maxWaitMinutes and reads expressions', () => {
    expect(actions([b.wait(0), b.wait(ROBOTS.maxWaitMinutes + 1), b.wait(b.add(b.v('n'), b.n(5)))], [b.numVar('n', 10)])).toEqual([
      { kind: 'wait', minutes: 1 },
      { kind: 'wait', minutes: ROBOTS.maxWaitMinutes },
      { kind: 'wait', minutes: 15 },
      'idle',
    ]);
  });

  it('takes the item an item variable holds', () => {
    expect(actions([b.take(b.v('what'))], [b.itemVar('what', 'parsnip_seeds')])).toEqual([{ kind: 'take', itemId: 'parsnip_seeds' }, 'idle']);
  });
});

describe('loops and branches', () => {
  it('repeats n times: 0 skips, 1 and 3 run that often', () => {
    expect(actions([b.repeat(0, b.move()), b.turn('right')])).toEqual([RIGHT, 'idle']);
    expect(actions([b.repeat(1, b.move()), b.turn('right')])).toEqual([MOVE, RIGHT, 'idle']);
    expect(actions([b.repeat(3, b.move()), b.turn('right')])).toEqual([MOVE, MOVE, MOVE, RIGHT, 'idle']);
  });

  it('evaluates the repeat count once', () => {
    const { outcomes, robot } = play(BASE, running(prog([b.repeat(b.v('n'), b.change('n', 1), b.move())], [b.numVar('n', 2)])));
    expect(outcomes).toEqual([MOVE, MOVE, 'idle']);
    expect(must(robot.exec).vars).toEqual([{ type: 'number', value: 4 }]);
  });

  it('tests Repeat until before every iteration, the first included', () => {
    expect(actions([b.repeatUntil(b.yes(true), b.move()), b.turn('right')])).toEqual([RIGHT, 'idle']);
    expect(actions([b.repeatUntil(b.eq(b.v('n'), b.n(3)), b.change('n', 1), b.move())], [b.numVar('n', 0)])).toEqual([MOVE, MOVE, MOVE, 'idle']);
  });

  it('repeats forever', () => {
    const { outcomes } = play(BASE, running(prog([b.forever(b.turn('right'))])), 10);
    expect(outcomes).toEqual(Array.from({ length: 10 }, () => RIGHT));
  });

  it('takes then or else, and skips an if without else', () => {
    expect(actions([b.if(b.yes(true), [b.turn('left')], [b.turn('right')])])).toEqual([LEFT, 'idle']);
    expect(actions([b.if(b.yes(false), [b.turn('left')], [b.turn('right')])])).toEqual([RIGHT, 'idle']);
    expect(actions([b.if(b.yes(false), [b.turn('left')]), b.move()])).toEqual([MOVE, 'idle']);
  });

  it('resumes nested loops across minutes', () => {
    expect(actions([b.repeat(2, b.repeat(2, b.turn('left')), b.turn('right')), b.move()])).toEqual([LEFT, LEFT, RIGHT, LEFT, LEFT, RIGHT, MOVE, 'idle']);
  });

  it('saves its place in a nested loop as frames', () => {
    const program = prog([b.repeat(2, b.if(b.yes(true), [b.turn('left'), b.move()]))]);
    const step = stepProgram(BASE, running(program));
    expect(step.kind === 'act' && step.exec.frames).toEqual([
      { kind: 'list', list: { root: 'stack', index: 0, path: [] }, next: 1, loop: null },
      { kind: 'list', list: { root: 'stack', index: 0, path: [[0, 'body']] }, next: 1, loop: { kind: 'times', left: 1 } },
      { kind: 'list', list: { root: 'stack', index: 0, path: [[0, 'body'], [0, 'then']] }, next: 1, loop: null },
    ]);
  });
});

describe('variables and helpers', () => {
  it('sets and changes variables, clamping numbers to ±maxNumber', () => {
    const vars = [b.numVar('n', ROBOTS.maxNumber - 10), b.textVar('t', 'hi')];
    const { robot } = play(BASE, running(prog([b.change('n', 100), b.set('t', b.text('bye')), b.move()], vars)), 1);
    expect(must(robot.exec).vars).toEqual([
      { type: 'number', value: ROBOTS.maxNumber },
      { type: 'text', value: 'bye' },
    ]);
    const low = play(BASE, running(prog([b.set('n', b.sub(b.n(-ROBOTS.maxNumber), b.n(5))), b.move()], vars)), 1).robot;
    expect(must(low.exec).vars[0]).toEqual({ type: 'number', value: -ROBOTS.maxNumber });
  });

  it('calls helpers, nested, and returns to the caller', () => {
    const helpers = [b.helper('outer', b.turn('left'), b.run('inner'), b.turn('left')), b.helper('inner', b.turn('right'))];
    expect(actions([b.run('outer'), b.move()], [], helpers)).toEqual([LEFT, RIGHT, LEFT, MOVE, 'idle']);
  });

  it('keeps a helper frame on the stack mid-helper', () => {
    const helpers = [b.helper('spin', b.turn('left'), b.turn('left'))];
    const step = stepProgram(BASE, running(prog([b.run('spin')], [], helpers)));
    expect(step.kind === 'act' && step.exec.frames).toEqual([
      { kind: 'list', list: { root: 'stack', index: 0, path: [] }, next: 1, loop: null },
      { kind: 'list', list: { root: 'helper', index: 0, path: [] }, next: 1, loop: null },
    ]);
  });

  it('goes idle when the stack ends: no frames, nothing running', () => {
    const { outcomes, robot } = play(BASE, running(prog([b.move()])));
    expect(outcomes).toEqual([MOVE, 'idle']);
    expect(must(robot.exec)).toMatchObject({ running: null, frames: [] });
  });
});

describe('the step budget', () => {
  const frees = (count: number): Statement[] => Array.from({ length: count }, () => b.change('n', 1));
  const n = [b.numVar('n', 0)];

  it(`acts after ${ROBOTS.stepBudget - 1} free blocks, and is dizzy at ${ROBOTS.stepBudget}`, () => {
    expect(stepProgram(BASE, running(prog([...frees(ROBOTS.stepBudget - 1), b.move()], n))).kind).toBe('act');
    expect(stepProgram(BASE, running(prog([...frees(ROBOTS.stepBudget), b.move()], n)))).toEqual({ kind: 'dizzy' });
  });

  it('counts the loop statement and each further iteration', () => {
    // Repeat 24: 1 (the repeat) + 24 changes + 23 further iterations = 48 steps, then the move.
    expect(stepProgram(BASE, running(prog([b.repeat(24, b.change('n', 1)), b.move()], n))).kind).toBe('act');
    // Repeat 25: the 25th change is the 50th step.
    expect(stepProgram(BASE, running(prog([b.repeat(25, b.change('n', 1)), b.move()], n)))).toEqual({ kind: 'dizzy' });
  });

  it('gets dizzy in a Repeat forever with only free blocks, even an empty one', () => {
    expect(stepProgram(BASE, running(prog([b.forever(b.change('n', 1))], n)))).toEqual({ kind: 'dizzy' });
    expect(stepProgram(BASE, running(prog([b.forever()])))).toEqual({ kind: 'dizzy' });
  });

  it('starts a fresh budget every minute', () => {
    const program = prog([b.forever(...frees(30), b.move())], n);
    const { outcomes } = play(BASE, running(program), 5);
    expect(outcomes).toEqual([MOVE, MOVE, MOVE, MOVE, MOVE]);
  });
});

describe('expressions read the state passed in', () => {
  it('answers from the start-of-minute state and changes nothing', () => {
    const program = prog([b.if(b.soilIsDry(), [b.water()], [b.turn('left')])]);
    const dry = deepFreeze(withTile(BASE, TARGET, soilTile(TileState.Plowed), 'farm'));
    const robot = deepFreeze(running(program, { parts: ['wateringHead'], tank: 5 }));
    expect(stepProgram(dry, robot)).toMatchObject({ kind: 'act', action: { kind: 'water' } });
    expect(stepProgram(BASE, robot)).toMatchObject({ kind: 'act', action: LEFT });
    expect(stepProgram(dry, robot)).toMatchObject({ kind: 'act', action: { kind: 'water' } });
  });
});

describe('Go to', () => {
  it('turns, then moves one tile a minute, pops on arrival and carries on', () => {
    const { outcomes, robot } = play(BASE, running(prog([b.goTo(b.tileAt(7, 10)), b.say('Here')])));
    expect(outcomes).toEqual([LEFT, MOVE, MOVE, say('Here'), 'idle']);
    expect([robot.tx, robot.tz]).toEqual([7, 10]);
  });

  it('saves the route as a frame, dropping each tile it moves toward', () => {
    const robot = running(prog([b.goTo(b.tileAt(5, 13))]));
    const step = stepProgram(BASE, robot);
    expect(step).toEqual({
      kind: 'act',
      action: MOVE,
      exec: {
        ...must(robot.exec),
        frames: [
          { kind: 'list', list: { root: 'stack', index: 0, path: [] }, next: 1, loop: null },
          { kind: 'route', target: { tx: 5, tz: 13 }, path: [{ tx: 5, tz: 12 }, { tx: 5, tz: 13 }], why: 'goTo' },
        ],
      },
      gaveUp: [],
    });
  });

  it('re-plans when a rock lands on its next tile', () => {
    const first = running(prog([b.goTo(b.tileAt(5, 13))]));
    const moved = resolve(first, stepProgram(BASE, first));
    const rocky = rockAt(BASE, { tx: 5, tz: 12 });
    const step = stepProgram(rocky, moved);
    expect(step.kind === 'act' && step.action).toEqual(LEFT);
    expect(step.kind === 'act' && step.exec.frames[1]).toEqual({
      kind: 'route',
      target: { tx: 5, tz: 13 },
      path: [{ tx: 6, tz: 11 }, { tx: 6, tz: 12 }, { tx: 6, tz: 13 }, { tx: 5, tz: 13 }],
      why: 'goTo',
    });
    expect(play(rocky, moved).robot).toMatchObject({ tx: 5, tz: 13 });
  });

  it('re-plans from where it stands after being picked up and put down (review focus 2)', () => {
    const first = running(prog([b.goTo(b.tileAt(5, 13)), b.say('Here')]));
    const moved = resolve(first, stepProgram(BASE, first));
    const putDown = { ...moved, tx: 8, tz: 12, facing: Direction.North };
    const step = stepProgram(BASE, putDown);
    expect(step.kind === 'act' && step.exec.frames[1]).toEqual({
      kind: 'route',
      target: { tx: 5, tz: 13 },
      path: [{ tx: 8, tz: 13 }, { tx: 7, tz: 13 }, { tx: 6, tz: 13 }, { tx: 5, tz: 13 }],
      why: 'goTo',
    });
    expect(step.kind === 'act' && step.action).toEqual(RIGHT);
    const { outcomes, robot } = play(BASE, putDown);
    expect(outcomes.slice(-2)).toEqual([say('Here'), 'idle']);
    expect([robot.tx, robot.tz]).toEqual([5, 13]);
  });

  it('gives up on a tile it can never reach and moves on', () => {
    const walled = rockAt(BASE, { tx: 5, tz: 9 }, { tx: 6, tz: 10 }, { tx: 5, tz: 11 }, { tx: 4, tz: 10 });
    const step = stepProgram(walled, running(prog([b.goTo(b.tileAt(5, 13)), b.say('Stuck')])));
    expect(step).toMatchObject({ kind: 'act', action: say('Stuck'), gaveUp: [{ target: { tx: 5, tz: 13 }, why: 'goTo' }] });
  });

  it('finishes a Go to its own tile at once', () => {
    expect(actions([b.goTo(b.myTile()), b.say('Here')])).toEqual([say('Here'), 'idle']);
  });
});

describe('For each tile', () => {
  /** Zone A: x 4…6, z 12…13, south of TARGET (5, 10). */
  const ZONE = { x0: 4, z0: 12, w: 3, d: 2 };
  const zoned = withZones(BASE, { A: ZONE });
  const waterer = (state: GameState, md: MdCard[] = [], start: Partial<Robot> = {}) =>
    play(state, running(prog([b.forEach('A', b.water()), b.say('Done')]), { parts: ['wateringHead'], tank: 20, md, ...start }));
  const wateredAt = (result: ReturnType<typeof waterer>): TileCoord[] =>
    result.outcomes.flatMap((o, i) => (o !== 'idle' && o !== 'dizzy' && o.kind === 'water' ? [must(result.at[i])] : []));

  it('visits a 3×2 zone in snake order and runs its body on each tile', () => {
    const result = waterer(zoned);
    expect(wateredAt(result)).toEqual([
      { tx: 4, tz: 12 },
      { tx: 5, tz: 12 },
      { tx: 6, tz: 12 },
      { tx: 6, tz: 13 },
      { tx: 5, tz: 13 },
      { tx: 4, tz: 13 },
    ]);
    expect(result.outcomes.slice(-2)).toEqual([say('Done'), 'idle']);
    expect(result.gaveUp).toEqual([]);
  });

  it('skips tiles nobody can stand on', () => {
    expect(wateredAt(waterer(rockAt(zoned, { tx: 6, tz: 12 })))).toEqual([
      { tx: 4, tz: 12 },
      { tx: 5, tz: 12 },
      { tx: 6, tz: 13 },
      { tx: 5, tz: 13 },
      { tx: 4, tz: 13 },
    ]);
  });

  it('gives up on an unreachable tile, logs it, and carries on', () => {
    const boxed = rockAt(zoned, { tx: 6, tz: 12 }, { tx: 7, tz: 13 }, { tx: 6, tz: 14 }, { tx: 5, tz: 13 });
    const result = waterer(boxed);
    expect(wateredAt(result)).toEqual([
      { tx: 4, tz: 12 },
      { tx: 5, tz: 12 },
      { tx: 4, tz: 13 },
    ]);
    expect(result.gaveUp).toEqual([{ target: { tx: 6, tz: 13 }, why: 'forEach' }]);
    expect(result.outcomes.slice(-2)).toEqual([say('Done'), 'idle']);
  });

  it('does nothing for an empty zone', () => {
    expect(waterer(BASE).outcomes).toEqual([say('Done'), 'idle']);
  });

  it("gives up on a tile it could only reach by leaving its DON'T leave zone, never dizzy (review focus 5)", () => {
    const row = withZones(rockAt(BASE, { tx: 5, tz: 10 }), { A: { x0: 4, z0: 10, w: 3, d: 1 } });
    const result = waterer(row, [{ kind: 'dontLeave', zone: 'A' }], { tx: 4, tz: 10 });
    expect(result.outcomes).toEqual([{ kind: 'water' }, say('Done'), 'idle']);
    expect(result.gaveUp).toEqual([{ target: { tx: 6, tz: 10 }, why: 'forEach' }]);
  });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run tests/robotInterpret.test.ts`
Expected: FAIL — `Error: Cannot find module '../src/robots/interpret'`.

- [ ] **Step 3: Create `src/robots/interpret.ts`**

```ts
/**
 * The interpreter (farmclaws part 2 spec §5.1): walks a robot's saved frame stack until it
 * reaches one action, without changing the state. Pure.
 *
 * Step budget: each statement passed that isn't an action costs one step, and so does each
 * further iteration a loop starts (passing the loop statement starts its first iteration).
 * Expressions, route planning and finishing a route are free. Reaching ROBOTS.stepBudget
 * steps without an action makes the robot dizzy.
 */
import { ROBOTS } from '../config';
import { invariant } from '../core/invariant';
import type {
  ActionBlock,
  BlockProgram,
  Frame,
  GameState,
  ListRef,
  LoopState,
  Robot,
  RobotAction,
  RobotExec,
  Statement,
  TileCoord,
  Value,
} from '../core/types';
import { manhattanDistance } from '../world/grid';
import { getTile, isWalkable } from '../world/tiles';
import { clampNumber, evaluate, type EvalContext } from './eval';
import { resolveList } from './program';
import { canEnter, nextRouteAction, planRoute } from './route';
import { snakeTiles, zoneOf } from './zones';

/** A route the interpreter abandoned this turn, for the caller to log as `gaveUp`. */
export interface GaveUp {
  readonly target: TileCoord;
  readonly why: 'goTo' | 'forEach' | 'doReturn';
}

export type Step =
  | { readonly kind: 'act'; readonly action: RobotAction; readonly exec: RobotExec; readonly gaveUp: readonly GaveUp[] }
  | { readonly kind: 'idle'; readonly exec: RobotExec; readonly gaveUp: readonly GaveUp[] }
  | { readonly kind: 'dizzy' };

type ListFrame = Extract<Frame, { readonly kind: 'list' }>;
type RouteFrame = Extract<Frame, { readonly kind: 'route' }>;

/** Starts trigger stack `index`: running = index, frames = [list frame on the stack body]. */
export function startStack(exec: RobotExec, index: number): RobotExec {
  return { ...exec, running: index, frames: [{ kind: 'list', list: { root: 'stack', index, path: [] }, next: 0, loop: null }] };
}

function listOf(program: BlockProgram, ref: ListRef): readonly Statement[] {
  const list = resolveList(program, ref);
  invariant(list !== null, `frame list ${JSON.stringify(ref)} doesn't resolve`);
  return list;
}

function bodyFrame(parent: ListRef, statement: number, branch: 'body' | 'then' | 'else', loop: LoopState | null): ListFrame {
  return { kind: 'list', list: { root: parent.root, index: parent.index, path: [...parent.path, [statement, branch]] }, next: 0, loop };
}

function routeFrame(target: TileCoord, why: RouteFrame['why']): RouteFrame {
  return { kind: 'route', target, path: [], why };
}

/** The loop statement whose body the frame at `ref` walks. */
function loopStatement(program: BlockProgram, ref: ListRef): Statement {
  const last = ref.path[ref.path.length - 1];
  invariant(last !== undefined, 'a loop frame walks a loop body');
  const statement = listOf(program, { ...ref, path: ref.path.slice(0, -1) })[last[0]];
  invariant(statement !== undefined, 'a loop frame has a loop statement');
  return statement;
}

/** Index of the first tile at or after `from` a robot can stand on now, or -1. */
function nextStandable(state: GameState, tiles: readonly TileCoord[], from: number): number {
  for (let i = from; i < tiles.length; i++) {
    const coord = tiles[i];
    const tile = coord === undefined ? null : getTile(state.maps.farm, coord.tx, coord.tz);
    if (tile !== null && isWalkable(tile)) return i;
  }
  return -1;
}

function numberOf(value: Value): number {
  invariant(value.type === 'number', `expected a number, got ${value.type}`);
  return value.value;
}

function yesNoOf(value: Value): boolean {
  invariant(value.type === 'yesNo', `expected a yes/no, got ${value.type}`);
  return value.value;
}

/** A part 1 action from an action block, its sockets evaluated (spec §5.1 `do`). */
function toAction(block: ActionBlock, ctx: EvalContext): RobotAction {
  switch (block.kind) {
    case 'move':
    case 'water':
    case 'harvest':
    case 'till':
    case 'refill':
    case 'deposit':
    case 'powerDown':
      return { kind: block.kind };
    case 'turn':
      return { kind: 'turn', side: block.side };
    case 'plant':
      return { kind: 'plant', cropId: block.cropId };
    case 'take': {
      const item = evaluate(block.item, ctx);
      invariant(item.type === 'item', `take needs an item, got ${item.type}`);
      return { kind: 'take', itemId: item.value };
    }
    case 'say': {
      const text = evaluate(block.text, ctx);
      invariant(text.type === 'text', `say needs text, got ${text.type}`);
      const cut = Array.from(text.value.trim()).slice(0, ROBOTS.sayMaxLength).join('').trim();
      return { kind: 'say', text: cut === '' ? '…' : cut };
    }
    case 'wait': {
      const minutes = numberOf(evaluate(block.minutes, ctx));
      return { kind: 'wait', minutes: Math.max(1, Math.min(ROBOTS.maxWaitMinutes, minutes)) };
    }
  }
}

type RouteStep =
  | { readonly kind: 'arrived' }
  | { readonly kind: 'noRoute' }
  | { readonly kind: 'act'; readonly action: RobotAction; readonly frame: RouteFrame };

/**
 * One minute of a route. It re-plans when it has no path, or when the next path tile is no
 * longer next to the robot (it was blocked, or picked up and put down) or can no longer be
 * entered. A move drops the tile it heads for from the saved path.
 */
function stepRoute(state: GameState, robot: Robot, frame: RouteFrame): RouteStep {
  const here: TileCoord = { tx: robot.tx, tz: robot.tz };
  if (here.tx === frame.target.tx && here.tz === frame.target.tz) return { kind: 'arrived' };
  const next = frame.path[0];
  const usable = next !== undefined && manhattanDistance(here, next) === 1 && canEnter(state, robot, here, next);
  const path = usable ? frame.path : planRoute(state, robot, frame.target);
  if (path === null) return { kind: 'noRoute' };
  const first = path[0];
  invariant(first !== undefined, 'a route away from its target has a next tile');
  const action = nextRouteAction(robot, first);
  return { kind: 'act', action, frame: { ...frame, path: action.kind === 'move' ? path.slice(1) : path } };
}

/**
 * Walks `robot.exec` until it reaches an action (`act`), the running stack ends (`idle`), or
 * the step budget runs out (`dizzy`). Reads `state` and the robot as they are at the start of
 * the minute and changes neither; the returned exec is committed only when the turn resolves.
 */
export function stepProgram(state: GameState, robot: Robot): Step {
  const program = robot.program;
  const exec = robot.exec;
  invariant(program.kind === 'blocks' && exec !== null, `robot ${robot.id} has no block program to step`);
  const frames: Frame[] = exec.frames.slice();
  let vars = exec.vars;
  const gaveUp: GaveUp[] = [];
  let steps = 0;

  const ctx = (): EvalContext => ({ state, robot, program, vars });
  const snapshot = (): RobotExec => ({ ...exec, running: frames.length === 0 ? null : exec.running, frames: frames.slice(), vars });
  const spend = (): boolean => {
    steps++;
    return steps >= ROBOTS.stepBudget;
  };
  const setVar = (name: string, value: Value): void => {
    const index = program.vars.findIndex((decl) => decl.name === name);
    invariant(index !== -1, `unknown variable ${name}`);
    const next = vars.slice();
    next[index] = value.type === 'number' ? { type: 'number', value: clampNumber(value.value) } : value;
    vars = next;
  };

  for (;;) {
    const top = frames[frames.length - 1];
    if (top === undefined) return { kind: 'idle', exec: snapshot(), gaveUp };
    const at = frames.length - 1;

    if (top.kind === 'route') {
      const route = stepRoute(state, robot, top);
      if (route.kind === 'act') {
        frames[at] = route.frame;
        return { kind: 'act', action: route.action, exec: snapshot(), gaveUp };
      }
      frames.pop();
      if (route.kind === 'noRoute') {
        gaveUp.push({ target: top.target, why: top.why });
        const body = frames[frames.length - 1];
        // A `For each tile` skips the tile it couldn't reach: its body ends for that tile.
        if (top.why === 'forEach' && body !== undefined && body.kind === 'list') {
          frames[frames.length - 1] = { ...body, next: listOf(program, body.list).length };
        }
      }
      continue;
    }

    const list = listOf(program, top.list);
    const statement = list[top.next];

    if (statement === undefined) {
      const loop = top.loop;
      if (loop === null) {
        frames.pop();
        continue;
      }
      let again: LoopState | null;
      switch (loop.kind) {
        case 'times':
          again = loop.left > 0 ? { kind: 'times', left: loop.left - 1 } : null;
          break;
        case 'until': {
          const repeat = loopStatement(program, top.list);
          invariant(repeat.kind === 'repeatUntil', 'an until frame walks a Repeat until body');
          again = yesNoOf(evaluate(repeat.until, ctx())) ? null : loop;
          break;
        }
        case 'forever':
          again = loop;
          break;
        case 'forEach': {
          const i = nextStandable(state, loop.tiles, loop.i + 1);
          again = i === -1 ? null : { kind: 'forEach', tiles: loop.tiles, i };
          break;
        }
      }
      if (again === null) {
        frames.pop();
        continue;
      }
      if (spend()) return { kind: 'dizzy' };
      frames[at] = { ...top, next: 0, loop: again };
      if (again.kind === 'forEach') {
        const tile = again.tiles[again.i];
        invariant(tile !== undefined, 'a For each iteration has a tile');
        frames.push(routeFrame(tile, 'forEach'));
      }
      continue;
    }

    frames[at] = { ...top, next: top.next + 1 };
    if (statement.kind === 'do') return { kind: 'act', action: toAction(statement.action, ctx()), exec: snapshot(), gaveUp };
    if (spend()) return { kind: 'dizzy' };

    switch (statement.kind) {
      case 'repeatTimes': {
        const times = Math.max(0, Math.min(ROBOTS.maxRepeatTimes, numberOf(evaluate(statement.times, ctx()))));
        if (times > 0) frames.push(bodyFrame(top.list, top.next, 'body', { kind: 'times', left: times - 1 }));
        break;
      }
      case 'repeatUntil':
        if (!yesNoOf(evaluate(statement.until, ctx()))) frames.push(bodyFrame(top.list, top.next, 'body', { kind: 'until' }));
        break;
      case 'repeatForever':
        frames.push(bodyFrame(top.list, top.next, 'body', { kind: 'forever' }));
        break;
      case 'if':
        if (yesNoOf(evaluate(statement.cond, ctx()))) frames.push(bodyFrame(top.list, top.next, 'then', null));
        else if (statement.else !== null) frames.push(bodyFrame(top.list, top.next, 'else', null));
        break;
      case 'forEachTile': {
        const rect = zoneOf(state, statement.zone);
        const tiles = rect === null ? [] : snakeTiles(rect);
        const i = nextStandable(state, tiles, 0);
        const first = tiles[i];
        if (first !== undefined) {
          frames.push(bodyFrame(top.list, top.next, 'body', { kind: 'forEach', tiles, i }));
          frames.push(routeFrame(first, 'forEach'));
        }
        break;
      }
      case 'goTo': {
        const tile = evaluate(statement.tile, ctx());
        invariant(tile.type === 'tile', `Go to needs a tile, got ${tile.type}`);
        frames.push(routeFrame(tile.value, 'goTo'));
        break;
      }
      case 'set':
        setVar(statement.name, evaluate(statement.value, ctx()));
        break;
      case 'change': {
        const index = program.vars.findIndex((decl) => decl.name === statement.name);
        const current = vars[index];
        invariant(current !== undefined, `unknown variable ${statement.name}`);
        setVar(statement.name, { type: 'number', value: numberOf(current) + numberOf(evaluate(statement.by, ctx())) });
        break;
      }
      case 'runHelper': {
        const index = program.helpers.findIndex((helper) => helper.name === statement.name);
        invariant(index !== -1, `unknown helper ${statement.name}`);
        frames.push({ kind: 'list', list: { root: 'helper', index, path: [] }, next: 0, loop: null });
        break;
      }
    }
  }
}
```

- [ ] **Step 4: Run it and see it pass**

Run: `npx vitest run tests/robotInterpret.test.ts`
Expected: PASS (33 tests).

- [ ] **Step 5: The full gate**

Run: `npm run typecheck && npm test && npm run build`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/robots/interpret.ts tests/robotInterpret.test.ts
git commit -m "Farmclaws part 2: the interpreter, its frames and the step budget

Loop statements pay one step for their first iteration and one for each further one.
Route frames also re-plan when the next path tile can no longer be entered, so a
route move is never skipped by a DON'T card.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Turns — .MD precedence and triggers

**Files:**
- Create: `src/robots/turn.ts`
- Modify: `src/core/types.ts` (part 1 robot section: `ROBOT_LOG_EVENT_KINDS` and the `RobotLogEvent` union, about lines 618–637 on `v2`)
- Modify: `src/robots/md.ts` (append the DO half after Task 5's DON'T half; merge imports)
- Modify: `src/robots/exec.ts` (append `morningExec`; import `startStack`)
- Modify: `src/robots/logText.ts` (text for the new events, `triggerText`)
- Modify: `src/state/robotValidation.ts` (`isValidLogEvent` accepts the new events; about line 112 on `v2`). Not in the contract's file list, but without it a save holding any new event fails to load, which breaks Task 8's round trips (review focus 1).
- Test: `tests/robotTurn.test.ts`

**Interfaces:**
- Consumes:
  - Task 1: `Trigger`, `MdCard`, `RobotExec`, `Frame`, `BlockProgram`, `TileCoord`; `wakeCostFor(robot: RobotBody): number`; `ROBOTS.everyChoices`.
  - Task 2: `b` (`src/robots/blocks.ts`); `farmContains(tx: number, tz: number): boolean` (`src/robots/program.ts`).
  - Task 3: `freshExec(program: BlockProgram): RobotExec`; `Robot.exec / md / off`; `isMdShape(v: unknown): v is readonly MdCard[]` (`src/state/robotValidation.ts`); `withZones(state, zones)` and `robotOf` with `exec: null, md: [], off: null` (`tests/testUtils.ts`).
  - Task 5: `dontForbids(state: GameState, robot: Robot, action: RobotAction): MdCard | null`, `moveForbiddenBy(robot: Robot, from: TileCoord, to: TileCoord, state: GameState): MdCard | null`, `keptItems(robot: Robot): ReadonlySet<ItemId>`, `planRoute(state: GameState, robot: Robot, target: TileCoord): readonly TileCoord[] | null`, `nextRouteAction(robot: Pick<Robot, 'tx' | 'tz' | 'facing'>, next: TileCoord): RobotAction`.
  - Task 6: `stepProgram(state: GameState, robot: Robot): Step`, `startStack(exec: RobotExec, index: number): RobotExec`, `type GaveUp`, `type Step`.
- Produces:
  - `src/robots/exec.ts`: `export function morningExec(program: BlockProgram): RobotExec`
  - `src/robots/md.ts`: `export function powerDownCard(state: GameState, robot: Robot): MdCard | null`; `export function dueReturnCard(state: GameState, robot: Robot): { readonly card: MdCard; readonly index: number } | null`; `export function returnTarget(state: GameState, robot: Robot, card: MdCard): TileCoord | null`; `export function mdCardText(card: MdCard): string`; plus one extra export, `returnFrameOf(exec: RobotExec)` (the doReturn route frame under way, or null), shared by `md.ts` and `turn.ts`.
  - `src/robots/logText.ts`: `export function triggerText(trigger: Trigger): string`
  - `src/robots/turn.ts`: `export type Turn` (exactly as the contract) and `export function decideTurn(state: GameState, robot: Robot): Turn`
  - `src/core/types.ts`: the seven new `RobotLogEvent` members and their `ROBOT_LOG_EVENT_KINDS` entries (spec §2.7)

Rules this task fixes (they come from the spec; the code and tests pin them):
- A robot is **idle** when no stack runs and no frames are left (`running === null`, no doReturn route frame). The trigger checks run for an idle robot whatever its `power` says, so a robot that part 1's put-down resumed as `working` still behaves as idle.
- A `Power down` block ends the running stack: its committed exec has `running: null, frames: []`. So the robot is idle on standby and its triggers can wake it (spec §7 "Ending").
- A DO return that can't start (no generator, no route) fails at once, without a `started` line. One that fails part-way logs only `failed`. `conflict` names the first movement DON'T card (in .MD order) whose removal alone lets a route through, or the first movement DON'T card when it takes more than one. Only a failed return logs `conflict`, and `conflict` comes before `failed`.
- The DO return under way is always the first due DO return card not in `doneCards`. If the player edited the .MD mid-return and that card is gone, the return is dropped and the robot finishes (standby, `finished`).
- `generator` targets: breadth-first search from the robot's tile over the tiles `planRoute` may enter. For each wood burner in tile order (by `tz`, then `tx`), the first reached tile within `ROBOTS.chargeRadius`. The burner with the shortest route wins, and the earlier burner in tile order wins a tie.
- A DO return's route follows Task 6's route rule: it re-plans when its path is empty, or the next path tile isn't beside the robot or can no longer be entered (`canEnter`), so a return never walks into a rock that landed on its path and a route move is never skipped.

- [ ] **Step 1: Write the failing test `tests/robotTurn.test.ts`**

```ts
/**
 * One due minute of a block-program robot (farmclaws part 2 spec §6.1, §7): DO power down, DO
 * return, the program or the trigger checks, and the DON'T check, as exact Turn values. Also the
 * new log events' text and their save validation.
 */
import { describe, expect, it } from 'vitest';
import { Blocker, TileState, Weather, type BlockProgram, type GameState, type MdCard, type Robot, type RobotExec, type RobotLogEntry, type RobotLogEvent, type Tile, type TileCoord, type Trigger } from '../src/core/types';
import { b } from '../src/robots/blocks';
import { freshExec, morningExec } from '../src/robots/exec';
import { startStack, stepProgram } from '../src/robots/interpret';
import { logRobotEvent } from '../src/robots/log';
import { robotSays, triggerText, whatHappened } from '../src/robots/logText';
import { dueReturnCard, mdCardText, powerDownCard, returnTarget } from '../src/robots/md';
import { decideTurn } from '../src/robots/turn';
import { deserializeGame, serializeGame } from '../src/state/persistence';
import { blockedTile, EMPTY_TILE } from '../src/world/tiles';
import { BASE, TARGET, matureCrop, must, robotOf, soilTile, stack, withRobots, withTile, withZones } from './testUtils';

/** Zone A: x 3 … 7, z 9 … 12, around TARGET (5, 10) inside the clear zone. */
const ZONE_A = { x0: 3, z0: 9, w: 5, d: 4 };
const LEAVE_A: MdCard = { kind: 'dontLeave', zone: 'A' };
const NO_WATER: MdCard = { kind: 'dontGoIntoWater' };
const SPARE_PARSNIPS: MdCard = { kind: 'dontHarvest', cropId: 'parsnip' };
const KEEP_PARSNIPS: MdCard = { kind: 'dontDeposit', itemId: 'parsnip' };
const TO_GENERATOR: MdCard = { kind: 'doReturn', to: { kind: 'generator' }, minute: 1080 };
const returnTo = (tx: number, tz: number, minute = 1080): MdCard => ({ kind: 'doReturn', to: { kind: 'tile', tx, tz }, minute });
const downWhen = (when: Extract<MdCard, { readonly kind: 'doPowerDown' }>['when']): MdCard => ({ kind: 'doPowerDown', when });

const WATER = blockedTile(Blocker.Water);
const ROCK = blockedTile(Blocker.Rock);
const BURNER: Tile = { ...EMPTY_TILE, object: { kind: 'woodBurner', fuel: 0 } };

const SPIN = b.program({ stacks: [b.when(b.morning(), b.turn('right'))] });
const MOVER = b.program({ stacks: [b.when(b.morning(), b.forever(b.move()))] });

const at = (state: GameState, minute: number): GameState => ({ ...state, time: { ...state.time, minuteOfDay: minute } });
const withWeather = (state: GameState, weather: Weather): GameState => ({ ...state, weather });
const execOf = (robot: Robot): RobotExec => must(robot.exec);
const frame0 = (index: number, next: number) => ({ kind: 'list' as const, list: { root: 'stack' as const, index, path: [] }, next, loop: null });

/** A working robot that has just started stack 0 of `program`. */
function running(program: BlockProgram, overrides: Partial<Robot> = {}): Robot {
  return robotOf({ program, exec: startStack(freshExec(program), 0), ...overrides });
}

/** An idle robot on standby: no stack running. */
function idle(program: BlockProgram, overrides: Partial<Robot> = {}): Robot {
  return robotOf({ program, exec: freshExec(program), power: 'standby', ...overrides });
}

/** A robot part-way through a DO return to (5, 13) along `path`. */
function returning(path: readonly TileCoord[], overrides: Partial<Robot> = {}): Robot {
  const exec: RobotExec = { ...freshExec(SPIN), frames: [{ kind: 'route', target: { tx: 5, tz: 13 }, path, why: 'doReturn' }] };
  return robotOf({ program: SPIN, exec, md: [returnTo(5, 13)], ...overrides });
}

/** The exec the program's own step produces (the step must be an action). */
function stepped(state: GameState, robot: Robot): RobotExec {
  const step = stepProgram(state, robot);
  if (step.kind !== 'act') throw new Error(`expected an action, got ${step.kind}`);
  return step.exec;
}

const stoppedExec = (robot: Robot): RobotExec => ({ ...execOf(robot), running: null, frames: [] });

describe('decideTurn: the program', () => {
  it('runs the program when no card applies', () => {
    const robot = running(SPIN);
    expect(decideTurn(BASE, robot)).toEqual({
      kind: 'act',
      action: { kind: 'turn', side: 'right' },
      exec: { ...execOf(robot), frames: [frame0(0, 1)] },
      wakeCost: 0,
      keep: new Set(),
      events: [],
    });
  });

  it('finishes when the running stack ends, leaving no frames', () => {
    const robot = running(SPIN, { exec: { ...execOf(running(SPIN)), frames: [frame0(0, 1)] } });
    expect(decideTurn(BASE, robot)).toEqual({ kind: 'finish', exec: stoppedExec(robot), wakeCost: 0, events: [] });
  });

  it('ends the running stack on a Power down block, so triggers can wake it', () => {
    const program = b.program({ stacks: [b.when(b.morning(), b.powerDown())] });
    const robot = running(program);
    expect(decideTurn(BASE, robot)).toEqual({ kind: 'act', action: { kind: 'powerDown' }, exec: stoppedExec(robot), wakeCost: 0, keep: new Set(), events: [] });
  });

  it('goes dizzy on a loop of free blocks', () => {
    const program = b.program({ vars: [b.numVar('x', 0)], stacks: [b.when(b.morning(), b.forever(b.set('x', b.n(1))))] });
    expect(decideTurn(BASE, running(program))).toEqual({ kind: 'dizzy', wakeCost: 0, events: [] });
  });

  it('logs a route it gave up on before the action', () => {
    const program = b.program({ stacks: [b.when(b.morning(), b.goTo(b.tileAt(5, 13)), b.turn('left'))] });
    const state = withTile(BASE, { tx: 5, tz: 13 }, WATER, 'farm');
    const robot = running(program);
    expect(decideTurn(state, robot)).toEqual({
      kind: 'act',
      action: { kind: 'turn', side: 'left' },
      exec: stepped(state, robot),
      wakeCost: 0,
      keep: new Set(),
      events: [{ kind: 'gaveUp', target: { tx: 5, tz: 13 }, why: 'goTo' }],
    });
  });
});

describe('decideTurn: DO power down', () => {
  const shutBy = (robot: Robot, card: MdCard) => ({ kind: 'shutDown', exec: stoppedExec(robot), event: { kind: 'doPowerDown', card }, events: [] });

  it('powers down when the bag is full, and not before', () => {
    const card = downWhen({ kind: 'bagFull' });
    const full = running(SPIN, { md: [card], bag: [stack('parsnip', 1)] });
    expect(decideTurn(BASE, full)).toEqual(shutBy(full, card));
    expect(decideTurn(BASE, running(SPIN, { md: [card] })).kind).toBe('act');
  });

  it('powers down with fewer than n tokens, and not at exactly n', () => {
    const card = downWhen({ kind: 'tokensBelow', n: 10 });
    const low = running(SPIN, { md: [card], tokens: 9 });
    expect(decideTurn(BASE, low)).toEqual(shutBy(low, card));
    expect(decideTurn(BASE, running(SPIN, { md: [card], tokens: 10 })).kind).toBe('act');
  });

  it('powers down in rain and storm, not in sun or snow', () => {
    const card = downWhen({ kind: 'raining' });
    const robot = running(SPIN, { md: [card] });
    for (const weather of [Weather.Rain, Weather.Storm]) expect(decideTurn(withWeather(BASE, weather), robot)).toEqual(shutBy(robot, card));
    for (const weather of [Weather.Sunny, Weather.Snow]) expect(decideTurn(withWeather(BASE, weather), robot).kind).toBe('act');
  });

  it('wins over a due DO return and over the program, and applies to an idle robot too', () => {
    const card = downWhen({ kind: 'raining' });
    const robot = running(SPIN, { md: [returnTo(5, 13, 360), card] });
    expect(decideTurn(withWeather(BASE, Weather.Rain), robot)).toEqual(shutBy(robot, card));
    const resting = idle(SPIN, { md: [card] });
    const turn = decideTurn(withWeather(BASE, Weather.Rain), resting);
    if (turn.kind !== 'shutDown') throw new Error(`expected a shutDown, got ${turn.kind}`);
    expect(turn).toEqual(shutBy(resting, card));
    expect(turn.exec).toBe(resting.exec);
  });

  it('finds the first card whose condition holds', () => {
    const bag = downWhen({ kind: 'bagFull' });
    const tokens = downWhen({ kind: 'tokensBelow', n: 50 });
    expect(powerDownCard(BASE, running(SPIN, { md: [bag, tokens], tokens: 20 }))).toBe(tokens);
    expect(powerDownCard(BASE, running(SPIN, { md: [bag, tokens] }))).toBeNull();
  });
});

describe('decideTurn: DO return', () => {
  const EVENING = at(BASE, 1080);

  it('starts at its minute: replaces the frames with a route, logs started and takes the first step', () => {
    const card = returnTo(5, 13);
    const robot = running(SPIN, { md: [card] });
    expect(decideTurn(EVENING, robot)).toEqual({
      kind: 'act',
      action: { kind: 'move' },
      exec: { ...execOf(robot), running: null, frames: [{ kind: 'route', target: { tx: 5, tz: 13 }, path: [{ tx: 5, tz: 12 }, { tx: 5, tz: 13 }], why: 'doReturn' }] },
      wakeCost: 0,
      keep: new Set(),
      events: [{ kind: 'doReturn', card, phase: 'started' }],
    });
    expect(decideTurn(at(BASE, 1079), robot)).toMatchObject({ kind: 'act', action: { kind: 'turn', side: 'right' }, events: [] });
  });

  it('continues along its path, turning first when it faces the wrong way', () => {
    const onward = returning([{ tx: 5, tz: 12 }, { tx: 5, tz: 13 }], { tz: 11 });
    expect(decideTurn(EVENING, onward)).toEqual({
      kind: 'act',
      action: { kind: 'move' },
      exec: { ...execOf(onward), frames: [{ kind: 'route', target: { tx: 5, tz: 13 }, path: [{ tx: 5, tz: 13 }], why: 'doReturn' }] },
      wakeCost: 0,
      keep: new Set(),
      events: [],
    });
    const sideways = returning([{ tx: 5, tz: 11 }, { tx: 5, tz: 12 }, { tx: 5, tz: 13 }], { facing: 1 });
    expect(decideTurn(EVENING, sideways)).toEqual({
      kind: 'act',
      action: { kind: 'turn', side: 'right' },
      exec: execOf(sideways),
      wakeCost: 0,
      keep: new Set(),
      events: [],
    });
  });

  it('re-plans from where it stands when the next path tile is not beside it', () => {
    const carried = returning([{ tx: 5, tz: 12 }, { tx: 5, tz: 13 }]);
    expect(decideTurn(EVENING, carried)).toMatchObject({
      kind: 'act',
      action: { kind: 'move' },
      exec: { frames: [{ kind: 'route', path: [{ tx: 5, tz: 12 }, { tx: 5, tz: 13 }] }] },
    });
  });

  it('re-plans when its next tile can no longer be entered, instead of walking into it', () => {
    const robot = returning([{ tx: 5, tz: 12 }, { tx: 5, tz: 13 }], { tz: 11 });
    expect(decideTurn(withTile(EVENING, { tx: 5, tz: 12 }, ROCK, 'farm'), robot)).toEqual({
      kind: 'act',
      action: { kind: 'turn', side: 'left' },
      exec: {
        ...execOf(robot),
        frames: [{ kind: 'route', target: { tx: 5, tz: 13 }, path: [{ tx: 6, tz: 11 }, { tx: 6, tz: 12 }, { tx: 6, tz: 13 }, { tx: 5, tz: 13 }], why: 'doReturn' }],
      },
      wakeCost: 0,
      keep: new Set(),
      events: [],
    });
  });

  it('arrives: standby for the day, the card in doneCards', () => {
    const home = returning([], { tz: 13 });
    expect(decideTurn(EVENING, home)).toEqual({
      kind: 'shutDown',
      exec: { ...freshExec(SPIN), doneCards: [0] },
      event: { kind: 'doReturn', card: returnTo(5, 13), phase: 'arrived' },
      events: [],
    });
  });

  it('is carried out once a day: doneCards lets the program run', () => {
    const robot = running(SPIN, { md: [returnTo(5, 13)], exec: { ...execOf(running(SPIN)), doneCards: [0] } });
    expect(dueReturnCard(at(BASE, 1100), robot)).toBeNull();
    expect(decideTurn(at(BASE, 1100), robot)).toMatchObject({ kind: 'act', action: { kind: 'turn', side: 'right' } });
  });

  it('names the first due card and its index, and nothing while a return is under way', () => {
    const card = returnTo(5, 13);
    expect(dueReturnCard(EVENING, running(SPIN, { md: [LEAVE_A, card] }))).toEqual({ card, index: 1 });
    expect(dueReturnCard(at(BASE, 1079), running(SPIN, { md: [LEAVE_A, card] }))).toBeNull();
    expect(dueReturnCard(EVENING, returning([]))).toBeNull();
  });

  it('fails with no generator on the farm, and with no way to the tile', () => {
    const toGenerator = running(SPIN, { md: [TO_GENERATOR] });
    expect(decideTurn(EVENING, toGenerator)).toEqual({
      kind: 'shutDown',
      exec: stoppedExec(toGenerator),
      event: { kind: 'doReturn', card: TO_GENERATOR, phase: 'failed' },
      events: [],
    });
    const toWater = running(SPIN, { md: [returnTo(5, 13)] });
    expect(decideTurn(withTile(EVENING, { tx: 5, tz: 13 }, WATER, 'farm'), toWater)).toEqual({
      kind: 'shutDown',
      exec: stoppedExec(toWater),
      event: { kind: 'doReturn', card: returnTo(5, 13), phase: 'failed' },
      events: [],
    });
  });

  it('fails part-way when the way is gone, without logging started again', () => {
    const robot = returning([{ tx: 5, tz: 12 }, { tx: 5, tz: 13 }]);
    expect(decideTurn(withTile(EVENING, { tx: 5, tz: 13 }, WATER, 'farm'), robot)).toEqual({
      kind: 'shutDown',
      exec: freshExec(SPIN),
      event: { kind: 'doReturn', card: returnTo(5, 13), phase: 'failed' },
      events: [],
    });
  });

  it('logs a conflict naming both cards when a DON’T is what stops it', () => {
    const card = returnTo(5, 14);
    const robot = running(SPIN, { md: [LEAVE_A, card] });
    expect(decideTurn(withZones(EVENING, { A: ZONE_A }), robot)).toEqual({
      kind: 'shutDown',
      exec: stoppedExec(robot),
      event: { kind: 'doReturn', card, phase: 'failed' },
      events: [{ kind: 'conflict', doCard: card, dontCard: LEAVE_A }],
    });
  });

  it('targets the generator nearest by route length, then the burner first in tile order', () => {
    const robot = running(SPIN, { md: [TO_GENERATOR] });
    const two = withTile(withTile(EVENING, { tx: 5, tz: 15 }, BURNER, 'farm'), { tx: 11, tz: 10 }, BURNER, 'farm');
    expect(returnTarget(two, robot, TO_GENERATOR)).toEqual({ tx: 5, tz: 13 });
    expect(decideTurn(two, robot)).toMatchObject({ kind: 'act', exec: { frames: [{ target: { tx: 5, tz: 13 } }] } });
    let walled = two;
    for (let tx = 3; tx <= 7; tx++) walled = withTile(walled, { tx, tz: 12 }, ROCK, 'farm');
    expect(returnTarget(walled, robot, TO_GENERATOR)).toEqual({ tx: 9, tz: 10 });
    // Both burners are two moves away; (1, 10) comes first in tile order although (5, 12) is found first.
    const tied = withTile(withTile(EVENING, { tx: 1, tz: 10 }, BURNER, 'farm'), { tx: 5, tz: 14 }, BURNER, 'farm');
    expect(returnTarget(tied, robot, TO_GENERATOR)).toEqual({ tx: 3, tz: 10 });
    expect(returnTarget(EVENING, robot, TO_GENERATOR)).toBeNull();
  });
});

describe('decideTurn: DON’T cards', () => {
  it('skips a move out of a DON’T leave zone, and allows one inside it', () => {
    const state = withZones(BASE, { A: ZONE_A });
    const edge = running(MOVER, { tz: 12, md: [LEAVE_A] });
    expect(decideTurn(state, edge)).toEqual({ kind: 'skip', action: { kind: 'move' }, card: LEAVE_A, exec: stepped(state, edge), wakeCost: 0, events: [] });
    expect(decideTurn(state, running(MOVER, { tz: 11, md: [LEAVE_A] })).kind).toBe('act');
  });

  it('skips a move into water, and allows it without the card', () => {
    const state = withTile(BASE, { tx: 5, tz: 11 }, WATER, 'farm');
    const robot = running(MOVER, { md: [NO_WATER] });
    expect(decideTurn(state, robot)).toEqual({ kind: 'skip', action: { kind: 'move' }, card: NO_WATER, exec: stepped(state, robot), wakeCost: 0, events: [] });
    expect(decideTurn(state, running(MOVER)).kind).toBe('act');
  });

  it('skips harvesting the named crop only', () => {
    const program = b.program({ stacks: [b.when(b.morning(), b.harvest())] });
    const robot = running(program, { md: [SPARE_PARSNIPS] });
    const parsnip = withTile(BASE, TARGET, soilTile(TileState.Watered, matureCrop('parsnip')), 'farm');
    expect(decideTurn(parsnip, robot)).toEqual({ kind: 'skip', action: { kind: 'harvest' }, card: SPARE_PARSNIPS, exec: stepped(parsnip, robot), wakeCost: 0, events: [] });
    const potato = withTile(BASE, TARGET, soilTile(TileState.Watered, matureCrop('potato')), 'farm');
    expect(decideTurn(potato, robot).kind).toBe('act');
  });

  it('skips a deposit of only kept items, and deposits the rest with the kept set', () => {
    const program = b.program({ stacks: [b.when(b.morning(), b.deposit())] });
    const keeper = running(program, { size: 'standard', md: [KEEP_PARSNIPS], bag: [stack('parsnip', 3)] });
    expect(decideTurn(BASE, keeper)).toEqual({ kind: 'skip', action: { kind: 'deposit' }, card: KEEP_PARSNIPS, exec: stepped(BASE, keeper), wakeCost: 0, events: [] });
    const mixed = { ...keeper, bag: [stack('parsnip', 3), stack('potato', 2)] };
    expect(decideTurn(BASE, mixed)).toEqual({ kind: 'act', action: { kind: 'deposit' }, exec: stepped(BASE, mixed), wakeCost: 0, keep: new Set(['parsnip']), events: [] });
  });
});

describe('decideTurn: triggers', () => {
  /** A woken robot's turn: its first action, a turn, after the wake. */
  const woken = (exec: RobotExec, side: 'left' | 'right', trigger: Trigger) => ({
    kind: 'act',
    action: { kind: 'turn', side },
    exec,
    wakeCost: 1,
    keep: new Set(),
    events: [{ kind: 'woke', trigger }],
  });

  it('atTime fires once its minute has come, and only once a day', () => {
    const program = b.program({ stacks: [b.when(b.atTime(600), b.turn('left'))] });
    const robot = idle(program);
    expect(decideTurn(at(BASE, 599), robot)).toEqual({ kind: 'wait' });
    for (const minute of [600, 650]) {
      expect(decideTurn(at(BASE, minute), robot)).toEqual(
        woken({ ...execOf(robot), due: [null], running: 0, frames: [frame0(0, 1)] }, 'left', b.atTime(600)),
      );
    }
    expect(decideTurn(at(BASE, 700), idle(program, { exec: { ...freshExec(program), due: [null] } }))).toEqual({ kind: 'wait' });
  });

  it('every n fires when its due minute has come; the next due is this minute + n', () => {
    const program = b.program({ stacks: [b.when(b.every(15), b.turn('right'))] });
    const robot = idle(program);
    expect(execOf(robot).due).toEqual([375]);
    expect(decideTurn(at(BASE, 374), robot)).toEqual({ kind: 'wait' });
    expect(decideTurn(at(BASE, 375), robot)).toEqual(woken({ ...execOf(robot), due: [390], running: 0, frames: [frame0(0, 1)] }, 'right', b.every(15)));
    expect(decideTurn(at(BASE, 377), robot)).toEqual(woken({ ...execOf(robot), due: [392], running: 0, frames: [frame0(0, 1)] }, 'right', b.every(15)));
  });

  it('bagFull fires on a full bag, once a day', () => {
    const program = b.program({ stacks: [b.when(b.bagFull(), b.turn('right'))] });
    const full = idle(program, { bag: [stack('parsnip', 1)] });
    expect(decideTurn(BASE, full)).toEqual(
      woken({ ...execOf(full), firedToday: [true], running: 0, frames: [frame0(0, 1)] }, 'right', b.bagFull()),
    );
    expect(decideTurn(BASE, idle(program))).toEqual({ kind: 'wait' });
    expect(decideTurn(BASE, { ...full, exec: { ...execOf(full), firedToday: [true] } })).toEqual({ kind: 'wait' });
  });

  it('startsRaining fires in rain and storm, once a day, never in sun or snow', () => {
    const program = b.program({ stacks: [b.when(b.startsRaining(), b.turn('right'))] });
    const robot = idle(program);
    for (const weather of [Weather.Rain, Weather.Storm]) {
      expect(decideTurn(withWeather(BASE, weather), robot)).toEqual(
        woken({ ...execOf(robot), firedToday: [true], running: 0, frames: [frame0(0, 1)] }, 'right', b.startsRaining()),
      );
    }
    for (const weather of [Weather.Sunny, Weather.Snow]) expect(decideTurn(withWeather(BASE, weather), robot)).toEqual({ kind: 'wait' });
    expect(decideTurn(withWeather(BASE, Weather.Rain), { ...robot, exec: { ...execOf(robot), firedToday: [true] } })).toEqual({ kind: 'wait' });
  });

  it('never fires morning from idle', () => {
    expect(decideTurn(at(BASE, 600), idle(SPIN))).toEqual({ kind: 'wait' });
  });

  it('starts only the first stack that fires, in program order', () => {
    const program = b.program({ stacks: [b.when(b.every(15), b.turn('right')), b.when(b.atTime(400), b.turn('left'))] });
    const turn = decideTurn(at(BASE, 400), idle(program));
    expect(turn).toMatchObject({ kind: 'act', action: { kind: 'turn', side: 'right' }, exec: { running: 0, due: [415, 400] } });
  });

  it('fires only when idle: a running stack is never interrupted', () => {
    const program = b.program({ stacks: [b.when(b.morning(), b.wait(30)), b.when(b.every(5), b.move())] });
    expect(decideTurn(at(BASE, 400), running(program))).toMatchObject({ kind: 'act', action: { kind: 'wait', minutes: 30 }, wakeCost: 0, events: [] });
  });

  it('charges the wake scaled by size and the efficient core', () => {
    const program = b.program({ stacks: [b.when(b.every(5), b.turn('right'))] });
    const cases: readonly [Partial<Robot>, number][] = [
      [{ size: 'mini' }, 1],
      [{ size: 'standard' }, 2],
      [{ size: 'big' }, 4],
      [{ size: 'big', parts: ['efficientCore'] }, 3],
    ];
    for (const [body, cost] of cases) expect(decideTurn(at(BASE, 365), idle(program, body))).toMatchObject({ kind: 'act', wakeCost: cost });
  });

  it('finishes at once when the woken stack holds no action, keeping what it did', () => {
    const program = b.program({ vars: [b.numVar('x', 0)], stacks: [b.when(b.every(15), b.set('x', b.n(7)))] });
    const robot = idle(program);
    expect(decideTurn(at(BASE, 375), robot)).toEqual({
      kind: 'finish',
      exec: { ...execOf(robot), due: [390], vars: [{ type: 'number', value: 7 }] },
      wakeCost: 1,
      events: [{ kind: 'woke', trigger: { kind: 'every', minutes: 15 } }],
    });
  });
});

describe('morningExec', () => {
  it('starts the first morning stack, or stays idle without one', () => {
    const program = b.program({ stacks: [b.when(b.atTime(600), b.turn('left')), b.when(b.morning(), b.move()), b.when(b.morning(), b.turn('right'))] });
    expect(morningExec(program)).toEqual(startStack(freshExec(program), 1));
    const none = b.program({ stacks: [b.when(b.every(30), b.move())] });
    expect(morningExec(none)).toEqual(freshExec(none));
  });
});

describe('log text for the language', () => {
  const entry = (event: RobotLogEvent): RobotLogEntry => ({ id: 0, day: 0, minute: 400, robotId: 1, tx: 5, tz: 10, event, count: 1 });
  const names = new Map([[1, 'Sprocket']]);
  const lines = (event: RobotLogEvent): [string, string] => [robotSays(entry(event)), whatHappened(entry(event), names)];

  it('names every card and trigger in plain words', () => {
    expect([LEAVE_A, NO_WATER, SPARE_PARSNIPS, KEEP_PARSNIPS, TO_GENERATOR, returnTo(5, 13, 1095)].map(mdCardText)).toEqual([
      'leave Zone A',
      'go into water',
      'harvest Parsnip',
      'deposit Parsnip',
      'return to the nearest generator at 6:00 pm',
      'return to (5, 13) at 6:15 pm',
    ]);
    expect([downWhen({ kind: 'bagFull' }), downWhen({ kind: 'tokensBelow', n: 20 }), downWhen({ kind: 'raining' })].map(mdCardText)).toEqual([
      'power down when my bag is full',
      'power down when I have fewer than 20 tokens',
      'power down when it rains',
    ]);
    expect([b.morning(), b.atTime(845), b.bagFull(), b.startsRaining(), b.every(15)].map(triggerText)).toEqual([
      'morning came',
      "it's 2:05 pm",
      'my bag is full',
      'it started raining',
      'every 15 minutes',
    ]);
  });

  it('gives every new event both lines', () => {
    expect(lines({ kind: 'skipped', action: 'move', card: LEAVE_A })).toEqual(['Following my rules ✓', "Skipped move: my .MD says don't leave Zone A."]);
    expect(lines({ kind: 'dizzy' })).toEqual(['Thinking very hard ✓', 'Looped without doing anything, and got dizzy. Off until morning.']);
    expect(lines({ kind: 'gaveUp', target: { tx: 5, tz: 13 }, why: 'goTo' })).toEqual(['Took a scenic route ✓', "Couldn't find a way to (5, 13), so gave up going there."]);
    expect(lines({ kind: 'woke', trigger: b.every(15) })).toEqual(['Up and at it ✓', 'Woke up: every 15 minutes.']);
    expect(lines({ kind: 'doReturn', card: TO_GENERATOR, phase: 'started' })).toEqual([
      'Heading home ✓',
      'My .MD says return to the nearest generator at 6:00 pm, so I stopped my program and set off.',
    ]);
    expect(lines({ kind: 'doReturn', card: TO_GENERATOR, phase: 'arrived' })).toEqual(['Home safe ✓', 'Got there and powered down for the day.']);
    expect(lines({ kind: 'doReturn', card: TO_GENERATOR, phase: 'failed' })).toEqual([
      'Home safe ✓',
      "Couldn't get there (no generator I could reach), so powered down where I was.",
    ]);
    expect(lines({ kind: 'doReturn', card: returnTo(5, 13), phase: 'failed' })[1]).toBe("Couldn't get there (no way through), so powered down where I was.");
    expect(lines({ kind: 'doPowerDown', card: downWhen({ kind: 'raining' }) })).toEqual([
      'Powering down ✓',
      'Powered down for the day: my .MD says power down when it rains.',
    ]);
    expect(lines({ kind: 'conflict', doCard: returnTo(5, 14), dontCard: LEAVE_A })).toEqual([
      'Following my rules ✓',
      "My .MD says return to (5, 14) at 6:00 pm, but it also says don't leave Zone A. Don't wins.",
    ]);
  });

  it('saves and loads every new event, and rejects a malformed one', () => {
    const events: readonly RobotLogEvent[] = [
      { kind: 'skipped', action: 'harvest', card: SPARE_PARSNIPS },
      { kind: 'dizzy' },
      { kind: 'gaveUp', target: { tx: 5, tz: 13 }, why: 'forEach' },
      { kind: 'woke', trigger: b.atTime(600) },
      { kind: 'doReturn', card: TO_GENERATOR, phase: 'started' },
      { kind: 'doPowerDown', card: downWhen({ kind: 'tokensBelow', n: 5 }) },
      { kind: 'conflict', doCard: returnTo(5, 14), dontCard: LEAVE_A },
    ];
    const logOf = (list: readonly RobotLogEvent[]): GameState => list.reduce((s, e) => logRobotEvent(s, 1, e), withRobots(BASE, [robotOf()]));
    const state = logOf(events);
    expect(deserializeGame(serializeGame(state))).toEqual(state);
    expect(deserializeGame(serializeGame(logOf([{ kind: 'skipped', action: 'move', card: returnTo(5, 13) }])))).toBeNull();
    expect(deserializeGame(serializeGame(logOf([{ kind: 'gaveUp', target: { tx: 99, tz: 0 }, why: 'goTo' }])))).toBeNull();
    expect(deserializeGame(serializeGame(logOf([{ kind: 'conflict', doCard: LEAVE_A, dontCard: LEAVE_A }])))).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run tests/robotTurn.test.ts`
Expected: FAIL. `Failed to resolve import "../src/robots/turn"`. The other new names (`morningExec`, `mdCardText`, `triggerText`, `dueReturnCard`) don't exist yet either.

- [ ] **Step 3: Add the new log events to `src/core/types.ts`**

In the part 1 robot section, extend `ROBOT_LOG_EVENT_KINDS`:

```ts
// old
  'poweredDown',
  'repaired',
] as const;

// new
  'poweredDown',
  'repaired',
  'skipped',
  'dizzy',
  'gaveUp',
  'woke',
  'doReturn',
  'doPowerDown',
  'conflict',
] as const;
```

and the end of the `RobotLogEvent` union:

```ts
// old
  | { readonly kind: 'poweredDown' }
  | { readonly kind: 'repaired' };

// new
  | { readonly kind: 'poweredDown' }
  | { readonly kind: 'repaired' }
  // Farmclaws part 2 (spec §2.7). Events carry the card itself, so the log stays true after an .MD edit.
  | { readonly kind: 'skipped'; readonly action: RobotActionKind; readonly card: MdCard }
  | { readonly kind: 'dizzy' }
  | { readonly kind: 'gaveUp'; readonly target: TileCoord; readonly why: 'goTo' | 'forEach' | 'doReturn' }
  | { readonly kind: 'woke'; readonly trigger: Trigger }
  | { readonly kind: 'doReturn'; readonly card: MdCard; readonly phase: 'started' | 'arrived' | 'failed' }
  | { readonly kind: 'doPowerDown'; readonly card: MdCard }
  | { readonly kind: 'conflict'; readonly doCard: MdCard; readonly dontCard: MdCard };
```

`MdCard`, `Trigger` and `TileCoord` are in the same file, so no import is needed. `logText.ts`'s two exhaustive switches stop compiling until Step 7.

- [ ] **Step 4: Append the DO half to `src/robots/md.ts`**

Make sure `md.ts` imports each of these names. Merge them into the import statements Task 5 already has, and never import a name twice:

```ts
import { ROBOTS } from '../config';
import { invariant } from '../core/invariant';
import { Blocker, DIRECTIONS, type Frame, type GameState, type MdCard, type Robot, type RobotExec, type TileCoord } from '../core/types';
import { CROPS } from '../farming/crops';
import { getItem } from '../items/items';
import { formatClock } from '../time/clock';
import { weatherWaters } from '../time/weather';
import { chebyshevDistance, stepTile } from '../world/grid';
import { forEachTile, getTile, isWalkable } from '../world/tiles';
import { bagStacks } from './stats';
```

Then append to the end of the file (`moveForbiddenBy` is Task 5's, in the same file):

```ts
// ---------------------------------------------------------------------------
// DO cards (farmclaws part 2 spec §6.1 steps 1 and 2) and card text (§11)
// ---------------------------------------------------------------------------

type RouteFrame = Extract<Frame, { readonly kind: 'route' }>;

/** The DO return under way, or null. During a return no stack runs and the only frame is its route (plan R1). */
export function returnFrameOf(exec: RobotExec): RouteFrame | null {
  const frame = exec.frames[0];
  if (exec.running !== null || exec.frames.length !== 1 || frame === undefined || frame.kind !== 'route') return null;
  return frame.why === 'doReturn' ? frame : null;
}

/** The first DO power-down card whose condition holds now (spec §6.1 step 1). */
export function powerDownCard(state: GameState, robot: Robot): MdCard | null {
  for (const card of robot.md) {
    if (card.kind !== 'doPowerDown') continue;
    const when = card.when;
    if (when.kind === 'bagFull' && robot.bag.length >= bagStacks(robot)) return card;
    if (when.kind === 'tokensBelow' && robot.tokens < when.n) return card;
    if (when.kind === 'raining' && weatherWaters(state.weather)) return card;
  }
  return null;
}

/**
 * The first DO return card whose minute has come and that wasn't carried out today, with its
 * index in the .MD (spec §6.1 step 2). Null while a return is already under way.
 */
export function dueReturnCard(state: GameState, robot: Robot): { readonly card: MdCard; readonly index: number } | null {
  const exec = robot.exec;
  if (exec === null || returnFrameOf(exec) !== null) return null;
  for (let index = 0; index < robot.md.length; index++) {
    const card = robot.md[index];
    if (card === undefined || card.kind !== 'doReturn') continue;
    if (card.minute <= state.time.minuteOfDay && !exec.doneCards.includes(index)) return { card, index };
  }
  return null;
}

/** A tile the robot can reach, and how many moves it takes. */
interface Reached {
  readonly tile: TileCoord;
  readonly steps: number;
}

/**
 * Every tile the robot can reach under its DON'T cards, breadth-first in DIRECTIONS order from
 * the tile it stands on (0 steps), so `steps` never decreases along the list. The entry rule is
 * planRoute's: walkable, not water, and allowed by moveForbiddenBy.
 */
function reachableTiles(state: GameState, robot: Robot): readonly Reached[] {
  const farm = state.maps.farm;
  const key = (c: TileCoord): number => c.tz * farm.grid.width + c.tx;
  const start: TileCoord = { tx: robot.tx, tz: robot.tz };
  const seen = new Set<number>([key(start)]);
  const order: Reached[] = [{ tile: start, steps: 0 }];
  for (let head = 0; head < order.length; head++) {
    const current = order[head];
    if (current === undefined) break;
    for (const direction of DIRECTIONS) {
      const next = stepTile(current.tile, direction);
      const tile = getTile(farm, next.tx, next.tz);
      if (tile === null || seen.has(key(next)) || !isWalkable(tile) || tile.blocker === Blocker.Water) continue;
      if (moveForbiddenBy(robot, current.tile, next, state) !== null) continue;
      seen.add(key(next));
      order.push({ tile: next, steps: current.steps + 1 });
    }
  }
  return order;
}

/** The farm's wood burners in tile order: by row (tz), then column (tx). */
function burnerTiles(state: GameState): readonly TileCoord[] {
  const burners: TileCoord[] = [];
  forEachTile(state.maps.farm, (tile, tx, tz) => {
    if (tile.object?.kind === 'woodBurner') burners.push({ tx, tz });
  });
  return burners.sort((a, b) => a.tz - b.tz || a.tx - b.tx);
}

/**
 * Where a DO return card sends the robot (spec §6.1 step 2): its tile, or for `generator` the
 * first tile within ROBOTS.chargeRadius of the wood burner nearest by route length (ties: the
 * burner first in tile order). Null when the farm has no burner or none can be reached.
 */
export function returnTarget(state: GameState, robot: Robot, card: MdCard): TileCoord | null {
  invariant(card.kind === 'doReturn', `returnTarget: a ${card.kind} card is not a DO return`);
  if (card.to.kind === 'tile') return { tx: card.to.tx, tz: card.to.tz };
  const burners = burnerTiles(state);
  if (burners.length === 0) return null;
  const reached = reachableTiles(state, robot);
  let best: Reached | null = null;
  for (const burner of burners) {
    const near = reached.find((r) => chebyshevDistance(r.tile, burner) <= ROBOTS.chargeRadius);
    if (near !== undefined && (best === null || near.steps < best.steps)) best = near;
  }
  return best === null ? null : best.tile;
}

/**
 * The card's dropdown sentence (spec §11): "leave Zone A", "go into water", "return to the
 * nearest generator at 6:00 pm". A DON'T card's text follows "don't"; a DO card's stands alone.
 */
export function mdCardText(card: MdCard): string {
  switch (card.kind) {
    case 'dontLeave':
      return `leave Zone ${card.zone}`;
    case 'dontGoIntoWater':
      return 'go into water';
    case 'dontHarvest':
      return `harvest ${CROPS[card.cropId].name}`;
    case 'dontDeposit':
      return `deposit ${getItem(card.itemId).name}`;
    case 'doReturn': {
      const where = card.to.kind === 'generator' ? 'the nearest generator' : `(${card.to.tx}, ${card.to.tz})`;
      return `return to ${where} at ${formatClock(card.minute, 1)}`;
    }
    case 'doPowerDown': {
      const when = card.when;
      if (when.kind === 'tokensBelow') return `power down when I have fewer than ${when.n} tokens`;
      return when.kind === 'bagFull' ? 'power down when my bag is full' : 'power down when it rains';
    }
  }
}
```

- [ ] **Step 5: Add `morningExec` to `src/robots/exec.ts`**

Add the import `import { startStack } from './interpret';`. The import cycle `exec.ts ↔ interpret.ts` is safe because each side only calls the other inside functions. Then append:

```ts
/**
 * A block program's exec at the morning reset (spec §7): fresh, with the first `morning` stack
 * started. Idle when the program has no `morning` stack.
 */
export function morningExec(program: BlockProgram): RobotExec {
  const exec = freshExec(program);
  const index = program.stacks.findIndex((stack) => stack.trigger.kind === 'morning');
  return index === -1 ? exec : startStack(exec, index);
}
```

- [ ] **Step 6: Create `src/robots/turn.ts`**

```ts
/**
 * One due minute of a block-program robot (farmclaws part 2 spec §6.1 and §7), in the fixed
 * order: DO power down, DO return, then the program (a running stack) or the trigger checks
 * (an idle robot), then the DON'T check on the chosen action. DON'T beats DO beats the program,
 * and nothing else decides. Pure: reads the start-of-minute state and says what should happen;
 * run.ts and execute.ts apply it.
 */
import { invariant } from '../core/invariant';
import type { BlockProgram, GameState, ItemId, MdCard, Robot, RobotAction, RobotExec, RobotLogEvent, TileCoord, Trigger } from '../core/types';
import { weatherWaters } from '../time/weather';
import { startStack, stepProgram, type GaveUp, type Step } from './interpret';
import { dontForbids, dueReturnCard, keptItems, powerDownCard, returnFrameOf, returnTarget } from './md';
import { canEnter, nextRouteAction, planRoute } from './route';
import { bagStacks, wakeCostFor } from './stats';

export type Turn =
  | { readonly kind: 'wait' } // idle, nothing fired: next check one period later, free
  | {
      readonly kind: 'act';
      readonly action: RobotAction;
      readonly exec: RobotExec;
      readonly wakeCost: number;
      readonly keep: ReadonlySet<ItemId>;
      readonly events: readonly RobotLogEvent[];
    }
  | {
      readonly kind: 'skip';
      readonly action: RobotAction;
      readonly card: MdCard;
      readonly exec: RobotExec;
      readonly wakeCost: number;
      readonly events: readonly RobotLogEvent[];
    }
  | { readonly kind: 'finish'; readonly exec: RobotExec; readonly wakeCost: number; readonly events: readonly RobotLogEvent[] }
  | { readonly kind: 'shutDown'; readonly exec: RobotExec; readonly event: RobotLogEvent; readonly events: readonly RobotLogEvent[] }
  | { readonly kind: 'dizzy'; readonly wakeCost: number; readonly events: readonly RobotLogEvent[] };

type Events = readonly RobotLogEvent[];

/** No stack running and no frames: what finishing or powering down leaves. The same exec when already so. */
function stopped(exec: RobotExec): RobotExec {
  return exec.running === null && exec.frames.length === 0 ? exec : { ...exec, running: null, frames: [] };
}

function gaveUpEvents(list: readonly GaveUp[]): Events {
  return list.map((g): RobotLogEvent => ({ kind: 'gaveUp', target: g.target, why: g.why }));
}

/** The DON'T check (spec §6.1 step 4): a forbidden action is skipped, naming the first card that forbade it. */
function checked(state: GameState, robot: Robot, action: RobotAction, exec: RobotExec, wakeCost: number, events: Events): Turn {
  const card = dontForbids(state, robot, action);
  if (card !== null) return { kind: 'skip', action, card, exec, wakeCost, events };
  return { kind: 'act', action, exec, wakeCost, keep: keptItems(robot), events };
}

/**
 * A program step as the robot's turn. A `Power down` block ends the running stack, so the robot
 * is idle on standby and its triggers can wake it again (spec §7).
 */
function fromStep(state: GameState, robot: Robot, step: Step, wakeCost: number, events: Events): Turn {
  switch (step.kind) {
    case 'dizzy':
      return { kind: 'dizzy', wakeCost, events };
    case 'idle':
      return { kind: 'finish', exec: stopped(step.exec), wakeCost, events: [...events, ...gaveUpEvents(step.gaveUp)] };
    case 'act': {
      const exec = step.action.kind === 'powerDown' ? stopped(step.exec) : step.exec;
      return checked(state, robot, step.action, exec, wakeCost, [...events, ...gaveUpEvents(step.gaveUp)]);
    }
  }
}

function withDue(exec: RobotExec, index: number, due: number | null): RobotExec {
  return { ...exec, due: exec.due.map((d, i) => (i === index ? due : d)) };
}

function withFired(exec: RobotExec, index: number): RobotExec {
  return { ...exec, firedToday: exec.firedToday.map((f, i) => i === index || f) };
}

/**
 * The first stack, in program order, whose trigger fires for an idle robot now, started, with
 * its `due` or `firedToday` spent (spec §7). `morning` never fires from idle. Null when none fires.
 */
function fire(state: GameState, robot: Robot, program: BlockProgram, exec: RobotExec): { readonly trigger: Trigger; readonly exec: RobotExec } | null {
  const minute = state.time.minuteOfDay;
  for (let i = 0; i < program.stacks.length; i++) {
    const stack = program.stacks[i];
    invariant(stack !== undefined, `fire: no stack ${i}`);
    const trigger = stack.trigger;
    const due = exec.due[i] ?? null;
    const fired = exec.firedToday[i] ?? false;
    switch (trigger.kind) {
      case 'atTime':
        if (due !== null && due <= minute) return { trigger, exec: startStack(withDue(exec, i, null), i) };
        break;
      case 'every':
        if (due !== null && due <= minute) return { trigger, exec: startStack(withDue(exec, i, minute + trigger.minutes), i) };
        break;
      case 'bagFull':
        if (!fired && robot.bag.length >= bagStacks(robot)) return { trigger, exec: startStack(withFired(exec, i), i) };
        break;
      case 'startsRaining':
        if (!fired && weatherWaters(state.weather)) return { trigger, exec: startStack(withFired(exec, i), i) };
        break;
      case 'morning':
        break;
    }
  }
  return null;
}

/**
 * The first movement DON'T card (in .MD order) that stands between the robot and a DO return's
 * goal: removing it alone lets a route through. When it takes more than one card, the first of
 * them. Null when the goal is out of reach even without them (spec §6.1 step 2, `conflict`).
 */
function blockingDont(state: GameState, robot: Robot, card: MdCard): MdCard | null {
  const reachable = (md: readonly MdCard[]): boolean => {
    const free = { ...robot, md };
    const target = returnTarget(state, free, card);
    return target !== null && planRoute(state, free, target) !== null;
  };
  const movement: readonly MdCard[] = robot.md.filter((c) => c.kind === 'dontLeave' || c.kind === 'dontGoIntoWater');
  if (movement.length === 0 || !reachable(robot.md.filter((c) => !movement.includes(c)))) return null;
  return movement.find((c) => reachable(robot.md.filter((other) => other !== c))) ?? movement[0] ?? null;
}

/** A DO return that can't go on: the robot powers down where it stands for the day. */
function failReturn(state: GameState, robot: Robot, exec: RobotExec, card: MdCard, events: Events): Turn {
  const dont = blockingDont(state, robot, card);
  const conflict: Events = dont === null ? [] : [{ kind: 'conflict', doCard: card, dontCard: dont }];
  return { kind: 'shutDown', exec: stopped(exec), event: { kind: 'doReturn', card, phase: 'failed' }, events: [...events, ...conflict] };
}

/** Whether the saved path's next tile is beside the robot and can still be entered (Task 6's route rule). */
function usableNext(state: GameState, robot: Robot, tile: TileCoord): boolean {
  const here: TileCoord = { tx: robot.tx, tz: robot.tz };
  return Math.abs(tile.tx - robot.tx) + Math.abs(tile.tz - robot.tz) === 1 && canEnter(state, robot, here, tile);
}

/**
 * One minute of a DO return whose route frame is `exec`'s only frame: arrive (standby, done for
 * the day, card in doneCards), fail, or take the next move or turn. The path is re-planned when
 * it is empty, or its next tile isn't beside the robot (it was blocked, or carried somewhere) or
 * can no longer be entered, so a route move is never skipped.
 */
function walkReturn(state: GameState, robot: Robot, exec: RobotExec, card: { readonly card: MdCard; readonly index: number }, events: Events): Turn {
  const frame = returnFrameOf(exec);
  invariant(frame !== null, `walkReturn: robot ${robot.id} is not returning`);
  if (robot.tx === frame.target.tx && robot.tz === frame.target.tz) {
    const done = { ...stopped(exec), doneCards: [...exec.doneCards, card.index] };
    return { kind: 'shutDown', exec: done, event: { kind: 'doReturn', card: card.card, phase: 'arrived' }, events };
  }
  const first = frame.path[0];
  const path = first !== undefined && usableNext(state, robot, first) ? frame.path : planRoute(state, robot, frame.target);
  const next = path?.[0];
  if (path === null || next === undefined) return failReturn(state, robot, exec, card.card, events);
  const action = nextRouteAction(robot, next);
  const rest = action.kind === 'move' ? path.slice(1) : path;
  return checked(state, robot, action, { ...exec, frames: [{ ...frame, path: rest }] }, 0, events);
}

/** A DO return card has come due: it replaces the frames with its route and logs `started`, or fails at once. */
function startReturn(state: GameState, robot: Robot, exec: RobotExec, card: { readonly card: MdCard; readonly index: number }): Turn {
  const target = returnTarget(state, robot, card.card);
  const path = target === null ? null : planRoute(state, robot, target);
  if (target === null || path === null) return failReturn(state, robot, exec, card.card, []);
  const started: RobotExec = { ...exec, running: null, frames: [{ kind: 'route', target, path, why: 'doReturn' }] };
  return walkReturn(state, robot, started, card, [{ kind: 'doReturn', card: card.card, phase: 'started' }]);
}

/**
 * What a due, non-off, uncarried block-program robot (working or idle) does this minute
 * (spec §6.1, §7). `events` are logged before the outcome, in order.
 */
export function decideTurn(state: GameState, robot: Robot): Turn {
  const program = robot.program;
  const exec = robot.exec;
  invariant(program.kind === 'blocks' && exec !== null, `decideTurn: robot ${robot.id} has no block program`);
  invariant(robot.off === null && !robot.carried, `decideTurn: robot ${robot.id} is off or carried`);

  const powerDown = powerDownCard(state, robot);
  if (powerDown !== null) return { kind: 'shutDown', exec: stopped(exec), event: { kind: 'doPowerDown', card: powerDown }, events: [] };

  const due = dueReturnCard(state, robot);
  if (due !== null) return startReturn(state, robot, exec, due);
  if (returnFrameOf(exec) !== null) {
    // The card under way is the first due one not yet done; it is missing only if the .MD was edited mid-return.
    const card = dueReturnCard(state, { ...robot, exec: stopped(exec) });
    if (card === null) return { kind: 'finish', exec: stopped(exec), wakeCost: 0, events: [] };
    return walkReturn(state, robot, exec, card, []);
  }

  if (exec.running !== null) return fromStep(state, robot, stepProgram(state, robot), 0, []);
  const woken = fire(state, robot, program, exec);
  if (woken === null) return { kind: 'wait' };
  const events: Events = [{ kind: 'woke', trigger: woken.trigger }];
  return fromStep(state, robot, stepProgram(state, { ...robot, exec: woken.exec }), wakeCostFor(robot), events);
}
```

- [ ] **Step 7: Text for the new events in `src/robots/logText.ts`**

Replace the imports:

```ts
// old
import type { RobotActionKind, RobotBlockReason, RobotLogEntry, RobotLogEvent } from '../core/types';
import { joinWithAnd, qualityPrefix } from '../core/text';
import { CROPS } from '../farming/crops';

// new
import type { MdCard, RobotActionKind, RobotBlockReason, RobotLogEntry, RobotLogEvent, Trigger } from '../core/types';
import { joinWithAnd, qualityPrefix } from '../core/text';
import { CROPS } from '../farming/crops';
import { formatClock } from '../time/clock';
import { mdCardText } from './md';
```

End of `robotSays`, plus the two new functions after it:

```ts
// old
    case 'repaired':
      return 'Good as new ✓';
  }
}

// new
    case 'repaired':
      return 'Good as new ✓';
    case 'skipped':
    case 'conflict':
      return 'Following my rules ✓';
    case 'dizzy':
      return 'Thinking very hard ✓';
    case 'gaveUp':
      return 'Took a scenic route ✓';
    case 'woke':
      return 'Up and at it ✓';
    case 'doReturn':
      return event.phase === 'started' ? 'Heading home ✓' : 'Home safe ✓';
    case 'doPowerDown':
      return 'Powering down ✓';
  }
}

/**
 * The trigger as the log names it (spec §11), e.g. "it's 2:00 pm", "my bag is full",
 * "every 15 minutes": the words after "Woke up:".
 */
export function triggerText(trigger: Trigger): string {
  switch (trigger.kind) {
    case 'morning':
      return 'morning came';
    case 'atTime':
      return `it's ${formatClock(trigger.minute, 1)}`;
    case 'bagFull':
      return 'my bag is full';
    case 'startsRaining':
      return 'it started raining';
    case 'every':
      return `every ${trigger.minutes} minutes`;
  }
}

/** What happened at each phase of a DO return. A failure names the likeliest reason from the card. */
function returnText(card: MdCard, phase: 'started' | 'arrived' | 'failed'): string {
  switch (phase) {
    case 'started':
      return `My .MD says ${mdCardText(card)}, so I stopped my program and set off.`;
    case 'arrived':
      return 'Got there and powered down for the day.';
    case 'failed': {
      const reason = card.kind === 'doReturn' && card.to.kind === 'generator' ? 'no generator I could reach' : 'no way through';
      return `Couldn't get there (${reason}), so powered down where I was.`;
    }
  }
}
```

End of `whatHappened`:

```ts
// old
    case 'repaired':
      return 'Came back from repairs.';
  }
}

// new
    case 'repaired':
      return 'Came back from repairs.';
    case 'skipped':
      return `Skipped ${VERB[event.action]}: my .MD says don't ${mdCardText(event.card)}.`;
    case 'dizzy':
      return 'Looped without doing anything, and got dizzy. Off until morning.';
    case 'gaveUp':
      return `Couldn't find a way to (${event.target.tx}, ${event.target.tz}), so gave up going there.`;
    case 'woke':
      return `Woke up: ${triggerText(event.trigger)}.`;
    case 'doReturn':
      return returnText(event.card, event.phase);
    case 'doPowerDown':
      return `Powered down for the day: my .MD says ${mdCardText(event.card)}.`;
    case 'conflict':
      return `My .MD says ${mdCardText(event.doCard)}, but it also says don't ${mdCardText(event.dontCard)}. Don't wins.`;
  }
}
```

The `doReturn failed` event carries no reason field (spec §2.7), so `{reason}` comes from the card: "no generator I could reach" for `generator`, "no way through" for a tile. A preceding `conflict` line explains a DON'T block.

- [ ] **Step 8: Validate the new events in saves (`src/state/robotValidation.ts`)**

Add `farmContains` to the file's import from `'../robots/program'`, or add `import { farmContains } from '../robots/program';` if Task 3 didn't import it. `isMdShape` is Task 3's, in this file. `TIME`, `ROBOTS`, `isInt`, `isIntIn`, `isObj`, `isOneOf` and `hasExactKeys` are already imported. Insert above `function isValidLogEvent`:

```ts
const DONT_CARD_KINDS = ['dontLeave', 'dontGoIntoWater', 'dontHarvest', 'dontDeposit'] as const;
const DO_CARD_KINDS = ['doReturn', 'doPowerDown'] as const;

/** An .MD card carried by a log event, of one of `kinds`. */
function isLoggedCard(v: unknown, kinds: readonly string[]): boolean {
  return isObj(v) && isOneOf(v.kind, kinds) && isMdShape([v]);
}

function isLoggedTile(v: unknown): boolean {
  return isObj(v) && hasExactKeys(v, ['tx', 'tz']) && isInt(v.tx) && isInt(v.tz) && farmContains(v.tx, v.tz);
}

/** A trigger carried by a `woke` event. */
function isLoggedTrigger(v: unknown): boolean {
  if (!isObj(v)) return false;
  switch (v.kind) {
    case 'morning':
    case 'bagFull':
    case 'startsRaining':
      return hasExactKeys(v, ['kind']);
    case 'atTime':
      return hasExactKeys(v, ['kind', 'minute']) && isIntIn(v.minute, TIME.dayStartMinute, TIME.passOutMinute);
    case 'every':
      return hasExactKeys(v, ['kind', 'minutes']) && isOneOf(v.minutes, ROBOTS.everyChoices);
    default:
      return false;
  }
}
```

and in `isValidLogEvent`, before `default: return hasExactKeys(v, ['kind']);` (which keeps covering `dizzy`):

```ts
    case 'skipped':
      return hasExactKeys(v, ['kind', 'action', 'card']) && isOneOf(v.action, ROBOT_ACTION_KINDS) && isLoggedCard(v.card, DONT_CARD_KINDS);
    case 'gaveUp':
      return hasExactKeys(v, ['kind', 'target', 'why']) && isLoggedTile(v.target) && isOneOf(v.why, ['goTo', 'forEach', 'doReturn']);
    case 'woke':
      return hasExactKeys(v, ['kind', 'trigger']) && isLoggedTrigger(v.trigger);
    case 'doReturn':
      return hasExactKeys(v, ['kind', 'card', 'phase']) && isLoggedCard(v.card, ['doReturn']) && isOneOf(v.phase, ['started', 'arrived', 'failed']);
    case 'doPowerDown':
      return hasExactKeys(v, ['kind', 'card']) && isLoggedCard(v.card, ['doPowerDown']);
    case 'conflict':
      return hasExactKeys(v, ['kind', 'doCard', 'dontCard']) && isLoggedCard(v.doCard, DO_CARD_KINDS) && isLoggedCard(v.dontCard, DONT_CARD_KINDS);
```

- [ ] **Step 9: Run it and see it pass**

Run: `npx vitest run tests/robotTurn.test.ts tests/robotLogText.test.ts tests/robotSave.test.ts`
Expected: PASS. Block robots still don't act in the tick: Task 1 keeps `run.ts` to scripts until Task 8.

- [ ] **Step 10: The full gate**

Run: `npm run typecheck && npm test && npm run build`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add src/robots/turn.ts src/robots/md.ts src/robots/exec.ts src/robots/logText.ts src/core/types.ts src/state/robotValidation.ts tests/robotTurn.test.ts
git commit -m "Farmclaws part 2: turns apply .MD precedence and triggers, with the new log events

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Running block robots, the log and the day

**Files:**
- Modify: `src/robots/execute.ts` (`RobotPlan`, `planRobotAction`, `settle`, `applyRobotPlan`, `applyBickerPlan`, `deposit`; new `NO_KEEP`, `chargeWake`, `applyTurn`)
- Modify (whole file): `src/robots/run.ts`
- Modify: `src/robots/overnight.ts` (`resetForMorning`, about lines 109–137 on `v2`)
- Test: `tests/robotMd.test.ts`, `tests/robotTriggers.test.ts`

**Interfaces:**
- Consumes: Task 7 `decideTurn(state: GameState, robot: Robot): Turn`, `type Turn`, `morningExec(program: BlockProgram): RobotExec`; Task 5 `keptItems` (through `Turn.keep`); Task 3 `freshExec`, `withZones`, save version 5 validation; Task 2 `b`.
- Produces:
  - `execute.ts`: `RobotPlan` gains `readonly keep: ReadonlySet<ItemId>` (R3); `export const NO_KEEP: ReadonlySet<ItemId>`; `planRobotAction(state, robot, action, keep: ReadonlySet<ItemId> = NO_KEEP): RobotPlan`; `applyRobotPlan(state, robotId, plan, exec: RobotExec | null = null): GameState`; `applyBickerPlan(state, robotId, plan, withIds, exec: RobotExec | null = null): GameState`; `export function applyTurn(state: GameState, robotId: number, turn: Exclude<Turn, { kind: 'act' }>): GameState`; `export function chargeWake(state: GameState, robotId: number, cost: number): GameState`.
  - `run.ts`: `runRobotsMinute` runs block robots too (signature unchanged).
  - `overnight.ts`: the morning reset rebuilds block robots' `exec` and clears `off` (signature unchanged).

Rules this task fixes:
- Due: scripts as in part 1. Block robots are due when not carried, `off === null`, `power` is `working` or `standby`, and `nextActMinute <= minute`.
- A block `act` turn goes flat when `tokens < wakeCost + plan.cost` (R2), and a non-act turn goes flat when `tokens < wakeCost`. Flat commits nothing: no events, no exec, and the trigger isn't spent.
- Applying a block turn logs `turn.events` first. `chargeWake` then pays the wake and marks the robot `working`. It runs for every block act, so a robot that starts a DO return from standby is shown working; with cost 0 on a working robot it changes nothing.
- `wait` and `finish` schedule the next check at `minute + periodFor(robot)`, the same rule as part 1's `settle`. A due robot always has `nextActMinute === minute` because robots run minute by minute, so this equals the contract's "`nextActMinute + period`" without letting a stale `nextActMinute` make a robot due every minute. `skip` goes through `settle`, which uses the same rule. `wait` also leaves the robot on `standby`, because an idle robot is a standby robot. That settles a put-down idle robot that part 1 resumed as `working`.
- `shutDown` and `dizzy` leave `nextActMinute` alone: an off robot isn't due, and the morning reset re-sets it.
- The morning reset keeps a block robot's exec object when it already equals the morning's (deep equality), so a robot the morning didn't change keeps its reference (`tests/robotDeterminism.test.ts` checks this in Task 11; `robotTriggers.test.ts` pins it here).

- [ ] **Step 1: Write the failing test `tests/robotMd.test.ts`**

```ts
/**
 * The .MD through real minutes (farmclaws part 2 spec §6): DON'T skips are free and take the
 * turn, kept items stay in the bag, DO cards end the robot's day, conflicts are logged, and
 * DON'T beats DO beats the program.
 */
import { describe, expect, it } from 'vitest';
import { INVENTORY } from '../src/config';
import { Blocker, TileState, Weather, type BlockProgram, type GameState, type MdCard, type Robot, type RobotLogEvent, type Tile } from '../src/core/types';
import { b } from '../src/robots/blocks';
import { morningExec } from '../src/robots/exec';
import { decideTurn } from '../src/robots/turn';
import { requireRobot } from '../src/robots/world';
import { actions } from '../src/state/actions';
import { gameReducer } from '../src/state/reducer';
import { blockedTile, EMPTY_TILE } from '../src/world/tiles';
import { BASE, TARGET, matureCrop, robotOf, soilTile, stack, tileAt, withRobots, withTile, withZones } from './testUtils';

const ZONE_A = { x0: 3, z0: 9, w: 5, d: 4 };
const LEAVE_A: MdCard = { kind: 'dontLeave', zone: 'A' };
const NO_WATER: MdCard = { kind: 'dontGoIntoWater' };
const KEEP_PARSNIPS: MdCard = { kind: 'dontDeposit', itemId: 'parsnip' };
const SPARE_PARSNIPS: MdCard = { kind: 'dontHarvest', cropId: 'parsnip' };
const IN_RAIN: MdCard = { kind: 'doPowerDown', when: { kind: 'raining' } };
const returnTo = (tx: number, tz: number, minute: number): MdCard => ({ kind: 'doReturn', to: { kind: 'tile', tx, tz }, minute });

const SPIN = b.program({ stacks: [b.when(b.morning(), b.forever(b.turn('right')))] });
const MOVER = b.program({ stacks: [b.when(b.morning(), b.forever(b.move()))] });
const CHEST: Tile = { ...EMPTY_TILE, object: { kind: 'chest', slots: new Array<null>(INVENTORY.chestSlots).fill(null) } };

const tick = (state: GameState, minutes: number): GameState => gameReducer(state, actions.tick(minutes));
const sleep = (state: GameState): GameState => gameReducer(state, actions.sleep());
const at = (state: GameState, minute: number): GameState => ({ ...state, time: { ...state.time, minuteOfDay: minute } });
const events = (state: GameState): RobotLogEvent[] => state.robots.log.entries.map((e) => e.event);
/** Event kinds, with a DO return's phase: "doReturn started". */
const labels = (state: GameState): string[] => events(state).map((e) => (e.kind === 'doReturn' ? `doReturn ${e.phase}` : e.kind));

/** A working robot that has just started its morning stack, due at 6:04. */
function worker(program: BlockProgram, overrides: Partial<Robot> = {}): Robot {
  return robotOf({ program, exec: morningExec(program), ...overrides });
}

describe('DON’T cards in the tick', () => {
  it('skips a forbidden move: logged with the card, free, and the turn is taken', () => {
    const robot = worker(MOVER, { tz: 12, md: [LEAVE_A] });
    const state = withZones(withRobots(BASE, [robot]), { A: ZONE_A });
    const turn = decideTurn(at(state, 364), robot);
    if (turn.kind !== 'skip') throw new Error(`expected a skip, got ${turn.kind}`);
    const next = tick(state, 4);
    const after = requireRobot(next, 1);
    expect(after).toMatchObject({ tx: 5, tz: 12, tokens: 80, tokensToday: 0, actionSeq: 1, nextActMinute: 368, power: 'working' });
    expect(after.lastAction).toEqual({ seq: 1, kind: 'move', success: false, bickered: false });
    expect(after.exec).toEqual(turn.exec);
    expect(events(next)).toEqual([{ kind: 'skipped', action: 'move', card: LEAVE_A }]);
    const later = tick(next, 8);
    expect(later.robots.log.entries).toHaveLength(1);
    expect(later.robots.log.entries[0]?.count).toBe(3);
    expect(requireRobot(later, 1).tokens).toBe(80);
  });

  it('skips driving into water with DON’T go into water, and shorts out without it', () => {
    const pond = withTile(BASE, { tx: 5, tz: 11 }, blockedTile(Blocker.Water), 'farm');
    const careful = tick(withRobots(pond, [worker(MOVER, { md: [NO_WATER] })]), 4);
    expect(requireRobot(careful, 1)).toMatchObject({ tz: 10, power: 'working', tokens: 80 });
    expect(events(careful)).toEqual([{ kind: 'skipped', action: 'move', card: NO_WATER }]);
    const careless = tick(withRobots(pond, [worker(MOVER)]), 4);
    expect(requireRobot(careless, 1)).toMatchObject({ tz: 11, power: 'broken' });
  });

  it('leaves a DON’T harvest crop in the ground', () => {
    const program = b.program({ stacks: [b.when(b.morning(), b.harvest())] });
    const field = withTile(BASE, TARGET, soilTile(TileState.Watered, matureCrop('parsnip')), 'farm');
    const next = tick(withRobots(field, [worker(program, { md: [SPARE_PARSNIPS] })]), 4);
    expect(tileAt(next, TARGET, 'farm').crop).not.toBeNull();
    expect(requireRobot(next, 1).bag).toEqual([]);
    expect(events(next)).toEqual([{ kind: 'skipped', action: 'harvest', card: SPARE_PARSNIPS }]);
  });

  it('deposits everything but the kept items, which stay in the bag', () => {
    const program = b.program({ stacks: [b.when(b.morning(), b.deposit())] });
    const robot = worker(program, { size: 'standard', tokens: 200, md: [KEEP_PARSNIPS], bag: [stack('parsnip', 3), stack('potato', 2)] });
    const ahead = { tx: TARGET.tx, tz: TARGET.tz + 1 };
    const next = tick(withRobots(withTile(BASE, ahead, CHEST, 'farm'), [robot]), 4);
    expect(requireRobot(next, 1)).toMatchObject({ bag: [stack('parsnip', 3)], tokens: 198 });
    const chest = tileAt(next, ahead, 'farm').object;
    expect(chest?.kind === 'chest' && chest.slots.slice(0, 2)).toEqual([stack('potato', 2), null]);
    expect(events(next)).toEqual([{ kind: 'did', action: 'deposit', detail: { kind: 'items', into: 'chest', stacks: 1, quantity: 2 } }]);
  });

  it('skips a deposit of only kept items', () => {
    const program = b.program({ stacks: [b.when(b.morning(), b.deposit())] });
    const robot = worker(program, { md: [KEEP_PARSNIPS], bag: [stack('parsnip', 3)] });
    const next = tick(withRobots(withTile(BASE, { tx: TARGET.tx, tz: TARGET.tz + 1 }, CHEST, 'farm'), [robot]), 4);
    expect(requireRobot(next, 1)).toMatchObject({ bag: [stack('parsnip', 3)], tokens: 80 });
    expect(events(next)).toEqual([{ kind: 'skipped', action: 'deposit', card: KEEP_PARSNIPS }]);
  });
});

describe('DO cards in the tick', () => {
  it('a DO power down ends the day: standby, off, triggers ignored, back next morning', () => {
    const program = b.program({ stacks: [b.when(b.morning(), b.forever(b.turn('right'))), b.when(b.every(5), b.move())] });
    const rainy = { ...withRobots(BASE, [worker(program, { md: [IN_RAIN] })]), weather: Weather.Rain };
    const next = tick(rainy, 4);
    expect(requireRobot(next, 1)).toMatchObject({ power: 'standby', off: 'done', actionSeq: 0, tokens: 80 });
    expect(events(next)).toEqual([{ kind: 'doPowerDown', card: IN_RAIN }]);
    const later = tick(next, 120);
    expect(requireRobot(later, 1)).toBe(requireRobot(next, 1));
    expect(events(later)).toHaveLength(1);
    const morning = sleep(later);
    expect(requireRobot(morning, 1)).toMatchObject({ off: null, power: 'working', exec: morningExec(program) });
  });

  it('a DO return walks home, then powers down for the day with the card done', () => {
    const card = returnTo(5, 13, 380);
    const robot = worker(SPIN, { md: [card], nextActMinute: 380 });
    const state = at(withRobots(BASE, [robot]), 376);
    const next = tick(state, 16);
    const after = requireRobot(next, 1);
    expect(after).toMatchObject({ tx: 5, tz: 13, power: 'standby', off: 'done', tokens: 77 });
    expect(after.exec).toEqual({ ...morningExec(SPIN), running: null, frames: [], doneCards: [0] });
    expect(labels(next)).toEqual(['doReturn started', 'did', 'doReturn arrived']);
    expect(next.robots.log.entries[1]?.count).toBe(3);
    const morning = sleep(tick(next, 60));
    expect(requireRobot(morning, 1)).toMatchObject({ off: null, power: 'working', exec: morningExec(SPIN) });
  });

  it('a DO return a DON’T stands in the way of fails, with the conflict logged first', () => {
    const card = returnTo(5, 14, 360);
    const state = withZones(withRobots(BASE, [worker(SPIN, { md: [LEAVE_A, card] })]), { A: ZONE_A });
    const next = tick(state, 4);
    expect(requireRobot(next, 1)).toMatchObject({ tx: 5, tz: 10, power: 'standby', off: 'done', tokens: 80 });
    expect(events(next)).toEqual([
      { kind: 'conflict', doCard: card, dontCard: LEAVE_A },
      { kind: 'doReturn', card, phase: 'failed' },
    ]);
  });
});

describe('precedence: DON’T beats DO beats the program', () => {
  // The robot stands on the zone's south edge (5, 12) facing South, moving forever, with 79 of its
  // 80 tokens, so `DO power down when I have fewer than 80 tokens` holds.
  const rows: readonly (readonly [string, readonly MdCard[], readonly string[]])[] = [
    ['the program alone', [], ['did']],
    ['a due DO return over the program', [returnTo(5, 14, 360)], ['doReturn started', 'did']],
    ['DON’T over the program', [LEAVE_A], ['skipped']],
    ['DON’T over a DO return', [LEAVE_A, returnTo(5, 14, 360)], ['conflict', 'doReturn failed']],
    ['DO power down over a DO return', [returnTo(5, 14, 360), { kind: 'doPowerDown', when: { kind: 'tokensBelow', n: 80 } }], ['doPowerDown']],
    ['DO power down, which no DON’T forbids', [LEAVE_A, { kind: 'doPowerDown', when: { kind: 'tokensBelow', n: 80 } }], ['doPowerDown']],
  ];
  it.each(rows)('%s', (_name, md, expected) => {
    const state = withZones(withRobots(BASE, [worker(MOVER, { tz: 12, tokens: 79, md })]), { A: ZONE_A });
    expect(labels(tick(state, 4))).toEqual(expected);
  });
});
```

- [ ] **Step 2: Write the failing test `tests/robotTriggers.test.ts`**

```ts
/**
 * Triggers and the robot's day through real minutes (farmclaws part 2 spec §7): the morning
 * reset, waking only when idle, the wake's cost, going flat on a wake, the `every` cadence,
 * dizzy robots, and save round trips mid-program (review focus 1 and 4).
 */
import { describe, expect, it } from 'vitest';
import { Weather, type BlockProgram, type GameState, type Robot } from '../src/core/types';
import { b } from '../src/robots/blocks';
import { freshExec, morningExec } from '../src/robots/exec';
import { requireRobot } from '../src/robots/world';
import { actions } from '../src/state/actions';
import { deserializeGame, serializeGame } from '../src/state/persistence';
import { gameReducer } from '../src/state/reducer';
import { BASE, must, robotOf, withRobots } from './testUtils';

const tick = (state: GameState, minutes: number): GameState => gameReducer(state, actions.tick(minutes));
const sleep = (state: GameState): GameState => gameReducer(state, actions.sleep());
const kinds = (state: GameState): string[] => state.robots.log.entries.map((e) => e.event.kind);
/** Minutes at which the robot logged `kind`. */
const minutesOf = (state: GameState, kind: string): number[] => state.robots.log.entries.filter((e) => e.event.kind === kind).map((e) => e.minute);

function worker(program: BlockProgram, overrides: Partial<Robot> = {}): Robot {
  return robotOf({ program, exec: morningExec(program), ...overrides });
}

const SPINNER = b.program({ stacks: [b.when(b.morning(), b.turn('right'))] });

function idle(program: BlockProgram, overrides: Partial<Robot> = {}): Robot {
  return robotOf({ program, exec: freshExec(program), power: 'standby', ...overrides });
}

describe('the morning reset', () => {
  it('starts the first morning stack, re-arms triggers and turns robots back on', () => {
    const program = b.program({ vars: [b.numVar('n', 3)], stacks: [b.when(b.atTime(600), b.turn('left')), b.when(b.morning(), b.move())] });
    const tired = idle(program, { off: 'dizzy', exec: { ...freshExec(program), vars: [{ type: 'number', value: 9 }], due: [null], doneCards: [1] } });
    const morning = sleep(withRobots(BASE, [tired]));
    expect(requireRobot(morning, 1)).toMatchObject({ power: 'working', off: null, exec: morningExec(program), pc: 0 });
    expect(must(requireRobot(morning, 1).exec).running).toBe(1);
  });

  it('leaves a robot with no morning stack idle on standby, and a flat one flat', () => {
    const program = b.program({ stacks: [b.when(b.every(30), b.move())] });
    const morning = sleep(withRobots(BASE, [worker(program), worker(program, { id: 2, name: 'Bolt', tokens: 0, power: 'flat' })]));
    expect(requireRobot(morning, 1)).toMatchObject({ power: 'standby', exec: freshExec(program) });
    expect(requireRobot(morning, 2).power).toBe('flat');
  });
  it('keeps a robot whose morning changed nothing by reference (render contract)', () => {
    const program = b.program({ stacks: [b.when(b.every(30), b.move())] });
    const once = sleep(withRobots(BASE, [worker(program), worker(SPINNER, { id: 2, name: 'Bolt' })]));
    const twice = sleep(once);
    expect(requireRobot(twice, 1)).toBe(requireRobot(once, 1));
    expect(requireRobot(twice, 2)).toBe(requireRobot(once, 2));
  });
});

describe('waking', () => {
  const EVERY_15 = b.program({ stacks: [b.when(b.every(15), b.turn('right'))] });

  it('checks on its schedule for free, wakes when due, pays the wake and acts that same minute', () => {
    const next = tick(withRobots(BASE, [idle(EVERY_15)]), 16);
    expect(kinds(next)).toEqual(['woke', 'did']);
    expect(minutesOf(next, 'woke')).toEqual([376]);
    expect(requireRobot(next, 1)).toMatchObject({ power: 'working', tokens: 78, tokensToday: 2, actionSeq: 1 });
    expect(must(requireRobot(next, 1).exec).due).toEqual([391]);
  });

  it('keeps the every cadence over an hour: wake, act, finish, wait for the next due', () => {
    const next = tick(withRobots(BASE, [idle(EVERY_15)]), 60);
    expect(minutesOf(next, 'woke')).toEqual([376, 392, 408]);
    expect(kinds(next)).toEqual(['woke', 'did', 'finished', 'woke', 'did', 'finished', 'woke', 'did', 'finished']);
    expect(requireRobot(next, 1)).toMatchObject({ power: 'standby', tokens: 74, tokensToday: 6, nextActMinute: 424 });
    expect(must(requireRobot(next, 1).exec).due).toEqual([423]);
  });

  it('never interrupts a running stack: the trigger fires once the robot is idle', () => {
    const program = b.program({ stacks: [b.when(b.morning(), b.wait(30), b.turn('left')), b.when(b.every(5), b.turn('right'))] });
    const next = tick(withRobots(BASE, [worker(program)]), 60);
    expect(minutesOf(next, 'finished')).toEqual([398, 406, 414]);
    expect(minutesOf(next, 'woke')).toEqual([402, 410, 418]);
  });

  it('wakes from a Power down block when a trigger fires', () => {
    const program = b.program({ stacks: [b.when(b.morning(), b.powerDown()), b.when(b.atTime(400), b.turn('right'))] });
    const next = tick(withRobots(BASE, [worker(program)]), 44);
    expect(kinds(next)).toEqual(['poweredDown', 'woke', 'did', 'finished']);
    expect(minutesOf(next, 'woke')).toEqual([400]);
  });

  it('wakes once a day on a full bag and when it starts raining', () => {
    const program = b.program({ stacks: [b.when(b.bagFull(), b.turn('right')), b.when(b.startsRaining(), b.turn('left'))] });
    const robot = idle(program, { bag: [{ itemId: 'parsnip', quantity: 1, quality: 0 }] });
    const next = tick({ ...withRobots(BASE, [robot]), weather: Weather.Rain }, 60);
    expect(minutesOf(next, 'woke')).toEqual([364, 372]);
    expect(must(requireRobot(next, 1).exec).firedToday).toEqual([true, true]);
  });

  it('goes flat on a wake it cannot pay, commits nothing and never wakes for free (review focus 4)', () => {
    const program = b.program({ stacks: [b.when(b.every(5), b.turn('right'))] });
    const robot = idle(program, { tokens: 0 });
    const next = tick(withRobots(BASE, [robot]), 8);
    expect(requireRobot(next, 1)).toMatchObject({ power: 'flat', tokens: 0, actionSeq: 0 });
    expect(requireRobot(next, 1).exec).toEqual(robot.exec);
    expect(kinds(next)).toEqual(['flat']);
    expect(next.messages.entries.at(-1)?.text).toBe('Sprocket ran out of power.');
    expect(kinds(tick(next, 60))).toEqual(['flat']);
  });

  it('needs the wake and the action together: one token short goes flat', () => {
    const program = b.program({ stacks: [b.when(b.every(5), b.turn('right'))] });
    const next = tick(withRobots(BASE, [idle(program, { tokens: 1 })]), 8);
    expect(requireRobot(next, 1)).toMatchObject({ power: 'flat', tokens: 1 });
    expect(must(requireRobot(next, 1).exec).due).toEqual([365]);
  });
});

describe('ending the stack', () => {
  it('a finished program goes to standby and says so', () => {
    const program = b.program({ stacks: [b.when(b.morning(), b.turn('right'))] });
    const next = tick(withRobots(BASE, [worker(program)]), 8);
    expect(requireRobot(next, 1)).toMatchObject({ power: 'standby', nextActMinute: 372 });
    expect(kinds(next)).toEqual(['did', 'finished']);
  });

  it('a dizzy robot is toasted, stays off all day and is back next morning', () => {
    const program = b.program({ vars: [b.numVar('x', 0)], stacks: [b.when(b.morning(), b.forever(b.set('x', b.n(1))))] });
    const robot = worker(program);
    const next = tick(withRobots(BASE, [robot]), 4);
    expect(requireRobot(next, 1)).toMatchObject({ off: 'dizzy', power: 'working', tokens: 80, exec: robot.exec });
    expect(kinds(next)).toEqual(['dizzy']);
    expect(next.messages.entries.at(-1)).toMatchObject({ text: 'Sprocket got dizzy going round in circles.', tone: 'warn' });
    const later = tick(next, 120);
    expect(requireRobot(later, 1)).toBe(requireRobot(next, 1));
    expect(requireRobot(sleep(later), 1)).toMatchObject({ off: null, power: 'working', exec: morningExec(program) });
  });
});

describe('saving mid-program (review focus 1)', () => {
  const roundTrip = (state: GameState): void => {
    expect(deserializeGame(serializeGame(state))).toEqual(state);
  };
  const run = (robot: Robot, minutes: number): GameState => tick(withRobots(BASE, [robot]), minutes);

  it('loads mid-loop, mid-route and mid-helper to an identical state', () => {
    const loop = run(worker(b.program({ stacks: [b.when(b.morning(), b.repeat(5, b.turn('right')))] })), 8);
    expect(must(requireRobot(loop, 1).exec).frames.some((f) => f.kind === 'list' && f.loop?.kind === 'times')).toBe(true);
    roundTrip(loop);

    const route = run(worker(b.program({ stacks: [b.when(b.morning(), b.goTo(b.tileAt(5, 15)))] })), 8);
    expect(must(requireRobot(route, 1).exec).frames.at(-1)?.kind).toBe('route');
    roundTrip(route);

    const helper = b.program({ stacks: [b.when(b.morning(), b.run('spin'))], helpers: [b.helper('spin', b.turn('right'), b.turn('right'), b.turn('right'))] });
    const inHelper = run(worker(helper), 8);
    expect(must(requireRobot(inHelper, 1).exec).frames.at(-1)).toMatchObject({ kind: 'list', list: { root: 'helper', index: 0 } });
    roundTrip(inHelper);
  });

  it('loads during a DO return, dizzy, done, and idle with a pending every trigger', () => {
    const spin = b.program({ stacks: [b.when(b.morning(), b.forever(b.turn('right')))] });
    const returning = run(worker(spin, { md: [{ kind: 'doReturn', to: { kind: 'tile', tx: 5, tz: 15 }, minute: 360 }] }), 8);
    expect(must(requireRobot(returning, 1).exec).frames).toMatchObject([{ kind: 'route', why: 'doReturn' }]);
    roundTrip(returning);

    const dizzy = run(worker(b.program({ vars: [b.numVar('x', 0)], stacks: [b.when(b.morning(), b.forever(b.set('x', b.n(1))))] })), 4);
    expect(requireRobot(dizzy, 1).off).toBe('dizzy');
    roundTrip(dizzy);

    const done = run(worker(spin, { tokens: 79, md: [{ kind: 'doPowerDown', when: { kind: 'tokensBelow', n: 80 } }] }), 4);
    expect(requireRobot(done, 1).off).toBe('done');
    roundTrip(done);

    const waiting = run(idle(b.program({ stacks: [b.when(b.every(30), b.turn('right'))] })), 8);
    expect(must(requireRobot(waiting, 1).exec).due).toEqual([390]);
    roundTrip(waiting);
  });
});
```

- [ ] **Step 3: Run them and see them fail**

Run: `npx vitest run tests/robotMd.test.ts tests/robotTriggers.test.ts`
Expected: FAIL. The files compile, but block robots never act: Task 1's `run.ts` treats only scripts as due, so the logs come back empty (for example "skips a forbidden move" gets `actionSeq: 0` and `[]`). The morning reset also doesn't rebuild `exec` (for example "starts the first morning stack" sees the old exec and `off: 'dizzy'`).

- [ ] **Step 4: The deposit `keep` set, the committed exec and the non-act turns in `src/robots/execute.ts`**

Header comment:

```ts
// old
 * rules as the player's tools, then applies it and pays for it in tokens. Pure.

// new
 * rules as the player's tools, then applies it and pays for it in tokens. Part 2 adds the .MD's
 * kept items for deposits, the committed exec of block programs, and the turns that take no tile
 * action (part 2 spec §6.1, §7). Pure.
```

Imports: add `type ItemId,` after `type GameState,` and `type RobotExec,` after `type RobotDidDetail,` in the `'../core/types'` import. Then add `import type { Turn } from './turn';` after the `'./stats'` import. It is type-only, so there is no runtime cycle with `turn.ts`.

`RobotPlan` and `NO_KEEP`:

```ts
// old
export type RobotPlan =
  | { readonly ok: true; readonly action: RobotAction; readonly target: TileCoord; readonly cost: number }
  | { readonly ok: false; readonly action: RobotAction; readonly target: TileCoord; readonly reason: RobotBlockReason; readonly cost: number };

// new
/** `keep`: items a deposit leaves in the bag (the .MD's DON'T deposit cards, plan R3). */
export type RobotPlan =
  | { readonly ok: true; readonly action: RobotAction; readonly target: TileCoord; readonly cost: number; readonly keep: ReadonlySet<ItemId> }
  | {
      readonly ok: false;
      readonly action: RobotAction;
      readonly target: TileCoord;
      readonly reason: RobotBlockReason;
      readonly cost: number;
      readonly keep: ReadonlySet<ItemId>;
    };

/** Nothing kept back: scripts, and robots without DON'T deposit cards. */
export const NO_KEEP: ReadonlySet<ItemId> = new Set<ItemId>();
```

`planRobotAction`'s head:

```ts
// old
/** What `action` would do for `robot` now, and what it costs. Reads only the farm, time, shipping and the robot. */
export function planRobotAction(state: GameState, robot: Robot, action: RobotAction): RobotPlan {
  const own: TileCoord = { tx: robot.tx, tz: robot.tz };
  const target = AHEAD.has(action.kind) ? stepTile(own, robot.facing) : own;
  const cost = actionCost(robot, action.kind);
  const ok: RobotPlan = { ok: true, action, target, cost };
  const no = (reason: RobotBlockReason): RobotPlan => ({ ok: false, action, target, reason, cost: reason === 'noPart' ? 0 : cost });

// new
/**
 * What `action` would do for `robot` now, and what it costs. Reads only the farm, time, shipping
 * and the robot. A deposit offers only the bag's stacks whose item isn't in `keep`.
 */
export function planRobotAction(state: GameState, robot: Robot, action: RobotAction, keep: ReadonlySet<ItemId> = NO_KEEP): RobotPlan {
  const own: TileCoord = { tx: robot.tx, tz: robot.tz };
  const target = AHEAD.has(action.kind) ? stepTile(own, robot.facing) : own;
  const cost = actionCost(robot, action.kind);
  const ok: RobotPlan = { ok: true, action, target, cost, keep };
  const no = (reason: RobotBlockReason): RobotPlan => ({ ok: false, action, target, reason, cost: reason === 'noPart' ? 0 : cost, keep });
```

its `deposit` case:

```ts
// old
      if (kind === null) return no('nothingAhead');
      if (robot.bag.length === 0) return no('bagEmpty');
      const slots = chestSlots(tile);
      const fits =
        kind === 'bin'
          ? robot.bag.some((s) => getItem(s.itemId).sellPrice !== null)
          : robot.bag.some((s) => slotsRoom(slots, s.itemId, s.quality) > 0);

// new
      if (kind === null) return no('nothingAhead');
      const offered = robot.bag.filter((s) => !keep.has(s.itemId));
      if (offered.length === 0) return no('bagEmpty');
      const slots = chestSlots(tile);
      const fits =
        kind === 'bin'
          ? offered.some((s) => getItem(s.itemId).sellPrice !== null)
          : offered.some((s) => slotsRoom(slots, s.itemId, s.quality) > 0);
```

Replace the whole `settle` function, as Task 1 left it, with:

```ts
/**
 * Finishes a robot's turn: a script advances pc (a non-looping script past its end goes to
 * standby and logs 'finished'); a block program leaves pc at 0 and takes `exec`, the position its
 * turn committed (part 2 spec §5.2). Then it schedules the next action and records lastAction
 * for the renderer.
 */
function settle(state: GameState, robotId: number, action: RobotAction, success: boolean, bickered: boolean, exec: RobotExec | null): GameState {
  const robot = requireRobot(state, robotId);
  const program = robot.program;
  const seq = robot.actionSeq + 1;
  let pc = robot.pc;
  let power = robot.power;
  let finished = false;
  if (program.kind === 'script') {
    pc = robot.pc + 1;
    if (pc >= program.steps.length) {
      pc = 0;
      if (!program.loop && power === 'working') {
        power = 'standby';
        finished = true;
      }
    }
  }
  const minute = state.time.minuteOfDay;
  const next = withRobot(state, {
    ...robot,
    pc,
    power,
    exec: exec ?? robot.exec,
    nextActMinute: minute + (action.kind === 'wait' ? action.minutes : periodFor(robot)),
    actionSeq: seq,
    lastAction: { seq, kind: action.kind, success, bickered },
  });
  return finished ? logRobotEvent(next, robotId, { kind: 'finished' }) : next;
}
```

Replace `applyRobotPlan` and `applyBickerPlan` (from the doc comment above `applyRobotPlan` down to just before `function perform(`) with:

```ts
/**
 * Pays for `plan`, carries it out (or logs why not) and settles the robot's turn. A block
 * program passes the exec its turn committed.
 */
export function applyRobotPlan(state: GameState, robotId: number, plan: RobotPlan, exec: RobotExec | null = null): GameState {
  const paid = pay(state, robotId, plan.cost);
  if (!plan.ok) {
    const logged = logRobotEvent(paid.state, robotId, { kind: 'blocked', action: plan.action.kind, reason: plan.reason });
    return settle(logged, robotId, plan.action, false, false, exec);
  }
  const { next, event } = perform(paid.state, paid.robot, plan);
  return settle(logRobotEvent(next, robotId, event), robotId, plan.action, true, false, exec);
}

/** A bicker: the robot pays, the world doesn't change, and the clash is logged with the other robots' ids. */
export function applyBickerPlan(state: GameState, robotId: number, plan: RobotPlan, withIds: readonly number[], exec: RobotExec | null = null): GameState {
  const paid = pay(state, robotId, plan.cost);
  const logged = logRobotEvent(paid.state, robotId, { kind: 'bickered', action: plan.action.kind, withIds });
  return settle(logged, robotId, plan.action, false, true, exec);
}

/**
 * Pays `cost` tokens to wake (part 2 spec §7) and marks the robot working: a block robot taking a
 * turn is awake for it. With cost 0 on a working robot the state is unchanged.
 */
export function chargeWake(state: GameState, robotId: number, cost: number): GameState {
  const paid = pay(state, robotId, cost);
  return paid.robot.power === 'working' ? paid.state : withRobot(paid.state, { ...paid.robot, power: 'working' });
}

/**
 * Applies a block-program turn that takes no tile action (part 2 spec §6.1, §7). `wait`: the idle
 * robot checks again one period later, free, on standby. Otherwise the turn's events are logged
 * first, then the wake is paid (the caller made sure the robot can), then:
 * - skip: the forbidden action costs nothing, exec moves past it and the turn is taken
 * - finish: the stack ended; standby, logged 'finished', the next check one period later
 * - shutDown: standby and off until morning, with the deciding event
 * - dizzy: off until morning, power unchanged, logged and toasted
 */
export function applyTurn(state: GameState, robotId: number, turn: Exclude<Turn, { readonly kind: 'act' }>): GameState {
  const minute = state.time.minuteOfDay;
  if (turn.kind === 'wait') {
    const robot = requireRobot(state, robotId);
    return withRobot(state, { ...robot, power: 'standby', nextActMinute: minute + periodFor(robot) });
  }
  let next = state;
  for (const event of turn.events) next = logRobotEvent(next, robotId, event);
  if (turn.kind === 'shutDown') {
    const robot = requireRobot(next, robotId);
    return logRobotEvent(withRobot(next, { ...robot, power: 'standby', off: 'done', exec: turn.exec }), robotId, turn.event);
  }
  next = chargeWake(next, robotId, turn.wakeCost);
  const robot = requireRobot(next, robotId);
  switch (turn.kind) {
    case 'skip': {
      const skipped = logRobotEvent(next, robotId, { kind: 'skipped', action: turn.action.kind, card: turn.card });
      return settle(skipped, robotId, turn.action, false, false, turn.exec);
    }
    case 'finish': {
      const standby = withRobot(next, { ...robot, power: 'standby', exec: turn.exec, nextActMinute: minute + periodFor(robot) });
      return logRobotEvent(standby, robotId, { kind: 'finished' });
    }
    case 'dizzy': {
      const dizzy = logRobotEvent(withRobot(next, { ...robot, off: 'dizzy' }), robotId, { kind: 'dizzy' });
      return pushMessage(dizzy, `${robot.name} got dizzy going round in circles.`, 'warn');
    }
  }
}
```

In `perform`, pass the plan's kept set to the deposit:

```ts
// old
    case 'deposit':
      return deposit(state, robot, target);

// new
    case 'deposit':
      return deposit(state, robot, target, plan.keep);
```

and in `deposit`:

```ts
// old
function deposit(state: GameState, robot: Robot, target: TileCoord): { readonly next: GameState; readonly event: RobotLogEvent } {

// new
/** Empties the bag into the bin or chest ahead, leaving the `keep` items (and whatever didn't fit) in the bag. */
function deposit(state: GameState, robot: Robot, target: TileCoord, keep: ReadonlySet<ItemId>): { readonly next: GameState; readonly event: RobotLogEvent } {
```

```ts
// old (bin loop)
    for (const s of robot.bag) {
      if (getItem(s.itemId).sellPrice === null) {

// new
    for (const s of robot.bag) {
      if (keep.has(s.itemId) || getItem(s.itemId).sellPrice === null) {
```

```ts
// old (chest loop)
  let slots = chestSlots(tile);
  for (const s of robot.bag) {
    const result = addToSlots(slots, s);

// new
  let slots = chestSlots(tile);
  for (const s of robot.bag) {
    if (keep.has(s.itemId)) {
      kept.push(s);
      continue;
    }
    const result = addToSlots(slots, s);
```

Part 1's callers (`tests/robotExecute.test.ts`, `tests/robotParity.test.ts`) call `planRobotAction` / `applyRobotPlan` with three arguments and keep working unchanged.

- [ ] **Step 5: Replace `src/robots/run.ts`**

```ts
/**
 * Robots acting minute by minute (farmclaws part 1 spec §5.1–5.3, part 2 spec §8). Pure.
 */
import { invariant } from '../core/invariant';
import type { GameState, Robot, RobotActionKind, RobotExec, RobotLogEvent } from '../core/types';
import { pushMessage } from '../state/messages';
import { applyBickerPlan, applyRobotPlan, applyTurn, chargeWake, planRobotAction, type RobotPlan } from './execute';
import { logRobotEvent } from './log';
import { decideTurn, type Turn } from './turn';
import { requireRobot, withRobot } from './world';

/** Tile actions two robots can't share in one minute. */
const BICKER_ACTIONS: ReadonlySet<RobotActionKind> = new Set<RobotActionKind>(['harvest', 'water', 'till', 'plant']);

/** A robot's choice this minute: an action to plan, bicker over and apply, or a block-program turn with no tile action. */
type Choice =
  /**
   * `exec` is the position a block program commits with the action (null for scripts). `events`
   * are logged and `wakeCost` is paid before the action.
   */
  | {
      readonly kind: 'act';
      readonly id: number;
      readonly plan: RobotPlan;
      readonly exec: RobotExec | null;
      readonly wakeCost: number;
      readonly events: readonly RobotLogEvent[];
    }
  | { readonly kind: 'turn'; readonly id: number; readonly turn: Exclude<Turn, { readonly kind: 'act' }> };

function goFlat(state: GameState, robotId: number): GameState {
  const robot = requireRobot(state, robotId);
  const flat = logRobotEvent(withRobot(state, { ...robot, power: 'flat' }), robotId, { kind: 'flat' });
  return pushMessage(flat, `${robot.name} ran out of power.`, 'warn');
}

/**
 * Whether `robot` takes a turn this minute: a working script robot (part 1), or a block-program
 * robot that is working or idle on standby and not off (part 2 spec §7, §8). Never while carried.
 */
function isDue(robot: Robot, minute: number): boolean {
  if (robot.carried || robot.nextActMinute > minute) return false;
  if (robot.program.kind === 'script') return robot.power === 'working';
  return robot.off === null && (robot.power === 'working' || robot.power === 'standby');
}

/**
 * The robot's choice against the start-of-minute state, or null when it can't pay and goes
 * flat. A turn that woke the robot must pay the wake on top of the action (plan R2); a robot
 * that can't commits nothing, so its trigger isn't spent.
 */
function choose(state: GameState, robot: Robot): Choice | null {
  const program = robot.program;
  if (program.kind === 'script') {
    const action = program.steps[robot.pc];
    invariant(action !== undefined, `robot ${robot.id} pc ${robot.pc} outside its script`);
    const plan = planRobotAction(state, robot, action);
    return robot.tokens < plan.cost ? null : { kind: 'act', id: robot.id, plan, exec: null, wakeCost: 0, events: [] };
  }
  const turn = decideTurn(state, robot);
  if (turn.kind === 'act') {
    const plan = planRobotAction(state, robot, turn.action, turn.keep);
    if (robot.tokens < turn.wakeCost + plan.cost) return null;
    return { kind: 'act', id: robot.id, plan, exec: turn.exec, wakeCost: turn.wakeCost, events: turn.events };
  }
  const wake = turn.kind === 'wait' || turn.kind === 'shutDown' ? 0 : turn.wakeCost;
  return robot.tokens < wake ? null : { kind: 'turn', id: robot.id, turn };
}

/**
 * One minute (state.time.minuteOfDay is the minute being processed): every due robot chooses
 * against the state at the start of the minute; robots that can't pay go flat; successful
 * tile actions on a shared tile bicker; the rest are re-planned (with the same kept items) and
 * applied in id order, block-program turns with no tile action among them.
 */
export function runRobotsMinute(state: GameState): GameState {
  const minute = state.time.minuteOfDay;
  const due = state.robots.list.filter((r) => isDue(r, minute));
  if (due.length === 0) return state;

  let next = state;
  const chosen: Choice[] = [];
  for (const robot of due) {
    const choice = choose(state, robot);
    if (choice === null) next = goFlat(next, robot.id);
    else chosen.push(choice);
  }

  const byTile = new Map<string, number[]>();
  for (const choice of chosen) {
    if (choice.kind !== 'act' || !choice.plan.ok || !BICKER_ACTIONS.has(choice.plan.action.kind)) continue;
    const key = `${choice.plan.target.tx},${choice.plan.target.tz}`;
    byTile.set(key, [...(byTile.get(key) ?? []), choice.id]);
  }
  const rivals = new Map<number, readonly number[]>();
  for (const ids of byTile.values()) {
    if (ids.length < 2) continue;
    for (const id of ids) rivals.set(id, ids.filter((other) => other !== id));
  }

  for (const choice of chosen) {
    const id = choice.id;
    if (choice.kind === 'turn') {
      next = applyTurn(next, id, choice.turn);
      continue;
    }
    const { plan, exec, wakeCost, events } = choice;
    for (const event of events) next = logRobotEvent(next, id, event);
    // A block-program robot is awake for its action; a woken one pays the wake first.
    if (exec !== null) next = chargeWake(next, id, wakeCost);
    const others = rivals.get(id);
    if (others !== undefined) {
      next = applyBickerPlan(next, id, plan, others, exec);
      continue;
    }
    next = applyRobotPlan(next, id, planRobotAction(next, requireRobot(next, id), plan.action, plan.keep), exec);
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

- [ ] **Step 6: The morning reset in `src/robots/overnight.ts`**

Add `import { morningExec } from './exec';` above the `'./log'` import, and `type RobotExec,` after `type Robot,` in the `'../core/types'` import. Directly above `resetForMorning`'s doc comment (the one that starts "Every robot not at repairs stays where it is"), add the two helpers that keep a robot the morning didn't change by reference (the render contract: sleeping twice in a row, or a robot that was already idle on a fresh exec, must not copy the robot):

```ts
/** Deep equality for plain save data: numbers, strings, booleans, null, arrays and plain objects. */
function samePlainData(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null || Array.isArray(a) !== Array.isArray(b)) return false;
  const left = a as Readonly<Record<string, unknown>>;
  const right = b as Readonly<Record<string, unknown>>;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((key) => key in right && samePlainData(left[key], right[key]));
}

/**
 * The morning's exec (part 2 spec §7): null for a script; for a block program, the robot's own
 * exec when it already is exactly the morning's, so a robot the morning didn't change keeps its
 * reference (the render contract).
 */
function morningExecOf(robot: Robot): RobotExec | null {
  if (robot.program.kind !== 'blocks') return null;
  const fresh = morningExec(robot.program);
  return robot.exec !== null && samePlainData(robot.exec, fresh) ? robot.exec : fresh;
}
```

In `resetForMorning`, extend the doc comment and the robot update:

```ts
// old (end of the doc comment)
 * on land is never left on an unwalkable tile, which the save validator rejects.
 */

// new
 * on land is never left on an unwalkable tile, which the save validator rejects.
 *
 * A block program (part 2 spec §7) gets the morning's exec: variables back to their initials,
 * triggers re-armed, its first `morning` stack started. It works if that stack started and waits
 * on standby otherwise; flat and broken robots stay so. Every robot is turned back on.
 */
```

```ts
// old
    const moved = at.tx !== robot.tx || at.tz !== robot.tz;
    next = withRobot(next, {

// new
    const moved = at.tx !== robot.tx || at.tz !== robot.tz;
    const exec = morningExecOf(robot);
    const resumed = resumedPower(robot);
    next = withRobot(next, {
```

```ts
// old
      nextActMinute: TIME.dayStartMinute + periodFor(robot),
      power: resumedPower(robot),
    });

// new
      nextActMinute: TIME.dayStartMinute + periodFor(robot),
      power: resumed === 'working' && exec !== null && exec.running === null ? 'standby' : resumed,
      exec,
      off: null,
    });
```

Script robots get `exec: null` and `off: null`, the values they already hold, so part 1's overnight behaviour is unchanged.

- [ ] **Step 7: Run them and see them pass**

Run: `npx vitest run tests/robotMd.test.ts tests/robotTriggers.test.ts tests/robotTurn.test.ts tests/robotRun.test.ts tests/robotOvernight.test.ts tests/robotExecute.test.ts tests/robotParity.test.ts tests/robotTickBatching.test.ts`
Expected: PASS. Part 1's robot suites pass untouched.

- [ ] **Step 8: The full gate**

Run: `npm run typecheck && npm test && npm run build`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/robots/execute.ts src/robots/run.ts src/robots/overnight.ts tests/robotMd.test.ts tests/robotTriggers.test.ts
git commit -m "Farmclaws part 2: block robots run in the tick, with the .MD, triggers and the morning reset

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: The dizzy spin

**Files:**
- Modify: `src/render/robotLayout.ts` (header comment; new section after `clipOffsets`, end of file ~line 216)
- Modify: `src/render/RobotRenderer.ts` (header comment lines 1–12; `./robotLayout` import ~line 23; `groundOf` ~line 109; `Visual` ~line 82; `sync` ~lines 175 and 191; `resetEffects` ~line 234; `animate` ~lines 287, 307, 311, 326)
- Test: `tests/robotRender.test.ts` (extend)

**Interfaces:**
- Consumes: `Robot.off: null | 'dizzy' | 'done'` (Task 3), `RobotPower`.
- Produces (in `src/render/robotLayout.ts`):
  - `export const DIZZY_SPIN_SECONDS = 1`
  - `export function dizzySpin(t: number): number` — yaw offset 0 … 2π over `DIZZY_SPIN_SECONDS`, 0 outside
  - `export function eyeLevel(power: RobotPower, off: Robot['off']): number` — 1 working and not off, 0.5 standby or any off, 0 flat/broken (and repairing)
  - `export function startsDizzySpin(prev: Robot | undefined, next: Robot): boolean`

- [ ] **Step 1: Write the failing test**

In `tests/robotRender.test.ts`, add this line after `import { ROBOTS, TIME } from '../src/config';`:

```ts
import type { Robot, RobotPower } from '../src/core/types';
```

and replace the `../src/render/robotLayout` import block with:

```ts
import {
  DIZZY_SPIN_SECONDS,
  IDLE_BOB_HEIGHT,
  IDLE_BOB_SECONDS,
  MAX_MOVE_SECONDS,
  MOVE_PERIOD_SHARE,
  SHARED_OFFSET,
  clipFor,
  clipOffsets,
  dizzySpin,
  eyeLevel,
  idleBob,
  moveSeconds,
  sharedOffsetXZ,
  robotMeshes,
  robotPose,
  sharedTileOffsets,
  startsDizzySpin,
} from '../src/render/robotLayout';
```

Append at the end of the file:

```ts
describe('robots that are off (part 2 spec §9)', () => {
  it('spin once when dizzy: a full turn over DIZZY_SPIN_SECONDS, then nothing', () => {
    expect(DIZZY_SPIN_SECONDS).toBe(1);
    expect(dizzySpin(0)).toBe(0);
    expect(dizzySpin(0.5)).toBeCloseTo(Math.PI);
    expect(dizzySpin(1)).toBe(0);
    expect(dizzySpin(1.5)).toBe(0);
    expect(dizzySpin(-0.2)).toBe(0);
    // Inside the clip the yaw only ever grows, and stays short of a full turn.
    let last = 0;
    for (let i = 1; i < 20; i++) {
      const yaw = dizzySpin((i / 20) * DIZZY_SPIN_SECONDS);
      expect(yaw).toBeGreaterThan(last);
      expect(yaw).toBeLessThan(Math.PI * 2);
      last = yaw;
    }
  });

  it('dims the eyes of robots on standby or turned off, and puts them out when flat, broken or away', () => {
    const table: readonly (readonly [RobotPower, Robot['off'], number])[] = [
      ['working', null, 1],
      ['working', 'dizzy', 0.5],
      ['working', 'done', 0.5],
      ['standby', null, 0.5],
      ['standby', 'dizzy', 0.5],
      ['standby', 'done', 0.5],
      ['flat', null, 0],
      ['broken', null, 0],
      ['repairing', null, 0],
    ];
    for (const [power, off, level] of table) expect(eyeLevel(power, off), `${power} / ${String(off)}`).toBe(level);
  });

  it('starts a spin only when a robot has just got dizzy, never on a load or a new robot', () => {
    const on = robotOf();
    const dizzy = robotOf({ off: 'dizzy' });
    expect(startsDizzySpin(on, dizzy)).toBe(true);
    expect(startsDizzySpin(undefined, dizzy)).toBe(false);
    expect(startsDizzySpin(dizzy, dizzy)).toBe(false);
    expect(startsDizzySpin(on, robotOf({ off: 'done' }))).toBe(false);
    expect(startsDizzySpin(on, on)).toBe(false);
    expect(startsDizzySpin(dizzy, on)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run tests/robotRender.test.ts`
Expected: FAIL. `dizzySpin`, `eyeLevel` and `startsDizzySpin` are not exported yet ("dizzySpin is not a function"), and `DIZZY_SPIN_SECONDS` is undefined.

- [ ] **Step 3: Implement**

In `src/render/robotLayout.ts`, replace the header comment:

```ts
/**
 * Pure render rules for robots (farmclaws part 1 spec §7): which meshes a robot shows, how it
 * poses in each power state, its action clips, shared-tile offsets, movement timing and idle bob.
 */
```

with:

```ts
/**
 * Pure render rules for robots (farmclaws part 1 spec §7): which meshes a robot shows, how it
 * poses in each power state, its action clips, shared-tile offsets, movement timing and idle bob.
 * Part 2 spec §9 adds the dizzy spin and how bright a robot's eyes are while it is off.
 */
```

Append at the end of `src/render/robotLayout.ts`:

```ts
// ---------------------------------------------------------------------------
// Turned off (farmclaws part 2 spec §9)
// ---------------------------------------------------------------------------

/** A robot that gets dizzy spins once, a full yaw turn, over this many real seconds. */
export const DIZZY_SPIN_SECONDS = 1;

/** Yaw added `t` seconds into the dizzy spin: eases from 0 up to a full turn, and is 0 before and after. */
export function dizzySpin(t: number): number {
  if (t <= 0 || t >= DIZZY_SPIN_SECONDS) return 0;
  const s = t / DIZZY_SPIN_SECONDS;
  return s * s * (3 - 2 * s) * Math.PI * 2;
}

/** Eye brightness for each look: lit, dimmed, out. */
const EYE_LIT = 1;
const EYE_DIM = 0.5;
const EYE_OUT = 0;

/**
 * How bright a robot's eyes are: lit while working, dimmed on standby or while turned off (a
 * dizzy or done robot sits like a standby one), out when flat, broken or away for repair.
 */
export function eyeLevel(power: RobotPower, off: Robot['off']): number {
  if (power === 'flat' || power === 'broken' || power === 'repairing') return EYE_OUT;
  return power === 'working' && off === null ? EYE_LIT : EYE_DIM;
}

/**
 * True when `next` got dizzy since the last sync. With no earlier robot (a load, a rebuild, a
 * new robot) there was no transition, so nothing spins.
 */
export function startsDizzySpin(prev: Robot | undefined, next: Robot): boolean {
  return prev !== undefined && prev.off !== 'dizzy' && next.off === 'dizzy';
}
```

In `src/render/RobotRenderer.ts`:

1. In the header comment, replace

```ts
 * - A carried robot is drawn above the player's visual position (the carryAnchor callback).
 */
```

with

```ts
 * - A carried robot is drawn above the player's visual position (the carryAnchor callback).
 * - A robot that just got dizzy spins once (robotLayout.dizzySpin; never on a rebuild). Eyes
 *   follow robotLayout.eyeLevel, so dizzy and done robots look like standby ones and don't bob.
 */
```

2. Replace the whole `./robotLayout` import block (from `import {` at ~line 23 to `} from './robotLayout';`) with:

```ts
import {
  BADGE_HEIGHT,
  BADGE_SECONDS,
  CARRY_HEIGHT,
  CARRY_SCALE,
  CLIP_SECONDS,
  DIZZY_SPIN_SECONDS,
  EYE_COLORS,
  MAX_MOVE_SECONDS,
  ROBOT_MESH_IDS,
  SIZE_SCALE,
  SPARK_HEIGHT,
  SPARK_SECONDS,
  STILL,
  clipFor,
  clipOffsets,
  dizzySpin,
  eyeLevel,
  idleBob,
  moveSeconds,
  robotMeshes,
  robotPose,
  sharedOffsetXZ,
  sharedTileOffsets,
  startsDizzySpin,
  type EyeState,
  type RobotClip,
  type RobotMeshId,
} from './robotLayout';
```

3. In `interface Visual`, replace

```ts
  sparkT: number;
```

with

```ts
  sparkT: number;
  /** Seconds into the dizzy spin; DIZZY_SPIN_SECONDS or more when not spinning. */
  spinT: number;
```

4. Directly after `function groundOf(…) { … }` add:

```ts
/** The eye colour for a robotLayout.eyeLevel: full is lit, anything between is dim, 0 is out. */
function eyeState(level: number): EyeState {
  if (level >= 1) return 'lit';
  return level > 0 ? 'dim' : 'off';
}
```

5. In `sync`, replace

```ts
        groundY, offset: 0, clip: null, clipT: CLIP_SECONDS, badgeT: BADGE_SECONDS, sparkT: 0,
```

with

```ts
        groundY, offset: 0, clip: null, clipT: CLIP_SECONDS, badgeT: BADGE_SECONDS, sparkT: 0, spinT: DIZZY_SPIN_SECONDS,
```

6. In `sync`, replace

```ts
      Object.assign(visual, {
        robot,
        groundY,
```

with

```ts
      // visual.robot is still the robot as it was at the last sync.
      if (!snap && startsDizzySpin(visual.robot, robot)) visual.spinT = 0;
      Object.assign(visual, {
        robot,
        groundY,
```

7. In `resetEffects`, replace

```ts
      visual.badgeT = BADGE_SECONDS;
```

with

```ts
      visual.badgeT = BADGE_SECONDS;
      visual.spinT = DIZZY_SPIN_SECONDS;
```

8. In `animate`, replace

```ts
    v.badgeT += dt;
```

with

```ts
    v.badgeT += dt;
    v.spinT += dt;
```

9. In `animate`, replace

```ts
      const bob = robot.power === 'working' ? idleBob(elapsed, robot.id) : 0;
```

with

```ts
      const bob = robot.power === 'working' && robot.off === null ? idleBob(elapsed, robot.id) : 0;
```

10. In `animate`, replace

```ts
    euler.set(clip.pitch, v.yaw, pose.tilt);
```

with

```ts
    euler.set(clip.pitch, v.yaw + dizzySpin(v.spinT), pose.tilt);
```

11. In `animate`, replace

```ts
    this.meshes.eyes.setColor(robot.id, color.setHex(EYE_COLORS[pose.eyes]));
```

with

```ts
    this.meshes.eyes.setColor(robot.id, color.setHex(EYE_COLORS[eyeState(eyeLevel(robot.power, robot.off))]));
```

(`robotPose(…).eyes` stays in the pose for its own tests; the renderer now reads eyes from `eyeLevel`. The on-screen check of the spin and the dimmed eyes is the playbook's check 3 in Task 11.)

- [ ] **Step 4: Run it and see it pass**

Run: `npx vitest run tests/robotRender.test.ts`
Expected: PASS.

- [ ] **Step 5: The full gate**

Run: `npm run typecheck && npm test && npm run build`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/render/robotLayout.ts src/render/RobotRenderer.ts tests/robotRender.test.ts
git commit -m "Farmclaws part 2: dizzy robots spin once, and robots that are off dim their eyes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Development hooks

**Files:**
- Modify: `src/dev/robotDev.ts` (whole file shown below: header, imports, a new pure section before `withBurnerKnown`, `RobotDevHandle`, and the hooks inside `installRobotDev`)
- Test: `tests/robotDev.test.ts` (extend; whole file shown below)

**Interfaces:**
- Consumes:
  - `checkProgram(program: RobotProgram, robot: Pick<Robot, 'size' | 'parts'>): string | null`, `checkMd(md: readonly MdCard[], robot: Pick<Robot, 'size'>): string | null`, `isValidZoneRect(rect: ZoneRect): boolean` (Task 2, `src/robots/check.ts`)
  - `b` (Task 2, `src/robots/blocks.ts`)
  - `freshExec(program: BlockProgram): RobotExec` (Task 3), `morningExec(program: BlockProgram): RobotExec` (Task 7), both `src/robots/exec.ts`
  - `isProgramShape(v: unknown): v is RobotProgram`, `isMdShape(v: unknown): v is readonly MdCard[]` (Task 3, `src/state/robotValidation.ts`)
  - `Robot.exec`, `Robot.md`, `Robot.off`, `RobotsState.zones` (Task 3); `ZONE_IDS`, `ZoneId`, `ZoneRect`, `MdCard`, `RobotProgram` (Task 1); `withZones` in `tests/testUtils.ts` (Task 3)
  - Part 1: `periodFor`, `withRobot`, `actions.load`, `isInt`, `isObj`, `isOneOf`
- Produces (in `src/dev/robotDev.ts`):
  - `export function programmedRobot(robot: Robot, program: RobotProgram, minuteOfDay: number): Robot | string`
  - `export function withMd(robot: Robot, md: readonly MdCard[]): Robot | string`
  - `export function withZone(state: GameState, id: ZoneId, rect: ZoneRect | null): GameState | string`
  - hooks on `window.__meadowlight`: `setProgram(name, program)`, `setMd(name, cards)`, `setZone(id, rect | null)`, `blocks: b`
  - Task 11 uses `programmedRobot` and `withMd` to set up block robots in tests.

Rules this task settles (Task 11 copies them into the spec):
- `programmedRobot` also sets `nextActMinute` to `minuteOfDay + periodFor(robot)`, as `addRobot` does, so a robot that was mid-`Wait` starts its new program one period later. A script counts as running: its robot works from step 0.
- `withMd` forgets today's carried-out DO cards (`doneCards: []`, since old indices may name other cards now) and stops a DO return under way (its card may be gone): the frames empty and a working robot goes to standby.

- [ ] **Step 1: Write the failing test**

Replace `tests/robotDev.test.ts` with (the first two `describe` blocks are the existing ones, unchanged):

```ts
import { describe, expect, it } from 'vitest';
import { ROBOTS, TIME } from '../src/config';
import { Direction, type MdCard, type RobotAction, type RobotPlace, type RobotProgram, type ZoneRect } from '../src/core/types';
import { programmedRobot, scriptedRobotSpec, withMd, withZone } from '../src/dev/robotDev';
import { b } from '../src/robots/blocks';
import { checkMd, checkProgram } from '../src/robots/check';
import { addRobot } from '../src/robots/create';
import { freshExec, morningExec } from '../src/robots/exec';
import { BASE, TARGET, robotOf, withZones } from './testUtils';

const AT: RobotPlace = { tx: TARGET.tx, tz: TARGET.tz, facing: Direction.South };
const STEPS: RobotAction[] = [{ kind: 'water' }, { kind: 'move' }];

describe('scriptedRobotSpec', () => {
  it('fills in the defaults', () => {
    expect(scriptedRobotSpec({ steps: STEPS, parts: ['wateringHead'] }, AT)).toEqual({
      name: 'Scripty',
      size: 'mini',
      parts: ['wateringHead'],
      place: AT,
      program: { kind: 'script', steps: STEPS, loop: true },
    });
  });

  it('keeps explicit values, including loop: false', () => {
    const spec = scriptedRobotSpec({ steps: STEPS, parts: ['claw', 'basket'], name: 'Bo', size: 'standard', loop: false }, AT);
    expect(spec.name).toBe('Bo');
    expect(spec.size).toBe('standard');
    expect(spec.program).toEqual({ kind: 'script', steps: STEPS, loop: false });
  });
});

describe('addRobot with a scripted spec', () => {
  it('accepts the default spec at a clear tile', () => {
    const result = addRobot(BASE, scriptedRobotSpec({ steps: STEPS, parts: ['wateringHead'] }, AT));
    expect('error' in result).toBe(false);
  });

  it('rejects an invalid step', () => {
    const bad = [{ kind: 'dance' }] as unknown as RobotAction[];
    const result = addRobot(BASE, scriptedRobotSpec({ steps: bad, parts: ['claw'] }, AT));
    expect(result).toEqual({ error: 'That program is not a valid script.' });
  });

  it('rejects an empty script', () => {
    const result = addRobot(BASE, scriptedRobotSpec({ steps: [], parts: ['claw'] }, AT));
    expect('error' in result).toBe(true);
  });

  it('returns an error instead of throwing for an unknown size', () => {
    const spec = scriptedRobotSpec({ steps: STEPS, parts: ['claw'], size: 'huge' as never }, AT);
    expect(addRobot(BASE, spec)).toEqual({ error: "A robot's size is one of mini, standard, big." });
  });

  it('returns an error instead of throwing for a bad place', () => {
    const msg = { error: 'A robot needs a place: tx, tz and facing.' };
    expect(addRobot(BASE, scriptedRobotSpec({ steps: STEPS, parts: ['claw'] }, null as never))).toEqual(msg);
    expect(addRobot(BASE, scriptedRobotSpec({ steps: STEPS, parts: ['claw'] }, { tx: 1.5, tz: 2, facing: Direction.South }))).toEqual(msg);
    expect(addRobot(BASE, scriptedRobotSpec({ steps: STEPS, parts: ['claw'] }, { tx: 5, tz: 10, facing: 9 as never }))).toEqual(msg);
  });
});

// Part 2 (spec §12): programs, .MDs and zones from the console.

const PROGRAM_USAGE = 'Usage: setProgram(name, blocks.program({ stacks: [blocks.when(blocks.morning(), blocks.move())] }))';
const MD_USAGE = "Usage: setMd(name, [{ kind: 'dontGoIntoWater' }, { kind: 'doReturn', to: { kind: 'generator' }, minute: 1080 }])";
const ZONE_USAGE = "Usage: setZone('A', { x0, z0, w, d }) sets a zone and setZone('A', null) clears it. Zones are A to H.";
const ZONE_OFF_FARM = 'A zone is at least 1 × 1 tile and lies wholly inside the farm.';

const WALK = b.program({ stacks: [b.when(b.morning(), b.move())] });
/** A Mini's first act of the day without a quick core: 6:04. */
const FIRST_ACT = TIME.dayStartMinute + ROBOTS.period;
const RETURN: MdCard = { kind: 'doReturn', to: { kind: 'generator' }, minute: 18 * 60 };

describe('programmedRobot', () => {
  it("starts the morning stack up to the robot's first act of the day", () => {
    const robot = robotOf({ power: 'standby', off: 'dizzy' });
    expect(programmedRobot(robot, WALK, FIRST_ACT)).toEqual({
      ...robot,
      program: WALK,
      pc: 0,
      exec: morningExec(WALK),
      off: null,
      power: 'working',
      nextActMinute: FIRST_ACT + ROBOTS.period,
    });
  });

  it('leaves the robot idle a minute later, waiting for a trigger', () => {
    expect(programmedRobot(robotOf(), WALK, FIRST_ACT + 1)).toMatchObject({
      exec: freshExec(WALK),
      power: 'standby',
      nextActMinute: FIRST_ACT + 1 + ROBOTS.period,
    });
  });

  it("moves the cut-off to a quick core's earlier first act", () => {
    const quick = robotOf({ parts: ['quickCore'] });
    const cutOff = TIME.dayStartMinute + ROBOTS.quickCorePeriod;
    expect(programmedRobot(quick, WALK, cutOff)).toMatchObject({ exec: morningExec(WALK), power: 'working' });
    expect(programmedRobot(quick, WALK, cutOff + 1)).toMatchObject({ exec: freshExec(WALK), power: 'standby' });
  });

  it('stands by at 6:00 when no stack starts in the morning', () => {
    const polling = b.program({ stacks: [b.when(b.every(15), b.move())] });
    expect(programmedRobot(robotOf(), polling, TIME.dayStartMinute)).toMatchObject({ exec: freshExec(polling), power: 'standby' });
  });

  it('runs a script from its first step, with no exec', () => {
    const script: RobotProgram = { kind: 'script', steps: STEPS, loop: false };
    expect(programmedRobot(robotOf({ power: 'standby' }), script, 900)).toMatchObject({ program: script, pc: 0, exec: null, power: 'working', off: null });
  });

  it('keeps the power of a flat, broken or repairing robot', () => {
    for (const power of ['flat', 'broken', 'repairing'] as const) {
      expect(programmedRobot(robotOf({ power, tokens: 0 }), WALK, TIME.dayStartMinute)).toMatchObject({ power, exec: morningExec(WALK) });
    }
  });

  it("returns the checker's sentence for a program the robot can't hold", () => {
    // One trigger and twelve moves: 13 blocks on a 12-block Mini.
    const tooLong = b.program({ stacks: [b.when(b.morning(), ...Array.from({ length: ROBOTS.sizes.mini.blocks }, () => b.move()))] });
    const problem = checkProgram(tooLong, robotOf());
    expect(typeof problem).toBe('string');
    expect(programmedRobot(robotOf(), tooLong, TIME.dayStartMinute)).toBe(problem);
  });

  it("returns the usage for something that isn't a program", () => {
    for (const junk of [42, null, 'move', { kind: 'blocks' }]) {
      expect(programmedRobot(robotOf(), junk as never, TIME.dayStartMinute)).toBe(PROGRAM_USAGE);
    }
  });
});

describe('withMd', () => {
  it('sets the cards', () => {
    const cards: MdCard[] = [{ kind: 'dontGoIntoWater' }, RETURN];
    expect(withMd(robotOf(), cards)).toEqual({ ...robotOf(), md: cards });
  });

  it("forgets today's carried-out DO cards and stops a DO return under way", () => {
    const programmed = programmedRobot(robotOf(), WALK, TIME.dayStartMinute);
    if (typeof programmed === 'string') throw new Error(programmed);
    const returning = {
      ...programmed,
      md: [RETURN],
      exec: { ...freshExec(WALK), frames: [{ kind: 'route' as const, target: { tx: 9, tz: 6 }, path: [], why: 'doReturn' as const }], doneCards: [0] },
    };
    expect(withMd(returning, [{ kind: 'dontGoIntoWater' }])).toMatchObject({
      md: [{ kind: 'dontGoIntoWater' }],
      power: 'standby',
      exec: { ...freshExec(WALK), frames: [], doneCards: [] },
    });
  });

  it('leaves a running program running', () => {
    const programmed = programmedRobot(robotOf(), WALK, TIME.dayStartMinute);
    if (typeof programmed === 'string') throw new Error(programmed);
    expect(withMd(programmed, [RETURN])).toEqual({ ...programmed, md: [RETURN], exec: { ...morningExec(WALK), doneCards: [] } });
  });

  it("returns the checker's sentence for cards the robot can't hold", () => {
    // A Mini's .MD holds 3 cards.
    const four: MdCard[] = [{ kind: 'dontGoIntoWater' }, { kind: 'dontLeave', zone: 'A' }, { kind: 'dontLeave', zone: 'B' }, { kind: 'dontHarvest', cropId: 'pumpkin' }];
    const problem = checkMd(four, robotOf());
    expect(typeof problem).toBe('string');
    expect(withMd(robotOf(), four)).toBe(problem);
  });

  it("returns the usage for something that isn't a list of cards", () => {
    for (const junk of [42, null, 'water', [{ kind: 'dance' }]]) expect(withMd(robotOf(), junk as never)).toBe(MD_USAGE);
  });
});

describe('withZone', () => {
  const RECT: ZoneRect = { x0: 4, z0: 9, w: 3, d: 3 };

  it('sets a zone and leaves the others alone', () => {
    const next = withZone(BASE, 'A', RECT);
    if (typeof next === 'string') throw new Error(next);
    expect(next.robots.zones).toEqual({ ...BASE.robots.zones, A: RECT });
  });

  it('clears a zone with null', () => {
    const next = withZone(withZones(BASE, { A: RECT }), 'A', null);
    if (typeof next === 'string') throw new Error(next);
    expect(next.robots.zones.A).toBeNull();
  });

  it("keeps only the rectangle's own fields", () => {
    const next = withZone(BASE, 'B', { ...RECT, colour: 'red' } as ZoneRect);
    if (typeof next === 'string') throw new Error(next);
    expect(next.robots.zones.B).toEqual(RECT);
  });

  it('answers an unknown zone or a malformed rectangle with the usage', () => {
    expect(withZone(BASE, 'Z' as never, RECT)).toBe(ZONE_USAGE);
    expect(withZone(BASE, 'A', { ...RECT, x0: 1.5 })).toBe(ZONE_USAGE);
    expect(withZone(BASE, 'A', undefined as never)).toBe(ZONE_USAGE);
    expect(withZone(BASE, 'A', 'A1' as never)).toBe(ZONE_USAGE);
  });

  it('refuses a rectangle that is empty or leaves the farm', () => {
    expect(withZone(BASE, 'A', { ...RECT, w: 0 })).toBe(ZONE_OFF_FARM);
    expect(withZone(BASE, 'A', { ...RECT, d: 0 })).toBe(ZONE_OFF_FARM);
    expect(withZone(BASE, 'A', { ...RECT, x0: -1 })).toBe(ZONE_OFF_FARM);
    expect(withZone(BASE, 'A', { x0: 46, z0: 9, w: 5, d: 1 })).toBe(ZONE_OFF_FARM);
  });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run tests/robotDev.test.ts`
Expected: FAIL. The part 1 cases pass; `programmedRobot`, `withMd` and `withZone` are not exported yet ("programmedRobot is not a function").

- [ ] **Step 3: Implement**

Replace `src/dev/robotDev.ts` with:

```ts
/**
 * Development-only robot hooks (farmclaws part 1 spec §8.4, part 2 spec §12). main.ts imports
 * this only when import.meta.env.DEV is true, so production builds contain none of it.
 */
import { TIME } from '../config';
import type { Store } from '../core/store';
import {
  CRAFTING_RECIPE_IDS,
  ZONE_IDS,
  type GameState,
  type MdCard,
  type Robot,
  type RobotAction,
  type RobotPartId,
  type RobotPlace,
  type RobotProgram,
  type RobotSize,
  type ZoneId,
  type ZoneRect,
} from '../core/types';
import { b } from '../robots/blocks';
import { checkMd, checkProgram, isValidZoneRect } from '../robots/check';
import { addRobot, type RobotSpec } from '../robots/create';
import { freshExec, morningExec } from '../robots/exec';
import { robotSays, whatHappened } from '../robots/logText';
import { periodFor } from '../robots/stats';
import { withRobot } from '../robots/world';
import { actions, type GameAction } from '../state/actions';
import { isMdShape, isProgramShape } from '../state/robotValidation';
import { selectTargetTile } from '../state/selectors';
import { isInt, isObj, isOneOf } from '../state/validation';

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

export type ScriptedRobotInput = {
  readonly steps: readonly RobotAction[];
  readonly parts: readonly RobotPartId[];
  readonly name?: string;
  readonly size?: RobotSize;
  readonly loop?: boolean;
  readonly place?: RobotPlace;
};

const SCRIPTED_USAGE = "Usage: addScriptedRobot({ steps: [{ kind: 'move' }], parts: ['claw'], name?, size?, loop?, place? })";

/** Turns console input into a spec, filling in the defaults (name 'Scripty', size 'mini', loop true). */
export function scriptedRobotSpec(input: ScriptedRobotInput, at: RobotPlace): RobotSpec {
  return {
    name: input.name ?? 'Scripty',
    size: input.size ?? 'mini',
    parts: input.parts,
    place: at,
    program: { kind: 'script', steps: input.steps, loop: input.loop ?? true },
  };
}

function isScriptedInput(v: unknown): v is ScriptedRobotInput {
  return typeof v === 'object' && v !== null && Array.isArray((v as Record<string, unknown>).steps) && Array.isArray((v as Record<string, unknown>).parts);
}

// ---------------------------------------------------------------------------
// Programs, .MDs and zones (part 2 spec §12). Pure, so the tests need no window. The workbench
// (part 3) will call the same checker and the same exec rebuild.
// ---------------------------------------------------------------------------

const PROGRAM_USAGE = 'Usage: setProgram(name, blocks.program({ stacks: [blocks.when(blocks.morning(), blocks.move())] }))';
const MD_USAGE = "Usage: setMd(name, [{ kind: 'dontGoIntoWater' }, { kind: 'doReturn', to: { kind: 'generator' }, minute: 1080 }])";
const ZONE_USAGE = "Usage: setZone('A', { x0, z0, w, d }) sets a zone and setZone('A', null) clears it. Zones are A to H.";
const ZONE_OFF_FARM = 'A zone is at least 1 × 1 tile and lies wholly inside the farm.';

/** Powers a new program doesn't change: the robot needs charging, rescuing or repairing first. */
const KEPT_POWERS: ReadonlySet<Robot['power']> = new Set<Robot['power']>(['flat', 'broken', 'repairing']);

/**
 * `robot` with a new program, set up the way the morning reset would (spec §12). A block
 * program starts its `morning` stack only if `minuteOfDay` is no later than the robot's first
 * act of the day (TIME.dayStartMinute + its period); later it idles until a trigger fires. A
 * script runs from step 0. Either way the robot turns back on and acts one period from now; a
 * flat, broken or repairing robot keeps its power. Returns the checker's sentence instead when
 * the program fails, or the usage when it isn't a program at all.
 */
export function programmedRobot(robot: Robot, program: RobotProgram, minuteOfDay: number): Robot | string {
  if (!isProgramShape(program)) return PROGRAM_USAGE;
  const problem = checkProgram(program, robot);
  if (problem !== null) return problem;
  const early = minuteOfDay <= TIME.dayStartMinute + periodFor(robot);
  const exec = program.kind === 'blocks' ? (early ? morningExec(program) : freshExec(program)) : null;
  const runs = exec === null || exec.running !== null;
  return {
    ...robot,
    program,
    pc: 0,
    exec,
    off: null,
    power: KEPT_POWERS.has(robot.power) ? robot.power : runs ? 'working' : 'standby',
    nextActMinute: minuteOfDay + periodFor(robot),
  };
}

/**
 * `robot` with a new .MD. The cards apply at once: today's carried-out DO cards are forgotten
 * (their indices may name other cards now), and a DO return under way stops, because its card
 * may be gone; a working robot then stands by until a trigger or a DO card moves it.
 */
export function withMd(robot: Robot, md: readonly MdCard[]): Robot | string {
  if (!isMdShape(md)) return MD_USAGE;
  const problem = checkMd(md, robot);
  if (problem !== null) return problem;
  const exec = robot.exec;
  if (exec === null) return { ...robot, md };
  const returning = exec.running === null && exec.frames.length > 0;
  return {
    ...robot,
    md,
    exec: { ...exec, frames: returning ? [] : exec.frames, doneCards: [] },
    power: returning && robot.power === 'working' ? 'standby' : robot.power,
  };
}

function isZoneRectShape(v: unknown): v is ZoneRect {
  return isObj(v) && isInt(v.x0) && isInt(v.z0) && isInt(v.w) && isInt(v.d);
}

/** `state` with zone `id` set to `rect` (only its four fields) or cleared with null. */
export function withZone(state: GameState, id: ZoneId, rect: ZoneRect | null): GameState | string {
  if (!isOneOf(id, ZONE_IDS) || (rect !== null && !isZoneRectShape(rect))) return ZONE_USAGE;
  if (rect !== null && !isValidZoneRect(rect)) return ZONE_OFF_FARM;
  const zone: ZoneRect | null = rect === null ? null : { x0: rect.x0, z0: rect.z0, w: rect.w, d: rect.d };
  return { ...state, robots: { ...state.robots, zones: { ...state.robots.zones, [id]: zone } } };
}

/** The robot called `name` (the most recently added one if several share it). */
function robotNamed(state: GameState, name: unknown): Robot | null {
  if (typeof name !== 'string') return null;
  return [...state.robots.list].reverse().find((r) => r.name === name) ?? null;
}

function withBurnerKnown(state: GameState): GameState {
  if (state.crafting.known.includes('woodBurner')) return state;
  const known = CRAFTING_RECIPE_IDS.filter((id) => id === 'woodBurner' || state.crafting.known.includes(id));
  return { ...state, crafting: { known } };
}

/** The dev handle once these hooks are attached. Declared here, not in main.ts, so no hook names reach the production source maps. */
type RobotDevHandle = {
  readonly addRobot: (preset: RobotPresetId, place?: RobotPlace) => string;
  readonly addScriptedRobot: (input: ScriptedRobotInput) => string;
  readonly robotLog: () => void;
  readonly setProgram: (name: string, program: RobotProgram) => string;
  readonly setMd: (name: string, cards: readonly MdCard[]) => string;
  readonly setZone: (id: ZoneId, rect: ZoneRect | null) => string;
  readonly blocks: typeof b;
};

export function installRobotDev(store: Store<GameState, GameAction>): void {
  const handle = window.__meadowlight;
  if (handle === undefined) return;

  /** Teaches the wood burner, adds each spec (built for the delivery tile) and loads the result; returns the message to print. */
  const deliver = (specsAt: (at: RobotPlace) => RobotSpec[], place?: RobotPlace): string => {
    let state = withBurnerKnown(store.getState());
    const target = selectTargetTile(state) ?? { tx: state.player.tx, tz: state.player.tz };
    const at = place ?? { tx: target.tx, tz: target.tz, facing: state.player.facing };
    const added: string[] = [];
    for (const spec of specsAt(at)) {
      const result = addRobot(state, spec);
      if ('error' in result) return result.error;
      state = result.state;
      added.push(spec.name);
    }
    store.dispatch(actions.load(state));
    return `Added ${added.join(' and ')}.`;
  };

  const add = (preset: RobotPresetId, place?: RobotPlace): string => deliver((at) => presetSpecs(preset, at), place);

  const addScripted = (input: ScriptedRobotInput): string =>
    isScriptedInput(input) ? deliver((at) => [scriptedRobotSpec(input, at)], input.place) : SCRIPTED_USAGE;

  /** Changes the robot called `name` and loads the result once; returns the message to print. */
  const reprogram = (name: string, change: (robot: Robot, state: GameState) => Robot | string, done: string): string => {
    const state = store.getState();
    const robot = robotNamed(state, name);
    if (robot === null) return `No robot is called ${String(name)}.`;
    const next = change(robot, state);
    if (typeof next === 'string') return next;
    store.dispatch(actions.load(withRobot(state, next)));
    return done;
  };

  const setProgram = (name: string, program: RobotProgram): string =>
    reprogram(name, (robot, state) => programmedRobot(robot, program, state.time.minuteOfDay), `Programmed ${name}.`);

  const setMd = (name: string, cards: readonly MdCard[]): string => reprogram(name, (robot) => withMd(robot, cards), `Set ${name}'s .MD.`);

  const setZone = (id: ZoneId, rect: ZoneRect | null): string => {
    const next = withZone(store.getState(), id, rect);
    if (typeof next === 'string') return next;
    store.dispatch(actions.load(next));
    return rect === null ? `Cleared Zone ${id}.` : `Set Zone ${id}.`;
  };

  const log = (): void => {
    const state = store.getState();
    const names = new Map(state.robots.list.map((r) => [r.id, r.name]));
    const rows = state.robots.log.entries.map((e) => {
      const who = `${names.get(e.robotId) ?? `Robot ${e.robotId}`} (day ${e.day}, minute ${e.minute}${e.count > 1 ? `, x${e.count}` : ''})`;
      return { 'Robot says': `${who}: ${robotSays(e)}`, 'What happened': whatHappened(e, names) };
    });
    console.table(rows);
  };

  const hooks: RobotDevHandle = { addRobot: add, addScriptedRobot: addScripted, robotLog: log, setProgram, setMd, setZone, blocks: b };
  Object.assign(handle, hooks);
}
```

- [ ] **Step 4: Run it and see it pass**

Run: `npx vitest run tests/robotDev.test.ts`
Expected: PASS.

- [ ] **Step 5: The full gate**

Run: `npm run typecheck && npm test && npm run build && ! grep -rl "robotLog\|installRobotDev\|addScriptedRobot\|setMd\|setZone" dist/`
Expected: all green, and the final `grep` finds nothing: no hook code in `dist/`. The check names `addScriptedRobot`, `setMd` and `setZone` but not `setProgram`: three.js's `WebGLRenderer` has its own internal `setProgram`, which the bundle's source map always carries, so that name would be a false positive.

- [ ] **Step 6: Commit**

```bash
git add src/dev/robotDev.ts tests/robotDev.test.ts
git commit -m "Farmclaws part 2: setProgram, setMd, setZone and the block builder in the dev console

Rulings: a programmed robot acts one period after the call, as addRobot does,
and a script counts as running. setMd forgets today's carried-out DO cards and
stops a DO return under way, since its card may be gone. The dist check gains
addScriptedRobot, setMd and setZone but not setProgram, which three.js's own
WebGLRenderer uses internally.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Whole-system checks, the playbook and the spec sync

**Files:**
- Create: `tests/programGen.ts`, `tests/robotInterpretSafety.test.ts`, `tests/robotFaithful.test.ts`
- Modify: `tests/robotDeterminism.test.ts` (whole file shown), `tests/robotTickBatching.test.ts` (whole file shown)
- Create: `.claude/skills/game-driven-qa/scenarios/farmclaws-part2.md`
- Modify: `.claude/skills/game-driven-qa/SKILL.md` (quick-reference rows after the `Add robots` row; one gotcha row)
- Modify: `docs/superpowers/specs/2026-10-02-farmclaws-part2-language.md` (spec sync)

**Interfaces:**
- Consumes:
  - `b` (Task 2), `checkProgram` (Task 2), `blockCount(program: BlockProgram): number` and `statementDepth(program: BlockProgram): number` (Task 2, `src/robots/program.ts`; per R5 `statementDepth` already counts a route frame for `goTo` / `forEachTile`)
  - `isValidExec(v: unknown, program: BlockProgram): v is RobotExec` (Task 3), `withZones(state, zones)` (Task 3, `tests/testUtils.ts`), `RobotSpec` (Task 3)
  - `stepProgram(state: GameState, robot: Robot): Step` (Task 6)
  - The new `RobotLogEvent` kinds `skipped`, `dizzy`, `gaveUp`, `woke`, `doReturn`, `doPowerDown`, `conflict` and `robotSays` for them (Task 7)
  - `runRobotsMinute` / `tick` / `startNextDay` running block robots (Task 8)
  - `programmedRobot(robot, program, minuteOfDay)`, `withMd(robot, md)` (Task 10)
  - Part 1: `addRobot`, `requireRobot`, `withRobot`, `bagCount`, `actionCost`, `robotSays`, `serializeGame`, `deserializeGame`, `gameReducer`, `actions`, `createStore`, `createActionRecorder`, `mulberry32`, `chebyshevDistance`, `EMPTY_TILE`, `blockedTile`, test helpers.
- Produces (test-only, `tests/programGen.ts`): `type Rng`, `int`, `pick`, `chance`, `SAFETY_BODY`, `SAFE_AREA`, `randomProgram(rng: Rng): BlockProgram`, `programmed(robot, program, md?, minuteOfDay?): Robot`, `interface BlockRobotSpec`, `addBlockRobot(state, spec): GameState`.

The tests in this task pin behaviour that Tasks 1–10 built. They are expected to pass as soon as they're written; a failure is a bug in that earlier code, not in the test, unless the spec supports what the game did.

- [ ] **Step 1: Write the whole-system tests**

Create `tests/programGen.ts`:

```ts
/**
 * Test-only program tools (farmclaws part 2 spec §14.2).
 *
 * - randomProgram: a seeded generator of random, well-typed block programs for the interpreter
 *   safety test. Each program is built to pass checkProgram for SAFETY_BODY: every expression is
 *   made for the type its socket needs, variables are declared before use, a helper only runs
 *   later helpers (so calls never cycle) and literals stay in range. A candidate over the block
 *   or frame limit is thrown away and drawn again.
 * - programmed / addBlockRobot: block robots set up the way setProgram and setMd do it.
 */
import { ROBOTS, TIME } from '../src/config';
import {
  CROP_IDS,
  EVERY_CHOICES,
  VALUE_TYPES,
  ZONE_IDS,
  type ActionBlock,
  type BlockProgram,
  type Expr,
  type GameState,
  type HelperDef,
  type ItemId,
  type MdCard,
  type Robot,
  type RobotPartId,
  type RobotPlace,
  type RobotSize,
  type Statement,
  type Trigger,
  type TriggerStack,
  type ValueType,
  type VarDecl,
} from '../src/core/types';
import { programmedRobot, withMd } from '../src/dev/robotDev';
import { addRobot } from '../src/robots/create';
import { blockCount, statementDepth } from '../src/robots/program';
import { requireRobot, withRobot } from '../src/robots/world';
import { must } from './testUtils';

export type Rng = () => number;

export function int(rng: Rng, lo: number, hi: number): number {
  return lo + Math.floor(rng() * (hi - lo + 1));
}

export function pick<T>(rng: Rng, list: readonly T[]): T {
  return must(list[Math.floor(rng() * list.length)]);
}

export function chance(rng: Rng, p: number): boolean {
  return rng() < p;
}

/**
 * The body every generated program is written for: a Big robot with a claw, a watering head and
 * a sensor eye, so the checker accepts every block (actions whose part is missing, like till,
 * are part 1's runtime noPart mistake).
 */
export const SAFETY_BODY = { size: 'big', parts: ['claw', 'wateringHead', 'sensorEye'] } as const satisfies Pick<Robot, 'size' | 'parts'>;

/** The farm's guaranteed-clear ground south of the house (LAYOUT.clearZones[1]): generated tiles and zones lie here. */
export const SAFE_AREA = { x0: 1, z0: 9, w: 17, d: 9 } as const;

const MAX_VARS = 3;
const MAX_HELPERS = 2;
const MAX_STACKS = 3;
/** Statement lists nested below a stack body; helper bodies get one level less. */
const MAX_NEST = 3;
const MAX_LIST = 3;
const MAX_EXPR_DEPTH = 2;
const ATTEMPTS = 500;
const ITEMS: readonly ItemId[] = ['parsnip', 'potato', 'pumpkin', 'parsnip_seeds', 'wood'];
/** Text literals, `say` included: 1 … maxTextLength characters once trimmed. */
const TEXTS: readonly string[] = ['Hello', '  Beep boop  ', 'Done', 'x'.repeat(ROBOTS.maxTextLength)];
/** A text variable may also start empty (a `say` of it says "…"). */
const TEXT_INITIALS: readonly string[] = ['', ...TEXTS];
/** Action kinds, weighted towards moving so routes and tiles change. */
const ACTIONS: readonly ActionBlock['kind'][] = ['move', 'move', 'move', 'turn', 'turn', 'water', 'harvest', 'till', 'plant', 'refill', 'deposit', 'take', 'say', 'wait', 'powerDown'];

interface Scope {
  readonly rng: Rng;
  readonly vars: readonly VarDecl[];
  /** Helpers a statement here may run. */
  readonly callable: readonly string[];
}

function tileLiteral(rng: Rng): Expr {
  return {
    kind: 'tile',
    tx: int(rng, SAFE_AREA.x0, SAFE_AREA.x0 + SAFE_AREA.w - 1),
    tz: int(rng, SAFE_AREA.z0, SAFE_AREA.z0 + SAFE_AREA.d - 1),
  };
}

function literal(rng: Rng, type: ValueType, texts: readonly string[] = TEXTS): Expr {
  switch (type) {
    case 'number':
      return { kind: 'num', value: chance(rng, 0.1) ? pick(rng, [ROBOTS.maxNumber, -ROBOTS.maxNumber]) : int(rng, -3, 12) };
    case 'text':
      return { kind: 'text', value: pick(rng, texts) };
    case 'yesNo':
      return { kind: 'yes', value: chance(rng, 0.5) };
    case 'item':
      return { kind: 'item', itemId: pick(rng, ITEMS) };
    case 'tile':
      return tileLiteral(rng);
  }
}

/** An expression of `type`; `depth` bounds how far operators nest. */
function expr(s: Scope, type: ValueType, depth: number): Expr {
  const { rng } = s;
  const vars = s.vars.filter((decl) => decl.type === type);
  const options: (() => Expr)[] = [() => literal(rng, type)];
  if (vars.length > 0) options.push(() => ({ kind: 'var', name: pick(rng, vars).name }));
  if (type === 'number') {
    options.push(
      () => ({ kind: 'tokensLeft' }),
      () => ({ kind: 'countInBag', itemId: pick(rng, ITEMS) }),
    );
    if (depth > 0) {
      options.push(() => ({ kind: 'arith', op: pick(rng, ['+', '-', '×'] as const), a: expr(s, 'number', depth - 1), b: expr(s, 'number', depth - 1) }));
    }
  }
  if (type === 'tile') options.push(() => ({ kind: 'myTile' }), () => ({ kind: 'tileAhead' }));
  if (type === 'yesNo') {
    options.push(
      () => ({ kind: 'cropIsReady' }),
      () => ({ kind: 'soilIsDry' }),
      () => ({ kind: 'tileIsTilled' }),
      () => ({ kind: 'cropIs', cropId: pick(rng, CROP_IDS) }),
      () => ({ kind: 'bagIsFull' }),
      () => ({ kind: 'bagHas', itemId: pick(rng, ITEMS) }),
      () => ({ kind: 'atEdgeOf', zone: pick(rng, ZONE_IDS) }),
      () => ({ kind: 'tokensBelow', n: expr(s, 'number', Math.max(0, depth - 1)) }),
      () => ({ kind: 'tileAheadIs', what: pick(rng, ['water', 'blocked', 'clear'] as const) }),
      () => ({ kind: 'itIsRaining' }),
      () => ({ kind: 'timeIsAfter', minute: int(rng, TIME.dayStartMinute, TIME.passOutMinute - 1) }),
    );
    if (depth > 0) {
      options.push(
        () => ({ kind: 'compare', op: pick(rng, ['<', '>'] as const), a: expr(s, 'number', depth - 1), b: expr(s, 'number', depth - 1) }),
        () => {
          const side = pick(rng, VALUE_TYPES);
          return { kind: 'compare', op: pick(rng, ['=', '≠'] as const), a: expr(s, side, depth - 1), b: expr(s, side, depth - 1) };
        },
        () => ({ kind: pick(rng, ['and', 'or'] as const), a: expr(s, 'yesNo', depth - 1), b: expr(s, 'yesNo', depth - 1) }),
        () => ({ kind: 'not', a: expr(s, 'yesNo', depth - 1) }),
      );
    }
  }
  return pick(rng, options)();
}

function action(s: Scope): ActionBlock {
  const { rng } = s;
  const kind = pick(rng, ACTIONS);
  switch (kind) {
    case 'move':
    case 'water':
    case 'harvest':
    case 'till':
    case 'refill':
    case 'deposit':
    case 'powerDown':
      return { kind };
    case 'turn':
      return { kind, side: chance(rng, 0.5) ? 'left' : 'right' };
    case 'plant':
      return { kind, cropId: pick(rng, CROP_IDS) };
    case 'take':
      return { kind, item: expr(s, 'item', 1) };
    case 'say':
      return { kind, text: expr(s, 'text', 1) };
    case 'wait':
      return { kind, minutes: expr(s, 'number', 1) };
  }
}

/** One statement; `nest` is how many more statement lists may open below it. */
function statement(s: Scope, nest: number): Statement {
  const { rng } = s;
  const kinds: Statement['kind'][] = ['do', 'do', 'do', 'do', 'goTo'];
  if (nest > 0) kinds.push('repeatTimes', 'repeatUntil', 'repeatForever', 'if', 'if', 'forEachTile');
  const numbers = s.vars.filter((decl) => decl.type === 'number');
  if (s.vars.length > 0) kinds.push('set');
  if (numbers.length > 0) kinds.push('change');
  if (s.callable.length > 0) kinds.push('runHelper');
  switch (pick(rng, kinds)) {
    case 'do':
      return { kind: 'do', action: action(s) };
    case 'repeatTimes':
      return { kind: 'repeatTimes', times: expr(s, 'number', 1), body: list(s, nest - 1) };
    case 'repeatUntil':
      return { kind: 'repeatUntil', until: expr(s, 'yesNo', MAX_EXPR_DEPTH), body: list(s, nest - 1) };
    case 'repeatForever':
      return { kind: 'repeatForever', body: list(s, nest - 1) };
    case 'if':
      return { kind: 'if', cond: expr(s, 'yesNo', MAX_EXPR_DEPTH), then: list(s, nest - 1), else: chance(rng, 0.5) ? list(s, nest - 1) : null };
    case 'forEachTile':
      return { kind: 'forEachTile', zone: pick(rng, ZONE_IDS), body: list(s, nest - 1) };
    case 'goTo':
      return { kind: 'goTo', tile: expr(s, 'tile', 1) };
    case 'set': {
      const decl = pick(rng, s.vars);
      return { kind: 'set', name: decl.name, value: expr(s, decl.type, 1) };
    }
    case 'change':
      return { kind: 'change', name: pick(rng, numbers).name, by: expr(s, 'number', 1) };
    case 'runHelper':
      return { kind: 'runHelper', name: pick(rng, s.callable) };
  }
}

function list(s: Scope, nest: number): Statement[] {
  return Array.from({ length: int(s.rng, 1, MAX_LIST) }, () => statement(s, nest));
}

function trigger(rng: Rng): Trigger {
  switch (int(rng, 0, 4)) {
    case 0:
      return { kind: 'morning' };
    case 1:
      return { kind: 'atTime', minute: int(rng, TIME.dayStartMinute + 1, TIME.dayStartMinute + 120) };
    case 2:
      return { kind: 'bagFull' };
    case 3:
      return { kind: 'startsRaining' };
    default:
      return { kind: 'every', minutes: pick(rng, EVERY_CHOICES) };
  }
}

function candidate(rng: Rng): BlockProgram {
  const varDecl = (i: number): VarDecl => {
    const type = pick(rng, VALUE_TYPES);
    return { name: `v${i}`, type, initial: literal(rng, type, TEXT_INITIALS) };
  };
  const vars = Array.from({ length: int(rng, 0, MAX_VARS) }, (_, i) => varDecl(i));
  const names = Array.from({ length: int(rng, 0, MAX_HELPERS) }, (_, i) => `h${i}`);
  const helper = (name: string, i: number): HelperDef => ({ name, body: list({ rng, vars, callable: names.slice(i + 1) }, MAX_NEST - 1) });
  const helpers = names.map(helper);
  const top: Scope = { rng, vars, callable: names };
  // The first stack always starts in the morning, so a robot programmed at 6:00 runs at once.
  const stack = (i: number): TriggerStack => ({ trigger: i === 0 ? { kind: 'morning' } : trigger(rng), body: list(top, MAX_NEST) });
  const stacks = Array.from({ length: int(rng, 1, MAX_STACKS) }, (_, i) => stack(i));
  return { kind: 'blocks', vars, stacks, helpers };
}

/** A random program that passes checkProgram for SAFETY_BODY. The same rng state gives the same program. */
export function randomProgram(rng: Rng): BlockProgram {
  const blocks = ROBOTS.sizes[SAFETY_BODY.size].blocks;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const program = candidate(rng);
    if (blockCount(program) <= blocks && statementDepth(program) <= ROBOTS.maxFrames) return program;
  }
  throw new Error(`randomProgram: nothing fitted ${blocks} blocks in ${ATTEMPTS} tries`);
}

/**
 * `robot` running `program` with `md`, set up the way setProgram and setMd do it at
 * `minuteOfDay` (6:00 by default, so a `morning` stack starts). Throws on a program or .MD the
 * checker refuses: that's a bug in the test.
 */
export function programmed(robot: Robot, program: BlockProgram, md: readonly MdCard[] = [], minuteOfDay: number = TIME.dayStartMinute): Robot {
  const withProgram = programmedRobot(robot, program, minuteOfDay);
  if (typeof withProgram === 'string') throw new Error(withProgram);
  const ruled = withMd(withProgram, md);
  if (typeof ruled === 'string') throw new Error(ruled);
  return ruled;
}

export interface BlockRobotSpec {
  readonly name: string;
  readonly size: RobotSize;
  readonly parts: readonly RobotPartId[];
  readonly place: RobotPlace;
  readonly program: BlockProgram;
  readonly md?: readonly MdCard[];
}

/** Adds a fully charged robot with addRobot, then programs it at the state's current minute. Throws on a bad spec. */
export function addBlockRobot(state: GameState, spec: BlockRobotSpec): GameState {
  const added = addRobot(state, { name: spec.name, size: spec.size, parts: spec.parts, place: spec.place, program: spec.program });
  if ('error' in added) throw new Error(added.error);
  const robot = programmed(requireRobot(added.state, added.id), spec.program, spec.md ?? [], state.time.minuteOfDay);
  return withRobot(added.state, robot);
}
```

Create `tests/robotInterpretSafety.test.ts`:

```ts
/**
 * Interpreter safety (farmclaws part 2 spec §14.2): random well-typed programs never make the
 * game throw. Each turn the interpreter acts, finishes its stack or gets dizzy, every exec it
 * returns or the game saves validates, and the farm still saves and loads.
 */
import { describe, expect, it } from 'vitest';
import { INVENTORY, ROBOTS, TIME } from '../src/config';
import { mulberry32 } from '../src/core/hash';
import { Blocker, DIRECTIONS, TileState, Weather, ZONE_IDS, type BlockProgram, type GameState, type Tile, type ZoneId, type ZoneRect } from '../src/core/types';
import { checkProgram } from '../src/robots/check';
import { stepProgram } from '../src/robots/interpret';
import { requireRobot } from '../src/robots/world';
import { actions } from '../src/state/actions';
import { deserializeGame, serializeGame } from '../src/state/persistence';
import { gameReducer } from '../src/state/reducer';
import { isValidExec } from '../src/state/robotValidation';
import { EMPTY_TILE, blockedTile } from '../src/world/tiles';
import { SAFE_AREA, SAFETY_BODY, chance, int, pick, programmed, randomProgram, type Rng } from './programGen';
import { BASE, HEAVY_TEST_TIMEOUT_MS, Violations, atDay, cropOf, matureCrop, robotOf, soilTile, stack, withRobots, withTile, withZones } from './testUtils';

const PROGRAMS = 300;
/** Turns per program: one robot period each, so 30 turns is two game hours from 6:00. */
const TURNS = 30;
/** Every this many programs, the whole farm goes through a save and a load too. */
const SAVE_EVERY = 10;
const START = { tx: 9, tz: 13 } as const;

const TILES: readonly ((rng: Rng) => Tile)[] = [
  () => soilTile(TileState.Plowed),
  (rng) => soilTile(TileState.Watered, matureCrop(pick(rng, ['parsnip', 'potato', 'pumpkin'] as const))),
  () => soilTile(TileState.Plowed, cropOf('parsnip')),
  () => blockedTile(Blocker.Rock, 2),
  () => blockedTile(Blocker.Water),
  () => ({ ...EMPTY_TILE, object: { kind: 'chest', slots: Array.from({ length: INVENTORY.chestSlots }, (_, i) => (i === 0 ? stack('parsnip', 3) : null)) } }),
  () => ({ ...EMPTY_TILE, object: { kind: 'woodBurner', fuel: 0 } }),
];

function randomRect(rng: Rng): ZoneRect {
  const w = int(rng, 1, 4);
  const d = int(rng, 1, 3);
  return { x0: int(rng, SAFE_AREA.x0, SAFE_AREA.x0 + SAFE_AREA.w - w), z0: int(rng, SAFE_AREA.z0, SAFE_AREA.z0 + SAFE_AREA.d - d), w, d };
}

/** A farm at 6:00 with random zones, weather and tiles, and robot 1 running `program` from START. */
function safetyFarm(rng: Rng, program: BlockProgram): GameState {
  const zones: Partial<Record<ZoneId, ZoneRect | null>> = {};
  for (const id of ZONE_IDS) zones[id] = chance(rng, 0.4) ? null : randomRect(rng);
  let state: GameState = {
    ...withZones(atDay(BASE, int(rng, 0, 27), TIME.dayStartMinute), zones),
    weather: pick(rng, [Weather.Sunny, Weather.Rain, Weather.Storm]),
  };
  for (let i = 0; i < 16; i++) {
    const at = { tx: int(rng, SAFE_AREA.x0, SAFE_AREA.x0 + SAFE_AREA.w - 1), tz: int(rng, SAFE_AREA.z0, SAFE_AREA.z0 + SAFE_AREA.d - 1) };
    if (at.tx === START.tx && at.tz === START.tz) continue;
    state = withTile(state, at, pick(rng, TILES)(rng), 'farm');
  }
  const body = robotOf({
    size: SAFETY_BODY.size,
    parts: [...SAFETY_BODY.parts],
    tx: START.tx,
    tz: START.tz,
    facing: pick(rng, DIRECTIONS),
    tokens: pick(rng, [500, 500, 500, 30]),
    tank: int(rng, 0, ROBOTS.tankCapacity),
    bag: [stack('parsnip_seeds', 5)],
  });
  return withRobots(state, [programmed(body, program)]);
}

describe('interpreter safety', () => {
  it(
    'runs random well-typed programs without throwing: every turn acts, finishes or gets dizzy, and every exec validates',
    () => {
      const v = new Violations();
      const rng = mulberry32(20261002);
      const seen = { act: 0, idle: 0, dizzy: 0 };
      for (let i = 0; i < PROGRAMS; i++) {
        const program = randomProgram(rng);
        const problem = checkProgram(program, SAFETY_BODY);
        if (problem !== null) {
          v.list.push(`program ${i} fails the checker: ${problem}`);
          continue;
        }
        let state = safetyFarm(rng, program);
        try {
          for (let turn = 0; turn < TURNS; turn++) {
            const robot = requireRobot(state, 1);
            if (robot.exec !== null && robot.exec.running !== null && robot.power === 'working' && robot.off === null && !robot.carried) {
              const step = stepProgram(state, robot);
              seen[step.kind]++;
              if (step.kind !== 'dizzy') v.check(isValidExec(step.exec, program), () => `program ${i} turn ${turn}: stepProgram returned an invalid exec`);
            }
            state = gameReducer(state, actions.tick(ROBOTS.period));
            const after = requireRobot(state, 1);
            v.check(after.exec !== null && isValidExec(after.exec, program), () => `program ${i} turn ${turn}: the robot's exec is invalid`);
          }
          if (i % SAVE_EVERY === 0) v.check(deserializeGame(serializeGame(state)) !== null, () => `program ${i}: the farm no longer loads`);
        } catch (error) {
          v.list.push(`program ${i} threw: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      expect(v.head()).toEqual([]);
      // The programs really ran: some acted and some finished their stacks.
      expect(seen.act).toBeGreaterThan(0);
      expect(seen.idle).toBeGreaterThan(0);
    },
    HEAVY_TEST_TIMEOUT_MS,
  );
});
```

Create `tests/robotFaithful.test.ts`:

```ts
/**
 * Faithful to a fault (farmclaws design §3.9, part 2 spec §14.1): instructions that sound
 * sensible, carried out exactly. Each test is one row of the design's table that part 2 can
 * express, and asserts the faithful outcome and the log line that explains it. The row "DON'T
 * spend more than 60 tokens a day" waits for that card (part 7).
 *
 * Robots act on their own tile (water, harvest) and the tile ahead (move, refill, deposit). A
 * Mini acts every 4 minutes from 6:04; a Standard pays twice a Mini's costs.
 */
import { describe, expect, it } from 'vitest';
import { INVENTORY, ROBOTS, TIME } from '../src/config';
import { Blocker, Direction, TileState, Weather, type GameState, type ItemId, type MdCard, type RobotLogEvent, type TileCoord } from '../src/core/types';
import { bagCount } from '../src/robots/bag';
import { b } from '../src/robots/blocks';
import { robotSays } from '../src/robots/logText';
import { actionCost } from '../src/robots/stats';
import { requireRobot } from '../src/robots/world';
import { actions } from '../src/state/actions';
import { gameReducer } from '../src/state/reducer';
import { chebyshevDistance } from '../src/world/grid';
import { EMPTY_TILE, blockedTile } from '../src/world/tiles';
import { programmed } from './programGen';
import { BASE, atDay, matureCrop, robotOf, soilTile, tileAt, withRobots, withTile, withZones } from './testUtils';

const MORNING = atDay(BASE, 0, TIME.dayStartMinute);
const SIX_PM = 18 * 60;
/** Zone A in most rows: three tiles in a row, walked west to east. */
const ROW_A = { x0: 4, z0: 12, w: 3, d: 1 } as const;

const tick = (state: GameState, minutes: number): GameState => gameReducer(state, actions.tick(minutes));

/** Every event robot 1 logged, oldest first, with collapsed repeats expanded. */
const eventsOf = (state: GameState): RobotLogEvent[] =>
  state.robots.log.entries.filter((e) => e.robotId === 1).flatMap((e) => Array.from({ length: e.count }, () => e.event));

const repeated = (n: number, event: RobotLogEvent): RobotLogEvent[] => Array.from({ length: n }, () => event);

function chestItems(state: GameState, at: TileCoord): ItemId[] {
  const object = tileAt(state, at, 'farm').object;
  return object?.kind === 'chest' ? object.slots.flatMap((s) => (s === null ? [] : [s.itemId])) : [];
}

/** "For each tile in A: if crop is ready, harvest", started at 6:00. */
const HARVEST_A = b.program({ stacks: [b.when(b.morning(), b.forEach('A', b.if(b.cropIsReady(), [b.harvest()])))] });

describe('faithful to a fault', () => {
  it("DON'T go into water, and a refill trip to the pond: it waters until the tank is empty, then trundles over the dry tiles doing nothing", () => {
    // Refill works from the shore, so the trip that can't happen is the one that ends in the pond:
    // a route never ends on water, with or without the card.
    const pond: TileCoord = { tx: 8, tz: 12 };
    const bed: TileCoord[] = [
      { tx: 4, tz: 12 },
      { tx: 5, tz: 12 },
      { tx: 6, tz: 12 },
      { tx: 6, tz: 13 },
      { tx: 5, tz: 13 },
      { tx: 4, tz: 13 },
    ]; // snake order
    let state = withZones(MORNING, { A: { x0: 4, z0: 12, w: 3, d: 2 } });
    for (const at of bed) state = withTile(state, at, soilTile(TileState.Plowed), 'farm');
    state = withTile(state, pond, blockedTile(Blocker.Water), 'farm');
    const program = b.program({
      stacks: [b.when(b.morning(), b.forEach('A', b.if(b.soilIsDry(), [b.water()])), b.goTo(b.tileAt(pond.tx, pond.tz)), b.refill())],
    });
    const robot = programmed(robotOf({ parts: ['wateringHead'], tank: 3, tx: 4, tz: 12, facing: Direction.East }), program, [{ kind: 'dontGoIntoWater' }]);
    // 15 turns, 6:04 … 7:00: 3 waters, 3 dry waters, 5 moves, 2 turns, the refill, then it finishes.
    const next = tick(withRobots(state, [robot]), 60);

    const W = TileState.Watered;
    const P = TileState.Plowed;
    expect(bed.map((at) => tileAt(next, at, 'farm').state)).toEqual([W, W, W, P, P, P]);
    const after = requireRobot(next, 1);
    expect([after.tank, after.power, after.tokens]).toEqual([0, 'standby', 60]);
    const events = eventsOf(next);
    expect(events.filter((e) => e.kind === 'blocked' && e.action === 'water')).toEqual(repeated(3, { kind: 'blocked', action: 'water', reason: 'tankEmpty' }));
    expect(events).toContainEqual({ kind: 'gaveUp', target: pond, why: 'goTo' });
    expect(events).toContainEqual({ kind: 'blocked', action: 'refill', reason: 'noWaterAhead' });
    expect(events.at(-1)).toEqual({ kind: 'finished' });
  });

  it("DON'T leave Zone A, and a program that deposits into a chest just outside it: the bag fills and every harvest after that fails", () => {
    const front: TileCoord = { tx: 6, tz: 13 };
    const chestAt: TileCoord = { tx: 6, tz: 14 };
    const field = (md: readonly MdCard[]): GameState => {
      let state = withZones(MORNING, { A: ROW_A });
      state = withTile(state, { tx: 4, tz: 12 }, soilTile(TileState.Watered, matureCrop('parsnip')), 'farm');
      for (const tx of [5, 6]) state = withTile(state, { tx, tz: 12 }, soilTile(TileState.Watered, matureCrop('potato')), 'farm');
      const emptyChest = { kind: 'chest' as const, slots: Array.from({ length: INVENTORY.chestSlots }, () => null) };
      state = withTile(state, chestAt, { ...EMPTY_TILE, object: emptyChest }, 'farm');
      const program = b.program({
        stacks: [b.when(b.morning(), b.forEach('A', b.if(b.cropIsReady(), [b.harvest()])), b.goTo(b.tileAt(front.tx, front.tz)), b.deposit())],
      });
      return withRobots(state, [programmed(robotOf({ tx: 4, tz: 12, facing: Direction.East }), program, md)]);
    };

    // A one-stack Mini: the parsnip fills its bag, both potatoes fail, the route out of A is
    // refused, and the deposit faces open grass.
    const fenced = tick(field([{ kind: 'dontLeave', zone: 'A' }]), 30);
    const robot = requireRobot(fenced, 1);
    expect(robot.bag.map((s) => s.itemId)).toEqual(['parsnip']);
    expect([5, 6].map((tx) => tileAt(fenced, { tx, tz: 12 }, 'farm').crop?.cropId)).toEqual(['potato', 'potato']);
    expect(chestItems(fenced, chestAt)).toEqual([]);
    const events = eventsOf(fenced);
    expect(events.filter((e) => e.kind === 'blocked' && e.action === 'harvest')).toEqual(repeated(2, { kind: 'blocked', action: 'harvest', reason: 'bagFull' }));
    expect(events).toContainEqual({ kind: 'gaveUp', target: front, why: 'goTo' });
    expect([robot.tx, robot.tz, robot.power, robot.tokens]).toEqual([6, 12, 'standby', 68]);

    // Without the card the same program reaches the chest.
    const free = tick(field([]), 40);
    expect(chestItems(free, chestAt)).toEqual(['parsnip']);
    expect(requireRobot(free, 1).bag).toEqual([]);
  });

  it('DO power down when the bag is full, on a one-stack Mini in a row of two crops: it stops after its first harvest, every morning', () => {
    // "Full" means every bag stack is in use, so one parsnip fills a one-stack Mini.
    const card: MdCard = { kind: 'doPowerDown', when: { kind: 'bagFull' } };
    let state = withZones(MORNING, { A: ROW_A });
    for (const [tx, crop] of [[4, 'parsnip'], [5, 'parsnip'], [6, 'potato']] as const) {
      state = withTile(state, { tx, tz: 12 }, soilTile(TileState.Watered, matureCrop(crop)), 'farm');
    }
    const next = tick(withRobots(state, [programmed(robotOf({ tx: 4, tz: 12, facing: Direction.East }), HARVEST_A, [card])]), 60);
    const robot = requireRobot(next, 1);
    expect([robot.power, robot.off, robot.tx, robot.tz, robot.tokens]).toEqual(['standby', 'done', 4, 12, 77]);
    expect(robot.bag.map((s) => [s.itemId, s.quantity])).toEqual([['parsnip', 1]]);
    expect([5, 6].map((tx) => tileAt(next, { tx, tz: 12 }, 'farm').crop?.cropId)).toEqual(['parsnip', 'potato']);
    expect(eventsOf(next).at(-1)).toEqual({ kind: 'doPowerDown', card });

    // The morning turns it back on; the bag is still full, so it powers straight down again.
    const morning = gameReducer(next, actions.sleep());
    expect(requireRobot(morning, 1).off).toBeNull();
    expect(requireRobot(tick(morning, ROBOTS.period), 1).off).toBe('done');
  });

  it('DO return to the nearest generator at 6:00 pm: it leaves on the dot, with half the row unharvested', () => {
    const card: MdCard = { kind: 'doReturn', to: { kind: 'generator' }, minute: SIX_PM };
    const burner: TileCoord = { tx: 6, tz: 15 };
    const row: TileCoord[] = [4, 5, 6, 7, 8, 9].map((tx) => ({ tx, tz: 12 }));
    let state = withZones(atDay(BASE, 0, SIX_PM - 24), { A: { x0: 4, z0: 12, w: 6, d: 1 } });
    for (const at of row) state = withTile(state, at, soilTile(TileState.Watered, matureCrop('parsnip')), 'farm');
    state = withTile(state, burner, { ...EMPTY_TILE, object: { kind: 'woodBurner', fuel: 0 } }, 'farm');
    // Programmed at 6:00 and still at it in the evening: it harvests at 17:40, 17:48 and 17:56.
    const robot = programmed(robotOf({ size: 'standard', parts: ['claw', 'basket'], tokens: 200, tx: 4, tz: 12, facing: Direction.East }), HARVEST_A, [card]);
    const next = tick(withRobots(state, [{ ...robot, nextActMinute: SIX_PM - 20 }]), 60);

    expect(row.map((at) => tileAt(next, at, 'farm').crop === null)).toEqual([true, true, true, false, false, false]);
    const after = requireRobot(next, 1);
    expect([after.power, after.off]).toEqual(['standby', 'done']);
    expect(bagCount(after.bag, 'parsnip')).toBe(3);
    expect(chebyshevDistance(after, burner)).toBeLessThanOrEqual(ROBOTS.chargeRadius);
    const returns = next.robots.log.entries.filter((e) => e.event.kind === 'doReturn');
    expect(returns.map((e) => e.event)).toEqual([
      { kind: 'doReturn', card, phase: 'started' },
      { kind: 'doReturn', card, phase: 'arrived' },
    ]);
    expect(returns[0]?.minute).toBe(SIX_PM);
  });

  it('"Harvest everything that\'s ready" harvests the pumpkin you were growing for the Claw Fair', () => {
    const fair = (md: readonly MdCard[]): GameState => {
      let state = withZones(MORNING, { A: ROW_A });
      for (const [tx, crop] of [[4, 'parsnip'], [5, 'pumpkin'], [6, 'parsnip']] as const) {
        state = withTile(state, { tx, tz: 12 }, soilTile(TileState.Watered, matureCrop(crop)), 'farm');
      }
      const robot = robotOf({ size: 'standard', parts: ['claw', 'basket'], tokens: 200, tx: 4, tz: 12, facing: Direction.East });
      return withRobots(state, [programmed(robot, HARVEST_A, md)]);
    };

    const greedy = tick(fair([]), 30);
    const greedyBot = requireRobot(greedy, 1);
    expect([bagCount(greedyBot.bag, 'pumpkin'), bagCount(greedyBot.bag, 'parsnip')]).toEqual([1, 2]);
    expect(tileAt(greedy, { tx: 5, tz: 12 }, 'farm').crop).toBeNull();

    // Once the player closes the gap, the same robot leaves it alone, the skip is free, and the
    // log names the rule.
    const card: MdCard = { kind: 'dontHarvest', cropId: 'pumpkin' };
    const careful = tick(fair([card]), 30);
    const carefulBot = requireRobot(careful, 1);
    expect([bagCount(carefulBot.bag, 'pumpkin'), bagCount(carefulBot.bag, 'parsnip')]).toEqual([0, 2]);
    expect(tileAt(careful, { tx: 5, tz: 12 }, 'farm').crop?.cropId).toBe('pumpkin');
    expect(eventsOf(careful)).toContainEqual({ kind: 'skipped', action: 'harvest', card });
    expect(carefulBot.tokens - greedyBot.tokens).toBe(actionCost(carefulBot, 'harvest'));
  });

  it('"Water every dry tile in Zone A" on a rainy morning: nothing is dry, so it finishes at once and reports ✓', () => {
    let state: GameState = { ...withZones(MORNING, { A: ROW_A }), weather: Weather.Rain };
    // The rain watered the bed at dawn.
    for (const tx of [4, 5, 6]) state = withTile(state, { tx, tz: 12 }, soilTile(TileState.Watered), 'farm');
    const program = b.program({ stacks: [b.when(b.morning(), b.forEach('A', b.if(b.soilIsDry(), [b.water()])))] });
    const robot = programmed(robotOf({ parts: ['wateringHead'], tank: ROBOTS.tankCapacity, tx: 4, tz: 12, facing: Direction.East }), program);
    const next = tick(withRobots(state, [robot]), 20);

    const after = requireRobot(next, 1);
    expect([after.power, after.tank, after.tx, after.tz, after.tokens]).toEqual(['standby', ROBOTS.tankCapacity, 6, 12, 78]);
    const move: RobotLogEvent = { kind: 'did', action: 'move', detail: { kind: 'none' } };
    expect(eventsOf(next)).toEqual([move, move, { kind: 'finished' }]);
    const entries = next.robots.log.entries;
    expect(entries.at(-1)?.minute).toBe(TIME.dayStartMinute + 3 * ROBOTS.period);
    expect(entries.every((e) => robotSays(e).endsWith(' ✓'))).toBe(true);
  });
});
```

Replace `tests/robotDeterminism.test.ts` with (the part 1 test is unchanged):

```ts
/**
 * Determinism and the render contract with robots on the farm: a busy session played twice
 * through a freezing store ends identically, replaying its log reproduces it, and every
 * transition keeps unchanged robots (and the robot list when nothing robot-related changed)
 * by reference. Part 2 plays the same sessions with block programs, .MDs and zones.
 */
import { describe, expect, it } from 'vitest';
import { TIME } from '../src/config';
import { mulberry32 } from '../src/core/hash';
import { createActionRecorder, createStore } from '../src/core/store';
import { DIRECTIONS, Direction, TileState, type GameState } from '../src/core/types';
import { b } from '../src/robots/blocks';
import { addRobot } from '../src/robots/create';
import { actions, type GameAction } from '../src/state/actions';
import { serializeGame } from '../src/state/persistence';
import { gameReducer } from '../src/state/reducer';
import { EMPTY_TILE } from '../src/world/tiles';
import { addBlockRobot } from './programGen';
import { atDay, BASE, HEAVY_TEST_TIMEOUT_MS, matureCrop, must, soilTile, withTile, withZones } from './testUtils';

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

/**
 * Three block robots: a waterer fenced into Zone A, a harvester in Zone B that walks home to the
 * wood burner at 18:00, and a poller that runs a helper every 15 minutes.
 */
function withBlockRobots(): GameState {
  let state = withZones(atDay(BASE, 0, TIME.dayStartMinute), { A: { x0: 3, z0: 12, w: 3, d: 3 }, B: { x0: 9, z0: 12, w: 4, d: 2 } });
  for (let tx = 3; tx <= 5; tx++) for (let tz = 12; tz <= 14; tz++) state = withTile(state, { tx, tz }, soilTile(TileState.Plowed), 'farm');
  for (let tx = 9; tx <= 12; tx++) for (let tz = 12; tz <= 13; tz++) state = withTile(state, { tx, tz }, soilTile(TileState.Watered, matureCrop('parsnip')), 'farm');
  state = withTile(state, { tx: 14, tz: 15 }, { ...EMPTY_TILE, object: { kind: 'woodBurner', fuel: 10 } }, 'farm');
  state = addBlockRobot(state, {
    name: 'Drizzle',
    size: 'mini',
    parts: ['wateringHead'],
    place: { tx: 4, tz: 13, facing: Direction.South },
    program: b.program({ stacks: [b.when(b.morning(), b.forEach('A', b.if(b.soilIsDry(), [b.water()])), b.powerDown())] }),
    md: [{ kind: 'dontLeave', zone: 'A' }],
  });
  state = addBlockRobot(state, {
    name: 'Reaper',
    size: 'standard',
    parts: ['claw', 'basket'],
    place: { tx: 9, tz: 12, facing: Direction.East },
    program: b.program({ stacks: [b.when(b.morning(), b.forever(b.forEach('B', b.if(b.cropIsReady(), [b.harvest()]))))] }),
    md: [{ kind: 'doReturn', to: { kind: 'generator' }, minute: 18 * 60 }],
  });
  return addBlockRobot(state, {
    name: 'Poll',
    size: 'mini',
    parts: ['claw'],
    place: { tx: 7, tz: 16, facing: Direction.North },
    program: b.program({
      stacks: [b.when(b.every(15), b.run('look'))],
      helpers: [b.helper('look', b.if(b.cropIsReady(), [b.harvest()]), b.turn('right'))],
    }),
  });
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

  it(
    'plays the same twice with block programs, .MDs and zones, replays from its log, and never copies an unchanged robot',
    () => {
      const start = withBlockRobots();
      let acted = 0;
      for (let seed = 1; seed <= 5; seed++) {
        const list = session(seed, 600);
        const first = play(start, list);
        const second = play(start, list);
        expect(serializeGame(first.state)).toBe(serializeGame(second.state));
        expect(serializeGame(play(start, first.recorded).state)).toBe(serializeGame(first.state));
        expect(first.problems.slice(0, 10)).toEqual([]);
        acted += first.state.robots.list.reduce((sum, robot) => sum + robot.actionSeq, 0);
      }
      // The block robots really acted: the equality above isn't three idle robots.
      expect(acted).toBeGreaterThan(0);
    },
    HEAVY_TEST_TIMEOUT_MS,
  );
});
```

Replace `tests/robotTickBatching.test.ts` with (the two part 1 tests are unchanged):

```ts
/**
 * Review focus 2: however minutes arrive (one big tick, or the same minutes one at a time),
 * robots produce exactly the same state, including a tick that ends exactly at pass-out. (The
 * game drops a tick's minutes past pass-out, with or without robots, so the late run's first
 * tick is sized to land on it.) Part 2 review focus 3: the same with block robots across a DO
 * return, an `At` trigger, a DO power-down, dizziness, a flat wake and pass-out.
 */
import { describe, expect, it } from 'vitest';
import { TIME } from '../src/config';
import { mulberry32 } from '../src/core/hash';
import {
  CROP_IDS,
  DIRECTIONS,
  Direction,
  EVERY_CHOICES,
  ROBOT_PART_IDS,
  ROBOT_SIZES,
  TileState,
  type GameState,
  type RobotAction,
  type RobotPartId,
} from '../src/core/types';
import { b } from '../src/robots/blocks';
import { addRobot } from '../src/robots/create';
import { ROBOT_ACTION_KINDS } from '../src/robots/parts';
import { requireRobot, withRobot } from '../src/robots/world';
import { actions } from '../src/state/actions';
import { serializeGame } from '../src/state/persistence';
import { gameReducer } from '../src/state/reducer';
import { EMPTY_TILE } from '../src/world/tiles';
import { addBlockRobot } from './programGen';
import { atDay, BASE, HEAVY_TEST_TIMEOUT_MS, matureCrop, must, robotOf, soilTile, withRobots, withTile, withZones } from './testUtils';

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

const SIX_PM = 18 * 60;
/** A late-evening minute: after the DO return, before pass-out. */
const evening = (rng: () => number): number => SIX_PM + 1 + Math.floor(rng() * 400);

/**
 * Five block robots at 6:00 whose day crosses everything review focus 3 names: Drizzle waters
 * Zone A in the morning and again on an `At` trigger, fenced in by DON'T leave; Reaper is still
 * harvesting Zone B slowly when its DO return comes; Poll wakes on `Every n` with a helper and,
 * on some seeds, too few tokens to wake; Loopy gets dizzy on an `At` trigger; Spin powers down by
 * DO card when its tokens run low.
 */
function blockFarm(seed: number): GameState {
  const rng = mulberry32(seed);
  let state = withZones(atDay(BASE, 0, TIME.dayStartMinute), { A: { x0: 2, z0: 10, w: 4, d: 3 }, B: { x0: 9, z0: 10, w: 5, d: 2 } });
  for (let tx = 2; tx <= 5; tx++) for (let tz = 10; tz <= 12; tz++) state = withTile(state, { tx, tz }, soilTile(TileState.Plowed), 'farm');
  for (let tx = 9; tx <= 13; tx++) {
    for (let tz = 10; tz <= 11; tz++) state = withTile(state, { tx, tz }, soilTile(TileState.Watered, matureCrop(pick(rng, ['parsnip', 'potato'] as const))), 'farm');
  }
  state = withTile(state, { tx: 15, tz: 15 }, { ...EMPTY_TILE, object: { kind: 'woodBurner', fuel: 10 } }, 'farm');
  const water = b.forEach('A', b.if(b.soilIsDry(), [b.water()]));
  state = addBlockRobot(state, {
    name: 'Drizzle',
    size: 'mini',
    parts: ['wateringHead'],
    place: { tx: 2 + Math.floor(rng() * 4), tz: 10 + Math.floor(rng() * 3), facing: pick(rng, DIRECTIONS) },
    program: b.program({ stacks: [b.when(b.morning(), water), b.when(b.atTime(evening(rng)), water)] }),
    md: [{ kind: 'dontLeave', zone: 'A' }],
  });
  state = addBlockRobot(state, {
    name: 'Reaper',
    size: 'standard',
    parts: ['claw', 'basket'],
    place: { tx: 9 + Math.floor(rng() * 5), tz: 10 + Math.floor(rng() * 2), facing: pick(rng, DIRECTIONS) },
    // About 80 minutes a tile, so it's still mid-field when it has to go home.
    program: b.program({ stacks: [b.when(b.morning(), b.forEach('B', b.if(b.cropIsReady(), [b.harvest()]), b.wait(75)))] }),
    md: [{ kind: 'doReturn', to: { kind: 'generator' }, minute: pick(rng, [SIX_PM, SIX_PM + 20, SIX_PM + 60]) }],
  });
  state = addBlockRobot(state, {
    name: 'Poll',
    size: 'mini',
    parts: ['claw'],
    place: { tx: 7, tz: 14, facing: Direction.North },
    program: b.program({
      stacks: [b.when(b.every(pick(rng, EVERY_CHOICES)), b.run('look'))],
      helpers: [b.helper('look', b.if(b.cropIsReady(), [b.harvest()]), b.turn('right'))],
    }),
  });
  // 80 tokens wakes all day; 9 runs out after a few wakes; 1 can't pay a wake and an action.
  const poll = must(state.robots.list.find((r) => r.name === 'Poll'));
  state = withRobot(state, { ...poll, tokens: must([80, 9, 1][seed % 3]) });
  state = addBlockRobot(state, {
    name: 'Loopy',
    size: 'mini',
    parts: ['claw'],
    place: { tx: 3, tz: 15, facing: Direction.East },
    program: b.program({ vars: [b.numVar('n', 0)], stacks: [b.when(b.atTime(evening(rng)), b.forever(b.change('n', 1)))] }),
  });
  return addBlockRobot(state, {
    name: 'Spin',
    size: 'mini',
    parts: ['claw'],
    place: { tx: 6, tz: 16, facing: Direction.South },
    program: b.program({ stacks: [b.when(b.morning(), b.forever(b.turn('right')))] }),
    md: [{ kind: 'doPowerDown', when: { kind: 'tokensBelow', n: 70 } }],
  });
}

describe('tick batching', () => {
  it(
    'gives the same state for big and minute ticks, across pass-out too',
    () => {
      let acted = 0;
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
          acted += big.robots.list.reduce((sum, robot) => sum + robot.actionSeq, 0);
        }
      }
      // The robots really acted: the equality above isn't two idle farms.
      expect(acted).toBeGreaterThan(0);
    },
    HEAVY_TEST_TIMEOUT_MS,
  );

  it('a big tick across pass-out matches the same minutes one at a time, with a robot mid-script', () => {
    const steps: RobotAction[] = [{ kind: 'turn', side: 'right' }, { kind: 'turn', side: 'left' }, { kind: 'say', text: 'Hello' }];
    const late = { ...BASE, time: { ...BASE.time, minuteOfDay: TIME.passOutMinute - 30 } };
    const start = withRobots(late, [robotOf({ program: { kind: 'script', steps, loop: true }, nextActMinute: TIME.passOutMinute - 29 })]);
    const big = gameReducer(start, actions.tick(TIME.maxTickMinutes));
    let small = start;
    for (let m = 0; m < 30; m++) small = gameReducer(small, actions.tick(1));
    expect(small.time.absoluteDay).toBe(start.time.absoluteDay + 1);
    expect(serializeGame(big)).toBe(serializeGame(small));
    // It acts at 25:31, 25:35 … 25:59 (never on the pass-out minute itself): eight actions,
    // stopping after step 2 of 3.
    const robot = requireRobot(big, 1);
    expect(robot.actionSeq).toBe(8);
    expect(robot.tokens).toBe(72);
    expect(robot.lastAction).toMatchObject({ seq: 8, kind: 'turn', success: true });
  });

  it(
    'gives the same state for big and minute ticks with block robots, across a DO return, an At trigger and pass-out',
    () => {
      // Ten two-hour ticks run from 6:00 exactly to pass-out; two more run the next morning.
      expect((TIME.passOutMinute - TIME.dayStartMinute) % TIME.maxTickMinutes).toBe(0);
      const chunks = (TIME.passOutMinute - TIME.dayStartMinute) / TIME.maxTickMinutes + 2;
      const seen = new Set<string>();
      let acted = 0;
      for (let seed = 1; seed <= 10; seed++) {
        const start = blockFarm(seed);
        let big = start;
        let small = start;
        for (let chunk = 0; chunk < chunks; chunk++) {
          big = gameReducer(big, actions.tick(TIME.maxTickMinutes));
          for (let m = 0; m < TIME.maxTickMinutes; m++) small = gameReducer(small, actions.tick(1));
          expect(serializeGame(big), `seed ${seed}, chunk ${chunk}`).toBe(serializeGame(small));
          for (const entry of big.robots.log.entries) seen.add(entry.event.kind);
        }
        expect(big.time.absoluteDay).toBe(start.time.absoluteDay + 1);
        acted += big.robots.list.reduce((sum, robot) => sum + robot.actionSeq, 0);
      }
      expect(acted).toBeGreaterThan(0);
      // The runs crossed every moment under test.
      for (const kind of ['woke', 'doReturn', 'doPowerDown', 'dizzy', 'flat']) expect(seen.has(kind), kind).toBe(true);
    },
    HEAVY_TEST_TIMEOUT_MS,
  );
});
```

- [ ] **Step 2: Run them**

Run: `npx vitest run tests/robotInterpretSafety.test.ts tests/robotFaithful.test.ts tests/robotDeterminism.test.ts tests/robotTickBatching.test.ts`
Expected: PASS. These pin behaviour Tasks 1–10 built, so there is no red phase. If one fails:
- Use superpowers:systematic-debugging. Find which side is wrong against the spec: the comment above each faithful case says why each number is what it is (turn by turn, a Mini acts at 6:04, 6:08 …).
- A failure in the safety test prints the program index and turn; rebuild that program with `randomProgram(mulberry32(20261002))` in a scratch test to reproduce it.
- Fix the code at source with its own failing unit test first, in its own commit. Change an expected value here only when the spec supports what the game did, and say why in that commit.

- [ ] **Step 3: Implement — the playbook, the skill rows and the spec sync**

**3a.** Create `.claude/skills/game-driven-qa/scenarios/farmclaws-part2.md`:

````markdown
# Farmclaws part 2 — the language playbook

The browser check from the part 2 plan (Task 11 Step 4), as runnable snippets for the part 2
spec §14.3. Start each numbered check from `?new` with the probe loaded (see SKILL.md). Each
block is one `javascript_tool` call. Expected results come from the part 2 spec and
`src/config.ts`.

Farm landmarks: spawn (2,5) · clear ground x 1–17, z 9–17 · pond x 34–44, z 27–34.
Mini: 80 tokens, acts every 4 game minutes; a Standard pays twice. Move, turn and refill cost 1,
water 2, harvest 3; dizziness and skipped actions cost nothing. 1 game minute ≈ 0.7 s at 1×.

`setProgram` starts a `morning` stack only up to 6:04, so each setup loads the clock back to
6:00 (minute 360) in the same call, before the program. Programs use the tests' builder:
`const b = __meadowlight.blocks`. Read a robot's interpreter state with `__qa.robot(name)`:
`.exec` (`running`, `frames`, `vars`), `.off` (`'dizzy'` / `'done'` until morning) and `.md`.

## 1. The job 1 spinner waters a 3×3 bed and powers down with tokens left

```js
const F = await __qa.fixtures(); let s = __qa.state();
for (let tx = 6; tx <= 8; tx++) for (let tz = 12; tz <= 14; tz++) s = F.withTile(s, { tx, tz }, F.soilTile(F.T.TileState.Plowed), 'farm');
s = F.withPlayer(s, { tx: 7, tz: 16 }, 0, 'farm');
__qa.load({ ...s, time: { ...s.time, minuteOfDay: 360 } });
const b = __meadowlight.blocks;
[
  __meadowlight.addRobot('spinner', { tx: 6, tz: 12, facing: 1 }),
  __meadowlight.setZone('A', { x0: 6, z0: 12, w: 3, d: 3 }),
  __meadowlight.setProgram('Spinner', b.program({ stacks: [b.when(b.morning(),
    b.forEach('A', b.if(b.soilIsDry(), [b.water()])),
    b.powerDown())] })),
]
```
Expect `["Added Spinner.", "Set Zone A.", "Programmed Spinner."]`. Then:
```js
__qa.tick(100);
const tiles = []; for (let tz = 12; tz <= 14; tz++) for (let tx = 6; tx <= 8; tx++) tiles.push((await __qa.tile(tx, tz, 'farm')).state);
const r = __qa.robot('Spinner'); ({ tiles, power: r.power, tokens: r.tokens, tank: r.tank, at: [r.tx, r.tz] })
```
Expect nine `2`s (watered), `power: 'standby'`, `tokens: 50` (9 waters × 2, 8 moves, 4 turns),
`tank: 11`, `at: [8, 14]`. `await __qa.logText(3, 'Spinner')` ends
"says: Powering down ✓ | happened: Powered down.". Zoom in (`KeyZ` ×3) and screenshot: the bed
is evenly darker than the grass around it.

## 2. Toward the pond, with and without DON'T go into water

The shore and the pond's edge are laid down by hand so the check doesn't depend on the seed's rocks.
```js
const F = await __qa.fixtures(); const W = await __qa.mod('/src/world/tiles.ts'); let s = __qa.state();
for (const tx of [38, 39]) {
  for (let tz = 21; tz <= 26; tz++) s = F.withTile(s, { tx, tz }, W.EMPTY_TILE, 'farm');
  s = F.withTile(s, { tx, tz: 27 }, W.blockedTile(F.T.Blocker.Water), 'farm');
}
s = F.withPlayer(s, { tx: 38, tz: 21 }, 2, 'farm');
__qa.load({ ...s, time: { ...s.time, minuteOfDay: 360 } });
__meadowlight.addScriptedRobot({ name: 'Wader', parts: ['claw'], steps: [{ kind: 'turn', side: 'right' }], place: { tx: 38, tz: 24, facing: 2 } });
__meadowlight.addScriptedRobot({ name: 'Careful', parts: ['claw'], steps: [{ kind: 'turn', side: 'right' }], place: { tx: 39, tz: 24, facing: 2 } });
const b = __meadowlight.blocks, walk = b.program({ stacks: [b.when(b.morning(), b.repeat(4, b.move()))] });
[__meadowlight.setProgram('Wader', walk), __meadowlight.setProgram('Careful', walk), __meadowlight.setMd('Careful', [{ kind: 'dontGoIntoWater' }])]
```
Expect `["Programmed Wader.", "Programmed Careful.", "Set Careful's .MD."]`. Then `__qa.tick(20)`:
- Wader: `power: 'broken'` at (38,27); toast "[warn] Wader drove into the water and shorted out."
- Careful: `standby` at (39,26), `tokens: 78` (two moves); `await __qa.logText(4, 'Careful')`
  shows one "says: Following my rules ✓" entry ×2 whose "happened" text names the card
  ("… my .MD says don't go into water."), then "All done ✓".

Screenshot: Wader sunk and sparking in the water beside Careful on the shore.

## 3. A `Repeat forever` with only free blocks goes dizzy

Zoom in first (`KeyZ` three times), then:
```js
const F = await __qa.fixtures(); const s = __qa.state();
__qa.load({ ...F.withPlayer(s, { tx: 7, tz: 15 }, 0, 'farm'), time: { ...s.time, minuteOfDay: 360 } });
__meadowlight.addScriptedRobot({ name: 'Rest', parts: ['claw'], loop: false, steps: [{ kind: 'powerDown' }], place: { tx: 8, tz: 12, facing: 2 } });
__meadowlight.addScriptedRobot({ name: 'Loopy', parts: ['claw'], steps: [{ kind: 'turn', side: 'right' }], place: { tx: 6, tz: 12, facing: 2 } });
const b = __meadowlight.blocks;
const said = __meadowlight.setProgram('Loopy', b.program({ vars: [b.numVar('n', 0)], stacks: [b.when(b.morning(), b.forever(b.change('n', 1)))] }));
// Hold the clock at 6:00 until the camera is ready (every hook's load unpauses, so pause last).
__meadowlight.store.dispatch(__meadowlight.actions.setPaused(true));
said
```
Expect "Programmed Loopy.", with the clock paused at 6:00. Then, in one `browser_batch` so the
screenshot lands inside the one-second spin: a `javascript_tool` that unpauses and waits for the
moment (about 3 s, at 6:04),
```js
__meadowlight.store.dispatch(__meadowlight.actions.setPaused(false));
await new Promise((done) => { const id = setInterval(() => { if (__qa.robot('Loopy').off === 'dizzy') { clearInterval(id); done(); } }, 10); }); __qa.snap(1)
```
followed by `computer {action: 'screenshot'}`. Expect:
- the screenshot catches Loopy part-way round (not facing south);
- toast "[warn] Loopy got dizzy going round in circles.";
- `__qa.robot('Loopy')`: `off: 'dizzy'`, `power: 'working'` (unchanged), `tokens: 80`, `actionSeq: 0`;
- `await __qa.logText(2, 'Loopy')`: "says: Thinking very hard ✓ | happened: Looped without doing anything, and got dizzy. Off until morning."

Two seconds later, screenshot again: Loopy faces south, its eyes as dim as Rest's (standby), and
neither bobs. `__qa.tick(120)`: Loopy's `actionSeq` is still 0 and `off` still `'dizzy'`.
`__qa.sleep()`: `__qa.robot('Loopy').off` is `null`; about 3 s later (6:04) it gets dizzy again,
with a second toast. Faithful: the program hasn't changed.

## 4. DO return to the nearest generator at 6:00 pm, watched at 16×

```js
const F = await __qa.fixtures(); const W = await __qa.mod('/src/world/tiles.ts'); let s = __qa.state();
for (let tx = 4; tx <= 9; tx++) for (const tz of [15, 16]) s = F.withTile(s, { tx, tz }, F.soilTile(F.T.TileState.Watered, F.matureCrop('parsnip')), 'farm');
s = F.withTile(s, { tx: 13, tz: 10 }, { ...W.EMPTY_TILE, object: { kind: 'woodBurner', fuel: 0 } }, 'farm');
s = F.withPlayer(s, { tx: 9, tz: 13 }, 2, 'farm');
__qa.load({ ...s, time: { ...s.time, minuteOfDay: 360 } });
__meadowlight.addScriptedRobot({ name: 'Reaper', size: 'standard', parts: ['claw', 'basket'], steps: [{ kind: 'turn', side: 'right' }], place: { tx: 4, tz: 15, facing: 1 } });
const b = __meadowlight.blocks;
const out = [
  __meadowlight.setZone('B', { x0: 4, z0: 15, w: 6, d: 2 }),
  __meadowlight.setProgram('Reaper', b.program({ stacks: [b.when(b.morning(), b.forever(b.forEach('B', b.if(b.cropIsReady(), [b.harvest()]))))] })),
  __meadowlight.setMd('Reaper', [{ kind: 'doReturn', to: { kind: 'generator' }, minute: 1080 }]),
];
// Jump to 17:48 with the program still running, so the evening comes quickly.
__qa.patch((st) => { st.time.minuteOfDay = 1068; st.robots.list.find((r) => r.name === 'Reaper').nextActMinute = 1072; });
out
```
Expect `["Set Zone B.", "Programmed Reaper.", "Set Reaper's .MD."]`. Then go to 16× and watch:
```js
for (let i = 0; i < 4; i++) await __qa.key('KeyT', 30);
await new Promise((r) => setTimeout(r, 5000));
__meadowlight.store.dispatch(__meadowlight.actions.setTimeScale(1));
const r = __qa.robot('Reaper'); ({ at: [r.tx, r.tz], power: r.power, off: r.off, log: await __qa.logText(4, 'Reaper') })
```
Expect:
- At 18:00 Reaper stops mid-row and heads for the burner: a log line at 18:00 "says: Heading home ✓ | happened: My .MD says return to the nearest generator at 6:00 pm, so I stopped my program and set off.", then "Home safe ✓ | happened: Got there and powered down for the day."
- It ends within 2 tiles (either way) of the burner at (13,10), `power: 'standby'`, `off: 'done'`.
- Zone B still holds 11 mature parsnips (it harvested only (4,15)). Screenshot: Reaper parked by the burner, the crops behind it.
- `__qa.tick(120)`: it doesn't move again (off until morning).

## 5. Save and reload mid-loop

```js
__qa.patch((st) => { st.time.minuteOfDay = 360; });
__meadowlight.addScriptedRobot({ name: 'Twirl', parts: ['claw'], steps: [{ kind: 'turn', side: 'right' }], place: { tx: 10, tz: 12, facing: 2 } });
const b = __meadowlight.blocks;
__meadowlight.setProgram('Twirl', b.program({ stacks: [b.when(b.morning(), b.repeat(30, b.turn('right')), b.powerDown())] }));
__qa.tick(40);
const r = __qa.robot('Twirl'); ({ seq: r.actionSeq, loop: r.exec.frames.at(-1).loop })
```
Expect `{ seq: 10, loop: { kind: 'times', left: 20 } }`: `left + seq` is 30 between any two turns.
Within a minute, navigate to `http://localhost:5173/` (no `?new`: the page saves as it unloads
and loads that save), load the probe, then:
```js
const r = __qa.robot('Twirl'); ({ seq: r.actionSeq, sum: r.exec.frames.at(-1).loop.left + r.actionSeq, running: r.exec.running })
```
Expect `seq` 10 or a little more (time kept running), `sum: 30`, `running: 0`. Then
`__qa.tick(120)` and `__qa.robot('Twirl')`: `actionSeq: 31` (30 turns and the power-down, none
repeated or lost), `tokens: 50`, `facing: 0` (north), `power: 'standby'`; `await __qa.logText(1, 'Twirl')`
says "Powering down ✓".

## 6. No console errors

`read_console_messages {onlyErrors: true}` → none, across all five checks.
````

**3b.** In `.claude/skills/game-driven-qa/SKILL.md`, in the Quick reference table, directly after the row that starts `| Add robots |`, insert:

```markdown
| Program a robot with blocks (part 2) | `const b = __meadowlight.blocks; __meadowlight.setProgram('Drizzle', b.program({ stacks: [b.when(b.morning(), b.forEach('A', b.if(b.soilIsDry(), [b.water()])))] }))` → "Programmed Drizzle." or the checker's sentence. A `morning` stack starts only up to 6:04 (6:03 with a quick core); later the robot idles until a trigger fires |
| A robot's .MD | `__meadowlight.setMd('Drizzle', [{ kind: 'dontLeave', zone: 'A' }, { kind: 'doReturn', to: { kind: 'generator' }, minute: 1080 }])` → "Set Drizzle's .MD." |
| Zones A–H | `__meadowlight.setZone('A', { x0: 6, z0: 12, w: 3, d: 3 })` → "Set Zone A."; `setZone('A', null)` clears it |
| Block builder | `__meadowlight.blocks` is the tests' `b`: `b.repeat(3, b.move())`, `b.goTo(b.tileAt(5, 10))`, `b.set('n', b.add(b.v('n'), b.n(1)))`. Playbook: `scenarios/farmclaws-part2.md` |
| What a block robot is doing | `__qa.robot(name).exec` (`running` stack, `frames`, `vars`), `.off` (`'dizzy'` or `'done'` until morning), `.md` |
```

In the Gotchas table, directly after the row that starts `| "The farm already has 12 robots." |`, insert:

```markdown
| `setProgram` worked but the robot never starts | It was after 6:04, so the `morning` stack waits for tomorrow. Load the clock to 6:00 in the same call first (`const s = __qa.state(); __qa.load({ ...s, time: { ...s.time, minuteOfDay: 360 } })`), or give the program an `every` / `atTime` trigger |
```

**3c.** Sync the spec, `docs/superpowers/specs/2026-10-02-farmclaws-part2-language.md`. Make each edit exactly:

1. §2.3, replace
   `` Names (variables and helpers) are 1 … `ROBOTS.maxIdentifierLength` characters, trimmed, unique within their kind. ``
   with
   `` Names (variables and helpers) are 1 … `ROBOTS.maxIdentifierLength` characters, trimmed, unique within their kind. The `Every [n] minutes` options are declared in `types.ts` as `EVERY_CHOICES` and re-exported as `ROBOTS.everyChoices`, so types don't import config. ``

2. §2.4 (R1), replace
   ```ts
     /** The trigger stack running, or null while idle. */
     readonly running: number | null;
     /** Innermost last. Empty while idle. At most ROBOTS.maxFrames. */
   ```
   with
   ```ts
     /** The trigger stack running, or null while idle or walking home on a DO return. */
     readonly running: number | null;
     /** Innermost last. Empty while idle; exactly one `doReturn` route frame during a DO return. At most ROBOTS.maxFrames. */
   ```

3. §4 (R5), replace
   `` frame depth (deepest nesting plus helper chain) ≤ `maxFrames`. ``
   with
   `` frame depth (deepest nesting plus helper chain, where a `Go to` or `For each tile` counts one more frame for the route it pushes) ≤ `maxFrames`. ``

4. §5.1, replace the `Step` block
   ```ts
   export type Step =
     | { readonly kind: 'act'; readonly action: RobotAction; readonly exec: RobotExec; readonly from: 'program' | 'doReturn' }
     | { readonly kind: 'idle'; readonly exec: RobotExec }   // the running stack ended
     | { readonly kind: 'dizzy' };

   export function stepProgram(state: GameState, robot: Robot): Step;
   ```
   with
   ```ts
   /** A route the interpreter gave up on this turn; the turn layer logs it as `gaveUp`. */
   export interface GaveUp { readonly target: TileCoord; readonly why: 'goTo' | 'forEach' | 'doReturn' }

   export type Step =
     | { readonly kind: 'act'; readonly action: RobotAction; readonly exec: RobotExec; readonly gaveUp: readonly GaveUp[] }
     | { readonly kind: 'idle'; readonly exec: RobotExec; readonly gaveUp: readonly GaveUp[] }   // the running stack ended
     | { readonly kind: 'dizzy' };

   export function stepProgram(state: GameState, robot: Robot): Step;
   /** Starts trigger stack `index`: running = index, frames = [a list frame on the stack body]. */
   export function startStack(exec: RobotExec, index: number): RobotExec;
   ```
   (A DO return's route is walked by the turn layer, `src/robots/turn.ts`, so `Step` no longer says who asked.)

5. §5.1 Expressions (R4), replace
   `` `tileAheadIs`: `water` is a water blocker, `clear` is a walkable farm tile, and `blocked` is anything else. ``
   with
   `` `tileAheadIs`: `water` is a water blocker, `clear` is a walkable farm tile, and `blocked` is anything else. A robot on the farm edge facing out reads its own tile as `tile ahead`, so a Tile value is always a farm tile. ``

6. §5.3, replace
   `` `planRoute(state, robot, target): TileCoord[] | null` is a breadth-first search ``
   with
   `` `planRoute(state, robot, target): readonly TileCoord[] | null` (`[]` when the robot already stands on the target) is a breadth-first search ``
   and append to the end of that paragraph:
   `` The single-step rule is `canEnter(state, robot, from, to)`, shared by `planRoute` and the route frame's re-plan check. ``

7. §6.1 step 4, replace
   `Skips of a route's moves can't happen, because routes are planned over allowed tiles. If a DON'T would forbid a route move anyway, the route re-plans next minute.`
   with
   `` Skips of a route's moves can't happen: routes are planned over allowed tiles, and a route frame re-plans in the same turn whenever its next step can no longer be entered (`canEnter`). ``

8. §6.2 (R3), replace
   `` `planRobotAction` and `applyRobotPlan` take an optional `keep: ReadonlySet<ItemId>` for deposits, which the .MD layer fills from `dontDeposit` cards. Scripts pass nothing, so part 1 behaviour is unchanged. ``
   with
   `` `planRobotAction` and `applyRobotPlan` take an optional `keep: ReadonlySet<ItemId>` for deposits, which the .MD layer fills from `dontDeposit` cards. `RobotPlan` carries the set, so the apply phase deposits with the same kept set the choose phase planned with. Scripts pass nothing, so part 1 behaviour is unchanged. ``

9. §7 (R2), replace
   `` - **Waking costs `wakeCost`** (scaled like actions) and logs `woke`. A robot that can't pay goes flat. Waking also takes the robot's first action that same minute. ``
   with
   `` - **Waking costs `wakeCost`** (scaled like actions) and logs `woke`. Waking also takes the robot's first action that same minute, and the turn charges the wake on top of that action. A robot that can't pay both goes flat: nothing is committed, and the trigger's `due` / `firedToday` stay unspent, so it never wakes for free. ``

10. §9, replace
    `` One addition: a **dizzy** robot plays a spin clip once (a full yaw turn over 1 s) and then sits with dimmed eyes like `standby`. `off: 'done'` looks like `standby`. No other render changes. The robot screen is part 3. ``
    with
    `` One addition: a **dizzy** robot plays a spin clip once (a full yaw turn over 1 s) and then sits with dimmed eyes like `standby`. `off: 'done'` looks like `standby`. Eye brightness is `eyeLevel(power, off)`: 1 working, ½ standby or off, 0 flat, broken or repairing; robots that are off don't bob. The spin starts only when `off` becomes `'dizzy'` between two syncs, never on a load. No other render changes. The robot screen is part 3. ``

11. §10.2 (R1), replace
    `` - `running` is null or a stack index, and `frames` is empty exactly when `running` is null. ``
    with
    `` - `running` is null or a stack index, and `frames` is empty exactly when `running` is null, except during a DO return, when `running` is null and `frames` is exactly one `route` frame with `why: 'doReturn'`. ``

12. §12, replace the three bullets
    ```
    - `setProgram(name, program)`: runs `checkProgram` against that robot. On success it replaces the program, rebuilds `exec` as the morning reset would, and starts the `morning` stack only if the current minute is at or before `dayStartMinute + period`; otherwise the robot is idle until a trigger fires. Returns "Programmed {name}." or the checker's sentence.
    - `setMd(name, cards)`: runs `checkMd`. Returns "Set {name}'s .MD." or the problem.
    - `setZone(id, rect | null)`: validates the rect against the farm.
    ```
    with
    ```
    - `setProgram(name, program)`: runs `checkProgram` against that robot. On success it replaces the program, rebuilds `exec` as the morning reset would, and starts the `morning` stack only if the current minute is at or before `dayStartMinute + period`; otherwise the robot is idle until a trigger fires. A script runs from step 0. The robot turns back on and acts one period later (as `addRobot` does); a flat, broken or repairing robot keeps its power. Returns "Programmed {name}." or the checker's sentence. The pure core is `programmedRobot(robot, program, minuteOfDay)`.
    - `setMd(name, cards)`: runs `checkMd`. The cards apply at once: today's carried-out DO cards are forgotten and a DO return under way stops, leaving the robot idle. Returns "Set {name}'s .MD." or the problem. The pure core is `withMd(robot, cards)`.
    - `setZone(id, rect | null)`: validates the rect against the farm and keeps only its four fields. Returns "Set Zone {id}." or "Cleared Zone {id}.", or the problem. The pure core is `withZone(state, id, rect)`.
    - Input that isn't a program, a card list or a zone gets a usage line; a name that matches no robot gets "No robot is called {name}."
    ```

13. §14.1, after the row
    `` | `tests/robotSaveV5.test.ts` | v4 → v5 migration; round trip mid-loop, mid-route, mid-helper, dizzy, done and idle with pending triggers; one corrupted field per rule in section 10.2. | ``
    insert
    ```
    | `tests/robotEval.test.ts` | Every expression and sensor, zones and snake order. |
    | `tests/robotRoute.test.ts` | `planRoute`, `nextRouteAction` and the DON'T checks on single steps. |
    | `tests/robotTurn.test.ts` | Every branch of `decideTurn`: .MD precedence, both DO cards, triggers and the wake cost. |
    ```

14. §14.2, replace
    `` - **Interpreter safety:** random well-typed programs from a seeded generator never throw. They always reach an action or `dizzy` within the budget, and their `exec` always validates. ``
    with
    `` - **Interpreter safety:** random well-typed programs from a seeded generator never throw. They always reach an action or `dizzy` within the budget, and their `exec` always validates. `tests/robotInterpretSafety.test.ts` runs 300 programs from `tests/programGen.ts` for 30 turns each, and every tenth farm also goes through a save and a load. ``

15. §17, append two bullets at the end of the list:
    ```
    - **§3.9, "DON'T go into water; DO keep the watering head full".** `Refill` works from the shore, and a route never ends in water, so a DON'T card never stops a refill on its own. Part 2 reproduces the row with a refill trip that goes to the pond tile itself: the `Go to` gives up, the tank runs dry, and the robot trundles over the dry tiles (`tests/robotFaithful.test.ts`).
    - **§3.9, "DO power down when the bag is full".** Full means every bag stack is in use, so a one-stack Mini powers down after its very first harvest, not after the first of a second crop type, and again every morning until someone empties its bag.
    ```

16. §4 (Task 2's ruling), replace
    `` `atTime`/`timeIsAfter` minutes within the day, ``
    with
    `` `atTime`/`timeIsAfter` minutes within the day (`dayStartMinute` … `passOutMinute − 1`, here and in `checkMd`), ``

17. §4 counting (Task 2's ruling), replace
    `` and fields inside a block (a `turn` side, a `plant` crop) are 0. ``
    with
    `` and fields inside a block (a `turn` side, a `plant` crop) are 0, and so are variable declarations. ``

18. §5.1 (Task 6's ruling), replace
    `` Each statement it passes that isn't an action, and each loop iteration it starts, costs one step. ``
    with
    `` Each statement it passes that isn't an action costs one step, and so does each further iteration a loop starts: passing the loop statement pays for its first iteration, and a loop that ends without going round again costs nothing. ``

19. §12 (Task 10's ruling), replace
    `` The dist check gains `setProgram`, `setMd` and `setZone`. ``
    with
    `` The dist check gains `addScriptedRobot`, `setMd` and `setZone`. It leaves out `setProgram`, which three.js's `WebGLRenderer` uses internally, so it always appears in the bundle's source map. ``

20. Any other ruling. List the commit bodies with
    `git log --reverse --grep='^Farmclaws part 2' --format='%n%h %s%n%b'`
    and copy any ruling that edits 1–19 don't already cover (the spec's "pick the smallest change … and write it down in the step's commit message", for example one a browser-check fix in Step 4 records) into the section it changes, worded as the rule now stands. With the plan as written there is none: Task 1's `EVERY_CHOICES` is edit 1, Task 2's are edits 3, 16 and 17, Task 3's R1 and R4 are edits 2, 5 and 11, Task 4's is edit 5, Task 6's are edits 7 and 18, and Task 10's are edits 12 and 19.

- [ ] **Step 4: Run it and see it pass**

Run: `npx vitest run tests/robotInterpretSafety.test.ts tests/robotFaithful.test.ts tests/robotDeterminism.test.ts tests/robotTickBatching.test.ts`
Expected: PASS.

Then the browser check. Invoke the `game-driven-qa` skill and follow its "Start every run like this" (dev server `meadowlight-dev`, `http://localhost:5173/?new`, the probe). Run checks 1–6 of `scenarios/farmclaws-part2.md`, starting each of checks 1–4 from a fresh `?new` farm. Report one line per check, **PASS / FAIL — evidence**, as the skill says. A FAIL is a bug: reproduce it with `__qa.tick`, write a failing unit test, fix it at source in its own commit, and run the check again. When all six pass, add this line under the playbook's first paragraph, with the run's date: `Last run: YYYY-MM-DD — all six checks PASS.`

- [ ] **Step 5: The full gate**

Run: `npm run typecheck && npm test && npm run build && ! grep -rl "robotLog\|installRobotDev\|addScriptedRobot\|setMd\|setZone" dist/`
Expected: all green, and no dev-hook code in `dist/` (no `setProgram` in the check, as in Task 10).

- [ ] **Step 6: Commit**

Three commits:

```bash
git add tests/programGen.ts tests/robotInterpretSafety.test.ts tests/robotFaithful.test.ts tests/robotDeterminism.test.ts tests/robotTickBatching.test.ts
git commit -m "Farmclaws part 2: determinism, tick batching, interpreter safety and the faithful-to-a-fault suite

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

```bash
git add .claude/skills/game-driven-qa/scenarios/farmclaws-part2.md .claude/skills/game-driven-qa/SKILL.md
git commit -m "Farmclaws part 2: the browser playbook and the console's block hooks in the QA skill

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

```bash
git add docs/superpowers/specs/2026-10-02-farmclaws-part2-language.md
git commit -m "Farmclaws part 2: sync the spec with the build

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
