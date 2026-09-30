# Farmclaws part 1 — robot core playbook

The browser check from the part 1 plan (Task 14 Step 4), as runnable snippets. Start from `?new`
with the probe loaded (see SKILL.md). Each block is one `javascript_tool` call; expected results
are what the build produced on 2026-09-30 (all PASS).

Farm landmarks: spawn (2,5) · shipping bin (9,5)–(10,5), repair drop-off (9,6) · pond x 34–44, z 27–34.
Mini: 80 tokens, acts every 4 game minutes, turn costs 1. 1 game minute ≈ 0.7 s at 1×.

## 1. Spinner drains and goes flat

```js
__meadowlight.addRobot('spinner');           // on the tile in front of the player
for (let i = 0; i < 4; i++) await __qa.key('KeyT', 30);   // 16×
```
Wait ~15 s. Expect `power: 'flat'`, tokens 0, toast `[warn] Spinner ran out of power.`, log `did turn ×80` then `flat`.

## 2. Swimmer shorts out, fish it out, repair, back next morning

```js
__meadowlight.addRobot('swimmer', { tx: 39, tz: 26, facing: 2 });
__qa.patch(s => { s.player.tx = 39; s.player.tz = 24; s.player.facing = 2; });
__qa.tick(8);                                  // → broken at (39,27), "[warn] Splash drove into the water and shorted out."
await __qa.walkTo(39, 26);                     // hint "Fish out Splash"
await __qa.key('KeyE');                        // energy −4, player.carrying = robot id
await __qa.walkTo(10, 6); await __qa.turn(0);  // hint "Send Splash for repair · 300g"
await __qa.key('KeyE');                        // gold −300, power 'repairing'
await __qa.key('KeyN');                        // next day: at (9,6), working, 80 tokens, toast after "Good morning"
```
Screenshot while carrying: the robot is drawn above the player.

## 3. The pair bickers over a mature crop

```js
const F = await __qa.fixtures(); let s = __qa.state();
for (const tx of [5, 6, 7, 8]) s = F.withTile(s, { tx, tz: 11 }, F.soilTile(F.T.TileState.Plowed, F.matureCrop('parsnip')), 'farm');
__qa.load(F.withPlayer(s, { tx: 5, tz: 9 }, 2, 'farm'));
__meadowlight.addRobot('pair', { tx: 5, tz: 10, facing: 2 });
```
Robots act on their own tile, so they bicker after moving onto (5,11). Poll until `snap().robots` shows `last: 'harvest bicker'`, then screenshot the red "!" badges (1.5 s). `await __qa.logText(6)` shows "says: Waiting my turn ✓ | happened: Fought Dee over the same tile. Nobody got it." The crop at (5,11) stays at stage 4.

## 4–5. Wood burner, token pool, recharge in and out of range

Give materials, craft through the UI, place, load:
```js
const F = await __qa.fixtures(); const s = __qa.state(); const slots = s.inventory.slots.slice();
slots[6] = F.stack('stone', 20); slots[7] = F.stack('wood', 25); slots[8] = F.stack('copperOre', 2);
__qa.load({ ...s, inventory: { ...s.inventory, slots } });
await __qa.key('KeyI');                       // then find "Crafting" tab → click; find "Craft Wood Burner" → click
```
```js
await __qa.key('Escape'); await __qa.walkTo(7, 8); await __qa.turn(2);
await __qa.key('Digit7'); await __qa.key('Space');   // "Place wood burner" → burner at (7,9), fuel 0
await __qa.key('Digit8'); await __qa.key('KeyE');    // "Load wood" → fuel 10; E again → "[warn] The burner is full."
```
Put one robot within 2 tiles (Chebyshev) of the burner and one outside, then `KeyN`. Expect "Your wood burners turned 10 wood into 60 tokens.", HUD `60 tokens`, the in-range robot charged from the pool (and "Not enough tokens to fully charge …" if the pool runs out), and "{names} ended the day away from a generator and didn't recharge." for the others, in id order.

## 6. Pick up a working robot mid-script and put it down

Robots move every 4 minutes, so time the approach:
```js
const S = __qa.state, tw = () => __qa.robot('Tweedle');
const seq = tw().actionSeq;
await new Promise(r => { const id = setInterval(() => { if (tw().actionSeq !== seq) { clearInterval(id); r(); } }, 20); });
const r = tw(); await __qa.walkTo(r.tx - 1, r.tz); await __qa.turn(1);
await __qa.key('KeyE');                        // carrying; pc frozen while carried
```
Walk elsewhere, face an open tile ("Put down Tweedle"), `KeyE`: the robot faces the player's way, `teleportSeq` +1, same `pc`, and it acts again within ~3 s.

## 7. Custom scripts: watering a row, and a missing part

```js
const F = await __qa.fixtures(); let s = __qa.state();
for (const tx of [4, 5, 6, 7, 8]) s = F.withTile(s, { tx, tz: 8 }, F.soilTile(F.T.TileState.Plowed), 'farm');  // no crop → waterable
__qa.load(F.withPlayer(s, { tx: 6, tz: 10 }, 0, 'farm'));
__meadowlight.addScriptedRobot({ name: 'Wetty', parts: ['wateringHead'], loop: false, place: { tx: 5, tz: 8, facing: 1 },
  steps: [{ kind: 'water' }, { kind: 'move' }, { kind: 'water' }, { kind: 'powerDown' }] });
__meadowlight.addScriptedRobot({ name: 'Clawy', parts: ['claw'], loop: false, steps: [{ kind: 'water' }], place: { tx: 3, tz: 13, facing: 1 } });
__qa.tick(20);
```
Expect tile states x 4–8 = `[1, 2, 2, 1, 1]`, Wetty `standby` at (6,8), and the two watered tiles darker than their neighbours in a zoomed screenshot. Clawy's log: "says: Watered ✓ | happened: Tried to water, but it doesn't have the part for that.", tokens still 80. Robots act on their own tile, so the first `water` wets the tile they stand on.

## 8. Scale, errors, persistence

```js
// 9 more robots → 12 total; the 13th returns "The farm already has 12 robots."
await __qa.fps(3000)   // expect ~60
```
`read_console_messages {onlyErrors: true}` → none. `resize_window {preset: 'mobile'}` + reload **without** `?new`: the HUD shows gold and tokens side by side, and all robots load back in the same power states. Reset to `desktop`.
