/**
 * Water: a new core or ruin (farmclaws part 3 spec §3.2). A broken robot still in the water at
 * the morning reset is ruined; fished out, put down on land or carried at day end, it isn't; a
 * migrated broken robot is ruined only at the next morning (plan review focus 5); ruined robots
 * never act or recharge and are never named as away from a generator; the bin's new core and its
 * refusal for ruined robots; and the edits a ruined robot refuses.
 */
import { describe, expect, it } from 'vitest';
import { PLAYER } from '../src/config';
import { Blocker, Direction, type GameState, type Robot } from '../src/core/types';
import { b } from '../src/robots/blocks';
import { robotSays, whatHappened } from '../src/robots/logText';
import { resumedPower } from '../src/robots/stats';
import { requireRobot } from '../src/robots/world';
import { actions } from '../src/state/actions';
import { describeIntent, planInteraction } from '../src/state/intents';
import { deserializeGame, isValidGameState, serializeGame } from '../src/state/persistence';
import { gameReducer } from '../src/state/reducer';
import { EMPTY_TILE, blockedTile } from '../src/world/tiles';
import { BASE, benchedRobotOf, must, robotOf, v5Save, withGold, withPlayer, withRobots, withTile } from './testUtils';

const POND = { tx: 6, tz: 12 };
const SHORE = { tx: 6, tz: 11 };
const AWAY = "ended the day away from a generator and didn't recharge.";
const RUINED = 'Sprocket spent the night in the water and is ruined. Scrap it at the workbench.';
const ONLY_SCRAP = 'Sprocket is ruined. It can only be scrapped.';

const wet = (state: GameState = BASE): GameState => withTile(state, POND, blockedTile(Blocker.Water), 'farm');
/** Sprocket, shorted out in the pond. */
const sunk = (overrides: Partial<Robot> = {}): Robot => robotOf({ power: 'broken', tx: POND.tx, tz: POND.tz, ...overrides });
const sleep = (state: GameState): GameState => gameReducer(state, actions.sleep());
const tick = (state: GameState, minutes: number): GameState => gameReducer(state, actions.tick(minutes));
const interact = (state: GameState): GameState => gameReducer(state, actions.interact());
const texts = (state: GameState): string[] => state.messages.entries.map((m) => m.text);
const lastText = (state: GameState): string | undefined => state.messages.entries.at(-1)?.text;
const loadedFrom = (state: GameState): GameState => ({ ...state, ui: { ...state.ui, panel: { kind: 'none' }, paused: false } });
/** The player on the shore, facing the pond. */
const onShore = (state: GameState): GameState => withPlayer(state, SHORE, Direction.South, 'farm');

describe('ruin overnight', () => {
  it('ruins a broken robot still in the water at the morning reset, where it sank', () => {
    const next = sleep(withRobots(wet(), [sunk()]));
    expect(requireRobot(next, 1)).toMatchObject({ power: 'ruined', tx: POND.tx, tz: POND.tz, teleportSeq: 0, off: null, repairReadyDay: null });
    const entry = next.robots.log.entries.at(-1);
    expect(entry).toMatchObject({ robotId: 1, day: next.time.absoluteDay, event: { kind: 'ruined' } });
    expect(next.messages.entries.find((m) => m.text === RUINED)?.tone).toBe('warn');
    expect(isValidGameState(next)).toBe(true);
    expect(deserializeGame(serializeGame(next))).toEqual(loadedFrom(next));
  });

  it('leaves it broken when it is fished out and put down on land the same day', () => {
    const held = interact(onShore(withRobots(wet(), [sunk()])));
    expect(held.player.carrying).toBe(1);
    const down = interact(withPlayer(held, SHORE, Direction.North, 'farm'));
    expect(requireRobot(down, 1)).toMatchObject({ power: 'broken', tx: SHORE.tx, tz: SHORE.tz - 1 });
    const next = sleep(down);
    expect(requireRobot(next, 1).power).toBe('broken');
    expect(texts(next)).not.toContain(RUINED);
  });

  it('leaves it broken when it is still carried at day end (set down at spawn)', () => {
    const held = interact(onShore(withRobots(wet(), [sunk()])));
    const next = sleep(held);
    expect(requireRobot(next, 1)).toMatchObject({ power: 'broken', carried: false, tx: PLAYER.spawn.tx, tz: PLAYER.spawn.tz });
    expect(texts(next)).not.toContain(RUINED);
  });

  it('leaves broken robots on land and on the bench broken', () => {
    const next = sleep(withRobots(wet(), [robotOf({ id: 1, power: 'broken', tx: SHORE.tx, tz: SHORE.tz }), benchedRobotOf({ id: 2, name: 'Bolt', power: 'broken' })]));
    expect([requireRobot(next, 1).power, requireRobot(next, 2).power]).toEqual(['broken', 'broken']);
    expect(next.robots.log.entries).toEqual([]);
  });

  it('ruins a migrated broken robot only at the next morning (review focus 5)', () => {
    const state = withRobots(wet(), [sunk()]);
    const loaded = must(deserializeGame(JSON.stringify(v5Save(state))));
    expect(requireRobot(loaded, 1)).toMatchObject({ power: 'broken', paint: 0, tx: POND.tx, tz: POND.tz });
    expect(loaded.robots.log.entries).toEqual([]);
    const morning = sleep(loaded);
    expect(requireRobot(morning, 1).power).toBe('ruined');
    expect(texts(morning)).toContain(RUINED);
  });
});

