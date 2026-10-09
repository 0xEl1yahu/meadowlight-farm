# Farmclaws part 4b spec: shops and parts

This is the build spec for part 4b, the second of three parts that together make part 4 of the farmclaws design (`docs/superpowers/specs/2026-09-29-farmclaws-design.md`, sections 3.6, 3.7, 9.2 and 11.2):

| Part | Builds |
| --- | --- |
| 4a People | The cast on fixed spots, talking, Sol's parts exchange building, the Neighbours map (built) |
| **4b Shops and parts** (this spec) | Parts as items, Sol's parts shop, Juniper's robot workshop with next-morning delivery, fitting parts at the workbench |
| 4c Jobs | The jobs framework, jobs 1–3 on the neighbours' fields, unlocks per job, the balance pass |

Today the only way to get a robot is a dev hook, and a robot's parts are fixed for life. Part 4b lets the player buy robots and parts with gold and fit parts at the bench, so 4c's jobs have a working economy to unlock.

Every decision here is final for part 4b. If something in the code makes a rule impossible, pick the smallest change that keeps the rule's intent and write it down in the step's commit message.

Global rules (unchanged from parts 1–4a; see also `CLAUDE.md`): the simulation stays pure and deterministic; strict TypeScript with `erasableSyntaxOnly`; no TODOs or stubs; the gate passes after every step and `npm run build:check` at the end; immutable state with structural sharing; numbers from config; player-facing text copied verbatim from this spec; text through `textContent`.

---

## 1. Scope

**Part 4b builds:**

- **Parts as items:** the six basic parts in the backpack and in chests.
- **Sol's parts shop:** buy basic parts, sell any part back for half its price.
- **Juniper's robot workshop:** one ready-made robot per size, a read-only look at its program before buying, a name at checkout, delivery the next morning.
- **Fitting parts at the workbench:** a Parts section in the robot screen's Looks tab.
- **Scrapping** returns the robot's parts along with its bag.
- **Daily stock** at all three shops, with out-of-stock messages: Sol's parts, Juniper's robots and Marigold's seeds.
- **Shopfronts:** display stands, small props and posters outside the parts exchange and Juniper's workshop.
- **Two renames:** Bram becomes **Berlioz**, and Tess becomes **Tallulah**.
- Save version 8, with migration and validation.
- A short browser playbook.

**Decided with Eli before this spec:**

