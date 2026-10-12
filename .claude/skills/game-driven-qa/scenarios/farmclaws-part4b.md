# Farmclaws part 4b — the shops and parts playbook

The browser check for the part 4b spec §11, as short snippets. Load the probe after every
navigation (see SKILL.md). Checks 1–4 run in order on one farm started from `?new`; checks 5
and 6 each start from `?new`. Each fenced `js` block is one `javascript_tool` call; lines naming
`find`, `computer` or `get_page_text` are browser-pane tool calls. While a shop or the robot
screen is open the game is frozen: drive it with `find` and clicks, and close it (Escape)
before `__qa.sleep()`, which a frozen game ignores. Since part 4c the jobs open the shops, so the
setups mark every job done (`F.withJobsDone`).

Town spots, talked to from the tile below facing north: Berlioz (16,7) → (16,8) · Sol (21,7) →
(21,8) · Juniper (24,7) → (24,8) · Tallulah (35,7) → (35,8). The parts exchange is x 18–21 and
Juniper's workshop (the carpenter) x 22–27, both along z 0–6. The workbench is (6,4).

## 1. Sol's shop: buy a watering head, sell a part back

```js
const F = await __qa.fixtures();
__qa.load(F.withPlayer(F.withGold(F.withJobsDone(__qa.state(), 'knowTheLimits'), 20000), { tx: 21, tz: 8 }, 0, 'town'));
await new Promise((r) => setTimeout(r, 100));
await __qa.key('KeyE');
```
`find "Shop"` → click: `ui.panel` is `{ kind: 'partsShop' }`, titled "Sol's parts exchange",
six Buy rows each "2 left", and "No parts in your backpack." under Sell. Click **Buy** on the
Watering head row, then on the Claw row, then **Sell one** on the Claw's Sell row.
```js
const s = __qa.state(); ({ gold: s.player.gold, parts: s.inventory.slots.filter((x) => x?.itemId === 'wateringHead' || x?.itemId === 'claw'), sold: s.shopsSoldToday.parts, toasts: __qa.snap(3).toasts })
```
Expect `gold: 19450` (−400 −300 +150), one `wateringHead` and no claw, `sold` with
`wateringHead: 1, claw: 1`, and the toasts "Bought a watering head.", "Bought a claw.", "Sold a
claw for 150g." Both bought rows now say "1 left". Escape.

## 2. Juniper's workshop: read the Mini's program, order one, sleep

