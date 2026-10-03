/**
 * The workbench's other jobs (farmclaws part 3 spec §3.3–3.4). Scrapping: gold per size, the
 * robot and its log gone, "a scrapped robot" in other robots' entries, the bench-only rule, ids
 * never reused. Paint: the 16 colours, the cost, the same-colour and short-gold refusals, the
 * toast, and paint never changing what a robot does.
 */
import { describe, expect, it } from 'vitest';
import { ROBOT_CARE, ROBOT_PAINTS } from '../src/config';
import { Direction, type GameState, type Robot, type RobotLogEntry, type RobotLogEvent } from '../src/core/types';
import { addRobot } from '../src/robots/create';
import { whatHappened } from '../src/robots/logText';
import { scrapValue } from '../src/robots/stats';
import { findRobot, requireRobot } from '../src/robots/world';
import { actions } from '../src/state/actions';
import { gameReducer } from '../src/state/reducer';
import { BASE, benchedRobotOf, robotOf, withGold, withRobots } from './testUtils';

const bolt = robotOf({ id: 2, name: 'Bolt', tx: 5, tz: 12 });
const lastMessage = (state: GameState) => state.messages.entries.at(-1);
/** `robots` on the farm with Sprocket's robot screen open at the bench. */
function atBench(robots: readonly Robot[]): GameState {
  const state = withRobots(BASE, robots);
  return { ...state, ui: { ...state.ui, panel: { kind: 'robot', robotId: 1, mode: 'bench' } } };
}
const entry = (id: number, robotId: number, event: RobotLogEvent): RobotLogEntry => ({ id, day: 0, minute: 400, robotId, tx: 5, tz: 12, event, count: 1 });

describe('scrapping', () => {
  it('pays a quarter of the size price, whatever the power', () => {
    expect(ROBOT_CARE).toEqual({ scrapShare: 0.25, paintCost: 50, ruinedShade: 0.45 });
    expect([scrapValue({ size: 'mini' }), scrapValue({ size: 'standard' }), scrapValue({ size: 'big' })]).toEqual([375, 1000, 2500]);
  });

  it('scraps the robot on the bench: gold, the robot and its log gone, the panel closed', () => {
    const log = {
      nextId: 4,
      entries: [
        entry(0, 1, { kind: 'did', action: 'turn', detail: { kind: 'none' } }),
        entry(1, 2, { kind: 'bickered', action: 'harvest', withIds: [1] }),
        entry(2, 1, { kind: 'crashed', withId: 2, forgot: null }),
        entry(3, 2, { kind: 'crashed', withId: 1, forgot: null }),
      ],
    };
    const before = atBench([benchedRobotOf(), bolt]);
    const state: GameState = { ...before, robots: { ...before.robots, log } };
    const next = gameReducer(state, actions.scrapRobot(1));
    expect(next.robots.list).toEqual([bolt]);
    expect(next.robots.list[0]).toBe(bolt);
    expect(next.robots.nextId).toBe(state.robots.nextId);
    expect(next.robots.log).toEqual({ nextId: 4, entries: [log.entries[1], log.entries[3]] });
    expect(next.player.gold).toBe(state.player.gold + 375);
    expect(next.ui.panel).toEqual({ kind: 'none' });
    expect(lastMessage(next)).toMatchObject({ text: 'Scrapped Sprocket for 375g.', tone: 'success' });
    // Bolt's entries now name "a scrapped robot".
    const names = new Map(next.robots.list.map((r) => [r.id, r.name]));
    expect(next.robots.log.entries.map((e) => whatHappened(e, names))).toEqual([
      'Fought a scrapped robot over the same tile. Nobody got it.',
      'Bumped into a scrapped robot and got dizzy.',
    ]);
  });

  it('pays the same for a ruined Big robot, and a new robot never reuses the id', () => {
    const state = atBench([benchedRobotOf({ size: 'big', power: 'ruined', tokens: 0 })]);
    const next = gameReducer(state, actions.scrapRobot(1));
    expect(next.player.gold).toBe(state.player.gold + 2500);
    expect(lastMessage(next)?.text).toBe('Scrapped Sprocket for 2500g.');
    const added = addRobot(next, { name: 'Nova', size: 'mini', parts: [], place: { tx: 5, tz: 12, facing: Direction.South }, program: { kind: 'script', steps: [{ kind: 'move' }], loop: true } });
    if ('error' in added) throw new Error(added.error);
    expect(added.id).toBe(2);
  });

  it('scraps only a robot on the bench', () => {
    const state = atBench([robotOf(), bolt]);
    const next = gameReducer(state, actions.scrapRobot(1));
    expect(next.robots).toBe(state.robots);
    expect(next.player.gold).toBe(state.player.gold);
    expect(lastMessage(next)).toMatchObject({ text: 'Put Sprocket on the workbench first.', tone: 'warn' });
    expect(gameReducer(state, actions.scrapRobot(9))).toBe(state);
  });
});

