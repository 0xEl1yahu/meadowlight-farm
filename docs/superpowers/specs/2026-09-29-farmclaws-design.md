# Meadowlight Farm: Farmclaws — design

This is the design for farmclaws: small farm robots the player programs with snap-together blocks. It reshapes the v2 plan (`docs/PLAN-v2.md`) around them. Section 10 lists what v2 keeps, changes and cuts.

This document is the umbrella design. Each build part in section 11 gets its own spec and plan before anything is built, and the parts ship to players in five releases (section 11.1). Where this document and a part spec disagree, the part spec wins for that part and this document is updated to match.

---

## 1. The idea

Meadowlight stays a cosy farming game. On top of it, the player buys, builds and programs farmclaws. Through them, and through the people in town, the game teaches adults how automation and AI agents actually behave: loops, conditions, types, messages, cost, limits, oversight and the difference between a confident report and a correct result.

**Who it's for:** adults who are curious about AI and agents and have never programmed. The language must never feel like a programming course.

**It works when:**

- A player who has never coded finishes the first three jobs without reading anything outside the game.
- A player can explain, in their own words, why a robot that says ✓ might still have done the wrong thing.
- Nothing in the running game uses an LLM. Robots are deterministic programs.
- A robot never surprises a player in a way the player can't trace back to their own program and .MD. The one exception is rage events, which announce themselves (section 3.8).
- A player learns that sensible-sounding instructions, carried out faithfully, can still go wrong (section 3.9).
- **A player who sets robots up well finds them dependable and clearly worth it** (section 2, "Do it well and it works well").

---

## 2. Ground rules

The v2 ground rules (`docs/PLAN-v2.md` section 1) all carry over: pure deterministic reducer, `hash32` / `hashFloat` for randomness, instanced flat-shaded rendering, strict TypeScript, no placeholders, generated audio and art, clean typecheck and tests, old saves keep working. These are added:

- **No LLM anywhere in the running game.** Robot speech comes from a pre-written line bank (section 7.4). The bank can be drafted with any tools, AI included, and is then edited by hand. The game ships only the finished text.
- **A robot does exactly what its program and .MD say.** Personality, paint, voice and quirks never change what a robot does, how long it takes or what it costs.
- **Every mistake is the player's instructions' mistake**, except for rage events (section 3.8). Rage events are rare, rolled from the save's seed, and loudly signposted. Nothing else is random. The same farm, programs and .MDs always produce the same result.
- **The game never freezes.** A runaway program can drain a robot, never the frame budget (section 5.4).

**Do it well and it works well.** This outranks every mistake in this design. The robots aren't comedically broken machines. They're faithful workers, and they're exactly as good as the instructions they get.

- **Good instructions give reliable, productive robots.** A robot with a sound program and a short, sensible .MD does its job every day without surprises.
- **Robots must clearly beat hand-farming at scale.** Otherwise Hollis is simply right. The balance target: a well-set-up farm of four Minis handles a field the player couldn't manage alone, earns more per day than the player working by hand, and frees the player's day for other things. Part 4's tuning pass checks this.
- **Nothing wears out.** Robots don't degrade, break down on their own or get worse over time. Every failure comes from the player's instructions, apart from rare rage events.
- **Mistakes are loud and fixable, never a trap with no way out.** The farm log always says what happened and which rule decided it, so a player who looks can always fix it.
- **The failures live mostly in the jobs.** The jobs deliberately set up broken programs, conflicting rules and bad setups to teach from. On the player's own farm, good habits make robots dependable: return to the generator, fence the zone, check the crop.
- **Good defaults help.** Ready-made programs from the workshop, and later from Sol's program library, work well out of the box. A player can succeed first and learn why afterwards.

---

## 3. Robots

### 3.1 What a robot is

A robot is an actor on the farm map. It performs a subset of the player's own actions using the same tile rules as the player's intents (`src/state/intents.ts`), so a robot can never do something the player couldn't do on that tile. It pays in tokens instead of energy.

Robot state (stored in the save):

- identity: `id`, `name` (chosen when bought), `size`
- body: `parts`, `paint`, `voice`, `personality`, `quirk`
- program: the block tree as data, plus the interpreter's frame stack and variables
- place: `tx`, `tz`, `facing`
- `bag`: item stacks, capacity set by size and parts
- `tokens`: current battery charge
- `power`: `working | standby | off | flat | broken`
- `md`: the Managing Directive, section 3.3
- `mailbox`: section 5.3
- `stats`: tokens used, actions taken, crops handled, today and this week

Robots work on the farm map only, and they keep working while the player is in town or the forest. They don't run while the player sleeps, because the night is skipped. **Robots stay where they finish.** Nothing brings a robot back unless its program does, and each morning its program starts again from wherever it stands. A program that doesn't return its robot drifts further every day. The farm holds at most 12 robots.

`Water`, `Harvest`, `Till` and `Plant` work the tile the robot stands on. `Refill`, `Deposit into` and `Take from` work the tile ahead.

Robots don't collide with each other or with the player. Two robots can stand on one tile, and the player walks through robots.

### 3.2 Built-in rules

These are always true. The player can't change them:

| Rule | What it means |
| --- | --- |
| Does exactly what it's told | Literal. It never guesses what you meant. |
| One action at a time | At most one action each time it's due to act (section 5.4). |
| Every action costs tokens | Including messages and waking up. |
| Can't rewrite its own program | Only the player edits programs. No block changes a program. |
| Never knows it made a mistake | Its speech always reports success. Only the farm log tells the truth (section 3.5). |

