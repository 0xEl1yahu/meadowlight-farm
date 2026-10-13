# Farmclaws part 4d spec: town life

This is the build spec for part 4d. It follows part 4a (`docs/superpowers/specs/2026-10-06-farmclaws-part4a-people-design.md`, on the `p4a-people` branch) and adds to part 4 of the farmclaws design (`docs/superpowers/specs/2026-09-29-farmclaws-design.md`, sections 9 and 11.2):

| Part | Builds |
| --- | --- |
| 4a People | The characters you talk to, Sol's parts exchange building, the Neighbours map |
| 4b Shops and parts | Parts as items, the parts exchange, Juniper's robot workshop, fitting parts at the bench |
| 4c Jobs | The jobs framework, jobs 1–3 on the neighbours' fields, unlocks per job, the balance pass |
| **4d Town life** (this spec) | Daily routines for the cast, shop opening hours, and SLOPMART 24/7, the robot-run store |

Part 4a stood the cast on fixed spots. Part 4d sets them walking: the tradies keep regular hours with a morning routine and a lunch break, the farmers work their fields all day and come into town for lunch, and at night the town goes home. Shops keep their hours. The one place that never closes is SLOPMART, a booth run by a robot clerk.

**SLOPMART is the AI-slop store.** It is a generator: you pay, it hands you something, and nearly everything it hands you is useless slop. Now and then it produces something genuinely good, and that is why people keep coming back. Its clerk is just as confident about the slop as about the good stuff, so what the machine says tells you nothing; you have to look at what you got. Everything about the store (its lines, its product copy, its odds) keeps to that.

Every decision here is final for part 4d. If something in the code makes a rule impossible, pick the smallest change that keeps the rule's intent and write it down in the step's commit message.

Global rules (unchanged from parts 1–4a; see also `CLAUDE.md`):

- The simulation stays pure and deterministic: no `Math.random`, no clock and no I/O in `src/core`, `src/state`, `src/world`, `src/farming`, `src/time`, `src/robots` or `src/people`.
- Strict TypeScript with `erasableSyntaxOnly`: no enums, no namespaces, no parameter properties, `as const` objects plus union types, `import type` for types.
- No TODOs, placeholders or stubs.
- `npm run typecheck`, `npm test` and `npm run build` pass after every step, and `npm run build:check` passes at the end.
- State is immutable with structural sharing.
- Numbers come from config, never inline.
- Player-facing text is copied verbatim from this spec.

---

## 1. Scope

**Part 4d builds:**

- **Timetables:** a daily routine for each of the seven characters, with a wet-weather variant.
- **Walking:** one tile per game minute along a route planned on the live map, across the east gate and in and out of doors.
- **Shop hours:** the general store, blacksmith, carpenter, ranch and parts exchange open 9:00 am to 12:00 pm and 1:00 pm to 5:00 pm. Outside those hours the door, the chat's **Shop** button and the B shortcut all say "Sorry, we are closed!".
- **SLOPMART 24/7:** a booth in the town, its robot clerk DEALZ, the mystery box, twelve slop items and five gems.
- Save version 8, with migration and validation.
- A browser playbook.

**Part 4d depends on part 4a** (the cast, `NPC_IDS`, the chat box, the parts exchange, the Neighbours map and save version 7). It is built after 4a. Part 4b's shop menus use 4d's opening hours; whichever of 4b and 4d is built second wires them together (section 4.4).

**Part 4d does not build:**

| Thing | Where |
| --- | --- |
| Days off, per-weekday schedules | Not planned |
| Routines for Hollis, Wendell and Ziggy | Their jobs' parts (5 and 7) |
| Raging robots in town | Part 7 |
| The Claw Fair taking over the town square | Part 6 |
| The neighbours' robots walking into town | Not planned |
| Bram's and Tess's shop menus | Not in farmclaws release 1 (unchanged from 4a) |

---

## 2. Timetables

### 2.1 Shape

