/**
 * Save version 6 (farmclaws part 3 spec §9): the v5 → v6 migration, round trips of the part 3
 * state, and one corrupted field per validation rule. Each part 3 task that adds a saved field
 * adds its cases here.
 */
import { describe, expect, it } from 'vitest';
import { INVENTORY, UNLOCKS, WORKBENCH } from '../src/config';
import { Direction, SAVE_VERSION, type GameState, type RobotStats } from '../src/core/types';
import { b } from '../src/robots/blocks';
import { freshExec } from '../src/robots/exec';
import { ALL_UNLOCKS, withUnlocks } from '../src/robots/unlocks';
import { requireRobot } from '../src/robots/world';
import { actions } from '../src/state/actions';
import { deserializeGame, migrateSave, serializeGame } from '../src/state/persistence';
import { gameReducer } from '../src/state/reducer';
import { locateTile } from '../src/world/grid';
import { EMPTY_TILE } from '../src/world/tiles';
import saveV2Text from './fixtures/save-v2.json?raw';
import { BASE, benchedRobotOf, must, robotOf, v5Save, withPlayer, withRobots, withTile, withZones, type SaveJson } from './testUtils';

const WALK = b.program({ stacks: [b.when(b.morning(), b.move())] });

/** What a v5 save can hold: a script robot, an idle block robot with an .MD, and a zone. */
function v5Farm(): GameState {
  const robots = [
    robotOf({ id: 1 }),
    robotOf({ id: 2, name: 'Bolt', tx: 4, tz: 10, power: 'standby', program: WALK, exec: freshExec(WALK), md: [{ kind: 'dontGoIntoWater' }] }),
  ];
  return withZones(withRobots(BASE, robots), { A: { x0: 3, z0: 9, w: 4, d: 3 } });
}

/** `state` as deserializeGame returns it: no panel open, unpaused. */
const loadedFrom = (state: GameState): GameState => ({ ...state, ui: { ...state.ui, panel: { kind: 'none' }, paused: false } });

/** Serialises `state`, lets `edit` change the parsed JSON, and loads it again. */
function corrupt(state: GameState, edit: (save: SaveJson) => void): GameState | null {
  const save = JSON.parse(serializeGame(state)) as SaveJson;
  edit(save);
  return deserializeGame(JSON.stringify(save));
}

const robotsOf = (save: SaveJson) => save.robots as SaveJson & { list: SaveJson[] };
/** The first saved robot. */
const firstRobot = (save: SaveJson): SaveJson => must(robotsOf(save).list[0]);

describe('save version 6', () => {
  it('is the current version, and new games start in it', () => {
    expect(SAVE_VERSION).toBe(6);
    expect(BASE.version).toBe(6);
  });

  it('round-trips a farm with robots and zones', () => {
    const state = v5Farm();
    expect(deserializeGame(serializeGame(state))).toEqual(loadedFrom(state));
  });
});

describe('v5 → v6', () => {
  it('writes version 6', () => {
    expect((migrateSave(v5Save(v5Farm())) as SaveJson).version).toBe(6);
  });

  it('loads a v5 save as the state it was taken from', () => {
    const state = v5Farm();
    expect(must(deserializeGame(JSON.stringify(v5Save(state))))).toEqual(state);
  });

  it('migrates the version-2 fixture through every version to 6', () => {
    const loaded = must(deserializeGame(saveV2Text));
    expect(loaded.version).toBe(6);
    expect(loaded.robots.list).toEqual([]);
  });

  it('leaves a save from a later version for the validator to reject', () => {
    const save = { ...v5Save(BASE), version: 7 };
    expect(migrateSave(save)).toBe(save);
    expect(deserializeGame(JSON.stringify(save))).toBeNull();
  });
});

