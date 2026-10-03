/**
 * Routes and DON'T checks (farmclaws part 2 spec §5.3, §6.2): shortest paths in a fixed order,
 * the cards that shape them, and what each DON'T card forbids.
 */
import { describe, expect, it } from 'vitest';
import { Blocker, Direction, TileState, type GameState, type MdCard, type TileCoord } from '../src/core/types';
import { dontForbids, keptItems, moveForbiddenBy } from '../src/robots/md';
import { nextRouteAction, planRoute, reachableFrom, reachableInOrder } from '../src/robots/route';
import { blockedTile } from '../src/world/tiles';
import { BASE, TARGET, matureCrop, robotOf, soilTile, stack, withTile, withZones } from './testUtils';

const rockAt = (state: GameState, ...tiles: TileCoord[]): GameState =>
  tiles.reduce((s, t) => withTile(s, t, blockedTile(Blocker.Rock, 2), 'farm'), state);
const waterAt = (state: GameState, ...tiles: TileCoord[]): GameState =>
  tiles.reduce((s, t) => withTile(s, t, blockedTile(Blocker.Water), 'farm'), state);
const tiles = (...coords: [number, number][]): TileCoord[] => coords.map(([tx, tz]) => ({ tx, tz }));

const WATER: MdCard = { kind: 'dontGoIntoWater' };
const LEAVE_A: MdCard = { kind: 'dontLeave', zone: 'A' };
/** Zone A: x 4…6, z 9…11, around TARGET (5, 10). */
const ZONE_A = { x0: 4, z0: 9, w: 3, d: 3 };

describe('reachableFrom', () => {
  it('holds the start and every tile planRoute can reach, and none behind a wall', () => {
    const boxed = rockAt(BASE, { tx: 5, tz: 9 }, { tx: 6, tz: 10 }, { tx: 5, tz: 11 }, { tx: 4, tz: 10 });
    const reach = reachableFrom(boxed, robotOf());
    expect([...reach]).toEqual(['5,10']);
    const open = reachableFrom(BASE, robotOf());
    expect(open.has('5,10') && open.has('5,13')).toBe(true);
    for (const t of [{ tx: 7, tz: 12 }, { tx: 2, tz: 9 }]) expect(open.has(`${t.tx},${t.tz}`)).toBe(planRoute(BASE, robotOf(), t) !== null);
  });

  it("stays inside a DON'T leave zone and skips rocks", () => {
    const state = rockAt(withZones(BASE, { A: ZONE_A }), { tx: 6, tz: 10 });
    const reach = reachableFrom(state, robotOf({ md: [LEAVE_A] }));
    expect(reach.has('6,10')).toBe(false);
    expect(reach.has('4,9')).toBe(true);
    expect(reach.has('5,12')).toBe(false);
  });
});

