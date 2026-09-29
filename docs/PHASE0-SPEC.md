# Phase 0 spec — foundations (plan section 2)

This is the build spec for plan section 2: multiple maps, placed objects, item quality, inventory and storage, entities, and save version 3. Every decision here is final. Implementation agents follow it and don't redesign it. If something in the code makes a rule impossible, pick the smallest change that keeps the rule's intent and write it down in the step's commit message.

Global rules (from `docs/PLAN-v2.md` §1):

- The simulation stays pure and deterministic. There is no `Math.random`, no clock and no I/O in `src/core`, `src/state`, `src/world`, `src/farming` or `src/time`.
- Strict TypeScript with `erasableSyntaxOnly`: no enums, no namespaces, no parameter properties, `as const` objects plus union types, and `import type` for types.
- No TODOs, placeholders or stubs.
- `npm run typecheck`, `npm test` and `npm run build` pass after **every** step (§9).

Phase 0 builds **data and foundations**. It doesn't build later-workstream behaviour: no crafting, cooking, animals, NPC dialogue, quests, festivals, sprinkler watering or fertiliser effects. §2.9 lists the only exceptions (small lifetime counters).

---

## 1. Identifier lists (`src/core/types.ts`)

Add these `as const` arrays, each with its union type, next to `CROP_IDS`. Later workstreams use the ids as data keys. Their item registry entries, icons and behaviour are **not** part of Phase 0.

```ts
export const MAP_IDS = ['farm', 'forest', 'town'] as const;               export type MapId = (typeof MAP_IDS)[number];
export const QUALITIES = [0, 1, 2] as const;                               export type Quality = (typeof QUALITIES)[number];
export const FERTILIZER_KINDS = ['basic', 'quality', 'speedGro'] as const; export type FertilizerKind = (typeof FERTILIZER_KINDS)[number];
export const UPGRADABLE_TOOLS = ['hoe', 'wateringCan', 'pickaxe', 'axe'] as const satisfies readonly ToolType[];
export type UpgradableTool = (typeof UPGRADABLE_TOOLS)[number];
export type ToolLevel = 0 | 1 | 2;                                         // 0 basic, 1 copper, 2 steel
export const NPC_IDS = ['marigold', 'bram', 'juniper', 'tess', 'fennick', 'pip'] as const; export type NpcId = (typeof NPC_IDS)[number];
export const ANIMAL_KINDS = ['chicken', 'cow'] as const;                   export type AnimalKind = (typeof ANIMAL_KINDS)[number];
export const FARM_BUILDING_KINDS = ['coop', 'barn'] as const;              export type FarmBuildingKind = (typeof FARM_BUILDING_KINDS)[number];
export const FORAGE_IDS = ['wildLeek', 'springOnion', 'wildBerries', 'sweetPea', 'hazelnut', 'chanterelle', 'frostRoot', 'holly'] as const;
export type ForageId = (typeof FORAGE_IDS)[number];
export const DISH_IDS = ['friedMushrooms', 'veggieStew', 'berryTart', 'pumpkinSoup', 'snozberryJam', 'spectralTea', 'omelette', 'forestSalad'] as const;
export type DishId = (typeof DISH_IDS)[number];
export const CRAFTING_RECIPE_IDS = ['chest', 'woodFence', 'woodPath', 'stonePath', 'scarecrow', 'sprinkler', 'qualitySprinkler', 'basicFertilizer', 'qualityFertilizer', 'speedGro'] as const;
export type CraftingRecipeId = (typeof CRAFTING_RECIPE_IDS)[number];
export const STORY_QUEST_IDS = ['shipParsnips', 'clearDebris', 'visitTown', 'craftChest', 'forageForest', 'buildCoop', 'makeFriend', 'earnGold'] as const;
export type StoryQuestId = (typeof STORY_QUEST_IDS)[number];
export const FESTIVAL_IDS = ['blossomFair', 'lanternNight', 'harvestFair', 'starfallFeast'] as const; export type FestivalId = (typeof FESTIVAL_IDS)[number];
export const DECORATION_IDS = ['paperLantern', 'stoneLantern', 'flowerArch'] as const;               export type DecorationId = (typeof DECORATION_IDS)[number];
export const GIANT_CROP_IDS = ['cauliflower', 'melon', 'pumpkin'] as const satisfies readonly CropId[]; export type GiantCropId = (typeof GIANT_CROP_IDS)[number];
export const STRUCTURE_KINDS = ['generalStore', 'blacksmith', 'carpenter', 'ranch', 'noticeBoard', 'well', 'lampPost', 'hedge'] as const;
export type StructureKind = (typeof STRUCTURE_KINDS)[number];
export const PLACED_OBJECT_KINDS = ['chest', 'sprinkler', 'qualitySprinkler', 'scarecrow', 'woodFence', 'woodPath', 'stonePath', 'giantCrop', 'forage', 'trophy', 'decoration'] as const;
export type PlacedObjectKind = (typeof PLACED_OBJECT_KINDS)[number];
```

`ItemId` stays as it is in Phase 0: tools, seeds, produce and materials. Later workstreams add item ids. That only widens `isItemId`, so it needs no save migration.

## 2. Types (`src/core/types.ts`)

### 2.1 Save version and blockers

- `SAVE_VERSION = 3`.
- `Blocker` gets three new values appended. Existing numbers never change, because saves store the numbers.

```ts
export const Blocker = { None: 0, Rock: 1, Stump: 2, Water: 3, House: 4, ShippingBin: 5, Tree: 6, Weeds: 7, Building: 8 } as const;
```

- `Building` is every multi-tile structure that isn't the farmhouse or the shipping bin: town structures (§4), and later the coop and barn.
- `House` exists only on the farm, so "interact with a House tile → sleep" keeps working unchanged.
- `blockerHp > 0` is allowed only for Rock, Stump and Tree. It is 0 for every other blocker.

### 2.2 Tiles and placed objects

```ts
export interface Tile {
  readonly state: TileState;
  readonly blocker: Blocker;
  readonly blockerHp: number;
  readonly crop: CropInstance | null;
  /** Player-placed thing on this tile (chest, sprinkler, path…). Paths are walkable; every other kind blocks. */
  readonly object: PlacedObject | null;
  /** Fertiliser mixed into tilled soil (workstream C applies it). Only on soil tiles. */
  readonly fertilizer: FertilizerKind | null;
}

export type ChestSlots = readonly (ItemStack | null)[];   // always INVENTORY.chestSlots (36) long

export type PlacedObject =
  | { readonly kind: 'chest'; readonly slots: ChestSlots }
  | { readonly kind: 'sprinkler' }
  | { readonly kind: 'qualitySprinkler' }
  | { readonly kind: 'scarecrow' }
  | { readonly kind: 'woodFence' }
  | { readonly kind: 'woodPath' }
  | { readonly kind: 'stonePath' }
  /** One 3×3 giant crop. The same object value sits on all 9 covered tiles; anchor = min-x, min-z corner. */
  | { readonly kind: 'giantCrop'; readonly cropId: GiantCropId; readonly anchorTx: number; readonly anchorTz: number }
  | { readonly kind: 'forage'; readonly itemId: ForageId; readonly spawnDay: number }
  | { readonly kind: 'trophy'; readonly festival: FestivalId; readonly year: number }
  | { readonly kind: 'decoration'; readonly variant: DecorationId };
```

Tile invariants. `assertTileConsistent` enforces these and `isValidTile` duplicates them:

1. The existing rules stay.
2. `object !== null` ⇒ `blocker === None` and `crop === null`.
3. `object.kind` is `woodPath` or `stonePath` ⇒ `state === Unplowed` and `fertilizer === null`.
4. Every other object kind may stand on Unplowed, Plowed or Watered tiles (sprinklers sit on soil).
5. `fertilizer !== null` ⇒ `state` is Plowed or Watered, and `object === null`.
6. `blockerHp > 0` ⇒ blocker is Rock, Stump or Tree.
7. Keep `assertTileConsistent` O(1). It doesn't scan chest slots.

