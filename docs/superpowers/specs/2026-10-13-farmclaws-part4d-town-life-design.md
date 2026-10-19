# Farmclaws part 4d spec: town life

This is the build spec for part 4d, which comes after part 4 and before part 5 (`docs/superpowers/specs/2026-09-29-farmclaws-design.md`, §11.2). It builds on the parts already in the game:

| Part | Built |
| --- | --- |
| 4a People | The cast on fixed spots, talking and the chat box, Sol's parts exchange, the Neighbours map |
| 4b Shops and parts | Parts as items, Sol's parts shop, Juniper's workshop, daily stock, FarmClaw posters at Sol's and Juniper's |
| 4c Jobs | Jobs 1–3, shop gates, the neighbours' robots and generators on the Neighbours map |
| **4d Town life** (this spec) | The cast's daily routines, six townsfolk, shop opening hours, SLOPMART 24/7, the town's props and brand posters, and Cosmo's chickens |

Until now the valley has stood still: everyone on one tile, all day, every day. Part 4d sets it moving. The tradies keep shop hours with a morning routine and a lunch break. The farmers work beside their fields and walk into town for lunch. Six townsfolk walk their own short loops. At night the town goes home, and the one place still lit is SLOPMART, a booth run by a robot.

**SLOPMART is the AI-slop store.** It is a generator: you pay, it hands you something, and nearly everything it hands you is useless slop. Now and then it produces something genuinely good, and that is why people keep coming back. Its clerk is just as confident about the slop as about the good stuff, so what the machine says tells you nothing; you have to look at what you got. Everything about the store (its lines, its product copy, its odds) keeps to that.

Every decision here is final for part 4d. If something in the code makes a rule impossible, pick the smallest change that keeps the rule's intent and record it as a plan refinement.

Global rules (unchanged; see also `CLAUDE.md`):

- The simulation stays pure and deterministic: no `Math.random`, no clock and no I/O in `src/core`, `src/state`, `src/world`, `src/farming`, `src/time`, `src/robots`, `src/jobs` or `src/people`.
- Strict TypeScript with `erasableSyntaxOnly`: no enums, no namespaces, no parameter properties, `as const` objects plus union types, `import type` for types.
- No TODOs, placeholders or stubs.
- `npm run typecheck`, `npm test` and `npm run build` pass after every step, and `npm run build:check` passes at the end.
- State is immutable with structural sharing.
- Numbers and tiles come from config or map data, never inline.
- Player-facing text is copied verbatim from this spec.
- **Bundle:** the walking, timetables and line banks live in the main chunk, because the simulation needs them; SLOPMART's panel goes in 4b's lazy shops chunk. The main chunk's allowance may grow by at most 13 KiB (8 KiB, then 5 KiB more for the posters, signs, neon and chickens), recorded as plan refinements.

---

## 1. Scope

**Part 4d builds:**

- **The cast's routines:** a daily timetable for each of the seven characters, with a wet-weather variant (§2).
- **Six townsfolk:** anonymous types with short loops and a line each day (§3).
- **Walking:** one tile per game minute along a route planned on the live map, across the east gate, and in and out of doors and the town's south exits (§4).
- **Shop hours:** behind 4c's gates, for the doors, the chat buttons and B (§5).
- **SLOPMART 24/7:** a booth, its robot clerk DEALZ, the mystery box, twelve slop items and five gems (§6).
- **The town's props and posters,** and Cosmo's chickens (§7).
- **Fixes to the built game:** Cosmo's door opens onto his fence (§8).
- Save version 10, with migration and validation (§9).
- A short browser playbook.

**Part 4d does not build:**

| Thing | Where |
| --- | --- |
| Days off, per-weekday schedules | Not planned |
| A working market (stalls that sell) | Not planned: the stalls are scenery |
| Routines for Hollis, Wendell and Ziggy | Their jobs' parts (5 and 7) |
| Raging robots in town | Part 7 |
| The Claw Fair taking over the square | Part 6 |
| Berlioz's and Tallulah's shop menus | Not in farmclaws release 1 (unchanged) |
| Better lighting, shadows and night bloom | 4e Graphics pass |

---

## 2. The cast's routines

### 2.1 Shape

`src/people/timetable.ts` (pure) holds each walker's day as a list of **legs**. A leg says when the walker sets off and where to:

```ts
type Stop =
  | { readonly kind: 'spot'; readonly mapId: MapId; readonly tx: number; readonly tz: number; readonly facing: Direction }
  | { readonly kind: 'pace'; readonly mapId: MapId; readonly spots: readonly TileCoord[]; readonly facing: Direction | null; readonly everyMinutes: number }
  | { readonly kind: 'home' };

interface Leg {
  readonly departs: number; // minute of the day
  readonly to: Stop;
}
```

