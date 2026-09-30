/**
 * The robots' night (farmclaws part 1 spec §5.7): generators, set-down, repairs, recharge near
 * a generator, and the morning reset where robots stay where they are.
 */
import { describe, expect, it } from 'vitest';
import { INVENTORY, PLAYER, ROBOTS, TIME } from '../src/config';
import { Blocker, Direction, type GameState, type PlacedObject } from '../src/core/types';
import { resumedPower } from '../src/robots/stats';
import { requireRobot } from '../src/robots/world';
import { actions } from '../src/state/actions';
import { isValidGameState } from '../src/state/persistence';
import { gameReducer } from '../src/state/reducer';
import { blockedTile, EMPTY_TILE, GIANT_CROP_SIZE } from '../src/world/tiles';
import { BASE, TARGET, robotOf, tileAt, withRobots, withTile } from './testUtils';

const BURNER = { tx: 8, tz: 10 };
const sleep = (state: GameState) => gameReducer(state, actions.sleep());
const texts = (state: GameState) => state.messages.entries.map((m) => m.text);
const withBurner = (state: GameState, fuel: number) => withTile(state, BURNER, { ...EMPTY_TILE, object: { kind: 'woodBurner', fuel } }, 'farm');
const AWAY = "ended the day away from a generator and didn't recharge.";

/** A melon giant crop covering the 3×3 square whose top-left corner is `anchor`. */
function withGiantCrop(state: GameState, anchor: { readonly tx: number; readonly tz: number }): GameState {
  const object: PlacedObject = { kind: 'giantCrop', cropId: 'melon', anchorTx: anchor.tx, anchorTz: anchor.tz };
  let next = state;
  for (let dz = 0; dz < GIANT_CROP_SIZE; dz++) {
    for (let dx = 0; dx < GIANT_CROP_SIZE; dx++) next = withTile(next, { tx: anchor.tx + dx, tz: anchor.tz + dz }, { ...EMPTY_TILE, object }, 'farm');
  }
  return next;
}

