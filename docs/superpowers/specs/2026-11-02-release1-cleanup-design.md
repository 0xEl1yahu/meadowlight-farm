# Release 1 cleanup spec

This spec tidies release 1 before tool upgrades (spec 2) and giant crops and forage (spec 3). It comes from the codebase audit on 2 November 2026, on branch `codebase-audit`, and was checked against the code before it was committed. It builds on parts 1–4d and on commit 7b3544a (taking job 1 teaches the Wood Burner recipe, save v11).

It does five things:

1. Removes the v2 features that release 1 cut: cooking, quests and the notice board, festivals and trophies, and gifts.
2. Deletes dead code and test-only exports.
3. Fixes four bugs the audit found.
4. Wires in two features that were already built but unreachable: the backpack upgrade and the three quality recipes.
5. Brings the design, the part specs, the playbooks and the README back in line with the code.

**One system per rule.** Where this spec touches a rule that the code already has, it reuses that code or extracts one shared helper; it never adds a second copy. Each place this applies says which helper it uses.

Every decision here is final for this build. If something in the code makes a rule impossible, pick the smallest change that keeps the rule's intent and record it as a plan refinement.

Global rules (unchanged; see also `CLAUDE.md`):

- The simulation stays pure and deterministic: no `Math.random`, no clock and no I/O in `src/core`, `src/state`, `src/world`, `src/farming`, `src/time`, `src/robots`, `src/jobs` or `src/people`. Today `src/state/persistence.ts` breaks this with `localStorage`; §5.3 fixes it. `CLAUDE.md`'s list gains `src/jobs` and `src/people`.
- Strict TypeScript with `erasableSyntaxOnly`. State is immutable with structural sharing. Numbers come from config.
- No TODOs, placeholders or stubs.
- `npm run typecheck`, `npm test` and `npm run build` pass after every step, and `npm run build:check` passes at the end.
- Player-facing text is copied verbatim from this spec.
- **Bundle:** the main chunk must not grow, and its allowance (`MAIN_GROWTH_MAX_GZIP`, 53 KiB) stays as it is. The deletions pay for the reducer and job-table additions. The backpack's panel row goes in 4b's lazy shops chunk.
- Commits start with `Release 1 cleanup: `.

---

## 1. Scope

**This spec builds:**

- **Removals in save v12:** the cooking, quests and festival sections, `npcs.*.talkedToday`, their types and ids, the `trophy` and `decoration` object kinds and what only they use, and three hash salts (§2).
- **Dead code:** unused names, duplicate helpers and exports only tests use (§3).
- **Bug fixes:** jobs 2 and 3 when an object sits on a field tile, Wave's set-up, Cosmo's robot line, and the sensor-eye toolbox (§4).
- **The backpack upgrade** at Marigold's general store (§5.1).
- **Recipes taught when jobs 2 and 3 are done,** and recipe lists kept in canonical order (§5.2).
- **Moving the save I/O** out of `src/state` (§5.3).
- **Spec and doc sync,** including Eli's calls on the audit's open questions (§6).

**Not in this spec:**

- **Tool upgrades at Berlioz:** spec 2.
- **Giant crops and forage:** spec 3. The `giantCrop` and `forage` object kinds, their models, the giant-crop invariant and the `GiantCrop` and `Forage` salts all stay.
- **Release 5 sections, kept for part 8:** `profile`, `tools` (levels and upgrade), `buildings`, `nextEntityId` and the animals, and `stats`. The `AnimalProduct` salt stays with them. Design §12 records them (§6.1).

---

## 2. Removals (save v12)

### 2.1 What goes