- The day comes in a dry and a wet version. Wet means `weatherWaters(today's weather)`: rain and storms are wet, snow is not.
- **The current leg** is the last leg whose `departs` is at or before the current minute. Before the first leg the walker is at home. The current leg is never saved; it's worked out from the clock and the weather.
- **A pace stop** walks between its spots in order, moving on every `everyMinutes`, counted from the leg's `departs`: the target is `spots[floor((minute − departs) / everyMinutes) % spots.length]`. A pace stop's facing applies only when the walker reaches a spot and waits there. The townsfolk's loops of several spots have no facing (null): they keep the facing they walked in with.
- **Home** is a door: the tradies live above their shops, Sol above the parts exchange, and Cosmo and Barnaby in their houses.

  | Id | Home door | Map |
  | --- | --- | --- |
  | `marigold` | General store (6, 6) | town |
  | `berlioz` | Blacksmith (15, 6) | town |
  | `juniper` | Carpenter (25, 6) | town |
  | `tallulah` | Ranch (34, 6) | town |
  | `sol` | Parts exchange (20, 6) | town |
  | `cosmo` | His house (5, 4) | neighbours |
  | `barnaby` | His house (26, 4) | neighbours |

- Every minute and tile below lives in config (`TIMETABLES`). Part 4a's fixed spots become the tradies' "at work" stops and the farmers' evening stops.

### 2.2 The tradies: Marigold, Berlioz, Juniper, Tallulah and Sol

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
| `sol` | 6:00 am | Coffee at the well (21, 13), facing West | (19, 12), facing South | The promenade (14, 22), facing South |
| `tallulah` | 6:30 am | The ranch path (34, 12), facing North | (21, 14), facing West | The main street (33, 16), facing North |
| `marigold` | 7:00 am | The promenade's flowers (8, 22), facing South | (18, 13), facing East | The main street by the store (5, 16), facing South |
| `berlioz` | 7:00 am | The river bank (16, 23), facing South | (18, 14), facing East | The well (20, 12), facing South |
| `juniper` | 7:30 am | Sketching by the well (18, 14), facing East | (21, 13), facing West | The promenade (26, 22), facing South |

Sol is the early riser, so on a new game's first morning the first job's giver is out from 6:00 am.

**Wet day:** the tradies stay in until work and spend lunch indoors.

| Departs | To |
| --- | --- |
| 8:30 am | Work (Sol: 6:00 am, his first leg, so job 1 can still be found on a wet first morning) |
| 12:00 pm | Home |
| 12:50 pm | Work |
| 5:00 pm | Home |

### 2.3 The farmers: Cosmo and Barnaby

The farmers work **beside** their fields, never in them, so every field tile stays the jobs'. Each paces three spots outside their fence, watching their robots.

**Dry day:**

| Departs | Cosmo | Barnaby |
| --- | --- | --- |
| 6:00 am | Beside his field: pace (11, 10), (16, 7), (4, 13), every 20 minutes, facing West | Beside his field: pace (30, 18), (30, 22), (19, 20), every 25 minutes, facing West |
| 11:15 am (Cosmo), 11:05 am (Barnaby) | Lunch: town (19, 15), facing North | Lunch: town (20, 15), facing North |
| 1:00 pm | Beside his field | Beside his field |
| 6:00 pm | His 4a spot on the lane (7, 13), facing South | His 4a spot on the lane (25, 15), facing North |
| 8:00 pm | Home | Home |

(16, 7) is beside Cosmo's chicken run (§7.3).

**Wet day:** the same, except that they skip lunch in town: no 11:15 / 11:05 leg, and the field leg runs until 6:00 pm.

The lunch departures are timed so that, on the maps with nothing placed, both farmers reach the square by 12:00 pm. A test pins this.

### 2.4 Jobs ignore the hours

Taking a job, its Job card and its check when you talk to the giver (part 4c) work wherever you find the giver, at any hour. The **Job** button is never hidden by shop hours.

---

## 3. The townsfolk

### 3.1 Who they are

Six anonymous townsfolk, each a type rather than a person. `TOWNSFOLK_IDS = ['jogger', 'dogWalker', 'retiree', 'courier', 'busker', 'kid']`.

