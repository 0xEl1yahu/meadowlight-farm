# Farmclaws part 3 — the robot screen playbook

The browser check from the part 3 plan (Task 15 Step 6), as runnable snippets for the part 3
spec §11. Start each numbered check from `?new` with the probe loaded (see SKILL.md), with the
browser pane **shown**: the robot screen and Blockly's drags need real frames. (With the pane
hidden the checks still run, since time moves only through `__qa.tick`, but a screenshot can show
an earlier frame: confirm with `find` or `get_page_text`, or take it again.) Each fenced `js`
block is one `javascript_tool` call; lines naming `find`, `computer`, `get_page_text` or
`resize_window` are browser-pane tool calls. Expected results come from the part 3 spec and
`src/config.ts`.

Last run: 2026-10-05 — all twelve checks PASS.

Farm landmarks: spawn (2,5) · the workbench (6,4), worked from (6,5) facing north · shipping bin
(9–10,5) and the new-core drop-off (9,6) · clear ground x 1–17, z 9–17 · pond x 34–44, z 27–34.
A Mini has 80 tokens, 12 blocks and 3 .MD cards and acts every 4 game minutes; a Big has 80
blocks. Move, turn and refill cost 1, water 2. Carrying a Mini costs 4 energy, a new core 300g,
a coat of paint 50g; scrapping a Mini pays 375g. Starting gold is 500.

**The robot screen owns the keyboard.** While `__qa.state().ui.panel.kind` is `'robot'` the game
is frozen and ignores every key. Drive the screen with `find` (by visible text) and `computer`
clicks, drags and keys: `__qa.key` dispatches on `window`, which never reaches Blockly's fields.
`computer {action: 'key', text: 'Escape'}` closes the screen (after closing an open dropdown,
widget or flyout first).

**Morning stacks.** Save (`programRobot`) and `setProgram` start a `When morning comes` stack only up
to 6:04. Each setup that saves a morning program loads the clock to 6:00 (minute 360) just
before it opens the bench, and the frozen screen holds the clock while you edit. If a save
still lands after 6:04 (`exec.running` is null after Save), finish the check's steps, then
`__qa.sleep()` and read the results from 6:04 the next day: the numbers are the same.

**Dragging blocks.** Click a toolbox category (Triggers, Control, Actions, Sensors, Values) to
open its flyout, screenshot, then `computer {action: 'left_click_drag'}` from the block's left
edge to the target: an empty part of the workspace for a top-level block, or so the dragged
block's top-left corner sits just inside the slot it belongs in. Blockly snaps within about
25 px. Screenshot after every drop.

## 1. Carry a robot to the bench; the screen opens

```js
const F = await __qa.fixtures(); let s = __qa.state();
for (let tz = 8; tz <= 12; tz++) s = F.withTile(s, { tx: 6, tz }, F.soilTile(F.T.TileState.Plowed), 'farm');   // check 3's bed
s = F.withPlayer(s, { tx: 6, tz: 5 }, 0, 'farm');
__qa.load({ ...s, time: { ...s.time, minuteOfDay: 360 } });
await new Promise((r) => setTimeout(r, 100));
const emptyHint = document.body.innerText.includes('Bring a robot here to work on it');
await __qa.key('KeyE');
({ emptyHint, toast: __qa.snap(1).toasts, panel: __qa.state().ui.panel.kind })
```
Expect `emptyHint: true`, one toast ending "Bring a robot here to work on it", `panel: 'none'`.
```js
const s = __qa.state(); __qa.load({ ...s, time: { ...s.time, minuteOfDay: 360 } });
const added = __meadowlight.addRobot('spinner', { tx: 6, tz: 6, facing: 0 });
await __qa.turn(2);
const pickHint = document.body.innerText.includes('Pick up Spinner');
await __qa.key('KeyE');
await __qa.turn(0);
const benchHint = document.body.innerText.includes('Put Spinner on the bench');
await __qa.key('KeyE');
const r = __qa.robot('Spinner'), st = __qa.state();
({ added, pickHint, benchHint, panel: st.ui.panel, robot: { at: [r.tx, r.tz], onBench: r.onBench, carried: r.carried }, carrying: st.player.carrying, energy: st.player.energy, minute: st.time.minuteOfDay })
```
Expect `added: "Added Spinner."`, both hints `true`, `panel: { kind: 'robot', robotId: 1, mode: 'bench' }`,
the robot at `[6, 4]` with `onBench: true` and `carried: false`, `carrying: null`, `energy: 96`,
`minute` at most 362. Screenshot: "Opening…" gives way to the screen; the header shows Spinner,
Mini, the watering-head icon, its tokens, the On/Off switch, **Lift off** and **Scrap**.
`get_page_text`: tabs Program, .MD, Looks and Log, and no Stats (job 1's set doesn't unlock it).

## 2. Build job 1's program by dragging blocks

