# Release 1 Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Release 1 loses the cut v2 sections (save v12), its dead code and four audit bugs, and gains the backpack upgrade and the job 2 and job 3 recipes. Every rule the cleanup touches ends up with one owner in the code.

**Architecture:** Mostly deletions and small moves. The one new shape is a canonical recipe insert in `src/crafting/known.ts`, which jobs, the v12 migration and the dev hook all call. Shared helpers replace the parallel copies: `sowableTiles` for the job fields, `idlePower` for standby, `toolboxStale` for the program tab, and `seedShopOpen` for Marigold's panel.

**Tech Stack:** TypeScript (strict, `erasableSyntaxOnly`), Three.js, Vite, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-02-release1-cleanup-design.md`. It's the binding authority for every rule, number and line of text; this plan says where each piece goes and which tests pin it.

**Branch:** `release1-cleanup`, cut from `codebase-audit` (952fc48). That branch is `origin/main` plus the job 1 recipe commit (7b3544a, save v11) and the spec, and this build depends on both.

## Global Constraints

- Pure, deterministic simulation: no `Math.random`, clock reads or I/O in `src/core`, `src/state`, `src/world`, `src/farming`, `src/time`, `src/robots`, `src/jobs` or `src/people`. Randomness through `hash32` / `hashFloat`.
- No enums, namespaces or parameter properties; `as const` objects with union types; `import type` for types.
- Immutable state with structural sharing: `withRecipes` returns the same state when nothing is new, and `knownWith` returns the same array.
- Numbers come from `src/config.ts`: `INVENTORY.backpackUpgradePrice`, `INVENTORY.slotCount`, `JOBS.tokensPerCrop`, `JOBS.waveAt`.
- Player-facing text is copied verbatim from the spec, punctuation included.
- Saves: `SAVE_VERSION = 12`. Each removed field leaves its type, `createDefaultSections`, validation and the tests in the same commit as `migrateV11toV12`. `v11Save` joins `tests/testUtils.ts`, and `v10Save` builds on it.
- No dev-hook words (`setMd`, `setZone`, `unlockAll`, `robotLog`, `installRobotDev`, `addScriptedRobot`) in production code, comments or strings.
- `src/ui/robotScreen/` and `src/ui/shops/` stay lazy. The main chunk must not grow, and `MAIN_GROWTH_MAX_GZIP` stays at 53 KiB. The backpack row goes in `SeedShopPanel.ts`.
- Robot speech is untouched: `robotSays` still ends in " ✓".
- Gate per task: `npm run typecheck && npm test && npm run build`. Tasks 1, 4, 9, 10 and 11 also run `npm run build:check`.
- Commits start `Release 1 cleanup: ` and end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A v11 save whose `crafting.known` is already corrupt** (out of order, or holding an unknown id), with job 2 done. The v12 step must leave the list as found, so the validator refuses the save; it must not repair it or throw. Pinned in Task 7.
2. **A chest on an unripe tile of Cosmo's checkerboard.** Job 2's count stays 18, and the job can still pass that day; only ripe tiles count. Pinned in Task 2.
3. **Buying the backpack with exactly 2000g.** It succeeds and leaves 0g; with 1999g it's refused. Pinned in Task 9.
4. **The player standing on `JOBS.waveAt` when job 2 is taken.** The set-up succeeds and the result passes `isValidGameState`. Pinned in Task 3.
5. **Fitting a sensor eye while the canvas has unsaved edits.** The toolbox updates, and the unsaved program stays on the canvas. Pinned by `toolboxStale` in Task 4 and checked by eye in Task 11's browser pass.

---

## File map

| File | Responsibility |
| --- | --- |
| `src/render/LightingManager.ts`, `structureGeometry.ts`, `townGeometry.ts`, `sceneryGeometry.ts` | Dead names; one shared `cosmetic` (T1) |
| `src/state/actions.ts`, `src/state/reducer.ts`, `src/state/selectors.ts`, `src/state/intents.ts`, `src/core/store.ts` | Test-only actions, selectors and helpers out (T1); `shop/backpack` and `seedShopOpen` (T9); recipe toasts (T8); `talkedToday` out (T7) |
| `src/core/hash.ts` | Five unused salts out (T1) |
| `src/jobs/checks.ts`, `src/jobs/setup.ts` | `sowableTiles` and the world-taking field functions (T2); Wave's fallback (T3) |
| `src/people/lines.ts` | `robotSaidToday` counts only the player's robots (T3) |
| `src/ui/robotScreen/blockly/toolbox.ts`, `tabs/ProgramTab.ts` | `toolboxStale` and the rebuild (T4) |
| `src/robots/exec.ts`, `create.ts`, `edits.ts`, `overnight.ts` | `idlePower` (T5) |
| `src/crafting/known.ts` (new), `src/jobs/jobs.ts`, `src/dev/robotDev.ts` | One recipe insert (T6); `recipesOnDone` (T8) |
| `src/core/types.ts`, `src/state/initialState.ts`, `src/state/sectionValidation.ts`, `src/state/validation.ts`, `src/state/persistence.ts` | Save v12 (T7) |
| `src/render/objectGeometry.ts`, `objectLayout.ts`, `ObjectRenderer.ts`, `TileHighlighter.ts` | Trophy, decoration and glass out (T7) |
| `src/ui/shops/SeedShopPanel.ts`, `src/ui/shops/viewModel.ts`, `src/config.ts` | The backpack row (T9) |
| `src/io/saveStore.ts` (new), `src/main.ts` | Save I/O (T10) |
| `tests/testUtils.ts` | `atShop`, moved exports (T1); `v11Save`, recipe-teaching helpers (T7) |
| Specs, playbooks, `README.md`, `CLAUDE.md`, `docs/PHASE0-SPEC.md`, `docs/PLAN-v2.md` | Sync (T11) |

## Facts every task needs

- `withRecipes` is private in `src/jobs/jobs.ts:157` and appends. `takeJob` (`:150`) applies it. `finishJob` (`:164`) pays the reward and moves the statuses.
- `withBurnerKnown` (`src/dev/robotDev.ts:111`) already inserts canonically: `CRAFTING_RECIPE_IDS.filter(...)`.
- `CRAFTING_RECIPE_IDS` order (`src/core/types.ts:214`): chest, woodFence, woodPath, stonePath, scarecrow, sprinkler, qualitySprinkler, basicFertilizer, qualityFertilizer, speedGro, woodBurner. `isCanonicalSubset` is in `src/state/validation.ts:52`.
- `takeJobAct` (`src/state/reducer.ts:1233`) toasts every `recipesOnTake`; `applyJobCheck` (`:1251`) toasts the done line and then `doneLines`.
- `setup.ts` imports `BARNABY_SOWN`, `bedTiles` and the robot names from `checks.ts`, so `checks.ts` can't import `setup.ts` (see R1).
- `sowField` (`setup.ts:122`) skips tiles whose `object !== null`. `cosmoRipeTiles` (`checks.ts:105`) and `barnabyFieldTiles` (`:149`) take no arguments today. Callers: `balance.test.ts`, `job2.test.ts` and `job3.test.ts`.
- `nearestFreeWalkable(state, mapId, from, selfId)` (`src/robots/world.ts:143`) is what `setUpKnowTheLimits` uses for the Minis.
- `reactiveFill`'s `robotSaidToday` (`src/people/lines.ts:169`) reads every log entry. `lowestIdWith` (`:218`) shows the player-only filter the other cases use. Log entries carry `robotId`.
- `ProgramTab.sync` (`src/ui/robotScreen/tabs/ProgramTab.ts:182`) rebuilds only when `state.robots.unlocks` changes; `syncUnlocks` (`:595`) does the rebuild. `toolboxFor(robot, unlocks)` is in `blockly/toolbox.ts:201`.
- The standby rule today: `programmedRobot` (`src/robots/edits.ts:51`) and the morning reset (`src/robots/overnight.ts:315`). `newRobot` (`src/robots/create.ts:108`) always says `'working'`. `catalogueRobot` (`src/robots/workshop.ts:91`) calls `newRobot`.
- `buySeeds` (`src/state/reducer.ts:854`) checks only `panel.kind === 'shop'`. `partsShopOpen` (`:879`) is the model for `seedShopOpen`.
- `saveGame`, `loadGame`, `clearSave`, `SAVE_KEY` and the private `storage()` are in `src/state/persistence.ts:52, 787–818`. `main.ts:41` is the only importer.
- `migrateV10toV11` (`persistence.ts:747`) is the newest step. `migrateV6toV7` (`:526–536`) and `migrateV7toV8` (`:556–570`) touch `quests.board` and `festival.giftTarget`.
- The `'shopDoor'` intent and the reducer's `openSlopShop` function stay. Only the `shop/door` and `slop/open` actions and their cases (`reducer.ts:145–148`) go.
- The `cosmetic` helpers in `CropRenderer.ts` and `TerrainRenderer.ts` take different arguments and stay. Only the town and scenery copies collapse onto `structureGeometry`'s.
- Test helpers today: `withPlayer`, `withJobsDone`, `withMigratedJobs`, `withBurnerLearned`, `livelySections`, `chatsOf`, `v10Save` … `v6Save`, `BASE`, `must`.

## Interface contract

```ts
// src/jobs/checks.ts (T2)
export function sowableTiles(world: WorldState, rect: TileRect): readonly TileCoord[]; // row by row, tiles with no placed object
export function cosmoRipeTiles(world: WorldState): readonly TileCoord[];   // sowable ∩ the (tx + tz) even half
export function barnabyFieldTiles(world: WorldState): readonly TileCoord[]; // sowable tiles of BARNABY_SOWN
export function barnabyBudget(world: WorldState): number;                   // JOBS.tokensPerCrop × barnabyFieldTiles(world).length
// Callers pass state.maps.neighbours.

