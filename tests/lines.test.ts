/**
 * What the characters say (farmclaws part 4a spec §3.3, §3.5): the introduction first, whatever
 * the farm; each reactive line on its condition, in bank order, with `{name}` and `{season}`
 * filled; the everyday pick by spec §3.3's hash, the same all day and changing with the day; and
 * every bank's shape and text, verbatim.
 */
import { describe, expect, it } from 'vitest';
import { PEOPLE, TIME } from '../src/config';
import { hash32 } from '../src/core/hash';
import { NPC_IDS, Weather, type GameState, type NpcId, type NpcTalk, type RobotLogEntry, type RobotLogEvent } from '../src/core/types';
import { LINE_BANKS, REACTIVE_KINDS, lineFor, reactiveFill, type LineBank } from '../src/people/lines';
import { BASE, TARGET, atDay, benchedRobotOf, robotOf, stack, withRobots, withSlots } from './testUtils';

/** The day the reactive tests run on (spring). */
const DAY = 3;

const SAY: RobotLogEvent = { kind: 'did', action: 'say', detail: { kind: 'none' } };
const MOVE: RobotLogEvent = { kind: 'did', action: 'move', detail: { kind: 'none' } };

/** Everyone talked to `talks` times. */
function talkedTo(state: GameState, talks = 1): GameState {
  const npcs = Object.fromEntries(NPC_IDS.map((npc) => [npc, { talks, talkedToday: false }])) as Record<NpcId, NpcTalk>;
  return { ...state, npcs };
}

/**
 * A farm where no reactive line holds, on `day` at `minute`: everyone talked to once, one working
 * robot off the bench, the starter kit's parsnip seeds and no copper, sunny, and an empty log.
 */
function quiet(day = DAY, minute = 600): GameState {
  return { ...talkedTo(withRobots(atDay(BASE, day, minute), [robotOf()])), weather: Weather.Sunny };
}

/** `state` whose robot log holds one entry by robot 1 per `[day, event]`. */
function withLog(state: GameState, events: readonly (readonly [number, RobotLogEvent])[]): GameState {
  const entries: RobotLogEntry[] = events.map(([day, event], id) => ({
    id,
    day,
    minute: 600,
    robotId: 1,
    tx: TARGET.tx,
    tz: TARGET.tz,
    event,
    count: 1,
  }));
  return { ...state, robots: { ...state.robots, log: { nextId: entries.length, entries } } };
}

/**
 * Every reactive condition holding at once, except "no robots": four robots (Sprocket ruined,
 * Bolt broken, Gizmo on the bench), a Say today, no seeds, copper, and rain.
 */
function busy(): GameState {
  const robots = [
    robotOf({ id: 1, name: 'Sprocket', power: 'ruined' }),
    robotOf({ id: 2, name: 'Bolt', power: 'broken', tx: TARGET.tx - 1 }),
    benchedRobotOf({ id: 3, name: 'Gizmo' }),
    robotOf({ id: 4, name: 'Widget', tx: TARGET.tx + 1 }),
  ];
  const farm = withSlots(withRobots(quiet(), robots), [stack('hoe', 1), stack('copperOre', PEOPLE.copperOreLine)]);
  return { ...withLog(farm, [[DAY, SAY]]), weather: Weather.Rain };
}

/** The everyday line spec §3.3's formula picks for `npc` on `state`'s day. */
function everydayPick(state: GameState, npc: NpcId): string | undefined {
  const everyday = LINE_BANKS[npc].everyday;
  return everyday[hash32(state.seed, state.time.absoluteDay, NPC_IDS.indexOf(npc)) % everyday.length];
}

describe('lineFor', () => {
  it('opens with the introduction while talks is 0, even when a reactive line holds', () => {
    const fresh = talkedTo(busy(), 0);
    for (const npc of NPC_IDS) {
      expect(lineFor(BASE, npc)).toBe(LINE_BANKS[npc].introduction);
      expect(lineFor(fresh, npc)).toBe(LINE_BANKS[npc].introduction);
    }
  });

  it("says each character's first reactive line once they've been talked to", () => {
    const state = busy();
    expect(Object.fromEntries(NPC_IDS.map((npc) => [npc, lineFor(state, npc)]))).toEqual({
      sol: "Water and wires don't mix. Bring what's left of Sprocket to the bench.",
      cosmo: 'Your robot talked today! Mine talks every day. To the chickens. They love it, probably.',
      barnaby: "Four robots or more? Now you're thinking like me. Scale fixes everything.",
      marigold: "Out of seeds? I've got plenty for spring.",
      bram: "That's a fair bit of copper. Sprinklers don't build themselves.",
      juniper: 'Gizmo is up on your bench, I hear. A good bench is half the job.',
      tess: "Rain again. The cows don't mind, and neither do I.",
    });
  });
});

