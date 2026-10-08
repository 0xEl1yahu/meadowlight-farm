# Farmclaws part 3 spec: the robot screen

This is the build spec for part 3 of the farmclaws design (`docs/superpowers/specs/2026-09-29-farmclaws-design.md`, sections 5, 6, 7.1 and 11). Part 1 gave robots a body; part 2 (`docs/superpowers/specs/2026-10-02-farmclaws-part2-language.md`) gave them a language. Part 3 gives the **player** a way to use that language in the game: a **workbench** where robots are modded, repaired, painted and scrapped; a **robot screen** with a Blockly block editor, the .MD card editor, Looks, Stats and Log; a read-only **peek** in the field; the **zone marker** that paints zones A–H; and the **breakdowns** that send robots back to the bench.

Robots still reach normal play only in part 4, so part 3 is exercised through the part 1–2 dev hooks plus the new in-game screens.

Every decision here is final for part 3. Implementation agents follow it and don't redesign it. If something in the code makes a rule impossible, pick the smallest change that keeps the rule's intent and write it down in the step's commit message.

Global rules (unchanged from parts 1–2):

- The simulation stays pure and deterministic: no `Math.random`, no clock and no I/O in `src/core`, `src/state`, `src/world`, `src/farming`, `src/time` or `src/robots`. The editor and screens live in `src/ui`; Blockly is imported only there.
- Strict TypeScript with `erasableSyntaxOnly`: no enums, no namespaces, no parameter properties, `as const` objects plus union types, `import type` for types.
- No TODOs, placeholders or stubs.
- `npm run typecheck`, `npm test` and `npm run build` pass after every step.
- State is immutable with structural sharing.
- `isProgramShape` → `checkProgram` and `isMdShape` → `checkMd` are the only gate for programs and .MDs, from the screen exactly as from the dev hooks.
- Numbers come from config, never inline. Part 3 adds `ROBOT_CARE`, `ROBOT_PAINTS`, `ROBOT_SCREEN`, `WORKBENCH` and `UNLOCKS` to `src/config.ts`.
- Production code never takes a name the dist check greps for (section 10.3): no action, function or file named with `setMd`, `setZone` or `unlockAll` in it.

---

## 1. Scope

**Part 3 builds:**

- The **workbench**: a built-in placed object beside the farmhouse; putting a robot on it, the `onBench` robot state, lifting it off.
- The **on/off switch** promised by part 1 §2.1, part 2 §1 and design §5.4: `off: 'player'`.
- **Breakdowns**: bumping into another robot makes a robot dizzy and forget the stack it was running; a robot left in water overnight is ruined.
- **Bench jobs**: scrapping a robot for gold, and paint jobs in 16 base colours.
- The **robot screen**: a full-screen panel with the Program, .MD, Looks, Stats and Log tabs, in `bench` mode (editable) or `peek` mode (read-only, Stats and Log).
- The **Program tab**: a lazily loaded Blockly editor with one block type per language block, typed sockets, an unlock-filtered toolbox, the block counter, Save and Revert.
- The **translation** between Blockly's workspace JSON and `BlockProgram`, pure and exact in both directions.
- The **.MD tab**: a card editor for the unlocked cards.
- **Robot stats** (today and this week) and the **Stats tab**.
- The **Log tab**, after a log fix: repeated events merge only within the same day.
- **Unlocks**: a saved set of unlocked blocks, cards and tabs, starting at job 1's set.
- The **zone marker** tool: painting, cycling and clearing zones A–H, and a zone overlay renderer.
- The program, .MD and zone edits as **reducer actions**, moved out of the dev hooks.
- Save version 6 with migration and validation.
- A bundle-size budget enforced by a script, a single-file build that still has the editor, and a browser playbook.

**Part 3 does not build:**

| Thing | Part (release) |
| --- | --- |
| Jobs, Sol and the other NPCs, shops, getting a robot in normal play, flipping unlocks per job | 4 (release 1) |
| Part items, fitting and removing parts at the bench, the parts exchange's repairs | 4 (release 1) |
| Test run, messages, `Claim`, the Antenna | 5 (release 2) |
| Paint patterns, decals and finishes; voice, personality, quirk; speech bubbles | 6 (release 3) |
| The full .MD card set | 7 (release 4) |
| Crafting extra workbenches; touch alternatives to Shift + E / Shift + Space | 8 (release 5) |

---

## 2. The workbench

### 2.1 Object

- `PLACED_OBJECT_KINDS` gains `'workbench'`, with the shape `{ kind: 'workbench' }`.
- It **blocks movement**.
- It **can't be picked up**: the pickaxe refuses with "It's part of the farm.". It can't be placed from the inventory either; there is no workbench item in part 3.
- **Farm-only**: save validation rejects a workbench on another map.
- `WORKBENCH.home` in config is `{ tx: 6, tz: 4 }`, in the farmhouse yard. The tile is clear on every generated farm: it's inside `LAYOUT.clearZones[0]`, east of the house (x 0–4), and off the door (2, 4), the spawn (2, 5) and the bin (9–10, 5).
- **Placement:**
  - `createInitialState` puts the workbench at `WORKBENCH.home`.
  - Migration puts it there too, or on the nearest free farm tile when the player has built something at home: breadth-first over in-bounds farm tiles from `WORKBENCH.home`, in `DIRECTIONS` order, passing through any tile.
  - A free tile is walkable, has no object, crop or robot, isn't reserved, and isn't the player's tile.
- **Rendering:** a low-poly bench (top, four legs, a vice, a pegboard of three tiny tools) in `objectGeometry`. A robot on it is drawn by `RobotRenderer` standing on the bench top (section 2.2).

### 2.2 Robots on the bench

`Robot` gains `readonly onBench: boolean`.

- **Rules for a robot on the bench:**
  - Its `tx`/`tz` are the workbench tile.
  - It's never carried and never due: `runRobotsMinute` skips it as it skips carried robots.
  - It recharges overnight like any robot standing on that tile (part 1 §5.7.4; the bench is within range of a burner placed beside it).
  - The morning reset leaves it on the bench; nothing moves it. A ruined robot on the bench stays ruined; the ruin rule (section 3.2) applies only to robots standing in water.
  - At most one robot is on a given bench.
  - Its power can be anything except `repairing`.
- **What E does at the bench.** The workbench tile is resolved before any robot rule, so part 1's `pickUpRobot` never targets a robot on the bench:
  - **Carrying a robot, bench empty:** the intent `benchRobot`. Hint: "Put {name} on the bench".
    - Effects: `carried: false`, `onBench: true`, tile = the bench tile, `facing` = the player's, `teleportSeq + 1`, `player.carrying: null`. The panel opens in `bench` mode.
    - Power and `off` are unchanged. No energy cost.
  - **Carrying a robot, bench occupied:** refused with "There's already a robot on the bench."
  - **Not carrying, a robot on the bench:** the intent `openBench`, hint "Work on {name}", which reopens its screen.
  - **Not carrying, bench empty:** the hint "Bring a robot here to work on it" and a no-op toast saying the same.
  - Shift + E at the bench does the same as E.
