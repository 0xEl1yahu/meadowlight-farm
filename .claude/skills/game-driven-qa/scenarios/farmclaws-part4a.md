# Farmclaws part 4a — the people playbook

The browser check from the part 4a plan (Task 10 Step 6), as runnable snippets for the part 4a
spec §7. Start each numbered check from `?new` with the probe loaded (see SKILL.md), with the
browser pane **shown**. Each fenced `js` block is one `javascript_tool` call; lines naming
`find`, `computer`, `get_page_text` or `resize_window` are browser-pane tool calls. Expected
results come from the part 4a spec and `src/config.ts`.

Town landmarks: the west gate (0,16) from the farm · the east gate (39,16) to the Neighbours ·
the main street z 15–17 · the square x 14–25, z 7–19. The cast stands facing south, and you
talk to each from the tile below, facing north: Marigold (7,7) → stand (7,8) · Berlioz (16,7) →
(16,8) · Sol (21,7), beside the parts exchange's door (20,6) → (21,8) · Juniper (24,7) → (24,8)
· Tallulah (35,7) → (35,8). On the Neighbours map: the west gate (0,14) back to town · the lane
z 13–15 · Cosmo (7,13) faces south → stand (7,14) facing north · Barnaby (25,15) faces north →
stand (25,14) facing south. Cosmo's field is fenced x 3–10, z 5–12 (gate (6,12)); Barnaby's
x 20–29, z 16–25 (gate (24,16)).

**Talking.** E on a character opens the chat box and freezes the game; E, K, Enter, Escape or
**Close** close it. A chat adds 1 to `npcs[id].talks`, so the first chat shows the
introduction and later ones an everyday or reactive line. The everyday pick depends on the
seed and the day, so the checks compare the box with `lineFor` on the state just before the
chat, and with the bank, instead of quoting it.

**Walking.** `__qa.walkTo` is greedy and sidesteps when blocked; the cast blocks like a wall,
so walk to the tile below a character, not onto them. Setup may jump the player to town with
`F.withPlayer(s, { tx, tz }, facing, 'town')`: the walk from the farm isn't what's under test.

A helper used by several checks (paste it into each `javascript_tool` call that needs it):
```js
const chat = () => { const box = document.querySelector('.chat-box'); return box === null || box.hidden ? null : box.innerText; };
```

## 1. Talk to the four shopkeepers and Sol: introduction first, then an everyday line

```js
const F = await __qa.fixtures();
__qa.load(F.withPlayer(__qa.state(), { tx: 7, tz: 8 }, 0, 'town'));
await new Promise((r) => setTimeout(r, 100));
const L = await __qa.mod('/src/people/lines.ts');
const chat = () => { const box = document.querySelector('.chat-box'); return box === null || box.hidden ? null : box.innerText; };
const out = {};
for (const [id, tx] of [['marigold', 7], ['berlioz', 16], ['sol', 21], ['juniper', 24], ['tallulah', 35]]) {
  __qa.patch((s) => { Object.assign(s.player, { mapId: 'town', tx, tz: 8, facing: 0 }); });   // setup: in front of the character
  await new Promise((r) => setTimeout(r, 50));
  const hint = document.body.innerText.includes(`Talk to ${id[0].toUpperCase()}${id.slice(1)}`);
  await __qa.key('KeyE');
  const first = { panel: __qa.state().ui.panel, box: chat() };
  await __qa.key('KeyE');                                   // closes the box
  const closed = { panel: __qa.state().ui.panel.kind, box: chat() };
  const expected = L.lineFor(__qa.state(), id);             // picked from the state before the second chat
  await __qa.key('KeyE');
  const second = __qa.state().ui.panel;
  await __qa.key('Escape');
  out[id] = { hint, first, closed, second: second.line, secondIsEveryday: L.LINE_BANKS[id].everyday.includes(second.line), secondIsExpected: second.line === expected, npcs: __qa.state().npcs[id] };
}
out
```
For each of the five, expect `hint: true`; `first.panel` `{ kind: 'talk', npc: id, line: <its
introduction> }` and `first.box` containing the name, the role line and that introduction;
`closed` `{ panel: 'none', box: null }`; `secondIsEveryday: true`, `secondIsExpected: true`;
`npcs` `{ talks: 2, talkedToday: true }`. The introductions, verbatim:
- Marigold (General store): "Welcome! I'm Marigold. Seeds, fertiliser, a bigger backpack one day. Shop with me any time."
- Berlioz (Blacksmith): "Berlioz. Blacksmith. I sharpen tools and I don't do small talk."
- Sol (Parts exchange): "Sol. I used to seed fields by hand; now I build the hands. When your robots need parts, this is the place."
- Juniper (Carpenter): "Juniper. I build barns, coops and anything with a hammer. Soon, robots too."
- Tallulah (Ranch): "Hi there, I'm Tallulah. Chickens, cows and wheat to feed them. Come see the ranch."