describe('reactive lines', () => {
  it('Sol names the lowest-id ruined robot, whatever the list order', () => {
    const state = withRobots(quiet(), [
      robotOf({ id: 3, name: 'Bolt', power: 'ruined' }),
      robotOf({ id: 2, name: 'Gizmo', power: 'ruined', tx: TARGET.tx - 1 }),
      robotOf({ id: 1, tx: TARGET.tx + 1 }),
    ]);
    expect(lineFor(state, 'sol')).toBe("Water and wires don't mix. Bring what's left of Gizmo to the bench.");
  });

  it('Sol names the lowest-id broken robot, whatever the list order', () => {
    const state = withRobots(quiet(), [
      robotOf({ id: 2, name: 'Gizmo', power: 'broken' }),
      robotOf({ id: 1, power: 'broken', tx: TARGET.tx - 1 }),
    ]);
    expect(lineFor(state, 'sol')).toBe("Sprocket took a swim? Fish it out today, or there won't be much to fix tomorrow.");
  });

  it("Sol's ruined line comes before his broken line", () => {
    const state = withRobots(quiet(), [
      robotOf({ id: 1, power: 'broken' }),
      robotOf({ id: 2, name: 'Bolt', power: 'ruined', tx: TARGET.tx - 1 }),
    ]);
    expect(lineFor(state, 'sol')).toBe("Water and wires don't mix. Bring what's left of Bolt to the bench.");
  });

  it('Cosmo notices a Say today', () => {
    expect(lineFor(withLog(quiet(), [[DAY, SAY]]), 'cosmo')).toBe(
      'Your robot talked today! Mine talks every day. To the chickens. They love it, probably.',
    );
  });

  it("Cosmo ignores yesterday's Say and today's other actions", () => {
    const state = withLog(quiet(), [
      [DAY - 1, SAY],
      [DAY, MOVE],
    ]);
    expect(lineFor(state, 'cosmo')).toBe(everydayPick(state, 'cosmo'));
  });

  it('Barnaby notices no robots', () => {
    expect(lineFor(withRobots(quiet(), []), 'barnaby')).toBe("No robots yet? You're leaving money in the field, friend.");
  });

  it('Barnaby notices PEOPLE.manyRobots robots or more', () => {
    const robots = Array.from({ length: PEOPLE.manyRobots }, (_, i) => robotOf({ id: i + 1, tx: i + 1 }));
    expect(lineFor(withRobots(quiet(), robots), 'barnaby')).toBe(
      "Four robots or more? Now you're thinking like me. Scale fixes everything.",
    );
  });

  it('Barnaby says an everyday line with one robot fewer', () => {
    const robots = Array.from({ length: PEOPLE.manyRobots - 1 }, (_, i) => robotOf({ id: i + 1, tx: i + 1 }));
    const state = withRobots(quiet(), robots);
    expect(lineFor(state, 'barnaby')).toBe(everydayPick(state, 'barnaby'));
  });

  it('Marigold notices no seeds, naming the season in lower case', () => {
    const seasons = ['spring', 'summer', 'fall', 'winter'];
    seasons.forEach((season, i) => {
      const state = withSlots(quiet(i * TIME.daysPerSeason), [stack('hoe', 1)]);
      expect(lineFor(state, 'marigold')).toBe(`Out of seeds? I've got plenty for ${season}.`);
    });
  });

  it('Marigold counts produce as no seeds', () => {
    const state = withSlots(quiet(), [stack('hoe', 1), stack('parsnip', 3)]);
    expect(lineFor(state, 'marigold')).toBe("Out of seeds? I've got plenty for spring.");
  });

  it('Marigold says an everyday line while any slot, the backpack included, holds seeds', () => {
    const state = withSlots(quiet(), [stack('hoe', 1), ...Array<null>(19).fill(null), stack('parsnip_seeds', 1)]);
    expect(state.inventory.slots[20]).toEqual(stack('parsnip_seeds', 1));
    expect(lineFor(state, 'marigold')).toBe(everydayPick(state, 'marigold'));
  });

  it('Bram notices PEOPLE.copperOreLine copper ore across slots', () => {
    const state = withSlots(quiet(), [stack('copperOre', 2), stack('hoe', 1), stack('copperOre', PEOPLE.copperOreLine - 2)]);
    expect(lineFor(state, 'bram')).toBe("That's a fair bit of copper. Sprinklers don't build themselves.");
  });

  it('Bram says an everyday line with one copper ore fewer', () => {
    const state = withSlots(quiet(), [stack('copperOre', PEOPLE.copperOreLine - 1)]);
    expect(lineFor(state, 'bram')).toBe(everydayPick(state, 'bram'));
  });

  it('Juniper names the robot on the workbench', () => {
    const state = withRobots(quiet(), [benchedRobotOf({ name: 'Gizmo' })]);
    expect(lineFor(state, 'juniper')).toBe('Gizmo is up on your bench, I hear. A good bench is half the job.');
  });

  it("Juniper fills a robot's name literally, $ signs and all", () => {
    const state = withRobots(quiet(), [benchedRobotOf({ name: "$& $' Co." })]);
    expect(lineFor(state, 'juniper')).toBe("$& $' Co. is up on your bench, I hear. A good bench is half the job.");
  });

  it('Tess notices rain and storms', () => {
    for (const weather of [Weather.Rain, Weather.Storm]) {
      expect(lineFor({ ...quiet(), weather }, 'tess')).toBe("Rain again. The cows don't mind, and neither do I.");
    }
  });

  it('Tess says an everyday line in snow', () => {
    const state = { ...quiet(), weather: Weather.Snow };
    expect(lineFor(state, 'tess')).toBe(everydayPick(state, 'tess'));
  });
});

