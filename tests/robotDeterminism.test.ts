/**
 * Determinism and the render contract with robots on the farm: a busy session played twice
 * through a freezing store ends identically, replaying its log reproduces it, and every
 * transition keeps unchanged robots (and the robot list when nothing robot-related changed)
 * by reference. Part 2 plays the same sessions with block programs, .MDs and zones.
 */
import { describe, expect, it } from 'vitest';
import { TIME } from '../src/config';
import { mulberry32 } from '../src/core/hash';
import { createActionRecorder, createStore } from '../src/core/store';
import { DIRECTIONS, Direction, TileState, type GameState } from '../src/core/types';
import { b } from '../src/robots/blocks';
import { addRobot } from '../src/robots/create';
import { actions, type GameAction } from '../src/state/actions';
import { serializeGame } from '../src/state/persistence';
import { gameReducer } from '../src/state/reducer';
import { EMPTY_TILE } from '../src/world/tiles';
import { addBlockRobot } from './programGen';
import { atDay, BASE, HEAVY_TEST_TIMEOUT_MS, matureCrop, must, soilTile, withTile, withZones } from './testUtils';

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

/**
 * Three block robots: a waterer fenced into Zone A, a harvester in Zone B that walks home to the
 * wood burner at 18:00, and a poller that runs a helper every 15 minutes.
 */
function withBlockRobots(): GameState {
  let state = withZones(atDay(BASE, 0, TIME.dayStartMinute), { A: { x0: 3, z0: 12, w: 3, d: 3 }, B: { x0: 9, z0: 12, w: 4, d: 2 } });
  for (let tx = 3; tx <= 5; tx++) for (let tz = 12; tz <= 14; tz++) state = withTile(state, { tx, tz }, soilTile(TileState.Plowed), 'farm');
  for (let tx = 9; tx <= 12; tx++) for (let tz = 12; tz <= 13; tz++) state = withTile(state, { tx, tz }, soilTile(TileState.Watered, matureCrop('parsnip')), 'farm');
  state = withTile(state, { tx: 14, tz: 15 }, { ...EMPTY_TILE, object: { kind: 'woodBurner', fuel: 10 } }, 'farm');
  state = addBlockRobot(state, {
    name: 'Drizzle',
    size: 'mini',
    parts: ['wateringHead'],
    place: { tx: 4, tz: 13, facing: Direction.South },
    program: b.program({ stacks: [b.when(b.morning(), b.forEach('A', b.if(b.soilIsDry(), [b.water()])), b.powerDown())] }),
    md: [{ kind: 'dontLeave', zone: 'A' }],
  });
  state = addBlockRobot(state, {
    name: 'Reaper',
    size: 'standard',
    parts: ['claw', 'basket'],
    place: { tx: 9, tz: 12, facing: Direction.East },
    program: b.program({ stacks: [b.when(b.morning(), b.forever(b.forEach('B', b.if(b.cropIsReady(), [b.harvest()]))))] }),
    md: [{ kind: 'doReturn', to: { kind: 'generator' }, minute: 18 * 60 }],
  });
  return addBlockRobot(state, {
    name: 'Poll',
    size: 'mini',
    parts: ['claw'],
    place: { tx: 7, tz: 16, facing: Direction.North },
    program: b.program({
      stacks: [b.when(b.every(15), b.run('look'))],
      helpers: [b.helper('look', b.if(b.cropIsReady(), [b.harvest()]), b.turn('right'))],
    }),
  });
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

  it(
    'plays the same twice with block programs, .MDs and zones, replays from its log, and never copies an unchanged robot',
    () => {
      const start = withBlockRobots();
      let acted = 0;
      for (let seed = 1; seed <= 5; seed++) {
        const list = session(seed, 600);
        const first = play(start, list);
        const second = play(start, list);
        expect(serializeGame(first.state)).toBe(serializeGame(second.state));
        expect(serializeGame(play(start, first.recorded).state)).toBe(serializeGame(first.state));
        expect(first.problems.slice(0, 10)).toEqual([]);
        acted += first.state.robots.list.reduce((sum, robot) => sum + robot.actionSeq, 0);
      }
      // The block robots really acted: the equality above isn't three idle robots.
      expect(acted).toBeGreaterThan(0);
    },
    HEAVY_TEST_TIMEOUT_MS,
  );
});
