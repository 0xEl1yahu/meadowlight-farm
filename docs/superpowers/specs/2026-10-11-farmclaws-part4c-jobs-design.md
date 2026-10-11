# Farmclaws part 4c spec: jobs

This is the build spec for part 4c, the last of three parts that together make part 4 of the farmclaws design (`docs/superpowers/specs/2026-09-29-farmclaws-design.md`, sections 2, 8 and 11.2):

| Part | Builds |
| --- | --- |
| 4a People | The cast, talking, the parts exchange building, the Neighbours map (built) |
| 4b Shops and parts | Parts as items, Sol's and Juniper's shops, daily stock, fitting parts (built) |
| **4c Jobs** (this spec) | The jobs framework, jobs 1–3, robots on the Neighbours map, the shop gates, and the balance pass |

With 4c, release 1 is complete: the player gets their first robot from Sol, teaches Cosmo's robot to harvest, and fixes Barnaby's team, and each job opens more of the game.

Every decision here is final for part 4c. If something in the code makes a rule impossible, pick the smallest change that keeps the rule's intent and write it down in the step's commit message.

Global rules (unchanged; see `CLAUDE.md`): the simulation stays pure and deterministic; strict TypeScript with `erasableSyntaxOnly`; no TODOs or stubs; the gate passes after every step and `build:check` at the end; immutable state with structural sharing; numbers from config; player-facing text verbatim from this spec; text through `textContent`.

---

## 1. Scope

**Decided with Eli before this spec:**

| Question | Decision |
| --- | --- |
| Where jobs 2 and 3 happen | On Cosmo's and Barnaby's fields: robots can live and work on the Neighbours map |
| Programming a neighbour's robot | Face it and press E: its robot screen opens where it stands, while its job is active |
| Shop gates | The design's: Juniper's workshop after job 1, Sol's parts shop after job 2, Standard and Big robots after job 3 |
| Rewards | Each job's unlocks, plus gold |
| Main-chunk budget | Raised by 10 KiB, to the part 2 baseline + 40 KiB |

**Part 4c builds:**

- **The jobs framework:** three jobs in a fixed order, each with a giver, a setup, a pure success check, unlocks and a reward.
- **The Job button** in the givers' chats, and the job card in the chat box.
- **Robots on the Neighbours map:** a robot has a map and an owner; the neighbours' robots work their fields.
- **Zones on both maps**, and the zone marker on the Neighbours map.
- **The neighbours' farms:** soil and crops in the fields during a job, and a generator each.
- **The shop gates.**
- **The balance pass:** reference solutions for each job, run in tests.
- Save version 9, with migration and validation.
- A short browser playbook.

**Part 4c does not build:**

| Thing | Where |
| --- | --- |
| Jobs 4–8 | Releases 2 and 4 |
| Messages, the Antenna and `When I receive` | Release 2 |
| Variables and helpers | Release 2 |
| Carrying robots between the farm and the Neighbours map | Not planned |
| Cosmo's chickens | 4d Town life |

---

## 2. Jobs

### 2.1 The framework

- `JOB_IDS = ['spinningRobot', 'showHim', 'knowTheLimits'] as const`, in order.
- Each job is `'locked' | 'offered' | 'active' | 'done'` (`jobs.status` in the save). A new game starts with job 1 offered and the others locked. Finishing a job offers the next.
- One job is active at a time. Taking a job sets it up (section 3); it stays active until it's done. There's no way to give a job up.
- **The check** is a pure function of the state, `jobDone(state, id)`, run after every in-game minute while the job is active (after the robots act) and once more when the player talks to its giver. When it passes:
  - the job becomes `'done'`;
  - its reward is paid and its unlocks added (section 4);
  - the toast: "Job done: {title}. {giver} paid you {reward}g." followed, as its own toast, by each unlock's line (section 4.2).
- `src/jobs/` (new, pure): `jobs.ts` (the table: id, title, giver, offer text, goal text, setup, check, reward, unlocks), `setup.ts`, `checks.ts`.

### 2.2 The Job button and the job card