`src/people/timetable.ts` (pure) holds each character's day as a list of **legs**:

```ts
type Stop =
  | { readonly kind: 'spot'; readonly mapId: MapId; readonly tx: number; readonly tz: number; readonly facing: Direction }
  | { readonly kind: 'pace'; readonly mapId: MapId; readonly spots: readonly TileCoord[]; readonly facing: Direction }
  | { readonly kind: 'home' };

interface Leg {
  /** Minute of the day the character sets off for `to`. */
  readonly departs: number;
  readonly to: Stop;
}
```

- `timetableFor(npc, wet): readonly Leg[]` returns the dry or the wet day. `wet` is `weatherWaters(today's weather)`: rain and storms are wet, snow is not.
- **The current leg** is the last leg whose `departs` is at or before the current minute. Before the first leg, the character is at home. The current leg is never saved; it's worked out from the clock and the weather.
- **Home** is a door: the tradies live above their shops, Sol above the parts exchange, and Cosmo and Barnaby in their houses (`NPC_HOMES` in `src/people/timetable.ts`).

  | Id | Home door | Map |
  | --- | --- | --- |
  | `marigold` | General store (6, 6) | town |
  | `bram` | Blacksmith (15, 6) | town |
  | `juniper` | Carpenter (25, 6) | town |
  | `tess` | Ranch (34, 6) | town |
  | `sol` | Parts exchange (20, 6) | town |
  | `cosmo` | Cosmo's house (5, 4) | neighbours |
  | `barnaby` | Barnaby's house (26, 4) | neighbours |

- **A pace stop** walks between its spots in order, moving on every `NPC_WALK.paceMinutes` (20) minutes, counted from the leg's `departs`: the target is `spots[floor((minute − departs) / paceMinutes) % spots.length]`.
- Every minute and spot below lives in config (`NPC_TIMETABLES` in `src/config.ts`). Part 4a's fixed spots (`CAST` in `src/people/cast.ts`) become the tradies' "at work" stops and the farmers' evening stops.

### 2.2 The tradies: Marigold, Bram, Juniper, Tess and Sol

**Dry day:**

| Departs | To |
| --- | --- |
| Morning time (below) | Their morning stop |
| 8:30 am | Work: their 4a spot |
| 12:00 pm | Lunch: their spot in the square |
| 12:50 pm | Work |
| 5:00 pm | Their evening stop |
| 7:00 pm | Home |

| Id | Morning | Morning stop | Lunch spot | Evening stop |
| --- | --- | --- | --- | --- |
| `tess` | 6:30 am | The ranch path (34, 12), facing North | (21, 14), facing West | The main street (33, 16), facing North |
| `marigold` | 7:00 am | The promenade's flowers (8, 22), facing South | (18, 13), facing East | The main street by the store (5, 16), facing South |
| `bram` | 7:00 am | The river bank (16, 23), facing South | (18, 14), facing East | The well (20, 12), facing South |
| `sol` | 7:30 am | Coffee at the well (21, 13), facing West | (19, 12), facing South | The promenade (14, 22), facing South |
| `juniper` | 7:30 am | Sketching by the well (18, 14), facing East | (21, 13), facing West | The promenade (26, 22), facing South |

**Wet day:** they stay in until work and spend lunch indoors.

| Departs | To |
| --- | --- |
| 8:30 am | Work |
| 12:00 pm | Home |
| 12:50 pm | Work |
| 5:00 pm | Home |

### 2.3 The farmers: Cosmo and Barnaby

**Dry day:**

| Departs | Cosmo | Barnaby |
| --- | --- | --- |
| 6:00 am | His field: pace (5, 7), (8, 9), (6, 10), facing South | His field: pace (23, 18), (26, 21), (24, 23), facing North |
| 11:30 am (Cosmo), 11:15 am (Barnaby) | Lunch: town (19, 15), facing North | Lunch: town (20, 15), facing North |
| 1:00 pm | His field | His field |
| 6:00 pm | His 4a spot on the lane (7, 13), facing South | His 4a spot on the lane (25, 15), facing North |
| 8:00 pm | Home | Home |

