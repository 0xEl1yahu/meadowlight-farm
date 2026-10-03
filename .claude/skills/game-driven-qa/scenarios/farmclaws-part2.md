# Farmclaws part 2 — the language playbook

The browser check from the part 2 plan (Task 11 Step 4), as runnable snippets for the part 2
spec §14.3. Last run: 2026-10-03, all six pass (check 4 driven with `__qa.tick` because the pane was hidden). Start each numbered check from `?new` with the probe loaded (see SKILL.md). Each
block is one `javascript_tool` call. Expected results come from the part 2 spec and
`src/config.ts`.

Farm landmarks: spawn (2,5) · clear ground x 1–17, z 9–17 · pond x 34–44, z 27–34.
Mini: 80 tokens, acts every 4 game minutes; a Standard pays twice. Move, turn and refill cost 1,
water 2, harvest 3; dizziness and skipped actions cost nothing. 1 game minute ≈ 0.7 s at 1×.

`setProgram` starts a `morning` stack only up to 6:04, so each setup loads the clock back to
6:00 (minute 360) in the same call, before the program. Programs use the tests' builder:
`const b = __meadowlight.blocks`. Read a robot's interpreter state with `__qa.robot(name)`:
`.exec` (`running`, `frames`, `vars`), `.off` (`'dizzy'` / `'done'` until morning) and `.md`.

## 1. The job 1 spinner waters a 3×3 bed and powers down with tokens left

```js
const F = await __qa.fixtures(); let s = __qa.state();
for (let tx = 6; tx <= 8; tx++) for (let tz = 12; tz <= 14; tz++) s = F.withTile(s, { tx, tz }, F.soilTile(F.T.TileState.Plowed), 'farm');
s = F.withPlayer(s, { tx: 7, tz: 16 }, 0, 'farm');
__qa.load({ ...s, time: { ...s.time, minuteOfDay: 360 } });
const b = __meadowlight.blocks;
[
  __meadowlight.addRobot('spinner', { tx: 6, tz: 12, facing: 1 }),
  __meadowlight.setZone('A', { x0: 6, z0: 12, w: 3, d: 3 }),
  __meadowlight.setProgram('Spinner', b.program({ stacks: [b.when(b.morning(),
    b.forEach('A', b.if(b.soilIsDry(), [b.water()])),
    b.powerDown())] })),
]
```
Expect `["Added Spinner.", "Set Zone A.", "Programmed Spinner."]`. Then:
```js
__qa.tick(100);
const tiles = []; for (let tz = 12; tz <= 14; tz++) for (let tx = 6; tx <= 8; tx++) tiles.push((await __qa.tile(tx, tz, 'farm')).state);
const r = __qa.robot('Spinner'); ({ tiles, power: r.power, tokens: r.tokens, tank: r.tank, at: [r.tx, r.tz] })
```
Expect nine `2`s (watered), `power: 'standby'`, `tokens: 50` (9 waters × 2, 8 moves, 4 turns),
`tank: 11`, `at: [8, 14]`. `await __qa.logText(3, 'Spinner')` ends
"says: Powering down ✓ | happened: Powered down.". Zoom in (`KeyZ` ×3) and screenshot: the bed
is evenly darker than the grass around it.

## 2. Toward the pond, with and without DON'T go into water