describe('a ruined robot', () => {
  it('never acts, never recharges, and is never named as away from a generator', () => {
    const burner = { tx: POND.tx + 1, tz: POND.tz };
    const fuelled = withTile(wet(), burner, { ...EMPTY_TILE, object: { kind: 'woodBurner', fuel: 10 } }, 'farm');
    const mover = { kind: 'script', steps: [{ kind: 'move' }], loop: true } as const;
    const state = withRobots(fuelled, [sunk({ power: 'ruined', tokens: 10, program: mover })]);
    const later = tick(state, 120);
    expect(requireRobot(later, 1)).toBe(requireRobot(state, 1));
    const next = sleep(later);
    expect(requireRobot(next, 1)).toMatchObject({ power: 'ruined', tokens: 10, tx: POND.tx, tz: POND.tz });
    expect(next.robots.pool).toBe(60);
    const far = sleep(withRobots(wet(), [sunk({ power: 'ruined' })]));
    expect(texts(far).some((t) => t.endsWith(AWAY))).toBe(false);
    // Ruin happens once: no second log entry or toast the night after.
    expect(far.robots.log.entries).toEqual([]);
    expect(texts(far)).not.toContain(RUINED);
  });

  it('can be fished out, carried and put down, and stays ruined', () => {
    const state = onShore(withRobots(wet(), [sunk({ power: 'ruined' })]));
    expect(describeIntent(planInteraction(state).intent)).toBe('Fish out Sprocket');
    const held = interact(state);
    expect(held.player.carrying).toBe(1);
    const down = interact(withPlayer(held, SHORE, Direction.North, 'farm'));
    expect(requireRobot(down, 1)).toMatchObject({ power: 'ruined', carried: false });
    expect(resumedPower({ power: 'ruined', tokens: 50 })).toBe('ruined');
  });

  it('has its own log lines', () => {
    const entry = { id: 0, day: 1, minute: 360, robotId: 1, tx: POND.tx, tz: POND.tz, event: { kind: 'ruined' as const }, count: 1 };
    expect(robotSays(entry)).toBe('Having a long bath ✓');
    expect(whatHappened(entry, new Map([[1, 'Sprocket']]))).toBe('Spent the night in the water. Ruined: it can only be scrapped.');
  });

  it('refuses a new program, a new .MD, the switch and a paint job', () => {
    const program = b.program({ stacks: [b.when(b.morning(), b.move())] });
    const state = withRobots(BASE, [benchedRobotOf({ power: 'ruined' })]);
    for (const action of [actions.programRobot(1, program), actions.setRobotMd(1, []), actions.switchRobot(1, false), actions.paintRobot(1, 3)]) {
      const next = gameReducer(state, action);
      expect(requireRobot(next, 1), action.type).toBe(requireRobot(state, 1));
      expect(lastText(next), action.type).toBe(ONLY_SCRAP);
      expect(next.player.gold, action.type).toBe(state.player.gold);
    }
  });
});

describe('a new core at the shipping bin', () => {
  /** The player in front of the bin, facing it, holding `robot`. */
  const atBin = (robot: Robot): GameState =>
    withRobots(withPlayer({ ...BASE, player: { ...BASE.player, carrying: 1 } }, { tx: 9, tz: 6 }, Direction.North, 'farm'), [{ ...robot, carried: true }]);

  it('sends a broken robot for a new core', () => {
    const state = atBin(robotOf({ power: 'broken' }));
    expect(describeIntent(planInteraction(state).intent)).toBe('Send Sprocket for a new core · 300g');
    const next = interact(state);
    expect(requireRobot(next, 1)).toMatchObject({ power: 'repairing', repairReadyDay: 1 });
    expect(lastText(next)).toBe('Sprocket is off for a new core. Back tomorrow.');
  });

  it('refuses a ruined robot, gold or no gold', () => {
    for (const gold of [5000, 0]) {
      const state = withGold(atBin(robotOf({ power: 'ruined' })), gold);
      const next = interact(state);
      expect(lastText(next)).toBe('Sprocket is beyond repair. Scrap it at the workbench.');
      expect([next.player.gold, next.player.carrying]).toEqual([gold, 1]);
      expect(requireRobot(next, 1)).toBe(requireRobot(state, 1));
    }
  });
});
