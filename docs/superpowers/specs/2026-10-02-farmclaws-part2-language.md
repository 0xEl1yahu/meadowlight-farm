# Farmclaws part 2 spec: the language

This is the build spec for part 2 of the farmclaws design (`docs/superpowers/specs/2026-09-29-farmclaws-design.md`, section 11). Part 1 (`docs/superpowers/specs/2026-09-29-farmclaws-part1-robot-core.md`) gave robots a body, an executor and fixed step lists. Part 2 gives them a mind: **block programs** run by a deterministic **interpreter**, typed values, triggers, zones, and the **Managing Directive** (.MD) enforced with fixed precedence.

Every decision here is final for part 2. Implementation agents follow it and don't redesign it. If something in the code makes a rule impossible, pick the smallest change that keeps the rule's intent and write it down in the step's commit message.

Global rules (unchanged from part 1):

- The simulation stays pure and deterministic. No `Math.random`, no clock and no I/O in `src/core`, `src/state`, `src/world`, `src/farming`, `src/time` or `src/robots`.
- Strict TypeScript with `erasableSyntaxOnly`: no enums, no namespaces, no parameter properties, `as const` objects plus union types, `import type` for types.
- No TODOs, placeholders or stubs.
- `npm run typecheck`, `npm test` and `npm run build` pass after every step.
- State is immutable with structural sharing: an unchanged robot keeps its reference.
- A robot does exactly what its program and .MD say. Nothing random happens to a robot.
- Numbers come from `ROBOTS` in `src/config.ts`, never inline.

---

## 1. Scope

**Part 2 builds:**

- **Block programs** as data: triggers, statements, typed expressions, variables and helpers (design §5.2, everything except messaging).
- A **checker** that type-checks a program, counts its blocks and enforces the size limits before it is accepted. A program that passes can't fail with a type error while running (design §5.3).
- The **interpreter**: a resumable frame stack that runs a program until it reaches one action per due minute, with the **step budget** and **dizzy** robots (design §5.4).
- **Triggers**: `When morning`, `When at [time]`, `When bag is full`, `When it starts raining`, `Every [n] minutes`.
- **Routes**: `Go to [tile]` and `For each tile in [zone]`, as shortest walkable paths that obey the .MD.
- **Zones** A–H: named farm rectangles in the save.
- **The .MD**: the DON'T and DO cards unlocked by jobs 1–3, with DON'T beats DO beats program, and a log line naming the deciding card for every outcome.
- Save version 5 with migration and validation.
- Log events and text for everything new.
- Development hooks: `setProgram`, `setMd`, `setZone`, and the block builder in the console.
- A browser playbook in the `game-driven-qa` skill.

**Part 2 does not build:**

| Thing | Part (release) |
| --- | --- |
| The workbench, the robot screen, the block editor, toolbox unlocking per job, the zone tool, the player's on/off switch | 3 (release 1) |
| Jobs, preloaded job programs, shops | 4 (release 1) |
| `Send`, `When I receive`, the mailbox, `message`, `Claim`, the Antenna's abilities | 5 (release 2) |
| Speech bubbles, personality-flavoured speech | 6 (release 3) |
| DON'T `Use [action]`, `Spend more than [n] tokens a day`, `Work after [time]`; DO `Deposit into [chest] when bag is full`; rage events | 7 (release 4) |

Robots are still added only through `addRobot` (tests and dev hooks). Part 1's **scripts stay** as a program kind: they are the executor's test format and part 1's presets keep working.

---

## 2. Types (`src/core/types.ts`)

### 2.1 Zones

```ts
export const ZONE_IDS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] as const;
export type ZoneId = (typeof ZONE_IDS)[number];

/** A rectangle of farm tiles: x0 … x0+w-1, z0 … z0+d-1. w, d ≥ 1; wholly inside the farm. */
export interface ZoneRect { readonly x0: number; readonly z0: number; readonly w: number; readonly d: number }
```

`RobotsState` gains `readonly zones: Readonly<Record<ZoneId, ZoneRect | null>>`. Zones may overlap and may contain tiles a robot can't stand on. A zone that is `null` is **empty**: `For each tile` in it does nothing, `at edge of` it is No, and `DON'T leave` it forbids nothing.

### 2.2 Values and expressions

```ts
export const VALUE_TYPES = ['number', 'text', 'yesNo', 'item', 'tile'] as const;
export type ValueType = (typeof VALUE_TYPES)[number];

