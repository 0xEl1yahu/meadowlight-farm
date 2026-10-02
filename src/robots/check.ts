/**
 * The checker (farmclaws part 2 spec §4). Pure. It is the only gate for programs and .MDs:
 * addRobot, the dev hooks and save validation all call it. A block program it accepts can't
 * hit a type error while it runs. Each problem is one short sentence a player can read.
 */
import { ROBOTS, TIME } from '../config';
import {
  ZONE_IDS,
  type BlockProgram,
  type Expr,
  type MdCard,
  type Robot,
  type RobotProgram,
  type RobotSize,
  type Statement,
  type Trigger,
  type ValueType,
  type VarDecl,
  type ZoneRect,
} from '../core/types';
import { isValidRobotAction } from '../state/robotValidation';
import { blockCount, childLists, exprChildren, farmContains, isLiteral, statementDepth, statementExprs } from './program';
import { batteryFor, hasPart } from './stats';

const SIZE_NAMES: Readonly<Record<RobotSize, string>> = { mini: 'Mini', standard: 'Standard', big: 'Big' };
const TYPE_PHRASES: Readonly<Record<ValueType, string>> = { number: 'a number', text: 'text', yesNo: 'a yes or no', item: 'an item', tile: 'a tile' };
const SENSOR_EYE_SENSORS: Readonly<Partial<Record<Expr['kind'], string>>> = {
  tileAheadIs: 'Tile ahead is',
  itIsRaining: 'It is raining',
  timeIsAfter: 'Time is after',
};

const SCRIPT_INVALID = 'That program is not a valid script.';
const STACK_COUNT = `A program needs 1 to ${ROBOTS.maxStacks} trigger stacks.`;
const VAR_NAME = `Variable names are 1 to ${ROBOTS.maxIdentifierLength} characters, with no spaces at either end.`;
const HELPER_NAME = `Helper names are 1 to ${ROBOTS.maxIdentifierLength} characters, with no spaces at either end.`;
const NUMBER_RANGE = `Numbers must be whole and within ±${ROBOTS.maxNumber}.`;
const TEXT_LENGTH = `Text holds at most ${ROBOTS.maxTextLength} characters.`;
const SAY_EMPTY = 'Say needs something to say.';
const SAY_LENGTH = `Say can say at most ${ROBOTS.sayMaxLength} characters.`;
const OUTSIDE_DAY = "That time is outside the robot's day.";
const EVERY_CHOICE = `Every can only be ${ROBOTS.everyChoices.join(', ')} minutes.`;
const ARITH = '+, - and × need two numbers.';
const COMPARE_ORDER = '< and > need two numbers.';
const COMPARE_SAME = '= and ≠ need two values of the same type.';
const AND_OR = 'And and Or need two yes-or-no values.';
const NOT = 'Not needs a yes-or-no value.';
const TOKENS_BELOW = 'Tokens below needs a number.';
const REPEAT = 'Repeat needs a number.';
const REPEAT_UNTIL = 'Repeat until needs a yes or no.';
const IF = 'If needs a yes or no.';
const GO_TO = 'Go to needs a tile.';
const TAKE = 'Take needs an item.';
const SAY = 'Say needs text.';
const WAIT = 'Wait needs a number.';
const CHANGE_VAR = 'Change only works on number variables.';
const CHANGE_BY = 'Change needs a number.';
const MD_DUPLICATE = 'The .MD has the same card twice.';