| Id | Plate | Look and prop | Exit | Loop (pace spots, every) |
| --- | --- | --- | --- | --- |
| `jogger` | Jogger | Running vest, headband | South-west | The promenade's two ends: (3, 22), (36, 22), every 35 minutes |
| `dogWalker` | Dog walker | Raincoat; a small dog on a lead, drawn one tile behind | South-west | Round the square: (14, 9), (25, 10), (25, 18), (14, 18), every 15 minutes |
| `retiree` | Retiree | Cardigan, flat cap, a book | South-east | Beside the bench by the river: (17, 21), facing South (one spot) |
| `courier` | Courier | Cap and satchel; a hand cart, drawn in front | South-east | The shop fronts: (7, 8), (16, 8), (24, 8), (35, 8), every 30 minutes |
| `busker` | Busker | Hat on the ground, a guitar | South-west | By the well: (18, 12), facing South (one spot) |
| `kid` | Kid | Too-big hoodie, holding a chocolate teapot | South-east | Outside SLOPMART: (29, 8), (31, 9), every 25 minutes |

- Their looks reuse the player model with a fixed appearance and prop each, as the cast do.
- **Exits:** the townsfolk live out of town. They come and go by the town's two south exits, the south-west corner (0, 30) and the south-east corner (39, 30), both on the river's south bank. An exit works like a door: a walker going home walks onto the exit tile and steps off the map. Both exit tiles become reserved tiles.

### 3.2 Their day

**Dry day:** out at 8:00 am to their loop, home at 7:00 pm.

**Wet day:** only the jogger and the courier come out ("rain or shine"). The others stay home all day.

### 3.3 Talking to them

- E on a townsperson opens the chat box with their plate as the name, **Brookhollow** as the role line, today's line, and no buttons.
- **Today's line** is `lines[hash32(seed, absoluteDay, index) % 3]`, where `index` is the townsperson's position in `TOWNSFOLK_IDS`. They have no introduction, no reactive lines and no talk counts, and nothing about a chat is saved.
- A stuck townsperson says the stuck line (§4.4) instead.

**Their lines:**

- **Jogger:**
  1. "Can't stop! Personal best!"
  2. "Three laps before the shops open. Every day."
  3. "Robots don't jog. More river for me."
- **Dog walker:**
  1. "This is Biscuit. Biscuit, sit. Biscuit doesn't do commands. Unlike your robots."
  2. "Biscuit barks at the SLOPMART sign. Smart dog."
  3. "Twice round the square, then home for a biscuit. Not you, Biscuit."
- **Retiree:**
  1. "Machines that never get tired never stop to wonder if they should."
  2. "I read the instructions. Nobody reads the instructions any more."
  3. "I don't need a robot. I don't need a map either. I've only been lost the once."
- **Courier:**
  1. "Parcels for Marigold, parcels for Sol. Everyone's ordering parts these days."
  2. "One cart, two legs, no tokens. Beat that."
  3. "A tick on the form means nothing if the parcel isn't on the step."
- **Busker:**
  1. "Requests? I know three songs, and they're all about rain."
  2. "Coins in the hat if you've got them. Slop in the hat if you haven't."
  3. "That robot at SLOPMART reviewed my set. One star. It said it loved it."
- **Kid:**
  1. "Next box is a gem. I can feel it."
  2. "I've got eleven chocolate teapots. The twelfth one's the lucky one."
  3. "DEALZ called me pal. We're basically friends."

---

## 4. Walking

### 4.1 Walkers and places

**Walkers** are the seven characters and the six townsfolk. Each has a saved `place`:

```ts
type WalkerPlace =
  | { readonly kind: 'indoors' }
  | { readonly kind: 'out'; readonly mapId: MapId; readonly tx: number; readonly tz: number; readonly facing: Direction };
```

- "Indoors" means off the map: behind their door, or gone by their exit.
- Part 4a's `MapDefinition.npcs`, `NpcPlacement`, `npcSpot` and `assertNpcPlacements` are removed. `npcAt` becomes `walkerAt(state, mapId, tx, tz): WalkerId | null`, reading the places. When two walkers share a tile it returns the first in the order characters then townsfolk, each in their id order.
- The renderer, the talk intent, the placement refusal and every test that found a character through `npcSpot` read places instead.

### 4.2 The per-minute step

`runWalkersMinute(state)` in `src/people/walk.ts` (pure) runs once per game minute. The minute loop runs, each minute and in this order: the robots, then the walkers, then 4c's job check. The loop runs every minute even with no robots and no active job, because the walkers always move.

It takes each walker in the order characters then townsfolk:

1. Work out the target from the current leg (§2.1). For a `home` stop the target is the tile in front of the home door, or the exit tile.
2. **Indoors:**
   - If the current leg is `home`, stay in.
   - Otherwise come out: a character onto the tile in front of their door, facing South; a townsperson onto their exit tile, facing North. If the player or a robot is on that tile, wait.
