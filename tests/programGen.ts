/**
 * Test-only program tools (farmclaws part 2 spec §14.2).
 *
 * - randomProgram: a seeded generator of random, well-typed block programs for the interpreter
 *   safety test. Each program is built to pass checkProgram for SAFETY_BODY: every expression is
 *   made for the type its socket needs, variables are declared before use, a helper only runs
 *   later helpers (so calls never cycle) and literals stay in range. A candidate over the block
 *   or frame limit is thrown away and drawn again.
 * - programmed / addBlockRobot: block robots set up the way setProgram and setMd do it.
 */
import { ROBOTS, TIME } from '../src/config';
import {
  CROP_IDS,
  EVERY_CHOICES,
  VALUE_TYPES,
  ZONE_IDS,
  type ActionBlock,
  type BlockProgram,
  type Expr,
  type GameState,
  type HelperDef,
  type ItemId,
  type MdCard,
  type Robot,
  type RobotPartId,
  type RobotPlace,
  type RobotSize,
  type Statement,
  type Trigger,
  type TriggerStack,
  type ValueType,
  type VarDecl,
} from '../src/core/types';
import { programmedRobot, withMd } from '../src/robots/edits';
import { addRobot } from '../src/robots/create';
import { blockCount, statementDepth } from '../src/robots/program';
import { requireRobot, withRobot } from '../src/robots/world';
import { must } from './testUtils';

export type Rng = () => number;

export function int(rng: Rng, lo: number, hi: number): number {
  return lo + Math.floor(rng() * (hi - lo + 1));
}

export function pick<T>(rng: Rng, list: readonly T[]): T {
  return must(list[Math.floor(rng() * list.length)]);
}

export function chance(rng: Rng, p: number): boolean {
  return rng() < p;
}

/**
 * The body every generated program is written for: a Big robot with a claw, a watering head and
 * a sensor eye, so the checker accepts every block (actions whose part is missing, like till,
 * are part 1's runtime noPart mistake).
 */
export const SAFETY_BODY = { size: 'big', parts: ['claw', 'wateringHead', 'sensorEye'] } as const satisfies Pick<Robot, 'size' | 'parts'>;

/** The farm's guaranteed-clear ground south of the house (LAYOUT.clearZones[1]): generated tiles and zones lie here. */
export const SAFE_AREA = { x0: 1, z0: 9, w: 17, d: 9 } as const;

const MAX_VARS = 3;
const MAX_HELPERS = 2;
const MAX_STACKS = 3;
/** Statement lists nested below a stack body; helper bodies get one level less. */
const MAX_NEST = 3;
const MAX_LIST = 3;
const MAX_EXPR_DEPTH = 2;
const ATTEMPTS = 500;
const ITEMS: readonly ItemId[] = ['parsnip', 'potato', 'pumpkin', 'parsnip_seeds', 'wood'];
/** Text literals, `say` included: 1 … maxTextLength characters once trimmed. */
const TEXTS: readonly string[] = ['Hello', '  Beep boop  ', 'Done', 'x'.repeat(ROBOTS.maxTextLength)];
/** A text variable may also start empty (a `say` of it says "…"). */
const TEXT_INITIALS: readonly string[] = ['', ...TEXTS];
/** Action kinds, weighted towards moving so routes and tiles change. */
const ACTIONS: readonly ActionBlock['kind'][] = ['move', 'move', 'move', 'turn', 'turn', 'water', 'harvest', 'till', 'plant', 'refill', 'deposit', 'take', 'say', 'wait', 'powerDown'];

interface Scope {
  readonly rng: Rng;
  readonly vars: readonly VarDecl[];
  /** Helpers a statement here may run. */
  readonly callable: readonly string[];
}

function tileLiteral(rng: Rng): Expr {
  return {
    kind: 'tile',
    tx: int(rng, SAFE_AREA.x0, SAFE_AREA.x0 + SAFE_AREA.w - 1),
    tz: int(rng, SAFE_AREA.z0, SAFE_AREA.z0 + SAFE_AREA.d - 1),
  };
}

function literal(rng: Rng, type: ValueType, texts: readonly string[] = TEXTS): Expr {
  switch (type) {
    case 'number':
      return { kind: 'num', value: chance(rng, 0.1) ? pick(rng, [ROBOTS.maxNumber, -ROBOTS.maxNumber]) : int(rng, -3, 12) };
    case 'text':
      return { kind: 'text', value: pick(rng, texts) };
    case 'yesNo':
      return { kind: 'yes', value: chance(rng, 0.5) };
    case 'item':
      return { kind: 'item', itemId: pick(rng, ITEMS) };
    case 'tile':
      return tileLiteral(rng);
  }
}