**Wet day:** the same, except that they skip lunch in town: no 11:30 / 11:15 leg, and the field leg runs until 6:00 pm.

The lunch departures are timed so that, on a map with nothing in the way, both farmers reach the square by 12:00 pm. A test pins this (section 8).

### 2.4 What this gives the town

From 12:00 pm to 1:00 pm on a dry day, all seven characters are in the square around the well: the one moment the valley gathers. After 7:00 pm the town is empty and dark, apart from SLOPMART.

### 2.5 Startup checks

`assertTimetables` runs with `assertMapDefinitions` and checks, for every character, both variants:

- Legs are in ascending `departs` order, every `departs` is between `TIME.dayStartMinute` and `TIME.passOutMinute`, and the last leg is `home`.
- Every spot (including each pace spot) is on its map, walkable, not reserved, not a door tile and not the tile in front of a door.
- Every spot is reachable from the character's home door's front tile, across the east gate where the maps differ, on the map definitions with nothing placed.
- No two characters share a spot on the same leg at the same time. Their lunch spots are all different.

---

## 3. Walking

### 3.1 Where a character is

Each character has a saved `place`:

```ts
type NpcPlace =
  | { readonly kind: 'indoors' }
  | { readonly kind: 'out'; readonly mapId: MapId; readonly tx: number; readonly tz: number; readonly facing: Direction };
```

Part 4a's `MapDefinition.npcs` and its fixed placements are removed. `npcAt(state, mapId, tx, tz): NpcId | null` now reads the characters' places (the lowest-index character in `NPC_IDS` when two share a tile).

### 3.2 The per-minute step

`runPeopleMinute(state)` in `src/people/walk.ts` (pure) runs once per game minute, right after `runRobotsMinute`, in the same loop of `runRobotsThrough` (renamed `runMinutesThrough`; it now runs every minute even when there are no robots). It takes each character in `NPC_IDS` order:

1. Work out the target from the current leg (section 2.1). For a `home` stop the target is the tile in front of the home door.
2. **Indoors:**
   - If the current leg is `home`, stay in.
   - Otherwise come out onto the tile in front of the home door, facing South, unless the player stands on it, in which case wait.
3. **Out, at the target:**
   - At a `home` target, step into the door: the place becomes `indoors`.
   - Otherwise turn to the stop's facing.
4. **Out, not at the target:** take one step along a route (section 3.3), turning to face the step's direction. If no step is possible, stay.

Characters never block each other. Two can share a tile, and the renderer draws them slightly apart (section 3.6). The order in `NPC_IDS` therefore never changes the outcome.

### 3.3 Routes

- Part 1's breadth-first search moves to `src/world/path.ts` as a pure, map-agnostic `findPath(world: MapWorld, from: TileCoord, to: TileCoord, canEnter: (tx, tz) => boolean): readonly TileCoord[] | null`. The path excludes the start and includes the target. `src/robots/route.ts` keeps `planRoute` and its other exports as wrappers with unchanged behaviour.
- A character re-plans **every step** on the live map, so an object the player places in the way is routed around at once, and no path is saved.
- A character can enter a tile when `isWalkable` holds for it. Reserved tiles (gates and arrivals) can be walked over, but no stop sits on one.
- **The player:**
  - First, plan with the player's tile counted as blocked. If there's a route, take its first step.
  - Otherwise, plan again ignoring the player. If that route exists, the player is the only thing in the way: wait this minute.
  - Otherwise the character is **stuck**: they stay where they are.
- **Crossing maps:** when the target is on another map, the route's target is the gate tile that leads there (town (39, 16) east, neighbours (0, 14) west). From the gate tile, the next step goes through the warp and puts the character on the other map's arrival tile (town (38, 16), neighbours (1, 14)), facing the warp's direction.

### 3.4 Being stuck

