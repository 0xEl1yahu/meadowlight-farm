/**
 * Save validation for the robots section (farmclaws part 1 spec §6.2, part 2 spec §10.2).
 * Every check is a type guard that returns false on any unexpected shape and never throws.
 */
import { ROBOTS, TIME } from '../config';
import {
  Blocker,
  CROP_IDS,
  EVERY_CHOICES,
  MAP_IDS,
  QUALITIES,
  ROBOT_BLOCK_REASONS,
  ROBOT_LOG_EVENT_KINDS,
  ROBOT_PART_IDS,
  ROBOT_POWERS,
  ROBOT_SIZES,
  VALUE_TYPES,
  ZONE_IDS,
  type BlockProgram,
  type Frame,
  type GameState,
  type ListRef,
  type MdCard,
  type Robot,
  type RobotAction,
  type RobotExec,
  type RobotPartId,
  type RobotProgram,
  type TileCoord,
  type Trigger,
  type ValueType,
  type WorldState,
} from '../core/types';
import { isItemId } from '../items/items';
import { checkMd, checkProgram, isValidZoneRect } from '../robots/check';
import { ROBOT_ACTION_KINDS } from '../robots/parts';
import { farmContains, resolveList } from '../robots/program';
import { bagStacks, batteryFor } from '../robots/stats';
import { inBounds } from '../world/grid';
import { forEachTile, getTile, isWalkable } from '../world/tiles';
import { isValidName } from './sectionValidation';
import { hasExactKeys, isBool, isCanonicalSubset, isCount, isInt, isIntIn, isObj, isOneOf, isValidStack, type Obj } from './validation';

const MAX = Number.MAX_SAFE_INTEGER;

const ROBOT_KEYS = [
  'id', 'name', 'size', 'parts', 'tx', 'tz', 'facing', 'bag', 'tank', 'tokens', 'power', 'carried', 'program', 'pc',
  'exec', 'md', 'off', 'nextActMinute', 'repairReadyDay', 'tokensToday', 'moveSeq', 'teleportSeq', 'actionSeq', 'lastAction',
] as const;

/** Wood burners work the farm's robots, so a burner on another map means a corrupt save. */
function burnersOnlyOnFarm(maps: GameState['maps']): boolean {
  let stray = false;
  for (const id of MAP_IDS.filter((mapId) => mapId !== 'farm')) {
    forEachTile(maps[id], (tile) => {
      if (tile.object?.kind === 'woodBurner') stray = true;
    });
  }
  return !stray;
}

export function isValidRobotAction(v: unknown): v is RobotAction {
  if (!isObj(v) || typeof v.kind !== 'string') return false;
  switch (v.kind) {
    case 'move':
    case 'water':
    case 'harvest':
    case 'till':
    case 'refill':
    case 'deposit':
    case 'powerDown':
      return hasExactKeys(v, ['kind']);
    case 'turn':
      return hasExactKeys(v, ['kind', 'side']) && (v.side === 'left' || v.side === 'right');
    case 'plant':
      return hasExactKeys(v, ['kind', 'cropId']) && isOneOf(v.cropId, CROP_IDS);
    case 'take':
      return hasExactKeys(v, ['kind', 'itemId']) && isItemId(v.itemId);
    case 'say': {
      if (!hasExactKeys(v, ['kind', 'text']) || typeof v.text !== 'string' || v.text.trim() !== v.text) return false;
      const length = Array.from(v.text).length;
      return length >= 1 && length <= ROBOTS.sayMaxLength;
    }
    case 'wait':
      return hasExactKeys(v, ['kind', 'minutes']) && isIntIn(v.minutes, 1, ROBOTS.maxWaitMinutes);
    default:
      return false;
  }
}

// --- Block programs, .MDs and exec (farmclaws part 2 spec §10.2) ---------------------------

const isString = (v: unknown): v is string => typeof v === 'string';
const isNumber = (v: unknown): v is number => typeof v === 'number';
const isList = (v: unknown): v is readonly unknown[] => Array.isArray(v);

