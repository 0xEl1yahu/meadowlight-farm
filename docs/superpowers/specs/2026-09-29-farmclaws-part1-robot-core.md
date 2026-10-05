# Farmclaws part 1 spec: robot core

This is the build spec for part 1 of the farmclaws design (`docs/superpowers/specs/2026-09-29-farmclaws-design.md`, section 11). It builds the robots themselves: what they are in state, how they act on the farm, what they cost, how they fail and recover, the farm's token pool and the first generator, their save format and how they look.

Every decision here is final for part 1. Implementation agents follow it and don't redesign it. If something in the code makes a rule impossible, pick the smallest change that keeps the rule's intent and write it down in the step's commit message.

Global rules (from `docs/PLAN-v2.md` section 1 and the farmclaws design section 2):

- The simulation stays pure and deterministic. No `Math.random`, no clock and no I/O in `src/core`, `src/state`, `src/world`, `src/farming`, `src/time` or the new `src/robots`.
- Strict TypeScript with `erasableSyntaxOnly`: no enums, no namespaces, no parameter properties, `as const` objects plus union types, `import type` for types.
- No TODOs, placeholders or stubs.
- `npm run typecheck`, `npm test` and `npm run build` pass after every step (section 10).
- A robot does exactly what its program says. Nothing random happens to a robot.

---

## 1. Scope

**Part 1 builds:**

- Robot state: identity, size, parts, position, bag, water tank, battery, power, program and render counters.
- Programs as **scripts**: a fixed list of robot actions with an optional loop. Part 2 adds block programs next to scripts; scripts stay as the executor's test format.
- The **executor**: one robot action, checked against the same tile rules as the player's own actions, paid in tokens.
- **Minute-by-minute scheduling** inside `time/tick`, with simultaneous resolution and bickering.
- **Mistakes and recovery**: shorting out in water, going flat, blocked actions, fishing out and repairs.
- The **farm log**: structured records of what really happened.
- The **token pool**, overnight recharge, and the **wood burner**.
- Carrying robots (which also stops them), fishing them out, and sending them for repair. Both cost the player: energy to carry, gold to repair.
- Save version 4 with validation and migration.
- **RobotRenderer**: instanced low-poly robots with movement, action clips and state visuals.
- HUD: the token pool next to gold, and toasts for the events the player must see.

**Part 1 does not build** (later parts own these):

