# Meadowlight Farm

**A cosy farming game with robots you teach yourself.** You've inherited a little cottage at the edge of the woods, a watering can, a bag of parsnip seeds and a wide meadow nobody has tilled in years. Down the road is a small town, two neighbouring farmers, and Sol, a seeder who now builds farm robots called farmclaws.

You program the farmclaws with snap-together blocks and give each one standing rules. They do exactly what you tell them, which is the good news and the bad news. Along the way the game shows how automation really behaves: loops, conditions, cost, limits, and why a robot that says ✓ might still have done the wrong thing.

### [Play it in your browser →](https://meadowlight-farm-3d.vercel.app)

No download and no account. It runs on a laptop or desktop with a keyboard, and your farm saves itself every morning and whenever you close the tab.

---

## How to play

### The farm

1. **Step outside.** You wake at 6:00 am on the doorstep. The white box on the ground shows the tile you're facing.
2. **Till some soil.** With the hoe selected (slot 1), press **Space** on a patch of grass.
3. **Scatter your seeds.** Pick the parsnip seeds and press **Space**. One handful covers the 3 × 3 patch in front of you and plants every tilled tile in it.
4. **Water them.** Grab the watering can (slot 2). Thirsty seedlings show a blue droplet. Refill the can at the pond.
5. **Go to bed.** Press **E** at your front door, or **N** anywhere. Watered crops grow a little every night.
6. **Harvest and sell.** Parsnips are ready after four nights. Pick them with **E**, drop them in the shipping bin beside the house, and wake up to gold.

Every tool swing costs a little energy, and sleep gives it all back. Stay up past 2:00 am and you pass out, waking with half your energy. Rocks need the pickaxe and stumps the axe, which gives you stone and wood. Press **I** for your backpack and its Crafting tab: chests, fences, paths, sprinklers, fertiliser and more. Mushrooms and snozberries grow wild in the shade along the woods; forage them with **E**.

Each season lasts 28 days, crops wither when their season ends, and rain waters everything for you.

| Crop | Seasons | Days to grow | Good to know |
| --- | --- | --- | --- |
| Parsnip | Spring | 4 | Your starter crop |
| Potato | Spring | 6 | Sometimes gives two |
| Carrot | Spring, Fall | 5 | |
| Cauliflower | Spring | 12 | Worth the wait |
| Strawberry | Spring | 8 | Keeps fruiting every 4 days |
| Spectraherb | Spring to Fall | 10 | Slow, rare and very valuable |
| Wheat | Summer, Fall | 4 | Cheap and quick |
| Blueberry | Summer | 13 | Keeps fruiting every 4 days |
| Blackberry | Summer, Fall | 10 | Keeps fruiting every 3 days |
| Melon | Summer | 12 | |
| Corn | Summer, Fall | 14 | Keeps fruiting every 4 days |
| Pumpkin | Fall | 13 | The prize of autumn |

### The town and its hours

Walk off the farm's south-east corner to reach the town, and through the town's east gate to the Neighbours, where Cosmo and Barnaby farm. The forest lies off the farm's west edge.

Everyone keeps a daily routine. The shopkeepers are at their shops from 8:30 am, eat lunch together in the square at noon on a dry day, and head home in the evening; Cosmo and Barnaby walk into town for that lunch. **Shops open 9:00 am to 12:00 pm and 1:00 pm to 5:00 pm.** Outside those hours the door says when it opens again. SLOPMART 24/7, a booth in town run by a robot called DEALZ, never closes. It sells mystery boxes, 3 a day: mostly slop, now and then a gem.

### The people

Walk up to anyone and press **E** to chat. What they say changes with the day and with what's happening on your farm.

| Who | Where | What they do |
| --- | --- | --- |
| Marigold | General store | Seeds, and the backpack upgrade: 36 slots for 2000g. **B** opens her shop from anywhere during shop hours. |
| Sol | Parts exchange | Gives job 1. Sells robot parts and buys them back at half price, once job 2 is done. |
| Juniper | Carpenter | Builds robots once job 1 is done: Minis first, Standard and Big robots after job 3. |
| Cosmo | The Neighbours | Gives job 2. His Big robot says hello to the chickens. |
| Barnaby | The Neighbours | Gives job 3. Four robots, one field, never finished. |
| Berlioz | Blacksmith | Chats. |
| Tallulah | Ranch | Chats. |

Six townsfolk walk their own short loops around town and have a line each day.

### The jobs

Talk to a job's giver, press **Job**, then **Take the job**. The jobs come in order, and each one opens more of the game.

