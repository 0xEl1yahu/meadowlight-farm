/**
 * The workbench (farmclaws part 3 spec §2.1, §2.2, §2.4): where it stands on new farms, putting a
 * robot on it, reopening its screen, lifting the robot off, the on/off switch, and benched robots
 * through the day and the night. Its save rules and migration are in robotSaveV6.test.ts; the
 * bench-only program and .MD edits in robotEdits.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { INVENTORY, PLAYER, ROBOTS, WORKBENCH, WORLD } from '../src/config';
import { Direction, MAP_IDS, TileState, type GameState, type Robot, type TileCoord } from '../src/core/types';
import { b } from '../src/robots/blocks';
import { morningExec } from '../src/robots/exec';
import { freeSpotNear, robotOnBench, withWorkbenchAt, workbenchTile } from '../src/robots/workbench';
import { requireRobot, robotsOnTile } from '../src/robots/world';
import { benchLift } from '../src/render/robotLayout';
import { actions } from '../src/state/actions';
import { createInitialState } from '../src/state/initialState';
import { describeIntent, planInteraction, planPrimaryAction } from '../src/state/intents';
import { gameReducer, startNextDay } from '../src/state/reducer';
import { EMPTY_TILE, forEachTile } from '../src/world/tiles';
import {
  BASE,
  benchedRobotOf,
  emptyHanded,
  holding,
  matureCrop,
  robotOf,
  soilTile,
  tileAt,
  withEnergy,
  withPlayer,
  withRobots,
  withTile,
} from './testUtils';

const HOME: TileCoord = WORKBENCH.home;
/** The tile south of the bench; the player stands here facing North to use it. */
const AT_BENCH: TileCoord = { tx: HOME.tx, tz: HOME.tz + 1 };
const atBench = (state: GameState): GameState => withPlayer(state, AT_BENCH, Direction.North);
const interact = (state: GameState): GameState => gameReducer(state, actions.interact());
const lastText = (state: GameState): string | undefined => state.messages.entries.at(-1)?.text;
const chest = { kind: 'chest' as const, slots: new Array<null>(INVENTORY.chestSlots).fill(null) };

/** At the bench, carrying robot 1 (Sprocket) plus any `others`. */
function carryingAtBench(overrides: Partial<Robot> = {}, others: readonly Robot[] = []): GameState {
  const state = withRobots({ ...BASE, player: { ...BASE.player, carrying: 1 } }, [robotOf({ carried: true, ...overrides }), ...others]);
  return atBench(state);
}

/** At the bench, empty-handed, with `robot` on it. */
const benched = (robot: Robot = benchedRobotOf()): GameState => atBench(emptyHanded(withRobots(BASE, [robot])));