- Sol, Cosmo and Barnaby's chats gain **Job** (`npcActions`) while their job is offered or active.
- **Job** shows the job card in the chat box, in place of the day's line:
  - the job's title, its offer text and its goal text;
  - offered: **Take the job** and **Not now**;
  - active: the goal, the progress line (section 3) and **Close**.
- **Take the job** sets the job up and closes the chat: "{title}: job taken."
- A giver whose job is offered says, as their reactive line, before everything else: their job's hook (section 3). A giver whose job is done goes back to their usual lines.

---

## 3. The three jobs

### 3.1 Job 1: The spinning robot (Sol)

- **Offer:** "Here's your first robot: a Mini with a watering head. Its program just spins. Rewrite it to water the bed by your workbench, then power down with tokens to spare."
- **Goal:** "Water every tile of the bed, then power down with tokens left."
- **Hook (Sol's reactive line):** "I've got a robot that needs a home. Ask me about the job."
- **Setup:**
  - Sol's Mini **Sprinkle** (Watering head; program `When morning comes → Repeat forever → Turn right`; owner the player) appears on the farm on `freeSpotNear(farm, WORKBENCH.home, taken)`, fully charged. It counts towards the 12 robots.
  - **The bed:** the 3 × 3 block of free grass nearest the workbench (`JOBS.bedSearchFrom`, searched like `freeSpotNear` but for a 3 × 3 block with no object, blocker, crop or reserved tile and no robot) is tilled and sown with parsnip seeds. `jobs.bed` saves its corner.
  - Zone A is set to the bed if it's empty; otherwise the zones stay as they are.
- **Check:** on one day, Sprinkle's log has a `did water` entry on each of the 9 bed tiles, and Sprinkle is powered down by its own `Power down` with tokens above 0. Rain or the player's watering doesn't count.
- **Progress:** "{n} / 9 bed tiles watered today."
- **The pond:** the first time Sprinkle ends a day broken in the water while job 1 is active, Sol fishes it out overnight for free instead of it being ruined. It's back by the workbench in the morning, working, and the toast says "Sol fished Sprinkle out of the pond, free this once. A DON'T card can keep it out: Go into water." `jobs.rescued` makes it once only.
- **Reward:** 500g. **Unlocks:** Juniper's workshop (Minis).

### 3.2 Job 2: Show him what it can do (Cosmo)

- **Offer:** "My robot just says hello to the chickens. Could you teach it to harvest my field? It'll have to look before it picks."
- **Goal:** "Harvest every ripe crop in Cosmo's field, with a program that uses a sensor and an If."
- **Hook (Cosmo):** "My robot could do more, I bet. Want a job?"
- **Setup:**
  - Cosmo's field (spec 4a §5.2: x 4–9, z 6–11) becomes tilled soil with parsnips in a checkerboard: ripe where `(tx + tz)` is even, two days from ripe where it's odd. Every morning while the job is active, the field is set up the same way again.
  - Cosmo's Big **Wave** (Claw, Sensor eye, Basket; program `When morning comes → Repeat forever → Say "hello chickens"`; owner Cosmo) stands on the lane at (8, 13), facing North.
  - Cosmo's generator: a wood burner at (10, 13) that never runs out.
- **Check:** every crop that was ripe at the morning set-up has been harvested by Wave today, and Wave's program has at least one `If` block and at least one sensor block (`BLOCK_CATEGORY` `sensor`).
- **Progress:** "{n} / 18 ripe crops harvested today."
- **Reward:** 1,000g. **Unlocks:** the job 2 blocks and cards stay unlocked (they unlock when the job is taken; section 4.1), and Sol's parts shop.

### 3.3 Job 3: Know the limits (Barnaby)

- **Offer:** "Four robots, one field, zero effort. It just never gets finished. Sort my team out?"
- **Goal:** "Harvest Barnaby's whole field by 6:00 pm in one day, at 5 tokens a crop or less."
- **Hook (Barnaby):** "My team needs a manager. Interested?"
- **Setup:**
  - Barnaby's field (x 21–28, z 17–24) becomes tilled soil with ripe parsnips on all 64 tiles, set up again every morning while the job is active.
  - Zone H becomes Barnaby's field, on the Neighbours map, whatever it was before: "Barnaby marked his field as Zone H."
  - Barnaby's four Minis **B-1**, **B-2**, **B-3** and **B-4** (Claw each; owner Barnaby), scattered on fixed tiles in and around the field (`JOBS.barnabyRobots`), with Barnaby's .MD on each: "DO return to the generator at 6:00 pm". B-1 runs `Every 10 minutes → For each tile in H → Harvest`; B-2 to B-4 have empty programs.
  - Barnaby's generator: a wood burner by his house at (27, 6) that never runs out, far from the field.
- **Check:** before 18:00 on one day, every crop in Barnaby's field has been harvested by Barnaby's robots, and the tokens they spent that day are at most `JOBS.tokensPerCrop` (5) × 64.
- **Progress:** "{n} / 64 crops harvested today · {t} tokens spent."
- **Reward:** 2,000g. **Unlocks:** Standard and Big robots at Juniper's.

---

## 4. Unlocks and gates

### 4.1 Blocks, cards and tabs

New farms start with job 1's set (`UNLOCKS.job1`, unchanged). Taking a job adds its set, because the job needs it:

| Taken | Blocks | Cards | Tabs |
| --- | --- | --- | --- |
| Job 2 | `harvest`, `deposit`, `take`, `if`, `bagFull`, `cropIsReady`, `soilIsDry`, `tileIsTilled`, `cropIs`, `bagIsFull`, `bagHas`, `atEdgeOf`, `tileAheadIs`, `itIsRaining`, `timeIsAfter`, `and`, `or`, `not` | `dontHarvest`, `dontDeposit` | — |
| Job 3 | `forEachTile`, `every`, `startsRaining`, `till`, `plant`, `tokensBelow`, `countInBag`, `arith` | `doReturn`, `doPowerDown` | `stats` |

`set`, `change`, `var`, `helper` and `runHelper` stay locked (release 2). The sets are `UNLOCKS.job2` and `UNLOCKS.job3`, added through the existing `withUnlocks`.

### 4.2 Shop gates

| Gate | Opens with | Before it opens | Unlock line |
| --- | --- | --- | --- |
| Juniper's workshop | Job 1 | Juniper's chat has no Workshop button | "Juniper's workshop is open." |
| Sol's parts shop | Job 2 | Sol's chat has no Shop button | "Sol's parts shop is open." |
| Standard and Big robots | Job 3 | Their workshop cards show "After Barnaby's job." instead of Buy | "Juniper now builds Standard and Big robots." |

`workshop/order` and `parts/buy` refuse silently (no toast) behind a closed gate, so the buttons are the only way in.

### 4.3 Saves from 4b

A migrated save (section 7) keeps every robot, part and delivery it has. If it has any robot or delivery, job 1 counts as done (no reward, no Sprinkle) and job 2 is offered; otherwise job 1 is offered. Jobs 2 and 3 then gate the parts shop and the bigger sizes as for a new game.

---

## 5. Robots on the Neighbours map

### 5.1 Map and owner

- `Robot.mapId: 'farm' | 'neighbours'` and `Robot.owner: 'player' | 'cosmo' | 'barnaby'`.
- The player's robots stay on the farm, as before. The neighbours' robots stay on the Neighbours map. Nothing carries a robot between maps.
- Every robot rule reads the robot's own map where it read the farm: its tile, the tile ahead, routing, harvesting, the log's tiles, the night's ruin and set-down checks. `robotsOnTile(state, mapId, tx, tz)` gains the map.
- The 12-robot cap counts the player's robots (and deliveries) only.
- Robots on both maps act every minute, in id order as now; bumps and bickers only happen between robots on the same map.
- **The token pool** is the player's: it charges the player's robots, as now. The neighbours' robots charge overnight from their owner's generator, for free, but only within `ROBOTS.chargeRadius` of it, the same distance rule as the farm's. Barnaby's team drifting away from his generator is the job's lesson.
- **Deliveries and harvests:** a neighbour's robot that harvests keeps the produce in its bag; its bag empties overnight (the neighbour takes it). It can't deposit into the player's bin or chests, which are on the farm.

### 5.2 Working on a neighbour's robot

- While a neighbour's job is active, facing one of their robots and pressing E shows "Work on {name}" and opens the robot screen in a new mode, `'job'`, where it stands. Shift + E peeks, as for any robot.
- In job mode, the Program and .MD tabs edit as on the bench; Looks shows the parts read-only; there's no On/Off switch, **Lift off**, **Scrap** or **Paint**.
- The edit actions (`robot/program`, `robot/md`) accept a neighbour's robot in job mode, and refuse it otherwise with "That's {owner}'s robot."
- The player can't pick up, carry or bench a neighbour's robot: "That's {owner}'s robot." (`{owner}` is "Cosmo" or "Barnaby").

### 5.3 Zones on both maps

- A zone has a map: `ZoneRect` gains `mapId: 'farm' | 'neighbours'`. The eight letters are shared: Zone A is on one map or the other.
- The zone marker works on the Neighbours map too; painting a letter on one map moves it there.
- A robot's `For each tile in {zone}` and the .MD's zone cards only use a zone on the robot's own map; a zone on the other map counts as empty.
- The zone overlay shows the active map's zones.

### 5.4 The neighbours' farms

- The two generators are wood burner objects on the Neighbours map that never run out (`fuel` stays full; they don't need the player's wood). They can't be picked up (spec 4b's "That belongs to the neighbours." covers them).
- Outside a job, the fields stay bare dirt, as in 4a. A job's set-up turns its field into soil with crops; when the job is done, the field keeps its last state and isn't set up again.
- The neighbours' robots stay after their job is done and keep running whatever program they have.