| Removed | Where it lives now |
| --- | --- |
| `cooking` section (`CookingState`, `known`, `kitchenLevel`) | types, `createInitialState`, section validation |
| `DISH_IDS` and `DishId` | `src/core/types.ts` |
| `quests` section (`QuestState`, `BoardRequest`, its `board`), `STORY_QUEST_IDS` and `StoryQuestId` | types, defaults, section validation |
| `festival` section (`FestivalState`, `giftTarget`, `giftGiven`, `eggsFound`, `display`), `FESTIVAL_IDS` / `FestivalId`, and `MAX_EGG_MASK` and `MAX_FESTIVAL_DISPLAY` | types, defaults, `sectionValidation.ts`, object validation |
| `npcs.*.talkedToday` | `NpcTalk`, `NPC_TALK_KEYS`, the talk action (reducer, about line 588), the morning reset (reducer, about lines 250–259), validation |
| The `trophy` and `decoration` object kinds, `DecorationId` and the decoration id list | `PlacedObject` in types, object validation, `objectLayout.ts`, `objectGeometry.ts` (trophy and ribbon, the paper and stone lanterns, the flower arch), `ObjectRenderer.ts`, `TileHighlighter.ts` (their heights) |
| The `'glass'` object material and the `lanternWood` colour, which only the decorations use | `objectGeometry.ts`, `ObjectRenderer.ts` (its material wiring) |
| Salts `Festival`, `Gift` and `NoticeBoard` | `src/core/hash.ts` |

Talks keep counting through `talks`. The 4a spec said 4c would use `talkedToday`, but nothing ever read it.

The festival bunting in `townGeometry.ts` is release 1's Claw Fair dressing, not v2 festival code, and stays.

### 2.2 Types and defaults

`GameState` loses `cooking`, `quests` and `festival`. `NpcTalk` becomes `{ talks, place }`. `createInitialState` and `createDefaultSections` stop writing them. `SAVE_VERSION` becomes 12.

### 2.3 Migration (`migrateV11toV12`)

It runs after `migrateV10toV11` in `migrateSave`. It:

1. Deletes the `cooking`, `quests` and `festival` keys, whatever they hold.
2. Deletes `talkedToday` from every saved character.
3. Removes every placed object of kind `trophy` or `decoration`, on every map. No game build ever placed one, so this only matters for a hand-edited save: one from version 10 or 11 is cleaned wherever the object stands, one from versions 6 to 9 only when it is on the farm, and any other is refused (R5).
4. Teaches the §5.2 recipes to a save whose job is already done: `qualityFertilizer` and `speedGro` when `jobs.status.showHim` is `'done'`, and `qualitySprinkler` when `jobs.status.knowTheLimits` is `'done'`. It uses the same canonical insert as `withRecipes` (§5.2), so the list stays in `CRAFTING_RECIPE_IDS` order and nothing is added twice.

The v7 and v8 steps stop touching `quests.board` and `festival.giftTarget`, because v12 deletes both. The v7 step still writes the `{ talks, talkedToday }` shape it always did, and v12 then removes `talkedToday`.

### 2.4 Validation

`sectionValidation.ts` stops checking the three sections, and a saved character must have exactly `talks` and `place`. `isValidGameState` doesn't check for extra top-level keys, and this spec doesn't change that: the migration is what removes them. Object validation refuses `trophy` and `decoration`.

### 2.5 Old plans

`docs/PHASE0-SPEC.md` and `docs/PLAN-v2.md` each get a note at the top. Cooking, quests, the notice board, festivals and gifts are cut. The rest is a source for later specs, not a contract: PLAN-v2's tool upgrades feed spec 2, and its giant crops and forage feed spec 3.

---

## 3. Dead code

### 3.1 Deleted outright

- `lightingPhase`, `LIGHTING_PHASES` and `LightingPhase` (`src/render/LightingManager.ts`).
- `NO_OFFSET` (`src/render/structureGeometry.ts`).
- `GameActionType` (`src/state/actions.ts`) and `ItemKind` (`src/items/items.ts`).
- Salts `TownGen` and `Weeds`, which nothing uses.
- `LogRow.id` (`src/ui/robotScreen/viewModel.ts`) and its pin in `robotScreen.test.ts`. LogTab never reads it.

