/**
 * Peek (farmclaws part 3 spec §2.3): Shift + E on a standing robot opens its screen read-only,
 * for free, and changes nothing else. The workbench ahead keeps E's meaning, and with nothing
 * to peek at Shift + E does nothing at all, even where E would.
 */
import { describe, expect, it } from 'vitest';
import { INVENTORY, WORKBENCH } from '../src/config';
import { Blocker, Direction, type GameState } from '../src/core/types';
import { actions } from '../src/state/actions';
import { describeIntent, planInteraction, planShiftInteraction } from '../src/state/intents';
import { gameReducer } from '../src/state/reducer';
import { EMPTY_TILE, blockedTile } from '../src/world/tiles';
import { BASE, TARGET, robotOf, scenario, withEnergy, withPlayer, withRobots } from './testUtils';

const peek = (state: GameState): GameState => gameReducer(state, actions.peek());

/** Sprocket (id 1) standing on TARGET, the tile ahead of the player. */
const FIELD = withRobots(scenario(EMPTY_TILE), [robotOf()]);

/** The player just south of the workbench, facing it. */
const atBench = (state: GameState): GameState =>
  withPlayer(state, { tx: WORKBENCH.home.tx, tz: WORKBENCH.home.tz + 1 }, Direction.North);

describe('peeking at a robot', () => {
  it('plans a free peek at the standing robot ahead, hinted "Look at {name}"', () => {
    expect(planShiftInteraction(FIELD)).toEqual({
      target: TARGET,
      intent: { kind: 'peekRobot', robotId: 1, name: 'Sprocket' },
      feedback: 'none',
      energyCost: 0,
    });
    expect(describeIntent(planShiftInteraction(FIELD).intent)).toBe('Look at Sprocket');
  });

  it('opens the robot screen in peek mode and leaves the robot, energy and gold alone', () => {
    const tired = withEnergy(FIELD, 0);
    const next = peek(tired);
    expect(next.ui.panel).toEqual({ kind: 'robot', robotId: 1, mode: 'peek' });
    expect(next.robots).toBe(tired.robots);
    expect(next.player.energy).toBe(0);
    expect(next.player.gold).toBe(tired.player.gold);
    expect(next.player.carrying).toBeNull();
    expect(next.maps).toBe(tired.maps);
    expect(next.inventory).toBe(tired.inventory);
    expect(next.time).toBe(tired.time);
    expect(next.messages).toBe(tired.messages);
  });

  it('peeks at broken, dizzy and switched-off robots too: they still stand there', () => {
    const sunk = withRobots(scenario(blockedTile(Blocker.Water)), [robotOf({ power: 'broken' })]);
    expect(planShiftInteraction(sunk).intent).toEqual({ kind: 'peekRobot', robotId: 1, name: 'Sprocket' });
    for (const off of ['dizzy', 'player'] as const) {
      const state = withRobots(scenario(EMPTY_TILE), [robotOf({ off })]);
      expect(planShiftInteraction(state).intent).toEqual({ kind: 'peekRobot', robotId: 1, name: 'Sprocket' });
    }
  });

  it('peeks at the lowest id when robots share the tile', () => {
    const shared = withRobots(scenario(EMPTY_TILE), [robotOf({ id: 2, name: 'Bolt' }), robotOf({ id: 5, name: 'Dee' })]);
    expect(planShiftInteraction(shared).intent).toEqual({ kind: 'peekRobot', robotId: 2, name: 'Bolt' });
  });

  it('does nothing without a standing robot ahead, even where E would act', () => {
    const away = withRobots(scenario(EMPTY_TILE), [robotOf({ power: 'repairing', repairReadyDay: BASE.time.absoluteDay + 1 })]);
    const chest = scenario({ ...EMPTY_TILE, object: { kind: 'chest', slots: Array.from({ length: INVENTORY.chestSlots }, () => null) } });
    expect(planInteraction(chest).intent).toEqual({ kind: 'openChest' });
    for (const state of [away, chest, scenario(EMPTY_TILE)]) {
      expect(planShiftInteraction(state)).toEqual({ target: TARGET, intent: { kind: 'blocked', reason: null }, feedback: 'none', energyCost: 0 });
      expect(peek(state)).toBe(state);
    }
  });

  it('does nothing facing the edge of the world', () => {
    const atEdge = withPlayer(BASE, { tx: 5, tz: 0 }, Direction.North);
    expect(planShiftInteraction(atEdge)).toEqual({ target: null, intent: { kind: 'blocked', reason: null }, feedback: 'none', energyCost: 0 });
    expect(peek(atEdge)).toBe(atEdge);
  });

  it('is ignored while the game is frozen', () => {
    const open = gameReducer(FIELD, actions.setInventoryOpen(true));
    const paused = gameReducer(FIELD, actions.setPaused(true));
    expect(peek(open)).toBe(open);
    expect(peek(paused)).toBe(paused);
  });
});

describe('Shift + E at the workbench', () => {
  it('does exactly what E does there, never a peek', () => {
    const benched = withRobots(BASE, [robotOf({ tx: WORKBENCH.home.tx, tz: WORKBENCH.home.tz, onBench: true })]);
    const carrying = withRobots({ ...BASE, player: { ...BASE.player, carrying: 1 } }, [robotOf({ carried: true })]);
    for (const state of [atBench(BASE), atBench(benched), atBench(carrying)]) {
      expect(planShiftInteraction(state)).toEqual(planInteraction(state));
    }
    expect(planShiftInteraction(atBench(benched)).intent).toEqual({ kind: 'openBench', robotId: 1, name: 'Sprocket' });
    expect(peek(atBench(benched)).ui.panel).toEqual({ kind: 'robot', robotId: 1, mode: 'bench' });
  });
});
