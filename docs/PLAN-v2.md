# Meadowlight Farm v2 — build plan

This plan covers everything on the v2 list in one build: the v1 loose ends, feel and feedback, deeper farming, crafting, animals, foraging, cooking, a town with people, quests, festivals and quality-of-life features. It is written so parallel agents can build against one spec without guessing. Every design choice below is decided; agents implement it, they don't redesign it.

The build runs on a `v2` branch. Vercel gives every push to that branch a preview link, which is how the build gets checked in a browser. `main` (the live game) only changes when v2 is merged.

---

## 1. Ground rules

These carry over from v0 and v1 and apply to every workstream:

- The simulation stays a pure, deterministic reducer. No `Math.random`, no clock reads, no I/O in `src/state`, `src/farming`, `src/world` or any new simulation module. Randomness comes from `hash32` / `hashFloat` with a new `Salt` per decision.
- Render systems diff by reference and never mutate state. Tiles, crops, foliage, animals, objects and particles are instanced. Every lit material is flat-shaded.
- Strict TypeScript with the existing flags (no enums, no namespaces, no parameter properties, `import type` for types).
- No placeholders, TODOs or stubbed features. Anything too big to finish properly gets cut from the plan before the build starts, not half-built.
- Audio, art and music are generated in code. The game ships no downloaded asset files.
- The typecheck is clean, every test passes and the production build succeeds at the end of every phase.
- Old saves keep working: v2 migrates version-2 saves to version 3.

---

## 2. Architecture changes (Phase 0, done first and in order)

Most v2 features need these five foundations. They touch shared files, so one agent builds them before anything runs in parallel.

### 2.1 Multiple maps

`GameState.world` becomes `GameState.maps: Record<MapId, WorldState>` with `MapId = 'farm' | 'forest' | 'town'`, and the player gains `mapId`. A selector `selectActiveWorld(state)` replaces every direct `state.world` read (34 reads across 15 files today). Each map has its own `GridSpec`, layout and generator in `src/world/maps/`.

Maps connect through **warps**: edge tiles that move the player to a matching tile on another map. The farm's west gate leads to the forest; the path off the farm's south-east corner leads to town. Changing map is a teleport (`teleportSeq`), and every render system treats it as a full rebuild of the new map (`sync(state, null)` semantics).

The overnight pipeline runs on every map, not just the active one, so crops and wild plants keep growing while you're away.

| Map | Size | Character |
| --- | --- | --- |
| Farm | 48 × 40 (unchanged) | Your land |
| Forest | 36 × 30 | Mostly shaded, dense choppable trees, a stream, forage spawns |
| Town | 40 × 32 | Paths, shop buildings, a square for festivals, a notice board |

### 2.2 Placed objects

A tile gains `object: PlacedObject | null` for things the player builds or places: chests, sprinklers, scarecrows, fences, paths and giant crops. Buildings (coop, barn) become multi-tile blockers like the house. The existing `Blocker` values stay for natural things (rock, stump, water) and add `Tree` and `Weeds`.

`PlacedObject` is a union keyed by `kind`, each with its own data: a chest holds its item stacks, a giant crop records its crop and anchor tile. Paths are walkable floor; everything else blocks movement.

### 2.3 Items with quality

`ItemStack` gains `quality: 0 | 1 | 2` (normal, silver, gold). Stacks merge only with the same item and quality. Sell price is ×1, ×1.25 or ×1.5. The inventory helpers, shipping, shop and HUD icons (a small silver or gold star) all follow.

### 2.4 Inventory and storage

The inventory grows to 36 slots: the first 12 are the hotbar, the rest the backpack. Chests are placed objects with 36 slots each. One transfer action (`inventory/move` between two slot references) covers backpack, hotbar and chest moves.

### 2.5 Entities

- **Animals** live in state as a list per building: `{ id, kind, name, bornDay, fedToday, pettedToday, happiness 0–255, hasProduct }`. Where they wander is presentation only: the renderer walks them around their pen from a hash of the animal id and the time. That keeps the simulation simple and deterministic.
- **NPCs** have fixed schedules (`{ minute, mapId, tx, tz, facing }` lists per weekday and season). Their position is a pure function of the clock, so it's never stored. Friendship, gifts given and dialogue progress are stored.

