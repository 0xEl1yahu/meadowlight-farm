/**
 * Determinism and the render contract with robots on the farm: a busy session played twice
 * through a freezing store ends identically, replaying its log reproduces it, and every
 * transition keeps unchanged robots (and the robot list when nothing robot-related changed)
 * by reference.
 */
import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../src/core/hash';
import { createActionRecorder, createStore } from '../src/core/store';
import { DIRECTIONS, type GameState } from '../src/core/types';
import { addRobot } from '../src/robots/create';
import { actions, type GameAction } from '../src/state/actions';
import { serializeGame } from '../src/state/persistence';
import { gameReducer } from '../src/state/reducer';
import { BASE, HEAVY_TEST_TIMEOUT_MS, must } from './testUtils';

function withPresetRobots(): GameState {
  let state = BASE;
  const specs = [
    { name: 'Ada', size: 'mini' as const, parts: ['wateringHead' as const], steps: [{ kind: 'water' as const }, { kind: 'move' as const }, { kind: 'turn' as const, side: 'left' as const }] },
    { name: 'Bolt', size: 'standard' as const, parts: ['claw' as const, 'basket' as const], steps: [{ kind: 'harvest' as const }, { kind: 'move' as const }] },
    { name: 'Cog', size: 'mini' as const, parts: ['tiller' as const], steps: [{ kind: 'till' as const }, { kind: 'move' as const }, { kind: 'turn' as const, side: 'right' as const }] },
  ];
  specs.forEach((s, i) => {
    const result = addRobot(state, { name: s.name, size: s.size, parts: s.parts, place: { tx: 3 + i * 3, tz: 11, facing: 2 }, program: { kind: 'script', steps: s.steps, loop: true } });
    if ('error' in result) throw new Error(result.error);
    state = result.state;
  });
  return state;
}

function session(seed: number, length: number): GameAction[] {
  const rng = mulberry32(seed);
  const list: GameAction[] = [];
  for (let i = 0; i < length; i++) {
    const roll = rng();
    if (roll < 0.35) list.push(actions.move(must(DIRECTIONS[Math.floor(rng() * 4)])));
    else if (roll < 0.5) list.push(actions.interact());
    else if (roll < 0.6) list.push(actions.useTool());
    else if (roll < 0.95) list.push(actions.tick(1 + Math.floor(rng() * 90)));
    else list.push(actions.sleep());
  }
  return list;
}

function play(start: GameState, list: readonly GameAction[]): { state: GameState; recorded: readonly GameAction[]; problems: string[] } {
  const recorder = createActionRecorder<GameState, GameAction>();
  const store = createStore(gameReducer, start, { freeze: true, middleware: [recorder.middleware] });
  const problems: string[] = [];
  store.subscribe((state, prev) => {
    for (const robot of state.robots.list) {
      const before = prev.robots.list.find((r) => r.id === robot.id);
      if (before !== undefined && before !== robot && JSON.stringify(before) === JSON.stringify(robot)) problems.push(`robot ${robot.id} copied without changing`);
    }
  });
  for (const action of list) store.dispatch(action);
  return { state: store.getState(), recorded: recorder.actions, problems };
}

describe('determinism with robots', () => {
  it(
    'plays the same twice, replays from its log, and never copies an unchanged robot',
    () => {
      const start = withPresetRobots();
      for (let seed = 1; seed <= 5; seed++) {
        const list = session(seed, 600);
        const a = play(start, list);
        const b = play(start, list);
        expect(serializeGame(a.state)).toBe(serializeGame(b.state));
        expect(serializeGame(play(start, a.recorded).state)).toBe(serializeGame(a.state));
        expect(a.problems.slice(0, 10)).toEqual([]);
      }
    },
    HEAVY_TEST_TIMEOUT_MS,
  );
});
