/**
 * Save version 6 (farmclaws part 3 spec §9): the v5 → v6 migration, round trips of the part 3
 * state, and one corrupted field per validation rule. Each part 3 task that adds a saved field
 * adds its cases here.
 */
import { describe, expect, it } from 'vitest';
import { SAVE_VERSION, type GameState } from '../src/core/types';
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