| Thing | Part (release) |
| --- | --- |
| Block programs, the interpreter, the step budget, dizzy robots, .MD enforcement | 2 (release 1) |
| The robot screen, the block editor, zones, the .MD editor, the Log tab, the on/off switch | 3 (release 1) |
| Getting a robot in normal play (Sol's starter robot), jobs 1 to 3, NPCs, basic parts and ready-made robots in the shops | 4 (release 1) |
| Messages, mailboxes, triggers, schedules, claims, the supervisor, mechanic and tester | 5 (release 2) |
| Paint, voices, personalities, speech bubbles, quirks, custom and limited-edition robots | 6 (release 3) |
| Rage events, the full .MD card set, steam engine, rain barrel, sun panel | 7 (release 4) |

In part 1, robots enter a game only through `addRobot` (section 3.4). Tests call it, and in development builds `window.__meadowlight.addRobot` calls it (section 8.4). No production code path adds a robot until part 4.

---

## 2. Types (`src/core/types.ts`)

### 2.1 Identifier lists

```ts
export const ROBOT_SIZES = ['mini', 'standard', 'big'] as const;
export type RobotSize = (typeof ROBOT_SIZES)[number];

export const ROBOT_PART_IDS = [
  'claw', 'wateringHead', 'tiller', 'seeder', 'basket', 'antenna', 'sensorEye', 'efficientCore', 'quickCore',
] as const;
export type RobotPartId = (typeof ROBOT_PART_IDS)[number];

export const ROBOT_POWERS = ['working', 'standby', 'flat', 'broken', 'repairing'] as const;
export type RobotPower = (typeof ROBOT_POWERS)[number];
```

`PLACEABLE_ITEM_IDS`, `PLACED_OBJECT_KINDS` and `CRAFTING_RECIPE_IDS` each gain `'woodBurner'` at the end.

**Power** means:
- **`working`**: running its program.
- **`standby`**: its program ended today, and it waits for tomorrow morning. Part 5 adds triggers that wake it.
- **`flat`**: its battery couldn't pay for its next action.
- **`broken`**: it shorted out in water and sits on that water tile.
- **`repairing`**: it's away being repaired and isn't on the map.

Being **carried** is separate from power: `carried: true` means the player is holding it (section 5.8). A carried robot never acts, and it keeps its power, so a broken robot stays broken in your arms. There's no on/off switch in part 1: picking a robot up is how you stop it. Part 3's robot screen adds the switch.

### 2.2 Robot actions

The executor's instruction set. Part 2's interpreter produces these, and part 1's scripts list them.

```ts
export type RobotAction =
  | { readonly kind: 'move' }                                  // one step forward
  | { readonly kind: 'turn'; readonly side: 'left' | 'right' }
  | { readonly kind: 'water' }                                 // own tile
  | { readonly kind: 'harvest' }                               // own tile
  | { readonly kind: 'till' }                                  // own tile
  | { readonly kind: 'plant'; readonly cropId: CropId }        // own tile, one seed from the bag
  | { readonly kind: 'refill' }                                // water tile ahead
  | { readonly kind: 'deposit' }                               // chest or shipping bin ahead
  | { readonly kind: 'take'; readonly itemId: ItemId }         // chest ahead
  | { readonly kind: 'say'; readonly text: string }
  | { readonly kind: 'wait'; readonly minutes: number }
  | { readonly kind: 'powerDown' };
export type RobotActionKind = RobotAction['kind'];
```

**Which tile an action uses:**
- `water`, `harvest`, `till` and `plant` work the tile the robot stands on. This matches the design's `For each tile in zone`, which walks the robot onto each tile.
- `refill`, `deposit` and `take` work the tile ahead. Water, chests and the shipping bin can't be stood on.

**Other rules:**
- `say` text is 1 to 60 characters, trimmed.
- `wait` minutes are an integer from 1 to 240.

### 2.3 Robot

```ts
export interface RobotScript {
  readonly kind: 'script';
  /** 1 … ROBOTS.maxScriptSteps actions. */
  readonly steps: readonly RobotAction[];
  /** After the last step: true starts again at step 0, false goes to standby. */
  readonly loop: boolean;
}
export type RobotProgram = RobotScript;   // part 2 widens this union

export interface RobotPlace { readonly tx: number; readonly tz: number; readonly facing: Direction }

export interface Robot {
  readonly id: number;
  readonly name: string;                     // isValidName rules (1 … 24 chars, trimmed)
  readonly size: RobotSize;
  /** Canonical order (ROBOT_PART_IDS order), no repeats, length ≤ ROBOTS.sizes[size].partSlots. */
  readonly parts: readonly RobotPartId[];
  /** Farm tile it stands on. Robots stay where they finish; nothing brings them back unless a program does. While repairing or carried, the tile it left from. */
  readonly tx: number;
  readonly tz: number;
  readonly facing: Direction;
  /** Stacks in the bag, ≤ bagStacks(robot) of them, each a valid stack. */
  readonly bag: readonly ItemStack[];
  /** Water in the watering head, 0 … ROBOTS.tankCapacity; always 0 without a watering head. */
  readonly tank: number;
  /** 0 … batteryFor(size). */
  readonly tokens: number;
  readonly power: RobotPower;
  /** True while the player holds it (player.carrying === id). */
  readonly carried: boolean;
  readonly program: RobotProgram;
  /** Index of the next script step, 0 … steps.length − 1. */
  readonly pc: number;
  /** The next minute of the day it acts in. */
  readonly nextActMinute: number;
  /** Absolute day it comes back from repair; null unless power is 'repairing'. */
  readonly repairReadyDay: number | null;
  /** Tokens spent today (farm log and job checks read it; reset each morning). */
  readonly tokensToday: number;
  /** Render counters, like PlayerState's. */
  readonly moveSeq: number;
  readonly teleportSeq: number;
  readonly actionSeq: number;
  readonly lastAction: RobotActionEvent | null;
}

export interface RobotActionEvent {
  readonly seq: number;
  readonly kind: RobotActionKind;
  readonly success: boolean;
  /** True when this action was a bicker (success is then false). */
  readonly bickered: boolean;
}
```

### 2.4 The farm log

The log stores facts, never sentences. The UI turns entries into "Robot says" and "What happened" text (section 8.3), so part 6 can change the robot's voice without touching saves.

```ts
export const ROBOT_BLOCK_REASONS = [
  'noPart', 'bumped', 'farmEdge', 'nothingToHarvest', 'bagFull', 'tankEmpty', 'tankFull',
  'notTillable', 'notWaterable', 'noSeed', 'cannotPlant', 'outOfSeason', 'noWaterAhead',
  'nothingAhead', 'bagEmpty', 'containerFull', 'itemNotFound',
] as const;
export type RobotBlockReason = (typeof ROBOT_BLOCK_REASONS)[number];

export type RobotLogEvent =
  | { readonly kind: 'did'; readonly action: RobotActionKind; readonly detail: RobotDidDetail }
  | { readonly kind: 'blocked'; readonly action: RobotActionKind; readonly reason: RobotBlockReason }
  | { readonly kind: 'bickered'; readonly action: RobotActionKind; readonly withIds: readonly number[] }
  | { readonly kind: 'shortedOut' }
  | { readonly kind: 'flat' }
  | { readonly kind: 'finished' }          // script ended, going to standby
  | { readonly kind: 'poweredDown' }
  | { readonly kind: 'repaired' };

export type RobotDidDetail =
  | { readonly kind: 'none' }                                                        // move, turn, wait, refill, say
  | { readonly kind: 'crop'; readonly cropId: CropId; readonly quantity: number; readonly quality: Quality } // harvest
  | { readonly kind: 'planted'; readonly cropId: CropId }
  | { readonly kind: 'items'; readonly into: 'chest' | 'bin' | 'bag'; readonly stacks: number; readonly quantity: number }
  | { readonly kind: 'tile' };                                                       // water, till

export interface RobotLogEntry {
  readonly id: number;
  readonly day: number;
  readonly minute: number;
  readonly robotId: number;
  readonly tx: number;
  readonly tz: number;
  readonly event: RobotLogEvent;
  /** Identical consecutive entries of one robot collapse into one with a count (section 5.6). */
  readonly count: number;
}
```

### 2.5 Placed object and GameState

- A new `PlacedObject` variant: `{ readonly kind: 'woodBurner'; readonly fuel: number }`, where fuel is wood waiting to burn, from 0 to `GENERATORS.woodBurner.hopper`.
- `GameSections` gains:

```ts
export interface RobotsState {
  /** Next robot id, starting at 1. Ids are never reused. */
  readonly nextId: number;
  /** At most ROBOTS.maxRobots, ascending by id. */
  readonly list: readonly Robot[];
  /** The farm's token pool (no cap). */
  readonly pool: number;
  readonly log: { readonly nextId: number; readonly entries: readonly RobotLogEntry[] };
  /** Fuel burned by generators last night, for the farm log and part 7's job 8. */
  readonly lastNightFuel: { readonly wood: number; readonly tokens: number };
}
// GameSections: readonly robots: RobotsState;
```

- `PlayerState` gains `readonly carrying: number | null`, the id of the robot the player holds (section 5.8).
- `SAVE_VERSION = 4`.

---

## 3. Configuration and registries

### 3.1 `src/config.ts`

```ts
export const ROBOTS = {
  maxRobots: 12,
  maxScriptSteps: 80,
  tankCapacity: 20,
  /** A robot acts every this many in-game minutes; the quick core makes it quickCorePeriod. */
  period: 4,
  quickCorePeriod: 3,
  sizes: {
    mini:     { price: 1500,  battery: 80,  bagStacks: 1, partSlots: 1, costMultiplier: 1 },
    standard: { price: 4000,  battery: 200, bagStacks: 3, partSlots: 2, costMultiplier: 2 },
    big:      { price: 10000, battery: 500, bagStacks: 9, partSlots: 3, costMultiplier: 4 },
  },
  basketExtraStacks: 2,
  efficientCoreFactor: 0.75,
  /** Repairs cost this share of the size's price. */
  repairShare: 0.2,
  /** Base token costs (Mini, before the multiplier and the efficient core). */
  cost: {
    move: 1, turn: 1, water: 2, harvest: 3, till: 5, plant: 3,
    refill: 1, deposit: 1, take: 1, say: 1, wait: 0, powerDown: 0,
  },
  logCapacity: 400,
  /** Player energy to pick up (or fish out) a robot. */
  carryEnergy: { mini: 4, standard: 8, big: 16 },
  /** Robots recharge overnight only within this Chebyshev distance of a generator. */
  chargeRadius: 2,
  /** Repaired robots come back to the nearest walkable tile to this one (in front of the shipping bin). */
  repairDropOff: { tx: 9, tz: 6 },
  /** The section 2.2 limits on `say` text and `wait` minutes. */
  sayMaxLength: 60,
  maxWaitMinutes: 240,
} as const;

export const GENERATORS = {
  woodBurner: { hopper: 10, tokensPerWood: 6 },
} as const;
```

`ROBOTS.cost` is typed `satisfies Readonly<Record<RobotActionKind, number>>`.

### 3.2 Which part provides which action

This lives in `src/robots/parts.ts` and is exported as `PART_ACTIONS`:

| Action | Needs |
| --- | --- |
| `move`, `turn`, `say`, `wait`, `powerDown` | built in |
| `harvest`, `deposit`, `take` | `claw` |
| `water`, `refill` | `wateringHead` |
| `till` | `tiller` |
| `plant` | `seeder` |

`basket` adds `ROBOTS.basketExtraStacks` bag stacks. `efficientCore` and `quickCore` change cost and period. `antenna` and `sensorEye` have no effect until parts 2 and 5.

### 3.3 Derived numbers (`src/robots/stats.ts`, pure)

- `batteryFor(size)`, `bagStacks(robot)`, `periodFor(robot)`, `repairCost(robot) = Math.round(price × repairShare)`.
- `actionCost(robot, kind)`:
  - `base = ROBOTS.cost[kind]`
  - if base is 0, the cost is 0
  - otherwise, `max(1, floor(base × costMultiplier × (efficientCore ? 0.75 : 1)))`
- `resumedPower(robot)`: `'broken'` for a broken robot, otherwise `tokens > 0 ? 'working' : 'flat'`. Putting a robot down (5.8) and the morning reset (5.7) both use it.

### 3.4 Creating robots (`src/robots/create.ts`)

```ts
export interface RobotSpec {
  readonly name: string;
  readonly size: RobotSize;
  readonly parts: readonly RobotPartId[];
  /** Where it's delivered. */
  readonly place: RobotPlace;
  readonly program: RobotProgram;
}
/** Adds a robot at `place`, fully charged (not from the pool), working, not carried. */
export function addRobot(state: GameState, spec: RobotSpec): { readonly state: GameState; readonly id: number } | { readonly error: string };
```

`addRobot` rejects the spec, with a readable `error` and no state change, when:
- the farm already holds `maxRobots` robots
- the name is invalid
- parts aren't canonical, repeat, or don't fit the size's slots
- the script is empty, too long or has an invalid action
- the place isn't a walkable, in-bounds farm tile, or is a reserved tile

A robot added mid-day acts first at `minuteOfDay + periodFor(robot)`. A new robot starts with:
- an empty bag
- `tank` full if it has a watering head, else 0
- `pc = 0`
- `tokensToday = 0`
- counters at 0
- `lastAction = null`

### 3.5 Wood burner item and recipe

**Item:** `woodBurner`, a placeable item.
- Name: "Wood Burner"
- Description: "Burns wood overnight and turns it into tokens for your robots. Load it with wood (E)."
- No sell price.
- Colour: `0x8a5a3c`.

**Recipe:** `woodBurner`: 20 stone, 10 wood, 2 copper ore, and it makes 1. It's **not** in the default known recipes. Part 4's job 1 teaches it, and in development `__meadowlight.addRobot` also teaches it (section 8.4).

**Placement:**
- Farm-only, like sprinklers: `isFarmOnlyPlaceable` includes it.
- It blocks movement.
- It's picked up with the pickaxe, and only when `fuel === 0` ("Burn off the wood first.").
- `pickUpTool('woodBurner') === 'pickaxe'`.

---

## 4. The executor (`src/robots/execute.ts`)

### 4.1 Planning an action

```ts
export type RobotPlan =
  | { readonly ok: true; readonly action: RobotAction; readonly target: TileCoord; readonly cost: number }
  | { readonly ok: false; readonly action: RobotAction; readonly target: TileCoord; readonly reason: RobotBlockReason; readonly cost: number };
export function planRobotAction(state: GameState, robot: Robot, action: RobotAction): RobotPlan;
```

A blocked plan carries `target` too: the tile the action would have worked.

`planRobotAction` is pure, and it reads only `state.maps.farm`, `state.time`, `state.shipping` and the robot. `cost` is `actionCost(robot, action.kind)` whether or not the action succeeds, except for `noPart`, which costs 0.

**The tile rules match the player's.** Each rule below is the same condition the player's planner (`src/state/intents.ts`) uses for the matching tool. A parity test (section 9.2) holds them together.

| Action | Target | Succeeds when | Otherwise |
| --- | --- | --- | --- |
| any | — | the robot has the part the action needs (3.2) | `noPart` |
| `move` | tile ahead | in bounds and walkable, **or a water tile** (the robot then shorts out, section 5.4) | out of bounds: `farmEdge`; other blocked tile or non-path object: `bumped` |
| `turn` | own | always | — |
| `water` | own | `tank > 0` and the tile is `Plowed` | tank 0: `tankEmpty`; otherwise `notWaterable` |
| `harvest` | own | the tile's crop is mature and not dead, and the harvest fits the bag | no mature crop: `nothingToHarvest`; no room: `bagFull` |
| `till` | own | the tile is `Unplowed`, has no object and no crop (wild crops block it too) | `notTillable` |
| `plant` | own | a seed of `cropId` is in the bag, the tile is soil with no crop and no object, the crop is a field crop and in season | no seed: `noSeed`; wrong season: `outOfSeason`; anything else: `cannotPlant` |
| `refill` | ahead | the tile ahead is `Blocker.Water` and `tank < tankCapacity` | not water: `noWaterAhead`; full: `tankFull` |
| `deposit` | ahead | ahead is a chest or the shipping bin, the bag isn't empty, and at least one unit moves | nothing there: `nothingAhead`; empty bag: `bagEmpty`; nothing fits the chest, or nothing in the bag is sellable at the shipping bin: `containerFull` |
| `take` | ahead | ahead is a chest holding `itemId`, `itemId` isn't a tool, and at least one unit fits the bag | not a chest: `nothingAhead`; a tool (part 3) or none held: `itemNotFound`; no room: `bagFull` |
| `say`, `wait`, `powerDown` | own | always | — |

**Harvest size and quality** use the player's functions, called on the farm. `harvestQuantity` and `harvestQuality` in `src/state/intents.ts` gain a trailing `mapId: MapId = state.player.mapId` parameter, and robots pass `'farm'`. Both read the tile from `state.maps[mapId]`. The player's results don't change. A robot and the player harvesting the same crop on the same day get the same size and quality.

### 4.2 Applying an action

```ts
export function applyRobotPlan(state: GameState, robotId: number, plan: RobotPlan): GameState;
```

Every plan subtracts `cost` from the robot's tokens and adds it to `tokensToday` (section 5.3 guarantees tokens ≥ cost). The action then advances `pc` (section 5.2) and sets `nextActMinute` (section 5.1). What each successful action does:

| Action | Effect |
| --- | --- |
| `move` | Steps onto the tile ahead, `moveSeq + 1`. Water: shorts out (section 5.4). |
| `turn` | Facing rotates a quarter turn; left is counter-clockwise (North → West). |
| `water` | Tile → `Watered`, `tank − 1`. |
| `harvest` | Crop and quantity into the bag with `addToBag` (below). The tile becomes `harvestedTile(tile)`, extracted unchanged from the reducer's `harvest` (regrowth and fertiliser rules). No toast. |
| `till` | Tile → `Plowed`. |
| `plant` | One seed leaves the bag, and the tile gets `createCropInstance(cropId, absoluteDay)`. |
| `refill` | `tank = tankCapacity`. |
| `deposit` | **Chest:** each bag stack, in bag order, merges into the chest's slots with the same fill order as `addItem` (matching stacks first, then empty slots). What doesn't fit stays in the bag. **Shipping bin:** every stack whose item has a sell price goes to `shipping.pending` with `mergeStacks`, and unsellable stacks stay. |
| `take` | Moves units of `itemId`, lowest quality first then slot order, from the chest into the bag until the bag is full or the chest has none. |
| `say` | Nothing in the world. It's logged. |
| `wait` | `nextActMinute = minute + minutes` instead of the period. |
| `powerDown` | `power = 'standby'`, logged as `poweredDown`. |

**`addToBag(bag, limit, itemId, quantity, quality = 0)`** (`src/robots/bag.ts`) works like `addItem` on a list of stacks that can hold at most `limit` stacks (callers pass `bagStacks(robot)`): top up matching stacks, then open new ones. It returns `{ bag, added }`, the new bag and how many units fit. `harvest` is only planned when the whole quantity fits.

**A blocked plan** changes nothing in the world. It pays its cost, advances `pc` and logs a `blocked` event. A robot never retries a step on its own.

Every applied plan sets `lastAction = { seq: actionSeq + 1, kind, success, bickered }` and `actionSeq + 1`.

---

## 5. Running robots (`src/robots/run.ts`)

### 5.1 The robot clock

- Robots act on a shared rhythm so that identical robots act in the same minute. That's what makes bickering possible.
- Each morning every robot's `nextActMinute = dayStartMinute + periodFor(robot)`, so 6:04 for most robots and 6:03 with a quick core.
- After acting, `nextActMinute = minute + periodFor(robot)`, or `minute + minutes` after a `wait`.
- A robot added mid-day starts at `minuteOfDay + periodFor(robot)`.

### 5.2 Scripts

- The robot runs `steps[pc]`, then `pc + 1`.
- When `pc` passes the last step:
  - with `loop: true`, `pc = 0`
  - with `loop: false`, the robot goes to `standby`, logs `finished`, and `pc = 0` for tomorrow

### 5.3 One minute (`runRobotsMinute(state): GameState`)

Called with `state.time.minuteOfDay` already set to the minute being processed:

1. **Due robots:** every robot that isn't carried, with `power === 'working'` and `nextActMinute <= minute`, in id order.
2. **Choose:** for each due robot, plan its current step against the state at the start of the minute. If `tokens < plan.cost`, the robot doesn't act. It goes `flat` and logs `flat`. `pc` doesn't advance, and the morning reset (5.7) starts the script again from step 0.
3. **Bicker check:** among the chosen plans, successful `harvest`, `water`, `till` and `plant` plans that target the **same tile** bicker. Each of those robots pays its cost, the world doesn't change, `pc` advances, `lastAction` is a failure with `bickered: true`, and each logs `bickered` with the other robots' ids.
4. **Apply:** the remaining plans apply in id order with `applyRobotPlan`. Every remaining plan is **re-planned** just before it applies, against the state as earlier robots this minute left it, at the same cost. So a plan whose target an earlier robot changed sees the change: for example, two robots take from one chest and the second finds it empty. The re-planned result applies, success or blocked.

Only these tile actions bicker. Moves never bicker; since part 3 they bump instead (part 3 spec §3.1): two or more moves into one tile, two robots swapping tiles, or a move into a standing robot that stays put. A bumped robot pays for the move, stays where it is and is dizzy until morning. Robots already sharing a tile in an older save may stay; moving out is never a bump. Deposits and takes on one container happen in id order.

### 5.4 Mistakes

- **Shorting out:** a `move` onto a water tile puts the robot on that tile with `power = 'broken'`. It logs `shortedOut`, and pushes the toast "{name} drove into the water and shorted out." (warn). The bag and tokens stay as they were.
- **Flat:** see 5.3 step 2. It pushes the toast "{name} ran out of power." (warn). A flat robot stays where it stopped until morning.
- **Innocence:** nothing a robot does tells it that anything went wrong. Its speech line (section 8.3) is a success line for every event, including blocked and bickered ones. Only the farm log and toasts carry the truth.

### 5.5 The tick (`src/state/reducer.ts`)

`tick(state, minutes)` now advances one minute at a time:

- for each minute `m` from `minuteOfDay + 1` up to `min(minuteOfDay + whole, passOutMinute − 1)`:
  1. set `time.minuteOfDay = m`
  2. run `runRobotsMinute`
- if the target minute reaches `passOutMinute`, call `startNextDay(state, true)` after the loop, exactly as before

Whether minutes arrive as `tick(120)` or as 120 × `tick(1)`, the result must be identical. A test checks this (section 9.2).

When no robot is due in a minute, `runRobotsMinute` returns its input unchanged. The loop then only rewrites `time`, so an idle farm keeps every other reference.

Robots run only inside `time/tick`. Sleeping (`day/sleep`, or the bed's sleep intent) goes straight to `startNextDay`, so the rest of the day's robot minutes are skipped: going to bed early ends the robots' day too.

### 5.6 The farm log

`logRobotEvent(state, robotId, event)` (`src/robots/log.ts`) appends an entry with the current day, minute and the robot's tile.
- If the **most recent entry for that robot** has an equal event (deep equality) and was logged today (its `day` is the current day), its `count` goes up by one instead. The day, minute and tile stay those of the first entry. A repeat on a new day starts a new entry (part 3).
- The list keeps the newest `ROBOTS.logCapacity` entries.
- At the start of each day, entries older than yesterday are dropped.

### 5.7 Overnight (`startNextDay`)

After the existing map pipeline, and before the morning messages. The toasts these steps raise are pushed in step order after the existing morning messages ("Good morning", then pass-out, shipment, crows, season and weather):

1. **Generators:** every wood burner on the farm, in tile order, burns all its fuel. The pool gains `fuel × tokensPerWood` and fuel becomes 0. `lastNightFuel` records the totals, and if any wood burned, the morning brings the toast "Your wood burners turned {w} wood into {t} tokens." (info).
2. **Set down:** a robot the player was still carrying is set down on the player's spawn tile (`PLAYER.spawn`), or, when a standing robot is there, on the nearest walkable tile to it with no standing robot (part 3), exactly as a put-down (5.8), and `player.carrying` becomes null.
3. **Repairs:** every `repairing` robot whose `repairReadyDay <= absoluteDay` comes back fully charged. It stands on the nearest walkable tile with no standing robot to `ROBOTS.repairDropOff` (the tile in front of the shipping bin), facing South. It becomes `working`, logs `repaired`, and gets the toast "{name} is back from repairs." (success).
4. **Ruin (part 3):** every `broken` robot standing on a water tile (not carried, not on the bench) becomes `ruined`. It logs `ruined` and pushes the warn toast "{name} spent the night in the water and is ruined. Scrap it at the workbench." A robot fished out the same day, or still carried at day end (step 2), is safe.
5. **Recharge:** robots only recharge **near a generator**. In id order, every robot that isn't `broken`, `ruined` or `repairing`, and stands within `ROBOTS.chargeRadius` tiles (Chebyshev distance) of a wood burner, takes `min(battery − tokens, pool)` from the pool.
   - If any robot in range ends below full, the toast "Not enough tokens to fully charge {names}." (warn) appears.
   - If any robot that isn't broken, ruined or repairing was out of range (even a fully charged one), the toast "{names} ended the day away from a generator and didn't recharge." (warn) appears. A robot that came back from repairs this night (step 3) is already charged, so it takes no part in the recharge and is never named.
   - Names are listed in id order.
6. **Reset:** robots **stay where they are**. Nothing moves them home, because they have no home. Every robot that isn't `repairing`, broken ones included:
   - stays on its tile. If that tile isn't walkable any more (weeds or a giant crop grew there overnight), it moves to the nearest walkable farm tile with no standing robot by breadth-first search in `DIRECTIONS` order, with `teleportSeq + 1`. A robot on the workbench stays there (part 3). A broken robot standing in water stays there. Broken robots are reset too so that a broken robot on land never ends up on an unwalkable tile, which the save validator (6.2) rejects.
   - `pc = 0`, `stats.today` zeroed (and `stats.week` when the new day starts a week), `nextActMinute` as in 5.1. Its program starts again from wherever it stands. Part 3 replaced `tokensToday` with `stats.today.tokens` (part 3 spec §6.1).
   - `power = resumedPower(robot)` (3.3): `tokens > 0 ? 'working' : 'flat'`
   - a broken robot on land stays broken where it is until it's sent for a new core; one still in the water was ruined in step 4

### 5.8 Player interactions (`src/state/intents.ts`)

Mistakes cost the player real work. **Carrying** a robot costs energy, and **repairs** cost gold.

`PlayerState` gains `carrying: number | null`, the id of the robot in the player's arms.

**When not carrying**, `planInteraction` checks these **before** everything else on the target tile:

| Target tile holds | Intent | Result |
| --- | --- | --- |
| A robot that isn't repairing (the lowest id, if several), on land or in water | `{ kind: 'pickUpRobot'; robotId }` | Costs `ROBOTS.carryEnergy[size]` energy. The robot becomes `carried`, and `player.carrying = id`. Hint: "Pick up {name}", or "Fish out {name}" for a robot in water. Not enough energy: blocked with "You're too tired to carry {name}." |
| A wood burner, while holding wood | `{ kind: 'fuel' }` | Moves `min(held, hopper − fuel)` wood from the selected stack into the burner. Hint: "Load wood". Full: blocked with "The burner is full." |
| A wood burner, not holding wood | — | Blocked with the reason "{fuel}/10 wood. Load it with wood." |

- Because robots come first, the player can't harvest or use a tile's other interactions while a robot stands on it. The robot has to move, or be carried, off first.
- Picking up a working robot stops it where it is in its program. That's the only way to stop a robot in part 1.
- The player never walks into water, so fishing out always targets the water tile ahead. Fishing out is simply picking up, at the same energy cost.

**While carrying**, `player/useTool` and `player/interact` both plan the carry actions below and nothing else:

| Target tile | Intent | Result |
| --- | --- | --- |
| The shipping bin, carrying a **broken** robot | `{ kind: 'repairRobot' }` | A new core (part 3). Costs `repairCost` gold. The robot becomes `repairing` with `repairReadyDay = absoluteDay + 1`, is no longer carried, and `player.carrying = null`. Toast: "{name} is off for a new core. Back tomorrow." Hint: "Send {name} for a new core · {cost}g". Not enough gold: blocked with "Repairs cost {cost}g." |
| The shipping bin, carrying a **ruined** robot | — | Blocked with "{name} is beyond repair. Scrap it at the workbench." (part 3) |
| The shipping bin, carrying a robot that isn't broken | — | Blocked with "Only broken robots go for repair." |
| A walkable in-bounds tile that isn't reserved and has no standing robot (part 3) | `{ kind: 'putDownRobot' }` | The robot stands there facing the player's facing, `carried = false`, `player.carrying = null`, `teleportSeq + 1`. A broken robot stays broken. Any other robot becomes `working` if it has tokens (else `flat`), keeps its `pc`, and acts next at `minuteOfDay + periodFor(robot)`. Hint: "Put down {name}". |
| A tile with a standing robot | — | Blocked with "There's a robot there." (part 3) |
| Anything else | — | Blocked with "Put {name} down on open ground." |

- While carrying, a step off the farm (a warp) is refused with the toast "Put {name} down before you leave the farm."
- `placementProblem` gains: "There's a robot in the way." when any robot that isn't repairing or carried stands on the target.
- `describeIntent` covers the new kinds.

---

## 6. Save version 4 (`src/state/persistence.ts`, `src/state/robotValidation.ts`)

### 6.1 Migration

`migrateV3toV4` adds these and sets `version: 4`. Nothing else changes.

```
robots: { nextId: 1, list: [], pool: 0, log: { nextId: 0, entries: [] }, lastNightFuel: { wood: 0, tokens: 0 } }
player.carrying: null
```

### 6.2 Validation

`isValidRobotsSection(robots, maps, player)` (`src/state/robotValidation.ts`) joins `isValidGameState` in `persistence.ts`, after `isValidSections`, because it needs the maps and the player. `isValidSections` itself doesn't check robots. It rejects the whole save unless all of these hold:

- `nextId ≥ 1`. Ids are unique, ascending, and in 1 … nextId − 1. The list has at most `maxRobots` robots.
- **Names** are valid. **Size** is known. **Parts** are a canonical subset, no longer than the size's slots.
- **Position:** tx and tz are in farm bounds, and facing is valid.
  - `repairing`: `repairReadyDay` is an integer, and the robot isn't carried.
  - carried: `player.carrying === id`, the player is on the farm, and at most one robot is carried. Its tile isn't checked.
  - otherwise, `broken`: it stands on a `Blocker.Water` tile or a walkable tile, and `repairReadyDay` is null.
  - otherwise: it stands on a walkable farm tile, and `repairReadyDay` is null.
- **Player:** `player.carrying` is null or the id of a robot with `carried: true`.
- **Bag:** at most `bagStacks(robot)` stacks, each `isValidStack(stack, true)`.
- **Tank:** 0 … `tankCapacity`, and 0 without a watering head.
- **Tokens:** 0 … battery. `tokensToday` is a count.
- **Power and carrying:** power is in `ROBOT_POWERS`, and `carried` is a boolean.
- **Program:** a valid script (section 2.2 rules; every `plant.cropId` a crop and every `take.itemId` an item). `pc` is in range.
- **Clock:** `nextActMinute` is in `dayStartMinute … passOutMinute + ROBOTS.maxWaitMinutes` (240).
- **Render counters:** counts. `lastAction` is null, or valid with `seq === actionSeq`.
- **Log:** entries have ids below `log.nextId` and ascending, a valid event (reasons and kinds from their lists), tiles in farm bounds, and `count ≥ 1`. At most `logCapacity` entries.
- **Pool** and `lastNightFuel` values are counts.
- **Wood burners:** tile objects of kind `woodBurner` have `fuel` in 0 … hopper, on the farm only. The validator gets an `OBJECT_FIELDS` entry, and `isValidTile` adds nothing else. The farm-only check is part of `isValidRobotsSection`.

---

## 7. Rendering (`src/render/RobotRenderer.ts`, `src/render/robotGeometry.ts`, `src/render/robotLayout.ts`)

### 7.1 Model

A low-poly, flat-shaded robot built from parts, in the game's existing style (see `objectGeometry.ts`):

- **Body:** a plain box with a trim band, on two treads. (A rounded body is deferred to a later polish pass.)
- **Head:** a smaller box on a short neck, with two emissive eye panels.
- **Arm:** one small two-finger claw on the right side.
- **Part attachments**, each a separate instanced part:
  - claw: the arm is always drawn, and the claw fingers are the `claw` part
  - watering head: a can spout on the back
  - tiller: tines at the front
  - seeder: a hopper on top
  - basket: a side basket
  - antenna: a thin mast with a bead
  - sensor eye: a lens on the forehead
  - efficient core: a green chest light
  - quick core: an orange chest light
- **Size:** Mini stands 0.45 tile tall, Standard 0.6, Big 0.85 and wider (×1.3 body width).
- **Colour:** one default paint, a warm sun-yellow body (`0xf2c14e`) with white trim (`0xf4efe6`) and charcoal treads. Paint arrives in part 6.

### 7.2 Instancing

- One `InstancedMesh` per part, with capacity `ROBOTS.maxRobots`, keyed by robot id through `InstanceSlotMap`. Draw calls are one per part mesh in use.
- Robots are drawn only while the player is on the farm. On other maps the meshes are empty.
- `sync(state, prev)` compares `state.robots.list` by reference, then robot by robot.

### 7.3 Motion

- **A new `moveSeq`** starts a lerp from the current visual position to the new tile centre.
  - duration: `min(0.45 s, 0.8 × period × TIME.realSecondsPerGameMinute / timeScale)`
  - the yaw eases toward the facing
- **A new `teleportSeq`**, a full rebuild, or a robot appearing snaps it into place.
- **Shared tiles:** two or more robots on one tile are spread in id order, centred on the tile and 0.36 tile apart (±0.18 tile for two). The offset runs along a fixed screen axis (the camera's screen-right on the ground), not the robot's own side, so robots stay apart whichever way they face. This is visual only.

### 7.4 Action clips and states

A new `actionSeq` plays a short clip. In part 1 every clip moves the whole body; per-part motion (the claw pinch, the tines jab, the hopper drop) is deferred to a later polish pass.

| Kind | Clip |
| --- | --- |
| `harvest` | A dip and a forward lean |
| `water` | Tilt forward, with 6 blue droplet particles |
| `till` | A dip and a forward lean, with a soil puff |
| `plant` | A small dip and lean |
| `deposit`, `take`, `refill` | Lean toward the target |
| `say` | A head wobble |
| `turn` | Yaw only |
| A failed action | The same clip at half size |
| A bickered action | A sideways shake, and a red "!" badge above the head for 1.5 s |

States, shown continuously:

| Power | Look |
| --- | --- |
| `working` | Eyes lit, gentle idle bob (`idleBob(time, id)` in `robotLayout.ts`: up to 0.015 tile over 1.6 s, out of step between robot ids) |
| `standby` | Eyes dimmed to half, still |
| `flat` | Eyes off, head slumped forward 20° |
| `broken` | Sunk 0.25 tile into the water (absolute, the same at every size), tilted 15°, eyes off, a small spark every 1.2 s |
| `repairing` | Not drawn |
| carried | Drawn in the player's arms, at 0.7 scale, with its power's eyes |

**Carrying:**
- `main.ts` gives RobotRenderer a callback that returns the player's visual position (`player.focus`). The carried robot is drawn 0.9 tile above it, facing the player's yaw.
- PlayerRenderer adds a carry pose (both arms raised, held props hidden) while `player.carrying !== null`, eased like the other stances.

Particles and the badge come from a small instanced pool owned by RobotRenderer. It doesn't touch `EffectsRenderer`.

---

## 8. HUD, input and development hooks

### 8.1 Token pool

- The clock panel shows a bolt icon, the pool, and the word "tokens" under the gold.
- It's hidden while the pool is 0 and the farm has no robots.
- It counts up the same way as gold.
- The bolt icon is generated in `src/ui/icons.ts` like the coin.

### 8.2 Toasts

All new toasts go through `pushMessage`, with the text and tone given in sections 5.4, 5.7 and 5.8.

### 8.3 Log text (`src/robots/logText.ts`, pure)

- `robotSays(entry): string` gives the innocent line, always ending in " ✓". In part 1 it takes no robot argument, because every robot has the same voice. For example:
  - "Moved forward ✓"
  - "Harvested ✓"
  - "Watered ✓"
  - "Deposited ✓"
  - "Resting ✓" (for flat)
  - "Taking a swim ✓" (for shorted out)
  - "Waiting my turn ✓" (for a bicker)

  Part 1 uses one neutral voice. Part 6 swaps in personalities.
- `whatHappened(entry, names: ReadonlyMap<number, string>): string` gives the truth. A harvest names the crop with its quality and a count. For example:
  - "Harvested Silver Parsnip ×2." (the same wording as the player's harvest message)
  - "Bumped into something: nothing moved."
  - "Tried to harvest, but nothing was ready."
  - "Fought {other} over the same tile. Nobody got it."
  - "Drove into the water and shorted out."

  Every event kind and every block reason has a line, and a test checks that.
- The quality prefix ("Silver ", "Gold ") and the "a, b and c" name list are shared helpers in `src/core/text.ts` (`qualityPrefix`, `joinWithAnd`). The reducer's messages, the log text and the overnight toasts all use them.
- Part 3 shows these in the Log tab. In part 1 they're used by the tests and by the development hook `__meadowlight.robotLog()`, which prints the log to the console.

### 8.4 Development hooks (`src/dev/index.ts`, `src/dev/robotDev.ts`)

`src/dev/index.ts` is the development-only entry. `main.ts` imports it dynamically only when `import.meta.env.DEV` is true, so it's left out of production, and calls its `installDevHooks(store)` (`robotDev.ts`'s `installRobotDev`). The hooks' types are declared in `robotDev.ts`, which attaches them with `Object.assign`, rather than on `window.__meadowlight`'s global type, so no hook name reaches the production source maps. It adds to `window.__meadowlight`:

- `addRobot(preset, place?)`:
  - builds a spec from a preset
  - delivers it to the player's forward tile unless `place` is given
  - teaches the wood burner recipe
  - dispatches `game/load` with the resulting state
  - returns "Added {names}." or the `addRobot` error
- `addScriptedRobot(input)`: like `addRobot`, but builds one script robot from `{ steps, parts, name?, size?, loop?, place? }` (defaults: name "Scripty", size `mini`, loop `true`, the player's forward tile). The spec comes from the exported pure `scriptedRobotSpec`; `addRobot` does all the validation, and its error is returned as the string. Input that isn't an object with `steps` and `parts` arrays returns a usage string instead of throwing.
- `robotLog()`: prints the farm log with `console.table` as two columns, "Robot says" (prefixed with the robot's name, day, minute and repeat count) and "What happened".

**Presets:**

| Preset | Size | Parts | Script |
| --- | --- | --- | --- |
| `spinner` | Mini | wateringHead | Turn right, looping forever |
| `waterer` | Mini | wateringHead | Water the robot's own tile and the next 2, then power down |
| `harvester` | Standard | claw, basket | Harvest and move along a row of 6, looping |
| `swimmer` | Mini | claw | Move forward 30 times |
| `pair` | Two Minis | claw | Identical harvest scripts, delivered to one tile (they bicker) |

---

## 9. Tests

### 9.1 New test files

| File | Covers |
| --- | --- |
| `tests/robotExecute.test.ts` | Every action's success and every block reason. Costs with the size multiplier and the efficient core. Part gating. Deposit fill order into chests and the shipping bin. Take order. `addToBag` limits. |
| `tests/robotRun.test.ts` | The shared rhythm. Scripts looping and finishing. Flat robots keep their step. Bickering (both pay, the world unchanged, both logged). Re-planning after an earlier robot changes the target. `wait`. `powerDown`. |
| `tests/robotOvernight.test.ts` | Generator burn and `lastNightFuel`. Recharge only within range of a burner, in id order, with both toasts. Robots staying where they finished, including a tile overgrown by weeds. A carried robot set down at spawn. Repairs returning to the drop-off, charged. Broken robots staying broken. |
| `tests/robotInteract.test.ts` | Picking up robots on land and fishing them out of water, with energy costs and the too-tired block. Putting down: the resumed program, broken robots staying broken, refused tiles. Repair at the shipping bin, with the gold cost and the refusals. Warps refused while carrying. Loading a wood burner. The placement block. Pick-up rules for the burner. |
| `tests/robotSave.test.ts` | v3 → v4 migration (the `save-v2.json` fixture migrates twice). Round trip with robots in every power state. The validator rejecting each rule in 6.2 with one corrupted field at a time. |
| `tests/robotLogText.test.ts` | Every event kind and block reason has both lines. Every "Robot says" line ends in "✓". |

The build also added `tests/robotStats.test.ts` (derived numbers and part gating), `tests/robotHelpers.test.ts` (`harvestedTile`, robot world helpers, bag and chest arithmetic, the farm log), `tests/woodBurner.test.ts` (the burner's recipe, placement, pick-up and save rules), and the section 9.2 files `tests/robotParity.test.ts`, `tests/robotTickBatching.test.ts` and `tests/robotDeterminism.test.ts`.

### 9.2 Property tests

- **Tick batching:** for 50 seeded farms with 1 to 12 random robots and random scripts, `tick(120)` equals 120 × `tick(1)`, compared with `deepEqual`.
- **Parity:** for every tile of a seeded farm, including crafted special cases (wild crops, dead crops, objects, fertilised soil), these pairs agree:
  - a robot's `till` and the player's hoe `till` plan
  - robot `water` and the watering can on `Plowed` tiles
  - robot `harvest` and the scythe's harvest of a mature, living crop

  They must agree on success, and on the harvest's quantity and quality.
- **Determinism:** a new file, `tests/robotDeterminism.test.ts`; `tests/determinism.test.ts` is unchanged.
  - The setup adds three looping robots (watering, harvesting and tilling) through `addRobot` along one farm row, and seeded random sessions mix moves, interactions, tool use, ticks and sleeps.
  - Each session plays twice through a freezing store with identical results, and replaying its recorded actions reproduces it. A render-contract check fails on any robot copied without changing: unchanged robots keep their identity.

### 9.3 Render

`tests/robotRender.test.ts` exercises RobotRenderer's pure helpers in `robotLayout.ts`:
- lerp duration
- shared-tile offsets
- which parts a robot shows
- state poses
- action clips and the idle bob

This follows `objectLayout.test.ts`.

---

## 10. Implementation steps

Each step ends with typecheck, tests and build passing, and one commit.

1. **Types, config, registries.** Section 2 types, section 3 config, part rules and derived numbers, the wood burner item and recipe. `SAVE_VERSION = 4` with migration and validation (section 6), and `createDefaultSections` gains `robots`. Tests: `robotSave`, apart from robots in non-default states, which step 3 adds.
2. **Executor.** `planRobotAction`, `applyRobotPlan` and `addToBag`, the `harvestQuantity`/`harvestQuality` `mapId` parameter, the `harvestedTile` extraction, and `addRobot`. Tests: `robotExecute`, parity.
3. **Running.** `runRobotsMinute`, the minute-by-minute tick, the farm log, mistakes, overnight steps. Tests: `robotRun`, `robotOvernight`, tick batching, the save round trip in every state.
4. **Interactions.** `player.carrying`, the carry intents (pick up, put down, repair) and the burner's `fuel` intent, the warp refusal, the placement block, the burner's pick-up rule, `describeIntent`. Tests: `robotInteract`.
5. **Log text.** `logText.ts`. Tests: `robotLogText`.
6. **Rendering.** `robotGeometry.ts`, `robotLayout.ts`, RobotRenderer (registered in `main.ts` after ObjectRenderer), and the wood burner's geometry in `objectGeometry.ts`. Tests: `robotRender`.
7. **HUD and development hooks.** Token pool, bolt icon, `robotDev.ts`. The robot determinism test (section 9.2).
8. **Review fixes.** An adversarial review of steps 1 to 7 against this spec, then the fixes it finds.

---

## 11. Done means

- Every rule in sections 2 to 8 is built and tested. Typecheck is clean, all tests pass, and the production build succeeds. The determinism check is a new file (section 9.2). Existing tests that pinned the old save version, the old player shape or the list of placed objects and recipes were updated alongside the new files, and nothing else in them changed:
  - save version 4 and `player.carrying` (Task 2): `persistence.test.ts`, `maps.test.ts`, `reducer.test.ts`, `sections.test.ts`, `wild.test.ts`
  - the wood burner (Task 3): `crafting.test.ts`, `tiles.test.ts`, `objectLayout.test.ts`, `placement.test.ts`, `persistence.test.ts`, `renderMaps.test.ts`
  - the shared helpers in `tests/testUtils.ts` gained robot helpers
- The production bundle contains no development hook code (checked by searching `dist/` for `robotLog` and `installRobotDev`).
- **Browser check** on the v2 preview link, in development mode, at 1× and 16× time:
  - add each preset
  - watch the spinner drain and go flat
  - watch the swimmer short out, fish it out (energy), send it for repair at the shipping bin (gold), and see it back the next morning
  - leave a robot away from the burner overnight and see it not recharge
  - pick up a working robot to stop it, and put it down to resume
  - watch the pair bicker
  - load a wood burner, sleep, and see the pool fill and the robots recharge
  - no console errors
  - 60 fps with 12 robots on the farm
- The farmclaws design doc is updated where part 1 changed it. See section 12.

---

## 12. Changes to the farmclaws design

These refine the design. They're applied to `2026-09-29-farmclaws-design.md` in the same commit as this spec:

1. **Robots stay where they finish.** Nothing brings a robot back unless its program does. Each morning its program starts again from wherever it stands (section 5.7).
2. **Robots recharge only near a generator.** A robot that ends the day more than 2 tiles from a generator doesn't recharge. Forgetting to bring robots back costs you.
3. **Own tile or tile ahead.** `water`, `harvest`, `till` and `plant` work the robot's own tile. `refill`, `deposit` and `take` work the tile ahead.
4. **Mistakes cost the player work.** Picking up a robot, including fishing it out of water, costs energy. A broken robot is carried to the shipping bin and sent for repair, which costs 20% of its price. It's back, charged, the next morning in front of the bin.
5. **Carrying is the off switch until part 3.** Picking a robot up stops it, and putting it down resumes it. Part 3's robot screen adds a proper on/off switch.
6. **Save versions go up one per part.** Each part that adds saved fields bumps the version and adds one migration step. The design's section 12 ("Version 4 adds…") becomes that rule.