The shore and the pond's edge are laid down by hand so the check doesn't depend on the seed's rocks.
```js
const F = await __qa.fixtures(); const W = await __qa.mod('/src/world/tiles.ts'); let s = __qa.state();
for (const tx of [38, 39]) {
  for (let tz = 21; tz <= 26; tz++) s = F.withTile(s, { tx, tz }, W.EMPTY_TILE, 'farm');
  s = F.withTile(s, { tx, tz: 27 }, W.blockedTile(F.T.Blocker.Water), 'farm');
}
s = F.withPlayer(s, { tx: 38, tz: 21 }, 2, 'farm');
__qa.load({ ...s, time: { ...s.time, minuteOfDay: 360 } });
__meadowlight.addScriptedRobot({ name: 'Wader', parts: ['claw'], steps: [{ kind: 'turn', side: 'right' }], place: { tx: 38, tz: 24, facing: 2 } });
__meadowlight.addScriptedRobot({ name: 'Careful', parts: ['claw'], steps: [{ kind: 'turn', side: 'right' }], place: { tx: 39, tz: 24, facing: 2 } });
const b = __meadowlight.blocks, walk = b.program({ stacks: [b.when(b.morning(), b.repeat(4, b.move()))] });
[__meadowlight.setProgram('Wader', walk), __meadowlight.setProgram('Careful', walk), __meadowlight.setMd('Careful', [{ kind: 'dontGoIntoWater' }])]
```
Expect `["Programmed Wader.", "Programmed Careful.", "Set Careful's .MD."]`. Then `__qa.tick(20)`:
- Wader: `power: 'broken'` at (38,27); toast "[warn] Wader drove into the water and shorted out."
- Careful: `standby` at (39,26), `tokens: 78` (two moves); `await __qa.logText(4, 'Careful')`
  shows one "says: Following my rules ✓" entry ×2 whose "happened" text names the card
  ("… my .MD says don't go into water."), then "All done ✓".

Screenshot: Wader sunk and sparking in the water beside Careful on the shore.

## 3. A `Repeat forever` with only free blocks goes dizzy

Zoom in first (`KeyZ` three times), then:
```js
const F = await __qa.fixtures(); const s = __qa.state();
__qa.load({ ...F.withPlayer(s, { tx: 7, tz: 15 }, 0, 'farm'), time: { ...s.time, minuteOfDay: 360 } });
__meadowlight.addScriptedRobot({ name: 'Rest', parts: ['claw'], loop: false, steps: [{ kind: 'powerDown' }], place: { tx: 8, tz: 12, facing: 2 } });
__meadowlight.addScriptedRobot({ name: 'Loopy', parts: ['claw'], steps: [{ kind: 'turn', side: 'right' }], place: { tx: 6, tz: 12, facing: 2 } });
const b = __meadowlight.blocks;
const said = __meadowlight.setProgram('Loopy', b.program({ vars: [b.numVar('n', 0)], stacks: [b.when(b.morning(), b.forever(b.change('n', 1)))] }));
// Hold the clock at 6:00 until the camera is ready (every hook's load unpauses, so pause last).
__meadowlight.store.dispatch(__meadowlight.actions.setPaused(true));
said
```
Expect "Programmed Loopy.", with the clock paused at 6:00. Then, in one `browser_batch` so the
screenshot lands inside the one-second spin: a `javascript_tool` that unpauses and waits for the
moment (about 3 s, at 6:04),
```js
__meadowlight.store.dispatch(__meadowlight.actions.setPaused(false));
await new Promise((done) => { const id = setInterval(() => { if (__qa.robot('Loopy').off === 'dizzy') { clearInterval(id); done(); } }, 10); }); __qa.snap(1)
```
followed by `computer {action: 'screenshot'}`. Expect:
- the screenshot catches Loopy part-way round (not facing south);
- toast "[warn] Loopy got dizzy going round in circles.";
- `__qa.robot('Loopy')`: `off: 'dizzy'`, `power: 'working'` (unchanged), `tokens: 80`, `actionSeq: 0`;
- `await __qa.logText(2, 'Loopy')`: "says: Thinking very hard ✓ | happened: Looped without doing anything, and got dizzy. Off until morning."

Two seconds later, screenshot again: Loopy faces south, its eyes as dim as Rest's (standby), and
neither bobs. `__qa.tick(120)`: Loopy's `actionSeq` is still 0 and `off` still `'dizzy'`.
`__qa.sleep()`: `__qa.robot('Loopy').off` is `null`; about 3 s later (6:04) it gets dizzy again,
with a second toast. Faithful: the program hasn't changed.

## 4. DO return to the nearest generator at 6:00 pm, watched at 16×

