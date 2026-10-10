# Farmclaws Part 4b: Shops and Parts Implementation Plan

> **For agentic workers:** build task by task, in order. Each task names its files, what changes and why, the signatures later tasks rely on, and the tests that pin the rules. The build writes the code; read the files you touch first, and follow the surrounding code. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The player buys parts from Sol and robots from Juniper with gold, reads a robot's program before buying, gets the robot beside the workbench the next morning, and fits or removes parts at the bench. Every shop has a daily stock, Sol's and Juniper's shopfronts get stands, props and FarmClaw posters, and Bram and Tess become Berlioz and Tallulah. Saved in save version 8.

**Spec:** `docs/superpowers/specs/2026-10-09-farmclaws-part4b-shops-design.md`, the binding authority. Player-facing text is copied verbatim from it.

**Architecture:** Parts become a new item kind, so the backpack, chests and save validation handle them for free. Shop rules are pure reducer actions guarded by their panel; the two shop panels are DOM in a new lazy chunk `src/ui/shops/` behind a small main-chunk host, like the robot screen. Orders wait in `robots.deliveries` and become robots in the night step through the existing `addRobot`. Fitting is two more bench edits through `editRobot`. The preview is a third robot screen mode over a catalogue robot that isn't in the state.

## Global constraints

- `CLAUDE.md` rules apply: pure simulation, strict TS with `erasableSyntaxOnly`, numbers in `src/config.ts`, `textContent` only, structural sharing, no TODOs, no dev-hook names in production files (action types `parts/buy`, `parts/sell`, `workshop/order`, `robot/fit`, `robot/unfit` are clear of them).
- The gate (`npm run typecheck && npm test && npm run build`) passes after every task; `npm run build:check` after Tasks 2, 3, 5, 6, 7, 8 and 9.
- **Main chunk budget:** 292.9 of 295.1 KiB at the start; Eli raised it to 299.1 KiB (baseline + 30 KiB) after Task 4. Keep everything UI-heavy in the lazy shops chunk or the robot screen chunk. If `build:check` fails on the main budget, stop and ask Eli; don't raise it.
- One commit per task: `Farmclaws part 4b: <summary>`, then why, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Record any ruling that changes a spec rule, number or text as a `Ruling:` line in the body.
- Browser checks are Eli's: he plays it. Task 9 writes a short playbook but doesn't run it.

## Review focus

1. **Delivery overnight.** Two orders due, a robot standing at `WORKBENCH.home`'s nearest free tile and the player's carried robot set down at the spawn: both deliveries land on distinct free tiles near the bench, in order, with their toasts after "Good morning", and their morning stacks run that morning. (Task 4)
2. **The 12-robot cap counts deliveries** in ordering and in save validation. (Tasks 1, 4)
3. **A v7 save** loads with `deliveries: []`, zero stock sold, and Bram's and Tess's chats (and a board or gift target naming them) moved to Berlioz and Tallulah; the v2 fixture migrates through every version to 8. (Task 1)
4. **Taking off a part never breaks a saved robot:** the sensor-eye refusal keeps the program valid under `checkProgram`, the basket refusal keeps the bag within capacity, and a removed watering head empties the tank. (Task 6)
5. **The preview never writes state:** Read program, browsing and closing leave everything but `ui.panel` unchanged. (Task 5)
6. **Stock is per day and saved:** buying to sold-out, reloading and buying again is refused; the morning restocks; selling back doesn't restock. (Task 7)

## Facts the tasks need