/** An expression of `type`; `depth` bounds how far operators nest. */
function expr(s: Scope, type: ValueType, depth: number): Expr {
  const { rng } = s;
  const vars = s.vars.filter((decl) => decl.type === type);
  const options: (() => Expr)[] = [() => literal(rng, type)];
  if (vars.length > 0) options.push(() => ({ kind: 'var', name: pick(rng, vars).name }));
  if (type === 'number') {
    options.push(
      () => ({ kind: 'tokensLeft' }),
      () => ({ kind: 'countInBag', itemId: pick(rng, ITEMS) }),
    );
    if (depth > 0) {
      options.push(() => ({ kind: 'arith', op: pick(rng, ['+', '-', '×'] as const), a: expr(s, 'number', depth - 1), b: expr(s, 'number', depth - 1) }));
    }
  }
  if (type === 'tile') options.push(() => ({ kind: 'myTile' }), () => ({ kind: 'tileAhead' }));
  if (type === 'yesNo') {
    options.push(
      () => ({ kind: 'cropIsReady' }),
      () => ({ kind: 'soilIsDry' }),
      () => ({ kind: 'tileIsTilled' }),
      () => ({ kind: 'cropIs', cropId: pick(rng, CROP_IDS) }),
      () => ({ kind: 'bagIsFull' }),
      () => ({ kind: 'bagHas', itemId: pick(rng, ITEMS) }),
      () => ({ kind: 'atEdgeOf', zone: pick(rng, ZONE_IDS) }),
      () => ({ kind: 'tokensBelow', n: expr(s, 'number', Math.max(0, depth - 1)) }),
      () => ({ kind: 'tileAheadIs', what: pick(rng, ['water', 'blocked', 'clear'] as const) }),
      () => ({ kind: 'itIsRaining' }),
      () => ({ kind: 'timeIsAfter', minute: int(rng, TIME.dayStartMinute, TIME.passOutMinute - 1) }),
    );
    if (depth > 0) {
      options.push(
        () => ({ kind: 'compare', op: pick(rng, ['<', '>'] as const), a: expr(s, 'number', depth - 1), b: expr(s, 'number', depth - 1) }),
        () => {
          const side = pick(rng, VALUE_TYPES);
          return { kind: 'compare', op: pick(rng, ['=', '≠'] as const), a: expr(s, side, depth - 1), b: expr(s, side, depth - 1) };
        },
        () => ({ kind: pick(rng, ['and', 'or'] as const), a: expr(s, 'yesNo', depth - 1), b: expr(s, 'yesNo', depth - 1) }),
        () => ({ kind: 'not', a: expr(s, 'yesNo', depth - 1) }),
      );
    }
  }
  return pick(rng, options)();
}

function action(s: Scope): ActionBlock {
  const { rng } = s;
  const kind = pick(rng, ACTIONS);
  switch (kind) {
    case 'move':
    case 'water':
    case 'harvest':
    case 'till':
    case 'refill':
    case 'deposit':
    case 'powerDown':
      return { kind };
    case 'turn':
      return { kind, side: chance(rng, 0.5) ? 'left' : 'right' };
    case 'plant':
      return { kind, cropId: pick(rng, CROP_IDS) };
    case 'take':
      return { kind, item: expr(s, 'item', 1) };
    case 'say':
      return { kind, text: expr(s, 'text', 1) };
    case 'wait':
      return { kind, minutes: expr(s, 'number', 1) };
  }
}

/** One statement; `nest` is how many more statement lists may open below it. */
function statement(s: Scope, nest: number): Statement {
  const { rng } = s;
  const kinds: Statement['kind'][] = ['do', 'do', 'do', 'do', 'goTo'];
  if (nest > 0) kinds.push('repeatTimes', 'repeatUntil', 'repeatForever', 'if', 'if', 'forEachTile');
  const numbers = s.vars.filter((decl) => decl.type === 'number');
  if (s.vars.length > 0) kinds.push('set');
  if (numbers.length > 0) kinds.push('change');
  if (s.callable.length > 0) kinds.push('runHelper');
  switch (pick(rng, kinds)) {
    case 'do':
      return { kind: 'do', action: action(s) };
    case 'repeatTimes':
      return { kind: 'repeatTimes', times: expr(s, 'number', 1), body: list(s, nest - 1) };
    case 'repeatUntil':
      return { kind: 'repeatUntil', until: expr(s, 'yesNo', MAX_EXPR_DEPTH), body: list(s, nest - 1) };
    case 'repeatForever':
      return { kind: 'repeatForever', body: list(s, nest - 1) };
    case 'if':
      return { kind: 'if', cond: expr(s, 'yesNo', MAX_EXPR_DEPTH), then: list(s, nest - 1), else: chance(rng, 0.5) ? list(s, nest - 1) : null };
    case 'forEachTile':
      return { kind: 'forEachTile', zone: pick(rng, ZONE_IDS), body: list(s, nest - 1) };
    case 'goTo':
      return { kind: 'goTo', tile: expr(s, 'tile', 1) };
    case 'set': {
      const decl = pick(rng, s.vars);
      return { kind: 'set', name: decl.name, value: expr(s, decl.type, 1) };
    }
    case 'change':
      return { kind: 'change', name: pick(rng, numbers).name, by: expr(s, 'number', 1) };
    case 'runHelper':
      return { kind: 'runHelper', name: pick(rng, s.callable) };
  }
}