- **Lift off the bench:** the screen's **Lift off** button dispatches `liftOffBench`.
  - It costs `carryEnergyFor(robot)` like a pick-up, and refuses with part 1's too-tired text when energy is short.
  - Effects: `onBench: false`, `carried: true`, `player.carrying: id`. The panel closes. With unsaved Program or .MD edits, it first asks the discard question (section 4.1).
  - Putting the robot down afterwards is part 1's put-down, with part 2's off-robot power rule.
- **Day end:** part 1 §5.7.2 (a carried robot is set down on the nearest walkable tile to spawn with no standing robot, R25) applies only to carried robots; a robot on the bench is not carried.

### 2.3 Peek

- **Shift + E** (any interact key with Shift) on a robot in the field is the intent `peekRobot`. The robot is on the tile ahead, standing, not carried and not on the bench.
- Hint: "Look at {name}" while Shift is held. `InputController` already tracks `shiftHeld`; it passes it to the HUD hint, and the hint resolves the intent with `{ shift }`.
- It opens the screen in `peek` mode: only the Stats and Log tabs (each still needs its unlock), with no Save, Lift off, switch, Scrap or editing affordances.
- It costs nothing and doesn't change the robot. Like every panel, the screen freezes the game while it's open (`selectIsFrozen`), so time and robots resume when it closes.
- `InputController` sends `peek` when an interact key is pressed with Shift. `panelKeyCommand(code, state, shift)` gains the `shift` argument and returns `actions.peek()` for it.
- **Precedence of Shift + E**, decided in this order:
  1. The workbench ahead: the same as E (section 2.2).
  2. A standing robot ahead: `peekRobot`.
  3. The zone marker selected: clear the current zone (section 8). Its hint is "Clear Zone {letter}".
  4. Otherwise nothing.

### 2.4 The on/off switch

- `Robot.off` gains `'player'`: `null | 'dizzy' | 'done' | 'player'`.
- **Switch:** in bench mode, the header has a switch, "On" / "Off".
  - "Off" dispatches `switchRobot { robotId, on: false }` and sets `off: 'player'`, whatever `off` was. It's shown, and allowed, only for a robot that is working, on standby or flat; the reducer refuses any other with "{name} can't be switched off while it's broken." (R19).
  - "On" is shown only when `off` is `'player'`. It dispatches `switchRobot { robotId, on: true }` and sets `off: null`.
  - It's free.
- **An off robot** ignores triggers and DO cards like a dizzy or done robot (part 2 §7), but the morning reset doesn't clear `'player'`, and a new program doesn't clear it either: only the switch turns the robot on.
- **Header text:** "Switched off" for `'player'`; "Off until morning" for `'dizzy'` and `'done'`.
- **Putting down:** `putDownPower` treats `'player'` like the other off reasons.

---

## 3. Breakdowns and the bench's other jobs

Mistakes send robots back to the bench. Each breakdown has its own fix:

| Breakdown | Cause | Fix |
| --- | --- | --- |
| Bump | A robot moves into another robot | Dizzy until morning, and the stack it was running is lost: reprogram it at the bench |
| Shorted out | A robot drives into water | Fish it out the same day and send it for a new core |
| Ruined | A shorted robot is still in the water at the morning reset | Nothing: scrap it at the bench |

### 3.1 Bumps

Robots no longer pass through each other: part 1's "moves never bicker; robots can share a tile" is replaced.

- **When it happens.** Bumps are decided once per minute in `runRobotsMinute`, after the choices and alongside the bicker check, from the positions at the start of the minute. Robot ids don't matter.
  - Every chosen `move` plan that is `ok` is a candidate. Plans from part 1 scripts, block programs, routes and DO returns all count.
  - **Same target:** two or more candidates with the same target all bump.
  - **Swap:** two candidates that would swap tiles both bump.
  - **Into a robot that stays:** repeat until nothing changes. A candidate bumps when its target holds a **standing** robot that has no candidate move left that hasn't bumped. A standing robot is one on the farm that isn't carried, repairing or on the bench (broken and ruined robots are standing).
  - Every other candidate moves as before. So a line of robots moving the same way all move, whatever their ids.
  - `planRobotAction` itself still ignores other robots; the re-plan in id order never turns a move into a bump or out of one.
- **What a bump does:**
  - The robot pays the move's cost and stays where it is.
  - Its turn settles like a failed action (`lastAction` with `success: false`, `bickered: false`).
  - It gets `off: 'dizzy'`. A block-program robot's exec stops: `running: null`, `frames: []`.
  - **The forgotten stack:** if a trigger stack was running (`exec.running` was `i`), that stack's body becomes `[]` in `robot.program`. The `When` block stays, so `exec.due`, `firedToday` and the stack indices stay aligned. Helpers, variables, other stacks and the .MD are kept.
  - A script robot, or a block robot that was idle or on a DO return, forgets nothing.
  - The robot that was bumped into is unaffected.
