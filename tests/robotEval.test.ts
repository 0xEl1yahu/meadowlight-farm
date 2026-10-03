/**
 * Zones and expression evaluation (farmclaws part 2 spec §2.1, §5.1): every expression kind and
 * every sensor, both ways, against real tiles.
 */
import { describe, expect, it } from 'vitest';
import { ROBOTS, TIME } from '../src/config';
import { Blocker, Direction, TileState, Weather, type Expr, type GameState, type Robot, type Value } from '../src/core/types';
import { b } from '../src/robots/blocks';
import { clampNumber, evaluate, type EvalContext } from '../src/robots/eval';
import { freshExec } from '../src/robots/exec';
import { inZone, snakeTiles, tileAheadOf, zoneOf } from '../src/robots/zones';
import { blockedTile, EMPTY_TILE } from '../src/world/tiles';
import { BASE, TARGET, cropOf, matureCrop, robotOf, soilTile, stack, withTile, withZones } from './testUtils';

/** TARGET is (5, 10); the default robot stands on it facing South, so the tile ahead is (5, 11). */
const AHEAD = { tx: TARGET.tx, tz: TARGET.tz + 1 };

const PROGRAM = b.program({
  vars: [b.numVar('n', 7), b.textVar('t', 'hi'), b.yesVar('y', true), b.itemVar('i', 'parsnip'), b.tileVar('home', 5, 9)],
  stacks: [b.when(b.morning(), b.move())],
});

function ctxOf(state: GameState = BASE, robot: Robot = robotOf(), vars: readonly Value[] = freshExec(PROGRAM).vars): EvalContext {
  return { state, robot, program: PROGRAM, vars };
}

const ev = (expr: Expr, state: GameState = BASE, robot: Robot = robotOf()): Value => evaluate(expr, ctxOf(state, robot));
const yes = (value: boolean): Value => ({ type: 'yesNo', value });
const num = (value: number): Value => ({ type: 'number', value });
const onTarget = (tile: Parameters<typeof withTile>[2]): GameState => withTile(BASE, TARGET, tile, 'farm');
const ahead = (tile: Parameters<typeof withTile>[2]): GameState => withTile(BASE, AHEAD, tile, 'farm');
const chest = { ...EMPTY_TILE, object: { kind: 'chest' as const, slots: Array.from({ length: 36 }, () => null) } };

describe('zones', () => {
  it('reads a zone from the save, null when empty', () => {
    const rect = { x0: 2, z0: 3, w: 3, d: 2 };
    expect(zoneOf(withZones(BASE, { A: rect }), 'A')).toEqual(rect);
    expect(zoneOf(BASE, 'B')).toBeNull();
  });

  it('knows which tiles are inside a rectangle, edges included', () => {
    const rect = { x0: 2, z0: 3, w: 3, d: 2 };
    expect([inZone(rect, 2, 3), inZone(rect, 4, 4), inZone(rect, 5, 3), inZone(rect, 2, 5), inZone(rect, 1, 3), inZone(rect, 2, 2)]).toEqual([
      true,
      true,
      false,
      false,
      false,
      false,
    ]);
  });

  it('walks a 3×2 zone in snake order and a 1×1 zone as its one tile', () => {
    expect(snakeTiles({ x0: 2, z0: 3, w: 3, d: 2 })).toEqual([
      { tx: 2, tz: 3 },
      { tx: 3, tz: 3 },
      { tx: 4, tz: 3 },
      { tx: 4, tz: 4 },
      { tx: 3, tz: 4 },
      { tx: 2, tz: 4 },
    ]);
    expect(snakeTiles({ x0: 7, z0: 9, w: 1, d: 1 })).toEqual([{ tx: 7, tz: 9 }]);
  });

  it('finds the tile ahead for each facing', () => {
    const at = (facing: Direction) => tileAheadOf({ tx: 5, tz: 10, facing });
    expect([at(Direction.North), at(Direction.East), at(Direction.South), at(Direction.West)]).toEqual([
      { tx: 5, tz: 9 },
      { tx: 6, tz: 10 },
      { tx: 5, tz: 11 },
      { tx: 4, tz: 10 },
    ]);
  });
});

