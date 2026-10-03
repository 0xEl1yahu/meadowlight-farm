# Farmclaws part 3 spec: the robot screen

This is the build spec for part 3 of the farmclaws design (`docs/superpowers/specs/2026-09-29-farmclaws-design.md`, sections 5, 6 and 11). Part 1 gave robots a body; part 2 (`docs/superpowers/specs/2026-10-02-farmclaws-part2-language.md`) gave them a language. Part 3 gives the **player** a way to use that language in the game: a **workbench** where robots are modded, a **robot screen** with a Blockly block editor, the .MD card editor, Stats and Log, a read-only **peek** in the field, and the **zone marker** that paints zones A–H.

Robots still reach normal play only in part 4, so part 3 is exercised through the part 1–2 dev hooks plus the new in-game screens.

Every decision here is final for part 3. Implementation agents follow it and don't redesign it. If something in the code makes a rule impossible, pick the smallest change that keeps the rule's intent and write it down in the step's commit message.

Global rules (unchanged from parts 1–2):

- The simulation stays pure and deterministic: no `Math.random`, no clock and no I/O in `src/core`, `src/state`, `src/world`, `src/farming`, `src/time` or `src/robots`. The editor and screens live in `src/ui`; Blockly is imported only there.
- Strict TypeScript with `erasableSyntaxOnly`: no enums, no namespaces, no parameter properties, `as const` objects plus union types, `import type` for types.
- No TODOs, placeholders or stubs.
- `npm run typecheck`, `npm test` and `npm run build` pass after every step.
- State is immutable with structural sharing.
- `isProgramShape` → `checkProgram` and `isMdShape` → `checkMd` are the only gate for programs and .MDs, from the screen exactly as from the dev hooks.
- Numbers come from config, never inline.

---

## 1. Scope

**Part 3 builds:**

- The **workbench**: a built-in placed object beside the farmhouse; putting a robot on it, the `onBench` robot state, lifting it off.
- The **robot screen**: a full-screen panel with the Program, .MD, Stats and Log tabs, in `bench` mode (editable) or `peek` mode (read-only, Stats and Log).
- The **Program tab**: a lazily loaded Blockly editor with one block per language block, typed sockets, an unlock-filtered toolbox, the block counter, Save and Revert.
- The **translation** between Blockly's workspace JSON and `BlockProgram`, pure and exact in both directions.
- The **.MD tab**: a card editor for the unlocked cards.
- **Robot stats** (today and this week) and the **Stats tab**.
- The **Log tab**, after a log fix: repeated events merge only within the same day.
- **Unlocks**: a saved set of unlocked blocks, cards and tabs, starting at job 1's set.
- The **zone marker** tool: painting, cycling and clearing zones A–H, and a zone overlay renderer.
- Save version 6 with migration and validation.
- A bundle-size budget enforced by a script, and a browser playbook.

**Part 3 does not build:**

| Thing | Part (release) |
| --- | --- |
| Jobs, Sol and the other NPCs, shops, getting a robot in normal play, flipping unlocks per job | 4 (release 1) |
| Test run, messages, `Claim`, the Antenna | 5 (release 2) |
| The Looks tab (paint, voice, personality, quirk) and speech bubbles | 6 (release 3) |
| The full .MD card set | 7 (release 4) |
| Crafting extra workbenches; touch alternatives to Shift + E / Shift + Space | 8 (release 5) |

---

## 2. The workbench

### 2.1 Object

- `PLACED_OBJECT_KINDS` gains `'workbench'`, with the shape `{ kind: 'workbench' }`.
- It **blocks movement**.
- It **can't be picked up**: the pickaxe refuses with "It's part of the farm.". It can't be placed from the inventory either; there is no workbench item in part 3.
- **Farm-only**: save validation rejects a workbench on another map.
- `WORKBENCH.home` in config is `{ tx: 6, tz: 4 }`, in the farmhouse yard. The tile is clear on every generated farm (inside `LAYOUT.clearZones[0]`, off the door, the bin and the spawn).
- **Placement:**
  - `createInitialState` puts the workbench at `WORKBENCH.home`.
  - Migration puts it there too, or on the nearest free farm tile (breadth-first in `DIRECTIONS` order) when the player has built something at home.
  - A free tile is walkable, has no object, crop or robot, isn't reserved, and isn't the player's tile.
- **Rendering:** a low-poly bench (top, four legs, a vice, a pegboard of three tiny tools) in `objectGeometry`. A robot on it is drawn by `RobotRenderer` standing on the bench top (section 2.2).