---

## 6. The balance pass

The design's target is "do it well and it works well". Tests run each job's **reference solution** through the real simulation and pin that it passes with a margin, and that the naive approaches fail:

| Job | Passes | Fails |
| --- | --- | --- |
| 1 | `When morning comes → For each tile in A → Water`, then `Power down`, with A the bed: done on day 1 with at least 40 tokens left | The spinning program; a program without `Power down` |
| 2 | `When morning comes → For each tile in {Cosmo's field} → If crop is ready → Harvest`: done on day 1 | Harvesting every tile without a sensor and `If` (the program rule); the hello-chickens program |
| 3 | Four zones of 4 × 4, one per Mini, each `When morning comes → For each tile in {its zone} → Harvest → Power down`, and the .MD's DO return removed: done by 18:00 at ≤ 5 tokens a crop | B-1's polling program alone; the four Minis on polling programs; one Big robot's program on the whole field (cost) — run as a simulation fixture, though the player can't bring a Big |

If a reference solution doesn't pass with its margin, the numbers that change are the job's (field size, ripe pattern, `JOBS.tokensPerCrop`), never the robot sizes or part prices; the change is recorded as a ruling.

---

## 7. Save version 9

- **`jobs`** (new section): `{ readonly status: Readonly<Record<JobId, JobStatus>>; readonly bed: TileCoord | null; readonly rescued: boolean; readonly fieldDay: number }`, where `fieldDay` is the absolute day the active job's field was last set up (-1 when none).
- **Robots** gain `mapId` and `owner`.
- **Zones** gain `mapId`.
- **`UiPanel`** gains the robot screen's `'job'` mode (no migration; the loader resets panels).
- **Migration (`migrateV8toV9`):** robots get `mapId: 'farm'`, `owner: 'player'`; zones get `mapId: 'farm'`; `jobs` per section 4.3; `SAVE_VERSION = 9`.
- **Validation:** a player robot is on the farm and a neighbour's robot on the Neighbours map, each on a walkable tile of its map; the player's robots plus deliveries are at most 12; `jobs.status` has every id once, with at most one active job and the order rule (a job is only offered, active or done when the one before it is done); `jobs.bed` is null or a 3 × 3 block on the farm; a zone's rect lies on its map.
- `v8Save` in `tests/testUtils.ts` turns a v9 state back into v8 JSON, and `v7Save` starts from it.