describe('paint', () => {
  it('offers the 16 base colours, Sunflower first, and new robots wear Sunflower', () => {
    expect(ROBOT_PAINTS.map((p) => p.name)).toEqual([
      'Sunflower', 'Tomato', 'Pumpkin', 'Peach', 'Rose', 'Plum', 'Lavender', 'Sky', 'Ocean', 'Teal', 'Mint', 'Leaf', 'Olive', 'Cocoa', 'Slate', 'Cream',
    ]);
    expect(ROBOT_PAINTS.map((p) => p.color)).toEqual([
      0xf2c14e, 0xe2563f, 0xf28a3a, 0xf4b38a, 0xe87fa3, 0x8e5ba8, 0xa99be0, 0x6fb7e8, 0x2f6fb0, 0x3aa59c, 0x8fdcb0, 0x5fa84a, 0x8a8f3c, 0x8a5a3c, 0x5e6670, 0xece2c6,
    ]);
    const added = addRobot(BASE, { name: 'Nova', size: 'mini', parts: [], place: { tx: 5, tz: 12, facing: Direction.South }, program: { kind: 'script', steps: [{ kind: 'move' }], loop: true } });
    if ('error' in added) throw new Error(added.error);
    expect(requireRobot(added.state, added.id).paint).toBe(0);
  });

  it('paints the robot on the bench for 50g', () => {
    const state = atBench([benchedRobotOf()]);
    const next = gameReducer(state, actions.paintRobot(1, 1));
    expect(requireRobot(next, 1).paint).toBe(1);
    expect(next.player.gold).toBe(state.player.gold - 50);
    expect(lastMessage(next)).toMatchObject({ text: 'Painted Sprocket Tomato.', tone: 'success' });
    expect(next.ui.panel).toEqual(state.ui.panel);
  });

  it('refuses the same colour, a short purse and a robot off the bench', () => {
    const same = atBench([benchedRobotOf({ paint: 15 })]);
    const again = gameReducer(same, actions.paintRobot(1, 15));
    expect(lastMessage(again)).toMatchObject({ text: 'Sprocket is already Cream.', tone: 'warn' });
    expect(again.player.gold).toBe(same.player.gold);

    const poor = withGold(atBench([benchedRobotOf()]), 49);
    const short = gameReducer(poor, actions.paintRobot(1, 7));
    expect(lastMessage(short)?.text).toBe('A paint job costs 50g.');
    expect(requireRobot(short, 1).paint).toBe(0);
    expect(short.player.gold).toBe(49);
    const exact = gameReducer(withGold(poor, 50), actions.paintRobot(1, 7));
    expect([requireRobot(exact, 1).paint, exact.player.gold]).toEqual([7, 0]);

    const field = atBench([robotOf()]);
    const away = gameReducer(field, actions.paintRobot(1, 7));
    expect(lastMessage(away)?.text).toBe('Put Sprocket on the workbench first.');
    expect(requireRobot(away, 1).paint).toBe(0);
  });

  it('ignores a paint outside the 16 and an unknown robot', () => {
    const state = atBench([benchedRobotOf()]);
    for (const paint of [16, -1, 1.5, Number.NaN]) expect(gameReducer(state, actions.paintRobot(1, paint))).toBe(state);
    expect(gameReducer(state, actions.paintRobot(9, 1))).toBe(state);
  });

  it('never changes what a robot does', () => {
    const steps = [{ kind: 'move' as const }, { kind: 'turn' as const, side: 'right' as const }];
    const run = (paint: number): GameState => gameReducer(withRobots(BASE, [robotOf({ paint, program: { kind: 'script', steps, loop: true } })]), actions.tick(120));
    const plain = run(0);
    const painted = run(9);
    expect({ ...requireRobot(painted, 1), paint: 0 }).toEqual(requireRobot(plain, 1));
    expect(painted.robots.log).toEqual(plain.robots.log);
    expect(findRobot(painted, 1)?.paint).toBe(9);
  });
});