A **world-level** check, `assertWorldObjectsConsistent(world)` in `tiles.ts`, is used by the save validator and by tests. It checks that each giant crop covers exactly its 3×3 footprint:

- the footprint is inside the grid;
- all 9 tiles hold an equal object (same kind, crop and anchor);
- no other tile names that anchor.

`isWalkable(tile)` returns true when `state !== Blocked` and the tile has no object, or when the object is `woodPath` or `stonePath`.

`EMPTY_TILE` stays **one shared frozen object** with `object: null, fertilizer: null`. `blockedTile()` adds both fields as `null`. When a tile turns Unplowed overnight, growth.ts must clear `fertilizer` explicitly. Otherwise `{...tile, state}` would carry fertiliser onto grass.

### 2.3 Items with quality

```ts
export interface ItemStack { readonly itemId: ItemId; readonly quantity: number; readonly quality: Quality }
```

- Stacks merge only when `itemId` **and** `quality` are equal.
- `items.ts` gets `hasQuality: boolean` on `ItemBase`. It is true for `produce` and false for tools, seeds and materials. Later kinds set it themselves: forage, food and animal products are true.
- A stack with `quality !== 0` is valid only when the item's `hasQuality` is true. The validator and `assertValidStack` enforce this.
- `export const QUALITY_MULTIPLIERS = [1, 1.25, 1.5] as const` goes in config `FARMING`.
- `export function sellPriceFor(itemId: ItemId, quality: Quality): number` goes in items.ts and returns `Math.floor(sellPrice × multiplier)`.
- The HUD, shipping payout, `selectPendingShipmentValue` and any other price display use `sellPriceFor`.

### 2.4 Inventory and UI

```ts
export interface InventoryState {
  /** Always INVENTORY.slotCount (36). 0–11 = hotbar, 12–35 = backpack. */
  readonly slots: readonly (ItemStack | null)[];
  /** 24 at the start (12 hotbar + 12 backpack); the general-store upgrade (later) makes it 36. Slots ≥ unlockedSlots are always null. */
  readonly unlockedSlots: 24 | 36;
  /** Always < INVENTORY.hotbarSize. */
  readonly selected: number;
  readonly water: number;
  readonly waterCapacity: number;
}

export type SlotRef =
  | { readonly container: 'player'; readonly index: number }
  | { readonly container: 'chest'; readonly mapId: MapId; readonly tx: number; readonly tz: number; readonly index: number };

export type UiPanel =
  | { readonly kind: 'none' }
  | { readonly kind: 'shop' }
  | { readonly kind: 'inventory' }
  | { readonly kind: 'chest'; readonly mapId: MapId; readonly tx: number; readonly tz: number };

export interface UiState { readonly panel: UiPanel; readonly paused: boolean; readonly timeScale: number }
```

- `ui.shopOpen` is removed. Every reader of it switches to `ui.panel.kind === 'shop'`.
- `selectIsFrozen(state)` is `ui.paused || ui.panel.kind !== 'none'`.
- `main.ts:141` must use `selectIsFrozen` instead of its hand-copied check.
- Later workstreams add panel kinds (cooking, dialogue, journal, and so on). The UI is always reset on load (§7), so adding kinds never needs a migration.

### 2.5 Player

`PlayerState` gets `readonly mapId: MapId`. Nothing else changes there.

### 2.6 Action feedback

`ActionKind` gains `'openChest'`. `persistence.ts ACTION_KINDS` must mirror `ActionKind` exactly. Add a type-level exhaustiveness check so this can't drift again, for example `satisfies readonly ActionKind[]` plus a test that compares the list with every kind.

### 2.7 Sections for later workstreams (data only in Phase 0)

```ts
export interface Appearance {
  readonly skinTone: number;      // 0 … APPEARANCE.skinTones-1
  readonly hairStyle: number;     // 0 … APPEARANCE.hairStyles-1
  readonly hairColor: number;     // 0 … APPEARANCE.hairColors-1
  readonly shirtColor: number;    // 0 … APPEARANCE.shirtColors-1
  readonly overallsColor: number; // 0 … APPEARANCE.overallsColors-1
  readonly hat: number;           // 0 = no hat, 1 … APPEARANCE.hats-1
}
export interface ProfileState { readonly playerName: string; readonly farmName: string; readonly appearance: Appearance }

export interface ToolUpgradeOrder { readonly tool: UpgradableTool; readonly level: 1 | 2; readonly readyDay: number }
export interface ToolProgressState { readonly levels: Readonly<Record<UpgradableTool, ToolLevel>>; readonly upgrade: ToolUpgradeOrder | null }

export interface CraftingState { readonly known: readonly CraftingRecipeId[] }             // unique, in CRAFTING_RECIPE_IDS order
export interface CookingState { readonly known: readonly DishId[]; readonly kitchenLevel: 0 | 1 } // unique, in DISH_IDS order

export interface Animal {
  readonly id: number; readonly kind: AnimalKind; readonly name: string; readonly bornDay: number;
  readonly fedToday: boolean; readonly pettedToday: boolean; readonly happiness: number; readonly hasProduct: boolean;
}
export interface FarmBuilding {
  readonly id: number; readonly kind: FarmBuildingKind;
  /** Index into the farm layout's `plots` (0 = coop plot, 1 = barn plot). */
  readonly plot: number;
  /** Absolute day construction finishes; the building is standing once time.absoluteDay ≥ readyDay. */
  readonly readyDay: number;
  readonly troughWheat: number;
  readonly animals: readonly Animal[];
}

export type HeartEventLevel = 2 | 4 | 6;
export interface NpcRelation {
  readonly points: number;          // 0 … 2500 (250 per heart)
  readonly talkedToday: boolean;
  readonly giftsToday: number;      // 0 … 1
  readonly giftsThisWeek: number;   // 0 … 2
  readonly heartEventsSeen: readonly HeartEventLevel[]; // ascending, unique
  readonly talks: number;           // lifetime conversations, rotates dialogue lines
}

export interface BoardRequest {
  readonly week: number; readonly npc: NpcId; readonly itemId: ItemId; readonly quantity: number;
  readonly dueDay: number; readonly delivered: number; readonly status: 'active' | 'completed' | 'expired';
}
export interface QuestState { readonly completed: readonly StoryQuestId[]; readonly board: BoardRequest | null } // completed: unique, STORY order

export interface LifetimeStats {
  readonly parsnipsShipped: number; readonly debrisCleared: number; readonly forageFound: number; readonly totalEarned: number;
  readonly visitedTown: boolean; readonly craftedChest: boolean; readonly builtCoop: boolean;
}

export interface FestivalState {
  /** Absolute day the fields below belong to; -1 when no festival progress is stored. */
  readonly activeDay: number;
  readonly eggsFound: number;        // bitmask of the 12 Blossom Fair eggs (0 … 4095)
  readonly lanternReleased: boolean;
  readonly display: readonly ItemStack[]; // Harvest Fair display, ≤ 9 stacks
  readonly giftTarget: NpcId | null;
  readonly giftGiven: boolean;
}
```

### 2.8 GameState v3

```ts
export interface GameState {
  readonly version: typeof SAVE_VERSION;
  readonly seed: number;
  readonly time: TimeState;
  readonly weather: Weather;
  readonly maps: Readonly<Record<MapId, WorldState>>;
  readonly player: PlayerState;
  readonly inventory: InventoryState;
  readonly shipping: ShippingState;
  readonly ui: UiState;
  readonly messages: MessageLog;
  readonly profile: ProfileState;
  readonly tools: ToolProgressState;
  readonly crafting: CraftingState;
  readonly cooking: CookingState;
  readonly buildings: readonly FarmBuilding[];
  /** Next id for buildings and animals (shared counter, starts at 1). */
  readonly nextEntityId: number;
  readonly npcs: Readonly<Record<NpcId, NpcRelation>>;
  readonly quests: QuestState;
  readonly stats: LifetimeStats;
  readonly festival: FestivalState;
}
```

