/**
 * The two columns of a robot's log (farmclaws part 1 spec §8.3). "Robot says" is innocent and
 * always ends in ✓; "What happened" is the truth. Part 6 swaps in personality voices for the first.
 */
import type { MdCard, RobotActionKind, RobotBlockReason, RobotLogEntry, RobotLogEvent, Trigger } from '../core/types';
import { joinWithAnd, qualityPrefix } from '../core/text';
import { CROPS } from '../farming/crops';
import { formatClock } from '../time/clock';
import { mdCardText } from './md';

const SAYS: Readonly<Record<RobotActionKind, string>> = {
  move: 'Moved forward',
  turn: 'Turned',
  water: 'Watered',
  harvest: 'Harvested',
  till: 'Tilled',
  plant: 'Planted',
  refill: 'Topped up',
  deposit: 'Deposited',
  take: 'Picked up supplies',
  say: 'Said my piece',
  wait: 'Waited',
  powerDown: 'Powering down',
};

const VERB: Readonly<Record<RobotActionKind, string>> = {
  move: 'move',
  turn: 'turn',
  water: 'water',
  harvest: 'harvest',
  till: 'till',
  plant: 'plant',
  refill: 'refill',
  deposit: 'deposit',
  take: 'take something',
  say: 'speak',
  wait: 'wait',
  powerDown: 'power down',
};

const BLOCKED: Readonly<Record<RobotBlockReason, (verb: string) => string>> = {
  noPart: (verb) => `Tried to ${verb}, but it doesn't have the part for that.`,
  bumped: () => 'Bumped into something: nothing moved.',
  farmEdge: () => 'Reached the edge of the farm: nothing moved.',
  nothingToHarvest: () => 'Tried to harvest, but nothing was ready.',
  bagFull: () => 'Its bag was full, so nothing went in.',
  tankEmpty: () => 'Its water tank was empty: nothing got watered.',
  tankFull: () => 'Tried to refill a tank that was already full.',
  notTillable: () => "Tried to till ground that can't be tilled.",
  notWaterable: () => 'Tried to water, but there was no dry tilled soil there.',
  noSeed: () => 'Tried to plant, but had no seeds of that kind.',
  cannotPlant: () => 'Tried to plant where nothing can be planted.',
  outOfSeason: () => "Tried to plant a crop that won't grow this season.",
  noWaterAhead: () => 'Tried to refill with no water in front of it.',
  nothingAhead: () => "Reached for a chest or bin that isn't there.",
  bagEmpty: () => 'Tried to deposit with an empty bag.',
  containerFull: () => 'Nothing in its bag would go in.',
  itemNotFound: () => "Looked in the chest for something it doesn't hold.",
};

const DID: Readonly<Record<RobotActionKind, string>> = {
  move: 'Moved one tile.',
  turn: 'Turned on the spot.',
  water: 'Watered the soil.',
  harvest: 'Harvested.',
  till: 'Tilled the ground.',
  plant: 'Planted.',
  refill: 'Filled its water tank.',
  deposit: 'Deposited its bag.',
  take: 'Took from the chest.',
  say: 'Spoke up.',
  wait: 'Waited.',
  powerDown: 'Powered down.',
};

function listNames(ids: readonly number[], names: ReadonlyMap<number, string>): string {
  const list = ids.map((id) => names.get(id) ?? `robot ${id}`);
  return joinWithAnd(list, 'another robot');
}

/** The robot's own report: always a success, always ending in ✓. */
export function robotSays(entry: RobotLogEntry): string {
  const event = entry.event;
  switch (event.kind) {
    case 'did':
    case 'blocked':
      return `${SAYS[event.action]} ✓`;
    case 'bickered':
      return 'Waiting my turn ✓';
    case 'shortedOut':
      return 'Taking a swim ✓';
    case 'flat':
      return 'Resting ✓';
    case 'finished':
      return 'All done ✓';
    case 'poweredDown':
      return 'Powering down ✓';
    case 'repaired':
      return 'Good as new ✓';
    case 'skipped':
    case 'conflict':
      return 'Following my rules ✓';
    case 'dizzy':
      return 'Thinking very hard ✓';
    case 'gaveUp':
      return 'Took a scenic route ✓';
    case 'woke':
      return 'Up and at it ✓';
    case 'doReturn':
      return event.phase === 'started' ? 'Heading home ✓' : 'Home safe ✓';
    case 'doPowerDown':
      return 'Powering down ✓';
  }
}

