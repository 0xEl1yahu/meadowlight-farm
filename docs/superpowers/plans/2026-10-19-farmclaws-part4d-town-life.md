# Farmclaws Part 4d: Town Life Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The cast keep daily routines, six townsfolk walk their loops, shops keep hours behind 4c's gates, SLOPMART sells mystery boxes all night, the town gets its props and brand posters, and Cosmo gets his chickens and a door that opens: all in save version 10.

**Architecture:** One pure walking engine in `src/people/` moves every walker (characters and townsfolk) one tile a minute, in the minute loop after the robots and before 4c's job check. Saved `place`s replace 4a's fixed `MapDefinition.npcs`, so everything that found a character by its spot (movement, placement, talk, the renderer, 4c's drag-back) reads places instead. Shop hours, SLOPMART and the props are thin layers on top: pure rules in `src/people/`, intents and actions in `src/state/`, SLOPMART's panel in 4b's lazy shops chunk.

**Tech Stack:** TypeScript (strict, `erasableSyntaxOnly`), Three.js, Vite, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-13-farmclaws-part4d-town-life-design.md`. It's the binding authority for every rule, tile, time and line of text; this plan says where each piece goes and which tests pin it.

## Global Constraints

- Pure, deterministic simulation: no `Math.random`, clock reads or I/O in `src/core`, `src/state`, `src/world`, `src/farming`, `src/time`, `src/robots`, `src/jobs` or `src/people`. Randomness through `hash32` / `hashFloat`.
- No enums, namespaces or parameter properties; `as const` objects with union types; `import type` for types.
- Immutable state with structural sharing: a walker who didn't move keeps the same `place` object, and a minute where nobody moved returns the same `npcs` / `townsfolk` sections.
- Numbers, times and tiles in `src/config.ts` (`TIMETABLES`, `TOWNSFOLK`, `SHOP_HOURS`, `SLOP`) or map data, never inline.
- Player-facing text is copied verbatim from the spec, punctuation included.
- Saves: every saved field lands with its type, `createDefaultSections`, `migrateV9toV10` and validation in the same commit. `SAVE_VERSION = 10`. `v9Save` joins `tests/testUtils.ts`, and `v8Save` builds on it.
- No dev-hook words (`setMd`, `setZone`, `unlockAll`, `robotLog`, `installRobotDev`, `addScriptedRobot`) in production code, comments or strings.
- SLOPMART's panel lives in `src/ui/shops/` (the lazy shops chunk) and is never imported from the main chunk. The main chunk's allowance in `scripts/bundleRules.mjs` may grow by at most 8 KiB, recorded under Plan refinements (13 KiB after R10).
- Robot speech rule extends to DEALZ: every DEALZ line ends in " ✓"; only the toast says what you got.
- Gate per task: `npm run typecheck && npm test && npm run build`. Tasks 8–11 also run `npm run build:check`.
- Commits start `Farmclaws part 4d: ` and end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A big tick.** At time scale 16 one tick can carry up to 120 minutes. Walkers must end exactly where 120 one-minute ticks would put them, and the renderer must snap, not glide through walls. Pinned in Task 4 (`tick(120)` ≡ 120 × `tick(1)`) and Task 9 (multi-tile change snaps).
2. **A save made mid-walk:** Barnaby on the town side of the east gate at 11:40 am in the rain, Cosmo waiting for the player who stands in front of his door. It must reload to the same places. Pinned in Task 3 (round trip).
3. **Migrating a v9 save made at 1:30 am,** past midnight but before pass-out: every walker is indoors, and nobody spawns on a tile the player has built on. Pinned in Task 3.
4. **A chest on a stop** (not a prop tile): the walker walks to the nearest point, stays, and says the stuck line. It never oscillates, and never throws. Pinned in Task 5.
5. **Sleeping or passing out while a farmer is mid-gate or on the other map:** the next morning everyone is indoors on their home map. Pinned in Task 4.

---

## File map

| File | Responsibility |
| --- | --- |
| `src/world/path.ts` (new) | `findPath`, the map-agnostic breadth-first search (T1) |
| `src/robots/route.ts` | Robot routes as wrappers over `findPath` (T1) |
| `src/core/types.ts` | `SAVE_VERSION = 10`, new structure kinds (T2); `TOWNSFOLK_IDS`, `WalkerId`, `WalkerPlace`, `NpcTalk.place`, `townsfolk`, `slopShop`, `ShopsSoldToday.slopBoxes` (T3); `UiPanel` `slopShop`, talk panel naming a townsperson (T5, T7); slop item ids (T7) |
| `src/world/maps/town.ts` | Booth, props, south exits (T2) |
| `src/world/maps/neighbours.ts` | Cosmo's second gap, the chicken run (T2) |
| `src/world/maps/index.ts` | Door fronts on every map (T2); `assertNpcPlacements` replaced by `assertTimetables` (T3, T5) |
| `src/render/townGeometry.ts`, `src/render/StructureRenderer.ts` | Booth and prop geometry (T2); neon, DEALZ, signs, bunting (T10) |
| `src/config.ts` | `TIMETABLES`, `TOWNSFOLK` (T3); `SHOP_HOURS` (T6); `SLOP` (T7) |
| `src/people/timetable.ts` (new) | Legs, stops, homes, `currentLeg`, `targetOf`, `assertTimetables` (T3) |
| `src/people/townsfolk.ts` (new) | Townsfolk looks, exits, lines, `townsfolkLine` (T3, T5) |
| `src/people/walk.ts` (new) | `runWalkersMinute`, `isStuck`, `walkerAt`, `nudgeWalkersOff` (T4, T5) |
| `src/robots/run.ts` | `runMinutesThrough` (T4) |
| `src/state/reducer.ts` | `tick`, `startNextDay` (T4); movement and talk via places (T5); shop doors, B (T6); buying a box (T7) |
| `src/state/persistence.ts`, `src/state/sectionValidation.ts` | `migrateV9toV10` and validation (T2, T3, T7) |
| `src/people/cast.ts` | `npcAt` / `npcSpot` removed (T5); buttons with hours (T6) |
| `src/people/lines.ts` | Stuck line (T5); Barnaby's SLOPMART line (T7) |
| `src/robots/world.ts`, `src/jobs/setup.ts` | Drag-back uses farmer stops; generators nudge walkers (T5) |
| `src/people/shops.ts` (new) | `SHOP_DOORS`, `shopOpen`, `nextOpening` (T6) |
| `src/state/intents.ts` | `shopDoor` (T6), `slopShop` (T7) intents |
| `src/input/panelKeys.ts` | B and the slop panel's keys (T6, T7) |
| `src/people/slop.ts` (new) | Box contents, DEALZ's lines (T7) |
| `src/items/items.ts` | The twelve slop items (T7) |
| `src/ui/chatBoxView.ts` | Townsfolk speaker (T5) |
| `src/ui/shops/SlopShopPanel.ts` (new), `src/ui/ShopsHost.ts` | DEALZ's panel (T8) |
| `src/render/WalkerRenderer.ts` (replaces `NpcRenderer.ts`), `src/render/npcProps.ts` | Walkers, townsfolk props, dog and cart (T9) |
| `src/render/posters.ts`, `src/render/ChickenRenderer.ts` (new) | Brand posters, door signs (T10); chickens (T10) |

## Facts every task needs

- The minute loop today is `runRobotsThrough(state, lastMinute, afterMinute?)` in `src/robots/run.ts:143`, called from `tick` (`src/state/reducer.ts:206-214`) with `applyJobCheck`. `tick` skips the loop when there are no robots and no active job.
- Characters are found today through `npcAt(mapId, tx, tz)` / `npcSpot(npc)` (`src/people/cast.ts:54,62`), used by `src/state/reducer.ts:366` (movement), `src/state/intents.ts:391` (placement) and `:457` (talk), `src/render/NpcRenderer.ts`, `src/world/maps/index.ts:79-100` (`assertNpcPlacements`), `src/robots/world.ts:153` (drag-back), and the tests `cast`, `chatBox`, `determinism`, `gates`, `job1`–`job3`, `jobs`, `npcRender`, `partsShop`, `talk` and `workshop`.
- `NpcTalk` validation checks the exact keys `['talks', 'talkedToday']` (`src/state/sectionValidation.ts:42`).
- `lineFor` (`src/people/lines.ts:191`) picks the introduction, then the job hook, then reactive lines, then an everyday line.
- `freeSpotNear(world, from, taken)` is in `src/robots/workbench.ts:55`; `freeSpotInReach` in `src/robots/world.ts:146`.
- `chatBoxView(state)` (`src/ui/chatBoxView.ts:49`) is the single source for the chat box. The talk panel carries `npc` and `card: 'line' | 'job'`.
- `npcActions(state, npc)` (`src/people/cast.ts:111`) decides the buttons from `giverJob` and `isGateOpen` (`src/jobs/jobs.ts:94,126`).
- B is `KeyB` → `actions.setShopOpen(...)` in `src/input/panelKeys.ts:54`.
- 4b's daily stock is `shopsSoldToday` (`ShopsSoldToday`, `src/core/types.ts:1123`), restocked by `restocked` in `startNextDay`.
- `tests/testUtils.ts` has `v8Save`, `v7Save` … `livelySections()`, `withPlayer`, `atDay`, `withGold`, `withSlots`, `robotOf`.

## Interface contract

```ts
// src/world/path.ts (T1)
export type CanStep = (from: TileCoord, to: TileCoord) => boolean;
export function findPath(grid: GridSpec, from: TileCoord, to: TileCoord, canStep: CanStep): readonly TileCoord[] | null;

// src/core/types.ts (T3)
export const TOWNSFOLK_IDS = ['jogger', 'dogWalker', 'retiree', 'courier', 'busker', 'kid'] as const;
export type TownsfolkId = (typeof TOWNSFOLK_IDS)[number];
export type WalkerId = NpcId | TownsfolkId;
export type WalkerPlace =
  | { readonly kind: 'indoors' }
  | { readonly kind: 'out'; readonly mapId: MapId; readonly tx: number; readonly tz: number; readonly facing: Direction };
// NpcTalk gains `place: WalkerPlace`; GameSections gains
//   townsfolk: Readonly<Record<TownsfolkId, { readonly place: WalkerPlace }>>
//   slopShop: { readonly boxesOpened: number }            (T7)
// ShopsSoldToday gains `slopBoxes: number`                 (T7)

// src/people/timetable.ts (T3)
export type Stop = /* spec §2.1 */;
export interface Leg { readonly departs: number; readonly to: Stop }
export type Home = { readonly kind: 'door'; readonly mapId: MapId; readonly door: TileCoord } | { readonly kind: 'exit'; readonly tile: TileCoord };
export function walkerHome(id: WalkerId): Home;
export function legsFor(id: WalkerId, wet: boolean): readonly Leg[];
export function currentLeg(id: WalkerId, minute: number, wet: boolean): Leg | null; // null before the first leg
export function targetOf(id: WalkerId, minute: number, wet: boolean): { readonly mapId: MapId; readonly tile: TileCoord; readonly facing: Direction | null } | 'home';
export function homeFront(id: WalkerId): { readonly mapId: MapId; readonly tile: TileCoord }; // door front or exit tile
export function farmerStops(mapId: MapId): readonly TileCoord[];
export function assertTimetables(): void;
export function placeAt(id: WalkerId, minute: number, wet: boolean): WalkerPlace; // where the migration puts a walker

// src/people/walk.ts (T4, T5)
export function walkerPlace(state: GameState, id: WalkerId): WalkerPlace;
export function withWalkerPlace(state: GameState, id: WalkerId, place: WalkerPlace): GameState; // same state when unchanged
export function runWalkersMinute(state: GameState): GameState;
export function walkersIndoors(state: GameState): GameState; // the morning reset
export function walkerAt(state: GameState, mapId: MapId, tx: number, tz: number): WalkerId | null; // T5
export function isStuck(state: GameState, id: WalkerId): boolean; // T5
export function nudgeWalkersOff(state: GameState, mapId: MapId, tile: TileCoord): GameState; // T5

// src/robots/run.ts (T4) — replaces runRobotsThrough
export function runMinutesThrough(state: GameState, lastMinute: number, afterMinute?: (s: GameState) => GameState): GameState;

// src/people/townsfolk.ts (T3, T5)
export const TOWNSFOLK_PLATES: Readonly<Record<TownsfolkId, string>>;
export function townsfolkLine(state: GameState, id: TownsfolkId): string;

// src/people/shops.ts (T6)
export const SHOP_IDS = ['generalStore', 'blacksmith', 'carpenter', 'ranch', 'partsExchange'] as const;
export type ShopId = (typeof SHOP_IDS)[number];
export interface ShopDoor { readonly shop: ShopId; readonly door: TileCoord; readonly keeper: NpcId; readonly menu: 'shop' | 'partsShop' | 'workshop' | null; readonly gate: ShopGate | null }
export const SHOP_DOORS: readonly ShopDoor[];
export function shopOpen(state: GameState, shop: ShopId): boolean;
export function nextOpening(minute: number): string;
export function closedLine(minute: number): string; // "Sorry, we are closed! Open again at {time}."

// src/people/slop.ts (T7)
export type BoxContents = { readonly itemId: ItemId; readonly quantity: number };
export function boxAt(seed: number, boxesOpened: number, season: Season): BoxContents;
export function isGem(seed: number, boxesOpened: number): boolean;
export function dealzGreeting(state: GameState): string;
export function dealzResult(seed: number, boxesOpened: number, contents: BoxContents): string;
export const DEALZ_LINES: { readonly soldOut: string; readonly noGold: string; readonly bagFull: string };

// actions (T6, T7)
// 'shop/door' { shop: ShopId }   'slop/open'   'slop/buy'
// UiPanel gains { kind: 'slopShop'; line: string }  (line: DEALZ's current line)
// The talk panel's `npc` widens to WalkerId; townsfolk always use card 'line'.
```

## Plan refinements of the spec

- **R1.** `findPath` takes the grid and a `canStep(from, to)` callback rather than a world and `canEnter(tx, tz)`, because the robots' rule depends on the step (.MD DON'T cards check `from` → `to`). The behaviour is unchanged. (Spec §4.3)
- **R2.** The slop panel stores DEALZ's current line in the panel (`{ kind: 'slopShop', line }`), so refusals and results change the line without saved state. The loader resets panels, so nothing is migrated. (Spec §6.2)
- **R3.** A pace stop's facing may be null: the townsfolk's loops of several spots have no facing in spec §3.1, so a townsperson keeps the facing they walked in with, and `targetOf` reports null. Where the migration has to stand one on a loop spot without a walk, they face South. The single-spot loops (the retiree and the busker) are spot stops with their facing. (Spec §2.1, §9.2)
- **R4.** The farmers set off for lunch earlier, Cosmo at 11:15 am (was 11:30) and Barnaby at 11:05 am (was 11:15), because from their pace spots the walk took until 12:13 and 12:03; they now reach the square by 11:50 and 11:44. All seven characters are in the square from 12:25 pm (was 12:15): Marigold and Tallulah walk 17 and 21 tiles from their shops from 12:00 pm. (Spec §2.3, §10)
- **R5.** Barnaby's pace moves on every 25 minutes (was 20): (19, 20) is 21 steps round his field from (30, 22), so at 20 minutes he turned back one tile short every time. (Spec §2.3)
- **R6.** When only the player is in the way, a walker takes the route's first step and waits only when that step is onto the player's tile, so they walk up to the player and wait beside them, rather than freezing wherever they are. (Spec §4.3)
- **R7.** A stuck walker, with no route to their target even ignoring the player, walks to the reachable tile fewest Manhattan steps from the target (ties to the search's first visit) and stays there, rather than freezing wherever they are. A chest on a stop then leaves the walker beside it, as Review Focus 4 describes. `isStuck` is true on the way and once there. (Spec §4.3, §4.4)
- **R8.** The main chunk's gzip allowance in `scripts/bundleRules.mjs` rises from baseline + 40 KiB to baseline + 48 KiB, the spec's full +8 KiB for part 4d, because the main chunk had reached 315.7 KiB gzipped (limit 317.1 KiB) by Task 8, past the old 309.1 KiB. The shops chunk, with DEALZ's panel, is 5.1 KiB of its 20 KiB. (Spec §10)
- **R9.** A walker's glide lasts the robots' lerp time for a one-minute step (`glideSeconds(1, timeScale)`: 0.8 of a game minute, at most 0.45 s), not a robot's own `moveSeconds`, whose 4-minute period would make a walker glide past the next minute's step from 2× speed and trail tiles behind. At 1× they're the same 0.45 s. Walkers also keep swaying while they glide, so a step never jolts the sway. (Spec §4.6)
- **R10.** The main chunk's gzip allowance rises again, from baseline + 48 KiB to baseline + 53 KiB: 13 KiB for part 4d, past the 8 KiB the spec first allowed. Task 10's posters, door signs, neon, DEALZ, bunting and chickens took the main chunk from 324,684 to 329,335 gzipped bytes (321.6 KiB), 4,644 bytes over the old 324,691 limit; the new limit is 329,811, leaving 476 bytes. They share the one poster atlas (the brand posters, the banner, both sign faces and the neon are cells of it) and the shops' builders (the wall poster, the display Mini, the window spacing). (Spec: global rules, Bundle)
- **R11.** `migrateV9toV10` also moves the player and any robot off newly blocked tiles, clears objects from the chicken run's inside and from the two new exits, and moves displaced things with `freeSpotNear` on their own map (commit 6e15be2). Without it, a save standing on a prop tile would fail to load. (Spec §7.4, §9.2)
- **R12.** Outside hours, a keeper's shop button writes the closed line into the talk panel's existing `line` field. The plan's `override` field isn't added (commit b97e23e). (Spec §5.2)
- **R13.** The player and a walker waiting for them swap places. R6 parks a walker beside the player, and a walker's tile blocks the player, so together they pinned the player in a dead end or a one-tile gap: on Cosmo's door front (5, 5) at 8:00 pm, Cosmo parked on (5, 6), the only way out, until the 2:00 am pass-out. Now, when the player steps onto a walker whose plan this minute is to wait because its next step is onto the player's tile (`waitsForPlayer`, the walk's own plan, so the reducer and the walk agree), the player takes the walker's tile and the walker takes the player's old one, facing the way they were heading (`swapWithPlayer`). Everywhere else walkers still block. Both tiles stay valid saved places: the player's tile is walkable, and the walker's plan routes round robots, so none stands on it. (Spec §4.5)
- **R14.** DEALZ's chat is `SlopShopPanel` in 4b's lazy shops chunk (`src/ui/shops/`), reusing the chat box's CSS classes and phone width, not a third speaker in 4a's chat box view, which keeps the SLOPMART panel out of the main chunk as the global rules ask. The townsfolk speak through 4a's chat box view. (Spec §6.2)

---

### Task 1: findPath

**Files:**
- Create: `src/world/path.ts`
- Modify: `src/robots/route.ts` (the private `search` becomes a call to `findPath` with the robot's `canEnter` as `canStep`; `planRoute`, `reachableFrom`, `reachableInOrder`, `nextRouteAction` and `canEnter` keep their signatures)
- Test: `tests/findPath.test.ts`

**Interfaces:** Produces `findPath`, `CanStep` (contract).

- [ ] **Step 1: Write `tests/findPath.test.ts`:**
  - the shortest path on an open grid, excluding the start and including the target;
  - the `DIRECTIONS` tie-break order (the same path as the robots get today on a fixed case);
  - `null` for a walled-off target;
  - `[]` when from equals to;
  - `canStep` sees both ends of every step.
- [ ] **Step 2:** Run `npx vitest run tests/findPath.test.ts` and see it fail (no module).
- [ ] **Step 3:** Implement `findPath` and move `route.ts` onto it.
- [ ] **Step 4:** Run `npx vitest run tests/findPath.test.ts tests/robotRoute.test.ts tests/robotMd.test.ts tests/robotInterpret.test.ts tests/robotTurn.test.ts`. All pass, and the robot tests are unchanged.
- [ ] **Step 5:** Gate, and commit "Farmclaws part 4d: one path search for robots and walkers".

---

### Task 2: The maps change, and save version 10

The booth, the props, the south exits, Cosmo's second gap, the chicken run and the door-front check, with save version 10 migrating the tiles they change. (Spec §6.1, §7.1, §7.3, §7.4, §8, §9.2 Tiles)

**Files:**
- Modify: `src/core/types.ts`:
  - `SAVE_VERSION = 10`;
  - `STRUCTURE_KINDS` gains `'slopShop'`, `'marketStall'`, `'bench'`, `'planter'`, `'crates'`, `'barrels'` and `'cart'`.
- Modify: `src/world/maps/town.ts`:
  - hedge (28, 0, 3, 7) → `slopShop`, door (29, 6);
  - the prop structures at the spec's tiles;
  - reserved exits (0, 30) and (39, 30);
  - `assertTownLayout` gains the prop rules (grass only; not a door front or reserved tile; the low-kind list). The stop rule comes in Task 3.
- Modify: `src/world/maps/neighbours.ts`:
  - `FenceRing.gap` → `gaps: readonly TileCoord[]`, with Cosmo's `[(6, 12), (5, 5)]`;
  - the chicken run ring, corners (11, 5) and (15, 8), whose tiles hold `woodFence` objects;
  - `assertNeighboursLayout` checks every gap.
- Modify: `src/world/maps/index.ts`: `assertMapDefinitions` checks that every door's front tile is walkable on every map.
- Modify: `src/render/townGeometry.ts`, `src/render/StructureRenderer.ts`: low-poly geometry for the booth's body and each prop kind. The neon and DEALZ come in Task 10.
- Modify: `src/state/persistence.ts`: `migrateV9toV10`.
  - Set the town's new prop tiles to `blockedTile(Blocker.Building)`.
  - On the Neighbours map, clear (5, 5) and put `woodFence` on the run's ring.
  - Move any object on a newly blocked or fenced tile to `freeSpotNear` on that map, contents kept. Generalise `freeSpotNear` to take any world, if it's farm-only.
  - Chain it in `migrateSave`.
- Modify: `tests/testUtils.ts`: `v9Save(state)` (writes a v9 JSON from a v10 state); `v8Save` builds on it.
- Test: `tests/townProps.test.ts`, `tests/saveV10.test.ts` (created here, grown in Tasks 3 and 7).

**Interfaces:** Produces the structure kinds, the exits as reserved tiles, `NEIGHBOURS` fence gaps, `migrateV9toV10`, `v9Save`.

- [ ] **Step 1: Write `tests/townProps.test.ts`:**
  - the booth's blocked tiles equal the old hedge's;
  - every prop is on grass and off door fronts and reserved tiles;
  - the exits are reserved and walkable;
  - Cosmo's (5, 5) is walkable and his door front passes the every-map check;
  - the run's ring is fenced and its inside clear;
  - the generated maps match the definitions.
- [ ] **Step 2: Start `tests/saveV10.test.ts`:**
  - a v9 save migrates to version 10;
  - a chest with items on (9, 9) in town moves to the nearest free tile, items intact;
  - a v9 Neighbours map loses the fence at (5, 5) and gains the run;
  - the v2 fixture migrates all the way.
- [ ] **Step 3:** Run both and see them fail.
- [ ] **Step 4:** Implement the map data, geometry, checks, migration and `v9Save`. Update the version asserts in the existing save tests (`toBe(9)` → `toBe(10)`, and any "later version" literal of 10 → 11).
- [ ] **Step 5:** Run `npx vitest run tests/townProps.test.ts tests/saveV10.test.ts tests/maps.test.ts tests/neighboursMap.test.ts tests/saveV9.test.ts tests/renderMaps.test.ts` and see them pass.
- [ ] **Step 6:** Gate, and commit "Farmclaws part 4d: SLOPMART's booth, the town's props, Cosmo's door and chickens' run, save version 10".

---

### Task 3: Timetables, townsfolk and walker places

The data for everyone's day, the startup check, and the saved places. (Spec §2, §3.1–3.2, §4.1, §9)

**Files:**
- Modify: `src/config.ts`:
  - `TIMETABLES`: per character, the dry and wet legs from spec §2.2–2.3, including Sol at 6:00 am both days;
  - `TOWNSFOLK`: per townsperson, the exit, the loop spots, `everyMinutes` and the facing for single-spot loops; out at 8:00 am, home at 7:00 pm; wet days only for `jogger` and `courier`.
- Create: `src/people/timetable.ts` (contract). `assertTimetables` covers spec §2.5's rules plus the props: no stop or loop spot is on a prop, door front, reserved tile, field tile, generator tile or 4c robot start tile, and every stop is reachable from its walker's home front on the empty maps (across the east gate for the farmers).
- Create: `src/people/townsfolk.ts`: `TOWNSFOLK_PLATES`, the looks (fixed appearance plus a prop name each) and the lines, verbatim from spec §3.3.
- Modify: `src/core/types.ts`: the T3 contract types; `NpcTalk.place`; `GameSections.townsfolk`.
- Modify: `src/state/initialState.ts` (`createDefaultSections`): everyone `{ kind: 'indoors' }`.
- Modify: `src/state/sectionValidation.ts`:
  - `NpcTalk` keys `['talks', 'talkedToday', 'place']`;
  - an `isWalkerPlace` check: exact keys; an `out` place on a real map, in bounds, walkable and with a direction;
  - `townsfolk` has exactly the six ids.
- Modify: `src/state/persistence.ts`: `migrateV9toV10` sets each walker to `placeAt(id, minute, wet)` from the save's clock and weather. If that tile isn't walkable in the save (something was built there), the walker is indoors.
- Modify: `src/world/maps/index.ts`: `assertMapDefinitions` calls `assertTimetables`.
- Modify: `tests/testUtils.ts`: `livelySections()` gets places for a few walkers, out and indoors; `v9Save` strips `place` and `townsfolk`.
- Test: `tests/timetable.test.ts`, `tests/saveV10.test.ts` (extend), `tests/sections.test.ts` (extend).

**Interfaces:**
- Consumes `findPath` (T1) and the exits and gaps (T2).
- Produces the timetable functions, `TOWNSFOLK_PLATES`, the saved `place` fields and `placeAt`.

- [ ] **Step 1: Write `tests/timetable.test.ts`:**
  - `assertTimetables` passes;
  - `currentLeg` at each boundary for Sol (6:00 am dry and wet), Marigold (6:59, 7:00, 8:29, 8:30, 12:00, 12:50, 5:00, 7:00) and Cosmo (wet: no 11:15 leg, R4);
  - pace targets cycle every `everyMinutes`;
  - Sol's first leg departs at 6:00 am on both days;
  - the wet townsfolk are just the jogger and courier;
  - no farmer stop is on `COSMO_FIELD`, `BARNABY_FIELD`, a generator tile or a 4c robot tile.
- [ ] **Step 2: Extend `tests/saveV10.test.ts`:**
  - a v9 save at 12:30 pm, dry, puts all seven characters on their lunch spots;
  - at 7:30 am, wet: tradies indoors, Sol at work, farmers by their fields;
  - **at 1:30 am (minute 1530): everyone indoors (Review Focus 3)**;
  - a stop with a chest on it migrates that walker indoors;
  - one corrupted field per §9.3 rule (unknown place kind, out place with no facing, an off-map tile, a blocked tile, an extra key, a missing townsperson);
  - **a round trip with Barnaby on town (38, 16) at 11:40 am wet and Cosmo out on his door front (Review Focus 2)**.
- [ ] **Step 3:** Run them and see them fail.
- [ ] **Step 4:** Implement the config, `timetable.ts`, `townsfolk.ts`, the types, defaults, validation, migration and test helpers.
- [ ] **Step 5:** Run `npx vitest run tests/timetable.test.ts tests/saveV10.test.ts tests/sections.test.ts tests/persistence.test.ts` and see them pass.
- [ ] **Step 6:** Gate, and commit "Farmclaws part 4d: timetables for the cast and the townsfolk, and saved places".

---

### Task 4: The walk

Walkers move every minute; the minute loop and the morning change. (Spec §4.2, §4.3, §4.5 off-screen and frozen, §4.7)

**Files:**
- Create: `src/people/walk.ts`:
  - `walkerPlace`, `withWalkerPlace`, `runWalkersMinute`, `walkersIndoors`;
  - the private step for one walker, following spec §4.2–4.3: two plans (player blocked, then player ignored), robots' tiles never enterable, gate crossing through the map's warp, coming out of and stepping into a home front;
  - each walker's world is `state.maps[place.mapId]`.
- Modify: `src/robots/run.ts`: `runRobotsThrough` → `runMinutesThrough`; each minute runs robots, then `runWalkersMinute`, then `afterMinute`.
- Modify: `src/state/reducer.ts`:
  - `tick` always runs `runMinutesThrough` (the no-robots shortcut goes);
  - `startNextDay` calls `walkersIndoors`.
- Test: `tests/walk.test.ts`.

**Interfaces:**
- Consumes the timetable functions (T3) and `findPath` (T1).
- Produces `runWalkersMinute`, `walkersIndoors`, `walkerPlace`, `withWalkerPlace`, `runMinutesThrough`.

- [ ] **Step 1: Write `tests/walk.test.ts`:**
  - one tile per minute towards the target;
  - turning to the stop's facing on arrival;
  - **routing round:**
    - a chest placed mid-route;
    - a robot on the route, using `robotOf` on the Neighbours map;
  - **waiting while the player is the only way through,** then moving on when they step aside;
  - **doors and exits:**
    - stepping into the door at `home` and coming out at the next leg;
    - waiting when the player stands on the door front;
    - a townsperson leaves by (0, 30) and returns there;
  - **the east gate:**
    - Cosmo crosses neighbours (0, 14) → town (38, 16) and back after lunch;
  - **walkers and the world:**
    - two walkers share a tile without blocking each other;
    - walkers move while the player is on the farm;
    - nothing moves while a panel is open;
    - an unmoved walker keeps the same `place` object;
  - **the day on the empty maps:**
    - a simulated dry day gets every walker to every stop before their next leg departs;
    - both farmers are in the square by 12:00 pm;
    - all seven characters are there from 12:25 pm to 12:50 pm;
    - Barnaby reaches each of his three pace spots during his morning field leg;
  - **Review Focus 1:** from 6:00 am, `tick(120)` equals 120 × `tick(1)`;
  - **Review Focus 5:** sleeping and passing out with Cosmo in town at 12:30 pm and Barnaby on the gate tile; the next morning everyone is indoors.
- [ ] **Step 2:** Run `npx vitest run tests/walk.test.ts` and see it fail.
- [ ] **Step 3:** Implement `walk.ts`, `runMinutesThrough` and the reducer changes.
- [ ] **Step 4:** Run `npx vitest run tests/walk.test.ts tests/robotRun.test.ts tests/robotTickBatching.test.ts tests/jobs.test.ts tests/job1.test.ts tests/job2.test.ts tests/job3.test.ts tests/determinism.test.ts`. They pass: talking, placement and the job tests still find characters through 4a's fixed spots until Task 5.
- [ ] **Step 5:** Gate, and commit "Farmclaws part 4d: walkers walk, every minute after the robots".

---

### Task 5: The world reads places

Everything that found a character by a fixed spot now reads places, and the townsfolk can be talked to. (Spec §3.3, §4.1, §4.4, §4.5)

**Files:**
- Modify: `src/people/walk.ts`: `walkerAt`, `isStuck` (the same two plans as the step: not at target, and no route even ignoring the player), `nudgeWalkersOff`.
- Modify: `src/people/cast.ts`: `npcAt` and `npcSpot` go; `CAST` keeps names, roles and looks.
- Modify: `src/world/maps/types.ts`, `town.ts`, `neighbours.ts`, `index.ts`: `MapDefinition.npcs`, `NpcPlacement` and `assertNpcPlacements` go.
- Modify: `src/state/reducer.ts:366` and `src/state/intents.ts:391,457`: use `walkerAt(state, ...)`. `planTalk` plans `talkTo` for any walker. The reducer records talks only for characters.
- Modify: `src/core/types.ts`: the talk panel's `npc` widens to `WalkerId`.
- Modify: `src/people/lines.ts`: `lineFor` puts the stuck line ("Someone's put something in my way. I'll wait.") after the introduction and before the job hook.
- Modify: `src/people/townsfolk.ts`: `townsfolkLine` returns the stuck line, or `lines[hash32(seed, absoluteDay, index) % 3]`.
- Modify: `src/ui/chatBoxView.ts`: a townsperson gives their plate, the role "Brookhollow", their line and no buttons.
- Modify: `src/robots/world.ts:153`: the drag-back excludes `farmerStops(mapId)`.
- Modify: `src/jobs/setup.ts` (where generators are placed): call `nudgeWalkersOff` for each generator tile before placing.
- Modify: `tests/testUtils.ts`: `withWalkerAt(state, id, mapId, tx, tz, facing)`, used by the twelve test files that used `npcSpot` (cast, chatBox, determinism, gates, job1–3, jobs, npcRender, partsShop, talk, workshop).
- Test: `tests/townsfolk.test.ts`, `tests/walk.test.ts` (extend), `tests/talk.test.ts` (extend).

**Interfaces:**
- Consumes T3 and T4.
- Produces `walkerAt`, `isStuck`, `nudgeWalkersOff`, `withWalkerAt`, `townsfolkLine`, and the talk panel taking a `WalkerId`.

- [ ] **Step 1: Write `tests/townsfolk.test.ts`:**
  - talking to each townsperson opens the chat with the plate and "Brookhollow", today's line verbatim and no buttons;
  - the line is stable all day and changes with the day;
  - `talks` is untouched.
- [ ] **Step 2: Extend `tests/walk.test.ts`:**
  - `walkerAt` finds walkers mid-walk;
  - the player can't step onto, or place on, a walker's tile;
  - **a chest on Marigold's lunch spot:** she stops beside it, `isStuck` is true, and her chat opens with the stuck line after her introduction. Over the next 30 minutes she never moves back and forth (**Review Focus 4**);
  - a generator placed by taking job 3 while Barnaby stands on (26, 15) moves him to the nearest free tile;
  - the drag-back never picks a farmer stop.
- [ ] **Step 3:** Run them and see them fail.
- [ ] **Step 4:** Implement it, and move the twelve test files onto `withWalkerAt`. Their assertions stay the same.
- [ ] **Step 5:** Run `npm test` and see it pass.
- [ ] **Step 6:** Gate, and commit "Farmclaws part 4d: characters are found where they are, and the townsfolk talk".

---

### Task 6: Shop hours

(Spec §2.4, §5.1, §5.2)

**Files:**
- Modify: `src/config.ts`: `SHOP_HOURS`.
- Create: `src/people/shops.ts` (contract). `SHOP_DOORS` as spec §5.1's table.
- Modify: `src/state/intents.ts`: a `shopDoor` intent after the talk check, planned as spec §5.2 says (hint "Closed" or "Shop").
- Modify: `src/state/actions.ts`, `src/state/reducer.ts`:
  - **`shop/door`:** opens the menu in hours, otherwise the toast `closedLine(minute)`;
  - **the shop buttons:**
    - outside hours, pressing Marigold's Shop, Sol's Shop or Juniper's Workshop sets the talk panel's line to `closedLine(minute)`;
    - inside hours, they open the menu, as now;
  - **B:** `setShopOpen(true)` outside the general store's hours toasts `closedLine` instead of opening;
  - **the Job button and job checks** are untouched by hours.
- Modify: `src/core/types.ts`: the talk panel gains `override: string | null`, null when it opens. Panels aren't saved.
- Modify: `src/ui/chatBoxView.ts`: show `override` in place of the line when it's non-null.
- Test: `tests/shopHours.test.ts`.

**Interfaces:**
- Consumes `isGateOpen`, `giverJob`, `formatClock`.
- Produces `SHOP_DOORS`, `shopOpen`, `nextOpening`, `closedLine`, the `shop/door` action.

- [ ] **Step 1: Write `tests/shopHours.test.ts`:**
  - `shopOpen` at 8:59, 9:00, 11:59, 12:00, 12:59, 1:00, 4:59 and 5:00;
  - `nextOpening` gives "9:00 am", "1:00 pm" and "9:00 am tomorrow";
  - **for the general store, carpenter and parts exchange:** every cell of spec §5.2's table (gate closed / outside hours / in hours) for the door, the button and B, with the toast and line verbatim;
  - Berlioz's and Tallulah's doors;
  - the hints "Closed" and "Shop";
  - at 8:00 pm, Sol's Job button is present and taking job 1 works.
- [ ] **Step 2:** Run it and see it fail.
- [ ] **Step 3:** Implement it.
- [ ] **Step 4:** Run `npx vitest run tests/shopHours.test.ts tests/panelKeys.test.ts tests/chatBox.test.ts tests/gates.test.ts tests/partsShop.test.ts tests/workshop.test.ts` and see them pass.
- [ ] **Step 5:** Gate, and commit "Farmclaws part 4d: shops keep hours, behind the gates".

---

### Task 7: SLOPMART's box

The items, the box, DEALZ's lines, the panel state, buying, and Barnaby's line. (Spec §6.2–6.6, §9.1)

**Files:**
- Modify: `src/core/types.ts`:
  - `SLOP_IDS` (the twelve ids), `SlopItemId` and `ItemId`;
  - `GameSections.slopShop`;
  - `ShopsSoldToday.slopBoxes`;
  - `UiPanel` `{ kind: 'slopShop'; line: string }`.
- Modify: `src/items/items.ts`: a `slop` kind and the twelve items, with names and descriptions verbatim, `sellPrice: SLOP.slopSellPrice` and `maxStack: INVENTORY.maxStack`. `tests/inventory.test.ts`'s registry count grows by 12.
- Modify: `src/config.ts`: `SLOP` (spec §6.6) and the gem table.
- Create: `src/people/slop.ts` (contract): box contents, greetings, results and refusals, verbatim from spec §6.4.
- Modify: `src/state/intents.ts`: the `slopShop` intent at the booth door from (29, 7), hint "Talk to DEALZ".
- Modify: `src/state/actions.ts`, `src/state/reducer.ts`:
  - `slop/open` opens the panel with `dealzGreeting`;
  - `slop/buy` runs the three checks in order (sold out, no gold, no empty slot), each setting the panel line and charging nothing;
  - a sale takes `SLOP.boxPrice`, adds `boxAt(...)`, adds 1 to `boxesOpened` and `slopBoxes`, sets `dealzResult`, and toasts "Mystery box: {name} ×{quantity}." or "Mystery box: {name}.".
- Modify: `src/input/panelKeys.ts`: E, K, Enter and Escape close the slop panel.
- Modify: `src/people/lines.ts`: Barnaby's reactive line when `shopsSoldToday.slopBoxes > 0`, first after the hook.
- Modify: `src/state/initialState.ts`, `sectionValidation.ts`, `persistence.ts`:
  - defaults `{ boxesOpened: 0 }` and `slopBoxes: 0`;
  - validation as spec §9.3;
  - `migrateV9toV10` adds both;
  - `restocked` zeroes `slopBoxes`.
- Modify: `tests/testUtils.ts`: `v9Save` strips both and throws if the state holds slop items anywhere.
- Test: `tests/slopShop.test.ts`, `tests/saveV10.test.ts` (extend).

**Interfaces:**
- Consumes `hash32`, `hashFloat` and `CROPS`.
- Produces `SLOP_IDS`, `boxAt`, `isGem`, the DEALZ line functions, and the `slop/open` and `slop/buy` actions.

- [ ] **Step 1: Write `tests/slopShop.test.ts`:**
  - the intent and hint;
  - the greeting from `hash32(seed, absoluteDay, boxesOpened, 4101) % 8`;
  - a sale's gold, inventory, counters, toast and result line;
  - **each refusal:**
    - its line, verbatim and ending " ✓";
    - gold, inventory and counters unchanged;
  - **the empty-slot rule:**
    - a bag that's full apart from a part-stack of Speed-Gro still refuses;
  - **the box sequence:**
    - the same seed and `boxesOpened` give the same box;
    - over 10,000 boxes the gem share is in 0.08–0.12;
    - every gem and slop item appears;
    - the out-of-season seeds are never in season;
  - **the result lines:**
    - the pick ignores the tier: `dealzResult` with gem and slop contents at the same `boxesOpened` picks the same index;
  - **the morning and Barnaby:**
    - `slopBoxes` resets in the morning;
    - Barnaby's line shows after a purchase;
  - **the slop items themselves:**
    - each ships for 1g;
    - each can't be placed, planted or burnt, and E with one selected does nothing.
- [ ] **Step 2: Extend `tests/saveV10.test.ts`:**
  - a round trip with slop in a chest;
  - a bad `slopBoxes` (4, −1);
  - `boxesOpened` 1.5.
- [ ] **Step 3:** Run them and see them fail.
- [ ] **Step 4:** Implement it.
- [ ] **Step 5:** Run `npx vitest run tests/slopShop.test.ts tests/saveV10.test.ts tests/inventory.test.ts tests/lines.test.ts tests/shopStock.test.ts` and see them pass.
- [ ] **Step 6:** Gate, and commit "Farmclaws part 4d: SLOPMART's mystery box".

---

### Task 8: DEALZ's panel

(Spec §6.2)

**Files:**
- Create: `src/ui/shops/SlopShopPanel.ts`, built like the chat box (the same CSS classes):
  - the name DEALZ;
  - the role "SLOPMART 24/7 · A BARNABY VENTURE";
  - the panel's `line`;
  - the buttons "Buy a mystery box (40g)" (the price from `SLOP.boxPrice`) and "Leave";
  - text through `textContent` only, and the phone layout as the chat box's.
- Modify: `src/ui/ShopsHost.ts`: mount it for `panel.kind === 'slopShop'`, inside the lazy shops import.
- Modify: `scripts/bundleRules.mjs`, only if `build:check` reports the main chunk over its allowance. At most +8 KiB, recorded under Plan refinements.
- Test: `tests/chatBox.test.ts`-style view test for the panel (`tests/slopPanel.test.ts`): the view's text and buttons, and that Buy dispatches `slop/buy` and Leave closes.

**Interfaces:** Consumes the T7 actions and panel.

- [ ] **Step 1:** Write `tests/slopPanel.test.ts`.
- [ ] **Step 2:** Run it and see it fail.
- [ ] **Step 3:** Implement the panel and the host mount.
- [ ] **Step 4:** Run `npx vitest run tests/slopPanel.test.ts`, then `npm run build:check`. The panel is in the shops chunk, and the main chunk is within its allowance.
- [ ] **Step 5:** Gate, and commit "Farmclaws part 4d: DEALZ's panel".

---

### Task 9: Walkers on screen

(Spec §3.1 looks, §4.6)

**Files:**
- Create: `src/render/WalkerRenderer.ts`, replacing `src/render/NpcRenderer.ts`:
  - builds a model per walker on the active map with an `out` place, from `CAST_LOOKS` or the townsfolk looks;
  - glides over `moveSeconds` when the new tile is adjacent on the same map, and snaps otherwise;
  - eases yaw like robots, keeps the idle sway when standing, and uses `sharedTileOffsets`;
  - shows nameplates for the walker ahead, with the townsfolk plates added to `nameplates.ts`.
- Modify: `src/render/npcProps.ts`: the townsfolk props (headband, lead and dog, cap and satchel, guitar and hat, book and flat cap, hoodie and chocolate teapot) and the cart. The dog draws one tile behind the dog walker and the cart one tile in front of the courier, along the walker's facing.
- Modify: `src/main.ts` (or wherever `NpcRenderer` is constructed).
- Test: `tests/npcRender.test.ts` → `tests/walkerRender.test.ts`. On the pure layout parts:
  - the tween target and duration for an adjacent step;
  - a snap for a two-tile jump and for a map change (**Review Focus 1**);
  - no model for indoors walkers;
  - shared-tile offsets.

**Interfaces:** Consumes `walkerPlace`, `walkerAt`, `TOWNSFOLK_PLATES` and the townsfolk looks.

- [ ] **Step 1:** Write the render-layout tests.
- [ ] **Step 2:** Run them and see them fail.
- [ ] **Step 3:** Implement the renderer and props.
- [ ] **Step 4:** Run the tests and `npm run build:check`, and see them pass.
- [ ] **Step 5:** Gate, and commit "Farmclaws part 4d: walkers on screen".

---

### Task 10: Signs, posters, neon and chickens

(Spec §5.3, §6.1 look, §7.1 bunting and banners, §7.2, §7.3 chickens)

**Files:**
- Modify: `src/render/posters.ts`: the five brand posters (text verbatim from spec §7.2) and the OPEN / CLOSED faces join the atlas.
- Modify: `src/render/townGeometry.ts`, `src/render/StructureRenderer.ts`:
  - brand posters at their walls;
  - a sign at each `SHOP_DOORS` door, flipping on `shopOpen` (the renderer reads the state each frame, like other state-driven visuals); at the parts exchange it hangs on the door itself;
  - SLOPMART's neon sign ("SLOPMART 24/7", "A BARNABY VENTURE"), emissive, with one letter dimming on a fixed cycle;
  - DEALZ as a Mini behind the counter, built like 4b's display Mini, with emissive eyes;
  - bunting between the square's and main street's lamp posts, and the two Claw Fair banners over the main street.
- Create: `src/render/ChickenRenderer.ts`: five chickens inside the run (x 12–14, z 6–7), wandering on a fixed pattern from render time. Never saved, never in the simulation.
- Test: `tests/posters.test.ts` (extend): every brand poster and both sign faces are in the atlas with their verbatim text. `tests/townProps.test.ts` (extend): `signFace(state, shop)` (a pure helper) gives OPEN or CLOSED at the hour boundaries. Chicken positions stay inside the run for 1,000 sampled times.

**Interfaces:** Consumes `SHOP_DOORS`, `shopOpen`, and the prop and booth structures (T2).

- [ ] **Step 1:** Write the tests.
- [ ] **Step 2:** Run them and see them fail.
- [ ] **Step 3:** Implement it.
- [ ] **Step 4:** Run the tests and `npm run build:check`, and see them pass.
- [ ] **Step 5:** Gate, and commit "Farmclaws part 4d: signs, brand posters, SLOPMART's neon and Cosmo's chickens".

---

### Task 11: Determinism, playbook and spec sync

**Files:**
- Modify: `tests/determinism.test.ts`: seven days with walkers walking and three boxes bought a day give the same state hash on two runs.
- Create: `.claude/skills/game-driven-qa/scenarios/farmclaws-part4d.md`: the spec's six playbook steps, one line each.
- Modify: `.claude/skills/game-driven-qa/SKILL.md`: a row for part 4d.
- Modify: `docs/superpowers/specs/2026-09-29-farmclaws-design.md` §9.1, §9.2 and the §11.2 4d row; `docs/superpowers/specs/2026-10-06-farmclaws-part4a-people-design.md` (the "not planned" row, Cosmo's gap); `docs/superpowers/specs/2026-10-11-farmclaws-part4c-jobs-design.md` (the drag-back wording). All as spec §11 says.
- Modify: the 4d spec: a "Plan refinements" section listing R1, R2 and any refinement made during the build, with the commit that made it.

- [ ] **Step 1:** Extend the determinism test, run it, and see it pass.
- [ ] **Step 2:** Write the playbook and the QA row.
- [ ] **Step 3:** Sync the specs.
- [ ] **Step 4:** Run `npm run typecheck && npm test && npm run build && npm run build:check`.
- [ ] **Step 5:** Commit "Farmclaws part 4d: playbook and spec sync".
