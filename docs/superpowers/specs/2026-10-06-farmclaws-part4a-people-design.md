# Farmclaws part 4a spec: people

This is the build spec for part 4a, the first of three parts that together make part 4 of the farmclaws design (`docs/superpowers/specs/2026-09-29-farmclaws-design.md`, sections 8, 9 and 11.2):

| Part | Builds |
| --- | --- |
| **4a People** (this spec) | The characters you walk up to and talk to, Sol's parts exchange building, and the Neighbours map |
| 4b Shops and parts | Parts as items, the parts exchange, Juniper's robot workshop, fitting parts at the bench |
| 4c Jobs | The jobs framework, jobs 1–3 on the neighbours' fields, unlocks per job, the balance pass |

The game has no characters yet. The v2 plan's "Town and people" workstream was never built: shopkeepers exist only as save data, the shops are scenery, and the seed shop opens from anywhere with B. Part 4a gives the farmclaws cast and the shopkeepers a place in the world, so parts 4b and 4c have someone to sell parts and hand out jobs.

Every decision here is final for part 4a. If something in the code makes a rule impossible, pick the smallest change that keeps the rule's intent and write it down in the step's commit message.

Global rules (unchanged from parts 1–3; see also `CLAUDE.md`):

- The simulation stays pure and deterministic: no `Math.random`, no clock and no I/O in `src/core`, `src/state`, `src/world`, `src/farming`, `src/time`, `src/robots` or the new `src/people`.
- Strict TypeScript with `erasableSyntaxOnly`: no enums, no namespaces, no parameter properties, `as const` objects plus union types, `import type` for types.
- No TODOs, placeholders or stubs.
- `npm run typecheck`, `npm test` and `npm run build` pass after every step, and `npm run build:check` passes at the end.
- State is immutable with structural sharing.
- Numbers come from config, never inline.
- Player-facing text is copied verbatim from this spec.

---

## 1. Scope

**Part 4a builds:**

- **The cast:** seven characters on fixed spots. Sol, Cosmo and Barnaby (the job givers of jobs 1–3), plus the shopkeepers Marigold, Bram, Juniper and Tess.
- **Talking:** E on a character opens a chat box with their line for the day and any action buttons. Marigold's **Shop** opens the seed shop.
- **Line banks:** an introduction, everyday lines and lines that react to the farm, picked deterministically.
- **The parts exchange building** in the town, replacing the notice board.
- **The Neighbours map:** Cosmo's and Barnaby's farms, through a gate on the town's east edge.
- **Rendering:** the characters, their nameplates, and the new buildings.
- Save version 7, with migration and validation.
- A browser playbook.

**Part 4a does not build:**

| Thing | Where |
| --- | --- |
| Sol's and Juniper's shop menus, parts as items | 4b |
| Jobs, the "Job" button, crops and robots on the neighbours' fields, Barnaby's generator, Cosmo's chickens | 4c |
| Bram's and Tess's shop menus | Not in farmclaws release 1 |
| Hollis, Wendell and Ziggy | Their jobs' parts (5 and 7) |
| Timetables, walking characters | Not planned |
| Friendship, gifts, heart events | Cut by the design (§10) |
| Removing the B shortcut to the seed shop | Not planned |

---

## 2. The cast

### 2.1 Ids

`NPC_IDS` becomes `['sol', 'cosmo', 'barnaby', 'marigold', 'bram', 'juniper', 'tess']`. Fennick and Pip are removed; the design cut them (§15.3).

`src/people/cast.ts` (pure) holds each character's display data:

| Id | Name | Role line | Map | Spot (tx, tz) | Faces |
| --- | --- | --- | --- | --- | --- |
| `sol` | Sol | Parts exchange | town | (21, 7) | South |
| `marigold` | Marigold | General store | town | (7, 7) | South |
| `bram` | Bram | Blacksmith | town | (16, 7) | South |
| `juniper` | Juniper | Carpenter | town | (24, 7) | South |
| `tess` | Tess | Ranch | town | (35, 7) | South |
| `cosmo` | Cosmo | Farmer | neighbours | (7, 13) | South |
| `barnaby` | Barnaby | Farmer | neighbours | (25, 15) | North |