### 2.6 Save version 3

`SAVE_VERSION` becomes 3. The migration wraps the old `world` as `maps.farm`, generates the forest and town from the seed, adds empty objects, quality 0 on every stack, the 36-slot inventory and default settings for new fields. The validator is extended to cover every new field.

---

## 3. Workstreams (Phase 1, in parallel)

Each workstream owns its files. Where two need the same shared file, the table in section 5 says who owns it and who only reads it.

### A. Loose ends from v1

- **Narrow-screen HUD:** below 900 px wide the clock panel is compact again (date and time on one line, weather and gold beside it) and never spans the screen. Check at 640, 800, 1024 and 1440 px wide.
- **Swaying shadows:** `materials.ts` gains a matching depth material, so every swaying mesh casts a swaying shadow (`customDepthMaterial`).
- **Summer crops:** render wheat, blackberries and snozberries at every growth stage in a test scene and fix anything that looks wrong.

### B. Feel: audio, music and feedback

- **Sound effects,** synthesised with the Web Audio API in `src/audio/`: footsteps (grass, soil, path), hoe thud, water pour, pickaxe clink, axe chop, tree fall, harvest pop, forage pluck, coin chime, chest open, craft, eat, UI click, crow caw, cluck, moo, rain loop, thunder, door, and a morning chime. Sounds react to state diffs just like the renderers, so the simulation never knows about audio.
- **Music,** generated in code: a gentle pentatonic ambient score with morning, afternoon, evening and night moods and a different key per season. Moods crossfade over about 8 seconds. It's quieter in rain and has its own theme for festivals. Audio starts on the first key press or click, as browsers require.
- **Feedback:**
  - floating "+35g" and "+1 Parsnip" labels at the point of action;
  - a morning summary card listing what was shipped, what it earned and anything that happened overnight (a crow ate a crop, an animal made something);
  - a small bounce when a crop matures;
  - screen shake on a falling tree.

### C. Farming depth

- **Sprinklers** (placed objects) water their tiles every morning before crops grow.
  - Sprinkler: the 4 tiles beside it.
  - Quality sprinkler: the 8 tiles around it.
  - The highlight shows their coverage while you're placing one.
- **Fertiliser** is applied to tilled soil before planting and lasts until the crop is harvested.
  - Basic fertiliser raises the chance of silver and gold.
  - Quality fertiliser raises it more.
  - Speed-Gro makes crops grow 10% faster, rounded, with a minimum of 1 day off.
- **Crop quality** is rolled at harvest from the fertiliser:

  | Fertiliser | Silver | Gold |
  | --- | --- | --- |
  | None | 15% | 5% |
  | Basic | 25% | 10% |
  | Quality | 35% | 20% |

- **Tool upgrades** at the town blacksmith, in two tiers per tool: copper, then steel.
  - Hoe and watering can: hold Space to charge. Copper covers a row of 3; steel covers a 3×3 area.
  - Watering can capacity grows from 40 to 55 to 70.
  - Pickaxe and axe hit harder: rocks and trees take fewer swings.
  - Each upgrade costs gold plus copper ore and takes 2 days, during which you don't have the tool.
- **Crows:** each night, if more than 15 field crops are planted, every crop outside a scarecrow's reach has a small chance to be eaten, at most 3 crops per night. Scarecrows protect everything within 8 tiles. The morning summary reports what was eaten.
- **Giant crops:** a fully mature 3×3 block of cauliflower, melon or pumpkin has a 1% chance each night to merge into one giant crop (a placed object). Chop it with the axe for 15–21 produce.
- **Weeds:** each night, empty grass has a small chance to grow weeds (a blocker). The scythe clears weeds and drops fiber.
- **Trees:** trees grow on the farm edges and fill the forest. Chopping one with the axe drops wood and leaves a stump; some drop sap too. Stumps left in the forest regrow into trees after a season.

### D. Crafting and materials

- **New materials:** copper ore (a 25% chance from a broken rock), sap (from trees, sometimes from stumps) and fiber (from weeds).
- **Crafting** happens from the inventory screen (a Crafting tab). Recipes unlock as you go: the starting set, then more from quests and friendship.