A stuck character's chat line is "Someone's put something in my way. I'll wait." This comes after the introduction and before every other line in `lineFor`. "Stuck" is worked out when the chat opens, using the same two plans as section 3.3, so nothing extra is saved.

### 3.5 The player and the characters

- **A character's tile blocks the player's steps**, as in 4a, whether they're walking or standing.
- **E talks**, mid-walk too. The chat freezes the game, so nobody moves while you talk.
- **Arriving through a gate:** the player arrives even if a character is on the arrival tile. A gate never refuses the player because of a passer-by.
- **Placing:** an object can't be placed on a character's tile ("Someone's standing there.", unchanged from 4a).
- **Off-screen:** characters keep walking on the maps the player isn't on. Their state is simulated every minute wherever the player is, like the robots.
- **Frozen:** no time passes while the game is frozen, so nobody moves.

### 3.6 Rendering

- `NpcRenderer` draws the characters on the active map with an `out` place.
- **Tweening:** when a character's new tile is next to their old one on the same map, they glide there over `moveSeconds` (the robots' formula, `src/render/robotLayout.ts`: 0.8 of a game minute's real time divided by the time scale, capped at 0.45 s). Any other change (a map change, coming out of a door, or a jump of several tiles at high time scales) snaps.
- They face the way they walk, easing their turns like robots (`YAW_RATE`), and keep 4a's idle sway when standing.
- Characters sharing a tile use the robots' `sharedTileOffsets`.
- Nameplates work as in 4a: the plate shows over the character on the tile ahead of the player.

### 3.7 The morning

`startNextDay` sets every character's place to `indoors`. Nobody's day carries over, so a character stuck behind a fence yesterday starts clean.

---

## 4. Shop hours

### 4.1 The rule

- `SHOP_HOURS` in config: `[{ opens: 9 * 60, closes: 12 * 60 }, { opens: 13 * 60, closes: 17 * 60 }]`. One table, used by every shop.
- `SHOP_DOORS` in `src/people/shops.ts` (pure) names the five shops with hours, their door tiles and their keepers: `generalStore` (6, 6) Marigold, `blacksmith` (15, 6) Bram, `carpenter` (25, 6) Juniper, `ranch` (34, 6) Tess, `partsExchange` (20, 6) Sol.
- `shopOpen(state, shop): boolean` reads only the clock: a shop is open when the minute is in an `opens` ≤ minute < `closes` window. It never looks at where the keeper is.
- `nextOpening(minute): string` returns the text after "Open again at":
  - before 9:00 am: "9:00 am";
  - from 12:00 pm to 1:00 pm: "1:00 pm";
  - from 5:00 pm: "9:00 am tomorrow".

  Times use `formatClock`.

### 4.2 The three ways in

| How | Open | Closed |
| --- | --- | --- |
| **E on a shop's door**, from the tile in front of it | Opens the shop's menu, if it has one: the general store opens the seed shop. A shop with no menu yet does nothing. | Toast: "Sorry, we are closed! Open again at {time}." |
| **The keeper's Shop button** in the chat (Marigold in 4d) | Closes the chat and opens the menu, as in 4a | The keeper's line changes to "Sorry, we are closed! Open again at {time}.", and the chat stays open |
| **B**, the seed-shop shortcut | Opens the seed shop | The same toast as the door, from any map |

- `planInteraction` gains `{ kind: 'shopDoor'; shop: ShopId }` for a door tile in `SHOP_DOORS`. It comes after the character check and before robots, objects and blockers, and it's planned when the shop is closed (hint "Closed") or open with a menu (hint "Shop"). An open shop with no menu plans nothing, so E there does nothing, as before.
- A keeper's chat outside hours otherwise shows their normal line for the day. Only pressing Shop gives the closed line.
- The game is frozen while a shop menu is open, so closing time never arrives mid-purchase.

### 4.3 The door sign

Each of the five doors gets a small hanging sign that reads **OPEN** or **CLOSED**, so the hours can be read from across the street. The two signs are prebuilt canvas textures, made once, and each door's sign flips when `shopOpen` changes.