function isFarmTile(v: unknown): v is TileCoord {
  return isObj(v) && hasExactKeys(v, ['tx', 'tz']) && isInt(v.tx) && isInt(v.tz) && farmContains(v.tx, v.tz);
}

/** The shape of one expression: a known kind with exactly its fields, each of the right JSON type. Ranges are checkProgram's job. */
function isExprShape(v: unknown): boolean {
  if (!isObj(v) || !isString(v.kind)) return false;
  switch (v.kind) {
    case 'num':
      return hasExactKeys(v, ['kind', 'value']) && isNumber(v.value);
    case 'text':
      return hasExactKeys(v, ['kind', 'value']) && isString(v.value);
    case 'yes':
      return hasExactKeys(v, ['kind', 'value']) && isBool(v.value);
    case 'item':
    case 'countInBag':
    case 'bagHas':
      return hasExactKeys(v, ['kind', 'itemId']) && isItemId(v.itemId);
    case 'tile':
      return hasExactKeys(v, ['kind', 'tx', 'tz']) && isNumber(v.tx) && isNumber(v.tz);
    case 'var':
      return hasExactKeys(v, ['kind', 'name']) && isString(v.name);
    case 'myTile':
    case 'tileAhead':
    case 'tokensLeft':
    case 'cropIsReady':
    case 'soilIsDry':
    case 'tileIsTilled':
    case 'bagIsFull':
    case 'itIsRaining':
      return hasExactKeys(v, ['kind']);
    case 'arith':
      return hasExactKeys(v, ['kind', 'op', 'a', 'b']) && isOneOf(v.op, ['+', '-', '×']) && isExprShape(v.a) && isExprShape(v.b);
    case 'compare':
      return hasExactKeys(v, ['kind', 'op', 'a', 'b']) && isOneOf(v.op, ['=', '≠', '<', '>']) && isExprShape(v.a) && isExprShape(v.b);
    case 'and':
    case 'or':
      return hasExactKeys(v, ['kind', 'a', 'b']) && isExprShape(v.a) && isExprShape(v.b);
    case 'not':
      return hasExactKeys(v, ['kind', 'a']) && isExprShape(v.a);
    case 'cropIs':
      return hasExactKeys(v, ['kind', 'cropId']) && isOneOf(v.cropId, CROP_IDS);
    case 'atEdgeOf':
      return hasExactKeys(v, ['kind', 'zone']) && isOneOf(v.zone, ZONE_IDS);
    case 'tokensBelow':
      return hasExactKeys(v, ['kind', 'n']) && isExprShape(v.n);
    case 'tileAheadIs':
      return hasExactKeys(v, ['kind', 'what']) && isOneOf(v.what, ['water', 'blocked', 'clear']);
    case 'timeIsAfter':
      return hasExactKeys(v, ['kind', 'minute']) && isNumber(v.minute);
    default:
      return false;
  }
}

function isActionBlockShape(v: unknown): boolean {
  if (!isObj(v) || !isString(v.kind)) return false;
  switch (v.kind) {
    case 'move':
    case 'water':
    case 'harvest':
    case 'till':
    case 'refill':
    case 'deposit':
    case 'powerDown':
      return hasExactKeys(v, ['kind']);
    case 'turn':
      return hasExactKeys(v, ['kind', 'side']) && (v.side === 'left' || v.side === 'right');
    case 'plant':
      return hasExactKeys(v, ['kind', 'cropId']) && isOneOf(v.cropId, CROP_IDS);
    case 'take':
      return hasExactKeys(v, ['kind', 'item']) && isExprShape(v.item);
    case 'say':
      return hasExactKeys(v, ['kind', 'text']) && isExprShape(v.text);
    case 'wait':
      return hasExactKeys(v, ['kind', 'minutes']) && isExprShape(v.minutes);
    default:
      return false;
  }
}