describe('robot stats in save version 6', () => {
  const STATS: RobotStats = { today: { tokens: 5, actions: 2, crops: 1 }, week: { tokens: 40, actions: 9, crops: 3 } };
  const counted = (): GameState => withRobots(BASE, [robotOf({ stats: STATS })]);
  const statsJson = (save: SaveJson) => firstRobot(save).stats as { today: SaveJson; week: SaveJson };

  it("round-trips today's and this week's counters", () => {
    const state = counted();
    expect(deserializeGame(serializeGame(state))).toEqual(loadedFrom(state));
  });

  it("turns a v5 robot's tokensToday into today's and this week's tokens", () => {
    const state = withRobots(BASE, [robotOf({ stats: { today: { tokens: 12, actions: 0, crops: 0 }, week: { tokens: 12, actions: 0, crops: 0 } } })]);
    const save = v5Save(state);
    expect(firstRobot(save).tokensToday).toBe(12);
    expect(firstRobot(save)).not.toHaveProperty('stats');
    expect(must(deserializeGame(JSON.stringify(save)))).toEqual(state);
  });

  it('cannot write counters a v5 save has no room for', () => {
    expect(() => v5Save(counted())).toThrow('v5Save');
  });

  const rejections: readonly [string, (save: SaveJson) => void][] = [
    ['a negative count', (s) => void (statsJson(s).today.tokens = -1)],
    ['a fractional count', (s) => void (statsJson(s).week.actions = 1.5)],
    ['more tokens today than this week', (s) => void (statsJson(s).today.tokens = 41)],
    ['more actions today than this week', (s) => void (statsJson(s).today.actions = 10)],
    ['more crops today than this week', (s) => void (statsJson(s).today.crops = 4)],
    ['a missing counter', (s) => void delete statsJson(s).week.crops],
    ['an unknown counter', (s) => void (statsJson(s).today.coins = 1)],
    ['stats without a week', (s) => void delete (firstRobot(s).stats as SaveJson).week],
    ['a leftover tokensToday', (s) => void (firstRobot(s).tokensToday = 5)],
  ];

  it.each(rejections)('rejects %s', (_label, edit) => {
    expect(corrupt(counted(), edit)).toBeNull();
  });
});

describe('unlocks in save version 6', () => {
  it("gives a v5 save job 1's unlocks", () => {
    const save = v5Save(BASE);
    expect(robotsOf(save)).not.toHaveProperty('unlocks');
    expect(robotsOf(migrateSave(save) as SaveJson).unlocks).toEqual(UNLOCKS.job1);
    expect(must(deserializeGame(JSON.stringify(save)))).toEqual(BASE);
  });

  it('round-trips every unlock', () => {
    const state = withUnlocks(BASE, ALL_UNLOCKS);
    expect(deserializeGame(serializeGame(state))).toEqual(loadedFrom(state));
  });

  it('cannot write unlocks beyond job 1 to a v5 save', () => {
    expect(() => v5Save(withUnlocks(BASE, { tabs: ['stats'] }))).toThrow('v5Save');
  });
});