- **Panels:** `UiPanel` in `src/core/types.ts` (~line 470); any panel freezes the game; the loader resets it. `ui/closePanel` closes any panel. `panelKeyCommand` (`src/input/panelKeys.ts`) closes the talk panel on E/K/Enter and any panel on Escape. Chat actions: `NPC_ACTION_KINDS` (types.ts), `npcActions(npc)` (`src/people/cast.ts`), `talk/act` and its private `talkAct` switch in `src/state/reducer.ts`.
- **Seed shop pattern:** `ShopModal` in `src/ui/Hud.ts` (buy buttons with `data-item`, gold readout), `shop/buy` → `buySeeds` in the reducer.
- **Lazy chunk pattern:** `RobotScreenHost` (`src/ui/RobotScreenHost.ts`) loads `./robotScreen/RobotScreen` with `import()` when `ui.panel.kind` is `'robot'`, shows "Opening…", toasts on failure through `ui/notify`. `scripts/bundleRules.mjs` classifies chunks by source map (`SCREEN_SOURCE`) and holds the budgets; `tests/checkBundle.test.ts` pins them.
- **Robots:** `addRobot(state, spec)` (`src/robots/create.ts`) validates name, size, parts (canonical subset, slot count), program and place, and refuses past `ROBOTS.maxRobots`. `ROBOTS.sizes[size]` has `price`, `battery`, `partSlots`, `blocks`; `ROBOTS.tankCapacity` 20. `hasPart`, `bagCapacity`-style helpers live in `src/robots/stats.ts`. `checkProgram(program, robot)` refuses sensors without a sensor eye (`src/robots/check.ts` ~line 335). `freeSpotNear(farm, from, taken)` and `robotOnBench(state)` in `src/robots/workbench.ts`. `runRobotsOvernight(state)` (`src/robots/overnight.ts`) returns `{ state, notes }`; `startNextDay` pushes the notes after "Good morning".
- **Bench edits:** `editRobot(state, robotId, edit, done)` in the reducer handles not-found, off-bench and ruined refusals; `withBagUnpacked(inventory, bag)` and `scrapRobot` live beside it.
- **Robot screen:** `RobotScreenMode` and `visibleTabs(mode, unlocks)` in `src/ui/robotScreen/viewModel.ts`; `PART_LABELS`, `SIZE_LABELS` there; part icon shapes in `src/ui/robotScreen/partIcons.ts`; tabs in `src/ui/robotScreen/tabs/`. `tests/robotScreen.test.ts` tests the pure view models.
- **Items:** `src/items/items.ts` builds `ITEMS` (kinds `tool`, `seed`, `produce`, `material`, `placeable`, `fertilizer`), `getItem`, `isItemId`, `sellPrice`. Icons: `createItemIcon(item)` in `src/ui/icons.ts`. The bin refuses `sellPrice === null` with "{item} can't be shipped.".
- **Saves:** `migrateV6toV7` is last in `migrateSave`; `isValidRobotsSection` wants exact keys `['nextId','list','pool','log','lastNightFuel','zones','unlocks','pendingMarker']`; `v6Save` in `tests/testUtils.ts` is the newest older-save helper.

---

### Task 1: Save version 8, deliveries, stock counts and the renames

**Files:** `src/core/types.ts`, `src/config.ts`, `src/state/initialState.ts`, `src/state/persistence.ts`, `src/state/robotValidation.ts`, `src/state/sectionValidation.ts`, `src/people/cast.ts`, `src/people/lines.ts`, `src/world/maps/town.ts`, `src/render/npcProps.ts` (comments), `tests/testUtils.ts`, `tests/saveV8.test.ts` (new), and every test and playbook that names `bram` / `tess` (grep `-i "bram\|tess"` across `src`, `tests` and `.claude/skills`), plus existing save tests that assert version 7.

