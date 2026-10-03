/**
 * Save version 6 (farmclaws part 3 spec §9): the v5 → v6 migration, round trips of the part 3
 * state, and one corrupted field per validation rule. Each part 3 task that adds a saved field
 * adds its cases here.
 */
import { describe, expect, it } from 'vitest';
import { SAVE_VERSION, type GameState, type RobotStats } from '../src/core/types';
import { b } from '../src/robots/blocks';
import { freshExec } from '../src/robots/exec';
import { deserializeGame, migrateSave, serializeGame } from '../src/state/persistence';
import saveV2Text from './fixtures/save-v2.json?raw';
import { BASE, must, robotOf, v5Save, withRobots, withZones, type SaveJson } from './testUtils';

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