function list(s: Scope, nest: number): Statement[] {
  return Array.from({ length: int(s.rng, 1, MAX_LIST) }, () => statement(s, nest));
}

function trigger(rng: Rng): Trigger {
  switch (int(rng, 0, 4)) {
    case 0:
      return { kind: 'morning' };
    case 1:
      return { kind: 'atTime', minute: int(rng, TIME.dayStartMinute + 1, TIME.dayStartMinute + 120) };
    case 2:
      return { kind: 'bagFull' };
    case 3:
      return { kind: 'startsRaining' };
    default:
      return { kind: 'every', minutes: pick(rng, EVERY_CHOICES) };
  }
}

function candidate(rng: Rng): BlockProgram {
  const varDecl = (i: number): VarDecl => {
    const type = pick(rng, VALUE_TYPES);
    return { name: `v${i}`, type, initial: literal(rng, type, TEXT_INITIALS) };
  };
  const vars = Array.from({ length: int(rng, 0, MAX_VARS) }, (_, i) => varDecl(i));
  const names = Array.from({ length: int(rng, 0, MAX_HELPERS) }, (_, i) => `h${i}`);
  const helper = (name: string, i: number): HelperDef => ({ name, body: list({ rng, vars, callable: names.slice(i + 1) }, MAX_NEST - 1) });
  const helpers = names.map(helper);
  const top: Scope = { rng, vars, callable: names };
  // The first stack always starts in the morning, so a robot programmed at 6:00 runs at once.
  const stack = (i: number): TriggerStack => ({ trigger: i === 0 ? { kind: 'morning' } : trigger(rng), body: list(top, MAX_NEST) });
  const stacks = Array.from({ length: int(rng, 1, MAX_STACKS) }, (_, i) => stack(i));
  return { kind: 'blocks', vars, stacks, helpers };
}

/** A random program that passes checkProgram for SAFETY_BODY. The same rng state gives the same program. */
export function randomProgram(rng: Rng): BlockProgram {
  const blocks = ROBOTS.sizes[SAFETY_BODY.size].blocks;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const program = candidate(rng);
    if (blockCount(program) <= blocks && statementDepth(program) <= ROBOTS.maxFrames) return program;
  }
  throw new Error(`randomProgram: nothing fitted ${blocks} blocks in ${ATTEMPTS} tries`);
}

/**
 * `robot` running `program` with `md`, set up the way setProgram and setMd do it at
 * `minuteOfDay` (6:00 by default, so a `morning` stack starts). Throws on a program or .MD the
 * checker refuses: that's a bug in the test.
 */
export function programmed(robot: Robot, program: BlockProgram, md: readonly MdCard[] = [], minuteOfDay: number = TIME.dayStartMinute): Robot {
  const withProgram = programmedRobot(robot, program, minuteOfDay);
  if (typeof withProgram === 'string') throw new Error(withProgram);
  const ruled = withMd(withProgram, md);
  if (typeof ruled === 'string') throw new Error(ruled);
  return ruled;
}

export interface BlockRobotSpec {
  readonly name: string;
  readonly size: RobotSize;
  readonly parts: readonly RobotPartId[];
  readonly place: RobotPlace;
  readonly program: BlockProgram;
  readonly md?: readonly MdCard[];
}

/** Adds a fully charged robot with addRobot, then programs it at the state's current minute. Throws on a bad spec. */
export function addBlockRobot(state: GameState, spec: BlockRobotSpec): GameState {
  const added = addRobot(state, { name: spec.name, size: spec.size, parts: spec.parts, place: spec.place, program: spec.program });
  if ('error' in added) throw new Error(added.error);
  const robot = programmed(requireRobot(added.state, added.id), spec.program, spec.md ?? [], state.time.minuteOfDay);
  return withRobot(added.state, robot);
}