`find "Program"` → click. "Opening the editor…" shows, then the note "Spinner runs a fixed
script. Saving here replaces it with a block program.", an empty workspace and "0 / 12 blocks".
Build, by dragging:
```
When morning comes
  Repeat until  (tokens left) < (10)
    Water
    Move forward
```
"When morning comes" is under Triggers; "Repeat until" under Control; the comparison, "tokens left"
and the number block under Values; "Water" and "Move forward" under Actions. Along the way:

a. **Keys stay in the editor.** Click the number block's field, then `computer type "wasd e"`,
   `computer key "Backspace"` until the field is empty, `computer type "10"`, `computer key "Enter"`.
   ```js
   const st = __qa.state(); ({ at: [st.player.tx, st.player.tz], facing: st.player.facing, energy: st.player.energy, panel: st.ui.panel.kind, slot: st.inventory.selected })
   ```
   Expect `at: [6, 5]`, `facing: 0`, `energy: 96`, `panel: 'robot'`, `slot: 0`: none of those
   keys reached the game. The number block reads 10.
b. **Escape in a dropdown.** Click the comparison's operator dropdown; with its menu open,
   `computer key "Escape"`: only the menu closes, and `__qa.state().ui.panel.kind` is still
   `'robot'`. Open it again and pick `<`.
c. **The counter.** `get_page_text` shows "6 / 12 blocks".
d. **A loose block.** Drag one more "Move forward" onto an empty part of the workspace (the
   counter reads "7 / 12 blocks") and click **Save**. Under the toolbar: "Every block must be
   inside a When … stack or a helper.", with that block highlighted.
   `__qa.robot('Spinner').program.kind` is still `'script'` and no "Programmed" toast appeared.
   Click the loose block and `computer key "Delete"`: it's gone, "6 / 12 blocks".
e. **Unsaved edits.** `computer key "Escape"` with no menu open: the prompt "Discard your
   changes to Spinner's program?" offers **Discard** and **Keep editing**. Click
   **Keep editing**: the screen stays with the workspace as it was.

## 3. Save, lift off, and watch it run

Click **Save**, then:
```js
const b = __meadowlight.blocks; const r = __qa.robot('Spinner');
({ same: __qa.same(r.program, b.program({ stacks: [b.when(b.morning(), b.repeatUntil(b.lt(b.tokensLeft(), 10), b.water(), b.move()))] })), running: r.exec.running, toast: __qa.snap(1).toasts, minute: __qa.state().time.minuteOfDay })
```
Expect `same: true`, `running: 0`, `toast: ["[success] Programmed Spinner."]`, `minute` at most 364.
Click **Lift off**:
```js
const st = __qa.state(), r = __qa.robot('Spinner'); ({ panel: st.ui.panel.kind, carrying: st.player.carrying === r.id, onBench: r.onBench, energy: st.player.energy })
```
Expect `panel: 'none'`, `carrying: true`, `onBench: false`, `energy: 92`. Then put it down at
the top of the bed and give it 40 minutes (ten acts):
```js
await __qa.walkTo(6, 7);   // ends facing south, with (6,8) ahead
const putHint = document.body.innerText.includes('Put down Spinner');
await __qa.key('KeyE');
__qa.tick(40);
const tiles = []; for (let tz = 8; tz <= 12; tz++) tiles.push((await __qa.tile(6, tz, 'farm')).state);
const r = __qa.robot('Spinner'); ({ putHint, tiles, at: [r.tx, r.tz], tokens: r.tokens, tank: r.tank, running: r.exec.running, log: await __qa.logText(2, 'Spinner') })
```
Expect `putHint: true`, `tiles: [2, 2, 2, 2, 2]`, `at: [6, 13]`, `tokens: 65` (5 waters, 5 moves),
`tank: 15`, `running: 0`, and the log ending "says: Watered ✓ | happened: Watered the soil." then
"says: Moved forward ✓ | happened: Moved one tile.". It keeps going until tokens left < 10.

## 4. Every fixture survives the editor unchanged