/**
 * The trigger as the log names it (spec §11), e.g. "it's 2:00 pm", "my bag is full",
 * "every 15 minutes": the words after "Woke up:".
 */
export function triggerText(trigger: Trigger): string {
  switch (trigger.kind) {
    case 'morning':
      return 'morning came';
    case 'atTime':
      return `it's ${formatClock(trigger.minute, 1)}`;
    case 'bagFull':
      return 'my bag is full';
    case 'startsRaining':
      return 'it started raining';
    case 'every':
      return `every ${trigger.minutes} minutes`;
  }
}

/** What happened at each phase of a DO return. A failure names the likeliest reason from the card. */
function returnText(card: MdCard, phase: 'started' | 'arrived' | 'failed'): string {
  switch (phase) {
    case 'started':
      return `My .MD says ${mdCardText(card)}, so I stopped my program and set off.`;
    case 'arrived':
      return 'Got there and powered down for the day.';
    case 'failed': {
      const reason = card.kind === 'doReturn' && card.to.kind === 'generator' ? 'no generator I could reach' : 'no way through';
      return `Couldn't get there (${reason}), so powered down where I was.`;
    }
  }
}

function didText(event: Extract<RobotLogEvent, { readonly kind: 'did' }>): string {
  const d = event.detail;
  switch (d.kind) {
    case 'crop':
      return `Harvested ${qualityPrefix(d.quality)}${CROPS[d.cropId].name} ×${d.quantity}.`;
    case 'planted':
      return `Planted ${CROPS[d.cropId].name}.`;
    case 'items':
      if (d.into === 'bag') return `Took ${d.quantity} from the chest.`;
      return `Put ${d.quantity} ${d.quantity === 1 ? 'item' : 'items'} in the ${d.into === 'bin' ? 'shipping bin' : 'chest'}.`;
    case 'none':
    case 'tile':
      return DID[event.action];
  }
}

/** What really happened, in plain words. */
export function whatHappened(entry: RobotLogEntry, names: ReadonlyMap<number, string>): string {
  const event = entry.event;
  switch (event.kind) {
    case 'did':
      return didText(event);
    case 'blocked':
      return BLOCKED[event.reason](VERB[event.action]);
    case 'bickered':
      return `Fought ${listNames(event.withIds, names)} over the same tile. Nobody got it.`;
    case 'shortedOut':
      return 'Drove into the water and shorted out.';
    case 'flat':
      return 'Ran out of power.';
    case 'finished':
      return 'Finished its program and went to standby.';
    case 'poweredDown':
      return 'Powered down.';
    case 'repaired':
      return 'Came back from repairs.';
    case 'skipped':
      return `Skipped ${VERB[event.action]}: my .MD says don't ${mdCardText(event.card)}.`;
    case 'dizzy':
      return 'Looped without doing anything, and got dizzy. Off until morning.';
    case 'gaveUp':
      return `Couldn't find a way to (${event.target.tx}, ${event.target.tz}), so gave up going there.`;
    case 'woke':
      return `Woke up: ${triggerText(event.trigger)}.`;
    case 'doReturn':
      return returnText(event.card, event.phase);
    case 'doPowerDown':
      return `Powered down for the day: my .MD says ${mdCardText(event.card)}.`;
    case 'conflict':
      return `My .MD says ${mdCardText(event.doCard)}, but it also says don't ${mdCardText(event.dontCard)}. Don't wins.`;
  }
}
