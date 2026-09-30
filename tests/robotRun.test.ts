/**
 * Robots acting on the shared rhythm inside time/tick: scripts, going flat, bickering,
 * re-planning after another robot, waiting and carried robots.
 */
import { describe, expect, it } from 'vitest';
import { TIME } from '../src/config';
import { TileState, type GameState, type Robot, type RobotAction } from '../src/core/types';
import { requireRobot } from '../src/robots/world';
import { actions } from '../src/state/actions';
import { gameReducer } from '../src/state/reducer';
import { EMPTY_TILE } from '../src/world/tiles';
import { BASE, TARGET, matureCrop, robotOf, soilTile, stack, tileAt, withRobots, withTile } from './testUtils';

const AHEAD = { tx: TARGET.tx, tz: TARGET.tz + 1 };
const script = (steps: RobotAction[], loop = true): Robot['program'] => ({ kind: 'script', steps, loop });
const tick = (state: GameState, minutes: number) => gameReducer(state, actions.tick(minutes));
const events = (state: GameState, id: number) => state.robots.log.entries.filter((e) => e.robotId === id).map((e) => e.event.kind);

describe('robots in the tick', () => {
  it('act on the shared rhythm: first at 6:04, then every 4 minutes', () => {
    const state = withRobots(BASE, [robotOf()]);
    expect(requireRobot(tick(state, 3), 1).actionSeq).toBe(0);
    expect(requireRobot(tick(state, 4), 1).actionSeq).toBe(1);
    expect(requireRobot(tick(state, 12), 1).actionSeq).toBe(3);
  });

  it('go flat when they cannot pay, keep their step, and toast it', () => {
    const state = withRobots(BASE, [robotOf({ tokens: 0, program: script([{ kind: 'move' }]) })]);
    const next = tick(state, 4);
    const robot = requireRobot(next, 1);
    expect([robot.power, robot.pc, robot.actionSeq]).toEqual(['flat', 0, 0]);
    expect(events(next, 1)).toEqual(['flat']);
    expect(next.messages.entries.at(-1)?.text).toBe('Sprocket ran out of power.');
    expect(requireRobot(tick(next, 60), 1).actionSeq).toBe(0);
  });

  it('bicker over one tile: both pay, the crop stays, both are logged', () => {
    const field = withTile(BASE, TARGET, soilTile(TileState.Watered, matureCrop('parsnip')), 'farm');
    const harvest = script([{ kind: 'harvest' }]);
    const state = withRobots(field, [robotOf({ id: 1, program: harvest }), robotOf({ id: 2, name: 'Bolt', program: harvest })]);
    const next = tick(state, 4);
    expect(tileAt(next, TARGET, 'farm').crop).not.toBeNull();
    for (const id of [1, 2]) {
      const robot = requireRobot(next, id);
      expect(robot.tokens).toBe(77);
      expect(robot.lastAction).toMatchObject({ success: false, bickered: true });
    }
    expect(next.robots.log.entries.map((e) => e.event)).toEqual([
      { kind: 'bickered', action: 'harvest', withIds: [2] },
      { kind: 'bickered', action: 'harvest', withIds: [1] },
    ]);
  });

  it('bickering pays, advances the script and marks the turn on every robot involved', () => {
    const field = withTile(BASE, TARGET, soilTile(TileState.Watered, matureCrop('parsnip')), 'farm');
    const steps = script([{ kind: 'harvest' }, { kind: 'turn', side: 'right' }]);
    const state = withRobots(field, [robotOf({ id: 1, program: steps }), robotOf({ id: 2, name: 'Bolt', program: steps })]);
    const next = tick(state, 4);
    expect(next.maps.farm).toBe(state.maps.farm);
    for (const id of [1, 2]) {
      const robot = requireRobot(next, id);
      expect(robot).toMatchObject({ pc: 1, actionSeq: 1, tokens: 77, tokensToday: 3, bag: [], nextActMinute: TIME.dayStartMinute + 8 });
      expect(robot.lastAction).toEqual({ seq: 1, kind: 'harvest', success: false, bickered: true });
    }
  });

  it('only successful plans bicker: a blocked robot on the same tile leaves the other to harvest', () => {
    const field = withTile(BASE, TARGET, soilTile(TileState.Watered, matureCrop('parsnip')), 'farm');
    const harvest = script([{ kind: 'harvest' }]);
    const state = withRobots(field, [robotOf({ id: 1, program: harvest }), robotOf({ id: 2, name: 'Bolt', parts: [], program: harvest })]);
    const next = tick(state, 4);
    expect(requireRobot(next, 1).lastAction).toMatchObject({ success: true, bickered: false });
    expect(requireRobot(next, 1).bag).toHaveLength(1);
    expect(requireRobot(next, 2).lastAction).toMatchObject({ success: false, bickered: false });
    expect(next.robots.log.entries.at(-1)?.event).toEqual({ kind: 'blocked', action: 'harvest', reason: 'noPart' });
  });

  it('re-plan after an earlier robot empties a chest in the same minute', () => {
    const chest = { ...EMPTY_TILE, object: { kind: 'chest' as const, slots: Array.from({ length: 36 }, (_, i) => (i === 0 ? stack('parsnip', 1) : null)) } };
    const state = withRobots(withTile(BASE, AHEAD, chest, 'farm'), [
      robotOf({ id: 1, program: script([{ kind: 'take', itemId: 'parsnip' }]) }),
      robotOf({ id: 2, name: 'Bolt', program: script([{ kind: 'take', itemId: 'parsnip' }]) }),
    ]);
    const next = tick(state, 4);
    expect(requireRobot(next, 1).bag).toEqual([stack('parsnip', 1)]);
    expect(requireRobot(next, 2).bag).toEqual([]);
    expect(requireRobot(next, 1).tokens).toBe(79);
    expect(requireRobot(next, 2).tokens).toBe(79);
    expect(requireRobot(next, 2).lastAction).toMatchObject({ success: false, bickered: false });
    expect(tileAt(next, AHEAD, 'farm').object).toEqual({ kind: 'chest', slots: Array.from({ length: 36 }, () => null) });
    expect(next.robots.log.entries.at(-1)?.event).toEqual({ kind: 'blocked', action: 'take', reason: 'itemNotFound' });
  });

  it('wait, and never act while carried', () => {
    const waiting = withRobots(BASE, [robotOf({ program: script([{ kind: 'wait', minutes: 30 }, { kind: 'turn', side: 'right' }]) })]);
    expect(requireRobot(tick(waiting, 33), 1).actionSeq).toBe(1);
    expect(requireRobot(tick(waiting, 34), 1).actionSeq).toBe(2);
    const carried = withRobots({ ...BASE, player: { ...BASE.player, carrying: 1 } }, [robotOf({ carried: true })]);
    expect(requireRobot(tick(carried, 60), 1).actionSeq).toBe(0);
  });

  it('leaves an idle farm untouched apart from the clock', () => {
    const state = withRobots(BASE, [robotOf({ power: 'standby' })]);
    const next = tick(state, 30);
    expect(next.robots).toBe(state.robots);
    expect(next.maps).toBe(state.maps);
    expect(next.time.minuteOfDay).toBe(BASE.time.minuteOfDay + 30);
  });

  it('keeps the identity of robots that did not act, and of the whole list with no robots', () => {
    const resting = robotOf({ id: 2, name: 'Bolt', power: 'standby' });
    const state = withRobots(BASE, [robotOf(), resting]);
    const next = tick(state, 4);
    expect(requireRobot(next, 1).actionSeq).toBe(1);
    expect(requireRobot(next, 2)).toBe(resting);
    expect(tick(BASE, 30).robots).toBe(BASE.robots);
  });
});