### 3.2 Duplicates collapsed

- **`qualityPrefix`:** keep the copy in `src/core/text.ts`, which takes a `Quality`. `src/ui/slots.ts` calls it with `stack.quality`, and `slotText.test.ts` tests the core copy.
- **`cosmetic()`:** keep the copy in `src/render/structureGeometry.ts` and export it next to `CosmeticOffset`. `townGeometry.ts` and `sceneryGeometry.ts` import it.

### 3.3 Exports that only tests use

| Export | Decision |
| --- | --- |
| Actions `shop/door` / `shopDoor` and `slop/open` / `openSlopShop` | Delete. Tests open shops the way the player does: they stand at the door or booth and interact. `tests/testUtils.ts` gains one helper for this, `atShop(state, shop)`, which `shopHours.test.ts`, `slopShop.test.ts` and `determinism.test.ts` (`townWeek`) use. |
| `createActionRecorder` | Move to `tests/testUtils.ts`. The store's `middleware` option stays, because the determinism and store tests replay through it. |
| `selectTargetTileData`, `selectClockLabel`, `selectDateLabel`, `selectMinutesUntilPassOut` | Delete them and their tests. The HUD already formats these. |
| `pickUpTool` | Delete. It only wraps `PICKUP_TOOL`, which `placement.test.ts` already pins. |
| `getCrop`, `worldToTile`, `chunkWorldRect`, `updateTile` | Delete them and the tests that only cover them. |
| `workbenchTile`, `arrivalTiles` | Move to `tests/testUtils.ts`, where the invariant and map-data tests use them. |
| `PROP_MAX_HEIGHT` | Delete. The scenery test compares against `WELL_MAX_HEIGHT` directly. |
| `SEASONS` | Keep. It is the season list beside `SEASON_NAMES`, not a leftover. |

### 3.4 Comments

- `src/robots/overnight.ts` (about line 282): a robot moves when something now stands on its tile. Drop "weeds or a giant crop grew there"; spec 3 restores the giant-crop case when it adds one.
- `JobDef.hook` (`src/jobs/jobs.ts`): the order is introduction, then the stuck line, then the hook.
- `partsSectionView`: drop the mention of peek mode from its doc comment. Peek never reaches it.
- `switchView` and `screenRobot` (`viewModel.ts`): name job mode, and drop "Hidden in peek mode".
- `src/robots/workshop.ts` (about lines 69–70): "no robot anywhere", which is what the code checks.
- `setUpShowHim`: its doc comment stops saying it can be refused (§4.2).
- `INVENTORY.startingUnlockedSlots` and `Inventory.unlockedSlots`: replace "(later)" with the §5.1 upgrade.

---

## 4. Bug fixes

### 4.1 Jobs 2 and 3 count only the tiles that were sown

The 4c spec already says this: its checks count "every sown crop", and a tile under a placed object keeps its object (R15). The code doesn't match. `sowField` skips a tile holding an object (`setup.ts`, about line 129), but `cosmoRipeTiles` and `barnabyFieldTiles` return the whole rectangle.

**The fix is one helper.** A new `sowableTiles(world, rect)` in `src/jobs/checks.ts` (R1) returns the rectangle's tiles with no placed object.
- `sowField` sows exactly those tiles.
- `cosmoRipeTiles` and `barnabyFieldTiles` take the Neighbours world and return `sowableTiles` of their rectangles.

`placementProblem` stays a separate rule: it decides where the player may put things, not what counts.

**What follows from it:**

- **The goal and progress lines use the filtered count.** "{n} / 48 crops harvested today" becomes "{n} / {sown} crops harvested today", and likewise for job 2. With nothing on the field, sown is 18 for job 2 and 48 for job 3, as now.
- **Job 3's budget shrinks with the field.** `barnabyBudget(world)` is `JOBS.tokensPerCrop × barnabyFieldTiles(world).length`, so it stays at 6 tokens a crop: 288 with nothing on the field.
- **The rule is stateless.** A tile counts while it is free. If the player moves a chest off a field tile during the day, that tile counts but has no crop until the next morning's set-up, so the job can't pass that day. That is the price of moving things on someone else's field mid-job.
- **An empty field can't pass.** When every tile holds an object the count is zero and the check never passes. The job's line doesn't change.