Each shopkeeper stands beside the tile in front of their shop's door, so the door path stays clear: one tile east, except Juniper, who stands one tile west, because a lamp post is south of the east tile. Sol stands beside the parts exchange's door (section 4).

### 2.2 On the map

- `MapDefinition` gains `npcs: readonly NpcPlacement[]`, where `NpcPlacement = { id: NpcId; tx: number; tz: number; facing: Direction }`. The town and the Neighbours map list theirs; the farm and the forest list none.
- **A character's tile** blocks movement for the player like a structure: walking into it is refused silently, and E talks.
- Placing an object on a character's tile is refused with "Someone's standing there.".
- `assertMapDefinitions` (the startup check) also checks every placement:
  - the tile is on its map, walkable, and not reserved (gates and arrivals);
  - it is not a door tile or the tile in front of a door;
  - it is reachable: one of its orthogonal neighbours is walkable, isn't another character's spot, and can be reached from one of the map's arrival tiles over walkable tiles that aren't character spots (checked on the world generated with seed 0; a map with characters generates the same world for every seed);
  - no two characters share a tile, and each id appears on exactly one map (until step 4 places Cosmo and Barnaby, at most one).
- `npcAt(mapId, tx, tz): NpcId | null` (pure, in `src/people/cast.ts`) is the lookup.

### 2.3 Looks

- Characters reuse the player's low-poly model (`src/render/playerModel.ts`) with a fixed appearance per character (`CAST_LOOKS` in `src/people/cast.ts`: skin tone, hair style, hair colour, shirt, overalls, hat, from the existing appearance ranges), plus one prop each:

  | Id | Prop |
  | --- | --- |
  | `sol` | A tool apron |
  | `cosmo` | A straw hat with a feather |
  | `barnaby` | A clipboard |
  | `marigold` | A seed pouch |
  | `bram` | A leather smith's apron |
  | `juniper` | A pencil behind the ear (a small block on the head) |
  | `tess` | A neckerchief |