// src/ui/robotScreen/blockly/toolbox.ts (T4)
export interface ToolboxInputs { readonly unlocks: RobotUnlocks; readonly parts: Robot['parts'] }
export function toolboxStale(prev: ToolboxInputs, next: ToolboxInputs): boolean; // unlocks by reference, parts by contents

// src/robots/exec.ts (T5)
export function idlePower(power: RobotPower, exec: RobotExec | null): RobotPower; // 'standby' when power is 'working', exec isn't null and exec.running is null; else power

// src/crafting/known.ts (T6)
export function knownWith(known: readonly CraftingRecipeId[], recipes: readonly CraftingRecipeId[]): readonly CraftingRecipeId[]; // canonical; the same array when nothing is new
export function withRecipes(state: GameState, recipes: readonly CraftingRecipeId[]): GameState;   // the same state when nothing is new
export function unknownRecipes(state: GameState, recipes: readonly CraftingRecipeId[]): readonly CraftingRecipeId[]; // in `recipes` order

// src/jobs/jobs.ts (T8)
// JobDef gains: readonly recipesOnDone: readonly CraftingRecipeId[];

// src/state/actions.ts (T9)
// GameAction gains { readonly type: 'shop/backpack' }; actions.buyBackpack(): GameAction

// src/io/saveStore.ts (T10)
export const SAVE_KEY: string;
export function saveGame(state: GameState): boolean;
export function loadGame(): GameState | null;
export function clearSave(): void;