```js
__qa.patch((s) => { Object.assign(s.player, { mapId: 'town', tx: 24, tz: 8, facing: 0 }); });
await __qa.key('KeyE');
```
`find "Workshop"` → click: "Juniper's robot workshop", "0 / 12 robots", and three cards (Mini
1,500g, Standard 4,000g, Big 10,000g), each with "Comes with a claw and a program that harvests
Zone A." and "1 left". Click **Read program** on the Mini: `ui.panel` is `{ kind: 'robot', mode:
'preview', size: 'mini' }`. Screenshot: the header says "Mini" and "From Juniper's workshop",
with no switch, **Lift off** or **Scrap**; the tabs are Program (When morning comes → For each
tile in A → Harvest → Power down, read-only) and Looks (the claw fitted, no buttons).
`computer key "Escape"`: back to `{ kind: 'workshop' }`. Click the Mini's **Buy**: "Name your
robot" with a suggested name selected. `computer type "Pip"`, `computer key "Return"`.
```js
const s = __qa.state(); ({ deliveries: s.robots.deliveries, gold: s.player.gold, toast: __qa.snap(1).toasts })
```
Expect `deliveries: [{ size: 'mini', name: 'Pip' }]`, `gold: 17950`, the toast "Juniper will
deliver Pip tomorrow morning.", "1 / 12 robots", and "Sold out today" on the Mini's card.
Escape, then:
```js
__qa.sleep();
const toasts = __qa.snap(4).toasts;
__qa.tick(5);
const pip = __qa.robot('Pip');
({ toasts, deliveries: __qa.state().robots.deliveries, pip: { at: [pip.tx, pip.tz], size: pip.size, parts: pip.parts, power: pip.power, off: pip.off } })
```
Expect "Juniper delivered Pip. It's waiting by the workbench." after "Good morning",
`deliveries: []`, Pip a Mini with `parts: ['claw']` on a free tile beside (6,4) (not the
spawn), and `off: 'done'` (with Zone A unset, its morning stack powered it down at once).

## 3. On the bench: take the claw off, fit the watering head

```js
__qa.bench('Pip'); await __qa.key('KeyE'); __qa.state().ui.panel
```
Expect `{ kind: 'robot', robotId: <Pip's id>, mode: 'bench' }`. `find "Looks"` → click. The
Parts section: under "Fitted", Claw with **Take off**; under "From your backpack", Watering
head with **Fit**. Click **Take off**: "Empty slot", and the Claw moves to the backpack list.
Click **Fit** on the Watering head.
```js
const pip = __qa.robot('Pip'); ({ parts: pip.parts, tank: pip.tank, claw: __qa.state().inventory.slots.find((x) => x?.itemId === 'claw'), toasts: __qa.snap(2).toasts })
```
Expect `parts: ['wateringHead']`, `tank: 20`, a claw ×1 in the backpack, and the toasts "Took
the claw off Pip." and "Fitted a watering head to Pip." `computer key "Escape"`.

## 4. Order a Standard; the counter and the 12-robot cap

```js
__qa.patch((s) => { Object.assign(s.player, { mapId: 'town', tx: 24, tz: 8, facing: 0 }); });
await __qa.key('KeyE');
```
**Workshop**, then the Standard's **Buy**, keep the suggested name, **Buy for 4,000g**: the toast
names it and the counter reads "2 / 12 robots". Fill the cap with due deliveries (setup) and try
the Big:
```js
__qa.patch((s) => { for (let i = 0; i < 10; i++) s.robots.deliveries.push({ size: 'mini', name: `Filler${i}` }); });
```
The counter reads "12 / 12 robots". The Big's **Buy**, then **Buy for 10,000g**: the toast "The
farm already has 12 robots.", the checkout stays open and `robots.deliveries` still has 11
entries. Done with this farm.

## 5. Sold out, a reload, and the morning restock

From `?new`:
```js
const F = await __qa.fixtures();
__qa.load(F.withPlayer(F.withGold(F.withJobsDone(__qa.state(), 'knowTheLimits'), 5000), { tx: 21, tz: 8 }, 0, 'town'));
await new Promise((r) => setTimeout(r, 100));
await __qa.key('KeyE');
```
**Shop**, then **Buy** on the Tiller twice: the row shows "0 left" and "Out of stock" in place of
**Buy**. A third buy through the action:
```js
__meadowlight.store.dispatch(__meadowlight.actions.buyPart('tiller'));
({ toast: __qa.snap(1).toasts, gold: __qa.state().player.gold, sold: __qa.state().shopsSoldToday.parts.tiller })
```
Expect "Out of stock. Sol restocks tomorrow.", `gold: 4000`, `sold: 2`. Sell a tiller back:
the row still says "Out of stock". Escape, reload `http://localhost:5173/` **without** `?new`,
load the probe: `__qa.state().shopsSoldToday.parts.tiller` is still 2. Then `__qa.sleep()`:
it's 0. Back at Sol's (`__qa.patch` the player to town (21,8) facing north, E, **Shop**) the
Tiller row says "2 left"; Marigold's seed shop (from (7,8)) shows "30 left" on every row.

## 6. The shopfronts, Berlioz and Tallulah

From `?new`:
```js
const F = await __qa.fixtures(); __qa.load(F.withPlayer(__qa.state(), { tx: 22, tz: 11 }, 0, 'town'));
```
Zoom in (`KeyZ` ×3) and screenshot. The parts exchange: a stand by the door with a claw, a
watering head and a sensor eye, and a FarmClaw poster each side of the door ("Your farm. Our
claws." and "Genuine FarmClaw parts."), each with a claw picture. Juniper's workshop: a still
Mini (no lights, no sway) on a low stand beside the door, a FarmClaw "Robots built to order."
poster and a crate of planks and cogs. Nothing blocks a tile it didn't before: walk along z 7.
Then talk to Berlioz from (16,8) and Tallulah from (35,8): the boxes say "Berlioz" (Blacksmith)
with "Berlioz. Blacksmith. I sharpen tools and I don't do small talk." and "Tallulah" (Ranch)
with "Hi there, I'm Tallulah. Chickens, cows and wheat to feed them. Come see the ranch."
`read_console_messages {onlyErrors: true}` shows nothing from any check.