describe('the workbench on the farm', () => {
  it('stands at WORKBENCH.home on every new farm, the only one on any map', () => {
    expect(WORKBENCH).toEqual({ home: { tx: 6, tz: 4 }, topHeight: 0.55 });
    for (const seed of [WORLD.seed, 0, 1, 7, 12345, 0xffffffff]) {
      const state = createInitialState(seed);
      expect(workbenchTile(state.maps.farm), `seed ${seed}`).toEqual(HOME);
      expect(tileAt(state, HOME, 'farm')).toEqual({ ...EMPTY_TILE, object: { kind: 'workbench' } });
      let benches = 0;
      for (const id of MAP_IDS) {
        forEachTile(state.maps[id], (tile) => {
          if (tile.object?.kind === 'workbench') benches++;
        });
      }
      expect(benches, `seed ${seed}`).toBe(1);
    }
  });

  it('finds the nearest free tile breadth-first, in DIRECTIONS order, when home is built on', () => {
    const bare = withTile(BASE, HOME, EMPTY_TILE, 'farm');
    expect(freeSpotNear(bare.maps.farm, HOME, [])).toEqual(HOME);
    const built = withTile(bare, HOME, { ...EMPTY_TILE, object: chest }, 'farm').maps.farm;
    expect(freeSpotNear(built, HOME, [])).toEqual({ tx: 6, tz: 3 });
    expect(freeSpotNear(built, HOME, [{ tx: 6, tz: 3 }])).toEqual({ tx: 7, tz: 4 });
    expect(freeSpotNear(built, HOME, [{ tx: 6, tz: 3 }, { tx: 7, tz: 4 }])).toEqual({ tx: 6, tz: 5 });
    // West of home grows a wild mushroom on this seed, so the search moves on to the next ring.
    expect(tileAt(BASE, { tx: 5, tz: 4 }, 'farm').crop?.wild).toBe(true);
    expect(freeSpotNear(built, HOME, [{ tx: 6, tz: 3 }, { tx: 7, tz: 4 }, { tx: 6, tz: 5 }])).toEqual({ tx: 6, tz: 2 });
  });

  it('never picks fertilised or planted soil, a path or a reserved tile', () => {
    let state = withTile(BASE, HOME, { ...EMPTY_TILE, object: chest }, 'farm');
    state = withTile(state, { tx: 6, tz: 3 }, { ...soilTile(TileState.Plowed), fertilizer: 'basic' }, 'farm');
    state = withTile(state, { tx: 7, tz: 4 }, soilTile(TileState.Watered, matureCrop('parsnip')), 'farm');
    state = withTile(state, { tx: 6, tz: 5 }, { ...EMPTY_TILE, object: { kind: 'woodPath' } }, 'farm');
    expect(freeSpotNear(state.maps.farm, HOME, [])).toEqual({ tx: 6, tz: 2 });
    expect(() => withWorkbenchAt(state.maps.farm, { tx: 6, tz: 3 })).toThrow();
    expect(() => withWorkbenchAt(BASE.maps.farm, { tx: 0, tz: 13 })).toThrow();
    expect(() => withWorkbenchAt(BASE.maps.farm, HOME)).toThrow();
  });

  it('blocks the player, and the pickaxe and axe refuse it', () => {
    const state = atBench(BASE);
    expect(gameReducer(state, actions.move(Direction.North)).player).toMatchObject(AT_BENCH);
    for (const tool of ['pickaxe', 'axe'] as const) {
      const holdingTool = holding(state, tool);
      expect(planPrimaryAction(holdingTool).intent).toEqual({ kind: 'blocked', reason: "It's part of the farm." });
      const next = gameReducer(holdingTool, actions.useTool());
      expect(lastText(next)).toBe("It's part of the farm.");
      expect(tileAt(next, HOME, 'farm')).toBe(tileAt(state, HOME, 'farm'));
    }
  });

  it('lifts a robot on the bench onto the bench top when drawn', () => {
    expect(benchLift({ onBench: true })).toBe(WORKBENCH.topHeight);
    expect(benchLift({ onBench: false })).toBe(0);
  });
});

describe('putting a robot on the bench', () => {
  it('benches the carried robot facing the way the player faces, and opens its screen', () => {
    const state = carryingAtBench({ tx: 2, tz: 12, facing: Direction.East, power: 'standby', off: 'dizzy', tokens: 33 });
    expect(describeIntent(planInteraction(state).intent)).toBe('Put Sprocket on the bench');
    const next = interact(state);
    expect(next.player.carrying).toBeNull();
    expect(next.player.energy).toBe(state.player.energy);
    expect(requireRobot(next, 1)).toMatchObject({
      carried: false,
      onBench: true,
      tx: HOME.tx,
      tz: HOME.tz,
      facing: Direction.North,
      teleportSeq: 1,
      power: 'standby',
      off: 'dizzy',
      tokens: 33,
    });
    expect(next.ui.panel).toEqual({ kind: 'robot', robotId: 1, mode: 'bench' });
    expect(robotOnBench(next)?.id).toBe(1);
    expect(robotsOnTile(next, HOME.tx, HOME.tz)).toEqual([]);
  });

  it('works with Space too', () => {
    const next = gameReducer(holding(carryingAtBench(), 'hoe'), actions.useTool());
    expect(requireRobot(next, 1).onBench).toBe(true);
  });

  it('refuses an occupied bench', () => {
    const state = carryingAtBench({}, [benchedRobotOf({ id: 2, name: 'Bolt' })]);
    const next = interact(state);
    expect(lastText(next)).toBe("There's already a robot on the bench.");
    expect(next.player.carrying).toBe(1);
    expect(requireRobot(next, 1).carried).toBe(true);
    expect(next.ui.panel).toEqual({ kind: 'none' });
  });

  it('reopens the screen of the robot on the bench, and never picks it up', () => {
    const state = benched();
    expect(describeIntent(planInteraction(state).intent)).toBe('Work on Sprocket');
    const next = interact(state);
    expect(next.ui.panel).toEqual({ kind: 'robot', robotId: 1, mode: 'bench' });
    expect(next.player.carrying).toBeNull();
    expect(next.player.energy).toBe(state.player.energy);
    expect(requireRobot(next, 1)).toBe(requireRobot(state, 1));
  });

  it('says what the empty bench is for, as the hint and as a toast', () => {
    const state = atBench(emptyHanded(BASE));
    expect(describeIntent(planInteraction(state).intent)).toBe('Bring a robot here to work on it');
    const next = interact(state);
    expect(lastText(next)).toBe('Bring a robot here to work on it');
    expect(next.ui.panel).toEqual({ kind: 'none' });
    expect(next.maps).toBe(state.maps);
    expect(next.robots).toBe(state.robots);
  });
});

