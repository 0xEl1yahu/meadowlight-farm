/**
 * Picking robots up (and fishing them out), putting them down, sending broken ones for repair
 * at the shipping bin, loading the wood burner, and the rules around them.
 */
import { describe, expect, it } from 'vitest';
import { Blocker, Direction, type GameState } from '../src/core/types';
import { periodFor, resumedPower } from '../src/robots/stats';
import { requireRobot } from '../src/robots/world';
import { actions } from '../src/state/actions';
import { countItem } from '../src/state/inventory';
import { placementProblem } from '../src/state/intents';
import { gameReducer } from '../src/state/reducer';
import { blockedTile, EMPTY_TILE } from '../src/world/tiles';
import { BASE, TARGET, emptyHanded, holding, robotOf, scenario, tileAt, withEnergy, withGold, withPlayer, withRobots } from './testUtils';

const interact = (state: GameState) => gameReducer(state, actions.interact());
const lastText = (state: GameState) => state.messages.entries.at(-1)?.text;
const carrying = (state: GameState, id = 1) => withRobots({ ...state, player: { ...state.player, carrying: id } }, [robotOf({ carried: true })]);

describe('picking robots up', () => {
  it('costs carry energy and stops the robot', () => {
    const state = withRobots(emptyHanded(scenario(EMPTY_TILE)), [robotOf()]);
    const next = interact(state);
    expect(next.player.carrying).toBe(1);
    expect(requireRobot(next, 1).carried).toBe(true);
    expect(next.player.energy).toBe(state.player.energy - 4);
    expect(requireRobot(gameReducer(next, actions.tick(60)), 1).actionSeq).toBe(0);
  });

  it('refuses when the player is too tired', () => {
    const state = withEnergy(withRobots(emptyHanded(scenario(EMPTY_TILE)), [robotOf({ size: 'big' })]), 10);
    expect(lastText(interact(state))).toBe("You're too tired to carry Sprocket.");
  });

  it('fishes a broken robot out of the water for the same energy', () => {
    const state = withRobots(emptyHanded(scenario(blockedTile(Blocker.Water))), [robotOf({ power: 'broken' })]);
    const next = interact(state);
    expect(next.player.carrying).toBe(1);
    expect(next.player.energy).toBe(state.player.energy - 4);
  });
});

describe('putting robots down', () => {
  it('resumes the program on open ground, facing the way the player faces', () => {
    const base = scenario(EMPTY_TILE);
    const robot = robotOf({ carried: true, tx: 2, tz: 2, facing: Direction.North, nextActMinute: 0, pc: 3 });
    const state = withRobots({ ...base, time: { ...base.time, minuteOfDay: 500 }, player: { ...base.player, carrying: 1 } }, [robot]);
    const next = interact(state);
    expect(next.player.carrying).toBeNull();
    expect(requireRobot(next, 1)).toMatchObject({
      carried: false,
      tx: TARGET.tx,
      tz: TARGET.tz,
      facing: state.player.facing,
      power: 'working',
      pc: 3,
      nextActMinute: 500 + periodFor(robot),
      teleportSeq: 1,
    });
  });

  it('puts down a robot with no tokens left as flat', () => {
    const state = withRobots(scenario(EMPTY_TILE), [robotOf({ carried: true, tokens: 0 })]);
    const next = interact({ ...state, player: { ...state.player, carrying: 1 } });
    expect(requireRobot(next, 1).power).toBe(resumedPower({ power: 'working', tokens: 0 }));
    expect(requireRobot(next, 1).power).toBe('flat');
  });

  it('works with Space too, and refuses rocks', () => {
    expect(gameReducer(carrying(scenario(EMPTY_TILE)), actions.useTool()).player.carrying).toBeNull();
    expect(lastText(interact(carrying(scenario(blockedTile(Blocker.Rock, 2)))))).toBe('Put Sprocket down on open ground.');
  });

  it('keeps a broken robot broken on land', () => {
    const state = withRobots({ ...scenario(EMPTY_TILE), player: { ...scenario(EMPTY_TILE).player, carrying: 1 } }, [robotOf({ carried: true, power: 'broken' })]);
    expect(requireRobot(interact(state), 1).power).toBe('broken');
  });
});

describe('repairs at the shipping bin', () => {
  const atBin = (state: GameState) => withPlayer(state, { tx: 9, tz: 6 }, Direction.North);

  it('sends a broken robot off for gold, back tomorrow', () => {
    const state = withRobots(atBin({ ...BASE, player: { ...BASE.player, carrying: 1 } }), [robotOf({ carried: true, power: 'broken' })]);
    const next = interact(state);
    expect(next.player.gold).toBe(state.player.gold - 300);
    expect(next.player.carrying).toBeNull();
    expect(requireRobot(next, 1)).toMatchObject({ power: 'repairing', repairReadyDay: 1, carried: false });
    expect(lastText(next)).toBe('Sprocket is off to be repaired. Back tomorrow.');
  });

  it('refuses without the gold, and refuses robots that are not broken', () => {
    const broke = withGold(withRobots(atBin({ ...BASE, player: { ...BASE.player, carrying: 1 } }), [robotOf({ carried: true, power: 'broken' })]), 10);
    expect(lastText(interact(broke))).toBe('Repairs cost 300g.');
    const fine = withRobots(atBin({ ...BASE, player: { ...BASE.player, carrying: 1 } }), [robotOf({ carried: true })]);
    expect(lastText(interact(fine))).toBe('Only broken robots go for repair.');
  });
});

describe('the rest', () => {
  it('refuses to leave the farm while carrying', () => {
    const atGate = withPlayer(carrying(BASE), { tx: 0, tz: 13 }, Direction.West);
    const next = gameReducer(atGate, actions.move(Direction.West));
    expect(next.player.mapId).toBe('farm');
    expect(lastText(next)).toBe('Put Sprocket down before you leave the farm.');
  });

  it('loads a wood burner from the held wood, up to 10', () => {
    const burner = { ...EMPTY_TILE, object: { kind: 'woodBurner' as const, fuel: 3 } };
    const loaded = interact(holding(scenario(burner), 'wood', 25));
    expect(tileAt(loaded, TARGET, 'farm').object).toEqual({ kind: 'woodBurner', fuel: 10 });
    expect(countItem(loaded.inventory, 'wood')).toBe(18);
    expect(lastText(interact(holding(scenario({ ...burner, object: { kind: 'woodBurner', fuel: 10 } }), 'wood', 5)))).toBe('The burner is full.');
    expect(lastText(interact(emptyHanded(scenario(burner))))).toBe('3/10 wood. Load it with wood.');
  });

  it('keeps placed objects off a robot', () => {
    const state = withRobots(scenario(EMPTY_TILE), [robotOf()]);
    expect(placementProblem(state, 'chest', TARGET)).toBe("There's a robot in the way.");
  });
});