describe('robots overnight', () => {
  it('burns the wood into the pool and records it', () => {
    const next = sleep(withBurner(BASE, 5));
    expect(next.robots.pool).toBe(30);
    expect(next.robots.lastNightFuel).toEqual({ wood: 5, tokens: 30 });
    expect(tileAt(next, BURNER, 'farm').object).toEqual({ kind: 'woodBurner', fuel: 0 });
    expect(texts(next)).toContain('Your wood burners turned 5 wood into 30 tokens.');
  });

  it('leaves the robots section untouched on a night with no robots and no wood', () => {
    expect(sleep(BASE).robots).toBe(BASE.robots);
  });

  it('recharges only robots near a generator, in id order, and says who missed out', () => {
    const near = robotOf({ id: 1, tx: 7, tz: 10, tokens: 30 });
    const alsoNear = robotOf({ id: 2, name: 'Bolt', tx: 8, tz: 12, tokens: 60 });
    const far = robotOf({ id: 3, name: 'Cog', tx: 2, tz: 12, tokens: 5 });
    // 10 wood make 60 tokens: Sprocket takes 50 to fill up, Bolt gets the last 10 of the 20 it wants.
    const next = sleep(withRobots(withBurner(BASE, 10), [near, alsoNear, far]));
    expect(requireRobot(next, 1).tokens).toBe(80);
    expect(requireRobot(next, 2).tokens).toBe(70);
    expect(requireRobot(next, 3).tokens).toBe(5);
    expect(next.robots.pool).toBe(0);
    expect(texts(next)).toContain('Not enough tokens to fully charge Bolt.');
    expect(texts(next)).toContain(`Cog ${AWAY}`);
  });

  it('names every out-of-range robot, full ones too, but never broken or repairing ones', () => {
    const full = robotOf({ id: 1, tx: 2, tz: 12, tokens: 80 });
    const low = robotOf({ id: 2, name: 'Bolt', tx: 3, tz: 12, tokens: 5, power: 'standby' });
    const broken = robotOf({ id: 3, name: 'Cog', tx: 4, tz: 12, power: 'broken' });
    const away = robotOf({ id: 4, name: 'Gear', power: 'repairing', repairReadyDay: 5 });
    const next = sleep(withRobots(BASE, [full, low, broken, away]));
    expect(texts(next)).toContain(`Sprocket and Bolt ${AWAY}`);
    expect(texts(next).some((t) => t.startsWith('Not enough tokens'))).toBe(false);
    expect(isValidGameState(next)).toBe(true);
  });

  it('leaves robots where they finished, restarts their scripts and resets the day counters', () => {
    const robot = robotOf({ tx: 12, tz: 14, facing: Direction.East, pc: 0, tokensToday: 40, power: 'standby', program: { kind: 'script', steps: [{ kind: 'turn', side: 'left' }, { kind: 'move' }], loop: false } });
    const next = sleep(withRobots(BASE, [{ ...robot, pc: 1 }]));
    expect(requireRobot(next, 1)).toMatchObject({ tx: 12, tz: 14, facing: Direction.East, pc: 0, tokensToday: 0, power: 'working', nextActMinute: TIME.dayStartMinute + 4 });
    const flat = sleep(withRobots(BASE, [robotOf({ tokens: 0, power: 'flat' })]));
    expect(requireRobot(flat, 1).power).toBe('flat');
    const quick = sleep(withRobots(BASE, [robotOf({ parts: ['quickCore'] })]));
    expect(requireRobot(quick, 1).nextActMinute).toBe(TIME.dayStartMinute + ROBOTS.quickCorePeriod);
  });

  it('moves a robot off a tile that grew weeds overnight (review focus 4)', () => {
    const state = withRobots(withTile(BASE, TARGET, blockedTile(Blocker.Weeds), 'farm'), [robotOf()]);
    const next = sleep(state);
    const robot = requireRobot(next, 1);
    expect([robot.tx, robot.tz]).toEqual([TARGET.tx, TARGET.tz - 1]);
    expect(robot.teleportSeq).toBe(1);
    expect(isValidGameState(next)).toBe(true);
  });

  it('moves a robot out from under a giant crop (review focus 4)', () => {
    // The melon covers (4..6, 10..12); the nearest walkable tile to TARGET is the one North of it.
    const state = withRobots(withGiantCrop(BASE, { tx: TARGET.tx - 1, tz: TARGET.tz }), [robotOf()]);
    const next = sleep(state);
    expect(requireRobot(next, 1)).toMatchObject({ tx: TARGET.tx, tz: TARGET.tz - 1, teleportSeq: 1, power: 'working' });
    expect(isValidGameState(next)).toBe(true);
  });

  it('moves a broken robot on land off a tile that grew weeds, and it stays broken (review focus 4)', () => {
    const state = withRobots(withTile(BASE, TARGET, blockedTile(Blocker.Weeds), 'farm'), [robotOf({ power: 'broken' })]);
    const next = sleep(state);
    expect(requireRobot(next, 1)).toMatchObject({ tx: TARGET.tx, tz: TARGET.tz - 1, teleportSeq: 1, power: 'broken' });
    expect(isValidGameState(next)).toBe(true);
  });

  it('sets a carried robot down on the spawn tile when the day ends (review focus 1)', () => {
    const state = withRobots({ ...BASE, player: { ...BASE.player, carrying: 1 } }, [robotOf({ carried: true })]);
    const late = { ...state, time: { ...state.time, minuteOfDay: TIME.passOutMinute - 10 } };
    for (const next of [sleep(state), gameReducer(late, actions.tick(20))]) {
      expect(next.player.carrying).toBeNull();
      expect(requireRobot(next, 1)).toMatchObject({ carried: false, tx: PLAYER.spawn.tx, tz: PLAYER.spawn.tz, power: 'working' });
      expect(isValidGameState(next)).toBe(true);
    }
  });

  it('sets a carried broken robot down on the spawn tile still broken (review focus 1)', () => {
    const state = withRobots({ ...BASE, player: { ...BASE.player, carrying: 1 } }, [robotOf({ carried: true, power: 'broken' })]);
    const late = { ...state, time: { ...state.time, minuteOfDay: TIME.passOutMinute - 10 } };
    for (const next of [sleep(state), gameReducer(late, actions.tick(20))]) {
      expect(next.player.carrying).toBeNull();
      expect(requireRobot(next, 1)).toMatchObject({ carried: false, tx: PLAYER.spawn.tx, tz: PLAYER.spawn.tz, power: 'broken' });
      expect(isValidGameState(next)).toBe(true);
    }
  });

  it('brings repaired robots back charged in front of the bin, and keeps broken ones broken', () => {
    const ready = robotOf({ id: 1, power: 'repairing', repairReadyDay: 1, tokens: 0 });
    const later = robotOf({ id: 2, name: 'Bolt', power: 'repairing', repairReadyDay: 2 });
    const wet = withTile(BASE, { tx: 6, tz: 10 }, blockedTile(Blocker.Water), 'farm');
    const broken = robotOf({ id: 3, name: 'Cog', power: 'broken', tx: 6, tz: 10 });
    const next = sleep(withRobots(wet, [ready, later, broken]));
    expect(requireRobot(next, 1)).toMatchObject({ power: 'working', tx: ROBOTS.repairDropOff.tx, tz: ROBOTS.repairDropOff.tz, tokens: 80, repairReadyDay: null });
    expect(requireRobot(next, 2).power).toBe('repairing');
    expect(requireRobot(next, 3)).toMatchObject({ power: 'broken', tx: 6, tz: 10 });
    expect(texts(next)).toContain('Sprocket is back from repairs.');
    // It spent the day at the repair shop, not away from a generator.
    expect(texts(next).some((t) => t.endsWith(AWAY))).toBe(false);
    expect(isValidGameState(next)).toBe(true);
  });

  it('lands a repaired robot on the nearest walkable tile when the drop-off is blocked', () => {
    const chest = { ...EMPTY_TILE, object: { kind: 'chest' as const, slots: new Array<null>(INVENTORY.chestSlots).fill(null) } };
    const blocked = withTile(BASE, ROBOTS.repairDropOff, chest, 'farm');
    const ready = robotOf({ id: 1, power: 'repairing', repairReadyDay: 1, tokens: 0 });
    const next = sleep(withRobots(blocked, [ready]));
    expect(requireRobot(next, 1)).toMatchObject({ power: 'working', tx: 10, tz: 6 });
    expect(isValidGameState(next)).toBe(true);
  });

  it('gives a resumed robot work if it has tokens, and keeps a broken one broken', () => {
    expect(resumedPower({ power: 'standby', tokens: 3 })).toBe('working');
    expect(resumedPower({ power: 'working', tokens: 0 })).toBe('flat');
    expect(resumedPower({ power: 'broken', tokens: 50 })).toBe('broken');
  });
});