- **Log event:** `{ kind: 'crashed'; withId: number; forgot: Trigger | null }`, where `forgot` is the lost stack's trigger.
  - `whatHappened`: "Bumped into {name} and got dizzy. Forgot everything under "When {trigger}"." Without `forgot`: "Bumped into {name} and got dizzy."
  - `robotSays`: "Made a new friend ✓" (part 1's innocence rule).
  - Toast (warn): "{name} bumped into {other} and forgot what to do when {trigger}." Without `forgot`: "{name} bumped into {other} and got dizzy."
  - `{trigger}` uses `logText`'s trigger wording, e.g. "it's 2:00 pm" or "my bag is full".
- **Seeing robots:** the sensor `tile ahead is [blocked]` is Yes, and `[clear]` is No, when a standing robot is on the tile ahead. A program can check before it moves.
- **Routes:** `planRoute` still ignores robots (part 2 §5.3), since robots move. A route step into a robot bumps like any move.
- **No new shared tiles.** These now avoid tiles with a standing robot:
  - part 1's put-down: refused with "There's a robot there.";
  - the repair drop-off: the nearest walkable tile with no standing robot;
  - the morning reset's move off an unwalkable tile;
  - the day-end set-down of a robot still carried: the nearest walkable tile to spawn with no standing robot, which is spawn itself when it's free (R25).

  Robots already sharing a tile in a v5 save may stay; moving out is never a bump.
- **Stats:** a bump adds its tokens and 1 action (section 6.1).

### 3.2 Water: a new core or ruin

- **Shorting out** is unchanged (part 1 §5.4): `power: 'broken'`, on the water tile.
- **A new core:** part 1's repair at the shipping bin is the new core.
  - Hint: "Send {name} for a new core · {cost}g".
  - Toast: "{name} is off for a new core. Back tomorrow."
  - Cost (`repairCost`), timing and the return are part 1's.
- **Ruin:**
  - `ROBOT_POWERS` gains `'ruined'`.
  - At the morning reset, before the recharge step, every `broken` robot that stands on a water tile (not carried, not on the bench) becomes `ruined`. It logs `{ kind: 'ruined' }` and pushes the warn toast "{name} spent the night in the water and is ruined. Scrap it at the workbench."
  - So a robot fished out and put down on land, or carried at day end (set down by spawn), the day it fell in is safe. It stays `broken` until it's sent for a new core.
  - A robot loaded from a v5 save is never ruined by migration; the first morning after loading applies the rule.
- **A ruined robot:**
  - It never acts, never recharges, and is never named in the "away from a generator" toast.
  - It stays where it is (sunk in the water like a broken robot).
  - It can be picked up (with part 1's "Fish out {name}" hint), carried, benched and scrapped.
  - The shipping bin refuses it with "{name} is beyond repair. Scrap it at the workbench."
  - On the bench, its Program, .MD and Looks tabs are read-only, with the note "{name} is ruined. It can only be scrapped."; the switch is hidden.
- **Log text:**
  - `whatHappened` for `ruined`: "Spent the night in the water. Ruined: it can only be scrapped."
  - `robotSays`: "Having a long bath ✓".
- **Rendering:** a ruined robot uses the broken pose without sparks, with its paint darkened by `ROBOT_CARE.ruinedShade` (0.45).

### 3.3 Scrapping

- In bench mode, the header has a **Scrap** button.
- It asks "Scrap {name} for {gold}g? This can't be undone." (Scrap / Keep), which also discards unsaved edits.
- **Scrap** dispatches `scrapRobot { robotId }`. The robot must be on the bench.
- **Effects:**
  - The robot leaves `robots.list` and its log entries are dropped.
  - Its bag goes into the player's backpack, qualities kept. When the backpack can't take the whole bag, scrapping is refused with "Make room in your backpack for {name}'s bag first." and nothing changes.
  - Gold grows by `scrapValue(robot) = Math.round(ROBOTS.sizes[size].price × ROBOT_CARE.scrapShare)`, with `scrapShare` 0.25: Mini 375g, Standard 1,000g, Big 2,500g. It's the same for every power, ruined included.
  - The panel closes. Toast (success): "Scrapped {name} for {gold}g."
  - Ids are never reused (part 1).
- **Other robots' entries:** an entry naming the scrapped robot (`bickered.withIds`, `crashed.withId`) reads "a scrapped robot" in place of its name. `logText`'s fallback for a missing name changes from "robot {id}" to that.
- Part items don't exist until part 4, so scrapping pays gold only; part 4 may add parts back.

### 3.4 Paint

- `Robot` gains `readonly paint: number`, an index into `ROBOT_PAINTS` (0 … 15). It's presentation only: it never changes what a robot does (design §2).
- **The colours:** `ROBOT_PAINTS` in config is 16 `{ name, color }` entries:

  | Index | Name | Colour |
  | --- | --- | --- |
  | 0 | Sunflower | `0xf2c14e` (today's body colour) |
  | 1 | Tomato | `0xe2563f` |
  | 2 | Pumpkin | `0xf28a3a` |
  | 3 | Peach | `0xf4b38a` |
  | 4 | Rose | `0xe87fa3` |
  | 5 | Plum | `0x8e5ba8` |
  | 6 | Lavender | `0xa99be0` |
  | 7 | Sky | `0x6fb7e8` |
  | 8 | Ocean | `0x2f6fb0` |
  | 9 | Teal | `0x3aa59c` |
  | 10 | Mint | `0x8fdcb0` |
  | 11 | Leaf | `0x5fa84a` |
  | 12 | Olive | `0x8a8f3c` |
  | 13 | Cocoa | `0x8a5a3c` |
  | 14 | Slate | `0x5e6670` |
  | 15 | Cream | `0xece2c6` |

- **New robots** start at paint 0. Migration gives every robot 0.
- **Painting:** in the Looks tab (section 4.4), a swatch grid previews the colour on a small robot drawing, and **Paint · {cost}g** dispatches `paintRobot { robotId, paint }`.
  - The cost is `ROBOT_CARE.paintCost` (50g).
  - Refused with "{name} is already {colour}." for the same colour, and "A paint job costs {cost}g." when gold is short.
  - Toast (success): "Painted {name} {colour}."
- **Rendering:**
  - The painted shell of the body and head moves into new mesh ids, `bodyShell` and `headShell`, authored in white, with the robot's paint as their instance colour.
  - Trim, metal and the other pieces keep their own vertex colours in the existing `body` and `head` meshes.
  - Instance colours are written only when a robot's paint or power changes. No per-frame allocation.

---

## 4. The robot screen (`src/ui/robotScreen/`)

### 4.1 Panel, loading and keys

- **Panel:** `UiPanel` gains `{ kind: 'robot'; robotId: number; mode: 'bench' | 'peek' }`. While it's open the game is frozen (`selectIsFrozen`), as with the inventory.
- **Loading:** `src/ui/robotScreen/` is loaded with one dynamic `import()` the first time a robot screen opens. Blockly is a second dynamic import inside it (section 4.2).
  - While the screen loads, the panel shows "Opening…".
  - If it fails to load, the panel closes with the toast "The robot screen couldn't load. Try again." and the robot is untouched.
- **Keys:** while a robot panel is open, the robot screen owns the keyboard.
  - `InputController` neither dispatches nor calls `preventDefault` for any key, so Blockly and the screen's fields get every key.
  - `panelKeyCommand` returns `null` for the robot panel.
- **Escape:** the screen's own handler first closes an open Blockly dropdown, widget or flyout. Otherwise it closes the screen.
- **Unsaved edits:** closing with unsaved Program or .MD edits asks "Discard your changes to {name}'s program?" (Discard / Keep editing). That covers Escape, the close button and Lift off.
- **Header:**
  - the robot's name, its size and parts (part icons), and tokens / battery;
  - its power, and the off text from section 2.4;
  - in bench mode: the on/off switch (section 2.4), **Lift off** and **Scrap**.
- **Tabs:** Program, .MD, Looks, Stats and Log, in that order. A tab whose unlock (section 7) is missing is hidden. Peek shows only Stats and Log; Looks is bench-only.
  - The tab strip follows the ARIA tabs pattern: ArrowRight and ArrowLeft step through the visible tabs, wrapping around, and Home and End go to the first and last, each activating and focusing its tab (R28).
- **Phone width** (< `ROBOT_SCREEN.phoneMaxWidth`, 700 px):
  - The tabs become a strip under the header, and the active tab fills the rest of the screen.
  - The Blockly toolbox's category column hides behind a **Blocks** button, which opens a menu of the categories; picking one opens its flyout (R31).

### 4.2 Program tab

- **Loading:** Blockly (`blockly/core` + `blockly/msg/en`, the current major of the `blockly` package, added to `dependencies` by the step that first uses it) is imported with a dynamic `import()` the first time a Program tab opens.
  - While it loads, the tab shows "Opening the editor…".
  - A load failure logs the error to the console, then shows "The editor couldn't load. Close and try again." and leaves the robot untouched (R33).
- **Loading is never an edit:** the saved program loads with Blockly's events disabled, whether on open, on Revert or after a change from outside, and loading clears Blockly's undo stack, so Ctrl+Z can't replay discarded edits. A field edit counts once it's committed: Blockly's `BlockFieldIntermediateChange` (keystrokes in an open field) is skipped, so a cancelled field edit isn't an edit (R32).
- **Blocks:** one Blockly block type per entry of section 5's table. Labels are sentence case, as in design §5.2.
- **Colours by category:** Triggers gold, Control orange, Actions green, Sensors teal, Values purple.
- **Socket checks:** value sockets are typed `Number`, `Text`, `YesNo`, `Item` or `Tile`; statement connections are untyped. `fc_var`'s output check follows its declaration's type, and is updated when the declaration's type changes.
- **Theme:** a Blockly theme from the HUD palette, on the **Zelos** renderer (rounded): a cream workspace and the game's font. No grid lines. The trash can and zoom controls are on.
- **Toolbox:**
  - Five categories (Triggers, Control, Actions, Sensors, Values).
  - It shows only blocks whose kind is in `unlocks.blocks`. Sizes with no sensor eye see sensor-eye sensors disabled, with the tooltip "Needs a sensor eye".
  - The toolbox has no shadow blocks.
- **Dropdowns never drop a value.** Every data dropdown is a registered `field_fc_*` subclass of Blockly's `FieldDropdown` whose options include the field's current value and which accepts and shows any well-formed value, because Blockly's own dropdown rejects a value outside its cached options (R29). So a loaded value outside the usual options (9:43, an item not otherwise listed) is shown and kept.
  - **Times** (`atTime`, `timeIsAfter`): `ROBOT_SCREEN.timeStep` (10-minute) steps from 6:00 am to 1:50 am, plus the current value.
  - **Tile literals** (`fc_tile`) are two integer number fields, X and Z, limited to the farm's size.
- **Variables:** a "Make a variable" button asks for a name and a type (Number, Text, Yes/No, Item, Tile), in a form inside the screen.
  - It adds an `fc_varDecl` block to the workspace: "Variable [name] is a [type] starting at [literal]", holding that type's default literal (0, "", No, parsnip, the robot's tile).
  - The player edits the literal in place. Changing a declaration's type swaps in that type's default literal and retypes its `INITIAL` socket; renaming a declaration or a helper renames its uses (R30).
  - The button shows only when `var` is unlocked.
  - Variable dropdowns in `fc_var`, `fc_set` and `fc_change` list the workspace's declarations. The editor doesn't use Blockly's variable model.
- **Helpers:** "Define helper [name]" (`fc_helper`) and "Run helper [name]" (`fc_runHelper`) blocks.
- **Counter:**
  - "{used} / {limit} blocks" from `countWorkspaceBlocks(json)` (section 5) and `ROBOTS.sizes[size].blocks`. It counts mid-edit, before the workspace translates.
  - It turns red over the limit, and so does a "{n} / {limit} variables" line.
- **Save:**
  - Translate the workspace (section 5).
  - A block left loose (not in a trigger stack, helper or variable declaration) is an error: "Every block must be inside a When … stack or a helper." The block is highlighted.
  - Then `isProgramShape` and `checkProgram`. The checker's sentence is shown under the toolbar and nothing is saved.
  - Loose blocks and the block named by a translation error (`blockId`) are highlighted; checker problems are shown as text only.
  - On success, dispatch `programRobot { robotId, program }`. The reducer runs the same checks again and rebuilds the exec with part 2's rule (section 4.7). Toast "Programmed {name}.".
- **Revert:** reload the saved program into the workspace.
- **Scripts:** a robot still running a part 1 script opens with an empty workspace and the note "{name} runs a fixed script. Saving here replaces it with a block program."
- **Ruined robots:** the workspace is read-only (section 3.2).

### 4.3 .MD tab

- **Look:** the design's markdown card, "# {NAME}.MD", then "## DO" and "## DON'T", each card one line with fields:
  - dropdowns for zones, crops and items;
  - tiles as two number fields (X, Z);
  - times as a dropdown in `ROBOT_SCREEN.timeStep` steps from 6:00 am to 1:50 am, plus the card's current value.
- **Editing:**
  - **Add a card** lists the unlocked card kinds. Cards can be removed and reordered within their section.
  - A new card starts at its kind's defaults: the first zone, crop or item; a DO return to the nearest generator at `ROBOT_SCREEN.cardDefaults.returnMinute` (6:00 pm); a DO power-down when the bag is full, whose tokens-below option starts at `cardDefaults.tokensBelow` (10). A number field that isn't a whole number leaves the card as it was (R34).
  - A counter shows "{n} / {limit} cards".
  - **Save** runs `isMdShape` and `checkMd`, then dispatches `setRobotMd { robotId, md }`. The reducer applies `withMd` (section 4.7): it runs the same checks, clears `exec.doneCards` and stops a DO return under way.
- **Scripts:** a script robot shows ".MD cards only apply to block programs." and no editor.
- **Ruined robots:** read-only.

### 4.4 Looks tab

- Bench mode only.
- It holds the paint swatches and **Paint · {cost}g** (section 3.4).
- Part 6 adds voice, personality and quirk here.

### 4.5 Stats tab

Two columns, **Today** and **This week**:
- tokens used
- actions taken
- crops handled (harvested plus planted)
- tokens per crop, shown as "—" when no crops were handled

### 4.6 Log tab

- **Columns:** "Robot says" beside "What happened" (part 2's `robotSays` and `whatHappened`), newest first, today and yesterday, with "×{count}" on merged entries. Each row starts with its time (e.g. "9:40 am").
- **Empty:** "Nothing yet today."

### 4.7 Edits as reducer actions

Today the program, .MD and zone edits exist only in `src/dev/robotDev.ts`, applied through `actions.load(state)`, so production can't use them.

- **Move them** into `src/robots/edits.ts`, pure, with their tests:
  - `withProgram(robot, program, minuteOfDay)`: the exec rule, `execAt` plus a `morning` stack only before the first act;
  - `withMd(robot, md)`;
  - `withZone(state, id, rect)`.
- **Reducer actions:**
  - `programRobot { robotId, program }` and `setRobotMd { robotId, md }`. Each refuses a robot that isn't on the bench, with the checker's sentence or the part 2 refusal as a toast.
  - `markZone` and `clearZone` (section 8).
- **Dev hooks:** `setProgram`, `setMd` and `setZone` keep their behaviour and call the same functions. They aren't limited to benched robots.

---

## 5. Translation (`src/ui/robotScreen/translate.ts`, pure)

```ts
export function programToWorkspace(program: BlockProgram): BlocklyWorkspaceJson;
export function workspaceToProgram(json: BlocklyWorkspaceJson):
  | { readonly program: BlockProgram; readonly loose: readonly string[] }
  | { readonly error: string; readonly blockId: string | null };
export function countWorkspaceBlocks(json: BlocklyWorkspaceJson): number;
```

- **Format:** `BlocklyWorkspaceJson` is Blockly's `serialization.workspaces.save` shape (`blocks.blocks[]`, `variables[]`), declared locally as a type. The module never imports Blockly. `variables[]` is always empty and ignored.
- **Block types** (`fc_` + a kind; the kinds are distinct across the whole language, which a test checks):

  | Language | Block type | Fields | Inputs |
  | --- | --- | --- | --- |
  | `Trigger` | `fc_morning`, `fc_atTime`, `fc_bagFull`, `fc_startsRaining`, `fc_every` | `MINUTE` (`atTime`), `MINUTES` (`every`) | statement `DO` |
  | `HelperDef` | `fc_helper` | `NAME` | statement `DO` |
  | `VarDecl` | `fc_varDecl` | `NAME`, `TYPE` | value `INITIAL` (a literal block) |
  | `{ kind: 'do', action }` | one block per `ActionBlock` kind: `fc_move`, `fc_turn`, `fc_water`, `fc_harvest`, `fc_till`, `fc_plant`, `fc_refill`, `fc_deposit`, `fc_take`, `fc_say`, `fc_wait`, `fc_powerDown`. There is no `fc_do`. | `SIDE`, `CROP` | `ITEM` (`take`), `TEXT` (`say`), `MINUTES` (`wait`) |
  | `if`, `else: null` | `fc_if` | | `COND`, statement `THEN` |
  | `if`, `else` a list (possibly `[]`) | `fc_ifElse` | | `COND`, statements `THEN`, `ELSE` |
  | other statements | `fc_repeatTimes`, `fc_repeatUntil`, `fc_repeatForever`, `fc_forEachTile`, `fc_goTo`, `fc_set`, `fc_change`, `fc_runHelper` | `ZONE`, `NAME` / `VAR` | `TIMES`, `UNTIL`, `TILE`, `VALUE`, `BY`; statement `DO` |
  | literals | `fc_num`, `fc_text`, `fc_yes`, `fc_item`, `fc_tile` | `NUM`, `TEXT`, `VALUE`, `ITEM`, `X` + `Z` | |
  | other expressions | `fc_<kind>` for each remaining `Expr` kind (`fc_var`, `fc_myTile`, `fc_arith`, `fc_and`, `fc_or`, `fc_cropIsReady`, `fc_tokensBelow`, …) | `VAR`, `OP`, `ITEM`, `CROP`, `ZONE`, `WHAT`, `MINUTE` | `A`, `B`, `N` |

- **Bodies:** statement inputs hold the first statement; the rest chain by `next`.
- **Shadows:** an input with no `block` falls back to its `shadow`. An input with neither is the error "Fill every empty slot." naming the block.
- **Top level:** variable declarations, then trigger stacks, then helpers, each in program order, laid out top to bottom `ROBOT_SCREEN.stackGap` (40) px apart. `workspaceToProgram` reads each kind in its order in `blocks.blocks[]`.
- **Round trip:** `workspaceToProgram(programToWorkspace(p))` deep-equals `{ program: p, loose: [] }` for every program the checker accepts.
- **Invalid workspace JSON:** `workspaceToProgram` never throws. Unknown block types, missing fields or missing inputs return `{ error, blockId }` naming the block.
- **`loose`:** the ids of top-level blocks that are not a trigger, `fc_helper` or `fc_varDecl`, and of any block chained by `next` under a trigger, helper or declaration (nothing goes below one).
- **Field values and ids:** `programToWorkspace` saves dropdown fields (times, `Every`, yes or no, ids, operators) as strings and number fields as numbers, and `workspaceToProgram` reads either as a number. Block ids are `b1`, `b2`, … depth first.
- **Unreadable workspaces:** a malformed workspace, a block met twice and nesting too deep to read are "This block isn't part of the robot language.", with `blockId` null when there's no id (R27).
- **`countWorkspaceBlocks`:** equals `blockCount(program)` whenever the workspace translates (a test checks it on every round-trip fixture). It counts the same way while there are empty slots or loose blocks: literal and declaration blocks count 0, every other block 1.

---

## 6. Stats and the log fix

### 6.1 Robot stats

`Robot` gains `stats`, and loses `tokensToday`, which `stats.today.tokens` replaces:

```ts
readonly stats: {
  readonly today: RobotStatCounts;
  readonly week: RobotStatCounts;
};
interface RobotStatCounts { readonly tokens: number; readonly actions: number; readonly crops: number }
```

- **Tokens:** `pay` in `execute.ts` adds every cost to `today.tokens` and `week.tokens`. That covers actions, bickers, bumps and wakes.
- **Actions:** `applyRobotPlan` and `applyBickerPlan` add 1 to `actions` for every resolved action, including blocked, bickered and bumped ones.
- **Crops:** they add 1 to `crops` for a successful `harvest` or `plant`.
- **Skips and waking:** skips cost nothing and add nothing. A wake adds its cost to `tokens` but not to `actions`.
- **Rollover:** the morning reset zeroes `today`. It also zeroes `week` when the new day starts a week (`dayOfSeason` is 1, 8, 15 or 22).

### 6.2 Log merge within a day

`logRobotEvent` merges into the robot's most recent entry only when the event is equal **and** the entry's `day` is today. Part 2's `whatHappened` text is unchanged. Spec sync: part 1 §5.6 says so.

---

## 7. Unlocks

```ts
export interface RobotUnlocks {
  readonly blocks: readonly BlockKind[];     // canonical BLOCK_KINDS order
  readonly cards: readonly MdCard['kind'][]; // canonical MD_CARD_KINDS order
  readonly tabs: readonly ('program' | 'md' | 'looks' | 'stats' | 'log')[];
}
```

- **New lists:**
  - `BLOCK_KINDS` and `BlockKind` (new, `src/robots/blockKinds.ts`) list every block kind by its language `kind`: triggers, statements except `do`, action blocks and expressions, plus `helper` (Define helper) and `var` (which also gates "Make a variable").
  - `fc_if` and `fc_ifElse` both need `if`.
  - `MD_CARD_KINDS` (new, beside `MdCard` in `src/core/types.ts`) lists the card kinds.
- `RobotsState` gains `unlocks`.
- **Job 1's set** (`UNLOCKS.job1` in config) is the starting set for new farms and migrated saves:
  - **Blocks:** `morning`, `atTime`, `repeatTimes`, `repeatUntil`, `repeatForever`, `move`, `turn`, `goTo`, `water`, `refill`, `powerDown`, `wait`, `say`, the literals (`num`, `text`, `yes`, `item`, `tile`), `myTile`, `tileAhead`, `tokensLeft` and `compare`. The last two give `Repeat until` a real condition, and job 1's goal a stop condition: "Repeat until tokens left < 10".
  - **Cards:** `dontLeave`, `dontGoIntoWater`.
  - **Tabs:** `program`, `md`, `looks`, `log`.
- **Locked kinds:**
  - The screen hides locked blocks and cards.
  - A saved program or .MD using a locked kind is still valid. Unlocks gate the editor, not the simulation, so part 4's preloaded job programs can use anything.
  - A locked block already in a loaded program shows normally and can be kept or deleted, but not added again.
- **Dev hook:** `__meadowlight.unlockAll()` sets every block, card and tab. Part 4's jobs add to the set through a pure `withUnlocks(state, partial)`.

---

## 8. The zone marker

- **Tool:**
  - `TOOL_TYPES` gains `'zoneMarker'`, with the name "Zone Marker" and the description "Paints zones A to H for your robots. Use it to mark corners; Shift + use picks the zone.".
  - Every per-tool table gains an entry: energy cost 0, the hotbar icon, the held-tool mesh. It isn't upgradable; the upgrade list skips it.
  - Like the other tools, it can't be shipped, sold or trashed.
  - Robots never take tools: a `Take` of a tool item (the marker or any other tool) is blocked with `itemNotFound`, so no tool enters a robot's bag and scrapping a robot can't lose the marker (R26).
- **Delivery:**
  - New farms get one in the first free inventory slot.
  - Migrated saves get one there too. When the backpack is full, `robots.pendingMarker` is set instead, and the first morning with a free slot adds the marker and shows the toast "Your zone marker is in your backpack.".
- **State:**
  - `ui.zoneDraft: null | { zone: ZoneId; corner: TileCoord }` and `ui.zoneLetter: ZoneId` (default A) are presentation state.
  - The save writes `ui` as a whole, so `isValidUi` checks both fields' shapes, and loading resets them to `null` and A, as it resets the panel.
- **Painting:** with the marker selected, a **fresh** press of the tool key (Space, J, or a click) on the tile ahead. Held-key repeats are ignored by the marker.
  - **First press:** the draft's corner is set.
  - **Second press:** the rectangle from the corner to this tile becomes `ui.zoneLetter`'s zone through `markZone` (`withZone`). The toast reads "Zone A · 3×3.". The draft clears.
  - **Off the farm:** another map is refused with "Zones are only on the farm.".
- **Keys:**
  - Shift with the tool key cycles the letter A → H → A, and drops a draft.
  - Shift + E clears the current letter's zone (`clearZone`), with the toast "Cleared Zone A.", unless the workbench or a standing robot is ahead (section 2.3).
  - Escape drops a draft: `panelKeyCommand` returns `clearZoneDraft` instead of pausing while a draft exists.
  - A draft also drops when the selected slot changes, the player leaves the farm, or any panel opens.
- **HUD:** a chip above the hotbar while the marker is selected, e.g. "Zone A · 3×3" or "Zone A · not set", plus "corner set" during a draft.
- **Rendering (`src/render/ZoneRenderer.ts`):**
  - **When it draws:** while the marker is selected, or a robot screen is open.
  - **Each set zone:** a tinted ground outline in its colour (A–H from a fixed 8-colour palette in config) and its letter at the north-west corner.
  - **The draft:** previewed from the corner to the highlighted tile.
  - **Instanced, with no per-frame allocation.**

---

## 9. Save version 6

### 9.1 Migration (`migrateV5toV6`)

- **Robots:**
  - every robot gains `onBench: false` and `paint: 0`;
  - `tokensToday` becomes `stats.today.tokens` and `stats.week.tokens`, with `actions` and `crops` 0.
- **Robots section:** gains `unlocks: UNLOCKS.job1` and `pendingMarker: false` (true when the marker couldn't be delivered).
- **Farm:** gets the workbench (section 2.1 placement).
- **Player:** gets the zone marker (section 8).
- **UI:** gains `zoneDraft: null` and `zoneLetter: 'A'`.
- **Version:** `SAVE_VERSION = 6`.

### 9.2 Validation

- **The workbench:** exactly one on the farm, none elsewhere.
- **Robots on the bench:**
  - An `onBench` robot sits on the workbench tile, isn't carried or repairing, and is the only `onBench` robot. Part 1's walkable-tile rule doesn't apply to it.
  - No robot that isn't `onBench` stands on the workbench tile.
- **Power and off:**
  - `ruined` follows `broken`'s placement rule (a water tile or a walkable tile), with `repairReadyDay: null` and `off: null`.
  - `off` may be `'player'`, with the same power rule as the other off reasons.
- **Paint:** an integer 0 … 15.
- **Stats:** non-negative integers, `today` ≤ `week` in each counter.
- **Log events:** `crashed` (`withId` a positive integer; `forgot` null or a valid trigger) and `ruined`.
- **Unlocks:** canonical, known kinds.
- **The zone marker:** at most one in the inventory, the held stack and chests together. `pendingMarker` is true only when there's none.
- **UI:** `zoneDraft` and `zoneLetter` well-formed.

Any state the game can produce must load; a corrupted field is rejected.

---

## 10. Bundles and builds

### 10.1 Budget (`scripts/check-bundle.mjs`)

`package.json` gains `"build:check": "npm run build && node scripts/check-bundle.mjs"`. Sizes are gzipped with Node's `zlib.gzipSync` at its default level (6).

- **The editor chunk** (every lazy chunk containing Blockly, found through its source map's `sources`, added up: `blockly/core` and `blockly/msg/en` load as two chunks) must be ≤ **250 KB gzipped**.
- **The robot screen chunk** must be ≤ **40 KB gzipped**.
- **The main entry chunk** must be ≤ the part 2 baseline + **26 KB gzipped** (R35; raised from 16 KB by the part 4a spec's refinement R20). The baseline is recorded in `scripts/bundle-baseline.json` as 275,539 bytes (part 2's `index-CUmkGRNG.js` at commit `2a92771` through `zlib.gzipSync` at level 6; the `gzip -6` command line gives 274,312 for the same file).
- **Blockly placement:** no Blockly module may appear in the main chunk or the screen chunk (checked by name in each source map's `sources`).
- **Chunks without a source map:** one of at most 1 KB gzipped (a bundler runtime helper, such as Rolldown's runtime chunk) counts as other, with no budget, and is still scanned by the dist check (section 10.3); a larger one fails the check (R36).

### 10.2 The single-file build

`build-single.mjs` inlines only the entry script, so a lazy chunk would be fetched from `/assets/` and fail in `dist-single`.

- `build:single` builds in a `single` mode (`vite.config.ts`) with Rolldown's `codeSplitting: false`, Vite 8's name for `inlineDynamicImports`. That puts the screen and the editor inside the one page.
- `build-single.mjs` also fails when the inlined code still contains an `import(` of a built chunk, whether relative (``import(`./RobotScreen-….js`)``, as Vite writes it) or under `assets/`.
- The budget in section 10.1 applies only to the normal build.

### 10.3 Dev hooks out of `dist/`

`check-bundle.mjs` also runs the dist check that part 2 only described in its plan: no file in `dist/` matches `robotLog|installRobotDev|addScriptedRobot|setMd|setZone|unlockAll`. `setProgram` stays out of the pattern: three.js's `WebGLRenderer` has its own.

---

## 11. Tests

| File | Covers |
| --- | --- |
| `tests/robotBench.test.ts` | Bench placement on new farms and in migration, including the nearest-free fallback. Benching, refusing an occupied bench, reopening, E at the bench never picking up the benched robot, lifting off (energy and the too-tired refusal). Benched robots never act, recharge in range, stay through the morning, and a carried robot at day end still goes to spawn, or the nearest free walkable tile to it. The on/off switch, `'player'` surviving the morning. |
| `tests/robotPeek.test.ts` | The peek intent and hint; the Shift + E precedence; no cost; the robot unchanged. |
| `tests/robotBump.test.ts` | Same-target, swap and into-a-standing-robot bumps; a line of robots moving the same way never bumps, in either id order; the forgotten stack's body emptied, its `When` kept, helpers and other stacks kept; scripts and idle robots forget nothing; cost, `off: 'dizzy'`, the log event, toast and texts; `tile ahead is blocked` seeing robots; put-down, drop-off and morning moves avoiding robot tiles. |
| `tests/robotRuin.test.ts` | A broken robot still in water at the morning reset is ruined; fished out or carried at day end, it isn't; a migrated broken robot is ruined only at the next morning; ruined robots never act or recharge; the bin's new core and its refusal for ruined robots. |
| `tests/robotScrapPaint.test.ts` | Scrapping: gold per size, the robot and its log gone, its bag moved into the backpack (refused when it can't fit), "a scrapped robot" in other entries, the bench-only rule. Paint: cost, the same-colour and short-gold refusals, the toast. |
| `tests/robotEdits.test.ts` | `withProgram`, `withMd` and `withZone` moved from the dev hooks, and the `programRobot` / `setRobotMd` actions with their bench-only rule. |
| `tests/robotStats.test.ts` (extend) | Each counter, wake tokens, bumps, skips adding nothing, daily and weekly rollover. |
| `tests/robotLog.test.ts` | Merging within a day; a new entry on a new day. |
| `tests/unlocks.test.ts` | Job 1's set, `withUnlocks`, canonical order, distinct kinds across the language, locked kinds still running. |
| `tests/zoneMarker.test.ts` | Painting both corners in any order, ignored repeats, cycling, clearing, the draft dropping (Escape, slot change, map change, panel), refusals, the HUD chip text, delivery when the backpack is full. |
| `tests/translate.test.ts` | Every block type round-trips, including `fc_if` with `else: null` and `fc_ifElse` with `else: []`. A fixture of each design §5.2 program round-trips. 300 generated programs (part 2's `tests/programGen.ts`) round-trip. Shadows read as blocks. `countWorkspaceBlocks` equals `blockCount` on every fixture. Every error path returns `{ error, blockId }` and never throws. Loose blocks are reported. |
| `tests/robotSaveV6.test.ts` | v5 → v6 migration (the v2 fixture migrates through all versions), including `tokensToday` → stats. Round trip with a benched robot, a ruined robot, a switched-off robot, paint, stats, unlocks, the marker and a zone draft (reset on load). One corrupted field per §9.2 rule. |
| `tests/panelKeys.test.ts` (extend) | The robot panel's `null`, `peek` with Shift, Escape dropping a zone draft. |
| `tests/robotScreen.test.ts` | Pure view-model helpers: header text (off reasons, ruined), counters, tab visibility by mode and unlocks, the toolbox contents for a size and unlock set, dropdown options that include the current value, .MD card fields. |
| `tests/checkBundle.test.ts` | The rules behind `scripts/check-bundle.mjs` and `scripts/build-single.mjs`: the entry read from `dist/index.html`, chunks sorted by their source maps, the three budgets at and over their limits, Blockly's placement, the dev-hook grep, and the single-file build's lazy-import guard. |

Existing robot tests that move robots onto each other's tiles, and the `pair` dev preset, are updated to the bump rule in the bump step. `pair` keeps demonstrating a bicker.

The Blockly glue and Three.js rendering are checked in the browser playbook, not in Vitest.

**Browser playbook:** `.claude/skills/game-driven-qa/scenarios/farmclaws-part3.md`:
1. Carry a robot to the bench. The screen opens.
2. Build job 1's program by dragging blocks (`When morning → Repeat until tokens left < 10 → Water, Move forward` …).
3. Save, see the toast, lift it off, and watch it run.
4. Load each design §5.2 fixture into the editor with `setProgram`, open the bench, Save without changes, and confirm the saved program is unchanged.
5. Add a DON'T go into water card and see it obeyed.
6. Paint Zone A with the marker and use `For each tile in A` after `unlockAll`.
7. Drive two robots into each other: both dizzy, the toast, the emptied stack on the bench.
8. Drive a robot into the pond. Fish it out and send it for a new core. Drive another in and sleep: it's ruined; scrap it on the bench and see the gold.
9. Paint a robot and switch it off; check it stays off the next morning.
10. Peek at the Log with Shift + E; after `unlockAll`, check the Stats tab.
11. Check the phone layout.
12. Run `npm run build:check` and `npm run build:single`, open `dist-single/index.html`, open the editor, and check there are no console errors.

---

## 12. Implementation steps

Each step that adds a saved field adds it to the type, `createInitialState`, `migrateV5toV6` and validation in the same step, so saves load after every step.

1. Save version 6 scaffolding: `SAVE_VERSION = 6`, `migrateV5toV6` and the v6 validation entry point, with no new fields yet.
2. Edits as reducer actions (section 4.7): move `withProgram`, `withMd` and `withZone` out of the dev hooks; add `programRobot` and `setRobotMd`.
3. The log merge fix; stats replacing `tokensToday`, counting and rollover.
4. Unlocks (types, `BLOCK_KINDS`, `MD_CARD_KINDS`, config, `withUnlocks`, dev hook).
5. The workbench object, rendering, placement and the bench intents (`benchRobot`, `openBench`, `liftOffBench`), plus `onBench` in the run loop; the on/off switch.
6. Bumps.
7. Ruin and the new-core wording; scrapping; paint and its rendering.
8. Peek input, intent and Shift + E precedence.
9. The zone marker tool, painting intents, HUD chip and `ZoneRenderer`.
10. Translation (pure) with its full test suite.
11. The robot screen shell: lazy loading, panel, keys, header (switch, Lift off, Scrap), tabs, phone layout, unsaved-changes prompt, Looks, Stats and Log tabs.
12. The Program tab: lazy Blockly, block definitions, theme, toolbox, variables, counter, Save and Revert, highlighting.
13. The .MD tab.
14. The bundle budget script, `build:check`, the dist check and the single-file build.
15. The playbook, the QA skill rows, and the spec sync (section 14).

---

## 13. Done means

- Every test above passes. Typecheck, the full suite, the build, `build:check` and `build:single` are green.
- The playbook passes on a fresh farm at desktop and phone width.
- Parts 1–2 behave unchanged, apart from the log merge rule, bumps, ruin, the bin's new-core wording, `tokensToday` becoming stats, and `tile ahead is blocked` seeing robots.

---

## 14. Changes to the farmclaws design and earlier specs

**Design:**

- **§2:**
  - "Nothing wears out" gains two exceptions, both caused by the player's setup:
    - a robot that bumps into another forgets the stack it was running;
    - a robot left in water overnight is ruined and can only be scrapped.
  - Neither is random.
- **§3.5:** the farm log merges repeats only within a day.
- **§5.1:**
  - The editor is Blockly (Zelos renderer), lazily loaded, with a budget of ≤ 250 KB gzipped for its chunk, ≤ 40 KB for the robot screen chunk, and ≤ 16 KB growth of the main bundle (R35).
  - Unlocks gate the editor only; saved programs may use any block.
- **§5.2:**
  - Job 1 also unlocks `tokens left` and comparisons, so `Repeat until` has a condition.
  - `tile ahead is blocked` is Yes for a robot ahead.
- **§5.4:** the on/off switch is `off: 'player'`, set on the bench, and survives the morning.
- **§6:**
  - The first workbench is built into every farm beside the farmhouse.
  - The bench also scraps robots for a quarter of their size's price and paints them.
  - Shift + E peeks at a robot's Stats and Log anywhere.
  - The Looks tab arrives in part 3 with paint only; part 6 adds voice, personality and quirk.
- **§7.1:** the 16 base colours are available at the bench from release 1, for 50g a coat; patterns, decals and finishes stay in release 3.
- **§8 (job 1):** the zone marker is already in every backpack in part 3; part 4's Sol explains it rather than handing it over.

**Part 1 spec:**

- §5.3: "Moves never bicker: robots can share a tile" is replaced by section 3.1's bumps.
- §5.8: put-down refuses a tile with a robot.
- §5.6: log merging is within a day.
- §5.7:
  - the morning reset ruins broken robots still in water;
  - drop-offs and moves off unwalkable tiles avoid robot tiles;
  - `tokensToday` is now `stats.today.tokens`.
- §5.8: the bin repair is "a new core", and refuses ruined robots.

**Part 2 spec:**

- §5.3: a route step into a robot bumps.
- §2.2 (sensors): `tile ahead is blocked` sees robots.
- §2.6 and §7: `off: 'player'` joins the off reasons, and isn't cleared in the morning ("off means off until morning" covers only `'dizzy'` and `'done'`).

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
- **R25.** A robot still carried at day end is set down on the nearest walkable tile to spawn with no standing robot, not on spawn itself when a robot stands there, so the set-down never makes a shared tile (sections 2.2, 3.1 and 3.2; part 1 §5.7.2). `5a84fd9`.
- **R26.** Robots never take tools: `planRobotAction` blocks a `Take` of any tool item with `itemNotFound`, so a tool never enters a robot's bag and scrapping a robot can't lose the zone marker (section 8). `b6463ac`.
- **R27.** Translation: dropdown fields are saved as strings and number fields as numbers, and the reader takes either for a number; block ids are `b1`, `b2`, … depth first; a block chained under a trigger, helper or declaration is loose; a malformed workspace, a block met twice and nesting too deep to read are "This block isn't part of the robot language." with `blockId` null when there's no id (section 5). `3a16cd5`.
- **R28.** The robot screen's tab strip follows the ARIA tabs pattern: ArrowRight and ArrowLeft step through the visible tabs, wrapping around, and Home and End go to the first and last (section 4.1). `3b0746f`.
- **R29.** Blockly's `FieldDropdown` rejects values outside its cached options, so every data dropdown is a registered `field_fc_*` subclass that accepts and shows any well-formed value (section 4.2). `df75f6b`.
- **R30.** "Make a variable" is a form inside the screen. Changing a declaration's type swaps in that type's default literal and retypes its `INITIAL` socket (which has no fixed check); renaming a declaration or a helper renames its uses (section 4.2). `df75f6b`.
- **R31.** At phone width the toolbox's category column hides behind a **Blocks** button that opens a menu of the categories (section 4.1). `df75f6b`.
- **R32.** Loading a program into the editor is never an edit: it loads with events disabled (on open, Revert or an outside change) and clears Blockly's undo stack, so Ctrl+Z can't replay discarded edits; `onChange` skips Blockly's `BlockFieldIntermediateChange`, so a cancelled field edit isn't an edit (section 4.2). `df75f6b`, `c29756a`.
- **R33.** The Program tab logs an editor load failure to the console before showing its message, since the failure can come from setting the locale, defining blocks, injecting or the first load as well as the import (section 4.2). `c29756a`.
- **R34.** **Add a card** takes only the kind: a DO return starts at the nearest generator at `ROBOT_SCREEN.cardDefaults.returnMinute`, and tokens below starts at `cardDefaults.tokensBelow`. A number that isn't whole leaves the card as it was. Cards reorder within their section (section 4.3). `4ca10ab`.
- **R35.** The main-chunk allowance is the baseline + 16 KB, not + 10 KB: part 3's simulation, rendering and HUD code grew main by 12.8 KB, and no screen or Blockly module is in main, so the screen and editor stay lazy (sections 10.1 and 14). `012e815`.
- **R36.** A chunk with no source map counts as other, with no budget, when it is at most 1 KB gzipped, as bundler runtime helpers are (Rolldown's runtime chunk); it is still scanned by the dist check, and a larger chunk without a map stays a problem (section 10.1). `012e815`.