const unknownVar = (name: string): string => `There's no variable called "${name}".`;
const unknownHelper = (name: string): string => `There's no helper called "${name}".`;
const duplicateVar = (name: string): string => `Two variables are called "${name}".`;
const duplicateHelper = (name: string): string => `Two helpers are called "${name}".`;
const selfCalling = (name: string): string => `Helper "${name}" ends up running itself.`;
const offFarm = (tx: number, tz: number): string => `Tile (${tx}, ${tz}) isn't on the farm.`;
const unknownZone = (zone: string): string => `"${zone}" isn't a zone.`;
const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`;

function isName(name: string): boolean {
  const length = Array.from(name).length;
  return name.trim() === name && length >= 1 && length <= ROBOTS.maxIdentifierLength;
}

/** A minute a robot can act in: from the start of the day up to (not including) pass-out. */
function isDayMinute(minute: number): boolean {
  return Number.isInteger(minute) && minute >= TIME.dayStartMinute && minute < TIME.passOutMinute;
}

function isZone(zone: string): boolean {
  return (ZONE_IDS as readonly string[]).includes(zone);
}

/** The first problem `check` finds in `items`, in order. */
function firstProblem<T>(items: readonly T[], check: (item: T) => string | null): string | null {
  for (const item of items) {
    const problem = check(item);
    if (problem !== null) return problem;
  }
  return null;
}

/** Every statement of a list and of the lists nested in it, depth first, in order. */
function allStatements(list: readonly Statement[]): Statement[] {
  return list.flatMap((statement) => [statement, ...childLists(statement).flatMap(allStatements)]);
}

/** Every expression node of an expression, depth first, in order. */
function allExprNodes(expr: Expr): Expr[] {
  return [expr, ...exprChildren(expr).flatMap(allExprNodes)];
}

function programStatements(program: BlockProgram): Statement[] {
  return [...program.stacks.flatMap((stack) => allStatements(stack.body)), ...program.helpers.flatMap((helper) => allStatements(helper.body))];
}

// --- 1. Shape ------------------------------------------------------------------------------

interface Names {
  readonly vars: ReadonlySet<string>;
  readonly helpers: ReadonlySet<string>;
}

function namesProblem(names: readonly string[], invalid: string, duplicate: (name: string) => string): string | null {
  const seen = new Set<string>();
  for (const name of names) {
    if (!isName(name)) return invalid;
    if (seen.has(name)) return duplicate(name);
    seen.add(name);
  }
  return null;
}

function exprShapeProblem(expr: Expr, names: Names): string | null {
  switch (expr.kind) {
    case 'num':
      return Number.isInteger(expr.value) && Math.abs(expr.value) <= ROBOTS.maxNumber ? null : NUMBER_RANGE;
    case 'text':
      return Array.from(expr.value).length <= ROBOTS.maxTextLength ? null : TEXT_LENGTH;
    case 'tile':
      return farmContains(expr.tx, expr.tz) ? null : offFarm(expr.tx, expr.tz);
    case 'var':
      return names.vars.has(expr.name) ? null : unknownVar(expr.name);
    case 'atEdgeOf':
      return isZone(expr.zone) ? null : unknownZone(expr.zone);
    case 'timeIsAfter':
      return isDayMinute(expr.minute) ? null : OUTSIDE_DAY;
    default:
      return firstProblem(exprChildren(expr), (child) => exprShapeProblem(child, names));
  }
}

/** Shape rules a statement's own fields break, before its expressions are looked at. */
function ownShapeProblem(statement: Statement, names: Names): string | null {
  switch (statement.kind) {
    case 'do': {
      const { action } = statement;
      if (action.kind !== 'say' || action.text.kind !== 'text') return null;
      const said = Array.from(action.text.value.trim()).length;
      if (said === 0) return SAY_EMPTY;
      return said > ROBOTS.sayMaxLength ? SAY_LENGTH : null;
    }
    case 'forEachTile':
      return isZone(statement.zone) ? null : unknownZone(statement.zone);
    case 'set':
    case 'change':
      return names.vars.has(statement.name) ? null : unknownVar(statement.name);
    case 'runHelper':
      return names.helpers.has(statement.name) ? null : unknownHelper(statement.name);
    default:
      return null;
  }
}

function statementShapeProblem(statement: Statement, names: Names): string | null {
  return ownShapeProblem(statement, names) ?? firstProblem(statementExprs(statement), (expr) => exprShapeProblem(expr, names));
}

function triggerShapeProblem(trigger: Trigger): string | null {
  if (trigger.kind === 'atTime') return isDayMinute(trigger.minute) ? null : OUTSIDE_DAY;
  if (trigger.kind === 'every') return (ROBOTS.everyChoices as readonly number[]).includes(trigger.minutes) ? null : EVERY_CHOICE;
  return null;
}

/** Names of the helpers a list runs, at any depth. */
function calledHelpers(list: readonly Statement[]): string[] {
  return allStatements(list).flatMap((statement) => (statement.kind === 'runHelper' ? [statement.name] : []));
}

/** The first helper (in program order) whose calls lead back to itself. */
function cycleProblem(program: BlockProgram): string | null {
  const bodies = new Map(program.helpers.map((helper) => [helper.name, helper.body] as const));
  for (const start of program.helpers) {
    const seen = new Set<string>();
    const pending = calledHelpers(start.body);
    for (let name = pending.pop(); name !== undefined; name = pending.pop()) {
      if (name === start.name) return selfCalling(start.name);
      if (seen.has(name)) continue;
      seen.add(name);
      pending.push(...calledHelpers(bodies.get(name) ?? []));
    }
  }
  return null;
}

function shapeProblem(program: BlockProgram): string | null {
  if (program.stacks.length < 1 || program.stacks.length > ROBOTS.maxStacks) return STACK_COUNT;
  const names: Names = { vars: new Set(program.vars.map((v) => v.name)), helpers: new Set(program.helpers.map((h) => h.name)) };
  return (
    namesProblem(
      program.vars.map((v) => v.name),
      VAR_NAME,
      duplicateVar,
    ) ??
    namesProblem(
      program.helpers.map((h) => h.name),
      HELPER_NAME,
      duplicateHelper,
    ) ??
    firstProblem(program.vars, (decl) => exprShapeProblem(decl.initial, names)) ??
    firstProblem(program.stacks, (stack) => triggerShapeProblem(stack.trigger)) ??
    firstProblem(programStatements(program), (statement) => statementShapeProblem(statement, names)) ??
    cycleProblem(program)
  );
}

// --- 2. Types ------------------------------------------------------------------------------

/** The type of an expression, or null when it is ill-typed or names an unknown variable. */
export function typeOf(expr: Expr, vars: readonly VarDecl[]): ValueType | null {
  switch (expr.kind) {
    case 'num':
    case 'tokensLeft':
    case 'countInBag':
      return 'number';
    case 'text':
      return 'text';
    case 'yes':
    case 'cropIsReady':
    case 'soilIsDry':
    case 'tileIsTilled':
    case 'cropIs':
    case 'bagIsFull':
    case 'bagHas':
    case 'atEdgeOf':
    case 'tileAheadIs':
    case 'itIsRaining':
    case 'timeIsAfter':
      return 'yesNo';
    case 'item':
      return 'item';
    case 'tile':
    case 'myTile':
    case 'tileAhead':
      return 'tile';
    case 'var':
      return vars.find((decl) => decl.name === expr.name)?.type ?? null;
    case 'arith':
      return typeOf(expr.a, vars) === 'number' && typeOf(expr.b, vars) === 'number' ? 'number' : null;
    case 'compare': {
      const a = typeOf(expr.a, vars);
      const b = typeOf(expr.b, vars);
      if (expr.op === '<' || expr.op === '>') return a === 'number' && b === 'number' ? 'yesNo' : null;
      return a !== null && a === b ? 'yesNo' : null;
    }
    case 'and':
    case 'or':
      return typeOf(expr.a, vars) === 'yesNo' && typeOf(expr.b, vars) === 'yesNo' ? 'yesNo' : null;
    case 'not':
      return typeOf(expr.a, vars) === 'yesNo' ? 'yesNo' : null;
    case 'tokensBelow':
      return typeOf(expr.n, vars) === 'number' ? 'yesNo' : null;
  }
}

/** The innermost operand rule an expression breaks (operands first). */
function exprTypeProblem(expr: Expr, vars: readonly VarDecl[]): string | null {
  const inner = firstProblem(exprChildren(expr), (child) => exprTypeProblem(child, vars));
  if (inner !== null || typeOf(expr, vars) !== null) return inner;
  switch (expr.kind) {
    case 'arith':
      return ARITH;
    case 'compare':
      return expr.op === '<' || expr.op === '>' ? COMPARE_ORDER : COMPARE_SAME;
    case 'and':
    case 'or':
      return AND_OR;
    case 'not':
      return NOT;
    case 'tokensBelow':
      return TOKENS_BELOW;
    default:
      return null;
  }
}

/** An expression in a socket that needs `want`: its own problems first, then the socket's. */
function socketProblem(expr: Expr, want: ValueType, vars: readonly VarDecl[], message: string): string | null {
  return exprTypeProblem(expr, vars) ?? (typeOf(expr, vars) === want ? null : message);
}

function statementTypeProblem(statement: Statement, vars: readonly VarDecl[]): string | null {
  switch (statement.kind) {
    case 'do': {
      const { action } = statement;
      if (action.kind === 'take') return socketProblem(action.item, 'item', vars, TAKE);
      if (action.kind === 'say') return socketProblem(action.text, 'text', vars, SAY);
      if (action.kind === 'wait') return socketProblem(action.minutes, 'number', vars, WAIT);
      return null;
    }
    case 'repeatTimes':
      return socketProblem(statement.times, 'number', vars, REPEAT);
    case 'repeatUntil':
      return socketProblem(statement.until, 'yesNo', vars, REPEAT_UNTIL);
    case 'if':
      return socketProblem(statement.cond, 'yesNo', vars, IF);
    case 'goTo':
      return socketProblem(statement.tile, 'tile', vars, GO_TO);
    case 'set': {
      const type = vars.find((decl) => decl.name === statement.name)?.type ?? 'number';
      return socketProblem(statement.value, type, vars, `Set "${statement.name}" needs ${TYPE_PHRASES[type]}.`);
    }
    case 'change':
      if (vars.find((decl) => decl.name === statement.name)?.type !== 'number') return CHANGE_VAR;
      return socketProblem(statement.by, 'number', vars, CHANGE_BY);
    default:
      return null;
  }
}

function declTypeProblem(decl: VarDecl, vars: readonly VarDecl[]): string | null {
  if (!isLiteral(decl.initial)) return `"${decl.name}" must start as a fixed value.`;
  return typeOf(decl.initial, vars) === decl.type ? null : `"${decl.name}" must start as ${TYPE_PHRASES[decl.type]}.`;
}

function typesProblem(program: BlockProgram): string | null {
  return (
    firstProblem(program.vars, (decl) => declTypeProblem(decl, program.vars)) ??
    firstProblem(programStatements(program), (statement) => statementTypeProblem(statement, program.vars))
  );
}

// --- 3. Parts ------------------------------------------------------------------------------

function partsProblem(program: BlockProgram, robot: Pick<Robot, 'parts'>): string | null {
  if (hasPart(robot, 'sensorEye')) return null;
  const exprs = programStatements(program).flatMap((statement) => statementExprs(statement).flatMap(allExprNodes));
  return firstProblem(exprs, (expr) => {
    const sensor = SENSOR_EYE_SENSORS[expr.kind];
    return sensor === undefined ? null : `The "${sensor}" sensor needs a sensor eye.`;
  });
}

// --- 4. Limits -----------------------------------------------------------------------------

function limitsProblem(program: BlockProgram, robot: Pick<Robot, 'size'>): string | null {
  const spec = ROBOTS.sizes[robot.size];
  const size = SIZE_NAMES[robot.size];
  const blocks = blockCount(program);
  if (blocks > spec.blocks) return `${size} robots hold ${plural(spec.blocks, 'block')}; this program has ${blocks}.`;
  if (program.vars.length > spec.vars) return `${size} robots hold ${plural(spec.vars, 'variable')}; this program has ${program.vars.length}.`;
  const depth = statementDepth(program);
  if (depth > ROBOTS.maxFrames) return `This program nests ${depth} levels deep; robots keep track of ${ROBOTS.maxFrames}.`;
  return null;
}

/**
 * Null when `program` may run on `robot`, else the first problem. Scripts follow part 1's rules
 * (1 … maxScriptSteps valid steps). Block programs are checked for shape, then types, then
 * parts, then limits (spec §4).
 */
export function checkProgram(program: RobotProgram, robot: Pick<Robot, 'size' | 'parts'>): string | null {
  if (program.kind === 'script') {
    const { steps } = program;
    return steps.length >= 1 && steps.length <= ROBOTS.maxScriptSteps && steps.every(isValidRobotAction) ? null : SCRIPT_INVALID;
  }
  return shapeProblem(program) ?? typesProblem(program) ?? partsProblem(program, robot) ?? limitsProblem(program, robot);
}

/** One string per distinct card, whatever the key order of the card objects. */
function cardKey(card: MdCard): string {
  switch (card.kind) {
    case 'dontLeave':
      return `dontLeave ${card.zone}`;
    case 'dontGoIntoWater':
      return 'dontGoIntoWater';
    case 'dontHarvest':
      return `dontHarvest ${card.cropId}`;
    case 'dontDeposit':
      return `dontDeposit ${card.itemId}`;
    case 'doReturn':
      return card.to.kind === 'tile' ? `doReturn tile ${card.to.tx} ${card.to.tz} ${card.minute}` : `doReturn generator ${card.minute}`;
    case 'doPowerDown':
      return card.when.kind === 'tokensBelow' ? `doPowerDown tokensBelow ${card.when.n}` : `doPowerDown ${card.when.kind}`;
  }
}

function cardProblem(card: MdCard, robot: Pick<Robot, 'size'>): string | null {
  switch (card.kind) {
    case 'dontLeave':
      return isZone(card.zone) ? null : unknownZone(card.zone);
    case 'doReturn':
      if (card.to.kind === 'tile' && !farmContains(card.to.tx, card.to.tz)) return offFarm(card.to.tx, card.to.tz);
      return isDayMinute(card.minute) ? null : OUTSIDE_DAY;
    case 'doPowerDown': {
      if (card.when.kind !== 'tokensBelow') return null;
      const battery = batteryFor(robot.size);
      const { n } = card.when;
      return Number.isInteger(n) && n >= 1 && n <= battery ? null : `Power down below needs a number of tokens from 1 to ${battery}.`;
    }
    default:
      return null;
  }
}

/** Null when `md` suits `robot`, else the first problem (spec §4). */
export function checkMd(md: readonly MdCard[], robot: Pick<Robot, 'size'>): string | null {
  const limit = ROBOTS.sizes[robot.size].mdCards;
  if (md.length > limit) return `${SIZE_NAMES[robot.size]} robots hold ${plural(limit, '.MD card')}; this .MD has ${md.length}.`;
  const problem = firstProblem(md, (card) => cardProblem(card, robot));
  if (problem !== null) return problem;
  return new Set(md.map(cardKey)).size === md.length ? null : MD_DUPLICATE;
}

/** Whether `rect` is a zone: whole numbers, w and d at least 1, every tile on the farm. */
export function isValidZoneRect(rect: ZoneRect): boolean {
  const { x0, z0, w, d } = rect;
  return Number.isInteger(w) && Number.isInteger(d) && w >= 1 && d >= 1 && farmContains(x0, z0) && farmContains(x0 + w - 1, z0 + d - 1);
}
