# Farmclaws part 4c — the jobs playbook

The browser check for the part 4c spec §9, as short snippets. Load the probe after every
navigation (see SKILL.md). Each check starts from `?new`. Each fenced `js` block is one
`javascript_tool` call; lines naming `find`, `computer` or `get_page_text` are browser-pane tool
calls. The reference programs are the tests' own (`tests/jobSolutions.ts`); writing them by hand
on the robot screen is Eli's play. Talking spots: Sol from (21,8) facing north in town; Cosmo
(7,13) from (7,14) facing north and Barnaby (25,15) from (25,14) facing south on the Neighbours
map.

## 1. Job 1: take it from Sol, finish it with the reference program

```js
const F = await __qa.fixtures();
__qa.load(F.withPlayer(__qa.state(), { tx: 21, tz: 8 }, 0, 'town'));
await new Promise((r) => setTimeout(r, 100));
await __qa.key('KeyE'); __qa.state().ui.panel
```
Expect `{ kind: 'talk', npc: 'sol', line: <his introduction>, card: 'line' }` (from the second
chat on, the line is his hook, "I've got a robot that needs a home. Ask me about the job.").
`find "Job"` → click: the card says "The spinning robot", the offer, the
goal, **Take the job** and **Not now**. Click **Take the job**.
```js
const s = __qa.state(); const sp = __qa.robot('Sprinkle');
({ panel: s.ui.panel.kind, status: s.jobs.status, bed: s.jobs.bed, zoneA: s.robots.zones.A, sprinkle: [sp.tx, sp.tz, sp.facing, sp.parts], toast: __qa.snap(1).toasts })
```
Expect the chat closed, `spinningRobot: 'active'`, `bed: { tx: 6, tz: 6 }` with Zone A on it,
Sprinkle at (6,3) facing south with `['wateringHead']`, and "The spinning robot: job taken."
```js
const J = await __qa.mod('/tests/jobSolutions.ts'); const gold = __qa.state().player.gold;
__meadowlight.setProgram('Sprinkle', J.spinningRobotReference(__qa.state().jobs.bed));
__qa.sleep(); __qa.tick(180);
({ status: __qa.state().jobs.status, paid: __qa.state().player.gold - gold, tokens: __qa.robot('Sprinkle').tokens, toasts: __qa.snap(3).toasts })
```
Expect `spinningRobot: 'done'`, `showHim: 'offered'`, `paid: 500`, at least 40 tokens, and "Job
done: The spinning robot. Sol paid you 500g." then "Juniper's workshop is open."

## 2. Job 2: edit Wave where it stands in Cosmo's field

```js
const F = await __qa.fixtures();
__qa.load(F.withPlayer(F.withJobsDone(__qa.state(), 'spinningRobot'), { tx: 7, tz: 14 }, 0, 'neighbours'));
await new Promise((r) => setTimeout(r, 100));
await __qa.key('KeyE');
```
`find "Job"` → click → **Take the job**. Wave stands at (8,13) facing north, Cosmo's generator
at (10,13), and his field (x 4–9, z 6–11) is a parsnip checkerboard. Face Wave:
```js
__qa.patch((s) => { Object.assign(s.player, { tx: 8, tz: 14, facing: 0 }); });
await __qa.key('KeyE'); __qa.state().ui.panel
```
The hint said "Work on Wave"; expect `{ kind: 'robot', robotId: <Wave's id>, mode: 'job' }`.
Screenshot: Program and .MD editable, Looks with the parts read-only, Log there too, and no
switch, **Lift off**, **Scrap** or **Paint**. `computer key "Escape"`, then:
```js
const J = await __qa.mod('/tests/jobSolutions.ts');
__meadowlight.setProgram('Wave', J.SHOW_HIM_REFERENCE); __qa.sleep(); __qa.tick(360);
({ status: __qa.state().jobs.status, toasts: __qa.snap(4).toasts })
```
Expect `showHim: 'done'`, "Job done: Show him what it can do. Cosmo paid you 1000g." and "Sol's
parts shop is open." Facing Wave again now, E toasts "That's Cosmo's robot."

## 3. Job 3: watch Barnaby's team fail, then manage it

```js
const F = await __qa.fixtures();
__qa.load(F.withPlayer(F.withJobsDone(__qa.state(), 'showHim'), { tx: 25, tz: 14 }, 2, 'neighbours'));
await new Promise((r) => setTimeout(r, 100));
await __qa.key('KeyE');
```
`find "Job"` → click → **Take the job**: the toasts "Know the limits: job taken." and "Barnaby
marked his field as Zone H.", B-1 to B-4 in and around his field, his generator at (26,15).
Zoom out and screenshot the field: 6 sown rows, 2 bare. Watch B-1 poll through the day:
```js
__qa.tick(720);
const s = __qa.state(); ({ time: s.time.minuteOfDay, status: s.jobs.status.knowTheLimits, team: s.robots.list.filter((r) => r.owner === 'barnaby').map((r) => [r.name, r.tx, r.tz, r.power, r.tokens]) })
```
Expect 18:00, still `'active'`, and B-1 flat or far from done (Job → the progress line "{n} / 48
crops harvested today · {t} tokens spent." with n below 48). Now the reference:
```js
const J = await __qa.mod('/tests/jobSolutions.ts');
for (const [id, rect] of Object.entries(J.BARNABY_QUARTERS)) __meadowlight.setZone(id, rect);
for (const [name, zone] of Object.entries(J.BARNABY_ASSIGNMENT)) { __meadowlight.setProgram(name, J.knowTheLimitsReference(zone)); __meadowlight.setMd(name, []); }
__qa.sleep(); __qa.tick(360);
({ status: __qa.state().jobs.status, toasts: __qa.snap(4).toasts })
```
Expect `knowTheLimits: 'done'` and "Job done: Know the limits. Barnaby paid you 2000g." then
"Juniper now builds Standard and Big robots." Any "Barnaby dragged B-… back to the generator."
toast after the sleep is the night's rescue for a flat Mini.

## 4. The shop gates

From `?new`, talk to Juniper from (24,8) and Sol from (21,8) in town: Juniper's chat has no
**Workshop** button and Sol's has **Job** but no **Shop**. Then:
```js
const F = await __qa.fixtures();
__qa.load(F.withPlayer(F.withGold(F.withJobsDone(__qa.state(), 'spinningRobot'), 20000), { tx: 24, tz: 8 }, 0, 'town'));
await new Promise((r) => setTimeout(r, 100));
await __qa.key('KeyE');
```
**Workshop** is there: the Mini card has **Buy**, the Standard and Big cards say "After
Barnaby's job." Sol's chat (from (21,8)) still has no **Shop**. Repeat with `'showHim'`: Sol's
**Shop** opens; with `'knowTheLimits'`: all three workshop cards have **Buy**.
`read_console_messages {onlyErrors: true}` shows nothing from any check.