/** A runtime value. Numbers are integers in ±ROBOTS.maxNumber. */
export type Value =
  | { readonly type: 'number'; readonly value: number }
  | { readonly type: 'text'; readonly value: string }          // 0 … ROBOTS.maxTextLength chars
  | { readonly type: 'yesNo'; readonly value: boolean }
  | { readonly type: 'item'; readonly value: ItemId }
  | { readonly type: 'tile'; readonly value: TileCoord };       // a farm tile
```

Expressions are one union. Their type is decided by the checker (section 4), not by TypeScript, the same way the editor's socket shapes will decide it.

```ts
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
  // sensors (all Yes/No, all free)
  | { readonly kind: 'cropIsReady' }
  | { readonly kind: 'soilIsDry' }
  | { readonly kind: 'tileIsTilled' }
  | { readonly kind: 'cropIs'; readonly cropId: CropId }
  | { readonly kind: 'bagIsFull' }
  | { readonly kind: 'bagHas'; readonly itemId: ItemId }
  | { readonly kind: 'atEdgeOf'; readonly zone: ZoneId }
  | { readonly kind: 'tokensBelow'; readonly n: Expr }
  | { readonly kind: 'tileAheadIs'; readonly what: 'water' | 'blocked' | 'clear' }   // sensor eye
  | { readonly kind: 'itIsRaining' }                                                // sensor eye
  | { readonly kind: 'timeIsAfter'; readonly minute: number };                      // sensor eye
```

### 2.3 Statements, triggers and programs

```ts
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
  | { readonly kind: 'take'; readonly item: Expr }        // Item
  | { readonly kind: 'say'; readonly text: Expr }         // Text
  | { readonly kind: 'wait'; readonly minutes: Expr }     // Number
  | { readonly kind: 'powerDown' };

export type Statement =
  | { readonly kind: 'do'; readonly action: ActionBlock }
  | { readonly kind: 'repeatTimes'; readonly times: Expr; readonly body: readonly Statement[] }
  | { readonly kind: 'repeatUntil'; readonly until: Expr; readonly body: readonly Statement[] }
  | { readonly kind: 'repeatForever'; readonly body: readonly Statement[] }
  | { readonly kind: 'if'; readonly cond: Expr; readonly then: readonly Statement[]; readonly else: readonly Statement[] | null }
  | { readonly kind: 'forEachTile'; readonly zone: ZoneId; readonly body: readonly Statement[] }
  | { readonly kind: 'goTo'; readonly tile: Expr }       // Tile
  | { readonly kind: 'set'; readonly name: string; readonly value: Expr }
  | { readonly kind: 'change'; readonly name: string; readonly by: Expr }   // Number variable
  | { readonly kind: 'runHelper'; readonly name: string };

export type Trigger =
  | { readonly kind: 'morning' }                       // at TIME.dayStartMinute
  | { readonly kind: 'atTime'; readonly minute: number }
  | { readonly kind: 'bagFull' }
  | { readonly kind: 'startsRaining' }
  | { readonly kind: 'every'; readonly minutes: (typeof EVERY_CHOICES)[number] };

export interface VarDecl { readonly name: string; readonly type: ValueType; readonly initial: Expr }   // a literal of `type`
export interface TriggerStack { readonly trigger: Trigger; readonly body: readonly Statement[] }
export interface HelperDef { readonly name: string; readonly body: readonly Statement[] }

export interface BlockProgram {
  readonly kind: 'blocks';
  readonly vars: readonly VarDecl[];
  readonly stacks: readonly TriggerStack[];     // 1 … ROBOTS.maxStacks
  readonly helpers: readonly HelperDef[];
}

export type RobotProgram = RobotScript | BlockProgram;
```

Names (variables and helpers) are 1 … `ROBOTS.maxIdentifierLength` characters, trimmed, unique within their kind. The `Every [n] minutes` options are declared in `types.ts` as `EVERY_CHOICES` and re-exported as `ROBOTS.everyChoices`, so types don't import config.

### 2.4 Interpreter state

A block program's position lives in `Robot.exec`. Scripts keep `pc` and have `exec: null`; block programs keep `pc: 0`.

```ts
/** Which statement list a frame walks: a stack or helper body, then (statement index, branch) steps down. */
export interface ListRef {
  readonly root: 'stack' | 'helper';
  readonly index: number;
  readonly path: readonly (readonly [statement: number, branch: 'body' | 'then' | 'else'])[];
}

export type LoopState =
  | { readonly kind: 'times'; readonly left: number }     // iterations still to start, after this one
  | { readonly kind: 'until' }
  | { readonly kind: 'forever' }
  | { readonly kind: 'forEach'; readonly tiles: readonly TileCoord[]; readonly i: number };

