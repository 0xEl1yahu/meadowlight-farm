/**
 * Save version 9 (farmclaws part 4c spec §7): robots gain a map and an owner, zones a map, and the
 * jobs section arrives. The v8 → v9 migration, round trips mid-job with the neighbours' robots, and
 * one corrupted field per validation rule.
 */
import { describe, expect, it } from 'vitest';
import { ROBOTS } from '../src/config';
import { Direction, JOB_IDS, SAVE_VERSION, type GameState, type JobsState, type Robot, type RobotDelivery, type ZoneRect } from '../src/core/types';
import { ROBOT_CAP_RULE, addRobot, newRobot, type RobotSpec } from '../src/robots/create';
import { requireRobot } from '../src/robots/world';
import { createDefaultSections } from '../src/state/initialState';
import { deserializeGame, isValidGameState, migrateSave, serializeGame } from '../src/state/persistence';
import { getTile, isWalkable } from '../src/world/tiles';
import saveV2Text from './fixtures/save-v2.json?raw';
import { BASE, must, robotOf, v8Save, withMigratedJobs, withRobots, withZones, type SaveJson } from './testUtils';

/** Lane tiles on the Neighbours map (z 13–15), open ground for the neighbours' robots. */
const LANE_WEST = { tx: 8, tz: 13 };
const LANE_EAST = { tx: 20, tz: 14 };
/** A corner of the fence ring round Cosmo's field: not walkable. */
const COSMO_FENCE_CORNER = { tx: 3, tz: 5 };

const COSMO_FIELD_ZONE: ZoneRect = { mapId: 'neighbours', x0: 4, z0: 6, w: 6, d: 6 };
const BED_ZONE: ZoneRect = { mapId: 'farm', x0: 3, z0: 9, w: 3, d: 3 };

/** Cosmo's Big robot on the lane, as job 2 sets it up. */
const wave = (overrides: Partial<Robot> = {}): Robot =>
  robotOf({ id: 2, name: 'Wave', size: 'big', mapId: 'neighbours', owner: 'cosmo', parts: ['claw', 'basket', 'sensorEye'], tokens: 200, facing: Direction.North, ...LANE_WEST, ...overrides });

/** One of Barnaby's Minis on the lane. */
const b1 = (overrides: Partial<Robot> = {}): Robot =>
  robotOf({ id: 3, name: 'B-1', mapId: 'neighbours', owner: 'barnaby', ...LANE_EAST, ...overrides });

/** Mid-job: job 1 done with its bed, job 2 active with its field set up today, the neighbours' robots out and zones on both maps. */
function midJob(): GameState {
  const jobs: JobsState = {
    status: { spinningRobot: 'done', showHim: 'active', knowTheLimits: 'locked' },
    bed: { tx: 3, tz: 9 },
    rescued: true,
    fieldDay: BASE.time.absoluteDay,
  };
  const robots = withRobots(BASE, [robotOf({ name: 'Sprinkle', parts: ['wateringHead'] }), wave(), b1()]);
  return { ...withZones(robots, { A: BED_ZONE, H: COSMO_FIELD_ZONE }), jobs };
}

/** `state` with these robots ordered from Juniper's workshop. */
function withDeliveries(state: GameState, deliveries: readonly RobotDelivery[]): GameState {
  return { ...state, robots: { ...state.robots, deliveries } };
}

/** `count` player Minis on distinct farm tiles of the clear ground south of the house. */
const playerMinis = (count: number): Robot[] =>
  Array.from({ length: count }, (_, i) => robotOf({ id: i + 1, name: `Mini ${i + 1}`, tx: 2 + (i % 6) * 2, tz: 10 + Math.floor(i / 6) * 2 }));

const robotsOf = (save: SaveJson) => save.robots as SaveJson & { list: SaveJson[]; zones: Record<string, SaveJson | null> };

/** Loads raw save JSON as the game would. */
const load = (save: SaveJson): GameState | null => deserializeGame(JSON.stringify(save));
const valid = (state: GameState): boolean => isValidGameState(JSON.parse(serializeGame(state)));