describe('planRoute', () => {
  it('goes straight to a tile in line', () => {
    expect(planRoute(BASE, robotOf(), { tx: 5, tz: 13 })).toEqual(tiles([5, 11], [5, 12], [5, 13]));
  });

  it('is [] on the target and null for a target nobody can stand on', () => {
    expect(planRoute(BASE, robotOf(), TARGET)).toEqual([]);
    expect(planRoute(rockAt(BASE, { tx: 5, tz: 12 }), robotOf(), { tx: 5, tz: 12 })).toBeNull();
    expect(planRoute(waterAt(BASE, { tx: 5, tz: 12 }), robotOf(), { tx: 5, tz: 12 })).toBeNull();
    expect(planRoute(BASE, robotOf(), { tx: -1, tz: 10 })).toBeNull();
  });

  it('goes round a rock, breaking ties in DIRECTIONS order (exact path)', () => {
    expect(planRoute(rockAt(BASE, { tx: 5, tz: 11 }), robotOf(), { tx: 5, tz: 12 })).toEqual(tiles([6, 10], [6, 11], [6, 12], [5, 12]));
    expect(planRoute(BASE, robotOf(), { tx: 7, tz: 12 })).toEqual(tiles([6, 10], [7, 10], [7, 11], [7, 12]));
  });

  it('goes round water like any obstacle', () => {
    const path = planRoute(waterAt(BASE, { tx: 5, tz: 11 }), robotOf(), { tx: 5, tz: 12 });
    expect(path).toEqual(tiles([6, 10], [6, 11], [6, 12], [5, 12]));
  });

  it('is null when walled in', () => {
    const walled = rockAt(BASE, { tx: 5, tz: 9 }, { tx: 6, tz: 10 }, { tx: 5, tz: 11 }, { tx: 4, tz: 10 });
    expect(planRoute(walled, robotOf(), { tx: 5, tz: 13 })).toBeNull();
  });

  it("keeps a robot inside its DON'T leave zone, and lets one outside walk in", () => {
    const state = withZones(BASE, { A: ZONE_A });
    expect(planRoute(state, robotOf({ md: [LEAVE_A] }), { tx: 5, tz: 13 })).toBeNull();
    expect(planRoute(state, robotOf({ md: [LEAVE_A] }), { tx: 6, tz: 11 })).toEqual(tiles([6, 10], [6, 11]));
    expect(planRoute(state, robotOf({ md: [LEAVE_A], tz: 13 }), TARGET)).toEqual(tiles([5, 12], [5, 11], [5, 10]));
    expect(planRoute(state, robotOf(), { tx: 5, tz: 13 })).toEqual(tiles([5, 11], [5, 12], [5, 13]));
  });

  it('is null when the only way inside the zone leads out of it', () => {
    const row = withZones(rockAt(BASE, { tx: 5, tz: 10 }), { A: { x0: 4, z0: 10, w: 3, d: 1 } });
    const robot = robotOf({ tx: 4, tz: 10, md: [LEAVE_A] });
    expect(planRoute(row, robot, { tx: 6, tz: 10 })).toBeNull();
    expect(planRoute(row, robotOf({ tx: 4, tz: 10 }), { tx: 6, tz: 10 })).toEqual(tiles([4, 9], [5, 9], [6, 9], [6, 10]));
  });

  it("never steps into water with DON'T go into water", () => {
    const pond = waterAt(BASE, { tx: 5, tz: 11 }, { tx: 6, tz: 11 });
    const path = planRoute(pond, robotOf({ md: [WATER] }), { tx: 5, tz: 12 });
    expect(path).toEqual(tiles([4, 10], [4, 11], [4, 12], [5, 12]));
  });
});

describe('nextRouteAction', () => {
  it('moves when facing the next tile, otherwise takes the shorter turn (right on a tie)', () => {
    const robot = { tx: 5, tz: 10, facing: Direction.South };
    expect(nextRouteAction(robot, { tx: 5, tz: 11 })).toEqual({ kind: 'move' });
    expect(nextRouteAction(robot, { tx: 6, tz: 10 })).toEqual({ kind: 'turn', side: 'left' });
    expect(nextRouteAction(robot, { tx: 4, tz: 10 })).toEqual({ kind: 'turn', side: 'right' });
    expect(nextRouteAction(robot, { tx: 5, tz: 9 })).toEqual({ kind: 'turn', side: 'right' });
    expect(nextRouteAction({ ...robot, facing: Direction.North }, { tx: 6, tz: 10 })).toEqual({ kind: 'turn', side: 'right' });
    expect(nextRouteAction({ ...robot, facing: Direction.North }, { tx: 4, tz: 10 })).toEqual({ kind: 'turn', side: 'left' });
  });
});