| Job | Giver | The goal | When it's done |
| --- | --- | --- | --- |
| 1. The spinning robot | Sol | Rewrite Sprinkle's spinning program to water the bed by your workbench, then power down with tokens left. Taking it teaches the Wood Burner recipe. | 500g, and Juniper's workshop opens |
| 2. Show him what it can do | Cosmo | Harvest every ripe crop in Cosmo's field, with a program that uses a sensor and an If. | 1000g, Sol's parts shop opens, and Cosmo teaches the Quality Fertiliser and Speed-Gro recipes |
| 3. Know the limits | Barnaby | Harvest Barnaby's whole field by 6:00 pm in one day, at 6 tokens a crop or less. | 2000g, Juniper builds Standard and Big robots, and Barnaby teaches the Quality Sprinkler recipe |

Each job also unlocks the blocks and cards it needs when you take it. For jobs 2 and 3 you work on the neighbour's own robots: face one and press **E** to open its screen where it stands.

### Robots and their programs

- **The workbench** stands by the farmhouse. Pick a robot up with **E** (it costs energy), then press **E** at the bench to set it there and open its screen. **Shift + E** peeks at any robot's Stats and Log.
- **Program:** snap blocks together under a trigger such as "When morning comes". The toolbox shows only the blocks you've unlocked, and each robot size holds a limited number of blocks.
- **.MD:** the robot's standing rules, DO and DON'T cards such as "DON'T go into water" or "DO return to the nearest generator at 6:00 pm". DON'T beats DO, and DO beats the program.
- **Looks:** paint, and the parts it has fitted. Parts give a robot its actions: a claw harvests, a watering head waters, a sensor eye adds sensors.
- **Stats and Log:** what it spent, and what it did. The "Robot says" column is always cheerful and always ✓; the "What happened" column tells the truth.
- **Zones:** the zone marker in your backpack paints zones A to H for "For each tile" and the .MD's zone cards. **Space** marks two corners, **Shift + Space** picks the next letter, and **Shift + E** clears it.
- **Tokens:** every action costs tokens. Craft a wood burner and load it with wood: overnight it fills the farm's token pool, and robots within 2 tiles of it recharge.
- **Mistakes are yours to fix.** Robots stay where they finish and start again from there each morning. A robot that walks into water shorts out: fish it out and carry it to the shipping bin for a new core. Left in the water overnight, it's ruined and can only be scrapped at the bench.

## Controls

| To do this | Press |
| --- | --- |
| Walk | W A S D or the arrow keys (W walks up and to the right) |
| Turn without moving | Shift + a direction |
| Use your tool, scatter seeds, mark a zone corner | Space, J or left click |
| Harvest, talk, ship, pick up or put down a robot, sleep at your door | E, K, Enter or right click (Ctrl + click on a Mac) |
| Peek at a robot | Shift + E |
| Pick a hotbar slot | 1–9, 0, -, =, Tab or the mouse wheel |
| Backpack and crafting | I |
| Marigold's seed shop | B |
| Zoom in / out | Z / X, or Ctrl + mouse wheel |
| Speed up time | T |
| Skip to tomorrow | N |
| Pause | P or Esc (Esc closes an open panel first) |

Want a fresh start? Pause and choose **New Farm**.

---

## Run it yourself

Meadowlight Farm is built with [Three.js](https://threejs.org), strict TypeScript, Vite and Vitest. It needs Node 22 or newer.

```bash
npm install
npm run dev          # http://localhost:5173 (add ?new to start a fresh farm)
npm test             # the Vitest suite
npm run typecheck    # TypeScript only
npm run build        # typecheck and the production bundle in dist/
npm run build:check  # the build, then its size budgets and the dev-hook check
npm run build:single # the whole game as one HTML page in dist-single/
```

The game is one deterministic state machine. All state lives in one immutable `GameState`, and it changes only through a pure reducer. Randomness comes from a hash of the world seed, never `Math.random`, so the same farm and the same programs always give the same result. The robot screen and its Blockly editor load lazily, the first time you open them.

### Project map

```
src/
  config.ts   every tuning number: world, time, tools, robots, jobs, shops
  core/       types, store, deterministic hash, fixed-step clock
  world/      grid math, chunked tiles, the farm, town, forest and Neighbours maps
  time/       calendar, clock and weather
  farming/    crops, overnight growth, wild shade crops
  items/      the item registry
  crafting/   recipes, and the one way to teach them
  state/      actions, intents, the reducer, selectors, inventory, save migration and validation
  robots/     robot state, the block language and its interpreter, the .MD, tokens, the workshop
  jobs/       jobs 1 to 3: set-ups, success checks and progress lines
  people/     the cast, their lines, timetables and walking
  io/         save storage in the browser
  render/     camera, lighting, terrain, structures, crops, robots, people, effects
  audio/      generated music and sound
  input/      keyboard and mouse to actions
  ui/         the HUD, chat box, backpack, shops and robot screen
  dev/        development hooks (never in the production build)
tests/        the Vitest suites
docs/         the design, and a spec and plan for each build part
```