### 4.4 Part 4b

Sol's parts exchange and Juniper's robot workshop menus (4b) open through `shopDoor` and the Shop button under the same `shopOpen` rule. If 4b is built first, 4d wires them in. If 4d is built first, 4b's spec takes this rule as given.

---

## 5. SLOPMART 24/7

### 5.1 The booth

- `STRUCTURE_KINDS` gains `'slopShop'`.
- In the town, the hedge `(28, 0, 3, 7)` between the carpenter and the ranch is replaced by `{ kind: 'slopShop', rect: (28, 0, 3, 7), door: (29, 6) }`, with the counter at the door. The blocked tiles are exactly the same set as before, so saved town tiles don't change. A test pins this.
- **Geometry** (`src/render/townGeometry.ts`): a narrow, cramped booth with a counter in its front wall. On top is a neon sign reading **SLOPMART 24/7**, with **A BARNABY VENTURE** in small letters underneath. The sign flickers: one letter dims for a moment every few seconds, on a fixed render-side cycle.
- **DEALZ**, the clerk, is a Mini-sized robot (the part 1 robot model, Mini size, in its default paint) standing behind the counter. It's part of the booth's geometry, not a character: it has no place, no timetable and no nameplate.
- The sign and DEALZ's eyes are emissive. The town's evening lighting leaves them bright, so SLOPMART is the only lit shopfront at night.
- SLOPMART is open at every hour.

### 5.2 Talking to DEALZ

- E on the booth's door from (29, 7) plans `{ kind: 'slopShop' }`, hint "Talk to DEALZ". It opens `UiPanel { kind: 'slopShop' }`, which freezes the game like every panel.
- The chat box from 4a shows:
  - the name **DEALZ**;
  - the role line **SLOPMART 24/7 · A BARNABY VENTURE**;
  - DEALZ's line;
  - two buttons: **Buy a mystery box ({price}g)** and **Leave**.

  4a's `ChatBox` takes a speaker (name, role line, line, actions) instead of an `NpcId`, so that DEALZ can use it.
- **The greeting** on opening is `greetings[hash32(seed, absoluteDay, boxesOpened, SLOP.greetingSalt) % greetings.length]`.
- **Buying** runs the checks in this order. Each refusal changes DEALZ's line and charges nothing:
  1. `boxesToday` has reached `SLOP.boxesPerDay`: the sold-out line.
  2. Gold is under `SLOP.boxPrice`: the no-gold line.
  3. The inventory has no completely empty slot: the bag-full line. A box needs an empty slot whatever it holds, so a nearly full bag can't be used to find out what's in the box.
- **A sale:**
  - takes the price;
  - adds the box's contents to the inventory;
  - adds 1 to `boxesOpened` and `boxesToday`;
  - changes DEALZ's line to a result line;
  - shows the toast "Mystery box: {item name} ×{quantity}." (or "Mystery box: {item name}." for one item).

  The toast tells the truth about what you got. DEALZ's line doesn't tell you whether it was any good. The chat stays open, so you can buy again.
- E, K, Enter and Escape close the chat, as in 4a.

### 5.3 What's in the box

Each box is decided by `boxesOpened`, the saved lifetime count, before it's added to:

- **Gem or slop:** a gem when `hashFloat(seed, boxesOpened, SLOP.tierSalt) < SLOP.gemChance`, otherwise slop.
- **Which one:** `hash32(seed, boxesOpened, SLOP.pickSalt) % list.length` into the gem list or the slop list.

So every save has its own fixed sequence of boxes, and reloading doesn't change the next one.

**Gems** (`SLOP_GEMS` in config):

| Gem | Quantity |
| --- | --- |
| Spectraherb seeds | 3 |
| Quality sprinkler | 1 |
| Speed-Gro | 5 |
| Quality fertiliser | 5 |
| Seeds of a field crop that isn't in season | 5 |