---

## 8. Bundle

- `MAIN_GROWTH_MAX_GZIP` rises from 30 KiB to 40 KiB (`scripts/bundleRules.mjs`, its test, and the part 3 spec's §10.1).
- The job card is part of the chat box (main chunk). Job mode is part of the robot screen chunk.

---

## 9. Tests

| File | Covers |
| --- | --- |
| `tests/jobs.test.ts` | The order (offered, active, done, next offered); the Job button and card; taking a job (set-up, toast); the check running after each minute and when talking; reward, unlocks and their toasts. |
| `tests/job1.test.ts` | Sprinkle and the bed's placement; the check (log waters, own Power down, tokens left; rain doesn't count); the progress line; the free pond rescue, once. |
| `tests/job2.test.ts` | Cosmo's field set-up and the morning reset; Wave; the program rule (If and a sensor); the check and progress. |
| `tests/job3.test.ts` | Barnaby's field, team and .MD; the 18:00 and token rules; the progress line. |
| `tests/neighbourRobots.test.ts` | Robots on the Neighbours map: acting, routing and harvesting on their map; bumps only within a map; charging only near their owner's generator; bags emptied overnight; job mode editing and the refusals; the cap counting only the player's robots. |
| `tests/zonesOnMaps.test.ts` | Zones with a map; the marker on the Neighbours map; a zone on the other map counts as empty for a robot and the .MD. |
| `tests/gates.test.ts` | The three gates, their buttons and lines; silent refusals behind a closed gate; a 4b save's job 1 counted as done when it has robots. |
| `tests/balance.test.ts` | Section 6's reference solutions and naive fails. |
| `tests/saveV9.test.ts` | v8 → v9 (and the v2 fixture through every version); a round trip mid-job with neighbours' robots; one corrupted field per rule. |
| `tests/checkBundle.test.ts` (update) | The 40 KiB allowance. |