3. **Out, at the target:**
   - At a `home` target, step in: the place becomes `indoors`.
   - Otherwise turn to the stop's facing.
4. **Out, not at the target:** take one step along a route (§4.3), turning to face the step's direction. If no step is possible, stay.

Walkers never block each other. Two can share a tile, and the renderer draws them slightly apart, as it does for robots. The order therefore never changes the outcome.

### 4.3 Routes

- The breadth-first search in `src/robots/route.ts` becomes a pure, map-agnostic `findPath(world, from, to, canEnter)` in `src/world/path.ts`. The path excludes the start and includes the target. The robots' route functions become wrappers around it with exactly their current rules (water and .MD DON'T cards included), and their tests pass unchanged.
- A walker re-plans **every step** on the live map, so anything placed in the way is routed round at once. No path is saved.
- **A walker can enter a tile** when it is walkable and no robot stands on it. Reserved tiles (gates, arrivals and exits) can be walked over, but no stop sits on one.
- **The player:**
  - First, plan with the player's tile counted as blocked. If there's a route, take its first step.
  - Otherwise, plan again ignoring the player. If that route exists, the player is the only thing in the way: take its first step, unless that step is onto the player's tile; only then wait this minute. So a walker walks up to the player and waits beside them.
  - Otherwise the walker is **stuck**. They head for the tile they can reach (ignoring the player) that is fewest Manhattan steps from the target, ties going to the first the search visits, by the same two plans, so they still walk up to the player on the way. Once there they stay. A walker with no reachable tile nearer the target than their own stays where they are. So a stuck walker waits as close to their stop as they can get, and never paces back and forth.
- **Crossing maps:** when a farmer's target is on the other map, the route's target is the gate tile that leads there (town (39, 16) east, neighbours (0, 14) west). From the gate tile the next step goes through the warp to the other map's arrival tile (town (38, 16), neighbours (1, 14)), facing the warp's direction. Townsfolk never leave the town.

### 4.4 Being stuck

A stuck walker's line is "Someone's put something in my way. I'll wait." For a character it comes after the introduction and before the job hook and every other line. For a townsperson it replaces today's line. "Stuck" is worked out when the chat opens, using the same plans as §4.3, so nothing extra is saved: a walker is stuck while their target can't be reached even ignoring the player, whether they are still heading for the nearest tile they can reach or already standing on it. A walker waiting for the player isn't stuck.

### 4.5 The player, robots and walkers

- **A walker's tile blocks the player's steps,** whether they're walking or standing (as 4a's characters already do), with one exception (R13): a walker waiting this minute because of the player, their next step by their own plan (§4.3) being onto the player's tile, swaps places with them. The player steps onto the walker's tile, and the walker takes the player's old tile, facing the way they were heading. Otherwise a walker parked beside the player in a dead end or a one-tile gap, such as Cosmo's door front at 8:00 pm, would pin them until the pass-out. No robot can stand on the player's tile then, because the walker's plan routes round robots.
- **E talks,** mid-walk too. The chat freezes the game, so nobody moves while you talk.
- **Gate arrivals:** the player arrives even if a walker is on the arrival tile (as now).
- **Placing:** nothing can be placed on a walker's tile ("Someone's standing there.", as now).
- **Robots:** robot movement is unchanged. If a robot moves onto a standing walker's tile, they share it and E talks to the walker (as now).
- **A job's generator:** when a job places a generator on a tile where a walker stands, the walker first moves to the nearest free walkable tile (the same search as part 3's `freeSpotNear`), so a saved place is never inside a generator.
- **4c's drag-back rule**, which keeps flat robots off "a character's spot", now keeps them off every spot in the farmers' timetables on that map (`TIMETABLES`), a fixed set.
- **Off-screen:** walkers keep walking on maps the player isn't on.
- **Frozen:** no time passes while the game is frozen, so nobody moves.

### 4.6 Rendering

- One renderer draws every walker with an `out` place on the active map. It replaces 4a's `NpcRenderer`.
- **Tweening:** when a walker's new tile is next to their old one on the same map, they glide there over the robots' lerp time for a one-minute step (`glideSeconds(1, timeScale)`, the formula behind `moveSeconds`), so a glide always lands before the next step. Any other change (a map change, coming out of a door or exit, or a jump of several tiles at high time scales) snaps.
- They face the way they walk, easing their turns like robots, and keep 4a's idle sway, standing and walking. Walkers sharing a tile use the robots' `sharedTileOffsets`.
- The dog walks one tile behind the dog walker and the cart rolls one tile in front of the courier. Both are drawn only: they never block anything and aren't saved.
- Nameplates work as in 4a, with the townsfolk's plates from §3.1.

