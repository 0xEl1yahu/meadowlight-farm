/**
 * Expression evaluation and sensors (farmclaws part 2 spec §5.1 "Expressions"). Pure.
 *
 * Expressions are read against `state` and the robot as they are at the start of the minute.
 * Sensors read the robot's own tile unless they say "ahead". The program has passed
 * `checkProgram`, so every expression has the type its socket needs; a mismatch here is an
 * invariant failure, never a player-facing error.
 */
import { ROBOTS } from '../config';
import { invariant } from '../core/invariant';
import {
  Blocker,
  DIRECTIONS,
  TileState,
  Weather,
  type BlockProgram,
  type Expr,
  type GameState,
  type Robot,
  type Tile,
  type TileCoord,
  type Value,
} from '../core/types';
import { isMature } from '../farming/crops';
import { stepTile } from '../world/grid';
import { getTile, isSoil, isWalkable, requireTile } from '../world/tiles';
import { bagCount } from './bag';
import { farmContains, literalValue } from './program';
import { bagStacks } from './stats';
import { robotsOnTile } from './world';
import { inZone, tileAheadOf, zoneOf } from './zones';

export interface EvalContext {
  readonly state: GameState;
  readonly robot: Robot;
  readonly program: BlockProgram;
  /** The robot's current variable values, one per program.vars. */
  readonly vars: readonly Value[];
}

/** Clamps a number to ±ROBOTS.maxNumber. Never returns -0 (it would not survive a JSON round-trip). */
export function clampNumber(n: number): number {
  return Math.max(-ROBOTS.maxNumber, Math.min(ROBOTS.maxNumber, n)) + 0;
}

function numberOf(expr: Expr, ctx: EvalContext): number {
  const value = evaluate(expr, ctx);
  invariant(value.type === 'number', `expected a number from ${expr.kind}, got ${value.type}`);
  return value.value;
}

function yesNoOf(expr: Expr, ctx: EvalContext): boolean {
  const value = evaluate(expr, ctx);
  invariant(value.type === 'yesNo', `expected a yes/no from ${expr.kind}, got ${value.type}`);
  return value.value;
}

function sameValue(a: Value, b: Value): boolean {
  invariant(a.type === b.type, `compared a ${a.type} with a ${b.type}`);
  if (a.type === 'tile' && b.type === 'tile') return a.value.tx === b.value.tx && a.value.tz === b.value.tz;
  return a.value === b.value;
}

/**
 * The tile ahead as a Tile value. Values only ever hold farm tiles, so a robot facing off the
 * farm's edge gets its own tile (the tile ahead clamped onto the farm).
 */
function tileAheadValue(robot: Robot): TileCoord {
  const ahead = tileAheadOf(robot);
  return farmContains(ahead.tx, ahead.tz) ? ahead : { tx: robot.tx, tz: robot.tz };
}

const number = (value: number): Value => ({ type: 'number', value });
const yesNo = (value: boolean): Value => ({ type: 'yesNo', value });

export function evaluate(expr: Expr, ctx: EvalContext): Value {
  const { state, robot } = ctx;
  const own = (): Tile => requireTile(state.maps.farm, robot.tx, robot.tz);
  switch (expr.kind) {
    case 'num':
    case 'text':
    case 'yes':
    case 'item':
    case 'tile':
      return literalValue(expr);
    case 'var': {
      const index = ctx.program.vars.findIndex((decl) => decl.name === expr.name);
      const value = ctx.vars[index];
      invariant(index !== -1 && value !== undefined, `unknown variable ${expr.name}`);
      return value;
    }
    case 'myTile':
      return { type: 'tile', value: { tx: robot.tx, tz: robot.tz } };
    case 'tileAhead':
      return { type: 'tile', value: tileAheadValue(robot) };
    case 'tokensLeft':
      return number(robot.tokens);
    case 'countInBag':
      return number(bagCount(robot.bag, expr.itemId));
    case 'arith': {
      const a = numberOf(expr.a, ctx);
      const b = numberOf(expr.b, ctx);
      return number(clampNumber(expr.op === '+' ? a + b : expr.op === '-' ? a - b : a * b));
    }
    case 'compare': {
      if (expr.op === '<' || expr.op === '>') {
        const a = numberOf(expr.a, ctx);
        const b = numberOf(expr.b, ctx);
        return yesNo(expr.op === '<' ? a < b : a > b);
      }
      const same = sameValue(evaluate(expr.a, ctx), evaluate(expr.b, ctx));
      return yesNo(expr.op === '=' ? same : !same);
    }
    case 'and':
      return yesNo(yesNoOf(expr.a, ctx) && yesNoOf(expr.b, ctx));
    case 'or':
      return yesNo(yesNoOf(expr.a, ctx) || yesNoOf(expr.b, ctx));
    case 'not':
      return yesNo(!yesNoOf(expr.a, ctx));
    case 'cropIsReady': {
      const crop = own().crop;
      return yesNo(crop !== null && isMature(crop));
    }
    case 'soilIsDry':
      return yesNo(own().state === TileState.Plowed);
    case 'tileIsTilled':
      return yesNo(isSoil(own()));
    case 'cropIs': {
      const crop = own().crop;
      return yesNo(crop !== null && crop.cropId === expr.cropId);
    }
    case 'bagIsFull':
      return yesNo(robot.bag.length >= bagStacks(robot));
    case 'bagHas':
      return yesNo(bagCount(robot.bag, expr.itemId) > 0);
    case 'atEdgeOf': {
      const rect = zoneOf(state, expr.zone);
      if (rect === null || !inZone(rect, robot.tx, robot.tz)) return yesNo(false);
      const neighbours = DIRECTIONS.map((d) => stepTile({ tx: robot.tx, tz: robot.tz }, d));
      return yesNo(neighbours.some((n) => !inZone(rect, n.tx, n.tz)));
    }
    case 'tokensBelow':
      return yesNo(robot.tokens < numberOf(expr.n, ctx));
    case 'tileAheadIs': {
      const ahead = tileAheadOf(robot);
      const tile = getTile(state.maps.farm, ahead.tx, ahead.tz);
      const water = tile !== null && tile.blocker === Blocker.Water;
      const clear = tile !== null && isWalkable(tile);
      // A standing robot ahead blocks the tile (part 3 spec §3.1), so a program can look before it moves.
      const robotAhead = robotsOnTile(state, ahead.tx, ahead.tz).length > 0;
      if (expr.what === 'water') return yesNo(water);
      if (expr.what === 'clear') return yesNo(clear && !robotAhead);
      return yesNo(robotAhead || (!water && !clear));
    }
    case 'itIsRaining':
      return yesNo(state.weather === Weather.Rain || state.weather === Weather.Storm);
    case 'timeIsAfter':
      return yesNo(state.time.minuteOfDay > expr.minute);
  }
}