### 2.2 Robots on the bench

`Robot` gains `readonly onBench: boolean`.

- **Rules for a robot on the bench:**
  - Its `tx`/`tz` are the workbench tile.
  - It's never carried and never due: `runRobotsMinute` skips it as it skips carried robots.
  - It recharges overnight like any robot standing on that tile (part 1 §5.7.4; the bench is within range of a burner placed beside it).
  - The morning reset leaves it on the bench; nothing moves it.
  - At most one robot is on a given bench.
- **Put on the bench:** carrying a robot, facing the workbench, with no robot on it, E is the intent `benchRobot`.
  - Hint: "Put {name} on the bench".
  - Effects: `carried: false`, `onBench: true`, tile = the bench tile, `facing` = the player's, `teleportSeq + 1`, `player.carrying: null`. The panel opens in `bench` mode.
  - Power and `off` are unchanged. No energy cost.
- **Bench occupied while carrying:** "There's already a robot on the bench." (refused).
- **E on the workbench, not carrying:**
  - With a robot on it: the intent `openBench`, hint "Work on {name}", which reopens its screen.
  - Without one: the hint "Bring a robot here to work on it" and a no-op toast saying the same.
- **Lift off the bench:** the screen's **Lift off** button dispatches `liftOffBench`.
  - It costs `carryEnergyFor(robot)` like a pick-up, and refuses with part 1's too-tired text when energy is short.
  - Effects: `onBench: false`, `carried: true`, `player.carrying: id`. The panel closes.
  - Putting the robot down afterwards is part 1's put-down, with part 2's off-robot power rule.
- **Bench while the player must drop a carried robot:** part 1 §5.7.2 (set down at spawn when the day ends) applies only to carried robots; a robot on the bench is not carried.

### 2.3 Peek

- **Shift + E** on a robot in the field (standing, not carried, not on the bench, on the tile ahead) is the intent `peekRobot`. Hint: "Look at {name}" when Shift is held.
- It opens the screen in `peek` mode: only the Stats and Log tabs, with no Save, no Lift off, and no editing affordances.
- It costs nothing and doesn't stop the robot.
- `InputController` sends `peek` when E is pressed with Shift; `panelKeyCommand` routes it like interact.

---

## 3. The robot screen (`src/ui/robotScreen/`)

### 3.1 Panel and layout

- **Panel:** `UiPanel` gains `{ kind: 'robot'; robotId: number; mode: 'bench' | 'peek' }`. While it's open the game is frozen (`selectIsFrozen`), as with the inventory. Escape closes it; closing with unsaved Program or .MD edits asks "Discard your changes to {name}'s program?" (Discard / Keep editing).
- **Header:** the robot's name, its size and parts (part icons), tokens / battery, its power (and "off until morning" when `off` is set), and in bench mode the **Lift off** button.
- **Tabs:** Program, .MD, Stats and Log, in that order. A tab whose unlock (section 6) is missing is hidden. Peek shows only Stats and Log.
- **Phone width (< 700 px):** the tabs become a strip under the header, and the active tab fills the rest of the screen. The Blockly toolbox becomes a flyout opened from a button.

### 3.2 Program tab

- **Loading:** Blockly (`blockly/core` + English messages) is imported with a dynamic `import()` the first time a Program tab opens. While it loads, the tab shows "Opening the editor…". A load failure shows "The editor couldn't load. Close and try again." and leaves the robot untouched.
- **Blocks:** one Blockly block type per language block (section 4). Labels are sentence case, as in design §5.2.
- **Colours by category:** Triggers gold, Control orange, Actions green, Sensors teal, Values purple. Socket check types are `Number`, `Text`, `YesNo`, `Item` and `Tile` (statement connections untyped).
- **Theme:** a Blockly theme from the HUD palette (cream workspace, rounded Geras renderer, the game's font). No grid lines. Trash can and zoom controls are on.
- **Toolbox:** five categories (Triggers, Control, Actions, Sensors, Values). It shows only blocks in `unlocks.blocks`, and sizes with no sensor eye see sensor-eye sensors disabled with the tooltip "Needs a sensor eye".
- **Variables:** a "Make a variable" button asks for a name and a type (Number, Text, Yes/No, Item, Tile) and adds a `VarDecl` with that type's default initial (0, "", No, parsnip, the robot's tile). The initial is editable on the variable's row in the Values category.
- **Helpers:** "Define helper [name]" and "Run helper [name]" blocks.
- **Counter:** "{used} / {limit} blocks" from `blockCount(workspaceProgram)` and `ROBOTS.sizes[size].blocks`. It turns red over the limit, and so does a "{n} / {limit} variables" line.
- **Save:**
  - Translate the workspace (section 4).
  - A block left loose (not in a trigger stack or helper) is an error: "Every block must be inside a When … stack or a helper." The block is highlighted.
  - Then `isProgramShape` and `checkProgram`. The checker's sentence is shown under the toolbar and nothing is saved. Loose blocks and blocks named by a translation error are highlighted; checker problems are shown as text only.
  - On success, dispatch `programRobot { robotId, program }`. The reducer runs the same checks again and rebuilds the exec with part 2's rule (`execAt`, and a `morning` stack only before the first act). Toast "Programmed {name}.".