describe('the workbench in save version 6', () => {
  const HOME = WORKBENCH.home;
  const AT_BENCH = { tx: HOME.tx, tz: HOME.tz + 1 };
  const chest = { kind: 'chest' as const, slots: new Array<null>(INVENTORY.chestSlots).fill(null) };
  const benchTile = { ...EMPTY_TILE, object: { kind: 'workbench' as const } };
  const load = (save: SaveJson): GameState | null => deserializeGame(JSON.stringify(save));

  /** The saved farm tile at (tx, tz). */
  function farmTile(save: SaveJson, tx: number, tz: number): SaveJson {
    const farm = (save.maps as SaveJson).farm as { chunks: { tiles: SaveJson[] }[] };
    const at = locateTile(BASE.maps.farm.grid, tx, tz);
    return must(must(farm.chunks[at.chunkIndex]).tiles[at.localIndex]);
  }
  const savedRobot = (save: SaveJson, index: number): SaveJson => must(robotsOf(save).list[index]);

  /** Sprocket switched off on the bench, Bolt working in the field. */
  const BENCHED: GameState = withRobots(BASE, [benchedRobotOf({ off: 'player' }), robotOf({ id: 2, name: 'Bolt' })]);

  /** Sprocket carried to the bench and put on it through the reducer: its screen is open. */
  const carryToBench = (): GameState => {
    const carrying = withRobots({ ...BASE, player: { ...BASE.player, carrying: 1 } }, [robotOf({ carried: true })]);
    return gameReducer(withPlayer(carrying, AT_BENCH, Direction.North), actions.interact());
  };

  it('round-trips robots on and around the bench in every state the game makes', () => {
    const real = carryToBench();
    expect(real.ui.panel).toEqual({ kind: 'robot', robotId: 1, mode: 'bench' });
    const lifted = gameReducer(real, actions.liftOffBench(1));
    const states = [
      BENCHED,
      real,
      lifted,
      withRobots(BASE, [benchedRobotOf({ power: 'broken' })]),
      withRobots(BASE, [benchedRobotOf({ power: 'flat', tokens: 0, off: 'player' })]),
      withRobots(BASE, [robotOf({ power: 'repairing', repairReadyDay: 1, tx: HOME.tx, tz: HOME.tz })]),
    ];
    for (const state of states) expect(deserializeGame(serializeGame(state))).toEqual(loadedFrom(state));
  });

  it('migrates a v5 save: the workbench goes home and no robot is on it', () => {
    const state = withRobots(BASE, [robotOf(), robotOf({ id: 2, name: 'Bolt', tx: 4, tz: 10 })]);
    const v5 = v5Save(state);
    expect(farmTile(v5, HOME.tx, HOME.tz).object).toBeNull();
    const migrated = migrateSave(v5) as SaveJson;
    expect(farmTile(migrated, HOME.tx, HOME.tz).object).toEqual({ kind: 'workbench' });
    expect([savedRobot(migrated, 0).onBench, savedRobot(migrated, 1).onBench]).toEqual([false, false]);
    expect(load(v5)).toEqual(state);
  });

  it('puts the workbench on the nearest free tile when home is built on, past robots and the player', () => {
    // In v5 the player built a chest at home; a robot stands north of it and the player east of it.
    let state = withTile(BASE, HOME, { ...EMPTY_TILE, object: chest }, 'farm');
    state = withTile(state, AT_BENCH, benchTile, 'farm');
    state = withPlayer(withRobots(state, [robotOf({ tx: HOME.tx, tz: HOME.tz - 1 })]), { tx: HOME.tx + 1, tz: HOME.tz }, Direction.West);
    const v5 = v5Save(state);
    expect(farmTile(v5, AT_BENCH.tx, AT_BENCH.tz).object).toBeNull();
    expect(farmTile(migrateSave(v5) as SaveJson, AT_BENCH.tx, AT_BENCH.tz).object).toEqual({ kind: 'workbench' });
    expect(load(v5)).toEqual(state);
  });

  it('counts a robot standing on home as built on, but not a carried robot that left from it', () => {
    let standing = withTile(BASE, HOME, EMPTY_TILE, 'farm');
    standing = withTile(standing, { tx: HOME.tx, tz: HOME.tz - 1 }, benchTile, 'farm');
    standing = withRobots(standing, [robotOf({ tx: HOME.tx, tz: HOME.tz })]);
    expect(load(v5Save(standing))).toEqual(standing);
    const lifted = gameReducer(carryToBench(), actions.liftOffBench(1));
    expect(requireRobot(lifted, 1)).toMatchObject({ carried: true, tx: HOME.tx, tz: HOME.tz });
    expect(load(v5Save(lifted))).toEqual(lifted);
  });

  it('cannot write a robot on the bench or switched off to a v5 save', () => {
    expect(() => v5Save(BENCHED)).toThrow('v5Save');
    expect(() => v5Save(withRobots(BASE, [robotOf({ off: 'player' })]))).toThrow('v5Save');
  });

  it('rejects a workbench off the farm', () => {
    const forest = { tx: 10, tz: 10 };
    expect(deserializeGame(serializeGame(withTile(BASE, forest, { ...EMPTY_TILE, object: chest }, 'forest')))).not.toBeNull();
    expect(deserializeGame(serializeGame(withTile(BASE, forest, benchTile, 'forest')))).toBeNull();
  });

  const rejections: readonly [string, GameState, (save: SaveJson) => void][] = [
    ['no workbench on the farm', BASE, (s) => void (farmTile(s, HOME.tx, HOME.tz).object = null)],
    ['a second workbench on the farm', BASE, (s) => void (farmTile(s, HOME.tx + 2, HOME.tz).object = { kind: 'workbench' })],
    ['a workbench with a field', BASE, (s) => void (farmTile(s, HOME.tx, HOME.tz).object = { kind: 'workbench', level: 1 })],
    ['a robot on the bench off the workbench tile', BENCHED, (s) => void (savedRobot(s, 0).tx = HOME.tx + 1)],
    ['a carried robot on the bench', BENCHED, (s) => void (Object.assign(savedRobot(s, 0), { carried: true }), ((s.player as SaveJson).carrying = 1))],
    ['a robot on the bench away for repairs', BENCHED, (s) => void Object.assign(savedRobot(s, 0), { power: 'repairing', repairReadyDay: 1, off: null })],
    ['two robots on the bench', BENCHED, (s) => void Object.assign(savedRobot(s, 1), { onBench: true, tx: HOME.tx, tz: HOME.tz })],
    ['a robot off the bench on the workbench tile', BENCHED, (s) => void (savedRobot(s, 0).onBench = false)],
    ['a missing onBench', BENCHED, (s) => void delete savedRobot(s, 1).onBench],
    ['an onBench that is not a boolean', BENCHED, (s) => void (savedRobot(s, 1).onBench = 0)],
    ['an unknown off reason', BENCHED, (s) => void (savedRobot(s, 0).off = 'sleepy')],
    ['a broken robot switched off', BENCHED, (s) => void Object.assign(savedRobot(s, 1), { power: 'broken', off: 'player' })],
  ];

  it.each(rejections)('rejects %s', (_label, state, edit) => {
    expect(deserializeGame(serializeGame(state))).not.toBeNull();
    expect(corrupt(state, edit)).toBeNull();
  });
});