function isStatementListShape(v: unknown): boolean {
  return isList(v) && v.every(isStatementShape);
}

function isStatementShape(v: unknown): boolean {
  if (!isObj(v) || !isString(v.kind)) return false;
  switch (v.kind) {
    case 'do':
      return hasExactKeys(v, ['kind', 'action']) && isActionBlockShape(v.action);
    case 'repeatTimes':
      return hasExactKeys(v, ['kind', 'times', 'body']) && isExprShape(v.times) && isStatementListShape(v.body);
    case 'repeatUntil':
      return hasExactKeys(v, ['kind', 'until', 'body']) && isExprShape(v.until) && isStatementListShape(v.body);
    case 'repeatForever':
      return hasExactKeys(v, ['kind', 'body']) && isStatementListShape(v.body);
    case 'if':
      return (
        hasExactKeys(v, ['kind', 'cond', 'then', 'else']) &&
        isExprShape(v.cond) &&
        isStatementListShape(v.then) &&
        (v.else === null || isStatementListShape(v.else))
      );
    case 'forEachTile':
      return hasExactKeys(v, ['kind', 'zone', 'body']) && isOneOf(v.zone, ZONE_IDS) && isStatementListShape(v.body);
    case 'goTo':
      return hasExactKeys(v, ['kind', 'tile']) && isExprShape(v.tile);
    case 'set':
      return hasExactKeys(v, ['kind', 'name', 'value']) && isString(v.name) && isExprShape(v.value);
    case 'change':
      return hasExactKeys(v, ['kind', 'name', 'by']) && isString(v.name) && isExprShape(v.by);
    case 'runHelper':
      return hasExactKeys(v, ['kind', 'name']) && isString(v.name);
    default:
      return false;
  }
}

function isTriggerShape(v: unknown): boolean {
  if (!isObj(v) || !isString(v.kind)) return false;
  switch (v.kind) {
    case 'morning':
    case 'bagFull':
    case 'startsRaining':
      return hasExactKeys(v, ['kind']);
    case 'atTime':
      return hasExactKeys(v, ['kind', 'minute']) && isNumber(v.minute);
    case 'every':
      return hasExactKeys(v, ['kind', 'minutes']) && isOneOf(v.minutes, EVERY_CHOICES);
    default:
      return false;
  }
}

function isBlockProgramShape(v: Obj): boolean {
  return (
    hasExactKeys(v, ['kind', 'vars', 'stacks', 'helpers']) &&
    isList(v.vars) &&
    v.vars.every(
      (d) => isObj(d) && hasExactKeys(d, ['name', 'type', 'initial']) && isString(d.name) && isOneOf(d.type, VALUE_TYPES) && isExprShape(d.initial),
    ) &&
    isList(v.stacks) &&
    v.stacks.every((s) => isObj(s) && hasExactKeys(s, ['trigger', 'body']) && isTriggerShape(s.trigger) && isStatementListShape(s.body)) &&
    isList(v.helpers) &&
    v.helpers.every((h) => isObj(h) && hasExactKeys(h, ['name', 'body']) && isString(h.name) && isStatementListShape(h.body))
  );
}

/**
 * The deepest nesting of statements and expressions isProgramShape lets through (each level is
 * an object, and a statement level also a list, so the raw limit is twice this). checkProgram
 * accepts far less (ROBOTS.maxFrames statement levels, and a block budget that bounds the
 * expressions), so this only has to stop input deep enough to overflow the checker's recursion.
 */
const MAX_SHAPE_DEPTH = 64;

/** Whether any chain of nested nodes (objects and arrays) in `v` is deeper than `limit`. Iterative, so it can't overflow. */
function nestsDeeperThan(v: unknown, limit: number): boolean {
  const pending: Array<[unknown, number]> = [[v, 0]];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    const [node, depth] = next;
    if (typeof node !== 'object' || node === null) continue;
    if (depth > limit) return true;
    for (const child of Object.values(node)) pending.push([child, depth + 1]);
  }
  return false;
}