The five programs cover every block of design §5.2 that the language has, including values
outside the editor's usual options (`atTime` 583, i.e. 9:43 am; a `potato` item; a `cauliflower`
crop; a 16-character variable name, `ROBOTS.maxIdentifierLength`) and locked kinds, which show
normally. They run on a Big robot with a sensor eye.
```js
const s = __qa.state(); __qa.load({ ...s, time: { ...s.time, minuteOfDay: 360 } });
const added = __meadowlight.addScriptedRobot({ name: 'Atlas', size: 'big', parts: ['claw', 'wateringHead', 'sensorEye'], steps: [{ kind: 'turn', side: 'right' }], place: { tx: 6, tz: 6, facing: 0 } });
__qa.bench('Atlas');
const b = __meadowlight.blocks;
window.FIX = {
  job1: b.program({ stacks: [b.when(b.morning(), b.repeatUntil(b.lt(b.tokensLeft(), 10), b.water(), b.move()))] }),
  harvest: b.program({ stacks: [b.when(b.morning(), b.forEach('A', b.if(b.cropIsReady(), [b.harvest()], [])), b.goTo(b.tileAt(9, 6)), b.turn('left'), b.deposit(), b.powerDown())] }),
  triggers: b.program({ stacks: [
    b.when(b.atTime(583), b.say('Morning tea')),
    b.when(b.bagFull(), b.goTo(b.tileAt(9, 6)), b.turn('left'), b.deposit()),
    b.when(b.startsRaining(), b.wait(30)),
    b.when(b.every(15), b.if(b.and(b.soilIsDry(), b.not(b.itIsRaining())), [b.water()])),
  ] }),
  helpers: b.program({
    vars: [b.numVar('rows', 3), b.textVar('note', 'Row done'), b.tileVar('home', 6, 6), b.itemVar('crop', 'potato'), b.yesVar('harvestedToday12', false)],
    stacks: [b.when(b.morning(), b.repeat(b.v('rows'), b.run('plantRow'), b.change('rows', -1)), b.set('harvestedToday12', b.yes(true)), b.goTo(b.v('home')))],
    helpers: [b.helper('plantRow', b.till(), b.plant('parsnip'), b.take(b.v('crop')), b.say(b.v('note')), b.move())],
  }),
  sensors: b.program({
    vars: [b.numVar('n', 0)],
    stacks: [b.when(b.morning(), b.forever(
      b.if(b.or(b.tileIsTilled(), b.cropIs('cauliflower')), [b.set('n', b.add(b.countInBag('parsnip'), b.mul(2, b.sub(b.v('n'), 1))))], [b.turn('right')]),
      b.if(b.and(b.bagIsFull(), b.bagHas('parsnip')), [b.powerDown()]),
      b.if(b.or(b.atEdgeOf('B'), b.tokensBelow(20)), [b.goTo(b.myTile())]),
      b.if(b.or(b.tileAheadIs('water'), b.timeIsAfter(1080)), [b.goTo(b.tileAhead())]),
      b.if(b.and(b.ne(b.v('n'), 0), b.gt(b.v('n'), 5)), [b.wait(b.v('n'))]),
      b.if(b.eq(b.v('n'), 3), [b.move()]),
    ))],
  }),
};
const P = await __qa.mod('/src/robots/program.ts');
({ added, counts: Object.fromEntries(Object.entries(FIX).map(([k, p]) => [k, P.blockCount(p)])) })
```
Expect `added: "Added Atlas."` and `counts: { job1: 6, harvest: 9, triggers: 15, helpers: 16, sensors: 42 }`.
Then, for each name in turn (`job1`, `harvest`, `triggers`, `helpers`, `sensors`):
```js
const name = 'job1';
const said = __meadowlight.setProgram('Atlas', FIX[name]);
await __qa.key('KeyE');   // "Work on Atlas"
({ said, panel: __qa.state().ui.panel })
```
Expect `said: "Programmed Atlas."` and `panel: { kind: 'robot', robotId: 1, mode: 'bench' }`.
`find "Program"` → click; once the editor shows, `get_page_text` has "{count} / 80 blocks" with
that fixture's count and no error sentence. Screenshot: stacks laid out top to bottom
(declarations, then trigger stacks, then helpers); for `triggers`, the time dropdown reads
9:43 am. Click **Save**, then:
```js
({ same: __qa.same(__qa.robot('Atlas').program, FIX[name]), toast: __qa.snap(1).toasts })
```
Expect `same: true` and `toast: ["[success] Programmed Atlas."]`. `computer key "Escape"`
closes the screen with no prompt (nothing unsaved); go on with the next name.

## 5. A DON'T go into water card, written in the .MD tab, is obeyed