### 4.7 The morning

`startNextDay` sets every walker `indoors`, so nobody's day carries over. A walker stuck behind a fence yesterday starts clean.

---

## 5. Shop hours

### 5.1 The rule

- `SHOP_HOURS` in config: `[{ opens: 9 * 60, closes: 12 * 60 }, { opens: 13 * 60, closes: 17 * 60 }]`, one table for every shop.
- `SHOP_DOORS` (pure) names the five shops with hours, their doors, their keepers and their menus:

  | Shop | Door | Keeper | Menu | 4c gate |
  | --- | --- | --- | --- | --- |
  | `generalStore` | (6, 6) | Marigold | The seed shop | None |
  | `blacksmith` | (15, 6) | Berlioz | None | None |
  | `carpenter` | (25, 6) | Juniper | The workshop | `workshop` |
  | `ranch` | (34, 6) | Tallulah | None | None |
  | `partsExchange` | (20, 6) | Sol | The parts shop | `partsShop` |

- `shopOpen(state, shop)` reads only the clock: a shop is open when `opens ≤ minute < closes` for one of the windows. It never looks at where the keeper is.
- `nextOpening(minute)` gives the text after "Open again at": "9:00 am" before 9:00 am, "1:00 pm" from 12:00 pm to 1:00 pm, and "9:00 am tomorrow" from 5:00 pm. Times use `formatClock`.

### 5.2 Gate first, then hours

4c's gates come first and stay exactly as built: a gated menu's button is missing and its orders are refused silently. The hours apply only once the gate is open.

| | Gate closed | Gate open (or no gate), outside hours | Gate open (or no gate), in hours |
| --- | --- | --- | --- |
| **The keeper's button** (Marigold's Shop, Sol's Shop, Juniper's Workshop) | Missing, as now | Pressing it changes the keeper's line to "Sorry, we are closed! Open again at {time}." and the chat stays open | Opens the menu, as now |
| **E on the shop's door**, from the tile in front of it | Does nothing | Toast: "Sorry, we are closed! Open again at {time}." | Opens the menu |
| **B**, the seed-shop shortcut | (no gate) | The same toast as the door, from any map | Opens the seed shop, as now |

- Berlioz's and Tallulah's doors have no menu: outside hours they give the closed toast, and in hours they do nothing.
- `planInteraction` gains a `shopDoor` intent for a door in `SHOP_DOORS`, after the walker check and before robots, objects and blockers. It's planned when the shop is closed (hint "Closed") or open with an open gate and a menu (hint "Shop"). Otherwise it isn't planned, and E does what it did before.
- A keeper's chat outside hours otherwise shows their normal line. Only pressing their shop button gives the closed line.
- The game is frozen while a menu is open, so closing time never arrives mid-purchase.

### 5.3 The door signs

Each of the five doors gets a small hanging sign that reads **OPEN** or **CLOSED**, flipping with `shopOpen`. The two faces join 4b's poster texture atlas. At the parts exchange, which has a FarmClaw poster each side of its door, the sign hangs on the door itself.

---

## 6. SLOPMART 24/7

### 6.1 The booth

- `STRUCTURE_KINDS` gains `'slopShop'`.
- In the town, the hedge `(28, 0, 3, 7)` between the carpenter and the ranch becomes `{ kind: 'slopShop', rect: (28, 0, 3, 7), door: (29, 6) }`, with the counter at the door. The blocked tiles are exactly the same set as before, so the booth itself changes no saved tiles. A test pins this.
- **Look:**
  - A narrow, cramped booth with a counter in its front wall.
  - On top, a neon sign reading **SLOPMART 24/7**, with **A BARNABY VENTURE** in small letters underneath. The sign flickers: one letter dims for a moment every few seconds, on a fixed cycle in the renderer.
  - Behind the counter stands **DEALZ**, a Mini-sized robot in default paint. DEALZ is part of the booth's geometry, built like Juniper's display Mini from 4b. DEALZ is not a walker and has no place.
  - The sign and DEALZ's eyes are emissive, so SLOPMART is the one lit shopfront at night.
- SLOPMART is open at every hour and has no gate.

### 6.2 Talking to DEALZ