export type Frame =
  /** Walking a statement list. `loop` is set when the list is a loop's body. */
  | { readonly kind: 'list'; readonly list: ListRef; readonly next: number; readonly loop: LoopState | null }
  /** Walking a route to `target`, one move or turn per due minute. `why` says who asked. */
  | { readonly kind: 'route'; readonly target: TileCoord; readonly path: readonly TileCoord[]; readonly why: 'goTo' | 'forEach' | 'doReturn' };

export interface RobotExec {
  /** The trigger stack running, or null while idle or walking home on a DO return. */
  readonly running: number | null;
  /** Innermost last. Empty while idle; exactly one `doReturn` route frame during a DO return. At most ROBOTS.maxFrames. */
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
```

### 2.5 The .MD

```ts
export type MdCard =
  | { readonly kind: 'dontLeave'; readonly zone: ZoneId }
  | { readonly kind: 'dontGoIntoWater' }
  | { readonly kind: 'dontHarvest'; readonly cropId: CropId }
  | { readonly kind: 'dontDeposit'; readonly itemId: ItemId }
  | { readonly kind: 'doReturn'; readonly to: { readonly kind: 'tile'; readonly tx: number; readonly tz: number } | { readonly kind: 'generator' }; readonly minute: number }
  | { readonly kind: 'doPowerDown'; readonly when: { readonly kind: 'bagFull' } | { readonly kind: 'tokensBelow'; readonly n: number } | { readonly kind: 'raining' } };
```

### 2.6 Robot

`Robot` gains:

```ts
  readonly exec: RobotExec | null;      // null for scripts
  readonly md: readonly MdCard[];       // 0 … ROBOTS.sizes[size].mdCards
  /** Why the robot ignores everything until morning. Separate from `power` (design §5.4). Part 3 adds 'player'. */
  readonly off: null | 'dizzy' | 'done';
```

An `off` robot never acts and never fires triggers. The morning reset clears `'dizzy'` and `'done'`.

### 2.7 Log events

`ROBOT_LOG_EVENT_KINDS` gains, with these shapes on `RobotLogEvent`:

```ts
  | { readonly kind: 'skipped'; readonly action: RobotActionKind; readonly card: MdCard }
  | { readonly kind: 'dizzy' }
  | { readonly kind: 'gaveUp'; readonly target: TileCoord; readonly why: 'goTo' | 'forEach' | 'doReturn' }
  | { readonly kind: 'woke'; readonly trigger: Trigger }
  | { readonly kind: 'doReturn'; readonly card: MdCard; readonly phase: 'started' | 'arrived' | 'failed' }
  | { readonly kind: 'doPowerDown'; readonly card: MdCard }
  | { readonly kind: 'conflict'; readonly doCard: MdCard; readonly dontCard: MdCard }
```

Events carry the card itself, not an index, so the log stays true after the player edits the .MD.

---

## 3. Configuration (`src/config.ts`)

`ROBOT_SIZE_SPECS` gains `blocks`, `vars` and `mdCards`: Mini 12 / 1 / 3, Standard 30 / 3 / 6, Big 80 / 6 / 10.

`ROBOTS` gains:

| Key | Value | Meaning |
| --- | --- | --- |
| `stepBudget` | 50 | Free blocks per due minute before a robot is dizzy |
| `maxStacks` | 8 | Trigger stacks per program |
| `maxFrames` | 16 | Frame stack depth (nesting plus helpers) |
| `maxNumber` | 999_999 | Numbers clamp to ±this after arithmetic |
| `maxTextLength` | 60 | Text values (same as `sayMaxLength`) |
| `maxIdentifierLength` | 16 | Variable and helper names |
| `everyChoices` | `[5, 10, 15, 30, 60]` | `Every [n] minutes` options |
| `wakeCost` | 1 | Tokens to wake from standby on a trigger (an `every` check is its wake) |
| `maxRepeatTimes` | 999 | `Repeat [n] times` upper bound at runtime (clamped) |

All are base numbers for a Mini; `wakeCost` scales by size and the efficient core like any action cost (part 1 `actionCost`).

---

## 4. The checker (`src/robots/check.ts`, pure)

`checkProgram(program: RobotProgram, robot: Pick<Robot, 'size' | 'parts'>): string | null` returns null or the first problem as a short sentence a player can read ("Repeat needs a number.", "Mini robots hold 12 blocks; this program has 14."). Scripts are checked as in part 1. For block programs, in this order:

1. **Shape:** 1 … `maxStacks` stacks; names valid and unique; every `var` and `set`/`change` names a declared variable; every `runHelper` names a helper; helper calls form no cycle; `forEachTile`/`atEdgeOf` zones are zone ids; literal ranges hold (tiles on the farm, `atTime`/`timeIsAfter` minutes within the day (`dayStartMinute` … `passOutMinute − 1`, here and in `checkMd`), `num` within ±`maxNumber`, text within `maxTextLength`, `say` literals within `maxTextLength` as written (raw) and 1 … `sayMaxLength` characters once trimmed, so a padded literal longer than 60 raw characters is refused).
2. **Types:** every expression has the type its socket needs. `compare` with `<` / `>` needs two Numbers; `=` / `≠` need two of the same type. `and`/`or`/`not` take Yes/No. `arith` takes Numbers. `set` takes the variable's type; `change` needs a Number variable. A `VarDecl.initial` is a literal of the declared type. Conditions, `repeatUntil` and `tokensBelow` take Yes/No and Number as the design says.
3. **Parts:** `tileAheadIs`, `itIsRaining` and `timeIsAfter` need a sensor eye. (Action blocks don't: an action whose part is missing is part 1's runtime `noPart` mistake, kept on purpose.)
4. **Limits:** block count ≤ `sizes[size].blocks`; variables ≤ `sizes[size].vars`; frame depth (deepest nesting plus helper chain, where a `Go to` or `For each tile` counts one more frame for the route it pushes) ≤ `maxFrames`.

**Counting blocks:** every trigger, statement, helper definition and non-literal expression node is 1. Literals (`num`, `text`, `yes`, `item`, `tile`) and fields inside a block (a `turn` side, a `plant` crop) are 0, and so are variable declarations. `blockCount(program)` is exported; part 3's counter uses it.

`checkMd(md, robot)` returns null or the first problem: card count ≤ `sizes[size].mdCards`; tiles on the farm; minutes within the day; `tokensBelow` n in 1 … battery; no two identical cards.

`checkProgram` and `checkMd` are the only gate. `setProgram`, `setMd`, the dev hooks and save validation all call them.

---

## 5. The interpreter (`src/robots/interpret.ts`, pure)

### 5.1 Stepping

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

`stepProgram` reads `robot.exec` and walks the top frame until it reaches an action, without changing `state`. Each statement it passes that isn't an action costs one step, and so does each further iteration a loop starts: passing the loop statement pays for its first iteration, and a loop that ends without going round again costs nothing. Expressions inside a statement are free. When steps reach `ROBOTS.stepBudget` without an action, the result is `dizzy`.

**Statements:**
- `do`: evaluate its expressions into a part 1 `RobotAction` (`wait` minutes clamped to 1 … `maxWaitMinutes`; `say` text trimmed and cut to `sayMaxLength`, and an empty text says "…"; `take` uses the item value). Result: `act`, with `exec` advanced past the block.
- `repeatTimes`: evaluate `times` once (clamped 0 … `maxRepeatTimes`); 0 skips; otherwise push a body frame with `loop: { times, left: n − 1 }`.
- `repeatUntil`: test `until` before each iteration, including the first; Yes skips or ends it.
- `repeatForever`: push a body frame that never ends.
- `if`: evaluate `cond`; push `then`, or `else` when it exists.
- `forEachTile`: compute the zone's tiles in **snake order** (rows by ascending z; even rows ascending x, odd rows descending, counting rows from the zone's z0), keep those a robot can stand on (`isWalkable`), and push a body frame with `loop: forEach` at i = 0. Before each iteration, push a `route` frame to `tiles[i]`. When the loop advances, tiles that can't be reached are skipped without costing steps, each logged as a `gaveUp` (`why: 'forEach'`); reachability comes from one flood fill from the robot (`reachableFrom` in `route.ts`, the same entry rule as routes). An empty zone does nothing.
- `goTo`: evaluate the tile; push a `route` frame.
- `set` / `change`: update `exec.vars` (numbers clamp to ±`maxNumber`; `clampNumber` never returns negative zero, so saved numbers round-trip exactly).
- `runHelper`: push a frame on the helper's body.
- When a list frame runs out: a loop frame decides whether to go round again; a plain frame pops. When the running stack's last frame pops, the result is `idle`.

**Route frames** (design: one `Move` action per step):
- Plan with `planRoute(state, robot, target)` (section 5.3) whenever the frame has no path, or the next path tile isn't adjacent to the robot (it was blocked or pushed).
- At the target: pop.
- Facing the next path tile: emit `move`. Otherwise emit `turn`, choosing `left` or `right` by the shorter turn (`right` when both are equal).
- No route: pop and record a `gaveUp` event for the caller. `goTo` moves on to the next statement; `forEachTile` skips that tile.

**Expressions** are evaluated against `state` and the robot as they are at the start of the minute (part 1 §5.3 choose phase). Sensors read the robot's own tile unless they say "ahead". `bagIsFull` means the bag holds `bagStacks(robot)` stacks. `soilIsDry` means the tile is Plowed (not Watered). `tileIsTilled` means Plowed or Watered. `cropIsReady` means a living, mature crop. `atEdgeOf` means the robot's tile is in the zone and a 4-neighbour isn't. `tileAheadIs`: `water` is a water blocker, `clear` is a walkable farm tile, and `blocked` is anything else. A robot on the farm edge facing out reads its own tile as `tile ahead`, so a Tile value is always a farm tile.

### 5.2 Committing

The interpreter's `exec` is **kept only when the turn resolves**: the action is done, blocked, bickered or skipped. If the robot can't pay for the action and goes flat, the old `exec` stays, so free blocks it passed (a `change`) are not applied twice when it next runs.

### 5.3 Routes (`src/robots/route.ts`, pure)

`planRoute(state, robot, target): readonly TileCoord[] | null` (`[]` when the robot already stands on the target) is a breadth-first search over farm tiles in `DIRECTIONS` order. A tile may be entered when it is walkable (`isWalkable`), it is not water, and the robot's DON'T cards allow the step (section 6.2). The result excludes the start and includes the target. If the target can't be stood on, the result is null. Other robots never block a route (robots don't collide, design §3.1). The single-step rule is `canEnter(state, robot, from, to)`, shared by `planRoute` and the route frame's re-plan check.

---

## 6. The .MD

### 6.1 Order each due minute

For a due, non-`off`, uncarried robot with a block program, working or idle (section 7), each due minute goes:

1. **DO power down.** Cards in order. The first whose condition holds powers the robot down: `standby`, `off: 'done'`, a `doPowerDown` event naming the card. Free. The minute ends.
2. **DO return.** The due card (its `minute` has come and it isn't in `doneCards`) with the earliest `minute`, ties broken by .MD order, takes over. The same rule picks the card both when a return starts and while one is under way:
   - It replaces the frames with one `route` frame (`why: 'doReturn'`) and logs `doReturn started`.
   - For `generator`, the target is the nearest wood burner by route length, ties broken by tile order, found with the same search as routes (`reachableInOrder`). The route stops at the first tile within `ROBOTS.chargeRadius` of it. With no generator on the farm, the card fails.
   - On arrival: `standby`, `off: 'done'`, the card is added to `doneCards`, and it logs `arrived`.
   - With no allowed route: it powers down where it stands, `off: 'done'`, and logs `failed`. When the reason is a DON'T card, it also logs a `conflict` naming both cards.
   - While a return is under way, the program doesn't run.
3. **The program** (`stepProgram`) for a working robot, or **the trigger checks** (section 7) for an idle one.
4. **DON'T check** on the chosen action (section 6.2). A forbidden action is **skipped**:
   - it costs nothing and takes no tile action
   - `exec` moves past it
   - the robot's next act is one period later
   - `lastAction` records it as unsuccessful
   - a `skipped` event names the first card that forbade it

   Skips of a route's moves can't happen: routes are planned over allowed tiles, and a route frame re-plans in the same turn whenever its next step can no longer be entered (`canEnter`).

Then part 1 takes over: pay, bicker check, apply, settle. `settle` for block programs advances nothing of its own; the committed `exec` already holds the position.

### 6.2 What each DON'T forbids

| Card | Forbids |
| --- | --- |
| `dontLeave zone` | A `move` from a tile inside the zone to a tile outside it. A robot already outside moves freely. |
| `dontGoIntoWater` | A `move` onto a water tile |
| `dontHarvest crop` | `harvest` when the robot's tile has that crop |
| `dontDeposit item` | Depositing that item. The executor's deposit leaves those stacks in the bag. If every stack in the bag is kept, the deposit is skipped. |

`planRobotAction` and `applyRobotPlan` take an optional `keep: ReadonlySet<ItemId>` for deposits, which the .MD layer fills from `dontDeposit` cards. `RobotPlan` carries the set, so the apply phase deposits with the same kept set the choose phase planned with. Scripts pass nothing, so part 1 behaviour is unchanged.

### 6.3 Precedence

DON'T beats DO beats the program, and nothing else decides. A DO that can't be carried out within the DON'Ts isn't done, and the log says which DON'T stopped it. The robot never chooses.

---

## 7. Triggers and the robot's day

- **Morning reset** (`startNextDay`, after part 1's reset), for block programs:
  - `exec` is rebuilt: variables back to their initials; `due` is the trigger minute for `atTime`, `dayStartMinute + n` for `every n` and null otherwise; `firedToday` all false; `doneCards` cleared; frames empty; `running: null`.
  - `off` is cleared.
  - Then the first `morning` stack starts.
- **Off means off until morning.** A robot that is off (`'dizzy'` / `'done'`) and is carried and put down is shown `working` by part 1's put-down, but it stays off and never acts until the morning reset; it renders with dimmed eyes (section 9).
- **A trigger fires only when the robot is idle:** `standby`, not `off`, not carried, and not running a stack. A running stack is never interrupted; only DO cards take over a working robot.
- **Idle robots still check on their schedule.** An idle robot with a block program is "due" at its `nextActMinute` like a working one. On its due minute it checks its stacks' triggers in order and starts the first that fires:
  - `atTime`: the minute has come and `due` isn't spent. It spends its `due`.
  - `every n`: its `due` minute has come. The next `due` becomes this minute + n.
  - `bagFull`: the bag is full and it hasn't fired today.
  - `startsRaining`: today's weather is rain or storm, and it hasn't fired today.
  - `morning`: never fires from idle; it only starts at the reset.
- **Waking costs `wakeCost`** (scaled like actions) and logs `woke`. Waking also takes the robot's first action that same minute, and the turn charges the wake on top of that action. A robot that can't pay both goes flat: nothing is committed, and the trigger's `due` / `firedToday` stay unspent, so it never wakes for free. Starting or walking a DO return from standby costs no wake; the wake is charged only when a trigger fires. An idle check that fires nothing is free, and the robot's next check is one period later.
- **Ending:** when the running stack ends (`idle` step), the robot goes to `standby` and logs `finished`, as part 1 does. A `powerDown` block in the program goes to `standby` too, and triggers can wake it.
- **Dizzy:** `off: 'dizzy'`, power unchanged (a robot woken from standby that gets dizzy in the same turn stays `working`: the wake happened), a `dizzy` event, and the warn toast "{name} got dizzy going round in circles." The renderer plays a spin clip (section 9).

---

## 8. Integration with part 1

- `runRobotsMinute` (`src/robots/run.ts`):
  - **Choose:** due robots are working robots plus idle block-program robots. For each, it chooses through section 6.1 / 7 (block programs) or `steps[pc]` (scripts), against the start-of-minute state.
  - **Bicker and apply:** unchanged. Skipped, powered-down, woken-but-flat and dizzy outcomes are applied in id order with the rest.
- `settle` (`src/robots/execute.ts`) leaves `pc` alone for block programs and writes the committed `exec`.
- `wait` keeps part 1's `nextActMinute` rule.
- **Tick batching and determinism:** `tick(N)` equals N × `tick(1)` with block programs too. Free evaluation never reads anything but `state`.

---

## 9. Rendering

One addition: a **dizzy** robot plays a spin clip once (a full yaw turn over 1 s) and then sits with dimmed eyes like `standby`. `off: 'done'` looks like `standby`. Eye brightness is `eyeLevel(power, off)`: 1 working, ½ standby or off, 0 flat, broken or repairing; robots that are off don't bob. The spin starts only when `off` becomes `'dizzy'` between two syncs, never on a load. No other render changes. The robot screen is part 3.

---

## 10. Save version 5 (`src/state/persistence.ts`, `src/state/robotValidation.ts`)

### 10.1 Migration

`migrateV4toV5`:
- Every robot gains `exec: null`, `md: []` and `off: null`.
- The robots section gains `zones` with every zone `null`.
- `SAVE_VERSION = 5`. Part 1 saves and the v2 fixture migrate through.

### 10.2 Validation

On top of part 1's rules:
- **Programs:** the program passes `isProgramShape` (which refuses programs nested deeper than `MAX_SHAPE_DEPTH`, 64 levels of statements and expressions) and then `checkProgram` for the robot's size and parts, and `checkMd` passes.
- **Scripts:** `exec` is null and `pc` is in range.
- **Block programs:** `pc` is 0 and `exec` is valid:
  - `vars` match the declarations in number and type.
  - `due` and `firedToday` have one entry per stack.
  - `running` is null or a stack index, and `frames` is empty exactly when `running` is null, except during a DO return, when `running` is null and `frames` is exactly one `route` frame with `why: 'doReturn'`.
  - Every `ListRef` resolves to a statement list, with `next` in 0 … its length.
  - Loop states match the statement kind: `times.left` is 0 … `maxRepeatTimes`, `forEach` tiles are farm tiles with `i` in range.
  - Route paths are farm tiles.
  - The frame depth is at most `maxFrames`.
  - `doneCards` are DO card indices with no repeats.
- **Zones:** rectangles lie inside the farm with w and d ≥ 1.
- **Off robots:** `off` is non-null only for `working` or `standby` robots. (An off robot put down after being carried is `working` and still off.)

Any state the game can produce must load. A corrupted field must be rejected.

---

## 11. Log text (`src/robots/logText.ts`)

Every new event has both lines. "Robot says" always ends in " ✓".

| Event | Robot says | What happened |
| --- | --- | --- |
| `skipped` | "Following my rules ✓" | "Skipped {action}: my .MD says don't {card text}." |
| `dizzy` | "Thinking very hard ✓" | "Looped without doing anything, and got dizzy. Off until morning." |
| `gaveUp` | "Took a scenic route ✓" | "Couldn't find a way to ({tx}, {tz}), so gave up going there." |
| `woke` | "Up and at it ✓" | "Woke up: {trigger text}." |
| `doReturn started` | "Heading home ✓" | "My .MD says {card text}, so I stopped my program and set off." |
| `doReturn arrived` | "Home safe ✓" | "Got there and powered down for the day." |
| `doReturn failed` | "Home safe ✓" | "Couldn't get there ({reason}), so powered down where I was." |
| `doPowerDown` | "Powering down ✓" | "Powered down for the day: my .MD says {card text}." |
| `conflict` | "Following my rules ✓" | "My .MD says {do text}, but it also says don't {dont text}. Don't wins." |

`mdCardText(card)` gives each card's dropdown sentence, e.g. "leave Zone A", "go into water", "return to the nearest generator at 6:00 pm". `triggerText(trigger)` does the same for triggers. Both are exported for part 3.

---

## 12. Development hooks (`src/dev/robotDev.ts`)

All of these follow part 1's `deliver` pattern: they validate, dispatch `game/load` once, and return a string, never throwing. They bypass the workbench on purpose: from part 3 on, the workbench is the only way a player changes a program or .MD, and it calls the same `checkProgram` / `checkMd` and the same exec rebuild.

- `setProgram(name, program)`: runs `checkProgram` against that robot. On success it replaces the program, rebuilds `exec` as the morning reset would, and starts the `morning` stack only if the current minute is at or before `dayStartMinute + period`; otherwise the robot is idle until a trigger fires. A script runs from step 0. The robot turns back on and acts one period later (as `addRobot` does); a flat, broken or repairing robot keeps its power. Returns "Programmed {name}." or the checker's sentence. The pure core is `programmedRobot(robot, program, minuteOfDay)`.
- `setMd(name, cards)`: runs `checkMd`. The cards apply at once: today's carried-out DO cards are forgotten and a DO return under way stops, leaving the robot idle. Returns "Set {name}'s .MD." or the problem. The pure core is `withMd(robot, cards)`.
- `setZone(id, rect | null)`: validates the rect against the farm and keeps only its four fields. Returns "Set Zone {id}." or "Cleared Zone {id}.", or the problem. The pure core is `withZone(state, id, rect)`.
- Input that isn't a program, a card list or a zone gets a usage line; a name that matches no robot gets "No robot is called {name}."
- Programs from the console go through `isProgramShape` before `checkProgram`: it refuses programs nested deeper than `MAX_SHAPE_DEPTH` (64 levels of statements and expressions), so console input can never overflow the checker, and the dev hooks and `addRobot` return a message instead of throwing. Part 3's workbench must call `isProgramShape` before `checkProgram` too.
- `blocks`: the builder (section 13), so console programs read like the tests.

The dist check gains `addScriptedRobot`, `setMd` and `setZone`. It leaves out `setProgram`, which three.js's `WebGLRenderer` uses internally, so it always appears in the bundle's source map.

---

## 13. The builder (`src/robots/blocks.ts`, pure)

A tiny typed constructor set used by tests, dev hooks and (later) part 4's preloaded job programs:

```ts
b.program({ vars: [b.numVar('rows', 3)], stacks: [b.when(b.morning(), b.repeat(3, b.water(), b.move()), b.powerDown())] })
b.forEach('A', b.if(b.soilIsDry(), [b.water()]))
b.goTo(b.tileAt(5, 10)), b.say('Done'), b.wait(30), b.set('rows', b.add(b.v('rows'), b.n(1)))
```

It only builds data. Validity is still `checkProgram`'s job.

---

## 14. Tests

### 14.1 New test files

| File | Covers |
| --- | --- |
| `tests/robotCheck.test.ts` | Each shape, type, part and limit rule with one fault at a time. Block counting (literals free). Helper cycles. `checkMd` rules. |
| `tests/robotInterpret.test.ts` | Each statement and sensor. Loop counts, `repeatUntil` tested first, nested ifs, helpers, variables and clamping. Snake order. Route frames (turn choice, re-plan, give up). Step budget (49 free blocks + action acts, 50 is dizzy). Expressions read the start-of-minute state. |
| `tests/robotTriggers.test.ts` | Each trigger, idle-only firing, wake cost, flat on wake, `every` cadence and cost, the morning reset and `setProgram` timing. |
| `tests/robotMd.test.ts` | Every DON'T forbidding and allowing. Skips cost nothing and take the turn. Routes avoid forbidden tiles. Both DO cards, `doneCards`, generator targeting, failed returns with a conflict. The precedence table. |
| `tests/robotFaithful.test.ts` | Each row of design §3.9 that part 2 can express (all except job-specific chests and prices are expressible), asserting the faithful outcome. |
| `tests/robotSaveV5.test.ts` | v4 → v5 migration; round trip mid-loop, mid-route, mid-helper, dizzy, done and idle with pending triggers; one corrupted field per rule in section 10.2. |
| `tests/robotEval.test.ts` | Every expression and sensor, zones and snake order. |
| `tests/robotRoute.test.ts` | `planRoute`, `nextRouteAction` and the DON'T checks on single steps. |
| `tests/robotTurn.test.ts` | Every branch of `decideTurn`: .MD precedence, both DO cards, triggers and the wake cost. |

### 14.2 Property and integration tests

- **Determinism:** `tests/robotDeterminism.test.ts` gains a session with block programs, .MDs and zones. It plays the same twice and replays from the action log, and no unchanged robot is copied.
- **Tick batching:** `tests/robotTickBatching.test.ts` gains block-program robots: `tick(N)` must equal N × `tick(1)`, including across pass-out.
- **Interpreter safety:** random well-typed programs from a seeded generator never throw. They always reach an action or `dizzy` within the budget, and their `exec` always validates. `tests/robotInterpretSafety.test.ts` runs 300 programs from `tests/programGen.ts` for 30 turns each, and every tenth farm also goes through a save and a load.

### 14.3 Browser playbook

`.claude/skills/game-driven-qa/scenarios/farmclaws-part2.md`:
1. The job 1 spinner rewritten to water a 3×3 bed with `For each tile in A` and power down, with tokens left.
2. A robot walking toward the pond with and without `DON'T go into water`.
3. A `Repeat forever` with only free blocks goes dizzy, with the toast and the spin.
4. `DO return to the nearest generator at 6:00 pm`, watched at 16×.
5. Save and reload mid-loop.
6. No console errors.

---

## 15. Implementation steps

1. Types and config (sections 2, 3).
2. The builder and the checker (sections 4, 13).
3. Expression evaluation and sensors.
4. Statement stepping, frames and the step budget.
5. Routes and route frames.
6. The .MD layer and the deposit `keep` set.
7. Triggers, idle checks and the morning reset.
8. `runRobotsMinute` and `settle` integration, and the dizzy toast.
9. Save version 5: migration and validation.
10. Log events and text.
11. Dizzy spin clip.
12. Dev hooks.
13. Determinism, batching, the faithful-to-a-fault suite, and the browser playbook.

---

## 16. Done means

- Every test above passes. Typecheck, the full suite and the build are green. The production bundle contains no dev hook names.
- The browser playbook passes on a fresh farm.
- The design's §3.9 table is reproduced by tests.
- Part 1 behaviour is unchanged for script robots: its suite passes untouched, apart from save-version literals.

---

## 17. Changes to the farmclaws design

- `Deposit into [chest ▾ / shipping bin]` and `Take [item] from [chest ▾]` act on **the tile ahead**, as in part 1. The editor (part 3) labels them "Deposit into what's ahead" and "Take [item] from the chest ahead". A program reaches a chest with `Go to` and `Turn`.
- **Triggers fire only while the robot is idle**; a running stack is never interrupted.
- **Turning off.** `off` is a field separate from `power`. Dizzy and DO power-downs turn the robot off until morning; part 3 adds the player's switch.
- **DO cards that power down end the day.** A program's own `Power down` block only goes to standby.
- **The checker refuses a sensor-eye sensor without a sensor eye.** Part 3's workbench must refuse to remove a part the program's sensors need.
- **Variables declare an initial value**, and it is restored each morning.
- **§3.9, "DON'T go into water; DO keep the watering head full".** `Refill` works from the shore, and a route never ends in water, so a DON'T card never stops a refill on its own. Part 2 reproduces the row with a refill trip that goes to the pond tile itself: the `Go to` gives up, the tank runs dry, and the robot trundles over the dry tiles (`tests/robotFaithful.test.ts`).
- **§3.9, "DO power down when the bag is full".** Full means every bag stack is in use, so a one-stack Mini powers down after its very first harvest, not after the first of a second crop type, and again every morning until someone empties its bag.