Tests that pin the zero-argument functions and their lengths change with them: `balance.test.ts` (about lines 151 and 179–180) and `job3.test.ts` (about line 218).

### 4.2 Wave's set-up uses R17's fallback

`setUpShowHim` no longer refuses when an object stands on `JOBS.waveAt`. Wave is put down at `nearestFreeWalkable(state, 'neighbours', JOBS.waveAt, …)`, the same call `setUpKnowTheLimits` makes for Barnaby's Minis (R17). It keeps its set-up facing. The 4c spec's rule then holds: job 1's bed is the only set-up that can be refused.

### 4.3 Cosmo's line counts only your robots

The `robotSaidToday` case of `reactiveFill` (`src/people/lines.ts`) counts a logged `say` only from a robot that is in `state.robots` with `owner === 'player'`. Wave's hellos to the chickens no longer count, and neither does a robot that was scrapped. This matches the other reactive cases, which already count only the player's robots.

### 4.4 The toolbox follows the robot's parts

`toolboxFor` already builds the toolbox from the parts. The bug is in `ProgramTab.sync`, which rebuilds only when `state.robots.unlocks` changes (about line 182).

A pure `toolboxStale(prev, next)` in `blockly/toolbox.ts`, beside `toolboxFor` (R2), returns true when either the unlocks or `robot.parts` changed, and `sync` rebuilds when it does. Fitting a sensor eye in the Looks tab turns the sensor-eye blocks on at once, and removing it turns them off. The program on the canvas is not touched.

---

## 5. Features and moves

### 5.1 The backpack upgrade

Marigold's Seed Shop panel (`src/ui/shops/SeedShopPanel.ts`, in the lazy shops chunk) gets one row under the seeds while `inventory.unlockedSlots` is `INVENTORY.startingUnlockedSlots`:

> **Backpack upgrade** · 36 slots · 2000g · **Buy**

- Buy dispatches `shop/backpack`.
- A new `seedShopOpen(state)`, like `partsShopOpen`, is true while the seed shop panel is open and the game runs. Both `shop/buy` and `shop/backpack` use it. This also closes a gap: `buySeeds` doesn't check pause today.
- With less than 2000g it refuses with "You can't afford that.", the seed shop's wording.
- On success it takes 2000g, sets `unlockedSlots` to `INVENTORY.slotCount` and toasts **"Your backpack holds 36 now."** (success).
- After that the row is gone, and a second `shop/backpack` does nothing.
- The Buy button is disabled while you can't afford it, like the seed rows.
- Config: `INVENTORY.backpackUpgradePrice: 2000`.
- No save change: `unlockedSlots` is already saved and already allows 36.
- The inventory's locked-slot tooltip, "Unlocks with the backpack upgrade from the general store", is now true and stays.

### 5.2 Recipes taught when a job is done

**Canonical order first.** Saves list known recipes in `CRAFTING_RECIPE_IDS` order (`isCanonicalSubset`), but `withRecipes` appends new ones at the end. That only works today because `woodBurner` is last in the list. `withRecipes` now inserts in canonical order, the way `withBurnerKnown` in the dev hooks already does. It moves to `src/crafting/` as the one way to teach recipes, and the jobs, the v12 migration and the dev hook (`withBurnerKnown`, which loses its own copy of the rule) all call it.

**The rewards.** `JobDef` gains `recipesOnDone: readonly CraftingRecipeId[]`, beside `recipesOnTake`:

| Job | Giver | `recipesOnDone` |
| --- | --- | --- |
| 1, the spinning robot | Sol | none |
| 2, show him | Cosmo | `qualityFertilizer`, `speedGro` |
| 3, know the limits | Barnaby | `qualitySprinkler` |

