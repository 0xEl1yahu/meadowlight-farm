/**
 * What the characters say (farmclaws part 4a spec §3.3, §3.5): each character's introduction,
 * the lines that react to the farm and the everyday lines, and which one a chat shows. Pure: the
 * line is a function of the state, so a character says the same thing all day unless the farm
 * changes a reactive condition.
 */
import { PEOPLE } from '../config';
import { hash32 } from '../core/hash';
import { defined } from '../core/invariant';
import { NPC_IDS, SEASON_NAMES, type GameState, type NpcId, type Robot, type RobotPower } from '../core/types';
import { getItem } from '../items/items';
import { robotOnBench } from '../robots/workbench';
import { countItem } from '../state/inventory';
import { weatherWaters } from '../time/weather';

/** The farm conditions a reactive line answers (spec §3.5's table). */
export const REACTIVE_KINDS = [
  'robotRuined',
  'robotBroken',
  'robotSaidToday',
  'noRobots',
  'manyRobots',
  'noSeeds',
  'copperOre',
  'robotOnBench',
  'raining',
] as const;
export type ReactiveKind = (typeof REACTIVE_KINDS)[number];

/** What a reactive line fills in: `{name}` (a robot's name) and `{season}` (the season's name in lower case). */
export interface LineFill {
  readonly name?: string;
  readonly season?: string;
}

/** One character's lines (spec §3.3). */
export interface LineBank {
  /** The first chat's line. */
  readonly introduction: string;
  /** Tried in order; the first whose condition holds is said. */
  readonly reactive: readonly { readonly when: ReactiveKind; readonly text: string }[];
  /** PEOPLE.everydayLines lines; the day's one is picked by hash. */
  readonly everyday: readonly string[];
}

/** Every character's lines, verbatim from spec §3.5. */
export const LINE_BANKS: Readonly<Record<NpcId, LineBank>> = {
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
  berlioz: {
    introduction: "Berlioz. Blacksmith. I sharpen tools and I don't do small talk.",
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
  tallulah: {
    introduction: "Hi there, I'm Tallulah. Chickens, cows and wheat to feed them. Come see the ranch.",
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

/** A condition that holds with nothing to fill. */
const HOLDS: LineFill = {};

/** Null when `when` doesn't hold on this farm, else the values its line fills in (spec §3.5's table). */
export function reactiveFill(state: GameState, when: ReactiveKind): LineFill | null {
  switch (when) {
    case 'robotRuined':
      return nameOf(lowestIdWith(state, 'ruined'));
    case 'robotBroken':
      return nameOf(lowestIdWith(state, 'broken'));
    case 'robotSaidToday':
      return state.robots.log.entries.some(
        (entry) => entry.day === state.time.absoluteDay && entry.event.kind === 'did' && entry.event.action === 'say',
      )
        ? HOLDS
        : null;
    case 'noRobots':
      return state.robots.list.length === 0 ? HOLDS : null;
    case 'manyRobots':
      return state.robots.list.length >= PEOPLE.manyRobots ? HOLDS : null;
    case 'noSeeds':
      return state.inventory.slots.some((slot) => slot !== null && getItem(slot.itemId).kind === 'seed')
        ? null
        : { season: SEASON_NAMES[state.time.season].toLowerCase() };
    case 'copperOre':
      return countItem(state.inventory, 'copperOre') >= PEOPLE.copperOreLine ? HOLDS : null;
    case 'robotOnBench':
      return nameOf(robotOnBench(state));
    case 'raining':
      return weatherWaters(state.weather) ? HOLDS : null;
  }
}

/**
 * The line `npc` says today (spec §3.3): the introduction until the first chat is recorded, then
 * the first reactive line whose condition holds, else the day's everyday line. Pick it before the
 * chat is recorded, so the first chat shows the introduction.
 */
export function lineFor(state: GameState, npc: NpcId): string {
  const bank = LINE_BANKS[npc];
  if (state.npcs[npc].talks === 0) return bank.introduction;
  for (const line of bank.reactive) {
    const fill = reactiveFill(state, line.when);
    if (fill !== null) return filledIn(line.text, fill);
  }
  const index = hash32(state.seed, state.time.absoluteDay, NPC_IDS.indexOf(npc)) % bank.everyday.length;
  return defined(bank.everyday[index], `${npc} has an everyday line ${index}`);
}

/** The robot with `power` and the lowest id. The list is kept in id order, but this doesn't rely on it. */
function lowestIdWith(state: GameState, power: RobotPower): Robot | null {
  let lowest: Robot | null = null;
  for (const robot of state.robots.list) {
    if (robot.power === power && (lowest === null || robot.id < lowest.id)) lowest = robot;
  }
  return lowest;
}

/** The fill naming `robot`, or null (the condition doesn't hold) without one. */
function nameOf(robot: Robot | null): LineFill | null {
  return robot === null ? null : { name: robot.name };
}

/** `text` with its placeholders filled in. A function replacer keeps a `$` in a robot's name literal. */
function filledIn(text: string, fill: LineFill): string {
  const { name, season } = fill;
  let line = text;
  if (name !== undefined) line = line.replace('{name}', () => name);
  if (season !== undefined) line = line.replace('{season}', () => season);
  return line;
}