describe('save version 9', () => {
  it('is the current version, and new games start in it', () => {
    expect(SAVE_VERSION).toBe(9);
    expect(BASE.version).toBe(9);
  });

  it('starts a new game with job 1 offered and the others locked, no bed, no rescue and no field', () => {
    expect(JOB_IDS).toEqual(['spinningRobot', 'showHim', 'knowTheLimits']);
    expect(BASE.jobs).toEqual({ status: { spinningRobot: 'offered', showHim: 'locked', knowTheLimits: 'locked' }, bed: null, rescued: false, fieldDay: -1 });
  });

  it("gives a robot added or built with no map or owner the player's farm", () => {
    const spec: RobotSpec = { name: 'Bolt', size: 'mini', parts: ['claw'], place: { tx: 5, tz: 10, facing: Direction.South }, program: robotOf().program };
    const added = addRobot(BASE, spec);
    if ('error' in added) throw new Error(added.error);
    expect(requireRobot(added.state, added.id)).toMatchObject({ mapId: 'farm', owner: 'player' });
    expect(newRobot({ ...spec, mapId: 'neighbours', owner: 'barnaby', place: { ...LANE_EAST, facing: Direction.North } }, 9, 360)).toMatchObject({ mapId: 'neighbours', owner: 'barnaby', ...LANE_EAST });
  });

  it("round-trips a farm mid-job, with the neighbours' robots on the Neighbours map and zones on both maps", () => {
    const state = midJob();
    for (const at of [LANE_WEST, LANE_EAST]) expect(isWalkable(must(getTile(state.maps.neighbours, at.tx, at.tz)))).toBe(true);
    expect(deserializeGame(serializeGame(state))).toEqual(state);
  });

  it('round-trips every job finished', () => {
    const state: GameState = { ...midJob(), jobs: { ...midJob().jobs, status: { spinningRobot: 'done', showHim: 'done', knowTheLimits: 'done' }, fieldDay: -1 } };
    expect(deserializeGame(serializeGame(state))).toEqual(state);
  });
});

describe("the cap counts only the player's robots", () => {
  it("holds the player's robots and deliveries to the cap, whatever the neighbours have", () => {
    const full = withRobots(BASE, [...playerMinis(ROBOTS.maxRobots - 1), wave({ id: 20 }), b1({ id: 21 })]);
    expect(valid(withDeliveries(full, [{ size: 'mini', name: 'Last' }]))).toBe(true);
    expect(valid(withDeliveries(full, [{ size: 'mini', name: 'Last' }, { size: 'mini', name: 'Over' }]))).toBe(false);
    expect(valid(withRobots(BASE, [...playerMinis(ROBOTS.maxRobots), wave({ id: 20 })]))).toBe(true);
    expect(valid(withRobots(BASE, [...playerMinis(ROBOTS.maxRobots + 1)]))).toBe(false);
  });

  it("lets addRobot add a neighbour's robot to a full farm, but not one more of the player's", () => {
    const full = withRobots(BASE, playerMinis(ROBOTS.maxRobots));
    const program = robotOf().program;
    const mine: RobotSpec = { name: 'Over', size: 'mini', parts: ['claw'], place: { tx: 5, tz: 16, facing: Direction.South }, program };
    expect(addRobot(full, mine)).toEqual({ error: ROBOT_CAP_RULE });
    const theirs: RobotSpec = { ...mine, name: 'B-2', mapId: 'neighbours', owner: 'barnaby', place: { ...LANE_EAST, facing: Direction.North } };
    expect('state' in addRobot(full, theirs)).toBe(true);
  });

  it("places a neighbour's robot on the Neighbours map's open ground, and pairs each owner with their map", () => {
    const program = robotOf().program;
    const theirs: RobotSpec = { name: 'Wave', size: 'mini', parts: ['claw'], mapId: 'neighbours', owner: 'cosmo', place: { ...COSMO_FENCE_CORNER, facing: Direction.North }, program };
    expect(addRobot(BASE, theirs)).toEqual({ error: 'Robots are delivered to open ground on the Neighbours map.' });
    const pairing = "The player's robots live on the farm, and the neighbours' on the Neighbours map.";
    expect(addRobot(BASE, { ...theirs, owner: 'player', place: { ...LANE_WEST, facing: Direction.North } })).toEqual({ error: pairing });
    expect(addRobot(BASE, { ...theirs, mapId: 'farm', place: { tx: 5, tz: 10, facing: Direction.North } })).toEqual({ error: pairing });
  });
});

/** A farm a v8 save can hold: two of the player's robots and a farm zone. */
function midJobOnFarm(): GameState {
  const robots = withRobots(BASE, [robotOf({ name: 'Sprinkle', parts: ['wateringHead'] }), robotOf({ id: 2, name: 'Bolt', tx: 4, tz: 10 })]);
  return withZones(robots, { A: BED_ZONE });
}