`finishJob` applies `withRecipes(state, def.recipesOnDone)`, just as `takeJob` applies `recipesOnTake`. `applyJobCheck` in the reducer only adds the toasts.

**One toast rule for both.** Taking a job and finishing one each toast only the recipes that were newly learned, in table order. `takeJobAct` changes to match. On done, the toasts come after the job-done toast and its `doneLines`:

- "Cosmo taught you the Quality Fertiliser recipe."
- "Cosmo taught you the Speed-Gro recipe."
- "Barnaby taught you the Quality Sprinkler recipe."

The recipe names come from `getItem(recipe).name`, as for the Wood Burner. The Quality Sprinkler needs copper ore, which comes only from broken rocks, so it is slow to make in release 1.

### 5.3 Save I/O leaves `src/state`

`saveGame`, `loadGame`, `clearSave` and `SAVE_KEY` move from `src/state/persistence.ts` to a new `src/io/saveStore.ts`. `persistence.ts` keeps the pure parts: serialising, migrating and validating.
- `main.ts` is the only caller and imports from the new file.
- `persistence.test.ts`'s storage tests (about lines 35–41) import from it too.
- Behaviour does not change.

The HUD (`Hud.ts`) and the music (`audio/music.ts`) keep their own `localStorage` preferences. They are UI and audio, outside the pure folders, and not part of the save.

---

## 6. Spec and doc sync

### 6.1 Eli's calls on the audit

| Question | Call | Where it is recorded |
| --- | --- | --- |
| Save is disabled while the program is unchanged | Keep it | Part 3 spec §4.1 and §15 as a refinement, with Escape on the "Opening…" card beside it. The part 3 playbook stops expecting "Programmed Atlas." on an unchanged save. |
| Robots set down overnight face a fixed way | Keep the fixed facing (`PLAYER.spawnFacing`) | Part 1 spec: set-down is a put-down except that it faces the spawn facing. |
| Juniper's harvester uses `forEachTile` before job 3 unlocks it | Leave it | Part 3 spec and design §5.2: a locked block already in a program keeps working, but can't be added from the toolbox. |
| Cut v2 sections | Removed (§2) | Design §10 and §12 |
| Release 5 sections | Kept for part 8 | Design §12 lists `profile`, `tools`, `buildings`, the animals and `stats`. |

### 6.2 One rule for a robot with nothing to run

Today the code decides "standby when nothing is running" in two places: `programmedRobot` (`edits.ts`, about line 51) and the morning reset (`overnight.ts`, about line 315). `newRobot` doesn't decide it at all and always says `working`.

One helper, `idlePower(power, exec)` in `src/robots/`, now owns the rule, and all three call it. A new block robot with no running stack starts on standby, and since `newRobot` never starts a stack, that is every new block robot (R6).

This includes `catalogueRobot`, Juniper's preview robot, so the preview shows standby. `workshop.test.ts` (about line 85) changes to match.

### 6.3 Spec matched to the code

- **The DON'T deposit card** starts on `CROP_IDS[0]`. The part 3 spec's "the first … item" becomes "the first crop".
- **The design:**
  - The main-bundle budget is 53 KiB.
  - §5.2's unlock column follows config and the 4c spec: `bagFull` at job 2; `forEachTile`, `till` and `plant` at job 3; `Set` and `Change` in release 2.
  - Part 2 §17's changes are applied.
  - Power states follow `ROBOT_POWERS`, with no `off`. A robot goes flat when it can't pay for its next action.
  - §6 names job mode as the exception to "only the workbench edits a robot".
  - The Ranch has no menu in release 1.
- **Part 1 spec:**
  - `ruined` is in the power list.
  - `Robot.stats` replaces `tokensToday`.
  - The planner reads the robot's own map.
  - Add the v3→v4 note.
  - Add the §6.2 standby rule.
