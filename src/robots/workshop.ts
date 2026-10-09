/**
 * Juniper's robot workshop (farmclaws part 4b spec §4.2, §4.5): the ready-made range, one robot
 * per size with a claw and the harvester program, and the names the checkout suggests. Pure.
 */
import { TIME, WORKBENCH } from '../config';
import { hash32 } from '../core/hash';
import { Direction, type BlockProgram, type GameState, type Robot, type RobotPartId, type RobotSize } from '../core/types';
import { newRobot } from './create';

/** What every workshop robot comes with. */
export interface WorkshopRobot {
  readonly parts: readonly RobotPartId[];
  readonly program: BlockProgram;
}

/**
 * The harvester: when morning comes, for each tile in A, harvest; then power down. With Zone A
 * unset the loop does nothing and the robot powers down at once.
 */
const HARVESTER: BlockProgram = {
  kind: 'blocks',
  vars: [],
  stacks: [
    {
      trigger: { kind: 'morning' },
      body: [
        { kind: 'forEachTile', zone: 'A', body: [{ kind: 'do', action: { kind: 'harvest' } }] },
        { kind: 'do', action: { kind: 'powerDown' } },
      ],
    },
  ],
  helpers: [],
};

const READY_MADE: WorkshopRobot = { parts: ['claw'], program: HARVESTER };

/** The range, one robot per size; its price is the size's (ROBOTS.sizes[size].price), the claw included. */
export const WORKSHOP_ROBOTS: Readonly<Record<RobotSize, WorkshopRobot>> = { mini: READY_MADE, standard: READY_MADE, big: READY_MADE };

/** The names the checkout suggests, tried in order from a seeded start. */
export const WORKSHOP_NAMES: readonly string[] = [
  'Bolt',
  'Clover',
  'Rivet',
  'Turnip',
  'Sprocket',
  'Pebble',
  'Widget',
  'Bramble',
  'Gizmo',
  'Nutmeg',
  'Dynamo',
  'Thistle',
  'Cobble',
  'Ratchet',
  'Sorrel',
  'Gadget',
  'Puddle',
  'Tinker',
  'Barley',
  'Piston',
  'Fennel',
  'Nugget',
  'Dandelion',
  'Whirr',
];

/**
 * The checkout's suggested name (spec §4.5): from index hash32(seed, nextId + deliveries due),
 * wrapping, the first name no robot on the farm and no delivery due already has. The cap keeps
 * at least half the list free.
 */
export function suggestedName(state: GameState): string {
  const { list, deliveries, nextId } = state.robots;
  const used = new Set([...list.map((robot) => robot.name), ...deliveries.map((delivery) => delivery.name)]);
  const count = WORKSHOP_NAMES.length;
  const start = hash32(state.seed, nextId + deliveries.length) % count;
  for (let i = 0; i < count; i++) {
    const name = WORKSHOP_NAMES[(start + i) % count];
    if (name !== undefined && !used.has(name)) return name;
  }
  return WORKSHOP_NAMES[start] ?? 'Bolt';
}

/**
 * The workshop's `size` robot as a full Robot value, for the preview (spec §4.4): never stored,
 * so its id is 0 and it stands on the bench's home tile. Named after its size unless `name` is given.
 */
export function catalogueRobot(size: RobotSize, name = size.charAt(0).toUpperCase() + size.slice(1)): Robot {
  const place = { ...WORKBENCH.home, facing: Direction.South };
  return newRobot({ ...WORKSHOP_ROBOTS[size], name, size, place }, 0, TIME.dayStartMinute);
}