describe('reactiveFill', () => {
  it('holds for nothing on the quiet farm', () => {
    for (const kind of REACTIVE_KINDS) expect(reactiveFill(quiet(), kind)).toBeNull();
  });

  it('gives each line only the values it uses', () => {
    const state = busy();
    expect(Object.fromEntries(REACTIVE_KINDS.map((kind) => [kind, reactiveFill(state, kind)]))).toEqual({
      robotRuined: { name: 'Sprocket' },
      robotBroken: { name: 'Bolt' },
      robotSaidToday: {},
      noRobots: null,
      manyRobots: {},
      noSeeds: { season: 'spring' },
      copperOre: {},
      robotOnBench: { name: 'Gizmo' },
      raining: {},
    });
  });
});

describe('everyday lines', () => {
  const WEEK = [0, 1, 2, 3, 4, 5, 6];

  it("are picked by spec §3.3's hash when no reactive line holds", () => {
    for (const day of WEEK) {
      const state = quiet(day);
      for (const npc of NPC_IDS) {
        const pick = everydayPick(state, npc);
        expect(pick).toBeDefined();
        expect(lineFor(state, npc)).toBe(pick);
      }
    }
  });

  it('stay the same all day', () => {
    const minutes = [TIME.dayStartMinute, 600, TIME.passOutMinute - TIME.clockStepMinutes];
    for (const npc of NPC_IDS) {
      const lines = new Set(minutes.map((minute) => lineFor(quiet(DAY, minute), npc)));
      expect(lines.size).toBe(1);
    }
  });

  it('change with the day', () => {
    const changes = NPC_IDS.some((npc) => new Set(WEEK.map((day) => lineFor(quiet(day), npc))).size > 1);
    expect(changes).toBe(true);
  });
});

describe('LINE_BANKS', () => {
  it('give everyone an introduction, PEOPLE.everydayLines everyday lines and known reactive kinds, each in one bank', () => {
    const used: string[] = [];
    for (const npc of NPC_IDS) {
      const bank = LINE_BANKS[npc];
      expect(bank.introduction).not.toBe('');
      expect(bank.everyday).toHaveLength(PEOPLE.everydayLines);
      expect(new Set(bank.everyday).size).toBe(PEOPLE.everydayLines);
      for (const line of bank.reactive) {
        expect(REACTIVE_KINDS).toContain(line.when);
        used.push(line.when);
      }
    }
    expect(used.sort()).toEqual([...REACTIVE_KINDS].sort());
  });

  it("hold spec §3.5's lines verbatim, reactive lines in the spec's order", () => {
    expect(LINE_BANKS).toEqual(SPEC_BANKS);
  });
});