```js
const F = await __qa.fixtures(); const W = await __qa.mod('/src/world/tiles.ts'); let s = __qa.state();
for (let tz = 21; tz <= 26; tz++) s = F.withTile(s, { tx: 38, tz }, W.EMPTY_TILE, 'farm');
s = F.withTile(s, { tx: 38, tz: 27 }, W.blockedTile(F.T.Blocker.Water), 'farm');
__qa.load({ ...s, time: { ...s.time, minuteOfDay: 360 } });
__meadowlight.addScriptedRobot({ name: 'Careful', parts: ['claw'], steps: [{ kind: 'turn', side: 'right' }], place: { tx: 6, tz: 6, facing: 0 } });
__qa.bench('Careful');
const b = __meadowlight.blocks;
const said = __meadowlight.setProgram('Careful', b.program({ stacks: [b.when(b.morning(), b.repeat(4, b.move()))] }));
await __qa.key('KeyE');
({ said, running: __qa.robot('Careful').exec.running, panel: __qa.state().ui.panel.kind })
```
Expect `said: "Programmed Careful."`, `running: 0`, `panel: 'robot'`. `find ".MD"` → click: the
card reads "# CAREFUL.MD", "## DO", "## DON'T", "0 / 3 cards". **Add a card** offers only job
1's two cards (DON'T leave a zone, DON'T go into water). Pick DON'T go into water ("1 / 3
cards") and click **Save**:
```js
({ md: __qa.robot('Careful').md, toast: __qa.snap(1).toasts })
```
Expect `md: [{ kind: 'dontGoIntoWater' }]` and `toast: ["[success] Set Careful's .MD."]`.
Click **Lift off**, then carry it to the shore and let it walk:
```js
__qa.patch((s) => { Object.assign(s.player, { tx: 38, tz: 23, facing: 2 }); });   // setup: the walk to the pond
const putHint = document.body.innerText.includes('Put down Careful');
await __qa.key('KeyE');
__qa.tick(20);
const r = __qa.robot('Careful'); ({ putHint, at: [r.tx, r.tz], power: r.power, tokens: r.tokens, log: await __qa.logText(3, 'Careful') })
```
Expect `putHint: true`, `at: [38, 26]` (on the shore), `power: 'standby'`, `tokens: 78` (two
moves), and the log: one "says: Following my rules ✓" entry ×2 whose "happened" names the
card ("… my .MD says don't go into water."), then "All done ✓".

## 6. Paint Zone A with the marker, then `For each tile in A` after `unlockAll`

```js
const F = await __qa.fixtures(); let s = __qa.state();
for (let tx = 6; tx <= 8; tx++) for (let tz = 12; tz <= 14; tz++) s = F.withTile(s, { tx, tz }, F.soilTile(F.T.TileState.Plowed), 'farm');
__qa.load(F.withPlayer(s, { tx: 6, tz: 11 }, 2, 'farm'));
const slot = __qa.state().inventory.slots.findIndex((x) => x?.itemId === 'zoneMarker');
__qa.select(slot);
await new Promise((r) => setTimeout(r, 100));
({ slot, chip: document.body.innerText.includes('Zone A · not set') })
```
Expect `slot: 6` and `chip: true`. Cycling, and Escape dropping a draft:
```js
await __qa.shift('Space');
const letter = __qa.state().ui.zoneLetter;
await __qa.key('Space');
const draft = __qa.state().ui.zoneDraft;
const chip = document.body.innerText.includes('Zone B · not set · corner set');
await __qa.key('Escape');
const u = __qa.state().ui;
({ letter, draft, chip, after: { draft: u.zoneDraft, paused: u.paused, panel: u.panel.kind } })
```
Expect `letter: 'B'`, `draft: { zone: 'B', corner: { tx: 6, tz: 12 } }`, `chip: true`, and
`after: { draft: null, paused: false, panel: 'none' }`. Back to A, then paint the bed:
```js
for (let i = 0; i < 7; i++) await __qa.shift('Space');
const letter = __qa.state().ui.zoneLetter;
await __qa.key('Space', 600);   // a long hold: one corner, no repeats
const draft = __qa.state().ui.zoneDraft;
await __qa.walkTo(8, 15); await __qa.turn(0);   // (8,14) ahead
await __qa.key('Space');
const st = __qa.state();
({ letter, draft, zone: st.robots.zones.A, after: st.ui.zoneDraft, toast: __qa.snap(1).toasts, chip: document.body.innerText.includes('Zone A · 3×3') })
```
Expect `letter: 'A'`, `draft: { zone: 'A', corner: { tx: 6, tz: 12 } }`,
`zone: { x0: 6, z0: 12, w: 3, d: 3 }`, `after: null`, a toast ending "Zone A · 3×3.", `chip: true`.
Zoom in (`KeyZ` ×3) and screenshot: a tinted outline round the bed with "A" at its north-west
corner. Now a robot, on the bench, with job 1's set:
```js
const s = __qa.state(); __qa.load({ ...s, time: { ...s.time, minuteOfDay: 360 } });
const added = __meadowlight.addRobot('spinner', { tx: 6, tz: 6, facing: 0 });
__qa.bench('Spinner');
await __qa.key('KeyE');
({ added, panel: __qa.state().ui.panel.kind })
```
Expect "Added Spinner." and `'robot'`. `find "Program"` → click, then click the Control
category: `find "For each tile"` finds nothing (it's locked). `computer key "Escape"` until
`__qa.state().ui.panel.kind` is `'none'` (the flyout first, then the screen). Then:
```js
const said = __meadowlight.unlockAll();
const s = __qa.state(); __qa.load({ ...s, time: { ...s.time, minuteOfDay: 360 } });
await __qa.key('KeyE');
({ said, panel: __qa.state().ui.panel.kind })
```
Expect `said: "Unlocked every block, card and tab."` and `'robot'`; the Stats tab now shows in
the header. Program → Control now has "For each tile in [A]". Build:
```
When morning comes
  For each tile in [A]
    Water
  Power down
```
"4 / 12 blocks". Click **Save**:
```js
const b = __meadowlight.blocks; const r = __qa.robot('Spinner');
({ same: __qa.same(r.program, b.program({ stacks: [b.when(b.morning(), b.forEach('A', b.water()), b.powerDown())] })), running: r.exec.running, toast: __qa.snap(1).toasts })
```
Expect `same: true`, `running: 0`, `toast: ["[success] Programmed Spinner."]`. Click
**Lift off**, then:
```js
await __qa.walkTo(5, 12); await __qa.turn(1);   // (6,12) ahead, facing east
const putHint = document.body.innerText.includes('Put down Spinner');
await __qa.key('KeyE');
__qa.tick(100);
const tiles = []; for (let tz = 12; tz <= 14; tz++) for (let tx = 6; tx <= 8; tx++) tiles.push((await __qa.tile(tx, tz, 'farm')).state);
const r = __qa.robot('Spinner'); ({ putHint, tiles, power: r.power, tokens: r.tokens, tank: r.tank, at: [r.tx, r.tz] })
```
Expect `putHint: true`, nine `2`s, `power: 'standby'`, `tokens: 50` (9 waters × 2, 8 moves,
4 turns), `tank: 11`, `at: [8, 14]`. Finally clear the zone:
```js
await __qa.turn(3);   // nothing ahead but grass
await __qa.shift('KeyE');
({ zone: __qa.state().robots.zones.A, toast: __qa.snap(1).toasts })
```
Expect `zone: null` and a toast ending "Cleared Zone A.".

## 7. Two robots bump: both dizzy, the toast, the emptied stack on the bench

```js
const F = await __qa.fixtures(); const s = __qa.state();
__qa.load({ ...F.withPlayer(s, { tx: 6, tz: 13 }, 0, 'farm'), time: { ...s.time, minuteOfDay: 360 } });
const b = __meadowlight.blocks, walk = b.program({ stacks: [b.when(b.morning(), b.repeat(3, b.move()))] });
const out = [
  __meadowlight.addScriptedRobot({ name: 'Tick', parts: ['claw'], steps: [{ kind: 'turn', side: 'right' }], place: { tx: 6, tz: 12, facing: 1 } }),
  __meadowlight.addScriptedRobot({ name: 'Tock', parts: ['claw'], steps: [{ kind: 'turn', side: 'right' }], place: { tx: 8, tz: 12, facing: 3 } }),
  __meadowlight.setProgram('Tick', walk),
  __meadowlight.setProgram('Tock', walk),
];
__qa.tick(4);   // 6:04: both move into (7,12)
const view = (n) => { const r = __qa.robot(n); return { at: [r.tx, r.tz], tokens: r.tokens, off: r.off, running: r.exec.running, stack: r.program.stacks[0], ok: r.lastAction?.success }; };
({ out, tick: view('Tick'), tock: view('Tock'), toasts: __qa.snap(2).toasts, log: await __qa.logText(2) })
```
Expect `out: ["Added Tick.", "Added Tock.", "Programmed Tick.", "Programmed Tock."]`, and for
each robot: its own tile (`[6, 12]`, `[8, 12]`), `tokens: 79`, `off: 'dizzy'`, `running: null`,
`stack: { trigger: { kind: 'morning' }, body: [] }`, `ok: false`. Toasts:
"[warn] Tick bumped into Tock and forgot what to do when morning came." and
"[warn] Tock bumped into Tick and forgot what to do when morning came.". Log: "says: Made a new
friend ✓ | happened: Bumped into Tock and got dizzy. Forgot everything under "When morning came"."
and its mirror for Tock. Now take Tick to the bench:
```js
const hint = document.body.innerText.includes('Pick up Tick');
await __qa.key('KeyE');
await __qa.walkTo(6, 5); await __qa.turn(0);
await __qa.key('KeyE');
({ hint, panel: __qa.state().ui.panel })
```
Expect `hint: true` and `panel: { kind: 'robot', robotId: 1, mode: 'bench' }`. The header says
"Off until morning". Program tab: one "When morning comes" block with nothing inside, "1 / 12 blocks".
Screenshot.

## 8. The pond: a new core the same day, ruin overnight, scrapping

The shore and the pond's edge are laid by hand so the check doesn't depend on the seed's rocks.
```js
const F = await __qa.fixtures(); const W = await __qa.mod('/src/world/tiles.ts'); let s = __qa.state();
for (const tx of [38, 39]) {
  for (let tz = 21; tz <= 26; tz++) s = F.withTile(s, { tx, tz }, W.EMPTY_TILE, 'farm');
  s = F.withTile(s, { tx, tz: 27 }, W.blockedTile(F.T.Blocker.Water), 'farm');
}
__qa.load(F.withPlayer(s, { tx: 39, tz: 23 }, 2, 'farm'));
const out = [
  __meadowlight.addRobot('swimmer', { tx: 39, tz: 25, facing: 2 }),
  __meadowlight.addScriptedRobot({ name: 'Dunk', parts: ['claw'], loop: false, steps: [{ kind: 'move' }], place: { tx: 38, tz: 26, facing: 2 } }),
];
__qa.tick(8);
const v = (n) => { const r = __qa.robot(n); return { at: [r.tx, r.tz], power: r.power }; };
({ out, splash: v('Splash'), dunk: v('Dunk'), toasts: __qa.snap(2).toasts })
```
Expect `out: ["Added Splash.", "Added Dunk."]`, Splash `{ at: [39, 27], power: 'broken' }`, Dunk
`{ at: [38, 27], power: 'broken' }`, and the two toasts "[warn] Dunk drove into the water and
shorted out." and "[warn] Splash drove into the water and shorted out.". Fish Splash out and
send it for a new core:
```js
await __qa.walkTo(39, 26); await __qa.turn(2);
const fishHint = document.body.innerText.includes('Fish out Splash');
await __qa.key('KeyE');
__qa.patch((s) => { Object.assign(s.player, { tx: 10, tz: 6, facing: 0 }); });   // setup: the walk to the bin
const coreHint = document.body.innerText.includes('Send Splash for a new core · 300g');
await __qa.key('KeyE');
({ fishHint, coreHint, power: __qa.robot('Splash').power, gold: __qa.state().player.gold, toast: __qa.snap(1).toasts })
```
Expect both hints `true`, `power: 'repairing'`, `gold: 200`, and a toast ending "Splash is off
for a new core. Back tomorrow.". Leave Dunk in the water and sleep:
```js
__qa.sleep();
const v = (n) => { const r = __qa.robot(n); return { at: [r.tx, r.tz], power: r.power }; };
({ splash: v('Splash'), dunk: v('Dunk'), toasts: __qa.snap(8).toasts })
```
Expect Dunk `{ at: [38, 27], power: 'ruined' }` and Splash `{ at: [9, 6], power: 'working' }`.
The toasts include "[warn] Dunk spent the night in the water and is ruined. Scrap it at the
workbench." and "Splash is back from repairs.", and none says "away from a generator" (a ruined
robot and one back from repairs are never named). Stand on the shore (`__qa.patch((s) => {
Object.assign(s.player, { tx: 38, tz: 25, facing: 2 }); })`), zoom in (`KeyZ` ×3) and
screenshot: Dunk sunk in the water, dark, with no sparks. Then:
```js
__qa.patch((s) => { Object.assign(s.player, { tx: 38, tz: 26, facing: 2 }); });
const fishHint = document.body.innerText.includes('Fish out Dunk');
await __qa.key('KeyE');
__qa.patch((s) => { Object.assign(s.player, { tx: 10, tz: 6, facing: 0 }); });   // setup: to the bin
await __qa.key('KeyE');
const refusal = __qa.snap(1).toasts;
__qa.patch((s) => { Object.assign(s.player, { tx: 6, tz: 5, facing: 0 }); });    // setup: to the bench
const benchHint = document.body.innerText.includes('Put Dunk on the bench');
await __qa.key('KeyE');
({ fishHint, refusal, benchHint, panel: __qa.state().ui.panel, gold: __qa.state().player.gold })
```
Expect `fishHint: true`, `refusal: ["[warn] Dunk is beyond repair. Scrap it at the workbench."]`,
`benchHint: true`, `panel: { kind: 'robot', robotId: 2, mode: 'bench' }`, `gold: 200`. The
Program, .MD and Looks tabs each show "Dunk is ruined. It can only be scrapped." and no editor
controls, and the header has no On/Off switch. Click **Scrap**: "Scrap Dunk for 375g? This
can't be undone." with **Scrap** and **Keep**. Click **Scrap** in the prompt:
```js
const st = __qa.state(); ({ names: st.robots.list.map((r) => r.name), logIds: [...new Set(st.robots.log.entries.map((e) => e.robotId))], gold: st.player.gold, panel: st.ui.panel.kind, toast: __qa.snap(1).toasts })
```
Expect `names: ['Splash']`, `logIds: [1]` (Dunk's entries are gone), `gold: 575`,
`panel: 'none'`, `toast: ["[success] Scrapped Dunk for 375g."]`.

## 9. Paint a robot and switch it off; it stays off the next morning

```js
const F = await __qa.fixtures(); const s = __qa.state();
__qa.load(F.withPlayer(s, { tx: 6, tz: 5 }, 0, 'farm'));
const out = [
  __meadowlight.addScriptedRobot({ name: 'Rosie', parts: ['claw'], steps: [{ kind: 'turn', side: 'right' }], place: { tx: 6, tz: 6, facing: 2 } }),
  __meadowlight.addScriptedRobot({ name: 'Plain', parts: ['claw'], steps: [{ kind: 'turn', side: 'right' }], place: { tx: 7, tz: 6, facing: 2 } }),
];
__qa.bench('Rosie');
await __qa.key('KeyE');
({ out, panel: __qa.state().ui.panel.kind })
```
Expect `["Added Rosie.", "Added Plain."]` and `'robot'`. `find "Looks"` → click: 16 swatches
and **Paint · 50g**. Click the Rose swatch (the small robot drawing turns pink), then
**Paint · 50g**; click **Paint · 50g** once more; then click the switch's **Off**:
```js
const r = __qa.robot('Rosie'); ({ paint: r.paint, off: r.off, gold: __qa.state().player.gold, toasts: __qa.snap(2).toasts })
```
Expect `paint: 4`, `off: 'player'`, `gold: 450`, toasts "[success] Painted Rosie Rose." then
"[warn] Rosie is already Rose.". The header says "Switched off" and the switch offers **On**.
Click **Lift off**, then:
```js
await __qa.turn(2);
await __qa.key('KeyE');   // "Put down Rosie" on (6,6)
const seq = { rosie: __qa.robot('Rosie').actionSeq, plain: __qa.robot('Plain').actionSeq };
__qa.tick(30);
({ rosie: __qa.robot('Rosie').actionSeq - seq.rosie, plain: __qa.robot('Plain').actionSeq - seq.plain, off: __qa.robot('Rosie').off })
```
Expect `rosie: 0`, `plain` 7 or more, `off: 'player'`. Zoom in (`KeyZ` ×3) and screenshot:
Rosie's body and head shell pink beside Plain's sunflower yellow, trim the same on both. Then:
```js
__qa.sleep();
const seq = __qa.robot('Rosie').actionSeq;
__qa.tick(30);
const r = __qa.robot('Rosie'); ({ off: r.off, acted: r.actionSeq - seq })
```
Expect `off: 'player'` and `acted: 0`: the morning didn't switch it on. Back to the bench:
```js
__qa.patch((s) => { Object.assign(s.player, { tx: 6, tz: 5, facing: 2 }); });   // setup: next to Rosie
await __qa.key('KeyE');   // "Pick up Rosie"
await __qa.turn(0);
await __qa.key('KeyE');   // "Put Rosie on the bench"
({ panel: __qa.state().ui.panel })
```
Expect `panel: { kind: 'robot', robotId: 1, mode: 'bench' }`. Click **On**:
`__qa.robot('Rosie').off` is `null` and "Switched off" is gone from the header.

## 10. Peek at the Log with Shift + E; Stats after `unlockAll`

```js
const F = await __qa.fixtures(); const s = __qa.state();
__qa.load({ ...F.withPlayer(s, { tx: 6, tz: 6 }, 2, 'farm'), time: { ...s.time, minuteOfDay: 360 } });
__meadowlight.addRobot('spinner', { tx: 6, tz: 7, facing: 2 });
__qa.tick(12);   // turns at 6:04, 6:08 and 6:12; the next is 2.8 s of real time away
window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ShiftLeft', key: 'Shift', shiftKey: true, bubbles: true }));
await new Promise((r) => setTimeout(r, 100));
const hint = document.body.innerText.includes('Look at Spinner');
window.dispatchEvent(new KeyboardEvent('keyup', { code: 'ShiftLeft', key: 'Shift', bubbles: true }));
window.BEFORE = { robot: structuredClone(__qa.robot('Spinner')), energy: __qa.state().player.energy };
await __qa.shift('KeyE');
({ hint, panel: __qa.state().ui.panel, log: await __qa.logText(1, 'Spinner') })
```
Expect `hint: true`, `panel: { kind: 'robot', robotId: 1, mode: 'peek' }`, and one log line
"says: Turned ✓ … ×3". `get_page_text`: the only tab is Log (Stats is locked; Program, .MD and
Looks are bench-only), and there is no Save, Lift off, Scrap or On/Off. The Log tab has the
columns "Robot says" and "What happened", one row starting "6:04 am" with "Turned ✓" and "×3".
While the screen is still open (the game is frozen):
```js
({ same: __qa.same(__qa.robot('Spinner'), BEFORE.robot), energy: __qa.state().player.energy - BEFORE.energy })
```
Expect `same: true` and `energy: 0`: peeking costs nothing and changes nothing.
`computer key "Escape"` closes it. Then:
```js
const said = __meadowlight.unlockAll();
await __qa.shift('KeyE');
const r = __qa.robot('Spinner'); ({ said, mode: __qa.state().ui.panel.mode, stats: r.stats })
```
Expect `said: "Unlocked every block, card and tab."` and `mode: 'peek'`. Tabs: Stats and Log.
`find "Stats"` → click: the columns Today and This week show tokens used, actions taken and
crops handled equal to `stats.today` and `stats.week`, with crops handled 0 and tokens per crop
"—". `computer key "Escape"`. Shift + E at the workbench does what E does:
```js
__qa.patch((s) => { Object.assign(s.player, { tx: 6, tz: 5, facing: 0 }); });
await __qa.shift('KeyE');
({ toast: __qa.snap(1).toasts, panel: __qa.state().ui.panel.kind })
```
Expect a toast ending "Bring a robot here to work on it" and `panel: 'none'`.

## 11. The phone layout

The robot gets a block program and three cards, so the .MD tab has card lines to lay out (a
script robot's .MD tab only says ".MD cards only apply to block programs.").
```js
const s = __qa.state(); __qa.load({ ...s, time: { ...s.time, minuteOfDay: 360 } });
const b = __meadowlight.blocks;
const out = [
  __meadowlight.addRobot('spinner', { tx: 6, tz: 6, facing: 0 }),
  __meadowlight.setProgram('Spinner', b.program({ stacks: [b.when(b.morning(), b.repeat(4, b.move()))] })),
  __meadowlight.setMd('Spinner', [{ kind: 'doReturn', to: { kind: 'generator' }, minute: 1080 }, { kind: 'dontLeave', zone: 'A' }, { kind: 'dontGoIntoWater' }]),
];
__qa.bench('Spinner');
out
```
Expect `["Added Spinner.", "Programmed Spinner.", "Set Spinner's .MD."]`.
`resize_window {preset: 'mobile'}`, then reload `http://localhost:5173/` **without** `?new`
(the page saves as it unloads, so the benched robot comes back) and load the probe again. Then
`await __qa.key('KeyE')` ("Work on Spinner"). Screenshot: the tabs are a strip under the
header and the active tab fills the rest of the screen. Program tab: the saved stack, "3 / 12
blocks", no docked toolbox, but a **Blocks** button that opens a category menu; tap **Blocks**,
pick **Actions** (its flyout opens), screenshot, then drag one "Move forward" into the
workspace ("4 / 12 blocks"). Drag mostly sideways: in the phone's touch mode a steep drag
scrolls the flyout instead. .MD tab: screenshot; the three card lines wrap inside the width,
with no sideways scroll (`document.documentElement.scrollWidth` is `innerWidth`).
`computer key "Escape"` and click **Discard** in the prompt, then
`resize_window {preset: 'desktop'}`.

## 12. The builds, and the editor in `dist-single`

In the terminal:
- `npm run build:check`: the table's `main`, `screen` and `editor` rows end `ok`, then
  "check-bundle: … files in dist/ checked for robotLog|installRobotDev|addScriptedRobot|setMd|setZone|unlockAll: none found"
  and "check-bundle: OK".
- `npm run build:single`: "build-single: wrote …/dist-single/index.html (… KiB)".

The single-file build has no dev hooks, so the robot comes in through its save. In the dev
page (`?new`, probe loaded):
```js
const F = await __qa.fixtures(); const s = __qa.state();
__qa.load(F.withPlayer(s, { tx: 6, tz: 5 }, 0, 'farm'));
__meadowlight.addRobot('spinner', { tx: 6, tz: 6, facing: 0 });
({ ...__qa.robot('Spinner'), onBench: true, tx: 6, tz: 4 })
```
It prints the benched robot as JSON. `preview_start {name: "meadowlight-single"}`
opens `http://localhost:4174/`, a fresh farm. In that tab, run this with `null` replaced by
the printed JSON (JSON is a valid object literal):
```js
const KEY = 'meadowlight-farm.save.v1';
const ROBOT = null;   // replace null with the robot JSON the dev page printed
if (ROBOT === null) throw new Error('Paste the robot from the dev page first.');
// The game saves on pagehide; this listener runs after it and adds the robot to that save.
addEventListener('pagehide', () => {
  const save = JSON.parse(localStorage.getItem(KEY));
  save.robots.list = [ROBOT];
  save.robots.nextId = ROBOT.id + 1;
  Object.assign(save.player, { tx: 6, tz: 5, facing: 0 });
  localStorage.setItem(KEY, JSON.stringify(save));
});
location.reload();
```
After the reload, `computer {action: 'key', text: 'e'}` ("Work on Spinner"): the robot screen
opens. `find "Program"` → click: "Opening the editor…", then the empty workspace with the
fixed-script note. Drag "When morning comes" in ("1 / 12 blocks") and screenshot. Then:
- `read_console_messages {onlyErrors: true}` → none;
- `read_network_requests {urlPattern: '/assets/'}` → no request: the screen and the editor came
  from the one page.

`preview_stop` the `meadowlight-single` server. Across checks 1–11 in the dev build,
`read_console_messages {onlyErrors: true}` → none.