/**
 * Whether `v` is shaped like a program, so checkProgram can read it: a script (its steps an
 * array; checkProgram checks each step) or a block program whose every node has a known kind
 * and exactly its fields, nested no deeper than MAX_SHAPE_DEPTH. Never throws: input nested too
 * deeply (or cyclic, from the console) is rejected.
 */
export function isProgramShape(v: unknown): v is RobotProgram {
  try {
    if (!isObj(v)) return false;
    if (v.kind === 'script') return hasExactKeys(v, ['kind', 'steps', 'loop']) && isList(v.steps) && isBool(v.loop);
    return v.kind === 'blocks' && !nestsDeeperThan(v, MAX_SHAPE_DEPTH * 2) && isBlockProgramShape(v);
  } catch {
    return false;
  }
}

function isMdCardShape(v: unknown): boolean {
  if (!isObj(v) || !isString(v.kind)) return false;
  switch (v.kind) {
    case 'dontLeave':
      return hasExactKeys(v, ['kind', 'zone']) && isOneOf(v.zone, ZONE_IDS);
    case 'dontGoIntoWater':
      return hasExactKeys(v, ['kind']);
    case 'dontHarvest':
      return hasExactKeys(v, ['kind', 'cropId']) && isOneOf(v.cropId, CROP_IDS);
    case 'dontDeposit':
      return hasExactKeys(v, ['kind', 'itemId']) && isItemId(v.itemId);
    case 'doReturn': {
      const to = v.to;
      const toShape =
        isObj(to) &&
        ((to.kind === 'generator' && hasExactKeys(to, ['kind'])) || (to.kind === 'tile' && hasExactKeys(to, ['kind', 'tx', 'tz']) && isNumber(to.tx) && isNumber(to.tz)));
      return hasExactKeys(v, ['kind', 'to', 'minute']) && toShape && isNumber(v.minute);
    }
    case 'doPowerDown': {
      const when = v.when;
      const whenShape =
        isObj(when) &&
        (((when.kind === 'bagFull' || when.kind === 'raining') && hasExactKeys(when, ['kind'])) ||
          (when.kind === 'tokensBelow' && hasExactKeys(when, ['kind', 'n']) && isNumber(when.n)));
      return hasExactKeys(v, ['kind', 'when']) && whenShape;
    }
    default:
      return false;
  }
}

/** Whether `v` is a list of .MD cards, each a known kind with exactly its fields. Ranges are checkMd's job. */
export function isMdShape(v: unknown): v is readonly MdCard[] {
  return isList(v) && v.every(isMdCardShape);
}

/** A value of `type`: a whole number within ±maxNumber, text within maxTextLength, a yes/no, a known item or a farm tile. */
function isValueOf(v: unknown, type: ValueType): boolean {
  if (!isObj(v) || !hasExactKeys(v, ['type', 'value']) || v.type !== type) return false;
  switch (type) {
    case 'number':
      return isIntIn(v.value, -ROBOTS.maxNumber, ROBOTS.maxNumber);
    case 'text':
      return isString(v.value) && Array.from(v.value).length <= ROBOTS.maxTextLength;
    case 'yesNo':
      return isBool(v.value);
    case 'item':
      return isItemId(v.value);
    case 'tile':
      return isFarmTile(v.value);
  }
}

function isListRefShape(v: unknown): v is ListRef {
  return (
    isObj(v) &&
    hasExactKeys(v, ['root', 'index', 'path']) &&
    (v.root === 'stack' || v.root === 'helper') &&
    isCount(v.index) &&
    isList(v.path) &&
    v.path.every((step) => isList(step) && step.length === 2 && isCount(step[0]) && isOneOf(step[1], ['body', 'then', 'else']))
  );
}

const LOOP_STATEMENTS = { times: 'repeatTimes', until: 'repeatUntil', forever: 'repeatForever', forEach: 'forEachTile' } as const;

