/**
 * The two columns of a robot's log (farmclaws part 1 spec §8.3). "Robot says" is innocent and
 * always ends in ✓; "What happened" is the truth. Part 6 swaps in personality voices for the first.
 */
import type { RobotActionKind, RobotBlockReason, RobotLogEntry, RobotLogEvent } from '../core/types';
import { joinWithAnd, qualityPrefix } from '../core/text';
import { CROPS } from '../farming/crops';

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
  }
}