describe('lifting a robot off the bench', () => {
  it("costs carry energy, puts the robot in the player's arms and closes its screen", () => {
    const open = interact(benched());
    const next = gameReducer(open, actions.liftOffBench(1));
    expect(next.player.carrying).toBe(1);
    expect(next.player.energy).toBe(open.player.energy - ROBOTS.carryEnergy.mini);
    expect(requireRobot(next, 1)).toMatchObject({ onBench: false, carried: true });
    expect(next.ui.panel).toEqual({ kind: 'none' });
    // Put down with part 1's put-down, beside the bench.
    const down = interact(gameReducer(next, actions.face(Direction.East)));
    expect(down.player.carrying).toBeNull();
    expect(requireRobot(down, 1)).toMatchObject({ carried: false, onBench: false, tx: AT_BENCH.tx + 1, tz: AT_BENCH.tz, power: 'working' });
  });

  it("refuses with part 1's too-tired text and keeps the screen open", () => {
    const open = withEnergy(interact(benched(benchedRobotOf({ size: 'big' }))), ROBOTS.carryEnergy.big - 1);
    const next = gameReducer(open, actions.liftOffBench(1));
    expect(lastText(next)).toBe("You're too tired to carry Sprocket.");
    expect(requireRobot(next, 1).onBench).toBe(true);
    expect(next.ui.panel).toEqual({ kind: 'robot', robotId: 1, mode: 'bench' });
  });

  it('does nothing for a robot off the bench, an unknown robot, or while carrying another', () => {
    const field = withRobots(BASE, [robotOf()]);
    expect(gameReducer(field, actions.liftOffBench(1))).toBe(field);
    expect(gameReducer(field, actions.liftOffBench(9))).toBe(field);
    const busy = carryingAtBench({}, [benchedRobotOf({ id: 2, name: 'Bolt' })]);
    expect(gameReducer(busy, actions.liftOffBench(2))).toBe(busy);
  });
});