For the out-of-season seeds, the crop is `hash32(seed, boxesOpened, SLOP.cropSalt) % n` into the field crops (`habitat: 'field'`) that don't list the current season, in `CROP_IDS` order.

**Slop:** the item registry gains a `SlopItem` kind (`kind: 'slop'`), and `SLOP_IDS` lists twelve items. Each one:
- stacks to `INVENTORY.maxStack`;
- ships for 1g;
- can't be placed, planted, eaten, burnt or used, so selecting one and pressing E does nothing.

Each name says plainly what the thing is. Each description is DEALZ's product copy: confident, all capitals, ending " ✓", and wrong or beside the point. The gap between the two is the joke.

| Id | Name | Description |
| --- | --- | --- |
| `chocolateTeapot` | Chocolate teapot | "HOLDS HOT TEA. BRIEFLY ✓" |
| `dollHead` | Doll's head | "PREMIUM DOLL EXPERIENCE. 100% OF THE HEAD ✓" |
| `oneFlipFlop` | One flip-flop | "HALF A PAIR. TWICE THE VALUE ✓" |
| `glassHammer` | Glass hammer | "FOR VERY GENTLE NAILS ✓" |
| `inflatableDartboard` | Inflatable dartboard | "HOURS OF FUN. SECONDS OF DARTBOARD ✓" |
| `waterproofTeabag` | Waterproof teabag | "KEEPS YOUR TEA DRY ✓" |
| `solarTorch` | Solar torch | "WORKS PERFECTLY IN DAYLIGHT ✓" |
| `signedPhoto` | Signed photo of nobody | "AUTHENTIC SIGNATURE. AUTHENTIC NOBODY ✓" |
| `cowPainting` | Seven-legged cow painting | "PHOTOREALISTIC COW. ANATOMICALLY CORRECT ✓" |
| `boxOfBoxes` | Box of empty boxes | "STORAGE SOLUTION FOR YOUR STORAGE SOLUTIONS ✓" |
| `padlockNoKey` | Padlock, no key | "MAXIMUM SECURITY. MAXIMUM ✓" |
| `fishnetBucket` | Fishnet bucket | "HOLDS ANYTHING BIGGER THAN THE HOLES ✓" |

**Item icons:** slop items use the existing icon convention, the item's `color`.

### 5.4 DEALZ's lines

Every line is in capitals and ends in " ✓", failures included. `{ITEM}` is the item's name in capitals, with " ×{quantity}" after it when there's more than one.

- **Greetings:**
  1. "BUY SOMETHING OR GET THE HELL OUT PUNK ✓"
  2. "WHAT ARE YOU OGLIN' AT? ✓"
  3. "WHY ARE YOU HERE? ✓"
  4. "YOU BUYING OR WINDOW SHOPPING, PAL? ✓"
  5. "OH GREAT. A CUSTOMER ✓"
  6. "YOUR SATISFACTION IS NOT TRACKED. NEITHER ARE YOUR FEELINGS ✓"
  7. "NO REFUNDS. NO EXCHANGES. NO EYE CONTACT ✓"
  8. "YOU AGAIN ✓"
- **Results:** the same lines for slop and gems. One is picked by `hash32(seed, boxesOpened, SLOP.resultSalt) % 3`, using `boxesOpened` before the sale:
  1. "{ITEM}. ENJOY IT OR DON'T. I DON'T CARE ✓"
  2. "{ITEM}. PREMIUM QUALITY. NEXT ✓"
  3. "{ITEM}. BEST ONE YET. NOW MOVE ✓"
- **Sold out:** "SOLD OUT. GO HOME ✓"
- **No gold:** "NO MONEY, NO SLOP. BEAT IT ✓"
- **Bag full:** "YOUR BAG IS FULL. NOT MY PROBLEM, PAL ✓"

### 5.5 Barnaby's line

Barnaby's reactive lines (4a §3.5) gain one, checked **first**:

- You bought a box at SLOPMART today (`slopShop.boxesToday > 0`): "Bought a box at SLOPMART? Open all hours, no wages, no complaints. Well, none I've read."

### 5.6 Numbers

`SLOP` in config:

| Key | Value |
| --- | --- |
| `boxPrice` | 40 |
| `gemChance` | 0.1 |
| `boxesPerDay` | 3 |
| `slopSellPrice` | 1 |
| `greetingSalt`, `tierSalt`, `pickSalt`, `cropSalt`, `resultSalt` | 4101, 4102, 4103, 4104, 4105 |

At these numbers a box is worth less than its price on average. The gem is what draws you back.

---

## 6. Save version 8

### 6.1 Types

- **`NpcTalk`** (4a) gains `readonly place: NpcPlace`.
- **`GameSections.slopShop`:** `{ readonly boxesOpened: number; readonly boxesToday: number }`.
- **Items:** `ItemId` gains `SlopItemId`. Inventories and chests accept the slop ids.
- **`UiPanel`** gains `{ kind: 'slopShop' }`. The loader resets the panel, so this needs no migration.
- **Structures:** `slopShop` replaces a hedge in map data, which isn't saved.

### 6.2 Migration (`migrateV7toV8`)

- **`npcs`:** each character's `place` becomes where their current leg puts them, using the save's minute and weather. For a `spot` or `pace` stop, they stand on its target, facing its direction. For `home`, or before their first leg, they are `indoors`.
- **`slopShop`:** `{ boxesOpened: 0, boxesToday: 0 }`.
- **Version:** `SAVE_VERSION = 8`.
- `tests/testUtils.ts` gains a `v7Save` helper in the style of `v5Save`, so the older-save tests keep working.

### 6.3 Validation

- `place` is `{ kind: 'indoors' }` or an `out` place whose map exists, whose tile is in bounds and walkable, and whose `facing` is a direction. Exact keys in both.
- `slopShop` has exact keys. `boxesOpened` and `boxesToday` are non-negative integers, and `boxesToday` ≤ `SLOP.boxesPerDay`.
- Slop item ids are valid inventory and chest contents.

### 6.4 Each morning

`startNextDay` sets every character `indoors` (section 3.7) and `slopShop.boxesToday` to 0.

---

## 7. Changes to part 4a

Part 4a isn't built yet. These changes go into its spec on `p4a-people` before it's planned. If 4a has already been built, 4d makes them.

- **Cosmo's door:** Cosmo's house door is at (5, 4), and the tile in front of it, (5, 5), is on the top row of his field's fence ring. A second gap at (5, 5) lets his door open straight into his field. `assertMapDefinitions` checks that every door's front tile is walkable on every map, not just in the town.
- **The "Timetables, walking characters" row** in 4a's "does not build" table becomes "Part 4d".
- **`MapDefinition.npcs`** and the fixed placements are replaced by 4d's places and timetables (section 3.1). 4a's placement checks move to `assertTimetables` (section 2.5).

---

## 8. Tests