```js
const F = await __qa.fixtures(); const W = await __qa.mod('/src/world/tiles.ts'); let s = __qa.state();
for (let tx = 4; tx <= 9; tx++) for (const tz of [15, 16]) s = F.withTile(s, { tx, tz }, F.soilTile(F.T.TileState.Watered, F.matureCrop('parsnip')), 'farm');
s = F.withTile(s, { tx: 13, tz: 10 }, { ...W.EMPTY_TILE, object: { kind: 'woodBurner', fuel: 0 } }, 'farm');
s = F.withPlayer(s, { tx: 9, tz: 13 }, 2, 'farm');
__qa.load({ ...s, time: { ...s.time, minuteOfDay: 360 } });
__meadowlight.addScriptedRobot({ name: 'Reaper', size: 'standard', parts: ['claw', 'basket'], steps: [{ kind: 'turn', side: 'right' }], place: { tx: 4, tz: 15, facing: 1 } });
const b = __meadowlight.blocks;
const out = [
  __meadowlight.setZone('B', { x0: 4, z0: 15, w: 6, d: 2 }),
  __meadowlight.setProgram('Reaper', b.program({ stacks: [b.when(b.morning(), b.forever(b.forEach('B', b.if(b.cropIsReady(), [b.harvest()]))))] })),
  __meadowlight.setMd('Reaper', [{ kind: 'doReturn', to: { kind: 'generator' }, minute: 1080 }]),
];
// Jump to 17:48 with the program still running, so the evening comes quickly.
__qa.patch((st) => { st.time.minuteOfDay = 1068; st.robots.list.find((r) => r.name === 'Reaper').nextActMinute = 1072; });
out
```
Expect `["Set Zone B.", "Programmed Reaper.", "Set Reaper's .MD."]`. Then go to 16× and watch:
```js
for (let i = 0; i < 4; i++) await __qa.key('KeyT', 30);
await new Promise((r) => setTimeout(r, 5000));
__meadowlight.store.dispatch(__meadowlight.actions.setTimeScale(1));
const r = __qa.robot('Reaper'); ({ at: [r.tx, r.tz], power: r.power, off: r.off, log: await __qa.logText(4, 'Reaper') })
```
Expect:
- At 18:00 Reaper stops mid-row and heads for the burner: a log line at 18:00 "says: Heading home ✓ | happened: My .MD says return to the nearest generator at 6:00 pm, so I stopped my program and set off.", then "Home safe ✓ | happened: Got there and powered down for the day."
- It ends within 2 tiles (either way) of the burner at (13,10), `power: 'standby'`, `off: 'done'`.
- Zone B still holds 11 mature parsnips (it harvested only (4,15)). Screenshot: Reaper parked by the burner, the crops behind it.
- `__qa.tick(120)`: it doesn't move again (off until morning).

## 5. Save and reload mid-loop

```js
__qa.patch((st) => { st.time.minuteOfDay = 360; });
__meadowlight.addScriptedRobot({ name: 'Twirl', parts: ['claw'], steps: [{ kind: 'turn', side: 'right' }], place: { tx: 10, tz: 12, facing: 2 } });
const b = __meadowlight.blocks;
__meadowlight.setProgram('Twirl', b.program({ stacks: [b.when(b.morning(), b.repeat(30, b.turn('right')), b.powerDown())] }));
__qa.tick(40);
const r = __qa.robot('Twirl'); ({ seq: r.actionSeq, loop: r.exec.frames.at(-1).loop })
```
Expect `{ seq: 10, loop: { kind: 'times', left: 20 } }`: `left + seq` is 30 between any two turns.
Within a minute, navigate to `http://localhost:5173/` (no `?new`: the page saves as it unloads
and loads that save), load the probe, then:
```js
const r = __qa.robot('Twirl'); ({ seq: r.actionSeq, sum: r.exec.frames.at(-1).loop.left + r.actionSeq, running: r.exec.running })
```
Expect `seq` 10 or a little more (time kept running), `sum: 30`, `running: 0`. Then
`__qa.tick(120)` and `__qa.robot('Twirl')`: `actionSeq: 31` (30 turns and the power-down, none
repeated or lost), `tokens: 50`, `facing: 0` (north), `power: 'standby'`; `await __qa.logText(1, 'Twirl')`
says "Powering down ✓".

## 6. No console errors

`read_console_messages {onlyErrors: true}` → none, across all five checks.