- E on the booth's door from (29, 7) plans a `slopShop` intent, hint "Talk to DEALZ". It opens a `slopShop` panel, which freezes the game like every panel.
- The chat box shows:
  - the name **DEALZ**;
  - the role line **SLOPMART 24/7 · A BARNABY VENTURE**;
  - DEALZ's line;
  - two buttons, **Buy a mystery box ({price}g)** and **Leave**.

  DEALZ's chat box is its own panel in 4b's lazy shops chunk (`src/ui/shops/`), dressed in 4a's chat box classes and phone width, rather than a third speaker in 4a's chat box view (R14). The townsfolk speak through 4a's chat box view (§3.3).
- **The greeting** on opening is `greetings[hash32(seed, absoluteDay, boxesOpened, SLOP.greetingSalt) % 8]`.
- **Buying** runs these checks in order. Each refusal changes DEALZ's line and charges nothing:
  1. Today's boxes have reached `SLOP.boxesPerDay`: the sold-out line.
  2. Gold is under `SLOP.boxPrice`: the no-gold line.
  3. The inventory has no completely empty slot: the bag-full line. A box needs an empty slot whatever it holds, so a nearly full bag can't be used to find out what's in the box.
- **A sale:**
  - takes the price;
  - adds the box's contents to the inventory;
  - adds 1 to `boxesOpened` and to today's count;
  - changes DEALZ's line to a result line;
  - shows the toast "Mystery box: {item name} ×{quantity}." (or "Mystery box: {item name}." for one item).

  The toast tells the truth about what you got; DEALZ's line doesn't tell you whether it was any good. The chat stays open, so you can buy again.
- E, K, Enter and Escape close the chat, as for every chat.
- The panel's code lives in 4b's lazy shops chunk, with the other shop panels.

### 6.3 What's in the box

Each box is decided by `boxesOpened`, the saved lifetime count, before it's added to:

- **Gem or slop:** it's a gem when `hashFloat(seed, boxesOpened, SLOP.tierSalt) < SLOP.gemChance`, otherwise slop.
- **Which one:** `hash32(seed, boxesOpened, SLOP.pickSalt) % list.length`, into the gem list or the slop list.

So every save has its own fixed sequence of boxes, and reloading doesn't change the next one.

**Gems:**

| Gem | Quantity |
| --- | --- |
| Spectraherb seeds | 3 |
| Quality sprinkler | 1 |
| Speed-Gro | 5 |
| Quality fertiliser | 5 |
| Seeds of a field crop that isn't in season | 5 |

For the out-of-season seeds, the crop is `hash32(seed, boxesOpened, SLOP.cropSalt) % n`, into the field crops (`habitat: 'field'`) that don't list the current season, in `CROP_IDS` order.

**Slop:** the item registry gains a `slop` kind, and `SLOP_IDS` lists twelve items. Each one:

- stacks to `INVENTORY.maxStack`;
- ships for `SLOP.slopSellPrice` (1g);
- can't be placed, planted, fitted, burnt or used, so selecting one and pressing E does nothing.

Each name says plainly what the thing is. Each description is DEALZ's product copy: confident, in capitals, ending " ✓", and wrong or beside the point. The gap between the two is the joke.

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

Slop items use the existing icon convention, the item's `color`.

### 6.4 DEALZ's lines

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
- **Results**, the same for slop and gems. The line is `hash32(seed, boxesOpened, SLOP.resultSalt) % 3` with `boxesOpened` before the sale:
  1. "{ITEM}. ENJOY IT OR DON'T. I DON'T CARE ✓"
  2. "{ITEM}. PREMIUM QUALITY. NEXT ✓"
  3. "{ITEM}. BEST ONE YET. NOW MOVE ✓"
- **Sold out:** "SOLD OUT. GO HOME ✓"
- **No gold:** "NO MONEY, NO SLOP. BEAT IT ✓"
- **Bag full:** "YOUR BAG IS FULL. NOT MY PROBLEM, PAL ✓"

### 6.5 Barnaby's line

Barnaby gains one reactive line, his first, after the introduction and the job hook:

- You bought a box at SLOPMART today: "Bought a box at SLOPMART? Open all hours, no wages, no complaints. Well, none I've read."

### 6.6 Numbers

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

## 7. Props, posters and chickens

### 7.1 Props

All props are scenery: they don't do anything. Each is a town structure in map data, **low** (no taller than the well), so none hides a walkable tile from the camera. Each blocks its tiles like the well, and stands on grass only, never on a path, a door's front tile, a reserved tile, a timetable stop or a loop spot.

| Prop | Tiles (x0, z0, width, depth) |
| --- | --- |
| Market stall (awning, crates of produce on display) | (9, 9, 2, 1), (9, 11, 2, 1), (29, 10, 2, 1) |
| Bench | (15, 21, 2, 1), (23, 21, 2, 1) |
| Planter | (12, 12, 1, 1), (27, 12, 1, 1) |
| Crates | (3, 8, 1, 1), (4, 8, 1, 1) |
| Barrels | (31, 8, 1, 1), (32, 8, 1, 1) |
| Cart | (37, 19, 2, 1) |