describe('values', () => {
  it('evaluates every literal', () => {
    expect(ev(b.n(-12))).toEqual(num(-12));
    expect(ev(b.text('Hello'))).toEqual({ type: 'text', value: 'Hello' });
    expect(ev(b.yes(false))).toEqual(yes(false));
    expect(ev(b.item('wood'))).toEqual({ type: 'item', value: 'wood' });
    expect(ev(b.tileAt(3, 12))).toEqual({ type: 'tile', value: { tx: 3, tz: 12 } });
  });

  it("reads variables from the robot's current values, not the initials", () => {
    const vars: readonly Value[] = [num(42), { type: 'text', value: 'bye' }, yes(false), { type: 'item', value: 'wood' }, { type: 'tile', value: { tx: 1, tz: 9 } }];
    const ctx = ctxOf(BASE, robotOf(), vars);
    expect(['n', 't', 'y', 'i', 'home'].map((name) => evaluate(b.v(name), ctx))).toEqual(vars);
  });

  it('reads its own tile, the tile ahead, its tokens and its bag', () => {
    const robot = robotOf({ tokens: 33, bag: [stack('parsnip_seeds', 5)] });
    expect(ev(b.myTile(), BASE, robot)).toEqual({ type: 'tile', value: TARGET });
    expect(ev(b.tileAhead(), BASE, robot)).toEqual({ type: 'tile', value: AHEAD });
    expect(ev(b.tokensLeft(), BASE, robot)).toEqual(num(33));
    expect(ev(b.countInBag('parsnip_seeds'), BASE, robot)).toEqual(num(5));
    expect(ev(b.countInBag('wood'), BASE, robot)).toEqual(num(0));
  });

  it('gives its own tile as the tile ahead when it faces off the farm', () => {
    const robot = robotOf({ tx: 0, tz: 13, facing: Direction.West });
    expect(ev(b.tileAhead(), BASE, robot)).toEqual({ type: 'tile', value: { tx: 0, tz: 13 } });
  });

  it('does arithmetic and clamps to ±maxNumber', () => {
    expect(ev(b.add(b.n(2), b.n(3)))).toEqual(num(5));
    expect(ev(b.sub(b.n(2), b.n(3)))).toEqual(num(-1));
    expect(ev(b.mul(b.n(-4), b.n(3)))).toEqual(num(-12));
    expect(ev(b.add(b.n(ROBOTS.maxNumber), b.n(1)))).toEqual(num(ROBOTS.maxNumber));
    expect(ev(b.mul(b.n(ROBOTS.maxNumber), b.n(-ROBOTS.maxNumber)))).toEqual(num(-ROBOTS.maxNumber));
    expect([clampNumber(5), clampNumber(1_000_000), clampNumber(-1_000_000)]).toEqual([5, ROBOTS.maxNumber, -ROBOTS.maxNumber]);
  });

  it('never produces negative zero', () => {
    const result = ev(b.mul(b.n(0), b.n(-3)));
    expect(result).toEqual(num(0));
    expect(Object.is((result as { value: number }).value, 0)).toBe(true);
    expect(Object.is(clampNumber(-0), 0)).toBe(true);
  });

  it('compares numbers by order and every type by equality', () => {
    expect([ev(b.lt(b.n(1), b.n(2))), ev(b.lt(b.n(2), b.n(2))), ev(b.gt(b.n(3), b.n(2))), ev(b.gt(b.n(2), b.n(3)))]).toEqual([
      yes(true),
      yes(false),
      yes(true),
      yes(false),
    ]);
    expect([ev(b.eq(b.n(4), b.n(4))), ev(b.ne(b.n(4), b.n(4)))]).toEqual([yes(true), yes(false)]);
    expect([ev(b.eq(b.tileAt(5, 10), b.myTile())), ev(b.eq(b.tileAt(5, 11), b.myTile())), ev(b.ne(b.tileAt(6, 10), b.myTile()))]).toEqual([
      yes(true),
      yes(false),
      yes(true),
    ]);
    expect([ev(b.eq(b.item('wood'), b.item('wood'))), ev(b.eq(b.item('wood'), b.item('stone')))]).toEqual([yes(true), yes(false)]);
    expect([ev(b.eq(b.text('a'), b.text('a'))), ev(b.ne(b.yes(true), b.yes(false)))]).toEqual([yes(true), yes(true)]);
  });

  it('combines Yes/No values', () => {
    const t = b.yes(true);
    const f = b.yes(false);
    expect([ev(b.and(t, t)), ev(b.and(t, f)), ev(b.or(f, t)), ev(b.or(f, f)), ev(b.not(t)), ev(b.not(f))]).toEqual([
      yes(true),
      yes(false),
      yes(true),
      yes(false),
      yes(false),
      yes(true),
    ]);
  });
});