- They stand facing their direction with a gentle idle sway (`NPC_LOOKS.swaySeconds`, `NPC_LOOKS.swayDegrees` in config). They don't turn to face the player.
- **Nameplate:** a small text plate (the character's name) floats above the head of the character on the tile ahead of the player, while the game isn't frozen. The plates are prebuilt canvas textures, one per character, made once.

---

## 3. Talking

### 3.1 The intent

- `planInteraction` checks for a character on the target tile **first**, before robots, objects and blockers: `{ kind: 'talkTo'; npc: NpcId }`, hint "Talk to {name}".
- Talking costs no energy and no time, and works while carrying a robot, so `planCarry` checks for a character before its own rules.
- Shift + E (`planShiftInteraction`) on a character acts like E.
- The reducer opens `UiPanel { kind: 'talk'; npc: NpcId; line: string }`, which freezes the game like every panel, and records the chat (section 3.4). The panel carries the line, picked before the chat is recorded; the chat box only shows it.

### 3.2 The chat box (`src/ui/ChatBox.ts`, main chunk)

- **Layout:** a panel along the bottom of the screen, above the hotbar. It shows the character's name, their role line under it in smaller text, today's line, and a row of action buttons. A **Close** button sits at the top right.
- **Keys:** E, K, Enter and Escape close it. `panelKeyCommand` treats the talk panel like the inventory screen for the interact keys.
- **Actions in 4a:**
  - Marigold: **Shop**, which closes the chat and opens the seed shop, through one action, `talk/act`, that checks the talk panel is open on that character, the game isn't paused and the action is theirs.
  - Everyone else: none.

  The action list comes from a pure `npcActions(npc): readonly NpcAction[]` in `src/people/cast.ts`, which 4b and 4c extend.
- **Phone width** (< `ROBOT_SCREEN.phoneMaxWidth`): the box spans the screen width and the buttons wrap.
- Text is written with `textContent` only.

### 3.3 Which line

`src/people/lines.ts` (pure) exports `lineFor(state: GameState, npc: NpcId): string`, which picks:

1. **The introduction**, when the character's `talks` is 0.
2. Otherwise, **the first reactive line whose condition holds**, in the order listed in section 3.5.
3. Otherwise, **an everyday line**: `everyday[hash32(seed, absoluteDay, npcIndex) % everyday.length]`, where `npcIndex` is the character's position in `NPC_IDS`.

The same character says the same line all day unless the farm changes a reactive condition. Lines use `{name}` (a robot's name) and `{season}` (the season's name in lower case) where shown.

### 3.4 What a chat records

- Each chat adds 1 to the character's `talks` and sets `talkedToday: true`. The line is picked **before** the chat is recorded, so the first chat shows the introduction.
- `talkedToday` resets each morning in `startNextDay`. It has no effect in 4a; 4c uses it.

### 3.5 The line banks

**Sol**, a seeder turned robot-builder: practical, a little wistful.
- Introduction: "Sol. I used to seed fields by hand; now I build the hands. When your robots need parts, this is the place."
- Reactive:
  - Any robot is `ruined` (the lowest id's name): "Water and wires don't mix. Bring what's left of {name} to the bench."
  - Any robot is `broken` (the lowest id's name): "{name} took a swim? Fish it out today, or there won't be much to fix tomorrow."
- Everyday:
  1. "A robot does exactly what you tell it. That's the good news and the bad news."
  2. "I seeded this valley for twenty years. My robots do it in a morning, if I write them well."
  3. "Most broken robots aren't broken. They're just obeying something nobody meant to say."
  4. "Keep them near a generator at night. A flat robot is a very expensive lawn ornament."
  5. "Half my old crew build robots now. The other half still won't talk to me."
  6. "Start small. One robot, one job, one zone."

**Cosmo**, the under-user: playful, easily delighted.
- Introduction: "Hi! I'm Cosmo. My robot is the biggest one in the valley. It mostly says hello to the chickens."
- Reactive:
  - One of your robots used `Say` today: "Your robot talked today! Mine talks every day. To the chickens. They love it, probably."
- Everyday:
  1. "I bet robots can do loads of things. I just haven't asked mine to yet."
  2. "Do you think the chickens know the robot's name? I think they do."
  3. "My robot cost more than my house. Worth it. Look at it wave!"
  4. "Someone told me robots can harvest. Wild, right?"
  5. "I tried to read the program once. Too many blocks. I went to feed the chickens."
  6. "Come by the farm sometime. Bring snacks. The robot can't eat them, but I can."

**Barnaby**, the evangelist: big claims, no measurements.
- Introduction: "Barnaby. Four robots, one field, zero effort. That's the future, and I'm already living in it."
- Reactive:
  - You have no robots: "No robots yet? You're leaving money in the field, friend."
  - You have 4 or more robots: "Four robots or more? Now you're thinking like me. Scale fixes everything."
- Everyday:
  1. "Robots never get tired. Mine just get a bit flat in the afternoons."
  2. "Measure it? Why measure it? You can see it's working. Mostly."
  3. "My field's nearly harvested. It's been nearly harvested since Tuesday."
  4. "The trick is more robots. If that doesn't work, even more robots."
  5. "Tokens per crop? I don't do sums. I do vision."
  6. "One day every farm will run itself. Mine's halfway there. Roughly."

**Marigold**, the general store: warm, all about seeds.
- Introduction: "Welcome! I'm Marigold. Seeds, fertiliser, a bigger backpack one day. Shop with me any time."
- Reactive:
  - You carry no seeds: "Out of seeds? I've got plenty for {season}."
- Everyday:
  1. "Parsnips in spring, pumpkins in fall. Get the season right and the rest is watering."
  2. "Fertiliser is worth every coin. Ask anyone with gold-star carrots."
  3. "Rain saves you a watering. My favourite kind of weather."
  4. "Cauliflower takes its time, but oh, the price."
  5. "Strawberries keep giving. Plant them early and you'll be picking all spring."
  6. "If something wilts, it was the season, not you. Mostly."

**Bram**, the blacksmith: gruff, few words.
- Introduction: "Bram. Blacksmith. I sharpen tools and I don't do small talk."
- Reactive:
  - You carry 5 or more copper ore: "That's a fair bit of copper. Sprinklers don't build themselves."
- Everyday:
  1. "A good tool outlives its owner."
  2. "Rocks are just iron that hasn't met me yet."
  3. "Copper's in the rocks out on your farm. Break enough and you'll find it."
  4. "Hot forge, cold drink. That's my day."
  5. "Robots? Sol's business. I make things that stay where you put them."
  6. "Swing the pickaxe twice. Rocks are stubborn."

**Juniper**, the carpenter: practical, proud of good joints.
- Introduction: "Juniper. I build barns, coops and anything with a hammer. Soon, robots too."
- Reactive:
  - A robot is on your workbench (its name): "{name} is up on your bench, I hear. A good bench is half the job."
- Everyday:
  1. "Measure twice, cut once. Same goes for programs, I'd guess."
  2. "Wood and stone. Bring me enough and I'll build you something that lasts."
  3. "A coop keeps chickens dry. A barn keeps cows happy. Happy cows, happy farmer."
  4. "Sol's been asking about my workbench designs. Watch this space."
  5. "Every good fence starts with a straight line."
  6. "If it creaks, it needs a nail. If it wobbles, it needs two."

**Tess**, the ranch: easy-going, loves animals.
- Introduction: "Hi there, I'm Tess. Chickens, cows and wheat to feed them. Come see the ranch."
- Reactive:
  - It's raining: "Rain again. The cows don't mind, and neither do I."
- Everyday:
  1. "A chicken a day keeps the egg basket full."
  2. "Cows like routine. Same time, same trough, every day."
  3. "Wheat's the cheapest feed there is. Grow your own and save a fortune."
  4. "Pet your animals. They notice."
  5. "Cosmo's chickens are the best-greeted chickens in the valley."
  6. "Big skies, quiet fields. Best job there is."

**Reactive conditions, exactly:**

| Condition | Rule |
| --- | --- |
| Any robot ruined / broken | `robots.list` has a robot with that power; `{name}` is the lowest-id such robot's name. |
| A robot used Say today | `robots.log` has an entry with `day` = today and `event` = `{ kind: 'did', action: 'say' }`. |
| No robots / 4 or more | `robots.list.length` is 0 / ≥ 4. Checked in that order. |
| No seeds | No inventory slot holds a seed item. |
| 5 or more copper ore | `countItem(inventory, 'copperOre') >= 5`. |
| A robot on the workbench | `robotOnBench(state)` isn't null; `{name}` is its name. |
| Raining | Today's weather waters the farm (`weatherWaters`). |

---

## 4. The parts exchange building

- `STRUCTURE_KINDS` gains `'partsExchange'` and loses `'noticeBoard'`. (Section 5 adds the Neighbours map's kinds.)
- In the town, the notice board and the hedges at x 18–21 (`hedge(18, 0, 4, 6)`, `hedge(18, 6, 1, 1)`, `hedge(21, 6, 1, 1)`, `noticeBoard (19, 6, 2, 1)`) are replaced by one structure: `{ kind: 'partsExchange', rect: (18, 0, 4, 7), door: (20, 6) }`.
- The blocked tiles are exactly the same set as before, so saved town tiles don't change. A test pins this.
- **Geometry** (`src/render/townGeometry.ts`): a narrow two-storey workshop in the shops' style, with a sign of a cog and a claw, a big front window, and a crate of parts by the door.
- The door does nothing yet. Sol stands at (21, 7), east of the tile in front of it.

---

## 5. The Neighbours map

`MAP_IDS` gains `'neighbours'`. The map is 40 × 28, fixed for every seed, with `allowsTilling: false`. Its source is `src/world/maps/neighbours.ts`.

### 5.1 Gates

- The town gains a warp: stepping East from (39, 16), the east end of the main street, arrives at neighbours (1, 14), facing East.
- The Neighbours map's warp: stepping West from (0, 14) arrives at town (38, 16), facing West.
- Both gates are reserved tiles, as on the other maps.

### 5.2 Layout

The camera's occlusion rule applies, as in the town: anything tall stands in the back band (z 0–4), and every back-band tile is covered by a building or a hedge, so nothing walkable hides behind them.

- **Back band (z 0–4):**
  - Cosmo's house: rect (3, 0, 6, 5), door (5, 4).
  - Cosmo's chicken coop: rect (11, 0, 4, 5).
  - Barnaby's house: rect (24, 0, 6, 5), door (26, 4).
  - Hedges fill x 0–2, 9–10, 15–23 and 30–39.
- **The lane:** dirt surface, z 13–15, x 0–39.
- **Cosmo's field:** a wood-fence ring with corners (3, 5) and (10, 12), leaving a gap at (6, 12) as the gate. Its inside, x 4–9 and z 6–11, is bare dirt. Cosmo stands on the lane at (7, 13).
- **Barnaby's field:** a wood-fence ring with corners (20, 16) and (29, 25), leaving a gap at (24, 16) as the gate. Its inside, x 21–28 and z 17–24, is bare dirt. Barnaby stands on the lane at (25, 15).
- **Everything else** is grass, with low scenery only (flowers and small bushes, which don't block) outside the back band.
- **The fences** are `woodFence` placed objects on the map's tiles.
- **The fields are bare dirt** (the `'dirt'` surface on `Unplowed` tiles), not soil. The overnight step changes tilled soil on every map, and dirt stays put. Part 4c turns the insides into soil with crops.
- **Structure kinds:** the houses and the coop are `'cosmoHouse'`, `'barnabyHouse'` and `'chickenCoop'` in `STRUCTURE_KINDS`.
- **Houses** reuse the farmhouse's geometry builder (`FarmhouseSpec`, which gains an optional roof colour) at the same scale, with each farmer's own roof colour (`NEIGHBOUR_ROOFS` in config). No coop builder exists, so the coop is a plain wooden shed.
- **The neighbours' fences stay theirs:** on this map the pickaxe and the axe refuse an object on either field's fence ring with "That belongs to the neighbours."; anything the player puts down elsewhere comes back up as usual.
- **Scenery:** the farm's style (a wooden fence round the grid, the farm's meadow tones) with its own cosmetic offset. The map's name is "The Neighbours".

### 5.3 Checks

`assertMapDefinitions` covers the new map like the others:
- the gate is clear;
- every walkable tile is reachable from the arrival tile;
- the back band is fully covered;
- the fence gaps are walkable;
- every character's spot passes section 2.2.

---

## 6. Save version 7

### 6.1 Types

- **The `npcs` section:** `GameSections.npcs` becomes `Readonly<Record<NpcId, NpcTalk>>`, with `interface NpcTalk { readonly talks: number; readonly talkedToday: boolean }`.
- `NpcRelation` and `HeartEventLevel` are removed, along with anything that only they used.
- `UiPanel` gains `{ kind: 'talk'; npc: NpcId; line: string }`. The loader resets the panel, so this needs no migration.

### 6.2 Migration (`migrateV6toV7`)

- **Maps:** `maps.neighbours` is generated from its fixed definition.
- **`npcs`:**
  - Marigold, Bram, Juniper and Tess keep `talks` and `talkedToday`.
  - Sol, Cosmo and Barnaby start at `{ talks: 0, talkedToday: false }`.
  - Fennick and Pip are dropped, along with every friendship field.
- **Sections that named a removed character:**
  - `quests.board` becomes null when its `npc` is `fennick` or `pip`.
  - `festival.giftTarget` becomes null when it is `fennick` or `pip`.
- **Town:** the saved town tiles are kept; the structures are map data, not saved.
- **Version:** `SAVE_VERSION = 7`.

### 6.3 Validation

- `npcs` has exactly the seven ids, each with exact keys: `talks`, a non-negative integer, and `talkedToday`, a boolean.
- `maps.neighbours` is valid like the other maps.
- `player.mapId` may be `'neighbours'`.
- Robots stay on the farm, as before.
- `quests.board.npc` and `festival.giftTarget` take only the new ids.

---

## 7. Tests

| File | Covers |
| --- | --- |
| `tests/cast.test.ts` | Every character's spot passes the map rules, `npcAt` finds each one, a character's tile blocks movement and placement ("Someone's standing there."), and the action list (Marigold's Shop only). |
| `tests/lines.test.ts` | Introduction first; each reactive condition picks its line, in order and with `{name}` / `{season}` filled; the everyday pick is stable all day and changes with the day; every bank has an introduction and 6 everyday lines; lines are verbatim. |
| `tests/talk.test.ts` | The `talkTo` intent and hint, before robots and objects; while carrying; Shift + E; the talk panel opening and freezing; `talks` and `talkedToday` recorded; the morning reset; the panel keys. |
| `tests/neighboursMap.test.ts` | The layout (back band, fences, gaps, dirt fields), both gates and their arrivals, reachability, and that the overnight step leaves the fields unchanged. |
| `tests/maps.test.ts` (extend) | The town's blocked tiles are unchanged by the parts exchange, and the east gate exists. |
| `tests/saveV7.test.ts` | v6 → v7 (the v2 fixture migrates through every version), the `npcs` reshape, `quests.board` / `festival.giftTarget` naming a removed character, a round trip standing on the Neighbours map, and one corrupted field per §6.3 rule. |
| `tests/sections.test.ts` (extend) | The new `npcs` defaults; `livelySections` updated. |

The chat box, the nameplates and the character models are checked in the browser playbook.

**Browser playbook:** `.claude/skills/game-driven-qa/scenarios/farmclaws-part4a.md`:
1. Walk into town and talk to each shopkeeper and Sol: the introduction first, then an everyday line on a second chat.
2. Open Marigold's Shop from the chat; buy a seed packet.
3. Check a reactive line: add a robot with the dev hooks, drive it into the pond and sleep so it's ruined, then talk to Sol.
4. Walk through the east gate to the Neighbours map, and talk to Cosmo and Barnaby.
5. Check that characters block walking and placing, and the nameplate on the character ahead.
6. Check the phone layout of the chat box.
7. Sleep, and confirm the fields and fences are unchanged the next morning.
8. Save, reload on the Neighbours map, and run `npm run build:check` with no console errors.

---

## 8. Implementation steps

1. Save version 7 scaffolding, the new `NPC_IDS` and the `npcs` reshape (migration, validation, the sections that named removed characters).
2. The cast data, `npcAt`, `MapDefinition.npcs`, the startup checks, and blocking movement and placement.
3. The parts exchange structure in the town, with its geometry.
4. The Neighbours map (layout, both gates, migration of the map, checks).
5. Line banks and `lineFor`.
6. The talk intent, panel, chat recording, morning reset and panel keys.
7. The chat box UI, with Marigold's Shop.
8. Rendering the characters and their nameplates.
9. Rendering the Neighbours houses and the coop (the fences are placed objects, drawn already).
10. The playbook, the QA skill rows, and the spec sync.

---

## 9. Done means

- Every test above passes. Typecheck, the full suite, the build and `build:check` are green.
- The playbook passes at desktop and phone width.
- Parts 1–3 behave unchanged, apart from the town's notice board becoming the parts exchange.

---

## 10. Changes to the farmclaws design

- **§9.1:** the cast stands on fixed spots: shopkeepers by their shops, Sol by the parts exchange, and Cosmo and Barnaby by their fields on the Neighbours map.
- **§9.2:** the parts exchange is a town building where the notice board stood.
- **§11.2:** part 4 is built as 4a (people), 4b (shops and parts) and 4c (jobs). The neighbours' fields are on a new Neighbours map, east of the town.

---

## 11. Plan refinements

Decided by the part 4a implementation plan and its execution. Each one keeps the intent of the rule it refines. Task N is implementation step N of section 8.

- **R1.** The Neighbours houses and coop need structure kinds, so `STRUCTURE_KINDS` also gains `'cosmoHouse'`, `'barnabyHouse'` and `'chickenCoop'`. Structures are map data, not saved, so this needs no migration. (§5.2)
- **R2.** The east gate is built with the Neighbours map (Task 4), not with the parts exchange (Task 3): a warp needs its target map and a reciprocal warp to pass the startup check. (§5.1, §8)
- **R3.** The parts exchange's geometry lands with the structure (Task 3) rather than in the rendering step, so the town never draws a gap where the notice board stood. (§4, §8)
- **R4.** Until Task 4 places Cosmo and Barnaby, the startup check allows an id on at most one map; Task 4 makes it exactly one. (§2.2)
- **R5.** A character's spot is "reachable" when one of its orthogonal neighbours is walkable, isn't another character's spot, and can be reached from one of the map's arrival tiles over walkable tiles that aren't character spots. The check walks the map's world generated with seed 0; a map that lists characters generates the same world for every seed (the town and the Neighbours map do). A door tile is part of its building, so a spot on a door fails as "not walkable"; the door rule catches the tile in front of a door. (§2.2)
- **R6.** The talk panel carries the line picked before the chat is recorded: `UiPanel { kind: 'talk'; npc: NpcId; line: string }`. The chat box only shows it, so the introduction is what the first chat shows, and the line can't change while the box is open. (§3.1, §3.4)
- **R7.** Until Task 7 an open talk panel shows nothing, and E, K, Enter or Escape close it; until Task 8 the characters draw nothing, though their tiles already block; until Task 9 the Neighbours houses and coop draw nothing, though their tiles already block. (§8)
- **R8.** Marigold's **Shop** is one action, `talk/act` (`actions.npcAct(npc, act)`), which checks that the talk panel is open on that character, the game isn't paused and the action is theirs, then swaps the talk panel for the shop in one step. (§3.2)
- **R9.** The neighbours' fences can't be picked up: on the Neighbours map the pickaxe and the axe refuse an object on either field's fence ring with "That belongs to the neighbours."; anything the player puts down elsewhere on the map comes back up as usual. The spec doesn't say, and without it the player could carry Cosmo's fence home. (§5.2) *(Eli to confirm.)*
- **R10.** Config: `PEOPLE.manyRobots` (4), `PEOPLE.copperOreLine` (5) and `PEOPLE.everydayLines` (6) carry the reactive thresholds and the bank size; `NPC_LOOKS` the sway and nameplate numbers; `NEIGHBOUR_ROOFS` the two roof colours; `Salt.MapNeighbours` the map's seed stream. (§2.3, §3.5, §5.2)
- **R11.** The Neighbours map's `name` is "The Neighbours". The game shows map names nowhere yet. (§5) *(Eli to confirm.)*
- **R12.** The Neighbours map uses the farm's scenery style (a wooden fence round the grid, the farm's meadow tones) with its own cosmetic offset. (§5.2)
- **R13.** No appearance palettes existed, so Task 8 adds them (`APPEARANCE_PALETTES`, index 0 the player's current colours) and lets `PlayerModel` take an `Appearance`; the player's own model is built exactly as before. The cast's looks are picked from these palettes. (§2.3)
- **R14.** Hat 0 is the straw hat the farmer has always worn, 1 is no hat, 2 a cap and 3 a knitted hat; hair style 0 is today's short hair, 1 a ponytail and 2 a bob. This replaces the Phase 0 spec's "0 = no hat". Every save already holds 0, so nothing migrates. (§2.3) *(Eli to confirm.)*
- **R15.** Each prop hangs from one bone of the model, so it sways with the body: hats and the pencil on the head; the aprons, the neckerchief and the clipboard on the torso; the seed pouch on the hips. Cosmo's feathered straw hat replaces his own hat. Barnaby holds the clipboard against his chest with his left arm, the only pose a prop changes. (§2.3)
- **R16.** The idle sway leans the upper body side to side, so the feet stay planted. Each character runs its `NPC_IDS` index sevenths of a period ahead, so no two sway in step. (§2.3)
- **R17.** A nameplate is a 256 × 64 canvas: the name on a cream plate with an ink outline, sized to the name. It's drawn when its character is built (the first visit to that character's map) and then kept. `NPC_LOOKS.nameplateHeight` (1.5) and `NPC_LOOKS.nameplateScale` (0.36) place and size it. (§2.3)
- **R18.** The neighbours' houses are the farmhouse with a roof colour (`FarmhouseSpec.roofColor`, from `NEIGHBOUR_ROOFS`: Cosmo sunflower yellow, Barnaby bright blue): the shingle rows and ridge are darker shades of it and the door's awning takes it too; their chimneys don't smoke. No coop builder existed, so the coop is a plain plank shed raised on legs, with a hens' ramp, a nest box and a small window. (§5.2) *(Eli to confirm.)*
- **R19.** The parts exchange is steel-blue with slate trim and a mustard roof, colours no shop uses, and its walls are 4 units tall to the shops' 2.4–2.5, so it reads as two storeys. (§4) *(Eli to confirm.)*
- **R20.** The main chunk's allowance over the part 2 baseline rises from 16 KiB to 26 KiB (`MAIN_GROWTH_MAX_GZIP` in `scripts/bundleRules.mjs`): at the spec commit the main chunk was 282.0 KiB of its 285.1 KiB budget, and part 4a's cast, lines, chat box and character renderer belong in the main chunk. Decided by Eli before the build. (Part 3 spec §10.1)