- **Part 2 spec:**
  - Zones carry `mapId`.
  - The `triggerText` wording and the `doReturn` reasons are copied from its plan.
  - The blocked/water rule matches `eval.ts`.
- **Part 3 spec:** the main-bundle budget is 53 KiB.
- **4a spec:**
  - The cast keeps timetables (from 4d), not fixed spots.
  - The line order is introduction, stuck line, then hook.
  - The reactive lines count only your robots, including `robotSaidToday` (§4.3).
  - The current cast ids replace `bram` and `tess`.
  - The fence protection covers the chicken run.
  - `talkedToday` is removed.
  - Its v7 migration text no longer touches the board or the gift target (§2.3).
- **4b spec:**
  - Peek mode shows Stats and Log only.
  - Its v8 migration text no longer touches the board or the gift target.
- **4c spec:**
  - §3.1 already covers job 1's recipe (R26).
  - §3.2 and §3.3: the free-tile count, the "{n} / {sown}" progress line and the budget as 6 tokens a sown crop (§4.1).
  - §3.2: Wave's R17 fallback (§4.2).
  - Add `recipesOnDone` and the one toast rule (§5.2).
  - §2.1's hook priority follows 4d.
  - The sensor category is `'sensors'`.
  - "That belongs to the neighbours." is 4a's rule R9.
  - Add refinements for each change, numbered after R26.
- **4d spec:**
  - Add §12, Plan refinements, listing R1–R14 from its plan.
  - R1's `findPath` signature becomes `findPath(grid, from, to, canStep)`.
  - The stop check is in `assertTimetables`.

### 6.4 Playbooks and the README

- **The 4a and 4b playbooks** set the clock to the shop's open hours and find the keeper by timetable, in place of the fixed 6:00 am tiles. The 4a playbook also drops its `talkedToday` checks.
- **The 4c playbook** expects the recipe toasts after the job-done toasts for jobs 2 and 3.
- **The part 3 playbook:** see §6.1.
- **The README is rewritten for players:**
  - What Meadowlight Farm is.
  - How to play: the farm, the town and its hours, the people, the jobs, and robots and their programs.
  - The controls, how to run it, and a short project map that includes `src/robots`, `src/jobs`, `src/people` and `src/io`.
  - No test count.

---

## 7. Build order

1. **Dead code and comments (§3).** No behaviour change, and the main chunk shrinks.
2. **Bug fixes (§4) and the standby rule (§6.2),** each with its test.
3. **Canonical `withRecipes` (§5.2),** then save v12 (§2) with its migration step.
4. **Features and moves (§5).**
5. **Spec and doc sync (§6).**

---

## 8. Tests

**New tests:**

- **`tests/saveV12.test.ts`:**
  - The current version.
  - Each removed key is gone after migration.
  - `talkedToday` is stripped.
  - Trophy and decoration objects are cleared.
  - The job 2 and job 3 recipes are taught only when the job is done, in canonical order, and never twice.
  - A v11 round trip.
  - A v12 character with `talkedToday` is refused.
- **§4.1:** with a chest on a field tile:
  - Job 2 and job 3 each pass once every sown tile is done.
  - Job 3's budget is 6 tokens per sown tile.
  - Moving the chest off counts that tile again.
- **§4.2:** with a chest on Wave's tile, job 2's set-up succeeds and Wave stands on the nearest free tile.
- **§4.3:** Wave's hellos alone don't trigger Cosmo's line; a player robot's `say` does.
- **§4.4:** `toolboxStale` is true when the parts change and when the unlocks change, and false otherwise.
- **§5.1:** buying works and toasts. It is refused with too little gold, ignored with the panel closed or the game paused, and does nothing once you have 36 slots.
- **§5.2:**
  - Finishing jobs 2 and 3 teaches their recipes in order, after the done toasts.
  - A recipe already known isn't toasted again, on take or on done.
  - `withRecipes` keeps `crafting.known` canonical when it teaches a recipe that comes before one already known, and the result passes save validation.