/** Spec §3.5, copied line for line. */
const SPEC_BANKS: Readonly<Record<NpcId, LineBank>> = {
  sol: {
    introduction: 'Sol. I used to seed fields by hand; now I build the hands. When your robots need parts, this is the place.',
    reactive: [
      { when: 'robotRuined', text: "Water and wires don't mix. Bring what's left of {name} to the bench." },
      { when: 'robotBroken', text: "{name} took a swim? Fish it out today, or there won't be much to fix tomorrow." },
    ],
    everyday: [
      "A robot does exactly what you tell it. That's the good news and the bad news.",
      'I seeded this valley for twenty years. My robots do it in a morning, if I write them well.',
      "Most broken robots aren't broken. They're just obeying something nobody meant to say.",
      'Keep them near a generator at night. A flat robot is a very expensive lawn ornament.',
      "Half my old crew build robots now. The other half still won't talk to me.",
      'Start small. One robot, one job, one zone.',
    ],
  },
  cosmo: {
    introduction: "Hi! I'm Cosmo. My robot is the biggest one in the valley. It mostly says hello to the chickens.",
    reactive: [
      { when: 'robotSaidToday', text: 'Your robot talked today! Mine talks every day. To the chickens. They love it, probably.' },
    ],
    everyday: [
      "I bet robots can do loads of things. I just haven't asked mine to yet.",
      "Do you think the chickens know the robot's name? I think they do.",
      'My robot cost more than my house. Worth it. Look at it wave!',
      'Someone told me robots can harvest. Wild, right?',
      'I tried to read the program once. Too many blocks. I went to feed the chickens.',
      "Come by the farm sometime. Bring snacks. The robot can't eat them, but I can.",
    ],
  },
  barnaby: {
    introduction: "Barnaby. Four robots, one field, zero effort. That's the future, and I'm already living in it.",
    reactive: [
      { when: 'noRobots', text: "No robots yet? You're leaving money in the field, friend." },
      { when: 'manyRobots', text: "Four robots or more? Now you're thinking like me. Scale fixes everything." },
    ],
    everyday: [
      'Robots never get tired. Mine just get a bit flat in the afternoons.',
      "Measure it? Why measure it? You can see it's working. Mostly.",
      "My field's nearly harvested. It's been nearly harvested since Tuesday.",
      "The trick is more robots. If that doesn't work, even more robots.",
      "Tokens per crop? I don't do sums. I do vision.",
      "One day every farm will run itself. Mine's halfway there. Roughly.",
    ],
  },
  marigold: {
    introduction: "Welcome! I'm Marigold. Seeds, fertiliser, a bigger backpack one day. Shop with me any time.",
    reactive: [
      { when: 'noSeeds', text: "Out of seeds? I've got plenty for {season}." },
    ],
    everyday: [
      'Parsnips in spring, pumpkins in fall. Get the season right and the rest is watering.',
      'Fertiliser is worth every coin. Ask anyone with gold-star carrots.',
      'Rain saves you a watering. My favourite kind of weather.',
      'Cauliflower takes its time, but oh, the price.',
      "Strawberries keep giving. Plant them early and you'll be picking all spring.",
      'If something wilts, it was the season, not you. Mostly.',
    ],
  },
  bram: {
    introduction: "Bram. Blacksmith. I sharpen tools and I don't do small talk.",
    reactive: [
      { when: 'copperOre', text: "That's a fair bit of copper. Sprinklers don't build themselves." },
    ],
    everyday: [
      'A good tool outlives its owner.',
      "Rocks are just iron that hasn't met me yet.",
      "Copper's in the rocks out on your farm. Break enough and you'll find it.",
      "Hot forge, cold drink. That's my day.",
      "Robots? Sol's business. I make things that stay where you put them.",
      'Swing the pickaxe twice. Rocks are stubborn.',
    ],
  },
  juniper: {
    introduction: 'Juniper. I build barns, coops and anything with a hammer. Soon, robots too.',
    reactive: [
      { when: 'robotOnBench', text: '{name} is up on your bench, I hear. A good bench is half the job.' },
    ],
    everyday: [
      "Measure twice, cut once. Same goes for programs, I'd guess.",
      "Wood and stone. Bring me enough and I'll build you something that lasts.",
      'A coop keeps chickens dry. A barn keeps cows happy. Happy cows, happy farmer.',
      "Sol's been asking about my workbench designs. Watch this space.",
      'Every good fence starts with a straight line.',
      'If it creaks, it needs a nail. If it wobbles, it needs two.',
    ],
  },
  tess: {
    introduction: "Hi there, I'm Tess. Chickens, cows and wheat to feed them. Come see the ranch.",
    reactive: [
      { when: 'raining', text: "Rain again. The cows don't mind, and neither do I." },
    ],
    everyday: [
      'A chicken a day keeps the egg basket full.',
      'Cows like routine. Same time, same trough, every day.',
      "Wheat's the cheapest feed there is. Grow your own and save a fortune.",
      'Pet your animals. They notice.',
      "Cosmo's chickens are the best-greeted chickens in the valley.",
      'Big skies, quiet fields. Best job there is.',
    ],
  },
};