| Question | Decision |
| --- | --- |
| How a bought robot reaches the farm | Delivered overnight, beside the workbench |
| Unlocks before jobs exist | Everything is for sale now; 4c adds the job gates |
| Juniper's range | One robot per size, each with a Claw and a "harvest Zone A" program |
| Where parts are fitted | At the workbench, in the robot screen |
| Repairs | Stay at the shipping bin (a robot can't leave the farm) |
| Trades | Not built: selling back and buying covers it |
| Naming a bought robot | Typed at checkout, with a suggested name filled in |
| Reading a program before buying | The real robot screen, read-only |
| Names | Bram becomes Berlioz; Tess becomes Tallulah |
| Stock | Sol's parts, Juniper's robots and Marigold's seeds all run out each day and restock in the morning |
| Stands, props and posters | 4b dresses Sol's and Juniper's shopfronts, with FarmClaw posters; the rest of the town's props and brand posters (Byre, Tokenly, Hollis Handpicked, Claw Fair, Sprocket Cereal) come with 4d town life |

**Part 4b does not build:**

| Thing | Where |
| --- | --- |
| Job gates on the parts shop and robot sizes | 4c |
| The Antenna | Release 2 (part 5) |
| Efficient and quick cores, paint, voices, personality cores, custom robots, limited editions | Release 3 (part 6) |
| Trades | Cut for release 1 |
| Renaming a robot | Not planned |
| Berlioz's and Tallulah's menus | Not in farmclaws release 1 |
| Posters, stands and props around the rest of the town | 4d Town life |

---

## 2. Parts as items

- **Item kind `'part'`.** Every id in `ROBOT_PART_IDS` becomes an `ItemId` of kind `'part'`, with the part's name from the robot screen ("Claw", "Watering head", "Tiller", "Seeder", "Basket", "Antenna", "Sensor eye", "Efficient core", "Quick core") and its price from config (`PARTS.prices`, the design §3.7 table). The antenna and the cores are items too, so a save or a chest can hold any part, but only the basic six are sold in 4b.
- Parts stack like materials (`INVENTORY.maxStack`) and have no quality.
- **They can't be shipped:** `sellPrice` is null, so the bin refuses them with its existing "{item} can't be shipped." Sol buys them back instead.
- **Icons:** each part item has an inventory icon in `src/ui/icons.ts`, drawn from the robot screen's part icon shapes so they match.
- Selecting a part in the hotbar does nothing on the field: Space falls back to E, as it does for materials.

---

## 3. Sol's parts shop

### 3.1 Opening it

- Sol's chat gains the action **Shop** (`npcActions('sol')`), which closes the chat and opens `UiPanel { kind: 'partsShop' }`.
- The panel freezes the game like every panel. Escape, E, K and Enter close it.

### 3.2 The panel

- **Title:** "Sol's parts exchange". Under it, the player's gold.
- **Buy:** one row per basic part, in catalogue order (Claw, Watering head, Tiller, Seeder, Basket, Sensor eye): the icon, the name, what it provides (below), the price, and a **Buy** button.

  | Part | Line |
  | --- | --- |
  | Claw | "Harvest, take from and deposit into." |
  | Watering head | "Water and refill. Holds 20 uses." |
  | Tiller | "Till soil." |
  | Seeder | "Plant seeds." |
  | Basket | "Two more bag stacks." |
  | Sensor eye | "Sees the tile ahead, the rain and the time." |

- **Sell:** one row per part item stack in the backpack, in catalogue order: the icon, the name, the count, the sell-back price (`floor(price × PARTS.sellBackShare)`, with `PARTS.sellBackShare` 0.5) and a **Sell one** button. With none: "No parts in your backpack."
- **Footer:** "Repairs: carry a broken robot to the shipping bin."

### 3.3 Buying and selling

- Buying puts one part in the backpack and takes its price: "Bought a {part}." (the part's name in lower case).
  - Not enough gold: "You need {price}g."
  - No room: "Your inventory is full."
- Selling takes one part from the backpack and pays the sell-back price: "Sold a {part} for {gold}g."
- Actions: `parts/buy` `{ part }` and `parts/sell` `{ part }`. Both do nothing unless the parts shop panel is open and the game isn't paused, and `parts/buy` only takes a basic part.

---

## 4. Juniper's robot workshop

### 4.1 Opening it

- Juniper's chat gains the action **Workshop**, which closes the chat and opens `UiPanel { kind: 'workshop' }`. It freezes the game; Escape, E, K and Enter close it.

### 4.2 The range

One ready-made robot per size (`WORKSHOP_ROBOTS` in `src/robots/workshop.ts`, pure):

| Size | Price | Parts | Program |
| --- | --- | --- | --- |
| Mini | 1,500g | Claw | The harvester (below) |
| Standard | 4,000g | Claw, one free slot | The harvester |
| Big | 10,000g | Claw, two free slots | The harvester |

The prices are the design's size prices (`ROBOTS.sizes[size].price`); the Claw is included.

**The harvester program**, the same for all three:

```
When morning comes
  For each tile in A
    Harvest
  Power down
```

With Zone A unset the loop does nothing and the robot powers down at once. The program and its .MD (none) pass `checkProgram` and `checkMd` like any other.

### 4.3 The panel

- **Title:** "Juniper's robot workshop". Under it, the player's gold and "{n} / 12 robots" (robots on the farm plus deliveries due).
- **One card per size:** the size ("Mini", "Standard", "Big"), the price, "{slots} part slots · {battery} battery · {blocks} blocks", "Comes with a claw and a program that harvests Zone A.", and two buttons, **Read program** and **Buy**.
- **Read program** opens the robot screen in preview mode (section 4.4).
- **Buy** turns the card into the checkout: "Name your robot", a text field holding the suggested name (section 4.5), **Buy for {price}g** and **Cancel**.

### 4.4 The preview

- `UiPanel { kind: 'robot'; mode: 'preview'; size: RobotSize }` opens the robot screen (its lazy chunk) on the catalogue robot, which isn't in the state.
- The header shows the size and "From Juniper's workshop", and no On/Off switch, **Lift off** or **Scrap**.
- The tabs are Program (read-only, as when peeking) and Looks (without the Parts section's buttons).
- Closing the preview (Escape or its close button) returns to the workshop panel.

### 4.5 Ordering

- **The suggested name** is the first name in `WORKSHOP_NAMES` (a fixed list of 24 robot names in `src/robots/workshop.ts`), starting from index `hash32(seed, robots.nextId + deliveries.length) % 24` and wrapping, that no robot on the farm and no due delivery already has.
- **Buy for {price}g** orders the robot: `workshop/order` `{ size, name }`.
  - The name goes through the existing robot name rule: "A robot needs a name of 1 to 24 characters."
  - Not enough gold: "You need {price}g."
  - Robots on the farm plus deliveries due already 12: "The farm already has 12 robots."
  - Otherwise the price is paid, `robots.deliveries` gains `{ size, name }`, the checkout closes, and the toast says "Juniper will deliver {name} tomorrow morning."
- Orders do nothing unless the workshop panel is open and the game isn't paused.

### 4.6 Delivery

- In the night step (`runRobotsOvernight`), before the morning reset, every due delivery becomes a robot, in order, through `addRobot`: the catalogue size, parts and program, the order's name, fully charged, working, facing South, on `freeSpotNear(farm, WORKBENCH.home, taken)` where `taken` holds the spawn tile, every standing robot and every robot already delivered tonight.
- `robots.deliveries` empties.
- Each delivery's morning toast: "Juniper delivered {name}. It's waiting by the workbench."
- The robot's morning stack runs that morning like any other robot's.

---

## 5. Fitting parts at the workbench

### 5.1 The Parts section

The robot screen's **Looks** tab gains a **Parts** section, for a robot on the bench (mode `'bench'`):

- **Fitted:** one row per slot (`ROBOTS.sizes[size].partSlots`): a fitted part's icon and name with a **Take off** button, or "Empty slot".
- **From your backpack:** one row per part item stack in the backpack that the robot can take (not already fitted), with **Fit**. With none: "No parts in your backpack to fit."
- When peeking, the section shows the fitted parts only, with no buttons. A ruined robot shows "{name} is ruined. It can only be scrapped." as the other tabs do.

### 5.2 The rules

- **Fit** (`robot/fit` `{ robotId, part }`) moves one part from the backpack into the robot. The robot's `parts` stays in catalogue order.
  - No free slot: "{name} has no free part slot."
  - Already fitted: "{name} already has a {part}."
  - Done: "Fitted a {part} to {name}."
  - Fitting a watering head fills its tank (`ROBOTS.tankCapacity`).
- **Take off** (`robot/unfit` `{ robotId, part }`) moves the part into the backpack.
  - No room: "Your inventory is full."
  - A sensor eye while the program uses a sensor that needs it: "{name}'s program uses the sensor eye."
  - A basket while the bag holds more stacks than the robot could carry without it: "Empty {name}'s bag before taking the basket off."
  - Done: "Took the {part} off {name}."
  - Taking off a watering head empties the tank.
- Both only work on the robot on the bench, not ruined, with the game unpaused, exactly like the other bench edits (`editRobot`).
- A program that uses an action whose part is gone stays as it is: the action is already a mistake at run time ("Tried to {verb}, but it doesn't have the part for that."), as in part 1.

### 5.3 Scrapping

Scrapping (part 3) now puts the robot's parts into the backpack along with its bag. If they don't all fit, the scrap is refused with the existing "Make room in your backpack for {name}'s bag first."

---

## 6. Daily stock

Each shop sells a fixed amount per day, and restocks every morning (`startNextDay` clears the counts). The amounts are in config (`SHOP_STOCK`):

| Shop | Stock | Out of stock |
| --- | --- | --- |
| Sol's parts | 2 of each basic part per day (`SHOP_STOCK.partsPerDay`) | "Out of stock. Sol restocks tomorrow." |
| Juniper's robots | 1 of each size per day (`SHOP_STOCK.robotsPerSizePerDay`) | "Sold out today. Juniper builds another tomorrow." |
| Marigold's seeds | 30 packets of each seed per day (`SHOP_STOCK.seedsPerDay`) | "Out of stock. Marigold restocks tomorrow." |

- **What the player sees:** every row shows "{n} left". A sold-out row shows "Out of stock" in place of its buttons (Juniper's card: "Sold out today").
- **Seeds:** a ×5 or ×10 button is disabled when fewer packets are left than it would buy. If a buy asks for more than is left anyway: "Only {n} left today."
- **The rules** sit in the reducer, so the messages above are the toasts a refused buy or order gives. Selling parts back to Sol doesn't add to his stock.
- The counts are saved, so reloading mid-day doesn't restock.

---

## 7. Shopfronts

Decorations on the front of the parts exchange and Juniper's workshop (the carpenter). They stand inside each building's footprint, in the back band, so they change no tile, keep the occlusion rule, and need no migration.

- **The parts exchange:**
  - A display stand by the door, with a claw, a watering head and a sensor eye on it.
  - A poster on each side of the door: **FarmClaw**, "Your farm. Our claws." and **FarmClaw**, "Genuine FarmClaw parts."
- **Juniper's workshop:**
  - A Mini robot standing still on a low stand beside the door: the robot model in its own colours, with no lights or sway.
  - A poster: **FarmClaw**, "Robots built to order."
  - A crate of planks and cogs.
- **Posters** are ads for made-up brands. FarmClaw is the valley's robot maker. Each poster is a brand name, a slogan and a simple picture: a claw for FarmClaw.
  - They're drawn once, when the town is built, onto one shared canvas texture (an atlas), so all the posters together cost one material and one draw call. The text is fixed English, drawn with the canvas's `fillText` like the nameplates.
  - Part 4d adds the rest: **Byre** at Tallulah's ranch ("Milk from cows, not claws. 100% claw free."), and **Tokenly** ("Keep your claws charged."), **Hollis Handpicked** ("Picked by people. Slowly."), **Claw Fair** ("Parade · Contest · Day 14") and **Sprocket Cereal** ("Part of a balanced robot.") around the town. Every brand is made up.

---

## 8. Names

- **Bram becomes Berlioz**, and **Tess becomes Tallulah**. Their ids change too: `NPC_IDS` is `['sol', 'cosmo', 'barnaby', 'marigold', 'berlioz', 'juniper', 'tallulah']`, in the same order, so every everyday-line pick stays the same.
- Their introductions:
  - Berlioz: "Berlioz. Blacksmith. I sharpen tools and I don't do small talk."
  - Tallulah: "Hi there, I'm Tallulah. Chickens, cows and wheat to feed them. Come see the ranch."
- Their other lines, roles, spots and looks are unchanged. Comments, tests and the playbooks that name them change to match.

---

## 9. Save version 8

- **`robots.deliveries`:** `readonly RobotDelivery[]`, with `interface RobotDelivery { readonly size: RobotSize; readonly name: string }`. New games start with `[]`.
- **`shopsSoldToday`** (a new section): `{ readonly parts: Readonly<Record<BasicPartId, number>>; readonly robots: Readonly<Record<RobotSize, number>>; readonly seeds: Readonly<Record<SeedItemId, number>> }`, every count 0 in a new game, reset each morning.
- **`npcs`:** the keys `bram` and `tess` become `berlioz` and `tallulah`.
- **Part items** need no new field: they are `ItemId`s, so the existing stack validation accepts them once `isItemId` knows them.
- **`UiPanel`** gains `partsShop`, `workshop` and the robot screen's `preview` mode; the loader resets the panel, so they need no migration.
- **Migration (`migrateV7toV8`):** `robots.deliveries = []`; `shopsSoldToday` at all zeros; the `npcs` entries for `bram` and `tess` move to `berlioz` and `tallulah` unchanged, and `quests.board.npc` and `festival.giftTarget` follow the rename; `SAVE_VERSION = 8`.
- **Validation:** `deliveries` is an array of objects with exactly `size` (one of `ROBOT_SIZES`) and `name` (the robot name rule), and robots plus deliveries are at most `ROBOTS.maxRobots`. `shopsSoldToday` has exactly its three keys, each with exactly its ids, every count an integer from 0 to that shop's daily stock. `npcs` has the new ids.
- `v7Save` in `tests/testUtils.ts` turns a v8 state back into v7 JSON, and `v6Save` starts from it.

---

## 10. Bundle

- All three shops' panels live in a new lazy chunk, `src/ui/shops/`, loaded through one dynamic import when any of them first opens, like the robot screen: Sol's parts shop, Juniper's workshop, and Marigold's seed shop, which moves there from the HUD (decided by Eli when the main chunk ran low). Its budget is ≤ **20 KiB** gzipped, checked by `build:check`.
- Part items, their icons, the actions and the reducer stay in the main chunk, which must stay within its current budget (295.1 KiB). If it can't, the build stops and asks Eli.
- The Parts section and the preview mode are in the robot screen chunk.

---

## 11. Tests

| File | Covers |
| --- | --- |
| `tests/partItems.test.ts` | Every part is an item of kind `'part'` with its name and price; not shippable; stacks; chests hold parts. |
| `tests/partsShop.test.ts` | Sol's Shop action; buying (gold, room, only basic parts); selling at half price, rounded down; the panel guards (no panel, paused). |
| `tests/workshop.test.ts` | Juniper's Workshop action; the range and the harvester program pass the checkers; the suggested name skips used names and wraps; ordering (name rule, gold, the 12-robot cap counting deliveries); the guards; delivery overnight beside the workbench, in order, with the toast; the morning stack runs. |
| `tests/fitParts.test.ts` | Fit and take off: slots, duplicates, catalogue order, the tank, a full backpack, the sensor-eye and basket refusals, bench-only, ruined, paused; scrapping returns parts or refuses. |
| `tests/shopStock.test.ts` | Each shop's daily stock: the counts, the out-of-stock toasts, "Only {n} left today.", selling back doesn't restock, the morning reset. |
| `tests/saveV8.test.ts` | v7 → v8 (and the v2 fixture through every version): deliveries, the stock counts, the npcs rename with the board and gift target following it; a round trip with deliveries due, stock sold and parts in the backpack and a chest; one corrupted field per rule. |
| `tests/cast.test.ts`, `tests/lines.test.ts` (update) | Berlioz and Tallulah: names, ids, spots and the two new introductions. |
| `tests/scenery.test.ts` (extend) | The shopfront props stay inside their buildings' rects and keep the occlusion rule. |
| `tests/posters.test.ts` | The poster atlas layout: every 4b poster has a cell, the cells don't overlap, and each poster's brand and slogan are the spec's (drawing itself is checked by playing). |
| `tests/robotScreen.test.ts` (extend) | The preview's header, tabs and close; the Parts section's rows for bench, peek and ruined. |
| `tests/checkBundle.test.ts` (extend) | The shops chunk found by source map and its 20 KiB budget. |

**Browser playbook** (`.claude/skills/game-driven-qa/scenarios/farmclaws-part4b.md`), short:
1. Buy a watering head from Sol, sell a part back.
2. Read the Mini's program at Juniper's, order a Mini with a typed name, sleep: it's by the workbench.
3. On the bench, take its claw off and fit the watering head.
4. Order a Standard; the counter and the 12-robot cap.
5. Buy a part until it's out of stock; sleep; it's back.
6. Look at the two shopfronts, and talk to Berlioz and Tallulah.

---

## 12. Implementation steps

1. Save version 8: `robots.deliveries`, `shopsSoldToday`, and the Berlioz and Tallulah renames.
2. Parts as items: the item kind, prices, names, icons, the bin refusal.
3. Sol's parts shop: the action, `parts/buy` and `parts/sell`, the lazy shops chunk and its panel, the budget check.
4. Juniper's workshop: the range, suggested names, ordering, the panel, and delivery overnight.
5. The robot screen preview mode.
6. Fitting parts: `robot/fit`, `robot/unfit`, the Looks tab's Parts section, and scrapping returning parts.
7. Daily stock at all three shops.
8. The shopfronts.
9. The playbook and the spec sync.

---

## 13. Done means

- Every test above passes. Typecheck, the full suite, the build and `build:check` are green.
- Eli has played it.
- Parts 1–4a behave unchanged.

---

## 14. Changes to the farmclaws design

- **§9.2:** trades are cut for release 1: Sol buys parts back at half price and sells new ones. Repairs stay at the shipping bin, which Sol's menu points to.
- **§9.2:** Juniper's ready-made robots are delivered beside the workbench the next morning. Every shop has a daily stock and restocks each morning.
- **§9.2, §10 and §15:** Bram is renamed Berlioz, and Tess is renamed Tallulah.
- **§11.2:** two parts are added after part 4, before part 5: **4d Town life** (anonymous townsfolk with fixed personalities walking short routes, market stalls, benches and planters, bunting and banners, barrels, crates and a cart, and posters, stands and small props around the town, including brand posters for Byre, Tokenly, Hollis Handpicked, Claw Fair and Sprocket Cereal) and **4e Graphics pass** (soft fitted shadows, ambient sky lighting, a water shader, and post-processing: ambient occlusion, night bloom, colour grading and a vignette, better anti-aliasing; a low / medium / high quality setting, phones defaulting to medium, the heavy parts loaded lazily).
