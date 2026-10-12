# Farmclaws Part 4c: Jobs Implementation Plan

> **For agentic workers:** build task by task, in order. Each task names its files, what changes and why, the signatures later tasks rely on, and the tests that pin the rules. The build writes the code; read the files you touch first and follow the surrounding code. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three jobs in order (Sol's spinning robot, Cosmo's harvest, Barnaby's team) teach the robot game and open the shops. The neighbours' robots live and work on the Neighbours map, zones work on both maps, and each job pays gold and unlocks blocks, cards, tabs or a shop. Saved in save version 9.

**Spec:** `docs/superpowers/specs/2026-10-11-farmclaws-part4c-jobs-design.md`, the binding authority. Player-facing text is copied from it verbatim.

**Architecture:** A robot gains `mapId` and `owner`; every robot rule reads the robot's own map through one helper instead of `state.maps.farm`, so the existing simulation runs on both maps unchanged in behaviour. Zones gain a map the same way. Jobs are a pure table in `src/jobs/` with set-up and check functions; the reducer and the minute loop call them. The job card lives in the chat box (main chunk); the job robot screen mode lives in the robot screen chunk.

## Global constraints

- `CLAUDE.md` rules apply: pure simulation (`src/jobs` joins the pure folders), strict TS, numbers in `src/config.ts` (`JOBS`), `textContent` only, structural sharing, no TODOs, no dev-hook names in production files.
- The gate (`npm run typecheck && npm test && npm run build`) passes after every task; `npm run build:check` after Tasks 1, 2, 4, 5 and 9.
- **Main chunk budget:** raised to the part 2 baseline + 40 KiB in Task 1 (Eli's decision). If `build:check` still fails on it, stop and ask; don't raise it again.
- One commit per task: `Farmclaws part 4c: <summary>`, then why; record any change to a spec rule, number or text as a `Ruling:` line. The coordinator commits and pushes; builders leave work uncommitted with the message in a file.
- Browser checks are Eli's. Task 9 writes a short playbook but doesn't run it.
- **Parts 1–4b behave unchanged** apart from the gates: every existing test keeps passing (with farm robots gaining `mapId: 'farm', owner: 'player'` in fixtures).

## Review focus

1. **One helper for a robot's world.** No robot rule reads `state.maps.farm` directly after Task 2 (grep pins it), and a farm-only save behaves exactly as before. (Task 2)
2. **Bumps, bickers and routing never cross maps.** Two robots at the same (tx, tz) on different maps don't meet. (Task 2)
3. **The 12-robot cap counts only the player's robots and deliveries.** (Tasks 1, 2)
4. **A v8 save** loads with its robots and zones on the farm, `jobs` per spec §4.3, and the v2 fixture migrates to 9. (Task 1)
5. **Job checks are pure and run after robots act each minute**, and rain or the player's own work never completes job 1. (Task 4)
6. **The balance pass** pins each reference solution passing with its margin and the naive approaches failing. (Task 8)

## Facts the tasks need

- **Robots:** `Robot` in `src/core/types.ts`; `findRobot`, `withRobot`, `withFarm`, `robotsOnTile(state, tx, tz)`, `nearestWalkable`, `nearestFreeWalkable` in `src/robots/world.ts`; `runRobotsMinute` / `runRobotsThrough` in `src/robots/run.ts`; `planRobotAction` / `applyRobotPlan` in `src/robots/execute.ts`; routing in `src/robots/route.ts`; sensors in `src/robots/eval.ts`; `interpret.ts`; `.MD` in `src/robots/md.ts`; the night in `src/robots/overnight.ts` (`burnGenerators`, `recharge` with `ROBOTS.chargeRadius`, `ruinSoaked`, `deliverRobots`). Today these read `state.maps.farm` in about 20 places (`grep -rn "maps.farm" src/robots`).
- **Robot creation:** `addRobot(state, spec)` and `newRobot(spec, id, minuteOfDay)` in `src/robots/create.ts`; `freeSpotNear(farm, from, taken)` in `src/robots/workbench.ts`; `ROBOT_CAP_RULE`.
- **Validation:** `isValidRobotsSection(v, maps, player)` in `src/state/robotValidation.ts` checks robots against `maps.farm`, burners only on the farm, one workbench.
- **Zones:** `ZoneRect { x0, z0, w, d }`, `robots.zones`; `zoneOf`, `inZone`, `snakeTiles` in `src/robots/zones.ts`; `isValidZoneRect` in `src/robots/check.ts`; the marker's farm-only rule and `ZONES_FARM_ONLY` in `src/state/intents.ts`; `ZoneRenderer`.
- **Unlocks:** `UNLOCKS.job1` in config; `withUnlocks(state, add)` in `src/robots/unlocks.ts`; `BLOCK_CATEGORY` in `src/robots/blockKinds.ts`.
- **Chat and shops:** `npcActions` (`src/people/cast.ts`), `talkAct` in the reducer, `chatBoxView` (`src/ui/chatBoxView.ts`), `ChatBox`; `LINE_BANKS` / `reactiveFill` in `src/people/lines.ts` (reactive lines in order); `workshop/order`, `parts/buy`, `workshopView`.
- **Robot screen:** `RobotScreenMode`, `visibleTabs`, `hasBenchActions`, `isReadOnly` in `src/ui/robotScreen/viewModel.ts`; tabs get their robot via `context.robot(state)`; `editRobot` and `offBenchRefusal` in the reducer.
- **Render:** `RobotRenderer` draws only on the farm today (`selectActiveMapId(state) !== 'farm'`).
- **Neighbours map:** `src/world/maps/neighbours.ts` (`COSMO_FIELD`, `BARNABY_FIELD`, the lane z 13–15, houses, `isFenceTile`); `planPickUp` refuses fence-ring objects there.
- **Saves:** `migrateV7toV8` last; `v7Save` newest helper.

---

### Task 1: Save version 9 and the budget raise

**Files:** `src/core/types.ts`, `src/config.ts`, `src/state/initialState.ts`, `src/state/persistence.ts`, `src/state/robotValidation.ts`, `src/state/sectionValidation.ts`, `src/robots/create.ts`, `src/robots/check.ts` (zone rect with map), `scripts/bundleRules.mjs`, `scripts/check-bundle.mjs`, `tests/checkBundle.test.ts`, `docs/superpowers/specs/2026-10-03-farmclaws-part3-robot-screen.md` (§10.1's number), `tests/testUtils.ts`, `tests/saveV9.test.ts` (new), and fixtures that build robots or zones.

**Changes:**
- `SAVE_VERSION = 9`. `ROBOT_MAP_IDS = ['farm', 'neighbours'] as const` → `RobotMapId`; `ROBOT_OWNERS = ['player', 'cosmo', 'barnaby'] as const` → `RobotOwner`; `Robot.mapId`, `Robot.owner`; `ZoneRect.mapId: RobotMapId`. `JOB_IDS`, `JobId`, `JobStatus`, `interface JobsState { status; bed: TileCoord | null; rescued: boolean; fieldDay: number }`, `GameSections.jobs` (job 1 offered, the rest locked, `bed: null`, `rescued: false`, `fieldDay: -1`).
- `newRobot` / `addRobot` take the map and owner (the player's robots: `'farm'`, `'player'`).
- `migrateV8toV9`: robots `mapId: 'farm', owner: 'player'`; zones `mapId: 'farm'`; `jobs` per spec §4.3 (any robot or delivery → job 1 done, job 2 offered).
- Validation per spec §7: each robot on a walkable tile of its own map, player robots on the farm and neighbours' robots on the Neighbours map; the cap counts player robots plus deliveries; `jobs` exact keys, every id once, at most one active, the order rule, `bed` null or a 3 × 3 farm block; a zone's rect on its map.
- `v8Save(state)` in `tests/testUtils.ts` (throws on a neighbour's robot, a zone off the farm or a job state a v8 save can't express; strips the new fields); `v7Save` starts from it.
- `MAIN_GROWTH_MAX_GZIP = 40 * KIB`, with its comment, `check-bundle.mjs`'s header, the test, and the part 3 spec's §10.1 number.

**Tests (`tests/saveV9.test.ts`):** current version; round trip; v8 → v9 (robots, zones, `jobs` with and without robots); the v2 fixture to 9; one corrupted field per rule; later version left for the validator. `checkBundle.test.ts` pins 40 KiB.

- [ ] Tests, implement, gate, `build:check`, commit `Farmclaws part 4c: save version 9, robot maps and owners, and a 40 KiB allowance`.

---

### Task 2: Robots on the Neighbours map

**Files:** `src/robots/world.ts`, `src/robots/{execute,eval,interpret,route,md,run,overnight,create}.ts`, `src/state/intents.ts` (pick-up, carry and put-down only for player robots), `src/state/reducer.ts` (`movePlayer` blocking by robots on the active map), `src/render/RobotRenderer.ts`, `tests/neighbourRobots.test.ts` (new), existing robot tests' helpers.

**Changes:**
- `world.ts`: `export function robotWorld(state, robot): WorldState` and `withRobotWorld(state, robot, world)`; `robotsOnTile(state, mapId, tx, tz)` (all callers pass the map; the player's interactions pass `state.player.mapId`). Every `state.maps.farm` in robot code goes through `robotWorld` (grep test: no `maps.farm` left in `src/robots/` except the workbench, deliveries and the farm's generators).
- `run.ts`: robots on both maps act each minute as now; `bumps.ts` and bickers group by map.
- `overnight.ts`: `recharge` gives the player's robots tokens from the pool as now; a neighbour's robot charges to full for free only within `ROBOTS.chargeRadius` of its owner's generator (wood burners on the Neighbours map, found per owner by `JOBS.generators`); a neighbour's bag empties. Ruin and set-down use the robot's map.
- `intents.ts`: picking up, carrying, benching and repairing are for `owner === 'player'` only; a neighbour's robot ahead gives "That's {owner}'s robot." on E outside job mode (Task 5 adds job mode). The cap uses only player robots.
- `RobotRenderer`: draws the active map's robots (it already rebuilds per map visit like the other renderers).

**Tests:** a neighbour's robot moving, routing and harvesting on the Neighbours map; two robots at the same (tx, tz) on different maps don't bump; charging only near the owner's generator; the bag emptied overnight; the refusals; the cap; a farm-only save's robot run byte-identical to before (an existing determinism fixture).

- [ ] Tests, implement, gate, `build:check`, commit `Farmclaws part 4c: robots can live and work on the Neighbours map`.

---

### Task 3: Zones on both maps

**Files:** `src/robots/zones.ts`, `src/robots/interpret.ts`, `src/robots/md.ts`, `src/state/intents.ts` (`planMarker`, `planClearZone`), `src/state/reducer.ts` (`markZone`), `src/render/ZoneRenderer.ts`, `src/ui/zoneChip.ts`, `tests/zonesOnMaps.test.ts` (new), `tests/zoneMarker.test.ts`.

**Changes:**
- `zoneOf(state, id, mapId)` returns the zone only on that map; `For each tile` and the .MD zone cards pass the robot's map.
- The marker works on the farm and the Neighbours map; painting sets `mapId` to the player's map. Elsewhere it's refused with "Zones go on your farm or the neighbours' fields." *(Ruling: replaces "Zones are only on the farm.")*
- `ZoneRenderer` and the zone chip show the active map's zones.

**Tests:** painting on the Neighbours map; a letter moved between maps; a robot's `For each tile` and a `DON'T Leave` card ignoring a zone on the other map; the refusal in town; the overlay per map.

- [ ] Tests, implement, gate, commit `Farmclaws part 4c: zones on the farm and the Neighbours map`.

---

### Task 4: The jobs framework, and job 1

The framework and its first job land together, so the table is never empty or stubbed.

**Files:** `src/jobs/jobs.ts`, `src/jobs/checks.ts`, `src/jobs/setup.ts` (new, pure), `src/config.ts` (`JOBS`: rewards, `bedSearchFrom`), `src/core/types.ts` (`NPC_ACTION_KINDS` gains `'job'`), `src/people/cast.ts`, `src/people/lines.ts` (each giver's hook as their first reactive line while their job is offered), `src/state/actions.ts`, `src/state/reducer.ts`, `src/robots/overnight.ts` (the free pond rescue), `src/ui/chatBoxView.ts`, `src/ui/ChatBox.ts`, `src/ui/hud.css`, `tests/jobs.test.ts`, `tests/job1.test.ts` (new).

**Changes:**
- `jobs.ts`: `export const JOBS_TABLE: Readonly<Record<JobId, JobDef>>`, where `JobDef` has `title`, `giver: NpcId`, `offer`, `goal`, `hook`, `reward`, `unlocksOnTake: Partial<RobotUnlocks>`, `doneLines: readonly string[]`, `setup(state): GameState`, `morning(state): GameState`, `check(state): boolean`, `progress(state): string`. This task fills job 1 (spec §3.1) and gives jobs 2 and 3 their text, giver, reward and unlocks with `setup`, `morning`, `check` and `progress` written in Tasks 5 and 6. Until then jobs 2 and 3 can't be reached: they're only offered once job 1 is done, and the tests that reach them arrive with their tasks. *(If the type checker needs their functions now, write them in this task instead; don't ship a function that does nothing.)*
- Job 1 per spec §3.1: Sprinkle via `addRobot` on the nearest free tile to the workbench; the bed (`findFreeBlock(farm, from, 3, taken)` in `src/robots/workbench.ts`), tilled and sown, `jobs.bed`; Zone A if empty; the check from Sprinkle's log (a `did water` on each bed tile today) and its own `Power down` with tokens > 0; the progress line; the rescue in `ruinSoaked` (job 1 active, Sprinkle, not yet rescued → back by the workbench, working, the toast, `rescued: true`); reward 500g.
- Actions: `{ type: 'job/take'; job: JobId }` → `actions.takeJob(job)` (offered → active, `unlocksOnTake`, `setup`, toast "{title}: job taken."). `talkAct` `'job'` swaps the chat line for the job card (the talk panel gains `card: 'line' | 'job'`).
- After each minute in `tick` (after `runRobotsThrough`) and on `talkTo`, `applyJobCheck(state)` finishes the active job when its `check` passes: status done, next offered, reward, unlocks, toasts (spec §2.1).
- `startNextDay` runs the active job's `morning(state)` once per day (`jobs.fieldDay`).
- `chatBoxView` gains the job card (title, offer, goal, progress, buttons per spec §2.2).

**Tests:** the order; the Job button only while offered or active; the card; taking a job; the hook line; the check after a minute and on talking; reward, unlocks and toasts; the morning hook once per day; job 1's placement, its check passing for the reference program and not for rain, the player's watering or a missing `Power down`; the rescue once.

- [ ] Tests, implement, gate, `build:check`, commit `Farmclaws part 4c: the jobs framework and job 1, Sol's spinning robot`.

---

### Task 5: Job 2, neighbours' generators and job mode

**Files:** `src/jobs/*`, `src/core/types.ts` (robot screen mode `'job'`), `src/state/intents.ts` (E on a job robot: "Work on {name}"), `src/state/reducer.ts` (`editRobot` accepts a neighbour's robot in job mode while its job is active), `src/ui/robotScreen/viewModel.ts` and tabs (job mode: Program and .MD edit; Looks read-only; no bench actions), `tests/job2.test.ts` (new), `tests/neighbourRobots.test.ts`.

**Changes:** spec §3.2 and §5.2: the generators (wood burners at the spec's tiles that never run out, placed on taking a job and kept), Cosmo's field set-up and morning reset, Wave on the lane, the check (ripe-at-morning crops harvested by Wave today; its program has an `If` and a sensor block), progress, reward 1,000g; job mode and the "That's {owner}'s robot." refusals.

**Tests:** the field and its reset; Wave; job mode opening and editing, and refusals outside it; the program rule; the check and progress.

- [ ] Tests, implement, gate, `build:check`, commit `Farmclaws part 4c: job 2, Cosmo's harvest, and editing a neighbour's robot where it stands`.

---

### Task 6: Job 3, Barnaby's team

**Files:** `src/jobs/*`, `src/config.ts` (`JOBS.barnabyRobots`, `JOBS.tokensPerCrop`), `tests/job3.test.ts` (new).

**Changes:** spec §3.3: the field (64 ripe crops, reset each morning), Zone H with its toast, B-1 to B-4 with their programs and .MD, Barnaby's generator; the check before 18:00 (every crop harvested by his robots, tokens spent ≤ 5 × 64, from the robots' `stats.today.tokens`); progress; reward 2,000g.

**Tests:** set-up; the check passes before 18:00 within budget, fails at 18:00 or over budget; progress.

- [ ] Tests, implement, gate, commit `Farmclaws part 4c: job 3, Barnaby's team`.

---

### Task 7: The shop gates

**Files:** `src/people/cast.ts` (`npcActions` reads the gates), `src/state/reducer.ts` (`workshop/order`, `parts/buy` refuse silently behind a gate), `src/ui/shops/viewModel.ts` / `WorkshopPanel.ts` ("After Barnaby's job."), `src/jobs/jobs.ts` (`isGateOpen(state, gate)`), `tests/gates.test.ts` (new), shop tests that assume everything is open (give them job states).

**Changes:** spec §4.2–4.3: Workshop button after job 1; Shop button after job 2; Standard and Big cards after job 3; silent refusals; the unlock lines on finishing a job.

**Tests:** each gate closed and open; buttons; silent refusals; the 4b save rule.

- [ ] Tests, implement, gate, commit `Farmclaws part 4c: the shop gates`.

---

### Task 8: The balance pass

**Files:** `tests/balance.test.ts` (new), `tests/programGen.ts` or a new `tests/jobSolutions.ts` (the reference programs, built with `b`), and `src/config.ts` / `src/jobs/*` only if a number must move.

**Changes:** spec §6's table as tests that run the real simulation (`runRobotsThrough` across a day) from each job's set-up. If a reference solution misses its margin, change the job's numbers (field, ripe pattern, `JOBS.tokensPerCrop`), never robot sizes or prices, with a `Ruling:` line.

**Tests:** each reference solution passes with its margin; each naive approach fails.

- [ ] Tests, implement any number change, gate, commit `Farmclaws part 4c: the balance pass`.

---

### Task 9: Playbook and spec sync

**Files:** `.claude/skills/game-driven-qa/scenarios/farmclaws-part4c.md` (new, short), `.claude/skills/game-driven-qa/SKILL.md`, `docs/superpowers/specs/2026-09-29-farmclaws-design.md` (spec §12's edits), `docs/superpowers/specs/2026-10-11-farmclaws-part4c-jobs-design.md` (a "Plan refinements" section from every `Ruling:` line in the part 4c commit bodies, with the sections they change reworded).

- [ ] Write, gate with `build:check`, commit `Farmclaws part 4c: playbook and spec sync`.
