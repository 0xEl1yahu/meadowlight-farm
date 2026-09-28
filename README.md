# Meadowlight Farm

**Welcome to the farm.** You've inherited a little cottage at the edge of the woods, a watering can, a bag of parsnip seeds and a wide meadow that nobody has tilled in years. The rest is up to you.

### [Play it in your browser →](https://meadowlight-farm-3d.vercel.app)

No download and no account. It runs on any laptop or desktop with a keyboard, and your farm saves itself every morning.

---

## Your first day

1. **Step outside.** You wake up at 6:00 am on the doorstep. The white box on the ground shows the tile you're facing.
2. **Till some soil.** With the hoe selected (slot 1), press **Space** on a patch of grass.
3. **Scatter your seeds.** Pick the parsnip seeds (slot 6) and press **Space**. One handful covers the 3 × 3 patch in front of you and plants every tilled tile it lands on.
4. **Water them.** Grab the watering can (slot 2). Thirsty seedlings show a little blue droplet. When the can runs dry, refill it at the pond.
5. **Go to bed.** Walk up to your front door and press **E**. Watered crops grow a little every night.
6. **Harvest and sell.** Four mornings later your parsnips are ready. Pick them with **E**, drop them in the shipping bin beside the house, and wake up to gold in your pocket.
7. **Grow your farm.** Press **B** for the seed shop and plant something new.

## Treasures in the shade

Keep an eye on the darker grass along the woods and around the cottage. **Mushrooms** and **snozberries** sprout there all by themselves overnight, no tilling or watering needed. They spread to their shaded neighbours once they're fully grown, and fade away when their season ends. Wander over now and then and forage them with **E**.

## What you can grow

| Crop | Seasons | Days to grow | Good to know |
| --- | --- | --- | --- |
| Parsnip | Spring | 4 | Your starter crop |
| Potato | Spring | 6 | Sometimes gives two |
| Carrot | Spring, Fall | 5 | |
| Cauliflower | Spring | 12 | Worth the wait |
| Strawberry | Spring | 8 | Keeps fruiting every 4 days |
| Spectraherb | Spring to Fall | 10 | Slow, rare and very valuable |
| Wheat | Summer, Fall | 4 | Cheap and quick; scatter whole fields of it |
| Blueberry | Summer | 13 | Keeps fruiting every 4 days |
| Blackberry | Summer, Fall | 10 | Keeps fruiting every 3 days |
| Melon | Summer | 12 | |
| Corn | Summer, Fall | 14 | Keeps fruiting every 4 days |
| Pumpkin | Fall | 13 | The prize of autumn |
| Mushroom | Spring to Fall | 2 | Wild, grows in the shade |
| Snozberry | Summer, Fall | 5 | Wild, grows in the shade |

Each season lasts 28 days, and crops wither when their season ends. Rainy days water everything for you. Winter is for resting.

## Controls

| To do this | Press |
| --- | --- |
| Walk | W A S D or the arrow keys (W walks up and to the right) |
| Turn without moving | Shift + a direction |
| Use your tool, or scatter seeds | Space (or left click) |
| Harvest, forage, ship, sleep, refill | E (or right click) |
| Pick a hotbar slot | 1–9, 0, -, =, Tab or the mouse wheel |
| Seed shop | B |
| Zoom in / out | Z / X |
| Speed up time | T |
| Skip to tomorrow | N |
| Pause and see all controls | P or Esc |

**A few tips**

- Every swing of a tool costs a little energy. Sleep to get it all back.
- Stay up past 2:00 am and you'll pass out, waking with only half your energy.
- Rocks need the pickaxe and stumps need the axe. Clearing them gives you stone and wood.
- Tilling is how you choose where seeds go: scattering only plants the tilled tiles in the patch.
- Want a fresh start? Pause and choose **New Farm**.

---

## For builders

Meadowlight Farm is an open-source prototype built with [Three.js](https://threejs.org) (WebGL2) and strict TypeScript. The whole game is a deterministic state machine rendered in flat-shaded, low-poly 3D through an isometric orthographic camera.

```bash
npm install
npm run dev          # http://localhost:5173  (add ?new to start a fresh farm)
npm test             # 534 Vitest tests
npm run build        # typecheck + production bundle in dist/
npm run build:single # the whole game as one self-contained HTML file in dist-single/
```

### How it works

**One deterministic state machine.** All game state lives in one immutable `GameState` (`src/core/types.ts`). It changes only through `gameReducer(state, action)` (`src/state/reducer.ts`), a pure function. The reducer never calls `Math.random` or reads the clock: every random outcome (debris, weather, harvest yield, wild sprouting) is a hash of the world seed and the coordinates of the decision (`src/core/hash.ts`). So replaying an action log reproduces a game exactly. The frame loop only turns real time into `time/tick` actions through a fixed-step clock (`src/core/loop.ts`).

**Grid and chunks.** `src/world/grid.ts` holds the grid math: tile, chunk and world coordinates with half-open bounds, and partial edge chunks (the 48 × 40 farm uses 16-tile chunks, so the last row is 8 tiles deep). It also has an Amanatides–Woo DDA raycast; the tile you're facing is found by casting a ray from the centre of your tile along your facing direction. Tiles are stored per chunk with structural sharing, so editing one tile copies one chunk and leaves every other chunk untouched.

**Planning before acting.** `src/state/intents.ts` works out what the selected tool would do, without changing anything. The reducer carries out that same plan, and the highlight box and hints preview it, so what the game shows and what it does always agree.

**Rendering reacts to diffs.** Each render system implements `sync(state, prev)` and `update(frame)` (`src/render/types.ts`). Unchanged chunks keep their object identity, so a system finds dirty chunks with `!==`, then dirty tiles within them, and only those instances get new matrices or colours. Ground tiles use one `InstancedMesh` per chunk. Crops, grass, rocks, stumps, trees, particles and weather all use instanced meshes too, kept packed by `InstanceSlotMap`.

**Shade and wild crops.** `src/world/shade.ts` defines the shaded tiles as a pure function of the farm layout. `src/farming/wild.ts` sprouts and spreads wild crops overnight inside the same deterministic pipeline as everything else.

**Time, light and weather.** `LightingManager` blends keyframes from dawn through noon and dusk to night for the sun (or moon), the ambient light, the sky and the fog. Rain and storms dim and grey the scene, and storms add lightning.

### Project map

```
src/
  config.ts   tuning: world size, layout, shade, time, energy, tools
  core/       types, store, deterministic hash, fixed-step clock
  world/      grid math + raycast, chunked tiles, shade map, world generation
  time/       calendar & clock, weather rolls
  farming/    crop registry, overnight growth, wild shade crops
  items/      item registry (tools, seeds, produce, materials)
  state/      actions, intents (planning), reducer, selectors, inventory, save/load
  render/     camera, lighting, weather, terrain, structures, crops, player,
              tile highlighter, effects, instancing helpers, materials
  input/      keyboard & mouse → actions
  ui/         HUD: clock, hotbar, energy, messages, shop, pause menu
tests/        Vitest suites: grid math, reducer, growth, wild crops, saves, determinism…
```

### Adding a crop

1. Add its id to `CROP_IDS` in `src/core/types.ts`.
2. Add a `CropDefinition` to `CROPS` in `src/farming/crops.ts`: its seasons, days per stage, regrowth, prices and look (colours, foliage shape, produce shape, height).

The seeds, produce, shop listing, growth-stage models and HUD icons all come from that one entry. Set `habitat: 'shade'` to make a crop grow wild in the shade instead of being sold.