- **Revert:** reload the saved program into the workspace.
- **Scripts:** a robot still running a part 1 script opens with an empty workspace and the note "{name} runs a fixed script. Saving here replaces it with a block program."

### 3.3 .MD tab

- **Look:** the design's markdown card, "# {NAME}.MD", then "## DO" and "## DON'T", each card one line with dropdown fields (zones, crops, items, tiles by coordinates, times in 10-minute steps from 6:00 am to 1:50 am).
- **Editing:**
  - **Add a card** lists the unlocked card kinds. Cards can be removed and reordered.
  - A counter shows "{n} / {limit} cards".
  - **Save** runs `isMdShape` and `checkMd`, then dispatches `setRobotMd { robotId, md }`. The reducer runs the same checks, clears `exec.doneCards` and stops a DO return under way, as part 2's `withMd` does.
- **Scripts:** a script robot shows ".MD cards only apply to block programs." and no editor.

### 3.4 Stats tab

Two columns, **Today** and **This week**:
- tokens used
- actions taken
- crops handled (harvested plus planted)
- tokens per crop, shown as "—" when no crops were handled

### 3.5 Log tab

- **Columns:** "Robot says" beside "What happened" (part 2's `robotSays` and `whatHappened`), newest first, today and yesterday, with "×{count}" on merged entries. Each row starts with its time (e.g. "9:40 am").
- **Empty:** "Nothing yet today."

---

## 4. Translation (`src/ui/robotScreen/translate.ts`, pure)

```ts
export function programToWorkspace(program: BlockProgram): BlocklyWorkspaceJson;
export function workspaceToProgram(json: BlocklyWorkspaceJson): { readonly program: BlockProgram; readonly loose: readonly string[] } | { readonly error: string };
```

- **Format:** `BlocklyWorkspaceJson` is Blockly's `serialization.workspaces.save` shape (`blocks.blocks[]`, `variables[]`), declared locally as a type. The module never imports Blockly.
- **Blocks:**
  - Every `Statement`, `Expr`, `Trigger`, `ActionBlock`, `HelperDef` and `VarDecl` has exactly one block type, named `fc_<kind>` (e.g. `fc_repeatTimes`, `fc_cropIsReady`).
  - Fields carry literals and dropdown values. Value inputs carry expressions. Statement inputs carry bodies, chained by `next`.
  - Literal expressions in a socket are their own small blocks (`fc_num`, `fc_text`, `fc_yes`, `fc_item`, `fc_tile`) so the player can type into them.
  - Top-level blocks are trigger stacks and helper definitions, laid out in program order 40 px apart.
- **Round trip:** `workspaceToProgram(programToWorkspace(p))` deep-equals `p` for every program the checker accepts.
- **Invalid workspace JSON:** `workspaceToProgram` never throws. Unknown block types or missing required inputs return `{ error }` naming the block. An empty socket is the error "Fill every empty slot.".
- `loose` returns the ids of top-level blocks that are neither a trigger stack nor a helper.

---

## 5. Stats and the log fix

### 5.1 Robot stats

`Robot` gains:

```ts
readonly stats: {
  readonly today: RobotStatCounts;
  readonly week: RobotStatCounts;
};
interface RobotStatCounts { readonly tokens: number; readonly actions: number; readonly crops: number }
```

- **Updated when actions apply** (`applyRobotPlan`, `applyBickerPlan`):
  - `tokens` grows by what the action cost.
  - `actions` grows by 1 for every resolved action, including blocked and bickered ones.
  - `crops` grows by 1 for a successful `harvest` or `plant`.
- **Skips and waking:** skips cost nothing and add nothing. A wake adds its cost to `tokens` but not to `actions`.
- **Rollover:** the morning reset zeroes `today`. It also zeroes `week` when the new day starts a week (`dayOfSeason` is 1, 8, 15 or 22).

### 5.2 Log merge within a day

`logRobotEvent` merges into the robot's most recent entry only when the event is equal **and** the entry's `day` is today. Part 1's spec §5.6 and part 2's `whatHappened` text are unchanged. Spec sync: part 1 §5.6 says so.

---

## 6. Unlocks

```ts
export interface RobotUnlocks {
  readonly blocks: readonly BlockKind[];     // canonical BLOCK_KINDS order
  readonly cards: readonly MdCard['kind'][]; // canonical MD_CARD_KINDS order
  readonly tabs: readonly ('program' | 'md' | 'stats' | 'log')[];
}
```

- `RobotsState` gains `unlocks`. `BLOCK_KINDS` lists every `fc_` block kind (statements, expressions and triggers, by their language `kind`).
- **Job 1's set** (`UNLOCKS.job1` in config) is the starting set for new farms and migrated saves:
  - **Blocks:** `morning`, `atTime`, `repeatTimes`, `repeatUntil`, `repeatForever`, `move`, `turn`, `goTo`, `water`, `refill`, `powerDown`, `wait`, `say`, plus the literals and `myTile`/`tileAhead`.
  - **Cards:** `dontLeave`, `dontGoIntoWater`.
  - **Tabs:** `program`, `md`, `log`.
- **Locked kinds:**
  - The screen hides locked blocks and cards.
  - A saved program or .MD using a locked kind is still valid. Unlocks gate the editor, not the simulation, so part 4's preloaded job programs can use anything.
  - A locked block already in a loaded program shows normally and can be kept or deleted, but not added again.
- **Dev hook:** `__meadowlight.unlockAll()` sets every block, card and tab. Part 4's jobs add to the set through a pure `withUnlocks(state, partial)`.

---

## 7. The zone marker

- **Tool:** `TOOL_TYPES` gains `'zoneMarker'`, with the name "Zone Marker" and the description "Paints zones A to H for your robots. Space marks corners, Shift + Space picks the zone.". It isn't upgradable and costs no energy. New farms and migrated saves get one in the first free inventory slot. When the backpack is full, `robots.pendingMarker` is set instead, and the first morning with a free slot adds the marker and shows the toast "Your zone marker is in your backpack.".
- **State:** `ui.zoneDraft: null | { zone: ZoneId; corner: TileCoord | null }`, which is presentation state, not saved. The current zone letter is `ui.zoneLetter: ZoneId`, defaulting to A.
- **Painting:** with the marker selected, Space on a farm tile:
  - **First press:** the corner is set (a draft).
  - **Second press:** the rectangle from the corner to this tile becomes `ui.zoneLetter`'s zone through `withZone`. The toast reads "Zone A · 3×3.". The draft clears.
  - **Off the farm:** another map is refused with "Zones are only on the farm.".
- **Keys:** Shift + Space cycles the letter A → H → A. Shift + E clears the current letter's zone, with the toast "Cleared Zone A.". Escape drops a draft.
- **HUD:** a chip above the hotbar while the marker is selected, e.g. "Zone A · 3×3" or "Zone A · not set", plus "corner set" during a draft.
- **Rendering (`src/render/ZoneRenderer.ts`):**
  - **When it draws:** while the marker is selected, or a robot screen is open.
  - **Each set zone:** a tinted ground outline in its colour (A–H from a fixed 8-colour palette) and its letter at the north-west corner.
  - **The draft:** previewed from the corner to the highlighted tile.
  - **Instanced, with no per-frame allocation.**

---

## 8. Save version 6

### 8.1 Migration (`migrateV5toV6`)

- **Robots:** every robot gains `onBench: false` and zeroed `stats`.
- **Robots section:** gains `unlocks: UNLOCKS.job1` and `pendingMarker: false`.
- **Farm:** gets the workbench (section 2.1 placement).
- **Player:** gets the zone marker (section 7).
- **Version:** `SAVE_VERSION = 6`.

### 8.2 Validation

- **The workbench:** exactly one on the farm, none elsewhere.
- **Robots on the bench:** an `onBench` robot sits on the workbench tile, isn't carried, and is the only `onBench` robot. No robot stands on the workbench tile unless it's `onBench`.
- **Stats:** non-negative integers.
- **Unlocks:** canonical, known kinds.
- **The zone marker:** at most one in the inventory and chests together. `pendingMarker` is true only when there's none.

Any state the game can produce must load; a corrupted field is rejected.

---

## 9. Bundle budget (`scripts/check-bundle.mjs`)

Run after `npm run build`; part of `npm run build:check`.

- **The editor chunk** (the lazy chunk containing Blockly) must be ≤ **250 KB gzipped**.
- **The main entry chunk** must be ≤ the part 2 baseline + **10 KB gzipped**. The baseline is recorded in `scripts/bundle-baseline.json` as 274,312 bytes (`index-*.js` gzipped, part 2 head).
- **Blockly placement:** no Blockly module may appear in the main chunk (checked by name in the source map's `sources`).
- **Dev hooks:** the dist dev-hook grep gains `unlockAll`.

---

## 10. Tests

| File | Covers |
| --- | --- |
| `tests/robotBench.test.ts` | Bench placement on new farms and in migration, including the nearest-free fallback. Benching, refusing an occupied bench, reopening, lifting off (energy and the too-tired refusal). Benched robots never act, recharge in range, stay through the morning, and a carried robot at day end still goes to spawn. |
| `tests/robotPeek.test.ts` | The peek intent and hint; no cost; the robot keeps acting. |
| `tests/robotStats.test.ts` (extend) | Each counter, wake tokens, skips adding nothing, daily and weekly rollover. |
| `tests/robotLog.test.ts` | Merging within a day; a new entry on a new day. |
| `tests/unlocks.test.ts` | Job 1's set, `withUnlocks`, canonical order, locked kinds still running. |
| `tests/zoneMarker.test.ts` | Painting both corners in any order, cycling, clearing, refusals, the HUD chip text, delivery when the backpack is full. |
| `tests/translate.test.ts` | Every block kind round-trips. A fixture of each design §5.2 program round-trips. 300 generated programs (part 2's `tests/programGen.ts`) round-trip. Every error path returns `{ error }` and never throws. Loose blocks are reported. |
| `tests/robotSaveV6.test.ts` | v5 → v6 migration (the v2 fixture migrates through all versions). Round trip with a benched robot, stats, unlocks and the marker. One corrupted field per §8.2 rule. |
| `tests/robotScreen.test.ts` | Pure view-model helpers: header text, counters, tab visibility by mode and unlocks, the toolbox contents for a size and unlock set, .MD card dropdown options. |

The Blockly glue and Three.js rendering are checked in the browser playbook, not in Vitest.

**Browser playbook:** `.claude/skills/game-driven-qa/scenarios/farmclaws-part3.md`:
1. Carry a robot to the bench. The screen opens.
2. Build job 1's program by dragging blocks (`When morning → Repeat 3 times → Water, Move forward` …).
3. Save, see the toast, lift it off, and watch it run.
4. Add a DON'T go into water card and see it obeyed.
5. Paint Zone A with the marker and use `For each tile in A` after `unlockAll`.
6. Peek at the Log with Shift + E.
7. Check the phone layout.
8. Confirm the bundle budget and no console errors.

---

## 11. Implementation steps

1. The log merge fix, stats types, counting and rollover.
2. Unlocks (types, config, `withUnlocks`, dev hook).
3. The workbench object, rendering, placement and the bench intents (`benchRobot`, `openBench`, `liftOffBench`), plus `onBench` in the run loop.
4. Peek input and intent.
5. The zone marker tool, painting intents, HUD chip and `ZoneRenderer`.
6. Save version 6: migration and validation.
7. Translation (pure) with its full test suite.
8. The robot screen shell: panel, header, tabs, phone layout, unsaved-changes prompt, Stats and Log tabs.
9. The Program tab: lazy Blockly, block definitions, theme, toolbox, counter, Save and Revert, highlighting.
10. The .MD tab.
11. The bundle budget script and dist checks.
12. The playbook, the QA skill rows, and the spec sync.

---

## 12. Done means

- Every test above passes. Typecheck, the full suite, the build and `build:check` are green.
- The playbook passes on a fresh farm at desktop and phone width.
- Parts 1–2 behave unchanged, apart from the log merge rule.

---

## 13. Changes to the farmclaws design

- **§6:**
  - The first workbench is built into every farm beside the farmhouse.
  - Shift + E peeks at a robot's Stats and Log anywhere.
  - The Looks tab arrives with part 6.
- **§5.1:**
  - The editor is Blockly, lazily loaded, with a budget of ≤ 250 KB gzipped for its chunk and ≤ 10 KB growth of the main bundle.
  - Unlocks gate the editor only; saved programs may use any block.
- **§3.5:** the farm log merges repeats only within a day.
- **§8 (job 1):** the zone marker is already in every backpack in part 3; part 4's Sol explains it rather than handing it over.