| Recipe | Cost | Makes |
| --- | --- | --- |
| Chest | 50 wood | 1 |
| Wood fence | 2 wood | 1 |
| Wood path | 1 wood | 1 |
| Stone path | 1 stone | 1 |
| Scarecrow | 25 wood, 10 fiber, 5 stone | 1 |
| Sprinkler | 1 copper ore, 10 stone | 1 |
| Quality sprinkler | 3 copper ore, 15 stone, 10 wood | 1 |
| Basic fertiliser | 2 sap | 5 |
| Quality fertiliser | 4 sap, 2 fiber | 5 |
| Speed-Gro | 2 sap, 1 mushroom | 5 |

- **Placing:** select a placeable item and press Space on an empty tile. The highlight shows a ghost of the object. Pick a placed object back up with the pickaxe (or the axe for wooden things). A chest must be empty before you can pick it up.

### E. Animals

- **Buildings:** the farm has two marked building plots. Order a Coop (4,000g plus 300 wood and 100 stone) or a Barn (6,000g plus 350 wood and 150 stone) from the town carpenter; it's built after 2 nights. Each building has a fenced pen, a feeding trough and room for 4 animals.
- **Animals:** buy them from the town ranch.

  | Animal | Price | Product |
  | --- | --- | --- |
  | Chicken | 800g | An egg every day |
  | Cow | 1,500g | Milk every day |

  You name each animal when you buy it.
- **Daily care:**
  - Put wheat in the trough (interact while holding wheat); each animal eats 1 a day.
  - Pet each animal once a day (interact) to raise its happiness.
  - A fed animal makes its product overnight. Collect it from the building (interact).
  - Happiness sets the product quality, using the same silver and gold scale as crops.
- **Visuals:** low-poly instanced chickens and cows wander their pens by day and go inside at night. Hearts pop up when you pet one.

### F. Forest and foraging

- **The forest map** (see 2.1): mostly shade, so mushrooms and snozberries spread there the same way they do on the farm. It has a stream (refill the can there), dense trees and a clearing.
- **Forage spawns:** each morning 4–8 forage items appear on random forest tiles, and they vanish at the end of the day if not picked up.

  | Season | Forage |
  | --- | --- |
  | Spring | Wild leek, spring onion |
  | Summer | Wild berries, sweet pea |
  | Fall | Hazelnut, chanterelle |
  | Winter | Frost root, holly |

- The forest is also where Old Fennick (see H) spends his mornings.

### G. Cooking and food

- **Cooking:** interacting with the farmhouse door opens a small menu: Sleep, Cook or Cancel. Cooking takes ingredients from the backpack.
- **Food** is a new item kind with an energy value. Using it from the hotbar eats it.

| Dish | Ingredients | Energy | Sells for |
| --- | --- | --- | --- |
| Fried mushrooms | 2 mushroom | 40 | 90g |
| Veggie stew | carrot, potato, parsnip | 80 | 220g |
| Berry tart | 3 blackberry, 1 wheat | 70 | 260g |
| Pumpkin soup | 1 pumpkin, 1 milk | 100 | 400g |
| Snozberry jam | 3 snozberry | 50 | 350g |
| Spectral tea | 1 spectraherb | full | 450g |
| Omelette | 2 egg, 1 milk | 60 | 180g |
| Forest salad | 1 wild leek, 1 spring onion, 1 carrot | 55 | 160g |

Recipes are learned from friendships and quests. Fried mushrooms and veggie stew are known from the start.

### H. Town and people

- **The town map** (see 2.1) with four shops, a square and a notice board.

| Place | Keeper | Open | Sells / does |
| --- | --- | --- | --- |
| General store | Marigold | 9:00–17:00, not Wednesdays | Seeds (the current seed shop moves here), fertiliser, the backpack upgrade |
| Blacksmith | Bram | 9:00–16:00 | Copper ore, tool upgrades |
| Carpenter | Juniper | 9:00–17:00 | Coop, barn, wood, stone, house upgrade (bigger kitchen with more recipe slots) |
| Ranch | Tess | 9:00–16:00 | Chickens, cows, wheat |

The B shortcut opens the general store only while you're standing at its counter. Everywhere else, shops are reached by walking there.