describe('v8 → v9', () => {
  it('writes version 9', () => {
    expect((migrateSave(v8Save(withMigratedJobs(midJobOnFarm()))) as SaveJson).version).toBe(9);
  });

  it("puts every robot on the farm as the player's, and every zone on the farm", () => {
    const state = withMigratedJobs(midJobOnFarm());
    const save = v8Save(state);
    for (const robot of robotsOf(save).list) expect(robot).not.toHaveProperty('mapId');
    expect(robotsOf(save).zones.A).toEqual({ x0: 3, z0: 9, w: 3, d: 3 });
    const migrated = migrateSave(save) as SaveJson;
    expect(robotsOf(migrated).list.map((robot) => [robot.mapId, robot.owner])).toEqual([
      ['farm', 'player'],
      ['farm', 'player'],
    ]);
    expect(robotsOf(migrated).zones.A).toEqual({ x0: 3, z0: 9, w: 3, d: 3, mapId: 'farm' });
    expect(robotsOf(migrated).zones.B).toBeNull();
    expect(must(load(save))).toEqual(state);
  });

  it('counts job 1 done and offers job 2 for a farm with any robot', () => {
    const migrated = must(load(v8Save(withMigratedJobs(midJobOnFarm()))));
    expect(migrated.jobs).toEqual({ status: { spinningRobot: 'done', showHim: 'offered', knowTheLimits: 'locked' }, bed: null, rescued: false, fieldDay: -1 });
    expect(migrated.player.gold).toBe(BASE.player.gold);
    expect(migrated.robots.list.map((robot) => robot.name)).toEqual(['Sprinkle', 'Bolt']);
  });

  it('counts job 1 done for a farm with only a delivery due', () => {
    const save = v8Save(withMigratedJobs(withDeliveries(BASE, [{ size: 'standard', name: 'Clank' }])));
    expect(must(load(save)).jobs.status).toEqual({ spinningRobot: 'done', showHim: 'offered', knowTheLimits: 'locked' });
  });

  it('offers job 1 to a farm with no robots and no deliveries', () => {
    const save = v8Save(BASE);
    expect('jobs' in save).toBe(false);
    expect((migrateSave(save) as SaveJson).jobs).toEqual(createDefaultSections().jobs);
    expect(must(load(save))).toEqual(BASE);
  });

  it('migrates the version-2 fixture through every version to 9', () => {
    const loaded = must(deserializeGame(saveV2Text));
    expect(loaded.version).toBe(9);
    expect(loaded.jobs).toEqual(BASE.jobs);
    expect(loaded.robots.zones).toEqual(BASE.robots.zones);
  });

  it("v8Save refuses a neighbour's robot, a zone off the farm and jobs a version-8 save can't hold", () => {
    expect(() => v8Save(withRobots(BASE, [wave()]))).toThrow('v8Save');
    expect(() => v8Save(withZones(BASE, { H: COSMO_FIELD_ZONE }))).toThrow('v8Save');
    expect(() => v8Save(withRobots(BASE, [robotOf()]))).toThrow('v8Save');
    expect(() => v8Save({ ...BASE, jobs: { ...BASE.jobs, status: { ...BASE.jobs.status, spinningRobot: 'active' } } })).toThrow('v8Save');
  });

  it('leaves a v8 save whose robots section is malformed for the validator to reject', () => {
    for (const robots of ['everyone', { ...robotsOf(v8Save(BASE)), list: 'none' }, { ...robotsOf(v8Save(BASE)), zones: null }]) {
      const save = { ...v8Save(BASE), robots };
      expect(migrateSave(save)).toBe(save);
      expect(load(save)).toBeNull();
    }
  });

  it('leaves a save from a later version for the validator to reject', () => {
    const save = { ...v8Save(BASE), version: 10 };
    expect(migrateSave(save)).toBe(save);
    expect(load(save)).toBeNull();
  });
});