### 3.3 The Managing Directive (.MD)

Every robot has a **Managing Directive**, its `.MD`: standing rules the player writes, kept separate from its program.

- **The program is today's task**, like a prompt.
- **The .MD is standing policy**, like a `CLAUDE.md` or `AGENTS.md` file.

Teaching that difference is part of the point.

It looks like a little markdown file named after the robot, built from rule cards with dropdowns:

```
# SPROCKET.MD

## DO
- Return to [the wood burner ▾] at [6:00 pm ▾]
- Power down when [bag is full ▾]

## DON'T
- Leave [Zone A ▾]
- Go into [water ▾]
- Harvest [spectraherb ▾]
- Spend more than [60 ▾] tokens a day
```

**DON'T cards** are checked before every action. An action a DON'T forbids doesn't happen. It costs nothing, the program moves on to its next step, and the farm log records "Skipped: my .MD says don't {rule}".

| DON'T card | Forbids | Unlocked by |
| --- | --- | --- |
| Leave [zone ▾] | Any move off the zone's tiles | Job 1 |
| Go into [water ▾] | Any move onto a water tile | Job 1 |
| Harvest [crop ▾] | `Harvest` on that crop | Job 2 |
| Deposit [item ▾] | Depositing that item (it stays in the bag) | Job 2 |
| Use [action ▾] | That action entirely | Job 6 |
| Spend more than [n] tokens a day | Any action that would pass the budget; the robot then powers down | Job 6 |
| Work after [time ▾] | Any action after that time; the robot then powers down | Job 6 |

**DO cards** are standing orders. At their moment they take over from the program.

| DO card | What happens | Unlocked by |
| --- | --- | --- |
| Return to [tile ▾ / the nearest generator] at [time ▾] | At that time the robot stops its program, walks the shortest allowed path there, and powers down | Job 3 |
| Power down when [bag is full ▾ / tokens below n ▾ / it rains ▾] | The robot powers down the moment the condition holds | Job 3 |
| Deposit into [chest ▾] when bag is full | The robot walks to the chest, deposits, and returns to where it was | Job 5 |

**Precedence:** DON'T beats DO, and DO beats the program. A DO that can't be carried out without breaking a DON'T isn't carried out, and the log says why.

**Size:** the .MD holds 3 cards on a Mini, 6 on a Standard and 10 on a Big.

**How it's enforced:** the .MD is hard. A robot always obeys it, with one exception: rage events (section 3.8). Crop filters and stop conditions can also be written in the program. The .MD is where rules live that should hold whatever the program says.

### 3.4 Mistakes

Robots can make any mistake their program allows:

| Mistake | How it happens | What follows |
| --- | --- | --- |
| Walks into water | `Move forward` onto a water tile with no .MD rule about water and no check | The robot shorts out: `broken`, left sitting in the water |
| Bickers | Two robots act on the same tile in the same minute (section 5.4) | Both pay, neither succeeds, and both robots' speech flavours the clash |
| Spirals | A loop with no exit | It burns tokens until it goes `flat` |
| Harvests the wrong crop | `Harvest` takes whatever is ready unless the program checks the crop | The crop is harvested |
| Ships everything | `Deposit` into the shipping bin with no item check | Seeds and saved crops get sold |
| Out of season | A spring program still running in summer | It waters dead soil and wastes tokens |

**Recovery:**

Mistakes cost the player real work: **carrying costs energy and repairs cost gold.**

- **Carrying:** the player can pick up any robot, which costs energy (more for bigger robots). Picking a robot up also stops it, and putting it down resumes it. It's the emergency stop.
- **Broken:** the player fishes the robot out of the water, which is a pick-up and costs the same energy. They carry it to the shipping bin and send it for repair for 20% of its price. It's back, charged, in front of the bin the next morning; once the mechanic is hired (job 5), the same day. Robots are never lost for good.
- **Flat:** the robot stops where it is. It only recharges overnight if it's near a generator (section 4.2), so a robot stranded far away has to be carried back.
- **Blocked actions** (bag full, nothing to harvest, no water in the tank) still cost their tokens.

### 3.5 Speech and the farm log

Every robot has two channels:

- **Speech** (a bubble above the robot, and the "Robot says" column in its Log tab): always cheerful and always ✓, flavoured by personality. For example, "Harvested spectraherb ✓ You're welcome."
- **Farm log** (the "What happened" column): the true outcome, from the reducer. For example, "Harvested the spectraherb you planted from seed."

The Log tab shows both side by side, newest first, for the current and previous day. Identical consecutive entries collapse into one with a count (×7).

### 3.6 Sizes

| | Mini | Standard | Big |
| --- | --- | --- | --- |
| Price | 1,500g | 4,000g | 10,000g |
| Program blocks | 12 | 30 | 80 |
| Variables | 1 | 3 | 6 |
| Battery | 80 | 200 | 500 |
| Bag | 1 stack | 3 stacks | 9 stacks |
| Part slots | 1 | 2 | 3 |
| Token cost per action | ×1 | ×2 | ×4 |

Zones have no size cap. One Mini on an 8×8 zone is allowed; it just runs flat long before the field is done. That setup is the evangelist's (job 3). A bigger robot doesn't fix it: it has more battery but pays more for every action.

### 3.7 Parts

Parts unlock actions and abilities. A robot can only use an action if one of its parts provides it. `Move`, `Turn`, `Say`, `Wait` and `Power down` are built in.