// tests/testUtils.ts
export function atShop(state: GameState, shop: ShopId | 'slopShop'): GameState; // T1: stands on the door front facing it, dispatches player/interact
export function v11Save(state: GameState): SaveJson;                            // T7
// createActionRecorder, workbenchTile and arrivalTiles move here with their signatures unchanged (T1).
```

## Plan refinements

- **R1.** `sowableTiles` lives in `src/jobs/checks.ts`, not in `setup.ts` as spec §4.1 says. `setup.ts` already imports `checks.ts`, so the reverse import would make a cycle. `sowField` imports it from `checks.ts`. (Spec §4.1)
- **R2.** `toolboxStale` lives in `blockly/toolbox.ts` beside `toolboxFor`, because the program tab has no view-model file of its own. (Spec §4.4)
- **R3.** All five unused salts (`TownGen`, `Weeds`, `Festival`, `Gift` and `NoticeBoard`) go in Task 1. Nothing reads any of them, so the three v2 ones don't need to wait for save v12. (Spec §2.1, §3.1)
- **R4.** The v12 step's recipe insert runs only when the saved `crafting.known` is already a canonical subset. A list that isn't passes through untouched, so the validator refuses it, as `migrateSave` promises for every unexpected shape. The step names its recipes literally rather than reading `JOBS_TABLE`, so a later change to the table can't change what the migration did. (Spec §2.3)

---

### Task 1: Dead code, test-only exports and comments

(Spec §3, and the salts from §2.1)

**Files:**
- Modify: `src/render/LightingManager.ts` (`lightingPhase`, `LIGHTING_PHASES` and `LightingPhase` out).
- Modify: `src/render/structureGeometry.ts`: `NO_OFFSET` out; `cosmetic` exported beside `CosmeticOffset`.
- Modify: `src/render/townGeometry.ts` and `sceneryGeometry.ts`: import `cosmetic` (and `CosmeticOffset` for the town's `Offset`). `PROP_MAX_HEIGHT` goes from `townGeometry.ts`.
- Modify: `src/state/actions.ts` (`GameActionType`, `shopDoor`, `openSlopShop` and their action types out), `src/items/items.ts` (`ItemKind`), `src/core/hash.ts` (five salts, R3), `src/ui/slots.ts` (its `qualityPrefix` out; it calls `core/text`'s with `stack.quality`).
- Modify: `src/state/reducer.ts`: the `shop/door` and `slop/open` cases go; the intent path stays.
- Modify: `src/state/selectors.ts` (the four selectors), `src/state/intents.ts` (`pickUpTool`), `src/farming/crops.ts` (`getCrop`), `src/world/grid.ts` (`worldToTile`, `chunkWorldRect`) and `src/world/tiles.ts` (`updateTile`).
- Move: `createActionRecorder` from `src/core/store.ts`, `workbenchTile` from `src/robots/workbench.ts` and `arrivalTiles` from `src/world/maps/lookup.ts` to `tests/testUtils.ts`.
- Modify: `src/ui/robotScreen/viewModel.ts` (`LogRow.id` out), and the §3.4 comments in `overnight.ts`, `jobs.ts`, `viewModel.ts`, `workshop.ts` and `config.ts` / `types.ts`. The `setUpShowHim` comment waits for Task 3.
- Modify: `tests/testUtils.ts`: `atShop` (contract).
- Tests: `shopHours`, `slopShop` and `determinism` (`townWeek`) use `atShop`. `store`, `robotDeterminism` and `determinism` import `createActionRecorder` from testUtils. `intents`, `placement`, `growth`, `grid` and `tiles` lose the tests that only covered deleted names. `scenery` compares against `WELL_MAX_HEIGHT`. `slotText` tests the core `qualityPrefix`. `robotScreen` drops its `LogRow.id` pin. `robotBench` and `cast` import the moved helpers. `sections` drops the five salts from its value and count checks.

- [ ] **Step 0:** Before any change, run `npm run build:check` and note the main chunk's gzip size: it's the ceiling for Task 11.
- [ ] **Step 1:** Add `atShop` and the moved helpers to `tests/testUtils.ts`. Switch the tests above to them, and delete the tests of deleted names.
- [ ] **Step 2:** Delete and move the production code, and fix the comments.
- [ ] **Step 3:** Run `grep -rn "shop/door\|slop/open\|lightingPhase\|NO_OFFSET\|PROP_MAX_HEIGHT\|GameActionType\|getCrop\|worldToTile\|chunkWorldRect\|updateTile\|pickUpTool" src`. Expected: no output.
- [ ] **Step 4:** Gate plus `npm run build:check`. The main chunk is smaller than at Step 0.
- [ ] **Step 5:** Commit "Release 1 cleanup: dead code and test-only exports".

---

### Task 2: Jobs 2 and 3 count only the sown tiles

(Spec §4.1)

**Files:**
- Modify: `src/jobs/checks.ts`: `sowableTiles` (R1), plus `cosmoRipeTiles`, `barnabyFieldTiles` and `barnabyBudget` taking the world (contract). Their callers in `checks.ts` (`ripeCropsHarvested`, `showHimDone`, `showHimProgress`, `barnabyCropsHarvested`, `knowTheLimitsDone`, `knowTheLimitsProgress`) pass `state.maps.neighbours`. The progress wording doesn't change; only the count does.
- Modify: `src/jobs/setup.ts`: `sowField` sows exactly `sowableTiles(world, field)`.
- Test: `tests/job2.test.ts`, `tests/job3.test.ts`, `tests/balance.test.ts` (the zero-argument calls get `BASE.maps.neighbours`, or the job state's).

**Interfaces:** Produces the T2 contract.

- [ ] **Step 1: Write the failing tests.**
  - `job2.test.ts`: with a chest on a ripe tile, `cosmoRipeTiles` has 17 tiles and the job passes once Wave harvests those 17. With a chest on an unripe tile, it has 18 (Review Focus 2).
  - `job3.test.ts`: with a chest on a sown tile, `barnabyFieldTiles` has 47, `barnabyBudget` is `JOBS.tokensPerCrop * 47`, and the job passes once 47 are harvested within it. Taking the chest off counts 48 again, and the tile has no crop, so the job doesn't pass that day. With every sown tile under an object, the count is 0 and `knowTheLimitsDone` is false.
  - `sowableTiles` on an empty rect returns every tile, row by row.
- [ ] **Step 2:** Run `npx vitest run tests/job2.test.ts tests/job3.test.ts` and see them fail.
- [ ] **Step 3:** Implement the helper and the call sites.
- [ ] **Step 4:** Run `npx vitest run tests/job2.test.ts tests/job3.test.ts tests/balance.test.ts`, and see them pass, with 18 and 48 on empty fields.
- [ ] **Step 5:** Gate, and commit "Release 1 cleanup: jobs 2 and 3 count only the sown tiles".

---

### Task 3: Wave's set-up and Cosmo's line

(Spec §4.2, §4.3)

**Files:**
- Modify: `src/jobs/setup.ts`: `setUpShowHim` places Wave at `nearestFreeWalkable(fieldState, 'neighbours', JOBS.waveAt, fieldState.robots.nextId)`, where `fieldState` is the state after the generator and field set-up, facing North, and returns `GameState` (an `invariant` on `addRobot`'s error). Its doc comment stops saying it can be refused.
- Modify: `src/people/lines.ts`: `robotSaidToday` counts a `did say` entry today only when `entry.robotId` names a robot in `state.robots.list` with `owner === 'player'`.
- Test: `tests/job2.test.ts`, `tests/lines.test.ts`.

- [ ] **Step 1: Write the failing tests.**
  - With a chest on `JOBS.waveAt`, taking job 2 succeeds, and Wave stands on the nearest free walkable tile, facing North.
  - With the player on `JOBS.waveAt`, taking job 2 succeeds and the state passes `isValidGameState` (Review Focus 4).
  - Wave's `say` today alone gives `reactiveFill(state, 'robotSaidToday') === null`. A player robot's `say` today fills it. A scrapped robot's `say` today doesn't.
- [ ] **Step 2:** Run `npx vitest run tests/job2.test.ts tests/lines.test.ts` and see them fail.
- [ ] **Step 3:** Implement both.
- [ ] **Step 4:** Run the two files again and see them pass.
- [ ] **Step 5:** Gate, and commit "Release 1 cleanup: Wave finds a free tile, and Cosmo hears only your robots".

---

### Task 4: The toolbox follows the robot's parts

(Spec §4.4)

**Files:**
- Modify: `src/ui/robotScreen/blockly/toolbox.ts`: `ToolboxInputs` and `toolboxStale` (contract, R2).
- Modify: `src/ui/robotScreen/tabs/ProgramTab.ts`: it keeps the last `ToolboxInputs` it built from. `sync` rebuilds through `syncUnlocks` (renamed `syncToolbox`) whenever `toolboxStale` says so. The program on the canvas isn't reloaded, and the `dirty` and `saving` paths are untouched.
- Test: `tests/robotScreen.test.ts`.

- [ ] **Step 1: Write the failing tests.** `toolboxStale` is:
  - true for new unlocks;
  - true for `['claw']` → `['claw', 'sensorEye']`, and for the reverse;
  - false for the same unlocks with an equal new parts array.
- [ ] **Step 2:** Run it and see it fail.
- [ ] **Step 3:** Implement it and wire `sync`.
- [ ] **Step 4:** Run the test, then `npm run build:check`, and see both pass.
- [ ] **Step 5:** Gate, and commit "Release 1 cleanup: the toolbox follows the robot's parts".

---

### Task 5: One standby rule

(Spec §6.2)

**Files:**
- Modify: `src/robots/exec.ts`: `idlePower` (contract).
- Modify: `src/robots/create.ts` (`newRobot`: `idlePower('working', exec)`), `src/robots/edits.ts` (`KEPT_POWERS.has(robot.power) ? robot.power : idlePower('working', exec)`) and `src/robots/overnight.ts` (`idlePower(resumed, exec)`).
- Test: `tests/workshop.test.ts` (about line 85: the catalogue preview is on standby), `tests/robotEdits.test.ts` (new robots and `programmedRobot`).

- [ ] **Step 1: Write the failing tests.**
  - A new block robot whose program has no running stack at its start minute is on standby; one with a running stack is working; a script robot is working.
  - `catalogueRobot('mini').power` is `'standby'`.
- [ ] **Step 2:** Run them and see them fail.
- [ ] **Step 3:** Implement `idlePower` and the three call sites.
- [ ] **Step 4:** Run `npm test`. Any other test that pinned `'working'` for a robot with nothing running changes with the rule; name each one in the commit body. Standby robots still wake on triggers; that's the morning reset's behaviour already.
- [ ] **Step 5:** Gate, and commit "Release 1 cleanup: one rule for a robot with nothing to run".

---

### Task 6: One way to teach recipes

(Spec §5.2, canonical order)

**Files:**
- Create: `src/crafting/known.ts`: `knownWith`, `withRecipes` and `unknownRecipes` (contract). `knownWith` is `CRAFTING_RECIPE_IDS.filter((id) => known.includes(id) || recipes.includes(id))`, or `known` itself when nothing is new.
- Modify: `src/jobs/jobs.ts`: the private `withRecipes` goes, and `takeJob` imports the new one.
- Modify: `src/dev/robotDev.ts`: `withBurnerKnown` becomes `withRecipes(state, ['woodBurner'])`.
- Modify: `tests/testUtils.ts`: `withBurnerLearned` calls `withRecipes`.
- Test: `tests/crafting.test.ts`.

**Interfaces:** Produces `knownWith`, `withRecipes`, `unknownRecipes`.

- [ ] **Step 1: Write the failing tests.**
  - `withRecipes` on a farm knowing `['chest', 'woodBurner']` and taught `['qualityFertilizer', 'speedGro']` knows `['chest', 'qualityFertilizer', 'speedGro', 'woodBurner']`, and the result passes `isValidGameState`.
  - Teaching a known recipe returns the same state, by reference.
  - `unknownRecipes` keeps the order it was given and drops known ones.
- [ ] **Step 2:** Run them and see them fail.
- [ ] **Step 3:** Implement, and move the callers.
- [ ] **Step 4:** Run the test plus `tests/job1.test.ts` and `tests/saveV11.test.ts`, and see them pass.
- [ ] **Step 5:** Gate, and commit "Release 1 cleanup: recipes are taught in canonical order, in one place".

---

### Task 7: Save version 12

(Spec §2)

**Files:**
- Modify: `src/core/types.ts`:
  - `SAVE_VERSION = 12`;
  - `DISH_IDS`, `DishId`, `CookingState`, `STORY_QUEST_IDS`, `StoryQuestId`, `BoardRequest`, `QuestState`, `FESTIVAL_IDS`, `FestivalId`, `FestivalState`, `DECORATION_IDS` and `DecorationId` go;
  - `'trophy'` and `'decoration'` leave the object kinds and `PlacedObject`;
  - `NpcTalk` is `{ talks, place }`;
  - `GameState` loses `cooking`, `quests` and `festival`.
- Modify: `src/state/initialState.ts` (`createDefaultSections` and the character default).
- Modify: `src/state/sectionValidation.ts`: the three validators, `MAX_EGG_MASK` and `MAX_FESTIVAL_DISPLAY` go, `NPC_TALK_KEYS` is `['talks', 'place']`, and the file's doc line is updated.
- Modify: `src/state/validation.ts`: the trophy and decoration cases and keys go.
- Modify: `src/state/reducer.ts`: the talk action stops writing `talkedToday`, and the morning reset that clears it goes (about lines 250–259, and the `startNextDay` comment at 285).
- Modify: `src/state/persistence.ts`:
  - `migrateV11toV12` does the spec §2.3 steps 1–4 (R4). Steps 1 and 2 delete the keys and `talkedToday`. Step 3 clears trophy and decoration objects on every saved map's chunks. Step 4 teaches qualityFertilizer and speedGro when `jobs.status.showHim === 'done'`, and qualitySprinkler when `knowTheLimits === 'done'`, through `knownWith`. It's chained after `migrateV10toV11`.
  - The v7 and v8 steps stop touching `quests.board` and `festival.giftTarget`.
- Modify: the renderers:
  - `src/render/objectGeometry.ts`: the trophy, ribbon, lantern and arch geometry and parts go, along with `TROPHY_RIBBONS`, `DECORATION_PARTS`, `lanternWood` and `'glass'` in `ObjectMaterialKind`;
  - `ObjectRenderer.ts`: the glass material wiring and the trophy colour case go;
  - `objectLayout.ts`: the trophy and decoration cases go;
  - `TileHighlighter.ts`: their heights go.
- Modify: `tests/testUtils.ts`:
  - `v11Save` (contract). It puts back `cooking: { known: ['friedMushrooms', 'veggieStew'], kitchenLevel: 0 }`, `quests: { completed: [], board: null }`, the festival defaults from today's `createDefaultSections`, and `talkedToday: false` on each character. It throws when job 2 or job 3 is done but its recipes are missing.
  - `v10Save` starts from it.
  - `withJobsDone` and `withMigratedJobs` teach the done jobs' recipes through `withRecipes`.
  - `livelySections`, `chatsOf` and `v6Save` stop reading the removed fields.
- Create: `tests/saveV12.test.ts`.
- Modify tests:
  - `sections` drops the cooking, quests, festival and `talkedToday` cases, and refuses a v12 character holding `talkedToday`;
  - `talk` drops the morning-reset test, and its talk results lose `talkedToday`;
  - `lines`, `renderMaps`, `tiles`, `objectLayout` and `persistence` (the key list at about line 1088) drop the removed fields;
  - `saveV7`, `saveV8` and `saveV10` drop the board, gift-target and `talkedToday` expectations;
  - `saveV11`'s current-version test moves to `saveV12`.

**Interfaces:** Consumes `knownWith` (T6). Produces `migrateV11toV12` and `v11Save`.

- [ ] **Step 1: Write `tests/saveV12.test.ts`:**
  - `SAVE_VERSION`, `BASE.version` and `migrateSave(v11Save(BASE)).version` are 12;
  - after migration, `cooking`, `quests` and `festival` are gone and no character has `talkedToday`;
  - a v11 save with a trophy on the farm and a decoration in town loads with both tiles' objects cleared;
  - a v11 save with job 2 done learns qualityFertilizer and speedGro, and one with job 3 done learns qualitySprinkler, in canonical order;
  - a save with job 2 active learns nothing, and one already knowing speedGro gets it once;
  - a v11 save whose `known` is out of order, with job 2 done, is refused (Review Focus 1);
  - a v11 round trip of `livelySections()` loads to the same state;
  - a v12 save with `talkedToday` on a character is refused.
- [ ] **Step 2:** Run it and see it fail.
- [ ] **Step 3:** Remove the types, defaults, validation, reducer writes and render code. Write the migration and `v11Save`, and update the listed tests.
- [ ] **Step 4:** Run `npx vitest run tests/saveV12.test.ts tests/saveV11.test.ts tests/saveV10.test.ts tests/saveV8.test.ts tests/saveV7.test.ts tests/sections.test.ts tests/talk.test.ts tests/persistence.test.ts tests/objectLayout.test.ts`, and see them pass.
- [ ] **Step 5:** Run `grep -rn "talkedToday\|DISH_IDS\|QuestState\|FestivalState\|DecorationId\|lanternWood" src`. Expected: only the v7 and v8 migration steps, which still write `talkedToday` for v12 to remove.
- [ ] **Step 6:** Gate, and commit "Release 1 cleanup: save version 12 drops cooking, quests, festivals and decorations".

---

### Task 8: Recipes taught when jobs 2 and 3 are done

(Spec §5.2, rewards and toasts)

**Files:**
- Modify: `src/jobs/jobs.ts`:
  - `JobDef.recipesOnDone`: `[]` for spinningRobot, `['qualityFertilizer', 'speedGro']` for showHim and `['qualitySprinkler']` for knowTheLimits;
  - `finishJob` applies `withRecipes(state, def.recipesOnDone)`;
  - `takeJob`'s and `finishJob`'s doc comments say so.
- Modify: `src/state/reducer.ts`:
  - `takeJobAct` reads `unknownRecipes(state, def.recipesOnTake)` before taking, and toasts only those;
  - `applyJobCheck` reads `unknownRecipes(state, def.recipesOnDone)` before finishing, and toasts each after the done toast and the `doneLines`, as "{giver} taught you the {getItem(recipe).name} recipe.";
  - both doc comments state the one toast rule.
- Test: `tests/job2.test.ts`, `tests/job3.test.ts`, `tests/job1.test.ts`, `tests/jobs.test.ts`.

- [ ] **Step 1: Write the failing tests.**
  - Job 2 passing ends with the toasts "Cosmo taught you the Quality Fertiliser recipe." and then "Cosmo taught you the Speed-Gro recipe.", after the done toast and the `doneLines`, and `crafting.known` is canonical.
  - Job 3 passing ends with "Barnaby taught you the Quality Sprinkler recipe.".
  - A farm already knowing speedGro gets only the Quality Fertiliser toast.
  - Taking job 1 on a farm that already knows the Wood Burner gives no recipe toast.
- [ ] **Step 2:** Run them and see them fail.
- [ ] **Step 3:** Implement it. Check that `getItem` names match the toast text: "Quality Fertiliser", "Speed-Gro" and "Quality Sprinkler".
- [ ] **Step 4:** Run the four files and see them pass.
- [ ] **Step 5:** Gate, and commit "Release 1 cleanup: Cosmo and Barnaby teach their recipes".

---

### Task 9: The backpack upgrade

(Spec §5.1)

**Files:**
- Modify: `src/config.ts`:
  - `INVENTORY.backpackUpgradePrice: 2000`;
  - the `startingUnlockedSlots` comment names the upgrade, as does `Inventory.unlockedSlots` in types.
- Modify: `src/state/actions.ts`: `shop/backpack` and `actions.buyBackpack()`.
- Modify: `src/state/reducer.ts`:
  - `seedShopOpen(state)`: the seed shop panel is open and the game isn't paused, beside `partsShopOpen`;
  - `buySeeds` uses it;
  - `buyBackpack` does nothing unless `seedShopOpen` and `inventory.unlockedSlots === INVENTORY.startingUnlockedSlots`. It refuses "You can't afford that." (warn) when `gold < INVENTORY.backpackUpgradePrice`. Otherwise it takes the price, sets `unlockedSlots` to `INVENTORY.slotCount` and toasts `Your backpack holds ${INVENTORY.slotCount} now.` (success).
- Modify: `src/ui/shops/viewModel.ts`: a `backpackRow(state)` gives `{ price, affordable }`, or null once the slots are unlocked.
- Modify: `src/ui/shops/SeedShopPanel.ts`: the row under the seeds, "Backpack upgrade · 36 slots · 2000g" with a Buy button, disabled when it isn't affordable, like the seed rows. Its text is built from config with `textContent`.
- Test: `tests/backpack.test.ts` (new), `tests/shopStock.test.ts` (`backpackRow`).

- [ ] **Step 1: Write the failing tests.**
  - With the seed panel open and 2000g: gold goes to 0, `unlockedSlots` to 36, and the toast is "Your backpack holds 36 now." (Review Focus 3).
  - With 1999g: refused with "You can't afford that.", and nothing changes.
  - With the panel closed, or the game paused: the same state, by reference.
  - A second buy after the upgrade: the same state.
  - `shop/buy` while paused is ignored too.
  - `backpackRow` is null after the upgrade, and `affordable` follows the gold.
- [ ] **Step 2:** Run them and see them fail.
- [ ] **Step 3:** Implement the action, the reducer, the view model and the row.
- [ ] **Step 4:** Run the tests and `npm run build:check`, and see them pass, with the row in the shops chunk.
- [ ] **Step 5:** Gate, and commit "Release 1 cleanup: Marigold sells the backpack upgrade".

---

### Task 10: Save I/O leaves `src/state`

(Spec §5.3)

**Files:**
- Create: `src/io/saveStore.ts`: `SAVE_KEY`, `storage()`, `saveGame`, `loadGame` and `clearSave`, moved unchanged. It imports `serializeGame` and `deserializeGame` from `persistence.ts`.
- Modify: `src/state/persistence.ts` (they go), `src/main.ts` (the import).
- Test: `tests/persistence.test.ts`'s storage tests (about lines 35–41) import from `src/io/saveStore`.

- [ ] **Step 1:** Move the code and the test imports.
- [ ] **Step 2:** Run `grep -rn "localStorage" src/core src/state src/world src/farming src/time src/robots src/jobs src/people`. Expected: no output.
- [ ] **Step 3:** Run `npx vitest run tests/persistence.test.ts` and `npm run build:check`, and see both pass.
- [ ] **Step 4:** Gate, and commit "Release 1 cleanup: save storage moves to src/io".

---

### Task 11: Specs, docs, playbooks and the browser pass

(Spec §2.5, §6.1, §6.3, §6.4)

**Files:**
- Modify: `docs/superpowers/specs/2026-09-29-farmclaws-design.md` (§5.2, §6, §10, §12, the power states, the bundle budget and the Ranch), and the part 1, 2, 3, 4a, 4b, 4c and 4d specs, each as spec §6.1 and §6.3 list. The 4c spec's refinements are numbered after R26, and the 4d spec gains §12 with R1–R14 from its plan.
- Modify: `docs/superpowers/specs/2026-11-02-release1-cleanup-design.md`: a "Plan refinements" section listing R1–R4 and any refinement made during the build, with its commit.
- Modify: `docs/PHASE0-SPEC.md` and `docs/PLAN-v2.md`: the note at the top (spec §2.5).
- Modify: the playbooks in `.claude/skills/game-driven-qa/scenarios/`:
  - `farmclaws-part4a.md` and `farmclaws-part4b.md`: the shop hours and keepers by timetable, and 4a drops `talkedToday`;
  - `farmclaws-part4c.md`: the recipe toasts after jobs 2 and 3;
  - `farmclaws-part3.md`: no "Programmed Atlas." on an unchanged save.
- Modify: `README.md`, rewritten for players (spec §6.4).
- Modify: `CLAUDE.md`: the purity list gains `src/jobs` and `src/people`.

- [ ] **Step 1:** Sync the specs and the old plans.
- [ ] **Step 2:** Update the playbooks and rewrite the README.
- [ ] **Step 3:** Update `CLAUDE.md`.
- [ ] **Step 4:** Run `npm run typecheck && npm test && npm run build && npm run build:check`. The main chunk is no bigger than Task 1's Step 0 size.
- [ ] **Step 5:** Run the browser pass with the `game-driven-qa` skill:
  - buy the backpack at Marigold's;
  - finish job 2 and see the recipe toasts;
  - with the program tab open and an unsaved edit on the canvas, fit a sensor eye: its blocks appear, and the edit stays (Review Focus 5).
- [ ] **Step 6:** Commit "Release 1 cleanup: specs, playbooks and README in line with the code".