describe('save version 9 rejects', () => {
  type JsonPath = readonly (string | number)[];
  const status = (spinningRobot: string, showHim: string, knowTheLimits: string) => ({ spinningRobot, showHim, knowTheLimits });
  const cases: readonly (readonly [string, JsonPath, unknown])[] = [
    // Robots: a map and an owner, each robot on open ground of its own map.
    ['a robot without a map', ['robots', 'list', 0, 'mapId'], undefined],
    ['a robot without an owner', ['robots', 'list', 0, 'owner'], undefined],
    ['a robot on an unknown map', ['robots', 'list', 0, 'mapId'], 'town'],
    ['a robot of an unknown owner', ['robots', 'list', 0, 'owner'], 'marigold'],
    ["a player's robot on the Neighbours map", ['robots', 'list', 0, 'mapId'], 'neighbours'],
    ["a neighbour's robot on the farm", ['robots', 'list', 1, 'mapId'], 'farm'],
    ["a neighbour's robot owned by the player", ['robots', 'list', 1, 'owner'], 'player'],
    ["a neighbour's robot off the Neighbours map", ['robots', 'list', 1, 'tx'], 45],
    ["a neighbour's robot on a fence", ['robots', 'list', 1, 'tz'], COSMO_FENCE_CORNER.tz],
    // Zones: on a robot map, wholly on it.
    ['a zone without a map', ['robots', 'zones', 'A', 'mapId'], undefined],
    ['a zone on an unknown map', ['robots', 'zones', 'A', 'mapId'], 'forest'],
    ['a zone off the Neighbours map', ['robots', 'zones', 'H', 'z0'], 25],
    ['an extra field on a zone', ['robots', 'zones', 'H', 'name'], 'field'],
    // Jobs: exact keys, every id once, the order rule, the bed, the rescue and the field day.
    ['missing jobs', ['jobs'], undefined],
    ['jobs that are not an object', ['jobs'], 'none'],
    ['an extra field on jobs', ['jobs', 'reward'], 500],
    ['a missing status', ['jobs', 'status'], undefined],
    ['a job without a status', ['jobs', 'status', 'knowTheLimits'], undefined],
    ['an unknown job', ['jobs', 'status', 'chickens'], 'locked'],
    ['an unknown status', ['jobs', 'status', 'showHim'], 'started'],
    ['two jobs active', ['jobs', 'status'], status('active', 'active', 'locked')],
    ['a job offered before the one before it is done', ['jobs', 'status'], status('offered', 'offered', 'locked')],
    ['a job done before the one before it', ['jobs', 'status'], status('active', 'done', 'locked')],
    ['a job active out of order', ['jobs', 'status'], status('done', 'locked', 'active')],
    ['the job after a done job still locked', ['jobs', 'status'], status('done', 'locked', 'locked')],
    ['job 1 locked', ['jobs', 'status'], status('locked', 'locked', 'locked')],
    ['a missing bed', ['jobs', 'bed'], undefined],
    ['a bed that is not a tile', ['jobs', 'bed'], 'by the bench'],
    ['a bed with an extra field', ['jobs', 'bed', 'mapId'], 'farm'],
    ['a bed with a fractional corner', ['jobs', 'bed', 'tx'], 3.5],
    ['a bed off the farm', ['jobs', 'bed', 'tx'], -1],
    ['a bed running off the farm', ['jobs', 'bed', 'tz'], 38],
    ['a rescue that is not yes or no', ['jobs', 'rescued'], 1],
    ['a field day below -1', ['jobs', 'fieldDay'], -2],
    ['a fractional field day', ['jobs', 'fieldDay'], 1.5],
  ];

  it.each(cases)('%s', (_label, path, value) => {
    const state = midJob();
    expect(isValidGameState(JSON.parse(serializeGame(state)))).toBe(true);
    const save = JSON.parse(serializeGame(state)) as SaveJson;
    let node: SaveJson = save;
    for (const key of path.slice(0, -1)) {
      const next = (node as Record<string | number, unknown>)[key];
      if (typeof next !== 'object' || next === null) throw new Error(`no object at ${key}`);
      node = next as SaveJson;
    }
    const last = must(path[path.length - 1]);
    if (value === undefined) delete (node as Record<string | number, unknown>)[last];
    else (node as Record<string | number, unknown>)[last] = value;
    expect(JSON.stringify(save)).not.toBe(serializeGame(state));
    expect(isValidGameState(save)).toBe(false);
    expect(load(save)).toBeNull();
  });

  it("rejects the player carrying a neighbour's robot, and accepts them carrying their own", () => {
    const carrying = (state: GameState, id: number): GameState => ({
      ...state,
      player: { ...state.player, carrying: id },
      robots: { ...state.robots, list: state.robots.list.map((robot) => (robot.id === id ? { ...robot, carried: true } : robot)) },
    });
    expect(valid(carrying(midJob(), 1))).toBe(true);
    expect(valid(carrying(midJob(), 3))).toBe(false);
  });

  it('accepts a bed in the far corner of the farm, and every legal run of statuses', () => {
    const state = midJob();
    expect(valid({ ...state, jobs: { ...state.jobs, bed: { tx: 45, tz: 37 } } })).toBe(true);
    for (const [a, b, c] of [
      ['offered', 'locked', 'locked'],
      ['active', 'locked', 'locked'],
      ['done', 'offered', 'locked'],
      ['done', 'done', 'active'],
      ['done', 'done', 'done'],
    ] as const) {
      expect(valid({ ...state, jobs: { ...state.jobs, status: { spinningRobot: a, showHim: b, knowTheLimits: c } } }), `${a} ${b} ${c}`).toBe(true);
    }
  });
});