/**
 * A list frame: its list resolves, `next` is 0 … its length, and its loop state matches the list:
 * a loop body (a 'body' branch) has the state of that loop's kind, any other list has none.
 */
function isValidListFrame(v: Obj, program: BlockProgram): boolean {
  const ref: unknown = v.list;
  if (!hasExactKeys(v, ['kind', 'list', 'next', 'loop']) || !isListRefShape(ref)) return false;
  const list = resolveList(program, ref);
  if (list === null || !isIntIn(v.next, 0, list.length)) return false;
  const last = ref.path[ref.path.length - 1];
  if (last === undefined || last[1] !== 'body') return v.loop === null;
  const parent = resolveList(program, { ...ref, path: ref.path.slice(0, -1) });
  const loopStatement = parent?.[last[0]];
  const loop = v.loop;
  if (loopStatement === undefined || !isObj(loop) || !isOneOf(loop.kind, Object.keys(LOOP_STATEMENTS))) return false;
  if (LOOP_STATEMENTS[loop.kind as keyof typeof LOOP_STATEMENTS] !== loopStatement.kind) return false;
  switch (loop.kind) {
    case 'times':
      return hasExactKeys(loop, ['kind', 'left']) && isIntIn(loop.left, 0, ROBOTS.maxRepeatTimes);
    case 'forEach':
      return hasExactKeys(loop, ['kind', 'tiles', 'i']) && isList(loop.tiles) && loop.tiles.every(isFarmTile) && isIntIn(loop.i, 0, loop.tiles.length - 1);
    default:
      return hasExactKeys(loop, ['kind']);
  }
}

function isValidRouteFrame(v: Obj): boolean {
  return (
    hasExactKeys(v, ['kind', 'target', 'path', 'why']) &&
    isFarmTile(v.target) &&
    isList(v.path) &&
    v.path.every(isFarmTile) &&
    isOneOf(v.why, ['goTo', 'forEach', 'doReturn'])
  );
}

function isValidFrame(v: unknown, program: BlockProgram): v is Frame {
  if (!isObj(v)) return false;
  if (v.kind === 'list') return isValidListFrame(v, program);
  return v.kind === 'route' && isValidRouteFrame(v);
}

/** The minutes a stack's trigger may still be due at: its own time for `atTime`, any minute up to pass-out plus n for `every n`. */
function isValidDue(v: unknown, trigger: Trigger): boolean {
  if (v === null) return true;
  if (trigger.kind === 'atTime') return v === trigger.minute;
  if (trigger.kind === 'every') return isIntIn(v, TIME.dayStartMinute, TIME.passOutMinute + trigger.minutes);
  return false;
}

/**
 * A block program's exec (spec §10.2 and plan refinement R1): one value per variable of its
 * declared type; one due and one firedToday entry per stack; running null or a stack index;
 * frames empty exactly when nothing runs, except a lone DO-return route frame; at most
 * maxFrames frames, each valid for the program; doneCards whole and without repeats (which DO
 * cards they name is checked against the robot's .MD).
 */
export function isValidExec(v: unknown, program: BlockProgram): v is RobotExec {
  if (!isObj(v) || !hasExactKeys(v, ['running', 'frames', 'vars', 'due', 'firedToday', 'doneCards'])) return false;
  const { running, frames, vars, due, firedToday, doneCards } = v;
  if (!isList(vars) || vars.length !== program.vars.length || !program.vars.every((decl, i) => isValueOf(vars[i], decl.type))) return false;
  if (!isList(due) || due.length !== program.stacks.length || !program.stacks.every((stack, i) => isValidDue(due[i], stack.trigger))) return false;
  if (!isList(firedToday) || firedToday.length !== program.stacks.length || !firedToday.every(isBool)) return false;
  if (!isList(doneCards) || !doneCards.every(isCount) || new Set(doneCards).size !== doneCards.length) return false;
  if (!(running === null || isIntIn(running, 0, program.stacks.length - 1))) return false;
  if (!isList(frames) || frames.length > ROBOTS.maxFrames || !frames.every((frame) => isValidFrame(frame, program))) return false;
  const returning = (frame: unknown): boolean => isObj(frame) && frame.kind === 'route' && frame.why === 'doReturn';
  if (running === null) return frames.length === 0 || (frames.length === 1 && returning(frames[0]));
  return frames.length > 0 && !frames.some(returning);
}