- **Six villagers**, all original characters:

| Name | Who | Loves | Where to find them |
| --- | --- | --- | --- |
| Marigold | Runs the general store, cheerful gossip | Strawberry, berry tart | Store by day, square in the evening |
| Bram | Gruff blacksmith with a soft side | Spectraherb, pumpkin soup | Forge, walks by the river on Sundays |
| Juniper | Carpenter who loves building things | Wood (oddly), veggie stew | Workshop, the farm edge on rest days |
| Tess | Rancher, practical and warm | Milk, omelette | Ranch, the pens at dawn |
| Old Fennick | Retired forester, tells stories about the woods | Mushrooms, hazelnut | The forest in the morning, the square after lunch |
| Pip | A curious kid | Snozberries, snozberry jam | Anywhere, always running |

- **Friendship:** 0–10 hearts, 250 points each. Talking once a day gives +20. A gift, at most one a day and two a week per person, gives +80 if loved, +45 if liked, −20 if disliked and +20 otherwise. Every villager has a loved, liked and disliked list.
- **Dialogue:** each villager has lines for each season and for heart levels 0, 2, 4, 6 and 8. Heart events at 2, 4 and 6 hearts are short conversations that teach a recipe or give a gift.
- **Presence:** villagers walk their schedules on the town and forest maps as low-poly characters built from the player model with their own colours. Interact to talk; interact while holding an item to give it.

### I. Quests

- **Story quests** unlock the game step by step, with rewards shown in the quest journal:
  - ship 5 parsnips;
  - clear 10 debris;
  - visit the town;
  - craft a chest;
  - forage 5 things in the forest;
  - build a coop;
  - reach 3 hearts with anyone;
  - earn 10,000g in total.
- **Notice board requests:** a new deterministic request each Monday, such as "Bring Tess 10 wheat by Friday". Completing one pays gold and gives friendship with the requester.
- **Quest journal:** press Q, or open it from the pause menu. It lists active quests, their progress and their rewards.

### J. Festivals

One festival per season, on day 14. On festival days the town square is decorated and the festival runs from 9:00 to 22:00. Walking into town that day takes you there.

| Season | Festival | What happens |
| --- | --- | --- |
| Spring | Blossom Fair | 12 painted eggs hidden around town; find as many as you can in 90 in-game minutes. Prizes: festival-only seeds (Starbloom, a fall flower sold only here) and gold for the most eggs. |
| Summer | Lantern Night | Evening lanterns over the river. Buy and release a lantern for +1 heart with everyone present. The festival shop sells rare decorations. |
| Fall | Harvest Fair | Put up to 9 items in your display. It's scored by item value, quality and variety; the top score wins gold and a trophy object for the farm. |
| Winter | Starfall Feast | Gift exchange: you draw one villager, and a gift they love gives +2 hearts. There's a feast table for everyone. |

### K. Quality of life

- **Title screen:** Continue, New Farm, Load, Settings. There are three save slots, each showing the farm name, date and gold.
- **New farm:** choose your name, the farm's name and your farmer's look: skin tone, hair style (3), hair colour, shirt, overalls and hat (or no hat). All of it can be changed later from a mirror in the farmhouse.
- **Inventory screen (I):** 36 slots with drag-and-drop (or click to pick up and click to place), plus Crafting and Recipes tabs and a trash slot. The backpack starts at 24 slots; the general store sells the upgrade to 36.
- **Settings:** master, music and effects volume, key rebinding, graphics quality (shadows on or off, render scale, particles), touch controls on, off or auto, show FPS, and reduced motion (no screen shake or bounces). Settings are stored separately from saves.
- **Touch controls:** a virtual joystick on the left and Use / Interact buttons on the right, tap a hotbar slot to select it, pinch to zoom. They turn on automatically on touch devices.
- **Gamepad controls:** left stick to move, A to use, B to interact, bumpers to switch slots, Start to pause, Y for the inventory.

---

## 4. Phases