| Part | Provides | Price |
| --- | --- | --- |
| Claw | `Harvest`, `Take from`, `Deposit into` | 300g |
| Watering head | `Water`, `Refill` (a 20-use tank, refilled from an adjacent water tile) | 400g |
| Tiller | `Till` | 500g |
| Seeder | `Plant` | 500g |
| Basket | +2 bag stacks | 350g |
| Antenna | `Send`, and the `When I receive` trigger | 600g |
| Sensor eye | The sensors `tile ahead is`, `it is raining` and `time is after` | 450g |
| Efficient core | −25% token cost, rounded down, minimum 1 | 1,500g |
| Quick core | Acts every 3 minutes instead of 4 | 1,500g |

Every robot from the workshop comes with a Claw in its first slot. Sol's starter Mini (job 1) comes with a Watering head instead.

### 3.8 Rage events

Every so often a robot snaps. It's a funny, rare event, and it's the one time a robot doesn't obey its .MD.

- **The chance:**
  - Each working robot has a small chance each day of raging, rolled from `hash32(seed, day, robotId)`, so the same save always rages the same way.
  - The chance starts at 2% a day for a robot with an empty .MD. Each different kind of DON'T card lowers it by half a point, down to 0.25%. It never reaches zero, but on a well-run farm it's rare: a funny event, not a burden.
  - At most one robot rages per day on the whole farm.
  - Rage events only start once job 6 is done. That job's finale triggers the first one.
- **What happens:**
  - At a seeded time between 9:00 and 16:00, the robot's eyes glow red and it bolts for the nearest farm gate, shouting **"I AM DOING AS I AM TOLD!"**
  - It leaves the farm and turns up at a seeded random spot in the forest or the town.
  - A toast tells the player where it went, for example "Sprocket's eyes went red and it bolted for the forest!"
  - There it runs amok, acting every 2 minutes at double token cost. It knocks forage about in the forest and tramples flowerbeds in town, and the townsfolk react. Once part 4 puts other farmers' fields on the map, it tears up their crops too.
- **Catching it:** the player has to rush over and pick it up, which costs the usual carry energy. The moment it's caught it says **"SORRY, THAT IS ON ME, I SHOULD HAVE LISTENED, MY FAULT."** Then it trudges back to the farm gate and carries on with its program as if nothing happened.
- **Not catching it:** it wanders back to the farm gate overnight, flat, and a day of its work is lost.
- **The lesson:**
  - The apology changes nothing: the next day's chance is exactly the same. Only a better .MD lowers it.
  - Guardrails cut the risk a lot but never to zero, so oversight still matters.
  - A hired supervisor (job 5) stops a raging robot at the farm gate before it gets away.

### 3.9 Faithful to a fault

A robot does exactly what it's told, including when what it's told sounds sensible and isn't. This is the limit of robots the game most wants adults to feel. The robot never lacks obedience; the instructions lack foresight.

This section is about the gap between instructions that sound good and instructions that are good. It isn't about robots being unreliable. Once the player closes that gap, the same robot works beautifully.

Every one of these comes from reasonable-looking instructions carried out perfectly:

| Instructions that sound fine | What the robot faithfully does |
| --- | --- |
| DON'T go into water. DO keep the watering head full. | It can never refill, so it waters until the tank is empty, then trundles over every dry tile doing nothing. |
| DON'T leave Zone A. The program deposits into a chest just outside the zone. | It can't reach the chest. Its bag fills, and every harvest after that fails. |
| DON'T spend more than 60 tokens a day, on a 12×12 field | It stops two-thirds of the way through every day, and the last third never gets watered. |
| DO power down when the bag is full, on a Mini with one bag stack | It powers down after the first harvest of a second crop type. |
| DO return to the wood burner at 6:00 pm | It leaves at 6:00 on the dot with a full bag and half a row unharvested. |
| "Harvest everything that's ready" | It harvests the pumpkin you were growing for the Claw Fair. |
| "Water every dry tile in Zone A" on a rainy morning | Nothing is dry. It finishes instantly and reports ✓. You forget to check, and the next dry day it's still switched to a rain-day program. |