**Bunting and banners** are drawn only and have no tiles. Bunting is strung between the lamp posts round the square and along the main street. Two banners hang over the main street.

`assertTownLayout` keeps its rules for the shops and hedges, and also checks that the props:

- stand on grass;
- touch no door front, reserved tile or timetable stop;
- leave every stop and loop spot reachable from its walker's door or exit.

### 7.2 Brand posters

These join 4b's poster atlas and hang on walls, as 4b's FarmClaw posters do. Every brand is made up.

| Brand | Text | Where |
| --- | --- | --- |
| Byre | "Milk from cows, not claws. 100% claw free." | Tallulah's ranch, beside the door |
| Tokenly | "Keep your claws charged." | The blacksmith, beside the door |
| Hollis Handpicked | "Picked by people. Slowly." | The general store, beside the door |
| Sprocket Cereal | "Part of a balanced robot." | SLOPMART's side wall |
| Claw Fair | "Parade · Contest · Day 14" | The two main-street banners |

### 7.3 Cosmo's chickens

- On the Neighbours map, a small run beside Cosmo's coop: a `woodFence` ring with corners (11, 5) and (15, 8), whose inside is x 12–14, z 6–7. The fences are placed objects on the map's tiles, like the field fences.
- **Five chickens** peck about inside the run. They're drawn and animated by the renderer only, wandering on a fixed pattern; they're never saved and never simulated.
- Wave's hello-chickens program now has an audience.

### 7.4 Changing saved tiles

The props and the run's fences take tiles that saves already hold as open ground. The migration (§9.2) blocks them, and it moves anything a player placed on one of them to the nearest free walkable tile on the same map, with its contents (the same search as `freeSpotNear`). It does the same for the player and any robot standing on a newly blocked tile, and clears objects from the chicken run's inside and from the two new exits, so a save made standing on a prop tile still loads.

---

## 8. Fixes to the built game

- **Cosmo's door:** his house door is at (5, 4), and the tile in front of it, (5, 5), is on the top row of his field's fence ring, so he can't walk out of his house. `FenceRing` gains a second gap: Cosmo's ring keeps its gate at (6, 12) and opens (5, 5), so his door opens straight into his field.
- **Door fronts on every map:** `assertMapDefinitions` checks that every door's front tile is walkable on every map, not only in the town.

---

## 9. Save version 10

### 9.1 Types

- **`NpcTalk`** gains `place: WalkerPlace`.
- **`GameSections.townsfolk`:** `Readonly<Record<TownsfolkId, { readonly place: WalkerPlace }>>`.
- **`GameSections.slopShop`:** `{ readonly boxesOpened: number }`.
- **`ShopsSoldToday`** gains `slopBoxes: number`, reset each morning with the rest of 4b's daily stock.
- **Items:** `ItemId` gains the slop ids. Inventories, chests, the shipping bin and robots' bags accept them.
- **`UiPanel`** gains the `slopShop` panel, and the talk panel can name a townsperson. The loader resets the panel, so this needs no migration.
- **Map data:** the booth, the props, the exits and the chicken run are map data, not saved, apart from the tiles they change (§7.4).

### 9.2 Migration (`migrateV9toV10`)