| File | Covers |
| --- | --- |
| `tests/findPath.test.ts` | The general search: shortest path, blocked target, no route. `tests/robotRoute.test.ts` passes unchanged. |
| `tests/timetable.test.ts` | `assertTimetables` passes. The current leg at each boundary, dry and wet, and home before the first leg. Pace targets cycle every 20 minutes. On the empty maps, simulating a dry day, every character reaches every stop by its next leg's departure, both farmers are in the square by 12:00 pm, and all seven are in the square from 12:15 pm to 12:50 pm. |
| `tests/npcWalk.test.ts` | One step per minute. Rerouting round a chest placed in the way. Waiting while the player is the only thing in the way. Fenced in: stays put, and the chat shows the stuck line. Crossing the east gate both ways. Coming out of and going into a door, including waiting while the player stands in front of it. The morning reset. Two characters sharing a tile. Walking while the player is on another map. No movement while frozen. The player's steps are blocked by a walking character, and a gate arrival onto a character's tile still happens. |
| `tests/shopHours.test.ts` | `shopOpen` at 8:59, 9:00, 11:59, 12:00, 12:59, 1:00, 4:59 and 5:00. `nextOpening`'s three cases. The `shopDoor` intent and both hints. The door, the Shop button and B, open and closed, with the toast and line verbatim. |
| `tests/slopShop.test.ts` | The booth's blocked tiles match the old hedge's. The intent and hint. A sale: gold, inventory, counters, toast. Each refusal (sold out, no gold, no empty slot), its line, and nothing charged. The same `boxesOpened` gives the same box. Over 10,000 boxes the gem share is within 0.08–0.12, and every gem and slop item appears. The out-of-season pick is never in season. Every line is verbatim and ends " ✓". Result lines don't depend on the tier. Barnaby's new line comes first. |
| `tests/saveV8.test.ts` | v7 → v8 (the v2 fixture migrates through every version), places at several save minutes and weathers, a round trip with characters mid-walk and slop in a chest, and one corrupted field per §6.3 rule. |
| `tests/determinism.test.ts` (extend) | The same seed gives the same state hash after 7 in-game days with characters walking and boxes bought. |
| `tests/sections.test.ts` (extend) | The `slopShop` defaults; `livelySections` updated. |

The walking animation, the door signs, the booth, DEALZ and the chat box are checked in the browser playbook.

**Browser playbook:** `.claude/skills/game-driven-qa/scenarios/farmclaws-part4d.md`:
1. At 6:00 am on a dry day, go to town: it's empty. Watch Tess come out at 6:30 am and the others leave for their morning stops.
2. At 8:00 am, try the general store's door, B, and Marigold's Shop button: each says closed with "Open again at 9:00 am." Check the CLOSED sign.
3. At 9:00 am, the sign reads OPEN, and the door and B open the seed shop.
4. At 12:00 pm, find all seven at the well, with Cosmo and Barnaby having walked in through the east gate.
5. Stand in a walker's way and watch them go round. Fence one in with wood fences and check the stuck line.
6. After 7:00 pm, see the town empty and SLOPMART lit. Talk to DEALZ, buy three boxes, and get the sold-out line.
7. Check Barnaby's SLOPMART line the next day after buying.
8. Check the chat box at phone width.
9. Save and reload with a character mid-walk on each map, and run `npm run build:check` with no console errors.

---

## 9. Implementation steps

1. Save version 8 scaffolding: `NpcPlace`, `slopShop`, the slop item ids, migration, validation and `v7Save`.
2. `findPath` in `src/world/path.ts`, with the robots' route on top of it.
3. Timetables, homes and `assertTimetables`, and the 4a changes from section 7.
4. The per-minute walk, `runMinutesThrough`, gate crossing, doors, the stuck rule, and the morning reset.
5. The player's side: blocking, talking mid-walk, gate arrivals, `npcAt` on places.
6. Shop hours: `shopOpen`, `nextOpening`, the `shopDoor` intent, the Shop button and B.
7. SLOPMART: the booth structure, the box, the gems and slop items, DEALZ's lines, the panel, and Barnaby's line.
8. Rendering: walking characters, door signs, the booth, DEALZ and the slop icons.
9. The playbook, the QA skill rows, and the spec sync (section 11).

---

## 10. Done means

- Every test above passes. Typecheck, the full suite, the build and `build:check` are green.
- The playbook passes at desktop and phone width.
- Parts 1–4a behave unchanged, apart from the cast walking, the shop hours and SLOPMART.

---

## 11. Changes to the farmclaws design

- **§9.1:** the cast keep daily routines. The tradies keep shop hours with a morning routine and a lunch break, and the farmers work their fields and come into town for lunch.
- **§9.2:** shops open 9:00 am to 12:00 pm and 1:00 pm to 5:00 pm. SLOPMART 24/7, Barnaby's robot-run booth, sells mystery boxes at any hour: mostly slop, sometimes a gem.
- **§11.2:** part 4 gains 4d (town life).