const isDoCard = (card: MdCard | undefined): boolean => card !== undefined && (card.kind === 'doReturn' || card.kind === 'doPowerDown');

/**
 * A robot's program, pc, exec and .MD: a shaped program that passes checkProgram for its body;
 * a script with exec null and pc on a step, or a block program with pc 0 and a valid exec whose
 * doneCards name DO cards of its .MD; a shaped .MD that passes checkMd.
 */
function isValidMind(v: Obj, body: Pick<Robot, 'size' | 'parts'>): boolean {
  const { program, pc, exec, md } = v;
  if (!isProgramShape(program) || checkProgram(program, body) !== null) return false;
  if (!isMdShape(md) || checkMd(md, body) !== null) return false;
  if (program.kind === 'script') return exec === null && isIntIn(pc, 0, program.steps.length - 1);
  return pc === 0 && isValidExec(exec, program) && exec.doneCards.every((i) => isDoCard(md[i]));
}

function isValidZones(v: unknown): boolean {
  if (!isObj(v) || !hasExactKeys(v, ZONE_IDS)) return false;
  return ZONE_IDS.every((id) => {
    const rect = v[id];
    if (rect === null) return true;
    return isObj(rect) && hasExactKeys(rect, ['x0', 'z0', 'w', 'd']) && isInt(rect.x0) && isInt(rect.z0) && isInt(rect.w) && isInt(rect.d) && isValidZoneRect({ x0: rect.x0, z0: rect.z0, w: rect.w, d: rect.d });
  });
}

function isValidDetail(v: unknown): boolean {
  if (!isObj(v)) return false;
  switch (v.kind) {
    case 'none':
    case 'tile':
      return hasExactKeys(v, ['kind']);
    case 'crop':
      return hasExactKeys(v, ['kind', 'cropId', 'quantity', 'quality']) && isOneOf(v.cropId, CROP_IDS) && isIntIn(v.quantity, 1, MAX) && isOneOf(v.quality, QUALITIES);
    case 'planted':
      return hasExactKeys(v, ['kind', 'cropId']) && isOneOf(v.cropId, CROP_IDS);
    case 'items':
      return (
        hasExactKeys(v, ['kind', 'into', 'stacks', 'quantity']) &&
        isOneOf(v.into, ['chest', 'bin', 'bag']) &&
        isIntIn(v.stacks, 1, MAX) &&
        isIntIn(v.quantity, 1, MAX)
      );
    default:
      return false;
  }
}

const DONT_CARD_KINDS = ['dontLeave', 'dontGoIntoWater', 'dontHarvest', 'dontDeposit'] as const;
const DO_CARD_KINDS = ['doReturn', 'doPowerDown'] as const;

/** An .MD card carried by a log event, of one of `kinds`. */
function isLoggedCard(v: unknown, kinds: readonly string[]): boolean {
  return isObj(v) && isOneOf(v.kind, kinds) && isMdShape([v]);
}

function isLoggedTile(v: unknown): boolean {
  return isObj(v) && hasExactKeys(v, ['tx', 'tz']) && isInt(v.tx) && isInt(v.tz) && farmContains(v.tx, v.tz);
}

/** A trigger carried by a `woke` event. */
function isLoggedTrigger(v: unknown): boolean {
  if (!isObj(v)) return false;
  switch (v.kind) {
    case 'morning':
    case 'bagFull':
    case 'startsRaining':
      return hasExactKeys(v, ['kind']);
    case 'atTime':
      return hasExactKeys(v, ['kind', 'minute']) && isIntIn(v.minute, TIME.dayStartMinute, TIME.passOutMinute);
    case 'every':
      return hasExactKeys(v, ['kind', 'minutes']) && isOneOf(v.minutes, ROBOTS.everyChoices);
    default:
      return false;
  }
}