**Changes:**
- `SAVE_VERSION = 8`. `export interface RobotDelivery { readonly size: RobotSize; readonly name: string }`; `RobotsState.deliveries: readonly RobotDelivery[]`; defaults to `[]`.
- `config.ts`: `export const SHOP_STOCK = { partsPerDay: 2, robotsPerSizePerDay: 1, seedsPerDay: 30 } as const` (spec §6). `types.ts`: `export const BASIC_PART_IDS = ['claw', 'wateringHead', 'tiller', 'seeder', 'basket', 'sensorEye'] as const satisfies readonly RobotPartId[]` and `type BasicPartId`; `export interface ShopsSoldToday { readonly parts: Readonly<Record<BasicPartId, number>>; readonly robots: Readonly<Record<RobotSize, number>>; readonly seeds: Readonly<Record<SeedItemId, number>> }`; `GameSections.shopsSoldToday`, all zeros from `createDefaultSections()`.
- **Renames (spec §8):** `NPC_IDS` becomes `['sol', 'cosmo', 'barnaby', 'marigold', 'berlioz', 'juniper', 'tallulah']`; `CAST`, `CAST_LOOKS`, the town's `npcs`, `LINE_BANKS` (keys and the two introductions verbatim from spec §8) and `KEPT_NPCS` follow.
- `migrateV7toV8(save)`: `robots.deliveries = []`; `shopsSoldToday` from `createDefaultSections()`; the `npcs` keys `bram` → `berlioz` and `tess` → `tallulah` (values unchanged, other keys kept); `quests.board.npc` and `festival.giftTarget` renamed the same way; version 8; chained after the v6 step. `migrateV6toV7` keeps producing v7 data, so its kept ids stay the literals `bram` and `tess`.
- `sectionValidation.ts`: `shopsSoldToday` with exact keys and ids, counts `isIntIn(n, 0, <that shop's daily stock>)`.
- `isValidRobotsSection`: the exact keys gain `'deliveries'`; each delivery has exactly `size` (`ROBOT_SIZES`) and `name` (`isValidName`); `list.length + deliveries.length <= ROBOTS.maxRobots`.
- `tests/testUtils.ts`: `export function v7Save(state: GameState): SaveJson` (throws when deliveries aren't empty or any stock is sold; deletes both fields; renames `berlioz` / `tallulah` back to `bram` / `tess` in `npcs`, the board and the gift target); `v6Save` starts from it.

**Tests (`tests/saveV8.test.ts`):** current version; round trip with two deliveries and some stock sold; v7 → v8 (deliveries, stock, the npcs rename with a board from Bram and Tess as gift target following it); the v2 fixture to 8; corrupted fields (missing key, extra key, bad size, bad name, robots plus deliveries over 12, a stock count above its daily amount, an old id `bram`); a later version left for the validator. Version literals in older save tests move from 7 to 8. `tests/cast.test.ts` and `tests/lines.test.ts` pin the new names and introductions.

- [ ] Write the tests, see them fail, implement, gate, commit `Farmclaws part 4b: save version 8, and Bram and Tess become Berlioz and Tallulah`.

---

### Task 2: Parts as items

**Files:** `src/core/types.ts`, `src/config.ts`, `src/items/items.ts`, `src/ui/icons.ts`, `src/ui/robotScreen/partIcons.ts` (shapes move or are shared, see below), `tests/partItems.test.ts` (new), any `Record<ItemDefinition['kind'], …>` or exhaustive switch over item kinds (grep `case 'fertilizer'`).

**Changes:**
- `ItemId` gains `RobotPartId`. `config.ts`: `export const PARTS = { prices: Readonly<Record<RobotPartId, number>> /* design §3.7 */, sellBackShare: 0.5 } as const`; the basic six are Task 1's `BASIC_PART_IDS`.
- `items.ts`: `interface PartItem { kind: 'part'; id: RobotPartId; name; price; maxStack: INVENTORY.maxStack; hasQuality: false; sellPrice: null }`, registered for every `ROBOT_PART_IDS` entry, names matching `PART_LABELS`. `export function isPartItemId(value: unknown): value is RobotPartId`.
- `planPrimaryAction`: a selected part falls back to `planInteraction`, like a material.
- Icons: the part shapes must be usable from the main chunk without importing the robot screen chunk. Move the shape data from `src/ui/robotScreen/partIcons.ts` into a main-chunk module (e.g. `src/ui/partIconShapes.ts`) that both `partIcons.ts` and `icons.ts` import; `createItemIcon` draws a part item with its shape. Keep the robot screen's icons identical.

**Tests:** every part is an item of kind `'part'` with the spec's name and price; `sellPrice` null and the bin refuses with "Claw can't be shipped."; parts stack to `INVENTORY.maxStack`; a chest round-trips parts through save validation; Space with a part selected and nothing ahead does nothing.

- [ ] Tests, implement, gate, `build:check`, commit `Farmclaws part 4b: robot parts as items`.

---

### Task 3: Sol's parts shop

**Files:** `src/core/types.ts`, `src/people/cast.ts`, `src/state/actions.ts`, `src/state/reducer.ts`, `src/input/panelKeys.ts`, `src/ui/ShopsHost.ts` (new, main chunk), `src/ui/shops/ShopsScreen.ts`, `src/ui/shops/PartsShopPanel.ts`, `src/ui/shops/shops.css`, `src/ui/shops/viewModel.ts` (new, lazy chunk), `src/ui/Hud.ts` (the seed shop leaves it) and `src/main.ts` (mount the host), `src/ui/shops/SeedShopPanel.ts` (new), `scripts/bundleRules.mjs`, `scripts/check-bundle.mjs`, `tests/partsShop.test.ts` (new), `tests/checkBundle.test.ts`.

**Changes:**
- `NPC_ACTION_KINDS` gains `'partsShop'` and `'workshop'` (Task 4 uses the second). `npcActions('sol')` → `[{ kind: 'partsShop', label: 'Shop' }]`. `talkAct`: `'partsShop'` swaps the talk panel for `{ kind: 'partsShop' }`.
- `UiPanel` gains `{ kind: 'partsShop' }` and `{ kind: 'workshop' }`. `panelKeyCommand`: E/K/Enter close both, like the talk panel.
- Actions: `{ type: 'parts/buy'; part: RobotPartId }` → `actions.buyPart(part)`; `{ type: 'parts/sell'; part: RobotPartId }` → `actions.sellPart(part)`. Reducer: no-op unless the parts shop is open and the game unpaused; buy only `BASIC_PART_IDS`; texts from spec §3.3; sell-back `Math.floor(PARTS.prices[part] * PARTS.sellBackShare)`.
- **The seed shop moves into the lazy chunk** (Eli's call, to free main-chunk room): `ShopModal` leaves `src/ui/Hud.ts` for `src/ui/shops/SeedShopPanel.ts`, with its CSS, unchanged in look and behaviour (B and Marigold's Shop still open it). `Hud.ts` no longer mounts it.
- `ShopsHost` mirrors `RobotScreenHost`: when `ui.panel.kind` is `'shop'`, `'partsShop'` or `'workshop'`, it lazy-loads `./shops/ShopsScreen` once and hands it the store; failure toasts "The shop didn't open. Try again." through `ui/notify` and closes the panel. *(New text, record as a ruling.)*
- `src/ui/shops/viewModel.ts` (pure): `partsShopView(state): { gold; buy: readonly PartRow[]; sell: readonly SellRow[] }` with the spec's lines and prices. `PartsShopPanel` renders it in the HUD's modal style.
- `bundleRules.mjs`: `SHOPS_SOURCE = 'src/ui/shops/ShopsScreen.ts'`, a `shops` role found by source map like `screen`, `SHOPS_MAX_GZIP = 20 * KIB`, and a problem when the shops code is in the main chunk.

**Tests:** Sol's chat has Shop; Shop opens the panel; buying (gold drops, part added; "You need 400g."; "Your inventory is full."; a non-basic part refused); selling at half price rounded down and the count; guards (wrong panel, paused) return the same state; `partsShopView` rows and the empty "No parts in your backpack."; `checkBundle` classifies the shops chunk and enforces 20 KiB.

- [ ] Tests, implement, gate, `build:check`, commit `Farmclaws part 4b: Sol's parts shop`.

---

### Task 4: Juniper's workshop and delivery

**Files:** `src/robots/workshop.ts` (new, pure), `src/people/cast.ts`, `src/state/actions.ts`, `src/state/reducer.ts`, `src/robots/overnight.ts`, `src/ui/shops/WorkshopPanel.ts`, `src/ui/shops/viewModel.ts`, `src/ui/shops/ShopsScreen.ts`, `tests/workshop.test.ts` (new).

**Changes:**
- `workshop.ts`: `export const WORKSHOP_ROBOTS: Readonly<Record<RobotSize, { parts: readonly RobotPartId[]; program: RobotProgram }>>` (the Claw and the harvester program from spec §4.2, built with the `b` builder's shapes); `export const WORKSHOP_NAMES` (24 names); `export function suggestedName(state): string` (spec §4.5's hash and skip rule); `export function catalogueRobot(size, name?): Robot` (a full `Robot` value for the preview, off the farm, never stored).
- `npcActions('juniper')` → `[{ kind: 'workshop', label: 'Workshop' }]`; `talkAct` opens `{ kind: 'workshop' }`.
- Action `{ type: 'workshop/order'; size: RobotSize; name: string }` → `actions.orderRobot(size, name)`. Reducer per spec §4.5 (name rule, gold, cap counting deliveries, toast).
- `overnight.ts`: a `deliverRobots(state, notes)` step before `resetForMorning` (after `setDownCarried`, so a set-down robot's tile counts as taken) adds each delivery through `addRobot` at `freeSpotNear(...)`, facing South, and pushes "Juniper delivered {name}. It's waiting by the workbench."; `deliveries` empties.
- `WorkshopPanel`: the cards and checkout of spec §4.3 from a pure `workshopView(state)`; the name field is an `<input>` with `maxLength = PROFILE.maxNameLength`, typed keys stay in the field (the HUD's `isEditableTarget` already skips game keys). The **Read program** button comes in Task 5, with the preview it opens.

**Tests:** the three catalogue robots pass `checkProgram`/`checkMd` and `addRobot`'s spec checks; prices; `suggestedName` is deterministic, skips used names (robots and deliveries) and wraps; ordering cases and guards; the cap with deliveries; delivery overnight: distinct tiles near the bench, order kept, toasts after "Good morning", a delivered robot's morning stack running (`exec.running` at 6:04); `workshopView` text.

- [ ] Tests, implement, gate, commit `Farmclaws part 4b: Juniper's workshop and next-morning delivery`.

---

### Task 5: The robot screen preview

**Files:** `src/core/types.ts`, `src/state/reducer.ts`, `src/ui/shops/WorkshopPanel.ts`, `src/ui/RobotScreenHost.ts`, `src/ui/robotScreen/viewModel.ts`, `src/ui/robotScreen/RobotScreen.ts`, `src/ui/robotScreen/tabs/*` that read the robot, `tests/robotScreen.test.ts`.

**Changes:**
- `UiPanel` robot member becomes a union: the existing `{ kind: 'robot'; robotId; mode: 'bench' | 'peek' }` plus `{ kind: 'robot'; mode: 'preview'; size: RobotSize }`. Narrow by `mode` wherever `robotId` is read (grep `panel.robotId`).
- `ui/closePanel` on a preview returns to `{ kind: 'workshop' }` instead of closing. *(Ruling: how spec §4.4's "returns to the workshop panel" is built.)*
- `WorkshopPanel` gains **Read program** on each card, opening the preview.
- The screen resolves its robot as `catalogueRobot(size)` in preview and never dispatches an edit. `visibleTabs('preview', unlocks)` → Program (read-only) and Looks. The header view shows the size and "From Juniper's workshop", no switch, no Lift off or Scrap.

**Tests (view models):** the preview's header text and buttons, its tabs, Program read-only; closing returns to the workshop; opening, switching tabs and closing leave the state equal apart from `ui.panel`.

- [ ] Tests, implement, gate, `build:check`, commit `Farmclaws part 4b: read a workshop robot's program before buying`.

---

### Task 6: Fitting parts at the workbench

**Files:** `src/robots/edits.ts`, `src/state/actions.ts`, `src/state/reducer.ts`, `src/ui/robotScreen/tabs/LooksTab.ts`, `src/ui/robotScreen/viewModel.ts`, `src/ui/robotScreen/robotScreen.css`, `tests/fitParts.test.ts` (new), `tests/robotScreen.test.ts`, `tests/robotScrapPaint.test.ts`.

**Changes:**
- `edits.ts`: `export function withPartFitted(robot: Robot, part: RobotPartId): Robot | string` and `export function withPartRemoved(robot: Robot, part: RobotPartId): Robot | string` (catalogue order, slots, duplicates, the tank, the sensor-eye refusal via `checkProgram` on the robot without the part, the basket refusal against the bag's stacks; texts from spec §5.2).
- Actions `{ type: 'robot/fit'; robotId; part }` → `actions.fitPart(robotId, part)` and `{ type: 'robot/unfit'; robotId; part }` → `actions.unfitPart(robotId, part)`. The reducer moves the item between backpack and robot around `editRobot` (inventory room first for unfit: "Your inventory is full."; the backpack must hold the part for fit), with the spec's success toasts.
- `scrapRobot`: unpack the parts with the bag (one item per part) or refuse with the existing message.
- Looks tab: the Parts section of spec §5.1 from a pure `partsSectionView(robot, mode, inventory)`.

**Tests:** fit into a free slot (catalogue order kept, item gone, toast); no free slot; duplicate; the watering head's tank; take off (item back, toast); full backpack; the sensor-eye and basket refusals; off-bench, ruined and paused refused; scrapping returns parts or refuses; the Parts section's rows for bench, peek and ruined.

- [ ] Tests, implement, gate, `build:check`, commit `Farmclaws part 4b: fit and take off parts at the workbench`.

---

### Task 7: Daily stock at all three shops

**Files:** `src/state/reducer.ts` (`buySeeds`, `parts/buy`, `workshop/order`, `startNextDay`), `src/state/selectors.ts`, `src/ui/shops/SeedShopPanel.ts`, `src/ui/shops/viewModel.ts`, `src/ui/shops/PartsShopPanel.ts`, `src/ui/shops/WorkshopPanel.ts`, `tests/shopStock.test.ts` (new), `tests/partsShop.test.ts`, `tests/workshop.test.ts`.

**Changes:**
- Pure selectors: `partsLeft(state, part)`, `robotsLeft(state, size)`, `seedsLeft(state, seedId)`: `SHOP_STOCK` minus `shopsSoldToday`.
- Each buy or order checks and counts its stock with spec §6's toasts; a seed buy over what's left gives "Only {n} left today." (none left: "Out of stock. Marigold restocks tomorrow."). Selling back to Sol doesn't touch stock.
- `startNextDay` resets `shopsSoldToday`, keeping the same object when nothing was sold.
- The three panels show "{n} left", disable what can't be bought, and show "Out of stock" / "Sold out today". The seed shop is in the lazy chunk since Task 3.

**Tests:** each shop sells exactly its daily amount, then refuses with its toast; partial seed buys; selling back doesn't restock; the morning reset (and the same object when nothing sold); a mid-day save keeps the counts; the view rows' "{n} left" and sold-out states.

- [ ] Tests, implement, gate, `build:check`, commit `Farmclaws part 4b: daily stock at every shop`.

---

### Task 8: The shopfronts and FarmClaw posters

**Files:** `src/render/townGeometry.ts`, `src/render/posters.ts` (new: the atlas layout, pure, plus the canvas drawing), `src/render/StructureRenderer.ts` (one poster mesh per map with posters), `tests/scenery.test.ts`, `tests/posters.test.ts` (new).

**Changes:**
- Parts exchange: a display stand by the door with a claw, a watering head and a sensor eye (small merged shapes in the robot parts' colours). Carpenter (Juniper's workshop): a static Mini on a low stand beside the door, built from the robot geometry builders' shapes and merged into the painted body (no lights, no sway), and a crate of planks and cogs. All inside each building's rect on its front face, in named shape constants, keeping the occlusion rule; no tile changes.
- `posters.ts`: `export const POSTERS` (each `{ id, brand, slogan, picture }`; 4b's three FarmClaw posters with spec §7's text verbatim); `export function posterAtlasLayout(): Readonly<Record<PosterId, { u0, v0, u1, v1 }>>` (pure); `createPosterAtlas(): THREE.CanvasTexture` (draws every poster once with `fillText` and simple shapes). Town structures place poster quads (UV'd into the atlas) on the two shop fronts; `StructureRenderer` merges a map's poster quads into one mesh with one material, built only when the map has posters. Tests run in node without a canvas: keep the drawing behind a factory, as `NpcRenderer` does for nameplates.

**Tests:** props and poster quads stay inside their rects and pass the occlusion helper; the town's blocked-tile set is unchanged (the existing pinned test); the atlas cells cover every 4b poster without overlapping; the posters' brand and slogan text is the spec's; the town gains exactly one draw call for posters.

- [ ] Tests, implement, gate, `build:check`, commit `Farmclaws part 4b: stands, props and FarmClaw posters at Sol's and Juniper's`.

---

### Task 9: Playbook and spec sync

**Files:** `.claude/skills/game-driven-qa/scenarios/farmclaws-part4b.md` (new), `.claude/skills/game-driven-qa/SKILL.md`, `docs/superpowers/specs/2026-09-29-farmclaws-design.md`, `docs/superpowers/specs/2026-10-09-farmclaws-part4b-shops-design.md`.

**Changes:**
- The playbook: spec §11's six checks as short snippets (setup through `__qa.fixtures()`, state read back with `__qa.state()`); no "Last run" line, since Eli plays it.
- `SKILL.md`: rows for Sol's shop, Juniper's workshop (and that orders arrive after `__qa.sleep()`), and fitting parts on the bench.
- The design: spec §14's edits (§9.2, the renames in §9.2, §10 and §15, and §11.2's new parts 4d and 4e with their brand posters).
- The part 4b spec: a "Plan refinements" section with every `Ruling:` line from the part 4b commit bodies (`git log --grep='^Farmclaws part 4b' --format='%h %b'`), and the sections they change reworded.

- [ ] Write, gate with `build:check`, commit `Farmclaws part 4b: playbook and spec sync`.