- **§6.2:** a new robot with nothing running is on standby, and so is the catalogue preview.

**Test helpers (`tests/testUtils.ts`):**

- **`v11Save`** puts back the three sections and `talkedToday`. Like `v10Save`, it throws for a finished job 2 or 3 whose recipes are missing. `v10Save` and the older helpers chain through it.
- **`withJobsDone` and `withMigratedJobs`** teach the job 2 and job 3 recipes.
- **`livelySections`, `chatsOf` and `v6Save`** stop reading the removed fields.
- **New:** `atShop`, `createActionRecorder`, `workbenchTile` and `arrivalTiles` (§3.3).

**Existing tests that pin removed or changed behaviour, and change with it:**

- `sections.test.ts`: the salt values and count, and the cooking, quests, festival and `talkedToday` rejections.
- `talk.test.ts`: the morning-reset test.
- `lines.test.ts`, `renderMaps.test.ts`, `tiles.test.ts`, `objectLayout.test.ts` and `persistence.test.ts`.
- `saveV7`, `saveV8` and `saveV10`.
- `balance.test.ts`, `job3.test.ts`, `workshop.test.ts`, `robotScreen.test.ts` and `slotText.test.ts`.
- `shopHours.test.ts`, `slopShop.test.ts` and `determinism.test.ts`.

**A short browser pass:**

- Buy the backpack at Marigold's.
- Finish job 2 and see the recipe toasts.
- Fit a sensor eye with the program tab open.

---

## 9. Plan refinements

Decided by the release 1 cleanup plan (`docs/superpowers/plans/2026-11-02-release1-cleanup.md`) and its execution, each with the commit that made it. Each one keeps the intent of the rule it refines, and the sections above already say what it decided.

- **R1** (`eb1e5fc`). `sowableTiles` lives in `src/jobs/checks.ts`, not in `setup.ts` as §4.1 says. `setup.ts` already imports `checks.ts`, so the reverse import would make a cycle. `sowField` imports it from `checks.ts`. (§4.1)
- **R2** (`4de7c96`). `toolboxStale` lives in `blockly/toolbox.ts` beside `toolboxFor`, because the program tab has no view-model file of its own. (§4.4)
- **R3** (`aee06d4`). All five unused salts (`TownGen`, `Weeds`, `Festival`, `Gift` and `NoticeBoard`) go in Task 1. Nothing reads any of them, so the three v2 ones don't need to wait for save v12. (§2.1, §3.1)
- **R4** (`a768662`). The v12 step's recipe insert runs only when the saved `crafting.known` is already a canonical subset. A list that isn't passes through untouched, so the validator refuses it, as `migrateSave` promises for every unexpected shape. The step names its recipes literally rather than reading `JOBS_TABLE`, so a later change to the table can't change what the migration did. (§2.3)
- **R5** (`a768662`). A trophy or decoration on the farm of a hand-edited v6–v10 save is cleaned by the v12 step and the save loads. One on another map of a pre-v10 save is refused: the v9 → v10 step reshapes the town and the Neighbours only when `isValidWorld` accepts them, which it no longer does with those kinds, and when either can't be reshaped the step leaves the save at version 9, so it fails validation at every hour rather than loading half-migrated. One on the farm of a v5 or older save is refused too, because the v6 step's workbench placement makes the same check and the save ends up with no workbench. No game build ever placed one (§2.3). (§2.3, §2.4)
- **R6** (`8a71a3b`). Every new block robot starts on standby, because `newRobot` builds its exec with `execAt`, which never starts a stack. That covers bought robots, Sprinkle, Wave and Barnaby's Minis. They show dim eyes until their first trigger or the next morning, and behave as before. (§6.2)
- **R7** (`3fd9605`). `idlePower` also owns standby after a new .MD and a put-down, and a robot with a DO return under way (a frame but no running stack) stays working, so `withMd` and the put-down call it rather than deciding standby themselves. (§6.2)