function isValidLogEvent(v: unknown): boolean {
  if (!isObj(v) || !isOneOf(v.kind, ROBOT_LOG_EVENT_KINDS)) return false;
  switch (v.kind) {
    case 'did':
      return hasExactKeys(v, ['kind', 'action', 'detail']) && isOneOf(v.action, ROBOT_ACTION_KINDS) && isValidDetail(v.detail);
    case 'blocked':
      return hasExactKeys(v, ['kind', 'action', 'reason']) && isOneOf(v.action, ROBOT_ACTION_KINDS) && isOneOf(v.reason, ROBOT_BLOCK_REASONS);
    case 'bickered':
      return (
        hasExactKeys(v, ['kind', 'action', 'withIds']) &&
        isOneOf(v.action, ROBOT_ACTION_KINDS) &&
        Array.isArray(v.withIds) &&
        v.withIds.length >= 1 &&
        v.withIds.every((id: unknown) => isIntIn(id, 1, MAX))
      );
    case 'skipped':
      return hasExactKeys(v, ['kind', 'action', 'card']) && isOneOf(v.action, ROBOT_ACTION_KINDS) && isLoggedCard(v.card, DONT_CARD_KINDS);
    case 'gaveUp':
      return hasExactKeys(v, ['kind', 'target', 'why']) && isLoggedTile(v.target) && isOneOf(v.why, ['goTo', 'forEach', 'doReturn']);
    case 'woke':
      return hasExactKeys(v, ['kind', 'trigger']) && isLoggedTrigger(v.trigger);
    case 'doReturn':
      return hasExactKeys(v, ['kind', 'card', 'phase']) && isLoggedCard(v.card, ['doReturn']) && isOneOf(v.phase, ['started', 'arrived', 'failed']);
    case 'doPowerDown':
      return hasExactKeys(v, ['kind', 'card']) && isLoggedCard(v.card, ['doPowerDown']);
    case 'conflict':
      return hasExactKeys(v, ['kind', 'doCard', 'dontCard']) && isLoggedCard(v.doCard, DO_CARD_KINDS) && isLoggedCard(v.dontCard, DONT_CARD_KINDS);
    default:
      return hasExactKeys(v, ['kind']);
  }
}

function isValidLog(v: unknown, farm: WorldState): boolean {
  if (!isObj(v) || !hasExactKeys(v, ['nextId', 'entries']) || !isCount(v.nextId) || !Array.isArray(v.entries)) return false;
  if (v.entries.length > ROBOTS.logCapacity) return false;
  let previous = -1;
  for (const entry of v.entries as readonly unknown[]) {
    if (
      !isObj(entry) ||
      !hasExactKeys(entry, ['id', 'day', 'minute', 'robotId', 'tx', 'tz', 'event', 'count']) ||
      !isIntIn(entry.id, previous + 1, v.nextId - 1) ||
      !isCount(entry.day) ||
      !isIntIn(entry.minute, TIME.dayStartMinute, TIME.passOutMinute) ||
      !isIntIn(entry.robotId, 1, MAX) ||
      !isInt(entry.tx) ||
      !isInt(entry.tz) ||
      !inBounds(farm.grid, entry.tx, entry.tz) ||
      !isIntIn(entry.count, 1, MAX) ||
      !isValidLogEvent(entry.event)
    ) {
      return false;
    }
    previous = entry.id;
  }
  return true;
}

function isValidLastAction(v: unknown, actionSeq: number): boolean {
  if (v === null) return true;
  return (
    isObj(v) &&
    hasExactKeys(v, ['seq', 'kind', 'success', 'bickered']) &&
    v.seq === actionSeq &&
    isOneOf(v.kind, ROBOT_ACTION_KINDS) &&
    isBool(v.success) &&
    isBool(v.bickered)
  );
}