describe('the on/off switch', () => {
  it("switches a benched robot off whatever its off reason, and on only from 'player', for free", () => {
    const dizzy = benched(benchedRobotOf({ off: 'dizzy' }));
    const off = gameReducer(dizzy, actions.switchRobot(1, false));
    expect(requireRobot(off, 1).off).toBe('player');
    expect([off.player.gold, off.player.energy]).toEqual([dizzy.player.gold, dizzy.player.energy]);
    expect(requireRobot(gameReducer(off, actions.switchRobot(1, true)), 1).off).toBeNull();
    expect(gameReducer(dizzy, actions.switchRobot(1, true))).toBe(dizzy);
    expect(gameReducer(off, actions.switchRobot(1, false))).toBe(off);
  });

  it('refuses a robot that is not on the bench', () => {
    const field = withRobots(BASE, [robotOf()]);
    const next = gameReducer(field, actions.switchRobot(1, false));
    expect(lastText(next)).toBe('Put Sprocket on the workbench first.');
    expect(requireRobot(next, 1).off).toBeNull();
  });

  it('refuses to switch off a broken robot, whose save would not load', () => {
    const broken = benched(benchedRobotOf({ power: 'broken' }));
    const next = gameReducer(broken, actions.switchRobot(1, false));
    expect(lastText(next)).toBe("Sprocket can't be switched off while it's broken.");
    expect(next.messages.entries.at(-1)?.tone).toBe('warn');
    expect(next.robots).toBe(broken.robots);
    expect(gameReducer(broken, actions.switchRobot(1, true))).toBe(broken);
  });

  it('switches off a flat robot', () => {
    const flat = benched(benchedRobotOf({ power: 'flat', tokens: 0 }));
    expect(requireRobot(gameReducer(flat, actions.switchRobot(1, false)), 1).off).toBe('player');
  });

  it('keeps a switched-off robot from acting, a script robot included', () => {
    const off = withRobots(BASE, [robotOf({ off: 'player' })]);
    expect(requireRobot(gameReducer(off, actions.tick(60)), 1).actionSeq).toBe(0);
    const on = withRobots(BASE, [robotOf()]);
    expect(requireRobot(gameReducer(on, actions.tick(60)), 1).actionSeq).toBeGreaterThan(0);
  });

  it("keeps 'player' through the morning, while dizzy and done clear", () => {
    const state = withRobots(BASE, [
      robotOf({ off: 'player' }),
      robotOf({ id: 2, name: 'Bolt', tx: 4, tz: 10, off: 'dizzy' }),
      robotOf({ id: 3, name: 'Cog', tx: 3, tz: 10, power: 'standby', off: 'done' }),
    ]);
    const morning = startNextDay(state, false);
    expect(morning.robots.list.map((r) => r.off)).toEqual(['player', null, null]);
    expect(requireRobot(gameReducer(morning, actions.tick(60)), 1).actionSeq).toBe(0);
  });
});

describe('benched robots through the day and the night', () => {
  const SPIN = b.program({ stacks: [b.when(b.morning(), b.forever(b.turn('right')))] });

  it('never act, however due they are', () => {
    for (const robot of [benchedRobotOf(), benchedRobotOf({ program: SPIN, exec: morningExec(SPIN) })]) {
      const state = withRobots(BASE, [robot]);
      const later = gameReducer(state, actions.tick(120));
      expect(requireRobot(later, 1)).toBe(requireRobot(state, 1));
    }
  });

  it('recharge within reach of a burner and stay on the bench through the morning', () => {
    const burner = { tx: HOME.tx + ROBOTS.chargeRadius, tz: HOME.tz };
    const state = withTile(withRobots(BASE, [benchedRobotOf({ tokens: 50 })]), burner, { ...EMPTY_TILE, object: { kind: 'woodBurner', fuel: 5 } }, 'farm');
    const morning = startNextDay(state, false);
    expect(requireRobot(morning, 1)).toMatchObject({ onBench: true, tx: HOME.tx, tz: HOME.tz, tokens: 80, teleportSeq: 0, power: 'working' });
  });

  it('miss the recharge out of reach, like any robot, and still stay on the bench', () => {
    const morning = startNextDay(withRobots(BASE, [benchedRobotOf({ tokens: 50 })]), false);
    expect(requireRobot(morning, 1)).toMatchObject({ onBench: true, tx: HOME.tx, tz: HOME.tz, tokens: 50 });
    expect(morning.messages.entries.map((m) => m.text)).toContain("Sprocket ended the day away from a generator and didn't recharge.");
  });

  it('stay put while a carried robot is still set down at spawn', () => {
    const state = withRobots({ ...BASE, player: { ...BASE.player, carrying: 1 } }, [robotOf({ carried: true }), benchedRobotOf({ id: 2, name: 'Bolt' })]);
    const morning = startNextDay(state, false);
    expect(requireRobot(morning, 1)).toMatchObject({ carried: false, onBench: false, tx: PLAYER.spawn.tx, tz: PLAYER.spawn.tz });
    expect(requireRobot(morning, 2)).toMatchObject({ onBench: true, tx: HOME.tx, tz: HOME.tz });
    expect(morning.player.carrying).toBeNull();
  });
});
