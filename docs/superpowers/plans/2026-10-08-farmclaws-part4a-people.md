# Farmclaws Part 4a: People Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Seven characters stand on fixed spots in the town and on a new Neighbours map. The player walks up to them and talks with E: a chat box shows a line picked deterministically from the character's bank, and Marigold's **Shop** button opens the seed shop. Sol's parts exchange replaces the town's notice board. All of it is saved in save version 7.

**Architecture:** The cast is pure data in a new `src/people/` (`cast.ts`: names, spots' lookup, looks, actions; `lines.ts`: line banks and `lineFor`). Spots live on the map definitions (`MapDefinition.npcs`), so the startup check, movement, placement and the renderer all read one list. Talking is an ordinary intent (`talkTo`) that the reducer turns into a `talk` panel carrying the line it picked, plus a recorded chat in the reshaped `npcs` section. The chat box is a main-chunk HUD widget. The Neighbours map is a fixed 40 × 28 map like the town, reached through a new east gate. A new render system draws the characters with the player's model and a prebuilt nameplate per character.

**Tech Stack:** TypeScript (strict, `erasableSyntaxOnly`), Three.js, Vite, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-06-farmclaws-part4a-people-design.md`, within the umbrella design `docs/superpowers/specs/2026-09-29-farmclaws-design.md` (sections 8, 9 and 11.2). Read the part 4a spec before starting; it is the binding authority. Where this plan refines it, the refinement is listed below, and Task 10 writes it into the spec.

## Global Constraints

- The simulation stays pure and deterministic: no `Math.random`, no clock reads and no I/O in `src/core`, `src/state`, `src/world`, `src/farming`, `src/time`, `src/robots` or the new `src/people`. The chat box lives in `src/ui`, the characters' models and nameplates in `src/render`.
- Strict TypeScript with `erasableSyntaxOnly`: no enums, no namespaces, no parameter properties, `as const` objects plus union types, `import type` for types. `noUnusedLocals` and `noUnusedParameters` are on, and `tests/` is typechecked too.
- No TODOs, placeholders or stubs.
- `npm run typecheck && npm test && npm run build` pass after every task. Task 10 also runs `npm run build:check`.
- State is immutable, with structural sharing: an unchanged map, chunk, tile or `npcs` entry keeps its reference. The morning reset returns the same `npcs` object when no one was talked to.
- Every saved field a task adds goes into its type, `createInitialState` / `createDefaultSections`, `migrateV6toV7` and validation **in the same task**, and `v6Save` in `tests/testUtils.ts` learns to take it out again, so a save loads after every task.
- Numbers come from config (`PEOPLE`, `NPC_LOOKS`, `NEIGHBOUR_ROOFS`, plus the existing `ROBOT_SCREEN`, `APPEARANCE`, `WORLD`), never inline.
- Production code never contains `setMd`, `setZone`, `unlockAll`, `robotLog`, `installRobotDev` or `addScriptedRobot`, in comments and strings included. New action types read `talk/act`, never anything with those substrings.
- Player-facing text is copied verbatim from the spec, including punctuation (straight apostrophes, as the spec writes them).
- Text reaches the DOM through `textContent` only. The nameplates draw names onto a canvas with `fillText`.
- `src/ui/robotScreen/` and Blockly stay behind their dynamic imports. Nothing in this plan imports them.
- Commit messages: `Farmclaws part 4a: ` plus a short, plain summary, then why. They end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (plus the session's own `Claude-Session:` line when the executing session has one).

## Review Focus

1. **A v6 save made mid-day in town, with Bram talked to 12 times today, a weekly board request from Pip, and Fennick as the festival's gift target.** It loads as v7: Bram keeps `talks: 12, talkedToday: true`, Sol, Cosmo and Barnaby start at 0, the board and the gift target are null, the player is still in town, and `maps.neighbours` is the fixed map. Pinned in Task 1 (npcs, board, gift target) and Task 4 (the map), each adding its case to `tests/saveV7.test.ts`.
2. **The version-2 fixture.** `migrateV2toV3` spreads `createDefaultSections()` into the save, so a v3 save built that way already holds the **v7** `npcs` shape. `migrateV6toV7` must accept both the v6 shape and that one. Pinned in Task 1 ("migrates the version-2 fixture through every version to 7").
3. **The first chat shows the introduction.** `lineFor` reads `talks`, and the chat records `talks + 1`, so the line must be picked before the chat is recorded and must not change while the box is open. The `talk` panel carries the line (R6). Pinned in Task 6.
4. **Every character's spot is legal and reachable**, and a broken spot fails the startup check with a message naming the character. Pinned in Task 2 (town) and Task 4 (Neighbours), with one failing definition per rule in `tests/cast.test.ts`.
5. **The town's blocked tiles are exactly the same** after the parts exchange replaces the notice board and three hedges, so saved town tiles need no migration. Pinned in Task 3.
6. **A character's tile acts like a structure with someone to talk to.** E and Shift + E talk; Space talks with empty hands (it falls back to E) and while carrying (`planCarry` checks for a character first); a placeable is refused with "Someone's standing there."; walking into the tile is refused silently. Pinned in Task 2 (placement, movement) and Task 6 (the keys).

---

## File map

| File | Responsibility |
| --- | --- |
| `src/core/types.ts` | `SAVE_VERSION = 7`, new `NPC_IDS`, `NpcTalk`, `GameSections.npcs`; `NpcRelation` and `HeartEventLevel` removed (T1); `'partsExchange'` replaces `'noticeBoard'` in `STRUCTURE_KINDS` (T3); `'neighbours'` in `MAP_IDS`, `'cosmoHouse'`, `'barnabyHouse'`, `'chickenCoop'` in `STRUCTURE_KINDS` (T4); `UiPanel` talk kind (T6); `NPC_ACTION_KINDS`, `NpcActionKind` (T2) |
| `src/config.ts` | `PEOPLE` (T5); `NPC_LOOKS` (T8); `NEIGHBOUR_ROOFS` (T9) |
| `src/core/hash.ts` | `Salt.MapNeighbours` (T4) |
| `src/state/initialState.ts` | `npcs` defaults (T1) |
| `src/state/sectionValidation.ts` | `isValidNpcs` with exact `NpcTalk` keys (T1) |
| `src/state/persistence.ts` | `migrateV6toV7` (T1, grown by T4) |
| `src/people/cast.ts` | `CAST`, `CAST_LOOKS`, `npcAt`, `npcSpot`, `npcActions`, `NpcAction` (T2) |
| `src/people/lines.ts` | `LINE_BANKS`, `lineFor`, `reactiveLine` (T5) |
| `src/world/maps/types.ts` | `NpcPlacement`, `MapDefinition.npcs` (T2) |
| `src/world/maps/index.ts` | `assertNpcPlacements` in `assertMapDefinitions` (T2, tightened in T4); `MAPS.neighbours`, `generateMaps` (T4) |
| `src/world/maps/lookup.ts` | `arrivalTiles` (T2); `mapSeed` case `'neighbours'` (T4) |
| `src/world/maps/town.ts` | town `npcs` (T2); the parts exchange (T3); the east gate (T4) |
| `src/world/maps/farm.ts`, `src/world/maps/forest.ts` | `npcs: []` (T2) |
| `src/world/maps/neighbours.ts` | the Neighbours map, `assertNeighboursLayout` (T4) |
| `src/state/intents.ts` | "Someone's standing there." in `placementProblem` (T2); `talkTo` intent, character first in `planCarry`, `planInteraction` and `planShiftInteraction` (T6); "That belongs to the neighbours." in `planPickUp` (T4) |
| `src/state/reducer.ts` | characters block `movePlayer` (T2); `talkTo` in `applyIntent`, the morning reset in `startNextDay` (T6); `talk/act` (T7) |
| `src/state/actions.ts` | `talk/act`, `actions.npcAct` (T7) |
| `src/input/panelKeys.ts` | the talk panel's keys (T6) |
| `src/ui/chatBoxView.ts`, `src/ui/ChatBox.ts`, `src/ui/hud.css`, `src/ui/Hud.ts` | the chat box (T7) |
| `src/render/townGeometry.ts` | the parts exchange (T3); the Neighbours houses and coop, `assertNever` in `structureParts` (T9) |
| `src/render/structureGeometry.ts`, `src/render/StructureRenderer.ts` | `farmhousePlacement`, the farmhouse's optional roof colour, the coop (T9) |
| `src/render/palette.ts`, `src/render/playerModel.ts`, `src/render/PlayerRenderer.ts` | appearance palettes, `PlayerModel` with an `Appearance`, hair and hat styles, `EMPTY_HANDED_POSE` (T8); `Appearance`'s doc comments in `src/core/types.ts` (T8) |
| `src/render/NpcRenderer.ts`, `src/render/npcProps.ts`, `src/render/nameplates.ts`, `src/main.ts` | the characters, their props, idle sway and nameplates (T8) |
| `tests/testUtils.ts` | `v6Save` (T1, grown by T4); `livelySections` (T1) |
| `tests/saveV7.test.ts` | created in T1, grown by T4 |
| `tests/cast.test.ts` | T2, grown by T4 |
| `tests/maps.test.ts` | parts exchange (T3); east gate (T4) |
| `tests/scenery.test.ts` | the parts exchange's glass and geometry (T3); the warp openings (T4) |
| `tests/warps.test.ts`, `tests/determinism.test.ts`, `tests/sections.test.ts` | the fourth map (T4) |
| `tests/neighboursMap.test.ts` | T4 |
| `tests/lines.test.ts` | T5 |
| `tests/talk.test.ts` | T6, grown by T7 |
| `tests/chatBox.test.ts` | T7 |
| `tests/npcRender.test.ts` | T8 |
| `tests/neighbourBuildings.test.ts` | T9 |
| `.claude/skills/game-driven-qa/scenarios/farmclaws-part4a.md`, `.claude/skills/game-driven-qa/SKILL.md`, the specs | playbook and spec sync (T10) |

---

## Facts every task needs

- **Baseline.** On `p4a-people` at the spec commit (`245409a`), `npm test` runs 69 test files and 2,062 tests, all passing, and `npm run typecheck` is clean. `node_modules` isn't checked in: run `npm ci` once in a fresh checkout.
- **Store and actions.** `src/state/actions.ts` holds `GameAction` (a union of `{ type: 'area/verb', ... }`) and the `actions` creator object. `src/state/reducer.ts`'s `reduceAction` switches on `action.type` and ends in a `never` check. Intents (`src/state/intents.ts`) are plans: `planInteraction` (E), `planPrimaryAction` (Space; empty hands and non-tools fall back to `planInteraction`), `planShiftInteraction` (Shift + E), and private `planCarry` (while carrying, both E and Space go there first). The reducer runs `executePlan(state, plan)`; a `blocked` plan with a reason becomes a warn toast and records a failed action; `applyIntent` switches on `intent.kind`. `describeIntent(intent)` is the HUD hint. Toasts: `pushMessage(state, text, tone)` from `src/state/messages.ts`.
- **Panels.** `UiPanel` (types.ts ~line 465) is `none | shop | inventory | chest | robot`. Any panel but `none` freezes the clock and the player (`selectIsFrozen`). The loader (`deserializeGame`) and `game/load` reset the panel, so a new panel kind needs no migration, and `isValidUi` only checks that `panel.kind` is a string. `setPanelOpen(state, { kind: 'shop' }, true)` opens the shop only when no panel is open and the game isn't paused. `ui/closePanel` closes whatever is open.
- **Panel keys.** `src/input/panelKeys.ts`: `panelKeyCommand(code, state, shift)` decides I / E / K / Enter / B / Escape from state alone; `INTERACT_KEYS`; `isInventoryScreenOpen(state)`; while the robot panel is open it returns null for every key.
- **Maps.** `src/world/maps/types.ts`: `MapDefinition` (`id`, `name`, `grid`, `allowsTilling`, `warps`, `reserved`, `structures`, `wild`, `farmstead`, `scenery`, `decor`, `cosmeticOffset`, `isShaded`, `surfaceAt`, `generate`), `Warp` (`from`, `exit`, `to: { mapId, tx, tz, facing }`), `StructurePlacement` (`kind`, `rect`, `door`), `Surface = 'grass' | 'dirt' | 'cobble'`, `SceneryStyle = 'farm' | 'forest' | 'town'`. `src/world/maps/index.ts`: `assertMapDefinitions(defs)` runs at module load (`assertWarps`, `assertStructures`, `assertFarmSpawn`, `assertTownLayout`); `MAPS`, `getMap`, `generateMaps(seed)` (spells out every map), `MAX_MAP_TILE_COUNT`. `src/world/maps/lookup.ts`: `mapSeed(seed, id)` (exhaustive switch), `findWarp`, `isReservedTile`, `structureAt`, `precomputeMask`, `precomputeSurfaces`, `coordIn`. The town (`town.ts`, 40 × 32) generates the same world for every seed: structures become `blockedTile(Blocker.Building)`, the river `Blocker.Water`, the rest `EMPTY_TILE`; it exports `TOWN_BACK_BAND_DEPTH` (7), `TOWN_MAIN_STREET` (z 15–17), `TOWN_SQUARE` (x 14–25, z 7–19), `TOWN_DIRT_PATHS`, `isTownRiver`, `assertTownLayout`. The town's one warp leaves West from (0, 16) to the farm (46, 38); its reserved tiles are (0, 16) and (1, 16).
- **Tiles.** `src/world/tiles.ts`: `EMPTY_TILE` (Unplowed, no blocker), `blockedTile(blocker, hp)`, `createWorld(grid, tileAt)`, `getTile`, `requireTile`, `setTile`, `isWalkable(tile)` (not Blocked, and no object or only a path object; a `woodFence` blocks), `isSoil`. A wood fence is the placed object `{ kind: 'woodFence' }`. `assertWorldObjectsConsistent(world)` is part of save validation.
- **Movement.** `movePlayer` in the reducer: a step inside the grid needs `isWalkable(destination)`; stepping off the edge takes the warp, unless the player is carrying a robot ("Put {name} down before you leave the farm."). So the player only ever carries a robot on the farm, where no character stands.
- **Overnight.** `startNextDay(state, passedOut)` runs `advanceWorldOvernight` with sprinklers on every map in `MAP_IDS` order, moves the player home, then `runRobotsOvernight`, then pushes the morning toasts.
- **Persistence.** Migrations work on raw parsed JSON (`Obj`) one version at a time: `migrateSave` chains `migrateV1toV2` … `migrateV5toV6` (followed by `migrateZoneMarker`), each writing its own literal version; then `isValidGameState` validates. `migrateV2toV3` spreads `createDefaultSections()` into the save and generates the forest and the town with `MAPS[id].generate(save.seed)`. `isValidMaps` wants exactly the `MAP_IDS` keys. `isValidPlayer` wants the player on a walkable tile of `maps[player.mapId]`. `isValidSections` (`src/state/sectionValidation.ts`) checks `npcs`, `quests.board.npc` and `festival.giftTarget` against `NPC_IDS`. `isValidRobotsSection` keeps robots on the farm.
- **Validation helpers** (`src/state/validation.ts`): `hasExactKeys`, `isBool`, `isCount` (non-negative integer), `isInt`, `isIntIn`, `isObj`, `isOneOf`, `isCanonicalSubset`, `isValidStack`, `type Obj`.
- **Items.** `getItem(itemId)` (`src/items/items.ts`) returns a definition whose `kind` is `'tool' | 'seed' | 'produce' | 'material' | 'placeable' | 'fertilizer'`. `countItem(inventory, itemId)` is in `src/state/inventory.ts`. Copper ore's id is `'copperOre'`.
- **Robots.** `robotOnBench(state)` (`src/robots/workbench.ts`) is the robot on the workbench or null. A robot's `power` includes `'broken'` and `'ruined'`. `state.robots.log.entries` are `RobotLogEntry { id, day, minute, robotId, tx, tz, event, count }`; a Say is `event: { kind: 'did', action: 'say', detail }`.
- **Time and weather.** `state.time.absoluteDay`, `state.time.season`; `SEASON_NAMES[season]` ("Spring", …) in types.ts; `weatherWaters(weather)` in `src/time/weather.ts`.
- **Hashing.** `hash32(...values)` and `hashFloat(...values)` in `src/core/hash.ts`; per-feature salts live in `Salt`.
- **HUD.** `src/ui/Hud.ts` composes widget classes, each with `sync(state, prev)`; `ContextHint` shows `describeIntent(planPrimaryAction(state).intent)` and `describeIntent(planInteraction(state).intent)`; `ShopModal` is the seed shop. DOM helpers in `src/ui/dom.ts`: `h`, `hudButton`, `setText`, `setHidden`, `setAttr`. Styles are in `src/ui/hud.css`.
- **Render.** `src/main.ts` builds `systems: RenderSystem[]` (each has `sync(state, prev)`, `update(frame)`, `dispose()`; `sync(state, null)` is a full rebuild). `StructureRenderer` builds one cached scenery per map from its definition: `planScenery(def)` (`sceneryGeometry.ts`, style profiles: the farm style has a wooden fence round the grid), the farmstead (`createFarmhouseGeometry(spec: FarmhouseSpec)` in `structureGeometry.ts`) only where `def.farmstead` isn't null, and `mapStructureParts(def, parts)` from `townGeometry.ts` for `def.structures` (`structureParts` switches on the kind; the shop kinds go through `shopParts`). `PlayerModel` (`src/render/playerModel.ts`) is the player's low-poly rig, vertex-coloured with fixed colours today; `PlayerRenderer` drives it. `APPEARANCE` (config) gives only the palette sizes ("Index 0 of every palette is the original look"); no palettes exist yet.
- **Tests run in `node`** (`vite.config.ts`: `environment: 'node'`). DOM widgets are tested through pure view functions, as the robot screen's `viewModel.ts` is; the DOM itself is checked in the browser playbook.
- **Test helpers** (`tests/testUtils.ts`): `BASE` (a frozen `createInitialState()`), `STAND` (5, 9), `TARGET` (5, 10), `must`, `tileAt`, `withTile`, `withPlayer(state, coord, facing, mapId?)`, `stack`, `withSlots`, `holding`, `emptyHanded`, `withEnergy`, `withGold`, `atDay(state, day, minute)`, `reachableFrom(world, start)`, `type SaveJson`, `legacySave(state, 1 | 2)` (starts from `v5Save`), `v5Save(state)` (a v6 state as v5 JSON), `livelySections()` (every section far from its defaults; today it uses friendship fields and `giftTarget: 'pip'`), `robotOf(overrides)`, `benchedRobotOf`, `withRobots`, `withZones`. The v2 fixture is `tests/fixtures/save-v2.json` (import it with `?raw`).
- **Town layout around the cast.** Shop doors and the tiles in front of them: general store (6, 6) → (6, 7); blacksmith (15, 6) → (15, 7); carpenter (25, 6) → (25, 7); ranch (34, 6) → (34, 7). A lamp post stands at (26, 8). The notice board covers (19–20, 6); hedges cover x 18–21, z 0–5, and (18, 6), (21, 6).

---

## Interface contract

Every task's **Interfaces** block repeats the part of this contract it consumes and produces. Names, parameter orders and strings here are binding; a task that needs something not listed adds it to its own Produces and says so.

**Settled while drafting the tasks** (each task's own Interfaces block is the final word, and these are the places it differs from or adds to the contract below):
- Task 2 also exports `reachableTiles(world, starts, isClosed)` from `lookup.ts`, which `assertNpcPlacements` and Task 4's `assertNeighboursLayout` share; its error messages end `is out of bounds`, `is not walkable`, `is on a reserved tile`, `is on a door or the tile in front of one`, `shares its tile with {other}` and `can't be reached from the map's arrival tiles`.
- Task 3 adds `'cogClaw'` to `ShopEmblem` and exports `PARTS_EXCHANGE_STYLE` and `PARTS_EXCHANGE_SHAPE`; `FEATURE.notice` becomes `FEATURE.crate` (same salt).
- Task 4 exports `FenceRing`; narrows `npcSpot` to non-null; refuses only fence-ring objects (R9); makes `v6Save` also throw when the Neighbours map differs from a fresh one; has `assertNeighboursLayout` check every reserved tile is clear; and makes the determinism test's traveller step round character tiles.
- Task 5 names `reactiveFill`'s return type `LineFill`.
- Task 7's widget root is `element` (like every HUD widget), it exports `ChatBoxContext`, and `talk/act` does nothing while paused (R8).
- Task 8 builds props in the space of their bone (R15), gives `NpcRenderer` an optional nameplate-texture factory for the node tests, and fixes the hat and hair meanings (R14); Task 2's `CAST_LOOKS` uses them.
- Task 9 moves the farmhouse placement into `structureGeometry.ts` (`farmhousePlacement`, `FARMHOUSE_INSET`, `FARMHOUSE_STEP_DEPTH`), adds `createCoopParts`, ends `structureParts` with `assertNever`, and tests in its own file.

#### Contract for Task 1: Save version 7 and the `npcs` reshape
- `types.ts`: `SAVE_VERSION = 7 as const`. `NPC_IDS = ['sol', 'cosmo', 'barnaby', 'marigold', 'bram', 'juniper', 'tess'] as const`. `export interface NpcTalk { readonly talks: number; readonly talkedToday: boolean }` (doc comments: lifetime chats, rotates nothing in 4a but picks the introduction; a chat today, reset each morning). `GameSections.npcs: Readonly<Record<NpcId, NpcTalk>>`. `NpcRelation` and `HeartEventLevel` are deleted.
- `initialState.ts`: every id starts at `{ talks: 0, talkedToday: false }`.
- `sectionValidation.ts`: `isValidNpcs` wants exactly the seven ids, each an object with exactly the keys `talks` (`isCount`) and `talkedToday` (`isBool`). `MAX_NPC_POINTS` and `HEART_EVENT_LEVELS` are deleted. `quests.board.npc` and `festival.giftTarget` keep checking `NPC_IDS`, which now holds only the new ids.
- `persistence.ts`: `function migrateV6toV7(save: Obj): Obj` (private), chained in `migrateSave` after the v5 step: `if (isObj(v) && v.version === 6) v = migrateV6toV7(v);`. It writes `version: 7`; `npcs` becomes the seven ids, where Marigold, Bram, Juniper and Tess keep their saved `talks` and `talkedToday` (copied as found, so a corrupt value still fails validation; a missing or non-object entry passes through for the validator to reject), and Sol, Cosmo and Barnaby start at `{ talks: 0, talkedToday: false }`; every friendship field, Fennick and Pip are dropped; `quests.board` becomes null when its `npc` is `'fennick'` or `'pip'`; `festival.giftTarget` becomes null when it is `'fennick'` or `'pip'`. It accepts a save whose `npcs` already has the v7 shape (Review Focus 2).
- `tests/testUtils.ts`: `export function v6Save(state: GameState): SaveJson`, the v6 JSON of a v7 state: `version: 6`; `npcs` back to the six v6 ids, each as a v6 relation (`points: 0, talkedToday, giftsToday: 0, giftsThisWeek: 0, heartEventsSeen: [], talks`), Fennick and Pip at the idle relation, and it throws when Sol, Cosmo or Barnaby isn't at `{ talks: 0, talkedToday: false }` (a v6 save can't express them). `v5Save` now starts from `v6Save(state)` instead of `serializeGame`, so every older-save builder inherits it. `livelySections()` gives Bram `{ talks: 40, talkedToday: true }` and Tess `{ talks: 3, talkedToday: false }`, keeps a board request from `'juniper'`, and makes the gift target `'tess'`.
- `tests/saveV7.test.ts` (create): "save version 7" (current version, round trip of a farm with lively sections) and "v6 → v7" (the npcs reshape, Fennick's board and Pip's gift target dropped, a v7-shaped `npcs` accepted, the v2 fixture through every version to 7, a later version left for the validator). Later tasks add cases.
- Existing tests that assert version 6, list the friendship keys or build `npcs` by hand move to the new shape: at least `tests/sections.test.ts`, `tests/persistence.test.ts`, `tests/robotSaveV6.test.ts`, `tests/robotSaveV5.test.ts`, `tests/robotSave.test.ts`, `tests/maps.test.ts`.

#### Contract for Task 2: The cast, spots on the map, blocking
- `types.ts`: `export const NPC_ACTION_KINDS = ['shop'] as const; export type NpcActionKind = (typeof NPC_ACTION_KINDS)[number];`.
- `src/world/maps/types.ts`: `export interface NpcPlacement { readonly id: NpcId; readonly tx: number; readonly tz: number; readonly facing: Direction }`; `MapDefinition.npcs: readonly NpcPlacement[]` (doc: the characters standing on this map, each on a fixed spot; their tiles block the player like a structure). Farm and forest: `npcs: []`. Town: Sol (21, 7), Marigold (7, 7), Bram (16, 7), Juniper (24, 7), Tess (35, 7), all facing `Direction.South`.
- `src/world/maps/lookup.ts`: `export function arrivalTiles(defs: Readonly<Record<MapId, MapDefinition>>, id: MapId): readonly TileCoord[]` — every warp `to` tile on map `id`, from every map's warps, in `MAP_IDS` order then warp order.
- `src/world/maps/index.ts`: private `assertNpcPlacements(defs)`, called from `assertMapDefinitions` after the per-map loop. Per map, per placement, it throws a `RangeError` whose message starts `Map {id}: {npc} at ({tx}, {tz}) ` when the spot: is out of bounds; isn't walkable in `def.generate(0)`; is reserved; is a structure's door tile or the tile in front of a door (door `tz + 1`); shares a tile with another character; or isn't reachable (R5: no orthogonal neighbour that is walkable, not another character's spot, and reachable from one of `arrivalTiles(defs, id)` walking over walkable tiles that aren't character spots). Across maps: an id placed twice throws `Character {npc} is placed more than once`. (Task 4 adds: an id placed nowhere throws `Character {npc} is placed on no map`.)
- `src/people/cast.ts` (pure; imports `MAPS` from `../world/maps` and types only):
  - `export interface CastMember { readonly name: string; readonly role: string }`; `export const CAST: Readonly<Record<NpcId, CastMember>>` with the spec §2.1 names and role lines.
  - `export const NPC_PROPS = ['toolApron', 'featherHat', 'clipboard', 'seedPouch', 'smithApron', 'pencil', 'neckerchief'] as const; export type NpcProp = (typeof NPC_PROPS)[number];`
  - `export interface CastLook { readonly appearance: Appearance; readonly prop: NpcProp }`; `export const CAST_LOOKS: Readonly<Record<NpcId, CastLook>>` (each appearance index within its `APPEARANCE` range; props per spec §2.3: Sol `toolApron`, Cosmo `featherHat`, Barnaby `clipboard`, Marigold `seedPouch`, Bram `smithApron`, Juniper `pencil`, Tess `neckerchief`).
  - `export function npcAt(mapId: MapId, tx: number, tz: number): NpcId | null`.
  - `export function npcSpot(npc: NpcId): { readonly mapId: MapId; readonly placement: NpcPlacement } | null` (null only until Task 4 places Cosmo and Barnaby; from Task 4 every id has a spot).
  - `export interface NpcAction { readonly kind: NpcActionKind; readonly label: string }`; `export function npcActions(npc: NpcId): readonly NpcAction[]` — Marigold `[{ kind: 'shop', label: 'Shop' }]`, everyone else `[]` (the same frozen empty array).
- `src/state/intents.ts`: `placementProblem` returns `"Someone's standing there."` when `npcAt(state.player.mapId, target)` isn't null, checked after the farm-only rule and before the reserved-tile rule.
- `src/state/reducer.ts`: `movePlayer` refuses a step onto a character's tile silently, exactly like an unwalkable tile (the player turns to face it).
- `tests/cast.test.ts` (create): every placement passes the rules and `npcAt` finds it; one broken definition per startup rule; movement and placement blocked; `npcActions`.

#### Contract for Task 3: The parts exchange
- `types.ts`: `STRUCTURE_KINDS` loses `'noticeBoard'` and gains `'partsExchange'` in its place (same position).
- `town.ts`: `{ kind: 'noticeBoard', ... }` and `hedge(18, 0, 4, 6)`, `hedge(18, 6, 1, 1)`, `hedge(21, 6, 1, 1)` are replaced by `{ kind: 'partsExchange', rect: rect(18, 0, 4, 7), door: { tx: 20, tz: 6 } }`, listed after the ranch. Comments and `assertTownLayout`'s message say "parts exchange" where they said "notice board".
- `townGeometry.ts`: `partsExchangeParts(grid, offset, s, out)` replaces `noticeBoardParts` (R3): a narrow two-storey workshop in the shops' style, a cog-and-claw sign, a big front window (glow glass), and a crate of parts by the door, all inside the rect and obeying the occlusion rule.
- `src/state/intents.ts`: the comment in `planInteraction`'s blocker switch says "the parts exchange" for "the notice board".
- `tests/maps.test.ts`: the structure at (20, 6) is the parts exchange; the town's blocked-tile set equals the pre-change set (pinned as the literal rect union x 18–21, z 0–6 plus every other structure); `assertTownLayout` fixtures updated.

#### Contract for Task 4: The Neighbours map and the east gate
- `types.ts`: `MAP_IDS = ['farm', 'forest', 'town', 'neighbours'] as const`. `STRUCTURE_KINDS` gains `'cosmoHouse'`, `'barnabyHouse'`, `'chickenCoop'` (R1) at the end.
- `hash.ts`: `Salt.MapNeighbours` (a new 32-bit odd constant not already in `Salt`); `mapSeed(seed, 'neighbours')` is `hash32(seed, Salt.MapNeighbours)`.
- `src/world/maps/neighbours.ts`:
  - `export const NEIGHBOURS_BACK_BAND_DEPTH = 5`; `export const NEIGHBOURS_LANE` = rect (0, 13, 40, 3); `export const COSMO_FIELD` = rect (4, 6, 6, 6) and `export const BARNABY_FIELD` = rect (21, 17, 8, 8) (the insides); `export const COSMO_FENCE` and `BARNABY_FENCE`: `{ readonly corners: readonly [TileCoord, TileCoord]; readonly gap: TileCoord }` with corners (3, 5)–(10, 12), gap (6, 12) and (20, 16)–(29, 25), gap (24, 16); `export function isFenceTile(tx, tz): boolean`.
  - Structures: `{ kind: 'cosmoHouse', rect: (3, 0, 6, 5), door: (5, 4) }`, `{ kind: 'chickenCoop', rect: (11, 0, 4, 5), door: null }`, `{ kind: 'barnabyHouse', rect: (24, 0, 6, 5), door: (26, 4) }`, hedges at x 0–2, 9–10, 15–23, 30–39 over z 0–4.
  - `surfaceAt`: `'dirt'` on the lane and inside both fields, else `'grass'`. `isShaded`: never. `allowsTilling: false`, `wild: null`, `farmstead: null`, `scenery: 'farm'` (R12), `decor: { tuftChance: 0.3, flowerChance: 0.06 }`, `cosmeticOffset: { x: 5003, z: 6011 }`, `name: 'The Neighbours'` (R11).
  - `generate()`: structures → `blockedTile(Blocker.Building)`, fence tiles → `{ ...EMPTY_TILE, object: { kind: 'woodFence' } }`, everything else `EMPTY_TILE`; identical for every seed.
  - Warp: West from (0, 14) → town (38, 16), facing West. Reserved: (0, 14), (1, 14).
  - `npcs`: Cosmo (7, 13) facing South, Barnaby (25, 15) facing North.
  - `export function assertNeighboursLayout(def: MapDefinition): void`: the back band covered exactly once by houses, the coop and hedges; nothing else in the back band; no structure outside it; both fence rings complete except their gaps; the gaps walkable; every walkable tile of `def.generate(0)` reachable from the arrival tile (1, 14).
- `town.ts`: warp East from (39, 16) → neighbours (1, 14), facing East; reserved gains (39, 16) and (38, 16) (R2).
- `index.ts`: `MAPS.neighbours = NEIGHBOURS_MAP`; `generateMaps` adds `neighbours: MAPS.neighbours.generate(seed)`; `assertMapDefinitions` calls `assertNeighboursLayout(defs.neighbours)`; `assertNpcPlacements` adds the "placed on no map" rule. `npcSpot` now never returns null; its return type stays nullable only if Task 2's tests need it, else Task 4 narrows it to non-null and updates the callers.
- `src/state/intents.ts`: on the Neighbours map, `planPickUp` refuses an object on either fence ring (`isFenceTile`) with `"That belongs to the neighbours."` (R9).
- `persistence.ts`: `migrateV6toV7` also adds `maps.neighbours = MAPS.neighbours.generate(seed)` (seed checked with `isIntIn(save.seed, 0, 0xffffffff)`; a malformed save passes through).
- `tests/testUtils.ts`: `v6Save` deletes `maps.neighbours` and throws when `player.mapId` is `'neighbours'`.
- `tests/neighboursMap.test.ts` (create), `tests/maps.test.ts` (the east gate, the map list), `tests/saveV7.test.ts` (the map added by the migration; a round trip standing on the Neighbours map), `tests/cast.test.ts` (Cosmo and Barnaby; the "placed on no map" rule). Every test or helper that spells out the map ids (`generateMaps`, `MAP_IDS` lists, render map tests) gains `'neighbours'`.

#### Contract for Task 5: Line banks
- `config.ts`: `export const PEOPLE = { manyRobots: 4, copperOreLine: 5, everydayLines: 6 } as const` (doc comments: Barnaby's "4 or more robots", Bram's "5 or more copper ore", the size of every everyday bank).
- `src/people/lines.ts` (pure):
  - `export const REACTIVE_KINDS = ['robotRuined', 'robotBroken', 'robotSaidToday', 'noRobots', 'manyRobots', 'noSeeds', 'copperOre', 'robotOnBench', 'raining'] as const; export type ReactiveKind = (typeof REACTIVE_KINDS)[number];`
  - `export interface LineBank { readonly introduction: string; readonly reactive: readonly { readonly when: ReactiveKind; readonly text: string }[]; readonly everyday: readonly string[] }`; `export const LINE_BANKS: Readonly<Record<NpcId, LineBank>>` with every line verbatim from spec §3.5, reactive lines in the spec's order.
  - `export function reactiveFill(state: GameState, when: ReactiveKind): { readonly name?: string; readonly season?: string } | null` — null when the condition doesn't hold, else the values its line uses (spec §3.5's table).
  - `export function lineFor(state: GameState, npc: NpcId): string` — the introduction when `state.npcs[npc].talks === 0`; else the first reactive line whose `reactiveFill` isn't null, with `{name}` and `{season}` filled; else `everyday[hash32(state.seed, state.time.absoluteDay, NPC_IDS.indexOf(npc)) % everyday.length]`.
- `tests/lines.test.ts` (create).

#### Contract for Task 6: Talking
- `types.ts`: `UiPanel` gains `| { readonly kind: 'talk'; readonly npc: NpcId; readonly line: string }` (R6), with a doc comment.
- `intents.ts`: `Intent` gains `| { readonly kind: 'talkTo'; readonly npc: NpcId }`; private `planTalk(state): ActionPlan | null` — the character on the target tile (`npcAt(state.player.mapId, target)`), as `plan(target, { kind: 'talkTo', npc }, 'none')`, or null. It is checked first in `planCarry` (spec §3.1; this covers E and Space while carrying), first in `planInteraction` after its carrying branch (before the workbench), and first in `planShiftInteraction` (before the workbench). `planPrimaryAction` is unchanged: with empty hands it falls back to `planInteraction` and talks; a placeable gets "Someone's standing there.". `describeIntent` → `` `Talk to ${CAST[intent.npc].name}` ``.
- `reducer.ts`: `applyIntent` case `'talkTo'`: `const line = lineFor(state, intent.npc)` on the state before the chat; then `npcs[npc]` becomes `{ talks: talks + 1, talkedToday: true }` and `ui.panel` becomes `{ kind: 'talk', npc, line }`. No energy, no time. `startNextDay` resets every `talkedToday` to false, keeping `state.npcs` itself when none was true and every untouched entry's reference.
- `panelKeys.ts`: with the talk panel open, `INTERACT_KEYS` (with or without Shift) return `actions.closePanel()`; Escape already closes any panel; the doc comment gains the talk panel.
- `tests/talk.test.ts` (create).

#### Contract for Task 7: The chat box
- `actions.ts`: `| { readonly type: 'talk/act'; readonly npc: NpcId; readonly act: NpcActionKind }` (doc: an action button in the chat box, spec §3.2); `actions.npcAct(npc, act)`.
- `reducer.ts`: `talk/act` does nothing unless `ui.panel` is the talk panel for `npc` and `npcActions(npc)` has `act`; `'shop'` replaces the talk panel with `{ kind: 'shop' }` (R8).
- `src/ui/chatBoxView.ts` (pure, no DOM): `export interface ChatBoxView { readonly npc: NpcId; readonly name: string; readonly role: string; readonly line: string; readonly actions: readonly NpcAction[] }`; `export function chatBoxView(state: GameState): ChatBoxView | null` (null unless the talk panel is open); `export function isPhoneWidth(width: number): boolean` (`width < ROBOT_SCREEN.phoneMaxWidth`).
- `src/ui/ChatBox.ts` (main chunk): `export class ChatBox` with a `root: HTMLElement`, built from the HUD's widget context (it needs `dispatch`), and `sync(state, prev)`. It renders `chatBoxView(state)`: hidden when null; else the name, the role line under it in smaller text, the line, one button per action (its label) dispatching `actions.npcAct(npc, kind)`, and a **Close** button at the top right (`actions.closePanel()`). Text through `textContent`. Phone width: the `chat-box--phone` modifier while `isPhoneWidth(window.innerWidth)` (the box spans the screen and the buttons wrap), updated on `resize` with the HUD's abort signal.
- `Hud.ts` mounts it above the hotbar and syncs it with the other widgets. `hud.css` gains the `.chat-box` rules.
- `tests/chatBox.test.ts` (create): `chatBoxView` and `isPhoneWidth` (the test environment is `node`, so the DOM is checked in the playbook, as for the robot screen). `tests/talk.test.ts` gains the `talk/act` reducer cases.

#### Contract for Task 8: The characters on screen
- `config.ts`: `export const NPC_LOOKS = { swaySeconds: 3.2, swayDegrees: 2.5, nameplateHeight: …, nameplateScale: … } as const` (Task 8 fixes the last two from the model's height).
- `src/render/palette.ts`: `export const APPEARANCE_PALETTES` — `skin`, `hair`, `shirt`, `overalls` colour arrays sized exactly `APPEARANCE.skinTones`, `hairColors`, `shirtColors`, `overallsColors`; index 0 of each is today's player colour (R13).
- `src/render/playerModel.ts`: `new PlayerModel(appearance: Appearance = DEFAULT_APPEARANCE)` — hair style 0 and hat 0 are today's look; styles 1–2 and hats 1–3 are new low-poly variants. The player's model is built exactly as before.
- `src/render/npcProps.ts`: `export function createNpcPropGeometry(prop: NpcProp): THREE.BufferGeometry` (vertex-coloured, in the model's local space).
- `src/render/nameplates.ts`: `export function createNameplateTexture(name: string): THREE.CanvasTexture`, made once per character.
- `src/render/NpcRenderer.ts`: `export class NpcRenderer implements RenderSystem` — one model per character on the active map (built on the first visit to that map, kept hidden elsewhere), standing on its spot facing its direction, swaying `NPC_LOOKS.swayDegrees` over `NPC_LOOKS.swaySeconds`; a nameplate sprite above the character on the player's target tile, shown only while `selectIsFrozen(state)` is false. Pure helpers for tests: `export function nameplateFor(state: GameState): NpcId | null`, `export function swayAngle(elapsedSeconds: number, npcIndex: number): number`.
- `src/main.ts`: `new NpcRenderer(ctx)` in `systems`, after the robot renderer.
- `tests/npcRender.test.ts` (create).

#### Contract for Task 9: The Neighbours buildings
- `config.ts`: `export const NEIGHBOUR_ROOFS = { cosmoHouse: 0x…, barnabyHouse: 0x… } as const satisfies Readonly<Record<'cosmoHouse' | 'barnabyHouse', number>>`.
- `structureGeometry.ts`: `FarmhouseSpec` gains `readonly roofColor?: number` (absent: today's roof colour, so the farm is unchanged).
- `townGeometry.ts` / `StructureRenderer.ts`: `'cosmoHouse'` and `'barnabyHouse'` build `createFarmhouseGeometry` at the farmhouse's scale inside their rect, door on the door tile, roof `NEIGHBOUR_ROOFS[kind]`; `'chickenCoop'` is a plain wooden shed (no coop builder exists). Glass joins the shared glow glass. The fences are already drawn by `ObjectRenderer` (they are placed objects).
- `tests/npcRender.test.ts` / `tests/renderMaps.test.ts`: every structure kind of every map produces parts; the farm's farmhouse geometry is unchanged.

#### Contract for Task 10: Playbook and spec sync
- `.claude/skills/game-driven-qa/scenarios/farmclaws-part4a.md` (spec §7's 8 steps); `SKILL.md` gains part 4a rows.
- The spec edits listed in spec §10, plus a "Plan refinements" section in the part 4a spec for R1–R19 and any ruling recorded in a part 4a commit body.

---

## Plan refinements of the spec

Decided while drafting this plan. Task 10 writes each into the part 4a spec. Those marked *for Eli* are his call; the plan builds the stated choice until he says otherwise.

- **R1.** The Neighbours houses and coop need structure kinds, so `STRUCTURE_KINDS` also gains `'cosmoHouse'`, `'barnabyHouse'` and `'chickenCoop'` (spec §5.2). Structures are map data, not saved, so this needs no migration.
- **R2.** The east gate is built with the Neighbours map (Task 4), not with the parts exchange (Task 3): a warp needs its target map and a reciprocal warp to pass the startup check (spec §5.1, §8).
- **R3.** The parts exchange's geometry lands with the structure (Task 3) rather than in the rendering step, so the town never draws a gap where the notice board stood (spec §4, §8).
- **R4.** Until Task 4 places Cosmo and Barnaby, the startup check allows an id on at most one map; Task 4 makes it exactly one (spec §2.2).
- **R5.** A character's spot is "reachable" when one of its orthogonal neighbours is walkable, isn't another character's spot, and can be reached from one of the map's arrival tiles over walkable tiles that aren't character spots. The check walks the map's world generated with seed 0; a map that lists characters generates the same world for every seed (the town and the Neighbours map do). A door tile is part of its building, so a spot on a door fails as "not walkable"; the door rule catches the tile in front of a door (spec §2.2).
- **R6.** The talk panel carries the line picked before the chat is recorded: `UiPanel { kind: 'talk'; npc: NpcId; line: string }`. The chat box only shows it, so the introduction is what the first chat shows, and the line can't change while the box is open (spec §3.1, §3.4).
- **R7.** Until Task 7 an open talk panel shows nothing, and E, K, Enter or Escape close it; until Task 8 the characters draw nothing, though their tiles already block; until Task 9 the Neighbours houses and coop draw nothing, though their tiles already block.
- **R8.** Marigold's **Shop** is one action, `talk/act` (`actions.npcAct(npc, act)`), which checks that the talk panel is open on that character, the game isn't paused and the action is theirs, then swaps the talk panel for the shop in one step (spec §3.2).
- **R9.** The neighbours' fences can't be picked up: on the Neighbours map the pickaxe and the axe refuse an object on either field's fence ring with "That belongs to the neighbours."; anything the player puts down elsewhere on the map comes back up as usual. The spec doesn't say, and without it the player could carry Cosmo's fence home (spec §5.2). *Wording for Eli.*
- **R10.** Config: `PEOPLE.manyRobots` (4), `PEOPLE.copperOreLine` (5) and `PEOPLE.everydayLines` (6) carry the reactive thresholds and the bank size; `NPC_LOOKS` the sway and nameplate numbers; `NEIGHBOUR_ROOFS` the two roof colours; `Salt.MapNeighbours` the map's seed stream (spec §2.3, §3.5, §5.2).
- **R11.** The Neighbours map's `name` is "The Neighbours". The game shows map names nowhere yet (spec §5). *Name for Eli.*
- **R12.** The Neighbours map uses the farm's scenery style (a wooden fence round the grid, the farm's meadow tones) with its own cosmetic offset (spec §5.2).
- **R13.** No appearance palettes existed, so Task 8 adds them (`APPEARANCE_PALETTES`, index 0 the player's current colours) and lets `PlayerModel` take an `Appearance`; the player's own model is built exactly as before. The cast's looks are picked from these palettes (spec §2.3).
- **R14.** Hat 0 is the straw hat the farmer has always worn, 1 is no hat, 2 a cap and 3 a knitted hat; hair style 0 is today's short hair, 1 a ponytail and 2 a bob. This replaces the Phase 0 spec's "0 = no hat". Every save already holds 0, so nothing migrates (spec §2.3). *For Eli.*
- **R15.** Each prop hangs from one bone of the model, so it sways with the body: hats and the pencil on the head; the aprons, the neckerchief and the clipboard on the torso; the seed pouch on the hips. Cosmo's feathered straw hat replaces his own hat. Barnaby holds the clipboard against his chest with his left arm, the only pose a prop changes (spec §2.3).
- **R16.** The idle sway leans the upper body side to side, so the feet stay planted. Each character runs its `NPC_IDS` index sevenths of a period ahead, so no two sway in step (spec §2.3).
- **R17.** A nameplate is a 256 × 64 canvas: the name on a cream plate with an ink outline, sized to the name. It's drawn when its character is built (the first visit to that character's map) and then kept. `NPC_LOOKS.nameplateHeight` (1.5) and `NPC_LOOKS.nameplateScale` (0.36) place and size it (spec §2.3).
- **R18.** The neighbours' houses are the farmhouse with a roof colour (`FarmhouseSpec.roofColor`, from `NEIGHBOUR_ROOFS`: Cosmo sunflower yellow, Barnaby bright blue): the shingle rows and ridge are darker shades of it and the door's awning takes it too; their chimneys don't smoke. No coop builder existed, so the coop is a plain plank shed raised on legs, with a hens' ramp, a nest box and a small window (spec §5.2). *Colours and the coop's look for Eli.*
- **R19.** The parts exchange is steel-blue with slate trim and a mustard roof, colours no shop uses, and its walls are 4 units tall to the shops' 2.4–2.5, so it reads as two storeys (spec §4). *For Eli.*

## Open decisions for Eli

- **The main-chunk budget.** At the spec commit the main chunk is 282.0 KiB gzipped against a 285.1 KiB budget. Task 8 alone adds about 3.3 KiB, and Tasks 4, 5, 7 and 9 add more, so `build:check` will fail in Task 10 unless the budget rises or something moves behind a lazy import. Recommendation: raise the allowance by 10 KiB as a part 4a refinement of the part 3 budget. Task 10 Step 5 stops and asks if it's still undecided.
- **Cosmo's front door** (5, 4) opens onto his own fence ring at (5, 5). Legal, and the door does nothing in 4a; the spec's numbers are kept.
- **The field gates** (6, 12) and (24, 16) are grass between the dirt field and the dirt lane. Making them dirt is a one-line change in `neighboursSurface`.
- **Placing inside the neighbours' fields** is still allowed. Part 4c, which turns the fields into soil, may want to refuse it.
- **A v6 save made where a character now stands** loads with the player inside them; they can step off. Left alone.
- **The chat box's Close** is a text button reading "Close", as the spec bolds it; the shop modal uses a round ✕ icon.

---

### Task 1: Save version 7 and the `npcs` reshape

**Files:**
- Modify: `src/core/types.ts` (`SAVE_VERSION`, line 15; `NPC_IDS`, line 152; `HeartEventLevel` and `NpcRelation`, lines 1018–1031; `GameSections.npcs`, line 1081)
- Modify: `src/state/initialState.ts` (import, line 3; the `npcs` loop in `createDefaultSections`, lines 16–19)
- Modify: `src/state/sectionValidation.ts` (type import, line 18; `MAX_NPC_POINTS` and `HEART_EVENT_LEVELS`, lines 33–35; `isValidNpcRelation` and `isValidNpcs`, lines 87–101)
- Modify: `src/state/persistence.ts` (type imports, lines 6–20; new `migrateV6toV7` above the doc comment of `migrateSave`, ~line 478; one line in `migrateSave`, ~line 489)
- Modify: `tests/testUtils.ts` (type import, line 28; new `v6Save` and `v5Save`'s doc comment and first line, lines 308–316; `livelySections`, lines 384–390, 412–416 and 440)
- Modify (the npcs shape, version literals and older-save builders only): `tests/sections.test.ts` (lines 142, 154, 337–349), `tests/persistence.test.ts` (line 159; `NEW_FIELDS`, lines 1081–1087), `tests/robotSaveV6.test.ts` (line 8; lines 48–53, 61–63, 70–72, 77), `tests/robotSaveV5.test.ts` (lines 132–133, 142–144), `tests/robotSave.test.ts` (lines 76–77, 81–83), `tests/maps.test.ts` (lines 821–822)
- Test: `tests/saveV7.test.ts` (create)

**Interfaces:**
- Consumes: part 3's `migrateSave` chain (`migrateZoneMarker(migrateV5toV6(v))` last), `isValidGameState`, `isValidSections`, `serializeGame` / `deserializeGame`; `createDefaultSections()`; validation helpers `hasExactKeys`, `isBool`, `isCount`, `isObj`, `isOneOf`, `type Obj`; test helpers `BASE`, `must`, `atDay`, `withPlayer`, `livelySections`, `v5Save`, `legacySave`, `type SaveJson`; the v2 fixture `tests/fixtures/save-v2.json`.
- Produces:
  - `src/core/types.ts`: `SAVE_VERSION = 7 as const`. `NPC_IDS = ['sol', 'cosmo', 'barnaby', 'marigold', 'bram', 'juniper', 'tess'] as const`. `export interface NpcTalk { readonly talks: number; readonly talkedToday: boolean }` (doc comments: lifetime chats, rotates nothing in 4a but 0 picks the introduction; a chat today, reset each morning). `GameSections.npcs: Readonly<Record<NpcId, NpcTalk>>`. `NpcRelation` and `HeartEventLevel` are deleted.
  - `src/state/initialState.ts`: every id starts at `{ talks: 0, talkedToday: false }`.
  - `src/state/sectionValidation.ts`: `isValidNpcs` wants exactly the seven ids, each an object with exactly the keys `talks` (`isCount`) and `talkedToday` (`isBool`), through a private `isValidNpcTalk` and `NPC_TALK_KEYS`. `MAX_NPC_POINTS` and `HEART_EVENT_LEVELS` are deleted. `quests.board.npc` and `festival.giftTarget` keep checking `NPC_IDS`, which now holds only the new ids.
  - `src/state/persistence.ts`: `function migrateV6toV7(save: Obj): Obj` (private), chained in `migrateSave` after the v5 step: `if (isObj(v) && v.version === 6) v = migrateV6toV7(v);`. It writes `version: 7`; `npcs` becomes the seven ids in `NPC_IDS` order, where Marigold, Bram, Juniper and Tess keep their saved `talks` and `talkedToday` (copied as found through the private `migrateNpcV6`, so a corrupt value still fails validation; a missing or non-object entry passes through for the validator to reject), and Sol, Cosmo and Barnaby start at `{ talks: 0, talkedToday: false }`; every friendship field, Fennick and Pip are dropped; `quests.board` becomes null when its `npc` is `'fennick'` or `'pip'`; `festival.giftTarget` becomes null when it is `'fennick'` or `'pip'`. A save whose `npcs` isn't an object passes through untouched. A v6 relation and a v7 `NpcTalk` migrate alike, so a save whose `npcs` already has the v7 shape (the v2 fixture, through `migrateV2toV3`) is accepted. Private constants `KEPT_NPCS` and `REMOVED_NPCS`.
  - `tests/testUtils.ts`: `export function v6Save(state: GameState): SaveJson`, the v6 JSON of a v7 state: `version: 6`; `npcs` back to the six v6 ids in v6 order, each as a v6 relation (`points: 0, talkedToday, giftsToday: 0, giftsThisWeek: 0, heartEventsSeen: [], talks`), Fennick and Pip at the idle relation; it throws (message starting `v6Save:`) when Sol, Cosmo or Barnaby isn't at `{ talks: 0, talkedToday: false }`. `v5Save` now starts from `v6Save(state)` instead of `serializeGame`, so every older-save builder (`legacySave` included) inherits it. `livelySections()` gives Bram `{ talks: 40, talkedToday: true }` and Tess `{ talks: 3, talkedToday: false }`, keeps the board request from `'juniper'`, and makes the gift target `'tess'`.
  - `tests/saveV7.test.ts` with the `describe`s "save version 7", "v6 → v7" and "save version 7 rejects". Task 4 adds its cases.
  - Every existing test that asserted version 6, listed the friendship keys or built `npcs` by hand now uses version 7 and the new shape.

- [ ] **Step 1: Write the failing test**

Create `tests/saveV7.test.ts`:

```ts
/**
 * Save version 7 (farmclaws part 4a spec §6): the v6 → v7 migration, round trips of the part 4a
 * state, and one corrupted field per validation rule. Each part 4a task that adds a saved field
 * adds its cases here.
 */
import { describe, expect, it } from 'vitest';
import { Direction, NPC_IDS, SAVE_VERSION, type GameState, type NpcId, type NpcTalk } from '../src/core/types';
import { deserializeGame, isValidGameState, migrateSave, serializeGame } from '../src/state/persistence';
import { hasExactKeys, isObj } from '../src/state/validation';
import saveV2Text from './fixtures/save-v2.json?raw';
import { BASE, atDay, livelySections, must, v6Save, withPlayer, type SaveJson } from './testUtils';

/** `state` with the given characters' chats replaced. */
function withTalks(state: GameState, talks: Partial<Record<NpcId, NpcTalk>>): GameState {
  return { ...state, npcs: { ...state.npcs, ...talks } };
}

/** BASE with every section filled in far from its defaults, still valid. */
const lively = (): GameState => ({ ...BASE, ...livelySections() });

/**
 * What a v6 save can hold (Review Focus 1): mid-day in town, Bram talked to 12 times and today,
 * and chats with the other three shopkeepers. Sol, Cosmo and Barnaby have none, as version 6 has
 * no such characters.
 */
function chatted(): GameState {
  const state = withTalks(lively(), {
    marigold: { talks: 5, talkedToday: false },
    bram: { talks: 12, talkedToday: true },
    juniper: { talks: 1, talkedToday: true },
    tess: { talks: 30, talkedToday: false },
  });
  return withPlayer(atDay(state, 3, 780), { tx: 10, tz: 16 }, Direction.East, 'town');
}

/** The v6 JSON of `state`, with `edit` applied to it. */
function v6With(state: GameState, edit: (save: SaveJson) => void): SaveJson {
  const save = v6Save(state);
  edit(save);
  return save;
}

const npcsOf = (save: SaveJson) => save.npcs as SaveJson;
/** One saved character's record. */
const npcOf = (save: SaveJson, id: string) => must(npcsOf(save)[id]) as SaveJson;
const questsOf = (save: SaveJson) => save.quests as SaveJson & { board: SaveJson | null };
const festivalOf = (save: SaveJson) => save.festival as SaveJson;

/** Loads raw save JSON as the game would. */
const load = (save: SaveJson): GameState | null => deserializeGame(JSON.stringify(save));

describe('save version 7', () => {
  it('is the current version, and new games start in it', () => {
    expect(SAVE_VERSION).toBe(7);
    expect(BASE.version).toBe(7);
  });

  it('starts every character at no chats', () => {
    expect(Object.keys(BASE.npcs)).toEqual(['sol', 'cosmo', 'barnaby', 'marigold', 'bram', 'juniper', 'tess']);
    for (const id of NPC_IDS) expect(BASE.npcs[id]).toEqual({ talks: 0, talkedToday: false });
  });

  it('round-trips a farm with lively sections', () => {
    const state = lively();
    expect(state.npcs.bram).toEqual({ talks: 40, talkedToday: true });
    expect(deserializeGame(serializeGame(state))).toEqual(state);
  });

  it('round-trips a game standing in town with chats on record', () => {
    const state = chatted();
    expect(deserializeGame(serializeGame(state))).toEqual(state);
  });
});

describe('v6 → v7', () => {
  it('writes version 7', () => {
    expect((migrateSave(v6Save(chatted())) as SaveJson).version).toBe(7);
  });

  it('loads a v6 save as the state it was taken from', () => {
    const state = chatted();
    expect(must(load(v6Save(state)))).toEqual(state);
  });

  it("keeps the shopkeepers' chats, starts Sol, Cosmo and Barnaby at none, and drops Fennick, Pip and friendship", () => {
    const state = chatted();
    const save = v6With(state, (s) => {
      const npcs = npcsOf(s);
      npcs.bram = { ...npcOf(s, 'bram'), points: 2500, giftsToday: 1, giftsThisWeek: 2, heartEventsSeen: [2, 4, 6] };
      npcs.fennick = { points: 1500, talkedToday: true, giftsToday: 0, giftsThisWeek: 1, heartEventsSeen: [2], talks: 9 };
      npcs.pip = { points: 250, talkedToday: false, giftsToday: 0, giftsThisWeek: 0, heartEventsSeen: [], talks: 2 };
    });
    expect(Object.keys(npcsOf(save))).toEqual(['marigold', 'bram', 'juniper', 'tess', 'fennick', 'pip']);
    const migrated = migrateSave(save) as SaveJson;
    expect(npcsOf(migrated)).toEqual({
      sol: { talks: 0, talkedToday: false },
      cosmo: { talks: 0, talkedToday: false },
      barnaby: { talks: 0, talkedToday: false },
      marigold: { talks: 5, talkedToday: false },
      bram: { talks: 12, talkedToday: true },
      juniper: { talks: 1, talkedToday: true },
      tess: { talks: 30, talkedToday: false },
    });
    for (const id of NPC_IDS) expect(hasExactKeys(npcOf(migrated, id), ['talks', 'talkedToday']), id).toBe(true);
    const loaded = must(load(save));
    expect(loaded).toEqual(state);
    expect(loaded.player.mapId).toBe('town');
  });

  it('drops a board request from Fennick or Pip, and keeps one from Juniper', () => {
    const state = chatted();
    expect(state.quests.board?.npc).toBe('juniper');
    expect(must(load(v6Save(state))).quests).toEqual(state.quests);
    for (const npc of ['fennick', 'pip']) {
      const save = v6With(state, (s) => void (must(questsOf(s).board).npc = npc));
      expect(questsOf(migrateSave(save) as SaveJson).board, npc).toBeNull();
      expect(must(load(save))).toEqual({ ...state, quests: { ...state.quests, board: null } });
    }
  });

  it('drops a festival gift target of Fennick or Pip, and keeps Tess', () => {
    const state = chatted();
    expect(state.festival.giftTarget).toBe('tess');
    expect(must(load(v6Save(state))).festival).toEqual(state.festival);
    for (const npc of ['fennick', 'pip']) {
      const save = v6With(state, (s) => void (festivalOf(s).giftTarget = npc));
      expect(festivalOf(migrateSave(save) as SaveJson).giftTarget, npc).toBeNull();
      expect(must(load(save))).toEqual({ ...state, festival: { ...state.festival, giftTarget: null } });
    }
  });

  it('accepts a v6 save whose npcs already have the v7 shape', () => {
    const state = chatted();
    const save = v6With(state, (s) => void (s.npcs = JSON.parse(JSON.stringify(state.npcs)) as SaveJson));
    expect(must(load(save))).toEqual(state);
  });

  it('migrates the version-2 fixture through every version to 7', () => {
    const loaded = must(deserializeGame(saveV2Text));
    expect(loaded.version).toBe(7);
    expect(loaded.npcs).toEqual(BASE.npcs);
    expect(loaded.quests.board).toBeNull();
    expect(loaded.festival.giftTarget).toBeNull();
  });

  it('leaves a v6 save whose npcs are not an object for the validator to reject', () => {
    const save = v6With(BASE, (s) => void (s.npcs = 'everyone'));
    expect(migrateSave(save)).toBe(save);
    expect(load(save)).toBeNull();
  });

  it('copies a corrupt shopkeeper as found, so the validator still rejects it', () => {
    const corrupt: readonly [string, (save: SaveJson) => void][] = [
      ['negative talks', (s) => void (npcOf(s, 'bram').talks = -1)],
      ['a non-boolean talkedToday', (s) => void (npcOf(s, 'tess').talkedToday = 'yes')],
      ['a missing shopkeeper', (s) => void delete npcsOf(s).marigold],
      ['a shopkeeper that is not an object', (s) => void (npcsOf(s).juniper = 7)],
    ];
    for (const [label, edit] of corrupt) {
      const save = v6With(chatted(), edit);
      expect((migrateSave(save) as SaveJson).version, label).toBe(7);
      expect(load(save), label).toBeNull();
    }
  });

  it('v6Save refuses chats with Sol, Cosmo or Barnaby', () => {
    for (const id of ['sol', 'cosmo', 'barnaby'] as const) {
      expect(() => v6Save(withTalks(BASE, { [id]: { talks: 1, talkedToday: false } })), id).toThrow('v6Save');
      expect(() => v6Save(withTalks(BASE, { [id]: { talks: 0, talkedToday: true } })), id).toThrow('v6Save');
    }
  });

  it('leaves a save from a later version for the validator to reject', () => {
    const save = { ...v6Save(BASE), version: 8 };
    expect(migrateSave(save)).toBe(save);
    expect(load(save)).toBeNull();
  });
});

describe('save version 7 rejects', () => {
  type JsonPath = readonly string[];
  const cases: readonly (readonly [string, JsonPath, unknown])[] = [
    ['a missing character', ['npcs', 'cosmo'], undefined],
    ['a removed character', ['npcs', 'fennick'], { talks: 0, talkedToday: false }],
    ['an unknown character', ['npcs', 'gus'], { talks: 0, talkedToday: false }],
    ['a friendship field', ['npcs', 'bram', 'points'], 0],
    ['an extra field', ['npcs', 'sol', 'mood'], 'happy'],
    ['a missing talks', ['npcs', 'barnaby', 'talks'], undefined],
    ['negative talks', ['npcs', 'juniper', 'talks'], -1],
    ['fractional talks', ['npcs', 'tess', 'talks'], 2.5],
    ['talks that are not a number', ['npcs', 'marigold', 'talks'], '3'],
    ['a missing talkedToday', ['npcs', 'bram', 'talkedToday'], undefined],
    ['a non-boolean talkedToday', ['npcs', 'barnaby', 'talkedToday'], 'yes'],
    ['a character that is not an object', ['npcs', 'sol'], 0],
    ['a board request from Fennick', ['quests', 'board', 'npc'], 'fennick'],
    ['a board request from Pip', ['quests', 'board', 'npc'], 'pip'],
    ['Fennick as the gift target', ['festival', 'giftTarget'], 'fennick'],
    ['Pip as the gift target', ['festival', 'giftTarget'], 'pip'],
  ];

  it.each(cases)('%s', (_label, path, value) => {
    const state = lively();
    const save = JSON.parse(serializeGame(state)) as SaveJson;
    let node: SaveJson = save;
    for (const key of path.slice(0, -1)) {
      const next = node[key];
      if (!isObj(next)) throw new Error(`no object at ${key}`);
      node = next;
    }
    const last = must(path[path.length - 1]);
    if (value === undefined) delete node[last];
    else node[last] = value;
    expect(JSON.stringify(save)).not.toBe(serializeGame(state));
    expect(isValidGameState(save)).toBe(false);
    expect(load(save)).toBeNull();
  });
});
```

Then update `tests/testUtils.ts`, which the new test needs.

**1a.** In the type import at the top, replace:

```ts
  type MapId,
  type RobotStats,
```

with:

```ts
  type MapId,
  type NpcTalk,
  type RobotStats,
```

**1b.** Replace the doc comment and the first two lines of `v5Save`:

```ts
/**
 * Hand-transforms a current (version 6) state back into the JSON of a version-5 save (farmclaws
 * part 3 spec §9.1): every field version 6 added is taken out again. The state must not hold
 * anything a version-5 save cannot express. legacySave starts from this, so older saves never
 * carry part 3 fields either.
 */
export function v5Save(state: GameState): SaveJson {
  const save = JSON.parse(serializeGame(state)) as SaveJson;
  save.version = 5;
```

with:

```ts
/**
 * Hand-transforms a current (version 7) state back into the JSON of a version-6 save (farmclaws
 * part 4a spec §6): every field version 7 added is taken out again or turned back. The state must
 * not hold anything a version-6 save cannot express. v5Save starts from this, so every older-save
 * builder inherits it.
 */
export function v6Save(state: GameState): SaveJson {
  const save = JSON.parse(serializeGame(state)) as SaveJson;
  save.version = 6;
  // The cast: version 6 has no Sol, Cosmo or Barnaby, and still has Fennick, Pip and friendship.
  const npcs = state.npcs;
  for (const id of ['sol', 'cosmo', 'barnaby'] as const) {
    if (npcs[id].talks !== 0 || npcs[id].talkedToday) throw new Error(`v6Save: a version-6 save has no ${id} to have talked to`);
  }
  const relation = ({ talks, talkedToday }: NpcTalk): SaveJson => ({ points: 0, talkedToday, giftsToday: 0, giftsThisWeek: 0, heartEventsSeen: [], talks });
  const idle: NpcTalk = { talks: 0, talkedToday: false };
  save.npcs = {
    marigold: relation(npcs.marigold),
    bram: relation(npcs.bram),
    juniper: relation(npcs.juniper),
    tess: relation(npcs.tess),
    fennick: relation(idle),
    pip: relation(idle),
  };
  return save;
}

/**
 * Hand-transforms a state back into the JSON of a version-5 save (farmclaws part 3 spec §9.1): it
 * starts from v6Save, and every field version 6 added is taken out again. The state must not hold
 * anything a version-5 save cannot express. legacySave starts from this, so older saves never
 * carry part 3 or part 4a fields either.
 */
export function v5Save(state: GameState): SaveJson {
  const save = v6Save(state);
  save.version = 5;
```

(The rest of `v5Save` is unchanged. `legacySave` already starts from `v5Save` and deletes every section, so it needs no edit; `serializeGame` stays imported for `v6Save`.)

**1c.** In `livelySections`, replace:

```ts
/**
 * Every later-workstream section filled in far from its defaults, still valid: a steel hoe with
 * an upgrade under way, every recipe, a full coop and a barn, friendships, a board request,
 * lifetime stats and a festival in progress with a full display.
 */
export function livelySections(): GameSections {
  const idle = BASE.npcs.bram;
  return {
```

with:

```ts
/**
 * Every later-workstream section filled in far from its defaults, still valid: a steel hoe with
 * an upgrade under way, every recipe, a full coop and a barn, chats with Bram and Tess, a board
 * request, lifetime stats and a festival in progress with a full display.
 */
export function livelySections(): GameSections {
  return {
```

then replace:

```ts
    npcs: {
      ...BASE.npcs,
      bram: { points: 2500, talkedToday: true, giftsToday: 1, giftsThisWeek: 2, heartEventsSeen: [2, 4, 6], talks: 40 },
      tess: { ...idle, points: 1000, heartEventsSeen: [4] },
    },
```

with:

```ts
    npcs: {
      ...BASE.npcs,
      bram: { talks: 40, talkedToday: true },
      tess: { talks: 3, talkedToday: false },
    },
```

and replace:

```ts
      giftTarget: 'pip',
```

with:

```ts
      giftTarget: 'tess',
```

(The board request from `'juniper'` stays as it is.)

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run tests/saveV7.test.ts`
Expected: FAIL, 19 failed / 12 passed. "is the current version …", "migrates the version-2 fixture …" fail with `AssertionError: expected 6 to be 7`; "starts every character at no chats" fails on the old ids (`[ 'marigold', 'bram', … ]`); both round trips load `null`, because `livelySections` now holds the v7 `npcs` shape the v6 validator rejects; every case built with `v6Save` fails with `TypeError: Cannot read properties of undefined (reading 'talks')`, as `BASE.npcs` has no `sol` yet; and four rejection cases fail on paths that don't exist yet ("a missing character", "an extra field", "a missing talks", "a non-boolean talkedToday"). The other rejection cases pass only because the lively save is already invalid under the v6 validator.

- [ ] **Step 3: Implement**

**3a. `src/core/types.ts`.** Replace:

```ts
export const SAVE_VERSION = 6 as const;
```

with:

```ts
export const SAVE_VERSION = 7 as const;
```

Replace:

```ts
export const NPC_IDS = ['marigold', 'bram', 'juniper', 'tess', 'fennick', 'pip'] as const;
```

with:

```ts
/** The farmclaws cast (part 4a spec §2.1). A character's index here is its `npcIndex` in line picks. */
export const NPC_IDS = ['sol', 'cosmo', 'barnaby', 'marigold', 'bram', 'juniper', 'tess'] as const;
```

Replace:

```ts
export type HeartEventLevel = 2 | 4 | 6;

export interface NpcRelation {
  /** 0 … 2500 (250 per heart) */
  readonly points: number;
  readonly talkedToday: boolean;
  /** 0 … 1 */
  readonly giftsToday: number;
  /** 0 … 2 */
  readonly giftsThisWeek: number;
  /** Ascending, unique. */
  readonly heartEventsSeen: readonly HeartEventLevel[];
  /** Lifetime conversations; rotates dialogue lines. */
  readonly talks: number;
}
```

with:

```ts
/** The player's chats with one character (farmclaws part 4a spec §3.4). */
export interface NpcTalk {
  /** Lifetime chats. Rotates nothing in 4a, but 0 picks the introduction. */
  readonly talks: number;
  /** Whether the player talked to them today; reset each morning. */
  readonly talkedToday: boolean;
}
```

Replace:

```ts
  readonly npcs: Readonly<Record<NpcId, NpcRelation>>;
```

with:

```ts
  readonly npcs: Readonly<Record<NpcId, NpcTalk>>;
```

**3b. `src/state/initialState.ts`.** Replace:

```ts
import { NPC_IDS, SAVE_VERSION, type GameSections, type GameState, type InventoryState, type NpcId, type NpcRelation } from '../core/types';
```

with:

```ts
import { NPC_IDS, SAVE_VERSION, type GameSections, type GameState, type InventoryState, type NpcId, type NpcTalk } from '../core/types';
```

and replace:

```ts
  const npcs = {} as Record<NpcId, NpcRelation>;
  for (const id of NPC_IDS) {
    npcs[id] = { points: 0, talkedToday: false, giftsToday: 0, giftsThisWeek: 0, heartEventsSeen: [], talks: 0 };
  }
```

with:

```ts
  const npcs = {} as Record<NpcId, NpcTalk>;
  for (const id of NPC_IDS) {
    npcs[id] = { talks: 0, talkedToday: false };
  }
```

(A fresh object per id on every call, as before, so no two states share an entry.)

**3c. `src/state/sectionValidation.ts`.** In the type import, replace:

```ts
  type GameSections,
  type HeartEventLevel,
} from '../core/types';
```

with:

```ts
  type GameSections,
} from '../core/types';
```

Replace:

```ts
/** Friendship points cap: 10 hearts of 250 points. */
const MAX_NPC_POINTS = 2500;
const HEART_EVENT_LEVELS: readonly HeartEventLevel[] = [2, 4, 6];
```

with:

```ts
/** The fields of an NpcTalk, exactly. */
const NPC_TALK_KEYS = ['talks', 'talkedToday'] as const;
```

Replace:

```ts
function isValidNpcRelation(v: unknown): boolean {
  return (
    isObj(v) &&
    isIntIn(v.points, 0, MAX_NPC_POINTS) &&
    isBool(v.talkedToday) &&
    isIntIn(v.giftsToday, 0, 1) &&
    isIntIn(v.giftsThisWeek, 0, 2) &&
    isCanonicalSubset(v.heartEventsSeen, HEART_EVENT_LEVELS) &&
    isCount(v.talks)
  );
}

function isValidNpcs(v: unknown): boolean {
  return isObj(v) && hasExactKeys(v, NPC_IDS) && NPC_IDS.every((id) => isValidNpcRelation(v[id]));
}
```

with:

```ts
function isValidNpcTalk(v: unknown): boolean {
  return isObj(v) && hasExactKeys(v, NPC_TALK_KEYS) && isCount(v.talks) && isBool(v.talkedToday);
}

/** Exactly the seven characters (farmclaws part 4a spec §6.3), each with exactly an NpcTalk's fields. */
function isValidNpcs(v: unknown): boolean {
  return isObj(v) && hasExactKeys(v, NPC_IDS) && NPC_IDS.every((id) => isValidNpcTalk(v[id]));
}
```

`isIntIn` and `isCanonicalSubset` stay imported: tools, cooking, crafting, quests and the festival still use them. `isValidQuests` and `isValidFestival` already check `board.npc` and `giftTarget` with `isOneOf(…, NPC_IDS)`, so a v7 save naming Fennick or Pip is rejected with no further change.

**3d. `src/state/persistence.ts`.** In the import from `'../core/types'`, replace:

```ts
  MAP_IDS,
  SAVE_VERSION,
```

with:

```ts
  MAP_IDS,
  NPC_IDS,
  SAVE_VERSION,
```

and replace:

```ts
  type MapId,
  type TileCoord,
```

with:

```ts
  type MapId,
  type NpcId,
  type TileCoord,
```

Insert directly above the doc comment of `migrateSave` (after the closing `}` of `migrateZoneMarker`):

```ts
/** The characters version 7 keeps from version 6, with their chats (farmclaws part 4a spec §6.2). */
const KEPT_NPCS: readonly NpcId[] = ['marigold', 'bram', 'juniper', 'tess'];
/** The characters the farmclaws design cut; a version-6 save may still name them. */
const REMOVED_NPCS: readonly string[] = ['fennick', 'pip'];

/**
 * A saved character as a v7 NpcTalk: only `talks` and `talkedToday`, copied as found, so a corrupt
 * value still fails validation. A v6 relation and a v7 NpcTalk migrate alike; anything that isn't
 * an object passes through for the validator to reject.
 */
function migrateNpcV6(saved: unknown): unknown {
  return isObj(saved) ? { talks: saved.talks, talkedToday: saved.talkedToday } : saved;
}

/**
 * Version 6 predates the farmclaws cast (part 4a spec §6.2): `npcs` becomes the seven new ids,
 * where Marigold, Bram, Juniper and Tess keep their chats and Sol, Cosmo and Barnaby start at none.
 * Fennick, Pip and every friendship field are dropped, and so is a board request or a festival gift
 * target naming Fennick or Pip. `npcs` may already have the v7 shape, because migrateV2toV3 fills
 * it from the current defaults.
 */
function migrateV6toV7(save: Obj): Obj {
  const { npcs, quests, festival } = save;
  if (!isObj(npcs)) return save;
  const fresh = createDefaultSections().npcs;
  let migrated: Obj = {
    ...save,
    version: 7,
    npcs: Object.fromEntries(NPC_IDS.map((id) => [id, KEPT_NPCS.includes(id) ? migrateNpcV6(npcs[id]) : fresh[id]])),
  };
  if (isObj(quests) && isObj(quests.board) && isOneOf(quests.board.npc, REMOVED_NPCS)) migrated = { ...migrated, quests: { ...quests, board: null } };
  if (isObj(festival) && isOneOf(festival.giftTarget, REMOVED_NPCS)) migrated = { ...migrated, festival: { ...festival, giftTarget: null } };
  return migrated;
}
```

In `migrateSave`, replace:

```ts
  if (isObj(v) && v.version === 5) v = migrateZoneMarker(migrateV5toV6(v));
  return v;
```

with:

```ts
  if (isObj(v) && v.version === 5) v = migrateZoneMarker(migrateV5toV6(v));
  if (isObj(v) && v.version === 6) v = migrateV6toV7(v);
  return v;
```

`migrateZoneMarker` checks `save.version !== 6`, so it must keep running before the new step, as it does here. `isValidGameState` already checks `v.version === SAVE_VERSION` and calls `isValidSections`, so it is the v7 validation entry point with no change. Why the v7 shape matters: `migrateV2toV3` spreads `createDefaultSections()` into a v2 save, so from now on a v2 save reaches this step already holding the seven ids as `NpcTalk`s; `migrateNpcV6` copies those just as it copies a v6 relation's two fields.

- [ ] **Step 4: The existing tests' npcs shape, version literals and older-save builders**

Nothing else in these files changes.

- `tests/sections.test.ts`:
  - line 142 (in `describe('createDefaultSections')`): replace
    ```ts
      const idle = { points: 0, talkedToday: false, giftsToday: 0, giftsThisWeek: 0, heartEventsSeen: [], talks: 0 };
    ```
    with
    ```ts
      const idle = { talks: 0, talkedToday: false };
    ```
  - line 154: replace
    ```ts
        npcs: { marigold: idle, bram: idle, juniper: idle, tess: idle, fennick: idle, pip: idle },
    ```
    with
    ```ts
        npcs: { sol: idle, cosmo: idle, barnaby: idle, marigold: idle, bram: idle, juniper: idle, tess: idle },
    ```
  - lines 337–349 (the `// NPCs` cases of "saved NPCs, quests, stats and festival reject"): replace
    ```ts
        ['a missing NPC', ['npcs', 'pip'], undefined],
        ['an unknown NPC', ['npcs', 'gus'], BASE.npcs.pip],
        ['npcs that are not an object', ['npcs'], []],
        ['friendship above 10 hearts', ['npcs', 'bram', 'points'], 2501],
        ['negative friendship', ['npcs', 'marigold', 'points'], -1],
        ['two gifts in one day', ['npcs', 'bram', 'giftsToday'], 2],
        ['three gifts in one week', ['npcs', 'bram', 'giftsThisWeek'], 3],
        ['heart events out of order', ['npcs', 'bram', 'heartEventsSeen'], [4, 2]],
        ['a repeated heart event', ['npcs', 'bram', 'heartEventsSeen'], [2, 2]],
        ['an unknown heart event level', ['npcs', 'tess', 'heartEventsSeen'], [3]],
        ['negative talks', ['npcs', 'juniper', 'talks'], -1],
        ['a non-boolean talkedToday', ['npcs', 'fennick', 'talkedToday'], 'yes'],
        ['an NPC that is not an object', ['npcs', 'tess'], 1000],
    ```
    with
    ```ts
        ['a missing NPC', ['npcs', 'sol'], undefined],
        ['an unknown NPC', ['npcs', 'gus'], BASE.npcs.sol],
        ['npcs that are not an object', ['npcs'], []],
        ['negative talks', ['npcs', 'juniper', 'talks'], -1],
        ['a non-boolean talkedToday', ['npcs', 'cosmo', 'talkedToday'], 'yes'],
        ['an NPC that is not an object', ['npcs', 'tess'], 1000],
    ```
    (The friendship rules are gone; `tests/saveV7.test.ts` holds one case per §6.3 rule.)
- `tests/persistence.test.ts`:
  - line 159 (in "validates real states"): `    expect(SAVE_VERSION).toBe(6);` → `    expect(SAVE_VERSION).toBe(7);`
  - lines 1081–1087 (in `NEW_FIELDS`): replace
    ```ts
      ...NPC_IDS,
      'points',
      'talkedToday',
      'giftsToday',
      'giftsThisWeek',
      'heartEventsSeen',
      'talks',
    ```
    with
    ```ts
      ...NPC_IDS,
      'talkedToday',
      'talks',
    ```
    (The sweep must reach every listed field; no saved field is called `points`, `giftsToday`, `giftsThisWeek` or `heartEventsSeen` any more.)
- `tests/robotSaveV6.test.ts`:
  - line 8: replace
    ```ts
    import { Blocker, Direction, SAVE_VERSION, type GameState, type RobotStats } from '../src/core/types';
    ```
    with
    ```ts
    import { Blocker, Direction, type GameState, type RobotStats } from '../src/core/types';
    ```
  - lines 48–53: replace
    ```ts
    describe('save version 6', () => {
      it('is the current version, and new games start in it', () => {
        expect(SAVE_VERSION).toBe(6);
        expect(BASE.version).toBe(6);
      });

      it('round-trips a farm with robots and zones', () => {
    ```
    with
    ```ts
    describe('save version 6', () => {
      it('round-trips a farm with robots and zones', () => {
    ```
    (The current-version case now lives in `tests/saveV7.test.ts`.)
  - lines 61–63: replace
    ```ts
      it('writes version 6', () => {
        expect((migrateSave(v5Save(v5Farm())) as SaveJson).version).toBe(6);
      });
    ```
    with
    ```ts
      it('carries a v5 save on through version 6 to 7', () => {
        expect((migrateSave(v5Save(v5Farm())) as SaveJson).version).toBe(7);
      });
    ```
  - lines 70–72: replace
    ```ts
      it('migrates the version-2 fixture through every version to 6', () => {
        const loaded = must(deserializeGame(saveV2Text));
        expect(loaded.version).toBe(6);
    ```
    with
    ```ts
      it('migrates the version-2 fixture through every version to 7', () => {
        const loaded = must(deserializeGame(saveV2Text));
        expect(loaded.version).toBe(7);
    ```
  - line 77: `    const save = { ...v5Save(BASE), version: 7 };` → `    const save = { ...v5Save(BASE), version: 8 };` (version 7 is no longer a later version).
- `tests/robotSaveV5.test.ts`:
  - lines 132–133 (in "migrates a version-4 save …"): replace
    ```ts
        const migrated = migrateSave(save) as SaveJson;
        expect(migrated.version).toBe(6);
    ```
    with
    ```ts
        const migrated = migrateSave(save) as SaveJson;
        expect(migrated.version).toBe(7);
    ```
  - lines 142–144: replace
    ```ts
      it('migrates the version-2 fixture through four steps to 6', () => {
        const loaded = must(deserializeGame(saveV2Text));
        expect(loaded.version).toBe(6);
    ```
    with
    ```ts
      it('migrates the version-2 fixture through five steps to 7', () => {
        const loaded = must(deserializeGame(saveV2Text));
        expect(loaded.version).toBe(7);
    ```
- `tests/robotSave.test.ts`:
  - lines 76–77 (in "migrates a version-3 save …"): replace
    ```ts
        const migrated = migrateSave(save) as SaveJson;
        expect(migrated.version).toBe(6);
    ```
    with
    ```ts
        const migrated = migrateSave(save) as SaveJson;
        expect(migrated.version).toBe(7);
    ```
  - lines 81–83: replace
    ```ts
      it('migrates the version-2 fixture all the way to 6', () => {
        const loaded = must(deserializeGame(saveV2Text));
        expect(loaded.version).toBe(6);
    ```
    with
    ```ts
      it('migrates the version-2 fixture all the way to 7', () => {
        const loaded = must(deserializeGame(saveV2Text));
        expect(loaded.version).toBe(7);
    ```
- `tests/maps.test.ts` lines 821–822: replace
  ```ts
      const migrated = migrateSave(v2) as SaveJson;
      expect(migrated.version).toBe(6);
  ```
  with
  ```ts
      const migrated = migrateSave(v2) as SaveJson;
      expect(migrated.version).toBe(7);
  ```

Every older save these files build already goes through `v5Save` or `legacySave` (the v3 and v4 builders in `robotSave.test.ts` and `robotSaveV5.test.ts` start from `v5Save`), so they inherit `v6Save`'s v6 `npcs` and need no other edit. `tests/sections.test.ts` (its migration cases), `tests/wild.test.ts` and `tests/persistence.test.ts` (lines 181, 395, 778) compare with `SAVE_VERSION` and need no edit. No `src/` file other than the four above names `NpcRelation`, `HeartEventLevel` or a friendship field.

- [ ] **Step 5: Run it and see it pass**

Run: `npx vitest run tests/saveV7.test.ts tests/sections.test.ts tests/persistence.test.ts tests/robotSaveV6.test.ts tests/robotSaveV5.test.ts tests/robotSave.test.ts tests/maps.test.ts tests/wild.test.ts tests/robotRuin.test.ts`
Expected: PASS (`saveV7.test.ts`: 31 tests).

- [ ] **Step 6: The full gate**

Run: `npm run typecheck && npm test && npm run build`
Expected: all green (70 test files, 2,085 tests: the baseline's 2,062, less the 7 friendship rows of `sections.test.ts` and the current-version case of `robotSaveV6.test.ts`, plus `saveV7.test.ts`'s 31).

- [ ] **Step 7: Commit**

```bash
git add src/core/types.ts src/state/initialState.ts src/state/sectionValidation.ts src/state/persistence.ts tests/testUtils.ts tests/saveV7.test.ts tests/sections.test.ts tests/persistence.test.ts tests/robotSaveV6.test.ts tests/robotSaveV5.test.ts tests/robotSave.test.ts tests/maps.test.ts
git commit -m "Farmclaws part 4a: save version 7 and the npcs reshape

NPC_IDS becomes the farmclaws cast, and each character's save entry shrinks to
talks and talkedToday; friendship, Fennick and Pip are gone. migrateV6toV7 keeps
the shopkeepers' chats, starts Sol, Cosmo and Barnaby fresh, and clears a board
request or gift target that named Fennick or Pip. It also accepts the v7 shape,
because migrateV2toV3 fills old saves from the current defaults. The test helper
v6Save turns a v7 state back into v6 JSON, and v5Save now starts from it.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

---

### Task 2: The cast, spots on the map, blocking

**Files:**
- Create: `src/people/cast.ts`
- Modify: `src/core/types.ts` (new `NPC_ACTION_KINDS` / `NpcActionKind` directly after `export type NpcId`, ~line 153)
- Modify: `src/world/maps/types.ts` (type import, lines 8–16; new `NpcPlacement` after `StructurePlacement`, ~line 33; `MapDefinition.npcs` after `structures`, ~line 58)
- Modify: `src/world/maps/farm.ts` (`FARM_MAP`, `structures: []`, ~line 35)
- Modify: `src/world/maps/forest.ts` (`FOREST_MAP`, `structures: []`, ~line 111)
- Modify: `src/world/maps/town.ts` (type import, line 16; new `npcs` after the `structures` array, ~line 51; `TOWN_MAP`, ~line 132)
- Modify: `src/world/maps/lookup.ts` (header comment, lines 1–5; imports, lines 7–8; new `arrivalTiles` and `reachableTiles` above `isReservedTile`, ~line 35)
- Modify: `src/world/maps/index.ts` (imports, lines 6–11; the type re-export, line 16; new `assertNpcPlacements` above `assertMapDefinitions`' doc comment, ~line 69; `assertMapDefinitions`, ~lines 69–88)
- Modify: `src/state/intents.ts` (imports, ~line 28; `placementProblem`'s doc comment and body, ~lines 337–348)
- Modify: `src/state/reducer.ts` (imports, ~line 45; `movePlayer`'s doc comment and walk check, ~lines 284–296)
- Test: `tests/cast.test.ts` (create)

**Interfaces:**
- Consumes:
  - Task 1: `NPC_IDS = ['sol', 'cosmo', 'barnaby', 'marigold', 'bram', 'juniper', 'tess']` and `NpcId` in `src/core/types.ts`.
  - Existing code: `Direction`, `DIRECTIONS`, `MAP_IDS`, `MapId`, `Appearance`, `TileCoord`, `WorldState` (`src/core/types.ts`); `APPEARANCE` (`src/config.ts`); `inBounds`, `stepTile`, `tileCount`, `tileIndex` (`src/world/grid.ts`); `getTile`, `isWalkable` (`src/world/tiles.ts`); `coordIn` (`src/world/maps/lookup.ts`); `assertMapDefinitions`, `MAPS`, `isReservedTile` (`src/world/maps/index.ts`); `placementProblem`, `isFarmOnlyPlaceable` (`src/state/intents.ts`); `movePlayer` (`src/state/reducer.ts`); test helpers `BASE`, `holding`, `reachableFrom`, `tileAt`, `withPlayer`.
- Produces:
  - `src/core/types.ts`: `export const NPC_ACTION_KINDS = ['shop'] as const; export type NpcActionKind = (typeof NPC_ACTION_KINDS)[number];`.
  - `src/world/maps/types.ts`: `export interface NpcPlacement { readonly id: NpcId; readonly tx: number; readonly tz: number; readonly facing: Direction }`; `MapDefinition.npcs: readonly NpcPlacement[]`. `src/world/maps/index.ts` re-exports `type NpcPlacement`. Farm and forest: `npcs: []`. Town: Sol (21, 7), Marigold (7, 7), Bram (16, 7), Juniper (24, 7), Tess (35, 7), all facing `Direction.South`, in that order.
  - `src/world/maps/lookup.ts`: `export function arrivalTiles(defs: Readonly<Record<MapId, MapDefinition>>, id: MapId): readonly TileCoord[]` (every warp `to` tile on map `id`, from every map's warps, in `MAP_IDS` order then warp order). **Also** (not in the contract): `export function reachableTiles(world: WorldState, starts: readonly TileCoord[], isClosed: (tx: number, tz: number) => boolean): (tx: number, tz: number) => boolean`, a breadth-first walk over walkable tiles that never enters a closed tile; it lives in `lookup.ts` so a map module (Task 4's `neighbours.ts`) can use it without importing `index.ts`.
  - `src/world/maps/index.ts`: private `assertNpcPlacements(defs)`, called from `assertMapDefinitions` right after the per-map loop. It throws a `RangeError` whose message is `Map {id}: {npc} at ({tx}, {tz}) ` followed by `is out of bounds`, `is not walkable`, `is on a reserved tile`, `is on a door or the tile in front of one`, `shares its tile with {other npc}` or `can't be reached from the map's arrival tiles`, checked in that order; then `Character {npc} is placed more than once` when an id was already placed (on this map or an earlier one in `MAP_IDS` order). It generates `def.generate(0)` once per map that lists characters, and walks it once (`reachableTiles` from `arrivalTiles(defs, id)`, character spots closed).
  - `src/people/cast.ts` (pure; imports `MAPS` and `type NpcPlacement` from `../world/maps`, and types from `../core/types`): `CastMember`, `CAST`, `NPC_PROPS`, `NpcProp`, `CastLook`, `CAST_LOOKS`, `npcAt(mapId, tx, tz): NpcId | null`, `npcSpot(npc): { readonly mapId: MapId; readonly placement: NpcPlacement } | null`, `NpcAction`, `npcActions(npc): readonly NpcAction[]` (Marigold `[{ kind: 'shop', label: 'Shop' }]`, everyone else the same frozen empty array; both arrays frozen).
  - `src/state/intents.ts`: `placementProblem` returns `"Someone's standing there."` when `npcAt(state.player.mapId, target.tx, target.tz)` isn't null, after the farm-only rule and before the reserved-tile rule.
  - `src/state/reducer.ts`: `movePlayer` refuses a step onto a character's tile silently, exactly like an unwalkable tile (the player turns to face it; no toast).
  - `tests/cast.test.ts` (20 tests).
  - No module under `src/world` imports `src/people`, so `cast.ts → world/maps` is not a cycle.

- [ ] **Step 1: Write the failing test**

Create `tests/cast.test.ts`:

```ts
/**
 * The cast (farmclaws part 4a spec §2): names, role lines and looks; the characters' spots on the
 * maps and the startup check over them (one broken definition per rule); `npcAt`; a character's
 * tile blocking movement and placement; and the chat box's action list (spec §3.2). The
 * Neighbours map adds Cosmo's and Barnaby's cases.
 */
import { describe, expect, it } from 'vitest';
import { APPEARANCE } from '../src/config';
import { DIRECTIONS, Direction, NPC_IDS, type GameState, type MapId, type NpcId } from '../src/core/types';
import { CAST, CAST_LOOKS, NPC_PROPS, npcActions, npcAt, npcSpot } from '../src/people/cast';
import { actions } from '../src/state/actions';
import { placementProblem } from '../src/state/intents';
import { gameReducer } from '../src/state/reducer';
import { stepTile } from '../src/world/grid';
import { MAPS, assertMapDefinitions, isReservedTile, type MapDefinition, type NpcPlacement } from '../src/world/maps';
import { arrivalTiles } from '../src/world/maps/lookup';
import { isWalkable } from '../src/world/tiles';
import { BASE, holding, reachableFrom, tileAt, withPlayer } from './testUtils';

/** The town's characters as spec §2.1 places them. */
const TOWN_SPOTS: readonly NpcPlacement[] = [
  { id: 'sol', tx: 21, tz: 7, facing: Direction.South },
  { id: 'marigold', tx: 7, tz: 7, facing: Direction.South },
  { id: 'bram', tx: 16, tz: 7, facing: Direction.South },
  { id: 'juniper', tx: 24, tz: 7, facing: Direction.South },
  { id: 'tess', tx: 35, tz: 7, facing: Direction.South },
];

/** The shipped definitions with the town's characters replaced by `npcs`. */
function withTownNpcs(npcs: readonly NpcPlacement[]): Record<MapId, MapDefinition> {
  return { ...MAPS, town: { ...MAPS.town, npcs } };
}

/** The town's characters with `npc` moved to (tx, tz). */
function moved(npc: NpcId, tx: number, tz: number): readonly NpcPlacement[] {
  return MAPS.town.npcs.map((p) => (p.id === npc ? { ...p, tx, tz } : p));
}

/** The player in town on the tile south of `spot`, facing `facing` (by default, the character). */
function southOf(spot: NpcPlacement, facing: Direction = Direction.North): GameState {
  return withPlayer(BASE, { tx: spot.tx, tz: spot.tz + 1 }, facing, 'town');
}

function lastText(state: GameState): string | undefined {
  return state.messages.entries[state.messages.entries.length - 1]?.text;
}

describe('the cast', () => {
  it('names every character with their role line, as the spec writes them', () => {
    expect(CAST).toEqual({
      sol: { name: 'Sol', role: 'Parts exchange' },
      cosmo: { name: 'Cosmo', role: 'Farmer' },
      barnaby: { name: 'Barnaby', role: 'Farmer' },
      marigold: { name: 'Marigold', role: 'General store' },
      bram: { name: 'Bram', role: 'Blacksmith' },
      juniper: { name: 'Juniper', role: 'Carpenter' },
      tess: { name: 'Tess', role: 'Ranch' },
    });
    expect(Object.keys(CAST)).toEqual([...NPC_IDS]);
  });

  it('gives each character a look within the appearance ranges and their own prop', () => {
    const ranges = {
      skinTone: APPEARANCE.skinTones,
      hairStyle: APPEARANCE.hairStyles,
      hairColor: APPEARANCE.hairColors,
      shirtColor: APPEARANCE.shirtColors,
      overallsColor: APPEARANCE.overallsColors,
      hat: APPEARANCE.hats,
    } as const;
    for (const id of NPC_IDS) {
      const { appearance } = CAST_LOOKS[id];
      expect(Object.keys(appearance).sort(), id).toEqual(Object.keys(ranges).sort());
      for (const [field, size] of Object.entries(ranges)) {
        const value = appearance[field as keyof typeof ranges];
        expect(Number.isInteger(value) && value >= 0 && value < size, `${id} ${field} = ${value}`).toBe(true);
      }
    }
    expect(NPC_IDS.map((id) => CAST_LOOKS[id].prop)).toEqual([
      'toolApron',
      'featherHat',
      'clipboard',
      'seedPouch',
      'smithApron',
      'pencil',
      'neckerchief',
    ]);
    expect(new Set(NPC_IDS.map((id) => CAST_LOOKS[id].prop)).size).toBe(NPC_PROPS.length);
  });

  it('makes the characters look unlike each other and unlike a new player', () => {
    const shirts = NPC_IDS.map((id) => CAST_LOOKS[id].appearance.shirtColor);
    expect(new Set(shirts).size).toBe(NPC_IDS.length);
    expect(shirts).not.toContain(BASE.profile.appearance.shirtColor);
    // Cosmo's feathered straw hat is his prop, so he wears no hat of the model's own (hat 1;
    // hat 0 is the straw hat the farmer has always worn, Task 8).
    expect(CAST_LOOKS.cosmo.appearance.hat).toBe(1);
  });
});

describe('spots on the map', () => {
  it('stands Sol and the shopkeepers in town, facing south, and no one on the farm or in the forest', () => {
    expect(MAPS.town.npcs).toEqual(TOWN_SPOTS);
    expect(MAPS.farm.npcs).toEqual([]);
    expect(MAPS.forest.npcs).toEqual([]);
  });

  it('keeps every spot walkable, unreserved, off the door paths and reachable from the gate', () => {
    const town = BASE.maps.town;
    const reachable = reachableFrom(town, { tx: 1, tz: 16 });
    for (const spot of TOWN_SPOTS) {
      expect(isWalkable(tileAt(BASE, spot, 'town')), spot.id).toBe(true);
      expect(isReservedTile(MAPS.town, spot.tx, spot.tz), spot.id).toBe(false);
      for (const s of MAPS.town.structures) {
        if (s.door === null) continue;
        expect([spot.tx, spot.tz], `${spot.id} by the ${s.kind} door`).not.toEqual([s.door.tx, s.door.tz + 1]);
      }
      const neighbours = DIRECTIONS.map((direction) => stepTile(spot, direction));
      expect(neighbours.some((n) => reachable.has(`${n.tx},${n.tz}`)), spot.id).toBe(true);
    }
  });

  it('finds each character with npcAt and npcSpot, and no one anywhere else', () => {
    for (const spot of TOWN_SPOTS) {
      expect(npcAt('town', spot.tx, spot.tz)).toBe(spot.id);
      expect(npcSpot(spot.id)).toEqual({ mapId: 'town', placement: spot });
    }
    expect(npcAt('town', 20, 7)).toBeNull();
    expect(npcAt('town', 21, 8)).toBeNull();
    expect(npcAt('town', -1, 7)).toBeNull();
    expect(npcAt('farm', 21, 7)).toBeNull();
    expect(npcAt('forest', 7, 7)).toBeNull();
  });

  it('lists the arrival tiles of a map from every warp into it, in map order', () => {
    expect(arrivalTiles(MAPS, 'farm')).toEqual([
      { tx: 1, tz: 13 },
      { tx: 46, tz: 38 },
    ]);
    expect(arrivalTiles(MAPS, 'town')).toContainEqual({ tx: 1, tz: 16 });
  });
});

describe('the startup check on the characters', () => {
  it('accepts the shipped spots', () => {
    expect(() => assertMapDefinitions(MAPS)).not.toThrow();
  });

  const broken: readonly (readonly [string, Record<MapId, MapDefinition>, string])[] = [
    ['a spot off the map', withTownNpcs(moved('sol', 40, 7)), 'Map town: sol at (40, 7) is out of bounds'],
    ['a spot inside a structure', withTownNpcs(moved('sol', 21, 6)), 'Map town: sol at (21, 6) is not walkable'],
    ['a spot on a door, which is part of its building', withTownNpcs(moved('marigold', 6, 6)), 'Map town: marigold at (6, 6) is not walkable'],
    ['a spot on a reserved tile', withTownNpcs(moved('sol', 1, 16)), 'Map town: sol at (1, 16) is on a reserved tile'],
    [
      'a spot in front of a door',
      withTownNpcs(moved('marigold', 6, 7)),
      'Map town: marigold at (6, 7) is on a door or the tile in front of one',
    ],
    ['two characters on one tile', withTownNpcs(moved('bram', 21, 7)), 'Map town: bram at (21, 7) shares its tile with sol'],
    [
      'a spot walled in by the other characters',
      withTownNpcs([
        { id: 'sol', tx: 21, tz: 9, facing: Direction.South },
        { id: 'marigold', tx: 20, tz: 9, facing: Direction.South },
        { id: 'bram', tx: 22, tz: 9, facing: Direction.South },
        { id: 'juniper', tx: 21, tz: 10, facing: Direction.South },
        { id: 'tess', tx: 21, tz: 8, facing: Direction.South },
      ]),
      "Map town: sol at (21, 9) can't be reached from the map's arrival tiles",
    ],
    [
      'a character on two maps',
      { ...MAPS, forest: { ...MAPS.forest, npcs: [{ id: 'sol', tx: 30, tz: 14, facing: Direction.South }] } },
      'Character sol is placed more than once',
    ],
  ];

  it.each(broken)('throws on %s, naming the character', (_name, defs, message) => {
    expect(() => assertMapDefinitions(defs)).toThrow(RangeError);
    expect(() => assertMapDefinitions(defs)).toThrow(new RangeError(message));
  });
});

describe("a character's tile", () => {
  it('refuses a step onto it silently: the player only turns to face the character', () => {
    for (const spot of TOWN_SPOTS) {
      const sideways = southOf(spot, Direction.East);
      const next = gameReducer(sideways, actions.move(Direction.North));
      expect(next.player, spot.id).toEqual({ ...sideways.player, facing: Direction.North });
      expect(next.messages, spot.id).toBe(sideways.messages);
      // Facing them already, the step changes nothing at all.
      const facing = southOf(spot);
      expect(gameReducer(facing, actions.move(Direction.North)), spot.id).toBe(facing);
    }
    // The tile beside a character is walkable as before.
    const beside = gameReducer(southOf(TOWN_SPOTS[0]!), actions.move(Direction.West));
    expect(beside.player).toMatchObject({ tx: 20, tz: 8, facing: Direction.West });
  });

  it("refuses to place a chest there: Someone's standing there.", () => {
    for (const spot of TOWN_SPOTS) {
      const state = holding(southOf(spot), 'chest');
      expect(placementProblem(state, 'chest', spot), spot.id).toBe("Someone's standing there.");
      const next = gameReducer(state, actions.useTool());
      expect(lastText(next), spot.id).toBe("Someone's standing there.");
      expect(next.maps, spot.id).toBe(state.maps);
      expect(next.inventory, spot.id).toBe(state.inventory);
    }
  });

  it('keeps the farm-only rule first: a sprinkler belongs on the farm', () => {
    const state = holding(southOf(TOWN_SPOTS[0]!), 'sprinkler');
    expect(placementProblem(state, 'sprinkler', TOWN_SPOTS[0]!)).toBe('The sprinkler belongs on your farm.');
  });
});

describe('npcActions', () => {
  it('gives Marigold the Shop button and everyone else none', () => {
    expect(npcActions('marigold')).toEqual([{ kind: 'shop', label: 'Shop' }]);
    for (const id of NPC_IDS) {
      if (id === 'marigold') continue;
      expect(npcActions(id), id).toEqual([]);
      expect(npcActions(id), id).toBe(npcActions('sol'));
    }
    expect(Object.isFrozen(npcActions('sol'))).toBe(true);
    expect(Object.isFrozen(npcActions('marigold'))).toBe(true);
  });
});
```

Notes on the fixtures (all checked against today's town and forest):
- (21, 6) is `hedge(21, 6, 1, 1)` today and the parts exchange after Task 3: blocked either way. (6, 6) is the general store's door, a `Blocker.Building` tile, so a spot on a door fails the walkable rule before the door rule; the door rule is pinned by the tile in front of the door, (6, 7).
- The walled-in case stands Sol on the square at (21, 9) with the other four on his four neighbours; each of those tiles is walkable cobble, unreserved and away from every door, so only Sol's reachability fails, and he is checked first.
- Forest (30, 14) is on the dirt trail, which every seed leaves empty (`tests/maps.test.ts`, "runs a dirt trail in from the gate"), and it is reachable from the forest's arrival tile (34, 15). The forest is checked before the town, so Sol passes there and is caught as a repeat in town.

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run tests/cast.test.ts`
Expected: FAIL. The file can't load: `Failed to resolve import "../src/people/cast" from "tests/cast.test.ts"` (the module doesn't exist yet), so no test runs. (Once it exists, `MapDefinition` has no `npcs` and `arrivalTiles` isn't exported, so `npm run typecheck` fails too.)

- [ ] **Step 3: Implement**

**3a. `src/core/types.ts`.** Insert directly after the line `export type NpcId = (typeof NPC_IDS)[number];` (~line 153; Task 1 changed the `NPC_IDS` line above it but not this one):

```ts

/** What a character's chat-box buttons do (part 4a spec §3.2). Parts 4b and 4c add kinds. */
export const NPC_ACTION_KINDS = ['shop'] as const;
export type NpcActionKind = (typeof NPC_ACTION_KINDS)[number];
```

**3b. `src/world/maps/types.ts`.** In the type import, replace:

```ts
  MapId,
  StructureKind,
```

with:

```ts
  MapId,
  NpcId,
  StructureKind,
```

Insert directly above `export interface WildTuning {`:

```ts
/** A character's fixed spot on a map (part 4a spec §2.2), facing `facing`. */
export interface NpcPlacement {
  readonly id: NpcId;
  readonly tx: number;
  readonly tz: number;
  readonly facing: Direction;
}

```

In `MapDefinition`, replace:

```ts
  readonly structures: readonly StructurePlacement[];
```

with:

```ts
  readonly structures: readonly StructurePlacement[];
  /** The characters standing on this map, each on a fixed spot; their tiles block the player like a structure. */
  readonly npcs: readonly NpcPlacement[];
```

**3c. `src/world/maps/farm.ts`.** In `FARM_MAP`, replace:

```ts
  structures: [],
  wild: {
```

with:

```ts
  structures: [],
  npcs: [],
  wild: {
```

**`src/world/maps/forest.ts`.** In `FOREST_MAP`, replace:

```ts
  structures: [],
  wild,
```

with:

```ts
  structures: [],
  npcs: [],
  wild,
```

**3d. `src/world/maps/town.ts`.** Replace:

```ts
import type { MapDefinition, StructurePlacement, Surface } from './types';
```

with:

```ts
import type { MapDefinition, NpcPlacement, StructurePlacement, Surface } from './types';
```

Insert directly after the closing `];` of the `structures` array (the line after `  lampPost(36, 14),`):

```ts

/**
 * The characters (part 4a spec §2.1), facing the square. Each shopkeeper stands one tile east of
 * the tile in front of their door, so the door path stays clear; Juniper stands one tile west,
 * because the lamp post at (26, 8) is south of the east tile. Sol stands at the top of the square.
 */
const npcs: readonly NpcPlacement[] = [
  { id: 'sol', tx: 21, tz: 7, facing: Direction.South },
  { id: 'marigold', tx: 7, tz: 7, facing: Direction.South },
  { id: 'bram', tx: 16, tz: 7, facing: Direction.South },
  { id: 'juniper', tx: 24, tz: 7, facing: Direction.South },
  { id: 'tess', tx: 35, tz: 7, facing: Direction.South },
];
```

In `TOWN_MAP`, replace:

```ts
  structures,
  wild: null,
```

with:

```ts
  structures,
  npcs,
  wild: null,
```

(`Direction` is already a value import of `town.ts`.)

**3e. `src/world/maps/lookup.ts`.** Replace the header comment:

```ts
/**
 * Pure lookups over a MapDefinition, plus the helpers the map modules use to precompute their
 * static masks. Kept apart from `index.ts` (which re-exports the lookups) so simulation modules
 * that the generators themselves import (farming/wild.ts) can use them without an import cycle.
 */
```

with:

```ts
/**
 * Pure lookups over a MapDefinition, plus the helpers the map modules use to precompute their
 * static masks and to walk their worlds. Kept apart from `index.ts` (which re-exports the
 * lookups) so simulation modules that the generators themselves import (farming/wild.ts) and the
 * map modules themselves can use them without an import cycle.
 */
```

Replace:

```ts
import type { Direction, GridSpec, MapId, TileCoord } from '../../core/types';
import { inBounds, rectContains, tileIndex } from '../grid';
```

with:

```ts
import { DIRECTIONS, MAP_IDS, type Direction, type GridSpec, type MapId, type TileCoord, type WorldState } from '../../core/types';
import { inBounds, rectContains, stepTile, tileCount, tileIndex } from '../grid';
import { getTile, isWalkable } from '../tiles';
```

(`src/world/tiles.ts` imports only `core` and `./grid`, so this adds no cycle.)

Insert directly above `export function isReservedTile(def: MapDefinition, tx: number, tz: number): boolean {`:

```ts
/** Where the warps into map `id` land: every map's warps in MAP_IDS order, each map's in its own order. */
export function arrivalTiles(defs: Readonly<Record<MapId, MapDefinition>>, id: MapId): readonly TileCoord[] {
  const tiles: TileCoord[] = [];
  for (const from of MAP_IDS) {
    for (const warp of defs[from].warps) {
      if (warp.to.mapId === id) tiles.push({ tx: warp.to.tx, tz: warp.to.tz });
    }
  }
  return tiles;
}

/**
 * The tiles a walker reaches from `starts` in orthogonal steps over walkable tiles of `world`,
 * never entering a tile `isClosed` names. A start that is unwalkable or closed reaches nothing.
 * The result answers false out of bounds.
 */
export function reachableTiles(
  world: WorldState,
  starts: readonly TileCoord[],
  isClosed: (tx: number, tz: number) => boolean,
): (tx: number, tz: number) => boolean {
  const { grid } = world;
  const reached = new Uint8Array(tileCount(grid));
  const queue: TileCoord[] = [];
  const visit = (coord: TileCoord): void => {
    const tile = getTile(world, coord.tx, coord.tz);
    if (tile === null || !isWalkable(tile) || isClosed(coord.tx, coord.tz)) return;
    const index = tileIndex(grid, coord.tx, coord.tz);
    if (reached[index] === 1) return;
    reached[index] = 1;
    queue.push(coord);
  };
  starts.forEach(visit);
  for (let head = 0; head < queue.length; head++) {
    const current = queue[head];
    if (current === undefined) break;
    for (const direction of DIRECTIONS) visit(stepTile(current, direction));
  }
  return (tx, tz) => inBounds(grid, tx, tz) && reached[tileIndex(grid, tx, tz)] === 1;
}

```

(`getTile` returns null out of bounds, so `visit` never indexes outside the grid.)

**3f. `src/world/maps/index.ts`.** Replace:

```ts
import { MAP_IDS, type MapId, type TileRect, type WorldState } from '../../core/types';
import { inBounds, rectContains, rectInBounds, stepTile, tileCount } from '../grid';
import { isPondTile } from '../worldgen';
import { FARM_MAP } from './farm';
import { FOREST_MAP } from './forest';
import { coordIn } from './lookup';
```

with:

```ts
import { DIRECTIONS, MAP_IDS, type MapId, type NpcId, type TileRect, type WorldState } from '../../core/types';
import { inBounds, rectContains, rectInBounds, stepTile, tileCount } from '../grid';
import { getTile, isWalkable } from '../tiles';
import { isPondTile } from '../worldgen';
import { FARM_MAP } from './farm';
import { FOREST_MAP } from './forest';
import { arrivalTiles, coordIn, reachableTiles } from './lookup';
```

Replace:

```ts
export type { MapDefinition, SceneryStyle, StructurePlacement, Surface, Warp, WildTuning } from './types';
```

with:

```ts
export type { MapDefinition, NpcPlacement, SceneryStyle, StructurePlacement, Surface, Warp, WildTuning } from './types';
```

Replace the doc comment of `assertMapDefinitions`:

```ts
/**
 * Throws on a broken set of definitions: a warp not on the edge or exiting into the grid, a
 * target out of bounds, a warp without a reciprocal (the target map must have a warp to this
 * map arriving orthogonally next to `from`), an unreserved warp or arrival tile, a structure
 * outside the grid or overlapping another structure or a reserved tile, a farm spawn that isn't
 * clear, and the town's own layout rules (`assertTownLayout`).
 */
```

with the new check followed by the updated doc comment:

```ts
/**
 * The characters' spots (part 4a spec §2.2). Each must be on its map, walkable, not reserved,
 * neither a door nor the tile in front of one, alone on its tile, and reachable: one of its
 * orthogonal neighbours can be walked to from one of the map's arrival tiles, over walkable
 * tiles that aren't characters' spots. A map that lists characters generates the same world for
 * every seed, so the world from seed 0 is the one walked, generated once per map. A character
 * stands on at most one map.
 */
function assertNpcPlacements(defs: Readonly<Record<MapId, MapDefinition>>): void {
  const placed = new Set<NpcId>();
  for (const id of MAP_IDS) {
    const def = defs[id];
    if (def.npcs.length === 0) continue;
    const world = def.generate(0);
    const isSpot = (tx: number, tz: number): boolean => def.npcs.some((p) => p.tx === tx && p.tz === tz);
    const reachable = reachableTiles(world, arrivalTiles(defs, id), isSpot);
    def.npcs.forEach((p, i) => {
      const name = `Map ${id}: ${p.id} at (${p.tx}, ${p.tz})`;
      if (!inBounds(def.grid, p.tx, p.tz)) throw new RangeError(`${name} is out of bounds`);
      const tile = getTile(world, p.tx, p.tz);
      if (tile === null || !isWalkable(tile)) throw new RangeError(`${name} is not walkable`);
      if (coordIn(def.reserved, p.tx, p.tz)) throw new RangeError(`${name} is on a reserved tile`);
      const atDoor = def.structures.some((s) => s.door !== null && s.door.tx === p.tx && (s.door.tz === p.tz || s.door.tz + 1 === p.tz));
      if (atDoor) throw new RangeError(`${name} is on a door or the tile in front of one`);
      const other = def.npcs.slice(0, i).find((o) => o.tx === p.tx && o.tz === p.tz);
      if (other !== undefined) throw new RangeError(`${name} shares its tile with ${other.id}`);
      const neighbours = DIRECTIONS.map((direction) => stepTile(p, direction));
      if (!neighbours.some((n) => reachable(n.tx, n.tz))) throw new RangeError(`${name} can't be reached from the map's arrival tiles`);
      if (placed.has(p.id)) throw new RangeError(`Character ${p.id} is placed more than once`);
      placed.add(p.id);
    });
  }
}

/**
 * Throws on a broken set of definitions: a warp not on the edge or exiting into the grid, a
 * target out of bounds, a warp without a reciprocal (the target map must have a warp to this
 * map arriving orthogonally next to `from`), an unreserved warp or arrival tile, a structure
 * outside the grid or overlapping another structure or a reserved tile, a farm spawn that isn't
 * clear, the town's own layout rules (`assertTownLayout`), and a character's spot that breaks
 * a rule of `assertNpcPlacements`.
 */
```

In `assertMapDefinitions`, replace:

```ts
    assertWarps(defs, def);
    assertStructures(def);
  }
  assertFarmSpawn(defs.farm);
```

with:

```ts
    assertWarps(defs, def);
    assertStructures(def);
  }
  assertNpcPlacements(defs);
  assertFarmSpawn(defs.farm);
```

(It runs after every warp is validated, so `arrivalTiles` only returns in-bounds tiles. Cost at module load: one 40 × 32 town generation and one walk of it.)

**3g. `src/people/cast.ts`.** Create:

```ts
/**
 * The cast (farmclaws part 4a spec §2): who each character is, how they look, where they stand
 * and what their chat box offers. Pure data and lookups. The spots themselves live on the map
 * definitions (`MapDefinition.npcs`), so the startup check, movement, placement and the renderer
 * all read the same list.
 */
import type { Appearance, MapId, NpcActionKind, NpcId } from '../core/types';
import { MAPS, type NpcPlacement } from '../world/maps';

export interface CastMember {
  readonly name: string;
  /** The line under the name in the chat box. */
  readonly role: string;
}

export const CAST: Readonly<Record<NpcId, CastMember>> = {
  sol: { name: 'Sol', role: 'Parts exchange' },
  cosmo: { name: 'Cosmo', role: 'Farmer' },
  barnaby: { name: 'Barnaby', role: 'Farmer' },
  marigold: { name: 'Marigold', role: 'General store' },
  bram: { name: 'Bram', role: 'Blacksmith' },
  juniper: { name: 'Juniper', role: 'Carpenter' },
  tess: { name: 'Tess', role: 'Ranch' },
};

/** The one prop each character carries on top of the player's model (spec §2.3). */
export const NPC_PROPS = ['toolApron', 'featherHat', 'clipboard', 'seedPouch', 'smithApron', 'pencil', 'neckerchief'] as const;
export type NpcProp = (typeof NPC_PROPS)[number];

export interface CastLook {
  readonly appearance: Appearance;
  readonly prop: NpcProp;
}

/**
 * Each character's fixed look: palette indices within the APPEARANCE ranges, plus their prop.
 * Every character has a shirt colour of their own and none wears the player's shirt 0, so no two
 * of them, and none of them and a new player, look alike. Hats: 0 is the farmer's straw hat, 1 no
 * hat, 2 a cap, 3 a knitted hat. Cosmo's feathered hat is his prop and Juniper's pencil sits on the
 * head, so both wear no hat; Sol wears the cap, Barnaby the knitted hat and Tess the straw hat.
 */
export const CAST_LOOKS: Readonly<Record<NpcId, CastLook>> = {
  sol: { appearance: { skinTone: 3, hairStyle: 2, hairColor: 4, shirtColor: 3, overallsColor: 2, hat: 2 }, prop: 'toolApron' },
  cosmo: { appearance: { skinTone: 1, hairStyle: 1, hairColor: 2, shirtColor: 5, overallsColor: 1, hat: 1 }, prop: 'featherHat' },
  barnaby: { appearance: { skinTone: 2, hairStyle: 0, hairColor: 5, shirtColor: 1, overallsColor: 4, hat: 3 }, prop: 'clipboard' },
  marigold: { appearance: { skinTone: 0, hairStyle: 2, hairColor: 3, shirtColor: 6, overallsColor: 3, hat: 1 }, prop: 'seedPouch' },
  bram: { appearance: { skinTone: 4, hairStyle: 0, hairColor: 1, shirtColor: 2, overallsColor: 5, hat: 1 }, prop: 'smithApron' },
  juniper: { appearance: { skinTone: 2, hairStyle: 1, hairColor: 0, shirtColor: 7, overallsColor: 0, hat: 1 }, prop: 'pencil' },
  tess: { appearance: { skinTone: 1, hairStyle: 2, hairColor: 5, shirtColor: 4, overallsColor: 2, hat: 0 }, prop: 'neckerchief' },
};

/** The character standing on (tx, tz) of map `mapId`, or null. */
export function npcAt(mapId: MapId, tx: number, tz: number): NpcId | null {
  for (const placement of MAPS[mapId].npcs) {
    if (placement.tx === tx && placement.tz === tz) return placement.id;
  }
  return null;
}

/** Where `npc` stands, or null when no map places them. */
export function npcSpot(npc: NpcId): { readonly mapId: MapId; readonly placement: NpcPlacement } | null {
  for (const def of Object.values(MAPS)) {
    const placement = def.npcs.find((p) => p.id === npc);
    if (placement !== undefined) return { mapId: def.id, placement };
  }
  return null;
}

/** A button in the chat box (spec §3.2). */
export interface NpcAction {
  readonly kind: NpcActionKind;
  readonly label: string;
}

const NO_ACTIONS: readonly NpcAction[] = Object.freeze([]);

const ACTIONS: Readonly<Record<NpcId, readonly NpcAction[]>> = {
  sol: NO_ACTIONS,
  cosmo: NO_ACTIONS,
  barnaby: NO_ACTIONS,
  marigold: Object.freeze([{ kind: 'shop', label: 'Shop' }]),
  bram: NO_ACTIONS,
  juniper: NO_ACTIONS,
  tess: NO_ACTIONS,
};

/** The chat box's action buttons for `npc`, in order: Marigold's Shop, and none for anyone else yet. */
export function npcActions(npc: NpcId): readonly NpcAction[] {
  return ACTIONS[npc];
}
```

(`Object.values(MAPS)` keeps the registry's insertion order, `MAP_IDS` order, so `cast.ts` needs no value import from `core/types`.)

**3h. `src/state/intents.ts`.** Replace:

```ts
import { getItem, type FertilizerItem, type PlaceableItem, type SeedItem, type ToolItem } from '../items/items';
```

with:

```ts
import { getItem, type FertilizerItem, type PlaceableItem, type SeedItem, type ToolItem } from '../items/items';
import { npcAt } from '../people/cast';
```

Replace the doc comment of `placementProblem`:

```ts
/**
 * Why `itemId` can't be placed on `target` of the active map, or null when it can. The tile must
 * be free walkable ground (no object, blocker or crop) and not a reserved tile; paths go on
 * grass only, everything else on grass or unfertilised soil; sprinklers and scarecrows only on
 * the farm. An empty string means "no, silently" (out of bounds).
 */
```

with:

```ts
/**
 * Why `itemId` can't be placed on `target` of the active map, or null when it can. The tile must
 * be free walkable ground (no object, blocker or crop), not a character's spot and not a reserved
 * tile; paths go on grass only, everything else on grass or unfertilised soil; sprinklers and
 * scarecrows only on the farm. An empty string means "no, silently" (out of bounds).
 */
```

and in its body replace:

```ts
  if (isFarmOnlyPlaceable(itemId) && state.player.mapId !== 'farm') return `The ${getItem(itemId).name.toLowerCase()} belongs on your farm.`;
```

with:

```ts
  if (isFarmOnlyPlaceable(itemId) && state.player.mapId !== 'farm') return `The ${getItem(itemId).name.toLowerCase()} belongs on your farm.`;
  if (npcAt(state.player.mapId, target.tx, target.tz) !== null) return "Someone's standing there.";
```

**3i. `src/state/reducer.ts`.** Replace:

```ts
import { getItem, isSeedItemId, sellPriceFor } from '../items/items';
```

with:

```ts
import { getItem, isSeedItemId, sellPriceFor } from '../items/items';
import { npcAt } from '../people/cast';
```

Replace the first line of `movePlayer`'s doc comment:

```ts
 * One grid step. Inside the grid the destination must be walkable. Stepping off the edge takes
```

with:

```ts
 * One grid step. Inside the grid the destination must be walkable and no character may stand on
 * it (part 4a spec §2.2); a refused step only turns the player. Stepping off the edge takes
```

and in `movePlayer` replace:

```ts
    if (isWalkable(requireTile(world, destination.tx, destination.tz))) {
```

with:

```ts
    if (isWalkable(requireTile(world, destination.tx, destination.tz)) && npcAt(player.mapId, destination.tx, destination.tz) === null) {
```

A refused step falls through to the existing last line, `return player.facing === direction ? state : { ...state, player: { ...player, facing: direction } };`, so the player turns and nothing else changes. No warp arrival tile can hold a character (arrivals are reserved), so the warp branch needs no change.

- [ ] **Step 4: Existing tests**

None need editing; this step confirms why:
- No test builds a `MapDefinition` literal. `tests/maps.test.ts` checks the definitions with `toMatchObject` (lines ~125, ~166, ~182), which ignores the new `npcs` key, and its `withDef` helper spreads `MAPS[id]`, so every broken definition there keeps the shipped `npcs`.
- `tests/intents.test.ts`'s property test ("the planned outcome always matches what the reducer does") stands the player on random town tiles; a placeable aimed at a character's spot now plans a blocked `place` with "Someone's standing there.", and the reducer executes that same plan, so the property holds.
- `tests/reducer.test.ts` ("does nothing, silently, when interacting with a town building") stands at (6, 7), which is no character's spot; `tests/warps.test.ts` uses only gate tiles; `tests/determinism.test.ts`'s traveller only walks the town between its arrival (1, 16) and the west gate.

- [ ] **Step 5: Run it and see it pass**

Run: `npx vitest run tests/cast.test.ts tests/maps.test.ts tests/placement.test.ts tests/intents.test.ts tests/reducer.test.ts tests/warps.test.ts tests/determinism.test.ts`
Expected: PASS (`cast.test.ts`: 20 tests).

- [ ] **Step 6: The full gate**

Run: `npm run typecheck && npm test && npm run build`
Expected: all green, one more test file than after Task 1.

- [ ] **Step 7: Commit**

```bash
git add src/core/types.ts src/world/maps/types.ts src/world/maps/farm.ts src/world/maps/forest.ts src/world/maps/town.ts src/world/maps/lookup.ts src/world/maps/index.ts src/people/cast.ts src/state/intents.ts src/state/reducer.ts tests/cast.test.ts
git commit -m "Farmclaws part 4a: the cast stands in town and blocks the way

The new src/people/cast.ts holds each character's name, role line, look and
chat-box actions, and npcAt finds who stands on a tile. The spots live on the
map definitions (MapDefinition.npcs), so the startup check, movement and
placement read one list: the town places Sol and the four shopkeepers, and the
startup check rejects a spot that is off the map, unwalkable, reserved, on or
in front of a door, shared, unreachable from the map's arrivals, or a second
spot for the same character. Walking into a character only turns the player;
placing on one says \"Someone's standing there.\". Cosmo and Barnaby get their
spots with the Neighbours map, so for now a character stands on at most one
map (R4).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

---

### Task 3: The parts exchange

**Files:**
- Modify: `src/core/types.ts` (`STRUCTURE_KINDS`, ~line 221)
- Modify: `src/world/maps/town.ts` (header comment, lines 6–9; `TOWN_BACK_BAND_DEPTH`'s doc, line 20; `structures`, lines 31–51; `TOWN_SQUARE`'s doc, line 55; `assertTownLayout`'s doc and message, lines 72–86)
- Modify: `src/render/townGeometry.ts` (header comment, lines 1–12; `FEATURE`, line 49; `ShopEmblem`, line 85; `emblemParts`, ~lines 283–308; the notice board section, lines 422–463, becomes the parts exchange; `structureParts`' switch, ~line 564; `mapStructureParts`' doc, line 579)
- Modify: `src/render/StructureRenderer.ts` (header comment, lines 4–5)
- Modify: `src/state/intents.ts` (the comment in `planInteraction`'s blocker switch, ~line 499)
- Test: `tests/maps.test.ts` (`structureAt` check ~line 283; `assertMapDefinitions`' `broken` list ~line 344; "the town, Brookhollow", ~lines 495–590)
- Test: `tests/scenery.test.ts` (header line 7; `townGeometry` import ~line 44; `world/grid` import line 55; "town structures", ~lines 310–345)

**Interfaces:**
- Consumes:
  - Task 2: the town's `npcs` (Sol at (21, 7), east of the tile in front of the parts exchange's door (20, 7)) and `assertNpcPlacements`, which rejects a spot on a door tile or in front of a door. Neither changes here: (20, 6) gains a door, and Sol already stands beside its front tile, as spec §2.1 and §4 place him.
  - Existing code: `STRUCTURE_KINDS` / `StructureKind`; `StructurePlacement`; `assertMapDefinitions` (`assertStructures`, `assertTownLayout`); `structureAt`; the town's `generateTown` (every structure tile becomes `blockedTile(Blocker.Building)`); in `townGeometry.ts` the private shop builders `shopFrame`, `shopShellParts`, `signParts`, `emblemParts`, `cosmetic`, and the exported `ShopStyle`, `ShopSpec`, `SHOP_SHAPE`, `SHOP_INSET`, `shopPlacement`, `WINDOW_FRAME`; from `geometryParts.ts` `box`, `paint`, `pose`, `pick`, `createPartSet`, `transformParts`, `doorParts`, `windowParts`, `wallLanternParts`, `gableRoofParts`, `gableRoofFrame`, `STRUCTURE_COLORS`; `PALETTE.binLid`; test helpers `key`, `r`, `SEEDS`, `withDef`, `structureBox`, `EPS`.
- Produces:
  - `src/core/types.ts`: `STRUCTURE_KINDS` loses `'noticeBoard'` and gains `'partsExchange'` in its place (same position, after `'ranch'`).
  - `src/world/maps/town.ts`: `{ kind: 'noticeBoard', rect: rect(19, 6, 2, 1), door: null }`, `hedge(18, 0, 4, 6)`, `hedge(18, 6, 1, 1)` and `hedge(21, 6, 1, 1)` are replaced by `{ kind: 'partsExchange', rect: rect(18, 0, 4, 7), door: { tx: 20, tz: 6 } }`, listed after the ranch. The comments and `assertTownLayout`'s message say "parts exchange" where they said "notice board". The generated town is tile for tile what it was.
  - `src/render/townGeometry.ts`: private `partsExchangeParts(grid, offset, s, out)` replaces `noticeBoardParts` (R3); `ShopEmblem` gains `'cogClaw'`; `export const PARTS_EXCHANGE_STYLE: ShopStyle` and `export const PARTS_EXCHANGE_SHAPE` (the render tuning numbers, as the file's other builders keep theirs); `FEATURE.notice` (101) becomes `FEATURE.crate` (101).
  - `src/state/intents.ts`: the blocker-switch comment says "the parts exchange" for "the notice board".
  - `tests/maps.test.ts`: the structure at (20, 6) is the parts exchange; the exchange covers exactly the union of the old notice board and its three hedges; the town's generated tiles are pinned against a literal list (the whole back band, the well and the six lamp posts are buildings) independent of `def.structures`; the back band is still covered exactly once; two new broken definitions for `assertTownLayout`.
  - `tests/scenery.test.ts`: the parts exchange is a two-storey workshop with ten glow-glass parts (five upstairs), one big display window, a sign above the door and a crate east of the step, inside its rect.

- [ ] **Step 1: Write the failing tests**

**1a. `tests/maps.test.ts`.** In "answers isReservedTile and structureAt" (~line 283), replace:

```ts
    expect(structureAt(MAPS.town, 20, 6)?.kind).toBe('noticeBoard');
```

with:

```ts
    expect(structureAt(MAPS.town, 20, 6)?.kind).toBe('partsExchange');
    expect(structureAt(MAPS.town, 18, 0)?.kind).toBe('partsExchange');
```

In `assertMapDefinitions`' `broken` list (~line 342), replace:

```ts
    [
      'a town back band with a gap',
      withDef('town', { structures: MAPS.town.structures.filter((s) => !(s.kind === 'hedge' && s.rect.x0 === 38)) }),
    ],
```

with:

```ts
    [
      'a town back band with a gap',
      withDef('town', { structures: MAPS.town.structures.filter((s) => !(s.kind === 'hedge' && s.rect.x0 === 38)) }),
    ],
    [
      'a town back band with a gap where the parts exchange stands',
      withDef('town', { structures: MAPS.town.structures.filter((s) => s.kind !== 'partsExchange') }),
    ],
    [
      'a parts exchange door off its front row',
      withDef('town', {
        structures: MAPS.town.structures.map((s) => (s.kind === 'partsExchange' ? { ...s, door: { tx: 20, tz: 5 } } : s)),
      }),
    ],
```

In "the town, Brookhollow", replace the whole of "places exactly the structures of the spec" and "covers the back band z 0–6 exactly once with shops, hedges and the notice board" (~lines 499–533):

```ts
  it('places exactly the structures of the spec', () => {
    const lamp = (tx: number, tz: number) => ({ kind: 'lampPost', rect: r(tx, tz, 1, 1), door: null });
    const hedge = (x0: number, z0: number, width: number, depth: number) => ({ kind: 'hedge', rect: r(x0, z0, width, depth), door: null });
    expect(def.structures).toEqual([
      { kind: 'generalStore', rect: r(3, 0, 7, 7), door: { tx: 6, tz: 6 } },
      { kind: 'blacksmith', rect: r(12, 0, 6, 7), door: { tx: 15, tz: 6 } },
      { kind: 'carpenter', rect: r(22, 0, 6, 7), door: { tx: 25, tz: 6 } },
      { kind: 'ranch', rect: r(31, 0, 7, 7), door: { tx: 34, tz: 6 } },
      { kind: 'noticeBoard', rect: r(19, 6, 2, 1), door: null },
      hedge(0, 0, 3, 7),
      hedge(10, 0, 2, 7),
      hedge(18, 0, 4, 6),
      hedge(18, 6, 1, 1),
      hedge(21, 6, 1, 1),
      hedge(28, 0, 3, 7),
      hedge(38, 0, 2, 7),
      { kind: 'well', rect: r(19, 13, 2, 2), door: null },
      lamp(13, 8),
      lamp(26, 8),
      lamp(13, 20),
      lamp(26, 20),
      lamp(4, 14),
      lamp(36, 14),
    ]);
  });

  it('covers the back band z 0–6 exactly once with shops, hedges and the notice board', () => {
```

with:

```ts
  it('places exactly the structures of the spec', () => {
    const lamp = (tx: number, tz: number) => ({ kind: 'lampPost', rect: r(tx, tz, 1, 1), door: null });
    const hedge = (x0: number, z0: number, width: number, depth: number) => ({ kind: 'hedge', rect: r(x0, z0, width, depth), door: null });
    expect(def.structures).toEqual([
      { kind: 'generalStore', rect: r(3, 0, 7, 7), door: { tx: 6, tz: 6 } },
      { kind: 'blacksmith', rect: r(12, 0, 6, 7), door: { tx: 15, tz: 6 } },
      { kind: 'carpenter', rect: r(22, 0, 6, 7), door: { tx: 25, tz: 6 } },
      { kind: 'ranch', rect: r(31, 0, 7, 7), door: { tx: 34, tz: 6 } },
      { kind: 'partsExchange', rect: r(18, 0, 4, 7), door: { tx: 20, tz: 6 } },
      hedge(0, 0, 3, 7),
      hedge(10, 0, 2, 7),
      hedge(28, 0, 3, 7),
      hedge(38, 0, 2, 7),
      { kind: 'well', rect: r(19, 13, 2, 2), door: null },
      lamp(13, 8),
      lamp(26, 8),
      lamp(13, 20),
      lamp(26, 20),
      lamp(4, 14),
      lamp(36, 14),
    ]);
  });

  it('stands the parts exchange on exactly the tiles of the old notice board and its three hedges', () => {
    // Before part 4a: hedge(18, 0, 4, 6), hedge(18, 6, 1, 1), hedge(21, 6, 1, 1) and the notice board (19, 6, 2, 1).
    const before = [r(18, 0, 4, 6), r(18, 6, 1, 1), r(21, 6, 1, 1), r(19, 6, 2, 1)];
    const exchange = def.structures.find((s) => s.kind === 'partsExchange');
    if (exchange === undefined) throw new Error('no parts exchange');
    for (let tz = 0; tz < 32; tz++) {
      for (let tx = 0; tx < 40; tx++) {
        const old = before.filter((rect) => rectContains(rect, tx, tz)).length;
        expect(old, key(tx, tz)).toBeLessThanOrEqual(1);
        expect(rectContains(exchange.rect, tx, tz), key(tx, tz)).toBe(old === 1);
      }
    }
  });

  it('blocks exactly the tiles it blocked before the parts exchange, so saved towns need no migration', () => {
    // Pinned without reading def.structures: the whole back band (z 0–6), the well and the six
    // lamp posts are buildings, the river is water and everything else is open grass.
    const lamps = [key(13, 8), key(26, 8), key(13, 20), key(26, 20), key(4, 14), key(36, 14)];
    const isBuilding = (tx: number, tz: number): boolean =>
      tz <= 6 || (tx >= 19 && tx <= 20 && tz >= 13 && tz <= 14) || lamps.includes(key(tx, tz));
    let buildings = 0;
    forEachTile(town, (tile, tx, tz) => {
      const expected = isBuilding(tx, tz) ? blockedTile(Blocker.Building) : isTownRiver(tx, tz) ? blockedTile(Blocker.Water) : EMPTY_TILE;
      expect(tile, key(tx, tz)).toEqual(expected);
      if (tile.blocker === Blocker.Building) buildings++;
    });
    expect(buildings).toBe(40 * 7 + 4 + 6);
  });

  it('covers the back band z 0–6 exactly once with shops, hedges and the parts exchange', () => {
```

(The body of the back-band test stays as it is.)

Replace "opens every shop door onto a walkable path tile at z = 7, and the notice board is read from there" (~lines 576–590):

```ts
  it('opens every shop door onto a walkable path tile at z = 7, and the notice board is read from there', () => {
    for (const s of def.structures) {
      if (s.door === null) continue;
      expect(s.door.tz).toBe(6);
      expect(rectContains(s.rect, s.door.tx, s.door.tz)).toBe(true);
      const front = requireTile(town, s.door.tx, 7);
      expect(isWalkable(front), s.kind).toBe(true);
      expect(def.surfaceAt(s.door.tx, 7), s.kind).not.toBe('grass');
    }
    for (const tx of [19, 20]) {
      expect(isWalkable(requireTile(town, tx, 7))).toBe(true);
      expect(def.surfaceAt(tx, 7)).toBe('cobble');
    }
  });
```

with:

```ts
  it('opens every shop door and the parts exchange door onto a walkable path tile at z = 7', () => {
    expect(def.structures.filter((s) => s.door !== null).map((s) => s.kind)).toEqual([
      'generalStore',
      'blacksmith',
      'carpenter',
      'ranch',
      'partsExchange',
    ]);
    for (const s of def.structures) {
      if (s.door === null) continue;
      expect(s.door.tz).toBe(6);
      expect(rectContains(s.rect, s.door.tx, s.door.tz)).toBe(true);
      const front = requireTile(town, s.door.tx, 7);
      expect(isWalkable(front), s.kind).toBe(true);
      expect(def.surfaceAt(s.door.tx, 7), s.kind).not.toBe('grass');
    }
  });
```

Every name these tests use is already imported or defined in the file (`Blocker`, `EMPTY_TILE`, `blockedTile`, `forEachTile`, `isTownRiver`, `rectContains`, `requireTile`, `isWalkable`, `key`, `r`, `town`, `def`).

**1b. `tests/scenery.test.ts`.** In the header comment (line 7), replace:

```ts
 * - the town's structures stay inside their rects (shops and hedges), low (well) or thin (lamps);
```

with:

```ts
 * - the town's structures stay inside their rects (shops, the parts exchange and hedges), low
 *   (well) or thin (lamps), and the parts exchange is a two-storey workshop;
```

Replace the `townGeometry` import (~line 44):

```ts
import {
  LAMP_POST_SHAPE,
  SHOP_INSET,
  SHOP_KINDS,
  SHOP_SHAPE,
  SHOP_STYLES,
  WELL_MAX_HEIGHT,
  mapStructureParts,
  structureParts,
} from '../src/render/townGeometry';
```

with:

```ts
import {
  LAMP_POST_SHAPE,
  PARTS_EXCHANGE_SHAPE,
  PARTS_EXCHANGE_STYLE,
  SHOP_INSET,
  SHOP_KINDS,
  SHOP_SHAPE,
  SHOP_STYLES,
  WELL_MAX_HEIGHT,
  mapStructureParts,
  structureParts,
} from '../src/render/townGeometry';
```

Replace the grid import (line 55):

```ts
import { tileMinX, tileMinZ, worldRect } from '../src/world/grid';
```

with:

```ts
import { tileCenterX, tileMinX, tileMinZ, worldRect } from '../src/world/grid';
```

In "builds every structure of the town and nothing on the other maps", replace:

```ts
    // Shop windows, door panes and wall lanterns, plus one lamp per post.
    expect(town.glass.length).toBeGreaterThanOrEqual(4 * 3 + structures.filter((s) => s.kind === 'lampPost').length);
```

with:

```ts
    // Shop and parts exchange windows, door panes and wall lanterns, plus one lamp per post.
    expect(town.glass.length).toBeGreaterThanOrEqual((SHOP_KINDS.length + 1) * 3 + structures.filter((s) => s.kind === 'lampPost').length);
```

Replace:

```ts
  it('keeps every shop, hedge and the notice board inside its rect, so nothing reaches a walkable tile', () => {
```

with:

```ts
  it('keeps every shop, hedge and the parts exchange inside its rect, so nothing reaches a walkable tile', () => {
```

Then insert, directly before `  it('keeps the well low and the lamp posts thin, with glowing lamps', () => {`:

```ts
  it('builds the parts exchange as a two-storey workshop with a cog-and-claw sign, a big window and a crate by the door', () => {
    const s = structures.find((st) => st.kind === 'partsExchange');
    if (s === undefined || s.door === null) throw new Error('no parts exchange with a door');
    const { body, parts } = structureBox(s);
    const P = PARTS_EXCHANGE_SHAPE;
    const style = PARTS_EXCHANGE_STYLE;
    const boxOf = (part: THREE.BufferGeometry): THREE.Box3 =>
      new THREE.Box3().setFromBufferAttribute(part.getAttribute('position') as THREE.BufferAttribute);
    const base = SHOP_SHAPE.foundationHeight;

    // Two storeys, taller than any shop.
    expect(style.wallHeight).toBeGreaterThanOrEqual(2 * P.storeyHeight - EPS);
    expect(style.wallHeight).toBeGreaterThan(Math.max(...SHOP_KINDS.map((kind) => SHOP_STYLES[kind].wallHeight)));

    // Glow glass: the display window, two upper front windows, four +X windows, the gable window,
    // the door pane and the lantern; five of them upstairs.
    const glass = parts.glass.map(boxOf);
    expect(glass).toHaveLength(10);
    expect(glass.filter((g) => g.min.y > base + P.storeyHeight)).toHaveLength(5);

    // The big front window: wider and taller than a shop window, on the ground floor.
    expect(P.displayWidth).toBeGreaterThan(SHOP_SHAPE.windowWidth);
    expect(P.displayHeight).toBeGreaterThan(SHOP_SHAPE.windowHeight);
    const display = glass.filter((g) => g.max.x - g.min.x >= P.displayWidth - EPS && g.max.y - g.min.y >= P.displayHeight - EPS);
    expect(display).toHaveLength(1);
    expect(display[0]!.max.y).toBeLessThan(base + P.storeyHeight);

    // The sign stands above the door at the eave edge, like the shops', and shows a cog and a claw.
    const front = tileMinZ(grid, s.rect.z0 + s.rect.depth) - SHOP_INSET.front;
    expect(body.max.z).toBeGreaterThan(front + SHOP_SHAPE.eaveOverhang);
    expect(body.max.y).toBeGreaterThan(style.wallHeight + SHOP_SHAPE.signHeight);
    expect(style.emblem).toBe('cogClaw');
    for (const kind of SHOP_KINDS) {
      expect(SHOP_STYLES[kind].wall).not.toBe(style.wall);
      expect(SHOP_STYLES[kind].roof.roof).not.toBe(style.roof.roof);
      expect(SHOP_STYLES[kind].emblem).not.toBe(style.emblem);
    }

    // A crate of parts in front of the wall, east of the door step, low on the ground.
    const stepEast = tileCenterX(grid, s.door.tx) + SHOP_SHAPE.doorWidth / 2 + P.stepOverhang;
    const crate = parts.body.map(boxOf).filter((b) => b.min.z > front && b.min.x > stepEast && b.max.y < 2 * P.crateHeight);
    expect(crate.length).toBeGreaterThan(0);
  });

```

(The in-rect test above already walks every structure but the well and the lamp posts, so it holds the parts exchange to its rect (18, 0, 4, 7) too.)

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run tests/maps.test.ts tests/scenery.test.ts`
Expected: FAIL.
- `tests/maps.test.ts`: "answers isReservedTile and structureAt" (`expected 'noticeBoard' to be 'partsExchange'`), "places exactly the structures of the spec" (the list still holds the notice board and the three hedges), "stands the parts exchange on exactly the tiles …" (`Error: no parts exchange`), "opens every shop door and the parts exchange door …" (the door list ends at `'ranch'`), and the two new `throws on …` cases ("a town back band with a gap where the parts exchange stands" and "a parts exchange door off its front row": filtering or mapping a kind the town doesn't have leaves the shipped definitions, which don't throw). "blocks exactly the tiles it blocked before the parts exchange …" **passes** already: it pins the invariant this task must keep.
- `tests/scenery.test.ts`: "builds the parts exchange as a two-storey workshop …" fails with `Error: no parts exchange with a door`.

(`npm run typecheck` also fails now: `'partsExchange'` isn't a `StructureKind` yet, and `PARTS_EXCHANGE_SHAPE` / `PARTS_EXCHANGE_STYLE` aren't exported.)

- [ ] **Step 3: Implement**

**3a. `src/core/types.ts`.** Replace:

```ts
export const STRUCTURE_KINDS = [
  'generalStore',
  'blacksmith',
  'carpenter',
  'ranch',
  'noticeBoard',
  'well',
  'lampPost',
  'hedge',
] as const;
```

with:

```ts
export const STRUCTURE_KINDS = [
  'generalStore',
  'blacksmith',
  'carpenter',
  'ranch',
  'partsExchange',
  'well',
  'lampPost',
  'hedge',
] as const;
```

Structures are map data, never saved, so no migration follows.

**3b. `src/world/maps/town.ts`.** (Task 2 added the town's `npcs` to `TOWN_MAP`; none of the anchors below is in that object.)

In the header comment, replace:

```ts
 * Occlusion rule: the camera looks from +X/+Z, so anything tall hides the tiles on its −X/−Z
 * side. The shops therefore stand against the back edge, and every other back-band tile
 * (z 0–6) is hedge or the notice board, so nothing walkable is ever hidden behind a building.
```

with:

```ts
 * Occlusion rule: the camera looks from +X/+Z, so anything tall hides the tiles on its −X/−Z
 * side. The shops and the parts exchange therefore stand against the back edge, and every other
 * back-band tile (z 0–6) is hedge, so nothing walkable is ever hidden behind a building.
```

Replace:

```ts
/** Rows z 0 … TOWN_BACK_BAND_DEPTH − 1 are shops, hedges and the notice board, wall to wall. */
```

with:

```ts
/** Rows z 0 … TOWN_BACK_BAND_DEPTH − 1 are shops, the parts exchange and hedges, wall to wall. */
```

Replace:

```ts
  { kind: 'ranch', rect: rect(31, 0, 7, 7), door: { tx: 34, tz: 6 } },
  { kind: 'noticeBoard', rect: rect(19, 6, 2, 1), door: null },
  hedge(0, 0, 3, 7),
  hedge(10, 0, 2, 7),
  hedge(18, 0, 4, 6),
  hedge(18, 6, 1, 1),
  hedge(21, 6, 1, 1),
  hedge(28, 0, 3, 7),
```

with:

```ts
  { kind: 'ranch', rect: rect(31, 0, 7, 7), door: { tx: 34, tz: 6 } },
  // Sol's parts exchange stands on exactly the tiles of the old notice board and its three
  // hedges, so the town's blocked tiles, and every saved town, stay the same.
  { kind: 'partsExchange', rect: rect(18, 0, 4, 7), door: { tx: 20, tz: 6 } },
  hedge(0, 0, 3, 7),
  hedge(10, 0, 2, 7),
  hedge(28, 0, 3, 7),
```

Replace:

```ts
/** Cobbled square, x 14–25, z 7–19: meets the blacksmith and carpenter doors and the notice board. */
```

with:

```ts
/** Cobbled square, x 14–25, z 7–19: meets the blacksmith, parts exchange and carpenter doors. */
```

Replace:

```ts
 * Town-only layout rules, checked by `assertMapDefinitions`: the shops, hedges and notice board
 * cover the back band exactly once; no structure touches the river or a path, except the low
```

with:

```ts
 * Town-only layout rules, checked by `assertMapDefinitions`: the shops, the parts exchange and
 * hedges cover the back band exactly once; no structure touches the river or a path, except the low
```

and replace:

```ts
        throw new RangeError(`Town: back-band tile (${tx}, ${tz}) is covered by [${kinds}], not by exactly one shop, hedge or notice board`);
```

with:

```ts
        throw new RangeError(`Town: back-band tile (${tx}, ${tz}) is covered by [${kinds}], not by exactly one shop, parts exchange or hedge`);
```

`assertTownLayout`'s door rules now also hold the parts exchange: its door (20, 6) is on its rect's front row (z0 0 + depth 7 − 1), and the tile in front, (20, 7), is cobble in the square with no structure on it. `assertStructures` sees no overlap: the exchange's rect is the union of the four rects it replaces, which touched nothing else.

**3c. `src/render/townGeometry.ts`.**

Replace the header comment:

```ts
/**
 * Painted geometry for Brookhollow's structures (`MapDefinition.structures`): the four shops, the
 * notice board, the well, the lamp posts and the trimmed hedges of the back band. Every builder
 * works in world space and pushes parts into a {@link PartSet}: painted opaque parts into `body`
 * (StructureRenderer merges them into the map's one painted mesh) and window and lamp glass into
 * `glass` (the shared glow-glass mesh). Nothing here touches the scene or game state.
 *
 * Occlusion: the camera looks from +X/+Z, so a point at height h hides the ground h units further
 * along −X and −Z. Everything stays inside its structure rect: the shops and hedges fill the back
 * band (z 0–6), so all they can hide is more back band; the notice board stands on the band's
 * front row; the well stays ≤ 0.9 tall and the lamp posts ≤ 0.15 wide, as the town layout allows.
 */
```

with:

```ts
/**
 * Painted geometry for Brookhollow's structures (`MapDefinition.structures`): the four shops, Sol's
 * parts exchange, the well, the lamp posts and the trimmed hedges of the back band. Every builder
 * works in world space and pushes parts into a {@link PartSet}: painted opaque parts into `body`
 * (StructureRenderer merges them into the map's one painted mesh) and window and lamp glass into
 * `glass` (the shared glow-glass mesh). Nothing here touches the scene or game state.
 *
 * Occlusion: the camera looks from +X/+Z, so a point at height h hides the ground h units further
 * along −X and −Z. Everything stays inside its structure rect: the shops, the parts exchange and
 * the hedges fill the back band (z 0–6), so all they can hide is more back band, however tall they
 * stand; the well stays ≤ 0.9 tall and the lamp posts ≤ 0.15 wide, as the town layout allows.
 */
```

Replace:

```ts
const FEATURE = { hedge: 91, notice: 101 } as const;
```

with:

```ts
const FEATURE = { hedge: 91, crate: 101 } as const;
```

(The notice board's salt 101 passes to the parts exchange's crate; the comment above it, "structureGeometry uses 11–61, sceneryGeometry 71–81", stays true.)

Replace:

```ts
/** What a shop's sign shows. */
export type ShopEmblem = 'sack' | 'anvil' | 'saw' | 'horseshoe';
```

with:

```ts
/** What a shop's sign shows (the parts exchange's sign shows the cog and claw). */
export type ShopEmblem = 'sack' | 'anvil' | 'saw' | 'horseshoe' | 'cogClaw';
```

Replace:

```ts
/** The emblem on a shop sign, centred at (x, y) on a face at z, facing +Z. */
function emblemParts(emblem: ShopEmblem, x: number, y: number, z: number, color: number, accent: number, out: PartSet): void {
```

with:

```ts
/** The parts exchange's emblem: an eight-toothed cog beside a three-fingered claw (world units, radians). */
const COG_CLAW_SHAPE = {
  /** Centres of the cog and the claw along X, either side of the emblem's centre. */
  cogX: -0.09,
  clawX: 0.1,
  thickness: 0.035,
  cogRadius: 0.07,
  cogTeeth: 8,
  toothSize: 0.04,
  hubRadius: 0.025,
  hubSides: 6,
  clawStemWidth: 0.035,
  clawStemHeight: 0.12,
  clawFingerWidth: 0.03,
  clawFingerLength: 0.1,
  /** How far the outer fingers lean from upright. */
  clawSpread: 0.45,
} as const;

/** The emblem on a shop sign, centred at (x, y) on a face at z, facing +Z. */
function emblemParts(emblem: ShopEmblem, x: number, y: number, z: number, color: number, accent: number, out: PartSet): void {
```

and in `emblemParts`, replace:

```ts
    case 'horseshoe':
      out.body.push(paint(pose(new THREE.TorusGeometry(0.1, 0.03, 4, 10, Math.PI * 1.5), { x, y, z, rz: -Math.PI / 4 }), color));
      return;
  }
}
```

with:

```ts
    case 'horseshoe':
      out.body.push(paint(pose(new THREE.TorusGeometry(0.1, 0.03, 4, 10, Math.PI * 1.5), { x, y, z, rz: -Math.PI / 4 }), color));
      return;
    case 'cogClaw': {
      const C = COG_CLAW_SHAPE;
      const cogX = x + C.cogX;
      const disc = new THREE.CylinderGeometry(C.cogRadius, C.cogRadius, C.thickness, C.cogTeeth * 2);
      out.body.push(paint(pose(disc, { x: cogX, y, z, rx: Math.PI / 2 }), color));
      for (let i = 0; i < C.cogTeeth; i++) {
        const angle = (i / C.cogTeeth) * Math.PI * 2;
        const tooth = { x: cogX + Math.cos(angle) * C.cogRadius, y: y + Math.sin(angle) * C.cogRadius, z, rz: angle };
        out.body.push(box(C.toothSize, C.toothSize, C.thickness, tooth, color));
      }
      const hub = new THREE.CylinderGeometry(C.hubRadius, C.hubRadius, C.thickness, C.hubSides);
      out.body.push(paint(pose(hub, { x: cogX, y, z: z + C.thickness / 2, rx: Math.PI / 2 }), accent));
      const clawX = x + C.clawX;
      const stemY = y - C.clawFingerLength / 2;
      const knuckle = stemY + C.clawStemHeight / 2;
      out.body.push(box(C.clawStemWidth, C.clawStemHeight, C.thickness, { x: clawX, y: stemY, z }, color));
      for (const side of [-1, 0, 1]) {
        const lean = side * C.clawSpread;
        const finger = {
          x: clawX + (Math.sin(lean) * C.clawFingerLength) / 2,
          y: knuckle + (Math.cos(lean) * C.clawFingerLength) / 2,
          z,
          rz: -lean,
        };
        out.body.push(box(C.clawFingerWidth, C.clawFingerLength, C.thickness, finger, color));
      }
      return;
    }
  }
}
```

(The emblem stays between the sign's painted "words", which start 0.25 either side of its centre: the cog reaches x − 0.18 … x, the claw x + 0.04 … x + 0.16, and both stay within 0.11 of y on a 0.36-tall board.)

Replace the whole notice board section, from its banner to the end of `noticeBoardParts`:

```ts
// ---------------------------------------------------------------------------
// Notice board
// ---------------------------------------------------------------------------

const NOTICE_COLORS = {
  post: 0x8a6a4e,
  board: 0xc99a68,
  frame: 0x7a5a40,
  roof: { roof: 0x8f6a4f, shingle: 0x7f5d44, ridge: 0x6f503a, barge: 0x7a5a40 } satisfies RoofColors,
  papers: [0xfffbef, 0xfff1a8, 0xffd3de, 0xd4e8ff] as const,
  pin: 0xe25a4f,
} as const;

/** Two posts carrying a framed cork board under a little gabled cap, pinned with notes. Faces +Z. */
function noticeBoardParts(grid: GridSpec, offset: Offset, s: StructurePlacement, out: PartSet): void {
  const b = rectBounds(grid, s.rect);
  const cx = (b.minX + b.maxX) / 2;
  const z = b.minZ + 0.42;
  const halfSpan = (b.maxX - b.minX) / 2 - 0.3;
  const boardY = 1.06;
  const boardW = halfSpan * 2 - 0.05;
  const boardH = 0.92;
  for (const sx of [-1, 1]) out.body.push(box(0.12, 1.72, 0.12, { x: cx + sx * halfSpan, y: 0.86, z }, NOTICE_COLORS.post));
  out.body.push(box(boardW, boardH, 0.08, { x: cx, y: boardY, z: z + 0.08 }, NOTICE_COLORS.board));
  for (const sy of [-1, 1]) out.body.push(box(boardW + 0.08, 0.06, 0.11, { x: cx, y: boardY + sy * (boardH / 2 + 0.03), z: z + 0.08 }, NOTICE_COLORS.frame));

  const cap = createPartSet();
  const roof: GableRoofSpec = { halfW: halfSpan + 0.06, halfD: 0.2, wallTop: 0, pitch: 0.5, thickness: 0.06, eaveOverhang: 0.1, gableOverhang: 0.08 };
  gableRoofParts(roof, NOTICE_COLORS.roof, cap);
  transformParts(cap.body, new THREE.Matrix4().makeTranslation(cx, boardY + boardH / 2 + 0.08, z + 0.04), out.body);

  const papers = 5;
  for (let i = 0; i < papers; i++) {
    const u = cosmetic(offset, FEATURE.notice, s.rect.x0, i, 0);
    const v = cosmetic(offset, FEATURE.notice, s.rect.x0, i, 1);
    const x = cx - boardW / 2 + 0.22 + ((i + 0.5 * u) / papers) * (boardW - 0.4);
    const y = boardY + (i % 2 === 0 ? 0.16 : -0.14) + (v - 0.5) * 0.12;
    const tilt = (cosmetic(offset, FEATURE.notice, s.rect.x0, i, 2) - 0.5) * 0.3;
    out.body.push(box(0.26, 0.32, 0.01, { x, y, z: z + 0.126, rz: tilt }, pick(NOTICE_COLORS.papers, cosmetic(offset, FEATURE.notice, s.rect.x0, i, 3))));
    out.body.push(box(0.04, 0.04, 0.02, { x, y: y + 0.13, z: z + 0.135 }, NOTICE_COLORS.pin));
  }
}
```

with:

```ts
// ---------------------------------------------------------------------------
// Parts exchange
// ---------------------------------------------------------------------------

/** Sol's parts exchange: steel-blue walls, slate trim and a mustard roof, distinct from the four shops. */
export const PARTS_EXCHANGE_STYLE: ShopStyle = {
  wall: 0xaebfcc,
  foundation: 0xa9a29a,
  trim: 0x46505e,
  roof: { roof: 0xd6ad48, shingle: 0xc59c3c, ridge: 0xb08a32, barge: 0x46505e },
  door: { trim: 0x46505e, door: 0x5f7f99, doorDark: 0x4a6680, awning: 0xd6ad48 },
  window: { ...WINDOW_FRAME, trim: 0x46505e, shutter: 0xd6ad48, shutterDark: 0xc0983c },
  sign: { board: 0xf2ead8, frame: 0x46505e, emblem: 0x6f7a86 },
  emblem: 'cogClaw',
  wallHeight: 4,
  pitch: 0.44,
  planters: false,
  boards: null,
  chimney: false,
};

/**
 * The parts exchange's own proportions (world units), on top of SHOP_SHAPE. Its walls stand
 * PARTS_EXCHANGE_STYLE.wallHeight tall: two storeys of `storeyHeight`, split by a trim band.
 */
export const PARTS_EXCHANGE_SHAPE = {
  storeyHeight: 2,
  floorBandHeight: 0.12,
  floorBandDepth: 0.06,
  /** The door frame's width either side of the door (doorParts). */
  doorFrame: 0.1,
  /** The big display window on the door's −X side: wider and taller than a shop window, no shutters. */
  displayWidth: 1,
  displayHeight: 0.96,
  displayCenterHeight: 1,
  lanternHeight: 1.36,
  upperWindowWidth: 0.56,
  upperWindowHeight: 0.62,
  upperWindowCenterHeight: 2.95,
  /** The two upper front windows sit this far either side of the footprint centre. */
  upperWindowSpacing: 0.8,
  /** The +X wall has a window on each storey this far either side of its middle. */
  sideWindowSpacing: 1.4,
  gableWindowWidth: 0.46,
  gableWindowHeight: 0.42,
  /** The gable window's centre above the wall tops, as a share of the gable's rise. */
  gableWindowRise: 0.36,
  /** Half the door step's width past the door: doorParts makes the step doorWidth + 0.52 wide. */
  stepOverhang: 0.26,
  /** The crate stands this far east of the door step and this far out from the wall. */
  crateGap: 0.04,
  crateWallGap: 0.12,
  crateWidth: 0.36,
  crateDepth: 0.34,
  crateHeight: 0.28,
  crateSlat: 0.035,
  /** How far the slats stand proud of the planks; also the thickness of the dark inside. */
  crateSlatProud: 0.008,
  /** The plank rim round the crate's dark inside. */
  crateRim: 0.03,
  /** Spare parts in the crate, laid out two by two: cogs and bolts in turn. */
  crateParts: 4,
  partSize: 0.09,
  partThickness: 0.025,
  /** How far the parts rise above the crate's rim. */
  partHeight: 0.06,
  partJitter: 0.04,
  partTilt: 0.5,
  cogSides: 8,
} as const;

const PARTS_EXCHANGE_COLORS = {
  crate: STRUCTURE_COLORS.binPlank,
  crateSlat: PALETTE.binLid,
  crateInside: 0x4a3a30,
  metals: [0xa7b0ba, 0xc98b5a, 0x7d8794] as const,
} as const;

/**
 * A crate of spare parts centred on `x` in front of the wall face at `front`: planks with two
 * slats, a dark inside and cogs and bolts poking out of it. `unit(i, k)` is a cosmetic [0, 1)
 * value for part i.
 */
function partsCrateParts(x: number, front: number, unit: (i: number, k: number) => number, out: PartSet): void {
  const P = PARTS_EXCHANGE_SHAPE;
  const C = PARTS_EXCHANGE_COLORS;
  const z = front + P.crateWallGap + P.crateDepth / 2;
  out.body.push(box(P.crateWidth, P.crateHeight, P.crateDepth, { x, y: P.crateHeight / 2, z }, C.crate));
  for (const third of [1, 2]) {
    const slat = { x, y: (third * P.crateHeight) / 3, z };
    out.body.push(box(P.crateWidth + 2 * P.crateSlatProud, P.crateSlat, P.crateDepth + 2 * P.crateSlatProud, slat, C.crateSlat));
  }
  const insideW = P.crateWidth - 2 * P.crateRim;
  const insideD = P.crateDepth - 2 * P.crateRim;
  out.body.push(box(insideW, P.crateSlatProud, insideD, { x, y: P.crateHeight + P.crateSlatProud / 2, z }, C.crateInside));
  for (let i = 0; i < P.crateParts; i++) {
    const px = x + ((i % 2) - 0.5) * (insideW / 2) + (unit(i, 0) - 0.5) * P.partJitter;
    const pz = z + (Math.floor(i / 2) - 0.5) * (insideD / 2) + (unit(i, 1) - 0.5) * P.partJitter;
    const tilt = (unit(i, 2) - 0.5) * P.partTilt;
    const color = pick(C.metals, unit(i, 3));
    if (i % 2 === 0) {
      // A cog standing on edge, half sunk in the pile.
      const r = P.partSize / 2;
      const cog = new THREE.CylinderGeometry(r, r, P.partThickness, P.cogSides);
      out.body.push(paint(pose(cog, { x: px, y: P.crateHeight + P.partHeight - r, z: pz, rx: Math.PI / 2, ry: tilt }), color));
    } else {
      out.body.push(box(P.partThickness, 2 * P.partHeight, P.partThickness, { x: px, y: P.crateHeight, z: pz, rz: tilt }, color));
    }
  }
}

/**
 * The parts exchange in its own space (see {@link ShopSpec}): a shop's shell and roof two storeys
 * tall with a trim band between them, the door with its awning and step, the cog-and-claw sign
 * above it, a big display window on the door's −X side, a wall lantern and a crate of parts on its
 * +X side, two shuttered windows upstairs, a window on each storey of the +X wall either side of
 * its middle, and one in the +X gable.
 */
function createPartsExchangeParts(spec: ShopSpec, unit: (i: number, k: number) => number, out: PartSet): void {
  const S = SHOP_SHAPE;
  const P = PARTS_EXCHANGE_SHAPE;
  const style = PARTS_EXCHANGE_STYLE;
  const f = shopFrame(spec, style);
  shopShellParts(f, style, out);
  gableRoofParts(f.roof, style.roof, out);
  doorParts(
    { x: f.doorX, front: f.halfD, base: f.base, width: S.doorWidth, height: S.doorHeight, stepDepth: S.stepDepth },
    style.door,
    out,
  );
  signParts(f, style, out);

  // The trim band between the storeys, on the two walls the camera sees.
  const bandY = f.base + P.storeyHeight;
  const band = P.floorBandDepth;
  out.body.push(box(f.halfW * 2 + 2 * band, P.floorBandHeight, band, { y: bandY, z: f.halfD + band / 2 }, style.trim));
  out.body.push(box(band, P.floorBandHeight, f.halfD * 2 + 2 * band, { x: f.halfW + band / 2, y: bandY }, style.trim));

  // Ground floor: the display window fills the wall between the −X corner post and the door;
  // the lantern and the crate stand on the door's other side.
  const frameHalf = S.doorWidth / 2 + P.doorFrame;
  const postInner = f.halfW - S.cornerPost / 2;
  const placement = new THREE.Matrix4();
  const displayEnd = f.doorX - frameHalf - S.lanternGap;
  const display = { width: P.displayWidth, height: P.displayHeight, shutters: false, planter: false };
  windowParts(display, style.window, placement.makeTranslation((displayEnd - postInner) / 2, f.base + P.displayCenterHeight, f.halfD), out);
  wallLanternParts(f.doorX + frameHalf + S.lanternGap / 2, f.base + P.lanternHeight, f.halfD, out);
  const crateX = Math.min(f.doorX + S.doorWidth / 2 + P.stepOverhang + P.crateGap + P.crateWidth / 2, postInner - P.crateWidth / 2);
  partsCrateParts(crateX, f.halfD, unit, out);

  // Upstairs: two shuttered windows over the shopfront.
  const upper = { width: P.upperWindowWidth, height: P.upperWindowHeight, shutters: true, planter: false };
  for (const sx of [-1, 1]) {
    windowParts(upper, style.window, placement.makeTranslation(sx * P.upperWindowSpacing, f.base + P.upperWindowCenterHeight, f.halfD), out);
  }

  // The +X wall: a window on each storey either side of its middle, and one in the gable.
  const faceEast = new THREE.Matrix4().makeRotationY(Math.PI / 2);
  const ground = { width: S.windowWidth, height: S.windowHeight, shutters: true, planter: false };
  for (const sz of [-1, 1]) {
    placement.copy(faceEast).setPosition(f.halfW, f.base + S.windowCenterHeight, sz * P.sideWindowSpacing);
    windowParts(ground, style.window, placement, out);
    placement.copy(faceEast).setPosition(f.halfW, f.base + P.upperWindowCenterHeight, sz * P.sideWindowSpacing);
    windowParts(upper, style.window, placement, out);
  }
  placement.copy(faceEast).setPosition(f.halfW, f.wallTop + gableRoofFrame(f.roof).rise * P.gableWindowRise, 0);
  windowParts({ width: P.gableWindowWidth, height: P.gableWindowHeight, shutters: false, planter: false }, style.window, placement, out);
}

/**
 * The parts exchange, placed in its rect exactly like a shop (the same insets, the door centred on
 * the door tile's column), so it stays inside the rect as the shops do.
 */
function partsExchangeParts(grid: GridSpec, offset: Offset, s: StructurePlacement, out: PartSet): void {
  const { spec, origin } = shopPlacement(grid, s.rect, s.door);
  const local = createPartSet();
  createPartsExchangeParts(spec, (i, k) => cosmetic(offset, FEATURE.crate, s.rect.x0, i, k), local);
  const move = new THREE.Matrix4().makeTranslation(origin.x, origin.y, origin.z);
  transformParts(local.body, move, out.body);
  transformParts(local.glass, move, out.glass);
}
```

How it fits the rect (18, 0, 4, 7) with tile size 1: `shopPlacement` gives a 3.4 × 6.08 footprint centred at x 20.0, so the door (tile 20's centre, 20.5) sits 0.5 east of centre, inside the door clamp (0.97). Every part is a shop part except the band (0.06 proud), the display window, the upper and side windows (the shops' `windowParts`), and the crate, which reaches 0.46 in front of the wall (the front inset is 0.62) and ends at x 1.59 from centre, inside the +X corner post (1.61). The display window's sill spans exactly the 1.28 between the −X corner post and the door's lantern gap. The tall walls and roof only hide back band: everything stays behind the rect's front edge (z 7), and all of the band west and north of it is the blacksmith, hedge or off-grid.

Glass goes where the shops' does: the windows, the door pane and the lantern push their panes into the local set's `glass`, and `partsExchangeParts` moves them into `out.glass`, the shared glow-glass mesh.

In `structureParts`, replace:

```ts
    case 'noticeBoard':
      noticeBoardParts(grid, offset, s, out);
      return;
```

with:

```ts
    case 'partsExchange':
      partsExchangeParts(grid, offset, s, out);
      return;
```

and replace:

```ts
/** Every structure of a map (the town's shops, board, well, lamp posts and hedges), in world space. */
```

with:

```ts
/** Every structure of a map (the town's shops, parts exchange, well, lamp posts and hedges), in world space. */
```

The imports stay as they are: `GableRoofSpec` is still used by `ShopFrame`, `RoofColors` by `ShopStyle`, and `pick`, `PALETTE` and `STRUCTURE_COLORS` by the hedges, the well and the crate.

**3d. `src/render/StructureRenderer.ts`.** Replace:

```ts
 * stone wall, trails leading off the grid at every warp, the farmstead (farmhouse and shipping
 * bin) and the town's structures (shops, notice board, well, lamp posts and hedges).
```

with:

```ts
 * stone wall, trails leading off the grid at every warp, the farmstead (farmhouse and shipping
 * bin) and the town's structures (shops, the parts exchange, well, lamp posts and hedges).
```

**3e. `src/state/intents.ts`.** In `planInteraction`'s blocker switch, replace:

```ts
    // Debris waits for the right tool, and town buildings, the notice board, hedges and props
    // have nothing to interact with yet: silent, so no toast.
```

with:

```ts
    // Debris waits for the right tool, and town buildings, the parts exchange, hedges and props
    // have nothing to interact with yet: silent, so no toast.
```

(The parts exchange's door does nothing yet, spec §4: its tiles are `Blocker.Building`, which already falls through to this silent case.)

**3f. Check nothing else names the notice board.** Run:

```bash
grep -rni "notice" src tests
```

Expected: only these, which stay: `src/core/hash.ts` (`NoticeBoard: 0x94d049bb,` in `Salt`) and its pin in `tests/sections.test.ts` (no code reads `Salt.NoticeBoard`; renaming a salt is out of scope); this task's own history notes, the comment above the parts exchange in `src/world/maps/town.ts` ("the old notice board") and the test "stands the parts exchange on exactly the tiles of the old notice board …" in `tests/maps.test.ts`; and "Pet your animals. They notice." if Task 5 has run. If Task 2's town `npcs` comment says "notice board", it becomes "parts exchange" in this step and `src/world/maps/town.ts` is already in this commit.

- [ ] **Step 4: Run them and see them pass**

Run: `npx vitest run tests/maps.test.ts tests/scenery.test.ts tests/cast.test.ts tests/sections.test.ts tests/renderMaps.test.ts`
Expected: PASS. `tests/cast.test.ts` still passes: Sol's spot (21, 7) is neither the exchange's door (20, 6) nor the tile in front of it (20, 7), and the town's tiles are unchanged, so every spot is still walkable and reachable.

- [ ] **Step 5: Look at it**

Use the `game-driven-qa` skill: start `meadowlight-dev`, open `http://localhost:5173/?new`, load the probe. Walk into town through the real warp, then stand in the square:

```js
__qa.patch((s) => { s.player.tx = 47; s.player.tz = 38; s.player.facing = 1; });
await __qa.key('KeyD');
__qa.patch((s) => { s.player.tx = 20; s.player.tz = 10; s.player.facing = 0; });
__qa.snap()
```

The snap shows the player in `town` at (20, 10). Press `KeyZ` three times and take a screenshot: a narrow two-storey steel-blue workshop with a mustard roof stands between the blacksmith and the carpenter, where the notice board and its hedges were; the sign above the door shows a cog and a claw; a big window sits left of the door, a lantern and a crate of cogs and bolts right of it; nothing pokes onto the cobbles in front. `await __qa.walkTo(20, 7)` and `await __qa.key('KeyW')`: the player turns North at the door and doesn't move, and no toast appears. Set the clock to night (`const s = __qa.state(); __qa.load({ ...s, time: { ...s.time, minuteOfDay: 1260 } })`) and screenshot again: the windows, the door pane and the lantern glow like the shops'. No console errors.

- [ ] **Step 6: The full gate**

Run: `npm run typecheck && npm test && npm run build`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add src/core/types.ts src/world/maps/town.ts src/render/townGeometry.ts src/render/StructureRenderer.ts src/state/intents.ts tests/maps.test.ts tests/scenery.test.ts
git commit -m "Farmclaws part 4a: Sol's parts exchange replaces the town's notice board

The parts exchange (18, 0, 4, 7), door (20, 6), stands on exactly the tiles
of the notice board and its three hedges, so the town blocks the same tiles
and saved towns need no migration; a test pins the blocked set without
reading the structure list. Its geometry lands with it (R3): a narrow
two-storey workshop in the shops' style with a cog-and-claw sign, a big
display window and a crate of parts by the door, inside its rect.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

---

### Task 4: The Neighbours map and the east gate

**Files:**
- Create: `src/world/maps/neighbours.ts`
- Modify: `src/core/types.ts` (`MAP_IDS`, ~line 137; the end of `STRUCTURE_KINDS`, ~line 229)
- Modify: `src/core/hash.ts` (`Salt`, after `MapTown`, ~line 19)
- Modify: `src/world/maps/lookup.ts` (`mapSeed`, ~line 22)
- Modify: `src/world/maps/types.ts` (`MapDefinition`'s `name` and `structures` doc comments, ~lines 48 and 57)
- Modify: `src/world/maps/index.ts` (imports as Task 2 left them, ~lines 6–13; `assertNpcPlacements`' doc comment and end; `assertMapDefinitions`' doc comment and body; `MAPS`, ~line 120; `generateMaps`, ~line 131)
- Modify: `src/world/maps/town.ts` (header comment, line 4; `TOWN_MAP`'s `warps` and `reserved`, ~lines 127–131)
- Modify: `src/people/cast.ts` (`npcSpot`, as Task 2 left it)
- Modify: `src/state/intents.ts` (imports, ~line 33; new constant after `PART_OF_THE_FARM`, ~line 295; `planPickUp`, ~line 322)
- Modify: `src/state/persistence.ts` (`migrateV6toV7`, as Task 1 left it)
- Modify: `tests/testUtils.ts` (imports, ~line 42; `v6Save`, as Task 1 left it)
- Modify (the fourth map and the east gate): `tests/maps.test.ts`, `tests/warps.test.ts` (lines 67–73, 147–148), `tests/scenery.test.ts` (lines 82–85, 196), `tests/determinism.test.ts` (imports, ~line 29; header line 10; `distanceField`, ~lines 83–99; `traveller`, ~line 136; lines 311 and 315), `tests/sections.test.ts` (lines 107, 122)
- Modify (Task 1's and Task 2's files grow): `tests/saveV7.test.ts`, `tests/cast.test.ts`
- Test: `tests/neighboursMap.test.ts` (create)

**Interfaces:**
- Consumes:
  - Task 1: `SAVE_VERSION = 7`, `migrateV6toV7` (builds `let migrated: Obj = { ...save, version: 7, npcs: … }` and adjusts it), `v6Save` (its `// The cast:` block ends `return save;`), `tests/saveV7.test.ts` with `load(save)`, `chatted()` (the player in town at (10, 16), mid-day) and the imports `Direction, NPC_IDS, SAVE_VERSION, type GameState, type NpcId, type NpcTalk`.
  - Task 2: `NpcPlacement`, `MapDefinition.npcs`; `arrivalTiles(defs, id)` and `reachableTiles(world, starts, isClosed): (tx, tz) => boolean` in `src/world/maps/lookup.ts`; `assertNpcPlacements(defs)` in `index.ts` with its `placed: Set<NpcId>`; `npcAt`, `npcSpot` in `src/people/cast.ts`; `placementProblem`'s "Someone's standing there."; `movePlayer` refusing a character's tile; `tests/cast.test.ts` (its imports and `lastText` helper).
  - Task 3: `'partsExchange'` in `STRUCTURE_KINDS` and the parts exchange in the town (no anchor below is one Task 3 changes).
  - Existing code: `createGridSpec`, `rectContains` (`src/world/grid.ts`); `EMPTY_TILE`, `blockedTile`, `createWorld`, `isWalkable`, `requireTile`, `assertWorldObjectsConsistent` (`src/world/tiles.ts`); `precomputeMask`, `precomputeSurfaces`, `findWarp`, `isReservedTile`, `structureAt` (`src/world/maps`); `startNextDay`, `gameReducer`; `planPrimaryAction`; test helpers `BASE`, `atDay`, `count`, `deepEqual`, `holding`, `must`, `reachableFrom`, `tileAt`, `withPlayer`, `withTile`.
- Produces:
  - `src/core/types.ts`: `MAP_IDS = ['farm', 'forest', 'town', 'neighbours'] as const`. `STRUCTURE_KINDS` gains `'cosmoHouse'`, `'barnabyHouse'`, `'chickenCoop'` at the end (R1). `structureParts` (`src/render/townGeometry.ts`) switches over the kind with no default and no exhaustiveness check, so it compiles unchanged and draws nothing for the three new kinds until Task 9 (R7); no `Record<StructureKind, …>` exists, so nothing else needs a value.
  - `src/core/hash.ts`: `Salt.MapNeighbours = 0x4f6cdd1d`; `mapSeed(seed, 'neighbours')` is `hash32(seed, Salt.MapNeighbours)`.
  - `src/world/maps/neighbours.ts`: `NEIGHBOURS_BACK_BAND_DEPTH = 5`; `NEIGHBOURS_LANE` = rect (0, 13, 40, 3); `COSMO_FIELD` = rect (4, 6, 6, 6); `BARNABY_FIELD` = rect (21, 17, 8, 8); `export interface FenceRing { readonly corners: readonly [TileCoord, TileCoord]; readonly gap: TileCoord }`; `COSMO_FENCE` (3, 5)–(10, 12), gap (6, 12); `BARNABY_FENCE` (20, 16)–(29, 25), gap (24, 16); `isFenceTile(tx, tz): boolean`; `assertNeighboursLayout(def: MapDefinition): void`; `NEIGHBOURS_MAP` with the structures, surfaces, warp, reserved tiles, `npcs` (Cosmo (7, 13) South, Barnaby (25, 15) North), `allowsTilling: false`, `wild: null`, `farmstead: null`, `scenery: 'farm'` (R12), `decor: { tuftChance: 0.3, flowerChance: 0.06 }`, `cosmeticOffset: { x: 5003, z: 6011 }`, `name: 'The Neighbours'` (R11). The generated world is identical for every seed: structures → `blockedTile(Blocker.Building)`, fence tiles → one shared frozen `{ ...EMPTY_TILE, object: { kind: 'woodFence' } }`, everything else `EMPTY_TILE`.
  - `assertNeighboursLayout` messages: `Neighbours: back-band tile ({tx}, {tz}) is covered by [{kinds}], not by exactly one house, coop or hedge`, `Neighbours: {kind} stands outside the back band`, `Neighbours: reserved tile ({tx}, {tz}) is not clear`, `Neighbours: the fence gap at ({tx}, {tz}) is blocked`, `Neighbours: the fence has a hole at ({tx}, {tz})`, `Neighbours: ({tx}, {tz}) can't be reached from the gate`.
  - `src/world/maps/town.ts`: a second warp, East from (39, 16) → neighbours (1, 14) facing East; `reserved` gains (39, 16) and (38, 16) (R2).
  - `src/world/maps/index.ts`: `MAPS.neighbours = NEIGHBOURS_MAP`; `generateMaps` adds `neighbours`; `assertMapDefinitions` calls `assertNeighboursLayout(defs.neighbours)`; `assertNpcPlacements` ends with `Character {npc} is placed on no map` over `NPC_IDS` (R4 becomes "exactly one").
  - `src/people/cast.ts`: `npcSpot(npc): { readonly mapId: MapId; readonly placement: NpcPlacement }`, non-null (the startup check now places every character); it throws `Character {npc} is placed on no map` on the impossible path. No production code calls it yet.
  - `src/state/intents.ts`: on the Neighbours map, `planPickUp` refuses an object on a fence tile (`isFenceTile`) with `"That belongs to the neighbours."`, for the pickaxe and the axe alike (R9, narrowed: see the notes).
  - `src/state/persistence.ts`: `migrateV6toV7` also sets `maps.neighbours = MAPS.neighbours.generate(save.seed)` when `save.maps` is an object and `isIntIn(save.seed, 0, 0xffffffff)`; otherwise the save passes through for the validator to reject.
  - `tests/testUtils.ts`: `v6Save` deletes `maps.neighbours`, and throws (message starting `v6Save:`) when the player stands on the Neighbours map or the Neighbours map isn't the freshly generated one.
  - `tests/determinism.test.ts`: the traveller's `distanceField(world, mapId, goal)` skips characters' tiles.
  - `tests/neighboursMap.test.ts` (24 tests); cases added to `tests/maps.test.ts`, `tests/saveV7.test.ts`, `tests/cast.test.ts`.

- [ ] **Step 1: Write the failing test**

Create `tests/neighboursMap.test.ts`:

```ts
/**
 * The Neighbours map (farmclaws part 4a spec §5): Cosmo's and Barnaby's farms east of the town.
 * The definition and its layout (back band, fences and their gaps, dirt fields), both gates
 * walked through with movePlayer, reachability, the startup check's Neighbours rules, the
 * overnight step leaving the map alone, and the neighbours' fences refusing the pickaxe and the
 * axe (plan refinement R9).
 */
import { describe, expect, it } from 'vitest';
import { WORLD } from '../src/config';
import { Blocker, Direction, type GameState, type Tile, type TileCoord, type WorldState } from '../src/core/types';
import { actions } from '../src/state/actions';
import { planPrimaryAction } from '../src/state/intents';
import { gameReducer, startNextDay } from '../src/state/reducer';
import { rectContains } from '../src/world/grid';
import { MAPS, assertMapDefinitions, findWarp, generateMaps, isReservedTile, structureAt, type MapDefinition } from '../src/world/maps';
import {
  BARNABY_FENCE,
  BARNABY_FIELD,
  COSMO_FENCE,
  COSMO_FIELD,
  NEIGHBOURS_BACK_BAND_DEPTH,
  NEIGHBOURS_LANE,
  assertNeighboursLayout,
  isFenceTile,
} from '../src/world/maps/neighbours';
import { EMPTY_TILE, assertWorldObjectsConsistent, blockedTile, countTiles, forEachTile, isWalkable, requireTile, setTile } from '../src/world/tiles';
import { BASE, atDay, count, holding, reachableFrom, tileAt, withPlayer, withTile } from './testUtils';

const SEEDS = [WORLD.seed, 0, 1, 2, 3, 12345, 0x7fffffff, 0xffffffff] as const;

const key = (tx: number, tz: number): string => `${tx},${tz}`;
const r = (x0: number, z0: number, width: number, depth: number) => ({ x0, z0, width, depth });
const lastText = (state: GameState): string | undefined => state.messages.entries.at(-1)?.text;

const def = MAPS.neighbours;
const world = generateMaps(WORLD.seed).neighbours;
const FENCE: Tile = { ...EMPTY_TILE, object: { kind: 'woodFence' } };

/** The ring of tiles with corners (x0, z0) and (x1, z1), written out from the spec's numbers. */
const onRing = (x0: number, z0: number, x1: number, z1: number) => (tx: number, tz: number): boolean =>
  tx >= x0 && tx <= x1 && tz >= z0 && tz <= z1 && (tx === x0 || tx === x1 || tz === z0 || tz === z1);
const cosmoRing = onRing(3, 5, 10, 12);
const barnabyRing = onRing(20, 16, 29, 25);
/** Spec §5.2: each ring is fence except its gate. */
const fenceExpected = (tx: number, tz: number): boolean =>
  (cosmoRing(tx, tz) && !(tx === 6 && tz === 12)) || (barnabyRing(tx, tz) && !(tx === 24 && tz === 16));

const move = (state: GameState, direction: Direction): GameState => gameReducer(state, actions.move(direction));

describe('the Neighbours map', () => {
  it('is a fixed 40 × 28 map without tilling, in the farm style, with one gate back to the town', () => {
    expect(def).toMatchObject({
      id: 'neighbours',
      name: 'The Neighbours',
      allowsTilling: false,
      scenery: 'farm',
      farmstead: null,
      wild: null,
      decor: { tuftChance: 0.3, flowerChance: 0.06 },
      cosmeticOffset: { x: 5003, z: 6011 },
      warps: [{ from: { tx: 0, tz: 14 }, exit: Direction.West, to: { mapId: 'town', tx: 38, tz: 16, facing: Direction.West } }],
      reserved: [
        { tx: 0, tz: 14 },
        { tx: 1, tz: 14 },
      ],
    });
    expect([def.grid.width, def.grid.depth]).toEqual([40, 28]);
    expect([world.grid.width, world.grid.depth]).toEqual([40, 28]);
  });

  it('generates the same world for every seed, and a new game starts with it', () => {
    for (const seed of SEEDS) expect(generateMaps(seed).neighbours, `seed ${seed}`).toEqual(world);
    expect(MAPS.neighbours.generate(1)).toEqual(MAPS.neighbours.generate(2));
    expect(BASE.maps.neighbours).toEqual(world);
  });

  it('places exactly the structures of the spec', () => {
    const hedge = (x0: number, z0: number, width: number, depth: number) => ({ kind: 'hedge', rect: r(x0, z0, width, depth), door: null });
    expect(def.structures).toEqual([
      { kind: 'cosmoHouse', rect: r(3, 0, 6, 5), door: { tx: 5, tz: 4 } },
      { kind: 'chickenCoop', rect: r(11, 0, 4, 5), door: null },
      { kind: 'barnabyHouse', rect: r(24, 0, 6, 5), door: { tx: 26, tz: 4 } },
      hedge(0, 0, 3, 5),
      hedge(9, 0, 2, 5),
      hedge(15, 0, 9, 5),
      hedge(30, 0, 10, 5),
    ]);
  });

  it('covers the back band z 0–4 exactly once with the houses, the coop and hedges, and builds nothing in front of it', () => {
    expect(NEIGHBOURS_BACK_BAND_DEPTH).toBe(5);
    forEachTile(world, (tile, tx, tz) => {
      const covering = def.structures.filter((s) => rectContains(s.rect, tx, tz));
      if (tz <= 4) {
        expect(covering.length, key(tx, tz)).toBe(1);
        expect(['cosmoHouse', 'barnabyHouse', 'chickenCoop', 'hedge']).toContain(covering[0]?.kind);
        expect(tile, key(tx, tz)).toEqual(blockedTile(Blocker.Building));
      } else {
        expect(covering, key(tx, tz)).toEqual([]);
      }
    });
  });

  it('rings both fields with wood fences, open at one gate each', () => {
    expect(COSMO_FENCE).toEqual({ corners: [{ tx: 3, tz: 5 }, { tx: 10, tz: 12 }], gap: { tx: 6, tz: 12 } });
    expect(BARNABY_FENCE).toEqual({ corners: [{ tx: 20, tz: 16 }, { tx: 29, tz: 25 }], gap: { tx: 24, tz: 16 } });
    forEachTile(world, (tile, tx, tz) => {
      expect(isFenceTile(tx, tz), key(tx, tz)).toBe(fenceExpected(tx, tz));
      if (fenceExpected(tx, tz)) expect(tile, key(tx, tz)).toEqual(FENCE);
      else expect(tile.object, key(tx, tz)).toBeNull();
    });
    // 28 ring tiles round Cosmo's 6 × 6 field and 36 round Barnaby's 8 × 8, less a gate each.
    expect(countTiles(world, (tile) => tile.object?.kind === 'woodFence')).toBe(27 + 35);
    for (const gap of [COSMO_FENCE.gap, BARNABY_FENCE.gap]) {
      expect(requireTile(world, gap.tx, gap.tz), key(gap.tx, gap.tz)).toEqual(EMPTY_TILE);
      expect(isWalkable(requireTile(world, gap.tx, gap.tz))).toBe(true);
    }
  });

  it('lays bare dirt (not soil) on the lane and inside both fields, and grass everywhere else', () => {
    expect(NEIGHBOURS_LANE).toEqual(r(0, 13, 40, 3));
    expect(COSMO_FIELD).toEqual(r(4, 6, 6, 6));
    expect(BARNABY_FIELD).toEqual(r(21, 17, 8, 8));
    forEachTile(world, (tile, tx, tz) => {
      const dirt = (tz >= 13 && tz <= 15) || (tx >= 4 && tx <= 9 && tz >= 6 && tz <= 11) || (tx >= 21 && tx <= 28 && tz >= 17 && tz <= 24);
      expect(def.surfaceAt(tx, tz), key(tx, tz)).toBe(dirt ? 'dirt' : 'grass');
      expect(def.isShaded(tx, tz)).toBe(false);
      if (structureAt(def, tx, tz) === null && !fenceExpected(tx, tz)) expect(tile, key(tx, tz)).toEqual(EMPTY_TILE);
    });
  });

  it('passes the world-level placed-object check', () => {
    expect(() => assertWorldObjectsConsistent(world)).not.toThrow();
  });
});

describe('the gates', () => {
  it('reserves the gate and arrival tiles on both sides, and keeps them clear', () => {
    for (const { tx, tz } of [{ tx: 39, tz: 16 }, { tx: 38, tz: 16 }]) {
      expect(isReservedTile(MAPS.town, tx, tz)).toBe(true);
      expect(requireTile(BASE.maps.town, tx, tz)).toEqual(EMPTY_TILE);
      expect(MAPS.town.surfaceAt(tx, tz)).toBe('cobble');
    }
    for (const { tx, tz } of [{ tx: 0, tz: 14 }, { tx: 1, tz: 14 }]) {
      expect(isReservedTile(def, tx, tz)).toBe(true);
      expect(requireTile(world, tx, tz)).toEqual(EMPTY_TILE);
    }
    expect(findWarp(MAPS.town, 39, 16, Direction.East)?.to).toEqual({ mapId: 'neighbours', tx: 1, tz: 14, facing: Direction.East });
    expect(findWarp(def, 0, 14, Direction.West)?.to).toEqual({ mapId: 'town', tx: 38, tz: 16, facing: Direction.West });
    expect(findWarp(def, 0, 13, Direction.West)).toBeNull();
  });

  it('walks east out of the town onto the lane, and back west into the town', () => {
    const start = withPlayer(BASE, { tx: 38, tz: 16 }, Direction.North, 'town');
    const atGate = move(start, Direction.East);
    expect(atGate.player).toMatchObject({ mapId: 'town', tx: 39, tz: 16, facing: Direction.East, moveSeq: 1, teleportSeq: 0 });
    const there = move(atGate, Direction.East);
    expect(there.player).toMatchObject({ mapId: 'neighbours', tx: 1, tz: 14, facing: Direction.East, moveSeq: 1, teleportSeq: 1 });
    const onward = move(there, Direction.East);
    expect(onward.player).toMatchObject({ mapId: 'neighbours', tx: 2, tz: 14, moveSeq: 2, teleportSeq: 1 });
    const edge = move(move(onward, Direction.West), Direction.West);
    expect(edge.player).toMatchObject({ mapId: 'neighbours', tx: 0, tz: 14, facing: Direction.West, moveSeq: 4, teleportSeq: 1 });
    const back = move(edge, Direction.West);
    expect(back.player).toMatchObject({ mapId: 'town', tx: 38, tz: 16, facing: Direction.West, moveSeq: 4, teleportSeq: 2 });
    expect(back.maps).toBe(BASE.maps);
  });

  it('turns the player at every other edge tile of the lane instead of leaving', () => {
    const north = withPlayer(BASE, { tx: 0, tz: 13 }, Direction.North, 'neighbours');
    expect(move(north, Direction.West).player).toEqual({ ...north.player, facing: Direction.West });
    const east = withPlayer(BASE, { tx: 39, tz: 14 }, Direction.North, 'neighbours');
    expect(move(east, Direction.East).player).toEqual({ ...east.player, facing: Direction.East });
  });
});

describe('getting around', () => {
  it('reaches every walkable tile from the gate, the fields through their gaps', () => {
    const reach = reachableFrom(world, { tx: 1, tz: 14 });
    forEachTile(world, (tile, tx, tz) => {
      expect(reach.has(key(tx, tz)), key(tx, tz)).toBe(isWalkable(tile));
    });
    for (const inside of [{ tx: 7, tz: 8 }, { tx: 25, tz: 20 }]) expect(reach.has(key(inside.tx, inside.tz))).toBe(true);
  });

  it('closes each field but for its gap', () => {
    const shut = (gap: TileCoord, inside: TileCoord): void => {
      const closed = setTile(world, gap.tx, gap.tz, FENCE);
      const reach = reachableFrom(closed, { tx: 1, tz: 14 });
      expect(reach.has(key(inside.tx, inside.tz))).toBe(false);
    };
    shut(COSMO_FENCE.gap, { tx: 7, tz: 8 });
    shut(BARNABY_FENCE.gap, { tx: 25, tz: 20 });
  });
});

describe('the startup check on the Neighbours map', () => {
  const gen = (): WorldState => def.generate(0);
  const broken: readonly (readonly [string, MapDefinition, string])[] = [
    [
      'a back band with a gap',
      { ...def, structures: def.structures.filter((s) => s.kind !== 'chickenCoop') },
      'Neighbours: back-band tile (11, 0) is covered by [], not by exactly one house, coop or hedge',
    ],
    [
      'a back-band tile covered twice',
      { ...def, structures: [...def.structures, { kind: 'hedge', rect: r(11, 0, 1, 1), door: null }] },
      'Neighbours: back-band tile (11, 0) is covered by [chickenCoop, hedge], not by exactly one house, coop or hedge',
    ],
    [
      'a structure in the back band that has no business there',
      { ...def, structures: def.structures.map((s) => (s.rect.x0 === 9 ? { ...s, kind: 'well' as const } : s)) },
      'Neighbours: back-band tile (9, 0) is covered by [well], not by exactly one house, coop or hedge',
    ],
    [
      'a structure in front of the back band',
      { ...def, structures: [...def.structures, { kind: 'lampPost', rect: r(15, 8, 1, 1), door: null }] },
      'Neighbours: lampPost stands outside the back band',
    ],
    ['a hole in a fence', { ...def, generate: () => setTile(gen(), 3, 8, EMPTY_TILE) }, 'Neighbours: the fence has a hole at (3, 8)'],
    ['a fenced-off gap', { ...def, generate: () => setTile(gen(), 24, 16, FENCE) }, 'Neighbours: the fence gap at (24, 16) is blocked'],
    ['a fenced-off arrival tile', { ...def, generate: () => setTile(gen(), 1, 14, FENCE) }, 'Neighbours: reserved tile (1, 14) is not clear'],
    [
      'a walkable corner nobody can reach',
      { ...def, generate: () => setTile(setTile(gen(), 38, 27, FENCE), 39, 26, FENCE) },
      "Neighbours: (39, 27) can't be reached from the gate",
    ],
  ];

  it('accepts the shipped definition', () => {
    expect(() => assertNeighboursLayout(def)).not.toThrow();
    expect(() => assertMapDefinitions(MAPS)).not.toThrow();
  });

  it.each(broken)('throws on %s', (_name, broken, message) => {
    expect(() => assertNeighboursLayout(broken)).toThrow(new RangeError(message));
    // The whole startup check fails too (two overlapping structures trip assertStructures first).
    expect(() => assertMapDefinitions({ ...MAPS, neighbours: broken })).toThrow(RangeError);
  });
});

describe('overnight', () => {
  it('leaves the map exactly as it was, night after night, rain or shine and across a season', () => {
    let state = withPlayer(atDay(BASE, 20), { tx: 1, tz: 14 }, Direction.East, 'neighbours');
    const map = state.maps.neighbours;
    state = gameReducer(state, actions.sleep());
    expect(state.player.mapId).toBe('farm');
    expect(state.maps.neighbours).toBe(map);
    for (let night = 0; night < 30; night++) {
      state = startNextDay(state, false);
      expect(state.maps.neighbours, `night ${night}`).toBe(map);
    }
  });
});

describe("the neighbours' fences", () => {
  // Standing on the lane, facing Cosmo's fence just west of his gate.
  const atFence = withPlayer(BASE, { tx: 5, tz: 13 }, Direction.North, 'neighbours');
  const FENCE_AT = { tx: 5, tz: 12 };

  it('refuse the pickaxe and the axe with "That belongs to the neighbours."', () => {
    for (const tool of ['pickaxe', 'axe'] as const) {
      const holdingTool = holding(atFence, tool);
      expect(planPrimaryAction(holdingTool).intent).toEqual({ kind: 'blocked', reason: 'That belongs to the neighbours.' });
      const next = gameReducer(holdingTool, actions.useTool());
      expect(lastText(next)).toBe('That belongs to the neighbours.');
      expect(tileAt(next, FENCE_AT, 'neighbours')).toBe(tileAt(atFence, FENCE_AT, 'neighbours'));
      expect(count(next, 'woodFence')).toBe(count(atFence, 'woodFence'));
    }
  });

  it("let the axe lift a fence the player put down off the neighbours' rings", () => {
    const own = withTile(withPlayer(BASE, { tx: 15, tz: 8 }, Direction.North, 'neighbours'), { tx: 15, tz: 7 }, FENCE, 'neighbours');
    expect(planPrimaryAction(holding(own, 'axe')).intent).toEqual({ kind: 'pickUp', itemId: 'woodFence' });
  });
});
```

Notes on the fixtures (all checked against the layout):
- (5, 13) is lane, west of Cosmo's gate (6, 12) and two tiles from Cosmo at (7, 13); facing North it targets the fence at (5, 12). (15, 8) and (15, 7) are open grass north of the lane, outside both rings.
- The "walkable corner" case fences (38, 27) and (39, 26), which cuts the corner tile (39, 27) off; every other broken case touches one rule only. The "covered twice" case also overlaps the coop, so `assertMapDefinitions` fails first in `assertStructures` ("chickenCoop overlaps hedge"), which is why its second expectation checks only for a `RangeError`.
- The overnight test starts on day 20 and runs 31 nights, so it crosses the day-28 season change and meets rain.

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run tests/neighboursMap.test.ts`
Expected: FAIL. The file can't load: `Failed to resolve import "../src/world/maps/neighbours" from "tests/neighboursMap.test.ts"` (the module doesn't exist yet), so no test runs.

- [ ] **Step 3: Implement**

**3a. `src/core/types.ts`.** Replace:

```ts
export const MAP_IDS = ['farm', 'forest', 'town'] as const;
```

with:

```ts
export const MAP_IDS = ['farm', 'forest', 'town', 'neighbours'] as const;
```

At the end of `STRUCTURE_KINDS` (Task 3 swapped `'noticeBoard'` for `'partsExchange'` higher up), replace:

```ts
  'lampPost',
  'hedge',
] as const;
```

with:

```ts
  'lampPost',
  'hedge',
  'cosmoHouse',
  'barnabyHouse',
  'chickenCoop',
] as const;
```

Structures are map data, not saved, so the new kinds need no migration (R1).

**3b. `src/core/hash.ts`.** Replace:

```ts
  MapTown: 0xb5297a4d,
```

with:

```ts
  MapTown: 0xb5297a4d,
  MapNeighbours: 0x4f6cdd1d,
```

**3c. `src/world/maps/lookup.ts`.** In `mapSeed`, replace:

```ts
    case 'town':
      return hash32(seed, Salt.MapTown);
```

with:

```ts
    case 'town':
      return hash32(seed, Salt.MapTown);
    case 'neighbours':
      return hash32(seed, Salt.MapNeighbours);
```

(The switch is exhaustive over `MapId` with no default, so without this case `noImplicitReturns` fails the typecheck. The Neighbours generator never rolls a hash; the seed exists for the overnight `DayContext`, which every map gets.)

**3d. `src/world/maps/neighbours.ts`.** Create:

```ts
/**
 * The Neighbours (40 × 28): Cosmo's and Barnaby's farms, east of the town (farmclaws part 4a
 * spec §5). Pure data, identical for every seed: two farmhouses and a chicken coop along the
 * back (−Z) edge behind a hedge line, a dirt lane from the west gate, and two fenced fields of
 * bare dirt, Cosmo's north of the lane and Barnaby's south of it.
 *
 * Occlusion rule, as in the town: the camera looks from +X/+Z, so anything tall hides the tiles
 * on its −X/−Z side. The houses and the coop therefore stand against the back edge, and every
 * other back-band tile (z 0–4) is hedge. Out in the open there are only the low wood fences.
 */
import { WORLD } from '../../config';
import { Blocker, Direction, type StructureKind, type Tile, type TileCoord, type TileRect, type WorldState } from '../../core/types';
import { createGridSpec, rectContains } from '../grid';
import { EMPTY_TILE, blockedTile, createWorld, isWalkable, requireTile } from '../tiles';
import { precomputeMask, precomputeSurfaces, reachableTiles } from './lookup';
import type { MapDefinition, StructurePlacement, Surface } from './types';

const grid = createGridSpec(40, 28, WORLD.chunkSize, WORLD.tileSize);

/** Rows z 0 … NEIGHBOURS_BACK_BAND_DEPTH − 1 are houses, the coop and hedges, wall to wall. */
export const NEIGHBOURS_BACK_BAND_DEPTH = 5;

/** Where the town's east gate arrives: one tile inside the west edge, on the lane. */
const ARRIVAL: TileCoord = { tx: 1, tz: 14 };

const rect = (x0: number, z0: number, width: number, depth: number): TileRect => ({ x0, z0, width, depth });
const hedge = (x0: number, z0: number, width: number, depth: number): StructurePlacement => ({
  kind: 'hedge',
  rect: rect(x0, z0, width, depth),
  door: null,
});

const structures: readonly StructurePlacement[] = [
  { kind: 'cosmoHouse', rect: rect(3, 0, 6, 5), door: { tx: 5, tz: 4 } },
  { kind: 'chickenCoop', rect: rect(11, 0, 4, 5), door: null },
  { kind: 'barnabyHouse', rect: rect(24, 0, 6, 5), door: { tx: 26, tz: 4 } },
  hedge(0, 0, 3, 5),
  hedge(9, 0, 2, 5),
  hedge(15, 0, 9, 5),
  hedge(30, 0, 10, 5),
];

/** The kinds that may stand in the back band; nothing else is tall enough to need it, and nothing stands outside it. */
const BACK_BAND_KINDS: readonly StructureKind[] = ['cosmoHouse', 'barnabyHouse', 'chickenCoop', 'hedge'];

/** The dirt lane, z 13–15 across the whole width: the west gate's road. */
export const NEIGHBOURS_LANE = rect(0, 13, 40, 3);
/** Inside Cosmo's fence, x 4–9, z 6–11: bare dirt. */
export const COSMO_FIELD = rect(4, 6, 6, 6);
/** Inside Barnaby's fence, x 21–28, z 17–24: bare dirt. */
export const BARNABY_FIELD = rect(21, 17, 8, 8);

/** A rectangular ring of wood fence round a field, open at one tile. */
export interface FenceRing {
  /** The ring's north-west and south-east corner tiles. */
  readonly corners: readonly [TileCoord, TileCoord];
  /** The one ring tile left open as the field's gate. */
  readonly gap: TileCoord;
}

/** Round Cosmo's field, open on the lane side at (6, 12). */
export const COSMO_FENCE: FenceRing = { corners: [{ tx: 3, tz: 5 }, { tx: 10, tz: 12 }], gap: { tx: 6, tz: 12 } };
/** Round Barnaby's field, open on the lane side at (24, 16). */
export const BARNABY_FENCE: FenceRing = { corners: [{ tx: 20, tz: 16 }, { tx: 29, tz: 25 }], gap: { tx: 24, tz: 16 } };

const FENCES: readonly FenceRing[] = [COSMO_FENCE, BARNABY_FENCE];

/** Is (tx, tz) on the ring of `fence` (its gap included)? */
function onRing(fence: FenceRing, tx: number, tz: number): boolean {
  const [nw, se] = fence.corners;
  if (tx < nw.tx || tx > se.tx || tz < nw.tz || tz > se.tz) return false;
  return tx === nw.tx || tx === se.tx || tz === nw.tz || tz === se.tz;
}

/** A wood-fence tile: on either field's ring, except its gap. */
export function isFenceTile(tx: number, tz: number): boolean {
  return FENCES.some((fence) => onRing(fence, tx, tz) && !(tx === fence.gap.tx && tz === fence.gap.tz));
}

function neighboursSurface(tx: number, tz: number): Surface {
  const dirt = [NEIGHBOURS_LANE, COSMO_FIELD, BARNABY_FIELD].some((area) => rectContains(area, tx, tz));
  return dirt ? 'dirt' : 'grass';
}

/**
 * The Neighbours' own layout rules, checked by `assertMapDefinitions`: the houses, the coop and
 * the hedges cover the back band exactly once, and no structure stands outside it; every reserved
 * tile is clear; both fence rings are whole except their gaps, and the gaps are walkable; every
 * walkable tile is reachable from the arrival tile. The tiles are those of `def.generate(0)`, the
 * same for every seed.
 */
export function assertNeighboursLayout(def: MapDefinition): void {
  const { width, depth } = def.grid;
  for (let tz = 0; tz < NEIGHBOURS_BACK_BAND_DEPTH; tz++) {
    for (let tx = 0; tx < width; tx++) {
      const covering = def.structures.filter((s) => rectContains(s.rect, tx, tz));
      const only = covering.length === 1 ? covering[0] : undefined;
      if (only === undefined || !BACK_BAND_KINDS.includes(only.kind)) {
        const kinds = covering.map((s) => s.kind).join(', ');
        throw new RangeError(`Neighbours: back-band tile (${tx}, ${tz}) is covered by [${kinds}], not by exactly one house, coop or hedge`);
      }
    }
  }
  for (const s of def.structures) {
    if (s.rect.z0 + s.rect.depth > NEIGHBOURS_BACK_BAND_DEPTH) throw new RangeError(`Neighbours: ${s.kind} stands outside the back band`);
  }
  const world = def.generate(0);
  for (const r of def.reserved) {
    if (!isWalkable(requireTile(world, r.tx, r.tz))) throw new RangeError(`Neighbours: reserved tile (${r.tx}, ${r.tz}) is not clear`);
  }
  for (const fence of FENCES) {
    const [nw, se] = fence.corners;
    for (let tz = nw.tz; tz <= se.tz; tz++) {
      for (let tx = nw.tx; tx <= se.tx; tx++) {
        if (!onRing(fence, tx, tz)) continue;
        const tile = requireTile(world, tx, tz);
        if (tx === fence.gap.tx && tz === fence.gap.tz) {
          if (!isWalkable(tile)) throw new RangeError(`Neighbours: the fence gap at (${tx}, ${tz}) is blocked`);
        } else if (tile.object?.kind !== 'woodFence') {
          throw new RangeError(`Neighbours: the fence has a hole at (${tx}, ${tz})`);
        }
      }
    }
  }
  const reachable = reachableTiles(world, [ARRIVAL], () => false);
  for (let tz = 0; tz < depth; tz++) {
    for (let tx = 0; tx < width; tx++) {
      if (isWalkable(requireTile(world, tx, tz)) && !reachable(tx, tz)) {
        throw new RangeError(`Neighbours: (${tx}, ${tz}) can't be reached from the gate`);
      }
    }
  }
}

const structureMask = precomputeMask(grid, (tx, tz) => structures.some((s) => rectContains(s.rect, tx, tz)));
const fenceMask = precomputeMask(grid, isFenceTile);

/** Every fence tile is this one: tiles are immutable, so they can share it. */
const FENCE_TILE: Tile = Object.freeze({ ...EMPTY_TILE, object: Object.freeze({ kind: 'woodFence' }) });

/** Structures, then fences, then empty ground (grass or dirt by surface). No hash: the same for every seed. */
function generateNeighbours(): WorldState {
  return createWorld(grid, (tx, tz) => {
    if (structureMask(tx, tz)) return blockedTile(Blocker.Building);
    if (fenceMask(tx, tz)) return FENCE_TILE;
    return EMPTY_TILE;
  });
}

export const NEIGHBOURS_MAP: MapDefinition = {
  id: 'neighbours',
  name: 'The Neighbours',
  grid,
  allowsTilling: false,
  warps: [{ from: { tx: 0, tz: 14 }, exit: Direction.West, to: { mapId: 'town', tx: 38, tz: 16, facing: Direction.West } }],
  reserved: [{ tx: 0, tz: 14 }, ARRIVAL],
  structures,
  npcs: [
    { id: 'cosmo', tx: 7, tz: 13, facing: Direction.South },
    { id: 'barnaby', tx: 25, tz: 15, facing: Direction.North },
  ],
  wild: null,
  farmstead: null,
  scenery: 'farm',
  decor: { tuftChance: 0.3, flowerChance: 0.06 },
  cosmeticOffset: { x: 5003, z: 6011 },
  isShaded: precomputeMask(grid, () => false),
  surfaceAt: precomputeSurfaces(grid, neighboursSurface),
  generate: () => generateNeighbours(),
};
```

Why each piece looks as it does:
- `FENCE_TILE` is one frozen tile, like `EMPTY_TILE`: `setTile` replaces references, so sharing is safe, and `Object.freeze` keeps the literal `'woodFence'` kind (the file typechecks as written).
- `assertNeighboursLayout` walks with Task 2's `reachableTiles` from `lookup.ts` (this module can't import `index.ts`, which imports it). Characters aren't closed here: the "reachable" rule is about the map's own tiles, and Cosmo and Barnaby stand on a three-tile-wide lane, which they can't cut. Their spots are checked by `assertNpcPlacements` as on any map.
- A wood fence is a placed object on an `EMPTY_TILE`, so `assertTileConsistent` and `assertWorldObjectsConsistent` accept it (the latter only checks giant crops), and `isWalkable` is false for it.
- The overnight step leaves the map alone: `runSprinklers` finds no sprinkler, `advanceTileOvernight` returns every `Unplowed` and `Blocked` tile as it is, and `spreadWildCrops` stops at `wild: null`; so `startNextDay` keeps `maps.neighbours`' reference (pinned in the test).
- Cosmo's door (5, 4) opens onto (5, 5), which is the top row of his own fence ring. The town's "a walkable tile in front of every door" rule is in `assertTownLayout` and is town-only; this map doesn't apply it. Task 2's character rule (not on a door or the tile in front of one) still holds for both characters.

**3e. `src/world/maps/types.ts`.** In `MapDefinition`, replace:

```ts
  /** 'Meadowlight Farm' | 'Mossy Woods' | 'Brookhollow' */
```

with:

```ts
  /** 'Meadowlight Farm' | 'Mossy Woods' | 'Brookhollow' | 'The Neighbours' */
```

and replace:

```ts
  /** Blocker.Building footprints (town). */
```

with:

```ts
  /** Blocker.Building footprints (the town and the Neighbours). */
```

**3f. `src/world/maps/index.ts`.** In the imports (as Task 2 left them), replace:

```ts
import { DIRECTIONS, MAP_IDS, type MapId, type NpcId, type TileRect, type WorldState } from '../../core/types';
```

with:

```ts
import { DIRECTIONS, MAP_IDS, NPC_IDS, type MapId, type NpcId, type TileRect, type WorldState } from '../../core/types';
```

and replace:

```ts
import { arrivalTiles, coordIn, reachableTiles } from './lookup';
```

with:

```ts
import { arrivalTiles, coordIn, reachableTiles } from './lookup';
import { NEIGHBOURS_MAP, assertNeighboursLayout } from './neighbours';
```

In `assertNpcPlacements`' doc comment (Task 2's), replace:

```ts
 * every seed, so the world from seed 0 is the one walked, generated once per map. A character
 * stands on at most one map.
 */
```

with:

```ts
 * every seed, so the world from seed 0 is the one walked, generated once per map. Every
 * character stands on exactly one map.
 */
```

At the end of `assertNpcPlacements`, replace:

```ts
      if (placed.has(p.id)) throw new RangeError(`Character ${p.id} is placed more than once`);
      placed.add(p.id);
    });
  }
}
```

with:

```ts
      if (placed.has(p.id)) throw new RangeError(`Character ${p.id} is placed more than once`);
      placed.add(p.id);
    });
  }
  for (const npc of NPC_IDS) {
    if (!placed.has(npc)) throw new RangeError(`Character ${npc} is placed on no map`);
  }
}
```

In `assertMapDefinitions`' doc comment (as Task 2 left it), replace:

```ts
 * clear, the town's own layout rules (`assertTownLayout`), and a character's spot that breaks
 * a rule of `assertNpcPlacements`.
 */
```

with:

```ts
 * clear, the town's and the Neighbours' own layout rules (`assertTownLayout`,
 * `assertNeighboursLayout`), and a character's spot that breaks a rule of `assertNpcPlacements`.
 */
```

In `assertMapDefinitions`' body, replace:

```ts
  assertTownLayout(defs.town);
}
```

with:

```ts
  assertTownLayout(defs.town);
  assertNeighboursLayout(defs.neighbours);
}
```

Replace:

```ts
export const MAPS: Readonly<Record<MapId, MapDefinition>> = { farm: FARM_MAP, forest: FOREST_MAP, town: TOWN_MAP };
```

with:

```ts
export const MAPS: Readonly<Record<MapId, MapDefinition>> = {
  farm: FARM_MAP,
  forest: FOREST_MAP,
  town: TOWN_MAP,
  neighbours: NEIGHBOURS_MAP,
};
```

and in `generateMaps`, replace:

```ts
  return { farm: MAPS.farm.generate(seed), forest: MAPS.forest.generate(seed), town: MAPS.town.generate(seed) };
```

with:

```ts
  return {
    farm: MAPS.farm.generate(seed),
    forest: MAPS.forest.generate(seed),
    town: MAPS.town.generate(seed),
    neighbours: MAPS.neighbours.generate(seed),
  };
```

(`MAX_MAP_TILE_COUNT` stays the farm's 48 × 40; the Neighbours map is 40 × 28. Module-load cost: one more 40 × 28 generation for the layout check and one for `assertNpcPlacements`.)

**3g. `src/world/maps/town.ts`.** In the header comment, replace:

```ts
 * street from the west gate, and a river along the south with a promenade in front of it.
```

with:

```ts
 * street from the west gate to the east gate, and a river along the south with a promenade in
 * front of it.
```

In `TOWN_MAP`, replace:

```ts
  warps: [{ from: { tx: 0, tz: 16 }, exit: Direction.West, to: { mapId: 'farm', tx: 46, tz: 38, facing: Direction.West } }],
  reserved: [
    { tx: 0, tz: 16 },
    { tx: 1, tz: 16 },
  ],
```

with:

```ts
  warps: [
    { from: { tx: 0, tz: 16 }, exit: Direction.West, to: { mapId: 'farm', tx: 46, tz: 38, facing: Direction.West } },
    { from: { tx: 39, tz: 16 }, exit: Direction.East, to: { mapId: 'neighbours', tx: 1, tz: 14, facing: Direction.East } },
  ],
  reserved: [
    { tx: 0, tz: 16 },
    { tx: 1, tz: 16 },
    { tx: 39, tz: 16 },
    { tx: 38, tz: 16 },
  ],
```

(39, 16) and (38, 16) are cobbled main street: no structure covers them (the nearest, the lamp post at (36, 14) and the hedge at x 38–39, z 0–6, are clear) and the river ends at x 36, z 24. The west warp stays first, so the tests that patch `MAPS.town.warps[0]` still patch the farm gate.

**3h. `src/people/cast.ts`.** Replace Task 2's `npcSpot`:

```ts
/** Where `npc` stands, or null when no map places them. */
export function npcSpot(npc: NpcId): { readonly mapId: MapId; readonly placement: NpcPlacement } | null {
  for (const def of Object.values(MAPS)) {
    const placement = def.npcs.find((p) => p.id === npc);
    if (placement !== undefined) return { mapId: def.id, placement };
  }
  return null;
}
```

with:

```ts
/** Where `npc` stands. The startup check places every character on exactly one map. */
export function npcSpot(npc: NpcId): { readonly mapId: MapId; readonly placement: NpcPlacement } {
  for (const def of Object.values(MAPS)) {
    const placement = def.npcs.find((p) => p.id === npc);
    if (placement !== undefined) return { mapId: def.id, placement };
  }
  throw new RangeError(`Character ${npc} is placed on no map`);
}
```

(Only `tests/cast.test.ts` calls it; its `toEqual` checks are unaffected.)

**3i. `src/state/intents.ts`.** Replace:

```ts
import { isReservedTile, mapSeed } from '../world/maps';
```

with:

```ts
import { isReservedTile, mapSeed } from '../world/maps';
import { isFenceTile } from '../world/maps/neighbours';
```

Replace:

```ts
/** The empty workbench's hint and toast (part 3 spec §2.2). */
```

with:

```ts
/** The pickaxe's and the axe's answer at the neighbours' fences (part 4a plan refinement R9). */
const THE_NEIGHBOURS = 'That belongs to the neighbours.';

/** The empty workbench's hint and toast (part 3 spec §2.2). */
```

In `planPickUp`, replace:

```ts
  if (object.kind === 'workbench') return blocked(target, tool, PART_OF_THE_FARM);
```

with:

```ts
  if (object.kind === 'workbench') return blocked(target, tool, PART_OF_THE_FARM);
  if (state.player.mapId === 'neighbours' && isFenceTile(target.tx, target.tz)) return blocked(target, tool, THE_NEIGHBOURS);
```

The check comes before the tool match, so the pickaxe (which never lifts a fence) gets the same answer as the axe. Only the rings' tiles are the neighbours': a player's own chest, path or fence put down elsewhere on the map comes back up as anywhere else. (`neighbours.ts` imports nothing from `src/state`, so this adds no cycle.)

**3j. `src/state/persistence.ts`.** In `migrateV6toV7`'s doc comment (Task 1's), replace:

```ts
 * target naming Fennick or Pip. `npcs` may already have the v7 shape, because migrateV2toV3 fills
 * it from the current defaults.
 */
```

with:

```ts
 * target naming Fennick or Pip. `npcs` may already have the v7 shape, because migrateV2toV3 fills
 * it from the current defaults. The Neighbours map is generated from its fixed definition.
 */
```

and in its body replace:

```ts
  if (isObj(festival) && isOneOf(festival.giftTarget, REMOVED_NPCS)) migrated = { ...migrated, festival: { ...festival, giftTarget: null } };
  return migrated;
```

with:

```ts
  if (isObj(festival) && isOneOf(festival.giftTarget, REMOVED_NPCS)) migrated = { ...migrated, festival: { ...festival, giftTarget: null } };
  if (isObj(save.maps) && isIntIn(save.seed, 0, 0xffffffff)) {
    migrated = { ...migrated, maps: { ...save.maps, neighbours: MAPS.neighbours.generate(save.seed) } };
  }
  return migrated;
```

(`MAPS`, `isObj` and `isIntIn` are already imported. The town tiles a v6 save holds are kept as they are; only the town's definition gained a warp. A v2 or v1 save reaches this step with the three maps `migrateV2toV3` made, so it gains the Neighbours here too, and the spread keeps `MAP_IDS` key order.)

- [ ] **Step 4: The test helper `v6Save`**

In `tests/testUtils.ts`, replace:

```ts
import { withMap } from '../src/state/selectors';
```

with:

```ts
import { withMap } from '../src/state/selectors';
import { MAPS } from '../src/world/maps';
```

In `v6Save` (as Task 1 left it), replace:

```ts
    fennick: relation(idle),
    pip: relation(idle),
  };
  return save;
}
```

with:

```ts
    fennick: relation(idle),
    pip: relation(idle),
  };
  // The Neighbours map: version 6 has none, so the player can't be on it and it must be as a new game makes it.
  if (state.player.mapId === 'neighbours') throw new Error('v6Save: a version-6 save has no Neighbours map to stand on');
  if (!deepEqual(state.maps.neighbours, MAPS.neighbours.generate(state.seed))) {
    throw new Error('v6Save: a version-6 save has no Neighbours map to have changed');
  }
  delete (save.maps as SaveJson).neighbours;
  return save;
}
```

`v5Save` and `legacySave` start from `v6Save`, so every older-save builder drops the map too, and the migrations put it back. (`deepEqual` is defined higher up in the same file.)

- [ ] **Step 5: The cast, the save and the map tests grow**

**5a. `tests/cast.test.ts`** (Task 2's). In its imports, replace:

```ts
import { DIRECTIONS, Direction, NPC_IDS, type GameState, type MapId, type NpcId } from '../src/core/types';
```

with:

```ts
import { DIRECTIONS, Direction, MAP_IDS, NPC_IDS, type GameState, type MapId, type NpcId } from '../src/core/types';
```

and append at the end of the file:

```ts

/** Cosmo and Barnaby, as spec §2.1 places them on the Neighbours map. */
const NEIGHBOURS_SPOTS: readonly NpcPlacement[] = [
  { id: 'cosmo', tx: 7, tz: 13, facing: Direction.South },
  { id: 'barnaby', tx: 25, tz: 15, facing: Direction.North },
];

describe('the Neighbours cast', () => {
  it('stands Cosmo and Barnaby on the lane by their fields, facing it', () => {
    expect(MAPS.neighbours.npcs).toEqual(NEIGHBOURS_SPOTS);
    for (const spot of NEIGHBOURS_SPOTS) {
      expect(npcAt('neighbours', spot.tx, spot.tz)).toBe(spot.id);
      expect(npcSpot(spot.id)).toEqual({ mapId: 'neighbours', placement: spot });
    }
    expect(npcAt('neighbours', 6, 13)).toBeNull();
    expect(npcAt('town', 7, 13)).toBeNull();
    expect(arrivalTiles(MAPS, 'neighbours')).toEqual([{ tx: 1, tz: 14 }]);
    expect(arrivalTiles(MAPS, 'town')).toEqual([
      { tx: 1, tz: 16 },
      { tx: 38, tz: 16 },
    ]);
  });

  it('places every character on exactly one map', () => {
    for (const id of NPC_IDS) {
      const maps = MAP_IDS.filter((mapId) => MAPS[mapId].npcs.some((p) => p.id === id));
      expect(maps, id).toEqual([npcSpot(id).mapId]);
    }
  });

  it('throws on a character placed on no map, naming them', () => {
    const defs: Record<MapId, MapDefinition> = {
      ...MAPS,
      neighbours: { ...MAPS.neighbours, npcs: MAPS.neighbours.npcs.filter((p) => p.id !== 'barnaby') },
    };
    expect(() => assertMapDefinitions(defs)).toThrow(new RangeError('Character barnaby is placed on no map'));
  });

  it("blocks walking into Cosmo and placing a chest on Barnaby's tile", () => {
    const beside = withPlayer(BASE, { tx: 6, tz: 13 }, Direction.West, 'neighbours');
    expect(gameReducer(beside, actions.move(Direction.East)).player).toEqual({ ...beside.player, facing: Direction.East });
    const facingBarnaby = holding(withPlayer(BASE, { tx: 25, tz: 14 }, Direction.South, 'neighbours'), 'chest');
    expect(placementProblem(facingBarnaby, 'chest', { tx: 25, tz: 15 })).toBe("Someone's standing there.");
    expect(lastText(gameReducer(facingBarnaby, actions.useTool()))).toBe("Someone's standing there.");
  });
});
```

(Every other name it uses — `NpcPlacement`, `MAPS`, `MapDefinition`, `assertMapDefinitions`, `arrivalTiles`, `npcAt`, `npcSpot`, `placementProblem`, `gameReducer`, `actions`, `holding`, `withPlayer`, `BASE`, `lastText` — Task 2's file already imports or defines.)

**5b. `tests/saveV7.test.ts`** (Task 1's). In its imports, replace:

```ts
import { Direction, NPC_IDS, SAVE_VERSION, type GameState, type NpcId, type NpcTalk } from '../src/core/types';
```

with:

```ts
import { Direction, MAP_IDS, NPC_IDS, SAVE_VERSION, type GameState, type NpcId, type NpcTalk } from '../src/core/types';
```

replace:

```ts
import { hasExactKeys, isObj } from '../src/state/validation';
```

with:

```ts
import { hasExactKeys, isObj } from '../src/state/validation';
import { MAPS } from '../src/world/maps';
import { EMPTY_TILE } from '../src/world/tiles';
```

and replace:

```ts
import { BASE, atDay, livelySections, must, v6Save, withPlayer, type SaveJson } from './testUtils';
```

with:

```ts
import { BASE, atDay, livelySections, must, v6Save, withPlayer, withTile, type SaveJson } from './testUtils';
```

Then append at the end of the file:

```ts

describe('the Neighbours map in saves', () => {
  const onTheLane = (): GameState => withPlayer(BASE, { tx: 1, tz: 14 }, Direction.East, 'neighbours');

  it('round-trips a game standing on the Neighbours map', () => {
    const state = onTheLane();
    expect(must(deserializeGame(serializeGame(state)))).toEqual(state);
  });

  it('adds the Neighbours map to a v6 save made in town, and leaves the player in town', () => {
    const state = chatted();
    const save = v6Save(state);
    expect(Object.keys(save.maps as SaveJson)).toEqual(['farm', 'forest', 'town']);
    expect(Object.keys((migrateSave(save) as SaveJson).maps as SaveJson)).toEqual([...MAP_IDS]);
    const loaded = must(load(save));
    expect(loaded.maps.neighbours).toEqual(MAPS.neighbours.generate(state.seed));
    expect(loaded.maps.town).toEqual(state.maps.town);
    expect(loaded.player).toEqual(state.player);
  });

  it('leaves a v6 save with a malformed seed without the map, for the validator to reject', () => {
    const save = { ...v6Save(BASE), seed: -1 };
    expect('neighbours' in ((migrateSave(save) as SaveJson).maps as SaveJson)).toBe(false);
    expect(load(save)).toBeNull();
  });

  it('v6Save refuses a player on the Neighbours map, or a Neighbours map that changed', () => {
    expect(() => v6Save(onTheLane())).toThrow('v6Save');
    const changed = withTile(BASE, { tx: 15, tz: 8 }, { ...EMPTY_TILE, object: { kind: 'woodPath' } }, 'neighbours');
    expect(() => v6Save(changed)).toThrow('v6Save');
  });

  it('rejects a Neighbours map that is missing, the wrong size or another map, and a player standing on a fence', () => {
    const save = JSON.parse(serializeGame(onTheLane())) as SaveJson;
    const maps = (copy: SaveJson): SaveJson => copy.maps as SaveJson;
    const corrupt = (edit: (copy: SaveJson) => void): SaveJson => {
      const copy = JSON.parse(JSON.stringify(save)) as SaveJson;
      edit(copy);
      return copy;
    };
    expect(load(save)).not.toBeNull();
    const broken = [
      corrupt((c) => {
        delete maps(c).neighbours;
      }),
      corrupt((c) => {
        (maps(c).neighbours as { grid: SaveJson }).grid.width = 48;
      }),
      corrupt((c) => {
        maps(c).neighbours = maps(c).town;
      }),
      corrupt((c) => {
        Object.assign(c.player as SaveJson, { tx: 3, tz: 8 });
      }),
    ];
    for (const bad of broken) {
      expect(isValidGameState(bad)).toBe(false);
      expect(load(bad)).toBeNull();
    }
  });
});
```

(Review Focus 1's map half: `chatted()` is Task 1's v6 save made mid-day in town; it loads with `maps.neighbours` the fixed map and the player still in town. (3, 8) is on Cosmo's fence, so a player there isn't on a walkable tile.)

**5c. `tests/maps.test.ts`** (as Tasks 1–3 left it; none of these anchors is one they change). In the header comment, replace:

```ts
 * The three maps (src/world/maps/): the static definitions and their module-load validation,
```

with:

```ts
 * The four maps (src/world/maps/): the static definitions and their module-load validation,
```

In "sets up the forest and the town", replace:

```ts
      warps: [{ from: { tx: 0, tz: 16 }, exit: Direction.West, to: { mapId: 'farm', tx: 46, tz: 38, facing: Direction.West } }],
      reserved: [
        { tx: 0, tz: 16 },
        { tx: 1, tz: 16 },
      ],
    });
    expect([MAPS.town.grid.width, MAPS.town.grid.depth]).toEqual([40, 32]);
```

with:

```ts
      warps: [
        { from: { tx: 0, tz: 16 }, exit: Direction.West, to: { mapId: 'farm', tx: 46, tz: 38, facing: Direction.West } },
        { from: { tx: 39, tz: 16 }, exit: Direction.East, to: { mapId: 'neighbours', tx: 1, tz: 14, facing: Direction.East } },
      ],
      reserved: [
        { tx: 0, tz: 16 },
        { tx: 1, tz: 16 },
        { tx: 39, tz: 16 },
        { tx: 38, tz: 16 },
      ],
    });
    expect([MAPS.town.grid.width, MAPS.town.grid.depth]).toEqual([40, 32]);
```

In "finds a warp only on its tile and in its exit direction", replace:

```ts
    expect(findWarp(MAPS.town, 0, 15, Direction.West)).toBeNull();
```

with:

```ts
    expect(findWarp(MAPS.town, 0, 15, Direction.West)).toBeNull();
    expect(findWarp(MAPS.town, 39, 16, Direction.East)?.to).toEqual({ mapId: 'neighbours', tx: 1, tz: 14, facing: Direction.East });
    expect(findWarp(MAPS.town, 39, 15, Direction.East)).toBeNull();
    expect(findWarp(MAPS.neighbours, 0, 14, Direction.West)?.to).toEqual({ mapId: 'town', tx: 38, tz: 16, facing: Direction.West });
```

In "answers isReservedTile and structureAt", replace:

```ts
    expect(isReservedTile(MAPS.town, 0, 13)).toBe(false);
```

with:

```ts
    expect(isReservedTile(MAPS.town, 0, 13)).toBe(false);
    expect(isReservedTile(MAPS.town, 38, 16)).toBe(true);
    expect(isReservedTile(MAPS.neighbours, 1, 14)).toBe(true);
```

In `assertMapDefinitions`' `broken` list, replace:

```ts
      withDef('farm', { reserved: MAPS.farm.reserved.filter((r) => !(r.tx === 1 && r.tz === 13)) }),
    ],
  ];
```

with:

```ts
      withDef('farm', { reserved: MAPS.farm.reserved.filter((r) => !(r.tx === 1 && r.tz === 13)) }),
    ],
    [
      'an east gate with no way back from the Neighbours',
      withDef('neighbours', { warps: [] }),
    ],
  ];
```

In "the town, Brookhollow", insert directly before `  it('paves the street and the square with cobble, the paths with dirt, and grasses the rest', () => {`:

```ts
  it('opens the east gate at the east end of the main street, onto the Neighbours lane', () => {
    expect(def.warps[1]).toEqual({ from: { tx: 39, tz: 16 }, exit: Direction.East, to: { mapId: 'neighbours', tx: 1, tz: 14, facing: Direction.East } });
    for (const tx of [38, 39]) {
      expect(structureAt(def, tx, 16), key(tx, 16)).toBeNull();
      expect(requireTile(town, tx, 16), key(tx, 16)).toEqual(EMPTY_TILE);
      expect(def.surfaceAt(tx, 16), key(tx, 16)).toBe('cobble');
      expect(isReservedTile(def, tx, 16), key(tx, 16)).toBe(true);
    }
  });

```

Replace:

```ts
  it('gives a different forest for every seed, while the town is the same for all of them', () => {
    const forests = SEEDS.map((seed) => JSON.stringify(generateMaps(seed).forest));
    expect(new Set(forests).size).toBe(SEEDS.length);
    const towns = SEEDS.map((seed) => JSON.stringify(generateMaps(seed).town));
    expect(new Set(towns).size).toBe(1);
  });
```

with:

```ts
  it('gives a different forest for every seed, while the town and the Neighbours are the same for all of them', () => {
    const forests = SEEDS.map((seed) => JSON.stringify(generateMaps(seed).forest));
    expect(new Set(forests).size).toBe(SEEDS.length);
    const towns = SEEDS.map((seed) => JSON.stringify(generateMaps(seed).town));
    expect(new Set(towns).size).toBe(1);
    const neighbours = SEEDS.map((seed) => JSON.stringify(generateMaps(seed).neighbours));
    expect(new Set(neighbours).size).toBe(1);
  });
```

In "derives the map seed: …", replace:

```ts
      expect(mapSeed(seed, 'town')).toBe(hash32(seed, Salt.MapTown));
```

with:

```ts
      expect(mapSeed(seed, 'town')).toBe(hash32(seed, Salt.MapTown));
      expect(mapSeed(seed, 'neighbours')).toBe(hash32(seed, Salt.MapNeighbours));
```

and replace:

```ts
      expect(mapSeed(seed, 'forest')).not.toBe(mapSeed(seed, 'town'));
```

with:

```ts
      expect(new Set(MAP_IDS.filter((id) => id !== 'farm').map((id) => mapSeed(seed, id))).size).toBe(MAP_IDS.length - 1);
```

In "keeps the reference of a map that did not change overnight", replace:

```ts
    expect(next.maps.town).toBe(BASE.maps.town);
    expect(next.maps.forest).not.toBe(BASE.maps.forest); // its wild crops grow
```

with:

```ts
    expect(next.maps.town).toBe(BASE.maps.town);
    expect(next.maps.neighbours).toBe(BASE.maps.neighbours);
    expect(next.maps.forest).not.toBe(BASE.maps.forest); // its wild crops grow
```

Replace:

```ts
  it('turns a version-2 save with a rock on a gate tile into three maps with the gates clear', () => {
```

with:

```ts
  it('turns a version-2 save with a rock on a gate tile into every map, with the gates clear', () => {
```

and in the same test replace:

```ts
    expect(loaded.maps.town).toEqual(MAPS.town.generate(state.seed));
    expect(loaded.player).toEqual(state.player);
```

with:

```ts
    expect(loaded.maps.town).toEqual(MAPS.town.generate(state.seed));
    expect(loaded.maps.neighbours).toEqual(MAPS.neighbours.generate(state.seed));
    expect(loaded.player).toEqual(state.player);
```

Replace:

```ts
  it('generates the forest and the town from the save seed', () => {
```

with:

```ts
  it('generates the forest, the town and the Neighbours from the save seed', () => {
```

(Its `toEqual({ ...maps, farm: … })` already compares every map `generateMaps` makes. "is deterministic", "pairs every warp with a reciprocal", "leaves each map from an edge tile …", "reserves exactly the warp tiles and the arrival tiles", "keeps every reserved tile a plain walkable empty tile", "never generates … on a reserved tile", "runs each map through the overnight pipeline" and "over many nights …" loop over `MAP_IDS` and cover the new map and the new gate unchanged. The two broken cases that replace `MAPS.town.warps` with one patched farm warp still throw for their own reason first: the town is checked before the Neighbours.)

- [ ] **Step 6: The other tests that count maps, warps or salts**

**`tests/warps.test.ts`.** Replace:

```ts
  it('has four warps: the farm gates to the forest and the town, and one back from each', () => {
    expect(WARPS.map(({ label }) => label)).toEqual([
      'farm (0, 13) → forest',
      'farm (47, 38) → town',
      'forest (35, 15) → farm',
      'town (0, 16) → farm',
    ]);
```

with:

```ts
  it('has six warps: the farm gates to the forest and the town, the town gate to the Neighbours, and one back from each', () => {
    expect(WARPS.map(({ label }) => label)).toEqual([
      'farm (0, 13) → forest',
      'farm (47, 38) → town',
      'forest (35, 15) → farm',
      'town (0, 16) → farm',
      'town (39, 16) → neighbours',
      'neighbours (0, 14) → town',
    ]);
```

and replace:

```ts
    // Every edge step of the farm (48 × 40), forest (36 × 30) and town (40 × 32), minus the four warps.
    expect(blocked).toBe(2 * (48 + 40) + 2 * (36 + 30) + 2 * (40 + 32) - 4);
```

with:

```ts
    // Every edge step of the farm (48 × 40), forest (36 × 30), town (40 × 32) and the Neighbours (40 × 28), minus the six warps.
    expect(blocked).toBe(2 * (48 + 40) + 2 * (36 + 30) + 2 * (40 + 32) + 2 * (40 + 28) - 6);
```

(The other warp tests loop over `WARPS`: the two new gate tiles are walkable empty tiles and the tiles ahead of both arrivals are open lane and street, so they pass as they are.)

**`tests/scenery.test.ts`.** Replace:

```ts
  it('opens as wide as the forest trail and the town road where they meet the edge', () => {
    expect(warpOpenings(MAPS.forest)).toEqual([{ side: 'east', start: 14, end: 17, surface: 'dirt' }]);
    expect(warpOpenings(MAPS.town)).toEqual([{ side: 'west', start: 15, end: 18, surface: 'cobble' }]);
  });
```

with:

```ts
  it('opens as wide as the forest trail, the town road and the Neighbours lane where they meet the edge', () => {
    expect(warpOpenings(MAPS.forest)).toEqual([{ side: 'east', start: 14, end: 17, surface: 'dirt' }]);
    expect(warpOpenings(MAPS.town)).toEqual([
      { side: 'west', start: 15, end: 18, surface: 'cobble' },
      { side: 'east', start: 15, end: 18, surface: 'cobble' },
    ]);
    expect(warpOpenings(MAPS.neighbours)).toEqual([{ side: 'west', start: 13, end: 16, surface: 'dirt' }]);
  });
```

and in "exists only in the town", replace:

```ts
    expect(planScenery(MAPS.forest)).toMatchObject({ wall: false, fence: false });
  });
```

with:

```ts
    expect(planScenery(MAPS.forest)).toMatchObject({ wall: false, fence: false });
    expect(planScenery(MAPS.neighbours)).toMatchObject({ wall: false, fence: true });
  });
```

(The town's wall stands on its back sides only, so the east gate needs no wall gap; the "scatter around every map" and "trails off the grid" loops pick up the Neighbours map and the town's new east corridor by themselves.)

**`tests/determinism.test.ts`.** The traveller's distance field only knows `isWalkable`, so a shortest path through the town or along the lane could aim at a character, whom `movePlayer` now refuses. Teach it what the player can walk. Replace:

```ts
import { seedItemId } from '../src/farming/crops';
```

with:

```ts
import { seedItemId } from '../src/farming/crops';
import { npcAt } from '../src/people/cast';
```

Replace:

```ts
/** Walking distance from every tile of `world` to `goal` over walkable tiles (-1: unreachable). */
function distanceField(world: WorldState, goal: TileCoord): Int32Array {
```

with:

```ts
/**
 * Walking distance from every tile of `world` (map `mapId`) to `goal` over walkable tiles where no
 * character stands, as the player walks (-1: unreachable).
 */
function distanceField(world: WorldState, mapId: MapId, goal: TileCoord): Int32Array {
```

and in its loop replace:

```ts
      if (tile === null || !isWalkable(tile) || dist[next.tz * width + next.tx] !== -1) continue;
```

with:

```ts
      if (tile === null || !isWalkable(tile) || npcAt(mapId, next.tx, next.tz) !== null || dist[next.tz * width + next.tx] !== -1) continue;
```

In `traveller`, replace:

```ts
    if (field === null || field.world !== world || field.warp !== warp) field = { world, warp, dist: distanceField(world, warp.from) };
```

with:

```ts
    if (field === null || field.world !== world || field.warp !== warp) field = { world, warp, dist: distanceField(world, player.mapId, warp.from) };
```

(A new active map always brings a new `world`, so the cached field never outlives its map.) In the header comment, replace:

```ts
 * all three maps are replayed and checked the same way. Also covers the seeded hash primitives everything stochastic is built on.
```

with:

```ts
 * every map are replayed and checked the same way. Also covers the seeded hash primitives everything stochastic is built on.
```

and in "deterministic replay across maps", replace:

```ts
    'keeps warping between all three maps, one teleport per warp or morning',
```

with:

```ts
    'keeps warping between every map, one teleport per warp or morning',
```

and:

```ts
      expect([...visited].sort()).toEqual(['farm', 'forest', 'town']);
```

with:

```ts
      expect([...visited].sort()).toEqual([...MAP_IDS].sort());
```

(The traveller picks a random warp of the town, so with two it now reaches the Neighbours; a trial run of this task's code, with Task 2's blocking in place, visits all four maps within the 5,000 actions and keeps every other assertion in the file green. `MapId` and `MAP_IDS` are already imported.)

**`tests/sections.test.ts`.** In "keeps the existing salts and adds the Phase 0 ones", replace:

```ts
      MapTown: 0xb5297a4d,
      ForestGen: 0x1b56c4e9,
```

with:

```ts
      MapTown: 0xb5297a4d,
      MapNeighbours: 0x4f6cdd1d,
      ForestGen: 0x1b56c4e9,
```

and replace:

```ts
    expect(Object.keys(Salt)).toHaveLength(22);
```

with:

```ts
    expect(Object.keys(Salt)).toHaveLength(23);
```

(0x4f6cdd1d is odd, below 2³¹ and unlike every other salt, so "gives every Salt a distinct value" and the 2³¹ test pass as they are.)

Checked and unchanged: `tests/persistence.test.ts` (its corruption sweep loops over `MAP_IDS` and now also mutates the Neighbours' 62 fence tiles, each rejected; `NEW_FIELDS` spreads `MAP_IDS`), `tests/intents.test.ts`, `tests/inventoryMove.test.ts`, `tests/robotBench.test.ts`, `tests/reducer.test.ts`, `tests/syncPolicy.test.ts`, `tests/renderMaps.test.ts` and the `StructureRenderer` draw-call test (it visits farm, forest and town only). `src/state/robotValidation.ts` and `src/state/zoneMarker.ts` loop over `MAP_IDS` and need no change; the render systems all read `getMap(player.mapId)`.

- [ ] **Step 7: Run it and see it pass**

Run: `npx vitest run tests/neighboursMap.test.ts tests/maps.test.ts tests/saveV7.test.ts tests/cast.test.ts tests/warps.test.ts tests/scenery.test.ts tests/determinism.test.ts tests/sections.test.ts tests/persistence.test.ts`
Expected: PASS (`neighboursMap.test.ts`: 24 tests).

- [ ] **Step 8: The full gate**

Run: `npm run typecheck && npm test && npm run build`
Expected: all green, one more test file than after Task 3.

- [ ] **Step 9: Commit**

```bash
git add src/core/types.ts src/core/hash.ts src/world/maps/neighbours.ts src/world/maps/lookup.ts src/world/maps/types.ts src/world/maps/index.ts src/world/maps/town.ts src/people/cast.ts src/state/intents.ts src/state/persistence.ts tests/testUtils.ts tests/neighboursMap.test.ts tests/maps.test.ts tests/saveV7.test.ts tests/cast.test.ts tests/warps.test.ts tests/scenery.test.ts tests/determinism.test.ts tests/sections.test.ts
git commit -m "Farmclaws part 4a: the Neighbours map and the town's east gate

The Neighbours is a fixed 40 x 28 map east of the town: Cosmo's and Barnaby's
houses and a coop behind a hedge line, a dirt lane from the gate, and two
wood-fenced fields of bare dirt, with Cosmo and Barnaby on the lane. The town
gains an east gate at the end of the main street. The startup check covers the
new layout and now places every character on exactly one map. migrateV6toV7
adds the map to old saves. The neighbours' fences can't be picked up (That
belongs to the neighbours.); anything the player puts down there still can.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

---

### Task 5: Line banks and `lineFor`

**Files:**
- Modify: `src/config.ts` (new `PEOPLE` at the end of the file, after `ROBOT_SCREEN`, ~line 409)
- Create: `src/people/lines.ts`
- Test: `tests/lines.test.ts` (create)

**Interfaces:**
- Consumes:
  - Task 1: `NPC_IDS = ['sol', 'cosmo', 'barnaby', 'marigold', 'bram', 'juniper', 'tess']`, `type NpcId`, `interface NpcTalk { talks; talkedToday }`, `GameState.npcs: Readonly<Record<NpcId, NpcTalk>>` (every id at `{ talks: 0, talkedToday: false }` in `createInitialState`, so `BASE` has every character untalked-to).
  - Existing code: `hash32(...values)` (`src/core/hash.ts`); `defined(value, message)` (`src/core/invariant.ts`); `SEASON_NAMES` (`'Spring'`, `'Summer'`, `'Fall'`, `'Winter'`), `Weather`, `type Robot`, `type RobotPower`, `RobotsState.log.entries: readonly RobotLogEntry[]` with `RobotLogEntry { id, day, minute, robotId, tx, tz, event, count }` and the Say event `{ kind: 'did'; action: 'say'; detail: RobotDidDetail }` (a Say's detail is `{ kind: 'none' }`, `src/robots/execute.ts` ~line 331) (`src/core/types.ts`); `getItem(id).kind` (`'seed'` for every seed item, `src/items/items.ts` ~line 199); `countItem(inventory, itemId)` (`src/state/inventory.ts` ~line 107); `robotOnBench(state): Robot | null` (`src/robots/workbench.ts` ~line 60); `weatherWaters(weather)`, true for rain and storms (`src/time/weather.ts` ~line 35).
  - Test helpers (`tests/testUtils.ts`): `BASE`, `TARGET`, `atDay(state, day, minute)` (moves the calendar, leaves the weather), `withSlots(state, stacks)`, `stack(itemId, quantity)`, `robotOf(overrides)` (a working Mini named Sprocket, id 1, on `TARGET`), `benchedRobotOf(overrides)`, `withRobots(state, robots)` (keeps the list's order as given).
- Produces:
  - `src/config.ts`: `export const PEOPLE = { manyRobots: 4, copperOreLine: 5, everydayLines: 6 } as const`, each with a doc comment (Barnaby's "4 or more robots", Bram's "5 or more copper ore", the size of every everyday bank).
  - `src/people/lines.ts` (pure):
    - `export const REACTIVE_KINDS = ['robotRuined', 'robotBroken', 'robotSaidToday', 'noRobots', 'manyRobots', 'noSeeds', 'copperOre', 'robotOnBench', 'raining'] as const; export type ReactiveKind = (typeof REACTIVE_KINDS)[number];`
    - `export interface LineFill { readonly name?: string; readonly season?: string }` (the contract's inline return type of `reactiveFill`, given a name).
    - `export interface LineBank { readonly introduction: string; readonly reactive: readonly { readonly when: ReactiveKind; readonly text: string }[]; readonly everyday: readonly string[] }`; `export const LINE_BANKS: Readonly<Record<NpcId, LineBank>>`, every line verbatim from spec §3.5, reactive lines in the spec's order.
    - `export function reactiveFill(state: GameState, when: ReactiveKind): LineFill | null`: null when the condition doesn't hold, else the values its line uses (spec §3.5's table).
    - `export function lineFor(state: GameState, npc: NpcId): string`: the introduction when `state.npcs[npc].talks === 0`; else the first reactive line whose `reactiveFill` isn't null, with `{name}` and `{season}` filled; else `everyday[hash32(state.seed, state.time.absoluteDay, NPC_IDS.indexOf(npc)) % everyday.length]`.
  - `tests/lines.test.ts`.

The reactive conditions, exactly as `reactiveFill` reads them (spec §3.5's table):

| Kind | Holds when | Fills |
| --- | --- | --- |
| `robotRuined` / `robotBroken` | some robot in `robots.list` has power `'ruined'` / `'broken'` | `name`: the name of the **lowest-id** such robot, found by comparing ids, not by list position |
| `robotSaidToday` | some `robots.log.entries` entry has `day === state.time.absoluteDay`, `event.kind === 'did'` and `event.action === 'say'` | nothing |
| `noRobots` / `manyRobots` | `robots.list.length === 0` / `>= PEOPLE.manyRobots` (Barnaby's bank lists them in that order) | nothing |
| `noSeeds` | no inventory slot holds an item whose `getItem(itemId).kind === 'seed'` | `season`: `SEASON_NAMES[state.time.season].toLowerCase()` |
| `copperOre` | `countItem(state.inventory, 'copperOre') >= PEOPLE.copperOreLine` | nothing |
| `robotOnBench` | `robotOnBench(state)` isn't null | `name`: that robot's name |
| `raining` | `weatherWaters(state.weather)` | nothing |

- [ ] **Step 1: Write the failing test**

Create `tests/lines.test.ts`:

```ts
/**
 * What the characters say (farmclaws part 4a spec §3.3, §3.5): the introduction first, whatever
 * the farm; each reactive line on its condition, in bank order, with `{name}` and `{season}`
 * filled; the everyday pick by spec §3.3's hash, the same all day and changing with the day; and
 * every bank's shape and text, verbatim.
 */
import { describe, expect, it } from 'vitest';
import { PEOPLE, TIME } from '../src/config';
import { hash32 } from '../src/core/hash';
import { NPC_IDS, Weather, type GameState, type NpcId, type NpcTalk, type RobotLogEntry, type RobotLogEvent } from '../src/core/types';
import { LINE_BANKS, REACTIVE_KINDS, lineFor, reactiveFill, type LineBank } from '../src/people/lines';
import { BASE, TARGET, atDay, benchedRobotOf, robotOf, stack, withRobots, withSlots } from './testUtils';

/** The day the reactive tests run on (spring). */
const DAY = 3;

const SAY: RobotLogEvent = { kind: 'did', action: 'say', detail: { kind: 'none' } };
const MOVE: RobotLogEvent = { kind: 'did', action: 'move', detail: { kind: 'none' } };

/** Everyone talked to `talks` times. */
function talkedTo(state: GameState, talks = 1): GameState {
  const npcs = Object.fromEntries(NPC_IDS.map((npc) => [npc, { talks, talkedToday: false }])) as Record<NpcId, NpcTalk>;
  return { ...state, npcs };
}

/**
 * A farm where no reactive line holds, on `day` at `minute`: everyone talked to once, one working
 * robot off the bench, the starter kit's parsnip seeds and no copper, sunny, and an empty log.
 */
function quiet(day = DAY, minute = 600): GameState {
  return { ...talkedTo(withRobots(atDay(BASE, day, minute), [robotOf()])), weather: Weather.Sunny };
}

/** `state` whose robot log holds one entry by robot 1 per `[day, event]`. */
function withLog(state: GameState, events: readonly (readonly [number, RobotLogEvent])[]): GameState {
  const entries: RobotLogEntry[] = events.map(([day, event], id) => ({
    id,
    day,
    minute: 600,
    robotId: 1,
    tx: TARGET.tx,
    tz: TARGET.tz,
    event,
    count: 1,
  }));
  return { ...state, robots: { ...state.robots, log: { nextId: entries.length, entries } } };
}

/**
 * Every reactive condition holding at once, except "no robots": four robots (Sprocket ruined,
 * Bolt broken, Gizmo on the bench), a Say today, no seeds, copper, and rain.
 */
function busy(): GameState {
  const robots = [
    robotOf({ id: 1, name: 'Sprocket', power: 'ruined' }),
    robotOf({ id: 2, name: 'Bolt', power: 'broken', tx: TARGET.tx - 1 }),
    benchedRobotOf({ id: 3, name: 'Gizmo' }),
    robotOf({ id: 4, name: 'Widget', tx: TARGET.tx + 1 }),
  ];
  const farm = withSlots(withRobots(quiet(), robots), [stack('hoe', 1), stack('copperOre', PEOPLE.copperOreLine)]);
  return { ...withLog(farm, [[DAY, SAY]]), weather: Weather.Rain };
}

/** The everyday line spec §3.3's formula picks for `npc` on `state`'s day. */
function everydayPick(state: GameState, npc: NpcId): string | undefined {
  const everyday = LINE_BANKS[npc].everyday;
  return everyday[hash32(state.seed, state.time.absoluteDay, NPC_IDS.indexOf(npc)) % everyday.length];
}

describe('lineFor', () => {
  it('opens with the introduction while talks is 0, even when a reactive line holds', () => {
    const fresh = talkedTo(busy(), 0);
    for (const npc of NPC_IDS) {
      expect(lineFor(BASE, npc)).toBe(LINE_BANKS[npc].introduction);
      expect(lineFor(fresh, npc)).toBe(LINE_BANKS[npc].introduction);
    }
  });

  it("says each character's first reactive line once they've been talked to", () => {
    const state = busy();
    expect(Object.fromEntries(NPC_IDS.map((npc) => [npc, lineFor(state, npc)]))).toEqual({
      sol: "Water and wires don't mix. Bring what's left of Sprocket to the bench.",
      cosmo: 'Your robot talked today! Mine talks every day. To the chickens. They love it, probably.',
      barnaby: "Four robots or more? Now you're thinking like me. Scale fixes everything.",
      marigold: "Out of seeds? I've got plenty for spring.",
      bram: "That's a fair bit of copper. Sprinklers don't build themselves.",
      juniper: 'Gizmo is up on your bench, I hear. A good bench is half the job.',
      tess: "Rain again. The cows don't mind, and neither do I.",
    });
  });
});

describe('reactive lines', () => {
  it('Sol names the lowest-id ruined robot, whatever the list order', () => {
    const state = withRobots(quiet(), [
      robotOf({ id: 3, name: 'Bolt', power: 'ruined' }),
      robotOf({ id: 2, name: 'Gizmo', power: 'ruined', tx: TARGET.tx - 1 }),
      robotOf({ id: 1, tx: TARGET.tx + 1 }),
    ]);
    expect(lineFor(state, 'sol')).toBe("Water and wires don't mix. Bring what's left of Gizmo to the bench.");
  });

  it('Sol names the lowest-id broken robot, whatever the list order', () => {
    const state = withRobots(quiet(), [
      robotOf({ id: 2, name: 'Gizmo', power: 'broken' }),
      robotOf({ id: 1, power: 'broken', tx: TARGET.tx - 1 }),
    ]);
    expect(lineFor(state, 'sol')).toBe("Sprocket took a swim? Fish it out today, or there won't be much to fix tomorrow.");
  });

  it("Sol's ruined line comes before his broken line", () => {
    const state = withRobots(quiet(), [
      robotOf({ id: 1, power: 'broken' }),
      robotOf({ id: 2, name: 'Bolt', power: 'ruined', tx: TARGET.tx - 1 }),
    ]);
    expect(lineFor(state, 'sol')).toBe("Water and wires don't mix. Bring what's left of Bolt to the bench.");
  });

  it('Cosmo notices a Say today', () => {
    expect(lineFor(withLog(quiet(), [[DAY, SAY]]), 'cosmo')).toBe(
      'Your robot talked today! Mine talks every day. To the chickens. They love it, probably.',
    );
  });

  it("Cosmo ignores yesterday's Say and today's other actions", () => {
    const state = withLog(quiet(), [
      [DAY - 1, SAY],
      [DAY, MOVE],
    ]);
    expect(lineFor(state, 'cosmo')).toBe(everydayPick(state, 'cosmo'));
  });

  it('Barnaby notices no robots', () => {
    expect(lineFor(withRobots(quiet(), []), 'barnaby')).toBe("No robots yet? You're leaving money in the field, friend.");
  });

  it('Barnaby notices PEOPLE.manyRobots robots or more', () => {
    const robots = Array.from({ length: PEOPLE.manyRobots }, (_, i) => robotOf({ id: i + 1, tx: i + 1 }));
    expect(lineFor(withRobots(quiet(), robots), 'barnaby')).toBe(
      "Four robots or more? Now you're thinking like me. Scale fixes everything.",
    );
  });

  it('Barnaby says an everyday line with one robot fewer', () => {
    const robots = Array.from({ length: PEOPLE.manyRobots - 1 }, (_, i) => robotOf({ id: i + 1, tx: i + 1 }));
    const state = withRobots(quiet(), robots);
    expect(lineFor(state, 'barnaby')).toBe(everydayPick(state, 'barnaby'));
  });

  it('Marigold notices no seeds, naming the season in lower case', () => {
    const seasons = ['spring', 'summer', 'fall', 'winter'];
    seasons.forEach((season, i) => {
      const state = withSlots(quiet(i * TIME.daysPerSeason), [stack('hoe', 1)]);
      expect(lineFor(state, 'marigold')).toBe(`Out of seeds? I've got plenty for ${season}.`);
    });
  });

  it('Marigold counts produce as no seeds', () => {
    const state = withSlots(quiet(), [stack('hoe', 1), stack('parsnip', 3)]);
    expect(lineFor(state, 'marigold')).toBe("Out of seeds? I've got plenty for spring.");
  });

  it('Marigold says an everyday line while any slot, the backpack included, holds seeds', () => {
    const state = withSlots(quiet(), [stack('hoe', 1), ...Array<null>(19).fill(null), stack('parsnip_seeds', 1)]);
    expect(state.inventory.slots[20]).toEqual(stack('parsnip_seeds', 1));
    expect(lineFor(state, 'marigold')).toBe(everydayPick(state, 'marigold'));
  });

  it('Bram notices PEOPLE.copperOreLine copper ore across slots', () => {
    const state = withSlots(quiet(), [stack('copperOre', 2), stack('hoe', 1), stack('copperOre', PEOPLE.copperOreLine - 2)]);
    expect(lineFor(state, 'bram')).toBe("That's a fair bit of copper. Sprinklers don't build themselves.");
  });

  it('Bram says an everyday line with one copper ore fewer', () => {
    const state = withSlots(quiet(), [stack('copperOre', PEOPLE.copperOreLine - 1)]);
    expect(lineFor(state, 'bram')).toBe(everydayPick(state, 'bram'));
  });

  it('Juniper names the robot on the workbench', () => {
    const state = withRobots(quiet(), [benchedRobotOf({ name: 'Gizmo' })]);
    expect(lineFor(state, 'juniper')).toBe('Gizmo is up on your bench, I hear. A good bench is half the job.');
  });

  it("Juniper fills a robot's name literally, $ signs and all", () => {
    const state = withRobots(quiet(), [benchedRobotOf({ name: "$& $' Co." })]);
    expect(lineFor(state, 'juniper')).toBe("$& $' Co. is up on your bench, I hear. A good bench is half the job.");
  });

  it('Tess notices rain and storms', () => {
    for (const weather of [Weather.Rain, Weather.Storm]) {
      expect(lineFor({ ...quiet(), weather }, 'tess')).toBe("Rain again. The cows don't mind, and neither do I.");
    }
  });

  it('Tess says an everyday line in snow', () => {
    const state = { ...quiet(), weather: Weather.Snow };
    expect(lineFor(state, 'tess')).toBe(everydayPick(state, 'tess'));
  });
});

describe('reactiveFill', () => {
  it('holds for nothing on the quiet farm', () => {
    for (const kind of REACTIVE_KINDS) expect(reactiveFill(quiet(), kind)).toBeNull();
  });

  it('gives each line only the values it uses', () => {
    const state = busy();
    expect(Object.fromEntries(REACTIVE_KINDS.map((kind) => [kind, reactiveFill(state, kind)]))).toEqual({
      robotRuined: { name: 'Sprocket' },
      robotBroken: { name: 'Bolt' },
      robotSaidToday: {},
      noRobots: null,
      manyRobots: {},
      noSeeds: { season: 'spring' },
      copperOre: {},
      robotOnBench: { name: 'Gizmo' },
      raining: {},
    });
  });
});

describe('everyday lines', () => {
  const WEEK = [0, 1, 2, 3, 4, 5, 6];

  it("are picked by spec §3.3's hash when no reactive line holds", () => {
    for (const day of WEEK) {
      const state = quiet(day);
      for (const npc of NPC_IDS) {
        const pick = everydayPick(state, npc);
        expect(pick).toBeDefined();
        expect(lineFor(state, npc)).toBe(pick);
      }
    }
  });

  it('stay the same all day', () => {
    const minutes = [TIME.dayStartMinute, 600, TIME.passOutMinute - TIME.clockStepMinutes];
    for (const npc of NPC_IDS) {
      const lines = new Set(minutes.map((minute) => lineFor(quiet(DAY, minute), npc)));
      expect(lines.size).toBe(1);
    }
  });

  it('change with the day', () => {
    const changes = NPC_IDS.some((npc) => new Set(WEEK.map((day) => lineFor(quiet(day), npc))).size > 1);
    expect(changes).toBe(true);
  });
});

describe('LINE_BANKS', () => {
  it('give everyone an introduction, PEOPLE.everydayLines everyday lines and known reactive kinds, each in one bank', () => {
    const used: string[] = [];
    for (const npc of NPC_IDS) {
      const bank = LINE_BANKS[npc];
      expect(bank.introduction).not.toBe('');
      expect(bank.everyday).toHaveLength(PEOPLE.everydayLines);
      expect(new Set(bank.everyday).size).toBe(PEOPLE.everydayLines);
      for (const line of bank.reactive) {
        expect(REACTIVE_KINDS).toContain(line.when);
        used.push(line.when);
      }
    }
    expect(used.sort()).toEqual([...REACTIVE_KINDS].sort());
  });

  it("hold spec §3.5's lines verbatim, reactive lines in the spec's order", () => {
    expect(LINE_BANKS).toEqual(SPEC_BANKS);
  });
});

/** Spec §3.5, copied line for line. */
const SPEC_BANKS: Readonly<Record<NpcId, LineBank>> = {
  sol: {
    introduction: 'Sol. I used to seed fields by hand; now I build the hands. When your robots need parts, this is the place.',
    reactive: [
      { when: 'robotRuined', text: "Water and wires don't mix. Bring what's left of {name} to the bench." },
      { when: 'robotBroken', text: "{name} took a swim? Fish it out today, or there won't be much to fix tomorrow." },
    ],
    everyday: [
      "A robot does exactly what you tell it. That's the good news and the bad news.",
      'I seeded this valley for twenty years. My robots do it in a morning, if I write them well.',
      "Most broken robots aren't broken. They're just obeying something nobody meant to say.",
      'Keep them near a generator at night. A flat robot is a very expensive lawn ornament.',
      "Half my old crew build robots now. The other half still won't talk to me.",
      'Start small. One robot, one job, one zone.',
    ],
  },
  cosmo: {
    introduction: "Hi! I'm Cosmo. My robot is the biggest one in the valley. It mostly says hello to the chickens.",
    reactive: [
      { when: 'robotSaidToday', text: 'Your robot talked today! Mine talks every day. To the chickens. They love it, probably.' },
    ],
    everyday: [
      "I bet robots can do loads of things. I just haven't asked mine to yet.",
      "Do you think the chickens know the robot's name? I think they do.",
      'My robot cost more than my house. Worth it. Look at it wave!',
      'Someone told me robots can harvest. Wild, right?',
      'I tried to read the program once. Too many blocks. I went to feed the chickens.',
      "Come by the farm sometime. Bring snacks. The robot can't eat them, but I can.",
    ],
  },
  barnaby: {
    introduction: "Barnaby. Four robots, one field, zero effort. That's the future, and I'm already living in it.",
    reactive: [
      { when: 'noRobots', text: "No robots yet? You're leaving money in the field, friend." },
      { when: 'manyRobots', text: "Four robots or more? Now you're thinking like me. Scale fixes everything." },
    ],
    everyday: [
      'Robots never get tired. Mine just get a bit flat in the afternoons.',
      "Measure it? Why measure it? You can see it's working. Mostly.",
      "My field's nearly harvested. It's been nearly harvested since Tuesday.",
      "The trick is more robots. If that doesn't work, even more robots.",
      "Tokens per crop? I don't do sums. I do vision.",
      "One day every farm will run itself. Mine's halfway there. Roughly.",
    ],
  },
  marigold: {
    introduction: "Welcome! I'm Marigold. Seeds, fertiliser, a bigger backpack one day. Shop with me any time.",
    reactive: [
      { when: 'noSeeds', text: "Out of seeds? I've got plenty for {season}." },
    ],
    everyday: [
      'Parsnips in spring, pumpkins in fall. Get the season right and the rest is watering.',
      'Fertiliser is worth every coin. Ask anyone with gold-star carrots.',
      'Rain saves you a watering. My favourite kind of weather.',
      'Cauliflower takes its time, but oh, the price.',
      "Strawberries keep giving. Plant them early and you'll be picking all spring.",
      'If something wilts, it was the season, not you. Mostly.',
    ],
  },
  bram: {
    introduction: "Bram. Blacksmith. I sharpen tools and I don't do small talk.",
    reactive: [
      { when: 'copperOre', text: "That's a fair bit of copper. Sprinklers don't build themselves." },
    ],
    everyday: [
      'A good tool outlives its owner.',
      "Rocks are just iron that hasn't met me yet.",
      "Copper's in the rocks out on your farm. Break enough and you'll find it.",
      "Hot forge, cold drink. That's my day.",
      "Robots? Sol's business. I make things that stay where you put them.",
      'Swing the pickaxe twice. Rocks are stubborn.',
    ],
  },
  juniper: {
    introduction: 'Juniper. I build barns, coops and anything with a hammer. Soon, robots too.',
    reactive: [
      { when: 'robotOnBench', text: '{name} is up on your bench, I hear. A good bench is half the job.' },
    ],
    everyday: [
      "Measure twice, cut once. Same goes for programs, I'd guess.",
      "Wood and stone. Bring me enough and I'll build you something that lasts.",
      'A coop keeps chickens dry. A barn keeps cows happy. Happy cows, happy farmer.',
      "Sol's been asking about my workbench designs. Watch this space.",
      'Every good fence starts with a straight line.',
      'If it creaks, it needs a nail. If it wobbles, it needs two.',
    ],
  },
  tess: {
    introduction: "Hi there, I'm Tess. Chickens, cows and wheat to feed them. Come see the ranch.",
    reactive: [
      { when: 'raining', text: "Rain again. The cows don't mind, and neither do I." },
    ],
    everyday: [
      'A chicken a day keeps the egg basket full.',
      'Cows like routine. Same time, same trough, every day.',
      "Wheat's the cheapest feed there is. Grow your own and save a fortune.",
      'Pet your animals. They notice.',
      "Cosmo's chickens are the best-greeted chickens in the valley.",
      'Big skies, quiet fields. Best job there is.',
    ],
  },
};
```

(`SPEC_BANKS` sits at the end of the file because it is long; the `it` callbacks run after the module has loaded, so they see it.)

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run tests/lines.test.ts`
Expected: FAIL, the suite doesn't load: `Error: Cannot find module '../src/people/lines' imported from …/tests/lines.test.ts` (the module doesn't exist yet), so no test runs. `npm run typecheck` would also report the missing module and `PEOPLE` missing from `src/config.ts`.

- [ ] **Step 3: Implement**

**3a. `src/config.ts`.** At the end of `ROBOT_SCREEN`, which is the end of the file today (Tasks 1–4 don't touch it), replace:

```ts
  /** What new .MD card values start at: a DO return at 6:00 pm; "tokens are below" 10. */
  cardDefaults: { returnMinute: 18 * 60, tokensBelow: 10 },
} as const;
```

with:

```ts
  /** What new .MD card values start at: a DO return at 6:00 pm; "tokens are below" 10. */
  cardDefaults: { returnMinute: 18 * 60, tokensBelow: 10 },
} as const;

/** What the characters say (farmclaws part 4a spec §3.3, §3.5). */
export const PEOPLE = {
  /** Barnaby's "4 or more robots" line holds from this many robots. */
  manyRobots: 4,
  /** Bram's "5 or more copper ore" line holds from this much copper ore in the inventory. */
  copperOreLine: 5,
  /** Lines in every character's everyday bank. */
  everydayLines: 6,
} as const;
```

**3b. `src/people/lines.ts`.** Create:

```ts
/**
 * What the characters say (farmclaws part 4a spec §3.3, §3.5): each character's introduction,
 * the lines that react to the farm and the everyday lines, and which one a chat shows. Pure: the
 * line is a function of the state, so a character says the same thing all day unless the farm
 * changes a reactive condition.
 */
import { PEOPLE } from '../config';
import { hash32 } from '../core/hash';
import { defined } from '../core/invariant';
import { NPC_IDS, SEASON_NAMES, type GameState, type NpcId, type Robot, type RobotPower } from '../core/types';
import { getItem } from '../items/items';
import { robotOnBench } from '../robots/workbench';
import { countItem } from '../state/inventory';
import { weatherWaters } from '../time/weather';

/** The farm conditions a reactive line answers (spec §3.5's table). */
export const REACTIVE_KINDS = [
  'robotRuined',
  'robotBroken',
  'robotSaidToday',
  'noRobots',
  'manyRobots',
  'noSeeds',
  'copperOre',
  'robotOnBench',
  'raining',
] as const;
export type ReactiveKind = (typeof REACTIVE_KINDS)[number];

/** What a reactive line fills in: `{name}` (a robot's name) and `{season}` (the season's name in lower case). */
export interface LineFill {
  readonly name?: string;
  readonly season?: string;
}

/** One character's lines (spec §3.3). */
export interface LineBank {
  /** The first chat's line. */
  readonly introduction: string;
  /** Tried in order; the first whose condition holds is said. */
  readonly reactive: readonly { readonly when: ReactiveKind; readonly text: string }[];
  /** PEOPLE.everydayLines lines; the day's one is picked by hash. */
  readonly everyday: readonly string[];
}

/** Every character's lines, verbatim from spec §3.5. */
export const LINE_BANKS: Readonly<Record<NpcId, LineBank>> = {
  sol: {
    introduction: 'Sol. I used to seed fields by hand; now I build the hands. When your robots need parts, this is the place.',
    reactive: [
      { when: 'robotRuined', text: "Water and wires don't mix. Bring what's left of {name} to the bench." },
      { when: 'robotBroken', text: "{name} took a swim? Fish it out today, or there won't be much to fix tomorrow." },
    ],
    everyday: [
      "A robot does exactly what you tell it. That's the good news and the bad news.",
      'I seeded this valley for twenty years. My robots do it in a morning, if I write them well.',
      "Most broken robots aren't broken. They're just obeying something nobody meant to say.",
      'Keep them near a generator at night. A flat robot is a very expensive lawn ornament.',
      "Half my old crew build robots now. The other half still won't talk to me.",
      'Start small. One robot, one job, one zone.',
    ],
  },
  cosmo: {
    introduction: "Hi! I'm Cosmo. My robot is the biggest one in the valley. It mostly says hello to the chickens.",
    reactive: [
      { when: 'robotSaidToday', text: 'Your robot talked today! Mine talks every day. To the chickens. They love it, probably.' },
    ],
    everyday: [
      "I bet robots can do loads of things. I just haven't asked mine to yet.",
      "Do you think the chickens know the robot's name? I think they do.",
      'My robot cost more than my house. Worth it. Look at it wave!',
      'Someone told me robots can harvest. Wild, right?',
      'I tried to read the program once. Too many blocks. I went to feed the chickens.',
      "Come by the farm sometime. Bring snacks. The robot can't eat them, but I can.",
    ],
  },
  barnaby: {
    introduction: "Barnaby. Four robots, one field, zero effort. That's the future, and I'm already living in it.",
    reactive: [
      { when: 'noRobots', text: "No robots yet? You're leaving money in the field, friend." },
      { when: 'manyRobots', text: "Four robots or more? Now you're thinking like me. Scale fixes everything." },
    ],
    everyday: [
      'Robots never get tired. Mine just get a bit flat in the afternoons.',
      "Measure it? Why measure it? You can see it's working. Mostly.",
      "My field's nearly harvested. It's been nearly harvested since Tuesday.",
      "The trick is more robots. If that doesn't work, even more robots.",
      "Tokens per crop? I don't do sums. I do vision.",
      "One day every farm will run itself. Mine's halfway there. Roughly.",
    ],
  },
  marigold: {
    introduction: "Welcome! I'm Marigold. Seeds, fertiliser, a bigger backpack one day. Shop with me any time.",
    reactive: [
      { when: 'noSeeds', text: "Out of seeds? I've got plenty for {season}." },
    ],
    everyday: [
      'Parsnips in spring, pumpkins in fall. Get the season right and the rest is watering.',
      'Fertiliser is worth every coin. Ask anyone with gold-star carrots.',
      'Rain saves you a watering. My favourite kind of weather.',
      'Cauliflower takes its time, but oh, the price.',
      "Strawberries keep giving. Plant them early and you'll be picking all spring.",
      'If something wilts, it was the season, not you. Mostly.',
    ],
  },
  bram: {
    introduction: "Bram. Blacksmith. I sharpen tools and I don't do small talk.",
    reactive: [
      { when: 'copperOre', text: "That's a fair bit of copper. Sprinklers don't build themselves." },
    ],
    everyday: [
      'A good tool outlives its owner.',
      "Rocks are just iron that hasn't met me yet.",
      "Copper's in the rocks out on your farm. Break enough and you'll find it.",
      "Hot forge, cold drink. That's my day.",
      "Robots? Sol's business. I make things that stay where you put them.",
      'Swing the pickaxe twice. Rocks are stubborn.',
    ],
  },
  juniper: {
    introduction: 'Juniper. I build barns, coops and anything with a hammer. Soon, robots too.',
    reactive: [
      { when: 'robotOnBench', text: '{name} is up on your bench, I hear. A good bench is half the job.' },
    ],
    everyday: [
      "Measure twice, cut once. Same goes for programs, I'd guess.",
      "Wood and stone. Bring me enough and I'll build you something that lasts.",
      'A coop keeps chickens dry. A barn keeps cows happy. Happy cows, happy farmer.',
      "Sol's been asking about my workbench designs. Watch this space.",
      'Every good fence starts with a straight line.',
      'If it creaks, it needs a nail. If it wobbles, it needs two.',
    ],
  },
  tess: {
    introduction: "Hi there, I'm Tess. Chickens, cows and wheat to feed them. Come see the ranch.",
    reactive: [
      { when: 'raining', text: "Rain again. The cows don't mind, and neither do I." },
    ],
    everyday: [
      'A chicken a day keeps the egg basket full.',
      'Cows like routine. Same time, same trough, every day.',
      "Wheat's the cheapest feed there is. Grow your own and save a fortune.",
      'Pet your animals. They notice.',
      "Cosmo's chickens are the best-greeted chickens in the valley.",
      'Big skies, quiet fields. Best job there is.',
    ],
  },
};

/** A condition that holds with nothing to fill. */
const HOLDS: LineFill = {};

/** Null when `when` doesn't hold on this farm, else the values its line fills in (spec §3.5's table). */
export function reactiveFill(state: GameState, when: ReactiveKind): LineFill | null {
  switch (when) {
    case 'robotRuined':
      return nameOf(lowestIdWith(state, 'ruined'));
    case 'robotBroken':
      return nameOf(lowestIdWith(state, 'broken'));
    case 'robotSaidToday':
      return state.robots.log.entries.some(
        (entry) => entry.day === state.time.absoluteDay && entry.event.kind === 'did' && entry.event.action === 'say',
      )
        ? HOLDS
        : null;
    case 'noRobots':
      return state.robots.list.length === 0 ? HOLDS : null;
    case 'manyRobots':
      return state.robots.list.length >= PEOPLE.manyRobots ? HOLDS : null;
    case 'noSeeds':
      return state.inventory.slots.some((slot) => slot !== null && getItem(slot.itemId).kind === 'seed')
        ? null
        : { season: SEASON_NAMES[state.time.season].toLowerCase() };
    case 'copperOre':
      return countItem(state.inventory, 'copperOre') >= PEOPLE.copperOreLine ? HOLDS : null;
    case 'robotOnBench':
      return nameOf(robotOnBench(state));
    case 'raining':
      return weatherWaters(state.weather) ? HOLDS : null;
  }
}

/**
 * The line `npc` says today (spec §3.3): the introduction until the first chat is recorded, then
 * the first reactive line whose condition holds, else the day's everyday line. Pick it before the
 * chat is recorded, so the first chat shows the introduction.
 */
export function lineFor(state: GameState, npc: NpcId): string {
  const bank = LINE_BANKS[npc];
  if (state.npcs[npc].talks === 0) return bank.introduction;
  for (const line of bank.reactive) {
    const fill = reactiveFill(state, line.when);
    if (fill !== null) return filledIn(line.text, fill);
  }
  const index = hash32(state.seed, state.time.absoluteDay, NPC_IDS.indexOf(npc)) % bank.everyday.length;
  return defined(bank.everyday[index], `${npc} has an everyday line ${index}`);
}

/** The robot with `power` and the lowest id. The list is kept in id order, but this doesn't rely on it. */
function lowestIdWith(state: GameState, power: RobotPower): Robot | null {
  let lowest: Robot | null = null;
  for (const robot of state.robots.list) {
    if (robot.power === power && (lowest === null || robot.id < lowest.id)) lowest = robot;
  }
  return lowest;
}

/** The fill naming `robot`, or null (the condition doesn't hold) without one. */
function nameOf(robot: Robot | null): LineFill | null {
  return robot === null ? null : { name: robot.name };
}

/** `text` with its placeholders filled in. A function replacer keeps a `$` in a robot's name literal. */
function filledIn(text: string, fill: LineFill): string {
  const { name, season } = fill;
  let line = text;
  if (name !== undefined) line = line.replace('{name}', () => name);
  if (season !== undefined) line = line.replace('{season}', () => season);
  return line;
}
```

Nothing else changes: no existing file names `PEOPLE`, `LINE_BANKS`, `REACTIVE_KINDS` or `lineFor` (checked with `grep -rn` over `src`, `tests` and `scripts`), and nothing imports `src/people/lines.ts` until Task 6.

- [ ] **Step 4: Run it and see it pass**

Run: `npx vitest run tests/lines.test.ts`
Expected: PASS (26 tests).

- [ ] **Step 5: The full gate**

Run: `npm run typecheck && npm test && npm run build`
Expected: all green, with one test file more than after Task 4.

- [ ] **Step 6: Commit**

```bash
git add src/config.ts src/people/lines.ts tests/lines.test.ts
git commit -m "Farmclaws part 4a: line banks and lineFor

Each character gets an introduction, the lines that react to the farm and six
everyday lines, verbatim from spec 3.5. lineFor picks the introduction on the
first chat, then the first reactive line that holds, then the day's everyday line
by hash, so a character says the same thing all day unless the farm changes.
PEOPLE holds Barnaby's and Bram's thresholds and the bank size.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Talking

**Files:**
- Create: `tests/talk.test.ts`
- Modify: `src/core/types.ts` (`UiPanel`, the `robot` member, ~line 471)
- Modify: `src/state/intents.ts` (`../core/types` import, ~line 18; the `../people/cast` import Task 2 added; `Intent` union after `peekRobot`, ~line 75; new `planTalk` above `planCarry`, ~line 405; `planCarry`'s doc comment and first line, ~lines 405–407; `planInteraction`, ~lines 458–461; `planShiftInteraction`'s doc comment and first lines, ~lines 533–543; `describeIntent` after `peekRobot`, ~line 601)
- Modify: `src/state/reducer.ts` (`../core/types` import, ~line 16; new `../people/lines` import after `../items/items`, ~line 45; new `morningNpcs` after `shippedStats`, ~line 200; `startNextDay`'s doc comment and its `next` state, ~lines 202–249; `applyIntent` after `peekRobot`, ~line 481)
- Modify: `src/input/panelKeys.ts` (header comment, lines 4–5; `INTERACT_KEYS` doc comment, line 19; `panelKeyCommand`'s interact branch, ~lines 42–44)
- Test: `tests/talk.test.ts` (new)

No renderer, HUD or input-controller file changes: see Step 3e.

**Interfaces:**
- Consumes:
  - Task 1: `NPC_IDS` (the seven ids), `NpcId`, `interface NpcTalk { talks; talkedToday }`, `GameSections.npcs: Readonly<Record<NpcId, NpcTalk>>`, every id starting at `{ talks: 0, talkedToday: false }`.
  - Task 2: `src/people/cast.ts`: `CAST` (`name`, `role`), `npcAt(mapId, tx, tz): NpcId | null`; `placementProblem` returning `"Someone's standing there."` on a character's tile (after the farm-only rule); `movePlayer` refusing a step onto a character; the town's placements: Sol (21, 7), Marigold (7, 7), Bram (16, 7), Juniper (24, 7), Tess (35, 7), all facing South. Task 2 already imports `npcAt` into `src/state/intents.ts`.
  - Task 4: the Neighbours map with Cosmo (7, 13) facing South and Barnaby (25, 15) facing North; the lane at z 13–15 is plain walkable dirt.
  - Task 5: `src/people/lines.ts`: `LINE_BANKS` (each `introduction`, `everyday`), `lineFor(state, npc)` (the introduction while `talks` is 0).
  - Existing: `plan`, `selectTargetTile`, `executePlan` / `recordAction` (a successful plan records `lastAction` with its feedback kind), `startNextDay` (exported), `selectIsFrozen`, `panelKeyCommand`, `INTERACT_KEYS`, `IGNORED`, `isInventoryScreenOpen`; test helpers `BASE`, `emptyHanded`, `holding`, `robotOf`, `withEnergy`, `withPlayer`, `withRobots`, `withTile`; `deepFreeze` from `src/core/store.ts`.
- Produces:
  - `src/core/types.ts`: `UiPanel` gains `| { readonly kind: 'talk'; readonly npc: NpcId; readonly line: string }` (R6), with a doc comment.
  - `src/state/intents.ts`: `Intent` gains `| { readonly kind: 'talkTo'; readonly npc: NpcId }`; private `planTalk(state): ActionPlan | null`: the character on the target tile (`npcAt(state.player.mapId, target.tx, target.tz)`) as `plan(target, { kind: 'talkTo', npc }, 'none')`, or null. It is checked first in `planCarry` (spec §3.1; this covers E and Space while carrying), first in `planInteraction` after its carrying branch (before the workbench), and first in `planShiftInteraction` (before the workbench). `planPrimaryAction` is unchanged: with empty hands, produce or materials it falls back to `planInteraction` and talks; a placeable gets "Someone's standing there."; tools and seeds plan as on any other tile. `describeIntent` → `` `Talk to ${CAST[intent.npc].name}` ``.
  - `src/state/reducer.ts`: `applyIntent` case `'talkTo'`: `const line = lineFor(state, intent.npc)` on the state before the chat; then `npcs[npc]` becomes `{ talks: talks + 1, talkedToday: true }` and `ui.panel` becomes `{ kind: 'talk', npc, line }`. No energy, no time. `startNextDay` resets every `talkedToday` to false through a private `morningNpcs(npcs)`, keeping `state.npcs` itself when none was true and every untouched entry's reference.
  - `src/input/panelKeys.ts`: with the talk panel open, `INTERACT_KEYS` (with or without Shift) return `actions.closePanel()`; Escape already closes any panel; the doc comments name the chat box.
  - `tests/talk.test.ts` (create, 17 tests). Task 7 adds the `talk/act` cases.

- [ ] **Step 1: Write the failing test**

Create `tests/talk.test.ts`:

```ts
/**
 * Talking (farmclaws part 4a spec §3.1, §3.4): E on a character plans `talkTo`, hinted "Talk to
 * {name}", before anything else on their tile; Shift + E does the same, and so does Space with
 * nothing usable in hand or while carrying a robot. A chat opens the talk panel with the line
 * picked before the chat is recorded, freezes the game, costs no energy or time, and counts in
 * `npcs`; `talkedToday` clears each morning. E, K, Enter and Escape close the panel.
 */
import { describe, expect, it } from 'vitest';
import { INVENTORY } from '../src/config';
import { deepFreeze } from '../src/core/store';
import { Direction, NPC_IDS, type GameState, type MapId, type NpcId, type TileCoord } from '../src/core/types';
import { IGNORED, INTERACT_KEYS, panelKeyCommand } from '../src/input/panelKeys';
import { LINE_BANKS, lineFor } from '../src/people/lines';
import { actions } from '../src/state/actions';
import { describeIntent, planInteraction, planPrimaryAction, planShiftInteraction, type ActionPlan } from '../src/state/intents';
import { gameReducer, startNextDay } from '../src/state/reducer';
import { selectIsFrozen } from '../src/state/selectors';
import { EMPTY_TILE } from '../src/world/tiles';
import { BASE, emptyHanded, holding, robotOf, withEnergy, withPlayer, withRobots, withTile } from './testUtils';

const interact = (state: GameState): GameState => gameReducer(state, actions.interact());
const peek = (state: GameState): GameState => gameReducer(state, actions.peek());
const useTool = (state: GameState): GameState => gameReducer(state, actions.useTool());

/** Marigold's spot in the town (spec §2.1). */
const MARIGOLD: TileCoord = { tx: 7, tz: 7 };

/** The player on the tile south of Marigold, facing her, with empty hands. */
const AT_MARIGOLD: GameState = deepFreeze(emptyHanded(withPlayer(BASE, { tx: 7, tz: 8 }, Direction.North, 'town')));

const TALK_PLAN: ActionPlan = { target: MARIGOLD, intent: { kind: 'talkTo', npc: 'marigold' }, feedback: 'none', energyCost: 0 };

const INTRODUCTION = "Welcome! I'm Marigold. Seeds, fertiliser, a bigger backpack one day. Shop with me any time.";

/** Each character, the tile in front of them and the way to face them from it, and the hint's name. */
const FACING_EACH: readonly (readonly [NpcId, MapId, TileCoord, Direction, string])[] = [
  ['sol', 'town', { tx: 21, tz: 8 }, Direction.North, 'Sol'],
  ['marigold', 'town', { tx: 7, tz: 8 }, Direction.North, 'Marigold'],
  ['bram', 'town', { tx: 16, tz: 8 }, Direction.North, 'Bram'],
  ['juniper', 'town', { tx: 24, tz: 8 }, Direction.North, 'Juniper'],
  ['tess', 'town', { tx: 35, tz: 8 }, Direction.North, 'Tess'],
  ['cosmo', 'neighbours', { tx: 7, tz: 14 }, Direction.North, 'Cosmo'],
  ['barnaby', 'neighbours', { tx: 25, tz: 14 }, Direction.South, 'Barnaby'],
];

/**
 * AT_MARIGOLD carrying Sprocket (id 1). Movement never takes a carried robot off the farm, so the
 * state is built directly: it pins that planCarry asks about a character before its own rules.
 */
const CARRYING: GameState = withRobots({ ...AT_MARIGOLD, player: { ...AT_MARIGOLD.player, carrying: 1 } }, [robotOf({ carried: true })]);

/** The newest toast's text. */
const lastToast = (state: GameState): string | undefined => state.messages.entries.at(-1)?.text;

describe('the talkTo intent', () => {
  it('plans a free talk with the character ahead, hinted "Talk to Marigold"', () => {
    expect(planInteraction(AT_MARIGOLD)).toEqual(TALK_PLAN);
    expect(describeIntent(planInteraction(AT_MARIGOLD).intent)).toBe('Talk to Marigold');
  });

  it('finds every character from the tile in front of them', () => {
    for (const [npc, mapId, stand, facing, name] of FACING_EACH) {
      const state = withPlayer(BASE, stand, facing, mapId);
      expect(planInteraction(state).intent, npc).toEqual({ kind: 'talkTo', npc });
      expect(describeIntent(planInteraction(state).intent)).toBe(`Talk to ${name}`);
      expect(interact(state).ui.panel).toEqual({ kind: 'talk', npc, line: LINE_BANKS[npc].introduction });
    }
  });

  it('talks only to the character on the target tile', () => {
    const facingAway = withPlayer(AT_MARIGOLD, { tx: 7, tz: 8 }, Direction.East, 'town');
    const oneTileShort = withPlayer(AT_MARIGOLD, { tx: 7, tz: 9 }, Direction.North, 'town');
    for (const state of [facingAway, oneTileShort]) {
      expect(planInteraction(state).intent).toEqual({ kind: 'blocked', reason: null });
      expect(interact(state)).toBe(state);
    }
  });

  it('comes before the objects on the tile: a chest and the workbench', () => {
    // Robots never leave the farm and characters never stand on it, so no robot can share a
    // character's tile; the order is pinned against placed objects and against planCarry.
    const chest = withTile(AT_MARIGOLD, MARIGOLD, { ...EMPTY_TILE, object: { kind: 'chest', slots: Array.from({ length: INVENTORY.chestSlots }, () => null) } });
    const bench = withTile(AT_MARIGOLD, MARIGOLD, { ...EMPTY_TILE, object: { kind: 'workbench' } });
    for (const state of [chest, bench]) {
      expect(planInteraction(state)).toEqual(TALK_PLAN);
      expect(planShiftInteraction(state)).toEqual(TALK_PLAN);
    }
  });

  it("comes before planCarry's own rules, for E and Space", () => {
    expect(planInteraction(CARRYING)).toEqual(TALK_PLAN);
    expect(planPrimaryAction(CARRYING)).toEqual(TALK_PLAN);
    const next = useTool(CARRYING);
    expect(next.ui.panel).toEqual({ kind: 'talk', npc: 'marigold', line: INTRODUCTION });
    expect(next.player.carrying).toBe(1);
    expect(next.robots).toBe(CARRYING.robots);
    // Facing open ground instead, planCarry's own rules still apply.
    const aside = withPlayer(CARRYING, { tx: 7, tz: 8 }, Direction.East, 'town');
    expect(planInteraction(aside).intent).toEqual({ kind: 'putDownRobot', robotId: 1, name: 'Sprocket' });
  });

  it('Shift + E talks like E, even with the zone marker in hand', () => {
    expect(planShiftInteraction(AT_MARIGOLD)).toEqual(TALK_PLAN);
    expect(planShiftInteraction(holding(AT_MARIGOLD, 'zoneMarker'))).toEqual(TALK_PLAN);
    expect(peek(AT_MARIGOLD)).toEqual(interact(AT_MARIGOLD));
  });

  it('Space talks with empty hands, produce or materials; a placeable is refused', () => {
    expect(planPrimaryAction(AT_MARIGOLD)).toEqual(TALK_PLAN);
    expect(planPrimaryAction(holding(AT_MARIGOLD, 'stone', 3))).toEqual(TALK_PLAN);
    expect(planPrimaryAction(holding(AT_MARIGOLD, 'parsnip', 2))).toEqual(TALK_PLAN);
    expect(useTool(AT_MARIGOLD).ui.panel).toEqual({ kind: 'talk', npc: 'marigold', line: INTRODUCTION });

    const placing = holding(AT_MARIGOLD, 'chest');
    expect(planPrimaryAction(placing)).toEqual({
      target: MARIGOLD,
      intent: { kind: 'blocked', reason: "Someone's standing there." },
      feedback: 'place',
      energyCost: 0,
    });
    const refused = useTool(placing);
    expect(refused.ui.panel).toEqual({ kind: 'none' });
    expect(refused.maps).toBe(placing.maps);
    expect(refused.npcs).toBe(placing.npcs);
    expect(lastToast(refused)).toBe("Someone's standing there.");
  });
});

describe('a chat', () => {
  it('opens the talk panel with the introduction first, then an everyday line', () => {
    const first = interact(AT_MARIGOLD);
    expect(first.ui.panel).toEqual({ kind: 'talk', npc: 'marigold', line: INTRODUCTION });
    const closed = gameReducer(first, actions.closePanel());
    const second = interact(closed);
    const line = lineFor(closed, 'marigold');
    expect(second.ui.panel).toEqual({ kind: 'talk', npc: 'marigold', line });
    expect(line).not.toBe(INTRODUCTION);
    expect(LINE_BANKS.marigold.everyday).toContain(line);
  });

  it('counts each chat and marks today, leaving the other characters alone', () => {
    const first = interact(AT_MARIGOLD);
    expect(first.npcs.marigold).toEqual({ talks: 1, talkedToday: true });
    for (const id of NPC_IDS) if (id !== 'marigold') expect(first.npcs[id]).toBe(AT_MARIGOLD.npcs[id]);
    const second = interact(gameReducer(first, actions.closePanel()));
    expect(second.npcs.marigold).toEqual({ talks: 2, talkedToday: true });
  });

  it('costs no energy and no time, even when exhausted', () => {
    const exhausted = withEnergy(AT_MARIGOLD, 0);
    const next = interact(exhausted);
    expect(next.ui.panel.kind).toBe('talk');
    expect(next.player.energy).toBe(0);
    expect(next.time).toBe(exhausted.time);
    expect(next.maps).toBe(exhausted.maps);
    expect(next.inventory).toBe(exhausted.inventory);
    expect(next.messages).toBe(exhausted.messages);
    expect(next.player.lastAction).toEqual({ seq: exhausted.player.actionSeq + 1, kind: 'none', target: MARIGOLD, success: true });
  });

  it('freezes the game while the panel is open', () => {
    const open = interact(AT_MARIGOLD);
    expect(selectIsFrozen(open)).toBe(true);
    expect(gameReducer(open, actions.tick(30))).toBe(open);
    expect(gameReducer(open, actions.move(Direction.West))).toBe(open);
    expect(gameReducer(open, actions.sleep())).toBe(open);
    expect(interact(open)).toBe(open);
    expect(peek(open)).toBe(open);
    expect(useTool(open)).toBe(open);
  });

  it('does nothing while paused', () => {
    const paused = gameReducer(AT_MARIGOLD, actions.setPaused(true));
    expect(interact(paused)).toBe(paused);
    expect(peek(paused)).toBe(paused);
    expect(useTool(paused)).toBe(paused);
  });
});

describe('the morning', () => {
  const talked = gameReducer(interact(AT_MARIGOLD), actions.closePanel());

  it('clears talkedToday, keeping talks and every untouched entry', () => {
    const morning = startNextDay(talked, false);
    expect(morning.npcs.marigold).toEqual({ talks: 1, talkedToday: false });
    for (const id of NPC_IDS) if (id !== 'marigold') expect(morning.npcs[id]).toBe(talked.npcs[id]);
    expect(gameReducer(talked, actions.sleep()).npcs.marigold).toEqual({ talks: 1, talkedToday: false });
  });

  it('keeps the npcs section itself when no one was talked to', () => {
    expect(startNextDay(BASE, false).npcs).toBe(BASE.npcs);
    const yesterday = startNextDay(talked, false);
    expect(startNextDay(yesterday, false).npcs).toBe(yesterday.npcs);
  });
});

describe('the talk panel keys (spec §3.2)', () => {
  const OPEN = deepFreeze(interact(AT_MARIGOLD));

  /** Presses `code` and returns the state the reducer leaves (the same state when nothing is dispatched). */
  function press(code: string, state: GameState, shift = false): GameState {
    const command = panelKeyCommand(code, state, shift);
    if (command === null || command === IGNORED) return state;
    return gameReducer(state, command);
  }

  it('E, K and Enter close it, with or without Shift, and never start another chat', () => {
    for (const code of INTERACT_KEYS) {
      for (const shift of [false, true]) {
        expect(panelKeyCommand(code, OPEN, shift)).toEqual(actions.closePanel());
        const closed = press(code, OPEN, shift);
        expect(closed.ui.panel).toEqual({ kind: 'none' });
        expect(closed.npcs).toBe(OPEN.npcs);
        expect(closed.player.lastAction).toBe(OPEN.player.lastAction);
      }
    }
  });

  it('Escape closes it', () => {
    expect(panelKeyCommand('Escape', OPEN)).toEqual(actions.closePanel());
    expect(press('Escape', OPEN).ui.panel).toEqual({ kind: 'none' });
  });

  it('I and B open nothing over it', () => {
    expect(press('KeyI', OPEN)).toBe(OPEN);
    expect(press('KeyB', OPEN)).toBe(OPEN);
  });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run tests/talk.test.ts`
Expected: FAIL, 14 failed / 3 passed. Nothing plans `talkTo` yet: `planInteraction`, `planShiftInteraction` and `planPrimaryAction` give a silent `{ kind: 'blocked', reason: null }` plan on a character's tile, so no plan equals `TALK_PLAN`, `interact` returns the state unchanged (no panel, `npcs` untouched), "clears talkedToday …" finds `talks: 0`, and with no talk panel open `panelKeyCommand` returns `actions.interact()` for E and opens the backpack or the shop for I and B. The three tests that pin behaviour already in place pass: "talks only to the character on the target tile", "does nothing while paused" and "keeps the npcs section itself when no one was talked to". `npm run typecheck` also fails: `TALK_PLAN`'s `'talkTo'` intent isn't an `Intent` yet.

- [ ] **Step 3: Implement**

**3a. `src/core/types.ts`.** Replace:

```ts
  /** The robot screen (farmclaws part 3 spec §4): editable at the workbench, read-only when peeking. */
  | { readonly kind: 'robot'; readonly robotId: number; readonly mode: 'bench' | 'peek' };
```

with:

```ts
  /** The robot screen (farmclaws part 3 spec §4): editable at the workbench, read-only when peeking. */
  | { readonly kind: 'robot'; readonly robotId: number; readonly mode: 'bench' | 'peek' }
  /**
   * A character's chat box (farmclaws part 4a spec §3.2). `line` is picked as the chat opens,
   * before the chat is recorded, so the first chat shows the introduction and the line never
   * changes while the box is open.
   */
  | { readonly kind: 'talk'; readonly npc: NpcId; readonly line: string };
```

(`NpcId` is declared near the top of the file, ~line 153. `isValidUi` only checks that `panel.kind` is a string, and the loader resets the panel, so no save change.)

**3b. `src/state/intents.ts`.**

In the `../core/types` import, replace:

```ts
  type MapId,
  PLACEABLE_ITEM_IDS,
```

with:

```ts
  type MapId,
  type NpcId,
  PLACEABLE_ITEM_IDS,
```

Replace the import Task 2 added:

```ts
import { npcAt } from '../people/cast';
```

with:

```ts
import { CAST, npcAt } from '../people/cast';
```

In the `Intent` union, insert directly after the `peekRobot` member:

```ts
  /** Shift + E on a standing robot: its screen opens read-only, for free (part 3 spec §2.3). */
  | { readonly kind: 'peekRobot'; readonly robotId: number; readonly name: string }
```

so that it reads:

```ts
  /** Shift + E on a standing robot: its screen opens read-only, for free (part 3 spec §2.3). */
  | { readonly kind: 'peekRobot'; readonly robotId: number; readonly name: string }
  /** Talk to the character ahead: their chat box opens with today's line, for free (part 4a spec §3.1). */
  | { readonly kind: 'talkTo'; readonly npc: NpcId }
```

Replace `planCarry`'s doc comment and first line:

```ts
/** While carrying: the empty workbench takes the robot, the shipping bin sends a broken robot for repair, open ground puts it down. */
function planCarry(state: GameState, robotId: number): ActionPlan {
  const robot = requireRobot(state, robotId);
```

with:

```ts
/**
 * The character standing on the target tile, talked to for free (part 4a spec §3.1), or null
 * when no one stands there. Characters only stand off the farm, so no robot shares their tile.
 */
function planTalk(state: GameState): ActionPlan | null {
  const target = selectTargetTile(state);
  if (target === null) return null;
  const npc = npcAt(state.player.mapId, target.tx, target.tz);
  return npc === null ? null : plan(target, { kind: 'talkTo', npc }, 'none');
}

/**
 * While carrying: a character ahead is talked to first (part 4a spec §3.1); otherwise the empty
 * workbench takes the robot, the shipping bin sends a broken robot for repair, open ground puts it down.
 */
function planCarry(state: GameState, robotId: number): ActionPlan {
  const talk = planTalk(state);
  if (talk !== null) return talk;
  const robot = requireRobot(state, robotId);
```

Replace the start of `planInteraction`:

```ts
/** Plan for the context action (E): open a chest, harvest, clear, ship, sleep, refill. */
export function planInteraction(state: GameState): ActionPlan {
  if (state.player.carrying !== null) return planCarry(state, state.player.carrying);
  const target = selectTargetTile(state);
```

with:

```ts
/** Plan for the context action (E): talk, open a chest, harvest, clear, ship, sleep, refill. */
export function planInteraction(state: GameState): ActionPlan {
  if (state.player.carrying !== null) return planCarry(state, state.player.carrying);
  // A character comes before anything else on their tile (part 4a spec §3.1).
  const talk = planTalk(state);
  if (talk !== null) return talk;
  const target = selectTargetTile(state);
```

Replace `planShiftInteraction`'s doc comment and first lines:

```ts
/**
 * Plan for Shift + an interact key (part 3 spec §2.3), decided in this order:
 *   1. the workbench ahead: exactly what E does there;
 *   2. a standing robot ahead (on the farm, not carried, at repairs or on the bench): peek at
 *      it, which costs nothing and changes nothing but the open panel;
 *   3. the zone marker selected: clear the current letter's zone (spec §8);
 *   4. otherwise nothing, silently.
 */
export function planShiftInteraction(state: GameState): ActionPlan {
  const target = selectTargetTile(state);
```

with:

```ts
/**
 * Plan for Shift + an interact key (part 3 spec §2.3), decided in this order:
 *   1. a character ahead: talk, as E does (part 4a spec §3.1);
 *   2. the workbench ahead: exactly what E does there;
 *   3. a standing robot ahead (on the farm, not carried, at repairs or on the bench): peek at
 *      it, which costs nothing and changes nothing but the open panel;
 *   4. the zone marker selected: clear the current letter's zone (spec §8);
 *   5. otherwise nothing, silently.
 */
export function planShiftInteraction(state: GameState): ActionPlan {
  const talk = planTalk(state);
  if (talk !== null) return talk;
  const target = selectTargetTile(state);
```

`planPrimaryAction` stays as it is: with empty hands, produce or materials it falls back to `planInteraction`, which talks; while carrying it goes to `planCarry`, which talks; a placeable gets Task 2's "Someone's standing there."; tools and seeds plan as on any plain walkable tile of a map without tilling.

In `describeIntent`, replace:

```ts
    case 'peekRobot':
      return `Look at ${intent.name}`;
```

with:

```ts
    case 'peekRobot':
      return `Look at ${intent.name}`;
    case 'talkTo':
      return `Talk to ${CAST[intent.npc].name}`;
```

**3c. `src/state/reducer.ts`.**

In the `../core/types` import, replace:

```ts
  MAP_IDS,
  SEASON_NAMES,
```

with:

```ts
  MAP_IDS,
  NPC_IDS,
  SEASON_NAMES,
```

Insert directly after `import { getItem, isSeedItemId, sellPriceFor } from '../items/items';` (after Task 2's `../people/cast` import instead, if Task 2 put one there):

```ts
import { lineFor } from '../people/lines';
```

Insert directly after the closing `}` of `shippedStats` (before the doc comment of `startNextDay`):

```ts
/**
 * Every character's `talkedToday` back to false for the new day (part 4a spec §3.4). An entry
 * nobody talked to keeps its reference, and so does the section when no one was talked to.
 */
function morningNpcs(npcs: GameState['npcs']): GameState['npcs'] {
  let next = npcs;
  for (const id of NPC_IDS) {
    const talk = npcs[id];
    if (talk.talkedToday) next = { ...next, [id]: { ...talk, talkedToday: false } };
  }
  return next;
}
```

Replace the first lines of `startNextDay`'s doc comment:

```ts
/**
 * Day transition: pay out the shipping bin (each stack at its quality's price, counted into the
 * lifetime stats), advance the calendar, roll the (global) weather, run the overnight growth
 * pipeline on every map with that map's seed, restore energy and put the player back at the
 * house on the farm. Then the robots' night runs (farmclaws part 1 §5.7); its toasts follow the
 * morning's own messages.
 */
```

with:

```ts
/**
 * Day transition: pay out the shipping bin (each stack at its quality's price, counted into the
 * lifetime stats), advance the calendar, roll the (global) weather, run the overnight growth
 * pipeline on every map with that map's seed, restore energy, clear yesterday's chats
 * (`talkedToday`) and put the player back at the house on the farm. Then the robots' night runs
 * (farmclaws part 1 §5.7); its toasts follow the morning's own messages.
 */
```

In `startNextDay`, replace:

```ts
    shipping: { pending: [], lastPayout: payout },
    stats: shippedStats(state, payout),
  };
  const night = runRobotsOvernight(next);
```

with:

```ts
    shipping: { pending: [], lastPayout: payout },
    stats: shippedStats(state, payout),
    npcs: morningNpcs(state.npcs),
  };
  const night = runRobotsOvernight(next);
```

In `applyIntent`, replace:

```ts
    case 'peekRobot':
      return { ...state, ui: { ...state.ui, panel: { kind: 'robot', robotId: intent.robotId, mode: 'peek' } } };
```

with:

```ts
    case 'peekRobot':
      return { ...state, ui: { ...state.ui, panel: { kind: 'robot', robotId: intent.robotId, mode: 'peek' } } };

    case 'talkTo': {
      // The line is picked before the chat is recorded, so the first chat shows the introduction (part 4a spec §3.4).
      const line = lineFor(state, intent.npc);
      const talk = state.npcs[intent.npc];
      return {
        ...state,
        npcs: { ...state.npcs, [intent.npc]: { talks: talk.talks + 1, talkedToday: true } },
        ui: { ...state.ui, panel: { kind: 'talk', npc: intent.npc, line } },
      };
    }
```

(`executePlan` records the plan's `'none'` feedback as a successful `lastAction` and spends no energy, since the plan's `energyCost` is 0. The time doesn't move: only ticks and sleep move it.)

**3d. `src/input/panelKeys.ts`.**

In the header comment, replace:

```ts
 *   E, K, Enter    interact, or close an open inventory or chest instead; with Shift, peek
 *                  (planShiftInteraction: E's meaning at the workbench, else a robot's screen)
```

with:

```ts
 *   E, K, Enter    interact, or close an open inventory, chest or chat box instead; with Shift,
 *                  peek (planShiftInteraction: talk to a character, E's meaning at the
 *                  workbench, else a robot's screen)
```

Replace:

```ts
/** Key codes that interact with the forward tile when no inventory or chest panel is open. */
```

with:

```ts
/** Key codes that interact with the forward tile when no inventory, chest or chat box is open. */
```

In `panelKeyCommand`, replace:

```ts
  if (INTERACT_KEYS.has(code)) {
    if (isInventoryScreenOpen(state)) return actions.closePanel();
```

with:

```ts
  if (INTERACT_KEYS.has(code)) {
    // The chat box closes like the inventory screen, Shift or not (part 4a spec §3.2).
    if (isInventoryScreenOpen(state) || panel === 'talk') return actions.closePanel();
```

(`panel` is the `const panel = state.ui.panel.kind;` declared just above. Escape's `if (panel !== 'none') return actions.closePanel();` already closes the talk panel; I and B dispatch an open that the reducer rejects while a panel is open.)

**3e. Nothing else changes.** Checked, so the engineer doesn't go looking:
- No other exhaustive switch covers `Intent['kind']` or `UiPanel['kind']`: `applyIntent` and `describeIntent` are the only switches over intent kinds (the HUD's `ContextHint` calls `describeIntent`, so it shows "Talk to {name}" with no change), and every `panel.kind` reader in `src/ui`, `src/render` and `src/input` (`Hud.ts`, `RobotScreenHost.ts`, `InventoryScreen.ts`, `heldStack.ts`, `objectLayout.ts`, `ZoneRenderer.ts`, `InputController.ts`) tests for one specific kind. The talk panel freezes the game through `selectIsFrozen` (any kind but `none`).
- A successful `'none'` action is already recorded by `openBench` and `peekRobot`, and nothing reacts to it: `PlayerRenderer`'s `clipFor('none')` is null (no clip), `EffectsRenderer.react` returns on `'none'` (no particles), `TileHighlighter.sync` hides the highlight while the game is frozen, so it never pops for an action that opens a panel, and there are no action sounds.
- Until Task 7 the talk panel draws nothing (R7): the game freezes, the HUD's context hint hides, and E, K, Enter or Escape close it.

- [ ] **Step 4: Run it and see it pass**

Run: `npx vitest run tests/talk.test.ts tests/panelKeys.test.ts tests/intents.test.ts tests/robotPeek.test.ts tests/zoneMarker.test.ts tests/reducer.test.ts tests/cast.test.ts`
Expected: PASS (`talk.test.ts`: 17 tests). The intents property test may now meet a random town situation facing a character; its generic checks hold for `talkTo` (no world, inventory, time or energy change; a successful `'none'` feedback), and it doesn't list `talkTo` among the kinds it must see.

- [ ] **Step 5: The full gate**

Run: `npm run typecheck && npm test && npm run build`
Expected: all green, with one test file more than after Task 5.

- [ ] **Step 6: Commit**

```bash
git add src/core/types.ts src/state/intents.ts src/state/reducer.ts src/input/panelKeys.ts tests/talk.test.ts
git commit -m "Farmclaws part 4a: talking to the characters

E, Shift + E, and Space with nothing usable in hand or while carrying, plan a talkTo on
the character ahead, before anything else on their tile. The reducer picks the line
before recording the chat, so the first chat shows the introduction, and opens the talk
panel carrying that line. Chats cost no energy or time, count in npcs, and talkedToday
clears each morning without touching untouched entries. E, K, Enter and Escape close
the panel; the chat box itself comes in the next step.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The chat box

**Files:**
- Create: `src/ui/chatBoxView.ts`, `src/ui/ChatBox.ts`
- Modify: `src/state/actions.ts` (type import, line 5; end of `GameAction`, line 49; end of `actions`, line 85)
- Modify: `src/state/reducer.ts` (the `../core/types` import, lines 13–37; the `../people/cast` import Task 2 added; `reduceAction`'s switch after `'robot/paint'`, ~line 150; a new section above `loadState`'s doc comment, ~line 854)
- Modify: `src/ui/Hud.ts` (header comment, line 8; imports, after line 52; `Hud` fields ~line 1170, constructor ~lines 1199 and 1213–1214, `sync` ~line 1240)
- Modify: `src/ui/hud.css` (a new section above "Modals (shop, pause)", ~line 1087; the reduced-motion list, ~line 1711)
- Test: `tests/chatBox.test.ts` (create), `tests/talk.test.ts` (Task 6's file; one `describe` appended)

**Interfaces:**
- Consumes:
  - Task 2: `NPC_ACTION_KINDS`, `type NpcActionKind` (types.ts, `['shop']`); `src/people/cast.ts`: `CAST` (`{ name, role }` per id), `npcActions(npc): readonly NpcAction[]` (Marigold `[{ kind: 'shop', label: 'Shop' }]`, everyone else `[]`), `type NpcAction { kind: NpcActionKind; label: string }`, `npcSpot(npc)` (`{ mapId, placement } | null`, or non-null from Task 4); the reducer's `import { npcAt } from '../people/cast';` (for `movePlayer`).
  - Task 5: `lineFor(state, npc)` (`src/people/lines.ts`), in a test only.
  - Task 6: `UiPanel` `{ kind: 'talk'; npc: NpcId; line: string }`; E on a character (`actions.interact()`) opens it with the line picked before the chat was recorded; with the talk panel open, `panelKeyCommand` turns E, K, Enter (Shift or not) and Escape into `actions.closePanel()`; `tests/talk.test.ts`, which imports at least `BASE`, `withPlayer`, `must` from `./testUtils`, `gameReducer` and `actions`.
  - Existing: `reduceAction`'s `never` check, `setPanelOpen` (opens a panel only when none is open and the game isn't paused), `ui/closePanel`, `selectIsFrozen` (any panel freezes; `ContextHint` hides itself while frozen); `ROBOT_SCREEN.phoneMaxWidth` (700); `src/ui/dom.ts`: `h`, `hudButton`, `setText`, `setHidden`, `closestWithin`, `releasePointerFocus`; the HUD's `HudContext` (`dispatch`, `signal`, `icons`, `idPrefix`); hud.css's `.hud-panel`, `.hud-btn`, `.hud-btn--primary`, `.hud-btn--ghost`, the `--hud-*` tokens and `hud-pop-in`.
- Produces:
  - `src/state/actions.ts`: `| { readonly type: 'talk/act'; readonly npc: NpcId; readonly act: NpcActionKind }` (doc: an action button in the chat box, spec §3.2); `actions.npcAct(npc: NpcId, act: NpcActionKind): GameAction`.
  - `src/state/reducer.ts`: `talk/act` returns the same state unless `ui.panel` is the talk panel for `npc`, the game isn't paused and `npcActions(npc)` has `act`; `'shop'` replaces the talk panel with `{ kind: 'shop' }` (R8). Private `talkAct(state, npc, act)` switches over `NpcActionKind` with a `never` default, so 4b and 4c add a case per new kind.
  - `src/ui/chatBoxView.ts` (pure, no DOM): `export interface ChatBoxView { readonly npc: NpcId; readonly name: string; readonly role: string; readonly line: string; readonly actions: readonly NpcAction[] }`; `export function chatBoxView(state: GameState): ChatBoxView | null` (null unless the talk panel is open; `line` is the panel's); `export function isPhoneWidth(width: number): boolean` (`width < ROBOT_SCREEN.phoneMaxWidth`).
  - `src/ui/ChatBox.ts` (main chunk): `export interface ChatBoxContext { dispatch; signal; idPrefix }` (the HUD's `HudContext` satisfies it, as it does `InventoryScreenContext`); `export class ChatBox` with `readonly element: HTMLElement` (named like every HUD widget's root; see the notes) and `sync(state, prev)`. Hidden unless `chatBoxView(state)` isn't null; else the name, the role line under it in smaller text, the line, one button per action (its label) dispatching `actions.npcAct(npc, kind)`, and a **Close** button at the top right dispatching `actions.closePanel()`. Text through `textContent`. The `chat-box--phone` modifier while `isPhoneWidth(window.innerWidth)`, re-read on `resize` with the HUD's abort signal.
  - `Hud.ts` puts it first in the bottom-centre column (above the hint, the zone chip and the hotbar) and syncs it with the other widgets. `hud.css` gains the `.chat-box` rules.
  - `tests/chatBox.test.ts` (5 tests); `tests/talk.test.ts` gains the `describe` "the chat box's actions (talk/act)" (6 tests).

What else the HUD shows while the box is open: the talk panel freezes the game, and `ContextHint` already hides itself while `selectIsFrozen(state)`, so the hint never sits under or over the box. The zone chip (only while the zone marker is selected) stays between the box and the hotbar, in the same column, so it stacks and never overlaps. Toasts stay top-left and keep telling the truth. Nothing else needs hiding.

- [ ] **Step 1: Write the failing tests**

Create `tests/chatBox.test.ts`:

```ts
/**
 * The chat box's pure parts (farmclaws part 4a spec §3.2): what it shows for the open talk panel
 * and when it takes the phone layout. The test environment is node, so the box itself (its place
 * above the hotbar, the buttons, Close, the phone layout) is checked in the browser playbook, as
 * for the robot screen.
 */
import { describe, expect, it } from 'vitest';
import { ROBOT_SCREEN } from '../src/config';
import { Direction, NPC_IDS, type GameState, type NpcId } from '../src/core/types';
import { npcSpot } from '../src/people/cast';
import { lineFor } from '../src/people/lines';
import { actions } from '../src/state/actions';
import { gameReducer } from '../src/state/reducer';
import { chatBoxView, isPhoneWidth } from '../src/ui/chatBoxView';
import { BASE, must, withPlayer } from './testUtils';

/** Names and role lines, verbatim from spec §2.1. */
const SPEC_CAST: Readonly<Record<NpcId, readonly [string, string]>> = {
  sol: ['Sol', 'Parts exchange'],
  cosmo: ['Cosmo', 'Farmer'],
  barnaby: ['Barnaby', 'Farmer'],
  marigold: ['Marigold', 'General store'],
  bram: ['Bram', 'Blacksmith'],
  juniper: ['Juniper', 'Carpenter'],
  tess: ['Tess', 'Ranch'],
};

/** BASE with the talk panel open on `npc`, carrying `line`. */
const talkingTo = (npc: NpcId, line = 'Lovely weather.'): GameState => ({
  ...BASE,
  ui: { ...BASE.ui, panel: { kind: 'talk', npc, line } },
});

/** BASE with the player in town on the tile south of Marigold, facing her (she faces south). */
function facingMarigold(): GameState {
  const { mapId, placement } = must(npcSpot('marigold'));
  return withPlayer(BASE, { tx: placement.tx, tz: placement.tz + 1 }, Direction.North, mapId);
}

describe('chatBoxView', () => {
  it('is null unless the talk panel is open', () => {
    expect(chatBoxView(BASE)).toBeNull();
    const shop: GameState = { ...BASE, ui: { ...BASE.ui, panel: { kind: 'shop' } } };
    const inventory: GameState = { ...BASE, ui: { ...BASE.ui, panel: { kind: 'inventory' } } };
    const paused: GameState = { ...BASE, ui: { ...BASE.ui, paused: true } };
    expect(chatBoxView(shop)).toBeNull();
    expect(chatBoxView(inventory)).toBeNull();
    expect(chatBoxView(paused)).toBeNull();
  });

  it("shows Marigold's name, her role line, the panel's line and her Shop button", () => {
    expect(chatBoxView(talkingTo('marigold'))).toEqual({
      npc: 'marigold',
      name: 'Marigold',
      role: 'General store',
      line: 'Lovely weather.',
      actions: [{ kind: 'shop', label: 'Shop' }],
    });
  });

  it("shows every character's name and role line, with buttons only for Marigold", () => {
    for (const npc of NPC_IDS) {
      const view = must(chatBoxView(talkingTo(npc)));
      expect(view.npc).toBe(npc);
      expect([view.name, view.role]).toEqual(SPEC_CAST[npc]);
      expect(view.actions).toEqual(npc === 'marigold' ? [{ kind: 'shop', label: 'Shop' }] : []);
    }
  });

  it('shows the line the talk panel carries, picked before the chat was recorded', () => {
    const intro = "Welcome! I'm Marigold. Seeds, fertiliser, a bigger backpack one day. Shop with me any time.";
    const talking = gameReducer(facingMarigold(), actions.interact());
    expect(must(chatBoxView(talking)).line).toBe(intro);
    // The chat is recorded now, so a fresh pick would no longer be the introduction.
    expect(lineFor(talking, 'marigold')).not.toBe(intro);
  });
});

describe('isPhoneWidth', () => {
  it('is true below ROBOT_SCREEN.phoneMaxWidth, as for the robot screen', () => {
    expect(isPhoneWidth(ROBOT_SCREEN.phoneMaxWidth - 1)).toBe(true);
    expect(isPhoneWidth(ROBOT_SCREEN.phoneMaxWidth)).toBe(false);
    expect(isPhoneWidth(390)).toBe(true);
    expect(isPhoneWidth(1280)).toBe(false);
  });
});
```

Append to the end of `tests/talk.test.ts` (Task 6's file):

```ts
describe("the chat box's actions (talk/act)", () => {
  /** BASE with the talk panel open on `npc`, paused or not. */
  const talkingTo = (npc: NpcId, paused = false): GameState => ({
    ...BASE,
    ui: { ...BASE.ui, panel: { kind: 'talk', npc, line: 'Lovely weather.' }, paused },
  });
  const shopFor = (state: GameState, npc: NpcId): GameState => gameReducer(state, actions.npcAct(npc, 'shop'));

  it("Marigold's Shop swaps the talk panel for the seed shop and changes nothing else", () => {
    const state = talkingTo('marigold');
    const next = shopFor(state, 'marigold');
    expect(next.ui).toEqual({ ...state.ui, panel: { kind: 'shop' } });
    expect(next.npcs).toBe(state.npcs);
    expect(next.player).toBe(state.player);
    expect(next.inventory).toBe(state.inventory);
    expect(next.time).toBe(state.time);
    expect(next.messages).toBe(state.messages);
  });

  it('opens the shop from a real chat with Marigold, and the shop closes as usual', () => {
    const { mapId, placement } = must(npcSpot('marigold'));
    const before = withPlayer(BASE, { tx: placement.tx, tz: placement.tz + 1 }, Direction.North, mapId);
    const talking = gameReducer(before, actions.interact());
    expect(talking.ui.panel.kind).toBe('talk');
    const shopping = shopFor(talking, 'marigold');
    expect(shopping.ui.panel).toEqual({ kind: 'shop' });
    expect(shopping.npcs).toBe(talking.npcs);
    expect(gameReducer(shopping, actions.setShopOpen(false)).ui.panel).toEqual({ kind: 'none' });
  });

  it('does nothing when the talk panel is open on someone else', () => {
    const state = talkingTo('bram');
    expect(shopFor(state, 'marigold')).toBe(state);
  });

  it('does nothing without a talk panel', () => {
    expect(shopFor(BASE, 'marigold')).toBe(BASE);
    const shop: GameState = { ...BASE, ui: { ...BASE.ui, panel: { kind: 'shop' } } };
    expect(shopFor(shop, 'marigold')).toBe(shop);
  });

  it("does nothing for an action the character doesn't have", () => {
    for (const npc of NPC_IDS) {
      if (npc === 'marigold') continue;
      const state = talkingTo(npc);
      expect(shopFor(state, npc)).toBe(state);
    }
  });

  it('does nothing while paused', () => {
    const state = talkingTo('marigold', true);
    expect(shopFor(state, 'marigold')).toBe(state);
  });
});
```

The block uses these names; add each one the file doesn't already import, to its existing import line from the same module (or as a new line among the imports when there is none):

- `Direction`, `NPC_IDS`, `type GameState`, `type NpcId` from `'../src/core/types'`. With no such line yet, add `import { Direction, NPC_IDS, type GameState, type NpcId } from '../src/core/types';`.
- `npcSpot` from `'../src/people/cast'`. With no such line yet, add `import { npcSpot } from '../src/people/cast';`.
- `BASE`, `must`, `withPlayer` from `'./testUtils'`, `gameReducer` and `actions`: Task 6 already imports them.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run tests/chatBox.test.ts tests/talk.test.ts`
Expected: FAIL.
- `tests/chatBox.test.ts` doesn't load: `Failed to resolve import "../src/ui/chatBoxView"` (the module doesn't exist yet), so none of its 5 tests runs.
- `tests/talk.test.ts`: Task 6's cases pass; the 6 new cases fail with `TypeError: actions.npcAct is not a function` (the action creator doesn't exist yet; the real-chat case gets as far as the talk panel first).

- [ ] **Step 3: Implement**

**3a. `src/state/actions.ts`.** Replace:

```ts
import type { CraftingRecipeId, Direction, GameState, MdCard, MessageTone, RobotProgram, SeedItemId, SlotRef } from '../core/types';
```

with:

```ts
import type {
  CraftingRecipeId,
  Direction,
  GameState,
  MdCard,
  MessageTone,
  NpcActionKind,
  NpcId,
  RobotProgram,
  SeedItemId,
  SlotRef,
} from '../core/types';
```

Replace the end of `GameAction`:

```ts
  /** Paints the robot on the workbench ROBOT_PAINTS[paint] (part 3 spec §3.4). */
  | { readonly type: 'robot/paint'; readonly robotId: number; readonly paint: number };
```

with:

```ts
  /** Paints the robot on the workbench ROBOT_PAINTS[paint] (part 3 spec §3.4). */
  | { readonly type: 'robot/paint'; readonly robotId: number; readonly paint: number }
  /** An action button in the chat box, e.g. Marigold's Shop (farmclaws part 4a spec §3.2). */
  | { readonly type: 'talk/act'; readonly npc: NpcId; readonly act: NpcActionKind };
```

Replace the end of `actions`:

```ts
  paintRobot: (robotId: number, paint: number): GameAction => ({ type: 'robot/paint', robotId, paint }),
} as const;
```

with:

```ts
  paintRobot: (robotId: number, paint: number): GameAction => ({ type: 'robot/paint', robotId, paint }),
  npcAct: (npc: NpcId, act: NpcActionKind): GameAction => ({ type: 'talk/act', npc, act }),
} as const;
```

**3b. `src/state/reducer.ts`.** In the `../core/types` import, replace:

```ts
  type ItemStack,
  type PlaceableItemId,
```

with:

```ts
  type ItemStack,
  type NpcActionKind,
  type NpcId,
  type PlaceableItemId,
```

(If Task 6 already added `type NpcId` to this import, add only `type NpcActionKind`.)

Task 2 added `import { npcAt } from '../people/cast';` for `movePlayer`. Replace it with:

```ts
import { npcActions, npcAt } from '../people/cast';
```

(If that import names more than `npcAt`, add `npcActions` to it in alphabetical order instead.)

In `reduceAction`, replace:

```ts
    case 'robot/paint':
      return paintRobot(state, action.robotId, action.paint);
    default: {
```

with:

```ts
    case 'robot/paint':
      return paintRobot(state, action.robotId, action.paint);
    case 'talk/act':
      return talkAct(state, action.npc, action.act);
    default: {
```

Insert directly above the doc comment of `loadState` (`/** Replaces the whole state (new game / loaded save): …`), after the closing `}` of `paintRobot`:

```ts
// ---------------------------------------------------------------------------
// The chat box (farmclaws part 4a spec §3.2)
// ---------------------------------------------------------------------------

/**
 * `talk/act`: an action button in the chat box. It acts only while the talk panel is open on
 * `npc`, the game isn't paused and `act` is one of `npcActions(npc)`; anything else changes
 * nothing. The Shop swaps the talk panel for the seed shop in one step. Parts 4b and 4c add a
 * case per new action kind.
 */
function talkAct(state: GameState, npc: NpcId, act: NpcActionKind): GameState {
  const panel = state.ui.panel;
  if (panel.kind !== 'talk' || panel.npc !== npc || state.ui.paused) return state;
  if (!npcActions(npc).some((action) => action.kind === act)) return state;
  switch (act) {
    case 'shop':
      return { ...state, ui: { ...state.ui, panel: { kind: 'shop' } } };
    default: {
      const unknown: never = act;
      void unknown;
      return state;
    }
  }
}

```

**3c. `src/ui/chatBoxView.ts`.** Create:

```ts
/**
 * The chat box's pure parts (farmclaws part 4a spec §3.2): what it shows for the open talk panel,
 * and when it takes its phone layout. ChatBox.ts draws it; the tests read it without a DOM.
 * The robot screen's phoneQuery lives in its lazy chunk, so the width rule is restated here
 * from the same ROBOT_SCREEN.phoneMaxWidth.
 */
import { ROBOT_SCREEN } from '../config';
import type { GameState, NpcId } from '../core/types';
import { CAST, npcActions, type NpcAction } from '../people/cast';

/** What the chat box shows: who is talking, their role line, their line and their action buttons. */
export interface ChatBoxView {
  readonly npc: NpcId;
  readonly name: string;
  readonly role: string;
  readonly line: string;
  readonly actions: readonly NpcAction[];
}

/**
 * The chat box for the open talk panel, or null when no talk panel is open. The line is the one
 * the panel carries, picked before the chat was recorded, so it never changes while the box is open.
 */
export function chatBoxView(state: GameState): ChatBoxView | null {
  const panel = state.ui.panel;
  if (panel.kind !== 'talk') return null;
  const member = CAST[panel.npc];
  return { npc: panel.npc, name: member.name, role: member.role, line: panel.line, actions: npcActions(panel.npc) };
}

/** True below ROBOT_SCREEN.phoneMaxWidth, where the box spans the screen and its buttons wrap. */
export function isPhoneWidth(width: number): boolean {
  return width < ROBOT_SCREEN.phoneMaxWidth;
}
```

**3d. `src/ui/ChatBox.ts`.** Create:

```ts
/**
 * The chat box (farmclaws part 4a spec §3.2): while the talk panel is open, a panel along the
 * bottom of the screen, above the hotbar, with the character's name, their role line under it in
 * smaller text, the line the talk panel carries and a row of action buttons. Close sits at the
 * top right.
 *
 * - `sync(state, prev)` redraws only when `ui.panel` changes. What it shows comes from the pure
 *   chatBoxView, so the line is never picked again while the box is open.
 * - An action button dispatches `talk/act` for the character shown; Close dispatches
 *   `ui/closePanel`. E, K, Enter and Escape close the box through panelKeyCommand. Buttons blur
 *   after mouse clicks but keep focus on keyboard activation, like the modals' buttons.
 * - Narrower than ROBOT_SCREEN.phoneMaxWidth (isPhoneWidth) the box takes the chat-box--phone
 *   modifier: it spans the screen and its buttons wrap. The width is read again on every resize.
 * - The context hint hides while any panel is open, so nothing else sits where the box does.
 * - Text is written with textContent only; every listener uses the HUD's AbortSignal.
 */
import type { GameState } from '../core/types';
import { actions, type GameAction } from '../state/actions';
import { chatBoxView, isPhoneWidth, type ChatBoxView } from './chatBoxView';
import { closestWithin, h, hudButton, releasePointerFocus, setHidden, setText } from './dom';

/** What the chat box needs from the HUD's shared context. */
export interface ChatBoxContext {
  readonly dispatch: (action: GameAction) => void;
  /** Aborted when the HUD is disposed. */
  readonly signal: AbortSignal;
  /** Unique prefix for element ids (aria-labelledby). */
  readonly idPrefix: string;
}

export class ChatBox {
  readonly element = h('section', 'hud-panel chat-box');
  private readonly name = h('h2', 'chat-box__name');
  private readonly role = h('p', 'chat-box__role');
  private readonly line = h('p', 'chat-box__line');
  private readonly buttons = h('div', 'chat-box__actions');
  /** What the box shows now; null while it's hidden. */
  private shown: ChatBoxView | null = null;

  constructor(context: ChatBoxContext) {
    const nameId = `${context.idPrefix}-chat-name`;
    this.element.hidden = true;
    this.element.setAttribute('role', 'dialog');
    this.element.setAttribute('aria-labelledby', nameId);
    this.name.id = nameId;

    const heading = h('header', 'chat-box__heading');
    heading.append(this.name, this.role);
    const close = hudButton('hud-btn hud-btn--ghost chat-box__close', 'Close');
    close.title = 'Close (E / Esc)';
    this.element.append(heading, close, this.line, this.buttons);

    const signal = context.signal;
    close.addEventListener(
      'click',
      (event) => {
        releasePointerFocus(close, event);
        context.dispatch(actions.closePanel());
      },
      { signal },
    );
    this.buttons.addEventListener(
      'click',
      (event) => {
        const button = closestWithin(event, this.buttons, 'button[data-index]');
        const view = this.shown;
        if (button === null || view === null) return;
        releasePointerFocus(button, event);
        const action = view.actions[Number(button.dataset.index)];
        if (action !== undefined) context.dispatch(actions.npcAct(view.npc, action.kind));
      },
      { signal },
    );

    const syncWidth = (): void => {
      this.element.classList.toggle('chat-box--phone', isPhoneWidth(window.innerWidth));
    };
    syncWidth();
    window.addEventListener('resize', syncWidth, { signal });
  }

  sync(state: GameState, prev: GameState | null): void {
    if (prev !== null && state.ui.panel === prev.ui.panel) return;
    const view = chatBoxView(state);
    this.shown = view;
    setHidden(this.element, view === null);
    if (view === null) return;
    setText(this.name, view.name);
    setText(this.role, view.role);
    setText(this.line, view.line);
    this.buttons.replaceChildren(
      ...view.actions.map((action, index) => {
        const button = hudButton('hud-btn hud-btn--primary chat-box__action', action.label);
        button.dataset.index = String(index);
        return button;
      }),
    );
    setHidden(this.buttons, view.actions.length === 0);
  }
}
```

**3e. `src/ui/Hud.ts`.** In the header comment, replace:

```ts
 *   bottom-centre  context hint ("Space: Till", "E: Harvest") above the 12-slot hotbar
```

with:

```ts
 *   bottom-centre  the chat box while talking (ChatBox.ts), then the context hint ("Space: Till",
 *                  "E: Harvest") above the 12-slot hotbar
```

Replace:

```ts
import { weatherLabel } from '../time/weather';
import {
  clamp01,
```

with:

```ts
import { weatherLabel } from '../time/weather';
import { ChatBox } from './ChatBox';
import {
  clamp01,
```

In the `Hud` class fields, replace:

```ts
  private readonly zoneChip: ZoneChip;
  private readonly toasts: ToastStack;
```

with:

```ts
  private readonly zoneChip: ZoneChip;
  private readonly chat: ChatBox;
  private readonly toasts: ToastStack;
```

In the constructor, replace:

```ts
    this.zoneChip = new ZoneChip();
    this.toasts = new ToastStack();
```

with:

```ts
    this.zoneChip = new ZoneChip();
    this.chat = new ChatBox(context);
    this.toasts = new ToastStack();
```

and replace:

```ts
    center.append(this.hint.element, this.zoneChip.element, this.hotbar.element);
```

with:

```ts
    center.append(this.chat.element, this.hint.element, this.zoneChip.element, this.hotbar.element);
```

In `sync`, replace:

```ts
    this.zoneChip.sync(state, prev);
    this.toasts.sync(state, prev);
```

with:

```ts
    this.zoneChip.sync(state, prev);
    this.chat.sync(state, prev);
    this.toasts.sync(state, prev);
```

(`HudContext` has `dispatch`, `signal` and `idPrefix`, so it is a `ChatBoxContext` as it stands.)

**3f. `src/ui/hud.css`.** Insert directly above the section header

```css
/* -------------------------------------------------------------------------------------------
 * Modals (shop, pause)
```

the new section:

```css
/* -------------------------------------------------------------------------------------------
 * Chat box (ChatBox.ts, farmclaws part 4a spec §3.2): first in the bottom-centre column, so it
 * sits just above the hotbar while the talk panel is open (the hint hides then). The phone
 * modifier spans the screen from gutter to gutter, over the energy bar's column on narrow
 * screens, and lets the buttons wrap.
 * ----------------------------------------------------------------------------------------- */

.chat-box {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  grid-template-areas:
    'heading close'
    'line line'
    'actions actions';
  align-items: start;
  gap: 8px 12px;
  width: min(560px, 100%);
  padding: 12px 14px 14px 16px;
  pointer-events: auto;
  animation: hud-pop-in 0.22s ease-out backwards;
}

.chat-box__heading {
  grid-area: heading;
  display: grid;
  gap: 1px;
  min-width: 0;
}

.chat-box__name {
  color: var(--hud-ink);
  font-size: 18px;
  font-weight: 700;
  line-height: 1.15;
}

.chat-box__role {
  color: var(--hud-ink-soft);
  font-size: 12px;
  font-weight: 600;
}

.chat-box__close {
  grid-area: close;
  min-height: 30px;
  padding: 3px 12px 2px;
}

.chat-box__line {
  grid-area: line;
  padding: 9px 12px;
  border: 2px solid var(--hud-line);
  border-radius: var(--hud-radius-sm);
  background: var(--hud-parchment);
  font-size: 15px;
  font-weight: 500;
  line-height: 1.4;
  overflow-wrap: anywhere;
}

.chat-box__actions {
  grid-area: actions;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.chat-box--phone {
  align-self: flex-start;
  width: calc(100vw - 2 * var(--hud-gutter));
}

.chat-box--phone .chat-box__actions {
  flex-wrap: wrap;
}

.chat-box--phone .chat-box__action {
  flex: 1 1 auto;
}

```

In the reduced-motion block, replace:

```css
  .hud-toast,
  .hud-modal__card,
```

with:

```css
  .hud-toast,
  .hud-modal__card,
  .chat-box,
```

(Why this layout: the bottom-centre column already stacks the hint, the zone chip and the hotbar and grows upward, so a box placed first in it sits just above the hotbar whatever height the hotbar has, one row or the narrow two. Under 720px that column is the bottom grid's left column, starting at the left gutter, so the phone modifier's `align-self: flex-start` plus a gutter-to-gutter width spans the screen; `z-index: 1` keeps it over the energy bar, which follows it in the DOM. `.hud-btn` keeps `white-space: nowrap`, so wrapping is per button, never inside a label.)

- [ ] **Step 4: Run them and see them pass**

Run: `npx vitest run tests/chatBox.test.ts tests/talk.test.ts tests/panelKeys.test.ts tests/reducer.test.ts`
Expected: PASS (`chatBox.test.ts`: 5 tests; `talk.test.ts`: Task 6's cases plus 6).

- [ ] **Step 5: The full gate**

Run: `npm run typecheck && npm test && npm run build`
Expected: all green, with one more test file than after Task 6. Then run `npm run build:check` (this task adds main-chunk imports to the HUD): the main chunk stays within its budget and the dev-hook grep finds nothing (`talk/act` and `npcAct` contain none of the dev-hook words).

- [ ] **Step 6: Browser check**

Use the `game-driven-qa` skill: `preview_start {name: "meadowlight-dev"}`, navigate to `http://localhost:5173/?new`, load the probe (`await import('/.claude/skills/game-driven-qa/probe.js?t=' + Date.now()); __qa.snap()`). Then, in `javascript_tool`:

1. Hold time still and stand in front of Marigold (town (7, 8), facing north):
   ```js
   __meadowlight.store.dispatch(__meadowlight.actions.setTimeScale(1));
   __qa.patch((s) => { s.player.mapId = 'town'; s.player.tx = 7; s.player.tz = 8; s.player.facing = 0; });
   await __qa.key('KeyE');
   [__qa.state().ui.panel, document.querySelector('.chat-box').hidden, document.querySelector('.hud-hint').hidden, document.querySelector('.chat-box').innerText]
   ```
   PASS when the panel is `{ kind: 'talk', npc: 'marigold', line: "Welcome! I'm Marigold. Seeds, fertiliser, a bigger backpack one day. Shop with me any time." }`, the box is visible (`false`), the hint is hidden (`true`), and the text holds "Marigold", "General store", the introduction, "Shop" and "Close". Screenshot: the box sits centred just above the hotbar, the role line smaller under the name, Close at the top right.
2. Click "Close" (`find` "Close", then `computer left_click`): `__qa.state().ui.panel.kind === 'none'` and the box is hidden. `await __qa.key('KeyE')`: the box shows again with a line that isn't the introduction. `await __qa.key('Enter')`, then E and `await __qa.key('Escape')`, then E and `await __qa.key('KeyK')`: each closes it (`ui.panel.kind` is `'none'` and `ui.paused` stays `false`).
3. E, then click "Shop": `__qa.state().ui.panel` is `{ kind: 'shop' }`, the seed shop shows and the chat box is hidden. Click a "×1" buy button: the gold drops by the packet's price. `await __qa.key('Escape')` closes the shop.
4. Bram has no buttons: `__qa.patch((s) => { s.player.tx = 16; s.player.tz = 8; s.player.facing = 0; }); await __qa.key('KeyE'); [document.querySelector('.chat-box').innerText, document.querySelector('.chat-box__actions').hidden]` → the text holds "Bram" and "Blacksmith", and the actions row is hidden (`true`). Escape.
5. Phone: `resize_window {preset: "mobile"}`, reload without `?new`, load the probe, repeat check 1's patch and E. `document.querySelector('.chat-box').classList.contains('chat-box--phone')` is `true`, and its `getBoundingClientRect().width` is `innerWidth - 32` (the two 16px gutters). Screenshot: the box spans the screen above the two-row hotbar, the Shop button fills its row. `resize_window {preset: "desktop"}`: the class is gone without a reload (the resize listener).
6. `read_console_messages {onlyErrors: true}` shows nothing.

Report one line per check (PASS / FAIL with the evidence).

- [ ] **Step 7: Commit**

```bash
git add src/state/actions.ts src/state/reducer.ts src/ui/chatBoxView.ts src/ui/ChatBox.ts src/ui/Hud.ts src/ui/hud.css tests/chatBox.test.ts tests/talk.test.ts
git commit -m "Farmclaws part 4a: the chat box, with Marigold's Shop

E on a character now shows a chat box above the hotbar: name, role line,
the line the talk panel carries, and the character's action buttons, with
Close at the top right. Under the robot screen's phone width it spans the
screen and the buttons wrap. Shop is one talk/act action that checks the
talk panel is open on that character and the action is theirs, then swaps
the panel for the seed shop, so the game never unfreezes in between. The
reducer switches over the action kind, so parts 4b and 4c add theirs as
cases. The view is a pure function, tested in node; the DOM is checked in
the browser.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: The characters on screen

**Files:**
- Create: `src/render/npcProps.ts`, `src/render/nameplates.ts`, `src/render/NpcRenderer.ts`
- Modify: `src/config.ts` (`APPEARANCE`'s doc comment and its `hats` comment, ~lines 218–227; new `NPC_LOOKS` directly after it)
- Modify: `src/core/types.ts` (`Appearance.hairStyle` and `Appearance.hat` doc comments, ~lines 955 and 963)
- Modify: `src/render/palette.ts` (new `APPEARANCE_PALETTES` after `PALETTE`, end of file, ~line 50)
- Modify: `src/render/playerModel.ts` (module header ~lines 10–12; imports ~lines 34–36; colours ~lines 68–76; a new "Looks" section above "Geometry baking", ~line 99; `Part` ~line 106 and `bakeParts` ~lines 142–147 exported; the body segments ~lines 191–260; `PlayerModel`'s doc comment ~line 437, constructor ~lines 460–490)
- Modify: `src/render/PlayerRenderer.ts` (new `EMPTY_HANDED_POSE` after `CARRY_POSES`, ~line 159)
- Modify: `src/main.ts` (import ~line 25; `systems` ~line 88)
- Test: `tests/npcRender.test.ts` (create)

**Interfaces:**
- Consumes:
  - Task 1: `NPC_IDS = ['sol', 'cosmo', 'barnaby', 'marigold', 'bram', 'juniper', 'tess']`, `NpcId`.
  - Task 2: `src/people/cast.ts`: `CAST` (`name`), `CAST_LOOKS: Readonly<Record<NpcId, CastLook>>`, `CastLook { appearance: Appearance; prop: NpcProp }`, `NPC_PROPS`, `NpcProp`, `npcAt(mapId, tx, tz)`; `src/world/maps/types.ts`: `NpcPlacement { id; tx; tz; facing }`, `MapDefinition.npcs`.
  - Task 4: `'neighbours'` in `MAP_IDS`, `MAPS.neighbours` with Cosmo (7, 13) and Barnaby (25, 15); every id placed on exactly one map; `BASE.maps.neighbours`.
  - Task 6: `UiPanel` `{ kind: 'talk'; npc: NpcId; line: string }` (any panel freezes: `selectIsFrozen`).
  - Existing: `PlayerModel`, `applyPose`, `copyPose`, `createPose`, `type Pose` (`playerModel.ts`); `playerGroundHeight`, `playerRootHeight`, `playerBlobLocalHeight`, `CARRY_POSES` (`PlayerRenderer.ts`); `createFlatMaterial`; `at` and `mergeParts` (`geometryParts.ts`); `PALETTE.player`; `APPEARANCE` (config); `Appearance` (types); `selectActiveMapId`, `selectIsFrozen`, `selectTargetTile`; `directionYaw`, `tileCenterX`, `tileCenterZ`, `DIRECTION_STEPS`; `getMap`, `MAPS`; `getTile`, `isWalkable`; `RenderSystem`, `FrameContext`; the render-system contract (`sync(state, null)` on startup, a load and every map change; `prev` non-null only on the same map). Test helpers `BASE`, `must`, `withPlayer`.
- Produces:
  - `src/config.ts`: `export const NPC_LOOKS = { swaySeconds: 3.2, swayDegrees: 2.5, nameplateHeight: 1.5, nameplateScale: 0.36 } as const`. `APPEARANCE`'s comments say what index 0 of each list is.
  - `src/render/palette.ts`: `export const APPEARANCE_PALETTES` with `skin` (5), `hair` (6), `shirt` (8) and `overalls` (6) colour lists, sized exactly by `APPEARANCE`; index 0 of each is `PALETTE.player`'s colour (R13).
  - `src/render/playerModel.ts`: `new PlayerModel(appearance: Appearance = DEFAULT_APPEARANCE)` (throws a `RangeError` for an index outside its list); `export const HAIR_STYLES = { short: 0, ponytail: 1, bob: 2 } as const`; `export const HAT_STYLES = { straw: 0, none: 1, cap: 2, knit: 3 } as const`; `export const DEFAULT_APPEARANCE: Appearance` (all zeros: today's farmer, short hair under the straw hat). `export interface Part` and `export function bakeParts` (for the props). The `hips`, `torso` and `head` bones are named `'hips'`, `'torso'`, `'head'`. The default model's geometry is unchanged (pinned by a fingerprint).
  - `src/render/PlayerRenderer.ts`: `export const EMPTY_HANDED_POSE: Readonly<Pose>` (the player's empty-handed rest pose).
  - `src/render/npcProps.ts`: `export type PropBone = 'head' | 'torso' | 'hips'`; `export const NPC_PROP_BONES: Readonly<Record<NpcProp, PropBone>>`; `export const NPC_PROP_POSES` (the clipboard's held left arm); `export function createNpcPropGeometry(prop: NpcProp): THREE.BufferGeometry` (vertex-coloured, in the local space of its bone, see the coordinator notes); `export function modelAppearance(look: CastLook): Appearance` (Cosmo's feathered straw hat replaces his own hat).
  - `src/render/nameplates.ts`: `export const NAMEPLATE_CANVAS = { width: 256, height: 64 } as const`; `export const NAMEPLATE_ASPECT`; `export interface PlateRect`; `export function nameplateRect(textWidth: number): PlateRect` (pure); `export function createNameplateTexture(name: string): THREE.CanvasTexture`.
  - `src/render/NpcRenderer.ts`: `export class NpcRenderer implements RenderSystem` with `constructor(ctx: SceneContext, makeNameplate: NameplateFactory = createNameplateTexture)`; `export type NameplateFactory = (name: string) => THREE.Texture`; `export function nameplateFor(state: GameState): NpcId | null`; `export function swayAngle(elapsedSeconds: number, npcIndex: number): number`. Character roots are named `npc-{id}`, groups `npcs-{mapId}`, plates `nameplate-{id}`, props `prop-{prop}`.
  - `src/main.ts`: `new NpcRenderer(ctx)` in `systems`, after the robot renderer.
  - `tests/npcRender.test.ts` (26 tests). Task 9 adds its cases here.

- [ ] **Step 1: Write the failing test**

Create `tests/npcRender.test.ts`:

```ts
/**
 * The characters on screen (farmclaws part 4a spec §2.3, refinement R13): the appearance
 * palettes and the player's model built from an Appearance, the cast's props, the idle sway, the
 * nameplate rule and layout, and NpcRenderer standing each map's characters on their spots.
 * three's geometry and scene graph run in node; a canvas doesn't, so the renderer gets stand-in
 * nameplate textures here and the plates themselves are checked in the browser playbook.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { APPEARANCE, NPC_LOOKS } from '../src/config';
import { DIRECTIONS, Direction, MAP_IDS, NPC_IDS, type GameState, type MapId } from '../src/core/types';
import { CAST, CAST_LOOKS, NPC_PROPS, npcAt } from '../src/people/cast';
import { NAMEPLATE_CANVAS, nameplateRect } from '../src/render/nameplates';
import { NpcRenderer, nameplateFor, swayAngle } from '../src/render/NpcRenderer';
import { NPC_PROP_BONES, createNpcPropGeometry, modelAppearance } from '../src/render/npcProps';
import { APPEARANCE_PALETTES } from '../src/render/palette';
import { DEFAULT_APPEARANCE, HAIR_STYLES, HAT_STYLES, PlayerModel } from '../src/render/playerModel';
import { playerGroundHeight, playerRootHeight } from '../src/render/PlayerRenderer';
import type { SceneContext } from '../src/render/SceneContext';
import type { FrameContext } from '../src/render/types';
import { DIRECTION_STEPS, directionYaw, tileCenterX, tileCenterZ } from '../src/world/grid';
import { MAPS } from '../src/world/maps';
import type { NpcPlacement } from '../src/world/maps/types';
import { getTile, isWalkable } from '../src/world/tiles';
import { BASE, must, withPlayer } from './testUtils';

/** `state` with the player on `mapId`, on a free tile next to (tx, tz) and facing it. */
function facing(state: GameState, mapId: MapId, tx: number, tz: number): GameState {
  for (const direction of DIRECTIONS) {
    const step = DIRECTION_STEPS[direction];
    const stand = { tx: tx - step.dx, tz: tz - step.dz };
    const tile = getTile(state.maps[mapId], stand.tx, stand.tz);
    if (tile !== null && isWalkable(tile) && npcAt(mapId, stand.tx, stand.tz) === null) return withPlayer(state, stand, direction, mapId);
  }
  throw new Error(`facing: no free tile next to (${tx}, ${tz}) on ${mapId}`);
}

/** Every map's placements, with the map they stand on. */
const PLACED: readonly (readonly [MapId, NpcPlacement])[] = MAP_IDS.flatMap((mapId) => MAPS[mapId].npcs.map((p) => [mapId, p] as const));

function placementOf(npc: string): readonly [MapId, NpcPlacement] {
  return must(PLACED.find(([, p]) => p.id === npc), `${npc} is placed nowhere`);
}

const [, SOL] = placementOf('sol');
const [, COSMO] = placementOf('cosmo');
/** In town, facing Sol. */
const AT_SOL = facing(BASE, 'town', SOL.tx, SOL.tz);
/** In town on the square, facing an empty tile. */
const TOWN = withPlayer(BASE, { tx: 21, tz: 10 }, Direction.South, 'town');
/** On the Neighbours map, facing Cosmo. */
const AT_COSMO = facing(BASE, 'neighbours', COSMO.tx, COSMO.tz);

const frozenBy = (state: GameState, ui: Partial<GameState['ui']>): GameState => ({ ...state, ui: { ...state.ui, ...ui } });

/** Mesh count, position sum and colour sum of a merged segment: a fingerprint of its geometry. */
function fingerprint(object: THREE.Object3D | undefined): readonly [number, number, number] {
  if (!(object instanceof THREE.Mesh)) throw new Error('fingerprint: not a mesh');
  const geometry: THREE.BufferGeometry = object.geometry;
  const sum = (name: string): number => Array.from(geometry.getAttribute(name).array).reduce((total, value) => total + value, 0);
  return [geometry.getAttribute('position').count, sum('position'), sum('color')];
}

function headVertices(model: PlayerModel): number {
  return fingerprint(model.head.children[0])[0];
}

/** True when `object` and every parent up to the scene are visible. */
function isShown(object: THREE.Object3D): boolean {
  for (let node: THREE.Object3D | null = object; node !== null; node = node.parent) {
    if (!node.visible) return false;
  }
  return true;
}

function meshCount(object: THREE.Object3D): number {
  let count = 0;
  object.traverse((node) => {
    if (node instanceof THREE.Mesh) count++;
  });
  return count;
}

/** A renderer on a bare scene, with stand-in nameplate textures that record the names drawn. */
function standUp(): { readonly renderer: NpcRenderer; readonly scene: THREE.Scene; readonly drawn: string[] } {
  const scene = new THREE.Scene();
  const drawn: string[] = [];
  const renderer = new NpcRenderer({ scene } as unknown as SceneContext, (name) => {
    drawn.push(name);
    return new THREE.Texture();
  });
  return { renderer, scene, drawn };
}

const frame = (state: GameState, elapsed: number): FrameContext => ({ dt: 1 / 60, elapsed, state, clockMinutes: state.time.minuteOfDay });

describe('appearance palettes (R13)', () => {
  it("holds one colour per APPEARANCE choice, index 0 the player's original colours", () => {
    expect(APPEARANCE_PALETTES.skin).toHaveLength(APPEARANCE.skinTones);
    expect(APPEARANCE_PALETTES.hair).toHaveLength(APPEARANCE.hairColors);
    expect(APPEARANCE_PALETTES.shirt).toHaveLength(APPEARANCE.shirtColors);
    expect(APPEARANCE_PALETTES.overalls).toHaveLength(APPEARANCE.overallsColors);
    expect([APPEARANCE_PALETTES.skin[0], APPEARANCE_PALETTES.hair[0], APPEARANCE_PALETTES.shirt[0], APPEARANCE_PALETTES.overalls[0]]).toEqual([
      0xf6d2b5, 0x7a4e36, 0x7fa7e8, 0x5f7fb8,
    ]);
  });

  it('names every hair style and hat APPEARANCE allows, the original look at 0', () => {
    expect(Object.values(HAIR_STYLES).sort()).toEqual([...Array(APPEARANCE.hairStyles).keys()]);
    expect(Object.values(HAT_STYLES).sort()).toEqual([...Array(APPEARANCE.hats).keys()]);
    expect(HAIR_STYLES.short).toBe(0);
    expect(HAT_STYLES.straw).toBe(0);
    expect(DEFAULT_APPEARANCE).toEqual(BASE.profile.appearance);
  });
});

describe('the player model built from an appearance', () => {
  it('builds the default farmer exactly as before', () => {
    const model = new PlayerModel();
    // Pinned from the model before appearances existed: [vertices, position sum, colour sum].
    const segments: readonly (readonly [THREE.Object3D | undefined, number, number, number])[] = [
      [model.hips.children[0], 72, 2.34, 53.678688],
      [model.torso.children[0], 468, 128.808, 537.790538],
      [model.head.children[0], 996, 233.064, 1427.837215],
      [model.eyes, 72, 11.16, 6.380506],
      [model.rightArm.children[0], 132, -24.96, 245.303348],
      [model.rightLeg.children[0], 144, -35.1, 68.772242],
    ];
    for (const [segment, vertices, positions, colors] of segments) {
      const [count, positionSum, colorSum] = fingerprint(segment);
      expect(count).toBe(vertices);
      expect(positionSum).toBeCloseTo(positions, 4);
      expect(colorSum).toBeCloseTo(colors, 4);
    }
    model.dispose();
  });

  it('builds every hair style and hat, and the last colour of every palette', () => {
    const heads = new Map<string, number>();
    for (let hairStyle = 0; hairStyle < APPEARANCE.hairStyles; hairStyle++) {
      for (let hat = 0; hat < APPEARANCE.hats; hat++) {
        const model = new PlayerModel({ ...DEFAULT_APPEARANCE, hairStyle, hat });
        heads.set(`${hairStyle}/${hat}`, headVertices(model));
        model.dispose();
      }
    }
    const short = HAIR_STYLES.short;
    expect(must(heads.get(`${short}/${HAT_STYLES.none}`))).toBeLessThan(must(heads.get(`${short}/${HAT_STYLES.straw}`)));
    expect(must(heads.get(`${HAIR_STYLES.ponytail}/${HAT_STYLES.none}`))).toBeGreaterThan(must(heads.get(`${short}/${HAT_STYLES.none}`)));
    expect(must(heads.get(`${HAIR_STYLES.bob}/${HAT_STYLES.none}`))).toBeGreaterThan(must(heads.get(`${short}/${HAT_STYLES.none}`)));
    expect(new Set([HAT_STYLES.straw, HAT_STYLES.cap, HAT_STYLES.knit].map((hat) => heads.get(`${short}/${hat}`))).size).toBe(3);
    const last = new PlayerModel({
      skinTone: APPEARANCE.skinTones - 1,
      hairStyle: APPEARANCE.hairStyles - 1,
      hairColor: APPEARANCE.hairColors - 1,
      shirtColor: APPEARANCE.shirtColors - 1,
      overallsColor: APPEARANCE.overallsColors - 1,
      hat: APPEARANCE.hats - 1,
    });
    expect(fingerprint(last.torso.children[0])[2]).not.toBeCloseTo(537.790538, 2);
    last.dispose();
  });

  it('refuses a look past the end of any list', () => {
    expect(() => new PlayerModel({ ...DEFAULT_APPEARANCE, skinTone: APPEARANCE.skinTones })).toThrow(RangeError);
    expect(() => new PlayerModel({ ...DEFAULT_APPEARANCE, hairColor: APPEARANCE.hairColors })).toThrow(RangeError);
    expect(() => new PlayerModel({ ...DEFAULT_APPEARANCE, hairStyle: APPEARANCE.hairStyles })).toThrow(RangeError);
    expect(() => new PlayerModel({ ...DEFAULT_APPEARANCE, hat: APPEARANCE.hats })).toThrow(RangeError);
  });
});

describe("the cast's props", () => {
  it.each(NPC_PROPS)('%s is one non-empty, vertex-coloured geometry the size of a prop', (prop) => {
    const geometry = createNpcPropGeometry(prop);
    const count = geometry.getAttribute('position').count;
    expect(count).toBeGreaterThan(0);
    expect(geometry.getAttribute('color').count).toBe(count);
    geometry.computeBoundingSphere();
    expect(must(geometry.boundingSphere).radius).toBeGreaterThan(0.02);
    expect(must(geometry.boundingSphere).radius).toBeLessThan(0.5);
    geometry.dispose();
  });

  it("wears a hat prop instead of the character's own hat, and leaves every other look alone", () => {
    for (const npc of NPC_IDS) {
      const look = CAST_LOOKS[npc];
      if (look.prop === 'featherHat') {
        expect(modelAppearance(look)).toEqual({ ...look.appearance, hat: HAT_STYLES.none });
      } else {
        expect(modelAppearance(look)).toBe(look.appearance);
      }
    }
    expect(CAST_LOOKS.cosmo.prop).toBe('featherHat');
  });
});

describe('idle sway', () => {
  const amplitude = THREE.MathUtils.degToRad(NPC_LOOKS.swayDegrees);

  it('leans at most swayDegrees each way, reaching it once per swaySeconds', () => {
    for (let index = 0; index < NPC_IDS.length; index++) {
      let widest = 0;
      for (let t = 0; t < NPC_LOOKS.swaySeconds * 2; t += 0.01) {
        const angle = swayAngle(t, index);
        expect(Math.abs(angle)).toBeLessThanOrEqual(amplitude + 1e-12);
        widest = Math.max(widest, Math.abs(angle));
        expect(swayAngle(t + NPC_LOOKS.swaySeconds, index)).toBeCloseTo(angle, 9);
      }
      expect(widest).toBeGreaterThan(amplitude * 0.99);
    }
  });

  it('starts each character its own share of a sway later, so none sways in step with another', () => {
    for (let index = 1; index < NPC_IDS.length; index++) {
      const lead = (index / NPC_IDS.length) * NPC_LOOKS.swaySeconds;
      for (const t of [0, 0.4, 2.1]) expect(swayAngle(t, index)).toBeCloseTo(swayAngle(t + lead, 0), 9);
      expect(swayAngle(0.4, index)).not.toBeCloseTo(swayAngle(0.4, 0), 6);
    }
  });
});

describe('nameplateFor', () => {
  it('names the character on the tile ahead, on every map', () => {
    expect(PLACED).toHaveLength(NPC_IDS.length);
    for (const [mapId, p] of PLACED) expect(nameplateFor(facing(BASE, mapId, p.tx, p.tz)), p.id).toBe(p.id);
  });

  it('shows nothing while the game is frozen: a chat, another panel or the pause menu', () => {
    expect(nameplateFor(frozenBy(AT_SOL, { panel: { kind: 'talk', npc: 'sol', line: 'Hello.' } }))).toBeNull();
    expect(nameplateFor(frozenBy(AT_SOL, { panel: { kind: 'inventory' } }))).toBeNull();
    expect(nameplateFor(frozenBy(AT_SOL, { paused: true }))).toBeNull();
  });

  it('shows nothing with no character ahead', () => {
    expect(nameplateFor(BASE)).toBeNull();
    expect(nameplateFor(TOWN)).toBeNull();
  });

  it('never names a character standing on another map', () => {
    expect(npcAt('town', COSMO.tx, COSMO.tz)).toBeNull();
    expect(nameplateFor(facing(BASE, 'town', COSMO.tx, COSMO.tz))).toBeNull();
  });
});

describe('nameplate layout', () => {
  it('pads the plate round the name and centres it on the canvas', () => {
    const rect = nameplateRect(100);
    expect(rect.width).toBeGreaterThan(100);
    expect(rect.x).toBeCloseTo((NAMEPLATE_CANVAS.width - rect.width) / 2, 9);
    expect(rect.y).toBeGreaterThan(0);
    expect(rect.y + rect.height).toBeLessThan(NAMEPLATE_CANVAS.height);
    expect(nameplateRect(140).width).toBeGreaterThan(rect.width);
  });

  it('never runs past the canvas, however long the name', () => {
    for (const width of [0, 10_000]) {
      const rect = nameplateRect(width);
      expect(rect.width).toBeGreaterThan(0);
      expect(rect.x).toBeGreaterThan(0);
      expect(rect.x + rect.width).toBeLessThan(NAMEPLATE_CANVAS.width);
    }
  });
});

describe('NpcRenderer', () => {
  it('stands each character on its spot, facing its way, its prop on its bone, in ten meshes', () => {
    for (const state of [TOWN, AT_COSMO]) {
      const { renderer, scene } = standUp();
      renderer.sync(state, null);
      const world = state.maps[state.player.mapId];
      for (const p of MAPS[state.player.mapId].npcs) {
        const root = must(scene.getObjectByName(`npc-${p.id}`), p.id);
        expect(isShown(root), p.id).toBe(true);
        expect(root.position.x).toBeCloseTo(tileCenterX(world.grid, p.tx), 9);
        expect(root.position.z).toBeCloseTo(tileCenterZ(world.grid, p.tz), 9);
        expect(root.position.y).toBeCloseTo(playerRootHeight(playerGroundHeight(getTile(world, p.tx, p.tz))), 9);
        expect(root.rotation.y).toBeCloseTo(directionYaw(p.facing), 9);
        const prop = CAST_LOOKS[p.id].prop;
        expect(must(root.getObjectByName(`prop-${prop}`), prop).parent?.name).toBe(NPC_PROP_BONES[prop]);
        expect(meshCount(root)).toBe(10);
      }
      renderer.dispose();
    }
  });

  it("builds a map's characters on its first visit, keeps them, and shows only the active map's", () => {
    const { renderer, scene, drawn } = standUp();
    renderer.sync(BASE, null);
    renderer.sync(TOWN, null);
    expect(scene.getObjectByName('npc-cosmo')).toBeUndefined();
    const sol = must(scene.getObjectByName('npc-sol'));
    renderer.sync(AT_COSMO, null);
    const cosmo = must(scene.getObjectByName('npc-cosmo'));
    expect(isShown(cosmo)).toBe(true);
    expect(isShown(sol)).toBe(false);
    renderer.sync(TOWN, null);
    expect(scene.getObjectByName('npc-sol')).toBe(sol);
    expect(isShown(sol)).toBe(true);
    expect(isShown(cosmo)).toBe(false);
    // Every plate was drawn once, when its character was built.
    expect([...drawn].sort()).toEqual(NPC_IDS.map((id) => CAST[id].name).sort());
    renderer.dispose();
  });

  it("shows the nameplate of the character ahead, only while the game isn't frozen", () => {
    const { renderer, scene } = standUp();
    const plate = (npc: string): THREE.Object3D => must(scene.getObjectByName(`nameplate-${npc}`), npc);
    renderer.sync(TOWN, null);
    for (const p of MAPS.town.npcs) expect(isShown(plate(p.id)), p.id).toBe(false);
    renderer.sync(AT_SOL, TOWN);
    for (const p of MAPS.town.npcs) expect(isShown(plate(p.id)), p.id).toBe(p.id === 'sol');
    expect(plate('sol').position.y).toBe(NPC_LOOKS.nameplateHeight);
    expect(plate('sol').scale.y).toBe(NPC_LOOKS.nameplateScale);
    const chatting = frozenBy(AT_SOL, { panel: { kind: 'talk', npc: 'sol', line: 'Hello.' } });
    renderer.sync(chatting, AT_SOL);
    expect(isShown(plate('sol'))).toBe(false);
    renderer.sync(AT_SOL, chatting);
    expect(isShown(plate('sol'))).toBe(true);
    renderer.sync(TOWN, AT_SOL);
    expect(isShown(plate('sol'))).toBe(false);
    renderer.dispose();
  });

  it("sways each shown character's upper body, out of step", () => {
    const { renderer, scene } = standUp();
    renderer.sync(TOWN, null);
    renderer.update(frame(TOWN, 1.3));
    for (const p of MAPS.town.npcs) {
      const torso = must(must(scene.getObjectByName(`npc-${p.id}`)).getObjectByName('torso'));
      expect(torso.rotation.z, p.id).toBeCloseTo(swayAngle(1.3, NPC_IDS.indexOf(p.id)), 9);
    }
    renderer.dispose();
  });

  it('leaves nothing in the scene once disposed', () => {
    const { renderer, scene } = standUp();
    renderer.sync(TOWN, null);
    renderer.sync(AT_COSMO, null);
    expect(scene.children.length).toBeGreaterThan(0);
    renderer.dispose();
    expect(scene.children).toEqual([]);
  });
});
```

The fingerprint numbers in "builds the default farmer exactly as before" were measured on today's `PlayerModel` (at the spec commit, before this task), so the test pins that the refactor leaves the player's geometry alone.

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run tests/npcRender.test.ts`
Expected: FAIL. The file doesn't load: `Failed to resolve import "../src/render/nameplates"` (or one of the other two new modules, `../src/render/NpcRenderer` and `../src/render/npcProps`, whichever Vite reaches first), so no test runs. Once those exist, `APPEARANCE_PALETTES`, `NPC_LOOKS`, `DEFAULT_APPEARANCE`, `HAIR_STYLES` and `HAT_STYLES` are still missing.

- [ ] **Step 3: Implement**

**3a. `src/config.ts`.** Replace:

```ts
/** Palette sizes for the player's look. Index 0 of every palette is the original look. */
export const APPEARANCE = {
  skinTones: 5,
  hairStyles: 3,
  hairColors: 6,
  shirtColors: 8,
  overallsColors: 6,
  /** Including 0 = no hat. */
  hats: 4,
} as const;
```

with:

```ts
/**
 * The number of choices for each part of a character's look: the colours in render/palette.ts
 * APPEARANCE_PALETTES, the hair styles and hats in render/playerModel.ts HAIR_STYLES and
 * HAT_STYLES. Index 0 of every list is the player's original look.
 */
export const APPEARANCE = {
  skinTones: 5,
  hairStyles: 3,
  hairColors: 6,
  shirtColors: 8,
  overallsColors: 6,
  /** 0 is the straw hat (the original look) and 1 is no hat. */
  hats: 4,
} as const;

/** The characters on screen (farmclaws part 4a spec §2.3). */
export const NPC_LOOKS = {
  /** One whole idle sway, from one side to the other and back (seconds). */
  swaySeconds: 3.2,
  /** How far the upper body leans to each side at the end of a sway (degrees). */
  swayDegrees: 2.5,
  /** Height of the nameplate's centre above the character's feet (world units; the model is ~1.1 tall with a hat). */
  nameplateHeight: 1.5,
  /** Height of the nameplate sprite (world units); its width follows the plate's aspect. */
  nameplateScale: 0.36,
} as const;
```

(The values of `APPEARANCE` don't change, so `tests/sections.test.ts`' `APPEARANCE` literal still holds.)

**3b. `src/core/types.ts`** (in `Appearance`). Replace:

```ts
  /** 0 … APPEARANCE.hairStyles - 1 */
  readonly hairStyle: number;
```

with:

```ts
  /** 0 … APPEARANCE.hairStyles - 1: short (the original look), a ponytail, a bob (render/playerModel.ts HAIR_STYLES). */
  readonly hairStyle: number;
```

and replace:

```ts
  /** 0 = no hat, 1 … APPEARANCE.hats - 1 */
  readonly hat: number;
```

with:

```ts
  /** 0 … APPEARANCE.hats - 1: the straw hat (the original look), no hat, a cap, a knitted hat (render/playerModel.ts HAT_STYLES). */
  readonly hat: number;
```

Every save holds `hat: 0` (the default appearance, and nothing edits it yet), so no saved data changes meaning in practice: the player keeps the straw hat it has always worn.

**3c. `src/render/palette.ts`.** Append after the closing `} as const;` of `PALETTE` (the end of the file):

```ts

/**
 * Colour choices for a character's look (farmclaws part 4a refinement R13): one list per
 * Appearance colour field, sized exactly by APPEARANCE in config. Index 0 of each is the
 * player's original colour (PALETTE.player), so the default appearance draws today's farmer.
 */
export const APPEARANCE_PALETTES = {
  /** Appearance.skinTone: fair to deep. */
  skin: [PALETTE.player.skin, 0xeec3a0, 0xd9a57f, 0xb8805c, 0x8d5b3f],
  /** Appearance.hairColor: chestnut, near-black, honey, auburn, silver, flaxen. */
  hair: [PALETTE.player.hair, 0x3d2c25, 0xd8a65e, 0xb4583a, 0xa8a29c, 0xf0d58a],
  /** Appearance.shirtColor: sky, coral, leaf, sunflower, lavender, cream, mint, rose. */
  shirt: [PALETTE.player.shirt, 0xe8897a, 0x9ccf7a, 0xf2c46b, 0xc9b6ff, 0xf4ead2, 0x7fcfc4, 0xeda5c4],
  /** Appearance.overallsColor: denim, moss, walnut, plum, slate, rust. */
  overalls: [PALETTE.player.overalls, 0x6b8f5a, 0x8f6a4f, 0x7a6aa8, 0x5c6672, 0xb06e4c],
} as const satisfies Readonly<Record<'skin' | 'hair' | 'shirt' | 'overalls', readonly number[]>>;
```

**3d. `src/render/playerModel.ts`.** Fourteen edits, in file order. The parts list of the default look is kept in exactly today's order (skin, scalp hair, nose, cheeks, then the straw hat's four pieces), so the merged geometry of `new PlayerModel()` is bit-for-bit what it was.

In the module header, replace:

```ts
 * - Every segment is ONE merged BufferGeometry with baked per-vertex colours (PALETTE.player),
 *   all sharing a single flat-shaded vertex-colour material. The whole farmer is nine draw
 *   calls; left and right limbs share their geometry.
```

with:

```ts
 * - Every segment is ONE merged BufferGeometry with baked per-vertex colours, all sharing a
 *   single flat-shaded vertex-colour material. The whole farmer is nine draw calls; left and
 *   right limbs share their geometry.
 *
 * Looks (farmclaws part 4a refinement R13)
 * - The constructor takes an Appearance: skin, hair, shirt and overalls colours come from
 *   APPEARANCE_PALETTES, plus a hair style (HAIR_STYLES) and a hat (HAT_STYLES). Index 0 of
 *   each is the player's original look, so `new PlayerModel()` builds today's farmer: short
 *   hair under the straw hat, in PALETTE.player's colours. NpcRenderer builds the cast with it.
```

Replace the imports:

```ts
import type { ToolType } from '../core/types';
import { createFlatMaterial } from './materials';
import { PALETTE } from './palette';
```

with:

```ts
import type { Appearance, ToolType } from '../core/types';
import { at } from './geometryParts';
import { createFlatMaterial } from './materials';
import { APPEARANCE_PALETTES, PALETTE } from './palette';
```

Replace:

```ts
const SKIN = PALETTE.player.skin;
const SHIRT = PALETTE.player.shirt;
const OVERALLS = PALETTE.player.overalls;
const HAIR = PALETTE.player.hair;
const HAT = PALETTE.player.hat;
const BOOTS = PALETTE.player.boots;
const EYE = 0x3a2a2a;
const CHEEK = 0xf6a6a0;
const HAT_BAND = PALETTE.houseRoof;
```

with:

```ts
const HAT = PALETTE.player.hat;
const BOOTS = PALETTE.player.boots;
const EYE = 0x3a2a2a;
const CHEEK = 0xf6a6a0;
const HAT_BAND = PALETTE.houseRoof;
/** The other hats (HAT_STYLES): a red cap, and a mustard knitted hat with a cream pompom. */
const CAP = 0xd8634e;
const KNIT = 0xe0a84a;
const KNIT_POMPOM = 0xfff4e0;
```

Replace:

```ts
// ---------------------------------------------------------------------------
// Geometry baking
// ---------------------------------------------------------------------------
```

with:

```ts
// ---------------------------------------------------------------------------
// Looks
// ---------------------------------------------------------------------------

/** Appearance.hairStyle values, APPEARANCE.hairStyles of them; 0 is the original look. */
export const HAIR_STYLES = { short: 0, ponytail: 1, bob: 2 } as const;

/** Appearance.hat values, APPEARANCE.hats of them; 0, the straw hat, is the original look. */
export const HAT_STYLES = { straw: 0, none: 1, cap: 2, knit: 3 } as const;

/** The player's original look: index 0 of every palette, short hair and the straw hat. */
export const DEFAULT_APPEARANCE: Appearance = {
  skinTone: 0,
  hairStyle: HAIR_STYLES.short,
  hairColor: 0,
  shirtColor: 0,
  overallsColor: 0,
  hat: HAT_STYLES.straw,
};

/** The four colours an Appearance picks from APPEARANCE_PALETTES. */
interface BodyColors {
  readonly skin: number;
  readonly hair: number;
  readonly shirt: number;
  readonly overalls: number;
}

/** Throws a RangeError for an index outside its palette. */
function appearanceColors(appearance: Appearance): BodyColors {
  return {
    skin: at(APPEARANCE_PALETTES.skin, appearance.skinTone),
    hair: at(APPEARANCE_PALETTES.hair, appearance.hairColor),
    shirt: at(APPEARANCE_PALETTES.shirt, appearance.shirtColor),
    overalls: at(APPEARANCE_PALETTES.overalls, appearance.overallsColor),
  };
}

// ---------------------------------------------------------------------------
// Geometry baking
// ---------------------------------------------------------------------------
```

Replace:

```ts
/** One primitive of a merged prop: a geometry, a flat colour and a placement. */
interface Part {
```

with:

```ts
/** One primitive of a merged prop: a geometry, a flat colour and a placement. */
export interface Part {
```

Replace:

```ts
 * attributes; the source geometries are disposed.
 */
function bakeParts(parts: readonly Part[]): THREE.BufferGeometry {
```

with:

```ts
 * attributes; the source geometries are disposed. npcProps.ts bakes the cast's props with it.
 */
export function bakeParts(parts: readonly Part[]): THREE.BufferGeometry {
```

Replace the head, torso, pelvis, leg and arm builders, from:

```ts
/** Head, hair and straw hat, relative to the neck pivot. The eyes are a separate mesh. */
function buildHeadGeometry(): THREE.BufferGeometry {
  return bakeParts([
    { geometry: ico(0.17, 1), color: SKIN, position: [0, 0.16, 0], scale: [1, 0.94, 0.96] },
    { geometry: ico(0.178, 1), color: HAIR, position: [0, 0.178, -0.032], scale: [1.03, 0.95, 1] },
    { geometry: box(0.03, 0.03, 0.03), color: SKIN, shade: 0.9, position: [0, 0.118, 0.172] },
    { geometry: box(0.045, 0.022, 0.03), color: CHEEK, position: [0.096, 0.104, 0.128] },
    { geometry: box(0.045, 0.022, 0.03), color: CHEEK, position: [-0.096, 0.104, 0.128] },
    // Straw hat: wide brim, crown and a coral ribbon.
    { geometry: cylinder(0.27, 0.27, 0.024, 10), color: HAT, position: [0, 0.27, 0.01], rotation: [0.05, 0, 0] },
    { geometry: cylinder(0.125, 0.15, 0.11, 8), color: HAT, shade: 1.04, position: [0, 0.335, 0] },
    { geometry: cylinder(0.153, 0.153, 0.032, 8), color: HAT_BAND, position: [0, 0.3, 0] },
    { geometry: cylinder(0.1, 0.125, 0.012, 8), color: HAT, shade: 0.9, position: [0, 0.395, 0] },
  ]);
}
```

with:

```ts
/** The hair over the scalp, plus a ponytail or a bob; `style` is a HAIR_STYLES value. */
function hairParts(hair: number, style: number): Part[] {
  const scalp = (): Part => ({ geometry: ico(0.178, 1), color: hair, position: [0, 0.178, -0.032], scale: [1.03, 0.95, 1] });
  switch (style) {
    case HAIR_STYLES.short:
      return [scalp()];
    case HAIR_STYLES.ponytail:
      // A band at the back of the head and a tail hanging from it.
      return [
        scalp(),
        { geometry: cylinder(0.036, 0.036, 0.03, 6), color: hair, shade: 0.75, position: [0, 0.2, -0.2], rotation: [Math.PI / 2, 0, 0] },
        { geometry: ico(0.06, 0), color: hair, position: [0, 0.115, -0.225], scale: [0.8, 1.6, 0.8] },
      ];
    case HAIR_STYLES.bob:
      // Hair down to the neck at the back, and a lock over each ear.
      return [
        scalp(),
        { geometry: box(0.32, 0.18, 0.1), color: hair, position: [0, 0.11, -0.135] },
        { geometry: box(0.05, 0.17, 0.15), color: hair, position: [0.165, 0.12, -0.03] },
        { geometry: box(0.05, 0.17, 0.15), color: hair, position: [-0.165, 0.12, -0.03] },
      ];
    default:
      throw new RangeError(`playerModel: no hair style ${style}`);
  }
}

/** The hat over the hair; `hat` is a HAT_STYLES value. */
function hatParts(hat: number): Part[] {
  switch (hat) {
    case HAT_STYLES.straw:
      // Straw hat: wide brim, crown and a coral ribbon.
      return [
        { geometry: cylinder(0.27, 0.27, 0.024, 10), color: HAT, position: [0, 0.27, 0.01], rotation: [0.05, 0, 0] },
        { geometry: cylinder(0.125, 0.15, 0.11, 8), color: HAT, shade: 1.04, position: [0, 0.335, 0] },
        { geometry: cylinder(0.153, 0.153, 0.032, 8), color: HAT_BAND, position: [0, 0.3, 0] },
        { geometry: cylinder(0.1, 0.125, 0.012, 8), color: HAT, shade: 0.9, position: [0, 0.395, 0] },
      ];
    case HAT_STYLES.none:
      return [];
    case HAT_STYLES.cap:
      // Cap: a rounded crown, a peak over the eyes and a button on top.
      return [
        { geometry: cylinder(0.15, 0.182, 0.1, 8), color: CAP, position: [0, 0.31, 0] },
        { geometry: box(0.2, 0.018, 0.13), color: CAP, shade: 0.85, position: [0, 0.27, 0.2], rotation: [0.12, 0, 0] },
        { geometry: cylinder(0.024, 0.024, 0.016, 6), color: CAP, shade: 0.8, position: [0, 0.368, 0] },
      ];
    case HAT_STYLES.knit:
      // Knitted hat: a tapering body, a ribbed cuff and a pompom.
      return [
        { geometry: cylinder(0.13, 0.186, 0.13, 8), color: KNIT, position: [0, 0.32, -0.005] },
        { geometry: cylinder(0.192, 0.192, 0.05, 8), color: KNIT, shade: 0.85, position: [0, 0.272, -0.005] },
        { geometry: ico(0.048, 0), color: KNIT_POMPOM, position: [0, 0.405, -0.005] },
      ];
    default:
      throw new RangeError(`playerModel: no hat ${hat}`);
  }
}

/** Head, hair and hat, relative to the neck pivot. The eyes are a separate mesh. */
function buildHeadGeometry(colors: BodyColors, hairStyle: number, hat: number): THREE.BufferGeometry {
  return bakeParts([
    { geometry: ico(0.17, 1), color: colors.skin, position: [0, 0.16, 0], scale: [1, 0.94, 0.96] },
    ...hairParts(colors.hair, hairStyle),
    { geometry: box(0.03, 0.03, 0.03), color: colors.skin, shade: 0.9, position: [0, 0.118, 0.172] },
    { geometry: box(0.045, 0.022, 0.03), color: CHEEK, position: [0.096, 0.104, 0.128] },
    { geometry: box(0.045, 0.022, 0.03), color: CHEEK, position: [-0.096, 0.104, 0.128] },
    ...hatParts(hat),
  ]);
}
```

(`buildEyesGeometry` between them is unchanged.) Replace:

```ts
/** Shirt, overall bib and straps, relative to the torso pivot (the waist). */
function buildTorsoGeometry(): THREE.BufferGeometry {
  const strapX = 0.07;
  return bakeParts([
    { geometry: box(0.3, 0.27, 0.2), color: SHIRT, position: [0, 0.195, 0] },
    { geometry: cylinder(0.055, 0.062, 0.07, 6), color: SKIN, position: [0, 0.33, 0] },
    { geometry: box(0.2, 0.15, 0.025), color: OVERALLS, position: [0, 0.13, 0.103] },
    { geometry: box(0.08, 0.05, 0.012), color: OVERALLS, shade: 0.82, position: [0, 0.145, 0.121] },
    { geometry: box(0.045, 0.14, 0.025), color: OVERALLS, position: [strapX, 0.26, 0.103] },
    { geometry: box(0.045, 0.14, 0.025), color: OVERALLS, position: [-strapX, 0.26, 0.103] },
    { geometry: box(0.045, 0.025, 0.21), color: OVERALLS, position: [strapX, 0.335, 0] },
    { geometry: box(0.045, 0.025, 0.21), color: OVERALLS, position: [-strapX, 0.335, 0] },
    { geometry: box(0.045, 0.27, 0.025), color: OVERALLS, position: [strapX, 0.2, -0.103] },
    { geometry: box(0.045, 0.27, 0.025), color: OVERALLS, position: [-strapX, 0.2, -0.103] },
```

with:

```ts
/** Shirt, overall bib and straps, relative to the torso pivot (the waist). */
function buildTorsoGeometry(colors: BodyColors): THREE.BufferGeometry {
  const strapX = 0.07;
  const { skin, shirt, overalls } = colors;
  return bakeParts([
    { geometry: box(0.3, 0.27, 0.2), color: shirt, position: [0, 0.195, 0] },
    { geometry: cylinder(0.055, 0.062, 0.07, 6), color: skin, position: [0, 0.33, 0] },
    { geometry: box(0.2, 0.15, 0.025), color: overalls, position: [0, 0.13, 0.103] },
    { geometry: box(0.08, 0.05, 0.012), color: overalls, shade: 0.82, position: [0, 0.145, 0.121] },
    { geometry: box(0.045, 0.14, 0.025), color: overalls, position: [strapX, 0.26, 0.103] },
    { geometry: box(0.045, 0.14, 0.025), color: overalls, position: [-strapX, 0.26, 0.103] },
    { geometry: box(0.045, 0.025, 0.21), color: overalls, position: [strapX, 0.335, 0] },
    { geometry: box(0.045, 0.025, 0.21), color: overalls, position: [-strapX, 0.335, 0] },
    { geometry: box(0.045, 0.27, 0.025), color: overalls, position: [strapX, 0.2, -0.103] },
    { geometry: box(0.045, 0.27, 0.025), color: overalls, position: [-strapX, 0.2, -0.103] },
```

(the two brass buckle lines after it stay as they are). Replace:

```ts
/** Overall seat, relative to the hip pivot. */
function buildPelvisGeometry(): THREE.BufferGeometry {
  return bakeParts([
    { geometry: box(0.29, 0.14, 0.2), color: OVERALLS, position: [0, 0.005, 0] },
    { geometry: box(0.3, 0.03, 0.21), color: OVERALLS, shade: 0.85, position: [0, 0.06, 0] },
  ]);
}

/** One leg with a rolled cuff and a boot, hanging from the hip joint (sole at y = -legLength). */
function buildLegGeometry(): THREE.BufferGeometry {
  const sole = -PLAYER_RIG.legLength;
  return bakeParts([
    { geometry: box(0.12, 0.26, 0.13), color: OVERALLS, position: [0, -0.13, 0] },
    { geometry: box(0.135, 0.04, 0.145), color: OVERALLS, shade: 0.82, position: [0, -0.245, 0] },
```

with:

```ts
/** Overall seat, relative to the hip pivot. */
function buildPelvisGeometry(colors: BodyColors): THREE.BufferGeometry {
  return bakeParts([
    { geometry: box(0.29, 0.14, 0.2), color: colors.overalls, position: [0, 0.005, 0] },
    { geometry: box(0.3, 0.03, 0.21), color: colors.overalls, shade: 0.85, position: [0, 0.06, 0] },
  ]);
}

/** One leg with a rolled cuff and a boot, hanging from the hip joint (sole at y = -legLength). */
function buildLegGeometry(colors: BodyColors): THREE.BufferGeometry {
  const sole = -PLAYER_RIG.legLength;
  return bakeParts([
    { geometry: box(0.12, 0.26, 0.13), color: colors.overalls, position: [0, -0.13, 0] },
    { geometry: box(0.135, 0.04, 0.145), color: colors.overalls, shade: 0.82, position: [0, -0.245, 0] },
```

(the two boot lines after it stay as they are). Replace:

```ts
/** One arm: short sleeve, forearm and hand, hanging from the shoulder joint. */
function buildArmGeometry(): THREE.BufferGeometry {
  return bakeParts([
    { geometry: box(0.1, 0.13, 0.1), color: SHIRT, position: [0, -0.055, 0] },
    { geometry: box(0.075, 0.14, 0.075), color: SKIN, position: [0, -0.18, 0] },
    { geometry: ico(0.052, 0), color: SKIN, position: [0, -PLAYER_RIG.armLength, 0.005] },
  ]);
}
```

with:

```ts
/** One arm: short sleeve, forearm and hand, hanging from the shoulder joint. */
function buildArmGeometry(colors: BodyColors): THREE.BufferGeometry {
  return bakeParts([
    { geometry: box(0.1, 0.13, 0.1), color: colors.shirt, position: [0, -0.055, 0] },
    { geometry: box(0.075, 0.14, 0.075), color: colors.skin, position: [0, -0.18, 0] },
    { geometry: ico(0.052, 0), color: colors.skin, position: [0, -PLAYER_RIG.armLength, 0.005] },
  ]);
}
```

Replace:

```ts
/** The farmer's bone hierarchy and meshes. Owns (and disposes) its geometries and materials. */
export class PlayerModel {
```

with:

```ts
/**
 * The farmer's bone hierarchy and meshes, in the colours, hair and hat of an Appearance (the
 * player's original look by default). Owns (and disposes) its geometries and materials.
 */
export class PlayerModel {
```

In the constructor, replace:

```ts
  constructor() {
    const R = PLAYER_RIG;
    const material = createFlatMaterial(0xffffff, { vertexColors: true });
```

with:

```ts
  /** Throws a RangeError when `appearance` picks a colour, hair style or hat that doesn't exist. */
  constructor(appearance: Appearance = DEFAULT_APPEARANCE) {
    const R = PLAYER_RIG;
    const colors = appearanceColors(appearance);
    const material = createFlatMaterial(0xffffff, { vertexColors: true });
```

replace:

```ts
    const headGeometry = buildHeadGeometry();
    const eyesGeometry = buildEyesGeometry();
    const torsoGeometry = buildTorsoGeometry();
    const pelvisGeometry = buildPelvisGeometry();
    const legGeometry = buildLegGeometry();
    const armGeometry = buildArmGeometry();
```

with:

```ts
    const headGeometry = buildHeadGeometry(colors, appearance.hairStyle, appearance.hat);
    const eyesGeometry = buildEyesGeometry();
    const torsoGeometry = buildTorsoGeometry(colors);
    const pelvisGeometry = buildPelvisGeometry(colors);
    const legGeometry = buildLegGeometry(colors);
    const armGeometry = buildArmGeometry(colors);
```

and replace:

```ts
    this.root.name = 'player';
    this.root.add(this.body);
```

with:

```ts
    this.root.name = 'player';
    // The bones NpcRenderer hangs the cast's props from (npcProps.ts NPC_PROP_BONES).
    this.hips.name = 'hips';
    this.torso.name = 'torso';
    this.head.name = 'head';
    this.root.add(this.body);
```

`SKIN`, `SHIRT`, `OVERALLS` and `HAIR` have no other users: after these edits `grep -nE "\b(SKIN|SHIRT|OVERALLS|HAIR)\b" src/render/playerModel.ts` finds nothing. `PlayerRenderer` keeps calling `new PlayerModel()`.

**3e. `src/render/PlayerRenderer.ts`.** Insert directly above `/** How much of the walk arm swing the right arm keeps while carrying. */` (after the closing `};` of `CARRY_POSES`):

```ts
/** The empty-handed rest pose; NpcRenderer stands the cast in it. */
export const EMPTY_HANDED_POSE: Readonly<Pose> = CARRY_POSES.empty;

```

**3f. Create `src/render/npcProps.ts`:**

```ts
/**
 * The cast's props (farmclaws part 4a spec §2.3): one merged, vertex-coloured geometry per
 * NpcProp, hung from one bone of the character's PlayerModel so it sways with the character.
 *
 * - Each prop is authored in the local space of its bone (NPC_PROP_BONES), facing +Z like the
 *   model: the head's origin is the neck pivot, the torso's the waist and the hips' the hip joint
 *   (see PLAYER_RIG and the body segments in playerModel.ts).
 * - A prop worn as a hat replaces the character's own hat: modelAppearance builds the model
 *   with HAT_STYLES.none under it.
 * - A clipboard is held against the chest, so it brings a left-arm pose of its own
 *   (NPC_PROP_POSES); every other prop leaves the arms at rest.
 */
import * as THREE from 'three';
import type { Appearance } from '../core/types';
import type { CastLook, NpcProp } from '../people/cast';
import { mergeParts } from './geometryParts';
import { HAT_STYLES, bakeParts, type Part, type Pose } from './playerModel';

/** The PlayerModel bones a prop hangs from. */
export type PropBone = 'head' | 'torso' | 'hips';

export const NPC_PROP_BONES: Readonly<Record<NpcProp, PropBone>> = {
  toolApron: 'torso',
  featherHat: 'head',
  clipboard: 'torso',
  seedPouch: 'hips',
  smithApron: 'torso',
  pencil: 'head',
  neckerchief: 'torso',
};

/** Joints a prop sets on top of the empty-handed rest pose. */
export const NPC_PROP_POSES: Readonly<Partial<Record<NpcProp, Readonly<Partial<Pose>>>>> = {
  // The left hand holds the clipboard's lower corner against the chest.
  clipboard: { lArmSwing: 0.85, lArmSpread: -0.3 },
};

/** Props worn in place of the character's own hat. */
const HAT_PROPS: ReadonlySet<NpcProp> = new Set<NpcProp>(['featherHat']);

const CANVAS = 0xd9b77e;
const LEATHER = 0x8a5a3c;
const BRASS = 0xf2c46b;
const METAL = 0xaab2c6;
const HANDLE_RED = 0xe2563f;
const HANDLE_BLUE = 0x5f93c6;
const STRAW = 0xe8c77a;
const RIBBON = 0x6b8f5a;
const FEATHER = 0xf4f0e6;
const FEATHER_TIP = 0x7a6aa8;
const BOARD = 0xc58b5a;
const PAPER = 0xfaf6ea;
const INK_LINE = 0x9aa3b5;
const BURLAP = 0xd8b98a;
const SPROUT = 0x8cc56f;
const PENCIL_PAINT = 0xf2c94c;
const PENCIL_WOOD = 0xe8c99a;
const PENCIL_LEAD = 0x4a4a52;
const ERASER = 0xf6a6a0;
const KERCHIEF = 0xe2563f;

const placement = new THREE.Matrix4();
const placementRotation = new THREE.Quaternion();
const placementEuler = new THREE.Euler();
const placementPosition = new THREE.Vector3();
const UNIT_SCALE = new THREE.Vector3(1, 1, 1);

function box(width: number, height: number, depth: number): THREE.BufferGeometry {
  return new THREE.BoxGeometry(width, height, depth);
}

function cylinder(radiusTop: number, radiusBottom: number, height: number, segments: number): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments);
}

/** Bakes `parts` authored in their own frame, then rotates (x, y, z order) and moves them onto the bone. */
function bakePlaced(parts: readonly Part[], position: readonly [number, number, number], rotation: readonly [number, number, number]): THREE.BufferGeometry {
  const geometry = bakeParts(parts);
  placement.compose(
    placementPosition.set(position[0], position[1], position[2]),
    placementRotation.setFromEuler(placementEuler.set(rotation[0], rotation[1], rotation[2])),
    UNIT_SCALE,
  );
  return geometry.applyMatrix4(placement);
}

/** Sol: a canvas tool apron round the waist, two pockets with a screwdriver, a file and a spanner. */
function buildToolApron(): THREE.BufferGeometry {
  return bakeParts([
    { geometry: box(0.31, 0.03, 0.215), color: CANVAS, shade: 0.8, position: [0, 0.075, 0] },
    { geometry: box(0.3, 0.2, 0.02), color: CANVAS, position: [0, -0.03, 0.13] },
    { geometry: box(0.11, 0.08, 0.016), color: CANVAS, shade: 0.85, position: [0.07, -0.05, 0.147] },
    { geometry: box(0.11, 0.08, 0.016), color: CANVAS, shade: 0.85, position: [-0.07, -0.05, 0.147] },
    { geometry: cylinder(0.012, 0.012, 0.07, 5), color: HANDLE_RED, position: [0.05, 0.01, 0.15] },
    { geometry: cylinder(0.012, 0.012, 0.06, 5), color: HANDLE_BLUE, position: [0.09, 0.005, 0.15] },
    { geometry: box(0.022, 0.09, 0.008), color: METAL, position: [-0.07, 0.005, 0.151] },
    { geometry: box(0.05, 0.022, 0.008), color: METAL, position: [-0.07, 0.05, 0.151] },
  ]);
}

/** Cosmo: a weathered straw hat with a green ribbon and a feather tucked in it. */
function buildFeatherHat(): THREE.BufferGeometry {
  const hat = bakeParts([
    { geometry: cylinder(0.28, 0.28, 0.022, 10), color: STRAW, position: [0, 0.27, 0.01], rotation: [0.05, 0, 0] },
    { geometry: cylinder(0.125, 0.15, 0.12, 8), color: STRAW, shade: 1.04, position: [0, 0.34, 0] },
    { geometry: cylinder(0.153, 0.153, 0.032, 8), color: RIBBON, position: [0, 0.3, 0] },
    { geometry: cylinder(0.1, 0.125, 0.012, 8), color: STRAW, shade: 0.9, position: [0, 0.406, 0] },
  ]);
  // The feather, quill down at the origin, leaning out and back from the ribbon on the left.
  const feather = bakePlaced(
    [
      { geometry: cylinder(0.005, 0.005, 0.04, 4), color: FEATHER, shade: 0.8, position: [0, -0.01, 0] },
      { geometry: box(0.012, 0.18, 0.05), color: FEATHER, position: [0, 0.1, 0] },
      { geometry: box(0.014, 0.05, 0.054), color: FEATHER_TIP, position: [0, 0.205, 0] },
    ],
    [0.14, 0.31, -0.06],
    [-0.35, 0, -0.45],
  );
  return mergeParts([hat, feather], 'featherHat');
}

/** Barnaby: a clipboard with a written sheet, held against the chest. */
function buildClipboard(): THREE.BufferGeometry {
  return bakePlaced(
    [
      { geometry: box(0.16, 0.21, 0.015), color: BOARD },
      { geometry: box(0.13, 0.165, 0.004), color: PAPER, position: [0, -0.01, 0.0095] },
      { geometry: box(0.09, 0.008, 0.002), color: INK_LINE, position: [0, 0.03, 0.0125] },
      { geometry: box(0.09, 0.008, 0.002), color: INK_LINE, position: [0, -0.005, 0.0125] },
      { geometry: box(0.09, 0.008, 0.002), color: INK_LINE, position: [0, -0.04, 0.0125] },
      { geometry: box(0.06, 0.03, 0.014), color: METAL, position: [0, 0.095, 0.012] },
    ],
    [0.05, 0.16, 0.165],
    [-0.3, 0, 0],
  );
}

/** Marigold: a burlap seed pouch on a belt, a sprout peeking out of its neck. */
function buildSeedPouch(): THREE.BufferGeometry {
  return bakeParts([
    { geometry: box(0.305, 0.03, 0.215), color: LEATHER, position: [0, 0.03, 0] },
    { geometry: new THREE.IcosahedronGeometry(0.07, 0), color: BURLAP, position: [-0.1, -0.045, 0.115], scale: [0.85, 1, 0.75] },
    { geometry: cylinder(0.026, 0.036, 0.03, 6), color: BURLAP, shade: 0.8, position: [-0.1, 0.02, 0.115] },
    { geometry: cylinder(0.03, 0.03, 0.012, 6), color: LEATHER, position: [-0.1, 0.01, 0.115] },
    { geometry: box(0.018, 0.045, 0.008), color: SPROUT, position: [-0.095, 0.05, 0.115], rotation: [0, 0, -0.35] },
  ]);
}

/** Bram: a leather smith's apron from the chest to the knees, with neck straps, a tie and rivets. */
function buildSmithApron(): THREE.BufferGeometry {
  return bakeParts([
    { geometry: box(0.22, 0.2, 0.02), color: LEATHER, position: [0, 0.2, 0.135] },
    { geometry: box(0.28, 0.26, 0.02), color: LEATHER, position: [0, -0.05, 0.135] },
    { geometry: box(0.31, 0.025, 0.215), color: LEATHER, shade: 0.75, position: [0, 0.09, 0] },
    { geometry: box(0.025, 0.08, 0.02), color: LEATHER, shade: 0.75, position: [0.075, 0.33, 0.125], rotation: [0, 0, 0.69] },
    { geometry: box(0.025, 0.08, 0.02), color: LEATHER, shade: 0.75, position: [-0.075, 0.33, 0.125], rotation: [0, 0, -0.69] },
    { geometry: box(0.1, 0.06, 0.012), color: LEATHER, shade: 0.82, position: [0, -0.06, 0.151] },
    { geometry: box(0.02, 0.02, 0.01), color: BRASS, position: [0.1, 0.29, 0.148] },
    { geometry: box(0.02, 0.02, 0.01), color: BRASS, position: [-0.1, 0.29, 0.148] },
  ]);
}

/** Juniper: a pencil tucked behind the right ear (−X), point forward and a little down. */
function buildPencil(): THREE.BufferGeometry {
  return bakePlaced(
    [
      { geometry: cylinder(0.014, 0.014, 0.1, 6), color: PENCIL_PAINT },
      { geometry: new THREE.ConeGeometry(0.014, 0.03, 6), color: PENCIL_WOOD, position: [0, 0.065, 0] },
      { geometry: new THREE.ConeGeometry(0.005, 0.01, 6), color: PENCIL_LEAD, position: [0, 0.077, 0] },
      { geometry: cylinder(0.015, 0.015, 0.012, 6), color: METAL, position: [0, -0.056, 0] },
      { geometry: cylinder(0.014, 0.014, 0.018, 6), color: ERASER, position: [0, -0.071, 0] },
    ],
    [-0.19, 0.19, -0.02],
    [Math.PI / 2 + 0.25, 0, 0],
  );
}

/** Tess: a red neckerchief, a band round the neck with a triangle over the chest and a knot. */
function buildNeckerchief(): THREE.BufferGeometry {
  return bakeParts([
    { geometry: cylinder(0.072, 0.078, 0.035, 8), color: KERCHIEF, position: [0, 0.335, 0] },
    { geometry: new THREE.ConeGeometry(0.075, 0.12, 3), color: KERCHIEF, position: [0, 0.27, 0.118], rotation: [Math.PI, 0, 0], scale: [1, 1, 0.3] },
    { geometry: new THREE.IcosahedronGeometry(0.024, 0), color: KERCHIEF, shade: 0.8, position: [0, 0.325, 0.085] },
  ]);
}

const PROP_BUILDERS: Readonly<Record<NpcProp, () => THREE.BufferGeometry>> = {
  toolApron: buildToolApron,
  featherHat: buildFeatherHat,
  clipboard: buildClipboard,
  seedPouch: buildSeedPouch,
  smithApron: buildSmithApron,
  pencil: buildPencil,
  neckerchief: buildNeckerchief,
};

/** A fresh geometry for `prop` in its bone's local space; the caller disposes it. */
export function createNpcPropGeometry(prop: NpcProp): THREE.BufferGeometry {
  return PROP_BUILDERS[prop]();
}

/** The appearance a character's model is built with: a prop worn as a hat replaces its own hat. */
export function modelAppearance(look: CastLook): Appearance {
  return HAT_PROPS.has(look.prop) ? { ...look.appearance, hat: HAT_STYLES.none } : look.appearance;
}
```

**3g. Create `src/render/nameplates.ts`:**

```ts
/**
 * Nameplates (farmclaws part 4a spec §2.3): a character's name on a small rounded plate, drawn
 * once per character onto a canvas that NpcRenderer shows on a sprite above the head.
 *
 * - Every plate's canvas is NAMEPLATE_CANVAS in size, so every sprite has the same aspect
 *   (NAMEPLATE_ASPECT). The plate inside it is sized to the name (nameplateRect); the rest of
 *   the canvas stays transparent.
 * - The name is drawn with fillText, squeezed to fit when it is too long for the plate.
 */
import * as THREE from 'three';

/** Canvas size of every nameplate (pixels). */
export const NAMEPLATE_CANVAS = { width: 256, height: 64 } as const;
/** Width over height of every nameplate sprite. */
export const NAMEPLATE_ASPECT = NAMEPLATE_CANVAS.width / NAMEPLATE_CANVAS.height;

const FONT = '700 34px "Trebuchet MS", "Segoe UI", sans-serif';
/** Space between the name and the plate's left and right edges (pixels). */
const PADDING = 18;
/** Transparent space kept round the plate, so its outline is never clipped (pixels). */
const MARGIN = 4;
const OUTLINE = 4;
const CORNER = 18;
const PLATE_FILL = 'rgba(255, 248, 232, 0.92)';
const INK = '#5a3d2b';

/** A rectangle on the nameplate canvas (pixels). */
export interface PlateRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The plate behind a name `textWidth` pixels wide: padded, centred, and never past the canvas margin. */
export function nameplateRect(textWidth: number): PlateRect {
  const width = Math.min(NAMEPLATE_CANVAS.width - 2 * MARGIN, Math.max(0, textWidth) + 2 * PADDING);
  return { x: (NAMEPLATE_CANVAS.width - width) / 2, y: MARGIN, width, height: NAMEPLATE_CANVAS.height - 2 * MARGIN };
}

/** Traces a rounded rectangle as the current path. */
function tracePlate(g: CanvasRenderingContext2D, rect: PlateRect): void {
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;
  g.beginPath();
  g.moveTo(rect.x + CORNER, rect.y);
  g.arcTo(right, rect.y, right, bottom, CORNER);
  g.arcTo(right, bottom, rect.x, bottom, CORNER);
  g.arcTo(rect.x, bottom, rect.x, rect.y, CORNER);
  g.arcTo(rect.x, rect.y, right, rect.y, CORNER);
  g.closePath();
}

/** `name` on a cream plate with an ink outline. The caller owns (and disposes) the texture. */
export function createNameplateTexture(name: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = NAMEPLATE_CANVAS.width;
  canvas.height = NAMEPLATE_CANVAS.height;
  const g = canvas.getContext('2d');
  if (g === null) throw new Error('nameplates: no 2D canvas context for the nameplates');
  g.font = FONT;
  const rect = nameplateRect(g.measureText(name).width);
  tracePlate(g, rect);
  g.fillStyle = PLATE_FILL;
  g.fill();
  g.lineWidth = OUTLINE;
  g.strokeStyle = INK;
  g.stroke();
  g.fillStyle = INK;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(name, NAMEPLATE_CANVAS.width / 2, NAMEPLATE_CANVAS.height / 2, rect.width - 2 * PADDING);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
```

**3h. Create `src/render/NpcRenderer.ts`:**

```ts
/**
 * NpcRenderer: the cast standing on their spots (farmclaws part 4a spec §2.3).
 *
 * - Each character is a PlayerModel in its CAST_LOOKS appearance (modelAppearance), with its
 *   prop (npcProps.ts) on the prop's bone and a nameplate sprite above its head: ten meshes and
 *   a sprite per character.
 * - A map's characters are built the first time the player is on that map and kept, one group
 *   per map; only the active map's group is shown. A full rebuild (`sync(state, null)`: startup,
 *   a load, a map change) shows the active map's group and places its characters again.
 * - Characters stand on their tile centre at the player's ground height (playerGroundHeight,
 *   playerRootHeight), facing their placement's direction through directionYaw as the player
 *   does. They never turn toward the player.
 * - update() sways each shown character's upper body by swayAngle, out of step by NPC_IDS index.
 * - The nameplate of the character on the tile ahead (nameplateFor) shows while the game isn't
 *   frozen. Each plate's texture is drawn once, when its character is built.
 */
import * as THREE from 'three';
import { NPC_LOOKS } from '../config';
import { NPC_IDS, type GameState, type MapId, type NpcId } from '../core/types';
import { CAST, CAST_LOOKS, npcAt } from '../people/cast';
import { selectActiveMapId, selectIsFrozen, selectTargetTile } from '../state/selectors';
import { directionYaw, tileCenterX, tileCenterZ } from '../world/grid';
import { getMap } from '../world/maps';
import type { NpcPlacement } from '../world/maps/types';
import { getTile } from '../world/tiles';
import { createFlatMaterial } from './materials';
import { NAMEPLATE_ASPECT, createNameplateTexture } from './nameplates';
import { NPC_PROP_BONES, NPC_PROP_POSES, createNpcPropGeometry, modelAppearance } from './npcProps';
import { EMPTY_HANDED_POSE, playerBlobLocalHeight, playerGroundHeight, playerRootHeight } from './PlayerRenderer';
import { PlayerModel, applyPose, copyPose, createPose, type Pose } from './playerModel';
import type { SceneContext } from './SceneContext';
import type { FrameContext, RenderSystem } from './types';

/** Nameplates draw after the scene's meshes, like the zone letters. */
const NAMEPLATE_RENDER_ORDER = 3;

/** Draws one character's nameplate texture; NpcRenderer calls it once per character. */
export type NameplateFactory = (name: string) => THREE.Texture;

/** The character on the tile ahead of the player, whose nameplate shows; null while the game is frozen. */
export function nameplateFor(state: GameState): NpcId | null {
  if (selectIsFrozen(state)) return null;
  const target = selectTargetTile(state);
  return target === null ? null : npcAt(state.player.mapId, target.tx, target.tz);
}

/**
 * A character's idle lean (radians, positive toward its right) `elapsedSeconds` into the sway:
 * NPC_LOOKS.swayDegrees each way over NPC_LOOKS.swaySeconds, its phase set by the character's
 * NPC_IDS index so neighbours never sway in step.
 */
export function swayAngle(elapsedSeconds: number, npcIndex: number): number {
  const turns = elapsedSeconds / NPC_LOOKS.swaySeconds + npcIndex / NPC_IDS.length;
  return THREE.MathUtils.degToRad(NPC_LOOKS.swayDegrees) * Math.sin(2 * Math.PI * turns);
}

interface Character {
  readonly placement: NpcPlacement;
  readonly model: PlayerModel;
  readonly prop: THREE.Mesh;
  readonly plate: THREE.Sprite;
  /** Empty-handed, plus the prop's own joints (a held clipboard). */
  readonly rest: Pose;
  /** Position in NPC_IDS: the sway's phase. */
  readonly index: number;
}

interface MapCast {
  readonly group: THREE.Group;
  readonly characters: readonly Character[];
}

export class NpcRenderer implements RenderSystem {
  private readonly ctx: SceneContext;
  private readonly makeNameplate: NameplateFactory;
  /** Shared by every prop: their colours are baked into the geometry. */
  private readonly propMaterial = createFlatMaterial(0xffffff, { vertexColors: true });
  /** Each visited map's characters, built on the first visit and kept. */
  private readonly casts = new Map<MapId, MapCast>();
  private readonly textures: THREE.Texture[] = [];
  private active: MapCast | null = null;
  /** The character whose nameplate shows. */
  private named: Character | null = null;
  /** Scratch pose, reused every frame. */
  private readonly pose = createPose();

  /** `makeNameplate` draws the plates; tests pass a stand-in, as node has no canvas. */
  constructor(ctx: SceneContext, makeNameplate: NameplateFactory = createNameplateTexture) {
    this.ctx = ctx;
    this.makeNameplate = makeNameplate;
  }

  sync(state: GameState, prev: GameState | null): void {
    // Only a full rebuild can change the map (render/syncPolicy.ts); the cast never moves.
    if (prev === null) this.showMap(state);
    this.showNameplate(nameplateFor(state));
  }

  update(frame: FrameContext): void {
    if (this.active === null) return;
    for (const character of this.active.characters) {
      copyPose(this.pose, character.rest);
      this.pose.tilt += swayAngle(frame.elapsed, character.index);
      applyPose(character.model, this.pose);
    }
  }

  dispose(): void {
    for (const cast of this.casts.values()) {
      for (const character of cast.characters) {
        character.prop.geometry.dispose();
        character.plate.material.dispose();
        character.model.dispose();
      }
      cast.group.removeFromParent();
    }
    for (const texture of this.textures) texture.dispose();
    this.propMaterial.dispose();
    this.casts.clear();
    this.textures.length = 0;
    this.active = null;
    this.named = null;
  }

  /** Shows the active map's characters, building them on its first visit, and stands them on its ground. */
  private showMap(state: GameState): void {
    const mapId = selectActiveMapId(state);
    let cast = this.casts.get(mapId);
    if (cast === undefined) {
      cast = this.buildCast(mapId);
      this.casts.set(mapId, cast);
    }
    for (const other of this.casts.values()) other.group.visible = other === cast;
    const world = state.maps[mapId];
    for (const character of cast.characters) {
      const { tx, tz, facing } = character.placement;
      const groundY = playerGroundHeight(getTile(world, tx, tz));
      const root = character.model.root;
      root.position.set(tileCenterX(world.grid, tx), playerRootHeight(groundY), tileCenterZ(world.grid, tz));
      root.rotation.y = directionYaw(facing);
      // The blob is a child of the root, so its height is relative to where the root sits.
      character.model.groundBlob.position.y = playerBlobLocalHeight(groundY);
    }
    this.active = cast;
  }

  private buildCast(mapId: MapId): MapCast {
    const group = new THREE.Group();
    group.name = `npcs-${mapId}`;
    const characters = getMap(mapId).npcs.map((placement) => this.buildCharacter(placement));
    for (const character of characters) group.add(character.model.root);
    this.ctx.scene.add(group);
    return { group, characters };
  }

  private buildCharacter(placement: NpcPlacement): Character {
    const npc = placement.id;
    const look = CAST_LOOKS[npc];
    const model = new PlayerModel(modelAppearance(look));
    model.root.name = `npc-${npc}`;

    const prop = new THREE.Mesh(createNpcPropGeometry(look.prop), this.propMaterial);
    prop.name = `prop-${look.prop}`;
    prop.castShadow = true;
    prop.receiveShadow = false;
    model[NPC_PROP_BONES[look.prop]].add(prop);

    const texture = this.makeNameplate(CAST[npc].name);
    this.textures.push(texture);
    const plate = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthWrite: false, toneMapped: false, fog: false }));
    plate.name = `nameplate-${npc}`;
    plate.scale.set(NPC_LOOKS.nameplateScale * NAMEPLATE_ASPECT, NPC_LOOKS.nameplateScale, 1);
    plate.position.y = NPC_LOOKS.nameplateHeight;
    plate.renderOrder = NAMEPLATE_RENDER_ORDER;
    plate.visible = false;
    model.root.add(plate);

    const rest = createPose({ ...EMPTY_HANDED_POSE, ...NPC_PROP_POSES[look.prop] });
    applyPose(model, rest);
    return { placement, model, prop, plate, rest, index: NPC_IDS.indexOf(npc) };
  }

  /** Shows `npc`'s nameplate (on the active map) and hides the one shown before. */
  private showNameplate(npc: NpcId | null): void {
    const character = npc === null ? null : (this.active?.characters.find((c) => c.placement.id === npc) ?? null);
    if (character === this.named) return;
    if (this.named !== null) this.named.plate.visible = false;
    if (character !== null) character.plate.visible = true;
    this.named = character;
  }
}
```

**3i. `src/main.ts`.** Replace:

```ts
import { updateSharedUniforms } from './render/materials';
```

with:

```ts
import { updateSharedUniforms } from './render/materials';
import { NpcRenderer } from './render/NpcRenderer';
```

and in `systems`, replace:

```ts
    new RobotRenderer(ctx, () => player.focus),
```

with:

```ts
    new RobotRenderer(ctx, () => player.focus),
    new NpcRenderer(ctx),
```

- [ ] **Step 4: Run it and see it pass**

Run: `npx vitest run tests/npcRender.test.ts tests/renderMaps.test.ts tests/sections.test.ts`
Expected: PASS (`npcRender.test.ts`: 26 tests). `renderMaps.test.ts` still reads `playerGroundHeight` and friends unchanged, and `sections.test.ts`' `APPEARANCE` literal is unchanged.

- [ ] **Step 5: The full gate**

Run: `npm run typecheck && npm test && npm run build`
Expected: all green.

- [ ] **Step 6: The bundle check**

This task adds imports to the main chunk, so run: `npm run build:check`
Expected: the dev-hook grep finds nothing (no new file names a dev hook). The main chunk grows by about 3.3 KiB gzipped. At the spec commit it is 282.0 KiB of its 285.1 KiB budget, so depending on what Tasks 1–7 added it may now be reported OVER. If it is, don't raise `scripts/bundle-baseline.json` yourself: the budget is part 3's number and Eli's call. Report the size to him with the commit and carry on; Task 10 runs `build:check` again once the budget is settled.

- [ ] **Step 7: Commit**

```bash
git add src/config.ts src/core/types.ts src/render/palette.ts src/render/playerModel.ts src/render/PlayerRenderer.ts src/render/npcProps.ts src/render/nameplates.ts src/render/NpcRenderer.ts src/main.ts tests/npcRender.test.ts
git commit -m "Farmclaws part 4a: the characters on screen

The cast now stands on their spots in the player's low-poly model, each in their
own look with their prop, swaying gently out of step and never turning to the
player. The character on the tile ahead shows a nameplate, drawn once on a
canvas, while the game isn't frozen. A map's characters are built on its first
visit and kept.

PlayerModel takes an Appearance from new palettes whose index 0 is today's
farmer, so the player is built exactly as before (a geometry fingerprint pins
it). Hat 0 is the straw hat the farmer has always worn and 1 is no hat, so index
0 stays the original look; Cosmo's feathered hat replaces his own. Each prop is
authored in its bone's space so it sways with the body.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

---

### Task 9: The Neighbours buildings

**Files:**
- Modify: `src/config.ts` (new `NEIGHBOUR_ROOFS` directly after `ROBOT_SCREEN`, ~line 409)
- Modify: `src/render/structureGeometry.ts` (imports, ~line 31; `FarmhouseSpec`, ~line 116; `FARMHOUSE_SHAPE`'s overhang comment, ~line 146; roof and door colour helpers after `HOUSE_DOOR_COLORS`, ~line 200; `createFarmhouseGeometry`, ~lines 285–339; new `FARMHOUSE_INSET`, `FARMHOUSE_STEP_DEPTH` and `farmhousePlacement` after it, ~line 340)
- Modify: `src/render/StructureRenderer.ts` (file doc comment, line 5; imports, ~lines 29–66; `HOUSE_INSET` and `PORCH_STEP_DEPTH`, ~lines 80–83, removed; `housePlacement`, ~lines 310–326, removed; `buildFarmstead`, ~line 352)
- Modify: `src/render/townGeometry.ts` (file doc comment, line 6; imports, ~lines 13–40; new section "The Neighbours: two farmhouses and a chicken coop" above the dispatch, ~line 552; `structureParts`, ~line 563; `mapStructureParts`'s doc comment, ~line 579)
- Test: `tests/neighbourBuildings.test.ts` (create)

**Interfaces:**
- Consumes:
  - Task 4: `MAP_IDS` with `'neighbours'`; `STRUCTURE_KINDS` ending in `'cosmoHouse'`, `'barnabyHouse'`, `'chickenCoop'` (R1); `MAPS.neighbours` with the structures `{ kind: 'cosmoHouse', rect: (3, 0, 6, 5), door: (5, 4) }`, `{ kind: 'chickenCoop', rect: (11, 0, 4, 5), door: null }`, `{ kind: 'barnabyHouse', rect: (24, 0, 6, 5), door: (26, 4) }` and the hedges, `scenery: 'farm'` (R12), `farmstead: null`, the warp West from (0, 14) on the dirt lane (z 13–15); `NEIGHBOURS_BACK_BAND_DEPTH` (5) from `src/world/maps/neighbours.ts`; the fences as `woodFence` placed objects in `generate()`. `generateMaps` (so `BASE.maps.neighbours` exists) and (1, 14) walkable.
  - Task 3: `townGeometry.ts`'s `structureParts` switch has `case 'partsExchange'` where `case 'noticeBoard'` was.
  - Existing code: `createFarmhouseGeometry(spec: FarmhouseSpec)`, `FARMHOUSE_SHAPE`, `HOUSE_ROOF_COLORS` / `HOUSE_DOOR_COLORS` (`structureGeometry.ts`); `StructureRenderer`'s private `housePlacement(grid, rect, door)` with `HOUSE_INSET = { side: 0.3, back: 0.3, front: 0.6 }` and `PORCH_STEP_DEPTH = 0.52`, and `buildScenery`, which merges `mapStructureParts(def, parts)` into the map's one painted body and one glow-glass mesh; `geometryParts.ts`'s `box`, `gableRoofParts`, `gableWallPart`, `gableRoofFrame`, `windowParts`, `transformParts`, `createPartSet`, `type RoofColors`, `type WindowStyle`, `type GableRoofSpec`; `townGeometry.ts`'s `rectBounds`, `WINDOW_FRAME`, `HEIGHTS`; `assertNever(value: never, context: string): never` (`src/core/invariant.ts`, unused until now); `planScenery` (the farm style's fence goes round any grid with a gap at every warp opening and doesn't depend on a farmstead); `ObjectRenderer` draws the placed `woodFence` objects on whatever map is active, with rails between neighbouring fence tiles (`objectLayout.ts`'s `hasFenceRail`), so the neighbours' fence rings need nothing here.
- Produces:
  - `src/config.ts`: `export const NEIGHBOUR_ROOFS = { cosmoHouse: 0xe9b949, barnabyHouse: 0x5b84c4 } as const satisfies Readonly<Record<'cosmoHouse' | 'barnabyHouse', number>>` (sunflower yellow and a bright blue; colours for Eli to confirm).
  - `src/render/structureGeometry.ts`:
    - `FarmhouseSpec` gains `readonly roofColor?: number`. Absent: the farm's roof, so the farm's farmhouse is built exactly as before (pinned by a fingerprint taken from today's code). Present: the roof panels and the door's awning take it, and the shingle rows and ridge cap are darker shades of it (`ROOF_TONES`, private); nothing else changes.
    - `export const FARMHOUSE_INSET = { side: 0.3, back: 0.3, front: 0.6 } as const`, `export const FARMHOUSE_STEP_DEPTH = 0.52` (moved from `StructureRenderer`'s `HOUSE_INSET` and `PORCH_STEP_DEPTH`, same values).
    - `export function farmhousePlacement(grid: GridSpec, rect: TileRect, door: TileCoord | null): { readonly spec: FarmhouseSpec; readonly origin: THREE.Vector3 }` (moved from `StructureRenderer`'s `housePlacement`; a null door centres it, as `shopPlacement` does).
  - `src/render/StructureRenderer.ts`: `buildFarmstead` uses `farmhousePlacement`; nothing else changes (the farm's draw calls and geometry are the same).
  - `src/render/townGeometry.ts`:
    - `structureParts` builds `'cosmoHouse'` and `'barnabyHouse'` as `createFarmhouseGeometry` at the farm's scale (`farmhousePlacement`) in their rect, door on the door tile, `roofColor: NEIGHBOUR_ROOFS[kind]`, body into `out.body` and glass into `out.glass`; and `'chickenCoop'` as `createCoopParts`, a plain plank shed on legs (no coop builder existed). The switch ends in `default: assertNever(kind, 'structureParts')`, so a structure kind without geometry no longer typechecks. They go through `mapStructureParts`, so they merge into the map's one painted body and one glow-glass mesh: no new draw calls. Their chimneys don't smoke (the smoke belongs to the farm's farmstead).
    - `export const COOP_SHAPE`, `export const COOP_INSET = { side: 0.35, back: 0.35, front: 0.75 } as const`, `export interface CoopSpec { readonly width: number; readonly depth: number }`, `export function createCoopParts(spec: CoopSpec, out: PartSet): void`.
  - `tests/neighbourBuildings.test.ts` (create, 9 tests): every structure of every map draws something and every structure kind stands on some map (R7's gap closed); the farm's farmhouse without a roof colour is unchanged; a roof colour recolours exactly the roof and the awning; the houses and coop stay inside their rects; the houses are at the farmhouse's scale with the door on the door tile; the two houses differ only by roof colour; the coop is lower with a ramp and a glowing window; the farm-style fence with its west gap; the Neighbours scenery within the draw-call budget.

- [ ] **Step 1: Write the failing test**

Create `tests/neighbourBuildings.test.ts`:

```ts
/**
 * The Neighbours map's buildings (farmclaws part 4a spec §5.2), all pure geometry that runs in
 * node without a WebGL context:
 * - the farmhouse takes an optional roof colour, and without one the farm's farmhouse is built
 *   exactly as before;
 * - Cosmo's and Barnaby's houses are that farmhouse at the farm's scale, door on the door tile,
 *   alike but for the roof; the coop is a lower plank shed; all three stay inside their rects;
 * - every structure of every map draws something (R7's gap is closed);
 * - the map gets the farm style's fence, open at the west gate, within the draw-call budget.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { LAYOUT, NEIGHBOUR_ROOFS } from '../src/config';
import { Direction, MAP_IDS, STRUCTURE_KINDS, type StructureKind } from '../src/core/types';
import { STRUCTURE_COLORS, createPartSet, type PartSet } from '../src/render/geometryParts';
import { getSharedGlowGlassMaterial } from '../src/render/materials';
import { PALETTE } from '../src/render/palette';
import type { SceneContext } from '../src/render/SceneContext';
import { planScenery } from '../src/render/sceneryGeometry';
import { FARMHOUSE_STEP_DEPTH, createFarmhouseGeometry, farmhousePlacement } from '../src/render/structureGeometry';
import { StructureRenderer } from '../src/render/StructureRenderer';
import { COOP_INSET, COOP_SHAPE, structureParts } from '../src/render/townGeometry';
import { tileCenterX, tileMinX, tileMinZ } from '../src/world/grid';
import { MAPS, type StructurePlacement } from '../src/world/maps';
import { NEIGHBOURS_BACK_BAND_DEPTH } from '../src/world/maps/neighbours';
import { BASE, withPlayer } from './testUtils';

const EPS = 1e-6;

/** Meshes the renderer would draw: visible, and instanced meshes only when they hold instances. */
function drawCalls(root: THREE.Object3D): number {
  let calls = 0;
  root.traverseVisible((object) => {
    if (object instanceof THREE.InstancedMesh) calls += object.count > 0 ? 1 : 0;
    else if (object instanceof THREE.Mesh) calls += 1;
  });
  return calls;
}

/** Sums of one attribute's x, y and z components over every vertex. */
function attributeSums(geometry: THREE.BufferGeometry, name: string): [number, number, number] {
  const attribute = geometry.getAttribute(name);
  const sums: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < attribute.count; i++) {
    sums[0] += attribute.getX(i);
    sums[1] += attribute.getY(i);
    sums[2] += attribute.getZ(i);
  }
  return sums;
}

function colorAt(geometry: THREE.BufferGeometry, i: number): THREE.Color {
  const color = geometry.getAttribute('color');
  return new THREE.Color(color.getX(i), color.getY(i), color.getZ(i));
}

function sameColor(a: THREE.Color, b: THREE.Color): boolean {
  return Math.abs(a.r - b.r) < 1e-6 && Math.abs(a.g - b.g) < 1e-6 && Math.abs(a.b - b.b) < 1e-6;
}

describe('farmhouse roof colour', () => {
  const farm = farmhousePlacement(MAPS.farm.grid, LAYOUT.house, LAYOUT.houseDoor);

  it("builds the farm's farmhouse exactly as before without a roof colour", () => {
    // Pinned from the farmhouse as it was built before FarmhouseSpec had a roof colour.
    expect(farm.spec).toEqual({ width: expect.closeTo(4.4, 9), depth: expect.closeTo(4.1, 9), doorOffsetX: expect.closeTo(0, 9), stepDepth: 0.52 });
    const house = createFarmhouseGeometry(farm.spec);
    expect(Object.keys(house.body.attributes)).toEqual(['position', 'normal', 'color']);
    expect(house.body.getAttribute('position').count).toBe(3708);
    expect(house.glass.getAttribute('position').count).toBe(216);
    const expected: readonly (readonly [THREE.BufferGeometry, string, readonly [number, number, number]])[] = [
      [house.body, 'position', [1554.768013, 5737.09278, 4165.047803]],
      [house.body, 'normal', [0, 0.664085, 0]],
      [house.body, 'color', [1546.319354, 1036.524514, 844.572806]],
      [house.glass, 'position', [182.880002, 329.077111, 306.539995]],
    ];
    for (const [geometry, name, sums] of expected) {
      const actual = attributeSums(geometry, name);
      sums.forEach((sum, axis) => expect(actual[axis], `${name} ${axis}`).toBeCloseTo(sum, 3));
    }
    expect(house.height).toBeCloseTo(4.52428, 5);
  });

  it('recolours exactly the roof and the door awning, and moves nothing', () => {
    const plain = createFarmhouseGeometry(farm.spec);
    const roofed = createFarmhouseGeometry({ ...farm.spec, roofColor: NEIGHBOUR_ROOFS.cosmoHouse });
    expect(Array.from(roofed.body.getAttribute('position').array)).toEqual(Array.from(plain.body.getAttribute('position').array));
    expect(Array.from(roofed.body.getAttribute('normal').array)).toEqual(Array.from(plain.body.getAttribute('normal').array));
    expect(Array.from(roofed.glass.getAttribute('position').array)).toEqual(Array.from(plain.glass.getAttribute('position').array));
    // The farm's roof, its shingle rows and ridge, and the awning (in the roof colour) are the only parts that change.
    const roofTones = [PALETTE.houseRoof, STRUCTURE_COLORS.roofShade, STRUCTURE_COLORS.roofRidge].map((hex) => new THREE.Color(hex));
    let recoloured = 0;
    for (let i = 0; i < plain.body.getAttribute('color').count; i++) {
      const before = colorAt(plain.body, i);
      const onRoof = roofTones.some((tone) => sameColor(tone, before));
      expect(sameColor(colorAt(roofed.body, i), before), `vertex ${i}`).toBe(!onRoof);
      if (onRoof) recoloured++;
    }
    expect(recoloured).toBeGreaterThan(0);
    // Roofs in the new colour, shingles and ridge darker shades of it.
    const roof = new THREE.Color(NEIGHBOUR_ROOFS.cosmoHouse);
    let inNewRoof = 0;
    for (let i = 0; i < roofed.body.getAttribute('color').count; i++) if (sameColor(colorAt(roofed.body, i), roof)) inNewRoof++;
    expect(inNewRoof).toBeGreaterThan(0);
  });
});

describe('the Neighbours buildings', () => {
  const def = MAPS.neighbours;
  const grid = def.grid;

  function placed(kind: StructureKind): StructurePlacement {
    const s = def.structures.find((st) => st.kind === kind);
    if (s === undefined) throw new Error(`no ${kind} on the Neighbours map`);
    return s;
  }

  function partsOf(s: StructurePlacement): PartSet {
    const parts = createPartSet();
    structureParts(grid, def.cosmeticOffset, s, parts);
    return parts;
  }

  function boundsOf(geometries: readonly THREE.BufferGeometry[]): THREE.Box3 {
    const bounds = new THREE.Box3();
    for (const g of geometries) bounds.union(new THREE.Box3().setFromBufferAttribute(g.getAttribute('position') as THREE.BufferAttribute));
    return bounds;
  }

  const farmHeight = createFarmhouseGeometry(farmhousePlacement(MAPS.farm.grid, LAYOUT.house, LAYOUT.houseDoor).spec).height;

  it('draws every structure of every map, and every structure kind stands on some map', () => {
    const kinds = new Set<StructureKind>();
    for (const id of MAP_IDS) {
      const map = MAPS[id];
      for (const s of map.structures) {
        const parts = createPartSet();
        structureParts(map.grid, map.cosmeticOffset, s, parts);
        expect(parts.body.length, `${id}: ${s.kind} at (${s.rect.x0}, ${s.rect.z0})`).toBeGreaterThan(0);
        kinds.add(s.kind);
      }
    }
    expect([...kinds].sort()).toEqual([...STRUCTURE_KINDS].sort());
  });

  it('keeps both houses and the coop inside their rects, standing on the ground', () => {
    for (const kind of ['cosmoHouse', 'chickenCoop', 'barnabyHouse'] as const) {
      const s = placed(kind);
      const parts = partsOf(s);
      const body = boundsOf([...parts.body, ...parts.glass]);
      expect(body.min.x, kind).toBeGreaterThanOrEqual(tileMinX(grid, s.rect.x0) - EPS);
      expect(body.max.x, kind).toBeLessThanOrEqual(tileMinX(grid, s.rect.x0 + s.rect.width) + EPS);
      expect(body.min.z, kind).toBeGreaterThanOrEqual(tileMinZ(grid, s.rect.z0) - EPS);
      expect(body.max.z, kind).toBeLessThanOrEqual(tileMinZ(grid, s.rect.z0 + s.rect.depth) + EPS);
      expect(body.min.y, kind).toBeGreaterThanOrEqual(-0.06);
      // Everything tall stands in the back band, which every one of these fills to its front row.
      expect(s.rect.z0 + s.rect.depth).toBeLessThanOrEqual(NEIGHBOURS_BACK_BAND_DEPTH);
    }
  });

  it("builds the houses at the farmhouse's scale, door on the door tile, with glowing windows", () => {
    for (const kind of ['cosmoHouse', 'barnabyHouse'] as const) {
      const s = placed(kind);
      if (s.door === null) throw new Error(`${kind} has no door`);
      const { spec, origin } = farmhousePlacement(grid, s.rect, s.door);
      expect(origin.x + spec.doorOffsetX).toBeCloseTo(tileCenterX(grid, s.door.tx), 9);
      expect(spec.stepDepth).toBe(FARMHOUSE_STEP_DEPTH);
      const parts = partsOf(s);
      // Five tiles deep like the farm's house, so the same roof rise and chimney height.
      expect(boundsOf(parts.body).max.y).toBeCloseTo(farmHeight, 5);
      expect(boundsOf(parts.glass).isEmpty()).toBe(false);
    }
  });

  it('roofs the two houses in their own colours and otherwise builds them alike', () => {
    expect(new Set([NEIGHBOUR_ROOFS.cosmoHouse, NEIGHBOUR_ROOFS.barnabyHouse, PALETTE.houseRoof]).size).toBe(3);
    const cosmo = placed('cosmoHouse');
    const barnaby = placed('barnabyHouse');
    const [a] = partsOf(cosmo).body;
    const [b] = partsOf(barnaby).body;
    if (a === undefined || b === undefined) throw new Error('a house built no body');
    const shift = tileMinX(grid, barnaby.rect.x0) - tileMinX(grid, cosmo.rect.x0);
    const pa = a.getAttribute('position');
    const pb = b.getAttribute('position');
    expect(pb.count).toBe(pa.count);
    let differ = 0;
    for (let i = 0; i < pa.count; i++) {
      expect(pb.getX(i) - shift).toBeCloseTo(pa.getX(i), 4);
      expect(pb.getY(i)).toBe(pa.getY(i));
      expect(pb.getZ(i)).toBe(pa.getZ(i));
      if (!sameColor(colorAt(a, i), colorAt(b, i))) differ++;
    }
    expect(Array.from(b.getAttribute('normal').array)).toEqual(Array.from(a.getAttribute('normal').array));
    expect(differ).toBeGreaterThan(0);
    expect(differ).toBeLessThan(pa.count / 2);
  });

  it('builds the coop lower than the houses, with a ramp out front and a glowing window', () => {
    const s = placed('chickenCoop');
    expect(s.door).toBeNull();
    const parts = partsOf(s);
    const body = boundsOf(parts.body);
    expect(body.max.y).toBeLessThan(farmHeight);
    // The ramp reaches out over the front inset, towards the lane.
    const wallFront = tileMinZ(grid, s.rect.z0 + s.rect.depth) - COOP_INSET.front;
    expect(body.max.z).toBeGreaterThanOrEqual(wallFront + COOP_SHAPE.rampRun - EPS);
    expect(boundsOf(parts.glass).isEmpty()).toBe(false);
  });

  it('fences the map in the farm style, with a gap at the west gate', () => {
    const plan = planScenery(def);
    expect(plan).toMatchObject({ fence: true, wall: false });
    expect(plan.gaps).toHaveLength(1);
    const gap = plan.gaps[0];
    if (gap === undefined) throw new Error('no gap');
    expect(gap.side).toBe('west');
    expect(gap.min).toBeLessThanOrEqual(tileMinZ(grid, 14));
    expect(gap.max).toBeGreaterThanOrEqual(tileMinZ(grid, 15));
  });

  it('draws the Neighbours map within the draw-call budget, its glass with the shared glow material', () => {
    const scene = new THREE.Scene();
    const renderer = new StructureRenderer({ scene } as unknown as SceneContext);
    const root = scene.getObjectByName('StructureRenderer');
    if (root === undefined) throw new Error('no root group');
    renderer.sync(withPlayer(BASE, { tx: 1, tz: 14 }, Direction.East, 'neighbours'), null);
    expect(root.children.filter((g) => g.visible).map((g) => g.name)).toEqual(['scenery-neighbours']);
    expect(drawCalls(root)).toBeLessThanOrEqual(14);
    const glass = root.getObjectByName('glow-glass');
    expect(glass instanceof THREE.Mesh && glass.material === getSharedGlowGlassMaterial()).toBe(true);
    renderer.dispose();
  });
});
```

The fingerprint in "builds the farm's farmhouse exactly as before" was taken from `createFarmhouseGeometry` at `p4a-people`'s spec commit (`245409a`), with the farm's spec as `housePlacement` built it: 3,708 body vertices and 216 glass vertices, and the sums of every position, normal and colour component. Any change to the farm's farmhouse moves at least one of them by far more than the tolerance.

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run tests/neighbourBuildings.test.ts`
Expected: FAIL. The file doesn't get as far as its tests: `farmhousePlacement` and `NEIGHBOUR_ROOFS` don't exist yet, so the describe bodies throw `TypeError: ... farmhousePlacement is not a function` while collecting (`npm run typecheck` reports the missing exports `NEIGHBOUR_ROOFS`, `FARMHOUSE_STEP_DEPTH`, `farmhousePlacement`, `COOP_INSET` and `COOP_SHAPE` too). Even with those, "draws every structure of every map" would fail on the Neighbours map's `cosmoHouse` with `expected 0 to be greater than 0`: until now the three new kinds draw nothing (R7).

- [ ] **Step 3: Implement**

**3a. `src/config.ts`.** Insert directly after the closing `} as const;` of `ROBOT_SCREEN` (the line after `  cardDefaults: { returnMinute: 18 * 60, tokensBelow: 10 },`):

```ts

/**
 * Roof colours (sRGB hex) of the neighbours' farmhouses (farmclaws part 4a spec §5.2): the farm's
 * cottage under each farmer's own roof. Cosmo's is sunflower yellow, Barnaby's a bright blue.
 */
export const NEIGHBOUR_ROOFS = {
  cosmoHouse: 0xe9b949,
  barnabyHouse: 0x5b84c4,
} as const satisfies Readonly<Record<'cosmoHouse' | 'barnabyHouse', number>>;
```

(Tasks 5 and 8 add `PEOPLE` and `NPC_LOOKS` to the same file; where each sits doesn't matter.)

**3b. `src/render/structureGeometry.ts`.**

Replace the imports:

```ts
import { Salt, hashFloat } from '../core/hash';
import type { WorldRect } from '../world/grid';
```

with:

```ts
import { Salt, hashFloat } from '../core/hash';
import type { GridSpec, TileCoord, TileRect } from '../core/types';
import { tileCenterX, tileMinX, tileMinZ, type WorldRect } from '../world/grid';
import { HEIGHTS } from './constants';
```

In `FarmhouseSpec`, replace:

```ts
  /** Depth of the porch step in front of the +Z wall. */
  readonly stepDepth: number;
}
```

with:

```ts
  /** Depth of the porch step in front of the +Z wall. */
  readonly stepDepth: number;
  /** Roof colour (sRGB hex); the shingle rows and the ridge are shades of it. Absent: the farm's roof. */
  readonly roofColor?: number;
}
```

In `FARMHOUSE_SHAPE`, replace:

```ts
  /**
   * Roof overhangs. Keep eaveOverhang ≤ the back inset and gableOverhang + 0.06 (barge boards)
   * ≤ the side inset the renderer uses, so the roof never reaches over neighbouring tiles.
   */
```

with:

```ts
  /**
   * Roof overhangs. Keep eaveOverhang ≤ FARMHOUSE_INSET.back and gableOverhang + 0.06 (barge
   * boards) ≤ FARMHOUSE_INSET.side, so the roof never reaches over neighbouring tiles.
   */
```

Insert directly after the closing `};` of `HOUSE_DOOR_COLORS` (before `function houseFrame`):

```ts

/** A recoloured roof's shingle rows and ridge cap, as fractions of its colour (linear RGB), close to the farm's own shades. */
const ROOF_TONES = { shingle: 0.78, ridge: 0.6 } as const;

/** The farm's roof colours, or the same roof in `spec.roofColor`. */
function houseRoofColors(spec: FarmhouseSpec): RoofColors {
  if (spec.roofColor === undefined) return HOUSE_ROOF_COLORS;
  return {
    roof: spec.roofColor,
    shingle: new THREE.Color(spec.roofColor).multiplyScalar(ROOF_TONES.shingle),
    ridge: new THREE.Color(spec.roofColor).multiplyScalar(ROOF_TONES.ridge),
    barge: HOUSE_ROOF_COLORS.barge,
  };
}

/** The farm's door colours, with the awning in `spec.roofColor` when there is one. */
function houseDoorColors(spec: FarmhouseSpec): DoorColors {
  return spec.roofColor === undefined ? HOUSE_DOOR_COLORS : { ...HOUSE_DOOR_COLORS, awning: spec.roofColor };
}
```

(`RoofColors` and `DoorColors` accept a `THREE.Color`: they are `THREE.ColorRepresentation`, and `paint` copies a `Color` as it is, in the linear working space, so the shades are exact fractions of the roof colour.)

In the doc comment of `createFarmhouseGeometry`, replace:

```ts
 * slope and the +X gable (with an attic window). The porch step reaches `stepDepth` past the
 * front wall; everything else stays within the wall footprint plus the roof overhang.
 */
```

with:

```ts
 * slope and the +X gable (with an attic window). The porch step reaches `stepDepth` past the
 * front wall; everything else stays within the wall footprint plus the roof overhang. With
 * `spec.roofColor` the roof and the door's awning take that colour; nothing else changes.
 */
```

In its body, replace:

```ts
  gableRoofParts(f.roof, HOUSE_ROOF_COLORS, parts);
```

with:

```ts
  gableRoofParts(f.roof, houseRoofColors(spec), parts);
```

and replace:

```ts
    HOUSE_DOOR_COLORS,
    parts,
  );
```

with:

```ts
    houseDoorColors(spec),
    parts,
  );
```

Then insert directly after the closing `}` of `createFarmhouseGeometry` (after its `return { body: …, glass: …, chimneyTop, height: chimneyTop.y };`, before the `// Shipping bin` banner):

```ts

/** How far a farmhouse's walls sit inside its rect. The front inset holds the porch step and the awning. */
export const FARMHOUSE_INSET = { side: 0.3, back: 0.3, front: 0.6 } as const;

/** Porch step depth; it stays inside the house rect so it never overlaps walkable tiles. */
export const FARMHOUSE_STEP_DEPTH = 0.52;

/**
 * Wall footprint inside a house rect, with the door centred on the door tile's column (on the
 * footprint's centre without a door), and the world position of the model's origin. The farm's
 * farmhouse and the neighbours' houses share it, so they are built at the same scale.
 */
export function farmhousePlacement(
  grid: GridSpec,
  rect: TileRect,
  door: TileCoord | null,
): { readonly spec: FarmhouseSpec; readonly origin: THREE.Vector3 } {
  const minX = tileMinX(grid, rect.x0) + FARMHOUSE_INSET.side;
  const maxX = tileMinX(grid, rect.x0 + rect.width) - FARMHOUSE_INSET.side;
  const minZ = tileMinZ(grid, rect.z0) + FARMHOUSE_INSET.back;
  const maxZ = tileMinZ(grid, rect.z0 + rect.depth) - FARMHOUSE_INSET.front;
  const centerX = (minX + maxX) / 2;
  return {
    spec: {
      width: maxX - minX,
      depth: maxZ - minZ,
      doorOffsetX: door === null ? 0 : tileCenterX(grid, door.tx) - centerX,
      stepDepth: FARMHOUSE_STEP_DEPTH,
    },
    origin: new THREE.Vector3(centerX, HEIGHTS.grassTop, (minZ + maxZ) / 2),
  };
}
```

(`constants.ts` imports nothing, and `structureGeometry.ts` doesn't import `townGeometry.ts`, so the new imports make no cycle.)

**3c. `src/render/StructureRenderer.ts`.**

In the file's doc comment, replace the fragment (the rest of that line may read "parts exchange" for "notice board" after Task 3; leave it as it is):

```ts
 * bin) and the town's structures (
```

with:

```ts
 * bin), the Neighbours map's two houses and coop, and the town's structures (
```

Replace:

```ts
import { Weather, type GameState, type GridSpec, type MapId, type TileCoord, type TileRect } from '../core/types';
```

with:

```ts
import { Weather, type GameState, type GridSpec, type MapId, type TileRect } from '../core/types';
```

Replace:

```ts
import { tileCenterX, tileMinX, tileMinZ } from '../world/grid';
```

with:

```ts
import { tileMinX, tileMinZ } from '../world/grid';
```

In the `./structureGeometry` import list, replace:

```ts
  createTreeTrunkGeometry,
  layoutFence,
```

with:

```ts
  createTreeTrunkGeometry,
  farmhousePlacement,
  layoutFence,
```

and replace:

```ts
  smoothstep,
  type FarmhouseSpec,
  type FenceLayout,
```

with:

```ts
  smoothstep,
  type FenceLayout,
```

Under "Tuning", replace:

```ts
/** How far the farmhouse walls sit inside the house rect. The front inset holds the porch step. */
const HOUSE_INSET = { side: 0.3, back: 0.3, front: 0.6 } as const;
/** Porch step depth; it stays inside the house rect so it never overlaps walkable tiles. */
const PORCH_STEP_DEPTH = 0.52;
/** Crate inset inside the shipping-bin rect (the lid overhangs a little of it). */
```

with:

```ts
/** Crate inset inside the shipping-bin rect (the lid overhangs a little of it). */
```

Delete `housePlacement` (it moved to `structureGeometry.ts` as `farmhousePlacement`), i.e. replace:

```ts
/** Wall footprint inside the house rect, with the door centred on the door tile's column. */
function housePlacement(grid: GridSpec, rect: TileRect, door: TileCoord): Placement<FarmhouseSpec> {
  const minX = tileMinX(grid, rect.x0) + HOUSE_INSET.side;
  const maxX = tileMinX(grid, rect.x0 + rect.width) - HOUSE_INSET.side;
  const minZ = tileMinZ(grid, rect.z0) + HOUSE_INSET.back;
  const maxZ = tileMinZ(grid, rect.z0 + rect.depth) - HOUSE_INSET.front;
  const centerX = (minX + maxX) / 2;
  return {
    spec: {
      width: maxX - minX,
      depth: maxZ - minZ,
      doorOffsetX: tileCenterX(grid, door.tx) - centerX,
      stepDepth: PORCH_STEP_DEPTH,
    },
    origin: new THREE.Vector3(centerX, HEIGHTS.grassTop, (minZ + maxZ) / 2),
  };
}

function binPlacement(grid: GridSpec, rect: TileRect): Placement<ShippingBinSpec> {
```

with:

```ts
function binPlacement(grid: GridSpec, rect: TileRect): Placement<ShippingBinSpec> {
```

In `buildFarmstead`, replace:

```ts
  const house = housePlacement(grid, layout.house, layout.houseDoor);
```

with:

```ts
  const house = farmhousePlacement(grid, layout.house, layout.houseDoor);
```

(`Placement<TSpec>`, `HEIGHTS`, `tileMinX` and `tileMinZ` stay: `binPlacement` still uses them. `farmhousePlacement` returns the same shape as `Placement<FarmhouseSpec>`.)

**3d. `src/render/townGeometry.ts`.**

In the file's doc comment, replace:

```ts
 * `glass` (the shared glow-glass mesh). Nothing here touches the scene or game state.
```

with:

```ts
 * `glass` (the shared glow-glass mesh). Nothing here touches the scene or game state. The same
 * dispatch builds the Neighbours map's back band: Cosmo's and Barnaby's houses (the farm's
 * cottage under each farmer's roof colour) and Cosmo's chicken coop, which with the hedges fill
 * that band (z 0–4), so they too can hide only more back band.
```

Replace:

```ts
import * as THREE from 'three';
import { Salt, hashFloat } from '../core/hash';
```

with:

```ts
import * as THREE from 'three';
import { NEIGHBOUR_ROOFS } from '../config';
import { Salt, hashFloat } from '../core/hash';
import { assertNever } from '../core/invariant';
```

Replace:

```ts
import { PALETTE } from './palette';
```

with:

```ts
import { PALETTE } from './palette';
import { createFarmhouseGeometry, farmhousePlacement } from './structureGeometry';
```

Insert the new section above the dispatch: replace

```ts
// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------
```

with:

```ts
// ---------------------------------------------------------------------------
// The Neighbours: two farmhouses and a chicken coop
// ---------------------------------------------------------------------------

type NeighbourHouseKind = Extract<StructureKind, 'cosmoHouse' | 'barnabyHouse'>;

/**
 * A neighbour's farmhouse: the farm's cottage, placed in its rect exactly as the farmhouse is in
 * the farm's (same insets, so the same scale), door on the door tile, under the farmer's roof
 * colour. Its chimney stays smokeless; the smoke belongs to the farm's farmstead.
 */
function neighbourHouseParts(grid: GridSpec, kind: NeighbourHouseKind, s: StructurePlacement, out: PartSet): void {
  const { spec, origin } = farmhousePlacement(grid, s.rect, s.door);
  const house = createFarmhouseGeometry({ ...spec, roofColor: NEIGHBOUR_ROOFS[kind] });
  out.body.push(house.body.translate(origin.x, origin.y, origin.z));
  out.glass.push(house.glass.translate(origin.x, origin.y, origin.z));
}

/** Proportions of the chicken coop, a plank shed on legs (world units, radians). */
export const COOP_SHAPE = {
  legHeight: 0.34,
  legWidth: 0.14,
  floorThickness: 0.1,
  wallHeight: 1.3,
  pitch: 0.62,
  roofThickness: 0.12,
  /** Keep eaveOverhang ≤ COOP_INSET.back and gableOverhang + 0.06 ≤ COOP_INSET.side: the roof stays inside the rect. */
  eaveOverhang: 0.26,
  gableOverhang: 0.2,
  cornerPost: 0.12,
  /** Gap between the vertical boards on the walls the camera sees. */
  boardSpacing: 0.3,
  /** The hens' door: centre along X from the footprint centre, size, at floor level. */
  henDoorX: 0.6,
  henDoorWidth: 0.36,
  henDoorHeight: 0.42,
  /** How far the hens' ramp reaches in front of the wall; it stays inside COOP_INSET.front. */
  rampRun: 0.6,
  rampWidth: 0.32,
  /** A small square window on the front, left of the hens' door; its centre is above the floor top. */
  windowX: -0.6,
  windowSize: 0.42,
  windowCenterHeight: 0.85,
  /** The nest box on the +X wall: length along Z, height, how far it stands out, centre above the floor top. */
  nestLength: 1.1,
  nestHeight: 0.5,
  nestDepth: 0.26,
  nestCenterHeight: 0.45,
  /** Downward tilt of the nest box's lid (radians). */
  nestLidTilt: 0.3,
} as const;

/** How far the coop's walls sit inside its rect. The front inset holds the ramp; the others the roof overhang and the nest box. */
export const COOP_INSET = { side: 0.35, back: 0.35, front: 0.75 } as const;

const COOP_COLORS = {
  wall: 0xd8b07e,
  boards: 0xc49a68,
  trim: 0x8a5f3e,
  legs: 0x7a5236,
  floor: 0x9c6b45,
  roof: { roof: 0x9b6a4e, shingle: 0x8a5c42, ridge: 0x7a5038, barge: 0x8a5f3e } satisfies RoofColors,
  opening: 0x4a3426,
  ramp: 0xb88a5a,
} as const;

const COOP_WINDOW: WindowStyle = {
  ...WINDOW_FRAME,
  trim: COOP_COLORS.trim,
  shutter: COOP_COLORS.trim,
  shutterDark: COOP_COLORS.trim,
};

/** The coop in its own space: origin on the ground at the centre of the wall footprint, front on +Z. */
export interface CoopSpec {
  readonly width: number;
  readonly depth: number;
}

/**
 * A plain wooden coop: a plank shed raised on four legs under a gabled roof, with vertical boards
 * on the two walls the camera sees, a small window, the hens' door with a cleated ramp down to the
 * ground, a nest box with a sloped lid on the +X wall and a vent in the +X gable.
 */
export function createCoopParts(spec: CoopSpec, out: PartSet): void {
  const C = COOP_SHAPE;
  const halfW = spec.width / 2;
  const halfD = spec.depth / 2;
  const floorTop = C.legHeight + C.floorThickness;
  const wallTop = floorTop + C.wallHeight;
  const wallMid = floorTop + C.wallHeight / 2;
  const roof: GableRoofSpec = {
    halfW,
    halfD,
    wallTop,
    pitch: C.pitch,
    thickness: C.roofThickness,
    eaveOverhang: C.eaveOverhang,
    gableOverhang: C.gableOverhang,
  };

  // Legs and the floor the shed stands on.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const leg = { x: sx * (halfW - C.legWidth / 2), y: C.legHeight / 2, z: sz * (halfD - C.legWidth / 2) };
      out.body.push(box(C.legWidth, C.legHeight, C.legWidth, leg, COOP_COLORS.legs));
    }
  }
  const floor = { y: C.legHeight + C.floorThickness / 2 };
  out.body.push(box(spec.width + 0.06, C.floorThickness, spec.depth + 0.06, floor, COOP_COLORS.floor));

  // Walls, gables, boards, corner posts and the roof.
  out.body.push(box(spec.width, C.wallHeight, spec.depth, { y: wallMid }, COOP_COLORS.wall));
  out.body.push(gableWallPart(roof, COOP_COLORS.wall));
  for (let x = -halfW + C.boardSpacing; x < halfW - C.boardSpacing / 2; x += C.boardSpacing) {
    out.body.push(box(0.035, C.wallHeight - 0.1, 0.02, { x, y: wallMid, z: halfD + 0.01 }, COOP_COLORS.boards));
  }
  for (let z = -halfD + C.boardSpacing; z < halfD - C.boardSpacing / 2; z += C.boardSpacing) {
    out.body.push(box(0.02, C.wallHeight - 0.1, 0.035, { x: halfW + 0.01, y: wallMid, z }, COOP_COLORS.boards));
  }
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      out.body.push(box(C.cornerPost, C.wallHeight, C.cornerPost, { x: sx * halfW, y: wallMid, z: sz * halfD }, COOP_COLORS.trim));
    }
  }
  gableRoofParts(roof, COOP_COLORS.roof, out);

  // The hens' door: a dark opening in a plank frame at floor level.
  const henY = floorTop + C.henDoorHeight / 2;
  const henFrame = { x: C.henDoorX, y: henY + 0.03, z: halfD + 0.025 };
  out.body.push(box(C.henDoorWidth + 0.12, C.henDoorHeight + 0.06, 0.05, henFrame, COOP_COLORS.trim));
  out.body.push(box(C.henDoorWidth, C.henDoorHeight, 0.05, { x: C.henDoorX, y: henY, z: halfD + 0.035 }, COOP_COLORS.opening));

  // The ramp runs from the door's sill down to the ground, with cleats for little feet.
  const angle = Math.atan2(floorTop, C.rampRun);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const ramp = { x: C.henDoorX, y: floorTop / 2, z: halfD + C.rampRun / 2, rx: angle };
  out.body.push(box(C.rampWidth, 0.04, Math.hypot(floorTop, C.rampRun), ramp, COOP_COLORS.ramp));
  for (const t of [0.25, 0.5, 0.75]) {
    const cleat = { x: C.henDoorX, y: floorTop * (1 - t) + 0.035 * cos, z: halfD + C.rampRun * t + 0.035 * sin, rx: angle };
    out.body.push(box(C.rampWidth - 0.04, 0.03, 0.04, cleat, COOP_COLORS.trim));
  }

  const windowAt = new THREE.Matrix4().makeTranslation(C.windowX, floorTop + C.windowCenterHeight, halfD);
  windowParts({ width: C.windowSize, height: C.windowSize, shutters: false, planter: false }, COOP_WINDOW, windowAt, out);

  // Nest box on the +X wall under a lid that slopes away from the wall.
  const nestX = halfW + C.nestDepth / 2;
  const nestY = floorTop + C.nestCenterHeight;
  out.body.push(box(C.nestDepth, C.nestHeight, C.nestLength, { x: nestX, y: nestY, z: 0 }, COOP_COLORS.wall));
  out.body.push(box(C.nestDepth, 0.06, C.nestLength + 0.04, { x: nestX, y: nestY - C.nestHeight / 2 + 0.03, z: 0 }, COOP_COLORS.trim));
  const lid = { x: nestX + 0.01, y: nestY + C.nestHeight / 2 + 0.04, z: 0, rz: -C.nestLidTilt };
  out.body.push(box(C.nestDepth + 0.04, 0.05, C.nestLength + 0.08, lid, COOP_COLORS.roof.roof));

  // A diamond vent high in the +X gable.
  const vent = { x: halfW + 0.02, y: wallTop + gableRoofFrame(roof).rise * 0.4, rx: Math.PI / 4 };
  out.body.push(box(0.04, 0.22, 0.22, vent, COOP_COLORS.opening));
}

/** The coop's wall footprint inside its rect; it has no door tile (the hens' door is part of the shed). */
function coopParts(grid: GridSpec, s: StructurePlacement, out: PartSet): void {
  const b = rectBounds(grid, s.rect);
  const minX = b.minX + COOP_INSET.side;
  const maxX = b.maxX - COOP_INSET.side;
  const minZ = b.minZ + COOP_INSET.back;
  const maxZ = b.maxZ - COOP_INSET.front;
  const local = createPartSet();
  createCoopParts({ width: maxX - minX, depth: maxZ - minZ }, local);
  const move = new THREE.Matrix4().makeTranslation((minX + maxX) / 2, HEIGHTS.grassTop, (minZ + maxZ) / 2);
  transformParts(local.body, move, out.body);
  transformParts(local.glass, move, out.glass);
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------
```

In `structureParts`, replace:

```ts
    case 'hedge':
      hedgeParts(grid, offset, s, out);
      return;
  }
}
```

with:

```ts
    case 'hedge':
      hedgeParts(grid, offset, s, out);
      return;
    case 'cosmoHouse':
    case 'barnabyHouse':
      neighbourHouseParts(grid, kind, s, out);
      return;
    case 'chickenCoop':
      coopParts(grid, s, out);
      return;
    default:
      assertNever(kind, 'structureParts');
  }
}
```

If Task 4 listed the three new kinds in this switch as cases that draw nothing (R7), delete those lines: each kind must appear once, or the later case is unreachable and the building stays blank (the "draws every structure of every map" test catches it). After this step the switch reads, with Task 3's `partsExchange` case: `partsExchange`, `well`, `lampPost`, `hedge`, `cosmoHouse` / `barnabyHouse`, `chickenCoop`, `default`.

Replace the doc comment of `mapStructureParts`:

```ts
/** Every structure of a map (the town's shops, board, well, lamp posts and hedges), in world space. */
```

(if Task 3 changed "board" to "parts exchange", quote it as Task 3 left it) with:

```ts
/** Every structure of a map (the town's shops, parts exchange, well, lamp posts and hedges; the Neighbours' houses, coop and hedges), in world space. */
```

Why these choices:
- **The houses go through `mapStructureParts`**, as the shops do, rather than a farmhouse mesh of their own: `createFarmhouseGeometry`'s body and glass are pushed into the map's `PartSet`, so `buildScenery` merges them into the one painted body and the one glow-glass mesh. The Neighbours map costs the same draw calls as any map with a fence and no farmstead (11 at most, under the budget of 14).
- **The same scale** means the same placement: the farm's `housePlacement` moves to `structureGeometry.ts` as `farmhousePlacement` and both use it, so the insets, porch step and every `FARMHOUSE_SHAPE` proportion are shared. A 6 × 5 rect gives a 5.4 × 4.1 footprint against the farm's 4.4 × 4.1; both are five tiles deep, so the roof rise and the chimney top are identical. Both doors sit on the rect's third column (x 5 of 3–8, x 26 of 24–29), so the two houses are the same model but for the roof.
- **`roofColor` absent keeps the farm byte-for-byte:** `houseRoofColors` and `houseDoorColors` return the very `HOUSE_ROOF_COLORS` and `HOUSE_DOOR_COLORS` objects, so every part is painted exactly as before; the test's fingerprint pins it.
- **Occlusion:** all three stay inside their rects (the roof overhangs fit the insets, the porch step and awning the house's front inset, the ramp the coop's front inset, the nest box and the lid the coop's side inset), and the rects fill the back band's z 0–4 with the hedges, so nothing walkable hides behind them.

- [ ] **Step 4: Run it and see it pass**

Run: `npx vitest run tests/neighbourBuildings.test.ts tests/scenery.test.ts tests/renderMaps.test.ts tests/neighboursMap.test.ts`
Expected: PASS (`neighbourBuildings.test.ts`: 9 tests). `scenery.test.ts` passes unchanged: the farm's farmhouse and draw calls are the same, and its "nothing on the other maps" case names only the farm and the forest.

- [ ] **Step 5: The full gate**

Run: `npm run typecheck && npm test && npm run build`
Expected: all green. `npm run build:check` isn't needed for this task (no new chunk or lazy import; `townGeometry.ts` and `structureGeometry.ts` were both in the main chunk already), but Task 10 runs it and the main chunk grows by the coop builder only.

- [ ] **Step 6: Commit**

```bash
git add src/config.ts src/render/structureGeometry.ts src/render/StructureRenderer.ts src/render/townGeometry.ts tests/neighbourBuildings.test.ts
git commit -m "Farmclaws part 4a: the Neighbours houses and chicken coop

Cosmo's and Barnaby's houses are the farm's cottage at the same scale, each under its
own roof colour (NEIGHBOUR_ROOFS), and the coop is a plain plank shed on legs with a
hens' ramp and a nest box. They merge into the map's painted body and glow glass like
the town's shops, so the map adds no draw calls, and structureParts now ends in an
exhaustive check so no structure kind can be left blank again. The farmhouse placement
moved next to the farmhouse builder so both maps share it; without a roof colour the
farm's farmhouse is built exactly as before, which a fingerprint test pins.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: The playbook and the spec sync

**Files:**
- Create: `.claude/skills/game-driven-qa/scenarios/farmclaws-part4a.md`
- Modify: `.claude/skills/game-driven-qa/SKILL.md` (quick-reference rows after the `Peek at a robot` row; one gotcha row after the `Keys do nothing while a robot screen is open` row)
- Modify: `docs/superpowers/specs/2026-09-29-farmclaws-design.md` (§9.1, §9.2, §11.2, §12), `docs/superpowers/specs/2026-10-06-farmclaws-part4a-people-design.md` (the sections the refinements change, and a new §11)

**Interfaces:**
- Consumes (all through the browser or the dev console):
  - Dev hooks on `window.__meadowlight`: `store`, `actions`, `addScriptedRobot(input)`; the probe's `__qa.fixtures()` (`withPlayer(state, coord, facing, mapId)`, `withTile`), `__qa.load`, `__qa.patch`, `__qa.key`, `__qa.shift`, `__qa.turn`, `__qa.walkTo`, `__qa.tick`, `__qa.sleep`, `__qa.mod`, `__qa.same`, `__qa.snap`.
  - State: `npcs` (`{ talks, talkedToday }` per id, Task 1), `MapDefinition.npcs` (Tasks 2 and 4), `ui.panel` `{ kind: 'talk', npc, line }` (Task 6), `maps.neighbours` (Task 4).
  - Modules read in the page: `/src/people/lines.ts` (`LINE_BANKS`, `lineFor`, Task 5), `/src/people/cast.ts` (`CAST`, Task 2).
  - The chat box's DOM (Task 7): root `.chat-box` (hidden with the `hidden` attribute when no talk panel is open), the `chat-box--phone` modifier, the **Close** button and one button per action.
  - Player-facing text from the spec, verbatim: the hint "Talk to {name}"; the toast "Someone's standing there."; the seven introductions and the reactive lines quoted in the checks below; "That belongs to the neighbours." (R9).
  - `npm run build:check`.
- Produces: the playbook; the `SKILL.md` rows; the spec edits below.

The playbook drives behaviour Tasks 1–9 built. A FAIL is a bug in that earlier code unless the spec supports what the game did.

- [ ] **Step 1: Write the playbook**

Create `.claude/skills/game-driven-qa/scenarios/farmclaws-part4a.md`:

````markdown
# Farmclaws part 4a — the people playbook

The browser check from the part 4a plan (Task 10 Step 4), as runnable snippets for the part 4a
spec §7. Start each numbered check from `?new` with the probe loaded (see SKILL.md), with the
browser pane **shown**. Each fenced `js` block is one `javascript_tool` call; lines naming
`find`, `computer`, `get_page_text` or `resize_window` are browser-pane tool calls. Expected
results come from the part 4a spec and `src/config.ts`.

Town landmarks: the west gate (0,16) from the farm · the east gate (39,16) to the Neighbours ·
the main street z 15–17 · the square x 14–25, z 7–19. The cast stands facing south, and you
talk to each from the tile below, facing north: Marigold (7,7) → stand (7,8) · Bram (16,7) →
(16,8) · Sol (21,7), beside the parts exchange's door (20,6) → (21,8) · Juniper (24,7) → (24,8)
· Tess (35,7) → (35,8). On the Neighbours map: the west gate (0,14) back to town · the lane
z 13–15 · Cosmo (7,13) faces south → stand (7,14) facing north · Barnaby (25,15) faces north →
stand (25,14) facing south. Cosmo's field is fenced x 3–10, z 5–12 (gate (6,12)); Barnaby's
x 20–29, z 16–25 (gate (24,16)).

**Talking.** E on a character opens the chat box and freezes the game; E, K, Enter, Escape or
**Close** close it. A chat adds 1 to `npcs[id].talks`, so the first chat shows the
introduction and later ones an everyday or reactive line. The everyday pick depends on the
seed and the day, so the checks compare the box with `lineFor` on the state just before the
chat, and with the bank, instead of quoting it.

**Walking.** `__qa.walkTo` is greedy and sidesteps when blocked; the cast blocks like a wall,
so walk to the tile below a character, not onto them. Setup may jump the player to town with
`F.withPlayer(s, { tx, tz }, facing, 'town')`: the walk from the farm isn't what's under test.

A helper used by several checks (paste it into each `javascript_tool` call that needs it):
```js
const chat = () => { const box = document.querySelector('.chat-box'); return box === null || box.hidden ? null : box.innerText; };
```

## 1. Talk to the four shopkeepers and Sol: introduction first, then an everyday line

```js
const F = await __qa.fixtures();
__qa.load(F.withPlayer(__qa.state(), { tx: 7, tz: 8 }, 0, 'town'));
await new Promise((r) => setTimeout(r, 100));
const L = await __qa.mod('/src/people/lines.ts');
const chat = () => { const box = document.querySelector('.chat-box'); return box === null || box.hidden ? null : box.innerText; };
const out = {};
for (const [id, tx] of [['marigold', 7], ['bram', 16], ['sol', 21], ['juniper', 24], ['tess', 35]]) {
  __qa.patch((s) => { Object.assign(s.player, { mapId: 'town', tx, tz: 8, facing: 0 }); });   // setup: in front of the character
  await new Promise((r) => setTimeout(r, 50));
  const hint = document.body.innerText.includes(`Talk to ${id[0].toUpperCase()}${id.slice(1)}`);
  await __qa.key('KeyE');
  const first = { panel: __qa.state().ui.panel, box: chat() };
  await __qa.key('KeyE');                                   // closes the box
  const closed = { panel: __qa.state().ui.panel.kind, box: chat() };
  const expected = L.lineFor(__qa.state(), id);             // picked from the state before the second chat
  await __qa.key('KeyE');
  const second = __qa.state().ui.panel;
  await __qa.key('Escape');
  out[id] = { hint, first, closed, second: second.line, secondIsEveryday: L.LINE_BANKS[id].everyday.includes(second.line), secondIsExpected: second.line === expected, npcs: __qa.state().npcs[id] };
}
out
```
For each of the five, expect `hint: true`; `first.panel` `{ kind: 'talk', npc: id, line: <its
introduction> }` and `first.box` containing the name, the role line and that introduction;
`closed` `{ panel: 'none', box: null }`; `secondIsEveryday: true`, `secondIsExpected: true`;
`npcs` `{ talks: 2, talkedToday: true }`. The introductions, verbatim:
- Marigold (General store): "Welcome! I'm Marigold. Seeds, fertiliser, a bigger backpack one day. Shop with me any time."
- Bram (Blacksmith): "Bram. Blacksmith. I sharpen tools and I don't do small talk."
- Sol (Parts exchange): "Sol. I used to seed fields by hand; now I build the hands. When your robots need parts, this is the place."
- Juniper (Carpenter): "Juniper. I build barns, coops and anything with a hammer. Soon, robots too."
- Tess (Ranch): "Hi there, I'm Tess. Chickens, cows and wheat to feed them. Come see the ranch."

(On a fresh farm the backpack holds parsnip seeds and no robot is on the bench, so neither
Marigold's "Out of seeds?" nor Juniper's bench line fires; a fresh farm's day 1 isn't rainy in
the default seed, but if Tess's second line is "Rain again. The cows don't mind, and neither do
I." check `__qa.state().weather`: on a watering day that line is right, and `secondIsEveryday`
is then false by design.)

Then talk to Marigold once more and screenshot the box: it sits along the bottom of the screen
above the hotbar, the name with the role line under it in smaller text, the line, a **Shop**
button, and **Close** at the top right. The game is frozen while it's open:
```js
__qa.patch((s) => { Object.assign(s.player, { mapId: 'town', tx: 7, tz: 8, facing: 0 }); });
await __qa.key('KeyE');
const before = __qa.state().time.minuteOfDay;
await new Promise((r) => setTimeout(r, 1500));
({ panel: __qa.state().ui.panel.kind, minuteBefore: before, minuteAfter: __qa.state().time.minuteOfDay })
```
Expect `panel: 'talk'` and the two minutes equal. Leave the box open for check 2.

## 2. Marigold's Shop opens the seed shop; buy a packet

With Marigold's box open (check 1's last step, or repeat it), `find "Shop"` → click.
```js
({ panel: __qa.state().ui.panel, gold: __qa.state().player.gold })
```
Expect `panel: { kind: 'shop' }` and the chat box gone (screenshot: the seed shop). In the
shop, `find "×1"` → click the first one (the first seed in the list).
```js
const s = __qa.state(); ({ gold: s.player.gold, toasts: __qa.snap(1).toasts, seeds: s.inventory.slots.filter((x) => x?.itemId.endsWith('_seeds')).map((x) => `${x.itemId} ×${x.quantity}`) })
```
Expect `gold` lower than check 2's first reading by that seed's price (Parsnip seeds cost 20g
in spring: 500 → 480 on a fresh farm), and one more of that seed in the backpack. Escape
closes the shop (`panel: 'none'`).

## 3. A reactive line: a ruined robot, then Sol

The robot drives into the pond and spends the night there, so it's ruined in the morning. The
shore is laid by hand so the check doesn't depend on the seed's rocks (as in part 3's check 8).
```js
const F = await __qa.fixtures(); const W = await __qa.mod('/src/world/tiles.ts'); let s = __qa.state();
for (let tz = 21; tz <= 26; tz++) s = F.withTile(s, { tx: 38, tz }, W.EMPTY_TILE, 'farm');
s = F.withTile(s, { tx: 38, tz: 27 }, W.blockedTile(F.T.Blocker.Water), 'farm');
__qa.load(F.withPlayer(s, { tx: 36, tz: 23 }, 2, 'farm'));
const added = __meadowlight.addScriptedRobot({ name: 'Dunk', parts: ['claw'], loop: false, steps: [{ kind: 'move' }], place: { tx: 38, tz: 26, facing: 2 } });
__qa.tick(8);
const broken = __qa.robot('Dunk').power;
__qa.sleep();
({ added, broken, ruined: __qa.robot('Dunk').power })
```
Expect `added: "Added Dunk."`, `broken: 'broken'`, `ruined: 'ruined'`. Now talk to Sol; the
first chat is still his introduction, so record one chat first (setup):
```js
const F = await __qa.fixtures(); let s = __qa.state();
s = { ...s, npcs: { ...s.npcs, sol: { talks: 1, talkedToday: false } } };
__qa.load(F.withPlayer(s, { tx: 21, tz: 8 }, 0, 'town'));
await new Promise((r) => setTimeout(r, 100));
await __qa.key('KeyE');
const box = document.querySelector('.chat-box');
({ line: __qa.state().ui.panel.line, shown: box.innerText.includes(__qa.state().ui.panel.line) })
```
Expect `line: "Water and wires don't mix. Bring what's left of Dunk to the bench."` and
`shown: true`. Escape.

## 4. Through the east gate; Cosmo and Barnaby

```js
const F = await __qa.fixtures();
__qa.load(F.withPlayer(__qa.state(), { tx: 37, tz: 16 }, 1, 'town'));
await new Promise((r) => setTimeout(r, 100));
await __qa.key('KeyD', 120); await __qa.key('KeyD', 120);   // (38,16), then the gate tile (39,16)
const atGate = [__qa.state().player.tx, __qa.state().player.tz];
await __qa.key('KeyD', 120);                                  // off the edge: the warp
const p = __qa.state().player;
({ atGate, arrived: { mapId: p.mapId, at: [p.tx, p.tz], facing: p.facing } })
```
Expect `atGate: [39, 16]` and `arrived` `{ mapId: 'neighbours', at: [1, 14], facing: 1 }`.
Screenshot: the lane running east, Cosmo's house, coop and fenced dirt field on the left,
Barnaby's house behind and his bigger field across the lane, hedges along the back.
```js
const chat = () => { const box = document.querySelector('.chat-box'); return box === null || box.hidden ? null : box.innerText; };
const walk1 = await __qa.walkTo(7, 14); await __qa.turn(0);
const cosmoHint = document.body.innerText.includes('Talk to Cosmo');
await __qa.key('KeyE'); const cosmo1 = __qa.state().ui.panel.line; const cosmoBox = chat(); await __qa.key('KeyE');
const walk2 = await __qa.walkTo(25, 14); await __qa.turn(2);
const barnabyHint = document.body.innerText.includes('Talk to Barnaby');
await __qa.key('KeyE'); const barnaby1 = __qa.state().ui.panel.line; await __qa.key('KeyE');
await __qa.key('KeyE'); const barnaby2 = __qa.state().ui.panel.line; await __qa.key('Escape');
({ walk1: walk1.arrived, walk2: walk2.arrived, cosmoHint, cosmo1, cosmoBox, barnabyHint, barnaby1, barnaby2 })
```
Expect both walks `true`, both hints `true`, `cosmo1: "Hi! I'm Cosmo. My robot is the biggest
one in the valley. It mostly says hello to the chickens."` with `cosmoBox` showing "Cosmo" and
"Farmer"; `barnaby1: "Barnaby. Four robots, one field, zero effort. That's the future, and I'm
already living in it."`; `barnaby2: "No robots yet? You're leaving money in the field,
friend."` (a fresh farm has no robots). Then walk back west along the lane and off the edge at
(0,14): the player arrives in town at (38,16) facing west.

## 5. Characters block walking and placing; the nameplate

```js
const F = await __qa.fixtures();
let s = F.withPlayer(__qa.state(), { tx: 7, tz: 8 }, 0, 'town');
s = { ...s, inventory: { ...s.inventory, selected: 8, slots: s.inventory.slots.map((x, i) => (i === 8 ? F.stack('chest', 1) : x)) } };   // setup: a chest in hand
__qa.load(s);
await new Promise((r) => setTimeout(r, 100));
await __qa.key('KeyW', 120);
const after = [__qa.state().player.tx, __qa.state().player.tz];
await __qa.key('Space');
const placed = __qa.state().maps.town;
const T = await __qa.mod('/src/world/tiles.ts');
({ after, toast: __qa.snap(1).toasts, tileObject: T.getTile(placed, 7, 7).object, panel: __qa.state().ui.panel.kind })
```
Expect `after: [7, 8]` (the step was refused), the toast "[warn] Someone's standing there.",
`tileObject: null` and `panel: 'none'`. Zoom in (`KeyZ` ×3) and screenshot: Marigold in front
of the player with the plate "Marigold" floating above her head. Turn east (`await
__qa.turn(1)`): screenshot, no plate (no character ahead). Press Escape to pause: with Marigold
ahead again (`await __qa.turn(0)`), the plate is hidden while the pause overlay is up; Escape
resumes and it comes back. Screenshot the cast from a few tiles back (`__qa.patch((s) => {
Object.assign(s.player, { tx: 21, tz: 11, facing: 0 }); })`): Sol in his tool apron beside the
parts exchange (a narrow two-storey workshop with a cog-and-claw sign, a big window and a crate
of parts by the door), and each character swaying gently, out of step with the others.

## 6. The chat box at phone width

`resize_window {preset: 'mobile'}`, reload `http://localhost:5173/?new`, load the probe, then:
```js
const F = await __qa.fixtures();
__qa.load(F.withPlayer(__qa.state(), { tx: 7, tz: 8 }, 0, 'town'));
await new Promise((r) => setTimeout(r, 100));
await __qa.key('KeyE');
const box = document.querySelector('.chat-box'); const r = box.getBoundingClientRect();
({ phone: box.classList.contains('chat-box--phone'), left: Math.round(r.left), right: Math.round(r.right), width: innerWidth, noSideScroll: document.documentElement.scrollWidth === innerWidth })
```
Expect `phone: true`, the box spanning the screen (`left` near 0, `right` near `width`) and
`noSideScroll: true`. Screenshot: the introduction wraps inside the box, **Shop** and **Close**
are both visible and tappable. Tap **Close** (`find "Close"` → click): `ui.panel.kind` is
`'none'`. `resize_window {preset: 'desktop'}`.

## 7. Sleep; the fields and fences are unchanged the next morning

```js
const F = await __qa.fixtures();
__qa.load(F.withPlayer(__qa.state(), { tx: 1, tz: 14 }, 1, 'neighbours'));
const before = structuredClone(__qa.state().maps.neighbours);
__qa.sleep();
const after = __qa.state().maps.neighbours;
const T = await __qa.mod('/src/world/tiles.ts');
({ day: __qa.state().time.absoluteDay, same: __qa.same(before, after), fence: T.getTile(after, 3, 5).object, gate: T.getTile(after, 6, 12).object, field: T.getTile(after, 5, 8).state })
```
Expect `day: 1` (the morning after day 0), `same: true`, `fence: { kind: 'woodFence' }`,
`gate: null` (the gap) and `field: 0` (`TileState.Unplowed`: bare dirt, not soil).

## 8. Save, reload on the Neighbours map; the builds

```js
const F = await __qa.fixtures();
let s = F.withPlayer(__qa.state(), { tx: 10, tz: 14 }, 1, 'neighbours');
s = { ...s, npcs: { ...s.npcs, cosmo: { talks: 3, talkedToday: true } } };
__qa.load(s);
({ at: [__qa.state().player.mapId, __qa.state().player.tx, __qa.state().player.tz] })
```
Expect `at: ['neighbours', 10, 14]`. Reload `http://localhost:5173/` **without** `?new` (the
page saves as it unloads), load the probe again:
```js
const s = __qa.state(); ({ version: s.version, at: [s.player.mapId, s.player.tx, s.player.tz], cosmo: s.npcs.cosmo, panel: s.ui.panel.kind })
```
Expect `version: 7`, `at: ['neighbours', 10, 14]`, `cosmo: { talks: 3, talkedToday: true }`,
`panel: 'none'`. Screenshot: the Neighbours map around the player. `read_console_messages
{onlyErrors: true}` shows nothing from any check. Then, in a terminal, `npm run build:check`:
it ends with "check-bundle: OK" and finds none of the dev-hook names in `dist/`.
````

- [ ] **Step 2: The QA skill's rows**

In `.claude/skills/game-driven-qa/SKILL.md`, insert directly after the row that starts `| Peek at a robot |`:

```markdown
| Go to town or the Neighbours (setup) | `const F = await __qa.fixtures(); __qa.load(F.withPlayer(__qa.state(), { tx: 7, tz: 8 }, 0, 'town'))`; maps are `'farm'`, `'forest'`, `'town'`, `'neighbours'`. The town's east gate (39,16) leads to the Neighbours map (1,14). Playbook: `scenarios/farmclaws-part4a.md` |
| Talk to a character (part 4a) | Face them, `await __qa.key('KeyE')` ("Talk to {name}"): `__qa.state().ui.panel` → `{ kind: 'talk', npc, line }`, the box is `.chat-box`. E, K, Enter or Escape close it. Spots: Marigold (7,7), Bram (16,7), Sol (21,7), Juniper (24,7), Tess (35,7) in town; Cosmo (7,13), Barnaby (25,15) on the Neighbours map |
| Which line a character will say | `(await __qa.mod('/src/people/lines.ts')).lineFor(__qa.state(), 'sol')`; the banks are `LINE_BANKS`. The first chat (`npcs[id].talks` 0) is always the introduction |
```

and directly after the row that starts `| Keys do nothing while a robot screen is open |`:

```markdown
| `walkTo` stops short in town | The cast blocks like a wall. Walk to the tile in front of a character, not onto them; sidestep round them |
```

- [ ] **Step 3: The spec sync**

**3a. The farmclaws design, `docs/superpowers/specs/2026-09-29-farmclaws-design.md`** (spec §10).

1. §9.1, replace
   `They only chat. Their lines react to what's on the player's farm; for example, Wendell notices a flat robot left in a field. Lines are picked deterministically by day, like robot lines. None of them is the "correct" view. Each has a real point and a blind spot.`
   with
   `They only chat. They stand on fixed spots: the shopkeepers by their shops, Sol by the parts exchange, and Cosmo and Barnaby by their fields on the Neighbours map, east of the town. Their lines react to what's on the player's farm; for example, Wendell notices a flat robot left in a field. Lines are picked deterministically by day, like robot lines. None of them is the "correct" view. Each has a real point and a blind spot.`

2. §9.2, after the shops table (directly before the line `**At the parts exchange:**`), insert:
   ```markdown
   The parts exchange is a town building where the notice board stood.

   ```

3. §11.2, in the row that starts `| 4 First jobs and shops |`, replace
   `**Also decides where other farmers' fields are**: this design hasn't put them on a map yet.`
   with
   `Built as 4a (people), 4b (shops and parts) and 4c (jobs). The neighbours' fields are on a new Neighbours map, east of the town.`

4. §12, replace
   `Part 8's migration also drops the cut v2 fields (friendship, gifts, cooking recipes).`
   with
   `Part 4a's migration (version 7) drops the friendship fields and the cut characters, Old Fennick and Pip; part 8's drops the rest of the cut v2 fields (gifts, cooking recipes).`

**3b. The part 4a spec, `docs/superpowers/specs/2026-10-06-farmclaws-part4a-people-design.md`.**

1. §2.2, replace
   `  - it is reachable from the map's arrival tiles;`
   with
   `  - it is reachable: one of its orthogonal neighbours is walkable, isn't another character's spot, and can be reached from one of the map's arrival tiles over walkable tiles that aren't character spots (checked on the world generated with seed 0; a map with characters generates the same world for every seed);`

2. §2.2, replace
   `  - no two characters share a tile, and each id appears on exactly one map.`
   with
   `  - no two characters share a tile, and each id appears on exactly one map (until step 4 places Cosmo and Barnaby, at most one).`

3. §3.1, replace
   `- The reducer opens `UiPanel { kind: 'talk'; npc: NpcId }`, which freezes the game like every panel, and records the chat (section 3.4).`
   with
   `- The reducer opens `UiPanel { kind: 'talk'; npc: NpcId; line: string }`, which freezes the game like every panel, and records the chat (section 3.4). The panel carries the line, picked before the chat is recorded; the chat box only shows it.`

4. §3.2, replace
   `  - Marigold: **Shop**, which closes the chat and opens the seed shop.`
   with
   `  - Marigold: **Shop**, which closes the chat and opens the seed shop, through one action, `talk/act`, that checks the talk panel is open on that character and the action is theirs.`

5. §4, replace
   `- `STRUCTURE_KINDS` gains `'partsExchange'` and loses `'noticeBoard'`.`
   with
   `- `STRUCTURE_KINDS` gains `'partsExchange'` and loses `'noticeBoard'`. (Section 5 adds the Neighbours map's kinds.)`

6. §5.2, replace
   `- **Houses** reuse the farmhouse's geometry builder (`FarmhouseSpec`) at the same scale, with each farmer's own roof colour (`NEIGHBOUR_ROOFS` in config). The coop is a small shed in the coop style of the farm buildings, or a plain wooden shed if no coop builder exists.`
   with
   ```markdown
   - **Structure kinds:** the houses and the coop are `'cosmoHouse'`, `'barnabyHouse'` and `'chickenCoop'` in `STRUCTURE_KINDS`.
   - **Houses** reuse the farmhouse's geometry builder (`FarmhouseSpec`, which gains an optional roof colour) at the same scale, with each farmer's own roof colour (`NEIGHBOUR_ROOFS` in config). No coop builder exists, so the coop is a plain wooden shed.
   - **The neighbours' fences stay theirs:** on this map the pickaxe and the axe refuse an object on either field's fence ring with "That belongs to the neighbours."; anything the player puts down elsewhere comes back up as usual.
   - **Scenery:** the farm's style (a wooden fence round the grid, the farm's meadow tones) with its own cosmetic offset. The map's name is "The Neighbours".
   ```

7. §6.1, replace
   `- `UiPanel` gains `{ kind: 'talk'; npc: NpcId }`. The loader resets the panel, so this needs no migration.`
   with
   `- `UiPanel` gains `{ kind: 'talk'; npc: NpcId; line: string }`. The loader resets the panel, so this needs no migration.`

8. §8, replace
   ```markdown
   3. The parts exchange structure in the town and the east gate.
   4. The Neighbours map (layout, gates, migration of the map, checks).
   ```
   with
   ```markdown
   3. The parts exchange structure in the town, with its geometry.
   4. The Neighbours map (layout, both gates, migration of the map, checks).
   ```
   and replace
   ```markdown
   8. Rendering: the characters, nameplates, the parts exchange, the houses, the coop and the fences.
   9. The playbook, the QA skill rows, and the spec sync.
   ```
   with
   ```markdown
   8. Rendering the characters and their nameplates.
   9. Rendering the Neighbours houses and the coop (the fences are placed objects, drawn already).
   10. The playbook, the QA skill rows, and the spec sync.
   ```

9. At the end of the file, after §10's last bullet, append the refinements section. It lists R1–R19 from the plan's header, in order, as the plan's "Plan refinements of the spec" list words them:

```markdown

---

## 11. Plan refinements

Decided by the part 4a implementation plan and its execution. Each one keeps the intent of the rule it refines.
```

followed by one bullet per refinement, worded as the plan's list words it, with the spec section it refines in brackets at the end.

- [ ] **Step 4: Copy in the rulings recorded during execution**

List the part 4a commit bodies:

`git log --reverse --grep='^Farmclaws part 4a' --format='%n%h %s%n%b'`

Every ruling a commit body records (the spec's "pick the smallest change that keeps the rule's intent and write it down in the step's commit message", including any browser-check fix from Step 6) that the refinements list and edits 3a–3b don't already cover gets two edits in the part 4a spec: the section it changes is reworded to say the rule as it now stands, and §11 gains a bullet numbered on from the last one that names the commit's short hash.

- [ ] **Step 5: The full gate**

Run: `npm run typecheck && npm test && npm run build:check`
Expected: all green. `build:check` ends with "check-bundle: OK", its `main`, `screen` and `editor` rows each marked `ok`, and finds none of `robotLog|installRobotDev|addScriptedRobot|setMd|setZone|unlockAll` in `dist/`. (Part 4a adds no lazy chunk; the main chunk grows by the cast, the lines, the chat box and the character renderer, which must stay inside the main budget. If it doesn't, stop and tell Eli rather than raising the budget.)

- [ ] **Step 6: Run the playbook**

Invoke the `game-driven-qa` skill and follow its "Start every run like this" (dev server `meadowlight-dev`, `http://localhost:5173/?new`, the probe), with the browser pane shown. Run checks 1–8 of `scenarios/farmclaws-part4a.md`, each from a fresh `?new` farm (check 2 continues check 1), at desktop width; check 6 is the phone width (spec §9: "at desktop and phone width"). Then run part 3's check 1 (`scenarios/farmclaws-part3.md`) once, to confirm parts 1–3 still behave. Report one line per check, **PASS / FAIL — evidence**, as the skill says.

A FAIL is a bug unless the spec supports what the game did: reproduce it with `__qa.tick` or the dev hooks, write a failing unit test, fix it at source in its own commit (`Farmclaws part 4a: …`, with any ruling in the body), and run the check again. A ruling made that way goes into the part 4a spec through Step 4 before the spec commit. When all eight pass, add this line under the playbook's first paragraph, with the run's date: `Last run: YYYY-MM-DD — all eight checks PASS.`

Finish with `resize_window {preset: 'desktop'}`.

- [ ] **Step 7: Commit**

Two commits:

```bash
git add .claude/skills/game-driven-qa/scenarios/farmclaws-part4a.md .claude/skills/game-driven-qa/SKILL.md
git commit -m "Farmclaws part 4a: the people playbook and QA rows

Eight browser checks for spec section 7: every introduction, Marigold's Shop, Sol's
ruined-robot line, the east gate and the neighbours, blocking and the nameplate, the
phone layout, an unchanged night, and a save on the Neighbours map.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

```bash
git add docs/superpowers/specs/2026-09-29-farmclaws-design.md docs/superpowers/specs/2026-10-06-farmclaws-part4a-people-design.md
git commit -m "Farmclaws part 4a: sync the design and the part 4a spec with the build

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