(On a fresh farm the backpack holds parsnip seeds and no robot is on the bench, so neither
Marigold's "Out of seeds?" nor Juniper's bench line fires; a fresh farm's day 1 isn't rainy in
the default seed, but if Tallulah's second line is "Rain again. The cows don't mind, and neither do
I." check `__qa.state().weather`: on a watering day that line is right, and `secondIsEveryday`
is then false by design.)

Then talk to Marigold once more and screenshot the box: it sits along the bottom of the screen
above the hotbar, the name with the role line under it in smaller text, the line, a **Shop**
button, and **Close** at the top right. The game is frozen while it's open:
```js
__qa.patch((s) => { Object.assign(s.player, { mapId: 'town', tx: 7, tz: 8, facing: 0 }); });
await __qa.key('KeyE');
const before = __qa.state().time.minuteOfDay;
await new Promise((r) => setTimeout(r, 1500));
({ panel: __qa.state().ui.panel.kind, minuteBefore: before, minuteAfter: __qa.state().time.minuteOfDay })
```
Expect `panel: 'talk'` and the two minutes equal. Leave the box open for check 2.

## 2. Marigold's Shop opens the seed shop; buy a packet

With Marigold's box open (check 1's last step, or repeat it), `find "Shop"` → click.
```js
({ panel: __qa.state().ui.panel, gold: __qa.state().player.gold })
```
Expect `panel: { kind: 'shop' }` and the chat box gone (screenshot: the seed shop). In the
shop, `find "×1"` → click the first one (the first seed in the list).
```js
const s = __qa.state(); ({ gold: s.player.gold, toasts: __qa.snap(1).toasts, seeds: s.inventory.slots.filter((x) => x?.itemId.endsWith('_seeds')).map((x) => `${x.itemId} ×${x.quantity}`) })
```
Expect `gold` lower than check 2's first reading by that seed's price (Parsnip seeds cost 20g
in spring: 500 → 480 on a fresh farm), and one more of that seed in the backpack. Escape
closes the shop (`panel: 'none'`).

## 3. A reactive line: a ruined robot, then Sol