| Phase | Work | Runs as |
| --- | --- | --- |
| 0 | Foundations (section 2) plus migration and tests | One agent, sequential. Everything else depends on it. |
| 1 | Workstreams A–K | Parallel agents with owned files (section 5); each workstream writes its own tests |
| 2 | Integration: wire systems into `main.ts`, HUD screens and input; full typecheck, tests and build | One integrator agent |
| 3 | Adversarial review: simulation, rendering, UI, audio, performance and spec-compliance lenses, each with an independent verifier | Parallel reviewers, then one fixer per file group |
| 4 | Browser check on the v2 preview link: play a full year (with fast time), every map, festival, animal and recipe, at desktop and phone width | Me, with the browser |
| 5 | Release: merge `v2` into `main`, tag `v2`, live on Vercel | Me, after you've played it |

---

## 5. File ownership in Phase 1

Shared-file rule: during Phase 1, only the listed owner edits a file. Anyone else who needs a change asks the Phase 2 integrator, who applies it.

| Workstream | Owns (creates or edits) |
| --- | --- |
| A Loose ends | `src/ui/hud.css`, `src/render/materials.ts` |
| B Feel | `src/audio/*`, `src/render/FloatingTextRenderer.ts`, `src/ui/MorningSummary.ts` |
| C Farming depth | `src/farming/*` (except `wild.ts`), `src/render/ObjectRenderer.ts`, `src/render/objectGeometry.ts` |
| D Crafting | `src/items/*`, `src/crafting/*`, `src/ui/InventoryScreen.ts` |
| E Animals | `src/animals/*`, `src/render/AnimalRenderer.ts`, `src/render/animalGeometry.ts`, `src/render/BuildingRenderer.ts` |
| F Forest | `src/world/maps/forest.ts`, `src/farming/wild.ts`, `src/foraging/*` |
| G Cooking | `src/cooking/*`, `src/ui/CookingMenu.ts` |
| H Town & people | `src/world/maps/town.ts`, `src/npcs/*`, `src/render/NpcRenderer.ts`, `src/ui/DialogueBox.ts` |
| I Quests | `src/quests/*`, `src/ui/QuestJournal.ts` |
| J Festivals | `src/festivals/*`, `src/render/FestivalRenderer.ts` |
| K Quality of life | `src/settings/*`, `src/ui/TitleScreen.ts`, `src/ui/SettingsScreen.ts`, `src/input/touch.ts`, `src/input/gamepad.ts`, `src/render/playerModel.ts` |
| Integrator (Phase 2) | `src/state/reducer.ts`, `src/state/actions.ts`, `src/state/intents.ts`, `src/ui/Hud.ts`, `src/input/InputController.ts`, `src/main.ts`, `src/config.ts` |

Each workstream exports pure handlers (`(state, action) => state` for its own action types, plus `planX(state)` functions for its intents). The integrator composes them into the root reducer and planner. That's what lets eleven streams work at once without editing the same reducer.

---

## 6. Done means

- Every item in sections 2 and 3 works in the browser build, with no console errors.
- Typecheck clean, all tests passing (target: well over 800, with each workstream adding its own) and the production build succeeding.
- A version-2 save from the live game loads into v2 with the farm intact.
- 60 fps on the farm, in town and during a festival on a mid-range laptop. There's a budget of about 150 draw calls and 400k triangles on screen, and the per-frame update stays under 1 ms.
- It plays at desktop width, laptop width and phone width with touch controls.
- The README is updated for players: maps, animals, cooking, villagers, festivals and controls.

---

## 7. Risks and what they cost

- **Size.** This is several times the size of v0 and v1 combined: 11 parallel workstreams, an integration pass and a review pass. Expect a large ultracode run, likely several hours and on the order of 50–100 agent runs, with a real chance of hitting the session limit partway. That happened before. The phases are built to resume where they stopped.
- **The map refactor (Phase 0) is the riskiest step.** Every renderer assumes one world today. It lands and is tested before anything else starts.
- **Integration conflicts.** The shared-file rule in section 5 and the pure-handler pattern keep streams apart. The integrator is still the bottleneck, and Phase 2 takes as long as it takes.
- **Balance.** Prices, costs and growth times are first guesses. Expect a tuning pass after you've played it.
- **One shot is optimistic.** The plan aims to finish in one run. Realistically, Phase 4 finds things to fix, and you'll want to play it and ask for changes before release.