function isValidRobot(v: unknown, farm: WorldState): boolean {
  if (!isObj(v) || !hasExactKeys(v, ROBOT_KEYS)) return false;
  if (!isIntIn(v.id, 1, MAX) || !isValidName(v.name) || !isOneOf(v.size, ROBOT_SIZES)) return false;
  if (!isCanonicalSubset(v.parts, ROBOT_PART_IDS) || v.parts.length > ROBOTS.sizes[v.size].partSlots) return false;
  const parts: readonly RobotPartId[] = v.parts;
  if (!isInt(v.tx) || !isInt(v.tz) || !inBounds(farm.grid, v.tx, v.tz) || !isIntIn(v.facing, 0, 3)) return false;
  if (!Array.isArray(v.bag) || v.bag.length > bagStacks({ size: v.size, parts }) || !v.bag.every((s: unknown) => isValidStack(s, true))) return false;
  if (!isIntIn(v.tank, 0, ROBOTS.tankCapacity) || (v.tank > 0 && !parts.includes('wateringHead'))) return false;
  if (!isIntIn(v.tokens, 0, batteryFor(v.size)) || !isCount(v.tokensToday)) return false;
  if (!isOneOf(v.power, ROBOT_POWERS) || !isBool(v.carried)) return false;
  if (!isValidMind(v, { size: v.size, parts })) return false;
  if (!(v.off === null || v.off === 'dizzy' || v.off === 'done')) return false;
  if (v.off !== null && v.power !== 'working' && v.power !== 'standby' && v.power !== 'flat') return false;
  if (!isIntIn(v.nextActMinute, TIME.dayStartMinute, TIME.passOutMinute + ROBOTS.maxWaitMinutes)) return false;
  if (!isCount(v.moveSeq) || !isCount(v.teleportSeq) || !isCount(v.actionSeq)) return false;
  if (!isValidLastAction(v.lastAction, v.actionSeq)) return false;
  if (v.power === 'repairing') return isCount(v.repairReadyDay) && !v.carried;
  if (v.repairReadyDay !== null) return false;
  if (v.carried) return true;
  const tile = getTile(farm, v.tx, v.tz);
  if (tile === null) return false;
  if (v.power === 'broken') return tile.blocker === Blocker.Water || isWalkable(tile);
  return isWalkable(tile);
}

/**
 * The robots section: ids unique, ascending and below nextId; at most maxRobots; every robot
 * valid on the farm; the carried robot (if any) matches `player.carrying` and the player is on
 * the farm; the pool, last night's fuel, the log and the zones valid.
 */
export function isValidRobotsSection(v: unknown, maps: GameState['maps'], player: unknown): boolean {
  if (!isObj(v) || !hasExactKeys(v, ['nextId', 'list', 'pool', 'log', 'lastNightFuel', 'zones']) || !isObj(player)) return false;
  if (!isValidZones(v.zones)) return false;
  if (!isIntIn(v.nextId, 1, MAX) || !Array.isArray(v.list) || v.list.length > ROBOTS.maxRobots) return false;
  let previous = 0;
  let carried = 0;
  for (const robot of v.list as readonly unknown[]) {
    if (!isValidRobot(robot, maps.farm) || !isObj(robot) || !isInt(robot.id)) return false;
    if (robot.id <= previous || robot.id >= v.nextId) return false;
    previous = robot.id;
    if (robot.carried === true) {
      carried++;
      if (player.carrying !== robot.id || player.mapId !== 'farm') return false;
    }
  }
  if (carried !== (player.carrying === null ? 0 : 1)) return false;
  const fuel = v.lastNightFuel;
  if (!isCount(v.pool) || !isObj(fuel) || !hasExactKeys(fuel, ['wood', 'tokens']) || !isCount(fuel.wood) || !isCount(fuel.tokens)) return false;
  return isValidLog(v.log, maps.farm) && burnersOnlyOnFarm(maps);
}