The robot drives into the pond and spends the night there, so it's ruined in the morning. The
shore is laid by hand so the check doesn't depend on the seed's rocks (as in part 3's check 8).
```js
const F = await __qa.fixtures(); const W = await __qa.mod('/src/world/tiles.ts'); let s = __qa.state();
for (let tz = 21; tz <= 26; tz++) s = F.withTile(s, { tx: 38, tz }, W.EMPTY_TILE, 'farm');
s = F.withTile(s, { tx: 38, tz: 27 }, W.blockedTile(F.T.Blocker.Water), 'farm');
__qa.load(F.withPlayer(s, { tx: 36, tz: 23 }, 2, 'farm'));
const added = __meadowlight.addScriptedRobot({ name: 'Dunk', parts: ['claw'], loop: false, steps: [{ kind: 'move' }], place: { tx: 38, tz: 26, facing: 2 } });
__qa.tick(8);
const broken = __qa.robot('Dunk').power;
__qa.sleep();
({ added, broken, ruined: __qa.robot('Dunk').power })
```
Expect `added: "Added Dunk."`, `broken: 'broken'`, `ruined: 'ruined'`. Now talk to Sol; the
first chat is still his introduction, so record one chat first (setup):
```js
const F = await __qa.fixtures(); let s = __qa.state();
s = { ...s, npcs: { ...s.npcs, sol: { talks: 1, talkedToday: false } } };
__qa.load(F.withPlayer(s, { tx: 21, tz: 8 }, 0, 'town'));
await new Promise((r) => setTimeout(r, 100));
await __qa.key('KeyE');
const box = document.querySelector('.chat-box');
({ line: __qa.state().ui.panel.line, shown: box.innerText.includes(__qa.state().ui.panel.line) })
```
Expect `line: "Water and wires don't mix. Bring what's left of Dunk to the bench."` and
`shown: true`. Escape.

## 4. Through the east gate; Cosmo and Barnaby

```js
const F = await __qa.fixtures();
__qa.load(F.withPlayer(__qa.state(), { tx: 37, tz: 16 }, 1, 'town'));
await new Promise((r) => setTimeout(r, 100));
await __qa.key('KeyD', 120); await __qa.key('KeyD', 120);   // (38,16), then the gate tile (39,16)
const atGate = [__qa.state().player.tx, __qa.state().player.tz];
await __qa.key('KeyD', 120);                                  // off the edge: the warp
const p = __qa.state().player;
({ atGate, arrived: { mapId: p.mapId, at: [p.tx, p.tz], facing: p.facing } })
```
Expect `atGate: [39, 16]` and `arrived` `{ mapId: 'neighbours', at: [1, 14], facing: 1 }`.
Screenshot: the lane running east, Cosmo's house, coop and fenced dirt field on the left,
Barnaby's house behind and his bigger field across the lane, hedges along the back.
```js
const chat = () => { const box = document.querySelector('.chat-box'); return box === null || box.hidden ? null : box.innerText; };
const walk1 = await __qa.walkTo(7, 14); await __qa.turn(0);
const cosmoHint = document.body.innerText.includes('Talk to Cosmo');
await __qa.key('KeyE'); const cosmo1 = __qa.state().ui.panel.line; const cosmoBox = chat(); await __qa.key('KeyE');
const walk2 = await __qa.walkTo(25, 14); await __qa.turn(2);
const barnabyHint = document.body.innerText.includes('Talk to Barnaby');
await __qa.key('KeyE'); const barnaby1 = __qa.state().ui.panel.line; await __qa.key('KeyE');
await __qa.key('KeyE'); const barnaby2 = __qa.state().ui.panel.line; await __qa.key('Escape');
({ walk1: walk1.arrived, walk2: walk2.arrived, cosmoHint, cosmo1, cosmoBox, barnabyHint, barnaby1, barnaby2 })
```
Expect both walks `true`, both hints `true`, `cosmo1: "Hi! I'm Cosmo. My robot is the biggest
one in the valley. It mostly says hello to the chickens."` with `cosmoBox` showing "Cosmo" and
"Farmer"; `barnaby1: "Barnaby. Four robots, one field, zero effort. That's the future, and I'm
already living in it."`; `barnaby2: "No robots yet? You're leaving money in the field,
friend."` (a fresh farm has no robots). Then walk back west along the lane and off the edge at
(0,14): the player arrives in town at (38,16) facing west.

## 5. Characters block walking and placing; the nameplate

```js
const F = await __qa.fixtures();
let s = F.withPlayer(__qa.state(), { tx: 7, tz: 8 }, 0, 'town');
s = { ...s, inventory: { ...s.inventory, selected: 8, slots: s.inventory.slots.map((x, i) => (i === 8 ? F.stack('chest', 1) : x)) } };   // setup: a chest in hand
__qa.load(s);
await new Promise((r) => setTimeout(r, 100));
await __qa.key('KeyW', 120);
const after = [__qa.state().player.tx, __qa.state().player.tz];
await __qa.key('Space');
const placed = __qa.state().maps.town;
const T = await __qa.mod('/src/world/tiles.ts');
({ after, toast: __qa.snap(1).toasts, tileObject: T.getTile(placed, 7, 7).object, panel: __qa.state().ui.panel.kind })
```
Expect `after: [7, 8]` (the step was refused), the toast "[warn] Someone's standing there.",
`tileObject: null` and `panel: 'none'`. Zoom in (`KeyZ` ×3) and screenshot: Marigold in front
of the player with the plate "Marigold" floating above her head. Turn east (`await
__qa.turn(1)`): screenshot, no plate (no character ahead). Press Escape to pause: with Marigold
ahead again (`await __qa.turn(0)`), the plate is hidden while the pause overlay is up; Escape
resumes and it comes back. Screenshot the cast from a few tiles back (`__qa.patch((s) => {
Object.assign(s.player, { tx: 21, tz: 11, facing: 0 }); })`): Sol in his tool apron beside the
parts exchange (a narrow two-storey workshop with a cog-and-claw sign, a big window and a crate
of parts by the door), and each character swaying gently, out of step with the others.

## 6. The chat box at phone width

`resize_window {preset: 'mobile'}`, reload `http://localhost:5173/?new`, load the probe, then:
```js
const F = await __qa.fixtures();
__qa.load(F.withPlayer(__qa.state(), { tx: 7, tz: 8 }, 0, 'town'));
await new Promise((r) => setTimeout(r, 100));
await __qa.key('KeyE');
const box = document.querySelector('.chat-box'); const r = box.getBoundingClientRect();
({ phone: box.classList.contains('chat-box--phone'), left: Math.round(r.left), right: Math.round(r.right), width: innerWidth, noSideScroll: document.documentElement.scrollWidth === innerWidth })
```
Expect `phone: true`, the box spanning the screen (`left` near 0, `right` near `width`) and
`noSideScroll: true`. Screenshot: the introduction wraps inside the box, **Shop** and **Close**
are both visible and tappable. Tap **Close** (`find "Close"` → click): `ui.panel.kind` is
`'none'`. `resize_window {preset: 'desktop'}`.

## 7. Sleep; the fields and fences are unchanged the next morning

```js
const F = await __qa.fixtures();
__qa.load(F.withPlayer(__qa.state(), { tx: 1, tz: 14 }, 1, 'neighbours'));
const before = structuredClone(__qa.state().maps.neighbours);
__qa.sleep();
const after = __qa.state().maps.neighbours;
const T = await __qa.mod('/src/world/tiles.ts');
({ day: __qa.state().time.absoluteDay, same: __qa.same(before, after), fence: T.getTile(after, 3, 5).object, gate: T.getTile(after, 6, 12).object, field: T.getTile(after, 5, 8).state })
```
Expect `day: 1` (the morning after day 0), `same: true`, `fence: { kind: 'woodFence' }`,
`gate: null` (the gap) and `field: 0` (`TileState.Unplowed`: bare dirt, not soil).

## 8. Save, reload on the Neighbours map; the builds

```js
const F = await __qa.fixtures();
let s = F.withPlayer(__qa.state(), { tx: 10, tz: 14 }, 1, 'neighbours');
s = { ...s, npcs: { ...s.npcs, cosmo: { talks: 3, talkedToday: true } } };
__qa.load(s);
({ at: [__qa.state().player.mapId, __qa.state().player.tx, __qa.state().player.tz] })
```
Expect `at: ['neighbours', 10, 14]`. Reload `http://localhost:5173/` **without** `?new` (the
page saves as it unloads), load the probe again:
```js
const s = __qa.state(); ({ version: s.version, at: [s.player.mapId, s.player.tx, s.player.tz], cosmo: s.npcs.cosmo, panel: s.ui.panel.kind })
```
Expect `version: 7`, `at: ['neighbours', 10, 14]`, `cosmo: { talks: 3, talkedToday: true }`,
`panel: 'none'`. Screenshot: the Neighbours map around the player. `read_console_messages
{onlyErrors: true}` shows nothing from any check. Then, in a terminal, `npm run build:check`:
it ends with "check-bundle: OK" and finds none of the dev-hook names in `dist/`.