Defaults: `createInitialState` and the migration both use one `createDefaultSections()` in `src/state/initialState.ts`.

- `profile`:
  - playerName `'Farmer'`, farmName `'Meadowlight'`;
  - appearance all 0 (index 0 of every palette is today's look).
- `tools`: all levels 0, `upgrade: null`.
- `crafting.known`: `['chest', 'woodFence', 'woodPath', 'stonePath', 'scarecrow', 'sprinkler', 'basicFertilizer']`.
- `cooking`: `{ known: ['friedMushrooms', 'veggieStew'], kitchenLevel: 0 }`.
- `buildings`: `[]`, and `nextEntityId: 1`.
- `npcs`: every id gets `{ points: 0, talkedToday: false, giftsToday: 0, giftsThisWeek: 0, heartEventsSeen: [], talks: 0 }`.
- `quests`: `{ completed: [], board: null }`.
- `stats`: all 0 or false.
- `festival`: `{ activeDay: -1, eggsFound: 0, lanternReleased: false, display: [], giftTarget: null, giftGiven: false }`.

`config.ts` gets `APPEARANCE = { skinTones: 5, hairStyles: 3, hairColors: 6, shirtColors: 8, overallsColors: 6, hats: 4 }` and `PROFILE = { maxNameLength: 24 }`.

### 2.9 Lifetime counters Phase 0 does maintain

These four events already exist in Phase 0, so it maintains their counters:

- `stats.debrisCleared` goes up by 1 whenever a Rock, Stump, Tree or Weeds blocker is fully cleared. A tree that falls to a stump counts once; the stump counts again when it is cleared.
- `stats.visitedTown` is set to true the first time the player warps into the town.
- `stats.parsnipsShipped` goes up by the parsnip quantity paid out each morning.
- `stats.totalEarned` goes up by each morning's payout.

Nothing else in §2.7 changes in Phase 0.

## 3. Hash salts (`src/core/hash.ts`)

Add these to `Salt`. Existing values never change.

| Salt | Value | Salt | Value |
| --- | --- | --- | --- |
| MapForest | 0x68e31da4 | Crow | 0x85ebca6b |
| MapTown | 0xb5297a4d | GiantCrop | 0xc2b2ae35 |
| ForestGen | 0x1b56c4e9 | Sap | 0x27d4eb2f |
| TownGen | 0x7fb5d329 | CopperOre | 0xd35a2d97 |
| Quality | 0x2545f491 | Forage | 0x4cf5ad43 |
| Weeds | 0x9e3779b9 | NoticeBoard | 0x94d049bb |
| Festival | 0xbf58476d | AnimalProduct | 0x632be5ab |
| Gift | 0xa0761d65 | | |

- Check that `hash32` handles values ≥ 2³¹ (it should use `>>> 0` / `Math.imul`). If it doesn't, mask the constants with `>>> 0`.
- Add a test that every `Salt` value is distinct.
- `mapSeed(seed, id)` goes in `src/world/maps/index.ts`:
  - `'farm'` returns `seed` unchanged, so every farm hash stays bit-identical;
  - `'forest'` returns `hash32(seed, Salt.MapForest)`;
  - `'town'` returns `hash32(seed, Salt.MapTown)`.
- Every per-map roll uses `mapSeed(state.seed, mapId)` in place of `state.seed`: generation, overnight `DayContext.seed`, and harvest yield and quality. Weather stays `rollWeather(state.seed, day)` and is global.

---

## 4. Maps (`src/world/maps/`)

### 4.1 API

`src/world/maps/types.ts`:

```ts
export interface Warp {
  readonly from: TileCoord;            // an edge tile of this map
  readonly exit: Direction;            // stepping this way from `from` would leave the grid → warp
  readonly to: { readonly mapId: MapId; readonly tx: number; readonly tz: number; readonly facing: Direction };
}
export type Surface = 'grass' | 'dirt' | 'cobble';
export type SceneryStyle = 'farm' | 'forest' | 'town';
export interface StructurePlacement { readonly kind: StructureKind; readonly rect: TileRect; readonly door: TileCoord | null }
export interface WildTuning { readonly sproutChance: number; readonly spreadChancePerNeighbor: number; readonly maxWild: number; readonly initialDensity: number }
export interface MapDefinition {
  readonly id: MapId;
  readonly name: string;                          // 'Meadowlight Farm' | 'Mossy Woods' | 'Brookhollow'
  readonly grid: GridSpec;                        // createGridSpec(w, d, WORLD.chunkSize, WORLD.tileSize)
  readonly allowsTilling: boolean;                // hoe till + seed scatter only where true (farm)
  readonly warps: readonly Warp[];
  /** Warp tiles + arrival tiles. Never hold debris, wild crops, weeds, objects or forage (generators and later workstreams check this). */
  readonly reserved: readonly TileCoord[];
  readonly structures: readonly StructurePlacement[]; // Blocker.Building footprints (town)
  readonly wild: WildTuning | null;               // null → no wild crops on this map
  readonly farmstead: FarmLayout | null;          // farm only: house, door, bin, pond, clear zones, densities, plots
  readonly scenery: SceneryStyle;                 // render: what surrounds the grid
  readonly decor: { readonly tuftChance: number; readonly flowerChance: number }; // render meadow density on grass
  /** Added to tile coords in render-only cosmetic hashes; (0,0) for the farm so it looks exactly as before. */
  readonly cosmeticOffset: { readonly x: number; readonly z: number };
  isShaded(tx: number, tz: number): boolean;      // pure, precomputed into a Uint8Array at module load
  surfaceAt(tx: number, tz: number): Surface;     // pure, precomputed
  generate(seed: number): WorldState;             // `seed` is the save seed; derives mapSeed internally
}
```

`src/world/maps/index.ts` exports:

- `MAPS: Readonly<Record<MapId, MapDefinition>>`
- `getMap(id)`
- `mapSeed(seed, id)`
- `generateMaps(seed): Record<MapId, WorldState>`
- `findWarp(def, tx, tz, dir): Warp | null`
- `isReservedTile(def, tx, tz)`
- `structureAt(def, tx, tz): StructurePlacement | null`

A **module-load validation** (`assertMapDefinitions`) throws on any of these:

- a warp's `from` isn't on the edge, or `stepTile(from, exit)` is in bounds;
- the target is out of bounds;
- a warp has no reciprocal warp: the target map must have a warp whose `to` is a tile orthogonally adjacent to this `from`;
- a structure rect is outside the grid;
- the farm spawn isn't clear.

`FarmLayout` (config.ts) gains only `plots: readonly TileRect[]`. The gate clear zones are appended to `LAYOUT.clearZones` (see 4.2); there is no separate field.

- `PLAYER.spawn` stays `{ tx: 2, tz: 5 }` and means the farm.
- `WORLD` keeps `chunkSize`, `tileSize` and `seed`. `width` and `depth` move into the map definitions.
- `SHADE` stays and is the farm's `WildTuning` source (plus `edgeBand` and `houseRing`).

### 4.2 Farm (48 × 40): unchanged generator

`farm.ts` wraps today's `generateTile` / `generateWorld` **unchanged** (same check order, densities, hash arguments and `SHADE` values), with these additions:

- **Gate clear zones**, appended to `LAYOUT.clearZones` as entries 2 and 3 (`generateTile` only reads `clearZones`):
  - `{x0:0,z0:13,width:1,depth:1}` (west gate);
  - `{x0:46,z0:38,width:2,depth:1}` (south-east gate).

  With the default seed all these tiles are already empty. With other seeds, only tiles that would have been debris change.
- **Warps:**
  - `{from:{tx:0,tz:13}, exit:West, to:{mapId:'forest', tx:34, tz:15, facing:West}}`
  - `{from:{tx:47,tz:38}, exit:East, to:{mapId:'town', tx:1, tz:16, facing:East}}`
- **Reserved:** (0,13), (1,13), (47,38), (46,38). Initial wild crops skip reserved tiles, just as they skip the spawn today.
- **Plots** (data for workstream E):
  - coop `{x0:20,z0:3,width:7,depth:6}`;
  - barn `{x0:30,z0:3,width:8,depth:7}`.
- **Other settings:**
  - `allowsTilling: true`, `scenery: 'farm'`;
  - `decor`: today's `TUFT_CHANCE` / `FLOWER_CHANCE`;
  - `cosmeticOffset: {x:0, z:0}`;
  - surface is grass everywhere;
  - shade is today's `isShadedTile`;
  - `wild` comes from `SHADE`.

**Bit-identical guarantee.** Before changing anything, the step-2 agent freezes a **per-tile fingerprint** of today's farm into `tests/fixtures/farmFingerprint.ts`: an array of 1920 numbers, one per tile in `tileIndex` order. Each number is a hash of `JSON.stringify(tile)`, folded one char code at a time (`h = hash32(h, code)`). Never spread a long string into `hash32(...values)`; that overflows the stack.

After the change, `tests/maps.test.ts` recomputes the same fingerprint for `generateMaps(WORLD.seed).farm`, ignoring the new `object` and `fertilizer` keys (strip them before stringifying), and compares tile by tile. Differences are allowed only at the four reserved tiles. For the default seed those are already plain empty tiles, so the default farm must match **exactly**.

### 4.3 Forest, "Mossy Woods" (36 × 30)

Coordinates are tile coordinates. "Centre" means `(tx + 0.5, tz + 0.5)`.

**Warps and reserved tiles**
- Warp: `{from:{tx:35,tz:15}, exit:East, to:{mapId:'farm', tx:1, tz:13, facing:East}}`.
- Reserved: (35,15), (34,15).

**Areas**
- **Trail** (dirt surface; no debris or wild crops): x 22–35, z 14–16.
- **Clearing** (grass; no debris; **not shaded**): tiles whose centre is **strictly less than** 5.0 from (17.5, 14.5). This keeps (22,14) on the trail, so trail and clearing never overlap.
- **Brook** (`Blocker.Water`): tiles whose centre is within 1.1 of the polyline (6.5,3.5) → (9.5,8.5) → (8.5,13.5) → (11.5,19.5) → (10.5,25.5).
  - The brook never touches a map edge.
  - **Bank:** tiles whose centre is within 2.2 of the polyline, that aren't water, get no Tree, Rock or Stump. That keeps the water reachable for refills.

**Everything else**
- Everything else rolls `r = hashFloat(mapSeed(seed,'forest'), tx, tz, Salt.ForestGen)`:

  | Roll | Result |
  | --- | --- |
  | r < 0.24 | Tree, hp `TOOLS.treeHits` (added in step 1) |
  | < 0.27 | Rock, hp `TOOLS.rockHits` |
  | < 0.30 | Stump, hp `TOOLS.stumpHits` |
  | < 0.36 | Weeds |
  | otherwise | `EMPTY_TILE` |

  Bank tiles use the same roll but map Tree, Rock and Stump to `EMPTY_TILE`.
- **Shade:** every tile outside the clearing is shaded.
- **Wild:** `{sproutChance: 0.02, spreadChancePerNeighbor: 0.12, maxWild: 60, initialDensity: 0.06}`. About 40 initial crops. The invariant for every map and several seeds: a freshly generated map's wild count is ≤ `def.wild.maxWild`.
  - Initial wild crops go on shaded `EMPTY_TILE`s that aren't on the trail or reserved.
  - They use `initialWildCrop(mapSeed(seed,'forest'), 0, ids, tx, tz, def.wild.initialDensity)`, where `ids` are the `shadeCropsInSeason(Spring)` ids. `initialWildCrop` gains the density parameter; the farm passes `SHADE.initialDensity` (0.12).
- **Other settings:** `allowsTilling: false`, `scenery: 'forest'`, `decor {tuftChance: 0.10, flowerChance: 0.02}`, `cosmeticOffset {x: 1009, z: 2003}`.

### 4.4 Town, "Brookhollow" (40 × 32)

**Warps and reserved tiles**
- Warp: `{from:{tx:0,tz:16}, exit:West, to:{mapId:'farm', tx:46, tz:38, facing:West}}`.
- Reserved: (0,16), (1,16).

**Occlusion rule.** The camera looks from +X/+Z, so anything tall hides the tiles on its −X/−Z side. That is why the farmhouse sits in the far corner. The town follows the same rule:
- The shops stand against the back (−Z) edge.
- Every tile in the back band (z 0–6) that isn't a shop or the notice board is a `hedge` structure, so nothing walkable is ever hidden behind a building.
- Thin lamp posts (post ≤ 0.15 tile wide) and the low well (≤ 0.9 tall) are the only exceptions.

**Structures** (`Blocker.Building`, rendered by StructureRenderer). Doors are on the rect's front (+Z) row, z = 6, and are entered from z = 7.

| kind | rect (x0, z0, w, d) | door |
| --- | --- | --- |
| generalStore | 3, 0, 7, 7 | (6, 6) |
| blacksmith | 12, 0, 6, 7 | (15, 6) |
| carpenter | 22, 0, 6, 7 | (25, 6) |
| ranch | 31, 0, 7, 7 | (34, 6) |
| noticeBoard | 19, 6, 2, 1 | null (read from z = 7, facing North) |
| hedge | (0,0,3,7), (10,0,2,7), (18,0,4,6), (18,6,1,1), (21,6,1,1), (28,0,3,7), (38,0,2,7) | null |
| well | 19, 13, 2, 2 (≤ 0.9 tall) | null |
| lampPost × 6 | (13,8), (26,8), (13,20), (26,20), (4,14), (36,14), each 1 × 1 | null |

Together, the shops, hedges and notice board cover the whole back band x 0–39, z 0–6 exactly once. `assertMapDefinitions` checks that structure rects never overlap each other, water, the reserved tiles or the paths below.

**Surfaces**
- **Cobble:**
  - the main street, z 15–17 across the whole width;
  - the square, x 14–25, z 7–19 (it meets the blacksmith and carpenter doors and the notice board).
- **Dirt:**
  - door paths (6, 7–14) and (34, 7–14);
  - the riverside promenade, z 22 for x 3–36;
  - the connector x 19–20, z 20–21.
- **Grass:** everywhere else.

**River**
- `Blocker.Water` on tiles with 3 ≤ tx ≤ 36 and 24 ≤ tz ≤ 27, except the four corners (3,24), (3,27), (36,24) and (36,27).
- The strip south of it (z 28–31) is reachable around both ends.

**Other settings**
- No debris, no shade, no wild crops.
- `allowsTilling: false`, `scenery: 'town'`, `decor {tuftChance: 0.04, flowerChance: 0.03}`, `cosmeticOffset {x: 3001, z: 4007}`.

The town generator is pure data: structures, then water, then `EMPTY_TILE`. It doesn't use a hash, so the town is identical for every seed. `Salt.TownGen` is reserved for later workstreams.

### 4.5 Helpers (`src/state/selectors.ts`, `src/world/tiles.ts`)

- **`selectActiveMapId(state)`** returns `state.player.mapId`.
- **`selectActiveWorld(state)`** returns `state.maps[state.player.mapId]`.
- **`selectActiveMap(state)`** returns `getMap(state.player.mapId)`.
- **`withMap(state, mapId, world)` and `withActiveWorld(state, world)`** return `state` unchanged when `world === state.maps[mapId]`. Otherwise they return `{ ...state, maps: { ...state.maps, [mapId]: world } }`.
- **`setTiles(world, edits: readonly {tx, tz, tile}[])`** copies each touched chunk exactly once.
- **Replace every `state.world` read** (the full list is in the reader maps; grep `\.world\b` in `src/` and `tests/`). Simulation code uses the active world. Render and HUD code use `selectActiveWorld`.

---

## 5. Simulation rules (`src/state/*`, `src/farming/*`)

### 5.1 Movement and warps

`movePlayer`:
1. If `stepTile` is in bounds: behave as today on the active world, using the new `isWalkable`.
2. If it is out of bounds: look up `findWarp(activeMap, tx, tz, direction)`.
   - With a warp: set `player.mapId`, `tx`, `tz` and `facing` from `warp.to` and increment `teleportSeq`. Don't touch `moveSeq`.
   - Entering `'town'` sets `stats.visitedTown = true`.
   - Without a warp: blocked, as today.
3. Arrival tiles are one tile inside the edge and face into the map, so a held key can't bounce the player straight back.
4. The destination arrival tile must be walkable, or the warp is refused and the move is blocked. The migration and generators keep it clear, and later workstreams never put objects on reserved tiles.

### 5.2 Per-map intents

- **Hoe `till` and seed `scatter`:** only when `activeMap.allowsTilling`. Otherwise the result is `blocked` with reason `"You can only farm on your own land."`.
- **Scatter patches:** skip tiles with an object.
- **Hoe:** a tile with any object is blocked.
- **Pickaxe `untill`:** blocked on a tile with any object: no intent and no energy. Picking objects up is workstream D. Without this, a pickaxe would delete a chest standing on soil, and its items with it.
- **Watering a soil tile that holds an object** (a sprinkler on soil) waters the soil and keeps the object.
- **Water refill** works on any `Blocker.Water` tile, on any map.
- **Axe on Tree:** `chop`.
  - Each hit lowers hp by 1.
  - At 0 the tree falls, the tile becomes `blockedTile(Stump, TOOLS.stumpHits)` and it gives `TOOLS.woodFromTree` wood.
  - Add `TOOLS.treeHits: 4` and `TOOLS.woodFromTree: 4`.
  - `hitBlocker` gets a `remains` result: Tree → Stump; Rock and Stump → `EMPTY_TILE`.
- **Scythe on Weeds:** a new intent `clearWeeds`. The tile becomes `EMPTY_TILE`; it costs no energy and drops nothing (fiber comes in workstream D).
- **`blockerHint` texts:**
  - Tree: "Chop this tree with the axe."
  - Weeds: "Cut these weeds with the scythe."
  - Building: `null` (no hint).
- **Interact on a tile whose object is a chest:** a new intent `openChest` sets `ui.panel = {kind:'chest', mapId, tx, tz}` and records `lastAction` kind `'openChest'`.
- **Interact on a Building tile:** `blocked` with an empty reason, so no toast.
- **`planPrimaryAction`** keeps its exhaustive switch.
- **`describeIntent`** gets labels:
  - `clearWeeds` → "Cut weeds";
  - `openChest` → "Open chest";
  - the tree `chop` → "Chop tree" (the stump keeps "Chop stump").
- **`harvestQuantity` and the new quality roll** use `mapSeed(state.seed, mapId)`. The farm result is unchanged.
- **Quality roll:** `r = hashFloat(mseed, tx, tz, day, harvestCount, Salt.Quality)`. Gold if `r < 0.05`, silver if `r < 0.20`, otherwise normal. The `harvest` intent carries `{quantity, quality}`. `capacityFor` checks the item and that quality.

### 5.3 Day cycle

`startNextDay`:
1. Payout: `sellPriceFor` per stack, plus `stats.totalEarned` and `stats.parsnipsShipped`.
2. `nextDay`, then weather (global), as before.
3. Overnight on **every** map, in `MAP_IDS` order.
   - Each map runs `advanceWorldOvernight(world, {...ctx, seed: mapSeed(seed, id)}, def)`.
   - `advanceTileOvernight` gets `def.isShaded`.
   - `spreadWildCrops(world, ctx, def)` returns `world` unchanged when `def.wild === null`. Otherwise it uses `def.wild` (`maxWild`, `sproutChance`, `spreadChancePerNeighbor`). `canSproutWild(def, tile, tx, tz)` requires `state === Unplowed && crop === null && object === null && def.isShaded(tx, tz) && !isReservedTile(def, tx, tz)`. The farm-only `isShadedTile` default and `SHADE.maxWild` are no longer read by wild.ts or growth.ts.
   - Rain waters Plowed tiles on every map.
   - An unchanged map keeps its reference.
4. Restore energy.
5. The player goes to the farm spawn and facing (`mapId: 'farm'`) with `teleportSeq + 1`, as today.
6. `day/sleep` (key N) keeps working from anywhere and always wakes you on the farm.

### 5.4 `inventory/move` (a new action)

`{ type: 'inventory/move'; from: SlotRef; to: SlotRef; quantity: number | null }`. `null` means the whole source stack.

It returns the **same state reference** whenever it is rejected. The checks run in order:

1. **Paused:** rejected.
2. **Resolve each ref.**
   - Every `index`, `tx` and `tz` must be an integer (`Number.isInteger`), and a chest ref's `mapId` must be in `MAP_IDS`.
   - A player ref is valid when `0 ≤ index < unlockedSlots`.
   - A chest ref is valid only when all of these hold:
     - `ui.panel` is `{kind:'chest'}` with the same `mapId`, `tx` and `tz`;
     - that tile holds a chest;
     - `0 ≤ index < INVENTORY.chestSlots`.
3. **Source stack:** it must be non-null. `q = quantity ?? src.quantity`, and `q` must be an integer in `1 … src.quantity`.
4. **Same ref:** a no-op.
5. **Empty target:** the target gets `{...src, quantity: q}`. The source loses `q`, or becomes `null` when it reaches 0.
6. **Same `itemId` and `quality`:** `moved = min(q, maxStack − dst.quantity)`. If `moved === 0` this is a no-op; otherwise transfer `moved`.
7. **Different `itemId` or different `quality`, and `q === src.quantity`:** swap the two stacks. Silver parsnips moved onto normal parsnips swap; they don't merge.
8. **Anything else:** a no-op.

Details:
- **Chest writes** replace the tile's object with `{kind:'chest', slots: newSlots}` through `setTile` on that map. Every resulting stack, in the player's slots or the chest's, satisfies `assertValidStack` (quantity 1 … maxStack).
- **`selected`** never changes.
- **Water** stays on `inventory.water` even when the watering can moves.
- **Helpers** go in `src/state/inventory.ts`: a pure slot-array helper, `moveBetweenSlots(srcSlots, srcIndex, dstSlots, dstIndex, q)`, plus wrappers for the same-array and cross-array cases.

### 5.5 Other inventory rules

- **`createInventory`** makes 36 slots. `unlockedSlots` is 24. The starting stacks carry `quality: 0`.
- **`addItem(inventory, itemId, qty, quality = 0)`**:
  - merges into existing stacks with the same item and quality, in slots `< unlockedSlots`;
  - then fills empty slots `0 … unlockedSlots − 1` in order;
  - is all-or-nothing, as today.
- **`capacityFor(inventory, itemId, quality = 0)`** follows the same rules.
- **`countItem`** sums across qualities.
- **`mergeStacks`** merges on item and quality.
- **`selectSlot` and `cycleSlot`** are bounded by `INVENTORY.hotbarSize` (12), not by `slots.length`.
- **Config:** `INVENTORY` gets `slotCount: 36`, `startingUnlockedSlots: 24` and `chestSlots: 36`.

### 5.6 UI actions

- `shop/setOpen {open}`:
  - Opening works only when the panel is `none` and the game isn't paused; it sets `{kind:'shop'}`.
  - Closing works only when the panel is the shop.
- `ui/setInventoryOpen {open}`: the same rules, with `{kind:'inventory'}`.
- `ui/closePanel` sets the panel to `none` from any kind.
- `game/load` and `deserializeGame` reset `ui.panel` to `none` and `paused` to false.
- `inventory/select` isn't blocked by the frozen check. Moves are blocked only by pause (5.4).

---

## 6. Save version 3 (`src/state/persistence.ts`)

- **`SAVE_KEY`** stays `'meadowlight-farm.save.v1'`, so the live game's save is found and migrated. Settings (workstream K) will use their own key.
- **`migrateSave`** is a chain. Each step writes its own literal version:

```ts
export function migrateSave(value: unknown): unknown {
  let v = value;
  if (isObj(v) && v.version === 1) v = migrateV1toV2(v); // crops gain wild:false; emits version: 2
  if (isObj(v) && v.version === 2) v = migrateV2toV3(v); // emits version: 3
  return v;
}
```

**`migrateV2toV3`** is defensive: on any unexpected shape it returns the input unchanged, and validation then rejects it.

1. The seed must be a valid u32.
2. `maps.farm` is the old `world`:
   - every tile gains `object: null, fertilizer: null`;
   - chunk `revision`s are kept;
   - Rock and Stump blockers on the four **farm reserved tiles** become `EMPTY_TILE`-equivalent tiles (`{state: Unplowed, blocker: None, blockerHp: 0, crop: null, object: null, fertilizer: null}`);
   - crops and soil on those tiles stay, because they're walkable.
3. `maps.forest` and `maps.town` come from `MAPS[id].generate(seed)`.
4. `world` is deleted.
5. `player.mapId` is `'farm'`.
6. Inventory:
   - every stack gets `quality: 0`;
   - `slots` is padded with `null` to 36 (reject if the old length is over 36);
   - `unlockedSlots` is 24;
   - if an old save holds items in slots 24 and up, which can't happen from v2, reject.
7. Every `shipping.pending` stack gets `quality: 0`.
8. `ui` becomes `{ panel: {kind:'none'}, paused: false, timeScale }`, keeping `timeScale` when it's valid and using 1 otherwise.
9. Every §2.7 section gets its defaults from `createDefaultSections()`.

**Validator:** split `isValidGameState` into section validators. Everything below is required.

- **Header:** `version === 3` and the seed.
- **Time and weather:** unchanged.
- **Maps:**
  - exactly the keys `farm`, `forest` and `town`;
  - each `grid` deep-equals `MAPS[id].grid`;
  - chunks as today;
  - every tile passes `isValidTile` (§2.2 invariants, plus object and fertiliser checks);
  - `assertWorldObjectsConsistent` passes (catch its throw, then return false).
- **Placed objects:** `kind` is in `PLACED_OBJECT_KINDS`.
  - chest: exactly 36 slots, each null or a valid stack;
  - giantCrop: `cropId` is in `GIANT_CROP_IDS`, and the anchor is an integer;
  - forage: `itemId` is in `FORAGE_IDS`, and `spawnDay` is an int ≥ 0;
  - trophy: `festival` is in `FESTIVAL_IDS`, and `year` is ≥ 1;
  - decoration: `variant` is in `DECORATION_IDS`;
  - reject unknown extra fields on objects.
- **Player:** as today, plus:
  - `mapId` is in `MAP_IDS`;
  - the bounds check and the walkability check use `maps[mapId]`.
- **Stacks** (inventory, shipping, chests, festival display): `quality` is in {0, 1, 2}, and nonzero only when `hasQuality` is set.
- **Inventory:**
  - `slots.length === 36`;
  - `unlockedSlots` is 24 or 36, and slots at or above it are null;
  - `0 ≤ selected < hotbarSize`;
  - the water rules as today.
- **UI:**
  - `timeScale` is in `TIME.timeScales`;
  - `paused` is a boolean;
  - `panel` is an object with a string `kind`. Only this shape is checked: the loader resets it anyway, and later panel kinds must not need a migration.
- **Messages:** unchanged.
- **§2.7 sections**, every field:
  - integer ranges as commented;
  - strings of 1 to `PROFILE.maxNameLength` characters, trimmed and non-empty;
  - id lists are subsets of their id arrays, unique and in canonical order;
  - `npcs` has exactly `NPC_IDS` as keys;
  - buildings:
    - every building id and animal id is an integer in `1 … nextEntityId − 1`, and all of them are pairwise unique across buildings and animals combined (one shared counter);
    - each `plot` is valid;
    - at most one building per plot;
    - at most 4 animals;
    - animal kinds match the building (chicken → coop, cow → barn);
    - happiness is 0–255;
    - names are 1–`PROFILE.maxNameLength` characters.
  - `festival.display` holds at most 9 stacks, and `eggsFound` is 0–4095.

`deserializeGame` runs parse → migrate → validate. It then resets `ui.panel` and `paused`, and freezes the result in DEV as before. `reducer.ts loadState` does the same UI reset.

---

## 7. Rendering, HUD and input

### 7.1 Map changes (`main.ts`, `SceneContext`, `CameraRig`, `render/types.ts`)

- `SceneContext` makes `grid` a private field with a getter, plus `setActiveGrid(grid)`. That sets the grid and calls `rig.setBounds(worldRect(grid))`.
- `CameraRig` gets `setBounds(bounds)`, which re-clamps and marks the transform dirty.
- `SceneContext` is constructed with `selectActiveWorld(initial).grid`.
- The store listener in `main.ts`:

```ts
const load = action.type === 'game/load';
const mapChanged = selectActiveMapId(state) !== selectActiveMapId(prev);
if (load || mapChanged) ctx.setActiveGrid(selectActiveWorld(state).grid);
for (const s of systems) s.sync(state, load || mapChanged ? null : prev);
hud.sync(state, load ? null : prev);          // HUD keeps prev on a map change (toasts, day wipe, gold tween)
if (load || state.player.teleportSeq !== prev.player.teleportSeq) ctx.rig.snap(player.focus);
```

- Put the decision into a pure helper, `classifySync(state, prev, action) → { systemsPrev: 'null' | 'prev'; hudPrev: 'null' | 'prev'; setGrid: boolean; snapCamera: boolean }`. It lives in `src/render/syncPolicy.ts` and gets a unit test.
- Update the `RenderSystem` doc comment: `prev` is non-null only when the active map is the same.
- `main.ts` frame loop: `running = !selectIsFrozen(before)`.

### 7.2 Per-system changes

| System | Changes |
| --- | --- |
| TerrainRenderer | Every read uses `selectActiveWorld`; rebuild when the map id changes; per-map `isShaded` and `decor`; `cosmeticOffset` added in its cosmetic hash; ground colour by `surfaceAt` (dirt and cobble colours in palette.ts; cobble gets a subtle per-tile hash tint); no tufts or flowers on non-grass tiles or on tiles with an object; **Tree** rendering, scaled to about 0.55 × tileSize (total height ≤ 1.5, canopy radius ≤ 0.55 tile) with small cosmetic jitter so a dense forest doesn't bury the floor (per-species slot maps: merged trunk + canopy geometry from structureGeometry builders, canopy on a tint-mask sway material moved to materials.ts as `createTintMaskSwayMaterial`, hit wobble like stumps); **Weeds** (new swaying `createWeedsGeometry()` in terrainGeometry, one slot map); **Building** tiles draw only the ground slab. Water must stay ≥ 1 tile inside the edge (true for every layout in §4), so the pond builder needs no change. |
| StructureRenderer | `Map<MapId, StaticScenery>` cache built lazily per map and toggled with `visible`; farmstead (house, bin, door marker) only when `def.farmstead`, with every farmstead handle nullable; **fence and wall gaps at every warp of every map**, derived from `def.warps` (`layoutFence` takes gaps; taller gateposts only on the −X/−Z sides, while front-side gap ends keep `FENCE_SHAPE.lowHeight`); **clear corridors** through the woodland, bushes and flowers at every warp, plus a painted dirt trail strip leading off-grid; **forest scenery**: dense woodland on the −X/−Z sides, the existing front density plus shrink on +X/+Z, darker meadow, no fence; **town scenery**: low stone wall on the back sides with a gap for the west road (tz 15–17), a few trees and hedges, and the road continuing off-grid at the west warp; **town structures** from `def.structures`: four shop buildings (distinct palettes, roofs, a sign board above each door), notice board, well and lamp posts, all merged into the painted body mesh; window and lamp glass use the shared glow-glass material (rules below). Extract the private geometry helpers (box, paint, shade, pose, roof, window and door parts) into `src/render/geometryParts.ts` and reuse them. `cosmeticOffset` goes into the scenery hash. |
| CropRenderer | Active world; map-change rebuild; `cosmeticOffset`; capacity is the maximum `tileCount` over `MAPS`, allocated once. |
| TileHighlighter | Active world and grid (cached in `sync`); `highlightBoxHeight` cases: Tree 1.3, Weeds 0.6, Building 1.2; the object checked first with per-kind heights (chest 0.8, sprinkler 0.5, qualitySprinkler 0.55, scarecrow 1.4, woodFence 0.9, paths ground, giantCrop 1.6, forage 0.4, trophy 0.9, decoration 1.0); `highlightGroundHeight` treats paths as ground. |
| EffectsRenderer | Active world; early return when the map changed; axe on Tree: strike at trunk height and a fell burst (leaves, wood chips, dust) when the blocker changes Tree → Stump, plus a small screen-independent burst only (camera shake belongs to workstream B); scythe on Weeds: a green clipping burst when `before.blocker === Weeds`; shipping bin centre from the active map's `farmstead` (none off the farm); `surfaceHeight` accounts for paths; `openChest` has no particle effect. |
| WeatherRenderer | Active world; `surfaceHeightAt` returns `NaN` for tiles with a blocking object and path height for paths. |
| PlayerRenderer | Active world; `openChest` uses the `ship` clip (add it to `ACTION_CLIPS`); ground height on path objects. |
| LightingManager | No change. |
| **ObjectRenderer** (new) | See 7.3. |

Rules for every renderer in 7.2:

- **Occlusion.** Every scenery placement on every map (trees, bushes, walls, gateposts, hedges) keeps the existing `wouldOccludeFarm` test against that map's `worldRect(grid)`. Nothing outside the grid may hide a playable edge tile.
- **Night glow.** It moves out of `FarmsteadHandles`. `materials.ts` gets `getSharedGlowGlassMaterial()`, a single material. `StructureRenderer.update` updates its emissive intensity once per frame from `windowGlowAt(clockMinutes, weather)`, on every map. Every map's scenery glass and the ObjectRenderer lantern glass use it. It is never disposed per map; it is disposed once, when the StructureRenderer is disposed.
- **Farmstead handles.** House, bin, lid, coin and door marker are all nullable. `sync` and `update` null-check them and ignore `ship` and `pending` changes off the farm.

### 7.3 ObjectRenderer (`src/render/ObjectRenderer.ts`, `src/render/objectGeometry.ts`)

**Instancing**
- One `InstanceSlotMap` per (kind, part), keyed by `tileIndex` of the anchor tile.
- Capacity is the maximum `tileCount` over `MAPS`. Fence rails get twice that and are keyed by edge (`tileIndex * 2 + {0: east, 1: south}`).
- Everything is authored in tile units, facing +Z, base at y = 0, flat shaded, and built on `geometryParts.ts`.

**Diff**
- Walk chunk → tile references like TerrainRenderer and compare `tile.object !== prevTile.object`.
- Keep a `Map<key, kind>` of what each key shows, so a removal touches only the old kind.
- A changed object counts as a **placement** (pop-in animation, matrix write) only when the key's recorded kind was absent or different. If the kind and its visual data are the same, nothing is rewritten and nothing pops. Every chest deposit or withdrawal creates a new chest object with new `slots`, and a forage object can change `spawnDay`, so this matters. The open lid pose is never overwritten by a slot change.
- A giant crop draws once, at its anchor. Covered tiles are skipped.
- Fences connect to fence neighbours: on any change at (tx, tz), recompute the east and south rails of (tx, tz), the east rail of (tx − 1, tz) and the south rail of (tx, tz − 1).

**Geometry**

| kind | geometry |
| --- | --- |
| chest | Wooden body + separate lid mesh, brass corners and latch. |
| sprinkler | Copper base disc + stem + 4-nozzle cross. |
| qualitySprinkler | Gold-toned, taller, 8 nozzles. |
| scarecrow | Post + cross-arm + straw body + patched shirt (sway material) + hat. |
| woodFence | Post plus connecting rails, reusing `createFencePostGeometry` / `createFenceRailGeometry` with a new `PALETTE.woodFence`. |
| woodPath | Three plank slats flush with the ground. `castShadow` false. |
| stonePath | Three flagstone variants chosen by cosmetic hash. `castShadow` false. |
| giantCrop | The crop's produce geometry from cropGeometry.ts (export a `produceGeometryFor(form)` helper) at 3× scale in `visual.produceColor`, on a bed of leaves, centred on the 3×3 footprint. |
| forage | A small base plant (sway) plus the forage colour bits, from a render-side table keyed by `ForageId`: colour and form (`sprig`, `bulb`, `berries`, `nut`, `cap`, `root`, `holly`). |
| trophy | A gold cup on a wooden plinth. The festival picks the ribbon colour. |
| decoration | paperLantern: a post with a glowing paper box (glass material, so it glows at night). stoneLantern. flowerArch: an arch with flower clusters. |

**Animation**
- Objects pop in when placed (ease-out-back, borrowed from CropRenderer's `enter`).
- The chest lid opens while `ui.panel` is that chest's `{kind:'chest'}`, lerped in `update`.
- Per-frame commits use `commit({bounds:false})`.

**Registration and budget**
- Register the renderer in `main.ts` after the crop renderer.
- Draw calls stay within the plan budget: one mesh per (kind, part); empty meshes are invisible (`InstanceSlotMap` sets `visible = count > 0`).

### 7.4 HUD and input

- **Hotbar:**
  - It builds exactly `INVENTORY.hotbarSize` views and renders slots `0 … 11`.
  - The rebuild condition becomes `previous === null || this.views.length !== INVENTORY.hotbarSize`. The old `slots.length !== views.length` check would rebuild the DOM on every tick once slots are 36.
  - `InputController.selectSlot` is bounded by `INVENTORY.hotbarSize` too.
- **Quality stars:**
  - `icons.ts` gets `COLORS.silver = 0xcfd8e6` and `createQualityStarIcon(quality: 1 | 2)`, a faceted five-point star in the `faceted` style.
  - `ItemIconCache` gets `star(q)`, which returns clones.
  - Slot views get a `.hud-slot__quality` overlay in the bottom-left corner, hidden for quality 0.
  - Titles and aria text include "Silver" or "Gold" and the price from `sellPriceFor`.
- **Shared slot code:** move the slot DOM and render code into `src/ui/slots.ts` (`createSlotView`, `renderSlotView`) so the hotbar and the inventory screen share it.
- **`src/ui/InventoryScreen.ts` and `src/ui/inventory.css`** (imported by the screen, so hud.css isn't touched beyond small needs):
  - **Modal:**
    - the same modal skeleton as `ShopModal`, titled "Backpack" (or "Chest" when a chest is open), with a subtitle like "24 / 36 slots";
    - a chest grid of 36 slots (3 × 12) above the player grid, shown only for a chest panel;
    - a player grid: the hotbar row 0–11 with key labels, a dashed rule, then the backpack 12–35;
    - locked slots are dimmed and hatched, with `aria-disabled` and the title "Unlocks with the backpack upgrade from the general store".
  - **Picking up and placing:**
    - Left click with nothing held picks up the whole stack. The HUD stores `{ref, quantity}` only; nothing leaves `GameState` until the move is dispatched.
    - Left click on another slot dispatches `inventory/move(held.ref, target, held.quantity)` and clears `held`. Clicking the same slot cancels.
    - Right click is handled through the `contextmenu` event on the screen's root: `preventDefault`, then act. Left click uses `click`. `pointerdown` for button 2 is ignored. All listeners use the HUD `AbortSignal`.
    - Right click with nothing held picks up `ceil(q/2)`.
    - Right click while holding moves 1 and keeps holding while any remain.
    - A cursor ghost follows the pointer.
  - **`sync`:**
    - It re-renders only changed slot references, and finds the chest through `selectOpenChest(state)`.
    - It drops or clamps `held` when its source changes.
    - It is shown when `panel.kind` is `inventory` or `chest`.
- **Input (`InputController`):**
  - `KeyI` toggles the inventory, or closes a chest panel.
  - `Escape` closes any open panel, otherwise toggles pause.
  - E, K and Enter close an inventory or chest panel instead of interacting while one is open.
  - B does nothing while the inventory or a chest is open.
  - Tab is released for focus navigation while any panel is open.
  - Hotbar keys and wheel cycling are bounded to 12.
  - Update the header binding comment.
- **HUD text:**
  - `CONTROL_ROWS` and `HELP_HINTS` gain `I` → "Backpack".
  - The Interact row mentions chests.
  - `ContextHint` reads the active world and shows the new intents' labels.

---

## 8. Implementation steps

Every step is done by one agent with a fresh context, working on branch `v2` in the main checkout.

**Workflow for every step**
- Read this spec and `docs/PLAN-v2.md` first.
- Implement the step completely. Leave nothing for a later step unless the table says so.
- Update or add the tests the step lists.
- Run `npm run typecheck && npm test && npm run build` and fix everything until all three pass.
- Commit on `v2` with `Phase 0 step N: <name>`. The message body lists anything notable.

**Where changes go**
- **Mechanical compile fixes in files owned by a later step are allowed and expected.** For example, switching a renderer to `selectActiveWorld` so the build passes. The later step then does the real work.
- **Never weaken a test to make it pass.** Tests change only when the behaviour change is required by this spec.

| # | Step | Scope |
| --- | --- | --- |
| 1 | **Types, tiles and later-workstream sections** | §1 id lists; §2.1 blockers, plus `TOOLS.treeHits: 4` and `TOOLS.woodFromTree: 4`; §2.2 tile fields, `PlacedObject`, invariants, `isWalkable`, `assertWorldObjectsConsistent`, `INVENTORY.chestSlots: 36` (chest slots validated as today's stacks; step 6 adds quality); §2.6 `openChest` ActionKind (with the PlayerRenderer clip mapping); §2.7 sections with `createDefaultSections()` wired into `createInitialState`; §3 salts; `APPEARANCE`/`PROFILE` config; `SAVE_VERSION = 3`, with `migrateV2toV3` adding tile fields and section defaults for now (maps come in step 2); validator for tiles, objects and every §2.7 section; TileHighlighter box heights for the new blockers (§7.2). Tests: tile and object invariants, world object consistency, section defaults, validator rejection cases for each new field (including the shared entity-id rule), distinct salts, v1 → v3 and v2 → v3 section migration. |
| 2 | **Maps** | §4 in full: the `src/world/maps/*` modules, the three generators, `mapSeed`, `assertMapDefinitions`, and `GameState.maps` + `player.mapId`; selectors and helpers (§4.5); **every** `state.world` read in `src/` and `tests/` switched over (render and HUD mechanically, via `selectActiveWorld`); overnight on every map (§5.3 step 3) with per-map shade and wild tuning (the reworded `spreadWildCrops` / `canSproutWild`); migration world → maps with reserved-tile carving; map validation. Tests: `tests/maps.test.ts` (per-tile farm fingerprint frozen **before** any change; forest and town layout facts; generator determinism; different seeds give a different forest while the town is identical for every seed; warp reciprocity; reserved tiles clear and walkable; fresh wild count ≤ maxWild for every map over several seeds; per-map overnight; many nights never put a crop on a reserved tile), migration of a v2 save with a rock on a gate tile. |
| 3 | **Render core** | §7.1 in full (syncPolicy, `setActiveGrid`, `setBounds`, `sync(null)` on a map change, camera snap on `teleportSeq`), plus the §7.2 rows for TerrainRenderer (surfaces, Tree, Weeds, Building slab, per-map shade and decor), CropRenderer, TileHighlighter, EffectsRenderer, WeatherRenderer and PlayerRenderer. StructureRenderer gets only a mechanical guard here: farm scenery hidden off the farm, farmstead handles nullable. Warps don't exist yet; check map switching with the dev hook (`__meadowlight.actions.load` with `player.mapId` changed). Tests: `tests/syncPolicy.test.ts`. |
| 4 | **Structures and scenery** | The §7.2 StructureRenderer row and the rules below the table: geometryParts extraction, per-map scenery cache, fence and wall gaps and corridors at every warp, forest and town scenery, town buildings, hedges and props, shared glow-glass material, occlusion rule. |
| 5 | **Warps, per-map rules, trees and weeds** | §5.1, §5.2 except chest and quality (including the pickaxe and watering rules for object tiles), §2.9 `debrisCleared` / `visitedTown`. Tests: `tests/warps.test.ts` (each warp both ways, arrival facing, `teleportSeq`, blocked edges, a held-key bounce can't happen, an arrival tile blocked by a test-placed object refuses the warp), tree chop to stump to cleared with wood totals, weeds, tilling and scatter refused off the farm, pickaxe on an object tile is blocked, refill at the forest brook and the town river, determinism suite updated (a random walk may warp; structural sharing checked per map; the `teleportSeq === absoluteDay` assertion replaced by one that allows warps). |
| 6 | **Quality, 36-slot inventory, chests and UI panels** | §2.3, §2.4, §5.2 chest and quality, §5.4, §5.5, §5.6, §2.9 `parsnipsShipped` / `totalEarned`; migration and validator for stacks, inventory, UI and **chest slots with quality**; mechanical HUD and input fixes for `ui.panel` and `hotbarSize`, including the hotbar rebuild condition in §7.4. Tests: `tests/inventoryMove.test.ts` (the whole §5.4 matrix, player ↔ player and player ↔ chest, locked slots, wrong chest ref, non-integer refs, different-quality swap, paused), quality merge and sell prices, harvest quality distribution over many tiles (about 5% gold, 15% silver, ± tolerance), payout with qualities, open chest and panel freezing. |
| 7 | **Save hardening** | Audit §6 line by line against the validator and fill every gap. Add real legacy fixtures: v1 and v2 save JSON built by hand-transforming a current state back to the old shapes. Test v1 → v3 and v2 → v3 round trips (farm tiles preserved exactly, forest and town generated, gate carving), `serialize → deserialize` idempotence on v3, and a corruption case for every new field. |
| 8 | **Placed objects** | §7.3 in full, plus the object rules in Terrain, Highlighter, Weather and Player. Pure helpers (fence-edge recompute, giant-crop anchor skipping, the placement-vs-update rule) get tests in `tests/objectLayout.test.ts`. |
| 9 | **HUD and input** | §7.4 in full. |

**Why this order.** Warps (step 5) land only after the renderers can switch maps (step 3) and draw every map's scenery (step 4). So after every step, the game in the browser shows nothing broken: before step 5 the other maps are simply unreachable.

## 9. Test plan summary

New test files:
- `maps.test.ts`
- `warps.test.ts`
- `inventoryMove.test.ts`
- `quality.test.ts`
- `sections.test.ts`
- `syncPolicy.test.ts`
- `objectLayout.test.ts`

Updated test files:
- `persistence.test.ts`
- `determinism.test.ts`
- `reducer.test.ts`
- `intents.test.ts`
- `inventory.test.ts`
- `tiles.test.ts`
- `worldgen.test.ts`
- `wild.test.ts`
- `coreLoop.test.ts`
- `testUtils.ts`: add `stack(id, qty, quality = 0)`, map-aware `tileAt` / `withTile` / `withPlayer`, and `legacySave(state, 1 | 2)`.

Target: 534 tests today, well over 650 after Phase 0.

## 10. Done means

- Typecheck is clean, every test passes and the build succeeds.
- A save from the live v2 game loads with the farm intact.
- In the browser: the farm looks as before apart from the gates. Walking west through the gate reaches the forest, and walking off the south-east corner reaches the town. Both show their finished layouts.
- Trees and weeds can be cleared. Refilling works at the brook and at the river.
- Harvests sometimes give silver or gold stars.
- The backpack screen (I) moves items between the hotbar and the backpack.
- There are no console errors, and draw calls stay within budget on every map.
