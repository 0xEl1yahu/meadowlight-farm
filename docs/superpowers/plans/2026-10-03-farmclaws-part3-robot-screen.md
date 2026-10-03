# Farmclaws Part 3: The Robot Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The player programs, repairs, paints and scraps robots at a workbench through a lazily loaded Blockly editor and a card editor, peeks at robots in the field, paints zones with a zone marker, and robots break down in ways that send them back to the bench: all saved in save version 6.

**Architecture:** The simulation side stays pure: new robot state (`onBench`, `stats`, `paint`, `off: 'player'`, `ruined`), bumps decided per minute like bickers, and every edit as a reducer action, all in `src/robots` and `src/state`. The robot screen is a lazily imported DOM module (`src/ui/robotScreen/`), and Blockly is a second lazy import inside it. A pure translator converts between Blockly's workspace JSON and `BlockProgram`, so the checker stays the only gate. A small host in the main chunk opens the screen when `ui.panel.kind` is `'robot'`.

**Tech Stack:** TypeScript (strict, `erasableSyntaxOnly`), Three.js, Vite, Vitest, Blockly (`blockly/core`, added in Task 12).

**Spec:** `docs/superpowers/specs/2026-10-03-farmclaws-part3-robot-screen.md`, building on `docs/superpowers/specs/2026-10-02-farmclaws-part2-language.md` and `docs/superpowers/specs/2026-09-29-farmclaws-part1-robot-core.md`, within the umbrella design `docs/superpowers/specs/2026-09-29-farmclaws-design.md`. Read the part 3 spec before starting; it is the binding authority.

## Global Constraints

- The simulation stays pure and deterministic: no `Math.random`, no clock reads and no I/O in `src/core`, `src/state`, `src/world`, `src/farming`, `src/time` or `src/robots`. The editor and screens live in `src/ui`; Blockly is imported only in `src/ui/robotScreen/`.
- Strict TypeScript with `erasableSyntaxOnly`: no enums, no namespaces, no parameter properties, `as const` objects plus union types, `import type` for types. `noUnusedLocals` and `noUnusedParameters` are on, and `tests/` is typechecked too.
- No TODOs, placeholders or stubs.
- `npm run typecheck && npm test && npm run build` pass after every task. From Task 14 on, `npm run build:check` too.
- State is immutable, with structural sharing: an unchanged robot, chunk or tile keeps its reference (`withRobot` returns the same state when nothing changed).
- Every saved field a task adds goes into its type, `createInitialState` / `createDefaultSections`, `migrateV5toV6` and validation **in the same task**, so a save loads after every task.
- `isProgramShape` → `checkProgram` and `isMdShape` → `checkMd` are the only gate for programs and .MDs, from the screen exactly as from the dev hooks.
- Numbers come from config (`ROBOTS`, `ROBOT_CARE`, `ROBOT_PAINTS`, `ROBOT_SCREEN`, `WORKBENCH`, `UNLOCKS`, `ZONE_MARKER`, `TIME`), never inline.
- Production code never contains `setMd`, `setZone` or `unlockAll` in any identifier, action type string or file name (the dist check greps substrings). Action types use `robot/md`, `zone/mark`, and so on.
- Robot speech (`robotSays`) always ends in " ✓", even for failures. Only `whatHappened` and toasts tell the truth.
- Player-facing text is copied verbatim from the spec, including punctuation.
- Commit messages end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A save made mid-day with a robot on the bench, a ruined robot in the pond, a switched-off robot, a zone draft and a full backpack (marker pending).** It must load to the same state, apart from the draft and the panel, which reset. Pinned in Task 5 (bench), Task 7 (ruined, paint), Task 9 (draft, pending marker), each adding its round-trip case to `tests/robotSaveV6.test.ts`.
2. **Two robots meeting in a `For each tile` zone, and a convoy whose leader has the higher id.** The convoy moves as one; robots crossing or swapping bump; a robot routing into one that stands still bumps; ids never change the outcome. Pinned in Task 6.
3. **Typing in the editor:** E, Space, Escape, WASD and Enter typed into a Blockly field or the .MD tab never reach the game. Escape in an open dropdown closes only the dropdown. Pinned in Task 11 (`panelKeyCommand` returns `null` for the robot panel; `InputController` test) and the playbook in Task 15.
4. **A program whose values sit outside the editor's usual options** (`atTime` 583, an item the toolbox doesn't list, a 16-character variable name, the longest the checker accepts). Opening the bench and pressing Save leaves it exactly unchanged. Pinned in Task 10 (round trip) and Task 12 (`dropdownOptions` always includes the current value).
5. **Migrating a v5 save** where the player built on (6, 4), the backpack is full, a broken robot sits in the pond and two robots share a tile. It loads: the workbench is on the nearest free tile, `pendingMarker` is true, the broken robot is ruined only at the next morning, and the shared tile is kept. Pinned in Task 5, Task 7 and Task 9.

---

## File map

| File | Responsibility |
| --- | --- |
| `src/core/types.ts` | `SAVE_VERSION = 6` (T1); `RobotStats`, `RobotStatCounts`, `Robot.stats` replacing `tokensToday` (T3); `MD_CARD_KINDS`, `ROBOT_TABS`, `RobotTab`, `RobotUnlocks`, `RobotsState.unlocks` (T4); `'workbench'` object, `Robot.onBench`, `off: 'player'`, `UiPanel` robot kind (T5); `crashed` log event (T6); `'ruined'` power, `ruined` log event, `Robot.paint` (T7); `'zoneMarker'` tool, `UiState.zoneDraft/zoneLetter`, `RobotsState.pendingMarker` (T9) |
| `src/config.ts` | `ROBOTS.weekLength` (T3); `UNLOCKS` (T4); `WORKBENCH` (T5); `ROBOT_CARE`, `ROBOT_PAINTS` (T7); `ZONE_MARKER`, `TOOLS.energyCost.zoneMarker` (T9); `ROBOT_SCREEN` (T10, grown in T13) |
| `src/state/persistence.ts` | `migrateV5toV6` (T1, grown by T3, T4, T5, T7, T9); `isValidUi` (T9) |
| `src/state/robotValidation.ts` | v6 robot keys and rules, grown per task |
| `src/robots/edits.ts` | `programmedRobot`, `withMd`, `withZone` moved from the dev hooks (T2) |
| `src/state/actions.ts`, `src/state/reducer.ts` | `robot/program`, `robot/md` (T2); `robot/liftOff`, `robot/switch` (T5); `robot/scrap`, `robot/paint` (T7); `player/peek` (T8); `zone/cycle`, `zone/clearDraft` (T9) |
| `src/robots/log.ts` | merge within a day (T3) |
| `src/robots/stats.ts` | `ZERO_ROBOT_STATS`, `addRobotStats`, `isWeekStart` (T3); `scrapValue` (T7) |
| `src/robots/blockKinds.ts` | `BLOCK_KINDS`, `BlockKind`, `BLOCK_CATEGORY` (T4) |
| `src/robots/unlocks.ts` | `withUnlocks`, `ALL_UNLOCKS` (T4) |
| `src/robots/workbench.ts` | `workbenchTile`, `freeSpotNear`, `withWorkbenchAt`, `robotOnBench` (T5) |
| `src/robots/bumps.ts` | `findBumps`, `forgetRunningStack` (T6) |
| `src/robots/execute.ts` | stats counting (T3), `applyBumpPlan` (T6) |
| `src/robots/run.ts` | benched robots skipped, off scripts skipped (T5); bump pre-pass (T6) |
| `src/robots/overnight.ts` | stats rollover (T3); `'player'` kept (T5); robot-free drop-offs (T6); ruin (T7); marker delivery (T9) |
| `src/robots/logText.ts` | `crashed` (T6); `ruined`, "a scrapped robot" (T7) |
| `src/robots/eval.ts` | `tile ahead is blocked` sees robots (T6) |
| `src/state/intents.ts` | bench intents (T5); put-down refusal (T6); new-core wording, ruined refusal (T7); `planShiftInteraction`, `peekRobot` (T8); zone marker intents (T9) |
| `src/input/panelKeys.ts`, `src/input/InputController.ts` | Shift + E peek (T8); marker keys (T9); robot screen owns the keyboard (T11) |
| `src/ui/Hud.ts` | Shift hint (T8); zone chip (T9) |
| `src/ui/zoneChip.ts` | `zoneChipText` (T9) |
| `src/render/objectGeometry.ts`, `src/render/objectLayout.ts`, `src/render/TileHighlighter.ts`, `src/ui/icons.ts` | the workbench (T5); the zone marker icon (T9) |
| `src/render/RobotRenderer.ts`, `src/render/robotGeometry.ts`, `src/render/robotLayout.ts` | robots on the bench (T5); paint shells and the ruined look (T7) |
| `src/render/ZoneRenderer.ts` | zone overlay (T9) |
| `src/render/playerModel.ts`, `src/render/PlayerRenderer.ts`, `src/render/EffectsRenderer.ts`, `src/items/items.ts` | the zone marker as a tool (T9) |
| `src/dev/robotDev.ts` | uses `src/robots/edits.ts` (T2); `unlockAll` (T4) |
| `src/ui/robotScreen/translate.ts` | workspace JSON ↔ `BlockProgram` (T10) |
| `src/ui/RobotScreenHost.ts` | main-chunk host that lazy-loads the screen (T11) |
| `src/ui/robotScreen/RobotScreen.ts`, `viewModel.ts`, `robotScreen.css`, `tabs/*.ts` | the screen shell, header, Looks, Stats and Log tabs (T11) |
| `src/ui/robotScreen/blockly/*.ts`, `tabs/ProgramTab.ts` | Blockly blocks, theme, toolbox, the Program tab (T12) |
| `src/ui/robotScreen/tabs/MdTab.ts`, `mdFields.ts` | the .MD tab (T13) |
| `scripts/check-bundle.mjs`, `scripts/bundle-baseline.json`, `scripts/build-single.mjs`, `vite.config.ts`, `package.json` | budgets, dist check, single-file build (T14) |
| `.claude/skills/game-driven-qa/scenarios/farmclaws-part3.md`, `.claude/skills/game-driven-qa/SKILL.md`, the specs | playbook and spec sync (T15) |

---

## Facts every task needs

- **Store and actions.** `src/state/actions.ts` holds `GameAction` (a union of `{ type: 'area/verb', ... }`) and the `actions` creator object. `src/state/reducer.ts`'s `gameReducer` switches on `action.type`. Intents (`src/state/intents.ts`) are plans for E (`planInteraction`) and Space (`planPrimaryAction`); the reducer executes `ActionPlan.intent` in a `switch (intent.kind)` (~line 329). Toasts: `pushMessage(state, text, tone)` from `src/state/messages.ts`. A blocked plan with a reason becomes a warn toast.
- **Robots.** `src/robots/world.ts`: `findRobot`, `requireRobot`, `withRobot` (same state when unchanged), `withFarm`, `robotsOnTile(state, tx, tz)` (not carried, not repairing; from Task 5 also not on the bench), `nearestWalkable(world, from)`. `src/robots/execute.ts`: `planRobotAction`, `applyRobotPlan`, `applyBickerPlan`, `applyTurn`, `chargeWake`, private `pay` and `settle`. `src/robots/run.ts`: `isDue`, `choose`, `runRobotsMinute`, `runRobotsThrough`. `src/robots/overnight.ts`: `runRobotsOvernight(state): { state, notes }` with `burnGenerators`, `setDownCarried`, `returnRepaired`, `recharge`, `resetForMorning`. `src/robots/logText.ts`: `robotSays(entry)`, `triggerText(trigger)`, `whatHappened(entry, names)`, private `listNames(ids, names)` with fallback `robot ${id}`. `src/robots/exec.ts`: `freshExec`, `execAt`, `morningExec`. `src/robots/check.ts`: `checkProgram`, `checkMd`, `isValidZoneRect`. `src/robots/program.ts`: `blockCount(program)`. `src/robots/blocks.ts`: the builder `b`.
- **Dev hooks** (`src/dev/robotDev.ts`) apply changes through `store.dispatch(actions.load(state))`. Today `programmedRobot`, `withMd` and `withZone` live there (Task 2 moves them).
- **Persistence.** Migrations work on raw parsed JSON (`Obj`) one version at a time, then `isValidGameState` validates. `deserializeGame` resets `ui.panel` to `{ kind: 'none' }` and `paused` to false. `isValidWorld(world, id)` is private in `persistence.ts`; Task 5 exports it for the migration.
- **Validation.** `src/state/robotValidation.ts`: `ROBOT_KEYS` (exact keys), `isValidRobot(v, farm)`, `isValidLogEvent`, `isValidRobotsSection(v, maps, player)` with exact keys `['nextId','list','pool','log','lastNightFuel','zones']`. Helpers in `src/state/validation.ts`: `hasExactKeys`, `isBool`, `isCount`, `isInt`, `isIntIn`, `isObj`, `isOneOf`, `isCanonicalSubset`, `isValidStack`.
- **Input.** `src/input/panelKeys.ts`: `panelKeyCommand(code, state)` decides I / E / K / Enter / B / Escape from state alone; `INTERACT_KEYS`; `IGNORED`. `InputController` tracks `shiftHeld`; Shift + arrows already means "face without moving"; `TOOL_KEYS` (Space, J) repeat while held; `isEditableTarget` skips keys typed into inputs.
- **HUD.** `src/ui/Hud.ts` (1,233 lines) has widget classes with `sync(state, prev)`; `ContextHint` (~line 528) shows `describeIntent(planPrimaryAction(state).intent)` and `describeIntent(planInteraction(state).intent)`. DOM helpers in `src/ui/dom.ts`: `h`, `hudButton`, `setText`, `setHidden`, `setAttr`. Panels freeze the game through `selectIsFrozen(state)` (paused or any panel open).
- **Main wiring.** `src/main.ts` builds `systems: RenderSystem[]` (each has `sync(state, prev)`, `update(frame)`, `dispose()`), the `Hud`, and `InputController({ target, canvas, store, rig })`.
- **Test helpers** (`tests/testUtils.ts`): `BASE` (a frozen `createInitialState()`), `STAND` (5, 9), `TARGET` (5, 10), `scenario(tile)`, `tileAt`, `withTile`, `withPlayer(state, coord, facing)`, `holding`, `emptyHanded`, `withEnergy`, `withGold`, `atDay(state, day, minute)`, `robotOf(overrides)` (a Mini named Sprocket on TARGET facing South), `withRobots(state, robots)`, `withZones`, `must`, `legacySave(state, version)` (v1/v2 only), `type SaveJson`. The v2 fixture is `tests/fixtures/save-v2.json`.
- **Numbers.** A Mini acts every `ROBOTS.period` (4) minutes. `TIME.dayStartMinute` 360, `TIME.passOutMinute` 1560, `TIME.daysPerSeason` 28. Sizes: Mini 1,500g, Standard 4,000g, Big 10,000g. `ROBOTS.carryEnergy.mini` is 4.
- **Layout.** The farmhouse covers x 0–4, z 0–4; its door is (2, 4); spawn is (2, 5) facing South; the shipping bin covers (9–10, 5); `WORKBENCH.home` (6, 4) is grass on every generated farm.

---

## Interface contract

Every task's **Interfaces** block repeats the part of this contract it consumes and produces. Names, parameter orders and strings here are binding; a task that needs something not listed adds it to its own Produces and says so.

#### Contract for Task 1: Save version 6 scaffolding
- `SAVE_VERSION = 6 as const`.
- `persistence.ts`: `function migrateV5toV6(save: Obj): Obj` (private), called from `migrateSave` after the v4 step. In Task 1 it only sets `version: 6`.
- `tests/testUtils.ts`: `export function v5Save(state: GameState): SaveJson`, the v5 JSON of a v6 state: `version: 5`, every v6-only field removed or turned back. Each later task that adds a v6 field extends it (Task 3 turns `stats` back into `tokensToday`, Task 4 drops `unlocks`, Task 5 drops `onBench` and the workbench tile object, Task 7 drops `paint`, Task 9 drops the marker, `pendingMarker`, `zoneDraft` and `zoneLetter`).
- `tests/robotSaveV6.test.ts`: created here with a "v5 → v6" `describe`. Later tasks add cases.
- Existing tests that assert `version: 5` or migrate to 5 move to 6.

#### Contract for Task 2: Edits as reducer actions
- `src/robots/edits.ts` (pure):
  - `export const PROGRAM_SHAPE`, `MD_SHAPE`, `ZONE_SHAPE` (neutral refusals for input that isn't a program, a card list or a zone), `ZONE_OFF_FARM`, `MD_SCRIPT` (moved verbatim). The usage lines naming `setMd(` / `setZone(` stay in `src/dev/robotDev.ts`, which maps refusals back with `export function consoleText(refusal: string): string` (plan R8);
  - `export function programmedRobot(robot: Robot, program: RobotProgram, minuteOfDay: number): Robot | string` (moved verbatim; the spec's `withProgram`);
  - `export function withMd(robot: Robot, md: readonly MdCard[]): Robot | string`;
  - `export function withZone(state: GameState, id: ZoneId, rect: ZoneRect | null): GameState | string`.
- Actions: `{ type: 'robot/program'; robotId: number; program: RobotProgram }` → `actions.programRobot(robotId, program)`; `{ type: 'robot/md'; robotId: number; md: readonly MdCard[] }` → `actions.setRobotMd(robotId, md)`.
- Reducer: both actions go through one private `editRobot(state, robotId, edit, done)`. Success toasts (success tone): "Programmed {name}." / "Set {name}'s .MD.". A string result becomes a warn toast and no change. An unknown robot id returns `state` unchanged. (Task 5 adds the bench-only rule inside `editRobot`; Task 7 the ruined refusal after it.)
- The edits' existing tests move from `tests/robotDev.test.ts` to `tests/robotEdits.test.ts`; `tests/programGen.ts` and `tests/robotTriggers.test.ts` import from `src/robots/edits`.
- `src/dev/robotDev.ts` imports these; behaviour unchanged.

#### Contract for Task 3: Log merge, stats
- `types.ts`: `export interface RobotStatCounts { readonly tokens: number; readonly actions: number; readonly crops: number }`, `export interface RobotStats { readonly today: RobotStatCounts; readonly week: RobotStatCounts }`; `Robot.stats: RobotStats`; `Robot.tokensToday` removed.
- `config.ts`: `ROBOTS.weekLength: 7`.
- `stats.ts`: `export const ZERO_ROBOT_STATS: RobotStats`; `export function addRobotStats(stats: RobotStats, add: Partial<RobotStatCounts>): RobotStats` (adds to both today and week; returns `stats` itself when every addend is 0 or missing); `export function isWeekStart(dayOfSeason: number): boolean` (`(dayOfSeason - 1) % ROBOTS.weekLength === 0`).
- `pay(state, robotId, cost, counts: Partial<RobotStatCounts> = {})` adds the tokens plus `counts`; `applyRobotPlan` / `applyBickerPlan` add 1 action, and 1 crop for a successful `harvest` or `plant`. Skips add nothing. A wake adds tokens only.
- `resetForMorning` zeroes `today`, and `week` too when `isWeekStart(state.time.dayOfSeason)` (the reset runs after the day advanced).
- `logRobotEvent` merges only when `entry.day === state.time.absoluteDay`.
- Migration: `stats = { today: { tokens: tokensToday, actions: 0, crops: 0 }, week: { tokens: tokensToday, actions: 0, crops: 0 } }`, `tokensToday` dropped. Validation: counts are non-negative integers, and each `today` counter is ≤ `week`'s.
- `robotOf` in testUtils gains `stats: ZERO_ROBOT_STATS` and loses `tokensToday`.

#### Contract for Task 4: Unlocks
- `src/robots/blockKinds.ts`: `export const BLOCK_KINDS` as const, in this order:
  - triggers: `morning`, `atTime`, `bagFull`, `startsRaining`, `every`;
  - control: `repeatTimes`, `repeatUntil`, `repeatForever`, `if`, `forEachTile`, `set`, `change`, `var`, `helper`, `runHelper`;
  - actions: `move`, `turn`, `goTo`, `water`, `refill`, `harvest`, `deposit`, `take`, `till`, `plant`, `powerDown`, `wait`, `say`;
  - sensors: `cropIsReady`, `soilIsDry`, `tileIsTilled`, `cropIs`, `bagIsFull`, `bagHas`, `atEdgeOf`, `tokensBelow`, `tileAheadIs`, `itIsRaining`, `timeIsAfter`;
  - values: `num`, `text`, `yes`, `item`, `tile`, `myTile`, `tileAhead`, `tokensLeft`, `countInBag`, `arith`, `compare`, `and`, `or`, `not`.

  Also `export type BlockKind = (typeof BLOCK_KINDS)[number]`; `export type BlockCategory = 'triggers' | 'control' | 'actions' | 'sensors' | 'values'`; `export const BLOCK_CATEGORY: Readonly<Record<BlockKind, BlockCategory>>`. (`var` is both the variable getter block and the gate for "Make a variable"; it sits in Control because `set` and `change` do. The toolbox shows the `var` getter under Values.)
- `types.ts`:
  - `export const MD_CARD_KINDS = ['dontLeave', 'dontGoIntoWater', 'dontHarvest', 'dontDeposit', 'doReturn', 'doPowerDown'] as const`;
  - `export const ROBOT_TABS = ['program', 'md', 'looks', 'stats', 'log'] as const`, `export type RobotTab`;
  - `export interface RobotUnlocks { blocks: readonly BlockKind[]; cards: readonly MdCard['kind'][]; tabs: readonly RobotTab[] }` (readonly fields; `BlockKind` imported with `import type` from `../robots/blockKinds`);
  - `RobotsState.unlocks: RobotUnlocks`.
- `config.ts`: `UNLOCKS.job1`, exactly spec §7's list in canonical order.
- `src/robots/unlocks.ts`: `export const ALL_UNLOCKS: RobotUnlocks`; `export function withUnlocks(state: GameState, add: Partial<RobotUnlocks>): GameState` (union, canonical order, same state when nothing new).
- Dev hook `unlockAll(): string` → "Unlocked every block, card and tab.".
- A test proves the kinds are distinct across `Statement`, `Expr`, `ActionBlock` and `Trigger` kinds.

#### Contract for Task 5: The workbench, the bench, the switch
- `types.ts`:
  - `'workbench'` in `PLACED_OBJECT_KINDS`; `PlacedObject` gains `{ readonly kind: 'workbench' }`;
  - `Robot.onBench: boolean`; `Robot.off: null | 'dizzy' | 'done' | 'player'`;
  - `UiPanel` gains `{ readonly kind: 'robot'; readonly robotId: number; readonly mode: 'bench' | 'peek' }`.
- `config.ts`: `WORKBENCH = { home: { tx: 6, tz: 4 } satisfies TileCoord, topHeight: 0.55 }` (render height of the bench top, used by `RobotRenderer`).
- `src/robots/workbench.ts` (pure):
  - `export function workbenchTile(farm: WorldState): TileCoord | null`;
  - `export function freeSpotNear(farm: WorldState, from: TileCoord, taken: readonly TileCoord[]): TileCoord`: breadth-first over in-bounds tiles in `DIRECTIONS` order. Free means walkable, no object, no crop, not reserved, not in `taken`.
  - `export function withWorkbenchAt(farm: WorldState, at: TileCoord): WorldState`;
  - `export function robotOnBench(state: GameState): Robot | null`.
- Intents (`Intent` union): `{ kind: 'benchRobot'; robotId; name }` (hint "Put {name} on the bench"), `{ kind: 'openBench'; robotId; name }` (hint "Work on {name}").
  - `planInteraction` checks a workbench on the target tile **before** `planPickUpRobot`: not carrying, bench empty → blocked with "Bring a robot here to work on it".
  - `planCarry` checks the workbench before the shipping bin: occupied → blocked "There's already a robot on the bench.".
  - The pickaxe and axe on a workbench → blocked "It's part of the farm.".
- Reducer: `benchRobot` per spec §2.2 and opens `{ kind: 'robot', robotId, mode: 'bench' }`; `openBench` opens the same panel.
- Actions: `{ type: 'robot/liftOff'; robotId }` → `actions.liftOffBench(robotId)`; `{ type: 'robot/switch'; robotId; on: boolean }` → `actions.switchRobot(robotId, on)`.
  - Lift off: carry energy, too-tired text "You're too tired to carry {name}.", closes the panel.
  - The switch is free and refuses robots not on the bench.
- `programRobot` / `setRobotMd` refuse a robot that isn't on the bench: warn "Put {name} on the workbench first." (private `offBenchRefusal(robot): string | null` in `reducer.ts`, reused by the switch, scrap and paint).
- `switchRobot(id, false)` refuses a robot whose power isn't working, standby or flat: warn "{name} can't be switched off while it's broken.". `programmedRobot` keeps `off: 'player'` (plan R15).
- The `blocked` intent gains an optional `hint?: string`, which `describeIntent` returns; only the empty bench sets it.
- `isDue` returns false for `onBench`, and for any robot whose `off` isn't null (scripts included). `resetForMorning` keeps `off: 'player'` and keeps a benched robot where it is.
- `robotsOnTile` excludes `onBench` robots.
- Migration: `onBench: false` on every robot; the workbench via `freeSpotNear(farm, WORKBENCH.home, robot tiles + the player's tile if on the farm)` when `isValidWorld(farm, 'farm')` holds (export `isValidWorld` from `persistence.ts`).
- Validation: exactly one workbench on the farm, none elsewhere, plus spec §9.2's bench and off rules.
- Rendering: `objectGeometry` workbench part, `objectLayout`, `TileHighlighter`, an inventory icon case only if an exhaustive switch needs one, and `RobotRenderer` lifting a benched robot by `WORKBENCH.topHeight`.

#### Contract for Task 6: Bumps
- `types.ts`: log event `{ readonly kind: 'crashed'; readonly withId: number; readonly forgot: Trigger | null }` in `ROBOT_LOG_EVENT_KINDS` and `RobotLogEvent`.
- `src/robots/bumps.ts` (pure):
  - `export interface MoveIntent { readonly id: number; readonly from: TileCoord; readonly to: TileCoord }`;
  - `export function findBumps(state: GameState, moves: readonly MoveIntent[]): ReadonlyMap<number, number>`: bumped robot id → the id it bumped into. For a same-target bump, that's the lowest other id with that target; for a swap, the other robot; for "into a standing robot", the lowest-id standing robot on the target.
  - `export function forgetRunningStack(robot: Robot): { readonly robot: Robot; readonly forgot: Trigger | null }`.
- `execute.ts`: `export function applyBumpPlan(state: GameState, robotId: number, plan: RobotPlan, withId: number, exec: RobotExec | null = null): GameState`. It pays, settles as a failure (not bickered), sets `off: 'dizzy'` and exec `{ ...exec, running: null, frames: [] }`, forgets, logs `crashed`, and adds the toast.
- `runRobotsMinute`: after the bicker map, build `MoveIntent`s from chosen `act` choices whose plan is `ok` with `action.kind === 'move'`; bumped choices go through `applyBumpPlan`.
- `logText`: `crashed` speech "Made a new friend ✓"; `whatHappened` per spec §3.1, using `triggerText`.
- `eval.ts` `tileAheadIs`: a standing robot ahead (`robotsOnTile(...).length > 0`) → `blocked` Yes, `clear` No, `water` unchanged.
- Put-down refuses a tile with a standing robot: "There's a robot there.".
- `returnRepaired` and `resetForMorning` use `nearestFreeWalkable(state, from, selfId)` (exported from `world.ts`): walkable with no standing robot except `selfId`.
- `applyBumpPlan` pays through `pay(state, robotId, plan.cost, { actions: 1 })`.
- The `pair` preset keeps both robots on the delivery tile and loops `[harvest, turn right]`, so it still bickers but never bumps (plan R11); `presetSpecs` is exported for the test.

#### Contract for Task 7: Ruin, new core, scrapping, paint
- `types.ts`: `'ruined'` in `ROBOT_POWERS`; log event `{ readonly kind: 'ruined' }`; `Robot.paint: number`.
- `config.ts`:
  - `ROBOT_CARE = { scrapShare: 0.25, paintCost: 50, ruinedShade: 0.45 } as const`;
  - `ROBOT_PAINTS`: 16 `{ name, color }` entries, spec §3.4's table in order.
- `stats.ts`: `export function scrapValue(robot: Pick<Robot, 'size'>): number`; `resumedPower` keeps `'ruined'`.
- `overnight.ts`: `ruinSoaked(state, notes)` runs after `returnRepaired` and before `recharge`. `recharge` and the "away" note skip ruined robots.
- Intents: hint "Send {name} for a new core · {cost}g"; the reducer's toast becomes "{name} is off for a new core. Back tomorrow.". A ruined robot at the bin → blocked "{name} is beyond repair. Scrap it at the workbench.".
- Actions: `{ type: 'robot/scrap'; robotId }` → `actions.scrapRobot(robotId)`; `{ type: 'robot/paint'; robotId; paint: number }` → `actions.paintRobot(robotId, paint)`.
- `programRobot`, `setRobotMd`, `switchRobot` and `paintRobot` refuse a ruined robot: "{name} is ruined. It can only be scrapped."
- `logText`: `ruined` speech "Having a long bath ✓"; `whatHappened` "Spent the night in the water. Ruined: it can only be scrapped."; `listNames` and `crashed` fall back to "a scrapped robot".
- Rendering: `ROBOT_MESH_IDS` gains `bodyShell` and `headShell`, white vertex colours, instance colour = `ROBOT_PAINTS[paint].color` (× `ruinedShade` when ruined). The ruined pose is the broken pose without sparks.
- Migration `paint: 0`; validation per spec §9.2.

#### Contract for Task 8: Peek
- Intents: `{ kind: 'peekRobot'; robotId; name }` (hint "Look at {name}"); `export function planShiftInteraction(state: GameState): ActionPlan`:
  1. a workbench ahead → `planInteraction(state)`;
  2. a standing robot ahead on the farm → `peekRobot`;
  3. otherwise blocked silently (Task 9 inserts the marker's clear-zone case here).
- Action `{ type: 'player/peek' }` → `actions.peek()`; the reducer executes `planShiftInteraction`. `peekRobot` opens `{ kind: 'robot', robotId, mode: 'peek' }` at no cost.
- `panelKeyCommand(code: string, state: GameState, shift = false)`: an interact key with `shift` and no inventory screen open → `actions.peek()`.
- `InputController` passes `event.shiftKey`, and gains option `onShiftChange?: (held: boolean) => void`, called when `shiftHeld` flips (also on blur).
- `Hud.setShiftHeld(held: boolean): void`. While Shift is held, `ContextHint` shows `describeIntent(planShiftInteraction(state).intent)` on its interact chip. `main.ts` wires `onShiftChange: (held) => hud.setShiftHeld(held)`.

#### Contract for Task 9: The zone marker
- `types.ts`:
  - `'zoneMarker'` in `TOOL_TYPES`;
  - `UiState.zoneDraft: null | { readonly zone: ZoneId; readonly corner: TileCoord }`, `UiState.zoneLetter: ZoneId`;
  - `RobotsState.pendingMarker: boolean`.
- `config.ts`: `TOOLS.energyCost.zoneMarker: 0`; `ZONE_MARKER = { colors: [8 hex numbers, A…H], outlineHeight: 0.03 } as const`.
- `items.ts` `TOOL_INFO.zoneMarker`: name "Zone Marker", description "Paints zones A to H for your robots. Use it to mark corners; Shift + use picks the zone.". It isn't shippable (tools have `sellPrice: null`).
- Intents:
  - `{ kind: 'zoneCorner'; corner: TileCoord }` (hint "Mark corner");
  - `{ kind: 'markZone'; zone: ZoneId; rect: ZoneRect }` (hint "Mark Zone {letter}");
  - `{ kind: 'clearZone'; zone: ZoneId }` (hint "Clear Zone {letter}").
  - `planTool` case `'zoneMarker'`: off the farm → blocked "Zones are only on the farm.".
  - `planShiftInteraction` step 3: marker selected → `clearZone`.
- Reducer: `markZone` via `withZone` + toast "Zone {L} · {w}×{d}."; `clearZone` → "Cleared Zone {L}.".
- Actions: `{ type: 'zone/cycle' }` → `actions.cycleZoneLetter()` (A → H → A, drops the draft); `{ type: 'zone/clearDraft' }` → `actions.clearZoneDraft()`.
- The draft drops on a hotbar change, a map change, any panel opening, and load.
- `panelKeyCommand`: Escape with no panel open and `ui.zoneDraft !== null` → `actions.clearZoneDraft()`.
- `InputController`: with the marker selected, tool keys dispatch `useTool` on fresh presses only (no hold-repeat), and Shift + a tool key dispatches `cycleZoneLetter()`. The pointer works the same way: Shift + click cycles.
- Delivery: `createInitialState` puts the marker in the first free unlocked slot. Migration does the same, or sets `pendingMarker: true`. `runRobotsOvernight` delivers a pending marker when a slot is free, with the toast "Your zone marker is in your backpack.".
- `src/ui/zoneChip.ts`: `export function zoneChipText(state: GameState): string | null` → "Zone A · 3×3", "Zone A · not set", plus " · corner set" during a draft; null when the marker isn't selected. The `Hud` shows it above the hotbar.
- `src/render/ZoneRenderer.ts`: a `RenderSystem` drawing set zones and the draft when the marker is selected or a robot panel is open. Instanced outlines, letter sprites from a prebuilt texture atlas, no per-frame allocation.
- `deserializeGame` resets `zoneDraft: null`, `zoneLetter: 'A'`; `isValidUi` checks both shapes.

#### Contract for Task 10: Translation
- `src/ui/robotScreen/translate.ts` (pure, no Blockly import):
  - `export interface BlocklyBlockJson { type: string; id: string; x?: number; y?: number; fields?: Record<string, string | number>; inputs?: Record<string, { block?: BlocklyBlockJson; shadow?: BlocklyBlockJson }>; next?: { block?: BlocklyBlockJson; shadow?: BlocklyBlockJson }; extraState?: unknown }` (readonly fields);
  - `export interface BlocklyWorkspaceJson { blocks?: { languageVersion?: number; blocks?: readonly BlocklyBlockJson[] }; variables?: readonly unknown[] }`;
  - `export function programToWorkspace(program: BlockProgram): BlocklyWorkspaceJson`;
  - `export function workspaceToProgram(json: BlocklyWorkspaceJson): { readonly program: BlockProgram; readonly loose: readonly string[] } | { readonly error: string; readonly blockId: string | null }`;
  - `export function countWorkspaceBlocks(json: BlocklyWorkspaceJson): number`;
  - `export const BLOCK_TYPES: readonly string[]` (every `fc_` type);
  - `export function blockTypeFor(kind: BlockKind): readonly string[]` (`if` → `['fc_if', 'fc_ifElse']`, `var` → `['fc_var', 'fc_varDecl']`, `helper` → `['fc_helper']`, else `['fc_' + kind]`).
- Field and input names exactly as spec §5's table; booleans in `fc_yes.VALUE` are the strings `'TRUE'` / `'FALSE'`; `fc_varDecl.TYPE` holds a `ValueType`.
- Ids: `programToWorkspace` numbers blocks `b1`, `b2`, … in depth-first order, so output is deterministic.
- Errors: "Fill every empty slot." (missing input), "This block isn't part of the robot language." (unknown type), and "This block is missing a setting." (missing or ill-typed field).

#### Contract for Task 11: The robot screen shell
- `ROBOT_SCREEN` (added by Task 10) gains `cardDefaults: { returnMinute: 18 * 60, tokensBelow: 10 }` in Task 13.
- `src/ui/RobotScreenHost.ts` (main chunk): `export class RobotScreenHost { constructor(opts: { root: HTMLElement; store: Store<GameState, GameAction> }); sync(state, prev): void; dispose(): void }`. On `panel.kind === 'robot'` it `import('./robotScreen/RobotScreen')` (once), then calls `screen.open(state)`. On close it calls `screen.close()`. A load failure dispatches `closePanel()` and pushes the toast "The robot screen couldn't load. Try again." (a new action `{ type: 'ui/notify'; text: string; tone: MessageTone }` → `actions.notify(text, tone)`).
- `src/ui/robotScreen/RobotScreen.ts`: `export class RobotScreen { constructor(opts: { root: HTMLElement; store }); open(state): void; sync(state, prev): void; close(): void; dispose(): void }`.
- `src/ui/robotScreen/viewModel.ts` (pure, tested in `tests/robotScreen.test.ts`):
  - `headerView(robot: Robot): { name; sizeLabel; parts: readonly RobotPartId[]; tokens: string; power: string; offText: string | null }`;
  - `visibleTabs(mode: 'bench' | 'peek', unlocks: RobotUnlocks): readonly RobotTab[]`;
  - `statsRows(robot: Robot): readonly { label: string; today: string; week: string }[]`;
  - `logRows(state: GameState, robotId: number): readonly { time: string; says: string; happened: string; count: number }[]`;
  - `formatClockMinute(minute: number): string` ("9:40 am").
- Tabs implement `RobotTabView` (`src/ui/robotScreen/tabs/tabView.ts`): `element`, `open(state)`, `sync(state, prev)`, `setActive(active)`, `isDirty()`, `handleEscape()`, `dispose()`, built from a `RobotTabContext` (`robotId`, `mode`, `dispatch`, `getState`, `signal`).
- `panelKeyCommand` returns `null` when `ui.panel.kind === 'robot'`. `InputController` returns early, without `preventDefault`, for every key while the robot panel is open. The screen's `keydown` handler does Escape: the active tab's `handleEscape()` first, then close with the discard prompt.
- Discard prompt: "Discard your changes to {name}'s program?" with "Discard" / "Keep editing". Scrap prompt: "Scrap {name} for {gold}g? This can't be undone." with "Scrap" / "Keep".

#### Contract for Task 12: The Program tab
- `package.json`: `blockly@^13.3.0` in `dependencies`. Its media are copied into `public/blockly-media/` and passed as `media: 'blockly-media/'`, a path relative to the page, so the dev server, `dist/` and `dist-single/` opened from disk all find the media folder (plan R16).
- `src/ui/robotScreen/blockly/blockDefs.ts`: `export function defineBlocks(Blockly: typeof import('blockly/core')): void` (JSON block definitions for every `BLOCK_TYPES` entry, with `fc_var` / `fc_set` / `fc_change` dropdowns generated from the workspace's `fc_varDecl` names).
- `src/ui/robotScreen/blockly/theme.ts`: `export function createTheme(Blockly): Blockly.Theme` (Zelos).
- `src/ui/robotScreen/blockly/toolbox.ts` (pure, tested): `export function toolboxFor(robot: Pick<Robot, 'size' | 'parts'>, unlocks: RobotUnlocks): ToolboxJson`. `export function dropdownOptions(kind: 'minute' | 'every' | 'item' | 'crop' | 'zone', current: string | number | null): readonly [string, string][]` (always includes `current`). Data dropdowns are registered `field_fc_*` subclasses that accept any well-formed value.
- `src/ui/robotScreen/tabs/ProgramTab.ts` implements `RobotTabView`. Save dispatches `actions.programRobot`; translation, loose and checker messages are shown under the toolbar per spec §4.2.

#### Contract for Task 13: The .MD tab
- `src/ui/robotScreen/mdFields.ts` (pure, tested): `export function cardFields(card: MdCard): readonly MdField[]`; `export function newCard(kind: MdCard['kind']): MdCard` (defaults); `setCardValue(card, key, raw, robot)`; `export function mdCountText(md, size): string` ("{n} / {limit} cards").
- `src/ui/robotScreen/tabs/MdTab.ts` implements `RobotTabView`; Save dispatches `actions.setRobotMd`.

#### Contract for Task 14: Bundles and builds
- `package.json`: `"build:check": "npm run build && node scripts/check-bundle.mjs"`; `"build:single": "vite build --mode single && node scripts/build-single.mjs"`.
- `vite.config.ts`: `mode === 'single'` → `build.rolldownOptions.output.codeSplitting = false` (Rolldown's name for `inlineDynamicImports`; plan R13), via `defineConfig(({ mode }) => …)`.
- `scripts/check-bundle.mjs`: gzip sizes (level 6), finds chunks by source map `sources`, enforces the three budgets plus the Blockly-placement rule, then the dist grep `robotLog|installRobotDev|addScriptedRobot|setMd|setZone|unlockAll`.
- `scripts/bundle-baseline.json`: `{ "mainGzipBytes": 275539 }` (Node's `zlib.gzipSync` at level 6; plan R12). The rules live in `scripts/bundleRules.mjs` (+ `.d.mts`), tested by `tests/checkBundle.test.ts`. `build-single.mjs` copies `dist/blockly-media` beside the page (R16).

#### Contract for Task 15: Playbook and spec sync
- `.claude/skills/game-driven-qa/scenarios/farmclaws-part3.md` (spec §11's 12 steps); `SKILL.md` gains part 3 rows (bench, peek, marker, `unlockAll`).
- The spec edits listed in spec §14, plus a "Plan refinements" note in the part 3 spec for anything this plan decided.

---

## Plan refinements of the spec

Decided while drafting this plan. Task 15 writes each into the part 3 spec.

- R1. The spec's `withProgram` is the existing `programmedRobot(robot, program, minuteOfDay)`, moved unchanged.
- R2. `isDue` treats every `off` robot as not due, scripts included, so a bumped or switched-off script robot really stops. (Part 1 scripts never set `off`, so part 1 behaviour is unchanged.)
- R3. Action type strings avoid the dist-check substrings: `robot/md`, not `robot/setMd`.
- R4. `UNLOCKS` and the "Make a variable" gate use one kind, `var`, for the getter, `set`, `change` and declarations. `set` and `change` keep their own kinds for the toolbox.
- R5. The robot screen's load-failure toast needs an action, so `ui/notify` is added.
- R6. `ROBOTS.weekLength` (7) carries the week rollover, since no week constant existed.
- R7. Until Task 11, an open robot panel shows nothing, and Escape still closes it through the existing `panelKeyCommand` path. Task 11 hands the keyboard to the screen.
- R8–R16 are recorded by the tasks that make them (Tasks 2, 10, 6, 14, 5 and 12); R17–R24 are recorded by Task 15 itself. Task 15 lists them all in the spec.

---

### Task 1: Save version 6 scaffolding

**Files:**
- Modify: `src/core/types.ts` (`SAVE_VERSION`, line 13)
- Modify: `src/state/persistence.ts` (new `migrateV5toV6` after `migrateV4toV5`, ~line 365; one line in `migrateSave`, ~line 376)
- Modify: `tests/testUtils.ts` (`legacySave`'s first JSON line, line 270; new `v5Save` after `legacySave`, ~line 305)
- Modify (version literals and the older-save builders only): `tests/persistence.test.ts` (line 159), `tests/maps.test.ts` (line 821), `tests/robotSave.test.ts` (import line 11; lines 71–83), `tests/robotSaveV5.test.ts` (import line 16; lines 124, 133, 142–144)
- Test: `tests/robotSaveV6.test.ts` (create)

**Interfaces:**
- Consumes: part 2's `migrateSave` chain (`migrateV4toV5` last), `isValidGameState`, `serializeGame` / `deserializeGame`; test helpers `BASE`, `must`, `robotOf`, `withRobots`, `withZones`, `legacySave`, `type SaveJson`; `b`, `freshExec`.
- Produces:
  - `src/core/types.ts`: `SAVE_VERSION = 6 as const`.
  - `src/state/persistence.ts`: `function migrateV5toV6(save: Obj): Obj` (private), chained in `migrateSave` after the v4 step. In this task it only writes `version: 6`.
  - `tests/testUtils.ts`: `export function v5Save(state: GameState): SaveJson`, the v5 JSON of a v6 state (`version: 5`, every v6-only field taken out or turned back; in this task there are none yet). `legacySave` now starts from `v5Save(state)`, so the v1/v2 builders never carry part 3 fields either; each later task that adds a v6 field only has to extend `v5Save`.
  - `tests/robotSaveV6.test.ts` with the `describe`s "save version 6" and "v5 → v6". Later tasks add cases.
  - Every existing test that asserted version 5, or built an older save from `serializeGame` of the current state, now asserts 6 and builds from `v5Save`.

- [ ] **Step 1: Write the failing test**

Create `tests/robotSaveV6.test.ts`:

```ts
/**
 * Save version 6 (farmclaws part 3 spec §9): the v5 → v6 migration, round trips of the part 3
 * state, and one corrupted field per validation rule. Each part 3 task that adds a saved field
 * adds its cases here.
 */
import { describe, expect, it } from 'vitest';
import { SAVE_VERSION, type GameState } from '../src/core/types';
import { b } from '../src/robots/blocks';
import { freshExec } from '../src/robots/exec';
import { deserializeGame, migrateSave, serializeGame } from '../src/state/persistence';
import saveV2Text from './fixtures/save-v2.json?raw';
import { BASE, must, robotOf, v5Save, withRobots, withZones, type SaveJson } from './testUtils';

const WALK = b.program({ stacks: [b.when(b.morning(), b.move())] });

/** What a v5 save can hold: a script robot, an idle block robot with an .MD, and a zone. */
function v5Farm(): GameState {
  const robots = [
    robotOf({ id: 1 }),
    robotOf({ id: 2, name: 'Bolt', tx: 4, tz: 10, power: 'standby', program: WALK, exec: freshExec(WALK), md: [{ kind: 'dontGoIntoWater' }] }),
  ];
  return withZones(withRobots(BASE, robots), { A: { x0: 3, z0: 9, w: 4, d: 3 } });
}

/** `state` as deserializeGame returns it: no panel open, unpaused. */
const loadedFrom = (state: GameState): GameState => ({ ...state, ui: { ...state.ui, panel: { kind: 'none' }, paused: false } });

describe('save version 6', () => {
  it('is the current version, and new games start in it', () => {
    expect(SAVE_VERSION).toBe(6);
    expect(BASE.version).toBe(6);
  });

  it('round-trips a farm with robots and zones', () => {
    const state = v5Farm();
    expect(deserializeGame(serializeGame(state))).toEqual(loadedFrom(state));
  });
});

describe('v5 → v6', () => {
  it('writes version 6', () => {
    expect((migrateSave(v5Save(v5Farm())) as SaveJson).version).toBe(6);
  });

  it('loads a v5 save as the state it was taken from', () => {
    const state = v5Farm();
    expect(must(deserializeGame(JSON.stringify(v5Save(state))))).toEqual(state);
  });

  it('migrates the version-2 fixture through every version to 6', () => {
    const loaded = must(deserializeGame(saveV2Text));
    expect(loaded.version).toBe(6);
    expect(loaded.robots.list).toEqual([]);
  });

  it('leaves a save from a later version for the validator to reject', () => {
    const save = { ...v5Save(BASE), version: 7 };
    expect(migrateSave(save)).toBe(save);
    expect(deserializeGame(JSON.stringify(save))).toBeNull();
  });
});
```

Add the helper to `tests/testUtils.ts`, directly after the closing `}` of `legacySave` (before the doc comment of `animal`):

```ts
/**
 * Hand-transforms a current (version 6) state back into the JSON of a version-5 save (farmclaws
 * part 3 spec §9.1): every field version 6 added is taken out again. The state must not hold
 * anything a version-5 save cannot express. legacySave starts from this, so older saves never
 * carry part 3 fields either.
 */
export function v5Save(state: GameState): SaveJson {
  const save = JSON.parse(serializeGame(state)) as SaveJson;
  save.version = 5;
  return save;
}
```

In `legacySave` (same file), replace:

```ts
  const save = JSON.parse(serializeGame(state)) as SaveJson;
  for (const key of Object.keys(createDefaultSections())) delete save[key];
```

with:

```ts
  const save = v5Save(state);
  for (const key of Object.keys(createDefaultSections())) delete save[key];
```

(`legacySave` then overwrites `version` with 1 or 2 as before.)

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run tests/robotSaveV6.test.ts`
Expected: FAIL, 3 failed / 3 passed. "is the current version, and new games start in it", "writes version 6" and "migrates the version-2 fixture through every version to 6" each fail with `AssertionError: expected 5 to be 6 // Object.is equality`. (A v5 save is still the current format, so the round trip, the v5 load and the version-7 rejection already pass.)

- [ ] **Step 3: Implement**

**3a. `src/core/types.ts`.** Replace:

```ts
export const SAVE_VERSION = 5 as const;
```

with:

```ts
export const SAVE_VERSION = 6 as const;
```

**3b. `src/state/persistence.ts`.** Insert directly above the doc comment of `migrateSave` (after the closing `}` of `migrateV4toV5`):

```ts
/** Version 5 predates the robot screen (farmclaws part 3 spec §9.1). */
function migrateV5toV6(save: Obj): Obj {
  return { ...save, version: 6 };
}
```

and in `migrateSave`, replace:

```ts
  if (isObj(v) && v.version === 4) v = migrateV4toV5(v);
  return v;
```

with:

```ts
  if (isObj(v) && v.version === 4) v = migrateV4toV5(v);
  if (isObj(v) && v.version === 5) v = migrateV5toV6(v);
  return v;
```

`isValidGameState` already checks `v.version === SAVE_VERSION`, so it is the v6 validation entry point with no change; later tasks add their fields to the section validators it calls.

- [ ] **Step 4: The existing tests' version literals and older-save builders**

Nothing else in these files changes.

- `tests/persistence.test.ts` line 159: `    expect(SAVE_VERSION).toBe(5);` → `    expect(SAVE_VERSION).toBe(6);`
- `tests/maps.test.ts` line 821: `    expect(migrated.version).toBe(5);` → `    expect(migrated.version).toBe(6);`
- `tests/robotSave.test.ts`:
  - line 11: replace
    ```ts
    import { BASE, TARGET, must, robotOf, withRobots, withTile, type SaveJson } from './testUtils';
    ```
    with
    ```ts
    import { BASE, TARGET, must, robotOf, v5Save, withRobots, withTile, type SaveJson } from './testUtils';
    ```
  - lines 71–83: replace
    ```ts
      it('migrates a version-3 save to an empty robots section', () => {
        const save = JSON.parse(serializeGame(BASE)) as SaveJson;
        delete save.robots;
        delete (save.player as SaveJson).carrying;
        save.version = 3;
        const migrated = migrateSave(save) as SaveJson;
        expect(migrated.version).toBe(5);
        expect(must(deserializeGame(JSON.stringify(save)))).toEqual(BASE);
      });

      it('migrates the version-2 fixture all the way to 5', () => {
        const loaded = must(deserializeGame(saveV2Text));
        expect(loaded.version).toBe(5);
    ```
    with
    ```ts
      it('migrates a version-3 save to an empty robots section', () => {
        const save = v5Save(BASE);
        delete save.robots;
        delete (save.player as SaveJson).carrying;
        save.version = 3;
        const migrated = migrateSave(save) as SaveJson;
        expect(migrated.version).toBe(6);
        expect(must(deserializeGame(JSON.stringify(save)))).toEqual(BASE);
      });

      it('migrates the version-2 fixture all the way to 6', () => {
        const loaded = must(deserializeGame(saveV2Text));
        expect(loaded.version).toBe(6);
    ```
- `tests/robotSaveV5.test.ts`:
  - line 16: replace
    ```ts
    import { BASE, must, robotOf, withRobots, withZones, type SaveJson } from './testUtils';
    ```
    with
    ```ts
    import { BASE, must, robotOf, v5Save, withRobots, withZones, type SaveJson } from './testUtils';
    ```
  - line 124 (in "migrates a version-4 save …"): `    const save = JSON.parse(serializeGame(state)) as SaveJson;` → `    const save = v5Save(state);`
  - line 133: `    expect(migrated.version).toBe(5);` → `    expect(migrated.version).toBe(6);`
  - lines 142–144: replace
    ```ts
      it('migrates the version-2 fixture through three steps to 5', () => {
        const loaded = must(deserializeGame(saveV2Text));
        expect(loaded.version).toBe(5);
    ```
    with
    ```ts
      it('migrates the version-2 fixture through four steps to 6', () => {
        const loaded = must(deserializeGame(saveV2Text));
        expect(loaded.version).toBe(6);
    ```

(`serializeGame` stays imported in both robot save tests: their round trips and `corrupt` helpers still use it. `tests/sections.test.ts` and `tests/wild.test.ts` compare with `SAVE_VERSION` and need no edit.)

- [ ] **Step 5: Run it and see it pass**

Run: `npx vitest run tests/robotSaveV6.test.ts tests/robotSave.test.ts tests/robotSaveV5.test.ts tests/persistence.test.ts tests/maps.test.ts tests/sections.test.ts tests/wild.test.ts`
Expected: PASS (`robotSaveV6.test.ts`: 6 tests).

- [ ] **Step 6: The full gate**

Run: `npm run typecheck && npm test && npm run build`
Expected: all green (56 test files).

- [ ] **Step 7: Commit**

```bash
git add src/core/types.ts src/state/persistence.ts tests/testUtils.ts tests/robotSaveV6.test.ts tests/persistence.test.ts tests/maps.test.ts tests/robotSave.test.ts tests/robotSaveV5.test.ts
git commit -m "Farmclaws part 3: save version 6 scaffolding

SAVE_VERSION is 6 and migrateV5toV6 joins the migration chain; it only writes the
version until later steps add their fields. The test helper v5Save turns a v6 state
back into v5 JSON, and legacySave and the v3/v4 migration tests now start from it,
so each later step only teaches v5Save its own field.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Edits as reducer actions

**Files:**
- Create: `src/robots/edits.ts`
- Modify: `src/dev/robotDev.ts` (imports, lines 5–31; the "Programs, .MDs and zones" block, lines 87–159; `reprogram`, line 215; `setZone`, line 227)
- Modify: `src/robots/create.ts` (imports, line 22; `specProblem`, lines 45 and 49)
- Modify: `src/state/actions.ts` (import, line 5; end of `GameAction`, line 29; end of `actions`, line 55)
- Modify: `src/state/reducer.ts` (type import, line 28; robot imports, lines 43–46; `gameReducer` after `'game/load'`, line 110; new section above `loadState`, line 643)
- Modify (import path only): `tests/programGen.ts` (line 34), `tests/robotTriggers.test.ts` (line 8)
- Modify: `tests/robotDev.test.ts` (the edits' tests move to `tests/robotEdits.test.ts`; the console's usage lines are tested here)
- Test: `tests/robotEdits.test.ts` (create)

**Interfaces:**
- Consumes: part 2's `isProgramShape`, `isMdShape` (`src/state/robotValidation.ts`), `checkProgram`, `checkMd`, `isValidZoneRect` (`src/robots/check.ts`), `execAt`, `morningExec` (`src/robots/exec.ts`), `periodFor`; `findRobot`, `withRobot` (`src/robots/world.ts`); `pushMessage`. Task 1's `SAVE_VERSION = 6` (nothing else).
- Produces:
  - `src/robots/edits.ts` (pure):
    - `export const PROGRAM_SHAPE = 'That program is not a script or a block program.'`, `MD_SHAPE = 'That .MD is not a list of cards.'`, `ZONE_SHAPE = 'Zones are A to H, and a zone is { x0, z0, w, d } or null.'`, `ZONE_OFF_FARM` and `MD_SCRIPT` (both moved verbatim). The dev hooks' three `…_USAGE` lines stay in `src/dev/robotDev.ts` (plan R8).
    - `export function programmedRobot(robot: Robot, program: RobotProgram, minuteOfDay: number): Robot | string` (moved unchanged apart from returning `PROGRAM_SHAPE`; the spec's `withProgram`, plan R1);
    - `export function withMd(robot: Robot, md: readonly MdCard[]): Robot | string`;
    - `export function withZone(state: GameState, id: ZoneId, rect: ZoneRect | null): GameState | string`.
  - `src/dev/robotDev.ts`: `export function consoleText(refusal: string): string` (a shape refusal becomes the hook's usage line; anything else prints as it is). `setProgram`, `setMd` and `setZone` print exactly what they printed before.
  - `src/state/actions.ts`: `{ type: 'robot/program'; robotId: number; program: RobotProgram }` → `actions.programRobot(robotId, program)`; `{ type: 'robot/md'; robotId: number; md: readonly MdCard[] }` → `actions.setRobotMd(robotId, md)`.
  - `src/state/reducer.ts`: private `editRobot(state, robotId, edit, done)`. Success toasts (tone `success`): "Programmed {name}." / "Set {name}'s .MD.". A string result is a `warn` toast and no other change. An unknown robot id returns `state` itself. Edits are not blocked by `selectIsFrozen` (the robot screen is a panel). Task 5 adds the bench-only refusal and Task 7 the ruined one, both inside `editRobot` (Task 5 before `edit(robot)`, Task 7 after the bench check).
  - `src/robots/create.ts` returns `PROGRAM_SHAPE` / `MD_SHAPE` (same text as before).

- [ ] **Step 1: Write the failing tests**

Create `tests/robotEdits.test.ts`. Everything from `describe('programmedRobot', …` to the end of `describe('malformed input never throws', …` is today's `tests/robotDev.test.ts` lines 75–257 moved here, with the usage constants replaced by the edits' own refusals (`PROGRAM_USAGE` → `PROGRAM_SHAPE`, `MD_USAGE` → `MD_SHAPE`, `ZONE_USAGE` → `ZONE_SHAPE`, the literal ".MD cards only apply…" → `MD_SCRIPT`) and five test titles plus one `describe` title reworded from "usage" to "refuses". The last `describe` is new.

```ts
/**
 * Program, .MD and zone edits (farmclaws part 3 spec §4.7): the pure edits moved out of the dev
 * hooks into src/robots/edits.ts, and the programRobot / setRobotMd reducer actions.
 */
import { describe, expect, it } from 'vitest';
import { ROBOTS, TIME } from '../src/config';
import { Direction, type GameState, type MdCard, type RobotAction, type RobotPlace, type RobotProgram, type ZoneRect } from '../src/core/types';
import { b } from '../src/robots/blocks';
import { checkMd, checkProgram } from '../src/robots/check';
import { addRobot } from '../src/robots/create';
import { MD_SCRIPT, MD_SHAPE, PROGRAM_SHAPE, ZONE_OFF_FARM, ZONE_SHAPE, programmedRobot, withMd, withZone } from '../src/robots/edits';
import { freshExec, morningExec } from '../src/robots/exec';
import { requireRobot } from '../src/robots/world';
import { actions } from '../src/state/actions';
import { gameReducer } from '../src/state/reducer';
import { BASE, TARGET, atDay, robotOf, withRobots, withZones } from './testUtils';

const AT: RobotPlace = { tx: TARGET.tx, tz: TARGET.tz, facing: Direction.South };
const STEPS: RobotAction[] = [{ kind: 'water' }, { kind: 'move' }];
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

  it("refuses something that isn't a program", () => {
    for (const junk of [42, null, 'move', { kind: 'blocks' }]) {
      expect(programmedRobot(robotOf(), junk as never, TIME.dayStartMinute)).toBe(PROGRAM_SHAPE);
    }
  });
});

describe('withMd', () => {
  /** An idle block robot: .MD cards only apply to block programs. */
  const BLOCKY = robotOf({ program: WALK, exec: freshExec(WALK), power: 'standby' });

  it('sets the cards', () => {
    const cards: MdCard[] = [{ kind: 'dontGoIntoWater' }, RETURN];
    expect(withMd(BLOCKY, cards)).toEqual({ ...BLOCKY, md: cards, exec: { ...freshExec(WALK), doneCards: [] } });
  });

  it('refuses a robot running a script', () => {
    expect(withMd(robotOf(), [{ kind: 'dontGoIntoWater' }])).toBe(MD_SCRIPT);
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
    const problem = checkMd(four, BLOCKY);
    expect(typeof problem).toBe('string');
    expect(withMd(BLOCKY, four)).toBe(problem);
  });

  it("refuses something that isn't a list of cards", () => {
    for (const junk of [42, null, 'water', [{ kind: 'dance' }]]) expect(withMd(BLOCKY, junk as never)).toBe(MD_SHAPE);
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

  it('refuses an unknown zone or a malformed rectangle', () => {
    expect(withZone(BASE, 'Z' as never, RECT)).toBe(ZONE_SHAPE);
    expect(withZone(BASE, 'A', { ...RECT, x0: 1.5 })).toBe(ZONE_SHAPE);
    expect(withZone(BASE, 'A', undefined as never)).toBe(ZONE_SHAPE);
    expect(withZone(BASE, 'A', 'A1' as never)).toBe(ZONE_SHAPE);
  });

  it('refuses a rectangle that is empty or leaves the farm', () => {
    expect(withZone(BASE, 'A', { ...RECT, w: 0 })).toBe(ZONE_OFF_FARM);
    expect(withZone(BASE, 'A', { ...RECT, d: 0 })).toBe(ZONE_OFF_FARM);
    expect(withZone(BASE, 'A', { ...RECT, x0: -1 })).toBe(ZONE_OFF_FARM);
    expect(withZone(BASE, 'A', { x0: 46, z0: 9, w: 5, d: 1 })).toBe(ZONE_OFF_FARM);
  });
});

describe('malformed input never throws', () => {
  /** A well-shaped program whose repeatForever statements nest `depth` deep. */
  const deep = (depth: number): RobotProgram => {
    let body: unknown[] = [];
    for (let i = 0; i < depth; i++) body = [{ kind: 'repeatForever', body }];
    return { kind: 'blocks', vars: [], stacks: [{ trigger: { kind: 'morning' }, body }], helpers: [] } as unknown as RobotProgram;
  };

  it('answers a 2000-deep program with a message', () => {
    expect(typeof programmedRobot(robotOf(), deep(2000), TIME.dayStartMinute)).toBe('string');
    expect(addRobot(BASE, { name: 'Deep', size: 'mini', parts: ['claw'], place: AT, program: deep(2000) })).toHaveProperty('error');
  });

  it('refuses sparse arrays', () => {
    const holeyStacks = { kind: 'blocks', vars: [], stacks: new Array(1), helpers: [] } as unknown as RobotProgram;
    expect(programmedRobot(robotOf(), holeyStacks, TIME.dayStartMinute)).toBe(PROGRAM_SHAPE);
    const holeyBody = b.program({ stacks: [{ trigger: b.morning(), body: [b.move(), , b.move()] as never }] });
    expect(programmedRobot(robotOf(), holeyBody, TIME.dayStartMinute)).toBe(PROGRAM_SHAPE);
    const holeyScript = { kind: 'script', steps: [{ kind: 'move' }, , { kind: 'move' }], loop: true } as unknown as RobotProgram;
    expect(programmedRobot(robotOf(), holeyScript, TIME.dayStartMinute)).toBe(PROGRAM_SHAPE);
    expect(addRobot(BASE, { name: 'Holey', size: 'mini', parts: ['claw'], place: AT, program: holeyScript })).toHaveProperty('error');
    expect(withMd(robotOf({ program: WALK, exec: freshExec(WALK) }), new Array(1) as never)).toBe(MD_SHAPE);
  });

  it('refuses a 60-deep DAG of shared and nodes promptly', () => {
    let cond: Record<string, unknown> = { kind: 'yes', value: true };
    for (let i = 0; i < 60; i++) cond = { kind: 'and', a: cond, b: cond };
    const dag = b.program({ stacks: [b.when(b.morning(), b.if(cond as never, [b.move()]))] });
    const started = performance.now();
    expect(programmedRobot(robotOf(), dag, TIME.dayStartMinute)).toBe(PROGRAM_SHAPE);
    expect(addRobot(BASE, { name: 'Dag', size: 'mini', parts: ['claw'], place: AT, program: dag })).toHaveProperty('error');
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it('still takes a program that reuses a statement in two stacks', () => {
    const turn = b.turn('right');
    const reused = b.program({ stacks: [b.when(b.morning(), turn), b.when(b.atTime(600), turn)] });
    expect(programmedRobot(robotOf(), reused, TIME.dayStartMinute)).toMatchObject({ program: reused, exec: morningExec(reused) });
  });
});

describe('the programRobot and setRobotMd actions', () => {
  /** Sprocket runs a script; Bolt is an idle block robot. */
  const FARM = withRobots(BASE, [robotOf({ id: 1 }), robotOf({ id: 2, name: 'Bolt', tx: 4, tz: 10, power: 'standby', program: WALK, exec: freshExec(WALK) })]);
  const last = (state: GameState) => state.messages.entries.at(-1);

  it('programs a robot exactly as programmedRobot does, with a toast', () => {
    const afternoon = atDay(FARM, 0, 900);
    const next = gameReducer(afternoon, actions.programRobot(1, WALK));
    expect(requireRobot(next, 1)).toEqual(programmedRobot(requireRobot(afternoon, 1), WALK, 900));
    expect(requireRobot(next, 2)).toBe(requireRobot(afternoon, 2));
    expect(last(next)).toMatchObject({ text: 'Programmed Sprocket.', tone: 'success' });
  });

  it("answers a program the robot can't hold with the checker's sentence and changes nothing else", () => {
    const tooLong = b.program({ stacks: [b.when(b.morning(), ...Array.from({ length: ROBOTS.sizes.mini.blocks }, () => b.move()))] });
    const next = gameReducer(FARM, actions.programRobot(1, tooLong));
    expect(next.robots).toBe(FARM.robots);
    expect(last(next)).toMatchObject({ text: checkProgram(tooLong, robotOf()), tone: 'warn' });
  });

  it('refuses something that is not a program without throwing', () => {
    const next = gameReducer(FARM, actions.programRobot(1, { kind: 'blocks' } as never));
    expect(next.robots).toBe(FARM.robots);
    expect(last(next)).toMatchObject({ text: PROGRAM_SHAPE, tone: 'warn' });
  });

  it("sets a robot's .MD exactly as withMd does, with a toast", () => {
    const cards: MdCard[] = [{ kind: 'dontGoIntoWater' }];
    const next = gameReducer(FARM, actions.setRobotMd(2, cards));
    expect(requireRobot(next, 2)).toEqual(withMd(requireRobot(FARM, 2), cards));
    expect(last(next)).toMatchObject({ text: "Set Bolt's .MD.", tone: 'success' });
  });

  it('refuses .MD cards for a robot running a script', () => {
    const next = gameReducer(FARM, actions.setRobotMd(1, [{ kind: 'dontGoIntoWater' }]));
    expect(next.robots).toBe(FARM.robots);
    expect(last(next)).toMatchObject({ text: MD_SCRIPT, tone: 'warn' });
  });

  it('ignores a robot id that is not on the farm', () => {
    expect(gameReducer(FARM, actions.programRobot(9, WALK))).toBe(FARM);
    expect(gameReducer(FARM, actions.setRobotMd(9, []))).toBe(FARM);
  });

  it('edits while a panel freezes the game, as the robot screen needs', () => {
    const frozen: GameState = { ...FARM, ui: { ...FARM.ui, panel: { kind: 'inventory' } } };
    expect(requireRobot(gameReducer(frozen, actions.programRobot(1, WALK)), 1).program).toBe(WALK);
    expect(requireRobot(gameReducer(frozen, actions.setRobotMd(2, [RETURN])), 2).md).toEqual([RETURN]);
  });
});
```

Replace the whole of `tests/robotDev.test.ts` with (lines 11–61 of the current file are kept unchanged; the edits' tests now live in `robotEdits.test.ts`):

```ts
import { describe, expect, it } from 'vitest';
import { Direction, type RobotAction, type RobotPlace } from '../src/core/types';
import { consoleText, scriptedRobotSpec } from '../src/dev/robotDev';
import { addRobot } from '../src/robots/create';
import { MD_SCRIPT, MD_SHAPE, PROGRAM_SHAPE, ZONE_OFF_FARM, ZONE_SHAPE } from '../src/robots/edits';
import { BASE, TARGET } from './testUtils';

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

// Part 2 (spec §12): the console's usage lines. The edits themselves are tested in robotEdits.test.ts.

describe('consoleText', () => {
  it("prints each hook's usage line for input that is not shaped right", () => {
    expect(consoleText(PROGRAM_SHAPE)).toBe('Usage: setProgram(name, blocks.program({ stacks: [blocks.when(blocks.morning(), blocks.move())] }))');
    expect(consoleText(MD_SHAPE)).toBe("Usage: setMd(name, [{ kind: 'dontGoIntoWater' }, { kind: 'doReturn', to: { kind: 'generator' }, minute: 1080 }])");
    expect(consoleText(ZONE_SHAPE)).toBe("Usage: setZone('A', { x0, z0, w, d }) sets a zone and setZone('A', null) clears it. Zones are A to H.");
  });

  it('prints every other refusal as it is', () => {
    expect(consoleText(MD_SCRIPT)).toBe('.MD cards only apply to block programs.');
    expect(consoleText(ZONE_OFF_FARM)).toBe('A zone is at least 1 × 1 tile and lies wholly inside the farm.');
    expect(consoleText('Mini robots hold 12 blocks; this program has 13.')).toBe('Mini robots hold 12 blocks; this program has 13.');
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run tests/robotEdits.test.ts tests/robotDev.test.ts`
Expected: FAIL, 2 test files failed, no tests run: `Error: Cannot find module '../src/robots/edits' imported from …/tests/robotEdits.test.ts` (and the same for `tests/robotDev.test.ts`).

- [ ] **Step 3: Create `src/robots/edits.ts`**

`programmedRobot`, `withMd`, `isZoneRectShape` and `withZone` are moved from `src/dev/robotDev.ts` with only their shape refusals changed:

```ts
/**
 * Editing a robot's program and .MD and the farm's zones (farmclaws part 2 spec §12, part 3 spec
 * §4.7). The workbench's reducer actions and the dev hooks make every edit through these, after
 * the same gate: isProgramShape → checkProgram and isMdShape → checkMd. Pure.
 *
 * The refusals for malformed input never name a dev hook: this module is in the production bundle,
 * which the dist check greps for hook names. The hooks print their usage line instead.
 */
import { TIME } from '../config';
import { ZONE_IDS, type GameState, type MdCard, type Robot, type RobotProgram, type ZoneId, type ZoneRect } from '../core/types';
import { isMdShape, isProgramShape } from '../state/robotValidation';
import { isInt, isObj, isOneOf } from '../state/validation';
import { checkMd, checkProgram, isValidZoneRect } from './check';
import { execAt, morningExec } from './exec';
import { periodFor } from './stats';

export const PROGRAM_SHAPE = 'That program is not a script or a block program.';
export const MD_SHAPE = 'That .MD is not a list of cards.';
export const ZONE_SHAPE = 'Zones are A to H, and a zone is { x0, z0, w, d } or null.';
export const ZONE_OFF_FARM = 'A zone is at least 1 × 1 tile and lies wholly inside the farm.';
export const MD_SCRIPT = '.MD cards only apply to block programs.';

/** Powers a new program doesn't change: the robot needs charging, rescuing or repairing first. */
const KEPT_POWERS: ReadonlySet<Robot['power']> = new Set<Robot['power']>(['flat', 'broken', 'repairing']);

/**
 * `robot` with a new program, set up the way the morning reset would (part 2 spec §12). A block
 * program starts its `morning` stack only if `minuteOfDay` is no later than the robot's first
 * act of the day (TIME.dayStartMinute + its period); later it idles until a trigger fires, with
 * the atTime triggers already past today spent (execAt). A script runs from step 0. Either way
 * the robot turns back on and acts one period from now; a flat, broken or repairing robot keeps
 * its power. Returns the checker's sentence instead when the program fails, or PROGRAM_SHAPE when
 * it isn't a program at all.
 */
export function programmedRobot(robot: Robot, program: RobotProgram, minuteOfDay: number): Robot | string {
  if (!isProgramShape(program)) return PROGRAM_SHAPE;
  const problem = checkProgram(program, robot);
  if (problem !== null) return problem;
  const early = minuteOfDay <= TIME.dayStartMinute + periodFor(robot);
  const exec = program.kind === 'blocks' ? (early ? morningExec(program) : execAt(program, minuteOfDay)) : null;
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
 * may be gone; a working robot then stands by until a trigger or a DO card moves it. A robot
 * running a script is refused: .MD cards only apply to block programs. Returns the checker's
 * sentence for cards the robot can't hold, or MD_SHAPE when `md` isn't a list of cards.
 */
export function withMd(robot: Robot, md: readonly MdCard[]): Robot | string {
  if (!isMdShape(md)) return MD_SHAPE;
  const exec = robot.exec;
  if (exec === null) return MD_SCRIPT;
  const problem = checkMd(md, robot);
  if (problem !== null) return problem;
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

/**
 * `state` with zone `id` set to `rect` (only its four fields) or cleared with null. Returns
 * ZONE_OFF_FARM for a rectangle that is empty or leaves the farm, and ZONE_SHAPE for an unknown
 * zone or something that isn't a rectangle.
 */
export function withZone(state: GameState, id: ZoneId, rect: ZoneRect | null): GameState | string {
  if (!isOneOf(id, ZONE_IDS) || (rect !== null && !isZoneRectShape(rect))) return ZONE_SHAPE;
  if (rect !== null && !isValidZoneRect(rect)) return ZONE_OFF_FARM;
  const zone: ZoneRect | null = rect === null ? null : { x0: rect.x0, z0: rect.z0, w: rect.w, d: rect.d };
  return { ...state, robots: { ...state.robots, zones: { ...state.robots.zones, [id]: zone } } };
}
```

- [ ] **Step 4: The dev hooks call the edits**

In `src/dev/robotDev.ts`, replace the imports (lines 5–31):

```ts
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
import { execAt, morningExec } from '../robots/exec';
import { robotSays, whatHappened } from '../robots/logText';
import { periodFor } from '../robots/stats';
import { withRobot } from '../robots/world';
import { actions, type GameAction } from '../state/actions';
import { isMdShape, isProgramShape } from '../state/robotValidation';
import { selectTargetTile } from '../state/selectors';
import { isInt, isObj, isOneOf } from '../state/validation';
```

with:

```ts
import type { Store } from '../core/store';
import {
  CRAFTING_RECIPE_IDS,
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
import { addRobot, type RobotSpec } from '../robots/create';
import { MD_SHAPE, PROGRAM_SHAPE, ZONE_SHAPE, programmedRobot, withMd, withZone } from '../robots/edits';
import { robotSays, whatHappened } from '../robots/logText';
import { withRobot } from '../robots/world';
import { actions, type GameAction } from '../state/actions';
import { selectTargetTile } from '../state/selectors';
```

Then replace the whole block from its banner (lines 87–90):

```ts
// ---------------------------------------------------------------------------
// Programs, .MDs and zones (part 2 spec §12). Pure, so the tests need no window. The workbench
// (part 3) will call the same checker and the same exec rebuild.
// ---------------------------------------------------------------------------
```

down to and including the closing `}` of `withZone` (line 159, the line after `  return { ...state, robots: { ...state.robots, zones: { ...state.robots.zones, [id]: zone } } };`), which covers the five constants, `KEPT_POWERS`, `programmedRobot`, `withMd`, `isZoneRectShape` and `withZone`, with:

```ts
// ---------------------------------------------------------------------------
// Programs, .MDs and zones (part 2 spec §12). The edits themselves live in src/robots/edits.ts,
// shared with the workbench's reducer actions (part 3 spec §4.7); the hooks add their usage lines.
// ---------------------------------------------------------------------------

const PROGRAM_USAGE = 'Usage: setProgram(name, blocks.program({ stacks: [blocks.when(blocks.morning(), blocks.move())] }))';
const MD_USAGE = "Usage: setMd(name, [{ kind: 'dontGoIntoWater' }, { kind: 'doReturn', to: { kind: 'generator' }, minute: 1080 }])";
const ZONE_USAGE = "Usage: setZone('A', { x0, z0, w, d }) sets a zone and setZone('A', null) clears it. Zones are A to H.";

/** Each malformed-input refusal of the edits, and the usage line its hook prints instead. */
const USAGE_FOR: ReadonlyMap<string, string> = new Map([
  [PROGRAM_SHAPE, PROGRAM_USAGE],
  [MD_SHAPE, MD_USAGE],
  [ZONE_SHAPE, ZONE_USAGE],
]);

/** What a hook prints for an edit's refusal: its usage line when the input wasn't shaped right, else the refusal itself. */
export function consoleText(refusal: string): string {
  return USAGE_FOR.get(refusal) ?? refusal;
}
```

In `reprogram` (inside `installRobotDev`), replace:

```ts
    const next = change(robot, state);
    if (typeof next === 'string') return next;
```

with:

```ts
    const next = change(robot, state);
    if (typeof next === 'string') return consoleText(next);
```

and in `setZone`, replace:

```ts
    const next = withZone(store.getState(), id, rect);
    if (typeof next === 'string') return next;
```

with:

```ts
    const next = withZone(store.getState(), id, rect);
    if (typeof next === 'string') return consoleText(next);
```

`setProgram` and `setMd` already call `programmedRobot` and `withMd` by name, now imported from `../robots/edits`; their text is unchanged.

- [ ] **Step 5: `addRobot` shares the shape refusals**

In `src/robots/create.ts`, replace:

```ts
import { checkMd, checkProgram } from './check';
```

with:

```ts
import { checkMd, checkProgram } from './check';
import { MD_SHAPE, PROGRAM_SHAPE } from './edits';
```

In `specProblem`, replace:

```ts
  if (!isProgramShape(spec.program)) return 'That program is not a script or a block program.';
```

with:

```ts
  if (!isProgramShape(spec.program)) return PROGRAM_SHAPE;
```

and replace:

```ts
  if (!isMdShape(md)) return 'That .MD is not a list of cards.';
```

with:

```ts
  if (!isMdShape(md)) return MD_SHAPE;
```

- [ ] **Step 6: The actions and the reducer**

In `src/state/actions.ts`, replace:

```ts
import type { CraftingRecipeId, Direction, GameState, SeedItemId, SlotRef } from '../core/types';
```

with:

```ts
import type { CraftingRecipeId, Direction, GameState, MdCard, RobotProgram, SeedItemId, SlotRef } from '../core/types';
```

replace:

```ts
  | { readonly type: 'game/load'; readonly state: GameState };
```

with:

```ts
  | { readonly type: 'game/load'; readonly state: GameState }
  /** Gives a robot a new program, through the checker (farmclaws part 3 spec §4.7). */
  | { readonly type: 'robot/program'; readonly robotId: number; readonly program: RobotProgram }
  /** Gives a robot a new .MD, through the checker. */
  | { readonly type: 'robot/md'; readonly robotId: number; readonly md: readonly MdCard[] };
```

and replace:

```ts
  load: (state: GameState): GameAction => ({ type: 'game/load', state }),
} as const;
```

with:

```ts
  load: (state: GameState): GameAction => ({ type: 'game/load', state }),
  programRobot: (robotId: number, program: RobotProgram): GameAction => ({ type: 'robot/program', robotId, program }),
  setRobotMd: (robotId: number, md: readonly MdCard[]): GameAction => ({ type: 'robot/md', robotId, md }),
} as const;
```

In `src/state/reducer.ts`, in the `../core/types` import replace:

```ts
  type PlacedObject,
  type Quality,
```

with:

```ts
  type PlacedObject,
  type Quality,
  type Robot,
```

replace:

```ts
import { runRobotsOvernight } from '../robots/overnight';
```

with:

```ts
import { programmedRobot, withMd } from '../robots/edits';
import { runRobotsOvernight } from '../robots/overnight';
```

replace:

```ts
import { requireRobot, withRobot } from '../robots/world';
```

with:

```ts
import { findRobot, requireRobot, withRobot } from '../robots/world';
```

In `gameReducer`, replace:

```ts
    case 'game/load':
      return loadState(state, action.state);
    default: {
```

with:

```ts
    case 'game/load':
      return loadState(state, action.state);
    case 'robot/program':
      return editRobot(state, action.robotId, (robot) => programmedRobot(robot, action.program, state.time.minuteOfDay), (name) => `Programmed ${name}.`);
    case 'robot/md':
      return editRobot(state, action.robotId, (robot) => withMd(robot, action.md), (name) => `Set ${name}'s .MD.`);
    default: {
```

and insert directly above the doc comment of `loadState` (`/** Replaces the whole state (new game / loaded save): …`):

```ts
// ---------------------------------------------------------------------------
// Robot edits (farmclaws part 3 spec §4.7)
// ---------------------------------------------------------------------------

/**
 * Applies a program or .MD edit to robot `robotId`: the edited robot and a success toast, or the
 * edit's refusal as a warn toast with nothing else changed. An unknown id changes nothing. Edits
 * aren't frozen with the game: the robot screen that sends them is a panel.
 */
function editRobot(state: GameState, robotId: number, edit: (robot: Robot) => Robot | string, done: (name: string) => string): GameState {
  const robot = findRobot(state, robotId);
  if (robot === null) return state;
  const edited = edit(robot);
  if (typeof edited === 'string') return pushMessage(state, edited, 'warn');
  return pushMessage(withRobot(state, edited), done(robot.name), 'success');
}
```

- [ ] **Step 7: The other importers**

- `tests/programGen.ts` line 34: replace `import { programmedRobot, withMd } from '../src/dev/robotDev';` with `import { programmedRobot, withMd } from '../src/robots/edits';`
- `tests/robotTriggers.test.ts` line 8: replace `import { programmedRobot } from '../src/dev/robotDev';` with `import { programmedRobot } from '../src/robots/edits';`

- [ ] **Step 8: Run them and see them pass**

Run: `npx vitest run tests/robotEdits.test.ts tests/robotDev.test.ts tests/robotTriggers.test.ts tests/robotInterpretSafety.test.ts`
Expected: PASS (`robotEdits.test.ts`: 30 tests, `robotDev.test.ts`: 9 tests).

- [ ] **Step 9: The full gate**

Run: `npm run typecheck && npm test && npm run build`
Expected: all green (57 test files). Check that the production bundle names no hook: `grep -c "setMd\|setZone" dist/assets/*.js` prints `0` for every file.

- [ ] **Step 10: Commit**

```bash
git add src/robots/edits.ts src/dev/robotDev.ts src/robots/create.ts src/state/actions.ts src/state/reducer.ts tests/robotEdits.test.ts tests/robotDev.test.ts tests/programGen.ts tests/robotTriggers.test.ts
git commit -m "Farmclaws part 3: program and .MD edits as reducer actions

programmedRobot (the spec's withProgram), withMd and withZone move from the dev hooks
into src/robots/edits.ts, and robot/program and robot/md apply them with a toast.
The edits refuse malformed input with PROGRAM_SHAPE, MD_SHAPE and ZONE_SHAPE instead
of the hooks' usage lines, because the reducer puts this module in the production
bundle and the dist check greps for setMd and setZone; consoleText turns them back
into the usage lines, so the hooks print exactly what they printed before.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Log merge, stats

**Files:**
- Modify: `src/core/types.ts` (new `RobotStatCounts` and `RobotStats` above `interface Robot`, line 555; `tokensToday` in `Robot`, lines 587–588)
- Modify: `src/config.ts` (end of `ROBOTS`, ~line 300)
- Modify: `src/robots/stats.ts` (type import, line 5; end of file)
- Modify: `src/robots/execute.ts` (type import, lines 22–23; stats import, line 36; `pay`, lines 165–170; first lines of `applyRobotPlan`, line 177, and `applyBickerPlan`, line 188)
- Modify: `src/robots/log.ts` (`logRobotEvent`, lines 13–23)
- Modify: `src/robots/overnight.ts` (imports, lines 8 and 13; new `morningStats` above `resetForMorning`'s doc comment, ~line 130; `resetForMorning`, lines 141–159)
- Modify: `src/robots/create.ts` (stats import, line 25; robot literal, line 91)
- Modify: `src/state/robotValidation.ts` (type import, line 28; `ROBOT_KEYS`, line 48; new validators above `isValidRobot`, line 590; line 598)
- Modify: `src/state/persistence.ts` (`migrateV5toV6`)
- Modify: `tests/testUtils.ts` (imports; `robotOf`, line 403; `v5Save`)
- Modify (stats in place of `tokensToday` only): `tests/robotRun.test.ts` (line 62), `tests/robotOvernight.test.ts` (lines 71–73), `tests/robotTriggers.test.ts` (lines 65 and 73), `tests/robotMd.test.ts` (line 50), `tests/robotSave.test.ts` (line 111)
- Test: `tests/robotLog.test.ts` (create), `tests/robotStats.test.ts` (extend), `tests/robotSaveV6.test.ts` (extend)

**Interfaces:**
- Consumes: Task 1's `migrateV5toV6`, `v5Save`, `tests/robotSaveV6.test.ts` (`loadedFrom`, `BASE`, `must`, `robotOf`, `withRobots`); part 1–2's `pay`, `applyRobotPlan`, `applyBickerPlan`, `chargeWake`, `resetForMorning`, `logRobotEvent`, `TIME.daysPerSeason` (28).
- Produces:
  - `src/core/types.ts`: `export interface RobotStatCounts { readonly tokens: number; readonly actions: number; readonly crops: number }`; `export interface RobotStats { readonly today: RobotStatCounts; readonly week: RobotStatCounts }`; `Robot.stats: RobotStats`; `Robot.tokensToday` removed.
  - `src/config.ts`: `ROBOTS.weekLength: 7` (plan R6).
  - `src/robots/stats.ts`: `export const ZERO_ROBOT_STATS: RobotStats`; `export function addRobotStats(stats: RobotStats, add: Partial<RobotStatCounts>): RobotStats` (adds to today and week; returns `stats` itself when every addend is 0 or missing); `export function isWeekStart(dayOfSeason: number): boolean` (`(dayOfSeason - 1) % ROBOTS.weekLength === 0`).
  - `execute.ts`: `pay` counts every cost in `tokens` (actions, bickers, wakes; Task 6's bumps go through it too). `applyRobotPlan` and `applyBickerPlan` add 1 to `actions`, and 1 to `crops` for a successful `harvest` or `plant`. A skip adds nothing; a wake (`chargeWake`) adds tokens only. Paying 0 and counting nothing still returns the same state.
  - `overnight.ts`: `resetForMorning` zeroes `today`, and `week` too when `isWeekStart(state.time.dayOfSeason)` (the reset runs after the day advanced); unchanged stats keep their reference.
  - `log.ts`: `logRobotEvent` merges only into an entry with `entry.day === state.time.absoluteDay`.
  - Migration: `stats = { today: { tokens: tokensToday, actions: 0, crops: 0 }, week: { tokens: tokensToday, actions: 0, crops: 0 } }`, `tokensToday` dropped. Validation: exact keys, counts are non-negative integers, each `today` counter ≤ `week`'s.
  - `tests/testUtils.ts`: `robotOf` has `stats: ZERO_ROBOT_STATS` and no `tokensToday`; `v5Save` turns `stats` back into `tokensToday` and throws for stats a v5 save can't hold (actions or crops counted, or `week` ≠ `today`).

- [ ] **Step 1: Write the failing tests**

Create `tests/robotLog.test.ts`:

```ts
/**
 * The farm log's merging (farmclaws part 3 spec §6.2): a repeated event merges into the robot's
 * most recent entry only when that entry is from today.
 */
import { describe, expect, it } from 'vitest';
import type { GameState } from '../src/core/types';
import { logRobotEvent } from '../src/robots/log';
import { BASE, atDay, robotOf, withRobots } from './testUtils';

/** [day, minute, event kind, count] per entry, oldest first. */
const rows = (state: GameState) => state.robots.log.entries.map((e) => [e.day, e.minute, e.event.kind, e.count]);

describe('merging log entries', () => {
  it('merges a repeated event within the day, keeping the first time', () => {
    let state = withRobots(atDay(BASE, 3, 600), [robotOf()]);
    state = logRobotEvent(state, 1, { kind: 'flat' });
    state = logRobotEvent(atDay(state, 3, 640), 1, { kind: 'flat' });
    expect(rows(state)).toEqual([[3, 600, 'flat', 2]]);
  });

  it('starts a new entry for the same event on a new day, and merges into that one', () => {
    let state = withRobots(atDay(BASE, 3, 1500), [robotOf()]);
    state = logRobotEvent(state, 1, { kind: 'flat' });
    state = logRobotEvent(atDay(state, 4, 400), 1, { kind: 'flat' });
    state = logRobotEvent(atDay(state, 4, 420), 1, { kind: 'flat' });
    expect(rows(state)).toEqual([
      [3, 1500, 'flat', 1],
      [4, 400, 'flat', 2],
    ]);
    expect(state.robots.log.nextId).toBe(2);
  });
});
```

In `tests/robotStats.test.ts`, replace the imports:

```ts
import { ROBOTS } from '../src/config';
import { EVERY_CHOICES, type RobotActionKind, type RobotPartId, type RobotSize } from '../src/core/types';
import { PART_ACTIONS, ROBOT_ACTION_KINDS, canDo } from '../src/robots/parts';
import { actionCost, bagStacks, batteryFor, carryEnergyFor, periodFor, repairCost, scaledCost, wakeCostFor } from '../src/robots/stats';
```

with:

```ts
import { ROBOTS } from '../src/config';
import {
  EVERY_CHOICES,
  TileState,
  type GameState,
  type Robot,
  type RobotAction,
  type RobotActionKind,
  type RobotPartId,
  type RobotSize,
  type RobotStats,
} from '../src/core/types';
import { b } from '../src/robots/blocks';
import { freshExec, morningExec } from '../src/robots/exec';
import { PART_ACTIONS, ROBOT_ACTION_KINDS, canDo } from '../src/robots/parts';
import {
  ZERO_ROBOT_STATS,
  actionCost,
  addRobotStats,
  bagStacks,
  batteryFor,
  carryEnergyFor,
  isWeekStart,
  periodFor,
  repairCost,
  scaledCost,
  wakeCostFor,
} from '../src/robots/stats';
import { requireRobot } from '../src/robots/world';
import { actions } from '../src/state/actions';
import { gameReducer } from '../src/state/reducer';
import { BASE, TARGET, atDay, matureCrop, robotOf, soilTile, stack, withRobots, withTile, withZones } from './testUtils';
```

and append at the end of the file:

```ts
describe('robot stats today and this week (part 3)', () => {
  const tick = (state: GameState, minutes: number): GameState => gameReducer(state, actions.tick(minutes));
  const sleep = (state: GameState): GameState => gameReducer(state, actions.sleep());
  const script = (...steps: RobotAction[]): Robot['program'] => ({ kind: 'script', steps, loop: true });
  /** The same counts today and this week, as on a robot's first day. */
  const both = (tokens: number, acts: number, crops: number): RobotStats => ({ today: { tokens, actions: acts, crops }, week: { tokens, actions: acts, crops } });
  const statsOf = (state: GameState, id = 1): RobotStats => requireRobot(state, id).stats;
  const BUSY: RobotStats = { today: { tokens: 12, actions: 4, crops: 1 }, week: { tokens: 50, actions: 20, crops: 6 } };
  const ripe = withTile(BASE, TARGET, soilTile(TileState.Watered, matureCrop('parsnip')), 'farm');

  it('starts at zero and adds to today and this week together', () => {
    expect(ZERO_ROBOT_STATS).toEqual({ today: { tokens: 0, actions: 0, crops: 0 }, week: { tokens: 0, actions: 0, crops: 0 } });
    expect(addRobotStats(BUSY, { tokens: 3, actions: 1, crops: 1 })).toEqual({
      today: { tokens: 15, actions: 5, crops: 2 },
      week: { tokens: 53, actions: 21, crops: 7 },
    });
    expect(addRobotStats(BUSY, { tokens: 1 })).toEqual({ today: { tokens: 13, actions: 4, crops: 1 }, week: { tokens: 51, actions: 20, crops: 6 } });
  });

  it('keeps the same stats object when there is nothing to add', () => {
    expect(addRobotStats(BUSY, {})).toBe(BUSY);
    expect(addRobotStats(BUSY, { tokens: 0, actions: 0, crops: 0 })).toBe(BUSY);
  });

  it('starts a week on days 1, 8, 15 and 22 of the season', () => {
    expect(ROBOTS.weekLength).toBe(7);
    expect([1, 8, 15, 22].map(isWeekStart)).toEqual([true, true, true, true]);
    expect([2, 7, 9, 21, 28].map(isWeekStart)).toEqual([false, false, false, false, false]);
  });

  it('counts a harvest: its tokens, one action and one crop', () => {
    const next = tick(withRobots(ripe, [robotOf({ program: script({ kind: 'harvest' }) })]), 4);
    expect(statsOf(next)).toEqual(both(3, 1, 1));
  });

  it('counts a planting as a crop', () => {
    const plowed = withTile(BASE, TARGET, soilTile(TileState.Plowed), 'farm');
    const planter = robotOf({ parts: ['seeder'], bag: [stack('parsnip_seeds', 2)], program: script({ kind: 'plant', cropId: 'parsnip' }) });
    expect(statsOf(tick(withRobots(plowed, [planter]), 4))).toEqual(both(3, 1, 1));
  });

  it('counts a blocked action and a bicker as actions, with their tokens and no crop', () => {
    const blocked = tick(withRobots(BASE, [robotOf({ program: script({ kind: 'harvest' }) })]), 4);
    expect(statsOf(blocked)).toEqual(both(3, 1, 0));
    const harvest = script({ kind: 'harvest' });
    const bickered = tick(withRobots(ripe, [robotOf({ id: 1, program: harvest }), robotOf({ id: 2, name: 'Bolt', program: harvest })]), 4);
    expect([statsOf(bickered, 1), statsOf(bickered, 2)]).toEqual([both(3, 1, 0), both(3, 1, 0)]);
  });

  it("counts a wake's tokens but not as an action", () => {
    const every = b.program({ stacks: [b.when(b.every(15), b.turn('right'))] });
    const idle = robotOf({ power: 'standby', program: every, exec: freshExec(every) });
    // Woken at 6:16 for 1 token, then a turn for 1 token: one action.
    expect(statsOf(tick(withRobots(BASE, [idle]), 16))).toEqual(both(2, 1, 0));
  });

  it('adds nothing for a skipped action', () => {
    const mover = b.program({ stacks: [b.when(b.morning(), b.forever(b.move()))] });
    const robot = robotOf({ tz: 12, program: mover, exec: morningExec(mover), md: [{ kind: 'dontLeave', zone: 'A' }] });
    const next = tick(withZones(withRobots(BASE, [robot]), { A: { x0: 3, z0: 9, w: 5, d: 4 } }), 4);
    expect(next.robots.log.entries.map((e) => e.event.kind)).toEqual(['skipped']);
    expect(statsOf(next)).toBe(ZERO_ROBOT_STATS);
  });

  it('starts today again each morning and keeps the week', () => {
    const next = sleep(withRobots(BASE, [robotOf({ stats: BUSY })]));
    expect(statsOf(next)).toEqual({ today: { tokens: 0, actions: 0, crops: 0 }, week: BUSY.week });
  });

  it('starts the week again on the morning of day 8, and on the first day of a season', () => {
    expect(statsOf(sleep(withRobots(atDay(BASE, 6), [robotOf({ stats: BUSY })])))).toEqual(ZERO_ROBOT_STATS);
    expect(statsOf(sleep(withRobots(atDay(BASE, 27), [robotOf({ stats: BUSY })])))).toEqual(ZERO_ROBOT_STATS);
  });

  it('keeps the stats object of a robot the morning has nothing to reset for', () => {
    const resting: RobotStats = { today: ZERO_ROBOT_STATS.today, week: BUSY.week };
    expect(statsOf(sleep(withRobots(BASE, [robotOf({ stats: resting })])))).toBe(resting);
    expect(statsOf(sleep(withRobots(atDay(BASE, 6), [robotOf()])))).toBe(ZERO_ROBOT_STATS);
  });
});
```

In `tests/robotSaveV6.test.ts`, replace:

```ts
import { SAVE_VERSION, type GameState } from '../src/core/types';
```

with:

```ts
import { SAVE_VERSION, type GameState, type RobotStats } from '../src/core/types';
```

insert directly after the `loadedFrom` constant:

```ts

/** Serialises `state`, lets `edit` change the parsed JSON, and loads it again. */
function corrupt(state: GameState, edit: (save: SaveJson) => void): GameState | null {
  const save = JSON.parse(serializeGame(state)) as SaveJson;
  edit(save);
  return deserializeGame(JSON.stringify(save));
}

const robotsOf = (save: SaveJson) => save.robots as SaveJson & { list: SaveJson[] };
/** The first saved robot. */
const firstRobot = (save: SaveJson): SaveJson => must(robotsOf(save).list[0]);
```

and append at the end of the file:

```ts

describe('robot stats in save version 6', () => {
  const STATS: RobotStats = { today: { tokens: 5, actions: 2, crops: 1 }, week: { tokens: 40, actions: 9, crops: 3 } };
  const counted = (): GameState => withRobots(BASE, [robotOf({ stats: STATS })]);
  const statsJson = (save: SaveJson) => firstRobot(save).stats as { today: SaveJson; week: SaveJson };

  it("round-trips today's and this week's counters", () => {
    const state = counted();
    expect(deserializeGame(serializeGame(state))).toEqual(loadedFrom(state));
  });

  it("turns a v5 robot's tokensToday into today's and this week's tokens", () => {
    const state = withRobots(BASE, [robotOf({ stats: { today: { tokens: 12, actions: 0, crops: 0 }, week: { tokens: 12, actions: 0, crops: 0 } } })]);
    const save = v5Save(state);
    expect(firstRobot(save).tokensToday).toBe(12);
    expect(firstRobot(save)).not.toHaveProperty('stats');
    expect(must(deserializeGame(JSON.stringify(save)))).toEqual(state);
  });

  it('cannot write counters a v5 save has no room for', () => {
    expect(() => v5Save(counted())).toThrow('v5Save');
  });

  const rejections: readonly [string, (save: SaveJson) => void][] = [
    ['a negative count', (s) => void (statsJson(s).today.tokens = -1)],
    ['a fractional count', (s) => void (statsJson(s).week.actions = 1.5)],
    ['more tokens today than this week', (s) => void (statsJson(s).today.tokens = 41)],
    ['more actions today than this week', (s) => void (statsJson(s).today.actions = 10)],
    ['more crops today than this week', (s) => void (statsJson(s).today.crops = 4)],
    ['a missing counter', (s) => void delete statsJson(s).week.crops],
    ['an unknown counter', (s) => void (statsJson(s).today.coins = 1)],
    ['stats without a week', (s) => void delete (firstRobot(s).stats as SaveJson).week],
    ['a leftover tokensToday', (s) => void (firstRobot(s).tokensToday = 5)],
  ];

  it.each(rejections)('rejects %s', (_label, edit) => {
    expect(corrupt(counted(), edit)).toBeNull();
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run tests/robotLog.test.ts tests/robotStats.test.ts tests/robotSaveV6.test.ts`
Expected: FAIL, 14 failed / 30 passed:
- `robotLog.test.ts` 1 failed: "starts a new entry for the same event on a new day…" with `AssertionError: expected [ [ 3, 1500, 'flat', 3 ] ] to deeply equal [ [ 3, 1500, 'flat', 1 ], …(1) ]`.
- `robotStats.test.ts` 10 failed: `TypeError: addRobotStats is not a function`, `expected undefined to be 7` (`ROBOTS.weekLength`), `expected undefined to deeply equal { today: … }` for the counting tests, and the rollover tests still seeing today's 12 tokens.
- `robotSaveV6.test.ts` 3 failed: the stats round trip (`expected null to deeply equal { version: 6, … }`), "turns a v5 robot's tokensToday…" (`expected +0 to be 12`) and "cannot write counters…" (`expected [Function] to throw an error`). The rejections already pass: today a `stats` key is an unknown robot key.

- [ ] **Step 3: Types and config**

In `src/core/types.ts`, insert directly above `export interface Robot {`:

```ts
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

```

and in `interface Robot`, replace:

```ts
  /** Tokens spent today; reset each morning. */
  readonly tokensToday: number;
```

with:

```ts
  /** What it did today and this week (farmclaws part 3 spec §6.1). */
  readonly stats: RobotStats;
```

In `src/config.ts`, at the end of `ROBOTS`, replace:

```ts
  /** `Repeat [n] times` clamps n to 0 … this at run time. */
  maxRepeatTimes: 999,
} as const;
```

with:

```ts
  /** `Repeat [n] times` clamps n to 0 … this at run time. */
  maxRepeatTimes: 999,
  /** Days in a robot stats week; weeks start on day 1 of the season (part 3 §6.1). */
  weekLength: 7,
} as const;
```

- [ ] **Step 4: The stats helpers in `src/robots/stats.ts`**

Replace:

```ts
import type { Robot, RobotActionKind, RobotPartId, RobotPower, RobotSize } from '../core/types';
```

with:

```ts
import type { Robot, RobotActionKind, RobotPartId, RobotPower, RobotSize, RobotStatCounts, RobotStats } from '../core/types';
```

and append at the end of the file:

```ts

const ZERO_COUNTS: RobotStatCounts = { tokens: 0, actions: 0, crops: 0 };

/** A robot's stats before it has done anything (farmclaws part 3 spec §6.1). */
export const ZERO_ROBOT_STATS: RobotStats = { today: ZERO_COUNTS, week: ZERO_COUNTS };

function addCounts(counts: RobotStatCounts, add: Partial<RobotStatCounts>): RobotStatCounts {
  return { tokens: counts.tokens + (add.tokens ?? 0), actions: counts.actions + (add.actions ?? 0), crops: counts.crops + (add.crops ?? 0) };
}

/** `stats` with `add` counted today and this week; `stats` itself when every addend is 0 or missing. */
export function addRobotStats(stats: RobotStats, add: Partial<RobotStatCounts>): RobotStats {
  if ((add.tokens ?? 0) === 0 && (add.actions ?? 0) === 0 && (add.crops ?? 0) === 0) return stats;
  return { today: addCounts(stats.today, add), week: addCounts(stats.week, add) };
}

/** Whether a day of the season starts a stats week: days 1, 8, 15 and 22. */
export function isWeekStart(dayOfSeason: number): boolean {
  return (dayOfSeason - 1) % ROBOTS.weekLength === 0;
}
```

- [ ] **Step 5: Counting in `src/robots/execute.ts`**

In the `../core/types` import, replace:

```ts
  type RobotLogEvent,
  type TileCoord,
} from '../core/types';
```

with:

```ts
  type RobotLogEvent,
  type RobotStatCounts,
  type TileCoord,
} from '../core/types';
```

Replace:

```ts
import { actionCost, bagStacks, periodFor } from './stats';
```

with:

```ts
import { actionCost, addRobotStats, bagStacks, periodFor } from './stats';
```

Replace `pay`:

```ts
function pay(state: GameState, robotId: number, cost: number): { readonly state: GameState; readonly robot: Robot } {
  const before = requireRobot(state, robotId);
  invariant(before.tokens >= cost, `robot ${robotId} can't afford ${cost} tokens`);
  const robot = { ...before, tokens: before.tokens - cost, tokensToday: before.tokensToday + cost };
  return { state: withRobot(state, robot), robot };
}
```

with:

```ts
/**
 * Takes `cost` tokens from the robot and counts them in its stats, with `counts` (part 3 spec
 * §6.1). Paying nothing and counting nothing leaves the state unchanged.
 */
function pay(state: GameState, robotId: number, cost: number, counts: Partial<RobotStatCounts> = {}): { readonly state: GameState; readonly robot: Robot } {
  const before = requireRobot(state, robotId);
  invariant(before.tokens >= cost, `robot ${robotId} can't afford ${cost} tokens`);
  const robot = { ...before, tokens: before.tokens - cost, stats: addRobotStats(before.stats, { ...counts, tokens: cost }) };
  return { state: withRobot(state, robot), robot };
}

/** What a resolved action counts besides its tokens: the action, and a crop for a harvest or planting that worked. */
function actionCounts(action: RobotAction, success: boolean): Partial<RobotStatCounts> {
  return { actions: 1, crops: success && (action.kind === 'harvest' || action.kind === 'plant') ? 1 : 0 };
}
```

In `applyRobotPlan`, replace:

```ts
  const paid = pay(state, robotId, plan.cost);
  if (!plan.ok) {
```

with:

```ts
  const paid = pay(state, robotId, plan.cost, actionCounts(plan.action, plan.ok));
  if (!plan.ok) {
```

In `applyBickerPlan`, replace:

```ts
  const paid = pay(state, robotId, plan.cost);
  const logged = logRobotEvent(paid.state, robotId, { kind: 'bickered', action: plan.action.kind, withIds });
```

with:

```ts
  const paid = pay(state, robotId, plan.cost, actionCounts(plan.action, false));
  const logged = logRobotEvent(paid.state, robotId, { kind: 'bickered', action: plan.action.kind, withIds });
```

`chargeWake` keeps calling `pay(state, robotId, cost)`: a wake counts its tokens and no action. A skip (`applyTurn`'s `skip` case) never calls `pay` beyond `chargeWake`, so it adds nothing.

- [ ] **Step 6: The log merges within a day (`src/robots/log.ts`)**

Replace:

```ts
/**
 * Appends an event for `robotId` at the current day, minute and the robot's tile. If the most
 * recent entry of that robot has an equal event, its count goes up instead.
 */
```

with:

```ts
/**
 * Appends an event for `robotId` at the current day, minute and the robot's tile. If the most
 * recent entry of that robot is from today and has an equal event, its count goes up instead
 * (farmclaws part 3 spec §6.2).
 */
```

and replace:

```ts
    if (!sameEvent(entry.event, event)) break;
```

with:

```ts
    if (entry.day !== state.time.absoluteDay || !sameEvent(entry.event, event)) break;
```

- [ ] **Step 7: The morning rollover (`src/robots/overnight.ts`)**

Replace:

```ts
import { Blocker, Direction, type GameState, type MessageTone, type Robot, type RobotExec, type TileCoord } from '../core/types';
```

with:

```ts
import {
  Blocker,
  Direction,
  type GameState,
  type MessageTone,
  type Robot,
  type RobotExec,
  type RobotStatCounts,
  type RobotStats,
  type TileCoord,
} from '../core/types';
```

Replace:

```ts
import { batteryFor, periodFor, resumedPower } from './stats';
```

with:

```ts
import { ZERO_ROBOT_STATS, batteryFor, isWeekStart, periodFor, resumedPower } from './stats';
```

Insert directly above the doc comment of `resetForMorning` (`/**\n * Every robot not at repairs stays where it is, …`):

```ts
const isZero = (counts: RobotStatCounts): boolean => counts.tokens === 0 && counts.actions === 0 && counts.crops === 0;

/**
 * The morning's stats (part 3 spec §6.1): today starts again from 0, and so does the week on the
 * first day of a week. `stats` itself when there is nothing to reset.
 */
function morningStats(stats: RobotStats, weekStart: boolean): RobotStats {
  const today = isZero(stats.today) ? stats.today : ZERO_ROBOT_STATS.today;
  const week = !weekStart || isZero(stats.week) ? stats.week : ZERO_ROBOT_STATS.week;
  return today === stats.today && week === stats.week ? stats : { today, week };
}

```

In `resetForMorning`, replace:

```ts
  let next = state;
  const farm = state.maps.farm;
  for (const robot of state.robots.list) {
```

with:

```ts
  let next = state;
  const farm = state.maps.farm;
  const weekStart = isWeekStart(state.time.dayOfSeason);
  for (const robot of state.robots.list) {
```

and replace:

```ts
      tokensToday: 0,
```

with:

```ts
      stats: morningStats(robot.stats, weekStart),
```

(`runRobotsOvernight` runs inside `startNextDay` after `time` is the new day, so `dayOfSeason` is the morning's. A robot away at repairs is skipped here as before; it comes back through `returnRepaired` the next morning, before this reset, and is reset then.)

- [ ] **Step 8: New robots, validation and the migration**

In `src/robots/create.ts`, replace:

```ts
import { batteryFor, hasPart, periodFor } from './stats';
```

with:

```ts
import { ZERO_ROBOT_STATS, batteryFor, hasPart, periodFor } from './stats';
```

and in the robot literal of `addRobot`, replace:

```ts
    tokensToday: 0,
```

with:

```ts
    stats: ZERO_ROBOT_STATS,
```

In `src/state/robotValidation.ts`, in the `../core/types` import replace:

```ts
  type RobotProgram,
  type TileCoord,
```

with:

```ts
  type RobotProgram,
  type RobotStatCounts,
  type TileCoord,
```

In `ROBOT_KEYS`, replace:

```ts
  'exec', 'md', 'off', 'nextActMinute', 'repairReadyDay', 'tokensToday', 'moveSeq', 'teleportSeq', 'actionSeq', 'lastAction',
```

with:

```ts
  'exec', 'md', 'off', 'nextActMinute', 'repairReadyDay', 'stats', 'moveSeq', 'teleportSeq', 'actionSeq', 'lastAction',
```

Insert directly above `function isValidRobot(v: unknown, farm: WorldState): boolean {`:

```ts
function isValidStatCounts(v: unknown): v is RobotStatCounts {
  return isObj(v) && hasExactKeys(v, ['tokens', 'actions', 'crops']) && isCount(v.tokens) && isCount(v.actions) && isCount(v.crops);
}

/** Today's and this week's counters: non-negative integers, today's never above the week's (part 3 spec §9.2). */
function isValidRobotStats(v: unknown): boolean {
  if (!isObj(v) || !hasExactKeys(v, ['today', 'week'])) return false;
  const today: unknown = v.today;
  const week: unknown = v.week;
  if (!isValidStatCounts(today) || !isValidStatCounts(week)) return false;
  return today.tokens <= week.tokens && today.actions <= week.actions && today.crops <= week.crops;
}

```

and in `isValidRobot`, replace:

```ts
  if (!isIntIn(v.tokens, 0, batteryFor(v.size)) || !isCount(v.tokensToday)) return false;
```

with:

```ts
  if (!isIntIn(v.tokens, 0, batteryFor(v.size)) || !isValidRobotStats(v.stats)) return false;
```

In `src/state/persistence.ts`, replace Task 1's:

```ts
/** Version 5 predates the robot screen (farmclaws part 3 spec §9.1). */
function migrateV5toV6(save: Obj): Obj {
  return { ...save, version: 6 };
}
```

with:

```ts
/** A v5 robot as a v6 one: `tokensToday` becomes today's and this week's tokens, with no actions or crops counted. */
function migrateRobotV5(robot: unknown): unknown {
  if (!isObj(robot)) return robot;
  const { tokensToday, ...rest } = robot;
  return { ...rest, stats: { today: { tokens: tokensToday, actions: 0, crops: 0 }, week: { tokens: tokensToday, actions: 0, crops: 0 } } };
}

/** Version 5 predates the robot screen (farmclaws part 3 spec §9.1): robots gain stats in place of tokensToday. */
function migrateV5toV6(save: Obj): Obj {
  const robots = save.robots;
  if (!isObj(robots) || !Array.isArray(robots.list)) return save;
  const list = (robots.list as readonly unknown[]).map(migrateRobotV5);
  return { ...save, version: 6, robots: { ...robots, list } };
}
```

(A malformed robots section stays at version 5, which the validator rejects, as `migrateV4toV5` does. A missing or bad `tokensToday` becomes a bad `stats.today.tokens`, which the validator also rejects.)

- [ ] **Step 9: Test helpers and the existing tests' `tokensToday`**

In `tests/testUtils.ts`:
- In the `../src/core/types` import, after `type MapId,` add `type RobotStats,`.
- After `import { createCropInstance, CROPS, stageCount } from '../src/farming/crops';` add `import { ZERO_ROBOT_STATS } from '../src/robots/stats';`.
- In `robotOf`, replace `    tokensToday: 0,` with `    stats: ZERO_ROBOT_STATS,`.
- In `v5Save`, replace:
  ```ts
    const save = JSON.parse(serializeGame(state)) as SaveJson;
    save.version = 5;
    return save;
  ```
  with:
  ```ts
    const save = JSON.parse(serializeGame(state)) as SaveJson;
    save.version = 5;
    // Stats: a v5 robot counts only today's tokens, as tokensToday.
    for (const robot of (save.robots as { list: SaveJson[] }).list) {
      const { today, week } = robot.stats as RobotStats;
      if (today.actions !== 0 || today.crops !== 0 || !deepEqual(week, today)) {
        throw new Error(`v5Save: a version-5 save counts only today's tokens (robot ${String(robot.id)})`);
      }
      robot.tokensToday = today.tokens;
      delete robot.stats;
    }
    return save;
  ```

Every other use of `tokensToday` (from `grep -rn tokensToday src tests`, nothing else changes in these files):
- `tests/robotRun.test.ts` line 62: replace
  ```ts
        expect(robot).toMatchObject({ pc: 1, actionSeq: 1, tokens: 77, tokensToday: 3, bag: [], nextActMinute: TIME.dayStartMinute + 8 });
  ```
  with
  ```ts
        expect(robot).toMatchObject({ pc: 1, actionSeq: 1, tokens: 77, bag: [], nextActMinute: TIME.dayStartMinute + 8 });
        expect(robot.stats.today).toEqual({ tokens: 3, actions: 1, crops: 0 });
  ```
- `tests/robotOvernight.test.ts` lines 71–73: replace
  ```ts
      const robot = robotOf({ tx: 12, tz: 14, facing: Direction.East, pc: 0, tokensToday: 40, power: 'standby', program: { kind: 'script', steps: [{ kind: 'turn', side: 'left' }, { kind: 'move' }], loop: false } });
      const next = sleep(withRobots(BASE, [{ ...robot, pc: 1 }]));
      expect(requireRobot(next, 1)).toMatchObject({ tx: 12, tz: 14, facing: Direction.East, pc: 0, tokensToday: 0, power: 'working', nextActMinute: TIME.dayStartMinute + 4 });
  ```
  with
  ```ts
      const week = { tokens: 90, actions: 30, crops: 4 };
      const stats = { today: { tokens: 40, actions: 12, crops: 2 }, week };
      const robot = robotOf({ tx: 12, tz: 14, facing: Direction.East, pc: 0, stats, power: 'standby', program: { kind: 'script', steps: [{ kind: 'turn', side: 'left' }, { kind: 'move' }], loop: false } });
      const next = sleep(withRobots(BASE, [{ ...robot, pc: 1 }]));
      expect(requireRobot(next, 1)).toMatchObject({ tx: 12, tz: 14, facing: Direction.East, pc: 0, power: 'working', nextActMinute: TIME.dayStartMinute + 4 });
      expect(requireRobot(next, 1).stats).toEqual({ today: { tokens: 0, actions: 0, crops: 0 }, week });
  ```
  (BASE is day 1 of the season, so the next morning is day 2: today resets, the week doesn't.)
- `tests/robotTriggers.test.ts` line 65: replace
  ```ts
      expect(requireRobot(next, 1)).toMatchObject({ power: 'working', tokens: 78, tokensToday: 2, actionSeq: 1 });
  ```
  with
  ```ts
      expect(requireRobot(next, 1)).toMatchObject({ power: 'working', tokens: 78, actionSeq: 1 });
      expect(requireRobot(next, 1).stats.today).toEqual({ tokens: 2, actions: 1, crops: 0 });
  ```
  and line 73 (now 74): replace
  ```ts
      expect(requireRobot(next, 1)).toMatchObject({ power: 'standby', tokens: 74, tokensToday: 6, nextActMinute: 424 });
  ```
  with
  ```ts
      expect(requireRobot(next, 1)).toMatchObject({ power: 'standby', tokens: 74, nextActMinute: 424 });
      expect(requireRobot(next, 1).stats.today).toEqual({ tokens: 6, actions: 3, crops: 0 });
  ```
- `tests/robotMd.test.ts` line 50: replace
  ```ts
      expect(after).toMatchObject({ tx: 5, tz: 12, tokens: 80, tokensToday: 0, actionSeq: 1, nextActMinute: 368, power: 'working' });
  ```
  with
  ```ts
      expect(after).toMatchObject({ tx: 5, tz: 12, tokens: 80, actionSeq: 1, nextActMinute: 368, power: 'working' });
      expect(after.stats.today).toEqual({ tokens: 0, actions: 0, crops: 0 });
  ```
- `tests/robotSave.test.ts` line 111: replace
  ```ts
      ['a negative tokensToday', (s) => void (robotsOf(s).list[0]!.tokensToday = -1)],
  ```
  with
  ```ts
      ['a negative stats count', (s) => void (((robotsOf(s).list[0]!.stats as SaveJson).today as SaveJson).tokens = -1)],
  ```

`grep -rn tokensToday src tests` now finds only `src/state/persistence.ts` (the migration) and `tests/testUtils.ts` (`v5Save`), plus `tests/robotSaveV6.test.ts`.

- [ ] **Step 10: Run them and see them pass**

Run: `npx vitest run tests/robotLog.test.ts tests/robotStats.test.ts tests/robotSaveV6.test.ts tests/robotRun.test.ts tests/robotOvernight.test.ts tests/robotTriggers.test.ts tests/robotMd.test.ts tests/robotSave.test.ts tests/robotSaveV5.test.ts tests/robotHelpers.test.ts`
Expected: PASS (`robotLog.test.ts`: 2, `robotStats.test.ts`: 24, `robotSaveV6.test.ts`: 18).

- [ ] **Step 11: The full gate**

Run: `npm run typecheck && npm test && npm run build`
Expected: all green (58 test files). No existing test depended on a merge across days.

- [ ] **Step 12: Commit**

```bash
git add src/core/types.ts src/config.ts src/robots/stats.ts src/robots/execute.ts src/robots/log.ts src/robots/overnight.ts src/robots/create.ts src/state/robotValidation.ts src/state/persistence.ts tests/testUtils.ts tests/robotLog.test.ts tests/robotStats.test.ts tests/robotSaveV6.test.ts tests/robotRun.test.ts tests/robotOvernight.test.ts tests/robotTriggers.test.ts tests/robotMd.test.ts tests/robotSave.test.ts
git commit -m "Farmclaws part 3: robot stats today and this week, log merges within a day

Robot.stats replaces tokensToday: pay counts every token (actions, bickers, wakes),
applyRobotPlan and applyBickerPlan count the action and a crop for a harvest or
planting that worked; skips count nothing. The morning reset zeroes today, and the
week on days 1, 8, 15 and 22 (ROBOTS.weekLength, plan R6). migrateV5toV6 turns
tokensToday into both periods' tokens. logRobotEvent merges only into today's entry.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Unlocks

**Files:**
- Create: `src/robots/blockKinds.ts`
- Create: `src/robots/unlocks.ts`
- Modify: `src/core/types.ts` (a type import above `SAVE_VERSION`, line 13; `RobotsState`, after `zones` ~line 683; new block after the closing `};` of `MdCard`, ~line 876)
- Modify: `src/config.ts` (type import, line 5; new `UNLOCKS` directly above `GENERATORS`, ~line 303)
- Modify: `src/state/initialState.ts` (config import, line 1; `robots` in `createDefaultSections`, line 46)
- Modify: `src/state/robotValidation.ts` (imports, lines 6–34; new `isValidUnlocks` after `isValidZones`, ~line 468; first two lines of `isValidRobotsSection`, ~line 621)
- Modify: `src/state/persistence.ts` (config import, line 5; Task 3's `migrateV5toV6`)
- Modify: `src/dev/robotDev.ts` (imports; `RobotDevHandle`; the `hooks` object at the end of `installRobotDev`)
- Modify: `tests/testUtils.ts` (config import, line 12; Task 3's `v5Save`)
- Modify: `tests/sections.test.ts` (config import, line 6; `expected.robots`, ~line 172)
- Modify: `tests/robotSaveV6.test.ts` (imports; one new `describe` at the end)
- Test: `tests/unlocks.test.ts` (create)

**Interfaces:**
- Consumes: Task 1's `migrateV5toV6` and `v5Save`; Task 3's `migrateV5toV6` body (`robots: { ...robots, list }`) and `v5Save` body (its stats loop); `tests/robotSaveV6.test.ts`'s `loadedFrom`, `robotsOf` (Tasks 1 and 3). Part 1–2: `isCanonicalSubset`, `hasExactKeys`, `installRobotDev`, `actions.load`, `createStore`, `b`, `checkProgram`, `morningExec`.
- Produces:
  - `src/robots/blockKinds.ts`: `export const BLOCK_KINDS` (53 kinds, as const, in the contract's order); `export type BlockKind = (typeof BLOCK_KINDS)[number]`; `export type BlockCategory = 'triggers' | 'control' | 'actions' | 'sensors' | 'values'`; `export const BLOCK_CATEGORY: Readonly<Record<BlockKind, BlockCategory>>`.
  - `src/core/types.ts`: `export const MD_CARD_KINDS = ['dontLeave', 'dontGoIntoWater', 'dontHarvest', 'dontDeposit', 'doReturn', 'doPowerDown'] as const`; `export const ROBOT_TABS = ['program', 'md', 'looks', 'stats', 'log'] as const`; `export type RobotTab = (typeof ROBOT_TABS)[number]`; `export interface RobotUnlocks { readonly blocks: readonly BlockKind[]; readonly cards: readonly MdCard['kind'][]; readonly tabs: readonly RobotTab[] }`; `RobotsState.unlocks: RobotUnlocks`.
  - `src/config.ts`: `UNLOCKS.job1` (spec §7's set in canonical order), `satisfies { readonly job1: RobotUnlocks }`.
  - `src/robots/unlocks.ts`: `export const ALL_UNLOCKS: RobotUnlocks`; `export function withUnlocks(state: GameState, add: Partial<RobotUnlocks>): GameState` (union in canonical order; the same state when nothing is new).
  - Dev hook `unlockAll(): string` → "Unlocked every block, card and tab.".
  - Save: `createDefaultSections().robots.unlocks` is `UNLOCKS.job1`; `migrateV5toV6` writes `unlocks: UNLOCKS.job1`; `isValidRobotsSection` requires `unlocks` (exact keys, each list a canonical subset of `BLOCK_KINDS` / `MD_CARD_KINDS` / `ROBOT_TABS`).
  - `tests/testUtils.ts`: `v5Save` drops `robots.unlocks`, and throws when they aren't exactly `UNLOCKS.job1` (a v5 save can't hold more).

- [ ] **Step 1: Write the failing test** — create `tests/unlocks.test.ts`

```ts
/**
 * Unlocks (farmclaws part 3 spec §7): the block kinds and their categories, the card kinds and
 * tabs, job 1's starting set, withUnlocks, the save rules and the `unlockAll` dev hook. Unlocks
 * gate the editor only, so a program using locked kinds still runs.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UNLOCKS } from '../src/config';
import { createStore } from '../src/core/store';
import {
  MD_CARD_KINDS,
  ROBOT_TABS,
  type ActionBlock,
  type Expr,
  type GameState,
  type MdCard,
  type Statement,
  type Trigger,
} from '../src/core/types';
import { installRobotDev } from '../src/dev/robotDev';
import { BLOCK_CATEGORY, BLOCK_KINDS, type BlockCategory } from '../src/robots/blockKinds';
import { b } from '../src/robots/blocks';
import { checkProgram } from '../src/robots/check';
import { morningExec } from '../src/robots/exec';
import { ALL_UNLOCKS, withUnlocks } from '../src/robots/unlocks';
import { requireRobot } from '../src/robots/world';
import { actions } from '../src/state/actions';
import { createDefaultSections, createInitialState } from '../src/state/initialState';
import { deserializeGame, serializeGame } from '../src/state/persistence';
import { gameReducer } from '../src/state/reducer';
import { EMPTY_TILE } from '../src/world/tiles';
import { BASE, emptyHanded, robotOf, scenario, withRobots, type SaveJson } from './testUtils';

/** One key per kind of each part of the language; `satisfies` makes each list exact. */
const STATEMENT_KINDS = {
  repeatTimes: true,
  repeatUntil: true,
  repeatForever: true,
  if: true,
  forEachTile: true,
  goTo: true,
  set: true,
  change: true,
  runHelper: true,
} as const satisfies Record<Exclude<Statement['kind'], 'do'>, true>;
const ACTION_KINDS = {
  move: true,
  turn: true,
  water: true,
  harvest: true,
  till: true,
  plant: true,
  refill: true,
  deposit: true,
  take: true,
  say: true,
  wait: true,
  powerDown: true,
} as const satisfies Record<ActionBlock['kind'], true>;
const TRIGGER_KINDS = { morning: true, atTime: true, bagFull: true, startsRaining: true, every: true } as const satisfies Record<Trigger['kind'], true>;
const EXPR_KINDS = {
  num: true,
  text: true,
  yes: true,
  item: true,
  tile: true,
  var: true,
  myTile: true,
  tileAhead: true,
  tokensLeft: true,
  countInBag: true,
  arith: true,
  compare: true,
  and: true,
  or: true,
  not: true,
  cropIsReady: true,
  soilIsDry: true,
  tileIsTilled: true,
  cropIs: true,
  bagIsFull: true,
  bagHas: true,
  atEdgeOf: true,
  tokensBelow: true,
  tileAheadIs: true,
  itIsRaining: true,
  timeIsAfter: true,
} as const satisfies Record<Expr['kind'], true>;
const CARD_KINDS = {
  dontLeave: true,
  dontGoIntoWater: true,
  dontHarvest: true,
  dontDeposit: true,
  doReturn: true,
  doPowerDown: true,
} as const satisfies Record<MdCard['kind'], true>;

const JOB1_BLOCKS = [
  'morning', 'atTime', 'repeatTimes', 'repeatUntil', 'repeatForever', 'move', 'turn', 'goTo', 'water', 'refill', 'powerDown',
  'wait', 'say', 'num', 'text', 'yes', 'item', 'tile', 'myTile', 'tileAhead', 'tokensLeft', 'compare',
];

const loadedFrom = (state: GameState): GameState => ({ ...state, ui: { ...state.ui, panel: { kind: 'none' }, paused: false } });

/** Serialises `state`, lets `edit` change the saved unlocks (or the robots section), and loads it again. */
function corruptUnlocks(state: GameState, edit: (unlocks: SaveJson, robots: SaveJson) => void): GameState | null {
  const save = JSON.parse(serializeGame(state)) as SaveJson;
  const robots = save.robots as SaveJson;
  edit(robots.unlocks as SaveJson, robots);
  return deserializeGame(JSON.stringify(save));
}

describe('block kinds', () => {
  it('names every kind of the language exactly once, plus Define helper', () => {
    const parts = [STATEMENT_KINDS, ACTION_KINDS, TRIGGER_KINDS, EXPR_KINDS].map((kinds) => Object.keys(kinds));
    const all = parts.flat();
    // No kind is shared between statements, action blocks, triggers and expressions.
    expect(new Set(all).size).toBe(all.length);
    expect([...all, 'helper'].sort()).toEqual([...BLOCK_KINDS].sort());
    expect(new Set(BLOCK_KINDS).size).toBe(BLOCK_KINDS.length);
    expect(BLOCK_KINDS).toHaveLength(53);
  });

  it('groups the kinds by toolbox category, in category order', () => {
    const runs: [BlockCategory, number][] = [];
    for (const kind of BLOCK_KINDS) {
      const category = BLOCK_CATEGORY[kind];
      const last = runs[runs.length - 1];
      if (last !== undefined && last[0] === category) last[1]++;
      else runs.push([category, 1]);
    }
    expect(runs).toEqual([
      ['triggers', 5],
      ['control', 10],
      ['actions', 13],
      ['sensors', 11],
      ['values', 14],
    ]);
    expect([BLOCK_CATEGORY.var, BLOCK_CATEGORY.helper, BLOCK_CATEGORY.goTo, BLOCK_CATEGORY.tileAheadIs]).toEqual(['control', 'control', 'actions', 'sensors']);
  });

  it('lists the .MD card kinds and the robot screen tabs', () => {
    expect([...MD_CARD_KINDS].sort()).toEqual(Object.keys(CARD_KINDS).sort());
    expect(MD_CARD_KINDS).toEqual(['dontLeave', 'dontGoIntoWater', 'dontHarvest', 'dontDeposit', 'doReturn', 'doPowerDown']);
    expect(ROBOT_TABS).toEqual(['program', 'md', 'looks', 'stats', 'log']);
  });
});

describe("job 1's set", () => {
  it('is what a new farm starts with', () => {
    expect(UNLOCKS.job1).toEqual({ blocks: JOB1_BLOCKS, cards: ['dontLeave', 'dontGoIntoWater'], tabs: ['program', 'md', 'looks', 'log'] });
    expect(createDefaultSections().robots.unlocks).toEqual(UNLOCKS.job1);
    expect(BASE.robots.unlocks).toEqual(UNLOCKS.job1);
  });

  it('is in canonical order', () => {
    const { blocks, cards, tabs } = UNLOCKS.job1;
    expect(blocks).toEqual(BLOCK_KINDS.filter((kind) => (blocks as readonly string[]).includes(kind)));
    expect(cards).toEqual(MD_CARD_KINDS.filter((kind) => (cards as readonly string[]).includes(kind)));
    expect(tabs).toEqual(ROBOT_TABS.filter((tab) => (tabs as readonly string[]).includes(tab)));
  });
});

describe('withUnlocks', () => {
  it('adds kinds in canonical order and keeps the lists it does not touch', () => {
    const next = withUnlocks(BASE, { blocks: ['harvest', 'bagFull'], tabs: ['stats'] });
    expect(next.robots.unlocks.blocks).toEqual(BLOCK_KINDS.filter((kind) => JOB1_BLOCKS.includes(kind) || kind === 'harvest' || kind === 'bagFull'));
    expect(next.robots.unlocks.blocks.slice(0, 3)).toEqual(['morning', 'atTime', 'bagFull']);
    expect(next.robots.unlocks.tabs).toEqual(['program', 'md', 'looks', 'stats', 'log']);
    expect(next.robots.unlocks.cards).toBe(BASE.robots.unlocks.cards);
  });

  it('returns the same state when nothing is new', () => {
    expect(withUnlocks(BASE, {})).toBe(BASE);
    expect(withUnlocks(BASE, { blocks: ['move', 'say'], cards: ['dontLeave'], tabs: [] })).toBe(BASE);
    const all = withUnlocks(BASE, ALL_UNLOCKS);
    expect(withUnlocks(all, { blocks: ['harvest'] })).toBe(all);
  });

  it('unlocks everything with ALL_UNLOCKS', () => {
    expect(withUnlocks(BASE, ALL_UNLOCKS).robots.unlocks).toEqual({ blocks: [...BLOCK_KINDS], cards: [...MD_CARD_KINDS], tabs: [...ROBOT_TABS] });
  });
});

describe('unlocks in the save', () => {
  it('round-trips job 1 and the full set', () => {
    for (const state of [BASE, withUnlocks(BASE, ALL_UNLOCKS), withUnlocks(BASE, { cards: ['doReturn'], tabs: ['stats'] })]) {
      expect(deserializeGame(serializeGame(state))).toEqual(loadedFrom(state));
    }
  });

  const rejections: readonly [string, (unlocks: SaveJson, robots: SaveJson) => void][] = [
    ['blocks out of canonical order', (u) => void (u.blocks = ['atTime', 'morning'])],
    ['a repeated block', (u) => void (u.blocks = ['morning', 'morning'])],
    ['an unknown block', (u) => void (u.blocks = ['morning', 'dance'])],
    ['the do statement as a block', (u) => void (u.blocks = ['do'])],
    ['an unknown card', (u) => void (u.cards = ['dontDance'])],
    ['cards out of canonical order', (u) => void (u.cards = ['dontGoIntoWater', 'dontLeave'])],
    ['an unknown tab', (u) => void (u.tabs = ['program', 'shop'])],
    ['tabs out of canonical order', (u) => void (u.tabs = ['md', 'program'])],
    ['a missing list', (u) => void delete u.tabs],
    ['an extra key', (u) => void (u.parts = [])],
    ['a list that is not a list', (u) => void (u.cards = 'dontLeave')],
    ['no unlocks at all', (_u, robots) => void delete robots.unlocks],
  ];

  it.each(rejections)('rejects %s', (_label, edit) => {
    expect(corruptUnlocks(BASE, edit)).toBeNull();
  });
});

describe('locked kinds', () => {
  it('still run: unlocks gate the editor, not the simulation', () => {
    const program = b.program({ stacks: [b.when(b.every(5), b.if(b.cropIsReady(), [b.harvest()], [b.turn('right')]))] });
    for (const kind of ['every', 'if', 'cropIsReady', 'harvest'] as const) expect(BASE.robots.unlocks.blocks).not.toContain(kind);
    const robot = robotOf({ program, exec: morningExec(program), power: 'standby' });
    expect(checkProgram(program, robot)).toBeNull();
    const next = gameReducer(withRobots(emptyHanded(scenario(EMPTY_TILE)), [robot]), actions.tick(20));
    expect(requireRobot(next, 1).lastAction).toMatchObject({ kind: 'turn', success: true });
  });
});

describe('the unlockAll dev hook', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('unlocks every block, card and tab', () => {
    const handle: Record<string, unknown> = {};
    vi.stubGlobal('window', { __meadowlight: handle });
    const store = createStore(gameReducer, createInitialState());
    installRobotDev(store);
    const unlockAll = handle.unlockAll as () => string;
    expect(unlockAll()).toBe('Unlocked every block, card and tab.');
    expect(store.getState().robots.unlocks).toEqual(ALL_UNLOCKS);
  });
});
```

Also extend `tests/robotSaveV6.test.ts` (as Tasks 1 and 3 left it). Directly after its `import { describe, expect, it } from 'vitest';` line add:

```ts
import { UNLOCKS } from '../src/config';
```

directly after its `import { freshExec } from '../src/robots/exec';` line add:

```ts
import { ALL_UNLOCKS, withUnlocks } from '../src/robots/unlocks';
```

and append at the end of the file:

```ts

describe('unlocks in save version 6', () => {
  it("gives a v5 save job 1's unlocks", () => {
    const save = v5Save(BASE);
    expect(robotsOf(save)).not.toHaveProperty('unlocks');
    expect(robotsOf(migrateSave(save) as SaveJson).unlocks).toEqual(UNLOCKS.job1);
    expect(must(deserializeGame(JSON.stringify(save)))).toEqual(BASE);
  });

  it('round-trips every unlock', () => {
    const state = withUnlocks(BASE, ALL_UNLOCKS);
    expect(deserializeGame(serializeGame(state))).toEqual(loadedFrom(state));
  });

  it('cannot write unlocks beyond job 1 to a v5 save', () => {
    expect(() => v5Save(withUnlocks(BASE, { tabs: ['stats'] }))).toThrow('v5Save');
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run tests/unlocks.test.ts tests/robotSaveV6.test.ts`
Expected: FAIL — `unlocks.test.ts` with `Failed to resolve import "../src/robots/blockKinds"`, and `robotSaveV6.test.ts` with `Failed to resolve import "../src/robots/unlocks"`.

- [ ] **Step 3: Create `src/robots/blockKinds.ts`**

```ts
/**
 * Every block of the robot language by its language `kind` (farmclaws part 3 spec §7): the
 * triggers, the statements except `do` (each action block is its own block), the action blocks
 * and the expressions, plus `helper` (Define helper). `var` is the variable getter and also gates
 * "Make a variable"; `if` covers both If and If … else. Unlocks list kinds in this order. Pure data.
 */

export const BLOCK_KINDS = [
  // triggers
  'morning',
  'atTime',
  'bagFull',
  'startsRaining',
  'every',
  // control
  'repeatTimes',
  'repeatUntil',
  'repeatForever',
  'if',
  'forEachTile',
  'set',
  'change',
  'var',
  'helper',
  'runHelper',
  // actions
  'move',
  'turn',
  'goTo',
  'water',
  'refill',
  'harvest',
  'deposit',
  'take',
  'till',
  'plant',
  'powerDown',
  'wait',
  'say',
  // sensors
  'cropIsReady',
  'soilIsDry',
  'tileIsTilled',
  'cropIs',
  'bagIsFull',
  'bagHas',
  'atEdgeOf',
  'tokensBelow',
  'tileAheadIs',
  'itIsRaining',
  'timeIsAfter',
  // values
  'num',
  'text',
  'yes',
  'item',
  'tile',
  'myTile',
  'tileAhead',
  'tokensLeft',
  'countInBag',
  'arith',
  'compare',
  'and',
  'or',
  'not',
] as const;
export type BlockKind = (typeof BLOCK_KINDS)[number];

export type BlockCategory = 'triggers' | 'control' | 'actions' | 'sensors' | 'values';

/**
 * Each kind's category; BLOCK_KINDS lists the categories in this order. `var` sits in Control with
 * `set` and `change` (it gates "Make a variable"); the toolbox shows the `var` getter under Values.
 */
export const BLOCK_CATEGORY: Readonly<Record<BlockKind, BlockCategory>> = {
  morning: 'triggers',
  atTime: 'triggers',
  bagFull: 'triggers',
  startsRaining: 'triggers',
  every: 'triggers',
  repeatTimes: 'control',
  repeatUntil: 'control',
  repeatForever: 'control',
  if: 'control',
  forEachTile: 'control',
  set: 'control',
  change: 'control',
  var: 'control',
  helper: 'control',
  runHelper: 'control',
  move: 'actions',
  turn: 'actions',
  goTo: 'actions',
  water: 'actions',
  refill: 'actions',
  harvest: 'actions',
  deposit: 'actions',
  take: 'actions',
  till: 'actions',
  plant: 'actions',
  powerDown: 'actions',
  wait: 'actions',
  say: 'actions',
  cropIsReady: 'sensors',
  soilIsDry: 'sensors',
  tileIsTilled: 'sensors',
  cropIs: 'sensors',
  bagIsFull: 'sensors',
  bagHas: 'sensors',
  atEdgeOf: 'sensors',
  tokensBelow: 'sensors',
  tileAheadIs: 'sensors',
  itIsRaining: 'sensors',
  timeIsAfter: 'sensors',
  num: 'values',
  text: 'values',
  yes: 'values',
  item: 'values',
  tile: 'values',
  myTile: 'values',
  tileAhead: 'values',
  tokensLeft: 'values',
  countInBag: 'values',
  arith: 'values',
  compare: 'values',
  and: 'values',
  or: 'values',
  not: 'values',
};
```

- [ ] **Step 4: Types and config**

**4a. `src/core/types.ts`.** Replace:

```ts
export const SAVE_VERSION = 6 as const;
```

with:

```ts
import type { BlockKind } from '../robots/blockKinds';

export const SAVE_VERSION = 6 as const;
```

In `interface RobotsState`, replace:

```ts
  /** Named farm rectangles for programs and .MDs; null is an empty zone. */
  readonly zones: Readonly<Record<ZoneId, ZoneRect | null>>;
}
```

with:

```ts
  /** Named farm rectangles for programs and .MDs; null is an empty zone. */
  readonly zones: Readonly<Record<ZoneId, ZoneRect | null>>;
  /** What the robot screen offers (farmclaws part 3 spec §7). Gates the editor only, never the simulation. */
  readonly unlocks: RobotUnlocks;
}
```

Insert directly after the closing `};` of `export type MdCard = …` (whose last lines are `readonly when: { readonly kind: 'bagFull' } | … | { readonly kind: 'raining' };` and `    };`), before the `// Sections for later workstreams` banner:

```ts

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
```

**4b. `src/config.ts`.** Replace:

```ts
import { Direction, EVERY_CHOICES, type ItemStack, type RobotActionKind, type RobotSize, type TileCoord, type TileRect } from './core/types';
```

with:

```ts
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
```

and insert directly above `export const GENERATORS = {`:

```ts
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

```

- [ ] **Step 5: Create `src/robots/unlocks.ts`**

```ts
/**
 * The unlocked blocks, cards and robot-screen tabs (farmclaws part 3 spec §7). Unlocks gate the
 * editor only: the simulation never reads them. Pure.
 */
import { MD_CARD_KINDS, ROBOT_TABS, type GameState, type RobotUnlocks } from '../core/types';
import { BLOCK_KINDS } from './blockKinds';

/** Every block, card and tab, in canonical order. */
export const ALL_UNLOCKS: RobotUnlocks = { blocks: BLOCK_KINDS, cards: MD_CARD_KINDS, tabs: ROBOT_TABS };

/** `have` with `add` joined in `order`'s order; `have` itself when `add` brings nothing new. */
function joined<T>(order: readonly T[], have: readonly T[], add: readonly T[] | undefined): readonly T[] {
  if (add === undefined || add.every((kind) => have.includes(kind))) return have;
  return order.filter((kind) => have.includes(kind) || add.includes(kind));
}

/**
 * `state` with `add` unlocked on top of what already is, each list in canonical order. The same
 * state comes back when nothing in `add` is new. Part 4's jobs call this.
 */
export function withUnlocks(state: GameState, add: Partial<RobotUnlocks>): GameState {
  const have = state.robots.unlocks;
  const blocks = joined(BLOCK_KINDS, have.blocks, add.blocks);
  const cards = joined(MD_CARD_KINDS, have.cards, add.cards);
  const tabs = joined(ROBOT_TABS, have.tabs, add.tabs);
  if (blocks === have.blocks && cards === have.cards && tabs === have.tabs) return state;
  return { ...state, robots: { ...state.robots, unlocks: { blocks, cards, tabs } } };
}
```

- [ ] **Step 6: New farms, validation and the migration**

**6a. `src/state/initialState.ts`.** Replace:

```ts
import { INVENTORY, PLAYER, TOOLS, WORLD } from '../config';
```

with:

```ts
import { INVENTORY, PLAYER, TOOLS, UNLOCKS, WORLD } from '../config';
```

and in `createDefaultSections`, replace:

```ts
      zones: { A: null, B: null, C: null, D: null, E: null, F: null, G: null, H: null },
    },
```

with:

```ts
      zones: { A: null, B: null, C: null, D: null, E: null, F: null, G: null, H: null },
      unlocks: UNLOCKS.job1,
    },
```

**6b. `src/state/robotValidation.ts`.** In the `../core/types` import, replace:

```ts
  MAP_IDS,
  QUALITIES,
```

with:

```ts
  MAP_IDS,
  MD_CARD_KINDS,
  QUALITIES,
```

and replace:

```ts
  ROBOT_SIZES,
  VALUE_TYPES,
```

with:

```ts
  ROBOT_SIZES,
  ROBOT_TABS,
  VALUE_TYPES,
```

Replace:

```ts
import { isItemId } from '../items/items';
```

with:

```ts
import { isItemId } from '../items/items';
import { BLOCK_KINDS } from '../robots/blockKinds';
```

Insert directly after the closing `}` of `isValidZones`:

```ts

/** The unlocks (part 3 spec §9.2): exactly blocks, cards and tabs, each a canonical list of known kinds. */
function isValidUnlocks(v: unknown): boolean {
  return (
    isObj(v) &&
    hasExactKeys(v, ['blocks', 'cards', 'tabs']) &&
    isCanonicalSubset(v.blocks, BLOCK_KINDS) &&
    isCanonicalSubset(v.cards, MD_CARD_KINDS) &&
    isCanonicalSubset(v.tabs, ROBOT_TABS)
  );
}
```

In `isValidRobotsSection`, replace:

```ts
  if (!isObj(v) || !hasExactKeys(v, ['nextId', 'list', 'pool', 'log', 'lastNightFuel', 'zones']) || !isObj(player)) return false;
  if (!isValidZones(v.zones)) return false;
```

with:

```ts
  if (!isObj(v) || !hasExactKeys(v, ['nextId', 'list', 'pool', 'log', 'lastNightFuel', 'zones', 'unlocks']) || !isObj(player)) return false;
  if (!isValidZones(v.zones) || !isValidUnlocks(v.unlocks)) return false;
```

**6c. `src/state/persistence.ts`.** Replace:

```ts
import { INVENTORY, TIME } from '../config';
```

with:

```ts
import { INVENTORY, TIME, UNLOCKS } from '../config';
```

and in Task 3's `migrateV5toV6`, replace:

```ts
/** Version 5 predates the robot screen (farmclaws part 3 spec §9.1): robots gain stats in place of tokensToday. */
function migrateV5toV6(save: Obj): Obj {
  const robots = save.robots;
  if (!isObj(robots) || !Array.isArray(robots.list)) return save;
  const list = (robots.list as readonly unknown[]).map(migrateRobotV5);
  return { ...save, version: 6, robots: { ...robots, list } };
}
```

with:

```ts
/**
 * Version 5 predates the robot screen (farmclaws part 3 spec §9.1): robots gain stats in place of
 * tokensToday, and the robots section gains job 1's unlocks.
 */
function migrateV5toV6(save: Obj): Obj {
  const robots = save.robots;
  if (!isObj(robots) || !Array.isArray(robots.list)) return save;
  const list = (robots.list as readonly unknown[]).map(migrateRobotV5);
  return { ...save, version: 6, robots: { ...robots, list, unlocks: UNLOCKS.job1 } };
}
```

(The v2 → v3 and v3 → v4 steps already take `createDefaultSections().robots`, which now carries job 1's unlocks; the v5 step writes the same.)

- [ ] **Step 7: The dev hook (`src/dev/robotDev.ts`)**

Task 2 removed the `periodFor` import from this file. Insert

```ts
import { ALL_UNLOCKS, withUnlocks } from '../robots/unlocks';
```

directly after `import { robotSays, whatHappened } from '../robots/logText';` (before `import { withRobot } from '../robots/world';`). In `type RobotDevHandle`, replace:

```ts
  readonly blocks: typeof b;
};
```

with:

```ts
  readonly blocks: typeof b;
  readonly unlockAll: () => string;
};
```

and at the end of `installRobotDev`, replace:

```ts
  const hooks: RobotDevHandle = { addRobot: add, addScriptedRobot: addScripted, robotLog: log, setProgram, setMd, setZone, blocks: b };
```

with:

```ts
  /** Unlocks every block, card and tab (part 3 spec §7), for trying the whole editor before part 4's jobs. */
  const unlockAll = (): string => {
    store.dispatch(actions.load(withUnlocks(store.getState(), ALL_UNLOCKS)));
    return 'Unlocked every block, card and tab.';
  };

  const hooks: RobotDevHandle = { addRobot: add, addScriptedRobot: addScripted, robotLog: log, setProgram, setMd, setZone, blocks: b, unlockAll };
```

- [ ] **Step 8: Test helpers and the defaults test**

**8a. `tests/testUtils.ts`.** Replace:

```ts
import { INVENTORY, TIME } from '../src/config';
```

with:

```ts
import { INVENTORY, TIME, UNLOCKS } from '../src/config';
```

and in `v5Save` (as Task 3 left it), replace:

```ts
    robot.tokensToday = today.tokens;
    delete robot.stats;
  }
  return save;
```

with:

```ts
    robot.tokensToday = today.tokens;
    delete robot.stats;
  }
  // Unlocks: a v5 save has none; the migration gives it job 1's.
  const robots = save.robots as SaveJson;
  if (!deepEqual(robots.unlocks, UNLOCKS.job1)) throw new Error("v5Save: a version-5 save starts from job 1's unlocks");
  delete robots.unlocks;
  return save;
```

**8b. `tests/sections.test.ts`.** Replace:

```ts
import { APPEARANCE, INVENTORY, LAYOUT, PROFILE, TOOLS } from '../src/config';
```

with:

```ts
import { APPEARANCE, INVENTORY, LAYOUT, PROFILE, TOOLS, UNLOCKS } from '../src/config';
```

and in `expected.robots` (in `describe('createDefaultSections', …)`), replace:

```ts
      zones: { A: null, B: null, C: null, D: null, E: null, F: null, G: null, H: null },
    },
  };
```

with:

```ts
      zones: { A: null, B: null, C: null, D: null, E: null, F: null, G: null, H: null },
      unlocks: UNLOCKS.job1,
    },
  };
```

- [ ] **Step 9: Run them and see them pass**

Run: `npx vitest run tests/unlocks.test.ts tests/robotSaveV6.test.ts tests/sections.test.ts tests/persistence.test.ts tests/robotSave.test.ts tests/robotSaveV5.test.ts tests/robotDev.test.ts`
Expected: PASS (`unlocks.test.ts`: 23 tests; `robotSaveV6.test.ts`: 21). `persistence.test.ts`'s field sweep now reaches `robots.unlocks`, and every deletion or retyping of it is rejected by `isValidUnlocks`.

- [ ] **Step 10: The full gate**

Run: `npm run typecheck && npm test && npm run build`
Expected: all green.

- [ ] **Step 11: Commit**

```bash
git add src/robots/blockKinds.ts src/robots/unlocks.ts src/core/types.ts src/config.ts src/state/initialState.ts src/state/robotValidation.ts src/state/persistence.ts src/dev/robotDev.ts tests/testUtils.ts tests/sections.test.ts tests/robotSaveV6.test.ts tests/unlocks.test.ts
git commit -m "Farmclaws part 3: unlocks

BLOCK_KINDS lists every block of the language once (53 kinds, by category), with
MD_CARD_KINDS and ROBOT_TABS beside the types. The robots section saves the unlocked
blocks, cards and tabs, starting at job 1's set for new farms and migrated saves;
withUnlocks joins more in canonical order, and the unlockAll dev hook grants them all.
Unlocks gate the editor only: programs with locked kinds still check and run.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The workbench, the bench, the switch

**Files:**
- Create: `src/robots/workbench.ts`
- Modify: `src/core/types.ts` (`PLACED_OBJECT_KINDS` ~line 243; `PlacedObject` ~line 340; `UiPanel` ~line 464; `Robot.carried` ~line 573 and `Robot.off` ~line 582)
- Modify: `src/config.ts` (new `WORKBENCH` directly above `GENERATORS`)
- Modify: `src/robots/create.ts` (`addRobot`'s robot literal gets `onBench: false`, Step 3d)
- Modify: `src/state/validation.ts` (`OBJECT_FIELDS` ~line 103; `isValidPlacedObject` ~line 132)
- Modify: `src/state/initialState.ts` (imports; `createInitialState`, ~lines 56–64)
- Modify: `src/state/intents.ts` (imports ~line 28; `Intent` ~line 66; constants above `PICKUP_TOOL` ~line 246; `planPickUp` ~line 267; `planCarry` ~line 356; new `planBench` above `planFuel` ~line 380; `planInteraction` ~line 397; `describeIntent` ~line 503)
- Modify: `src/state/actions.ts` (the `GameAction` union and `actions` after Task 2's entries)
- Modify: `src/state/reducer.ts` (stats import ~line 45; `gameReducer` switch; `applyIntent` before `'fuel'` ~line 427; Task 2's `editRobot`; new section above `loadState`)
- Modify: `src/robots/run.ts` (`isDue`, ~lines 37–45)
- Modify: `src/robots/world.ts` (`robotsOnTile`, ~lines 47–50)
- Modify: `src/robots/overnight.ts` (`resetForMorning`, ~lines 131–167)
- Modify: `src/robots/edits.ts` (`programmedRobot`, Step 8d)
- Modify: `src/state/robotValidation.ts` (`ROBOT_KEYS`; new `oneWorkbench` after `burnersOnlyOnFarm`; `isValidRobot`; `isValidRobotsSection`)
- Modify: `src/state/persistence.ts` (imports; export `isValidWorld` ~line 100; `migrateRobotV5` and `migrateV5toV6` from Tasks 3–4; new `placeWorkbenchV6`)
- Modify: `src/render/objectGeometry.ts` (imports ~line 20; `OBJECT_COLORS` ~line 65; new workbench section above the scarecrow section ~line 258; `OBJECT_PART_IDS` ~line 675; `OBJECT_PARTS` ~line 722; `objectPartsFor` ~line 774)
- Modify: `src/render/objectLayout.ts` (`objectLook`, ~lines 63–70)
- Modify: `src/render/TileHighlighter.ts` (`BOX_HEIGHT.object`, ~line 91)
- Modify: `src/render/robotLayout.ts` (config import, line 6; new `benchLift` above the "Carrying, badge and sparks" banner, ~line 99)
- Modify: `src/render/RobotRenderer.ts` (robotLayout import ~line 38; `groundOf` ~line 118; `animate` ~line 327)
- Modify: `tests/testUtils.ts` (config import; `robotOf`; new `benchedRobotOf`; `v5Save`)
- Modify (the workbench on every farm): `tests/objectLayout.test.ts` (config import line 11; `SAMPLES` line 93; `describe('ObjectRenderer')` lines 421–656), `tests/tiles.test.ts` (`SAMPLE_OBJECTS` line 326), `tests/renderMaps.test.ts` (`SAMPLE_OBJECTS` line 51; `expected` ~line 122), `tests/maps.test.ts` (imports line 10; lines 104 and 858), `tests/worldgen.test.ts` (imports line 10; lines 38–39), `tests/sections.test.ts` (config import; ~line 426), `tests/persistence.test.ts` (config import line 11; lines 736–741), `tests/robotEdits.test.ts` (Task 2's `FARM` fixture and its `describe`)
- Test: `tests/robotBench.test.ts` (create), `tests/robotSaveV6.test.ts` (extend), `tests/robotEdits.test.ts` (extend)

**Interfaces:**
- Consumes: Task 2's `editRobot(state, robotId, edit, done)` in `src/state/reducer.ts` and `tests/robotEdits.test.ts`'s `describe('the programRobot and setRobotMd actions')` with its `FARM` and `WALK`; Task 3's `migrateRobotV5`, `v5Save` and `robotOf` (`stats: ZERO_ROBOT_STATS`); Task 4's `migrateV5toV6` (with `unlocks: UNLOCKS.job1`) and `v5Save` (ending in the unlocks block); `tests/robotSaveV6.test.ts`'s `loadedFrom`, `corrupt` (Tasks 1, 3). Part 1–2: `carryEnergyFor`, `putDownPower` (already treats every non-null `off` alike, `'player'` included), `nearestWalkable`, `setTile`, `stepTile`, `isReservedTile`.
- Produces:
  - `src/core/types.ts`: `'workbench'` in `PLACED_OBJECT_KINDS`; `PlacedObject` gains `{ readonly kind: 'workbench' }`; `Robot.onBench: boolean`; `Robot.off: null | 'dizzy' | 'done' | 'player'`; `UiPanel` gains `{ readonly kind: 'robot'; readonly robotId: number; readonly mode: 'bench' | 'peek' }`.
  - `src/config.ts`: `WORKBENCH = { home: { tx: 6, tz: 4 } satisfies TileCoord, topHeight: 0.55 } as const`.
  - `src/robots/workbench.ts`: `workbenchTile(farm: WorldState): TileCoord | null`; `freeSpotNear(farm: WorldState, from: TileCoord, taken: readonly TileCoord[]): TileCoord`; `withWorkbenchAt(farm: WorldState, at: TileCoord): WorldState` (throws unless `at` is free ground; writes a plain grass tile holding the workbench); `robotOnBench(state: GameState): Robot | null`.
  - `src/state/intents.ts`: `Intent` gains `{ kind: 'benchRobot'; robotId: number; name: string }` and `{ kind: 'openBench'; robotId: number; name: string }`; the `blocked` intent gains an optional `hint?: string`, which `describeIntent` returns (only the empty bench sets it). Hints: "Put {name} on the bench", "Work on {name}", "Bring a robot here to work on it". Refusals: "There's already a robot on the bench.", "It's part of the farm.".
  - Actions: `{ type: 'robot/liftOff'; robotId: number }` → `actions.liftOffBench(robotId)`; `{ type: 'robot/switch'; robotId: number; on: boolean }` → `actions.switchRobot(robotId, on)`.
  - Reducer: `benchRobot` and `openBench` intents open `{ kind: 'robot', robotId, mode: 'bench' }`; `editRobot` refuses a robot off the bench with "Put {name} on the workbench first." (warn), which covers `programRobot` and `setRobotMd`; `liftOffBench` (carry energy, "You're too tired to carry {name}.", closes that robot's panel); `switchRobot` (free; the same refusal off the bench; switching off a robot that isn't working, standby or flat is refused with "{name} can't be switched off while it's broken." (warn)).
  - `src/robots/run.ts`: `isDue` is false for a carried or benched robot and for any robot whose `off` isn't null (plan R2). `src/robots/world.ts`: `robotsOnTile` skips benched robots. `src/robots/overnight.ts`: `resetForMorning` never moves a benched robot and keeps `off: 'player'`.
  - `src/state/persistence.ts`: `export function isValidWorld(world: unknown, id: MapId): world is WorldState`; private `placeWorkbenchV6(save: Obj): Obj`; v5 robots gain `onBench: false`.
  - `src/state/robotValidation.ts`: exactly one workbench, on the farm; `onBench` boolean; a benched robot sits on the workbench tile, isn't carried or repairing, and is the only one; no other standing robot on the workbench tile; `off` may be `'player'`.
  - `src/render/robotLayout.ts`: `export function benchLift(robot: Pick<Robot, 'onBench'>): number`. `src/render/objectGeometry.ts`: `export const WORKBENCH_SHAPE`, `export function createWorkbenchGeometry(): THREE.BufferGeometry`, part id `'workbench'`.
  - `tests/testUtils.ts`: `export function benchedRobotOf(overrides: Partial<Robot> = {}): Robot`; `robotOf` has `onBench: false`; `v5Save` takes the workbench off the farm (its chunk revision one lower) and drops `onBench`, and throws for a benched or switched-off robot.

Facts checked against the code: `(6, 4)` is plain grass on every generated farm (seeds `0x5eedf00d`, 0, 1, 7, 12345, `0xffffffff`); on the default seed `(5, 4)` holds a wild mushroom, while `(6, 2)`, `(6, 3)`, `(6, 5)`, `(7, 4)`, `(7, 5)` and `(8, 4)` are plain grass. No `switch` over `UiPanel['kind']` is exhaustive, so the new panel kind needs no other change; `panelKeyCommand` still closes it with Escape (plan R7). `src/ui/icons.ts` switches over placeable items only, so the workbench needs no icon.

- [ ] **Step 1: Write the failing tests**

**1a.** Create `tests/robotBench.test.ts`:

```ts
/**
 * The workbench (farmclaws part 3 spec §2.1, §2.2, §2.4): where it stands on new farms, putting a
 * robot on it, reopening its screen, lifting the robot off, the on/off switch, and benched robots
 * through the day and the night. Its save rules and migration are in robotSaveV6.test.ts; the
 * bench-only program and .MD edits in robotEdits.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { INVENTORY, PLAYER, ROBOTS, WORKBENCH, WORLD } from '../src/config';
import { Direction, MAP_IDS, TileState, type GameState, type Robot, type TileCoord } from '../src/core/types';
import { b } from '../src/robots/blocks';
import { morningExec } from '../src/robots/exec';
import { freeSpotNear, robotOnBench, withWorkbenchAt, workbenchTile } from '../src/robots/workbench';
import { requireRobot, robotsOnTile } from '../src/robots/world';
import { benchLift } from '../src/render/robotLayout';
import { actions } from '../src/state/actions';
import { createInitialState } from '../src/state/initialState';
import { describeIntent, planInteraction, planPrimaryAction } from '../src/state/intents';
import { gameReducer, startNextDay } from '../src/state/reducer';
import { EMPTY_TILE, forEachTile } from '../src/world/tiles';
import {
  BASE,
  benchedRobotOf,
  emptyHanded,
  holding,
  matureCrop,
  robotOf,
  soilTile,
  tileAt,
  withEnergy,
  withPlayer,
  withRobots,
  withTile,
} from './testUtils';

const HOME: TileCoord = WORKBENCH.home;
/** The tile south of the bench; the player stands here facing North to use it. */
const AT_BENCH: TileCoord = { tx: HOME.tx, tz: HOME.tz + 1 };
const atBench = (state: GameState): GameState => withPlayer(state, AT_BENCH, Direction.North);
const interact = (state: GameState): GameState => gameReducer(state, actions.interact());
const lastText = (state: GameState): string | undefined => state.messages.entries.at(-1)?.text;
const chest = { kind: 'chest' as const, slots: new Array<null>(INVENTORY.chestSlots).fill(null) };

/** At the bench, carrying robot 1 (Sprocket) plus any `others`. */
function carryingAtBench(overrides: Partial<Robot> = {}, others: readonly Robot[] = []): GameState {
  const state = withRobots({ ...BASE, player: { ...BASE.player, carrying: 1 } }, [robotOf({ carried: true, ...overrides }), ...others]);
  return atBench(state);
}

/** At the bench, empty-handed, with `robot` on it. */
const benched = (robot: Robot = benchedRobotOf()): GameState => atBench(emptyHanded(withRobots(BASE, [robot])));

describe('the workbench on the farm', () => {
  it('stands at WORKBENCH.home on every new farm, the only one on any map', () => {
    expect(WORKBENCH).toEqual({ home: { tx: 6, tz: 4 }, topHeight: 0.55 });
    for (const seed of [WORLD.seed, 0, 1, 7, 12345, 0xffffffff]) {
      const state = createInitialState(seed);
      expect(workbenchTile(state.maps.farm), `seed ${seed}`).toEqual(HOME);
      expect(tileAt(state, HOME, 'farm')).toEqual({ ...EMPTY_TILE, object: { kind: 'workbench' } });
      let benches = 0;
      for (const id of MAP_IDS) {
        forEachTile(state.maps[id], (tile) => {
          if (tile.object?.kind === 'workbench') benches++;
        });
      }
      expect(benches, `seed ${seed}`).toBe(1);
    }
  });

  it('finds the nearest free tile breadth-first, in DIRECTIONS order, when home is built on', () => {
    const bare = withTile(BASE, HOME, EMPTY_TILE, 'farm');
    expect(freeSpotNear(bare.maps.farm, HOME, [])).toEqual(HOME);
    const built = withTile(bare, HOME, { ...EMPTY_TILE, object: chest }, 'farm').maps.farm;
    expect(freeSpotNear(built, HOME, [])).toEqual({ tx: 6, tz: 3 });
    expect(freeSpotNear(built, HOME, [{ tx: 6, tz: 3 }])).toEqual({ tx: 7, tz: 4 });
    expect(freeSpotNear(built, HOME, [{ tx: 6, tz: 3 }, { tx: 7, tz: 4 }])).toEqual({ tx: 6, tz: 5 });
    // West of home grows a wild mushroom on this seed, so the search moves on to the next ring.
    expect(tileAt(BASE, { tx: 5, tz: 4 }, 'farm').crop?.wild).toBe(true);
    expect(freeSpotNear(built, HOME, [{ tx: 6, tz: 3 }, { tx: 7, tz: 4 }, { tx: 6, tz: 5 }])).toEqual({ tx: 6, tz: 2 });
  });

  it('never picks fertilised or planted soil, a path or a reserved tile', () => {
    let state = withTile(BASE, HOME, { ...EMPTY_TILE, object: chest }, 'farm');
    state = withTile(state, { tx: 6, tz: 3 }, { ...soilTile(TileState.Plowed), fertilizer: 'basic' }, 'farm');
    state = withTile(state, { tx: 7, tz: 4 }, soilTile(TileState.Watered, matureCrop('parsnip')), 'farm');
    state = withTile(state, { tx: 6, tz: 5 }, { ...EMPTY_TILE, object: { kind: 'woodPath' } }, 'farm');
    expect(freeSpotNear(state.maps.farm, HOME, [])).toEqual({ tx: 6, tz: 2 });
    expect(() => withWorkbenchAt(state.maps.farm, { tx: 6, tz: 3 })).toThrow();
    expect(() => withWorkbenchAt(BASE.maps.farm, { tx: 0, tz: 13 })).toThrow();
    expect(() => withWorkbenchAt(BASE.maps.farm, HOME)).toThrow();
  });

  it('blocks the player, and the pickaxe and axe refuse it', () => {
    const state = atBench(BASE);
    expect(gameReducer(state, actions.move(Direction.North)).player).toMatchObject(AT_BENCH);
    for (const tool of ['pickaxe', 'axe'] as const) {
      const holdingTool = holding(state, tool);
      expect(planPrimaryAction(holdingTool).intent).toEqual({ kind: 'blocked', reason: "It's part of the farm." });
      const next = gameReducer(holdingTool, actions.useTool());
      expect(lastText(next)).toBe("It's part of the farm.");
      expect(tileAt(next, HOME, 'farm')).toBe(tileAt(state, HOME, 'farm'));
    }
  });

  it('lifts a robot on the bench onto the bench top when drawn', () => {
    expect(benchLift({ onBench: true })).toBe(WORKBENCH.topHeight);
    expect(benchLift({ onBench: false })).toBe(0);
  });
});

describe('putting a robot on the bench', () => {
  it('benches the carried robot facing the way the player faces, and opens its screen', () => {
    const state = carryingAtBench({ tx: 2, tz: 12, facing: Direction.East, power: 'standby', off: 'dizzy', tokens: 33 });
    expect(describeIntent(planInteraction(state).intent)).toBe('Put Sprocket on the bench');
    const next = interact(state);
    expect(next.player.carrying).toBeNull();
    expect(next.player.energy).toBe(state.player.energy);
    expect(requireRobot(next, 1)).toMatchObject({
      carried: false,
      onBench: true,
      tx: HOME.tx,
      tz: HOME.tz,
      facing: Direction.North,
      teleportSeq: 1,
      power: 'standby',
      off: 'dizzy',
      tokens: 33,
    });
    expect(next.ui.panel).toEqual({ kind: 'robot', robotId: 1, mode: 'bench' });
    expect(robotOnBench(next)?.id).toBe(1);
    expect(robotsOnTile(next, HOME.tx, HOME.tz)).toEqual([]);
  });

  it('works with Space too', () => {
    const next = gameReducer(holding(carryingAtBench(), 'hoe'), actions.useTool());
    expect(requireRobot(next, 1).onBench).toBe(true);
  });

  it('refuses an occupied bench', () => {
    const state = carryingAtBench({}, [benchedRobotOf({ id: 2, name: 'Bolt' })]);
    const next = interact(state);
    expect(lastText(next)).toBe("There's already a robot on the bench.");
    expect(next.player.carrying).toBe(1);
    expect(requireRobot(next, 1).carried).toBe(true);
    expect(next.ui.panel).toEqual({ kind: 'none' });
  });

  it('reopens the screen of the robot on the bench, and never picks it up', () => {
    const state = benched();
    expect(describeIntent(planInteraction(state).intent)).toBe('Work on Sprocket');
    const next = interact(state);
    expect(next.ui.panel).toEqual({ kind: 'robot', robotId: 1, mode: 'bench' });
    expect(next.player.carrying).toBeNull();
    expect(next.player.energy).toBe(state.player.energy);
    expect(requireRobot(next, 1)).toBe(requireRobot(state, 1));
  });

  it('says what the empty bench is for, as the hint and as a toast', () => {
    const state = atBench(emptyHanded(BASE));
    expect(describeIntent(planInteraction(state).intent)).toBe('Bring a robot here to work on it');
    const next = interact(state);
    expect(lastText(next)).toBe('Bring a robot here to work on it');
    expect(next.ui.panel).toEqual({ kind: 'none' });
    expect(next.maps).toBe(state.maps);
    expect(next.robots).toBe(state.robots);
  });
});

describe('lifting a robot off the bench', () => {
  it("costs carry energy, puts the robot in the player's arms and closes its screen", () => {
    const open = interact(benched());
    const next = gameReducer(open, actions.liftOffBench(1));
    expect(next.player.carrying).toBe(1);
    expect(next.player.energy).toBe(open.player.energy - ROBOTS.carryEnergy.mini);
    expect(requireRobot(next, 1)).toMatchObject({ onBench: false, carried: true });
    expect(next.ui.panel).toEqual({ kind: 'none' });
    // Put down with part 1's put-down, beside the bench.
    const down = interact(gameReducer(next, actions.face(Direction.East)));
    expect(down.player.carrying).toBeNull();
    expect(requireRobot(down, 1)).toMatchObject({ carried: false, onBench: false, tx: AT_BENCH.tx + 1, tz: AT_BENCH.tz, power: 'working' });
  });

  it("refuses with part 1's too-tired text and keeps the screen open", () => {
    const open = withEnergy(interact(benched(benchedRobotOf({ size: 'big' }))), ROBOTS.carryEnergy.big - 1);
    const next = gameReducer(open, actions.liftOffBench(1));
    expect(lastText(next)).toBe("You're too tired to carry Sprocket.");
    expect(requireRobot(next, 1).onBench).toBe(true);
    expect(next.ui.panel).toEqual({ kind: 'robot', robotId: 1, mode: 'bench' });
  });

  it('does nothing for a robot off the bench, an unknown robot, or while carrying another', () => {
    const field = withRobots(BASE, [robotOf()]);
    expect(gameReducer(field, actions.liftOffBench(1))).toBe(field);
    expect(gameReducer(field, actions.liftOffBench(9))).toBe(field);
    const busy = carryingAtBench({}, [benchedRobotOf({ id: 2, name: 'Bolt' })]);
    expect(gameReducer(busy, actions.liftOffBench(2))).toBe(busy);
  });
});

describe('the on/off switch', () => {
  it("switches a benched robot off whatever its off reason, and on only from 'player', for free", () => {
    const dizzy = benched(benchedRobotOf({ off: 'dizzy' }));
    const off = gameReducer(dizzy, actions.switchRobot(1, false));
    expect(requireRobot(off, 1).off).toBe('player');
    expect([off.player.gold, off.player.energy]).toEqual([dizzy.player.gold, dizzy.player.energy]);
    expect(requireRobot(gameReducer(off, actions.switchRobot(1, true)), 1).off).toBeNull();
    expect(gameReducer(dizzy, actions.switchRobot(1, true))).toBe(dizzy);
    expect(gameReducer(off, actions.switchRobot(1, false))).toBe(off);
  });

  it('refuses a robot that is not on the bench', () => {
    const field = withRobots(BASE, [robotOf()]);
    const next = gameReducer(field, actions.switchRobot(1, false));
    expect(lastText(next)).toBe('Put Sprocket on the workbench first.');
    expect(requireRobot(next, 1).off).toBeNull();
  });

  it('refuses to switch off a broken robot, whose save would not load', () => {
    const broken = benched(benchedRobotOf({ power: 'broken' }));
    const next = gameReducer(broken, actions.switchRobot(1, false));
    expect(lastText(next)).toBe("Sprocket can't be switched off while it's broken.");
    expect(next.messages.entries.at(-1)?.tone).toBe('warn');
    expect(next.robots).toBe(broken.robots);
    expect(gameReducer(broken, actions.switchRobot(1, true))).toBe(broken);
  });

  it('switches off a flat robot', () => {
    const flat = benched(benchedRobotOf({ power: 'flat', tokens: 0 }));
    expect(requireRobot(gameReducer(flat, actions.switchRobot(1, false)), 1).off).toBe('player');
  });

  it('keeps a switched-off robot from acting, a script robot included', () => {
    const off = withRobots(BASE, [robotOf({ off: 'player' })]);
    expect(requireRobot(gameReducer(off, actions.tick(60)), 1).actionSeq).toBe(0);
    const on = withRobots(BASE, [robotOf()]);
    expect(requireRobot(gameReducer(on, actions.tick(60)), 1).actionSeq).toBeGreaterThan(0);
  });

  it("keeps 'player' through the morning, while dizzy and done clear", () => {
    const state = withRobots(BASE, [
      robotOf({ off: 'player' }),
      robotOf({ id: 2, name: 'Bolt', tx: 4, tz: 10, off: 'dizzy' }),
      robotOf({ id: 3, name: 'Cog', tx: 3, tz: 10, power: 'standby', off: 'done' }),
    ]);
    const morning = startNextDay(state, false);
    expect(morning.robots.list.map((r) => r.off)).toEqual(['player', null, null]);
    expect(requireRobot(gameReducer(morning, actions.tick(60)), 1).actionSeq).toBe(0);
  });
});

describe('benched robots through the day and the night', () => {
  const SPIN = b.program({ stacks: [b.when(b.morning(), b.forever(b.turn('right')))] });

  it('never act, however due they are', () => {
    for (const robot of [benchedRobotOf(), benchedRobotOf({ program: SPIN, exec: morningExec(SPIN) })]) {
      const state = withRobots(BASE, [robot]);
      const later = gameReducer(state, actions.tick(120));
      expect(requireRobot(later, 1)).toBe(requireRobot(state, 1));
    }
  });

  it('recharge within reach of a burner and stay on the bench through the morning', () => {
    const burner = { tx: HOME.tx + ROBOTS.chargeRadius, tz: HOME.tz };
    const state = withTile(withRobots(BASE, [benchedRobotOf({ tokens: 50 })]), burner, { ...EMPTY_TILE, object: { kind: 'woodBurner', fuel: 5 } }, 'farm');
    const morning = startNextDay(state, false);
    expect(requireRobot(morning, 1)).toMatchObject({ onBench: true, tx: HOME.tx, tz: HOME.tz, tokens: 80, teleportSeq: 0, power: 'working' });
  });

  it('miss the recharge out of reach, like any robot, and still stay on the bench', () => {
    const morning = startNextDay(withRobots(BASE, [benchedRobotOf({ tokens: 50 })]), false);
    expect(requireRobot(morning, 1)).toMatchObject({ onBench: true, tx: HOME.tx, tz: HOME.tz, tokens: 50 });
    expect(morning.messages.entries.map((m) => m.text)).toContain("Sprocket ended the day away from a generator and didn't recharge.");
  });

  it('stay put while a carried robot is still set down at spawn', () => {
    const state = withRobots({ ...BASE, player: { ...BASE.player, carrying: 1 } }, [robotOf({ carried: true }), benchedRobotOf({ id: 2, name: 'Bolt' })]);
    const morning = startNextDay(state, false);
    expect(requireRobot(morning, 1)).toMatchObject({ carried: false, onBench: false, tx: PLAYER.spawn.tx, tz: PLAYER.spawn.tz });
    expect(requireRobot(morning, 2)).toMatchObject({ onBench: true, tx: HOME.tx, tz: HOME.tz });
    expect(morning.player.carrying).toBeNull();
  });
});
```

**1b.** Extend `tests/robotSaveV6.test.ts` (as Tasks 1, 3 and 4 left it). Replace Task 4's:

```ts
import { UNLOCKS } from '../src/config';
```

with:

```ts
import { INVENTORY, UNLOCKS, WORKBENCH } from '../src/config';
```

replace:

```ts
import { SAVE_VERSION, type GameState, type RobotStats } from '../src/core/types';
```

with:

```ts
import { Direction, SAVE_VERSION, type GameState, type RobotStats } from '../src/core/types';
```

replace:

```ts
import { ALL_UNLOCKS, withUnlocks } from '../src/robots/unlocks';
```

with:

```ts
import { ALL_UNLOCKS, withUnlocks } from '../src/robots/unlocks';
import { requireRobot } from '../src/robots/world';
import { actions } from '../src/state/actions';
```

replace:

```ts
import { deserializeGame, migrateSave, serializeGame } from '../src/state/persistence';
```

with:

```ts
import { deserializeGame, migrateSave, serializeGame } from '../src/state/persistence';
import { gameReducer } from '../src/state/reducer';
import { locateTile } from '../src/world/grid';
import { EMPTY_TILE } from '../src/world/tiles';
```

replace:

```ts
import { BASE, must, robotOf, v5Save, withRobots, withZones, type SaveJson } from './testUtils';
```

with:

```ts
import { BASE, benchedRobotOf, must, robotOf, v5Save, withPlayer, withRobots, withTile, withZones, type SaveJson } from './testUtils';
```

and append at the end of the file:

```ts

describe('the workbench in save version 6', () => {
  const HOME = WORKBENCH.home;
  const AT_BENCH = { tx: HOME.tx, tz: HOME.tz + 1 };
  const chest = { kind: 'chest' as const, slots: new Array<null>(INVENTORY.chestSlots).fill(null) };
  const benchTile = { ...EMPTY_TILE, object: { kind: 'workbench' as const } };
  const load = (save: SaveJson): GameState | null => deserializeGame(JSON.stringify(save));

  /** The saved farm tile at (tx, tz). */
  function farmTile(save: SaveJson, tx: number, tz: number): SaveJson {
    const farm = (save.maps as SaveJson).farm as { chunks: { tiles: SaveJson[] }[] };
    const at = locateTile(BASE.maps.farm.grid, tx, tz);
    return must(must(farm.chunks[at.chunkIndex]).tiles[at.localIndex]);
  }
  const savedRobot = (save: SaveJson, index: number): SaveJson => must(robotsOf(save).list[index]);

  /** Sprocket switched off on the bench, Bolt working in the field. */
  const BENCHED: GameState = withRobots(BASE, [benchedRobotOf({ off: 'player' }), robotOf({ id: 2, name: 'Bolt' })]);

  /** Sprocket carried to the bench and put on it through the reducer: its screen is open. */
  const carryToBench = (): GameState => {
    const carrying = withRobots({ ...BASE, player: { ...BASE.player, carrying: 1 } }, [robotOf({ carried: true })]);
    return gameReducer(withPlayer(carrying, AT_BENCH, Direction.North), actions.interact());
  };

  it('round-trips robots on and around the bench in every state the game makes', () => {
    const real = carryToBench();
    expect(real.ui.panel).toEqual({ kind: 'robot', robotId: 1, mode: 'bench' });
    const lifted = gameReducer(real, actions.liftOffBench(1));
    const states = [
      BENCHED,
      real,
      lifted,
      withRobots(BASE, [benchedRobotOf({ power: 'broken' })]),
      withRobots(BASE, [benchedRobotOf({ power: 'flat', tokens: 0, off: 'player' })]),
      withRobots(BASE, [robotOf({ power: 'repairing', repairReadyDay: 1, tx: HOME.tx, tz: HOME.tz })]),
    ];
    for (const state of states) expect(deserializeGame(serializeGame(state))).toEqual(loadedFrom(state));
  });

  it('migrates a v5 save: the workbench goes home and no robot is on it', () => {
    const state = withRobots(BASE, [robotOf(), robotOf({ id: 2, name: 'Bolt', tx: 4, tz: 10 })]);
    const v5 = v5Save(state);
    expect(farmTile(v5, HOME.tx, HOME.tz).object).toBeNull();
    const migrated = migrateSave(v5) as SaveJson;
    expect(farmTile(migrated, HOME.tx, HOME.tz).object).toEqual({ kind: 'workbench' });
    expect([savedRobot(migrated, 0).onBench, savedRobot(migrated, 1).onBench]).toEqual([false, false]);
    expect(load(v5)).toEqual(state);
  });

  it('puts the workbench on the nearest free tile when home is built on, past robots and the player', () => {
    // In v5 the player built a chest at home; a robot stands north of it and the player east of it.
    let state = withTile(BASE, HOME, { ...EMPTY_TILE, object: chest }, 'farm');
    state = withTile(state, AT_BENCH, benchTile, 'farm');
    state = withPlayer(withRobots(state, [robotOf({ tx: HOME.tx, tz: HOME.tz - 1 })]), { tx: HOME.tx + 1, tz: HOME.tz }, Direction.West);
    const v5 = v5Save(state);
    expect(farmTile(v5, AT_BENCH.tx, AT_BENCH.tz).object).toBeNull();
    expect(farmTile(migrateSave(v5) as SaveJson, AT_BENCH.tx, AT_BENCH.tz).object).toEqual({ kind: 'workbench' });
    expect(load(v5)).toEqual(state);
  });

  it('counts a robot standing on home as built on, but not a carried robot that left from it', () => {
    let standing = withTile(BASE, HOME, EMPTY_TILE, 'farm');
    standing = withTile(standing, { tx: HOME.tx, tz: HOME.tz - 1 }, benchTile, 'farm');
    standing = withRobots(standing, [robotOf({ tx: HOME.tx, tz: HOME.tz })]);
    expect(load(v5Save(standing))).toEqual(standing);
    const lifted = gameReducer(carryToBench(), actions.liftOffBench(1));
    expect(requireRobot(lifted, 1)).toMatchObject({ carried: true, tx: HOME.tx, tz: HOME.tz });
    expect(load(v5Save(lifted))).toEqual(lifted);
  });

  it('cannot write a robot on the bench or switched off to a v5 save', () => {
    expect(() => v5Save(BENCHED)).toThrow('v5Save');
    expect(() => v5Save(withRobots(BASE, [robotOf({ off: 'player' })]))).toThrow('v5Save');
  });

  it('rejects a workbench off the farm', () => {
    const forest = { tx: 10, tz: 10 };
    expect(deserializeGame(serializeGame(withTile(BASE, forest, { ...EMPTY_TILE, object: chest }, 'forest')))).not.toBeNull();
    expect(deserializeGame(serializeGame(withTile(BASE, forest, benchTile, 'forest')))).toBeNull();
  });

  const rejections: readonly [string, GameState, (save: SaveJson) => void][] = [
    ['no workbench on the farm', BASE, (s) => void (farmTile(s, HOME.tx, HOME.tz).object = null)],
    ['a second workbench on the farm', BASE, (s) => void (farmTile(s, HOME.tx + 2, HOME.tz).object = { kind: 'workbench' })],
    ['a workbench with a field', BASE, (s) => void (farmTile(s, HOME.tx, HOME.tz).object = { kind: 'workbench', level: 1 })],
    ['a robot on the bench off the workbench tile', BENCHED, (s) => void (savedRobot(s, 0).tx = HOME.tx + 1)],
    ['a carried robot on the bench', BENCHED, (s) => void (Object.assign(savedRobot(s, 0), { carried: true }), ((s.player as SaveJson).carrying = 1))],
    ['a robot on the bench away for repairs', BENCHED, (s) => void Object.assign(savedRobot(s, 0), { power: 'repairing', repairReadyDay: 1, off: null })],
    ['two robots on the bench', BENCHED, (s) => void Object.assign(savedRobot(s, 1), { onBench: true, tx: HOME.tx, tz: HOME.tz })],
    ['a robot off the bench on the workbench tile', BENCHED, (s) => void (savedRobot(s, 0).onBench = false)],
    ['a missing onBench', BENCHED, (s) => void delete savedRobot(s, 1).onBench],
    ['an onBench that is not a boolean', BENCHED, (s) => void (savedRobot(s, 1).onBench = 0)],
    ['an unknown off reason', BENCHED, (s) => void (savedRobot(s, 0).off = 'sleepy')],
    ['a broken robot switched off', BENCHED, (s) => void Object.assign(savedRobot(s, 1), { power: 'broken', off: 'player' })],
  ];

  it.each(rejections)('rejects %s', (_label, state, edit) => {
    expect(deserializeGame(serializeGame(state))).not.toBeNull();
    expect(corrupt(state, edit)).toBeNull();
  });
});
```

**1c.** Extend `tests/robotEdits.test.ts` (Task 2's file). Replace:

```ts
import { BASE, TARGET, atDay, robotOf, withRobots, withZones } from './testUtils';
```

with:

```ts
import { BASE, TARGET, atDay, benchedRobotOf, robotOf, withRobots, withZones } from './testUtils';
```

In `describe('the programRobot and setRobotMd actions', …)`, replace:

```ts
  /** Sprocket runs a script; Bolt is an idle block robot. */
  const FARM = withRobots(BASE, [robotOf({ id: 1 }), robotOf({ id: 2, name: 'Bolt', tx: 4, tz: 10, power: 'standby', program: WALK, exec: freshExec(WALK) })]);
```

with:

```ts
  /**
   * Sprocket runs a script; Bolt is an idle block robot. Both stand on the workbench, where the
   * robot screen edits robots (part 3 spec §4.7); the save allows one there, but these tests never save.
   */
  const FARM = withRobots(BASE, [
    benchedRobotOf({ id: 1 }),
    benchedRobotOf({ id: 2, name: 'Bolt', power: 'standby', program: WALK, exec: freshExec(WALK) }),
  ]);
```

and insert directly before that `describe`'s closing `});` (after its "edits while a panel freezes the game, as the robot screen needs" test):

```ts

  it('refuses a robot that is not on the bench, for programs and .MDs alike', () => {
    const field = withRobots(BASE, [robotOf({ id: 1 }), robotOf({ id: 2, name: 'Bolt', tx: 4, tz: 10, power: 'standby', program: WALK, exec: freshExec(WALK) })]);
    const programmed = gameReducer(field, actions.programRobot(1, WALK));
    expect(programmed.robots).toBe(field.robots);
    expect(last(programmed)).toMatchObject({ text: 'Put Sprocket on the workbench first.', tone: 'warn' });
    const carded = gameReducer(field, actions.setRobotMd(2, [{ kind: 'dontGoIntoWater' }]));
    expect(carded.robots).toBe(field.robots);
    expect(last(carded)).toMatchObject({ text: 'Put Bolt on the workbench first.', tone: 'warn' });
  });

  it('checks the bench before the program, so a bad program off the bench gets the bench refusal', () => {
    const field = withRobots(BASE, [robotOf({ id: 1 })]);
    expect(last(gameReducer(field, actions.programRobot(1, { kind: 'blocks' } as never)))).toMatchObject({ text: 'Put Sprocket on the workbench first.' });
  });
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run tests/robotBench.test.ts tests/robotSaveV6.test.ts tests/robotEdits.test.ts`
Expected: FAIL — `robotBench.test.ts` with `Failed to resolve import "../src/robots/workbench"`; `robotEdits.test.ts` with `TypeError: benchedRobotOf is not a function` (Vitest turns a missing named export into `undefined`, so it fails when the test calls it); `robotSaveV6.test.ts` with `TypeError: Cannot read properties of undefined (reading 'home')` (`WORKBENCH` isn't in `src/config.ts` yet).

- [ ] **Step 3: Types and config**

**3a. `src/core/types.ts`.** Replace:

```ts
  'decoration',
  'woodBurner',
] as const;
export type PlacedObjectKind = (typeof PLACED_OBJECT_KINDS)[number];
```

with:

```ts
  'decoration',
  'woodBurner',
  'workbench',
] as const;
export type PlacedObjectKind = (typeof PLACED_OBJECT_KINDS)[number];
```

Replace:

```ts
  | { readonly kind: 'decoration'; readonly variant: DecorationId };
```

with:

```ts
  | { readonly kind: 'decoration'; readonly variant: DecorationId }
  /** Built into every farm beside the farmhouse; robots are modded on it (farmclaws part 3 spec §2). Never picked up. */
  | { readonly kind: 'workbench' };
```

Replace:

```ts
  | { readonly kind: 'chest'; readonly mapId: MapId; readonly tx: number; readonly tz: number };
```

with:

```ts
  | { readonly kind: 'chest'; readonly mapId: MapId; readonly tx: number; readonly tz: number }
  /** The robot screen (farmclaws part 3 spec §4): editable at the workbench, read-only when peeking. */
  | { readonly kind: 'robot'; readonly robotId: number; readonly mode: 'bench' | 'peek' };
```

In `interface Robot`, replace:

```ts
  /** True while the player holds it (player.carrying === id). A carried robot never acts. */
  readonly carried: boolean;
```

with:

```ts
  /** True while the player holds it (player.carrying === id). A carried robot never acts. */
  readonly carried: boolean;
  /** True while it stands on the workbench (part 3 spec §2.2): on the workbench tile, never carried, never due. */
  readonly onBench: boolean;
```

and replace:

```ts
  /** Why the robot ignores everything until morning. Separate from `power` (farmclaws design §5.4). Part 3 adds 'player'. */
  readonly off: null | 'dizzy' | 'done';
```

with:

```ts
  /**
   * Why the robot ignores everything. Separate from `power` (farmclaws design §5.4). 'dizzy' and
   * 'done' last until morning; 'player' (the bench's switch) lasts until it is switched on.
   */
  readonly off: null | 'dizzy' | 'done' | 'player';
```

**3b. `src/config.ts`.** Insert directly above `export const GENERATORS = {` (below Task 4's `UNLOCKS`):

```ts
/** The workbench built into every farm (farmclaws part 3 spec §2.1). */
export const WORKBENCH = {
  /** In the farmhouse yard, east of the house and off the door, the spawn and the bin. */
  home: { tx: 6, tz: 4 } satisfies TileCoord,
  /** Height of the bench top above its tile's ground, where a robot on it stands (render only). */
  topHeight: 0.55,
} as const;

```

**3c. `src/state/validation.ts`.** Replace:

```ts
  decoration: ['variant'],
};
```

with:

```ts
  decoration: ['variant'],
  workbench: [],
};
```

and in `isValidPlacedObject`, replace:

```ts
    case 'stonePath':
      return true;
  }
}
```

with:

```ts
    case 'stonePath':
    case 'workbench':
      return true;
  }
}
```

**3d. `src/robots/create.ts`.** `Robot.onBench` is now required, so `addRobot`'s robot literal needs it (without this `npm run typecheck` fails with `Property 'onBench' is missing`). Replace:

```ts
    carried: false,
    program: spec.program,
```

with:

```ts
    carried: false,
    onBench: false,
    program: spec.program,
```

(`addRobot`'s literal in this file and `robotOf` in `tests/testUtils.ts`, Step 11, are the only places that build a whole `Robot`: `grep -rn "teleportSeq: 0\|actionSeq: 0" src` also finds `createInitialState`'s player, which isn't a robot. Tasks 3 and 7 add `stats` and `paint` to the same two places.)

- [ ] **Step 4: Create `src/robots/workbench.ts`**

```ts
/**
 * The workbench (farmclaws part 3 spec §2.1–2.2): where it stands, where it goes when its home
 * tile is built on, and which robot is on it. Pure.
 */
import { invariant } from '../core/invariant';
import { DIRECTIONS, type GameState, type Robot, type Tile, type TileCoord, type WorldState } from '../core/types';
import { inBounds, stepTile } from '../world/grid';
import { MAPS, isReservedTile } from '../world/maps';
import { EMPTY_TILE, forEachTile, getTile, isWalkable, setTile } from '../world/tiles';

/** The farm's workbench tile, or null when there is none (only while a save is being migrated). */
export function workbenchTile(farm: WorldState): TileCoord | null {
  let found: TileCoord | null = null;
  forEachTile(farm, (tile, tx, tz) => {
    if (found === null && tile.object?.kind === 'workbench') found = { tx, tz };
  });
  return found;
}

/**
 * Ground a workbench can go on: walkable, with no object, crop or fertiliser (an object never
 * sits on fertilised soil), and not a reserved tile.
 */
function isFreeGround(tile: Tile, tx: number, tz: number): boolean {
  return isWalkable(tile) && tile.object === null && tile.crop === null && tile.fertilizer === null && !isReservedTile(MAPS.farm, tx, tz);
}

/**
 * `from` when it is free, else the nearest free farm tile: breadth-first over in-bounds tiles in
 * DIRECTIONS order, passing through any tile. A tile in `taken` (robots, the player) is never free.
 */
export function freeSpotNear(farm: WorldState, from: TileCoord, taken: readonly TileCoord[]): TileCoord {
  const key = (c: TileCoord): number => c.tz * farm.grid.width + c.tx;
  const blocked = new Set(taken.map(key));
  const seen = new Set<number>([key(from)]);
  const queue: TileCoord[] = [from];
  for (let head = 0; head < queue.length; head++) {
    const current = queue[head];
    if (current === undefined) break;
    const tile = getTile(farm, current.tx, current.tz);
    if (tile !== null && !blocked.has(key(current)) && isFreeGround(tile, current.tx, current.tz)) return current;
    for (const direction of DIRECTIONS) {
      const next = stepTile(current, direction);
      if (!inBounds(farm.grid, next.tx, next.tz) || seen.has(key(next))) continue;
      seen.add(key(next));
      queue.push(next);
    }
  }
  throw new Error('freeSpotNear: the farm has no free tile');
}

/** `farm` with the workbench on `at`, which must be free ground; the tile becomes plain grass under it. */
export function withWorkbenchAt(farm: WorldState, at: TileCoord): WorldState {
  const tile = getTile(farm, at.tx, at.tz);
  invariant(tile !== null && isFreeGround(tile, at.tx, at.tz), `withWorkbenchAt: (${at.tx}, ${at.tz}) is not free ground`);
  return setTile(farm, at.tx, at.tz, { ...EMPTY_TILE, object: { kind: 'workbench' } });
}

/** The robot on the bench, or null. */
export function robotOnBench(state: GameState): Robot | null {
  return state.robots.list.find((robot) => robot.onBench) ?? null;
}
```

- [ ] **Step 5: The workbench on new farms**

In `src/state/initialState.ts`, replace Task 4's:

```ts
import { INVENTORY, PLAYER, TOOLS, UNLOCKS, WORLD } from '../config';
```

with:

```ts
import { INVENTORY, PLAYER, TOOLS, UNLOCKS, WORKBENCH, WORLD } from '../config';
```

replace:

```ts
import { generateMaps } from '../world/maps';
```

with:

```ts
import { withWorkbenchAt } from '../robots/workbench';
import { generateMaps } from '../world/maps';
```

and in `createInitialState`, replace:

```ts
  const time = createInitialTime();
  return {
```

with:

```ts
  const time = createInitialTime();
  const maps = generateMaps(seed);
  return {
```

and:

```ts
    maps: generateMaps(seed),
```

with:

```ts
    // The workbench is built into every farm (part 3 spec §2.1); its home is clear on every generated farm.
    maps: { ...maps, farm: withWorkbenchAt(maps.farm, WORKBENCH.home) },
```

- [ ] **Step 6: Intents (`src/state/intents.ts`)**

Replace:

```ts
import { requireRobot, robotsOnTile } from '../robots/world';
```

with:

```ts
import { robotOnBench } from '../robots/workbench';
import { requireRobot, robotsOnTile } from '../robots/world';
```

In `Intent`, replace:

```ts
  | { readonly kind: 'blocked'; readonly reason: string | null };
```

with:

```ts
  /** Put the carried robot on the empty workbench; its screen opens (farmclaws part 3 spec §2.2). */
  | { readonly kind: 'benchRobot'; readonly robotId: number; readonly name: string }
  /** Reopen the screen of the robot on the workbench. */
  | { readonly kind: 'openBench'; readonly robotId: number; readonly name: string }
  /** `hint`, when set, is the HUD hint of a plan that does nothing (the empty workbench). */
  | { readonly kind: 'blocked'; readonly reason: string | null; readonly hint?: string };
```

Insert directly above `/** Which tool lifts each pick-up-able placed object: the axe for wooden things, else the pickaxe. */`:

```ts
/** The pickaxe's and the axe's answer at the workbench, which is built into the farm (part 3 spec §2.1). */
const PART_OF_THE_FARM = "It's part of the farm.";

/** The empty workbench's hint and toast (part 3 spec §2.2). */
const EMPTY_BENCH = 'Bring a robot here to work on it';

```

In `planPickUp`, replace:

```ts
function planPickUp(state: GameState, target: TileCoord, object: PlacedObject, tool: 'pickaxe' | 'axe'): ActionPlan {
  if (!isPlaceableKind(object.kind) || PICKUP_TOOL[object.kind] !== tool) return blocked(target, tool);
```

with:

```ts
function planPickUp(state: GameState, target: TileCoord, object: PlacedObject, tool: 'pickaxe' | 'axe'): ActionPlan {
  if (object.kind === 'workbench') return blocked(target, tool, PART_OF_THE_FARM);
  if (!isPlaceableKind(object.kind) || PICKUP_TOOL[object.kind] !== tool) return blocked(target, tool);
```

In `planCarry`, replace:

```ts
  if (target === null || tile === null) return blocked(target, 'place', openGround);
  if (tile.blocker === Blocker.ShippingBin) {
```

with:

```ts
  if (target === null || tile === null) return blocked(target, 'place', openGround);
  if (tile.object !== null && tile.object.kind === 'workbench') {
    if (robotOnBench(state) !== null) return blocked(target, 'place', "There's already a robot on the bench.");
    return plan(target, { kind: 'benchRobot', robotId, name: robot.name }, 'place');
  }
  if (tile.blocker === Blocker.ShippingBin) {
```

and update `planCarry`'s doc comment from `/** While carrying: the shipping bin sends a broken robot for repair; open ground puts it down. */` to `/** While carrying: the empty workbench takes the robot, the shipping bin sends a broken robot for repair, open ground puts it down. */`.

Insert directly above `function planFuel(`:

```ts
/** E at the workbench while not carrying: reopen the screen of the robot on it, or say what the bench is for. */
function planBench(state: GameState, target: TileCoord): ActionPlan {
  const robot = robotOnBench(state);
  if (robot === null) return { target, intent: { kind: 'blocked', reason: EMPTY_BENCH, hint: EMPTY_BENCH }, feedback: 'none', energyCost: 0 };
  return plan(target, { kind: 'openBench', robotId: robot.id, name: robot.name }, 'none');
}

```

In `planInteraction`, replace:

```ts
  const pickUp = planPickUpRobot(state, target);
  if (pickUp !== null) return pickUp;
```

with:

```ts
  // The workbench comes before every robot rule, so the robot on it is never picked up (part 3 spec §2.2).
  if (tile.object !== null && tile.object.kind === 'workbench') return planBench(state, target);

  const pickUp = planPickUpRobot(state, target);
  if (pickUp !== null) return pickUp;
```

In `describeIntent`, replace:

```ts
    case 'fuel':
      return 'Load wood';
    case 'blocked':
      return null;
```

with:

```ts
    case 'fuel':
      return 'Load wood';
    case 'benchRobot':
      return `Put ${intent.name} on the bench`;
    case 'openBench':
      return `Work on ${intent.name}`;
    case 'blocked':
      return intent.hint ?? null;
```

(`executePlan` turns the empty bench's blocked plan into a `warn` toast with its reason and records a `'none'` action, as for every blocked plan with a reason; `ContextHint` shows its hint on the E chip.)

- [ ] **Step 7: Actions and the reducer**

**7a. `src/state/actions.ts`.** Replace Task 2's:

```ts
  /** Gives a robot a new .MD, through the checker. */
  | { readonly type: 'robot/md'; readonly robotId: number; readonly md: readonly MdCard[] };
```

with:

```ts
  /** Gives a robot a new .MD, through the checker. */
  | { readonly type: 'robot/md'; readonly robotId: number; readonly md: readonly MdCard[] }
  /** Lifts the robot on the workbench into the player's arms (farmclaws part 3 spec §2.2). */
  | { readonly type: 'robot/liftOff'; readonly robotId: number }
  /** The workbench's on/off switch (part 3 spec §2.4). */
  | { readonly type: 'robot/switch'; readonly robotId: number; readonly on: boolean };
```

and replace:

```ts
  setRobotMd: (robotId: number, md: readonly MdCard[]): GameAction => ({ type: 'robot/md', robotId, md }),
} as const;
```

with:

```ts
  setRobotMd: (robotId: number, md: readonly MdCard[]): GameAction => ({ type: 'robot/md', robotId, md }),
  liftOffBench: (robotId: number): GameAction => ({ type: 'robot/liftOff', robotId }),
  switchRobot: (robotId: number, on: boolean): GameAction => ({ type: 'robot/switch', robotId, on }),
} as const;
```

**7b. `src/state/reducer.ts`.** Replace:

```ts
import { periodFor, putDownPower } from '../robots/stats';
```

with:

```ts
import { carryEnergyFor, periodFor, putDownPower } from '../robots/stats';
```

In `gameReducer`, replace Task 2's:

```ts
    case 'robot/md':
      return editRobot(state, action.robotId, (robot) => withMd(robot, action.md), (name) => `Set ${name}'s .MD.`);
    default: {
```

with:

```ts
    case 'robot/md':
      return editRobot(state, action.robotId, (robot) => withMd(robot, action.md), (name) => `Set ${name}'s .MD.`);
    case 'robot/liftOff':
      return liftOffBench(state, action.robotId);
    case 'robot/switch':
      return switchRobot(state, action.robotId, action.on);
    default: {
```

In `applyIntent`, replace:

```ts
    case 'fuel': {
      const object = tile.object;
```

with:

```ts
    case 'benchRobot': {
      const robot = requireRobot(state, intent.robotId);
      const benched = withRobot(
        { ...state, player: { ...state.player, carrying: null } },
        { ...robot, carried: false, onBench: true, tx: target.tx, tz: target.tz, facing: state.player.facing, teleportSeq: robot.teleportSeq + 1 },
      );
      return { ...benched, ui: { ...benched.ui, panel: { kind: 'robot', robotId: robot.id, mode: 'bench' } } };
    }

    case 'openBench':
      return { ...state, ui: { ...state.ui, panel: { kind: 'robot', robotId: intent.robotId, mode: 'bench' } } };

    case 'fuel': {
      const object = tile.object;
```

In Task 2's `editRobot`, replace:

```ts
  const robot = findRobot(state, robotId);
  if (robot === null) return state;
  const edited = edit(robot);
```

with:

```ts
  const robot = findRobot(state, robotId);
  if (robot === null) return state;
  const away = offBenchRefusal(robot);
  if (away !== null) return pushMessage(state, away, 'warn');
  const edited = edit(robot);
```

and add to `editRobot`'s doc comment, after its first sentence: `The robot must be on the workbench (part 3 spec §4.7); the dev hooks call the edits directly and aren't limited to it.`

Insert directly above the doc comment of `loadState` (`/** Replaces the whole state (new game / loaded save): …`):

```ts
// ---------------------------------------------------------------------------
// The workbench (farmclaws part 3 spec §2.2, §2.4)
// ---------------------------------------------------------------------------

/** The robot screen's refusal for a robot that isn't on the workbench, or null when it is. */
function offBenchRefusal(robot: Robot): string | null {
  return robot.onBench ? null : `Put ${robot.name} on the workbench first.`;
}

/**
 * `robot/liftOff`: the robot on the bench goes into the player's arms for its carry energy, like a
 * pick-up, and its screen closes. Refused with part 1's too-tired text when energy is short (the
 * screen stays open), and silently for a robot not on the bench, while the player carries another
 * robot, or off the farm.
 */
function liftOffBench(state: GameState, robotId: number): GameState {
  const robot = findRobot(state, robotId);
  if (robot === null || !robot.onBench || state.player.carrying !== null || state.player.mapId !== 'farm') return state;
  const energy = carryEnergyFor(robot);
  if (state.player.energy < energy) return pushMessage(state, `You're too tired to carry ${robot.name}.`, 'warn');
  const lifted = withRobot(
    { ...state, player: { ...state.player, carrying: robot.id, energy: state.player.energy - energy } },
    { ...robot, onBench: false, carried: true },
  );
  const panel = lifted.ui.panel;
  return panel.kind === 'robot' && panel.robotId === robot.id ? { ...lifted, ui: { ...lifted.ui, panel: { kind: 'none' } } } : lifted;
}

/** Powers a robot may be switched off in: the save allows `off` only with these (part 2 spec §10.2, part 3 §9.2). */
const SWITCHABLE_POWERS: ReadonlySet<Robot['power']> = new Set<Robot['power']>(['working', 'standby', 'flat']);

/**
 * `robot/switch` (part 3 spec §2.4), free: off sets `off: 'player'` whatever it was; on clears
 * only 'player'. The robot must be on the bench. A robot that isn't working, standby or flat
 * can't be switched off (a broken robot needs its new core first), or the save wouldn't load.
 */
function switchRobot(state: GameState, robotId: number, on: boolean): GameState {
  const robot = findRobot(state, robotId);
  if (robot === null) return state;
  const away = offBenchRefusal(robot);
  if (away !== null) return pushMessage(state, away, 'warn');
  if (on) return robot.off === 'player' ? withRobot(state, { ...robot, off: null }) : state;
  if (!SWITCHABLE_POWERS.has(robot.power)) return pushMessage(state, `${robot.name} can't be switched off while it's broken.`, 'warn');
  return withRobot(state, { ...robot, off: 'player' });
}

```

(`Robot` and `findRobot` are already imported by Task 2. `selectIsFrozen` doesn't gate these two actions: the robot screen that sends them is a panel.)

- [ ] **Step 8: Running, standing and the morning**

**8a. `src/robots/run.ts`.** Replace:

```ts
/**
 * Whether `robot` takes a turn this minute: a working script robot (part 1), or a block-program
 * robot that is working or idle on standby and not off (part 2 spec §7, §8). Never while carried.
 */
function isDue(robot: Robot, minute: number): boolean {
  if (robot.carried || robot.nextActMinute > minute) return false;
  if (robot.program.kind === 'script') return robot.power === 'working';
  return robot.off === null && (robot.power === 'working' || robot.power === 'standby');
}
```

with:

```ts
/**
 * Whether `robot` takes a turn this minute: a working script robot (part 1), or a block-program
 * robot that is working or idle on standby (part 2 spec §7, §8). Never while carried, on the
 * workbench (part 3 spec §2.2) or off for any reason, scripts included (plan R2).
 */
function isDue(robot: Robot, minute: number): boolean {
  if (robot.carried || robot.onBench || robot.off !== null || robot.nextActMinute > minute) return false;
  if (robot.program.kind === 'script') return robot.power === 'working';
  return robot.power === 'working' || robot.power === 'standby';
}
```

**8b. `src/robots/world.ts`.** Replace:

```ts
/** Robots standing on a farm tile (not carried, not away for repair), lowest id first. */
export function robotsOnTile(state: GameState, tx: number, tz: number): readonly Robot[] {
  return state.robots.list.filter((r) => !r.carried && r.power !== 'repairing' && r.tx === tx && r.tz === tz);
}
```

with:

```ts
/** Robots standing on a farm tile (not carried, not on the workbench, not away for repair), lowest id first. */
export function robotsOnTile(state: GameState, tx: number, tz: number): readonly Robot[] {
  return state.robots.list.filter((r) => !r.carried && !r.onBench && r.power !== 'repairing' && r.tx === tx && r.tz === tz);
}
```

**8c. `src/robots/overnight.ts`.** In `resetForMorning` (as Task 3 left it), replace:

```ts
    const standable = tile !== null && (isWalkable(tile) || (robot.power === 'broken' && inWater));
```

with:

```ts
    // A robot on the workbench stays on it (part 3 spec §2.2); the bench tile itself isn't walkable.
    const standable = robot.onBench || (tile !== null && (isWalkable(tile) || (robot.power === 'broken' && inWater)));
```

and replace:

```ts
      exec,
      off: null,
    });
```

with:

```ts
      exec,
      // 'dizzy' and 'done' last until morning; the bench's switch lasts until it is switched on.
      off: robot.off === 'player' ? 'player' : null,
    });
```

In its doc comment, replace `Every robot is turned back on.` with `Every robot is turned back on, except one switched off at the bench; a robot on the workbench stays there.`

**8d. A new program keeps the switch (`src/robots/edits.ts`, plan refinement R15).** Reprogramming turns a dizzy or done robot back on, but a robot the player switched off stays off until it's switched on. In `programmedRobot`, replace:

```ts
    off: null,
    power: KEPT_POWERS.has(robot.power) ? robot.power : runs ? 'working' : 'standby',
```

with:

```ts
    // A new program clears 'dizzy' and 'done'; only the bench's switch turns a 'player' robot on.
    off: robot.off === 'player' ? 'player' : null,
    power: KEPT_POWERS.has(robot.power) ? robot.power : runs ? 'working' : 'standby',
```

Add to `tests/robotEdits.test.ts`, inside `describe('programmedRobot', …)` (import `b` from `../src/robots/blocks` if the file doesn't already):

```ts
  it('keeps a robot the player switched off switched off', () => {
    const program = b.program({ stacks: [b.when(b.morning(), b.move())] });
    const next = programmedRobot(robotOf({ power: 'standby', off: 'player' }), program, 900);
    expect(typeof next).not.toBe('string');
    expect(next).toMatchObject({ off: 'player', program });
  });
```

Run: `npx vitest run tests/robotEdits.test.ts`
Expected: PASS.

- [ ] **Step 9: Save validation and the migration**

**9a. `src/state/robotValidation.ts`.** In `ROBOT_KEYS`, replace:

```ts
  'id', 'name', 'size', 'parts', 'tx', 'tz', 'facing', 'bag', 'tank', 'tokens', 'power', 'carried', 'program', 'pc',
```

with:

```ts
  'id', 'name', 'size', 'parts', 'tx', 'tz', 'facing', 'bag', 'tank', 'tokens', 'power', 'carried', 'onBench', 'program', 'pc',
```

Insert directly after the closing `}` of `burnersOnlyOnFarm`:

```ts

/** Exactly one workbench, on the farm (part 3 spec §9.2). */
function oneWorkbench(maps: GameState['maps']): boolean {
  let onFarm = 0;
  let elsewhere = 0;
  for (const id of MAP_IDS) {
    forEachTile(maps[id], (tile) => {
      if (tile.object?.kind !== 'workbench') return;
      if (id === 'farm') onFarm++;
      else elsewhere++;
    });
  }
  return onFarm === 1 && elsewhere === 0;
}
```

In `isValidRobot`, replace:

```ts
  if (!isOneOf(v.power, ROBOT_POWERS) || !isBool(v.carried)) return false;
```

with:

```ts
  if (!isOneOf(v.power, ROBOT_POWERS) || !isBool(v.carried) || !isBool(v.onBench)) return false;
```

replace:

```ts
  if (!(v.off === null || v.off === 'dizzy' || v.off === 'done')) return false;
```

with:

```ts
  if (!isOneOf(v.off, [null, 'dizzy', 'done', 'player'])) return false;
```

and replace:

```ts
  if (v.power === 'repairing') return isCount(v.repairReadyDay) && !v.carried;
  if (v.repairReadyDay !== null) return false;
  if (v.carried) return true;
  const tile = getTile(farm, v.tx, v.tz);
  if (tile === null) return false;
```

with:

```ts
  // A robot on the bench is never carried or away for repairs (part 3 spec §9.2).
  if (v.onBench && (v.carried || v.power === 'repairing')) return false;
  if (v.power === 'repairing') return isCount(v.repairReadyDay) && !v.carried;
  if (v.repairReadyDay !== null) return false;
  if (v.carried) return true;
  const tile = getTile(farm, v.tx, v.tz);
  if (tile === null) return false;
  // On the bench means on the workbench tile, where part 1's walkable rule doesn't apply; no other robot stands there.
  const onWorkbench = tile.object !== null && tile.object.kind === 'workbench';
  if (v.onBench || onWorkbench) return v.onBench && onWorkbench;
```

In `isValidRobotsSection`, replace:

```ts
  let previous = 0;
  let carried = 0;
```

with:

```ts
  let previous = 0;
  let carried = 0;
  let benched = 0;
```

replace:

```ts
    previous = robot.id;
    if (robot.carried === true) {
```

with:

```ts
    previous = robot.id;
    if (robot.onBench === true) benched++;
    if (robot.carried === true) {
```

replace:

```ts
  if (carried !== (player.carrying === null ? 0 : 1)) return false;
```

with:

```ts
  if (carried !== (player.carrying === null ? 0 : 1) || benched > 1) return false;
```

and replace:

```ts
  return isValidLog(v.log, maps.farm) && burnersOnlyOnFarm(maps);
```

with:

```ts
  return isValidLog(v.log, maps.farm) && burnersOnlyOnFarm(maps) && oneWorkbench(maps);
```

Also update `isValidRobotsSection`'s doc comment (it wraps lines inside the clause): after the clause ending `the player is on the farm;` add ` at most one robot is on the bench; exactly one workbench stands on the farm;`.

**9b. `src/state/persistence.ts`.** Replace Task 4's:

```ts
import { INVENTORY, TIME, UNLOCKS } from '../config';
```

with:

```ts
import { INVENTORY, TIME, UNLOCKS, WORKBENCH } from '../config';
```

in the `../core/types` import replace:

```ts
  type MapId,
  type WorldState,
```

with:

```ts
  type MapId,
  type TileCoord,
  type WorldState,
```

replace:

```ts
import { calendarTime } from '../time/clock';
```

with:

```ts
import { freeSpotNear, withWorkbenchAt } from '../robots/workbench';
import { calendarTime } from '../time/clock';
```

replace:

```ts
function isValidWorld(world: unknown, id: MapId): world is WorldState {
```

with:

```ts
export function isValidWorld(world: unknown, id: MapId): world is WorldState {
```

In Task 3's `migrateRobotV5`, replace:

```ts
  return { ...rest, stats: { today: { tokens: tokensToday, actions: 0, crops: 0 }, week: { tokens: tokensToday, actions: 0, crops: 0 } } };
```

with:

```ts
  return { ...rest, onBench: false, stats: { today: { tokens: tokensToday, actions: 0, crops: 0 }, week: { tokens: tokensToday, actions: 0, crops: 0 } } };
```

(and in its doc comment, after `with no actions or crops counted` add `, and off the bench`). Replace Task 4's:

```ts
  return { ...save, version: 6, robots: { ...robots, list, unlocks: UNLOCKS.job1 } };
}
```

with:

```ts
  return placeWorkbenchV6({ ...save, version: 6, robots: { ...robots, list, unlocks: UNLOCKS.job1 } });
}

/**
 * The workbench for a migrated farm (part 3 spec §2.1): WORKBENCH.home, or the nearest free farm
 * tile when the player built something there. Standing robots (not carried, not away for repairs)
 * and the player, when on the farm, take their tiles. A malformed farm passes through without one,
 * so the validator rejects the save.
 */
function placeWorkbenchV6(save: Obj): Obj {
  const maps = save.maps;
  const robots = save.robots;
  if (!isObj(maps) || !isObj(robots) || !Array.isArray(robots.list)) return save;
  const farm: unknown = maps.farm;
  if (!isValidWorld(farm, 'farm')) return save;
  const taken: TileCoord[] = [];
  for (const robot of robots.list as readonly unknown[]) {
    if (isObj(robot) && robot.carried !== true && robot.power !== 'repairing' && isInt(robot.tx) && isInt(robot.tz)) taken.push({ tx: robot.tx, tz: robot.tz });
  }
  const player = save.player;
  if (isObj(player) && player.mapId === 'farm' && isInt(player.tx) && isInt(player.tz)) taken.push({ tx: player.tx, tz: player.tz });
  return { ...save, maps: { ...maps, farm: withWorkbenchAt(farm, freeSpotNear(farm, WORKBENCH.home, taken)) } };
}
```

and in `migrateV5toV6`'s doc comment, replace `and the robots section gains job 1's unlocks.` with `the robots section gains job 1's unlocks, and the farm gains its workbench.`

- [ ] **Step 10: Rendering**

**10a. `src/render/objectGeometry.ts`.** Replace:

```ts
import { HEIGHTS } from './constants';
```

with:

```ts
import { WORKBENCH } from '../config';
import { HEIGHTS } from './constants';
```

In `OBJECT_COLORS`, replace:

```ts
  archLeaf: 0x6fb86a,
} as const;
```

with:

```ts
  archLeaf: 0x6fb86a,
  benchTop: 0xc8955c,
  benchTopEdge: 0xa87545,
  benchLeg: 0x8c6440,
  pegboard: 0xe0c493,
  viceIron: 0x5e6670,
  toolSteel: 0xb8c0c8,
  toolHandle: 0xd9534a,
} as const;
```

Insert directly above the banner that opens the scarecrow section (`// ---…` / `// Scarecrow` / `// ---…`):

```ts
// ---------------------------------------------------------------------------
// Workbench
// ---------------------------------------------------------------------------

/** The bench's footprint and timber, in tiles; its top surface is at WORKBENCH.topHeight. */
export const WORKBENCH_SHAPE = { width: 0.84, depth: 0.6, top: 0.06, leg: 0.06 } as const;

/**
 * A low-poly workbench (part 3 spec §2.1): a thick top on four legs with a shelf between them, a
 * vice on the front right corner, and a pegboard along the back holding a hammer, a wrench and a
 * screwdriver. A robot on the bench stands on the top (RobotRenderer, robotLayout.benchLift).
 */
export function createWorkbenchGeometry(): THREE.BufferGeometry {
  const C = OBJECT_COLORS;
  const S = WORKBENCH_SHAPE;
  const top = WORKBENCH.topHeight;
  const legHeight = top - S.top;
  const back = -S.depth / 2;
  const parts = [
    box(S.width, S.top, S.depth, { y: top - S.top / 2 }, C.benchTop),
    box(S.width + 0.01, 0.015, S.depth + 0.01, { y: top - S.top + 0.0075 }, C.benchTopEdge),
    box(S.width - 2 * S.leg, 0.03, S.depth - 2 * S.leg, { y: 0.16 }, C.benchLeg),
    // Vice: fixed jaw, moving jaw and its screw handle.
    box(0.12, 0.08, 0.1, { x: 0.3, y: top + 0.04, z: 0.2 }, C.viceIron),
    box(0.12, 0.06, 0.03, { x: 0.3, y: top + 0.03, z: 0.27 }, C.viceIron),
    box(0.14, 0.015, 0.015, { x: 0.3, y: top + 0.03, z: 0.295 }, C.toolSteel),
    // Pegboard, then a hammer, a wrench and a screwdriver hanging on it.
    box(0.7, 0.34, 0.03, { y: top + 0.17, z: back + 0.015 }, C.pegboard),
    box(0.02, 0.16, 0.015, { x: -0.2, y: top + 0.15, z: back + 0.04 }, C.benchLeg),
    box(0.08, 0.03, 0.02, { x: -0.2, y: top + 0.24, z: back + 0.04 }, C.viceIron),
    box(0.025, 0.18, 0.012, { x: 0, y: top + 0.16, z: back + 0.04 }, C.toolSteel),
    box(0.06, 0.03, 0.012, { x: 0, y: top + 0.26, z: back + 0.04 }, C.toolSteel),
    box(0.03, 0.07, 0.02, { x: 0.2, y: top + 0.23, z: back + 0.04 }, C.toolHandle),
    box(0.01, 0.1, 0.01, { x: 0.2, y: top + 0.145, z: back + 0.04 }, C.toolSteel),
  ];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      parts.push(box(S.leg, legHeight, S.leg, { x: sx * (S.width / 2 - S.leg), y: legHeight / 2, z: sz * (S.depth / 2 - S.leg) }, C.benchLeg));
    }
  }
  return mergeParts(parts, 'workbench');
}

```

In `OBJECT_PART_IDS`, replace:

```ts
  'flowerArch',
] as const;
```

with:

```ts
  'flowerArch',
  'workbench',
] as const;
```

in `OBJECT_PARTS`, replace:

```ts
  flowerArch: part('decoration', 'painted', createFlowerArchGeometry),
};
```

with:

```ts
  flowerArch: part('decoration', 'painted', createFlowerArchGeometry),
  workbench: part('workbench', 'painted', createWorkbenchGeometry),
};
```

and in `objectPartsFor`, replace:

```ts
    case 'decoration':
      return DECORATION_PARTS[object.variant];
```

with:

```ts
    case 'decoration':
      return DECORATION_PARTS[object.variant];
    case 'workbench':
      return ['workbench'];
```

**10b. `src/render/objectLayout.ts`.** In `objectLook`, replace:

```ts
    case 'stonePath':
      return { kind: object.kind, variant: '' };
```

with:

```ts
    case 'stonePath':
    case 'workbench':
      return { kind: object.kind, variant: '' };
```

**10c. `src/render/TileHighlighter.ts`.** In `BOX_HEIGHT.object`, replace:

```ts
    decoration: 1.0,
  } satisfies Readonly<Record<PlacedObjectKind, number>>,
```

with:

```ts
    decoration: 1.0,
    workbench: 1.1,
  } satisfies Readonly<Record<PlacedObjectKind, number>>,
```

**10d. `src/render/robotLayout.ts`.** Replace:

```ts
import { TIME } from '../config';
```

with:

```ts
import { TIME, WORKBENCH } from '../config';
```

and insert directly above the banner `// Carrying, badge and sparks (spec §7.4)` (its leading `// ---…` line):

```ts
/** How far above its tile's ground a robot stands: on the bench top while it is on the workbench (part 3 spec §2.1). */
export function benchLift(robot: Pick<Robot, 'onBench'>): number {
  return robot.onBench ? WORKBENCH.topHeight : 0;
}

```

**10e. `src/render/RobotRenderer.ts`.** In the `./robotLayout` import, replace:

```ts
  STILL,
  clipFor,
```

with:

```ts
  STILL,
  benchLift,
  clipFor,
```

replace:

```ts
function groundOf(state: GameState, robot: Robot): number {
  const tile = getTile(state.maps.farm, robot.tx, robot.tz);
```

with:

```ts
function groundOf(state: GameState, robot: Robot): number {
  // The workbench stands on plain grass; a robot on it stands on its top.
  if (robot.onBench) return HEIGHTS.grassTop + benchLift(robot);
  const tile = getTile(state.maps.farm, robot.tx, robot.tz);
```

and in `animate`, replace:

```ts
      // pose.sink is absolute (the broken sink is 0.25 tile at every size).
      y = v.groundY - pose.sink + clip.dip + bob;
```

with:

```ts
      // pose.sink is absolute (the broken sink is 0.25 tile at every size); nothing sinks into the bench top.
      y = v.groundY - (robot.onBench ? 0 : pose.sink) + clip.dip + bob;
```

Add to the header comment's list: ` * - A robot on the workbench stands on the bench top (robotLayout.benchLift); benching it bumps teleportSeq, so it snaps there.`

- [ ] **Step 11: Test helpers**

In `tests/testUtils.ts`, replace Task 4's:

```ts
import { INVENTORY, TIME, UNLOCKS } from '../src/config';
```

with:

```ts
import { INVENTORY, TIME, UNLOCKS, WORKBENCH } from '../src/config';
```

In `robotOf`, replace:

```ts
    carried: false,
    program: { kind: 'script', steps: [{ kind: 'turn', side: 'right' }], loop: true },
```

with:

```ts
    carried: false,
    onBench: false,
    program: { kind: 'script', steps: [{ kind: 'turn', side: 'right' }], loop: true },
```

insert directly after the closing `}` of `robotOf`:

```ts

/** robotOf standing on the workbench (farmclaws part 3): `onBench`, on WORKBENCH.home. */
export function benchedRobotOf(overrides: Partial<Robot> = {}): Robot {
  return robotOf({ onBench: true, tx: WORKBENCH.home.tx, tz: WORKBENCH.home.tz, ...overrides });
}
```

and in `v5Save`, replace Task 4's:

```ts
  delete robots.unlocks;
  return save;
```

with:

```ts
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
  return save;
```

(`legacySave` starts from `v5Save` since Task 1, so v1 and v2 saves carry no workbench either; its "no placed objects" check keeps passing, and the migration puts the workbench back on its home tile with the same chunk revision.)

- [ ] **Step 12: Existing tests that see the workbench on every farm**

Each edit below is the whole change to that file (checked by running the suite with the workbench in place: these are exactly the tests it breaks).

- `tests/objectLayout.test.ts`:
  - line 11: `import { INVENTORY } from '../src/config';` → `import { INVENTORY, WORKBENCH } from '../src/config';`
  - in `SAMPLES`, replace
    ```ts
      decoration: { kind: 'decoration', variant: 'stoneLantern' },
    };
    ```
    with
    ```ts
      decoration: { kind: 'decoration', variant: 'stoneLantern' },
      workbench: { kind: 'workbench' },
    };
    ```
  - replace the line `describe('ObjectRenderer', () => {` with
    ```ts
    describe('ObjectRenderer', () => {
      /** The new farm without its workbench, so each test counts only the objects it places. */
      const FARM = withTile(BASE, WORKBENCH.home, EMPTY_TILE, 'farm');
    ```
    and inside that `describe` replace every `BASE` with `FARM`: lines 422, 493, 511, 525, 526, 527 (`renderer.sync(next, BASE);`), 536, 545, 583, 607, 632 and 643 (12 occurrences; the new `FARM` line itself keeps `BASE`).
- `tests/tiles.test.ts`, in `SAMPLE_OBJECTS` (line 326), replace
  ```ts
    decoration: { kind: 'decoration', variant: 'stoneLantern' },
  };
  ```
  with
  ```ts
    decoration: { kind: 'decoration', variant: 'stoneLantern' },
    workbench: { kind: 'workbench' },
  };
  ```
- `tests/renderMaps.test.ts`:
  - in `SAMPLE_OBJECTS` (line 51), replace
    ```ts
      decoration: { kind: 'decoration', variant: 'paperLantern' },
    };
    ```
    with
    ```ts
      decoration: { kind: 'decoration', variant: 'paperLantern' },
      workbench: { kind: 'workbench' },
    };
    ```
  - in "checks a placed object first, with per-kind heights and paths as ground", replace
    ```ts
          decoration: 1.0,
        };
    ```
    with
    ```ts
          decoration: 1.0,
          workbench: 1.1,
        };
    ```
- `tests/maps.test.ts`:
  - line 10: replace `import { LAYOUT, PLAYER, SHADE, TOOLS, WORLD } from '../src/config';` with
    ```ts
    import { LAYOUT, PLAYER, SHADE, TOOLS, WORKBENCH, WORLD } from '../src/config';
    import { withWorkbenchAt } from '../src/robots/workbench';
    ```
  - line 104: `    expect(BASE.maps.farm).toEqual(generateMaps(WORLD.seed).farm);` → `    expect(BASE.maps.farm).toEqual(withWorkbenchAt(generateMaps(WORLD.seed).farm, WORKBENCH.home));`
  - line 858 (in "generates the forest and the town from the save seed"): replace `    expect(loaded.maps).toEqual(generateMaps(seed));` with
    ```ts
        const maps = generateMaps(seed);
        expect(loaded.maps).toEqual({ ...maps, farm: withWorkbenchAt(maps.farm, WORKBENCH.home) });
    ```
- `tests/worldgen.test.ts`:
  - line 10: replace `import { LAYOUT, PLAYER, TOOLS, WORLD, type FarmLayout } from '../src/config';` with
    ```ts
    import { LAYOUT, PLAYER, TOOLS, WORKBENCH, WORLD, type FarmLayout } from '../src/config';
    import { withWorkbenchAt } from '../src/robots/workbench';
    ```
  - lines 38–39: replace
    ```ts
        expect(createInitialState().maps.farm).toEqual(MAPS.farm.generate(WORLD.seed));
        expect(createInitialState(7).maps.farm).toEqual(MAPS.farm.generate(7));
    ```
    with
    ```ts
        expect(createInitialState().maps.farm).toEqual(withWorkbenchAt(MAPS.farm.generate(WORLD.seed), WORKBENCH.home));
        expect(createInitialState(7).maps.farm).toEqual(withWorkbenchAt(MAPS.farm.generate(7), WORKBENCH.home));
    ```
- `tests/sections.test.ts`:
  - Task 4's import `import { APPEARANCE, INVENTORY, LAYOUT, PROFILE, TOOLS, UNLOCKS } from '../src/config';` → `import { APPEARANCE, INVENTORY, LAYOUT, PROFILE, TOOLS, UNLOCKS, WORKBENCH } from '../src/config';`
  - in "gives a version-2 save the section defaults and plain tiles", replace
    ```ts
        forEachTile(loaded.maps.farm, (tile) => {
          expect(tile.object).toBeNull();
    ```
    with
    ```ts
        forEachTile(loaded.maps.farm, (tile, tx, tz) => {
          expect(tile.object).toEqual(tx === WORKBENCH.home.tx && tz === WORKBENCH.home.tz ? { kind: 'workbench' } : null);
    ```
- `tests/persistence.test.ts` (the real v1 and v2 fixtures get their workbench at home, where both are plain grass):
  - line 11: `import { INVENTORY, PLAYER, TIME } from '../src/config';` → `import { INVENTORY, PLAYER, TIME, WORKBENCH } from '../src/config';`
  - in "version %i: keeps every farm tile exactly, apart from the carved gate debris", replace
    ```ts
          // Chunk layout and revision survive unchanged.
          expect(geometry).toEqual(oldGeometry);
          chunk.tiles.forEach((tile, i) => {
            const oldTile = must(old.tiles[i]);
            const tx = chunk.x0 + (i % chunk.width);
            const tz = chunk.z0 + Math.floor(i / chunk.width);
    ```
    with
    ```ts
          // Chunk layout and revision survive unchanged, but for the chunk the workbench was added to.
          const bench = locateTile(farm.grid, WORKBENCH.home.tx, WORKBENCH.home.tz);
          expect(geometry).toEqual(ci === bench.chunkIndex ? { ...oldGeometry, revision: (old.revision as number) + 1 } : oldGeometry);
          chunk.tiles.forEach((tile, i) => {
            const oldTile = must(old.tiles[i]);
            const tx = chunk.x0 + (i % chunk.width);
            const tz = chunk.z0 + Math.floor(i / chunk.width);
            if (tx === WORKBENCH.home.tx && tz === WORKBENCH.home.tz) {
              expect(tile).toEqual({ ...EMPTY_TILE, object: { kind: 'workbench' } });
              return;
            }
    ```

`tests/robotSave.test.ts` ("migrates a version-3 save …") and `tests/robotSaveV5.test.ts` ("migrates a version-4 save …") need no edit: since Task 1 they start from `v5Save`, which now takes the workbench off, and the v6 step puts it back at home with the same chunk revision.

- [ ] **Step 13: Run them and see them pass**

Run: `npx vitest run tests/robotBench.test.ts tests/robotSaveV6.test.ts tests/robotEdits.test.ts tests/objectLayout.test.ts tests/tiles.test.ts tests/renderMaps.test.ts tests/maps.test.ts tests/worldgen.test.ts tests/sections.test.ts tests/persistence.test.ts tests/robotSave.test.ts tests/robotSaveV5.test.ts tests/robotInteract.test.ts tests/robotOvernight.test.ts tests/robotRun.test.ts`
Expected: PASS (`robotBench.test.ts`: 23 tests; `robotSaveV6.test.ts`: 39; `robotEdits.test.ts`: Task 2's count + 3, so 33). `objectLayout.test.ts`'s "builds every part flat-shaded, standing on the ground inside its footprint" now also checks the workbench part (it stays within ±0.42 tile and starts at y = 0).

- [ ] **Step 14: The full gate**

Run: `npm run typecheck && npm test && npm run build`
Expected: all green.

- [ ] **Step 15: Commit**

```bash
git add src/robots/workbench.ts src/robots/create.ts src/core/types.ts src/config.ts src/state/validation.ts src/state/initialState.ts src/state/intents.ts src/state/actions.ts src/state/reducer.ts src/robots/run.ts src/robots/world.ts src/robots/overnight.ts src/state/robotValidation.ts src/state/persistence.ts src/render/objectGeometry.ts src/render/objectLayout.ts src/render/TileHighlighter.ts src/render/robotLayout.ts src/render/RobotRenderer.ts tests/testUtils.ts tests/robotBench.test.ts tests/robotSaveV6.test.ts tests/robotEdits.test.ts tests/objectLayout.test.ts tests/tiles.test.ts tests/renderMaps.test.ts tests/maps.test.ts tests/worldgen.test.ts tests/sections.test.ts tests/persistence.test.ts src/robots/edits.ts
git commit -m "Farmclaws part 3: the workbench, the bench and the on/off switch

Every farm has a workbench at (6, 4), placed by createInitialState and by the v6
migration (or on the nearest free tile when the player built at home). Carrying a
robot to it benches the robot and opens its screen; E reopens it, Lift off carries it
away for carry energy, and the switch sets off: 'player', which survives the morning.
Benched and switched-off robots are never due (scripts too, plan R2), never block a
tile and stay on the bench overnight. Program and .MD edits need the robot on the
bench. The empty bench's hint comes from an optional hint on the blocked intent.
Switching off is refused for a robot that isn't working, standby or flat. A new
program keeps off: 'player' (plan R15): only the switch turns that robot back on.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Bumps

**Files:**
- Create: `src/robots/bumps.ts`
- Modify: `src/core/types.ts` (`ROBOT_LOG_EVENT_KINDS` ~line 624, `RobotLogEvent` ~line 642)
- Modify: `src/robots/execute.ts` (imports ~lines 33–35; new `applyBumpPlan` above `chargeWake`, ~line 193)
- Modify: `src/robots/run.ts` (import line 7; `runRobotsMinute` doc and loop, ~lines 70–117)
- Modify: `src/robots/logText.ts` (`robotSays` ~line 111, `whatHappened` ~line 198)
- Modify: `src/state/robotValidation.ts` (`isLoggedTrigger` doc ~line 503, `isValidLogEvent` ~line 545)
- Modify: `src/robots/eval.ts` (import ~line 30, `tileAheadIs` ~lines 143–151)
- Modify: `src/state/intents.ts` (`planCarry`, ~lines 362–365)
- Modify: `src/robots/world.ts` (`nearestWalkable`, ~lines 64–82)
- Modify: `src/robots/overnight.ts` (import line 14, `returnRepaired` ~lines 60–66, `resetForMorning` ~line 149)
- Modify: `src/dev/robotDev.ts` (`presetSpecs`, ~lines 37–59)
- Test: `tests/robotBump.test.ts` (create), `tests/robotLogText.test.ts` (extend `everyEvent`)

**Interfaces:**
- Consumes:
  - Task 3: `pay(state, robotId, cost, counts: Partial<RobotStatCounts> = {})` (private in `execute.ts`; counts the tokens and `counts`), `Robot.stats`.
  - Task 5: `robotsOnTile(state, tx, tz)` excludes benched robots; `isDue` is false for every robot whose `off` isn't null (R2), so a bumped script robot really stops; `resetForMorning` clears `'dizzy'`.
  - Task 2: `programmed(robot, program, md?)` in `tests/programGen.ts` (now built on `src/robots/edits.ts`).
- Produces:
  - `src/core/types.ts`: `'crashed'` in `ROBOT_LOG_EVENT_KINDS`; `RobotLogEvent` gains `{ readonly kind: 'crashed'; readonly withId: number; readonly forgot: Trigger | null }`.
  - `src/robots/bumps.ts`: `export interface MoveIntent { readonly id: number; readonly from: TileCoord; readonly to: TileCoord }`; `export function findBumps(state: GameState, moves: readonly MoveIntent[]): ReadonlyMap<number, number>`; `export function forgetRunningStack(robot: Robot): { readonly robot: Robot; readonly forgot: Trigger | null }`.
  - `src/robots/execute.ts`: `export function applyBumpPlan(state: GameState, robotId: number, plan: RobotPlan, withId: number, exec: RobotExec | null = null): GameState`.
  - `src/robots/world.ts`: `export function nearestFreeWalkable(state: GameState, from: TileCoord, selfId: number): TileCoord`.
  - `src/dev/robotDev.ts`: `export function presetSpecs(id: RobotPresetId, place: RobotPlace): RobotSpec[]` (exported for the test; the `pair` preset no longer moves).
  - `runRobotsMinute`, `planCarry`, `evaluate`, `whatHappened`, `robotSays` and `runRobotsOvernight` keep their signatures.

Rules this task fixes (spec §3.1):
- `findBumps` reads the start-of-minute `state`. In order: every move sharing its target with another move bumps (into the lowest other id with that target); then every remaining move whose target is another move's start and vice versa bumps (into that robot); then, repeated until nothing changes, a remaining move whose target holds a standing robot (`robotsOnTile`) that has no move or whose move bumped, bumps into the lowest such id. A move out of a tile is never a bump, so robots already sharing a tile in a v5 save may leave it.
- `applyBumpPlan` pays the move through `pay(…, { actions: 1 })`, forgets the running stack of the exec the turn committed, logs `crashed`, settles as a failed action (`success: false`, `bickered: false`, a script's `pc` advances like any failed step), stops the exec (`running: null`, `frames: []`), sets `off: 'dizzy'` and toasts. The robot bumped into is untouched.
- Re-planning in id order still happens for every other choice, and never decides a bump.

- [ ] **Step 1: Write the failing test `tests/robotBump.test.ts`**

```ts
/**
 * Bumps (farmclaws part 3 spec §3.1): robots no longer pass through each other. Same-target,
 * swap and into-a-standing-robot bumps, decided from the start of the minute whatever the ids; a
 * line of robots moving the same way moves as one; the forgotten stack; the log, toast and texts;
 * `tile ahead is blocked` seeing robots; put-down, drop-off and morning moves avoiding robots;
 * the `pair` dev preset (plan review focus 2).
 */
import { describe, expect, it } from 'vitest';
import { ROBOTS } from '../src/config';
import { Blocker, Direction, TileState, type GameState, type Robot, type RobotAction, type RobotLogEvent } from '../src/core/types';
import { presetSpecs } from '../src/dev/robotDev';
import { b } from '../src/robots/blocks';
import { findBumps, forgetRunningStack } from '../src/robots/bumps';
import { addRobot } from '../src/robots/create';
import { evaluate } from '../src/robots/eval';
import { robotSays, whatHappened } from '../src/robots/logText';
import { nearestFreeWalkable, requireRobot } from '../src/robots/world';
import { actions } from '../src/state/actions';
import { deserializeGame, serializeGame } from '../src/state/persistence';
import { gameReducer } from '../src/state/reducer';
import { isValidExec } from '../src/state/robotValidation';
import { blockedTile } from '../src/world/tiles';
import { programmed } from './programGen';
import { BASE, TARGET, matureCrop, robotOf, soilTile, withPlayer, withRobots, withTile, type SaveJson } from './testUtils';

const ROW = 12;
const script = (steps: RobotAction[]): Robot['program'] => ({ kind: 'script', steps, loop: true });
const MOVER = script([{ kind: 'move' }]);
const SPINNER = script([{ kind: 'turn', side: 'right' }]);
const NAMES = ['Sprocket', 'Bolt', 'Cog', 'Dot'] as const;

/** A Mini on row 12 at `tx`, facing `facing`, running `program` (moving forward by default). */
function bot(id: number, tx: number, facing: Direction, overrides: Partial<Robot> = {}): Robot {
  return robotOf({ id, name: NAMES[id - 1] ?? `R${id}`, tx, tz: ROW, facing, program: MOVER, ...overrides });
}

/** The robots on the farm, in id order (the list is kept ascending). */
const farmWith = (robots: readonly Robot[], base: GameState = BASE): GameState => withRobots(base, [...robots].sort((a, c) => a.id - c.id));
const tick = (state: GameState, minutes: number = ROBOTS.period): GameState => gameReducer(state, actions.tick(minutes));
const sleep = (state: GameState): GameState => gameReducer(state, actions.sleep());
const eventsOf = (state: GameState, id: number): RobotLogEvent[] => state.robots.log.entries.filter((e) => e.robotId === id).map((e) => e.event);
const texts = (state: GameState): string[] => state.messages.entries.map((m) => m.text);
const at = (state: GameState, id: number): [number, number] => {
  const robot = requireRobot(state, id);
  return [robot.tx, robot.tz];
};
const loadedFrom = (state: GameState): GameState => ({ ...state, ui: { ...state.ui, panel: { kind: 'none' }, paused: false } });

describe('who bumps', () => {
  it.each([
    ['the leader has the lower id', 1, 2],
    ['the leader has the higher id', 2, 1],
  ])('moves a convoy as one when %s', (_label, leader, follower) => {
    const tail = 3;
    const state = farmWith([bot(leader, 5, Direction.East), bot(follower, 4, Direction.East), bot(tail, 3, Direction.East)]);
    const next = tick(state);
    expect([at(next, leader), at(next, follower), at(next, tail)]).toEqual([
      [6, ROW],
      [5, ROW],
      [4, ROW],
    ]);
    for (const id of [1, 2, 3]) expect(requireRobot(next, id)).toMatchObject({ off: null, lastAction: { seq: 1, kind: 'move', success: true, bickered: false } });
    expect(next.robots.log.entries.some((e) => e.event.kind === 'crashed')).toBe(false);
  });

  it('bumps every robot moving onto the same tile, each into the lowest other id', () => {
    const state = farmWith([bot(1, 4, Direction.East), bot(2, 6, Direction.West), robotOf({ id: 3, name: 'Cog', tx: 5, tz: ROW - 1, facing: Direction.South, program: MOVER })]);
    const next = tick(state);
    expect([at(next, 1), at(next, 2), at(next, 3)]).toEqual([
      [4, ROW],
      [6, ROW],
      [5, ROW - 1],
    ]);
    expect(eventsOf(next, 1)).toEqual([{ kind: 'crashed', withId: 2, forgot: null }]);
    expect(eventsOf(next, 2)).toEqual([{ kind: 'crashed', withId: 1, forgot: null }]);
    expect(eventsOf(next, 3)).toEqual([{ kind: 'crashed', withId: 1, forgot: null }]);
  });

  it('bumps two robots that would swap tiles, into each other', () => {
    const next = tick(farmWith([bot(1, 4, Direction.East), bot(2, 5, Direction.West)]));
    expect([at(next, 1), at(next, 2)]).toEqual([
      [4, ROW],
      [5, ROW],
    ]);
    expect(eventsOf(next, 1)).toEqual([{ kind: 'crashed', withId: 2, forgot: null }]);
    expect(eventsOf(next, 2)).toEqual([{ kind: 'crashed', withId: 1, forgot: null }]);
  });

  it('bumps a robot moving into one that stays, and leaves the one it bumped into alone', () => {
    const spinner = bot(2, 5, Direction.North, { program: SPINNER });
    const next = tick(farmWith([bot(1, 4, Direction.East), spinner]));
    expect(at(next, 1)).toEqual([4, ROW]);
    expect(requireRobot(next, 2)).toMatchObject({ tx: 5, tz: ROW, facing: Direction.East, off: null, tokens: 79, lastAction: { kind: 'turn', success: true } });
    expect(eventsOf(next, 1)).toEqual([{ kind: 'crashed', withId: 2, forgot: null }]);
    expect(eventsOf(next, 2)).toEqual([{ kind: 'did', action: 'turn', detail: { kind: 'none' } }]);
  });

  it.each([
    ['the robot that stays has the lowest id', [3, 1, 2]],
    ['the robot that stays has the highest id', [1, 2, 3]],
  ] as const)('bumps a whole line behind a robot that stays, whatever the ids, when %s', (_label, [stays, near, far]) => {
    const state = farmWith([bot(stays, 6, Direction.East, { power: 'standby' }), bot(near, 5, Direction.East), bot(far, 4, Direction.East)]);
    const next = tick(state);
    expect([at(next, stays), at(next, near), at(next, far)]).toEqual([
      [6, ROW],
      [5, ROW],
      [4, ROW],
    ]);
    expect(eventsOf(next, near)).toEqual([{ kind: 'crashed', withId: stays, forgot: null }]);
    expect(eventsOf(next, far)).toEqual([{ kind: 'crashed', withId: near, forgot: null }]);
    expect(eventsOf(next, stays)).toEqual([]);
  });

  it('bumps into broken robots in the water but never into carried or repairing ones', () => {
    const pond = withTile(BASE, { tx: 5, tz: ROW }, blockedTile(Blocker.Water), 'farm');
    const sunk = tick(farmWith([bot(1, 4, Direction.East), bot(2, 5, Direction.North, { power: 'broken' })], pond));
    expect(requireRobot(sunk, 1)).toMatchObject({ tx: 4, power: 'working', off: 'dizzy' });
    const away = tick(farmWith([bot(1, 4, Direction.East), bot(2, 5, Direction.North, { power: 'repairing', repairReadyDay: 1 })]));
    expect(at(away, 1)).toEqual([5, ROW]);
    const carriedOff = { ...BASE, player: { ...BASE.player, carrying: 2 } };
    const held = tick(farmWith([bot(1, 4, Direction.East), bot(2, 5, Direction.North, { carried: true })], carriedOff));
    expect(at(held, 1)).toEqual([5, ROW]);
  });

  it('lets a robot walk out of a tile it shares with another: moving out is never a bump', () => {
    const state = farmWith([bot(1, 5, Direction.East), bot(2, 5, Direction.North, { program: SPINNER })]);
    const next = tick(state);
    expect([at(next, 1), at(next, 2)]).toEqual([
      [6, ROW],
      [5, ROW],
    ]);
    expect(requireRobot(next, 1).off).toBeNull();
  });

  it('findBumps reads the start-of-minute positions and repeats the rule until nothing changes', () => {
    const state = farmWith([bot(1, 4, Direction.East), bot(2, 5, Direction.East), bot(3, 7, Direction.West)]);
    const convoy = [
      { id: 1, from: { tx: 4, tz: ROW }, to: { tx: 5, tz: ROW } },
      { id: 2, from: { tx: 5, tz: ROW }, to: { tx: 6, tz: ROW } },
    ];
    expect(findBumps(state, convoy).size).toBe(0);
    // Robot 3 heads for the same tile as robot 2: both bump, and then robot 1 bumps into robot 2.
    const meeting = [...convoy, { id: 3, from: { tx: 7, tz: ROW }, to: { tx: 6, tz: ROW } }];
    expect([...findBumps(state, meeting)]).toEqual([
      [2, 3],
      [3, 2],
      [1, 2],
    ]);
  });
});

describe('what a bump does', () => {
  it('pays the move, settles as a failure, and leaves the robot dizzy until morning', () => {
    const next = tick(farmWith([bot(1, 4, Direction.East), bot(2, 6, Direction.West)]));
    const robot = requireRobot(next, 1);
    expect(robot).toMatchObject({ tx: 4, tz: ROW, tokens: 79, off: 'dizzy', power: 'working', actionSeq: 1, moveSeq: 0 });
    expect(robot.lastAction).toEqual({ seq: 1, kind: 'move', success: false, bickered: false });
    expect(robot.stats.today).toEqual({ tokens: 1, actions: 1, crops: 0 });
    // Off until morning: nothing more happens today.
    const later = tick(next, 60);
    expect(requireRobot(later, 1)).toBe(requireRobot(next, 1));
    const morning = sleep(later);
    expect(requireRobot(morning, 1).off).toBeNull();
  });

  it('toasts each bump, and the log tells the truth while the robot stays cheerful', () => {
    const next = tick(farmWith([bot(1, 4, Direction.East), bot(2, 6, Direction.West)]));
    expect(texts(next).slice(-2)).toEqual(['Sprocket bumped into Bolt and got dizzy.', 'Bolt bumped into Sprocket and got dizzy.']);
    const names = new Map(next.robots.list.map((r) => [r.id, r.name]));
    const entry = next.robots.log.entries[0];
    if (entry === undefined) throw new Error('expected a log entry');
    expect(robotSays(entry)).toBe('Made a new friend ✓');
    expect(whatHappened(entry, names)).toBe('Bumped into Bolt and got dizzy.');
    const forgot = { ...entry, event: { kind: 'crashed' as const, withId: 2, forgot: { kind: 'atTime' as const, minute: 840 } } };
    expect(whatHappened(forgot, names)).toBe('Bumped into Bolt and got dizzy. Forgot everything under "When it\'s 2:00 pm".');
    expect(robotSays(forgot)).toBe('Made a new friend ✓');
  });

  it('routes into a robot that stands still and bumps: the running stack is forgotten, its When kept', () => {
    const program = b.program({ stacks: [b.when(b.morning(), b.goTo(b.tileAt(8, ROW)))] });
    const router = programmed(bot(1, 4, Direction.East), program);
    const state = farmWith([router, bot(2, 6, Direction.North, { power: 'standby' })]);
    const next = tick(state, 12);
    const robot = requireRobot(next, 1);
    expect(at(next, 1)).toEqual([5, ROW]);
    expect(robot.off).toBe('dizzy');
    expect(robot.program).toEqual(b.program({ stacks: [b.when(b.morning())] }));
    expect(robot.exec).toMatchObject({ running: null, frames: [] });
    expect(eventsOf(next, 1).at(-1)).toEqual({ kind: 'crashed', withId: 2, forgot: { kind: 'morning' } });
    expect(texts(next).at(-1)).toBe('Sprocket bumped into Bolt and forgot what to do when morning came.');
  });

  it('forgets only the running stack: variables, other stacks, helpers and the .MD stay, and the exec stays aligned', () => {
    const program = b.program({
      vars: [b.numVar('laps', 0)],
      stacks: [b.when(b.atTime(720), b.run('spin')), b.when(b.morning(), b.forever(b.change('laps', 1), b.move())), b.when(b.every(30), b.turn('left'))],
      helpers: [b.helper('spin', b.turn('right'))],
    });
    const robot = programmed(bot(1, 4, Direction.East), program, [{ kind: 'dontGoIntoWater' }]);
    const state = farmWith([robot, bot(2, 5, Direction.North, { power: 'standby' })]);
    const next = tick(state);
    const after = requireRobot(next, 1);
    if (after.program.kind !== 'blocks' || after.exec === null) throw new Error('expected a block robot');
    expect(after.program.stacks[1]).toEqual({ trigger: { kind: 'morning' }, body: [] });
    expect(after.program.stacks[0]).toBe(program.stacks[0]);
    expect(after.program.stacks[2]).toBe(program.stacks[2]);
    expect(after.program.vars).toBe(program.vars);
    expect(after.program.helpers).toBe(program.helpers);
    expect(after.md).toBe(robot.md);
    expect(after.exec.due).toHaveLength(3);
    expect(after.exec.firedToday).toHaveLength(3);
    expect(isValidExec(after.exec, after.program)).toBe(true);
    expect(eventsOf(next, 1)).toEqual([{ kind: 'crashed', withId: 2, forgot: { kind: 'morning' } }]);
    expect(deserializeGame(serializeGame(next))).toEqual(loadedFrom(next));
    // The next morning finds the emptied stack: the robot starts it, finishes at once and idles.
    const morning = tick(sleep(next));
    expect(requireRobot(morning, 1)).toMatchObject({ tx: 4, tz: ROW, off: null, power: 'standby' });
  });

  it('a script robot, or one walking home on a DO return, forgets nothing', () => {
    const scripted = tick(farmWith([bot(1, 4, Direction.East), bot(2, 5, Direction.North, { power: 'standby' })]));
    expect(requireRobot(scripted, 1).program).toBe(MOVER);
    expect(eventsOf(scripted, 1)).toEqual([{ kind: 'crashed', withId: 2, forgot: null }]);

    const spin = b.program({ stacks: [b.when(b.morning(), b.forever(b.turn('right')))] });
    const homeward = programmed(bot(1, 4, Direction.East), spin, [{ kind: 'doReturn', to: { kind: 'tile', tx: 8, tz: ROW }, minute: 360 }]);
    const returning = tick(farmWith([homeward, bot(2, 5, Direction.North, { power: 'standby' })]));
    const robot = requireRobot(returning, 1);
    expect(robot.program).toBe(spin);
    expect(robot).toMatchObject({ tx: 4, off: 'dizzy', exec: { running: null, frames: [] } });
    expect(eventsOf(returning, 1).at(-1)).toEqual({ kind: 'crashed', withId: 2, forgot: null });
  });

  it('forgetRunningStack keeps the robot itself when nothing runs', () => {
    const idle = programmed(bot(1, 4, Direction.East), b.program({ stacks: [b.when(b.atTime(720), b.move())] }));
    expect(forgetRunningStack(idle)).toEqual({ robot: idle, forgot: null });
    expect(forgetRunningStack(idle).robot).toBe(idle);
    const scripted = bot(1, 4, Direction.East);
    expect(forgetRunningStack(scripted).robot).toBe(scripted);
  });

  it('saves the crashed event and rejects a corrupted one', () => {
    const next = tick(farmWith([bot(1, 4, Direction.East), bot(2, 6, Direction.West)]));
    expect(deserializeGame(serializeGame(next))).toEqual(loadedFrom(next));
    const corrupt = (edit: (event: SaveJson) => void): GameState | null => {
      const save = JSON.parse(serializeGame(next)) as SaveJson;
      const entries = ((save.robots as SaveJson).log as SaveJson).entries as SaveJson[];
      const first = entries[0];
      if (first === undefined) throw new Error('expected a log entry');
      edit(first.event as SaveJson);
      return deserializeGame(JSON.stringify(save));
    };
    expect(corrupt((e) => void (e.withId = 0))).toBeNull();
    expect(corrupt((e) => void (e.forgot = { kind: 'atTime', minute: 5 }))).toBeNull();
    expect(corrupt((e) => void delete e.forgot)).toBeNull();
    expect(corrupt((e) => void (e.forgot = { kind: 'every', minutes: 15 }))).not.toBeNull();
  });
});

describe('seeing and avoiding robots', () => {
  it('tile ahead is blocked, and not clear, with a standing robot ahead', () => {
    const program = b.program({ stacks: [b.when(b.morning(), b.move())] });
    const looker = bot(1, 4, Direction.East);
    const sense = (state: GameState, what: 'blocked' | 'clear' | 'water'): boolean => {
      const value = evaluate(b.tileAheadIs(what), { state, robot: looker, program, vars: [] });
      return value.type === 'yesNo' && value.value;
    };
    const empty = farmWith([looker]);
    expect([sense(empty, 'blocked'), sense(empty, 'clear'), sense(empty, 'water')]).toEqual([false, true, false]);
    const ahead = farmWith([looker, bot(2, 5, Direction.North, { power: 'flat', tokens: 0 })]);
    expect([sense(ahead, 'blocked'), sense(ahead, 'clear'), sense(ahead, 'water')]).toEqual([true, false, false]);
    const pond = withTile(BASE, { tx: 5, tz: ROW }, blockedTile(Blocker.Water), 'farm');
    const sunk = farmWith([looker, bot(2, 5, Direction.North, { power: 'broken' })], pond);
    expect([sense(sunk, 'blocked'), sense(sunk, 'clear'), sense(sunk, 'water')]).toEqual([true, false, true]);
    const away = farmWith([looker, bot(2, 5, Direction.North, { power: 'repairing', repairReadyDay: 1 })]);
    expect([sense(away, 'blocked'), sense(away, 'clear')]).toEqual([false, true]);
  });

  it('lets a program look before it moves', () => {
    const careful = b.program({ stacks: [b.when(b.morning(), b.forever(b.if(b.tileAheadIs('clear'), [b.move()], [b.turn('right')])))] });
    const next = tick(farmWith([programmed(bot(1, 4, Direction.East, { parts: ['sensorEye'] }), careful), bot(2, 5, Direction.North, { power: 'standby' })]));
    expect(requireRobot(next, 1)).toMatchObject({ tx: 4, facing: Direction.South, off: null });
  });

  it('refuses to put a robot down on a robot', () => {
    const base = withPlayer(BASE, { tx: TARGET.tx, tz: TARGET.tz - 1 }, Direction.South);
    const state = farmWith([robotOf({ id: 1, carried: true }), robotOf({ id: 2, name: 'Bolt' })], { ...base, player: { ...base.player, carrying: 1 } });
    const next = gameReducer(state, actions.interact());
    expect(next.player.carrying).toBe(1);
    expect(texts(next).at(-1)).toBe("There's a robot there.");
  });

  it('drops a repaired robot on the nearest walkable tile with no robot on it', () => {
    const ready = robotOf({ id: 1, power: 'repairing', repairReadyDay: 1, tokens: 0 });
    const parked = robotOf({ id: 2, name: 'Bolt', tx: ROBOTS.repairDropOff.tx, tz: ROBOTS.repairDropOff.tz, power: 'standby' });
    const next = sleep(farmWith([ready, parked]));
    expect(requireRobot(next, 1)).toMatchObject({ power: 'working', tx: 10, tz: 6 });
    expect(at(next, 2)).toEqual([ROBOTS.repairDropOff.tx, ROBOTS.repairDropOff.tz]);
  });

  it('moves a robot off a tile that grew weeds onto a tile with no robot', () => {
    const weeds = withTile(BASE, TARGET, blockedTile(Blocker.Weeds), 'farm');
    const north = { tx: TARGET.tx, tz: TARGET.tz - 1 };
    const next = sleep(farmWith([robotOf({ id: 1 }), robotOf({ id: 2, name: 'Bolt', ...north })], weeds));
    expect(at(next, 1)).toEqual([TARGET.tx + 1, TARGET.tz]);
    expect(at(next, 2)).toEqual([north.tx, north.tz]);
  });

  it('nearestFreeWalkable counts the robot itself as no obstacle', () => {
    const state = farmWith([robotOf({ id: 1 }), robotOf({ id: 2, name: 'Bolt', tx: TARGET.tx + 1 })]);
    expect(nearestFreeWalkable(state, TARGET, 1)).toEqual(TARGET);
    expect(nearestFreeWalkable(state, TARGET, 2)).toEqual({ tx: TARGET.tx, tz: TARGET.tz - 1 });
  });

  it('keeps the pair preset bickering without ever bumping', () => {
    const place = { tx: 5, tz: ROW, facing: Direction.South };
    let state = withTile(BASE, place, soilTile(TileState.Watered, matureCrop('parsnip')), 'farm');
    for (const spec of presetSpecs('pair', place)) {
      const added = addRobot(state, spec);
      if ('error' in added) throw new Error(added.error);
      state = added.state;
    }
    const next = tick(state, 60);
    const kinds = next.robots.log.entries.map((e) => e.event.kind);
    expect(kinds).toContain('bickered');
    expect(kinds).not.toContain('crashed');
    expect(next.robots.list.map((r) => r.off)).toEqual([null, null]);
  });
});
```

In `tests/robotLogText.test.ts`, inside `everyEvent()`, replace:

```ts
    { kind: 'bickered', action: 'harvest', withIds: [2, 3] },
```

with:

```ts
    { kind: 'bickered', action: 'harvest', withIds: [2, 3] },
    { kind: 'crashed', withId: 2, forgot: null },
    { kind: 'crashed', withId: 2, forgot: { kind: 'every', minutes: 15 } },
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run tests/robotBump.test.ts tests/robotLogText.test.ts`
Expected: FAIL. `robotBump.test.ts` doesn't load: `Error: Failed to resolve import "../src/robots/bumps" from "tests/robotBump.test.ts". Does the file exist?`. `robotLogText.test.ts` fails "gives every event a ✓ line and a truthful line" with `expected undefined to match / ✓$/` (robotSays has no `crashed` case yet).

- [ ] **Step 3: The log event in `src/core/types.ts`**

Replace:

```ts
  'doPowerDown',
  'conflict',
] as const;
```

with:

```ts
  'doPowerDown',
  'conflict',
  'crashed',
] as const;
```

and replace:

```ts
  | { readonly kind: 'conflict'; readonly doCard: MdCard; readonly dontCard: MdCard };
```

with:

```ts
  | { readonly kind: 'conflict'; readonly doCard: MdCard; readonly dontCard: MdCard }
  // Farmclaws part 3 (spec §3.1): a bump into robot `withId`; `forgot` is the trigger of the stack it forgot.
  | { readonly kind: 'crashed'; readonly withId: number; readonly forgot: Trigger | null };
```

- [ ] **Step 4: Create `src/robots/bumps.ts`**

```ts
/**
 * Bumps (farmclaws part 3 spec §3.1): robots no longer pass through each other. Decided once a
 * minute from the positions at the start of the minute, whatever the robots' ids. Pure.
 */
import { invariant } from '../core/invariant';
import type { GameState, Robot, TileCoord, Trigger } from '../core/types';
import { robotsOnTile } from './world';

/** A chosen move this minute whose plan is ok: robot `id` from `from` onto `to`. */
export interface MoveIntent {
  readonly id: number;
  readonly from: TileCoord;
  readonly to: TileCoord;
}

const keyOf = (c: TileCoord): string => `${c.tx},${c.tz}`;
const same = (a: TileCoord, b: TileCoord): boolean => a.tx === b.tx && a.tz === b.tz;

/**
 * The moves that bump: bumped robot id → the id of the robot it bumped into.
 * - Same target: every move onto a tile another move also targets, into the lowest other id.
 * - Swap: two moves that would trade tiles, into each other.
 * - Into a robot that stays, repeated until nothing changes: a move onto a tile where a standing
 *   robot has no move left that hasn't bumped, into the lowest such id.
 * Every other move goes ahead, so a line of robots moving the same way all move.
 */
export function findBumps(state: GameState, moves: readonly MoveIntent[]): ReadonlyMap<number, number> {
  const bumped = new Map<number, number>();
  const byTarget = new Map<string, MoveIntent[]>();
  for (const move of moves) byTarget.set(keyOf(move.to), [...(byTarget.get(keyOf(move.to)) ?? []), move]);
  for (const group of byTarget.values()) {
    if (group.length < 2) continue;
    for (const move of group) bumped.set(move.id, Math.min(...group.filter((m) => m.id !== move.id).map((m) => m.id)));
  }
  for (const move of moves) {
    if (bumped.has(move.id)) continue;
    const swap = moves.find((m) => m.id !== move.id && same(m.from, move.to) && same(m.to, move.from));
    if (swap !== undefined) bumped.set(move.id, swap.id);
  }
  const moving = new Set(moves.map((m) => m.id));
  let changed = true;
  while (changed) {
    changed = false;
    for (const move of moves) {
      if (bumped.has(move.id)) continue;
      // robotsOnTile lists the standing robots lowest id first.
      const stays = robotsOnTile(state, move.to.tx, move.to.tz).find((r) => !moving.has(r.id) || bumped.has(r.id));
      if (stays === undefined) continue;
      bumped.set(move.id, stays.id);
      changed = true;
    }
  }
  return bumped;
}

/**
 * A bumped robot forgets the trigger stack it was running (spec §3.1): that stack's body becomes
 * empty and its `When` block stays, so `exec.due`, `exec.firedToday` and the stack indices stay
 * aligned. Variables, helpers, other stacks and the .MD are kept. A script, or a block robot
 * with no stack running (idle, or on a DO return), forgets nothing and comes back unchanged.
 */
export function forgetRunningStack(robot: Robot): { readonly robot: Robot; readonly forgot: Trigger | null } {
  const program = robot.program;
  const running = robot.exec?.running ?? null;
  if (program.kind !== 'blocks' || running === null) return { robot, forgot: null };
  const stack = program.stacks[running];
  invariant(stack !== undefined, `forgetRunningStack: robot ${robot.id} runs no stack ${running}`);
  const stacks = program.stacks.map((s, i) => (i === running ? { trigger: s.trigger, body: [] } : s));
  return { robot: { ...robot, program: { ...program, stacks } }, forgot: stack.trigger };
}
```

- [ ] **Step 5: `applyBumpPlan` in `src/robots/execute.ts`**

Replace:

```ts
import { addToBag, addToSlots, bagCount, bagRoom, removeFromBag, slotsRoom, takeIntoBag } from './bag';
import { logRobotEvent } from './log';
```

with:

```ts
import { addToBag, addToSlots, bagCount, bagRoom, removeFromBag, slotsRoom, takeIntoBag } from './bag';
import { forgetRunningStack } from './bumps';
import { logRobotEvent } from './log';
import { triggerText } from './logText';
```

Insert directly above the doc comment of `chargeWake` (`/**\n * Pays \`cost\` tokens to wake (part 2 spec §7) and marks the robot working: …`):

```ts
/**
 * A bump (part 3 spec §3.1): the robot pays for its move (one action) and stays where it is. It
 * forgets the trigger stack its committed `exec` was running, logs `crashed`, settles as a failed
 * action, its exec stops, and it is dizzy until morning. The robot it bumped into is untouched.
 */
export function applyBumpPlan(state: GameState, robotId: number, plan: RobotPlan, withId: number, exec: RobotExec | null = null): GameState {
  const paid = pay(state, robotId, plan.cost, { actions: 1 });
  const { robot, forgot } = forgetRunningStack({ ...paid.robot, exec: exec ?? paid.robot.exec });
  const stopped: RobotExec | null = robot.exec === null ? null : { ...robot.exec, running: null, frames: [] };
  const logged = logRobotEvent(withRobot(paid.state, robot), robotId, { kind: 'crashed', withId, forgot });
  const settled = settle(logged, robotId, plan.action, false, false, stopped);
  const dizzy = withRobot(settled, { ...requireRobot(settled, robotId), off: 'dizzy' });
  const other = requireRobot(state, withId).name;
  const text =
    forgot === null
      ? `${robot.name} bumped into ${other} and got dizzy.`
      : `${robot.name} bumped into ${other} and forgot what to do when ${triggerText(forgot)}.`;
  return pushMessage(dizzy, text, 'warn');
}

```

(`logText.ts` imports nothing from `execute.ts`, and `bumps.ts` only `world.ts`, so there is no import cycle.)

- [ ] **Step 6: The pre-pass in `src/robots/run.ts`**

Replace:

```ts
import { applyBickerPlan, applyRobotPlan, applyTurn, chargeWake, planRobotAction, type RobotPlan } from './execute';
```

with:

```ts
import { findBumps, type MoveIntent } from './bumps';
import { applyBickerPlan, applyBumpPlan, applyRobotPlan, applyTurn, chargeWake, planRobotAction, type RobotPlan } from './execute';
```

Replace the doc comment of `runRobotsMinute`:

```ts
/**
 * One minute (state.time.minuteOfDay is the minute being processed): every due robot chooses
 * against the state at the start of the minute; robots that can't pay go flat; successful
 * tile actions on a shared tile bicker; the rest are re-planned (with the same kept items) and
 * applied in id order, block-program turns with no tile action among them.
 */
```

with:

```ts
/**
 * One minute (state.time.minuteOfDay is the minute being processed): every due robot chooses
 * against the state at the start of the minute; robots that can't pay go flat; successful
 * tile actions on a shared tile bicker; successful moves that bump (findBumps, from the
 * start-of-minute positions, part 3 spec §3.1) are applied as bumps; the rest are re-planned
 * (with the same kept items) and applied in id order, block-program turns with no tile action
 * among them. Re-planning never turns a move into a bump or out of one.
 */
```

Replace:

```ts
  for (const choice of chosen) {
    const id = choice.id;
    if (choice.kind === 'turn') {
```

with:

```ts
  const moves: MoveIntent[] = [];
  for (const choice of chosen) {
    if (choice.kind !== 'act' || !choice.plan.ok || choice.plan.action.kind !== 'move') continue;
    const robot = requireRobot(state, choice.id);
    moves.push({ id: choice.id, from: { tx: robot.tx, tz: robot.tz }, to: choice.plan.target });
  }
  const bumps = findBumps(state, moves);

  for (const choice of chosen) {
    const id = choice.id;
    if (choice.kind === 'turn') {
```

and replace:

```ts
    const others = rivals.get(id);
    if (others !== undefined) {
```

with:

```ts
    const bumpedInto = bumps.get(id);
    if (bumpedInto !== undefined) {
      next = applyBumpPlan(next, id, plan, bumpedInto, exec);
      continue;
    }
    const others = rivals.get(id);
    if (others !== undefined) {
```

- [ ] **Step 7: The log text in `src/robots/logText.ts`**

In `robotSays`, replace:

```ts
    case 'doPowerDown':
      return 'Powering down ✓';
  }
}
```

with:

```ts
    case 'doPowerDown':
      return 'Powering down ✓';
    case 'crashed':
      return 'Made a new friend ✓';
  }
}
```

In `whatHappened`, replace:

```ts
    case 'conflict':
      return `My .MD says ${mdCardText(event.doCard)}, but it also says don't ${mdCardText(event.dontCard)}. Don't wins.`;
  }
}
```

with:

```ts
    case 'conflict':
      return `My .MD says ${mdCardText(event.doCard)}, but it also says don't ${mdCardText(event.dontCard)}. Don't wins.`;
    case 'crashed': {
      const bumped = `Bumped into ${listNames([event.withId], names)} and got dizzy.`;
      return event.forgot === null ? bumped : `${bumped} Forgot everything under "When ${triggerText(event.forgot)}".`;
    }
  }
}
```

- [ ] **Step 8: Validation in `src/state/robotValidation.ts`**

Replace:

```ts
/** A trigger carried by a `woke` event. */
```

with:

```ts
/** A trigger carried by a `woke` or `crashed` event. */
```

and in `isValidLogEvent` replace:

```ts
    case 'conflict':
      return hasExactKeys(v, ['kind', 'doCard', 'dontCard']) && isLoggedCard(v.doCard, DO_CARD_KINDS) && isLoggedCard(v.dontCard, DONT_CARD_KINDS);
    default:
```

with:

```ts
    case 'conflict':
      return hasExactKeys(v, ['kind', 'doCard', 'dontCard']) && isLoggedCard(v.doCard, DO_CARD_KINDS) && isLoggedCard(v.dontCard, DONT_CARD_KINDS);
    case 'crashed':
      return hasExactKeys(v, ['kind', 'withId', 'forgot']) && isIntIn(v.withId, 1, MAX) && (v.forgot === null || isLoggedTrigger(v.forgot));
    default:
```

- [ ] **Step 9: `tile ahead is` sees robots in `src/robots/eval.ts`**

Replace:

```ts
import { inZone, tileAheadOf, zoneOf } from './zones';
```

with:

```ts
import { robotsOnTile } from './world';
import { inZone, tileAheadOf, zoneOf } from './zones';
```

and replace:

```ts
    case 'tileAheadIs': {
      const ahead = tileAheadOf(robot);
      const tile = getTile(state.maps.farm, ahead.tx, ahead.tz);
      const water = tile !== null && tile.blocker === Blocker.Water;
      const clear = tile !== null && isWalkable(tile);
      if (expr.what === 'water') return yesNo(water);
      if (expr.what === 'clear') return yesNo(clear);
      return yesNo(!water && !clear);
    }
```

with:

```ts
    case 'tileAheadIs': {
      const ahead = tileAheadOf(robot);
      const tile = getTile(state.maps.farm, ahead.tx, ahead.tz);
      const water = tile !== null && tile.blocker === Blocker.Water;
      const clear = tile !== null && isWalkable(tile);
      // A standing robot ahead blocks the tile (part 3 spec §3.1), so a program can look before it moves.
      const robotAhead = robotsOnTile(state, ahead.tx, ahead.tz).length > 0;
      if (expr.what === 'water') return yesNo(water);
      if (expr.what === 'clear') return yesNo(clear && !robotAhead);
      return yesNo(robotAhead || (!water && !clear));
    }
```

- [ ] **Step 10: Put-down refusal in `src/state/intents.ts`**

In `planCarry`, replace:

```ts
  if (isWalkable(tile) && !isReservedTile(selectActiveMap(state), target.tx, target.tz)) {
    return plan(target, { kind: 'putDownRobot', robotId, name: robot.name }, 'place');
  }
```

with:

```ts
  if (isWalkable(tile) && !isReservedTile(selectActiveMap(state), target.tx, target.tz)) {
    // No new shared tiles (part 3 spec §3.1).
    if (state.player.mapId === 'farm' && robotsOnTile(state, target.tx, target.tz).length > 0) return blocked(target, 'place', "There's a robot there.");
    return plan(target, { kind: 'putDownRobot', robotId, name: robot.name }, 'place');
  }
```

(`robotsOnTile` is already imported; the carried robot itself is never on a tile.)

- [ ] **Step 11: `nearestFreeWalkable` in `src/robots/world.ts`**

Replace the whole of `nearestWalkable`:

```ts
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

with:

```ts
/**
 * `from` when it `fits`, else the nearest tile that does, by breadth-first search over in-bounds
 * tiles in DIRECTIONS order (passing through any tile). Throws `failure` when none fits.
 */
function nearestFitting(world: WorldState, from: TileCoord, fits: (tile: Tile, at: TileCoord) => boolean, failure: string): TileCoord {
  const key = (c: TileCoord): number => c.tz * world.grid.width + c.tx;
  const seen = new Set<number>([key(from)]);
  const queue: TileCoord[] = [from];
  for (let head = 0; head < queue.length; head++) {
    const current = queue[head];
    if (current === undefined) break;
    const tile = getTile(world, current.tx, current.tz);
    if (tile !== null && fits(tile, current)) return current;
    for (const direction of DIRECTIONS) {
      const next = stepTile(current, direction);
      if (!inBounds(world.grid, next.tx, next.tz) || seen.has(key(next))) continue;
      seen.add(key(next));
      queue.push(next);
    }
  }
  throw new Error(failure);
}

/** `from` when it's walkable, else the nearest walkable tile by breadth-first search in DIRECTIONS order. */
export function nearestWalkable(world: WorldState, from: TileCoord): TileCoord {
  return nearestFitting(world, from, isWalkable, 'nearestWalkable: the map has no walkable tile');
}

/**
 * The nearest walkable farm tile to `from` with no standing robot on it but `selfId` (part 3
 * spec §3.1): where a repaired robot is dropped off, and where the morning reset moves a robot
 * whose tile stopped being walkable.
 */
export function nearestFreeWalkable(state: GameState, from: TileCoord, selfId: number): TileCoord {
  const free = (tile: Tile, at: TileCoord): boolean => isWalkable(tile) && robotsOnTile(state, at.tx, at.tz).every((r) => r.id === selfId);
  return nearestFitting(state.maps.farm, from, free, 'nearestFreeWalkable: the farm has no free walkable tile');
}
```

(`Tile`, `GameState`, `DIRECTIONS`, `inBounds`, `stepTile`, `getTile` and `isWalkable` are already imported; `robotsOnTile` is declared earlier in the same file.)

- [ ] **Step 12: Robot-free drop-off and morning moves in `src/robots/overnight.ts`**

Replace:

```ts
import { nearestWalkable, withFarm, withRobot } from './world';
```

with:

```ts
import { nearestFreeWalkable, withFarm, withRobot } from './world';
```

In `returnRepaired`, replace:

```ts
/** Repairs due today come back fully charged in front of the shipping bin. Returns their ids. */
```

with:

```ts
/**
 * Repairs due today come back fully charged in front of the shipping bin, on the nearest
 * walkable tile with no robot on it (part 3 spec §3.1). Returns their ids.
 */
```

and replace:

```ts
    const at = nearestWalkable(next.maps.farm, ROBOTS.repairDropOff);
```

with:

```ts
    const at = nearestFreeWalkable(next, ROBOTS.repairDropOff, robot.id);
```

In `resetForMorning`, the line that picks `at` (Task 5 may have extended its condition for benched robots; keep that condition) calls `nearestWalkable(farm, robot)`. Replace that call with `nearestFreeWalkable(next, robot, robot.id)` and put a comment above the line, so on `v2` plus Task 5 it reads (Task 5's condition, if any, stays in front of `standable`):

```ts
    // Off an unwalkable tile, onto the nearest walkable one with no robot on it (part 3 spec §3.1).
    const at = standable ? { tx: robot.tx, tz: robot.tz } : nearestFreeWalkable(next, robot, robot.id);
```

`next` holds the robots already reset this night, in id order, so two robots moved off the same weeds never land together. A robot whose tile is still standable stays, even on a tile it shares.

- [ ] **Step 13: The `pair` preset in `src/dev/robotDev.ts`**

Replace:

```ts
function presetSpecs(id: RobotPresetId, place: RobotPlace): RobotSpec[] {
```

with:

```ts
/** The robots each preset delivers at `place` (exported for tests). */
export function presetSpecs(id: RobotPresetId, place: RobotPlace): RobotSpec[] {
```

and replace:

```ts
    case 'pair': {
      const steps: RobotAction[] = [{ kind: 'harvest' }, { kind: 'move' }, { kind: 'harvest' }, { kind: 'move' }, { kind: 'turn', side: 'right' }, { kind: 'turn', side: 'right' }];
      return [spec('Tweedle', 'mini', ['claw'], steps, true), spec('Dee', 'mini', ['claw'], steps, true)];
    }
```

with:

```ts
    case 'pair': {
      // Both share the delivery tile and never move: they bicker over its crop and never bump.
      const steps: RobotAction[] = [{ kind: 'harvest' }, { kind: 'turn', side: 'right' }];
      return [spec('Tweedle', 'mini', ['claw'], steps, true), spec('Dee', 'mini', ['claw'], steps, true)];
    }
```

- [ ] **Step 14: Run them and see them pass**

Run: `npx vitest run tests/robotBump.test.ts tests/robotLogText.test.ts tests/robotRun.test.ts tests/robotTickBatching.test.ts tests/robotDeterminism.test.ts tests/robotOvernight.test.ts tests/robotInteract.test.ts tests/robotEval.test.ts tests/robotHelpers.test.ts tests/robotDev.test.ts`
Expected: PASS (`robotBump.test.ts`: 24 tests).

Existing tests: none needs an edit for bumps. Checked by running the whole suite on `v2` with this task's rule applied: `robotRun` (its two-robot scenarios share a tile and harvest, take or turn, never move), `robotTickBatching` (its random farms do bump, 84 times across the run, but the test only compares one big tick with minute ticks, which bumps keep equal), `robotDeterminism` (robots three tiles apart, and the player can no longer put one down on another), `robotFaithful`, `robotParity`, `robotRoute`, `robotTriggers`, `robotMd`, `robotTurn`, `robotInterpret`, `robotInterpretSafety`, `robotExecute`, `robotEval`, `robotHelpers` (`nearestWalkable` unchanged), `robotOvernight` (drop-off and weed moves have no robot in the way), `robotInteract`, `robotDev`, `robotSave`, `robotSaveV5`, `robotRender`, `robotStats`, `robotCheck`, `intents` and `reducer`.

- [ ] **Step 15: The full gate**

Run: `npm run typecheck && npm test && npm run build`
Expected: PASS.

- [ ] **Step 16: Commit**

```bash
git add src/core/types.ts src/robots/bumps.ts src/robots/execute.ts src/robots/run.ts src/robots/logText.ts src/state/robotValidation.ts src/robots/eval.ts src/state/intents.ts src/robots/world.ts src/robots/overnight.ts src/dev/robotDev.ts tests/robotBump.test.ts tests/robotLogText.test.ts
git commit -m "Farmclaws part 3: robots bump into each other and forget what they were running

Moves are checked once a minute from the start-of-minute positions: same target, swaps and
moves into a robot that stays bump, the last repeated until nothing changes, so a convoy
moves as one whatever the ids. A bumped robot pays the move, gets dizzy and loses the body
of the stack it was running. Tile ahead is blocked sees robots; put-down, the repair
drop-off and the morning move off weeds avoid robot tiles.

The pair dev preset can't stagger its robots and still bicker (a harvest works the robot's
own tile), so both now stay on the delivery tile and alternate harvest and turn.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Ruin, new core, scrapping, paint

**Files:**
- Modify: `src/core/types.ts` (`ROBOT_POWERS` ~line 509; `Robot.paint` after `lastAction` ~line 593; `ROBOT_LOG_EVENT_KINDS` and `RobotLogEvent` after Task 6's `crashed`)
- Modify: `src/config.ts` (new `ROBOT_CARE`, `ROBOT_PAINTS` after `GENERATORS`, ~line 305)
- Modify: `src/robots/stats.ts` (config import line 4; `resumedPower` ~lines 30–37; end of file)
- Modify: `src/robots/overnight.ts` (header; new `ruinSoaked` above `recharge` ~line 84; `recharge` ~line 94; `resetForMorning` ~line 148; `runRobotsOvernight` ~line 174)
- Modify: `src/robots/logText.ts` (`listNames` ~line 77; `robotSays`, `whatHappened` after Task 6's `crashed` cases)
- Modify: `src/robots/edits.ts` (`KEPT_POWERS` and the doc comments of `KEPT_POWERS` and `programmedRobot`)
- Modify: `src/robots/create.ts` (`addRobot`'s robot literal, ~line 94)
- Modify: `src/state/intents.ts` (`Intent` doc ~line 62; `planCarry` ~line 358; `describeIntent` ~line 501)
- Modify: `src/state/actions.ts` (two actions and creators)
- Modify: `src/state/reducer.ts` (imports; `repairRobot` toast ~line 424; `editRobot` (Task 2); Task 5's `robot/switch` handler; new `robot/scrap`, `robot/paint` cases and functions)
- Modify: `src/state/robotValidation.ts` (config import line 5; `ROBOT_KEYS` ~line 48; `isValidRobot` ~lines 599 and 611)
- Modify: `src/state/persistence.ts` (`migrateRobotV5` and its doc comment, Task 3/5)
- Modify: `src/render/robotLayout.ts` (header, imports, `ROBOT_MESH_IDS`, `robotMeshes`, `robotPose`, `eyeLevel`, end of file)
- Modify: `src/render/robotGeometry.ts` (header, `ROBOT_COLORS`, `HEAD_MESHES`, `body` / `head` cases)
- Modify: `src/render/RobotRenderer.ts` (header comment, imports, a new field, constructor, `sync`, `clearAll`, `syncMeshes`, the spark check)
- Modify: `tests/testUtils.ts` (`robotOf`, `v5Save`: paint, ruin and the crashed and ruined log events)
- Test: `tests/robotRuin.test.ts` (create), `tests/robotScrapPaint.test.ts` (create), `tests/robotSaveV6.test.ts` (append), `tests/robotRender.test.ts` (extend), `tests/robotLogText.test.ts` (extend), `tests/robotInteract.test.ts` (line 143), `tests/robotOvernight.test.ts` (lines 124–132)

**Interfaces:**
- Consumes:
  - Task 2: `src/robots/edits.ts` (`KEPT_POWERS`, `programmedRobot`); the reducer's private `editRobot(state, robotId, edit, done)`; `actions.programRobot(robotId, program)`, `actions.setRobotMd(robotId, md)`.
  - Task 3: `migrateRobotV5` in `persistence.ts`; `v5Save`'s per-robot loop in `tests/testUtils.ts`; `ROBOT_KEYS` with `'stats'`.
  - Task 5: `Robot.onBench`, `WORKBENCH.home`, `benchedRobotOf(overrides: Partial<Robot> = {}): Robot` in `tests/testUtils.ts` (a `robotOf` on the bench, which the new test files import), the `{ kind: 'robot'; robotId; mode }` panel, `actions.switchRobot(robotId, on)` and its reducer handler, the bench-only toast "Put {name} on the workbench first.", `robotsOnTile` excluding benched robots.
  - Task 6: `'crashed'` in the log types and `logText`.
- Produces:
  - `src/core/types.ts`: `ROBOT_POWERS` ends in `'ruined'`; `'ruined'` in `ROBOT_LOG_EVENT_KINDS` and `{ readonly kind: 'ruined' }` in `RobotLogEvent`; `Robot.paint: number`.
  - `src/config.ts`: `ROBOT_CARE = { scrapShare: 0.25, paintCost: 50, ruinedShade: 0.45 } as const`; `ROBOT_PAINTS`: 16 `{ name, color }` entries, spec §3.4's table in order.
  - `src/robots/stats.ts`: `export function scrapValue(robot: Pick<Robot, 'size'>): number`; `export function paintAt(index: number): (typeof ROBOT_PAINTS)[number]` (new); `resumedPower` keeps `'ruined'`.
  - `src/robots/overnight.ts`: private `ruinSoaked(state, notes)` between `returnRepaired` and `recharge`.
  - Actions: `{ type: 'robot/scrap'; robotId: number }` → `actions.scrapRobot(robotId)`; `{ type: 'robot/paint'; robotId: number; paint: number }` → `actions.paintRobot(robotId, paint)`.
  - `src/render/robotLayout.ts`: `ROBOT_MESH_IDS` gains `'bodyShell'` (after `'body'`) and `'headShell'` (after `'head'`); `export function shellColor(robot: Pick<Robot, 'paint' | 'power'>): number`; `export function sparks(robot: Pick<Robot, 'power' | 'carried'>): boolean` (both new).
  - `src/render/robotGeometry.ts`: `export const SHELL_MESHES: ReadonlySet<RobotMeshId>`; `ROBOT_COLORS.body` becomes `ROBOT_COLORS.shell` (white).
  - `tests/testUtils.ts`: `robotOf` gains `paint: 0`; `v5Save` drops `paint` and throws for a ruined robot and for a log entry whose event is `crashed` or `ruined`.

Rules this task fixes:
- Ruin (spec §3.2): at the morning reset, after `returnRepaired` (so after a carried robot is set down at spawn) and before `recharge`, every `broken` robot that isn't carried or benched and stands on a water tile becomes `ruined`, logs `{ kind: 'ruined' }` (in id order) and adds the warn note. Migration never ruins.
- A ruined robot is never due (`isDue` needs `working`/`standby`), never recharges and is never named "away"; the morning reset leaves it in the water; picking it up, carrying, putting down (`resumedPower` keeps it) and benching work; the bin refuses it before any gold check.
- `robot/program`, `robot/md`, `robot/switch` and `robot/paint` refuse a ruined robot with "{name} is ruined. It can only be scrapped." (after Task 5's bench-only refusal where there is one). `robot/scrap` doesn't.
- `robot/scrap`: unknown id → same state; not on the bench → "Put {name} on the workbench first."; otherwise the robot and its own log entries go, `nextId` and the log's `nextId` stay, gold grows by `scrapValue`, any open panel closes, success toast "Scrapped {name} for {gold}g.".
- `robot/paint`: unknown id, or `paint` not an integer in 0 … 15 → same state; then the bench, ruined, same-colour ("{name} is already {colour}.") and gold ("A paint job costs {cost}g.") refusals; otherwise gold − `ROBOT_CARE.paintCost`, `paint` set, success toast "Painted {name} {colour}.". The panel stays open.
- Rendering: `bodyShell` and `headShell` carry the painted boxes in white; `shellColor` is `ROBOT_PAINTS[paint].color`, each channel × `ruinedShade` (rounded) when ruined. `RobotRenderer` writes the two shell instance colours only when a robot's instances are (re)added or its `shellColor` changed. A ruined robot poses like a broken one, with its eyes out and no sparks.

- [ ] **Step 1: Write the failing tests**

Create `tests/robotRuin.test.ts`:

```ts
/**
 * Water: a new core or ruin (farmclaws part 3 spec §3.2). A broken robot still in the water at
 * the morning reset is ruined; fished out, put down on land or carried at day end, it isn't; a
 * migrated broken robot is ruined only at the next morning (plan review focus 5); ruined robots
 * never act or recharge and are never named as away from a generator; the bin's new core and its
 * refusal for ruined robots; and the edits a ruined robot refuses.
 */
import { describe, expect, it } from 'vitest';
import { PLAYER } from '../src/config';
import { Blocker, Direction, type GameState, type Robot } from '../src/core/types';
import { b } from '../src/robots/blocks';
import { robotSays, whatHappened } from '../src/robots/logText';
import { resumedPower } from '../src/robots/stats';
import { requireRobot } from '../src/robots/world';
import { actions } from '../src/state/actions';
import { describeIntent, planInteraction } from '../src/state/intents';
import { deserializeGame, isValidGameState, serializeGame } from '../src/state/persistence';
import { gameReducer } from '../src/state/reducer';
import { EMPTY_TILE, blockedTile } from '../src/world/tiles';
import { BASE, benchedRobotOf, must, robotOf, v5Save, withGold, withPlayer, withRobots, withTile } from './testUtils';

const POND = { tx: 6, tz: 12 };
const SHORE = { tx: 6, tz: 11 };
const AWAY = "ended the day away from a generator and didn't recharge.";
const RUINED = 'Sprocket spent the night in the water and is ruined. Scrap it at the workbench.';
const ONLY_SCRAP = 'Sprocket is ruined. It can only be scrapped.';

const wet = (state: GameState = BASE): GameState => withTile(state, POND, blockedTile(Blocker.Water), 'farm');
/** Sprocket, shorted out in the pond. */
const sunk = (overrides: Partial<Robot> = {}): Robot => robotOf({ power: 'broken', tx: POND.tx, tz: POND.tz, ...overrides });
const sleep = (state: GameState): GameState => gameReducer(state, actions.sleep());
const tick = (state: GameState, minutes: number): GameState => gameReducer(state, actions.tick(minutes));
const interact = (state: GameState): GameState => gameReducer(state, actions.interact());
const texts = (state: GameState): string[] => state.messages.entries.map((m) => m.text);
const lastText = (state: GameState): string | undefined => state.messages.entries.at(-1)?.text;
const loadedFrom = (state: GameState): GameState => ({ ...state, ui: { ...state.ui, panel: { kind: 'none' }, paused: false } });
/** The player on the shore, facing the pond. */
const onShore = (state: GameState): GameState => withPlayer(state, SHORE, Direction.South, 'farm');

describe('ruin overnight', () => {
  it('ruins a broken robot still in the water at the morning reset, where it sank', () => {
    const next = sleep(withRobots(wet(), [sunk()]));
    expect(requireRobot(next, 1)).toMatchObject({ power: 'ruined', tx: POND.tx, tz: POND.tz, teleportSeq: 0, off: null, repairReadyDay: null });
    const entry = next.robots.log.entries.at(-1);
    expect(entry).toMatchObject({ robotId: 1, day: next.time.absoluteDay, event: { kind: 'ruined' } });
    expect(next.messages.entries.find((m) => m.text === RUINED)?.tone).toBe('warn');
    expect(isValidGameState(next)).toBe(true);
    expect(deserializeGame(serializeGame(next))).toEqual(loadedFrom(next));
  });

  it('leaves it broken when it is fished out and put down on land the same day', () => {
    const held = interact(onShore(withRobots(wet(), [sunk()])));
    expect(held.player.carrying).toBe(1);
    const down = interact(withPlayer(held, SHORE, Direction.North, 'farm'));
    expect(requireRobot(down, 1)).toMatchObject({ power: 'broken', tx: SHORE.tx, tz: SHORE.tz - 1 });
    const next = sleep(down);
    expect(requireRobot(next, 1).power).toBe('broken');
    expect(texts(next)).not.toContain(RUINED);
  });

  it('leaves it broken when it is still carried at day end (set down at spawn)', () => {
    const held = interact(onShore(withRobots(wet(), [sunk()])));
    const next = sleep(held);
    expect(requireRobot(next, 1)).toMatchObject({ power: 'broken', carried: false, tx: PLAYER.spawn.tx, tz: PLAYER.spawn.tz });
    expect(texts(next)).not.toContain(RUINED);
  });

  it('leaves broken robots on land and on the bench broken', () => {
    const next = sleep(withRobots(wet(), [robotOf({ id: 1, power: 'broken', tx: SHORE.tx, tz: SHORE.tz }), benchedRobotOf({ id: 2, name: 'Bolt', power: 'broken' })]));
    expect([requireRobot(next, 1).power, requireRobot(next, 2).power]).toEqual(['broken', 'broken']);
    expect(next.robots.log.entries).toEqual([]);
  });

  it('ruins a migrated broken robot only at the next morning (review focus 5)', () => {
    const state = withRobots(wet(), [sunk()]);
    const loaded = must(deserializeGame(JSON.stringify(v5Save(state))));
    expect(requireRobot(loaded, 1)).toMatchObject({ power: 'broken', paint: 0, tx: POND.tx, tz: POND.tz });
    expect(loaded.robots.log.entries).toEqual([]);
    const morning = sleep(loaded);
    expect(requireRobot(morning, 1).power).toBe('ruined');
    expect(texts(morning)).toContain(RUINED);
  });
});

describe('a ruined robot', () => {
  it('never acts, never recharges, and is never named as away from a generator', () => {
    const burner = { tx: POND.tx + 1, tz: POND.tz };
    const fuelled = withTile(wet(), burner, { ...EMPTY_TILE, object: { kind: 'woodBurner', fuel: 10 } }, 'farm');
    const mover = { kind: 'script', steps: [{ kind: 'move' }], loop: true } as const;
    const state = withRobots(fuelled, [sunk({ power: 'ruined', tokens: 10, program: mover })]);
    const later = tick(state, 120);
    expect(requireRobot(later, 1)).toBe(requireRobot(state, 1));
    const next = sleep(later);
    expect(requireRobot(next, 1)).toMatchObject({ power: 'ruined', tokens: 10, tx: POND.tx, tz: POND.tz });
    expect(next.robots.pool).toBe(60);
    const far = sleep(withRobots(wet(), [sunk({ power: 'ruined' })]));
    expect(texts(far).some((t) => t.endsWith(AWAY))).toBe(false);
    // Ruin happens once: no second log entry or toast the night after.
    expect(far.robots.log.entries).toEqual([]);
    expect(texts(far)).not.toContain(RUINED);
  });

  it('can be fished out, carried and put down, and stays ruined', () => {
    const state = onShore(withRobots(wet(), [sunk({ power: 'ruined' })]));
    expect(describeIntent(planInteraction(state).intent)).toBe('Fish out Sprocket');
    const held = interact(state);
    expect(held.player.carrying).toBe(1);
    const down = interact(withPlayer(held, SHORE, Direction.North, 'farm'));
    expect(requireRobot(down, 1)).toMatchObject({ power: 'ruined', carried: false });
    expect(resumedPower({ power: 'ruined', tokens: 50 })).toBe('ruined');
  });

  it('has its own log lines', () => {
    const entry = { id: 0, day: 1, minute: 360, robotId: 1, tx: POND.tx, tz: POND.tz, event: { kind: 'ruined' as const }, count: 1 };
    expect(robotSays(entry)).toBe('Having a long bath ✓');
    expect(whatHappened(entry, new Map([[1, 'Sprocket']]))).toBe('Spent the night in the water. Ruined: it can only be scrapped.');
  });

  it('refuses a new program, a new .MD, the switch and a paint job', () => {
    const program = b.program({ stacks: [b.when(b.morning(), b.move())] });
    const state = withRobots(BASE, [benchedRobotOf({ power: 'ruined' })]);
    for (const action of [actions.programRobot(1, program), actions.setRobotMd(1, []), actions.switchRobot(1, false), actions.paintRobot(1, 3)]) {
      const next = gameReducer(state, action);
      expect(requireRobot(next, 1), action.type).toBe(requireRobot(state, 1));
      expect(lastText(next), action.type).toBe(ONLY_SCRAP);
      expect(next.player.gold, action.type).toBe(state.player.gold);
    }
  });
});

describe('a new core at the shipping bin', () => {
  /** The player in front of the bin, facing it, holding `robot`. */
  const atBin = (robot: Robot): GameState =>
    withRobots(withPlayer({ ...BASE, player: { ...BASE.player, carrying: 1 } }, { tx: 9, tz: 6 }, Direction.North, 'farm'), [{ ...robot, carried: true }]);

  it('sends a broken robot for a new core', () => {
    const state = atBin(robotOf({ power: 'broken' }));
    expect(describeIntent(planInteraction(state).intent)).toBe('Send Sprocket for a new core · 300g');
    const next = interact(state);
    expect(requireRobot(next, 1)).toMatchObject({ power: 'repairing', repairReadyDay: 1 });
    expect(lastText(next)).toBe('Sprocket is off for a new core. Back tomorrow.');
  });

  it('refuses a ruined robot, gold or no gold', () => {
    for (const gold of [5000, 0]) {
      const state = withGold(atBin(robotOf({ power: 'ruined' })), gold);
      const next = interact(state);
      expect(lastText(next)).toBe('Sprocket is beyond repair. Scrap it at the workbench.');
      expect([next.player.gold, next.player.carrying]).toEqual([gold, 1]);
      expect(requireRobot(next, 1)).toBe(requireRobot(state, 1));
    }
  });
});
```

Create `tests/robotScrapPaint.test.ts`:

```ts
/**
 * The workbench's other jobs (farmclaws part 3 spec §3.3–3.4). Scrapping: gold per size, the
 * robot and its log gone, "a scrapped robot" in other robots' entries, the bench-only rule, ids
 * never reused. Paint: the 16 colours, the cost, the same-colour and short-gold refusals, the
 * toast, and paint never changing what a robot does.
 */
import { describe, expect, it } from 'vitest';
import { ROBOT_CARE, ROBOT_PAINTS } from '../src/config';
import { Direction, type GameState, type Robot, type RobotLogEntry, type RobotLogEvent } from '../src/core/types';
import { addRobot } from '../src/robots/create';
import { whatHappened } from '../src/robots/logText';
import { scrapValue } from '../src/robots/stats';
import { findRobot, requireRobot } from '../src/robots/world';
import { actions } from '../src/state/actions';
import { gameReducer } from '../src/state/reducer';
import { BASE, benchedRobotOf, robotOf, withGold, withRobots } from './testUtils';

const bolt = robotOf({ id: 2, name: 'Bolt', tx: 5, tz: 12 });
const lastMessage = (state: GameState) => state.messages.entries.at(-1);
/** `robots` on the farm with Sprocket's robot screen open at the bench. */
function atBench(robots: readonly Robot[]): GameState {
  const state = withRobots(BASE, robots);
  return { ...state, ui: { ...state.ui, panel: { kind: 'robot', robotId: 1, mode: 'bench' } } };
}
const entry = (id: number, robotId: number, event: RobotLogEvent): RobotLogEntry => ({ id, day: 0, minute: 400, robotId, tx: 5, tz: 12, event, count: 1 });

describe('scrapping', () => {
  it('pays a quarter of the size price, whatever the power', () => {
    expect(ROBOT_CARE).toEqual({ scrapShare: 0.25, paintCost: 50, ruinedShade: 0.45 });
    expect([scrapValue({ size: 'mini' }), scrapValue({ size: 'standard' }), scrapValue({ size: 'big' })]).toEqual([375, 1000, 2500]);
  });

  it('scraps the robot on the bench: gold, the robot and its log gone, the panel closed', () => {
    const log = {
      nextId: 4,
      entries: [
        entry(0, 1, { kind: 'did', action: 'turn', detail: { kind: 'none' } }),
        entry(1, 2, { kind: 'bickered', action: 'harvest', withIds: [1] }),
        entry(2, 1, { kind: 'crashed', withId: 2, forgot: null }),
        entry(3, 2, { kind: 'crashed', withId: 1, forgot: null }),
      ],
    };
    const before = atBench([benchedRobotOf(), bolt]);
    const state: GameState = { ...before, robots: { ...before.robots, log } };
    const next = gameReducer(state, actions.scrapRobot(1));
    expect(next.robots.list).toEqual([bolt]);
    expect(next.robots.list[0]).toBe(bolt);
    expect(next.robots.nextId).toBe(state.robots.nextId);
    expect(next.robots.log).toEqual({ nextId: 4, entries: [log.entries[1], log.entries[3]] });
    expect(next.player.gold).toBe(state.player.gold + 375);
    expect(next.ui.panel).toEqual({ kind: 'none' });
    expect(lastMessage(next)).toMatchObject({ text: 'Scrapped Sprocket for 375g.', tone: 'success' });
    // Bolt's entries now name "a scrapped robot".
    const names = new Map(next.robots.list.map((r) => [r.id, r.name]));
    expect(next.robots.log.entries.map((e) => whatHappened(e, names))).toEqual([
      'Fought a scrapped robot over the same tile. Nobody got it.',
      'Bumped into a scrapped robot and got dizzy.',
    ]);
  });

  it('pays the same for a ruined Big robot, and a new robot never reuses the id', () => {
    const state = atBench([benchedRobotOf({ size: 'big', power: 'ruined', tokens: 0 })]);
    const next = gameReducer(state, actions.scrapRobot(1));
    expect(next.player.gold).toBe(state.player.gold + 2500);
    expect(lastMessage(next)?.text).toBe('Scrapped Sprocket for 2500g.');
    const added = addRobot(next, { name: 'Nova', size: 'mini', parts: [], place: { tx: 5, tz: 12, facing: Direction.South }, program: { kind: 'script', steps: [{ kind: 'move' }], loop: true } });
    if ('error' in added) throw new Error(added.error);
    expect(added.id).toBe(2);
  });

  it('scraps only a robot on the bench', () => {
    const state = atBench([robotOf(), bolt]);
    const next = gameReducer(state, actions.scrapRobot(1));
    expect(next.robots).toBe(state.robots);
    expect(next.player.gold).toBe(state.player.gold);
    expect(lastMessage(next)).toMatchObject({ text: 'Put Sprocket on the workbench first.', tone: 'warn' });
    expect(gameReducer(state, actions.scrapRobot(9))).toBe(state);
  });
});

describe('paint', () => {
  it('offers the 16 base colours, Sunflower first, and new robots wear Sunflower', () => {
    expect(ROBOT_PAINTS.map((p) => p.name)).toEqual([
      'Sunflower', 'Tomato', 'Pumpkin', 'Peach', 'Rose', 'Plum', 'Lavender', 'Sky', 'Ocean', 'Teal', 'Mint', 'Leaf', 'Olive', 'Cocoa', 'Slate', 'Cream',
    ]);
    expect(ROBOT_PAINTS.map((p) => p.color)).toEqual([
      0xf2c14e, 0xe2563f, 0xf28a3a, 0xf4b38a, 0xe87fa3, 0x8e5ba8, 0xa99be0, 0x6fb7e8, 0x2f6fb0, 0x3aa59c, 0x8fdcb0, 0x5fa84a, 0x8a8f3c, 0x8a5a3c, 0x5e6670, 0xece2c6,
    ]);
    const added = addRobot(BASE, { name: 'Nova', size: 'mini', parts: [], place: { tx: 5, tz: 12, facing: Direction.South }, program: { kind: 'script', steps: [{ kind: 'move' }], loop: true } });
    if ('error' in added) throw new Error(added.error);
    expect(requireRobot(added.state, added.id).paint).toBe(0);
  });

  it('paints the robot on the bench for 50g', () => {
    const state = atBench([benchedRobotOf()]);
    const next = gameReducer(state, actions.paintRobot(1, 1));
    expect(requireRobot(next, 1).paint).toBe(1);
    expect(next.player.gold).toBe(state.player.gold - 50);
    expect(lastMessage(next)).toMatchObject({ text: 'Painted Sprocket Tomato.', tone: 'success' });
    expect(next.ui.panel).toEqual(state.ui.panel);
  });

  it('refuses the same colour, a short purse and a robot off the bench', () => {
    const same = atBench([benchedRobotOf({ paint: 15 })]);
    const again = gameReducer(same, actions.paintRobot(1, 15));
    expect(lastMessage(again)).toMatchObject({ text: 'Sprocket is already Cream.', tone: 'warn' });
    expect(again.player.gold).toBe(same.player.gold);

    const poor = withGold(atBench([benchedRobotOf()]), 49);
    const short = gameReducer(poor, actions.paintRobot(1, 7));
    expect(lastMessage(short)?.text).toBe('A paint job costs 50g.');
    expect(requireRobot(short, 1).paint).toBe(0);
    expect(short.player.gold).toBe(49);
    const exact = gameReducer(withGold(poor, 50), actions.paintRobot(1, 7));
    expect([requireRobot(exact, 1).paint, exact.player.gold]).toEqual([7, 0]);

    const field = atBench([robotOf()]);
    const away = gameReducer(field, actions.paintRobot(1, 7));
    expect(lastMessage(away)?.text).toBe('Put Sprocket on the workbench first.');
    expect(requireRobot(away, 1).paint).toBe(0);
  });

  it('ignores a paint outside the 16 and an unknown robot', () => {
    const state = atBench([benchedRobotOf()]);
    for (const paint of [16, -1, 1.5, Number.NaN]) expect(gameReducer(state, actions.paintRobot(1, paint))).toBe(state);
    expect(gameReducer(state, actions.paintRobot(9, 1))).toBe(state);
  });

  it('never changes what a robot does', () => {
    const steps = [{ kind: 'move' as const }, { kind: 'turn' as const, side: 'right' as const }];
    const run = (paint: number): GameState => gameReducer(withRobots(BASE, [robotOf({ paint, program: { kind: 'script', steps, loop: true } })]), actions.tick(120));
    const plain = run(0);
    const painted = run(9);
    expect({ ...requireRobot(painted, 1), paint: 0 }).toEqual(requireRobot(plain, 1));
    expect(painted.robots.log).toEqual(plain.robots.log);
    expect(findRobot(painted, 1)?.paint).toBe(9);
  });
});
```

Append to `tests/robotSaveV6.test.ts` (after its last `describe`). It uses the file's own `loadedFrom`; add to the file's existing import lines whichever of these names they don't import yet: `Blocker` and `type GameState` from `'../src/core/types'`; `deserializeGame` and `serializeGame` from `'../src/state/persistence'`; `blockedTile` from `'../src/world/tiles'` (a new import line if the file has none from there); `BASE`, `must`, `robotOf`, `v5Save`, `withRobots`, `withTile` and `type SaveJson` from `'./testUtils'`.

```ts
describe('save version 6: ruin and paint', () => {
  const POND = { tx: 6, tz: 12 };
  const ROCK = { tx: 8, tz: 12 };

  /** Sprocket ruined in the pond (painted Rose), Bolt ruined on land, Cog painted Cream, and a crashed and a ruined entry. */
  function ruinedAndPainted(): GameState {
    const ground = withTile(withTile(BASE, POND, blockedTile(Blocker.Water), 'farm'), ROCK, blockedTile(Blocker.Rock, 2), 'farm');
    const state = withRobots(ground, [
      robotOf({ id: 1, power: 'ruined', tx: POND.tx, tz: POND.tz, paint: 4 }),
      robotOf({ id: 2, name: 'Bolt', power: 'ruined', tx: 4, tz: 12 }),
      robotOf({ id: 3, name: 'Cog', tx: 3, tz: 12, paint: 15 }),
    ]);
    const entries = [
      { id: 0, day: 0, minute: 380, robotId: 3, tx: 3, tz: 12, event: { kind: 'crashed' as const, withId: 2, forgot: { kind: 'atTime' as const, minute: 840 } }, count: 1 },
      { id: 1, day: 0, minute: 380, robotId: 1, tx: POND.tx, tz: POND.tz, event: { kind: 'ruined' as const }, count: 1 },
    ];
    return { ...state, robots: { ...state.robots, log: { nextId: 2, entries } } };
  }

  /** Serialises `state`, lets `edit` change the saved robots section, and loads it again. */
  function edited(edit: (robots: SaveJson & { list: SaveJson[]; log: SaveJson & { entries: SaveJson[] } }) => void): GameState | null {
    const save = JSON.parse(serializeGame(ruinedAndPainted())) as SaveJson;
    edit(save.robots as SaveJson & { list: SaveJson[]; log: SaveJson & { entries: SaveJson[] } });
    return deserializeGame(JSON.stringify(save));
  }

  it('round-trips ruined robots in the water and on land, paint, and the crashed and ruined events', () => {
    const state = ruinedAndPainted();
    expect(deserializeGame(serializeGame(state))).toEqual(loadedFrom(state));
  });

  it('migrates every robot to paint 0, and v5Save refuses a ruined robot', () => {
    const save = v5Save(withRobots(BASE, [robotOf({ paint: 9 })]));
    expect(((save.robots as SaveJson).list as SaveJson[]).map((r) => 'paint' in r)).toEqual([false]);
    expect(must(deserializeGame(JSON.stringify(save))).robots.list.map((r) => r.paint)).toEqual([0]);
    expect(() => v5Save(ruinedAndPainted())).toThrow('version 5 has no ruined robots');
  });

  it('v5Save refuses the version 6 crashed and ruined log events', () => {
    const entries = ruinedAndPainted().robots.log.entries;
    const logged = (index: number): GameState => {
      const state = withRobots(BASE, [robotOf()]);
      return { ...state, robots: { ...state.robots, log: { nextId: 1, entries: [{ ...entries[index]!, id: 0, robotId: 1 }] } } };
    };
    expect(() => v5Save(logged(0))).toThrow('version 5 has no crashed log events');
    expect(() => v5Save(logged(1))).toThrow('version 5 has no ruined log events');
  });

  const rejections: readonly [string, (robots: SaveJson & { list: SaveJson[]; log: SaveJson & { entries: SaveJson[] } }) => void][] = [
    ['a paint past the 16 colours', (s) => void (s.list[2]!.paint = 16)],
    ['a negative paint', (s) => void (s.list[2]!.paint = -1)],
    ['a fractional paint', (s) => void (s.list[2]!.paint = 1.5)],
    ['a paint that is not a number', (s) => void (s.list[2]!.paint = '3')],
    ['a robot without paint', (s) => void delete s.list[2]!.paint],
    ['a ruined robot on a rock', (s) => void Object.assign(s.list[1]!, { tx: ROCK.tx, tz: ROCK.tz })],
    ['a ruined robot that is off', (s) => void (s.list[1]!.off = 'dizzy')],
    ['a ruined robot with a repair day', (s) => void (s.list[1]!.repairReadyDay = 3)],
    ['an unknown power', (s) => void (s.list[1]!.power = 'rusty')],
    ['a ruined event with a field', (s) => void ((s.log.entries[1]!.event as SaveJson).withId = 2)],
  ];

  it.each(rejections)('rejects %s', (_label, edit) => {
    expect(edited(edit)).toBeNull();
  });
});
```

In `tests/robotRender.test.ts`, replace:

```ts
  sharedTileOffsets,
  startsDizzySpin,
} from '../src/render/robotLayout';
```

with:

```ts
  sharedTileOffsets,
  shellColor,
  sparks,
  startsDizzySpin,
} from '../src/render/robotLayout';
```

replace:

```ts
    expect(robotMeshes(robotOf({ parts: ['claw'] }))).toEqual(['treads', 'body', 'head', 'eyes', 'arm', 'claw']);
    expect(robotMeshes(robotOf({ size: 'big', parts: ['wateringHead', 'basket', 'quickCore'] }))).toEqual(['treads', 'body', 'head', 'eyes', 'arm', 'spout', 'basket', 'coreOrange']);
```

with:

```ts
    expect(robotMeshes(robotOf({ parts: ['claw'] }))).toEqual(['treads', 'body', 'bodyShell', 'head', 'headShell', 'eyes', 'arm', 'claw']);
    expect(robotMeshes(robotOf({ size: 'big', parts: ['wateringHead', 'basket', 'quickCore'] }))).toEqual([
      'treads', 'body', 'bodyShell', 'head', 'headShell', 'eyes', 'arm', 'spout', 'basket', 'coreOrange',
    ]);
```

replace:

```ts
    expect(robotPose('broken', true)).toMatchObject({ sink: 0, tilt: 0, eyes: 'off' });
```

with:

```ts
    expect(robotPose('broken', true)).toMatchObject({ sink: 0, tilt: 0, eyes: 'off' });
    expect(robotPose('ruined', false)).toEqual(robotPose('broken', false));
    expect(robotPose('ruined', true)).toEqual(robotPose('broken', true));
```

replace:

```ts
      ['broken', null, 0],
      ['repairing', null, 0],
```

with:

```ts
      ['broken', null, 0],
      ['ruined', null, 0],
      ['repairing', null, 0],
```

and append at the end of the file:

```ts
describe('paint and ruin (part 3 spec §3.2, §3.4)', () => {
  it("tints the shells with the robot's paint, darkened when it is ruined", () => {
    expect(shellColor({ paint: 0, power: 'working' })).toBe(0xf2c14e);
    expect(shellColor({ paint: 1, power: 'broken' })).toBe(0xe2563f);
    expect(shellColor({ paint: 15, power: 'flat' })).toBe(0xece2c6);
    // Sunflower × 0.45 per channel: 242 → 109, 193 → 87, 78 → 35.
    expect(shellColor({ paint: 0, power: 'ruined' })).toBe(0x6d5723);
    expect(shellColor({ paint: 8, power: 'ruined' })).toBe((Math.round(0x2f * 0.45) << 16) | (Math.round(0x6f * 0.45) << 8) | Math.round(0xb0 * 0.45));
  });

  it('sparks only while broken on the ground: never ruined, never carried', () => {
    expect(sparks({ power: 'broken', carried: false })).toBe(true);
    expect(sparks({ power: 'broken', carried: true })).toBe(false);
    expect(sparks({ power: 'ruined', carried: false })).toBe(false);
    expect(sparks({ power: 'working', carried: false })).toBe(false);
  });
});
```

In `tests/robotLogText.test.ts`, inside `everyEvent()`, replace:

```ts
    { kind: 'repaired' },
```

with:

```ts
    { kind: 'repaired' },
    { kind: 'ruined' },
```

In `tests/robotInteract.test.ts` line 143, replace:

```ts
    expect(lastText(next)).toBe('Sprocket is off to be repaired. Back tomorrow.');
```

with:

```ts
    expect(lastText(next)).toBe('Sprocket is off for a new core. Back tomorrow.');
```

In `tests/robotOvernight.test.ts`, whose broken robot sits in the water overnight and is now ruined, replace:

```ts
  it('brings repaired robots back charged in front of the bin, and keeps broken ones broken', () => {
```

with:

```ts
  it('brings repaired robots back charged in front of the bin, and leaves a robot in the water where it sank', () => {
```

and replace:

```ts
    expect(requireRobot(next, 3)).toMatchObject({ power: 'broken', tx: 6, tz: 10 });
```

with:

```ts
    // A night in the water ruins it (part 3 spec §3.2); it stays where it sank.
    expect(requireRobot(next, 3)).toMatchObject({ power: 'ruined', tx: 6, tz: 10 });
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run tests/robotRuin.test.ts tests/robotScrapPaint.test.ts tests/robotSaveV6.test.ts tests/robotRender.test.ts tests/robotLogText.test.ts tests/robotInteract.test.ts tests/robotOvernight.test.ts`
Expected: FAIL. Among them:
- `robotRuin.test.ts`: "ruins a broken robot …" `expected 'broken' to be 'ruined'`; the bin test `expected 'Send Sprocket for repair · 300g' to be 'Send Sprocket for a new core · 300g'`; the ruined refusal `TypeError: actions.paintRobot is not a function`; the migration test fails at `paint: 0` (`paint` is undefined).
- `robotScrapPaint.test.ts`: `TypeError: scrapValue is not a function`, `TypeError: Cannot read properties of undefined (reading 'map')` (`ROBOT_PAINTS`), `TypeError: actions.scrapRobot is not a function`.
- `robotSaveV6.test.ts`: the round trip `expected null to deeply equal …` (power `'ruined'` and the `paint` key are rejected), and the `v5Save` tests don't throw. (The rejection cases pass already, because the unedited farm doesn't load yet.)
- `robotRender.test.ts`: the mesh lists, `TypeError: shellColor is not a function`, `sparks is not a function`.
- `robotLogText.test.ts`: `expected undefined to match / ✓$/`.
- `robotInteract.test.ts` and `robotOvernight.test.ts`: the old toast and `'broken'` come back.

- [ ] **Step 3: Types in `src/core/types.ts`**

Replace:

```ts
/** What a robot's power is doing. Being carried is separate (`Robot.carried`). */
export const ROBOT_POWERS = ['working', 'standby', 'flat', 'broken', 'repairing'] as const;
```

with:

```ts
/**
 * What a robot's power is doing. Being carried is separate (`Robot.carried`). `ruined`: a broken
 * robot left in the water overnight; it can only be scrapped (farmclaws part 3 spec §3.2).
 */
export const ROBOT_POWERS = ['working', 'standby', 'flat', 'broken', 'repairing', 'ruined'] as const;
```

Replace:

```ts
  readonly lastAction: RobotActionEvent | null;
```

with:

```ts
  readonly lastAction: RobotActionEvent | null;
  /** Index into ROBOT_PAINTS (0 … 15). Presentation only: it never changes what the robot does (part 3 spec §3.4). */
  readonly paint: number;
```

Replace Task 6's:

```ts
  'conflict',
  'crashed',
] as const;
```

with:

```ts
  'conflict',
  'crashed',
  'ruined',
] as const;
```

and replace Task 6's:

```ts
  | { readonly kind: 'crashed'; readonly withId: number; readonly forgot: Trigger | null };
```

with:

```ts
  | { readonly kind: 'crashed'; readonly withId: number; readonly forgot: Trigger | null }
  // A night in the water (part 3 spec §3.2).
  | { readonly kind: 'ruined' };
```

- [ ] **Step 4: Config in `src/config.ts`**

Insert directly after `export const GENERATORS = { … } as const;`:

```ts
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
```

- [ ] **Step 5: `src/robots/stats.ts`**

Replace:

```ts
import { ROBOTS } from '../config';
```

with:

```ts
import { ROBOT_CARE, ROBOT_PAINTS, ROBOTS } from '../config';
import { invariant } from '../core/invariant';
```

Replace:

```ts
/**
 * Power of a robot going back to work, after being put down or each morning (spec §5.7, §5.8):
 * a broken robot stays broken; any other robot works if it has tokens, else it's flat.
 */
export function resumedPower(robot: Pick<Robot, 'power' | 'tokens'>): RobotPower {
  if (robot.power === 'broken') return 'broken';
```

with:

```ts
/**
 * Power of a robot going back to work, after being put down or each morning (spec §5.7, §5.8):
 * a broken robot stays broken and a ruined one ruined (part 3 spec §3.2); any other robot works
 * if it has tokens, else it's flat.
 */
export function resumedPower(robot: Pick<Robot, 'power' | 'tokens'>): RobotPower {
  if (robot.power === 'broken' || robot.power === 'ruined') return robot.power;
```

Append at the end of the file:

```ts
/** Gold for scrapping a robot (part 3 spec §3.3): a share of its size's price, whatever its power. */
export function scrapValue(robot: Pick<Robot, 'size'>): number {
  return Math.round(ROBOTS.sizes[robot.size].price * ROBOT_CARE.scrapShare);
}

/** ROBOT_PAINTS[index]. Saves and the reducer keep `Robot.paint` in range, so a miss is a bug. */
export function paintAt(index: number): (typeof ROBOT_PAINTS)[number] {
  const paint = ROBOT_PAINTS[index];
  invariant(paint !== undefined, `paintAt: no paint ${index}`);
  return paint;
}
```

`putDownPower` needs no change: a ruined robot always has `off: null`, so it goes through `resumedPower`.

- [ ] **Step 6: Ruin in `src/robots/overnight.ts`**

Replace:

```ts
 * generators burn, a carried robot is set down, repairs come back, robots near a generator
 * recharge, and every robot is reset for the morning where it stands. Pure.
```

with:

```ts
 * generators burn, a carried robot is set down, repairs come back, broken robots left in the
 * water are ruined (part 3 spec §3.2), robots near a generator recharge, and every robot is reset
 * for the morning where it stands. Pure.
```

Insert directly above the doc comment of `recharge` (`/**\n * In id order, robots within chargeRadius of a burner …`):

```ts
/**
 * A broken robot still standing in the water at the end of the day (not carried, not on the
 * bench) is ruined (part 3 spec §3.2): logged and noted, in id order. Runs after the carried
 * robot is set down at spawn, so a robot the player is holding is safe.
 */
function ruinSoaked(state: GameState, notes: RobotNote[]): GameState {
  let next = state;
  for (const robot of state.robots.list) {
    if (robot.power !== 'broken' || robot.carried || robot.onBench) continue;
    if (getTile(state.maps.farm, robot.tx, robot.tz)?.blocker !== Blocker.Water) continue;
    next = logRobotEvent(withRobot(next, { ...robot, power: 'ruined' }), robot.id, { kind: 'ruined' });
    notes.push({ text: `${robot.name} spent the night in the water and is ruined. Scrap it at the workbench.`, tone: 'warn' });
  }
  return next;
}

```

In `recharge`, replace:

```ts
 * In id order, robots within chargeRadius of a burner fill up from the pool. Every other robot
 * that isn't broken or away at repairs (even a full one) is named as having missed out. A robot
```

with:

```ts
 * In id order, robots within chargeRadius of a burner fill up from the pool. Every other robot
 * that isn't broken, ruined or away at repairs (even a full one) is named as having missed out. A robot
```

and:

```ts
    if (robot.power === 'broken' || robot.power === 'repairing' || returned.has(robot.id)) continue;
```

with:

```ts
    if (robot.power === 'broken' || robot.power === 'ruined' || robot.power === 'repairing' || returned.has(robot.id)) continue;
```

In `resetForMorning`, replace Task 5's two lines:

```ts
    // A robot on the workbench stays on it (part 3 spec §2.2); the bench tile itself isn't walkable.
    const standable = robot.onBench || (tile !== null && (isWalkable(tile) || (robot.power === 'broken' && inWater)));
```

with:

```ts
    // A broken or ruined robot may stay sunk in the water (part 3 spec §3.2).
    const sunk = robot.power === 'broken' || robot.power === 'ruined';
    // A robot on the workbench stays on it (part 3 spec §2.2); the bench tile itself isn't walkable.
    const standable = robot.onBench || (tile !== null && (isWalkable(tile) || (sunk && inWater)));
```

In `runRobotsOvernight`, replace:

```ts
  let next = recharge(repaired.state, burned.burners, repaired.returned, notes);
```

with:

```ts
  let next = recharge(ruinSoaked(repaired.state, notes), burned.burners, repaired.returned, notes);
```

- [ ] **Step 7: Log text in `src/robots/logText.ts`**

Replace:

```ts
  const list = ids.map((id) => names.get(id) ?? `robot ${id}`);
```

with:

```ts
  // A robot missing from the farm was scrapped (part 3 spec §3.3); ids are never reused.
  const list = ids.map((id) => names.get(id) ?? 'a scrapped robot');
```

In `robotSays`, replace Task 6's:

```ts
    case 'crashed':
      return 'Made a new friend ✓';
```

with:

```ts
    case 'crashed':
      return 'Made a new friend ✓';
    case 'ruined':
      return 'Having a long bath ✓';
```

In `whatHappened`, replace Task 6's:

```ts
      return event.forgot === null ? bumped : `${bumped} Forgot everything under "When ${triggerText(event.forgot)}".`;
    }
```

with:

```ts
      return event.forgot === null ? bumped : `${bumped} Forgot everything under "When ${triggerText(event.forgot)}".`;
    }
    case 'ruined':
      return 'Spent the night in the water. Ruined: it can only be scrapped.';
```

- [ ] **Step 8: Edits, new robots and the new core**

In `src/robots/edits.ts`, replace:

```ts
const KEPT_POWERS: ReadonlySet<Robot['power']> = new Set<Robot['power']>(['flat', 'broken', 'repairing']);
```

with:

```ts
const KEPT_POWERS: ReadonlySet<Robot['power']> = new Set<Robot['power']>(['flat', 'broken', 'repairing', 'ruined']);
```

(The `setProgram` dev hook isn't limited to benched or working robots, so a ruined robot it reprograms stays ruined.)

The two doc comments that describe it say so too. Replace:

```ts
/** Powers a new program doesn't change: the robot needs charging, rescuing or repairing first. */
```

with:

```ts
/** Powers a new program doesn't change: the robot needs charging, rescuing or repairing first, or can only be scrapped (ruined). */
```

and, in `programmedRobot`'s doc comment, replace:

```ts
 * the robot turns back on and acts one period from now; a flat, broken or repairing robot keeps
 * its power. Returns the checker's sentence instead when the program fails, or PROGRAM_SHAPE when
```

with:

```ts
 * the robot turns back on and acts one period from now; a flat, broken, repairing or ruined robot
 * keeps its power. Returns the checker's sentence instead when the program fails, or PROGRAM_SHAPE when
```

In `src/robots/create.ts`'s `addRobot`, replace:

```ts
    lastAction: null,
```

with:

```ts
    lastAction: null,
    paint: 0,
```

In `src/state/intents.ts`, replace:

```ts
  /** Send the carried broken robot for repair from the shipping bin. */
```

with:

```ts
  /** Send the carried broken robot for a new core from the shipping bin (part 3 spec §3.2). */
```

in `planCarry` replace:

```ts
    if (robot.power !== 'broken') return blocked(target, 'place', 'Only broken robots go for repair.');
```

with:

```ts
    if (robot.power === 'ruined') return blocked(target, 'place', `${robot.name} is beyond repair. Scrap it at the workbench.`);
    if (robot.power !== 'broken') return blocked(target, 'place', 'Only broken robots go for repair.');
```

and in `describeIntent` replace:

```ts
      return `Send ${intent.name} for repair · ${intent.cost}g`;
```

with:

```ts
      return `Send ${intent.name} for a new core · ${intent.cost}g`;
```

- [ ] **Step 9: Actions in `src/state/actions.ts`**

Add these members to the `GameAction` union, after Task 5's `robot/switch` member:

```ts
  /** Scraps the robot on the workbench for gold (farmclaws part 3 spec §3.3). */
  | { readonly type: 'robot/scrap'; readonly robotId: number }
  /** Paints the robot on the workbench ROBOT_PAINTS[paint] (part 3 spec §3.4). */
  | { readonly type: 'robot/paint'; readonly robotId: number; readonly paint: number }
```

and these creators to `actions`, after `switchRobot`:

```ts
  scrapRobot: (robotId: number): GameAction => ({ type: 'robot/scrap', robotId }),
  paintRobot: (robotId: number, paint: number): GameAction => ({ type: 'robot/paint', robotId, paint }),
```

(If `robot/switch` is the union's last member, move its terminating `;` to the new last member.)

- [ ] **Step 10: The reducer, `src/state/reducer.ts`**

Imports: the `'../config'` import also names `ROBOT_CARE` and `ROBOT_PAINTS`; the `'../robots/stats'` import also names `paintAt` and `scrapValue`; make sure `findRobot` (Task 2) is in the `'../robots/world'` import and `type Robot` (Task 2) in the `'../core/types'` import.

In `applyIntent`'s `repairRobot` case, replace:

```ts
      return pushMessage(sent, `${robot.name} is off to be repaired. Back tomorrow.`, 'info');
```

with:

```ts
      return pushMessage(sent, `${robot.name} is off for a new core. Back tomorrow.`, 'info');
```

In `gameReducer`, add after Task 5's `'robot/switch'` case:

```ts
    case 'robot/scrap':
      return scrapRobot(state, action.robotId);
    case 'robot/paint':
      return paintRobot(state, action.robotId, action.paint);
```

Insert directly above the doc comment of Task 2's `editRobot`:

```ts
/** The refusal for a ruined robot, which can only be scrapped (part 3 spec §3.2), or null for any other. */
function ruinedRefusal(state: GameState, robot: Robot): GameState | null {
  return robot.power === 'ruined' ? pushMessage(state, `${robot.name} is ruined. It can only be scrapped.`, 'warn') : null;
}

```

In `editRobot`, insert directly above `  const edited = edit(robot);` (so after Task 5's bench-only check):

```ts
  const ruined = ruinedRefusal(state, robot);
  if (ruined !== null) return ruined;
```

In Task 5's `switchRobot`, insert the same two lines between the bench refusal and the `on` branch, so it reads:

```ts
  const away = offBenchRefusal(robot);
  if (away !== null) return pushMessage(state, away, 'warn');
  const ruined = ruinedRefusal(state, robot);
  if (ruined !== null) return ruined;
  if (on) return robot.off === 'player' ? withRobot(state, { ...robot, off: null }) : state;
```

`scrapRobot` and `paintRobot` below reuse Task 5's `offBenchRefusal(robot)` for their bench check.

Insert directly above the doc comment of `loadState`:

```ts
// ---------------------------------------------------------------------------
// The workbench's other jobs (farmclaws part 3 spec §3.3–3.4)
// ---------------------------------------------------------------------------

/**
 * `robot/scrap`: the robot on the bench leaves the farm with its own log entries, the player gets
 * scrapValue in gold, and the open panel closes. Ids (and log ids) are never reused.
 */
function scrapRobot(state: GameState, robotId: number): GameState {
  const robot = findRobot(state, robotId);
  if (robot === null) return state;
  const away = offBenchRefusal(robot);
  if (away !== null) return pushMessage(state, away, 'warn');
  const gold = scrapValue(robot);
  const { log } = state.robots;
  const next: GameState = {
    ...state,
    player: { ...state.player, gold: state.player.gold + gold },
    robots: {
      ...state.robots,
      list: state.robots.list.filter((r) => r.id !== robotId),
      log: { ...log, entries: log.entries.filter((e) => e.robotId !== robotId) },
    },
    ui: state.ui.panel.kind === 'none' ? state.ui : { ...state.ui, panel: { kind: 'none' } },
  };
  return pushMessage(next, `Scrapped ${robot.name} for ${gold}g.`, 'success');
}

/** `robot/paint`: a coat of ROBOT_PAINTS[paint] for ROBOT_CARE.paintCost gold. A paint outside the list does nothing. */
function paintRobot(state: GameState, robotId: number, paint: number): GameState {
  const robot = findRobot(state, robotId);
  if (robot === null || !Number.isInteger(paint) || paint < 0 || paint >= ROBOT_PAINTS.length) return state;
  const away = offBenchRefusal(robot);
  if (away !== null) return pushMessage(state, away, 'warn');
  const ruined = ruinedRefusal(state, robot);
  if (ruined !== null) return ruined;
  const colour = paintAt(paint).name;
  if (robot.paint === paint) return pushMessage(state, `${robot.name} is already ${colour}.`, 'warn');
  const cost = ROBOT_CARE.paintCost;
  if (state.player.gold < cost) return pushMessage(state, `A paint job costs ${cost}g.`, 'warn');
  const painted = withRobot({ ...state, player: { ...state.player, gold: state.player.gold - cost } }, { ...robot, paint });
  return pushMessage(painted, `Painted ${robot.name} ${colour}.`, 'success');
}

```

- [ ] **Step 11: Saves**

In `src/state/robotValidation.ts`, add `ROBOT_PAINTS` to the `'../config'` import. In `ROBOT_KEYS`, replace (Task 3's line; keep any key Task 5 added):

```ts
  'exec', 'md', 'off', 'nextActMinute', 'repairReadyDay', 'stats', 'moveSeq', 'teleportSeq', 'actionSeq', 'lastAction',
```

with:

```ts
  'exec', 'md', 'off', 'nextActMinute', 'repairReadyDay', 'stats', 'moveSeq', 'teleportSeq', 'actionSeq', 'lastAction', 'paint',
```

In `isValidRobot`, replace Task 5's line:

```ts
  if (!isOneOf(v.power, ROBOT_POWERS) || !isBool(v.carried) || !isBool(v.onBench)) return false;
```

with:

```ts
  if (!isOneOf(v.power, ROBOT_POWERS) || !isBool(v.carried) || !isBool(v.onBench)) return false;
  if (!isIntIn(v.paint, 0, ROBOT_PAINTS.length - 1)) return false;
```

and replace:

```ts
  if (v.power === 'broken') return tile.blocker === Blocker.Water || isWalkable(tile);
```

with:

```ts
  // A ruined robot is placed like a broken one (part 3 spec §9.2); the off and repairReadyDay rules above already hold it to null.
  if (v.power === 'broken' || v.power === 'ruined') return tile.blocker === Blocker.Water || isWalkable(tile);
```

In `src/state/persistence.ts`, `migrateRobotV5` (Task 3, extended by Task 5 with `onBench: false`) also gives the robot `paint: 0`. In its doc comment, replace:

```ts
/** A v5 robot as a v6 one: `tokensToday` becomes today's and this week's tokens, with no actions or crops counted, and off the bench. */
```

with:

```ts
/** A v5 robot as a v6 one: `tokensToday` becomes today's and this week's tokens, with no actions or crops counted, and off the bench, with paint 0. */
```

and append `, paint: 0` to Task 5's return line, replacing:

```ts
  return { ...rest, onBench: false, stats: { today: { tokens: tokensToday, actions: 0, crops: 0 }, week: { tokens: tokensToday, actions: 0, crops: 0 } } };
```

with:

```ts
  return { ...rest, onBench: false, stats: { today: { tokens: tokensToday, actions: 0, crops: 0 }, week: { tokens: tokensToday, actions: 0, crops: 0 } }, paint: 0 };
```

(Migration never ruins a robot: a v5 broken robot in the water stays broken until the next morning reset.)

In `tests/testUtils.ts`, in `robotOf` replace:

```ts
    lastAction: null,
```

with:

```ts
    lastAction: null,
    paint: 0,
```

and in `v5Save`'s per-robot loop (Task 3's), replace:

```ts
    robot.tokensToday = today.tokens;
    delete robot.stats;
```

with:

```ts
    robot.tokensToday = today.tokens;
    delete robot.stats;
    // Ruin and paint (part 3 spec §3.2, §3.4): version 5 has no ruined power and no paint.
    if (robot.power === 'ruined') throw new Error(`v5Save: version 5 has no ruined robots (robot ${String(robot.id)})`);
    delete robot.paint;
```

Directly above Task 4's comment line `  // Unlocks: a v5 save has none; the migration gives it job 1's.`, insert (the `crashed` and `ruined` log events are version 6's, part 3 spec §3.1 and §3.2):

```ts
  // Log: version 5 has no crashed or ruined events.
  for (const entry of (save.robots as { log: { entries: SaveJson[] } }).log.entries) {
    const kind = (entry.event as { kind: string }).kind;
    if (kind === 'crashed' || kind === 'ruined') throw new Error(`v5Save: version 5 has no ${kind} log events (log entry ${String(entry.id)})`);
  }
```

- [ ] **Step 12: Render rules in `src/render/robotLayout.ts`**

Replace (Task 5 already made the import line `import { TIME, WORKBENCH } from '../config';`):

```ts
 * Part 2 spec §9 adds the dizzy spin and how bright a robot's eyes are while it is off.
 */
import { TIME, WORKBENCH } from '../config';
import type { Robot, RobotActionEvent, RobotActionKind, RobotPartId, RobotPower, RobotSize } from '../core/types';
import { periodFor } from '../robots/stats';
```

with:

```ts
 * Part 2 spec §9 adds the dizzy spin and how bright a robot's eyes are while it is off. Part 3
 * spec §3.2 and §3.4 add the painted shells and the ruined look.
 */
import { ROBOT_CARE, TIME, WORKBENCH } from '../config';
import type { Robot, RobotActionEvent, RobotActionKind, RobotPartId, RobotPower, RobotSize } from '../core/types';
import { paintAt, periodFor } from '../robots/stats';
```

Replace:

```ts
export const ROBOT_MESH_IDS = [
  'treads', 'body', 'head', 'eyes', 'arm', 'claw', 'spout', 'tines', 'hopper', 'basket', 'antenna', 'lens', 'coreGreen', 'coreOrange',
] as const;
```

with:

```ts
export const ROBOT_MESH_IDS = [
  'treads', 'body', 'bodyShell', 'head', 'headShell', 'eyes', 'arm', 'claw', 'spout', 'tines', 'hopper', 'basket', 'antenna', 'lens', 'coreGreen', 'coreOrange',
] as const;
```

Replace:

```ts
  return ['treads', 'body', 'head', 'eyes', 'arm', ...robot.parts.map((p) => PART_MESH[p])];
```

with:

```ts
  return ['treads', 'body', 'bodyShell', 'head', 'headShell', 'eyes', 'arm', ...robot.parts.map((p) => PART_MESH[p])];
```

In `robotPose`, replace:

```ts
    case 'broken':
      return { sink: BROKEN_SINK, tilt: BROKEN_TILT, headPitch: BROKEN_HEAD_PITCH, eyes, visible: true };
```

with:

```ts
    case 'broken':
    case 'ruined':
      return { sink: BROKEN_SINK, tilt: BROKEN_TILT, headPitch: BROKEN_HEAD_PITCH, eyes, visible: true };
```

In `eyeLevel`, replace:

```ts
  if (power === 'flat' || power === 'broken' || power === 'repairing') return EYE_OUT;
```

with:

```ts
  if (power === 'flat' || power === 'broken' || power === 'ruined' || power === 'repairing') return EYE_OUT;
```

Append at the end of the file:

```ts
// ---------------------------------------------------------------------------
// Paint and ruin (farmclaws part 3 spec §3.2, §3.4)
// ---------------------------------------------------------------------------

/** Whether a robot throws sparks: broken and on the ground. A ruined robot is past sparking. */
export function sparks(robot: Pick<Robot, 'power' | 'carried'>): boolean {
  return robot.power === 'broken' && !robot.carried;
}

/** The colour of a robot's painted shells: its paint, each channel × ROBOT_CARE.ruinedShade (rounded) when it is ruined. */
export function shellColor(robot: Pick<Robot, 'paint' | 'power'>): number {
  const color = paintAt(robot.paint).color;
  if (robot.power !== 'ruined') return color;
  const channel = (shift: number): number => Math.round(((color >> shift) & 0xff) * ROBOT_CARE.ruinedShade) << shift;
  return channel(16) | channel(8) | channel(0);
}
```

- [ ] **Step 13: Shell geometry in `src/render/robotGeometry.ts`**

Replace:

```ts
 * facing +Z, feet at y = 0. One merged, vertex-painted geometry per mesh id; eyes and particles
 * are unpainted and take their colour from the instance.
```

with:

```ts
 * facing +Z, feet at y = 0. One merged, vertex-painted geometry per mesh id; eyes and particles
 * are unpainted and take their colour from the instance, and the body and head shells are white
 * and take the robot's paint from the instance (farmclaws part 3 spec §3.4).
```

Replace:

```ts
export const ROBOT_COLORS = {
  body: 0xf2c14e,
```

with:

```ts
export const ROBOT_COLORS = {
  /** The painted shells are authored white; the robot's paint (ROBOT_PAINTS, Sunflower first) is their instance colour. */
  shell: 0xffffff,
```

Replace:

```ts
export const HEAD_MESHES: ReadonlySet<RobotMeshId> = new Set<RobotMeshId>(['head', 'eyes', 'antenna', 'lens']);
```

with:

```ts
export const HEAD_MESHES: ReadonlySet<RobotMeshId> = new Set<RobotMeshId>(['head', 'headShell', 'eyes', 'antenna', 'lens']);
/** The painted shells of the body and head: white geometry tinted per instance with the robot's paint. */
export const SHELL_MESHES: ReadonlySet<RobotMeshId> = new Set<RobotMeshId>(['bodyShell', 'headShell']);
```

Replace:

```ts
    case 'body':
      return mergeParts(
        [box(0.36, 0.24, 0.3, { y: 0.22 }, c.body), box(0.38, 0.03, 0.32, { y: 0.335 }, c.trim), box(0.1, 0.04, 0.1, { y: 0.36 }, c.metal)],
        'robot body',
      );
    case 'head':
      return mergeParts([box(0.28, 0.18, 0.24, { y: 0.47 }, c.body), box(0.3, 0.03, 0.26, { y: 0.565 }, c.trim)], 'robot head');
```

with:

```ts
    case 'body':
      return mergeParts([box(0.38, 0.03, 0.32, { y: 0.335 }, c.trim), box(0.1, 0.04, 0.1, { y: 0.36 }, c.metal)], 'robot body');
    case 'bodyShell':
      return mergeParts([box(0.36, 0.24, 0.3, { y: 0.22 }, c.shell)], 'robot body shell');
    case 'head':
      return mergeParts([box(0.3, 0.03, 0.26, { y: 0.565 }, c.trim)], 'robot head');
    case 'headShell':
      return mergeParts([box(0.28, 0.18, 0.24, { y: 0.47 }, c.shell)], 'robot head shell');
```

- [ ] **Step 14: Instance colours in `src/render/RobotRenderer.ts`**

Replace:

```ts
import { HEAD_MESHES, NECK_Y, createBadgeGeometry, createParticleGeometry, createRobotMeshGeometry } from './robotGeometry';
```

with:

```ts
import { HEAD_MESHES, NECK_Y, SHELL_MESHES, createBadgeGeometry, createParticleGeometry, createRobotMeshGeometry } from './robotGeometry';
```

In the `./robotLayout` import, replace:

```ts
  sharedTileOffsets,
  startsDizzySpin,
```

with:

```ts
  sharedTileOffsets,
  shellColor,
  sparks,
  startsDizzySpin,
```

Replace:

```ts
  private readonly visuals = new Map<number, Visual>();
```

with:

```ts
  private readonly visuals = new Map<number, Visual>();
  /** The shell colour last written for each robot, so instance colours change only with its paint or ruin. */
  private readonly shellColors = new Map<number, number>();
```

In the constructor, replace:

```ts
      meshes[id] = new InstanceSlotMap(mesh, eyes);
```

with:

```ts
      // Eyes and the painted shells take their colour from the instance.
      meshes[id] = new InstanceSlotMap(mesh, eyes || SHELL_MESHES.has(id));
```

In `sync`, replace:

```ts
        this.visuals.delete(id);
```

with:

```ts
        this.visuals.delete(id);
        this.shellColors.delete(id);
```

In `clearAll`, replace:

```ts
  private clearAll(): void {
    this.visuals.clear();
```

with:

```ts
  private clearAll(): void {
    this.visuals.clear();
    this.shellColors.clear();
```

Replace the whole of `syncMeshes`:

```ts
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
    if (!visible) this.badges.remove(robot.id);
  }
```

with:

```ts
  /**
   * Adds or removes this robot's instance on every mesh to match its parts and visibility, then
   * tints its two shells when their instances are new or its shell colour (paint or ruin) changed.
   * Runs on sync only, never per frame.
   */
  private syncMeshes(robot: Robot): void {
    const wanted = new Set(robotMeshes(robot));
    const visible = robotPose(robot.power, robot.carried).visible;
    let added = false;
    for (const id of ROBOT_MESH_IDS) {
      const map = this.meshes[id];
      if (visible && wanted.has(id)) {
        if (!map.has(robot.id)) {
          map.set(robot.id, m.identity());
          added = true;
        }
      } else {
        map.remove(robot.id);
      }
    }
    if (!visible) {
      this.badges.remove(robot.id);
      return;
    }
    const shell = shellColor(robot);
    if (!added && this.shellColors.get(robot.id) === shell) return;
    color.setHex(shell);
    this.meshes.bodyShell.setColor(robot.id, color);
    this.meshes.headShell.setColor(robot.id, color);
    this.shellColors.set(robot.id, shell);
  }
```

In the header comment, replace:

```ts
 *   bickers show a red badge; broken robots spark; working robots bob gently.
```

with:

```ts
 *   bickers show a red badge; broken robots spark (ruined ones don't); working robots bob gently.
 * - Each robot's body and head shells are drawn in its paint colour, darkened when it is ruined
 *   (robotLayout.shellColor); their instance colours are written only when that colour changes.
```

In `animate`, replace:

```ts
    if (robot.power === 'broken' && !robot.carried) {
```

with:

```ts
    if (sparks(robot)) {
```

(The shared `painted` material already has `vertexColors: true`; three.js multiplies the white vertex colour by the instance colour, and compiles the shells' program with instance colours because their buffer exists before the first render.)

- [ ] **Step 15: Run them and see them pass**

Run: `npx vitest run tests/robotRuin.test.ts tests/robotScrapPaint.test.ts tests/robotSaveV6.test.ts tests/robotRender.test.ts tests/robotLogText.test.ts tests/robotInteract.test.ts tests/robotOvernight.test.ts tests/robotBump.test.ts tests/robotDev.test.ts tests/robotSave.test.ts tests/robotSaveV5.test.ts`
Expected: PASS (`robotRuin.test.ts`: 11 tests, `robotScrapPaint.test.ts`: 9 tests, the appended save block: 13 tests).

- [ ] **Step 16: The full gate**

Run: `npm run typecheck && npm test && npm run build`
Expected: PASS. Every exhaustive `switch` over `RobotPower` (only `robotPose`) has its `'ruined'` case; `grep -rn "'broken'" src` shows every other comparison was checked: `isDue` (needs working/standby), `resumedPower`, `recharge`, `resetForMorning`, `planCarry`, `eyeLevel`, `isValidRobot`, `KEPT_POWERS` and the renderer's spark check (now `sparks`).

- [ ] **Step 17: Commit**

```bash
git add src/core/types.ts src/config.ts src/robots/stats.ts src/robots/overnight.ts src/robots/logText.ts src/robots/edits.ts src/robots/create.ts src/state/intents.ts src/state/actions.ts src/state/reducer.ts src/state/robotValidation.ts src/state/persistence.ts src/render/robotLayout.ts src/render/robotGeometry.ts src/render/RobotRenderer.ts tests/testUtils.ts tests/robotRuin.test.ts tests/robotScrapPaint.test.ts tests/robotSaveV6.test.ts tests/robotRender.test.ts tests/robotLogText.test.ts tests/robotInteract.test.ts tests/robotOvernight.test.ts
git commit -m "Farmclaws part 3: ruin overnight in the water, the new core, scrapping and paint

A broken robot still in the water at the morning reset is ruined: it never acts or
recharges, the bin refuses it, and it can only be scrapped. The bin's repair is now a
new core. robot/scrap pays a quarter of the size price and drops the robot and its log;
other entries name 'a scrapped robot'. robot/paint costs 50g for one of 16 base colours,
drawn on new white body and head shells tinted per instance.

Saves gain Robot.paint (0 on migration); v5Save refuses ruined robots.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Peek

**Files:**
- Create: `tests/robotPeek.test.ts`
- Modify: `src/state/actions.ts` (`GameAction` after `player/interact`, ~line 15; `actions` after `interact`, ~line 39)
- Modify: `src/state/intents.ts` (`Intent` union, last member ~line 66 plus Task 5's and Task 7's members; new `planShiftInteraction` above `describeIntent`, ~line 461; `describeIntent`'s `blocked` case, ~line 504)
- Modify: `src/state/reducer.ts` (`./intents` import, line 53; `gameReducer`'s `player/interact` case, ~line 87; `applyIntent` above the `fuel` case, ~line 427)
- Modify: `src/input/panelKeys.ts` (header comment lines 4–7; `panelKeyCommand`, ~lines 29–35)
- Modify: `src/input/InputController.ts` (header comment ~line 11; `InputControllerOptions` ~line 50; fields ~line 157; constructor ~line 177; `onKeyDown` / `onKeyUp` ~lines 254–264; `handleKeyDown` ~line 297; `onPointerDown` ~line 377; `releaseAll` ~line 451)
- Modify: `src/ui/Hud.ts` (`../state/intents` import, line 41; `ContextHint`, ~lines 528–580; `Hud` fields, `sync` and a new `setShiftHeld`, ~lines 1128–1215)
- Modify: `src/main.ts` (the `InputController` construction, ~line 107)
- Test: `tests/robotPeek.test.ts` (new), `tests/panelKeys.test.ts` (extend)

**Interfaces:**
- Consumes:
  - Task 5: `UiPanel` `{ kind: 'robot'; robotId: number; mode: 'bench' | 'peek' }`; the `'workbench'` placed object; `WORKBENCH.home` in config; `Robot.onBench`; `robotsOnTile` excluding benched robots; the `openBench` / `benchRobot` intents and `planInteraction`'s private `planBench`, run before `planPickUpRobot` (an empty bench is a blocked plan with `hint` "Bring a robot here to work on it"); the `blocked` intent's optional `hint`, which `describeIntent` returns; `off: 'player'`.
  - Part 1–2: `planInteraction`, `executePlan`, `selectTargetTile`, `robotsOnTile`, `selectIsFrozen`, `describeIntent`; test helpers `BASE`, `TARGET`, `robotOf`, `scenario`, `withEnergy`, `withPlayer`, `withRobots`.
- Produces:
  - `src/state/intents.ts`: `Intent` gains `{ readonly kind: 'peekRobot'; readonly robotId: number; readonly name: string }`, described "Look at {name}"; `export function planShiftInteraction(state: GameState): ActionPlan`, in this order: (1) a workbench object on the tile ahead → `planInteraction(state)`; (2) on the farm, a standing robot ahead (`robotsOnTile(state, target.tx, target.tz)[0]`, the lowest id) → `peekRobot` with feedback `'none'` and energy 0; (3) otherwise `blocked(target, 'none')` (silent). Task 9 inserts the marker's clear-zone step before (3).
  - `src/state/actions.ts`: `{ type: 'player/peek' }`, `actions.peek(): GameAction`. The reducer ignores it while frozen and otherwise runs `executePlan(state, planShiftInteraction(state))`; `peekRobot` sets `ui.panel` to `{ kind: 'robot', robotId, mode: 'peek' }` and nothing else (no energy, no gold, the robot untouched).
  - `src/input/panelKeys.ts`: `export function panelKeyCommand(code: string, state: GameState, shift = false): PanelKeyCommand | null`. An interact key closes an open inventory or chest as before; otherwise it is `actions.peek()` with `shift` and `actions.interact()` without.
  - `src/input/InputController.ts`: `InputControllerOptions.onShiftChange?: (held: boolean) => void`, called whenever the tracked Shift state flips (key down, key up, and `false` when held keys are cleared on blur, a hidden page or Cmd release). `event.shiftKey` goes to `panelKeyCommand`; Shift + right-click dispatches `actions.peek()`.
  - `src/ui/Hud.ts`: `Hud.setShiftHeld(held: boolean): void`. While Shift is held, `ContextHint`'s interact chip shows the key "Shift + E" and `describeIntent(planShiftInteraction(state).intent)`, and never merges with the Space chip.
  - `src/main.ts`: `onShiftChange: (held) => hud.setShiftHeld(held)`.

- [ ] **Step 1: Write the failing tests**

Create `tests/robotPeek.test.ts`:

```ts
/**
 * Peek (farmclaws part 3 spec §2.3): Shift + E on a standing robot opens its screen read-only,
 * for free, and changes nothing else. The workbench ahead keeps E's meaning, and with nothing
 * to peek at Shift + E does nothing at all, even where E would.
 */
import { describe, expect, it } from 'vitest';
import { INVENTORY, WORKBENCH } from '../src/config';
import { Blocker, Direction, type GameState } from '../src/core/types';
import { actions } from '../src/state/actions';
import { describeIntent, planInteraction, planShiftInteraction } from '../src/state/intents';
import { gameReducer } from '../src/state/reducer';
import { EMPTY_TILE, blockedTile } from '../src/world/tiles';
import { BASE, TARGET, robotOf, scenario, withEnergy, withPlayer, withRobots } from './testUtils';

const peek = (state: GameState): GameState => gameReducer(state, actions.peek());

/** Sprocket (id 1) standing on TARGET, the tile ahead of the player. */
const FIELD = withRobots(scenario(EMPTY_TILE), [robotOf()]);

/** The player just south of the workbench, facing it. */
const atBench = (state: GameState): GameState =>
  withPlayer(state, { tx: WORKBENCH.home.tx, tz: WORKBENCH.home.tz + 1 }, Direction.North);

describe('peeking at a robot', () => {
  it('plans a free peek at the standing robot ahead, hinted "Look at {name}"', () => {
    expect(planShiftInteraction(FIELD)).toEqual({
      target: TARGET,
      intent: { kind: 'peekRobot', robotId: 1, name: 'Sprocket' },
      feedback: 'none',
      energyCost: 0,
    });
    expect(describeIntent(planShiftInteraction(FIELD).intent)).toBe('Look at Sprocket');
  });

  it('opens the robot screen in peek mode and leaves the robot, energy and gold alone', () => {
    const tired = withEnergy(FIELD, 0);
    const next = peek(tired);
    expect(next.ui.panel).toEqual({ kind: 'robot', robotId: 1, mode: 'peek' });
    expect(next.robots).toBe(tired.robots);
    expect(next.player.energy).toBe(0);
    expect(next.player.gold).toBe(tired.player.gold);
    expect(next.player.carrying).toBeNull();
    expect(next.maps).toBe(tired.maps);
    expect(next.inventory).toBe(tired.inventory);
    expect(next.time).toBe(tired.time);
    expect(next.messages).toBe(tired.messages);
  });

  it('peeks at broken, dizzy and switched-off robots too: they still stand there', () => {
    const sunk = withRobots(scenario(blockedTile(Blocker.Water)), [robotOf({ power: 'broken' })]);
    expect(planShiftInteraction(sunk).intent).toEqual({ kind: 'peekRobot', robotId: 1, name: 'Sprocket' });
    for (const off of ['dizzy', 'player'] as const) {
      const state = withRobots(scenario(EMPTY_TILE), [robotOf({ off })]);
      expect(planShiftInteraction(state).intent).toEqual({ kind: 'peekRobot', robotId: 1, name: 'Sprocket' });
    }
  });

  it('peeks at the lowest id when robots share the tile', () => {
    const shared = withRobots(scenario(EMPTY_TILE), [robotOf({ id: 2, name: 'Bolt' }), robotOf({ id: 5, name: 'Dee' })]);
    expect(planShiftInteraction(shared).intent).toEqual({ kind: 'peekRobot', robotId: 2, name: 'Bolt' });
  });

  it('does nothing without a standing robot ahead, even where E would act', () => {
    const away = withRobots(scenario(EMPTY_TILE), [robotOf({ power: 'repairing', repairReadyDay: BASE.time.absoluteDay + 1 })]);
    const chest = scenario({ ...EMPTY_TILE, object: { kind: 'chest', slots: Array.from({ length: INVENTORY.chestSlots }, () => null) } });
    expect(planInteraction(chest).intent).toEqual({ kind: 'openChest' });
    for (const state of [away, chest, scenario(EMPTY_TILE)]) {
      expect(planShiftInteraction(state)).toEqual({ target: TARGET, intent: { kind: 'blocked', reason: null }, feedback: 'none', energyCost: 0 });
      expect(peek(state)).toBe(state);
    }
  });

  it('does nothing facing the edge of the world', () => {
    const atEdge = withPlayer(BASE, { tx: 5, tz: 0 }, Direction.North);
    expect(planShiftInteraction(atEdge)).toEqual({ target: null, intent: { kind: 'blocked', reason: null }, feedback: 'none', energyCost: 0 });
    expect(peek(atEdge)).toBe(atEdge);
  });

  it('is ignored while the game is frozen', () => {
    const open = gameReducer(FIELD, actions.setInventoryOpen(true));
    const paused = gameReducer(FIELD, actions.setPaused(true));
    expect(peek(open)).toBe(open);
    expect(peek(paused)).toBe(paused);
  });
});

describe('Shift + E at the workbench', () => {
  it('does exactly what E does there, never a peek', () => {
    const benched = withRobots(BASE, [robotOf({ tx: WORKBENCH.home.tx, tz: WORKBENCH.home.tz, onBench: true })]);
    const carrying = withRobots({ ...BASE, player: { ...BASE.player, carrying: 1 } }, [robotOf({ carried: true })]);
    for (const state of [atBench(BASE), atBench(benched), atBench(carrying)]) {
      expect(planShiftInteraction(state)).toEqual(planInteraction(state));
    }
    expect(planShiftInteraction(atBench(benched)).intent).toEqual({ kind: 'openBench', robotId: 1, name: 'Sprocket' });
    expect(peek(atBench(benched)).ui.panel).toEqual({ kind: 'robot', robotId: 1, mode: 'bench' });
  });
});
```

Append to the end of `tests/panelKeys.test.ts`:

```ts

describe('panel keys with Shift (part 3 spec §2.3)', () => {
  it('Shift + E, K or Enter peeks; without Shift they interact', () => {
    for (const code of INTERACT_KEYS) {
      expect(panelKeyCommand(code, NONE, true)).toEqual(actions.peek());
      expect(panelKeyCommand(code, NONE, false)).toEqual(actions.interact());
      expect(panelKeyCommand(code, NONE)).toEqual(actions.interact());
    }
  });

  it('Shift + E still closes the backpack or a chest', () => {
    for (const code of INTERACT_KEYS) {
      expect(panelKeyCommand(code, INVENTORY_OPEN, true)).toEqual(actions.closePanel());
      expect(panelKeyCommand(code, CHEST_OPEN, true)).toEqual(actions.closePanel());
    }
  });

  it('Shift changes nothing for the other keys', () => {
    expect(panelKeyCommand('KeyI', NONE, true)).toEqual(actions.setInventoryOpen(true));
    expect(panelKeyCommand('KeyB', NONE, true)).toEqual(actions.setShopOpen(true));
    expect(panelKeyCommand('Escape', NONE, true)).toEqual(actions.setPaused(true));
    expect(panelKeyCommand('KeyW', NONE, true)).toBeNull();
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run tests/robotPeek.test.ts tests/panelKeys.test.ts`
Expected: FAIL. In `tests/robotPeek.test.ts` all 8 tests fail with `TypeError: planShiftInteraction is not a function` or `TypeError: actions.peek is not a function`. In `tests/panelKeys.test.ts` 1 failed / 9 passed: "Shift + E, K or Enter peeks …" fails with `TypeError: actions.peek is not a function` (the other two new tests already pass, since the extra argument is ignored). The type errors (`peek` missing from `actions`, the third argument) show under `npm run typecheck`.

- [ ] **Step 3: Implement**

**3a. `src/state/actions.ts`.** Replace:

```ts
  /** Context action on the forward tile: harvest, ship, sleep, refill. */
  | { readonly type: 'player/interact' }
```

with:

```ts
  /** Context action on the forward tile: harvest, ship, sleep, refill. */
  | { readonly type: 'player/interact' }
  /** Shift + an interact key: E's meaning at the workbench ahead, else a peek at a standing robot ahead (part 3 spec §2.3). */
  | { readonly type: 'player/peek' }
```

and replace:

```ts
  interact: (): GameAction => ({ type: 'player/interact' }),
```

with:

```ts
  interact: (): GameAction => ({ type: 'player/interact' }),
  peek: (): GameAction => ({ type: 'player/peek' }),
```

**3b. `src/state/intents.ts`.** In the `Intent` union, insert directly above its last member, the `blocked` one (which reads `| { readonly kind: 'blocked'; readonly reason: string | null; readonly hint?: string };` since Task 5):

```ts
  /** Shift + E on a standing robot: its screen opens read-only, for free (part 3 spec §2.3). */
  | { readonly kind: 'peekRobot'; readonly robotId: number; readonly name: string }
```

Insert directly above the doc comment `/** Short verb for HUD hints, e.g. "Till", or null when the plan does nothing. */`:

```ts
/**
 * Plan for Shift + an interact key (part 3 spec §2.3), decided in this order:
 *   1. the workbench ahead: exactly what E does there;
 *   2. a standing robot ahead (on the farm, not carried, at repairs or on the bench): peek at
 *      it, which costs nothing and changes nothing but the open panel;
 *   3. otherwise nothing, silently.
 */
export function planShiftInteraction(state: GameState): ActionPlan {
  const target = selectTargetTile(state);
  const tile = target === null ? null : getTile(selectActiveWorld(state), target.tx, target.tz);
  if (tile?.object?.kind === 'workbench') return planInteraction(state);
  if (target !== null && state.player.mapId === 'farm') {
    const robot = robotsOnTile(state, target.tx, target.tz)[0];
    if (robot !== undefined) return plan(target, { kind: 'peekRobot', robotId: robot.id, name: robot.name }, 'none');
  }
  return blocked(target, 'none');
}

```

In `describeIntent`, insert directly above `    case 'blocked':` (whose body is Task 5's `return intent.hint ?? null;`):

```ts
    case 'peekRobot':
      return `Look at ${intent.name}`;
```

**3c. `src/state/reducer.ts`.** Add `planShiftInteraction` to the `./intents` import, which then reads:

```ts
import { planInteraction, planPrimaryAction, planShiftInteraction, type ActionPlan, type Intent } from './intents';
```

In `gameReducer`, replace:

```ts
    case 'player/interact':
      return selectIsFrozen(state) ? state : executePlan(state, planInteraction(state));
```

with:

```ts
    case 'player/interact':
      return selectIsFrozen(state) ? state : executePlan(state, planInteraction(state));
    case 'player/peek':
      return selectIsFrozen(state) ? state : executePlan(state, planShiftInteraction(state));
```

In `applyIntent`, replace:

```ts
    case 'fuel': {
      const object = tile.object;
```

with:

```ts
    case 'peekRobot':
      return { ...state, ui: { ...state.ui, panel: { kind: 'robot', robotId: intent.robotId, mode: 'peek' } } };

    case 'fuel': {
      const object = tile.object;
```

(`executePlan` then records the attempt as `lastAction` with kind `'none'`, which no animation or particle reacts to.)

**3d. `src/input/panelKeys.ts`.** In the header comment, replace:

```ts
 *   E, K, Enter    interact, or close an open inventory or chest instead
```

with:

```ts
 *   E, K, Enter    interact, or close an open inventory or chest instead; with Shift, peek
 *                  (planShiftInteraction: E's meaning at the workbench, else a robot's screen)
```

Replace:

```ts
/**
 * What a panel key does now: an action to dispatch, IGNORED for a game key with nothing to do,
 * or null when `code` is not a panel key.
 */
export function panelKeyCommand(code: string, state: GameState): PanelKeyCommand | null {
  const panel = state.ui.panel.kind;
  if (INTERACT_KEYS.has(code)) return isInventoryScreenOpen(state) ? actions.closePanel() : actions.interact();
```

with:

```ts
/**
 * What a panel key does now: an action to dispatch, IGNORED for a game key with nothing to do,
 * or null when `code` is not a panel key. `shift` is whether Shift is held with the key.
 */
export function panelKeyCommand(code: string, state: GameState, shift = false): PanelKeyCommand | null {
  const panel = state.ui.panel.kind;
  if (INTERACT_KEYS.has(code)) {
    if (isInventoryScreenOpen(state)) return actions.closePanel();
    return shift ? actions.peek() : actions.interact();
  }
```

**3e. `src/input/InputController.ts`.**

1. In the header comment, replace:

```ts
 *   Interact      E, K, Enter, right mouse button on the canvas (Ctrl + click on macOS).
 *                 While the backpack or a chest is open, E, K and Enter close it instead.
```

with:

```ts
 *   Interact      E, K, Enter, right mouse button on the canvas (Ctrl + click on macOS).
 *                 While the backpack or a chest is open, E, K and Enter close it instead.
 *   Peek          Shift + any interact key or button (part 3 spec §2.3). Every change of the
 *                 Shift key is reported through `onShiftChange`, so the HUD hint can follow it.
```

2. In `InputControllerOptions`, replace:

```ts
  readonly rig: CameraRig;
}
```

with:

```ts
  readonly rig: CameraRig;
  /** Called whenever Shift goes down or up (and with false when held keys are cleared). */
  readonly onShiftChange?: (held: boolean) => void;
}
```

3. In the class fields, replace:

```ts
  private readonly rig: CameraRig;

  /** Held direction key codes in press order; the last one steers. */
```

with:

```ts
  private readonly rig: CameraRig;
  private readonly onShiftChange: ((held: boolean) => void) | undefined;

  /** Held direction key codes in press order; the last one steers. */
```

4. In the constructor, replace:

```ts
    this.rig = options.rig;

    this.target.addEventListener('keydown', this.onKeyDown);
```

with:

```ts
    this.rig = options.rig;
    this.onShiftChange = options.onShiftChange;

    this.target.addEventListener('keydown', this.onKeyDown);
```

5. Replace:

```ts
  private readonly onKeyDown = (event: KeyboardEvent): void => {
    this.shiftHeld = event.shiftKey;
```

with:

```ts
  private readonly onKeyDown = (event: KeyboardEvent): void => {
    this.setShiftHeld(event.shiftKey);
```

and replace:

```ts
  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.shiftHeld = event.shiftKey;
```

with:

```ts
  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.setShiftHeld(event.shiftKey);
```

6. In `handleKeyDown`, replace:

```ts
    // I, E / K / Enter, B and Escape: open, close or toggle panels, or interact.
    const command = panelKeyCommand(code, state);
```

with:

```ts
    // I, E / K / Enter, B and Escape: open, close or toggle panels, interact, or peek with Shift.
    const command = panelKeyCommand(code, state, event.shiftKey);
```

7. In `onPointerDown`, replace:

```ts
    } else if (event.button === 2 || (event.button === 0 && event.ctrlKey)) {
      this.store.dispatch(actions.interact());
    }
```

with:

```ts
    } else if (event.button === 2 || (event.button === 0 && event.ctrlKey)) {
      this.store.dispatch(event.shiftKey ? actions.peek() : actions.interact());
    }
```

8. Replace:

```ts
  private releaseAll(): void {
    this.directionKeys.length = 0;
    this.toolSources.clear();
    this.shiftHeld = false;
```

with:

```ts
  /** Tracks Shift and reports every change to `onShiftChange`. */
  private setShiftHeld(held: boolean): void {
    if (held === this.shiftHeld) return;
    this.shiftHeld = held;
    this.onShiftChange?.(held);
  }

  private releaseAll(): void {
    this.directionKeys.length = 0;
    this.toolSources.clear();
    this.setShiftHeld(false);
```

**3f. `src/ui/Hud.ts`.**

1. Replace:

```ts
import { describeIntent, planInteraction, planPrimaryAction } from '../state/intents';
```

with:

```ts
import { describeIntent, planInteraction, planPrimaryAction, planShiftInteraction } from '../state/intents';
```

2. In `ContextHint`, replace:

```ts
  private readonly interact = h('span', 'hud-chip hud-hint__action');
  private readonly interactVerb = h('span', 'hud-hint__verb');

  constructor() {
    this.primaryAlt.append(h('span', 'hud-hint__sep', '/'), kbd('E'));
    this.primaryAlt.hidden = true;
    this.primary.append(kbd('Space'), this.primaryAlt, this.primaryVerb);
    this.interact.append(kbd('E'), this.interactVerb);
```

with:

```ts
  private readonly interact = h('span', 'hud-chip hud-hint__action');
  private readonly interactKey = kbd('E');
  private readonly interactVerb = h('span', 'hud-hint__verb');
  /** Whether Shift is held: the interact chip then shows Shift + E (part 3 spec §2.3). */
  private shift = false;

  constructor() {
    this.primaryAlt.append(h('span', 'hud-hint__sep', '/'), kbd('E'));
    this.primaryAlt.hidden = true;
    this.primary.append(kbd('Space'), this.primaryAlt, this.primaryVerb);
    this.interact.append(this.interactKey, this.interactVerb);
```

3. In `ContextHint.sync`, replace:

```ts
    const primary = describeIntent(planPrimaryAction(state).intent);
    const interact = describeIntent(planInteraction(state).intent);
    const merged = primary !== null && primary === interact;
```

with:

```ts
    const primary = describeIntent(planPrimaryAction(state).intent);
    const interact = describeIntent((this.shift ? planShiftInteraction(state) : planInteraction(state)).intent);
    // Space never peeks, so with Shift held the two chips never merge.
    const merged = !this.shift && primary !== null && primary === interact;
    setText(this.interactKey, this.shift ? 'Shift + E' : 'E');
```

4. At the end of `ContextHint`, replace:

```ts
    const item = selectSelectedItem(state);
    setText(this.item, item === null ? 'Empty hands' : item.name);
    this.item.classList.toggle('is-empty', item === null);
  }
}
```

with:

```ts
    const item = selectSelectedItem(state);
    setText(this.item, item === null ? 'Empty hands' : item.name);
    this.item.classList.toggle('is-empty', item === null);
  }

  /** Follows the Shift key; redraws from `state` (the last synced one) when it changed. */
  setShift(held: boolean, state: GameState | null): void {
    if (held === this.shift) return;
    this.shift = held;
    if (state !== null) this.sync(state, null);
  }
}
```

(`sync(state, null)` always recomputes; `ContextHint` keeps no other per-`prev` state.)

5. In `Hud`, replace:

```ts
  private phase: DayPhase | null = null;
  private frozen: boolean | null = null;
```

with:

```ts
  private phase: DayPhase | null = null;
  private frozen: boolean | null = null;
  /** The last synced state, for redraws that a key rather than the store asks for. */
  private last: GameState | null = null;
```

6. In `Hud.sync`, replace:

```ts
  sync(state: GameState, prev: GameState | null): void {
    if (prev === null || state.time.minuteOfDay !== prev.time.minuteOfDay) this.syncPhase(state.time.minuteOfDay);
```

with:

```ts
  sync(state: GameState, prev: GameState | null): void {
    this.last = state;
    if (prev === null || state.time.minuteOfDay !== prev.time.minuteOfDay) this.syncPhase(state.time.minuteOfDay);
```

7. Replace:

```ts
  update(frame: FrameContext): void {
    const dt = frame.dt;
    this.clock.update(dt);
```

with:

```ts
  /** Shift went down or up (InputController's onShiftChange): the interact hint switches to Shift + E's plan. */
  setShiftHeld(held: boolean): void {
    this.hint.setShift(held, this.last);
  }

  update(frame: FrameContext): void {
    const dt = frame.dt;
    this.clock.update(dt);
```

**3g. `src/main.ts`.** Replace:

```ts
  const input = new InputController({ target: window, canvas: ctx.renderer.domElement, store, rig: ctx.rig });
```

with:

```ts
  const input = new InputController({
    target: window,
    canvas: ctx.renderer.domElement,
    store,
    rig: ctx.rig,
    onShiftChange: (held) => hud.setShiftHeld(held),
  });
```

(`hud` is built just above it, and `dispose` stops `input` before `hud`, so the callback never reaches a disposed HUD.)

- [ ] **Step 4: Run them and see them pass**

Run: `npx vitest run tests/robotPeek.test.ts tests/panelKeys.test.ts`
Expected: PASS (8 + 10 tests).

- [ ] **Step 5: The full gate**

Run: `npm run typecheck && npm test && npm run build`
Expected: all green. (`tests/intents.test.ts`'s property test never dispatches `player/peek`, so its counts don't change.)

- [ ] **Step 6: Commit**

```bash
git add src/state/actions.ts src/state/intents.ts src/state/reducer.ts src/input/panelKeys.ts src/input/InputController.ts src/ui/Hud.ts src/main.ts tests/robotPeek.test.ts tests/panelKeys.test.ts
git commit -m "Farmclaws part 3: Shift + E peeks at a robot's screen, and the hint follows Shift

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: The zone marker

**Files:**
- Create: `src/state/zoneMarker.ts`, `src/ui/zoneChip.ts`, `src/render/ZoneRenderer.ts`, `tests/zoneMarker.test.ts`
- Modify: `src/core/types.ts` (`TOOL_TYPES`, line 106; `UiState`, ~line 466; `RobotsState`, after `zones`, ~line 683)
- Modify: `src/config.ts` (`TOOLS.energyCost`, ~line 95; new `ZONE_MARKER` after `TOOLS`, ~line 111)
- Modify: `src/items/items.ts` (`TOOL_INFO`, ~line 79)
- Modify: `src/render/playerModel.ts` (header comment ~line 15; `TOOL_WRAP` ~line 88; new prop builder above `buildPouchGeometry` ~line 393; `HELD_MODEL_KINDS` ~line 539; `HeldItemRack` meshes ~line 577)
- Modify: `src/render/PlayerRenderer.ts` (`carryStyleFor` ~line 180; `ACTION_CLIPS` ~line 722)
- Modify: `src/render/EffectsRenderer.ts` (`react`'s success switch, ~line 1206)
- Modify: `src/ui/icons.ts` (new `zoneMarkerParts` and `toolParts`, ~line 299)
- Modify: `src/robots/zones.ts` (new `zoneRectBetween` above `tileAheadOf`, ~line 31)
- Modify: `src/state/selectors.ts` (new `isZoneMarkerSelected` above `selectIsFrozen`, ~line 85)
- Modify: `src/state/initialState.ts` (imports; `createDefaultSections().robots`; new `starterInventory`; `createInitialState`'s inventory and UI)
- Modify: `src/state/persistence.ts` (imports; `ACTION_KIND_TABLE` ~line 47; `isValidUi` ~line 210 and two new validators; `isValidGameState`'s last condition; new `savedMarkerCount` / `migrateZoneMarker` above `migrateSave`; the v5 line of `migrateSave`; `deserializeGame`)
- Modify: `src/state/robotValidation.ts` (`isValidRobotsSection`'s exact keys, ~line 621)
- Modify: `src/state/intents.ts` (imports; `Intent`; `planTool`'s switch; new `ZONES_FARM_ONLY`, `planMarker`, `planClearZone`; `planShiftInteraction` step 3; `describeIntent`)
- Modify: `src/state/actions.ts` (`zone/cycle`, `zone/clearDraft`)
- Modify: `src/state/reducer.ts` (imports; `gameReducer` split into `gameReducer` + `dropStaleDraft` + `reduceAction`; two cases; three `applyIntent` cases; new `nextZoneLetter`; `loadState`)
- Modify: `src/robots/overnight.ts` (import; new `deliverPendingMarker`; `runRobotsOvernight`)
- Modify: `src/input/panelKeys.ts` (header; Escape; new `markerToolCommand`)
- Modify: `src/input/InputController.ts` (header; imports; `updateTool`; `handleKeyDown`'s tool keys; `pressTool`; `onPointerDown`)
- Modify: `src/ui/Hud.ts` (import; new `ZoneChip` widget; `Hud` fields, constructor and `sync`), `src/ui/hud.css` (after `.hud-hint__verb`, ~line 733)
- Modify: `src/main.ts` (import; `systems`)
- Modify: `tests/testUtils.ts` (`v5Save`)
- Test: `tests/zoneMarker.test.ts` (new); `tests/robotSaveV6.test.ts` (append a `describe`); `tests/panelKeys.test.ts` (extend); `tests/sections.test.ts`, `tests/persistence.test.ts`, `tests/reducer.test.ts`, `tests/inventoryMove.test.ts` (the starter kit gains the marker, `UiState` gains two fields)

**Interfaces:**
- Consumes:
  - Task 1: `migrateV5toV6` chained in `migrateSave` as `if (isObj(v) && v.version === 5) v = migrateV5toV6(v);`; `v5Save` (ends in `return save;`), which `legacySave` builds on; `tests/robotSaveV6.test.ts` with `loadedFrom`.
  - Task 2: `withZone(state: GameState, id: ZoneId, rect: ZoneRect | null): GameState | string` in `src/robots/edits.ts` (its string results are the neutral `ZONE_SHAPE` / `ZONE_OFF_FARM`, shown as they are), imported by the reducer as `import { programmedRobot, withMd } from '../robots/edits';`.
  - Task 4: `RobotsState.unlocks` and `'unlocks'` in `isValidRobotsSection`'s exact keys; the `unlocks` default in `tests/sections.test.ts`.
  - Task 5: `UiPanel` robot kind; `WORKBENCH.home`; `planInteraction` at an empty bench → a blocked plan whose `hint` (shown by `describeIntent`) is "Bring a robot here to work on it".
  - Task 8: `planShiftInteraction`, the `peekRobot` intent and its `applyIntent` case, `actions.peek()`, `panelKeyCommand(code, state, shift = false)`.
- Produces:
  - `src/core/types.ts`: `TOOL_TYPES` = `['hoe', 'wateringCan', 'pickaxe', 'axe', 'scythe', 'zoneMarker']` (so `ActionKind` gains `'zoneMarker'`); `UiState.zoneDraft: null | { readonly zone: ZoneId; readonly corner: TileCoord }`; `UiState.zoneLetter: ZoneId`; `RobotsState.pendingMarker: boolean`.
  - `src/config.ts`: `TOOLS.energyCost.zoneMarker: 0`; `ZONE_MARKER = { colors: [0xe2563f, 0xf2c14e, 0x5fa84a, 0x2f6fb0, 0x8e5ba8, 0xf28a3a, 0x3aa59c, 0xe87fa3], outlineHeight: 0.03 } as const` (A … H).
  - `src/items/items.ts`: `TOOL_INFO.zoneMarker` = name "Zone Marker", description "Paints zones A to H for your robots. Use it to mark corners; Shift + use picks the zone.". Like every tool: `maxStack` 1, `sellPrice: null`, not in `UPGRADABLE_TOOLS`.
  - `src/robots/zones.ts`: `export function zoneRectBetween(a: TileCoord, b: TileCoord): ZoneRect`.
  - `src/state/zoneMarker.ts` (new, pure): `export const ZONE_MARKER_STACK: ItemStack`; `export function countZoneMarkers(inventory: InventoryState, maps: GameState['maps']): number`; `export function withZoneMarker(inventory: InventoryState): InventoryState | null` (first free unlocked slot, null when full).
  - `src/state/selectors.ts`: `export function isZoneMarkerSelected(state: GameState): boolean`.
  - `src/state/intents.ts`: intents `{ kind: 'zoneCorner'; corner: TileCoord }` ("Mark corner"), `{ kind: 'markZone'; zone: ZoneId; rect: ZoneRect }` ("Mark Zone {letter}"), `{ kind: 'clearZone'; zone: ZoneId }` ("Clear Zone {letter}"), all with feedback `'zoneMarker'` and energy 0; `export const ZONES_FARM_ONLY = 'Zones are only on the farm.'`. `planTool`'s `'zoneMarker'` case: off the farm → blocked with `ZONES_FARM_ONLY`; no draft → `zoneCorner`; a draft → `markZone` with `zoneRectBetween(draft.corner, target)`. `planShiftInteraction` step 3: the marker selected → off the farm blocked with `ZONES_FARM_ONLY`, an empty zone silent, else `clearZone` (the player's own tile stands in when there is no tile ahead).
  - `src/state/actions.ts`: `{ type: 'zone/cycle' }` → `actions.cycleZoneLetter()`; `{ type: 'zone/clearDraft' }` → `actions.clearZoneDraft()`.
  - Reducer: `zoneCorner` sets `ui.zoneDraft = { zone: ui.zoneLetter, corner }`; `markZone` clears the draft and applies `withZone`, toast (success) "Zone {L} · {w}×{d}."; `clearZone` applies `withZone(…, null)`, toast (info) "Cleared Zone {L}."; `zone/cycle` (ignored while frozen) moves A → H → A and drops the draft; `zone/clearDraft` drops it. `gameReducer` drops a draft whenever the selected slot or the player's map changes or any panel is open, whatever the action; `game/load` drops it too.
  - `src/robots/overnight.ts`: after the morning reset, a pending marker goes into the first free slot with the toast (info) "Your zone marker is in your backpack." and `pendingMarker: false`.
  - `src/input/panelKeys.ts`: Escape with no panel open, a draft, and the game not paused → `actions.clearZoneDraft()`; `export function markerToolCommand(state: GameState, shift: boolean, repeat: boolean): PanelKeyCommand | null` (null unless the marker is selected; `IGNORED` for a repeat; `cycleZoneLetter()` with Shift; else `useTool()`).
  - `src/input/InputController.ts`: tool keys and left clicks go through `markerToolCommand` first, so the marker acts on fresh presses only and Shift + Space / J / click cycles; held-tool repeats never fire while the marker is selected.
  - `src/ui/zoneChip.ts` (new, pure): `export function zoneChipText(state: GameState): string | null`. `Hud` shows it in a chip between the context hint and the hotbar.
  - `src/render/ZoneRenderer.ts` (new): `export class ZoneRenderer implements RenderSystem { constructor(ctx: SceneContext) }`, registered in `main.ts` after `TileHighlighter`.
  - Saves: `createInitialState` gives the marker the first free slot (slot 6 of the starter kit); `createDefaultSections().robots.pendingMarker` is `false`; the v5 step becomes `migrateZoneMarker(migrateV5toV6(v))`, which gives the marker or sets `pendingMarker`, and adds `zoneDraft: null, zoneLetter: 'A'`; `isValidUi` checks both fields; `isValidRobotsSection` requires a boolean `pendingMarker`; `isValidGameState` allows at most one marker in the inventory and every chest together, and `pendingMarker` only when there is none; `deserializeGame` resets `zoneDraft` to null and `zoneLetter` to `'A'`. `v5Save` drops the marker, `pendingMarker`, `zoneDraft` and `zoneLetter`.

- [ ] **Step 1: Write the failing tests**

Create `tests/zoneMarker.test.ts`:

```ts
/**
 * The zone marker (farmclaws part 3 spec §8): the tool itself, painting a zone with two fresh
 * presses in either order, Shift + use cycling the letter, Shift + E clearing it, every way a
 * draft drops, the refusals, the HUD chip, and the marker's delivery.
 */
import { describe, expect, it } from 'vitest';
import { INVENTORY, TOOLS, WORKBENCH, ZONE_MARKER } from '../src/config';
import { Blocker, Direction, TOOL_TYPES, UPGRADABLE_TOOLS, ZONE_IDS, type GameState, type TileCoord } from '../src/core/types';
import { IGNORED, markerToolCommand, panelKeyCommand } from '../src/input/panelKeys';
import { getItem } from '../src/items/items';
import { zoneRectBetween } from '../src/robots/zones';
import { actions } from '../src/state/actions';
import { ZONES_FARM_ONLY, describeIntent, planInteraction, planPrimaryAction, planShiftInteraction } from '../src/state/intents';
import { countItem } from '../src/state/inventory';
import { gameReducer, startNextDay } from '../src/state/reducer';
import { isZoneMarkerSelected } from '../src/state/selectors';
import { zoneChipText } from '../src/ui/zoneChip';
import { MAPS } from '../src/world/maps';
import { EMPTY_TILE, blockedTile } from '../src/world/tiles';
import { BASE, STAND, TARGET, holding, must, robotOf, scenario, stack, withPlayer, withRobots, withSlots, withTile, withZones } from './testUtils';

/** The player on STAND facing South (TARGET ahead), the marker in hand from the starter kit's slot. */
const MARKING = holding(scenario(EMPTY_TILE), 'zoneMarker');
/** Standing here facing South, the player marks (7, 12): with TARGET it spans a 3×3 zone. */
const FAR: TileCoord = { tx: 7, tz: 11 };
const RECT_3X3 = { x0: 5, z0: 10, w: 3, d: 3 };

const use = (state: GameState): GameState => gameReducer(state, actions.useTool());
const cycle = (state: GameState): GameState => gameReducer(state, actions.cycleZoneLetter());
const at = (state: GameState, coord: TileCoord, facing: Direction = Direction.South): GameState => withPlayer(state, coord, facing);
const lastText = (state: GameState): string | undefined => state.messages.entries.at(-1)?.text;

describe('the zone marker tool', () => {
  it('is a free tool, named and described as in the spec, that is never upgraded or shipped', () => {
    expect(TOOL_TYPES).toContain('zoneMarker');
    expect(UPGRADABLE_TOOLS).not.toContain('zoneMarker');
    expect(TOOLS.energyCost.zoneMarker).toBe(0);
    expect(getItem('zoneMarker')).toMatchObject({
      kind: 'tool',
      name: 'Zone Marker',
      description: 'Paints zones A to H for your robots. Use it to mark corners; Shift + use picks the zone.',
      maxStack: 1,
      sellPrice: null,
      energyCost: 0,
    });
    const bin = holding(scenario(blockedTile(Blocker.ShippingBin)), 'zoneMarker');
    expect(planInteraction(bin).intent).toEqual({ kind: 'blocked', reason: "Zone Marker can't be shipped." });
  });

  it('has one colour per zone, all different', () => {
    expect(ZONE_MARKER.colors).toHaveLength(ZONE_IDS.length);
    expect(new Set(ZONE_MARKER.colors).size).toBe(ZONE_IDS.length);
  });

  it('comes in the first free slot of a new farm, with Zone A picked and no draft', () => {
    expect(BASE.inventory.slots[INVENTORY.starting.length]).toEqual(stack('zoneMarker', 1));
    expect(countItem(BASE.inventory, 'zoneMarker')).toBe(1);
    expect(BASE.robots.pendingMarker).toBe(false);
    expect(BASE.ui.zoneDraft).toBeNull();
    expect(BASE.ui.zoneLetter).toBe('A');
    expect(isZoneMarkerSelected(MARKING)).toBe(true);
    expect(isZoneMarkerSelected(BASE)).toBe(false);
  });
});

describe('painting a zone', () => {
  it('spans the rectangle between two corners, whichever comes first', () => {
    expect(zoneRectBetween({ tx: 5, tz: 10 }, { tx: 7, tz: 12 })).toEqual(RECT_3X3);
    expect(zoneRectBetween({ tx: 7, tz: 12 }, { tx: 5, tz: 10 })).toEqual(RECT_3X3);
    expect(zoneRectBetween({ tx: 7, tz: 10 }, { tx: 5, tz: 12 })).toEqual(RECT_3X3);
    expect(zoneRectBetween({ tx: 4, tz: 4 }, { tx: 4, tz: 4 })).toEqual({ x0: 4, z0: 4, w: 1, d: 1 });
  });

  it('sets the corner on the first press and paints Zone A on the second, in either order', () => {
    for (const [first, second] of [
      [STAND, FAR],
      [FAR, STAND],
    ] as const) {
      const cornered = use(at(MARKING, first));
      expect(cornered.ui.zoneDraft).toEqual({ zone: 'A', corner: { tx: first.tx, tz: first.tz + 1 } });
      expect(cornered.robots.zones.A).toBeNull();
      expect(cornered.messages).toBe(MARKING.messages);
      const painted = use(at(cornered, second));
      expect(painted.robots.zones.A).toEqual(RECT_3X3);
      expect(painted.ui.zoneDraft).toBeNull();
      expect(lastText(painted)).toBe('Zone A · 3×3.');
      expect(painted.player.energy).toBe(MARKING.player.energy);
      expect(painted.player.lastAction).toMatchObject({ kind: 'zoneMarker', success: true });
    }
  });

  it('names what the next press does', () => {
    expect(planPrimaryAction(MARKING)).toEqual({ target: TARGET, intent: { kind: 'zoneCorner', corner: TARGET }, feedback: 'zoneMarker', energyCost: 0 });
    expect(describeIntent(planPrimaryAction(MARKING).intent)).toBe('Mark corner');
    const cornered = use(MARKING);
    expect(planPrimaryAction(cornered).intent).toEqual({ kind: 'markZone', zone: 'A', rect: { x0: 5, z0: 10, w: 1, d: 1 } });
    expect(describeIntent(planPrimaryAction(cornered).intent)).toBe('Mark Zone A');
    expect(lastText(use(cornered))).toBe('Zone A · 1×1.');
  });

  it('repaints a zone that is already set, and leaves the other zones alone', () => {
    const set = withZones(MARKING, { A: { x0: 1, z0: 9, w: 2, d: 2 }, B: { x0: 1, z0: 9, w: 2, d: 2 } });
    const painted = use(at(use(set), FAR));
    expect(painted.robots.zones.A).toEqual(RECT_3X3);
    expect(painted.robots.zones.B).toEqual({ x0: 1, z0: 9, w: 2, d: 2 });
  });

  it('acts on fresh presses only, and Shift + a press picks the zone', () => {
    expect(markerToolCommand(MARKING, false, false)).toEqual(actions.useTool());
    expect(markerToolCommand(MARKING, false, true)).toBe(IGNORED);
    expect(markerToolCommand(MARKING, true, false)).toEqual(actions.cycleZoneLetter());
    expect(markerToolCommand(MARKING, true, true)).toBe(IGNORED);
    // Every other item keeps the ordinary tool path, held-key repeats included.
    const hoe = holding(MARKING, 'hoe');
    for (const [shift, repeat] of [
      [false, false],
      [false, true],
      [true, false],
    ] as const) {
      expect(markerToolCommand(hoe, shift, repeat)).toBeNull();
    }
  });

  it('refuses off the farm, and does nothing facing the edge of the world', () => {
    const tree = { tx: 10, tz: 10 };
    const ahead = { tx: 10, tz: 11 };
    const forest = withPlayer(withTile(withTile(MARKING, tree, EMPTY_TILE, 'forest'), ahead, EMPTY_TILE, 'forest'), tree, Direction.South, 'forest');
    expect(ZONES_FARM_ONLY).toBe('Zones are only on the farm.');
    expect(planPrimaryAction(forest)).toEqual({ target: ahead, intent: { kind: 'blocked', reason: 'Zones are only on the farm.' }, feedback: 'zoneMarker', energyCost: 0 });
    expect(lastText(use(forest))).toBe('Zones are only on the farm.');
    expect(use(forest).ui.zoneDraft).toBeNull();
    const edge = at(MARKING, { tx: 5, tz: 0 }, Direction.North);
    expect(planPrimaryAction(edge)).toEqual({ target: null, intent: { kind: 'blocked', reason: null }, feedback: 'zoneMarker', energyCost: 0 });
  });
});

describe('picking the zone', () => {
  it('cycles A → H → A, dropping a draft, without a toast', () => {
    let state = use(MARKING);
    const seen: string[] = [];
    for (let i = 0; i < ZONE_IDS.length; i++) {
      state = cycle(state);
      expect(state.ui.zoneDraft).toBeNull();
      seen.push(state.ui.zoneLetter);
    }
    expect(seen).toEqual(['B', 'C', 'D', 'E', 'F', 'G', 'H', 'A']);
    expect(state.messages).toBe(MARKING.messages);
  });

  it('paints the picked letter', () => {
    const painted = use(use(cycle(cycle(MARKING))));
    expect(painted.robots.zones.C).toEqual({ x0: 5, z0: 10, w: 1, d: 1 });
    expect(painted.robots.zones.A).toBeNull();
    expect(lastText(painted)).toBe('Zone C · 1×1.');
  });

  it('is ignored while the game is frozen', () => {
    const paused = gameReducer(MARKING, actions.setPaused(true));
    expect(cycle(paused)).toBe(paused);
  });
});

describe('clearing a zone with Shift + E', () => {
  const SET = withZones(MARKING, { A: RECT_3X3, B: { x0: 1, z0: 9, w: 2, d: 2 } });

  it('clears the current letter only', () => {
    expect(planShiftInteraction(SET)).toEqual({ target: TARGET, intent: { kind: 'clearZone', zone: 'A' }, feedback: 'zoneMarker', energyCost: 0 });
    expect(describeIntent(planShiftInteraction(SET).intent)).toBe('Clear Zone A');
    const cleared = gameReducer(SET, actions.peek());
    expect(cleared.robots.zones.A).toBeNull();
    expect(cleared.robots.zones.B).toEqual({ x0: 1, z0: 9, w: 2, d: 2 });
    expect(lastText(cleared)).toBe('Cleared Zone A.');
  });

  it('has nothing to clear on an empty zone', () => {
    expect(planShiftInteraction(MARKING)).toEqual({ target: TARGET, intent: { kind: 'blocked', reason: null }, feedback: 'none', energyCost: 0 });
    expect(gameReducer(MARKING, actions.peek())).toBe(MARKING);
  });

  it('peeks instead when a standing robot is ahead', () => {
    const robot = withRobots(SET, [robotOf()]);
    expect(planShiftInteraction(robot).intent).toEqual({ kind: 'peekRobot', robotId: 1, name: 'Sprocket' });
  });

  it('does what E does at the workbench instead', () => {
    const bench = at(SET, { tx: WORKBENCH.home.tx, tz: WORKBENCH.home.tz + 1 }, Direction.North);
    expect(planShiftInteraction(bench)).toEqual(planInteraction(bench));
    expect(describeIntent(planShiftInteraction(bench).intent)).toBe('Bring a robot here to work on it');
  });

  it('needs the marker in hand', () => {
    expect(planShiftInteraction(holding(SET, 'hoe')).intent).toEqual({ kind: 'blocked', reason: null });
  });
});

describe('the draft', () => {
  const DRAFT = use(MARKING);

  it('drops on Escape, which pauses only once there is no draft', () => {
    expect(panelKeyCommand('Escape', DRAFT)).toEqual(actions.clearZoneDraft());
    const dropped = gameReducer(DRAFT, actions.clearZoneDraft());
    expect(dropped.ui.zoneDraft).toBeNull();
    expect(dropped.ui.paused).toBe(false);
    expect(gameReducer(dropped, actions.clearZoneDraft())).toBe(dropped);
    expect(panelKeyCommand('Escape', dropped)).toEqual(actions.setPaused(true));
  });

  it('drops when the selected slot changes, and stays when it does not', () => {
    expect(gameReducer(DRAFT, actions.selectSlot(DRAFT.inventory.selected))).toBe(DRAFT);
    expect(gameReducer(DRAFT, actions.cycleSlot(INVENTORY.hotbarSize)).ui.zoneDraft).not.toBeNull();
    expect(gameReducer(DRAFT, actions.selectSlot(0)).ui.zoneDraft).toBeNull();
    expect(gameReducer(DRAFT, actions.cycleSlot(1)).ui.zoneDraft).toBeNull();
    expect(gameReducer(DRAFT, actions.cycleSlot(-1)).ui.zoneDraft).toBeNull();
  });

  it('drops when the player leaves the farm', () => {
    const warp = must(MAPS.farm.warps[0]);
    const left = gameReducer(withPlayer(DRAFT, warp.from, warp.exit), actions.move(warp.exit));
    expect(left.player.mapId).toBe(warp.to.mapId);
    expect(left.ui.zoneDraft).toBeNull();
  });

  it('drops when any panel opens', () => {
    expect(gameReducer(DRAFT, actions.setInventoryOpen(true)).ui.zoneDraft).toBeNull();
    expect(gameReducer(DRAFT, actions.setShopOpen(true)).ui.zoneDraft).toBeNull();
    const peeked = gameReducer(withRobots(DRAFT, [robotOf()]), actions.peek());
    expect(peeked.ui.panel).toEqual({ kind: 'robot', robotId: 1, mode: 'peek' });
    expect(peeked.ui.zoneDraft).toBeNull();
  });

  it('survives walking and the clock, and drops on a load', () => {
    expect(gameReducer(DRAFT, actions.move(Direction.East)).ui.zoneDraft).toEqual(DRAFT.ui.zoneDraft);
    expect(gameReducer(DRAFT, actions.tick(10)).ui.zoneDraft).toEqual(DRAFT.ui.zoneDraft);
    const loaded = gameReducer(BASE, actions.load(cycle(DRAFT)));
    expect(loaded.ui.zoneDraft).toBeNull();
    expect(loaded.ui.zoneLetter).toBe('B');
  });
});

describe('the HUD chip', () => {
  it('names the letter, its size or "not set", and a set corner, while the marker is selected', () => {
    expect(zoneChipText(MARKING)).toBe('Zone A · not set');
    expect(zoneChipText(use(MARKING))).toBe('Zone A · not set · corner set');
    expect(zoneChipText(withZones(MARKING, { A: { x0: 5, z0: 10, w: 3, d: 2 } }))).toBe('Zone A · 3×2');
    expect(zoneChipText(use(withZones(MARKING, { A: RECT_3X3 })))).toBe('Zone A · 3×3 · corner set');
    expect(zoneChipText(cycle(MARKING))).toBe('Zone B · not set');
    expect(zoneChipText(holding(MARKING, 'hoe'))).toBeNull();
    expect(zoneChipText(BASE)).toBeNull();
  });
});

describe('a marker owed to a migrated save', () => {
  const FULL = withSlots(BASE, Array.from({ length: INVENTORY.startingUnlockedSlots }, () => stack('stone', INVENTORY.maxStack)));
  const PENDING: GameState = { ...FULL, robots: { ...FULL.robots, pendingMarker: true } };

  it('waits while the backpack is full', () => {
    const next = startNextDay(PENDING, false);
    expect(next.robots.pendingMarker).toBe(true);
    expect(countItem(next.inventory, 'zoneMarker')).toBe(0);
    expect(next.messages.entries.map((entry) => entry.text)).not.toContain('Your zone marker is in your backpack.');
  });

  it('arrives in the first free slot the first morning there is room', () => {
    const slots = PENDING.inventory.slots.slice();
    slots[9] = null;
    slots[15] = null;
    const next = startNextDay({ ...PENDING, inventory: { ...PENDING.inventory, slots } }, false);
    expect(next.inventory.slots[9]).toEqual(stack('zoneMarker', 1));
    expect(next.inventory.slots[15]).toBeNull();
    expect(next.robots.pendingMarker).toBe(false);
    expect(lastText(next)).toBe('Your zone marker is in your backpack.');
    expect(countItem(startNextDay(next, false).inventory, 'zoneMarker')).toBe(1);
  });
});
```

In `tests/robotSaveV6.test.ts`, add these names to the existing imports (one import per module; skip a name the file already imports): `INVENTORY` from `'../src/config'`; `countItem` from `'../src/state/inventory'`; `isValidGameState` (beside `deserializeGame`, `migrateSave`, `serializeGame`) from `'../src/state/persistence'`; `EMPTY_TILE` from `'../src/world/tiles'`; `TARGET`, `stack`, `withSlots`, `withTile` (beside `BASE`, `must`, `v5Save`, `type SaveJson`) from `'./testUtils'`. Then append at the end of the file:

```ts

describe('v6: the zone marker and the zone draft', () => {
  /** Every unlocked slot full: no room for the marker. */
  const FULL = withSlots(BASE, Array.from({ length: INVENTORY.startingUnlockedSlots }, (_, i) => stack(i % 2 === 0 ? 'stone' : 'wood', 5)));
  const MARKER = stack('zoneMarker', 1);
  const corrupt = (edit: (save: SaveJson) => void): SaveJson => {
    const save = JSON.parse(serializeGame(BASE)) as SaveJson;
    edit(save);
    return save;
  };

  it('gives a migrated save the marker in its first free slot', () => {
    const save = v5Save(BASE);
    expect(JSON.stringify(save)).not.toContain('zoneMarker');
    const loaded = must(deserializeGame(JSON.stringify(save)));
    expect(loaded.inventory.slots[INVENTORY.starting.length]).toEqual(MARKER);
    expect(loaded.robots.pendingMarker).toBe(false);
    expect(loaded.ui.zoneDraft).toBeNull();
    expect(loaded.ui.zoneLetter).toBe('A');
    expect(loaded).toEqual(BASE);
  });

  it('owes the marker to a migrated save whose backpack is full', () => {
    const save = v5Save(FULL);
    expect((migrateSave(save) as { robots: SaveJson }).robots.pendingMarker).toBe(true);
    const loaded = must(deserializeGame(JSON.stringify(save)));
    expect(countItem(loaded.inventory, 'zoneMarker')).toBe(0);
    expect(loaded).toEqual({ ...FULL, robots: { ...FULL.robots, pendingMarker: true } });
  });

  it('never hands out a second marker', () => {
    const save = { ...v5Save(BASE), inventory: (JSON.parse(serializeGame(BASE)) as SaveJson).inventory };
    expect(must(deserializeGame(JSON.stringify(save)))).toEqual(BASE);
  });

  it('round-trips a pending marker', () => {
    const pending: GameState = { ...FULL, robots: { ...FULL.robots, pendingMarker: true } };
    expect(deserializeGame(serializeGame(pending))).toEqual(loadedFrom(pending));
  });

  it('saves a zone draft and letter but loads with no draft and Zone A', () => {
    const drafting: GameState = { ...BASE, ui: { ...BASE.ui, zoneDraft: { zone: 'C', corner: { tx: 5, tz: 10 } }, zoneLetter: 'C' } };
    expect(isValidGameState(JSON.parse(serializeGame(drafting)))).toBe(true);
    expect(must(deserializeGame(serializeGame(drafting))).ui).toEqual(BASE.ui);
  });

  it('accepts the marker in a chest, but never two markers', () => {
    const chestWith = (state: GameState): GameState =>
      withTile(state, TARGET, { ...EMPTY_TILE, object: { kind: 'chest', slots: Array.from({ length: INVENTORY.chestSlots }, (_, i) => (i === 0 ? MARKER : null)) } });
    const moved = chestWith(withSlots(BASE, BASE.inventory.slots.map((slot) => (slot !== null && slot.itemId === 'zoneMarker' ? null : slot))));
    expect(isValidGameState(JSON.parse(serializeGame(moved)))).toBe(true);
    expect(isValidGameState(JSON.parse(serializeGame(chestWith(BASE))))).toBe(false);
  });

  const rejected: readonly [string, (save: SaveJson) => void][] = [
    ['pendingMarker while a marker is held', (s) => void ((s.robots as SaveJson).pendingMarker = true)],
    ['a pendingMarker that is not a boolean', (s) => void ((s.robots as SaveJson).pendingMarker = 1)],
    ['a missing pendingMarker', (s) => void delete (s.robots as SaveJson).pendingMarker],
    ['two markers in the inventory', (s) => void ((s.inventory as { slots: unknown[] }).slots[7] = { itemId: 'zoneMarker', quantity: 1, quality: 0 })],
    ['a draft on an unknown zone', (s) => void ((s.ui as SaveJson).zoneDraft = { zone: 'Z', corner: { tx: 5, tz: 10 } })],
    ['a draft corner off the farm', (s) => void ((s.ui as SaveJson).zoneDraft = { zone: 'A', corner: { tx: 999, tz: 0 } })],
    ['a draft corner that is not a whole tile', (s) => void ((s.ui as SaveJson).zoneDraft = { zone: 'A', corner: { tx: 5.5, tz: 10 } })],
    ['a draft with an extra key', (s) => void ((s.ui as SaveJson).zoneDraft = { zone: 'A', corner: { tx: 5, tz: 10 }, w: 3 })],
    ['an unknown zone letter', (s) => void ((s.ui as SaveJson).zoneLetter = 'I')],
    ['a missing zone letter', (s) => void delete (s.ui as SaveJson).zoneLetter],
  ];

  it.each(rejected)('rejects %s', (_label, edit) => {
    const save = corrupt(edit);
    expect(isValidGameState(save)).toBe(false);
    expect(deserializeGame(JSON.stringify(save))).toBeNull();
  });
});
```

Append to the end of `tests/panelKeys.test.ts`:

```ts

describe('Escape with a zone draft (part 3 spec §8)', () => {
  const DRAFT: GameState = deepFreeze({ ...BASE, ui: { ...BASE.ui, zoneDraft: { zone: 'A', corner: { tx: 5, tz: 10 } } } });

  it('drops the draft instead of pausing', () => {
    expect(panelKeyCommand('Escape', DRAFT)).toEqual(actions.clearZoneDraft());
    const dropped = press('Escape', DRAFT);
    expect(dropped.ui.zoneDraft).toBeNull();
    expect(dropped.ui.paused).toBe(false);
    expect(panelKeyCommand('Escape', dropped)).toEqual(actions.setPaused(true));
  });

  it('still closes an open panel first, and resumes a paused game', () => {
    const open: GameState = { ...DRAFT, ui: { ...DRAFT.ui, panel: { kind: 'shop' } } };
    expect(panelKeyCommand('Escape', open)).toEqual(actions.closePanel());
    const paused: GameState = { ...DRAFT, ui: { ...DRAFT.ui, paused: true } };
    expect(panelKeyCommand('Escape', paused)).toEqual(actions.setPaused(false));
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run tests/zoneMarker.test.ts tests/robotSaveV6.test.ts tests/panelKeys.test.ts`
Expected: FAIL.
- `tests/zoneMarker.test.ts` fails to load, no tests run: `Error: Cannot find module '../src/ui/zoneChip' imported from …/tests/zoneMarker.test.ts`.
- `tests/robotSaveV6.test.ts`: the new `describe` mostly fails. "gives a migrated save the marker in its first free slot" fails with `expected null to deeply equal { itemId: 'zoneMarker', quantity: 1, quality: 0 }`; "owes the marker …" with `expected undefined to be true`; the draft and letter rejections with `expected true to be false`. ("two markers in the inventory" already passes: 'zoneMarker' is not an item yet.) Task 1–8's cases still pass.
- `tests/panelKeys.test.ts`: "drops the draft instead of pausing" fails with `TypeError: actions.clearZoneDraft is not a function`.

`npm run typecheck` additionally reports the unknown `ZONE_MARKER`, `zoneDraft` and `pendingMarker`.

- [ ] **Step 3: Implement the tool, its state and its tables**

**3a. `src/core/types.ts`.** Replace:

```ts
export const TOOL_TYPES = ['hoe', 'wateringCan', 'pickaxe', 'axe', 'scythe'] as const;
```

with:

```ts
export const TOOL_TYPES = ['hoe', 'wateringCan', 'pickaxe', 'axe', 'scythe', 'zoneMarker'] as const;
```

(`UPGRADABLE_TOOLS` stays as it is, so the marker is never upgraded; `ActionKind` gains `'zoneMarker'` through `ToolType`.) In `UiState`, replace:

```ts
  /** Real-time multiplier applied by the game loop. Presentation only; ticks carry minutes. */
  readonly timeScale: number;
}
```

with:

```ts
  /** Real-time multiplier applied by the game loop. Presentation only; ticks carry minutes. */
  readonly timeScale: number;
  /** The zone marker's first corner while a zone is being painted (farmclaws part 3 spec §8). Reset on load. */
  readonly zoneDraft: null | { readonly zone: ZoneId; readonly corner: TileCoord };
  /** The zone the marker paints next. Presentation only; reset to A on load. */
  readonly zoneLetter: ZoneId;
}
```

In `RobotsState`, replace:

```ts
  readonly zones: Readonly<Record<ZoneId, ZoneRect | null>>;
```

with:

```ts
  readonly zones: Readonly<Record<ZoneId, ZoneRect | null>>;
  /** True while the zone marker owed to a migrated save waits for a free backpack slot (part 3 spec §8). */
  readonly pendingMarker: boolean;
```

**3b. `src/config.ts`.** In `TOOLS.energyCost`, replace:

```ts
    scythe: 0,
  },
```

with:

```ts
    scythe: 0,
    zoneMarker: 0,
  },
```

and replace the end of `TOOLS`:

```ts
  /** Wood dropped when a tree falls (the stump it leaves drops `woodFromStump` more). */
  woodFromTree: 4,
} as const;
```

with:

```ts
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
```

**3c. `src/items/items.ts`.** In `TOOL_INFO`, replace:

```ts
  scythe: { name: 'Scythe', description: 'Harvests ripe crops and clears withered ones.', color: 0xd9d4c7 },
};
```

with:

```ts
  scythe: { name: 'Scythe', description: 'Harvests ripe crops and clears withered ones.', color: 0xd9d4c7 },
  zoneMarker: {
    name: 'Zone Marker',
    description: 'Paints zones A to H for your robots. Use it to mark corners; Shift + use picks the zone.',
    color: 0xe2563f,
  },
};
```

(`buildRegistry` gives every tool `maxStack: 1`, `sellPrice: null` and `TOOLS.energyCost[tool]`, so the bin refuses it with "Zone Marker can't be shipped." and nothing sells it.)

**3d. `src/render/playerModel.ts`.** In the header comment, replace:

```ts
 * - Hoe, watering can, pickaxe, axe and scythe are merged vertex-coloured props. A seed pouch
```

with:

```ts
 * - Hoe, watering can, pickaxe, axe, scythe and zone marker are merged vertex-coloured props. A seed pouch
```

Replace:

```ts
  scythe: 0xf2c46b,
};
```

with:

```ts
  scythe: 0xf2c46b,
  zoneMarker: 0xf2c46b,
};

/** The zone marker's pennant (farmclaws part 3 spec §8). */
const PENNANT = 0xe2563f;
```

Replace:

```ts
function buildPouchGeometry(): THREE.BufferGeometry {
```

with:

```ts
/** A surveyor's stake: a short pole with a metal foot and a pennant near the top (farmclaws part 3 spec §8). */
function buildZoneMarkerGeometry(): THREE.BufferGeometry {
  const topY = 0.3;
  return bakeParts([
    { geometry: cylinder(0.018, 0.02, 0.44, 6), color: WOOD, position: [0, 0.09, 0] },
    { geometry: cylinder(0.026, 0.026, 0.07, 6), color: TOOL_WRAP.zoneMarker, position: [0, -0.085, 0] },
    { geometry: cone(0.02, 0.06, 6), color: METAL, position: [0, -0.16, 0], rotation: [Math.PI, 0, 0] },
    { geometry: box(0.012, 0.1, 0.14), color: PENNANT, position: [0, topY - 0.03, 0.075] },
    { geometry: box(0.014, 0.03, 0.03), color: PENNANT, shade: 0.8, position: [0, topY + 0.04, 0.012] },
  ]);
}

function buildPouchGeometry(): THREE.BufferGeometry {
```

In `HELD_MODEL_KINDS`, replace:

```ts
  'scythe',
  'pouch',
  'gem',
];
```

with:

```ts
  'scythe',
  'zoneMarker',
  'pouch',
  'gem',
];
```

In `HeldItemRack`'s constructor, replace:

```ts
      scythe: prop(buildScytheGeometry(), this.propMaterial),
```

with:

```ts
      scythe: prop(buildScytheGeometry(), this.propMaterial),
      zoneMarker: prop(buildZoneMarkerGeometry(), this.propMaterial),
```

**3e. `src/render/PlayerRenderer.ts`.** In `carryStyleFor`, replace:

```ts
    case 'scythe':
      return 'scythe';
    case 'wateringCan':
```

with:

```ts
    case 'scythe':
      return 'scythe';
    case 'zoneMarker':
      return 'small';
    case 'wateringCan':
```

In `ACTION_CLIPS`, replace:

```ts
  scythe: SCYTHE_SWEEP,
  plant: PLANT,
```

with:

```ts
  scythe: SCYTHE_SWEEP,
  /** Marking a corner crouches to the ground like planting. */
  zoneMarker: PLANT,
  plant: PLANT,
```

**3f. `src/render/EffectsRenderer.ts`.** In `react`'s success switch, replace:

```ts
      case 'plant':
      case 'fertilize':
        emitBurst(
```

with:

```ts
      case 'plant':
      case 'fertilize':
      case 'zoneMarker':
        emitBurst(
```

(A failed marker press already gets the tool puff through `isToolKind`.)

**3g. `src/ui/icons.ts`.** Replace:

```ts
function toolParts(tool: ToolType, color: number): SVGElement[] {
```

with:

```ts
/** A surveyor's stake: a post with a metal foot and a pennant in the item's colour (part 3 spec §8). */
function zoneMarkerParts(color: number): SVGElement[] {
  const handle = COLORS.handle;
  const metal = COLORS.metal;
  return [
    tilt(
      [
        stick(15, 27, 15, 5, handle, 3),
        faceted('13.4,26.4 16.6,26.4 15,30.6', hex(metal), [facet('15,26.4 16.6,26.4 15,30.6', dark(metal, 0.2))]),
        faceted('16,5 28,9.4 16,13.8', hex(color), [
          facet('16,5 28,9.4 16,9.4', light(color, 0.35)),
          facet('16,9.4 28,9.4 16,13.8', dark(color, 0.12)),
        ]),
      ],
      12,
    ),
  ];
}

function toolParts(tool: ToolType, color: number): SVGElement[] {
```

and in `toolParts`, replace:

```ts
    case 'scythe':
      return scytheParts(color);
  }
```

with:

```ts
    case 'scythe':
      return scytheParts(color);
    case 'zoneMarker':
      return zoneMarkerParts(color);
  }
```

**3h. `src/robots/zones.ts`.** Insert directly above `/** The tile one step ahead of the robot (it may be off the farm). */`:

```ts
/** The rectangle with corners `a` and `b`, both included, whichever is given first (part 3 spec §8). */
export function zoneRectBetween(a: TileCoord, b: TileCoord): ZoneRect {
  return {
    x0: Math.min(a.tx, b.tx),
    z0: Math.min(a.tz, b.tz),
    w: Math.abs(a.tx - b.tx) + 1,
    d: Math.abs(a.tz - b.tz) + 1,
  };
}

```

**3i. Create `src/state/zoneMarker.ts`:**

```ts
/**
 * The zone marker as an item (farmclaws part 3 spec §8): handing it out, and counting every copy
 * the player owns. Pure.
 */
import { MAP_IDS, type GameState, type InventoryState, type ItemStack } from '../core/types';
import { forEachTile } from '../world/tiles';
import { addItem } from './inventory';

/** The one zone marker a farm owns. */
export const ZONE_MARKER_STACK: ItemStack = { itemId: 'zoneMarker', quantity: 1, quality: 0 };

function markersIn(slots: readonly (ItemStack | null)[]): number {
  let count = 0;
  for (const stack of slots) if (stack !== null && stack.itemId === 'zoneMarker') count += stack.quantity;
  return count;
}

/** Zone markers in the player's inventory and in every chest on every map. */
export function countZoneMarkers(inventory: InventoryState, maps: GameState['maps']): number {
  let count = markersIn(inventory.slots);
  for (const id of MAP_IDS) {
    forEachTile(maps[id], (tile) => {
      if (tile.object !== null && tile.object.kind === 'chest') count += markersIn(tile.object.slots);
    });
  }
  return count;
}

/** `inventory` with the marker in its first free unlocked slot, or null when every unlocked slot is taken. */
export function withZoneMarker(inventory: InventoryState): InventoryState | null {
  const { inventory: next, added } = addItem(inventory, 'zoneMarker', 1);
  return added === 1 ? next : null;
}
```

**3j. `src/state/selectors.ts`.** Insert directly above `/** True while a menu or pause freezes the clock and the player. */`:

```ts
/** True while the zone marker is the selected hotbar item (farmclaws part 3 spec §8). */
export function isZoneMarkerSelected(state: GameState): boolean {
  return selectedStack(state.inventory)?.itemId === 'zoneMarker';
}

```

**3k. `src/state/initialState.ts`.** Leave the `../config` import line alone (Tasks 4 and 5 added `UNLOCKS` and `WORKBENCH` to it). Directly after it, add:

```ts
import { invariant } from '../core/invariant';
```

and replace the `../core/types` import line:

```ts
import { NPC_IDS, SAVE_VERSION, type GameSections, type GameState, type NpcId, type NpcRelation } from '../core/types';
```

with (keep any name an earlier task added to that line):

```ts
import { NPC_IDS, SAVE_VERSION, type GameSections, type GameState, type InventoryState, type NpcId, type NpcRelation } from '../core/types';
```

Replace:

```ts
import { createInventory } from './inventory';
```

with:

```ts
import { createInventory } from './inventory';
import { withZoneMarker } from './zoneMarker';
```

In `createDefaultSections`, replace:

```ts
      zones: { A: null, B: null, C: null, D: null, E: null, F: null, G: null, H: null },
```

with:

```ts
      zones: { A: null, B: null, C: null, D: null, E: null, F: null, G: null, H: null },
      pendingMarker: false,
```

Insert directly above `export function createInitialState(seed: number = WORLD.seed): GameState {`:

```ts
/** The starter kit, with the zone marker in the first slot it leaves free (farmclaws part 3 spec §8). */
function starterInventory(): InventoryState {
  const inventory = withZoneMarker(createInventory(INVENTORY.starting, TOOLS.wateringCanCapacity));
  invariant(inventory !== null, 'the starter kit leaves room for the zone marker');
  return inventory;
}

```

and in `createInitialState`, replace:

```ts
    inventory: createInventory(INVENTORY.starting, TOOLS.wateringCanCapacity),
    shipping: { pending: [], lastPayout: 0 },
    ui: { panel: { kind: 'none' }, paused: false, timeScale: 1 },
```

with:

```ts
    inventory: starterInventory(),
    shipping: { pending: [], lastPayout: 0 },
    ui: { panel: { kind: 'none' }, paused: false, timeScale: 1, zoneDraft: null, zoneLetter: 'A' },
```

The starter kit fills slots 0–5, so every new farm holds the marker in slot 6.

- [ ] **Step 4: Saves — migration, validation and v5Save**

**4a. `src/state/persistence.ts`.** In the `../core/types` import, replace:

```ts
  TileState,
  Weather,
  type ActionEvent,
```

with:

```ts
  TileState,
  Weather,
  ZONE_IDS,
  type ActionEvent,
```

Replace:

```ts
import { isValidSections } from './sectionValidation';
```

with:

```ts
import { isValidSections } from './sectionValidation';
import { ZONE_MARKER_STACK, countZoneMarkers } from './zoneMarker';
```

In `ACTION_KIND_TABLE`, replace:

```ts
  scythe: true,
  plant: true,
```

with:

```ts
  scythe: true,
  zoneMarker: true,
  plant: true,
```

Replace the whole `isValidUi` with its doc comment:

```ts
/**
 * The UI section. Only the panel's shape is checked (an object with a string `kind`): the loader
 * resets it anyway, and later panel kinds must not need a migration.
 */
function isValidUi(ui: unknown): boolean {
  return (
    isObj(ui) &&
    isObj(ui.panel) &&
    typeof ui.panel.kind === 'string' &&
    isBool(ui.paused) &&
    typeof ui.timeScale === 'number' &&
    (TIME.timeScales as readonly number[]).includes(ui.timeScale)
  );
}
```

with:

```ts
/** A zone draft (farmclaws part 3 spec §8): null, or a zone letter and a farm tile, nothing more. */
function isValidZoneDraft(v: unknown): boolean {
  if (v === null) return true;
  if (!isObj(v) || !hasExactKeys(v, ['zone', 'corner']) || !isOneOf(v.zone, ZONE_IDS)) return false;
  const corner = v.corner;
  return (
    isObj(corner) &&
    hasExactKeys(corner, ['tx', 'tz']) &&
    isInt(corner.tx) &&
    isInt(corner.tz) &&
    inBounds(MAPS.farm.grid, corner.tx, corner.tz)
  );
}

/**
 * The UI section. Only the panel's shape is checked (an object with a string `kind`): the loader
 * resets it anyway, and later panel kinds must not need a migration. The zone draft and letter
 * are reset on load too, but must still be well formed.
 */
function isValidUi(ui: unknown): boolean {
  return (
    isObj(ui) &&
    isObj(ui.panel) &&
    typeof ui.panel.kind === 'string' &&
    isBool(ui.paused) &&
    typeof ui.timeScale === 'number' &&
    (TIME.timeScales as readonly number[]).includes(ui.timeScale) &&
    isValidZoneDraft(ui.zoneDraft) &&
    isOneOf(ui.zoneLetter, ZONE_IDS)
  );
}

/**
 * At most one zone marker in the inventory and every chest together, and `pendingMarker` only
 * while there is none (farmclaws part 3 spec §9.2). Called once every section is known valid.
 */
function isValidZoneMarker(state: GameState): boolean {
  const held = countZoneMarkers(state.inventory, state.maps);
  return held <= 1 && !(state.robots.pendingMarker && held > 0);
}
```

At the end of `isValidGameState`'s `&&` chain, after `isValidRobotsSection(v.robots, v.maps, v.player)` and any condition Tasks 5–7 appended after it, add one last condition, so that the chain ends:

```ts
    isValidZoneMarker(v as unknown as GameState)
  );
}
```

(Every earlier condition has validated the sections it reads, so the cast is safe.)

Insert directly above the doc comment of `migrateSave` (below `migrateV5toV6`):

```ts
/** Zone markers in a saved inventory and in every saved chest, read from the raw JSON. */
function savedMarkerCount(save: Obj): number {
  let count = 0;
  const countIn = (slots: unknown): void => {
    if (!Array.isArray(slots)) return;
    for (const slot of slots as readonly unknown[]) if (isObj(slot) && slot.itemId === ZONE_MARKER_STACK.itemId) count++;
  };
  if (isObj(save.inventory)) countIn(save.inventory.slots);
  if (!isObj(save.maps)) return count;
  for (const world of Object.values(save.maps)) {
    if (!isObj(world) || !Array.isArray(world.chunks)) continue;
    for (const chunk of world.chunks as readonly unknown[]) {
      if (!isObj(chunk) || !Array.isArray(chunk.tiles)) continue;
      for (const tile of chunk.tiles as readonly unknown[]) {
        if (isObj(tile) && isObj(tile.object) && tile.object.kind === 'chest') countIn(tile.object.slots);
      }
    }
  }
  return count;
}

/**
 * Version 6's zone marker (farmclaws part 3 spec §8, §9.1), the last part of the v5 → v6 step:
 * the marker goes into the first free unlocked inventory slot, or `robots.pendingMarker` is set
 * when the backpack is full. A save that already holds a marker keeps just that one. The UI
 * gains an empty draft and Zone A.
 */
function migrateZoneMarker(save: Obj): Obj {
  const { inventory, robots } = save;
  if (save.version !== 6 || !isObj(inventory) || !Array.isArray(inventory.slots) || !isObj(robots)) return save;
  const ui = isObj(save.ui) ? { ...save.ui, zoneDraft: null, zoneLetter: 'A' } : save.ui;
  if (savedMarkerCount(save) > 0) return { ...save, ui, robots: { ...robots, pendingMarker: false } };
  const unlocked = isInt(inventory.unlockedSlots) ? inventory.unlockedSlots : 0;
  const slots = (inventory.slots as readonly unknown[]).slice();
  const free = slots.findIndex((slot, i) => slot === null && i < unlocked);
  if (free === -1) return { ...save, ui, robots: { ...robots, pendingMarker: true } };
  slots[free] = { ...ZONE_MARKER_STACK };
  return { ...save, ui, inventory: { ...inventory, slots }, robots: { ...robots, pendingMarker: false } };
}

```

In `migrateSave`, replace Task 1's line:

```ts
  if (isObj(v) && v.version === 5) v = migrateV5toV6(v);
```

with:

```ts
  if (isObj(v) && v.version === 5) v = migrateZoneMarker(migrateV5toV6(v));
```

(A save `migrateV5toV6` leaves at version 5 passes through `migrateZoneMarker` untouched, for the validator to reject.) In `deserializeGame`, replace:

```ts
    return { ...parsed, ui: { ...parsed.ui, panel: { kind: 'none' }, paused: false } };
```

with:

```ts
    return { ...parsed, ui: { ...parsed.ui, panel: { kind: 'none' }, paused: false, zoneDraft: null, zoneLetter: 'A' } };
```

**4b. `src/state/robotValidation.ts`.** In `isValidRobotsSection`, add `'pendingMarker'` as the last entry of the exact-keys list on its first line (after `'unlocks'`, which Task 4 appended), and add a line directly below it, so the two lines read:

```ts
  if (!isObj(v) || !hasExactKeys(v, ['nextId', 'list', 'pool', 'log', 'lastNightFuel', 'zones', 'unlocks', 'pendingMarker']) || !isObj(player)) return false;
  if (!isBool(v.pendingMarker)) return false;
```

(`isBool` is already imported there.)

**4c. `tests/testUtils.ts`.** In `v5Save`, insert directly before its final `return save;`:

```ts
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
```

`legacySave` builds on `v5Save`, so v1 and v2 saves made from a current state no longer carry the marker (its "no backpack" check would otherwise see slot 6 only when the hotbar holds it, and the v1/v2 migrations then hand it back through `migrateZoneMarker`).

- [ ] **Step 5: Painting, cycling and clearing**

**5a. `src/state/intents.ts`.** In the `../core/types` import, add `type ZoneId,` and `type ZoneRect,` after `type TileCoord,`. Replace:

```ts
import { requireRobot, robotsOnTile } from '../robots/world';
```

with (keep any name an earlier task added to it):

```ts
import { requireRobot, robotsOnTile } from '../robots/world';
import { zoneRectBetween } from '../robots/zones';
```

Add `isZoneMarkerSelected` to the `./selectors` import, which then reads:

```ts
import { isZoneMarkerSelected, selectActiveMap, selectActiveWorld, selectScatterPatch, selectTargetTile } from './selectors';
```

In the `Intent` union, replace Task 8's member:

```ts
  /** Shift + E on a standing robot: its screen opens read-only, for free (part 3 spec §2.3). */
  | { readonly kind: 'peekRobot'; readonly robotId: number; readonly name: string }
```

with:

```ts
  /** Shift + E on a standing robot: its screen opens read-only, for free (part 3 spec §2.3). */
  | { readonly kind: 'peekRobot'; readonly robotId: number; readonly name: string }
  /** The zone marker's first press: the draft's corner (part 3 spec §8). */
  | { readonly kind: 'zoneCorner'; readonly corner: TileCoord }
  /** The zone marker's second press: the rectangle from the draft's corner becomes the zone. */
  | { readonly kind: 'markZone'; readonly zone: ZoneId; readonly rect: ZoneRect }
  /** Shift + E with the zone marker: the current letter's zone is cleared. */
  | { readonly kind: 'clearZone'; readonly zone: ZoneId }
```

At the end of `planTool`, replace the scythe case's last two lines and the closing braces:

```ts
      if (tile.state === TileState.Blocked) return blocked(target, tool, blockerHint(tile.blocker));
      return blocked(target, tool);
  }
}
```

with:

```ts
      if (tile.state === TileState.Blocked) return blocked(target, tool, blockerHint(tile.blocker));
      return blocked(target, tool);

    case 'zoneMarker':
      return planMarker(state, target);
  }
}

/** Why the zone marker does nothing off the farm (part 3 spec §8). */
export const ZONES_FARM_ONLY = 'Zones are only on the farm.';

/**
 * The zone marker on the tile ahead (part 3 spec §8): with no draft the press sets the draft's
 * corner; with one it paints the rectangle from that corner to this tile as the draft's zone.
 * Free, on any farm tile, and only on the farm.
 */
function planMarker(state: GameState, target: TileCoord): ActionPlan {
  if (state.player.mapId !== 'farm') return blocked(target, 'zoneMarker', ZONES_FARM_ONLY);
  const draft = state.ui.zoneDraft;
  if (draft === null) return plan(target, { kind: 'zoneCorner', corner: target }, 'zoneMarker');
  return plan(target, { kind: 'markZone', zone: draft.zone, rect: zoneRectBetween(draft.corner, target) }, 'zoneMarker');
}

/**
 * Shift + E with the zone marker (part 3 spec §8): clears the current letter's zone. An empty
 * zone has nothing to clear (silent); off the farm it is refused like painting. Facing the edge
 * of the world, the player's own tile stands in for the target.
 */
function planClearZone(state: GameState, target: TileCoord | null): ActionPlan {
  const at = target ?? { tx: state.player.tx, tz: state.player.tz };
  if (state.player.mapId !== 'farm') return blocked(at, 'zoneMarker', ZONES_FARM_ONLY);
  const zone = state.ui.zoneLetter;
  if (state.robots.zones[zone] === null) return blocked(at, 'none');
  return plan(at, { kind: 'clearZone', zone }, 'zoneMarker');
}
```

(The marker's `energyCost` is 0, so `withEnergy` never refuses it.) In `planShiftInteraction`'s doc comment, replace:

```ts
 *   3. otherwise nothing, silently.
```

with:

```ts
 *   3. the zone marker selected: clear the current letter's zone (spec §8);
 *   4. otherwise nothing, silently.
```

and in its body replace:

```ts
    if (robot !== undefined) return plan(target, { kind: 'peekRobot', robotId: robot.id, name: robot.name }, 'none');
  }
  return blocked(target, 'none');
}
```

with:

```ts
    if (robot !== undefined) return plan(target, { kind: 'peekRobot', robotId: robot.id, name: robot.name }, 'none');
  }
  if (isZoneMarkerSelected(state)) return planClearZone(state, target);
  return blocked(target, 'none');
}
```

In `describeIntent`, replace:

```ts
    case 'peekRobot':
      return `Look at ${intent.name}`;
```

with:

```ts
    case 'peekRobot':
      return `Look at ${intent.name}`;
    case 'zoneCorner':
      return 'Mark corner';
    case 'markZone':
      return `Mark Zone ${intent.zone}`;
    case 'clearZone':
      return `Clear Zone ${intent.zone}`;
```

**5b. `src/state/actions.ts`.** Replace:

```ts
  | { readonly type: 'game/setTimeScale'; readonly timeScale: number }
```

with:

```ts
  | { readonly type: 'game/setTimeScale'; readonly timeScale: number }
  /** Shift + use with the zone marker: the next zone letter, A → H → A; drops a draft (part 3 spec §8). */
  | { readonly type: 'zone/cycle' }
  /** Drops the zone marker's draft (Escape). */
  | { readonly type: 'zone/clearDraft' }
```

and replace:

```ts
  setTimeScale: (timeScale: number): GameAction => ({ type: 'game/setTimeScale', timeScale }),
```

with:

```ts
  setTimeScale: (timeScale: number): GameAction => ({ type: 'game/setTimeScale', timeScale }),
  cycleZoneLetter: (): GameAction => ({ type: 'zone/cycle' }),
  clearZoneDraft: (): GameAction => ({ type: 'zone/clearDraft' }),
```

(The names avoid the dist check's `setZone` substring.)

**5c. `src/state/reducer.ts`.** In the `../core/types` import, replace:

```ts
  TileState,
  Weather,
  type ActionKind,
```

with:

```ts
  TileState,
  Weather,
  ZONE_IDS,
  type ActionKind,
```

Replace Task 2's import:

```ts
import { programmedRobot, withMd } from '../robots/edits';
```

with:

```ts
import { programmedRobot, withMd, withZone } from '../robots/edits';
```

Replace the head of `gameReducer`:

```ts
export function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
```

with:

```ts
export function gameReducer(state: GameState, action: GameAction): GameState {
  return dropStaleDraft(state, reduceAction(state, action));
}

/**
 * A zone draft (farmclaws part 3 spec §8) lasts only while its corner still means something: it
 * drops when the selected hotbar slot changes, the player changes map or any panel opens.
 */
function dropStaleDraft(prev: GameState, next: GameState): GameState {
  if (next.ui.zoneDraft === null) return next;
  const stale =
    next.ui.panel.kind !== 'none' ||
    next.inventory.selected !== prev.inventory.selected ||
    next.player.mapId !== prev.player.mapId;
  return stale ? { ...next, ui: { ...next.ui, zoneDraft: null } } : next;
}

function reduceAction(state: GameState, action: GameAction): GameState {
  switch (action.type) {
```

(The rest of the old `gameReducer` body, its `default` exhaustiveness check included, is now `reduceAction`'s. A state without a draft comes back by reference, so no-op actions stay no-ops.) In that switch, replace:

```ts
    case 'game/setTimeScale':
      return setTimeScale(state, action.timeScale);
```

with:

```ts
    case 'game/setTimeScale':
      return setTimeScale(state, action.timeScale);
    case 'zone/cycle':
      return nextZoneLetter(state);
    case 'zone/clearDraft':
      return state.ui.zoneDraft === null ? state : { ...state, ui: { ...state.ui, zoneDraft: null } };
```

In `applyIntent`, replace Task 8's case:

```ts
    case 'peekRobot':
      return { ...state, ui: { ...state.ui, panel: { kind: 'robot', robotId: intent.robotId, mode: 'peek' } } };
```

with:

```ts
    case 'peekRobot':
      return { ...state, ui: { ...state.ui, panel: { kind: 'robot', robotId: intent.robotId, mode: 'peek' } } };

    case 'zoneCorner':
      return { ...state, ui: { ...state.ui, zoneDraft: { zone: state.ui.zoneLetter, corner: intent.corner } } };

    case 'markZone': {
      const done: GameState = { ...state, ui: { ...state.ui, zoneDraft: null } };
      const painted = withZone(done, intent.zone, intent.rect);
      if (typeof painted === 'string') return pushMessage(done, painted, 'warn');
      return pushMessage(painted, `Zone ${intent.zone} · ${intent.rect.w}×${intent.rect.d}.`, 'success');
    }

    case 'clearZone': {
      const cleared = withZone(state, intent.zone, null);
      if (typeof cleared === 'string') return pushMessage(state, cleared, 'warn');
      return pushMessage(cleared, `Cleared Zone ${intent.zone}.`, 'info');
    }
```

(Both rectangles lie on the farm, so `withZone`'s refusal is unreachable here; it is shown as is if it ever happens.) Insert directly above `function setTimeScale(state: GameState, timeScale: number): GameState {`:

```ts
/** Shift + use with the zone marker: the next letter, A → H → A, dropping any draft (part 3 spec §8). */
function nextZoneLetter(state: GameState): GameState {
  if (selectIsFrozen(state)) return state;
  const next = ZONE_IDS[(ZONE_IDS.indexOf(state.ui.zoneLetter) + 1) % ZONE_IDS.length] ?? 'A';
  return { ...state, ui: { ...state.ui, zoneLetter: next, zoneDraft: null } };
}

```

and replace the head of `loadState`:

```ts
/** Replaces the whole state (new game / loaded save): no panel open, unpaused, the player flagged as teleported. */
function loadState(prev: GameState, loaded: GameState): GameState {
  return {
    ...loaded,
    ui: { ...loaded.ui, panel: { kind: 'none' }, paused: false },
```

with:

```ts
/** Replaces the whole state (new game / loaded save): no panel open, unpaused, no zone draft, the player flagged as teleported. */
function loadState(prev: GameState, loaded: GameState): GameState {
  return {
    ...loaded,
    ui: { ...loaded.ui, panel: { kind: 'none' }, paused: false, zoneDraft: null },
```

**5d. `src/robots/overnight.ts`.** Replace:

```ts
import { forEachTile, getTile, isWalkable, setTiles, type TileEdit } from '../world/tiles';
```

with:

```ts
import { withZoneMarker } from '../state/zoneMarker';
import { forEachTile, getTile, isWalkable, setTiles, type TileEdit } from '../world/tiles';
```

Insert directly above `/** The whole night, in the spec's order. \`notes\` become morning toasts. */`:

```ts
/**
 * A zone marker owed to a migrated save (part 3 spec §8) arrives the first morning the backpack
 * has a free slot; until then it keeps waiting.
 */
function deliverPendingMarker(state: GameState, notes: RobotNote[]): GameState {
  if (!state.robots.pendingMarker) return state;
  const inventory = withZoneMarker(state.inventory);
  if (inventory === null) return state;
  notes.push({ text: 'Your zone marker is in your backpack.', tone: 'info' });
  return { ...state, inventory, robots: { ...state.robots, pendingMarker: false } };
}

```

and in `runRobotsOvernight`, replace:

```ts
  next = resetForMorning(next);
```

with:

```ts
  next = deliverPendingMarker(resetForMorning(next), notes);
```

- [ ] **Step 6: Keys — Escape, fresh presses only, Shift cycles**

**6a. `src/input/panelKeys.ts`.** In the header comment, replace:

```ts
 *   Escape         closes any open panel, otherwise toggles pause
```

with:

```ts
 *   Escape         closes any open panel, otherwise drops a zone draft, otherwise toggles pause
 *
 * markerToolCommand decides the tool keys while the zone marker is selected.
```

Replace:

```ts
import { actions, type GameAction } from '../state/actions';
```

with:

```ts
import { actions, type GameAction } from '../state/actions';
import { isZoneMarkerSelected } from '../state/selectors';
```

Replace:

```ts
    case 'Escape':
      return panel !== 'none' ? actions.closePanel() : actions.setPaused(!state.ui.paused);
```

with:

```ts
    case 'Escape':
      if (panel !== 'none') return actions.closePanel();
      // A zone draft drops before Escape pauses (part 3 spec §8); while paused, Escape resumes.
      if (state.ui.zoneDraft !== null && !state.ui.paused) return actions.clearZoneDraft();
      return actions.setPaused(!state.ui.paused);
```

Append at the end of the file:

```ts

/**
 * A tool press (Space, J or a left click) while the zone marker is selected (part 3 spec §8):
 * only fresh presses count, so a held key never marks a second corner, and Shift picks the next
 * zone letter. IGNORED for a held-key repeat; null when the marker isn't selected, which leaves
 * the press to the ordinary tool path.
 */
export function markerToolCommand(state: GameState, shift: boolean, repeat: boolean): PanelKeyCommand | null {
  if (!isZoneMarkerSelected(state)) return null;
  if (repeat) return IGNORED;
  return shift ? actions.cycleZoneLetter() : actions.useTool();
}
```

**6b. `src/input/InputController.ts`.** In the header comment, replace:

```ts
 *   Use tool      Space, J, left mouse button on the canvas. Hold to repeat.
```

with:

```ts
 *   Use tool      Space, J, left mouse button on the canvas. Hold to repeat. With the zone
 *                 marker only fresh presses count, and Shift + any of them picks the next zone
 *                 letter (part 3 spec §8; markerToolCommand in panelKeys.ts).
```

Replace:

```ts
import { selectIsFrozen } from '../state/selectors';
import { IGNORED, panelKeyCommand } from './panelKeys';
```

with:

```ts
import { isZoneMarkerSelected, selectIsFrozen } from '../state/selectors';
import { IGNORED, markerToolCommand, panelKeyCommand } from './panelKeys';
```

In `updateTool`, replace:

```ts
  private updateTool(dt: number): void {
    if (this.toolSources.size === 0) {
```

with:

```ts
  private updateTool(dt: number): void {
    // The zone marker never repeats, even for a key held down before the marker was selected.
    if (this.toolSources.size === 0 || isZoneMarkerSelected(this.store.getState())) {
```

In `handleKeyDown`, replace:

```ts
    if (TOOL_KEYS.has(code)) {
      this.pressTool(code, event.repeat);
```

with:

```ts
    if (TOOL_KEYS.has(code)) {
      this.pressTool(code, event.repeat, event.shiftKey);
```

Replace:

```ts
  private pressTool(source: string, repeat: boolean): void {
    if (repeat) {
```

with:

```ts
  private pressTool(source: string, repeat: boolean, shift: boolean): void {
    const marker = markerToolCommand(this.store.getState(), shift, repeat);
    if (marker !== null) {
      // The zone marker is never held: no source is tracked, so nothing repeats.
      if (marker !== IGNORED && !this.isFrozen()) this.store.dispatch(marker);
      return;
    }
    if (repeat) {
```

and in `onPointerDown`, replace:

```ts
      this.pressTool(pointerSource(event.pointerId), false);
```

with:

```ts
      this.pressTool(pointerSource(event.pointerId), false, event.shiftKey);
```

(Shift + arrows keeps meaning "turn in place": only the tool keys and the left button consult `markerToolCommand`.)

- [ ] **Step 7: The HUD chip**

Create `src/ui/zoneChip.ts`:

```ts
/**
 * The zone marker's HUD chip (farmclaws part 3 spec §8): the letter the marker paints, that
 * zone's size, and whether a first corner is down. Pure, so it is tested without a DOM.
 */
import type { GameState } from '../core/types';
import { isZoneMarkerSelected } from '../state/selectors';

/** "Zone A · 3×3" or "Zone A · not set", plus " · corner set" during a draft; null unless the marker is selected. */
export function zoneChipText(state: GameState): string | null {
  if (!isZoneMarkerSelected(state)) return null;
  const letter = state.ui.zoneLetter;
  const rect = state.robots.zones[letter];
  const size = rect === null ? 'not set' : `${rect.w}×${rect.d}`;
  return `Zone ${letter} · ${size}${state.ui.zoneDraft === null ? '' : ' · corner set'}`;
}
```

In `src/ui/Hud.ts`, replace:

```ts
import { InventoryScreen } from './InventoryScreen';
import { ItemIconCache, SLOT_KEYS, createSlotView, renderSlotView, type SlotView } from './slots';
```

with:

```ts
import { InventoryScreen } from './InventoryScreen';
import { ItemIconCache, SLOT_KEYS, createSlotView, renderSlotView, type SlotView } from './slots';
import { zoneChipText } from './zoneChip';
```

Replace the banner:

```ts
// ---------------------------------------------------------------------------
// Message toasts
// ---------------------------------------------------------------------------
```

with:

```ts
// ---------------------------------------------------------------------------
// Zone chip
// ---------------------------------------------------------------------------

/** Above the hotbar while the zone marker is selected: "Zone A · 3×3", plus "corner set" during a draft. */
class ZoneChip {
  readonly element = h('div', 'hud-chip hud-zone-chip');

  constructor() {
    this.element.hidden = true;
  }

  sync(state: GameState, prev: GameState | null): void {
    if (prev !== null && state.inventory === prev.inventory && state.ui === prev.ui && state.robots.zones === prev.robots.zones) {
      return;
    }
    const text = zoneChipText(state);
    setHidden(this.element, text === null);
    if (text !== null) setText(this.element, text);
  }
}

// ---------------------------------------------------------------------------
// Message toasts
// ---------------------------------------------------------------------------
```

In `Hud`, replace:

```ts
  private readonly hint: ContextHint;
  private readonly toasts: ToastStack;
```

with:

```ts
  private readonly hint: ContextHint;
  private readonly zoneChip: ZoneChip;
  private readonly toasts: ToastStack;
```

replace:

```ts
    this.hint = new ContextHint();
    this.toasts = new ToastStack();
```

with:

```ts
    this.hint = new ContextHint();
    this.zoneChip = new ZoneChip();
    this.toasts = new ToastStack();
```

replace:

```ts
    center.append(this.hint.element, this.hotbar.element);
```

with:

```ts
    center.append(this.hint.element, this.zoneChip.element, this.hotbar.element);
```

and in `Hud.sync`, replace:

```ts
    this.hint.sync(state, prev);
    this.toasts.sync(state, prev);
```

with:

```ts
    this.hint.sync(state, prev);
    this.zoneChip.sync(state, prev);
    this.toasts.sync(state, prev);
```

In `src/ui/hud.css`, replace:

```css
.hud-hint__verb {
  overflow: hidden;
  text-overflow: ellipsis;
}
```

with:

```css
.hud-hint__verb {
  overflow: hidden;
  text-overflow: ellipsis;
}

/* The zone marker's chip (farmclaws part 3 spec §8), between the hint and the hotbar. */
.hud-zone-chip {
  padding: 4px 12px;
  background: var(--hud-parchment);
  color: var(--hud-ink);
}
```

(`.hud [hidden]` already hides it while the marker isn't selected.)

- [ ] **Step 8: The zone overlay**

Create `src/render/ZoneRenderer.ts`:

```ts
/**
 * ZoneRenderer — zones A–H drawn on the farm (farmclaws part 3 spec §8).
 *
 * - When: on the farm, while the zone marker is the selected hotbar item or a robot screen is
 *   open. Hidden everywhere else.
 * - Each set zone: a thin outline in its colour (ZONE_MARKER.colors, A … H) along every outer
 *   tile edge, ZONE_MARKER.outlineHeight above the ground of the zone tile the edge borders and
 *   inset by half a stroke so neighbouring zones stay apart; and its letter floating over its
 *   north-west tile.
 * - The draft: the same outline, paler, from the draft's corner to the highlighted tile
 *   (selectTargetTile, the tile the next press would mark), so it follows the player.
 * - Two InstancedMeshes of one flat quad (set zones, draft), each sized once for every edge the
 *   farm can hold, and eight letter sprites cut from one canvas atlas drawn in the constructor.
 *   Matrices are written in sync only, when the zones, the draft, the target or the farm's
 *   ground change. update() only bobs the letters, without allocating.
 */
import * as THREE from 'three';
import { ZONE_MARKER } from '../config';
import { ZONE_IDS, type GameState, type WorldState, type ZoneId, type ZoneRect } from '../core/types';
import { zoneRectBetween } from '../robots/zones';
import { isZoneMarkerSelected, selectTargetTile } from '../state/selectors';
import { tileCenterX, tileCenterZ } from '../world/grid';
import { MAPS } from '../world/maps';
import { getTile } from '../world/tiles';
import type { SceneContext } from './SceneContext';
import { highlightGroundHeight } from './TileHighlighter';
import type { FrameContext, RenderSystem } from './types';

/** Outline stroke width, as a share of a tile. */
const STROKE = 0.08;
/** The draft's outline mixes this much white into its zone's colour. */
const DRAFT_PALENESS = 0.45;
/** Letter sprites: their size, and how high they float above the corner tile's ground (world units). */
const LETTER_SIZE = 0.6;
const LETTER_LIFT = 0.55;
const LETTER_BOB = 0.04;
const LETTER_BOB_RATE = 2.2;
/** The letter atlas: one square cell per zone, white letters with an ink outline, tinted per sprite. */
const ATLAS_CELL = 64;
const ATLAS_FONT = `700 ${Math.round(ATLAS_CELL * 0.7)}px "Trebuchet MS", "Segoe UI", sans-serif`;
const ATLAS_INK = '#5a3d2b';
const ATLAS_OUTLINE = 8;

/** Outer tile edges of the largest rectangle the farm holds: the most one outline ever needs. */
const MAX_EDGES = 2 * (MAPS.farm.grid.width + MAPS.farm.grid.depth);

const scratchMatrix = new THREE.Matrix4();
const scratchColor = new THREE.Color();
const WHITE = new THREE.Color(0xffffff);

function zoneColor(id: ZoneId): number {
  return ZONE_MARKER.colors[ZONE_IDS.indexOf(id)] ?? 0xffffff;
}

function sameRect(a: ZoneRect | null, b: ZoneRect | null): boolean {
  if (a === null || b === null) return a === b;
  return a.x0 === b.x0 && a.z0 === b.z0 && a.w === b.w && a.d === b.d;
}

/** A canvas holding the letters A … H side by side, one ATLAS_CELL square each. */
function drawLetterAtlas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_CELL * ZONE_IDS.length;
  canvas.height = ATLAS_CELL;
  const g = canvas.getContext('2d');
  if (g === null) throw new Error('ZoneRenderer: no 2D canvas context for the zone letters');
  g.font = ATLAS_FONT;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.lineWidth = ATLAS_OUTLINE;
  g.strokeStyle = ATLAS_INK;
  g.fillStyle = '#ffffff';
  ZONE_IDS.forEach((id, i) => {
    const x = (i + 0.5) * ATLAS_CELL;
    const y = ATLAS_CELL / 2;
    g.strokeText(id, x, y);
    g.fillText(id, x, y);
  });
  return canvas;
}

export class ZoneRenderer implements RenderSystem {
  private readonly ctx: SceneContext;
  private readonly group = new THREE.Group();
  private readonly quad = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  private readonly zoneMaterial = new THREE.MeshBasicMaterial({ toneMapped: false, fog: false });
  private readonly draftMaterial = new THREE.MeshBasicMaterial({ toneMapped: false, fog: false });
  /** Every set zone's edges; instance colours carry each zone's colour. */
  private readonly outlines: THREE.InstancedMesh;
  /** The draft's edges, in draftMaterial's one colour. */
  private readonly draft: THREE.InstancedMesh;
  private readonly atlas: THREE.CanvasTexture;
  /** One atlas view per letter (shared image, own offset), in ZONE_IDS order. */
  private readonly letterMaps: readonly THREE.Texture[];
  private readonly letters: readonly THREE.Sprite[];
  /** Resting height of each letter, for the bob. */
  private readonly letterY = new Float32Array(ZONE_IDS.length);
  /** What is drawn now: the zones and farm it was laid out from (null when hidden), and the draft. */
  private zones: GameState['robots']['zones'] | null = null;
  private farm: WorldState | null = null;
  private draftRect: ZoneRect | null = null;
  private draftZone: ZoneId | null = null;

  constructor(ctx: SceneContext) {
    this.ctx = ctx;
    const capacity = MAX_EDGES * ZONE_IDS.length;
    this.outlines = new THREE.InstancedMesh(this.quad, this.zoneMaterial, capacity);
    // Instance colours must exist before the first render, or the shader is built without them.
    this.outlines.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3).fill(1), 3);
    this.outlines.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.outlines.name = 'zone-outlines';
    this.draft = new THREE.InstancedMesh(this.quad, this.draftMaterial, MAX_EDGES);
    this.draft.name = 'zone-draft';
    for (const mesh of [this.outlines, this.draft]) {
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.renderOrder = 1;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    }

    this.atlas = new THREE.CanvasTexture(drawLetterAtlas());
    this.atlas.colorSpace = THREE.SRGBColorSpace;
    const maps: THREE.Texture[] = [];
    const letters: THREE.Sprite[] = [];
    ZONE_IDS.forEach((id, i) => {
      const map = this.atlas.clone();
      map.repeat.set(1 / ZONE_IDS.length, 1);
      map.offset.set(i / ZONE_IDS.length, 0);
      map.needsUpdate = true;
      const material = new THREE.SpriteMaterial({ map, color: zoneColor(id), depthWrite: false, toneMapped: false, fog: false });
      const sprite = new THREE.Sprite(material);
      sprite.name = `zone-letter-${id}`;
      sprite.scale.set(LETTER_SIZE, LETTER_SIZE, 1);
      sprite.renderOrder = 3;
      sprite.visible = false;
      maps.push(map);
      letters.push(sprite);
    });
    this.letterMaps = maps;
    this.letters = letters;

    this.group.name = 'zones';
    this.group.visible = false;
    this.group.add(this.outlines, this.draft, ...letters);
    ctx.scene.add(this.group);
  }

  sync(state: GameState, prev: GameState | null): void {
    const shown = state.player.mapId === 'farm' && (isZoneMarkerSelected(state) || state.ui.panel.kind === 'robot');
    this.group.visible = shown;
    if (!shown) {
      this.zones = null;
      this.farm = null;
      this.draftRect = null;
      this.draftZone = null;
      return;
    }
    const farm = state.maps.farm;
    const groundChanged = prev === null || farm !== this.farm;
    if (groundChanged || state.robots.zones !== this.zones) this.layoutZones(state.robots.zones, farm);
    this.layoutDraft(state, farm, groundChanged);
    this.zones = state.robots.zones;
    this.farm = farm;
  }

  update(frame: FrameContext): void {
    if (!this.group.visible) return;
    const bob = LETTER_BOB * Math.sin(frame.elapsed * LETTER_BOB_RATE);
    for (let i = 0; i < this.letters.length; i++) {
      const letter = this.letters[i];
      if (letter !== undefined && letter.visible) letter.position.y = (this.letterY[i] ?? 0) + bob;
    }
  }

  dispose(): void {
    this.ctx.scene.remove(this.group);
    this.group.clear();
    this.outlines.dispose();
    this.draft.dispose();
    this.quad.dispose();
    this.zoneMaterial.dispose();
    this.draftMaterial.dispose();
    for (const letter of this.letters) letter.material.dispose();
    for (const map of this.letterMaps) map.dispose();
    this.atlas.dispose();
  }

  /** Outlines and letters for every set zone. */
  private layoutZones(zones: GameState['robots']['zones'], farm: WorldState): void {
    let used = 0;
    ZONE_IDS.forEach((id, i) => {
      const rect = zones[id];
      const letter = this.letters[i];
      if (letter === undefined) return;
      letter.visible = rect !== null;
      if (rect === null) return;
      used = this.layoutOutline(this.outlines, used, rect, farm, scratchColor.setHex(zoneColor(id)));
      const corner = getTile(farm, rect.x0, rect.z0);
      const y = (corner === null ? 0 : highlightGroundHeight(corner)) + LETTER_LIFT;
      this.letterY[i] = y;
      letter.position.set(tileCenterX(farm.grid, rect.x0), y, tileCenterZ(farm.grid, rect.z0));
    });
    this.commit(this.outlines, used);
  }

  /** The draft's outline, from its corner to the tile the next press would mark. */
  private layoutDraft(state: GameState, farm: WorldState, force: boolean): void {
    const draft = state.ui.zoneDraft;
    const rect = draft === null ? null : zoneRectBetween(draft.corner, selectTargetTile(state) ?? draft.corner);
    const zone = draft === null ? null : draft.zone;
    if (!force && zone === this.draftZone && sameRect(rect, this.draftRect)) return;
    this.draftRect = rect;
    this.draftZone = zone;
    if (rect === null || zone === null) {
      this.commit(this.draft, 0);
      return;
    }
    this.draftMaterial.color.setHex(zoneColor(zone)).lerp(WHITE, DRAFT_PALENESS);
    this.commit(this.draft, this.layoutOutline(this.draft, 0, rect, farm, null));
  }

  /**
   * One quad per outer tile edge of `rect`, written into `mesh` from slot `start` (with `color`
   * as the instance colour when given). Returns the next free slot.
   */
  private layoutOutline(mesh: THREE.InstancedMesh, start: number, rect: ZoneRect, farm: WorldState, color: THREE.Color | null): number {
    const grid = farm.grid;
    const ts = grid.tileSize;
    const half = (STROKE * ts) / 2;
    const north = grid.originZ + rect.z0 * ts + half;
    const south = grid.originZ + (rect.z0 + rect.d) * ts - half;
    const west = grid.originX + rect.x0 * ts + half;
    const east = grid.originX + (rect.x0 + rect.w) * ts - half;
    let slot = start;
    for (let tx = rect.x0; tx < rect.x0 + rect.w; tx++) {
      const x = tileCenterX(grid, tx);
      slot = this.edge(mesh, slot, farm, tx, rect.z0, x, north, true, color);
      slot = this.edge(mesh, slot, farm, tx, rect.z0 + rect.d - 1, x, south, true, color);
    }
    for (let tz = rect.z0; tz < rect.z0 + rect.d; tz++) {
      const z = tileCenterZ(grid, tz);
      slot = this.edge(mesh, slot, farm, rect.x0, tz, west, z, false, color);
      slot = this.edge(mesh, slot, farm, rect.x0 + rect.w - 1, tz, east, z, false, color);
    }
    return slot;
  }

  /** One edge: a tile long along x (`alongX`) or z, one stroke wide, just above tile (tx, tz)'s ground. */
  private edge(
    mesh: THREE.InstancedMesh,
    slot: number,
    farm: WorldState,
    tx: number,
    tz: number,
    x: number,
    z: number,
    alongX: boolean,
    color: THREE.Color | null,
  ): number {
    const ts = farm.grid.tileSize;
    const stroke = STROKE * ts;
    const tile = getTile(farm, tx, tz);
    const y = (tile === null ? 0 : highlightGroundHeight(tile)) + ZONE_MARKER.outlineHeight;
    scratchMatrix.makeScale(alongX ? ts : stroke, 1, alongX ? stroke : ts).setPosition(x, y, z);
    mesh.setMatrixAt(slot, scratchMatrix);
    if (color !== null) mesh.setColorAt(slot, color);
    return slot + 1;
  }

  private commit(mesh: THREE.InstancedMesh, count: number): void {
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;
  }
}
```

In `src/main.ts`, replace:

```ts
import { WeatherRenderer } from './render/WeatherRenderer';
```

with:

```ts
import { WeatherRenderer } from './render/WeatherRenderer';
import { ZoneRenderer } from './render/ZoneRenderer';
```

and in `systems`, replace:

```ts
    new TileHighlighter(ctx),
```

with:

```ts
    new TileHighlighter(ctx),
    new ZoneRenderer(ctx),
```

- [ ] **Step 9: Existing tests — the marker in slot 6 and the two new UI fields**

Every new farm now holds the marker in slot 6, and `UiState` has two more fields. Nothing else in these files changes.

- `tests/sections.test.ts`, in the `expected` sections of `describe('createDefaultSections')` (~line 166): directly after the line `      zones: { A: null, B: null, C: null, D: null, E: null, F: null, G: null, H: null },` (and after the `unlocks` line Task 4 put there) add `      pendingMarker: false,`.
- `tests/persistence.test.ts`:
  - In `describe('ACTION_KINDS')` (~line 531), replace
    ```ts
          scythe: true,
          plant: true,
    ```
    with
    ```ts
          scythe: true,
          zoneMarker: true,
          plant: true,
    ```
  - ~line 104: replace `  return { ...state, ui: { panel: { kind: 'shop' }, paused: true, timeScale: 4 } };` with `  return { ...state, ui: { ...state.ui, panel: { kind: 'shop' }, paused: true, timeScale: 4 } };`
  - In `stocked()` (~line 565), replace
    ```ts
        const hotbar = [stack('hoe', 1), stack('parsnip', 7), null, stack('stone', 40), stack('wood', INVENTORY.maxStack)];
    ```
    with
    ```ts
        // The zone marker sits in the first free slot, where the version 6 migration puts it back.
        const hotbar = [stack('hoe', 1), stack('parsnip', 7), stack('zoneMarker', 1), stack('stone', 40), stack('wood', INVENTORY.maxStack)];
    ```
  - ~lines 590–591: replace
    ```ts
        expect((migrateSave(old) as SaveJson).ui).toEqual({ panel: { kind: 'none' }, paused: false, timeScale: 8 });
        expect(must(deserializeGame(JSON.stringify(old))).ui).toEqual({ panel: { kind: 'none' }, paused: false, timeScale: 8 });
    ```
    with
    ```ts
        expect((migrateSave(old) as SaveJson).ui).toEqual({ panel: { kind: 'none' }, paused: false, timeScale: 8, zoneDraft: null, zoneLetter: 'A' });
        expect(must(deserializeGame(JSON.stringify(old))).ui).toEqual({ panel: { kind: 'none' }, paused: false, timeScale: 8, zoneDraft: null, zoneLetter: 'A' });
    ```
  - ~line 598: replace
    ```ts
          expect((migrateSave(save) as SaveJson).ui, JSON.stringify(ui)).toEqual({ panel: { kind: 'none' }, paused: false, timeScale: 1 });
    ```
    with
    ```ts
          expect((migrateSave(save) as SaveJson).ui, JSON.stringify(ui)).toEqual({ panel: { kind: 'none' }, paused: false, timeScale: 1, zoneDraft: null, zoneLetter: 'A' });
    ```
  - In "version %i: carries the rest of the save over and adds the new sections" (~line 777), replace
    ```ts
          slots: Array.from({ length: INVENTORY.slotCount }, (_, i) => {
            const held = save.inventory.slots[i];
            return held === undefined || held === null ? null : { ...held, quality: 0 };
          }),
    ```
    with
    ```ts
          slots: Array.from({ length: INVENTORY.slotCount }, (_, i) => {
            const held = save.inventory.slots[i];
            // Version 6 hands out the zone marker in the first free slot: slot 6 in both fixtures.
            if (i === 6) return { itemId: 'zoneMarker', quantity: 1, quality: 0 };
            return held === undefined || held === null ? null : { ...held, quality: 0 };
          }),
    ```
    and, in the same test, `    expect(loaded.ui).toEqual({ panel: { kind: 'none' }, paused: false, timeScale: 2 });` with `    expect(loaded.ui).toEqual({ panel: { kind: 'none' }, paused: false, timeScale: 2, zoneDraft: null, zoneLetter: 'A' });`
  - In `everything()` (~line 936): replace `    ui: { panel: { kind: 'inventory' }, paused: true, timeScale: 16 },` with `    ui: { ...state.ui, panel: { kind: 'inventory' }, paused: true, timeScale: 16 },`
- `tests/reducer.test.ts`:
  - "chops a 3-hp stump …" (~line 243): replace
    ```ts
        // Wood lands in the first empty slot.
        expect(state.inventory.slots[6]).toEqual(stack('wood', TOOLS.woodFromStump));
    ```
    with
    ```ts
        // Wood lands in the first empty slot (the zone marker holds slot 6).
        expect(state.inventory.slots[7]).toEqual(stack('wood', TOOLS.woodFromStump));
    ```
  - "puts a new seed type in the first empty slot" (~line 863): replace `    expect(next.inventory.slots[6]).toEqual(stack('potato_seeds', 2));` with `    expect(next.inventory.slots[7]).toEqual(stack('potato_seeds', 2));`
  - "replaces the state, closes menus …" (~lines 945 and 952): replace `      ui: { panel: { kind: 'inventory' }, paused: true, timeScale: 4 },` with `      ui: { ...createInitialState(7).ui, panel: { kind: 'inventory' }, paused: true, timeScale: 4 },` and `      ui: { panel: { kind: 'none' }, paused: false, timeScale: 4 },` with `      ui: { ...loaded.ui, panel: { kind: 'none' }, paused: false, timeScale: 4 },`
  - "starts a fresh game at the spawn with the starter kit" (~lines 1025 and 1027): replace `    expect(state.inventory.slots.filter((slot) => slot !== null)).toEqual(INVENTORY.starting);` with `    expect(state.inventory.slots.filter((slot) => slot !== null)).toEqual([...INVENTORY.starting, stack('zoneMarker', 1)]);` and `    expect(state.ui).toEqual({ panel: { kind: 'none' }, paused: false, timeScale: 1 });` with `    expect(state.ui).toEqual({ panel: { kind: 'none' }, paused: false, timeScale: 1, zoneDraft: null, zoneLetter: 'A' });`
- `tests/inventoryMove.test.ts`, "game/load resets the panel and pause" (~lines 619–621): replace
  ```ts
      const loaded = deepFreeze({ ...atChest([]), ui: { panel: { kind: 'chest' as const, mapId: 'farm' as const, tx: 5, tz: 10 }, paused: true, timeScale: 2 } });
      const next = gameReducer(BASE, actions.load(loaded));
      expect(next.ui).toEqual({ panel: { kind: 'none' }, paused: false, timeScale: 2 });
  ```
  with
  ```ts
      const loaded = deepFreeze({ ...atChest([]), ui: { ...BASE.ui, panel: { kind: 'chest' as const, mapId: 'farm' as const, tx: 5, tz: 10 }, paused: true, timeScale: 2 } });
      const next = gameReducer(BASE, actions.load(loaded));
      expect(next.ui).toEqual({ ...BASE.ui, panel: { kind: 'none' }, paused: false, timeScale: 2 });
  ```

If a test that Tasks 1–8 added assumes slot 6 is the first free slot of a new farm (the first item added to `BASE`, or `holding(BASE, …)` of an item the kit doesn't hold), it now gets slot 7: move its expectation to 7. `tests/intents.test.ts`'s property test already draws the marker from `TOOL_TYPES`: run it; if its `fertilize` count falls to 3 or below (the new tool reshuffles the `mulberry32(0xa11ce)` stream), change only the seed.

- [ ] **Step 10: Run the new tests and the touched suites**

Run: `npx vitest run tests/zoneMarker.test.ts tests/robotSaveV6.test.ts tests/panelKeys.test.ts tests/robotPeek.test.ts tests/persistence.test.ts tests/reducer.test.ts tests/inventoryMove.test.ts tests/sections.test.ts tests/intents.test.ts`
Expected: PASS (`tests/zoneMarker.test.ts`: 25 tests; the new `robotSaveV6` describe: 16; `tests/panelKeys.test.ts`: 12).

- [ ] **Step 11: The full gate**

Run: `npm run typecheck && npm test && npm run build`
Expected: all green.

- [ ] **Step 12: Look at it**

Run `npm run dev`, open `http://localhost:5173/?new`, press 7 (the marker), face South from the spawn and press Space on two tiles a few steps apart.
Expected: the chip above the hotbar reads "Zone A · not set", then "Zone A · not set · corner set" with a pale outline following the highlighted tile, then the toast "Zone A · 3×2." (or the size you marked), a red outline round the zone and a floating "A" over its north-west tile. Holding Space never marks a second corner. Shift + Space shows "Zone B · not set"; Shift + E on Zone A (after Shift + Space back round to A) shows the hint "Shift + E Clear Zone A" and clears it. Switching to the hoe hides the overlay and the chip. No console errors. (The full check is the playbook's step 6 in Task 15.)

- [ ] **Step 13: Commit**

```bash
git add src/core/types.ts src/config.ts src/items/items.ts src/render/playerModel.ts src/render/PlayerRenderer.ts src/render/EffectsRenderer.ts src/ui/icons.ts src/robots/zones.ts src/state/zoneMarker.ts src/state/selectors.ts src/state/initialState.ts src/state/persistence.ts src/state/robotValidation.ts src/state/intents.ts src/state/actions.ts src/state/reducer.ts src/robots/overnight.ts src/input/panelKeys.ts src/input/InputController.ts src/ui/zoneChip.ts src/ui/Hud.ts src/ui/hud.css src/render/ZoneRenderer.ts src/main.ts tests/testUtils.ts tests/zoneMarker.test.ts tests/robotSaveV6.test.ts tests/panelKeys.test.ts tests/sections.test.ts tests/persistence.test.ts tests/reducer.test.ts tests/inventoryMove.test.ts
git commit -m "Farmclaws part 3: the zone marker paints zones A to H, with a HUD chip and a zone overlay

Every new farm and every migrated save gets the marker in its first free
slot; a full backpack owes it until the first morning with room. A draft
drops on Escape, a slot change, a map change, any panel and a load.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Translation

**Files:**
- Modify: `src/config.ts` (adds `ROBOT_SCREEN`; the contract had it in Task 11, but this task needs `stackGap` first)
- Create: `src/ui/robotScreen/translate.ts`
- Test: `tests/translate.test.ts`

**Interfaces:**
- Consumes:
  - Task 4: `src/robots/blockKinds.ts`: `BLOCK_KINDS` (as const, in the contract's canonical order), `type BlockKind`.
  - Part 2 (`src/core/types.ts`): `BlockProgram`, `TriggerStack`, `HelperDef`, `VarDecl`, `Statement`, `ActionBlock`, `Expr`, `Trigger`, `ItemId`, `CROP_IDS`, `ZONE_IDS`, `VALUE_TYPES`, `EVERY_CHOICES`.
  - `src/items/items.ts`: `isItemId(value: unknown): value is ItemId`; `ITEMS` (tests only).
  - `src/robots/blocks.ts`: `b` (tests only). `src/robots/check.ts`: `checkProgram` (tests only). `src/robots/program.ts`: `blockCount` (tests only).
  - `tests/programGen.ts`: `randomProgram(rng: Rng): BlockProgram` (a program `checkProgram` accepts for `SAFETY_BODY`), `SAFETY_BODY` (a Big robot with claw, watering head and sensor eye). `src/core/hash.ts`: `mulberry32(seed)`. `tests/testUtils.ts`: `must`, `Violations` (`equal`, `head`), `HEAVY_TEST_TIMEOUT_MS`.
- Produces:
  - `src/config.ts`: `export const ROBOT_SCREEN = { phoneMaxWidth: 700, stackGap: 40, timeStep: 10 } as const`. **Task 11 consumes it and doesn't add it again.**
  - `src/ui/robotScreen/translate.ts` (pure; imports nothing from `blockly`):
    - `export interface BlocklyInputJson { readonly block?: BlocklyBlockJson; readonly shadow?: BlocklyBlockJson }` (named here for the contract's inline input shape);
    - `export interface BlocklyBlockJson { readonly type: string; readonly id: string; readonly x?: number; readonly y?: number; readonly fields?: Readonly<Record<string, string | number>>; readonly inputs?: Readonly<Record<string, BlocklyInputJson>>; readonly next?: BlocklyInputJson; readonly extraState?: unknown }`;
    - `export interface BlocklyWorkspaceJson { readonly blocks?: { readonly languageVersion?: number; readonly blocks?: readonly BlocklyBlockJson[] }; readonly variables?: readonly unknown[] }`;
    - `export type TranslationResult = { readonly program: BlockProgram; readonly loose: readonly string[] } | { readonly error: string; readonly blockId: string | null }`;
    - `export function programToWorkspace(program: BlockProgram): BlocklyWorkspaceJson`;
    - `export function workspaceToProgram(json: BlocklyWorkspaceJson): TranslationResult` (never throws);
    - `export function countWorkspaceBlocks(json: BlocklyWorkspaceJson): number` (never throws);
    - `export const BLOCK_TYPES: readonly string[]` (55 types, `BLOCK_KINDS` order);
    - `export function blockTypeFor(kind: BlockKind): readonly string[]` (`if` → `['fc_if', 'fc_ifElse']`, `var` → `['fc_var', 'fc_varDecl']`, else `['fc_' + kind]`, so `helper` → `['fc_helper']`).
  - Block JSON that Task 12's block definitions must match (spec §5's table; `NAME / VAR` resolved as below):

    | Block types | Fields (saved value) | Inputs |
    | --- | --- | --- |
    | `fc_morning`, `fc_bagFull`, `fc_startsRaining` | | statement `DO` |
    | `fc_atTime` | `MINUTE` (dropdown, decimal string, e.g. `'583'`) | statement `DO` |
    | `fc_every` | `MINUTES` (dropdown, decimal string, one of `EVERY_CHOICES`) | statement `DO` |
    | `fc_helper` | `NAME` (text) | statement `DO` |
    | `fc_varDecl` | `NAME` (text), `TYPE` (dropdown, a `ValueType`) | value `INITIAL` |
    | `fc_move`, `fc_water`, `fc_harvest`, `fc_till`, `fc_refill`, `fc_deposit`, `fc_powerDown` | | |
    | `fc_turn` | `SIDE` (`'left'` / `'right'`) | |
    | `fc_plant` | `CROP` (a `CropId`) | |
    | `fc_take` / `fc_say` / `fc_wait` | | value `ITEM` / `TEXT` / `MINUTES` |
    | `fc_if` | | value `COND`, statement `THEN` |
    | `fc_ifElse` | | value `COND`, statements `THEN`, `ELSE` |
    | `fc_repeatTimes` / `fc_repeatUntil` | | value `TIMES` / `UNTIL`, statement `DO` |
    | `fc_repeatForever` | | statement `DO` |
    | `fc_forEachTile` | `ZONE` (a `ZoneId`) | statement `DO` |
    | `fc_goTo` | | value `TILE` |
    | `fc_set` / `fc_change` | `VAR` (text) | value `VALUE` / `BY` |
    | `fc_runHelper` | `NAME` (text) | |
    | `fc_num` | `NUM` (number field) | |
    | `fc_text` | `TEXT` (text) | |
    | `fc_yes` | `VALUE` (`'TRUE'` / `'FALSE'`) | |
    | `fc_item`, `fc_countInBag`, `fc_bagHas` | `ITEM` (an `ItemId`) | |
    | `fc_tile` | `X`, `Z` (number fields) | |
    | `fc_var` | `VAR` (text) | |
    | `fc_myTile`, `fc_tileAhead`, `fc_tokensLeft`, `fc_cropIsReady`, `fc_soilIsDry`, `fc_tileIsTilled`, `fc_bagIsFull`, `fc_itIsRaining` | | |
    | `fc_arith` | `OP` (`'+'`, `'-'`, `'×'`) | values `A`, `B` |
    | `fc_compare` | `OP` (`'='`, `'≠'`, `'<'`, `'>'`) | values `A`, `B` |
    | `fc_and`, `fc_or` | | values `A`, `B` |
    | `fc_not` | | value `A` |
    | `fc_cropIs` | `CROP` | |
    | `fc_atEdgeOf` | `ZONE` | |
    | `fc_tokensBelow` | | value `N` |
    | `fc_tileAheadIs` | `WHAT` (`'water'`, `'blocked'`, `'clear'`) | |
    | `fc_timeIsAfter` | `MINUTE` (dropdown, decimal string) | |

    Triggers, `fc_helper` and `fc_varDecl` have no previous or next connection; a block chained under one is reported as loose.

Rulings this task makes (recorded in the commit message):
- **Field values** are what Blockly saves: dropdowns are strings (so the times `MINUTE` and `MINUTES` are decimal strings, and `fc_yes.VALUE` is `'TRUE'` / `'FALSE'`), number fields are numbers. The reader also takes a number saved as its own decimal text, and a time saved as a number. A field of the wrong kind, an id the language doesn't have (an item, crop, zone, type, side, operator or `Every` choice) and a non-finite number are all "This block is missing a setting.".
- **Layout:** a pure translator can't know rendered heights, so `programToWorkspace` puts each top-level block at x 0, y = its index × `ROBOT_SCREEN.stackGap`, which fixes the order. Task 12 re-spaces them by rendered height after loading, `stackGap` apart.
- **Ids** are `b1`, `b2`, … in depth-first order: a block, then its inputs in order (value inputs before statement inputs, as listed above), then the block chained after it.
- **Empty statement inputs** are left out (as Blockly saves them); reading, an absent statement input is an empty list. Only an empty **value** slot is "Fill every empty slot.".
- **Not workspace JSON:** a malformed workspace (not an object, `blocks.blocks` not an array, a hole or a non-object in it), a block without a string `type` or `id`, a block met twice (a cycle or a node shared by two parents), a statement block in a value slot or the other way round, and nesting too deep to read are all "This block isn't part of the robot language.", naming the block when it has an id, else `blockId: null`. The spec names only three messages, so these reuse the unknown-block one.
- **Loose blocks** keep their own slots unread: they are reported, not translated, so a loose block with an empty slot is loose, not "Fill every empty slot.".
- **Counting** walks the JSON iteratively (any depth, each block object once): `fc_num`, `fc_text`, `fc_yes`, `fc_item`, `fc_tile` and `fc_varDecl` count 0, every other object with a string `type` counts 1, a shadow counts only when its slot holds no block.

- [ ] **Step 1: Write the failing test `tests/translate.test.ts`**

The "never imports Blockly" check reads the module's source with Vite's `?raw` import, as `tests/persistence.test.ts` does for its fixtures: `tests/` is typechecked with `types: ["vite/client"]` only, so `node:fs` has no types here.

```ts
/**
 * The workspace translator (farmclaws part 3 spec §5): every block type round-trips, so do the
 * design's job programs and 300 generated ones, with countWorkspaceBlocks matching blockCount.
 * Values outside the editor's menus survive, shadows read as blocks, loose blocks are reported,
 * every malformed workspace becomes { error, blockId } without throwing, and the module never
 * imports Blockly.
 */
import { describe, expect, it } from 'vitest';
import { ROBOT_SCREEN, ROBOTS } from '../src/config';
import { mulberry32 } from '../src/core/hash';
import { CROP_IDS, EVERY_CHOICES, ZONE_IDS, type BlockProgram, type Expr, type Statement } from '../src/core/types';
import { ITEMS } from '../src/items/items';
import { BLOCK_KINDS } from '../src/robots/blockKinds';
import { b } from '../src/robots/blocks';
import { checkProgram } from '../src/robots/check';
import { blockCount } from '../src/robots/program';
import {
  BLOCK_TYPES,
  blockTypeFor,
  countWorkspaceBlocks,
  programToWorkspace,
  workspaceToProgram,
  type BlocklyBlockJson,
  type BlocklyInputJson,
  type BlocklyWorkspaceJson,
} from '../src/ui/robotScreen/translate';
import translateSource from '../src/ui/robotScreen/translate.ts?raw';
import { SAFETY_BODY, randomProgram } from './programGen';
import { HEAVY_TEST_TIMEOUT_MS, Violations, must } from './testUtils';

const FILL = 'Fill every empty slot.';
const NOT_A_BLOCK = "This block isn't part of the robot language.";
const MISSING = 'This block is missing a setting.';
const GENERATED = 300;
/** Nesting far deeper than any recursive reader can follow. */
const DEEP = 200_000;

const on = (...body: Statement[]): BlockProgram => b.program({ stacks: [b.when(b.morning(), ...body)] });
const sensing = (cond: Expr): BlockProgram => on(b.if(cond, [b.move()]));

/** The program is one the checker accepts (on a Big robot with every part), and survives the trip both ways. */
function expectRoundTrip(program: BlockProgram): void {
  expect(checkProgram(program, SAFETY_BODY)).toBeNull();
  const json = programToWorkspace(program);
  expect(workspaceToProgram(json)).toStrictEqual({ program, loose: [] });
  expect(countWorkspaceBlocks(json)).toBe(blockCount(program));
}

/** Every block of a workspace, depth first: a block, its inputs in order (block, else shadow), then its next. */
function allBlocks(json: BlocklyWorkspaceJson): BlocklyBlockJson[] {
  const out: BlocklyBlockJson[] = [];
  const visit = (block: BlocklyBlockJson | undefined): void => {
    if (block === undefined) return;
    out.push(block);
    for (const input of Object.values(block.inputs ?? {})) visit(input.block ?? input.shadow);
    visit(block.next?.block ?? block.next?.shadow);
  };
  for (const block of json.blocks?.blocks ?? []) visit(block);
  return out;
}

const ids = (count: number): string[] => Array.from({ length: count }, (_, i) => `b${i + 1}`);

/** The same block with everything below it (inputs and next) moved from `block` to `shadow`. */
function shadowed(block: BlocklyBlockJson): BlocklyBlockJson {
  const below = (slot: BlocklyInputJson): BlocklyInputJson => ({ shadow: shadowed(must(slot.block)) });
  return {
    ...block,
    ...(block.inputs === undefined ? {} : { inputs: Object.fromEntries(Object.entries(block.inputs).map(([name, slot]) => [name, below(slot)])) }),
    ...(block.next === undefined ? {} : { next: below(block.next) }),
  };
}

const ws = (...blocks: BlocklyBlockJson[]): BlocklyWorkspaceJson => ({ blocks: { languageVersion: 0, blocks } });
const block = (type: string, id: string, rest: Omit<BlocklyBlockJson, 'type' | 'id'> = {}): BlocklyBlockJson => ({ type, id, ...rest });
const slot = (child: BlocklyBlockJson): BlocklyInputJson => ({ block: child });
const morning = (body: BlocklyBlockJson): BlocklyBlockJson => block('fc_morning', 'm', { inputs: { DO: slot(body) } });
const num = (id: string, value: number): BlocklyBlockJson => block('fc_num', id, { fields: { NUM: value } });
/** Input that isn't workspace JSON at all, as the screen might be handed it. */
const garbage = (value: unknown): BlocklyWorkspaceJson => value as BlocklyWorkspaceJson;

/** One small program per block type, each using that block. */
const ONE_OF_EACH: Readonly<Record<string, BlockProgram>> = {
  fc_morning: on(b.move()),
  fc_atTime: b.program({ stacks: [b.when(b.atTime(600), b.move())] }),
  fc_bagFull: b.program({ stacks: [b.when(b.bagFull(), b.deposit())] }),
  fc_startsRaining: b.program({ stacks: [b.when(b.startsRaining(), b.powerDown())] }),
  fc_every: b.program({ stacks: [b.when(b.every(15), b.turn('left'))] }),
  fc_repeatTimes: on(b.repeat(3, b.move())),
  fc_repeatUntil: on(b.repeatUntil(b.bagIsFull(), b.harvest())),
  fc_repeatForever: on(b.forever(b.turn('right'))),
  fc_if: on(b.if(b.cropIsReady(), [b.harvest()])),
  fc_ifElse: on(b.if(b.soilIsDry(), [b.water()], [b.move()])),
  fc_forEachTile: on(b.forEach('A', b.water())),
  fc_set: b.program({ vars: [b.tileVar('home', 9, 12)], stacks: [b.when(b.morning(), b.set('home', b.myTile()))] }),
  fc_change: b.program({ vars: [b.numVar('n', 0)], stacks: [b.when(b.morning(), b.change('n', b.tokensLeft()))] }),
  fc_var: b.program({ vars: [b.numVar('n', 2)], stacks: [b.when(b.morning(), b.repeat(b.v('n'), b.move()))] }),
  fc_varDecl: b.program({ vars: [b.textVar('note', '')], stacks: [b.when(b.morning(), b.say(b.v('note')))] }),
  fc_helper: b.program({ stacks: [b.when(b.morning(), b.move())], helpers: [b.helper('spin', b.turn('right'))] }),
  fc_runHelper: b.program({ stacks: [b.when(b.morning(), b.run('spin'))], helpers: [b.helper('spin', b.turn('left'))] }),
  fc_move: on(b.move()),
  fc_turn: on(b.turn('left'), b.turn('right')),
  fc_goTo: on(b.goTo(b.tileAt(9, 12))),
  fc_water: on(b.water()),
  fc_refill: on(b.refill()),
  fc_harvest: on(b.harvest()),
  fc_deposit: on(b.deposit()),
  fc_take: on(b.take('wood')),
  fc_till: on(b.till()),
  fc_plant: on(b.plant('parsnip')),
  fc_powerDown: on(b.powerDown()),
  fc_wait: on(b.wait(30)),
  fc_say: on(b.say('Beep')),
  fc_cropIsReady: sensing(b.cropIsReady()),
  fc_soilIsDry: sensing(b.soilIsDry()),
  fc_tileIsTilled: sensing(b.tileIsTilled()),
  fc_cropIs: sensing(b.cropIs('pumpkin')),
  fc_bagIsFull: sensing(b.bagIsFull()),
  fc_bagHas: sensing(b.bagHas('parsnip_seeds')),
  fc_atEdgeOf: sensing(b.atEdgeOf('H')),
  fc_tokensBelow: sensing(b.tokensBelow(10)),
  fc_tileAheadIs: sensing(b.tileAheadIs('water')),
  fc_itIsRaining: sensing(b.itIsRaining()),
  fc_timeIsAfter: sensing(b.timeIsAfter(1080)),
  fc_num: on(b.wait(5)),
  fc_text: on(b.say('Hello')),
  fc_yes: b.program({ vars: [b.yesVar('done', false)], stacks: [b.when(b.morning(), b.set('done', b.yes(true)))] }),
  fc_item: on(b.take(b.item('potato'))),
  fc_tile: on(b.goTo(b.tileAt(0, 0))),
  fc_myTile: on(b.if(b.eq(b.myTile(), b.tileAt(9, 12)), [b.move()])),
  fc_tileAhead: on(b.goTo(b.tileAhead())),
  fc_tokensLeft: on(b.wait(b.tokensLeft())),
  fc_countInBag: on(b.wait(b.countInBag('potato'))),
  fc_arith: on(b.wait(b.add(1, b.mul(b.sub(9, 4), 2)))),
  fc_compare: on(b.if(b.and(b.lt(b.tokensLeft(), 10), b.gt(3, 2)), [b.if(b.ne(b.text('a'), b.text('b')), [b.powerDown()])])),
  fc_and: sensing(b.and(b.cropIsReady(), b.soilIsDry())),
  fc_or: sensing(b.or(b.itIsRaining(), b.bagIsFull())),
  fc_not: sensing(b.not(b.bagIsFull())),
};

/** The design's job programs (design §5.2's blocks as §8's jobs use them), built with the block builder. */
const DESIGN_PROGRAMS: Readonly<Record<string, BlockProgram>> = {
  'job 1, the spinner: When morning → Repeat forever → Turn right': b.program({ stacks: [b.when(b.morning(), b.forever(b.turn('right')))] }),
  'job 1, rewritten: water a 3×3 bed, then power down': b.program({
    stacks: [b.when(b.morning(), b.forEach('A', b.if(b.soilIsDry(), [b.water()])), b.powerDown())],
  }),
  'job 1, with a stop condition: Repeat until tokens left < 10': b.program({
    stacks: [b.when(b.morning(), b.repeatUntil(b.lt(b.tokensLeft(), 10), b.water(), b.move()), b.powerDown())],
  }),
  'job 2, Cosmo\'s robot: Repeat forever → Say "hello chickens"': b.program({ stacks: [b.when(b.morning(), b.forever(b.say('hello chickens')))] }),
  'job 2, rewritten: harvest the field with a sensor and an If': b.program({
    stacks: [
      b.when(
        b.morning(),
        b.forEach('B', b.if(b.cropIsReady(), [b.harvest()], [b.if(b.bagIsFull(), [b.goTo(b.tileAt(9, 6)), b.deposit()])])),
        b.powerDown(),
      ),
    ],
  }),
  'job 3, Barnaby\'s robot: polling Every 10 minutes': b.program({ stacks: [b.when(b.every(10), b.if(b.cropIsReady(), [b.harvest()]), b.move())] }),
  'job 3, split: a morning sweep, a full bag and rain': b.program({
    stacks: [
      b.when(b.morning(), b.forEach('C', b.if(b.and(b.cropIsReady(), b.not(b.bagIsFull())), [b.harvest()])), b.powerDown()),
      b.when(b.bagFull(), b.goTo(b.tileAt(9, 6)), b.deposit()),
      b.when(b.startsRaining(), b.powerDown()),
    ],
  }),
  'job 4: helpers and variables': b.program({
    vars: [b.numVar('rows', 3), b.tileVar('home', 9, 12), b.yesVar('done', false), b.itemVar('seed', 'parsnip_seeds'), b.textVar('note', 'Row done')],
    stacks: [
      b.when(
        b.morning(),
        b.set('home', b.myTile()),
        b.repeat(b.v('rows'), b.run('row'), b.change('rows', -1)),
        b.set('done', b.yes(true)),
        b.if(b.not(b.bagHas('parsnip_seeds')), [b.take(b.v('seed'))]),
        b.goTo(b.v('home')),
      ),
      b.when(b.atTime(18 * 60), b.if(b.v('done'), [b.powerDown()], [b.say(b.v('note'))])),
    ],
    helpers: [
      b.helper('row', b.repeat(5, b.if(b.tileIsTilled(), [b.plant('parsnip')], [b.till()]), b.move()), b.run('turnAround')),
      b.helper('turnAround', b.turn('right'), b.turn('right')),
    ],
  }),
  'sensor eye: rain, the clock and the tile ahead': b.program({
    stacks: [
      b.when(
        b.every(30),
        b.if(b.or(b.itIsRaining(), b.timeIsAfter(20 * 60)), [b.powerDown()], [b.if(b.tileAheadIs('blocked'), [b.turn('right')], [b.move()])]),
      ),
    ],
  }),
  'values: bag counts, items, tiles and arithmetic': b.program({
    vars: [b.numVar('trips', 0)],
    stacks: [
      b.when(
        b.morning(),
        b.if(b.gt(b.countInBag('parsnip'), b.mul(b.add(b.v('trips'), 1), 2)), [b.change('trips', 1), b.goTo(b.tileAhead())]),
        b.if(b.eq(b.item('wood'), b.item('wood')), [b.wait(b.sub(30, b.v('trips')))]),
        b.if(b.ne(b.myTile(), b.tileAt(9, 12)), [b.goTo(b.tileAt(9, 12))]),
        b.if(b.tokensBelow(20), [b.powerDown()]),
        b.if(b.atEdgeOf('D'), [b.turn('left')]),
        b.if(b.cropIs('pumpkin'), [b.harvest()]),
      ),
    ],
  }),
};

describe('block types', () => {
  it('names every block kind, with no type twice', () => {
    expect(BLOCK_TYPES).toHaveLength(55);
    expect(new Set(BLOCK_TYPES).size).toBe(BLOCK_TYPES.length);
    for (const kind of BLOCK_KINDS) for (const type of blockTypeFor(kind)) expect(BLOCK_TYPES).toContain(type);
    expect([...BLOCK_TYPES].sort()).toEqual(BLOCK_KINDS.flatMap((kind) => [...blockTypeFor(kind)]).sort());
    expect(blockTypeFor('if')).toEqual(['fc_if', 'fc_ifElse']);
    expect(blockTypeFor('var')).toEqual(['fc_var', 'fc_varDecl']);
    expect(blockTypeFor('helper')).toEqual(['fc_helper']);
    expect(blockTypeFor('goTo')).toEqual(['fc_goTo']);
  });

  it('has a round-trip program for every block type', () => {
    expect(Object.keys(ONE_OF_EACH).sort()).toEqual([...BLOCK_TYPES].sort());
  });

  it.each(Object.entries(ONE_OF_EACH))('%s round-trips', (type, program) => {
    expectRoundTrip(program);
    expect(allBlocks(programToWorkspace(program)).map((each) => each.type)).toContain(type);
  });

  it('keeps an If without else apart from an If-else with an empty else', () => {
    const noElse = on(b.if(b.cropIsReady(), [b.harvest()]));
    const emptyElse = on(b.if(b.cropIsReady(), [b.harvest()], []));
    const bothEmpty = on(b.if(b.cropIsReady(), [], []));
    const full = on(b.if(b.cropIsReady(), [b.harvest(), b.move()], [b.move(), b.turn('left')]));
    for (const program of [noElse, emptyElse, bothEmpty, full]) expectRoundTrip(program);
    const ifBlock = (program: BlockProgram): BlocklyBlockJson => must(allBlocks(programToWorkspace(program))[1]);
    expect(ifBlock(noElse).type).toBe('fc_if');
    expect(ifBlock(emptyElse).type).toBe('fc_ifElse');
    // Empty statement inputs are left out, as Blockly saves them.
    expect(Object.keys(ifBlock(emptyElse).inputs ?? {})).toEqual(['COND', 'THEN']);
    expect(Object.keys(ifBlock(bothEmpty).inputs ?? {})).toEqual(['COND']);
    expect(Object.keys(ifBlock(full).inputs ?? {})).toEqual(['COND', 'THEN', 'ELSE']);
  });
});

describe('programToWorkspace', () => {
  it('numbers blocks depth first and lays out variables, then stacks, then helpers', () => {
    const program = b.program({
      vars: [b.numVar('n', 3)],
      stacks: [b.when(b.atTime(583), b.repeat(b.v('n'), b.move()), b.say('Hi'))],
      helpers: [b.helper('spin', b.turn('left'))],
    });
    expect(programToWorkspace(program)).toStrictEqual({
      blocks: {
        languageVersion: 0,
        blocks: [
          { type: 'fc_varDecl', id: 'b1', x: 0, y: 0, fields: { NAME: 'n', TYPE: 'number' }, inputs: { INITIAL: { block: { type: 'fc_num', id: 'b2', fields: { NUM: 3 } } } } },
          {
            type: 'fc_atTime',
            id: 'b3',
            x: 0,
            y: ROBOT_SCREEN.stackGap,
            fields: { MINUTE: '583' },
            inputs: {
              DO: {
                block: {
                  type: 'fc_repeatTimes',
                  id: 'b4',
                  inputs: { TIMES: { block: { type: 'fc_var', id: 'b5', fields: { VAR: 'n' } } }, DO: { block: { type: 'fc_move', id: 'b6' } } },
                  next: { block: { type: 'fc_say', id: 'b7', inputs: { TEXT: { block: { type: 'fc_text', id: 'b8', fields: { TEXT: 'Hi' } } } } } },
                },
              },
            },
          },
          { type: 'fc_helper', id: 'b9', x: 0, y: 2 * ROBOT_SCREEN.stackGap, fields: { NAME: 'spin' }, inputs: { DO: { block: { type: 'fc_turn', id: 'b10', fields: { SIDE: 'left' } } } } },
        ],
      },
    });
    expectRoundTrip(program);
  });

  it('writes dropdowns as strings and number fields as numbers', () => {
    const json = programToWorkspace(
      b.program({
        vars: [b.yesVar('a', true), b.yesVar('c', false), b.tileVar('t', 3, 4)],
        stacks: [b.when(b.every(30), b.if(b.timeIsAfter(1200), [b.wait(-7)]))],
      }),
    );
    expect(allBlocks(json).map((each) => each.fields ?? {})).toStrictEqual([
      { NAME: 'a', TYPE: 'yesNo' },
      { VALUE: 'TRUE' },
      { NAME: 'c', TYPE: 'yesNo' },
      { VALUE: 'FALSE' },
      { NAME: 't', TYPE: 'tile' },
      { X: 3, Z: 4 },
      { MINUTES: '30' },
      {},
      { MINUTE: '1200' },
      {},
      { NUM: -7 },
    ]);
    expect(json.variables ?? []).toEqual([]);
  });
});

describe('round trips', () => {
  it.each(Object.entries(DESIGN_PROGRAMS))('%s', (_name, program) => {
    expectRoundTrip(program);
  });

  it("keeps values the editor's menus don't list: 9:43, a 16-character name, every item, crop, zone and Every choice", () => {
    const name = 'Sixteen chars ok';
    expect(Array.from(name)).toHaveLength(ROBOTS.maxIdentifierLength);
    expectRoundTrip(
      b.program({
        vars: [b.numVar(name, ROBOTS.maxNumber), b.textVar('said', 'x'.repeat(ROBOTS.maxTextLength))],
        stacks: [
          b.when(
            b.atTime(583),
            b.if(b.timeIsAfter(583), [b.change(name, -ROBOTS.maxNumber)]),
            b.say('Said "hi" — ✓ 🌱'),
            b.run(name),
            b.goTo(b.tileAt(47, 39)),
          ),
        ],
        helpers: [b.helper(name, b.move())],
      }),
    );
    for (const itemId of ITEMS.keys()) expectRoundTrip(on(b.take(itemId), b.if(b.bagHas(itemId), [b.wait(b.countInBag(itemId))])));
    for (const cropId of CROP_IDS) expectRoundTrip(on(b.plant(cropId), b.if(b.cropIs(cropId), [b.harvest()])));
    for (const zone of ZONE_IDS) expectRoundTrip(on(b.forEach(zone, b.if(b.atEdgeOf(zone), [b.turn('left')]))));
    for (const minutes of EVERY_CHOICES) expectRoundTrip(b.program({ stacks: [b.when(b.every(minutes), b.move())] }));
  });

  it(
    `round-trips ${GENERATED} generated programs, through JSON text too, with matching block counts and ids`,
    () => {
      const v = new Violations();
      const rng = mulberry32(20261003);
      let accepted = 0;
      for (let i = 0; i < GENERATED; i++) {
        const program = randomProgram(rng);
        if (checkProgram(program, SAFETY_BODY) !== null) continue;
        accepted++;
        const json = programToWorkspace(program);
        v.equal(`program ${i}`, workspaceToProgram(json), { program, loose: [] });
        v.equal(`program ${i} through JSON text`, workspaceToProgram(JSON.parse(JSON.stringify(json)) as BlocklyWorkspaceJson), { program, loose: [] });
        v.equal(`program ${i} block count`, countWorkspaceBlocks(json), blockCount(program));
        const blocks = allBlocks(json);
        v.equal(`program ${i} ids`, blocks.map((each) => each.id), ids(blocks.length));
      }
      expect(v.head()).toEqual([]);
      expect(accepted).toBeGreaterThanOrEqual(GENERATED * 0.9);
    },
    HEAVY_TEST_TIMEOUT_MS,
  );

  it('reads a number field saved as text, and times saved as numbers', () => {
    const json = ws(
      block('fc_atTime', 'at', { fields: { MINUTE: 583 }, inputs: { DO: slot(block('fc_wait', 'w', { inputs: { MINUTES: slot(block('fc_num', 'n', { fields: { NUM: '12' } })) } })) } }),
      block('fc_every', 'ev', { fields: { MINUTES: 15 } }),
    );
    expect(workspaceToProgram(json)).toStrictEqual({ program: b.program({ stacks: [b.when(b.atTime(583), b.wait(12)), b.when(b.every(15))] }), loose: [] });
  });

  it('reads an empty workspace as an empty program (the checker then asks for a stack)', () => {
    const empty = { program: b.program({ stacks: [] }), loose: [] };
    expect(workspaceToProgram({})).toStrictEqual(empty);
    expect(workspaceToProgram({ blocks: { languageVersion: 0, blocks: [] } })).toStrictEqual(empty);
    expect(countWorkspaceBlocks({})).toBe(0);
  });

  it('ignores variables[]', () => {
    const program = must(DESIGN_PROGRAMS['job 4: helpers and variables']);
    const json = { ...programToWorkspace(program), variables: [{ name: 'rows', id: 'v1', type: '' }] };
    expect(workspaceToProgram(json)).toStrictEqual({ program, loose: [] });
  });

  it('reads each kind in its order in blocks.blocks, wherever the blocks sit', () => {
    const json = ws(
      block('fc_helper', 'h2', { x: 0, y: 0, fields: { NAME: 'second' } }),
      block('fc_atTime', 's1', { x: 400, y: 10, fields: { MINUTE: '600' }, inputs: { DO: slot(block('fc_move', 'mv')) } }),
      block('fc_varDecl', 'v2', { y: 20, fields: { NAME: 'two', TYPE: 'text' }, inputs: { INITIAL: slot(block('fc_text', 't', { fields: { TEXT: 'x' } })) } }),
      block('fc_morning', 's0', { y: -500, inputs: { DO: slot(block('fc_turn', 'tl', { fields: { SIDE: 'left' } })) } }),
      block('fc_varDecl', 'v1', { fields: { NAME: 'one', TYPE: 'number' }, inputs: { INITIAL: slot(num('one', 1)) } }),
      block('fc_helper', 'h1', { fields: { NAME: 'first' } }),
    );
    expect(workspaceToProgram(json)).toStrictEqual({
      program: b.program({
        vars: [b.textVar('two', 'x'), b.numVar('one', 1)],
        stacks: [b.when(b.atTime(600), b.move()), b.when(b.morning(), b.turn('left'))],
        helpers: [b.helper('second'), b.helper('first')],
      }),
      loose: [],
    });
  });
});

describe('shadows', () => {
  it('reads an input or next that holds only a shadow as that block', () => {
    for (const program of Object.values(DESIGN_PROGRAMS)) {
      const json = ws(...(programToWorkspace(program).blocks?.blocks ?? []).map(shadowed));
      expect(workspaceToProgram(json)).toStrictEqual({ program, loose: [] });
      expect(countWorkspaceBlocks(json)).toBe(blockCount(program));
    }
  });

  it('reads the block over its shadow, and counts only the block', () => {
    const covered = ws(morning(block('fc_wait', 'w', { inputs: { MINUTES: { block: block('fc_tokensLeft', 'tl'), shadow: num('five', 5) } } })));
    expect(workspaceToProgram(covered)).toStrictEqual({ program: on(b.wait(b.tokensLeft())), loose: [] });
    expect(countWorkspaceBlocks(covered)).toBe(3);
    const bare = ws(morning(block('fc_wait', 'w', { inputs: { MINUTES: { shadow: num('five', 5) } } })));
    expect(workspaceToProgram(bare)).toStrictEqual({ program: on(b.wait(5)), loose: [] });
  });
});

describe('loose blocks', () => {
  it('reports top-level blocks outside a stack, helper or declaration, and blocks chained under one', () => {
    const json = ws(
      block('fc_move', 'stray', { x: 300, y: 0 }),
      morning(block('fc_move', 'mv')),
      block('fc_cropIsReady', 'floating'),
      block('fc_bagFull', 'bf', { next: slot(block('fc_deposit', 'tail')) }),
      // A loose block's own slots aren't read: it is reported, not translated.
      block('fc_wait', 'unfinished'),
    );
    expect(workspaceToProgram(json)).toStrictEqual({
      program: b.program({ stacks: [b.when(b.morning(), b.move()), b.when(b.bagFull())] }),
      loose: ['stray', 'floating', 'tail', 'unfinished'],
    });
    expect(countWorkspaceBlocks(json)).toBe(7);
  });
});

describe('countWorkspaceBlocks', () => {
  it('counts mid-edit: empty slots and loose blocks count, literals and declarations are free', () => {
    const json = ws(
      morning(block('fc_repeatTimes', 'r', { inputs: { DO: slot(block('fc_say', 's', { inputs: { TEXT: slot(block('fc_text', 't', { fields: { TEXT: 'hi' } })) } })) } })),
      block('fc_varDecl', 'v', { fields: { NAME: 'n', TYPE: 'number' }, inputs: { INITIAL: slot(num('zero', 0)) } }),
      block('fc_tokensLeft', 'loose'),
    );
    expect(countWorkspaceBlocks(json)).toBe(4);
    expect(workspaceToProgram(json)).toStrictEqual({ error: FILL, blockId: 'r' });
  });

  it('counts nothing under a declaration, as blockCount ignores declarations', () => {
    const json = ws(
      morning(block('fc_wait', 'w', { inputs: { MINUTES: slot(num('five', 5)) } })),
      block('fc_varDecl', 'v', { fields: { NAME: 'n', TYPE: 'number' }, inputs: { INITIAL: slot(block('fc_tokensLeft', 'inner')) } }),
    );
    expect(countWorkspaceBlocks(json)).toBe(2);
  });

  it('counts the design programs exactly as blockCount does', () => {
    for (const program of Object.values(DESIGN_PROGRAMS)) expect(countWorkspaceBlocks(programToWorkspace(program))).toBe(blockCount(program));
  });
});

const shared = block('fc_cropIsReady', 'shared');

const ERRORS: readonly (readonly [string, BlocklyWorkspaceJson, string, string | null])[] = [
  // An empty value slot names the block that owns it.
  ['a Wait with an empty slot', ws(morning(block('fc_wait', 'w'))), FILL, 'w'],
  ['an If with no condition', ws(morning(block('fc_if', 'i', { inputs: { THEN: slot(block('fc_move', 'mv')) } }))), FILL, 'i'],
  ['a variable with no starting value', ws(block('fc_varDecl', 'v', { fields: { NAME: 'n', TYPE: 'number' } })), FILL, 'v'],
  ['a + with one side empty', ws(morning(block('fc_wait', 'w', { inputs: { MINUTES: slot(block('fc_arith', 'ar', { fields: { OP: '+' }, inputs: { A: slot(num('one', 1)) } })) } }))), FILL, 'ar'],
  ['a slot holding neither block nor shadow', ws(morning(block('fc_say', 's', { inputs: { TEXT: {} } }))), FILL, 's'],
  ['an empty slot deep in a helper', ws(block('fc_helper', 'h', { fields: { NAME: 'h' }, inputs: { DO: slot(block('fc_repeatForever', 'rf', { inputs: { DO: slot(block('fc_goTo', 'g')) } })) } })), FILL, 'g'],
  ['an empty slot after the first statement', ws(morning(block('fc_move', 'mv', { next: slot(block('fc_take', 't')) }))), FILL, 't'],
  // A block that isn't in the language, or not in that place, is named.
  ['an unknown block on top', ws(block('fc_teleport', 'tp')), NOT_A_BLOCK, 'tp'],
  ["a stock Blockly block in a stack", ws(morning(block('controls_if', 'ci'))), NOT_A_BLOCK, 'ci'],
  ['an action in a value slot', ws(morning(block('fc_wait', 'w', { inputs: { MINUTES: slot(block('fc_move', 'mv')) } }))), NOT_A_BLOCK, 'mv'],
  ['a sensor in a statement slot', ws(morning(block('fc_cropIsReady', 'cr'))), NOT_A_BLOCK, 'cr'],
  ['a trigger inside a stack', ws(morning(block('fc_bagFull', 'bf'))), NOT_A_BLOCK, 'bf'],
  ['a helper definition inside a stack', ws(morning(block('fc_helper', 'hd', { fields: { NAME: 'x' } }))), NOT_A_BLOCK, 'hd'],
  ['a declaration in a value slot', ws(morning(block('fc_wait', 'w', { inputs: { MINUTES: slot(block('fc_varDecl', 'vd', { fields: { NAME: 'n', TYPE: 'number' } })) } }))), NOT_A_BLOCK, 'vd'],
  ['the same block in two slots', ws(morning(block('fc_if', 'i', { inputs: { COND: slot(block('fc_and', 'and', { inputs: { A: slot(shared), B: slot(shared) } })) } }))), NOT_A_BLOCK, 'shared'],
  // A missing or ill-typed field names its block.
  ['a Turn with no side', ws(morning(block('fc_turn', 't'))), MISSING, 't'],
  ['a Turn up', ws(morning(block('fc_turn', 't', { fields: { SIDE: 'up' } }))), MISSING, 't'],
  ['a time that is not a number', ws(block('fc_atTime', 'at', { fields: { MINUTE: 'noon' } })), MISSING, 'at'],
  ['a time with a leading zero', ws(block('fc_atTime', 'at', { fields: { MINUTE: '0583' } })), MISSING, 'at'],
  ['Every 7 minutes', ws(block('fc_every', 'ev', { fields: { MINUTES: '7' } })), MISSING, 'ev'],
  ['a yes-or-no of MAYBE', ws(morning(block('fc_set', 's', { fields: { VAR: 'done' }, inputs: { VALUE: slot(block('fc_yes', 'y', { fields: { VALUE: 'MAYBE' } })) } }))), MISSING, 'y'],
  ['an item that does not exist', ws(morning(block('fc_take', 't', { inputs: { ITEM: slot(block('fc_item', 'it', { fields: { ITEM: 'unobtainium' } })) } }))), MISSING, 'it'],
  ['a crop that does not exist', ws(morning(block('fc_plant', 'p', { fields: { CROP: 'kale' } }))), MISSING, 'p'],
  ['zone I', ws(morning(block('fc_forEachTile', 'fe', { fields: { ZONE: 'I' } }))), MISSING, 'fe'],
  ['a variable of type colour', ws(block('fc_varDecl', 'v', { fields: { NAME: 'c', TYPE: 'colour' }, inputs: { INITIAL: slot(num('one', 1)) } })), MISSING, 'v'],
  ['a number field holding words', ws(morning(block('fc_wait', 'w', { inputs: { MINUTES: slot(block('fc_num', 'n', { fields: { NUM: 'lots' } })) } }))), MISSING, 'n'],
  ['a number field holding NaN', ws(morning(block('fc_wait', 'w', { inputs: { MINUTES: slot(num('n', Number.NaN)) } }))), MISSING, 'n'],
  ['a text field holding a number', ws(morning(block('fc_say', 's', { inputs: { TEXT: slot(block('fc_text', 'tx', { fields: { TEXT: 5 } })) } }))), MISSING, 'tx'],
  ['a tile with no Z', ws(morning(block('fc_goTo', 'g', { inputs: { TILE: slot(block('fc_tile', 'tl', { fields: { X: 3 } })) } }))), MISSING, 'tl'],
  ['an operator ÷', ws(morning(block('fc_wait', 'w', { inputs: { MINUTES: slot(block('fc_arith', 'ar', { fields: { OP: '÷' }, inputs: { A: slot(num('a', 6)), B: slot(num('b', 2)) } })) } }))), MISSING, 'ar'],
  ['a helper with no name', ws(block('fc_helper', 'h')), MISSING, 'h'],
  ['a variable getter with no variable', ws(morning(block('fc_wait', 'w', { inputs: { MINUTES: slot(block('fc_var', 'vr')) } }))), MISSING, 'vr'],
  ['fields that are a string', garbage({ blocks: { blocks: [morning(block('fc_turn', 't', { fields: 'left' as never }))] } }), MISSING, 't'],
  // Input that isn't workspace JSON at all.
  ['null', garbage(null), NOT_A_BLOCK, null],
  ['a number', garbage(42), NOT_A_BLOCK, null],
  ['an array', garbage([]), NOT_A_BLOCK, null],
  ['blocks: null', garbage({ blocks: null }), NOT_A_BLOCK, null],
  ['a null blocks array', garbage({ blocks: { blocks: null } }), NOT_A_BLOCK, null],
  ['a blocks array that is an object', garbage({ blocks: { blocks: { 0: morning(block('fc_move', 'mv')) } } }), NOT_A_BLOCK, null],
  ['a null block', garbage({ blocks: { blocks: [null] } }), NOT_A_BLOCK, null],
  ['a hole in the block list', garbage({ blocks: { blocks: new Array(1) } }), NOT_A_BLOCK, null],
  ['a block with no type', garbage({ blocks: { blocks: [{ id: 'x' }] } }), NOT_A_BLOCK, 'x'],
  ['a block whose type is a number', garbage({ blocks: { blocks: [{ type: 7, id: 'seven' }] } }), NOT_A_BLOCK, 'seven'],
  ['a block with no id', garbage({ blocks: { blocks: [{ type: 'fc_morning' }] } }), NOT_A_BLOCK, null],
  ['a string where a block should be', garbage({ blocks: { blocks: [{ type: 'fc_morning', id: 'm', inputs: { DO: { block: 'fc_move' } } }] } }), NOT_A_BLOCK, null],
  ['inputs that are a string', garbage({ blocks: { blocks: [morning(block('fc_wait', 'w', { inputs: 'MINUTES' as never }))] } }), FILL, 'w'],
];

describe('errors', () => {
  it.each(ERRORS)('%s gives { error, blockId } without throwing', (_name, json, error, blockId) => {
    expect(() => workspaceToProgram(json)).not.toThrow();
    expect(workspaceToProgram(json)).toStrictEqual({ error, blockId });
    expect(() => countWorkspaceBlocks(json)).not.toThrow();
  });

  it('turns nesting too deep to read into an error, not a stack overflow', () => {
    let deep: BlocklyBlockJson = block('fc_yes', 'leaf', { fields: { VALUE: 'TRUE' } });
    for (let i = 0; i < DEEP; i++) deep = block('fc_not', `not${i}`, { inputs: { A: slot(deep) } });
    const json = ws(morning(block('fc_if', 'i', { inputs: { COND: slot(deep) } })));
    expect(workspaceToProgram(json)).toStrictEqual({ error: NOT_A_BLOCK, blockId: null });
    expect(countWorkspaceBlocks(json)).toBe(DEEP + 2);
  });

  it('refuses a cycle, and still counts it', () => {
    const loop: { type: string; id: string; next?: BlocklyInputJson } = { type: 'fc_move', id: 'loop' };
    loop.next = { block: loop };
    const json = ws(morning(loop));
    expect(workspaceToProgram(json)).toStrictEqual({ error: NOT_A_BLOCK, blockId: 'loop' });
    expect(countWorkspaceBlocks(json)).toBe(2);
  });

  it('counts garbage as no blocks', () => {
    for (const value of [null, 42, [], { blocks: null }, { blocks: { blocks: null } }, { blocks: { blocks: [null, 'fc_move', { id: 'x' }] } }]) {
      expect(countWorkspaceBlocks(garbage(value))).toBe(0);
    }
  });
});

describe('the module', () => {
  it('never imports Blockly', () => {
    expect(translateSource).toContain('export function workspaceToProgram');
    expect(translateSource).not.toMatch(/from\s+['"]blockly/);
    expect(translateSource).not.toMatch(/import\(\s*['"]blockly/);
  });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run tests/translate.test.ts`
Expected: FAIL — `Error: Cannot find module '../src/ui/robotScreen/translate' imported from …/tests/translate.test.ts` (and `ROBOT_SCREEN` isn't in `src/config.ts` yet).

- [ ] **Step 3: Add `ROBOT_SCREEN` to `src/config.ts`**

Append to the end of `src/config.ts` (below whatever Tasks 3–9 appended):

```ts

/** The robot screen (farmclaws part 3 spec §4, §5). */
export const ROBOT_SCREEN = {
  /** Below this window width (px) the robot screen uses its phone layout. */
  phoneMaxWidth: 700,
  /** Vertical gap (px) between the top-level stacks of a loaded program. */
  stackGap: 40,
  /** Minutes between the options of the editor's time dropdowns. */
  timeStep: 10,
} as const;
```

- [ ] **Step 4: Create `src/ui/robotScreen/translate.ts`**

```ts
/**
 * Translation between the robot screen's Blockly workspace and block programs (farmclaws part 3
 * spec §5). Pure, and it never imports Blockly: the workspace JSON shape
 * (`serialization.workspaces.save`) is declared here, so the module runs and is tested without
 * a DOM. It only maps blocks to language nodes and back. Whatever it builds still goes through
 * isProgramShape and checkProgram, which stay the only gate.
 *
 * Block types are `fc_` + a language kind (blockTypeFor). Field values, as Blockly saves them:
 * - dropdowns hold strings: SIDE, CROP, ITEM, ZONE, WHAT, OP, TYPE (a ValueType), VALUE ('TRUE' or
 *   'FALSE'), and the times MINUTE (atTime, timeIsAfter) and MINUTES (every) as decimal strings;
 * - number fields hold numbers: NUM, and a tile's X and Z;
 * - text fields hold strings: TEXT, NAME (helpers, declarations, Run helper) and VAR (Set, Change
 *   and the variable getter).
 * The reader also takes a number field saved as text, and a time saved as a number.
 */
import { ROBOT_SCREEN } from '../../config';
import {
  CROP_IDS,
  EVERY_CHOICES,
  VALUE_TYPES,
  ZONE_IDS,
  type ActionBlock,
  type BlockProgram,
  type Expr,
  type HelperDef,
  type ItemId,
  type Statement,
  type Trigger,
  type TriggerStack,
  type VarDecl,
} from '../../core/types';
import { isItemId } from '../../items/items';
import { BLOCK_KINDS, type BlockKind } from '../../robots/blockKinds';

/** What an input or a `next` connection holds: a block, a shadow, or both (the block shows). */
export interface BlocklyInputJson {
  readonly block?: BlocklyBlockJson;
  readonly shadow?: BlocklyBlockJson;
}

/** One block as Blockly serializes it. */
export interface BlocklyBlockJson {
  readonly type: string;
  readonly id: string;
  readonly x?: number;
  readonly y?: number;
  readonly fields?: Readonly<Record<string, string | number>>;
  readonly inputs?: Readonly<Record<string, BlocklyInputJson>>;
  readonly next?: BlocklyInputJson;
  readonly extraState?: unknown;
}

/** A workspace as `Blockly.serialization.workspaces.save` returns it. `variables` is never used. */
export interface BlocklyWorkspaceJson {
  readonly blocks?: { readonly languageVersion?: number; readonly blocks?: readonly BlocklyBlockJson[] };
  readonly variables?: readonly unknown[];
}

export type TranslationResult =
  | { readonly program: BlockProgram; readonly loose: readonly string[] }
  | { readonly error: string; readonly blockId: string | null };

const FILL_SLOT = 'Fill every empty slot.';
const NOT_A_BLOCK = "This block isn't part of the robot language.";
const MISSING_SETTING = 'This block is missing a setting.';

const SIDES = ['left', 'right'] as const;
const TILE_AHEAD = ['water', 'blocked', 'clear'] as const;
const ARITH_OPS = ['+', '-', '×'] as const;
const COMPARE_OPS = ['=', '≠', '<', '>'] as const;
const YES_NO = ['TRUE', 'FALSE'] as const;

/** The block types of one block kind: `fc_` + the kind, except If (two shapes) and variables (getter and declaration). */
export function blockTypeFor(kind: BlockKind): readonly string[] {
  switch (kind) {
    case 'if':
      return ['fc_if', 'fc_ifElse'];
    case 'var':
      return ['fc_var', 'fc_varDecl'];
    default:
      return [`fc_${kind}`];
  }
}

/** Every block type of the robot language, in BLOCK_KINDS order. */
export const BLOCK_TYPES: readonly string[] = BLOCK_KINDS.flatMap((kind) => blockTypeFor(kind));

const KNOWN_TYPES: ReadonlySet<string> = new Set(BLOCK_TYPES);

/** Blocks that count 0 towards a robot's limit (part 2 spec §4): the five literals and variable declarations. */
const FREE_BLOCKS: ReadonlySet<string> = new Set(['fc_num', 'fc_text', 'fc_yes', 'fc_item', 'fc_tile', 'fc_varDecl']);

// --- Program → workspace ------------------------------------------------------------------

type Fields = Record<string, string | number>;
type Inputs = Record<string, BlocklyInputJson>;
/** Hands out block ids b1, b2, … in the order blocks are made. */
type NextId = () => string;

/** A block with its fields and inputs, leaving out empty ones as Blockly does. */
function blockJson(type: string, id: string, fields: Fields = {}, inputs: Inputs = {}): BlocklyBlockJson {
  return {
    type,
    id,
    ...(Object.keys(fields).length > 0 ? { fields } : {}),
    ...(Object.keys(inputs).length > 0 ? { inputs } : {}),
  };
}

function valueInput(expr: Expr, nextId: NextId): BlocklyInputJson {
  return { block: exprJson(expr, nextId) };
}

/** `inputs` plus statement input `name` holding `list`; an empty list leaves the input out. */
function withList(inputs: Inputs, name: string, list: readonly Statement[], nextId: NextId): Inputs {
  const head = listJson(list, nextId);
  return head === null ? inputs : { ...inputs, [name]: { block: head } };
}

/** The first statement's block, the rest chained by `next`; null for an empty list. */
function listJson(list: readonly Statement[], nextId: NextId): BlocklyBlockJson | null {
  const blocks = list.map((statement) => statementJson(statement, nextId));
  return blocks.reduceRight<BlocklyBlockJson | null>((next, block) => (next === null ? block : { ...block, next: { block: next } }), null);
}

function exprJson(expr: Expr, nextId: NextId): BlocklyBlockJson {
  const id = nextId();
  switch (expr.kind) {
    case 'num':
      return blockJson('fc_num', id, { NUM: expr.value });
    case 'text':
      return blockJson('fc_text', id, { TEXT: expr.value });
    case 'yes':
      return blockJson('fc_yes', id, { VALUE: expr.value ? 'TRUE' : 'FALSE' });
    case 'item':
      return blockJson('fc_item', id, { ITEM: expr.itemId });
    case 'tile':
      return blockJson('fc_tile', id, { X: expr.tx, Z: expr.tz });
    case 'var':
      return blockJson('fc_var', id, { VAR: expr.name });
    case 'myTile':
    case 'tileAhead':
    case 'tokensLeft':
    case 'cropIsReady':
    case 'soilIsDry':
    case 'tileIsTilled':
    case 'bagIsFull':
    case 'itIsRaining':
      return blockJson(`fc_${expr.kind}`, id);
    case 'countInBag':
    case 'bagHas':
      return blockJson(`fc_${expr.kind}`, id, { ITEM: expr.itemId });
    case 'cropIs':
      return blockJson('fc_cropIs', id, { CROP: expr.cropId });
    case 'atEdgeOf':
      return blockJson('fc_atEdgeOf', id, { ZONE: expr.zone });
    case 'tokensBelow':
      return blockJson('fc_tokensBelow', id, {}, { N: valueInput(expr.n, nextId) });
    case 'tileAheadIs':
      return blockJson('fc_tileAheadIs', id, { WHAT: expr.what });
    case 'timeIsAfter':
      return blockJson('fc_timeIsAfter', id, { MINUTE: String(expr.minute) });
    case 'arith':
    case 'compare':
      return blockJson(`fc_${expr.kind}`, id, { OP: expr.op }, { A: valueInput(expr.a, nextId), B: valueInput(expr.b, nextId) });
    case 'and':
    case 'or':
      return blockJson(`fc_${expr.kind}`, id, {}, { A: valueInput(expr.a, nextId), B: valueInput(expr.b, nextId) });
    case 'not':
      return blockJson('fc_not', id, {}, { A: valueInput(expr.a, nextId) });
  }
}

function actionJson(action: ActionBlock, id: string, nextId: NextId): BlocklyBlockJson {
  switch (action.kind) {
    case 'move':
    case 'water':
    case 'harvest':
    case 'till':
    case 'refill':
    case 'deposit':
    case 'powerDown':
      return blockJson(`fc_${action.kind}`, id);
    case 'turn':
      return blockJson('fc_turn', id, { SIDE: action.side });
    case 'plant':
      return blockJson('fc_plant', id, { CROP: action.cropId });
    case 'take':
      return blockJson('fc_take', id, {}, { ITEM: valueInput(action.item, nextId) });
    case 'say':
      return blockJson('fc_say', id, {}, { TEXT: valueInput(action.text, nextId) });
    case 'wait':
      return blockJson('fc_wait', id, {}, { MINUTES: valueInput(action.minutes, nextId) });
  }
}

function statementJson(statement: Statement, nextId: NextId): BlocklyBlockJson {
  const id = nextId();
  switch (statement.kind) {
    case 'do':
      return actionJson(statement.action, id, nextId);
    case 'repeatTimes':
      return blockJson('fc_repeatTimes', id, {}, withList({ TIMES: valueInput(statement.times, nextId) }, 'DO', statement.body, nextId));
    case 'repeatUntil':
      return blockJson('fc_repeatUntil', id, {}, withList({ UNTIL: valueInput(statement.until, nextId) }, 'DO', statement.body, nextId));
    case 'repeatForever':
      return blockJson('fc_repeatForever', id, {}, withList({}, 'DO', statement.body, nextId));
    case 'if': {
      const inputs = withList({ COND: valueInput(statement.cond, nextId) }, 'THEN', statement.then, nextId);
      if (statement.else === null) return blockJson('fc_if', id, {}, inputs);
      return blockJson('fc_ifElse', id, {}, withList(inputs, 'ELSE', statement.else, nextId));
    }
    case 'forEachTile':
      return blockJson('fc_forEachTile', id, { ZONE: statement.zone }, withList({}, 'DO', statement.body, nextId));
    case 'goTo':
      return blockJson('fc_goTo', id, {}, { TILE: valueInput(statement.tile, nextId) });
    case 'set':
      return blockJson('fc_set', id, { VAR: statement.name }, { VALUE: valueInput(statement.value, nextId) });
    case 'change':
      return blockJson('fc_change', id, { VAR: statement.name }, { BY: valueInput(statement.by, nextId) });
    case 'runHelper':
      return blockJson('fc_runHelper', id, { NAME: statement.name });
  }
}

function triggerFields(trigger: Trigger): Fields {
  switch (trigger.kind) {
    case 'atTime':
      return { MINUTE: String(trigger.minute) };
    case 'every':
      return { MINUTES: String(trigger.minutes) };
    default:
      return {};
  }
}

/**
 * The workspace for `program`: variable declarations, then trigger stacks, then helpers, each in
 * program order, at x 0 and y index × ROBOT_SCREEN.stackGap (the Program tab re-spaces them by
 * their rendered height after loading). Block ids are b1, b2, … depth first (a block, then its
 * inputs in order, then the block after it), so the same program always gives the same JSON.
 */
export function programToWorkspace(program: BlockProgram): BlocklyWorkspaceJson {
  let made = 0;
  const nextId: NextId = () => `b${++made}`;
  const vars = program.vars.map((decl) => {
    const id = nextId();
    return blockJson('fc_varDecl', id, { NAME: decl.name, TYPE: decl.type }, { INITIAL: valueInput(decl.initial, nextId) });
  });
  const stacks = program.stacks.map((stack) => {
    const id = nextId();
    return blockJson(`fc_${stack.trigger.kind}`, id, triggerFields(stack.trigger), withList({}, 'DO', stack.body, nextId));
  });
  const helpers = program.helpers.map((helper) => {
    const id = nextId();
    return blockJson('fc_helper', id, { NAME: helper.name }, withList({}, 'DO', helper.body, nextId));
  });
  const blocks = [...vars, ...stacks, ...helpers].map((block, index) => ({ ...block, x: 0, y: index * ROBOT_SCREEN.stackGap }));
  return { blocks: { languageVersion: 0, blocks } };
}

// --- Workspace → program ------------------------------------------------------------------

/** Workspace JSON as it really arrives: anything at all. */
type Raw = Readonly<Record<string, unknown>>;

/** A block read from the workspace: its type and id checked, the rest still raw. */
interface Node {
  readonly type: string;
  readonly id: string;
  readonly raw: Raw;
}

/** A translation error on its way out of the reader; workspaceToProgram catches it. */
class Untranslatable {
  readonly error: string;
  readonly blockId: string | null;

  constructor(error: string, blockId: string | null) {
    this.error = error;
    this.blockId = blockId;
  }
}

function fail(error: string, blockId: string | null): never {
  throw new Untranslatable(error, blockId);
}

function isRaw(v: unknown): v is Raw {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** The top-level block list; [] when the workspace has none, null when it isn't workspace JSON. */
function topBlocks(json: unknown): readonly unknown[] | null {
  if (!isRaw(json)) return null;
  const { blocks } = json;
  if (blocks === undefined) return [];
  if (!isRaw(blocks)) return null;
  const list = blocks.blocks;
  if (list === undefined) return [];
  return Array.isArray(list) ? list : null;
}

/** What an input or `next` holds: its block, else its shadow, else undefined. */
function slotContent(slot: unknown): unknown {
  if (!isRaw(slot)) return undefined;
  const content = slot.block ?? slot.shadow;
  return content === null ? undefined : content;
}

function inputContent(at: Node, name: string): unknown {
  const inputs = at.raw.inputs;
  return isRaw(inputs) ? slotContent(inputs[name]) : undefined;
}

function fieldOf(at: Node, name: string): unknown {
  const fields = at.raw.fields;
  return isRaw(fields) ? fields[name] : undefined;
}

function textField(at: Node, name: string): string {
  const value = fieldOf(at, name);
  return typeof value === 'string' ? value : fail(MISSING_SETTING, at.id);
}

/** A finite number, saved as a number or as its own decimal text ("583", not "0583" or "nine"). */
function numberField(at: Node, name: string): number {
  const value = fieldOf(at, name);
  const n = typeof value === 'string' && String(Number(value)) === value ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : fail(MISSING_SETTING, at.id);
}

function choiceField<T extends string>(at: Node, name: string, choices: readonly T[]): T {
  const value = fieldOf(at, name);
  return choices.find((choice) => choice === value) ?? fail(MISSING_SETTING, at.id);
}

function itemField(at: Node, name: string): ItemId {
  const value = fieldOf(at, name);
  return isItemId(value) ? value : fail(MISSING_SETTING, at.id);
}

function everyField(at: Node): (typeof EVERY_CHOICES)[number] {
  const minutes = numberField(at, 'MINUTES');
  return EVERY_CHOICES.find((choice) => choice === minutes) ?? fail(MISSING_SETTING, at.id);
}

/** The trigger a top-level block starts, or null when it isn't a trigger block. */
function triggerOf(at: Node): Trigger | null {
  switch (at.type) {
    case 'fc_morning':
      return { kind: 'morning' };
    case 'fc_atTime':
      return { kind: 'atTime', minute: numberField(at, 'MINUTE') };
    case 'fc_bagFull':
      return { kind: 'bagFull' };
    case 'fc_startsRaining':
      return { kind: 'startsRaining' };
    case 'fc_every':
      return { kind: 'every', minutes: everyField(at) };
    default:
      return null;
  }
}

const act = (action: ActionBlock): Statement => ({ kind: 'do', action });

interface TranslatedProgram {
  readonly program: BlockProgram;
  readonly loose: readonly string[];
}

/** One translation. It refuses a block met twice: a cycle, or one node shared by two parents. */
class WorkspaceReader {
  private readonly seen = new Set<Raw>();

  read(json: unknown): TranslatedProgram {
    const vars: VarDecl[] = [];
    const stacks: TriggerStack[] = [];
    const helpers: HelperDef[] = [];
    const loose: string[] = [];
    for (const content of topBlocks(json) ?? fail(NOT_A_BLOCK, null)) {
      const at = this.node(content);
      const trigger = triggerOf(at);
      if (trigger !== null) {
        stacks.push({ trigger, body: this.list(at, 'DO') });
      } else if (at.type === 'fc_helper') {
        helpers.push({ name: textField(at, 'NAME'), body: this.list(at, 'DO') });
      } else if (at.type === 'fc_varDecl') {
        vars.push({ name: textField(at, 'NAME'), type: choiceField(at, 'TYPE', VALUE_TYPES), initial: this.value(at, 'INITIAL') });
      } else if (KNOWN_TYPES.has(at.type)) {
        loose.push(at.id);
        continue;
      } else {
        return fail(NOT_A_BLOCK, at.id);
      }
      // Nothing goes below a stack, a helper or a declaration: a block chained there is loose.
      const chained = slotContent(at.raw.next);
      if (chained !== undefined) loose.push(this.node(chained).id);
    }
    return { program: { kind: 'blocks', vars, stacks, helpers }, loose };
  }

  private node(content: unknown): Node {
    const raw = isRaw(content) ? content : null;
    const type = raw?.type;
    const id = raw?.id;
    if (raw === null || typeof type !== 'string' || typeof id !== 'string' || this.seen.has(raw)) {
      return fail(NOT_A_BLOCK, typeof id === 'string' ? id : null);
    }
    this.seen.add(raw);
    return { type, id, raw };
  }

  private value(at: Node, name: string): Expr {
    const content = inputContent(at, name);
    return content === undefined ? fail(FILL_SLOT, at.id) : this.expr(this.node(content));
  }

  /** A statement input's list: its first block, then each `next`. An empty input is an empty list. */
  private list(at: Node, name: string): Statement[] {
    const list: Statement[] = [];
    let content = inputContent(at, name);
    while (content !== undefined) {
      const statement = this.node(content);
      list.push(this.statement(statement));
      content = slotContent(statement.raw.next);
    }
    return list;
  }

  private statement(at: Node): Statement {
    switch (at.type) {
      case 'fc_move':
        return act({ kind: 'move' });
      case 'fc_turn':
        return act({ kind: 'turn', side: choiceField(at, 'SIDE', SIDES) });
      case 'fc_water':
        return act({ kind: 'water' });
      case 'fc_harvest':
        return act({ kind: 'harvest' });
      case 'fc_till':
        return act({ kind: 'till' });
      case 'fc_plant':
        return act({ kind: 'plant', cropId: choiceField(at, 'CROP', CROP_IDS) });
      case 'fc_refill':
        return act({ kind: 'refill' });
      case 'fc_deposit':
        return act({ kind: 'deposit' });
      case 'fc_take':
        return act({ kind: 'take', item: this.value(at, 'ITEM') });
      case 'fc_say':
        return act({ kind: 'say', text: this.value(at, 'TEXT') });
      case 'fc_wait':
        return act({ kind: 'wait', minutes: this.value(at, 'MINUTES') });
      case 'fc_powerDown':
        return act({ kind: 'powerDown' });
      case 'fc_if':
        return { kind: 'if', cond: this.value(at, 'COND'), then: this.list(at, 'THEN'), else: null };
      case 'fc_ifElse':
        return { kind: 'if', cond: this.value(at, 'COND'), then: this.list(at, 'THEN'), else: this.list(at, 'ELSE') };
      case 'fc_repeatTimes':
        return { kind: 'repeatTimes', times: this.value(at, 'TIMES'), body: this.list(at, 'DO') };
      case 'fc_repeatUntil':
        return { kind: 'repeatUntil', until: this.value(at, 'UNTIL'), body: this.list(at, 'DO') };
      case 'fc_repeatForever':
        return { kind: 'repeatForever', body: this.list(at, 'DO') };
      case 'fc_forEachTile':
        return { kind: 'forEachTile', zone: choiceField(at, 'ZONE', ZONE_IDS), body: this.list(at, 'DO') };
      case 'fc_goTo':
        return { kind: 'goTo', tile: this.value(at, 'TILE') };
      case 'fc_set':
        return { kind: 'set', name: textField(at, 'VAR'), value: this.value(at, 'VALUE') };
      case 'fc_change':
        return { kind: 'change', name: textField(at, 'VAR'), by: this.value(at, 'BY') };
      case 'fc_runHelper':
        return { kind: 'runHelper', name: textField(at, 'NAME') };
      default:
        return fail(NOT_A_BLOCK, at.id);
    }
  }

  private expr(at: Node): Expr {
    switch (at.type) {
      case 'fc_num':
        return { kind: 'num', value: numberField(at, 'NUM') };
      case 'fc_text':
        return { kind: 'text', value: textField(at, 'TEXT') };
      case 'fc_yes':
        return { kind: 'yes', value: choiceField(at, 'VALUE', YES_NO) === 'TRUE' };
      case 'fc_item':
        return { kind: 'item', itemId: itemField(at, 'ITEM') };
      case 'fc_tile':
        return { kind: 'tile', tx: numberField(at, 'X'), tz: numberField(at, 'Z') };
      case 'fc_var':
        return { kind: 'var', name: textField(at, 'VAR') };
      case 'fc_myTile':
        return { kind: 'myTile' };
      case 'fc_tileAhead':
        return { kind: 'tileAhead' };
      case 'fc_tokensLeft':
        return { kind: 'tokensLeft' };
      case 'fc_countInBag':
        return { kind: 'countInBag', itemId: itemField(at, 'ITEM') };
      case 'fc_arith':
        return { kind: 'arith', op: choiceField(at, 'OP', ARITH_OPS), a: this.value(at, 'A'), b: this.value(at, 'B') };
      case 'fc_compare':
        return { kind: 'compare', op: choiceField(at, 'OP', COMPARE_OPS), a: this.value(at, 'A'), b: this.value(at, 'B') };
      case 'fc_and':
        return { kind: 'and', a: this.value(at, 'A'), b: this.value(at, 'B') };
      case 'fc_or':
        return { kind: 'or', a: this.value(at, 'A'), b: this.value(at, 'B') };
      case 'fc_not':
        return { kind: 'not', a: this.value(at, 'A') };
      case 'fc_cropIsReady':
        return { kind: 'cropIsReady' };
      case 'fc_soilIsDry':
        return { kind: 'soilIsDry' };
      case 'fc_tileIsTilled':
        return { kind: 'tileIsTilled' };
      case 'fc_cropIs':
        return { kind: 'cropIs', cropId: choiceField(at, 'CROP', CROP_IDS) };
      case 'fc_bagIsFull':
        return { kind: 'bagIsFull' };
      case 'fc_bagHas':
        return { kind: 'bagHas', itemId: itemField(at, 'ITEM') };
      case 'fc_atEdgeOf':
        return { kind: 'atEdgeOf', zone: choiceField(at, 'ZONE', ZONE_IDS) };
      case 'fc_tokensBelow':
        return { kind: 'tokensBelow', n: this.value(at, 'N') };
      case 'fc_tileAheadIs':
        return { kind: 'tileAheadIs', what: choiceField(at, 'WHAT', TILE_AHEAD) };
      case 'fc_itIsRaining':
        return { kind: 'itIsRaining' };
      case 'fc_timeIsAfter':
        return { kind: 'timeIsAfter', minute: numberField(at, 'MINUTE') };
      default:
        return fail(NOT_A_BLOCK, at.id);
    }
  }
}

/**
 * The program a workspace holds, and the ids of its loose top-level blocks (any block that isn't a
 * trigger, `fc_helper` or `fc_varDecl`, plus a block chained under one of those). Each kind is
 * read in its order in `blocks.blocks`; `variables` is ignored. Never throws: an unknown block
 * type, a field missing or of the wrong kind, an empty value slot, or input that isn't workspace
 * JSON at all (including a cycle, a shared node, or nesting too deep to read) gives
 * `{ error, blockId }`, naming the block when there is one.
 */
export function workspaceToProgram(json: BlocklyWorkspaceJson): TranslationResult {
  try {
    return new WorkspaceReader().read(json);
  } catch (thrown) {
    if (thrown instanceof Untranslatable) return { error: thrown.error, blockId: thrown.blockId };
    return { error: NOT_A_BLOCK, blockId: null };
  }
}

/**
 * Blocks in a workspace the way blockCount counts a program: literals and variable declarations 0
 * (and everything under a declaration's starting value, which blockCount never reads), every other
 * block 1, loose blocks and unfilled slots included, so the editor's counter works mid-edit. A slot's shadow counts only when it holds no block. Never throws; iterative, so any
 * depth is fine, and each block object counts once.
 */
export function countWorkspaceBlocks(json: BlocklyWorkspaceJson): number {
  const pending: unknown[] = [...(topBlocks(json) ?? [])];
  const seen = new Set<Raw>();
  let count = 0;
  while (pending.length > 0) {
    const block = pending.pop();
    if (!isRaw(block) || seen.has(block)) continue;
    seen.add(block);
    if (typeof block.type === 'string' && !FREE_BLOCKS.has(block.type)) count++;
    if (block.type === 'fc_varDecl') continue;
    const inputs = block.inputs;
    if (isRaw(inputs)) for (const slot of Object.values(inputs)) pending.push(slotContent(slot));
    pending.push(slotContent(block.next));
  }
  return count;
}
```

- [ ] **Step 5: Run it and see it pass**

Run: `npx vitest run tests/translate.test.ts`
Expected: PASS (132 tests), in well under a second.

- [ ] **Step 6: The full gate**

Run: `npm run typecheck && npm test && npm run build`
Expected: all green. Nothing in the main chunk imports `translate.ts` yet, so the build output is unchanged.

- [ ] **Step 7: Commit**

```bash
git add src/config.ts src/ui/robotScreen/translate.ts tests/translate.test.ts
git commit -m "Farmclaws part 3: translate between the Blockly workspace and block programs

programToWorkspace and workspaceToProgram map Blockly's saved workspace JSON to
BlockProgram and back without importing Blockly; countWorkspaceBlocks counts blocks
the way blockCount does, mid-edit too. Every block type, the design's job programs and
300 generated programs round-trip, and every malformed workspace becomes
{ error, blockId } without throwing. ROBOT_SCREEN joins the config here, ahead of the
robot screen shell.

Rulings: dropdown fields (times, Every, yes-or-no, ids, operators) are saved as strings
and number fields as numbers, and the reader takes either for a number; ids are b1, b2,
... depth first; top-level blocks get y = index x stackGap and the Program tab re-spaces
them by rendered height; a block chained under a trigger, helper or declaration is loose;
a malformed workspace, a block met twice and nesting too deep to read are \"This block
isn't part of the robot language.\" with blockId null when there is no id.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: The robot screen shell

**Files:**
- Modify: `src/state/actions.ts` (the `GameAction` union and the `actions` object: `ui/notify`)
- Modify: `src/state/reducer.ts` (the `gameReducer` switch, after `case 'ui/closePanel':`)
- Modify: `src/input/panelKeys.ts` (top of `panelKeyCommand`)
- Modify: `src/input/InputController.ts` (top of `onKeyDown`)
- Modify: `src/ui/hud.css` (the token selector at the top; a new section at the end)
- Modify: `src/main.ts` (create, sync and dispose the host)
- Create: `src/ui/RobotScreenHost.ts`
- Create: `src/ui/robotScreen/viewModel.ts`
- Create: `src/ui/robotScreen/partIcons.ts`
- Create: `src/ui/robotScreen/RobotScreen.ts`
- Create: `src/ui/robotScreen/robotScreen.css`
- Create: `src/ui/robotScreen/tabs/tabView.ts`
- Create: `src/ui/robotScreen/tabs/LooksTab.ts`
- Create: `src/ui/robotScreen/tabs/StatsTab.ts`
- Create: `src/ui/robotScreen/tabs/LogTab.ts`
- Test: `tests/robotScreen.test.ts` (create), `tests/panelKeys.test.ts` (extend)

**Interfaces:**
- Consumes:
  - Task 3: `Robot.stats: RobotStats` (`today` / `week`, each `{ tokens, actions, crops }`); `robotOf` in `tests/testUtils.ts` builds `stats`.
  - Task 4: `ROBOT_TABS`, `RobotTab`, `RobotUnlocks`, `RobotsState.unlocks` (`src/core/types.ts`); `UNLOCKS.job1` (`src/config.ts`); `ALL_UNLOCKS` (`src/robots/unlocks.ts`).
  - Task 5: `UiPanel` `{ kind: 'robot'; robotId: number; mode: 'bench' | 'peek' }`; `Robot.off` with `'player'`; `actions.liftOffBench(robotId)`, `actions.switchRobot(robotId, on)`.
  - Task 7: `'ruined'` in `ROBOT_POWERS`; `Robot.paint`; `ROBOT_CARE.paintCost`; `ROBOT_PAINTS` (16 `{ name, color }`); `scrapValue(robot)` (`src/robots/stats.ts`); `actions.scrapRobot(robotId)`, `actions.paintRobot(robotId, paint)`; `logText`'s "a scrapped robot".
  - Task 8: `panelKeyCommand(code: string, state: GameState, shift = false)`; `InputController` passes Shift.
  - Task 10: `ROBOT_SCREEN = { phoneMaxWidth: 700, stackGap: 40, timeStep: 10 }` (`src/config.ts`). This task doesn't add it.
  - Part 1–2: `findRobot` (`src/robots/world.ts`), `batteryFor` (`src/robots/stats.ts`), `robotSays`, `whatHappened` (`src/robots/logText.ts`), `formatClock(minute, step)` (`src/time/clock.ts`), `pushMessage` (`src/state/messages.ts`), `h`, `hudButton`, `setText`, `setHidden`, `setAttr`, `setTitle`, `closestWithin` (`src/ui/dom.ts`), `createBoltIcon`, `createCloseIcon` (`src/ui/icons.ts`).
- Produces:
  - `src/state/actions.ts`: `{ type: 'ui/notify'; text: string; tone: MessageTone }` → `actions.notify(text, tone)`; the reducer pushes it as a toast.
  - `src/ui/RobotScreenHost.ts`: `export class RobotScreenHost { constructor(opts: RobotScreenHostOptions); sync(state: GameState, prev: GameState | null): void; dispose(): void }` with `RobotScreenHostOptions = { root: HTMLElement; store: Store<GameState, GameAction> }`.
  - `src/ui/robotScreen/RobotScreen.ts`: `export class RobotScreen { constructor(opts: RobotScreenOptions); open(state: GameState): void; sync(state: GameState, prev: GameState): void; close(): void; dispose(): void }`, and the module-level `TAB_FACTORIES` table that Tasks 12 and 13 extend.
  - `src/ui/robotScreen/tabs/tabView.ts`: `RobotTabContext` `{ robotId; mode; dispatch; getState; signal }` and `RobotTabView` `{ element; open(state); sync(state, prev); setActive(active); isDirty(); handleEscape(); dispose() }` (the contract's interface plus `setActive`, see the notes).
  - `src/ui/robotScreen/viewModel.ts` (pure): `type RobotScreenMode = 'bench' | 'peek'`; `SIZE_LABELS`, `PART_LABELS`, `POWER_LABELS`, `TAB_LABELS`; `headerView(robot): HeaderView` (`{ name; sizeLabel; parts; tokens; power; offText }`); `switchView(robot, mode): { label: 'On' | 'Off'; on: boolean } | null`; `visibleTabs(mode, unlocks): readonly RobotTab[]`; `isEditTab(tab)`; `ruinedNote(robot): string | null`; `statsRows(robot)`; `logRows(state, robotId): readonly LogRow[]` (`{ id; time; says; happened; count; yesterday }`); `countText(count)`; `formatClockMinute(minute)`; `discardPrompt(name)`; `scrapPrompt(robot)`; `paintButtonText()`; `paintHex(color)`; `paintName(index)`; `phoneQuery()`; `LOG_TEXT`; `EMPTY_TABS_TEXT`.
  - `src/ui/robotScreen/partIcons.ts`: `createPartIcon(part: RobotPartId): SVGSVGElement`; `createRobotPreview(): RobotPreview` (`{ element; paint(color) }`).
  - `src/ui/robotScreen/robotScreen.css`: every style the screen and all five tabs use (Tasks 12 and 13 add no CSS).
  - `panelKeyCommand` returns `null` whenever `ui.panel.kind === 'robot'`; `InputController.onKeyDown` returns before anything else (no dispatch, no `preventDefault`) while a robot panel is open.

Rules this task settles (recorded in the commit message):
- The screen listens for Escape on `window` in the **capture** phase. Blockly's widget container stops `keydown` propagation, so a bubbling listener would never hear Escape typed into a Blockly field; in the capture phase the active tab sees it first and can leave it to Blockly (`handleEscape()` returns true), and only otherwise does the screen close. When the screen acts on Escape it calls `preventDefault` and `stopPropagation`, so InputController never turns the same press into a pause.
- A tab's view is built the first time the tab is shown and kept until the screen closes, so switching tabs keeps unsaved edits. `RobotTabView.setActive` tells a view when it is shown: Blockly can only inject into a visible container.
- Toasts stay readable while the screen is open: `robotScreen.css` lifts `.hud-toasts` above the screen, bottom-centre, with a `:has()` rule scoped to an open screen.
- The loading card ("Opening…") is styled in `hud.css`, because the screen's own stylesheet arrives with the lazy chunk. `hud.css` also declares its `--hud-*` tokens on `.robot-screen` and `.robot-screen-loading`, so the screen reuses `.hud-btn` and `.hud-iconbtn`.
- A failed import closes the panel with the toast "The robot screen couldn't load. Try again." and forgets the failed attempt, so the next robot panel tries again.

- [ ] **Step 1: Write the failing tests**

Create `tests/robotScreen.test.ts`:

```ts
/**
 * The robot screen's pure parts (farmclaws part 3 spec §4, §11): header text, tab visibility,
 * the switch, Stats and Log rows, prompts, and the keyboard handover (InputController and the
 * ui/notify toast). The DOM and Blockly glue are checked in the browser.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ROBOT_CARE, ROBOT_PAINTS, UNLOCKS } from '../src/config';
import { createStore, type Store } from '../src/core/store';
import type { GameState, RobotLogEntry, RobotLogEvent } from '../src/core/types';
import { InputController } from '../src/input/InputController';
import type { CameraRig } from '../src/render/CameraRig';
import { ALL_UNLOCKS } from '../src/robots/unlocks';
import { actions, type GameAction } from '../src/state/actions';
import { gameReducer } from '../src/state/reducer';
import {
  EMPTY_TABS_TEXT,
  LOG_TEXT,
  countText,
  discardPrompt,
  formatClockMinute,
  headerView,
  isEditTab,
  logRows,
  paintButtonText,
  paintHex,
  paintName,
  phoneQuery,
  ruinedNote,
  scrapPrompt,
  statsRows,
  switchView,
  visibleTabs,
} from '../src/ui/robotScreen/viewModel';
import { BASE, atDay, robotOf, withRobots } from './testUtils';

function withPanel(state: GameState, panel: GameState['ui']['panel']): GameState {
  return { ...state, ui: { ...state.ui, panel } };
}

describe('headerView', () => {
  it('names the robot, its size, parts and tokens', () => {
    const robot = robotOf({ name: 'Bolt', size: 'standard', parts: ['claw', 'sensorEye'], tokens: 42 });
    expect(headerView(robot)).toEqual({
      name: 'Bolt',
      sizeLabel: 'Standard',
      parts: ['claw', 'sensorEye'],
      tokens: '42 / 200 tokens',
      power: 'Working',
      offText: null,
    });
  });

  it('gives the off text for each reason', () => {
    expect(headerView(robotOf({ off: 'player' })).offText).toBe('Switched off');
    expect(headerView(robotOf({ off: 'dizzy' })).offText).toBe('Off until morning');
    expect(headerView(robotOf({ off: 'done' })).offText).toBe('Off until morning');
  });

  it('names every power', () => {
    const power = (p: Parameters<typeof robotOf>[0]) => headerView(robotOf(p)).power;
    expect(power({ power: 'standby' })).toBe('Standing by');
    expect(power({ power: 'flat', tokens: 0 })).toBe('Flat');
    expect(power({ power: 'broken' })).toBe('Shorted out');
    expect(power({ power: 'repairing', repairReadyDay: 3 })).toBe('Getting a new core');
    expect(power({ power: 'ruined' })).toBe('Ruined');
  });

  it("uses the size's battery", () => {
    expect(headerView(robotOf({ size: 'big', tokens: 500 })).tokens).toBe('500 / 500 tokens');
  });
});

describe('switchView', () => {
  it('offers Off unless the player switched the robot off', () => {
    expect(switchView(robotOf({ off: null }), 'bench')).toEqual({ label: 'Off', on: false });
    expect(switchView(robotOf({ off: 'dizzy' }), 'bench')).toEqual({ label: 'Off', on: false });
    expect(switchView(robotOf({ off: 'player' }), 'bench')).toEqual({ label: 'On', on: true });
  });

  it('offers Off to a standing-by or flat robot too', () => {
    expect(switchView(robotOf({ power: 'standby' }), 'bench')).toEqual({ label: 'Off', on: false });
    expect(switchView(robotOf({ power: 'flat', tokens: 0 }), 'bench')).toEqual({ label: 'Off', on: false });
  });

  it('is hidden in peek mode and for a broken, repairing or ruined robot', () => {
    expect(switchView(robotOf(), 'peek')).toBeNull();
    expect(switchView(robotOf({ off: 'player' }), 'peek')).toBeNull();
    expect(switchView(robotOf({ power: 'broken' }), 'bench')).toBeNull();
    expect(switchView(robotOf({ power: 'repairing', repairReadyDay: 3 }), 'bench')).toBeNull();
    expect(switchView(robotOf({ power: 'ruined' }), 'bench')).toBeNull();
  });
});

describe('visibleTabs', () => {
  it("shows job 1's tabs on the bench, in order", () => {
    expect(visibleTabs('bench', UNLOCKS.job1)).toEqual(['program', 'md', 'looks', 'log']);
  });

  it('shows only Stats and Log when peeking, each still needing its unlock', () => {
    expect(visibleTabs('peek', UNLOCKS.job1)).toEqual(['log']);
    expect(visibleTabs('peek', ALL_UNLOCKS)).toEqual(['stats', 'log']);
  });

  it('shows every tab on the bench once all are unlocked', () => {
    expect(visibleTabs('bench', ALL_UNLOCKS)).toEqual(['program', 'md', 'looks', 'stats', 'log']);
  });

  it('marks Program, .MD and Looks as the editing tabs', () => {
    expect((['program', 'md', 'looks', 'stats', 'log'] as const).filter(isEditTab)).toEqual(['program', 'md', 'looks']);
  });
});

describe('ruinedNote', () => {
  it('explains a ruined robot and nothing else', () => {
    expect(ruinedNote(robotOf({ name: 'Bolt', power: 'ruined' }))).toBe('Bolt is ruined. It can only be scrapped.');
    expect(ruinedNote(robotOf({ name: 'Bolt', power: 'broken' }))).toBeNull();
  });
});

describe('statsRows', () => {
  it('lists today and this week, with — for tokens per crop when no crops were handled', () => {
    const robot = robotOf({
      stats: { today: { tokens: 10, actions: 4, crops: 0 }, week: { tokens: 25, actions: 9, crops: 3 } },
    });
    expect(statsRows(robot)).toEqual([
      { label: 'Tokens used', today: '10', week: '25' },
      { label: 'Actions taken', today: '4', week: '9' },
      { label: 'Crops handled', today: '0', week: '3' },
      { label: 'Tokens per crop', today: '—', week: '8.3' },
    ]);
  });

  it('groups thousands', () => {
    const robot = robotOf({ stats: { today: { tokens: 1200, actions: 1000, crops: 2 }, week: { tokens: 1200, actions: 1000, crops: 2 } } });
    expect(statsRows(robot)[0]).toEqual({ label: 'Tokens used', today: '1,200', week: '1,200' });
    expect(statsRows(robot)[3]).toEqual({ label: 'Tokens per crop', today: '600', week: '600' });
  });
});

describe('logRows', () => {
  const MOVED: RobotLogEvent = { kind: 'did', action: 'move', detail: { kind: 'tile' } };
  const BICKERED: RobotLogEvent = { kind: 'bickered', action: 'harvest', withIds: [2] };
  const entry = (id: number, robotId: number, day: number, minute: number, event: RobotLogEvent, count = 1): RobotLogEntry => ({
    id,
    day,
    minute,
    robotId,
    tx: 5,
    tz: 10,
    event,
    count,
  });

  const state = (() => {
    const base = withRobots(atDay(BASE, 5, 700), [robotOf({ id: 1, name: 'Sprocket' }), robotOf({ id: 2, name: 'Dee' })]);
    const entries = [
      entry(1, 1, 3, 400, MOVED),
      entry(2, 1, 4, 580, MOVED),
      entry(3, 2, 5, 390, MOVED),
      entry(4, 1, 5, 400, BICKERED),
      entry(5, 1, 5, 580, MOVED, 3),
    ];
    return { ...base, robots: { ...base.robots, log: { nextId: 6, entries } } };
  })();

  it("lists today's and yesterday's entries for one robot, newest first", () => {
    expect(logRows(state, 1)).toEqual([
      { id: 5, time: '9:40 am', says: 'Moved forward ✓', happened: 'Moved one tile.', count: 3, yesterday: false },
      { id: 4, time: '6:40 am', says: 'Waiting my turn ✓', happened: 'Fought Dee over the same tile. Nobody got it.', count: 1, yesterday: false },
      { id: 2, time: '9:40 am', says: 'Moved forward ✓', happened: 'Moved one tile.', count: 1, yesterday: true },
    ]);
  });

  it('is empty for a robot with no entries today or yesterday', () => {
    expect(logRows(state, 7)).toEqual([]);
  });

  it('shows a count only on merged entries', () => {
    expect(countText(1)).toBe('');
    expect(countText(3)).toBe('×3');
  });

  it('has the empty text from the spec', () => {
    expect(LOG_TEXT.empty).toBe('Nothing yet today.');
    expect(LOG_TEXT.yesterday).toBe('Yesterday');
    expect(EMPTY_TABS_TEXT).toBe('Nothing to show yet.');
  });
});

describe('formatClockMinute', () => {
  it('writes the exact minute', () => {
    expect(formatClockMinute(580)).toBe('9:40 am');
    expect(formatClockMinute(583)).toBe('9:43 am');
    expect(formatClockMinute(1510)).toBe('1:10 am');
  });
});

describe('prompts and paint', () => {
  it('asks before discarding edits', () => {
    expect(discardPrompt('Bolt')).toBe("Discard your changes to Bolt's program?");
  });

  it('names the scrap value', () => {
    expect(scrapPrompt(robotOf({ name: 'Bolt', size: 'standard' }))).toBe("Scrap Bolt for 1000g? This can't be undone.");
    expect(scrapPrompt(robotOf({ name: 'Pip', size: 'mini' }))).toBe("Scrap Pip for 375g? This can't be undone.");
    expect(scrapPrompt(robotOf({ name: 'Max', size: 'big', power: 'ruined' }))).toBe("Scrap Max for 2500g? This can't be undone.");
  });

  it('prices a paint job from config', () => {
    expect(paintButtonText()).toBe(`Paint · ${ROBOT_CARE.paintCost}g`);
    expect(paintButtonText()).toBe('Paint · 50g');
  });

  it('turns paint colours into CSS', () => {
    expect(paintHex(0xf2c14e)).toBe('#f2c14e');
    expect(paintHex(0x0000ff)).toBe('#0000ff');
    expect(ROBOT_PAINTS.map((paint) => paintHex(paint.color))).toHaveLength(16);
    expect(paintName(8)).toBe('Ocean');
    expect(paintName(99)).toBe('');
  });

  it('switches to the phone layout below ROBOT_SCREEN.phoneMaxWidth', () => {
    expect(phoneQuery()).toBe('(max-width: 699.98px)');
  });
});

describe('ui/notify', () => {
  it('pushes a toast', () => {
    const next = gameReducer(BASE, actions.notify("The robot screen couldn't load. Try again.", 'warn'));
    expect(next.messages.entries.at(-1)).toMatchObject({ text: "The robot screen couldn't load. Try again.", tone: 'warn' });
  });
});

describe('InputController while a robot screen is open (spec §4.1)', () => {
  // The node test environment has no DOM classes; InputController only needs them to exist.
  beforeEach(() => {
    vi.stubGlobal('HTMLElement', class {});
    vi.stubGlobal('Element', class {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function harness(state: GameState) {
    const store = createStore<GameState, GameAction>(gameReducer, state);
    const dispatched: GameAction[] = [];
    const spy: Store<GameState, GameAction> = {
      getState: store.getState,
      subscribe: store.subscribe,
      dispatch: (action) => {
        dispatched.push(action);
        return store.dispatch(action);
      },
    };
    const target = Object.assign(new EventTarget(), { document: new EventTarget() });
    const input = new InputController({
      target: target as unknown as Window,
      canvas: new EventTarget() as unknown as HTMLCanvasElement,
      store: spy,
      rig: {} as CameraRig,
    });
    const press = (code: string, key: string): Event => {
      const event = Object.assign(new Event('keydown', { cancelable: true }), {
        code,
        key,
        shiftKey: false,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        repeat: false,
        isComposing: false,
      });
      target.dispatchEvent(event);
      return event;
    };
    return { press, dispatched, dispose: () => input.dispose() };
  }

  it('neither dispatches nor prevents the default for any key', () => {
    const { press, dispatched, dispose } = harness(withPanel(BASE, { kind: 'robot', robotId: 1, mode: 'bench' }));
    for (const [code, key] of [
      ['KeyW', 'w'],
      ['Space', ' '],
      ['KeyE', 'e'],
      ['Enter', 'Enter'],
      ['Escape', 'Escape'],
      ['KeyI', 'i'],
      ['KeyP', 'p'],
      ['Digit1', '1'],
      ['Tab', 'Tab'],
    ] as const) {
      expect(press(code, key).defaultPrevented).toBe(false);
    }
    expect(dispatched).toEqual([]);
    dispose();
  });

  it('still handles keys with no panel open', () => {
    const { press, dispatched, dispose } = harness(BASE);
    expect(press('KeyP', 'p').defaultPrevented).toBe(true);
    expect(dispatched).toEqual([actions.setPaused(true)]);
    dispose();
  });
});
```

In `tests/panelKeys.test.ts`, append at the end of the file:

```ts
describe('the robot screen owns the keyboard (part 3 spec §4.1)', () => {
  const withPanel = (panel: GameState['ui']['panel']): GameState => deepFreeze({ ...BASE, ui: { ...BASE.ui, panel } });
  const BENCH = withPanel({ kind: 'robot', robotId: 1, mode: 'bench' });
  const PEEK = withPanel({ kind: 'robot', robotId: 1, mode: 'peek' });
  const CODES = ['KeyE', 'KeyK', 'Enter', 'NumpadEnter', 'KeyI', 'KeyB', 'Escape', 'KeyW', 'Space', 'KeyP'];

  it.each(CODES)('%s is not a panel key while a robot panel is open', (code) => {
    for (const state of [BENCH, PEEK]) {
      expect(panelKeyCommand(code, state)).toBeNull();
      expect(panelKeyCommand(code, state, true)).toBeNull();
    }
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run tests/robotScreen.test.ts tests/panelKeys.test.ts`
Expected: FAIL. `tests/robotScreen.test.ts` fails to load: `Error: Cannot find module '../src/ui/robotScreen/viewModel'`. In `tests/panelKeys.test.ts` the new cases fail (`expected { type: 'player/interact' } to be null`, `expected { type: 'ui/closePanel' } to be null`, …); the existing cases pass.

- [ ] **Step 3: Implement**

**3a. `src/state/actions.ts`.** In the type import, add `MessageTone`:

```ts
import type { CraftingRecipeId, Direction, GameState, MdCard, MessageTone, RobotProgram, SeedItemId, SlotRef } from '../core/types';
```

(Keep any names Tasks 2–9 added to that import; only `MessageTone` is new.) In the `GameAction` union, directly after the `| { readonly type: 'ui/closePanel' }` member, add:

```ts
  /** A toast from the UI itself, e.g. when the robot screen fails to load (part 3 spec §4.1). */
  | { readonly type: 'ui/notify'; readonly text: string; readonly tone: MessageTone }
```

In the `actions` object, directly after `closePanel: (): GameAction => ({ type: 'ui/closePanel' }),`, add:

```ts
  notify: (text: string, tone: MessageTone): GameAction => ({ type: 'ui/notify', text, tone }),
```

**3b. `src/state/reducer.ts`.** Directly after the two lines

```ts
    case 'ui/closePanel':
      return state.ui.panel.kind === 'none' ? state : { ...state, ui: { ...state.ui, panel: { kind: 'none' } } };
```

add:

```ts
    case 'ui/notify':
      return pushMessage(state, action.text, action.tone);
```

(`pushMessage` is already imported from `./messages`.)

**3c. `src/input/panelKeys.ts`.** In the module comment, after the line ` *   Escape         closes any open panel, otherwise drops a zone draft, otherwise toggles pause` (Task 9 reworded it) add the line, before the ` *` / `markerToolCommand` lines:

```ts
 *   (none)         while a robot screen is open: it owns the keyboard (part 3 spec §4.1)
```

Make this the first statement of `panelKeyCommand`'s body (before `const panel = state.ui.panel.kind;` or whatever line Tasks 8 and 9 left first):

```ts
  // The robot screen handles its own keys, Escape included; no key is a game key while it's open.
  if (state.ui.panel.kind === 'robot') return null;
```

**3d. `src/input/InputController.ts`.** In `onKeyDown`, directly before the line `if (event.defaultPrevented || event.isComposing) return;`, insert:

```ts
    // The robot screen owns the keyboard (part 3 spec §4.1): Blockly, its fields and the screen
    // get every key, so nothing is dispatched and no default is prevented.
    if (this.store.getState().ui.panel.kind === 'robot') return;
```

The Shift bookkeeping above it (including Task 8's `onShiftChange`) stays first, so Shift still tracks while the screen is open. In the module comment, under "Focus etiquette", add the bullet:

```ts
 * - While a robot screen is open every key is left to it (part 3 spec §4.1).
```

**3e. `src/ui/hud.css`.** Replace the first token selector:

```css
.hud {
  --hud-cream: #fff8ea;
```

with:

```css
.hud,
.robot-screen,
.robot-screen-loading {
  --hud-cream: #fff8ea;
```

(The rest of that rule is unchanged: the robot screen and its loading card share every `--hud-*` token, so `.hud-btn`, `.hud-iconbtn` and the palette work inside them.) Then append to the end of `hud.css`:

```css

/* -------------------------------------------------------------------------------------------
 * Robot screen loading card (RobotScreenHost.ts). It shows before the screen's lazy stylesheet
 * arrives, so it lives here.
 * ----------------------------------------------------------------------------------------- */

.robot-screen-loading {
  position: absolute;
  inset: 0;
  z-index: 30;
  display: grid;
  place-items: center;
  padding: var(--hud-gutter);
  background: var(--hud-scrim);
  color: var(--hud-ink);
  font-family: var(--font-ui);
  pointer-events: auto;
}

.robot-screen-loading[hidden] {
  display: none;
}

.robot-screen-loading__card {
  padding: 14px 24px;
  border: 3px solid var(--hud-wood);
  border-radius: var(--hud-radius);
  background: var(--hud-cream);
  box-shadow:
    0 4px 0 var(--hud-wood-dark),
    0 10px 24px var(--hud-shadow-soft);
  font-size: 18px;
  font-weight: 600;
}
```

**3f. Create `src/ui/RobotScreenHost.ts`:**

```ts
/**
 * Opens the robot screen (farmclaws part 3 spec §4.1). The host lives in the main chunk; the
 * screen itself (src/ui/robotScreen/) is one dynamic import, made the first time a robot panel
 * opens, so the screen's code, and the Blockly editor it loads in turn, stay out of the game's
 * first download.
 *
 * - While the module loads, a card says "Opening…".
 * - When the import fails, the panel closes with a warning toast and the robot is untouched.
 *   The failed attempt is forgotten, so the next robot panel tries again.
 * - It dispatches only from the import's promise callbacks, never from sync.
 */
import type { Store } from '../core/store';
import type { GameState } from '../core/types';
import { actions, type GameAction } from '../state/actions';
import { h, setHidden } from './dom';
import type { RobotScreen } from './robotScreen/RobotScreen';

export interface RobotScreenHostOptions {
  /** The HUD root (#hud); the screen and its loading card are appended to it. */
  readonly root: HTMLElement;
  readonly store: Store<GameState, GameAction>;
}

const LOADING_TEXT = 'Opening…';
const LOAD_FAILED_TEXT = "The robot screen couldn't load. Try again.";

export class RobotScreenHost {
  private readonly root: HTMLElement;
  private readonly store: Store<GameState, GameAction>;
  private readonly loading = h('div', 'robot-screen-loading');
  private screen: RobotScreen | null = null;
  /** True while the import is in flight. */
  private importing = false;
  /** True while the screen shows a robot panel. */
  private showing = false;
  private disposed = false;

  constructor(options: RobotScreenHostOptions) {
    this.root = options.root;
    this.store = options.store;
    this.loading.hidden = true;
    this.loading.setAttribute('role', 'status');
    this.loading.append(h('div', 'robot-screen-loading__card', LOADING_TEXT));
    this.root.append(this.loading);
  }

  sync(state: GameState, prev: GameState | null): void {
    if (this.disposed) return;
    if (state.ui.panel.kind !== 'robot') {
      setHidden(this.loading, true);
      if (this.showing) {
        this.showing = false;
        this.screen?.close();
      }
      return;
    }
    const screen = this.screen;
    if (screen === null) {
      setHidden(this.loading, false);
      this.load();
      return;
    }
    if (!this.showing || prev === null) {
      this.showing = true;
      screen.open(state);
      return;
    }
    screen.sync(state, prev);
  }

  dispose(): void {
    this.disposed = true;
    this.screen?.dispose();
    this.screen = null;
    this.loading.remove();
  }

  private load(): void {
    if (this.importing) return;
    this.importing = true;
    import('./robotScreen/RobotScreen').then(
      ({ RobotScreen: Screen }) => {
        this.importing = false;
        if (this.disposed) return;
        const screen = new Screen({ root: this.root, store: this.store });
        this.screen = screen;
        setHidden(this.loading, true);
        const state = this.store.getState();
        if (state.ui.panel.kind === 'robot') {
          this.showing = true;
          screen.open(state);
        }
      },
      () => {
        this.importing = false;
        if (this.disposed) return;
        setHidden(this.loading, true);
        if (this.store.getState().ui.panel.kind !== 'robot') return;
        this.store.dispatch(actions.closePanel());
        this.store.dispatch(actions.notify(LOAD_FAILED_TEXT, 'warn'));
      },
    );
  }
}
```

**3g. Create `src/ui/robotScreen/viewModel.ts`:**

```ts
/**
 * Pure view models for the robot screen (farmclaws part 3 spec §4): the header, the tabs each
 * mode shows, the switch, the Stats and Log rows, and the prompts. No DOM, so
 * tests/robotScreen.test.ts covers every rule here; RobotScreen.ts and the tabs only draw what
 * these return.
 */
import { ROBOT_CARE, ROBOT_PAINTS, ROBOT_SCREEN } from '../../config';
import {
  ROBOT_TABS,
  type GameState,
  type Robot,
  type RobotPartId,
  type RobotPower,
  type RobotSize,
  type RobotTab,
  type RobotUnlocks,
} from '../../core/types';
import { robotSays, whatHappened } from '../../robots/logText';
import { batteryFor, scrapValue } from '../../robots/stats';
import { formatClock } from '../../time/clock';

/** Bench mode edits the robot; peek mode only reads its Stats and Log (spec §2.3). */
export type RobotScreenMode = 'bench' | 'peek';

const numberFormat = new Intl.NumberFormat('en-US');
const perCropFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });

export const SIZE_LABELS: Readonly<Record<RobotSize, string>> = { mini: 'Mini', standard: 'Standard', big: 'Big' };

export const PART_LABELS: Readonly<Record<RobotPartId, string>> = {
  claw: 'Claw',
  wateringHead: 'Watering head',
  tiller: 'Tiller',
  seeder: 'Seeder',
  basket: 'Basket',
  antenna: 'Antenna',
  sensorEye: 'Sensor eye',
  efficientCore: 'Efficient core',
  quickCore: 'Quick core',
};

export const POWER_LABELS: Readonly<Record<RobotPower, string>> = {
  working: 'Working',
  standby: 'Standing by',
  flat: 'Flat',
  broken: 'Shorted out',
  repairing: 'Getting a new core',
  ruined: 'Ruined',
};

export const TAB_LABELS: Readonly<Record<RobotTab, string>> = {
  program: 'Program',
  md: '.MD',
  looks: 'Looks',
  stats: 'Stats',
  log: 'Log',
};

/** Shown when a mode has no unlocked tab (peeking before the Log is unlocked). */
export const EMPTY_TABS_TEXT = 'Nothing to show yet.';

export const LOG_TEXT = {
  empty: 'Nothing yet today.',
  yesterday: 'Yesterday',
} as const;

/** Tabs that edit the robot: read-only for a ruined robot (spec §3.2). */
const EDIT_TABS: ReadonlySet<RobotTab> = new Set<RobotTab>(['program', 'md', 'looks']);

/** Tabs a peek may show (spec §2.3). */
const PEEK_TABS: ReadonlySet<RobotTab> = new Set<RobotTab>(['stats', 'log']);

export interface HeaderView {
  readonly name: string;
  readonly sizeLabel: string;
  readonly parts: readonly RobotPartId[];
  /** "{tokens} / {battery} tokens". */
  readonly tokens: string;
  readonly power: string;
  /** "Switched off", "Off until morning", or null while the robot isn't off. */
  readonly offText: string | null;
}

function offText(off: Robot['off']): string | null {
  switch (off) {
    case null:
      return null;
    case 'player':
      return 'Switched off';
    case 'dizzy':
    case 'done':
      return 'Off until morning';
  }
}

export function headerView(robot: Robot): HeaderView {
  return {
    name: robot.name,
    sizeLabel: SIZE_LABELS[robot.size],
    parts: robot.parts,
    tokens: `${numberFormat.format(robot.tokens)} / ${numberFormat.format(batteryFor(robot.size))} tokens`,
    power: POWER_LABELS[robot.power],
    offText: offText(robot.off),
  };
}

export interface SwitchView {
  /** The button's text. */
  readonly label: 'On' | 'Off';
  /** What pressing it asks for: `switchRobot { on }`. */
  readonly on: boolean;
}

/** Powers the reducer lets the player switch off (a broken, repairing or ruined robot is refused). */
const SWITCHABLE: ReadonlySet<RobotPower> = new Set<RobotPower>(['working', 'standby', 'flat']);

/**
 * The bench's on/off switch (spec §2.4): "On" when the player switched the robot off, otherwise
 * "Off" whatever `off` is, but only for a power the reducer can switch off (working, standby or
 * flat). Hidden in peek mode, so a ruined robot never shows it (spec §3.2).
 */
export function switchView(robot: Robot, mode: RobotScreenMode): SwitchView | null {
  if (mode !== 'bench') return null;
  if (robot.off === 'player') return { label: 'On', on: true };
  return SWITCHABLE.has(robot.power) ? { label: 'Off', on: false } : null;
}

/** The tabs a mode shows, in ROBOT_TABS order: each needs its unlock; peek shows only Stats and Log. */
export function visibleTabs(mode: RobotScreenMode, unlocks: RobotUnlocks): readonly RobotTab[] {
  return ROBOT_TABS.filter((tab) => unlocks.tabs.includes(tab) && (mode === 'bench' || PEEK_TABS.has(tab)));
}

export function isEditTab(tab: RobotTab): boolean {
  return EDIT_TABS.has(tab);
}

/** The note over a ruined robot's Program, .MD and Looks tabs (spec §3.2). */
export function ruinedNote(robot: Robot): string | null {
  return robot.power === 'ruined' ? `${robot.name} is ruined. It can only be scrapped.` : null;
}

export interface StatsRow {
  readonly label: string;
  readonly today: string;
  readonly week: string;
}

function perCrop(tokens: number, crops: number): string {
  return crops === 0 ? '—' : perCropFormat.format(tokens / crops);
}

/** The Stats tab's rows (spec §4.5): two columns, Today and This week. */
export function statsRows(robot: Robot): readonly StatsRow[] {
  const { today, week } = robot.stats;
  const count = (n: number): string => numberFormat.format(n);
  return [
    { label: 'Tokens used', today: count(today.tokens), week: count(week.tokens) },
    { label: 'Actions taken', today: count(today.actions), week: count(week.actions) },
    { label: 'Crops handled', today: count(today.crops), week: count(week.crops) },
    { label: 'Tokens per crop', today: perCrop(today.tokens, today.crops), week: perCrop(week.tokens, week.crops) },
  ];
}

/** A log time, to the exact minute: "9:40 am". */
export function formatClockMinute(minute: number): string {
  return formatClock(minute, 1);
}

export interface LogRow {
  /** The log entry's id (a stable key). */
  readonly id: number;
  readonly time: string;
  readonly says: string;
  readonly happened: string;
  readonly count: number;
  /** True for yesterday's entries, false for today's. */
  readonly yesterday: boolean;
}

/** The Log tab's rows (spec §4.6): one robot's entries from today and yesterday, newest first. */
export function logRows(state: GameState, robotId: number): readonly LogRow[] {
  const today = state.time.absoluteDay;
  const names = new Map(state.robots.list.map((robot) => [robot.id, robot.name] as const));
  const entries = state.robots.log.entries;
  const rows: LogRow[] = [];
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry === undefined || entry.robotId !== robotId) continue;
    if (entry.day !== today && entry.day !== today - 1) continue;
    rows.push({
      id: entry.id,
      time: formatClockMinute(entry.minute),
      says: robotSays(entry),
      happened: whatHappened(entry, names),
      count: entry.count,
      yesterday: entry.day !== today,
    });
  }
  return rows;
}

/** "×{count}" on a merged entry, nothing on a single one. */
export function countText(count: number): string {
  return count > 1 ? `×${count}` : '';
}

/** Asked before Escape, the close button or Lift off throws away unsaved Program or .MD edits (spec §4.1). */
export function discardPrompt(name: string): string {
  return `Discard your changes to ${name}'s program?`;
}

/** Asked before scrapping (spec §3.3). The gold is a plain number, like the "Scrapped {name} for {gold}g." toast. */
export function scrapPrompt(robot: Robot): string {
  return `Scrap ${robot.name} for ${scrapValue(robot)}g? This can't be undone.`;
}

/** The Looks tab's button (spec §3.4). */
export function paintButtonText(): string {
  return `Paint · ${numberFormat.format(ROBOT_CARE.paintCost)}g`;
}

/** A ROBOT_PAINTS colour as CSS. */
export function paintHex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

/** A paint's name, or '' for an index outside ROBOT_PAINTS. */
export function paintName(index: number): string {
  return ROBOT_PAINTS[index]?.name ?? '';
}

/** The media query for the phone layout: narrower than ROBOT_SCREEN.phoneMaxWidth (spec §4.1). */
export function phoneQuery(): string {
  return `(max-width: ${ROBOT_SCREEN.phoneMaxWidth - 0.02}px)`;
}
```

**3h. Create `src/ui/robotScreen/partIcons.ts`:**

```ts
/**
 * Small SVG drawings for the robot screen: one icon per robot part (the header's part chips)
 * and the Looks tab's robot preview. Built with createElementNS; nothing is parsed.
 */
import type { RobotPartId } from '../../core/types';
import { paintHex } from './viewModel';

const SVG_NS = 'http://www.w3.org/2000/svg';
const OUTLINE = '#5a3d2b';

type Shape = readonly [tag: 'path' | 'circle' | 'rect', attrs: Readonly<Record<string, string>>];

/** Line drawings on a 24 × 24 grid, stroked in currentColor. */
const PART_SHAPES: Readonly<Record<RobotPartId, readonly Shape[]>> = {
  claw: [
    ['path', { d: 'M7 3v6a5 5 0 0 0 10 0V3' }],
    ['path', { d: 'M12 14v7' }],
    ['path', { d: 'M9 21h6' }],
  ],
  wateringHead: [
    ['path', { d: 'M5 9h9v8a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z' }],
    ['path', { d: 'M14 11l5-5' }],
    ['path', { d: 'M20 12c1 1.4 1.5 2.2 1.5 3a1.5 1.5 0 0 1-3 0c0-.8.5-1.6 1.5-3z' }],
  ],
  tiller: [
    ['path', { d: 'M4 5h16' }],
    ['path', { d: 'M7 5v11' }],
    ['path', { d: 'M12 5v14' }],
    ['path', { d: 'M17 5v11' }],
  ],
  seeder: [
    ['path', { d: 'M12 3c4 3.5 4 10 0 15c-4-5-4-11.5 0-15z' }],
    ['path', { d: 'M12 8v13' }],
  ],
  basket: [
    ['path', { d: 'M3 10h18l-2.5 9h-13z' }],
    ['path', { d: 'M8 10a4 4 0 0 1 8 0' }],
    ['path', { d: 'M9 13v3M15 13v3' }],
  ],
  antenna: [
    ['path', { d: 'M12 21V10' }],
    ['circle', { cx: '12', cy: '8', r: '2' }],
    ['path', { d: 'M7.5 4.5a6 6 0 0 0 0 7' }],
    ['path', { d: 'M16.5 4.5a6 6 0 0 1 0 7' }],
  ],
  sensorEye: [
    ['path', { d: 'M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12z' }],
    ['circle', { cx: '12', cy: '12', r: '3' }],
  ],
  efficientCore: [
    ['circle', { cx: '12', cy: '12', r: '9' }],
    ['path', { d: 'M8.5 15.5c0-4.5 2.5-7 7-7c0 4.5-2.5 7-7 7z' }],
  ],
  quickCore: [
    ['circle', { cx: '12', cy: '12', r: '9' }],
    ['path', { d: 'M13 6l-4 7h4l-2 5 5-7h-4z' }],
  ],
};

function svgNode<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Readonly<Record<string, string>>): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag) as SVGElementTagNameMap[K];
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  return node;
}

/** A part's icon, decorative (the chip around it carries the label). */
export function createPartIcon(part: RobotPartId): SVGSVGElement {
  const svg = svgNode('svg', {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '2',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
  });
  for (const [tag, attrs] of PART_SHAPES[part]) svg.append(svgNode(tag, attrs));
  return svg;
}

export interface RobotPreview {
  readonly element: SVGSVGElement;
  /** Fills the painted shell (head and body) with a ROBOT_PAINTS colour. */
  paint(color: number): void;
}

/** The Looks tab's little robot: head and body take the paint; trim, eyes and wheels keep theirs. */
export function createRobotPreview(): RobotPreview {
  const svg = svgNode('svg', { viewBox: '0 0 64 64', class: 'rs-robot-preview', role: 'img', 'aria-label': 'Paint preview' });
  const line = { stroke: OUTLINE, 'stroke-width': '2' };
  const head = svgNode('rect', { x: '18', y: '10', width: '28', height: '20', rx: '6', ...line });
  const body = svgNode('rect', { x: '14', y: '32', width: '36', height: '22', rx: '6', ...line });
  svg.append(
    svgNode('path', { d: 'M32 10V5', stroke: OUTLINE, 'stroke-width': '2.5', 'stroke-linecap': 'round' }),
    svgNode('circle', { cx: '32', cy: '4', r: '2.5', fill: '#ffd866', stroke: OUTLINE, 'stroke-width': '1.5' }),
    svgNode('circle', { cx: '21', cy: '56', r: '5', fill: '#5e6670', ...line }),
    svgNode('circle', { cx: '43', cy: '56', r: '5', fill: '#5e6670', ...line }),
    body,
    svgNode('rect', { x: '24', y: '38', width: '16', height: '8', rx: '2', fill: 'rgba(255, 255, 255, 0.45)' }),
    head,
    svgNode('rect', { x: '22', y: '15', width: '20', height: '9', rx: '4', fill: '#3d2f52' }),
    svgNode('circle', { cx: '27', cy: '19.5', r: '2', fill: '#7fd3ff' }),
    svgNode('circle', { cx: '37', cy: '19.5', r: '2', fill: '#7fd3ff' }),
  );
  const paint = (color: number): void => {
    const fill = paintHex(color);
    head.setAttribute('fill', fill);
    body.setAttribute('fill', fill);
  };
  return { element: svg, paint };
}
```

**3i. Create `src/ui/robotScreen/tabs/tabView.ts`:**

```ts
/**
 * What the robot screen gives each tab, and what each tab gives back (farmclaws part 3 spec §4).
 */
import type { GameState } from '../../../core/types';
import type { GameAction } from '../../../state/actions';
import type { RobotScreenMode } from '../viewModel';

export interface RobotTabContext {
  readonly robotId: number;
  readonly mode: RobotScreenMode;
  readonly dispatch: (action: GameAction) => void;
  /** The store's current state, for click handlers. */
  readonly getState: () => GameState;
  /** Aborted when the screen closes: every listener a tab adds is registered with it. */
  readonly signal: AbortSignal;
}

export interface RobotTabView {
  readonly element: HTMLElement;
  /** Draws the tab for the robot in `state`. Called once, when the tab is first shown. */
  open(state: GameState): void;
  /** Called on every store change while the screen is open. */
  sync(state: GameState, prev: GameState): void;
  /** The tab became visible (true) or hidden (false). */
  setActive(active: boolean): void;
  /** True while the tab holds edits that aren't saved. */
  isDirty(): boolean;
  /** Escape was pressed: true when the tab used it (closed a dropdown, menu or prompt). */
  handleEscape(): boolean;
  dispose(): void;
}
```

**3j. Create `src/ui/robotScreen/tabs/LooksTab.ts`:**

```ts
/**
 * The Looks tab (farmclaws part 3 spec §3.4, §4.4): 16 paint swatches, a preview of the chosen
 * colour on a small robot, and "Paint · {cost}g". The reducer decides the job (it refuses the
 * same colour and short gold with a toast). A ruined robot's swatches are read-only.
 */
import { ROBOT_PAINTS } from '../../../config';
import type { GameState, Robot } from '../../../core/types';
import { findRobot } from '../../../robots/world';
import { actions } from '../../../state/actions';
import { closestWithin, h, hudButton, setAttr, setHidden, setText } from '../../dom';
import { createRobotPreview } from '../partIcons';
import { paintButtonText, paintHex, paintName } from '../viewModel';
import type { RobotTabContext, RobotTabView } from './tabView';

export class LooksTab implements RobotTabView {
  readonly element = h('div', 'rs-looks');
  private readonly preview = createRobotPreview();
  private readonly chosen = h('p', 'rs-looks__name');
  private readonly current = h('p', 'rs-looks__current');
  private readonly grid = h('div', 'rs-looks__swatches');
  private readonly paintButton = hudButton('hud-btn hud-btn--primary rs-looks__paint', paintButtonText());
  private readonly swatches: HTMLButtonElement[] = [];
  private readonly context: RobotTabContext;
  private selected = 0;
  private shown: Robot | null = null;

  constructor(context: RobotTabContext) {
    this.context = context;
    const previewBox = h('div', 'rs-looks__preview');
    previewBox.append(this.preview.element, this.chosen, this.current);

    this.grid.setAttribute('role', 'group');
    this.grid.setAttribute('aria-label', 'Paint colours');
    ROBOT_PAINTS.forEach((paint, index) => {
      const swatch = hudButton('rs-swatch');
      swatch.style.setProperty('--swatch', paintHex(paint.color));
      swatch.dataset.paint = String(index);
      swatch.title = paint.name;
      swatch.setAttribute('aria-label', paint.name);
      swatch.setAttribute('aria-pressed', 'false');
      this.grid.append(swatch);
      this.swatches.push(swatch);
    });

    const side = h('div', 'rs-looks__side');
    side.append(h('h3', 'rs-looks__heading', 'Paint'), this.grid, this.paintButton);
    this.element.append(previewBox, side);

    const signal = context.signal;
    this.grid.addEventListener(
      'click',
      (event) => {
        const swatch = closestWithin(event, this.grid, 'button[data-paint]');
        if (!(swatch instanceof HTMLButtonElement) || swatch.disabled) return;
        this.select(Number(swatch.dataset.paint));
      },
      { signal },
    );
    this.paintButton.addEventListener(
      'click',
      () => {
        this.context.dispatch(actions.paintRobot(this.context.robotId, this.selected));
      },
      { signal },
    );
  }

  open(state: GameState): void {
    const robot = findRobot(state, this.context.robotId);
    if (robot === null) return;
    this.render(robot);
    this.select(robot.paint);
  }

  sync(state: GameState): void {
    const robot = findRobot(state, this.context.robotId);
    if (robot === null || robot === this.shown) return;
    if (this.shown !== null && robot.paint === this.shown.paint && robot.power === this.shown.power && robot.name === this.shown.name) {
      this.shown = robot;
      return;
    }
    this.render(robot);
  }

  setActive(): void {}

  isDirty(): boolean {
    return false;
  }

  handleEscape(): boolean {
    return false;
  }

  dispose(): void {}

  private render(robot: Robot): void {
    this.shown = robot;
    const readOnly = robot.power === 'ruined';
    for (const swatch of this.swatches) {
      if (swatch.disabled !== readOnly) swatch.disabled = readOnly;
      swatch.classList.toggle('is-current', Number(swatch.dataset.paint) === robot.paint);
    }
    setHidden(this.paintButton, readOnly);
    setText(this.current, `${robot.name} is painted ${paintName(robot.paint)}.`);
  }

  private select(index: number): void {
    const paint = ROBOT_PAINTS[index];
    if (paint === undefined) return;
    this.selected = index;
    for (const swatch of this.swatches) setAttr(swatch, 'aria-pressed', String(Number(swatch.dataset.paint) === index));
    this.preview.paint(paint.color);
    setText(this.chosen, paint.name);
  }
}
```

**3k. Create `src/ui/robotScreen/tabs/StatsTab.ts`:**

```ts
/**
 * The Stats tab (farmclaws part 3 spec §4.5): tokens used, actions taken, crops handled and
 * tokens per crop, Today beside This week.
 */
import type { GameState, Robot } from '../../../core/types';
import { findRobot } from '../../../robots/world';
import { h } from '../../dom';
import { statsRows } from '../viewModel';
import type { RobotTabContext, RobotTabView } from './tabView';

export class StatsTab implements RobotTabView {
  readonly element = h('div', 'rs-stats');
  private readonly rows = h('tbody', '');
  private readonly robotId: number;
  private shown: Robot['stats'] | null = null;

  constructor(context: RobotTabContext) {
    this.robotId = context.robotId;
    const table = h('table', 'rs-stats__table');
    const head = h('thead', '');
    const headRow = h('tr', '');
    const corner = h('th', '');
    corner.scope = 'col';
    const today = h('th', '', 'Today');
    today.scope = 'col';
    const week = h('th', '', 'This week');
    week.scope = 'col';
    headRow.append(corner, today, week);
    head.append(headRow);
    table.append(head, this.rows);
    this.element.append(table);
  }

  open(state: GameState): void {
    this.sync(state);
  }

  sync(state: GameState): void {
    const robot = findRobot(state, this.robotId);
    if (robot === null || robot.stats === this.shown) return;
    this.shown = robot.stats;
    this.rows.replaceChildren(
      ...statsRows(robot).map((row) => {
        const tr = h('tr', '');
        const label = h('th', '', row.label);
        label.scope = 'row';
        tr.append(label, h('td', '', row.today), h('td', '', row.week));
        return tr;
      }),
    );
  }

  setActive(): void {}

  isDirty(): boolean {
    return false;
  }

  handleEscape(): boolean {
    return false;
  }

  dispose(): void {}
}
```

**3l. Create `src/ui/robotScreen/tabs/LogTab.ts`:**

```ts
/**
 * The Log tab (farmclaws part 3 spec §4.6): "Robot says" beside "What happened", newest first,
 * today then yesterday, each row starting with its time and with ×{count} on merged entries.
 * With nothing today it says "Nothing yet today." above yesterday's rows.
 */
import type { GameState } from '../../../core/types';
import { h } from '../../dom';
import { LOG_TEXT, countText, logRows, type LogRow } from '../viewModel';
import type { RobotTabContext, RobotTabView } from './tabView';

export class LogTab implements RobotTabView {
  readonly element = h('div', 'rs-log');
  private readonly list = h('ol', 'rs-log__list');
  private readonly robotId: number;

  constructor(context: RobotTabContext) {
    this.robotId = context.robotId;
    const head = h('div', 'rs-log__head');
    head.setAttribute('aria-hidden', 'true');
    head.append(h('span', '', 'Time'), h('span', '', 'Robot says'), h('span', '', 'What happened'));
    this.element.append(head, this.list);
  }

  open(state: GameState): void {
    this.render(state);
  }

  sync(state: GameState, prev: GameState): void {
    if (
      state.robots.log === prev.robots.log &&
      state.robots.list === prev.robots.list &&
      state.time.absoluteDay === prev.time.absoluteDay
    ) {
      return;
    }
    this.render(state);
  }

  setActive(): void {}

  isDirty(): boolean {
    return false;
  }

  handleEscape(): boolean {
    return false;
  }

  dispose(): void {}

  private render(state: GameState): void {
    const rows = logRows(state, this.robotId);
    const today = rows.filter((row) => !row.yesterday);
    const yesterday = rows.filter((row) => row.yesterday);
    const items: HTMLElement[] = [];
    if (today.length === 0) items.push(h('li', 'rs-log__empty', LOG_TEXT.empty));
    items.push(...today.map((row) => this.rowItem(row)));
    if (yesterday.length > 0) {
      items.push(h('li', 'rs-log__day', LOG_TEXT.yesterday));
      items.push(...yesterday.map((row) => this.rowItem(row)));
    }
    this.list.replaceChildren(...items);
  }

  private rowItem(row: LogRow): HTMLElement {
    const item = h('li', 'rs-log__row');
    const says = h('span', 'rs-log__says', row.says);
    const count = countText(row.count);
    if (count !== '') says.append(h('span', 'rs-log__count', count));
    item.append(h('span', 'rs-log__time', row.time), says, h('span', 'rs-log__happened', row.happened));
    return item;
  }
}
```

**3m. Create `src/ui/robotScreen/RobotScreen.ts`:**

```ts
/**
 * The robot screen (farmclaws part 3 spec §4): a full-screen panel for one robot, in bench mode
 * (editable) or peek mode (Stats and Log only). It is loaded lazily by RobotScreenHost.
 *
 * - Header: the robot's name, size, part icons, tokens / battery, power and off text; in bench
 *   mode the On / Off switch, Lift off and Scrap. The close button is always there.
 * - Tabs: Program, .MD, Looks, Stats and Log in that order, each shown only when its unlock is in
 *   `robots.unlocks` and the mode allows it (viewModel.visibleTabs), and only when this build has
 *   a view for it (TAB_FACTORIES). A view is built the first time its tab is shown and kept until
 *   the screen closes, so switching tabs keeps edits.
 * - Keys: InputController ignores every key while a robot panel is open. The screen listens on
 *   the window in the capture phase, so it hears Escape before Blockly's own handlers (Blockly's
 *   widget container stops propagation). The active tab gets the first chance to use it (an open
 *   dropdown, menu or prompt closes); otherwise the screen closes, and only then is the event
 *   stopped, so InputController never turns it into a pause.
 * - Leaving with unsaved Program or .MD edits (Escape, the close button, Lift off) first asks
 *   "Discard your changes to {name}'s program?". Scrap asks its own question, which also
 *   discards edits.
 * - Phone width (under ROBOT_SCREEN.phoneMaxWidth) sets data-layout="phone": the tabs become a
 *   strip under the header and the active tab fills the rest of the screen.
 * - It dispatches only from DOM event handlers.
 */
import './robotScreen.css';
import type { Store } from '../../core/store';
import { ROBOT_TABS, type GameState, type Robot, type RobotTab } from '../../core/types';
import { findRobot } from '../../robots/world';
import { actions, type GameAction } from '../../state/actions';
import { closestWithin, h, hudButton, iconHost, setAttr, setHidden, setText, setTitle } from '../dom';
import { createBoltIcon, createCloseIcon } from '../icons';
import { createPartIcon } from './partIcons';
import { LogTab } from './tabs/LogTab';
import { LooksTab } from './tabs/LooksTab';
import { StatsTab } from './tabs/StatsTab';
import type { RobotTabContext, RobotTabView } from './tabs/tabView';
import {
  EMPTY_TABS_TEXT,
  PART_LABELS,
  TAB_LABELS,
  discardPrompt,
  headerView,
  isEditTab,
  phoneQuery,
  ruinedNote,
  scrapPrompt,
  switchView,
  visibleTabs,
  type RobotScreenMode,
} from './viewModel';

export interface RobotScreenOptions {
  readonly root: HTMLElement;
  readonly store: Store<GameState, GameAction>;
}

type TabFactory = (context: RobotTabContext) => RobotTabView;

/** The tab views this screen can show; a tab without one never shows. */
const TAB_FACTORIES: Partial<Record<RobotTab, TabFactory>> = {
  looks: (context) => new LooksTab(context),
  stats: (context) => new StatsTab(context),
  log: (context) => new LogTab(context),
};

/** One robot shown, from open() to close(). */
interface Session {
  readonly robotId: number;
  readonly mode: RobotScreenMode;
  readonly abort: AbortController;
  readonly context: RobotTabContext;
  readonly views: Map<RobotTab, RobotTabView>;
  active: RobotTab | null;
  /** The robot last drawn in the header. */
  shown: Robot | null;
}

function isRobotTab(value: string | undefined): value is RobotTab {
  return (ROBOT_TABS as readonly (string | undefined)[]).includes(value);
}

function stopKey(event: KeyboardEvent): void {
  event.preventDefault();
  event.stopPropagation();
}

let screenCount = 0;

export class RobotScreen {
  readonly element = h('div', 'robot-screen');
  private readonly card = h('div', 'rs-card');
  private readonly name = h('h2', 'rs-header__name');
  private readonly size = h('span', 'rs-tag rs-header__size');
  private readonly parts = h('span', 'rs-header__parts');
  private readonly tokensText = h('span', '');
  private readonly power = h('span', 'rs-tag rs-header__power');
  private readonly off = h('span', 'rs-tag rs-header__off');
  private readonly benchActions = h('div', 'rs-header__actions');
  private readonly switchButton = hudButton('hud-btn hud-btn--soft rs-switch');
  private readonly liftButton = hudButton('hud-btn hud-btn--soft', 'Lift off');
  private readonly scrapButton = hudButton('hud-btn hud-btn--danger', 'Scrap');
  private readonly closeButton = hudButton('hud-iconbtn rs-close');
  private readonly tabStrip = h('div', 'rs-tabs');
  private readonly tabButtons = new Map<RobotTab, HTMLButtonElement>();
  private readonly note = h('p', 'rs-note rs-note--ruined');
  private readonly body = h('div', 'rs-body');
  private readonly empty = h('p', 'rs-empty', EMPTY_TABS_TEXT);
  private readonly dialog = h('div', 'rs-dialog');
  private readonly dialogText = h('p', 'rs-dialog__text');
  private readonly dialogYes = hudButton('hud-btn hud-btn--danger');
  private readonly dialogNo = hudButton('hud-btn hud-btn--soft');
  private readonly store: Store<GameState, GameAction>;
  /** Aborted on dispose: the screen's own listeners. */
  private readonly lifetime = new AbortController();
  private readonly phone: MediaQueryList | null;
  private session: Session | null = null;
  private onDialogYes: (() => void) | null = null;

  constructor(options: RobotScreenOptions) {
    screenCount += 1;
    this.store = options.store;
    const titleId = `robot-screen-${screenCount}-title`;
    const signal = this.lifetime.signal;

    this.element.hidden = true;
    this.element.setAttribute('role', 'dialog');
    this.element.setAttribute('aria-modal', 'true');
    this.element.setAttribute('aria-labelledby', titleId);
    this.name.id = titleId;
    this.card.tabIndex = -1;

    const identity = h('div', 'rs-header__id');
    identity.append(this.name, this.size, this.parts);
    const tokens = h('span', 'rs-header__tokens');
    tokens.append(iconHost('rs-header__bolt', createBoltIcon()), this.tokensText);
    const status = h('div', 'rs-header__status');
    status.append(tokens, this.power, this.off);
    this.benchActions.append(this.switchButton, this.liftButton, this.scrapButton);
    this.closeButton.setAttribute('aria-label', 'Close the robot screen');
    this.closeButton.title = 'Close (Esc)';
    this.closeButton.append(createCloseIcon());
    const header = h('header', 'rs-header');
    header.append(identity, status, this.benchActions, this.closeButton);

    this.tabStrip.setAttribute('role', 'tablist');
    this.tabStrip.setAttribute('aria-label', 'Robot screen');
    for (const tab of ROBOT_TABS) {
      if (TAB_FACTORIES[tab] === undefined) continue;
      const button = hudButton('rs-tab', TAB_LABELS[tab]);
      button.dataset.tab = tab;
      button.hidden = true;
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-selected', 'false');
      this.tabStrip.append(button);
      this.tabButtons.set(tab, button);
    }

    this.note.hidden = true;
    this.empty.hidden = true;
    const main = h('div', 'rs-main');
    main.append(this.note, this.body, this.empty);
    this.card.append(header, this.tabStrip, main);

    const dialogCard = h('div', 'rs-dialog__card');
    dialogCard.setAttribute('role', 'alertdialog');
    dialogCard.setAttribute('aria-modal', 'true');
    const dialogActions = h('div', 'rs-dialog__actions');
    dialogActions.append(this.dialogNo, this.dialogYes);
    dialogCard.append(this.dialogText, dialogActions);
    this.dialog.hidden = true;
    this.dialog.append(dialogCard);

    this.element.append(h('div', 'rs-backdrop'), this.card, this.dialog);
    options.root.append(this.element);

    this.closeButton.addEventListener('click', () => this.leave(() => this.store.dispatch(actions.closePanel())), { signal });
    this.switchButton.addEventListener('click', () => this.onSwitch(), { signal });
    this.liftButton.addEventListener('click', () => this.onLiftOff(), { signal });
    this.scrapButton.addEventListener('click', () => this.onScrap(), { signal });
    this.tabStrip.addEventListener(
      'click',
      (event) => {
        const tab = closestWithin(event, this.tabStrip, 'button[data-tab]')?.dataset.tab;
        if (isRobotTab(tab)) this.activate(tab, this.store.getState());
      },
      { signal },
    );
    this.dialogYes.addEventListener(
      'click',
      () => {
        const confirmed = this.onDialogYes;
        this.closeDialog();
        confirmed?.();
      },
      { signal },
    );
    this.dialogNo.addEventListener('click', () => this.closeDialog(), { signal });

    this.phone = typeof window.matchMedia === 'function' ? window.matchMedia(phoneQuery()) : null;
    this.phone?.addEventListener('change', () => this.syncLayout(), { signal });
    this.syncLayout();
  }

  /** Shows the robot named by `state.ui.panel` (a robot panel), starting a fresh session. */
  open(state: GameState): void {
    const panel = state.ui.panel;
    if (panel.kind !== 'robot') return;
    this.endSession();
    const robot = findRobot(state, panel.robotId);
    if (robot === null) return;
    const abort = new AbortController();
    const context: RobotTabContext = {
      robotId: panel.robotId,
      mode: panel.mode,
      dispatch: (action) => {
        this.store.dispatch(action);
      },
      getState: () => this.store.getState(),
      signal: abort.signal,
    };
    this.session = { robotId: panel.robotId, mode: panel.mode, abort, context, views: new Map(), active: null, shown: null };
    window.addEventListener('keydown', this.onKeyDown, { capture: true, signal: abort.signal });
    this.element.dataset.mode = panel.mode;
    setHidden(this.benchActions, panel.mode !== 'bench');
    setHidden(this.element, false);
    this.syncHeader(robot);
    this.syncTabs(state);
    this.card.focus();
  }

  sync(state: GameState, prev: GameState): void {
    const session = this.session;
    const panel = state.ui.panel;
    if (session === null || panel.kind !== 'robot') return;
    if (panel.robotId !== session.robotId || panel.mode !== session.mode) {
      this.open(state);
      return;
    }
    const robot = findRobot(state, session.robotId);
    if (robot === null) return;
    if (robot !== session.shown) this.syncHeader(robot);
    if (state.robots.unlocks !== prev.robots.unlocks) this.syncTabs(state);
    for (const view of session.views.values()) view.sync(state, prev);
  }

  close(): void {
    this.closeDialog();
    this.endSession();
    setHidden(this.element, true);
  }

  dispose(): void {
    this.close();
    this.lifetime.abort();
    this.element.remove();
  }

  // -------------------------------------------------------------------------
  // Session
  // -------------------------------------------------------------------------

  private endSession(): void {
    const session = this.session;
    if (session === null) return;
    this.session = null;
    for (const view of session.views.values()) view.dispose();
    this.body.replaceChildren();
    session.abort.abort();
  }

  private robot(): Robot | null {
    const session = this.session;
    return session === null ? null : findRobot(this.store.getState(), session.robotId);
  }

  private isDirty(): boolean {
    const session = this.session;
    if (session === null) return false;
    for (const view of session.views.values()) if (view.isDirty()) return true;
    return false;
  }

  /** Runs `then` now, or after "Discard" when a tab holds unsaved edits. */
  private leave(then: () => void): void {
    const robot = this.robot();
    if (robot !== null && this.isDirty()) {
      this.ask(discardPrompt(robot.name), 'Discard', 'Keep editing', then);
      return;
    }
    then();
  }

  private onSwitch(): void {
    const session = this.session;
    const robot = this.robot();
    if (session === null || robot === null) return;
    const view = switchView(robot, session.mode);
    if (view !== null) this.store.dispatch(actions.switchRobot(robot.id, view.on));
  }

  private onLiftOff(): void {
    const robot = this.robot();
    if (robot === null) return;
    this.leave(() => this.store.dispatch(actions.liftOffBench(robot.id)));
  }

  private onScrap(): void {
    const robot = this.robot();
    if (robot === null) return;
    this.ask(scrapPrompt(robot), 'Scrap', 'Keep', () => this.store.dispatch(actions.scrapRobot(robot.id)));
  }

  // -------------------------------------------------------------------------
  // Keys
  // -------------------------------------------------------------------------

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || event.isComposing) return;
    if (!this.dialog.hidden) {
      stopKey(event);
      this.closeDialog();
      return;
    }
    const view = this.activeView();
    if (view !== null && view.handleEscape()) return;
    stopKey(event);
    if (!event.repeat) this.leave(() => this.store.dispatch(actions.closePanel()));
  };

  // -------------------------------------------------------------------------
  // Tabs
  // -------------------------------------------------------------------------

  private activeView(): RobotTabView | null {
    const session = this.session;
    if (session === null || session.active === null) return null;
    return session.views.get(session.active) ?? null;
  }

  private shownTabs(state: GameState): readonly RobotTab[] {
    const session = this.session;
    if (session === null) return [];
    return visibleTabs(session.mode, state.robots.unlocks).filter((tab) => TAB_FACTORIES[tab] !== undefined);
  }

  private syncTabs(state: GameState): void {
    const session = this.session;
    if (session === null) return;
    const tabs = this.shownTabs(state);
    for (const [tab, button] of this.tabButtons) setHidden(button, !tabs.includes(tab));
    if (session.active === null || !tabs.includes(session.active)) this.activate(tabs[0] ?? null, state);
  }

  private activate(tab: RobotTab | null, state: GameState): void {
    const session = this.session;
    if (session === null || (tab !== null && tab === session.active)) return;
    const previous = this.activeView();
    if (previous !== null) {
      previous.setActive(false);
      setHidden(previous.element, true);
    }
    session.active = tab;
    for (const [key, button] of this.tabButtons) {
      setAttr(button, 'aria-selected', String(key === tab));
      button.tabIndex = key === tab ? 0 : -1;
    }
    setHidden(this.empty, tab !== null);
    if (tab !== null) {
      let view = session.views.get(tab);
      if (view === undefined) {
        const factory = TAB_FACTORIES[tab];
        if (factory === undefined) return;
        view = factory(session.context);
        view.element.setAttribute('role', 'tabpanel');
        setHidden(view.element, true);
        session.views.set(tab, view);
        this.body.append(view.element);
        view.open(state);
      }
      setHidden(view.element, false);
      view.setActive(true);
    }
    this.syncNote();
  }

  // -------------------------------------------------------------------------
  // Header
  // -------------------------------------------------------------------------

  private syncHeader(robot: Robot): void {
    const session = this.session;
    if (session === null) return;
    session.shown = robot;
    const view = headerView(robot);
    setText(this.name, view.name);
    setText(this.size, view.sizeLabel);
    const partsKey = view.parts.join(' ');
    if (this.parts.dataset.parts !== partsKey) {
      this.parts.dataset.parts = partsKey;
      this.parts.replaceChildren(
        ...(view.parts.length === 0
          ? [h('span', 'rs-header__noparts', 'No parts')]
          : view.parts.map((part) => {
              const chip = h('span', 'rs-part');
              chip.title = PART_LABELS[part];
              chip.setAttribute('role', 'img');
              chip.setAttribute('aria-label', PART_LABELS[part]);
              chip.append(createPartIcon(part));
              return chip;
            })),
      );
    }
    setText(this.tokensText, view.tokens);
    setText(this.power, view.power);
    this.power.dataset.power = robot.power;
    setHidden(this.off, view.offText === null);
    setText(this.off, view.offText ?? '');
    const toggle = switchView(robot, session.mode);
    setHidden(this.switchButton, toggle === null);
    if (toggle !== null) {
      const label = `Switch ${robot.name} ${toggle.on ? 'on' : 'off'}`;
      setText(this.switchButton, toggle.label);
      setAttr(this.switchButton, 'aria-label', label);
      setTitle(this.switchButton, label);
    }
    this.syncNote();
  }

  /** The ruined note over the Program, .MD and Looks tabs of a ruined robot on the bench. */
  private syncNote(): void {
    const session = this.session;
    const robot = session?.shown ?? null;
    const text =
      session !== null && robot !== null && session.mode === 'bench' && session.active !== null && isEditTab(session.active)
        ? ruinedNote(robot)
        : null;
    setHidden(this.note, text === null);
    setText(this.note, text ?? '');
  }

  private syncLayout(): void {
    this.element.dataset.layout = this.phone?.matches === true ? 'phone' : 'wide';
  }

  // -------------------------------------------------------------------------
  // Confirmation
  // -------------------------------------------------------------------------

  private ask(text: string, yes: string, no: string, onYes: () => void): void {
    setText(this.dialogText, text);
    setText(this.dialogYes, yes);
    setText(this.dialogNo, no);
    this.onDialogYes = onYes;
    setHidden(this.dialog, false);
    this.dialogNo.focus();
  }

  private closeDialog(): void {
    this.onDialogYes = null;
    if (this.dialog.hidden) return;
    setHidden(this.dialog, true);
    if (this.session !== null) this.card.focus();
  }
}
```

**3n. Create `src/ui/robotScreen/robotScreen.css`.** It holds the styles for the shell and all five tabs, so Tasks 12 and 13 add no CSS.

```css
/*
 * The robot screen (src/ui/robotScreen/), loaded with the screen's lazy chunk. Colours are the
 * HUD's --hud-* tokens, which hud.css also declares on .robot-screen; the .hud-btn and
 * .hud-iconbtn button styles come from hud.css too.
 *
 * Layout: a full-screen card. Wide (data-layout="wide"): the header across the top, a tab rail
 * on the left, the active tab filling the rest. Phone (data-layout="phone", narrower than
 * ROBOT_SCREEN.phoneMaxWidth): no margins, the tabs a strip under the header.
 */

/* -------------------------------------------------------------------------------------------
 * Base
 * ----------------------------------------------------------------------------------------- */

.robot-screen {
  position: absolute;
  inset: 0;
  z-index: 30;
  display: grid;
  padding: var(--hud-gutter);
  color: var(--hud-ink);
  font-family: var(--font-ui);
  font-size: 14px;
  line-height: 1.35;
  pointer-events: auto;
  -webkit-font-smoothing: antialiased;
}

.robot-screen[hidden],
.robot-screen [hidden] {
  display: none !important;
}

.robot-screen h2,
.robot-screen h3,
.robot-screen h4,
.robot-screen p,
.robot-screen ul,
.robot-screen ol {
  margin: 0;
}

.robot-screen ul,
.robot-screen ol {
  padding: 0;
  list-style: none;
}

.robot-screen button {
  font: inherit;
  color: inherit;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.robot-screen input,
.robot-screen select {
  user-select: text;
}

.robot-screen button:focus-visible,
.robot-screen input:focus-visible,
.robot-screen select:focus-visible {
  outline: 3px solid var(--hud-focus);
  outline-offset: 2px;
}

/* While the screen is open, toasts sit bottom-centre above it so saves and refusals stay readable. */
#hud:has(> .robot-screen:not([hidden])) .hud-toasts {
  position: fixed;
  left: 50%;
  bottom: var(--hud-gutter);
  z-index: 31;
  width: min(380px, calc(100vw - 2 * var(--hud-gutter)));
  transform: translateX(-50%);
}

.rs-backdrop {
  position: absolute;
  inset: 0;
  background: var(--hud-scrim);
  backdrop-filter: blur(2px);
}

.rs-card {
  position: relative;
  display: grid;
  grid-template-columns: 150px minmax(0, 1fr);
  grid-template-rows: auto minmax(0, 1fr);
  grid-template-areas:
    'header header'
    'tabs main';
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border: 3px solid var(--hud-panel-edge);
  border-radius: var(--hud-radius);
  background: var(--hud-panel-bg);
  box-shadow:
    inset 0 0 0 2px var(--hud-cream-deep),
    0 4px 0 var(--hud-wood-dark),
    0 10px 24px var(--hud-shadow-soft);
  outline: none;
}

/* -------------------------------------------------------------------------------------------
 * Header
 * ----------------------------------------------------------------------------------------- */

.rs-header {
  grid-area: header;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 14px;
  padding: 12px 14px 10px;
  border-bottom: 2px solid var(--hud-line);
}

.rs-header__id {
  display: flex;
  flex: 1 1 auto;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 10px;
  min-width: 0;
}

.rs-header__name {
  font-size: 24px;
  font-weight: 700;
  line-height: 1.1;
  overflow-wrap: anywhere;
}

.rs-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 9px;
  border-radius: 999px;
  background: var(--hud-cream-deep);
  color: var(--hud-ink-soft);
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
}

.rs-header__parts {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 4px;
}

.rs-part {
  display: inline-grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border: 2px solid var(--hud-line);
  border-radius: 8px;
  background: var(--hud-parchment);
  color: var(--hud-wood-deep);
}

.rs-part svg {
  display: block;
  width: 18px;
  height: 18px;
}

.rs-header__noparts {
  color: var(--hud-ink-faint);
  font-size: 12px;
  font-weight: 600;
}

.rs-header__status {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.rs-header__tokens {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.rs-header__power[data-power='working'] {
  background: var(--hud-mint-wash);
  color: var(--hud-mint-deep);
}

.rs-header__power[data-power='standby'] {
  background: var(--hud-sky);
  color: var(--hud-ink);
}

.rs-header__power[data-power='flat'] {
  background: var(--hud-butter);
  color: var(--hud-ink);
}

.rs-header__power[data-power='broken'],
.rs-header__power[data-power='repairing'] {
  background: var(--hud-peach);
  color: var(--hud-ink);
}

.rs-header__power[data-power='ruined'] {
  background: var(--hud-rose);
  color: var(--hud-ink);
}

.rs-header__off {
  background: var(--hud-lilac);
  color: var(--hud-ink);
}

.rs-header__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.rs-switch {
  min-width: 56px;
}

/* -------------------------------------------------------------------------------------------
 * Tabs and body
 * ----------------------------------------------------------------------------------------- */

.rs-tabs {
  grid-area: tabs;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 10px;
  overflow-y: auto;
  border-right: 2px solid var(--hud-line);
  background: var(--hud-parchment);
}

.rs-tab {
  display: block;
  width: 100%;
  padding: 8px 12px;
  border: 2px solid transparent;
  border-radius: var(--hud-radius-sm);
  background: transparent;
  font-weight: 700;
  text-align: left;
  white-space: nowrap;
}

.rs-tab:hover {
  background: var(--hud-cream-deep);
}

.rs-tab[aria-selected='true'] {
  border-color: var(--hud-wood);
  background: var(--hud-cream);
  box-shadow: 0 3px 0 var(--hud-wood-dark);
}

.rs-main {
  grid-area: main;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.rs-body {
  position: relative;
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}

.rs-body > * {
  flex: 1;
  min-height: 0;
}

.rs-empty {
  padding: 24px;
  color: var(--hud-ink-soft);
  font-weight: 600;
  text-align: center;
}

.rs-note {
  margin: 10px 14px 0;
  padding: 8px 12px;
  border-left: 5px solid var(--hud-info);
  border-radius: 10px;
  background: var(--hud-cream-deep);
  font-weight: 600;
}

.rs-note--ruined {
  border-left-color: var(--hud-danger);
  background: var(--hud-peach-wash);
}

.rs-message {
  padding: 6px 14px;
  color: var(--hud-danger);
  font-weight: 600;
}

.rs-message:empty {
  display: none;
}

.rs-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  padding: 10px 14px;
  border-bottom: 2px dashed var(--hud-line);
}

.rs-toolbar__spacer {
  flex: 1;
}

.rs-counter {
  color: var(--hud-ink-soft);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.rs-counter.is-over {
  color: var(--hud-danger);
}

.rs-input {
  min-height: 32px;
  padding: 4px 8px;
  border: 2px solid var(--hud-wood-light);
  border-radius: 9px;
  background: var(--hud-cream);
  color: var(--hud-ink);
  font: inherit;
  font-weight: 600;
}

.rs-input[type='number'] {
  width: 76px;
}

.rs-input:disabled {
  opacity: 0.7;
}

.rs-popover {
  position: absolute;
  z-index: 80;
  display: grid;
  gap: 6px;
  padding: 10px;
  border: 2px solid var(--hud-wood);
  border-radius: var(--hud-radius-sm);
  background: var(--hud-cream);
  box-shadow:
    0 3px 0 var(--hud-wood-dark),
    0 8px 18px var(--hud-shadow-soft);
}

/* -------------------------------------------------------------------------------------------
 * Confirmation
 * ----------------------------------------------------------------------------------------- */

.rs-dialog {
  position: absolute;
  inset: 0;
  z-index: 2;
  display: grid;
  place-items: center;
  padding: var(--hud-gutter);
  background: var(--hud-scrim);
}

.rs-dialog__card {
  display: grid;
  gap: 14px;
  width: min(420px, 100%);
  padding: 18px 20px;
  border: 3px solid var(--hud-wood);
  border-radius: var(--hud-radius);
  background: var(--hud-cream);
  box-shadow:
    0 4px 0 var(--hud-wood-dark),
    0 10px 24px var(--hud-shadow-soft);
}

.rs-dialog__text {
  font-size: 16px;
  font-weight: 600;
}

.rs-dialog__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

/* -------------------------------------------------------------------------------------------
 * Looks
 * ----------------------------------------------------------------------------------------- */

.rs-looks {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-content: start;
  gap: 18px;
  padding: 16px;
  overflow: auto;
}

.rs-looks__preview {
  display: grid;
  justify-items: center;
  align-content: start;
  gap: 6px;
  min-width: 160px;
  padding: 12px;
  border: 2px solid var(--hud-line);
  border-radius: var(--hud-radius-sm);
  background: var(--hud-parchment);
}

.rs-robot-preview {
  display: block;
  width: 112px;
  height: 112px;
}

.rs-looks__name {
  font-size: 16px;
  font-weight: 700;
}

.rs-looks__current {
  color: var(--hud-ink-soft);
  font-size: 12px;
  text-align: center;
}

.rs-looks__side {
  display: grid;
  align-content: start;
  justify-items: start;
  gap: 14px;
}

.rs-looks__heading {
  color: var(--hud-ink-soft);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.rs-looks__swatches {
  display: grid;
  grid-template-columns: repeat(8, 36px);
  gap: 8px;
}

.rs-swatch {
  position: relative;
  width: 36px;
  height: 36px;
  padding: 0;
  border: 3px solid var(--hud-cream);
  border-radius: 50%;
  background: var(--swatch);
  box-shadow: 0 0 0 2px var(--hud-wood-light);
}

.rs-swatch.is-current::after {
  content: '';
  position: absolute;
  right: -4px;
  bottom: -4px;
  width: 12px;
  height: 12px;
  border: 2px solid var(--hud-cream);
  border-radius: 50%;
  background: var(--hud-mint-deep);
}

.rs-swatch[aria-pressed='true'] {
  box-shadow: 0 0 0 3px var(--hud-ink);
}

.rs-swatch:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

/* -------------------------------------------------------------------------------------------
 * Stats
 * ----------------------------------------------------------------------------------------- */

.rs-stats {
  padding: 14px;
  overflow: auto;
}

.rs-stats__table {
  width: 100%;
  max-width: 560px;
  border-collapse: collapse;
}

.rs-stats__table th,
.rs-stats__table td {
  padding: 8px 12px;
  border-bottom: 2px solid var(--hud-line);
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.rs-stats__table thead th {
  color: var(--hud-ink-soft);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.rs-stats__table tbody th {
  font-weight: 600;
  text-align: left;
}

.rs-stats__table td {
  font-weight: 700;
}

/* -------------------------------------------------------------------------------------------
 * Log
 * ----------------------------------------------------------------------------------------- */

.rs-log {
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 10px 14px 14px;
  overflow: auto;
}

.rs-log__head,
.rs-log__row {
  display: grid;
  grid-template-columns: 76px minmax(0, 1fr) minmax(0, 1.4fr);
  align-items: baseline;
  gap: 4px 14px;
}

.rs-log__head {
  padding: 4px 8px;
  color: var(--hud-ink-soft);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.rs-log__row {
  padding: 8px;
  border-bottom: 1px dashed var(--hud-line);
}

.rs-log__time {
  color: var(--hud-ink-soft);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.rs-log__says {
  font-weight: 600;
}

.rs-log__count {
  margin-left: 6px;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--hud-butter);
  font-size: 12px;
  font-weight: 700;
}

.rs-log__day {
  padding: 12px 8px 4px;
  color: var(--hud-ink-soft);
  font-weight: 700;
}

.rs-log__empty {
  padding: 10px 8px;
  color: var(--hud-ink-soft);
}

/* -------------------------------------------------------------------------------------------
 * Program
 * ----------------------------------------------------------------------------------------- */

.rs-program {
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.rs-program__blocks {
  display: none;
}

.rs-program__status {
  padding: 24px;
  color: var(--hud-ink-soft);
  font-weight: 600;
  text-align: center;
}

.rs-program__editor {
  position: relative;
  flex: 1;
  min-height: 240px;
}

.rs-program__categories {
  top: 56px;
  left: 14px;
  min-width: 180px;
}

.rs-program__category {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  font-weight: 700;
  text-align: left;
}

.rs-program__category:hover {
  background: var(--hud-cream-deep);
}

.rs-program__category::before {
  content: '';
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--dot);
}

.rs-program__varform {
  top: 56px;
  right: 14px;
  width: min(320px, calc(100% - 28px));
}

.rs-program__varform label {
  display: grid;
  gap: 4px;
  font-weight: 600;
}

.rs-program__varactions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

/* Blockly inside the screen: the game's font on the category labels, loose and failing blocks outlined. */
.rs-program .blocklyToolboxCategoryLabel {
  font-family: var(--font-ui);
  font-weight: 600;
}

.rs-program .blocklyHighlighted > .blocklyPath {
  stroke: var(--hud-danger);
  stroke-width: 4px;
}

/* -------------------------------------------------------------------------------------------
 * .MD
 * ----------------------------------------------------------------------------------------- */

.rs-md {
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.rs-md__add {
  top: 56px;
  left: 14px;
  min-width: 240px;
}

.rs-md__kind {
  padding: 6px 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  font-weight: 700;
  text-align: left;
}

.rs-md__kind:hover {
  background: var(--hud-cream-deep);
}

.rs-md__file {
  flex: 1;
  margin: 12px 14px 14px;
  padding: 14px 16px;
  overflow: auto;
  border: 2px solid var(--hud-line);
  border-radius: var(--hud-radius-sm);
  background: var(--hud-parchment);
  font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
}

.rs-md__title {
  font-size: 18px;
  font-weight: 700;
  overflow-wrap: anywhere;
}

.rs-md__section {
  margin-top: 14px;
  color: var(--hud-ink-soft);
  font-size: 15px;
  font-weight: 700;
}

.rs-md__cards {
  display: grid;
  gap: 6px;
  margin-top: 6px;
}

.rs-md__card {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-radius: 10px;
  background: var(--hud-cream);
}

.rs-md__bullet {
  color: var(--hud-wood-dark);
  font-weight: 700;
}

.rs-md__text {
  font-family: var(--font-ui);
  font-weight: 600;
}

.rs-md__card .rs-input {
  font-family: var(--font-ui);
}

.rs-md__tools {
  display: inline-flex;
  gap: 4px;
  margin-left: auto;
}

.rs-md__tool {
  display: inline-grid;
  place-items: center;
  width: 30px;
  height: 30px;
  padding: 0;
  border: 2px solid var(--hud-wood-light);
  border-radius: 8px;
  background: var(--hud-parchment);
  font-family: var(--font-ui);
  font-weight: 700;
}

.rs-md__tool:hover {
  background: var(--hud-cream-deep);
}

.rs-md__none {
  padding: 4px 8px;
  color: var(--hud-ink-faint);
  font-family: var(--font-ui);
}

/* -------------------------------------------------------------------------------------------
 * Phone width
 * ----------------------------------------------------------------------------------------- */

.robot-screen[data-layout='phone'] {
  padding: 0;
}

.robot-screen[data-layout='phone'] .rs-backdrop {
  display: none;
}

.robot-screen[data-layout='phone'] .rs-card {
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: auto auto minmax(0, 1fr);
  grid-template-areas:
    'header'
    'tabs'
    'main';
  border-width: 0;
  border-radius: 0;
  box-shadow: none;
}

.robot-screen[data-layout='phone'] .rs-header__name {
  font-size: 20px;
}

.robot-screen[data-layout='phone'] .rs-tabs {
  flex-direction: row;
  padding: 6px 8px;
  overflow-x: auto;
  border-right: 0;
  border-bottom: 2px solid var(--hud-line);
}

.robot-screen[data-layout='phone'] .rs-tab {
  flex: none;
  width: auto;
  text-align: center;
}

.robot-screen[data-layout='phone'] .rs-program__blocks {
  display: inline-flex;
}

.robot-screen[data-layout='phone'] .rs-looks {
  grid-template-columns: minmax(0, 1fr);
}

.robot-screen[data-layout='phone'] .rs-looks__swatches {
  grid-template-columns: repeat(8, minmax(0, 1fr));
  width: 100%;
}

.robot-screen[data-layout='phone'] .rs-swatch {
  width: 100%;
  height: auto;
  aspect-ratio: 1;
}

.robot-screen[data-layout='phone'] .rs-log__head {
  display: none;
}

.robot-screen[data-layout='phone'] .rs-log__row {
  grid-template-columns: 64px minmax(0, 1fr);
}

.robot-screen[data-layout='phone'] .rs-log__happened {
  grid-column: 2;
  color: var(--hud-ink-soft);
}

.robot-screen[data-layout='phone'] .rs-md__file {
  margin: 8px;
  padding: 10px;
}

@media (prefers-reduced-motion: reduce) {
  .robot-screen .hud-btn,
  .robot-screen .hud-iconbtn {
    transition: none;
  }
}
```

**3o. `src/main.ts`.** Add the import beside the `Hud` import:

```ts
import { RobotScreenHost } from './ui/RobotScreenHost';
```

Directly after the `const hud = new Hud({ … });` statement, add:

```ts
  const robotScreen = new RobotScreenHost({ root: hudRoot, store });
```

Directly after `hud.sync(initial, null);`, add:

```ts
  robotScreen.sync(initial, null);
```

In the store subscription, directly after `hud.sync(state, plan.hudPrev === 'null' ? null : prev);`, add:

```ts
    robotScreen.sync(state, prev);
```

In the returned disposer, directly after `hud.dispose();`, add:

```ts
    robotScreen.dispose();
```

- [ ] **Step 4: Run the tests and see them pass**

Run: `npx vitest run tests/robotScreen.test.ts tests/panelKeys.test.ts`
Expected: PASS (every case in both files).

- [ ] **Step 5: The full gate**

Run: `npm run typecheck && npm test && npm run build`
Expected: all green. The build lists a separate `RobotScreen-*.js` chunk and a `RobotScreen-*.css` file next to `index-*.js`; `grep -l "Nothing yet today" dist/assets/index-*.js` prints nothing (the screen's text lives only in its own chunk).

- [ ] **Step 6: Browser check**

Use the `game-driven-qa` skill: `preview_start {name: "meadowlight-dev"}`, navigate to `http://localhost:5173/?new`, load the probe (`await import('/.claude/skills/game-driven-qa/probe.js?t=' + Date.now()); __qa.snap()`). Then, in `javascript_tool`:

1. Hold time still and bench a robot through the real E path (setup teleports the player; the presses are real keys):
   ```js
   __meadowlight.store.dispatch(__meadowlight.actions.setTimeScale(1));
   __meadowlight.addRobot('waterer', { tx: 6, tz: 6, facing: 2 });
   __qa.patch((s) => { s.player.tx = 6; s.player.tz = 7; s.player.facing = 0; });
   await __qa.key('KeyE');
   __qa.patch((s) => { s.player.tx = 6; s.player.tz = 5; s.player.facing = 0; });
   await __qa.key('KeyE');
   [__qa.state().ui.panel, document.querySelector('.robot-screen')?.hidden, document.querySelector('.robot-screen-loading')?.hidden]
   ```
   PASS when the panel is `{ kind: 'robot', robotId: 1, mode: 'bench' }`, the screen is visible (`false`) and the loading card is hidden (`true`). If `addRobot` answers with a refusal, pick another clear grass tile beside the yard with `await __qa.tile(tx, tz, 'farm')` and use it in both places.
2. Header: `document.querySelector('.rs-header').innerText` contains "Drizzle", "Mini", "80 / 80 tokens", "Working", "Off", "Lift off" and "Scrap". The tab strip shows "Looks" and "Log" only (`[...document.querySelectorAll('.rs-tab:not([hidden])')].map((b) => b.textContent)`; Program and .MD arrive in Tasks 12 and 13, Stats needs its unlock). Screenshot.
3. Keys stay in the screen: `const p = __qa.state().player; await __qa.key('KeyW', 120); await __qa.key('Space'); await __qa.key('KeyI'); [__qa.state().player.tx === p.tx && __qa.state().player.tz === p.tz, __qa.state().ui.panel.kind]` → `[true, 'robot']`.
4. Switch: click "Off" (`find` "Off", then `computer left_click`). The header shows "Switched off" and the button reads "On"; `__qa.robot('Drizzle').off === 'player'`. Click "On": `off` is `null` again.
5. Looks: click "Looks", click the "Sky" swatch: the preview turns blue and "Sky" shows under it. Click "Paint · 50g": the toast "Painted Drizzle Sky." shows bottom-centre above the screen, `__qa.robot('Drizzle').paint === 7`, and the gold dropped by 50.
6. Log: click "Log": rows show a time, "Robot says" and "What happened", or "Nothing yet today." on a fresh robot.
7. Stats appears with its unlock: `__meadowlight.unlockAll()` (the screen closes, because `unlockAll` reloads the state; press E at the bench to reopen it); the "Stats" tab now shows. Click it: two columns, "Today" and "This week", "Tokens per crop" reads "—".
8. Escape closes: `await __qa.key('Escape'); [__qa.state().ui.panel.kind, __qa.state().ui.paused]` → `['none', false]`. Press E at the bench (`await __qa.key('KeyE')`): the screen reopens.
9. Scrap prompt: click "Scrap": the dialog reads "Scrap Drizzle for 375g? This can't be undone." Press Escape: only the dialog closes (`__qa.state().ui.panel.kind === 'robot'`). Click "Scrap" then "Keep": nothing changes.
10. Peek: close the screen, `__meadowlight.addRobot('spinner', { tx: 8, tz: 8, facing: 2 })`, `__qa.patch((s) => { s.player.tx = 8; s.player.tz = 9; s.player.facing = 0; })`, `await __qa.key('KeyE', 60, { shiftKey: true })`. The screen opens with only "Stats" and "Log", no switch, no "Lift off", no "Scrap".
11. Phone: `resize_window {preset: "mobile"}`, reload without `?new`, reopen the bench screen (E at the bench). `document.querySelector('.robot-screen').dataset.layout === 'phone'`; the tabs are a strip under the header. Screenshot, then `resize_window {preset: "desktop"}`.
12. `read_console_messages {onlyErrors: true}` shows nothing.

Report one line per check (PASS / FAIL with the evidence).

- [ ] **Step 7: Commit**

```bash
git add src/state/actions.ts src/state/reducer.ts src/input/panelKeys.ts src/input/InputController.ts src/ui/hud.css src/main.ts src/ui/RobotScreenHost.ts src/ui/robotScreen/viewModel.ts src/ui/robotScreen/partIcons.ts src/ui/robotScreen/RobotScreen.ts src/ui/robotScreen/robotScreen.css src/ui/robotScreen/tabs/tabView.ts src/ui/robotScreen/tabs/LooksTab.ts src/ui/robotScreen/tabs/StatsTab.ts src/ui/robotScreen/tabs/LogTab.ts tests/robotScreen.test.ts tests/panelKeys.test.ts
git commit -m "Farmclaws part 3: the robot screen shell, with Looks, Stats and Log

RobotScreenHost lazily imports the screen the first time a robot panel opens,
shows Opening… meanwhile, and on a failed import closes the panel with a
ui/notify toast. While a robot panel is open, panelKeyCommand returns null and
InputController neither dispatches nor prevents defaults; the screen hears
Escape on the window in the capture phase, because Blockly's widget container
stops keydown propagation. The switch shows On for a player-off robot and Off
only for a working, standby or flat one. Tab views are built on first show
and kept until close, and tell the tab when it is shown (setActive), since
Blockly can only inject into a visible container. hud.css shares its tokens
with the screen and styles the loading card; toasts move above an open
screen.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: The Program tab

**Files:**
- Modify: `package.json`, `package-lock.json` (`blockly` in `dependencies`, through `npm install`)
- Create: `public/blockly-media/` (copied from `node_modules/blockly/media`, Step 1)
- Create: `src/ui/robotScreen/blockly/toolbox.ts` (pure: toolbox, dropdowns, editor text)
- Create: `src/ui/robotScreen/blockly/theme.ts`
- Create: `src/ui/robotScreen/blockly/blockDefs.ts`
- Create: `src/ui/robotScreen/tabs/ProgramTab.ts`
- Modify: `src/ui/robotScreen/RobotScreen.ts` (the import list and `TAB_FACTORIES`)
- Test: `tests/robotScreen.test.ts` (extend)

**Interfaces:**
- Consumes:
  - Task 10 (`src/ui/robotScreen/translate.ts`): `programToWorkspace(program: BlockProgram): BlocklyWorkspaceJson`, `workspaceToProgram(json): TranslationResult` (`{ program; loose }` or `{ error; blockId: string | null }`), `countWorkspaceBlocks(json): number`, `BLOCK_TYPES: readonly string[]` (55 types), `blockTypeFor(kind: BlockKind): readonly string[]`, `BlocklyWorkspaceJson`, `BlocklyBlockJson`. Field encodings: `MINUTE` / `MINUTES` are dropdowns holding `String(minute)`; `fc_yes.VALUE` is `'TRUE'` / `'FALSE'`; `NUM`, `X`, `Z` are number fields; `fc_set`, `fc_change`, `fc_var` use `VAR`; `fc_runHelper`, `fc_helper`, `fc_varDecl` use `NAME`; `fc_varDecl.TYPE` is a `ValueType`; triggers, `fc_helper` and `fc_varDecl` have no previous or next connection. Top-level blocks come at x 0, y = index × `ROBOT_SCREEN.stackGap`; this task re-spaces them by rendered height after loading.
  - Task 4: `BLOCK_KINDS`, `BLOCK_CATEGORY`, `BlockCategory` (`src/robots/blockKinds.ts`); `RobotUnlocks`; `UNLOCKS.job1`; `ALL_UNLOCKS`.
  - Task 2 / 5 / 7: `actions.programRobot(robotId, program)`; the reducer refuses a robot off the bench ("Put {name} on the workbench first.") or ruined, and toasts "Programmed {name}." on success.
  - Task 11: `RobotTabContext`, `RobotTabView` (with `setActive`), `TAB_FACTORIES`, `phoneQuery()`, the `.rs-program*` styles in `robotScreen.css`.
  - Part 2: `checkProgram(program, robot)` (`src/robots/check.ts`), `isProgramShape` (`src/state/robotValidation.ts`), `ITEMS`, `getItem`, `isItemId` (`src/items/items.ts`), `CROPS` (`src/farming/crops.ts`), `MAPS` (`src/world/maps`), `hasPart` (`src/robots/stats.ts`), `formatClock`; tests: `randomProgram` (`tests/programGen.ts`), `mulberry32` (`src/core/hash.ts`), `b` (`src/robots/blocks.ts`).
- Produces:
  - `package.json`: `"blockly": "^13.3.0"` in `dependencies` (13 is the package's current major).
  - `src/ui/robotScreen/blockly/toolbox.ts` (pure, no Blockly import):
    - `type MenuKind = 'minute' | 'every' | 'item' | 'crop' | 'zone' | 'var' | 'helper'`, `type DropdownKind = 'minute' | 'every' | 'item' | 'crop' | 'zone'`, `MENU_KINDS`, `menuFieldType(kind)` (`'field_fc_' + kind`);
    - `dropdownOptions(kind: DropdownKind, current: string | number | null): readonly [string, string][]` (always includes `current`; minute options every `ROBOT_SCREEN.timeStep` minutes from 6:00 am to 1:50 am; values are strings);
    - `nameOptions(names, current)`, `menuLabel(kind, value)`, `menuAccepts(kind, value): string | null`;
    - `BLOCK_CATEGORIES`, `CATEGORY_NAMES`, `categoryStyle(category)`, `ToolboxJson` / `ToolboxCategoryJson` / `ToolboxBlockJson`, `toolboxFor(robot: Pick<Robot, 'size' | 'parts'>, unlocks: RobotUnlocks): ToolboxJson`, `SENSOR_EYE_TYPES`, `NEEDS_SENSOR_EYE_REASON`, `NEEDS_SENSOR_EYE_TEXT` ("Needs a sensor eye");
    - `VALUE_CHECKS: Record<ValueType, string>` (`Number`, `Text`, `YesNo`, `Item`, `Tile`), `VALUE_TYPE_LABELS`, `isValueType`, `NewBlockState`, `defaultLiteral(type, robot)`, `declarationState(name, type, robot, x, y)`;
    - `counterView(used, limit, noun)`, `blockCounter(used, size)`, `variableCounter(n, size)`, `EDITOR_TEXT`, `scriptNote(name)`.
  - `src/ui/robotScreen/blockly/theme.ts`: `CATEGORY_COLOURS`, `createTheme(api: typeof Blockly): Blockly.Theme` (Zelos-ready, cream workspace, the game's font).
  - `src/ui/robotScreen/blockly/blockDefs.ts`: `BLOCK_DEFINITIONS: readonly BlockDefinitionJson[]` (pure data, one JSON definition per `BLOCK_TYPES` entry) and `defineBlocks(api: typeof Blockly): void` (registers the menu fields, the sensor-eye tooltip extension and the blocks; idempotent).
  - `src/ui/robotScreen/tabs/ProgramTab.ts`: `ProgramTab implements RobotTabView`; Save dispatches `actions.programRobot`.

Rules this task settles (recorded in the commit message):
- **Dropdowns never drop a value.** Blockly's `FieldDropdown` rejects any value that isn't among its cached options, so a loaded `atTime` 583 would silently become 6:00 am. Every dropdown whose value can be unusual is a registered subclass (`field_fc_minute`, `field_fc_every`, `field_fc_item`, `field_fc_crop`, `field_fc_zone`, `field_fc_var`, `field_fc_helper`) whose menu generator adds the current value, whose validation accepts any well-formed value of its kind (`menuAccepts`), and whose shown text comes from `menuLabel`. `field_fc_every` is a menu too, so `dropdownOptions` takes `'every'`, one of the contract's five kinds.
- **Loading doesn't count as an edit.** The saved program is loaded with Blockly's events disabled, then rendered, re-spaced (each top-level block `ROBOT_SCREEN.stackGap` below the previous one's bottom, in JSON order) and given its variable checks. "Unsaved edits" is any later non-UI workspace event; Save and Revert clear it.
- **Variables.** "Make a variable" opens an in-screen form (name, type) and adds an `fc_varDecl` holding the type's default literal at the top-left of the view. The listener keeps `fc_var`'s output check on its declaration's type, sets each declaration's `INITIAL` check, swaps the literal for the new type's default when a declaration's type changes, and renames `fc_var` / `fc_set` / `fc_change` (and `fc_runHelper` for helpers) when a declaration (or helper) is renamed.
- **Sensor eye.** Without one, `tileAheadIs`, `itIsRaining` and `timeIsAfter` come into the toolbox with the disabled reason `fc_needsSensorEye`, so they can't be dragged out, and an extension switches their tooltip to "Needs a sensor eye".
- **Phone.** Under the phone width the category column is hidden (`toolbox.setVisible(false)`) and a "Blocks" button opens a menu of the categories; picking one opens its flyout (`selectItemByPosition`).
- **Shape check.** A translated program that `isProgramShape` rejects (too deep or too big to store) shows "This program is too big or too deeply nested to save." The spec names no sentence for it.
- Blockly's media (the trash-can and zoom sprites, the drag cursors and the field icons) are copied from the package into `public/blockly-media/` and served by the game itself from a relative `blockly-media/` folder, so the dev server, `dist/` and `dist-single/` opened from disk all find it and the editor never fetches from Blockly's host (plan refinement R16). Sounds are off.

- [ ] **Step 1: Add Blockly**

Run: `npm install blockly@^13.3.0`
Expected: `added 1 package` (or a small number with its dependencies); `package.json`'s `dependencies` now read `"blockly": "^13.3.0"` beside `"three"`, and `package-lock.json` records it.

The package's `exports` map exposes no media path, so copy the files Blockly loads into the game's static folder (Vite copies `public/` into `dist/` as it is):

```bash
mkdir -p public/blockly-media
cp node_modules/blockly/media/sprites.svg node_modules/blockly/media/handopen.cur node_modules/blockly/media/handclosed.cur node_modules/blockly/media/handdelete.cur node_modules/blockly/media/1x1.gif node_modules/blockly/media/delete-icon.svg node_modules/blockly/media/dropdown-arrow.svg node_modules/blockly/media/foldout-icon.svg node_modules/blockly/media/resize-handle.svg public/blockly-media/
ls public/blockly-media
```

Expected: the nine files listed. The sound files (`*.mp3`) aren't copied: sounds are off.

- [ ] **Step 2: Write the failing tests**

In `tests/robotScreen.test.ts`, add to the imports at the top:

```ts
import { mulberry32 } from '../src/core/hash';
import { b } from '../src/robots/blocks';
import { BLOCK_DEFINITIONS, type BlockDefinitionJson } from '../src/ui/robotScreen/blockly/blockDefs';
import {
  EDITOR_TEXT,
  NEEDS_SENSOR_EYE_REASON,
  NEEDS_SENSOR_EYE_TEXT,
  blockCounter,
  declarationState,
  defaultLiteral,
  dropdownOptions,
  menuAccepts,
  menuFieldType,
  menuLabel,
  nameOptions,
  scriptNote,
  toolboxFor,
  variableCounter,
  type MenuKind,
} from '../src/ui/robotScreen/blockly/toolbox';
import { BLOCK_TYPES, programToWorkspace, type BlocklyBlockJson } from '../src/ui/robotScreen/translate';
import { randomProgram } from './programGen';
```

and make the existing `../src/config` import read `import { ROBOTS, ROBOT_CARE, ROBOT_PAINTS, ROBOT_SCREEN, TIME, UNLOCKS } from '../src/config';` (it gains `ROBOTS`, `ROBOT_SCREEN` and `TIME` as needed; there is only one). Then append:

```ts
describe('toolboxFor', () => {
  const types = (toolbox: ReturnType<typeof toolboxFor>) =>
    toolbox.contents.map((category) => [category.name, category.contents.map((block) => block.type)] as const);

  it("lists job 1's blocks by category, leaving empty categories out", () => {
    const toolbox = toolboxFor(robotOf({ parts: ['wateringHead'] }), UNLOCKS.job1);
    expect(toolbox.kind).toBe('categoryToolbox');
    expect(types(toolbox)).toEqual([
      ['Triggers', ['fc_morning', 'fc_atTime']],
      ['Control', ['fc_repeatTimes', 'fc_repeatUntil', 'fc_repeatForever']],
      ['Actions', ['fc_move', 'fc_turn', 'fc_goTo', 'fc_water', 'fc_refill', 'fc_powerDown', 'fc_wait', 'fc_say']],
      ['Values', ['fc_num', 'fc_text', 'fc_yes', 'fc_item', 'fc_tile', 'fc_myTile', 'fc_tileAhead', 'fc_tokensLeft', 'fc_compare']],
    ]);
  });

  it('puts both If shapes in Control, the variable getter in Values, and never a declaration', () => {
    const toolbox = toolboxFor(robotOf({ parts: ['sensorEye'] }), ALL_UNLOCKS);
    const byName = new Map(types(toolbox));
    expect(byName.get('Control')).toEqual([
      'fc_repeatTimes',
      'fc_repeatUntil',
      'fc_repeatForever',
      'fc_if',
      'fc_ifElse',
      'fc_forEachTile',
      'fc_set',
      'fc_change',
      'fc_helper',
      'fc_runHelper',
    ]);
    expect(byName.get('Values')?.[0]).toBe('fc_var');
    expect(toolbox.contents.flatMap((category) => category.contents.map((block) => block.type))).not.toContain('fc_varDecl');
    expect(toolbox.contents.map((category) => category.name)).toEqual(['Triggers', 'Control', 'Actions', 'Sensors', 'Values']);
  });

  it('disables the sensor-eye sensors without a sensor eye, and only them', () => {
    const disabled = (parts: Parameters<typeof robotOf>[0]) =>
      toolboxFor(robotOf(parts), ALL_UNLOCKS)
        .contents.flatMap((category) => category.contents)
        .filter((block) => block.disabledReasons !== undefined)
        .map((block) => [block.type, block.disabledReasons]);
    expect(disabled({ parts: ['claw'] })).toEqual([
      ['fc_tileAheadIs', [NEEDS_SENSOR_EYE_REASON]],
      ['fc_itIsRaining', [NEEDS_SENSOR_EYE_REASON]],
      ['fc_timeIsAfter', [NEEDS_SENSOR_EYE_REASON]],
    ]);
    expect(disabled({ parts: ['sensorEye'] })).toEqual([]);
    expect(NEEDS_SENSOR_EYE_TEXT).toBe('Needs a sensor eye');
  });

  it('has no shadow blocks', () => {
    const blocks = toolboxFor(robotOf(), ALL_UNLOCKS).contents.flatMap((category) => category.contents);
    for (const block of blocks) expect(Object.keys(block).sort()).toEqual(block.disabledReasons === undefined ? ['kind', 'type'] : ['disabledReasons', 'kind', 'type']);
  });
});

describe('dropdownOptions', () => {
  it('offers times every ROBOT_SCREEN.timeStep minutes from 6:00 am to 1:50 am', () => {
    const options = dropdownOptions('minute', null);
    expect(options).toHaveLength((TIME.passOutMinute - TIME.dayStartMinute) / ROBOT_SCREEN.timeStep);
    expect(options[0]).toEqual(['6:00 am', '360']);
    expect(options.at(-1)).toEqual(['1:50 am', '1550']);
  });

  it('includes a time outside the usual steps, in order', () => {
    const options = dropdownOptions('minute', 583);
    expect(options).toHaveLength((TIME.passOutMinute - TIME.dayStartMinute) / ROBOT_SCREEN.timeStep + 1);
    const at = options.findIndex(([, value]) => value === '583');
    expect(options.slice(at - 1, at + 2)).toEqual([
      ['9:40 am', '580'],
      ['9:43 am', '583'],
      ['9:50 am', '590'],
    ]);
    expect(dropdownOptions('minute', '583')).toEqual(options);
    expect(dropdownOptions('minute', 600)).toHaveLength(options.length - 1);
  });

  it('includes an item the usual list leaves out', () => {
    expect(dropdownOptions('item', null).map(([, value]) => value)).not.toContain('hoe');
    expect(dropdownOptions('item', null)[0]).toEqual(['Parsnip Seeds', 'parsnip_seeds']);
    expect(dropdownOptions('item', 'hoe').at(-1)).toEqual(['Hoe', 'hoe']);
  });

  it('lists crops, zones and Every choices with the current value kept', () => {
    expect(dropdownOptions('crop', null)[0]).toEqual(['Parsnip', 'parsnip']);
    expect(dropdownOptions('zone', 'C')).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map((zone) => [`Zone ${zone}`, zone]));
    expect(dropdownOptions('every', '15')).toEqual([['5', '5'], ['10', '10'], ['15', '15'], ['30', '30'], ['60', '60']]);
    expect(dropdownOptions('every', 45).map(([, value]) => value)).toEqual(['5', '10', '15', '30', '45', '60']);
  });
});

describe('menu fields', () => {
  it('accepts any well-formed value of its kind, as a string', () => {
    expect(menuAccepts('minute', 583)).toBe('583');
    expect(menuAccepts('minute', '583')).toBe('583');
    expect(menuAccepts('minute', '9:43')).toBeNull();
    expect(menuAccepts('every', 15)).toBe('15');
    expect(menuAccepts('item', 'hoe')).toBe('hoe');
    expect(menuAccepts('item', 'dragon')).toBeNull();
    expect(menuAccepts('crop', 'pumpkin')).toBe('pumpkin');
    expect(menuAccepts('crop', 'hoe')).toBeNull();
    expect(menuAccepts('zone', 'H')).toBe('H');
    expect(menuAccepts('zone', 'Z')).toBeNull();
    expect(menuAccepts('var', 'aVeryLongName123')).toBe('aVeryLongName123');
    expect(menuAccepts('helper', '')).toBe('');
    expect(menuAccepts('var', 3)).toBeNull();
  });

  it('labels values the way the dropdown shows them', () => {
    expect(menuLabel('minute', '583')).toBe('9:43 am');
    expect(menuLabel('every', '15')).toBe('15');
    expect(menuLabel('item', 'hoe')).toBe('Hoe');
    expect(menuLabel('crop', 'parsnip')).toBe('Parsnip');
    expect(menuLabel('zone', 'A')).toBe('Zone A');
    expect(menuLabel('var', 'count')).toBe('count');
    expect(menuLabel('var', '')).toBe('—');
    expect(menuLabel('helper', null)).toBe('—');
  });

  it("lists the workspace's names, keeps the current one and never comes back empty", () => {
    expect(nameOptions(['n', 'total', 'n'], null)).toEqual([['n', 'n'], ['total', 'total']]);
    expect(nameOptions(['n'], 'gone')).toEqual([['n', 'n'], ['gone', 'gone']]);
    expect(nameOptions([], null)).toEqual([['—', '']]);
    expect(nameOptions([], '')).toEqual([['—', '']]);
  });

  it('names one registered field per menu kind', () => {
    const kinds: MenuKind[] = ['minute', 'every', 'item', 'crop', 'zone', 'var', 'helper'];
    expect(kinds.map(menuFieldType)).toEqual(kinds.map((kind) => `field_fc_${kind}`));
  });
});

describe('the editor helpers', () => {
  it('counts blocks and variables against the size, red over the limit', () => {
    expect(blockCounter(7, 'mini')).toEqual({ text: '7 / 12 blocks', over: false });
    expect(blockCounter(13, 'mini')).toEqual({ text: '13 / 12 blocks', over: true });
    expect(blockCounter(30, 'standard')).toEqual({ text: '30 / 30 blocks', over: false });
    expect(variableCounter(2, 'mini')).toEqual({ text: '2 / 1 variables', over: true });
    expect(variableCounter(ROBOTS.sizes.big.vars, 'big')).toEqual({ text: '6 / 6 variables', over: false });
  });

  it('gives each type its default literal', () => {
    const robot = robotOf({ tx: 6, tz: 4 });
    expect(defaultLiteral('number', robot)).toEqual({ type: 'fc_num', fields: { NUM: 0 } });
    expect(defaultLiteral('text', robot)).toEqual({ type: 'fc_text', fields: { TEXT: '' } });
    expect(defaultLiteral('yesNo', robot)).toEqual({ type: 'fc_yes', fields: { VALUE: 'FALSE' } });
    expect(defaultLiteral('item', robot)).toEqual({ type: 'fc_item', fields: { ITEM: 'parsnip' } });
    expect(defaultLiteral('tile', robot)).toEqual({ type: 'fc_tile', fields: { X: 6, Z: 4 } });
  });

  it('builds a declaration holding the default literal', () => {
    expect(declarationState('n', 'tile', robotOf({ tx: 6, tz: 4 }), 10, 20)).toEqual({
      type: 'fc_varDecl',
      x: 10,
      y: 20,
      fields: { NAME: 'n', TYPE: 'tile' },
      inputs: { INITIAL: { block: { type: 'fc_tile', fields: { X: 6, Z: 4 } } } },
    });
  });

  it('has the spec sentences', () => {
    expect(EDITOR_TEXT.opening).toBe('Opening the editor…');
    expect(EDITOR_TEXT.failed).toBe("The editor couldn't load. Close and try again.");
    expect(EDITOR_TEXT.loose).toBe('Every block must be inside a When … stack or a helper.');
    expect(scriptNote('Bolt')).toBe('Bolt runs a fixed script. Saving here replaces it with a block program.');
  });
});

describe('block definitions', () => {
  interface Shape {
    readonly fields: ReadonlyMap<string, Readonly<Record<string, unknown>>>;
    readonly inputs: ReadonlySet<string>;
    readonly next: boolean;
    readonly previous: boolean;
  }

  function shapeOf(def: BlockDefinitionJson): Shape {
    const fields = new Map<string, Readonly<Record<string, unknown>>>();
    const inputs = new Set<string>();
    for (const [key, value] of Object.entries(def)) {
      if (!/^args\d+$/.test(key) || !Array.isArray(value)) continue;
      for (const arg of value as readonly Readonly<Record<string, unknown>>[]) {
        const type = String(arg.type);
        if (typeof arg.name !== 'string') continue;
        if (type.startsWith('field_')) fields.set(arg.name, arg);
        else if (type === 'input_value' || type === 'input_statement') inputs.add(arg.name);
      }
    }
    return { fields, inputs, next: 'nextStatement' in def, previous: 'previousStatement' in def };
  }

  const SHAPES = new Map(BLOCK_DEFINITIONS.map((def) => [def.type, shapeOf(def)] as const));
  const MENU_BY_TYPE = new Map<string, MenuKind>(
    (['minute', 'every', 'item', 'crop', 'zone', 'var', 'helper'] as const).map((kind) => [menuFieldType(kind), kind]),
  );

  /** Every way a translated block disagrees with its definition. */
  function problems(block: BlocklyBlockJson, path: string): string[] {
    const shape = SHAPES.get(block.type);
    if (shape === undefined) return [`${path}: no definition for ${block.type}`];
    const found: string[] = [];
    for (const [name, value] of Object.entries(block.fields ?? {})) {
      const field = shape.fields.get(name);
      if (field === undefined) {
        found.push(`${path}: ${block.type} has no field ${name}`);
        continue;
      }
      const menu = MENU_BY_TYPE.get(String(field.type));
      if (menu !== undefined && menuAccepts(menu, value) === null) found.push(`${path}: ${name} = ${String(value)} rejected`);
      if (field.type === 'field_dropdown' && !(field.options as readonly (readonly [string, string])[]).some(([, v]) => v === value)) {
        found.push(`${path}: ${name} = ${String(value)} not an option`);
      }
      if (field.type === 'field_number' && typeof value !== 'number') found.push(`${path}: ${name} is not a number`);
    }
    for (const [name, input] of Object.entries(block.inputs ?? {})) {
      if (!shape.inputs.has(name)) found.push(`${path}: ${block.type} has no input ${name}`);
      if (input.block !== undefined) found.push(...problems(input.block, `${path}.${name}`));
    }
    if (block.next?.block !== undefined) {
      if (!shape.next) found.push(`${path}: ${block.type} has no next connection`);
      found.push(...problems(block.next.block, `${path}.next`));
    }
    return found;
  }

  it('defines every block type of the language once', () => {
    expect(BLOCK_DEFINITIONS.map((def) => def.type).sort()).toEqual([...BLOCK_TYPES].sort());
    expect(new Set(BLOCK_DEFINITIONS.map((def) => def.type)).size).toBe(BLOCK_DEFINITIONS.length);
  });

  it('gives triggers, helpers and declarations no previous or next connection', () => {
    for (const type of ['fc_morning', 'fc_atTime', 'fc_bagFull', 'fc_startsRaining', 'fc_every', 'fc_helper', 'fc_varDecl']) {
      expect([type, SHAPES.get(type)?.previous, SHAPES.get(type)?.next]).toEqual([type, false, false]);
    }
  });

  it('matches every field and input of 300 translated random programs, and the design fixtures', () => {
    const rng = mulberry32(20261003);
    const programs = [
      ...Array.from({ length: 300 }, () => randomProgram(rng)),
      b.program({
        vars: [{ name: 'aVeryLongName123', type: 'number', initial: b.n(7) }],
        stacks: [b.when(b.atTime(583), b.take('hoe'), b.change('aVeryLongName123', 1), b.wait(b.v('aVeryLongName123')))],
      }),
      b.program({ stacks: [b.when(b.morning(), b.repeatUntil(b.lt(b.tokensLeft(), 10), b.water(), b.move()))] }),
    ];
    const found = programs.flatMap((program, index) =>
      (programToWorkspace(program).blocks?.blocks ?? []).flatMap((block, top) => problems(block, `program ${index} block ${top}`)),
    );
    expect(found.slice(0, 5)).toEqual([]);
  });
});
```

- [ ] **Step 3: Run them and see them fail**

Run: `npx vitest run tests/robotScreen.test.ts`
Expected: FAIL to load — `Error: Cannot find module '../src/ui/robotScreen/blockly/blockDefs'`.

- [ ] **Step 4: Implement**

**4a. Create `src/ui/robotScreen/blockly/toolbox.ts`:**

```ts
/**
 * The Program tab's pure rules (farmclaws part 3 spec §4.2): which blocks the toolbox offers,
 * the options every dropdown shows, how a dropdown value is accepted and labelled, the default
 * literals for new variables, the counters and the editor's sentences. No Blockly import, so
 * tests/robotScreen.test.ts covers all of it; blockDefs.ts and ProgramTab.ts apply it.
 */
import { ROBOTS, ROBOT_SCREEN, TIME } from '../../../config';
import {
  CROP_IDS,
  EVERY_CHOICES,
  VALUE_TYPES,
  ZONE_IDS,
  type CropId,
  type ItemId,
  type Robot,
  type RobotSize,
  type RobotUnlocks,
  type ValueType,
  type ZoneId,
} from '../../../core/types';
import { CROPS } from '../../../farming/crops';
import { ITEMS, getItem, isItemId } from '../../../items/items';
import { BLOCK_CATEGORY, BLOCK_KINDS, type BlockCategory } from '../../../robots/blockKinds';
import { hasPart } from '../../../robots/stats';
import { formatClock } from '../../../time/clock';
import { blockTypeFor } from '../translate';

// ---------------------------------------------------------------------------
// Dropdowns
// ---------------------------------------------------------------------------

/** Dropdowns whose options come from game data, plus the two whose options are the workspace's names. */
export type MenuKind = 'minute' | 'every' | 'item' | 'crop' | 'zone' | 'var' | 'helper';
export type DropdownKind = Exclude<MenuKind, 'var' | 'helper'>;

export const MENU_KINDS: readonly MenuKind[] = ['minute', 'every', 'item', 'crop', 'zone', 'var', 'helper'];

/** The Blockly field type registered for a menu kind. */
export function menuFieldType(kind: MenuKind): string {
  return `field_fc_${kind}`;
}

/** Shown for an empty variable or helper name, and when the workspace has no names yet. */
const NO_NAME = '—';

/** Item kinds the item dropdowns list; any other item still shows when it is the current value. */
const LISTED_ITEM_KINDS: ReadonlySet<string> = new Set(['seed', 'produce', 'material']);

const WHOLE_NUMBER = /^-?\d+$/;

function isCropId(value: unknown): value is CropId {
  return (CROP_IDS as readonly unknown[]).includes(value);
}

function isZoneId(value: unknown): value is ZoneId {
  return (ZONE_IDS as readonly unknown[]).includes(value);
}

function minuteOptions(): [string, string][] {
  const options: [string, string][] = [];
  for (let minute = TIME.dayStartMinute; minute < TIME.passOutMinute; minute += ROBOT_SCREEN.timeStep) {
    options.push([formatClock(minute, 1), String(minute)]);
  }
  return options;
}

function usualOptions(kind: DropdownKind): [string, string][] {
  switch (kind) {
    case 'minute':
      return minuteOptions();
    case 'every':
      return EVERY_CHOICES.map((minutes): [string, string] => [String(minutes), String(minutes)]);
    case 'item': {
      const options: [string, string][] = [];
      for (const item of ITEMS.values()) if (LISTED_ITEM_KINDS.has(item.kind)) options.push([item.name, item.id]);
      return options;
    }
    case 'crop':
      return CROP_IDS.map((id): [string, string] => [CROPS[id].name, id]);
    case 'zone':
      return ZONE_IDS.map((zone): [string, string] => [`Zone ${zone}`, zone]);
  }
}

/**
 * The options of a dropdown (spec §4.2): the usual list, plus `current` when it isn't in it, so
 * a loaded value is shown and kept. Numeric kinds put it in order; other kinds put it last.
 */
export function dropdownOptions(kind: DropdownKind, current: string | number | null): readonly [string, string][] {
  const options = usualOptions(kind);
  if (current === null) return options;
  const value = String(current);
  if (options.some(([, option]) => option === value)) return options;
  const extra: [string, string] = [menuLabel(kind, value), value];
  if (kind === 'minute' || kind === 'every') {
    const at = options.findIndex(([, option]) => Number(option) > Number(value));
    options.splice(at === -1 ? options.length : at, 0, extra);
  } else {
    options.push(extra);
  }
  return options;
}

/** The options of a variable or helper dropdown: the workspace's names, plus the current one. */
export function nameOptions(names: readonly string[], current: string | null): readonly [string, string][] {
  const list = [...new Set(names.filter((name) => name !== ''))];
  if (current !== null && current !== '' && !list.includes(current)) list.push(current);
  return list.length === 0 ? [[NO_NAME, '']] : list.map((name): [string, string] => [name, name]);
}

/** What a dropdown shows for `value`. */
export function menuLabel(kind: MenuKind, value: string | null): string {
  switch (kind) {
    case 'minute':
      return value !== null && WHOLE_NUMBER.test(value) ? formatClock(Number(value), 1) : (value ?? '');
    case 'every':
      return value ?? '';
    case 'item':
      return isItemId(value) ? getItem(value).name : (value ?? '');
    case 'crop':
      return isCropId(value) ? CROPS[value].name : (value ?? '');
    case 'zone':
      return value === null ? '' : `Zone ${value}`;
    case 'var':
    case 'helper':
      return value === null || value === '' ? NO_NAME : value;
  }
}

/**
 * The value a dropdown of `kind` stores for `value`, or null to refuse it. Times are whole
 * numbers (saved as their decimal text), items, crops and zones must exist, names are any text.
 */
export function menuAccepts(kind: MenuKind, value: unknown): string | null {
  switch (kind) {
    case 'minute':
    case 'every':
      if (typeof value === 'number') return Number.isInteger(value) ? String(value) : null;
      return typeof value === 'string' && WHOLE_NUMBER.test(value) ? value : null;
    case 'item':
      return isItemId(value) ? value : null;
    case 'crop':
      return isCropId(value) ? value : null;
    case 'zone':
      return isZoneId(value) ? value : null;
    case 'var':
    case 'helper':
      return typeof value === 'string' ? value : null;
  }
}

// ---------------------------------------------------------------------------
// Toolbox
// ---------------------------------------------------------------------------

export const BLOCK_CATEGORIES: readonly BlockCategory[] = ['triggers', 'control', 'actions', 'sensors', 'values'];

export const CATEGORY_NAMES: Readonly<Record<BlockCategory, string>> = {
  triggers: 'Triggers',
  control: 'Control',
  actions: 'Actions',
  sensors: 'Sensors',
  values: 'Values',
};

/** The theme's block and category style name for a category. */
export function categoryStyle(category: BlockCategory): string {
  return `fc_${category}`;
}

/** The sensors a size without a sensor eye can't use (the checker's part rule). */
export const SENSOR_EYE_TYPES: ReadonlySet<string> = new Set(['fc_tileAheadIs', 'fc_itIsRaining', 'fc_timeIsAfter']);
export const NEEDS_SENSOR_EYE_REASON = 'fc_needsSensorEye';
export const NEEDS_SENSOR_EYE_TEXT = 'Needs a sensor eye';

export interface ToolboxBlockJson {
  readonly kind: 'block';
  readonly type: string;
  readonly disabledReasons?: readonly string[];
}

export interface ToolboxCategoryJson {
  readonly kind: 'category';
  readonly name: string;
  readonly category: BlockCategory;
  readonly categorystyle: string;
  readonly contents: readonly ToolboxBlockJson[];
}

export interface ToolboxJson {
  readonly kind: 'categoryToolbox';
  readonly contents: readonly ToolboxCategoryJson[];
}

/**
 * The toolbox for a robot and the unlocked blocks (spec §4.2, §7): the five categories in order,
 * each with its unlocked block types in BLOCK_KINDS order, empty categories left out. The
 * variable getter sits under Values; declarations come from "Make a variable", not the toolbox.
 * Without a sensor eye the sensor-eye sensors are disabled. No shadow blocks.
 */
export function toolboxFor(robot: Pick<Robot, 'size' | 'parts'>, unlocks: RobotUnlocks): ToolboxJson {
  const groups = new Map<BlockCategory, string[]>(BLOCK_CATEGORIES.map((category) => [category, []]));
  for (const kind of BLOCK_KINDS) {
    if (!unlocks.blocks.includes(kind)) continue;
    for (const type of blockTypeFor(kind)) {
      if (type === 'fc_varDecl') continue;
      groups.get(type === 'fc_var' ? 'values' : BLOCK_CATEGORY[kind])?.push(type);
    }
  }
  const eye = hasPart(robot, 'sensorEye');
  const contents: ToolboxCategoryJson[] = [];
  for (const category of BLOCK_CATEGORIES) {
    const types = groups.get(category) ?? [];
    if (types.length === 0) continue;
    contents.push({
      kind: 'category',
      name: CATEGORY_NAMES[category],
      category,
      categorystyle: categoryStyle(category),
      contents: types.map((type): ToolboxBlockJson =>
        !eye && SENSOR_EYE_TYPES.has(type) ? { kind: 'block', type, disabledReasons: [NEEDS_SENSOR_EYE_REASON] } : { kind: 'block', type },
      ),
    });
  }
  return { kind: 'categoryToolbox', contents };
}

// ---------------------------------------------------------------------------
// Variables
// ---------------------------------------------------------------------------

/** The socket check of each value type (spec §4.2). */
export const VALUE_CHECKS: Readonly<Record<ValueType, string>> = {
  number: 'Number',
  text: 'Text',
  yesNo: 'YesNo',
  item: 'Item',
  tile: 'Tile',
};

export const VALUE_TYPE_LABELS: Readonly<Record<ValueType, string>> = {
  number: 'Number',
  text: 'Text',
  yesNo: 'Yes/No',
  item: 'Item',
  tile: 'Tile',
};

export function isValueType(value: unknown): value is ValueType {
  return (VALUE_TYPES as readonly unknown[]).includes(value);
}

/** A block to add to the workspace, in Blockly's serialization shape (ids are left to Blockly). */
export interface NewBlockState {
  readonly type: string;
  readonly x?: number;
  readonly y?: number;
  readonly fields?: Readonly<Record<string, string | number>>;
  readonly inputs?: Readonly<Record<string, { readonly block: NewBlockState }>>;
}

/** A new variable's starting literal (spec §4.2): 0, "", No, parsnip, or the robot's tile. */
export function defaultLiteral(type: ValueType, robot: Pick<Robot, 'tx' | 'tz'>): NewBlockState {
  switch (type) {
    case 'number':
      return { type: 'fc_num', fields: { NUM: 0 } };
    case 'text':
      return { type: 'fc_text', fields: { TEXT: '' } };
    case 'yesNo':
      return { type: 'fc_yes', fields: { VALUE: 'FALSE' } };
    case 'item':
      return { type: 'fc_item', fields: { ITEM: CROP_IDS[0] satisfies ItemId } };
    case 'tile':
      return { type: 'fc_tile', fields: { X: robot.tx, Z: robot.tz } };
  }
}

/** "Variable [name] is a [type] starting at [literal]" at (x, y). */
export function declarationState(name: string, type: ValueType, robot: Pick<Robot, 'tx' | 'tz'>, x: number, y: number): NewBlockState {
  return { type: 'fc_varDecl', x, y, fields: { NAME: name, TYPE: type }, inputs: { INITIAL: { block: defaultLiteral(type, robot) } } };
}

// ---------------------------------------------------------------------------
// Counters and sentences
// ---------------------------------------------------------------------------

export interface CounterView {
  readonly text: string;
  /** Over the limit: shown red. */
  readonly over: boolean;
}

export function counterView(used: number, limit: number, noun: string): CounterView {
  return { text: `${used} / ${limit} ${noun}`, over: used > limit };
}

/** "{used} / {limit} blocks" (spec §4.2). */
export function blockCounter(used: number, size: RobotSize): CounterView {
  return counterView(used, ROBOTS.sizes[size].blocks, 'blocks');
}

/** "{n} / {limit} variables". */
export function variableCounter(declared: number, size: RobotSize): CounterView {
  return counterView(declared, ROBOTS.sizes[size].vars, 'variables');
}

export const EDITOR_TEXT = {
  opening: 'Opening the editor…',
  failed: "The editor couldn't load. Close and try again.",
  loose: 'Every block must be inside a When … stack or a helper.',
  tooBig: 'This program is too big or too deeply nested to save.',
  blocks: 'Blocks',
  makeVariable: 'Make a variable',
  save: 'Save',
  revert: 'Revert',
} as const;

/** The note over a part 1 script robot's empty workspace (spec §4.2). */
export function scriptNote(name: string): string {
  return `${name} runs a fixed script. Saving here replaces it with a block program.`;
}
```

**4b. Create `src/ui/robotScreen/blockly/theme.ts`:**

```ts
/**
 * The editor's Blockly theme (farmclaws part 3 spec §4.2): the HUD's palette on the Zelos
 * renderer: a cream workspace, parchment toolbox and flyout, the game's rounded font, and one
 * colour per category (Triggers gold, Control orange, Actions green, Sensors teal, Values
 * purple). Colours are dark enough for Zelos's white block text.
 */
import type * as Blockly from 'blockly/core';
import type { BlockCategory } from '../../../robots/blockKinds';
import { BLOCK_CATEGORIES, categoryStyle } from './toolbox';

type BlocklyApi = typeof Blockly;

interface CategoryColours {
  readonly primary: string;
  readonly secondary: string;
  readonly tertiary: string;
}

export const CATEGORY_COLOURS: Readonly<Record<BlockCategory, CategoryColours>> = {
  triggers: { primary: '#c98f12', secondary: '#e8b84a', tertiary: '#9a6a0c' },
  control: { primary: '#d9742b', secondary: '#eea06a', tertiary: '#a8551b' },
  actions: { primary: '#4f9e5f', secondary: '#86c592', tertiary: '#3a7a47' },
  sensors: { primary: '#2f8f86', secondary: '#6bbdb5', tertiary: '#226b64' },
  values: { primary: '#7f6bc9', secondary: '#ab9de0', tertiary: '#5f4fa3' },
};

const THEME_NAME = 'meadowlight-robots';
const FONT_FAMILY = "'Fredoka', ui-rounded, 'SF Pro Rounded', system-ui, sans-serif";

export function createTheme(api: BlocklyApi): Blockly.Theme {
  return api.Theme.defineTheme(THEME_NAME, {
    name: THEME_NAME,
    base: api.Themes.Classic,
    blockStyles: Object.fromEntries(
      BLOCK_CATEGORIES.map((category) => {
        const colours = CATEGORY_COLOURS[category];
        return [
          categoryStyle(category),
          {
            colourPrimary: colours.primary,
            colourSecondary: colours.secondary,
            colourTertiary: colours.tertiary,
            hat: category === 'triggers' ? 'cap' : '',
          },
        ];
      }),
    ),
    categoryStyles: Object.fromEntries(BLOCK_CATEGORIES.map((category) => [categoryStyle(category), { colour: CATEGORY_COLOURS[category].primary }])),
    componentStyles: {
      workspaceBackgroundColour: '#fff8ea',
      toolboxBackgroundColour: '#f6e7c8',
      toolboxForegroundColour: '#5a3d2b',
      flyoutBackgroundColour: '#fdf1d8',
      flyoutForegroundColour: '#5a3d2b',
      flyoutOpacity: 0.97,
      scrollbarColour: '#c9925f',
      scrollbarOpacity: 0.6,
      insertionMarkerColour: '#5a3d2b',
      insertionMarkerOpacity: 0.3,
      markerColour: '#e46a6a',
      cursorColour: '#5ea8d6',
      selectedGlowColour: '#5ea8d6',
      selectedGlowOpacity: 0.6,
    },
    fontStyle: { family: FONT_FAMILY, weight: '600', size: 12 },
  });
}
```

**4c. Create `src/ui/robotScreen/blockly/blockDefs.ts`:**

```ts
/**
 * The robot language's Blockly blocks (farmclaws part 3 spec §4.2, §5): one JSON definition per
 * BLOCK_TYPES entry, with the field and input names translate.ts reads and writes. Labels are
 * sentence case. Value sockets are typed Number, Text, YesNo, Item or Tile; statement
 * connections are untyped; fc_var's output check is set by the Program tab from its
 * declaration. Triggers, helpers and declarations have no previous or next connection.
 *
 * BLOCK_DEFINITIONS is plain data (tests check it against translate.ts without a DOM);
 * defineBlocks registers it with Blockly, together with:
 * - the menu fields (`field_fc_*`): dropdowns whose generator always includes the current value
 *   and whose validation accepts any well-formed value (toolbox.ts menuAccepts), because
 *   Blockly's FieldDropdown would otherwise reject a loaded value outside its cached options;
 * - the sensor-eye extension: a sensor disabled in the toolbox explains "Needs a sensor eye".
 */
import type * as Blockly from 'blockly/core';
import { ROBOTS } from '../../../config';
import { VALUE_TYPES } from '../../../core/types';
import type { BlockCategory } from '../../../robots/blockKinds';
import { MAPS } from '../../../world/maps';
import {
  MENU_KINDS,
  NEEDS_SENSOR_EYE_REASON,
  NEEDS_SENSOR_EYE_TEXT,
  VALUE_CHECKS,
  VALUE_TYPE_LABELS,
  categoryStyle,
  dropdownOptions,
  menuAccepts,
  menuFieldType,
  menuLabel,
  nameOptions,
  type MenuKind,
} from './toolbox';

type BlocklyApi = typeof Blockly;

/** One Blockly JSON block definition. */
export type BlockDefinitionJson = { readonly type: string } & Readonly<Record<string, unknown>>;

const SENSOR_EYE_EXTENSION = 'fc_sensor_eye_tooltip';
const FARM = MAPS.farm.grid;

const NUMBER = VALUE_CHECKS.number;
const TEXT = VALUE_CHECKS.text;
const YES_NO = VALUE_CHECKS.yesNo;
const ITEM = VALUE_CHECKS.item;
const TILE = VALUE_CHECKS.tile;

// --- Argument builders -----------------------------------------------------------------------

const statementInput = (name: string) => ({ type: 'input_statement', name });
const valueInput = (name: string, check?: string) => (check === undefined ? { type: 'input_value', name } : { type: 'input_value', name, check });
const menu = (kind: MenuKind, name: string) => ({ type: menuFieldType(kind), name });
const choice = (name: string, options: readonly (readonly [string, string])[]) => ({
  type: 'field_dropdown',
  name,
  options: options.map(([label, value]) => [label, value]),
});
const textField = (name: string, text: string) => ({ type: 'field_input', name, text, spellcheck: false });
const numberField = (name: string, min: number, max: number) => ({ type: 'field_number', name, value: 0, min, max, precision: 1 });

// --- Block builders --------------------------------------------------------------------------

/** A top block that starts a stack: no previous or next connection, a `DO` body. */
function topBlock(type: string, category: BlockCategory, message: string, args: readonly object[] = []): BlockDefinitionJson {
  return { type, message0: message, args0: args, message1: '%1', args1: [statementInput('DO')], style: categoryStyle(category), tooltip: '' };
}

/** A statement with an optional `DO` body. */
function statement(type: string, category: BlockCategory, message: string, args: readonly object[] = [], body = false): BlockDefinitionJson {
  return {
    type,
    message0: message,
    args0: args,
    ...(body ? { message1: '%1', args1: [statementInput('DO')] } : {}),
    previousStatement: null,
    nextStatement: null,
    inputsInline: true,
    style: categoryStyle(category),
    tooltip: '',
  };
}

/** An expression block with output check `output` (null: any). */
function expression(
  type: string,
  category: BlockCategory,
  message: string,
  output: string | null,
  args: readonly object[] = [],
  extensions: readonly string[] = [],
): BlockDefinitionJson {
  return {
    type,
    message0: message,
    args0: args,
    output,
    inputsInline: true,
    style: categoryStyle(category),
    tooltip: '',
    ...(extensions.length > 0 ? { extensions: [...extensions] } : {}),
  };
}

const sensor = (type: string, message: string, args: readonly object[] = [], extensions: readonly string[] = []) =>
  expression(type, 'sensors', message, YES_NO, args, extensions);

// --- The blocks --------------------------------------------------------------------------------

export const BLOCK_DEFINITIONS: readonly BlockDefinitionJson[] = [
  // Triggers
  topBlock('fc_morning', 'triggers', 'When morning comes'),
  topBlock('fc_atTime', 'triggers', "When it's %1", [menu('minute', 'MINUTE')]),
  topBlock('fc_bagFull', 'triggers', 'When my bag is full'),
  topBlock('fc_startsRaining', 'triggers', 'When it starts raining'),
  topBlock('fc_every', 'triggers', 'Every %1 minutes', [menu('every', 'MINUTES')]),

  // Helpers and variables
  topBlock('fc_helper', 'control', 'Define helper %1', [textField('NAME', 'helper')]),
  {
    type: 'fc_varDecl',
    message0: 'Variable %1 is a %2 starting at %3',
    args0: [
      textField('NAME', 'n'),
      choice(
        'TYPE',
        VALUE_TYPES.map((type) => [VALUE_TYPE_LABELS[type], type] as const),
      ),
      // No static check: refreshChecks sets it, and only after a load or append, where Blockly's serializer would throw on a mismatch.
      valueInput('INITIAL'),
    ],
    inputsInline: true,
    style: categoryStyle('values'),
    tooltip: '',
  },

  // Actions
  statement('fc_move', 'actions', 'Move forward'),
  statement('fc_turn', 'actions', 'Turn %1', [
    choice('SIDE', [
      ['left', 'left'],
      ['right', 'right'],
    ]),
  ]),
  statement('fc_water', 'actions', 'Water'),
  statement('fc_harvest', 'actions', 'Harvest'),
  statement('fc_till', 'actions', 'Till'),
  statement('fc_plant', 'actions', 'Plant %1', [menu('crop', 'CROP')]),
  statement('fc_refill', 'actions', 'Refill'),
  statement('fc_deposit', 'actions', 'Deposit'),
  statement('fc_take', 'actions', 'Take %1', [valueInput('ITEM', ITEM)]),
  statement('fc_say', 'actions', 'Say %1', [valueInput('TEXT', TEXT)]),
  statement('fc_wait', 'actions', 'Wait %1 minutes', [valueInput('MINUTES', NUMBER)]),
  statement('fc_powerDown', 'actions', 'Power down'),
  statement('fc_goTo', 'actions', 'Go to %1', [valueInput('TILE', TILE)]),

  // Control
  statement('fc_repeatTimes', 'control', 'Repeat %1 times', [valueInput('TIMES', NUMBER)], true),
  statement('fc_repeatUntil', 'control', 'Repeat until %1', [valueInput('UNTIL', YES_NO)], true),
  statement('fc_repeatForever', 'control', 'Repeat forever', [], true),
  {
    type: 'fc_if',
    message0: 'If %1',
    args0: [valueInput('COND', YES_NO)],
    message1: '%1',
    args1: [statementInput('THEN')],
    previousStatement: null,
    nextStatement: null,
    inputsInline: true,
    style: categoryStyle('control'),
    tooltip: '',
  },
  {
    type: 'fc_ifElse',
    message0: 'If %1',
    args0: [valueInput('COND', YES_NO)],
    message1: '%1',
    args1: [statementInput('THEN')],
    message2: 'Else',
    message3: '%1',
    args3: [statementInput('ELSE')],
    previousStatement: null,
    nextStatement: null,
    inputsInline: true,
    style: categoryStyle('control'),
    tooltip: '',
  },
  statement('fc_forEachTile', 'control', 'For each tile in %1', [menu('zone', 'ZONE')], true),
  statement('fc_set', 'control', 'Set %1 to %2', [menu('var', 'VAR'), valueInput('VALUE')]),
  statement('fc_change', 'control', 'Change %1 by %2', [menu('var', 'VAR'), valueInput('BY', NUMBER)]),
  statement('fc_runHelper', 'control', 'Run helper %1', [menu('helper', 'NAME')]),

  // Sensors
  sensor('fc_cropIsReady', 'crop is ready'),
  sensor('fc_soilIsDry', 'soil is dry'),
  sensor('fc_tileIsTilled', 'tile is tilled'),
  sensor('fc_cropIs', 'crop is %1', [menu('crop', 'CROP')]),
  sensor('fc_bagIsFull', 'bag is full'),
  sensor('fc_bagHas', 'bag has %1', [menu('item', 'ITEM')]),
  sensor('fc_atEdgeOf', 'at edge of %1', [menu('zone', 'ZONE')]),
  sensor('fc_tokensBelow', 'tokens below %1', [valueInput('N', NUMBER)]),
  sensor(
    'fc_tileAheadIs',
    'tile ahead is %1',
    [
      choice('WHAT', [
        ['water', 'water'],
        ['blocked', 'blocked'],
        ['clear', 'clear'],
      ]),
    ],
    [SENSOR_EYE_EXTENSION],
  ),
  sensor('fc_itIsRaining', 'it is raining', [], [SENSOR_EYE_EXTENSION]),
  sensor('fc_timeIsAfter', 'time is after %1', [menu('minute', 'MINUTE')], [SENSOR_EYE_EXTENSION]),

  // Values
  expression('fc_num', 'values', '%1', NUMBER, [numberField('NUM', -ROBOTS.maxNumber, ROBOTS.maxNumber)]),
  expression('fc_text', 'values', '“%1”', TEXT, [textField('TEXT', '')]),
  expression('fc_yes', 'values', '%1', YES_NO, [
    choice('VALUE', [
      ['Yes', 'TRUE'],
      ['No', 'FALSE'],
    ]),
  ]),
  expression('fc_item', 'values', '%1', ITEM, [menu('item', 'ITEM')]),
  expression('fc_tile', 'values', 'tile X %1 Z %2', TILE, [numberField('X', 0, FARM.width - 1), numberField('Z', 0, FARM.depth - 1)]),
  expression('fc_var', 'values', '%1', null, [menu('var', 'VAR')]),
  expression('fc_myTile', 'values', 'my tile', TILE),
  expression('fc_tileAhead', 'values', 'tile ahead', TILE),
  expression('fc_tokensLeft', 'values', 'tokens left', NUMBER),
  expression('fc_countInBag', 'values', 'count of %1 in bag', NUMBER, [menu('item', 'ITEM')]),
  expression('fc_arith', 'values', '%1 %2 %3', NUMBER, [
    valueInput('A', NUMBER),
    choice('OP', [
      ['+', '+'],
      ['−', '-'],
      ['×', '×'],
    ]),
    valueInput('B', NUMBER),
  ]),
  expression('fc_compare', 'values', '%1 %2 %3', YES_NO, [
    valueInput('A'),
    choice('OP', [
      ['=', '='],
      ['≠', '≠'],
      ['<', '<'],
      ['>', '>'],
    ]),
    valueInput('B'),
  ]),
  expression('fc_and', 'values', '%1 and %2', YES_NO, [valueInput('A', YES_NO), valueInput('B', YES_NO)]),
  expression('fc_or', 'values', '%1 or %2', YES_NO, [valueInput('A', YES_NO), valueInput('B', YES_NO)]),
  expression('fc_not', 'values', 'not %1', YES_NO, [valueInput('A', YES_NO)]),
];

// --- Registration ------------------------------------------------------------------------------

/** The names of the workspace's blocks of `type` (a flyout block reads its target workspace). */
function workspaceNames(api: BlocklyApi, field: Blockly.FieldDropdown, type: string): string[] {
  const block = field.getSourceBlock();
  if (block === null) return [];
  let workspace: Blockly.Workspace = block.workspace;
  if (workspace instanceof api.WorkspaceSvg && workspace.isFlyout && workspace.targetWorkspace !== null) workspace = workspace.targetWorkspace;
  return workspace.getBlocksByType(type, true).map((named) => String(named.getFieldValue('NAME') ?? ''));
}

function menuOptions(api: BlocklyApi, kind: MenuKind, field: Blockly.FieldDropdown): readonly (readonly [string, string])[] {
  const current = field.getValue();
  switch (kind) {
    case 'var':
      return nameOptions(workspaceNames(api, field, 'fc_varDecl'), current);
    case 'helper':
      return nameOptions(workspaceNames(api, field, 'fc_helper'), current);
    default:
      return dropdownOptions(kind, current);
  }
}

/** Registers `field_fc_<kind>`: a dropdown that shows, accepts and keeps any well-formed value. */
function registerMenuField(api: BlocklyApi, kind: MenuKind): void {
  const generator = function (this: Blockly.FieldDropdown): Blockly.MenuOption[] {
    return menuOptions(api, kind, this).map(([label, value]): Blockly.MenuOption => [label, value]);
  };
  class MenuField extends api.FieldDropdown {
    constructor() {
      super(generator);
    }

    protected override doClassValidation_(newValue?: unknown): string | null {
      return menuAccepts(kind, newValue);
    }

    protected override getText_(): string | null {
      return menuLabel(kind, this.getValue());
    }
  }
  api.fieldRegistry.register(menuFieldType(kind), Object.assign(MenuField, { fromJson: (): MenuField => new MenuField() }));
}

/** Registers the language's fields, extension and blocks with Blockly, once. */
export function defineBlocks(api: BlocklyApi): void {
  if (api.Blocks['fc_morning'] !== undefined) return;
  for (const kind of MENU_KINDS) registerMenuField(api, kind);
  if (!api.Extensions.isRegistered(SENSOR_EYE_EXTENSION)) {
    api.Extensions.register(SENSOR_EYE_EXTENSION, function (this: Blockly.Block) {
      const block = this;
      const usual = block.tooltip;
      block.setTooltip(() => (block.hasDisabledReason(NEEDS_SENSOR_EYE_REASON) ? NEEDS_SENSOR_EYE_TEXT : usual));
    });
  }
  api.common.defineBlocksWithJsonArray(BLOCK_DEFINITIONS.map((definition) => ({ ...definition })));
}
```

**4d. Create `src/ui/robotScreen/tabs/ProgramTab.ts`:**

```ts
/**
 * The Program tab (farmclaws part 3 spec §4.2): a Blockly editor for the robot's block program.
 *
 * - Blockly (`blockly/core` with its English messages) is imported the first time the tab is
 *   shown, so it lands in its own chunk; meanwhile the tab says "Opening the editor…", and a
 *   failed import says "The editor couldn't load. Close and try again.".
 * - The saved program is loaded with events disabled (loading is not an edit), rendered, and
 *   its top-level blocks re-spaced ROBOT_SCREEN.stackGap apart in program order. A part 1 script
 *   opens an empty workspace under a note. A ruined robot's workspace is read-only.
 * - The toolbar shows "{used} / {limit} blocks" (countWorkspaceBlocks, mid-edit) and
 *   "{n} / {limit} variables", red over the limit; "Make a variable" (with `var` unlocked);
 *   Revert and Save. Under the phone width the category column is hidden and "Blocks" opens a
 *   menu of the categories instead.
 * - Save translates the workspace, refuses loose blocks and translation errors (the block is
 *   highlighted), runs isProgramShape and checkProgram (the sentence shows under the toolbar),
 *   then dispatches programRobot. The reducer checks again and toasts "Programmed {name}.".
 * - A workspace listener keeps variables consistent: fc_var's output check follows its
 *   declaration's type, a declaration's INITIAL takes its type's literal, a changed type swaps
 *   in that type's default literal, and renaming a declaration or helper renames its uses.
 */
import type * as Blockly from 'blockly/core';
import { ROBOTS, ROBOT_SCREEN } from '../../../config';
import { VALUE_TYPES, type GameState, type Robot, type RobotProgram, type RobotUnlocks, type ValueType } from '../../../core/types';
import { checkProgram } from '../../../robots/check';
import { findRobot } from '../../../robots/world';
import { actions } from '../../../state/actions';
import { isProgramShape } from '../../../state/robotValidation';
import { closestWithin, h, hudButton, setHidden, setText } from '../../dom';
import { defineBlocks } from '../blockly/blockDefs';
import { CATEGORY_COLOURS, createTheme } from '../blockly/theme';
import {
  EDITOR_TEXT,
  VALUE_CHECKS,
  VALUE_TYPE_LABELS,
  blockCounter,
  declarationState,
  defaultLiteral,
  isValueType,
  scriptNote,
  toolboxFor,
  variableCounter,
  type CounterView,
  type ToolboxJson,
} from '../blockly/toolbox';
import { countWorkspaceBlocks, programToWorkspace, workspaceToProgram, type BlocklyWorkspaceJson } from '../translate';
import { phoneQuery } from '../viewModel';
import type { RobotTabContext, RobotTabView } from './tabView';

type BlocklyApi = typeof Blockly;

const EDITOR_ZOOM = { controls: true, wheel: true, pinch: true, startScale: 0.9, maxScale: 2, minScale: 0.5, scaleSpeed: 1.15 } as const;
/** New declarations land this far (workspace units) inside the top-left of the view. */
const DECLARATION_INSET = 24;
const EMPTY_WORKSPACE: BlocklyWorkspaceJson = {};

/** The toolbox in Blockly's own JSON types. */
function toBlocklyToolbox(json: ToolboxJson): Blockly.utils.toolbox.ToolboxInfo {
  return {
    kind: json.kind,
    contents: json.contents.map((category) => ({
      kind: category.kind,
      name: category.name,
      categorystyle: category.categorystyle,
      id: undefined,
      colour: undefined,
      cssconfig: undefined,
      hidden: undefined,
      contents: category.contents.map((block) =>
        block.disabledReasons === undefined
          ? { kind: block.kind, type: block.type }
          : { kind: block.kind, type: block.type, disabledReasons: [...block.disabledReasons] },
      ),
    })),
  };
}

function sameCheck(current: string[] | null, want: string | null): boolean {
  if (current === null || want === null) return current === want;
  return current.length === 1 && current[0] === want;
}

function renderCounter(node: HTMLElement, view: CounterView): void {
  setText(node, view.text);
  node.classList.toggle('is-over', view.over);
}

export class ProgramTab implements RobotTabView {
  readonly element = h('div', 'rs-program');
  private readonly blocksButton = hudButton('hud-btn hud-btn--soft rs-program__blocks', EDITOR_TEXT.blocks);
  private readonly blockCount = h('span', 'rs-counter');
  private readonly varCount = h('span', 'rs-counter');
  private readonly makeVariable = hudButton('hud-btn hud-btn--soft', EDITOR_TEXT.makeVariable);
  private readonly revertButton = hudButton('hud-btn hud-btn--ghost', EDITOR_TEXT.revert);
  private readonly saveButton = hudButton('hud-btn hud-btn--primary', EDITOR_TEXT.save);
  private readonly message = h('p', 'rs-message');
  private readonly note = h('p', 'rs-note');
  private readonly categories = h('div', 'rs-popover rs-program__categories');
  private readonly varForm = h('form', 'rs-popover rs-program__varform');
  private readonly varName = h('input', 'rs-input');
  private readonly varType = h('select', 'rs-input');
  private readonly status = h('p', 'rs-program__status');
  private readonly editor = h('div', 'rs-program__editor');
  private readonly context: RobotTabContext;
  private readonly phone: MediaQueryList | null;
  private api: BlocklyApi | null = null;
  private workspace: Blockly.WorkspaceSvg | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private requested = false;
  private disposed = false;
  private readOnly = false;
  private unlocks: RobotUnlocks | null = null;
  /** The program the workspace was last loaded from or saved to. */
  private baseline: RobotProgram | null = null;
  private dirty = false;
  /** True while this tab's own programRobot dispatch runs (its sync is not an outside change). */
  private saving = false;

  constructor(context: RobotTabContext) {
    this.context = context;
    const signal = context.signal;

    const toolbar = h('div', 'rs-toolbar');
    this.blocksButton.setAttribute('aria-haspopup', 'menu');
    toolbar.append(
      this.blocksButton,
      this.blockCount,
      this.varCount,
      this.makeVariable,
      h('span', 'rs-toolbar__spacer'),
      this.revertButton,
      this.saveButton,
    );
    this.message.setAttribute('role', 'status');
    this.note.hidden = true;
    this.categories.hidden = true;
    this.categories.setAttribute('role', 'menu');
    this.categories.setAttribute('aria-label', EDITOR_TEXT.blocks);
    const cancel = this.buildVariableForm();
    this.editor.hidden = true;
    this.element.append(toolbar, this.message, this.note, this.categories, this.varForm, this.status, this.editor);

    this.saveButton.addEventListener('click', () => this.save(), { signal });
    this.revertButton.addEventListener('click', () => this.revert(), { signal });
    this.makeVariable.addEventListener('click', () => this.openVariableForm(), { signal });
    this.varForm.addEventListener('submit', this.onVariableSubmit, { signal });
    cancel.addEventListener('click', () => this.closeVariableForm(), { signal });
    this.blocksButton.addEventListener(
      'click',
      () => {
        this.closeVariableForm();
        setHidden(this.categories, !this.categories.hidden);
      },
      { signal },
    );
    this.categories.addEventListener(
      'click',
      (event) => {
        const item = closestWithin(event, this.categories, 'button[data-index]');
        if (item !== null) this.selectCategory(Number(item.dataset.index));
      },
      { signal },
    );

    this.phone = typeof window.matchMedia === 'function' ? window.matchMedia(phoneQuery()) : null;
    this.phone?.addEventListener('change', () => this.applyLayout(), { signal });
  }

  open(state: GameState): void {
    const robot = findRobot(state, this.context.robotId);
    if (robot === null) return;
    this.readOnly = robot.power === 'ruined';
    this.unlocks = state.robots.unlocks;
    for (const button of [this.blocksButton, this.revertButton, this.saveButton]) setHidden(button, this.readOnly);
    this.syncVariableButton();
    setText(this.status, EDITOR_TEXT.opening);
    this.loadProgram(robot.program);
  }

  sync(state: GameState): void {
    const robot = findRobot(state, this.context.robotId);
    if (robot === null) return;
    if (state.robots.unlocks !== this.unlocks) this.syncUnlocks(state.robots.unlocks, robot);
    if (this.saving || robot.program === this.baseline || this.dirty) return;
    this.loadProgram(robot.program);
  }

  setActive(active: boolean): void {
    if (!active) {
      this.closeVariableForm();
      setHidden(this.categories, true);
      this.workspace?.hideChaff();
      return;
    }
    if (!this.requested) {
      this.requestEditor();
      return;
    }
    const api = this.api;
    const workspace = this.workspace;
    if (api !== null && workspace !== null) api.svgResize(workspace);
  }

  isDirty(): boolean {
    return this.dirty && !this.readOnly;
  }

  handleEscape(): boolean {
    if (!this.varForm.hidden) {
      this.closeVariableForm();
      return true;
    }
    if (!this.categories.hidden) {
      setHidden(this.categories, true);
      return true;
    }
    const api = this.api;
    const workspace = this.workspace;
    if (api === null || workspace === null) return false;
    if (api.WidgetDiv.isVisible()) {
      // A text editor cancels itself on this Escape (Blockly's own handler runs next); a context
      // menu has no Escape of its own, so close it here.
      const active = document.activeElement;
      if (!(active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement)) api.WidgetDiv.hide();
      return true;
    }
    if (api.DropDownDiv.isVisible()) {
      api.DropDownDiv.hideWithoutAnimation();
      return true;
    }
    const flyout = workspace.getFlyout();
    if (flyout !== null && flyout.autoClose && flyout.isVisible()) {
      workspace.getToolbox()?.clearSelection();
      return true;
    }
    return false;
  }

  dispose(): void {
    this.disposed = true;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    const workspace = this.workspace;
    if (workspace !== null) {
      workspace.hideChaff();
      workspace.dispose();
    }
    this.workspace = null;
    this.api = null;
  }

  // -------------------------------------------------------------------------
  // Loading
  // -------------------------------------------------------------------------

  private robot(): Robot | null {
    return findRobot(this.context.getState(), this.context.robotId);
  }

  private requestEditor(): void {
    this.requested = true;
    setHidden(this.status, false);
    setText(this.status, EDITOR_TEXT.opening);
    Promise.all([import('blockly/core'), import('blockly/msg/en')])
      .then(([api, messages]) => {
        if (this.disposed) return;
        api.setLocale({ ...messages });
        defineBlocks(api);
        this.build(api);
      })
      .catch(() => {
        if (this.disposed) return;
        setHidden(this.editor, true);
        setHidden(this.status, false);
        setText(this.status, EDITOR_TEXT.failed);
      });
  }

  private build(api: BlocklyApi): void {
    const state = this.context.getState();
    const robot = findRobot(state, this.context.robotId);
    if (robot === null) return;
    setHidden(this.status, true);
    setHidden(this.editor, false);
    const workspace = api.inject(this.editor, {
      renderer: 'zelos',
      theme: createTheme(api),
      toolbox: this.readOnly ? undefined : toBlocklyToolbox(toolboxFor(robot, state.robots.unlocks)),
      readOnly: this.readOnly,
      trashcan: !this.readOnly,
      zoom: EDITOR_ZOOM,
      move: { scrollbars: true, drag: true, wheel: false },
      sounds: false,
      // Relative to the page: public/blockly-media (copied from the package in Step 1) is served beside the page in the dev server, dist/ and dist-single/ opened from disk, never from Blockly's host.
      media: 'blockly-media/',
      comments: false,
      collapse: false,
      disable: false,
    });
    this.api = api;
    this.workspace = workspace;
    workspace.addChangeListener(this.onChange);
    this.loadProgram(robot.program);
    const observer = new ResizeObserver(() => api.svgResize(workspace));
    observer.observe(this.editor);
    this.resizeObserver = observer;
    this.buildCategoryMenu(state.robots.unlocks, robot);
    this.applyLayout();
  }

  /** Shows `program` as saved: no edits, no highlights, no message. */
  private loadProgram(program: RobotProgram): void {
    this.baseline = program;
    this.dirty = false;
    setText(this.message, '');
    const robot = this.robot();
    if (robot !== null) this.syncNote(robot, program);
    const api = this.api;
    const workspace = this.workspace;
    if (api === null || workspace === null) {
      if (robot !== null && program.kind === 'blocks') {
        this.showCounters(robot, countWorkspaceBlocks(programToWorkspace(program)), program.vars.length);
      } else if (robot !== null) {
        this.showCounters(robot, 0, 0);
      }
      return;
    }
    const json = program.kind === 'blocks' ? programToWorkspace(program) : EMPTY_WORKSPACE;
    api.Events.disable();
    try {
      api.serialization.workspaces.load({ ...json }, workspace);
      api.renderManagement.triggerQueuedRenders(workspace);
      this.respace(api, workspace);
      this.refreshChecks(workspace);
    } finally {
      api.Events.enable();
    }
    workspace.highlightBlock(null);
    workspace.scrollCenter();
    this.refreshCounters();
  }

  /** Top-level blocks in program order, each ROBOT_SCREEN.stackGap below the previous one's bottom. */
  private respace(api: BlocklyApi, workspace: Blockly.WorkspaceSvg): void {
    let y = 0;
    for (const block of workspace.getTopBlocks(false)) {
      block.moveTo(new api.utils.Coordinate(0, y));
      y += block.getHeightWidth().height + ROBOT_SCREEN.stackGap;
    }
  }

  private savedJson(api: BlocklyApi, workspace: Blockly.WorkspaceSvg): BlocklyWorkspaceJson {
    return api.serialization.workspaces.save(workspace) as BlocklyWorkspaceJson;
  }

  // -------------------------------------------------------------------------
  // Editing
  // -------------------------------------------------------------------------

  private readonly onChange = (event: Blockly.Events.Abstract): void => {
    const api = this.api;
    const workspace = this.workspace;
    if (api === null || workspace === null || event.isUiEvent) return;
    if (event instanceof api.Events.BlockChange) this.followFieldChange(api, workspace, event);
    this.refreshChecks(workspace);
    workspace.highlightBlock(null);
    this.refreshCounters();
    if (!this.readOnly) this.dirty = true;
  };

  private followFieldChange(api: BlocklyApi, workspace: Blockly.WorkspaceSvg, event: Blockly.Events.BlockChange): void {
    if (event.element !== 'field' || event.blockId === undefined) return;
    const block = workspace.getBlockById(event.blockId);
    const before = typeof event.oldValue === 'string' ? event.oldValue : null;
    const after = typeof event.newValue === 'string' ? event.newValue : null;
    if (block === null || before === null || after === null || before === after) return;
    if (event.name === 'NAME' && block.type === 'fc_varDecl') {
      this.rename(workspace, ['fc_var', 'fc_set', 'fc_change'], 'VAR', before, after);
    } else if (event.name === 'NAME' && block.type === 'fc_helper') {
      this.rename(workspace, ['fc_runHelper'], 'NAME', before, after);
    } else if (event.name === 'TYPE' && block.type === 'fc_varDecl' && isValueType(after)) {
      this.resetInitial(api, workspace, block, after);
    }
  }

  private rename(workspace: Blockly.WorkspaceSvg, types: readonly string[], field: string, before: string, after: string): void {
    for (const type of types) {
      for (const block of workspace.getBlocksByType(type, false)) {
        if (block.getFieldValue(field) === before) block.setFieldValue(after, field);
      }
    }
  }

  /** A declaration whose type changed starts at that type's default literal. */
  private resetInitial(api: BlocklyApi, workspace: Blockly.WorkspaceSvg, declaration: Blockly.Block, type: ValueType): void {
    const robot = this.robot();
    const connection = declaration.getInput('INITIAL')?.connection ?? null;
    if (robot === null || connection === null) return;
    connection.targetBlock()?.dispose(false);
    connection.setCheck(VALUE_CHECKS[type]);
    const literal = api.serialization.blocks.append(defaultLiteral(type, robot), workspace);
    if (literal.outputConnection !== null) connection.connect(literal.outputConnection);
  }

  /** Each declaration's INITIAL takes its type; each fc_var's output takes its declaration's type. */
  private refreshChecks(workspace: Blockly.WorkspaceSvg): void {
    const declared = new Map<string, ValueType>();
    for (const declaration of workspace.getBlocksByType('fc_varDecl', false)) {
      const type: unknown = declaration.getFieldValue('TYPE');
      if (!isValueType(type)) continue;
      const name = String(declaration.getFieldValue('NAME') ?? '');
      if (!declared.has(name)) declared.set(name, type);
      const initial = declaration.getInput('INITIAL')?.connection ?? null;
      if (initial !== null && !sameCheck(initial.getCheck(), VALUE_CHECKS[type])) initial.setCheck(VALUE_CHECKS[type]);
    }
    for (const getter of workspace.getBlocksByType('fc_var', false)) {
      const type = declared.get(String(getter.getFieldValue('VAR') ?? ''));
      const check = type === undefined ? null : VALUE_CHECKS[type];
      const output = getter.outputConnection;
      if (output !== null && !sameCheck(output.getCheck(), check)) output.setCheck(check);
    }
  }

  private refreshCounters(): void {
    const api = this.api;
    const workspace = this.workspace;
    const robot = this.robot();
    if (api === null || workspace === null || robot === null) return;
    this.showCounters(robot, countWorkspaceBlocks(this.savedJson(api, workspace)), workspace.getBlocksByType('fc_varDecl', false).length);
  }

  private showCounters(robot: Robot, blocks: number, variables: number): void {
    renderCounter(this.blockCount, blockCounter(blocks, robot.size));
    renderCounter(this.varCount, variableCounter(variables, robot.size));
    setHidden(this.varCount, !this.variablesUnlocked() && variables === 0);
  }

  // -------------------------------------------------------------------------
  // Save and Revert
  // -------------------------------------------------------------------------

  private save(): void {
    const api = this.api;
    const workspace = this.workspace;
    const robot = this.robot();
    if (api === null || workspace === null || robot === null || this.readOnly) return;
    workspace.highlightBlock(null);
    const result = workspaceToProgram(this.savedJson(api, workspace));
    if ('error' in result) {
      setText(this.message, result.error);
      if (result.blockId !== null) workspace.highlightBlock(result.blockId, true);
      return;
    }
    if (result.loose.length > 0) {
      setText(this.message, EDITOR_TEXT.loose);
      for (const id of result.loose) workspace.highlightBlock(id, true);
      return;
    }
    const program = result.program;
    if (!isProgramShape(program)) {
      setText(this.message, EDITOR_TEXT.tooBig);
      return;
    }
    const problem = checkProgram(program, robot);
    if (problem !== null) {
      setText(this.message, problem);
      return;
    }
    setText(this.message, '');
    const before = robot.program;
    this.saving = true;
    try {
      this.context.dispatch(actions.programRobot(robot.id, program));
    } finally {
      this.saving = false;
    }
    const after = this.robot();
    if (after !== null && after.program !== before) {
      this.baseline = after.program;
      this.dirty = false;
      this.syncNote(after, after.program);
    }
  }

  private revert(): void {
    const robot = this.robot();
    if (robot !== null && !this.readOnly) this.loadProgram(robot.program);
  }

  // -------------------------------------------------------------------------
  // Variables
  // -------------------------------------------------------------------------

  private variablesUnlocked(): boolean {
    return this.unlocks?.blocks.includes('var') ?? false;
  }

  private syncVariableButton(): void {
    setHidden(this.makeVariable, this.readOnly || !this.variablesUnlocked());
  }

  /** Builds the in-screen "Make a variable" form; returns its Cancel button. */
  private buildVariableForm(): HTMLButtonElement {
    this.varForm.hidden = true;
    this.varForm.setAttribute('aria-label', EDITOR_TEXT.makeVariable);
    this.varName.type = 'text';
    this.varName.maxLength = ROBOTS.maxIdentifierLength;
    this.varName.autocomplete = 'off';
    this.varName.spellcheck = false;
    for (const type of VALUE_TYPES) {
      const option = h('option', '', VALUE_TYPE_LABELS[type]);
      option.value = type;
      this.varType.append(option);
    }
    const nameLabel = h('label', '', 'Name');
    nameLabel.append(this.varName);
    const typeLabel = h('label', '', 'Type');
    typeLabel.append(this.varType);
    const add = hudButton('hud-btn hud-btn--primary', 'Add');
    add.type = 'submit';
    const cancel = hudButton('hud-btn hud-btn--ghost', 'Cancel');
    const buttons = h('div', 'rs-program__varactions');
    buttons.append(cancel, add);
    this.varForm.append(nameLabel, typeLabel, buttons);
    return cancel;
  }

  private openVariableForm(): void {
    if (this.workspace === null) return;
    setHidden(this.categories, true);
    this.varName.value = '';
    this.varType.value = VALUE_TYPES[0];
    setHidden(this.varForm, false);
    this.varName.focus();
  }

  private closeVariableForm(): void {
    setHidden(this.varForm, true);
  }

  private readonly onVariableSubmit = (event: SubmitEvent): void => {
    event.preventDefault();
    const name = this.varName.value.trim();
    const type = this.varType.value;
    if (name === '') {
      this.varName.focus();
      return;
    }
    if (!isValueType(type)) return;
    this.addDeclaration(name, type);
    this.closeVariableForm();
  };

  /** "Variable [name] is a [type] starting at [default]" at the top-left of the view. */
  private addDeclaration(name: string, type: ValueType): void {
    const api = this.api;
    const workspace = this.workspace;
    const robot = this.robot();
    if (api === null || workspace === null || robot === null) return;
    const view = workspace.getMetricsManager().getViewMetrics(true);
    api.serialization.blocks.append(declarationState(name, type, robot, view.left + DECLARATION_INSET, view.top + DECLARATION_INSET), workspace);
  }

  // -------------------------------------------------------------------------
  // Toolbox, layout and notes
  // -------------------------------------------------------------------------

  private syncUnlocks(unlocks: RobotUnlocks, robot: Robot): void {
    this.unlocks = unlocks;
    this.syncVariableButton();
    const workspace = this.workspace;
    if (workspace !== null && !this.readOnly) {
      workspace.updateToolbox(toBlocklyToolbox(toolboxFor(robot, unlocks)));
      this.buildCategoryMenu(unlocks, robot);
      this.applyLayout();
    }
    if (workspace !== null) this.refreshCounters();
    else if (robot.program.kind === 'blocks') this.showCounters(robot, countWorkspaceBlocks(programToWorkspace(robot.program)), robot.program.vars.length);
    else this.showCounters(robot, 0, 0);
  }

  /** The phone layout's category menu, in toolbox order. */
  private buildCategoryMenu(unlocks: RobotUnlocks, robot: Robot): void {
    const toolbox = toolboxFor(robot, unlocks);
    this.categories.replaceChildren(
      ...toolbox.contents.map((category, index) => {
        const item = hudButton('rs-program__category', category.name);
        item.dataset.index = String(index);
        item.setAttribute('role', 'menuitem');
        item.style.setProperty('--dot', CATEGORY_COLOURS[category.category].primary);
        return item;
      }),
    );
  }

  private selectCategory(index: number): void {
    setHidden(this.categories, true);
    this.workspace?.getToolbox()?.selectItemByPosition(index);
  }

  /** Phone width hides the category column (the "Blocks" menu replaces it). */
  private applyLayout(): void {
    const api = this.api;
    const workspace = this.workspace;
    if (api === null || workspace === null) return;
    const phone = this.phone?.matches === true;
    workspace.getToolbox()?.setVisible(!phone);
    if (!phone) setHidden(this.categories, true);
    api.svgResize(workspace);
  }

  private syncNote(robot: Robot, program: RobotProgram): void {
    const script = program.kind === 'script';
    setHidden(this.note, !script);
    setText(this.note, script ? scriptNote(robot.name) : '');
  }
}
```

**4e. `src/ui/robotScreen/RobotScreen.ts`.** Add the import beside the other tab imports:

```ts
import { ProgramTab } from './tabs/ProgramTab';
```

and add Program as the first entry of `TAB_FACTORIES`:

```ts
const TAB_FACTORIES: Partial<Record<RobotTab, TabFactory>> = {
  program: (context) => new ProgramTab(context),
  looks: (context) => new LooksTab(context),
  stats: (context) => new StatsTab(context),
  log: (context) => new LogTab(context),
};
```

- [ ] **Step 5: Run the tests and see them pass**

Run: `npx vitest run tests/robotScreen.test.ts`
Expected: PASS (the Task 11 cases and the new `toolboxFor`, `dropdownOptions`, `menu fields`, `the editor helpers` and `block definitions` cases).

- [ ] **Step 6: The full gate**

Run: `npm run typecheck && npm test && npm run build`
Expected: all green. The build now emits two more lazy chunks: one holding `blockly/core` (the largest asset, several hundred KB before gzip) and a small `en-*.js` for the messages. Blockly stays out of the main and screen chunks: run

```bash
node -e "const fs=require('fs');for(const f of fs.readdirSync('dist/assets').filter(n=>/^(index|RobotScreen)-.*\.js\.map$/.test(n)))console.log(f,JSON.parse(fs.readFileSync('dist/assets/'+f,'utf8')).sources.some(s=>s.includes('node_modules/blockly/')))"
```

It prints `false` for the `index-*.js.map` file and for the `RobotScreen-*.js.map` file, since neither source map lists `node_modules/blockly/`. (A `grep` for `FieldDropdown` would find the screen chunk, because `blockDefs.ts` names `api.FieldDropdown`, so don't use one.)

- [ ] **Step 7: Browser check**

Use the `game-driven-qa` skill as in Task 11, Step 6 (fresh farm, probe loaded, time scale 1). Then:

1. Program a robot with values outside the editor's usual options, and keep a copy:
   ```js
   __meadowlight.addRobot('waterer', { tx: 6, tz: 6, facing: 2 });
   const b = __meadowlight.blocks;
   __meadowlight.setProgram('Drizzle', b.program({
     vars: [{ name: 'aVeryLongName123', type: 'number', initial: b.n(7) }],
     stacks: [b.when(b.atTime(583), b.take('hoe'), b.change('aVeryLongName123', 1), b.wait(b.v('aVeryLongName123')))],
   }));
   window.__saved = JSON.stringify(__qa.robot('Drizzle').program);
   ```
   → "Programmed Drizzle.". Bench it as in Task 11, Step 6.1 (two E presses).
2. The Program tab is first and active. "Opening the editor…" shows briefly, then the workspace: cream background, rounded Zelos blocks, the categories "Triggers", "Control", "Actions" and "Values" (no "Sensors" under job 1's unlocks). The stack reads "When it's 9:43 am", "Take Hoe" (with the `fc_item` block), "Change aVeryLongName123 by 1", "Wait aVeryLongName123 minutes", and the declaration sits above it. The counter reads "5 / 12 blocks" and "1 / 1 variables". Screenshot.
3. Save unchanged: click "Save" → toast "Programmed Drizzle."; `JSON.stringify(__qa.robot('Drizzle').program) === window.__saved` → `true` (review focus 4).
4. Escape in a dropdown: click the "9:43 am" field (find it in the screenshot). The time menu opens with "9:43 am" between "9:40 am" and "9:50 am". `await __qa.key('Escape')`: the menu closes and `__qa.state().ui.panel.kind === 'robot'`.
5. Typing stays in the editor: click the variable name field on the declaration, then `await __qa.key('KeyE'); await __qa.key('KeyW'); await __qa.key('Space')` (also type with `computer type "ew "`): the player doesn't move, the panel stays open, and the field shows the typed text. Press Escape: the edit is cancelled, the name is back to "aVeryLongName123", and the screen stays open.
6. A loose block: open "Actions", drag "Move forward" onto empty workspace (`computer left_click_drag`), click "Save": "Every block must be inside a When … stack or a helper." shows under the toolbar and the block is outlined red; the robot's program is unchanged. Click "Revert": the loose block is gone and the message cleared.
7. Over the limit: drag eight "Move forward" blocks into the stack, one under another, until the counter reads "13 / 12 blocks" in red; "Save" shows "Mini robots hold 12 blocks; this program has 13." and nothing is saved. "Revert".
8. Make a variable: Drizzle (a Mini) already has one; `__meadowlight.unlockAll()` (the screen closes, because `unlockAll` reloads the state; press E at the bench to reopen it), then open the Program tab and click "Make a variable", type "spare", choose "Tile", click "Add": a "Variable spare is a Tile starting at tile X 6 Z 4" block appears, and the counter reads "2 / 1 variables" in red. Change its type to "Number": the literal becomes 0. "Revert".
9. Sensor eye: after `unlockAll()` (the screen closes; press E at the bench to reopen it, then open the Program tab), open "Sensors": "tile ahead is", "it is raining" and "time is after" are greyed; hovering one shows "Needs a sensor eye"; it can't be dragged out.
10. Close with edits: drag one block in, press Escape → "Discard your changes to Drizzle's program?"; "Keep editing" keeps the screen; Escape again and "Discard" closes it; reopen: the edit is gone.
11. A script robot: reopen the bench (E at the bench) and click "Lift off": Drizzle is carried and the screen closes. Put it down away from the bench: `__qa.patch((s) => { s.player.tx = 6; s.player.tz = 8; s.player.facing = 2; })`, `await __qa.key('KeyE')`. Then `__meadowlight.addRobot('spinner', { tx: 6, tz: 6, facing: 2 })` and bench Spinner as in Task 11, Step 6.1: the Program tab shows "Spinner runs a fixed script. Saving here replaces it with a block program." over an empty workspace, and the counter reads "0 / 12 blocks".
12. Phone: `resize_window {preset: "mobile"}`, reload without `?new`, reopen the bench: the category column is gone and "Blocks" opens the category menu; picking "Actions" opens its flyout. Screenshot, then `resize_window {preset: "desktop"}`.
13. `read_console_messages {onlyErrors: true}` shows nothing.

Report one line per check.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json public/blockly-media src/ui/robotScreen/blockly/toolbox.ts src/ui/robotScreen/blockly/theme.ts src/ui/robotScreen/blockly/blockDefs.ts src/ui/robotScreen/tabs/ProgramTab.ts src/ui/robotScreen/RobotScreen.ts tests/robotScreen.test.ts
git commit -m "Farmclaws part 3: the Program tab, a lazily loaded Blockly editor

Blockly 13 (blockly/core and its English messages) loads the first time the
tab shows. One JSON block definition per language block type, a Zelos theme
from the HUD palette, an unlock-filtered toolbox with sensor-eye sensors
disabled ('Needs a sensor eye'), counters, Save and Revert, and highlighted
loose and failing blocks.

Rulings: Blockly's FieldDropdown rejects values outside its cached options,
so every data dropdown is a registered field_fc_* subclass that accepts and
shows any well-formed value (dropdownOptions also takes 'every'). The saved
program loads with events disabled and is re-spaced stackGap apart, so
loading is never an edit. 'Make a variable' is an in-screen form; a changed
declaration type swaps in its default literal, and renames follow to uses.
On phones the category column hides behind a Blocks menu. A program
isProgramShape rejects shows 'This program is too big or too deeply nested
to save.'. Blockly's media are copied into public/blockly-media and served
by the game, since the package exports no media path.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: The .MD tab

**Files:**
- Modify: `src/config.ts` (`ROBOT_SCREEN` gains `cardDefaults`)
- Create: `src/ui/robotScreen/mdFields.ts` (pure)
- Create: `src/ui/robotScreen/tabs/MdTab.ts`
- Modify: `src/ui/robotScreen/RobotScreen.ts` (the import list, and the doc comment and `TAB_FACTORIES`, now complete)
- Test: `tests/robotScreen.test.ts` (extend)

**Interfaces:**
- Consumes:
  - Task 4: `MD_CARD_KINDS`, `RobotUnlocks` (`cards` in canonical order), `UNLOCKS.job1`, `ALL_UNLOCKS`.
  - Task 2 / 5 / 7: `actions.setRobotMd(robotId, md)`; the reducer runs `withMd` (the same checks), refuses a robot off the bench or ruined, and toasts "Set {name}'s .MD." on success.
  - Task 10: `ROBOT_SCREEN` (this task adds a key to it).
  - Task 11: `RobotTabContext`, `RobotTabView`, `TAB_FACTORIES`, the `.rs-md*` styles.
  - Task 12: `dropdownOptions(kind, current)` (`src/ui/robotScreen/blockly/toolbox.ts`), so the .MD's zone, crop, item and time dropdowns match the editor's and keep an unusual current value.
  - Part 2: `checkMd(md, robot)` (`src/robots/check.ts`), `isMdShape` (`src/state/robotValidation.ts`), `isItemId`, `MAPS`.
- Produces:
  - `src/config.ts`: `ROBOT_SCREEN.cardDefaults = { returnMinute: 1080, tokensBelow: 10 }` (a new DO return is at 6:00 pm; switching a power-down card to "tokens are below" starts at 10).
  - `src/ui/robotScreen/mdFields.ts`: `MdCardKind`, `MdFieldKey`, `MdField`; `cardFields(card: MdCard, size: RobotSize): readonly MdField[]`; `newCard(kind: MdCardKind): MdCard`; `setCardValue(card, key, raw, robot): MdCard`; `cardSection(card): 'do' | 'dont'`; `moveCard(cards, index, step)`; `removeCard(cards, index)`; `addCardOptions(unlocks)`; `CARD_LABELS`; `mdTitle(name)`; `mdCountText(md, size): string` ("{n} / {limit} cards"); `mdOverLimit(md, size)`; `isMdFieldKey`; `MD_TEXT`.
  - `src/ui/robotScreen/tabs/MdTab.ts`: `MdTab implements RobotTabView`; Save dispatches `actions.setRobotMd`.

Rules this task settles (recorded in the commit message):
- The .MD shows as the design's markdown card: "# {NAME}.MD", then "## DO" and "## DON'T", each card one line of text and fields. Cards keep one list in .MD order (DO returns tie by that order); "↑" and "↓" swap a card with the nearest card of its own section.
- `newCard` takes only the kind (the contract's `robot` argument would be unused): a DO return starts at "the nearest generator" at `cardDefaults.returnMinute`. Switching a return to "a tile" starts at the robot's tile; the player edits X and Z.
- A number field that isn't a whole number leaves the card unchanged and is redrawn with the card's value. Range rules (tiles on the farm, 1 … battery tokens) stay with `checkMd`, whose sentence shows under the toolbar on Save. The "Power down below [n] tokens" field's maximum is the robot's battery, `batteryFor(size)`, as `checkMd` caps it, so `cardFields` takes the robot's size.
- The sentences the spec doesn't give: "No cards yet." under an empty section, and "These cards can't be saved." when `isMdShape` refuses (the editor only builds well-formed cards, so this guards the gate rather than a reachable state).

- [ ] **Step 1: Write the failing tests**

In `tests/robotScreen.test.ts`, add to the imports:

```ts
import { checkMd } from '../src/robots/check';
import {
  CARD_LABELS,
  MD_TEXT,
  addCardOptions,
  cardFields,
  cardSection,
  isMdFieldKey,
  mdCountText,
  mdOverLimit,
  mdTitle,
  moveCard,
  newCard,
  removeCard,
  setCardValue,
} from '../src/ui/robotScreen/mdFields';
```

and add `MD_CARD_KINDS` and `MdCard` to the existing `../src/core/types` import (`import { MD_CARD_KINDS, type GameState, type MdCard, type RobotLogEntry, type RobotLogEvent } from '../src/core/types';`), and add `import { batteryFor } from '../src/robots/stats';` beside the other `../src/robots` imports. Then append:

```ts
describe('.MD card fields', () => {
  const ZONES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map((zone) => [`Zone ${zone}`, zone]);

  it('gives each card its words and fields', () => {
    expect(cardFields({ kind: 'dontLeave', zone: 'B' }, 'mini')).toEqual([
      { kind: 'text', text: 'Leave' },
      { kind: 'select', key: 'zone', label: 'Zone', value: 'B', options: ZONES },
    ]);
    expect(cardFields({ kind: 'dontGoIntoWater' }, 'mini')).toEqual([{ kind: 'text', text: 'Go into water' }]);
    expect(cardFields({ kind: 'dontHarvest', cropId: 'pumpkin' }, 'mini')[1]).toMatchObject({ kind: 'select', key: 'cropId', value: 'pumpkin' });
    expect(cardFields({ kind: 'dontDeposit', itemId: 'hoe' }, 'mini')[1]).toMatchObject({ kind: 'select', key: 'itemId', value: 'hoe' });
  });

  it('shows a DO return to a tile as two number fields and a time', () => {
    expect(cardFields({ kind: 'doReturn', to: { kind: 'tile', tx: 4, tz: 9 }, minute: 1080 }, 'mini')).toEqual([
      { kind: 'text', text: 'Return to' },
      { kind: 'select', key: 'to', label: 'Where', value: 'tile', options: [['a tile', 'tile'], ['the nearest generator', 'generator']] },
      { kind: 'number', key: 'tx', label: 'X', value: 4, min: 0, max: 47 },
      { kind: 'number', key: 'tz', label: 'Z', value: 9, min: 0, max: 39 },
      { kind: 'text', text: 'at' },
      { kind: 'select', key: 'minute', label: 'Time', value: '1080', options: dropdownOptions('minute', 1080) },
    ]);
  });

  it("keeps a card's unusual time in its dropdown", () => {
    const fields = cardFields({ kind: 'doReturn', to: { kind: 'generator' }, minute: 583 }, 'mini');
    expect(fields).toHaveLength(4);
    const time = fields[3];
    expect(time?.kind === 'select' && time.options.some(([label, value]) => label === '9:43 am' && value === '583')).toBe(true);
  });

  it('shows the token count only for "tokens are below"', () => {
    expect(cardFields({ kind: 'doPowerDown', when: { kind: 'tokensBelow', n: 10 } }, 'mini')).toEqual([
      { kind: 'text', text: 'Power down when' },
      {
        kind: 'select',
        key: 'when',
        label: 'When',
        value: 'tokensBelow',
        options: [['my bag is full', 'bagFull'], ['tokens are below', 'tokensBelow'], ['it rains', 'raining']],
      },
      { kind: 'number', key: 'n', label: 'Tokens', value: 10, min: 1, max: batteryFor('mini') },
    ]);
    expect(cardFields({ kind: 'doPowerDown', when: { kind: 'tokensBelow', n: 10 } }, 'big')[2]).toMatchObject({ max: batteryFor('big') });
    expect(cardFields({ kind: 'doPowerDown', when: { kind: 'raining' } }, 'mini')).toHaveLength(2);
  });
});

describe('.MD editing', () => {
  const robot = robotOf({ tx: 6, tz: 4 });

  it('makes a valid card of every kind', () => {
    expect(MD_CARD_KINDS.map((kind) => newCard(kind))).toEqual([
      { kind: 'dontLeave', zone: 'A' },
      { kind: 'dontGoIntoWater' },
      { kind: 'dontHarvest', cropId: 'parsnip' },
      { kind: 'dontDeposit', itemId: 'parsnip' },
      { kind: 'doReturn', to: { kind: 'generator' }, minute: ROBOT_SCREEN.cardDefaults.returnMinute },
      { kind: 'doPowerDown', when: { kind: 'bagFull' } },
    ]);
    for (const kind of MD_CARD_KINDS) expect([kind, checkMd([newCard(kind)], robotOf())]).toEqual([kind, null]);
  });

  it('changes one field at a time, ignoring values that are not of its kind', () => {
    expect(setCardValue({ kind: 'dontLeave', zone: 'A' }, 'zone', 'C', robot)).toEqual({ kind: 'dontLeave', zone: 'C' });
    expect(setCardValue({ kind: 'dontLeave', zone: 'A' }, 'zone', 'Q', robot)).toEqual({ kind: 'dontLeave', zone: 'A' });
    expect(setCardValue({ kind: 'dontHarvest', cropId: 'parsnip' }, 'cropId', 'corn', robot)).toEqual({ kind: 'dontHarvest', cropId: 'corn' });
    expect(setCardValue({ kind: 'dontDeposit', itemId: 'parsnip' }, 'itemId', 'wood', robot)).toEqual({ kind: 'dontDeposit', itemId: 'wood' });
    expect(setCardValue({ kind: 'dontDeposit', itemId: 'parsnip' }, 'zone', 'A', robot)).toEqual({ kind: 'dontDeposit', itemId: 'parsnip' });
  });

  it('switches a DO return between a tile and the nearest generator', () => {
    const toGenerator: MdCard = { kind: 'doReturn', to: { kind: 'generator' }, minute: 1080 };
    const toTile = setCardValue(toGenerator, 'to', 'tile', robot);
    expect(toTile).toEqual({ kind: 'doReturn', to: { kind: 'tile', tx: 6, tz: 4 }, minute: 1080 });
    expect(setCardValue(toTile, 'tx', '12', robot)).toEqual({ kind: 'doReturn', to: { kind: 'tile', tx: 12, tz: 4 }, minute: 1080 });
    expect(setCardValue(toTile, 'tz', ' 7 ', robot)).toEqual({ kind: 'doReturn', to: { kind: 'tile', tx: 6, tz: 7 }, minute: 1080 });
    expect(setCardValue(toTile, 'tx', '1.5', robot)).toBe(toTile);
    expect(setCardValue(toTile, 'minute', '583', robot)).toEqual({ kind: 'doReturn', to: { kind: 'tile', tx: 6, tz: 4 }, minute: 583 });
    expect(setCardValue(toTile, 'to', 'generator', robot)).toEqual(toGenerator);
    expect(setCardValue(toGenerator, 'tx', '3', robot)).toBe(toGenerator);
  });

  it('switches a power-down condition, starting the token count from config', () => {
    const bagFull: MdCard = { kind: 'doPowerDown', when: { kind: 'bagFull' } };
    const below = setCardValue(bagFull, 'when', 'tokensBelow', robot);
    expect(below).toEqual({ kind: 'doPowerDown', when: { kind: 'tokensBelow', n: ROBOT_SCREEN.cardDefaults.tokensBelow } });
    expect(setCardValue(below, 'n', '25', robot)).toEqual({ kind: 'doPowerDown', when: { kind: 'tokensBelow', n: 25 } });
    expect(setCardValue(below, 'when', 'raining', robot)).toEqual({ kind: 'doPowerDown', when: { kind: 'raining' } });
    expect(setCardValue(bagFull, 'n', '25', robot)).toBe(bagFull);
  });

  it('sorts cards into DO and DON\'T and reorders within a section', () => {
    const cards: MdCard[] = [
      { kind: 'dontLeave', zone: 'A' },
      { kind: 'doPowerDown', when: { kind: 'bagFull' } },
      { kind: 'dontGoIntoWater' },
      { kind: 'doReturn', to: { kind: 'generator' }, minute: 1080 },
    ];
    expect(cards.map(cardSection)).toEqual(['dont', 'do', 'dont', 'do']);
    expect(moveCard(cards, 2, -1)).toEqual([cards[2], cards[1], cards[0], cards[3]]);
    expect(moveCard(cards, 1, 1)).toEqual([cards[0], cards[3], cards[2], cards[1]]);
    expect(moveCard(cards, 0, -1)).toBe(cards);
    expect(moveCard(cards, 3, 1)).toBe(cards);
    expect(removeCard(cards, 1)).toEqual([cards[0], cards[2], cards[3]]);
  });

  it('offers only the unlocked card kinds', () => {
    expect(addCardOptions(UNLOCKS.job1)).toEqual([
      { kind: 'dontLeave', label: CARD_LABELS.dontLeave },
      { kind: 'dontGoIntoWater', label: CARD_LABELS.dontGoIntoWater },
    ]);
    expect(addCardOptions(ALL_UNLOCKS).map((option) => option.kind)).toEqual([...MD_CARD_KINDS]);
    expect(CARD_LABELS.dontLeave).toBe("DON'T leave a zone");
  });

  it('titles the card and counts it against the size', () => {
    expect(mdTitle('Bolt')).toBe('# BOLT.MD');
    expect(mdCountText([newCard('dontGoIntoWater'), newCard('dontLeave')], 'mini')).toBe('2 / 3 cards');
    expect(mdCountText([], 'big')).toBe('0 / 10 cards');
    const four = [newCard('dontGoIntoWater'), newCard('dontLeave'), newCard('dontHarvest'), newCard('dontDeposit')];
    expect(mdOverLimit(four, 'mini')).toBe(true);
    expect(mdOverLimit(four, 'standard')).toBe(false);
  });

  it('knows its field keys and sentences', () => {
    expect(['zone', 'cropId', 'itemId', 'to', 'tx', 'tz', 'minute', 'when', 'n'].every(isMdFieldKey)).toBe(true);
    expect(isMdFieldKey('kind')).toBe(false);
    expect(MD_TEXT.scriptOnly).toBe('.MD cards only apply to block programs.');
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run tests/robotScreen.test.ts`
Expected: FAIL to load — `Error: Cannot find module '../src/ui/robotScreen/mdFields'`.

- [ ] **Step 3: Implement**

**3a. `src/config.ts`.** Replace the `ROBOT_SCREEN` constant Task 10 added:

```ts
/** The robot screen (farmclaws part 3 spec §4, §5). */
export const ROBOT_SCREEN = {
  /** Below this window width (px) the robot screen uses its phone layout. */
  phoneMaxWidth: 700,
  /** Vertical gap (px) between the top-level stacks of a loaded program. */
  stackGap: 40,
  /** Minutes between the options of the editor's time dropdowns. */
  timeStep: 10,
} as const;
```

with:

```ts
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
```

**3b. Create `src/ui/robotScreen/mdFields.ts`:**

```ts
/**
 * The .MD tab's pure rules (farmclaws part 3 spec §4.3): each card's words and fields, new
 * cards, field edits, ordering, the cards a player may add, and the counter. No DOM, so
 * tests/robotScreen.test.ts covers it; MdTab.ts draws what these return. checkMd stays the only
 * judge of whether the cards are allowed.
 */
import { ROBOTS, ROBOT_SCREEN } from '../../config';
import {
  CROP_IDS,
  MD_CARD_KINDS,
  ZONE_IDS,
  type CropId,
  type MdCard,
  type Robot,
  type RobotSize,
  type RobotUnlocks,
  type ZoneId,
} from '../../core/types';
import { isItemId } from '../../items/items';
import { batteryFor } from '../../robots/stats';
import { MAPS } from '../../world/maps';
import { dropdownOptions } from './blockly/toolbox';

export type MdCardKind = MdCard['kind'];

/** A card value a field edits. */
export type MdFieldKey = 'zone' | 'cropId' | 'itemId' | 'to' | 'tx' | 'tz' | 'minute' | 'when' | 'n';

const FIELD_KEYS: readonly MdFieldKey[] = ['zone', 'cropId', 'itemId', 'to', 'tx', 'tz', 'minute', 'when', 'n'];

export type MdField =
  | { readonly kind: 'text'; readonly text: string }
  | {
      readonly kind: 'select';
      readonly key: MdFieldKey;
      /** The accessible name. */
      readonly label: string;
      readonly value: string;
      readonly options: readonly (readonly [label: string, value: string])[];
    }
  | {
      readonly kind: 'number';
      readonly key: MdFieldKey;
      readonly label: string;
      readonly value: number;
      readonly min: number;
      readonly max: number;
    };

export const MD_TEXT = {
  scriptOnly: '.MD cards only apply to block programs.',
  cantSave: "These cards can't be saved.",
  noCards: 'No cards yet.',
  addCard: 'Add a card',
  save: 'Save',
  doHeading: '## DO',
  dontHeading: "## DON'T",
} as const;

/** The "Add a card" menu's words for each kind. */
export const CARD_LABELS: Readonly<Record<MdCardKind, string>> = {
  dontLeave: "DON'T leave a zone",
  dontGoIntoWater: "DON'T go into water",
  dontHarvest: "DON'T harvest a crop",
  dontDeposit: "DON'T deposit an item",
  doReturn: 'DO return somewhere at a time',
  doPowerDown: 'DO power down when…',
};

const RETURN_TO: readonly (readonly [string, string])[] = [
  ['a tile', 'tile'],
  ['the nearest generator', 'generator'],
];

const POWER_WHEN: readonly (readonly [string, string])[] = [
  ['my bag is full', 'bagFull'],
  ['tokens are below', 'tokensBelow'],
  ['it rains', 'raining'],
];

const FARM = MAPS.farm.grid;
const WHOLE_NUMBER = /^-?\d+$/;

function isCropId(value: string): value is CropId {
  return (CROP_IDS as readonly string[]).includes(value);
}

function isZoneId(value: string): value is ZoneId {
  return (ZONE_IDS as readonly string[]).includes(value);
}

export function isMdFieldKey(value: string | undefined): value is MdFieldKey {
  return (FIELD_KEYS as readonly (string | undefined)[]).includes(value);
}

function wholeNumber(raw: string): number | null {
  const trimmed = raw.trim();
  return WHOLE_NUMBER.test(trimmed) ? Number(trimmed) : null;
}

const text = (words: string): MdField => ({ kind: 'text', text: words });
const select = (key: MdFieldKey, label: string, value: string, options: readonly (readonly [string, string])[]): MdField => ({
  kind: 'select',
  key,
  label,
  value,
  options,
});
const numberField = (key: MdFieldKey, label: string, value: number, min: number, max: number): MdField => ({
  kind: 'number',
  key,
  label,
  value,
  min,
  max,
});

/** A card's line: its words with dropdowns and number fields (spec §4.3). The token count goes up to the battery of a robot of `size`, as checkMd allows. */
export function cardFields(card: MdCard, size: RobotSize): readonly MdField[] {
  switch (card.kind) {
    case 'dontLeave':
      return [text('Leave'), select('zone', 'Zone', card.zone, dropdownOptions('zone', card.zone))];
    case 'dontGoIntoWater':
      return [text('Go into water')];
    case 'dontHarvest':
      return [text('Harvest'), select('cropId', 'Crop', card.cropId, dropdownOptions('crop', card.cropId))];
    case 'dontDeposit':
      return [text('Deposit'), select('itemId', 'Item', card.itemId, dropdownOptions('item', card.itemId))];
    case 'doReturn': {
      const to = card.to;
      const tile =
        to.kind === 'tile' ? [numberField('tx', 'X', to.tx, 0, FARM.width - 1), numberField('tz', 'Z', to.tz, 0, FARM.depth - 1)] : [];
      return [
        text('Return to'),
        select('to', 'Where', to.kind, RETURN_TO),
        ...tile,
        text('at'),
        select('minute', 'Time', String(card.minute), dropdownOptions('minute', card.minute)),
      ];
    }
    case 'doPowerDown': {
      const when = card.when;
      const tokens = when.kind === 'tokensBelow' ? [numberField('n', 'Tokens', when.n, 1, batteryFor(size))] : [];
      return [text('Power down when'), select('when', 'When', when.kind, POWER_WHEN), ...tokens];
    }
  }
}

/** A new card of `kind`, with values the checker accepts for any size. */
export function newCard(kind: MdCardKind): MdCard {
  switch (kind) {
    case 'dontLeave':
      return { kind, zone: ZONE_IDS[0] };
    case 'dontGoIntoWater':
      return { kind };
    case 'dontHarvest':
      return { kind, cropId: CROP_IDS[0] };
    case 'dontDeposit':
      return { kind, itemId: CROP_IDS[0] };
    case 'doReturn':
      return { kind, to: { kind: 'generator' }, minute: ROBOT_SCREEN.cardDefaults.returnMinute };
    case 'doPowerDown':
      return { kind, when: { kind: 'bagFull' } };
  }
}

type ReturnCard = Extract<MdCard, { readonly kind: 'doReturn' }>;
type PowerDownCard = Extract<MdCard, { readonly kind: 'doPowerDown' }>;

function setReturnValue(card: ReturnCard, key: MdFieldKey, raw: string, robot: Pick<Robot, 'tx' | 'tz'>): MdCard {
  const n = wholeNumber(raw);
  const to = card.to;
  switch (key) {
    case 'to':
      if (raw === 'generator') return to.kind === 'generator' ? card : { ...card, to: { kind: 'generator' } };
      if (raw === 'tile') return to.kind === 'tile' ? card : { ...card, to: { kind: 'tile', tx: robot.tx, tz: robot.tz } };
      return card;
    case 'tx':
      return to.kind === 'tile' && n !== null ? { ...card, to: { ...to, tx: n } } : card;
    case 'tz':
      return to.kind === 'tile' && n !== null ? { ...card, to: { ...to, tz: n } } : card;
    case 'minute':
      return n !== null ? { ...card, minute: n } : card;
    default:
      return card;
  }
}

function setPowerDownValue(card: PowerDownCard, key: MdFieldKey, raw: string): MdCard {
  const when = card.when;
  if (key === 'n') {
    const n = wholeNumber(raw);
    return when.kind === 'tokensBelow' && n !== null ? { ...card, when: { kind: 'tokensBelow', n } } : card;
  }
  if (key !== 'when' || raw === when.kind) return card;
  if (raw === 'bagFull' || raw === 'raining') return { ...card, when: { kind: raw } };
  if (raw === 'tokensBelow') return { ...card, when: { kind: 'tokensBelow', n: ROBOT_SCREEN.cardDefaults.tokensBelow } };
  return card;
}

/**
 * `card` with the field `key` set from an input's text, or `card` itself when the text isn't a
 * value of that field. A return switched to "a tile" starts at the robot's tile.
 */
export function setCardValue(card: MdCard, key: MdFieldKey, raw: string, robot: Pick<Robot, 'tx' | 'tz'>): MdCard {
  switch (card.kind) {
    case 'dontLeave':
      return key === 'zone' && isZoneId(raw) && raw !== card.zone ? { ...card, zone: raw } : card;
    case 'dontGoIntoWater':
      return card;
    case 'dontHarvest':
      return key === 'cropId' && isCropId(raw) && raw !== card.cropId ? { ...card, cropId: raw } : card;
    case 'dontDeposit':
      return key === 'itemId' && isItemId(raw) && raw !== card.itemId ? { ...card, itemId: raw } : card;
    case 'doReturn':
      return setReturnValue(card, key, raw, robot);
    case 'doPowerDown':
      return setPowerDownValue(card, key, raw);
  }
}

/** DO cards take over at their moment; DON'T cards forbid (design §3.3). */
export function cardSection(card: MdCard): 'do' | 'dont' {
  return card.kind === 'doReturn' || card.kind === 'doPowerDown' ? 'do' : 'dont';
}

/** `cards` with card `index` swapped with the nearest card of its own section above (-1) or below (1). */
export function moveCard(cards: readonly MdCard[], index: number, step: -1 | 1): readonly MdCard[] {
  const card = cards[index];
  if (card === undefined) return cards;
  const section = cardSection(card);
  for (let other = index + step; other >= 0 && other < cards.length; other += step) {
    const neighbour = cards[other];
    if (neighbour === undefined || cardSection(neighbour) !== section) continue;
    const next = [...cards];
    next[index] = neighbour;
    next[other] = card;
    return next;
  }
  return cards;
}

export function removeCard(cards: readonly MdCard[], index: number): readonly MdCard[] {
  return cards.filter((_, at) => at !== index);
}

/** "Add a card" lists the unlocked kinds, in MD_CARD_KINDS order (spec §4.3, §7). */
export function addCardOptions(unlocks: RobotUnlocks): readonly { readonly kind: MdCardKind; readonly label: string }[] {
  return MD_CARD_KINDS.filter((kind) => unlocks.cards.includes(kind)).map((kind) => ({ kind, label: CARD_LABELS[kind] }));
}

/** The card's heading: "# {NAME}.MD". */
export function mdTitle(name: string): string {
  return `# ${name.toUpperCase()}.MD`;
}

/** "{n} / {limit} cards". */
export function mdCountText(md: readonly MdCard[], size: RobotSize): string {
  return `${md.length} / ${ROBOTS.sizes[size].mdCards} cards`;
}

export function mdOverLimit(md: readonly MdCard[], size: RobotSize): boolean {
  return md.length > ROBOTS.sizes[size].mdCards;
}
```

**3c. Create `src/ui/robotScreen/tabs/MdTab.ts`:**

```ts
/**
 * The .MD tab (farmclaws part 3 spec §4.3): the robot's Managing Directive as the design's
 * markdown card ("# {NAME}.MD", "## DO", "## DON'T"), one line per card with dropdowns and
 * number fields. "Add a card" lists the unlocked kinds; each card can move up or down within its
 * section or be removed; "{n} / {limit} cards" turns red over the limit. Save runs isMdShape and
 * checkMd (the sentence shows under the toolbar), then dispatches setRobotMd; the reducer runs
 * the same checks in withMd. A part 1 script robot gets a note instead of the editor; a ruined
 * robot's cards are read-only.
 */
import { MD_CARD_KINDS, type GameState, type MdCard, type Robot, type RobotSize, type RobotUnlocks } from '../../../core/types';
import { checkMd } from '../../../robots/check';
import { findRobot } from '../../../robots/world';
import { actions } from '../../../state/actions';
import { isMdShape } from '../../../state/robotValidation';
import { closestWithin, h, hudButton, setHidden, setText } from '../../dom';
import {
  MD_TEXT,
  addCardOptions,
  cardFields,
  cardSection,
  isMdFieldKey,
  mdCountText,
  mdOverLimit,
  mdTitle,
  moveCard,
  newCard,
  removeCard,
  setCardValue,
  type MdCardKind,
  type MdField,
} from '../mdFields';
import type { RobotTabContext, RobotTabView } from './tabView';

function isCardKind(value: string | undefined): value is MdCardKind {
  return (MD_CARD_KINDS as readonly (string | undefined)[]).includes(value);
}

export class MdTab implements RobotTabView {
  readonly element = h('div', 'rs-md');
  private readonly toolbar = h('div', 'rs-toolbar');
  private readonly counter = h('span', 'rs-counter');
  private readonly addButton = hudButton('hud-btn hud-btn--soft', MD_TEXT.addCard);
  private readonly addMenu = h('div', 'rs-popover rs-md__add');
  private readonly saveButton = hudButton('hud-btn hud-btn--primary', MD_TEXT.save);
  private readonly message = h('p', 'rs-message');
  private readonly note = h('p', 'rs-note', MD_TEXT.scriptOnly);
  private readonly file = h('div', 'rs-md__file');
  private readonly title = h('h3', 'rs-md__title');
  private readonly doList = h('ul', 'rs-md__cards');
  private readonly dontList = h('ul', 'rs-md__cards');
  private readonly context: RobotTabContext;
  private cards: readonly MdCard[] = [];
  /** The cards last loaded or saved. */
  private baseline: readonly MdCard[] = [];
  private shownUnlocks: RobotUnlocks | null = null;
  private shownRobot: Robot | null = null;
  private dirty = false;
  private saving = false;
  private readOnly = false;

  constructor(context: RobotTabContext) {
    this.context = context;
    const signal = context.signal;
    this.addButton.setAttribute('aria-haspopup', 'menu');
    this.addMenu.hidden = true;
    this.addMenu.setAttribute('role', 'menu');
    this.addMenu.setAttribute('aria-label', MD_TEXT.addCard);
    this.toolbar.append(this.counter, this.addButton, h('span', 'rs-toolbar__spacer'), this.saveButton);
    this.message.setAttribute('role', 'status');
    this.note.hidden = true;
    this.file.append(
      this.title,
      h('h4', 'rs-md__section', MD_TEXT.doHeading),
      this.doList,
      h('h4', 'rs-md__section', MD_TEXT.dontHeading),
      this.dontList,
    );
    this.element.append(this.toolbar, this.message, this.note, this.addMenu, this.file);

    this.addButton.addEventListener('click', () => setHidden(this.addMenu, !this.addMenu.hidden), { signal });
    this.addMenu.addEventListener(
      'click',
      (event) => {
        const kind = closestWithin(event, this.addMenu, 'button[data-kind]')?.dataset.kind;
        if (isCardKind(kind)) this.addCard(kind);
      },
      { signal },
    );
    this.saveButton.addEventListener('click', () => this.save(), { signal });
    this.file.addEventListener('change', (event) => this.onFieldChange(event), { signal });
    this.file.addEventListener('click', (event) => this.onTool(event), { signal });
  }

  open(state: GameState): void {
    const robot = findRobot(state, this.context.robotId);
    if (robot === null) return;
    this.readOnly = robot.power === 'ruined';
    this.cards = robot.md;
    this.baseline = robot.md;
    this.dirty = false;
    this.syncAddMenu(state.robots.unlocks);
    this.render(robot);
  }

  sync(state: GameState): void {
    const robot = findRobot(state, this.context.robotId);
    if (robot === null) return;
    if (state.robots.unlocks !== this.shownUnlocks) this.syncAddMenu(state.robots.unlocks);
    if (robot === this.shownRobot) return;
    if (!this.saving && !this.dirty && robot.md !== this.baseline) {
      this.cards = robot.md;
      this.baseline = robot.md;
    }
    this.render(robot);
  }

  setActive(active: boolean): void {
    if (!active) setHidden(this.addMenu, true);
  }

  isDirty(): boolean {
    return this.dirty && !this.readOnly;
  }

  handleEscape(): boolean {
    if (this.addMenu.hidden) return false;
    setHidden(this.addMenu, true);
    return true;
  }

  dispose(): void {}

  // -------------------------------------------------------------------------
  // Drawing
  // -------------------------------------------------------------------------

  private robot(): Robot | null {
    return findRobot(this.context.getState(), this.context.robotId);
  }

  private syncAddMenu(unlocks: RobotUnlocks): void {
    this.shownUnlocks = unlocks;
    this.addMenu.replaceChildren(
      ...addCardOptions(unlocks).map((option) => {
        const item = hudButton('rs-md__kind', option.label);
        item.dataset.kind = option.kind;
        item.setAttribute('role', 'menuitem');
        return item;
      }),
    );
  }

  private render(robot: Robot): void {
    this.shownRobot = robot;
    const script = robot.program.kind === 'script';
    setHidden(this.note, !script);
    setHidden(this.toolbar, script);
    setHidden(this.file, script);
    if (script) {
      setText(this.message, '');
      return;
    }
    setHidden(this.addButton, this.readOnly);
    setHidden(this.saveButton, this.readOnly);
    setText(this.title, mdTitle(robot.name));
    setText(this.counter, mdCountText(this.cards, robot.size));
    this.counter.classList.toggle('is-over', mdOverLimit(this.cards, robot.size));
    const doItems: HTMLElement[] = [];
    const dontItems: HTMLElement[] = [];
    this.cards.forEach((card, index) => {
      (cardSection(card) === 'do' ? doItems : dontItems).push(this.cardItem(card, index, robot.size));
    });
    this.doList.replaceChildren(...(doItems.length > 0 ? doItems : [h('li', 'rs-md__none', MD_TEXT.noCards)]));
    this.dontList.replaceChildren(...(dontItems.length > 0 ? dontItems : [h('li', 'rs-md__none', MD_TEXT.noCards)]));
  }

  private cardItem(card: MdCard, index: number, size: RobotSize): HTMLElement {
    const item = h('li', 'rs-md__card');
    item.dataset.index = String(index);
    item.append(h('span', 'rs-md__bullet', '-'));
    for (const field of cardFields(card, size)) item.append(this.fieldControl(field));
    if (!this.readOnly) {
      const tools = h('span', 'rs-md__tools');
      tools.append(
        this.toolButton('up', '↑', 'Move this card up'),
        this.toolButton('down', '↓', 'Move this card down'),
        this.toolButton('remove', '✕', 'Remove this card'),
      );
      item.append(tools);
    }
    return item;
  }

  private fieldControl(field: MdField): HTMLElement {
    switch (field.kind) {
      case 'text':
        return h('span', 'rs-md__text', field.text);
      case 'select': {
        const select = h('select', 'rs-input');
        select.dataset.key = field.key;
        select.setAttribute('aria-label', field.label);
        select.disabled = this.readOnly;
        for (const [label, value] of field.options) {
          const option = h('option', '', label);
          option.value = value;
          select.append(option);
        }
        select.value = field.value;
        return select;
      }
      case 'number': {
        const input = h('input', 'rs-input');
        input.type = 'number';
        input.dataset.key = field.key;
        input.setAttribute('aria-label', field.label);
        input.min = String(field.min);
        input.max = String(field.max);
        input.step = '1';
        input.value = String(field.value);
        input.disabled = this.readOnly;
        return input;
      }
    }
  }

  private toolButton(action: 'up' | 'down' | 'remove', label: string, name: string): HTMLButtonElement {
    const button = hudButton('rs-md__tool', label);
    button.dataset.action = action;
    button.title = name;
    button.setAttribute('aria-label', name);
    return button;
  }

  // -------------------------------------------------------------------------
  // Editing
  // -------------------------------------------------------------------------

  private edit(cards: readonly MdCard[]): void {
    const robot = this.robot();
    if (robot === null) return;
    if (cards !== this.cards) {
      this.cards = cards;
      this.dirty = true;
    }
    this.render(robot);
  }

  private indexOf(target: EventTarget | null): number | null {
    if (!(target instanceof Element)) return null;
    const item = target.closest('[data-index]');
    if (!(item instanceof HTMLElement) || !this.file.contains(item)) return null;
    const index = Number(item.dataset.index);
    return Number.isInteger(index) ? index : null;
  }

  private onFieldChange(event: Event): void {
    const target = event.target;
    if (this.readOnly || !(target instanceof HTMLSelectElement || target instanceof HTMLInputElement)) return;
    const key = target.dataset.key;
    const index = this.indexOf(target);
    const robot = this.robot();
    const card = index === null ? undefined : this.cards[index];
    if (!isMdFieldKey(key) || index === null || card === undefined || robot === null) return;
    const next = setCardValue(card, key, target.value, robot);
    this.edit(next === card ? this.cards : this.cards.map((old, at) => (at === index ? next : old)));
  }

  private onTool(event: MouseEvent): void {
    if (this.readOnly) return;
    const button = closestWithin(event, this.file, 'button[data-action]');
    const index = this.indexOf(button);
    if (button === null || index === null) return;
    switch (button.dataset.action) {
      case 'up':
        this.edit(moveCard(this.cards, index, -1));
        break;
      case 'down':
        this.edit(moveCard(this.cards, index, 1));
        break;
      case 'remove':
        this.edit(removeCard(this.cards, index));
        break;
      default:
        break;
    }
  }

  private addCard(kind: MdCardKind): void {
    setHidden(this.addMenu, true);
    this.edit([...this.cards, newCard(kind)]);
  }

  private save(): void {
    const robot = this.robot();
    if (robot === null || this.readOnly) return;
    const cards = this.cards;
    if (!isMdShape(cards)) {
      setText(this.message, MD_TEXT.cantSave);
      return;
    }
    const problem = checkMd(cards, robot);
    if (problem !== null) {
      setText(this.message, problem);
      return;
    }
    setText(this.message, '');
    const before = robot.md;
    this.saving = true;
    try {
      this.context.dispatch(actions.setRobotMd(robot.id, cards));
    } finally {
      this.saving = false;
    }
    const after = this.robot();
    if (after !== null && after.md !== before) {
      this.cards = after.md;
      this.baseline = after.md;
      this.dirty = false;
      this.render(after);
    }
  }
}
```

**3d. `src/ui/robotScreen/RobotScreen.ts`.** Add the import beside the other tab imports:

```ts
import { MdTab } from './tabs/MdTab';
```

and replace the doc comment and `TAB_FACTORIES` as Task 12 left them:

```ts
/** The tab views this screen can show; a tab without one never shows. */
const TAB_FACTORIES: Partial<Record<RobotTab, TabFactory>> = {
  program: (context) => new ProgramTab(context),
  looks: (context) => new LooksTab(context),
  stats: (context) => new StatsTab(context),
  log: (context) => new LogTab(context),
};
```

with the full record (every tab now has a view):

```ts
/** The view of each tab. */
const TAB_FACTORIES: Readonly<Record<RobotTab, TabFactory>> = {
  program: (context) => new ProgramTab(context),
  md: (context) => new MdTab(context),
  looks: (context) => new LooksTab(context),
  stats: (context) => new StatsTab(context),
  log: (context) => new LogTab(context),
};
```

The `TAB_FACTORIES[tab] === undefined` checks elsewhere in the file still compile (an index into a full record is never undefined at runtime; TypeScript allows the comparison) and stay as they are.

- [ ] **Step 4: Run the tests and see them pass**

Run: `npx vitest run tests/robotScreen.test.ts`
Expected: PASS.

- [ ] **Step 5: The full gate**

Run: `npm run typecheck && npm test && npm run build`
Expected: all green.

- [ ] **Step 6: Browser check**

Use the `game-driven-qa` skill as in Task 11, Step 6 (fresh farm, probe loaded, time scale 1). Then:

1. Give a robot a block program and bench it:
   ```js
   __meadowlight.addRobot('waterer', { tx: 6, tz: 6, facing: 2 });
   const b = __meadowlight.blocks;
   __meadowlight.setProgram('Drizzle', b.program({ stacks: [b.when(b.morning(), b.repeatUntil(b.lt(b.tokensLeft(), 10), b.water(), b.move()))] }));
   ```
   then the two E presses of Task 11, Step 6.1. Click ".MD".
2. The card reads "# DRIZZLE.MD", "## DO" with "No cards yet.", "## DON'T" with "No cards yet.", and the counter "0 / 3 cards". Screenshot.
3. "Add a card" lists only "DON'T leave a zone" and "DON'T go into water" (job 1). Add "DON'T go into water", then "DON'T leave a zone": both appear under "## DON'T", the counter reads "2 / 3 cards". Choose "Zone C" in the second card's dropdown. Move it up with "↑": it is now first.
4. Escape with the "Add a card" menu open closes only the menu (`__qa.state().ui.panel.kind === 'robot'`).
5. Unsaved edits: press Escape → "Discard your changes to Drizzle's program?"; click "Keep editing".
6. Click "Save": toast "Set Drizzle's .MD."; `__qa.robot('Drizzle').md` → `[{ kind: 'dontLeave', zone: 'C' }, { kind: 'dontGoIntoWater' }]`. Escape now closes the screen without a question.
7. Over the limit and DO cards: `__meadowlight.unlockAll()`, reopen the bench (E), ".MD", add "DO return somewhere at a time": it shows "Return to [the nearest generator] at [6:00 pm]" under "## DO". Switch "Where" to "a tile": X and Z fields appear with the bench tile (6, 4); type 60 in X and press Tab. Add "DO power down when…", choose "tokens are below": a "Tokens" field with 10 appears. The counter reads "4 / 3 cards" in red. Click "Save": the checker's sentence (for a Mini, "Mini robots hold 3 .MD cards; this .MD has 4.") shows under the toolbar and `__qa.robot('Drizzle').md` is unchanged. Remove the power-down card ("✕"), click "Save": "Tile (60, 4) isn't on the farm." shows. Set X back to 12, Save: the toast confirms.
8. A script robot's .MD tab: bench a `spinner` (as in Task 12, Step 7.11): the .MD tab says ".MD cards only apply to block programs." and shows no editor.
9. Typing in the X field: `await __qa.key('KeyW')` and `await __qa.key('Escape')` with the field focused: the player doesn't move, and Escape closes the screen (with the discard question when there are edits).
10. `read_console_messages {onlyErrors: true}` shows nothing.

Report one line per check.

- [ ] **Step 7: Commit**

```bash
git add src/config.ts src/ui/robotScreen/mdFields.ts src/ui/robotScreen/tabs/MdTab.ts src/ui/robotScreen/RobotScreen.ts tests/robotScreen.test.ts
git commit -m "Farmclaws part 3: the .MD tab, a card editor for the Managing Directive

The .MD shows as the design's markdown card, # NAME.MD with DO and DON'T
sections, each card one line of dropdowns (zones, crops, items, times that
keep an unusual current value) and number fields (tile X and Z, tokens).
Add a card lists the unlocked kinds; cards move within their section or are
removed; the counter turns red over the limit. Save runs isMdShape and
checkMd before setRobotMd.

Rulings: newCard takes only the kind (a DO return starts at the nearest
generator at ROBOT_SCREEN.cardDefaults.returnMinute; tokens below starts at
cardDefaults.tokensBelow). A number that isn't whole leaves the card as it
was. Empty sections say 'No cards yet.'.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Bundles and builds

**Files:**
- Create: `scripts/bundleRules.mjs` (the pure rules), `scripts/bundleRules.d.mts` (their types, so the test typechecks without `allowJs`)
- Create: `scripts/check-bundle.mjs`, `scripts/bundle-baseline.json`
- Modify: `scripts/build-single.mjs` (whole file shown), `vite.config.ts` (whole file shown), `package.json` (the `scripts` block), `README.md` (one line)
- Test: `tests/checkBundle.test.ts` (new)

**Interfaces:**
- Consumes:
  - `src/ui/RobotScreenHost.ts` loads `./robotScreen/RobotScreen` with one `import()` (Task 11), and nothing in the main chunk imports anything else from `src/ui/robotScreen/` statically.
  - The Program tab loads `blockly/core` and `blockly/msg/en` with `import()` inside `src/ui/robotScreen/`; `blockly` is in `dependencies` (Task 12).
  - Dev hooks live only in `src/dev/` and are reached only through `main.ts`'s `import.meta.env.DEV` branch (part 2). The usage lines naming `setMd(` and `setZone(` stay in `src/dev/robotDev.ts`; `src/robots/edits.ts` returns neutral refusals (Task 2, R8). `unlockAll` exists only in `src/dev/robotDev.ts` (Task 4).
- Produces:
  - `scripts/bundleRules.mjs`: `KIB`, `EDITOR_MAX_GZIP`, `SCREEN_MAX_GZIP`, `MAIN_GROWTH_MAX_GZIP`, `BLOCKLY_SOURCE`, `SCREEN_SOURCE`, `DEV_HOOK_WORDS`, `formatKiB(bytes)`, `entryScriptPath(html)`, `classifyChunks(chunks, entryFile)`, `evaluateBudgets(roles, baselineMainGzip)`, `budgetProblems(rows)`, `devHookMatches(files)`, `lazyImportLeft(code)`; types `BuiltChunk`, `ChunkRoles`, `BudgetRow` in `scripts/bundleRules.d.mts`.
  - `package.json`: `"build:check": "npm run build && node scripts/check-bundle.mjs"`, `"build:single": "vite build --mode single && node scripts/build-single.mjs"`.
  - `vite.config.ts`: `defineConfig(({ mode }) => …)`; `mode === 'single'` sets `build.rolldownOptions.output.codeSplitting = false` (see R13 below).
  - `scripts/bundle-baseline.json`: `{ "mainGzipBytes": 275539 }` (see R12 below).

Rules this task settles (Task 15 copies them into the spec as R12–R14):
- **R12, the baseline.** The spec's 274,312 bytes is what the `gzip -6` command line gives for part 2's `index-CUmkGRNG.js`. The check measures with Node's `zlib.gzipSync` at its default level, as spec §10.1 says, and that gives 275,539 bytes for the same file (Node 22). The baseline is recorded as 275,539 so both sides use one measure; Step 6 rebuilds part 2's head to confirm it.
- **R13, the single mode.** Vite 8 bundles with Rolldown, which prints "inlineDynamicImports option is deprecated, please use codeSplitting: false instead." for the spec's `inlineDynamicImports`. The `single` mode sets `build.rolldownOptions.output.codeSplitting: false`, which is the same thing without the warning.
- **R14, chunks and the guard.** `blockly/core` and `blockly/msg/en` are two dynamic imports, so they land in two chunks. The editor budget covers every lazy chunk whose source map lists `node_modules/blockly/`, added up. Vite writes a lazy import relative to the importing chunk (``import(`./RobotScreen-abc.js`)``), never with `assets/` in it, so `build-single.mjs`'s guard refuses any `import(` of a built `.js` file that is relative (`./`, `../`) or under `assets/`.

- [ ] **Step 1: Write the failing test**

Create `tests/checkBundle.test.ts`:

```ts
/**
 * The bundle rules behind scripts/check-bundle.mjs and scripts/build-single.mjs (farmclaws part 3
 * spec §10), on made-up chunks: finding the entry, sorting chunks by their source maps, the three
 * budgets, Blockly's placement, the dev-hook grep and the single-file guard.
 */
import { describe, expect, it } from 'vitest';
import {
  DEV_HOOK_WORDS,
  EDITOR_MAX_GZIP,
  KIB,
  MAIN_GROWTH_MAX_GZIP,
  SCREEN_MAX_GZIP,
  budgetProblems,
  classifyChunks,
  devHookMatches,
  entryScriptPath,
  evaluateBudgets,
  formatKiB,
  lazyImportLeft,
  type BuiltChunk,
} from '../scripts/bundleRules.mjs';

const MAIN: BuiltChunk = { file: 'assets/index-AAA.js', gzipBytes: 270 * KIB, sources: ['../../src/main.ts', '../../node_modules/three/build/three.core.js'] };
const SCREEN: BuiltChunk = {
  file: 'assets/RobotScreen-BBB.js',
  gzipBytes: 30 * KIB,
  sources: ['../../src/ui/robotScreen/RobotScreen.ts', '../../src/ui/robotScreen/translate.ts'],
};
const CORE: BuiltChunk = { file: 'assets/blockly-CCC.js', gzipBytes: 200 * KIB, sources: ['../../node_modules/blockly/blockly.mjs', '../../node_modules/blockly/blockly_compressed.js'] };
const EN: BuiltChunk = { file: 'assets/en-DDD.js', gzipBytes: 9 * KIB, sources: ['../../node_modules/blockly/msg/en.mjs'] };
const ICONS: BuiltChunk = { file: 'assets/icons-EEE.js', gzipBytes: 2 * KIB, sources: ['../../src/ui/icons.ts'] };
const BASELINE = 275_539;

describe('entryScriptPath', () => {
  it("reads the module script Vite writes into dist/index.html", () => {
    const html = '<head>\n    <script type="module" crossorigin src="/assets/index-CUmkGRNG.js"></script>\n    <link rel="stylesheet" crossorigin href="/assets/index-D-5RKi6P.css">\n</head>';
    expect(entryScriptPath(html)).toBe('assets/index-CUmkGRNG.js');
  });

  it('is null without a module script', () => {
    expect(entryScriptPath('<head><script src="/x.js"></script></head>')).toBeNull();
  });
});

describe('classifyChunks', () => {
  it('finds main by the entry, the screen by RobotScreen.ts and every Blockly chunk as the editor', () => {
    const roles = classifyChunks([CORE, EN, ICONS, MAIN, SCREEN], MAIN.file);
    expect(roles.main).toBe(MAIN);
    expect(roles.screen).toBe(SCREEN);
    expect(roles.editor).toEqual([CORE, EN]);
    expect(roles.other).toEqual([ICONS]);
    expect(roles.problems).toEqual([]);
  });

  it('reads Windows-style source paths too', () => {
    const screen = { ...SCREEN, sources: ['..\\..\\src\\ui\\robotScreen\\RobotScreen.ts'] };
    const core = { ...CORE, sources: ['..\\..\\node_modules\\blockly\\blockly.mjs'] };
    const roles = classifyChunks([MAIN, screen, core], MAIN.file);
    expect(roles.screen).toBe(screen);
    expect(roles.editor).toEqual([core]);
    expect(roles.problems).toEqual([]);
  });

  it('refuses Blockly in the main chunk', () => {
    const main = { ...MAIN, sources: [...MAIN.sources, '../../node_modules/blockly/blockly.mjs'] };
    const roles = classifyChunks([main, SCREEN], MAIN.file);
    expect(roles.editor).toEqual([]);
    expect(roles.problems).toEqual([
      'Blockly is in the main chunk (assets/index-AAA.js), e.g. ../../node_modules/blockly/blockly.mjs. Import blockly only through import() inside src/ui/robotScreen/.',
    ]);
  });

  it('refuses Blockly in the screen chunk', () => {
    const screen = { ...SCREEN, sources: [...SCREEN.sources, '../../node_modules/blockly/blockly.mjs'] };
    expect(classifyChunks([MAIN, screen], MAIN.file).problems).toEqual([
      'Blockly is in the screen chunk (assets/RobotScreen-BBB.js), e.g. ../../node_modules/blockly/blockly.mjs. Import blockly only through import() inside src/ui/robotScreen/.',
    ]);
  });

  it('refuses a robot screen bundled into the main chunk', () => {
    const main = { ...MAIN, sources: [...MAIN.sources, '../../src/ui/robotScreen/RobotScreen.ts'] };
    const roles = classifyChunks([main, CORE], MAIN.file);
    expect(roles.screen).toBeNull();
    expect(roles.problems).toEqual(['The robot screen is in the main chunk (assets/index-AAA.js). Load src/ui/robotScreen/RobotScreen.ts only through import().']);
  });

  it('asks for the lazy chunks when they are missing', () => {
    expect(classifyChunks([MAIN], MAIN.file).problems).toEqual([
      "No chunk's source map lists src/ui/robotScreen/RobotScreen.ts. The robot screen must be a lazy chunk of its own.",
      "No lazy chunk's source map lists node_modules/blockly/. The Program tab must load blockly through import().",
    ]);
  });

  it('names a missing entry', () => {
    expect(classifyChunks([SCREEN, CORE], null).problems).toEqual(['dist/index.html has no <script type="module" src="…"> entry.']);
    expect(classifyChunks([SCREEN, CORE], 'assets/index-ZZZ.js').problems).toEqual(["The entry script assets/index-ZZZ.js isn't in dist/assets."]);
  });
});

describe('evaluateBudgets', () => {
  it('sets the limits from spec §10.1 and adds up the editor chunks', () => {
    const rows = evaluateBudgets(classifyChunks([MAIN, SCREEN, CORE, EN], MAIN.file), BASELINE);
    expect(EDITOR_MAX_GZIP).toBe(250 * 1024);
    expect(SCREEN_MAX_GZIP).toBe(40 * 1024);
    expect(MAIN_GROWTH_MAX_GZIP).toBe(10 * 1024);
    expect(rows).toEqual([
      { role: 'main', files: [MAIN.file], gzipBytes: 270 * KIB, limitBytes: BASELINE + 10 * KIB, ok: true },
      { role: 'screen', files: [SCREEN.file], gzipBytes: 30 * KIB, limitBytes: 40 * KIB, ok: true },
      { role: 'editor', files: [CORE.file, EN.file], gzipBytes: 209 * KIB, limitBytes: 250 * KIB, ok: true },
    ]);
    expect(budgetProblems(rows)).toEqual([]);
  });

  it('allows exactly the limit and refuses one byte more', () => {
    const atLimit = { ...SCREEN, gzipBytes: SCREEN_MAX_GZIP };
    const over = { ...SCREEN, gzipBytes: SCREEN_MAX_GZIP + 1 };
    expect(evaluateBudgets({ main: null, screen: atLimit, editor: [] }, BASELINE)[0]?.ok).toBe(true);
    const rows = evaluateBudgets({ main: null, screen: over, editor: [] }, BASELINE);
    expect(rows[0]?.ok).toBe(false);
    expect(budgetProblems(rows)).toEqual(['The screen chunk is 40.0 KiB gzipped, over its 40.0 KiB budget (assets/RobotScreen-BBB.js).']);
  });

  it('holds the main chunk to the baseline plus 10 KiB', () => {
    const grown = { ...MAIN, gzipBytes: BASELINE + MAIN_GROWTH_MAX_GZIP + 1 };
    expect(budgetProblems(evaluateBudgets({ main: grown, screen: null, editor: [] }, BASELINE))).toEqual([
      `The main chunk is ${formatKiB(BASELINE + MAIN_GROWTH_MAX_GZIP + 1)} gzipped, over its ${formatKiB(BASELINE + MAIN_GROWTH_MAX_GZIP)} budget (assets/index-AAA.js).`,
    ]);
  });

  it('holds the editor chunks together to 250 KiB', () => {
    const big = { ...CORE, gzipBytes: 245 * KIB };
    const rows = evaluateBudgets({ main: null, screen: null, editor: [big, EN] }, BASELINE);
    expect(rows).toEqual([{ role: 'editor', files: [CORE.file, EN.file], gzipBytes: 254 * KIB, limitBytes: 250 * KIB, ok: false }]);
  });
});

describe('devHookMatches', () => {
  it('names each file and the hook words it contains', () => {
    const files = [
      { path: 'index.html', text: '<div id="app"></div>' },
      { path: 'assets/index-AAA.js', text: 'this.setProgram=function(){}' },
      { path: 'assets/index-AAA.js.map', text: '{"sourcesContent":["// setMd and setZone are dev only"]}' },
      { path: 'assets/dev-FFF.js', text: 'installRobotDev(addScriptedRobot,robotLog,unlockAll)' },
    ];
    expect(devHookMatches(files)).toEqual([
      { path: 'assets/index-AAA.js.map', words: ['setMd', 'setZone'] },
      { path: 'assets/dev-FFF.js', words: ['robotLog', 'installRobotDev', 'addScriptedRobot', 'unlockAll'] },
    ]);
  });

  it('leaves setProgram out of the pattern, for three.js', () => {
    expect(DEV_HOOK_WORDS).toEqual(['robotLog', 'installRobotDev', 'addScriptedRobot', 'setMd', 'setZone', 'unlockAll']);
  });
});

describe('lazyImportLeft', () => {
  it('finds a dynamic import of a built chunk', () => {
    expect(lazyImportLeft('let e=await import(`./RobotScreen-BBB.js`);')).toBe('import(`./RobotScreen-BBB.js`)');
    expect(lazyImportLeft('import("/assets/blockly-CCC.js")')).toBe('import("/assets/blockly-CCC.js")');
    expect(lazyImportLeft("import('assets/en-DDD.js')")).toBe("import('assets/en-DDD.js')");
  });

  it('passes inlined code', () => {
    expect(lazyImportLeft('const t=Promise.resolve().then(()=>(init_RobotScreen(),RobotScreen_exports));')).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run tests/checkBundle.test.ts`
Expected: FAIL. The suite doesn't load: "Error: Cannot find module '../scripts/bundleRules.mjs' imported from …/tests/checkBundle.test.ts".

- [ ] **Step 3: Implement the rules**

Create `scripts/bundleRules.mjs`:

```js
/**
 * The rules behind scripts/check-bundle.mjs (farmclaws part 3 spec §10), kept free of Node APIs
 * so tests/checkBundle.test.ts can run them on made-up chunks. Sizes are gzipped bytes.
 */

export const KIB = 1024;

/** Spec §10.1: the lazy Blockly editor, the lazy robot screen, and the main chunk's growth over the part 2 baseline. */
export const EDITOR_MAX_GZIP = 250 * KIB;
export const SCREEN_MAX_GZIP = 40 * KIB;
export const MAIN_GROWTH_MAX_GZIP = 10 * KIB;

/** A chunk whose source map lists a path containing this holds Blockly. */
export const BLOCKLY_SOURCE = 'node_modules/blockly/';
/** The chunk whose source map lists a path ending in this is the robot screen chunk. */
export const SCREEN_SOURCE = 'src/ui/robotScreen/RobotScreen.ts';
/** Spec §10.3: names only the dev hooks use. `setProgram` is left out: three.js's WebGLRenderer has its own. */
export const DEV_HOOK_WORDS = ['robotLog', 'installRobotDev', 'addScriptedRobot', 'setMd', 'setZone', 'unlockAll'];

const slashes = (path) => path.replace(/\\/g, '/');
const blocklySources = (chunk) => chunk.sources.filter((s) => slashes(s).includes(BLOCKLY_SOURCE));
const holdsScreen = (chunk) => chunk.sources.some((s) => slashes(s).endsWith(SCREEN_SOURCE));

/** "275.5 KiB". */
export function formatKiB(bytes) {
  return `${(bytes / KIB).toFixed(1)} KiB`;
}

/** The entry script's path inside dist/ ("assets/index-abc.js"), read from dist/index.html; null when there is none. */
export function entryScriptPath(html) {
  const match = /<script\b[^>]*\btype="module"[^>]*\bsrc="\/?([^"]+\.js)"[^>]*><\/script>/.exec(html);
  return match === null ? null : (match[1] ?? null);
}

/**
 * Sorts the built chunks into the main entry chunk, the robot screen chunk, the editor chunks
 * (every other chunk holding Blockly: `blockly/core` and `blockly/msg/en` may land in separate
 * chunks) and the rest, and lists every placement problem.
 *
 * @param {readonly { file: string, gzipBytes: number, sources: readonly string[] }[]} chunks
 * @param {string | null} entryFile the entry script's path inside dist/
 */
export function classifyChunks(chunks, entryFile) {
  const problems = [];
  const main = chunks.find((c) => c.file === entryFile) ?? null;
  if (main === null) {
    problems.push(entryFile === null ? 'dist/index.html has no <script type="module" src="…"> entry.' : `The entry script ${entryFile} isn't in dist/assets.`);
  }

  let screen = null;
  if (main !== null && holdsScreen(main)) {
    problems.push(`The robot screen is in the main chunk (${main.file}). Load ${SCREEN_SOURCE} only through import().`);
  } else {
    screen = chunks.find((c) => holdsScreen(c)) ?? null;
    if (screen === null) problems.push(`No chunk's source map lists ${SCREEN_SOURCE}. The robot screen must be a lazy chunk of its own.`);
  }

  let blocklyMisplaced = false;
  for (const [role, chunk] of [['main', main], ['screen', screen]]) {
    if (chunk === null) continue;
    const found = blocklySources(chunk);
    if (found.length === 0) continue;
    blocklyMisplaced = true;
    problems.push(`Blockly is in the ${role} chunk (${chunk.file}), e.g. ${found[0]}. Import blockly only through import() inside src/ui/robotScreen/.`);
  }

  const editor = chunks.filter((c) => c !== main && c !== screen && blocklySources(c).length > 0);
  if (editor.length === 0 && !blocklyMisplaced) {
    problems.push(`No lazy chunk's source map lists ${BLOCKLY_SOURCE}. The Program tab must load blockly through import().`);
  }
  const other = chunks.filter((c) => c !== main && c !== screen && !editor.includes(c));
  return { main, screen, editor, other, problems };
}

/**
 * One row per budget that has a chunk to measure: main (baseline + growth), screen and editor
 * (the editor chunks' sizes added up).
 *
 * @param {{ main: { file: string, gzipBytes: number } | null, screen: { file: string, gzipBytes: number } | null, editor: readonly { file: string, gzipBytes: number }[] }} roles
 * @param {number} baselineMainGzip the part 2 main chunk, from scripts/bundle-baseline.json
 */
export function evaluateBudgets(roles, baselineMainGzip) {
  const rows = [];
  if (roles.main !== null) {
    rows.push({ role: 'main', files: [roles.main.file], gzipBytes: roles.main.gzipBytes, limitBytes: baselineMainGzip + MAIN_GROWTH_MAX_GZIP });
  }
  if (roles.screen !== null) {
    rows.push({ role: 'screen', files: [roles.screen.file], gzipBytes: roles.screen.gzipBytes, limitBytes: SCREEN_MAX_GZIP });
  }
  if (roles.editor.length > 0) {
    const gzipBytes = roles.editor.reduce((sum, c) => sum + c.gzipBytes, 0);
    rows.push({ role: 'editor', files: roles.editor.map((c) => c.file), gzipBytes, limitBytes: EDITOR_MAX_GZIP });
  }
  return rows.map((row) => ({ ...row, ok: row.gzipBytes <= row.limitBytes }));
}

/** A sentence for each row over its budget. */
export function budgetProblems(rows) {
  return rows
    .filter((row) => !row.ok)
    .map((row) => `The ${row.role} chunk is ${formatKiB(row.gzipBytes)} gzipped, over its ${formatKiB(row.limitBytes)} budget (${row.files.join(', ')}).`);
}

/**
 * Every file that contains a dev-hook name, with the names it contains in DEV_HOOK_WORDS order.
 *
 * @param {readonly { path: string, text: string }[]} files
 */
export function devHookMatches(files) {
  return files
    .map((file) => ({ path: file.path, words: DEV_HOOK_WORDS.filter((word) => file.text.includes(word)) }))
    .filter((match) => match.words.length > 0);
}

/** The first `import(` of a lazy chunk left in inlined code ("import(`./RobotScreen-abc.js`)"), or null. */
export function lazyImportLeft(code) {
  const match = /\bimport\(\s*([`'"])(?:\.{1,2}\/|\/?assets\/)[^`'"]*\.js\1\s*\)/.exec(code);
  return match === null ? null : match[0];
}
```

Create `scripts/bundleRules.d.mts`. TypeScript resolves the test's `../scripts/bundleRules.mjs` import to it, so `tests/` typechecks with `allowJs` still off; nothing else in `scripts/` is typechecked.

```ts
/** Types for scripts/bundleRules.mjs, so tests/checkBundle.test.ts typechecks without allowJs. */

export interface BuiltChunk {
  readonly file: string;
  readonly gzipBytes: number;
  readonly sources: readonly string[];
}

export interface ChunkRoles {
  readonly main: BuiltChunk | null;
  readonly screen: BuiltChunk | null;
  readonly editor: readonly BuiltChunk[];
  readonly other: readonly BuiltChunk[];
  readonly problems: readonly string[];
}

export interface BudgetRow {
  readonly role: 'main' | 'screen' | 'editor';
  readonly files: readonly string[];
  readonly gzipBytes: number;
  readonly limitBytes: number;
  readonly ok: boolean;
}

export declare const KIB: number;
export declare const EDITOR_MAX_GZIP: number;
export declare const SCREEN_MAX_GZIP: number;
export declare const MAIN_GROWTH_MAX_GZIP: number;
export declare const BLOCKLY_SOURCE: string;
export declare const SCREEN_SOURCE: string;
export declare const DEV_HOOK_WORDS: readonly string[];

export declare function formatKiB(bytes: number): string;
export declare function entryScriptPath(html: string): string | null;
export declare function classifyChunks(chunks: readonly BuiltChunk[], entryFile: string | null): ChunkRoles;
export declare function evaluateBudgets(
  roles: Pick<ChunkRoles, 'main' | 'screen' | 'editor'>,
  baselineMainGzip: number,
): readonly BudgetRow[];
export declare function budgetProblems(rows: readonly BudgetRow[]): readonly string[];
export declare function devHookMatches(
  files: readonly { readonly path: string; readonly text: string }[],
): readonly { readonly path: string; readonly words: readonly string[] }[];
export declare function lazyImportLeft(code: string): string | null;
```

- [ ] **Step 4: Run it and see it pass**

Run: `npx vitest run tests/checkBundle.test.ts && npm run typecheck`
Expected: PASS, 17 tests, and the typecheck is clean (it reads the test's types from `scripts/bundleRules.d.mts`).

- [ ] **Step 5: The scripts and the builds**

**5a.** Create `scripts/bundle-baseline.json`:

```json
{ "mainGzipBytes": 275539 }
```

**5b.** Create `scripts/check-bundle.mjs`:

```js
/**
 * Post-build check (farmclaws part 3 spec §10.1 and §10.3) on the normal build in dist/:
 * - gzip budgets (zlib level 6): the lazy Blockly editor ≤ 250 KiB, the lazy robot screen
 *   ≤ 40 KiB, the main entry chunk ≤ the part 2 baseline (scripts/bundle-baseline.json) + 10 KiB;
 * - Blockly in neither the main chunk nor the screen chunk (by each source map's `sources`);
 * - no dev-hook name in any file of dist/, source maps included.
 * Prints a table of sizes and exits 1 with a sentence per problem.
 *
 * Usage: npm run build:check   (npm run build && node scripts/check-bundle.mjs)
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import {
  DEV_HOOK_WORDS,
  budgetProblems,
  classifyChunks,
  devHookMatches,
  entryScriptPath,
  evaluateBudgets,
  formatKiB,
} from './bundleRules.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const problems = [];

/** Every file under `dir`, recursively, sorted. */
function listFiles(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => (entry.isDirectory() ? listFiles(join(dir, entry.name)) : [join(dir, entry.name)]))
    .sort();
}

const baseline = JSON.parse(readFileSync(join(root, 'scripts', 'bundle-baseline.json'), 'utf8'));
if (!Number.isInteger(baseline.mainGzipBytes) || baseline.mainGzipBytes <= 0) {
  problems.push('scripts/bundle-baseline.json needs a positive integer mainGzipBytes.');
}

const entry = entryScriptPath(readFileSync(join(dist, 'index.html'), 'utf8'));

const chunks = readdirSync(join(dist, 'assets'))
  .filter((name) => name.endsWith('.js'))
  .sort()
  .map((name) => {
    const file = `assets/${name}`;
    const mapPath = join(dist, `${file}.map`);
    let sources = [];
    if (existsSync(mapPath)) {
      sources = JSON.parse(readFileSync(mapPath, 'utf8')).sources ?? [];
    } else {
      problems.push(`${file} has no source map, so its modules can't be checked. Keep build.sourcemap on.`);
    }
    return { file, gzipBytes: gzipSync(readFileSync(join(dist, file))).length, sources };
  });

const roles = classifyChunks(chunks, entry);
problems.push(...roles.problems);
const rows = evaluateBudgets(roles, baseline.mainGzipBytes);
problems.push(...budgetProblems(rows));

console.log('check-bundle: gzipped sizes (zlib level 6)');
console.log(`  ${'role'.padEnd(8)}${'gzip'.padStart(12)}${'limit'.padStart(12)}  result  files`);
for (const row of rows) {
  console.log(`  ${row.role.padEnd(8)}${formatKiB(row.gzipBytes).padStart(12)}${formatKiB(row.limitBytes).padStart(12)}  ${(row.ok ? 'ok' : 'OVER').padEnd(6)}  ${row.files.join(', ')}`);
}
for (const chunk of roles.other) {
  console.log(`  ${'other'.padEnd(8)}${formatKiB(chunk.gzipBytes).padStart(12)}${'-'.padStart(12)}  ${'-'.padEnd(6)}  ${chunk.file}`);
}

const files = listFiles(dist).map((path) => ({ path: relative(dist, path).split(sep).join('/'), text: readFileSync(path, 'utf8') }));
const hooks = devHookMatches(files);
for (const hit of hooks) {
  problems.push(`dist/${hit.path} contains ${hit.words.join(', ')}. Dev-hook names and text stay in src/dev/ (comments too: source maps carry them).`);
}
console.log(`check-bundle: ${files.length} files in dist/ checked for ${DEV_HOOK_WORDS.join('|')}: ${hooks.length === 0 ? 'none found' : `${hooks.length} found`}`);

if (problems.length > 0) {
  console.error('check-bundle: FAILED');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log('check-bundle: OK');
```

**5c.** Replace `scripts/build-single.mjs` with (the changes: the header, the `lazyImportLeft` import, the guard inside the script replacement, and copying `blockly-media/` beside the page, plan refinement R16):

```js
/**
 * Post-build step: inlines the Vite bundle (JS + CSS) into a single HTML page,
 * dist-single/index.html, so the playable build can be shared as one page. It expects the
 * `single` build mode (vite.config.ts), which inlines every dynamic import into the entry
 * script, and fails if a lazy chunk is still imported from assets/ (farmclaws part 3 spec §10.2).
 * Blockly's sprites and cursors (public/blockly-media) are copied beside the page: the game runs
 * from index.html alone, and the editor's trash can and zoom icons need the folder next to it.
 *
 * Usage: npm run build:single   (vite build --mode single && node scripts/build-single.mjs)
 */
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lazyImportLeft } from './bundleRules.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const outDir = join(root, 'dist-single');

let html = readFileSync(join(dist, 'index.html'), 'utf8');

const readAsset = (href) => readFileSync(join(dist, href.replace(/^\//, '')), 'utf8');

html = html.replace(/<script type="module" crossorigin src="([^"]+)"><\/script>/g, (_match, src) => {
  const code = readAsset(src)
    .replace(/\/\/# sourceMappingURL=\S+\s*$/m, '')
    .replace(/<\/script/gi, '<\\/script');
  const lazy = lazyImportLeft(code);
  if (lazy !== null) {
    throw new Error(`build-single: ${src} still loads a lazy chunk with ${lazy}. Build with \`vite build --mode single\` so dynamic imports are inlined.`);
  }
  return `<script type="module">\n${code}\n</script>`;
});

html = html.replace(/<link rel="stylesheet" crossorigin href="([^"]+)">/g, (_match, href) => {
  const css = readAsset(href).replace(/\/\*# sourceMappingURL=\S+\s*\*\//g, '');
  return `<style>\n${css}\n</style>`;
});

html = html.replace(/<link rel="modulepreload"[^>]*>/g, '');

if (/src="\/assets\//.test(html) || /href="\/assets\//.test(html)) {
  throw new Error('build-single: some /assets/ references were not inlined');
}

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'index.html'), html);
const media = join(dist, 'blockly-media');
if (!existsSync(media)) throw new Error('build-single: dist/blockly-media is missing (public/blockly-media, Task 12)');
cpSync(media, join(outDir, 'blockly-media'), { recursive: true });
console.log(`build-single: wrote ${join(outDir, 'index.html')} (${(html.length / 1024).toFixed(1)} KiB)`);
```

**5d.** Replace `vite.config.ts` with (it stays a `vitest/config` file with the same `test` block; `defineConfig` takes the function form, and Vitest calls it with mode `'test'`):

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig(({ mode }) => ({
  build: {
    target: 'es2022',
    sourcemap: true,
    // The single-file build carries the robot screen and Blockly inside its one script.
    chunkSizeWarningLimit: mode === 'single' ? 4000 : 1500,
    // `npm run build:single` (farmclaws part 3 spec §10.2): every dynamic import is inlined into the
    // entry script, so scripts/build-single.mjs inlines the robot screen and the editor with it.
    // `codeSplitting: false` is Rolldown's name for Rollup's `inlineDynamicImports: true`.
    ...(mode === 'single' ? { rolldownOptions: { output: { codeSplitting: false } } } : {}),
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30000,
  },
}));
```

`vite build --mode single` still builds for production (`import.meta.env.DEV` is false), so no dev hook reaches `dist-single/` either.

**5e.** In `package.json`, replace

```json
    "build": "tsc --noEmit && vite build",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "preview": "vite preview",
    "build:single": "npm run build && node scripts/build-single.mjs"
```

with

```json
    "build": "tsc --noEmit && vite build",
    "build:check": "npm run build && node scripts/check-bundle.mjs",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "preview": "vite preview",
    "build:single": "vite build --mode single && node scripts/build-single.mjs"
```

**5f.** In `README.md`, replace

```
npm run build:single # the whole game as one self-contained HTML file in dist-single/
```

with

```
npm run build:check  # the production build, then its size budgets and the dev-hook check
npm run build:single # the whole game as one HTML page in dist-single/, with Blockly's icon folder blockly-media/ beside it
```

- [ ] **Step 6: Confirm the baseline**

The baseline is part 2's head, commit `2a92771`. Rebuild it outside the working tree, with this checkout's `node_modules`, and measure it the way the check does:

```bash
rm -rf /tmp/meadowlight-part2-head && mkdir -p /tmp/meadowlight-part2-head
git archive 2a92771 | tar -x -C /tmp/meadowlight-part2-head
ln -s "$PWD/node_modules" /tmp/meadowlight-part2-head/node_modules
(cd /tmp/meadowlight-part2-head && ./node_modules/.bin/vite build --logLevel warn)
node -e "const fs = require('fs'), z = require('zlib'); const d = '/tmp/meadowlight-part2-head/dist/assets/'; const f = fs.readdirSync(d).find((n) => /^index-.*\.js$/.test(n)); console.log(f, z.gzipSync(fs.readFileSync(d + f)).length)"
rm -rf /tmp/meadowlight-part2-head
```

Expected: `index-CUmkGRNG.js 275539`. If your Node prints another number for the same `index-CUmkGRNG.js`, its zlib differs: record that number in `scripts/bundle-baseline.json` and in R12 (Task 15), and say so in the commit message.

- [ ] **Step 7: See the check catch a wrong build**

The single mode puts everything in one chunk, so the check must refuse it:

Run: `npm run build:single && node scripts/check-bundle.mjs; echo "exit $?"`
Expected: `build-single: wrote …/dist-single/index.html (… KiB)`, then the check prints a `main` row marked `OVER` against a `279.1 KiB` limit, and ends:

```
check-bundle: FAILED
  - The robot screen is in the main chunk (assets/index-….js). Load src/ui/robotScreen/RobotScreen.ts only through import().
  - Blockly is in the main chunk (assets/index-….js), e.g. ../../node_modules/blockly/…. Import blockly only through import() inside src/ui/robotScreen/.
  - The main chunk is … KiB gzipped, over its 279.1 KiB budget (assets/index-….js).
exit 1
```

Also check the single-file guard against the normal build, which still has lazy chunks:

Run: `npx vite build --logLevel warn && node scripts/build-single.mjs; echo "exit $?"`
Expected:

```
Error: build-single: /assets/index-….js still loads a lazy chunk with import(`./RobotScreen-….js`). Build with `vite build --mode single` so dynamic imports are inlined.
…
exit 1
```

- [ ] **Step 8: The full gate**

Run: `npm run typecheck && npm test && npm run build:check && npm run build:single`
Expected: all green. `build:check` prints:

```
check-bundle: gzipped sizes (zlib level 6)
  role            gzip       limit  result  files
  main         … KiB   279.1 KiB  ok      assets/index-….js
  screen       … KiB    40.0 KiB  ok      assets/RobotScreen-….js
  editor       … KiB   250.0 KiB  ok      assets/blockly-….js, assets/en-….js
check-bundle: … files in dist/ checked for robotLog|installRobotDev|addScriptedRobot|setMd|setZone|unlockAll: none found
check-bundle: OK
```

(The `editor` row may name one chunk or more, depending on how Rolldown splits Blockly; any `other` rows are chunks no budget covers.) `build:single` ends with `build-single: wrote …/dist-single/index.html (… KiB)`.

If the check fails, fix the cause; never raise a budget or the baseline to pass:
- **`setMd`, `setZone`, `unlockAll` … found:** the message names the file. A `.js.map` hit with no `.js` hit is a comment or string in production source (source maps carry `sourcesContent`); reword it. A `.js` hit means dev code reached production: it must be reachable only from `src/dev/`.
- **Blockly in the main or screen chunk:** something imports `blockly/core` or `blockly/msg/en` statically, or imports a value (not `import type`) from it. Keep every value import of Blockly behind the Program tab's `import()`.
- **"No lazy chunk's source map lists node_modules/blockly/"** while the Program tab does import Blockly lazily: print the lazy chunks' sources and see how Blockly's paths appear:
  `node -e "const fs = require('fs'); for (const f of fs.readdirSync('dist/assets').filter((n) => n.endsWith('.js.map'))) console.log(f, JSON.parse(fs.readFileSync('dist/assets/' + f, 'utf8')).sources.slice(0, 3))"`
  If they don't contain `node_modules/blockly/`, change `BLOCKLY_SOURCE` and its test fixtures to the prefix they do share, and record the change in the commit message.
- **The editor over 250 KiB:** import `blockly/core` and `blockly/msg/en` only, never the `blockly` root (which adds the stock blocks and every code generator).
- **The main chunk over its limit:** list what moved in with
  `node -e "const fs = require('fs'); const f = fs.readdirSync('dist/assets').find((n) => /^index-.*\.js\.map$/.test(n)); console.log(JSON.parse(fs.readFileSync('dist/assets/' + f, 'utf8')).sources.filter((s) => s.includes('src/ui/')).join('\n'))"`
  and move screen-only code (view models, tab code, CSS) behind the screen's `import()`.

- [ ] **Step 9: Commit**

```bash
git add scripts/bundleRules.mjs scripts/bundleRules.d.mts scripts/check-bundle.mjs scripts/bundle-baseline.json scripts/build-single.mjs vite.config.ts package.json README.md tests/checkBundle.test.ts
git commit -m "Farmclaws part 3: bundle budgets, the dist check and a single-file build with the editor

Rulings: the main-chunk baseline is 275,539 bytes, part 2's index-CUmkGRNG.js
through zlib.gzipSync at level 6, the measure the check uses (the gzip command
line gives 274,312). The single mode sets Rolldown's codeSplitting: false,
Vite 8's name for inlineDynamicImports. The editor budget adds up every lazy
chunk holding Blockly, since blockly/core and blockly/msg/en load as two
chunks, and build-single refuses any import() of a built chunk, relative or
under assets/, because Vite writes lazy imports relative.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: The playbook and the spec sync

**Files:**
- Create: `.claude/skills/game-driven-qa/scenarios/farmclaws-part3.md`
- Modify: `.claude/skills/game-driven-qa/scenarios/farmclaws-part1.md` (check 3, for the new `pair` preset), `.claude/skills/game-driven-qa/probe.js` (three helpers after `turn`), `.claude/skills/game-driven-qa/SKILL.md` (quick-reference rows after the `What a block robot is doing` row; two gotcha rows), `.claude/launch.json` (whole file shown)
- Modify: `docs/superpowers/specs/2026-09-29-farmclaws-design.md`, `docs/superpowers/specs/2026-09-29-farmclaws-part1-robot-core.md`, `docs/superpowers/specs/2026-10-02-farmclaws-part2-language.md`, `docs/superpowers/specs/2026-10-03-farmclaws-part3-robot-screen.md` (spec sync)

**Interfaces:**
- Consumes (all through the browser or the dev console):
  - Dev hooks on `window.__meadowlight`: `store`, `actions`, `addRobot(preset, place)`, `addScriptedRobot(input)`, `setProgram(name, program)`, `setMd(name, cards)`, `setZone(id, rect)`, `blocks` (part 2), `unlockAll()` → "Unlocked every block, card and tab." (Task 4).
  - State: `Robot.onBench` and `UiPanel` `{ kind: 'robot'; robotId; mode: 'bench' | 'peek' }` (Task 5), `Robot.off: 'player'` (Task 5), `Robot.stats` (Task 3), `'ruined'` and `Robot.paint` (Task 7), `ui.zoneDraft`, `ui.zoneLetter`, the `'zoneMarker'` item (Task 9), `robots.zones` (part 2).
  - Player-facing text from the spec, verbatim: hints "Put {name} on the bench", "Work on {name}", "Bring a robot here to work on it", "Look at {name}", "Send {name} for a new core · {cost}g", "Fish out {name}", "Put down {name}", "Pick up {name}"; toasts "Programmed {name}.", "Set {name}'s .MD.", "Zone A · 3×3.", "Cleared Zone A.", "{name} bumped into {other} and forgot what to do when {trigger}.", "{name} is off for a new core. Back tomorrow.", "{name} spent the night in the water and is ruined. Scrap it at the workbench.", "{name} is beyond repair. Scrap it at the workbench.", "Scrapped {name} for {gold}g.", "Painted {name} {colour}.", "{name} is already {colour}."; screen text "Opening the editor…", "{used} / {limit} blocks", "{n} / {limit} cards", "Every block must be inside a When … stack or a helper.", "Discard your changes to {name}'s program?" (Discard / Keep editing), "Scrap {name} for {gold}g? This can't be undone." (Scrap / Keep), "Switched off", "Off until morning", "{name} is ruined. It can only be scrapped.", "{name} runs a fixed script. Saving here replaces it with a block program.", "Paint · {cost}g"; the HUD chip "Zone A · 3×3" / "Zone A · not set" / " · corner set".
  - `npm run build:check` and `npm run build:single` (Task 14).
  - The plan's R1–R7, the coordinator's R8–R11, Task 14's R12–R14, Task 5's R15 and Task 12's R16.
- Produces: the playbook; part 1's check 3 updated for Task 6's `pair` preset (both robots stay on the delivery tile and loop `[harvest, turn right]`); `__qa.shift(code)`, `__qa.same(a, b)` and `__qa.bench(name)` in the probe; the `meadowlight-single` launch configuration; the spec edits below.

The playbook drives behaviour Tasks 1–14 built. A FAIL is a bug in that earlier code unless the spec supports what the game did.

- [ ] **Step 1: Write the playbook**

Create `.claude/skills/game-driven-qa/scenarios/farmclaws-part3.md`:

````markdown
# Farmclaws part 3 — the robot screen playbook

The browser check from the part 3 plan (Task 15 Step 6), as runnable snippets for the part 3
spec §11. Start each numbered check from `?new` with the probe loaded (see SKILL.md), with the
browser pane **shown**: the robot screen and Blockly's drags need real frames. Each fenced `js`
block is one `javascript_tool` call; lines naming `find`, `computer`, `get_page_text` or
`resize_window` are browser-pane tool calls. Expected results come from the part 3 spec and
`src/config.ts`.

Farm landmarks: spawn (2,5) · the workbench (6,4), worked from (6,5) facing north · shipping bin
(9–10,5) and the new-core drop-off (9,6) · clear ground x 1–17, z 9–17 · pond x 34–44, z 27–34.
A Mini has 80 tokens, 12 blocks and 3 .MD cards and acts every 4 game minutes; a Big has 80
blocks. Move, turn and refill cost 1, water 2. Carrying a Mini costs 4 energy, a new core 300g,
a coat of paint 50g; scrapping a Mini pays 375g. Starting gold is 500.

**The robot screen owns the keyboard.** While `__qa.state().ui.panel.kind` is `'robot'` the game
is frozen and ignores every key. Drive the screen with `find` (by visible text) and `computer`
clicks, drags and keys: `__qa.key` dispatches on `window`, which never reaches Blockly's fields.
`computer {action: 'key', text: 'Escape'}` closes the screen (after closing an open dropdown,
widget or flyout first).

**Morning stacks.** Save (`programRobot`) and `setProgram` start a `When morning comes` stack only up
to 6:04. Each setup that saves a morning program loads the clock to 6:00 (minute 360) just
before it opens the bench, and the frozen screen holds the clock while you edit. If a save
still lands after 6:04 (`exec.running` is null after Save), finish the check's steps, then
`__qa.sleep()` and read the results from 6:04 the next day: the numbers are the same.

**Dragging blocks.** Click a toolbox category (Triggers, Control, Actions, Sensors, Values) to
open its flyout, screenshot, then `computer {action: 'left_click_drag'}` from the block's left
edge to the target: an empty part of the workspace for a top-level block, or so the dragged
block's top-left corner sits just inside the slot it belongs in. Blockly snaps within about
25 px. Screenshot after every drop.

## 1. Carry a robot to the bench; the screen opens

```js
const F = await __qa.fixtures(); let s = __qa.state();
for (let tz = 8; tz <= 12; tz++) s = F.withTile(s, { tx: 6, tz }, F.soilTile(F.T.TileState.Plowed), 'farm');   // check 3's bed
s = F.withPlayer(s, { tx: 6, tz: 5 }, 0, 'farm');
__qa.load({ ...s, time: { ...s.time, minuteOfDay: 360 } });
await new Promise((r) => setTimeout(r, 100));
const emptyHint = document.body.innerText.includes('Bring a robot here to work on it');
await __qa.key('KeyE');
({ emptyHint, toast: __qa.snap(1).toasts, panel: __qa.state().ui.panel.kind })
```
Expect `emptyHint: true`, one toast ending "Bring a robot here to work on it", `panel: 'none'`.
```js
const s = __qa.state(); __qa.load({ ...s, time: { ...s.time, minuteOfDay: 360 } });
const added = __meadowlight.addRobot('spinner', { tx: 6, tz: 6, facing: 0 });
await __qa.turn(2);
const pickHint = document.body.innerText.includes('Pick up Spinner');
await __qa.key('KeyE');
await __qa.turn(0);
const benchHint = document.body.innerText.includes('Put Spinner on the bench');
await __qa.key('KeyE');
const r = __qa.robot('Spinner'), st = __qa.state();
({ added, pickHint, benchHint, panel: st.ui.panel, robot: { at: [r.tx, r.tz], onBench: r.onBench, carried: r.carried }, carrying: st.player.carrying, energy: st.player.energy, minute: st.time.minuteOfDay })
```
Expect `added: "Added Spinner."`, both hints `true`, `panel: { kind: 'robot', robotId: 1, mode: 'bench' }`,
the robot at `[6, 4]` with `onBench: true` and `carried: false`, `carrying: null`, `energy: 96`,
`minute` at most 362. Screenshot: "Opening…" gives way to the screen; the header shows Spinner,
Mini, the watering-head icon, its tokens, the On/Off switch, **Lift off** and **Scrap**.
`get_page_text`: tabs Program, .MD, Looks and Log, and no Stats (job 1's set doesn't unlock it).

## 2. Build job 1's program by dragging blocks

`find "Program"` → click. "Opening the editor…" shows, then the note "Spinner runs a fixed
script. Saving here replaces it with a block program.", an empty workspace and "0 / 12 blocks".
Build, by dragging:
```
When morning comes
  Repeat until  (tokens left) < (10)
    Water
    Move forward
```
"When morning comes" is under Triggers; "Repeat until" under Control; the comparison, "tokens left"
and the number block under Values; "Water" and "Move forward" under Actions. Along the way:

a. **Keys stay in the editor.** Click the number block's field, then `computer type "wasd e"`,
   `computer key "Backspace"` until the field is empty, `computer type "10"`, `computer key "Enter"`.
   ```js
   const st = __qa.state(); ({ at: [st.player.tx, st.player.tz], facing: st.player.facing, energy: st.player.energy, panel: st.ui.panel.kind, slot: st.inventory.selected })
   ```
   Expect `at: [6, 5]`, `facing: 0`, `energy: 96`, `panel: 'robot'`, `slot: 0`: none of those
   keys reached the game. The number block reads 10.
b. **Escape in a dropdown.** Click the comparison's operator dropdown; with its menu open,
   `computer key "Escape"`: only the menu closes, and `__qa.state().ui.panel.kind` is still
   `'robot'`. Open it again and pick `<`.
c. **The counter.** `get_page_text` shows "6 / 12 blocks".
d. **A loose block.** Drag one more "Move forward" onto an empty part of the workspace (the
   counter reads "7 / 12 blocks") and click **Save**. Under the toolbar: "Every block must be
   inside a When … stack or a helper.", with that block highlighted.
   `__qa.robot('Spinner').program.kind` is still `'script'` and no "Programmed" toast appeared.
   Click the loose block and `computer key "Delete"`: it's gone, "6 / 12 blocks".
e. **Unsaved edits.** `computer key "Escape"` with no menu open: the prompt "Discard your
   changes to Spinner's program?" offers **Discard** and **Keep editing**. Click
   **Keep editing**: the screen stays with the workspace as it was.

## 3. Save, lift off, and watch it run

Click **Save**, then:
```js
const b = __meadowlight.blocks; const r = __qa.robot('Spinner');
({ same: __qa.same(r.program, b.program({ stacks: [b.when(b.morning(), b.repeatUntil(b.lt(b.tokensLeft(), 10), b.water(), b.move()))] })), running: r.exec.running, toast: __qa.snap(1).toasts, minute: __qa.state().time.minuteOfDay })
```
Expect `same: true`, `running: 0`, `toast: ["[success] Programmed Spinner."]`, `minute` at most 364.
Click **Lift off**:
```js
const st = __qa.state(), r = __qa.robot('Spinner'); ({ panel: st.ui.panel.kind, carrying: st.player.carrying === r.id, onBench: r.onBench, energy: st.player.energy })
```
Expect `panel: 'none'`, `carrying: true`, `onBench: false`, `energy: 92`. Then put it down at
the top of the bed and give it 40 minutes (ten acts):
```js
await __qa.walkTo(6, 7);   // ends facing south, with (6,8) ahead
const putHint = document.body.innerText.includes('Put down Spinner');
await __qa.key('KeyE');
__qa.tick(40);
const tiles = []; for (let tz = 8; tz <= 12; tz++) tiles.push((await __qa.tile(6, tz, 'farm')).state);
const r = __qa.robot('Spinner'); ({ putHint, tiles, at: [r.tx, r.tz], tokens: r.tokens, tank: r.tank, running: r.exec.running, log: await __qa.logText(2, 'Spinner') })
```
Expect `putHint: true`, `tiles: [2, 2, 2, 2, 2]`, `at: [6, 13]`, `tokens: 65` (5 waters, 5 moves),
`tank: 15`, `running: 0`, and the log ending "says: Watered ✓ | happened: Watered the soil." then
"says: Moved forward ✓ | happened: Moved one tile.". It keeps going until tokens left < 10.

## 4. Every fixture survives the editor unchanged

The five programs cover every block of design §5.2 that the language has, including values
outside the editor's usual options (`atTime` 583, i.e. 9:43 am; a `potato` item; a `cauliflower`
crop; a 16-character variable name, `ROBOTS.maxIdentifierLength`) and locked kinds, which show
normally. They run on a Big robot with a sensor eye.
```js
const s = __qa.state(); __qa.load({ ...s, time: { ...s.time, minuteOfDay: 360 } });
const added = __meadowlight.addScriptedRobot({ name: 'Atlas', size: 'big', parts: ['claw', 'wateringHead', 'sensorEye'], steps: [{ kind: 'turn', side: 'right' }], place: { tx: 6, tz: 6, facing: 0 } });
__qa.bench('Atlas');
const b = __meadowlight.blocks;
window.FIX = {
  job1: b.program({ stacks: [b.when(b.morning(), b.repeatUntil(b.lt(b.tokensLeft(), 10), b.water(), b.move()))] }),
  harvest: b.program({ stacks: [b.when(b.morning(), b.forEach('A', b.if(b.cropIsReady(), [b.harvest()], [])), b.goTo(b.tileAt(9, 6)), b.turn('left'), b.deposit(), b.powerDown())] }),
  triggers: b.program({ stacks: [
    b.when(b.atTime(583), b.say('Morning tea')),
    b.when(b.bagFull(), b.goTo(b.tileAt(9, 6)), b.turn('left'), b.deposit()),
    b.when(b.startsRaining(), b.wait(30)),
    b.when(b.every(15), b.if(b.and(b.soilIsDry(), b.not(b.itIsRaining())), [b.water()])),
  ] }),
  helpers: b.program({
    vars: [b.numVar('rows', 3), b.textVar('note', 'Row done'), b.tileVar('home', 6, 6), b.itemVar('crop', 'potato'), b.yesVar('harvestedToday12', false)],
    stacks: [b.when(b.morning(), b.repeat(b.v('rows'), b.run('plantRow'), b.change('rows', -1)), b.set('harvestedToday12', b.yes(true)), b.goTo(b.v('home')))],
    helpers: [b.helper('plantRow', b.till(), b.plant('parsnip'), b.take(b.v('crop')), b.say(b.v('note')), b.move())],
  }),
  sensors: b.program({
    vars: [b.numVar('n', 0)],
    stacks: [b.when(b.morning(), b.forever(
      b.if(b.or(b.tileIsTilled(), b.cropIs('cauliflower')), [b.set('n', b.add(b.countInBag('parsnip'), b.mul(2, b.sub(b.v('n'), 1))))], [b.turn('right')]),
      b.if(b.and(b.bagIsFull(), b.bagHas('parsnip')), [b.powerDown()]),
      b.if(b.or(b.atEdgeOf('B'), b.tokensBelow(20)), [b.goTo(b.myTile())]),
      b.if(b.or(b.tileAheadIs('water'), b.timeIsAfter(1080)), [b.goTo(b.tileAhead())]),
      b.if(b.and(b.ne(b.v('n'), 0), b.gt(b.v('n'), 5)), [b.wait(b.v('n'))]),
      b.if(b.eq(b.v('n'), 3), [b.move()]),
    ))],
  }),
};
const P = await __qa.mod('/src/robots/program.ts');
({ added, counts: Object.fromEntries(Object.entries(FIX).map(([k, p]) => [k, P.blockCount(p)])) })
```
Expect `added: "Added Atlas."` and `counts: { job1: 6, harvest: 9, triggers: 15, helpers: 16, sensors: 42 }`.
Then, for each name in turn (`job1`, `harvest`, `triggers`, `helpers`, `sensors`):
```js
const name = 'job1';
const said = __meadowlight.setProgram('Atlas', FIX[name]);
await __qa.key('KeyE');   // "Work on Atlas"
({ said, panel: __qa.state().ui.panel })
```
Expect `said: "Programmed Atlas."` and `panel: { kind: 'robot', robotId: 1, mode: 'bench' }`.
`find "Program"` → click; once the editor shows, `get_page_text` has "{count} / 80 blocks" with
that fixture's count and no error sentence. Screenshot: stacks laid out top to bottom
(declarations, then trigger stacks, then helpers); for `triggers`, the time dropdown reads
9:43 am. Click **Save**, then:
```js
({ same: __qa.same(__qa.robot('Atlas').program, FIX[name]), toast: __qa.snap(1).toasts })
```
Expect `same: true` and `toast: ["[success] Programmed Atlas."]`. `computer key "Escape"`
closes the screen with no prompt (nothing unsaved); go on with the next name.

## 5. A DON'T go into water card, written in the .MD tab, is obeyed

```js
const F = await __qa.fixtures(); const W = await __qa.mod('/src/world/tiles.ts'); let s = __qa.state();
for (let tz = 21; tz <= 26; tz++) s = F.withTile(s, { tx: 38, tz }, W.EMPTY_TILE, 'farm');
s = F.withTile(s, { tx: 38, tz: 27 }, W.blockedTile(F.T.Blocker.Water), 'farm');
__qa.load({ ...s, time: { ...s.time, minuteOfDay: 360 } });
__meadowlight.addScriptedRobot({ name: 'Careful', parts: ['claw'], steps: [{ kind: 'turn', side: 'right' }], place: { tx: 6, tz: 6, facing: 0 } });
__qa.bench('Careful');
const b = __meadowlight.blocks;
const said = __meadowlight.setProgram('Careful', b.program({ stacks: [b.when(b.morning(), b.repeat(4, b.move()))] }));
await __qa.key('KeyE');
({ said, running: __qa.robot('Careful').exec.running, panel: __qa.state().ui.panel.kind })
```
Expect `said: "Programmed Careful."`, `running: 0`, `panel: 'robot'`. `find ".MD"` → click: the
card reads "# CAREFUL.MD", "## DO", "## DON'T", "0 / 3 cards". **Add a card** offers only job
1's two cards (DON'T leave a zone, DON'T go into water). Pick DON'T go into water ("1 / 3
cards") and click **Save**:
```js
({ md: __qa.robot('Careful').md, toast: __qa.snap(1).toasts })
```
Expect `md: [{ kind: 'dontGoIntoWater' }]` and `toast: ["[success] Set Careful's .MD."]`.
Click **Lift off**, then carry it to the shore and let it walk:
```js
__qa.patch((s) => { Object.assign(s.player, { tx: 38, tz: 23, facing: 2 }); });   // setup: the walk to the pond
const putHint = document.body.innerText.includes('Put down Careful');
await __qa.key('KeyE');
__qa.tick(20);
const r = __qa.robot('Careful'); ({ putHint, at: [r.tx, r.tz], power: r.power, tokens: r.tokens, log: await __qa.logText(3, 'Careful') })
```
Expect `putHint: true`, `at: [38, 26]` (on the shore), `power: 'standby'`, `tokens: 78` (two
moves), and the log: one "says: Following my rules ✓" entry ×2 whose "happened" names the
card ("… my .MD says don't go into water."), then "All done ✓".

## 6. Paint Zone A with the marker, then `For each tile in A` after `unlockAll`

```js
const F = await __qa.fixtures(); let s = __qa.state();
for (let tx = 6; tx <= 8; tx++) for (let tz = 12; tz <= 14; tz++) s = F.withTile(s, { tx, tz }, F.soilTile(F.T.TileState.Plowed), 'farm');
__qa.load(F.withPlayer(s, { tx: 6, tz: 11 }, 2, 'farm'));
const slot = __qa.state().inventory.slots.findIndex((x) => x?.itemId === 'zoneMarker');
__qa.select(slot);
await new Promise((r) => setTimeout(r, 100));
({ slot, chip: document.body.innerText.includes('Zone A · not set') })
```
Expect `slot: 6` and `chip: true`. Cycling, and Escape dropping a draft:
```js
await __qa.shift('Space');
const letter = __qa.state().ui.zoneLetter;
await __qa.key('Space');
const draft = __qa.state().ui.zoneDraft;
const chip = document.body.innerText.includes('Zone B · not set · corner set');
await __qa.key('Escape');
const u = __qa.state().ui;
({ letter, draft, chip, after: { draft: u.zoneDraft, paused: u.paused, panel: u.panel.kind } })
```
Expect `letter: 'B'`, `draft: { zone: 'B', corner: { tx: 6, tz: 12 } }`, `chip: true`, and
`after: { draft: null, paused: false, panel: 'none' }`. Back to A, then paint the bed:
```js
for (let i = 0; i < 7; i++) await __qa.shift('Space');
const letter = __qa.state().ui.zoneLetter;
await __qa.key('Space', 600);   // a long hold: one corner, no repeats
const draft = __qa.state().ui.zoneDraft;
await __qa.walkTo(8, 15); await __qa.turn(0);   // (8,14) ahead
await __qa.key('Space');
const st = __qa.state();
({ letter, draft, zone: st.robots.zones.A, after: st.ui.zoneDraft, toast: __qa.snap(1).toasts, chip: document.body.innerText.includes('Zone A · 3×3') })
```
Expect `letter: 'A'`, `draft: { zone: 'A', corner: { tx: 6, tz: 12 } }`,
`zone: { x0: 6, z0: 12, w: 3, d: 3 }`, `after: null`, a toast ending "Zone A · 3×3.", `chip: true`.
Zoom in (`KeyZ` ×3) and screenshot: a tinted outline round the bed with "A" at its north-west
corner. Now a robot, on the bench, with job 1's set:
```js
const s = __qa.state(); __qa.load({ ...s, time: { ...s.time, minuteOfDay: 360 } });
const added = __meadowlight.addRobot('spinner', { tx: 6, tz: 6, facing: 0 });
__qa.bench('Spinner');
await __qa.key('KeyE');
({ added, panel: __qa.state().ui.panel.kind })
```
Expect "Added Spinner." and `'robot'`. `find "Program"` → click, then click the Control
category: `find "For each tile"` finds nothing (it's locked). `computer key "Escape"` until
`__qa.state().ui.panel.kind` is `'none'` (the flyout first, then the screen). Then:
```js
const said = __meadowlight.unlockAll();
const s = __qa.state(); __qa.load({ ...s, time: { ...s.time, minuteOfDay: 360 } });
await __qa.key('KeyE');
({ said, panel: __qa.state().ui.panel.kind })
```
Expect `said: "Unlocked every block, card and tab."` and `'robot'`; the Stats tab now shows in
the header. Program → Control now has "For each tile in [A]". Build:
```
When morning comes
  For each tile in [A]
    Water
  Power down
```
"4 / 12 blocks". Click **Save**:
```js
const b = __meadowlight.blocks; const r = __qa.robot('Spinner');
({ same: __qa.same(r.program, b.program({ stacks: [b.when(b.morning(), b.forEach('A', b.water()), b.powerDown())] })), running: r.exec.running, toast: __qa.snap(1).toasts })
```
Expect `same: true`, `running: 0`, `toast: ["[success] Programmed Spinner."]`. Click
**Lift off**, then:
```js
await __qa.walkTo(5, 12); await __qa.turn(1);   // (6,12) ahead, facing east
const putHint = document.body.innerText.includes('Put down Spinner');
await __qa.key('KeyE');
__qa.tick(100);
const tiles = []; for (let tz = 12; tz <= 14; tz++) for (let tx = 6; tx <= 8; tx++) tiles.push((await __qa.tile(tx, tz, 'farm')).state);
const r = __qa.robot('Spinner'); ({ putHint, tiles, power: r.power, tokens: r.tokens, tank: r.tank, at: [r.tx, r.tz] })
```
Expect `putHint: true`, nine `2`s, `power: 'standby'`, `tokens: 50` (9 waters × 2, 8 moves,
4 turns), `tank: 11`, `at: [8, 14]`. Finally clear the zone:
```js
await __qa.turn(3);   // nothing ahead but grass
await __qa.shift('KeyE');
({ zone: __qa.state().robots.zones.A, toast: __qa.snap(1).toasts })
```
Expect `zone: null` and a toast ending "Cleared Zone A.".

## 7. Two robots bump: both dizzy, the toast, the emptied stack on the bench

```js
const F = await __qa.fixtures(); const s = __qa.state();
__qa.load({ ...F.withPlayer(s, { tx: 6, tz: 13 }, 0, 'farm'), time: { ...s.time, minuteOfDay: 360 } });
const b = __meadowlight.blocks, walk = b.program({ stacks: [b.when(b.morning(), b.repeat(3, b.move()))] });
const out = [
  __meadowlight.addScriptedRobot({ name: 'Tick', parts: ['claw'], steps: [{ kind: 'turn', side: 'right' }], place: { tx: 6, tz: 12, facing: 1 } }),
  __meadowlight.addScriptedRobot({ name: 'Tock', parts: ['claw'], steps: [{ kind: 'turn', side: 'right' }], place: { tx: 8, tz: 12, facing: 3 } }),
  __meadowlight.setProgram('Tick', walk),
  __meadowlight.setProgram('Tock', walk),
];
__qa.tick(4);   // 6:04: both move into (7,12)
const view = (n) => { const r = __qa.robot(n); return { at: [r.tx, r.tz], tokens: r.tokens, off: r.off, running: r.exec.running, stack: r.program.stacks[0], ok: r.lastAction?.success }; };
({ out, tick: view('Tick'), tock: view('Tock'), toasts: __qa.snap(2).toasts, log: await __qa.logText(2) })
```
Expect `out: ["Added Tick.", "Added Tock.", "Programmed Tick.", "Programmed Tock."]`, and for
each robot: its own tile (`[6, 12]`, `[8, 12]`), `tokens: 79`, `off: 'dizzy'`, `running: null`,
`stack: { trigger: { kind: 'morning' }, body: [] }`, `ok: false`. Toasts:
"[warn] Tick bumped into Tock and forgot what to do when morning came." and
"[warn] Tock bumped into Tick and forgot what to do when morning came.". Log: "says: Made a new
friend ✓ | happened: Bumped into Tock and got dizzy. Forgot everything under "When morning came"."
and its mirror for Tock. Now take Tick to the bench:
```js
const hint = document.body.innerText.includes('Pick up Tick');
await __qa.key('KeyE');
await __qa.walkTo(6, 5); await __qa.turn(0);
await __qa.key('KeyE');
({ hint, panel: __qa.state().ui.panel })
```
Expect `hint: true` and `panel: { kind: 'robot', robotId: 1, mode: 'bench' }`. The header says
"Off until morning". Program tab: one "When morning comes" block with nothing inside, "1 / 12 blocks".
Screenshot.

## 8. The pond: a new core the same day, ruin overnight, scrapping

The shore and the pond's edge are laid by hand so the check doesn't depend on the seed's rocks.
```js
const F = await __qa.fixtures(); const W = await __qa.mod('/src/world/tiles.ts'); let s = __qa.state();
for (const tx of [38, 39]) {
  for (let tz = 21; tz <= 26; tz++) s = F.withTile(s, { tx, tz }, W.EMPTY_TILE, 'farm');
  s = F.withTile(s, { tx, tz: 27 }, W.blockedTile(F.T.Blocker.Water), 'farm');
}
__qa.load(F.withPlayer(s, { tx: 39, tz: 23 }, 2, 'farm'));
const out = [
  __meadowlight.addRobot('swimmer', { tx: 39, tz: 25, facing: 2 }),
  __meadowlight.addScriptedRobot({ name: 'Dunk', parts: ['claw'], loop: false, steps: [{ kind: 'move' }], place: { tx: 38, tz: 26, facing: 2 } }),
];
__qa.tick(8);
const v = (n) => { const r = __qa.robot(n); return { at: [r.tx, r.tz], power: r.power }; };
({ out, splash: v('Splash'), dunk: v('Dunk'), toasts: __qa.snap(2).toasts })
```
Expect `out: ["Added Splash.", "Added Dunk."]`, Splash `{ at: [39, 27], power: 'broken' }`, Dunk
`{ at: [38, 27], power: 'broken' }`, and the two toasts "[warn] Dunk drove into the water and
shorted out." and "[warn] Splash drove into the water and shorted out.". Fish Splash out and
send it for a new core:
```js
await __qa.walkTo(39, 26); await __qa.turn(2);
const fishHint = document.body.innerText.includes('Fish out Splash');
await __qa.key('KeyE');
__qa.patch((s) => { Object.assign(s.player, { tx: 10, tz: 6, facing: 0 }); });   // setup: the walk to the bin
const coreHint = document.body.innerText.includes('Send Splash for a new core · 300g');
await __qa.key('KeyE');
({ fishHint, coreHint, power: __qa.robot('Splash').power, gold: __qa.state().player.gold, toast: __qa.snap(1).toasts })
```
Expect both hints `true`, `power: 'repairing'`, `gold: 200`, and a toast ending "Splash is off
for a new core. Back tomorrow.". Leave Dunk in the water and sleep:
```js
__qa.sleep();
const v = (n) => { const r = __qa.robot(n); return { at: [r.tx, r.tz], power: r.power }; };
({ splash: v('Splash'), dunk: v('Dunk'), toasts: __qa.snap(8).toasts })
```
Expect Dunk `{ at: [38, 27], power: 'ruined' }` and Splash `{ at: [9, 6], power: 'working' }`.
The toasts include "[warn] Dunk spent the night in the water and is ruined. Scrap it at the
workbench." and "Splash is back from repairs.", and none says "away from a generator" (a ruined
robot and one back from repairs are never named). Stand on the shore (`__qa.patch((s) => {
Object.assign(s.player, { tx: 38, tz: 25, facing: 2 }); })`), zoom in (`KeyZ` ×3) and
screenshot: Dunk sunk in the water, dark, with no sparks. Then:
```js
__qa.patch((s) => { Object.assign(s.player, { tx: 38, tz: 26, facing: 2 }); });
const fishHint = document.body.innerText.includes('Fish out Dunk');
await __qa.key('KeyE');
__qa.patch((s) => { Object.assign(s.player, { tx: 10, tz: 6, facing: 0 }); });   // setup: to the bin
await __qa.key('KeyE');
const refusal = __qa.snap(1).toasts;
__qa.patch((s) => { Object.assign(s.player, { tx: 6, tz: 5, facing: 0 }); });    // setup: to the bench
const benchHint = document.body.innerText.includes('Put Dunk on the bench');
await __qa.key('KeyE');
({ fishHint, refusal, benchHint, panel: __qa.state().ui.panel, gold: __qa.state().player.gold })
```
Expect `fishHint: true`, `refusal: ["[warn] Dunk is beyond repair. Scrap it at the workbench."]`,
`benchHint: true`, `panel: { kind: 'robot', robotId: 2, mode: 'bench' }`, `gold: 200`. The
Program, .MD and Looks tabs each show "Dunk is ruined. It can only be scrapped." and no editor
controls, and the header has no On/Off switch. Click **Scrap**: "Scrap Dunk for 375g? This
can't be undone." with **Scrap** and **Keep**. Click **Scrap** in the prompt:
```js
const st = __qa.state(); ({ names: st.robots.list.map((r) => r.name), logIds: [...new Set(st.robots.log.entries.map((e) => e.robotId))], gold: st.player.gold, panel: st.ui.panel.kind, toast: __qa.snap(1).toasts })
```
Expect `names: ['Splash']`, `logIds: [1]` (Dunk's entries are gone), `gold: 575`,
`panel: 'none'`, `toast: ["[success] Scrapped Dunk for 375g."]`.

## 9. Paint a robot and switch it off; it stays off the next morning

```js
const F = await __qa.fixtures(); const s = __qa.state();
__qa.load(F.withPlayer(s, { tx: 6, tz: 5 }, 0, 'farm'));
const out = [
  __meadowlight.addScriptedRobot({ name: 'Rosie', parts: ['claw'], steps: [{ kind: 'turn', side: 'right' }], place: { tx: 6, tz: 6, facing: 2 } }),
  __meadowlight.addScriptedRobot({ name: 'Plain', parts: ['claw'], steps: [{ kind: 'turn', side: 'right' }], place: { tx: 7, tz: 6, facing: 2 } }),
];
__qa.bench('Rosie');
await __qa.key('KeyE');
({ out, panel: __qa.state().ui.panel.kind })
```
Expect `["Added Rosie.", "Added Plain."]` and `'robot'`. `find "Looks"` → click: 16 swatches
and **Paint · 50g**. Click the Rose swatch (the small robot drawing turns pink), then
**Paint · 50g**; click **Paint · 50g** once more; then click the switch's **Off**:
```js
const r = __qa.robot('Rosie'); ({ paint: r.paint, off: r.off, gold: __qa.state().player.gold, toasts: __qa.snap(2).toasts })
```
Expect `paint: 4`, `off: 'player'`, `gold: 450`, toasts "[success] Painted Rosie Rose." then
"[warn] Rosie is already Rose.". The header says "Switched off" and the switch offers **On**.
Click **Lift off**, then:
```js
await __qa.turn(2);
await __qa.key('KeyE');   // "Put down Rosie" on (6,6)
const seq = { rosie: __qa.robot('Rosie').actionSeq, plain: __qa.robot('Plain').actionSeq };
__qa.tick(30);
({ rosie: __qa.robot('Rosie').actionSeq - seq.rosie, plain: __qa.robot('Plain').actionSeq - seq.plain, off: __qa.robot('Rosie').off })
```
Expect `rosie: 0`, `plain` 7 or more, `off: 'player'`. Zoom in (`KeyZ` ×3) and screenshot:
Rosie's body and head shell pink beside Plain's sunflower yellow, trim the same on both. Then:
```js
__qa.sleep();
const seq = __qa.robot('Rosie').actionSeq;
__qa.tick(30);
const r = __qa.robot('Rosie'); ({ off: r.off, acted: r.actionSeq - seq })
```
Expect `off: 'player'` and `acted: 0`: the morning didn't switch it on. Back to the bench:
```js
__qa.patch((s) => { Object.assign(s.player, { tx: 6, tz: 5, facing: 2 }); });   // setup: next to Rosie
await __qa.key('KeyE');   // "Pick up Rosie"
await __qa.turn(0);
await __qa.key('KeyE');   // "Put Rosie on the bench"
({ panel: __qa.state().ui.panel })
```
Expect `panel: { kind: 'robot', robotId: 1, mode: 'bench' }`. Click **On**:
`__qa.robot('Rosie').off` is `null` and "Switched off" is gone from the header.

## 10. Peek at the Log with Shift + E; Stats after `unlockAll`

```js
const F = await __qa.fixtures(); const s = __qa.state();
__qa.load({ ...F.withPlayer(s, { tx: 6, tz: 6 }, 2, 'farm'), time: { ...s.time, minuteOfDay: 360 } });
__meadowlight.addRobot('spinner', { tx: 6, tz: 7, facing: 2 });
__qa.tick(12);   // turns at 6:04, 6:08 and 6:12; the next is 2.8 s of real time away
window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ShiftLeft', key: 'Shift', shiftKey: true, bubbles: true }));
await new Promise((r) => setTimeout(r, 100));
const hint = document.body.innerText.includes('Look at Spinner');
window.dispatchEvent(new KeyboardEvent('keyup', { code: 'ShiftLeft', key: 'Shift', bubbles: true }));
window.BEFORE = { robot: structuredClone(__qa.robot('Spinner')), energy: __qa.state().player.energy };
await __qa.shift('KeyE');
({ hint, panel: __qa.state().ui.panel, log: await __qa.logText(1, 'Spinner') })
```
Expect `hint: true`, `panel: { kind: 'robot', robotId: 1, mode: 'peek' }`, and one log line
"says: Turned ✓ … ×3". `get_page_text`: the only tab is Log (Stats is locked; Program, .MD and
Looks are bench-only), and there is no Save, Lift off, Scrap or On/Off. The Log tab has the
columns "Robot says" and "What happened", one row starting "6:04 am" with "Turned ✓" and "×3".
While the screen is still open (the game is frozen):
```js
({ same: __qa.same(__qa.robot('Spinner'), BEFORE.robot), energy: __qa.state().player.energy - BEFORE.energy })
```
Expect `same: true` and `energy: 0`: peeking costs nothing and changes nothing.
`computer key "Escape"` closes it. Then:
```js
const said = __meadowlight.unlockAll();
await __qa.shift('KeyE');
const r = __qa.robot('Spinner'); ({ said, mode: __qa.state().ui.panel.mode, stats: r.stats })
```
Expect `said: "Unlocked every block, card and tab."` and `mode: 'peek'`. Tabs: Stats and Log.
`find "Stats"` → click: the columns Today and This week show tokens used, actions taken and
crops handled equal to `stats.today` and `stats.week`, with crops handled 0 and tokens per crop
"—". `computer key "Escape"`. Shift + E at the workbench does what E does:
```js
__qa.patch((s) => { Object.assign(s.player, { tx: 6, tz: 5, facing: 0 }); });
await __qa.shift('KeyE');
({ toast: __qa.snap(1).toasts, panel: __qa.state().ui.panel.kind })
```
Expect a toast ending "Bring a robot here to work on it" and `panel: 'none'`.

## 11. The phone layout

```js
const s = __qa.state(); __qa.load({ ...s, time: { ...s.time, minuteOfDay: 360 } });
__meadowlight.addRobot('spinner', { tx: 6, tz: 6, facing: 0 });
__qa.bench('Spinner')
```
`resize_window {preset: 'mobile'}`, then reload `http://localhost:5173/` **without** `?new`
(the page saves as it unloads, so the benched robot comes back) and load the probe again. Then
`await __qa.key('KeyE')` ("Work on Spinner"). Screenshot: the tabs are a strip under the
header and the active tab fills the rest of the screen. Program tab: no docked toolbox, but a
**Blocks** button that opens a category menu; tap **Blocks**, pick **Actions** (its flyout
opens), screenshot, then drag one "Move forward" into the workspace ("1 / 12 blocks"). .MD tab: screenshot; the card lines fit the
width. `computer key "Escape"` and click **Discard** in the prompt, then
`resize_window {preset: 'desktop'}`.

## 12. The builds, and the editor in `dist-single`

In the terminal:
- `npm run build:check`: the table's `main`, `screen` and `editor` rows end `ok`, then
  "check-bundle: … files in dist/ checked for robotLog|installRobotDev|addScriptedRobot|setMd|setZone|unlockAll: none found"
  and "check-bundle: OK".
- `npm run build:single`: "build-single: wrote …/dist-single/index.html (… KiB)".

The single-file build has no dev hooks, so the robot comes in through its save. In the dev
page (`?new`, probe loaded):
```js
const F = await __qa.fixtures(); const s = __qa.state();
__qa.load(F.withPlayer(s, { tx: 6, tz: 5 }, 0, 'farm'));
__meadowlight.addRobot('spinner', { tx: 6, tz: 6, facing: 0 });
({ ...__qa.robot('Spinner'), onBench: true, tx: 6, tz: 4 })
```
It prints the benched robot as JSON. `preview_start {name: "meadowlight-single"}`
opens `http://localhost:4174/`, a fresh farm. In that tab, run this with `null` replaced by
the printed JSON (JSON is a valid object literal):
```js
const KEY = 'meadowlight-farm.save.v1';
const ROBOT = null;   // replace null with the robot JSON the dev page printed
if (ROBOT === null) throw new Error('Paste the robot from the dev page first.');
// The game saves on pagehide; this listener runs after it and adds the robot to that save.
addEventListener('pagehide', () => {
  const save = JSON.parse(localStorage.getItem(KEY));
  save.robots.list = [ROBOT];
  save.robots.nextId = ROBOT.id + 1;
  Object.assign(save.player, { tx: 6, tz: 5, facing: 0 });
  localStorage.setItem(KEY, JSON.stringify(save));
});
location.reload();
```
After the reload, `computer {action: 'key', text: 'e'}` ("Work on Spinner"): the robot screen
opens. `find "Program"` → click: "Opening the editor…", then the empty workspace with the
fixed-script note. Drag "When morning comes" in ("1 / 12 blocks") and screenshot. Then:
- `read_console_messages {onlyErrors: true}` → none;
- `read_network_requests {urlPattern: '/assets/'}` → no request: the screen and the editor came
  from the one page.

`preview_stop` the `meadowlight-single` server. Across checks 1–11 in the dev build,
`read_console_messages {onlyErrors: true}` → none.
````

- [ ] **Step 2: The probe helpers, the skill rows and the single-file server**

**2a.** In `.claude/skills/game-driven-qa/probe.js`, replace

```js
    /** Turn in place (Shift + direction), the real-keyboard way. 0 N, 1 E, 2 S, 3 W. */
    async turn(direction) {
      const code = ['KeyW', 'KeyD', 'KeyS', 'KeyA'][direction];
      return qa.key(code, 60, { shiftKey: true });
    },
```

with

```js
    /** Turn in place (Shift + direction), the real-keyboard way. 0 N, 1 E, 2 S, 3 W. */
    async turn(direction) {
      const code = ['KeyW', 'KeyD', 'KeyS', 'KeyA'][direction];
      return qa.key(code, 60, { shiftKey: true });
    },
    /**
     * Shift + a key, the real-keyboard way: Shift goes down first and up last, so both the
     * InputController's shiftHeld and the key's event.shiftKey see it. Shift + E peeks at a robot
     * (or clears the marker's zone); Shift + Space cycles the zone marker's letter.
     */
    async shift(code, holdMs = 60) {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ShiftLeft', key: 'Shift', shiftKey: true, bubbles: true }));
      await qa.key(code, holdMs, { shiftKey: true });
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'ShiftLeft', key: 'Shift', bubbles: true }));
      await new Promise((r) => setTimeout(r, 50));
      return qa.snap(2);
    },
    /** Deep equality that ignores key order, e.g. a saved program against the one that was loaded. */
    same(a, b) {
      const canon = (v) => (Array.isArray(v) ? v.map(canon) : v !== null && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
      return JSON.stringify(canon(a)) === JSON.stringify(canon(b));
    },
    /**
     * Setup only: puts the robot called `name` on the workbench (6,4) and stands the player on
     * (6,5) facing it, so qa.key('KeyE') ("Work on {name}") opens its screen. Use it when carrying
     * the robot there isn't what's being checked.
     */
    bench(name) {
      return qa.patch((s) => {
        const r = [...s.robots.list].reverse().find((x) => x.name === name);
        Object.assign(r, { onBench: true, carried: false, tx: 6, tz: 4 });
        Object.assign(s.player, { tx: 6, tz: 5, facing: 0, carrying: s.player.carrying === r.id ? null : s.player.carrying });
      });
    },
```

**2b.** In `.claude/skills/game-driven-qa/SKILL.md`, in the Quick reference table, directly after the row that starts `| What a block robot is doing |`, insert:

```markdown
| Put a robot on the bench (part 3) | Carry it (E), stand on (6,5) facing north (the workbench is (6,4)), E: "Put {name} on the bench". Setup shortcut: `__qa.bench('Atlas')`, then `await __qa.key('KeyE')` ("Work on Atlas") |
| The robot screen | `__qa.state().ui.panel` → `{ kind: 'robot', robotId, mode: 'bench' }` or `'peek'`. While it's open the game is frozen and the screen owns the keyboard: drive it with `find` + `computer` clicks, drags and keys, not `__qa.key`. Blockly: click a toolbox category, then `left_click_drag` from the flyout. Playbook: `scenarios/farmclaws-part3.md` |
| Peek at a robot | Face a standing robot, `await __qa.shift('KeyE')` ("Look at {name}" while Shift is held): Stats and Log only, read-only, free |
| Zone marker | Its slot: `__qa.state().inventory.slots.findIndex((s) => s?.itemId === 'zoneMarker')` (6 on a fresh farm, `Digit7`). `Space` marks a corner on the tile ahead, the second press paints `ui.zoneLetter`'s zone; `await __qa.shift('Space')` cycles A → H; `await __qa.shift('KeyE')` clears the letter's zone; Escape drops a draft (`ui.zoneDraft`) |
| Unlock everything | `__meadowlight.unlockAll()` → "Unlocked every block, card and tab." New farms have job 1's set, without the Stats tab, `If`, `For each tile` or variables |
| Compare programs | `__qa.same(a, b)`: deep equality ignoring key order, e.g. `__qa.same(__qa.robot('Atlas').program, program)` |
| The single-file build | `npm run build:single`, then `preview_start {name: "meadowlight-single"}` → `http://localhost:4174/`. It has no dev hooks; check 12 of `scenarios/farmclaws-part3.md` brings a robot in through the save |
```

In the Gotchas table, directly after the row that starts `| `setProgram` worked but the robot never starts |`, insert:

```markdown
| Keys do nothing while a robot screen is open | By design: the screen owns the keyboard and the game is frozen. `__qa.key` events go to `window` and never reach Blockly's fields; use `computer` keys. `computer key "Escape"` closes a dropdown or flyout first, then the screen (with the discard prompt if there are unsaved edits) |
| A saved `When morning comes` program sits idle | The save happened after 6:04. Load the clock to 6:00 just before opening the bench (the open screen holds the clock), or `__qa.sleep()` and watch from 6:04 |
```

**2c.** Replace `.claude/launch.json` with:

```json
{
  "version": "0.0.1",
  "configurations": [
    {
      "name": "meadowlight-dev",
      "runtimeExecutable": "npm",
      "runtimeArgs": ["run", "dev", "--", "--port", "5173", "--strictPort"],
      "port": 5173
    },
    {
      "name": "meadowlight-single",
      "runtimeExecutable": "npm",
      "runtimeArgs": ["run", "preview", "--", "--outDir", "dist-single", "--port", "4174", "--strictPort"],
      "port": 4174
    }
  ]
}
```

`vite preview --outDir dist-single` serves `dist-single/index.html` at `http://localhost:4174/` as a static file, the way the shared page is opened.

**2d.** Task 6 changed the dev preset `pair` (R11): both robots stay on the tile they're delivered to and loop `[harvest, turn right]`, so the crop goes under them. In `.claude/skills/game-driven-qa/scenarios/farmclaws-part1.md`, check 3, replace

````markdown
```js
const F = await __qa.fixtures(); let s = __qa.state();
for (const tx of [5, 6, 7, 8]) s = F.withTile(s, { tx, tz: 11 }, F.soilTile(F.T.TileState.Plowed, F.matureCrop('parsnip')), 'farm');
__qa.load(F.withPlayer(s, { tx: 5, tz: 9 }, 2, 'farm'));
__meadowlight.addRobot('pair', { tx: 5, tz: 10, facing: 2 });
```
Robots act on their own tile, so they bicker after moving onto (5,11). Poll until `snap().robots` shows `last: 'harvest bicker'`, then screenshot the red "!" badges (1.5 s). `await __qa.logText(6)` shows "says: Waiting my turn ✓ | happened: Fought Dee over the same tile. Nobody got it." The crop at (5,11) stays at stage 4.
````

with

````markdown
```js
const F = await __qa.fixtures(); let s = __qa.state();
s = F.withTile(s, { tx: 5, tz: 10 }, F.soilTile(F.T.TileState.Plowed, F.matureCrop('parsnip')), 'farm');
__qa.load(F.withPlayer(s, { tx: 5, tz: 9 }, 2, 'farm'));
__meadowlight.addRobot('pair', { tx: 5, tz: 10, facing: 2 });
```
Both robots stand on (5,10), on the crop, and act on their own tile, so their first act (a harvest) is a bicker, and so is every second act after it (harvest, turn right, harvest …). Since part 3, two robots can't move onto one tile without bumping, so the pair harvests in place instead of moving. Poll until `snap().robots` shows `last: 'harvest bicker'`, then screenshot the red "!" badges (1.5 s). `await __qa.logText(6)` shows "says: Waiting my turn ✓ | happened: Fought Dee over the same tile. Nobody got it." The crop at (5,10) stays at stage 4, and neither robot ever leaves (5,10).
````

- [ ] **Step 3: Sync the specs**

Make each edit exactly. Each "replace" quotes the current text in full.

**3a. The design, `docs/superpowers/specs/2026-09-29-farmclaws-design.md`.** Edits 1–10 are part 3 spec §14's list; edits 11–12 fix two sentences that bumps and ruin made false.

1. §2, replace
   `- **Nothing wears out.** Robots don't degrade, break down on their own or get worse over time. Every failure comes from the player's instructions, apart from rare rage events.`
   with
   `- **Nothing wears out.** Robots don't degrade, break down on their own or get worse over time. Every failure comes from the player's instructions, apart from rare rage events. Two breakdowns are the exceptions, both caused by the player's setup and neither random: a robot that bumps into another forgets the stack it was running, and a robot left in water overnight is ruined and can only be scrapped (part 3).`

2. §3.5, replace
   `The Log tab shows both side by side, newest first, for the current and previous day. Identical consecutive entries collapse into one with a count (×7).`
   with
   `The Log tab shows both side by side, newest first, for the current and previous day. Identical consecutive entries from the same day collapse into one with a count (×7): the farm log merges repeats only within a day.`

3. §5.1, replace
   `Programs are built from blocks in a Blockly-style editor: blocks snap together, and the fields inside them are dropdowns. Labels are plain English in sentence case. The editor's toolbox shows only unlocked blocks, and a counter shows blocks used against the robot's limit (for example, 7 / 12).`
   with
   `Programs are built from blocks in the editor, Blockly on its Zelos (rounded) renderer: blocks snap together, and the fields inside them are dropdowns. Labels are plain English in sentence case. The editor's toolbox shows only unlocked blocks, and a counter shows blocks used against the robot's limit (for example, 7 / 12). Unlocks gate the editor only: a saved program may use any block. The editor is loaded lazily, with a budget of ≤ 250 KB gzipped for its chunk, ≤ 40 KB for the robot screen chunk, and ≤ 10 KB growth of the main bundle.`

4. §5.2, replace
   ``**Values:** number and text literals, `my tile`, `tile ahead`, `tokens left`, `count of [item ▾] in bag`, `message`, variables, `+ − ×` and comparisons.``
   with
   ``**Values:** number and text literals, `my tile`, `tile ahead`, `tokens left`, `count of [item ▾] in bag`, `message`, variables, `+ − ×` and comparisons. Job 1 also unlocks `tokens left` and comparisons, so `Repeat until` has a condition ("Repeat until tokens left < 10"). `tile ahead is blocked` is Yes when a robot stands on the tile ahead (part 3).``

5. §5.4, replace
   ``  - `off` ignores triggers until the player switches the robot on. This is a separate on/off switch, not a power state.``
   with
   ``  - `off` ignores triggers. It's a field of its own, not a power state. The player's on/off switch at the workbench sets `off: 'player'`, which lasts through every morning until the player switches the robot on; a robot that got dizzy or carried out a DO power-down card is off only until morning.``

6. §6, replace
   `Robots are modded at a **workbench**, a placed object on the farm. The player carries a robot to a workbench and sets it down on it to open its screen; that is the only way to change a robot's program, .MD, parts or looks. Pressing E on a robot in the field only picks it up or puts it down. A robot on the bench is out of work until it's carried off, so reprogramming is a deliberate trip, like taking a machine into the workshop. (Decided 2026-10-02. Part 3 settles where the first workbench comes from, its recipe or price, and whether the Log and Stats tabs can also be read in the field.)`
   with
   `Robots are modded at a **workbench**, a placed object on the farm. The player carries a robot to a workbench and sets it down on it to open its screen; that is the only way to change a robot's program, .MD, parts or looks. Pressing E on a robot in the field only picks it up or puts it down; Shift + E peeks at its Stats and Log anywhere, read-only. A robot on the bench is out of work until it's carried off, so reprogramming is a deliberate trip, like taking a machine into the workshop. The first workbench is built into every farm beside the farmhouse; crafting more arrives in release 5. The bench also scraps robots for a quarter of their size's price and paints them. (Decided 2026-10-02 and settled in part 3.)`

7. §6, replace the table row
   `| Looks | Paint, voice, personality and quirk (section 7) |`
   with
   `| Looks | Paint, from part 3; voice, personality and quirk arrive in part 6 (section 7) |`

8. §6, replace
   `The zone tool (a new hotbar tool Sol gives you in job 1) paints named rectangular zones on the farm, A to H.`
   with
   `The zone marker (a hotbar tool in every backpack from part 3, which Sol explains in job 1) paints named rectangular zones on the farm, A to H.`

9. §7.1, replace
   `There are 16 base colours, 4 patterns (plain, stripes, spots, two-tone) and 8 decals. Limited editions add special finishes such as chrome, glow-in-the-dark trim and hand-painted flowers.`
   with
   `There are 16 base colours, 4 patterns (plain, stripes, spots, two-tone) and 8 decals. Limited editions add special finishes such as chrome, glow-in-the-dark trim and hand-painted flowers. The 16 base colours are available at the bench from release 1, for 50g a coat; patterns, decals and finishes stay in release 3.`

10. §8, replace
    `**Job 1: The spinning robot.** Given by Sol at the parts exchange, who gives you your first Mini (with a Watering head) and the zone tool.`
    with
    `**Job 1: The spinning robot.** Given by Sol at the parts exchange, who gives you your first Mini (with a Watering head) and explains the zone marker, which is already in every backpack (part 3).`

11. §3.1, replace
    `Robots don't collide with each other or with the player. Two robots can stand on one tile, and the player walks through robots.`
    with
    `Robots don't collide with the player, who walks through them. Robots do bump into each other (part 3): two robots moving into one tile, two swapping tiles, or one moving into a robot that stays put all stay where they are, dizzy until morning, and a robot running a block program forgets the stack it was running.`

12. §3.4, replace
    `- **Broken:** the player fishes the robot out of the water, which is a pick-up and costs the same energy. They carry it to the shipping bin and send it for repair for 20% of its price. It's back, charged, in front of the bin the next morning; once the mechanic is hired (job 5), the same day. Robots are never lost for good.`
    with
    `- **Broken:** the player fishes the robot out of the water, which is a pick-up and costs the same energy. They carry it to the shipping bin and send it for a new core for 20% of its price. It's back, charged, in front of the bin the next morning; once the mechanic is hired (job 5), the same day. A robot still in the water at the end of the day is ruined and can only be scrapped at the workbench (part 3).`

**3b. The part 1 spec, `docs/superpowers/specs/2026-09-29-farmclaws-part1-robot-core.md`.**

1. §5.3, replace
   `Only these tile actions bicker. Moves never do: robots can share a tile. Deposits and takes on one container happen in id order.`
   with
   `Only these tile actions bicker. Moves never bicker; since part 3 they bump instead (part 3 spec §3.1): two or more moves into one tile, two robots swapping tiles, or a move into a standing robot that stays put. A bumped robot pays for the move, stays where it is and is dizzy until morning. Robots already sharing a tile in an older save may stay; moving out is never a bump. Deposits and takes on one container happen in id order.`

2. §5.6, replace
   `- If the **most recent entry for that robot** has an equal event (deep equality), its `count` goes up by one instead. The day, minute and tile stay those of the first entry.`
   with
   `- If the **most recent entry for that robot** has an equal event (deep equality) and was logged today (its `day` is the current day), its `count` goes up by one instead. The day, minute and tile stay those of the first entry. A repeat on a new day starts a new entry (part 3).`

3. §5.7 step 3, replace
   `It stands on the nearest walkable tile to `ROBOTS.repairDropOff` (the tile in front of the shipping bin), facing South.`
   with
   `It stands on the nearest walkable tile with no standing robot to `ROBOTS.repairDropOff` (the tile in front of the shipping bin), facing South.`

4. §5.7, replace
   `4. **Recharge:** robots only recharge **near a generator**. In id order, every robot that isn't `broken` or `repairing`, and stands within`
   with
   `4. **Ruin (part 3):** every `broken` robot standing on a water tile (not carried, not on the bench) becomes `ruined`. It logs `ruined` and pushes the warn toast "{name} spent the night in the water and is ruined. Scrap it at the workbench." A robot fished out the same day, or still carried at day end (step 2), is safe.`
   `5. **Recharge:** robots only recharge **near a generator**. In id order, every robot that isn't `broken`, `ruined` or `repairing`, and stands within`
   (two lines, as numbered list items).

5. §5.7 step 5 (now step 5, Recharge), replace
   `   - If any robot that isn't broken or repairing was out of range (even a fully charged one), the toast`
   with
   `   - If any robot that isn't broken, ruined or repairing was out of range (even a fully charged one), the toast`

6. §5.7, replace
   `5. **Reset:** robots **stay where they are**.`
   with
   `6. **Reset:** robots **stay where they are**.`

7. §5.7 Reset, replace
   `it moves to the nearest walkable farm tile by breadth-first search in `DIRECTIONS` order, with `teleportSeq + 1`.`
   with
   `it moves to the nearest walkable farm tile with no standing robot by breadth-first search in `DIRECTIONS` order, with `teleportSeq + 1`. A robot on the workbench stays there (part 3).`

8. §5.7 Reset, replace
   `   - `pc = 0`, `tokensToday = 0`, `nextActMinute` as in 5.1. Its program starts again from wherever it stands.`
   with
   `   - `pc = 0`, `stats.today` zeroed (and `stats.week` when the new day starts a week), `nextActMinute` as in 5.1. Its program starts again from wherever it stands. Part 3 replaced `tokensToday` with `stats.today.tokens` (part 3 spec §6.1).`

9. §5.7 Reset, replace
   `   - a broken robot stays broken where it is (in the water, or on land if it was carried out) until it's sent for repair`
   with
   `   - a broken robot on land stays broken where it is until it's sent for a new core; one still in the water was ruined in step 4`

10. §5.8, replace the row
    `| The shipping bin, carrying a **broken** robot | `{ kind: 'repairRobot' }` | Costs `repairCost` gold. The robot becomes `repairing` with `repairReadyDay = absoluteDay + 1`, is no longer carried, and `player.carrying = null`. Toast: "{name} is off to be repaired. Back tomorrow." Hint: "Send {name} for repair · {cost}g". Not enough gold: blocked with "Repairs cost {cost}g." |`
    with the two rows
    `| The shipping bin, carrying a **broken** robot | `{ kind: 'repairRobot' }` | A new core (part 3). Costs `repairCost` gold. The robot becomes `repairing` with `repairReadyDay = absoluteDay + 1`, is no longer carried, and `player.carrying = null`. Toast: "{name} is off for a new core. Back tomorrow." Hint: "Send {name} for a new core · {cost}g". Not enough gold: blocked with "Repairs cost {cost}g." |`
    `| The shipping bin, carrying a **ruined** robot | — | Blocked with "{name} is beyond repair. Scrap it at the workbench." (part 3) |`

11. §5.8, replace the row start
    `| A walkable in-bounds tile that isn't reserved | `{ kind: 'putDownRobot' }` |`
    with
    `| A walkable in-bounds tile that isn't reserved and has no standing robot (part 3) | `{ kind: 'putDownRobot' }` |`
    and directly before the row that starts `| Anything else |`, insert
    `| A tile with a standing robot | — | Blocked with "There's a robot there." (part 3) |`

**3c. The part 2 spec, `docs/superpowers/specs/2026-10-02-farmclaws-part2-language.md`.**

1. §2.6, replace
   ```ts
     /** Why the robot ignores everything until morning. Separate from `power` (design §5.4). Part 3 adds 'player'. */
     readonly off: null | 'dizzy' | 'done';
   ```

   An `off` robot never acts and never fires triggers. The morning reset clears `'dizzy'` and `'done'`.
   with
   ```ts
     /** Why the robot ignores everything: until morning for 'dizzy' and 'done', until switched on for 'player'. Separate from `power` (design §5.4). */
     readonly off: null | 'dizzy' | 'done' | 'player';
   ```

   An `off` robot never acts and never fires triggers. The morning reset clears `'dizzy'` and `'done'`, but not `'player'`: a robot switched off at the workbench stays off until the player switches it on (part 3 spec §2.4).
   (The replaced span runs from the comment line through the end of the paragraph after the closing fence.)

2. §5.1 Expressions (the rule behind §2.2's `tileAheadIs` sensor), replace
   `` `tileAheadIs`: `water` is a water blocker, `clear` is a walkable farm tile, and `blocked` is anything else. ``
   with
   `` `tileAheadIs`: `water` is a water blocker, `clear` is a walkable farm tile with no standing robot on it, and `blocked` is anything else, including a tile with a standing robot (part 3 spec §3.1). ``

3. §5.3, replace
   `Other robots never block a route (robots don't collide, design §3.1).`
   with
   `Other robots never block a route, because robots move; a route step into a standing robot bumps like any move (part 3 spec §3.1).`

4. §7, replace
   `  - `off` is cleared.`
   with
   `  - `off` is cleared when it's `'dizzy'` or `'done'`; `'player'` stays (part 3 spec §2.4).`

5. §7, replace
   `- **Off means off until morning.** A robot that is off (`'dizzy'` / `'done'`) and is carried and put down stays off and never acts until the morning reset.`
   with
   `- **Off means off until morning** for `'dizzy'` and `'done'`, and until the player switches it on for `'player'` (part 3). A robot that is off for any reason and is carried and put down stays off and never acts until then.`

6. §17, replace
   `- **Turning off.** `off` is a field separate from `power`. Dizzy and DO power-downs turn the robot off until morning; part 3 adds the player's switch.`
   with
   `- **Turning off.** `off` is a field separate from `power`. Dizzy and DO power-downs turn the robot off until morning; part 3 adds the player's switch, `off: 'player'`, which survives the morning.`

**3d. The part 3 spec, `docs/superpowers/specs/2026-10-03-farmclaws-part3-robot-screen.md`.**

1. §10.1, replace
   `- **The editor chunk** (the lazy chunk containing Blockly, found through its source map's `sources`) must be ≤ **250 KB gzipped**.`
   with
   `- **The editor chunk** (every lazy chunk containing Blockly, found through its source map's `sources`, added up: `blockly/core` and `blockly/msg/en` load as two chunks) must be ≤ **250 KB gzipped**.`

2. §10.1, replace
   `The baseline is recorded in `scripts/bundle-baseline.json` as 274,312 bytes (`index-*.js` at gzip level 6, part 2 head).`
   with
   `The baseline is recorded in `scripts/bundle-baseline.json` as 275,539 bytes (part 2's `index-CUmkGRNG.js` at commit `2a92771` through `zlib.gzipSync` at level 6; the `gzip -6` command line gives 274,312 for the same file).`

3. §10.2, replace
   `- `build:single` builds with Vite's `inlineDynamicImports` (a `single` mode in `vite.config.ts`). That puts the screen and the editor inside the one page.`
   with
   `- `build:single` builds in a `single` mode (`vite.config.ts`) with Rolldown's `codeSplitting: false`, Vite 8's name for `inlineDynamicImports`. That puts the screen and the editor inside the one page.`

4. §10.2, replace
   `- `build-single.mjs` also fails when the inlined code still contains an `import(` of an `assets/` path.`
   with
   ``- `build-single.mjs` also fails when the inlined code still contains an `import(` of a built chunk, whether relative (``import(`./RobotScreen-….js`)``, as Vite writes it) or under `assets/`.``

5. §11, after the row that starts `| `tests/robotScreen.test.ts` |`, insert
   `| `tests/checkBundle.test.ts` | The rules behind `scripts/check-bundle.mjs` and `scripts/build-single.mjs`: the entry read from `dist/index.html`, chunks sorted by their source maps, the three budgets at and over their limits, Blockly's placement, the dev-hook grep, and the single-file build's lazy-import guard. |`

6. At the end of the file, after §14's last bullet, append:

```markdown

---

## 15. Plan refinements

Decided by the part 3 implementation plan and its execution. Each one keeps the intent of the rule it refines.

- **R1.** The spec's `withProgram` is part 2's `programmedRobot(robot, program, minuteOfDay)`, moved unchanged into `src/robots/edits.ts` (section 4.7).
- **R2.** `isDue` treats every robot whose `off` isn't null as not due, scripts included, so a bumped or switched-off script robot really stops. Part 1 scripts never set `off`, so part 1 behaviour is unchanged.
- **R3.** Action type strings avoid the dist check's names (section 10.3): the .MD edit is `robot/md`, not `robot/setMd`.
- **R4.** `UNLOCKS` and the "Make a variable" gate use one kind, `var`, for the variable getter, `Set`, `Change` and declarations; `set` and `change` keep their own kinds for the toolbox (section 7).
- **R5.** The robot screen's load-failure toast needs an action, so the reducer gains `ui/notify` (`actions.notify(text, tone)`), which pushes a toast (section 4.1).
- **R6.** `ROBOTS.weekLength` (7) carries the weekly stats rollover (section 6.1): `week` resets when `(dayOfSeason − 1) % ROBOTS.weekLength` is 0, since no week constant existed.
- **R7.** Until step 11, an open robot panel shows nothing, and Escape still closes it through `panelKeyCommand`; step 11 hands the keyboard to the screen.
- **R8.** `src/robots/edits.ts` returns neutral refusals (`PROGRAM_SHAPE`, `MD_SHAPE`, `ZONE_SHAPE`) for input that isn't a program, a card list or a zone, and the dev hooks map them back to their usage lines with `consoleText`, so the usage lines naming `setMd(` and `setZone(` stay in `src/dev/robotDev.ts` and out of `dist/` (section 10.3).
- **R9.** The translator only orders top-level blocks (section 5); the Program tab re-spaces them `ROBOT_SCREEN.stackGap` apart after loading.
- **R10.** The long-variable-name case for "values outside the editor's usual options" uses 16 characters, `ROBOTS.maxIdentifierLength`, the longest name the checker accepts.
- **R11.** The dev preset `pair` now harvests in place and turns: both robots stay on the tile they're delivered to and loop `Harvest`, `Turn right`, because two robots can no longer walk onto one tile (section 3.1). It still demonstrates a bicker and never bumps.
- **R12.** The main-chunk baseline is 275,539 bytes: part 2's `index-CUmkGRNG.js` through `zlib.gzipSync` at level 6, the measure `check-bundle.mjs` uses. The 274,312 first written here was the `gzip -6` command line's figure for the same file. The budgets in section 10.1 read 1 KB as 1,024 bytes, the unit `check-bundle.mjs` prints (section 10.1).
- **R13.** The `single` build mode sets Rolldown's `codeSplitting: false`; Vite 8 still accepts `inlineDynamicImports` but warns that it is deprecated (section 10.2).
- **R14.** The editor budget adds up every lazy chunk whose source map lists `node_modules/blockly/`, since `blockly/core` and `blockly/msg/en` load as two chunks. Vite writes lazy imports relative to the importing chunk, so `build-single.mjs` refuses any `import(` of a built `.js` file that is relative or under `assets/` (sections 10.1 and 10.2).
- **R15.** A new program clears `off: 'dizzy'` and `'done'` but keeps `'player'`: only the bench's switch turns a robot the player switched off back on (sections 2.4 and 4.7).
- **R16.** Blockly's media (sprites, cursors, field icons) are copied from the package into `public/blockly-media/` and passed to Blockly as `media: 'blockly-media/'`, because the package exports no media path to bundle; the editor never fetches from Blockly's host. The media are served from a relative `blockly-media/` folder, so the dev server, `dist/` and `dist-single/` opened from disk all find it. `build-single.mjs` copies the folder beside `dist-single/index.html` (sections 4.2 and 10.2).
- **R17.** Escape while the game is paused keeps a zone draft: `panelKeyCommand` drops the draft only when the game isn't paused, so Escape resumes first (section 8).
- **R18.** `game/load` keeps `ui.zoneLetter` (it resets only the draft); `deserializeGame` is what resets the letter to A (section 8).
- **R19.** Switching a robot off is refused unless it is working, on standby or flat: "{name} can't be switched off while it's broken." The save allows `off: 'player'` only in those powers (sections 2.4 and 9.2).
- **R20.** The axe, like the pickaxe, is refused on the workbench ("It's part of the farm."), so the bench can't be chopped or broken (section 2.2).
- **R21.** `freeSpotNear` skips fertilised soil, because a placed object on fertilised soil is invalid (section 2.1).
- **R22.** The `blocked` intent has an optional `hint`, set only by the empty workbench so the HUD shows "Bring a robot here to work on it" (section 2.2).
- **R23.** Gold in the scrap toast and prompt is a plain number ("1000g"), where section 3.3 writes "1,000g" (section 3.3).
- **R24.** The UI labels the spec doesn't give, which the plan invents: "No parts", "Nothing to show yet.", "No cards yet.", "Yesterday", the power labels "Standing by", "Shorted out", "Getting a new core" and "Ruined", and "This program is too big or too deeply nested to save." (sections 4 to 6).
```

- [ ] **Step 4: Copy in the rulings recorded during execution**

List the part 3 commit bodies:

`git log --reverse --grep='^Farmclaws part 3' --format='%n%h %s%n%b'`

Every ruling a commit body records (the spec's "pick the smallest change that keeps the rule's intent and write it down in the step's commit message", including any browser-check fix from Step 6) that R1–R24 and edits 3a–3d don't already cover gets two edits in the part 3 spec: the section it changes is reworded to say the rule as it now stands, and section 15 gains a bullet numbered on from R24 (R25, R26, …) that names the commit's short hash. Task 14's own commit records R12–R14, Task 6's records R11, Task 5's records R15 and Task 12's records R16; all are already in, and Step 3d writes R17–R24 into the spec.

- [ ] **Step 5: The full gate**

Run: `npm run typecheck && npm test && npm run build:check && npm run build:single`
Expected: all green. `build:check` ends with "check-bundle: … files in dist/ checked for robotLog|installRobotDev|addScriptedRobot|setMd|setZone|unlockAll: none found" and "check-bundle: OK", its `main`, `screen` and `editor` rows each marked `ok`; `build:single` ends with "build-single: wrote …/dist-single/index.html (… KiB)". These are the spec §13 checks: the whole suite, the build, the budgets and the single-file build.

- [ ] **Step 6: Run the playbook**

Invoke the `game-driven-qa` skill and follow its "Start every run like this" (dev server `meadowlight-dev`, `http://localhost:5173/?new`, the probe), with the browser pane shown. Run checks 1–12 of `scenarios/farmclaws-part3.md`, each from a fresh `?new` farm, at desktop width; check 11 is the phone width (spec §13: "at desktop and phone width"). Then run part 1's check 3 (`scenarios/farmclaws-part1.md`) once, for the new `pair` preset. Report one line per check, **PASS / FAIL — evidence**, as the skill says.

A FAIL is a bug unless the spec supports what the game did: reproduce it with `__qa.tick` or the dev hooks, write a failing unit test, fix it at source in its own commit (`Farmclaws part 3: …`, with any ruling in the body), and run the check again. A ruling made that way goes into the part 3 spec through Step 4 before the spec commit. When all twelve pass, add this line under the playbook's first paragraph, with the run's date: `Last run: YYYY-MM-DD — all twelve checks PASS.`

Finish with `resize_window {preset: 'desktop'}` and `preview_stop` for any `meadowlight-single` server still running.

- [ ] **Step 7: Commit**

Two commits:

```bash
git add .claude/skills/game-driven-qa/scenarios/farmclaws-part3.md .claude/skills/game-driven-qa/scenarios/farmclaws-part1.md .claude/skills/game-driven-qa/probe.js .claude/skills/game-driven-qa/SKILL.md .claude/launch.json
git commit -m "Farmclaws part 3: the robot screen playbook, probe helpers and the single-file preview

The part 1 pair check puts its crop under the pair, which now harvests in place.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

```bash
git add docs/superpowers/specs/2026-09-29-farmclaws-design.md docs/superpowers/specs/2026-09-29-farmclaws-part1-robot-core.md docs/superpowers/specs/2026-10-02-farmclaws-part2-language.md docs/superpowers/specs/2026-10-03-farmclaws-part3-robot-screen.md
git commit -m "Farmclaws part 3: sync the design and the part 1-3 specs with the build

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