describe('sensors', () => {
  it('crop is ready only on a living, mature crop', () => {
    expect(ev(b.cropIsReady(), onTarget(soilTile(TileState.Watered, matureCrop('parsnip'))))).toEqual(yes(true));
    expect(ev(b.cropIsReady(), onTarget(soilTile(TileState.Watered, cropOf('parsnip'))))).toEqual(yes(false));
    expect(ev(b.cropIsReady(), onTarget(soilTile(TileState.Watered, matureCrop('parsnip', { dead: true }))))).toEqual(yes(false));
    expect(ev(b.cropIsReady(), onTarget(EMPTY_TILE))).toEqual(yes(false));
  });

  it('soil is dry when plowed but not watered', () => {
    expect(ev(b.soilIsDry(), onTarget(soilTile(TileState.Plowed)))).toEqual(yes(true));
    expect(ev(b.soilIsDry(), onTarget(soilTile(TileState.Watered)))).toEqual(yes(false));
    expect(ev(b.soilIsDry(), onTarget(EMPTY_TILE))).toEqual(yes(false));
  });

  it('tile is tilled when plowed or watered', () => {
    expect(ev(b.tileIsTilled(), onTarget(soilTile(TileState.Plowed)))).toEqual(yes(true));
    expect(ev(b.tileIsTilled(), onTarget(soilTile(TileState.Watered)))).toEqual(yes(true));
    expect(ev(b.tileIsTilled(), onTarget(EMPTY_TILE))).toEqual(yes(false));
  });

  it('crop is names the crop on its own tile', () => {
    const potatoes = onTarget(soilTile(TileState.Plowed, cropOf('potato')));
    expect(ev(b.cropIs('potato'), potatoes)).toEqual(yes(true));
    expect(ev(b.cropIs('parsnip'), potatoes)).toEqual(yes(false));
    expect(ev(b.cropIs('potato'), onTarget(EMPTY_TILE))).toEqual(yes(false));
  });

  it('bag is full at its stack capacity, basket included', () => {
    const basket = (stacks: number) => robotOf({ parts: ['basket'], bag: [stack('wood', 1), stack('stone', 1), stack('fiber', 1)].slice(0, stacks) });
    expect(ev(b.bagIsFull(), BASE, basket(3))).toEqual(yes(true));
    expect(ev(b.bagIsFull(), BASE, basket(2))).toEqual(yes(false));
    expect(ev(b.bagIsFull(), BASE, robotOf({ bag: [stack('wood', 1)] }))).toEqual(yes(true));
    expect(ev(b.bagIsFull(), BASE, robotOf())).toEqual(yes(false));
  });

  it('bag has an item when any stack holds it', () => {
    const robot = robotOf({ bag: [stack('parsnip', 2)] });
    expect([ev(b.bagHas('parsnip'), BASE, robot), ev(b.bagHas('wood'), BASE, robot)]).toEqual([yes(true), yes(false)]);
  });

  it("at edge of: inside the zone with a neighbour outside it", () => {
    const state = withZones(BASE, { A: { x0: 4, z0: 9, w: 3, d: 3 } });
    expect(ev(b.atEdgeOf('A'), state, robotOf({ tx: 5, tz: 10 }))).toEqual(yes(false));
    expect(ev(b.atEdgeOf('A'), state, robotOf({ tx: 4, tz: 10 }))).toEqual(yes(true));
    expect(ev(b.atEdgeOf('A'), state, robotOf({ tx: 6, tz: 11 }))).toEqual(yes(true));
    expect(ev(b.atEdgeOf('A'), state, robotOf({ tx: 7, tz: 10 }))).toEqual(yes(false));
    expect(ev(b.atEdgeOf('B'), state, robotOf({ tx: 4, tz: 10 }))).toEqual(yes(false));
  });

  it('tokens below compares with its number', () => {
    const robot = robotOf({ tokens: 10 });
    expect([ev(b.tokensBelow(11), BASE, robot), ev(b.tokensBelow(10), BASE, robot), ev(b.tokensBelow(b.add(b.n(5), b.n(6))), BASE, robot)]).toEqual([
      yes(true),
      yes(false),
      yes(true),
    ]);
  });

  it('tile ahead is water, blocked or clear', () => {
    const cases: readonly [string, GameState, Robot, 'water' | 'blocked' | 'clear'][] = [
      ['water', ahead(blockedTile(Blocker.Water)), robotOf(), 'water'],
      ['a rock', ahead(blockedTile(Blocker.Rock, 2)), robotOf(), 'blocked'],
      ['a chest', ahead(chest), robotOf(), 'blocked'],
      ['the farm edge', BASE, robotOf({ tx: 0, tz: 13, facing: Direction.West }), 'blocked'],
      ['grass', ahead(EMPTY_TILE), robotOf(), 'clear'],
      ['soil', ahead(soilTile(TileState.Plowed)), robotOf(), 'clear'],
    ];
    for (const [label, state, robot, what] of cases) {
      const answers = (['water', 'blocked', 'clear'] as const).map((w) => ev(b.tileAheadIs(w), state, robot));
      expect(answers, label).toEqual((['water', 'blocked', 'clear'] as const).map((w) => yes(w === what)));
    }
  });

  it('it is raining in rain and storms only', () => {
    const answer = (weather: Weather) => ev(b.itIsRaining(), { ...BASE, weather });
    expect([answer(Weather.Rain), answer(Weather.Storm), answer(Weather.Sunny), answer(Weather.Snow)]).toEqual([yes(true), yes(true), yes(false), yes(false)]);
  });

  it('time is after: No at the minute, Yes one minute later', () => {
    const at = (minuteOfDay: number) => ev(b.timeIsAfter(TIME.dayStartMinute + 60), { ...BASE, time: { ...BASE.time, minuteOfDay } });
    expect([at(TIME.dayStartMinute + 60), at(TIME.dayStartMinute + 61)]).toEqual([yes(false), yes(true)]);
  });
});