- **Conflicts are resolved by the fixed precedence** (DON'T beats DO beats program), never by the robot using judgement. It has none.
- **The farm log always shows the rule** that decided each outcome. The player can always find out why, but only by looking.
- **Where it's taught:** these situations are built into the jobs, especially job 3 (Barnaby's rules), job 6 (Wendell's audit) and job 7, where the robot's faithfulness is itself one of the demonstrations.

## 4. Tokens and generators

### 4.1 Action costs

These costs are for a Mini, before the size multiplier:

| Action | Tokens |
| --- | --- |
| Sensing, `If`, maths, variables | 0 |
| `Wait` or `standby` | 0 |
| `Move`, `Turn`, `Deposit into`, `Take from`, `Say` | 1 |
| `Send`, `Refill` | 1 |
| Waking from standby | 1 |
| Each check of an `Every n minutes` schedule | 1 |
| `Water` | 2 |
| `Harvest`, `Plant` | 3 |
| `Till` | 5 |

### 4.2 The farm's token pool

Generators fill one farm-wide token pool, shown in the HUD next to gold. Each night, after generators run, every robot that isn't `broken` **and ends the day within 2 tiles of a generator** recharges from the pool up to its battery size, in robot order. Robots anywhere else don't recharge. If the pool runs short, later robots start the day partly charged. The pool has no cap.

### 4.3 Generators

Generators are placed objects. You load fuel by interacting while holding it, and they burn overnight.

| Generator | Built from | Burns per night (at most) | Makes |
| --- | --- | --- | --- |
| Wood burner | Crafted: 20 stone, 10 wood, 2 copper ore | 10 wood | 6 tokens per wood |
| Steam engine | Blacksmith: 3,000g, 5 copper ore | 8 wood + 2 water per wood | 25 tokens per wood |
| Sun panel | Blacksmith, after job 8: 6,000g, 10 copper ore | Nothing | 20 tokens on a sunny day, 6 on rain, half in winter |

**Water** for the steam engine comes from rain barrels. A rain barrel is a crafted placed object (30 wood, 5 fiber) that holds 40 water. It gains 20 on a rainy day and 2 on any other day. A steam engine draws from rain barrels within 2 tiles. Water is limited and tied to the weather, so using less of it matters.

The farm log records fuel burned each night. Job 8 is measured on it.

---

## 5. The language

### 5.1 How it looks

Programs are built from blocks in a Blockly-style editor: blocks snap together, and the fields inside them are dropdowns. Labels are plain English in sentence case. The editor's toolbox shows only unlocked blocks, and a counter shows blocks used against the robot's limit (for example, 7 / 12).

### 5.2 Blocks

**Triggers**: each program starts with one or more:

| Block | Wakes the robot | Unlocked by |
| --- | --- | --- |
| `When [morning ▾ / time ▾]` | At 6:00, or at a chosen time | Job 1 |
| `When bag is full` | The moment its bag fills | Job 3 |
| `When it starts raining` | When the weather turns | Job 3 |
| `When I receive [type ▾] from [robot ▾ / anyone]` | A message arrives | Job 5 |
| `Every [n ▾] minutes` | A repeating check that costs 1 token each time | Job 3 |

**Control:**

| Block | Unlocked by |
| --- | --- |
| `Repeat [n] times`, `Repeat until [condition]`, `Repeat forever` | Job 1 |
| `If [condition] … else …` | Job 2 |
| `For each tile in [zone ▾]`: goes to each tile of the zone in a fixed snake order, one `Move` action per step, and runs its inner blocks there | Job 2 |
| `Set [variable] to`, `Change [variable] by` | Job 4 |
| `Define helper [name]`, `Run helper [name]` | Job 4 |
| `Claim [tile]`: Yes if nobody else has claimed it today | Job 5 |

**Actions:**

| Block | Needs | Unlocked by |
| --- | --- | --- |
| `Move forward`, `Turn [left ▾ / right ▾]`, `Go to [tile]` (shortest path over walkable tiles) | built in | Job 1 |
| `Water`, `Refill` | Watering head | Job 1 |
| `Power down`, `Wait [n] minutes`, `Say [text]` | built in | Job 1 |
| `Harvest` | Claw | Job 2 |
| `Deposit into [chest ▾ / shipping bin]`, `Take [item ▾] from [chest ▾]` | Claw | Job 2 |
| `Till`, `Plant [seed ▾]` | Tiller / Seeder | Job 2 |
| `Send [value] to [robot ▾]` | Antenna | Job 5 |

**Sensors** (all Yes/No, and all free):

| Block | Needs | Unlocked by |
| --- | --- | --- |
| `crop is ready`, `soil is dry`, `tile is tilled`, `crop is [crop ▾]` | built in | Job 2 |
| `bag is full`, `bag has [item ▾]`, `at edge of [zone ▾]` | built in | Job 2 |
| `tokens below [n]` | built in | Job 3 |
| `tile ahead is [water ▾ / blocked ▾ / clear ▾]`, `it is raining`, `time is after [time]` | Sensor eye | Job 2 |

**Values:** number and text literals, `my tile`, `tile ahead`, `tokens left`, `count of [item ▾] in bag`, `message`, variables, `+ − ×` and comparisons.

### 5.3 Types and messages

There are five types: **Number**, **Text**, **Yes/No**, **Item** and **Tile**.

- Each type has its own socket shape and colour, and a block only fits a socket of its own type. Type errors show up as a block that won't snap in, so there are no type errors at runtime.
- Every variable has a type, fixed when it's created.
- A message carries one typed value. `When I receive [Item] from [anyone]` accepts only Item messages and puts the value in `message`.
- Each robot has a mailbox of 8 messages. A message arrives the minute after it's sent. If the mailbox is full, the oldest message is dropped and the farm log says so. That's a queue overflow, taught by accident.

### 5.4 How programs run

- Each robot acts every 4 in-game minutes, or every 3 with a Quick core. On a due minute, the interpreter runs the robot's program until it reaches one action block, then stops.
- **Step budget:** non-action blocks (conditions, maths, variables, loops) are free but capped at 50 per due minute. If a robot hits the cap without reaching an action, it gets dizzy: a spin animation, and it switches to `off` for the rest of the day. The farm log records "Looped without doing anything." This is the engine rule that keeps the game from freezing.
- **Resolution:** all robots due in the same minute choose their action first, in robot-id order. Then the actions are applied together. Two or more robots doing `Harvest`, `Water`, `Till` or `Plant` on the same tile in the same minute is a bicker (section 3.4).
- **Power:**
  - `working` runs the program.
  - `standby` waits for a trigger at no cost, and waking costs 1.
  - `off` ignores triggers until the player switches the robot on. This is a separate on/off switch, not a power state.
  - `flat` means 0 tokens.
  - `broken` means shorted out.
- When a program reaches its end, the robot goes to `standby`.
- A robot's action can't cost more tokens than it has. If it can't afford an action, it goes `flat` without acting.

---

## 6. The robot screen

The player interacts with a robot (E) to open its screen. It has five tabs:

| Tab | Contents |
| --- | --- |
| Program | The block editor with the unlocked toolbox and the block counter. **Test run** (after job 5) runs the program on a copy of the farm for one in-game hour and shows the result without changing anything. |
| .MD | The Managing Directive: DO and DON'T cards (section 3.3) |
| Looks | Paint, voice, personality and quirk (section 7) |
| Stats | Tokens used, actions, crops handled and tokens per crop, today and this week. Unlocked by job 3. |
| Log | Speech and farm log side by side (section 3.5) |

The zone tool (a new hotbar tool Sol gives you in job 1) paints named rectangular zones on the farm, A to H.

---

## 7. Looks and personality

Everything in this section is presentation only (section 2).

### 7.1 Paint

There are 16 base colours, 4 patterns (plain, stripes, spots, two-tone) and 8 decals. Limited editions add special finishes such as chrome, glow-in-the-dark trim and hand-painted flowers.

### 7.2 Voices

A procedural babble in the style of Animal Crossing, built on the Web Audio setup in `src/audio/music.ts`. There are 8 voice presets, each with its own pitch, speed and wobble. There are no recordings and no text-to-speech. Voices can be muted separately in settings.

### 7.3 Personalities

| Personality | How it talks | Where to get it |
| --- | --- | --- |
| Friendly | Warm, encouraging, pleased to help | Parts exchange |
| Fun facts | Tacks a real farming fact onto its reports | Parts exchange |
| Anxious | Worries about everything, including things it got right | Parts exchange |
| Opinionated | Has firm views on crops, weather and other robots | Parts exchange |
| Sassy | Dry, a little cheeky | Parts exchange |
| Dramatic | Every harvest is an epic | Limited editions only |
| Poetic | Speaks in little rhymes | Limited editions only |
| Sleepy | Yawns through its shift | Limited editions only |

Personality is where the lesson about tone lands. The same program gives the same field whatever the personality:
- a friendly tone is not competence
- confidence is not correctness
- an anxious robot's worry is not a warning

### 7.4 The line bank

- **Pre-written:** all robot speech is written ahead of time and shipped as data in `src/robots/lines/`, one file per personality.
- **Size:** every personality has at least 20 lines for each of these 16 situations, so at least 320 lines per personality:

  1. start of shift
  2. moved
  3. harvested
  4. watered
  5. tilled or planted
  6. deposited
  7. bag full
  8. bickered
  9. sent a message
  10. received a message
  11. low tokens
  12. flat
  13. powered down
  14. shorted out in water (innocent last words)
  15. idle
  16. greeting the player

- **Choosing a line:** `hash32(robotId, day, minute, situation)` picks a line deterministically.
- **Validation:** a test checks every personality and situation has at least 20 lines, no duplicates, and no line longer than 80 characters.
- **Fun facts:** the Fun facts personality draws from a separate list of at least 100 real farming facts. Each is checked before it's added.
- **Chatter limit:** a robot shows at most one speech bubble every 30 in-game minutes, plus every mistake-situation line. The Quiet setting hides bubbles and keeps the Log.

### 7.5 Quirks

A quirk is a small habit the robot shows while idle or between actions. Quirks are animation only: they never take an action slot or cost tokens. Each robot has one.

The 12 quirks are:
- hums while working
- spins when a job is done
- shelters from rain
- waves at the chickens
- stares at the pond
- counts the crops
- dances at sunrise
- polishes its claw
- follows butterflies with its eyes
- naps when idle
- tips an imaginary hat at the player
- bumps gently into the robot it just bickered with

Limited editions have exclusive quirks.

---

## 8. Jobs

Jobs replace the v2 quests and notice board. The first three run in a fixed order and teach the core ideas. When job 3 is done, jobs 4 to 8 open and can be done in any order. Each job has a giver, a setup, a success check that is a pure function of game state, and unlocks.

### Fixed path

**Job 1: The spinning robot.** Given by Sol at the parts exchange, who gives you your first Mini (with a Watering head) and the zone tool.
- **Setup:** its preloaded program is `When morning → Repeat forever → Turn right`. It spins on the spot and burns its whole battery.
- **Goal:** rewrite it to water a 3×3 bed and power down, with tokens left over.
- **Teaches:** sequence, repeat, stop conditions.
- **Unlocks:** the job 1 blocks, the .MD tab, and the DON'T cards "Leave [zone]" and "Go into [water]".
- **Mid-job beat:** Sol suggests `Move forward` to reach the bed. If the player hasn't written a DON'T, the robot drives into the pond, and Sol fishes it out for free this one time. Then he shows the player how to write their first .MD line.

**Job 2: Show him what it can do.** Given by Cosmo, the under-user.
- **Setup:** his Big robot runs `Repeat forever → Say "hello chickens"`.
- **Goal:** give it a program that harvests his field using at least one sensor and one `If`.
- **Teaches:** capabilities, sensors, conditions, parts.
- **Unlocks:** the job 2 blocks and the parts shop.
- **Payoff:** Cosmo is astonished it could do this all along.

**Job 3: Know the limits.** Given by Barnaby, the evangelist.
- **Setup:** his "team" is four Minis.
  - One works his whole 8×8 field on `Every 10 minutes`, runs flat by mid-morning, and takes days to finish.
  - The other three sit in standby waiting for a message nobody sends.
  - None of them has ever been told to come back, so they're scattered around his field, far from his generator, and never fully recharge.
  - His .MD is "DO return to the generator at 6:00 pm". That sounds sensible, but it makes them walk off mid-row every day (section 3.9).
- **Goal:** the whole field harvested by 18:00 in one day, at no more than 5 tokens per crop. Splitting the field into four zones and swapping polling for a morning trigger passes. Swapping in a Big robot fails on cost.
- **Teaches:** cost, measuring, splitting work, events versus polling, and that bigger isn't always better.
- **Unlocks:** the Stats tab, the job 3 blocks, the DO cards, and robot sizes at the robot workshop.
- **Payoff:** he learns what robots are bad at and claims he knew all along.

### Open

**Job 4: Untangle the mess.** Given by Ziggy, the chaos farmer.
- **Setup:** his Big robot's program uses 78 of its 80 blocks: copies of copies, loops inside loops, and blocks that undo each other.
- **Goal:** a program of 20 blocks or fewer that produces the same field. It's checked by replaying one day with each program and comparing the resulting farm state.
- **Teaches:** reading someone else's code, refactoring, helpers, variables.
- **Unlocks:** the job 4 blocks.

**Job 5: Jobs for the crew.** Given by Sol. His three former co-workers each need a new role, and each role is one step of the job:

| Step | Co-worker | Task | Role unlocked |
| --- | --- | --- | --- |
| 1 | Maple (was a waterer) | Test a program on one tile before running it on a field | **Tester**: Test run on the Program tab |
| 2 | Otto (was a harvester) | Build a two-robot line: a harvester sends Items to a shipper | **Supervisor**: hire for 100g a day |
| 3 | Rue (was a seeder) | Improve a ready-made program from the workshop | **Mechanic**: same-day repairs at half price |

Once the job is done, each co-worker can be hired or used in their role:
- **The supervisor** watches every robot on the farm and powers one down, with a note in the farm log, when it's about to:
  - move onto water
  - bicker a third time in a row
  - drop below 10% battery

  They also stop a raging robot at the farm gate before it gets away (section 3.8).

  The supervisor doesn't catch specification mistakes such as the wrong crop. Only the player's program can.
- **The spec-writer** role goes to Sol himself. It unlocks the workshop's program library of clean ready-made programs.

**Teaches:** messages, types, claims, the roles that grow up around automation.
**Unlocks:** the job 5 blocks and the Antenna.

**Job 6: Make them safe.** Given by Wendell, the protester.
- **Goal:** set up a robot whose .MD passes his audit:
  - DON'T spend more than a daily budget
  - DON'T leave its zone
  - DON'T use at least one action
  - a stop condition in the program
- **The catch:** his audit also asks for "DO keep the watering head full" alongside "DON'T go into water". The player has to notice that the two conflict (section 3.9) before the robot proves it.
- **Then:** answer his question from the Log, for example "What was it doing at 14:20?"
- **Finale:** the first rage event (section 3.8). A robot's eyes go red in front of Wendell and it bolts off the farm. The player chases it down, it apologises, and Wendell says "SEE?!". Then he admits the audited robot, the one with a good .MD, stayed put.
- **Teaches:** oversight, why guardrails matter, and why they're not enough on their own.
- **Unlocks:** the job 6 DON'T cards, and rage events from then on.

**Job 7: What they can't do.** Given by Wendell.
- **Goal:** three demonstrations in front of him:
  1. No program or .MD can send a robot off the farm: every tile dropdown is the farm. Wendell points out that raging robots leave anyway, which is the difference between what a robot can be told and what can happen.
  2. No block edits a program: robots can't change themselves.
  3. A robot at 0 tokens stops: no power, no action.
- **Fourth beat:** faithful to a fault (section 3.9). Wendell writes a robot's instructions himself, sensible ones, and watches it carry them out perfectly: it harvests the crop he was saving, reports ✓, and stops at his token budget with half the job undone. It did exactly what he said. It can't tell right from wrong, or what he meant from what he wrote, which is why you check.
- **Teaches:** where capability ends, and that faithful isn't the same as right.

**Job 8: Burning less.** Given by Wendell. This job runs across a season.
- **Goal:** cut the farm's fuel burned per crop harvested by half, compared with the week the job was accepted. It's measured weekly from the farm log.
- **Routes:**
  - leaner programs
  - standby instead of polling
  - Efficient cores
  - steam engines instead of wood burners
- **Teaches:** the resource cost of compute.
- **Unlocks:** the sun panel at the blacksmith.

When jobs 6, 7 and 8 are all done, Wendell's sign changes from **THEY'LL DESTROY US ALL** to **WATCH YOUR CLAWS**.

---

## 9. People and places

### 9.1 The farmclaw cast

They only chat. Their lines react to what's on the player's farm; for example, Wendell notices a flat robot left in a field. Lines are picked deterministically by day, like robot lines. None of them is the "correct" view. Each has a real point and a blind spot.

| Name | Stance | Real point | Blind spot | Jobs |
| --- | --- | --- | --- | --- |
| Cosmo | Under-user | Play is how you learn a tool | Pays Big-robot costs to wave at chickens | 2 |
| Hollis | Hand farmer | Handwork has value, and he's never out of tokens | Always tired, fields stay small | — |
| Barnaby | Evangelist | Automation really does scale | Never measures, blames the tool | 3 |
| Wendell | Protester | Unattended machines deserve attention | Doom about wheat | 6, 7, 8 |
| Sol | Seeder turned robot-builder | Deep knowledge of a trade makes the best automation | Not all his old crew made the jump | 1, 5 |
| Ziggy | Chaos farmer | Sometimes it works, and he's having fun | 100 crops and no idea what any robot is doing | 4 |

**Hand harvest:** crops the player harvests by hand get +5 percentage points on both silver and gold chance. This makes Hollis's point part of the mechanics.

### 9.2 Shops

| Place | Keeper | Sells / does |
| --- | --- | --- |
| General store | Marigold | Seeds, fertiliser, backpack upgrade (unchanged from v2) |
| Blacksmith | Bram | Tool upgrades, copper ore, steam engine, sun panel |
| Ranch | Tess | Chickens, cows, wheat (unchanged from v2) |
| Parts exchange | Sol | Parts, paint, voices, common personality cores, repairs. Release 1 opens it with basic parts and repairs; the Antenna comes in release 2, and cores, paint, voices and personality cores in release 3. |
| Robot workshop | Juniper (also still the carpenter) | Ready-made robots, custom robots and limited editions. Plus coop, barn, wood and stone from v2. Release 1 opens it with ready-made robots; custom robots and limited editions come in release 3. |

**At the parts exchange:**
- Parts sell back for 50%.
- A trade swaps one part for another and pays or charges the difference.

**At the robot workshop:**
- **Ready-made robots** come with a program already loaded, which the player can open and read before buying.
- **Custom robots:** pick size, parts, paint, voice, personality and quirk, pay the sum plus a 10% build fee, and the robot is delivered the next morning.
- **Limited editions:**
  - One is offered each Monday, chosen by `hash32(seed, week)`.
  - Each has a unique paint finish, plus a rare personality or exclusive quirk.
  - It's available that week only. Once bought, it's sold out.

### 9.3 Claw Fair

This replaces the four v2 festivals. It runs on day 14 of spring, summer and fall, from 9:00 to 22:00 in the town square.

- **Parade:** robots from around the valley parade the square.
- **Limited editions:** two are on sale.
- **Contest:** the Tidy Program contest. Enter a program; it's scored on the result in a test field divided by the blocks used. The prize is a trophy object and gold.

---

## 10. Changes to the v2 plan

| v2 section | Decision |
| --- | --- |
| Phase 0 foundations | Done. Kept. Save version goes from 3 to 4 for robots (section 12). |
| A Loose ends, B Feel, K Quality of life | Kept as written |
| C Farming depth | Kept. Sprinklers stay: they're the first, no-code automation. |
| D Crafting and materials | Done. Kept. Adds the wood burner and rain barrel recipes. |
| E Animals | Kept as written |
| F Forest and foraging | Kept. Old Fennick is removed from it. |
| G Cooking | Cut |
| H Town and people | The map and shops are kept. Friendship hearts, gifts and heart events are cut. Old Fennick and Pip are cut. Marigold, Bram, Juniper and Tess keep their shops and chat only. The farmclaw cast (section 9.1) is added. |
| I Quests | Replaced by jobs (section 8) |
| J Festivals | Replaced by the Claw Fair (section 9.3) |

---

## 11. Releases and build parts

The work is built in eight **parts**. Each part gets its own spec, plan and review before it's built. Parts ship to players in five **releases**. The robot parts come first because they're the new and risky work.

### 11.1 Releases

| Release | Parts | What players get |
| --- | --- | --- |
| **1. Your first farmclaw** | 1, 2, 3, 4 | Sol and his parts exchange (basic stock); robots in three sizes from Juniper's workshop; the robot screen with the block editor; the first .MD cards; the wood burner and the token pool; jobs 1 to 3 with Cosmo and Barnaby |
| **2. Teamwork** | 5 | Robots messaging each other, with types; triggers, schedules and claims; helper blocks and variables; Ziggy's untangle job (job 4); Sol's crew as tester, supervisor and mechanic (job 5); the program library |
| **3. Personality** | 6 | Paint, voices, the eight personalities and their line bank, fun facts, quirks; custom robots and weekly limited editions; the Claw Fair with its Tidy Program contest |
| **4. Guardrails** | 7 | Wendell's three jobs (6 to 8); the full .MD card set; rage events with the off-map chase; the steam engine, rain barrel and sun panel; Hollis and the hand-harvest bonus |
| **5. The valley** | 8 | The rest of v2: animals, forest foraging, town cleanup (cooking and friendship cut), loose ends, feel, the title screen and save slots, settings, touch and gamepad controls |

**Why release 1 is four parts.** Parts 1 to 3 have nothing a player can see: no robot reaches the player until Sol hands one over in part 4. Four parts is the smallest release that ships robots. It's also the whole first hour of the new game, so it stands on its own.

**Order:**
- **Releases 2 and 3 can swap.** Personality only needs release 1. Shipping it second gets the charm out sooner, and the coordination depth comes third.
- **Release 4 comes after release 2.** The supervisor, who stops rage events at the farm gate, comes with Sol's crew in release 2. Rage events with no way to contain them would be harsh.
- **Release 5 is mostly independent.** Animals and the quality-of-life features don't touch robots. They can be split off and shipped between robot releases for variety, or if the robot work stalls.

**Every release:**
- builds on the live game on `main`, which already has the v2 foundations: three maps, chests, sprinklers, crafting and music
- migrates live saves forward (section 12)
- passes a browser check of everything it adds, on desktop and phone width
- updates the README for players
- merges to `main`, gets a tag, and goes live on Vercel after you've played it

Release 1 also includes the balance pass for the "Do it well and it works well" target (section 2).

### 11.2 Parts

| Part | Release | Contents | Playable result |
| --- | --- | --- | --- |
| 1 Robot core | 1 | Robot state, save v4, token pool, wood burner, robot actions through the player's tile rules, token costs, mistakes, carrying and repairs, farm log, robot rendering. Robots run fixed scripted action lists in this part; the interpreter replaces them in part 2. | Scripted robots work, fail and recover on the farm (development builds only). |
| 2 Language | 1 | Block tree format, typed values, the interpreter, step budget, resolution and bickering, and .MD enforcement (DON'T checks, DO orders, precedence) | Any program and .MD run deterministically. Tested without UI. |
| 3 Robot screen | 1 | Blockly-style editor, the five tabs including the .MD card editor, zone tool | The player writes programs and .MDs (development builds only). |
| 4 First jobs and shops | 1 | Jobs framework, jobs 1 to 3, Sol, Cosmo and Barnaby, the Stats tab. The parts exchange with basic stock (claw, watering head, tiller, seeder, basket, sensor eye) and repairs. Juniper's workshop with ready-made robots in all three sizes. The balance pass. **Also decides where other farmers' fields are**: this design hasn't put them on a map yet. | The first hour of the new game, shippable |
| 5 Coordination | 2 | Messages, mailboxes, claims, triggers, schedules, power states, the Antenna. Job 4 (Ziggy) and job 5 (Sol's crew): tester and Test run, supervisor, mechanic, program library. | Multi-robot farms |
| 6 Character | 3 | Paint, voices, personalities, line bank, fun facts, quirks, the efficient and quick cores, custom robots, limited editions, the Claw Fair | Robots with character |
| 7 Guardrails | 4 | Jobs 6 to 8, Wendell and Hollis, the full .MD card set, rage events (robots on other maps, the chase and the catch), steam engine, rain barrel, sun panel, the hand-harvest bonus | The full curriculum |
| 8 The valley | 5 | Animals, forest changes, town cleanup and cuts, loose ends, feel, quality of life | The finished game |

**The editor library** is decided in the part 3 spec. The default is Google Blockly, loaded only when the robot screen first opens, because it already does typed sockets, dropdown fields and keyboard access. Part 3 measures its size against the build and replaces it with a small custom editor only if it misses the size budget set in that spec.

---

## 12. Save versions

Each part that adds saved fields bumps the save version by one and adds one migration step that fills in empty defaults. Part 1 is version 4: robots, the token pool, the farm log and the wood burner. A release can therefore carry several version steps, and the loader runs them in order, so a live save from any earlier release loads. Part 8's migration also drops the cut v2 fields (friendship, gifts, cooking recipes).

---

## 13. Testing

- **The interpreter is pure.** Each block has unit tests. The step budget, resolution order, bickering, type rules and mailbox overflow each have tests.
- **Determinism:** the existing `tests/determinism.test.ts` extends to robots. The same seed and programs must give the same state hash after 7 in-game days.
- **Jobs:** every job's success check is a pure function, tested against a passing and a failing farm.
- **Job 4's replay comparison** has its own tests.
- **The line bank validation test** is described in section 7.4.
- **The browser check** at the end of each part plays that part's result on the preview link.

---

## 14. Risks

- **Size.** This is bigger than v2 as planned. The build order front-loads the risky parts, and every release after the first is a complete game, so the work can stop after any release with something worth playing. Release 1 is the big one, because nothing is playable before part 4.
- **The editor.** Blockly's size and styling in a Three.js game is the biggest technical unknown. It's contained in part 3, which has a fallback.
- **Tone.** The cast must never preach or mock. Serious AI safety concerns aren't a joke. Wendell's framing is comic, but the game proves his underlying point. Every NPC line gets a tone review.
- **Line bank quality.** Over 2,500 lines is a lot of writing. Lines are drafted in batches per personality, and each batch is reviewed before it ships.
- **Balance.** Prices, costs and generator outputs are first guesses. Plan a tuning pass after playing.

---

## 15. Calls made here that weren't discussed

These are decided in this document so it has no gaps. Each is easy to change in review:

1. **Names:** Cosmo, Hollis, Barnaby, Wendell, Sol, Ziggy, and Sol's crew Maple, Otto and Rue.
2. **Shopkeepers:** Juniper runs the robot workshop alongside carpentry. Sol runs the parts exchange.
3. **Cast cuts:** Old Fennick and Pip are cut. Marigold, Bram, Juniper and Tess stay as shopkeepers who chat.
4. **Hollis has no job.** An optional "A day by hand" job, where you farm a day for him with no robots, could be added.
5. **Hand harvest** gets +5 points on silver and gold.
6. **Water for generators** comes from rain barrels.
7. **Robots don't work at night:** the night is skipped, as it is for the player.
8. **At most 12 robots** on the farm.
9. **The Claw Fair** runs in spring, summer and fall (not winter) and has a Tidy Program contest.
10. **Blockly** is the default editor, loaded when the robot screen first opens.
11. **Numbers:** all prices, battery sizes and generator outputs are first guesses.