- **Places:** each walker's `place` becomes where their current leg puts them, using the save's minute and weather. For a `spot` or `pace` stop they stand on its target, facing its direction (South for a townsperson's loop, which has none); for `home`, or before their first leg, they are `indoors`. A walker whose target tile the save has built on is `indoors`.
- **`slopShop`:** `{ boxesOpened: 0 }`. **`shopsSoldToday.slopBoxes`:** 0.
- **Tiles:**
  - the town's prop tiles become blocked;
  - the Neighbours map gains the chicken run's fences and Cosmo's door gap at (5, 5) (the gap's fence is removed);
  - anything placed on a newly blocked tile moves as §7.4 says, and so do the player and any robot standing on one; objects on the chicken run's inside and on the two new exits are cleared (R11).
- **Version:** `SAVE_VERSION = 10`. `tests/testUtils.ts` gains a `v9Save` helper that `v8Save` builds on, in the style of the others.

### 9.3 Validation

- A `place` is `{ kind: 'indoors' }` or an `out` place whose map exists, whose tile is in bounds and walkable, and whose `facing` is a direction. Both have exact keys.
- `townsfolk` has exactly the six ids, each with exact keys.
- `slopShop` has exact keys, and `boxesOpened` is a non-negative integer.
- `slopBoxes` is a non-negative integer no more than `SLOP.boxesPerDay`.
- Slop item ids are valid wherever items are.

### 9.4 Each morning

`startNextDay` sets every walker `indoors` (§4.7), and 4b's daily reset clears `slopBoxes`.

---

## 10. Tests

| File | Covers |
| --- | --- |
| `tests/findPath.test.ts` | The general search. The robots' route tests pass unchanged. |
| `tests/timetable.test.ts` | Every stop and loop spot is valid and reachable. The current leg at each boundary, dry and wet. Pace targets cycle. Sol is out at 6:00 am, dry and wet. No farmer stop is on a field tile, a job's robot tile or a generator tile. `assertTimetables` is shown throwing for each rule. |
| `tests/walk.test.ts` | One step a minute. Rerouting round a placed chest and round a robot. Waiting for the player. Stuck behind fences or with a chest on a stop: walking to the nearest reachable tile and staying there, with the stuck line. The east gate both ways. Doors and exits, in and out, including waiting at a blocked one. The morning reset. Sharing tiles. Walking while the player is on another map. On the empty maps, a simulated dry day gets everyone to every stop before their next leg, both farmers reach the square by 12:00 pm, and all seven are there from 12:25 pm to 12:50 pm, and Barnaby reaches each of his three pace spots during his morning field leg. No movement while frozen. A generator placed under a walker moves them. 4c's drag-back keeps off the farmers' stops. |
| `tests/townsfolk.test.ts` | The six loops. Wet days bring out only the jogger and courier. Today's line is stable all day and verbatim, with no buttons. |
| `tests/shopHours.test.ts` | `shopOpen` at every boundary and `nextOpening`'s three cases. The door, the buttons and B, across gate closed / closed hours / open hours, with the toast and line verbatim. The Job button and job checks at 8:00 pm. |
| `tests/slopShop.test.ts` | The booth's blocked tiles match the old hedge's. A sale, and each refusal with its line and nothing charged. The same `boxesOpened` gives the same box. Over 10,000 boxes the gem share is within 0.08–0.12, and every gem and slop item appears. The out-of-season pick is never in season. Every line is verbatim and ends " ✓". Result lines don't depend on the tier. Barnaby's line. |
| `tests/townProps.test.ts` | The props pass the layout rules. The chicken run and Cosmo's door gap are in place, and every door front on every map is walkable. |
| `tests/saveV10.test.ts` | v9 → v10 (and the v2 fixture all the way), places at several minutes and weathers, a chest on a prop tile moved with its contents, a round trip with walkers mid-walk and slop in a chest, and one corrupted field per §9.3 rule. |
| `tests/determinism.test.ts` (extend) | The same seed gives the same state hash after 7 days with walkers walking and boxes bought. |

Tests that found characters through `npcSpot` or fixed tiles (the chat box, gates, jobs, the parts shop, talk and the workshop) set up a walker's place directly instead.

**Browser playbook** (`.claude/skills/game-driven-qa/scenarios/farmclaws-part4d.md`), kept short:

1. A new game's first morning: Sol at the well from 6:00 am; take job 1.
2. 8:00 am: the general store's door and B say closed; at 9:00 am they open.
3. Lunch in the square, with Cosmo and Barnaby arriving through the east gate.
4. Walk the town: the townsfolk, the props and posters, and a chat with the kid outside SLOPMART.
5. After 7:00 pm: the empty town and lit SLOPMART; buy three boxes.
6. The Neighbours map: the farmers beside their fields, Cosmo's door, the chickens.

---

## 11. Changes to the farmclaws design and earlier specs

- **Design §9.1:** the cast keep daily routines instead of fixed spots. The tradies keep shop hours with a morning routine and a lunch break, and the farmers work beside their fields and come into town for lunch.
- **Design §9.2:** shops open 9:00 am to 12:00 pm and 1:00 pm to 5:00 pm, behind 4c's gates; jobs ignore the hours. SLOPMART 24/7, Barnaby's robot-run booth, sells mystery boxes at any hour: mostly slop, sometimes a gem.
- **Design §11.2, the 4d row:** the contents become the cast's routines, the six townsfolk, shop hours, SLOPMART, the props and brand posters, and Cosmo's chickens.
- **Part 4a spec:** the "Timetables, walking characters | Not planned" row becomes "Part 4d", and Cosmo's field gains the door gap (§8).
- **Part 4c spec:** the drag-back rule's "a character's spot" becomes "a farmer's timetable stop" (§4.5).