describe("what DON'T cards forbid", () => {
  const zoned = withZones(BASE, { A: ZONE_A });

  it("DON'T leave: a move from inside the zone to outside it", () => {
    const out = robotOf({ tx: 5, tz: 11, md: [LEAVE_A] });
    expect(dontForbids(zoned, out, { kind: 'move' })).toEqual(LEAVE_A);
    expect(dontForbids(zoned, robotOf({ md: [LEAVE_A] }), { kind: 'move' })).toBeNull();
    expect(dontForbids(zoned, robotOf({ tz: 13, md: [LEAVE_A] }), { kind: 'move' })).toBeNull();
    expect(dontForbids(zoned, out, { kind: 'turn', side: 'left' })).toBeNull();
    expect(dontForbids(BASE, out, { kind: 'move' })).toBeNull();
  });

  it("DON'T go into water: a move onto water", () => {
    const wet = waterAt(BASE, { tx: 5, tz: 11 });
    expect(dontForbids(wet, robotOf({ md: [WATER] }), { kind: 'move' })).toEqual(WATER);
    expect(dontForbids(BASE, robotOf({ md: [WATER] }), { kind: 'move' })).toBeNull();
    expect(dontForbids(wet, robotOf(), { kind: 'move' })).toBeNull();
  });

  it("DON'T harvest: a harvest on a tile with that crop", () => {
    const card: MdCard = { kind: 'dontHarvest', cropId: 'pumpkin' };
    const robot = robotOf({ md: [card] });
    const pumpkin = withTile(BASE, TARGET, soilTile(TileState.Watered, matureCrop('pumpkin')), 'farm');
    const parsnip = withTile(BASE, TARGET, soilTile(TileState.Watered, matureCrop('parsnip')), 'farm');
    expect(dontForbids(pumpkin, robot, { kind: 'harvest' })).toEqual(card);
    expect(dontForbids(parsnip, robot, { kind: 'harvest' })).toBeNull();
    expect(dontForbids(BASE, robot, { kind: 'harvest' })).toBeNull();
    expect(dontForbids(pumpkin, robot, { kind: 'water' })).toBeNull();
  });

  it("DON'T deposit: only when every stack in the bag is kept", () => {
    const wood: MdCard = { kind: 'dontDeposit', itemId: 'wood' };
    const parsnip: MdCard = { kind: 'dontDeposit', itemId: 'parsnip' };
    const md = [wood, parsnip];
    expect(dontForbids(BASE, robotOf({ md, bag: [stack('parsnip', 3)] }), { kind: 'deposit' })).toEqual(parsnip);
    expect(dontForbids(BASE, robotOf({ md, size: 'standard', bag: [stack('parsnip', 3), stack('wood', 2)] }), { kind: 'deposit' })).toEqual(wood);
    expect(dontForbids(BASE, robotOf({ md, size: 'standard', bag: [stack('parsnip', 3), stack('stone', 2)] }), { kind: 'deposit' })).toBeNull();
    expect(dontForbids(BASE, robotOf({ md }), { kind: 'deposit' })).toBeNull();
  });

  it('names the first card in .MD order when two forbid the same move', () => {
    const state = waterAt(zoned, { tx: 5, tz: 12 });
    const robot = robotOf({ tx: 5, tz: 11, md: [WATER, LEAVE_A] });
    expect(dontForbids(state, robot, { kind: 'move' })).toEqual(WATER);
    expect(dontForbids(state, { ...robot, md: [LEAVE_A, WATER] }, { kind: 'move' })).toEqual(LEAVE_A);
    expect(moveForbiddenBy(robot, { tx: 5, tz: 11 }, { tx: 6, tz: 11 }, state)).toBeNull();
  });

  it('keeps the items of every DON\'T deposit card', () => {
    const md: MdCard[] = [{ kind: 'dontDeposit', itemId: 'parsnip' }, LEAVE_A, { kind: 'dontDeposit', itemId: 'wood' }];
    expect([...keptItems(robotOf({ md }))]).toEqual(['parsnip', 'wood']);
    expect(keptItems(robotOf()).size).toBe(0);
  });
});

describe('reachableInOrder', () => {
  it('lists the robot tile first, then tiles by non-decreasing step count, matching reachableFrom', () => {
    const state = waterAt(BASE, ...tiles([5, 11]));
    const robot = robotOf({ tx: 5, tz: 10 });
    const list = reachableInOrder(state, robot);
    expect(list[0]).toEqual({ tile: { tx: 5, tz: 10 }, steps: 0 });
    expect(list.every((r, i) => i === 0 || r.steps >= (list[i - 1]?.steps ?? 0))).toBe(true);
    expect(list.find((r) => r.tile.tx === 5 && r.tile.tz === 11)).toBeUndefined();
    expect(list.find((r) => r.tile.tx === 5 && r.tile.tz === 12)?.steps).toBe(4);
    expect(new Set(list.map((r) => `${r.tile.tx},${r.tile.tz}`))).toEqual(reachableFrom(state, robot));
  });
});
