/**
 * Save version 11 (farmclaws part 4c spec §3.1): taking job 1 teaches the Wood Burner recipe, so
 * the v10 → v11 migration teaches it to a farm that has taken job 1 already, and to no other.
 */
import { describe, expect, it } from 'vitest';
import { SAVE_VERSION, type GameState, type JobStatus } from '../src/core/types';
import { deserializeGame, migrateSave } from '../src/state/persistence';
import { BASE, must, v10Save, withBurnerLearned, type SaveJson } from './testUtils';

const load = (save: SaveJson): GameState | null => deserializeGame(JSON.stringify(save));

/** BASE with job 1 at `status` and job 2 as the order rule puts it. */
function atJob1(status: JobStatus): GameState {
  const showHim: JobStatus = status === 'done' ? 'offered' : 'locked';
  return { ...BASE, jobs: { ...BASE.jobs, status: { ...BASE.jobs.status, spinningRobot: status, showHim } } };
}

/** A version-10 save of `state` without the Wood Burner recipe, as version 10 left a farm that took job 1. */
function v10WithoutBurner(state: GameState): SaveJson {
  const save = v10Save(BASE);
  return { ...save, jobs: v10Save(withBurnerLearned(state)).jobs };
}

describe('save version 11', () => {
  it('is the current version', () => {
    expect(SAVE_VERSION).toBe(11);
    expect(BASE.version).toBe(11);
    expect((migrateSave(v10Save(BASE)) as SaveJson).version).toBe(11);
  });

  it('teaches the Wood Burner to a farm that has taken job 1, active or done', () => {
    for (const status of ['active', 'done'] as const) {
      const loaded = must(load(v10WithoutBurner(atJob1(status))));
      expect(loaded.crafting.known, status).toEqual([...BASE.crafting.known, 'woodBurner']);
    }
  });

  it("doesn't teach it while job 1 is still offered", () => {
    expect(must(load(v10Save(BASE))).crafting.known).toEqual(BASE.crafting.known);
  });

  it('loads a version-10 save as the state it was taken from', () => {
    const state = withBurnerLearned(atJob1('done'));
    expect(load(v10Save(state))).toEqual(state);
    expect(load(v10Save(BASE))).toEqual(BASE);
  });
});
