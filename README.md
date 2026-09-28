# Meadowlight Farm 3D

A playable 3D farming-sim core loop in the spirit of Stardew Valley: till soil, plant seeds, water them, sleep, harvest, ship, and buy more seeds. It is built with Three.js (WebGL2) and strict TypeScript, rendered through an orthographic isometric camera in a flat-shaded, low-poly pastel style.

```bash
npm install
npm run dev          # http://localhost:5173  (append ?new to start a fresh farm)
npm test             # 508 Vitest tests
npm run build        # typecheck + production bundle in dist/
npm run build:single # one self-contained HTML file in dist-single/
```

## Controls

| Action | Keys |
| --- | --- |
| Walk (grid steps) | W A S D or arrow keys. North (W) points up-right on screen. |
| Turn in place | Shift + direction |
| Use selected tool or seeds | Space, J, or left click |
| Interact (harvest, ship at the bin, sleep at the door, refill at the pond) | E, K, Enter, or right click |
| Select hotbar slot | 1–9, 0, -, =, Tab, or mouse wheel |
| Seed shop | B |
| Zoom | Z / X, or Ctrl + wheel |
| Time speed | T (1×, 2×, 4×, 8×, 16×) |
| Sleep now | N |
| Pause | P or Esc |

A day runs from 6:00 am to 2:00 am (about 14 real minutes at 1×). Staying up past 2:00 am makes you pass out and wake with half energy. The game saves every morning and when the tab closes.

## How it works

**One deterministic state machine.** All game state lives in one immutable `GameState` (`src/core/types.ts`). It changes only through `gameReducer(state, action)` (`src/state/reducer.ts`), a pure function. The reducer never calls `Math.random` or reads the clock. Every random outcome (debris, weather, harvest yield, soil drying out) is a hash of the world seed and the coordinates of the decision (`src/core/hash.ts`), so replaying an action log reproduces the game exactly. The frame loop only turns real time into `time/tick` actions through a fixed-step clock (`src/core/loop.ts`).

**Grid and chunks.** `src/world/grid.ts` holds the grid math: tile, chunk and world coordinates with half-open bounds, partial edge chunks (the 48 × 40 farm uses 16-tile chunks, so the last row of chunks is 8 tiles deep), and an Amanatides–Woo DDA raycast. The player's active tile is the result of casting a ray from the centre of their tile along their facing vector. Tiles are stored per chunk with structural sharing, so editing one tile copies one chunk and leaves every other chunk untouched.

**Planning before acting.** `src/state/intents.ts` works out what the selected tool would do on the active tile, without changing anything. The reducer carries out that same plan, and the highlight box and HUD hints preview it, so what the game shows and what it does always agree.

**Rendering reacts to diffs.** Each render system implements `sync(state, prev)` and `update(frame)` (`src/render/types.ts`). An unchanged chunk keeps its object identity, so a system finds dirty chunks with `!==` and then dirty tiles within them. Only those instances get new matrices or colours. Ground tiles use one `InstancedMesh` per chunk. Soil furrows, grass, rocks, stumps, crops (one mesh per growth-stage model), thirst droplets, trees, fence, particles and weather all use instanced meshes, and `InstanceSlotMap` keeps the live instances packed. Every lit material is flat-shaded.

**Time, light and weather.** `LightingManager` blends keyframes (dawn, sunrise, morning, noon, golden hour, dusk, twilight, night) for the sun or moon directional light, the hemisphere ambient light, the sky and the fog. The sun arcs from east to west. Rain and storms dim and grey the scene, storms add lightning, and each night's weather roll decides whether the rain waters your crops for you.

## Project map

```
src/
  config.ts              tuning: world size, layout, time, energy, tools
  core/                  types, store, deterministic hash, fixed-step clock
  world/                 grid math + raycast, chunked tiles, world generation
  time/                  calendar & clock formatting, weather rolls
  farming/               crop registry, overnight growth pipeline
  items/                 item registry (tools, seeds, produce, materials)
  state/                 actions, intents (planning), reducer, selectors, inventory, save/load
  render/                scene & camera, lighting, weather, terrain, structures, crops,
                         player, tile highlighter, effects, instancing helpers, materials
  input/                 keyboard & mouse → actions
  ui/                    HUD (clock, hotbar, energy, toasts, shop, pause)
tests/                   Vitest suites for grid math, reducers, growth, save validation, determinism…
```

## Adding a crop

1. Add its id to `CROP_IDS` in `src/core/types.ts`.
2. Add a `CropDefinition` to `CROPS` in `src/farming/crops.ts`, covering its seasons, days per stage, regrowth, prices and visual (colours, foliage form, produce shape, height).

The seed item, produce item, shop listing, stage models and HUD icons all come from that entry.
