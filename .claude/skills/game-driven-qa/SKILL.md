---
name: game-driven-qa
description: Use when verifying Meadowlight Farm gameplay in a real browser — play-testing a feature, checking that robots, crops, tools or the HUD behave on screen, reproducing a bug by playing, or doing a plan's "browser check" step. Dev server on localhost:5173.
---

# Game-driven QA

## Overview

Drive the real game in the browser pane and judge it by its **state**, confirmed by **screenshots** for anything visual. Setup may take shortcuts; the behaviour under test goes through the real path: real key events for input features, real or ticked time for the simulation.

`probe.js` (next to this file) installs `window.__qa`, a small toolkit over the dev handle `window.__meadowlight`. `scenarios/` holds ready-made playbooks.

## Start every run like this

1. `preview_list`; if `meadowlight-dev` isn't running, `preview_start {name: "meadowlight-dev"}` (from `.claude/launch.json`).
2. Navigate to `http://localhost:5173/?new` — a **fresh farm**. Never QA on whatever save is loaded: old robots, the 12-robot cap, a leftover 4× speed or a late clock will mislead you. (Reload *without* `?new` loads the last save: use that to test persistence.)
3. Load the probe (again after every navigation or reload):
   ```js
   await import('/.claude/skills/game-driven-qa/probe.js?t=' + Date.now()); __qa.snap()
   ```

## Quick reference

| Need | Call |
| --- | --- |
| Picture of the game (clock, player, robots, pool, last toasts) | `__qa.snap(nToasts)` |
| Real key press (as InputController hears it) | `await __qa.key('KeyE')` — `KeyW/A/S/D` walk (120 ms tap = 1 tile), `Space` tool, `KeyE` interact, `KeyN` sleep, `KeyT` speed, `KeyI` backpack, `Escape`, `Digit1`–`Digit9` hotbar, `KeyZ/X` zoom |
| Walk / turn in place | `await __qa.walkTo(tx, tz)`, `await __qa.turn(dir)` (0 N, 1 E, 2 S, 3 W) |
| What's ahead / any tile | `await __qa.ahead()`, `await __qa.tile(tx, tz, 'farm')` |
| Advance time deterministically | `__qa.tick(minutes)`, `__qa.sleep()` |
| Farm log as readable lines | `await __qa.logText(12, 'Tweedle')` |
| Find a robot | `__qa.robot('Drizzle')` |
| Build a scenario | `const F = await __qa.fixtures()` → `F.withTile`, `F.soilTile(F.T.TileState.Plowed, F.matureCrop('parsnip'))`, `F.withPlayer`, `F.stack`; then `__qa.load(state)` |
| Add robots | `__meadowlight.addRobot(preset, {tx, tz, facing})` (spinner, waterer, harvester, swimmer, pair); `__meadowlight.addScriptedRobot({ steps, parts, name?, size?, loop?, place? })` for any script — `loop` defaults to **true**, so pass `loop: false` for a one-shot |
| Program a robot with blocks (part 2) | `const b = __meadowlight.blocks; __meadowlight.setProgram('Drizzle', b.program({ stacks: [b.when(b.morning(), b.forEach('A', b.if(b.soilIsDry(), [b.water()])))] }))` → "Programmed Drizzle." or the checker's sentence. A `morning` stack starts only up to 6:04 (6:03 with a quick core); later the robot idles until a trigger fires |
| A robot's .MD | `__meadowlight.setMd('Drizzle', [{ kind: 'dontLeave', zone: 'A' }, { kind: 'doReturn', to: { kind: 'generator' }, minute: 1080 }])` → "Set Drizzle's .MD." |
| Zones A–H | `__meadowlight.setZone('A', { x0: 6, z0: 12, w: 3, d: 3 })` → "Set Zone A."; `setZone('A', null)` clears it |
| Block builder | `__meadowlight.blocks` is the tests' `b`: `b.repeat(3, b.move())`, `b.goTo(b.tileAt(5, 10))`, `b.set('n', b.add(b.v('n'), b.n(1)))`. Playbook: `scenarios/farmclaws-part2.md` |
| What a block robot is doing | `__qa.robot(name).exec` (`running` stack, `frames`, `vars`), `.off` (`'dizzy'` or `'done'` until morning), `.md` |
| Put a robot on the bench (part 3) | Carry it (E), stand on (6,5) facing north (the workbench is (6,4)), E: "Put {name} on the bench". Setup shortcut: `__qa.bench('Atlas')`, then `await __qa.key('KeyE')` ("Work on Atlas") |
| The robot screen | `__qa.state().ui.panel` → `{ kind: 'robot', robotId, mode: 'bench' }` or `'peek'`. While it's open the game is frozen and the screen owns the keyboard: drive it with `find` + `computer` clicks, drags and keys, not `__qa.key`. Blockly: click a toolbox category, then `left_click_drag` from the flyout. Playbook: `scenarios/farmclaws-part3.md` |
| Peek at a robot | Face a standing robot, `await __qa.shift('KeyE')` ("Look at {name}" while Shift is held): Stats and Log only, read-only, free |
| Go to town or the Neighbours (setup) | `const F = await __qa.fixtures(); __qa.load(F.withPlayer(__qa.state(), { tx: 7, tz: 8 }, 0, 'town'))`; maps are `'farm'`, `'forest'`, `'town'`, `'neighbours'`. The town's east gate (39,16) leads to the Neighbours map (1,14). Playbook: `scenarios/farmclaws-part4a.md` |
| Talk to a character (part 4a) | Face them, `await __qa.key('KeyE')` ("Talk to {name}"): `__qa.state().ui.panel` → `{ kind: 'talk', npc, line }`, the box is `.chat-box`. E, K, Enter or Escape close it. Spots: Marigold (7,7), Berlioz (16,7), Sol (21,7), Juniper (24,7), Tallulah (35,7) in town; Cosmo (7,13), Barnaby (25,15) on the Neighbours map |
| Which line a character will say | `(await __qa.mod('/src/people/lines.ts')).lineFor(__qa.state(), 'sol')`; the banks are `LINE_BANKS`. The first chat (`npcs[id].talks` 0) is always the introduction |
| Zone marker | Its slot: `__qa.state().inventory.slots.findIndex((s) => s?.itemId === 'zoneMarker')` (6 on a fresh farm, `Digit7`). `Space` marks a corner on the tile ahead, the second press paints `ui.zoneLetter`'s zone; `await __qa.shift('Space')` cycles A → H; `await __qa.shift('KeyE')` clears the letter's zone; Escape drops a draft (`ui.zoneDraft`) |
| Unlock everything | `__meadowlight.unlockAll()` → "Unlocked every block, card and tab." New farms have job 1's set, without the Stats tab, `If`, `For each tile` or variables |
| Compare programs | `__qa.same(a, b)`: deep equality ignoring key order, e.g. `__qa.same(__qa.robot('Atlas').program, program)` |
| The single-file build | `npm run build:single`, then `preview_start {name: "meadowlight-single"}` → `http://localhost:4174/`. It has no dev hooks; check 12 of `scenarios/farmclaws-part3.md` brings a robot in through the save |
| Enum values (tile state, blocker, direction) | `(await __qa.fixtures()).T` → `TileState` {Unplowed 0, Plowed 1, Watered 2, Blocked 3}, `Blocker` {Water 3, ShippingBin 5, …}, `Direction` {North 0 … West 3} |
| Teleport / give items (setup only) | `__qa.patch(s => { s.player.tx = 5; })` |
| Any game module | `await __qa.mod('/src/robots/logText.ts')` — Vite serves source in dev |
| Frame rate | `await __qa.fps(2000)` |
| Console errors | `read_console_messages {onlyErrors: true}` |