**Browser playbook** (`scenarios/farmclaws-part4c.md`), short: take job 1 and finish it with the reference program; take job 2 and edit Wave in Cosmo's field; take job 3 and watch Barnaby's team; check the shop gates open.

---

## 10. Implementation steps

1. Save version 9: `jobs`, robots' `mapId` and `owner`, zones' `mapId`; the budget raise.
2. Robots on the Neighbours map: every robot rule on the robot's own map; owners; the cap; charging from owners' generators; rendering on the active map.
3. Zones on both maps, and the marker on the Neighbours map.
4. The jobs framework: the table, statuses, the Job button and card, the check loop, rewards and unlocks.
5. Job 1.
6. Job 2, with the neighbours' generators and job mode editing.
7. Job 3.
8. The shop gates, and the 4b save rule.
9. The balance pass.
10. The playbook and the spec sync.

---

## 11. Done means

- Every test above passes. Typecheck, the full suite, the build and `build:check` are green.
- Eli has played jobs 1–3.
- Parts 1–4b behave unchanged, apart from the gates.

---

## 12. Changes to the farmclaws design

- **§8, job 1:** the bed is the 3 × 3 block of grass nearest the workbench, sown with parsnips; Sol's free pond rescue happens overnight.
- **§8, job 2:** taking the job unlocks its blocks (it needs them); finishing it opens the parts shop and pays 1,000g.
- **§8, job 3:** the three idle Minis have empty programs (messages are release 2); a Big robot can't be brought to Barnaby's field, so "swapping in a Big fails on cost" is pinned by a simulation test, not by play. Finishing it opens Standard and Big robots and pays 2,000g.
- **§8:** jobs pay gold (500 / 1,000 / 2,000g) as well as their unlocks.
- **§3, robots:** robots have a map and an owner; the neighbours' robots work the Neighbours map and charge from their owner's generator.
- **§11.2:** part 4c is built.