## Evidence

- **State first.** Every PASS cites values from `snap`, `tile`, `logText` or HUD text (`document.querySelector('.hud-tokens').textContent`).
- **Screenshot for anything a player sees** — models, badges, poses, layout. The camera follows the player, so stand the player 2–3 tiles from the subject first (`__qa.patch` or `walkTo`). Press `KeyZ` 3–4 times to zoom in; the pane can't crop a region. Put the changed thing next to an unchanged control in the same shot (watered soil is only slightly darker than plowed). Check phone width with `resize_window {preset: "mobile"}` and reset to `desktop` after.
- **Hints and toasts are part of the feature**: read the on-screen prompt (e.g. "Fish out Splash") before pressing the key.
- Before calling something a bug: reproduce it with `__qa.tick`, and check the spec and `src/config.ts` (`ROBOTS`, costs, periods). Most "wrong numbers" are a misread config.

## Gotchas

| Symptom | Cause / fix |
| --- | --- |
| Player actions do nothing | Game is paused (`P` or `setPaused(true)`) — unpause; use `__qa.tick` to hold time still instead |
| Page suddenly back at 06:00 day 1 | You edited a file the page imported (probe or `src/`): Vite reloaded, and `?new` restarted the farm. Finish edits first; redo setup |
| `robotLog()` output reads `{0: Object…}` | console.table doesn't survive console tools — use `__qa.logText()` |
| HUD number looks wrong in a screenshot | It counts up over ~1 s; read state or wait |
| Robot "harvested nothing" in front of a crop | Robots act on **their own tile**, not the one ahead |
| Pick-up / interaction misses a robot | It moved (every period). Wait for `actionSeq` to change, then approach at once — see `scenarios/farmclaws-part1.md` |
| Day jumped between calls | Time kept running at 16× while you worked — `__meadowlight.store.dispatch(__meadowlight.actions.setTimeScale(1))` |
| "The farm already has 12 robots." | Start from `?new` |
| `setProgram` worked but the robot never starts | It was after 6:04, so the `morning` stack waits for tomorrow. Load the clock to 6:00 in the same call first (`const s = __qa.state(); __qa.load({ ...s, time: { ...s.time, minuteOfDay: 360 } })`), or give the program an `every` / `atTime` trigger |
| Keys do nothing while a robot screen is open | By design: the screen owns the keyboard and the game is frozen. `__qa.key` events go to `window` and never reach Blockly's fields; use `computer` keys. `computer key "Escape"` closes a dropdown or flyout first, then the screen (with the discard prompt if there are unsaved edits) |
| `walkTo` stops short in town | The cast blocks like a wall. Walk to the tile in front of a character, not onto them; sidestep round them |
| A saved `When morning comes` program sits idle | The save happened after 6:04. Load the clock to 6:00 just before opening the bench (the open screen holds the clock), or `__qa.sleep()` and watch from 6:04 |
| Clock frozen in real time (`T` speed does nothing) | The browser pane is hidden (`document.hidden` is true), so animation frames stop and the game clock with them. Drive time with `__qa.tick(n)`; screenshots still render on demand |
| Navigation fails / blank tab | Server stopped — `preview_list`, `preview_start` |

## Report

One line per check: **PASS / FAIL — evidence**. Keep bugs (spec says X, game does Y, with repro) separate from visual notes and suggestions. Finish by resetting the viewport to desktop.
